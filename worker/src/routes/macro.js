// GET /macro — market sentiment plus high-impact economic events for the next 7 days.
import { json } from "../lib/http.js";

const FEEDS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
];
const NY = "America/New_York";

async function fearAndGreed() {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const entry = (await res.json())?.data?.[0];
    if (!entry) return null;
    return { score: parseInt(entry.value, 10), rating: entry.value_classification };
  } catch {
    return null;
  }
}

// The calendar feed rate-limits (HTTP 429), and it often blocks Cloudflare's shared outbound IPs
// even when this Worker barely calls it. So a cron trigger (see wrangler.toml) fetches it every
// 30 minutes and stores the last good copy in KV (binding CALENDAR); visitors only read from KV.
// A request still tries the feed itself when KV has no copy yet or the copy is over 2 hours old,
// at most once per 5 minutes per Worker instance.
const STALE_MS = 2 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const memory = new Map(); // feed URL -> { at, data }, saves a KV read per request
const lastAttempt = new Map(); // feed URL -> time of the last live fetch from a request
const feedStatus = new Map(); // feed URL -> last HTTP status or error, reported in the response

const kvKey = (feed) => `feed:${feed.split("/").pop()}`;

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed, { headers: { "User-Agent": "Mozilla/5.0" } });
    feedStatus.set(feed, res.status);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch (err) {
    feedStatus.set(feed, err.message || "fetch failed");
    return null;
  }
}

async function store(env, feed, data) {
  const entry = { at: Date.now(), data };
  memory.set(feed, entry);
  if (env?.CALENDAR) await env.CALENDAR.put(kvKey(feed), JSON.stringify(entry));
  return entry;
}

async function readStored(env, feed) {
  const mem = memory.get(feed);
  if (mem && Date.now() - mem.at < RETRY_MS) return mem;
  const raw = env?.CALENDAR ? await env.CALENDAR.get(kvKey(feed)) : null;
  const entry = raw ? JSON.parse(raw) : mem ?? null;
  if (entry) memory.set(feed, entry);
  return entry;
}

async function loadFeed(env, feed) {
  const stored = await readStored(env, feed);
  const stale = !stored || Date.now() - stored.at > STALE_MS;
  if (stale && Date.now() - (lastAttempt.get(feed) ?? 0) > RETRY_MS) {
    lastAttempt.set(feed, Date.now());
    const fresh = await fetchFeed(feed);
    if (fresh) return fresh.length || !stored ? (await store(env, feed, fresh)).data : stored.data;
  } else if (stored) {
    feedStatus.set(feed, "cached");
  }
  return stored?.data ?? []; // A failed feed shouldn't hide the other one.
}

async function loadCalendar(env) {
  return (await Promise.all(FEEDS.map((feed) => loadFeed(env, feed)))).flat();
}

// Cron trigger: refresh every feed that answers, keep the stored copy for any that doesn't.
export async function refreshCalendar(env) {
  for (const feed of FEEDS) {
    const data = await fetchFeed(feed);
    if (data) await store(env, feed, data);
    console.log("calendar refresh", kvKey(feed), feedStatus.get(feed), data ? data.length : "kept stored copy");
  }
}

function highImpactEvents(calendar, now) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + 7);
  const todayNY = now.toLocaleDateString("en-CA", { timeZone: NY });

  const events = [];
  for (const ev of calendar) {
    if (!ev.date || ev.impact !== "High") continue;
    const when = new Date(ev.date);
    if (when < now || when > cutoff) continue;
    events.push({
      name: ev.title,
      currency: ev.country,
      impact: "high",
      timestamp: when.getTime(),
      date: when.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: NY }),
      time: `${when.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: NY })} ET`,
      isToday: when.toLocaleDateString("en-CA", { timeZone: NY }) === todayNY,
    });
  }
  return dedupe(events).slice(0, 10);
}

function dedupe(events) {
  const seen = new Set();
  return events
    .filter((ev) => {
      const key = `${ev.name}|${ev.currency}|${ev.timestamp}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

// USD high- and medium-impact events that move NQ/ES, from the start of today (New York)
// through the next 7 days. Today's earlier events stay in so the timeline can show them as past.
const RELEVANT_IMPACT = { High: "high", Medium: "medium" };

function upcomingEvents(calendar, now) {
  const todayNY = now.toLocaleDateString("en-CA", { timeZone: NY });
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + 7);
  const events = [];
  for (const ev of calendar) {
    const impact = RELEVANT_IMPACT[ev.impact];
    if (!ev.date || !impact || ev.country !== "USD") continue;
    const when = new Date(ev.date);
    const day = when.toLocaleDateString("en-CA", { timeZone: NY });
    if (day < todayNY || when > cutoff) continue;
    events.push({
      name: ev.title,
      currency: ev.country,
      impact,
      timestamp: when.getTime(),
      day,
      forecast: ev.forecast || null,
      previous: ev.previous || null,
    });
  }
  return dedupe(events);
}

export async function handleMacro(env) {
  const now = new Date();
  const [fg, calendar] = await Promise.all([fearAndGreed(), loadCalendar(env)]);
  const events = highImpactEvents(calendar, now);
  const sentiment = !fg ? "neutral" : fg.score >= 60 ? "risk-on" : fg.score <= 40 ? "risk-off" : "neutral";
  const today = events.filter((e) => e.isToday);
  return json({
    success: true,
    sentiment,
    fearGreed: fg,
    events,
    upcoming: upcomingEvents(calendar, now),
    calendarStatus: FEEDS.map((f) => feedStatus.get(f) ?? "cached"),
    todayWarning: today.length ? `${today.map((e) => e.name).join(", ")}. Trade with caution or sit out.` : null,
  });
}
