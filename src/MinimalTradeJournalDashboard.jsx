import React, { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from "recharts";
import {
  Activity, Target, TrendingUp, Layers, RefreshCw,
  DollarSign, Zap, AlertTriangle, Trophy, Edit2, Check,
  Globe, AlertCircle, X
} from "lucide-react";

const WORKER_URL = "https://noisy-rain-e6aftest.indersonlatrell7.workers.dev/";
const PAYOUT_KEY = "myjournal_payout_target";
const RULES_KEY   = "myjournal_rules";
const GOALS_KEY    = "myjournal_goals";
const SECTIONS_KEY = "myjournal_sections";

const RANGES = [
  { label: "7D",  value: "7d"  },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "YTD", value: "ytd" },
];

const ACCOUNTS = [
  { label: "Funded", value: "funded" },
  { label: "Other",  value: "other"  },
];

const INSIGHT_STYLES = {
  psychology: { bg: "bg-amber-50",   border: "border-amber-400",   text: "text-amber-800"   },
  execution:  { bg: "bg-blue-50",    border: "border-blue-400",    text: "text-blue-800"    },
  confidence: { bg: "bg-emerald-50", border: "border-emerald-400", text: "text-emerald-800" },
  review:     { bg: "bg-slate-50",   border: "border-slate-300",   text: "text-slate-700"   },
};

// ─── Helpers ───────────────────────────────────────────────────────────────
function buildEquityCurve(trades) {
  let equity = 0;
  return [...trades]
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
    .map((t, i) => {
      equity += typeof t.r === "number" ? t.r : 0;
      const d = t.date ? new Date(t.date) : null;
      return {
        label: d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : `#${i + 1}`,
        equity: Number(equity.toFixed(2)),
      };
    });
}

function fmt(n, d = 2) { return Number(n).toFixed(d); }
function signedR(n) { return (n >= 0 ? "+" : "") + fmt(n) + "R"; }
function signedUSD(n) { return (n >= 0 ? "+$" : "-$") + Math.abs(n).toFixed(2); }

function calcStreak(trades) {
  if (!trades || !trades.length) return { current: 0, type: null, longest: 0 };
  const sorted = [...trades].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  let current = 1;
  const last = sorted[sorted.length - 1].win;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i].win === last) current++;
    else break;
  }
  let longest = 0, run = 0;
  for (const t of sorted) {
    if (t.win) { run++; longest = Math.max(longest, run); }
    else run = 0;
  }
  return { current, type: last ? "win" : "loss", longest };
}

function buildWeeklyGrid(trades) {
  if (!trades || !trades.length) return [];
  const weeks = {};
  for (const t of trades) {
    if (!t.date) continue;
    const d = new Date(t.date);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().split("T")[0];
    if (!weeks[key]) weeks[key] = { monday, trades: 0, wins: 0, losses: 0, totalR: 0, pnl: 0, days: {} };
    weeks[key].trades++;
    weeks[key].totalR += typeof t.r === "number" ? t.r : 0;
    weeks[key].pnl += typeof t.pnl === "number" ? t.pnl : 0;
    if (t.win) weeks[key].wins++; else weeks[key].losses++;
    const dayIdx = day === 0 ? 6 : day - 1;
    if (!weeks[key].days[dayIdx]) weeks[key].days[dayIdx] = { r: 0, trades: 0 };
    weeks[key].days[dayIdx].r += typeof t.r === "number" ? t.r : 0;
    weeks[key].days[dayIdx].trades++;
  }
  return Object.values(weeks)
    .sort((a, b) => b.monday - a.monday)
    .map(w => ({
      ...w,
      totalR: Number(w.totalR.toFixed(2)),
      pnl: Number(w.pnl.toFixed(2)),
      winRate: w.trades ? Math.round((w.wins / w.trades) * 100) : 0,
      label: w.monday.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    }));
}

// ─── Trade Quality ─────────────────────────────────────────────────────────
function buildQualityStats(trades) {
  if (!trades || !trades.length) return null;
  const good = trades.filter(t => t.tradeQuality === "GOOD TRADE");
  const bad  = trades.filter(t => t.tradeQuality === "BAD TRADE");
  const untagged = trades.filter(t => !t.tradeQuality || (t.tradeQuality !== "GOOD TRADE" && t.tradeQuality !== "BAD TRADE"));

  function stats(arr) {
    if (!arr.length) return { count: 0, winRate: 0, avgR: 0, totalPnl: 0 };
    const wins = arr.filter(t => t.win).length;
    const totalR = arr.reduce((s, t) => s + (typeof t.r === "number" ? t.r : 0), 0);
    const totalPnl = arr.reduce((s, t) => s + (typeof t.pnl === "number" ? t.pnl : 0), 0);
    return {
      count: arr.length,
      winRate: Math.round((wins / arr.length) * 100),
      avgR: Number((totalR / arr.length).toFixed(2)),
      totalPnl: Number(totalPnl.toFixed(2)),
    };
  }

  return {
    good: stats(good),
    bad:  stats(bad),
    untagged: stats(untagged),
    qualityRate: trades.length ? Math.round((good.length / trades.length) * 100) : 0,
  };
}

// ─── Monthly P&L ───────────────────────────────────────────────────────────
function buildMonthlyPnl(trades) {
  if (!trades || !trades.length) return [];
  const months = {};
  for (const t of trades) {
    if (!t.date) continue;
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    if (!months[key]) months[key] = { key, label, pnl: 0, r: 0, trades: 0, wins: 0 };
    months[key].pnl += typeof t.pnl === "number" ? t.pnl : 0;
    months[key].r   += typeof t.r  === "number" ? t.r  : 0;
    months[key].trades++;
    if (t.win) months[key].wins++;
  }
  return Object.values(months)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(m => ({
      ...m,
      pnl: Number(m.pnl.toFixed(2)),
      r:   Number(m.r.toFixed(2)),
      winRate: m.trades ? Math.round((m.wins / m.trades) * 100) : 0,
    }));
}

// ─── Day Analysis ──────────────────────────────────────────────────────────
function buildDayStats(trades) {
  if (!trades || !trades.length) return null;
  const buckets = { Green: [], Red: [] };
  for (const t of trades) {
    const d = t.day;
    if (d === "Green" || d === "Red") buckets[d].push(t);
  }
  function stats(arr) {
    if (!arr.length) return { count: 0, winRate: 0, avgR: 0, pnl: 0 };
    const wins = arr.filter(t => t.win).length;
    const totalR = arr.reduce((s, t) => s + (typeof t.r === "number" ? t.r : 0), 0);
    const pnl = arr.reduce((s, t) => s + (typeof t.pnl === "number" ? t.pnl : 0), 0);
    return { count: arr.length, winRate: Math.round((wins / arr.length) * 100), avgR: Number((totalR / arr.length).toFixed(2)), pnl: Number(pnl.toFixed(2)) };
  }
  return { green: stats(buckets.Green), red: stats(buckets.Red) };
}

