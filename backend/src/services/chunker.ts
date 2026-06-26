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
 * Split a preprocessed log into chunks at suite boundaries.
 * Splits at Surefire suite lines ("Running com.example.FooTest")
 * and pytest session starts ("====== test session starts ======").
 * Overlaps the last 60 lines of each chunk into the start of the next
 * for context continuity. Never exceeds maxChars per chunk.
 */
export function chunkBySuiteBoundary(text: string, maxChars = 80000): string[] {
  const lines = text.split('\n');

  // Find suite boundary line indices
  const boundaryPattern = /^(?:Running \S+Test|={4,} test session starts)/;
  const boundaryIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (boundaryPattern.test(lines[i])) {
      boundaryIndices.push(i);
    }
  }

  // If no boundaries found or text is small enough, return as single chunk
  if (boundaryIndices.length === 0 || text.length <= maxChars) {
    // Still need to split by maxChars if text is too large
    if (text.length <= maxChars) {
      return [text];
    }
    return splitByCharLimit(lines, maxChars);
  }

  const segments: string[][] = [];
  let segStart = 0;

  for (const boundaryIdx of boundaryIndices) {
    if (boundaryIdx > segStart) {
      segments.push(lines.slice(segStart, boundaryIdx));
    }
    segStart = boundaryIdx;
  }
  // Last segment
  if (segStart < lines.length) {
    segments.push(lines.slice(segStart));
  }

  // Merge segments into chunks respecting maxChars
  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentCharCount = 0;

  for (const segment of segments) {
    const segmentText = segment.join('\n');
    const segmentCharCount = segmentText.length;

    if (currentCharCount + segmentCharCount > maxChars && currentLines.length > 0) {
      // Finalize current chunk
      chunks.push(currentLines.join('\n'));

      // Overlap: carry last 60 lines into next chunk
      const overlapLines = currentLines.slice(-60);
      currentLines = [...overlapLines, ...segment];
      currentCharCount = currentLines.join('\n').length;
    } else {
      currentLines.push(...segment);
      currentCharCount += segmentCharCount + 1; // +1 for newline
    }
  }

  // Finalize last chunk
  if (currentLines.length > 0) {
    chunks.push(currentLines.join('\n'));
  }

  // Final safety: split any chunk still exceeding maxChars
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > maxChars) {
      const subLines = chunk.split('\n');
      finalChunks.push(...splitByCharLimit(subLines, maxChars));
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}

/**
 * Split lines into chunks by character limit, with 60-line overlap.
 */
function splitByCharLimit(lines: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentCharCount = 0;

  for (const line of lines) {
    const lineLen = line.length + 1; // +1 for newline
    if (currentCharCount + lineLen > maxChars && currentLines.length > 0) {
      chunks.push(currentLines.join('\n'));
      const overlapLines = currentLines.slice(-60);
      currentLines = [...overlapLines];
      currentCharCount = currentLines.join('\n').length;
    }
    currentLines.push(line);
    currentCharCount += lineLen;
  }

  if (currentLines.length > 0) {
    chunks.push(currentLines.join('\n'));
  }

  return chunks;
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
      };

      cases.push(tc);
    }
  }

  return cases;
}

/**
 * Reduce a large log file by keeping only the headers, footers, suite starts,
 * and context windows (e.g. 40 lines before, 80 lines after) around failures and exceptions.
 * Inserts truncation markers for omitted lines.
 */
export function reduceLogToFailures(
  rawText: string,
  maxLogSizeThreshold = 200 * 1024,
  customFailureQueries?: string[]
): string {
  if (rawText.length <= maxLogSizeThreshold && (!customFailureQueries || customFailureQueries.length === 0)) {
    return rawText;
  }

  const lines = rawText.split('\n');
  const totalLines = lines.length;

  const keep = new Array<boolean>(totalLines).fill(false);

  // 1. Keep the header (first 200 lines)
  const headerSize = Math.min(200, totalLines);
  for (let i = 0; i < headerSize; i++) {
    keep[i] = true;
  }

  // 2. Keep the footer (last 300 lines)
  const footerSize = Math.min(300, totalLines);
  for (let i = totalLines - footerSize; i < totalLines; i++) {
    keep[i] = true;
  }

  // Failure/exception patterns
  const failurePatterns: RegExp[] = [
    /exception/i,
    /error/i,
    /failed/i,
    /failure/i,
    /cause/i,
    /fatal/i,
    /critical/i,
    /stack\s*trace/i,
    /stacktrace/i,
    /at\s+\S+\.\S+\(.*:\d+\)/,
    /running\s+\S+test/i,
    /===\s+test\s+session\s+starts\s+===/i,
    /testcase/i,
    /<failure/i,
    /<error/i,
    /\[error\]/i,
    /\[fail\]/i,
    /unhandledRejection/i,
    /uncaughtException/i,
    /timeout/i,
    /connection/i,
    /rejected/i,
    /assertion/i,
    /npm ERR!/i,
    /make: \*\*\*/i,
  ];

  if (customFailureQueries && customFailureQueries.length > 0) {
    for (const q of customFailureQueries) {
      if (q.trim()) {
        const escaped = q.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        failurePatterns.push(new RegExp(escaped, 'i'));
      }
    }
  }

  // 3. Mark lines matching patterns and their context windows
  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];
    let isMatch = false;

    for (const pattern of failurePatterns) {
      if (pattern.test(line)) {
        isMatch = true;
        break;
      }
    }

    if (isMatch) {
      const start = Math.max(0, i - 40);
      const end = Math.min(totalLines - 1, i + 80);
      for (let w = start; w <= end; w++) {
        keep[w] = true;
      }
    }
  }

  // 4. Construct the reduced log, inserting truncation markers
  const reducedParts: string[] = [];
  let omittedCount = 0;

  for (let i = 0; i < totalLines; i++) {
    if (keep[i]) {
      if (omittedCount > 0) {
        reducedParts.push(`\n... [TRUNCATED SUCCESS LOGS / BUILD NOISE: ${omittedCount} LINES OMITTED] ...\n`);
        omittedCount = 0;
      }
      reducedParts.push(lines[i]);
    } else {
      omittedCount++;
    }
  }

  if (omittedCount > 0) {
    reducedParts.push(`\n... [TRUNCATED SUCCESS LOGS / BUILD NOISE: ${omittedCount} LINES OMITTED] ...\n`);
  }

  return reducedParts.join('\n');
}

