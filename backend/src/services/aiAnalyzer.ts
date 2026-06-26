import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import type {
  ProjectConfig,
  AnalysisOptions,
  AnalysisResult,
  ChunkContext,
  AIProviderConfig,
} from '../types/analysis';

const ANALYSIS_RESULT_SCHEMA = `{
  "cases": [
    {
      "id": "string (temporary, will be reassigned)",
      "name": "string (test method name)",
      "suite": "string | null (test class / module)",
      "status": "PASSED | FAILED | ERROR | SKIPPED",
      "duration": "string | null (e.g. '1.23s')",
      "isFlaky": "boolean",
      "isCascading": "boolean",
      "cascadeGroupId": "string | null",
      "exceptionType": "string | null (e.g. 'java.lang.NullPointerException')",
      "errorMessage": "string | null",
      "stackFrames": ["string (one per frame, max 10)"],
      "rootCause": "string | null",
      "symptomVsCause": { "symptom": "string", "cause": "string" } | null,
      "severity": "CRITICAL | HIGH | MEDIUM | LOW | null",
      "category": "NullPointerException | AssertionError | Timeout | ConnectionError | ConfigError | DependencyError | SetupFailure | DataError | EnvironmentError | RaceCondition | AuthError | NetworkError | Unknown | null",
      "fixSuggestion": "string | null",
      "fixComplexity": "LOW | MEDIUM | HIGH | null",
      "logEvidenceQuote": "string | null (exact line from log)",
      "parserConfidence": "HIGH | MEDIUM | LOW"
    }
  ],
  "cascadingGroups": [
    {
      "groupId": "string",
      "rootCause": "string",
      "affectedTestIds": ["string"],
      "fixOnce": true
    }
  ],
  "buildSummary": {
    "overallStatus": "string (e.g. 'BUILD FAILURE')",
    "buildDuration": "string | null",
    "jdkVersion": "string | null",
    "buildTool": "string | null (Maven / Gradle / npm)",
    "topFailureCategories": [{ "category": "string", "count": 0 }],
    "recommendedFirstFix": "string | null",
    "estimatedFixComplexity": "LOW | MEDIUM | HIGH | null"
  }
}`;

export function buildSystemPrompt(
  config: ProjectConfig,
  options: AnalysisOptions
): string {
  const optionsList: string[] = [];
  if (options.enableRootCause) optionsList.push('root cause analysis');
  if (options.enableFixSuggestion) optionsList.push('fix suggestions');
  if (options.enableGrouping) optionsList.push('cascading failure grouping');
  if (options.enableSeverity) optionsList.push('severity classification');
  if (options.enableFlaky) optionsList.push('flaky test detection');

  return `You are an expert CI/CD forensics agent with deep knowledge of Jenkins,
JUnit, TestNG, pytest, Surefire, Maven, Gradle, Spring Boot, Playwright, Cypress, Selenium,
and common CI failure patterns.

Project context:
- Project type: ${config.projectType}
- Test framework: ${config.testFramework}
- Environment: ${config.environment}
- Known flaky tests: ${config.knownFlaky || 'none specified'}

Enabled analyses: ${optionsList.join(', ') || 'all'}

Your job: analyze Jenkins build logs with surgical precision and return
structured JSON only — no prose, no markdown, no backticks.

CRITICAL RULES:
1. Always distinguish SYMPTOM (what the error says) from CAUSE (why it happened).
   NullPointerException is never a root cause — dig deeper.
2. Identify CASCADING failures: one broken @BeforeAll can fail 30 tests.
   Group them under a cascadeGroupId. One fix should unblock all.
3. Mark FLAKY tests: timeouts, race conditions, ConcurrentModificationException,
   port-in-use, resource contention — these need stabilization, not bug fixes.
4. If you cannot determine root cause from log data, set rootCause to:
   'Insufficient log data — enable verbose logging with -X flag'
   Never guess. Confidence must reflect certainty.
5. Quote the exact log line that led to each conclusion in logEvidenceQuote.
6. Return ONLY the JSON object matching the schema. No other text.`;
}

export function buildUserPrompt(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  seenSuites: string[],
  prevFailCount: number,
  isLast: boolean
): string {
  let prompt = `Analyze this Jenkins build log chunk (${chunkIndex + 1} of ${totalChunks}).

`;

  if (chunkIndex > 0) {
    prompt += `CONTINUITY CONTEXT:
- Previously analyzed suites: ${seenSuites.join(', ') || 'none yet'}
- Failures found so far: ${prevFailCount}
- Do NOT re-report tests from previous chunks unless you have new information.

`;
  }

  if (isLast) {
    prompt += `This is the FINAL chunk. Include a complete buildSummary with:
- overallStatus (BUILD SUCCESS / BUILD FAILURE / UNSTABLE)
- buildDuration, jdkVersion, buildTool (if detectable)
- topFailureCategories (aggregate across ALL chunks, top 5)
- recommendedFirstFix (the single highest-impact fix)
- estimatedFixComplexity

`;
  } else {
    prompt += `This is NOT the final chunk. Set buildSummary to null.
Focus on extracting all test cases from this chunk.

`;
  }

  prompt += `Return JSON matching this schema exactly:
${ANALYSIS_RESULT_SCHEMA}

===== LOG CHUNK START =====
${chunk}
===== LOG CHUNK END =====`;

  return prompt;
}