// ─── Confluence Analysis ────────────────────────────────────────────────────
function buildConfluenceStats(trades) {
  if (!trades || !trades.length) return [];
  const map = {};
  for (const t of trades) {
    for (const c of (t.confluences || [])) {
      if (!map[c]) map[c] = { name: c, count: 0, wins: 0, totalR: 0 };
      map[c].count++;
      if (t.win) map[c].wins++;
      map[c].totalR += typeof t.r === "number" ? t.r : 0;
    }
  }
  return Object.values(map)
    .map(c => {
      const wr = c.wins / c.count;
      const avgR = Number((c.totalR / c.count).toFixed(2));
      const expectancy = Number(((wr * Math.max(0, avgR)) - ((1 - wr) * Math.abs(Math.min(0, avgR)))).toFixed(2));
      return { ...c, winRate: Math.round(wr * 100), avgR, totalR: Number(c.totalR.toFixed(2)), expectancy };
    })
    .sort((a, b) => b.expectancy - a.expectancy || b.count - a.count)
    .slice(0, 10);
}

// ─── Mistakes Analysis ──────────────────────────────────────────────────────
function buildMistakes(trades) {
  if (!trades || !trades.length) return [];
  return trades
    .filter(t => t.mistakes && t.mistakes.trim().length > 0)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 12)
    .map(t => ({
      date: t.date ? new Date(t.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—",
      mistake: t.mistakes.trim(),
      win: t.win,
      pair: t.pair || "—",
      r: typeof t.r === "number" ? t.r : 0,
    }));
}

// ─── Macro AI fetch ────────────────────────────────────────────────────────
async function fetchMacroIntel() {
  const res = await fetch(WORKER_URL + "macro");
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Macro fetch failed");
  return data;
}

