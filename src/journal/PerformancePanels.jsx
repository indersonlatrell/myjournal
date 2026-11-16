import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RiArrowRightUpLine, RiBarChartGroupedLine, RiCalendarCheckLine, RiFocus3Line, RiLineChartLine, RiPencilLine, RiTrophyLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ProgressBar } from "@/components/base/progress/progress";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { cx } from "@/utils/cx";
import { AXIS_TICK, CHART_NEGATIVE, CHART_POSITIVE, fmt, signedR, signedUSD, toneClass } from "./format";
import { buildMonthlyPnl, buildWeeklyGrid } from "./stats";
import { ChartTooltip, EmptyState, InlineInsight, Metric, Panel, SkeletonStack, Tile } from "./ui";

const PAYOUT_KEY = "myjournal_payout_target";

function readTarget() {
  try {
    const saved = localStorage.getItem(PAYOUT_KEY);
    return saved ? Number(saved) : null;
  } catch {
    return null;
  }
}

// ─── Equity curve ──────────────────────────────────────────────────────────
export function EquityPanel({ data, netPnl, equityCurve, loading, rangeLabel }) {
  const [mode, setMode] = useState("r");
  const total = mode === "r" ? data?.totalR : netPnl;
  const format = mode === "r" ? signedR : signedUSD;

  return (
    <Panel
      icon={RiLineChartLine}
      title="Equity curve"
      subtitle={`Cumulative performance over the ${rangeLabel}`}
      action={
        <SegmentedControl aria-label="Equity chart unit" selectedKeys={new Set([mode])} onSelectionChange={(keys) => setMode([...keys][0])}>
          <SegmentedControlItem id="r">R multiple</SegmentedControlItem>
          <SegmentedControlItem id="pnl">USD</SegmentedControlItem>
        </SegmentedControl>
      }
    >
      <div className="flex items-baseline gap-2">
        {loading ? <Skeleton className="h-9 w-40 rounded-lg" /> : (
          <span className={cx("text-display-3-medium tabular-nums", toneClass(total))}>{data ? format(total) : "N/A"}</span>
        )}
        <span className="text-body-2-regular text-text-tertiary">{mode === "r" ? "net return" : "net profit"}</span>
      </div>
      {loading ? <Skeleton className="h-64 w-full rounded-xl" /> : equityCurve.length === 0 ? (
        <EmptyState className="flex h-64 items-center justify-center">No trade data for this range.</EmptyState>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 256 }}>
            <AreaChart data={equityCurve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent-500)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="var(--color-accent-500)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="var(--color-separator-border)" />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48}
                tickFormatter={(v) => (mode === "r" ? `${v}R` : `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`)} />
              <Tooltip content={<ChartTooltip format={format} />} />
              <Area type="monotone" dataKey={mode === "r" ? "equity" : "pnl"} fill="url(#equity-fill)"
                stroke={total >= 0 ? CHART_POSITIVE : CHART_NEGATIVE} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <InlineInsight
        prompt="In one sentence, identify the single most important pattern in this equity curve — what's driving the biggest gains or losses?"
        trades={data?.trades}
        stats={{ count: data?.count, winRate: data?.winRate, totalR: data?.totalR, netProfit: data?.netProfit }}
      />
    </Panel>
  );
}

