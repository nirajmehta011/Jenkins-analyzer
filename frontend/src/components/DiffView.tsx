import type { DiffResult } from './DiffUpload';
import CaseCard from './CaseCard';

interface DiffViewProps {
  diff: DiffResult;
}

export default function DiffView({ diff }: DiffViewProps) {
  return (
    <div id="diff-view" className="space-y-6">
      {/* New failures */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider">
            New Failures ({diff.newFailures.length})
          </h3>
          <span className="text-xs text-slate-500">Introduced in your change</span>
        </div>
        {diff.newFailures.length > 0 ? (
          <div className="space-y-2 pl-5 border-l-2 border-red-500/30">
            {diff.newFailures.map((tc) => (
              <CaseCard key={tc.id} testCase={tc} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-emerald-400 pl-5 py-3">
            ✓ No new failures — your change did not introduce any new test failures!
          </p>
        )}
      </div>

      {/* Resolved */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider">
            Resolved ({diff.resolved.length})
          </h3>
          <span className="text-xs text-slate-500">No longer failing</span>
        </div>
        {diff.resolved.length > 0 ? (
          <div className="space-y-2 pl-5 border-l-2 border-emerald-500/30">
            {diff.resolved.map((tc) => (
              <div key={tc.id} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-emerald-300">{tc.name}</span>
                {tc.suite && <span className="text-xs text-slate-500 font-mono ml-1">({tc.suite})</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 pl-5 py-3">No previously failing tests were resolved.</p>
        )}
      </div>

      {/* Pre-existing */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">
            Pre-existing ({diff.preExisting.length})
          </h3>
          <span className="text-xs text-slate-500">Already failing before your change</span>
        </div>
        {diff.preExisting.length > 0 ? (
          <div className="space-y-2 pl-5 border-l-2 border-amber-500/30">
            {diff.preExisting.map((tc) => (
              <CaseCard key={tc.id} testCase={tc} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 pl-5 py-3">No pre-existing failures.</p>
        )}
      </div>
    </div>
  );
}
