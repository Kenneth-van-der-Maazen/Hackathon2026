import { useEffect, useMemo, useState } from "react";
import { ChevronRight, CloudRain, MoreHorizontal, SlidersHorizontal, Sparkles, Wallet } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CashFlowChart } from "@/components/CashFlowChart";
import { CovenantBanner } from "@/components/CovenantBanner";
import { TracePanel } from "@/components/TracePanel";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { formatEuro } from "@/lib/format";
import { aggregateForecastWeeks, listOpcos, resolveTraceOpco, shortOpcoLabel } from "@/lib/opcoFilter";
import { enrichWeeksWithDates, forecastWindowLabel, weekRangeLabel } from "@/lib/forecastWindow";
import { monthBuckets } from "@/lib/unifiedRange";
import { activeScenarioMeta, needsOpcoScenarioFetch } from "@/lib/scenarioForecast";
import { ActualsRangeBanner, ForecastRangePicker } from "@/components/ForecastRangePicker";
import { SCENARIO_LABELS } from "@/types";
import type {
  CovenantSummary,
  DashboardViewMode,
  DriverKey,
  ForecastData,
  ForecastMeta,
  ScenarioId,
  TraceRecord,
  TraceSelection,
  UnifiedRangeSummary,
  UnifiedTimeseries,
  WeatherInsights,
  WipProject,
  WeekForecast,
} from "@/types";

