import { useMemo } from "react";
import { RiPriceTag3Line } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { ProgressTrack } from "@/components/base/progress/progress";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { cx } from "@/utils/cx";
import { signedR } from "@/src/features/journal/format";
import { EmptyState, Metric, Panel, SkeletonStack, Tile } from "@/src/features/journal/ui";

// ─── Chart annotations ──────────────────────────────────────────────────────
// The text the trader writes on their chart screenshots, transcribed by
// scripts/analyze-charts.mjs and stored by worker/src/routes/chartAnalysis.js.
// Labels are grouped case- and spacing-insensitively ("M15 FvG" = "M15 FVG"),
// then scored like confluences: trades, win rate and average R.

const normalise = (label) => label.trim().replace(/\s+/g, " ").toUpperCase();

function buildAnnotationStats(trades) {
  const map = new Map();
  for (const t of trades) {
    const seen = new Set();
    for (const raw of t.chart.annotations) {
      const key = normalise(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const s = map.get(key) || { key, spellings: new Map(), count: 0, wins: 0, totalR: 0 };
      s.spellings.set(raw, (s.spellings.get(raw) || 0) + 1);
      s.count++;
      if (t.win) s.wins++;
      s.totalR += typeof t.r === "number" ? t.r : 0;
      map.set(key, s);
    }
  }
  return [...map.values()]
    .map((s) => {
      // The most common spelling is the one shown.
      const name = [...s.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { key: s.key, name, count: s.count, winRate: Math.round((s.wins / s.count) * 100), avgR: Number((s.totalR / s.count).toFixed(2)) };
    })
    .sort((a, b) => b.count - a.count || b.avgR - a.avgR);
}

export function ChartAnnotationsPanel({ trades, loading }) {
  const annotated = useMemo(() => (trades || []).filter((t) => t.chart?.annotations?.length), [trades]);
  const stats = useMemo(() => buildAnnotationStats(annotated), [annotated]);
  const fade = useScrollFade();

  return (
    <Panel icon={RiPriceTag3Line} title="Chart annotations" subtitle="The labels you write on your screenshots, with the results of the trades they appear on">
      {loading ? <SkeletonStack count={3} className="h-16" /> : !annotated.length ? (
        <EmptyState>No annotations transcribed yet in this range. New screenshots are picked up automatically every 30 minutes while your Mac is on.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Tile><Metric label="Trades with annotations" value={`${annotated.length} of ${trades.length}`} /></Tile>
            <Tile><Metric label="Different labels" value={stats.length} hint="Grouped regardless of capitals and spacing" /></Tile>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-caption-1-semibold text-text-tertiary">Per label</h3>
            <div className="relative">
              <ScrollFade progress={fade.progress} surfaceClassName="from-background-primary-default" />
              <ul onScroll={fade.onScroll} className="grid max-h-80 gap-x-6 overflow-y-auto md:grid-cols-2">
                {stats.map((s) => (
                  <li key={s.key} className="flex items-center gap-4 border-b border-separator-border py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="truncate text-body-2-medium text-text-primary">{s.name}</span>
                      <ProgressTrack percentage={s.winRate} size="sm" className={s.winRate >= 50 ? undefined : "text-text-error-primary"} />
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className={cx("text-body-2-medium tabular-nums", s.winRate >= 50 ? "text-accent-700" : "text-text-error-primary")}>{s.winRate}% WR</span>
                      <span className="text-caption-1-medium tabular-nums text-text-tertiary">{s.count}× · avg {signedR(s.avgR)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-caption-1-semibold text-text-tertiary">Per trade</h3>
            <ul className="flex flex-col gap-2">
              {annotated.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 rounded-xl border border-separator-border bg-background-primary-default p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-body-2-medium text-text-primary">{t.trade}</span>
                    <Chip variant="caption" color={t.win ? "lime" : "rose"}>{t.win ? "Win" : "Loss"} · {signedR(t.r)}</Chip>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {t.chart.annotations.map((a) => <Chip key={a} variant="caption" color="neutral">{a}</Chip>)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}
