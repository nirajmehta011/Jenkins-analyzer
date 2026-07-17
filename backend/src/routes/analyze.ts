import { Router, Request, Response } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import fs from 'fs';
import os from 'os';
import { preprocessLog, extractSurefireXml } from '../services/chunker';
import { parseLogsLocally, parseLogFile } from '../services/localParser';
import { ZipSizeTracker, getDeclaredUncompressedSize } from '../services/zipGuard';
import { getFixSuggestions } from '../services/fixSuggester';
import { callAI } from '../services/aiAnalyzer';
import type {
  ProjectConfig,
  AnalysisOptions,
  AnalysisResult,
  SSEProgressEvent,
  AIProviderConfig,
  TestCase,
} from '../types/analysis';

const router = Router();

const MAX_FILE_SIZE = parseInt(process.env['MAX_FILE_SIZE_MB'] || '100', 10) * 1024 * 1024;

// Stream uploads to a temp file on disk instead of buffering the whole file in
// RAM. This keeps peak memory low for large logs (e.g. 35 MB+), which is what
// causes OOM crashes on small free-tier instances. The temp file is read into a
// string only at the point of parsing and is deleted once the request finishes.
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_FILE_SIZE },
});

/**
 * POST /api/analyze/test-connection
 * Validates the API key and provider configuration with a tiny dummy prompt.
 */
router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const { aiConfig } = req.body;
    if (!aiConfig) {
      return res.status(400).json({ success: false, message: 'Missing aiConfig in request body' });
    }

    const testSystemPrompt = 'You are a connection testing assistant. You MUST reply with exactly "OK" and nothing else. No punctuation, no markdown, no other text.';
    const testMessages = [{ role: 'user' as const, content: 'Test connection' }];

    const response = await callAI(aiConfig as AIProviderConfig, testSystemPrompt, testMessages);
    
    if (response.trim().toUpperCase().includes('OK')) {
      return res.json({ success: true, message: 'Connection successful!' });
    }
    
    return res.json({
      success: true,
      message: `Connected, but received unexpected response from AI: "${response.trim().slice(0, 100)}"`,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown connection test error';
    return res.status(500).json({ success: false, message: errMsg });
  }
});

/**
 * POST /api/analyze/models
 * Dynamically queries available models from the configured AI provider.
 */
