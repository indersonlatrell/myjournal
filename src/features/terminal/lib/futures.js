// ─── CME futures data for the terminal (NQ / ES) ────────────────────────────
// Same source as Day Context: Yahoo's chart API through the Worker's /futures
// route (or the Vite proxy in dev). Gives the real contract prices instead of
// the QQQ/SPY stand-ins, and costs no Twelve Data credits.
import { WORKER_URL } from "@/src/config";
import { chartUrl, nyParts, parseChart } from "@/src/features/day-context/levels";

// `biasKey` is the slot in the AI bias JSON (see buildBiasPrompt in MarketTerminal.jsx).
// `legacySymbol` is the old QQQ/SPY key, so notes written before the switch carry over.
// Point values are in USD per full index point for the full-size and micro contract.
export const WATCHLIST = [
  { symbol: "NQ=F", biasKey: "NQ", label: "NQ", name: "Nasdaq-100 futures", group: "futures", legacySymbol: "QQQ",
    contracts: [{ id: "NQ", pointValue: 20 }, { id: "MNQ", pointValue: 2 }] },
  { symbol: "ES=F", biasKey: "ES", label: "ES", name: "S&P 500 futures", group: "futures", legacySymbol: "SPY",
    contracts: [{ id: "ES", pointValue: 50 }, { id: "MES", pointValue: 5 }] },
];

const toCandle = (b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c });

async function loadChart(symbol, interval, range) {
  const res = await fetch(chartUrl(WORKER_URL, symbol, interval, range));
  if (!res.ok) throw new Error(`Futures feed ${res.status}`);
  return parseChart(await res.json());
}

// 4H bars aligned to the CME session: 18:00, 22:00, 02:00, 06:00, 10:00, 14:00 New York.
export function toFourHour(hourly) {
  const out = [];
  let key = null;
  for (const c of hourly) {
    const { date, min } = nyParts(c.time);
    const hour = Math.floor(min / 60);
    const bucket = `${hour >= 18 ? `${date}+` : date}|${Math.floor(((hour + 6) % 24) / 4)}`;
    if (bucket !== key) {
      out.push({ ...c });
      key = bucket;
    } else {
      const last = out[out.length - 1];
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    }
  }
  return out;
}

// Quote plus 1H / 4H / daily candles (oldest first) for one contract.
export async function fetchFutures(symbol) {
  const [hourly, daily] = await Promise.all([loadChart(symbol, "1h", "1mo"), loadChart(symbol, "1d", "6mo")]);
  const h1 = hourly.bars.filter((b) => b.c != null).map(toCandle);
  const days = daily.bars.filter((b) => b.c != null).map(toCandle);
  if (!h1.length || days.length < 2) throw new Error("Not enough futures history");

  // Like Day Context, the newest daily bar is the current session.
  const price = Number(hourly.meta.regularMarketPrice ?? h1.at(-1).close);
  const previousClose = days.at(-2).close;
  const change = price - previousClose;
  return {
    quote: {
      price,
      change,
      percentChange: (change / previousClose) * 100,
      previousClose,
      timestamp: h1.at(-1).time,
    },
    h1: h1.slice(-120),
    h4: toFourHour(h1).slice(-120),
    daily: days.slice(-120),
  };
}
