import type {
  TestCase,
  TestStatus,
  Severity,
  Confidence,
  FailureCategory,
  SymptomVsCause,
  CascadingGroup,
  BuildSummary,
  AnalysisResult,
  EvidenceContext,
} from '../types/analysis';
import { v4 as uuidv4 } from 'uuid';

// ────────────────────────────────────────────────────────────────────────────
// 1. FRAMEWORK-SPECIFIC TEST BOUNDARY PATTERNS
// ────────────────────────────────────────────────────────────────────────────

interface RawTestBlock {
  name: string;
  suite: string | null;
  body: string;            // All text lines belonging to this test
  startLine: number;
  endLine: number;
}

// Playwright:  "  1) [chromium] › tests/login.spec.ts:12:5 › Login › should show error"
const PW_TEST_START = /^\s*\d+\)\s+\[.*?\]\s+›\s+(.+?)›\s+(.+?)$/;
// Playwright result line: "  1 passed", "  2 failed", etc.
const PW_RESULT_LINE = /^\s*(\d+)\s+(passed|failed|skipped|flaky)/i;

// JUnit / Surefire:  "Running com.example.FooTest"
const JUNIT_SUITE_START = /^Running\s+([\w.$]+)/;
// JUnit result:  "Tests run: 5, Failures: 1, Errors: 0, Skipped: 0"
const JUNIT_SUMMARY = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/;
// Surefire method-level failure:  "testFoo(com.example.FooTest)  Time elapsed: 0.012 s  <<< FAILURE!"
const SUREFIRE_METHOD_FAILURE = /^(\w+)\(([\w.$]+)\)\s+Time elapsed:[^<]*<<<\s*(FAILURE|ERROR)!?/;

// pytest:  "FAILED tests/test_auth.py::TestAuth::test_login - AssertionError"
const PYTEST_FAILED = /^FAILED\s+(.+?)(?:\s+-\s+(.+))?$/;
// pytest passed:  "PASSED tests/test_auth.py::test_foo"
const PYTEST_PASSED = /^PASSED\s+(.+)$/;

// Jest:  "  ● Auth Suite › should login successfully"
const JEST_FAIL = /^\s*●\s+(.+?)\s+›\s+(.+)$/;
// Jest pass:  "  ✓ should login (123 ms)"
const JEST_PASS = /^\s*[✓✔]\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/;

// Go test:  "--- FAIL: TestFoo (0.01s)"  or  "--- PASS: TestFoo (0.01s)"
const GO_TEST = /^---\s+(FAIL|PASS|SKIP):\s+(\S+)\s+\((.+?)\)/;

// Cypress: "  ✗ should display dashboard"
const CYPRESS_FAIL = /^\s*[✗×]\s+(.+)$/;

// Generic: "FAIL  test_name" or "PASS  test_name"
const GENERIC_RESULT = /^(PASS|FAIL|ERROR|SKIP)\s+(.+)/i;

// Some custom reporters (e.g. WebdriverIO-style frameworks with verbose
// step-by-step execution traces) print a standalone final-verdict line at
// the end of a test's log: a bare "PASS", or "FAIL <test name>". Unlike
// GENERIC_RESULT above, a bare PASS has nothing trailing it. These lines are
// authoritative — they represent the actual final outcome after any
// retries — and should override noisier heuristics (e.g. a passing
// `expect(true).toBe(true)` trace line elsewhere in the file being
// mistaken for failure evidence).
const STANDALONE_PASS = /^PASS\s*$/;
const STANDALONE_FAIL = /^FAIL\s+(.+)$/;

/**
 * Find the last standalone PASS/FAIL verdict line in a log, if any. When
 * present, this is the authoritative final outcome — including across
 * retries, since a retry that ultimately passes ends with its own PASS line
 * after any earlier FAIL lines for the same test.
 */
function getFinalVerdict(content: string): 'PASS' | 'FAIL' | null {
  let verdict: 'PASS' | 'FAIL' | null = null;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (STANDALONE_PASS.test(line)) verdict = 'PASS';
    else if (STANDALONE_FAIL.test(line)) verdict = 'FAIL';
  }
  return verdict;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. EXCEPTION & ERROR PATTERNS
// ────────────────────────────────────────────────────────────────────────────

// Java exceptions: "java.lang.NullPointerException: message"
const JAVA_EXCEPTION = /^([\w.]+(?:Exception|Error|Failure|Throwable))(?::\s*(.*))?$/;
// JS/TS errors: "TypeError: Cannot read properties of undefined"
const JS_ERROR = /^(\w+Error):\s*(.+)$/;
// Python errors: "AssertionError: expected True"
const PYTHON_ERROR = /^(\w+(?:Error|Exception|Warning)):\s*(.*)$/;
// Generic error message after "Error:" or "FAILURE:"
const GENERIC_ERROR = /(?:Error|FAILURE|FATAL):\s*(.+)/i;

// Plain-English failure sentences some reporters print instead of a
// structured "Error:"/exception line — e.g. "Timed out waiting for
// condition to resolve." Without this, a line like that matches none of
// the patterns above (no Exception/Error suffix, no assertion keywords)
// and the real failure reason is silently lost even though it's sitting
// right there.
const PLAIN_FAILURE_SENTENCE = /^(Timed?\s*out\b.*|Timeout\b.*|Failed to\b.*|Unable to\b.*|Cannot\b.*|Could not\b.*)/i;

// Stack frames
const JAVA_STACK = /^\s+at\s+([\w.$]+)\.([\w<>]+)\(([^)]+)\)/;
const JS_STACK = /^\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/;
const PYTHON_STACK = /^\s+File\s+"([^"]+)",\s+line\s+(\d+)/;
const GO_STACK = /^\s+([\w./]+\.go):(\d+)/;

// Numbered execution-step line some custom reporters print for every call,
// e.g. "617) Function.foo (SnapshotUtils.ts:103) > expect(4799).toBeLessThanOrEqual(1000) (1.1s)".
// When it contains an expect(...) call, the numbers inside are the actual
// test-specific values — far more useful than a generic assertion-library
// header line like "expect(received).toBeLessThanOrEqual(expected)", which
// carries no information about what actually happened. When no other
// framework's stack trace format matches (see extractErrorDetails), a
// handful of these lines also make a reasonable substitute for a real
// stack trace, since each one names the function/file/line it came from.
const NUMBERED_STEP_LINE = /^\d+\)\s+.+/;
const NUMBERED_STEP_ASSERTION = /^\d+\)\s+.*?\bexpect\([^)]*\)\.\w+\([^)]*\)/;

// ────────────────────────────────────────────────────────────────────────────
// 3. FLAKY DETECTION PATTERNS
// ────────────────────────────────────────────────────────────────────────────

const FLAKY_PATTERNS = [
  /timeout/i,
  /timed?\s*out/i,
  /race\s*condition/i,
  /ConcurrentModification/i,
  /EADDRINUSE/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /EPIPE/i,
  /flaky/i,
  /intermittent/i,
  /retry/i,
  /socket hang up/i,
  /ETIMEDOUT/i,
  /navigation timeout/i,
  /waiting for selector/i,
  /element not found/i,
  /stale element/i,
  /detached/i,
  /port\s+\d+\s+(?:already\s+)?in\s+use/i,
];

// ────────────────────────────────────────────────────────────────────────────
// 4. EXCEPTION → CATEGORY MAPPING
// ────────────────────────────────────────────────────────────────────────────

function classifyException(exceptionType: string | null, errorMsg: string | null): FailureCategory {
  const combined = `${exceptionType || ''} ${errorMsg || ''}`.toLowerCase();

  if (/nullpointer|cannot read propert|undefined is not|null reference/i.test(combined)) return 'NullPointerException';
  if (/assert|expect|toBe|toEqual|should|chai|jest\.expect/i.test(combined)) return 'AssertionError';
  if (/timeout|timed?\s*out|ETIMEDOUT|navigation timeout|waitForSelector/i.test(combined)) return 'Timeout';
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up|EPIPE|fetch failed/i.test(combined)) return 'ConnectionError';
  if (/EADDRINUSE|port.*in use|bind.*address/i.test(combined)) return 'ConnectionError';
  if (/config|configuration|property.*not found|missing.*setting|env.*not set/i.test(combined)) return 'ConfigError';
  if (/dependency|module not found|cannot find module|import.*failed|require.*failed|ClassNotFound/i.test(combined)) return 'DependencyError';
  if (/setup|@before|beforeAll|beforeEach|fixture|setUp|init/i.test(combined)) return 'SetupFailure';
  if (/data|json.*parse|unexpected token|malformed|schema|validation/i.test(combined)) return 'DataError';
  if (/environment|docker|container|image|platform|os\b|permission denied|access denied/i.test(combined)) return 'EnvironmentError';
  if (/race|concurrent|deadlock|livelock|ConcurrentModification/i.test(combined)) return 'RaceCondition';
  if (/auth|unauthorized|forbidden|403|401|login.*fail|credential|token.*expired/i.test(combined)) return 'AuthError';
  if (/network|dns|proxy|ssl|tls|certificate|handshake/i.test(combined)) return 'NetworkError';
  return 'Unknown';
}

