import { useState, useMemo } from 'react';
import { useAnalysis } from './hooks/useAnalysis';
import UploadZone from './components/UploadZone';
import ConfigPanel from './components/ConfigPanel';
import AIConfigPanel from './components/AIConfigPanel';
import ProgressTracker from './components/ProgressTracker';
import SummaryCards from './components/SummaryCards';
import FilterBar from './components/FilterBar';
import SearchBar from './components/SearchBar';
import CaseList from './components/CaseList';
import ExportBar from './components/ExportBar';
import TrendChart from './components/TrendChart';
import DiffUpload, { type DiffResult } from './components/DiffUpload';
import DiffView from './components/DiffView';
import AnalysisHistory from './components/AnalysisHistory';
import FailureSummary from './components/FailureSummary';
import type { TestStatus, FailureCategory, Severity } from './types/analysis';

export default function App() {
  const {
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
    startAnalysisFlow,
    fetchFixSuggestions,
    resetAnalysis,
    loadFromHistory,
    history,
    clearHistory,
  } = useAnalysis();

  // Filter & search state
  const [statusFilter, setStatusFilter] = useState<TestStatus | 'ALL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<FailureCategory | 'ALL'>('ALL');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'ALL'>('ALL');
  const [flakyOnly, setFlakyOnly] = useState(false);
  const [cascadingOnly, setCascadingOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  // Available categories from results
  const availableCategories = useMemo(() => {
    if (!result) return [];
    const cats = new Set<FailureCategory>();
    for (const tc of result.cases) {
      if (tc.category) cats.add(tc.category);
    }
    return Array.from(cats);
  }, [result]);

  // Filtered cases
  const filteredCases = useMemo(() => {
    if (!result) return [];
    return result.cases.filter((tc) => {
      if (statusFilter !== 'ALL' && tc.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && tc.category !== categoryFilter) return false;
      if (severityFilter !== 'ALL' && tc.severity !== severityFilter) return false;
      if (flakyOnly && !tc.isFlaky) return false;
      if (cascadingOnly && !tc.isCascading) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = tc.name.toLowerCase().includes(q);
        const matchesSuite = tc.suite?.toLowerCase().includes(q);
        const matchesError = tc.errorMessage?.toLowerCase().includes(q);
        const matchesRootCause = tc.rootCause?.toLowerCase().includes(q);
        if (!matchesName && !matchesSuite && !matchesError && !matchesRootCause) return false;
      }
      return true;
    });
  }, [result, statusFilter, categoryFilter, severityFilter, flakyOnly, cascadingOnly, searchQuery]);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'ALL') count++;
    if (categoryFilter !== 'ALL') count++;
    if (severityFilter !== 'ALL') count++;
    if (flakyOnly) count++;
    if (cascadingOnly) count++;
    if (searchQuery) count++;
    return count;
  }, [statusFilter, categoryFilter, severityFilter, flakyOnly, cascadingOnly, searchQuery]);

  const handleCategoryClick = (category: FailureCategory) => {
    setCategoryFilter(category);
    setStatusFilter('ALL');
  };

  const showUploadView = !result && !isAnalyzing;
  const showProgressView = isAnalyzing && progress;
  const showResultView = result && !isAnalyzing;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full
                      bg-gradient-to-br from-indigo-500/5 to-violet-500/5 blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full
                      bg-gradient-to-br from-cyan-500/5 to-blue-500/5 blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                  Jenkins Log Analyzer
                </h1>
                <p className="text-xs text-slate-500">AI-powered CI/CD failure analysis</p>
              </div>
            </div>

            {result && (
              <button
                onClick={() => {
                  resetAnalysis();
                  setDiffResult(null);
                  setStatusFilter('ALL');
                  setCategoryFilter('ALL');
                  setSeverityFilter('ALL');
                  setFlakyOnly(false);
                  setCascadingOnly(false);
                  setSearchQuery('');
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-300
                         hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                New Analysis
              </button>
            )}
          </div>
        </header>

        {/* Error banner */}
        {error && (
          <div className="mb-6 flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-300">{error}</p>
            </div>
            <button
              onClick={() => startAnalysisFlow()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300
                       hover:bg-red-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Upload View */}
        {showUploadView && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <UploadZone onFileSelect={setFile} isAnalyzing={isAnalyzing} />

                <ConfigPanel
                  config={config}
                  options={options}
                  onConfigChange={setConfig}
                  onToggleOption={toggleOption}
                  disabled={isAnalyzing}
                />

                {/* Analyze button */}
                <button
                  id="start-analysis"
                  onClick={startAnalysisFlow}
                  disabled={!file || isAnalyzing}
                  className="w-full py-3.5 rounded-xl font-semibold text-white
                           bg-gradient-to-r from-indigo-500 to-violet-600
                           hover:from-indigo-400 hover:to-violet-500
                           disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                           shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40
                           transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99]"
                >
                  {file ? '🔍 Analyze Build Log' : 'Select a file to begin'}
                </button>
              </div>

              <div className="space-y-6">
                <AIConfigPanel
                  config={aiConfig}
                  onConfigChange={setAIConfig}
                  disabled={isAnalyzing}
                />

                <AnalysisHistory
                  history={history}
                  onLoad={loadFromHistory}
                  onClear={clearHistory}
                />
              </div>
            </div>
          </div>
        )}

        {/* Progress View */}
        {showProgressView && progress && (
          <div className="max-w-2xl mx-auto space-y-6">
            <ProgressTracker progress={progress} />

            {/* Skeleton loading for cases */}
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-700 rounded w-3/4" />
                      <div className="h-3 bg-slate-700/50 rounded w-1/2" />
                    </div>
                    <div className="h-5 w-16 bg-slate-700 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Result View */}
        {showResultView && result && (
          <div className="space-y-6">
            {/* Summary */}
            <SummaryCards result={result} />

            {/* Failure Summary List */}
            <FailureSummary result={result} />

            {/* AI Fix Suggestions Panel */}
            <div className="bg-gradient-to-r from-indigo-500/10 to-violet-500/10 backdrop-blur rounded-2xl border border-indigo-500/20 p-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                    <span>🤖</span>
                    AI Fix Suggestions
                    <span className="text-xs font-normal text-slate-400">(1 batched API call)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Analysis was done locally. Click below to get AI-powered fix suggestions for {result.summary.failed + result.summary.errors} failed case(s).
                  </p>
                </div>
                <button
                  id="get-ai-fixes"
                  onClick={fetchFixSuggestions}
                  disabled={isLoadingFixes || (result.summary.failed + result.summary.errors) === 0}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white text-sm
                           bg-gradient-to-r from-indigo-500 to-violet-600
                           hover:from-indigo-400 hover:to-violet-500
                           disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                           shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40
                           transition-all duration-200"
                >
                  {isLoadingFixes ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading Fixes...
                    </>
                  ) : (
                    '🤖 Get AI Fix Suggestions'
                  )}
                </button>
              </div>

              {/* Fix progress */}
              {fixProgress && (
                <p className="mt-3 text-xs text-indigo-300/80">{fixProgress}</p>
              )}

              {/* Fix error */}
              {fixError && (
                <div className="mt-3 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-xs text-red-300">{fixError}</p>
                </div>
              )}
            </div>

            {/* Chart + Diff */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TrendChart cases={result.cases} onCategoryClick={handleCategoryClick} />

              {/* Cascading groups summary */}
              {result.cascadingGroups.length > 0 && (
                <div className="bg-slate-800/60 backdrop-blur rounded-2xl border border-slate-700/50 p-5">
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
                    Cascading Groups — Fix 1 → Unblock N
                  </h3>
                  <div className="space-y-3">
                    {result.cascadingGroups.map((group) => (
                      <div
                        key={group.groupId}
                        className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-3"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-violet-400 text-sm">🔗</span>
                          <span className="text-sm font-medium text-violet-300">{group.groupId}</span>
                          <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-xs font-mono">
                            {group.affectedTestIds.length} tests
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 ml-6">{group.rootCause}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Filters + Search + Export */}
            <div className="bg-slate-800/40 backdrop-blur rounded-2xl border border-slate-700/50 p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <FilterBar
                  activeStatusFilter={statusFilter}
                  activeCategoryFilter={categoryFilter}
                  activeSeverityFilter={severityFilter}
                  flakyOnly={flakyOnly}
                  cascadingOnly={cascadingOnly}
                  availableCategories={availableCategories}
                  onStatusChange={setStatusFilter}
                  onCategoryChange={setCategoryFilter}
                  onSeverityChange={setSeverityFilter}
                  onFlakyToggle={() => setFlakyOnly(!flakyOnly)}
                  onCascadingToggle={() => setCascadingOnly(!cascadingOnly)}
                  activeFilterCount={activeFilterCount}
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <SearchBar
                    value={searchQuery}
                    onChange={setSearchQuery}
                    resultCount={filteredCases.length}
                    totalCount={result.cases.length}
                  />
                </div>
                <ExportBar result={result} />
                <DiffUpload currentResult={result} onDiffResult={setDiffResult} />
              </div>
            </div>

            {/* Diff View */}
            {diffResult && (
              <DiffView diff={diffResult} />
            )}

            {/* Case List */}
            <CaseList cases={filteredCases} />
          </div>
        )}

        {/* Empty state for no results after analysis */}
        {result && result.cases.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-24 h-24 text-slate-600 mb-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <h3 className="text-xl font-semibold text-slate-300 mb-2">No test cases found</h3>
            <p className="text-slate-500 max-w-md">
              The log file was analyzed but no test cases were identified. This could mean:
            </p>
            <ul className="mt-3 text-sm text-slate-400 space-y-1 text-left">
              <li>• The log format isn't supported (try Jenkins console output)</li>
              <li>• The build didn't reach the test phase</li>
              <li>• Tests use a non-standard reporter</li>
              <li>• Try enabling verbose logging with <code className="font-mono text-indigo-400">-X</code> flag</li>
            </ul>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-6 border-t border-slate-800 text-center">
          <p className="text-xs text-slate-600">
            Jenkins Log Analyzer · Built with React + Express
          </p>
        </footer>
      </div>
    </div>
  );
}
