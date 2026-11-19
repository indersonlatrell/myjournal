#!/usr/bin/env node
// Extracts the trader's own text annotations from the chart screenshots in the Notion trade
// journal, using a vision model through the local FreeLLMAPI gateway (http://127.0.0.1:31415).
// The model only transcribes; it doesn't judge the trade. The dashboard turns the labels into
// statistics (win rate and R per annotation). Results are stored through the Worker
// (KV + the "AI chart read" property in Notion): see worker/src/routes/chartAnalysis.js.
//
// Run from the project folder:  node scripts/analyze-charts.mjs [--all]
//   without --all: one batch of up to 5 trades;  --all: keep going until nothing is left.
// Runs by itself every 30 minutes through launchd: see scripts/com.latrell.myjournal-analyze-charts.plist.
//
// Settings (in .env.local at the project root, which git ignores, or the environment):
//   ANALYZE_TOKEN       the Worker's ANALYZE_TOKEN secret
//   FREELLMAPI_API_KEY  gateway key; when unset, read from ~/CowAgent/config.json
//   FREELLMAPI_URL      default http://127.0.0.1:31415/v1
//   WORKER_URL          default the production Worker
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(join(root, ".env.local"));

function gatewayKey() {
  if (process.env.FREELLMAPI_API_KEY) return process.env.FREELLMAPI_API_KEY;
  try {
    const config = JSON.parse(readFileSync(join(homedir(), "CowAgent/config.json"), "utf8"));
    return config.custom_providers?.find((p) => p.api_base?.includes(":31415"))?.api_key;
  } catch {
    return undefined;
  }
}

const WORKER = (process.env.WORKER_URL || "https://noisy-rain-e6aftest.indersonlatrell7.workers.dev").replace(/\/$/, "");
const GATEWAY = (process.env.FREELLMAPI_URL || "http://127.0.0.1:31415/v1").replace(/\/$/, "");
const TOKEN = process.env.ANALYZE_TOKEN;
const KEY = gatewayKey();

// Vision models that read these charts correctly through the gateway, best first.
// (command-a-vision is left out: in testing it described a different chart.)
const MODELS = ["auto", "gemini-2.5-flash", "qwen2.5-vl-72b"];

const PROMPT = `You transcribe text from trading chart screenshots (NQ/ES futures, TradingView).
The trader writes their own annotations on the charts: callout boxes and text labels next to drawings,
such as "SMT with PDL", "H1 FVG", "Swept internal liquidity inside M15 FVG", "Target", "Sellside".

Copy every annotation the trader wrote, exactly as written (same words, spelling and capitalisation),
once each, across all screenshots. Do not interpret, summarise, correct or add anything.
Leave out: price-axis numbers, date and time axes, the symbol and header line, app menus and toolbars,
and the small automatic indicator tags printed along horizontal levels (tiny "PDH", "PDL", "PWL",
session times like "14:00") unless the trader wrote that word as their own label.

Reply with one JSON object and nothing else:
{
  "instrument": string (the symbol or name in the chart header),
  "timeframes": [string] (the timeframe of each screenshot, e.g. "1h", "15m"),
  "annotations": [string]
}`;

async function worker(path, init = {}) {
  const res = await fetch(WORKER + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...init.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`Worker ${path}: ${data.message || res.status}`);
  return data;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image download ${res.status}`);
  const type = res.headers.get("content-type") || "image/png";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

function parseJson(text) {
  const body = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return JSON.parse(body.slice(start, end + 1));
}

// A reply only counts when it parses and is about an index future (guards against a
// model describing some other chart).
const plausible = (result) => /nasdaq|nq|mnq|s&p|\bes\b|mes|500|e-mini/i.test(String(result?.instrument || ""));

// Every screenshot carries the trader's text annotations, so a reply without them is
// incomplete: the next model gets a try instead.
const hasAnnotations = (result) => Array.isArray(result?.annotations) && result.annotations.some((a) => String(a).trim());

async function extract(images) {
  const errors = [];
  for (const model of MODELS) {
    try {
      const res = await fetch(`${GATEWAY}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          temperature: 0,
          messages: [
            { role: "system", content: PROMPT },
            { role: "user", content: [
              ...images.map((url) => ({ type: "image_url", image_url: { url } })),
              { type: "text", text: `Transcribe the annotations in these ${images.length} screenshot(s).` },
            ] },
          ],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message?.slice(0, 120) || `HTTP ${res.status}`);
      const result = parseJson(data.choices?.[0]?.message?.content || "");
      if (!plausible(result)) throw new Error("reply was not about this chart");
      if (!hasAnnotations(result)) throw new Error("reply left out the text annotations");
      // Bare times and numbers ("09:30", "27155.50") are axis or session tags, not annotations.
      const annotations = result.annotations.map((a) => String(a).trim()).filter((a) => a && !/^[\d\s:.,]+$/.test(a));
      if (!annotations.length) throw new Error("reply left out the text annotations");
      return { instrument: result.instrument, timeframes: result.timeframes, annotations, model: data.model || model };
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function runBatch() {
  const { trades } = await worker("/analyze/pending");
  let done = 0;
  let failed = 0;
  for (const trade of trades) {
    if (!trade.images.length) {
      await worker("/analyze/result", { method: "POST", body: JSON.stringify({ id: trade.id, noImages: true }) });
      console.log(`- ${trade.name}: no screenshots, skipped`);
      continue;
    }
    try {
      const images = await Promise.all(trade.images.map(download));
      const result = await extract(images);
      await worker("/analyze/result", { method: "POST", body: JSON.stringify({ id: trade.id, result, images: images.length }) });
      done++;
      console.log(`✓ ${trade.name} (${result.model}): ${result.annotations.join(" · ")}`);
    } catch (err) {
      failed++;
      console.log(`✗ ${trade.name}: ${err.message}`);
    }
  }
  return { found: trades.length, done, failed };
}

async function main() {
  if (!TOKEN) throw new Error("ANALYZE_TOKEN is missing (put it in .env.local)");
  if (!KEY) throw new Error("No FreeLLMAPI key: set FREELLMAPI_API_KEY in .env.local");
  const all = process.argv.includes("--all");
  for (;;) {
    const { found, done, failed } = await runBatch();
    // Quiet when there's nothing to do, so the scheduled run's log stays readable.
    if (found) console.log(`${new Date().toLocaleString("en-GB")} · batch: ${done} extracted, ${failed} failed, ${found - done - failed} without screenshots.`);
    // Stop when nothing is left, or when every trade in a batch failed (gateway down, rate limits).
    if (!all || !found || failed === found) break;
  }
}

main().catch((err) => {
  console.error(`${new Date().toLocaleString("en-GB")} · ${err.message}`);
  process.exit(1);
});
