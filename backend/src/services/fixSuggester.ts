import type {
  TestCase,
  ProjectConfig,
  AIProviderConfig,
} from '../types/analysis';
import { callAI } from './aiAnalyzer';

// Failed cases are batched rather than sent in one unbounded call: callAI's
// output token budget is finite, so a build with dozens of failures would
// otherwise truncate the AI's JSON response mid-object and silently drop
// fixes for the tail of the list.
const BATCH_SIZE = 15;
const FIX_SUGGESTION_MAX_TOKENS = 8000;

type FixResult = { fixSuggestion: string; fixComplexity: 'LOW' | 'MEDIUM' | 'HIGH' };

/**
 * Build a compact summary of failed test cases for the AI prompt.
 * Minimizes token usage by only including the essential info.
 */
function buildFailureSummary(cases: TestCase[]): string {
  return cases.map((tc, idx) => {
    const parts = [
      `[${idx + 1}] ${tc.id}: ${tc.name}`,
      tc.suite ? `  Suite: ${tc.suite}` : null,
      tc.exceptionType ? `  Exception: ${tc.exceptionType}` : null,
      tc.errorMessage ? `  Error: ${tc.errorMessage.substring(0, 200)}` : null,
      tc.rootCause ? `  Root Cause: ${tc.rootCause.substring(0, 200)}` : null,
      tc.category ? `  Category: ${tc.category}` : null,
      tc.stackFrames.length > 0
        ? `  Stack (top 3):\n${tc.stackFrames.slice(0, 3).map(f => `    ${f}`).join('\n')}`
        : null,
    ];
    return parts.filter(Boolean).join('\n');
  }).join('\n\n');
}

function parseFixResponse(text: string): { fixes: Array<{ id: string; fixSuggestion: string; fixComplexity: string }> } {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON found');
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  return JSON.parse(cleaned);
}

/**
 * Request AI fix suggestions for a single batch of failed cases (one AI call,
 * with one retry on malformed JSON). Never throws for provider/parse
 * failures — logs via onProgress and returns an empty map so the caller can
 * continue with remaining batches rather than losing the whole request.
 */
async function requestFixBatch(
  batch: TestCase[],
  config: ProjectConfig,
  aiConfig: AIProviderConfig,
  batchLabel: string,
  onProgress?: (message: string) => void,
): Promise<Map<string, FixResult>> {
  const systemPrompt = `You are an expert CI/CD debugging assistant.

Project context:
- Project type: ${config.projectType}
- Test framework: ${config.testFramework}
- Environment: ${config.environment}

You will receive a summary of ${batch.length} failed test cases with their exceptions, error messages, root causes, and stack traces.

Your job: provide ACTIONABLE fix suggestions for each failure.

Return ONLY a JSON object matching this schema:
{
  "fixes": [
    {
      "id": "TC-001",
      "fixSuggestion": "Detailed, actionable fix suggestion with code examples if applicable",
      "fixComplexity": "LOW | MEDIUM | HIGH"
    }
  ]
}

Rules:
1. Every test case ID from the input MUST appear in the output.
2. fixSuggestion must be specific and actionable — not generic advice.
3. If multiple tests share the same root cause, say "Same fix as TC-XXX" to keep it concise.
4. fixComplexity: LOW = config/data change, MEDIUM = code change, HIGH = architecture/design change.
5. Return ONLY the JSON object. No markdown, no backticks, no explanation.`;

  const failureSummary = buildFailureSummary(batch);

  const userPrompt = `Here are ${batch.length} failed test cases. Provide fix suggestions for each one.

===== FAILURES START =====
${failureSummary}
===== FAILURES END =====

Return the JSON object with fixes for all ${batch.length} test cases.`;

  onProgress?.(`Requesting AI fixes for ${batchLabel} (${batch.length} case${batch.length === 1 ? '' : 's'})...`);

  const resultMap = new Map<string, FixResult>();

  let responseText: string;
  try {
    responseText = await callAI(aiConfig, systemPrompt, [{ role: 'user', content: userPrompt }], FIX_SUGGESTION_MAX_TOKENS);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown AI error';
    onProgress?.(`⚠ AI request failed for ${batchLabel}: ${errMsg}`);
    return resultMap;
  }

  let parsed: { fixes: Array<{ id: string; fixSuggestion: string; fixComplexity: string }> };
  try {
    parsed = parseFixResponse(responseText);
  } catch {
    try {
      const retryResponse = await callAI(
        aiConfig,
        systemPrompt,
        [
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: responseText },
          { role: 'user', content: 'Your response was not valid JSON. Return ONLY the JSON object — no backticks, no markdown.' },
        ],
        FIX_SUGGESTION_MAX_TOKENS
      );
      parsed = parseFixResponse(retryResponse);
    } catch {
      onProgress?.(`⚠ Could not parse AI response for ${batchLabel} after retry — skipping this batch`);
      return resultMap;
    }
  }

  if (parsed.fixes && Array.isArray(parsed.fixes)) {
    for (const fix of parsed.fixes) {
      const complexity = (['LOW', 'MEDIUM', 'HIGH'].includes(fix.fixComplexity?.toUpperCase())
        ? fix.fixComplexity.toUpperCase()
        : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH';

      resultMap.set(fix.id, {
        fixSuggestion: fix.fixSuggestion || 'No suggestion available',
        fixComplexity: complexity,
      });
    }
  }

  return resultMap;
}

/**
 * Request AI fix suggestions for failed test cases, batching requests so
 * each AI call stays within its output token budget regardless of how many
 * failures are in the build. A batch that fails (provider error or
 * unparseable response) is skipped rather than aborting the whole request —
 * callers can tell which cases got no fix by checking the returned map size
 * against failedCases.length.
 */
export async function getFixSuggestions(
  failedCases: TestCase[],
  config: ProjectConfig,
  aiConfig: AIProviderConfig,
  onProgress?: (message: string) => void,
): Promise<Map<string, FixResult>> {
  if (failedCases.length === 0) {
    return new Map();
  }

  onProgress?.(`Preparing ${failedCases.length} failures for AI analysis...`);

  const batches: TestCase[][] = [];
  for (let i = 0; i < failedCases.length; i += BATCH_SIZE) {
    batches.push(failedCases.slice(i, i + BATCH_SIZE));
  }

  const resultMap = new Map<string, FixResult>();

  for (let i = 0; i < batches.length; i++) {
    const batchLabel = batches.length > 1 ? `batch ${i + 1} of ${batches.length}` : 'all failures';
    const batchResults = await requestFixBatch(batches[i], config, aiConfig, batchLabel, onProgress);
    for (const [id, fix] of batchResults) {
      resultMap.set(id, fix);
    }
  }

  if (resultMap.size === 0) {
    throw new Error('AI fix suggestions failed for all batches — check your API key and provider configuration.');
  }

  onProgress?.(`Received fixes for ${resultMap.size} of ${failedCases.length} cases`);

  return resultMap;
}
