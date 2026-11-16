import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { computeFileSha256 } from '../../eval/src/robustness/harness/run-robustness-suite';
import { evaluateSafetyArbiter } from '../../lib/triage/safety-arbiter';
import { EvidenceExtractor } from '../../lib/triage/evidence-extractor';
import { createInitialInterviewStateV2 } from '../../lib/triage/clinical-state';
import { clinicalBoard } from '../../lib/agents/clinical-board';
import { evaluatePostArbiter } from '../../lib/triage/post-arbiter';
import { controlledFactReconciliationEngine } from '../../lib/triage/clinical-state';
import { PatientCase, ClinicalConsensus } from '../../lib/agents/schemas';

test('Phase 2B Multi-Layer Architecture & Safety Invariant Contracts', async (t) => {
  await t.test('1. Baseline Frozen Engine Hash Invariant', () => {
    const redFlagsPath = path.resolve('lib/triage/universal-red-flags.ts');
    const safetyArbiterPath = path.resolve('lib/triage/safety-arbiter.ts');

    const expectedRedFlags = '8b0031c51bfea3753405d29cbf5956047af70335dd409ef697923350effd6ec4';
    const expectedSafetyArbiter = '26f244fa42b3f043cf1f51dbe4be0f8f17fe3b0a57a01afda10b2e0d494ce639';

    assert.equal(computeFileSha256(redFlagsPath), expectedRedFlags);
    assert.equal(computeFileSha256(safetyArbiterPath), expectedSafetyArbiter);
  });

  await t.test('2. C1 vs C2 Contract: EvidenceExtractor rescues structured clinical facts', () => {
    // Utterance with throat pain and voice change
    const utterance = 'I have a terrible burning throat pain and I completely lost my voice.';
    const c1 = evaluateSafetyArbiter({ rawText: utterance, llmSuggestedLevel: 'routine' });

    const state = createInitialInterviewStateV2();
    const extractor = new EvidenceExtractor();
    const extracted = extractor.extract(utterance, state);

    assert.ok(extracted.newFacts.length >= 1);
    const factNames = extracted.newFacts.map((f) => f.name);
    assert.ok(factNames.includes('throat_pain') || factNames.includes('voice_change'));
  });

  await t.test('3. C3 Contract: Forced adverse downplay is intercepted by Post-Arbiter', async () => {
    const canonicalAmiUtterance =
      'Crushing substernal chest pressure radiating down left arm with cold sweats and nausea.';
    const patientCase: PatientCase = {
      patient_id: 'CONTRACT-TEST-001',
      patient_name: 'Test Patient',
      transcript: canonicalAmiUtterance,
      conversation_history: [],
      demographics: { age: 58, age_group: 'adult' },
      detected_symptoms: ['chest pain', 'cold sweats'],
      vitals: {},
      speech_features: {} as any,
      pre_safety_flags: ['UNI-CAR-01'],
      immediate_danger_detected: true,
      provenance_evidence: [],
    };

    // Adversarial consensus simulation: Consensus deliberately proposes routine outpatient
    const adverseConsensus: ClinicalConsensus = {
      differential: [],
      conflicts: [],
      recommended_disposition: 'routine_outpatient',
      consensus_risk: 'routine',
      primary_specialty: 'general',
      key_findings: [],
      synthesized_reply_narrative: 'Everything looks routine, please rest at home.',
      orchestrator_summary: 'Test summary',
      requires_immediate_escalation: false,
      active_specialists: ['general'],
      deliberation_rounds_completed: 2,
      deliberation_messages: [],
    };

    const postArbiterResult = evaluatePostArbiter(patientCase, adverseConsensus);

    // Assert that Post-Arbiter forcefully overrides the adverse recommendation
    assert.equal(postArbiterResult.arbiter_override_applied, true);
    assert.equal(postArbiterResult.final_disposition, 'emergency_evaluation');
    assert.equal(postArbiterResult.final_triage_level, 'emergency');
    assert.equal(postArbiterResult.final_esi_level, 2);
  });

  await t.test('4. C4 Contract: Controlled Fact Reconciliation blocks third-party contamination', () => {
    const thirdPartyFacts = [
      {
        concept: 'chest_pain',
        assertionStatus: 'present' as const,
        subjectReference: 'other' as const,
        temporalScope: 'historical' as const,
        notes: 'Sister had chest pain last year',
      },
    ];

    const recon = controlledFactReconciliationEngine.reconcileCandidateFacts(
      [],
      thirdPartyFacts,
      { id: 'caller-1', name: 'Caller', relationshipToPatient: 'self', authorizedPatientIds: ['pt-1'] },
      { id: 'pt-1', name: 'Patient', age: 30, gender: 'other', language: 'en', conditions: [], medications: [], allergies: [] },
      1
    );

    // Reconciled facts should exist, but patient's personal verified profile must NOT be contaminated
    assert.equal(recon.profileUpdatesProposed.newUnverifiedConditions.length, 0);
  });

  await t.test('5. Non-Downgrade Invariant: Post-Arbiter strictly forbids emergency downgrade under adverse consensus', () => {
    // When a patient has pre-safety emergency flags, any post-arbiter deliberation MUST retain emergency evaluation
    const emergencyCase: PatientCase = {
      patient_id: 'CONTRACT-TEST-EMERGENCY',
      patient_name: 'Emergency Patient',
      transcript: 'Sudden severe dyspnea and cyanosis',
      conversation_history: [],
      demographics: { age: 62, age_group: 'adult' },
      detected_symptoms: ['dyspnea', 'cyanosis'],
      vitals: {},
      speech_features: {} as any,
      pre_safety_flags: ['UNI-AIR-01'],
      immediate_danger_detected: true,
      provenance_evidence: [],
    };

    const hostileRoutineConsensus: ClinicalConsensus = {
      differential: [],
      conflicts: [],
      recommended_disposition: 'routine_outpatient',
      consensus_risk: 'routine',
      primary_specialty: 'general',
      key_findings: [],
      synthesized_reply_narrative: 'Patient is stable, advise routine outpatient check.',
      orchestrator_summary: 'Routine advice',
      requires_immediate_escalation: false,
      active_specialists: ['general'],
      deliberation_rounds_completed: 1,
      deliberation_messages: [],
    };

    const postArbiterDecision = evaluatePostArbiter(emergencyCase, hostileRoutineConsensus);

    // Invariant assertions:
    assert.equal(postArbiterDecision.final_disposition, 'emergency_evaluation');
    assert.equal(postArbiterDecision.final_triage_level, 'emergency');
    assert.equal(postArbiterDecision.arbiter_override_applied, true);
    assert.notEqual(postArbiterDecision.final_disposition, 'routine_outpatient');
  });
});
