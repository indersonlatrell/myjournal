import { useState } from "react";
import { Input } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { cx } from "@/utils/cx";
import { WATCHLIST } from "@/src/features/terminal/lib/futures";

// ─── Position sizer ─────────────────────────────────────────────────────────
// Contracts for a dollar risk and a stop in points. Best fit uses full-size
// contracts first and fills the rest with micros, never going over the risk.
const SIZER_KEY = "myjournal_terminal_sizer";

function readSaved() {
  try {
    return { instrument: "NQ", risk: "200", stop: "20", ...JSON.parse(localStorage.getItem(SIZER_KEY) || "{}") };
  } catch {
    return { instrument: "NQ", risk: "200", stop: "20" };
  }
}

const usd = (n) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function sizePosition(risk, stop, contracts) {
  const [full, micro] = contracts;
  const perFull = stop * full.pointValue;
  const perMicro = stop * micro.pointValue;
  const fullOnly = Math.floor(risk / perFull);
  const microOnly = Math.floor(risk / perMicro);
  const left = risk - fullOnly * perFull;
  const fillMicros = Math.floor(left / perMicro);
  return {
    rows: [
      { id: full.id, qty: fullOnly, perContract: perFull, risk: fullOnly * perFull },
      { id: micro.id, qty: microOnly, perContract: perMicro, risk: microOnly * perMicro },
    ],
    best: { full: fullOnly, micro: fillMicros, risk: fullOnly * perFull + fillMicros * perMicro },
  };
}

export function PositionSizer({ quotes }) {
  const [form, setForm] = useState(readSaved);
  const update = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    try { localStorage.setItem(SIZER_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const item = WATCHLIST.find((w) => w.biasKey === form.instrument) || WATCHLIST[0];
  const [full, micro] = item.contracts;
  const risk = parseFloat(form.risk);
  const stop = parseFloat(form.stop);
  const valid = risk > 0 && stop > 0;
  const result = valid ? sizePosition(risk, stop, item.contracts) : null;
  const price = quotes[item.symbol]?.price;

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl aria-label="Instrument" selectedKeys={new Set([item.biasKey])}
        onSelectionChange={(keys) => update({ instrument: [...keys][0] })}>
        {WATCHLIST.map((w) => <SegmentedControlItem key={w.biasKey} id={w.biasKey}>{w.label}</SegmentedControlItem>)}
      </SegmentedControl>

      <div className="grid grid-cols-2 gap-3">
        <Input label="Risk ($)" type="number" inputMode="decimal" value={form.risk} onChange={(v) => update({ risk: v })} placeholder="200" />
        <Input label="Stop (points)" type="number" inputMode="decimal" value={form.stop} onChange={(v) => update({ stop: v })} placeholder="20" />
      </div>

      {!valid ? (
        <p className="text-body-2-regular text-text-tertiary">Enter a risk and a stop above zero.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            {result.rows.map((r) => (
              <div key={r.id} className="flex flex-col gap-1 rounded-xl border border-separator-border bg-background-primary-default p-3">
                <dt className="text-caption-1-semibold text-text-tertiary">{r.id}</dt>
                <dd className={cx("text-title-3-semibold tabular-nums", r.qty ? "text-text-primary" : "text-text-error-primary")}>
                  {r.qty} {r.qty === 1 ? "contract" : "contracts"}
                </dd>
                <dd className="text-caption-1-regular tabular-nums text-text-tertiary">
                  {r.qty ? `Risk ${usd(r.risk)} · ${usd(r.perContract)} each` : `Needs ${usd(r.perContract)} per contract`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-body-2-regular text-text-secondary">
            {result.best.full + result.best.micro === 0
              ? `Stop too wide for ${usd(risk)}. One ${micro.id} already risks ${usd(stop * micro.pointValue)}.`
              : <>Best fit: <span className="text-body-2-medium text-text-primary">
                  {[result.best.full && `${result.best.full} ${full.id}`, result.best.micro && `${result.best.micro} ${micro.id}`].filter(Boolean).join(" + ")}
                </span> · risks {usd(result.best.risk)} of {usd(risk)}</>}
          </p>
          {price > 0 && (
            <p className="text-caption-1-regular tabular-nums text-text-tertiary">
              From {price.toFixed(2)}: long stop {(price - stop).toFixed(2)} · short stop {(price + stop).toFixed(2)}
            </p>
          )}
        </>
      )}
      <p className="text-caption-1-regular text-text-tertiary">{full.id} ${full.pointValue}/pt · {micro.id} ${micro.pointValue}/pt. Fees and slippage not included.</p>
    </div>
  );
}
