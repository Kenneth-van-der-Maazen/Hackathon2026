export type ScenarioId = "base" | "wet" | "dry";

export type RoleId = "cfo" | "data" | "portfolio" | "schedule";

export interface WeekForecast {
  week: number;
  label: string;
  weekStart?: string;
  weekEnd?: string;
  chartLabel?: string;
  materials: number;
  subcontractors: number;
  milestoneBilling: number;
  paymentLag: number;
  weatherImpact: number;
  net: number;
}

export interface ForecastMeta {
  weeks: number;
  forecastStart: string;
  forecastEnd: string;
  anchoredTo: string;
  dataMinDate?: string;
  dataMaxDate?: string;
  rowsInWindow: number;
  totalRows: number;
  editable: boolean;
  anchorNote: string;
  selectionReason?: string;
  stoppageDays?: number;
  totalRainfallMm?: number;
  rainDays?: number;
  weatherCities?: string[];
}

export interface ScenarioWindowPick {
  anchorEnd: string;
  forecastStart: string;
  forecastEnd: string;
  rowsInWindow: number;
  stoppageDays: number;
  totalRainfallMm: number;
  rainDays: number;
  score: number;
  cities: string[];
  selectionReason: string;
}

export interface UnifiedRangeSummary {
  start: string;
  end: string;
  rowCount: number;
  billing: number;
  materials: number;
  subcontractors: number;
  overhead: number;
  unmapped: number;
  net: number;
  byOpco: Record<string, number>;
  series?: Array<{ date: string; billing: number; net: number }>;
}

export interface UnifiedDayTotals {
  date: string;
  rowCount: number;
  billing: number;
  materials: number;
  subcontractors: number;
  overhead: number;
  unmapped: number;
  net: number;
  opcos?: Record<
    string,
    {
      rowCount: number;
      billing: number;
      materials: number;
      subcontractors: number;
      overhead: number;
      unmapped: number;
      net: number;
    }
  >;
}

export interface UnifiedTimeseries {
  source: string;
  dataMinDate: string | null;
  dataMaxDate: string | null;
  totalRows: number;
  opcos?: string[];
  days: UnifiedDayTotals[];
}

export type DashboardViewMode = "actuals" | "forecast";

export interface ForecastData {
  meta?: ForecastMeta;
  scenarioMeta?: Partial<Record<ScenarioId, ForecastMeta>>;
  scenarioWindows?: {
    wet: Record<string, ScenarioWindowPick>;
    dry: Record<string, ScenarioWindowPick>;
  };
  base: WeekForecast[];
  wet: WeekForecast[];
  dry: WeekForecast[];
}

export interface TraceRecord {
  week: number;
  driver: string;
  amount: number;
  scenario: string;
  sourceSystem: string;
  glAccount: string;
  projectId: string;
  projectName: string;
  assumption: string;
  sourceDate?: string;
  sourceDescription?: string;
}

export type ProjectStatus = "On Track" | "At Risk" | "Delayed" | "Not Started";

export interface WipProject {
  projectId: string;
  project: string;
  opco: string;
  contractValue: number;
  wipToDate: number;
  pctComplete: number;
  nextMilestone: string;
  status: ProjectStatus;
  weatherRisk: boolean;
  riskReason: string;
  materialsCommitted: number;
  subcontractorWeek: number;
  actionNeeded: string;
}

export interface CovenantSummary {
  headroomThresholdEur: number;
  interestCoverageRatio: number;
  interestCoverageMinimum: number;
  headroomByScenario: Record<ScenarioId, number>;
  wetQuarterEarlyWeeksWorse: boolean;
}

export type DriverKey =
  | "materials"
  | "subcontractors"
  | "milestoneBilling"
  | "paymentLag"
  | "weatherImpact";

export interface TraceSelection {
  week: number;
  driver: DriverKey;
  scenario: ScenarioId;
}

export const DRIVER_LABELS: Record<DriverKey, string> = {
  materials: "Materials Outflows",
  subcontractors: "Subcontractor Payments",
  milestoneBilling: "Milestone Billing",
  paymentLag: "Customer Payment Lag",
  weatherImpact: "Weather Impact",
};

export const DRIVER_COLORS: Record<DriverKey, string> = {
  materials: "#3b82f6",
  subcontractors: "#a855f7",
  milestoneBilling: "#10b981",
  paymentLag: "#f59e0b",
  weatherImpact: "#64748b",
};

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  base: "Base",
  wet: "Wet Quarter",
  dry: "Dry Quarter",
};

export interface WeatherWeek {
  week: number;
  label: string;
  weekStart: string;
  rainfallMm: number;
  tempMinC: number;
  tempMaxC: number;
  rainDays: number;
  frostDays: number;
  stoppageDays: number;
  delayDays: number;
  source: string;
}

export interface WeatherTransactionMatch {
  date: string;
  city: string;
  opco: string;
  amount: number;
  glAccount: string;
  description: string;
  rainfallMm: number;
  tempMinC: number;
  stoppageReasons: string[];
  insight: string;
}

export interface WeatherCityInsights {
  city: string;
  opco: string;
  lat: number;
  lng: number;
  weekly: WeatherWeek[];
  highlights: string[];
  worstWeek: string | null;
  totalStoppageDays: number;
  transactionMatches: WeatherTransactionMatch[];
}

export interface WeatherInsights {
  fetchedAt: string;
  source: string;
  timezone: string;
  horizonWeeks: number;
  weekStart: string;
  summary: string;
  topHighlights: string[];
  cities: WeatherCityInsights[];
}

export interface WeatherDailyDay {
  date: string;
  city: string;
  rainfallMm: number;
  tempMinC: number;
  tempMaxC: number;
  stoppageReasons: string[];
  isStoppage: boolean;
}

export interface WeatherDailyData {
  weekStart: string;
  horizonWeeks: number;
  days: WeatherDailyDay[];
}
