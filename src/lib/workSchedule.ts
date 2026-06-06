import type { ForecastMeta, WeatherDailyDay, WeatherInsights, WipProject } from "../types";

export type WorkMode = "outdoor" | "indoor" | "mixed" | "stand_down";

export interface CrewTask {
  id: string;
  label: string;
  kind: "outdoor" | "indoor";
}

export interface SiteWeekPlan {
  city: string;
  opco: string;
  week: number;
  weekLabel: string;
  weekStart: string;
  mode: WorkMode;
  rainfallMm: number;
  stoppageDays: number;
  tempRange: string;
  outdoorTasks: CrewTask[];
  indoorTasks: CrewTask[];
  crewMessage: string;
  linkedProjects: string[];
  notifyRecommended: boolean;
}

export interface SchedulePlan {
  generatedAt: string;
  weatherSource: string;
  summary: string;
  sites: SiteWeekPlan[];
}

export interface CrewNotification {
  id: string;
  sentAt: string;
  city: string;
  weekLabel: string;
  message: string;
  channel: string;
  author: string;
}

const OUTDOOR_BY_MODE: Record<WorkMode, string[]> = {
  outdoor: [
    "Membrane / bitumen lay-up on open sections",
    "Flashing and detail work — maximize dry windows",
    "Scaffolding moves and edge protection checks",
  ],
  mixed: [
    "Morning: outdoor prep where radar stays clear",
    "Afternoon: switch to sheltered sections if showers build",
  ],
  indoor: [],
  stand_down: [],
};

const INDOOR_BY_MODE: Record<WorkMode, string[]> = {
  outdoor: ["Toolbox talk + next-week material staging only"],
  mixed: [
    "Quotes, variation orders, and customer callbacks",
    "Warehouse: cut insulation packs for next dry window",
  ],
  indoor: [
    "Admin, invoicing, and WIP photo documentation",
    "Equipment service and van stock reconciliation",
    "Safety training and toolbox talks in depot",
    "Prefabrication / cut-to-size in workshop",
  ],
  stand_down: [
    "Full stand-down — no roof access",
    "Reschedule subs; confirm customer comms",
    "Catch-up on compliance and certification renewals",
  ],
};

function modeFromWeather(stoppageDays: number, rainfallMm: number, frostDays: number): WorkMode {
  if (stoppageDays >= 3 || rainfallMm >= 25) return "stand_down";
  if (stoppageDays >= 2 || rainfallMm >= 12 || frostDays > 0) return "indoor";
  if (stoppageDays === 1 || rainfallMm >= 5) return "mixed";
  return "outdoor";
}

function crewMessage(
  plan: Pick<
    SiteWeekPlan,
    "city" | "weekLabel" | "mode" | "rainfallMm" | "stoppageDays" | "linkedProjects"
  >,
): string {
  const projects =
    plan.linkedProjects.length > 0
      ? ` Projects: ${plan.linkedProjects.join(", ")}.`
      : "";
  switch (plan.mode) {
    case "outdoor":
      return `${plan.city} ${plan.weekLabel}: Dry window — prioritize outdoor roofing.${projects} Target membrane and detail work while conditions hold.`;
    case "mixed":
      return `${plan.city} ${plan.weekLabel}: Mixed week (${plan.rainfallMm}mm rain). Outdoor mornings; move crews indoors if showers hit.${projects}`;
    case "indoor":
      return `${plan.city} ${plan.weekLabel}: Wet week (${plan.stoppageDays} stoppage days). Outdoor work paused — admin, workshop, and prep tasks.${projects}`;
    case "stand_down":
      return `${plan.city} ${plan.weekLabel}: Heavy rain/frost — stand down roof work. Notify subs and customers.${projects}`;
  }
}

function tasks(kind: "outdoor" | "indoor", labels: string[], prefix: string): CrewTask[] {
  return labels.map((label, i) => ({
    id: `${prefix}-${i}`,
    label,
    kind,
  }));
}

export function buildSchedulePlan(
  weather: WeatherInsights | null,
  wip: WipProject[],
  selectedWeek?: number,
): SchedulePlan | null {
  if (!weather?.cities?.length) return null;

  const sites: SiteWeekPlan[] = [];

  for (const cityBlock of weather.cities) {
    const weeks = selectedWeek
      ? cityBlock.weekly.filter((w) => w.week === selectedWeek)
      : cityBlock.weekly.slice(0, 4);

    for (const w of weeks) {
      const mode = modeFromWeather(w.stoppageDays, w.rainfallMm, w.frostDays);
      const linked = wip
        .filter(
          (p) =>
            p.project.toLowerCase().includes(cityBlock.city.toLowerCase()) ||
            p.opco === cityBlock.opco,
        )
        .map((p) => p.project);

      const base = {
        city: cityBlock.city,
        opco: cityBlock.opco,
        week: w.week,
        weekLabel: w.label,
        weekStart: w.weekStart,
        mode,
        rainfallMm: w.rainfallMm,
        stoppageDays: w.stoppageDays,
        tempRange: `${w.tempMinC}°C – ${w.tempMaxC}°C`,
        linkedProjects: linked,
        notifyRecommended: mode === "indoor" || mode === "stand_down",
      };

      sites.push({
        ...base,
        outdoorTasks: tasks("outdoor", OUTDOOR_BY_MODE[mode], `${cityBlock.city}-out-${w.week}`),
        indoorTasks: tasks("indoor", INDOOR_BY_MODE[mode], `${cityBlock.city}-in-${w.week}`),
        crewMessage: crewMessage(base),
      });
    }
  }

  const outdoorCount = sites.filter((s) => s.mode === "outdoor").length;
  const standDown = sites.filter((s) => s.mode === "stand_down").length;

  return {
    generatedAt: new Date().toISOString(),
    weatherSource: weather.source,
    summary: `${outdoorCount} site-weeks with outdoor priority, ${standDown} stand-down. Based on Open-Meteo + unified WIP.`,
    sites: sites.sort((a, b) => a.week - b.week || a.city.localeCompare(b.city)),
  };
}

