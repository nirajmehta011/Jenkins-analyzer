import { useState, useCallback, useRef } from 'react';
import type {
  AnalysisResult,
  ProjectConfig,
  AnalysisOptions,
  SSEProgressEvent,
  HistoryEntry,
  AIProviderConfig,
} from '../types/analysis';
import { startAnalysis, requestFixSuggestions } from '../services/api';
import type { FixSuggestion } from '../services/api';

const HISTORY_KEY = 'jenkins-analyzer-history';
const MAX_HISTORY = 10;

interface AnalysisProgress {
  stage: string;
  pct: number;
  message: string;
  chunk?: number;
  totalChunks?: number;
}

interface UseAnalysisReturn {
  file: File | null;
  config: ProjectConfig;
  options: AnalysisOptions;
  aiConfig: AIProviderConfig;
  progress: AnalysisProgress | null;
  result: AnalysisResult | null;
  error: string | null;
  isAnalyzing: boolean;
  isLoadingFixes: boolean;
  fixProgress: string | null;
  fixError: string | null;
  setFile: (file: File | null) => void;
  setConfig: (config: ProjectConfig) => void;
  setAIConfig: (config: AIProviderConfig) => void;
  toggleOption: (key: keyof AnalysisOptions) => void;
  setOptions: (options: AnalysisOptions) => void;
  startAnalysisFlow: () => void;
  fetchFixSuggestions: () => void;
  resetAnalysis: () => void;
  loadFromHistory: (id: string) => void;
  history: HistoryEntry[];
  clearHistory: () => void;
}

const defaultConfig: ProjectConfig = {
  projectType: 'Spring Boot',
  testFramework: 'JUnit 5',
  environment: 'CI/Docker',
  knownFlaky: '',
  failedCasesInput: '',
};

const defaultOptions: AnalysisOptions = {
  enableRootCause: true,
  enableFixSuggestion: true,
  enableGrouping: true,
  enableSeverity: true,
  enableFlaky: true,
  enableDiff: false,
};

const defaultAIConfig: AIProviderConfig = {
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-3-5-sonnet-latest',
};

const AI_CONFIG_KEY = 'jenkins-analyzer-ai-config';

function loadAIConfig(): AIProviderConfig {
  try {
    const data = localStorage.getItem(AI_CONFIG_KEY);
    if (!data) return defaultAIConfig;
    const parsed = JSON.parse(data) as AIProviderConfig;
    return {
      provider: parsed.provider || 'anthropic',
      apiKey: parsed.apiKey || '',
      model: parsed.model || 'claude-3-5-sonnet-latest',
      baseUrl: parsed.baseUrl,
    };
  } catch {
    return defaultAIConfig;
  }
}

function saveAIConfig(config: AIProviderConfig): void {
  try {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // quota exceeded — skip
  }
}

function loadHistory(): HistoryEntry[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    if (!data) return [];
    return JSON.parse(data) as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(history: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // localStorage quota exceeded — silently skip
  }
}

