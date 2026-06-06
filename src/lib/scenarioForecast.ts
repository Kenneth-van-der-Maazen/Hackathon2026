import type { ForecastData, ForecastMeta, ScenarioId, ScenarioWindowPick } from "@/types";

export function scenarioWindowPick(
  forecast: ForecastData,
  scenario: ScenarioId,
  opco: string,
): ScenarioWindowPick | null {
  if (scenario === "base") return null;
  const key = opco === "all" ? "all" : opco;
  return forecast.scenarioWindows?.[scenario]?.[key] ?? forecast.scenarioWindows?.[scenario]?.all ?? null;
}

export function activeScenarioMeta(
  forecast: ForecastData,
  scenario: ScenarioId,
  opco: string,
  override?: ForecastMeta | null,
): ForecastMeta | undefined {
  if (override) return override;
  if (scenario === "base") return forecast.meta;
  const key = opco === "all" ? "all" : opco;
  const fromScenario = forecast.scenarioMeta?.[scenario];
  if (fromScenario) return fromScenario;
  const pick = scenarioWindowPick(forecast, scenario, opco);
  if (!pick) return forecast.meta;
  return {
    ...forecast.meta,
    forecastStart: pick.forecastStart,
    forecastEnd: pick.forecastEnd,
    anchoredTo: pick.anchorEnd,
    rowsInWindow: pick.rowsInWindow,
    selectionReason: pick.selectionReason,
    stoppageDays: pick.stoppageDays,
    totalRainfallMm: pick.totalRainfallMm,
    rainDays: pick.rainDays,
    weatherCities: pick.cities,
  };
}

export function needsOpcoScenarioFetch(scenario: ScenarioId, opco: string): boolean {
  return scenario !== "base" && opco !== "all";
}
