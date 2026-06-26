interface ProgressTrackerProps {
  progress: {
    stage: string;
    pct: number;
    message: string;
    chunk?: number;
    totalChunks?: number;
  };
}

const STAGES = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'preprocessing', label: 'Preprocessing' },
  { key: 'chunking', label: 'Chunking' },
  { key: 'analyzing', label: 'Analyzing' },
  { key: 'merging', label: 'Merging' },
  { key: 'done', label: 'Complete' },
];

export default function ProgressTracker({ progress }: ProgressTrackerProps) {
  const currentStageIndex = STAGES.findIndex((s) => s.key === progress.stage);

  return (
    <div id="progress-tracker" className="bg-slate-800/60 backdrop-blur rounded-2xl border border-slate-700/50 p-6">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-slate-300">{progress.message}</span>
          <span className="text-sm font-mono text-indigo-400">{progress.pct}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>

      {/* Stage list */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STAGES.map((stage, index) => {
          const isActive = stage.key === progress.stage;
          const isComplete = index < currentStageIndex;
          const isFuture = index > currentStageIndex;

          return (
            <div key={stage.key} className="flex items-center gap-2">
              <div className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                transition-all duration-300 whitespace-nowrap
                ${isActive ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40' : ''}
                ${isComplete ? 'bg-emerald-500/10 text-emerald-400' : ''}
                ${isFuture ? 'bg-slate-700/30 text-slate-500' : ''}
              `}>
                {isComplete && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isActive && (
                  <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                )}
                {stage.label}
                {isActive && progress.chunk && progress.totalChunks && (
                  <span className="text-indigo-400 font-mono">
                    {progress.chunk}/{progress.totalChunks}
                  </span>
                )}
              </div>
              {index < STAGES.length - 1 && (
                <div className={`w-4 h-px ${isComplete ? 'bg-emerald-500/40' : 'bg-slate-700'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
