import { useState } from "react";
import { CFODashboard } from "./pages/CFODashboard";
import { DataUploadPage } from "./pages/DataUploadPage";
import { FieldSchedulePage } from "./pages/FieldSchedulePage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { AppNav } from "./components/layout/AppNav";
import { AgentPanel } from "./agent/AgentPanel";
import { useAppData } from "./hooks/useAppData";
import { useRoleNavigation } from "./hooks/useRoleNavigation";
import type { ScenarioId, TraceSelection } from "./types";

export default function App() {
  const { forecast, traces, wip, covenant, weatherInsights, portfolio, timeseries, weatherDaily, loading, error, refetch } =
    useAppData();
  const { role, setRole } = useRoleNavigation();
  const [scenario, setScenario] = useState<ScenarioId>("base");
  const [traceSelection, setTraceSelection] = useState<TraceSelection | null>(null);

  const dashboardBlocked =
    role !== "data" && role !== "portfolio" && role !== "schedule" && (loading || error);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <AppNav
        role={role}
        scenario={scenario}
        onRoleChange={setRole}
        onScenarioChange={setScenario}
      />

      <AgentPanel
        forecast={forecast}
        wip={wip}
        covenant={covenant}
        weatherInsights={weatherInsights}
        portfolio={portfolio}
        scenario={scenario}
        onSetScenario={setScenario}
      />

      <div className="lg:pl-24">
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-8">
          {role === "portfolio" ? (
            <PortfolioPage />
          ) : role === "data" ? (
            <DataUploadPage onUploadComplete={refetch} />
          ) : dashboardBlocked && loading ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              Loading forecast data…
            </div>
          ) : dashboardBlocked && error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-8 text-center">
              <p className="text-destructive">Failed to load data: {error}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload CSVs via <strong>Data Upload</strong>, or run{" "}
                <code className="font-mono">npm run data:pipeline</code>
              </p>
            </div>
          ) : role === "schedule" ? (
            <FieldSchedulePage
              forecast={forecast}
              weatherInsights={weatherInsights}
              weatherDaily={weatherDaily}
              wip={wip}
              loading={loading}
            />
          ) : role === "cfo" ? (
            <CFODashboard
              forecast={forecast}
              covenant={covenant}
              traces={traces}
              weatherInsights={weatherInsights}
              wip={wip}
              timeseries={timeseries}
              scenario={scenario}
              onScenarioChange={setScenario}
              traceSelection={traceSelection}
              onTraceSelect={setTraceSelection}
              onTraceClose={() => setTraceSelection(null)}
              onForecastRebuilt={refetch}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
