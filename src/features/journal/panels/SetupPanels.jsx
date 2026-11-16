import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RiBarChartBoxLine, RiFocus3Line, RiNodeTree } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { ProgressTrack } from "@/components/base/progress/progress";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { cx } from "@/utils/cx";
import { AXIS_TICK, CHART_NEGATIVE, CHART_POSITIVE, signedR, signedUSD, toneClass } from "@/src/features/journal/format";
import { buildConfluenceStats } from "@/src/features/journal/stats";
import { ChartTooltip, EmptyState, InlineInsight, Panel, SkeletonStack } from "@/src/features/journal/ui";

function expectancyOf(setup) {
  const wr = setup.winRate / 100;
  return Number(((wr * Math.max(0, setup.avgR)) - ((1 - wr) * Math.abs(Math.min(0, setup.avgR)))).toFixed(2));
}

function SetupRow({ setup }) {
  const expectancy = expectancyOf(setup);
  return (
    <li className="flex items-center justify-between gap-4 border-b border-separator-border py-3 last:border-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-body-medium text-text-primary">{setup.setup}</span>
        <span className="text-body-2-regular text-text-tertiary">{setup.trades} {setup.trades === 1 ? "trade" : "trades"} · {setup.winRate}% win rate</span>
        <ProgressTrack percentage={setup.winRate} size="sm" className="max-w-40" />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className={cx("text-body-medium tabular-nums", toneClass(setup.totalR))}>{signedR(setup.totalR)}</span>
        <span className="text-body-2-regular tabular-nums text-text-tertiary">avg {signedR(setup.avgR)}</span>
        <span className={cx("text-body-2-medium tabular-nums", toneClass(expectancy))}>E {signedR(expectancy)}</span>
      </div>
    </li>
  );
}

function TradeLog({ trades, loading }) {
  if (loading) return <SkeletonStack count={5} className="h-10" />;
  if (!trades?.length) return <EmptyState>No trades in this range.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[540px] text-start">
        <thead>
          <tr className="text-caption-1-semibold text-text-tertiary">
            {["Date", "Pair", "Setup", "Result", "Session", "R / $"].map((h, i) => (
              <th key={h} className={cx("px-3 pb-2 font-[inherit]", i === 5 ? "text-end" : "text-start")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 20).map((t) => {
            const r = typeof t.r === "number" ? t.r : 0;
            const pnl = typeof t.pnl === "number" ? t.pnl : 0;
            return (
              <tr key={t.id} className="border-t border-separator-border transition-colors hover:bg-background-secondary-default">
                <td className="px-3 py-2.5 text-body-2-regular tabular-nums text-text-secondary">
                  {t.date ? new Date(t.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                </td>
                <td className="px-3 py-2.5 text-body-2-medium text-text-primary">{t.pair || "—"}</td>
                <td className="px-3 py-2.5 text-body-2-regular text-text-secondary">{t.setup || "—"}</td>
                <td className="px-3 py-2.5"><Chip variant="caption" color={t.win ? "lime" : "rose"}>{t.win ? "Win" : "Loss"}</Chip></td>
                <td className="px-3 py-2.5 text-body-2-regular text-text-secondary">{t.session || "—"}</td>
                <td className="px-3 py-2.5 text-end">
                  <span className={cx("block text-body-2-medium tabular-nums", toneClass(r))}>{signedR(r)}</span>
                  {pnl !== 0 && <span className={cx("block text-caption-1-medium tabular-nums", toneClass(pnl))}>{signedUSD(pnl)}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SetupsPanel({ data, loading }) {
  return (
    <Panel icon={RiFocus3Line} title="Setups" subtitle="Win rate, total R and expectancy (E) per setup">
      <Tabs defaultSelectedKey="setups">
        <TabList aria-label="Setup views">
          <Tab id="setups">Setup stats</Tab>
          <Tab id="trades" count={data?.trades?.length || undefined}>Trade log</Tab>
        </TabList>
        <TabPanel id="setups" className="flex flex-col gap-4 pt-2">
          {loading ? <SkeletonStack /> : data?.setupStats?.length ? (
            <ul>{data.setupStats.map((s) => <SetupRow key={s.setup} setup={s} />)}</ul>
          ) : <EmptyState>No setups in this range.</EmptyState>}
          <InlineInsight
            prompt="In one sentence, which setup has the best expectancy and why should the trader focus on it?"
            trades={data?.trades}
            stats={{ count: data?.count, winRate: data?.winRate, totalR: data?.totalR, netProfit: data?.netProfit }}
          />
        </TabPanel>
        <TabPanel id="trades" className="pt-2">
          <TradeLog trades={data?.trades} loading={loading} />
        </TabPanel>
      </Tabs>
    </Panel>
  );
}

export function WinRateChart({ data, loading }) {
  const setups = data?.setupStats || [];
  return (
    <Panel icon={RiBarChartBoxLine} title="Win rate by setup" subtitle="Teal at 50% or above, red below">
      {loading ? <Skeleton className="h-64 w-full rounded-xl" /> : !setups.length ? <EmptyState>No setups in this range.</EmptyState> : (
        <div className="min-h-64 flex-1">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 256 }}>
            <BarChart data={setups} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="var(--color-separator-border)" />
              <XAxis dataKey="setup" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={40} />
              <Tooltip content={<ChartTooltip format={(v) => `${v}% win rate`} />} cursor={{ fill: "var(--color-background-secondary-default)" }} />
              <Bar dataKey="winRate" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {setups.map((s) => <Cell key={s.setup} fill={s.winRate >= 50 ? CHART_POSITIVE : CHART_NEGATIVE} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

export function ConfluencePanel({ trades, loading }) {
  const confluences = useMemo(() => buildConfluenceStats(trades || []), [trades]);
  const fade = useScrollFade();
  return (
    <Panel icon={RiNodeTree} title="Confluence breakdown" subtitle="Which confluences line up with wins">
      {loading ? <SkeletonStack count={4} className="h-12" /> : !confluences.length ? (
        <EmptyState>Add confluences to your trades in Notion to unlock this breakdown.</EmptyState>
      ) : (
        <div className="relative">
          <ScrollFade progress={fade.progress} surfaceClassName="from-background-primary-default" />
          <ul onScroll={fade.onScroll} className="grid max-h-72 gap-x-6 overflow-y-auto md:grid-cols-2">
            {confluences.map((c) => (
              <li key={c.name} className="flex items-center gap-4 border-b border-separator-border py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="truncate text-body-medium text-text-primary">{c.name}</span>
                  <ProgressTrack percentage={c.winRate} size="sm" className={c.winRate >= 50 ? undefined : "text-text-error-primary"} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={cx("text-body-2-medium tabular-nums", c.winRate >= 50 ? "text-accent-700" : "text-text-error-primary")}>{c.winRate}% WR</span>
                  <span className="text-caption-1-medium tabular-nums text-text-tertiary">{c.count}× · E {signedR(c.expectancy)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
