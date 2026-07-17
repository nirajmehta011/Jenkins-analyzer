import { useCallback } from 'react';
import type { AnalysisResult, TestCase } from '../types/analysis';
import { formatDate } from '../utils/formatters';

interface FailureSummaryProps {
  result: AnalysisResult;
}

export function getConciseReason(tc: TestCase): string {
  if (tc.symptomVsCause && tc.symptomVsCause.symptom) {
    const lines = tc.symptomVsCause.symptom.split('\n');
    // "Primary Failure Message" reflects the Main Run (first attempt) —
    // more representative than the final attempt when retries fail for
    // unrelated downstream reasons. "Final Failure Message" is matched too,
    // for analyses saved before this field was renamed.
    const msgLine = lines.find(l =>
      l.includes('Primary Failure Message:') || l.startsWith('• Primary Failure Message:') ||
      l.includes('Final Failure Message:') || l.startsWith('• Final Failure Message:') ||
      l.startsWith('Message:')
    );
    if (msgLine) {
      const clean = msgLine.replace(/^•?\s*(Primary Failure Message:|Final Failure Message:|Message:)\s*/i, '').trim();
      if (clean) return clean;
    }
  }

  if (tc.errorMessage) {
    const lines = tc.errorMessage.split('\n');
    const cleanLine = lines[0].replace(/^Failed persistently after \d+ attempts \(.*?\):/i, '').trim();
    if (cleanLine) return cleanLine;
    return lines[1] ? lines[1].trim() : lines[0];
  }

  return 'Test case execution failed (check log evidence).';
}

/** Cascade-group lookup: groupId -> number of other tests sharing that root cause. */
function buildCascadeSizes(result: AnalysisResult): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const group of result.cascadingGroups) {
    sizes.set(group.groupId, group.affectedTestIds.length);
  }
  return sizes;
}

