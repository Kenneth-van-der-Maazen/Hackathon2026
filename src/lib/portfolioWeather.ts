export interface WeatherDayRecord {
  date: string;
  rainfallMm: number;
  tempMinC: number;
  isStoppage: boolean;
}

export interface WeatherHistoryFile {
  start?: string;
  end?: string;
  cities: Record<string, Record<string, WeatherDayRecord>>;
}

export interface MonthlyWeatherRow {
  key: string;
  label: string;
  rainfallMm: number;
  stoppageDays: number;
  rainDays: number;
}

export interface AnnualWeatherStats {
  totalRainfallMm: number;
  stoppageDays: number;
  rainDays: number;
  frostDays: number;
  daysTracked: number;
}

const MONTHS = [
  { m: "jan", l: "Jan" },
  { m: "feb", l: "Feb" },
  { m: "mar", l: "Mar" },
  { m: "apr", l: "Apr" },
  { m: "may", l: "May" },
  { m: "jun", l: "Jun" },
  { m: "jul", l: "Jul" },
  { m: "aug", l: "Aug" },
  { m: "sep", l: "Sep" },
  { m: "oct", l: "Oct" },
  { m: "nov", l: "Nov" },
  { m: "dec", l: "Dec" },
];

function cityDays(history: WeatherHistoryFile | null, city: string): Record<string, WeatherDayRecord> {
  if (!history?.cities) return {};
  return history.cities[city] ?? {};
}

export function getAnnualWeatherStats(
  history: WeatherHistoryFile | null,
  city: string,
  year: string,
): AnnualWeatherStats | null {
  const days = Object.values(cityDays(history, city)).filter((d) => d.date.startsWith(`${year}-`));
  if (!days.length) return null;

  let stoppageDays = 0;
  let rainDays = 0;
  let frostDays = 0;
  let totalRainfallMm = 0;

  for (const day of days) {
    totalRainfallMm += day.rainfallMm;
    if (day.isStoppage) stoppageDays += 1;
    if (day.rainfallMm >= 5) rainDays += 1;
    if (day.tempMinC < 0) frostDays += 1;
  }

  return {
    totalRainfallMm: Math.round(totalRainfallMm),
    stoppageDays,
    rainDays,
    frostDays,
    daysTracked: days.length,
  };
}

export function getMonthlyWeather(
  history: WeatherHistoryFile | null,
  city: string,
  year: string,
): MonthlyWeatherRow[] {
  const byMonth: Record<string, MonthlyWeatherRow> = {};
  for (const { m, l } of MONTHS) {
    byMonth[m] = { key: `${m}-${year.slice(-2)}`, label: l, rainfallMm: 0, stoppageDays: 0, rainDays: 0 };
  }

  for (const day of Object.values(cityDays(history, city))) {
    if (!day.date.startsWith(`${year}-`)) continue;
    const month = Number(day.date.slice(5, 7));
    const m = MONTHS[month - 1]?.m;
    if (!m) continue;
    byMonth[m].rainfallMm += day.rainfallMm;
    if (day.isStoppage) byMonth[m].stoppageDays += 1;
    if (day.rainfallMm >= 5) byMonth[m].rainDays += 1;
  }

  return MONTHS.map(({ m }) => ({
    ...byMonth[m],
    rainfallMm: Math.round(byMonth[m].rainfallMm),
  }));
}

export function weatherYearsForCity(history: WeatherHistoryFile | null, city: string): string[] {
  const years = new Set<string>();
  for (const day of Object.values(cityDays(history, city))) {
    years.add(day.date.slice(0, 4));
  }
  return [...years].sort();
}

export function portfolioWeatherComparison(
  history: WeatherHistoryFile | null,
  cities: string[],
  year: string,
): Array<{ name: string; stoppageDays: number; rainfallMm: number }> {
  return cities.map((city) => {
    const stats = getAnnualWeatherStats(history, city, year);
    return {
      name: city,
      stoppageDays: stats?.stoppageDays ?? 0,
      rainfallMm: stats?.totalRainfallMm ?? 0,
    };
  });
}
