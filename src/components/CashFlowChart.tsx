import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { forecastWindowLabel, weekRangeLabel } from "@/lib/forecastWindow";
import { formatEuro } from "@/lib/format";
import type { DriverKey, ForecastMeta, ScenarioId, TraceSelection, WeekForecast } from "../types";
import { DRIVER_COLORS, DRIVER_LABELS } from "../types";

interface Props {
  weeks: WeekForecast[];
  scenario: ScenarioId;
  forecastMeta?: ForecastMeta;
  onBarClick: (selection: TraceSelection) => void;
}

const DRIVERS: DriverKey[] = [
  "materials",
  "subcontractors",
  "milestoneBilling",
  "paymentLag",
  "weatherImpact",
];

function DriverTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: WeekForecast & { netK?: number } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const weekRange = row?.weekStart ? weekRangeLabel(row.weekStart, row.weekEnd) : label;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-foreground">
        {row?.label ?? label}
        {weekRange ? ` · ${weekRange}` : ""}
      </p>
      <div className="mt-2 space-y-1 font-mono text-muted-foreground">
        {payload.map((entry) => (
          <div key={String(entry.name)} className="flex justify-between gap-4">
            <span>{entry.name}</span>
            <span>{formatEuro((entry.value ?? 0) * 1000)}</span>
          </div>
        ))}
        {row?.netK !== undefined ? (
          <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium text-foreground">
            <span>Net cash</span>
            <span>{formatEuro(row.netK * 1000)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CashFlowChart({ weeks, scenario, forecastMeta, onBarClick }: Props) {
  const chartData = weeks.map((w) => ({
    ...w,
    axisLabel: w.chartLabel ?? w.label,
    materialsK: w.materials / 1000,
    subcontractorsK: w.subcontractors / 1000,
    milestoneBillingK: w.milestoneBilling / 1000,
    paymentLagK: w.paymentLag / 1000,
    weatherImpactK: w.weatherImpact / 1000,
    netK: w.net / 1000,
  }));

  function handleClick(data: Record<string, unknown> | undefined, driver: DriverKey) {
    if (!data || typeof data.week !== "number") return;
    onBarClick({ week: data.week as number, driver, scenario });
  }

  const windowLabel = forecastWindowLabel(forecastMeta);

  return (
    <Card className="ring-1 ring-border/60">
      <CardHeader>
        <CardTitle className="text-base">5-driver cash model</CardTitle>
        <CardDescription>
          {windowLabel} · click any segment to open trace panel
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 16, left: 4, bottom: 0 }}
            stackOffset="sign"
          >
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} strokeDasharray="4 4" />
            <XAxis
              dataKey="axisLabel"
              tickLine={false}
              axisLine={false}
              stroke="#6b7280"
              tick={{ fontSize: 10 }}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={52}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              stroke="#6b7280"
              tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
              tickFormatter={(v) => `€${v}K`}
            />
            <Tooltip content={<DriverTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12, color: "#9ca3af" }} />
            {DRIVERS.map((driver) => (
              <Bar
                key={driver}
                dataKey={`${driver}K`}
                name={DRIVER_LABELS[driver]}
                stackId="drivers"
                fill={DRIVER_COLORS[driver]}
                radius={[2, 2, 0, 0]}
                cursor="pointer"
                onClick={(data) => handleClick(data as unknown as Record<string, unknown>, driver)}
              />
            ))}
            <Line
              type="monotone"
              dataKey="netK"
              name="Net Cash"
              stroke="#ffffff"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#fff" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
