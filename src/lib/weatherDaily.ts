import type { ForecastMeta, WeatherDailyData, WeatherDailyDay } from "../types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekDatesFromStart(weekStartIso: string | undefined, week: number): string[] {
  if (!weekStartIso || week < 1) return [];
  const start = new Date(`${weekStartIso}T12:00:00`);
  start.setDate(start.getDate() + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function weekDates(meta: ForecastMeta | undefined, week: number): string[] {
  return weekDatesFromStart(meta?.forecastStart, week);
}

export function scheduleWeekDates(
  weatherDaily: { weekStart?: string } | null | undefined,
  weatherInsights: { weekStart?: string } | null | undefined,
  week: number,
): string[] {
  const anchor = weatherDaily?.weekStart ?? weatherInsights?.weekStart;
  if (anchor) return weekDatesFromStart(anchor, week);
  return weekDates(undefined, week);
}

export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${DAY_NAMES[d.getDay()]} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function dailyInWeek(
  weatherDaily: WeatherDailyData | null | undefined,
  meta: ForecastMeta | undefined,
  week: number,
): WeatherDailyDay[] {
  if (!weatherDaily?.days?.length) return [];
  const dates = new Set(weekDates(meta, week));
  return weatherDaily.days.filter((d) => dates.has(d.date));
}

export function dailyForDate(
  weatherDaily: WeatherDailyData | null | undefined,
  date: string,
  city?: string,
): WeatherDailyDay[] {
  if (!weatherDaily?.days?.length) return [];
  return weatherDaily.days.filter((d) => d.date === date && (!city || d.city === city));
}

export interface DayForecastRow {
  date: string;
  label: string;
  weekday: string;
  cities: Array<{
    city: string;
    rainfallMm: number;
    isStoppage: boolean;
    stoppageReasons: string[];
    tempRange: string;
  }>;
  dryCities: string[];
  rainCities: string[];
}

export function buildWeekDayForecast(
  weatherDaily: WeatherDailyData | null | undefined,
  weekStartIso: string | undefined,
  week: number,
): DayForecastRow[] {
  const dates = weekDatesFromStart(weekStartIso, week);
  return dates.map((date) => {
    const rows = dailyForDate(weatherDaily, date);
    const cities = rows.map((r) => ({
      city: r.city,
      rainfallMm: r.rainfallMm,
      isStoppage: r.isStoppage,
      stoppageReasons: r.stoppageReasons,
      tempRange: `${r.tempMinC}°C – ${r.tempMaxC}°C`,
    }));
    const rainCities = cities.filter((c) => c.isStoppage).map((c) => c.city);
    const dryCities = cities.filter((c) => !c.isStoppage).map((c) => c.city);
    const d = new Date(`${date}T12:00:00`);
    return {
      date,
      label: dayLabel(date),
      weekday: DAY_NAMES[d.getDay()],
      cities,
      dryCities,
      rainCities,
    };
  });
}

export function ruleBasedDailyInsight(
  weekForecast: DayForecastRow[],
  weekLabel: string,
  selectedDate?: string,
): string {
  if (!weekForecast.length) {
    return "No daily forecast loaded — run npm run data:weather.";
  }

  const rows = selectedDate
    ? weekForecast.filter((r) => r.date === selectedDate)
    : weekForecast;

  const lines: string[] = [];
  if (selectedDate && rows[0]) {
    const row = rows[0];
    if (row.rainCities.length === 0) {
      lines.push(`${row.label}: All sites dry — full outdoor roofing day.`);
    } else if (row.dryCities.length === 0) {
      lines.push(`${row.label}: Rain/frost at all sites — stand down or indoor tasks only.`);
    } else {
      lines.push(
        `${row.label}: Outdoor at ${row.dryCities.join(", ")}; indoor/alternate at ${row.rainCities.join(", ")}.`,
      );
    }
    for (const c of row.cities.filter((x) => x.isStoppage)) {
      lines.push(`  · ${c.city}: ${c.rainfallMm}mm${c.stoppageReasons.length ? ` (${c.stoppageReasons.join(", ")})` : ""}`);
    }
    return lines.join("\n");
  }

  lines.push(`${weekLabel} day-by-day:`);
  for (const row of weekForecast) {
    if (row.rainCities.length === 0) {
      lines.push(`  ${row.weekday}: All dry — prioritize membrane & detail work.`);
    } else if (row.dryCities.length === 0) {
      lines.push(`  ${row.weekday}: All sites affected — admin, workshop, stand-down.`);
    } else {
      lines.push(
        `  ${row.weekday}: Dry → ${row.dryCities.join(", ")} | Rain → ${row.rainCities.join(", ")}`,
      );
    }
  }
  return lines.join("\n");
}
