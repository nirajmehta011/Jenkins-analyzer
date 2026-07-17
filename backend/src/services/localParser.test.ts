import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseLogFile, parseLogsLocally, detectCascadingGroups } from './localParser';
import type { TestCase } from '../types/analysis';

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, '../../test/fixtures', name), 'utf-8');
}

describe('parseLogFile — per-framework extraction', () => {
  it('parses Maven Surefire plain-text output: inline method failure + summary-only suite', () => {
    const content = loadFixture('junit-surefire-summary-only.log');
    const cases = parseLogFile(content, 'build.log');

    // OrderServiceTest: has an inline "<<< FAILURE!" line -> parsed directly.
    const orderFailure = cases.find(c => c.suite === 'com.example.orders.OrderServiceTest');
    expect(orderFailure).toBeDefined();
    expect(orderFailure!.status).toBe('FAILED');
    expect(orderFailure!.name).toBe('testCreateOrder');
    expect(orderFailure!.exceptionType).toBe('java.lang.AssertionError');

    // InventoryServiceTest: only an aggregate "Tests run: 3, Errors: 1" line,
    // no inline method failure — this is the dead-loop regression case.
    // It must still surface as a failure via the safety-net aggregate case.
    const inventoryFailure = cases.find(c => c.suite === 'com.example.orders.InventoryServiceTest');
    expect(inventoryFailure).toBeDefined();
    expect(inventoryFailure!.status).toBe('ERROR');

    // PricingServiceTest fully passed (0 failures, 0 errors) — no case at all.
    const pricing = cases.find(c => c.suite === 'com.example.orders.PricingServiceTest');
    expect(pricing).toBeUndefined();

    // Exactly one case per failing suite — the safety net must not duplicate
    // a case for a suite that already got an inline method-failure case.
    const orderCases = cases.filter(c => c.suite === 'com.example.orders.OrderServiceTest');
    expect(orderCases).toHaveLength(1);
  });

  it('detects a build failure that never contains the literal substring "fail " (regression for the old gate bug)', () => {
    const content = loadFixture('build-failed-no-space-marker.log');
    expect(content.toLowerCase()).not.toContain('fail ');

    const cases = parseLogFile(content, 'build.log');
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0].status).toBe('FAILED');
    expect(cases[0].suite).toBe('com.example.billing.InvoiceServiceTest');
  });

  it('produces zero cases for a fully passing build (no false positives)', () => {
    const content = loadFixture('all-passed.log');
    expect(parseLogFile(content, 'build.log')).toHaveLength(0);
  });

  it('parses pytest FAILED markers', () => {
    const content = loadFixture('pytest-failures.log');
    const cases = parseLogFile(content, 'pytest.log');

    expect(cases).toHaveLength(2);
    const logout = cases.find(c => c.name === 'test_logout');
    expect(logout).toBeDefined();
    expect(logout!.suite).toBe('tests/test_auth.py');
    expect(logout!.category).toBe('AssertionError');

    const charge = cases.find(c => c.name === 'test_charge_card');
    expect(charge!.category).toBe('ConnectionError');
  });

  it('parses Playwright numbered failures including timeouts', () => {
    const content = loadFixture('playwright-failures.log');
    const cases = parseLogFile(content, 'playwright.log');

    expect(cases).toHaveLength(2);
    expect(cases.some(c => c.category === 'Timeout')).toBe(true);
  });

  it('parses Jest ● failures', () => {
    const content = loadFixture('jest-failures.log');
    const cases = parseLogFile(content, 'jest.log');

    expect(cases).toHaveLength(1);
    expect(cases[0].name).toBe('should apply discount code');
    expect(cases[0].exceptionType).toBe('TypeError');
  });

  it('parses Go test failures and skips passing subtests', () => {
    const content = loadFixture('go-test-failures.log');
    const cases = parseLogFile(content, 'go.log');

    expect(cases).toHaveLength(1);
    expect(cases[0].name).toBe('TestDeleteUser');
    expect(cases[0].status).toBe('FAILED');
  });

  it('parses Cypress ✗ failures', () => {
    const content = loadFixture('cypress-failures.log');
    const cases = parseLogFile(content, 'cypress.log');

    expect(cases).toHaveLength(1);
    expect(cases[0].name).toBe('should display revenue chart');
  });

  it('trusts an authoritative standalone PASS line over an incidental passing expect() trace line (real-world regression)', () => {
    // Reproduces a real false positive: a verbose custom reporter logs every
    // assertion step (including passing ones like expect(true).toBe(true)),
    // and the file ends with a bare "PASS". The old fallback heuristic
    // grabbed the last expect(...)-shaped line as "failure evidence"
    // regardless of whether it actually failed, ignoring the file's own
    // authoritative final verdict.
    const content = loadFixture('verbose-trace-false-positive.log');
    expect(parseLogFile(content, 'test.log')).toHaveLength(0);
  });

  it('trusts the final PASS over earlier FAIL markers for a test that failed then passed on retry', () => {
    const content = loadFixture('retry-then-pass.log');
    expect(parseLogFile(content, 'test.log')).toHaveLength(0);
  });

  it('extracts a clean test name, test-user email, and artifact links from a genuine failure', () => {
    const content = loadFixture('genuine-failure-with-metadata.log');
    const cases = parseLogFile(content, 'truncated-filename-that-loses-the-real-i-log.txt');

    expect(cases).toHaveLength(1);
    const tc = cases[0];

    // Real name/suite come from the "Test:" header, not the truncated path.
    expect(tc.suite).toBe('New CC E2E Validate Resource Files Effect On Embedded Form');
    expect(tc.name).toBe('New CC - E2E Validate changes should be visible based on resource applied in Embedded Form Onsite and Preview / NewCC-DQE-T170');

    expect(tc.testUserEmail).toBe('automation_user_6@example.com');
    expect(tc.relatedLinks).toEqual([
      { label: 'Screenshot', url: 'https://jenkins.example.com/job/digital/artifact/logs/argus/DQE-T170-FAILURE.png' },
      { label: 'HTML Source', url: 'https://jenkins.example.com/job/digital/artifact/logs/argus/DQE-T170-FAILURE.html' },
    ]);
  });

  it('attaches attemptCount for a multi-attempt failure', () => {
    const content = loadFixture('genuine-failure-with-metadata.log');
    const cases = parseLogFile(content, 'test.log');
    expect(cases[0].attemptCount).toBe(1);
  });

  it('flags a beforeEach/beforeAll/afterEach/afterAll hook failure as a CRITICAL SetupFailure, not a generic test case', () => {
    const content = loadFixture('hook-failure-beforeEach.log');
    const cases = parseLogFile(content, 'suite-folder/beforeEach-log.txt');

    expect(cases).toHaveLength(1);
    const tc = cases[0];
    expect(tc.isHookFailure).toBe(true);
    expect(tc.category).toBe('SetupFailure');
    expect(tc.severity).toBe('CRITICAL');
  });

  it('does not call a test flaky just because it failed identically on every attempt, even with an incidental "retry" mention elsewhere in the log', () => {
    // Real-world bug: isFlaky used to scan the ENTIRE raw file for ~18 broad
    // keywords (timeout/retry/connection/etc), so an unrelated mention of
    // "retry policy" elsewhere in an 8000-line log would flag a rock-solid,
    // 100%-reproducible bug as "flaky" and downgrade it to LOW severity —
    // directly contradicting the RCA's own "stable and reproducible" text.
    const content = loadFixture('persistent-identical-failure.log');
    const cases = parseLogFile(content, 'test.log');

    expect(cases).toHaveLength(1);
    expect(cases[0].isFlaky).toBe(false);
    expect(cases[0].severity).not.toBe('LOW');
    expect(cases[0].rootCause).toMatch(/stable, reproducible issue/i);
  });

  it('extracts the concrete numbered-step value instead of a generic assertion signature, and prefers Main Run for category when attempts genuinely differ', () => {
    // Real-world case: attempt 1 fails a screenshot-diff assertion with
    // concrete values (expect(4799).toBeLessThanOrEqual(1000)); attempts 2-3
    // hit an unrelated navigation timeout. The old code (a) used the
    // generic, value-less "expect(received).toBeLessThanOrEqual(expected)"
    // header instead of the concrete numbers sitting a few lines away, and
    // (b) classified the whole case by the LAST attempt (Timeout) even
    // though the original/primary issue was the assertion — the opposite of
    // what its own RCA text recommends ("focus on Main Run").
    const content = loadFixture('mixed-assertion-then-timeout.log');
    const cases = parseLogFile(content, 'test.log');

    expect(cases).toHaveLength(1);
    const tc = cases[0];

    expect(tc.errorMessage).toContain('expect(4799).toBeLessThanOrEqual(1000)');
    expect(tc.errorMessage).not.toContain('expect(received)');
    expect(tc.errorMessage).toContain('Timed out waiting for condition to resolve.');
    expect(tc.errorMessage).not.toContain('Unknown failure detail');

    // Attempts genuinely differ (assertion vs timeout) -> correctly flaky,
    // but classified by the Main Run's real issue, not the retry's.
    expect(tc.isFlaky).toBe(true);
    expect(tc.category).toBe('AssertionError');
    expect(tc.symptomVsCause?.cause).toContain('4799');
  });

  it('falls through to a plain-English failure sentence when no structured Error:/exception line exists', () => {
    const content = loadFixture('mixed-assertion-then-timeout.log');
    const cases = parseLogFile(content, 'test.log');
    expect(cases[0].errorMessage).toContain('Timed out waiting for condition to resolve.');
  });

  it('falls back to numbered execution-step lines as a pseudo stack trace when no recognized stack-trace format matches', () => {
    const content = loadFixture('mixed-assertion-then-timeout.log');
    const cases = parseLogFile(content, 'test.log');
    expect(cases[0].stackFrames.length).toBeGreaterThan(0);
    expect(cases[0].stackFrames.some(f => /^\d+\)/.test(f))).toBe(true);
  });

  it('does not let an interleaved afterEach hook failure inflate the attempt count or leak its content into the test\'s own evidence', () => {
    // Real-world regression: a single log.txt interleaved the test's own
    // FAIL, then a PASS (a later/unrelated pass), then a FAIL afterEach hook
    // failure. The old code counted both FAILs as "2 attempts of this test"
    // and let the window bleed across the PASS boundary, so a FAILED case's
    // evidence sometimes literally contained the word "PASS".
    const content = loadFixture('interleaved-hook-and-test-failures.log');
    const cases = parseLogFile(content, 'test.log');

    expect(cases).toHaveLength(1);
    const tc = cases[0];
    expect(tc.attemptCount).toBe(1);
    expect(tc.isHookFailure).toBe(false);
    expect(tc.errorMessage).toContain('File uploaded successfully');
    expect(tc.errorMessage).not.toContain('PASS');
    expect(tc.errorMessage).not.toContain('upstream connect');
    expect(tc.logEvidenceQuote).not.toContain('PASS');
  });
});

