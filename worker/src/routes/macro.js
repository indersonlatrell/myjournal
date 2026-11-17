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

// The calendar feed rate-limits (HTTP 429) when hit on every page load, and it only changes
// about hourly. Keep each feed's last good copy in memory for 30 minutes, ask Cloudflare's edge
// to cache successful responses too, and fall back to the stale copy if a refresh fails.
const FEED_TTL_MS = 30 * 60 * 1000;
const feedCache = new Map(); // feed URL -> { at, data }

async function loadFeed(feed) {
  const cached = feedCache.get(feed);
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.data;
  try {
    const res = await fetch(feed, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": FEED_TTL_MS / 1000, "400-599": 0 } },
    });
    if (!res.ok) return cached?.data ?? [];
    const data = await res.json();
    if (!Array.isArray(data)) return cached?.data ?? [];
    feedCache.set(feed, { at: Date.now(), data });
    return data;
  } catch {
    return cached?.data ?? []; // A failed feed shouldn't hide the other one.
  }
}

async function loadCalendar() {
  return (await Promise.all(FEEDS.map(loadFeed))).flat();
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

export async function handleMacro() {
  const now = new Date();
  const [fg, calendar] = await Promise.all([fearAndGreed(), loadCalendar()]);
  const events = highImpactEvents(calendar, now);
  const sentiment = !fg ? "neutral" : fg.score >= 60 ? "risk-on" : fg.score <= 40 ? "risk-off" : "neutral";
  const today = events.filter((e) => e.isToday);
  return json({
    success: true,
    sentiment,
    fearGreed: fg,
    events,
    upcoming: upcomingEvents(calendar, now),
    todayWarning: today.length ? `${today.map((e) => e.name).join(", ")}. Trade with caution or sit out.` : null,
  });
}
