import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RiArrowDownSLine, RiCalendarLine, RiFocus3Line, RiFundsLine, RiLineChartLine, RiMindMap, RiPercentLine, RiPulseLine, RiRefreshLine, RiShieldCheckLine, RiSparklingLine, RiStackLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { StatCards } from "@/components/application/dashboard/stat-cards";
import { cx } from "@/utils/cx";
import RiskGauge, { useFnStatus } from "./RiskGauge";
import { isBreached } from "./lib/accountStatus";
import DayContext from "./DayContext";
import { WORKER_URL } from "./journal/config";
import { signedR, signedUSD } from "./journal/format";
import { buildEquityCurve, calcStreak, fetchMacroIntel } from "./journal/stats";
import { EquityPanel, MonthlyPnl, PayoutTracker, ProcessCard, StreakStrip, WeeklySummary } from "./journal/PerformancePanels";
import { ConfluencePanel, SetupsPanel, WinRateChart } from "./journal/SetupPanels";
import { DayAnalysisPanel, GoalTracker, MistakesPanel, OneAndDoneTracker, RulesPanel, TradeQualityPanel } from "./journal/PsychologyPanels";
import { JournalAI, MacroPanel, MacroWarningBanner, NextBestAction } from "./journal/InsightPanels";

const SECTIONS_KEY = "myjournal_sections";

const RANGES = [
  { label: "7D",  value: "7d"  },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "YTD", value: "ytd" },
];

const ACCOUNTS = [
  { label: "Funded", value: "funded" },
  { label: "Other",  value: "other"  },
];

// ─── Collapsible Section ───────────────────────────────────────────────────
const SECTION_ICONS = { performance: RiLineChartLine, setups: RiFocus3Line, psychology: RiMindMap, ai: RiSparklingLine };

function Section({ id, title, subtitle, children, openSections, toggleSection }) {
  const isOpen = openSections[id] !== false;
  const SectionIcon = SECTION_ICONS[id];
  return (
    <section id={id} className="dashboard-section flex flex-col gap-4" aria-labelledby={`${id}-title`}>
      <Button variant="ghost" onClick={() => toggleSection(id)} aria-expanded={isOpen} aria-controls={`${id}-content`} className="section-toggle">
        <span className="section-heading">
          <span className="section-icon"><SectionIcon size={18} /></span>
          <span className="flex flex-col items-start">
            <span id={`${id}-title`} className="text-title-3-medium text-text-primary">{title}</span>
            <span className="section-subtitle text-body-2-regular text-text-tertiary">{subtitle}</span>
          </span>
        </span>
        <RiArrowDownSLine size={20} className={cx("section-chevron", isOpen && "is-open")} />
      </Button>
      {isOpen && <div id={`${id}-content`} className="flex flex-col gap-4">{children}</div>}
    </section>
  );
}

