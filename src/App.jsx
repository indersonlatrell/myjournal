import { lazy, Suspense, useState } from "react";
import { RiArrowRightUpLine, RiBookOpenLine, RiDashboardLine, RiFundsBoxLine, RiLineChartLine, RiMindMap, RiSparklingLine } from "@remixicon/react";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { cx } from "@/utils/cx";
import MinimalTradeJournalDashboard from "./MinimalTradeJournalDashboard";

const MarketTerminal = lazy(() => import("./MarketTerminal"));
const VIEW_KEY = "myjournal_active_view";
const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: RiDashboardLine },
  { id: "performance", label: "Performance", icon: RiLineChartLine },
  { id: "setups", label: "Setups", icon: RiFundsBoxLine },
  { id: "psychology", label: "Psychology", icon: RiMindMap },
  { id: "ai", label: "AI Insights", icon: RiSparklingLine },
];

export default function App() {
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) === "terminal" ? "terminal" : "journal");
  const [section, setSection] = useState("overview");
  const [navigationRequest, setNavigationRequest] = useState(null);

  function switchView(value) {
    setView(value);
    localStorage.setItem(VIEW_KEY, value);
    window.scrollTo({ top: 0 });
  }

  function navigate(id) {
    if (view !== "journal") switchView("journal");
    setSection(id);
    setNavigationRequest({ id, time: Date.now() });
  }

  return (
    <div className={cx("workspace", view === "terminal" && "workspace-terminal")}>
      <a href="#main-content" className="skip-link">Skip to dashboard</a>
      <aside className="workspace-sidebar glass-panel">
        <a href="#overview" onClick={(event) => { event.preventDefault(); navigate("overview"); }} className="brand" aria-label="MyJournal overview">
          <span className="brand-symbol"><RiBookOpenLine size={23} /></span>
          <span>myjournal<span className="brand-period">.</span></span>
        </a>
        <div className="sidebar-heading text-caption-1-semibold">WORKSPACE</div>
        <nav aria-label="Dashboard sections" className="sidebar-nav">
          {NAV_ITEMS.map(({ id, label, icon }) => (
            <Button key={id} variant="ghost" leadingIcon={icon} onClick={() => navigate(id)}
              aria-label={label}
              title={label}
              aria-current={view === "journal" && section === id ? "page" : undefined}
              className={cx("nav-item", view === "journal" && section === id && "nav-item-active")}>
              {label}
            </Button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <RiLineChartLine size={22} />
            <p className="text-body-medium">Consistency compounds.</p>
            <p className="text-body-2-regular">One good decision at a time.</p>
          </div>
          <div className="profile"><span className="profile-avatar">L</span><div><p className="text-body-medium">Latrell</p><p className="text-body-2-regular">Personal workspace</p></div></div>
        </div>
      </aside>
      <div className="workspace-main" id="main-content">
        <div className="workspace-topbar">
          <div className="breadcrumb text-body-2-regular">Workspace <span>/</span> <strong>{view === "journal" ? "Trading journal" : "Market terminal"}</strong></div>
          <div className="topbar-actions">
            <SegmentedControl aria-label="Workspace view" selectedKeys={new Set([view])} onSelectionChange={(keys) => switchView([...keys][0])}>
              <SegmentedControlItem id="journal">Journal</SegmentedControlItem>
              <SegmentedControlItem id="terminal">Terminal</SegmentedControlItem>
            </SegmentedControl>
            <ButtonLink href="https://www.notion.so" target="_blank" rel="noreferrer" variant="secondary" trailingIcon={RiArrowRightUpLine} className="notion-link">Open Notion</ButtonLink>
          </div>
        </div>
        {view === "journal" ? <MinimalTradeJournalDashboard navigationRequest={navigationRequest} /> : (
          <Suspense fallback={<div className="glass-panel p-8 text-body-regular" role="status">Loading market terminal…</div>}><MarketTerminal /></Suspense>
        )}
      </div>
    </div>
  );
}
