import { useState, useMemo } from 'react';
import type { TestCase } from '../types/analysis';
import CaseCard from './CaseCard';

interface CaseListProps {
  cases: TestCase[];
  selectedCaseIds?: Set<string>;
  onSelectionChange?: (caseId: string, selected: boolean) => void;
}

const CASES_PER_PAGE = 20;

export default function CaseList({ cases, selectedCaseIds = new Set(), onSelectionChange }: CaseListProps) {
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(cases.length / CASES_PER_PAGE);
  const paginatedCases = useMemo(
    () => cases.slice(page * CASES_PER_PAGE, (page + 1) * CASES_PER_PAGE),
    [cases, page]
  );

  if (cases.length === 0) {
    return (
      <div id="case-list-empty" className="flex flex-col items-center justify-center py-16 text-center">
        <svg className="w-20 h-20 text-slate-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
        <p className="text-slate-400 text-lg font-medium">No test cases match your filters</p>
        <p className="text-slate-500 text-sm mt-1">Try adjusting your filter criteria</p>
      </div>
    );
  }

  return (
    <div id="case-list" className="space-y-2">
      {paginatedCases.map((tc) => (
        <CaseCard
          key={tc.id}
          testCase={tc}
          isSelected={selectedCaseIds.has(tc.id)}
          onSelectionChange={(selected) => onSelectionChange?.(tc.id, selected)}
        />
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
          <p className="text-sm text-slate-500">
            Showing {page * CASES_PER_PAGE + 1}–{Math.min((page + 1) * CASES_PER_PAGE, cases.length)} of {cases.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg text-sm font-medium
                       bg-slate-800 text-slate-300 hover:bg-slate-700
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors"
            >
              ← Prev
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i;
                } else if (page < 3) {
                  pageNum = i;
                } else if (page > totalPages - 4) {
                  pageNum = totalPages - 7 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`
                      w-8 h-8 rounded-lg text-xs font-medium transition-colors
                      ${page === pageNum
                        ? 'bg-indigo-500 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }
                    `}
                  >
                    {pageNum + 1}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="px-3 py-1.5 rounded-lg text-sm font-medium
                       bg-slate-800 text-slate-300 hover:bg-slate-700
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
