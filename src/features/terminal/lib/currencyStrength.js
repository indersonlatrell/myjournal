// ─── Currency strength ──────────────────────────────────────────────────
// Derived entirely from quotes we already poll (EUR/USD, GBP/USD, GBP/JPY) —
// no extra API calls. Each pair's % change attributes +score to its base
// currency and -score to its quote currency; averaging across pairs a
// currency appears in gives a rough relative-strength ranking.

const PAIRS = [
  { symbol: "EUR/USD", base: "EUR", quote: "USD" },
  { symbol: "GBP/USD", base: "GBP", quote: "USD" },
  { symbol: "GBP/JPY", base: "GBP", quote: "JPY" },
];

export function computeCurrencyStrength(quotes) {
  const totals = {};
  const counts = {};

  for (const { symbol, base, quote } of PAIRS) {
    const q = quotes[symbol];
    if (!q || q.error || typeof q.percentChange !== "number") continue;
    totals[base] = (totals[base] || 0) + q.percentChange;
    counts[base] = (counts[base] || 0) + 1;
    totals[quote] = (totals[quote] || 0) - q.percentChange;
    counts[quote] = (counts[quote] || 0) + 1;
  }

  return Object.keys(counts)
    .map((ccy) => ({ ccy, score: totals[ccy] / counts[ccy] }))
    .sort((a, b) => b.score - a.score);
}
