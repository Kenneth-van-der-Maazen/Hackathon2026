import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, Trash2, X } from "lucide-react";
import { useAgent } from "./useAgent";
import type { ToolContext } from "./tools";

const TOOL_LABELS: Record<string, string> = {
  get_portfolio_summary: "Portfolio",
  get_forecast_data: "Forecast",
  get_wip_projects: "WIP Projects",
  get_weather_insights: "Weather",
  get_covenant_status: "Covenants",
  set_scenario: "Set Scenario",
};

const SUGGESTIONS = [
  "What's the covenant headroom in the wet scenario?",
  "Which projects are at risk from weather?",
  "Summarise this week's cash flow drivers",
  "Draft a bank update on Q3 outlook",
];

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 animate-bounce rounded-full bg-text-muted"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

export function AgentPanel(ctx: ToolContext) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, isLoading, sendMessage, clearMessages } = useAgent(ctx);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  }

  return (
    <>
      {/* Floating bubble */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-8 right-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-accent-teal shadow-lg shadow-accent-teal/30 transition-all duration-300 hover:scale-110 focus-visible:outline-none ${
          open ? "pointer-events-none scale-90 opacity-0" : "opacity-100"
        }`}
        aria-label="Open AI Agent"
        title="AI Agent"
      >
        <Sparkles className="h-5 w-5 text-black" />
      </button>

      {/* Panel */}
      <div
        className={`fixed bottom-4 right-4 z-[60] flex flex-col overflow-hidden rounded-2xl border border-border-strong bg-bg-elevated shadow-2xl shadow-black/70 transition-all duration-300 ${
          open
            ? "pointer-events-auto h-[600px] w-[420px] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] opacity-100 translate-y-0"
            : "pointer-events-none h-0 w-[420px] max-w-[calc(100vw-2rem)] opacity-0 translate-y-4"
        }`}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-accent-teal" />
            <span className="text-sm font-semibold text-text-primary">
              Altis AI Agent
            </span>
            {isLoading && (
              <span className="flex items-center gap-0.5">
                {[0, 120, 240].map((d) => (
                  <span
                    key={d}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-teal"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearMessages}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-subtle transition hover:bg-bg-tertiary hover:text-text-primary"
                title="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-subtle transition hover:bg-bg-tertiary hover:text-text-primary"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center gap-5 py-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-teal/10">
                <Sparkles className="h-5 w-5 text-accent-teal" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-text-primary">
                  Altis Groep Intelligence
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  Forecasts · Projects · Weather · Covenants
                </p>
              </div>
              <div className="flex w-full flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendMessage(s)}
                    className="rounded-xl border border-border bg-bg-card px-3 py-2.5 text-left text-xs text-text-muted transition hover:border-accent-teal/30 hover:text-text-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message thread */
            <div className="flex flex-col gap-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${
                      msg.role === "user"
                        ? "rounded-tr-sm bg-accent-teal/15"
                        : msg.isError
                        ? "rounded-tl-sm border border-accent-red/20 bg-accent-red/10"
                        : "rounded-tl-sm bg-bg-card"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                      {msg.content}
                    </p>
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {msg.toolsUsed.map((tool) => (
                          <span
                            key={tool}
                            className="rounded-full bg-accent-teal/10 px-2 py-0.5 text-[10px] font-medium text-accent-teal"
                          >
                            {TOOL_LABELS[tool] ?? tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-tl-sm bg-bg-card px-4 py-3">
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input row */}
        <div className="flex-shrink-0 border-t border-border px-3 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about forecasts, projects, weather…"
              disabled={isLoading}
              className="flex-1 resize-none rounded-xl border border-border bg-bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle outline-none transition focus:border-accent-teal/50 disabled:opacity-60"
              style={{ minHeight: "36px", maxHeight: "120px" }}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent-teal text-black transition hover:bg-accent-teal-deep disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-text-subtle">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </>
  );
}
