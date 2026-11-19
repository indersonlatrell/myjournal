// GET /?range=7d|30d|90d|ytd|all&account=funded|other|all
// Reads the trade journal from Notion and returns trades plus summary stats.
import { json } from "../lib/http.js";
import { ANALYSE_FROM, readAnalyses } from "./chartAnalysis.js";
import { checkbox, date, multiSelect, number, queryDatabase, select, text } from "../lib/notion.js";

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

// Start of the window, counted back from today (not from the latest trade).
// `all` returns every trade (used by the payout tracker's own start date).
export function rangeStart(range, now = new Date()) {
  if (range === "all") return new Date(0);
  if (range === "ytd") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = RANGE_DAYS[range] ?? 30;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

function toTrade(page) {
  const p = page.properties;
  const win = checkbox(p["Win?"]);
  const rr = number(p["RR"]) ?? 0;
  const risk = parseFloat(select(p["Risk, %"]).replace("%", ""));
  return {
    id: page.id,
    trade: text(p["Trade"]),
    date: date(p["Date & Time"]),
    session: select(p["Session"]),
    pair: select(p["Pair"]),
    setup: select(p["Setup"]),
    position: select(p["Position"]),
    marketProfile: select(p["Market profile"]),
    tradeQuality: select(p["GOOD // BAD"]),
    tradeResult: select(p["Trade Result"]),
    day: select(p["Day"]),
    confluences: multiSelect(p["Confluences"]),
    mistakes: text(p["Mistakes review"]),
    account: select(p["Account"]),
    win,
    disciplined: checkbox(p["Disciplined"]),
    r: win ? rr : -Math.abs(rr || 1),
    pnl: number(p["Profit"]) ?? 0,
    risk: Number.isNaN(risk) ? 0 : risk,
    notes: text(p["Notes"]),
  };
}

function buildSetupStats(trades) {
  const grouped = {};
  for (const t of trades) {
    const name = t.setup || "Uncategorized";
    const s = (grouped[name] ||= { setup: name, trades: 0, wins: 0, losses: 0, totalR: 0, totalPnl: 0 });
    s.trades++;
    if (t.win) s.wins++; else s.losses++;
    s.totalR += t.r;
    s.totalPnl += t.pnl;
  }
  return Object.values(grouped)
    .map((s) => ({
      ...s,
      winRate: Math.round((s.wins / s.trades) * 100),
      avgR: Number((s.totalR / s.trades).toFixed(2)),
      totalR: Number(s.totalR.toFixed(2)),
      totalPnl: Number(s.totalPnl.toFixed(2)),
    }))
    .sort((a, b) => b.totalR - a.totalR || b.winRate - a.winRate);
}

function buildInsights(trades) {
  if (!trades.length) return [];
  const notes = trades.map((t) => t.notes.toLowerCase()).join(" ");
  const insights = [];
  if (notes.includes("niet gedisciplineerd") || notes.includes("discipline")) {
    insights.push({ type: "psychology", title: "Discipline needs attention", message: "Your journal mentions discipline issues. Add a pre-entry checklist before every trade." });
  }
  if (notes.includes("profit") || notes.includes("winst")) {
    insights.push({ type: "execution", title: "Profit management theme detected", message: "Several notes mention profit management. Consider rules for partials, break-even, and max giveback." });
  }
  if (notes.includes("vertrouwen")) {
    insights.push({ type: "confidence", title: "Trust in system", message: "Your notes mention needing more confidence in your system. Review A+ setups before session start." });
  }
  if (!insights.length) {
    insights.push({ type: "review", title: "Review recent losing trades", message: "Use the two most recent losses to identify one execution mistake to remove next session." });
  }
  return insights;
}

function matchesAccount(trade, account) {
  if (account === "funded") return trade.account === "Funded";
  if (account === "other") return trade.account !== "Funded";
  return true;
}

export async function handleTrades(url, env) {
  const range = url.searchParams.get("range") || "30d";
  const account = url.searchParams.get("account") || "all";

  let pages;
  try {
    pages = await queryDatabase(env, env.NOTION_DATABASE_ID, {
      sorts: [{ property: "Date & Time", direction: "descending" }],
    });
  } catch (err) {
    return json({ success: false, message: err.message, notionError: err.detail }, 502);
  }

  const now = new Date();
  const start = rangeStart(range, now);
  const analyses = await readAnalyses(env);
  const trades = pages
    .map((page) => ({ ...toTrade(page), chart: analyses[page.id]?.annotations?.length && (date(page.properties["Date & Time"]) || "") >= ANALYSE_FROM ? analyses[page.id] : null }))
    .filter((t) => t.date && matchesAccount(t, account))
    .filter((t) => {
      const d = new Date(t.date);
      return d >= start && d <= now;
    });

  const wins = trades.filter((t) => t.win).length;
  const totalR = trades.reduce((s, t) => s + t.r, 0);
  const netProfit = trades.reduce((s, t) => s + t.pnl, 0);
  const setupStats = buildSetupStats(trades);

  return json({
    success: true,
    range,
    account,
    from: start.toISOString(),
    to: now.toISOString(),
    count: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length ? Math.round((wins / trades.length) * 100) : 0,
    totalR: Number(totalR.toFixed(2)),
    avgR: trades.length ? Number((totalR / trades.length).toFixed(2)) : 0,
    netProfit: Number(netProfit.toFixed(2)),
    bestSetup: setupStats[0] || null,
    setupStats,
    insights: buildInsights(trades),
    trades,
  });
}
