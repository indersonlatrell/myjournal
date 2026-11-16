import { useCallback, useMemo, useState } from "react";
import {
  RiAddLine, RiArrowGoBackLine, RiArrowLeftSLine, RiArrowRightSLine, RiBrainLine, RiCalendar2Line, RiCheckLine,
  RiCloseLine, RiDeleteBinLine, RiErrorWarningLine, RiFlagLine, RiListCheck3, RiPencilLine, RiScales3Line, RiSunLine,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/badges/chip";
import { Input } from "@/components/base/input/input";
import { ProgressBar } from "@/components/base/progress/progress";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { cx } from "@/utils/cx";
import { fmt, signedR, signedUSD, toneClass } from "./format";
import { buildDayStats, buildMistakes, buildQualityStats } from "./stats";
import { EmptyState, InlineInsight, Metric, Panel, SkeletonStack, Tile } from "./ui";

const RULES_KEY = "myjournal_rules";
const GOALS_KEY = "myjournal_goals";
const ONEDONE_KEY = "myjournal_oneanddone";

function readJson(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return fallback; }
}
function readList(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// One row of win rate / avg R / P&L, used by quality and day analysis.
function BreakdownRow({ label, chipColor, stats }) {
  return (
    <Tile className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-medium text-text-primary">{label}</span>
        <Chip variant="caption" color={chipColor}>{stats.count} {stats.count === 1 ? "trade" : "trades"}</Chip>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Win rate" value={`${stats.winRate}%`} />
        <Metric label="Avg R" value={signedR(stats.avgR)} valueClassName={toneClass(stats.avgR)} />
        <Metric label="P&L" value={signedUSD(stats.pnl ?? stats.totalPnl)} valueClassName={toneClass(stats.pnl ?? stats.totalPnl)} />
      </div>
    </Tile>
  );
}

// ─── Trade quality ─────────────────────────────────────────────────────────
export function TradeQualityPanel({ data, loading }) {
  const stats = useMemo(() => buildQualityStats(data?.trades || []), [data]);
  const rows = [
    { key: "good", label: "Good trades", chip: "lime" },
    { key: "bad", label: "Bad trades", chip: "rose" },
    { key: "untagged", label: "Untagged", chip: "neutral" },
  ];
  return (
    <Panel icon={RiScales3Line} title="Trade quality" subtitle="From your GOOD / BAD tags in Notion">
      {loading ? <SkeletonStack /> : !stats || stats.good.count + stats.bad.count === 0 ? (
        <EmptyState>Tag trades as GOOD or BAD in Notion to unlock quality tracking.</EmptyState>
      ) : (
        <>
          <ProgressBar label="Good-quality trades" value={stats.qualityRate} size="lg" />
          <div className="flex flex-col gap-3">
            {rows.filter((r) => stats[r.key].count > 0).map((r) => <BreakdownRow key={r.key} label={r.label} chipColor={r.chip} stats={stats[r.key]} />)}
          </div>
          <InlineInsight
            prompt="In one sentence, based on good vs bad trade quality data, what is the single biggest execution habit to fix?"
            trades={data?.trades}
            stats={{ count: data?.count, winRate: data?.winRate, totalR: data?.totalR, netProfit: data?.netProfit }}
          />
        </>
      )}
    </Panel>
  );
}

// ─── Day analysis ──────────────────────────────────────────────────────────
export function DayAnalysisPanel({ trades, loading }) {
  const stats = useMemo(() => buildDayStats(trades || []), [trades]);
  const empty = !stats || stats.green.count + stats.red.count === 0;
  let note = null;
  if (!empty && stats.green.count && stats.red.count) {
    const diff = stats.green.winRate - stats.red.winRate;
    note = diff > 0 ? `You win ${diff}% more often on Green days. Size up on those.`
      : diff < 0 ? `Your Red-day win rate is higher. Review what changes on Green days.`
      : "Similar results on both day types.";
  }
  return (
    <Panel icon={RiSunLine} title="Day analysis" subtitle="Green vs Red day performance">
      {loading ? <SkeletonStack count={2} className="h-24" /> : empty ? (
        <EmptyState>Tag trades as a Green or Red day in Notion to unlock this panel.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {stats.green.count > 0 && <BreakdownRow label="Green days" chipColor="lime" stats={stats.green} />}
            {stats.red.count > 0 && <BreakdownRow label="Red days" chipColor="rose" stats={stats.red} />}
          </div>
          {note && <p className="text-body-2-regular text-text-secondary">{note}</p>}
        </>
      )}
    </Panel>
  );
}

// ─── Mistakes ──────────────────────────────────────────────────────────────
export function MistakesPanel({ trades, loading }) {
  const mistakes = useMemo(() => buildMistakes(trades || []), [trades]);
  const fade = useScrollFade();
  return (
    <Panel icon={RiErrorWarningLine} title="Mistakes review" subtitle="Recent notes on execution errors">
      {loading ? <SkeletonStack /> : !mistakes.length ? (
        <EmptyState>Fill in the Mistakes field in Notion to review execution errors here.</EmptyState>
      ) : (
        <div className="relative">
          <ScrollFade progress={fade.progress} />
          <ul onScroll={fade.onScroll} className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {mistakes.map((m, i) => (
              <li key={i}>
                <Tile className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-caption-1-medium text-text-tertiary">
                      {m.date} · {m.pair}
                      <Chip variant="caption" color={m.win ? "lime" : "rose"}>{m.win ? "Win" : "Loss"}</Chip>
                    </span>
                    <span className={cx("text-body-2-medium tabular-nums", toneClass(m.r))}>{signedR(m.r)}</span>
                  </div>
                  <p className="text-body-2-regular text-text-primary">{m.mistake}</p>
                </Tile>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ─── Trading rules ─────────────────────────────────────────────────────────
export function RulesPanel() {
  const [rules, setRules] = useState(() => readList(RULES_KEY));
  const [draft, setDraft] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editVal, setEditVal] = useState("");

  function save(next) { setRules(next); writeJson(RULES_KEY, next); }
  function add() {
    const text = draft.trim();
    if (!text) return;
    save([...rules, { text, violations: 0 }]);
    setDraft("");
  }
  const update = (i, patch) => save(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const total = rules.reduce((s, r) => s + r.violations, 0);

  return (
    <Panel icon={RiListCheck3} title="Trading rules" subtitle="Log a violation with +1"
      action={total > 0 && <Chip variant="caption" color="rose">{total} {total === 1 ? "violation" : "violations"}</Chip>}>
      <div className="flex items-end gap-2">
        <Input aria-label="New trading rule" value={draft} onChange={setDraft} placeholder="Never trade the first 15 minutes"
          onKeyDown={(e) => e.key === "Enter" && add()} className="flex-1" />
        <Button iconOnly leadingIcon={RiAddLine} aria-label="Add rule" onClick={add} />
      </div>
      {!rules.length ? <EmptyState>No rules yet. Add your first one above.</EmptyState> : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule, i) => (
            <li key={i}>
              <Tile className={cx("flex flex-col gap-2", rule.violations > 0 && "border-border-error-default")}>
                {editIdx === i ? (
                  <div className="flex items-end gap-2">
                    <Input aria-label="Edit rule" value={editVal} onChange={setEditVal} autoFocus className="flex-1"
                      onKeyDown={(e) => { if (e.key === "Enter") { update(i, { text: editVal.trim() }); setEditIdx(null); } }} />
                    <Button size="small" iconOnly leadingIcon={RiCheckLine} aria-label="Save rule" onClick={() => { update(i, { text: editVal.trim() }); setEditIdx(null); }} />
                    <Button size="small" variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Cancel edit" onClick={() => setEditIdx(null)} />
                  </div>
                ) : (
                  <>
                    <p className="text-body-2-regular text-text-primary">{rule.text}</p>
                    <div className="flex items-center justify-between gap-2">
                      {rule.violations > 0 ? <Chip variant="caption" color="rose">{rule.violations}× broken</Chip> : <Chip variant="caption" color="lime">Kept</Chip>}
                      <div className="flex items-center gap-1">
                        <Button size="xs" variant="ghost" onClick={() => update(i, { violations: rule.violations + 1 })} aria-label="Log a violation">+1</Button>
                        {rule.violations > 0 && <Button size="xs" variant="ghost" iconOnly leadingIcon={RiArrowGoBackLine} aria-label="Reset violations" onClick={() => update(i, { violations: 0 })} />}
                        <Button size="xs" variant="ghost" iconOnly leadingIcon={RiPencilLine} aria-label="Edit rule" onClick={() => { setEditIdx(i); setEditVal(rule.text); }} />
                        <Button size="xs" variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label="Delete rule" onClick={() => save(rules.filter((_, idx) => idx !== i))} />
                      </div>
                    </div>
                  </>
                )}
              </Tile>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── Goals ─────────────────────────────────────────────────────────────────
export function GoalTracker({ data, loading }) {
  const [goals, setGoals] = useState(() => readJson(GOALS_KEY, {}));
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ monthlyR: "", maxBadTrades: "" });

  function saveGoals() {
    const next = { monthlyR: parseFloat(form.monthlyR) || 0, maxBadTrades: parseInt(form.maxBadTrades, 10) || 0 };
    setGoals(next);
    writeJson(GOALS_KEY, next);
    setEditing(false);
  }

  const now = new Date();
  const monthTrades = (data?.trades || []).filter((t) => {
    if (!t.date) return false;
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const currentR = monthTrades.reduce((s, t) => s + (typeof t.r === "number" ? t.r : 0), 0);
  const badTrades = monthTrades.filter((t) => t.tradeQuality === "BAD TRADE").length;
  const rProgress = goals.monthlyR > 0 ? Math.min(100, Math.max(0, (currentR / goals.monthlyR) * 100)) : 0;
  const badProgress = goals.maxBadTrades > 0 ? Math.min(100, (badTrades / goals.maxBadTrades) * 100) : 0;
  const badLimitHit = goals.maxBadTrades > 0 && badTrades >= goals.maxBadTrades;
  const hasGoals = goals.monthlyR > 0 || goals.maxBadTrades > 0;

  return (
    <Panel icon={RiFlagLine} title="Goals" subtitle={`${now.toLocaleDateString("en-GB", { month: "long" })} targets`}
      action={!editing && (
        <Button variant="ghost" size="small" leadingIcon={RiPencilLine}
          onClick={() => { setForm({ monthlyR: goals.monthlyR || "", maxBadTrades: goals.maxBadTrades || "" }); setEditing(true); }}>
          {hasGoals ? "Edit" : "Set goals"}
        </Button>
      )}>
      {editing ? (
        <div className="flex flex-col gap-3">
          <Input label="Monthly R target" type="number" value={String(form.monthlyR)} onChange={(v) => setForm((f) => ({ ...f, monthlyR: v }))} placeholder="20" />
          <Input label="Max bad trades per month" type="number" value={String(form.maxBadTrades)} onChange={(v) => setForm((f) => ({ ...f, maxBadTrades: v }))} placeholder="2" />
          <div className="flex gap-2">
            <Button onClick={saveGoals} className="flex-1">Save goals</Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : !hasGoals ? <EmptyState>Set a monthly R target and a bad-trade limit.</EmptyState> : (
        <div className="flex flex-col gap-5">
          {goals.monthlyR > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <Metric label="Monthly R" value={loading ? "…" : signedR(currentR)} valueClassName={toneClass(currentR)} />
                <span className="text-body-2-regular text-text-tertiary">of {goals.monthlyR}R</span>
              </div>
              <ProgressBar aria-label="Monthly R progress" value={rProgress}
                description={currentR >= goals.monthlyR ? "Target reached." : `${fmt(rProgress, 1)}% · ${fmt(goals.monthlyR - currentR, 2)}R to go`} />
            </div>
          )}
          {goals.maxBadTrades > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <Metric label="Bad trades this month" value={`${badTrades} / ${goals.maxBadTrades}`} valueClassName={badLimitHit ? "text-text-error-primary" : undefined} />
                {badLimitHit && <Chip variant="caption" color="rose">Limit reached</Chip>}
              </div>
              <ProgressBar aria-label="Bad trades used" value={badProgress}
                description={badLimitHit ? "Stop taking bad trades this month." : `${goals.maxBadTrades - badTrades} left this month`} />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ─── 1-and-Done tracker ────────────────────────────────────────────────────
// A day is green only when every trade that day is ticked Disciplined in
// Notion. Any day can be overridden by clicking it.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const DAY_STYLE = {
  held: "border-accent-500 bg-accent-500 text-text-white",
  chased: "border-border-error-default bg-text-error-primary text-text-white",
  rest: "border-separator-border bg-background-tertiary-default text-text-secondary",
  none: "border-separator-border bg-background-primary-default text-text-tertiary",
};

export function OneAndDoneTracker({ trades }) {
  const [cfg, setCfg] = useState(() => readJson(ONEDONE_KEY, { overrides: {} }));
  const [view, setView] = useState(() => new Date());
  const save = (next) => { setCfg(next); writeJson(ONEDONE_KEY, next); };
  const todayISO = iso(new Date());

  const dayData = useMemo(() => {
    const m = {};
    (trades || []).forEach((t) => {
      const k = (t.date || "").slice(0, 10);
      if (!k) return;
      if (!m[k]) m[k] = { count: 0, defined: 0, allDisc: true, pnl: 0 };
      m[k].count++;
      if (typeof t.pnl === "number") m[k].pnl += t.pnl;
      if (typeof t.disciplined === "boolean") {
        m[k].defined++;
        if (!t.disciplined) m[k].allDisc = false;
      }
    });
    return m;
  }, [trades]);

  const statusOf = useCallback((k) => {
    if (cfg.overrides[k]) return cfg.overrides[k];
    const d = dayData[k];
    if (!d || d.defined === 0) return null;
    return d.allDisc ? "held" : "chased";
  }, [cfg, dayData]);

  const stats = useMemo(() => {
    const sorted = [...new Set([...Object.keys(dayData), ...Object.keys(cfg.overrides)])].sort();
    let held = 0, tradingDays = 0, best = 0, run = 0;
    sorted.forEach((k) => {
      const s = statusOf(k);
      if (s === "held") { held++; tradingDays++; run++; best = Math.max(best, run); }
      else if (s === "chased") { tradingDays++; run = 0; }
    });
    let streak = 0;
    const cur = new Date();
    for (let i = 0; i < 400; i++) {
      const s = statusOf(iso(cur));
      if (s === "chased") break;
      if (s === "held") streak++;
      cur.setDate(cur.getDate() - 1);
    }
    return { streak, best: Math.max(best, streak), rate: tradingDays ? Math.round((held / tradingDays) * 100) : null, held, tradingDays };
  }, [dayData, cfg, statusOf]);

  const y = view.getFullYear(), m = view.getMonth();
  const monthStats = useMemo(() => {
    let held = 0, logged = 0;
    new Set([...Object.keys(dayData), ...Object.keys(cfg.overrides)]).forEach((k) => {
      const [Y, M] = k.split("-").map(Number);
      if (Y !== y || M !== m + 1) return;
      const s = statusOf(k);
      if (s === "held") { held++; logged++; } else if (s === "chased") logged++;
    });
    return { held, logged };
  }, [y, m, dayData, cfg, statusOf]);

  function cycleDay(k) {
    const order = [undefined, "held", "chased", "rest"];
    const next = order[(order.indexOf(cfg.overrides[k]) + 1) % order.length];
    const overrides = { ...cfg.overrides };
    if (next === undefined) delete overrides[k]; else overrides[k] = next;
    save({ ...cfg, overrides });
  }

  const broken = statusOf(todayISO) === "chased";
  const cells = [...Array(new Date(y, m, 1).getDay()).fill(null), ...Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => i + 1)];
  const label = { held: "Disciplined", chased: "Not disciplined", rest: "Sat out" };

  return (
    <Panel icon={RiBrainLine} title="1-and-Done tracker" subtitle="Tick Disciplined on a trade in Notion and the day turns green. Click a day to override."
      action={<Chip variant="caption" color="neutral">Source: Notion “Disciplined”</Chip>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile><Metric label="Current streak" value={stats.streak} valueClassName={broken ? "text-text-error-primary" : "text-accent-700"} hint={broken ? "Reset today. Go again tomorrow." : "Disciplined days in a row"} /></Tile>
        <Tile><Metric label="Longest" value={stats.best} hint="Best discipline run" /></Tile>
        <Tile><Metric label="Discipline rate" value={stats.rate == null ? "—" : `${stats.rate}%`} hint={`${stats.held}/${stats.tradingDays} trading days`} /></Tile>
        <Tile><Metric label="This month" value={`${monthStats.held}/${monthStats.logged}`} hint="Disciplined / trading days" /></Tile>
      </div>

      <Tile className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <Button size="small" variant="ghost" iconOnly leadingIcon={RiArrowLeftSLine} aria-label="Previous month" onClick={() => setView(new Date(y, m - 1, 1))} />
          <span className="flex items-center gap-2 text-body-medium text-text-primary">
            <RiCalendar2Line size={16} className="text-foreground-icon-tertiary" aria-hidden="true" />
            {view.toLocaleString("en", { month: "long" })} {y}
          </span>
          <Button size="small" variant="ghost" iconOnly leadingIcon={RiArrowRightSLine} aria-label="Next month" onClick={() => setView(new Date(y, m + 1, 1))} />
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i} className="text-center text-caption-1-semibold text-text-tertiary">{d}</span>)}
          {cells.map((d, i) => {
            if (d == null) return <span key={i} />;
            const k = iso(new Date(y, m, d));
            const s = statusOf(k);
            const n = dayData[k]?.count;
            const pnl = n ? dayData[k].pnl : null;
            return (
              <button key={i} type="button" onClick={() => cycleDay(k)}
                aria-label={`${d} ${view.toLocaleString("en", { month: "long" })}: ${s ? label[s] : "no status"}${n ? `, ${n} trades` : ""}`}
                className={cx(
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border p-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                  DAY_STYLE[s || "none"],
                  k === todayISO && "ring-2 ring-text-primary ring-offset-1",
                )}>
                <span className="absolute start-1.5 top-1 text-caption-2-medium opacity-80">{d}</span>
                {n ? (
                  <>
                    <span className="mt-2 text-caption-1-semibold tabular-nums">{pnl >= 0 ? "+" : "-"}${Math.round(Math.abs(pnl))}</span>
                    <span className="text-caption-2-regular opacity-80">{n} {n === 1 ? "trade" : "trades"}</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-caption-1-medium text-text-tertiary">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent-500" />Disciplined</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-text-error-primary" />Not disciplined</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-background-tertiary-default" />Sat out</span>
        </div>
      </Tile>

      <p className="text-body-2-regular text-text-secondary">
        <span className="text-body-2-medium text-text-primary">A win you give back was never a win.</span> Take your one trade, then flatten and close the platform.
      </p>
    </Panel>
  );
}
