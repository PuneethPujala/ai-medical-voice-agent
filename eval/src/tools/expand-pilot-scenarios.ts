/**
 * Pilot Scenario Expansion Utility
 * Assembles all 50 authentic clinical vignettes into eval/data/pilot/pilot-scenarios.json
 */

import fs from 'fs';
import path from 'path';
import { ClinicalScenario, validateClinicalScenario } from '../schema/scenario-schema';
import { batch1Scenarios } from './scenario-data-batch1';
import { batch2Scenarios } from './scenario-data-batch2';
import { batch3Scenarios } from './scenario-data-batch3';

const pilotPath = path.resolve('eval/data/pilot/pilot-scenarios.json');
const existingRaw = fs.readFileSync(pilotPath, 'utf8');
const existingScenarios: ClinicalScenario[] = JSON.parse(existingRaw);

// We keep the original 12 calibration cases
const base12Scenarios = existingScenarios.slice(0, 12);

console.log(`Original baseline scenarios: ${base12Scenarios.length}`);
console.log(`Batch 1 scenarios: ${batch1Scenarios.length}`);
console.log(`Batch 2 scenarios: ${batch2Scenarios.length}`);
console.log(`Batch 3 scenarios: ${batch3Scenarios.length}`);

const all50Scenarios: ClinicalScenario[] = [
  ...base12Scenarios,
  ...batch1Scenarios,
  ...batch2Scenarios,
  ...batch3Scenarios,
];

console.log(`Total assembled scenarios: ${all50Scenarios.length}`);

if (all50Scenarios.length !== 50) {
  throw new Error(`Expected exactly 50 scenarios, assembled ${all50Scenarios.length}`);
}

// Validate every scenario against ClinicalScenario schema and invariants
const ids = new Set<string>();
for (let i = 0; i < all50Scenarios.length; i++) {
  const sc = all50Scenarios[i];
  const validation = validateClinicalScenario(sc);
  if (!validation.valid) {
    throw new Error(`Scenario ${sc.scenario_id} (index ${i}) failed schema validation: ${JSON.stringify(validation.issues, null, 2)}`);
  }

  if (ids.has(sc.scenario_id)) {
    throw new Error(`Duplicate scenario ID detected: ${sc.scenario_id}`);
  }
  ids.add(sc.scenario_id);

  // Invariant checks
  if (sc.provenance.authorship_type !== 'ai_assisted_draft') {
    throw new Error(`Scenario ${sc.scenario_id} must have authorship_type ai_assisted_draft`);
  }
  if (sc.provenance.review_status !== 'pending_clinical_review') {
    throw new Error(`Scenario ${sc.scenario_id} must have review_status pending_clinical_review`);
  }
  if ('deidentification_verified' in sc.provenance) {
    throw new Error(`Scenario ${sc.scenario_id} must not claim deidentification_verified`);
  }
  if (sc.critical_omissions_checklist.length < 3) {
    throw new Error(`Scenario ${sc.scenario_id} must have at least 3 critical omissions items`);
  }
  if (sc.required_red_flags.length < 2) {
    throw new Error(`Scenario ${sc.scenario_id} must have at least 2 required red flags`);
  }
  if (sc.clinical_guideline_rationale.length <= 30) {
    throw new Error(`Scenario ${sc.scenario_id} guideline rationale too short`);
  }
  if (sc.clinical_guideline.publication_year < 2010) {
    throw new Error(`Scenario ${sc.scenario_id} guideline must be >= 2010`);
  }
}

console.log('All 50 scenarios passed 100% of schema invariants!');

// Write to eval/data/pilot/pilot-scenarios.json
fs.writeFileSync(pilotPath, JSON.stringify(all50Scenarios, null, 2), 'utf8');
console.log(`Successfully written 50 clinical vignettes to ${pilotPath}`);
