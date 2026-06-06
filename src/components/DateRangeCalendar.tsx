import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DateRangeCalendarProps {
  min?: string;
  max?: string;
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  activityByDate?: Record<string, number>;
  /** In anchor mode, a single click sets the end date (for 13-week forecast). */
  mode?: "range" | "anchor";
}

function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function inRange(date: string, start: string, end: string): boolean {
  if (!start || !end) return false;
  const [a, b] = start <= end ? [start, end] : [end, start];
  return date >= a && date <= b;
}

function monthMatrix(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

export function DateRangeCalendar({
  min,
  max,
  start,
  end,
  onChange,
  activityByDate = {},
  mode = "range",
}: DateRangeCalendarProps) {
  const anchor = start ? parseIso(start) : new Date();
  const [viewYear, setViewYear] = useState(anchor.getFullYear());
  const [viewMonth, setViewMonth] = useState(anchor.getMonth());
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  const matrix = useMemo(() => monthMatrix(viewYear, viewMonth), [viewYear, viewMonth]);

  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  function selectDate(iso: string) {
    if (min && iso < min) return;
    if (max && iso > max) return;

    if (mode === "anchor") {
      setPendingStart(null);
      onChange(start, iso);
      return;
    }

    if (!pendingStart) {
      setPendingStart(iso);
      onChange(iso, iso);
      return;
    }

    const [a, b] = pendingStart <= iso ? [pendingStart, iso] : [iso, pendingStart];
    setPendingStart(null);
    onChange(a, b);
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-sm font-medium">{monthLabel}</p>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {matrix.flat().map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} className="h-8" />;
          }
          const iso = toIso(day);
          const disabled = (min && iso < min) || (max && iso > max);
          const selected =
            mode === "anchor" ? iso === end : iso === start || iso === end;
          const ranged = mode === "anchor" ? false : inRange(iso, start, end);
          const activity = activityByDate[iso] ?? 0;

          return (
            <button
              key={iso}
              type="button"
              disabled={Boolean(disabled)}
              onClick={() => selectDate(iso)}
              className={cn(
                "relative h-8 rounded-md text-xs tabular-nums transition-colors",
                disabled && "cursor-not-allowed opacity-30",
                !disabled && !selected && !ranged && "hover:bg-secondary",
                ranged && !selected && "bg-secondary/60",
                selected && "bg-primary text-primary-foreground",
              )}
            >
              {day.getDate()}
              {activity > 0 ? (
                <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-400" />
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {mode === "anchor"
          ? "Click an end date to re-anchor the 13-week forecast. Green dots = transactions in unified database."
          : "Click a start date, then an end date. Green dots = transactions in unified database."}
      </p>
    </div>
  );
}

interface RangePreset {
  id: string;
  label: string;
  start: string;
  end: string;
}

export function buildRangePresets(meta?: {
  dataMinDate?: string;
  dataMaxDate?: string;
  forecastStart?: string;
  forecastEnd?: string;
}): RangePreset[] {
  if (!meta?.dataMinDate || !meta?.dataMaxDate) return [];
  const presets: RangePreset[] = [];
  if (meta.forecastStart && meta.forecastEnd) {
    presets.push({
      id: "forecast",
      label: "13-week forecast",
      start: meta.forecastStart,
      end: meta.forecastEnd,
    });
  }
  presets.push({
    id: "full",
    label: "Full database",
    start: meta.dataMinDate,
    end: meta.dataMaxDate,
  });
  const endYear = meta.dataMaxDate.slice(0, 4);
  presets.push({
    id: "ytd",
    label: `YTD ${endYear}`,
    start: `${endYear}-01-01`,
    end: meta.dataMaxDate,
  });
  return presets;
}