export default function FailureSummary({ result }: FailureSummaryProps) {
  const failedCases = result.cases.filter(
    (c) => c.status === 'FAILED' || c.status === 'ERROR'
  );
  const cascadeSizes = buildCascadeSizes(result);

  const downloadSummaryMD = useCallback(() => {
    const lines: string[] = [];
    lines.push(`# Failure Summary Report — ${result.filename}`);
    lines.push(`Analyzed At: ${formatDate(result.analyzedAt)}`);
    lines.push(`Total Failed/Error Cases: ${failedCases.length}`);
    lines.push('');
    lines.push(`| ID | Test Name | Suite | Category | Severity | Flags | Attempts | Test User | Failure Reason | Expected | Received | Page | Analysed Root Cause | Related Links | Log Evidence |`);
    lines.push(`|----|-----------|-------|----------|----------|-------|----------|-----------|-----------------|----------|----------|------|----------------------|----------------|--------------|`);

    for (const tc of failedCases) {
      const reason = getConciseReason(tc).replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const evidence = (tc.logEvidenceQuote || '').replace(/\|/g, '\\|').replace(/\n/g, ' <br> ');
      const cause = (tc.symptomVsCause?.cause || tc.rootCause || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const flags = [
        tc.isHookFailure ? 'Setup Hook' : null,
        tc.isFlaky ? 'Flaky' : null,
        tc.isCascading ? `Cascade (${tc.cascadeGroupId})` : null,
      ].filter(Boolean).join(', ');
      const links = tc.relatedLinks.map(l => `[${l.label}](${l.url})`).join(' ');
      const expected = (tc.evidenceContext?.expected || '').replace(/\|/g, '\\|');
      const received = (tc.evidenceContext?.received || '').replace(/\|/g, '\\|');
      const pageUrl = tc.evidenceContext?.pageUrl || '';
      lines.push(
        `| ${tc.id} | ${tc.name} | ${tc.suite || 'DefaultSuite'} | ${tc.category || 'Unknown'} | ${tc.severity || 'LOW'} | ${flags} | ${tc.attemptCount ?? ''} | ${tc.testUserEmail || ''} | ${reason} | ${expected} | ${received} | ${pageUrl} | ${cause} | ${links} | ${evidence} |`
      );
    }

    lines.push('');
    lines.push(`---`);
    lines.push(`Report generated locally by Jenkins Log Analyzer.`);

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `failure-summary-${result.filename.replace(/\.[^/.]+$/, "")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, failedCases]);

  const downloadSummaryCSV = useCallback(() => {
    const headers = [
      'ID', 'Test Case', 'Suite', 'Severity', 'Category', 'Setup Hook Failure', 'Flaky', 'Cascade Group',
      'Attempts', 'Test User Email', 'Thorough Failure Reason', 'Expected', 'Received', 'Page URL',
      'Analysed Root Cause', 'Related Links', 'Log Evidence'
    ];

    const escapeCSV = (val: string | number | null | boolean): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = failedCases.map((tc: TestCase) => {
      const reason = getConciseReason(tc);
      const evidence = tc.logEvidenceQuote || '';
      const cause = tc.symptomVsCause?.cause || tc.rootCause || '';
      const links = tc.relatedLinks.map(l => `${l.label}: ${l.url}`).join(' | ');
      return [
        tc.id,
        tc.name,
        tc.suite || 'DefaultSuite',
        tc.severity || 'LOW',
        tc.category || 'Unknown',
        tc.isHookFailure ? 'Yes' : 'No',
        tc.isFlaky ? 'Yes' : 'No',
        tc.isCascading ? (tc.cascadeGroupId || 'Yes') : 'No',
        tc.attemptCount ?? '',
        tc.testUserEmail || '',
        reason,
        tc.evidenceContext?.expected || '',
        tc.evidenceContext?.received || '',
        tc.evidenceContext?.pageUrl || '',
        cause,
        links,
        evidence,
      ].map(escapeCSV).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `failure-summary-${result.filename.replace(/\.[^/.]+$/, "")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, failedCases]);

  if (failedCases.length === 0) return null;

  return (
    <div className="bg-slate-800/60 backdrop-blur rounded-2xl border border-slate-700/50 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Quick Failure Summary List
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Everything QE needs to triage at a glance: {failedCases.length} failed test case{failedCases.length === 1 ? '' : 's'} —
            root reason, blast radius, who/what it ran against, and direct links to evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadSummaryMD}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-200
                     bg-slate-700 hover:bg-slate-600 transition-colors border border-slate-600"
            title="Download Summary Report as Markdown"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download MD
          </button>
          <button
            onClick={downloadSummaryCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-200
                     bg-slate-700 hover:bg-slate-600 transition-colors border border-slate-600"
            title="Download Summary as CSV"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700/40">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/50 text-slate-400 text-xs font-semibold uppercase border-b border-slate-700/50">
              <th className="py-3 px-4 w-16">ID</th>
              <th className="py-3 px-4 w-1/5">Test Case</th>
              <th className="py-3 px-4">Failure Reason</th>
              <th className="py-3 px-4 w-[15%]">Debug Info</th>
              <th className="py-3 px-4 w-1/4">Log Evidence (Context)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm text-slate-300">
            {failedCases.map((tc) => {
              const cascadeSize = tc.cascadeGroupId ? cascadeSizes.get(tc.cascadeGroupId) : undefined;
              return (
                <tr key={tc.id} className={`hover:bg-slate-800/35 transition-colors ${tc.isHookFailure ? 'bg-red-500/[0.03]' : ''}`}>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-400 font-semibold align-top">{tc.id}</td>
                  <td className="py-3.5 px-4 align-top">
                    <div className="font-semibold text-slate-200 break-words">{tc.name}</div>
                    {tc.suite && (
                      <div className="text-xs text-slate-500 font-mono mt-0.5 break-all">{tc.suite}</div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tc.isHookFailure && (
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-red-600/20 text-red-300 border border-red-500/40"
                          title="Setup/teardown hook failure — may block every other test in this suite"
                        >
                          ⚙ Setup Hook
                        </span>
                      )}
                      <span className={`
                        inline-block px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase
                        ${tc.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-400 border border-red-500/25' :
                          tc.severity === 'HIGH' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/25' :
                          tc.severity === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/25' :
                          'bg-slate-500/10 text-slate-400 border border-slate-500/25'}
                      `}>
                        {tc.severity || 'LOW'}
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded text-[9px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600/30">
                        {tc.category || 'Unknown'}
                      </span>
                      {tc.isFlaky && (
                        <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-orange-500/10 text-orange-400 border border-orange-500/25">
                          ⚠ Flaky
                        </span>
                      )}
                      {tc.attemptCount !== null && tc.attemptCount > 1 && (
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[9px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600/30"
                          title="Number of execution attempts detected in this log"
                        >
                          🔁 {tc.attemptCount}×
                        </span>
                      )}
                    </div>
                    {tc.isCascading && (
                      <div className="mt-1.5 text-[11px] text-violet-300/90">
                        🔗 Same root cause as {cascadeSize ? cascadeSize - 1 : 'other'} more test{cascadeSize && cascadeSize - 1 === 1 ? '' : 's'} — fix once to unblock all
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4 align-top">
                    <div className="font-medium text-red-200/90 break-words whitespace-pre-wrap leading-relaxed">
                      {getConciseReason(tc)}
                    </div>
                    {tc.symptomVsCause?.cause && (
                      <div className="mt-2 text-xs text-slate-400 border-t border-slate-700/40 pt-2 leading-relaxed">
                        <strong className="text-indigo-400 font-medium">Analysed Cause:</strong> {tc.symptomVsCause.cause}
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4 align-top">
                    <div className="flex flex-col gap-1.5">
                      {tc.testUserEmail && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 break-all">
                          👤 {tc.testUserEmail}
                        </span>
                      )}
                      {tc.relatedLinks.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {tc.relatedLinks.map((link) => (
                            <a
                              key={link.url}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200 hover:underline truncate"
                            >
                              🔗 {link.label}
                            </a>
                          ))}
                        </div>
                      ) : !tc.testUserEmail ? (
                        <span className="text-[11px] text-slate-600 italic">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 align-top">
                    <div className="space-y-1.5">
                      {tc.evidenceContext && (tc.evidenceContext.expected || tc.evidenceContext.received) && (
                        <div className="font-mono text-[11px] leading-relaxed">
                          <span className="text-emerald-400/90">{tc.evidenceContext.expected ?? '—'}</span>
                          <span className="text-slate-600 mx-1">→</span>
                          <span className="text-red-300">{tc.evidenceContext.received ?? '—'}</span>
                        </div>
                      )}
                      {tc.evidenceContext?.pageUrl && (
                        <p className="text-[10px] text-slate-500 truncate" title={tc.evidenceContext.pageUrl}>
                          🌐 {tc.evidenceContext.pageUrl.replace(/^https?:\/\//, '')}
                        </p>
                      )}
                      {tc.logEvidenceQuote ? (
                        <pre className="font-mono text-[11px] text-amber-200 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5 overflow-x-auto max-h-36 whitespace-pre-wrap break-words">
                          {tc.logEvidenceQuote}
                        </pre>
                      ) : !tc.evidenceContext ? (
                        <span className="text-xs text-slate-500 italic">No log evidence available</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