function AccountToggle({ account, onChange }) {
  return (
    <SegmentedControl aria-label="Trading account" selectedKeys={new Set([account])} onSelectionChange={(keys) => onChange([...keys][0])}>
      {ACCOUNTS.map((a) => <SegmentedControlItem key={a.value} id={a.value}>{a.label}</SegmentedControlItem>)}
    </SegmentedControl>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────
export default function MinimalTradeJournalDashboard({ navigationRequest }) {
  const requestId = useRef(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [range, setRange] = useState("30d");
  const [account, setAccount] = useState("other");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openSections, setOpenSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) || "{}"); }
    catch { return {}; }
  });

  function toggleSection(id) {
    setOpenSections(prev => {
      const updated = { ...prev, [id]: prev[id] === false ? true : false };
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  useEffect(() => {
    if (!navigationRequest) return;
    const id = navigationRequest.id;
    if (id !== "overview") {
      // Expand the section requested by the separate workspace navigation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenSections(prev => ({ ...prev, [id]: true }));
    }
    const frame = requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
      if (id === "overview") window.scrollTo({ top: 0, behavior });
      else document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigationRequest]);

  // Macro state
  const [macro, setMacro] = useState(null);
  const [macroLoading, setMacroLoading] = useState(true);
  const [macroError, setMacroError] = useState(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  // Live FundedNext account risk (from the Worker `/status` route → FN Account Status Notion DB)
  const { status: fnStatus, loading: fnLoading } = useFnStatus(WORKER_URL);

  async function loadData(r, acc) {
    const id = ++requestId.current;
    setLoading(true);
    setData(null);
    setError(null);
    try {
      const res = await fetch(`${WORKER_URL}?range=${r}&account=${acc}`);
      if (!res.ok) throw new Error(`Unable to sync trades (${res.status}). Try refreshing.`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Worker returned success: false");
      if (id !== requestId.current) return;
      setData(json);
      setLastUpdated(new Date());
    } catch (err) {
      if (id === requestId.current) setError(err.message || "Unable to sync trades. Try refreshing.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  const loadMacro = useCallback(async () => {
    setMacroLoading(true);
    setMacroError(null);
    setWarningDismissed(false);
    try {
      const result = await fetchMacroIntel();
      setMacro(result);
    } catch (err) {
      setMacroError("Could not load macro data — " + (err.message || "unknown error"));
    } finally {
      setMacroLoading(false);
    }
  }, []);

  useEffect(() => { loadData(range, account); return () => { requestId.current++; }; }, [range, account]);
  useEffect(() => { loadMacro(); }, [loadMacro]);

  const equityCurve = useMemo(() => (data?.trades ? buildEquityCurve(data.trades) : []), [data]);
  const streak = useMemo(() => calcStreak(data?.trades || []), [data]);
  const netPnl = useMemo(() => {
    if (!data?.trades) return 0;
    return data.trades.reduce((sum, t) => sum + (typeof t.pnl === "number" ? t.pnl : 0), 0);
  }, [data]);

  const rangeLabel = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days", "ytd": "year to date" }[range];
  const isFunded = account === "funded";

  const openPsychology = () => {
    setOpenSections((prev) => ({ ...prev, psychology: true }));
    requestAnimationFrame(() => document.getElementById("psychology")?.scrollIntoView({ behavior: "smooth" }));
  };

  return (
    <main id="overview" className="journal-dashboard">
      <div className="dashboard-content flex flex-col gap-6">
        <header className="dashboard-header">
          <div>
            <div className="page-kicker text-body-2-medium"><span className="live-indicator" /> YOUR TRADING WORKSPACE</div>
            <h1 className="text-display-3-medium">Trading Performance<span className="heading-dot">.</span></h1>
            <p className="text-body-regular text-text-secondary">A clear view of your edge. Every trade, every decision.</p>
          </div>
          <div className="header-context"><span className="account-badge"><RiShieldCheckLine size={15} />{isFunded ? "Funded account" : "Personal account"}</span><span className="text-body-2-regular text-text-secondary">{data ? `${data.count} trades in this period` : loading ? "Syncing your journal…" : "Awaiting trade data"}</span></div>
        </header>
        <div className="dashboard-toolbar glass-panel">
          <div className="toolbar-group"><span className="toolbar-label text-body-2-medium">Account</span><AccountToggle account={account} onChange={setAccount} /></div>
          <div className="toolbar-group range-group"><RiCalendarLine size={17} className="text-foreground-icon-secondary" /><SegmentedControl aria-label="Date range" selectedKeys={new Set([range])} onSelectionChange={(keys) => setRange([...keys][0])}>{RANGES.map(r => <SegmentedControlItem key={r.value} id={r.value}>{r.label}</SegmentedControlItem>)}</SegmentedControl></div>
          <div className="toolbar-sync"><span className={cx("sync-status text-body-2-regular", error && "sync-error")} role="status"><span />{loading ? "Syncing…" : error ? "Sync unavailable" : `Synced ${lastUpdated?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || ""}`}</span><Button variant="secondary" iconOnly leadingIcon={RiRefreshLine} aria-label="Refresh trade data" title="Refresh trade data" disabled={loading} onClick={() => loadData(range, account)} className={cx(loading && "refresh-loading")} /></div>
        </div>

        {!warningDismissed && macro?.todayWarning && (
          <MacroWarningBanner warning={macro.todayWarning} onDismiss={() => setWarningDismissed(true)} />
        )}

        {error && (
          <p role="alert" className="rounded-2xl border border-border-error-default bg-background-tertiary-error px-4 py-3 text-body-2-regular text-text-error-primary">{error}</p>
        )}

        <div aria-busy={loading} aria-label="Trading summary">
          {loading ? <div className="metric-skeleton-grid">{[1, 2, 3, 4].map(i => <div key={i} className="glass-panel metric-skeleton"><span /><span /><span /></div>)}</div> : <StatCards className="journal-stats" stats={[
            { icon: RiFundsLine, label: "Net P&L", value: data ? signedUSD(netPnl) : "N/A", valueTone: netPnl < 0 ? "negative" : "positive", delta: data ? `${data.count} trades` : "No data", deltaColor: netPnl < 0 ? "rose" : "neutral" },
            { icon: RiPulseLine, label: "Net R", value: data ? signedR(data.totalR) : "N/A", valueTone: data?.totalR < 0 ? "negative" : "positive", delta: "Risk-adjusted", deltaColor: "neutral" },
            { icon: RiPercentLine, label: "Win Rate", value: data ? `${data.winRate}%` : "N/A", delta: data ? `${data.wins}W / ${data.losses}L` : "No data", deltaColor: "neutral" },
            { icon: RiStackLine, label: "Best Setup", value: data?.bestSetup?.setup || "No trades", delta: data?.bestSetup ? `${data.bestSetup.winRate}% win rate` : "This period", deltaColor: "neutral" },
          ]} />}
        </div>

        {/* Pre-session: levels on the left, actions and macro stacked on the right */}
        {/* The right column takes Day Context's height; the macro list scrolls inside it */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <DayContext workerUrl={WORKER_URL} />
          <div className="flex flex-col gap-4 xl:h-0 xl:min-h-full">
            <NextBestAction insights={data?.insights} loading={loading} />
            <MacroPanel macro={macro} loading={macroLoading} error={macroError} onRefresh={loadMacro} fill />
          </div>
        </div>

        <Section id="performance" title="Performance" subtitle="Your results, at a glance" openSections={openSections} toggleSection={toggleSection}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <EquityPanel data={data} netPnl={netPnl} equityCurve={equityCurve} loading={loading} rangeLabel={rangeLabel} />
            <div className="flex flex-col gap-4 [&>*:last-child]:flex-1">
              <PayoutTracker netPnl={netPnl} loading={loading} fnTarget={isFunded && !isBreached(fnStatus) ? fnStatus?.profitTarget : null} />
              {isFunded ? <RiskGauge status={fnStatus} loading={fnLoading} /> : <ProcessCard onReview={openPsychology} />}
            </div>
          </div>
          <StreakStrip streak={streak} data={data} loading={loading} />
          <MonthlyPnl trades={data?.trades} loading={loading} />
          <WeeklySummary trades={data?.trades} loading={loading} />
        </Section>

        <Section id="setups" title="Setups" subtitle="Setup stats, win rate, expectancy, trade log" openSections={openSections} toggleSection={toggleSection}>
          <div className="grid gap-4 xl:grid-cols-2">
            <SetupsPanel data={data} loading={loading} />
            <WinRateChart data={data} loading={loading} />
          </div>
          <ConfluencePanel trades={data?.trades} loading={loading} />
        </Section>

        <Section id="psychology" title="Psychology" subtitle="Trade quality, day analysis, mistakes, rules, goals" openSections={openSections} toggleSection={toggleSection}>
          {/* Two balanced columns: cards flow top to bottom so neither side leaves a gap */}
          <div className="gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
            <TradeQualityPanel data={data} loading={loading} />
            <MistakesPanel trades={data?.trades} loading={loading} />
            <DayAnalysisPanel trades={data?.trades} loading={loading} />
            <GoalTracker data={data} loading={loading} />
            <RulesPanel />
          </div>
          <OneAndDoneTracker trades={data?.trades} />
        </Section>

        <Section id="ai" title="AI Insights" subtitle="Ask questions about your own trade data" openSections={openSections} toggleSection={toggleSection}>
          <JournalAI data={data} />
        </Section>

        <footer className="dashboard-footer text-body-2-regular"><span>MyJournal. Built around your process.</span><span>Trade data from Notion</span></footer>
      </div>
    </main>
  );
}
