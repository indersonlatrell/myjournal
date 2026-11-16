// POST /chat { question, trades, stats } — answers questions about the journal with Groq.
import { json } from "../lib/http.js";

const GROQ = "https://api.groq.com/openai/v1";

// Preferred models, best first. Groq retires models over time, so the Worker
// asks Groq which models this key can use and takes the first match.
const PREFERRED_MODELS = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];
// Models that only do speech, safety checks, etc., never chat answers.
const NON_CHAT = /whisper|tts|guard|playai|orpheus|prompt-guard|distil/i;
const MODEL_CACHE_MS = 6 * 60 * 60 * 1000;

let cachedModel = null; // { id, at } kept per Worker isolate

async function pickModel(apiKey) {
  if (cachedModel && Date.now() - cachedModel.at < MODEL_CACHE_MS) return cachedModel.id;
  const res = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Groq models returned ${res.status}`);
  const available = (data?.data || []).filter((m) => m.active !== false).map((m) => m.id);
  const id = PREFERRED_MODELS.find((m) => available.includes(m)) || available.find((m) => !NON_CHAT.test(m));
  if (!id) throw new Error("No chat model is available for this Groq key");
  cachedModel = { id, at: Date.now() };
  return id;
}

function systemPrompt(trades, stats) {
  const compact = (trades || []).slice(0, 80).map((t) => ({
    date: t.date, pair: t.pair, setup: t.setup, win: t.win, r: t.r, pnl: t.pnl, session: t.session,
    day: t.day, quality: t.tradeQuality, confluences: t.confluences, mistakes: t.mistakes,
  }));
  return `You are a trading analyst assistant for a funded futures trader named Latrell. Answer questions about his trading data concisely and directly. Use specific numbers. Keep answers under 4 sentences. Only analyse the actual data, no generic advice.

Stats: ${stats?.count || 0} trades, ${stats?.winRate || 0}% win rate, ${stats?.totalR || 0}R total, net P&L $${stats?.netProfit || 0}.

Trades: ${JSON.stringify(compact)}`;
}

async function complete(apiKey, model, messages) {
  const res = await fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_completion_tokens: 800,
      messages,
      // Reasoning models spend tokens thinking; keep that short for quick answers.
      ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
    }),
  });
  const data = await res.json().catch(() => null);
  return { res, data, reply: data?.choices?.[0]?.message?.content?.trim() };
}

export async function handleChat(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Use POST" }, 405);
  // Trim so a key pasted with a trailing space or newline still works.
  const apiKey = String(env.GROQ_API_KEY || "").trim();
  if (!apiKey) return json({ success: false, message: "GROQ_API_KEY is not set on the Worker" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "Request body must be JSON" }, 400);
  }
  const question = String(body?.question || "").trim();
  if (!question) return json({ success: false, message: "Missing question" }, 400);

  const messages = [
    { role: "system", content: systemPrompt(body.trades, body.stats) },
    { role: "user", content: question },
  ];

  try {
    let model = await pickModel(apiKey);
    let { res, data, reply } = await complete(apiKey, model, messages);

    // The cached model may have been retired since; pick again once.
    if (res.status === 404 || data?.error?.code === "model_not_found" || data?.error?.code === "model_decommissioned") {
      cachedModel = null;
      model = await pickModel(apiKey);
      ({ res, data, reply } = await complete(apiKey, model, messages));
    }

    if (!res.ok || !reply) {
      // Report the real reason instead of a placeholder that looks like an answer.
      let reason = data?.error?.message || `Groq returned ${res.status}`;
      if (res.status === 401 && !apiKey.startsWith("gsk_")) {
        reason += ". The stored GROQ_API_KEY doesn't look like a Groq key (they start with gsk_).";
      }
      console.error("groq_error", res.status, model, reason);
      return json({ success: false, message: reason, model }, 502);
    }
    return json({ success: true, reply, model });
  } catch (err) {
    console.error("groq_failed", err.message);
    return json({ success: false, message: err.message }, 502);
  }
}
