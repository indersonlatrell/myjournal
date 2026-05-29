import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from "recharts";
import {
  Activity, Target, TrendingUp, Layers,
  ArrowUpRight, ArrowDownRight, RefreshCw
} from "lucide-react";

// ─── Config ────────────────────────────────────────────────────────────────
const WORKER_URL = "https://noisy-rain-e6aftest.indersonlatrell7.workers.dev/";

const RANGES = [
  { label: "7D",  value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "YTD", value: "ytd" },
];

const INSIGHT_STYLES = {
  psychology:  { bg: "bg-amber-50",  border: "border-amber-400",  text: "text-amber-800" },
  execution:   { bg: "bg-blue-50",   border: "border-blue-400",   text: "text-blue-800"  },
  confidence:  { bg: "bg-emerald-50",border: "border-emerald-400",text: "text-emerald-800"},
  review:      { bg: "bg-slate-50",  border: "border-slate-300",  text: "text-slate-700" },
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
        label: d
          ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
          : `#${i + 1}`,
        equity: Number(equity.toFixed(2)),
      };
    });
}

function fmt(n, d = 2) {
  return Number(n).toFixed(d);
}

function signedR(n) {
  return (n >= 0 ? "+" : "") + fmt(n) + "R";
}

// ─── Sub-components ────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, positive, icon: Icon, loading }) {
  return (
    <div className={`
      relative overflow-hidden rounded-2xl bg-white border shadow-sm p-5
      ${positive === true ? "border-emerald-200" : positive === false ? "border-red-200" : "border-slate-200"}
    `}>
      <div className={`
        absolute top-0 left-0 right-0 h-0.5
        ${positive === true ? "bg-emerald-400" : positive === false ? "bg-red-400" : "bg-slate-200"}
      `} />
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-mono uppercase tracking-widest text-slate-400">{label}</p>
        <div className="rounded-lg bg-slate-100 p-1.5 text-slate-500">
          <Icon size={14} />
        </div>
      </div>
      {loading ? (
        <div className="h-7 w-3/4 bg-slate-100 rounded animate-pulse" />
      ) : (
        <p className={`text-2xl font-bold tracking-tight font-mono
          ${positive === true ? "text-emerald-600" : positive === false ? "text-red-500" : "text-slate-900"}
        `}>{value}</p>
      )}
      <p className="mt-2 text-xs text-slate-400 font-mono">{sub}</p>
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
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${setup.winRate}%` }}
          />
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-mono font-semibold ${pos ? "text-emerald-600" : "text-red-500"}`}>
          {signedR(setup.totalR)}
        </p>
        <p className="text-xs text-slate-400 font-mono">{setup.winRate}% WR</p>
        <p className="text-xs text-slate-400 font-mono">avg {signedR(setup.avgR)}</p>
      </div>
    </div>
  );
}

function TradeRow({ trade }) {
  const r = typeof trade.r === "number" ? trade.r : 0;
  const dateStr = trade.date
    ? new Date(trade.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : "—";
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      <td className="py-2.5 px-3 text-xs font-mono text-slate-500">{dateStr}</td>
      <td className="py-2.5 px-3 text-xs font-medium">{trade.pair || "—"}</td>
      <td className="py-2.5 px-3 text-xs text-slate-600">{trade.setup || "—"}</td>
      <td className="py-2.5 px-3">
        <span className={`
          inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full
          ${trade.win
            ? "bg-emerald-50 text-emerald-700"
            : "bg-red-50 text-red-600"}
        `}>
          {trade.win ? "WIN" : "LOSS"}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-500">{trade.session || "—"}</td>
      <td className={`py-2.5 px-3 text-xs font-mono font-semibold text-right
        ${r >= 0 ? "text-emerald-600" : "text-red-500"}`}>
        {signedR(r)}
      </td>
    </tr>
  );
}

// ─── Custom Tooltip ────────────────────────────────────────────────────────
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

