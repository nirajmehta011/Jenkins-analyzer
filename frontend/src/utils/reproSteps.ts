import type { TestCase } from '../types/analysis';

/**
 * Recognized user-facing action verbs from common Selenium/WebdriverIO/
 * Playwright-style wrapper libraries. Matched against a numbered
 * execution-step trace line to turn e.g.
 * `argusBrowser.click('[data-testid="X"]')` into `Click "[data-testid="X"]"`.
 *
 * Selectors frequently mix quote styles — e.g. a single-quoted call
 * argument containing a double-quoted attribute value, like
 * `'[data-testid="AppBarTitle"]'`. Each pattern captures the opening quote
 * character and requires the SAME character to close it (via backreference)
 * rather than stopping at the first quote of either type, which would
 * truncate exactly that shape of selector.
 *
 * A line that matches none of these is framework-internal bookkeeping
 * (snapshot copying, retry-policy logging, etc.) — not a reproduction step,
 * and deliberately dropped rather than shown as noise.
 */
const ACTION_PATTERNS: Array<{ pattern: RegExp; describe: (m: RegExpMatchArray) => string }> = [
  { pattern: /\.open\((['"])((?:(?!\1).)+)\1\)/, describe: (m) => `Navigate to ${m[2]}` },
  { pattern: /\.(?:click|tap)\((['"])((?:(?!\1).)+)\1\)/, describe: (m) => `Click "${m[2]}"` },
  {
    pattern: /\.(?:isVisible|waitUntilIsVisible)\((['"])((?:(?!\1).)+)\1\)(?:[^=]*=>\s*'([^']*)')?/,
    describe: (m) => `Verify "${m[2]}" is visible${m[3] === 'false' ? ' (was NOT visible — likely the point of failure)' : ''}`,
  },
  {
    pattern: /\.getText\((['"])((?:(?!\1).)+)\1[^)]*\)(?:[^=]*=>\s*'([^']*)')?/,
    describe: (m) => `Read text from "${m[2]}"${m[3] ? ` → "${m[3]}"` : ''}`,
  },
  {
    pattern: /\.(?:type|fill|sendKeys)\((['"])((?:(?!\1).)+)\1,\s*(['"])((?:(?!\3).)*)\3\)/,
    describe: (m) => `Type "${m[4]}" into "${m[2]}"`,
  },
  { pattern: /\.uploadFile\((['"])((?:(?!\1).)+)\1/, describe: (m) => `Upload a file to "${m[2]}"` },
  { pattern: /\.select\((['"])((?:(?!\1).)+)\1/, describe: (m) => `Select an option in "${m[2]}"` },
  { pattern: /\.hover\((['"])((?:(?!\1).)+)\1\)/, describe: (m) => `Hover over "${m[2]}"` },
  { pattern: /\.waitMs\((\d+)\)/, describe: (m) => `WAIT_MS:${m[1]}` },
];

const WAIT_STEP = /^WAIT_MS:(\d+)$/;

function matchAction(rawLine: string): string | null {
  const withoutNumber = rawLine.replace(/^\d+\)\s*/, '');
  for (const { pattern, describe } of ACTION_PATTERNS) {
    const m = withoutNumber.match(pattern);
    if (m) return describe(m);
  }
  return null;
}

/** Collapse consecutive "wait" steps into one summary line instead of a
 * repetitive list of individual waits, which adds noise without adding
 * reproduction value. */
function collapseWaits(steps: string[]): string[] {
  const result: string[] = [];
  let waitTotal = 0;
  let waitCount = 0;

  const flushWaits = () => {
    if (waitCount === 0) return;
    result.push(
      waitCount === 1 ? `Wait ${waitTotal}ms` : `Wait for the page to load/stabilize (~${waitTotal}ms across ${waitCount} waits)`
    );
    waitTotal = 0;
    waitCount = 0;
  };

  for (const step of steps) {
    const waitMatch = step.match(WAIT_STEP);
    if (waitMatch) {
      waitTotal += parseInt(waitMatch[1], 10);
      waitCount += 1;
    } else {
      flushWaits();
      result.push(step);
    }
  }
  flushWaits();

  return result;
}

export interface ReproSteps {
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  actualResult: string;
}

/**
 * Build a proper Preconditions / Steps / Expected / Actual reproduction
 * from a failure's extracted evidence. Only includes steps recognized as
 * genuine user-facing actions — framework-internal log lines are dropped
 * rather than shown as if they were reproduction-relevant. Never fabricates
 * a step that wasn't actually captured.
 */
export function generateReproSteps(tc: TestCase): ReproSteps {
  const preconditions: string[] = [];
  if (tc.testUserEmail) preconditions.push(`Logged in as ${tc.testUserEmail}`);
  if (tc.evidenceContext?.pageUrl) preconditions.push(`Environment: ${tc.evidenceContext.pageUrl}`);

  const rawCandidates = tc.evidenceContext?.precedingSteps ?? [];
  const humanized = rawCandidates
    .map(matchAction)
    .filter((s): s is string => s !== null);

  const collected: string[] = [];
  const seen = new Set<string>();

  // Lead with an explicit navigation step when we know the page and the
  // trace itself didn't already capture an "open" call — the single most
  // useful first step for someone reproducing manually.
  if (tc.evidenceContext?.pageUrl && !humanized.some((s) => s.startsWith('Navigate to'))) {
    const navStep = `Navigate to ${tc.evidenceContext.pageUrl}`;
    collected.push(navStep);
    seen.add(navStep);
  }

  for (const h of humanized) {
    if (!seen.has(h)) {
      seen.add(h);
      collected.push(h);
    }
  }

  const steps = collapseWaits(collected);

  if (steps.length === 0) {
    steps.push(
      'No clear user-facing actions were captured in the log for this failure — see the log evidence below for full context.'
    );
  }

  const expectedResult = tc.evidenceContext?.expected ?? 'The test should complete without failure';
  const actualResult =
    tc.evidenceContext?.received ?? (tc.errorMessage ? tc.errorMessage.split('\n')[0] : 'See error message below');

  return { preconditions, steps, expectedResult, actualResult };
}
