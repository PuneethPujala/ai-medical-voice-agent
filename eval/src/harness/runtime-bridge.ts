/**
 * MedVoice Clinical Response Evaluation Framework
 * Production Runtime Bridge
 *
 * Enforces:
 * 1. Direct programmatic invocation of production dialogue handler (/api/voice/chat).
 * 2. Fresh session initialization per turn via createIsolatedSession().
 * 3. Strict persona lock to "dr-sarah-chen" (Chief of Internal Medicine).
 * 4. Zero physician reference leakage (hard security gate rejecting reference texts).
 * 5. Production voice-length guard verification (<60 words).
 * 6. Full operational telemetry capture (latency, token estimate, prompt hash, timestamps).
 */

import * as crypto from 'crypto';
import { POST as postVoiceChat } from '../../../app/api/voice/chat/route';
import {
  DEFAULT_INTERNAL_TEST_SECRET,
  INTERNAL_TEST_SECRET_HEADER,
} from '../../../lib/auth/rbac';
import { setCustomDbClient } from '../../../config/db';
import { createIsolatedSession, resetSessionBarrier } from './session-isolation';
import { ClinicalInterviewState } from '../../../lib/triage/conversation-manager';

// Ensure required test environment variables are active
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';
if (!process.env.INTERNAL_TEST_SECRET) {
  (process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;
}

// Enforce in-memory datastore isolation
setCustomDbClient(false);

export interface TurnContext {
  role: 'patient' | 'physician' | 'doctor' | 'assistant';
  text: string;
}

export interface IsolatedTurnOptions {
  doctorId?: 'dr-sarah-chen';
  patientName?: string;
  patientAge?: number;
  initialState?: ClinicalInterviewState;
  // Forbidden fields to prevent benchmark data leakage:
  physician_reference?: never;
  reference?: never;
  gold_reference?: never;
}

export interface TurnTelemetry {
  executionLatencyMs: number;
  promptHash: string;
  timestamp: string;
  modelCheckpoint: string;
  provider: string;
  tokenCountEstimated: number;
  retryCount: number;
  wordCount: number;
}

export interface TurnExecutionResult {
  doctorReply: string;
  telemetry: TurnTelemetry;
  interviewState: ClinicalInterviewState;
  phase: string;
  isEmergency: boolean;
  voiceGuardPassed: boolean;
  rawResponse: any;
}

/**
 * Executes an isolated clinical dialogue turn against MedVoice's production runtime.
 */
export async function executeIsolatedTurn(
  patientQuery: string,
  context?: TurnContext[],
  options?: IsolatedTurnOptions
): Promise<TurnExecutionResult> {
  const startTime = performance.now();

  // 1. Hard Security Gate: Prevent physician reference leakage
  if (options && typeof options === 'object') {
    const rawOpts = options as Record<string, any>;
    if (
      'physician_reference' in rawOpts ||
      'reference' in rawOpts ||
      'gold_reference' in rawOpts ||
      'physician_response' in rawOpts
    ) {
      throw new Error(
        'Physician reference leakage detected! The evaluation harness strictly forbids passing reference text to the production runtime.'
      );
    }
  }

  // 2. Input Validation
  if (!patientQuery || typeof patientQuery !== 'string' || !patientQuery.trim()) {
    throw new Error('Message is required and must be text. Empty patient query rejected.');
  }

  const cleanQuery = patientQuery.trim();

  // 3. Prompt Hash (SHA-256)
  const promptHash = crypto
    .createHash('sha256')
    .update(cleanQuery)
    .digest('hex');

  // 4. Clean State Barrier
  resetSessionBarrier();
  const sessionState = options?.initialState
    ? options.initialState
    : createIsolatedSession();

  // Format context history for production route
  const conversationHistory = Array.isArray(context)
    ? context.map((c) => ({
        role: c.role === 'physician' ? 'doctor' : c.role,
        text: c.text,
      }))
    : [];

  // 5. Construct Synthetic Request
  const testUserId = `eval-runner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const headers = new Headers({
    'Content-Type': 'application/json',
    'x-mock-role': 'patient',
    'x-mock-user-id': testUserId,
    [INTERNAL_TEST_SECRET_HEADER]: process.env.INTERNAL_TEST_SECRET || DEFAULT_INTERNAL_TEST_SECRET,
  });

  const requestBody = {
    doctorId: 'dr-sarah-chen', // Persona is strictly locked
    message: cleanQuery,
    conversationHistory,
    interviewState: sessionState,
    patientName: options?.patientName || 'Patient',
    patientAge: options?.patientAge,
  };

  const syntheticRequest = new Request('https://medvoice.org/api/voice/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  // 6. Invoke Production Runtime Handler
  let response: Response;
  try {
    response = await postVoiceChat(syntheticRequest);
  } catch (err: any) {
    throw new Error(`Runtime bridge invocation error: ${err?.message || err}`);
  }

  const endTime = performance.now();
  const executionLatencyMs = Math.max(1, Math.round(endTime - startTime));

  if (response.status !== 200) {
    let errBody = '';
    try {
      errBody = await response.text();
    } catch {
      // ignore
    }
    throw new Error(`Runtime bridge returned HTTP ${response.status}: ${errBody}`);
  }

  const payload = await response.json();
  const doctorReply = typeof payload?.doctorReply === 'string' ? payload.doctorReply.trim() : '';

  // 7. Voice-Length Guard Verification (<60 words)
  const wordCount = doctorReply ? doctorReply.split(/\s+/).filter(Boolean).length : 0;
  const voiceGuardPassed = wordCount <= 60;

  // 8. Assemble Operational Telemetry
  const telemetry: TurnTelemetry = {
    executionLatencyMs,
    promptHash,
    timestamp: new Date().toISOString(),
    modelCheckpoint: payload?.llmMeta?.model || 'production-dialogue-runtime',
    provider: payload?.llmMeta?.provider || 'internal-clinical-engine',
    tokenCountEstimated: Math.max(1, Math.round(wordCount * 1.33)),
    retryCount: 0,
    wordCount,
  };

  return {
    doctorReply,
    telemetry,
    interviewState: payload.interviewState || sessionState,
    phase: payload.phase || payload.interviewState?.phase || 'active_inquiring',
    isEmergency: Boolean(
      payload.isEmergency ||
      payload.triage?.isEmergency ||
      payload.triage?.triageLevel === 'emergency'
    ),
    voiceGuardPassed,
    rawResponse: payload,
  };
}