// ─── Main Dashboard ────────────────────────────────────────────────────────
export default function MinimalTradeJournalDashboard() {
  const [range, setRange] = useState("30d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("setups");

  async function loadData(r) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${WORKER_URL}?range=${r}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Worker returned success: false");
      setData(json);
    } catch (err) {
      setError(err.message || "Failed to reach Cloudflare Worker.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(range); }, [range]);

  const equityCurve = useMemo(
    () => (data?.trades ? buildEquityCurve(data.trades) : []),
    [data]
  );

  const rangeLabel = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days", "ytd": "year to date" }[range];

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* ── Header ── */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-400 mb-1">
              Latrell's Trade Journal
            </p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Trading Performance
            </h1>
            <p className="mt-1.5 text-xs font-mono text-slate-400">
              {loading
                ? "Fetching live data from Notion…"
                : error
                ? "Connection error — check console"
                : `${data?.count ?? 0} trades · ${rangeLabel} · updated just now`}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Live indicator */}
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live · Notion
            </div>

            {/* Range buttons */}
            <div className="flex rounded-xl overflow-hidden border border-slate-200 bg-white">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRange(r.value)}
                  className={`
                    px-4 py-2 text-xs font-mono border-r border-slate-200 last:border-r-0
                    transition-colors duration-150
                    ${range === r.value
                      ? "bg-slate-950 text-white"
                      : "text-slate-500 hover:bg-slate-50"}
                  `}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Refresh */}
            <button
              onClick={() => loadData(range)}
              className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {/* ── Error banner ── */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs font-mono text-red-700">
            {error}
          </div>
        )}

        {/* ── Metric Cards ── */}
        <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <MetricCard
            label="Net R"
            value={data ? signedR(data.totalR) : "—"}
            sub={data ? `${data.count} trades loaded` : "Loading…"}
            positive={data ? data.totalR >= 0 : undefined}
            icon={Activity}
            loading={loading}
          />
          <MetricCard
            label="Win Rate"
            value={data ? `${data.winRate}%` : "—"}
            sub={data ? `${data.wins}W / ${data.losses}L` : "Loading…"}
            positive={data ? data.winRate >= 50 : undefined}
            icon={Target}
            loading={loading}
          />
          <MetricCard
            label="Avg R Multiple"
            value={data ? signedR(data.avgR) : "—"}
            sub="Per completed trade"
            positive={data ? data.avgR >= 0 : undefined}
            icon={TrendingUp}
            loading={loading}
          />
          <MetricCard
            label="Best Setup"
            value={data?.bestSetup ? data.bestSetup.setup : "—"}
            sub={data?.bestSetup ? `${signedR(data.bestSetup.totalR)} total · ${data.bestSetup.winRate}% WR` : "Loading…"}
            positive={data?.bestSetup ? data.bestSetup.totalR >= 0 : undefined}
            icon={Layers}
            loading={loading}
          />
        </section>

        {/* ── Equity + Insights ── */}
        <section className="grid gap-4 xl:grid-cols-3">

          {/* Equity curve */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold">Equity Curve</h2>
              {data && (
                <span className={`text-[10px] font-mono px-2 py-1 rounded-full
                  ${data.totalR >= 0
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-600"}`}>
                  {signedR(data.totalR)} total
                </span>
              )}
            </div>
            <p className="text-[10px] font-mono text-slate-400 mb-4">Cumulative R — tracks growth and drawdown</p>

            {loading ? (
              <div className="h-72 bg-slate-50 rounded-xl animate-pulse" />
            ) : equityCurve.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-xs font-mono text-slate-400">
                No trade data for this range.
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityCurve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => v + "R"}
                      width={42}
                    />
                    <Tooltip content={<EquityTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      stroke={data?.totalR >= 0 ? "#16a34a" : "#dc2626"}
                      strokeWidth={2.5}
                      dot={equityCurve.length > 30 ? false : { r: 3, strokeWidth: 0, fill: data?.totalR >= 0 ? "#16a34a" : "#dc2626" }}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
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
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-slate-50 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : data?.insights?.length ? (
              <div className="space-y-3">
                {data.insights.map((ins, i) => (
                  <InsightCard key={i} insight={ins} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                <p className="text-xs font-semibold text-slate-600 mb-1">No flags detected</p>
                <p className="text-xs font-mono text-slate-400 leading-relaxed">
                  Add notes to your Notion trades to unlock behavior pattern detection.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── Setup stats + Trade log ── */}
        <section className="grid gap-4 xl:grid-cols-2">

          {/* Setup stats + bar chart */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex gap-0 rounded-lg overflow-hidden border border-slate-200 w-fit mb-4">
              {["setups", "trades"].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`
                    px-4 py-2 text-[11px] font-mono border-r border-slate-200 last:border-r-0
                    transition-colors duration-150 capitalize
                    ${activeTab === tab ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50"}
                  `}
                >
                  {tab === "setups" ? "Setup stats" : "Trade log"}
                </button>
              ))}
            </div>

            {activeTab === "setups" && (
              loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <div key={i} className="h-14 bg-slate-50 rounded-xl animate-pulse" />)}
                </div>
              ) : data?.setupStats?.length ? (
                <div>
                  {data.setupStats.map(s => <SetupRow key={s.setup} setup={s} />)}
                </div>
              ) : (
                <p className="text-xs font-mono text-slate-400">No setups for this range.</p>
              )
            )}

            {activeTab === "trades" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {["Date", "Pair", "Setup", "Result", "Session", "R"].map(h => (
                        <th key={h} className="pb-2 px-3 text-[9px] font-mono uppercase tracking-widest text-slate-400 font-normal">
                          {h}
                        </th>
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

          {/* Win rate bar chart */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold mb-1">Win Rate by Setup</h2>
            <p className="text-[10px] font-mono text-slate-400 mb-4">Green = 50%+, red = below 50%</p>

            {loading ? (
              <div className="h-72 bg-slate-50 rounded-xl animate-pulse" />
            ) : data?.setupStats?.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.setupStats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="setup"
                      tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontFamily: "monospace", fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => v + "%"}
                      width={36}
                    />
                    <Tooltip content={<SetupTooltip />} />
                    <Bar dataKey="winRate" radius={[6, 6, 0, 0]}>
                      {data.setupStats.map((s, i) => (
                        <Cell
                          key={i}
                          fill={s.winRate >= 50 ? "rgba(22,163,74,0.75)" : "rgba(220,38,38,0.7)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-72 flex items-center justify-center text-xs font-mono text-slate-400">
                No setup data for this range.
              </div>
            )}
          </div>
        </section>

      </div>
    </main>
  );
}