// ────────────────────────────────────────────────────────────────────────────
// 5. SEVERITY ASSIGNMENT
// ────────────────────────────────────────────────────────────────────────────

function assignSeverity(category: FailureCategory, isFlaky: boolean, exceptionType: string | null): Severity {
  if (isFlaky) return 'LOW';
  switch (category) {
    case 'SetupFailure':
    case 'ConfigError':
    case 'EnvironmentError':
    case 'DependencyError':
      return 'CRITICAL';
    case 'NullPointerException':
    case 'AuthError':
      return 'HIGH';
    case 'AssertionError':
    case 'Timeout':
    case 'ConnectionError':
    case 'NetworkError':
    case 'DataError':
      return 'MEDIUM';
    case 'RaceCondition':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 6. CORE PARSING FUNCTIONS
// ────────────────────────────────────────────────────────────────────────────

interface ParsedError {
  exceptionType: string | null;
  errorMessage: string | null;
  stackFrames: string[];
  logEvidenceQuote: string | null;
  evidenceContext: EvidenceContext | null;
}

/**
 * Build the structured evidence around a failure line: the 1-2 execution
 * steps immediately before it, the Expected/Received values, the page URL,
 * and the failing step's duration — whichever of these are actually present
 * nearby. Lets QE see "what was happening, what broke, on which page, for
 * how long" without opening the raw log.
 */
function buildEvidenceContext(lines: string[], index: number): EvidenceContext {
  // Expected/Received and the page URL often sit a few lines beyond the
  // tight display quote — widen the search window for parsing only.
  const wideStart = Math.max(0, index - 3);
  const wideEnd = Math.min(lines.length - 1, index + 12);
  const wideText = lines.slice(wideStart, wideEnd + 1).join('\n');

  const stripQuotes = (s: string) => s.trim().replace(/^["']|["']$/g, '');

  const expectedMatch = wideText.match(/Expected:\s*(.+)/i);
  const receivedMatch = wideText.match(/Received:\s*(.+)/i);
  const urlMatch = wideText.match(/(?:^|\s)on\s+(https?:\/\/\S+)/i);
  const durationMatch = lines[index]?.match(/\((\d+(?:\.\d+)?\s*(?:ms|s|m))\)\s*$/i);

  // The nearest numbered execution-step lines before this one — the
  // actions that led up to the failure, not the failure itself.
  const precedingSteps: string[] = [];
  for (let j = index - 1; j >= Math.max(0, index - 15) && precedingSteps.length < 2; j--) {
    const l = lines[j].trim();
    if (!l || isNoiseLine(l)) continue;
    if (NUMBERED_STEP_LINE.test(l)) {
      precedingSteps.unshift(l);
    }
  }

  return {
    precedingSteps,
    expected: expectedMatch ? stripQuotes(expectedMatch[1]) : null,
    received: receivedMatch ? stripQuotes(receivedMatch[1]) : null,
    pageUrl: urlMatch ? urlMatch[1].trim() : null,
    duration: durationMatch ? durationMatch[1].trim() : null,
  };
}

/**
 * Filter out generic browser config and network noise lines that are not real test failures.
 */
function isNoiseLine(line: string): boolean {
  const lower = line.toLowerCase();
  if (lower.includes('requested size:') && lower.includes('actual:')) return true;
  if (lower.includes('pixel ratio:') && lower.includes('width x height')) return true;
  if (lower.includes('libva error:') || lower.includes('gl error') || lower.includes('mesa:')) return true;
  if (lower.includes('failed to load resource: the server responded with a status of 404')) return true;
  if (lower.includes('failed to load resource: the server responded with a status of 401')) return true;
  if (lower.includes('download the react devtools') || lower.includes('download api')) return true;
  if (lower.includes('debugger listening on ws:')) return true;
  if (/\[\d+:\d+:\d+\/\d+\.\d+:error:/i.test(lower)) return true;
  return false;
}

/**
 * Extract exception type, error message, stack frames, and evidence from a block of text.
 * Scans bottom-up to locate the actual test failure trace first.
 */
function extractErrorDetails(text: string): ParsedError {
  const lines = text.split('\n');
  const stackFrames: string[] = [];

  // Helper to grab context around a matching line
  const grabContext = (index: number): string => {
    const context: string[] = [];
    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length - 1, index + 3);
    for (let j = start; j <= end; j++) {
      const l = lines[j].trim();
      if (l) context.push(l);
    }
    return context.join('\n');
  };

  // 1. Collect stack frames bottom-up (max 20)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isNoiseLine(line)) continue;

    if (
      JAVA_STACK.test(line) ||
      JS_STACK.test(line) ||
      PYTHON_STACK.test(line) ||
      GO_STACK.test(line)
    ) {
      if (stackFrames.length < 20) {
        stackFrames.push(line);
      }
    }
  }
  stackFrames.reverse();

  // Fallback: none of the known stack-trace formats matched (common for
  // custom reporters with no framework-recognized trace format). A run of
  // numbered execution-step lines each name their own function/file/line,
  // so a handful of them serve as a reasonable substitute for "no stack
  // trace captured" — better than telling QE nothing at all.
  if (stackFrames.length === 0) {
    const pseudoFrames: string[] = [];
    for (let i = lines.length - 1; i >= 0 && pseudoFrames.length < 8; i--) {
      const line = lines[i].trim();
      if (!line || isNoiseLine(line)) continue;
      if (NUMBERED_STEP_LINE.test(line)) {
        pseudoFrames.push(line);
      }
    }
    pseudoFrames.reverse();
    stackFrames.push(...pseudoFrames);
  }

  let exceptionType: string | null = null;
  let errorMessage: string | null = null;
  let logEvidenceQuote: string | null = null;
  // Tracks which line the evidence was anchored on, so evidenceContext
  // (preceding steps, duration, etc.) is built around the actual failure
  // line rather than always the outermost match.
  let evidenceAnchorIndex: number | null = null;

  // 2. Scan bottom-up to find the most recent/actual strong error message
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isNoiseLine(line)) continue;

    // Try Java exception
    const javaMatch = line.match(JAVA_EXCEPTION);
    if (javaMatch) {
      exceptionType = javaMatch[1];
      errorMessage = javaMatch[2] || null;
      logEvidenceQuote = grabContext(i);
      evidenceAnchorIndex = i;
      break;
    }

    // Try JS/TS error
    const jsMatch = line.match(JS_ERROR);
    if (jsMatch) {
      exceptionType = jsMatch[1];
      errorMessage = jsMatch[2];
      logEvidenceQuote = grabContext(i);
      evidenceAnchorIndex = i;
      break;
    }

    // Try Python error
    const pyMatch = line.match(PYTHON_ERROR);
    if (pyMatch) {
      exceptionType = pyMatch[1];
      errorMessage = pyMatch[2] || null;
      logEvidenceQuote = grabContext(i);
      evidenceAnchorIndex = i;
      break;
    }

    // Try generic error line
    const genMatch = line.match(GENERIC_ERROR);
    if (genMatch) {
      errorMessage = genMatch[1].trim();
      logEvidenceQuote = grabContext(i);
      evidenceAnchorIndex = i;
      break;
    }
  }

  // 2.5. Fallback to a plain-English failure sentence (e.g. a timeout
  // description with no "Error:"/exception prefix) before resorting to the
  // much weaker assertion-line guess in step 3.
  if (!errorMessage && !exceptionType) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      if (isNoiseLine(line)) continue;

      if (PLAIN_FAILURE_SENTENCE.test(line) && line.length < 300) {
        errorMessage = line;
        logEvidenceQuote = grabContext(i);
        evidenceAnchorIndex = i;
        break;
      }
    }
  }

  // 3. Fallback to assertion messages if no strong error was found
  if (!errorMessage && !exceptionType) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      if (isNoiseLine(line)) continue;

      if (/(?:expected|actual|assert|expect|received)/i.test(line) && line.length < 500) {
        // Search upwards for a more descriptive line. Prefer a numbered
        // execution-step line with concrete values (e.g.
        // "617) ... expect(4799).toBeLessThanOrEqual(1000)") over a generic
        // assertion-library header line (e.g.
        // "expect(received).toBeLessThanOrEqual(expected)"), which is
        // identical across every test using that matcher and tells QE
        // nothing test-specific.
        let mainLine = line;
        let mainLineIndex = i;
        let foundConcreteValues = false;
        for (let j = Math.max(0, i - 10); j <= i; j++) {
          const upLine = lines[j].trim();
          if (!upLine || isNoiseLine(upLine)) continue;
          if (NUMBERED_STEP_ASSERTION.test(upLine)) {
            mainLine = upLine;
            mainLineIndex = j;
            foundConcreteValues = true;
            break;
          }
        }
        if (!foundConcreteValues) {
          for (let j = Math.max(0, i - 5); j <= i; j++) {
            const upLine = lines[j].trim();
            if (/(?:expect|assert|toBe|toEqual)/i.test(upLine) && !isNoiseLine(upLine)) {
              mainLine = upLine;
              mainLineIndex = j;
              break;
            }
          }
        }
        errorMessage = mainLine;
        logEvidenceQuote = grabContext(i);
        // Anchor evidenceContext on the concrete-values line when found (it's
        // the real point of failure), else the originally matched line.
        evidenceAnchorIndex = mainLineIndex;
        break;
      }
    }
  }

  const evidenceContext = evidenceAnchorIndex !== null ? buildEvidenceContext(lines, evidenceAnchorIndex) : null;

  return { exceptionType, errorMessage, stackFrames, logEvidenceQuote, evidenceContext };
}

