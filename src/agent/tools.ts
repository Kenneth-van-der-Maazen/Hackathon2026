import type Anthropic from "@anthropic-ai/sdk";
import {
  ALTIS_COMPANIES,
  getAnnualRevenue,
} from "../data/altisPortfolio";
import { SCENARIO_LABELS } from "../types";
import type {
  CovenantSummary,
  ForecastData,
  ScenarioId,
  WeatherInsights,
  WipProject,
} from "../types";

export interface ToolContext {
  forecast: ForecastData;
  wip: WipProject[];
  covenant: CovenantSummary;
  weatherInsights: WeatherInsights | null;
  scenario: ScenarioId;
  onSetScenario: (s: ScenarioId) => void;
}

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_portfolio_summary",
    description:
      "Get the revenue summary for all Altis Groep subsidiaries by year, including data quality status.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_forecast_data",
    description:
      "Retrieve weekly cash flow forecast data (net, materials, subcontractors, milestone billing, payment lag, weather impact) for a given scenario.",
    input_schema: {
      type: "object",
      properties: {
        scenario: {
          type: "string",
          enum: ["base", "wet", "dry"],
          description:
            "The forecast scenario to retrieve. Omit to use the currently active scenario.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_wip_projects",
    description:
      "Get the work-in-progress project list with status, completion %, weather risk flags, and recommended actions.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["all", "at_risk", "delayed", "weather_risk"],
          description: "Filter projects. Default: all.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_weather_insights",
    description:
      "Get weather forecast data and projected impact on roofing operations and cash flow across all operating cities.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_covenant_status",
    description:
      "Get the current bank covenant status: interest coverage ratio, headroom by scenario, and breach risk assessment.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_scenario",
    description: "Switch the active forecast scenario on the CFO dashboard.",
    input_schema: {
      type: "object",
      properties: {
        scenario: {
          type: "string",
          enum: ["base", "wet", "dry"],
          description: "The scenario to activate.",
        },
      },
      required: ["scenario"],
    },
  },
];

export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): string {
  switch (name) {
    case "get_portfolio_summary": {
      const summary = ALTIS_COMPANIES.map((c) => ({
        id: c.id,
        name: c.name,
        city: c.city,
        dataQuality: c.dataQuality,
        dataNote: c.dataNote,
        annualRevenue: {
          "2023": getAnnualRevenue(c, "2023"),
          "2024": getAnnualRevenue(c, "2024"),
          "2025": getAnnualRevenue(c, "2025"),
        },
      }));
      return JSON.stringify(summary, null, 2);
    }

    case "get_forecast_data": {
      const scenario = (input.scenario as ScenarioId | undefined) ?? ctx.scenario;
      const weeks = ctx.forecast[scenario] ?? [];
      return JSON.stringify(
        {
          scenario,
          scenarioLabel: SCENARIO_LABELS[scenario],
          activeScenario: ctx.scenario,
          totalNetCash: weeks.reduce((s, w) => s + w.net, 0),
          weeks: weeks.map((w) => ({
            week: w.week,
            label: w.label,
            net: w.net,
            materials: w.materials,
            subcontractors: w.subcontractors,
            milestoneBilling: w.milestoneBilling,
            paymentLag: w.paymentLag,
            weatherImpact: w.weatherImpact,
          })),
        },
        null,
        2
      );
    }

    case "get_wip_projects": {
      const filter = (input.filter as string | undefined) ?? "all";
      let projects = ctx.wip;
      if (filter === "at_risk") projects = projects.filter((p) => p.status === "At Risk");
      else if (filter === "delayed") projects = projects.filter((p) => p.status === "Delayed");
      else if (filter === "weather_risk") projects = projects.filter((p) => p.weatherRisk);
      return JSON.stringify(projects, null, 2);
    }

    case "get_weather_insights": {
      if (!ctx.weatherInsights)
        return JSON.stringify({ available: false, message: "Weather data not yet loaded." });
      const { summary, topHighlights, cities } = ctx.weatherInsights;
      return JSON.stringify(
        {
          summary,
          topHighlights,
          cities: cities.map((city) => ({
            city: city.city,
            opco: city.opco,
            totalStoppageDays: city.totalStoppageDays,
            worstWeek: city.worstWeek,
            highlights: city.highlights,
          })),
        },
        null,
        2
      );
    }

    case "get_covenant_status": {
      const c = ctx.covenant;
      return JSON.stringify(
        {
          interestCoverageRatio: c.interestCoverageRatio,
          interestCoverageMinimum: c.interestCoverageMinimum,
          coverageOk: c.interestCoverageRatio >= c.interestCoverageMinimum,
          headroomThresholdEur: c.headroomThresholdEur,
          headroomByScenario: Object.entries(c.headroomByScenario).map(
            ([s, headroom]) => ({
              scenario: SCENARIO_LABELS[s as ScenarioId],
              headroomEur: headroom,
              breach: headroom < c.headroomThresholdEur,
            })
          ),
          wetQuarterEarlyWeeksWorse: c.wetQuarterEarlyWeeksWorse,
        },
        null,
        2
      );
    }

    case "set_scenario": {
      const scenario = input.scenario as ScenarioId;
      ctx.onSetScenario(scenario);
      return JSON.stringify({
        success: true,
        scenario,
        message: `Dashboard scenario switched to "${SCENARIO_LABELS[scenario]}"`,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
