export type ScenarioId = "base" | "wet" | "dry";

export type RoleId = "cfo" | "opco" | "data" | "portfolio";

export interface WeekForecast {
  week: number;
  label: string;
  materials: number;
  subcontractors: number;
  milestoneBilling: number;
  paymentLag: number;
  weatherImpact: number;
  net: number;
}

export interface ForecastData {
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
