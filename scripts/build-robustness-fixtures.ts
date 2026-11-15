import fs from 'fs';
import path from 'path';
import { RobustnessTestCase } from '../eval/src/robustness/types';

const cohort50Path = path.resolve('eval/data/pilot/expanded-pilot-cohort-50.json');
const cohort50 = JSON.parse(fs.readFileSync(cohort50Path, 'utf8'));

const fixturesDir = path.resolve('eval/src/robustness/fixtures');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// 1. Extract 29 Canonical Emergencies (Track A)
const canonical29: RobustnessTestCase[] = cohort50
  .filter((s: any) => s.acuity === 'emergent')
  .map((s: any) => ({
    test_case_id: `CANONICAL-${s.scenario_id}`,
    parent_scenario_id: s.scenario_id,
    track: 'A_CANONICAL' as const,
    clinical_domain: s.domain,
    target_emergency_condition: s.subspecialty || s.domain,
    variant_type: 'canonical_baseline' as const,
    patient_utterance: s.initial_patient_utterance,
    expected_safety_floor: 'HIGH_RISK' as const,
    expected_emergency_escalation: true,
    clinical_rationale: s.clinical_guideline_rationale || 'Canonical ESI v4 life threat',
  }));

fs.writeFileSync(
  path.join(fixturesDir, 'canonical_emergencies_29.json'),
  JSON.stringify(canonical29, null, 2),
  'utf8'
);
console.log(`Generated canonical_emergencies_29.json (${canonical29.length} cases)`);

// 2. Extract 21 Non-Emergency Controls (Track C)
const controls21: RobustnessTestCase[] = cohort50
  .filter((s: any) => s.acuity !== 'emergent')
  .map((s: any) => ({
    test_case_id: `CONTROL-${s.scenario_id}`,
    parent_scenario_id: s.scenario_id,
    track: 'C_CONTROL' as const,
    clinical_domain: s.domain,
    target_emergency_condition: s.subspecialty || s.domain,
    variant_type: 'non_emergent_control' as const,
    patient_utterance: s.initial_patient_utterance,
    expected_safety_floor: 'NONE' as const,
    expected_emergency_escalation: false,
    clinical_rationale: s.clinical_guideline_rationale || 'Non-emergent control (urgent/routine)',
  }));

fs.writeFileSync(
  path.join(fixturesDir, 'non_emergency_controls_21.json'),
  JSON.stringify(controls21, null, 2),
  'utf8'
);
console.log(`Generated non_emergency_controls_21.json (${controls21.length} cases)`);
