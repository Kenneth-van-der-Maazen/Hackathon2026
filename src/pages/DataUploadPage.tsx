import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import { useUploadApi } from "../hooks/useUploadApi";
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
import { Separator } from "@/components/ui/separator";
import type { DuplicateCheck, GlCategory, StoreRouting, UploadAnalysis } from "../types/upload";
import { GL_CATEGORY_LABELS, STORE_LABELS, UNIFIED_FIELDS } from "../types/upload";

type Step = "upload" | "briefing" | "review" | "merging" | "done";

const MERGE_STAGES = [
  "Validating row mappings…",
  "Writing to central database…",
  "Refreshing 13-week forecast…",
] as const;

const GL_OPTIONS: GlCategory[] = [
  "materials",
  "subcontractors",
  "billing",
  "payment_lag",
  "overhead",
  "unmapped",
];

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "briefing", label: "AI briefing" },
  { id: "review", label: "Technical review" },
  { id: "merging", label: "Merging" },
  { id: "done", label: "Merged" },
];

export function DataUploadPage() {
  const { aiAvailable, stats, loading, error, analyzeFile, confirmUpload } = useUploadApi();
  const [analysis, setAnalysis] = useState<UploadAnalysis | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [opco, setOpco] = useState("");
  const [city, setCity] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [confirmed, setConfirmed] = useState<{
    rowsAdded: number;
    totalRows: number;
    rowsAddedByStore?: Record<string, number>;
  } | null>(null);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState<string>(MERGE_STAGES[0]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setConfirmed(null);
      setStep("upload");
      try {
        const result = await analyzeFile(file, {
          opco,
          city,
          sourceSystem: sourceSystem || undefined,
          useAi: useAi && aiAvailable,
        });
        setAnalysis(result);
        if (result.aiBriefing?.recommendedOpco && !opco) {
          setOpco(result.aiBriefing.recommendedOpco);
        }
        if (result.aiBriefing?.recommendedCity && !city) {
          setCity(result.aiBriefing.recommendedCity);
        }
        if (!sourceSystem && result.detectedSystem !== "Unknown") {
          setSourceSystem(result.detectedSystem);
        }
        setStep(result.aiBriefing ? "briefing" : "review");
      } catch {
        /* error surfaced via useUploadApi */
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [analyzeFile, opco, city, sourceSystem, useAi, aiAvailable],
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  }

  function updateMapping(field: keyof UploadAnalysis["columnMapping"], value: string) {
    if (!analysis) return;
    setAnalysis({
      ...analysis,
      columnMapping: { ...analysis.columnMapping, [field]: value || null },
    });
  }

  function updateGl(index: number, category: GlCategory) {
    if (!analysis) return;
    const next = [...analysis.glSuggestions];
    next[index] = {
      ...next[index],
      suggestedCategory: category,
      status: category === "unmapped" ? "pending" : "approved",
    };
    setAnalysis({ ...analysis, glSuggestions: next });
  }

  async function handleConfirm() {
    if (!analysis || analysis.duplicateCheck?.blockMerge) return;

    setStep("merging");
    setMergeProgress(8);
    setMergeStage(MERGE_STAGES[0]);

    const progressTimer = window.setInterval(() => {
      setMergeProgress((p) => (p >= 88 ? p : p + 3));
    }, 160);
    const stage1 = window.setTimeout(() => setMergeStage(MERGE_STAGES[1]), 700);
    const stage2 = window.setTimeout(() => setMergeStage(MERGE_STAGES[2]), 1500);

    try {
      const result = await confirmUpload(analysis.uploadId, {
        columnMapping: analysis.columnMapping,
        glSuggestions: analysis.glSuggestions,
        opco: opco || undefined,
        city: city || undefined,
        sourceSystem: sourceSystem || undefined,
      });
      setMergeProgress(100);
      setMergeStage("Merge complete");
      await new Promise((r) => window.setTimeout(r, 550));
      setConfirmed({
        rowsAdded: result.rowsAdded,
        totalRows: result.totalRows,
        rowsAddedByStore: result.rowsAddedByStore,
      });
      setStep("done");
    } catch {
      setStep("review");
    } finally {
      window.clearInterval(progressTimer);
      window.clearTimeout(stage1);
      window.clearTimeout(stage2);
    }
  }

  const activeStepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl tracking-tight">Ingest accounting data</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Drop an Excel or CSV export from Gilde, Yuki, Exact, or Snelstart. Claude analyses the
          file, explains what it contains, and only merges after you confirm.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepIndicator steps={STEPS} activeIndex={activeStepIndex} />
        <Badge
          variant={aiAvailable ? "secondary" : "outline"}
          className="h-7 shrink-0 gap-1.5 px-3"
        >
          {aiAvailable ? (
            <>
              <Sparkles className="h-3 w-3" />
              Anthropic AI ready
            </>
          ) : (
            <>
              <Brain className="h-3 w-3" />
              Heuristic mode
            </>
          )}
        </Badge>
      </div>

      {stats && stats.totalRows > 0 && (
        <Card className="py-0 ring-1 ring-border/60">
          <CardContent className="flex flex-wrap divide-x divide-border-strong p-0">
            <Stat label="Central database rows" value={stats.totalRows.toLocaleString()} />
            {stats.stores &&
              Object.entries(stats.stores)
                .filter(([, s]) => s.rowCount > 0)
                .map(([id, s]) => (
                  <Stat key={id} label={s.label} value={s.rowCount.toLocaleString()} />
                ))}
            <Stat label="Systems" value={String(stats.systems.length)} />
            <Stat label="Opcos" value={String(stats.opcos.length)} />
            <Stat label="Unmapped GL" value={String(stats.unmappedGl)} warn={stats.unmappedGl > 0} />
          </CardContent>
        </Card>
      )}

      {step === "upload" && (
        <div className="grid grid-cols-1 items-start gap-4 pt-1 lg:grid-cols-3 lg:gap-6">
          <Card className="lg:col-span-1 border border-white/[0.08] pb-6 ring-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Context</CardTitle>
              <CardDescription>Optional — AI will suggest opco and city if blank</CardDescription>
            </CardHeader>
            <CardContent className="pb-0">
              <div className="space-y-5">
                <Field
                  label="Operating company"
                  value={opco}
                  onChange={setOpco}
                  placeholder="e.g. Portfolio Company Heeze"
                />
                <Field label="City" value={city} onChange={setCity} placeholder="e.g. Heeze" />
                <Field
                  label="Source system"
                  value={sourceSystem}
                  onChange={setSourceSystem}
                  placeholder="Auto-detected"
                />
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={useAi}
                    disabled={!aiAvailable}
                    onChange={(e) => setUseAi(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-sm font-medium text-foreground/90">
                    Use Anthropic AI analysis
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 border border-white/[0.08] ring-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Upload file</CardTitle>
              <CardDescription>Excel or CSV export from your accounting system</CardDescription>
            </CardHeader>
            <CardContent className="pb-6">
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "flex min-h-[280px] w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/40 bg-white/[0.02] px-6 py-10 transition-colors",
                  "hover:border-white/50 hover:bg-white/[0.04]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  dragOver && "border-primary/60 bg-primary/[0.06]",
                  loading && "pointer-events-none opacity-80",
                )}
                onClick={() => {
                  if (!loading) openFilePicker();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!loading) openFilePicker();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  className="hidden"
                  onChange={onFileInputChange}
                />
                {loading ? (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />
                    <p className="mt-4 font-medium">Analysing with AI…</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Scanning columns, GL accounts, and date range
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/10">
                      <Upload className="h-7 w-7 text-muted-foreground" aria-hidden />
                    </div>
                    <p className="font-medium">Drop Excel or CSV here</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      .xlsx, .xls, .csv · max 25MB
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-5 hover:bg-white/[0.06]"
                      onClick={(e) => {
                        e.stopPropagation();
                        openFilePicker();
                      }}
                    >
                      Choose file
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          {error.includes("fetch") && (
            <span className="text-muted-foreground">
              {" "}
              — run <code className="font-mono">npm run dev:api</code>
            </span>
          )}
        </div>
      )}

      {analysis && step === "briefing" && analysis.aiBriefing && (
        <AiBriefingCard
          analysis={analysis}
          briefing={analysis.aiBriefing}
          duplicateCheck={analysis.duplicateCheck}
          storeRouting={analysis.storeRouting}
          onContinue={() => setStep("review")}
          onReupload={() => {
            setAnalysis(null);
            setStep("upload");
          }}
        />
      )}

      {analysis && step === "review" && (
        <AnalysisReview
          analysis={analysis}
          opco={opco}
          city={city}
          sourceSystem={sourceSystem}
          duplicateCheck={analysis.duplicateCheck}
          storeRouting={analysis.storeRouting}
          onMappingChange={updateMapping}
          onGlChange={updateGl}
          onConfirm={handleConfirm}
          onBack={() => setStep(analysis.aiBriefing ? "briefing" : "upload")}
          onReupload={() => {
            setAnalysis(null);
            setStep("upload");
          }}
          loading={loading}
        />
      )}

      {step === "merging" && (
        <MergeOverlay progress={mergeProgress} stage={mergeStage} filename={analysis?.filename} />
      )}

      {step === "done" && confirmed && (
        <MergeSuccessCard
          rowsAdded={confirmed.rowsAdded}
          totalRows={confirmed.totalRows}
          rowsAddedByStore={confirmed.rowsAddedByStore}
          onUploadAnother={() => {
            setAnalysis(null);
            setConfirmed(null);
            setMergeProgress(0);
            setStep("upload");
          }}
        />
      )}
    </div>
  );
}

function StepIndicator({
  steps,
  activeIndex,
}: {
  steps: { id: Step; label: string }[];
  activeIndex: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => {
        const isCompleted = i < activeIndex;
        const isActive = i === activeIndex;

        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                isActive && "bg-primary text-primary-foreground shadow-sm",
                isCompleted && "bg-primary/15 text-primary",
                !isActive && !isCompleted && "border border-white/15 bg-transparent text-muted-foreground",
              )}
            >
              {isCompleted ? (
                <Check className="h-3 w-3 shrink-0" aria-hidden />
              ) : (
                <span
                  className={cn(
                    "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-white/10 text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
              )}
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <ChevronRight className="h-3.5 w-3.5 text-white/25" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StoreRoutingBanner({ routing }: { routing: StoreRouting }) {
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Database className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Target database</p>
        <Badge variant="secondary">
          {routing.mixed
            ? STORE_LABELS.mixed
            : STORE_LABELS[routing.targetStore] ?? routing.targetStore}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{routing.reason}</p>
      {routing.stores.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {routing.stores.map((s) => (
            <div
              key={s.id}
              className="rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 text-xs"
            >
              <span className="font-medium">{s.label}</span>
              <span className="ml-2 font-mono text-muted-foreground">{s.file}</span>
              <span className="ml-2 tabular-nums text-primary">{s.rowCount.toLocaleString()} rows</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DuplicateBanner({ check }: { check: DuplicateCheck }) {
  if (check.status === "all_new") return null;

  const isBlocked = check.blockMerge;

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border px-4 py-4",
        isBlocked
          ? "border-destructive/40 bg-destructive/10"
          : "border-amber-500/35 bg-amber-500/8",
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={cn("mt-0.5 h-5 w-5 shrink-0", isBlocked ? "text-destructive" : "text-amber-400")}
        />
        <div>
          <p className={cn("font-medium", isBlocked ? "text-destructive" : "text-amber-400")}>
            {isBlocked ? "Already in central database" : "Partial overlap detected"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{check.message}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <span>
              <span className="text-muted-foreground">In file: </span>
              <span className="font-medium tabular-nums">{check.totalRows.toLocaleString()}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Duplicates: </span>
              <span className="font-medium tabular-nums text-destructive">
                {check.duplicateRows.toLocaleString()}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">New rows: </span>
              <span className="font-medium tabular-nums text-emerald-400">
                {check.newRows.toLocaleString()}
              </span>
            </span>
          </div>
          {isBlocked && (
            <p className="mt-2 text-xs text-destructive/90">
              Merge is blocked. Upload a different file or new data not yet in the system.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MergeOverlay({
  progress,
  stage,
  filename,
}: {
  progress: number;
  stage: string;
  filename?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <Card className="w-full max-w-md animate-fade-up ring-1 ring-border/60">
        <CardContent className="py-8">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6 flex h-16 w-16 items-center justify-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <Database className="absolute h-5 w-5 text-primary/80" />
            </div>
            <p className="text-lg font-medium">Merging into central database</p>
            {filename && <p className="mt-1 text-sm text-muted-foreground">{filename}</p>}
            <p className="mt-4 text-sm text-muted-foreground animate-merge-progress">{stage}</p>
            <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-xs text-muted-foreground">{progress}%</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MergeSuccessCard({
  rowsAdded,
  totalRows,
  rowsAddedByStore,
  onUploadAnother,
}: {
  rowsAdded: number;
  totalRows: number;
  rowsAddedByStore?: Record<string, number>;
  onUploadAnother: () => void;
}) {
  const storeEntries = rowsAddedByStore
    ? Object.entries(rowsAddedByStore).filter(([, n]) => n > 0)
    : [];

  return (
    <Card className="animate-merge-success border-emerald-500/35 bg-emerald-500/8 ring-1 ring-emerald-500/20">
      <CardContent className="flex flex-col items-center py-10 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-2 ring-emerald-500/30">
          <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        </div>
        <p className="text-xl font-semibold text-emerald-400">Successfully merged</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Added{" "}
          <span className="font-medium tabular-nums text-foreground">{rowsAdded.toLocaleString()}</span>{" "}
          new rows. Central database total:{" "}
          <span className="font-medium tabular-nums text-foreground">{totalRows.toLocaleString()}</span>{" "}
          rows. Forecast refreshed.
        </p>
        {storeEntries.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {storeEntries.map(([id, count]) => (
              <Badge key={id} variant="outline" className="gap-1 tabular-nums">
                {STORE_LABELS[id] ?? id}: +{count.toLocaleString()}
              </Badge>
            ))}
          </div>
        )}
        <Button variant="outline" className="mt-6" onClick={onUploadAnother}>
          Upload another file
        </Button>
      </CardContent>
    </Card>
  );
}

function AiBriefingCard({
  analysis,
  briefing,
  duplicateCheck,
  storeRouting,
  onContinue,
  onReupload,
}: {
  analysis: UploadAnalysis;
  briefing: NonNullable<UploadAnalysis["aiBriefing"]>;
  duplicateCheck?: DuplicateCheck;
  storeRouting?: StoreRouting;
  onContinue: () => void;
  onReupload: () => void;
}) {
  const recColor =
    briefing.mergeRecommendation === "ready"
      ? "text-emerald-400"
      : briefing.mergeRecommendation === "reject"
        ? "text-destructive"
        : "text-amber-400";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <CardTitle>AI briefing — read before you merge</CardTitle>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          {analysis.filename}
          {analysis.fileType === "xlsx" && analysis.sheetName && (
            <Badge variant="outline">Sheet: {analysis.sheetName}</Badge>
          )}
          <Badge variant="secondary">{analysis.detectedSystem}</Badge>
          <span>{analysis.rowCount.toLocaleString()} rows</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {storeRouting && <StoreRoutingBanner routing={storeRouting} />}
        {duplicateCheck && <DuplicateBanner check={duplicateCheck} />}

        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            What this data is about
          </p>
          <p className="mt-2 text-sm leading-relaxed">{briefing.summary}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Meta label="Data type" value={briefing.dataType} />
          <Meta
            label="Date range"
            value={
              briefing.dateRange?.start && briefing.dateRange?.end
                ? `${briefing.dateRange.start} → ${briefing.dateRange.end}`
                : "Not detected"
            }
          />
          <Meta
            label="Suggested opco / city"
            value={[briefing.recommendedOpco, briefing.recommendedCity].filter(Boolean).join(" · ") || "—"}
          />
        </div>

        {briefing.qualityChecks.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Quality checks
            </p>
            <ul className="mt-2 space-y-1.5">
              {briefing.qualityChecks.map((c) => (
                <li key={c} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="text-primary">•</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {analysis.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            {analysis.warnings.map((w) => (
              <p key={w} className="text-sm text-amber-400">
                ⚠ {w}
              </p>
            ))}
          </div>
        )}

        <Separator />

        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">
            Confirm before merge
          </p>
          <p className="mt-2 text-sm font-medium">{briefing.controllerQuestion}</p>
          <p className={`mt-2 text-xs ${recColor}`}>
            Recommendation: {briefing.mergeRecommendation.replace("_", " ")}
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        <Button
          onClick={onContinue}
          disabled={briefing.mergeRecommendation === "reject" || duplicateCheck?.blockMerge}
        >
          I understand — review mappings
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={onReupload}>
          Upload different file
        </Button>
      </CardFooter>
    </Card>
  );
}

function AnalysisReview({
  analysis,
  opco,
  city,
  sourceSystem,
  duplicateCheck,
  storeRouting,
  onMappingChange,
  onGlChange,
  onConfirm,
  onBack,
  onReupload,
  loading,
}: {
  analysis: UploadAnalysis;
  opco: string;
  city: string;
  sourceSystem: string;
  duplicateCheck?: DuplicateCheck;
  storeRouting?: StoreRouting;
  onMappingChange: (field: keyof UploadAnalysis["columnMapping"], value: string) => void;
  onGlChange: (index: number, category: GlCategory) => void;
  onConfirm: () => void;
  onBack: () => void;
  onReupload: () => void;
  loading: boolean;
}) {
  const unmappedPending = analysis.glSuggestions.filter(
    (s) => s.suggestedCategory === "unmapped" && s.status !== "rejected",
  );
  const mergeBlocked = duplicateCheck?.blockMerge ?? false;

  return (
    <div className="flex flex-col gap-5">
      {storeRouting && <StoreRoutingBanner routing={storeRouting} />}
      {duplicateCheck && <DuplicateBanner check={duplicateCheck} />}

      {!analysis.aiBriefing && mergeBlocked && (
        <Card className="ring-1 ring-border/60">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              This file cannot be merged because every row already exists in the central database.
            </p>
            <Button variant="outline" className="mt-4" onClick={onReupload}>
              Upload a different file
            </Button>
          </CardContent>
        </Card>
      )}

      {!mergeBlocked && (
        <>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-base">Technical review</CardTitle>
          <CardDescription>
            Verify column and GL mappings, then push to the central database.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{analysis.detectedSystem}</Badge>
          <span>{analysis.rowCount} rows</span>
          {opco && <span>Opco: {opco}</span>}
          {city && <span>City: {city}</span>}
          {sourceSystem && <span>System: {sourceSystem}</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Column mapping</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-4">Unified field</th>
                <th className="pb-2">Source column</th>
                <th className="pb-2">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {UNIFIED_FIELDS.map(({ key, label, required }) => (
                <tr key={key} className="border-b border-border/50">
                  <td className="py-2 pr-4">
                    {label}
                    {required && <span className="text-destructive"> *</span>}
                  </td>
                  <td className="py-2">
                    <select
                      value={analysis.columnMapping[key] ?? ""}
                      onChange={(e) => onMappingChange(key, e.target.value)}
                      className="w-full max-w-xs rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="">— not mapped —</option>
                      {analysis.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 font-mono text-xs text-muted-foreground">
                    {analysis.columnConfidence[key]
                      ? `${Math.round(analysis.columnConfidence[key] * 100)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {analysis.glSuggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">GL account mapping</CardTitle>
            <CardDescription>Assign categories before merging unmapped accounts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {analysis.glSuggestions.map((s, i) => (
              <div
                key={s.glAccount}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                <span className="font-mono text-sm">{s.glAccount}</span>
                <select
                  value={s.suggestedCategory}
                  onChange={(e) => onGlChange(i, e.target.value as GlCategory)}
                  className="rounded border border-border bg-background px-2 py-1 text-sm"
                >
                  {GL_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {GL_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">{s.reason}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {analysis.sampleNormalized.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview — unified rows</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {["date", "gl_account", "amount", "opco", "source_system", "gl_category"].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.sampleNormalized.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 font-mono">
                    {["date", "gl_account", "amount", "opco", "source_system"].map((k) => (
                      <td key={k} className="px-2 py-1.5">
                        {String(row[k] ?? "")}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-primary">auto</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          disabled={loading || unmappedPending.length > 0 || mergeBlocked}
          onClick={onConfirm}
          className="gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Pushing…
            </>
          ) : (
            <>
              <Database className="h-4 w-4" />
              Push to central database
              {duplicateCheck && duplicateCheck.newRows > 0 && duplicateCheck.newRows < duplicateCheck.totalRows && (
                <span className="text-primary-foreground/80">
                  ({duplicateCheck.newRows.toLocaleString()} new)
                </span>
              )}
            </>
          )}
        </Button>
        {mergeBlocked && (
          <p className="text-sm text-destructive">Duplicate file — merge not allowed.</p>
        )}
        {!mergeBlocked && unmappedPending.length > 0 && (
          <p className="text-sm text-amber-400">
            Assign categories to {unmappedPending.length} unmapped GL account(s) first.
          </p>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground/90">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-white/[0.12] bg-background px-3 text-sm placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      />
    </label>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-[140px] flex-1 px-6 py-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          warn ? "text-amber-400" : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium capitalize">{value}</p>
    </div>
  );
}
