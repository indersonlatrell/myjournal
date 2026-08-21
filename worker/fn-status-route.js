// FundedNext account-status route for the myjournal Cloudflare Worker.
//
// Add this to the EXISTING Worker (the one already serving trades / macro / chat
// at noisy-rain-e6aftest.indersonlatrell7.workers.dev) so the SPA's RiskGauge can
// read live account state. It reads the "FN Account Status" Notion database, which
// the scheduled jobs refresh twice a day, and returns the funded-account row.
//
// ── Setup ────────────────────────────────────────────────────────────────────
// 1. Share the "FN Account Status" Notion DB with the SAME Notion integration the
//    Worker already uses:  open the DB → ••• → Connections → add the integration.
// 2. This uses the Worker's existing Notion token. Below it is referenced as
//    env.NOTION_TOKEN — rename to match whatever variable your Worker already uses.
// 3. In your Worker's main `fetch(request, env)` handler, route /status to it,
//    BEFORE the default trades handler:
//
//        const url = new URL(request.url);
//        if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
//        if (url.pathname.replace(/\/+$/, "") === "/status") return handleFnStatus(env);
//
// Then `wrangler deploy`. The SPA calls `${WORKER_URL}status` and degrades
// gracefully until this route exists, so you can ship the app first.

const FN_STATUS_DB = "dca09b8e1f2b402fbaab5a01be912356"; // "FN Account Status" database id
const NOTION_VERSION = "2022-06-28";

export const CORS = {
  "Access-Control-Allow-Origin": "*", // tighten to your app origin if you prefer
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const txt = (p) =>
  !p ? null
  : p.type === "title" ? p.title.map((t) => t.plain_text).join("")
  : p.type === "rich_text" ? p.rich_text.map((t) => t.plain_text).join("")
  : null;
const num = (p) => (p && p.type === "number" ? p.number : null);
const chk = (p) => (p && p.type === "checkbox" ? p.checkbox : false);
const dat = (p) => (p && p.type === "date" && p.date ? p.date.start : null);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function handleFnStatus(env) {
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${FN_STATUS_DB}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        page_size: 1,
        sorts: [{ property: "Updated", direction: "descending" }],
      }),
    });
    if (!res.ok) return json({ success: false, message: `Notion ${res.status}` }, 502);

    const data = await res.json();
    const row = data.results && data.results[0];
    if (!row) return json({ success: true, account: null });

    const p = row.properties;
    const account = {
      account: txt(p["Account"]),
      login: txt(p["Login"]),
      status: txt(p["Status"]),
      balance: num(p["Balance"]),
      distanceToBreach: num(p["Distance to Breach"]),
      breachFloorEquity: num(p["Breach Floor Equity"]),
      profitTarget: num(p["Profit Target"]),
      currentProfit: num(p["Current Profit"]),
      dailyLossRemaining: num(p["Daily Loss Remaining"]),
      consistency: txt(p["Consistency"]),
      breachAlert: chk(p["Breach Alert"]),
      updated: dat(p["Updated"]),
    };
    return json({ success: true, account });
  } catch (err) {
    return json({ success: false, message: err.message }, 500);
  }
}
