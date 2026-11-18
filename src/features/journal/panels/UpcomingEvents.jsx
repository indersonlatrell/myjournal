import { useEffect, useMemo, useState } from "react";
import { RiCalendarEventLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { cx } from "@/utils/cx";
import { EmptyState, Panel, SkeletonStack } from "@/src/features/journal/ui";

// ─── Upcoming news ─────────────────────────────────────────────────────────
// USD high- and medium-impact events for NQ/ES, laid out as a timeline per day.
// Today's group keeps earlier events (dimmed) and draws a NOW line between past and upcoming.
const NY = "America/New_York";
const IMPACT = {
  high: { label: "High", chip: "rose", dot: "bg-status-rose-text" },
  medium: { label: "Medium", chip: "orange", dot: "bg-status-orange-text" },
};

const nyDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: NY });
const nyTime = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: NY });
const dayLabel = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function countdown(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `in ${h}h ${mins % 60}m` : `in ${h}h`;
}

// Re-render every 30s so the NOW line and countdown stay current.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Older Worker builds only send `events` (high impact, upcoming); map them to the same shape.
function normalise(macro) {
  if (Array.isArray(macro?.upcoming)) return macro.upcoming;
  return (macro?.events || []).filter((ev) => ev.currency === "USD").map((ev) => ({ ...ev, day: nyDay(ev.timestamp), forecast: null, previous: null }));
}

function groupByDay(events, today) {
  const groups = new Map([[today, []]]);
  for (const ev of events) {
    if (!groups.has(ev.day)) groups.set(ev.day, []);
    groups.get(ev.day).push(ev);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function TimelineRail({ dot, first, last, pulse }) {
  return (
    <span className="-my-2.5 flex flex-col items-center self-stretch" aria-hidden="true">
      <span className={cx("w-px flex-1", first ? "bg-transparent" : "bg-separator-border")} />
      <span className={cx("size-2.5 shrink-0 rounded-full", dot, pulse && "ring-4 ring-background-tertiary-error")} />
      <span className={cx("w-px flex-1", last ? "bg-transparent" : "bg-separator-border")} />
    </span>
  );
}

function NowRow({ now, first, last }) {
  return (
    <li className="grid grid-cols-[3rem_0.625rem_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2.5" aria-label={`Now, ${nyTime(now)} ET`}>
      <span className="text-end font-mono text-caption-1-semibold tabular-nums text-text-error-primary">{nyTime(now)}</span>
      <TimelineRail dot="bg-foreground-icon-error" first={first} last={last} />
      <span className="h-px bg-border-error-default" aria-hidden="true" />
      <span className="text-caption-1-semibold text-text-error-primary">NOW</span>
    </li>
  );
}

function EventRow({ ev, now, isNext, first, last }) {
  const impact = IMPACT[ev.impact] || IMPACT.medium;
  const past = ev.timestamp < now;
  const figures = [ev.forecast && `Fcst ${ev.forecast}`, ev.previous && `Prev ${ev.previous}`].filter(Boolean).join(" · ");
  return (
    <li className={cx("grid grid-cols-[3rem_0.625rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2.5", isNext && "bg-background-secondary-default", past && "opacity-50")}>
      <span className="text-end font-mono text-body-2-medium tabular-nums text-text-secondary">{nyTime(ev.timestamp)}</span>
      <TimelineRail dot={impact.dot} first={first} last={last} pulse={isNext && ev.impact === "high"} />
      <span className="flex min-w-0 items-center gap-2">
        <Chip variant="caption" color="neutral" className="shrink-0">{ev.currency}</Chip>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-2-medium text-text-primary">{ev.name}</span>
          {(figures || isNext) && (
            <span className="truncate text-caption-1-regular text-text-tertiary">
              {[isNext && countdown(ev.timestamp - now), figures].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </span>
      <Chip variant="caption" color={impact.chip} className="shrink-0">{impact.label}</Chip>
    </li>
  );
}

function DayTimeline({ day, events, today, now, nextId }) {
  const isToday = day === today;
  // Where the NOW line sits: after the last event that has already happened.
  const nowIndex = isToday ? events.filter((ev) => ev.timestamp < now).length : -1;
  const rows = events.map((ev) => ({ type: "event", ev }));
  if (isToday) rows.splice(nowIndex, 0, { type: "now" });

  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-2 text-caption-1-semibold text-text-tertiary">
        {isToday ? `Today · ${dayLabel(day)}` : dayLabel(day)}
      </h3>
      <ol className="flex flex-col">
        {rows.map((row, i) => {
          const edge = { first: i === 0, last: i === rows.length - 1 };
          return row.type === "now"
            ? <NowRow key="now" now={now} {...edge} />
            : <EventRow key={`${row.ev.name}-${row.ev.timestamp}`} ev={row.ev} now={now} isNext={eventId(row.ev) === nextId} {...edge} />;
        })}
      </ol>
      {isToday && !events.length && <p className="px-2 text-body-2-regular text-text-tertiary">Nothing relevant scheduled today.</p>}
    </div>
  );
}

const eventId = (ev) => `${ev.name}|${ev.timestamp}`;

function EventList({ events, now }) {
  const today = nyDay(now);
  const groups = groupByDay(events, today);
  const next = events.find((ev) => ev.timestamp >= now);
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([day, list]) => (
        <DayTimeline key={day} day={day} events={list} today={today} now={now} nextId={next && eventId(next)} />
      ))}
    </div>
  );
}

export function UpcomingEvents({ macro, loading, error }) {
  const now = useNow();
  const events = useMemo(() => normalise(macro), [macro]);
  const high = useMemo(() => events.filter((ev) => ev.impact === "high"), [events]);
  const upcomingCount = events.filter((ev) => ev.timestamp >= now).length;

  return (
    <Panel icon={RiCalendarEventLine} title="Upcoming news" subtitle="USD high and medium-impact events for NQ and ES · times in ET"
      action={!loading && !error && <span className="text-body-2-regular text-text-tertiary">{upcomingCount} upcoming</span>}>
      {loading ? <SkeletonStack count={3} className="h-12" /> : error ? <EmptyState>{error}</EmptyState> : !events.length ? (
        <EmptyState>
          {macro?.calendarStatus?.[0] != null && macro.calendarStatus[0] !== 200 && macro.calendarStatus[0] !== "cached"
            ? "The news calendar is unavailable right now. Try refreshing in a few minutes."
            : "No relevant USD events in the next 7 days."}
        </EmptyState>
      ) : (
        <Tabs defaultSelectedKey="all">
          <TabList aria-label="Filter events by impact">
            <Tab id="all" count={events.length}>All</Tab>
            <Tab id="high" count={high.length}>High impact</Tab>
          </TabList>
          <TabPanel id="all" className="pt-3"><EventList events={events} now={now} /></TabPanel>
          <TabPanel id="high" className="pt-3">
            {high.length ? <EventList events={high} now={now} /> : <EmptyState>No high-impact events in the next 7 days.</EmptyState>}
          </TabPanel>
        </Tabs>
      )}
    </Panel>
  );
}
