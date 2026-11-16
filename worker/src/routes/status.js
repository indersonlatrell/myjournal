// GET /status — the most recently updated row of the "Account Status" Notion database.
import { json } from "../lib/http.js";
import { checkbox, date, number, queryDatabase, text } from "../lib/notion.js";

const ACCOUNT_STATUS_DB = "dca09b8e1f2b402fbaab5a01be912356";

export async function handleStatus(env) {
  try {
    const [row] = await queryDatabase(env, ACCOUNT_STATUS_DB, {
      page_size: 1,
      sorts: [{ property: "Updated", direction: "descending" }],
    });
    if (!row) return json({ success: true, account: null });

    const p = row.properties;
    return json({
      success: true,
      account: {
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
      },
    });
  } catch (err) {
    return json({ success: false, message: err.message }, err.status ? 502 : 500);
  }
}
