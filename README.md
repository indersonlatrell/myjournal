# myjournal

A personal trading journal and market terminal. The site is a React + Vite app
deployed on Render. Its data comes from a Cloudflare Worker that reads the
trade journal in Notion.

## Layout

```
src/                    the web app
  main.jsx, App.jsx     entry point and workspace shell (sidebar, Journal / Terminal switch)
  config.js             Worker URL shared by every feature
  styles/app.css        app-level styles (BoardUI tokens + glass panels)
  features/
    journal/            the Journal dashboard
      JournalDashboard.jsx   page layout and data loading
      panels/               cards grouped by section (performance, setups, psychology, insights)
      ui.jsx                shared card primitives (Panel, Tile, Metric, EmptyState, ...)
      stats.js, format.js   calculations and number formatting
    day-context/        NQ / ES key levels card
    account/            funded-account risk card and breach check
    terminal/           the Market Terminal page and its data helpers

components/             BoardUI components (installed source, don't hand-edit)
styles/                 BoardUI theme, typography and globals
utils/                  BoardUI helpers (cx, ...)

worker/                 the Cloudflare Worker (noisy-rain-e6aftest)
  wrangler.toml
  src/index.js          router
  src/routes/           one file per endpoint: trades, macro, chat, status, futures
  src/lib/              Notion and HTTP helpers
```

## Worker endpoints

| Route | What it returns |
|---|---|
| `GET /?range=7d\|30d\|90d\|ytd&account=funded\|other\|all` | Trades from Notion inside the date window (counted back from today) plus totals |
| `GET /macro` | Fear & Greed sentiment and high-impact events for the next 7 days |
| `POST /chat` | Groq answer about the trades sent in the body |
| `GET /status` | Latest row of the Notion "Account Status" table |
| `GET /futures?symbol=NQ=F\|ES=F&interval=5m\|1d&range=5d\|3mo` | CME futures candles for Day Context |

## Running locally

```bash
npm install
npm run dev
```

## Deploying

- **Site:** push to `main`; Render rebuilds automatically.
- **Worker:** `cd worker && npx wrangler deploy`. Secrets (`GROQ_API_KEY`,
  `NOTION_API_KEY`, `NOTION_DATABASE_ID`) are stored in Cloudflare and survive
  deploys. Change one with `npx wrangler secret put GROQ_API_KEY`.
