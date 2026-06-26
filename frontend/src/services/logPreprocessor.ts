/**
 * Strip ANSI escape codes from log text for client-side preview.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Remove Maven download noise from log text.
 */
export function removeMavenNoise(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/^Downloading:.*\n/gm, '');
  cleaned = cleaned.replace(/^\[INFO\] Progress.*\n/gm, '');
  cleaned = cleaned.replace(/^Downloaded from .*\n/gm, '');
  cleaned = cleaned.replace(/^Progress \(\d+\):.*\n/gm, '');
  return cleaned;
}

/**
 * Collapse excessive blank lines.
 */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

/**
 * Full client-side preprocessing pipeline.
 */
export function preprocessLogClient(rawText: string): string {
  let text = stripAnsi(rawText);
  text = removeMavenNoise(text);
  text = collapseBlankLines(text);
  return text.trim();
}

/**
 * Estimate log complexity (how many test suites / failures are likely present).
 */
export function estimateLogComplexity(text: string): {
  estimatedSuites: number;
  estimatedFailures: number;
  lineCount: number;
  sizeBytes: number;
} {
  const lines = text.split('\n');
  const suiteMatches = text.match(/^Running \S+Test/gm) || [];
  const pytestMatches = text.match(/^={4,} test session starts/gm) || [];
  const failureIndicators = text.match(/\b(FAIL|FAILURE|ERROR|FAILED)\b/gi) || [];

  return {
    estimatedSuites: suiteMatches.length + pytestMatches.length,
    estimatedFailures: failureIndicators.length,
    lineCount: lines.length,
    sizeBytes: new Blob([text]).size,
  };
}
