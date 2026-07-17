import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TestCase, ProjectConfig, AIProviderConfig } from '../types/analysis';

const { callAI } = vi.hoisted(() => ({ callAI: vi.fn() }));
vi.mock('./aiAnalyzer', () => ({ callAI }));

const { getFixSuggestions } = await import('./fixSuggester');

function makeFailure(id: string): TestCase {
  return {
    id,
    name: `test_${id}`,
    suite: 'SomeSuite',
    status: 'FAILED',
    duration: null,
    isFlaky: false,
    isCascading: false,
    cascadeGroupId: null,
    exceptionType: 'AssertionError',
    errorMessage: 'expected true to be false',
    stackFrames: [],
    rootCause: null,
    symptomVsCause: null,
    severity: 'MEDIUM',
    category: 'AssertionError',
    fixSuggestion: null,
    fixComplexity: null,
    logEvidenceQuote: null,
    parserConfidence: 'HIGH',
  };
}

const config: ProjectConfig = {
  projectType: 'Node',
  testFramework: 'Jest',
  environment: 'CI',
  knownFlaky: '',
};
const aiConfig: AIProviderConfig = { provider: 'anthropic', apiKey: 'test-key', model: 'claude-3-5-sonnet-latest' };

function fixesResponseFor(cases: TestCase[]): string {
  return JSON.stringify({
    fixes: cases.map((c) => ({ id: c.id, fixSuggestion: `Fix for ${c.id}`, fixComplexity: 'LOW' })),
  });
}

beforeEach(() => {
  callAI.mockReset();
});

describe('getFixSuggestions batching', () => {
  it('makes exactly one AI call when failures fit in a single batch', async () => {
    const cases = Array.from({ length: 10 }, (_, i) => makeFailure(`TC-${i}`));
    callAI.mockResolvedValueOnce(fixesResponseFor(cases));

    const result = await getFixSuggestions(cases, config, aiConfig);

    expect(callAI).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(10);
  });

  it('splits more than BATCH_SIZE (15) failures into multiple AI calls and merges results', async () => {
    const cases = Array.from({ length: 32 }, (_, i) => makeFailure(`TC-${i}`));

    callAI.mockImplementation(async (_config, _system, messages: { content: string }[]) => {
      // Echo back fixes for whatever IDs appear in this batch's prompt.
      const ids = [...messages[0].content.matchAll(/TC-\d+/g)].map((m) => m[0]);
      const unique = [...new Set(ids)];
      return JSON.stringify({ fixes: unique.map((id) => ({ id, fixSuggestion: `Fix for ${id}`, fixComplexity: 'MEDIUM' })) });
    });

    const result = await getFixSuggestions(cases, config, aiConfig);

    // ceil(32 / 15) = 3 calls
    expect(callAI).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(32);
    for (const c of cases) {
      expect(result.get(c.id)?.fixSuggestion).toBe(`Fix for ${c.id}`);
    }
  });

  it('requests a larger output token budget than the old hardcoded 4000 default', async () => {
    const cases = [makeFailure('TC-1')];
    callAI.mockResolvedValueOnce(fixesResponseFor(cases));

    await getFixSuggestions(cases, config, aiConfig);

    const maxTokensArg = callAI.mock.calls[0][3];
    expect(maxTokensArg).toBeGreaterThan(4000);
  });

  it('skips a failed batch but still returns results from the batches that succeeded', async () => {
    const cases = Array.from({ length: 20 }, (_, i) => makeFailure(`TC-${i}`));

    let call = 0;
    callAI.mockImplementation(async (_config, _system, messages: { content: string }[]) => {
      call++;
      if (call === 1) {
        throw new Error('rate limited');
      }
      const ids = [...messages[0].content.matchAll(/TC-\d+/g)].map((m) => m[0]);
      const unique = [...new Set(ids)];
      return JSON.stringify({ fixes: unique.map((id) => ({ id, fixSuggestion: `Fix for ${id}`, fixComplexity: 'LOW' })) });
    });

    const result = await getFixSuggestions(cases, config, aiConfig);

    // First batch (15 cases) failed; second batch (5 cases) succeeded.
    expect(result.size).toBe(5);
    expect(result.size).toBeLessThan(cases.length);
  });

  it('throws only when every batch fails', async () => {
    const cases = Array.from({ length: 5 }, (_, i) => makeFailure(`TC-${i}`));
    callAI.mockRejectedValue(new Error('provider unreachable'));

    await expect(getFixSuggestions(cases, config, aiConfig)).rejects.toThrow(/all batches/i);
  });

  it('returns an empty map without calling the AI when there are no failed cases', async () => {
    const result = await getFixSuggestions([], config, aiConfig);
    expect(result.size).toBe(0);
    expect(callAI).not.toHaveBeenCalled();
  });
});
