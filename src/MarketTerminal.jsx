import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  RefreshCw, CheckCircle2, XCircle, MinusCircle, Circle, Loader2,
  Radio, Clock, TrendingUp, TrendingDown, AlertTriangle, Sparkles, Landmark,
  Bell, BellOff, Search, X, ArrowUp, ArrowDown, Minus, StickyNote,
} from "lucide-react";
import { WATCHLIST, fetchQuotes, fetchQuote, fetchSeries, searchSymbols, acquireCredits, formatPrice } from "./lib/twelveData";
import { evaluateScenario, trendOf } from "./lib/marketStructure";
import { computeCurrencyStrength } from "./lib/currencyStrength";
import { GRID_COLS, GRID_ROWS, WORLD_DOTS, SESSION_CITIES } from "./lib/worldMap";
import { useFnStatus } from "./RiskGauge";

const WORKER_URL = "https://noisy-rain-e6aftest.indersonlatrell7.workers.dev/";
const AI_BIAS_KEY = "myjournal_terminal_ai_bias";
const NOTES_KEY = "myjournal_terminal_notes";
const ALERTS_ENABLED_KEY = "myjournal_terminal_alerts_enabled";

// Conservative polling — Twelve Data free tier is 800 credits/day, 8/min.
// Tuned so a full trading session (~8h, tab visible) stays well under budget:
// quotes ~5cr/10min, 1H ~5cr/60min (matches candle close), 4H ~5cr/4h, D ~5cr/24h.
// Requests are additionally paced through acquireCredits() (see lib/twelveData).
const QUOTE_INTERVAL_MS = 10 * 60 * 1000;
const SERIES_INTERVAL_MS = 60 * 60 * 1000;
const SERIES_4H_INTERVAL_MS = 4 * 60 * 60 * 1000;
const SERIES_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SQUAWK_INTERVAL_MS = 5 * 60 * 1000;
// A series fetch can miss its window (real per-minute contention on the
// shared API key) and get silently caught — without a faster retry, that
// symbol would be stuck showing "loading" for a full SERIES_INTERVAL_MS.
// So: retry soon while any symbol is still missing data, then fall back to
// the slow interval once every symbol has loaded at least once.
const SERIES_RETRY_MS = 90 * 1000;
// Macro/geopolitical backdrop doesn't move minute to minute, so the AI bias
// call — and the Groq usage it costs — refreshes far less often than price.
const AI_BIAS_INTERVAL_MS = 45 * 60 * 1000;
const AI_BIAS_MAX_AGE_MS = 45 * 60 * 1000;

const STATUS_STYLES = {
  validated:   { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: CheckCircle2, label: "VALIDATED" },
  invalidated: { text: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/30",    icon: XCircle,      label: "INVALIDATED" },
  pending:     { text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   icon: MinusCircle,  label: "PENDING" },
  loading:     { text: "text-slate-500",   bg: "bg-slate-800/30",   border: "border-slate-800",      icon: Loader2,      label: "LOADING", spin: true },
  neutral:     { text: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/30",   icon: Circle,       label: "NO MACRO EDGE" },
};

const BIAS_STYLES = {
  strengthening: "bg-emerald-500/20 text-emerald-300",
  weakening:     "bg-rose-500/20 text-rose-300",
  neutral:       "bg-slate-700/50 text-slate-300",
};

const TREND_ICON = { bullish: ArrowUp, bearish: ArrowDown, ranging: Minus, insufficient: Minus };
const TREND_COLOR = {
  bullish: "text-emerald-400", bearish: "text-rose-400",
  ranging: "text-slate-500", insufficient: "text-slate-700",
};

// Approx UTC session windows (not DST-adjusted).
const SESSIONS = [
  { name: "Sydney",   start: 21, end: 6 },
  { name: "Tokyo",    start: 0,  end: 9 },
  { name: "London",   start: 7,  end: 16 },
  { name: "New York", start: 12, end: 21 },
];

function isSessionActive(session, utcHour) {
  if (session.start < session.end) return utcHour >= session.start && utcHour < session.end;
  return utcHour >= session.start || utcHour < session.end;
}

// Runs `loadFn` once immediately, then reschedules itself: quickly
// (retryMs) while `isComplete()` is false — recovering fast from a missed
// rate-limit window — otherwise at the slow, credit-friendly `intervalMs`
// cadence once every symbol has loaded at least once. Returns a cleanup fn.
function scheduleAdaptivePoll(loadFn, isComplete, intervalMs, retryMs) {
  let cancelled = false;
  let timer;
  const tick = async (first) => {
    if (cancelled) return;
    if (first || document.visibilityState === "visible") await loadFn();
    if (cancelled) return;
    timer = setTimeout(() => tick(false), isComplete() ? intervalMs : retryMs);
  };
  tick(true);
  return () => { cancelled = true; clearTimeout(timer); };
}

function parseJsonLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* give up below */ }
  }
  return null;
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Web Audio unavailable — skip the beep, alert still logs/notifies
  }
}

