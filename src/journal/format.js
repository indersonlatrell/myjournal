export function fmt(n, d = 2) { return Number(n).toFixed(d); }
export function signedR(n) { return (n >= 0 ? "+" : "") + fmt(n) + "R"; }
export function signedUSD(n) { return (n >= 0 ? "+$" : "-$") + Math.abs(n).toFixed(2); }

// Positive values use the journal accent, negative values the error token.
export function toneClass(n) {
  if (n == null || Number.isNaN(n) || n === 0) return "text-text-primary";
  return n > 0 ? "text-accent-700" : "text-text-error-primary";
}

// Chart fills read the same tokens as text, through CSS variables.
export const CHART_POSITIVE = "var(--color-accent-500)";
export const CHART_NEGATIVE = "var(--color-text-error-primary)";
export const AXIS_TICK = { fontSize: 11, fill: "var(--color-text-tertiary)" };