router.post('/models', async (req: Request, res: Response) => {
  try {
    const { aiConfig } = req.body;
    if (!aiConfig) {
      return res.status(400).json({ success: false, message: 'Missing aiConfig in request body' });
    }

    const config = aiConfig as AIProviderConfig;

    let apiKey = config.apiKey;
    if (!apiKey) {
      if (config.provider === 'anthropic') apiKey = process.env['ANTHROPIC_API_KEY'] || '';
      else if (config.provider === 'gemini') apiKey = process.env['GEMINI_API_KEY'] || '';
      else if (config.provider === 'openai') apiKey = process.env['OPENAI_API_KEY'] || '';
      else if (config.provider === 'groq') apiKey = process.env['GROQ_API_KEY'] || '';
      else if (config.provider === 'openrouter') apiKey = process.env['OPENROUTER_API_KEY'] || '';
    }

    if (!apiKey && config.provider !== 'ollama') {
      return res.status(400).json({ success: false, message: `API key for "${config.provider}" is not configured.` });
    }

    let models: { id: string; name: string }[] = [];

    switch (config.provider) {
      case 'anthropic': {
        const response = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        if (!response.ok) {
          throw new Error(`Anthropic API returned ${response.status}: ${response.statusText}`);
        }
        const data = (await response.json()) as any;
        models = data.data.map((m: any) => ({
          id: m.id,
          name: m.display_name || m.id,
        }));
        break;
      }

      case 'gemini': {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) {
          throw new Error(`Gemini API returned ${response.status}: ${response.statusText}`);
        }
        const data = (await response.json()) as any;
        models = data.models
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => ({
            id: m.name.replace(/^models\//, ''),
            name: m.displayName || m.name,
          }));
        break;
      }

      case 'openai':
      case 'openrouter':
      case 'groq': {
        let baseURL = 'https://api.openai.com/v1/models';
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${apiKey}`,
        };

        if (config.provider === 'openrouter') {
          baseURL = 'https://openrouter.ai/api/v1/models';
        } else if (config.provider === 'groq') {
          baseURL = 'https://api.groq.com/openai/v1/models';
        }

        const response = await fetch(baseURL, { headers });
        if (!response.ok) {
          throw new Error(`${config.provider} API returned ${response.status}: ${response.statusText}`);
        }
        const data = (await response.json()) as any;

        if (config.provider === 'openrouter') {
          models = data.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
          }));
        } else {
          models = data.data
            .filter((m: any) => {
              const id = m.id.toLowerCase();
              return !id.includes('whisper') && !id.includes('embed') && !id.includes('moderation') && !id.includes('tts') && !id.includes('dall-e');
            })
            .map((m: any) => ({
              id: m.id,
              name: m.id,
            }));
        }
        break;
      }

      case 'ollama': {
        const url = config.baseUrl || 'http://localhost:11434';
        const response = await fetch(`${url}/api/tags`);
        if (!response.ok) {
          throw new Error(`Ollama local instance returned ${response.status}`);
        }
        const data = (await response.json()) as any;
        models = data.models.map((m: any) => ({
          id: m.name,
          name: m.name,
        }));
        break;
      }

      default:
        throw new Error(`Unsupported AI provider: ${config.provider}`);
    }

    return res.json({ success: true, models });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to fetch models';
    return res.status(500).json({ success: false, message: errMsg });
  }
});


/**
 * POST /api/analyze
 * LOCAL-FIRST analysis. Zero AI calls.
 * Accepts multipart form with: file, config (JSON string), options (JSON string)
 * Responds with Server-Sent Events for progress, final event contains full result.
 */
router.post('/', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendSSE = (event: SSEProgressEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // Validate file
    if (!req.file) {
      sendSSE({ stage: 'error', pct: 0, error: 'No file uploaded' });
      res.end();
      return;
    }

    const filename = req.file.originalname;

    // Parse config and options
    let config: ProjectConfig;
    let options: AnalysisOptions;

    try {
      config = JSON.parse((req.body?.config as string) || '{}') as ProjectConfig;
      options = JSON.parse((req.body?.options as string) || '{}') as AnalysisOptions;
    } catch {
      sendSSE({ stage: 'error', pct: 0, error: 'Invalid config or options JSON' });
      res.end();
      return;
    }

    // Default config values
    config = {
      projectType: config.projectType || 'Unknown',
      testFramework: config.testFramework || 'Unknown',
      environment: config.environment || 'CI',
      knownFlaky: config.knownFlaky || '',
      failedCasesInput: config.failedCasesInput || '',
    };

    const customQueries = parseFailedCasesList(config.failedCasesInput);
    const hasCustomQueries = customQueries.length > 0;

    sendSSE({ stage: 'uploading', pct: 5, message: 'File received, processing...' });

    // Collect log files for local parsing
    const logFiles = new Map<string, string>();
    const passedCases: TestCase[] = [];
    let fullText = '';

    if (filename.endsWith('.zip')) {
      sendSSE({ stage: 'preprocessing', pct: 10, message: 'Processing ZIP archive contents...' });
      const zipBuffer = await fs.promises.readFile(req.file.path);
      const zip = await JSZip.loadAsync(zipBuffer);
      const zipSizeTracker = new ZipSizeTracker();

      // Find files ending with 'log.txt'
      const logEntries = Object.entries(zip.files).filter(
        ([path, file]) => !file.dir && path.toLowerCase().endsWith('log.txt')
      );

      if (logEntries.length === 0) {
        // Fallback: extract any text/log files
        sendSSE({ stage: 'preprocessing', pct: 12, message: 'No log.txt files found. Extracting standard logs...' });
        const fallbackText = await extractZipContents(zipBuffer, zipSizeTracker);
        fullText = fallbackText;
        const cleaned = preprocessLog(fallbackText);

        // Always hand off to the real parser rather than gating on a content
        // substring — the shared pipeline below correctly reports BUILD
        // SUCCESS if parsing genuinely finds no failures.
        logFiles.set('combined-fallback.log', cleaned);
      } else {
        // Process log.txt files
        sendSSE({ stage: 'preprocessing', pct: 12, message: `Found ${logEntries.length} log files. Scanning for failures...` });

        let processed = 0;
        for (const [path, file] of logEntries) {
          // Preflight check against the declared uncompressed size, then a
          // post-decompression check as a safety net — both throw
          // ZipBombError, which is intentionally NOT caught by the
          // "skip unreadable files" catch below so it aborts the whole
          // request via the route's outer error handler.
          zipSizeTracker.checkDeclared(path, getDeclaredUncompressedSize(file));

          let content: string;
          try {
            content = await file.async('text');
          } catch {
            // Skip unreadable/corrupt files
            continue;
          }
          zipSizeTracker.checkActual(path, content.length);

          try {
            fullText += `\n=== FILE: ${path} ===\n${content}\n`;

            // Determine if this is a failed test. A custom query list (user-
            // pasted failed-test names) is trusted directly; otherwise defer
            // to the actual parser rather than a brittle content substring
            // check — "failed", "FAIL:", "Failures: N" etc. don't contain
            // the literal "fail " (fail + space) the old check required.
            const preprocessed = preprocessLog(content);
            let isFailed: boolean;
            if (hasCustomQueries) {
              isFailed = isLogFileMatchingQueries(path, content, customQueries);
            } else {
              isFailed = parseLogFile(preprocessed, path).length > 0;
            }

            if (isFailed) {
              logFiles.set(path, preprocessed);
            } else {
              // Register as PASSED locally
              const { suite, name } = parseNamesFromPath(path);
              passedCases.push(createPassedCase(name, suite, passedCases.length));
            }

            processed++;
            if (processed % 20 === 0) {
              sendSSE({
                stage: 'preprocessing',
                pct: 12 + Math.round((processed / logEntries.length) * 15),
                message: `Scanned ${processed} of ${logEntries.length} log files...`,
              });
            }
          } catch {
            // Skip unreadable files
          }
        }

        if (logFiles.size === 0) {
          // All tests passed
          const result: AnalysisResult = createEmptySuccessResult(filename);
          result.cases = passedCases;
          result.summary = {
            total: passedCases.length,
            failed: 0,
            passed: passedCases.length,
            skipped: 0,
            errors: 0,
            flaky: 0,
          };
          for (let idx = 0; idx < result.cases.length; idx++) {
            result.cases[idx].id = `TC-${String(idx + 1).padStart(3, '0')}`;
          }
          sendSSE({
            stage: 'done',
            pct: 100,
            message: `Analysis complete (All ${passedCases.length} tests passed)`,
            result,
          });
          res.end();
          return;
        }

        sendSSE({
          stage: 'preprocessing',
          pct: 28,
          message: `Found ${logFiles.size} failed log files, ${passedCases.length} passed. Running local analysis...`,
        });
      }
    } else {
      // Single log file — always run it through the parser rather than
      // gating on a content substring; let actual parsed evidence decide
      // pass/fail.
      const rawContent = await fs.promises.readFile(req.file.path, 'utf-8');
      fullText = rawContent;
      logFiles.set(filename, preprocessLog(rawContent));
    }

    // ── LOCAL PARSING (zero AI calls) ──────────────────────────────
    sendSSE({ stage: 'analyzing', pct: 35, message: `Parsing ${logFiles.size} failed log file(s) locally...` });

    const result = parseLogsLocally({
      logFiles,
      fullText,
      filename,
    });

    // Merge Surefire XML cases if any
    const xmlCases = extractSurefireXml(fullText);
    if (xmlCases.length > 0) {
      const existingNames = new Set(result.cases.map(c => `${c.suite}::${c.name}`));
      for (const xmlCase of xmlCases) {
        const key = `${xmlCase.suite}::${xmlCase.name}`;
        if (!existingNames.has(key)) {
          result.cases.push(xmlCase);
        }
      }
    }

    // Merge passed cases
    if (passedCases.length > 0) {
      result.cases.push(...passedCases);
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueCases: TestCase[] = [];
    for (const tc of result.cases) {
      const key = `${tc.suite || ''}::${tc.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCases.push(tc);
      }
    }
    result.cases = uniqueCases;

    // Reassign sequential IDs
    for (let idx = 0; idx < result.cases.length; idx++) {
      result.cases[idx].id = `TC-${String(idx + 1).padStart(3, '0')}`;
    }

    // Recompute summary
    result.summary = {
      total: result.cases.length,
      failed: result.cases.filter(c => c.status === 'FAILED').length,
      passed: result.cases.filter(c => c.status === 'PASSED').length,
      skipped: result.cases.filter(c => c.status === 'SKIPPED').length,
      errors: result.cases.filter(c => c.status === 'ERROR').length,
      flaky: result.cases.filter(c => c.isFlaky).length,
    };

    if (result.summary.failed === 0 && result.summary.errors === 0) {
      if (result.buildSummary) {
        result.buildSummary.overallStatus = 'BUILD SUCCESS';
      }
    }

    const doneMessage = (result.summary.failed + result.summary.errors) === 0
      ? `Analysis complete — all ${result.summary.total} test(s) passed`
      : 'Local analysis complete — click "Get AI Fix Suggestions" for AI-powered fixes';

    sendSSE({ stage: 'done', pct: 100, message: doneMessage, result });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown server error';
    sendSSE({ stage: 'error', pct: 0, error: errMsg });
  } finally {
    // Always remove the temp upload file so disk doesn't fill up over time.
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {
        /* best-effort cleanup; ignore if already gone */
      });
    }
    res.end();
  }
});


