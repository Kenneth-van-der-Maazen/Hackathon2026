import { useCallback, useRef, useState } from "react";
import {
  Brain,
  Building2,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { DiscoveryProposal, DiscoveryResult, UploadAnalysis } from "../types/upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { STORE_LABELS } from "../types/upload";

type WizardStep = "intro" | "file" | "analyzing" | "proposal" | "done";

const REASON_LABELS: Record<string, string> = {
  unknown_file: "This file doesn't match any portfolio company yet.",
  format_mismatch: "The format looks different from what we expect for this company.",
  unsupported_format: "We couldn't parse this with existing trained profiles.",
};

export function OpcoDiscoveryWizard({
  mode,
  uploadId,
  filename,
  discoveryReason,
  aiAvailable,
  onCancel,
  onSaved,
  onContinueIngest,
}: {
  mode: "manual" | "from_upload";
  uploadId?: string;
  filename?: string;
  discoveryReason?: string;
  aiAvailable: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onContinueIngest?: (analysis: UploadAnalysis) => void;
}) {
  const [step, setStep] = useState<WizardStep>(mode === "from_upload" ? "intro" : "intro");
  const [answers, setAnswers] = useState({ opcoName: "", city: "", sourceSystem: "", notes: "" });
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [proposal, setProposal] = useState<DiscoveryProposal | null>(null);
  const [createPayload, setCreatePayload] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const runDiscover = useCallback(
    async (file?: File, extraAnswers?: typeof answers) => {
      setStep("analyzing");
      setError(null);
      const form = new FormData();
      form.append("answers", JSON.stringify(extraAnswers ?? answers));
      if (uploadId && mode === "from_upload") {
        form.append("upload_id", uploadId);
      } else if (file) {
        form.append("file", file);
      } else {
        setError("Drop a sample file to continue");
        setStep("file");
        return;
      }

      try {
        const r = await fetch("/api/companies/discover", { method: "POST", body: form });
        const data = (await r.json()) as DiscoveryResult & { detail?: string };
        if (!r.ok) throw new Error(data.detail ?? "Discovery failed");

        setDiscovery(data);
        if (data.status === "questions" && data.questions?.length) {
          setStep("intro");
          return;
        }
        if (data.proposal) {
          setProposal(data.proposal);
          setCreatePayload(data.createPayload ?? null);
          setAnswers((a) => ({
            ...a,
            opcoName: data.proposal!.opcoName || a.opcoName,
            city: data.proposal!.city || a.city,
            sourceSystem: data.proposal!.sourceSystem || a.sourceSystem,
          }));
          setStep("proposal");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Discovery failed");
        setStep(mode === "from_upload" ? "intro" : "file");
      }
    },
    [answers, mode, uploadId],
  );

  async function handleSave(continueMerge: boolean) {
    if (!createPayload) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/companies/discover/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          createPayload,
          uploadId: continueMerge ? uploadId : undefined,
          continueMerge,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? "Save failed");
      setStep("done");
      onSaved();
      if (continueMerge && data.analysis && onContinueIngest) {
        onContinueIngest(data.analysis as UploadAnalysis);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/5 ring-1 ring-primary/20">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              {mode === "from_upload" ? "New format detected" : "Create new operating company"}
            </CardTitle>
            <CardDescription className="mt-1">
              {mode === "from_upload" && discoveryReason
                ? REASON_LABELS[discoveryReason] ?? discoveryReason
                : "AI learns from a sample export and saves a profile for future uploads."}
              {filename && (
                <span className="mt-1 block font-mono text-xs text-muted-foreground">{filename}</span>
              )}
            </CardDescription>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {!aiAvailable && (
          <p className="text-xs text-amber-400">
            Anthropic AI offline — discovery uses heuristics; review carefully before saving.
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {step === "intro" && (
          <>
            {discovery?.questions && discovery.questions.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-sm text-amber-200">
                {discovery.questions.map((q) => (
                  <p key={q}>• {q}</p>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="City / location"
                value={answers.city}
                onChange={(v) => setAnswers((a) => ({ ...a, city: v }))}
                placeholder="Utrecht"
              />
              <Field
                label="Operating company name"
                value={answers.opcoName}
                onChange={(v) => setAnswers((a) => ({ ...a, opcoName: v }))}
                placeholder="Portfolio Company Utrecht"
              />
              <Field
                label="Accounting system (if known)"
                value={answers.sourceSystem}
                onChange={(v) => setAnswers((a) => ({ ...a, sourceSystem: v }))}
                placeholder="Exact, Yuki, Gilde…"
                className="sm:col-span-2"
              />
            </div>
          </>
        )}

        {step === "file" && (
          <div
            role="button"
            tabIndex={0}
            className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/40 bg-background/40 px-4 py-8"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void runDiscover(f);
              }}
            />
            <Upload className="h-8 w-8 text-primary" />
            <p className="mt-2 text-sm font-medium">Drop sample export for this opco</p>
            <p className="text-xs text-muted-foreground">Excel or CSV — AI reads structure once</p>
          </div>
        )}

        {step === "analyzing" && (
          <div className="flex flex-col items-center py-8 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="mt-3 text-sm font-medium">AI analyzing file structure…</p>
            <p className="text-xs text-muted-foreground">Building ingest profile & filename patterns</p>
          </div>
        )}

        {step === "proposal" && proposal && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {Math.round((proposal.confidence ?? 0.85) * 100)}% confidence
              </Badge>
              {discovery?.aiUsed && (
                <Badge variant="outline" className="gap-1">
                  <Brain className="h-3 w-3" /> AI profile
                </Badge>
              )}
              <Badge variant="outline">{proposal.sourceSystem}</Badge>
            </div>
            <p className="leading-relaxed text-muted-foreground">{proposal.summary}</p>
            <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
              <Row label="Company" value={proposal.opcoName} />
              <Row label="City" value={proposal.city} />
              <Row label="Format" value={proposal.formatName ?? "—"} />
              <Row
                label="Store"
                value={STORE_LABELS[proposal.targetStore ?? "mixed"] ?? proposal.targetStore ?? "—"}
              />
              <Row label="Filename patterns" value={proposal.filenamePatterns.join(" · ")} />
            </div>
            {proposal.qualityChecks && proposal.qualityChecks.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {proposal.qualityChecks.map((c) => (
                  <li key={c}>• {c}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="flex items-center gap-3 py-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            <div>
              <p className="font-medium text-emerald-400">Operating company registered</p>
              <p className="text-sm text-muted-foreground">
                Future uploads matching these filename patterns will use this profile.
              </p>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>

      {step !== "done" && step !== "analyzing" && (
        <CardFooter className="flex flex-wrap gap-2">
          {step === "intro" && (
            <>
              <Button
                type="button"
                onClick={() => {
                  if (mode === "from_upload" && uploadId) {
                    void runDiscover(undefined, answers);
                  } else {
                    setStep("file");
                  }
                }}
                disabled={!answers.city.trim()}
                className="gap-1"
              >
                <Sparkles className="h-4 w-4" />
                {mode === "from_upload" ? "Analyze with AI" : "Next — drop sample file"}
              </Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </>
          )}
          {step === "proposal" && (
            <>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void handleSave(Boolean(uploadId && onContinueIngest))}
                className="gap-1"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Building2 className="h-4 w-4" />
                )}
                Save profile
                {uploadId && onContinueIngest ? " & continue merge" : ""}
              </Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
