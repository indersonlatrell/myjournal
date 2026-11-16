import { WORKER_URL } from "./config";

// ─── Helpers ───────────────────────────────────────────────────────────────
export function buildEquityCurve(trades) {
  let equity = 0;
  let pnl = 0;
  return [...trades]
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
    .map((t, i) => {
      equity += typeof t.r   === "number" ? t.r   : 0;
      pnl    += typeof t.pnl === "number" ? t.pnl : 0;
      const d = t.date ? new Date(t.date) : null;
      return {
        label:  d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : `#${i + 1}`,
        equity: Number(equity.toFixed(2)),
        pnl:    Number(pnl.toFixed(2)),
      };
    });
}


export function calcStreak(trades) {
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

export function buildWeeklyGrid(trades) {
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
export function buildQualityStats(trades) {
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
export function buildMonthlyPnl(trades) {
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
export function buildDayStats(trades) {
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
export function buildConfluenceStats(trades) {
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
export function buildMistakes(trades) {
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
export async function fetchMacroIntel() {
  const res = await fetch(WORKER_URL + "macro");
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Macro fetch failed");
  return data;
}

// ─── AI chat ───────────────────────────────────────────────────────────────
// The Worker answers `success: true` with this placeholder when its model call
// fails, so treat it as no answer rather than showing it to the trader.
const FAILED_REPLY = /could not generate a response/i;

export async function askJournal({ question, trades, stats, signal }) {
  const res = await fetch(WORKER_URL + "chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, trades, stats }),
    signal,
  });
  const json = await res.json();
  const reply = typeof json.reply === "string" ? json.reply.trim() : "";
  if (!json.success || !reply || FAILED_REPLY.test(reply)) return null;
  return reply;
}
