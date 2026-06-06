import type { ForecastMeta, WeekForecast } from "../types";

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function forecastWindowLabel(meta?: ForecastMeta): string {
  if (meta?.forecastStart && meta?.forecastEnd) {
    return `${formatDate(meta.forecastStart)} – ${formatDate(meta.forecastEnd)}`;
  }
  return "13-week window";
}

export function forecastWindowTooltip(meta?: ForecastMeta): string {
  if (!meta) {
    return "13-week forecast window (re-run forecast after upload to refresh dates).";
  }
  const anchored = meta.anchoredTo ? formatDate(meta.anchoredTo) : "your latest transaction";
  return `${meta.anchorNote} Latest transaction: ${anchored}.`;
}

export function forecastWeekLabel(meta: ForecastMeta | undefined, week: number): string {
  if (!meta?.forecastStart || week < 1 || week > 13) return `W${week}`;
  const start = new Date(`${meta.forecastStart}T12:00:00`);
  start.setDate(start.getDate() + (week - 1) * 7);
  return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function weekRangeLabel(weekStart?: string, weekEnd?: string): string {
  if (!weekStart) return "";
  const start = formatDate(weekStart);
  return weekEnd ? `${start} – ${formatDate(weekEnd)}` : start;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Mirror forecast.py load_unified() — anchor end date → 13-week window. */
export function computeForecastWindowFromAnchor(anchorEnd: string): {
  forecastStart: string;
  forecastEnd: string;
  anchoredTo: string;
} {
  const latest = new Date(`${anchorEnd}T12:00:00`);
  const forecastStart = new Date(latest);
  forecastStart.setDate(forecastStart.getDate() - (13 - 1) * 7);
  const mondayOffset = (forecastStart.getDay() + 6) % 7;
  forecastStart.setDate(forecastStart.getDate() - mondayOffset);
  const forecastEnd = new Date(forecastStart);
  forecastEnd.setDate(forecastEnd.getDate() + 13 * 7 - 1);
  return {
    forecastStart: toIsoDate(forecastStart),
    forecastEnd: toIsoDate(forecastEnd),
    anchoredTo: toIsoDate(latest),
  };
}

export function enrichWeeksWithDates(weeks: WeekForecast[], meta?: ForecastMeta): WeekForecast[] {
  if (!meta?.forecastStart) return weeks;
  return weeks.map((w) => {
    if (w.weekStart && w.chartLabel) return w;
    const start = new Date(`${meta.forecastStart}T12:00:00`);
    start.setDate(start.getDate() + (w.week - 1) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      ...w,
      weekStart: toIsoDate(start),
      weekEnd: toIsoDate(end),
      chartLabel: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  });
}
