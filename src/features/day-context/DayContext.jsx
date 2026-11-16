import { useCallback, useEffect, useState } from "react";
import { RiArrowDownLine, RiArrowUpLine, RiCompass3Line, RiRefreshLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/badges/chip";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { cx } from "@/utils/cx";
import { Panel } from "@/src/features/journal/ui";
import { INSTRUMENTS, buildDayContext, chartUrl, parseChart } from "@/src/features/day-context/levels";

// ─── Day Context ────────────────────────────────────────────────────────────
// Pre-session reference levels for NQ/ES futures: previous day/week extremes,
// midnight open, Asia and London ranges, and how much of a typical day's range
// has already been used. Reference numbers only, not signals.

const INSTRUMENT_KEY = "myjournal_day_context_instrument";
const REFRESH_MS = 5 * 60 * 1000;

const price = (n) => (n == null || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pts = (n) => (n == null || Number.isNaN(n) ? "—" : `${Math.round(n).toLocaleString("en-US")} pts`);

function readInstrument() {
  try {
    const saved = localStorage.getItem(INSTRUMENT_KEY);
    return INSTRUMENTS.some((i) => i.id === saved) ? saved : "NQ";
  } catch {
    return "NQ";
  }
}

async function getChart(workerUrl, symbol, interval, range) {
  const res = await fetch(chartUrl(workerUrl, symbol, interval, range));
  if (!res.ok) throw new Error(res.status === 404 ? "route-missing" : `HTTP ${res.status}`);
  return parseChart(await res.json());
}

async function fetchDayContext(workerUrl, instrumentId) {
  const { symbol } = INSTRUMENTS.find((i) => i.id === instrumentId);
  try {
    const [daily, intraday] = await Promise.all([
      getChart(workerUrl, symbol, "1d", "3mo"),
      getChart(workerUrl, symbol, "5m", "5d"),
    ]);
    return { key: instrumentId, data: buildDayContext(daily, intraday), error: null };
  } catch (err) {
    return { key: instrumentId, data: null, error: err.message || "Could not load levels" };
  }
}

function useDayContext(workerUrl, instrumentId) {
  // Results are tagged with the instrument they belong to, so switching
  // instruments shows a skeleton instead of the other instrument's levels.
  const [state, setState] = useState({ key: null, data: null, error: null });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () => fetchDayContext(workerUrl, instrumentId).then(setState),
    [workerUrl, instrumentId],
  );

  useEffect(() => {
    let active = true;
    const run = () => fetchDayContext(workerUrl, instrumentId).then((next) => { if (active) setState(next); });
    run();
    const id = setInterval(() => { if (document.visibilityState === "visible") run(); }, REFRESH_MS);
    return () => { active = false; clearInterval(id); };
  }, [workerUrl, instrumentId]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const current = state.key === instrumentId;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !current || refreshing,
    reload,
  };
}

function Distance({ from, to }) {
  if (from == null || to == null) return <span className="text-body-2-regular text-text-tertiary">—</span>;
  const diff = from - to;
  const Icon = diff >= 0 ? RiArrowUpLine : RiArrowDownLine;
  return (
    <span className="inline-flex items-center gap-1 text-body-2-regular text-text-secondary">
      <Icon size={14} className="text-foreground-icon-tertiary" aria-hidden="true" />
      {Math.abs(diff).toLocaleString("en-US", { maximumFractionDigits: 2 })} pts {diff >= 0 ? "above" : "below"}
    </span>
  );
}

function LevelTile({ short, label, value, current, nearest }) {
  return (
    <div className={cx(
      "flex flex-col gap-1 rounded-xl border p-3",
      nearest ? "border-accent-300 bg-accent-50" : "border-separator-border bg-background-primary-default",
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption-1-semibold text-text-tertiary" title={label}>{short}</span>
        {nearest && <Chip variant="caption" color="blue">Nearest</Chip>}
      </div>
      <span className="text-headline-medium text-text-primary tabular-nums">{price(value)}</span>
      <Distance from={current} to={value} />
    </div>
  );
}

const STATE_CHIP = {
  forming: { color: "yellow", text: "Forming" },
  upcoming: { color: "neutral", text: "Upcoming" },
  done: { color: "soft", text: "Set" },
};

function WindowTile({ win }) {
  const chip = STATE_CHIP[win.state];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-separator-border bg-background-primary-default p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-medium text-text-primary">{win.label} <span className="text-body-2-regular text-text-tertiary">{win.hours} NY</span></span>
        <Chip variant="caption" color={chip.color}>{chip.text}</Chip>
      </div>
      {win.high == null ? (
        <span className="text-body-2-regular text-text-tertiary">No data yet</span>
      ) : (
        <dl className="grid grid-cols-3 gap-2">
          <div><dt className="text-caption-1-semibold text-text-tertiary">High</dt><dd className="text-body-medium text-text-primary tabular-nums">{price(win.high)}</dd></div>
          <div><dt className="text-caption-1-semibold text-text-tertiary">Low</dt><dd className="text-body-medium text-text-primary tabular-nums">{price(win.low)}</dd></div>
          <div><dt className="text-caption-1-semibold text-text-tertiary">Range</dt><dd className="text-body-medium text-text-primary tabular-nums">{pts(win.range)}</dd></div>
        </dl>
      )}
    </div>
  );
}

export default function DayContext({ workerUrl }) {
  const [instrument, setInstrument] = useState(readInstrument);
  const { data, error, loading, reload } = useDayContext(workerUrl, instrument);

  function changeInstrument(keys) {
    const next = [...keys][0];
    if (!next) return;
    setInstrument(next);
    try { localStorage.setItem(INSTRUMENT_KEY, next); } catch { /* storage unavailable */ }
  }

  const nearestId = data
    ? data.levels.filter((l) => l.value != null).reduce((best, l) => (!best || Math.abs(data.price - l.value) < Math.abs(data.price - best.value) ? l : best), null)?.id
    : null;
  const used = data?.session.usedOfAdr5;
  const dateLabel = data ? new Date(`${data.sessionDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : null;

  return (
    <Panel
      icon={RiCompass3Line}
      title="Day context"
      subtitle={data ? `${instrument} session ${dateLabel} · New York time` : "Key levels for today's session"}
      action={
        <>
          <SegmentedControl aria-label="Instrument" selectedKeys={new Set([instrument])} onSelectionChange={changeInstrument}>
            {INSTRUMENTS.map((i) => <SegmentedControlItem key={i.id} id={i.id}>{i.label}</SegmentedControlItem>)}
          </SegmentedControl>
          <Button variant="secondary" iconOnly leadingIcon={RiRefreshLine} aria-label="Refresh day context" title="Refresh day context" disabled={loading} onClick={reload} className={cx(loading && "refresh-loading")} />
        </>
      }
    >

      {error && !data ? (
        <p className="rounded-xl border border-separator-border bg-background-secondary-default p-4 text-body-2-regular text-text-secondary">
          {error === "route-missing"
            ? "Futures data isn't connected yet. Add the /futures route to the Worker to show live levels."
            : `Couldn't load futures levels (${error}). Try refreshing in a minute.`}
        </p>
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-background-secondary-default" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="flex flex-col gap-1 rounded-xl border border-separator-border bg-background-primary-default p-4">
              <span className="text-caption-1-semibold text-text-tertiary">Last price</span>
              <span className="text-title-2-medium text-text-primary tabular-nums">{price(data.price)}</span>
              <span className="text-body-2-regular text-text-tertiary">
                {data.asOf ? `as of ${new Date(data.asOf * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} NY` : ""}
              </span>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-separator-border bg-background-primary-default p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-caption-1-semibold text-text-tertiary">Session so far</span>
                <span className="text-body-2-regular text-text-secondary tabular-nums">
                  H {price(data.session.high)} · L {price(data.session.low)} · {pts(data.session.range)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-background-tertiary-default" role="meter" aria-label="Share of 5-day average range used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used != null ? Math.round(used * 100) : undefined}>
                <div className="h-full rounded-full bg-accent-500 transition-[width] duration-500" style={{ width: `${Math.min(100, (used ?? 0) * 100)}%` }} />
              </div>
              <span className="text-body-2-regular text-text-secondary">
                {used != null ? `${Math.round(used * 100)}% of the 5-day average range used` : "Not enough history for a 5-day average"}
              </span>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-body-medium text-text-primary">Key levels</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {data.levels.map((l) => <LevelTile key={l.id} {...l} current={data.price} nearest={l.id === nearestId} />)}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <WindowTile win={data.windows.asia} />
            <WindowTile win={data.windows.london} />
          </div>

          <div>
            <h3 className="mb-2 text-body-medium text-text-primary">Range reference</h3>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {data.rangeRef.map((r) => (
                <div key={r.id} className="rounded-xl border border-separator-border bg-background-primary-default p-3">
                  <dt className="text-caption-1-semibold text-text-tertiary">{r.label}</dt>
                  <dd className="text-headline-medium text-text-primary tabular-nums">{pts(r.value)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="text-body-2-regular text-text-tertiary">
            CME futures, 5-minute bars, can lag a few minutes. Average ranges come from past sessions and are not targets. Reference levels only, not trade signals.
          </p>
        </>
      )}
    </Panel>
  );
}
