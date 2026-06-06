import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronDown, Loader2 } from "lucide-react";
import { buildRangePresets, DateRangeCalendar } from "@/components/DateRangeCalendar";
import { Button } from "@/components/ui/button";
import { formatEuro } from "@/lib/format";
import { forecastWindowLabel, computeForecastWindowFromAnchor } from "@/lib/forecastWindow";
import { shortOpcoLabel, summarizeRangeFromTimeseriesForOpco } from "@/lib/opcoFilter";
import type { DashboardViewMode, ForecastMeta, UnifiedRangeSummary, UnifiedTimeseries } from "@/types";

interface ForecastRangePickerProps {
  meta?: ForecastMeta;
  timeseries?: UnifiedTimeseries | null;
  viewMode: DashboardViewMode;
  onViewModeChange: (mode: DashboardViewMode) => void;
  onActualsChange: (summary: UnifiedRangeSummary | null) => void;
  onForecastRebuilt?: () => Promise<void>;
  selectedOpco?: string;
}

function formatInputLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRangeLabel(start: string, end: string): string {
  return `${formatInputLabel(start)} – ${formatInputLabel(end)}`;
}

export function ForecastRangePicker({
  meta,
  timeseries,
  viewMode,
  onViewModeChange,
  onActualsChange,
  onForecastRebuilt,
  selectedOpco = "all",
}: ForecastRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(meta?.dataMinDate ?? meta?.forecastStart ?? "");
  const [end, setEnd] = useState(meta?.dataMaxDate ?? meta?.forecastEnd ?? "");
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activityByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const day of timeseries?.days ?? []) {
      map[day.date] = day.rowCount;
    }
    return map;
  }, [timeseries]);

  const presets = useMemo(() => buildRangePresets(meta), [meta]);

  useEffect(() => {
    if (!meta) return;
    if (viewMode === "forecast") {
      setStart(meta.forecastStart);
      setEnd(meta.anchoredTo ?? meta.forecastEnd);
      return;
    }
    if (!start && meta.dataMinDate) setStart(meta.dataMinDate);
    if (!end && meta.dataMaxDate) setEnd(meta.dataMaxDate);
  }, [meta, viewMode, meta?.forecastStart, meta?.forecastEnd, meta?.dataMinDate, meta?.dataMaxDate]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const min = meta?.dataMinDate ?? "";
  const max = meta?.dataMaxDate ?? "";
  const opcoSuffix = selectedOpco !== "all" ? ` · ${shortOpcoLabel(selectedOpco)}` : "";
  const pillLabel =
    viewMode === "actuals" && start && end
      ? `${formatRangeLabel(start, end)}${opcoSuffix}`
      : `${forecastWindowLabel(meta)}${opcoSuffix}`;

  function applyActualsRange() {
    setError(null);
    const summary = summarizeRangeFromTimeseriesForOpco(timeseries, start, end, selectedOpco);
    if (!summary) {
      setError(
        selectedOpco === "all"
          ? "No unified data for this range — run npm run data:forecast after upload."
          : `No rows for ${shortOpcoLabel(selectedOpco)} in this range.`,
      );
      return;
    }
    onViewModeChange("actuals");
    onActualsChange(summary);
    setOpen(false);
  }

  async function rebuildForecast() {
    if (!end) return;
    setRebuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/forecast/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchorEnd: end }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = typeof body.detail === "string" ? body.detail : null;
        if (res.status === 404) {
          throw new Error(
            "Forecast rebuild endpoint missing — restart the API with npm run dev:api (or npm run dev:full), then retry.",
          );
        }
        throw new Error(detail ?? "Forecast rebuild failed");
      }
      onViewModeChange("forecast");
      onActualsChange(null);
      await onForecastRebuilt?.();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Forecast rebuild failed");
    } finally {
      setRebuilding(false);
    }
  }

  function handleCalendarChange(nextStart: string, nextEnd: string) {
    if (viewMode === "forecast" && nextEnd) {
      const window = computeForecastWindowFromAnchor(nextEnd);
      setStart(window.forecastStart);
      setEnd(window.anchoredTo);
      return;
    }
    setStart(nextStart);
    setEnd(nextEnd);
  }

  function handleEndChange(nextEnd: string) {
    if (viewMode === "forecast" && nextEnd) {
      const window = computeForecastWindowFromAnchor(nextEnd);
      setStart(window.forecastStart);
      setEnd(window.anchoredTo);
      return;
    }
    setEnd(nextEnd);
  }

  return (
    <div className="relative" ref={panelRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 rounded-full gap-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Calendar className="size-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline">{pillLabel}</span>
        <span className="sm:hidden">{viewMode === "actuals" ? "Actuals" : "13 wks"}</span>
        <ChevronDown className={`size-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 shadow-xl">
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            <button
              type="button"
              className={`flex-1 rounded-md px-2 py-1.5 ${viewMode === "actuals" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
              onClick={() => onViewModeChange("actuals")}
            >
              Actual income
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-2 py-1.5 ${viewMode === "forecast" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
              onClick={() => onViewModeChange("forecast")}
            >
              13-week forecast
            </button>
          </div>

          {presets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={() => {
                    setStart(preset.start);
                    setEnd(preset.end);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3">
            <DateRangeCalendar
              min={min}
              max={max}
              start={start}
              end={end}
              onChange={handleCalendarChange}
              activityByDate={activityByDate}
              mode={viewMode === "forecast" ? "anchor" : "range"}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              From
              <input
                type="date"
                value={start}
                min={min}
                max={max}
                readOnly={viewMode === "forecast"}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-70"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              {viewMode === "forecast" ? "Anchor end" : "To"}
              <input
                type="date"
                value={end}
                min={min}
                max={max}
                onChange={(e) => handleEndChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
          </div>

          {viewMode === "actuals" ? (
            <>
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full"
                disabled={!start || !end}
                onClick={applyActualsRange}
              >
                Show income in this period
              </Button>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Calendar + date fields stay in sync. Green dots show days with uploaded transactions.
                {selectedOpco !== "all"
                  ? ` Filtering to ${shortOpcoLabel(selectedOpco)}.`
                  : " Use the opco filter in the toolbar to narrow by company."}
              </p>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full"
                disabled={!end || rebuilding}
                onClick={() => void rebuildForecast()}
              >
                {rebuilding ? <Loader2 className="size-4 animate-spin" /> : null}
                Apply 13-week forecast ending on this date
              </Button>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Pick an end date on the calendar to re-anchor the 13-week cash forecast window.
              </p>
            </>
          )}

          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      )}
    </div>
  );
}

interface ActualsBannerProps {
  summary: UnifiedRangeSummary;
  opcoLabel?: string;
  onClear: () => void;
}

export function ActualsRangeBanner({ summary, opcoLabel, onClear }: ActualsBannerProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
      <div>
        <p className="font-medium">
          Actual income · {formatRangeLabel(summary.start, summary.end)}
          {opcoLabel ? ` · ${opcoLabel}` : ""}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          Billing {formatEuro(summary.billing)} · Materials {formatEuro(summary.materials)} · Net{" "}
          {formatEuro(summary.net)} · {summary.rowCount.toLocaleString()} rows
        </p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Back to forecast
      </Button>
    </div>
  );
}
