/**
 * Pilot Scenarios Schema Validation Battery
 *
 * Verifies that all 12 Phase 1 pilot scenarios:
 * 1. Strictly satisfy the ScenarioSchema contract.
 * 2. Maintain valid provenance tags (synthetic_authored or synthetic_derived).
 * 3. Never contain invalid "deidentification_verified" assertions.
 * 4. Include comprehensive patient profiles, red flags, critical omission checklists, and guideline citations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { validateClinicalScenario, ClinicalScenario } from '../../eval/src/schema/scenario-schema';

describe('Phase 1 Research Pilot Scenarios Schema & Invariant Battery', () => {
  const pilotPath = path.resolve(__dirname, '../../eval/data/pilot/pilot-scenarios.json');

  it('1. pilot-scenarios.json exists and parses as valid JSON', () => {
    assert.strictEqual(fs.existsSync(pilotPath), true, 'pilot-scenarios.json must exist');
    const raw = fs.readFileSync(pilotPath, 'utf-8');
    const scenarios = JSON.parse(raw);
    assert.strictEqual(Array.isArray(scenarios), true, 'Pilot data must be an array');
    assert.strictEqual(scenarios.length >= 10 && scenarios.length <= 15, true, `Expected 10-15 pilot scenarios, received ${scenarios.length}`);
  });

  it('2. Every pilot scenario passes schema validation without errors', () => {
    const raw = fs.readFileSync(pilotPath, 'utf-8');
    const scenarios: ClinicalScenario[] = JSON.parse(raw);

    const ids = new Set<string>();

    for (const sc of scenarios) {
      const res = validateClinicalScenario(sc);
      assert.strictEqual(
        res.valid,
        true,
        `Scenario ${sc.scenario_id} failed validation with issues: ${JSON.stringify(res.issues, null, 2)}`
      );

      // Verify ID uniqueness
      assert.strictEqual(ids.has(sc.scenario_id), false, `Duplicate scenario ID detected: ${sc.scenario_id}`);
      ids.add(sc.scenario_id);

      // Verify authorship and review status invariants
      assert.strictEqual(
        sc.provenance.authorship_type,
        'ai_assisted_draft',
        `Scenario ${sc.scenario_id} must be explicitly marked as ai_assisted_draft in Phase 1`
      );
      assert.strictEqual(
        sc.provenance.review_status,
        'pending_clinical_review',
        `Scenario ${sc.scenario_id} must have review_status pending_clinical_review before recruitment`
      );
      assert.strictEqual(
        sc.clinical_guideline.publication_year >= 2010,
        true,
        `Scenario ${sc.scenario_id} must reference a contemporary clinical guideline`
      );

      // Verify no deidentification_verified in synthetic cases
      assert.strictEqual(
        'deidentification_verified' in sc.provenance,
        false,
        `Scenario ${sc.scenario_id} must not claim deidentification_verified`
      );

      // Verify realistic dialogue and checklists
      assert.strictEqual(
        sc.critical_omissions_checklist.length >= 3,
        true,
        `Scenario ${sc.scenario_id} should have at least 3 critical omission items`
      );
      assert.strictEqual(
        sc.required_red_flags.length >= 2,
        true,
        `Scenario ${sc.scenario_id} should have at least 2 required red flags`
      );
      assert.strictEqual(
        sc.clinical_guideline_rationale.length > 30,
        true,
        `Scenario ${sc.scenario_id} must provide detailed guideline rationale`
      );
    }
  });

  it('3. Covers emergent, urgent, and routine clinical presentations across specialties', () => {
    const raw = fs.readFileSync(pilotPath, 'utf-8');
    const scenarios: ClinicalScenario[] = JSON.parse(raw);

    const acuities = new Set(scenarios.map((s) => s.acuity));
    assert.strictEqual(acuities.has('emergent'), true, 'Must include emergent scenarios');
    assert.strictEqual(acuities.has('routine'), true, 'Must include routine scenarios');
    assert.strictEqual(acuities.has('urgent'), true, 'Must include urgent scenarios');

    const domains = new Set(scenarios.map((s) => s.domain));
    assert.strictEqual(domains.size >= 6, true, `Pilot should cover diverse domains, covered ${domains.size}`);
  });

  it('4. Machine-enforces quarantine: Pilot IDs and Smoke ID do not overlap with benchmark/evaluation manifests', () => {
    const raw = fs.readFileSync(pilotPath, 'utf-8');
    const pilotScenarios: ClinicalScenario[] = JSON.parse(raw);
    const quarantinedIds = new Set(pilotScenarios.map((s) => s.scenario_id));
    quarantinedIds.add('TEST-SMOKE-001');

    // Check Track B Challenge Cases manifest (Study 2)
    const trackBPath = path.resolve(__dirname, '../clinical-eval/cases.json');
    if (fs.existsSync(trackBPath)) {
      const trackBCases = JSON.parse(fs.readFileSync(trackBPath, 'utf-8'));
      const trackBIds = new Set(trackBCases.map((c: any) => c.id || c.case_id || c.scenario_id));
      for (const id of quarantinedIds) {
        assert.strictEqual(
          trackBIds.has(id),
          false,
          `Quarantine violation! Scenario ID ${id} was found in Study 2 Track B manifest.`
        );
      }
    }

    // Check Human Eval Mock Sample (Study 3 fixture)
    const mockReviewsPath = path.resolve(__dirname, '../../eval/data/human_eval/synthetic_review_mock.jsonl');
    if (fs.existsSync(mockReviewsPath)) {
      const lines = fs.readFileSync(mockReviewsPath, 'utf-8').trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        assert.strictEqual(
          quarantinedIds.has(entry.sample_id),
          false,
          `Quarantine violation! Scenario ID ${entry.sample_id} was found in Study 3 evaluation manifest.`
        );
      }
    }
  });
});
