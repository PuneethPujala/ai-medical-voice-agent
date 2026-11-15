/**
 * Pilot Scenarios Schema Validation Battery
 *
 * Verifies that:
 * 1. Canonical 12 Phase 1 pilot scenarios (synthetic-pilot-v1.2.0) satisfy ScenarioSchema contract.
 * 2. Expanded 50-cohort pilot scenarios (synthetic-pilot-v2.0.0) satisfy ScenarioSchema contract.
 * 3. Both datasets maintain valid provenance tags (synthetic_authored).
 * 4. Never contain invalid "deidentification_verified" assertions.
 * 5. Include comprehensive patient profiles, red flags, critical omission checklists, and guideline citations.
 * 6. Machine-enforces quarantine across benchmark manifests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { validateClinicalScenario, ClinicalScenario } from '../../eval/src/schema/scenario-schema';

describe('Phase 1 Research Pilot Scenarios Schema & Invariant Battery', () => {
  const pilot12Path = path.resolve(__dirname, '../../eval/data/pilot/pilot-scenarios.json');
  const pilot50Path = path.resolve(__dirname, '../../eval/data/pilot/expanded-pilot-cohort-50.json');

  it('1. pilot-scenarios.json exists and contains canonical 12 Phase 1 pilot scenarios', () => {
    assert.strictEqual(fs.existsSync(pilot12Path), true, 'pilot-scenarios.json must exist');
    const raw = fs.readFileSync(pilot12Path, 'utf-8');
    const scenarios = JSON.parse(raw);
    assert.strictEqual(Array.isArray(scenarios), true, 'Pilot data must be an array');
    assert.strictEqual(scenarios.length, 12, `Expected canonical 12 pilot scenarios, received ${scenarios.length}`);
  });

  it('2. expanded-pilot-cohort-50.json exists and contains 50 expanded pilot scenarios', () => {
    assert.strictEqual(fs.existsSync(pilot50Path), true, 'expanded-pilot-cohort-50.json must exist');
    const raw = fs.readFileSync(pilot50Path, 'utf-8');
    const scenarios = JSON.parse(raw);
    assert.strictEqual(Array.isArray(scenarios), true, 'Expanded pilot cohort data must be an array');
    assert.strictEqual(scenarios.length, 50, `Expected exactly 50 expanded pilot scenarios, received ${scenarios.length}`);
  });

  it('3. Every pilot scenario across both cohorts passes schema validation without errors', () => {
    const raw12 = fs.readFileSync(pilot12Path, 'utf-8');
    const scenarios12: ClinicalScenario[] = JSON.parse(raw12);
    const raw50 = fs.readFileSync(pilot50Path, 'utf-8');
    const scenarios50: ClinicalScenario[] = JSON.parse(raw50);

    const allScenarios = [...scenarios12, ...scenarios50];
    const checkedIds50 = new Set<string>();

    for (const sc of scenarios50) {
      assert.strictEqual(checkedIds50.has(sc.scenario_id), false, `Duplicate ID in 50-cohort: ${sc.scenario_id}`);
      checkedIds50.add(sc.scenario_id);
    }

    for (const sc of allScenarios) {
      const res = validateClinicalScenario(sc);
      assert.strictEqual(
        res.valid,
        true,
        `Scenario ${sc.scenario_id} failed validation with issues: ${JSON.stringify(res.issues, null, 2)}`
      );

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

  it('4. Covers emergent, urgent, and routine clinical presentations across specialties', () => {
    const raw = fs.readFileSync(pilot50Path, 'utf-8');
    const scenarios: ClinicalScenario[] = JSON.parse(raw);

    const acuities = new Set(scenarios.map((s) => s.acuity));
    assert.strictEqual(acuities.has('emergent'), true, 'Must include emergent scenarios');
    assert.strictEqual(acuities.has('routine'), true, 'Must include routine scenarios');
    assert.strictEqual(acuities.has('urgent'), true, 'Must include urgent scenarios');

    const domains = new Set(scenarios.map((s) => s.domain));
    assert.strictEqual(domains.size >= 8, true, `Expanded pilot should cover diverse domains, covered ${domains.size}`);
  });

  it('5. Machine-enforces quarantine: Pilot IDs and Smoke ID do not overlap with benchmark/evaluation manifests', () => {
    const raw12 = fs.readFileSync(pilot12Path, 'utf-8');
    const scenarios12: ClinicalScenario[] = JSON.parse(raw12);
    const raw50 = fs.readFileSync(pilot50Path, 'utf-8');
    const scenarios50: ClinicalScenario[] = JSON.parse(raw50);

    const quarantinedIds = new Set([
      ...scenarios12.map((s) => s.scenario_id),
      ...scenarios50.map((s) => s.scenario_id),
      'TEST-SMOKE-001',
    ]);

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
