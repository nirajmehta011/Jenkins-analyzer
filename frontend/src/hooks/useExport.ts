import { useCallback } from 'react';
import type { AnalysisResult, TestCase } from '../types/analysis';
import { formatDate } from '../utils/formatters';

interface UseExportReturn {
  exportJSON: (result: AnalysisResult) => void;
  exportCSV: (result: AnalysisResult) => void;
  exportMarkdown: (result: AnalysisResult) => void;
}

export function useExport(): UseExportReturn {
  const download = useCallback((content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const exportJSON = useCallback((result: AnalysisResult) => {
    const json = JSON.stringify(result, null, 2);
    download(json, `jenkins-analysis-${result.id.slice(0, 8)}.json`, 'application/json');
  }, [download]);

  const exportCSV = useCallback((result: AnalysisResult) => {
    const headers = [
      'id', 'name', 'suite', 'status', 'severity', 'category',
      'isFlaky', 'isCascading', 'errorMessage', 'rootCause',
      'fixSuggestion', 'fixComplexity', 'duration',
    ];

    const escapeCSV = (val: string | null | boolean): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = result.cases.map((tc: TestCase) =>
      [
        tc.id, tc.name, tc.suite, tc.status, tc.severity, tc.category,
        tc.isFlaky, tc.isCascading, tc.errorMessage, tc.rootCause,
        tc.fixSuggestion, tc.fixComplexity, tc.duration,
      ].map(escapeCSV).join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');
    download(csv, `jenkins-analysis-${result.id.slice(0, 8)}.csv`, 'text/csv');
  }, [download]);

  const exportMarkdown = useCallback((result: AnalysisResult) => {
    const lines: string[] = [];

    lines.push(`# Jenkins Analysis — ${result.filename} — ${formatDate(result.analyzedAt)}`);
    lines.push('');

    // Build Summary
    if (result.buildSummary) {
      const bs = result.buildSummary;
      lines.push('## Build Summary');
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| Status | ${bs.overallStatus} |`);
      if (bs.buildDuration) lines.push(`| Duration | ${bs.buildDuration} |`);
      if (bs.jdkVersion) lines.push(`| JDK | ${bs.jdkVersion} |`);
      if (bs.buildTool) lines.push(`| Build Tool | ${bs.buildTool} |`);
      if (bs.recommendedFirstFix) {
        lines.push('');
        lines.push(`> **Recommended First Fix:** ${bs.recommendedFirstFix}`);
        if (bs.estimatedFixComplexity) {
          lines.push(`> **Estimated Complexity:** ${bs.estimatedFixComplexity}`);
        }
      }
      lines.push('');
      if (bs.topFailureCategories.length > 0) {
        lines.push('### Top Failure Categories');
        lines.push('');
        for (const cat of bs.topFailureCategories) {
          lines.push(`- **${cat.category}**: ${cat.count} failures`);
        }
        lines.push('');
      }
    }

    // Test Summary
    lines.push('## Test Summary');
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total | ${result.summary.total} |`);
    lines.push(`| Passed | ${result.summary.passed} |`);
    lines.push(`| Failed | ${result.summary.failed} |`);
    lines.push(`| Errors | ${result.summary.errors} |`);
    lines.push(`| Skipped | ${result.summary.skipped} |`);
    lines.push(`| Flaky | ${result.summary.flaky} |`);
    lines.push('');

    // Cascading Groups
    if (result.cascadingGroups.length > 0) {
      lines.push('## Cascading Failure Groups');
      lines.push('');
      for (const group of result.cascadingGroups) {
        lines.push(`### Group: ${group.groupId}`);
        lines.push(`- **Root Cause:** ${group.rootCause}`);
        lines.push(`- **Affected Tests:** ${group.affectedTestIds.length}`);
        lines.push(`- **Fix Once:** ${group.fixOnce ? 'Yes' : 'No'}`);
        lines.push('');
      }
    }

    // Failed Cases
    const failedCases = result.cases.filter(
      (c) => c.status === 'FAILED' || c.status === 'ERROR'
    );
    if (failedCases.length > 0) {
      lines.push('## Failed Cases');
      lines.push('');
      for (const tc of failedCases) {
        lines.push(`### ${tc.id} — ${tc.name}`);
        lines.push('');
        if (tc.suite) lines.push(`**Suite:** ${tc.suite}`);
        lines.push(`**Status:** ${tc.status}`);
        if (tc.severity) lines.push(`**Severity:** ${tc.severity}`);
        if (tc.category) lines.push(`**Category:** ${tc.category}`);
        if (tc.duration) lines.push(`**Duration:** ${tc.duration}`);
        if (tc.isFlaky) lines.push(`**⚠️ Flaky Test**`);
        if (tc.isCascading) lines.push(`**🔗 Cascading (Group: ${tc.cascadeGroupId})**`);
        lines.push('');

        if (tc.errorMessage) {
          lines.push('**Error Message:**');
          lines.push('```');
          lines.push(tc.errorMessage);
          lines.push('```');
          lines.push('');
        }

        if (tc.symptomVsCause) {
          lines.push(`**Symptom:** ${tc.symptomVsCause.symptom}`);
          lines.push(`**Cause:** ${tc.symptomVsCause.cause}`);
          lines.push('');
        }

        if (tc.rootCause) {
          lines.push(`**Root Cause:** ${tc.rootCause}`);
          lines.push('');
        }

        if (tc.fixSuggestion) {
          lines.push(`**Fix Suggestion:** ${tc.fixSuggestion}`);
          if (tc.fixComplexity) lines.push(`**Fix Complexity:** ${tc.fixComplexity}`);
          lines.push('');
        }

        if (tc.stackFrames.length > 0) {
          lines.push('**Stack Trace:**');
          lines.push('```');
          lines.push(tc.stackFrames.slice(0, 5).join('\n'));
          lines.push('```');
          lines.push('');
        }

        if (tc.logEvidenceQuote) {
          lines.push(`> *Evidence:* ${tc.logEvidenceQuote}`);
          lines.push('');
        }

        lines.push('---');
        lines.push('');
      }
    }

    // Flaky Tests
    const flakyCases = result.cases.filter((c) => c.isFlaky);
    if (flakyCases.length > 0) {
      lines.push('## Flaky Tests');
      lines.push('');
      for (const tc of flakyCases) {
        lines.push(`- **${tc.name}** (${tc.suite || 'unknown suite'}) — ${tc.category || 'Unknown'}`);
      }
      lines.push('');
    }

    const md = lines.join('\n');
    download(md, `jenkins-analysis-${result.id.slice(0, 8)}.md`, 'text/markdown');
  }, [download]);

  return { exportJSON, exportCSV, exportMarkdown };
}