// ─── Macro Panel ───────────────────────────────────────────────────────────
// ─── Collapsible Section ───────────────────────────────────────────────────
function Section({ id, title, subtitle, icon, children, openSections, toggleSection }) {
  const isOpen = openSections[id] !== false;
  return (
    <div className="space-y-4">
      <button
        onClick={() => toggleSection(id)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{icon}</span>
          <div className="text-left">
            <p className="text-sm font-bold tracking-tight text-slate-900 group-hover:text-slate-700 transition-colors">{title}</p>
            {subtitle && <p className="text-[10px] font-mono text-slate-400">{subtitle}</p>}
          </div>
        </div>
        <div className={`w-6 h-6 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
      {isOpen && <div className="space-y-4">{children}</div>}
    </div>
  );
}

// ─── Inline AI Insight ─────────────────────────────────────────────────────
function InlineInsight({ prompt, trades, stats, color = "blue" }) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);

  const colors = {
    blue:    { bg: "bg-blue-50",    border: "border-blue-200",    text: "text-blue-700",    dot: "bg-blue-400"    },
    emerald: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-400" },
    amber:   { bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-700",   dot: "bg-amber-400"   },
  };
  const c = colors[color] || colors.blue;

  useEffect(() => {
    if (!trades || trades.length === 0) return;
    let cancelled = false;
    setLoading(true);
    fetch(WORKER_URL + "chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: prompt, trades, stats }),
    })
      .then(r => r.json())
      .then(json => { if (!cancelled && json.success) setInsight(json.reply); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [trades?.length]);

  if (loading) return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
      <div className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-pulse" />
      <div className="h-3 bg-slate-100 rounded animate-pulse w-48" />
    </div>
  );
  if (!insight) return null;

  return (
    <div className={`mt-3 pt-3 border-t border-slate-100 flex items-start gap-2 rounded-xl px-3 py-2 ${c.bg} border ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${c.dot}`} />
      <p className={`text-[11px] font-mono leading-relaxed ${c.text}`}>{insight}</p>
    </div>
  );
}

function MacroPanel({ macro, macroLoading, macroError, onRefresh }) {
  const sentimentColors = {
    "risk-on":  { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
    "risk-off": { bg: "bg-red-50",     border: "border-red-200",     text: "text-red-700",     dot: "bg-red-500"     },
    "neutral":  { bg: "bg-slate-50",   border: "border-slate-200",   text: "text-slate-600",   dot: "bg-slate-400"   },
  };
  const sc = sentimentColors[macro?.sentiment] || sentimentColors.neutral;
  const impactColors = { high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700" };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Globe size={14} className="text-blue-500" />
          Macro Environment
        </h2>
        <button onClick={onRefresh}
          className="text-[10px] font-mono text-slate-400 hover:text-slate-700 flex items-center gap-1 transition-colors">
          <RefreshCw size={10} className={macroLoading ? "animate-spin" : ""} />
          refresh
        </button>
      </div>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Live sentiment + upcoming events · powered by AI</p>

      {macroLoading ? (
        <div className="space-y-3">
          <div className="h-12 bg-slate-50 rounded-xl animate-pulse" />
          <div className="h-20 bg-slate-50 rounded-xl animate-pulse" />
          <div className="h-10 bg-slate-50 rounded-xl animate-pulse" />
        </div>
      ) : macroError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-mono text-red-600">
          {macroError}
        </div>
      ) : macro ? (
        <div className="space-y-3">
          {/* Sentiment + Fear & Greed */}
          <div className={`rounded-xl border px-4 py-3 ${sc.bg} ${sc.border}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
                <p className={`text-xs font-semibold capitalize ${sc.text}`}>{macro.sentiment}</p>
              </div>
              {macro.fearGreed && (
                <span className="text-[10px] font-mono text-slate-500">
                  F&G: {macro.fearGreed.score} · {macro.fearGreed.rating}
                </span>
              )}
            </div>
            <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
              {macro.fearGreed
                ? `CNN Fear & Greed index at ${macro.fearGreed.score}/100 (${macro.fearGreed.rating}).`
                : "Based on current market conditions."}
            </p>
          </div>

          {/* Upcoming events */}
          {macro.events?.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">High-impact events</p>
              {macro.events.map((ev, i) => (
                <div key={i} className={`flex items-start justify-between gap-2 rounded-lg px-3 py-2 ${ev.isToday ? "bg-red-50 border border-red-100" : "bg-slate-50"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded font-semibold bg-red-100 text-red-700">HIGH</span>
                      <span className="text-[9px] font-mono text-slate-400">{ev.currency}</span>
                      {ev.isToday && <span className="text-[9px] font-mono text-red-600 font-semibold">TODAY</span>}
                    </div>
                    <p className="text-[11px] font-medium text-slate-800 truncate">{ev.name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] font-mono text-slate-400">{ev.date}</p>
                    <p className="text-[10px] font-mono text-slate-400">{ev.time}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
              <p className="text-[11px] font-mono text-emerald-700">No high-impact events in the next 4 days. Clean macro backdrop.</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Warning Banner ────────────────────────────────────────────────────────
function MacroWarningBanner({ warning, onDismiss }) {
  if (!warning) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start justify-between gap-3"
      >
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-700 mb-0.5">High-Impact Event Today</p>
            <p className="text-xs font-mono text-red-600">{warning}</p>
          </div>
        </div>
        <button onClick={onDismiss} className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0">
          <X size={14} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Payout Tracker ────────────────────────────────────────────────────────
function PayoutTracker({ netPnl, loading }) {
  const [target, setTarget] = useState(() => {
    const saved = localStorage.getItem(PAYOUT_KEY);
    return saved ? Number(saved) : 0;
  });
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");

  function saveTarget() {
    const n = parseFloat(inputVal);
    if (!isNaN(n) && n > 0) {
      setTarget(n);
      localStorage.setItem(PAYOUT_KEY, String(n));
    }
    setEditing(false);
  }

  const progress = target > 0 ? Math.min(100, Math.max(0, (netPnl / target) * 100)) : 0;
  const remaining = target > 0 ? Math.max(0, target - netPnl) : 0;
  const achieved = netPnl >= target && target > 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Trophy size={14} className="text-amber-500" />
          Payout Tracker
        </h2>
        <button onClick={() => { setEditing(true); setInputVal(target ? String(target) : ""); }}
          className="flex items-center gap-1 text-[10px] font-mono text-slate-400 hover:text-slate-700 transition-colors">
          <Edit2 size={10} />
          {target > 0 ? "Edit target" : "Set target"}
        </button>
      </div>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Funded account payout goal</p>

      {editing ? (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-mono text-slate-500">$</span>
          <input autoFocus type="number" value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && saveTarget()}
            placeholder="e.g. 1000"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-slate-400" />
          <button onClick={saveTarget} className="bg-slate-950 text-white rounded-lg px-3 py-2">
            <Check size={14} />
          </button>
        </div>
      ) : target === 0 ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 mb-4">
          <p className="text-xs font-mono text-slate-400">Click "Set target" above to track progress toward your payout.</p>
        </div>
      ) : null}

      {target > 0 && !editing && (
        <>
          {achieved && (
            <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2 text-xs font-mono text-emerald-700 flex items-center gap-2">
              <Trophy size={12} className="text-emerald-500" />
              Payout target reached! Request your payout.
            </div>
          )}
          <div className="flex items-end justify-between mb-2">
            {loading ? <div className="h-6 w-24 bg-slate-100 rounded animate-pulse" /> : (
              <p className={`text-2xl font-bold font-mono ${netPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {signedUSD(netPnl)}
              </p>
            )}
            <p className="text-xs font-mono text-slate-400">of ${fmt(target, 0)} target</p>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
            <div className={`h-full rounded-full transition-all duration-500 ${achieved ? "bg-emerald-500" : "bg-amber-400"}`}
              style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-slate-400">
            <span>{fmt(progress, 1)}% complete</span>
            {!achieved && <span>${fmt(remaining, 2)} remaining</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Weekly Calendar ───────────────────────────────────────────────────────
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function WeeklyCalendar({ trades, loading }) {
  const weeks = useMemo(() => buildWeeklyGrid(trades || []), [trades]);
  if (loading) return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold mb-1">Weekly Summary</h2>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Performance by week</p>
      <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />)}</div>
    </div>
  );
  if (!weeks.length) return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold mb-1">Weekly Summary</h2>
      <p className="text-[10px] font-mono text-slate-400">No data for this range.</p>
    </div>
  );
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold mb-1">Weekly Summary</h2>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Each cell = R for that day · green = profit · red = loss · grey = no trades</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th className="pb-2 pr-3 text-[9px] font-mono uppercase tracking-widest text-slate-400 font-normal whitespace-nowrap">Week of</th>
              {DAY_LABELS.map(d => (
                <th key={d} className="pb-2 px-1 text-[9px] font-mono uppercase tracking-widest text-slate-400 font-normal text-center">{d}</th>
              ))}
              <th className="pb-2 pl-3 text-[9px] font-mono uppercase tracking-widest text-slate-400 font-normal text-right">Total</th>
              <th className="pb-2 pl-2 text-[9px] font-mono uppercase tracking-widest text-slate-400 font-normal text-right">P&L</th>
              <th className="pb-2 pl-2 text-[9px] font-mono uppercase tracking-widest text-slate-400 font-normal text-right">WR</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi} className="border-t border-slate-100">
                <td className="py-2 pr-3 text-[10px] font-mono text-slate-500 whitespace-nowrap">{week.label}</td>
                {[0,1,2,3,4].map(dayIdx => {
                  const day = week.days[dayIdx];
                  const r = day ? day.r : null;
                  const hasData = day && day.trades > 0;
                  return (
                    <td key={dayIdx} className="py-2 px-1 text-center">
                      <div className={`inline-flex items-center justify-center w-12 h-8 rounded-lg text-[10px] font-mono font-semibold
                        ${!hasData ? "bg-slate-50 text-slate-300" : r > 0 ? "bg-emerald-50 text-emerald-700" : r < 0 ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}`}>
                        {hasData ? (r >= 0 ? "+" : "") + fmt(r, 1) + "R" : "—"}
                      </div>
                    </td>
                  );
                })}
                <td className={`py-2 pl-3 text-[10px] font-mono font-semibold text-right ${week.totalR >= 0 ? "text-emerald-600" : "text-red-500"}`}>{signedR(week.totalR)}</td>
                <td className={`py-2 pl-2 text-[10px] font-mono text-right ${week.pnl >= 0 ? "text-emerald-500" : "text-red-400"}`}>{week.pnl !== 0 ? signedUSD(week.pnl) : "—"}</td>
                <td className="py-2 pl-2 text-[10px] font-mono text-slate-400 text-right">{week.trades > 0 ? week.winRate + "%" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Metric Card ───────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, positive, icon: Icon, loading, warning }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-white border shadow-sm p-5
      ${warning ? "border-red-300" : positive === true ? "border-emerald-200" : positive === false ? "border-red-200" : "border-slate-200"}`}>
      <div className={`absolute top-0 left-0 right-0 h-0.5
        ${warning ? "bg-red-500" : positive === true ? "bg-emerald-400" : positive === false ? "bg-red-400" : "bg-slate-200"}`} />
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-mono uppercase tracking-widest text-slate-400">{label}</p>
        <div className={`rounded-lg p-1.5 ${warning ? "bg-red-50 text-red-500" : "bg-slate-100 text-slate-500"}`}><Icon size={14} /></div>
      </div>
      {loading ? <div className="h-7 w-3/4 bg-slate-100 rounded animate-pulse" /> : (
        <p className={`text-2xl font-bold tracking-tight font-mono
          ${warning ? "text-red-500" : positive === true ? "text-emerald-600" : positive === false ? "text-red-500" : "text-slate-900"}`}>{value}</p>
      )}
      <p className="mt-2 text-xs text-slate-400 font-mono">{sub}</p>
      {warning && (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-red-500">
          <AlertTriangle size={10} />{warning}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight }) {
  const style = INSIGHT_STYLES[insight.type] || INSIGHT_STYLES.review;
  return (
    <div className={`rounded-xl border-l-4 px-4 py-3 ${style.bg} ${style.border}`}>
      <p className={`text-xs font-semibold mb-1 ${style.text}`}>{insight.title}</p>
      <p className="text-xs text-slate-500 leading-relaxed font-mono">{insight.message}</p>
    </div>
  );
}

function SetupRow({ setup }) {
  const pos = setup.totalR >= 0;
  const wr = setup.winRate / 100;
  const expectancy = Number(((wr * Math.max(0, setup.avgR)) - ((1 - wr) * Math.abs(Math.min(0, setup.avgR)))).toFixed(2));
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-900">{setup.setup}</p>
        <p className="text-xs text-slate-400 font-mono mt-0.5">{setup.trades} trades</p>
        <div className="mt-1.5 w-16 h-1 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${setup.winRate}%` }} />
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-mono font-semibold ${pos ? "text-emerald-600" : "text-red-500"}`}>{signedR(setup.totalR)}</p>
        <p className="text-xs text-slate-400 font-mono">{setup.winRate}% WR · avg {signedR(setup.avgR)}</p>
        <p className={`text-xs font-mono font-semibold ${expectancy >= 0 ? "text-blue-600" : "text-red-400"}`}>E: {signedR(expectancy)}</p>
      </div>
    </div>
  );
}

function TradeRow({ trade }) {
  const r = typeof trade.r === "number" ? trade.r : 0;
  const pnl = typeof trade.pnl === "number" ? trade.pnl : 0;
  const dateStr = trade.date ? new Date(trade.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—";
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      <td className="py-2.5 px-3 text-xs font-mono text-slate-500">{dateStr}</td>
      <td className="py-2.5 px-3 text-xs font-medium">{trade.pair || "—"}</td>
      <td className="py-2.5 px-3 text-xs text-slate-600">{trade.setup || "—"}</td>
      <td className="py-2.5 px-3">
        <span className={`inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full
          ${trade.win ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {trade.win ? "WIN" : "LOSS"}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-500">{trade.session || "—"}</td>
      <td className="py-2.5 px-3 text-right">
        <p className={`text-xs font-mono font-semibold ${r >= 0 ? "text-emerald-600" : "text-red-500"}`}>{signedR(r)}</p>
        {pnl !== 0 && <p className={`text-[10px] font-mono ${pnl >= 0 ? "text-emerald-500" : "text-red-400"}`}>{signedUSD(pnl)}</p>}
      </td>
    </tr>
  );
}

function EquityTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div className="bg-slate-900 text-white text-xs font-mono rounded-lg px-3 py-2 shadow-xl">
      <p className="text-slate-400 mb-0.5">{label}</p>
      <p className={val >= 0 ? "text-emerald-400" : "text-red-400"}>{signedR(val)}</p>
    </div>
  );
}

function SetupTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white text-xs font-mono rounded-lg px-3 py-2 shadow-xl">
      <p className="text-slate-400 mb-0.5">{label}</p>
      <p className="text-white">{payload[0].value}% win rate</p>
    </div>
  );
}

// ─── Day Analysis Panel ────────────────────────────────────────────────────
function DayAnalysisPanel({ trades, loading }) {
  const stats = buildDayStats(trades || []);
  const days = [
    { key: "green", label: "Green Day", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
    { key: "red",   label: "Red Day",   bg: "bg-red-50",     border: "border-red-200",     text: "text-red-600",   dot: "bg-red-500"     },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold mb-1">Day Analysis</h2>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Green vs Red day performance</p>
      {loading ? (
        <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 bg-slate-50 rounded-xl animate-pulse" />)}</div>
      ) : !stats || (stats.green.count + stats.red.count === 0) ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-xs font-mono text-slate-400">Tag your trades as Green or Red day in Notion to unlock this panel.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {days.map(({ key, label, bg, border, text, dot }) => {
            const s = stats[key];
            if (s.count === 0) return null;
            return (
              <div key={key} className={`rounded-xl border px-4 py-3 ${bg} ${border}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2 h-2 rounded-full ${dot}`} />
                  <span className={`text-xs font-semibold ${text}`}>{label}</span>
                  <span className={`ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full bg-white ${text}`}>{s.count} trades</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider mb-0.5">Win Rate</p>
                    <p className={`text-sm font-mono font-bold ${text}`}>{s.winRate}%</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider mb-0.5">Avg R</p>
                    <p className={`text-sm font-mono font-bold ${text}`}>{signedR(s.avgR)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider mb-0.5">P&L</p>
                    <p className={`text-sm font-mono font-bold ${text}`}>{signedUSD(s.pnl)}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {/* Insight */}
          {stats.green.count > 0 && stats.red.count > 0 && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
              <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
                {stats.green.winRate > stats.red.winRate
                  ? `You win ${stats.green.winRate - stats.red.winRate}% more on Green days. Prioritise Green days for higher size.`
                  : stats.red.winRate > stats.green.winRate
                  ? `Interestingly your Red day win rate is higher. Review what changes on Green days.`
                  : `Similar performance on both day types.`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Confluence Panel ───────────────────────────────────────────────────────
function ConfluencePanel({ trades, loading }) {
  const confluences = buildConfluenceStats(trades || []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold mb-1">Confluence Breakdown</h2>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Which confluences correlate with wins</p>
      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-10 bg-slate-50 rounded-lg animate-pulse" />)}</div>
      ) : confluences.length === 0 ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-xs font-mono text-slate-400">Add confluences to your trades in Notion to unlock this breakdown.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {confluences.map((c, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-slate-800 truncate">{c.name}</p>
                  <span className="text-[10px] font-mono text-slate-400 ml-2 flex-shrink-0">{c.count}x</span>
                </div>
                {/* Win rate bar */}
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${c.winRate >= 60 ? "bg-emerald-500" : c.winRate >= 40 ? "bg-amber-400" : "bg-red-400"}`}
                    style={{ width: `${c.winRate}%` }}
                  />
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-xs font-mono font-semibold ${c.winRate >= 50 ? "text-emerald-600" : "text-red-500"}`}>{c.winRate}% WR</p>
                <p className="text-[10px] font-mono text-slate-400">avg {signedR(c.avgR)}</p>
                <p className={`text-[10px] font-mono font-semibold ${c.expectancy >= 0 ? "text-blue-600" : "text-red-400"}`}>E: {signedR(c.expectancy)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mistakes Panel ─────────────────────────────────────────────────────────
function MistakesPanel({ trades, loading }) {
  const mistakes = buildMistakes(trades || []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold mb-1">Mistakes Review</h2>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Your recent journal notes on execution errors</p>
      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />)}</div>
      ) : mistakes.length === 0 ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-xs font-mono text-slate-400">Fill in the Mistakes review field in Notion to track execution errors here.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {mistakes.map((m, i) => (
            <div key={i} className={`rounded-xl border-l-4 px-3 py-2.5 ${m.win ? "bg-slate-50 border-slate-300" : "bg-red-50 border-red-300"}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400">{m.date}</span>
                  <span className="text-[10px] font-mono text-slate-400">{m.pair}</span>
                  <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-full
                    ${m.win ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                    {m.win ? "WIN" : "LOSS"}
                  </span>
                </div>
                <span className={`text-[10px] font-mono font-semibold ${m.r >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {signedR(m.r)}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{m.mistake}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Trade Quality Panel ───────────────────────────────────────────────────
function TradeQualityPanel({ trades, loading }) {
  const stats = buildQualityStats(trades || []);

  const rows = [
    { label: "Good trades", key: "good",     color: "emerald" },
    { label: "Bad trades",  key: "bad",      color: "red"     },
    { label: "Untagged",    key: "untagged", color: "slate"   },
  ];

  const colorMap = {
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700" },
    red:     { bg: "bg-red-50",     text: "text-red-600",     bar: "bg-red-400",     badge: "bg-red-100 text-red-600"         },
    slate:   { bg: "bg-slate-50",   text: "text-slate-500",   bar: "bg-slate-300",   badge: "bg-slate-100 text-slate-500"     },
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold mb-1">Trade Quality Score</h2>
      <p className="text-[10px] font-mono text-slate-400 mb-4">
        Based on your GOOD / BAD tags in Notion
      </p>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />)}</div>
      ) : !stats || stats.good.count + stats.bad.count === 0 ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-xs font-mono text-slate-400">Tag your trades as GOOD or BAD in Notion to unlock quality tracking.</p>
        </div>
      ) : (
        <>
          {/* Quality rate */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-2xl font-bold font-mono text-emerald-600">{stats.qualityRate}%</p>
              <p className="text-[10px] font-mono text-slate-400">of trades are good quality</p>
            </div>
            <div className="w-20 h-20 relative flex items-center justify-center">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#16a34a" strokeWidth="3"
                  strokeDasharray={`${stats.qualityRate} ${100 - stats.qualityRate}`}
                  strokeLinecap="round" />
              </svg>
              <span className="absolute text-xs font-mono font-bold text-slate-700">{stats.qualityRate}%</span>
            </div>
          </div>

          {/* Rows */}
          <div className="space-y-3">
            {rows.map(({ label, key, color }) => {
              const s = stats[key];
              const c = colorMap[color];
              if (s.count === 0) return null;
              return (
                <div key={key} className={`rounded-xl px-4 py-3 ${c.bg}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold ${c.text}`}>{label}</span>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${c.badge}`}>{s.count} trades</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <div>
                      <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Win Rate</p>
                      <p className={`text-sm font-mono font-semibold ${c.text}`}>{s.winRate}%</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Avg R</p>
                      <p className={`text-sm font-mono font-semibold ${c.text}`}>{signedR(s.avgR)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">P&L</p>
                      <p className={`text-sm font-mono font-semibold ${c.text}`}>{signedUSD(s.totalPnl)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Monthly P&L Chart ─────────────────────────────────────────────────────
function MonthlyPnlChart({ trades, loading }) {
  const months = buildMonthlyPnl(trades || []);

  function MonthTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    const val = payload[0].value;
    return (
      <div className="bg-slate-900 text-white text-xs font-mono rounded-lg px-3 py-2 shadow-xl">
        <p className="text-slate-400 mb-0.5">{label}</p>
        <p className={val >= 0 ? "text-emerald-400" : "text-red-400"}>{signedUSD(val)}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 className="text-sm font-semibold mb-1">Monthly P&L</h2>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Net dollar profit per month</p>

      {loading ? (
        <div className="h-56 bg-slate-50 rounded-xl animate-pulse" />
      ) : months.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs font-mono text-slate-400">No data for this range.</div>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                  tickFormatter={v => "$" + (Math.abs(v) >= 1000 ? (v/1000).toFixed(1) + "k" : v)} width={48} />
                <Tooltip content={<MonthTooltip />} />
                <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                  {months.map((m, i) => (
                    <Cell key={i} fill={m.pnl >= 0 ? "rgba(22,163,74,0.75)" : "rgba(220,38,38,0.7)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly summary row */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {months.slice(-3).map((m, i) => (
              <div key={i} className={`rounded-xl px-3 py-2 ${m.pnl >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
                <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider mb-1">{m.label}</p>
                <p className={`text-sm font-mono font-semibold ${m.pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>{signedUSD(m.pnl)}</p>
                <p className="text-[10px] font-mono text-slate-400">{m.winRate}% WR · {m.trades}T</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


// ─── Trading Rules Panel ────────────────────────────────────────────────────
function RulesPanel({ trades }) {
  const [rules, setRules] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RULES_KEY) || "[]"); }
    catch { return []; }
  });
  const [input, setInput] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editVal, setEditVal] = useState("");

  function saveRules(updated) {
    setRules(updated);
    localStorage.setItem(RULES_KEY, JSON.stringify(updated));
  }

  function addRule() {
    const trimmed = input.trim();
    if (!trimmed) return;
    saveRules([...rules, { text: trimmed, violations: 0 }]);
    setInput("");
  }

  function deleteRule(i) {
    saveRules(rules.filter((_, idx) => idx !== i));
  }

  function markViolation(i) {
    const updated = rules.map((r, idx) => idx === i ? { ...r, violations: r.violations + 1 } : r);
    saveRules(updated);
  }

  function resetViolation(i) {
    const updated = rules.map((r, idx) => idx === i ? { ...r, violations: 0 } : r);
    saveRules(updated);
  }

  function startEdit(i) {
    setEditIdx(i);
    setEditVal(rules[i].text);
  }

  function saveEdit(i) {
    const updated = rules.map((r, idx) => idx === i ? { ...r, text: editVal.trim() } : r);
    saveRules(updated);
    setEditIdx(null);
  }

  const totalViolations = rules.reduce((s, r) => s + r.violations, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold">My Trading Rules</h2>
        {totalViolations > 0 && (
          <span className="text-[10px] font-mono bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full">
            {totalViolations} violation{totalViolations !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Your rules · tap + to add · track violations manually</p>

      {/* Add rule */}
      <div className="flex gap-2 mb-4">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addRule()}
          placeholder="e.g. Never trade the first 15 minutes"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-slate-400"
        />
        <button onClick={addRule}
          className="bg-slate-950 text-white rounded-lg px-3 py-2 text-xs font-mono hover:bg-slate-800 transition-colors">
          + Add
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-xs font-mono text-slate-400">No rules yet. Add your first rule above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, i) => (
            <div key={i} className={`rounded-xl border px-3 py-2.5 ${rule.violations > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
              {editIdx === i ? (
                <div className="flex gap-2">
                  <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && saveEdit(i)}
                    className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none" />
                  <button onClick={() => saveEdit(i)} className="text-emerald-600 text-xs font-mono hover:underline">Save</button>
                  <button onClick={() => setEditIdx(null)} className="text-slate-400 text-xs font-mono hover:underline">Cancel</button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${rule.violations > 0 ? "bg-red-500" : "bg-emerald-500"}`} />
                    <p className="text-xs text-slate-700 leading-relaxed">{rule.text}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {rule.violations > 0 && (
                      <span className="text-[10px] font-mono text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">{rule.violations}x</span>
                    )}
                    <button onClick={() => markViolation(i)} title="Mark violation"
                      className="text-[10px] font-mono text-red-400 hover:text-red-600 transition-colors px-1">+1</button>
                    {rule.violations > 0 && (
                      <button onClick={() => resetViolation(i)} title="Reset"
                        className="text-[10px] font-mono text-slate-400 hover:text-slate-600 transition-colors">↺</button>
                    )}
                    <button onClick={() => startEdit(i)}
                      className="text-[10px] font-mono text-slate-400 hover:text-slate-600 transition-colors">✎</button>
                    <button onClick={() => deleteRule(i)}
                      className="text-[10px] font-mono text-slate-300 hover:text-red-500 transition-colors">✕</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Goal Tracker ───────────────────────────────────────────────────────────
function GoalTracker({ data, loading }) {
  const [goals, setGoals] = useState(() => {
    try { return JSON.parse(localStorage.getItem(GOALS_KEY) || "{}"); }
    catch { return {}; }
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ monthlyR: "", maxBadTrades: "" });

  function saveGoals() {
    const updated = {
      monthlyR: parseFloat(form.monthlyR) || 0,
      maxBadTrades: parseInt(form.maxBadTrades) || 0,
    };
    setGoals(updated);
    localStorage.setItem(GOALS_KEY, JSON.stringify(updated));
    setEditing(false);
  }

  function startEdit() {
    setForm({ monthlyR: goals.monthlyR || "", maxBadTrades: goals.maxBadTrades || "" });
    setEditing(true);
  }

  // Calculate current month stats from data
  const now = new Date();
  const currentMonthTrades = (data?.trades || []).filter(t => {
    if (!t.date) return false;
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const currentR = currentMonthTrades.reduce((s, t) => s + (typeof t.r === "number" ? t.r : 0), 0);
  const badTrades = currentMonthTrades.filter(t => t.tradeQuality === "BAD TRADE").length;

  const rProgress = goals.monthlyR > 0 ? Math.min(100, Math.max(0, (currentR / goals.monthlyR) * 100)) : 0;
  const badProgress = goals.maxBadTrades > 0 ? Math.min(100, (badTrades / goals.maxBadTrades) * 100) : 0;
  const badWarning = goals.maxBadTrades > 0 && badTrades >= goals.maxBadTrades;

  const monthLabel = now.toLocaleDateString("en-GB", { month: "long" });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold">Goal Tracker</h2>
        <button onClick={startEdit}
          className="flex items-center gap-1 text-[10px] font-mono text-slate-400 hover:text-slate-700 transition-colors">
          <Edit2 size={10} />
          {Object.keys(goals).length ? "Edit goals" : "Set goals"}
        </button>
      </div>
      <p className="text-[10px] font-mono text-slate-400 mb-4">{monthLabel} targets</p>

      {editing ? (
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">Monthly R target</label>
            <input type="number" value={form.monthlyR} onChange={e => setForm(f => ({ ...f, monthlyR: e.target.value }))}
              placeholder="e.g. 20" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-slate-400" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">Max bad trades per month</label>
            <input type="number" value={form.maxBadTrades} onChange={e => setForm(f => ({ ...f, maxBadTrades: e.target.value }))}
              placeholder="e.g. 2" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-slate-400" />
          </div>
          <div className="flex gap-2">
            <button onClick={saveGoals} className="flex-1 bg-slate-950 text-white rounded-lg py-2 text-xs font-mono hover:bg-slate-800 transition-colors">Save goals</button>
            <button onClick={() => setEditing(false)} className="px-4 border border-slate-200 rounded-lg text-xs font-mono text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
          </div>
        </div>
      ) : !goals.monthlyR && !goals.maxBadTrades ? (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-xs font-mono text-slate-400">Click "Set goals" to define your monthly targets.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Monthly R goal */}
          {goals.monthlyR > 0 && (
            <div>
              <div className="flex items-end justify-between mb-1.5">
                <div>
                  <p className="text-[9px] font-mono uppercase tracking-wider text-slate-400">Monthly R</p>
                  {loading ? <div className="h-5 w-16 bg-slate-100 rounded animate-pulse mt-1" /> : (
                    <p className={`text-lg font-bold font-mono ${currentR >= goals.monthlyR ? "text-emerald-600" : currentR >= 0 ? "text-slate-900" : "text-red-500"}`}>
                      {signedR(currentR)}
                    </p>
                  )}
                </div>
                <p className="text-xs font-mono text-slate-400">of {goals.monthlyR}R</p>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${currentR >= goals.monthlyR ? "bg-emerald-500" : "bg-blue-400"}`}
                  style={{ width: `${rProgress}%` }} />
              </div>
              <div className="flex justify-between mt-1 text-[10px] font-mono text-slate-400">
                <span>{fmt(rProgress, 1)}% complete</span>
                {currentR < goals.monthlyR && <span>{fmt(goals.monthlyR - currentR, 2)}R remaining</span>}
                {currentR >= goals.monthlyR && <span className="text-emerald-600">Target reached!</span>}
              </div>
            </div>
          )}

          {/* Consistency goal */}
          {goals.maxBadTrades > 0 && (
            <div>
              <div className="flex items-end justify-between mb-1.5">
                <div>
                  <p className="text-[9px] font-mono uppercase tracking-wider text-slate-400">Bad trades this month</p>
                  <p className={`text-lg font-bold font-mono ${badWarning ? "text-red-500" : "text-slate-900"}`}>
                    {badTrades} / {goals.maxBadTrades}
                  </p>
                </div>
                {badWarning && (
                  <span className="text-[10px] font-mono text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <AlertTriangle size={9} /> Limit reached
                  </span>
                )}
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${badWarning ? "bg-red-500" : badProgress > 60 ? "bg-amber-400" : "bg-emerald-400"}`}
                  style={{ width: `${badProgress}%` }} />
              </div>
              <p className="mt-1 text-[10px] font-mono text-slate-400">
                {badWarning ? "Stop taking bad trades this month." : `${goals.maxBadTrades - badTrades} bad trade${goals.maxBadTrades - badTrades !== 1 ? "s" : ""} remaining`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Journal AI Chat ────────────────────────────────────────────────────────
function JournalAI({ data }) {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Ask me anything about your trades. Powered by Groq AI. Try: \"What\'s my best setup?\" or \"When do I perform best?\"" }
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = React.useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  async function ask() {
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    setMessages(m => [...m, { role: "user", text: q }]);
    setThinking(true);

    try {
      const res = await fetch(WORKER_URL + "chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          trades: data?.trades || [],
          stats: {
            count: data?.count, winRate: data?.winRate,
            totalR: data?.totalR, netProfit: data?.netProfit,
          },
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Worker error");
      const reply = json.reply || "Sorry, I couldn't analyse that.";
      setMessages(m => [...m, { role: "assistant", text: reply }]);
    } catch (err) {
      const msg = err?.message?.includes("401") || err?.message?.includes("403")
        ? "API key required — the Journal AI needs a paid Anthropic API key to work."
        : "Connection error — try again.";
      setMessages(m => [...m, { role: "assistant", text: msg }]);
    } finally {
      setThinking(false);
    }
  }

  const suggestions = [
    "What's my best setup?",
    "When do I perform best?",
    "What mistakes do I repeat?",
    "Which confluences work best?",
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col" style={{ minHeight: "420px" }}>
      <h2 className="text-sm font-semibold mb-1">Journal AI</h2>
      <p className="text-[10px] font-mono text-slate-400 mb-4">Ask questions about your own trade data</p>

      {/* Suggestions */}
      {messages.length === 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { setInput(s); }}
              className="text-[10px] font-mono bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 text-slate-600 hover:bg-slate-100 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1" style={{ maxHeight: "260px" }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed max-w-[85%]
              ${m.role === "user"
                ? "bg-slate-950 text-white font-mono"
                : "bg-slate-50 border border-slate-200 text-slate-700"}`}>
              {m.text}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && ask()}
          placeholder="Ask about your trades…"
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-slate-400"
        />
        <button onClick={ask} disabled={thinking || !input.trim()}
          className="bg-slate-950 text-white rounded-xl px-4 py-2 text-xs font-mono hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          Ask
        </button>
      </div>
    </div>
  );
}


function AccountToggle({ account, onChange }) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-slate-200 bg-white">
      {ACCOUNTS.map((a) => (
        <button key={a.value} onClick={() => onChange(a.value)}
          className={`px-4 py-2 text-xs font-mono border-r border-slate-200 last:border-r-0 transition-colors duration-150 flex items-center gap-1.5
            ${account === a.value ? (a.value === "funded" ? "bg-amber-500 text-white border-amber-500" : "bg-slate-950 text-white") : "text-slate-500 hover:bg-slate-50"}`}>
          {a.value === "funded" && <span className={`w-1.5 h-1.5 rounded-full ${account === "funded" ? "bg-white" : "bg-amber-400"}`} />}
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────
export default function MinimalTradeJournalDashboard() {
  const [range, setRange] = useState("30d");
  const [account, setAccount] = useState("other");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("setups");
  const [openSections, setOpenSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) || "{}"); }
    catch { return {}; }
  });

  function toggleSection(id) {
    setOpenSections(prev => {
      const updated = { ...prev, [id]: prev[id] === false ? true : false };
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  // Macro state
  const [macro, setMacro] = useState(null);
  const [macroLoading, setMacroLoading] = useState(true);
  const [macroError, setMacroError] = useState(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  async function loadData(r, acc) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${WORKER_URL}?range=${r}&account=${acc}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Worker returned success: false");
      setData(json);
    } catch (err) {
      setError(err.message || "Failed to reach Cloudflare Worker.");
    } finally {
      setLoading(false);
    }
  }

  const loadMacro = useCallback(async () => {
    setMacroLoading(true);
    setMacroError(null);
    setWarningDismissed(false);
    try {
      const result = await fetchMacroIntel();
      setMacro(result);
    } catch (err) {
      setMacroError("Could not load macro data — " + (err.message || "unknown error"));
    } finally {
      setMacroLoading(false);
    }
  }, []);

  useEffect(() => { loadData(range, account); }, [range, account]);
  useEffect(() => { loadMacro(); }, []);

  const equityCurve = useMemo(() => (data?.trades ? buildEquityCurve(data.trades) : []), [data]);
  const streak = useMemo(() => calcStreak(data?.trades || []), [data]);
  const netPnl = useMemo(() => {
    if (!data?.trades) return 0;
    return data.trades.reduce((sum, t) => sum + (typeof t.pnl === "number" ? t.pnl : 0), 0);
  }, [data]);

  const rangeLabel = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days", "ytd": "year to date" }[range];
  const qualityStats = useMemo(() => buildQualityStats(data?.trades || []), [data]);
  const monthlyData = useMemo(() => buildMonthlyPnl(data?.trades || []), [data]);
  const dayStats = useMemo(() => buildDayStats(data?.trades || []), [data]);
  const confluenceStats = useMemo(() => buildConfluenceStats(data?.trades || []), [data]);
  const mistakesList = useMemo(() => buildMistakes(data?.trades || []), [data]);
  const isFunded = account === "funded";
  const lossStreakWarning = streak.type === "loss" && streak.current >= 2
    ? `${streak.current} losses in a row — consider stepping back` : null;

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400 mb-1">Latrell's Trade Journal</p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Trading Performance</h1>
            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-full border
                ${isFunded ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-slate-100 border-slate-200 text-slate-500"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isFunded ? "bg-amber-400" : "bg-slate-400"}`} />
                {isFunded ? "Funded account" : "Other / personal"}
              </span>
            </div>
            <p className="mt-1.5 text-xs font-mono text-slate-400">
              {loading ? "Fetching live data from Notion…" : error ? "Connection error — check console"
                : `${data?.count ?? 0} trades · ${rangeLabel} · updated just now`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live · Notion
            </div>
            <AccountToggle account={account} onChange={setAccount} />
            <div className="flex rounded-xl overflow-hidden border border-slate-200 bg-white">
              {RANGES.map((r) => (
                <button key={r.value} onClick={() => setRange(r.value)}
                  className={`px-4 py-2 text-xs font-mono border-r border-slate-200 last:border-r-0 transition-colors duration-150
                    ${range === r.value ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{r.label}</button>
              ))}
            </div>
            <button onClick={() => loadData(range, account)}
              className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {/* Macro warning banner */}
        {!warningDismissed && macro?.todayWarning && (
          <MacroWarningBanner warning={macro.todayWarning} onDismiss={() => setWarningDismissed(true)} />
        )}

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-mono text-red-700">{error}</div>
        )}

        {/* Metric cards row 1 */}
        <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <MetricCard label="Net R" value={data ? signedR(data.totalR) : "—"}
            sub={data ? `${data.count} trades loaded` : "Loading…"}
            positive={data ? data.totalR >= 0 : undefined} icon={Activity} loading={loading} />
          <MetricCard label="Win Rate" value={data ? `${data.winRate}%` : "—"}
            sub={data ? `${data.wins}W / ${data.losses}L` : "Loading…"}
            positive={data ? data.winRate >= 50 : undefined} icon={Target} loading={loading} />
          <MetricCard label="Net P&L" value={data ? signedUSD(netPnl) : "—"}
            sub={data ? `${data.count} trades · ${rangeLabel}` : "Loading…"}
            positive={data ? netPnl >= 0 : undefined} icon={DollarSign} loading={loading} />
          <MetricCard label="Best Setup" value={data?.bestSetup ? data.bestSetup.setup : "—"}
            sub={data?.bestSetup ? `${signedR(data.bestSetup.totalR)} · ${data.bestSetup.winRate}% WR` : "Loading…"}
            positive={data?.bestSetup ? data.bestSetup.totalR >= 0 : undefined} icon={Layers} loading={loading} />
        </section>

        {/* Metric cards row 2 */}
        <section className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          <MetricCard label="Current Streak"
            value={!data ? "—" : streak.type === "win" ? `W${streak.current}` : streak.type === "loss" ? `L${streak.current}` : "—"}
            sub={streak.type === "win" ? "Keep following your rules" : streak.type === "loss" ? "Review last trades before continuing" : "No trades yet"}
            positive={streak.type === "win" ? true : streak.type === "loss" ? false : undefined}
            icon={streak.type === "loss" && streak.current >= 2 ? AlertTriangle : Zap}
            loading={loading} warning={lossStreakWarning} />
          <MetricCard label="Longest Win Streak" value={data ? `W${streak.longest}` : "—"}
            sub="Best consecutive wins in range"
            positive={streak.longest > 0 ? true : undefined} icon={TrendingUp} loading={loading} />
          <MetricCard label="Avg R Multiple" value={data ? signedR(data.avgR) : "—"}
            sub="Per completed trade"
            positive={data ? data.avgR >= 0 : undefined} icon={TrendingUp} loading={loading} />
        </section>

        {/* ── Next Best Action — moved up, full prominence ── */}
        <div className="bg-white rounded-2xl border-2 border-slate-900 shadow-sm p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold tracking-tight">Next Best Action</h2>
            <span className="text-[10px] font-mono text-slate-400">{data ? `${data.count} trades · ${rangeLabel}` : "loading…"}</span>
          </div>
          {loading ? (
            <div className="flex gap-3">{[1,2,3].map(i => <div key={i} className="h-14 flex-1 bg-slate-50 rounded-xl animate-pulse" />)}</div>
          ) : data?.insights?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {data.insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
            </div>
          ) : (
            <p className="text-xs font-mono text-slate-400">Add notes to your Notion trades to unlock behavior pattern detection.</p>
          )}
        </div>

        {/* divider */}
        <div className="border-t border-slate-200" />

        {/* ── SECTION 1: Performance ── */}
        <Section id="performance" title="Performance" subtitle="Equity, streaks, weekly summary, monthly P&L" icon="📈" openSections={openSections} toggleSection={toggleSection}>
          <section className="grid gap-4 xl:grid-cols-3">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
              className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold">Equity Curve</h2>
                {data && (
                  <span className={`text-[10px] font-mono px-2 py-1 rounded-full
                    ${data.totalR >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                    {signedR(data.totalR)} total
                  </span>
                )}
              </div>
              <p className="text-[10px] font-mono text-slate-400 mb-4">Cumulative R — tracks growth and drawdown</p>
              {loading ? <div className="h-72 bg-slate-50 rounded-xl animate-pulse" /> :
                equityCurve.length === 0 ? (
                  <div className="h-72 flex items-center justify-center text-xs font-mono text-slate-400">No trade data for this range.</div>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={equityCurve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="label" tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={v => v + "R"} width={42} />
                        <Tooltip content={<EquityTooltip />} />
                        <Line type="monotone" dataKey="equity"
                          stroke={isFunded ? "#f59e0b" : (data?.totalR >= 0 ? "#16a34a" : "#dc2626")}
                          strokeWidth={2.5}
                          dot={equityCurve.length > 30 ? false : { r: 3, strokeWidth: 0, fill: isFunded ? "#f59e0b" : "#16a34a" }}
                          activeDot={{ r: 4, strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              <InlineInsight
                prompt="In one sentence, identify the single most important pattern in this equity curve — what's driving the biggest gains or losses?"
                trades={data?.trades} stats={{ count: data?.count, winRate: data?.winRate, totalR: data?.totalR, netProfit: data?.netProfit }}
                color="blue"
              />
            </motion.div>
            <div className="flex flex-col gap-4">
              <PayoutTracker netPnl={netPnl} loading={loading} />
              <MacroPanel macro={macro} macroLoading={macroLoading} macroError={macroError} onRefresh={loadMacro} />
            </div>
          </section>
          <section className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <WeeklyCalendar trades={data?.trades} loading={loading} />
            </div>
            <MonthlyPnlChart trades={data?.trades} loading={loading} />
          </section>
        </Section>

        <div className="border-t border-slate-200" />

        {/* ── SECTION 2: Setups ── */}
        <Section id="setups" title="Setups" subtitle="Setup stats, win rate, expectancy, trade log" icon="🎯" openSections={openSections} toggleSection={toggleSection}>
          <section className="grid gap-4 xl:grid-cols-2">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex gap-0 rounded-lg overflow-hidden border border-slate-200 w-fit mb-4">
                {["setups", "trades"].map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-[11px] font-mono border-r border-slate-200 last:border-r-0 transition-colors duration-150 capitalize
                      ${activeTab === tab ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                    {tab === "setups" ? "Setup stats" : "Trade log"}
                  </button>
                ))}
              </div>
              {activeTab === "setups" && (
                <>
                  {loading ? (
                    <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />)}</div>
                  ) : data?.setupStats?.length ? (
                    <div>{data.setupStats.map(s => <SetupRow key={s.setup} setup={s} />)}</div>
                  ) : <p className="text-xs font-mono text-slate-400">No setups for this range.</p>}
                  <InlineInsight
                    prompt="In one sentence, which setup has the best expectancy and why should the trader focus on it?"
                    trades={data?.trades} stats={{ count: data?.count, winRate: data?.winRate, totalR: data?.totalR, netProfit: data?.netProfit }}
                    color="emerald"
                  />
                </>
              )}
              {activeTab === "trades" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-100">
                        {["Date","Pair","Setup","Result","Session","R / $"].map(h => (
                          <th key={h} className="pb-2 px-3 text-[9px] font-mono uppercase tracking-widest text-slate-400 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={6} className="py-4 text-xs font-mono text-slate-400 text-center">Loading…</td></tr>
                      ) : data?.trades?.length ? (
                        data.trades.slice(0, 20).map(t => <TradeRow key={t.id} trade={t} />)
                      ) : (
                        <tr><td colSpan={6} className="py-4 text-xs font-mono text-slate-400">No trades in this range.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold mb-1">Win Rate by Setup</h2>
              <p className="text-[10px] font-mono text-slate-400 mb-4">Green = 50%+, red = below 50%</p>
              {loading ? <div className="h-72 bg-slate-50 rounded-xl animate-pulse" /> :
                data?.setupStats?.length ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.setupStats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="setup" tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={v => v + "%"} width={36} />
                        <Tooltip content={<SetupTooltip />} />
                        <Bar dataKey="winRate" radius={[6, 6, 0, 0]}>
                          {data.setupStats.map((s, i) => (
                            <Cell key={i} fill={s.winRate >= 50 ? "rgba(22,163,74,0.75)" : "rgba(220,38,38,0.7)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-72 flex items-center justify-center text-xs font-mono text-slate-400">No setup data for this range.</div>
                )}
              <ConfluencePanel trades={data?.trades} loading={loading} />
            </div>
          </section>
        </Section>

        <div className="border-t border-slate-200" />

        {/* ── SECTION 3: Psychology ── */}
        <Section id="psychology" title="Psychology" subtitle="Trade quality, day analysis, mistakes, rules, goals" icon="🧠" openSections={openSections} toggleSection={toggleSection}>
          <section className="grid gap-4 xl:grid-cols-2">
            <div>
              <TradeQualityPanel trades={data?.trades} loading={loading} />
              <div className="mt-4">
                <InlineInsight
                  prompt="In one sentence, based on good vs bad trade quality data, what is the single biggest execution habit to fix?"
                  trades={data?.trades} stats={{ count: data?.count, winRate: data?.winRate, totalR: data?.totalR, netProfit: data?.netProfit }}
                  color="amber"
                />
              </div>
            </div>
            <DayAnalysisPanel trades={data?.trades} loading={loading} />
          </section>
          <section className="grid gap-4 xl:grid-cols-2">
            <MistakesPanel trades={data?.trades} loading={loading} />
            <div className="flex flex-col gap-4">
              <RulesPanel trades={data?.trades} />
              <GoalTracker data={data} loading={loading} />
            </div>
          </section>
        </Section>

        <div className="border-t border-slate-200" />

        {/* ── SECTION 4: AI Insights ── */}
        <Section id="ai" title="AI Insights" subtitle="Ask questions about your own trade data — powered by Groq" icon="🤖" openSections={openSections} toggleSection={toggleSection}>
          <JournalAI data={data} />
        </Section>

        {/* Setup stats + trade log */}
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex gap-0 rounded-lg overflow-hidden border border-slate-200 w-fit mb-4">
              {["setups", "trades"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-[11px] font-mono border-r border-slate-200 last:border-r-0 transition-colors duration-150 capitalize
                    ${activeTab === tab ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                  {tab === "setups" ? "Setup stats" : "Trade log"}
                </button>
              ))}
            </div>
            {activeTab === "setups" && (
              loading ? (
                <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />)}</div>
              ) : data?.setupStats?.length ? (
                <div>{data.setupStats.map(s => <SetupRow key={s.setup} setup={s} />)}</div>
              ) : <p className="text-xs font-mono text-slate-400">No setups for this range.</p>
            )}
            {activeTab === "trades" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {["Date","Pair","Setup","Result","Session","R / $"].map(h => (
                        <th key={h} className="pb-2 px-3 text-[9px] font-mono uppercase tracking-widest text-slate-400 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="py-4 text-xs font-mono text-slate-400 text-center">Loading…</td></tr>
                    ) : data?.trades?.length ? (
                      data.trades.slice(0, 20).map(t => <TradeRow key={t.id} trade={t} />)
                    ) : (
                      <tr><td colSpan={6} className="py-4 text-xs font-mono text-slate-400">No trades in this range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold mb-1">Win Rate by Setup</h2>
            <p className="text-[10px] font-mono text-slate-400 mb-4">Green = 50%+, red = below 50%</p>
            {loading ? <div className="h-72 bg-slate-50 rounded-xl animate-pulse" /> :
              data?.setupStats?.length ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.setupStats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="setup" tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={v => v + "%"} width={36} />
                      <Tooltip content={<SetupTooltip />} />
                      <Bar dataKey="winRate" radius={[6, 6, 0, 0]}>
                        {data.setupStats.map((s, i) => (
                          <Cell key={i} fill={s.winRate >= 50 ? "rgba(22,163,74,0.75)" : "rgba(220,38,38,0.7)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-72 flex items-center justify-center text-xs font-mono text-slate-400">No setup data for this range.</div>
              )}
          </div>
        </section>

      </div>
    </main>
  );
}