/** Fallback when weather_insights.json is empty — still show crew plans from WIP. */
export function buildFallbackSchedulePlan(
  wip: WipProject[],
  selectedWeek: number,
  meta?: ForecastMeta,
): SchedulePlan {
  const weekStartIso = meta?.forecastStart
    ? (() => {
        const d = new Date(`${meta.forecastStart}T12:00:00`);
        d.setDate(d.getDate() + (selectedWeek - 1) * 7);
        return d.toISOString().slice(0, 10);
      })()
    : `Week ${selectedWeek}`;

  const opcoByCity = new Map<string, string>();
  for (const p of wip) {
    if (p.city && p.opco) opcoByCity.set(p.city, p.opco);
  }

  const cities =
    opcoByCity.size > 0
      ? [...opcoByCity.entries()]
      : wip.map((p) => [p.city, p.opco] as const).filter(([c]) => c && c !== "Unknown");

  const unique = new Map<string, string>();
  for (const [city, opco] of cities) {
    if (city) unique.set(city, opco);
  }

  const sites: SiteWeekPlan[] = [...unique.entries()].map(([city, opco]) => {
    const linked = wip
      .filter((p) => p.city === city || p.opco === opco)
      .map((p) => p.project);
    const mode: WorkMode = "outdoor";
    const base = {
      city,
      opco,
      week: selectedWeek,
      weekLabel: `W${selectedWeek}`,
      weekStart: weekStartIso,
      mode,
      rainfallMm: 0,
      stoppageDays: 0,
      tempRange: "—",
      linkedProjects: linked,
      notifyRecommended: false,
    };
    return {
      ...base,
      outdoorTasks: tasks("outdoor", OUTDOOR_BY_MODE[mode], `${city}-out-${selectedWeek}`),
      indoorTasks: tasks("indoor", OUTDOOR_BY_MODE.outdoor, `${city}-in-${selectedWeek}`),
      crewMessage: `${city} W${selectedWeek}: Weather data not loaded — assuming dry conditions. Run npm run data:weather for live stoppage days.${linked.length ? ` Projects: ${linked.join(", ")}.` : ""}`,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    weatherSource: "Unavailable",
    summary: `${sites.length} sites from unified WIP. Fetch weather (npm run data:weather) for rain/frost stoppage planning.`,
    sites,
  };
}

export function buildDaySchedulePlan(
  weatherDaily: WeatherDailyDay[],
  wip: WipProject[],
  date: string,
): SchedulePlan | null {
  if (!weatherDaily.length) return null;

  const sites: SiteWeekPlan[] = weatherDaily.map((day) => {
    const stoppageDays = day.isStoppage ? 1 : 0;
    const mode = modeFromWeather(stoppageDays, day.rainfallMm, day.stoppageReasons.includes("frost") ? 1 : 0);
    const linked = wip
      .filter(
        (p) =>
          p.project.toLowerCase().includes(day.city.toLowerCase()) ||
          p.city === day.city ||
          p.opco.toLowerCase().includes(day.city.toLowerCase()),
      )
      .map((p) => p.project);
    const opco = wip.find((p) => p.city === day.city)?.opco ?? day.city;

    const base = {
      city: day.city,
      opco,
      week: 0,
      weekLabel: dayLabel(date),
      weekStart: date,
      mode,
      rainfallMm: day.rainfallMm,
      stoppageDays,
      tempRange: `${day.tempMinC}°C – ${day.tempMaxC}°C`,
      linkedProjects: linked,
      notifyRecommended: mode === "indoor" || mode === "stand_down",
    };

    return {
      ...base,
      outdoorTasks: tasks("outdoor", OUTDOOR_BY_MODE[mode], `${day.city}-out-${date}`),
      indoorTasks: tasks("indoor", INDOOR_BY_MODE[mode], `${day.city}-in-${date}`),
      crewMessage: crewMessage({ ...base, weekLabel: dayLabel(date) }),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    weatherSource: "Open-Meteo (daily)",
    summary: `${sites.filter((s) => s.mode === "outdoor").length} sites outdoor, ${sites.filter((s) => s.notifyRecommended).length} need crew alerts on ${dayLabel(date)}.`,
    sites,
  };
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[d.getDay()]} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export const MODE_LABELS: Record<WorkMode, string> = {
  outdoor: "Outdoor roofing",
  indoor: "Indoor / alternate",
  mixed: "Mixed — flex crews",
  stand_down: "Stand down",
};

export const MODE_COLORS: Record<WorkMode, string> = {
  outdoor: "#34d399",
  indoor: "#60a5fa",
  mixed: "#fbbf24",
  stand_down: "#f87171",
};
