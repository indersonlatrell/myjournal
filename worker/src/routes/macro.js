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

async function highImpactEvents(now) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + 7);
  const todayNY = now.toLocaleDateString("en-CA", { timeZone: NY });

  const events = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) continue;
      for (const ev of await res.json()) {
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
    } catch {
      // A failed feed shouldn't hide the other one.
    }
  }

  const seen = new Set();
  return events
    .filter((ev) => {
      const key = `${ev.name}|${ev.currency}|${ev.timestamp}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 10);
}

export async function handleMacro() {
  const now = new Date();
  const [fg, events] = await Promise.all([fearAndGreed(), highImpactEvents(now)]);
  const sentiment = !fg ? "neutral" : fg.score >= 60 ? "risk-on" : fg.score <= 40 ? "risk-off" : "neutral";
  const today = events.filter((e) => e.isToday);
  return json({
    success: true,
    sentiment,
    fearGreed: fg,
    events,
    todayWarning: today.length ? `${today.map((e) => e.name).join(", ")}. Trade with caution or sit out.` : null,
  });
}