interface Dashboard6Props {
  forecast: ForecastData;
  covenant: CovenantSummary;
  traces: TraceRecord[];
  weatherInsights: WeatherInsights | null;
  wip: WipProject[];
  timeseries: UnifiedTimeseries | null;
  scenario: ScenarioId;
  onScenarioChange: (s: ScenarioId) => void;
  traceSelection: TraceSelection | null;
  onTraceSelect: (s: TraceSelection) => void;
  onTraceClose: () => void;
  onForecastRebuilt?: () => Promise<void>;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function computeNet(weeks: { net: number }[]) {
  return weeks.reduce((s, w) => s + w.net, 0);
}

function pctDelta(current: number, prior: number) {
  if (!prior) return 0;
  return ((current - prior) / Math.abs(prior)) * 100;
}

const netChartConfig = {
  net: { label: "Net cash", color: "var(--chart-1)" },
} satisfies ChartConfig;

const ordersChartConfig = {
  net: { label: "Net", color: "var(--chart-1)" },
} satisfies ChartConfig;

const actualsChartConfig = {
  billing: { label: "Billing", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function Dashboard6({
  forecast,
  covenant,
  traces,
  weatherInsights,
  wip,
  timeseries,
  scenario,
  onScenarioChange,
  traceSelection,
  onTraceSelect,
  onTraceClose,
  onForecastRebuilt,
}: Dashboard6Props) {
  const [viewMode, setViewMode] = useState<DashboardViewMode>("forecast");
  const [actuals, setActuals] = useState<UnifiedRangeSummary | null>(null);
  const [selectedOpco, setSelectedOpco] = useState("all");
  const [opcoScenarioView, setOpcoScenarioView] = useState<{
    meta: ForecastMeta;
    weeks: WeekForecast[];
    traces: TraceRecord[];
  } | null>(null);
  const [opcoScenarioLoading, setOpcoScenarioLoading] = useState(false);

  const opcos = useMemo(() => listOpcos(timeseries, wip), [timeseries, wip]);

  const activeMeta = useMemo(
    () => activeScenarioMeta(forecast, scenario, selectedOpco, opcoScenarioView?.meta),
    [forecast, scenario, selectedOpco, opcoScenarioView],
  );

  useEffect(() => {
    if (!needsOpcoScenarioFetch(scenario, selectedOpco)) {
      setOpcoScenarioView(null);
      return;
    }
    let cancelled = false;
    setOpcoScenarioLoading(true);
    void fetch(
      `/api/forecast/scenario-window?scenario=${scenario}&opco=${encodeURIComponent(selectedOpco)}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Scenario window failed"))))
      .then((data) => {
        if (!cancelled) {
          setOpcoScenarioView({
            meta: data.meta,
            weeks: data.weeks ?? [],
            traces: data.traces ?? [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) setOpcoScenarioView(null);
      })
      .finally(() => {
        if (!cancelled) setOpcoScenarioLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scenario, selectedOpco]);

  const filteredTraces = useMemo(() => {
    const pool = opcoScenarioView?.traces?.length
      ? opcoScenarioView.traces
      : traces.filter((t) => t.scenario === scenario);
    if (selectedOpco === "all") return pool;
    return pool.filter((t) => resolveTraceOpco(t, wip) === selectedOpco);
  }, [traces, scenario, selectedOpco, wip, opcoScenarioView]);

  const weeks = useMemo(() => {
    let raw: WeekForecast[];
    if (opcoScenarioView?.weeks?.length) {
      raw = opcoScenarioView.weeks;
    } else if (selectedOpco === "all") {
      raw = forecast[scenario] ?? [];
    } else {
      raw = aggregateForecastWeeks(forecast.base ?? [], traces, scenario, selectedOpco, wip);
    }
    return enrichWeeksWithDates(raw, activeMeta);
  }, [forecast, scenario, traces, selectedOpco, wip, opcoScenarioView, activeMeta]);
  const baseWeeks = forecast.base ?? [];
  const netTotal = computeNet(weeks);
  const baseNet = computeNet(baseWeeks);
  const netDelta = pctDelta(netTotal, baseNet);
  const headroom = covenant.headroomByScenario[scenario] ?? covenant.headroomThresholdEur;
  const headroomBase = covenant.headroomByScenario.base ?? covenant.headroomThresholdEur;
  const headroomDelta = pctDelta(headroom, headroomBase);
  const atRisk = wip.filter(
    (p) =>
      (selectedOpco === "all" || p.opco === selectedOpco) &&
      (p.status === "At Risk" || p.status === "Delayed"),
  );
  const atRiskDelta = atRisk.length > 0 ? 12.5 : -4.2;

  const chartRows = weeks.map((w) => ({
    label: w.chartLabel ?? w.label,
    weekLabel: w.label,
    net: w.net / 1000,
  }));
  const actualsChartRows = actuals ? monthBuckets(actuals).map((m) => ({
    label: m.label,
    billing: m.billing / 1000,
  })) : [];
  const showingActuals = viewMode === "actuals" && actuals;
  const peakWeek = weeks.reduce((best, w) => (w.net > best.net ? w : best), weeks[0]);

  const driverTotals = {
    materials: Math.abs(weeks.reduce((s, w) => s + w.materials, 0)),
    subcontractors: Math.abs(weeks.reduce((s, w) => s + w.subcontractors, 0)),
    billing: weeks.reduce((s, w) => s + w.milestoneBilling, 0),
    lag: Math.abs(weeks.reduce((s, w) => s + w.paymentLag, 0)),
    weather: Math.abs(weeks.reduce((s, w) => s + w.weatherImpact, 0)),
  };
  const driverSum =
    driverTotals.materials +
    driverTotals.subcontractors +
    driverTotals.billing +
    driverTotals.lag +
    driverTotals.weather;

  const selectedWeek = traceSelection ? weeks.find((w) => w.week === traceSelection.week) : null;
  const weekAmount =
    selectedWeek && traceSelection ? selectedWeek[traceSelection.driver as DriverKey] : 0;

  const covenantWarning =
    scenario === "wet" && headroom / covenant.headroomThresholdEur < 0.2
      ? "Covenant headroom tight under wet scenario"
      : null;

  const gaugePct = Math.min(100, Math.max(0, (headroom / covenant.headroomThresholdEur) * 100));
  const gaugeTicks = 36;
  const activeTicks = Math.round((gaugePct / 100) * gaugeTicks);

  return (
    <div className="space-y-6">
      <CovenantBanner scenario={scenario} covenant={covenant} />

      {scenario !== "base" && activeMeta?.selectionReason && !showingActuals ? (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm">
          <p className="font-medium text-sky-100">
            {SCENARIO_LABELS[scenario]} · {forecastWindowLabel(activeMeta)}
          </p>
          <p className="mt-1 text-muted-foreground">{activeMeta.selectionReason}</p>
          {opcoScenarioLoading ? (
            <p className="mt-1 text-xs text-muted-foreground">Recalculating for {shortOpcoLabel(selectedOpco)}…</p>
          ) : null}
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{greeting()}</h1>
          <p className="text-sm text-muted-foreground">Altis Groep · 13-week cash flow forecast</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedOpco} onValueChange={setSelectedOpco}>
            <SelectTrigger className="h-9 w-[150px] rounded-full bg-card">
              <SelectValue placeholder="All opcos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All opcos</SelectItem>
              {opcos.map((opco) => (
                <SelectItem key={opco} value={opco}>
                  {shortOpcoLabel(opco)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={scenario}
            onValueChange={(v) => onScenarioChange(v as ScenarioId)}
            disabled={Boolean(showingActuals)}
          >
            <SelectTrigger className="h-9 w-[140px] rounded-full bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SCENARIO_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ForecastRangePicker
            meta={activeMeta}
            timeseries={timeseries}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onActualsChange={setActuals}
            onForecastRebuilt={onForecastRebuilt}
            selectedOpco={selectedOpco}
          />
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            title={`Opco: ${shortOpcoLabel(selectedOpco)} · Scenario: ${SCENARIO_LABELS[scenario]}`}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" className="rounded-full">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      {actuals ? (
        <ActualsRangeBanner
          summary={actuals}
          opcoLabel={selectedOpco !== "all" ? shortOpcoLabel(selectedOpco) : undefined}
          onClear={() => {
            setActuals(null);
            setViewMode("forecast");
          }}
        />
      ) : null}

      {selectedOpco !== "all" && !showingActuals ? (
        <div className="rounded-xl border border-border bg-card/40 px-4 py-2 text-xs text-muted-foreground">
          Showing 13-week forecast for <strong className="text-foreground">{shortOpcoLabel(selectedOpco)}</strong>{" "}
          — traced from unified database rows for this opco.
        </div>
      ) : null}

      {/* KPI strip */}
      <Card className="py-0 ring-1 ring-border/60">
        <CardContent className="flex flex-wrap divide-x divide-border-strong p-0">
          {showingActuals ? (
            <>
              <KpiCell label="Period billing" value={formatEuro(actuals.billing)} suffix="" />
              <KpiCell label="Period net cash" value={formatEuro(actuals.net)} suffix="" />
              <KpiCell label="Rows in period" value={actuals.rowCount.toLocaleString()} suffix="" />
            </>
          ) : (
            <>
              <KpiCell label="13-week net cash" value={formatEuro(netTotal)} delta={netDelta} />
              <KpiCell label="Covenant headroom" value={formatEuro(headroom)} delta={headroomDelta} />
              <KpiCell label="Projects at risk" value={String(atRisk.length)} delta={atRiskDelta} suffix="" />
            </>
          )}
        </CardContent>
      </Card>

      {/* Main row: MOR chart + sidebar widgets */}
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card className="ring-1 ring-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <CardTitle className="text-3xl font-semibold tabular-nums">
                  {showingActuals ? formatEuro(actuals.billing) : formatEuro(netTotal)}
                </CardTitle>
              <CardDescription>
                {showingActuals
                  ? `Billing from unified database · ${actuals.start} → ${actuals.end}`
                  : `Net cash — ${SCENARIO_LABELS[scenario]}${
                      activeMeta?.forecastStart
                        ? ` · ${forecastWindowLabel(activeMeta)}`
                        : ""
                    }`}
              </CardDescription>
              </div>
              {!showingActuals ? (
                <Delta value={netDelta} variant="badge">
                  <DeltaIcon />
                  <DeltaValue suffix="% over base" />
                </Delta>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {showingActuals ? (
              <ChartContainer config={actualsChartConfig} className="aspect-[2.4/1] w-full">
                <BarChart data={actualsChartRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="billing" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <ChartContainer config={netChartConfig} className="aspect-[2.4/1] w-full">
                <AreaChart data={chartRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="net"
                    stroke="var(--color-chart-1)"
                    fill="var(--color-chart-1)"
                    fillOpacity={0.08}
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {/* Covenant gauge */}
          <Card className="ring-1 ring-border/60">
            <CardContent className="flex flex-col items-center pt-6">
              <div className="relative h-[130px] w-full max-w-[220px]">
                <svg viewBox="0 0 200 110" className="h-full w-full" aria-hidden>
                  {Array.from({ length: gaugeTicks }).map((_, i) => {
                    const angle = Math.PI + (i / (gaugeTicks - 1)) * Math.PI;
                    const x1 = 100 + 72 * Math.cos(angle);
                    const y1 = 100 + 72 * Math.sin(angle);
                    const x2 = 100 + 88 * Math.cos(angle);
                    const y2 = 100 + 88 * Math.sin(angle);
                    return (
                      <line
                        key={i}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={i < activeTicks ? "var(--color-chart-1)" : "rgba(255,255,255,0.12)"}
                        strokeWidth={3}
                        strokeLinecap="round"
                      />
                    );
                  })}
                </svg>
                <div className="absolute inset-x-0 bottom-0 text-center">
                  <Wallet className="mx-auto mb-1 size-5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Covenant headroom</p>
                  <p className="text-xl font-semibold tabular-nums">{formatEuro(headroom)}</p>
                </div>
              </div>
              <Button variant="outline" className="mt-4 w-full rounded-xl">
                View detail →
              </Button>
            </CardContent>
          </Card>

          {/* Weather / stoppage bars */}
          <Card className="ring-1 ring-border/60">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardDescription>Weather stoppage days</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">
                    {weatherInsights?.cities.reduce((s, c) => s + c.totalStoppageDays, 0) ?? 0}
                  </CardTitle>
                </div>
                <Badge variant="secondary">{weatherInsights?.cities.length ?? 0} opcos</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex h-14 items-end gap-1">
                {(weatherInsights?.cities ?? []).map((c) => {
                  const max = Math.max(...(weatherInsights?.cities.map((x) => x.totalStoppageDays) ?? [1]));
                  return (
                    <div
                      key={c.city}
                      className="flex-1 rounded-sm bg-foreground/90"
                      style={{ height: `${Math.max(12, (c.totalStoppageDays / max) * 100)}%` }}
                      title={`${c.city}: ${c.totalStoppageDays}d`}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                {(weatherInsights?.cities ?? []).map((c) => (
                  <span key={c.city}>{c.city.slice(0, 3)}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Insight + budget row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="ring-1 ring-border/60">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4" />
                Weather insight
              </CardTitle>
              <Button variant="outline" size="sm" className="h-8 rounded-full">
                Ask AI
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-lg leading-relaxed">
              {weatherInsights?.topHighlights[0] ??
                `${SCENARIO_LABELS[scenario]} scenario shifts milestone billing when rain delays site work.`}
            </p>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/60">
          <CardHeader>
            <CardDescription>Driver mix (13 weeks)</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{formatEuro(driverSum)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              {[
                { k: driverTotals.materials, c: "bg-blue-500" },
                { k: driverTotals.subcontractors, c: "bg-violet-500" },
                { k: driverTotals.billing, c: "bg-emerald-500" },
                { k: driverTotals.lag, c: "bg-amber-500" },
                { k: driverTotals.weather, c: "bg-slate-500" },
              ].map((seg, i) => (
                <div
                  key={i}
                  className={seg.c}
                  style={{ width: `${driverSum ? (seg.k / driverSum) * 100 : 0}%` }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Materials</span>
              <span>Subs</span>
              <span>Billing</span>
              <span>Lag</span>
              <span>Weather</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weekly orders-style bar chart */}
      <Card className="ring-1 ring-border/60">
        <CardHeader>
          <div className="flex items-end justify-between gap-3">
            <div>
              <CardTitle>{weeks.length} weeks in forecast</CardTitle>
              <CardDescription>Weekly net cash movement</CardDescription>
            </div>
            <Delta value={netDelta} variant="badge">
              <DeltaIcon />
              <DeltaValue suffix="% vs base" />
            </Delta>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={ordersChartConfig} className="aspect-[3/1] w-full">
            <BarChart data={chartRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="4 4" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="net"
                radius={[4, 4, 0, 0]}
                fill="var(--color-chart-2)"
                activeBar={{ fill: "var(--color-chart-1)" }}
              />
            </BarChart>
          </ChartContainer>
          {peakWeek && (
            <p className="mt-2 text-xs text-muted-foreground">
              Peak {peakWeek.label}
              {peakWeek.weekStart ? ` (${weekRangeLabel(peakWeek.weekStart, peakWeek.weekEnd)})` : ""}:{" "}
              {formatEuro(peakWeek.net)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Driver chart + needs attention */}
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <CashFlowChart
          weeks={weeks}
          scenario={scenario}
          forecastMeta={activeMeta}
          onBarClick={onTraceSelect}
        />
        <Card className="ring-1 ring-border/60">
          <CardHeader>
            <CardTitle className="text-base">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-0 pb-4">
            {covenantWarning && <AttentionRow label={covenantWarning} />}
            {atRisk.slice(0, 4).map((p) => (
              <AttentionRow key={p.projectId} label={`${p.project} — ${p.status}`} />
            ))}
            {weatherInsights && atRisk.some((p) => p.weatherRisk) && (
              <AttentionRow label="Weather-delayed milestones" count={atRisk.filter((p) => p.weatherRisk).length} />
            )}
            {!covenantWarning && !atRisk.length && (
              <AttentionRow label="Portfolio on track — no critical items" />
            )}
          </CardContent>
        </Card>
      </div>

      <TracePanel
        selection={traceSelection}
        traces={filteredTraces}
        weekAmount={weekAmount}
        onClose={onTraceClose}
      />
    </div>
  );
}

function KpiCell({
  label,
  value,
  delta,
  suffix = "% vs base",
}: {
  label: string;
  value: string;
  delta?: number;
  suffix?: string;
}) {
  return (
    <div className="min-w-[160px] flex-1 px-6 py-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {suffix && delta !== undefined ? (
        <Delta value={delta} className="mt-1">
          <DeltaIcon />
          <DeltaValue suffix={` ${suffix}`} />
        </Delta>
      ) : null}
    </div>
  );
}

function AttentionRow({ label, count }: { label: string; count?: number }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left text-sm transition last:border-b-0 hover:bg-muted/50"
    >
      <CloudRain className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {count !== undefined && (
        <Badge variant="secondary" className="tabular-nums">
          {count}
        </Badge>
      )}
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}
