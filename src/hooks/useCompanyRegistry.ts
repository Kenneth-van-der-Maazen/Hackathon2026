import { useCallback, useEffect, useState } from "react";
import type { PortfolioCompany } from "../types/upload";

export interface ParserOption {
  id: string;
  label: string;
  description: string;
  source_systems: string[];
  format_name: string;
  target_store: string;
}

export interface NewCompanyPayload {
  opcoName: string;
  city: string;
  region?: string;
  lat?: number;
  lng?: number;
  sourceSystem: string;
  dataFolder?: string;
  filenamePatterns: string;
  notes?: string;
  parser: string;
  targetStore?: string;
  summary?: string;
}

export function useCompanyRegistry() {
  const [companies, setCompanies] = useState<PortfolioCompany[]>([]);
  const [parsers, setParsers] = useState<ParserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, pRes] = await Promise.all([
        fetch("/api/companies"),
        fetch("/api/companies/parsers"),
      ]);
      if (cRes.ok) {
        const data = await cRes.json();
        setCompanies(data.companies ?? []);
      }
      if (pRes.ok) {
        const data = await pRes.json();
        setParsers(data.parsers ?? []);
      }
    } catch {
      setError("Could not load company registry — is the API running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createCompany(payload: NewCompanyPayload) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? "Failed to save company");
      setCompanies(data.companies ?? []);
      return data.company;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save company";
      setError(msg);
      throw e;
    } finally {
      setSaving(false);
    }
  }

  return { companies, parsers, loading, saving, error, refresh, createCompany };
}
