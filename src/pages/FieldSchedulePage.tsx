import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CloudRain,
  HardHat,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  Sun,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { forecastWeekLabel, forecastWindowLabel } from "@/lib/forecastWindow";
import {
  buildWeekDayForecast,
  dayLabel,
  ruleBasedDailyInsight,
  scheduleWeekDates,
  weekDatesFromStart,
} from "@/lib/weatherDaily";
import {
  MODE_COLORS,
  MODE_LABELS,
  buildDaySchedulePlan,
  buildFallbackSchedulePlan,
  buildSchedulePlan,
  type CrewNotification,
  type SiteWeekPlan,
  type WorkMode,
} from "../lib/workSchedule";
import type {
  ForecastData,
  WeatherDailyData,
  WeatherInsights,
  WipProject,
} from "../types";

type ScheduleViewMode = "week" | "day";

interface Props {
  forecast: ForecastData;
  weatherInsights: WeatherInsights | null;
  weatherDaily: WeatherDailyData | null;
  wip: WipProject[];
  loading: boolean;
}

const MODE_ICON: Record<WorkMode, typeof Sun> = {
  outdoor: Sun,
  indoor: Wrench,
  mixed: CloudRain,
  stand_down: CloudRain,
};

export function FieldSchedulePage({
  forecast,
  weatherInsights,
  weatherDaily,
  wip,
  loading,
}: Props) {
  const meta = forecast.meta;
  const horizonWeeks = meta?.weeks ?? weatherInsights?.horizonWeeks ?? 13;
  const [scheduleView, setScheduleView] = useState<ScheduleViewMode>("week");
  const [selectedWeek, setSelectedWeek] = useState(1);
  const scheduleAnchor = weatherDaily?.weekStart ?? weatherInsights?.weekStart ?? meta?.forecastStart;
  const scheduleHorizonEnd = scheduleAnchor
    ? (() => {
        const d = new Date(`${scheduleAnchor}T12:00:00`);
        d.setDate(d.getDate() + horizonWeeks * 7 - 1);
        return d.toISOString().slice(0, 10);
      })()
    : meta?.forecastEnd;

  const [selectedDate, setSelectedDate] = useState(
    () => scheduleWeekDates(weatherDaily, weatherInsights, 1)[0] ?? "",
  );
  const [aiBriefing, setAiBriefing] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [notifications, setNotifications] = useState<CrewNotification[]>([]);
  const [draftMessage, setDraftMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [waStatus, setWaStatus] = useState<{
    connected: boolean;
    bridgeOnline: boolean;
    pairingCode?: string | null;
    groupJid?: string | null;
    phone?: string | null;
    lastError?: string | null;
  } | null>(null);
  const [waGroups, setWaGroups] = useState<{ id: string; subject: string }[]>([]);
  const [waGroupsLoading, setWaGroupsLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState("");

  const hasWeather = Boolean(weatherInsights?.cities?.length);
  const weekDayDates = useMemo(
    () => scheduleWeekDates(weatherDaily, weatherInsights, selectedWeek),
    [weatherDaily, weatherInsights, selectedWeek],
  );
  const weekDayForecast = useMemo(
    () => buildWeekDayForecast(weatherDaily, scheduleAnchor, selectedWeek),
    [weatherDaily, scheduleAnchor, selectedWeek],
  );

  useEffect(() => {
    const dates = scheduleWeekDates(weatherDaily, weatherInsights, selectedWeek);
    if (dates.length && !dates.includes(selectedDate)) {
      setSelectedDate(dates[0]);
    }
  }, [weatherDaily, weatherInsights, selectedWeek, selectedDate]);

  const plan = useMemo(() => {
    if (scheduleView === "day" && selectedDate && weatherDaily) {
      const dayRows = weatherDaily.days.filter((d) => d.date === selectedDate);
      if (dayRows.length) {
        return buildDaySchedulePlan(dayRows, wip, selectedDate);
      }
    }
    if (hasWeather) {
      return buildSchedulePlan(weatherInsights, wip, selectedWeek);
    }
    return buildFallbackSchedulePlan(wip, selectedWeek, meta);
  }, [scheduleView, selectedDate, weatherDaily, hasWeather, weatherInsights, wip, selectedWeek, meta]);

  const dailyInsight = useMemo(
    () =>
      ruleBasedDailyInsight(
        weekDayForecast,
        `W${selectedWeek}`,
        scheduleView === "day" ? selectedDate : undefined,
      ),
    [weekDayForecast, selectedWeek, scheduleView, selectedDate],
  );

  const horizonRangeLabel =
    scheduleAnchor && scheduleHorizonEnd
      ? `${dayLabel(scheduleAnchor)} – ${dayLabel(scheduleHorizonEnd)}`
      : forecastWindowLabel(meta);

  const selectedWeekRangeLabel = useMemo(() => {
    if (weekDayDates.length >= 2) {
      return `${dayLabel(weekDayDates[0])} – ${dayLabel(weekDayDates[weekDayDates.length - 1])}`;
    }
    if (weekDayDates.length === 1) {
      return dayLabel(weekDayDates[0]);
    }
    return forecastWeekLabel(meta, selectedWeek);
  }, [weekDayDates, meta, selectedWeek]);

  const weekOfLabel = `Week ${selectedWeek} of ${horizonWeeks}`;

  const refreshNotifications = useCallback(async () => {
    try {
      const r = await fetch("/api/schedule/notifications");
      if (r.ok) {
        const data = await r.json();
        setNotifications(data.notifications ?? []);
      }
    } catch {
      /* API offline */
    }
  }, []);

  const refreshWhatsApp = useCallback(async () => {
    try {
      const r = await fetch("/api/schedule/whatsapp/status");
      if (r.ok) {
        const data = await r.json();
        setWaStatus(data);
        if (data.groupJid) {
          setSelectedGroup(data.groupJid);
        }
      }
    } catch {
      setWaStatus({ connected: false, bridgeOnline: false });
    }
  }, []);

  const loadWhatsAppGroups = useCallback(async () => {
    setWaGroupsLoading(true);
    try {
      const r = await fetch("/api/schedule/whatsapp/groups");
      if (r.ok) {
        const data = await r.json();
        setWaGroups(data.groups ?? []);
      }
    } catch {
      setWaGroups([]);
    } finally {
      setWaGroupsLoading(false);
    }
  }, []);

  async function assignWhatsAppGroup(groupJid: string) {
    setSelectedGroup(groupJid);
    try {
      const r = await fetch("/api/schedule/whatsapp/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupJid }),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.detail ?? "Could not assign group");
      }
      await refreshWhatsApp();
    } catch (e) {
      setNotifyError(e instanceof Error ? e.message : "Group assign failed");
    }
  }

  useEffect(() => {
    void refreshNotifications();
    void refreshWhatsApp();
    const t = setInterval(() => void refreshWhatsApp(), 15000);
    return () => clearInterval(t);
  }, [refreshNotifications, refreshWhatsApp]);

  useEffect(() => {
    if (waStatus?.connected) {
      void loadWhatsAppGroups();
    }
  }, [waStatus?.connected, loadWhatsAppGroups]);

  async function generateAiBriefing() {
    if (!plan) return;
    setAiLoading(true);
    setAiBriefing(null);
    try {
      const r = await fetch("/api/schedule/ai-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sites: plan.sites,
          weatherSummary: weatherInsights?.summary ?? plan.summary,
          dailyForecast: weekDayForecast,
          viewMode: scheduleView,
          selectedDate: scheduleView === "day" ? selectedDate : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? "AI briefing failed");
      setAiBriefing(data.briefing);
    } catch {
      setAiBriefing(dailyInsight);
    } finally {
      setAiLoading(false);
    }
  }

  async function sendNotification(message: string, site?: SiteWeekPlan) {
    setSending(true);
    setNotifyError(null);
    try {
      const r = await fetch("/api/schedule/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          city: site?.city ?? "All sites",
          weekLabel: site?.weekLabel ?? `W${selectedWeek}`,
        }),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.detail ?? "Send failed");
      }
      setDraftMessage("");
      await refreshNotifications();
    } catch (e) {
      setNotifyError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  function broadcastStandDowns() {
    const alerts = plan?.sites.filter((s) => s.notifyRecommended) ?? [];
    if (alerts.length === 0) return;
    const text = alerts.map((s) => s.crewMessage).join("\n\n");
    void sendNotification(text);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading forecast & weather…
      </div>
    );
  }

  if (!hasWeather && wip.length === 0 && !loading) {
    return (
      <Card className="ring-1 ring-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5 text-accent-teal" />
            Field Schedule
          </CardTitle>
          <CardDescription>
            Upload opco data first, then run{" "}
            <code className="font-mono text-xs">npm run data:weather</code> for live rain/frost planning.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
              <HardHat className="h-7 w-7 text-accent-teal" />
              Field Schedule
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">
              Weather forecast from Open-Meteo — pick a <strong className="font-medium text-text-primary">week</strong> or{" "}
              <strong className="font-medium text-text-primary">day</strong> to see rain vs dry, generate an AI crew plan,
              and send alerts via WhatsApp.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex rounded-lg border border-border p-0.5 text-xs">
              <button
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5",
                  scheduleView === "week" ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
                onClick={() => setScheduleView("week")}
              >
                Week
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5",
                  scheduleView === "day" ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
                onClick={() => setScheduleView("day")}
              >
                Day
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-card p-1">
              {Array.from({ length: horizonWeeks }, (_, i) => i + 1).map((w) => (
                <Button
                  key={w}
                  type="button"
                  size="sm"
                  variant={selectedWeek === w ? "default" : "ghost"}
                  className="h-7 shrink-0 px-2.5 text-xs"
                  onClick={() => {
                    setSelectedWeek(w);
                    setScheduleView("week");
                  }}
                  title={scheduleAnchor ? weekDatesFromStart(scheduleAnchor, w)[0] : forecastWeekLabel(meta, w)}
                >
                  {scheduleAnchor
                    ? new Date(`${weekDatesFromStart(scheduleAnchor, w)[0]}T12:00:00`).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" },
                      )
                    : `W${w}`}
                </Button>
              ))}
            </div>
            </div>
          </div>
        </div>

        {weekDayDates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {weekDayForecast.map((day) => (
              <button
                key={day.date}
                type="button"
                onClick={() => {
                  setSelectedDate(day.date);
                  setScheduleView("day");
                }}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  scheduleView === "day" && selectedDate === day.date
                    ? "border-accent-teal bg-accent-teal/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-border-strong",
                )}
              >
                <p className="font-medium">{day.weekday}</p>
                <p className="mt-0.5 tabular-nums">
                  {day.rainCities.length === 0 ? (
                    <span className="text-emerald-400">Dry</span>
                  ) : day.dryCities.length === 0 ? (
                    <span className="text-amber-400">Rain</span>
                  ) : (
                    <span className="text-amber-300">Mixed</span>
                  )}
                </p>
              </button>
            ))}
          </div>
        )}

        {!hasWeather && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
            Weather not loaded — showing WIP-based plans. Run{" "}
            <code className="font-mono text-xs">npm run data:weather</code> then refresh for stoppage days
            and rain alerts.
          </div>
        )}

        {/* Forecast + weather status strip */}
        <Card className="ring-1 ring-border/60">
          <CardContent className="flex flex-wrap divide-x divide-border-strong p-0">
            <StatusPill
              label="Weather source"
              value={hasWeather ? weatherInsights!.source : "Not loaded"}
              sub={weatherInsights?.fetchedAt?.slice(0, 10) ?? "run data:weather"}
            />
            <StatusPill
              label="13-week weather horizon"
              value={horizonRangeLabel}
              sub={`${horizonWeeks}-week Open-Meteo forecast`}
            />
            <StatusPill
              label={scheduleView === "day" ? "Selected day" : "Selected week"}
              value={
                scheduleView === "day" && selectedDate
                  ? dayLabel(selectedDate)
                  : selectedWeekRangeLabel
              }
              sub={weekOfLabel}
            />
            <StatusPill
              label={scheduleView === "day" ? "Day plan" : "Outdoor sites"}
              value={
                scheduleView === "day"
                  ? plan?.sites.filter((s) => s.mode === "outdoor").length
                    ? `${plan.sites.filter((s) => s.mode === "outdoor").length} outdoor`
                    : "Indoor"
                  : String(plan?.sites.filter((s) => s.mode === "outdoor").length ?? 0)
              }
              sub={
                scheduleView === "day"
                  ? `${plan?.sites.length ?? 0} sites`
                  : `${plan?.sites.length ?? 0} sites · ${weekOfLabel.toLowerCase()}`
              }
            />
            <StatusPill
              label="Stoppage days"
              value={String(
                hasWeather
                  ? weatherInsights!.cities.reduce(
                      (s, c) => s + (c.weekly.find((w) => w.week === selectedWeek)?.stoppageDays ?? 0),
                      0,
                    )
                  : 0,
              )}
              sub={`${weekOfLabel.toLowerCase()} · all sites`}
              accent={hasWeather ? "amber" : undefined}
            />
          </CardContent>
        </Card>

        {plan && (
          <p className="text-sm text-text-muted">{plan.summary}</p>
        )}

        {weekDayForecast.length > 0 && (
          <Card className="ring-1 ring-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {scheduleView === "day"
                  ? `${dayLabel(selectedDate)} — day forecast`
                  : `${selectedWeekRangeLabel} — day-by-day rain outlook`}
              </CardTitle>
              <CardDescription className="text-xs whitespace-pre-wrap">{dailyInsight}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto pt-0">
              <table className="w-full min-w-[480px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-text-subtle">
                    <th className="pb-2 pr-3 font-medium">Day</th>
                    {weatherInsights?.cities.map((c) => (
                      <th key={c.city} className="pb-2 pr-3 font-medium">
                        {c.city}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekDayForecast.map((row) => (
                    <tr
                      key={row.date}
                      className={cn(
                        "border-b border-border/40",
                        scheduleView === "day" && selectedDate === row.date && "bg-accent-teal/5",
                      )}
                    >
                      <td className="py-2 pr-3 font-medium">{row.label}</td>
                      {weatherInsights?.cities.map((c) => {
                        const cell = row.cities.find((x) => x.city === c.city);
                        const rain = cell?.isStoppage;
                        return (
                          <td key={c.city} className="py-2 pr-3">
                            {rain ? (
                              <span className="text-amber-400">
                                {cell?.rainfallMm ?? 0}mm
                                {cell?.stoppageReasons?.length ? ` · ${cell.stoppageReasons.join("/")}` : ""}
                              </span>
                            ) : (
                              <span className="text-emerald-400">Dry</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* AI briefing */}
        <Card className="ring-1 ring-border/60">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-accent-teal" />
                AI crew briefing
              </CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={aiLoading || !plan}
                onClick={() => void generateAiBriefing()}
              >
                {aiLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Generate for WhatsApp"
                )}
              </Button>
            </div>
            <CardDescription>
              {scheduleView === "day"
                ? "Claude reads today's rain forecast per city and drafts a crew message."
                : "Claude reads this week's day-by-day rain outlook and drafts a group message."}
            </CardDescription>
          </CardHeader>
          {aiBriefing && (
            <CardContent className="pt-0">
              <p className="rounded-lg border border-border bg-bg-tertiary/50 p-4 text-sm leading-relaxed text-text-primary whitespace-pre-wrap">
                {aiBriefing}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                variant="secondary"
                onClick={() => void sendNotification(aiBriefing)}
              >
                <Send className="mr-2 h-4 w-4" />
                Send briefing to crew chat
              </Button>
            </CardContent>
          )}
        </Card>

        {/* Site plans */}
        <div className="grid gap-4 md:grid-cols-2">
          {plan?.sites.map((site) => (
            <SitePlanCard
              key={`${site.city}-${site.week}`}
              site={site}
              onNotify={() => void sendNotification(site.crewMessage, site)}
            />
          ))}
        </div>

        {plan && plan.sites.some((s) => s.notifyRecommended) && (
          <Button type="button" variant="outline" onClick={broadcastStandDowns}>
            <Bell className="mr-2 h-4 w-4" />
            Notify all rain-affected sites (W{selectedWeek})
          </Button>
        )}
      </div>

      {/* Crew chat panel */}
      <aside className="w-full shrink-0 lg:w-[340px]">
        <Card className="sticky top-6 ring-1 ring-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4 text-accent-teal" />
              Crew chat
            </CardTitle>
            <CardDescription>
              {waStatus?.connected
                ? "Live WhatsApp group via Baileys — messages also logged locally."
                : "Start npm run dev:whatsapp and link your phone to send live group messages."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <WhatsAppStatusBar
              status={waStatus}
              groups={waGroups}
              groupsLoading={waGroupsLoading}
              selectedGroup={selectedGroup}
              onSelectGroup={(jid) => void assignWhatsAppGroup(jid)}
              onRefreshGroups={() => void loadWhatsAppGroups()}
            />
            <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-lg border border-border bg-bg-tertiary/30 p-3">
              {notifications.length === 0 ? (
                <p className="text-center text-xs text-text-muted py-8">
                  No messages yet. Send a site alert or AI briefing.
                </p>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-lg border border-border/60 bg-bg-elevated px-3 py-2 text-xs"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-text-subtle">
                      <span className="font-medium text-accent-teal">{n.city}</span>
                      <span>{n.weekLabel}</span>
                    </div>
                    <p className="leading-relaxed text-text-primary">{n.message}</p>
                    <p className="mt-1 text-[10px] text-text-subtle">
                      {n.channel} · {new Date(n.sentAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
            <textarea
              value={draftMessage}
              onChange={(e) => setDraftMessage(e.target.value)}
              placeholder="Custom message to field crews…"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-accent-teal/50"
            />
            {notifyError && (
              <p className="text-xs text-destructive">{notifyError}</p>
            )}
            <Button
              type="button"
              className="w-full"
              disabled={!draftMessage.trim() || sending}
              onClick={() => void sendNotification(draftMessage.trim())}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send to crew chat
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function WhatsAppStatusBar({
  status,
  groups,
  groupsLoading,
  selectedGroup,
  onSelectGroup,
  onRefreshGroups,
}: {
  status: {
    connected: boolean;
    bridgeOnline: boolean;
    pairingCode?: string | null;
    groupJid?: string | null;
    phone?: string | null;
    lastError?: string | null;
  } | null;
  groups: { id: string; subject: string }[];
  groupsLoading: boolean;
  selectedGroup: string;
  onSelectGroup: (jid: string) => void;
  onRefreshGroups: () => void;
}) {
  const connected = status?.connected ?? false;
  const bridgeOnline = status?.bridgeOnline ?? false;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-tertiary/40 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-text-primary">
          {connected ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-text-subtle" />
          )}
          WhatsApp {connected ? "connected" : bridgeOnline ? "pairing…" : "offline"}
        </span>
        {status?.phone && (
          <span className="text-text-subtle">+{status.phone}</span>
        )}
      </div>

      {!bridgeOnline && (
        <p className="text-text-muted">
          Run <code className="font-mono">npm run dev:whatsapp</code> in a terminal.
        </p>
      )}

      {bridgeOnline && !connected && status?.pairingCode && (
        <p className="rounded bg-bg-elevated px-2 py-1.5 font-mono text-sm text-accent-teal">
          Pairing code: {status.pairingCode}
        </p>
      )}

      {status?.lastError && !connected && (
        <p className="text-destructive">{status.lastError}</p>
      )}

      {connected && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
            Crew group
          </label>
          <div className="flex gap-2">
            <select
              value={selectedGroup}
              onChange={(e) => onSelectGroup(e.target.value)}
              disabled={groupsLoading || groups.length === 0}
              className="min-w-0 flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary"
            >
              <option value="">
                {groupsLoading ? "Loading groups…" : "Select a group"}
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.subject}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" variant="outline" onClick={onRefreshGroups}>
              ↻
            </Button>
          </div>
          {!selectedGroup && (
            <p className="text-text-muted">Pick the field crew group — bot sends alerts there.</p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "amber";
}) {
  return (
    <div className="min-w-[140px] flex-1 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          accent === "amber" ? "text-amber-400" : "text-text-primary",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-text-muted capitalize">{sub}</p>}
    </div>
  );
}

function SitePlanCard({
  site,
  onNotify,
}: {
  site: SiteWeekPlan;
  onNotify: () => void;
}) {
  const Icon = MODE_ICON[site.mode];
  const color = MODE_COLORS[site.mode];

  return (
    <Card className="ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{site.city}</CardTitle>
            <CardDescription className="text-xs">{site.opco}</CardDescription>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 border-0 text-[10px] font-semibold uppercase"
            style={{ background: `${color}22`, color }}
          >
            <Icon className="mr-1 h-3 w-3" />
            {MODE_LABELS[site.mode]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-3 text-xs text-text-muted">
          <span>{site.weekLabel} · {site.weekStart}</span>
          <span>{site.rainfallMm}mm rain</span>
          <span>{site.stoppageDays} stoppage days</span>
          <span>{site.tempRange}</span>
        </div>

        {site.outdoorTasks.length > 0 && (
          <TaskList title="Outdoor" tasks={site.outdoorTasks} color="#34d399" />
        )}
        {site.indoorTasks.length > 0 && (
          <TaskList title="Indoor / alternate" tasks={site.indoorTasks} color="#60a5fa" />
        )}

        <p className="rounded-lg bg-bg-tertiary/50 p-3 text-xs leading-relaxed text-text-muted">
          {site.crewMessage}
        </p>

        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onNotify}>
          <Send className="mr-2 h-3.5 w-3.5" />
          Send {site.city} alert
        </Button>
      </CardContent>
    </Card>
  );
}

function TaskList({
  title,
  tasks,
  color,
}: {
  title: string;
  tasks: { id: string; label: string }[];
  color: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
        {title}
      </p>
      <ul className="space-y-1 text-xs text-text-primary">
        {tasks.map((t) => (
          <li key={t.id} className="flex gap-2">
            <span className="text-text-subtle">·</span>
            {t.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
