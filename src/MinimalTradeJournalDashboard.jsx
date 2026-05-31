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

// ─── Macro AI fetch ────────────────────────────────────────────────────────
async function fetchMacroIntel() {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const prompt = `Today is ${today}. You are a macro analyst helping a funded forex/futures trader decide whether to trade today.

Return ONLY a JSON object with this exact structure, no markdown, no preamble:
{
  "sentiment": "risk-on" | "risk-off" | "neutral",
  "sentimentReason": "one sentence explanation",
  "events": [
    { "time": "HH:MM ET", "name": "Event name", "impact": "high" | "medium", "currency": "USD/EUR/etc", "note": "brief trading implication" }
  ],
  "todayWarning": null | "warning message if there is a major event TODAY that warrants caution",
  "traderTip": "one actionable sentence for the trader based on current macro environment"
}

Include only events from today and the next 3 days. Focus on: NFP, CPI, FOMC, PCE, GDP, PMI, retail sales, central bank decisions. If no major events, return empty array. Be accurate to current real-world conditions.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === "text");
  if (!textBlock) throw new Error("No text response");
  const clean = textBlock.text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Macro Panel ───────────────────────────────────────────────────────────
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
          {/* Sentiment */}
          <div className={`rounded-xl border px-4 py-3 ${sc.bg} ${sc.border}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
              <p className={`text-xs font-semibold capitalize ${sc.text}`}>{macro.sentiment}</p>
            </div>
            <p className="text-[10px] font-mono text-slate-500 leading-relaxed">{macro.sentimentReason}</p>
          </div>

          {/* Upcoming events */}
          {macro.events?.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Upcoming events</p>
              {macro.events.map((ev, i) => (
                <div key={i} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-semibold ${impactColors[ev.impact] || impactColors.medium}`}>
                        {ev.impact?.toUpperCase()}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400">{ev.currency}</span>
                    </div>
                    <p className="text-[11px] font-medium text-slate-800 truncate">{ev.name}</p>
                    <p className="text-[10px] font-mono text-slate-400 leading-relaxed">{ev.note}</p>
                  </div>
                  <p className="text-[10px] font-mono text-slate-400 whitespace-nowrap">{ev.time}</p>
                </div>
              ))}
            </div>
          )}

          {/* Trader tip */}
          {macro.traderTip && (
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
              <p className="text-[9px] font-mono uppercase tracking-widest text-blue-400 mb-1">Trader tip</p>
              <p className="text-[11px] font-mono text-blue-800 leading-relaxed">{macro.traderTip}</p>
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
        <p className="text-xs text-slate-400 font-mono">{setup.winRate}% WR</p>
        <p className="text-xs text-slate-400 font-mono">avg {signedR(setup.avgR)}</p>
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

        {/* Equity + Insights + Macro */}
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
          </motion.div>

          {/* Insights */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold mb-1">Next Best Action</h2>
            <p className="text-[10px] font-mono text-slate-400 mb-4">
              {data ? `${data.count} trades · ${rangeLabel}` : "Powered by your journal notes"}
            </p>
            {loading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-slate-50 rounded-xl animate-pulse" />)}</div>
            ) : data?.insights?.length ? (
              <div className="space-y-3">{data.insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}</div>
            ) : (
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold text-slate-600 mb-1">No flags detected</p>
                <p className="text-xs font-mono text-slate-400 leading-relaxed">Add notes to your Notion trades to unlock behavior pattern detection.</p>
              </div>
            )}
          </div>
        </section>

        {/* Macro panel full width */}
        <section className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <WeeklyCalendar trades={data?.trades} loading={loading} />
          </div>
          <div className="flex flex-col gap-4">
            <MacroPanel macro={macro} macroLoading={macroLoading} macroError={macroError} onRefresh={loadMacro} />
            <PayoutTracker netPnl={netPnl} loading={loading} />
          </div>
        </section>

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