/**
 * POST /api/analyze/fix-suggestions
 * On-demand AI fix suggestions. Makes exactly 1 batched AI call.
 * Accepts JSON body: { cases: TestCase[], config: ProjectConfig, aiConfig: AIProviderConfig }
 * Returns SSE progress events, final event contains the fixes.
 */
router.post('/fix-suggestions', async (req: Request, res: Response): Promise<void> => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendSSE = (data: any): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { cases, config, aiConfig } = req.body;

    if (!cases || !Array.isArray(cases) || cases.length === 0) {
      sendSSE({ stage: 'error', error: 'No failed cases provided' });
      res.end();
      return;
    }

    if (!aiConfig || !aiConfig.apiKey) {
      sendSSE({ stage: 'error', error: 'AI API key is required for fix suggestions. Configure it in the AI Settings panel.' });
      res.end();
      return;
    }

    const failedCases = (cases as TestCase[]).filter(c => c.status === 'FAILED' || c.status === 'ERROR');

    if (failedCases.length === 0) {
      sendSSE({ stage: 'error', error: 'No FAILED or ERROR cases found in the provided cases' });
      res.end();
      return;
    }

    sendSSE({ stage: 'analyzing', pct: 10, message: `Requesting AI fix suggestions for ${failedCases.length} failures (1 batched call)...` });

    const fixMap = await getFixSuggestions(
      failedCases,
      config as ProjectConfig,
      aiConfig as AIProviderConfig,
      (message) => {
        sendSSE({ stage: 'analyzing', pct: 50, message });
      },
    );

    // Convert map to array for the response
    const fixes: Array<{ id: string; fixSuggestion: string; fixComplexity: string }> = [];
    for (const [id, fix] of fixMap) {
      fixes.push({ id, fixSuggestion: fix.fixSuggestion, fixComplexity: fix.fixComplexity });
    }

    sendSSE({
      stage: 'done',
      pct: 100,
      message: `AI fix suggestions ready for ${fixes.length} cases`,
      fixes,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    sendSSE({ stage: 'error', error: `Fix suggestions failed: ${errMsg}` });
  } finally {
    res.end();
  }
});


