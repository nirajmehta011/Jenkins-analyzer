import type {
  TestCase,
  ProjectConfig,
  AIProviderConfig,
} from '../types/analysis';
import { callAI } from './aiAnalyzer';

/**
 * Build a compact summary of all failed test cases for the AI prompt.
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

/**
 * Request AI fix suggestions for a batch of failed test cases.
 * Makes exactly ONE AI call for all failures combined.
 * Returns a map of testCaseId → { fixSuggestion, fixComplexity }.
 */
export async function getFixSuggestions(
  failedCases: TestCase[],
  config: ProjectConfig,
  aiConfig: AIProviderConfig,
  onProgress?: (message: string) => void,
): Promise<Map<string, { fixSuggestion: string; fixComplexity: 'LOW' | 'MEDIUM' | 'HIGH' }>> {
  if (failedCases.length === 0) {
    return new Map();
  }

  onProgress?.(`Preparing ${failedCases.length} failures for AI analysis...`);

  const systemPrompt = `You are an expert CI/CD debugging assistant.

Project context:
- Project type: ${config.projectType}
- Test framework: ${config.testFramework}
- Environment: ${config.environment}

You will receive a summary of ${failedCases.length} failed test cases with their exceptions, error messages, root causes, and stack traces.

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

  const failureSummary = buildFailureSummary(failedCases);

  const userPrompt = `Here are ${failedCases.length} failed test cases. Provide fix suggestions for each one.

===== FAILURES START =====
${failureSummary}
===== FAILURES END =====

Return the JSON object with fixes for all ${failedCases.length} test cases.`;

  onProgress?.('Sending batched request to AI...');

  let responseText: string;
  try {
    responseText = await callAI(aiConfig, systemPrompt, [{ role: 'user', content: userPrompt }]);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown AI error';
    throw new Error(`AI fix suggestions failed: ${errMsg}`);
  }

  onProgress?.('Parsing AI response...');

  // Parse the response
  let parsed: { fixes: Array<{ id: string; fixSuggestion: string; fixComplexity: string }> };
  try {
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('No JSON found');
    }
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    // Retry with explicit JSON instruction
    try {
      const retryResponse = await callAI(aiConfig, systemPrompt, [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: responseText },
        { role: 'user', content: 'Your response was not valid JSON. Return ONLY the JSON object — no backticks, no markdown.' },
      ]);
      let cleaned = retryResponse.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('Failed to parse AI fix suggestion response after retry');
    }
  }

  // Map results back to test case IDs
  const resultMap = new Map<string, { fixSuggestion: string; fixComplexity: 'LOW' | 'MEDIUM' | 'HIGH' }>();

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

  onProgress?.(`Received fixes for ${resultMap.size} of ${failedCases.length} cases`);

  return resultMap;
}
