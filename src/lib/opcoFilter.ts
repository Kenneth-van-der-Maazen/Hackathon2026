import type {
  DriverKey,
  ScenarioId,
  TraceRecord,
  UnifiedDayTotals,
  UnifiedRangeSummary,
  UnifiedTimeseries,
  WeekForecast,
  WipProject,
} from "../types";

const DRIVER_KEYS: DriverKey[] = [
  "materials",
  "subcontractors",
  "milestoneBilling",
  "paymentLag",
  "weatherImpact",
];

export function listOpcos(
  timeseries: UnifiedTimeseries | null | undefined,
  wip: WipProject[],
): string[] {
  const fromTs = timeseries?.opcos ?? [];
  const fromWip = wip.map((p) => p.opco);
  return [...new Set([...fromTs, ...fromWip].filter(Boolean))].sort();
}

export function resolveTraceOpco(trace: TraceRecord, wip: WipProject[]): string {
  const fromWip = wip.find((p) => p.projectId === trace.projectId)?.opco;
  if (fromWip) return fromWip;

  const slug = trace.projectId.replace(/^PRJ-/i, "").replace(/-001$/, "").toLowerCase();
  if (slug.includes("winschoten")) return "Portfolio Company Winschoten";
  if (slug.includes("andijk")) return "Portfolio Company Andijk";
  if (slug.includes("heeze")) return "Portfolio Company Heeze";
  if (slug.includes("brunssum")) return "Dakdekkersbedrijf Peter Ummels";

  const fromAssumption = trace.assumption?.match(/Unified DB · (.+)$/)?.[1];
  return fromAssumption ?? "Unknown";
}

export function aggregateForecastWeeks(
  baseWeeks: WeekForecast[],
  traces: TraceRecord[],
  scenario: ScenarioId,
  opco: string,
  wip: WipProject[],
): WeekForecast[] {
  if (opco === "all") {
    return baseWeeks;
  }

  const filtered = traces.filter(
    (t) => t.scenario === scenario && resolveTraceOpco(t, wip) === opco,
  );

  return baseWeeks.map((week) => {
    const row: WeekForecast = {
      week: week.week,
      label: week.label,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      chartLabel: week.chartLabel,
      materials: 0,
      subcontractors: 0,
      milestoneBilling: 0,
      paymentLag: 0,
      weatherImpact: 0,
      net: 0,
    };

    for (const trace of filtered.filter((t) => t.week === week.week)) {
      const driver = trace.driver as DriverKey;
      if (DRIVER_KEYS.includes(driver)) {
        row[driver] += trace.amount;
      }
    }

    row.net = Math.round(
      row.materials +
        row.subcontractors +
        row.milestoneBilling +
        row.paymentLag +
        row.weatherImpact,
    );
    for (const key of DRIVER_KEYS) {
      row[key] = Math.round(row[key]);
    }
    return row;
  });
}

function dayTotalsForOpco(day: UnifiedDayTotals, opco: string): UnifiedDayTotals {
  if (opco === "all" || !day.opcos?.[opco]) {
    return day;
  }
  const o = day.opcos[opco];
  return {
    date: day.date,
    rowCount: o.rowCount,
    billing: o.billing,
    materials: o.materials,
    subcontractors: o.subcontractors,
    overhead: o.overhead,
    unmapped: o.unmapped,
    net: o.net,
    opcos: day.opcos,
  };
}

export function summarizeRangeFromTimeseriesForOpco(
  timeseries: UnifiedTimeseries | null | undefined,
  start: string,
  end: string,
  opco: string,
): UnifiedRangeSummary | null {
  if (!timeseries?.days?.length || !start || !end) return null;

  const [from, to] = start <= end ? [start, end] : [end, start];
  const byOpco: Record<string, number> = {};
  let rowCount = 0;
  let billing = 0;
  let materials = 0;
  let subcontractors = 0;
  let overhead = 0;
  let unmapped = 0;
  let net = 0;
  const series: NonNullable<UnifiedRangeSummary["series"]> = [];

  for (const day of timeseries.days) {
    if (day.date < from || day.date > to) continue;
    const slice = dayTotalsForOpco(day, opco);
    if (slice.rowCount === 0 && opco !== "all") continue;

    rowCount += slice.rowCount;
    billing += slice.billing;
    materials += slice.materials;
    subcontractors += slice.subcontractors;
    overhead += slice.overhead;
    unmapped += slice.unmapped;
    net += slice.net;

    if (opco === "all" && day.opcos) {
      for (const [name, totals] of Object.entries(day.opcos)) {
        byOpco[name] = (byOpco[name] ?? 0) + totals.billing;
      }
    } else if (opco !== "all") {
      byOpco[opco] = (byOpco[opco] ?? 0) + slice.billing;
    }

    series.push({
      date: day.date,
      billing: slice.billing,
      net: slice.net,
    });
  }

  if (rowCount === 0) return null;

  return {
    start: from,
    end: to,
    rowCount,
    billing: Math.round(billing),
    materials: Math.round(materials),
    subcontractors: Math.round(subcontractors),
    overhead: Math.round(overhead),
    unmapped: Math.round(unmapped),
    net: Math.round(net),
    byOpco,
    series,
  };
}

export function shortOpcoLabel(name: string): string {
  if (name === "all") return "All opcos";
  const city = name.match(/Company (\w+)|bedrijf (.+)/i);
  if (city?.[1]) return city[1];
  if (name.includes("Ummels")) return "Brunssum";
  if (name.length > 22) return name.slice(0, 20) + "…";
  return name;
}
