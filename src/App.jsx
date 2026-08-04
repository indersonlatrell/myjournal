import { useState } from "react";
import MinimalTradeJournalDashboard from "./MinimalTradeJournalDashboard";
import MarketTerminal from "./MarketTerminal";

const VIEW_KEY = "myjournal_active_view";

export default function App() {
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || "journal");

  const switchView = (v) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  return (
    <>
      <div className="fixed top-3 right-3 z-50 flex rounded-full overflow-hidden border border-slate-300 bg-white/90 backdrop-blur shadow-sm text-[11px] font-mono">
        <button
          onClick={() => switchView("journal")}
          className={`px-3 py-1.5 transition-colors ${view === "journal" ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50"}`}
        >
          Journal
        </button>
        <button
          onClick={() => switchView("terminal")}
          className={`px-3 py-1.5 transition-colors ${view === "terminal" ? "bg-amber-500 text-black" : "text-slate-500 hover:bg-slate-50"}`}
        >
          Terminal
        </button>
      </div>
      {view === "journal" ? <MinimalTradeJournalDashboard /> : <MarketTerminal />}
    </>
  );
}