describe('detectCascadingGroups — fingerprint collision regression', () => {
  function unparsedFailure(id: string, name: string): TestCase {
    // A failure the parser found evidence of ("fail" marker) but couldn't
    // extract a real exception type or error message from — this is the
    // shape that used to fingerprint to the literal string 'unknown'.
    return {
      id,
      name,
      suite: null,
      status: 'FAILED',
      duration: null,
      isFlaky: false,
      isCascading: false,
      cascadeGroupId: null,
      exceptionType: null,
      errorMessage: null,
      stackFrames: [],
      rootCause: null,
      symptomVsCause: null,
      severity: 'LOW',
      category: 'Unknown',
      fixSuggestion: null,
      fixComplexity: null,
      logEvidenceQuote: null,
      parserConfidence: 'LOW',
      testUserEmail: null,
      relatedLinks: [],
      attemptCount: null,
      isHookFailure: false,
    };
  }

  it('does not merge unrelated evidence-less failures into one fake cascade group', () => {
    const cases = [unparsedFailure('TC-001', 'testA'), unparsedFailure('TC-002', 'testB')];
    const groups = detectCascadingGroups(cases);
    expect(groups).toHaveLength(0);
  });

  it('still groups genuinely related failures sharing the same exception + message', () => {
    const shared = (id: string, name: string): TestCase => ({
      ...unparsedFailure(id, name),
      exceptionType: 'java.lang.NullPointerException',
      errorMessage: 'Cannot invoke "Config.get()" because config is null',
    });
    const cases = [shared('TC-001', 'testA'), shared('TC-002', 'testB'), shared('TC-003', 'testC')];
    const groups = detectCascadingGroups(cases);
    expect(groups).toHaveLength(1);
    expect(groups[0].affectedTestIds).toHaveLength(3);
  });

  it('does not merge unrelated multi-attempt failures that only share analyzeMultiAttempts\' boilerplate wrapper text (real-world regression)', () => {
    // Real data: many unrelated tests (different suites, different actual
    // causes) all produced an errorMessage starting with the identical
    // "Failed persistently after N attempts (...): • Main Run: ..." wrapper
    // that analyzeMultiAttempts() always generates. Without stripping that
    // wrapper before fingerprinting, the first 80 chars were pure
    // boilerplate for every one of them, merging 16 unrelated failures into
    // one fake "fix once unblocks all" cascade group.
    const wrapped = (id: string, suite: string, uniqueTail: string): TestCase => ({
      ...unparsedFailure(id, 'someTest'),
      suite,
      errorMessage: `Failed persistently after 3 attempts (1 main execution + 2 retries):\n  • Main Run: ${uniqueTail}\n  • Retry #1: ...\n  • Retry #2: ...`,
    });

    const cases = [
      wrapped('TC-001', 'LoginSuite', 'expect(received).toBeLessThanOrEqual(expected)'),
      wrapped('TC-002', 'RuleEngineSuite', 'expect(received).toBeLessThanOrEqual(expected)'),
      wrapped('TC-003', 'TranslationSuite', 'expect(received).toBeLessThanOrEqual(expected)'),
    ];

    const groups = detectCascadingGroups(cases);
    expect(groups).toHaveLength(0);
  });

  it('still groups multi-attempt failures with the same generic message when they are in the same suite', () => {
    const wrapped = (id: string): TestCase => ({
      ...unparsedFailure(id, 'someTest'),
      suite: 'FormPreviewSuite',
      errorMessage: `Failed persistently after 3 attempts (1 main execution + 2 retries):\n  • Main Run: expect(received).toBeLessThanOrEqual(expected)`,
    });

    const cases = [wrapped('TC-001'), wrapped('TC-002')];
    const groups = detectCascadingGroups(cases);
    expect(groups).toHaveLength(1);
    expect(groups[0].affectedTestIds).toHaveLength(2);
  });
});