// ────────────────────────────────────────────────────────────────────────
// Helper functions
// ────────────────────────────────────────────────────────────────────────

/**
 * Extract all text files from a ZIP archive and concatenate them.
 */
async function extractZipContents(buffer: Buffer, zipSizeTracker: ZipSizeTracker): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const textParts: string[] = [];

  const textExtensions = ['.log', '.txt', '.xml', '.json', '.out', '.err'];

  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;

    const isTextFile = textExtensions.some((ext) => path.toLowerCase().endsWith(ext));
    const hasNoExtension = !path.includes('.') || path.endsWith('/');

    if (isTextFile || hasNoExtension) {
      // Preflight + post-decompression size checks — ZipBombError
      // intentionally bypasses the "skip binary files" catch below.
      zipSizeTracker.checkDeclared(path, getDeclaredUncompressedSize(file));

      let content: string;
      try {
        content = await file.async('text');
      } catch {
        // Skip binary files
        continue;
      }
      zipSizeTracker.checkActual(path, content.length);
      textParts.push(`\n=== FILE: ${path} ===\n${content}`);
    }
  }

  if (textParts.length === 0) {
    throw new Error('No text files found in ZIP archive');
  }

  return textParts.join('\n');
}

/**
 * Create an empty success result.
 */
function createEmptySuccessResult(filename: string): AnalysisResult {
  return {
    id: require('uuid').v4(),
    filename,
    analyzedAt: new Date().toISOString(),
    totalChunks: 0,
    buildSummary: {
      overallStatus: 'BUILD SUCCESS',
      buildDuration: null,
      jdkVersion: null,
      buildTool: null,
      topFailureCategories: [],
      recommendedFirstFix: null,
      estimatedFixComplexity: null,
    },
    cascadingGroups: [],
    cases: [],
    summary: { total: 0, failed: 0, passed: 0, skipped: 0, errors: 0, flaky: 0 },
  };
}