/**
 * Derive a human-readable root cause from the parsed error details.
 */
function deriveRootCause(error: ParsedError, category: FailureCategory): string | null {
  // Try to find the deepest application stack frame (not from libraries)
  const appFrame = error.stackFrames.find(f => {
    const lower = f.toLowerCase();
    return !lower.includes('node_modules') &&
           !lower.includes('java.') &&
           !lower.includes('javax.') &&
           !lower.includes('org.junit') &&
           !lower.includes('org.testng') &&
           !lower.includes('sun.') &&
           !lower.includes('com.sun.') &&
           !lower.includes('internal/') &&
           !lower.includes('playwright/lib');
  });

  if (error.exceptionType && error.errorMessage) {
    const origin = appFrame ? ` at ${appFrame.trim()}` : '';
    return `${error.exceptionType}: ${error.errorMessage}${origin}`;
  }

  if (error.errorMessage) {
    return error.errorMessage;
  }

  if (error.exceptionType) {
    return error.exceptionType;
  }

  return `Unclassified ${category} failure — enable verbose logging for more details`;
}

/**
 * Generate a dynamic, contextual 2-3 line analysed cause based on actual failure details
 * instead of returning a generic boilerplate template.
 */
function deriveDynamicAnalysedCause(error: ParsedError, category: FailureCategory): string {
  const errMsg = error.errorMessage || '';
  const evidence = error.logEvidenceQuote || '';
  const combined = `${errMsg}\n${evidence}`;

  // 1. Try to extract Expected/Received difference
  const expectedMatch = combined.match(/Expected:\s*["']?([^"\n]+)["']?/i);
  const receivedMatch = combined.match(/Received:\s*["']?([^"\n]+)["']?/i);
  
  if (expectedMatch && receivedMatch) {
    const expected = expectedMatch[1].trim();
    const received = receivedMatch[1].trim();
    
    if (expected.includes('form') && received.includes('0')) {
      return `The assertion failed because the page expected forms to be refreshed/loaded successfully ("${expected}"), but received an empty or unrefreshed state ("${received}"). This indicates the UI did not update or the submission failed silently.`;
    }
    return `The validation assertion failed. The test expected a value of "${expected}" but actually received "${received}" during execution. Check if the business logic has changed or if out-of-date mockup data is being used.`;
  }

  // 2. Playwright expect(...) failures
  if (combined.includes('expect(')) {
    const expectMatch = combined.match(/expect\((.*?)\)\.(toBe|toEqual|toContain)\((.*?)\)/i);
    if (expectMatch) {
      const subject = expectMatch[1].trim();
      const matcher = expectMatch[2].trim();
      const expectedVal = expectMatch[3].trim();
      return `The test assertion expect(${subject}).${matcher}(${expectedVal}) failed. The actual runtime value did not satisfy this condition. Check why the value of "${subject}" differs from "${expectedVal}".`;
    }
  }

  // 3. Timeout failures
  if (category === 'Timeout' || combined.toLowerCase().includes('timeout') || combined.toLowerCase().includes('timed out')) {
    const selectorMatch = combined.match(/(?:waiting for|locator|selector)\s*["']?([^"'\s]+)["']?/i) ||
                          combined.match(/element\s*["']?([^"'\s]+)["']?/i);
    if (selectorMatch) {
      return `The test failed due to a timeout waiting for the page element "${selectorMatch[1]}" to appear or become interactive. This points to a layout change, slow page rendering, or an outdated DOM locator.`;
    }
    return `The test execution exceeded its timeout limit while waiting for a network request, animation, or page navigation to complete. Verify server response latency and check if wait conditions need adjustment.`;
  }

  // 4. Null Pointer / Undefined properties
  if (category === 'NullPointerException' || combined.toLowerCase().includes('cannot read property') || combined.toLowerCase().includes('undefined')) {
    const propMatch = combined.match(/reading\s*['"]?([^'"]+)['"]?/i) ||
                      combined.match(/properties of\s*(\w+)/i);
    if (propMatch) {
      return `The application code crashed because it attempted to access the property "${propMatch[1]}" on a null or undefined object. Check if an API payload was empty or if element selection failed earlier.`;
    }
    return `An operation failed because it was executed on a null reference or undefined object. Review the preceding stack trace to check where variables are initialized.`;
  }

  // 5. Connection failures
  if (category === 'ConnectionError' || combined.toLowerCase().includes('econnrefused') || combined.toLowerCase().includes('econnreset')) {
    const portMatch = combined.match(/(?:port|localhost:)(\d+)/i) || combined.match(/:(\d+)\b/);
    if (portMatch) {
      return `Failed to establish connection to the service dependency on port ${portMatch[1]}. Ensure the backend microservice or mock API is active and reachable in the environment.`;
    }
    return `A network connection error occurred (refused or reset). The service under test could not reach its dependent API server or database. Check service health status.`;
  }

  // 6. SetupHook failures
  if (category === 'SetupFailure') {
    return `The test execution was blocked during the initial hook setup (beforeAll / beforeEach). This usually indicates a failure to seed database fixtures, authenticate, or initialize browser drivers.`;
  }

  // 7. General fallback
  if (errMsg && errMsg.length > 5) {
    const cleanMsg = errMsg.replace(/^Error:\s*/i, '').trim();
    return `The test case failed with the error message: "${cleanMsg}". Inspect the log evidence context to investigate the state mismatch or exception details.`;
  }

  return `The test case encountered an unclassified failure. Review the stack trace and log evidence below to locate the failure origin.`;
}

/**
 * Generate symptom vs cause from parsed error details.
 */
function deriveSymptomVsCause(error: ParsedError, category: FailureCategory): SymptomVsCause | null {
  if (!error.errorMessage && !error.exceptionType) return null;

  const symptom = error.errorMessage || error.exceptionType || 'Test failure';
  const cause = deriveDynamicAnalysedCause(error, category);

  return { symptom, cause };
}

/**
 * Analyze a log file that contains retry attempts.
 * Finds all occurrences of the word "fail " (single space, case insensitive).
 * Extracts failure details, traces, symptoms, and root cause analysis across all execution attempts.
 */
function analyzeMultiAttempts(content: string, filePath: string): TestCase | null {
  const lines = content.split('\n');

  // A single log.txt file can interleave the test's own PASS/FAIL outcomes
  // with its beforeEach/afterEach hook's PASS/FAIL outcomes across several
  // retry cycles. Prefer the precise "FAIL <name>" convention when present,
  // and separate markers that belong to the test itself from markers that
  // belong to a hook — otherwise a hook failure gets miscounted as another
  // attempt of the test, inflating the attempt count and pulling unrelated
  // content into the test's own evidence window.
  const preciseFailMarkers: { index: number; isHook: boolean }[] = [];
  const passIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const failMatch = trimmed.match(STANDALONE_FAIL);
    if (failMatch) {
      preciseFailMarkers.push({ index: i, isHook: isHookLogName(failMatch[1].trim()) });
    } else if (STANDALONE_PASS.test(trimmed)) {
      passIndices.push(i);
    }
  }

  const ownTestMarkers = preciseFailMarkers.filter(m => !m.isHook);
  const hookFailMarkers = preciseFailMarkers.filter(m => m.isHook);
  const hookMarkerCount = hookFailMarkers.length;

  let markerIndices: number[];
  // Hard boundaries a context window must never cross into — always a PASS
  // (a different attempt/hook succeeding), plus a hook's own FAIL when we're
  // scoped to the test's own markers (so a hook failure's content can't leak
  // into this test's evidence). Deliberately excludes this test's OWN other
  // retry markers: those sit close together by design, and clipping there
  // was cutting a retry's window off before reaching its actual evidence.
  let hardBoundaryIndices: number[];
  if (ownTestMarkers.length > 0) {
    markerIndices = ownTestMarkers.map(m => m.index);
    hardBoundaryIndices = [...passIndices, ...hookFailMarkers.map(m => m.index)].sort((a, b) => a - b);
  } else if (preciseFailMarkers.length > 0) {
    // Every precise FAIL marker in this file belongs to a hook (e.g. the
    // test's own assertions passed but its afterEach kept failing) — still
    // worth surfacing as a failure, just without a false "own test" label.
    markerIndices = preciseFailMarkers.map(m => m.index);
    hardBoundaryIndices = [...passIndices];
  } else {
    // No standalone FAIL <name> convention detected — fall back to a broad
    // scan for any "fail"/"failed" word, as before.
    markerIndices = [];
    for (let i = 0; i < lines.length; i++) {
      if (/\bfail(ed)?\s/i.test(lines[i]) && !isNoiseLine(lines[i])) {
        markerIndices.push(i);
      }
    }
    hardBoundaryIndices = [...passIndices];
  }

  // Deduplicate marker indices that are too close (within 20 lines) to avoid capturing the same failure dump
  const distinctIndices: number[] = [];
  for (const idx of markerIndices) {
    if (distinctIndices.length === 0 || idx - distinctIndices[distinctIndices.length - 1] > 20) {
      distinctIndices.push(idx);
    }
  }

  // If no "fail " markers found, we check if the file content indicates any failure
  if (distinctIndices.length === 0) {
    return null;
  }

  const parsedErrors: ParsedError[] = [];
  for (const idx of distinctIndices) {
    // Slice a window around each marker (20 lines before, 30 lines after),
    // but never cross into the next PASS/FAIL boundary — otherwise a later
    // attempt's (or a hook's) outcome can leak into this attempt's evidence,
    // e.g. a trailing "PASS" showing up as "evidence" for a FAILED case.
    const startIdx = Math.max(0, idx - 20);
    const naiveEndIdx = Math.min(lines.length - 1, idx + 30);
    const nextBoundary = hardBoundaryIndices.find(b => b > idx);
    const endIdx = nextBoundary !== undefined ? Math.min(naiveEndIdx, nextBoundary - 1) : naiveEndIdx;
    const windowLines = lines.slice(startIdx, endIdx + 1);

    const error = extractErrorDetails(windowLines.join('\n'));
    if (error.errorMessage || error.exceptionType || error.stackFrames.length > 0) {
      parsedErrors.push(error);
    }
  }

  // If we couldn't parse specific details inside the windows, fall back to whole file analysis
  if (parsedErrors.length === 0) {
    const fallbackError = extractErrorDetails(content);
    parsedErrors.push(fallbackError);
  }

  const numAttempts = distinctIndices.length;
  const finalError = parsedErrors[parsedErrors.length - 1] || { exceptionType: null, errorMessage: null, stackFrames: [], logEvidenceQuote: null };
  const firstError = parsedErrors[0] || finalError;
  const errorsAreIdentical = parsedErrors.length > 1 && parsedErrors.every(e => e.errorMessage === firstError.errorMessage);
  // The Main Run (first attempt) is the more representative failure when
  // attempts differ — later retries can fail for unrelated downstream
  // reasons (e.g. a timeout caused by state the first failure left behind).
  // Category/cause/evidence are headlined from it, falling back to the
  // final attempt only if the Main Run's own extraction came up empty.
  const primaryError = (firstError.errorMessage || firstError.exceptionType) ? firstError : finalError;

  // 1. Compose a highly descriptive errorMessage listing each attempt's results if multiple exist
  let aggregatedErrorMessage = '';
  if (numAttempts > 1) {
    aggregatedErrorMessage = `Failed persistently after ${numAttempts} attempts (1 main execution + ${numAttempts - 1} retries):\n`;
    parsedErrors.forEach((err, idx) => {
      const label = idx === 0 ? 'Main Run' : `Retry #${idx}`;
      const msg = err.errorMessage || 'Unknown failure detail';
      const exc = err.exceptionType ? `[${err.exceptionType}] ` : '';
      aggregatedErrorMessage += `  • ${label}: ${exc}${msg}\n`;
    });
  } else {
    aggregatedErrorMessage = finalError.errorMessage || 'Test case execution failed (detected "fail " marker in log).';
  }

  let category = classifyException(primaryError.exceptionType, primaryError.errorMessage);

  // A failure that reproduces identically on every attempt is a stable,
  // reproducible bug — not flakiness — no matter what incidental keywords
  // (e.g. a stray "retry" or "timeout" mention) show up somewhere else in
  // an 8000-line log. Only consider it flaky when the attempts actually
  // produced different results, and scope the keyword scan to the
  // extracted per-attempt messages rather than the whole raw file, which
  // is too broad and matches unrelated content that has nothing to do
  // with why this specific test failed.
  const attemptMessages = parsedErrors.map(e => e.errorMessage || '').join(' ');
  const isFlaky = numAttempts > 1 && !errorsAreIdentical && FLAKY_PATTERNS.some(p => p.test(attemptMessages));
  let severity = assignSeverity(category, isFlaky, primaryError.exceptionType);

  // A beforeAll/beforeEach/afterAll/afterEach hook file (per the
  // one-log-per-test-case naming convention) failing is a setup/teardown
  // failure by definition, regardless of what exception happened to occur —
  // and it can silently block every other test in the same suite, so it's
  // always treated as CRITICAL rather than deferring to the normal
  // category/flaky-based severity rules.
  const isHookFailure = isHookLogName(parseNamesFromPath(filePath).name);
  if (isHookFailure) {
    category = 'SetupFailure';
    severity = 'CRITICAL';
  }

  // 2. Compose highly descriptive failure symptoms
  let symptoms = `SUMMARY OF FAILURE SYMPTOMS:\n`;
  symptoms += `---------------------------\n`;
  symptoms += `• Primary Failure Code/Type: ${primaryError.exceptionType || 'Generic Uncaught Failure'}\n`;
  symptoms += `• Primary Failure Message: ${primaryError.errorMessage || 'No specific exception message found'}\n`;
  
  if (numAttempts > 1) {
    symptoms += `• Execution Context: Test failed consistently over ${numAttempts} execution attempts:\n`;
    parsedErrors.forEach((err, idx) => {
      const label = idx === 0 ? 'Main Execution' : `Retry Attempt #${idx}`;
      symptoms += `    - ${label}: ${err.errorMessage || 'No specific message'}\n`;
    });
  } else {
    symptoms += `• Execution Context: Failed on initial run. No retry attempts were logged.\n`;
  }

  if (finalError.stackFrames.length > 0) {
    symptoms += `• Code Location: Stack trace indicates the failure originated at:\n`;
    symptoms += `    --> ${finalError.stackFrames[0]}\n`;
  }

  // 3. Compose highly descriptive, deep root cause analysis (RCA)
  let rca = `DEEP ROOT CAUSE ANALYSIS (RCA)\n`;
  rca += `=============================\n\n`;
  
  rca += `1. FAILURE CLASSIFICATION & SEVERITY:\n`;
  rca += `   - Category: ${category} (The test failure pattern is characteristic of a ${category.toLowerCase()} error).\n`;
  rca += `   - Severity: ${severity} (Assigned because it is a ${isFlaky ? 'flaky' : 'persistent'} failure of this category).\n\n`;

  rca += `2. MULTI-ATTEMPT ANALYSIS:\n`;
  if (numAttempts > 1) {
    rca += `   - Total Execution Attempts: ${numAttempts} (1 main execution + ${numAttempts - 1} retries).\n`;
    if (errorsAreIdentical) {
      rca += `   - Analysis: The failure was identical across all ${numAttempts} attempts — this is a stable, reproducible issue, not a flaky one. Retrying will not resolve it; investigate the application/test logic directly.\n\n`;
    } else {
      rca += `   - Analysis: The failure message differed between attempts. This can mean genuine flakiness (timing, environment), or it can mean our parser captured a different nearby line each time in a verbose log — treat the Main Run details below as the most reliable signal, and check the other attempts in the errorMessage field for the actual pattern before concluding this is flaky.\n\n`;
    }
  } else {
    rca += `   - Total Execution Attempts: 1 (Test runner aborted immediately or was configured with 0 retries).\n`;
    rca += `   - Analysis: The failure occurred on the first execution. Review the details below to determine if this is transient or persistent.\n\n`;
  }

  if (hookMarkerCount > 0) {
    rca += `   - Note: ${hookMarkerCount} beforeEach/afterEach hook failure(s) were also detected interleaved in this same log. That may be a separate cleanup/setup issue rather than part of this test's own failure — check the suite's hook logs too.\n\n`;
  }

  rca += `3. TECHNICAL ANALYSIS & STACK PATH:\n`;
  if (finalError.stackFrames.length > 0) {
    rca += `   - The stack trace shows the error execution route leading up to the failure:\n`;
    finalError.stackFrames.slice(0, 8).forEach((frame, idx) => {
      rca += `     [Frame ${idx + 1}] ${frame}\n`;
    });
    rca += `\n   - Recommendation: Inspect the code at the top-most application stack frame to locate the assertion/null check that triggered this trace.\n\n`;
  } else {
    rca += `   - No stack trace was captured in the logs. This often happens for timeouts or syntax errors that occur before the test runner's tracing begins.\n\n`;
  }

  rca += `4. SUGGESTED FOCUS AREA BASED ON ERROR CATEGORY:\n`;
  const dynamicAnalysedCause = deriveDynamicAnalysedCause(primaryError, category);
  rca += `   - ${dynamicAnalysedCause}`;

  const pathNames = parseNamesFromPath(filePath);
  const contextMeta = extractContextMetadata(content);
  const { suite, name } = resolveNames(pathNames, contextMeta.cleanTestName);

  return {
    id: `LOCAL-TEMP`,
    name,
    suite,
    status: 'FAILED',
    duration: null,
    isFlaky,
    isCascading: false,
    cascadeGroupId: null,
    exceptionType: finalError.exceptionType,
    errorMessage: aggregatedErrorMessage.trim(),
    stackFrames: finalError.stackFrames,
    rootCause: rca.trim(),
    symptomVsCause: {
      symptom: symptoms.trim(),
      cause: dynamicAnalysedCause
    },
    severity,
    category,
    fixSuggestion: null,
    fixComplexity: null,
    logEvidenceQuote: primaryError.logEvidenceQuote || finalError.logEvidenceQuote,
    parserConfidence: finalError.exceptionType ? 'HIGH' : (finalError.errorMessage ? 'MEDIUM' : 'LOW'),
    testUserEmail: contextMeta.testUserEmail,
    relatedLinks: contextMeta.relatedLinks,
    attemptCount: numAttempts,
    isHookFailure,
    evidenceContext: primaryError.evidenceContext || finalError.evidenceContext,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 7. PER-FILE LOG PARSER
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a single log file content into TestCase objects.
 * Handles multiple test framework formats.
 */
export function parseLogFile(
  content: string,
  filePath: string
): TestCase[] {
  const lines = content.split('\n');
  const cases: TestCase[] = [];

  // ── Strategy A: Look for structured test result patterns ───────────

  // 1. JUnit / Surefire / TestNG results
  let currentSuite: string | null = null;
  let currentSuiteStart = 0;
  const suiteHasIndividualFailure = new Map<string, boolean>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const suiteMatch = line.match(JUNIT_SUITE_START);
    if (suiteMatch) {
      currentSuite = suiteMatch[1];
      currentSuiteStart = i;
      continue;
    }

    // Method-level failure: "testFoo(com.example.FooTest)  Time elapsed: 0.012 s  <<< FAILURE!"
    const methodMatch = line.match(SUREFIRE_METHOD_FAILURE);
    if (methodMatch) {
      const [, methodName, className, kind] = methodMatch;
      const bodyLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (SUREFIRE_METHOD_FAILURE.test(lines[j]) || JUNIT_SUITE_START.test(lines[j]) || JUNIT_SUMMARY.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }
      const body = bodyLines.join('\n');
      const error = extractErrorDetails(body);
      const category = classifyException(error.exceptionType, error.errorMessage);
      const isFlaky = FLAKY_PATTERNS.some(p => p.test(body));
      const severity = assignSeverity(category, isFlaky, error.exceptionType);

      cases.push({
        id: `LOCAL-${cases.length + 1}`,
        name: methodName,
        suite: className,
        status: kind === 'ERROR' ? 'ERROR' : 'FAILED',
        duration: null,
        isFlaky,
        isCascading: false,
        cascadeGroupId: null,
        exceptionType: error.exceptionType,
        errorMessage: error.errorMessage,
        stackFrames: error.stackFrames,
        rootCause: deriveRootCause(error, category),
        symptomVsCause: deriveSymptomVsCause(error, category),
        severity,
        category,
        fixSuggestion: null,
        fixComplexity: null,
        logEvidenceQuote: error.logEvidenceQuote,
        parserConfidence: error.exceptionType ? 'HIGH' : (error.errorMessage ? 'MEDIUM' : 'LOW'),
        testUserEmail: null,
        relatedLinks: [],
        attemptCount: null,
        isHookFailure: false,
        evidenceContext: error.evidenceContext,
      });
      suiteHasIndividualFailure.set(className, true);
      continue;
    }

    // "Tests run: N, Failures: N, Errors: N, Skipped: N, Time elapsed: Ns - in com.x.y.TestClass"
    const summaryMatch = line.match(JUNIT_SUMMARY);
    if (summaryMatch) {
      // Only treat this as a per-suite summary if it explicitly names the
      // class ("- in com.x.Test"). Maven also prints a bare aggregate totals
      // line ("Tests run: 12, Failures: 1, Errors: 1") in its final reactor
      // summary — without the "- in ClassName" suffix that would otherwise
      // get misattributed to whichever suite happened to run last.
      const inClassMatch = line.match(/in\s+([\w.$]+)/);
      const className = inClassMatch ? inClassMatch[1] : null;
      if (className) currentSuite = className;

      const failures = parseInt(summaryMatch[2], 10);
      const errors = parseInt(summaryMatch[3], 10);

      // Safety net: the suite reported failures/errors but no individual
      // SUREFIRE_METHOD_FAILURE line was captured for it (e.g. a truncated
      // log or an unfamiliar Surefire formatter) — emit one aggregate case
      // so the reported failure isn't silently dropped.
      if ((failures > 0 || errors > 0) && className && !suiteHasIndividualFailure.get(className)) {
        const suiteBody = lines.slice(currentSuiteStart, i + 1).join('\n');
        const error = extractErrorDetails(suiteBody);
        const category = classifyException(error.exceptionType, error.errorMessage);
        const isFlaky = FLAKY_PATTERNS.some(p => p.test(suiteBody));
        const severity = assignSeverity(category, isFlaky, error.exceptionType);

        cases.push({
          id: `LOCAL-${cases.length + 1}`,
          name: className.split('.').pop() || className,
          suite: className,
          status: errors > 0 ? 'ERROR' : 'FAILED',
          duration: null,
          isFlaky,
          isCascading: false,
          cascadeGroupId: null,
          exceptionType: error.exceptionType,
          errorMessage: error.errorMessage || `${failures} failure(s), ${errors} error(s) reported for ${className}`,
          stackFrames: error.stackFrames,
          rootCause: deriveRootCause(error, category),
          symptomVsCause: deriveSymptomVsCause(error, category),
          severity,
          category,
          fixSuggestion: null,
          fixComplexity: null,
          logEvidenceQuote: error.logEvidenceQuote,
          parserConfidence: error.exceptionType ? 'MEDIUM' : 'LOW',
          testUserEmail: null,
          relatedLinks: [],
          attemptCount: null,
          isHookFailure: false,
          evidenceContext: error.evidenceContext,
        });
      }
      continue;
    }
  }

  // 2. Playwright failures:  "  1) [chromium] › tests/foo.spec.ts:5:3 › Suite › test name"
  for (let i = 0; i < lines.length; i++) {
    const pwMatch = lines[i].match(PW_TEST_START);
    if (pwMatch) {
      const fullPath = pwMatch[1].trim();
      const testName = pwMatch[2].trim();
      // Collect body lines until next numbered test or end
      const bodyLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (PW_TEST_START.test(lines[j]) || /^\s*\d+\s+(?:passed|failed|skipped)/.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }
      const body = bodyLines.join('\n');
      const error = extractErrorDetails(body);
      const category = classifyException(error.exceptionType, error.errorMessage);
      const isFlaky = FLAKY_PATTERNS.some(p => p.test(body));
      const severity = assignSeverity(category, isFlaky, error.exceptionType);

      cases.push({
        id: `LOCAL-${cases.length + 1}`,
        name: testName,
        suite: fullPath.replace(/\s*›\s*$/, '').trim() || null,
        status: 'FAILED',
        duration: null,
        isFlaky,
        isCascading: false,
        cascadeGroupId: null,
        exceptionType: error.exceptionType,
        errorMessage: error.errorMessage,
        stackFrames: error.stackFrames,
        rootCause: deriveRootCause(error, category),
        symptomVsCause: deriveSymptomVsCause(error, category),
        severity,
        category,
        fixSuggestion: null,
        fixComplexity: null,
        logEvidenceQuote: error.logEvidenceQuote,
        parserConfidence: error.exceptionType ? 'HIGH' : (error.errorMessage ? 'MEDIUM' : 'LOW'),
        testUserEmail: null,
        relatedLinks: [],
        attemptCount: null,
        isHookFailure: false,
        evidenceContext: error.evidenceContext,
      });
    }
  }

  // 3. pytest failures
  for (let i = 0; i < lines.length; i++) {
    const pyFailMatch = lines[i].match(PYTEST_FAILED);
    if (pyFailMatch) {
      const fullName = pyFailMatch[1];
      const inlineError = pyFailMatch[2] || null;
      const parts = fullName.split('::');
      const testName = parts[parts.length - 1];
      const suite = parts.length > 1 ? parts.slice(0, -1).join('::') : null;

      // Collect body
      const bodyLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 60, lines.length); j++) {
        if (PYTEST_FAILED.test(lines[j]) || PYTEST_PASSED.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }
      const body = bodyLines.join('\n');
      const error = extractErrorDetails(body);
      if (!error.errorMessage && inlineError) error.errorMessage = inlineError;
      if (!error.exceptionType && inlineError) error.exceptionType = inlineError.split(':')[0] || null;
      const category = classifyException(error.exceptionType, error.errorMessage);
      const isFlaky = FLAKY_PATTERNS.some(p => p.test(body));
      const severity = assignSeverity(category, isFlaky, error.exceptionType);

      cases.push({
        id: `LOCAL-${cases.length + 1}`,
        name: testName,
        suite,
        status: 'FAILED',
        duration: null,
        isFlaky,
        isCascading: false,
        cascadeGroupId: null,
        exceptionType: error.exceptionType,
        errorMessage: error.errorMessage,
        stackFrames: error.stackFrames,
        rootCause: deriveRootCause(error, category),
        symptomVsCause: deriveSymptomVsCause(error, category),
        severity,
        category,
        fixSuggestion: null,
        fixComplexity: null,
        logEvidenceQuote: error.logEvidenceQuote,
        parserConfidence: error.exceptionType ? 'HIGH' : (error.errorMessage ? 'MEDIUM' : 'LOW'),
        testUserEmail: null,
        relatedLinks: [],
        attemptCount: null,
        isHookFailure: false,
        evidenceContext: error.evidenceContext,
      });
    }
  }

  // 4. Jest failures
  for (let i = 0; i < lines.length; i++) {
    const jestMatch = lines[i].match(JEST_FAIL);
    if (jestMatch) {
      const suite = jestMatch[1].trim();
      const testName = jestMatch[2].trim();
      const bodyLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 60, lines.length); j++) {
        if (JEST_FAIL.test(lines[j]) || JEST_PASS.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }
      const body = bodyLines.join('\n');
      const error = extractErrorDetails(body);
      const category = classifyException(error.exceptionType, error.errorMessage);
      const isFlaky = FLAKY_PATTERNS.some(p => p.test(body));
      const severity = assignSeverity(category, isFlaky, error.exceptionType);

      cases.push({
        id: `LOCAL-${cases.length + 1}`,
        name: testName,
        suite,
        status: 'FAILED',
        duration: null,
        isFlaky,
        isCascading: false,
        cascadeGroupId: null,
        exceptionType: error.exceptionType,
        errorMessage: error.errorMessage,
        stackFrames: error.stackFrames,
        rootCause: deriveRootCause(error, category),
        symptomVsCause: deriveSymptomVsCause(error, category),
        severity,
        category,
        fixSuggestion: null,
        fixComplexity: null,
        logEvidenceQuote: error.logEvidenceQuote,
        parserConfidence: error.exceptionType ? 'HIGH' : (error.errorMessage ? 'MEDIUM' : 'LOW'),
        testUserEmail: null,
        relatedLinks: [],
        attemptCount: null,
        isHookFailure: false,
        evidenceContext: error.evidenceContext,
      });
    }
  }

  // 5. Go test results
  for (let i = 0; i < lines.length; i++) {
    const goMatch = lines[i].match(GO_TEST);
    if (goMatch) {
      const status: TestStatus = goMatch[1] === 'PASS' ? 'PASSED' : goMatch[1] === 'SKIP' ? 'SKIPPED' : 'FAILED';
      const testName = goMatch[2];
      const duration = goMatch[3];

      if (status !== 'PASSED') {
        const bodyLines: string[] = [];
        for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
          if (GO_TEST.test(lines[j])) break;
          bodyLines.push(lines[j]);
        }
        const body = bodyLines.join('\n');
        const error = extractErrorDetails(body);
        const category = classifyException(error.exceptionType, error.errorMessage);
        const isFlaky = FLAKY_PATTERNS.some(p => p.test(body));
        const severity = assignSeverity(category, isFlaky, error.exceptionType);

        cases.push({
          id: `LOCAL-${cases.length + 1}`,
          name: testName,
          suite: null,
          status,
          duration,
          isFlaky,
          isCascading: false,
          cascadeGroupId: null,
          exceptionType: error.exceptionType,
          errorMessage: error.errorMessage,
          stackFrames: error.stackFrames,
          rootCause: deriveRootCause(error, category),
          symptomVsCause: deriveSymptomVsCause(error, category),
          severity,
          category,
          fixSuggestion: null,
          fixComplexity: null,
          logEvidenceQuote: error.logEvidenceQuote,
          parserConfidence: error.exceptionType ? 'HIGH' : (error.errorMessage ? 'MEDIUM' : 'LOW'),
          testUserEmail: null,
          relatedLinks: [],
          attemptCount: null,
          isHookFailure: false,
          evidenceContext: error.evidenceContext,
        });
      }
    }
  }

  // 6. Cypress failures
  for (let i = 0; i < lines.length; i++) {
    const cypressMatch = lines[i].match(CYPRESS_FAIL);
    if (cypressMatch) {
      const testName = cypressMatch[1].trim();
      const bodyLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 60, lines.length); j++) {
        if (CYPRESS_FAIL.test(lines[j]) || JEST_PASS.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }
      const body = bodyLines.join('\n');
      const error = extractErrorDetails(body);
      const category = classifyException(error.exceptionType, error.errorMessage);
      const isFlaky = FLAKY_PATTERNS.some(p => p.test(body));
      const severity = assignSeverity(category, isFlaky, error.exceptionType);

      cases.push({
        id: `LOCAL-${cases.length + 1}`,
        name: testName,
        suite: null,
        status: 'FAILED',
        duration: null,
        isFlaky,
        isCascading: false,
        cascadeGroupId: null,
        exceptionType: error.exceptionType,
        errorMessage: error.errorMessage,
        stackFrames: error.stackFrames,
        rootCause: deriveRootCause(error, category),
        symptomVsCause: deriveSymptomVsCause(error, category),
        severity,
        category,
        fixSuggestion: null,
        fixComplexity: null,
        logEvidenceQuote: error.logEvidenceQuote,
        parserConfidence: error.exceptionType ? 'HIGH' : (error.errorMessage ? 'MEDIUM' : 'LOW'),
        testUserEmail: null,
        relatedLinks: [],
        attemptCount: null,
        isHookFailure: false,
        evidenceContext: error.evidenceContext,
      });
    }
  }

  // ── Strategy B: Fallback — whole-file error extraction ────────────
  // If no framework-specific patterns matched, treat the entire file as one test
  if (cases.length === 0 && getFinalVerdict(content) === 'PASS') {
    // The log's own last word is an authoritative PASS — trust it over the
    // heuristics below, which scan for anything error/assertion-shaped
    // anywhere in the file and can't tell a passing trace line from a
    // failing one. This also correctly resolves retries: if an earlier
    // attempt failed but the final one passed, the final PASS wins.
    return cases;
  }

  if (cases.length === 0) {
    const multiCase = analyzeMultiAttempts(content, filePath);
    if (multiCase) {
      cases.push(multiCase);
    } else {
      const error = extractErrorDetails(content);
      const hasFailure = content.toLowerCase().includes('fail ') ||
                         error.exceptionType !== null ||
                         error.errorMessage !== null;

      if (hasFailure) {
        const pathNames = parseNamesFromPath(filePath);
        const contextMeta = extractContextMetadata(content);
        const { suite, name } = resolveNames(pathNames, contextMeta.cleanTestName);
        let category = classifyException(error.exceptionType, error.errorMessage);
        const isFlaky = FLAKY_PATTERNS.some(p => p.test(content));
        let severity = assignSeverity(category, isFlaky, error.exceptionType);

        const isHookFailure = isHookLogName(pathNames.name);
        if (isHookFailure) {
          category = 'SetupFailure';
          severity = 'CRITICAL';
        }

        cases.push({
          id: `LOCAL-${cases.length + 1}`,
          name,
          suite,
          status: 'FAILED',
          duration: null,
          isFlaky,
          isCascading: false,
          cascadeGroupId: null,
          exceptionType: error.exceptionType,
          errorMessage: error.errorMessage,
          stackFrames: error.stackFrames,
          rootCause: deriveRootCause(error, category),
          symptomVsCause: deriveSymptomVsCause(error, category),
          severity,
          category,
          fixSuggestion: null,
          fixComplexity: null,
          logEvidenceQuote: error.logEvidenceQuote,
          parserConfidence: error.exceptionType ? 'MEDIUM' : 'LOW',
          testUserEmail: contextMeta.testUserEmail,
          relatedLinks: contextMeta.relatedLinks,
          attemptCount: 1,
          isHookFailure,
          evidenceContext: error.evidenceContext,
        });
      }
    }
  }

  return cases;
}

