const API_URL = import.meta.env.VITE_API_URL || '';

import type { ProjectConfig, AnalysisOptions, SSEProgressEvent, AIProviderConfig } from '../types/analysis';

/**
 * Start an analysis by uploading a file and streaming SSE progress events.
 * Returns a function to abort the request.
 */
export function startAnalysis(
  file: File,
  config: ProjectConfig,
  options: AnalysisOptions,
  aiConfig: AIProviderConfig | undefined,
  onProgress: (event: SSEProgressEvent) => void,
  onError: (error: string) => void,
  onComplete: () => void
): () => void {
  const controller = new AbortController();

  const formData = new FormData();
  formData.append('file', file);
  formData.append('config', JSON.stringify(config));
  formData.append('options', JSON.stringify(options));
  if (aiConfig) {
    formData.append('aiConfig', JSON.stringify(aiConfig));
  }

  (async () => {
    try {
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        onError(`Server responded with ${response.status}: ${response.statusText}`);
        return;
      }

      if (!response.body) {
        onError('No response body — SSE not supported');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data) {
              try {
                const event = JSON.parse(data) as SSEProgressEvent;
                onProgress(event);
              } catch {
                // Skip malformed SSE data
              }
            }
          }
        }
      }

      onComplete();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        onError('Analysis cancelled');
      } else {
        onError((err as Error).message || 'Network error — check connection');
      }
    }
  })();

  return () => controller.abort();
}

/**
 * Check backend health.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Test AI Connection with configured provider and API key.
 */
export async function testAIConnection(
  aiConfig: AIProviderConfig
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${API_URL}/api/analyze/test-connection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ aiConfig }),
    });

    const data = await response.json();
    if (response.ok && data.success) {
      return { success: true, message: data.message || 'Connection successful!' };
    }
    return { success: false, message: data.message || 'Connection failed' };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Network error testing connection',
    };
  }
}

/**
 * Fetch available models dynamically from backend for the configured provider.
 */
export async function fetchAIModels(
  aiConfig: AIProviderConfig
): Promise<{ success: boolean; models?: { id: string; name: string }[]; message?: string }> {
  try {
    const response = await fetch(`${API_URL}/api/analyze/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ aiConfig }),
    });

    const data = await response.json();
    if (response.ok && data.success) {
      return { success: true, models: data.models };
    }
    return { success: false, message: data.message || 'Failed to fetch models' };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Network error fetching models',
    };
  }
}

export interface FixSuggestion {
  id: string;
  fixSuggestion: string;
  fixComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * Request AI fix suggestions for failed test cases.
 * Streams SSE events and calls back with the final fixes array.
 */
export function requestFixSuggestions(
  cases: import('../types/analysis').TestCase[],
  config: import('../types/analysis').ProjectConfig,
  aiConfig: AIProviderConfig,
  onProgress: (message: string, pct: number) => void,
  onComplete: (fixes: FixSuggestion[]) => void,
  onError: (error: string) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(`${API_URL}/api/analyze/fix-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases, config, aiConfig }),
        signal: controller.signal,
      });

      if (!response.ok) {
        onError(`Server responded with ${response.status}: ${response.statusText}`);
        return;
      }

      if (!response.body) {
        onError('No response body — SSE not supported');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data) {
              try {
                const event = JSON.parse(data);
                if (event.stage === 'error') {
                  onError(event.error || 'Fix suggestions failed');
                  return;
                }
                if (event.stage === 'done' && event.fixes) {
                  onComplete(event.fixes as FixSuggestion[]);
                  return;
                }
                if (event.message) {
                  onProgress(event.message, event.pct || 0);
                }
              } catch {
                // Skip malformed SSE data
              }
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        onError('Fix suggestions cancelled');
      } else {
        onError((err as Error).message || 'Network error');
      }
    }
  })();

  return () => controller.abort();
}
