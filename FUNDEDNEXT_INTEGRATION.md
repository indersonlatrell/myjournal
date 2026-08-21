# FundedNext live risk gauge — integration

Adds a live **Account Risk** card to the Journal (distance-to-breach, profit-target
progress, daily-loss buffer, consistency, breach alert) and makes the **Payout
Tracker** default to your real FundedNext profit target instead of a manual number.

## How the data flows

```
FundedNext  →  Claude scheduled jobs (twice daily)  →  "FN Account Status" Notion DB
                                                              │
                                          Cloudflare Worker  /status  route
                                                              │
                                          myjournal SPA  →  <RiskGauge/>
```

The SPA never touches Notion directly — it reads the Worker, exactly like the trades
feed. The `RiskGauge` degrades gracefully: until the Worker route exists it shows a
quiet "not connected yet" hint, so the app is safe to ship immediately.

## What changed in this repo

- **`src/RiskGauge.jsx`** (new) — the card + `useFnStatus(workerUrl)` hook that fetches `${WORKER_URL}status`.
- **`src/MinimalTradeJournalDashboard.jsx`** — imports `RiskGauge`, calls `useFnStatus`, renders the card in the Performance right-column, and passes the real `profitTarget` into `PayoutTracker`.
- **`worker/fn-status-route.js`** (new) — the Cloudflare Worker route to add (see below).

## To go live (3 steps)

1. **Share the Notion DB with the Worker's integration.** Open **FN Account Status**
   (in Latrell's Workspace) → ••• → **Connections** → add the same integration your
   Worker already uses for the Trade Journal.
2. **Add the `/status` route to your Worker.** Merge `worker/fn-status-route.js` into
   the Worker at `noisy-rain-e6aftest.indersonlatrell7.workers.dev`, wire the route as
   shown in that file's header comment, and `wrangler deploy`. (Rename `env.NOTION_TOKEN`
   to match your existing token variable.)
3. **Push this repo** → Render redeploys the SPA. Done.

Order doesn't matter — ship the app whenever; the gauge lights up the moment the
Worker route is live.

## Worker response contract

`GET /status` →

```json
{ "success": true, "account": {
    "login": "962815369", "status": "Active", "balance": 49917.10,
    "distanceToBreach": 1417.10, "breachFloorEquity": 48500,
    "profitTarget": 2500, "currentProfit": 0,
    "dailyLossRemaining": null, "consistency": "N/A — needs profit",
    "breachAlert": false, "updated": "2026-08-21T08:35:00+00:00"
} }
```
