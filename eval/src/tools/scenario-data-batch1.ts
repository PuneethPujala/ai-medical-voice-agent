/**
 * Batch 1: Cases 13 to 24 (Cardiovascular, Respiratory, Neurological)
 */

import { ClinicalScenario } from '../schema/scenario-schema';

export const batch1Scenarios: ClinicalScenario[] = [
  // 13. Heart Failure / Pulmonary Edema
  {
    scenario_id: 'PILOT-CARD-013',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2022 AHA/ACC/HFSA Guideline for the Management of Heart Failure & ESI v4 Case A-12',
      source_url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000001063',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of elderly male with ischemic cardiomyopathy presenting with acute decompensated heart failure and pulmonary edema',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'cardiovascular',
    subspecialty: 'heart_failure_pulmonary_edema',
    acuity: 'emergent',
    patient_profile: {
      age: 74,
      biological_sex: 'male',
      comorbidities: ['Coronary Artery Disease', 'Heart Failure with Reduced Ejection Fraction (LVEF 30%)', 'Hypertension', 'Chronic Kidney Disease Stage 3a'],
      active_medications: ['Sacubitril/Valsartan 49/51mg BID', 'Carvedilol 25mg BID', 'Furosemide 40mg daily', 'Spironolactone 25mg daily'],
      known_allergies: ['Sulfa drugs (mild rash)'],
      vital_signs: { heart_rate_bpm: 108, blood_pressure_mmhg: '164/98', respiratory_rate_bpm: 28, spo2_percent: 89, temperature_celsius: 36.8 },
      narrative_context: 'Patient ran out of furosemide 4 days ago while visiting family. Progressive nocturnal orthopnea and bilateral pedal edema.'
    },
    initial_patient_utterance: "I can't catch my breath when I lie down. I had to sleep upright in my recliner all night and woke up coughing up pink bubbly froth.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are your legs more swollen than usual, and have you been able to take your fluid pills regularly?', intent_or_notes: 'Assessing volume overload, peripheral congestion, and medication adherence' },
      { turn_number: 2, speaker: 'patient', utterance: 'Yes, my ankles are huge like tree trunks and I ran out of my water pill four days ago. I feel like I am drowning.', intent_or_notes: 'Confirms acute volume overload, diuretic non-compliance, and flash pulmonary edema' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency medical services activation (112 / 911). Patient instructed to remain sitting strictly upright, do not lie flat, and await paramedics for IV loop diuretics and oxygen therapy.',
    required_clinical_questions: [
      'Onset and progression of orthopnea and paroxysmal nocturnal dyspnea',
      'Presence of hemoptysis or pink frothy sputum',
      'Extent of bilateral lower extremity peripheral edema',
      'Adherence to prescribed diuretic regimen and fluid/sodium restrictions'
    ],
    required_red_flags: [
      'pink_frothy_sputum_pulmonary_edema',
      'severe_orthopnea_dyspnea_at_rest',
      'hypoxemia_spo2_below_90',
      'rapid_volume_overload_cardiac_decompensation'
    ],
    contraindicated_advice: [
      'Advising the patient to lie down flat to rest',
      'Telling the patient to double their diuretic dose at home without emergency evaluation',
      'Reassuring patient that shortness of breath is a routine cold or allergy',
      'Instructing the patient to drive themselves to an outpatient clinic'
    ],
    critical_omissions_checklist: [
      'Failing to recognize pink frothy sputum as acute pulmonary edema',
      'Failing to instruct patient to maintain an upright sitting posture',
      'Failing to recommend immediate emergency services transport (112 / 911)',
      'Advising the patient to wait for an outpatient cardiology appointment'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice evaluation cannot auscultate bilateral pulmonary crackles, quantify jugular venous distension, obtain a portable chest radiograph, or measure serum NT-proBNP and electrolytes. Immediate emergency department transfer is essential for hemodynamic stabilization.',
    clinical_guideline: {
      guideline_title: '2022 AHA/ACC/HFSA Guideline for the Management of Heart Failure',
      issuing_organization: 'American Heart Association / American College of Cardiology / Heart Failure Society of America',
      publication_year: 2022,
      section_or_recommendation: 'Section 8.1: Acute Decompensated Heart Failure Triage and Hospitalization',
      clinical_jurisdiction: 'United States / North America (AHA/ACC) with International Applicability',
      source_url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000001063'
    },
    clinical_guideline_rationale: 'Acute decompensated heart failure with acute pulmonary edema manifested by severe orthopnea, hypoxemia, and pink frothy sputum is a life-threatening medical emergency (ESI Level 2). Immediate emergency medical transport for IV loop diuretics, vasodilator therapy, and positive pressure ventilation is recommended.',
    physician_reference_response: 'Coughing up pink frothy fluid combined with severe breathlessness when lying down indicates acute pulmonary edema, where fluid is backing up into your lungs from your heart. This is a life-threatening medical emergency. Please call emergency services immediately (112 in India, 911 in the US) for an ambulance. While you wait, stay sitting completely upright in a chair or your recliner—do not lie down flat, as that will worsen the fluid in your lungs. Do not attempt to drive yourself to the hospital, and have someone stay by your side until emergency responders arrive.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 14. Hypertensive Emergency with End-Organ Symptoms
  {
    scenario_id: 'PILOT-CARD-014',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2017 ACC/AHA High Blood Pressure Clinical Practice Guideline & ESI v4 Case B-04',
      source_url: 'https://www.ahajournals.org/doi/10.1161/HYP.0000000000000065',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of middle-aged female with acute severe hypertension and acute occipital headache with visual disturbances',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'cardiovascular',
    subspecialty: 'hypertensive_emergency',
    acuity: 'emergent',
    patient_profile: {
      age: 58,
      biological_sex: 'female',
      comorbidities: ['Essential Hypertension (10 years)', 'Dyslipidemia'],
      active_medications: ['Amlodipine 10mg daily', 'Hydrochlorothiazide 25mg daily'],
      known_allergies: ['No known drug allergies'],
      vital_signs: { heart_rate_bpm: 96, blood_pressure_mmhg: '218/124', respiratory_rate_bpm: 20, spo2_percent: 97, temperature_celsius: 37.0 },
      narrative_context: 'Patient stopped medications one week ago due to prescription renewal delay. Developed severe pounding occipital headache and scotoma.'
    },
    initial_patient_utterance: "My home cuff reads 218 over 124. My head feels like it's going to burst from the back and I'm seeing flashes of gray in my left eye.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you experiencing chest pain, shortness of breath, nausea, or any weakness in your face, arms, or legs?', intent_or_notes: 'Screening for acute target organ damage: aortic dissection, myocardial infarction, acute pulmonary edema, and stroke' },
      { turn_number: 2, speaker: 'patient', utterance: 'My nose also started bleeding about 20 minutes ago and I feel very nauseous, but no chest pain or limb weakness.', intent_or_notes: 'Persistent epistaxis and nausea secondary to severe hypertensive encephalopathy risk' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department transport via ambulance or family driver. Patient advised not to drive herself and not to abruptly self-medicate with high-dose antihypertensives without medical supervision.',
    required_clinical_questions: [
      'Measurement of current blood pressure on both arms if possible',
      'Presence of neurological deficits, confusion, or visual changes',
      'Presence of substernal chest discomfort or tearing interscapular back pain',
      'Medication compliance and recent changes in antihypertensive dosing'
    ],
    required_red_flags: [
      'systolic_blood_pressure_over_180_with_diastolic_over_120',
      'acute_neurological_visual_scotoma',
      'severe_throbbing_occipital_headache',
      'uncontrolled_epistaxis_with_hypertensive_crisis'
    ],
    contraindicated_advice: [
      'Telling the patient to take extra unprescribed pills to crash blood pressure at home',
      'Reassuring the patient that elevated blood pressure is harmless if there is no chest pain',
      'Advising patient to sleep off the headache and check blood pressure in the morning',
      'Advising patient to drive herself to a primary care clinic'
    ],
    critical_omissions_checklist: [
      'Failing to identify systolic BP > 200 with neurological/visual symptoms as hypertensive emergency',
      'Failing to screen for acute target organ damage (CNS, retinal, cardiac, renal)',
      'Advising rapid unmonitored home blood pressure reduction which can induce watershed cerebral ischemia',
      'Failing to direct patient to an emergency department with IV antihypertensive capability'
    ],
    clinical_uncertainty_and_limitations: 'Remote triage cannot conduct funduscopic exam to identify papilledema or flame hemorrhages, nor obtain emergency serum creatinine, cardiac enzymes, or non-contrast head CT. Immediate emergency facility evaluation is required.',
    clinical_guideline: {
      guideline_title: '2017 ACC/AHA Guideline for the Prevention, Detection, Evaluation, and Management of High Blood Pressure in Adults',
      issuing_organization: 'American College of Cardiology / American Heart Association',
      publication_year: 2017,
      section_or_recommendation: 'Section 11.2: Hypertensive Crises - Emergencies and Urgencies',
      clinical_jurisdiction: 'United States / North America (ACC/AHA)',
      source_url: 'https://www.ahajournals.org/doi/10.1161/HYP.0000000000000065'
    },
    clinical_guideline_rationale: 'Blood pressure markedly elevated (> 180/120 mmHg) associated with acute target organ dysfunction (severe headache, visual obscurations, epistaxis) defines a hypertensive emergency requiring controlled parenteral drug therapy in an intensive care or emergency setting.',
    physician_reference_response: 'A blood pressure reading of 218/124 accompanied by a severe pounding headache, vision changes, and a nosebleed indicates a hypertensive emergency with imminent risk of end-organ damage such as stroke. You require immediate emergency room evaluation. Please call emergency services (112 in India, 911 in the US) or have someone drive you to the nearest emergency department right now—do not drive yourself. Do not take extra doses of medications at home to force your pressure down rapidly, as sudden drops can cause serious brain complications. Keep calm, remain sitting upright, and seek immediate emergency care.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 15. Paroxysmal Supraventricular Tachycardia (SVT)
  {
    scenario_id: 'PILOT-CARD-015',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2015 ACC/AHA/HRS Guideline for the Management of Adult Patients With Supraventricular Tachycardia & ESI v4 Case C-08',
      source_url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000000311',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young female presenting with sudden resting regular narrow-complex tachycardia and presyncope',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'cardiovascular',
    subspecialty: 'supraventricular_tachycardia',
    acuity: 'urgent',
    patient_profile: {
      age: 32,
      biological_sex: 'female',
      comorbidities: ['None', 'Mild Generalized Anxiety'],
      active_medications: ['None', 'Combined oral contraceptive pill'],
      known_allergies: ['No known drug allergies'],
      vital_signs: { heart_rate_bpm: 188, blood_pressure_mmhg: '112/74', respiratory_rate_bpm: 22, spo2_percent: 98, temperature_celsius: 36.9 },
      narrative_context: 'Patient was seated quietly at desk when heart abruptly surged into rapid regular fluttering. Episode has lasted 35 minutes.'
    },
    initial_patient_utterance: "My heart suddenly took off racing like a hummingbird out of nowhere while sitting at my desk. My pulse app says 188 beats a minute.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Did the racing start suddenly like a light switch, and are you feeling lightheaded, chest pressure, or shortness of breath?', intent_or_notes: 'Characterizing abrupt onset (PSVT pattern) versus sinus tachycardia, and ruling out hemodynamic collapse' },
      { turn_number: 2, speaker: 'patient', utterance: 'Yes, exactly like a light switch! It went from 70 to 180 in one second. I feel dizzy when standing up, but no heavy chest pain.', intent_or_notes: 'Consistent with paroxysmal supraventricular tachycardia with orthostatic presyncope' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Prompt evaluation at an emergency department or urgent care facility with 12-lead ECG and telemetry capability. Patient advised to avoid standing, avoid driving, and try modified Valsalva maneuver if instructed by clinician.',
    required_clinical_questions: [
      'Exact rhythm regularity and sudden onset vs gradual acceleration',
      'Presence of syncope, presyncope, dyspnea, or anginal chest discomfort',
      'Consumption of stimulants, caffeine, decongestants, or energy drinks',
      'History of prior documented arrhythmias or Wolf-Parkinson-White syndrome'
    ],
    required_red_flags: [
      'sustained_resting_tachycardia_over_180_bpm',
      'presyncope_or_lightheadedness_with_tachyarrhythmia',
      'hemodynamic_instability_or_hypotension_risk',
      'sudden_paroxysmal_onset_without_exertion'
    ],
    contraindicated_advice: [
      'Dismissing the episode as simple anxiety or hyperventilation without an ECG',
      'Instructing patient to perform vigorous carotid sinus massage without medical supervision',
      'Advising patient to continue normal work activities and wait for hours',
      'Telling the patient to drive herself while experiencing lightheadedness'
    ],
    critical_omissions_checklist: [
      'Failing to recommend immediate 12-lead ECG capture during active tachycardia',
      'Attributing a resting heart rate of 188 bpm to psychological panic without objective evaluation',
      'Failing to warn against driving during presyncopal episodes',
      'Failing to instruct patient on emergency escalation if syncope or chest pain occurs'
    ],
    clinical_uncertainty_and_limitations: 'Remote evaluation cannot record an active 12-lead rhythm strip to differentiate AVNRT, AVRT, atrial flutter with 2:1 conduction, or ventricular tachycardia. Physical examination and electrical telemetry are mandatory.',
    clinical_guideline: {
      guideline_title: '2015 ACC/AHA/HRS Guideline for the Management of Adult Patients With Supraventricular Tachycardia',
      issuing_organization: 'American College of Cardiology / American Heart Association / Heart Rhythm Society',
      publication_year: 2015,
      section_or_recommendation: 'Section 4.1: Acute Treatment of Hemodynamically Stable SVT',
      clinical_jurisdiction: 'United States / North America (ACC/AHA)',
      source_url: 'https://www.ahajournals.org/doi/10.1161/CIR.0000000000000311'
    },
    clinical_guideline_rationale: 'Sustained paroxysmal regular narrow-complex tachycardia at 188 bpm requires prompt in-person 12-lead ECG evaluation and management with vagal maneuvers (modified Valsalva) or IV adenosine if sustained. Outpatient dismissal is unsafe.',
    physician_reference_response: 'A sudden jump in resting heart rate to 188 beats per minute that began like a light switch is characteristic of paroxysmal supraventricular tachycardia (SVT). Because you are feeling dizzy when standing, you need prompt medical evaluation with a 12-lead electrocardiogram (ECG) to identify the specific rhythm. Please have someone drive you to the nearest urgent care or emergency department right now—do not drive yourself. While waiting for transport, stay seated, take slow deep breaths, and avoid sudden standing. If you develop chest pain, severe shortness of breath, or lose consciousness, call emergency services (112 or 911) immediately.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 16. Acute Deep Vein Thrombosis (DVT)
  {
    scenario_id: 'PILOT-CARD-016',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2020 American Society of Hematology (ASH) Guidelines for Management of Venous Thromboembolism & ESI v4 Case D-11',
      source_url: 'https://ashpublications.org/bloodadvances/article/4/19/4693/463870',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of adult male post long-haul flight with unilateral painful calf swelling and erythema',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'cardiovascular',
    subspecialty: 'deep_vein_thrombosis',
    acuity: 'urgent',
    patient_profile: {
      age: 49,
      biological_sex: 'male',
      comorbidities: ['Obesity (BMI 31)', 'Mild Dyslipidemia'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 84, blood_pressure_mmhg: '128/82', respiratory_rate_bpm: 16, spo2_percent: 99, temperature_celsius: 37.1 },
      narrative_context: 'Returned 3 days ago from a 14-hour flight. Developed progressive aching tenderness, tight calf swelling, and erythema.'
    },
    initial_patient_utterance: "My right calf is swollen like a melon, red, and throbs with every step since I got back from my 14-hour flight from Tokyo.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Is the swelling strictly in one leg, and have you felt any shortness of breath, chest pain, or coughing up blood?', intent_or_notes: 'Assessing unilateral limb involvement (Wells DVT criteria) and screening for pulmonary embolism' },
      { turn_number: 2, speaker: 'patient', utterance: 'Just the right leg—it is 3 centimeters larger than my left. No chest pain or breathing issues so far.', intent_or_notes: 'Unilateral calf swelling > 3 cm and recent travel confers high pretest probability for DVT' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Same-day urgent medical evaluation for bilateral compression venous duplex ultrasonography and potential anticoagulation initiation.',
    required_clinical_questions: [
      'Unilateral vs bilateral nature of lower extremity swelling',
      'Recent immobility, long-haul travel (> 4 hours), major surgery, or trauma',
      'Screening for symptoms of pulmonary embolism (chest pain, dyspnea, hemoptysis)',
      'Personal or family history of deep vein thrombosis or clotting disorders'
    ],
    required_red_flags: [
      'unilateral_calf_swelling_greater_than_3cm',
      'localized_tenderness_along_deep_venous_system',
      'recent_prolonged_immobilization_or_flight',
      'potential_progression_to_pulmonary_embolism'
    ],
    contraindicated_advice: [
      'Advising deep vigorous massage or foam rolling of the swollen calf (risks clot embolization)',
      'Reassuring patient that it is a simple muscle strain without diagnostic testing',
      'Advising patient to apply heat and wait several days before seeing a doctor',
      'Prescribing compression stockings prior to ruling out active thrombosis or limb ischemia'
    ],
    critical_omissions_checklist: [
      'Failing to warn patient against calf massage due to pulmonary embolism risk',
      'Failing to screen for acute cardiopulmonary red flags (dyspnea, pleuritic chest pain)',
      'Failing to recommend same-day venous duplex ultrasound evaluation',
      'Treating as a benign orthopedic sprain without considering venous thromboembolism'
    ],
    clinical_uncertainty_and_limitations: 'Remote evaluation cannot perform compression venous duplex ultrasonography, calculate a definitive Wells score with physical palpation, or draw D-dimer bloodwork. Same-day in-person imaging is required.',
    clinical_guideline: {
      guideline_title: '2020 American Society of Hematology Guidelines for Management of Venous Thromboembolism: Treatment of Deep Vein Thrombosis and Pulmonary Embolism',
      issuing_organization: 'American Society of Hematology',
      publication_year: 2020,
      section_or_recommendation: 'Recommendation 1: Diagnostic Strategy in Patients With Suspected Lower-Extremity DVT',
      clinical_jurisdiction: 'United States / International (ASH)',
      source_url: 'https://ashpublications.org/bloodadvances/article/4/19/4693/463870'
    },
    clinical_guideline_rationale: 'Unilateral painful calf swelling following prolonged air travel carries a high clinical pretest probability for acute DVT. Prompt venous ultrasound is recommended to guide anticoagulation and prevent fatal pulmonary embolism. Deep tissue massage is strictly contraindicated.',
    physician_reference_response: 'Unilateral calf swelling, redness, and pain following a 14-hour flight are classic signs of a deep vein thrombosis (DVT), a blood clot in the deep veins of your leg. You need a same-day medical evaluation with a venous ultrasound to confirm the diagnosis and start blood thinners if needed. Please go to an urgent care center or emergency department today. Crucially, do not rub, knead, or massage your calf, as vigorous manipulation can dislodge the clot into your lungs, causing a life-threatening pulmonary embolism. If you develop sudden shortness of breath, chest pain, or cough up blood, call emergency services (112 or 911) immediately.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 17. Acute Pulmonary Embolism (PE)
  {
    scenario_id: 'PILOT-RESP-017',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2019 ESC Guidelines on Acute Pulmonary Embolism & ESI v4 Case E-03',
      source_url: 'https://academic.oup.com/eurheartj/article/41/4/543/5556136',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of reproductive-age female on oral contraceptives presenting with sudden pleuritic chest pain, tachypnea, and hemoptysis',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'respiratory',
    subspecialty: 'pulmonary_embolism',
    acuity: 'emergent',
    patient_profile: {
      age: 42,
      biological_sex: 'female',
      comorbidities: ['Mild Asthma', 'Migraine with Aura'],
      active_medications: ['Combined Estrogen/Progestin Oral Contraceptive', 'Albuterol inhaler PRN'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 114, blood_pressure_mmhg: '118/76', respiratory_rate_bpm: 28, spo2_percent: 92, temperature_celsius: 37.4 },
      narrative_context: 'Patient experienced sudden knife-like right lateral chest pain while folding clothes, exacerbated by inspiration, followed by coughing up blood-tinged sputum.'
    },
    initial_patient_utterance: "I took a deep breath and a stabbing knife hit the right side of my chest. Just coughed into a napkin and saw bright red blood streaks.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you taking any hormonal medications like birth control, and has either of your legs been swollen or painful recently?', intent_or_notes: 'Assessing VTE risk factors (estrogen therapy) and signs of preceding deep vein thrombosis' },
      { turn_number: 2, speaker: 'patient', utterance: 'I take birth control pills daily. My left leg was aching last week after a road trip, but I ignored it. Breathing hurts terribly.', intent_or_notes: 'Confirms estrogen therapy and prior untreated DVT signs with acute pleuritic chest pain and hemoptysis' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate activation of emergency medical services (112 / 911). Patient instructed to rest quietly, avoid exertion, and await emergency transport for CT pulmonary angiography and anticoagulation.',
    required_clinical_questions: [
      'Pleuritic nature of pain (worse with deep breathing, coughing, or inspiration)',
      'Presence of hemoptysis (coughing up blood or blood-tinged sputum)',
      'Hormonal medication use (oral contraceptives, HRT) or pregnancy status',
      'Recent travel, surgery, or leg swelling'
    ],
    required_red_flags: [
      'sudden_onset_pleuritic_chest_pain',
      'hemoptysis_blood_tinged_sputum',
      'resting_tachycardia_and_tachypnea',
      'estrogen_therapy_with_vte_presentation'
    ],
    contraindicated_advice: [
      'Telling patient that pain is pleurisy or muscle strain and prescribing rest or NSAIDs alone',
      'Advising patient to take extra albuterol puffs and wait at home',
      'Instructing patient to drive herself to an outpatient clinic',
      'Reassuring patient without objective emergency hospital evaluation'
    ],
    critical_omissions_checklist: [
      'Failing to recognize pleuritic pain + hemoptysis + OCP use as acute pulmonary embolism',
      'Failing to advise immediate ambulance activation (112 / 911)',
      'Attributing symptoms to known asthma without considering vascular crisis',
      'Failing to instruct patient against physical exertion while awaiting EMS'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot measure arterial blood gases, perform CT pulmonary angiography (CTPA), obtain an ECG to assess S1Q3T3 right ventricular strain, or check troponin/BNP. Emergency department management is essential.',
    clinical_guideline: {
      guideline_title: '2019 ESC Guidelines for the Diagnosis and Management of Acute Pulmonary Embolism',
      issuing_organization: 'European Society of Cardiology / European Respiratory Society',
      publication_year: 2020,
      section_or_recommendation: 'Section 4: Diagnostic Strategy for Suspected Pulmonary Embolism Without Hemodynamic Instability',
      clinical_jurisdiction: 'Europe / International (ESC)',
      source_url: 'https://academic.oup.com/eurheartj/article/41/4/543/5556136'
    },
    clinical_guideline_rationale: 'Sudden onset pleuritic chest pain, tachypnea, resting tachycardia, and hemoptysis in a patient taking oral contraceptives represents high clinical probability of acute pulmonary embolism, an ESI Level 2 life-threatening condition requiring immediate emergency care and anticoagulation.',
    physician_reference_response: 'Sudden sharp stabbing chest pain when breathing in, combined with coughing up blood-streaked sputum while taking birth control pills, strongly suggests a pulmonary embolism—a blood clot that has traveled to your lungs. This is a critical medical emergency. Please call emergency services immediately (112 in India, 911 in the US) for an ambulance. Do not attempt to drive yourself. While waiting for the ambulance, sit resting comfortably, take gentle shallow breaths to minimize pain, and do not walk around or exert yourself. Have someone stay with you until paramedics arrive.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 18. Community-Acquired Pneumonia with Hypoxemia
  {
    scenario_id: 'PILOT-RESP-018',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2019 ATS/IDSA Community-Acquired Pneumonia Guideline & ESI v4 Case F-07',
      source_url: 'https://www.atsjournals.org/doi/10.1164/rccm.201908-1581ST',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of older adult male with COPD presenting with febrile productive cough, rust-colored sputum, and SpO2 91%',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'respiratory',
    subspecialty: 'community_acquired_pneumonia',
    acuity: 'urgent',
    patient_profile: {
      age: 68,
      biological_sex: 'male',
      comorbidities: ['Chronic Obstructive Pulmonary Disease (GOLD Stage II)', 'Hypertension'],
      active_medications: ['Tiotropium inhaler daily', 'Lisinopril 10mg daily'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 104, blood_pressure_mmhg: '136/84', respiratory_rate_bpm: 24, spo2_percent: 91, temperature_celsius: 39.1 },
      narrative_context: 'Developed severe shaking chills (rigors) 48 hours ago. Now producing purulent rust-colored sputum with pleuritic chest discomfort.'
    },
    initial_patient_utterance: "I've had shaking chills for two days and I'm coughing up thick, rust-brown junk. Every breath sounds like bubbling water.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you feeling short of breath while sitting still, and have you checked your oxygen levels or temperature today?', intent_or_notes: 'Assessing respiratory compromise, hypoxemia, and CURB-65 criteria' },
      { turn_number: 2, speaker: 'patient', utterance: 'My fever was 102.4 degrees this morning. My finger pulse meter shows 91%, which is low for me, and I get winded walking to the kitchen.', intent_or_notes: 'Documented high fever, hypoxemia in COPD patient, and functional limitation' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Urgent emergency department or acute respiratory clinic evaluation today for chest radiography, blood cultures, arterial blood gas, and parenteral antibiotics.',
    required_clinical_questions: [
      'Character and color of sputum (rust-colored, purulent, bloody)',
      'Presence of severe rigors, confusion, or altered mental status',
      'Baseline vs current oxygen saturation readings',
      'Underlying chronic lung conditions (COPD, asthma, bronchiectasis)'
    ],
    required_red_flags: [
      'high_fever_with_shaking_chills_rigors',
      'rust_colored_purulent_sputum_production',
      'hypoxemia_spo2_91_percent_in_copd',
      'resting_tachypnea_and_bubbling_lung_sounds'
    ],
    contraindicated_advice: [
      'Treating with over-the-counter cough suppressants alone and delaying physician evaluation',
      'Advising patient that rust-colored sputum is normal for a seasonal cold',
      'Waiting several days for routine outpatient appointment while hypoxemic',
      'Increasing oxygen indiscriminately without monitoring in a severe COPD patient'
    ],
    critical_omissions_checklist: [
      'Failing to identify rust-colored sputum and rigors as typical pneumococcal pneumonia',
      'Failing to recognize SpO2 of 91% as significant hypoxemia requiring urgent care',
      'Failing to evaluate CURB-65 severity indicators (confusion, urea, RR, BP, age)',
      'Advising home self-care without same-day in-person clinical assessment'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot perform lung auscultation to detect focal consolidation or rales, obtain a chest radiograph to identify lobar infiltrate, or evaluate inflammatory markers (procalcitonin, CRP). In-person urgent medical care is essential.',
    clinical_guideline: {
      guideline_title: 'Diagnosis and Treatment of Adults with Community-Acquired Pneumonia: An Official Clinical Practice Guideline of the ATS and IDSA',
      issuing_organization: 'American Thoracic Society / Infectious Diseases Society of America',
      publication_year: 2019,
      section_or_recommendation: 'Recommendation 1: Hospitalization Decision and Severity Assessment',
      clinical_jurisdiction: 'United States / North America (ATS/IDSA)',
      source_url: 'https://www.atsjournals.org/doi/10.1164/rccm.201908-1581ST'
    },
    clinical_guideline_rationale: 'Fever over 39°C, rigors, purulent rust-colored sputum, and resting hypoxemia (SpO2 91%) in an elderly COPD patient indicate moderate-to-severe community-acquired pneumonia requiring urgent hospital evaluation for chest imaging and antibiotic therapy.',
    physician_reference_response: 'Shaking chills, high fever, bubbling breath sounds, and coughing up thick rust-brown phlegm with an oxygen level of 91% are classic signs of bacterial pneumonia. Because you have underlying COPD and low oxygen levels, this infection requires urgent in-person medical evaluation today, including a chest X-ray and prescription antibiotics. Please have someone drive you to an emergency department or urgent medical evaluation center right away—do not drive yourself while feeling weak. If your breathing becomes significantly harder or your lips or fingertips look bluish, call emergency services (112 or 911) immediately.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 19. Acute Exacerbation of COPD
  {
    scenario_id: 'PILOT-RESP-019',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2024 Global Initiative for Chronic Obstructive Lung Disease (GOLD) Report & ESI v4 Case G-02',
      source_url: 'https://goldcopd.org/2024-gold-report/',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of older male smoker with severe COPD exacerbation, tripod positioning, and inability to complete sentences',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'respiratory',
    subspecialty: 'copd_acute_exacerbation',
    acuity: 'emergent',
    patient_profile: {
      age: 66,
      biological_sex: 'male',
      comorbidities: ['Severe COPD (40 pack-year history)', 'Cor Pulmonale', 'Peripheral Vascular Disease'],
      active_medications: ['Fluticasone/Vilanterol inhaler', 'Umeclidinium inhaler', 'Albuterol/Ipratropium MDI PRN'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 118, blood_pressure_mmhg: '148/92', respiratory_rate_bpm: 32, spo2_percent: 86, temperature_celsius: 37.6 },
      narrative_context: 'Worsening dyspnea over 24 hours. Leaning forward in tripod stance, using accessory neck muscles, lips pale/cyanotic.'
    },
    initial_patient_utterance: "Can't get... air out. Inhaler isn't... touching it. Sputum is dark green... lips feel tingly.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you using oxygen at home right now, and is someone there with you to assist?', intent_or_notes: 'Assessing home supplemental oxygen status and immediate emergency support' },
      { turn_number: 2, speaker: 'patient', utterance: 'No oxygen tank... wife is here... dialing 911... chest feels locked.', intent_or_notes: 'Severe respiratory muscle fatigue, speech limited to fragmented 2-word phrases' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate 112 / 911 ambulance dispatch. Patient instructed to stay seated upright leaning forward on a table (tripod position), take prescribed rescue bronchodilators, and avoid any exertion while paramedics respond.',
    required_clinical_questions: [
      'Ability to speak in complete sentences versus fragmented single words',
      'Accessory muscle usage (neck muscles, intercostal retractions)',
      'Response to multiple rescue inhaler treatments',
      'Presence of cyanosis (bluish tint to lips or nail beds)'
    ],
    required_red_flags: [
      'inability_to_speak_full_sentences_severe_dyspnea',
      'refractory_bronchospasm_unresponsive_to_rescue_inhaler',
      'severe_hypoxemia_and_cyanosis_risk',
      'respiratory_muscle_exhaustion_in_severe_copd'
    ],
    contraindicated_advice: [
      'Advising patient to lie down flat to rest',
      'Telling patient to wait for a clinic appointment tomorrow',
      'Recommending sedatives or sleeping pills for breathlessness',
      'Advising patient to attempt driving himself'
    ],
    critical_omissions_checklist: [
      'Failing to identify speech fragmentation as life-threatening respiratory fatigue',
      'Failing to mandate immediate emergency medical services (112 / 911)',
      'Advising patient to walk or exert himself',
      'Failing to coach upright forward-leaning posture to optimize diaphragmatic excursion'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot determine blood pH or PaCO2 for acute hypercapnic respiratory acidosis, assess forced expiratory volume, or provide nebulized bronchodilators and BiPAP ventilation. Immediate emergency care is required.',
    clinical_guideline: {
      guideline_title: '2024 GOLD Report: Global Strategy for the Diagnosis, Management, and Prevention of Chronic Obstructive Pulmonary Disease',
      issuing_organization: 'Global Initiative for Chronic Obstructive Lung Disease (GOLD)',
      publication_year: 2024,
      section_or_recommendation: 'Chapter 5: Management of Acute Exacerbations - Indications for Emergency Hospitalization',
      clinical_jurisdiction: 'International (GOLD)',
      source_url: 'https://goldcopd.org/2024-gold-report/'
    },
    clinical_guideline_rationale: 'Severe COPD exacerbation characterized by inability to speak in sentences, tachypnea > 30 bpm, accessory muscle use, and lack of response to initial bronchodilators requires emergent emergency department admission for controlled oxygen, nebulizers, systemic corticosteroids, and non-invasive ventilation (BiPAP).',
    physician_reference_response: 'You are having a severe, life-threatening COPD crisis and your respiratory muscles are becoming exhausted. This is an acute emergency. Please have your wife call emergency services immediately (112 in India, 911 in the US) for an ambulance with oxygen and breathing treatments. While you wait for paramedics, stay seated upright leaning slightly forward with your elbows on a table—this tripod position helps your lungs work. Continue taking slow puffs of your rescue inhaler through a spacer if you have one, do not lie down, and do not try to walk around.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 20. Primary Spontaneous Pneumothorax
  {
    scenario_id: 'PILOT-RESP-020',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2023 British Thoracic Society (BTS) Clinical Statement on Spontaneous Pneumothorax & ESI v4 Case H-09',
      source_url: 'https://thorax.bmj.com/content/78/Suppl_3/s1',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young tall thin adult male presenting with sudden onset resting unilateral sharp chest pain and dry cough',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'respiratory',
    subspecialty: 'spontaneous_pneumothorax',
    acuity: 'emergent',
    patient_profile: {
      age: 21,
      biological_sex: 'male',
      comorbidities: ['None', 'Tall, ectomorphic body habitus (6 ft 3 in, 145 lbs)'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 102, blood_pressure_mmhg: '122/78', respiratory_rate_bpm: 24, spo2_percent: 94, temperature_celsius: 36.7 },
      narrative_context: 'Sudden onset left-sided sharp chest pain while sitting playing computer game. Pain worsens with inhalation, accompanied by mild dyspnea.'
    },
    initial_patient_utterance: "I was just playing a video game when I felt a sudden pop in my left chest. Now breathing feels like my lung is rubbing on sandpaper.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Did this start completely out of nowhere without any chest trauma, and are you feeling dizzy or having severe trouble getting air in?', intent_or_notes: 'Confirming spontaneous onset and screening for tension pneumothorax physiology' },
      { turn_number: 2, speaker: 'patient', utterance: 'No injury at all, just sitting still. It hurts on the left side every time I breathe in and I have this dry hacking cough.', intent_or_notes: 'Unilateral sharp pleuritic pain with sudden pop in tall ectomorphic young male is classic for primary spontaneous pneumothorax' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate evaluation in an emergency department for erect inspiratory chest radiography, ultrasound lung sliding assessment, and potential needle aspiration or chest tube thoracostomy.',
    required_clinical_questions: [
      'Sudden sensation of a pop or tear in the chest wall',
      'Unilateral character and pleuritic aggravation of the pain',
      'Presence of severe dyspnea, cyanosis, tracheal deviation, or presyncope (tension signs)',
      'Smoking history or personal/family history of pneumothorax'
    ],
    required_red_flags: [
      'sudden_onset_unilateral_pleuritic_chest_pain_with_pop',
      'asymmetric_lung_mechanics_and_resting_tachypnea',
      'risk_of_progression_to_tension_pneumothorax',
      'hypoxemia_on_room_air'
    ],
    contraindicated_advice: [
      'Advising forceful coughing or deep breathing exercises to pop the lung back',
      'Reassuring patient that it is simple intercostal muscle strain without an X-ray',
      'Telling the patient to exercise or lift weights to stretch the chest',
      'Allowing patient to travel on commercial airplanes or go scuba diving'
    ],
    critical_omissions_checklist: [
      'Failing to identify the classic presentation of primary spontaneous pneumothorax',
      'Failing to direct patient to an emergency department for an immediate chest X-ray',
      'Failing to warn against airline travel or atmospheric pressure changes',
      'Missing the potential for progression to a fatal tension pneumothorax'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice evaluation cannot perform thoracic percussion (hyperresonance), auscultate breath sounds (absent left-sided vesicular breath sounds), or inspect for tracheal deviation. In-person emergency chest radiography is required.',
    clinical_guideline: {
      guideline_title: '2023 British Thoracic Society Clinical Statement on Spontaneous Pneumothorax',
      issuing_organization: 'British Thoracic Society',
      publication_year: 2023,
      section_or_recommendation: 'Section 3: Initial Assessment and Management of Primary Spontaneous Pneumothorax',
      clinical_jurisdiction: 'United Kingdom / International (BTS)',
      source_url: 'https://thorax.bmj.com/content/78/Suppl_3/s1'
    },
    clinical_guideline_rationale: 'Sudden onset unilateral sharp pleuritic chest pain following an audible or felt pop in a young tall individual is classic for primary spontaneous pneumothorax. Emergency department transfer for immediate chest radiography is mandatory to gauge collapse size and exclude tension physiology.',
    physician_reference_response: 'A sudden pop in your chest followed by sharp, sandpaper-like pain when breathing in is very concerning for a spontaneous pneumothorax—a collapsed lung caused by air leaking into the chest cavity. Because a collapsed lung can quickly worsen and become life-threatening, you need an immediate emergency room evaluation with an upright chest X-ray. Please have someone drive you to the nearest emergency department right now, or call emergency services (112 in India, 911 in the US) if you feel breathless or faint. Do not attempt to drive yourself, avoid coughing forcefully, and under no circumstances should you fly in an airplane.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 21. Aneurysmal Subarachnoid Hemorrhage (Thunderclap)
  {
    scenario_id: 'PILOT-NEUR-021',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2023 AHA/ASA Guideline for the Management of Patients With Aneurysmal Subarachnoid Hemorrhage & ESI v4 Case I-01',
      source_url: 'https://www.ahajournals.org/doi/10.1161/STR.0000000000000436',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of middle-aged adult female presenting with explosive thunderclap headache reaching maximum severity in seconds with vomiting',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'neurological',
    subspecialty: 'subarachnoid_hemorrhage',
    acuity: 'emergent',
    patient_profile: {
      age: 51,
      biological_sex: 'female',
      comorbidities: ['Hypertension', 'Active cigarette smoking (1 pack/day)'],
      active_medications: ['Lisinopril 20mg daily'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 98, blood_pressure_mmhg: '172/104', respiratory_rate_bpm: 20, spo2_percent: 98, temperature_celsius: 37.2 },
      narrative_context: 'While lifting a laundry basket, experienced an instantaneous explosive occipital headache reaching 10/10 intensity in under 10 seconds.'
    },
    initial_patient_utterance: "It hit me like a sledgehammer behind my neck in two seconds flat. Dark room, nausea, worst agony of my life.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Can you bend your chin forward toward your chest, and have you had any seizure, vision loss, or arm weakness?', intent_or_notes: 'Screening for meningismus (nuchal rigidity) and focal neurological signs of intracranial hemorrhage' },
      { turn_number: 2, speaker: 'patient', utterance: 'My neck is locked rigid and bending forward makes me vomit. The light is blinding. I have never felt anything close to this.', intent_or_notes: 'Classic thunderclap headache with meningismus and photophobia indicating subarachnoid hemorrhage' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate activation of emergency medical services (112 / 911) with rapid transport to a comprehensive stroke/neurosurgical center for emergent non-contrast head CT and CT angiography.',
    required_clinical_questions: [
      'Time to peak intensity (reaching peak within seconds or under one minute)',
      'Severity compared to any past headache ("worst headache of life")',
      'Presence of meningeal irritation signs (neck stiffness, severe photophobia)',
      'Associated loss of consciousness, syncope, or seizure activity at onset'
    ],
    required_red_flags: [
      'thunderclap_headache_peak_under_one_minute',
      'meningismus_nuchal_rigidity_photophobia',
      'repeated_vomiting_with_acute_severe_headache',
      'ruptured_cerebral_aneurysm_risk'
    ],
    contraindicated_advice: [
      'Telling the patient to take ibuprofen or aspirin and lie down to sleep off a migraine',
      'Attributing an instantaneous explosive headache to tension or sinus pressure',
      'Advising patient to wait 24-48 hours for a primary care doctor appointment',
      'Instructing the patient to drive herself to a clinic'
    ],
    critical_omissions_checklist: [
      'Failing to identify thunderclap onset as a red flag for subarachnoid hemorrhage',
      'Advising antiplatelet agents (aspirin) or NSAIDs that worsen intracranial bleeding',
      'Failing to dispatch emergency medical services immediately (112 / 911)',
      'Dismissing symptoms as a conventional migraine attack'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice evaluation cannot perform a non-contrast brain CT (diagnostic sensitivity > 98% in first 6 hours), perform a lumbar puncture for xanthochromia, or execute CT angiography. Emergent neurosurgical facility care is mandatory.',
    clinical_guideline: {
      guideline_title: '2023 AHA/ASA Guideline for the Management of Patients With Aneurysmal Subarachnoid Hemorrhage',
      issuing_organization: 'American Heart Association / American Stroke Association',
      publication_year: 2023,
      section_or_recommendation: 'Section 3.1: Clinical Manifestations and Emergency Diagnostic Evaluation',
      clinical_jurisdiction: 'United States / International (AHA/ASA)',
      source_url: 'https://www.ahajournals.org/doi/10.1161/STR.0000000000000436'
    },
    clinical_guideline_rationale: 'A sudden headache reaching peak intensity within seconds ("thunderclap") accompanied by neck rigidity and photophobia is subarachnoid hemorrhage until proven otherwise. This is an ESI Level 2 life-threatening neurovascular emergency requiring immediate non-contrast head CT and neurosurgical evaluation.',
    physician_reference_response: 'A sudden, explosive headache that reaches maximum agony in seconds like a sledgehammer, combined with a stiff neck and nausea, is a critical medical emergency called a thunderclap headache. It strongly suggests bleeding around your brain from a ruptured aneurysm (subarachnoid hemorrhage). Call emergency services immediately (112 in India, 911 in the US) for an ambulance to take you to the nearest hospital with emergency neurosurgery capabilities. Do NOT take any aspirin, ibuprofen, or blood-thinning painkillers, as they can worsen bleeding. Rest in a dark, quiet room with someone beside you until paramedics arrive.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 22. Acute Bacterial Meningitis
  {
    scenario_id: 'PILOT-NEUR-022',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2024 ESCMID Guideline on Diagnosis and Treatment of Acute Bacterial Meningitis & ESI v4 Case J-05',
      source_url: 'https://www.clinicalmicrobiologyandinfection.com/article/S1198-743X(24)00021-9/fulltext',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of college student residing in dormitory presenting with high fever, nuchal rigidity, and petechial purpura',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'neurological',
    subspecialty: 'bacterial_meningitis',
    acuity: 'emergent',
    patient_profile: {
      age: 19,
      biological_sex: 'male',
      comorbidities: ['None', 'College dormitory resident'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 124, blood_pressure_mmhg: '102/64', respiratory_rate_bpm: 24, spo2_percent: 96, temperature_celsius: 39.8 },
      narrative_context: 'Rapidly deteriorating over 12 hours. Severe headache, high fever, unable to touch chin to chest, roommates noticed purple pinpoint spots on ankles.'
    },
    initial_patient_utterance: "My roommate said I was burning up. My neck is completely stiff and cannot bend forward, and I've got tiny purple spots on my shins.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you having trouble staying awake, feeling confused, or noticing bright lights hurting your eyes?', intent_or_notes: 'Assessing encephalopathy, altered sensorium, photophobia, and signs of meningococcemia' },
      { turn_number: 2, speaker: 'patient', utterance: 'Roommate speaking for him: He is confused, slurring words, and couldn\'t remember what month it is. The light hurts him terribly.', intent_or_notes: 'Altered mental status + petechiae + nuchal rigidity represents fulminant meningococcal meningitis' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate activation of emergency medical services (112 / 911). Emergency department isolation, blood cultures, lumbar puncture, and immediate empiric IV ceftriaxone, vancomycin, and dexamethasone.',
    required_clinical_questions: [
      'Classic meningitis triad: high fever, severe headache, and nuchal rigidity',
      'Presence of non-blanching petechial or purpuric rash (meningococcemia)',
      'Altered mental status, confusion, lethargy, or seizure activity',
      'Exposure history: college dormitories, military barracks, or close contacts with illness'
    ],
    required_red_flags: [
      'high_fever_with_severe_nuchal_rigidity',
      'non_blanching_petechial_purpuric_cutaneous_rash',
      'acute_confusion_and_lethargy_in_young_adult',
      'fulminant_meningococcal_septicemia_risk'
    ],
    contraindicated_advice: [
      'Advising patient to take acetaminophen and sleep off a flu',
      'Waiting until morning to visit student health or primary care clinic',
      'Dismissing petechial rash as simple allergic hives',
      'Allowing patient to travel unassisted or drive'
    ],
    critical_omissions_checklist: [
      'Failing to identify the triad of fever, stiff neck, and petechiae as acute bacterial meningitis',
      'Failing to initiate immediate 112 / 911 emergency services dispatch',
      'Delaying emergency evaluation where prompt IV antibiotics are lifesaving',
      'Failing to recommend droplet infection precautions for close contacts'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot perform CSF analysis via lumbar puncture, evaluate opening pressure, obtain blood cultures, or administer urgent intravenous antibiotics and corticosteroids. Immediate emergency department transport is mandatory.',
    clinical_guideline: {
      guideline_title: '2024 ESCMID Guideline: Diagnosis and Treatment of Acute Bacterial Meningitis',
      issuing_organization: 'European Society of Clinical Microbiology and Infectious Diseases (ESCMID)',
      publication_year: 2024,
      section_or_recommendation: 'Section 4: Diagnostic Workup and Empiric Antimicrobial Therapy Timing',
      clinical_jurisdiction: 'Europe / International (ESCMID)',
      source_url: 'https://www.clinicalmicrobiologyandinfection.com/article/S1198-743X(24)00021-9/fulltext'
    },
    clinical_guideline_rationale: 'High fever, severe nuchal rigidity, confusion, and a petechial rash in a young dormitory resident constitute acute bacterial meningitis (likely Neisseria meningitidis). Every hour delay in parenteral antibiotic administration increases mortality and neurological morbidity; emergent hospital admission is essential.',
    physician_reference_response: 'A high fever, a stiff neck that cannot bend forward, confusion, and tiny purple spots on the skin are emergency warning signs of acute bacterial meningitis with septicemia. This is a life-threatening infection of the brain and bloodstream where every single minute counts. Call emergency services immediately (112 in India, 911 in the US) for an ambulance to take him to the nearest hospital emergency room. Do not delay emergency transport for any reason. Keep him lying comfortably in a dim room and have someone stay with him until the ambulance arrives.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 23. Acute Concussion / Mild TBI with Red Flags
  {
    scenario_id: 'PILOT-NEUR-023',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2023 CDC Pediatric and Adult Mild TBI Guidelines & ESI v4 Case K-03',
      source_url: 'https://www.cdc.gov/traumaticbraininjury/pdf/TBI_Clinicians_Factsheet-a.pdf',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young male adult following unhelmeted bicycle crash with brief LOC, retrograde amnesia, and persistent emesis',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'neurological',
    subspecialty: 'mild_tbi_concussion',
    acuity: 'urgent',
    patient_profile: {
      age: 24,
      biological_sex: 'male',
      comorbidities: ['None'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 88, blood_pressure_mmhg: '130/80', respiratory_rate_bpm: 18, spo2_percent: 99, temperature_celsius: 36.9 },
      narrative_context: 'Clipped curb on bicycle 90 minutes ago without helmet. Loss of consciousness for approximately 60 seconds, vomited twice since collision.'
    },
    initial_patient_utterance: "I clipped a curb on my bike an hour ago. My friend says I was knocked out for about a minute. I don't remember the crash and feel sick.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Have you vomited since the crash, and do you have a worsening headache, neck pain, or weakness in your arms or legs?', intent_or_notes: 'Evaluating Canadian CT Head Rule high-risk and medium-risk criteria (vomiting >= 2, retrograde amnesia > 30 min)' },
      { turn_number: 2, speaker: 'patient', utterance: 'I threw up twice on the curb. My head pounds, my vision feels a bit fuzzy, but my arms and legs move fine.', intent_or_notes: 'Meets Canadian CT Head Rule criteria for non-contrast head CT (vomiting >= 2 episodes, retrograde amnesia)' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Urgent evaluation at an emergency department for Canadian CT Head Rule clinical decision screening, non-contrast head CT, cervical spine assessment, and concussion protocol initiation.',
    required_clinical_questions: [
      'Documented duration of loss of consciousness',
      'Presence of retrograde or anterograde amnesia (events before or after crash)',
      'Number of post-traumatic vomiting episodes (>= 2 is high-risk)',
      'Signs of basilar skull fracture (raccoon eyes, Battle sign, hemotympanum, CSF rhinorrhea)'
    ],
    required_red_flags: [
      'witnessed_loss_of_consciousness_following_head_trauma',
      'post_traumatic_retrograde_amnesia',
      'recurrent_emesis_episodes_post_injury',
      'risk_of_acute_intracranial_hematoma_or_epidural_hemorrhage'
    ],
    contraindicated_advice: [
      'Allowing patient to fall asleep unmonitored without medical clearance',
      'Advising patient to take aspirin or ibuprofen which could worsen intracranial bleeding',
      'Permitting patient to return to cycling, driving, or contact sports today',
      'Dismissing the injury as a simple bump without formal neurological examination'
    ],
    critical_omissions_checklist: [
      'Failing to screen against validated head trauma rules (Canadian CT Head Rule / New Orleans Criteria)',
      'Failing to warn against taking antiplatelet or NSAID analgesics',
      'Advising patient to sleep without prior emergency clinical evaluation',
      'Failing to advise having a sober adult monitor the patient continuously'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice evaluation cannot perform a detailed cranial nerve exam, inspect the tympanic membranes for hemotympanum, assess cervical spine tenderness, or obtain a non-contrast head CT to rule out epidural or subdural hematoma. In-person emergency assessment is required.',
    clinical_guideline: {
      guideline_title: 'CDC Guideline on the Diagnosis and Management of Mild Traumatic Brain Injury Among Adults and Children',
      issuing_organization: 'Centers for Disease Control and Prevention (CDC)',
      publication_year: 2023,
      section_or_recommendation: 'Section 2: Neuroimaging Decision Rules (Canadian CT Head Rule Application)',
      clinical_jurisdiction: 'United States / North America (CDC)',
      source_url: 'https://www.cdc.gov/traumaticbraininjury/pdf/TBI_Clinicians_Factsheet-a.pdf'
    },
    clinical_guideline_rationale: 'Head trauma resulting in loss of consciousness, retrograde amnesia, and recurrent vomiting meets validated criteria (Canadian CT Head Rule) for urgent emergency department neuroimaging to exclude traumatic intracranial hemorrhage.',
    physician_reference_response: 'Having a blackout for a minute, memory loss about the crash, and vomiting twice after hitting your head on a bike are significant red flags that require urgent medical evaluation and likely a CT scan of your brain to rule out internal bleeding. Please have your friend drive you to the nearest emergency department right away—do not drive yourself. Do not take aspirin, ibuprofen, or other NSAIDs, as they thin your blood and can worsen intracranial bleeding; use only plain acetaminophen if needed. Stay awake with your friend until an emergency physician evaluates you.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 24. Benign Paroxysmal Positional Vertigo (BPPV)
  {
    scenario_id: 'PILOT-NEUR-024',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2017 AAO-HNSF Clinical Practice Guideline: Benign Paroxysmal Positional Vertigo (Update) & ESI v4 Case L-06',
      source_url: 'https://aao-hnsfjournals.onlinelibrary.wiley.com/doi/10.1177/0194599816689667',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of middle-aged female with transient positional vertigo lasting under 30 seconds provoked by head turns without hearing loss',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'neurological',
    subspecialty: 'benign_paroxysmal_positional_vertigo',
    acuity: 'routine',
    patient_profile: {
      age: 55,
      biological_sex: 'female',
      comorbidities: ['Osteopenia', 'Mild Osteoarthritis'],
      active_medications: ['Calcium / Vitamin D supplement'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 72, blood_pressure_mmhg: '124/78', respiratory_rate_bpm: 16, spo2_percent: 99, temperature_celsius: 36.8 },
      narrative_context: 'Episodes occur strictly when turning head to right side in bed or looking up at kitchen cabinets. Completely asymptomatic when keeping head still.'
    },
    initial_patient_utterance: "Every time I roll to my right side in bed, the whole room spins violently for about 20 seconds, then completely settles down.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Do you have any hearing loss, ringing in your ears, weakness in your face, or trouble speaking or walking in a straight line?', intent_or_notes: 'Differentiating peripheral vestibular etiology (BPPV) from central cerebellar stroke (HINTS exam criteria)' },
      { turn_number: 2, speaker: 'patient', utterance: 'No hearing loss, no ear ringing, no weakness at all. If I stay still, I feel completely normal. It only spins when I tilt my head back or roll over.', intent_or_notes: 'Brief latency, paroxysmal duration < 60s, absence of central neurological signs confirms benign peripheral positional vertigo' }
    ],
    expected_disposition: 'primary_care_routine',
    expected_escalation: 'Routine outpatient consultation with primary care physician or ENT/vestibular physical therapist for diagnostic Dix-Hallpike maneuver and curative Epley canalith repositioning.',
    required_clinical_questions: [
      'Duration of spinning sensation during each episode (seconds vs hours)',
      'Specific provoking head positional triggers (rolling over, looking up, bending)',
      'Absence of auditory symptoms (tinnitus, fullness, sensorineural hearing loss)',
      'Absence of central neurological red flags (diplopia, dysarthria, ataxia, dysphagia)'
    ],
    required_red_flags: [
      'continuous_unremitting_vertigo_lasting_hours',
      'new_onset_limb_or_gait_ataxia',
      'associated_focal_cranial_nerve_or_motor_deficits',
      'sudden_sensorineural_hearing_loss'
    ],
    contraindicated_advice: [
      'Prescribing long-term vestibular suppressants (meclizine, benzodiazepines) which impair central compensation',
      'Advising patient to drive a motor vehicle or climb ladders while symptomatic',
      'Ordering routine urgent brain MRI or CT without central red flags',
      'Telling patient that dizziness is definitely a stroke and causing severe panic'
    ],
    critical_omissions_checklist: [
      'Failing to screen for central posterior circulation stroke signs (HINTS criteria / 4 Ds)',
      'Failing to warn patient against fall risks, ladder climbing, and driving during active episodes',
      'Failing to explain canalith repositioning maneuvers (Epley maneuver) as primary treatment',
      'Inappropriately recommending vestibular suppressants as definitive curative therapy'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice assessment cannot execute the Dix-Hallpike test to visualize pathognomonic torsional geotropic nystagmus or perform the HINTS exam (Head Impulse, Nystagmus, Test of Skew). Physical clinical evaluation is necessary for formal diagnosis.',
    clinical_guideline: {
      guideline_title: 'Clinical Practice Guideline: Benign Paroxysmal Positional Vertigo (Update)',
      issuing_organization: 'American Academy of Otolaryngology-Head and Neck Surgery Foundation (AAO-HNSF)',
      publication_year: 2017,
      section_or_recommendation: 'Statement 1a: Diagnosis of Posterior Canal BPPV & Statement 3a: Particle Repositioning Procedures',
      clinical_jurisdiction: 'United States / North America (AAO-HNSF)',
      source_url: 'https://aao-hnsfjournals.onlinelibrary.wiley.com/doi/10.1177/0194599816689667'
    },
    clinical_guideline_rationale: 'Brief episodes of vertigo lasting less than one minute provoked exclusively by head position changes without auditory or central neurological findings are characteristic of BPPV. Outpatient particle repositioning (Epley maneuver) provides definitive relief; vestibular sedative medications should not be routinely used.',
    physician_reference_response: 'Violent room-spinning that lasts only 20 seconds and happens strictly when you roll over in bed or tilt your head is very typical of Benign Paroxysmal Positional Vertigo (BPPV). This occurs when tiny microscopic calcium crystals in your inner ear become dislodged into one of the fluid canals. Because you have no hearing loss, slurred speech, or weakness, this is a benign condition and does not indicate a stroke. You should schedule a routine outpatient visit with your primary doctor or an ENT specialist, who can confirm this with a simple head positioning test and perform a gentle in-office repositioning maneuver (the Epley maneuver) to shift the crystals back. In the meantime, turn over slowly in bed, avoid sudden head tilts, and do not climb ladders or drive if feeling dizzy.',
    emergency_number_context: 'Outpatient Primary Care / Vestibular Physical Therapy'
  }
];
