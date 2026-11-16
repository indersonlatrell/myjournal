import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Target } from "lucide-react";
import { RiErrorWarningLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { isBreached } from "./lib/accountStatus";

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

function BreachedCard({ status }) {
  return (
    <div className="glass-panel flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-headline-medium text-text-primary">
          <RiErrorWarningLine size={16} className="text-text-error-primary" aria-hidden="true" /> Account Risk
        </h2>
        <Chip variant="caption" color="rose">Breached</Chip>
      </div>
      <p className="text-body-medium text-text-primary">{status.account ? status.account.split(" — ")[0] : "Funded account"} is closed.</p>
      <p className="text-body-2-regular text-text-secondary">
        No active funded account. Add your new account to the Account Status table in Notion and the gauge picks it up automatically.
      </p>
      {status.updated && (
        <p className="text-body-2-regular text-text-tertiary">Marked {new Date(status.updated).toLocaleDateString()}</p>
      )}
    </div>
  );
}

export default function RiskGauge({ status, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="h-4 w-40 bg-slate-100 rounded animate-pulse mb-4" />
        <div className="h-8 w-32 bg-slate-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-slate-400" /> Account Risk
        </h2>
        <p className="text-[10px] font-mono text-slate-400 mt-3">
          Account status not connected yet. Add the{" "}
          <span className="text-slate-600">/status</span> route to the Worker to unlock the live breach gauge.
        </p>
      </div>
    );
  }

  if (isBreached(status)) return <BreachedCard status={status} />;

  const dist = Number(status.distanceToBreach);
  const target = Number(status.profitTarget) || 0;
  const current = Number(status.currentProfit) || 0;
  const floor = Number(status.breachFloorEquity) || 0;
  const alert = Boolean(status.breachAlert) || (dist > 0 && dist < 500);
  const progress = target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0;

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 ${alert ? "border-red-300" : "border-slate-200"}`}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <AlertTriangle size={14} className={alert ? "text-red-500" : "text-amber-500"} />
          Account Risk
        </h2>
        <span className="text-[10px] font-mono text-slate-400">
          {status.login ? `#${status.login}` : (status.account || "Account")}
        </span>
      </div>
      <p className="text-[10px] font-mono text-slate-400 mb-4">
        {status.account ? status.account.split(" — ")[0] : "Funded account"} · {status.status || "Active"}
      </p>

      {alert && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-xs font-mono text-red-700 flex items-center gap-2">
          <AlertTriangle size={12} className="text-red-500" />
          Close to breach — protect the account.
        </div>
      )}

      {/* Distance to breach */}
      <div className="flex items-end justify-between mb-1">
        <p className={`text-2xl font-bold font-mono ${alert ? "text-red-500" : "text-slate-900"}`}>
          {money(dist)}
        </p>
        <p className="text-xs font-mono text-slate-400">buffer to breach</p>
      </div>
      {floor > 0 && (
        <p className="text-[10px] font-mono text-slate-400 mb-2">Equity floor {money(floor, 0)}</p>
      )}

      {/* Profit target progress */}
      {target > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
            <span className="flex items-center gap-1"><Target size={10} /> Profit target</span>
            <span>{money(current, 0)} / {money(target, 0)}</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Secondary stats */}
      <div className="grid grid-cols-2 gap-2 mt-4 text-[10px] font-mono">
        {status.dailyLossRemaining !== undefined && status.dailyLossRemaining !== null && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5">
            <span className="text-slate-400 block">Daily loss left</span>
            <span className="text-slate-800">{money(status.dailyLossRemaining)}</span>
          </div>
        )}
        {status.consistency && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5">
            <span className="text-slate-400 block">Consistency</span>
            <span className="text-slate-800">{status.consistency}</span>
          </div>
        )}
      </div>

      {status.updated && (
        <p className="text-[9px] font-mono text-slate-300 mt-3">
          synced {new Date(status.updated).toLocaleString()}
        </p>
      )}
    </div>
  );
}
