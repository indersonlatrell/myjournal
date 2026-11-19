// Chart annotations: storage and hand-off.
// Each trade page in Notion holds chart screenshots with the trader's own text annotations.
// A script on the trader's Mac (scripts/analyze-charts.mjs) transcribes them through the local
// FreeLLMAPI gateway, which a Worker can't reach. This route gives that script the trades still
// to do, with fresh image URLs, and stores what comes back:
//   GET  /analyze          -> { total }                                       public
//   GET  /analyze/pending  -> { trades: [{ id, name, images }] }              needs the token
//   POST /analyze/result   { id, result: { annotations, timeframes, instrument, model }, images },
//                          { id, noImages: true } or { id, remove: true }     needs the token
// The token is the ANALYZE_TOKEN secret, sent as "Authorization: Bearer <token>".
//
// Results live in KV (binding ANALYSIS), one key per trade ("chart:<pageId>"), so saving one
// trade can never overwrite another; the annotations also go to the Notion property "AI chart read".
import { json } from "../lib/http.js";
import { NOTION_VERSION, queryDatabase, select, text } from "../lib/notion.js";

const PREFIX = "chart:";
// Only trades from this date on are analysed (the trader's choice: earlier screenshots aren't comparable).
export const ANALYSE_FROM = "2026-11-01";
const NOTION_PROPERTY = "AI chart read";
const MAX_IMAGES = 4; // screenshots per trade
const MAX_PENDING = 5; // trades per /pending call
// A Worker invocation may make 50 outgoing requests (free plan). Walking a page's columns
// costs one Notion request per block with children, so /pending stops at this budget.
const REQUEST_BUDGET = 40;
const RECHECK_MS = 24 * 60 * 60 * 1000; // pages without screenshots are looked at again after a day


const notionHeaders = (env) => ({
  Authorization: `Bearer ${env.NOTION_API_KEY}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json",
});

// Image URLs from a page, including those nested in columns. Notion file URLs expire after
// an hour, so the script downloads them straight after asking.
async function pageImages(env, blockId, budget, depth = 0) {
  if (budget.left <= 0) throw new Error("request budget used up");
  budget.left--;
  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`, { headers: notionHeaders(env) });
  if (!res.ok) throw new Error(`Notion blocks ${res.status}`);
  const images = [];
  for (const block of (await res.json()).results || []) {
    if (block.type === "image") {
      const url = block.image?.file?.url || block.image?.external?.url;
      if (url) images.push(url);
    } else if (block.has_children && depth < 3) {
      images.push(...(await pageImages(env, block.id, budget, depth + 1)));
    }
    if (images.length >= MAX_IMAGES) break;
  }
  return images.slice(0, MAX_IMAGES);
}


// All stored analyses as { [pageId]: result }.
export async function readAnalyses(env) {
  if (!env.ANALYSIS) return {};
  const keys = [];
  let cursor;
  do {
    const page = await env.ANALYSIS.list({ prefix: PREFIX, cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const out = {};
  for (let i = 0; i < keys.length; i += 100) {
    const values = await env.ANALYSIS.get(keys.slice(i, i + 100), "json");
    for (const [key, value] of values) if (value) out[key.slice(PREFIX.length)] = value;
  }
  return out;
}

const countAnalysed = (store) => Object.values(store).filter((a) => a.annotations?.length).length;

const strings = (list, max) => (Array.isArray(list) ? [...new Set(list.map((v) => String(v).replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, max) : []);

// Keeps only the known fields.
function clean(result) {
  return {
    annotations: strings(result?.annotations, 40).map((a) => a.slice(0, 200)),
    timeframes: strings(result?.timeframes, 8),
    instrument: String(result?.instrument || "").slice(0, 120),
    model: String(result?.model || "").slice(0, 80),
  };
}

async function writeToNotion(env, pageId, result) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({ properties: { [NOTION_PROPERTY]: { rich_text: [{ text: { content: result.annotations.join(" · ").slice(0, 2000) } }] } } }),
  });
  if (!res.ok) console.log("notion write skipped", pageId, res.status);
}

async function pending(env) {
  const store = await readAnalyses(env);
  const pages = await queryDatabase(env, env.NOTION_DATABASE_ID, {
    filter: { property: "Date & Time", date: { on_or_after: ANALYSE_FROM } },
    sorts: [{ property: "Date & Time", direction: "descending" }],
  });
  const trades = [];
  const budget = { left: REQUEST_BUDGET - 2 }; // the database query used up to two
  for (const page of pages) {
    if (trades.length >= MAX_PENDING || budget.left < 8) break;
    const known = store[page.id];
    if (known?.annotations?.length) continue;
    if (known?.noImages && Date.now() - Date.parse(known.at) < RECHECK_MS) continue;
    if (select(page.properties["Position"]) === "No trade") continue;
    let images;
    try {
      images = await pageImages(env, page.id, budget);
    } catch (err) {
      if (err.message === "request budget used up") break; // this page goes in the next batch
      throw err;
    }
    trades.push({ id: page.id, name: text(page.properties["Trade"]), images });
  }
  return trades;
}

async function saveResult(env, body) {
  if (!body?.id || typeof body.id !== "string") return json({ success: false, message: "id is required" }, 400);
  const key = PREFIX + body.id;
  if (body.remove) {
    // Drops a stored analysis and clears the Notion field.
    await env.ANALYSIS.delete(key);
    await fetch(`https://api.notion.com/v1/pages/${body.id}`, {
      method: "PATCH",
      headers: notionHeaders(env),
      body: JSON.stringify({ properties: { [NOTION_PROPERTY]: { rich_text: [] } } }),
    });
    return json({ success: true });
  }
  if (body.noImages) {
    await env.ANALYSIS.put(key, JSON.stringify({ noImages: true, at: new Date().toISOString() }));
    return json({ success: true });
  }
  const result = clean(body.result);
  if (!result.annotations.length) return json({ success: false, message: "result.annotations is empty" }, 400);
  await env.ANALYSIS.put(key, JSON.stringify({ ...result, images: Number(body.images) || null, at: new Date().toISOString() }));
  await writeToNotion(env, body.id, result);
  return json({ success: true });
}

const authorised = (request, env) =>
  Boolean(env.ANALYZE_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.ANALYZE_TOKEN}`;

export async function handleAnalyze(request, env, path) {
  if (!env.ANALYSIS) return json({ success: false, message: "KV binding ANALYSIS is missing" }, 500);
  if (path === "/analyze") {
    return json({ success: true, total: countAnalysed(await readAnalyses(env)) });
  }
  if (!authorised(request, env)) return json({ success: false, message: "Unauthorised" }, 401);
  if (path === "/analyze/pending") return json({ success: true, trades: await pending(env) });
  if (path === "/analyze/result" && request.method === "POST") return saveResult(env, await request.json().catch(() => null));
  return json({ success: false, message: "Not found" }, 404);
}
