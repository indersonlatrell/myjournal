import { useEffect, useState } from "react";
import { RiSparklingLine } from "@remixicon/react";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { cx } from "@/utils/cx";
import { askJournal } from "./stats";

// ─── Shared card primitives ─────────────────────────────────────────────────
// Every dashboard card uses Panel so headers, padding, gaps and type match.

export function Panel({ icon: Icon, title, subtitle, action, children, className, as: Tag = "section" }) {
  return (
    <Tag className={cx("glass-panel flex min-w-0 flex-col gap-4 p-5", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && <Icon size={18} className="mt-0.5 shrink-0 text-foreground-icon-secondary" aria-hidden="true" />}
            <div className="min-w-0">
              <h2 className="text-headline-medium text-text-primary">{title}</h2>
              {subtitle && <p className="text-body-2-regular text-text-tertiary">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}

export function EmptyState({ children, className }) {
  return (
    <p className={cx("rounded-xl border border-separator-border bg-background-secondary-default p-4 text-body-2-regular text-text-secondary", className)}>
      {children}
    </p>
  );
}

// Bordered inner surface for grouped figures inside a Panel.
export function Tile({ children, className }) {
  return (
    <div className={cx("rounded-xl border border-separator-border bg-background-primary-default p-3", className)}>
      {children}
    </div>
  );
}

export function Metric({ label, value, hint, valueClassName, size = "md" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption-1-semibold text-text-tertiary">{label}</span>
      <span className={cx(size === "lg" ? "text-title-2-medium" : "text-headline-medium", "tabular-nums text-text-primary", valueClassName)}>{value}</span>
      {hint && <span className="text-body-2-regular text-text-tertiary">{hint}</span>}
    </div>
  );
}

export function SkeletonStack({ count = 3, className = "h-14" }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className={cx("w-full rounded-xl", className)} />)}
    </div>
  );
}

// Recharts tooltip with token colours; `format` turns the value into text.
export function ChartTooltip({ active, payload, label, format = (v) => v }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-separator-border bg-background-primary-default px-3 py-2 shadow-md">
      <p className="text-caption-1-medium text-text-tertiary">{label}</p>
      <p className="text-body-medium tabular-nums text-text-primary">{format(payload[0].value)}</p>
    </div>
  );
}

// One-sentence AI read on the data. Renders nothing when the AI is unavailable.
export function InlineInsight({ prompt, trades, stats }) {
  const [result, setResult] = useState(null);
  const request = JSON.stringify({ prompt, trades, stats });
  const hasTrades = Boolean(trades?.length);
  const loading = hasTrades && result?.request !== request;
  const insight = hasTrades && result?.request === request ? result.insight : null;

  useEffect(() => {
    if (!hasTrades) return;
    const controller = new AbortController();
    askJournal({ question: prompt, trades, stats, signal: controller.signal })
      .then((reply) => { if (!controller.signal.aborted) setResult({ request, insight: reply }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ request, insight: null }); });
    return () => controller.abort();
    // `request` already encodes prompt, trades and stats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, hasTrades]);

  if (loading) return <Skeleton className="h-10 w-full rounded-xl" />;
  if (!insight) return null;

  return (
    <div className="flex items-start gap-2 rounded-xl border border-accent-100 bg-accent-50 p-3">
      <RiSparklingLine size={16} className="mt-0.5 shrink-0 text-accent-700" aria-hidden="true" />
      <p className="text-body-2-regular text-text-primary">{insight}</p>
    </div>
  );
}
