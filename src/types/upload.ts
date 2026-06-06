export type UploadStatus = "pending" | "confirmed";

export type MergeRecommendation = "ready" | "review_required" | "reject";

export interface WorkbookSheetProfile {
  name: string;
  kind: string;
  rowCount: number;
  headers: string[];
  dateRange?: { start: string | null; end: string | null };
  yearBreakdown?: Record<string, number>;
  opcoHint?: string | null;
  skippedReason?: string | null;
}

export interface WorkbookProfile {
  mergedSheets: string[];
  sheetCount: number;
  sheets: WorkbookSheetProfile[];
  totalMergedRows: number;
  yearBreakdown: Record<string, number>;
  dateRange: { start: string | null; end: string | null };
  opcoHint?: string | null;
  cityHint?: string | null;
}

export interface DatasetProfile {
  rowCount: number;
  dateRange: { start: string | null; end: string | null };
  yearBreakdown: Record<string, number>;
  rowsBySheet: Record<string, number>;
  hasDates: boolean;
}

export interface AiBriefing {
  summary: string;
  dataType: string;
  targetStore?: string | null;
  storeReason?: string;
  recommendedOpco: string | null;
  recommendedCity: string | null;
  dateRange?: { start: string | null; end: string | null };
  yearBreakdown?: Record<string, number>;
  qualityChecks: string[];
  mergeRecommendation: MergeRecommendation;
  controllerQuestion: string;
}

export type GlCategory =
  | "materials"
  | "subcontractors"
  | "billing"
  | "payment_lag"
  | "overhead"
  | "unmapped";

export interface ColumnMappingDto {
  date: string | null;
  gl_account: string | null;
  amount: string | null;
  debit: string | null;
  credit: string | null;
  description: string | null;
  opco: string | null;
  project_id: string | null;
  source_system: string | null;
  city: string | null;
}

export interface GlSuggestionDto {
  glAccount: string;
  suggestedCategory: GlCategory;
  confidence: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
}

export interface StoreRouting {
  targetStore: string;
  mixed: boolean;
  reason: string;
  rowCountsByStore: Record<string, number>;
  activeStores: string[];
  filenameHint?: string | null;
  stores: { id: string; label: string; file: string; rowCount: number }[];
}

export interface DuplicateCheck {
  totalRows: number;
  duplicateRows: number;
  newRows: number;
  duplicatePercent: number;
  blockMerge: boolean;
  status: "empty" | "all_new" | "partial_duplicate" | "all_duplicate";
  message: string;
  storeRouting?: StoreRouting;
  newRowsByStore?: Record<string, number>;
  duplicateRowsByStore?: Record<string, number>;
}

export interface ScanSummary {
  overallConfidence: number;
  rowsScanned: number;
  rowsValid: number;
  mappingVerified: boolean;
  duplicateStatus?: string;
  trainedProfile: boolean;
}

export interface UploadAnalysis {
  uploadId: string;
  filename: string;
  rowCount: number;
  headers: string[];
  sampleRows: Record<string, string>[];
  detectedSystem: string;
  systemConfidence: number;
  columnMapping: ColumnMappingDto;
  columnConfidence: Record<string, number>;
  glSuggestions: GlSuggestionDto[];
  sampleNormalized: Record<string, string | number>[];
  warnings: string[];
  aiUsed: boolean;
  aiNotes?: string;
  aiBriefing?: AiBriefing;
  fileType?: "csv" | "xlsx";
  sheetName?: string | null;
  workbookProfile?: WorkbookProfile;
  datasetProfile?: DatasetProfile;
  duplicateCheck?: DuplicateCheck;
  storeRouting?: StoreRouting;
  companyMatch?: CompanyMatch | null;
  ingestProfile?: IngestProfileSummary | null;
  scanSummary?: ScanSummary;
  suggestedContext?: { opco: string; city: string; sourceSystem: string };
  needsDiscovery?: boolean;
  discoveryReason?: string;
  status?: UploadStatus;
  rowsAdded?: number;
  totalRows?: number;
}

export interface StoreStat {
  label: string;
  file: string;
  rowCount: number;
}

export interface UnifiedStats {
  totalRows: number;
  opcos: string[];
  systems: string[];
  cities: string[];
  unmappedGl: number;
  stores?: Record<string, StoreStat>;
}

export const STORE_LABELS: Record<string, string> = {
  revenue: "Revenue & billing",
  costs: "Operating costs",
  overhead: "Overhead",
  ledger: "General ledger",
  mixed: "Multiple stores (split by GL)",
};

export const GL_CATEGORY_LABELS: Record<GlCategory, string> = {
  materials: "Materials outflows",
  subcontractors: "Subcontractor payments",
  billing: "Milestone billing",
  payment_lag: "Payment lag",
  overhead: "Overhead",
  unmapped: "Unmapped — needs review",
};

export const FILE_COLUMN_FIELDS: { key: keyof ColumnMappingDto; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "gl_account", label: "GL account" },
  { key: "amount", label: "Amount" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "description", label: "Description" },
];

/** @deprecated Use FILE_COLUMN_FIELDS — opco/city are set via company registry */
export const UNIFIED_FIELDS = FILE_COLUMN_FIELDS;

export interface PortfolioCompany {
  opcoId: string;
  opcoName: string;
  city: string;
  sourceSystem: string;
  dataFolder?: string;
  filenamePatterns?: string[];
  notes?: string;
  ingestProfile?: {
    trained: boolean;
    autoMerge: boolean;
    formatName?: string;
    parser?: string;
    confidence?: number;
    summary?: string;
  } | null;
}

export interface IngestProfileSummary {
  trained: boolean;
  autoMerge: boolean;
  formatName?: string | null;
  parser?: string | null;
  confidence?: number | null;
}

export interface IngestResult {
  merged: boolean;
  reason?: string;
  uploadId?: string;
  rowsAdded?: number;
  rowsAddedByStore?: Record<string, number>;
  totalRows?: number;
  company?: CompanyMatch;
  ingestProfile?: IngestProfileSummary | null;
  analysis?: UploadAnalysis;
  forecastRan?: boolean;
  weatherRan?: boolean;
  weatherError?: string;
  warnings?: string[];
  needsDiscovery?: boolean;
  discoveryReason?: string;
}

export interface DiscoveryProposal {
  opcoName: string;
  city: string;
  region?: string;
  sourceSystem: string;
  filenamePatterns: string[];
  formatName?: string;
  targetStore?: string;
  parser?: string;
  summary?: string;
  qualityChecks?: string[];
  columnMapping?: Record<string, string | null>;
  confidence?: number;
  notes?: string;
}

export interface DiscoveryResult {
  status: "questions" | "proposal";
  sessionId?: string;
  filename?: string;
  questions?: string[];
  proposal?: DiscoveryProposal;
  createPayload?: Record<string, unknown>;
  aiUsed?: boolean;
  aiAvailable?: boolean;
  preview?: { detectedSystem?: string; headers?: string[] };
}

export interface CompanyMatch {
  opcoId: string;
  opcoName: string;
  city: string;
  sourceSystem: string;
  projectId: string;
  matchMethod: string;
  matchedFile: string;
  dataFolder?: string;
  notes?: string;
}