// ────────────────────────────────────────────────────────────────────────────
// 8. CASCADING GROUP DETECTION
// ────────────────────────────────────────────────────────────────────────────

// analyzeMultiAttempts() wraps every multi-attempt failure's message in the
// same fixed boilerplate ("Failed persistently after N attempts (...):  •
// Main Run: ..."). That wrapper alone is long enough to fill the fingerprint
// substring below, which would make any two unrelated multi-attempt
// failures collide into one fake cascade group. Strip it before
// fingerprinting so the comparison is based on the actual failure content.
function stripAttemptWrapperPrefix(message: string): string {
  return message
    .replace(/^Failed persistently after \d+ attempts? \([^)]*\):\s*/i, '')
    .replace(/^•\s*Main Run:\s*/i, '')
    .trim();
}

export function detectCascadingGroups(cases: TestCase[]): CascadingGroup[] {
  const failedCases = cases.filter(c => c.status === 'FAILED' || c.status === 'ERROR');
  if (failedCases.length < 2) return [];

  // Group by root exception type + first app stack frame
  const groups = new Map<string, TestCase[]>();

  for (const tc of failedCases) {
    // Build a fingerprint from exception type + first non-library stack frame.
    // Cases with neither an exception type nor an error message have no
    // reliable signal to cluster on — skip them rather than lumping every
    // unparsed failure into one artificial "unknown" cascade group.
    let fingerprint: string | null = null;

    if (tc.exceptionType) {
      fingerprint = tc.exceptionType;
      if (tc.stackFrames.length > 0) {
        // Use first application frame as part of fingerprint
        const appFrame = tc.stackFrames.find(f => {
          const lower = f.toLowerCase();
          return !lower.includes('node_modules') &&
                 !lower.includes('java.') &&
                 !lower.includes('javax.') &&
                 !lower.includes('internal/');
        });
        if (appFrame) {
          fingerprint += `|${appFrame.trim().substring(0, 100)}`;
        }
      }
    }
    // Group by identical error messages when available — more specific than
    // exception type + stack frame alone.
    if (tc.errorMessage) {
      const cleanedMessage = stripAttemptWrapperPrefix(tc.errorMessage).substring(0, 80);
      // Without an exception type, a shared error message alone is a weak
      // signal — generic reporter boilerplate (e.g. a bare
      // "expect(received).toBeLessThanOrEqual(expected)" assertion header)
      // is identical across many unrelated tests that happen to use the
      // same assertion helper. Require the suite to also match in that
      // case, since two failures with generic-looking messages in
      // completely different suites are almost never the same root cause.
      fingerprint = tc.exceptionType
        ? `${tc.exceptionType}|${cleanedMessage}`
        : `${tc.suite || 'no-suite'}|${cleanedMessage}`;
    }

    if (!fingerprint) continue;

    const existing = groups.get(fingerprint) || [];
    existing.push(tc);
    groups.set(fingerprint, existing);
  }

  // Only create cascade groups with 2+ members
  const cascadingGroups: CascadingGroup[] = [];
  let groupIdx = 0;

  for (const [fingerprint, members] of groups) {
    if (members.length >= 2) {
      groupIdx++;
      const groupId = `CASCADE-${String(groupIdx).padStart(2, '0')}`;

      // Determine root cause from the first member (usually the setup failure)
      const rootCause = members[0].rootCause || fingerprint.split('|')[0];

      cascadingGroups.push({
        groupId,
        rootCause,
        affectedTestIds: members.map(m => m.id),
        fixOnce: true,
      });

      // Mark all members as cascading
      for (const member of members) {
        member.isCascading = true;
        member.cascadeGroupId = groupId;
      }
    }
  }

  return cascadingGroups;
}

