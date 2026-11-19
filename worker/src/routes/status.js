// GET /status — the active funded account, from the most recently updated row of the
// "Account Status" Notion database.
//
// When that row has Starting Balance, Max Drawdown and Start Date, the live figures are
// computed from the Funded trades in the trade journal since Start Date, so they never go
// stale: balance, current profit, trailing breach floor, distance to breach and the 50%
// consistency rule. Without those three fields the row's own stored values are returned.
import { json } from "../lib/http.js";
import { checkbox, date, number, queryDatabase, select, text } from "../lib/notion.js";

const ACCOUNT_STATUS_DB = "dca09b8e1f2b402fbaab5a01be912356";
const NY = "America/New_York";

// Closed-trade balance path. The floor trails the highest balance by the drawdown and stops
// trailing once it reaches the starting balance (the usual prop-firm lock).
export function computeAccount({ startingBalance, maxDrawdown, trades }) {
  let balance = startingBalance;
  let peak = startingBalance;
  const byDay = new Map();
  for (const t of trades) {
    balance += t.pnl;
    peak = Math.max(peak, balance);
    const day = new Date(t.date).toLocaleDateString("en-CA", { timeZone: NY });
    byDay.set(day, (byDay.get(day) || 0) + t.pnl);
  }
  const floor = Math.min(peak - maxDrawdown, startingBalance);
  const profit = balance - startingBalance;
  const bestDay = Math.max(0, ...byDay.values());
  const share = profit > 0 ? Math.round((bestDay / profit) * 100) : null;
  return {
    balance: round(balance),
    currentProfit: round(profit),
    breachFloorEquity: round(floor),
    distanceToBreach: round(balance - floor),
    tradingDays: byDay.size,
    consistency:
      share === null ? `50% rule: no profit yet · ${byDay.size} trading day(s)`
      : `50% rule: best day is ${share}% of profit (${share <= 50 ? "met" : "not met"}) · ${byDay.size} trading day(s)`,
  };
}

const round = (n) => Math.round(n * 100) / 100;

async function fundedTradesSince(env, start) {
  const pages = await queryDatabase(env, env.NOTION_DATABASE_ID, {
    filter: {
      and: [
        { property: "Account", select: { equals: "Funded" } },
        { property: "Date & Time", date: { on_or_after: start } },
      ],
    },
    sorts: [{ property: "Date & Time", direction: "ascending" }],
  });
  return pages
    .filter((p) => select(p.properties["Position"]) !== "No trade")
    .map((p) => ({ date: date(p.properties["Date & Time"]), pnl: number(p.properties["Profit"]) ?? 0 }))
    .filter((t) => t.date);
}

export async function handleStatus(env) {
  try {
    const [row] = await queryDatabase(env, ACCOUNT_STATUS_DB, {
      page_size: 1,
      sorts: [{ property: "Updated", direction: "descending" }],
    });
    if (!row) return json({ success: true, account: null });

    const p = row.properties;
    const account = {
      account: text(p["Account"]) || null,
      login: text(p["Login"]) || null,
      status: text(p["Status"]) || null,
      balance: number(p["Balance"]),
      distanceToBreach: number(p["Distance to Breach"]),
      breachFloorEquity: number(p["Breach Floor Equity"]),
      profitTarget: number(p["Profit Target"]),
      currentProfit: number(p["Current Profit"]),
      dailyLossRemaining: number(p["Daily Loss Remaining"]),
      consistency: text(p["Consistency"]) || null,
      breachAlert: checkbox(p["Breach Alert"]),
      updated: date(p["Updated"]),
      computed: false,
    };

    const startingBalance = number(p["Starting Balance"]);
    const maxDrawdown = number(p["Max Drawdown"]);
    const start = date(p["Start Date"]);
    if (startingBalance > 0 && maxDrawdown > 0 && start) {
      const live = computeAccount({ startingBalance, maxDrawdown, trades: await fundedTradesSince(env, start) });
      Object.assign(account, live, { computed: true, updated: new Date().toISOString() });
      // The app warns by itself when the distance gets small; the flag marks a real breach.
      account.breachAlert = live.distanceToBreach <= 0;
      if (account.breachAlert) account.status = `Breached — balance ${live.balance} reached the floor ${live.breachFloorEquity}.`;
    }
    return json({ success: true, account });
  } catch (err) {
    return json({ success: false, message: err.message }, err.status ? 502 : 500);
  }
}
