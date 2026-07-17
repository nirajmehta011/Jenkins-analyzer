import type { TestCase, TestStatus, Confidence } from '../types/analysis';

/**
 * Strip ANSI escape codes from raw log text.
 * Remove Maven download lines and progress bars.
 * Collapse excessive blank lines.
 */
export function preprocessLog(rawText: string): string {
  let text = rawText;

  // Strip ANSI escape codes
  text = text.replace(/\x1B\[[0-9;]*m/g, '');

  // Remove Maven download lines
  text = text.replace(/^Downloading:.*\n/gm, '');

  // Remove Maven progress bars
  text = text.replace(/^\[INFO\] Progress.*\n/gm, '');

  // Remove Maven download progress indicators (e.g., "Downloaded from ...")
  text = text.replace(/^Downloaded from .*\n/gm, '');

  // Remove Maven transfer progress lines (e.g., "Progress (1): ...")
  text = text.replace(/^Progress \(\d+\):.*\n/gm, '');

  // Collapse 3+ consecutive blank lines to a single blank line
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Extract embedded Surefire XML test results from log text.
 * Returns partial TestCase objects parsed from XML content.
 */
export function extractSurefireXml(text: string): TestCase[] {
  const cases: TestCase[] = [];

  // Look for embedded XML test results (Surefire format)
  // Pattern: <testsuite ...> ... </testsuite>
  const suitePattern = /<testsuite[^>]*>([\s\S]*?)<\/testsuite>/g;
  let suiteMatch: RegExpExecArray | null;

  while ((suiteMatch = suitePattern.exec(text)) !== null) {
    const suiteContent = suiteMatch[0];

    // Extract suite name
    const suiteNameMatch = suiteContent.match(/name="([^"]+)"/);
    const suiteName = suiteNameMatch ? suiteNameMatch[1] : null;

    // Extract individual test cases
    const testcasePattern = /<testcase\s+([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let tcMatch: RegExpExecArray | null;

    while ((tcMatch = testcasePattern.exec(suiteContent)) !== null) {
      const attrs = tcMatch[1];
      const body = tcMatch[2] || '';

      const nameMatch = attrs.match(/name="([^"]+)"/);
      const classnameMatch = attrs.match(/classname="([^"]+)"/);
      const timeMatch = attrs.match(/time="([^"]+)"/);

      const testName = nameMatch ? nameMatch[1] : 'unknown';

      // Determine status
      let status: TestStatus = 'PASSED';
      let errorMessage: string | null = null;
      let exceptionType: string | null = null;

      const failureMatch = body.match(/<failure[^>]*(?:message="([^"]*)")?[^>]*(?:type="([^"]*)")?[^>]*>([\s\S]*?)<\/failure>/);
      const errorMatch = body.match(/<error[^>]*(?:message="([^"]*)")?[^>]*(?:type="([^"]*)")?[^>]*>([\s\S]*?)<\/error>/);
      const skippedMatch = body.match(/<skipped/);

      if (failureMatch) {
        status = 'FAILED';
        errorMessage = failureMatch[1] || failureMatch[3]?.trim() || null;
        exceptionType = failureMatch[2] || null;
      } else if (errorMatch) {
        status = 'ERROR';
        errorMessage = errorMatch[1] || errorMatch[3]?.trim() || null;
        exceptionType = errorMatch[2] || null;
      } else if (skippedMatch) {
        status = 'SKIPPED';
      }

      // Extract stack frames from error/failure body
      const stackBody = failureMatch?.[3] || errorMatch?.[3] || '';
      const stackFrames = stackBody
        .split('\n')
        .filter((line: string) => line.trim().startsWith('at '))
        .map((line: string) => line.trim())
        .slice(0, 20);

      const tc: TestCase = {
        id: `XML-${cases.length + 1}`,
        name: testName,
        suite: classnameMatch ? classnameMatch[1] : suiteName,
        status,
        duration: timeMatch ? `${timeMatch[1]}s` : null,
        isFlaky: false,
        isCascading: false,
        cascadeGroupId: null,
        exceptionType,
        errorMessage,
        stackFrames,
        rootCause: null,
        symptomVsCause: null,
        severity: null,
        category: null,
        fixSuggestion: null,
        fixComplexity: null,
        logEvidenceQuote: null,
        parserConfidence: 'MEDIUM' as Confidence,
        testUserEmail: null,
        relatedLinks: [],
        attemptCount: null,
        isHookFailure: false,
        evidenceContext: null,
      };

      cases.push(tc);
    }
  }

  return cases;
}
