// myjournal Worker: routes requests to one handler per feature.
import { json, preflight } from "./lib/http.js";
import { handleAnalyze } from "./routes/chartAnalysis.js";
import { handleChat } from "./routes/chat.js";
import { handleFutures } from "./routes/futures.js";
import { handleMacro, refreshCalendar } from "./routes/macro.js";
import { handleStatus } from "./routes/status.js";
import { handleTrades } from "./routes/trades.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return preflight();

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      switch (path) {
        case "/status": return await handleStatus(env);
        case "/macro": return await handleMacro(env);
        case "/chat": return await handleChat(request, env);
        case "/analyze":
        case "/analyze/pending":
        case "/analyze/result": return await handleAnalyze(request, env, path);
        case "/futures": return await handleFutures(url, ctx);
        case "/": return await handleTrades(url, env);
        default: return json({ success: false, message: "Not found" }, 404);
      }
    } catch (err) {
      console.error("unhandled", path, err.message);
      return json({ success: false, message: err.message }, 500);
    }
  },

  // Cron trigger (wrangler.toml): keeps the economic calendar stored in KV.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refreshCalendar(env));
  },
};