export function useAnalysis(): UseAnalysisReturn {
  const [file, setFile] = useState<File | null>(null);
  const [config, setConfig] = useState<ProjectConfig>(defaultConfig);
  const [options, setOptions] = useState<AnalysisOptions>(defaultOptions);
  const [aiConfig, setAIConfigState] = useState<AIProviderConfig>(loadAIConfig);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  // Fix suggestions state
  const [isLoadingFixes, setIsLoadingFixes] = useState(false);
  const [fixProgress, setFixProgress] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const fixAbortRef = useRef<(() => void) | null>(null);

  const toggleOption = useCallback((key: keyof AnalysisOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setAIConfig = useCallback((nextConfig: AIProviderConfig) => {
    setAIConfigState(nextConfig);
    saveAIConfig(nextConfig);
  }, []);

  const startAnalysisFlow = useCallback(() => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    // Validate file size (100 MB max)
    if (file.size > 100 * 1024 * 1024) {
      setError('File exceeds 100 MB limit. Please use a smaller file.');
      return;
    }

    setError(null);
    setResult(null);
    setIsAnalyzing(true);
    setFixError(null);
    setFixProgress(null);
    setProgress({ stage: 'uploading', pct: 0, message: 'Uploading file...' });

    const abort = startAnalysis(
      file,
      config,
      options,
      aiConfig,
      (event: SSEProgressEvent) => {
        if (event.stage === 'error') {
          setError(event.error || 'Analysis failed');
          setIsAnalyzing(false);
          setProgress(null);
          return;
        }

        if (event.stage === 'done' && event.result) {
          setResult(event.result);
          setIsAnalyzing(false);
          setProgress({ stage: 'done', pct: 100, message: 'Local analysis complete!' });

          // Save to history
          const entry: HistoryEntry = {
            id: event.result.id,
            filename: event.result.filename,
            analyzedAt: event.result.analyzedAt,
            failedCount: event.result.summary.failed,
            totalCount: event.result.summary.total,
            result: event.result,
          };
          setHistory((prev) => {
            const newHistory = [entry, ...prev.filter((h) => h.id !== entry.id)].slice(0, MAX_HISTORY);
            saveHistory(newHistory);
            return newHistory;
          });
          return;
        }

        setProgress({
          stage: event.stage,
          pct: event.pct,
          message: event.message || `Stage: ${event.stage}`,
          chunk: event.chunk,
          totalChunks: event.total,
        });
      },
      (errMsg: string) => {
        setError(errMsg);
        setIsAnalyzing(false);
        setProgress(null);
      },
      () => {
        // Stream complete
        setIsAnalyzing(false);
      }
    );

    abortRef.current = abort;
  }, [file, config, options, aiConfig]);

  /**
   * Request AI fix suggestions for the current result's failed cases.
   * Makes exactly 1 batched API call.
   */
  const fetchFixSuggestions = useCallback(() => {
    if (!result) {
      setFixError('No analysis result available');
      return;
    }

    const failedCases = result.cases.filter(c => c.status === 'FAILED' || c.status === 'ERROR');
    if (failedCases.length === 0) {
      setFixError('No failed test cases to get fix suggestions for');
      return;
    }

    if (!aiConfig.apiKey) {
      setFixError('Please configure an AI API key in the AI Settings panel first');
      return;
    }

    setIsLoadingFixes(true);
    setFixError(null);
    setFixProgress('Preparing failures for AI...');

    const abort = requestFixSuggestions(
      failedCases,
      config,
      aiConfig,
      (message: string, _pct: number) => {
        setFixProgress(message);
      },
      (fixes: FixSuggestion[]) => {
        // Merge fixes into the result
        setResult((prev) => {
          if (!prev) return prev;
          const updatedCases = prev.cases.map(tc => {
            const fix = fixes.find(f => f.id === tc.id);
            if (fix) {
              return {
                ...tc,
                fixSuggestion: fix.fixSuggestion,
                fixComplexity: fix.fixComplexity,
              };
            }
            return tc;
          });
          return { ...prev, cases: updatedCases };
        });
        setIsLoadingFixes(false);
        setFixProgress(`✅ AI fix suggestions loaded for ${fixes.length} cases`);
      },
      (errMsg: string) => {
        setFixError(errMsg);
        setIsLoadingFixes(false);
        setFixProgress(null);
      }
    );

    fixAbortRef.current = abort;
  }, [result, config, aiConfig]);

  const resetAnalysis = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    if (fixAbortRef.current) {
      fixAbortRef.current();
      fixAbortRef.current = null;
    }
    setFile(null);
    setResult(null);
    setError(null);
    setProgress(null);
    setIsAnalyzing(false);
    setIsLoadingFixes(false);
    setFixProgress(null);
    setFixError(null);
  }, []);

  const loadFromHistory = useCallback((id: string) => {
    const found = history.find((h) => h.id === id);
    if (found) {
      setResult(found.result);
      setError(null);
      setProgress({ stage: 'done', pct: 100, message: 'Loaded from history' });
      setIsAnalyzing(false);
      setFixProgress(null);
      setFixError(null);
    }
  }, [history]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  return {
    file,
    config,
    options,
    aiConfig,
    progress,
    result,
    error,
    isAnalyzing,
    isLoadingFixes,
    fixProgress,
    fixError,
    setFile,
    setConfig,
    setAIConfig,
    toggleOption,
    setOptions,
    startAnalysisFlow,
    fetchFixSuggestions,
    resetAnalysis,
    loadFromHistory,
    history,
    clearHistory,
  };
}