async function fetchMacroContext() {
  try {
    const res = await fetch(WORKER_URL + "macro");
    const data = await res.json();
    return data.success ? data : null;
  } catch {
    return null;
  }
}

function buildBiasPrompt(macro) {
  const macroLines = macro
    ? [
        `Risk sentiment: ${macro.sentiment || "unknown"}`,
        macro.fearGreed ? `Fear & Greed Index: ${macro.fearGreed.score}/100 (${macro.fearGreed.rating})` : null,
        macro.events?.length
          ? `Upcoming high-impact events: ${macro.events.slice(0, 6).map((e) => `${e.name} (${e.currency}, ${e.isToday ? "today" : e.date})`).join("; ")}`
          : "No high-impact events flagged in the next few days.",
      ].filter(Boolean).join("\n")
    : "Macro feed unavailable right now — use your general knowledge of the current macro/rates/geopolitical backdrop.";

  return `You are a macro strategist setting higher-timeframe directional bias for a discretionary trader's watchlist. Ignore any prior trade-journal instructions — this is a pure macro-analysis request, not trade analysis. Base each call ONLY on macro fundamentals, cross-asset risk sentiment, central bank / rate expectations, and geopolitical tension — NOT on any instrument's own recent price action, since that gets checked separately against your call.

Macro backdrop:
${macroLines}

Instruments (assign each a bias):
- NQ: Nasdaq-100 (US tech-heavy equity index)
- ES: S&P 500 (US broad equity index)
- EURUSD: Euro vs US Dollar
- GBPUSD: British Pound vs US Dollar
- GBPJPY: British Pound vs Japanese Yen

For each, decide "strengthening" (bullish HTF bias), "weakening" (bearish HTF bias), or "neutral" (no clear macro edge), with one reason under 18 words.

Respond with ONLY raw JSON, no markdown fences, no prose before or after, exactly this shape:
{"NQ":{"bias":"strengthening","reason":"..."},"ES":{"bias":"...","reason":"..."},"EURUSD":{"bias":"...","reason":"..."},"GBPUSD":{"bias":"...","reason":"..."},"GBPJPY":{"bias":"...","reason":"..."}}`;
}

function buildSquawkPrompt(quotes, structure, aiBias) {
  const lines = WATCHLIST.map((w) => {
    const q = quotes[w.symbol];
    const st = structure[w.symbol];
    const biasEntry = aiBias?.bias?.[w.biasKey];
    if (!q || q.error) return `${w.label}: no data`;
    const price = formatPrice(w.group, w.symbol, q.price);
    const pct = typeof q.percentChange === "number" ? q.percentChange : 0;
    const chg = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
    return `${w.label} ${price} (${chg}) — AI macro bias: ${biasEntry?.bias || "neutral"}, 1H structure: ${st?.trend || "n/a"} [${st?.status || "n/a"}]`;
  }).join("\n");
  return `You are a Bloomberg-style live market squawk reporter for a discretionary trader's terminal. Ignore any prior trade-journal instructions — this is a pure market-commentary request, not trade analysis.\n\nCurrent snapshot:\n${lines}\n\nIn under 45 words, deliver one punchy, professional squawk-box line covering the most notable move(s), momentum shift, or bias validation/invalidation. No preamble, no bullet points, no markdown — just the line, as if read live on air.`;
}