// ─── Payout tracker ────────────────────────────────────────────────────────
export function PayoutTracker({ netPnl, loading, fnTarget }) {
  const [manualTarget, setManualTarget] = useState(readTarget);
  const target = manualTarget ?? (Number(fnTarget) > 0 ? Number(fnTarget) : 0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function save() {
    const n = parseFloat(draft);
    if (!Number.isNaN(n) && n > 0) {
      setManualTarget(n);
      try { localStorage.setItem(PAYOUT_KEY, String(n)); } catch { /* storage unavailable */ }
    }
    setEditing(false);
  }

  const progress = target > 0 ? Math.min(100, Math.max(0, (netPnl / target) * 100)) : 0;
  const remaining = target > 0 ? Math.max(0, target - netPnl) : 0;
  const achieved = target > 0 && netPnl >= target;

  return (
    <Panel
      icon={RiTrophyLine}
      title="Payout tracker"
      subtitle="Your next trading milestone"
      action={!editing && (
        <Button variant="ghost" size="small" leadingIcon={RiPencilLine} onClick={() => { setEditing(true); setDraft(target ? String(target) : ""); }}>
          {target > 0 ? "Edit" : "Set target"}
        </Button>
      )}
    >
      {editing ? (
        <div className="flex items-end gap-2">
          <Input label="Payout target ($)" type="number" value={draft} onChange={setDraft} placeholder="1000" autoFocus
            onKeyDown={(e) => e.key === "Enter" && save()} className="flex-1" />
          <Button onClick={save}>Save</Button>
        </div>
      ) : target === 0 ? (
        <EmptyState>Set a target to track progress toward your next payout.</EmptyState>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            {loading ? <Skeleton className="h-8 w-28 rounded-lg" /> : (
              <span className={cx("text-title-2-medium tabular-nums", toneClass(netPnl))}>{signedUSD(netPnl)}</span>
            )}
            <span className="text-body-2-regular text-text-tertiary">of ${fmt(target, 0)}</span>
          </div>
          <ProgressBar aria-label="Progress to payout target" value={progress}
            description={achieved ? "Target reached. Request your payout." : `${fmt(progress, 1)}% complete · $${fmt(remaining, 2)} to go`} />
        </>
      )}
    </Panel>
  );
}

// Shown in place of the account gauge for non-funded accounts.
export function ProcessCard({ onReview }) {
  return (
    <Panel icon={RiFocus3Line} title="Process over outcome" subtitle="Review execution, follow your rules, let results follow.">
      <Button variant="secondary" trailingIcon={RiArrowRightUpLine} onClick={onReview} className="self-start">Review psychology</Button>
    </Panel>
  );
}

// ─── Streak strip ──────────────────────────────────────────────────────────
export function StreakStrip({ streak, data, loading }) {
  const current = streak.type
    ? `${streak.current} ${streak.type === "win" ? (streak.current === 1 ? "win" : "wins") : (streak.current === 1 ? "loss" : "losses")}`
    : "No trades";
  const warning = streak.type === "loss" && streak.current >= 2 ? `${streak.current} losses in a row. Consider stepping back.` : null;
  return (
    <section className="glass-panel grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
      <Metric label="Current streak" value={loading ? "…" : current} valueClassName={streak.type === "loss" ? "text-text-error-primary" : undefined} />
      <Metric label="Longest win streak" value={loading ? "…" : `${streak.longest} ${streak.longest === 1 ? "trade" : "trades"}`} />
      <Metric label="Average R" value={data ? signedR(data.avgR) : "N/A"} valueClassName={toneClass(data?.avgR)} />
      <p className={cx("col-span-2 self-center text-body-2-regular md:col-span-1", warning ? "text-text-error-primary" : "text-text-tertiary")}>
        {warning || "Small improvements. Measurable progress."}
      </p>
    </section>
  );
}

// ─── Weekly summary ────────────────────────────────────────────────────────
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function dayCellClass(hasData, r) {
  if (!hasData) return "bg-background-secondary-default text-text-tertiary";
  if (r > 0) return "bg-accent-50 text-accent-700";
  if (r < 0) return "bg-background-tertiary-error text-text-error-primary";
  return "bg-background-tertiary-default text-text-secondary";
}

export function WeeklySummary({ trades, loading }) {
  const weeks = useMemo(() => buildWeeklyGrid(trades || []), [trades]);
  return (
    <Panel icon={RiCalendarCheckLine} title="Weekly summary" subtitle="R per trading day, newest week first">
      {loading ? <SkeletonStack /> : !weeks.length ? <EmptyState>No trades in this range.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-start">
            <thead>
              <tr className="text-caption-1-semibold text-text-tertiary">
                <th className="pb-2 pe-3 text-start font-[inherit]">Week of</th>
                {DAY_LABELS.map((d) => <th key={d} className="px-1 pb-2 text-center font-[inherit]">{d}</th>)}
                <th className="pb-2 ps-3 text-end font-[inherit]">Total</th>
                <th className="pb-2 ps-2 text-end font-[inherit]">P&L</th>
                <th className="pb-2 ps-2 text-end font-[inherit]">WR</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.label} className="border-t border-separator-border">
                  <td className="py-2 pe-3 text-body-2-regular whitespace-nowrap text-text-secondary">{week.label}</td>
                  {[0, 1, 2, 3, 4].map((i) => {
                    const day = week.days[i];
                    const hasData = Boolean(day?.trades);
                    return (
                      <td key={i} className="px-1 py-2 text-center">
                        <span className={cx("inline-flex h-8 w-14 items-center justify-center rounded-lg text-body-2-medium tabular-nums", dayCellClass(hasData, day?.r))}>
                          {hasData ? `${day.r >= 0 ? "+" : ""}${fmt(day.r, 1)}R` : "—"}
                        </span>
                      </td>
                    );
                  })}
                  <td className={cx("py-2 ps-3 text-end text-body-2-medium tabular-nums", toneClass(week.totalR))}>{signedR(week.totalR)}</td>
                  <td className={cx("py-2 ps-2 text-end text-body-2-regular tabular-nums", toneClass(week.pnl))}>{week.pnl !== 0 ? signedUSD(week.pnl) : "—"}</td>
                  <td className="py-2 ps-2 text-end text-body-2-regular tabular-nums text-text-tertiary">{week.trades > 0 ? `${week.winRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ─── Monthly P&L ───────────────────────────────────────────────────────────
export function MonthlyPnl({ trades, loading }) {
  const months = useMemo(() => buildMonthlyPnl(trades || []), [trades]);
  return (
    <Panel icon={RiBarChartGroupedLine} title="Monthly P&L" subtitle="Net profit per month · latest months listed newest first">
      {loading ? <Skeleton className="h-48 w-full rounded-xl" /> : !months.length ? <EmptyState>No trades in this range.</EmptyState> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="h-48 lg:h-auto lg:min-h-48">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 280, height: 192 }}>
              <BarChart data={months} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="var(--color-separator-border)" />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={52}
                  domain={[(min) => Math.min(0, min), (max) => Math.max(0, max)]}
                  tickFormatter={(v) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)}`} />
                <Tooltip content={<ChartTooltip format={signedUSD} />} cursor={{ fill: "var(--color-background-secondary-default)" }} />
                <Bar dataKey="pnl" radius={[6, 6, 6, 6]} maxBarSize={56}>
                  {months.map((m) => <Cell key={m.key} fill={m.pnl >= 0 ? CHART_POSITIVE : CHART_NEGATIVE} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-2">
            {months.slice(-3).reverse().map((m) => (
              <Tile key={m.key}>
                <Metric label={m.label} value={signedUSD(m.pnl)} valueClassName={toneClass(m.pnl)} hint={`${m.winRate}% WR · ${m.trades} trades`} />
              </Tile>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

