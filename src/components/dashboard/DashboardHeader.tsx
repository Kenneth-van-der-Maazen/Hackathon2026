import { Calendar, MoreHorizontal, SlidersHorizontal } from "lucide-react";
import type { ForecastMeta, ScenarioId } from "../../types";
import { SCENARIO_LABELS } from "../../types";
import { forecastWindowLabel, forecastWindowTooltip } from "../../lib/forecastWindow";

interface DashboardHeaderProps {
  scenario?: ScenarioId;
  onScenarioChange?: (s: ScenarioId) => void;
  lastUpdated: string;
  forecastMeta?: ForecastMeta;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardHeader({ scenario, onScenarioChange, lastUpdated, forecastMeta }: DashboardHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
          {greeting()}
        </h1>
        <p className="mt-1 text-sm text-text-muted">Altis Groep · 13-week cash flow forecast</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {scenario && onScenarioChange && (
          <select
            value={scenario}
            onChange={(e) => onScenarioChange(e.target.value as ScenarioId)}
            className="h-10 rounded-full border border-border bg-bg-elevated px-4 text-sm text-text-primary"
            aria-label="Forecast scenario"
          >
            {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((s) => (
              <option key={s} value={s}>
                {SCENARIO_LABELS[s]}
              </option>
            ))}
          </select>
        )}
        <div
          title={forecastWindowTooltip(forecastMeta)}
          aria-label={forecastWindowTooltip(forecastMeta)}
          className="flex h-10 cursor-default items-center gap-2 rounded-full border border-border bg-bg-elevated px-4 text-sm text-text-muted"
        >
          <Calendar className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{forecastWindowLabel(forecastMeta)}</span>
          <span className="sm:hidden">13 weeks</span>
        </div>
        <button
          type="button"
          className="flex h-10 items-center gap-2 rounded-full border border-border bg-bg-elevated px-4 text-sm text-text-muted hover:text-white"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Customize</span>
        </button>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-muted hover:text-white"
          aria-label="More options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <span className="hidden text-xs text-text-subtle xl:inline">Updated {lastUpdated}</span>
      </div>
    </header>
  );
}
