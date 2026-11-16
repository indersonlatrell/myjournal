// GET /futures?symbol=NQ=F&interval=5m|1d&range=5d|3mo
// Proxies Yahoo's CME futures candles for the Day Context card (Yahoo blocks
// browser CORS). Only a small whitelist is allowed and responses are cached 60s.
import { CORS, json } from "../lib/http.js";

const SYMBOLS = new Set(["NQ=F", "ES=F"]);
const INTERVALS = new Set(["5m", "1d"]);
const RANGES = new Set(["5d", "3mo"]);
const CACHE_SECONDS = 60;

export async function handleFutures(url, ctx) {
  const symbol = url.searchParams.get("symbol");
  const interval = url.searchParams.get("interval");
  const range = url.searchParams.get("range");
  if (!SYMBOLS.has(symbol) || !INTERVALS.has(interval) || !RANGES.has(range)) {
    return json({ success: false, message: "Unsupported symbol, interval or range" }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://futures-cache/${symbol}/${interval}/${range}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  try {
    const res = await fetch(upstream, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return json({ success: false, message: `Upstream ${res.status}` }, 502);
    const response = new Response(await res.text(), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}`, ...CORS },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return json({ success: false, message: err.message || "Upstream fetch failed" }, 502);
  }
}
