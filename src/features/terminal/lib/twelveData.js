// ─── Twelve Data client ─────────────────────────────────────────────────────
// Free-tier plan: 800 credits/day, 8 credits/minute, 1 credit per symbol per
// request. A single batched quote call for the full 9-symbol watchlist would
// already blow the per-minute cap by itself, so all requests go through
// acquireCredits() below, which gates dispatch on a sliding 60s window.
// Callers should request small chunks (a handful of symbols, or one symbol
// for time_series) and await acquireCredits(cost) before each fetch.

const API_KEY = import.meta.env.VITE_TWELVE_DATA_API_KEY;
const BASE = "https://api.twelvedata.com";

const CREDIT_LIMIT_PER_MIN = 7; // headroom under the hard 8/min cap
const usageLog = []; // { t: timestamp, cost }

function currentUsage() {
  const cutoff = Date.now() - 60_000;
  while (usageLog.length && usageLog[0].t < cutoff) usageLog.shift();
  return usageLog.reduce((sum, e) => sum + e.cost, 0);
}

// Resolves once `cost` credits can be spent without exceeding the sliding
// 60s budget. Cost must be <= CREDIT_LIMIT_PER_MIN or it will never resolve.
export function acquireCredits(cost) {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (currentUsage() + cost <= CREDIT_LIMIT_PER_MIN) {
        usageLog.push({ t: Date.now(), cost });
        resolve();
      } else {
        setTimeout(tryAcquire, 2000);
      }
    };
    tryAcquire();
  });
}

// `biasKey` maps each entry to its slot in the AI bias JSON (see
// buildBiasPrompt in MarketTerminal.jsx). NQ/ES are priced via ETF proxies —
// Twelve Data's free tier doesn't carry CME futures or raw index data, so QQQ
// and SPY stand in (price levels won't match the real futures contracts).
export const WATCHLIST = [
  { symbol: "QQQ",     biasKey: "NQ",      label: "NQ (via QQQ)", group: "index" },
  { symbol: "SPY",     biasKey: "ES",      label: "ES (via SPY)", group: "index" },
  { symbol: "EUR/USD", biasKey: "EURUSD",  label: "EUR/USD",      group: "fx" },
  { symbol: "GBP/USD", biasKey: "GBPUSD",  label: "GBP/USD",      group: "fx" },
  { symbol: "GBP/JPY", biasKey: "GBPJPY",  label: "GBP/JPY",      group: "fx" },
];

export function formatPrice(group, symbol, price) {
  if (price === null || price === undefined || Number.isNaN(price)) return "—";
  if (group === "fx") return price.toFixed(symbol.includes("JPY") ? 3 : 5);
  if (group === "crypto") return price >= 100 ? price.toFixed(2) : price.toFixed(4);
  return price.toFixed(2);
}

// Fetches quotes for a small batch of symbols (1 credit/symbol) — caller is
// responsible for chunking large watchlists and pacing via acquireCredits().
export async function fetchQuotes(symbols) {
  if (!API_KEY) throw new Error("Missing VITE_TWELVE_DATA_API_KEY");
  const url = `${BASE}/quote?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status === "error" || data.code) {
    throw new Error(data.message || "Quote request failed");
  }

  // Single-symbol requests return a flat object instead of a symbol-keyed map.
  const bySymbol = symbols.length === 1 ? { [symbols[0]]: data } : data;

  const out = {};
  for (const sym of symbols) {
    const q = bySymbol[sym];
    if (!q || q.status === "error" || q.code) {
      out[sym] = { error: q?.message || "No quote data" };
      continue;
    }
    out[sym] = {
      price: Number(q.close),
      change: Number(q.change),
      percentChange: Number(q.percent_change),
      previousClose: Number(q.previous_close),
      timestamp: Number(q.timestamp) || Date.now() / 1000,
    };
  }
  return out;
}

// interval: "1h" | "4h" | "1day" (any Twelve Data time_series interval)
export async function fetchSeries(symbol, interval = "1h", outputsize = 120) {
  if (!API_KEY) throw new Error("Missing VITE_TWELVE_DATA_API_KEY");
  const url = `${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "error" || !Array.isArray(data.values)) {
    throw new Error(data.message || `No ${interval} data for ${symbol}`);
  }
  return data.values
    .map((v) => ({
      time: v.datetime,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }))
    .reverse(); // API returns newest-first; we want oldest-first for structure analysis
}

export function fetchHourlySeries(symbol, outputsize = 120) {
  return fetchSeries(symbol, "1h", outputsize);
}

// One-off lookup for the command bar — not part of the paced watchlist.
export async function searchSymbols(query) {
  if (!API_KEY) throw new Error("Missing VITE_TWELVE_DATA_API_KEY");
  const url = `${BASE}/symbol_search?symbol=${encodeURIComponent(query)}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "error") throw new Error(data.message || "Symbol search failed");
  return (data.data || []).slice(0, 8);
}

export async function fetchQuote(symbol) {
  const data = await fetchQuotes([symbol]);
  const q = data[symbol];
  if (!q || q.error) throw new Error(q?.error || `No quote for ${symbol}`);
  return q;
}
