import { Building2, CloudRain, Database, LayoutDashboard } from "lucide-react";
import { ScenarioToggle } from "../ScenarioToggle";
import type { RoleId, ScenarioId } from "../../types";

interface SidebarProps {
  role: RoleId;
  scenario: ScenarioId;
  onRoleChange: (r: RoleId) => void;
  onScenarioChange: (s: ScenarioId) => void;
  weatherSource?: string;
}

export function Sidebar({ role, scenario, onRoleChange, onScenarioChange, weatherSource }: SidebarProps) {
  const roles: { id: RoleId; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "cfo", label: "CFO", icon: LayoutDashboard },
    { id: "data", label: "Data Upload", icon: Database },
  ];

  return (
    <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-60">
      <div className="animate-fade-up">
        <div className="mb-1 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-accent-copper" aria-hidden />
          <span className="font-serif text-xl tracking-tight">Altis Groep</span>
        </div>
        <p className="text-xs text-text-muted">Weather-Aware Cash Flow</p>
      </div>

      <nav className="animate-fade-up stagger-1" aria-label="Role navigation">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">View as</p>
        <div className="flex flex-col gap-1">
          {roles.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onRoleChange(id)}
              aria-current={role === id ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-200 ${
                role === id
                  ? "bg-accent-blue text-white shadow-lg shadow-accent-blue/20"
                  : "text-text-muted hover:bg-bg-elevated hover:text-text-primary"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {role === "cfo" && (
        <div className="animate-fade-up stagger-2">
          <ScenarioToggle scenario={scenario} onChange={onScenarioChange} />
        </div>
      )}

      {weatherSource && (
        <div className="animate-fade-up stagger-3 mt-auto rounded-lg border border-border bg-bg-elevated/60 p-3">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <CloudRain className="h-3.5 w-3.5 text-accent-blue" aria-hidden />
            <span>Weather: {weatherSource}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
