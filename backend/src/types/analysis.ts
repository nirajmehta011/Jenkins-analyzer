export type TestStatus = 'PASSED' | 'FAILED' | 'ERROR' | 'SKIPPED';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type FixComplexity = 'LOW' | 'MEDIUM' | 'HIGH';

export type FailureCategory =
  | 'NullPointerException'
  | 'AssertionError'
  | 'Timeout'
  | 'ConnectionError'
  | 'ConfigError'
  | 'DependencyError'
  | 'SetupFailure'
  | 'DataError'
  | 'EnvironmentError'
  | 'RaceCondition'
  | 'AuthError'
  | 'NetworkError'
  | 'Unknown';

export interface SymptomVsCause {
  symptom: string;
  cause: string;
}

export interface RelatedLink {
  label: string;
  url: string;
}

export interface EvidenceContext {
  /** The 1-2 execution steps immediately before the failure — what the test was doing right before it broke. */
  precedingSteps: string[];
  expected: string | null;
  received: string | null;
  /** The page/URL the failure occurred on, when present in the log. */
  pageUrl: string | null;
  /** Duration of the failing step, when present (e.g. "1.1s", "30000ms"). */
  duration: string | null;
}

export interface CascadingGroup {
  groupId: string;
  rootCause: string;
  affectedTestIds: string[];
  fixOnce: boolean;
}

export interface TestCase {
  id: string;
  name: string;
  suite: string | null;
  status: TestStatus;
  duration: string | null;
  isFlaky: boolean;
  isCascading: boolean;
  cascadeGroupId: string | null;
  exceptionType: string | null;
  errorMessage: string | null;
  stackFrames: string[];
  rootCause: string | null;
  symptomVsCause: SymptomVsCause | null;
  severity: Severity | null;
  category: FailureCategory | null;
  fixSuggestion: string | null;
  fixComplexity: FixComplexity | null;
  logEvidenceQuote: string | null;
  parserConfidence: Confidence;
  testUserEmail: string | null;
  relatedLinks: RelatedLink[];
  attemptCount: number | null;
  isHookFailure: boolean;
  evidenceContext: EvidenceContext | null;
}

export interface BuildSummary {
  overallStatus: string;
  buildDuration: string | null;
  jdkVersion: string | null;
  buildTool: string | null;
  topFailureCategories: Array<{ category: string; count: number }>;
  recommendedFirstFix: string | null;
  estimatedFixComplexity: FixComplexity | null;
}

export interface AnalysisResult {
  id: string;
  filename: string;
  analyzedAt: string;
  totalChunks: number;
  buildSummary: BuildSummary | null;
  cascadingGroups: CascadingGroup[];
  cases: TestCase[];
  summary: {
    total: number;
    failed: number;
    passed: number;
    skipped: number;
    errors: number;
    flaky: number;
  };
}

export interface ProjectConfig {
  projectType: string;
  testFramework: string;
  environment: string;
  knownFlaky: string;
  failedCasesInput?: string;
  /**
   * When true AND failedCasesInput is non-empty, ZIP entries whose file path
   * doesn't correspond to anything in that list are never decompressed at
   * all (treated as passed from the path alone) — a large memory/speed win
   * on big archives, at the cost of losing failedCasesInput's content-based
   * matching fallback for files whose path doesn't obviously match. Off by
   * default so existing behavior is unchanged unless explicitly opted in.
   */
  skipNonMatchingFiles?: boolean;
}

export interface AnalysisOptions {
  enableRootCause: boolean;
  enableFixSuggestion: boolean;
  enableGrouping: boolean;
  enableSeverity: boolean;
  enableFlaky: boolean;
  enableDiff: boolean;
}

export interface SSEProgressEvent {
  stage: 'uploading' | 'preprocessing' | 'chunking' | 'analyzing' | 'merging' | 'done' | 'error';
  pct: number;
  message?: string;
  chunk?: number;
  total?: number;
  result?: AnalysisResult;
  error?: string;
}

export type AIProviderType = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'groq' | 'ollama';

export interface AIProviderConfig {
  provider: AIProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string; // For custom endpoints (Ollama, self-hosted)
}

export interface AIModelOption {
  id: string;
  name: string;
  maxTokens: number;
}

export interface AIProviderInfo {
  id: AIProviderType;
  name: string;
  requiresKey: boolean;
  baseUrl?: string;
  models: AIModelOption[];
}
