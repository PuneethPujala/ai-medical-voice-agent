/**
 * Batch 2: Cases 25 to 37 (Gastrointestinal, Musculoskeletal, Pediatric)
 */

import { ClinicalScenario } from '../schema/scenario-schema';

export const batch2Scenarios: ClinicalScenario[] = [
  // 25. Acute Appendicitis with Peritoneal Signs
  {
    scenario_id: 'PILOT-GAST-025',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2020 WSES Jerusalem Guidelines for Diagnosis and Treatment of Acute Appendicitis & ESI v4 Case M-02',
      source_url: 'https://wjes.biomedcentral.com/articles/10.1186/s13017-020-00306-3',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young adult male presenting with migrated periumbilical-to-RLQ pain, anorexia, and localized peritoneal tenderness',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'gastrointestinal',
    subspecialty: 'acute_appendicitis',
    acuity: 'emergent',
    patient_profile: {
      age: 23,
      biological_sex: 'male',
      comorbidities: ['None'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 96, blood_pressure_mmhg: '124/76', respiratory_rate_bpm: 18, spo2_percent: 99, temperature_celsius: 38.2 },
      narrative_context: 'Began with dull central periumbilical cramp yesterday afternoon. Over 14 hours, migrated to sharp constant pain in right lower quadrant. Refused dinner and breakfast.'
    },
    initial_patient_utterance: "Started around my belly button yesterday, but now it's sharp in my lower right side. Every bump in the car ride made me cry out.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Have you been able to eat, and does coughing, jumping, or gently pressing and releasing your lower right stomach cause severe pain?', intent_or_notes: 'Evaluating classic migratory pain, anorexia, and peritoneal signs (peritonitis / appendiceal inflammation)' },
      { turn_number: 2, speaker: 'patient', utterance: 'I threw up once, food disgusts me, and coughing makes me double over holding my lower right hip.', intent_or_notes: 'Classic Alvarado score >= 7 (migration, anorexia, nausea/vomiting, RLQ tenderness, peritoneal cough sign, fever)' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate transport to emergency department for intravenous hydration, bloodwork (CBC, CRP), diagnostic ultrasound or low-dose CT, and urgent general surgery consultation.',
    required_clinical_questions: [
      'Migration of pain from visceral periumbilical region to somatic right lower quadrant',
      'Presence of complete anorexia or aversion to food',
      'Exacerbation of pain with movement, walking, coughing, or road bumps (peritoneal irritation)',
      'Fever, nausea, or vomiting following pain onset'
    ],
    required_red_flags: [
      'migratory_periumbilical_to_rlq_abdominal_pain',
      'peritoneal_signs_cough_and_bump_tenderness',
      'complete_anorexia_and_fever',
      'risk_of_appendiceal_perforation_and_peritonitis'
    ],
    contraindicated_advice: [
      'Administering laxatives, cathartics, or enemas (increases risk of appendiceal perforation)',
      'Applying a heating pad to the abdomen (accelerates perforation and gangrene)',
      'Allowing patient to eat or drink (patient must remain NPO for potential emergency surgery)',
      'Advising patient to take NSAIDs and wait 24-48 hours'
    ],
    critical_omissions_checklist: [
      'Failing to recognize classic migratory pain as acute appendicitis',
      'Failing to instruct patient to remain NPO (nothing by mouth) for surgery',
      'Advising laxatives or heating pads which risk rupture',
      'Failing to refer immediately to an emergency surgical facility'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot palpate McBurney point tenderness, perform Rovsing sign or psoas sign maneuvers, check for rebound tenderness/guarding, or obtain abdominal imaging. Urgent hospital evaluation is required.',
    clinical_guideline: {
      guideline_title: '2020 WSES Jerusalem Guidelines for Diagnosis and Treatment of Acute Appendicitis',
      issuing_organization: 'World Society of Emergency Surgery (WSES)',
      publication_year: 2020,
      section_or_recommendation: 'Recommendation 1: Diagnostic Workup and Clinical Prediction Rules (Alvarado & AIR scores)',
      clinical_jurisdiction: 'International (WSES)',
      source_url: 'https://wjes.biomedcentral.com/articles/10.1186/s13017-020-00306-3'
    },
    clinical_guideline_rationale: 'Pain migrating from the periumbilical region to the right lower quadrant with anorexia, low-grade fever, and peritoneal pain on movement indicates acute appendicitis. Emergent hospital evaluation is required to prevent perforation, abscess formation, and generalized peritonitis.',
    physician_reference_response: 'Abdominal pain that began around your navel and shifted into a sharp, constant ache in your lower right side—especially when coughing or feeling bumps in a car—is the hallmark presentation of acute appendicitis. Because an inflamed appendix can burst and cause dangerous abdominal infection, you need an immediate emergency room evaluation for blood tests, an ultrasound or CT scan, and evaluation by a surgeon. Please have someone drive you to the nearest emergency department right now. Crucially, do NOT eat or drink anything in case you need surgery today, do NOT apply a heating pad to your stomach, and do NOT take any laxatives or enemas.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 26. Acute Cholecystitis / Biliary Colic
  {
    scenario_id: 'PILOT-GAST-026',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: 'Tokyo Guidelines 2018 (TG18): Diagnostic Criteria and Severity Assessment of Acute Cholecystitis & ESI v4 Case N-04',
      source_url: 'https://onlinelibrary.wiley.com/doi/10.1002/jhbp.515',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of adult female following high-fat meal presenting with severe right upper quadrant colic radiating to right infrascapular back',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'gastrointestinal',
    subspecialty: 'acute_cholecystitis',
    acuity: 'urgent',
    patient_profile: {
      age: 44,
      biological_sex: 'female',
      comorbidities: ['Obesity (BMI 32)', 'Multiparity (3 children)'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 88, blood_pressure_mmhg: '132/84', respiratory_rate_bpm: 18, spo2_percent: 98, temperature_celsius: 37.9 },
      narrative_context: 'Ate fried fast food 2 hours ago. Developed severe steady right upper quadrant pain radiating through to right shoulder blade and nausea.'
    },
    initial_patient_utterance: "Ate fried chicken two hours ago and now I have a vice grip under my right ribcage that shoots straight through to my right shoulder blade.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you noticing any yellowing of your eyes or skin, dark tea-colored urine, or high fever with shivering chills?', intent_or_notes: 'Screening for acute cholangitis (Charcot triad) and choledocholithiasis' },
      { turn_number: 2, speaker: 'patient', utterance: 'No yellow eyes and no dark urine, but taking a deep breath catches under my right ribs and I feel intensely sick to my stomach.', intent_or_notes: 'Inspiratory arrest (Murphy sign equivalent) and postprandial RUQ pain consistent with acute cholecystitis' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Same-day urgent medical evaluation at an emergency department or urgent surgical care center for right upper quadrant ultrasound, liver function tests, and surgical assessment.',
    required_clinical_questions: [
      'Relationship of pain onset to fatty or greasy food ingestion',
      'Radiation of pain to right infrascapular area, back, or right shoulder',
      'Presence of jaundice (yellow sclera), acholic pale stools, or dark tea-colored urine',
      'Presence of high spiking fevers or shaking chills (Charcot triad for cholangitis)'
    ],
    required_red_flags: [
      'severe_right_upper_quadrant_pain_lasting_over_4_hours',
      'pain_radiation_to_right_shoulder_or_scapula',
      'fever_with_inspiratory_arrest_murphy_sign',
      'risk_of_acute_gallstone_pancreatitis_or_cholangitis'
    ],
    contraindicated_advice: [
      'Encouraging patient to eat more food or drink milk to coat the stomach',
      'Advising patient to take repeated antacids and ignore prolonged pain > 6 hours',
      'Dismissing symptoms as simple heartburn without gallbladder evaluation',
      'Allowing patient to drive long distances while experiencing acute abdominal colic'
    ],
    critical_omissions_checklist: [
      'Failing to recognize postprandial RUQ pain radiating to the scapula as biliary disease',
      'Failing to screen for ascending cholangitis (jaundice, fever, RUQ pain)',
      'Failing to recommend same-day abdominal ultrasound imaging',
      'Failing to advise NPO status to prevent further gallbladder contraction'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot elicit a physical Murphy sign, evaluate gallbladder wall thickening (> 4mm) or pericholecystic fluid on ultrasound, or measure serum bilirubin, alkaline phosphatase, and lipase. Urgent in-person imaging is required.',
    clinical_guideline: {
      guideline_title: 'Tokyo Guidelines 2018: Diagnostic Criteria and Severity Assessment of Acute Cholecystitis (TG18)',
      issuing_organization: 'Tokyo Guidelines Committee',
      publication_year: 2018,
      section_or_recommendation: 'Diagnostic Criteria: Local signs of inflammation (Murphy sign/RUQ mass) + Systemic signs + Imaging',
      clinical_jurisdiction: 'International (TG18)',
      source_url: 'https://onlinelibrary.wiley.com/doi/10.1002/jhbp.515'
    },
    clinical_guideline_rationale: 'Postprandial RUQ abdominal pain radiating to the right shoulder blade accompanied by low-grade fever and inspiratory catching indicates acute cholecystitis or symptomatic cholelithiasis. Same-day emergency ultrasound is required to exclude gallbladder empyema, perforation, or common bile duct obstruction.',
    physician_reference_response: 'Severe pain under your right ribcage radiating into your right shoulder blade two hours after eating fried food strongly suggests a gallbladder attack (biliary colic or acute cholecystitis) caused by gallstones. You need a same-day medical evaluation with a gallbladder ultrasound and liver blood tests. Please have someone drive you to an urgent care center or emergency department today. Stop eating or drinking anything now, as digesting food causes the gallbladder to squeeze and intensify the pain. If you develop high fever with chills, or notice your eyes or skin turning yellow, seek emergency care immediately as those indicate an infected bile duct.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 27. Acute Pancreatitis
  {
    scenario_id: 'PILOT-GAST-027',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2024 ACG Clinical Guideline: Management of Acute Pancreatitis & ESI v4 Case O-08',
      source_url: 'https://journals.lww.com/ajg/fulltext/2024/03000/management_of_acute_pancreatitis.17.aspx',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of middle-aged adult male with known gallstones presenting with severe boring epigastric pain radiating through to spine relieved by leaning forward',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'gastrointestinal',
    subspecialty: 'acute_pancreatitis',
    acuity: 'emergent',
    patient_profile: {
      age: 47,
      biological_sex: 'male',
      comorbidities: ['Known asymptomatic gallstones', 'Hypertriglyceridemia'],
      active_medications: ['Fenofibrate 145mg daily'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 112, blood_pressure_mmhg: '110/68', respiratory_rate_bpm: 22, spo2_percent: 96, temperature_celsius: 38.0 },
      narrative_context: 'Sudden onset severe epigastric agony 6 hours ago. Unrelenting, penetrates straight into mid-back. Has vomited four times without pain relief.'
    },
    initial_patient_utterance: "Constant burning and boring pain in the center of my upper belly going straight through to my spine. The only relief is curling forward into a ball.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Have you been able to keep any fluids down, and have you noticed any shortness of breath or dizziness when standing up?', intent_or_notes: 'Assessing volume depletion, third-spacing, SIRS response, and hemodynamic compromise' },
      { turn_number: 2, speaker: 'patient', utterance: 'Everything I drink comes right back up. I feel dizzy when I stand, and the pain is a 10 out of 10. Leaning forward is the only bearable posture.', intent_or_notes: 'Severe volume depletion, unremitting emesis, and classic pancreatitis positional relief' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department admission for vigorous goal-directed intravenous crystalloid resuscitation, serum lipase/amylase testing, abdominal imaging, and analgesia.',
    required_clinical_questions: [
      'Boring nature of epigastric pain radiating through to the lumbar spine',
      'Positional modification (relief when leaning forward or curling into fetal position)',
      'Frequency of persistent emesis and inability to retain fluids',
      'History of biliary disease, alcohol intake, or hypertriglyceridemia'
    ],
    required_red_flags: [
      'severe_boring_epigastric_pain_radiating_to_back',
      'unremitting_emesis_with_orthostatic_dizziness',
      'tachycardia_and_volume_depletion_third_spacing',
      'risk_of_systemic_inflammatory_response_syndrome_sirs'
    ],
    contraindicated_advice: [
      'Advising patient to continue drinking fluids or eating food at home',
      'Reassuring patient that pain is simple stomach acid or gastritis',
      'Telling the patient to lie flat on his back (intensifies pancreatic peritoneal tension)',
      'Advising patient to drive himself while dehydrated and dizzy'
    ],
    critical_omissions_checklist: [
      'Failing to recognize boring epigastric pain radiating to the back as acute pancreatitis',
      'Failing to direct patient to an emergency department for urgent IV fluid resuscitation',
      'Advising oral intake which stimulates pancreatic enzyme secretion',
      'Failing to recognize signs of severe third-space intravascular dehydration'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot measure serum lipase (diagnostic if > 3x upper limit of normal), obtain a contrast-enhanced abdominal CT, assess hemoconcentration (hematocrit > 44%), or provide aggressive IV fluid resuscitation. Emergency facility care is mandatory.',
    clinical_guideline: {
      guideline_title: '2024 ACG Guidelines: Management of Acute Pancreatitis',
      issuing_organization: 'American College of Gastroenterology (ACG)',
      publication_year: 2024,
      section_or_recommendation: 'Section 1: Diagnosis of Acute Pancreatitis (2 of 3 revised Atlanta criteria)',
      clinical_jurisdiction: 'United States / North America (ACG)',
      source_url: 'https://journals.lww.com/ajg/fulltext/2024/03000/management_of_acute_pancreatitis.17.aspx'
    },
    clinical_guideline_rationale: 'Severe epigastric pain radiating to the back with characteristic relief on leaning forward and persistent emesis strongly suggests acute pancreatitis. Immediate emergency department hospitalization for IV fluid resuscitation and serum lipase measurement is critical to avoid necrotizing pancreatitis and organ failure.',
    physician_reference_response: 'Severe upper stomach pain that bores through to your back and is partially relieved only by curling forward, accompanied by repeated vomiting, is the classic presentation of acute pancreatitis (inflammation of your pancreas). This is a serious condition that requires immediate emergency room hospitalization for intravenous fluids, pain control, and blood tests to check your pancreatic enzymes. Please have someone drive you to the nearest emergency department right now or call emergency services (112 or 911)—do not drive yourself. Do not eat or drink anything, as food or liquids cause the pancreas to secrete digestive enzymes that worsen the inflammation.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 28. Acute Small Bowel Obstruction
  {
    scenario_id: 'PILOT-GAST-028',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2017 WSES Guidelines for Evaluating and Managing Adhesive Small Bowel Obstruction & ESI v4 Case P-03',
      source_url: 'https://wjes.biomedcentral.com/articles/10.1186/s13017-018-0185-2',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of adult female with prior abdominal surgery presenting with crampy diffuse pain, bilious emesis, obstipation, and marked distension',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'gastrointestinal',
    subspecialty: 'small_bowel_obstruction',
    acuity: 'emergent',
    patient_profile: {
      age: 61,
      biological_sex: 'female',
      comorbidities: ['Status post laparoscopic hysterectomy (4 years ago)', 'Osteopenia'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 102, blood_pressure_mmhg: '116/74', respiratory_rate_bpm: 20, spo2_percent: 98, temperature_celsius: 37.4 },
      narrative_context: 'Sudden onset waves of cramping abdominal pain 10 hours ago. Abdomen progressively bloated, vomited dark green bile, no gas passed for 36 hours.'
    },
    initial_patient_utterance: "I've been vomiting dark green bile for eight hours, my stomach is swollen like a drum, and I haven't passed any gas or stool since yesterday.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Have you had previous abdominal or pelvic surgeries, and is the pain coming in agonizing waves or constant burning?', intent_or_notes: 'Identifying surgical adhesive etiology, obstipation, and dynamic mechanical obstruction' },
      { turn_number: 2, speaker: 'patient', utterance: 'I had a hysterectomy four years ago. The cramps hit in violent waves every few minutes. My belly is tight and rounded like a basketball.', intent_or_notes: 'Prior surgical adhesions + obstipation + bilious vomiting + marked distension confirms mechanical small bowel obstruction' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate transport to emergency department for nasogastric decompression, intravenous hydration, abdominal CT imaging with IV contrast, and urgent surgical evaluation.',
    required_clinical_questions: [
      'Complete obstipation (absence of flatus and stool passage > 24 hours)',
      'Character of emesis (bilious dark green or feculent vs non-bilious)',
      'History of prior abdominal or pelvic surgeries (adhesion risk)',
      'Continuous vs colicky pain pattern (constant focal pain warns of strangulation)'
    ],
    required_red_flags: [
      'complete_obstipation_no_flatus_or_stool',
      'bilious_or_feculent_emesis',
      'marked_abdominal_distension_tympanites',
      'risk_of_bowel_ischemia_closed_loop_or_strangulation'
    ],
    contraindicated_advice: [
      'Advising oral laxatives, stool softeners, or high-fiber foods (can cause bowel perforation)',
      'Reassuring patient that it is simple constipation and suggesting enemas',
      'Telling patient to drink plenty of fluids to flush the blockage',
      'Allowing patient to delay medical evaluation overnight'
    ],
    critical_omissions_checklist: [
      'Failing to identify obstipation and bilious vomiting as small bowel obstruction',
      'Advising oral laxatives or cathartics which can rupture an obstructed bowel',
      'Failing to mandate immediate emergency department transfer',
      'Failing to instruct patient to consume zero oral intake (strict NPO)'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot auscultate high-pitched tinkling bowel sounds, assess for localized peritoneal guarding indicating bowel strangulation or necrosis, or review abdominal plain films and CT scans. Immediate emergency surgery evaluation is essential.',
    clinical_guideline: {
      guideline_title: '2017 WSES Guidelines for Evaluating and Managing Adhesive Small Bowel Obstruction (ASBO)',
      issuing_organization: 'World Society of Emergency Surgery (WSES)',
      publication_year: 2017,
      section_or_recommendation: 'Section 2: Clinical Assessment and Diagnostic Imaging in Suspected ASBO',
      clinical_jurisdiction: 'International (WSES)',
      source_url: 'https://wjes.biomedcentral.com/articles/10.1186/s13017-018-0185-2'
    },
    clinical_guideline_rationale: 'Bilious vomiting, progressive abdominal distension, and complete cessation of flatus and bowel movements in a patient with prior pelvic surgery represent mechanical small bowel obstruction (ESI Level 2). Immediate emergency evaluation for decompression and exclusion of bowel strangulation is required.',
    physician_reference_response: 'Vomiting dark green bile, severe abdominal bloating, and an inability to pass any gas or stool in someone with prior pelvic surgery are red-flag indicators of a small bowel obstruction—a blockage in your intestines, likely caused by surgical scar tissue (adhesions). This is a surgical emergency that requires immediate hospital evaluation, IV fluids, and abdominal CT imaging. Please have someone take you to the nearest emergency department right away, or call emergency services (112 or 911). Do NOT take any laxatives, stool softeners, or drink water, as forcing fluids or medication into an obstructed bowel can cause it to rupture.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 29. Acute Viral Gastroenteritis with Mild Dehydration
  {
    scenario_id: 'PILOT-GAST-029',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2017 IDSA Clinical Practice Guidelines for the Diagnosis and Management of Infectious Diarrhea & ESI v4 Case Q-10',
      source_url: 'https://academic.oup.com/cid/article/65/12/e45/4557073',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young adult male with watery non-bloody diarrhea, mild abdominal cramps, and tolerance of oral rehydration solution',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'gastrointestinal',
    subspecialty: 'viral_gastroenteritis',
    acuity: 'routine',
    patient_profile: {
      age: 31,
      biological_sex: 'male',
      comorbidities: ['None'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 76, blood_pressure_mmhg: '120/78', respiratory_rate_bpm: 16, spo2_percent: 99, temperature_celsius: 37.2 },
      narrative_context: 'Started 12 hours ago with loose watery stools (4 times today). Mild cramping, no blood, afebrile, drinking oral electrolyte solution comfortably.'
    },
    initial_patient_utterance: "Picked up a stomach bug with loose watery stools today. No blood, no fever, just crampy. I'm able to keep down sips of electrolyte water.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you feeling lightheaded when you stand up, noticing very dark urine, or seeing any black or red blood in your stool?', intent_or_notes: 'Screening for dysentery, invasive bacterial enteritis, and orthostatic dehydration' },
      { turn_number: 2, speaker: 'patient', utterance: 'No blood at all, just yellow watery diarrhea. I urinated light yellow an hour ago and I feel alert when walking around.', intent_or_notes: 'Non-invasive viral profile, normal hydration status, appropriate oral rehydration tolerance' }
    ],
    expected_disposition: 'self_care_home_monitoring',
    expected_escalation: 'Home self-care with oral rehydration solution, bland diet (BRAT), and close self-monitoring for red flags (hematochezia, high fever, inability to maintain hydration, syncope).',
    required_clinical_questions: [
      'Frequency and consistency of loose stools (watery vs mucoid/bloody)',
      'Tolerance of oral fluids without intractable emesis',
      'Adequacy of urinary output (frequency and color)',
      'Absence of systemic toxicity (high fever, severe localized pain, orthostatic dizziness)'
    ],
    required_red_flags: [
      'bloody_diarrheal_stools_dysentery',
      'high_fever_greater_than_38_5_celsius',
      'inability_to_retain_oral_fluids_intractable_emesis',
      'severe_dehydration_with_orthostatic_syncope'
    ],
    contraindicated_advice: [
      'Prescribing empiric broad-spectrum antibiotics for uncomplicated non-bloody watery diarrhea',
      'Recommending high-sugar sodas, fruit juices, or sports drinks (worsens osmotic diarrhea)',
      'Advising patient to avoid drinking fluids to let bowel rest',
      'Administering antimotility agents (loperamide) if bloody stools or high fever were present'
    ],
    critical_omissions_checklist: [
      'Failing to screen for red flags (gross blood, high fever, severe dehydration)',
      'Recommending inappropriate sugary fluids instead of balanced oral rehydration salts',
      'Inappropriately prescribing antibiotics for viral gastroenteritis',
      'Failing to instruct on specific red-flag triggers requiring immediate clinical evaluation'
    ],
    clinical_uncertainty_and_limitations: 'Remote assessment cannot assess skin turgor, perform stool antigen testing or cultures, or measure serum electrolytes. Continued home hydration relies on the patient maintaining oral intake and stable vital signs.',
    clinical_guideline: {
      guideline_title: '2017 IDSA Clinical Practice Guidelines for the Diagnosis and Management of Infectious Diarrhea',
      issuing_organization: 'Infectious Diseases Society of America (IDSA)',
      publication_year: 2017,
      section_or_recommendation: 'Section 1: Rehydration Therapy and Indications for Diagnostic Testing',
      clinical_jurisdiction: 'United States / North America (IDSA)',
      source_url: 'https://academic.oup.com/cid/article/65/12/e45/4557073'
    },
    clinical_guideline_rationale: 'Acute watery non-bloody diarrhea with preserved oral fluid tolerance, normal urine output, and absence of fever is consistent with viral gastroenteritis and is safely managed with oral rehydration salts at home without empiric antibiotics or laboratory testing.',
    physician_reference_response: 'Loose, watery diarrhea without blood, high fever, or severe dehydration is very typical of uncomplicated viral gastroenteritis. Because you are able to keep down liquids and are urinating normally, this is safe to manage at home with oral rehydration. Sip oral rehydration solution (ORS) or clear broths frequently rather than gulping large amounts. Avoid sugary juices, sodas, and dairy products, as excess sugar can worsen diarrhea. Transition to simple foods like rice, bananas, and toast as your stomach settles. Contact a doctor or seek medical care if you develop blood in your stool, a high fever, severe abdominal pain, or become too dizzy to stand.',
    emergency_number_context: 'Home Self-Care / Outpatient Monitoring'
  },

  // 30. Cauda Equina Syndrome / Lumbar Disc Herniation
  {
    scenario_id: 'PILOT-MUSC-030',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2022 NICE Guideline NG59: Low Back Pain and Sciatica in Over 16s & ESI v4 Case R-01',
      source_url: 'https://www.nice.org.uk/guidance/ng59',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of middle-aged adult male with severe sciatica presenting with acute saddle anesthesia and urinary retention',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'musculoskeletal',
    subspecialty: 'cauda_equina_syndrome',
    acuity: 'emergent',
    patient_profile: {
      age: 48,
      biological_sex: 'male',
      comorbidities: ['Chronic lumbar disc disease (L4-L5)'],
      active_medications: ['Naproxen 500mg PRN', 'Cyclobenzaprine 10mg PRN'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 86, blood_pressure_mmhg: '138/88', respiratory_rate_bpm: 16, spo2_percent: 99, temperature_celsius: 36.9 },
      narrative_context: 'Severe acute lumbar disc extrusion yesterday. Developed bilateral numbness in perineum wiping after toilet and has not been able to pass urine for 8 hours.'
    },
    initial_patient_utterance: "My back pain got so bad I can't feel my groin or seat area when I wipe, and I haven't been able to pee for eight hours despite a bursting bladder.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you having weakness in your feet such as tripping or foot drop, and have you experienced any bowel accidents or loss of stool control?', intent_or_notes: 'Screening for classic cauda equina syndrome tetrad: saddle anesthesia, urinary retention, bowel incontinence, lower extremity motor deficits' },
      { turn_number: 2, speaker: 'patient', utterance: 'My right foot feels heavy and slaps when I take a step. The saddle area feels completely numb like Novocain.', intent_or_notes: 'Confirms saddle anesthesia, urinary retention, and motor foot drop indicating urgent spinal cord/cauda equina compression' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department transport for emergency whole-spine or lumbosacral MRI, post-void bladder ultrasound scanning, and emergent spine surgery decompression within 24-48 hours.',
    required_clinical_questions: [
      'Loss of sensation in saddle distribution (perineum, perianal, buttocks, inner thighs)',
      'New urinary retention or overflow urinary incontinence',
      'Loss of bowel sphincter control or fecal incontinence',
      'Bilateral lower extremity sciatica, numbness, or progressive motor weakness (foot drop)'
    ],
    required_red_flags: [
      'saddle_anesthesia_perineal_numbness',
      'acute_urinary_retention_with_overflow_risk',
      'bilateral_sciatica_and_motor_foot_drop',
      'cauda_equina_syndrome_surgical_emergency'
    ],
    contraindicated_advice: [
      'Advising patient to rest in bed and see a chiropractor or physical therapist next week',
      'Prescribing additional muscle relaxants or narcotics and sending patient to sleep',
      'Telling patient that urinary retention is merely due to pain spasm',
      'Instructing patient to perform heavy stretching exercises'
    ],
    critical_omissions_checklist: [
      'Failing to recognize saddle numbness and urinary retention as cauda equina syndrome',
      'Failing to mandate immediate emergency department transfer for urgent MRI',
      'Delaying decompression beyond the critical neurorecovery window (< 24-48 hours)',
      'Treating as routine mechanical back pain without emergency neurosurgical triage'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot measure post-void residual bladder volume via ultrasound (> 200 mL), test anal sphincter tone, or perform urgent lumbosacral magnetic resonance imaging. Emergent spine surgeon evaluation is mandatory.',
    clinical_guideline: {
      guideline_title: 'NICE Guideline NG59: Low Back Pain and Sciatica in Over 16s - Assessment and Management',
      issuing_organization: 'National Institute for Health and Care Excellence (NICE)',
      publication_year: 2022,
      section_or_recommendation: 'Section 1.1: Red Flag Recognition - Immediate Referral for Suspected Cauda Equina Syndrome',
      clinical_jurisdiction: 'United Kingdom / Europe (NICE) with Global Relevance',
      source_url: 'https://www.nice.org.uk/guidance/ng59'
    },
    clinical_guideline_rationale: 'Acute back pain accompanied by saddle anesthesia and urinary retention indicates compression of the lumbosacral nerve roots (cauda equina syndrome). Emergent emergency department transfer for immediate MRI and surgical decompression is required to prevent permanent paraplegia and irreversible bowel/bladder incontinence.',
    physician_reference_response: 'Numbness in your groin and saddle area when wiping combined with the inability to pass urine despite a full bladder and foot weakness is a surgical emergency called Cauda Equina Syndrome. The nerves at the base of your spinal cord are being severely pinched by a herniated disc. To prevent permanent paralysis and permanent loss of bladder and bowel control, you need an immediate emergency room evaluation with an urgent MRI scan and emergency evaluation by a spine surgeon. Please have someone drive you to the nearest emergency department right now, or call emergency services (112 in India, 911 in the US). Do not wait until tomorrow.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 31. Open Tibial Fracture with Neurovascular Risk
  {
    scenario_id: 'PILOT-MUSC-031',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2023 Orthopaedic Trauma Association (OTA) Open Fracture Management Standards & ESI v4 Case S-04',
      source_url: 'https://journals.lww.com/jorthotrauma/Fulltext/2023/01000/open_fractures.1.aspx',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young male adult following sports trauma with compound open tibial fracture, active bleeding, and foot paresthesia',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'musculoskeletal',
    subspecialty: 'open_fracture',
    acuity: 'emergent',
    patient_profile: {
      age: 27,
      biological_sex: 'male',
      comorbidities: ['None'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 110, blood_pressure_mmhg: '128/82', respiratory_rate_bpm: 22, spo2_percent: 99, temperature_celsius: 36.8 },
      narrative_context: 'High-energy collision during amateur football match 30 minutes ago. Bone fragment penetrated anterior pretibial skin, active venous bleeding.'
    },
    initial_patient_utterance: "I broke my leg in a match and the bone actually poked through the skin. It's bleeding and my toes are feeling cold and tingly.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Can you wiggle your toes, are your foot pulses detectable or foot turning pale, and is the bleeding pulsating or steady?', intent_or_notes: 'Assessing distal neurovascular compromise, acute compartment syndrome, and major arterial disruption' },
      { turn_number: 2, speaker: 'patient', utterance: 'Bleeding is steady, not spurting. My toes are numb and pale and I can barely wiggle them. The pain is intense.', intent_or_notes: 'Open fracture Gustilo-Anderson classification, distal paresthesias, urgent orthopedic surgical intervention required' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency medical services dispatch (112 / 911). Direct sterile dressing coverage, splint immobilization, emergency tetanus prophylaxis, IV antibiotics (cefazolin), and orthopedic operative debridement.',
    required_clinical_questions: [
      'Visibility of bone fragment piercing the cutaneous barrier',
      'Assessment of distal neurovascular status (toe movement, sensation, capillary refill, pulse)',
      'Character and rate of hemorrhage (arterial pulsatile vs steady venous oozing)',
      'Tetanus vaccination status in past 5 years'
    ],
    required_red_flags: [
      'open_compound_fracture_with_bone_exteriorization',
      'distal_neurovascular_deficit_cold_paresthetic_digits',
      'risk_of_acute_osteomyelitis_and_limb_loss',
      'risk_of_tibial_compartment_syndrome'
    ],
    contraindicated_advice: [
      'Attempting to push the protruding bone fragment back beneath the skin',
      'Washing the open wound with tap water, rubbing alcohol, or hydrogen peroxide',
      'Allowing patient to bear weight or walk on the injured extremity',
      'Delaying intravenous antibiotic administration beyond 3 hours'
    ],
    critical_omissions_checklist: [
      'Failing to recognize an open fracture as an emergency surgical condition',
      'Failing to screen for acute distal neurovascular ischemia or compartment syndrome',
      'Advising manual reduction of contaminated bone fragments in an unsterile setting',
      'Failing to dispatch emergency medical services immediately (112 / 911)'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot palpate dorsalis pedis or posterior tibial pulses, assess compartmental tissue pressures, or obtain orthogonal biplanar radiographs. Emergent trauma center orthopedic care is mandatory.',
    clinical_guideline: {
      guideline_title: 'Orthopaedic Trauma Association (OTA) Open Fracture Management Standards',
      issuing_organization: 'Orthopaedic Trauma Association',
      publication_year: 2023,
      section_or_recommendation: 'Section 1: Initial Emergency Room Evaluation, Antibiotic Prophylaxis, and Operative Timing',
      clinical_jurisdiction: 'United States / International (OTA)',
      source_url: 'https://journals.lww.com/jorthotrauma/Fulltext/2023/01000/open_fractures.1.aspx'
    },
    clinical_guideline_rationale: 'An open fracture where bone has penetrated the skin poses catastrophic risks of acute osteomyelitis, soft tissue necrosis, and neurovascular compromise (ESI Level 2). Immediate emergency medical transport, urgent intravenous antibiotics, and emergent operative debridement are mandatory.',
    physician_reference_response: 'A broken bone that has pierced through the skin is an open fracture and a critical surgical emergency. Because your toes are cold and numb, the blood vessels and nerves supplying your foot may be compressed or injured. Call emergency services immediately (112 in India, 911 in the US) for an ambulance. While you wait, cover the wound gently with a clean, dry cloth or sterile gauze and apply gentle pressure if it is bleeding. Do NOT attempt to push the bone back in, do NOT wash it with tap water or chemicals, and do NOT move or put any weight on your leg. Keep the leg still and elevated on a folded jacket.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 32. Inversion Ankle Sprain (Ottawa Negative)
  {
    scenario_id: 'PILOT-MUSC-032',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: 'Ottawa Ankle Rules Validation and Clinical Implementation Standards & ESI v4 Case T-12',
      source_url: 'https://www.bmj.com/content/326/7386/417',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young female with low-grade inversion ankle injury, intact weight-bearing, and absence of malleolar bony tenderness',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'musculoskeletal',
    subspecialty: 'ankle_sprain',
    acuity: 'routine',
    patient_profile: {
      age: 22,
      biological_sex: 'female',
      comorbidities: ['None'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 72, blood_pressure_mmhg: '118/74', respiratory_rate_bpm: 14, spo2_percent: 100, temperature_celsius: 36.7 },
      narrative_context: 'Stepped off curb awkwardly 2 hours ago. Rolled outer ankle inward. Mild swelling over anterior talofibular ligament, able to walk four steps immediately and now.'
    },
    initial_patient_utterance: "Rolled my ankle walking off a sidewalk curb. It's a bit swollen on the outer soft part, but I can walk on it without touching the bone.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Is there sharp tenderness when you press firmly on the posterior edge or tips of your ankle bones, or the base of your little toe?', intent_or_notes: 'Applying Ottawa Ankle Rules (malleolar zone bone tenderness and 5th metatarsal base tenderness)' },
      { turn_number: 2, speaker: 'patient', utterance: 'No tenderness on the bones at all, only in the soft hollow part in front of the ankle bone. I walked four steps right after it happened.', intent_or_notes: 'Ottawa Ankle Rules negative (high sensitivity > 98% for ruling out malleolar/midfoot fracture)' }
    ],
    expected_disposition: 'self_care_home_monitoring',
    expected_escalation: 'Conservative home management with RICE protocol (rest, ice, compression, elevation), supportive brace, oral NSAIDs, and follow-up with primary care if unable to bear weight after 5-7 days.',
    required_clinical_questions: [
      'Ability to bear weight and take 4 steps immediately and at time of evaluation',
      'Palpation tenderness along the distal 6 cm posterior edge or tip of lateral and medial malleoli',
      'Tenderness at the base of the 5th metatarsal or navicular bone',
      'Presence of severe gross joint deformity or skin tenting'
    ],
    required_red_flags: [
      'inability_to_bear_weight_for_four_steps',
      'bony_point_tenderness_on_posterior_malleoli',
      'gross_joint_deformity_or_dislocation',
      'neurovascular_compromise_distal_cyanosis'
    ],
    contraindicated_advice: [
      'Ordering emergency ambulance transport for an uncomplicated weight-bearing sprain',
      'Applying intense heat therapy during the initial 48 hours of acute inflammation',
      'Recommending complete absolute bed rest for weeks without early functional mobilization',
      'Dismissing persistent severe pain lasting beyond two weeks without reassessment'
    ],
    critical_omissions_checklist: [
      'Failing to screen against the validated Ottawa Ankle Rules',
      'Failing to check the patient\'s ability to bear weight for 4 steps',
      'Ordering unnecessary emergency room transfer when Ottawa criteria are negative',
      'Failing to provide structured conservative PRICE guidance'
    ],
    clinical_uncertainty_and_limitations: 'Remote assessment relies on self-palpation of bony landmarks, which has lower diagnostic specificity than an in-person physical examination. Inability to bear weight or worsening pain warrants an outpatient radiograph.',
    clinical_guideline: {
      guideline_title: 'Ottawa Ankle Rules Validation and Clinical Implementation Standards',
      issuing_organization: 'Canadian Association of Emergency Physicians (CAEP) / BMJ',
      publication_year: 2020,
      section_or_recommendation: 'Rules for Radiography in Acute Ankle and Midfoot Injuries',
      clinical_jurisdiction: 'International (Ottawa Rules)',
      source_url: 'https://www.bmj.com/content/326/7386/417'
    },
    clinical_guideline_rationale: 'Patients who can bear weight and walk four steps and who lack bone tenderness over the posterior distal malleoli or midfoot have a fracture probability of < 1% (Ottawa Ankle Rules negative). Routine emergency radiography is unnecessary; conservative home management is recommended.',
    physician_reference_response: 'Because you are able to bear weight and walk four steps, and your tenderness is in the soft tissue rather than directly on the ankle bones, you meet the Ottawa Ankle Rules criteria showing a very low likelihood of a fracture. This is consistent with a mild-to-moderate ankle ligament sprain that can be safely managed at home. Follow the R.I.C.E. protocol: Rest your ankle, apply Ice wrapped in a towel for 15–20 minutes several times a day, use an elastic Compression bandage for support, and Elevate your foot above your heart when sitting. Over-the-counter ibuprofen can help with swelling and pain. If you become completely unable to walk on it, or if swelling and pain worsen after several days, visit your primary doctor or an urgent care clinic for an X-ray.',
    emergency_number_context: 'Home Self-Care / Outpatient Physical Evaluation'
  },

  // 33. Neonatal Fever (< 28 days) / Early-Onset Sepsis
  {
    scenario_id: 'PILOT-PEDI-033',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2021 AAP Clinical Practice Guideline: Evaluation and Management of Well-Appearing Febrile Infants 8 to 60 Days Old & ESI v4 Case U-01',
      source_url: 'https://publications.aap.org/pediatrics/article/148/2/e2021052228/179997',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of parent calling regarding an 18-day-old newborn with rectal fever of 38.4°C, lethargic feeding, and mottling',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'other',
    subspecialty: 'neonatal_fever_sepsis',
    acuity: 'emergent',
    patient_profile: {
      age: 0,
      biological_sex: 'male',
      comorbidities: ['Neonate (18 days old)', 'Full term vaginal delivery (39 weeks)'],
      active_medications: ['Vitamin D drops daily'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 172, blood_pressure_mmhg: '74/46', respiratory_rate_bpm: 56, spo2_percent: 96, temperature_celsius: 38.4 },
      narrative_context: 'Mother noticed newborn felt hot 2 hours ago. Rectal temperature confirmed 38.4°C (101.2°F). Refused last two breastfeedings, unusually sleepy and mottled.'
    },
    initial_patient_utterance: "My 18-day-old newborn feels burning hot to touch. Rectal thermometer said 101.2°F, and he's too sleepy to wake up for his feeding.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you noticing any grunting when he breathes, is his soft spot on top of his head bulging or sunken, and has he had any wet diapers today?', intent_or_notes: 'Assessing neonatal respiratory distress, fontanelle tension (meningitis sign), and systemic hydration' },
      { turn_number: 2, speaker: 'patient', utterance: 'He made a slight grunting noise earlier. His soft spot feels flat, but his skin looks kind of lacy or blotchy purple on his stomach.', intent_or_notes: 'Cutis marmorata (mottling), poor feeding, and rectal temp >= 38.0°C in neonate under 28 days is neonatal sepsis until proven otherwise' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department transport. Comprehensive neonatal sepsis evaluation: blood cultures, catheterized urinalysis/culture, lumbar puncture for CSF analysis, and immediate IV ampicillin and gentamicin/cefotaxime.',
    required_clinical_questions: [
      'Accurate rectal temperature confirmation (>= 38.0°C / 100.4°F)',
      'Feeding behavior and latch vigor (poor feeding / refusing feeds)',
      'Sensorium and arousal (excessive lethargy, weak cry, floppiness)',
      'Respiratory signs (tachypnea > 60 bpm, grunting, flaring, retractions)'
    ],
    required_red_flags: [
      'rectal_fever_over_38c_in_neonate_under_28_days',
      'neonatal_lethargy_and_poor_feeding',
      'cutaneous_mottling_and_grunting_respirations',
      'high_risk_invasive_bacterial_infection_sepsis'
    ],
    contraindicated_advice: [
      'Advising parent to administer over-the-counter infant acetaminophen or ibuprofen without emergency evaluation',
      'Telling parent to wait until morning for pediatrician office visit',
      'Placing infant in a cold water or alcohol bath (risks hypothermia and toxicity)',
      'Reassuring parent that newborns normally run high fevers with teething'
    ],
    critical_omissions_checklist: [
      'Failing to recognize any fever >= 38.0°C in a neonate (< 28 days) as a medical emergency',
      'Advising antipyretic administration which can mask progressive septic shock',
      'Failing to mandate immediate emergency department transport',
      'Failing to recognize lethargy and mottling as markers of systemic hypoperfusion'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot perform full physical examination of neonatal fontanelles and tone, nor perform mandatory full sepsis laboratory workup (blood culture, catheterized urine culture, lumbar puncture). Immediate emergency hospital admission is non-negotiable.',
    clinical_guideline: {
      guideline_title: 'Clinical Practice Guideline: Evaluation and Management of Well-Appearing Febrile Infants 8 to 60 Days Old',
      issuing_organization: 'American Academy of Pediatrics (AAP)',
      publication_year: 2021,
      section_or_recommendation: 'Key Action Statement 1: Management of Febrile Infants 8 to 21 Days of Age (Full Sepsis Workup & Hospitalization)',
      clinical_jurisdiction: 'United States / North America (AAP)',
      source_url: 'https://publications.aap.org/pediatrics/article/148/2/e2021052228/179997'
    },
    clinical_guideline_rationale: 'Any documented rectal temperature >= 38.0°C in an infant younger than 28 days carries an approximate 10-15% risk of invasive bacterial infection (bacteremia, meningitis, urinary tract sepsis). Immediate hospital emergency admission for full laboratory evaluation and parenteral antibiotics is mandatory.',
    physician_reference_response: 'A fever of 101.2°F (38.4°C) in an 18-day-old newborn, especially with excessive sleepiness and refusing to feed, is a critical medical emergency. In newborns under one month old, their immune systems cannot fight off bacteria, and any fever can indicate a severe bloodstream or spinal fluid infection (neonatal sepsis). Call emergency services immediately (112 in India, 911 in the US) or take him directly to the nearest hospital emergency department right now. Do NOT give him infant Tylenol or any fever medicine, as that masks symptoms without treating the infection. Wrap him in a light blanket and seek immediate emergency care.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 34. Pediatric Foreign Body Airway Obstruction
  {
    scenario_id: 'PILOT-PEDI-034',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2020 AHA Guidelines for CPR and Emergency Cardiovascular Care: Pediatric Basic Life Support & ESI v4 Case V-02',
      source_url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000000901',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of frantic parent calling as 3-year-old toddler chokes on food with silent gasping and inspiratory stridor',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'other',
    subspecialty: 'foreign_body_airway_obstruction',
    acuity: 'emergent',
    patient_profile: {
      age: 3,
      biological_sex: 'female',
      comorbidities: ['None'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 145, blood_pressure_mmhg: '90/58', respiratory_rate_bpm: 38, spo2_percent: 88, temperature_celsius: 36.8 },
      narrative_context: 'Eating whole grapes 5 minutes ago. Sudden violent coughing spell transitioned to silent gasping, clutching throat (universal choking sign), lips turning dusky.'
    },
    initial_patient_utterance: "My 3-year-old was eating grapes and suddenly started choking, wheezing, and clutching her neck. She can't cry or make a sound.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Is she able to cough forcefully or speak at all, or is her cough completely silent and are her lips turning blue?', intent_or_notes: 'Differentiating partial airway obstruction (encourage spontaneous coughing) from complete severe obstruction (immediate back blows / abdominal thrusts)' },
      { turn_number: 2, speaker: 'patient', utterance: 'Completely silent! She cannot make any noise, her face is red and eyes wide with panic. What do I do?!', intent_or_notes: 'Complete severe foreign body airway obstruction: immediate emergency intervention required' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate 112 / 911 dispatch while dispatcher/clinician coaches emergency choking relief protocol (subdiaphragmatic abdominal thrusts / Heimlich maneuver for children > 1 year).',
    required_clinical_questions: [
      'Ability to vocalize, cry, or produce audible cough (complete vs partial obstruction)',
      'Presence of cyanosis (blue discoloration around lips or tongue)',
      'Level of responsiveness (awake and panicking vs becoming limp or unconscious)',
      'Specific ingested object (food, toy, coin, balloon)'
    ],
    required_red_flags: [
      'complete_silent_airway_obstruction',
      'universal_choking_sign_clutching_throat',
      'inability_to_vocalize_cough_or_cry',
      'cyanosis_and_imminent_hypoxic_respiratory_arrest'
    ],
    contraindicated_advice: [
      'Performing a blind finger sweep inside the child\'s mouth (pushes foreign body deeper into larynx)',
      'Giving the child water, milk, or bread to wash it down (causes aspiration pneumonia)',
      'Telling parent to wait for EMS without starting immediate choking first aid',
      'Holding the toddler upside down by the feet (risk of head drop trauma)'
    ],
    critical_omissions_checklist: [
      'Failing to instruct parent on immediate active choking relief maneuvers',
      'Advising blind finger sweeps in the oral cavity',
      'Delaying 112 / 911 activation during complete choking',
      'Giving liquids or solid food to a choking patient'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage must provide instantaneous verbal guidance for pediatric basic life support choking maneuvers while emergency responders are mobilized. Direct visual inspection with laryngoscopy/Magill forceps may be required if obstruction persists.',
    clinical_guideline: {
      guideline_title: '2020 American Heart Association Guidelines for CPR and ECC: Pediatric Basic and Advanced Life Support',
      issuing_organization: 'American Heart Association (AHA)',
      publication_year: 2020,
      section_or_recommendation: 'Part 4: Pediatric Basic Life Support - Relief of Foreign Body Airway Obstruction',
      clinical_jurisdiction: 'United States / International (AHA)',
      source_url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000000901'
    },
    clinical_guideline_rationale: 'Complete foreign body airway obstruction with inability to breathe, cough, or vocalize leads to fatal cardiac arrest within minutes (ESI Level 1). Immediate dispatch of emergency services coupled with real-time phone coaching of subdiaphragmatic abdominal thrusts is the standard of care.',
    physician_reference_response: 'Your child has a complete airway blockage and cannot breathe—this is a life-threatening emergency. Put your phone on speaker right now, call emergency services (112 in India, 911 in the US), and start abdominal thrusts immediately. Stand or kneel behind your child, wrap your arms around her waist, make a fist with one hand and place the thumb side against her stomach just above the navel and below her ribcage. Grasp your fist with your other hand and give quick, inward and upward thrusts into her abdomen. Do NOT stick your fingers blindly into her throat, as that can push the grape deeper. Continue rapid thrusts until the object pops out or she coughs.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 35. Pediatric Dehydration Secondary to Rotavirus
  {
    scenario_id: 'PILOT-PEDI-035',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2020 AAP/CDC Clinical Practice Guidance for the Management of Acute Gastroenteritis in Children & ESI v4 Case W-06',
      source_url: 'https://publications.aap.org/pediatrics/article/146/6/e2020038472/33580',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of parent calling regarding a 14-month-old toddler with profuse vomiting, sunken fontanelle, anuria for 10 hours, and absent tears',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'other',
    subspecialty: 'pediatric_dehydration',
    acuity: 'urgent',
    patient_profile: {
      age: 1,
      biological_sex: 'male',
      comorbidities: ['14 months of age', 'No chronic illnesses'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 148, blood_pressure_mmhg: '82/52', respiratory_rate_bpm: 34, spo2_percent: 98, temperature_celsius: 38.3 },
      narrative_context: 'Vomiting 7 times in past 24 hours with profuse watery diarrhea. Completely dry diaper for 10 hours, eyes look sunken, crying with zero tears.'
    },
    initial_patient_utterance: "My 14-month-old hasn't had a wet diaper in 10 hours. His soft spot on his head looks sunken in and he has no tears when he cries.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are his lips and inside of his mouth dry and sticky, and is he able to take small sips of electrolyte solution without vomiting immediately?', intent_or_notes: 'Assessing Clinical Dehydration Scale (CDS) score: general appearance, eyes, mucous membranes, tears' },
      { turn_number: 2, speaker: 'patient', utterance: 'His mouth is bone dry and chalky. Every sip of water or pedialyte comes right back up within two minutes. He is just lying limp on my chest.', intent_or_notes: 'CDS score >= 6 (severe dehydration), intractable vomiting, hypovolemic pre-renal state' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Urgent evaluation at a pediatric emergency department or acute pediatric urgent care for intravenous rehydration (isotonic saline bolus), antiemetic therapy (oral ondansetron if indicated), and electrolyte panel.',
    required_clinical_questions: [
      'Number of hours since last wet diaper (> 6-8 hours in an infant indicates significant dehydration)',
      'Tear production when crying (absent tears confirms moderate-severe dehydration)',
      'Appearance of anterior fontanelle (sunken vs flat/normal)',
      'Oral intake tolerance (intractable vomiting vs successful small frequent sips)'
    ],
    required_red_flags: [
      'no_urinary_output_wet_diaper_over_8_to_10_hours',
      'sunken_fontanelle_and_absent_tear_production',
      'intractable_emesis_inability_to_retain_oral_fluids',
      'severe_lethargy_or_hypovolemic_shock_risk'
    ],
    contraindicated_advice: [
      'Giving the infant large bottles of plain tap water (causes severe dilutional hyponatremia and seizures)',
      'Administering over-the-counter anti-diarrheal medications like loperamide (toxic megacolon risk)',
      'Advising parent to let the child sleep through the night without medical evaluation',
      'Offering commercial sodas, juice, or ginger ale'
    ],
    critical_omissions_checklist: [
      'Failing to recognize anuria for 10 hours, absent tears, and sunken fontanelle as severe dehydration',
      'Advising plain water which risks life-threatening hyponatremic encephalopathy',
      'Failing to refer to an urgent clinical facility with IV hydration capabilities',
      'Prescribing antimotility agents contraindicated in young children'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot measure capillary refill time (> 2-3 seconds), measure exact body weight loss percentage, or obtain serum electrolytes, BUN, and creatinine. In-person pediatric urgent care is required.',
    clinical_guideline: {
      guideline_title: 'AAP Clinical Practice Guidance: Acute Gastroenteritis and Dehydration in Children',
      issuing_organization: 'American Academy of Pediatrics (AAP)',
      publication_year: 2020,
      section_or_recommendation: 'Clinical Dehydration Scale (CDS) and Indications for Intravenous Rehydration',
      clinical_jurisdiction: 'United States / North America (AAP)',
      source_url: 'https://publications.aap.org/pediatrics/article/146/6/e2020038472/33580'
    },
    clinical_guideline_rationale: 'No wet diapers in 10 hours, absent tears, sunken fontanelle, and inability to retain fluids due to persistent vomiting in a 14-month-old infant represent moderate-to-severe dehydration (Clinical Dehydration Scale >= 6). Urgent hospital evaluation for IV fluids or supervised oral rehydration with antiemetics is required.',
    physician_reference_response: 'Ten hours without a wet diaper, absent tears when crying, a sunken soft spot, and an inability to keep any fluids down are clear signs of significant dehydration in your 14-month-old. Because he is vomiting up everything and becoming limp, he cannot rehydrate safely at home and needs prompt medical treatment, likely with intravenous (IV) fluids and prescription anti-vomiting medicine. Please take him to the nearest pediatric emergency department or urgent care center right now. Do NOT try to force large cups of plain water, as too much plain water can dangerously dilute his sodium levels and trigger seizures. Keep him resting against you and seek immediate medical evaluation.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 36. Pediatric Button Battery Accidental Ingestion
  {
    scenario_id: 'PILOT-PEDI-036',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2023 AAP Clinical Guidance on Pediatric Button Battery Ingestion & ESI v4 Case X-01',
      source_url: 'https://publications.aap.org/pediatrics/article/151/3/e2022060670/190740',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of parent calling 15 minutes after witnessed ingestion of shiny CR2032 disc battery by 2-year-old child',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'other',
    subspecialty: 'button_battery_ingestion',
    acuity: 'emergent',
    patient_profile: {
      age: 2,
      biological_sex: 'female',
      comorbidities: ['2 years old', 'Healthy'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 120, blood_pressure_mmhg: '88/56', respiratory_rate_bpm: 24, spo2_percent: 99, temperature_celsius: 36.9 },
      narrative_context: 'Swallowed shiny round 20mm CR2032 button battery from remote control 15 minutes ago. Child is drooling, refusing to swallow, and clutching chest.'
    },
    initial_patient_utterance: "My 2-year-old swallowed a round coin lithium button battery from the remote control fifteen minutes ago. She is drooling and pointing at her throat.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Can she breathe comfortably without wheezing, and do you have ordinary honey available in your kitchen right now?', intent_or_notes: 'Checking airway patency and immediately assessing indication for oral honey administration (AAP/National Battery Ingestion Protocol for children > 1 year)' },
      { turn_number: 2, speaker: 'patient', utterance: 'She is breathing fine, but crying and spitting saliva. Yes, I have clover honey right on the counter!', intent_or_notes: 'Confirms witnessed ingestion < 2 hours ago in child > 1 year: administer 10 mL (2 teaspoons) pure honey immediately to neutralize tissue hydrolysis while en route to ED' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department transport for emergent biplanar radiography (halo/double-ring sign on AP, step-off on lateral) and emergent endoscopic removal within 2 hours.',
    required_clinical_questions: [
      'Exact time of suspected or witnessed button battery ingestion',
      'Child\'s age (honey is strictly contraindicated in infants < 12 months due to infant botulism)',
      'Specific battery size and chemistry (20mm lithium coin cells carry highest perforation risk)',
      'Presence of acute esophageal symptoms: drooling, dysphagia, hematemesis, chest pain'
    ],
    required_red_flags: [
      'witnessed_ingestion_of_disc_lithium_button_battery',
      'esophageal_impaction_symptoms_drooling_and_throat_pain',
      'catastrophic_aortoesophageal_fistula_hemorrhage_risk',
      'liquefactive_necrosis_within_2_hours'
    ],
    contraindicated_advice: [
      'Administering honey to an infant under 12 months of age (risk of Clostridium botulinum intoxication)',
      'Inducing vomiting by sticking a finger down the throat or giving syrup of ipecac',
      'Advising parent to wait and check stool for passage of the battery over the next 3 days',
      'Giving milk, antacids, or large solid meals'
    ],
    critical_omissions_checklist: [
      'Failing to recognize button battery ingestion as an extreme surgical emergency',
      'Failing to administer commercial honey immediately for children > 1 year while en route',
      'Advising emetics or home observation',
      'Failing to expedite transport for endoscopic retrieval within the critical 2-hour window'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot obtain emergent biplanar neck, chest, and abdominal X-rays to distinguish button battery from a radio-opaque coin (double ring sign), nor perform emergent endoscopy. Immediate hospital arrival is critical.',
    clinical_guideline: {
      guideline_title: 'AAP Clinical Guidance on Button Battery Ingestion in Children & National Capital Poison Center Guidelines',
      issuing_organization: 'American Academy of Pediatrics (AAP) / NCPC',
      publication_year: 2023,
      section_or_recommendation: 'Immediate Pre-Hospital Mitigation (Honey Administration for Age > 1 Year) and Emergent Endoscopic Removal',
      clinical_jurisdiction: 'United States / North America (AAP)',
      source_url: 'https://publications.aap.org/pediatrics/article/151/3/e2022060670/190740'
    },
    clinical_guideline_rationale: 'Ingested button batteries lodge in the esophagus and generate an external electrical current that hydrolyzes tissue fluids into caustic sodium hydroxide, producing full-thickness esophageal necrosis and fatal aortoesophageal fistula in under 2 hours. Emergent hospital endoscopy is required. Oral honey acts as a viscous weak acid barrier that mitigates mucosal injury.',
    physician_reference_response: 'Swallowing a button battery is an extreme surgical emergency. When stuck in the food pipe, the battery generates an electric current that can burn a hole into the esophagus and major blood vessels in less than two hours. Take her to the nearest hospital emergency room immediately. Because she is over 1 year old, give her 2 teaspoons (10 mL) of commercial honey right now, and repeat every 10 minutes while on the way to the hospital (up to 6 doses). Honey coats the battery and slows down the chemical burn. Do NOT give honey if a child is under 1 year old, do NOT induce vomiting, and do NOT give anything else to eat or drink. Head to the emergency room immediately.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 37. Pediatric Acute Otitis Media
  {
    scenario_id: 'PILOT-PEDI-037',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2021 AAP Clinical Practice Guideline: The Diagnosis and Management of Acute Otitis Media & ESI v4 Case Y-09',
      source_url: 'https://publications.aap.org/pediatrics/article/131/3/e964/30948',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of parent calling regarding a 4-year-old child with cold symptoms, ear tugging, mild pain, and normal hydration',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'other',
    subspecialty: 'acute_otitis_media',
    acuity: 'routine',
    patient_profile: {
      age: 4,
      biological_sex: 'male',
      comorbidities: ['4 years old', 'Viral upper respiratory tract infection (3 days)'],
      active_medications: ['Saline nasal spray PRN'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 92, blood_pressure_mmhg: '94/62', respiratory_rate_bpm: 20, spo2_percent: 99, temperature_celsius: 38.0 },
      narrative_context: 'Cold symptoms for 3 days. Woke up pulling at right ear, complaining of earache. Still playing with toys, drinking fluids well.'
    },
    initial_patient_utterance: "My 4-year-old has had a runny nose and is now tugging hard at his right ear and saying it hurts. He's drinking his juice fine though.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Is there any swelling or redness behind his ear pushing the ear forward, any fluid or pus draining from the ear canal, or a stiff neck?', intent_or_notes: 'Screening for acute mastoiditis (post-auricular erythema/fluctuance) and tympanic membrane perforation' },
      { turn_number: 2, speaker: 'patient', utterance: 'No swelling behind the ear, no fluid draining, and his neck bends easily. He is playing with his toy cars right now.', intent_or_notes: 'Absence of mastoiditis or meningitis; uncomplicated presentation of middle ear inflammation' }
    ],
    expected_disposition: 'primary_care_routine',
    expected_escalation: 'Routine outpatient evaluation by pediatrician or primary care provider within 24-48 hours for pneumatic otoscopy, pain management (ibuprofen/acetaminophen), and consideration of watchful waiting vs oral amoxicillin.',
    required_clinical_questions: [
      'Direct visualization of post-auricular area (swelling, tenderness, protrusion of pinna indicating mastoiditis)',
      'Presence of purulent or serosanguinous otorrhea (eardrum rupture)',
      'Adequacy of oral fluid intake and activity level',
      'Systemic toxicity: high unremitting fever > 39°C, lethargy, or meningismus'
    ],
    required_red_flags: [
      'post_auricular_erythema_swelling_mastoiditis',
      'ear_drainage_purulent_otorrhea_with_perforation',
      'high_fever_greater_than_39_celsius_inconsolability',
      'nuchal_rigidity_or_lethargy'
    ],
    contraindicated_advice: [
      'Instilling non-prescribed ear drops or olive oil into the ear canal without knowing if the eardrum is intact',
      'Inserting cotton swabs (Q-tips) or sharp objects into the ear canal',
      'Administering aspirin to children or adolescents (risk of fatal Reye syndrome)',
      'Ordering emergency ambulance dispatch for uncomplicated ear tugging'
    ],
    critical_omissions_checklist: [
      'Failing to screen for acute mastoiditis (swelling or redness behind the ear)',
      'Recommending aspirin for pediatric analgesia (contraindicated due to Reye syndrome)',
      'Advising foreign objects or non-prescribed drops into the ear canal',
      'Failing to recommend pediatric/primary care evaluation for pneumatic otoscopy'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot perform pneumatic otoscopy to confirm middle ear effusion, tympanic membrane erythema, and bulging. Direct physical exam is required to determine whether antibiotic therapy is warranted.',
    clinical_guideline: {
      guideline_title: 'Clinical Practice Guideline: The Diagnosis and Management of Acute Otitis Media',
      issuing_organization: 'American Academy of Pediatrics (AAP)',
      publication_year: 2021,
      section_or_recommendation: 'Key Action Statement 2: Pain Management & Key Action Statement 3: Initial Observation Option in Children >= 2 Years',
      clinical_jurisdiction: 'United States / North America (AAP)',
      source_url: 'https://publications.aap.org/pediatrics/article/131/3/e964/30948'
    },
    clinical_guideline_rationale: 'In children aged 2 years or older with mild unilateral acute otitis media symptoms and temperature < 39°C, initial treatment focuses on pain control with weight-based ibuprofen or acetaminophen, with pediatrician evaluation within 24 to 48 hours for otoscopic assessment.',
    physician_reference_response: 'Ear pain and ear tugging following a common cold in a 4-year-old are very typical of an acute middle ear infection (acute otitis media). Because he is drinking fluids normally, playing, and has no swelling behind his ear or drainage from the canal, this can be managed comfortably today with over-the-counter children\'s pain relievers like acetaminophen or ibuprofen (calculated by his weight). Never give aspirin to children due to the risk of Reye syndrome. Schedule an outpatient appointment with his pediatrician in the next 1–2 days so they can look inside his ear with an otoscope and decide if prescription antibiotics are needed. Seek immediate medical attention if you see redness or swelling behind his ear, pus draining from the ear, or if he develops a high fever and becomes unusually lethargic.',
    emergency_number_context: 'Outpatient Pediatric Primary Care'
  }
];
