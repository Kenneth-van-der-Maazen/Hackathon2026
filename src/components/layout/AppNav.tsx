import {
  CloudRain,
  Database,
  LayoutDashboard,
  Layers,
  Map,
  Users,
} from "lucide-react";
import type { RoleId, ScenarioId } from "../../types";
import { SCENARIO_LABELS } from "../../types";

interface AppNavProps {
  role: RoleId;
  scenario: ScenarioId;
  onRoleChange: (r: RoleId) => void;
  onScenarioChange: (s: ScenarioId) => void;
}

const navItems: { id: RoleId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "cfo", label: "CFO Forecast", icon: LayoutDashboard },
  { id: "opco", label: "Opco MD", icon: Users },
  { id: "portfolio", label: "Portfolio Map", icon: Map },
  { id: "data", label: "Data Upload", icon: Database },
];

const scenarios: ScenarioId[] = ["base", "wet", "dry"];

export function AppNav({ role, scenario, onRoleChange, onScenarioChange }: AppNavProps) {
  return (
    <>
      {/* Desktop — Kapetein Labs floating capsule */}
      <aside className="fixed bottom-4 left-4 top-4 z-50 hidden w-[72px] flex-col items-center justify-between rounded-[24px] border border-border bg-bg-elevated/90 py-6 shadow-2xl shadow-black/50 backdrop-blur-md lg:flex">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-tertiary text-accent-teal">
          <Layers className="h-5 w-5" aria-hidden />
        </div>

        <nav className="flex flex-col gap-3" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-current={role === id ? "page" : undefined}
              onClick={() => onRoleChange(id)}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300 ${
                role === id
                  ? "bg-accent-teal text-black shadow-lg shadow-accent-teal/25"
                  : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
              }`}
            >
              <Icon size={20} aria-hidden />
            </button>
          ))}
        </nav>

        <div className="flex flex-col items-center gap-2">
          {role === "cfo" && (
            <div className="relative group">
              <button
                type="button"
                title={`Scenario: ${SCENARIO_LABELS[scenario]}`}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-bg-tertiary text-accent-teal transition hover:border-accent-teal/40"
              >
                <CloudRain size={18} aria-hidden />
              </button>
              <div className="pointer-events-none absolute bottom-0 left-14 z-50 w-44 rounded-xl border border-border-strong bg-bg-elevated/95 p-2 opacity-0 shadow-xl backdrop-blur-md transition group-hover:pointer-events-auto group-hover:opacity-100">
                <p className="mb-1.5 px-2 text-[9px] font-bold uppercase tracking-widest text-text-subtle">
                  Scenario
                </p>
                {scenarios.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onScenarioChange(s)}
                    className={`w-full rounded-lg px-2 py-2 text-left text-xs font-medium transition ${
                      scenario === s
                        ? "bg-accent-teal/15 text-accent-teal"
                        : "text-text-muted hover:bg-bg-tertiary hover:text-white"
                    }`}
                  >
                    {SCENARIO_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-bg-tertiary text-[10px] font-bold text-accent-teal"
            title="Altis Groep"
          >
            AG
          </div>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-border bg-bg-elevated/95 px-2 py-2 backdrop-blur-md lg:hidden"
        aria-label="Mobile navigation"
      >
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onRoleChange(id)}
            aria-current={role === id ? "page" : undefined}
            className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-3 text-[10px] font-medium ${
              role === id ? "text-accent-teal" : "text-text-muted"
            }`}
          >
            <Icon size={20} aria-hidden />
            {label.split(" ")[0]}
          </button>
        ))}
      </nav>
    </>
  );
}
