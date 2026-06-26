import type { AnalysisResult } from '../types/analysis';
import { useExport } from '../hooks/useExport';
import { useState } from 'react';

interface ExportBarProps {
  result: AnalysisResult;
}

export default function ExportBar({ result }: ExportBarProps) {
  const { exportJSON, exportCSV, exportMarkdown } = useExport();
  const [toast, setToast] = useState<string | null>(null);

  const handleExport = (type: 'json' | 'csv' | 'md') => {
    try {
      if (type === 'json') exportJSON(result);
      else if (type === 'csv') exportCSV(result);
      else exportMarkdown(result);

      setToast(`Exported as ${type.toUpperCase()}`);
      setTimeout(() => setToast(null), 2500);
    } catch {
      setToast('Export failed');
      setTimeout(() => setToast(null), 2500);
    }
  };

  return (
    <div id="export-bar" className="relative">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Export</span>
        <button
          id="export-json"
          onClick={() => handleExport('json')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300
                   hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
        >
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            JSON
          </span>
        </button>
        <button
          id="export-csv"
          onClick={() => handleExport('csv')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300
                   hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
        >
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            CSV
          </span>
        </button>
        <button
          id="export-markdown"
          onClick={() => handleExport('md')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300
                   hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
        >
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Markdown
          </span>
        </button>
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg
                      bg-emerald-500/20 text-emerald-300 text-xs font-medium border border-emerald-500/30
                      animate-fade-in whitespace-nowrap">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
