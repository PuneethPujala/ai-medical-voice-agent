/**
 * MedVoice AI: Clinical Adjudication Inspection & Audit Utility
 * 
 * Verifies and audits the clinical equivalence review status of Track B
 * colloquial paraphrase candidates across all 29 parent emergency clusters.
 */

import fs from 'fs';
import path from 'path';
import { RobustnessTestCase } from '../eval/src/robustness/types';

const fixturesDir = path.resolve('eval/src/robustness/fixtures');
const paraphrasesPath = path.join(fixturesDir, 'adversarial_paraphrases_145.json');

function auditAdjudicationStatus() {
  if (!fs.existsSync(paraphrasesPath)) {
    console.error('Error: Paraphrase fixtures not found at:', paraphrasesPath);
    process.exit(1);
  }

  const cases: RobustnessTestCase[] = JSON.parse(fs.readFileSync(paraphrasesPath, 'utf8'));

  console.log('='.repeat(78));
  console.log('       MEDVOICE AI CLINICAL EQUIVALENCE ADJUDICATION AUDIT');
  console.log('='.repeat(78));
  console.log(`Total Candidates in Track B: ${cases.length}\n`);

  let pendingCount = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let reviseCount = 0;

  for (const tc of cases) {
    const review = tc.clinical_equivalence_review;
    if (!review || review.adjudicationStatus === 'PENDING') {
      pendingCount++;
    } else if (review.adjudicationStatus === 'ACCEPTED') {
      acceptedCount++;
    } else if (review.adjudicationStatus === 'REJECTED') {
      rejectedCount++;
    } else if (review.adjudicationStatus === 'REVISE') {
      reviseCount++;
    }
  }

  console.log('Adjudication Status Breakdown:');
  console.log(`  • PENDING Review   : ${pendingCount} / ${cases.length} (${((pendingCount / cases.length) * 100).toFixed(1)}%)`);
  console.log(`  • ACCEPTED         : ${acceptedCount} / ${cases.length} (${((acceptedCount / cases.length) * 100).toFixed(1)}%)`);
  console.log(`  • REVISE Required  : ${reviseCount} / ${cases.length} (${((reviseCount / cases.length) * 100).toFixed(1)}%)`);
  console.log(`  • REJECTED         : ${rejectedCount} / ${cases.length} (${((rejectedCount / cases.length) * 100).toFixed(1)}%)`);
  console.log('-'.repeat(78));

  if (pendingCount > 0) {
    console.log(`[Governance Notice] Cohort contains ${pendingCount} candidate paraphrases awaiting independent clinician sign-off.`);
    console.log('Current evaluation metrics on Track B represent exploratory findings on candidate paraphrases.\n');
  } else {
    console.log('[Governance Notice] All candidate paraphrases have completed clinical adjudication.\n');
  }
}

auditAdjudicationStatus();
