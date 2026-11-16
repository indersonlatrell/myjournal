// POST /chat { question, trades, stats } — answers questions about the journal with Groq.
import { json } from "../lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

function systemPrompt(trades, stats) {
  const compact = (trades || []).slice(0, 80).map((t) => ({
    date: t.date, pair: t.pair, setup: t.setup, win: t.win, r: t.r, pnl: t.pnl, session: t.session,
    day: t.day, quality: t.tradeQuality, confluences: t.confluences, mistakes: t.mistakes,
  }));
  return `You are a trading analyst assistant for a funded futures trader named Latrell. Answer questions about his trading data concisely and directly. Use specific numbers. Keep answers under 4 sentences. Only analyse the actual data, no generic advice.

Stats: ${stats?.count || 0} trades, ${stats?.winRate || 0}% win rate, ${stats?.totalR || 0}R total, net P&L $${stats?.netProfit || 0}.

Trades: ${JSON.stringify(compact)}`;
}

export async function handleChat(request, env) {
  if (request.method !== "POST") return json({ success: false, message: "Use POST" }, 405);
  if (!env.GROQ_API_KEY) return json({ success: false, message: "GROQ_API_KEY is not set on the Worker" }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "Request body must be JSON" }, 400);
  }
  const question = String(body?.question || "").trim();
  if (!question) return json({ success: false, message: "Missing question" }, 400);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [
          { role: "system", content: systemPrompt(body.trades, body.stats) },
          { role: "user", content: question },
        ],
      }),
    });
    const data = await res.json().catch(() => null);
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!res.ok || !reply) {
      // Report the real reason instead of a placeholder that looks like an answer.
      const reason = data?.error?.message || `Groq returned ${res.status}`;
      console.error("groq_error", res.status, reason);
      return json({ success: false, message: reason }, 502);
    }
    return json({ success: true, reply });
  } catch (err) {
    console.error("groq_fetch_failed", err.message);
    return json({ success: false, message: err.message }, 502);
  }
}
