import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ALTIS_COMPANIES,
  getAnnualRevenue,
  getMonthlyRevenue,
  type SubsidiaryCompany,
} from "../data/altisPortfolio";

const YEARS = ["2023", "2024", "2025"];

const QUALITY_LABELS: Record<SubsidiaryCompany["dataQuality"], string> = {
  complete: "Complete",
  "revenue-only": "Revenue only",
  partial: "Partial",
};

const QUALITY_COLORS: Record<SubsidiaryCompany["dataQuality"], string> = {
  complete: "#34d399",
  "revenue-only": "#fbbf24",
  partial: "#f87171",
};

const TOOLTIP_STYLE = {
  background: "#141414",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  fontSize: 12,
};

function fmtEur(n: number) {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `€${(n / 1_000).toFixed(0)}K`;
  return `€${n}`;
}

export function PortfolioPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const [selected, setSelected] = useState<SubsidiaryCompany | null>(null);
  const [chartYear, setChartYear] = useState("2025");

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [52.2, 5.9],
      zoom: 7,
      zoomControl: false,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution: "© OpenStreetMap contributors © CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }
    ).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    const maxRev = Math.max(
      ...ALTIS_COMPANIES.map((c) => getAnnualRevenue(c, "2025"))
    );

    markersRef.current = ALTIS_COMPANIES.map((company) => {
      const rev = getAnnualRevenue(company, "2025");
      const radius = 14 + (rev / maxRev) * 32;

      const marker = L.circleMarker([company.lat, company.lng], {
        radius,
        fillColor: company.color,
        color: company.color,
        weight: 2,
        opacity: 0.85,
        fillOpacity: 0.25,
      });

      marker.bindTooltip(
        `<div style="background:#141414;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:8px 12px;font-size:12px;color:#fff;min-width:140px">
          <div style="font-weight:600;margin-bottom:4px">${company.name}</div>
          <div style="color:#9ca3af">${fmtEur(rev)} (2025)</div>
        </div>`,
        { className: "leaflet-tooltip-dark", opacity: 1 }
      );

      marker.on("click", () =>
        setSelected((prev) => (prev?.id === company.id ? null : company))
      );
      marker.addTo(map);
      return marker;
    });

    mapInstanceRef.current = map;

    return () => {
      markersRef.current = [];
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  const comparisonData = ALTIS_COMPANIES.map((c) => ({
    name: c.city,
    revenue: Math.round(getAnnualRevenue(c, chartYear) / 1000),
    color: c.color,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Portfolio Revenue Map
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Altis Groep subsidiaries — click a marker or chip to drill down
        </p>
      </div>

      {/* Company chips */}
      <div className="flex flex-wrap gap-2">
        {ALTIS_COMPANIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() =>
              setSelected((prev) => (prev?.id === c.id ? null : c))
            }
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
              selected?.id === c.id
                ? "border-transparent text-black shadow-lg"
                : "border-border text-text-muted hover:border-border-strong hover:text-text-primary"
            }`}
            style={selected?.id === c.id ? { background: c.color } : {}}
          >
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ background: c.color }}
            />
            {c.name}
          </button>
        ))}
      </div>

      {/* Map + panel row */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Map */}
        <div
          className="min-h-[440px] flex-1 overflow-hidden rounded-2xl border border-border"
          style={{ height: 480 }}
        >
          <div ref={mapRef} className="h-full w-full" />
        </div>

        {/* Side panel */}
        <div className="flex w-full flex-col gap-4 lg:w-[360px] lg:flex-shrink-0">
          {selected ? (
            <>
              {/* Company header card */}
              <div className="rounded-2xl border border-border bg-bg-card p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="mt-0.5 h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ background: selected.color }}
                    />
                    <div>
                      <h2 className="font-semibold text-text-primary leading-tight">
                        {selected.name}
                      </h2>
                      <p className="text-xs text-text-muted">{selected.city}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        background: `${QUALITY_COLORS[selected.dataQuality]}20`,
                        color: QUALITY_COLORS[selected.dataQuality],
                      }}
                    >
                      {QUALITY_LABELS[selected.dataQuality]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-text-subtle transition hover:bg-bg-tertiary hover:text-text-primary"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <p className="mb-4 text-xs text-text-subtle">{selected.dataNote}</p>

                {/* Annual KPIs */}
                <div className="grid grid-cols-3 gap-2">
                  {YEARS.map((year) => {
                    const rev = getAnnualRevenue(selected, year);
                    return (
                      <div
                        key={year}
                        className="rounded-xl bg-bg-tertiary p-3"
                      >
                        <p className="text-[10px] uppercase tracking-wider text-text-muted">
                          {year}
                        </p>
                        <p className="mt-1 text-base font-bold text-text-primary">
                          {rev > 0 ? fmtEur(rev) : "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Monthly bar chart */}
              <div className="rounded-2xl border border-border bg-bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-medium text-text-primary">
                    Monthly Revenue
                  </p>
                  <div className="flex gap-1">
                    {YEARS.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setChartYear(y)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                          chartYear === y
                            ? "bg-accent-teal/15 text-accent-teal"
                            : "text-text-muted hover:text-text-primary"
                        }`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    data={getMonthlyRevenue(selected, chartYear)}
                    margin={{ left: -8, right: 4, top: 4 }}
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#9ca3af", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v: number) =>
                        v > 0 ? `€${v}K` : "0"
                      }
                      tick={{ fill: "#9ca3af", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: "#fff" }}
                      formatter={(v: number) => [
                        `€${v.toLocaleString()}K`,
                        "Revenue",
                      ]}
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    />
                    <Bar
                      dataKey="revenueK"
                      fill={selected.color}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            /* Comparison panel */
            <div className="rounded-2xl border border-border bg-bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-medium text-text-primary">
                  Annual Revenue by Subsidiary
                </p>
                <div className="flex gap-1">
                  {YEARS.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setChartYear(y)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                        chartYear === y
                          ? "bg-accent-teal/15 text-accent-teal"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={comparisonData}
                  layout="vertical"
                  margin={{ left: 0, right: 20, top: 4 }}
                >
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) =>
                      v >= 10000 ? `€${(v / 1000).toFixed(0)}M` : `€${v}K`
                    }
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: "#fff" }}
                    formatter={(v: number) => [
                      `€${(v / 1000).toFixed(1)}M`,
                      "Revenue (est.)",
                    ]}
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {comparisonData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-3 text-center text-xs text-text-subtle">
                Click a marker or chip to drill into monthly detail
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
