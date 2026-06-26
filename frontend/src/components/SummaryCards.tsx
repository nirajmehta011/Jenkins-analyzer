import type { AnalysisResult } from '../types/analysis';

interface SummaryCardsProps {
  result: AnalysisResult;
}

export default function SummaryCards({ result }: SummaryCardsProps) {
  const { summary, cascadingGroups, buildSummary } = result;

  const cards = [
    {
      label: 'Total',
      value: summary.total,
      color: 'from-slate-500 to-slate-600',
      textColor: 'text-slate-100',
      bgColor: 'bg-slate-500/10',
      borderColor: 'border-slate-500/20',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
      ),
    },
    {
      label: 'Failed',
      value: summary.failed,
      color: 'from-red-500 to-rose-600',
      textColor: 'text-red-400',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/20',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Passed',
      value: summary.passed,
      color: 'from-emerald-500 to-green-600',
      textColor: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/20',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Skipped',
      value: summary.skipped,
      color: 'from-amber-500 to-yellow-600',
      textColor: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
        </svg>
      ),
    },
    {
      label: 'Flaky',
      value: summary.flaky,
      color: 'from-orange-500 to-amber-600',
      textColor: 'text-orange-400',
      bgColor: 'bg-orange-500/10',
      borderColor: 'border-orange-500/20',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      ),
    },
    {
      label: 'Cascade Groups',
      value: cascadingGroups.length,
      color: 'from-violet-500 to-purple-600',
      textColor: 'text-violet-400',
      bgColor: 'bg-violet-500/10',
      borderColor: 'border-violet-500/20',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
      ),
    },
  ];

  return (
    <div id="summary-cards">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`
              ${card.bgColor} ${card.borderColor}
              border rounded-xl p-4 transition-all duration-200 hover:scale-[1.02]
            `}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={card.textColor}>{card.icon}</span>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">{card.label}</span>
            </div>
            <p className={`text-2xl font-bold ${card.textColor}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Recommended first fix callout */}
      {buildSummary?.recommendedFirstFix && (
        <div className="mt-4 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-indigo-300">Recommended First Fix</p>
              <p className="text-sm text-slate-300 mt-1">{buildSummary.recommendedFirstFix}</p>
              {buildSummary.estimatedFixComplexity && (
                <span className={`
                  inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium
                  ${buildSummary.estimatedFixComplexity === 'LOW' ? 'bg-emerald-500/20 text-emerald-300' : ''}
                  ${buildSummary.estimatedFixComplexity === 'MEDIUM' ? 'bg-amber-500/20 text-amber-300' : ''}
                  ${buildSummary.estimatedFixComplexity === 'HIGH' ? 'bg-red-500/20 text-red-300' : ''}
                `}>
                  Complexity: {buildSummary.estimatedFixComplexity}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
