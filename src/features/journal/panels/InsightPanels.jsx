import { useEffect, useRef, useState } from "react";
import { RiAlertLine, RiBookOpenLine, RiCloseLine, RiGlobalLine, RiRefreshLine, RiRobot2Line, RiSendPlaneLine, RiSparklingLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/badges/chip";
import { Input } from "@/components/base/input/input";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import { cx } from "@/utils/cx";
import { askJournal } from "@/src/features/journal/stats";
import { EmptyState, Panel, SkeletonStack, Tile } from "@/src/features/journal/ui";

// ─── Macro environment ─────────────────────────────────────────────────────
const SENTIMENT_CHIP = { "risk-on": "lime", "risk-off": "rose", neutral: "neutral" };

// `fill` lets the panel take the remaining height of its column on wide screens.
export function MacroPanel({ macro, loading, error, onRefresh, fill: fillProp = false }) {
  const fade = useScrollFade();
  // Only stretch when there is a list to fill the space; otherwise keep natural height.
  const fill = fillProp && !loading && !error && Boolean(macro?.events?.length);
  return (
    <Panel icon={RiGlobalLine} title="Macro environment" subtitle="Sentiment and high-impact events" className={cx(fill && "xl:min-h-0 xl:flex-1")}
      action={<Button size="small" variant="ghost" iconOnly leadingIcon={RiRefreshLine} aria-label="Refresh macro data" disabled={loading} onClick={onRefresh} className={cx(loading && "refresh-loading")} />}>
      {loading ? <SkeletonStack count={3} className="h-12" /> : error ? <EmptyState>{error}</EmptyState> : macro ? (
        <>
          <Tile className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Chip variant="caption" color={SENTIMENT_CHIP[macro.sentiment] || "neutral"} className="self-start capitalize">{macro.sentiment}</Chip>
              <span className="text-body-2-regular text-text-secondary">
                {macro.fearGreed ? `CNN Fear & Greed at ${macro.fearGreed.score}/100` : "Based on current market conditions"}
              </span>
            </div>
            {macro.fearGreed && <span className="text-body-2-medium text-text-primary">{macro.fearGreed.rating}</span>}
          </Tile>
          {macro.events?.length ? (
            <div className={cx("relative", fill && "xl:min-h-0 xl:flex-1")}>
              <ScrollFade progress={fade.progress} />
              <ul onScroll={fade.onScroll} className={cx("flex max-h-80 flex-col gap-2 overflow-y-auto", fill && "xl:h-full xl:max-h-none")}>
                {macro.events.map((ev, i) => (
                  <li key={i}>
                    <Tile className={cx("flex items-start justify-between gap-3", ev.isToday && "border-border-error-default")}>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          <Chip variant="caption" color="rose">High</Chip>
                          <Chip variant="caption" color="neutral">{ev.currency}</Chip>
                          {ev.isToday && <Chip variant="caption" color="orange">Today</Chip>}
                        </span>
                        <span className="truncate text-body-2-medium text-text-primary">{ev.name}</span>
                      </div>
                      <span className="shrink-0 text-end text-caption-1-medium tabular-nums text-text-tertiary">{ev.date}<br />{ev.time}</span>
                    </Tile>
                  </li>
                ))}
              </ul>
            </div>
          ) : <EmptyState>No high-impact events in the next 4 days.</EmptyState>}
        </>
      ) : null}
    </Panel>
  );
}

export function MacroWarningBanner({ warning, onDismiss }) {
  if (!warning) return null;
  return (
    <div role="status" className="flex items-start justify-between gap-3 rounded-2xl border border-border-error-default bg-background-tertiary-error px-4 py-3">
      <div className="flex items-start gap-2.5">
        <RiAlertLine size={18} className="mt-0.5 shrink-0 text-text-error-primary" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <span className="text-body-medium text-text-error-primary">High-impact event today</span>
          <span className="text-body-2-regular text-text-primary">{warning}</span>
        </div>
      </div>
      <Button size="small" variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Dismiss warning" onClick={onDismiss} />
    </div>
  );
}

// ─── Next best action ──────────────────────────────────────────────────────
const INSIGHT_CHIP = { psychology: "orange", execution: "blue", confidence: "lime", review: "neutral" };

export function NextBestAction({ insights, loading }) {
  return (
    <Panel icon={RiSparklingLine} title="Next best action" subtitle="Patterns from your trading journal">
      {loading ? <SkeletonStack count={2} /> : insights?.length ? (
        <ul className="flex flex-col gap-2">
          {insights.map((ins, i) => (
            <li key={i}>
              <Tile className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <Chip variant="caption" color={INSIGHT_CHIP[ins.type] || "neutral"} className="capitalize">{ins.type || "review"}</Chip>
                  <span className="text-body-medium text-text-primary">{ins.title}</span>
                </span>
                <p className="text-body-2-regular text-text-secondary">{ins.message}</p>
              </Tile>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="flex items-start gap-2">
          <RiBookOpenLine size={16} className="mt-0.5 shrink-0 text-foreground-icon-tertiary" aria-hidden="true" />
          Add reflections to your Notion trades to uncover patterns in your decisions.
        </EmptyState>
      )}
    </Panel>
  );
}

// ─── Journal AI chat ───────────────────────────────────────────────────────
const SUGGESTIONS = ["What's my best setup?", "When do I perform best?", "What mistakes do I repeat?", "Which confluences work best?"];
const UNAVAILABLE = "The AI service isn't responding right now. Your trade data is fine. The Worker's AI connection needs attention.";

export function JournalAI({ data }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef(null);
  const fade = useScrollFade();

  useEffect(() => {
    const el = scrollRef.current;
    if (el && messages.length) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function ask(question = input) {
    const q = question.trim();
    if (!q || thinking) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setThinking(true);
    try {
      const reply = await askJournal({
        question: q,
        trades: data?.trades || [],
        stats: { count: data?.count, winRate: data?.winRate, totalR: data?.totalR, netProfit: data?.netProfit },
      });
      setMessages((m) => [...m, { role: "assistant", text: reply || UNAVAILABLE, failed: !reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Connection error. Try again.", failed: true }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <Panel icon={RiRobot2Line} title="Journal AI" subtitle="Ask questions about your own trade data">
      <div className="relative">
        <ScrollFade progress={fade.progress} />
        <div ref={scrollRef} onScroll={fade.onScroll} className="flex max-h-80 min-h-40 flex-col gap-3 overflow-y-auto" aria-live="polite">
          {!messages.length && (
            <div className="flex flex-col gap-3">
              <p className="text-body-2-regular text-text-secondary">Try one of these, or ask your own question.</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => <Button key={s} size="small" variant="secondary" onClick={() => ask(s)}>{s}</Button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <p className={cx(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-body-2-regular",
                m.role === "user" ? "bg-accent-700 text-text-white"
                  : m.failed ? "border border-border-error-default bg-background-tertiary-error text-text-primary"
                  : "border border-separator-border bg-background-primary-default text-text-primary",
              )}>{m.text}</p>
            </div>
          ))}
          {thinking && <p className="text-body-2-regular text-text-tertiary">Thinking…</p>}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <Input aria-label="Question about your trades" value={input} onChange={setInput} placeholder="Ask about your trades…"
          onKeyDown={(e) => e.key === "Enter" && ask()} className="flex-1" />
        <Button iconOnly leadingIcon={RiSendPlaneLine} aria-label="Ask" onClick={() => ask()} disabled={thinking || !input.trim()} />
      </div>
    </Panel>
  );
}