// ─── Panel shell ────────────────────────────────────────────────────────
function Panel({ icon: Icon, iconColor = "text-amber-500", title, right, children, bodyClass = "p-4" }) {
  return (
    <div className="border border-white/10 bg-[#0a0d12] rounded">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-300 uppercase tracking-widest">
          <Icon size={13} className={iconColor} /> {title}
        </div>
        {right}
      </div>
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

// ─── Ticker tape ─────────────────────────────────────────────────────────
function TickerTape({ quotes }) {
  const hasAnyQuote = Object.values(quotes).some((q) => q && !q.error);
  const items = WATCHLIST.map((w) => ({ ...w, q: quotes[w.symbol] }));
  const doubled = [...items, ...items];
  return (
    <div className="w-full overflow-hidden bg-black border-b border-amber-500/20 py-2">
      {hasAnyQuote ? (
        <div className="ticker-track flex gap-8 flex-nowrap">
          {doubled.map((it, i) => {
            const q = it.q;
            const up = q && !q.error && (q.percentChange ?? 0) >= 0;
            return (
              <span key={i} className="flex-shrink-0 inline-flex items-center gap-2 text-[11px] px-2 whitespace-nowrap tabular-nums">
                <span className="text-slate-500">{it.label}</span>
                <span className={q && !q.error ? (up ? "text-emerald-400" : "text-rose-400") : "text-slate-600"}>
                  {q && !q.error ? formatPrice(it.group, it.symbol, q.price) : "—"}
                </span>
                {q && !q.error && (
                  <span className={up ? "text-emerald-500" : "text-rose-500"}>
                    {up ? "▲" : "▼"} {Math.abs(q.percentChange ?? 0).toFixed(2)}%
                  </span>
                )}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-600">
          <Loader2 size={11} className="animate-spin" /> Waiting for live feed…
        </div>
      )}
    </div>
  );
}

// ─── Command bar ────────────────────────────────────────────────────────
function CommandBar({ query, onQueryChange, onSearch, results, onSelect, loading }) {
  return (
    <div className="relative">
      <form onSubmit={onSearch} className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Quick lookup — e.g. AAPL, USD/CHF"
          className="pl-7 pr-3 py-2 text-[11px] rounded bg-[#0a0d12] border border-white/10 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-amber-500/40 w-56"
        />
      </form>
      {loading && (
        <div className="absolute z-10 mt-1 w-56 rounded border border-white/10 bg-[#0a0d12] px-3 py-2 text-[11px] text-slate-500">
          Searching…
        </div>
      )}
      {!loading && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-72 rounded border border-white/10 bg-[#0a0d12] shadow-xl overflow-hidden">
          {results.map((r) => (
            <button
              key={`${r.symbol}-${r.exchange}`}
              onClick={() => onSelect(r)}
              className="w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
            >
              <span className="text-slate-200 font-bold">{r.symbol}</span>
              <span className="text-slate-500 ml-2">{r.instrument_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LookupCard({ result, onDismiss }) {
  if (!result) return null;
  const { symbol, name, quote, error } = result;
  return (
    <div className="rounded border border-white/10 bg-[#0a0d12] px-4 py-3 flex items-center justify-between text-[11px]">
      {error ? (
        <span className="text-rose-400">{symbol}: {error}</span>
      ) : (
        <div>
          <p className="text-slate-100 font-bold text-sm">
            {symbol} <span className="text-slate-500 font-normal text-[11px]">{name}</span>
          </p>
          <p className="text-slate-400 mt-0.5 tabular-nums">
            {quote.price}{" "}
            <span className={quote.percentChange >= 0 ? "text-emerald-400" : "text-rose-400"}>
              {quote.percentChange >= 0 ? "+" : ""}{quote.percentChange.toFixed(2)}%
            </span>
          </p>
        </div>
      )}
      <button onClick={onDismiss} className="text-slate-500 hover:text-slate-300 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Macro strip ────────────────────────────────────────────────────────
function MacroStrip({ macro, generatedAt, loading, onRefresh }) {
  const nextEvent = macro?.events?.[0];
  return (
    <Panel
      icon={Landmark}
      title="Macro"
      bodyClass="px-4 py-2.5"
      right={
        <button onClick={onRefresh} className="text-slate-500 hover:text-slate-300 transition-colors">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[11px]">
        {macro ? (
          <>
            <span className="text-slate-300 capitalize">{macro.sentiment || "unknown"}</span>
            {macro.fearGreed && (
              <span className="text-slate-500">F&amp;G {macro.fearGreed.score} · {macro.fearGreed.rating}</span>
            )}
            {nextEvent && (
              <span className="text-slate-500">
                Next: {nextEvent.name} ({nextEvent.currency}) {nextEvent.isToday ? "today" : nextEvent.date}
              </span>
            )}
          </>
        ) : (
          <span className="text-slate-600">unavailable</span>
        )}
        <span className="text-slate-600 ml-auto">
          {generatedAt ? `bias set ${new Date(generatedAt).toLocaleTimeString()}` : ""}
        </span>
      </div>
    </Panel>
  );
}

// ─── Structure ladder (D / 4H / 1H) ────────────────────────────────────
function StructureLadder({ daily, h4, h1 }) {
  const rows = [
    { label: "D", trend: daily || "insufficient" },
    { label: "4H", trend: h4 || "insufficient" },
    { label: "1H", trend: h1 || "insufficient" },
  ];
  return (
    <div className="flex items-center gap-3 text-[10px]">
      {rows.map((r) => {
        const Icon = TREND_ICON[r.trend];
        return (
          <span key={r.label} className={`flex items-center gap-1 ${TREND_COLOR[r.trend]}`}>
            <span className="text-slate-600">{r.label}</span>
            <Icon size={10} />
          </span>
        );
      })}
    </div>
  );
}

// ─── Scenario card ───────────────────────────────────────────────────────
function ScenarioCard({ item, quote, candles, evalResult, biasEntry, biasLoading, h4Trend, dailyTrend, note, onNoteChange }) {
  const status = evalResult?.status || "neutral";
  const s = STATUS_STYLES[status];
  const Icon = s.icon;
  const up = quote && !quote.error && (quote.percentChange ?? 0) >= 0;
  const sparkData = useMemo(
    () => (candles ? candles.slice(-40).map((c, i) => ({ i, close: c.close })) : []),
    [candles]
  );
  const sparkColor = evalResult?.trend === "bullish" ? "#34d399" : evalResult?.trend === "bearish" ? "#fb7185" : "#64748b";
  const biasValue = biasEntry?.bias || "neutral";

  return (
    <div className="border border-white/10 bg-[#0a0d12] rounded p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-bold text-slate-100">{item.label}</p>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">{item.group}</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold tabular-nums ${quote && !quote.error ? (up ? "text-emerald-400" : "text-rose-400") : "text-slate-600"}`}>
            {quote && !quote.error ? formatPrice(item.group, item.symbol, quote.price) : "—"}
          </p>
          {quote && !quote.error && (
            <p className={`text-[11px] flex items-center justify-end gap-1 tabular-nums ${up ? "text-emerald-500" : "text-rose-500"}`}>
              {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {(quote.percentChange ?? 0) >= 0 ? "+" : ""}{(quote.percentChange ?? 0).toFixed(2)}%
            </p>
          )}
          {quote?.error && <p className="text-[10px] text-slate-600">no data</p>}
        </div>
      </div>

      {sparkData.length > 3 && (
        <div className="h-10 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <Line type="monotone" dataKey="close" stroke={sparkColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <StructureLadder daily={dailyTrend} h4={h4Trend} h1={evalResult?.trend} />

      <div className="rounded border border-white/10 bg-black/20 px-2.5 py-2 space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="flex items-center gap-1.5 text-slate-500 uppercase tracking-widest">
            <Sparkles size={11} /> AI Bias
          </span>
          <span className={`px-2 py-0.5 rounded-full font-bold uppercase ${BIAS_STYLES[biasValue]}`}>
            {biasLoading && !biasEntry ? "…" : biasValue}
          </span>
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          {biasEntry?.reason || (biasLoading ? "Reading macro backdrop…" : "No reasoning yet — refresh the macro panel above.")}
        </p>
      </div>

      <div className={`rounded border ${s.border} ${s.bg} px-2.5 py-2`}>
        <div className={`flex items-center gap-1.5 text-[11px] font-bold ${s.text}`}>
          <Icon size={12} className={s.spin ? "animate-spin" : ""} />
          {s.label}
          {evalResult?.trend && evalResult.trend !== "insufficient" && (
            <span className="text-slate-500 font-normal normal-case ml-1">· 1H {evalResult.trend}</span>
          )}
        </div>
        {evalResult?.detail && <p className="text-[10px] text-slate-500 mt-1 leading-snug">{evalResult.detail}</p>}
      </div>

      <div className="space-y-1">
        <span className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest">
          <StickyNote size={11} /> Notes
        </span>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Your own read…"
          rows={2}
          className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-amber-500/40"
        />
      </div>
    </div>
  );
}

// ─── Currency strength meter ────────────────────────────────────────────
function CurrencyStrengthMeter({ quotes }) {
  const ranking = useMemo(() => computeCurrencyStrength(quotes), [quotes]);
  const maxAbs = Math.max(0.01, ...ranking.map((r) => Math.abs(r.score)));

  return (
    <Panel icon={TrendingUp} title="Currency Strength">
      <div className="space-y-3">
        {ranking.length === 0 ? (
          <p className="text-[11px] text-slate-600">Waiting for quotes…</p>
        ) : (
          <div className="space-y-1.5">
            {ranking.map((r) => {
              const positive = r.score >= 0;
              const widthPct = Math.min(100, (Math.abs(r.score) / maxAbs) * 100);
              return (
                <div key={r.ccy} className="flex items-center gap-2 text-[11px]">
                  <span className="w-9 text-slate-400 font-bold">{r.ccy}</span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${widthPct}%`, background: positive ? "#34d399" : "#fb7185" }}
                    />
                  </div>
                  <span className={`w-14 text-right tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`}>
                    {positive ? "+" : ""}{r.score.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-slate-600">Derived from EUR/USD, GBP/USD, GBP/JPY — covers EUR, USD, GBP, JPY only.</p>
      </div>
    </Panel>
  );
}

// ─── World map ──────────────────────────────────────────────────────────
function WorldMap({ utcHour }) {
  return (
    <svg viewBox={`0 0 ${GRID_COLS} ${GRID_ROWS}`} className="w-full h-auto block">
      {WORLD_DOTS.map((d, i) => (
        <circle key={i} cx={d.col + 0.5} cy={d.row + 0.5} r={0.34} className="fill-slate-700" />
      ))}
      {SESSIONS.map((sess) => {
        const pos = SESSION_CITIES[sess.name];
        if (!pos) return null;
        const active = isSessionActive(sess, utcHour);
        const cx = pos.col + 0.5;
        const cy = pos.row + 0.5;
        return (
          <g key={sess.name}>
            {active && (
              <circle cx={cx} cy={cy} r={0.9} fill="#34d399" opacity={0.25}>
                <animate attributeName="r" values="0.7;1.8;0.7" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0.05;0.35" dur="2.2s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={cx} cy={cy} r={0.55} fill={active ? "#34d399" : "#64748b"} stroke="#05070a" strokeWidth={0.15} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Situational awareness ─────────────────────────────────────────────────
function SituationalAwareness({ now, structure, aiBias }) {
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const counts = { validated: 0, invalidated: 0, pending: 0 };
  Object.values(structure).forEach((s) => {
    if (s && counts[s.status] !== undefined) counts[s.status] += 1;
  });
  const activeBiasCount = Object.values(aiBias?.bias || {}).filter((b) => b?.bias && b.bias !== "neutral").length;

  return (
    <Panel icon={Clock} title="Situational Awareness">
      <div className="space-y-4">
        <div className="rounded border border-white/5 bg-black/30 p-2">
          <WorldMap utcHour={utcHour} />
        </div>

        <div className="space-y-1.5">
          {SESSIONS.map((sess) => {
            const active = isSessionActive(sess, utcHour);
            return (
              <div key={sess.name} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-400 animate-pulse" : "bg-slate-700"}`} />
                  <span className={active ? "text-slate-200" : "text-slate-500"}>{sess.name}</span>
                </span>
                <span className={active ? "text-emerald-400" : "text-slate-600"}>{active ? "OPEN" : "closed"}</span>
              </div>
            );
          })}
        </div>

        <div className="pt-3 border-t border-white/10 text-[11px] text-slate-400 space-y-1">
          <p className="tabular-nums">UTC {now.toISOString().slice(11, 19)} · Local {now.toLocaleTimeString()}</p>
          <p>
            <span className="text-slate-300 font-bold">{activeBiasCount}</span> active AI bias{activeBiasCount === 1 ? "" : "es"} ·{" "}
            <span className="text-emerald-400">{counts.validated} validated</span> ·{" "}
            <span className="text-rose-400">{counts.invalidated} invalidated</span> ·{" "}
            <span className="text-amber-400">{counts.pending} pending</span>
          </p>
          {counts.invalidated > 0 && (
            <p className="flex items-center gap-1.5 text-rose-400 pt-1">
              <AlertTriangle size={12} /> Structure broke against {counts.invalidated} open bias{counts.invalidated === 1 ? "" : "es"} — reassess.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ─── Alerts panel ───────────────────────────────────────────────────────
function AlertsPanel({ alerts, enabled, onToggle }) {
  return (
    <Panel
      icon={Bell}
      title="Alerts"
      right={
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border transition-colors ${
            enabled ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-white/10 text-slate-500 hover:text-slate-300"
          }`}
        >
          {enabled ? <Bell size={11} /> : <BellOff size={11} />} {enabled ? "On" : "Off"}
        </button>
      }
    >
      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
        {alerts.length === 0 && (
          <p className="text-[11px] text-slate-600">No alerts yet — structure flips for/against your AI bias will show up here.</p>
        )}
        {alerts.map((a) => (
          <div key={a.id} className={`border-l-2 pl-2.5 py-0.5 ${a.level === "validated" ? "border-emerald-500/40" : "border-rose-500/40"}`}>
            <p className="text-[10px] text-slate-600">{a.time.toLocaleTimeString()}</p>
            <p className={`text-[11px] leading-snug ${a.level === "validated" ? "text-emerald-300" : "text-rose-300"}`}>{a.text}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Squawk feed ────────────────────────────────────────────────────────
function SquawkFeed({ squawks, loading, onRefresh }) {
  return (
    <Panel
      icon={Radio}
      iconColor={loading ? "animate-pulse text-amber-400" : "text-amber-500"}
      title="Live Market Squawk"
      right={
        <button onClick={onRefresh} className="text-slate-500 hover:text-slate-300 transition-colors">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      }
    >
      <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
        {squawks.length === 0 && (
          <p className="text-[11px] text-slate-600">{loading ? "Tuning in…" : "No squawk yet."}</p>
        )}
        {squawks.map((sq) => (
          <div key={sq.id} className="border-l-2 border-amber-500/40 pl-2.5 py-0.5">
            <p className="text-[10px] text-slate-600">{sq.time.toLocaleTimeString()}</p>
            <p className="text-[11px] text-slate-300 leading-snug">{sq.text}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────
// ─── FundedNext account risk (pre-trade glance) ─────────────────────────────
function AccountRiskPanel() {
  const { status, loading } = useFnStatus(WORKER_URL);

  const money = (n, d = 2) =>
    n === null || n === undefined || isNaN(Number(n))
      ? "—"
      : (Number(n) < 0 ? "-$" : "$") +
        Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

  const dist = status ? Number(status.distanceToBreach) : null;
  const alert = status ? Boolean(status.breachAlert) || (dist > 0 && dist < 500) : false;

  return (
    <Panel
      icon={AlertTriangle}
      iconColor={alert ? "text-red-500" : "text-amber-500"}
      title="Account Risk"
      right={status?.login ? <span className="text-[10px] font-mono text-slate-500">#{status.login}</span> : null}
    >
      {loading ? (
        <div className="h-10 bg-white/5 rounded animate-pulse" />
      ) : !status ? (
        <p className="text-[11px] font-mono text-slate-500">Account status offline.</p>
      ) : (
        <div className="space-y-3">
          {alert && (
            <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-1.5 text-[11px] font-mono text-red-300 flex items-center gap-2">
              <AlertTriangle size={11} /> Close to breach — protect the account.
            </div>
          )}
          <div className="flex items-end justify-between">
            <span className={`text-2xl font-bold font-mono ${alert ? "text-red-400" : "text-slate-100"}`}>{money(dist)}</span>
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">buffer to breach</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div className="rounded bg-white/5 border border-white/10 px-2 py-1.5">
              <span className="text-slate-500 block">Profit target</span>
              <span className="text-slate-200">{money(status.currentProfit, 0)} / {money(status.profitTarget, 0)}</span>
            </div>
            <div className="rounded bg-white/5 border border-white/10 px-2 py-1.5">
              <span className="text-slate-500 block">Equity floor</span>
              <span className="text-slate-200">{money(status.breachFloorEquity, 0)}</span>
            </div>
          </div>
          {status.updated && (
            <p className="text-[9px] font-mono text-slate-600">synced {new Date(status.updated).toLocaleTimeString()}</p>
          )}
        </div>
      )}
    </Panel>
  );
}

export default function MarketTerminal() {
  const [aiBias, setAiBias] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AI_BIAS_KEY)) || null; } catch { return null; }
  });
  const [biasLoading, setBiasLoading] = useState(false);
  const [biasError, setBiasError] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [series, setSeries] = useState({});
  const [series4h, setSeries4h] = useState({});
  const [seriesDaily, setSeriesDaily] = useState({});
  const [quoteError, setQuoteError] = useState(null);
  const [lastQuoteAt, setLastQuoteAt] = useState(null);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [squawks, setSquawks] = useState([]);
  const [squawkLoading, setSquawkLoading] = useState(false);
  const [now, setNow] = useState(new Date());
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; } catch { return {}; }
  });
  const [alerts, setAlerts] = useState([]);
  const [alertsEnabled, setAlertsEnabled] = useState(() => localStorage.getItem(ALERTS_ENABLED_KEY) === "1");
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState([]);
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }, [notes]);

  const setNote = (symbol, text) => setNotes((prev) => ({ ...prev, [symbol]: text }));

  const loadQuotes = useCallback(async () => {
    setLoadingQuotes(true);
    try {
      await acquireCredits(WATCHLIST.length);
      const data = await fetchQuotes(WATCHLIST.map((w) => w.symbol));
      setQuotes((prev) => ({ ...prev, ...data }));
      setLastQuoteAt(new Date());
      setQuoteError(null);
    } catch (e) {
      setQuoteError(e.message || "Failed to fetch quotes");
    } finally {
      setLoadingQuotes(false);
    }
  }, []);

  const loadSeries = useCallback(async () => {
    for (const w of WATCHLIST) {
      try {
        await acquireCredits(1);
        const candles = await fetchSeries(w.symbol, "1h");
        setSeries((prev) => ({ ...prev, [w.symbol]: candles }));
      } catch {
        // leave stale/absent data for this symbol, move on
      }
    }
  }, []);

  const loadSeries4h = useCallback(async () => {
    for (const w of WATCHLIST) {
      try {
        await acquireCredits(1);
        const candles = await fetchSeries(w.symbol, "4h");
        setSeries4h((prev) => ({ ...prev, [w.symbol]: candles }));
      } catch {
        // leave stale/absent data for this symbol, move on
      }
    }
  }, []);

  const loadSeriesDaily = useCallback(async () => {
    for (const w of WATCHLIST) {
      try {
        await acquireCredits(1);
        const candles = await fetchSeries(w.symbol, "1day");
        setSeriesDaily((prev) => ({ ...prev, [w.symbol]: candles }));
      } catch {
        // leave stale/absent data for this symbol, move on
      }
    }
  }, []);

  useEffect(() => {
    loadQuotes();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadQuotes();
    }, QUOTE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadQuotes]);

  const seriesRef = useRef(series);
  const series4hRef = useRef(series4h);
  const seriesDailyRef = useRef(seriesDaily);
  useEffect(() => { seriesRef.current = series; }, [series]);
  useEffect(() => { series4hRef.current = series4h; }, [series4h]);
  useEffect(() => { seriesDailyRef.current = seriesDaily; }, [seriesDaily]);

  useEffect(() => scheduleAdaptivePoll(
    loadSeries,
    () => WATCHLIST.every((w) => seriesRef.current[w.symbol]),
    SERIES_INTERVAL_MS,
    SERIES_RETRY_MS,
  ), [loadSeries]);

  useEffect(() => scheduleAdaptivePoll(
    loadSeries4h,
    () => WATCHLIST.every((w) => series4hRef.current[w.symbol]),
    SERIES_4H_INTERVAL_MS,
    SERIES_RETRY_MS,
  ), [loadSeries4h]);

  useEffect(() => scheduleAdaptivePoll(
    loadSeriesDaily,
    () => WATCHLIST.every((w) => seriesDailyRef.current[w.symbol]),
    SERIES_DAILY_INTERVAL_MS,
    SERIES_RETRY_MS,
  ), [loadSeriesDaily]);

  // AI-determined bias — sourced from macro sentiment/events, not price, so
  // it can be checked independently against 1H structure. Cached so a page
  // reload doesn't burn a fresh Groq call unless the cache is stale.
  const refreshBias = useCallback(async () => {
    setBiasLoading(true);
    try {
      const macro = await fetchMacroContext();
      const prompt = buildBiasPrompt(macro);
      const res = await fetch(WORKER_URL + "chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: prompt, trades: [], stats: {} }),
      });
      const json = await res.json();
      const parsed = json.success ? parseJsonLoose(json.reply) : null;
      if (!parsed) throw new Error("Could not parse AI bias response");
      const next = { bias: parsed, macro, generatedAt: Date.now() };
      setAiBias(next);
      localStorage.setItem(AI_BIAS_KEY, JSON.stringify(next));
      setBiasError(null);
    } catch (e) {
      setBiasError(e.message || "Failed to refresh AI bias");
    } finally {
      setBiasLoading(false);
    }
  }, []);

  useEffect(() => {
    const stale = !aiBias || Date.now() - aiBias.generatedAt > AI_BIAS_MAX_AGE_MS;
    if (stale) refreshBias();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refreshBias();
    }, AI_BIAS_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const structure = useMemo(() => {
    const out = {};
    WATCHLIST.forEach((w) => {
      const scenario = aiBias?.bias?.[w.biasKey]?.bias || "neutral";
      out[w.symbol] = evaluateScenario(scenario, series[w.symbol]);
    });
    return out;
  }, [aiBias, series]);

  const structure4h = useMemo(() => {
    const out = {};
    WATCHLIST.forEach((w) => { out[w.symbol] = trendOf(series4h[w.symbol]); });
    return out;
  }, [series4h]);

  const structureDaily = useMemo(() => {
    const out = {};
    WATCHLIST.forEach((w) => { out[w.symbol] = trendOf(seriesDaily[w.symbol]); });
    return out;
  }, [seriesDaily]);

  // Alerts: fire only on a status *change* (validated/invalidated), never on
  // initial load, so opening the page doesn't spam five alerts at once.
  const prevStatusRef = useRef({});
  useEffect(() => {
    const prev = prevStatusRef.current;
    const fresh = [];
    WATCHLIST.forEach((w) => {
      const cur = structure[w.symbol]?.status;
      const before = prev[w.symbol];
      if (before && cur && before !== cur && (cur === "validated" || cur === "invalidated")) {
        fresh.push({
          id: `${w.symbol}-${Date.now()}`,
          time: new Date(),
          level: cur,
          text: `${w.label}: structure just ${cur === "validated" ? "confirmed" : "broke against"} the AI bias.`,
        });
      }
    });
    if (fresh.length) {
      setAlerts((prevAlerts) => [...fresh, ...prevAlerts].slice(0, 30));
      if (alertsEnabled) {
        if ("Notification" in window && Notification.permission === "granted") {
          fresh.forEach((a) => new Notification("Market Command Desk", { body: a.text }));
        }
        playBeep();
      }
    }
    const next = {};
    WATCHLIST.forEach((w) => { next[w.symbol] = structure[w.symbol]?.status; });
    prevStatusRef.current = next;
  }, [structure, alertsEnabled]);

  const toggleAlerts = useCallback(async () => {
    if (!alertsEnabled) {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      setAlertsEnabled(true);
      localStorage.setItem(ALERTS_ENABLED_KEY, "1");
    } else {
      setAlertsEnabled(false);
      localStorage.setItem(ALERTS_ENABLED_KEY, "0");
    }
  }, [alertsEnabled]);

  // Refs so the squawk timer stays stable and always reads fresh state.
  const quotesRef = useRef(quotes);
  const structureRef = useRef(structure);
  const aiBiasRef = useRef(aiBias);
  useEffect(() => { quotesRef.current = quotes; }, [quotes]);
  useEffect(() => { structureRef.current = structure; }, [structure]);
  useEffect(() => { aiBiasRef.current = aiBias; }, [aiBias]);

  const generateSquawk = useCallback(async () => {
    setSquawkLoading(true);
    try {
      const prompt = buildSquawkPrompt(quotesRef.current, structureRef.current, aiBiasRef.current);
      const res = await fetch(WORKER_URL + "chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: prompt, trades: [], stats: {} }),
      });
      const json = await res.json();
      if (json.success && json.reply) {
        setSquawks((prev) => [{ id: Date.now(), time: new Date(), text: json.reply.trim() }, ...prev].slice(0, 25));
      }
    } catch {
      // stay silent — feed just won't get a new line this cycle
    } finally {
      setSquawkLoading(false);
    }
  }, []);

  const squawkStarted = useRef(false);
  useEffect(() => {
    if (Object.keys(quotes).length === 0 || squawkStarted.current) return;
    squawkStarted.current = true;
    generateSquawk();
  }, [quotes, generateSquawk]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") generateSquawk();
    }, SQUAWK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [generateSquawk]);

  const handleLookupSearch = useCallback(async (e) => {
    e.preventDefault();
    if (!lookupQuery.trim()) return;
    setLookupLoading(true);
    setLookupResults([]);
    try {
      const results = await searchSymbols(lookupQuery.trim());
      setLookupResults(results);
    } catch (e) {
      setLookupResult({ symbol: lookupQuery.trim(), error: e.message || "Search failed" });
    } finally {
      setLookupLoading(false);
    }
  }, [lookupQuery]);

  const handleLookupSelect = useCallback(async (result) => {
    setLookupResults([]);
    setLookupLoading(true);
    try {
      await acquireCredits(1);
      const quote = await fetchQuote(result.symbol);
      setLookupResult({ symbol: result.symbol, name: result.instrument_name, quote });
    } catch (e) {
      setLookupResult({ symbol: result.symbol, error: e.message || "Quote lookup failed" });
    } finally {
      setLookupLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#05070a] text-slate-200 font-mono">
      <TickerTape quotes={quotes} />
      <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-6">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-amber-500/80 mb-1 [text-shadow:0_0_10px_rgba(245,158,11,0.4)]">
              Latrell's Terminal
            </p>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-100">Market Command Desk</h1>
            <p className="mt-1 text-[11px] text-slate-500">
              {lastQuoteAt ? `Quotes updated ${lastQuoteAt.toLocaleTimeString()}` : "Loading quotes…"}
              {quoteError && <span className="text-rose-400 ml-2">· {quoteError}</span>}
              {biasError && <span className="text-rose-400 ml-2">· AI bias: {biasError}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CommandBar
              query={lookupQuery}
              onQueryChange={setLookupQuery}
              onSearch={handleLookupSearch}
              results={lookupResults}
              onSelect={handleLookupSelect}
              loading={lookupLoading}
            />
            <button
              onClick={() => { loadQuotes(); loadSeries(); }}
              className="flex items-center gap-2 text-[11px] px-3 py-2 rounded border border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-colors"
            >
              <RefreshCw size={12} className={loadingQuotes ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </header>

        {lookupResult && <LookupCard result={lookupResult} onDismiss={() => setLookupResult(null)} />}

        <MacroStrip macro={aiBias?.macro} generatedAt={aiBias?.generatedAt} loading={biasLoading} onRefresh={refreshBias} />

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-white/10 pb-2">Scenario Desk</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {WATCHLIST.map((item) => (
                <ScenarioCard
                  key={item.symbol}
                  item={item}
                  quote={quotes[item.symbol]}
                  candles={series[item.symbol]}
                  evalResult={structure[item.symbol]}
                  biasEntry={aiBias?.bias?.[item.biasKey]}
                  biasLoading={biasLoading}
                  h4Trend={structure4h[item.symbol]}
                  dailyTrend={structureDaily[item.symbol]}
                  note={notes[item.symbol] || ""}
                  onNoteChange={(text) => setNote(item.symbol, text)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-white/10 pb-2">Market Intel</p>
            <div className="space-y-6">
              <AccountRiskPanel />
              <CurrencyStrengthMeter quotes={quotes} />
              <SituationalAwareness now={now} structure={structure} aiBias={aiBias} />
              <AlertsPanel alerts={alerts} enabled={alertsEnabled} onToggle={toggleAlerts} />
              <SquawkFeed squawks={squawks} loading={squawkLoading} onRefresh={generateSquawk} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
