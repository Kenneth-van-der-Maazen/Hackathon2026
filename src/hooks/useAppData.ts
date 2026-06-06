import { useCallback, useEffect, useState } from "react";
import type { CovenantSummary, ForecastData, TraceRecord, UnifiedTimeseries, WeatherDailyData, WeatherInsights, WipProject } from "../types";
import type { SubsidiaryCompany } from "../data/altisPortfolio";

interface AppData {
  forecast: ForecastData;
  traces: TraceRecord[];
  wip: WipProject[];
  covenant: CovenantSummary;
  weatherInsights: WeatherInsights | null;
  portfolio: SubsidiaryCompany[];
  timeseries: UnifiedTimeseries | null;
  weatherDaily: WeatherDailyData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAppData(): AppData {
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [wip, setWip] = useState<WipProject[]>([]);
  const [covenant, setCovenant] = useState<CovenantSummary | null>(null);
  const [weatherInsights, setWeatherInsights] = useState<WeatherInsights | null>(null);
  const [portfolio, setPortfolio] = useState<SubsidiaryCompany[]>([]);
  const [timeseries, setTimeseries] = useState<UnifiedTimeseries | null>(null);
  const [weatherDaily, setWeatherDaily] = useState<WeatherDailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, t, w, c, wi, ps, ts, wd] = await Promise.all([
        fetch("/data/forecast.json").then((r) => r.json()),
        fetch("/data/trace_data.json").then((r) => r.json()),
        fetch("/data/wip_data.json").then((r) => r.json()),
        fetch("/data/covenant_summary.json").then((r) => r.json()),
        fetch("/data/weather_insights.json").then((r) => (r.ok ? r.json() : null)),
        fetch("/data/portfolio_stats.json").then((r) => (r.ok ? r.json() : { companies: [] })),
        fetch("/data/unified_timeseries.json").then((r) => (r.ok ? r.json() : null)),
        fetch("/data/weather_daily.json").then((r) => (r.ok ? r.json() : null)),
      ]);
      setForecast(f);
      setTraces(t);
      setWip(w);
      setCovenant(c);
      setWeatherInsights(wi);
      setPortfolio(ps.companies ?? []);
      setTimeseries(ts);
      setWeatherDaily(wd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    forecast: forecast ?? { base: [], wet: [], dry: [] },
    traces,
    wip,
    covenant: covenant ?? {
      headroomThresholdEur: 500_000,
      interestCoverageRatio: 2.4,
      interestCoverageMinimum: 2.0,
      headroomByScenario: { base: 500_000, wet: 400_000, dry: 550_000 },
      wetQuarterEarlyWeeksWorse: true,
    },
    weatherInsights,
    portfolio,
    timeseries,
    weatherDaily,
    loading,
    error,
    refetch: load,
  };
}
