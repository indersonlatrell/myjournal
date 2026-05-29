import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { ArrowUpRight, ArrowDownRight, Brain, Activity, Target, ShieldCheck } from "lucide-react";

const WORKER_URL = "https://noisy-rain-e6aftest.indersonlatrell7.workers.dev/";

const fallbackTrades = [];

function parseTradeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeNumber(value) {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = parseFloat(cleaned);

    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function calculateMetrics(trades) {
  const completed = trades.map((trade) => ({
    ...trade,
    r: normalizeNumber(trade.r),
  }));
  const wins = completed.filter((trade) => trade.r > 0);
  const losses = completed.filter((trade) => trade.r < 0);
  const totalR = completed.reduce((sum, trade) => sum + trade.r, 0);
  const winRate = completed.length ? Math.round((wins.length / completed.length) * 100) : 0;
  const avgR = completed.length ? totalR / completed.length : 0;
  const disciplineScore = Math.max(0, Math.min(100, 100 - losses.length * 4));

  return {
    tradeCount: completed.length,
    wins: wins.length,
    losses: losses.length,
    totalR,
    winRate,
    avgR,
    disciplineScore,
  };
}

function buildEquityData(trades) {
  let equity = 0;
  return [...trades]
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
    .map((trade, index) => {
      equity += normalizeNumber(trade.r);
      const date = parseTradeDate(trade.date);
      return {
        day: date ? date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : `Trade ${index + 1}`,
        equity: Number(equity.toFixed(2)),
        r: normalizeNumber(trade.r),
      };
    });
}

function buildSetupData(trades) {
  const grouped = trades.reduce((acc, trade) => {
    const setup = trade.setup || "Uncategorized";
    if (!acc[setup]) acc[setup] = { setup, wins: 0, trades: 0, totalR: 0 };
    acc[setup].trades += 1;
    acc[setup].totalR += normalizeNumber(trade.r);
    if (normalizeNumber(trade.r) > 0) acc[setup].wins += 1;
    return acc;
  }, {});

  return Object.values(grouped)
    .map((item) => ({
      ...item,
      winRate: item.trades ? Math.round((item.wins / item.trades) * 100) : 0,
      avgR: item.trades ? item.totalR / item.trades : 0,
    }))
    .sort((a, b) => b.totalR - a.totalR);
}

function buildPsychologyData(trades) {
  const grouped = trades.reduce((acc, trade) => {
    const key = trade.session || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(grouped).map(([name, value]) => ({ name, value }));
}


const COLORS = ["#16a34a", "#f59e0b", "#6366f1", "#ef4444"];

function MetricCard({ label, value, delta, icon: Icon, positive = true }) {
  return (
    <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</h3>
          </div>
          <div className="rounded-xl bg-slate-100 p-2 text-slate-700">
            <Icon size={18} />
          </div>
        </div>
        <div className={`mt-4 flex items-center gap-1 text-sm ${positive ? "text-emerald-600" : "text-red-500"}`}>
          {positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          <span>{delta}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MinimalTradeJournalDashboard() {
  const [range, setRange] = useState("30d");
  const [trades, setTrades] = React.useState(fallbackTrades);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    async function loadTrades() {
      try {
        setLoading(true);
        const res = await fetch(WORKER_URL);
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.message || "Could not load trade journal data.");
        }

        setTrades(data.trades || []);
      } catch (err) {
        setError(err?.message || "Unknown loading error");
      } finally {
        setLoading(false);
      }
    }

    loadTrades();
  }, []);

  const metrics = useMemo(() => calculateMetrics(trades), [trades]);
  const equityData = useMemo(() => buildEquityData(trades), [trades]);
  const setupData = useMemo(() => buildSetupData(trades), [trades]);
  const psychologyData = useMemo(() => buildPsychologyData(trades), [trades]);

  const avgWinRate = metrics.winRate;

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-950 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">Latrell's Trade Journal</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Trading Performance Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Live analytics dashboard connected to your Notion trade journal through Cloudflare Workers.
            </p>
            {error && <p className="mt-2 text-sm text-red-500">Data error: {error}</p>}
          </div>
          <div className="flex gap-2">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-36 rounded-xl border-slate-200 bg-white">
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="ytd">Year to date</SelectItem>
              </SelectContent>
            </Select>
            <Button className="rounded-xl bg-slate-950 text-white hover:bg-slate-800">Export report</Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Net R" value={`${metrics.totalR >= 0 ? "+" : ""}${metrics.totalR.toFixed(2)}R`} delta={`${metrics.tradeCount} trades loaded`} icon={Activity} positive={metrics.totalR >= 0} />
          <MetricCard label="Win Rate" value={`${avgWinRate}%`} delta={`${metrics.wins} wins / ${metrics.losses} losses`} icon={Target} />
          <MetricCard label="Avg R Multiple" value={`${metrics.avgR >= 0 ? "+" : ""}${metrics.avgR.toFixed(2)}R`} delta="Per completed trade" icon={ShieldCheck} positive={metrics.avgR >= 0} />
          <MetricCard label="Discipline Score" value={`${metrics.disciplineScore}/100`} delta={loading ? "Loading Notion data" : "Based on current trade sample"} icon={Brain} positive={metrics.disciplineScore >= 70} />
        </section>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="rounded-xl bg-white p-1 shadow-sm">
            <TabsTrigger value="overview" className="rounded-lg">Overview</TabsTrigger>
            <TabsTrigger value="strategy" className="rounded-lg">Strategy</TabsTrigger>
            <TabsTrigger value="psychology" className="rounded-lg">Psychology</TabsTrigger>
            <TabsTrigger value="trades" className="rounded-lg">Trade Review</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="grid gap-4 xl:grid-cols-3">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="xl:col-span-2">
              <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
                <CardContent className="p-5">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Equity Curve</h2>
                      <p className="text-sm text-slate-500">Tracks account growth and drawdown behavior.</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-700">{loading ? "Loading" : "Live data"}</span>
                  </div>
                  <div className="h-80" style={{ height: 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={equityData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="day" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip />
                        <Line type="monotone" dataKey="equity" stroke="#0f172a" strokeWidth={3} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-lg font-semibold">Next Best Action</h2>
                <p className="mt-2 text-sm text-slate-500">The dashboard should tell you what to fix before the next trading session.</p>
                <div className="mt-5 space-y-3">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-sm font-medium">Protect your best setup</p>
                    <p className="mt-1 text-sm text-slate-500">Your highest-performing setup should become the main focus for this week.</p>
                  </div>
                  <div className="rounded-xl bg-red-50 p-4">
                    <p className="text-sm font-medium text-red-700">Watch FOMO trades</p>
                    <p className="mt-1 text-sm text-red-600">Use journal notes and losing trades to identify repeated execution mistakes.</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-4">
                    <p className="text-sm font-medium text-emerald-700">Scale reporting</p>
                    <p className="mt-1 text-sm text-emerald-600">Investor view should show clean monthly return, drawdown, and risk metrics.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="strategy" className="grid gap-4 xl:grid-cols-2">
            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-lg font-semibold">Setup Performance</h2>
                <p className="mb-5 text-sm text-slate-500">Compare win rate by strategy/setup.</p>
                <div className="h-80" style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={setupData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="setup" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="winRate" fill="#0f172a" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-lg font-semibold">Strategy Decision Matrix</h2>
                <div className="mt-4 space-y-3">
                  {setupData.map((item) => (
                    <div key={item.setup} className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
                      <div>
                        <p className="font-medium">{item.setup}</p>
                        <p className="text-sm text-slate-500">{item.trades} logged trades</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{item.winRate}%</p>
                        <p className="text-sm text-slate-500">{item.totalR.toFixed(2)}R total</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="psychology" className="grid gap-4 xl:grid-cols-2">
            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-lg font-semibold">Emotional Pattern Breakdown</h2>
                <p className="text-sm text-slate-500">Turns journal notes into visible behavior patterns.</p>
                <div className="mt-5 h-80" style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={psychologyData} dataKey="value" nameKey="name" outerRadius={110} label>
                        {psychologyData.map((entry, index) => (
                          <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-lg font-semibold">Psychology Rules</h2>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-4">No trade without a screenshot, bias, invalidation, and emotional state logged.</div>
                  <div className="rounded-xl bg-slate-50 p-4">After one impulsive entry, dashboard should trigger "review only" mode for the next setup.</div>
                  <div className="rounded-xl bg-slate-50 p-4">Weekly review should identify one behavior to remove, not ten things to improve.</div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trades">
            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-lg font-semibold">Recent Trade Review</h2>
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="p-3 font-medium">Date</th>
                        <th className="p-3 font-medium">Market</th>
                        <th className="p-3 font-medium">Setup</th>
                        <th className="p-3 font-medium">Result</th>
                        <th className="p-3 font-medium">Session</th>
                        <th className="p-3 font-medium">Position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.slice(0, 20).map((trade) => (
                        <tr key={trade.id} className="border-t border-slate-100">
                          <td className="p-3">{trade.date ? new Date(trade.date).toLocaleDateString("en-GB") : "—"}</td>
                          <td className="p-3">{trade.pair || "—"}</td>
                          <td className="p-3">{trade.setup || "—"}</td>
                          <td className={`p-3 font-medium ${normalizeNumber(trade.r) >= 0 ? "text-emerald-600" : "text-red-500"}`}>{`${normalizeNumber(trade.r) >= 0 ? "+" : ""}${normalizeNumber(trade.r).toFixed(2)}R`}</td>
                          <td className="p-3">{trade.session || "—"}</td>
                          <td className="p-3 text-slate-500">{trade.position || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