describe('parseLogsLocally — end-to-end aggregation', () => {
  it('aggregates multiple fixture files with correct summary counts', () => {
    const logFiles = new Map<string, string>([
      ['surefire.log', loadFixture('junit-surefire-summary-only.log')],
      ['pytest.log', loadFixture('pytest-failures.log')],
    ]);
    const result = parseLogsLocally({
      logFiles,
      fullText: [...logFiles.values()].join('\n'),
      filename: 'combined.zip',
    });

    expect(result.summary.failed + result.summary.errors).toBeGreaterThanOrEqual(4);
    expect(result.cases.every(c => /^TC-\d{3}$/.test(c.id))).toBe(true);
  });

  it('reports BUILD SUCCESS-equivalent zero failures for an all-passing log', () => {
    const logFiles = new Map<string, string>([['build.log', loadFixture('all-passed.log')]]);
    const result = parseLogsLocally({
      logFiles,
      fullText: loadFixture('all-passed.log'),
      filename: 'build.log',
    });

    expect(result.summary.failed).toBe(0);
    expect(result.summary.errors).toBe(0);
  });
});

describe('evidenceContext — structured log evidence for QE', () => {
  it('extracts Expected/Received, duration, and the preceding execution step around a failure', () => {
    const content = loadFixture('genuine-failure-with-metadata.log');
    const cases = parseLogFile(content, 'test.log');

    const ctx = cases[0].evidenceContext;
    expect(ctx).not.toBeNull();
    expect(ctx!.expected).toBe('<= 1000');
    expect(ctx!.received).toBe('4799');
    expect(ctx!.duration).toBe('1.1s');
    expect(ctx!.precedingSteps).toHaveLength(1);
    expect(ctx!.precedingSteps[0]).toContain('Login');
  });

  it('extracts the page URL when a "on https://..." line is present near the failure', () => {
    const content = loadFixture('mixed-assertion-then-timeout.log');
    const cases = parseLogFile(content, 'test.log');

    const ctx = cases[0].evidenceContext;
    expect(ctx).not.toBeNull();
    expect(ctx!.pageUrl).toBe('https://digital-cloud-qa-web.medallia.com/#/app/property/19858/pages/forms');
  });

  it('does not fabricate a page URL, preceding steps, or duration when none are present nearby', () => {
    const content = loadFixture('interleaved-hook-and-test-failures.log');
    const cases = parseLogFile(content, 'test.log');

    const ctx = cases[0].evidenceContext;
    expect(ctx).not.toBeNull();
    expect(ctx!.expected).toBe('File uploaded successfully');
    expect(ctx!.received).toBe('A file with this name already exists');
    expect(ctx!.pageUrl).toBeNull();
    expect(ctx!.precedingSteps).toHaveLength(0);
  });
});
