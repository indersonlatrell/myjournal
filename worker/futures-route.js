// CME futures candles route for the myjournal Cloudflare Worker.
//
// The Day Context card needs real 24h NQ/ES futures candles. Yahoo's chart API
// has them but blocks browser CORS, so the Worker proxies it. Only a small
// whitelist of symbols/intervals/ranges is allowed, and responses are cached
// at the edge for 60s so the dashboard can't hammer Yahoo.
//
// ── Setup ────────────────────────────────────────────────────────────────────
// In your Worker's main `fetch(request, env, ctx)` handler, route /futures to it,
// BEFORE the default trades handler (next to the /status route):
//
//        import { handleFutures } from "./futures-route.js";
//        ...
//        if (url.pathname.replace(/\/+$/, "") === "/futures") return handleFutures(url, ctx);
//
// Then `wrangler deploy`. No secrets needed. In local dev the SPA uses the Vite
// proxy instead, so this route is only needed for the deployed site.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYMBOLS = new Set(["NQ=F", "ES=F"]);
const INTERVALS = new Set(["5m", "1d"]);
const RANGES = new Set(["5d", "3mo"]);
const CACHE_SECONDS = 60;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function handleFutures(url, ctx) {
  const symbol = url.searchParams.get("symbol");
  const interval = url.searchParams.get("interval");
  const range = url.searchParams.get("range");
  if (!SYMBOLS.has(symbol) || !INTERVALS.has(interval) || !RANGES.has(range)) {
    return json({ error: "Unsupported symbol, interval or range" }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://futures-cache/${symbol}/${interval}/${range}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  try {
    const res = await fetch(upstream, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return json({ error: `Upstream ${res.status}` }, 502);
    const body = await res.text();
    const response = new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}`, ...CORS },
    });
    ctx?.waitUntil?.(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return json({ error: err.message || "Upstream fetch failed" }, 502);
  }
}
