/**
 * Provider Types and Interfaces for MedVoice Evaluation Runner
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderOptions {
  model?: string;
  temperature?: number;
  topP?: number;
  seed?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ProviderCompletionResult {
  providerName: 'groq' | 'nvidia' | 'mock';
  modelConfigured: string;
  modelReturned: string;
  responseId: string;
  systemFingerprint: string | null;
  seedApplied: boolean;
  content: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: string;
}

export interface EvaluatorProvider {
  readonly providerName: 'groq' | 'nvidia' | 'mock';
  readonly modelId: string;
  complete(messages: ChatMessage[], options?: ProviderOptions): Promise<ProviderCompletionResult>;
}

export class EvaluatorProviderError extends Error {
  public readonly statusCode?: number;
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(message: string, options: { code: string; statusCode?: number; retryable?: boolean }) {
    super(message);
    this.name = 'EvaluatorProviderError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
  }
}
