import type { UnifiedRangeSummary, UnifiedTimeseries } from "../types";

function clampRange(start: string, end: string): [string, string] {
  return start <= end ? [start, end] : [end, start];
}

export function summarizeRangeFromTimeseries(
  timeseries: UnifiedTimeseries | null | undefined,
  start: string,
  end: string,
): UnifiedRangeSummary | null {
  if (!timeseries?.days?.length || !start || !end) return null;

  const [from, to] = clampRange(start.slice(0, 10), end.slice(0, 10));
  const byOpco: Record<string, number> = {};
  let rowCount = 0;
  let billing = 0;
  let materials = 0;
  let subcontractors = 0;
  let overhead = 0;
  let unmapped = 0;
  let net = 0;
  const series: UnifiedRangeSummary["series"] = [];

  for (const day of timeseries.days) {
    if (day.date < from || day.date > to) continue;
    rowCount += day.rowCount;
    billing += day.billing;
    materials += day.materials;
    subcontractors += day.subcontractors;
    overhead += day.overhead;
    unmapped += day.unmapped;
    net += day.net;
    series.push({
      date: day.date,
      billing: day.billing,
      net: day.net,
    });
  }

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

export function monthBuckets(summary: UnifiedRangeSummary): Array<{ label: string; billing: number; net: number }> {
  const buckets = new Map<string, { billing: number; net: number }>();
  for (const point of summary.series ?? []) {
    const label = point.date.slice(0, 7);
    const entry = buckets.get(label) ?? { billing: 0, net: 0 };
    entry.billing += point.billing;
    entry.net += point.net;
    buckets.set(label, entry);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, values]) => ({
      label,
      billing: Math.round(values.billing),
      net: Math.round(values.net),
    }));
}
