import { useState } from 'react';
import type { AnalysisResult, TestCase } from '../types/analysis';

interface DiffUploadProps {
  onDiffResult: (result: DiffResult) => void;
  currentResult: AnalysisResult;
}

export interface DiffResult {
  newFailures: TestCase[];
  resolved: TestCase[];
  preExisting: TestCase[];
}

export default function DiffUpload({ onDiffResult, currentResult }: DiffUploadProps) {
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [previousResult, setPreviousResult] = useState<AnalysisResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handlePreviousFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as AnalysisResult;
      setPreviousResult(parsed);

      // Compute diff
      const currentFailedNames = new Set(
        currentResult.cases
          .filter((c) => c.status === 'FAILED' || c.status === 'ERROR')
          .map((c) => `${c.suite}::${c.name}`)
      );

      const previousFailedNames = new Set(
        parsed.cases
          .filter((c) => c.status === 'FAILED' || c.status === 'ERROR')
          .map((c) => `${c.suite}::${c.name}`)
      );

      const newFailures = currentResult.cases.filter(
        (c) =>
          (c.status === 'FAILED' || c.status === 'ERROR') &&
          !previousFailedNames.has(`${c.suite}::${c.name}`)
      );

      const resolved = parsed.cases.filter(
        (c) =>
          (c.status === 'FAILED' || c.status === 'ERROR') &&
          !currentFailedNames.has(`${c.suite}::${c.name}`)
      );

      const preExisting = currentResult.cases.filter(
        (c) =>
          (c.status === 'FAILED' || c.status === 'ERROR') &&
          previousFailedNames.has(`${c.suite}::${c.name}`)
      );

      onDiffResult({ newFailures, resolved, preExisting });
    } catch {
      alert('Could not parse previous analysis JSON. Please export a previous analysis as JSON first.');
    } finally {
      setIsUploading(false);
    }
  };

  if (!isDiffMode) {
    return (
      <button
        id="diff-mode-toggle"
        onClick={() => setIsDiffMode(true)}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300
                 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
      >
        📊 Compare with previous build
      </button>
    );
  }

  return (
    <div id="diff-upload" className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-300">Compare with Previous Build</h4>
        <button
          onClick={() => {
            setIsDiffMode(false);
            setPreviousResult(null);
          }}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Upload a previously exported JSON analysis to compare against the current results.
      </p>
      <label className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500/20 border border-indigo-500/30
                      text-indigo-300 text-sm cursor-pointer hover:bg-indigo-500/30 transition-colors">
        {isUploading ? (
          <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        )}
        {previousResult ? `Loaded: ${previousResult.filename}` : 'Upload previous analysis JSON'}
        <input
          type="file"
          accept=".json"
          onChange={handlePreviousFile}
          className="hidden"
        />
      </label>
    </div>
  );
}