/**
 * Create a PASSED test case from a file path.
 */
function createPassedCase(name: string, suite: string, index: number): TestCase {
  return {
    id: `PASSED-TEMP-${index + 1}`,
    name,
    suite,
    status: 'PASSED',
    duration: null,
    isFlaky: false,
    isCascading: false,
    cascadeGroupId: null,
    exceptionType: null,
    errorMessage: null,
    stackFrames: [],
    rootCause: null,
    symptomVsCause: null,
    severity: null,
    category: null,
    fixSuggestion: null,
    fixComplexity: null,
    logEvidenceQuote: null,
    parserConfidence: 'HIGH',
    testUserEmail: null,
    relatedLinks: [],
    attemptCount: null,
    isHookFailure: false,
    evidenceContext: null,
  };
}

/**
 * Helper to extract test name and suite name from log.txt path
 */
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
 * Parses raw text input into a list of distinct custom failure case name queries.
 */
function parseFailedCasesList(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      const lower = line.toLowerCase();
      if (lower.startsWith('failed tests') || lower.startsWith('failed test:')) return false;
      return true;
    });
}

/**
 * Checks if a given log file path or content matches any custom failure query.
 */
function isLogFileMatchingQueries(path: string, content: string, queries: string[]): boolean {
  if (queries.length === 0) return false;
  const normPath = path.toLowerCase().replace(/\\/g, '/');
  const { suite, name } = parseNamesFromPath(path);
  const normSuite = suite ? suite.toLowerCase() : '';
  const normName = name.toLowerCase();

  for (const q of queries) {
    const normQuery = q.toLowerCase().replace(/\\/g, '/');
    if (normPath.includes(normQuery)) {
      return true;
    }
    if (normQuery.includes(normName) || (normSuite && normQuery.includes(normSuite))) {
      return true;
    }
    if (content.toLowerCase().includes(normQuery)) {
      return true;
    }
  }
  return false;
}

export default router;