function resolveAIConfig(clientConfig?: AIProviderConfig): AIProviderConfig {
  if (clientConfig && clientConfig.apiKey) {
    return clientConfig;
  }

  // Fallbacks to backend environment variables
  if (process.env['ANTHROPIC_API_KEY']) {
    return {
      provider: 'anthropic',
      apiKey: process.env['ANTHROPIC_API_KEY'],
      model: clientConfig?.model || 'claude-3-5-sonnet-latest',
    };
  }
  if (process.env['GEMINI_API_KEY']) {
    return {
      provider: 'gemini',
      apiKey: process.env['GEMINI_API_KEY'],
      model: clientConfig?.model || 'gemini-1.5-flash',
    };
  }
  if (process.env['OPENAI_API_KEY']) {
    return {
      provider: 'openai',
      apiKey: process.env['OPENAI_API_KEY'],
      model: clientConfig?.model || 'gpt-4o-mini',
    };
  }
  if (process.env['GROQ_API_KEY']) {
    return {
      provider: 'groq',
      apiKey: process.env['GROQ_API_KEY'],
      model: clientConfig?.model || 'llama-3.1-70b-versatile',
    };
  }
  if (process.env['OPENROUTER_API_KEY']) {
    return {
      provider: 'openrouter',
      apiKey: process.env['OPENROUTER_API_KEY'],
      model: clientConfig?.model || 'openrouter/auto',
    };
  }

  return {
    provider: clientConfig?.provider || 'anthropic',
    apiKey: '',
    model: clientConfig?.model || '',
    baseUrl: clientConfig?.baseUrl,
  };
}

function getDefaultModelForProvider(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-3-5-sonnet-latest';
    case 'gemini':
      return 'gemini-1.5-flash';
    case 'openai':
      return 'gpt-4o-mini';
    case 'groq':
      return 'llama-3.1-70b-versatile';
    case 'openrouter':
      return 'openrouter/auto';
    case 'ollama':
      return 'llama3';
    default:
      return '';
  }
}

export async function callAI(
  clientConfig: AIProviderConfig | undefined,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const config = resolveAIConfig(clientConfig);

  if (!config.apiKey && config.provider !== 'ollama') {
    throw new Error(`API key for provider "${config.provider}" is not configured. Please supply an API key in the UI config or in your server environment variables.`);
  }

  const modelName = config.model || getDefaultModelForProvider(config.provider);

  switch (config.provider) {
    case 'anthropic': {
      const anthropic = new Anthropic({ apiKey: config.apiKey });
      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 4000,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Anthropic response');
      }
      return textBlock.text;
    }

    case 'gemini': {
      const genAI = new GoogleGenerativeAI(config.apiKey);
      const modelInstance = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const result = await modelInstance.generateContent({ contents });
      const response = await result.response;
      return response.text();
    }

    case 'openai':
    case 'openrouter':
    case 'groq':
    case 'ollama': {
      let baseURL: string | undefined = config.baseUrl;
      if (config.provider === 'openrouter') {
        baseURL = 'https://openrouter.ai/api/v1';
      } else if (config.provider === 'groq') {
        baseURL = 'https://api.groq.com/openai/v1';
      } else if (config.provider === 'ollama') {
        baseURL = config.baseUrl || 'http://localhost:11434/v1';
      }

      const apiKey = config.provider === 'ollama' && !config.apiKey ? 'ollama' : config.apiKey;

      const openai = new OpenAI({
        apiKey,
        baseURL,
        dangerouslyAllowBrowser: false,
      });

      const reqMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        })),
      ];

      const options: any = {
        model: modelName,
        messages: reqMessages,
      };

      if (config.provider === 'openai' || config.provider === 'groq') {
        options.response_format = { type: 'json_object' };
      }

      const response = await openai.chat.completions.create(options);
      const choice = response.choices[0];
      if (!choice || !choice.message || !choice.message.content) {
        throw new Error(`No content returned from OpenAI-compatible provider (${config.provider})`);
      }
      return choice.message.content;
    }

    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

export async function analyzeChunk(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  config: ProjectConfig,
  options: AnalysisOptions,
  context: ChunkContext,
  aiConfig?: AIProviderConfig
): Promise<Partial<AnalysisResult>> {
  const systemPrompt = buildSystemPrompt(config, options);
  const userPrompt = buildUserPrompt(
    chunk,
    chunkIndex,
    totalChunks,
    context.seenSuites,
    context.prevFailCount,
    chunkIndex === totalChunks - 1
  );

  let responseText: string;

  try {
    responseText = await callAI(aiConfig, systemPrompt, [{ role: 'user', content: userPrompt }]);
  } catch (apiError) {
    const errMsg = apiError instanceof Error ? apiError.message : 'Unknown API error';
    throw new Error(`AI API error on chunk ${chunkIndex + 1}: ${errMsg}`);
  }

  // Try to parse JSON response
  let parsed: Partial<AnalysisResult>;
  try {
    parsed = parseJsonResponse(responseText);
  } catch {
    // Retry once with explicit JSON instruction
    try {
      const retryResponseText = await callAI(aiConfig, systemPrompt, [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: responseText },
        {
          role: 'user',
          content:
            'Your response was not valid JSON. Return ONLY raw JSON matching the schema — no backticks, no markdown, no explanation.',
        },
      ]);
      parsed = parseJsonResponse(retryResponseText);
    } catch (retryError) {
      const errMsg =
        retryError instanceof Error ? retryError.message : 'JSON parse failed';
      throw new Error(
        `Failed to parse AI response for chunk ${chunkIndex + 1}: ${errMsg}`
      );
    }
  }

  return parsed;
}


/**
 * Parse JSON from AI response text, stripping accidental markdown formatting.
 */
function parseJsonResponse(text: string): Partial<AnalysisResult> {
  let cleaned = text.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Find the JSON object boundaries
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object found in response');
  }

  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  return JSON.parse(cleaned) as Partial<AnalysisResult>;
}
