// ─── Day context: reference levels for CME index futures ────────────────────
// Real NQ/ES futures candles (24h, CME) come from Yahoo's chart API. Twelve
// Data's free tier only has QQQ/SPY, which don't trade overnight, so they
// can't produce overnight, Asia, London or midnight-open levels.
//
// Yahoo blocks browser CORS, so requests go through a proxy:
//   dev  → Vite proxy at /yahoo (see vite.config.js)
//   prod → the Cloudflare Worker's /futures route (see worker/futures-route.js)
//
// Yahoo's daily bars for futures are session-dated: the bar dated Nov 16 covers
// Nov 15 18:00 → Nov 16 17:00 New York, which is what we want for PDH/PDL.

export const INSTRUMENTS = [
  { id: "NQ", symbol: "NQ=F", label: "NQ" },
  { id: "ES", symbol: "ES=F", label: "ES" },
];

const NY = "America/New_York";

export function chartUrl(workerUrl, symbol, interval, range) {
  const qs = `interval=${interval}&range=${range}`;
  if (import.meta.env.DEV) return `/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`;
  return `${workerUrl}futures?symbol=${encodeURIComponent(symbol)}&${qs}`;
}

// Yahoo chart JSON → { meta, bars: [{ t, o, h, l, c }] }, skipping empty bars.
export function parseChart(json) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || "No chart data");
  const q = result.indicators?.quote?.[0] || {};
  const bars = (result.timestamp || [])
    .map((t, i) => ({ t, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i] }))
    .filter((b) => b.h != null && b.l != null && b.o != null);
  return { meta: result.meta || {}, bars };
}

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

// Unix seconds → { date: "YYYY-MM-DD", min: minutes since NY midnight }
export function nyParts(unixSeconds) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(unixSeconds * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday of the week containing `date`, used to group session dates by week.
function weekKey(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return shiftDate(date, -offset);
}

function extremes(bars) {
  if (!bars.length) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (b.h > high) high = b.h;
    if (b.l < low) low = b.l;
  }
  return { high, low, range: high - low };
}

const average = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Window state relative to now: "upcoming", "forming" or "done".
function windowState(now, sessionDate, startDate, startMin, endDate, endMin) {
  const key = (d, m) => `${d} ${String(m).padStart(4, "0")}`;
  const nowKey = key(now.date, now.min);
  if (nowKey < key(startDate, startMin)) return "upcoming";
  if (nowKey < key(endDate, endMin)) return "forming";
  return "done";
}

// Session windows in New York time. Asia matches Tradersfeed's "Asia range"
// key level (20:00 → 02:30, where their 90-minute cycles begin).
export const WINDOWS = {
  asia: { label: "Asia", hours: "20:00–02:30" },
  london: { label: "London", hours: "02:00–05:00" },
};

export function buildDayContext(daily, intraday, nowSeconds = Date.now() / 1000) {
  const days = daily.bars.map((b) => ({ ...b, date: nyParts(b.t).date }));
  if (days.length < 2) throw new Error("Not enough daily history");

  const current = days[days.length - 1];
  const previous = days[days.length - 2];
  const completed = days.slice(0, -1);
  const sessionDate = current.date;
  const prevCalendar = shiftDate(sessionDate, -1);

  // Previous week = the latest week before the current session's week.
  const currentWeek = weekKey(sessionDate);
  const priorWeekKey = [...completed].reverse().map((d) => weekKey(d.date)).find((k) => k < currentWeek);
  const priorWeek = extremes(completed.filter((d) => weekKey(d.date) === priorWeekKey));

  const ranges = completed.map((d) => d.h - d.l);
  const avgRange = (n) => (ranges.length >= n ? average(ranges.slice(-n)) : null);

  const bars = intraday.bars.map((b) => ({ ...b, ...nyParts(b.t) }));
  const asiaBars = bars.filter((b) => (b.date === prevCalendar && b.min >= 20 * 60) || (b.date === sessionDate && b.min < 150));
  const londonBars = bars.filter((b) => b.date === sessionDate && b.min >= 120 && b.min < 300);
  const midnightBar = bars.find((b) => b.date === sessionDate && b.min < 5);

  const now = nyParts(nowSeconds);
  const price = Number(intraday.meta.regularMarketPrice ?? daily.meta.regularMarketPrice ?? current.c);
  const sessionRange = current.h - current.l;
  const adr5 = avgRange(5);

  return {
    sessionDate,
    price,
    asOf: intraday.bars.at(-1)?.t ?? null,
    session: { high: current.h, low: current.l, range: sessionRange, usedOfAdr5: adr5 ? sessionRange / adr5 : null },
    levels: [
      { id: "pdh", label: "Previous day high", short: "PDH", value: previous.h },
      { id: "pdl", label: "Previous day low", short: "PDL", value: previous.l },
      { id: "pwh", label: "Previous week high", short: "PWH", value: priorWeek?.high ?? null },
      { id: "pwl", label: "Previous week low", short: "PWL", value: priorWeek?.low ?? null },
      { id: "mo", label: "Midnight open", short: "00:00", value: midnightBar?.o ?? null },
    ],
    windows: {
      asia: {
        ...WINDOWS.asia,
        ...extremes(asiaBars),
        state: windowState(now, sessionDate, prevCalendar, 1200, sessionDate, 150),
      },
      london: {
        ...WINDOWS.london,
        ...extremes(londonBars),
        state: windowState(now, sessionDate, sessionDate, 120, sessionDate, 300),
      },
    },
    rangeRef: [
      { id: "prev", label: "Previous", value: ranges.at(-1) ?? null },
      { id: "5d", label: "5D avg", value: adr5 },
      { id: "21d", label: "21D avg", value: avgRange(21) },
      { id: "40d", label: "40D avg", value: avgRange(40) },
    ],
  };
}
