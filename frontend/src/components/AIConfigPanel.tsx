import { useState, useEffect, useMemo } from 'react';
import type { AIProviderConfig, AIProviderType } from '../types/analysis';
import { testAIConnection, fetchAIModels } from '../services/api';

interface AIConfigPanelProps {
  config: AIProviderConfig;
  onConfigChange: (config: AIProviderConfig) => void;
  disabled?: boolean;
}

interface ProviderOption {
  id: AIProviderType;
  name: string;
  placeholderKey: string;
  defaultModel: string;
  models: { value: string; label: string }[];
  requiresUrl?: boolean;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    placeholderKey: 'sk-ant-...',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: [
      { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
      { value: 'claude-3-opus-latest', label: 'Claude 3 Opus' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    placeholderKey: 'AIzaSy...',
    defaultModel: 'gemini-1.5-flash',
    models: [
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI GPT',
    placeholderKey: 'sk-...',
    defaultModel: 'gpt-4o-mini',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'o1-mini', label: 'o1 Mini' },
      { value: 'o1-preview', label: 'o1 Preview' },
    ],
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    placeholderKey: 'gsk_...',
    defaultModel: 'llama-3.1-70b-versatile',
    models: [
      { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B Versatile' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter AI',
    placeholderKey: 'sk-or-v1-...',
    defaultModel: 'openrouter/auto',
    models: [
      { value: 'openrouter/auto', label: 'Auto Select (OpenRouter)' },
      { value: 'anthropic/claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
      { value: 'google/gemini-flash-1.5', label: 'Gemini 1.5 Flash' },
      { value: 'meta-llama/llama-3-70b-instruct', label: 'Llama 3 70B' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama / Custom Local',
    placeholderKey: 'Not required for local Ollama',
    defaultModel: 'llama3',
    models: [
      { value: 'llama3', label: 'Llama 3' },
      { value: 'mistral', label: 'Mistral' },
    ],
    requiresUrl: true,
  },
];

export default function AIConfigPanel({
  config,
  onConfigChange,
  disabled = false,
}: AIConfigPanelProps) {
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Dynamic model loading state
  const [fetchedModels, setFetchedModels] = useState<{ id: string; name: string }[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [customModelText, setCustomModelText] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const currentProvider = PROVIDERS.find((p) => p.id === config.provider) || PROVIDERS[0];

  // Fetch available models from backend
  const handleFetchModels = async (silent = false) => {
    if (!silent) {
      setFetchingModels(true);
      setModelFetchError(null);
    }
    try {
      const res = await fetchAIModels(config);
      if (res.success && res.models && res.models.length > 0) {
        setFetchedModels(res.models);
        setModelFetchError(null);
      } else {
        setFetchedModels(null);
        if (!silent && (config.apiKey || config.provider === 'ollama')) {
          setModelFetchError(res.message || 'Failed to fetch models dynamically');
        }
      }
    } catch {
      setFetchedModels(null);
    } finally {
      if (!silent) {
        setFetchingModels(false);
      }
    }
  };

  // Compile list of models for dropdown
  const modelOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [];

    if (fetchedModels && fetchedModels.length > 0) {
      list.push(...fetchedModels.map((m) => ({ value: m.id, label: m.name })));
    } else {
      // Fallback to static lists
      list.push(...currentProvider.models);
    }

    // Always ensure a 'custom' option is present at the end
    if (!list.some((item) => item.value === 'custom')) {
      list.push({ value: 'custom', label: '✍ Custom Model Name...' });
    }

    return list;
  }, [fetchedModels, currentProvider]);

  // Handle provider switch
  const handleProviderChange = (provider: AIProviderType) => {
    const nextProv = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];
    setFetchedModels(null);
    setModelFetchError(null);
    setTestResult(null);
    setShowCustomInput(false);

    onConfigChange({
      ...config,
      provider,
      model: nextProv.defaultModel,
      baseUrl: nextProv.requiresUrl ? (provider === 'ollama' ? 'http://localhost:11434/v1' : '') : undefined,
    });
  };

  // Trigger fetch models when provider, key, or base url changes
  useEffect(() => {
    // Automatically attempt a silent fetch when config updates
    const timer = setTimeout(() => {
      // Only auto-fetch if we have key or are local ollama
      if (config.apiKey || config.provider === 'ollama') {
        handleFetchModels(true);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [config.provider, config.apiKey, config.baseUrl]);

  // Adjust model select option when model changes
  const handleModelChange = (model: string) => {
    setTestResult(null);
    if (model === 'custom') {
      setShowCustomInput(true);
      onConfigChange({ ...config, model: customModelText || 'custom-model' });
    } else {
      setShowCustomInput(false);
      onConfigChange({ ...config, model });
    }
  };

  const handleCustomModelTextChange = (text: string) => {
    setCustomModelText(text);
    onConfigChange({ ...config, model: text || 'custom-model' });
  };

  const handleKeyChange = (apiKey: string) => {
    onConfigChange({ ...config, apiKey });
    setTestResult(null);
  };

  const handleUrlChange = (baseUrl: string) => {
    onConfigChange({ ...config, baseUrl });
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAIConnection(config);
      setTestResult(res);
    } catch {
      setTestResult({ success: false, message: 'Unexpected connection error.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div id="ai-config-panel" className="bg-slate-800/40 backdrop-blur rounded-2xl border border-slate-700/50 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <span>🧠</span> AI Inference Provider
        </h3>
        <button
          type="button"
          onClick={() => handleFetchModels(false)}
          disabled={disabled || fetchingModels}
          title="Refresh available models"
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 disabled:opacity-50"
        >
          {fetchingModels ? (
            <span className="inline-block animate-spin">⏳</span>
          ) : (
            <span>🔄 Load Models</span>
          )}
        </button>
      </div>

      <div className="space-y-3.5">
        {/* Provider Select */}
        <div>
          <label htmlFor="ai-provider" className="block text-xs font-medium text-slate-400 mb-1.5">
            AI Provider
          </label>
          <select
            id="ai-provider"
            value={config.provider}
            onChange={(e) => handleProviderChange(e.target.value as AIProviderType)}
            disabled={disabled}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Dynamic Model Select */}
        <div>
          <label htmlFor="ai-model" className="block text-xs font-medium text-slate-400 mb-1.5 flex items-center justify-between">
            <span>Model</span>
            {fetchedModels && (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/10 font-mono">
                Fetched Live
              </span>
            )}
          </label>
          <select
            id="ai-model"
            value={showCustomInput ? 'custom' : config.model}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={disabled || fetchingModels}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                     focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {modelOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Custom model input if "custom" model option is selected */}
        {showCustomInput && (
          <div className="animate-fadeIn">
            <label htmlFor="ai-custom-model" className="block text-xs font-medium text-slate-400 mb-1.5">
              Custom Model Name
            </label>
            <input
              id="ai-custom-model"
              type="text"
              value={customModelText}
              onChange={(e) => handleCustomModelTextChange(e.target.value)}
              disabled={disabled}
              placeholder="e.g. gemini-2.0-flash-exp, llama-3.3-70b-specdec"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                       placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            />
          </div>
        )}

        {/* Custom Base URL (e.g. Ollama) */}
        {currentProvider.requiresUrl && (
          <div className="animate-fadeIn">
            <label htmlFor="ai-base-url" className="block text-xs font-medium text-slate-400 mb-1.5">
              Base URL
            </label>
            <input
              id="ai-base-url"
              type="text"
              value={config.baseUrl || ''}
              onChange={(e) => handleUrlChange(e.target.value)}
              disabled={disabled}
              placeholder="e.g. http://localhost:11434/v1"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white
                       placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            />
          </div>
        )}

        {/* API Key Input */}
        {config.provider !== 'ollama' && (
          <div>
            <label htmlFor="ai-api-key" className="block text-xs font-medium text-slate-400 mb-1.5">
              API Key (stored in browser locally)
            </label>
            <div className="relative">
              <input
                id="ai-api-key"
                type={showKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                disabled={disabled}
                placeholder={currentProvider.placeholderKey}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-3 pr-10 py-2 text-sm text-white
                         placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                disabled={disabled}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white transition-colors"
              >
                {showKey ? (
                  <span className="text-xs">Hide</span>
                ) : (
                  <span className="text-xs">Show</span>
                )}
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Leave blank to fall back to environment variables on the backend.
            </p>
          </div>
        )}

        {/* Model Fetching Error message */}
        {modelFetchError && (
          <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs animate-fadeIn leading-relaxed">
            ⚠️ <b>Note:</b> {modelFetchError}. Falling back to default list. Click "Load Models" to try again.
          </div>
        )}

        {/* Test Connection Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={disabled || testing}
            className={`w-full py-2 px-4 rounded-lg font-medium text-xs border transition-all duration-150 flex items-center justify-center gap-2
              ${testing
                ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-slate-800/80 border-slate-700 hover:bg-slate-700 text-slate-200 hover:text-white'
              }`}
          >
            {testing ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Testing Connection...
              </>
            ) : (
              <>
                ⚡ Test AI Credentials
              </>
            )}
          </button>
        </div>

        {/* Test Feedback Message */}
        {testResult && (
          <div
            className={`p-3 rounded-lg border text-xs leading-relaxed animate-fadeIn
              ${testResult.success
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}
          >
            <div className="flex gap-2">
              <span className="text-sm shrink-0">{testResult.success ? '✓' : '✗'}</span>
              <div>
                <p className="font-semibold">{testResult.success ? 'Connected' : 'Connection Failed'}</p>
                <p className="mt-0.5 opacity-90">{testResult.message}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
