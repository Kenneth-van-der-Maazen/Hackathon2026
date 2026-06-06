import { useCallback, useEffect, useState } from "react";
import type { RoleId } from "@/types";

const ROLES: RoleId[] = ["cfo", "schedule", "portfolio", "data"];
export const DEFAULT_ROLE: RoleId = "cfo";

function roleFromHash(): RoleId | null {
  const raw = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return ROLES.includes(raw as RoleId) ? (raw as RoleId) : null;
}

function writeHash(role: RoleId, replace: boolean) {
  const hash = `#/${role}`;
  if (window.location.hash === hash) return;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (replace) {
    window.history.replaceState(null, "", url);
  } else {
    window.history.pushState(null, "", url);
  }
}

export function useRoleNavigation() {
  const [role, setRoleState] = useState<RoleId>(() => roleFromHash() ?? DEFAULT_ROLE);

  useEffect(() => {
    if (!roleFromHash()) {
      writeHash(DEFAULT_ROLE, true);
    }

    function onNavigate() {
      setRoleState(roleFromHash() ?? DEFAULT_ROLE);
    }

    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("popstate", onNavigate);
    return () => {
      window.removeEventListener("hashchange", onNavigate);
      window.removeEventListener("popstate", onNavigate);
    };
  }, []);

  const setRole = useCallback((next: RoleId) => {
    setRoleState(next);
    writeHash(next, false);
  }, []);

  return { role, setRole };
}
