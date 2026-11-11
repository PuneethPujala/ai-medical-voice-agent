/**
 * Groq Cloud Evaluator Provider
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 */

import {
  EvaluatorProvider,
  ChatMessage,
  ProviderOptions,
  ProviderCompletionResult,
  EvaluatorProviderError,
} from './types';

export interface GroqEvalProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxRetries?: number;
  baseBackoffMs?: number;
  fetchImpl?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

export class GroqEvalProvider implements EvaluatorProvider {
  public readonly providerName = 'groq' as const;
  public readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(config: GroqEvalProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.GROQ_API_KEY || '';
    this.modelId = config.model || 'qwen/qwen3.8-27b';
    this.baseUrl = (config.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
    this.maxRetries = config.maxRetries ?? 5;
    this.baseBackoffMs = config.baseBackoffMs ?? 1000;
    this.fetchImpl = config.fetchImpl || fetch;
    this.sleepFn = config.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  public async complete(
    messages: ChatMessage[],
    options?: ProviderOptions
  ): Promise<ProviderCompletionResult> {
    if (!this.apiKey) {
      throw new EvaluatorProviderError('GROQ_API_KEY is not configured.', {
        code: 'MISSING_API_KEY',
        statusCode: 401,
      });
    }

    const model = options?.model || this.modelId;
    const temperature = options?.temperature ?? 0.1;
    const topP = options?.topP ?? 0.95;
    const seed = options?.seed ?? 42;
    const timeoutMs = options?.timeoutMs ?? 60000;

    const requestBody: Record<string, any> = {
      model,
      messages,
      temperature,
      top_p: topP,
      seed,
    };

    if (options?.maxTokens) {
      requestBody.max_tokens = options.maxTokens;
    }

    let attempt = 0;
    const startTime = Date.now();

    while (attempt <= this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const latencyMs = Date.now() - startTime;
          const data = (await response.json()) as any;
          const choice = data.choices?.[0];
          const content = choice?.message?.content || '';

          return {
            providerName: 'groq',
            modelConfigured: model,
            modelReturned: data.model || model,
            responseId: data.id || `groq-resp-${Date.now()}`,
            systemFingerprint: data.system_fingerprint || null,
            seedApplied: true,
            content,
            latencyMs,
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
            timestamp: new Date().toISOString(),
          };
        }

        // Handle rate limit (429) or transient server errors (500, 502, 503, 504)
        const isRateLimit = response.status === 429;
        const isTransient = response.status >= 500 && response.status < 600;

        if ((isRateLimit || isTransient) && attempt <= this.maxRetries) {
          let delayMs = this.baseBackoffMs * Math.pow(2, attempt - 1);
          // Parse Retry-After header if available
          const retryAfterHeader = response.headers.get('retry-after');
          if (retryAfterHeader) {
            const parsedSeconds = parseFloat(retryAfterHeader);
            if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
              delayMs = Math.max(delayMs, parsedSeconds * 1000);
            }
          }
          // Add jitter +/- 20%
          const jitter = delayMs * 0.2 * (Math.random() * 2 - 1);
          delayMs = Math.max(50, Math.round(delayMs + jitter));

          await this.sleepFn(delayMs);
          continue;
        }

        const errorText = await response.text();
        if (isRateLimit) {
          throw new EvaluatorProviderError(
            `RATE_LIMIT_EXHAUSTED: HTTP 429 after ${attempt} attempts: ${errorText}`,
            { code: 'RATE_LIMIT_EXHAUSTED', statusCode: 429, retryable: false }
          );
        }

        throw new EvaluatorProviderError(`Groq API returned HTTP ${response.status}: ${errorText}`, {
          code: `HTTP_${response.status}`,
          statusCode: response.status,
          retryable: false,
        });
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err instanceof EvaluatorProviderError) {
          throw err;
        }
        if (attempt <= this.maxRetries && (err.name === 'AbortError' || err.code === 'ECONNRESET')) {
          const delayMs = this.baseBackoffMs * Math.pow(2, attempt - 1);
          await this.sleepFn(delayMs);
          continue;
        }
        throw new EvaluatorProviderError(`Groq request failed: ${err.message}`, {
          code: 'NETWORK_ERROR',
          retryable: false,
        });
      }
    }

    throw new EvaluatorProviderError(
      `RATE_LIMIT_EXHAUSTED: Retries exhausted after ${this.maxRetries} attempts.`,
      { code: 'RATE_LIMIT_EXHAUSTED', statusCode: 429, retryable: false }
    );
  }
}