// ────────────────────────────────────────────────────────────────────────────
// 9. BUILD SUMMARY EXTRACTION
// ────────────────────────────────────────────────────────────────────────────

function extractBuildSummary(fullText: string, cases: TestCase[]): BuildSummary {
  const failedCases = cases.filter(c => c.status === 'FAILED' || c.status === 'ERROR');
  const hasFailures = failedCases.length > 0;

  // Detect build tool
  let buildTool: string | null = null;
  if (/\[INFO\] BUILD/.test(fullText) || /mvn/.test(fullText)) buildTool = 'Maven';
  else if (/gradle/i.test(fullText) || /BUILD SUCCESSFUL/.test(fullText)) buildTool = 'Gradle';
  else if (/npm\s+(run|test)/i.test(fullText) || /node_modules/i.test(fullText)) buildTool = 'npm';
  else if (/npx\s+playwright/i.test(fullText)) buildTool = 'Playwright';
  else if (/go\s+test/i.test(fullText)) buildTool = 'Go';
  else if (/pytest/i.test(fullText)) buildTool = 'pytest';

  // Detect JDK version
  let jdkVersion: string | null = null;
  const jdkMatch = fullText.match(/(?:java|jdk|openjdk)\s+version\s+"?([^"\s]+)"?/i) ||
                    fullText.match(/JDK\s+(\d+[\d.]*)/i);
  if (jdkMatch) jdkVersion = jdkMatch[1];

  // Detect build duration
  let buildDuration: string | null = null;
  const durationMatch = fullText.match(/Total time:\s*(.+)/i) ||
                         fullText.match(/Finished in\s+(.+)/i) ||
                         fullText.match(/Duration:\s*(.+)/i) ||
                         fullText.match(/Time:\s*([\d.]+\s*(?:s|ms|min))/i);
  if (durationMatch) buildDuration = durationMatch[1].trim();

  // Overall status
  let overallStatus = 'BUILD SUCCESS';
  if (/BUILD FAILURE/i.test(fullText) || /BUILD FAILED/i.test(fullText)) {
    overallStatus = 'BUILD FAILURE';
  } else if (hasFailures) {
    overallStatus = 'UNSTABLE';
  }

  // Top failure categories
  const categoryCounts = new Map<string, number>();
  for (const tc of failedCases) {
    const cat = tc.category || 'Unknown';
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
  }
  const topFailureCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  // Recommended first fix
  let recommendedFirstFix: string | null = null;
  let estimatedFixComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | null = null;

  if (failedCases.length > 0) {
    // Find setup failures first (they cascade)
    const setupFailures = failedCases.filter(c => c.category === 'SetupFailure');
    if (setupFailures.length > 0) {
      recommendedFirstFix = `Fix setup failure: ${setupFailures[0].rootCause || setupFailures[0].errorMessage}. This likely unblocks ${failedCases.length} tests.`;
      estimatedFixComplexity = 'HIGH';
    } else {
      // Highest severity first
      const criticals = failedCases.filter(c => c.severity === 'CRITICAL');
      const target = criticals[0] || failedCases[0];
      recommendedFirstFix = `Fix ${target.category || 'failure'}: ${target.rootCause || target.errorMessage || target.name}`;
      estimatedFixComplexity = target.severity === 'CRITICAL' ? 'HIGH' : target.severity === 'HIGH' ? 'MEDIUM' : 'LOW';
    }
  }

  return {
    overallStatus,
    buildDuration,
    jdkVersion,
    buildTool,
    topFailureCategories,
    recommendedFirstFix,
    estimatedFixComplexity,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 10. PATH PARSER (extracted from analyze.ts for reuse)
// ────────────────────────────────────────────────────────────────────────────

// Jenkins' one-log-per-test-case archive convention names hook logs exactly
// this: beforeAll-log.txt, beforeEach-log.txt, afterAll-log.txt,
// afterEach-log.txt. A failure in one of these isn't "a test called
// beforeEach" — it's a setup/teardown failure that can silently prevent
// every other test in the same suite folder from running at all.
const HOOK_NAME_PATTERN = /^(beforeAll|beforeEach|afterAll|afterEach)$/i;

function isHookLogName(name: string): boolean {
  return HOOK_NAME_PATTERN.test(name.trim());
}

function parseNamesFromPath(path: string): { suite: string; name: string } {
  const cleanPath = path.replace(/-log\.txt$/i, '').replace(/log\.txt$/i, '').replace(/\.txt$/i, '');
  const parts = cleanPath.split('/');
  const lastPart = parts[parts.length - 1];

  if (lastPart.includes('.')) {
    const dotParts = lastPart.split('.');
    if (dotParts.length >= 2) {
      const name = dotParts[dotParts.length - 1];
      const suite = dotParts.slice(0, dotParts.length - 1).join('.');
      return { suite, name };
    }
  }

  if (parts.length >= 2) {
    const suite = parts[parts.length - 2];
    const name = lastPart;
    return { suite, name };
  }

  return { suite: 'DefaultSuite', name: lastPart || 'test' };
}

/**
 * Prefer a clean test name parsed from the log's own content (e.g. a
 * "Test: <suite> > <name>" header) over one derived from a file path, which
 * can be truncated by export tooling (many CI systems cap artifact
 * filenames at ~100 chars) or reduced to an unreadable hyphenated slug.
 */
function resolveNames(
  pathNames: { suite: string; name: string },
  cleanTestName: string | null
): { suite: string; name: string } {
  if (!cleanTestName) return pathNames;

  const separatorMatch = cleanTestName.match(/^(.*?)\s*>\s*([^>]+)$/);
  if (separatorMatch) {
    return { suite: separatorMatch[1].trim(), name: separatorMatch[2].trim() };
  }
  return { suite: pathNames.suite, name: cleanTestName };
}

// ────────────────────────────────────────────────────────────────────────────
// 10b. CONTEXT METADATA EXTRACTION — surfaces info QE needs to debug fast
// ────────────────────────────────────────────────────────────────────────────

// Test-account email a run was executed as — common in E2E/UI automation
// logs, rarely captured today even though it's often the first thing QE
// needs (e.g. "was this a permissions issue for this specific account?").
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// A "Label: https://..." line — many custom reporters print artifact links
// this way (screenshot, HTML diff, a link back to the log itself). Captured
// as {label, url} pairs so the UI can render them as one-click links instead
// of QE having to grep the raw log for a URL.
const LABELED_LINK_LINE = /^\s*([A-Za-z][A-Za-z0-9 /]{2,40}):\s*(https?:\/\/\S+)\s*$/;

// A "Test: <full readable name>" header some custom reporters print — more
// reliable than a (possibly truncated) file path.
const TEST_NAME_HEADER = /^Test:\s*(.+)$/m;

interface ContextMetadata {
  cleanTestName: string | null;
  testUserEmail: string | null;
  relatedLinks: { label: string; url: string }[];
}

function extractContextMetadata(content: string): ContextMetadata {
  const emailMatch = content.match(EMAIL_PATTERN);
  const nameMatch = content.match(TEST_NAME_HEADER);

  const relatedLinks: { label: string; url: string }[] = [];
  const seenUrls = new Set<string>();
  for (const line of content.split('\n')) {
    const linkMatch = line.match(LABELED_LINK_LINE);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        relatedLinks.push({ label: label.trim(), url });
        if (relatedLinks.length >= 5) break;
      }
    }
  }

  return {
    cleanTestName: nameMatch ? nameMatch[1].trim() : null,
    testUserEmail: emailMatch ? emailMatch[0] : null,
    relatedLinks,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 11. PUBLIC API — MAIN ENTRY POINT
// ────────────────────────────────────────────────────────────────────────────

export interface LocalParseInput {
  /** Map of filePath → fileContent for log files */
  logFiles: Map<string, string>;
  /** Full concatenated text for build summary extraction */
  fullText: string;
  /** Original uploaded filename */
  filename: string;
}

/**
 * Parse log files locally using regex+heuristics. Zero AI calls.
 * Returns a complete AnalysisResult with test cases, cascading groups, and build summary.
 */
export function parseLogsLocally(input: LocalParseInput): AnalysisResult {
  const allCases: TestCase[] = [];

  // Parse each log file
  for (const [filePath, content] of input.logFiles) {
    const fileCases = parseLogFile(content, filePath);
    allCases.push(...fileCases);
  }

  // Deduplicate by name + suite
  const seen = new Set<string>();
  const uniqueCases: TestCase[] = [];
  for (const tc of allCases) {
    const key = `${tc.suite || ''}::${tc.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCases.push(tc);
    }
  }

  // Assign sequential IDs
  for (let idx = 0; idx < uniqueCases.length; idx++) {
    uniqueCases[idx].id = `TC-${String(idx + 1).padStart(3, '0')}`;
  }

  // Detect cascading groups
  const cascadingGroups = detectCascadingGroups(uniqueCases);

  // Update cascade group IDs to match the reassigned TC-xxx IDs
  for (const group of cascadingGroups) {
    group.affectedTestIds = group.affectedTestIds.map(oldId => {
      const tc = uniqueCases.find(c => c.id === oldId || c.name === oldId);
      return tc ? tc.id : oldId;
    });
  }

  // Build summary
  const buildSummary = extractBuildSummary(input.fullText, uniqueCases);

  // Compute summary
  const summary = {
    total: uniqueCases.length,
    failed: uniqueCases.filter(c => c.status === 'FAILED').length,
    passed: uniqueCases.filter(c => c.status === 'PASSED').length,
    skipped: uniqueCases.filter(c => c.status === 'SKIPPED').length,
    errors: uniqueCases.filter(c => c.status === 'ERROR').length,
    flaky: uniqueCases.filter(c => c.isFlaky).length,
  };

  return {
    id: uuidv4(),
    filename: input.filename,
    analyzedAt: new Date().toISOString(),
    totalChunks: 0,  // No AI chunks
    buildSummary,
    cascadingGroups,
    cases: uniqueCases,
    summary,
  };
}
