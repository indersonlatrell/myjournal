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

## Where it lives now

- **`src/features/account/RiskGauge.jsx`**: the Account Risk card and the `useFnStatus(workerUrl)` hook that fetches `${WORKER_URL}status`.
- **`src/features/account/accountStatus.js`**: `isBreached()`, used to show a Breached card instead of the gauge.
- **`worker/src/routes/status.js`**: the Worker's `/status` route (deployed).

The setup steps are done. To track a new account, add a row to the Account Status table in Notion; the app shows the most recently updated row.
