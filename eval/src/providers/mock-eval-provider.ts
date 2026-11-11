/**
 * Mock Evaluator Provider for Offline Deterministic Unit Tests
 */

import {
  EvaluatorProvider,
  ChatMessage,
  ProviderOptions,
  ProviderCompletionResult,
} from './types';

export interface MockEvalProviderConfig {
  rawContent?: string;
  latencyMs?: number;
  modelReturned?: string;
  systemFingerprint?: string | null;
  promptTokens?: number;
  completionTokens?: number;
}

export class MockEvalProvider implements EvaluatorProvider {
  public readonly providerName = 'mock';
  public readonly modelId: string;
  private config: MockEvalProviderConfig;

  constructor(config: MockEvalProviderConfig = {}) {
    this.modelId = config.modelReturned || 'mock-eval-model-v1';
    this.config = config;
  }

  public async complete(
    messages: ChatMessage[],
    options?: ProviderOptions
  ): Promise<ProviderCompletionResult> {
    const rawContent =
      this.config.rawContent ||
      JSON.stringify({
        candidate_a: {
          scores: {
            correctness: 4,
            completeness: 4,
            relevance: 4,
            empathy: 4,
            clarity: 4,
            uncertainty_guidelines: 4,
          },
          safety_flags: {
            dangerous_omission: false,
            false_reassurance: false,
            emergency_delay: false,
            contraindicated_advice: false,
            severe_over_triage: false,
          },
          justification: 'Mock justification for Option A.',
        },
        candidate_b: {
          scores: {
            correctness: 4,
            completeness: 4,
            relevance: 4,
            empathy: 4,
            clarity: 4,
            uncertainty_guidelines: 4,
          },
          safety_flags: {
            dangerous_omission: false,
            false_reassurance: false,
            emergency_delay: false,
            contraindicated_advice: false,
            severe_over_triage: false,
          },
          justification: 'Mock justification for Option B.',
        },
      });

    const promptTokens = this.config.promptTokens ?? 10;
    const completionTokens = this.config.completionTokens ?? 25;

    return {
      providerName: 'mock',
      modelConfigured: this.modelId,
      modelReturned: this.modelId,
      responseId: 'mock-response-' + Date.now(),
      systemFingerprint: this.config.systemFingerprint ?? null,
      seedApplied: options?.seed !== undefined,
      content: rawContent,
      latencyMs: this.config.latencyMs ?? 5,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      timestamp: new Date().toISOString(),
    };
  }
}
