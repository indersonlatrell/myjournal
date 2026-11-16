import { useState, useEffect, useCallback } from "react";
import { RiShieldLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { ProgressBar } from "@/components/base/progress/progress";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { EmptyState, Metric, Panel, Tile } from "@/src/features/journal/ui";
import { isBreached } from "@/src/features/account/accountStatus";

// ─── FundedNext Account Risk gauge ──────────────────────────────────────────
// Live challenge-account state (distance-to-breach, profit target, daily-loss
// buffer, consistency) sourced from the Cloudflare Worker `/status` route, which
// reads the "FN Account Status" Notion DB kept fresh twice a day by the
// scheduled jobs. Degrades gracefully: if the route isn't wired up yet, it
// renders a quiet hint instead of breaking the dashboard.

function money(n, d = 2) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  const v = Math.abs(Number(n)).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return (Number(n) < 0 ? "-$" : "$") + v;
}

// Hook: fetch account status from `${workerUrl}status`. Returns null on any
// error or if the route is missing, so callers can render a fallback.
export function useFnStatus(workerUrl) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${workerUrl}status`);
      if (!res.ok) { setStatus(null); return; }
      const json = await res.json();
      const acc = json?.account || (json?.success === false ? null : json);
      const valid = acc && (acc.distanceToBreach !== undefined || acc.profitTarget !== undefined);
      setStatus(valid ? acc : null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [workerUrl]);

  useEffect(() => { load(); }, [load]);
  return { status, loading, reload: load };
}

function accountName(status) {
  return status.account ? status.account.split(" — ")[0] : "Funded account";
}

export default function RiskGauge({ status, loading }) {
  if (loading) {
    return (
      <Panel icon={RiShieldLine} title="Account risk">
        <Skeleton className="h-16 w-full rounded-xl" />
      </Panel>
    );
  }

  if (!status) {
    return (
      <Panel icon={RiShieldLine} title="Account risk">
        <EmptyState>Account status isn't connected yet. Add the /status route to the Worker to show the live breach gauge.</EmptyState>
      </Panel>
    );
  }

  if (isBreached(status)) {
    return (
      <Panel icon={RiShieldLine} title="Account risk" subtitle={accountName(status)} action={<Chip variant="caption" color="rose">Breached</Chip>}>
        <p className="text-body-2-regular text-text-secondary">
          This account is closed. Add your new account to the Account Status table in Notion and this card picks it up automatically.
        </p>
        {status.updated && <span className="text-caption-1-medium text-text-tertiary">Marked {new Date(status.updated).toLocaleDateString()}</span>}
      </Panel>
    );
  }

  const dist = Number(status.distanceToBreach);
  const target = Number(status.profitTarget) || 0;
  const current = Number(status.currentProfit) || 0;
  const floor = Number(status.breachFloorEquity) || 0;
  const alert = Boolean(status.breachAlert) || (dist > 0 && dist < 500);
  const progress = target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0;

  return (
    <Panel icon={RiShieldLine} title="Account risk" subtitle={`${accountName(status)} · ${status.login ? `#${status.login}` : "Active"}`}
      action={alert ? <Chip variant="caption" color="rose">Close to breach</Chip> : <Chip variant="caption" color="lime">Active</Chip>}>
      <Metric size="lg" label="Buffer to breach" value={money(dist)} valueClassName={alert ? "text-text-error-primary" : undefined}
        hint={floor > 0 ? `Equity floor ${money(floor, 0)}` : undefined} />
      {target > 0 && (
        <ProgressBar label="Profit target" value={progress} description={`${money(current, 0)} of ${money(target, 0)}`} />
      )}
      {(status.dailyLossRemaining != null || status.consistency) && (
        <div className="grid grid-cols-2 gap-2">
          {status.dailyLossRemaining != null && <Tile><Metric label="Daily loss left" value={money(status.dailyLossRemaining)} /></Tile>}
          {status.consistency && <Tile><Metric label="Consistency" value={status.consistency} /></Tile>}
        </div>
      )}
      {status.updated && <span className="text-caption-1-medium text-text-tertiary">Synced {new Date(status.updated).toLocaleString()}</span>}
    </Panel>
  );
}
