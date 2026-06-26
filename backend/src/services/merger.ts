import type {
  AnalysisResult,
  TestCase,
  CascadingGroup,
  BuildSummary,
} from '../types/analysis';

/**
 * Merge multiple partial chunk results into a single unified AnalysisResult.
 * Deduplicates test cases by (name + suite) composite key, preferring entries
 * with more populated fields. Merges cascading groups and uses buildSummary
 * from the last chunk that provides one.
 */
export function mergeChunkResults(
  partials: Partial<AnalysisResult>[],
  filename: string,
  analysisId: string
): AnalysisResult {
  const caseMap = new Map<string, TestCase>();
  const groupMap = new Map<string, CascadingGroup>();
  let buildSummary: BuildSummary | null = null;

  for (const partial of partials) {
    // Merge test cases
    if (partial.cases) {
      for (const tc of partial.cases) {
        const key = compositeKey(tc.name, tc.suite);
        const existing = caseMap.get(key);

        if (!existing) {
          caseMap.set(key, tc);
        } else {
          // Prefer the entry with more fields filled
          caseMap.set(key, mergeTestCases(existing, tc));
        }
      }
    }

    // Merge cascading groups
    if (partial.cascadingGroups) {
      for (const group of partial.cascadingGroups) {
        const existing = groupMap.get(group.groupId);
        if (!existing) {
          groupMap.set(group.groupId, group);
        } else {
          // Merge affected test IDs
          const mergedIds = new Set([
            ...existing.affectedTestIds,
            ...group.affectedTestIds,
          ]);
          groupMap.set(group.groupId, {
            ...existing,
            affectedTestIds: Array.from(mergedIds),
            rootCause: group.rootCause || existing.rootCause,
          });
        }
      }
    }

    // Use buildSummary from the last chunk that has one
    if (partial.buildSummary) {
      buildSummary = partial.buildSummary;
    }
  }

  // Assign sequential IDs: TC-001, TC-002, ...
  const cases = Array.from(caseMap.values());
  cases.forEach((tc, idx) => {
    tc.id = `TC-${String(idx + 1).padStart(3, '0')}`;
  });

  // Update cascading group affected test IDs to use new IDs
  const nameToId = new Map<string, string>();
  for (const tc of cases) {
    nameToId.set(compositeKey(tc.name, tc.suite), tc.id);
  }

  const cascadingGroups = Array.from(groupMap.values()).map((group) => ({
    ...group,
    affectedTestIds: group.affectedTestIds
      .map((oldId) => {
        // Try to find the test by old ID match or by name
        for (const tc of cases) {
          if (tc.id === oldId || tc.name === oldId) {
            return tc.id;
          }
        }
        return oldId;
      }),
  }));

  // Compute summary counts
  const summary = {
    total: cases.length,
    failed: cases.filter((c) => c.status === 'FAILED').length,
    passed: cases.filter((c) => c.status === 'PASSED').length,
    skipped: cases.filter((c) => c.status === 'SKIPPED').length,
    errors: cases.filter((c) => c.status === 'ERROR').length,
    flaky: cases.filter((c) => c.isFlaky).length,
  };

  return {
    id: analysisId,
    filename,
    analyzedAt: new Date().toISOString(),
    totalChunks: partials.length,
    buildSummary,
    cascadingGroups,
    cases,
    summary,
  };
}

/**
 * Create a composite key for deduplication.
 */
function compositeKey(name: string, suite: string | null): string {
  return `${suite || ''}::${name}`;
}

/**
 * Merge two TestCase entries, preferring the one with more data.
 */
function mergeTestCases(a: TestCase, b: TestCase): TestCase {
  const scoreA = fieldScore(a);
  const scoreB = fieldScore(b);

  const primary = scoreB > scoreA ? b : a;
  const secondary = scoreB > scoreA ? a : b;

  return {
    ...primary,
    // Fill in any null fields from secondary
    rootCause: primary.rootCause || secondary.rootCause,
    errorMessage: primary.errorMessage || secondary.errorMessage,
    exceptionType: primary.exceptionType || secondary.exceptionType,
    symptomVsCause: primary.symptomVsCause || secondary.symptomVsCause,
    severity: primary.severity || secondary.severity,
    category: primary.category || secondary.category,
    fixSuggestion: primary.fixSuggestion || secondary.fixSuggestion,
    fixComplexity: primary.fixComplexity || secondary.fixComplexity,
    logEvidenceQuote: primary.logEvidenceQuote || secondary.logEvidenceQuote,
    stackFrames:
      primary.stackFrames.length >= secondary.stackFrames.length
        ? primary.stackFrames
        : secondary.stackFrames,
  };
}

/**
 * Score how many fields are populated on a TestCase.
 */
function fieldScore(tc: TestCase): number {
  let score = 0;
  if (tc.rootCause) score += 2;
  if (tc.errorMessage) score += 1;
  if (tc.exceptionType) score += 1;
  if (tc.symptomVsCause) score += 2;
  if (tc.severity) score += 1;
  if (tc.category) score += 1;
  if (tc.fixSuggestion) score += 2;
  if (tc.fixComplexity) score += 1;
  if (tc.logEvidenceQuote) score += 2;
  if (tc.stackFrames.length > 0) score += tc.stackFrames.length;
  return score;
}
