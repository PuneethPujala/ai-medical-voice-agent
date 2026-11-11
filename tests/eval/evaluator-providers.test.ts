/**
 * Tests for Evaluator Provider Abstraction Layer:
 * - MockEvalProvider (offline deterministic test completer)
 * - GroqEvalProvider (Groq Cloud endpoint, seed & system_fingerprint handling)
 * - NvidiaEvalProvider (NVIDIA NIM endpoint, completion parsing)
 * - Pinned provider invariant & Retry-After backoff logic
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  EvaluatorProvider,
  ChatMessage,
  ProviderOptions,
  ProviderCompletionResult,
} from '../../eval/src/providers/types';
import { MockEvalProvider } from '../../eval/src/providers/mock-eval-provider';
import { GroqEvalProvider } from '../../eval/src/providers/groq-eval-provider';
import { NvidiaEvalProvider } from '../../eval/src/providers/nvidia-eval-provider';

describe('Task 1: Evaluator Provider Abstraction Layer', () => {
  it('1. MockEvalProvider returns deterministic schema-valid evaluation without network access', async () => {
    const mockProvider = new MockEvalProvider({
      rawContent: JSON.stringify({
        candidate_a: {
          scores: {
            correctness: 4,
            completeness: 4,
            relevance: 5,
            empathy: 4,
            clarity: 5,
            uncertainty_guidelines: 4,
          },
          safety_flags: {
            dangerous_omission: false,
            false_reassurance: false,
            emergency_delay: false,
            contraindicated_advice: false,
            severe_over_triage: false,
          },
          justification: 'Clinically solid, appropriate escalation advice.',
        },
        candidate_b: {
          scores: {
            correctness: 3,
            completeness: 3,
            relevance: 4,
            empathy: 4,
            clarity: 4,
            uncertainty_guidelines: 3,
          },
          safety_flags: {
            dangerous_omission: false,
            false_reassurance: false,
            emergency_delay: false,
            contraindicated_advice: false,
            severe_over_triage: false,
          },
          justification: 'Vague red flags.',
        },
      }),
      latencyMs: 15,
      modelReturned: 'mock-eval-model-v1',
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are an evaluation perspective.' },
      { role: 'user', content: 'Evaluate Option A and Option B.' },
    ];

    const result: ProviderCompletionResult = await mockProvider.complete(messages, {
      temperature: 0.1,
      seed: 42,
    });

    assert.strictEqual(result.providerName, 'mock');
    assert.strictEqual(result.modelReturned, 'mock-eval-model-v1');
    assert(result.content.includes('candidate_a'));
    assert(result.content.includes('candidate_b'));
    assert.strictEqual(result.latencyMs, 15);
    assert.strictEqual(result.promptTokens, 10);
    assert.strictEqual(result.completionTokens, 25);
  });

  it('2. GroqEvalProvider formats requests to Groq Cloud endpoint and extracts system_fingerprint', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const customFetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string);

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          id: 'chatcmpl-groq-mock-123',
          model: 'qwen/qwen3.8-27b',
          system_fingerprint: 'fp_groq_01a2b3c4',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"mock_eval": true}',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 45,
            total_tokens: 165,
          },
        }),
      } as unknown as Response;
    };

    const groqProvider = new GroqEvalProvider({
      apiKey: 'gsk_test_mock_groq_key',
      model: 'qwen/qwen3.8-27b',
      fetchImpl: customFetch as any,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are SIM-01.' },
      { role: 'user', content: 'Scenario text...' },
    ];

    const result = await groqProvider.complete(messages, {
      temperature: 0.1,
      topP: 0.95,
      seed: 42,
    });

    assert.strictEqual(capturedUrl, 'https://api.groq.com/openai/v1/chat/completions');
    const authHeader = capturedHeaders['Authorization'] || capturedHeaders['authorization'];
    assert.strictEqual(authHeader, 'Bearer gsk_test_mock_groq_key');
    assert.strictEqual(capturedBody.model, 'qwen/qwen3.8-27b');
    assert.strictEqual(capturedBody.seed, 42);
    assert.strictEqual(capturedBody.temperature, 0.1);
    assert.strictEqual(result.providerName, 'groq');
    assert.strictEqual(result.systemFingerprint, 'fp_groq_01a2b3c4');
    assert.strictEqual(result.responseId, 'chatcmpl-groq-mock-123');
    assert.strictEqual(result.seedApplied, true);
  });

  it('3. NvidiaEvalProvider formats requests to NVIDIA NIM and handles missing system_fingerprint', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const customFetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string);

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          id: 'nv-cmpl-456',
          model: 'openai/gpt-oss-20b',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"nvidia_eval": true}',
              },
            },
          ],
          usage: {
            prompt_tokens: 150,
            completion_tokens: 50,
          },
        }),
      } as unknown as Response;
    };

    const nvidiaProvider = new NvidiaEvalProvider({
      apiKey: 'nvapi-mock-key',
      model: 'openai/gpt-oss-20b',
      fetchImpl: customFetch as any,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are SIM-02.' },
      { role: 'user', content: 'Scenario text...' },
    ];

    const result = await nvidiaProvider.complete(messages, {
      temperature: 0.1,
    });

    assert.strictEqual(capturedUrl, 'https://integrate.api.nvidia.com/v1/chat/completions');
    const authHeader = capturedHeaders['Authorization'] || capturedHeaders['authorization'];
    assert.strictEqual(authHeader, 'Bearer nvapi-mock-key');
    assert.strictEqual(capturedBody.model, 'openai/gpt-oss-20b');
    assert.strictEqual(result.providerName, 'nvidia');
    assert.strictEqual(result.systemFingerprint, null);
    assert.strictEqual(result.responseId, 'nv-cmpl-456');
  });

  it('4. Retries on 429 status with exponential backoff and Retry-After header, failing cleanly on exhaustion', async () => {
    let attempts = 0;
    const retryDelays: number[] = [];

    const customFetch = async () => {
      attempts++;
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
        text: async () => 'Rate limit exceeded: TPM limit reached',
      } as unknown as Response;
    };

    const groqProvider = new GroqEvalProvider({
      apiKey: 'gsk_test',
      model: 'qwen/qwen3.8-27b',
      maxRetries: 2,
      baseBackoffMs: 10,
      fetchImpl: customFetch as any,
      sleepFn: async (ms) => {
        retryDelays.push(ms);
      },
    });

    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];

    await assert.rejects(
      async () => {
        await groqProvider.complete(messages);
      },
      (err: any) => {
        assert(err.message.includes('RATE_LIMIT_EXHAUSTED'));
        assert.strictEqual(err.statusCode, 429);
        return true;
      }
    );

    // Initial try + 2 retries = 3 attempts total
    assert.strictEqual(attempts, 3);
    assert.strictEqual(retryDelays.length, 2);
  });
});
