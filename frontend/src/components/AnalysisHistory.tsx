import type { HistoryEntry } from '../types/analysis';
import { formatRelativeTime } from '../utils/formatters';

interface AnalysisHistoryProps {
  history: HistoryEntry[];
  onLoad: (id: string) => void;
  onClear: () => void;
}

export default function AnalysisHistory({ history, onLoad, onClear }: AnalysisHistoryProps) {
  if (history.length === 0) {
    return null;
  }

  return (
    <div id="analysis-history" className="bg-slate-800/60 backdrop-blur rounded-2xl border border-slate-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Recent Analyses
        </h3>
        <button
          onClick={onClear}
          className="text-xs text-slate-500 hover:text-red-400 transition-colors"
        >
          Clear history
        </button>
      </div>

      <div className="space-y-2">
        {history.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onLoad(entry.id)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-900/30
                     hover:bg-slate-700/50 transition-colors text-left group"
          >
            <div className={`
              w-8 h-8 rounded-lg flex items-center justify-center shrink-0
              ${entry.failedCount > 0 ? 'bg-red-500/20' : 'bg-emerald-500/20'}
            `}>
              <span className={`text-sm font-bold ${entry.failedCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {entry.failedCount}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-300 truncate group-hover:text-white transition-colors">
                {entry.filename}
              </p>
              <p className="text-xs text-slate-500">
                {formatRelativeTime(entry.analyzedAt)} · {entry.totalCount} total tests
              </p>
            </div>
            <svg className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0"
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
