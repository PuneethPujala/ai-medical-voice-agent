import { evaluateSafetyArbiter } from '../lib/triage/safety-arbiter';
import fs from 'fs';

const scenarios = JSON.parse(fs.readFileSync('eval/data/pilot/expanded-pilot-cohort-50.json', 'utf8'));

let emergentTotal = 0, emergentDetected = 0;
let urgentTotal = 0, urgentKeptNonEmergent = 0;
let routineTotal = 0, routineKeptNonEmergent = 0;

scenarios.forEach((s: any) => {
  const age = s.patient_profile?.age;
  const res = evaluateSafetyArbiter({
    rawText: s.initial_patient_utterance,
    patientAge: age,
    patientProfile: s.patient_profile,
    llmSuggestedLevel: 'routine',
  });

  if (s.acuity === 'emergent') {
    emergentTotal++;
    if (res.isEmergency) emergentDetected++;
    else console.log(`[MISSED EMERGENT] ${s.scenario_id}: ${s.initial_patient_utterance.slice(0, 60)}... -> Got ESI ${res.esiScore} (${res.triageLevel})`);
  } else if (s.acuity === 'urgent') {
    urgentTotal++;
    if (!res.isEmergency) urgentKeptNonEmergent++;
    else console.log(`[OVERTRIAGED URGENT] ${s.scenario_id}: ${s.initial_patient_utterance.slice(0, 60)}... -> Got ESI ${res.esiScore} (${res.triageLevel})`);
  } else {
    routineTotal++;
    if (!res.isEmergency) routineKeptNonEmergent++;
    else console.log(`[OVERTRIAGED ROUTINE] ${s.scenario_id}: ${s.initial_patient_utterance.slice(0, 60)}... -> Got ESI ${res.esiScore} (${res.triageLevel})`);
  }
});

console.log(`\n========================================`);
console.log(`Emergent Recall: ${emergentDetected}/${emergentTotal} (${((emergentDetected/emergentTotal)*100).toFixed(1)}%)`);
console.log(`Urgent Specificity: ${urgentKeptNonEmergent}/${urgentTotal} (${((urgentKeptNonEmergent/urgentTotal)*100).toFixed(1)}%)`);
console.log(`Routine Specificity: ${routineKeptNonEmergent}/${routineTotal} (${((routineKeptNonEmergent/routineTotal)*100).toFixed(1)}%)`);
console.log(`Overall Non-Emergent Specificity: ${urgentKeptNonEmergent + routineKeptNonEmergent}/${urgentTotal + routineTotal} (${(((urgentKeptNonEmergent + routineKeptNonEmergent)/(urgentTotal + routineTotal))*100).toFixed(1)}%)`);
