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

// Stack frames
const JAVA_STACK = /^\s+at\s+([\w.$]+)\.([\w<>]+)\(([^)]+)\)/;
const JS_STACK = /^\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/;
const PYTHON_STACK = /^\s+File\s+"([^"]+)",\s+line\s+(\d+)/;
const GO_STACK = /^\s+([\w./]+\.go):(\d+)/;

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

  let exceptionType: string | null = null;
  let errorMessage: string | null = null;
  let logEvidenceQuote: string | null = null;

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
      break;
    }

    // Try JS/TS error
    const jsMatch = line.match(JS_ERROR);
    if (jsMatch) {
      exceptionType = jsMatch[1];
      errorMessage = jsMatch[2];
      logEvidenceQuote = grabContext(i);
      break;
    }

    // Try Python error
    const pyMatch = line.match(PYTHON_ERROR);
    if (pyMatch) {
      exceptionType = pyMatch[1];
      errorMessage = pyMatch[2] || null;
      logEvidenceQuote = grabContext(i);
      break;
    }

    // Try generic error line
    const genMatch = line.match(GENERIC_ERROR);
    if (genMatch) {
      errorMessage = genMatch[1].trim();
      logEvidenceQuote = grabContext(i);
      break;
    }
  }

  // 3. Fallback to assertion messages if no strong error was found
  if (!errorMessage && !exceptionType) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      if (isNoiseLine(line)) continue;

      if (/(?:expected|actual|assert|expect|received)/i.test(line) && line.length < 500) {
        // Search upwards (up to 5 lines) to find the expect(...) call line which is more descriptive
        let mainLine = line;
        for (let j = Math.max(0, i - 5); j <= i; j++) {
          const upLine = lines[j].trim();
          if (/(?:expect|assert|toBe|toEqual)/i.test(upLine) && !isNoiseLine(upLine)) {
            mainLine = upLine;
            break;
          }
        }
        errorMessage = mainLine;
        logEvidenceQuote = grabContext(i);
        break;
      }
    }
  }

  return { exceptionType, errorMessage, stackFrames, logEvidenceQuote };
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
  const markerIndices: number[] = [];

  // Find all lines containing "fail " or "FAIL " (case insensitive, with space)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bfail(ed)?\s/i.test(line)) {
      if (!isNoiseLine(line)) {
        markerIndices.push(i);
      }
    }
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
    // Slice a window around each marker (20 lines before, 30 lines after)
    const startIdx = Math.max(0, idx - 20);
    const endIdx = Math.min(lines.length - 1, idx + 30);
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

  const category = classifyException(finalError.exceptionType, finalError.errorMessage);
  const isFlaky = numAttempts > 1 && FLAKY_PATTERNS.some(p => p.test(content));
  const severity = assignSeverity(category, isFlaky, finalError.exceptionType);

  // 2. Compose highly descriptive failure symptoms
  let symptoms = `SUMMARY OF FAILURE SYMPTOMS:\n`;
  symptoms += `---------------------------\n`;
  symptoms += `• Final Failure Code/Type: ${finalError.exceptionType || 'Generic Uncaught Failure'}\n`;
  symptoms += `• Final Failure Message: ${finalError.errorMessage || 'No specific exception message found'}\n`;
  
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
    const errorsAreIdentical = parsedErrors.every(e => e.errorMessage === firstError.errorMessage);
    if (errorsAreIdentical) {
      rca += `   - Analysis: The failure was persistent and identical across all attempts. This rules out random network hiccups, system load delays, or minor scheduling jitter. It confirms a stable and reproducible issue, likely caused by incorrect test environment configuration, missing data dependencies, or a logic regression in the application under test.\n\n`;
    } else {
      rca += `   - Analysis: The failure message changed between retry attempts. This suggests a cascading state issue—for example, the first run's failure might have mutated database records, left browser sessions active, or locked files, causing subsequent attempts to fail with different secondary errors. Focus your investigation on the Main Run error details.\n\n`;
    }
  } else {
    rca += `   - Total Execution Attempts: 1 (Test runner aborted immediately or was configured with 0 retries).\n`;
    rca += `   - Analysis: The failure occurred on the first execution. Review the details below to determine if this is transient or persistent.\n\n`;
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
  const dynamicAnalysedCause = deriveDynamicAnalysedCause(finalError, category);
  rca += `   - ${dynamicAnalysedCause}`;

  const { suite, name } = parseNamesFromPath(filePath);

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
    logEvidenceQuote: finalError.logEvidenceQuote || firstError.logEvidenceQuote,
    parserConfidence: finalError.exceptionType ? 'HIGH' : (finalError.errorMessage ? 'MEDIUM' : 'LOW'),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 7. PER-FILE LOG PARSER
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a single log file content into TestCase objects.
 * Handles multiple test framework formats.
 */
function parseLogFile(
  content: string,
  filePath: string
): TestCase[] {
  const lines = content.split('\n');
  const cases: TestCase[] = [];

  // ── Strategy A: Look for structured test result patterns ───────────

  // 1. JUnit / Surefire / TestNG results
  let currentSuite: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const suiteMatch = line.match(JUNIT_SUITE_START);
    if (suiteMatch) {
      currentSuite = suiteMatch[1];
      continue;
    }

    // "Tests run: N, Failures: N, Errors: N, Skipped: N, Time elapsed: Ns - in com.x.y.TestClass"
    const summaryMatch = line.match(JUNIT_SUMMARY);
    if (summaryMatch) {
      const inClassMatch = line.match(/in\s+([\w.$]+)/);
      if (inClassMatch) {
        currentSuite = inClassMatch[1];
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
      });
    }
  }

  // ── Strategy B: Fallback — whole-file error extraction ────────────
  // If no framework-specific patterns matched, treat the entire file as one test
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
        const { suite, name } = parseNamesFromPath(filePath);
        const category = classifyException(error.exceptionType, error.errorMessage);
        const isFlaky = FLAKY_PATTERNS.some(p => p.test(content));
        const severity = assignSeverity(category, isFlaky, error.exceptionType);

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
        });
      }
    }
  }

  return cases;
}

// ────────────────────────────────────────────────────────────────────────────
// 8. CASCADING GROUP DETECTION
// ────────────────────────────────────────────────────────────────────────────

function detectCascadingGroups(cases: TestCase[]): CascadingGroup[] {
  const failedCases = cases.filter(c => c.status === 'FAILED' || c.status === 'ERROR');
  if (failedCases.length < 2) return [];

  // Group by root exception type + first app stack frame
  const groups = new Map<string, TestCase[]>();

  for (const tc of failedCases) {
    // Build a fingerprint from exception type + first non-library stack frame
    let fingerprint = tc.exceptionType || 'unknown';
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
    // Also group by identical error messages
    if (tc.errorMessage) {
      fingerprint = `${tc.exceptionType || 'error'}|${tc.errorMessage.substring(0, 80)}`;
    }

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
