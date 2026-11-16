// myjournal Worker: routes requests to one handler per feature.
import { json, preflight } from "./lib/http.js";
import { handleChat } from "./routes/chat.js";
import { handleFutures } from "./routes/futures.js";
import { handleMacro } from "./routes/macro.js";
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
        case "/macro": return await handleMacro();
        case "/chat": return await handleChat(request, env);
        case "/futures": return await handleFutures(url, ctx);
        case "/": return await handleTrades(url, env);
        default: return json({ success: false, message: "Not found" }, 404);
      }
    } catch (err) {
      console.error("unhandled", path, err.message);
      return json({ success: false, message: err.message }, 500);
    }
  },
};
