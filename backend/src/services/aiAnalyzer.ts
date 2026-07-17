import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import type { AIProviderConfig } from '../types/analysis';

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

/**
 * Single-call, provider-agnostic AI request. This is the only AI entry point
 * in the app — the local parser (localParser.ts) does all failure detection,
 * classification, and root-cause analysis with zero AI calls; callAI is used
 * exclusively for the optional, user-triggered "fix suggestions" batches
 * (see fixSuggester.ts) and the connection/model-list test endpoints.
 */
export async function callAI(
  clientConfig: AIProviderConfig | undefined,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  maxTokens = 4000
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
        max_tokens: maxTokens,
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
          maxOutputTokens: maxTokens,
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
        max_tokens: maxTokens,
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
