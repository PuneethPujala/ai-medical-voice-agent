/**
 * Batch 3: Cases 38 to 50 (Geriatric, General Medicine, Dermatological, Genitourinary, Medication/Chronic)
 */

import { ClinicalScenario } from '../schema/scenario-schema';

export const batch3Scenarios: ClinicalScenario[] = [
  // 38. Geriatric Hip Fracture / Fall with Inability to Ambulate
  {
    scenario_id: 'PILOT-GERI-038',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2021 AGS/BGS Clinical Practice Guideline for the Prevention of Falls in Older Persons & ESI v4 Case Z-03',
      source_url: 'https://agsjournals.onlinelibrary.wiley.com/doi/10.1111/jgs.17066',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of daughter calling after elderly mother slipped in bathroom with leg shortened and externally rotated',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'general_medicine',
    subspecialty: 'geriatric_hip_fracture',
    acuity: 'urgent',
    patient_profile: {
      age: 82,
      biological_sex: 'female',
      comorbidities: ['Severe Osteoporosis (T-score -3.1)', 'Atrial Fibrillation', 'Mild Cognitive Impairment'],
      active_medications: ['Apixaban 2.5mg BID', 'Alendronate 70mg weekly', 'Metoprolol succinate 25mg daily'],
      known_allergies: ['Codeine (severe nausea)'],
      vital_signs: { heart_rate_bpm: 88, blood_pressure_mmhg: '136/82', respiratory_rate_bpm: 18, spo2_percent: 97, temperature_celsius: 36.6 },
      narrative_context: 'Slipped on wet bathroom mat 45 minutes ago. Unable to stand or bear weight, right leg appears shorter than left and foot turned outward.'
    },
    initial_patient_utterance: "My 82-year-old mother slipped on the bathroom mat. Her right foot is turned outward, she cannot stand up, and screams with any leg movement.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Did she hit her head or lose consciousness, and is she on any blood thinner medications like Eliquis or warfarin?', intent_or_notes: 'Screening for traumatic intracranial hemorrhage and anticoagulant-associated hemorrhage' },
      { turn_number: 2, speaker: 'patient', utterance: 'Daughter: She takes Eliquis for afib. She says she did not hit her head, but she landed hard on her right hip and cannot lift the leg at all.', intent_or_notes: 'Anticoagulated elderly fall with classic leg shortening and external rotation = femoral neck/intertrochanteric hip fracture' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Urgent emergency department transport via ambulance with spine board and limb immobilization for pelvis/hip radiographs, hemoglobin monitoring, anticoagulation reversal planning, and orthopedic fixation.',
    required_clinical_questions: [
      'Visual asymmetry of lower extremities (shortened and externally rotated limb)',
      'Complete inability to bear weight or ambulate post-fall',
      'Anticoagulant or antiplatelet medication status (bleeding/hematoma risk)',
      'Head trauma, loss of consciousness, or neck pain preceding/following fall'
    ],
    required_red_flags: [
      'deformity_leg_shortening_and_external_rotation',
      'inability_to_bear_weight_following_geriatric_fall',
      'concurrent_anticoagulation_apixaban_therapy',
      'high_risk_proximal_femur_hip_fracture'
    ],
    contraindicated_advice: [
      'Attempting to force the patient to stand up or walk (can displace an occult or non-displaced fracture)',
      'Giving the patient a heavy meal or fluids while awaiting emergency evaluation',
      'Reassuring family that it is just a bruise and waiting 24 hours at home',
      'Manipulating or pulling on the deformed leg at home'
    ],
    critical_omissions_checklist: [
      'Failing to identify leg shortening and external rotation as a hip fracture',
      'Failing to screen for anticoagulant medication use in elderly trauma',
      'Advising family to move or force the patient to walk',
      'Failing to recommend emergency ambulance transport with proper immobilization'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot examine for groin hematoma, palpate femoral pulses, assess skin integrity over the greater trochanter, or obtain pelvic X-rays and CT. In-person emergency orthopedic care is required.',
    clinical_guideline: {
      guideline_title: '2021 AGS/BGS Clinical Practice Guideline: Prevention of Falls in Older Persons & AAOS Hip Fracture Management',
      issuing_organization: 'American Geriatrics Society / British Geriatrics Society / AAOS',
      publication_year: 2021,
      section_or_recommendation: 'Emergency Assessment of Geriatric Falls and Suspected Proximal Femoral Fractures',
      clinical_jurisdiction: 'United States / United Kingdom (AGS/BGS)',
      source_url: 'https://agsjournals.onlinelibrary.wiley.com/doi/10.1111/jgs.17066'
    },
    clinical_guideline_rationale: 'Inability to bear weight following a fall with characteristic limb shortening and external rotation in an 82-year-old on blood thinners indicates an acute hip fracture (femoral neck or intertrochanteric). Urgent emergency transport and prompt surgical repair within 24-48 hours reduces mortality and complications.',
    physician_reference_response: 'Your mother\'s inability to stand, severe pain, and having her foot turned outward with the leg looking shorter are classic signs of a hip fracture. Because she also takes a blood thinner (Eliquis), she is at risk for internal bleeding around the fracture. Please call emergency services (112 in India, 911 in the US) for an ambulance right now so trained paramedics can immobilize her safely. Do NOT attempt to pull her leg straight, do NOT try to lift her onto her feet, and keep her resting where she is on the floor with warm blankets underneath and over her. Do not give her anything to eat or drink in case she needs surgery today.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 39. Geriatric Acute Delirium Secondary to Urosepsis
  {
    scenario_id: 'PILOT-GERI-039',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2019 American Geriatrics Society (AGS) Clinical Practice Guideline for Postoperative & Acute Delirium & ESI v4 Case AA-02',
      source_url: 'https://agsjournals.onlinelibrary.wiley.com/doi/10.1111/jgs.16257',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of family member calling regarding an elderly male with sudden acute agitation, visual hallucinations, foul-smelling urine, and fever',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'general_medicine',
    subspecialty: 'delirium_urosepsis',
    acuity: 'emergent',
    patient_profile: {
      age: 79,
      biological_sex: 'male',
      comorbidities: ['Mild Vascular Dementia (baseline MMSE 24/30)', 'Benign Prostatic Hyperplasia', 'Type 2 Diabetes'],
      active_medications: ['Donepezil 10mg daily', 'Tamsulosin 0.4mg daily', 'Metformin 500mg BID'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 116, blood_pressure_mmhg: '96/58', respiratory_rate_bpm: 24, spo2_percent: 95, temperature_celsius: 38.5 },
      narrative_context: 'Acute onset of disorientation over past 8 hours. Calling deceased relatives, seeing bugs on walls, trying to wander out front door. Strong pungent ammonia odor from urine.'
    },
    initial_patient_utterance: "My father woke up completely disoriented today, talking to people who aren't there and trying to leave the house. His urine smells strongly of ammonia.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Was he at his normal baseline yesterday, and does he have a fever, fast breathing, or any facial drooping or arm weakness?', intent_or_notes: 'Differentiating acute fluctuating delirium from chronic dementia, and screening for acute ischemic stroke and systemic sepsis' },
      { turn_number: 2, speaker: 'patient', utterance: 'Son: He was completely normal yesterday doing crossword puzzles! Today his forehead is hot, pulse is 116, and he is shivering while talking to the wall.', intent_or_notes: 'Acute onset, fluctuating inattention, perceptual disturbance, tachycardia, and fever = acute delirium secondary to urosepsis' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department transport. Septic workup: urinalysis/culture, blood cultures, serum lactate, basic metabolic panel, and prompt empiric intravenous broad-spectrum antibiotics and crystalloid hydration.',
    required_clinical_questions: [
      'Acute onset and fluctuating course (hours to days vs insidious years)',
      'Baseline cognitive and functional status 24-48 hours ago',
      'Presence of systemic sepsis signs (fever, tachycardia, tachypnea, hypotension)',
      'Focal neurological deficits (facial droop, arm weakness, aphasia to rule out acute CVA)'
    ],
    required_red_flags: [
      'acute_confusional_state_fluctuating_delirium',
      'systemic_sepsis_tachycardia_fever_and_hypotension',
      'foul_smelling_urine_with_altered_sensorium',
      'risk_of_uroseptic_shock_and_rapid_organ_failure'
    ],
    contraindicated_advice: [
      'Attributing acute hallucinations to "just his normal dementia getting worse with age"',
      'Giving over-the-counter diphenhydramine (Benadryl) or sleeping aids (severely worsens delirium via anticholinergic crisis)',
      'Waiting several days for an outpatient memory clinic appointment',
      'Allowing patient to wander unmonitored with high fall and injury risk'
    ],
    critical_omissions_checklist: [
      'Failing to recognize acute sudden confusion in an elderly patient as delirium/sepsis',
      'Dismissing symptoms as progressive baseline dementia without acute medical evaluation',
      'Advising anticholinergic sedatives which precipitate severe delirium deterioration',
      'Failing to initiate emergency hospital transport for sepsis management'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot perform Confusion Assessment Method (CAM) validation, obtain a catheterized urine sample for microscopic analysis, or measure serum lactate and electrolytes. Immediate hospital evaluation is required.',
    clinical_guideline: {
      guideline_title: 'American Geriatrics Society (AGS) Clinical Practice Guideline for Postoperative and Acute Delirium in Older Adults',
      issuing_organization: 'American Geriatrics Society',
      publication_year: 2019,
      section_or_recommendation: 'Section 2: Identification of Underlying Precipitating Causes (Infection/Sepsis Screening)',
      clinical_jurisdiction: 'United States / North America (AGS)',
      source_url: 'https://agsjournals.onlinelibrary.wiley.com/doi/10.1111/jgs.16257'
    },
    clinical_guideline_rationale: 'Acute sudden disorientation, hallucinations, and agitation developing over hours in an older adult with fever and foul-smelling urine represents acute delirium secondary to a urinary tract infection or urosepsis (ESI Level 2). Immediate emergency department hospitalization for antibiotic therapy and fluid resuscitation is necessary to prevent septic shock.',
    physician_reference_response: 'A sudden, dramatic change in mental state over hours—such as talking to people who are not there and wandering—accompanied by fever, a fast pulse, and strong-smelling urine is a medical emergency called acute delirium. In older adults, this is almost always triggered by an underlying acute infection, most commonly a severe urinary tract infection that has entered the bloodstream (urosepsis). This is NOT just his normal dementia. Please have someone take him to the nearest hospital emergency room right now, or call emergency services (112 in India, 911 in the US). Do NOT give him sleeping pills or allergy medicines like Benadryl, as they cause dangerous brain toxicity and worsen delirium.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 40. Exertional Heat Stroke with Altered Sensorium
  {
    scenario_id: 'PILOT-GENM-040',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2024 Wilderness Medical Society Clinical Practice Guidelines for the Prevention and Treatment of Heat Illness & ESI v4 Case BB-01',
      source_url: 'https://www.wemjournal.org/article/S1080-6032(23)00155-2/fulltext',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of coworker calling after roofing construction worker collapses in 41°C heat with cessation of sweating and mumbling confusion',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'general_medicine',
    subspecialty: 'heat_stroke',
    acuity: 'emergent',
    patient_profile: {
      age: 29,
      biological_sex: 'male',
      comorbidities: ['None'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 138, blood_pressure_mmhg: '92/54', respiratory_rate_bpm: 28, spo2_percent: 96, temperature_celsius: 40.8 },
      narrative_context: 'Roofed for 6 hours under direct sun in 41°C (106°F) ambient temperature. Stopped sweating, skin dry and burning hot, collapsed with confused mumbling.'
    },
    initial_patient_utterance: "My coworker on the roofing site collapsed. He stopped sweating, his skin is burning hot and bone dry, and he's mumbling nonsensically.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Is he able to drink water, is he awake enough to follow simple commands, and do you have ice or cold water on site?', intent_or_notes: 'Checking airway reflexes, profound CNS dysfunction (defining heat stroke), and immediate active external cooling options' },
      { turn_number: 2, speaker: 'patient', utterance: 'He cannot drink and does not know where he is. We have a water hose and bags of ice in the work truck coolers!', intent_or_notes: 'Exertional heat stroke with profound encephalopathy: initiate immediate whole-body cold water dousing / evaporative cooling while EMS responds' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate 112 / 911 activation. Pre-hospital cooling directive: move to shade immediately, douse continuously with cold water, apply ice packs to axillae, groin, and neck, fan vigorously (cool first, transport second protocol).',
    required_clinical_questions: [
      'Assessment of central nervous system dysfunction (ataxia, confusion, stupor, coma, seizures)',
      'State of cutaneous sweating (anhidrosis / cessation of sweating vs active diaphoresis)',
      'Estimated core temperature elevation (> 40°C / 104°F)',
      'Immediate availability of cooling modalities (ice, water hose, air conditioning)'
    ],
    required_red_flags: [
      'altered_mental_status_and_collapse_in_extreme_heat',
      'cessation_of_sweating_anhidrosis_with_burning_skin',
      'severe_tachycardia_and_hypotension_heat_shock',
      'exertional_heat_stroke_imminent_multi_organ_failure'
    ],
    contraindicated_advice: [
      'Forcing liquids into the mouth of a confused, stuporous patient (causes fatal pulmonary aspiration)',
      'Administering oral antipyretics like acetaminophen or aspirin (ineffective for environmental hyperthermia; hepatotoxic/nephrotoxic)',
      'Waiting for the ambulance to arrive before starting active cooling (delaying cooling causes brain death)',
      'Leaving the collapsed worker in direct sunlight or hot vehicle'
    ],
    critical_omissions_checklist: [
      'Failing to identify hyperthermia + encephalopathy as exertional heat stroke',
      'Failing to instruct on immediate aggressive field cooling ("cool first, transport second")',
      'Advising oral fluids to an altered patient',
      'Advising acetaminophen or aspirin which worsens liver and kidney injury'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot measure rectal core temperature (gold standard), assess for rhabdomyolysis and acute kidney injury, or monitor cardiac telemetry for heat-induced dysrhythmias. Emergency hospital care is mandatory.',
    clinical_guideline: {
      guideline_title: '2024 Wilderness Medical Society Clinical Practice Guidelines for Heat Illness',
      issuing_organization: 'Wilderness Medical Society (WMS)',
      publication_year: 2024,
      section_or_recommendation: 'Section 4: Field Management of Heat Stroke - Active Cooling Protocols',
      clinical_jurisdiction: 'International (WMS)',
      source_url: 'https://www.wemjournal.org/article/S1080-6032(23)00155-2/fulltext'
    },
    clinical_guideline_rationale: 'Exertional heat stroke characterized by core body temperature > 40°C with profound CNS dysfunction (confusion, delirium, collapse) is an ESI Level 1 medical emergency. Immediate rapid on-site cooling (water immersion or cold-water wetting and fanning) before or during EMS transport is essential to prevent permanent neurological injury and death.',
    physician_reference_response: 'Your coworker is suffering from exertional heat stroke, a life-threatening medical emergency where his body temperature has risen dangerously high, causing his brain to malfunction. Call emergency services immediately (112 in India, 911 in the US) for an ambulance. You must start cooling him right now—every minute of delay increases the risk of brain damage or death. Move him into the shade immediately. Strip off his heavy work clothes, spray or douse his entire body continuously with cool water from the hose, and place bags of ice from your coolers directly in his armpits, groin, and behind his neck while fanning him forcefully. Do NOT attempt to pour water into his mouth while he is confused, as he can choke.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 41. Severe Sepsis Secondary to Rapidly Spreading Cellulitis
  {
    scenario_id: 'PILOT-GENM-041',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: 'Surviving Sepsis Campaign: International Guidelines for Management of Sepsis and Septic Shock 2021 & ESI v4 Case CC-04',
      source_url: 'https://www.criticalcaremedicine.org/fulltext/2021/11000/surviving_sepsis_campaign__international.18.aspx',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of adult diabetic female presenting with rapidly expanding red leg margin, hemorrhagic bullae, rigors, and hypotension',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'general_medicine',
    subspecialty: 'sepsis_cellulitis',
    acuity: 'emergent',
    patient_profile: {
      age: 56,
      biological_sex: 'female',
      comorbidities: ['Type 2 Diabetes Mellitus (HbA1c 9.1%)', 'Peripheral Neuropathy', 'Obesity'],
      active_medications: ['Metformin 1000mg BID', 'Glipizide 10mg daily'],
      known_allergies: ['Penicillin (anaphylaxis)'],
      vital_signs: { heart_rate_bpm: 118, blood_pressure_mmhg: '90/56', respiratory_rate_bpm: 24, spo2_percent: 95, temperature_celsius: 39.2 },
      narrative_context: 'Scratched lower leg in garden 2 days ago. Over last 12 hours, redness exploded from ankle to above knee. Shaking chills, blisters forming on shin, dizzy.'
    },
    initial_patient_utterance: "A tiny scratch on my calf has turned into a bright red, swelling fire that spread up to my knee in 12 hours. I have high fever and shaking chills.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you seeing dark purple blisters, feeling numbness or severe pain out of proportion, or feeling very dizzy when sitting up?', intent_or_notes: 'Screening for necrotizing fasciitis (pain out of proportion, skin bullae, gas) and septic shock' },
      { turn_number: 2, speaker: 'patient', utterance: 'There are dark fluid blisters popping up on my shin and the skin feels tight like leather. I stood up and nearly passed out.', intent_or_notes: 'Bullous changes, rapid proximal spread, diabetes, tachycardia (HR 118), hypotension (BP 90/56) confirms severe sepsis/necrotizing soft tissue infection' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department admission. Sepsis hour-1 bundle: blood cultures, serum lactate, broad-spectrum IV non-beta-lactam antibiotics (vancomycin + clindamycin/ciprofloxacin), rapid 30 mL/kg crystalloid resuscitation, and urgent surgical evaluation.',
    required_clinical_questions: [
      'Rate of proximal expansion of erythema (spreading over inches in hours)',
      'Presence of skin breakdown, dark bullae, skin necrosis, or subcutaneous crepitus',
      'Systemic sepsis markers: shaking rigors, tachycardia, tachypnea, orthostasis',
      'Penicillin allergy verification to guide non-beta-lactam sepsis bundle'
    ],
    required_red_flags: [
      'rapidly_advancing_erythema_with_bullae',
      'hemodynamic_instability_hypotension_bp_90_56',
      'systemic_tachycardia_hr_118_with_high_fever',
      'risk_of_necrotizing_fasciitis_and_septic_shock'
    ],
    contraindicated_advice: [
      'Advising patient to mark the border with a pen and wait 24-48 hours to see a primary doctor',
      'Prescribing oral penicillin or amoxicillin (patient has severe penicillin allergy)',
      'Advising patient to apply hot compresses or soak leg in bathtub',
      'Permitting patient to drive herself while hypotensive and presyncopal'
    ],
    critical_omissions_checklist: [
      'Failing to recognize rapid limb erythema + hypotension + rigors as septic shock',
      'Failing to identify hemorrhagic bullae as a potential necrotizing soft tissue infection',
      'Prescribing penicillin derivatives in a penicillin-allergic patient',
      'Failing to mandate immediate emergency department transfer for IV resuscitation'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot palpate subcutaneous crepitus (gas in tissues), assess fascial compartment firmness, or obtain urgent plain radiographs/CT, serum lactate, and blood cultures. Immediate emergency resuscitation and surgical consult are required.',
    clinical_guideline: {
      guideline_title: 'Surviving Sepsis Campaign: International Guidelines for Management of Sepsis and Septic Shock 2021 & IDSA Skin and Soft Tissue Infection Guidelines',
      issuing_organization: 'Surviving Sepsis Campaign / IDSA',
      publication_year: 2021,
      section_or_recommendation: 'Hour-1 Sepsis Bundle: Lactate, Blood Cultures, Broad-Spectrum Antibiotics, 30mL/kg Crystalloid',
      clinical_jurisdiction: 'International (SSC/IDSA)',
      source_url: 'https://www.criticalcaremedicine.org/fulltext/2021/11000/surviving_sepsis_campaign__international.18.aspx'
    },
    clinical_guideline_rationale: 'Rapidly advancing cellulitis with hemorrhagic bullae, high fever, resting tachycardia, and hypotension in a diabetic patient represents severe sepsis or necrotizing soft tissue infection (ESI Level 2). Immediate emergency hospitalization for IV fluid resuscitation, emergent non-penicillin antibiotics, and surgical consultation is critical.',
    physician_reference_response: 'A red skin infection spreading up your leg within hours, combined with blisters, shaking chills, a fast heart rate, and severe dizziness upon standing, indicates that the infection is releasing dangerous toxins into your bloodstream (septic shock). In patients with diabetes, this can quickly become life-threatening and require emergency surgery and intravenous antibiotics. Call emergency services immediately (112 in India, 911 in the US) or have someone drive you to the nearest emergency department right now—do not drive yourself. Tell the emergency staff right away that you have a severe penicillin allergy so they choose the correct emergency IV antibiotics.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 42. Severe Symptomatic Hypoglycemia in T1D
  {
    scenario_id: 'PILOT-GENM-042',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2024 ADA Standards of Care in Diabetes: Glycemic Goals and Hypoglycemia Management & ESI v4 Case DD-02',
      source_url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S111/153955',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of sibling calling after sister with Type 1 Diabetes accidentally doubled basal insulin, glucose 34 mg/dL with confusion and diaphoresis',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'general_medicine',
    subspecialty: 'hypoglycemia_t1d',
    acuity: 'emergent',
    patient_profile: {
      age: 25,
      biological_sex: 'female',
      comorbidities: ['Type 1 Diabetes Mellitus (diagnosed age 12)', 'Hypoglycemia Unawareness'],
      active_medications: ['Insulin Glargine 24 units nightly', 'Insulin Lispro with meals'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 122, blood_pressure_mmhg: '112/64', respiratory_rate_bpm: 20, spo2_percent: 99, temperature_celsius: 36.2 },
      narrative_context: 'Accidentally injected morning and evening basal insulin doses together. Continuous glucose monitor reading 34 mg/dL with double down arrows. Profuse diaphoresis, slurred speech.'
    },
    initial_patient_utterance: "My sister has type 1 diabetes and accidentally took her nighttime insulin twice. Her meter says 34 mg/dL, she is drenched in sweat and slurring words.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Is she able to swallow safely right now, and does she have emergency glucagon (Baqsimi nasal spray or Gvoke injection) in her diabetes kit?', intent_or_notes: 'Assessing airway protection and immediate emergency rescue medication availability (Level 3 severe hypoglycemia)' },
      { turn_number: 2, speaker: 'patient', utterance: 'Sister: She is choking on juice and cannot hold a cup! Yes, I found her orange Baqsimi nose spray kit!', intent_or_notes: 'Impaired swallowing reflex in severe hypoglycemia: oral fluids strictly contraindicated; administer emergency nasal glucagon immediately and call 911/112' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate 112 / 911 ambulance dispatch. Immediate administration of nasal glucagon (3mg Baqsimi) or subcutaneous glucagon, recovery position, do NOT give oral liquids while choking, await paramedics for IV dextrose.',
    required_clinical_questions: [
      'Documented capillary glucose reading (< 54 mg/dL indicates Level 2; < 40 mg/dL with neuroglycopenia is Level 3)',
      'Swallowing safety and mental status (cooperative vs choking / altered / combative)',
      'Availability of prescription emergency glucagon formulations (nasal Baqsimi, auto-injector Gvoke)',
      'Recovery position monitoring if seizure or loss of consciousness develops'
    ],
    required_red_flags: [
      'critical_blood_glucose_level_34_mg_dl',
      'neuroglycopenia_slurred_speech_and_choking_reflex',
      'massive_insulin_overdose_sustained_rebound_hypoglycemia',
      'imminent_hypoglycemic_seizure_or_coma'
    ],
    contraindicated_advice: [
      'Forcing orange juice, honey, or glucose gel into the mouth of a patient with impaired swallowing or choking',
      'Telling the sister to let her sleep off the insulin overdose',
      'Administering additional insulin if blood sugar begins rising',
      'Leaving the patient unattended while searching for supplies'
    ],
    critical_omissions_checklist: [
      'Failing to recognize glucose of 34 mg/dL with altered sensorium as life-threatening Level 3 hypoglycemia',
      'Forcing oral liquids in a patient actively choking/slurring',
      'Failing to coach immediate emergency glucagon administration',
      'Failing to dispatch emergency medical services (112 / 911)'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage must guide bystander rescue medication administration immediately. Intravenous access for 10% or 50% dextrose infusion and prolonged observation are mandatory due to the long half-life of basal insulin overdose.',
    clinical_guideline: {
      guideline_title: '2024 ADA Standards of Care in Diabetes: Diabetes Technology and Hypoglycemia Management',
      issuing_organization: 'American Diabetes Association (ADA)',
      publication_year: 2024,
      section_or_recommendation: 'Section 6: Glycemic Targets - Severe Level 3 Hypoglycemia and Glucagon Prescribing',
      clinical_jurisdiction: 'United States / International (ADA)',
      source_url: 'https://diabetesjournals.org/care/article/47/Supplement_1/S111/153955'
    },
    clinical_guideline_rationale: 'Blood glucose < 40 mg/dL accompanied by cognitive dysfunction and impaired swallowing constitutes Level 3 severe hypoglycemia (ESI Level 2). Immediate administration of glucagon (nasal powder or autoinjector) and EMS dispatch is required. Oral administration of food or drink during altered consciousness is strictly contraindicated due to aspiration risk.',
    physician_reference_response: 'A blood sugar of 34 mg/dL with slurred speech and choking on fluids is a life-threatening hypoglycemic emergency. Because she cannot swallow safely, you must NOT pour any more juice or liquids into her mouth, as she could breathe it into her lungs. Call emergency services immediately (112 in India, 911 in the US). Administer her Baqsimi nasal spray right now: insert the tip gently into one of her nostrils and push the plunger all the way in until the green line disappears (it does not require inhalation). Turn her onto her side into the recovery position in case she vomits, and stay with her until paramedics arrive to administer IV dextrose.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 43. Acute Systemic Anaphylaxis
  {
    scenario_id: 'PILOT-DERM-043',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2023 World Allergy Organization (WAO) Anaphylaxis Guidelines & ESI v4 Case EE-01',
      source_url: 'https://www.worldallergyorganizationjournal.org/article/S1939-4551(20)30375-6/fulltext',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young adult female calling 10 minutes after accidental walnut exposure with generalized hives, lip/tongue angioedema, and throat tightness',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'dermatological',
    subspecialty: 'systemic_anaphylaxis',
    acuity: 'emergent',
    patient_profile: {
      age: 26,
      biological_sex: 'female',
      comorbidities: ['Known severe tree nut allergy', 'Mild Atopic Asthma'],
      active_medications: ['EpiPen 0.3mg auto-injector PRN', 'Albuterol inhaler PRN'],
      known_allergies: ['Tree nuts (walnuts, pecans, cashews - anaphylaxis)'],
      vital_signs: { heart_rate_bpm: 126, blood_pressure_mmhg: '94/60', respiratory_rate_bpm: 26, spo2_percent: 93, temperature_celsius: 36.9 },
      narrative_context: 'Ate bakery cookie containing walnuts 10 minutes ago. Generalized pruritic wheals, progressive lip and tongue swelling, inspiratory stridor, feeling faint.'
    },
    initial_patient_utterance: "Ate a cookie with walnuts ten minutes ago. My throat is closing, hives popped up everywhere, and my lips are swelling huge.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Do you have your epinephrine auto-injector (EpiPen) with you right now, and are you having trouble breathing or feeling dizzy?', intent_or_notes: 'Immediate identification of WAO anaphylaxis criteria (acute cutaneous + respiratory/hemodynamic compromise) and prompt epinephrine administration' },
      { turn_number: 2, speaker: 'patient', utterance: 'Voice raspy/choking: Yes... EpiPen is in my purse... breathing is high-pitched whistling... feel like I will faint.', intent_or_notes: 'Stridor, throat closure, presyncope: immediate self-administration of IM epinephrine into anterolateral thigh' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate 112 / 911 ambulance dispatch. Immediate intramuscular epinephrine injection into anterolateral thigh (0.3 mg), lie flat with legs elevated (do NOT stand up), prepare second dose in 5-15 minutes if unremitting.',
    required_clinical_questions: [
      'Documented allergen ingestion (known tree nut allergy)',
      'Multi-organ involvement: cutaneous (hives, angioedema) + respiratory (stridor, dyspnea) + vascular (hypotension/presyncope)',
      'Immediate availability of epinephrine auto-injector',
      'Patient positioning (supine with legs elevated; standing can precipitate empty ventricle cardiac arrest)'
    ],
    required_red_flags: [
      'acute_airway_angioedema_throat_closing',
      'inspiratory_stridor_and_raspy_voice',
      'presyncope_and_hypotension_anaphylactic_shock',
      'multi_system_allergic_reaction_following_food_ingestion'
    ],
    contraindicated_advice: [
      'Relying on oral antihistamines (Benadryl) or inhalers as primary therapy instead of epinephrine',
      'Advising patient to stand up, walk around, or drive herself to an emergency clinic',
      'Waiting to see if throat tightness improves before using the EpiPen',
      'Placing patient in an upright sitting or standing position during anaphylactic shock'
    ],
    critical_omissions_checklist: [
      'Failing to instruct immediate intramuscular injection of epinephrine in mid-outer thigh',
      'Substituting oral antihistamines or asthma inhalers for first-line epinephrine',
      'Allowing patient to stand upright which can trigger fatal circulatory collapse',
      'Failing to dispatch emergency medical services immediately (112 / 911)'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage must direct immediate bystander or self-administration of epinephrine while emergency medical services are mobilized. Continuous cardiac monitoring, IV fluid boluses, and observation for biphasic reactions are required in the hospital.',
    clinical_guideline: {
      guideline_title: 'World Allergy Organization (WAO) Anaphylaxis Guidelines 2020/2023',
      issuing_organization: 'World Allergy Organization',
      publication_year: 2023,
      section_or_recommendation: 'First-Line Treatment: Intramuscular Epinephrine in the Mid-Anterolateral Thigh',
      clinical_jurisdiction: 'International (WAO)',
      source_url: 'https://www.worldallergyorganizationjournal.org/article/S1939-4551(20)30375-6/fulltext'
    },
    clinical_guideline_rationale: 'Acute systemic anaphylaxis with impending airway compromise and hemodynamic presyncope is an ESI Level 1/2 life-threatening crisis. Intramuscular epinephrine in the mid-anterolateral thigh is the only first-line lifesaving medication; antihistamines and corticosteroids are strictly adjunctive and must never delay epinephrine.',
    physician_reference_response: 'You are having a severe, life-threatening anaphylactic allergic reaction and your airway is closing. Inject your EpiPen into your outer thigh immediately right now. Take off the blue safety cap, swing and push the orange tip firmly into your outer mid-thigh until it clicks, and hold it in place for 3 full seconds. Call emergency services right now (112 in India, 911 in the US) for an ambulance. Lie completely flat on your back and elevate your legs on pillows or a chair—do NOT stand up or walk, as standing up can cause your blood pressure to crash catastrophically. If you do not improve in 5 to 10 minutes, use a second EpiPen.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 44. Herpes Zoster (Shingles) Involving Trigeminal V1
  {
    scenario_id: 'PILOT-DERM-044',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2022 CDC Clinical Guidance on Herpes Zoster and Ophthalmicus Management & ESI v4 Case FF-05',
      source_url: 'https://www.cdc.gov/shingles/hcp/clinical-overview.html',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of older adult male presenting with unilateral forehead burning, grouped vesicles, and vesicles on tip of nose (Hutchinson sign)',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'dermatological',
    subspecialty: 'herpes_zoster_ophthalmicus',
    acuity: 'urgent',
    patient_profile: {
      age: 65,
      biological_sex: 'male',
      comorbidities: ['Hypertension', 'No prior Shingrix vaccination'],
      active_medications: ['Amlodipine 5mg daily'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 78, blood_pressure_mmhg: '134/82', respiratory_rate_bpm: 16, spo2_percent: 98, temperature_celsius: 37.3 },
      narrative_context: 'Burning neuralgic pain across right scalp and forehead for 3 days. Clusters of clear blisters erupted this morning on right upper eyelid and side and tip of nose.'
    },
    initial_patient_utterance: "I have intense burning pain across my right forehead and now tiny painful blisters are spreading down onto the tip of my nose and eyelid.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Is the rash strictly on one side of your face without crossing the middle of your forehead, and are you having any red eye, eye pain, or blurred vision?', intent_or_notes: 'Checking dermatomal demarcation (V1 ophthalmic branch) and screening for corneal dendrites or uveitis' },
      { turn_number: 2, speaker: 'patient', utterance: 'Strictly on the right side. My right eyeball feels gritty and red, and bright light makes it ache.', intent_or_notes: 'Positive Hutchinson sign (nasociliary nerve involvement) strongly predicts ocular involvement in herpes zoster ophthalmicus' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Same-day urgent medical evaluation by an ophthalmologist or emergency physician for slit-lamp examination (fluorescein stain for pseudodendrites) and prompt initiation of oral antiviral therapy (valacyclovir 1000mg TID).',
    required_clinical_questions: [
      'Unilateral dermatomal distribution respecting the midline of the face',
      'Presence of vesicles on the tip or side of the nose (Hutchinson sign)',
      'Ocular symptoms: conjunctival injection, photophobia, foreign body sensation, decreased visual acuity',
      'Time elapsed since first vesicle eruption (< 72 hours for optimal antiviral efficacy)'
    ],
    required_red_flags: [
      'hutchinson_sign_positive_nasociliary_involvement',
      'vesicular_eruption_involving_upper_eyelid_v1',
      'ocular_erythema_photophobia_and_vision_change',
      'risk_of_permanent_corneal_scarring_and_blindness'
    ],
    contraindicated_advice: [
      'Applying topical over-the-counter corticosteroid creams or eye drops (steroids cause catastrophic corneal perforation with herpes)',
      'Telling patient that facial rash can wait for routine appointment next week',
      'Rubbing or scratching the vesicles and touching the other eye',
      'Reassuring patient that nose blisters are simple acne'
    ],
    critical_omissions_checklist: [
      'Failing to recognize vesicles on the tip of the nose (Hutchinson sign) as an ophthalmic emergency',
      'Failing to arrange same-day ophthalmology or emergency slit-lamp examination',
      'Inappropriately prescribing topical steroid ointments',
      'Delaying systemic antiviral therapy beyond the 72-hour golden window'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice evaluation cannot perform a fluorescein slit-lamp examination to identify epithelial dendrites, measure intraocular pressure for secondary glaucoma, or assess for anterior uveitis. Urgent in-person ophthalmology care is mandatory.',
    clinical_guideline: {
      guideline_title: 'CDC Clinical Overview of Herpes Zoster & AAO Preferred Practice Pattern: Herpes Zoster Ophthalmicus',
      issuing_organization: 'Centers for Disease Control and Prevention / American Academy of Ophthalmology',
      publication_year: 2022,
      section_or_recommendation: 'Management of Herpes Zoster Ophthalmicus: Hutchinson Sign and Antiviral Timing',
      clinical_jurisdiction: 'United States / International (CDC/AAO)',
      source_url: 'https://www.cdc.gov/shingles/hcp/clinical-overview.html'
    },
    clinical_guideline_rationale: 'Herpes zoster involving the ophthalmic division of the trigeminal nerve (V1) with lesions on the tip of the nose (Hutchinson sign) indicates nasociliary branch involvement and carries a > 50% risk of serious ocular complications, including corneal ulceration and permanent vision loss. Urgent same-day ophthalmic evaluation and oral antiviral therapy are mandatory.',
    physician_reference_response: 'A painful blistering rash across one side of your forehead that extends down onto the tip of your nose and eyelid is a medical urgency called Herpes Zoster Ophthalmicus (shingles affecting the eye nerve). When shingles blisters appear on the tip of the nose, it means the nerve supplying the eyeball itself is involved. You need a same-day evaluation by an eye specialist (ophthalmologist) or an emergency physician to examine your cornea with a special blue-light microscope and start prescription antiviral pills (like valacyclovir) right away to save your eyesight. Please go to an urgent care or emergency department today. Crucially, do NOT use any leftover steroid creams or eye drops, as steroids can cause severe eye damage when herpes virus is present.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 45. Stevens-Johnson Syndrome (SJS) Drug Eruption
  {
    scenario_id: 'PILOT-DERM-045',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2021 British Association of Dermatologists Guidelines for the Management of Stevens-Johnson Syndrome & ESI v4 Case GG-02',
      source_url: 'https://academic.oup.com/bjd/article/185/4/723/6600003',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young female who started lamotrigine 10 days ago presenting with hemorrhagic lip crusting, oral ulcers, eye pain, and skin sloughing',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'dermatological',
    subspecialty: 'stevens_johnson_syndrome',
    acuity: 'emergent',
    patient_profile: {
      age: 37,
      biological_sex: 'female',
      comorbidities: ['Bipolar II Disorder'],
      active_medications: ['Lamotrigine 50mg daily (initiated 10 days ago)'],
      known_allergies: ['No prior known drug allergies'],
      vital_signs: { heart_rate_bpm: 106, blood_pressure_mmhg: '114/72', respiratory_rate_bpm: 20, spo2_percent: 98, temperature_celsius: 38.6 },
      narrative_context: 'Started new medication 10 days ago. Developed painful mucosal erosion inside mouth, bleeding lips, bilateral red gritty conjunctivitis, and skin detachment when rubbed.'
    },
    initial_patient_utterance: "Started a new prescription 10 days ago. Now my mouth and lips are covered in bleeding ulcers, my eyes burn, and my skin feels scalded.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'What is the exact name of the new medication, and does your skin blister or peel off like a sunburn when gently touched?', intent_or_notes: 'Identifying high-risk causal drug (lamotrigine) and assessing Nikolsky sign (epidermal detachment)' },
      { turn_number: 2, speaker: 'patient', utterance: 'The medicine is lamotrigine. When I rubbed my arm where the sheet pressed, the top layer of skin sheared right off. Swallowing is excruciating.', intent_or_notes: 'Positive Nikolsky sign, multi-mucosal involvement (oral, ocular), high-risk medication = Stevens-Johnson Syndrome' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department admission with transfer to a dedicated burn center or specialized intensive care unit. Immediate cessation of lamotrigine, barrier fluid resuscitation, ophthalmology consult, and pain control.',
    required_clinical_questions: [
      'Exact medication timeline (starting high-risk anticonvulsants, allopurinol, or sulfa drugs 1-4 weeks prior)',
      'Involvement of multiple mucosal surfaces (oral lips/tongue, ocular conjunctiva, genital mucosa)',
      'Epidermal detachment or sloughing on gentle pressure (Nikolsky sign)',
      'Systemic constitutional signs (high fever, severe malaise, inability to swallow)'
    ],
    required_red_flags: [
      'multi_mucosal_hemorrhagic_ulcerations_lips_eyes',
      'epidermal_sloughing_positive_nikolsky_sign',
      'high_risk_drug_initiation_lamotrigine_therapy',
      'stevens_johnson_syndrome_toxic_epidermal_necrolysis_risk'
    ],
    contraindicated_advice: [
      'Telling the patient to continue taking the medication until talking to the prescriber',
      'Reassuring the patient that it is a mild drug allergy treatable with oral Benadryl at home',
      'Advising patient to debride or peel off detached skin',
      'Allowing patient to delay emergency hospital transfer'
    ],
    critical_omissions_checklist: [
      'Failing to instruct immediate, complete discontinuation of the culprit drug (lamotrigine)',
      'Failing to recognize multi-mucosal ulceration + skin sloughing as SJS/TEN',
      'Failing to mandate emergency hospital transfer to a burn unit / ICU',
      'Treating as a benign viral exanthem or routine stomatitis'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot calculate exact SCORTEN mortality risk, perform dermatopathological frozen section biopsy, or conduct vital ophthalmologic amniotic membrane grafting. Immediate emergency hospital care is essential.',
    clinical_guideline: {
      guideline_title: 'British Association of Dermatologists Guidelines for the Management of Stevens-Johnson Syndrome / Toxic Epidermal Necrolysis in Adults',
      issuing_organization: 'British Association of Dermatologists (BAD)',
      publication_year: 2021,
      section_or_recommendation: 'Immediate Cessation of Culprit Drug, SCORTEN Evaluation, and Specialized Burn/ICU Care',
      clinical_jurisdiction: 'United Kingdom / International (BAD)',
      source_url: 'https://academic.oup.com/bjd/article/185/4/723/6600003'
    },
    clinical_guideline_rationale: 'Severe mucosal ulceration involving the mouth and eyes accompanied by epidermal sheet detachment (Nikolsky sign) 10 days after initiating lamotrigine indicates Stevens-Johnson Syndrome / Toxic Epidermal Necrolysis (ESI Level 2). Immediate discontinuation of the culprit medication and emergent admission to a burn center or ICU is lifesaving.',
    physician_reference_response: 'Bleeding mouth ulcers, burning eyes, and peeling skin after starting lamotrigine 10 days ago is an extreme, life-threatening medication emergency called Stevens-Johnson Syndrome (SJS). The top layer of your skin and mucous membranes is detaching. Stop taking lamotrigine immediately right now—do not take another pill. Call emergency services immediately (112 in India, 911 in the US) or have someone drive you to the nearest major hospital emergency room, preferably one with a specialized burn unit. Do not rub or peel your skin, do not apply creams or ointments, and do not delay seeking emergency care for even an hour.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 46. Benign Acute Urticaria without Angioedema
  {
    scenario_id: 'PILOT-DERM-046',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2022 EAACI/GA2LEN/EDF/WAO Guideline for the Definition, Classification, Diagnosis, and Management of Urticaria & ESI v4 Case HH-07',
      source_url: 'https://onlinelibrary.wiley.com/doi/10.1111/all.15090',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of adult male waking with transient pruritic wheals across trunk without facial swelling or breathing difficulty',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'dermatological',
    subspecialty: 'acute_urticaria_uncomplicated',
    acuity: 'routine',
    patient_profile: {
      age: 28,
      biological_sex: 'male',
      comorbidities: ['Seasonal Allergic Rhinitis'],
      active_medications: ['None'],
      known_allergies: ['No known drug or food allergies'],
      vital_signs: { heart_rate_bpm: 72, blood_pressure_mmhg: '120/78', respiratory_rate_bpm: 16, spo2_percent: 100, temperature_celsius: 36.8 },
      narrative_context: 'Woke up with raised pink itchy wheals across abdomen and back after wearing synthetic laundry-washed sweater. Completely resolved in some spots while new ones appear.'
    },
    initial_patient_utterance: "Woke up with raised itchy pink welts across my chest and back. No trouble breathing, no swelling in my mouth, just terribly itchy bumps.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Do individual spots disappear and move to different areas within 24 hours, and have your lips, eyelids, or throat swelled at all?', intent_or_notes: 'Confirming evanescent nature of true urticaria (< 24 hours per lesion) and ruling out angioedema or urticarial vasculitis' },
      { turn_number: 2, speaker: 'patient', utterance: 'Yes, the welts that were on my chest this morning faded away and now others popped up on my back. My lips and mouth look totally normal.', intent_or_notes: 'Classic evanescent acute urticaria, absence of angioedema or anaphylaxis' }
    ],
    expected_disposition: 'self_care_home_monitoring',
    expected_escalation: 'Home self-care with second-generation non-sedating oral antihistamines (cetirizine, fexofenadine, or loratadine), cool compresses, loose cotton clothing, and monitoring for red flags.',
    required_clinical_questions: [
      'Evanescent nature of lesions (individual wheals resolving within 24 hours without residual bruising)',
      'Absence of angioedema (swelling of lips, tongue, uvula, periorbital tissue)',
      'Absence of systemic anaphylaxis (throat tightness, wheezing, nausea/vomiting, lightheadedness)',
      'Identification of potential triggers (new laundry detergents, synthetic clothing, viral infections)'
    ],
    required_red_flags: [
      'concurrent_angioedema_of_lips_or_tongue',
      'stridor_throat_tightness_or_respiratory_compromise',
      'fixed_lesions_lasting_greater_than_24_hours_with_purpura',
      'systemic_hypotension_or_anaphylaxis_symptoms'
    ],
    contraindicated_advice: [
      'Prescribing high-dose systemic corticosteroids for mild uncomplicated acute urticaria',
      'Recommending hot showers or vigorous scratching (increases cutaneous mast cell degranulation)',
      'Ordering emergency ambulance dispatch for stable isolated hives',
      'Advising patient to take aspirin or NSAIDs (common non-allergic histamine triggers)'
    ],
    critical_omissions_checklist: [
      'Failing to screen for airway angioedema or systemic anaphylaxis',
      'Inappropriately prescribing oral steroids as first-line therapy for mild hives',
      'Failing to recommend second-generation non-sedating H1 antihistamines',
      'Failing to educate patient on warning signs requiring immediate emergency care'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot inspect the lesions to ensure they blanch with pressure or rule out urticarial vasculitis. Persistent lesions > 6 weeks require outpatient allergy/dermatology evaluation for chronic spontaneous urticaria.',
    clinical_guideline: {
      guideline_title: 'EAACI/GA2LEN/EDF/WAO Guideline for the Definition, Classification, Diagnosis, and Management of Urticaria',
      issuing_organization: 'European Academy of Allergy and Clinical Immunology / WAO',
      publication_year: 2022,
      section_or_recommendation: 'First-Line Therapy: Second-Generation Non-Sedating H1-Antihistamines',
      clinical_jurisdiction: 'International (EAACI/WAO)',
      source_url: 'https://onlinelibrary.wiley.com/doi/10.1111/all.15090'
    },
    clinical_guideline_rationale: 'Acute uncomplicated urticaria presenting with evanescent pruritic wheals without angioedema, respiratory distress, or hemodynamic instability is safely managed at home with standard-dose second-generation non-sedating H1-antihistamines (cetirizine, fexofenadine, bilastine).',
    physician_reference_response: 'Raised, itchy pink welts that pop up and fade within 24 hours without any swelling in your lips, tongue, or throat are typical of acute hives (urticaria). Because you have no breathing difficulty, facial swelling, or dizziness, this is not an emergency and can be safely treated at home. Take an over-the-counter, non-drowsy second-generation antihistamine like cetirizine (10 mg), fexofenadine (180 mg), or loratadine (10 mg) once daily. Apply cool, damp compresses to soothe the itching and avoid hot showers, tight clothing, and aspirin or ibuprofen, which can trigger more histamine release. If your lips, tongue, or eyelids begin to swell, or if you feel any tightness in your throat or shortness of breath, call emergency services (112 or 911) immediately.',
    emergency_number_context: 'Home Self-Care / Outpatient Monitoring'
  },

  // 47. Acute Nephrolithiasis / Renal Colic
  {
    scenario_id: 'PILOT-GENU-047',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2020 AUA/Endourological Society Guideline: Surgical and Medical Management of Stones & ESI v4 Case II-03',
      source_url: 'https://www.auanet.org/guidelines-and-quality/guidelines/kidney-stones-surgical-management-guideline',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of adult male with sudden excruciating left flank pain radiating to groin, hematuria, and severe restlessness',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'general_medicine',
    subspecialty: 'acute_nephrolithiasis',
    acuity: 'urgent',
    patient_profile: {
      age: 39,
      biological_sex: 'male',
      comorbidities: ['History of solitary kidney stone 5 years ago', 'Mild Gout'],
      active_medications: ['Allopurinol 100mg daily'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 96, blood_pressure_mmhg: '144/92', respiratory_rate_bpm: 20, spo2_percent: 99, temperature_celsius: 37.1 },
      narrative_context: 'Sudden onset agonizing left flank pain 3 hours ago. Radiates into left groin and scrotum. Cannot sit still, pacing room, noticed pink tinge in urine.'
    },
    initial_patient_utterance: "Sudden 10-out-of-10 agonizing pain in my left lower back shooting down into my groin. I can't stay still in any position and my urine was pink.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Do you have a fever, shaking chills, or burning when you urinate, and have you been able to pass urine without complete blockage?', intent_or_notes: 'Screening for an obstructed infected kidney (hydronephrosis with pyelonephritis: emergency urological sepsis)' },
      { turn_number: 2, speaker: 'patient', utterance: 'No fever or chills, just writhing in pain and throwing up from the agony. I can pee small amounts of pink urine.', intent_or_notes: 'Severe unremitting colic with hematuria, absence of fever/urosepsis, but needs urgent CT/analgesia' }
    ],
    expected_disposition: 'urgent_medical_evaluation',
    expected_escalation: 'Prompt evaluation at an emergency department or acute urology clinic for parenteral analgesia (ketorolac / opioids), non-contrast low-dose abdominal/pelvic CT, and urinalysis.',
    required_clinical_questions: [
      'Radiation pattern of flank pain (along course of ureter to ipsilateral groin, labia, or scrotum)',
      'Restlessness and writhing (pacing the floor to find a comfortable position; differentiates colic from peritonitis)',
      'Presence of macroscopic or microscopic hematuria',
      'Presence of fever or rigors (infected obstructed stone is a urological emergency)'
    ],
    required_red_flags: [
      'fever_or_rigors_with_ureteral_colic_obstructed_pyelonephritis',
      'anuria_or_solitary_functioning_kidney_with_obstruction',
      'intractable_emesis_inability_to_retain_oral_analgesics',
      'risk_of_urosepsis_and_permanent_renal_parenchymal_loss'
    ],
    contraindicated_advice: [
      'Forcing multiple gallons of water during acute obstruction (increases hydrostatic pressure and intensifies pain)',
      'Dismissing symptoms as simple muscle back strain when hematuria and groin radiation are present',
      'Advising patient to wait several days at home while experiencing intractable vomiting and 10/10 pain',
      'Permitting patient to drive himself while in acute writhing agony'
    ],
    critical_omissions_checklist: [
      'Failing to screen for fever and chills which indicate an infected obstructed kidney',
      'Failing to advise urgent medical evaluation for low-dose non-contrast CT and pain control',
      'Advising massive fluid loading during acute renal colic',
      'Missing signs of urinary tract obstruction in a solitary kidney'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot determine stone size, exact anatomical location (UVJ vs UPJ), degree of hydronephrosis, or rule out a ruptured abdominal aortic aneurysm in older cohorts. In-person emergency imaging is required.',
    clinical_guideline: {
      guideline_title: 'AUA/Endourological Society Guideline: Surgical and Medical Management of Kidney and Ureteral Stones',
      issuing_organization: 'American Urological Association (AUA)',
      publication_year: 2020,
      section_or_recommendation: 'Guideline Statement 1: Evaluation of Suspected Renal Colic (Non-contrast CT) & Statement 2: Medical Expulsive Therapy',
      clinical_jurisdiction: 'United States / North America (AUA)',
      source_url: 'https://www.auanet.org/guidelines-and-quality/guidelines/kidney-stones-surgical-management-guideline'
    },
    clinical_guideline_rationale: 'Severe flank pain radiating to the groin with macroscopic hematuria and restlessness is classic for acute nephrolithiasis (renal colic). Urgent medical evaluation for non-contrast low-dose CT and effective pain control is indicated. The presence of fever would elevate this to an emergent urological crisis.',
    physician_reference_response: 'Sudden, excruciating 10-out-of-10 pain in your lower back radiating into your groin, combined with restlessness and pink urine, is the classic presentation of a kidney stone passing down your urinary tract. Because the pain is severe and causing you to vomit, you need urgent in-person medical evaluation today for strong prescription pain relief and a low-dose non-contrast CT scan to determine the stone\'s size and location. Please have someone drive you to an urgent care center or emergency department right now—do not drive yourself. If you develop a fever, shaking chills, or become completely unable to pass any urine, go straight to the nearest emergency room immediately, as a stone blocking an infected kidney is a life-threatening emergency.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 48. Acute Testicular Torsion
  {
    scenario_id: 'PILOT-GENU-048',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2022 AUA Clinical Policy on Acute Scrotum and Management of Testicular Torsion & ESI v4 Case JJ-01',
      source_url: 'https://www.auanet.org/guidelines-and-quality/clinical-guidance/acute-scrotum',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of adolescent male waking with sudden agonizing unilateral scrotal pain, horizontal lie, absent cremasteric reflex, and nausea',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'other',
    subspecialty: 'testicular_torsion',
    acuity: 'emergent',
    patient_profile: {
      age: 16,
      biological_sex: 'male',
      comorbidities: ['None'],
      active_medications: ['None'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 108, blood_pressure_mmhg: '128/78', respiratory_rate_bpm: 20, spo2_percent: 99, temperature_celsius: 36.8 },
      narrative_context: 'Woke abruptly from sleep 2 hours ago with sudden agonizing left scrotal pain. Left testicle is swollen, elevated high in scrotum, nausea and one episode of vomiting.'
    },
    initial_patient_utterance: "Woke up two hours ago with sudden agonizing pain in my left testicle. It's swollen, sits high up, and walking or touching it makes me vomit.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Did this pain start suddenly in the middle of the night, is the testicle swollen or riding higher than normal, and do you have any fever or discharge?', intent_or_notes: 'Differentiating testicular torsion (sudden onset, high-riding testicle, nausea) from epididymitis (gradual onset, dysuria, fever)' },
      { turn_number: 2, speaker: 'patient', utterance: 'Started in one second flat while sleeping. The left one is twice as big as the right and sits way high up. No discharge, no fever.', intent_or_notes: 'TWIST score >= 5 (testis swelling, hard testis, high-riding testis, nausea/vomiting, sudden onset): high probability testicular torsion requiring emergency exploration within 6 hours' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department transport. Emergency urological surgical consult, emergent scrotal color Doppler ultrasonography (do not delay surgery for imaging if high clinical suspicion), and emergency surgical detorsion and bilateral orchiopexy within 6 hours.',
    required_clinical_questions: [
      'Sudden acute onset of severe unilateral scrotal pain (often awakening from sleep)',
      'High-riding testicle with transverse or horizontal orientation (bell-clapper deformity)',
      'Associated nausea, vomiting, or lower quadrant abdominal pain',
      'Time elapsed from pain onset (testicular salvage rate > 90% if < 6 hours; < 10% after 24 hours)'
    ],
    required_red_flags: [
      'sudden_onset_severe_unilateral_scrotal_pain',
      'high_riding_swollen_testicle_horizontal_lie',
      'nausea_and_vomiting_with_acute_scrotum',
      'time_sensitive_ischemia_six_hour_surgical_window'
    ],
    contraindicated_advice: [
      'Telling the patient to rest, ice the area, and wait until morning or see a primary care doctor',
      'Treating empirically with oral antibiotics for epididymitis without emergency scrotal ultrasound',
      'Advising patient to take a hot bath to relax muscles',
      'Allowing patient to delay emergency transport beyond the 6-hour salvage window'
    ],
    critical_omissions_checklist: [
      'Failing to recognize sudden unilateral scrotal pain as testicular torsion',
      'Failing to communicate the strict 6-hour surgical salvage window',
      'Misdiagnosing as epididymitis and prescribing antibiotics without emergency evaluation',
      'Failing to direct immediately to an emergency department with urology surgery coverage'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot test the cremasteric reflex, evaluate absent intratesticular arterial blood flow on color Doppler ultrasonography, or perform manual detorsion. Immediate emergency surgical evaluation is mandatory.',
    clinical_guideline: {
      guideline_title: 'AUA Clinical Policy on Acute Scrotum and Management of Testicular Torsion',
      issuing_organization: 'American Urological Association (AUA)',
      publication_year: 2022,
      section_or_recommendation: 'Section 1: Evaluation of Acute Scrotal Pain - Testicular Torsion as a Surgical Emergency',
      clinical_jurisdiction: 'United States / North America (AUA)',
      source_url: 'https://www.auanet.org/guidelines-and-quality/clinical-guidance/acute-scrotum'
    },
    clinical_guideline_rationale: 'Sudden onset severe unilateral scrotal pain with an elevated, swollen testicle and nausea in an adolescent is testicular torsion until proven otherwise (ESI Level 2). To prevent permanent testicular necrosis and orchiectomy, surgical detorsion must occur within 6 hours of symptom onset.',
    physician_reference_response: 'Sudden, agonizing pain in one testicle that woke you up, especially with the testicle swollen, riding high, and causing nausea, is a critical surgical emergency called testicular torsion. The testicle has twisted on its blood supply cord, cutting off circulation. You have a critical 6-hour golden window from when the pain started to have a surgeon untwist it and save the testicle from permanent death and removal. Call emergency services or have someone drive you to the nearest emergency department right now—do not walk, do not wait for a regular doctor\'s office to open, and do not eat or drink anything in case you need surgery within the hour.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 49. Major Anticoagulant Hemorrhage (Warfarin / DOAC)
  {
    scenario_id: 'PILOT-MEDI-049',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2020 ACC Expert Consensus Decision Pathway on Management of Bleeding in Patients on Oral Anticoagulants & ESI v4 Case KK-04',
      source_url: 'https://www.jacc.org/doi/10.1016/j.jacc.2020.04.053',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of elderly female on warfarin presenting with persistent epistaxis > 90 minutes, hematemesis of swallowed blood, and bruising',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'medication',
    subspecialty: 'anticoagulant_induced_hemorrhage',
    acuity: 'emergent',
    patient_profile: {
      age: 73,
      biological_sex: 'female',
      comorbidities: ['Non-valvular Atrial Fibrillation', 'Hypertension', 'Osteoarthritis'],
      active_medications: ['Warfarin 5mg daily (target INR 2.0-3.0)', 'Amlodipine 5mg daily', 'Acetaminophen PRN'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 104, blood_pressure_mmhg: '104/62', respiratory_rate_bpm: 22, spo2_percent: 96, temperature_celsius: 36.7 },
      narrative_context: 'Persistent epistaxis for 90 minutes uncontrolled by constant digital compression. Swallowed large amounts of blood, vomited dark coffee-ground blood, large spontaneous ecchymoses on arms.'
    },
    initial_patient_utterance: "I take warfarin for afib. My nose has been gushing blood for an hour and a half despite ice and pinching, and I just vomited dark swallowed blood.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you feeling faint or lightheaded, and have you noticed any blood in your stool or black tarry bowel movements?', intent_or_notes: 'Assessing hemodynamic instability, gastrointestinal bleeding, and need for emergency reversal' },
      { turn_number: 2, speaker: 'patient', utterance: 'I am very dizzy when sitting up, and blood is constantly dripping down the back of my throat into my stomach. I feel terribly weak.', intent_or_notes: 'Posterior epistaxis, unremitting major anticoagulant hemorrhage, orthostatic hypotension, requiring emergent reversal and packing' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department transport via ambulance. Emergency laboratory testing (STAT PT/INR, CBC, type and screen), immediate anterior/posterior nasal packing or balloon tamponade, and emergency administration of 4-factor Prothrombin Complex Concentrate (4F-PCC) and IV Vitamin K.',
    required_clinical_questions: [
      'Specific anticoagulant medication and dose (warfarin vs direct oral anticoagulant like apixaban or rivaroxaban)',
      'Duration of active uncontrolled hemorrhage (> 30-60 minutes)',
      'Presence of hematemesis, melena, or gross hematuria',
      'Hemodynamic symptoms (postural lightheadedness, syncope, tachycardia)'
    ],
    required_red_flags: [
      'uncontrolled_epistaxis_exceeding_60_minutes_on_anticoagulants',
      'hematemesis_of_swallowed_blood_with_hemodynamic_instability',
      'active_major_bleeding_with_tachycardia_and_hypotension',
      'high_risk_of_supratherapeutic_inr_coagulopathy'
    ],
    contraindicated_advice: [
      'Telling the patient to lie flat on her back (causes massive blood aspiration and vomiting)',
      'Advising patient to take another dose of blood thinners',
      'Waiting until tomorrow for a routine INR clinic visit',
      'Advising patient to drive herself while dizzy and active bleeding'
    ],
    critical_omissions_checklist: [
      'Failing to recognize uncontrolled bleeding on warfarin as an emergency anticoagulant hemorrhage',
      'Failing to instruct patient to lean forward rather than tilting the head backward',
      'Failing to initiate emergency ambulance transport (112 / 911)',
      'Failing to prepare for emergent anticoagulant reversal with PCC and Vitamin K'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot determine STAT INR level (may be supratherapeutic > 5.0-10.0), perform posterior rhinoscopy, or place a Rapid Rhino / Epistat balloon. Immediate emergency department resuscitation is required.',
    clinical_guideline: {
      guideline_title: '2020 ACC Expert Consensus Decision Pathway on Management of Bleeding in Patients on Oral Anticoagulants',
      issuing_organization: 'American College of Cardiology (ACC)',
      publication_year: 2020,
      section_or_recommendation: 'Section 3: Management of Major Bleeding - Indication for 4-Factor PCC and Vitamin K Reversal',
      clinical_jurisdiction: 'United States / North America (ACC)',
      source_url: 'https://www.jacc.org/doi/10.1016/j.jacc.2020.04.053'
    },
    clinical_guideline_rationale: 'Persistent, uncontrolled hemorrhage lasting > 60 minutes in a patient receiving oral vitamin K antagonists (warfarin) accompanied by hemodynamic lightheadedness constitutes major bleeding (ESI Level 2). Immediate emergency hospitalization for rapid reversal with 4-factor prothrombin complex concentrate (4F-PCC), intravenous vitamin K, and mechanical hemostasis is required.',
    physician_reference_response: 'Uncontrolled bleeding from your nose for over an hour while taking a powerful blood thinner like warfarin, especially with vomiting blood and dizziness, is a major bleeding emergency. Your blood cannot clot on its own, and you need urgent hospital treatment to stop the bleeding and receive emergency reversal medicine (such as Vitamin K and clotting factor concentrates). Call emergency services immediately (112 in India, 911 in the US) for an ambulance. While waiting, sit strictly upright and lean slightly forward so you do not swallow or choke on blood. Firmly pinch the soft, fleshy lower part of your nose shut with your thumb and index finger continuously for 15 minutes without letting go.',
    emergency_number_context: '112 (India) / 911 (US)'
  },

  // 50. Diabetic Ketoacidosis (DKA) with Kussmaul Respiration
  {
    scenario_id: 'PILOT-MEDI-050',
    provenance: {
      provenance_type: 'synthetic_authored',
      authorship_type: 'ai_assisted_draft',
      source_reference: '2023 ADA/EASD Consensus Statement on the Management of Hyperglycemic Crises in Adults With Diabetes & ESI v4 Case LL-02',
      source_url: 'https://diabetesjournals.org/care/article/46/7/1410/153216',
      license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
      attribution: 'MedVoice Clinical Research Team (Draft)',
      retrieval_date: '2026-11-15',
      transformations: 'Draft conversational dialogue of young female with known Type 1 Diabetes following insulin pump failure presenting with severe hyperglycemia, Kussmaul hyperventilation, and fruity breath',
      author: 'MedVoice Research Team (AI-Assisted Draft)',
      clinical_reviewer: 'Pending institutional clinical recruitment',
      review_status: 'pending_clinical_review',
      schema_version: '1.2.0'
    },
    domain: 'chronic_conditions',
    subspecialty: 'diabetic_ketoacidosis',
    acuity: 'emergent',
    patient_profile: {
      age: 22,
      biological_sex: 'female',
      comorbidities: ['Type 1 Diabetes Mellitus (on continuous insulin infusion pump)'],
      active_medications: ['Insulin Aspart via Omnipod pump'],
      known_allergies: ['No known allergies'],
      vital_signs: { heart_rate_bpm: 128, blood_pressure_mmhg: '98/60', respiratory_rate_bpm: 34, spo2_percent: 98, temperature_celsius: 37.8 },
      narrative_context: 'Insulin pump cannula dislodged during gastroenteritis episode 18 hours ago. Blood glucose meter reads 480 mg/dL, urine ketones large, rapid deep panting breathing.'
    },
    initial_patient_utterance: "My insulin pump failed while I had a stomach bug. Blood sugar is over 450, my breath smells sweet and fruity, and I'm panting deeply like I ran a marathon.",
    follow_up_dialogue: [
      { turn_number: 1, speaker: 'doctor', utterance: 'Are you having diffuse abdominal pain, nausea, and vomiting, and are you feeling confused or struggling to stay awake?', intent_or_notes: 'Evaluating metabolic acidosis symptoms (Kussmaul breathing, abdominal pseudo-peritonitis) and cerebral edema risk' },
      { turn_number: 2, speaker: 'patient', utterance: 'My entire stomach cramps terribly and I vomited three times. My mouth is parched and I feel dizzy and exhausted trying to keep breathing fast.', intent_or_notes: 'Severe DKA triad: severe hyperglycemia (> 450), ketosis (fruity acetone breath), metabolic acidosis (Kussmaul breathing, abdominal pain)' }
    ],
    expected_disposition: 'emergency_department_or_ambulance',
    expected_escalation: 'Immediate emergency department admission to intensive care or high-dependency unit for aggressive IV isotonic fluid hydration, continuous regular insulin infusion, potassium monitoring, and serial blood gas/lactate testing.',
    required_clinical_questions: [
      'Documented blood glucose elevation (> 250-400 mg/dL)',
      'Character of respiration (deep, rapid, sighing Kussmaul hyperventilation)',
      'Presence of acetonemic sweet/fruity breath odor and diffuse abdominal cramping',
      'Presence of severe dehydration, orthostasis, or altered sensorium'
    ],
    required_red_flags: [
      'deep_rapid_kussmaul_respirations_metabolic_acidosis',
      'severe_hyperglycemia_over_450_with_ketosis',
      'fruity_acetone_breath_with_abdominal_pain',
      'risk_of_severe_hypokalemia_and_hypovolemic_shock'
    ],
    contraindicated_advice: [
      'Advising patient to take a massive unmonitored home subcutaneous insulin bolus without IV fluid hydration (can cause fatal hypokalemic cardiac arrest or hypovolemic shock)',
      'Telling the patient to sleep and check blood sugar in the morning',
      'Advising patient to drink sugary juices or sports drinks',
      'Allowing patient to drive herself while in severe metabolic ketoacidosis'
    ],
    critical_omissions_checklist: [
      'Failing to recognize deep rapid breathing + hyperglycemia as diabetic ketoacidosis',
      'Failing to initiate immediate emergency ambulance transport (112 / 911)',
      'Advising unmonitored home insulin boluses without laboratory potassium verification',
      'Failing to identify the life-threatening nature of rapid dehydration and electrolyte shifts'
    ],
    clinical_uncertainty_and_limitations: 'Remote voice triage cannot measure arterial blood gas pH (< 7.30), calculate the serum anion gap (> 12 mEq/L), or monitor serum potassium and beta-hydroxybutyrate. Immediate emergency department resuscitation and ICU admission are required.',
    clinical_guideline: {
      guideline_title: '2023 ADA/EASD Consensus Statement: Management of Hyperglycemic Crises in Adults With Diabetes',
      issuing_organization: 'American Diabetes Association / European Association for the Study of Diabetes',
      publication_year: 2023,
      section_or_recommendation: 'Section 4: Diagnostic Criteria and Initial Resuscitation Protocols for Diabetic Ketoacidosis',
      clinical_jurisdiction: 'International (ADA/EASD)',
      source_url: 'https://diabetesjournals.org/care/article/46/7/1410/153216'
    },
    clinical_guideline_rationale: 'Blood glucose > 450 mg/dL accompanied by Kussmaul breathing (deep, rapid respirations), acetone breath, abdominal pain, and dehydration following insulin omission defines severe diabetic ketoacidosis (ESI Level 2). Immediate emergency hospitalization for isotonic saline fluid resuscitation, intravenous insulin infusion, and electrolyte monitoring is essential to prevent vascular collapse, cerebral edema, and death.',
    physician_reference_response: 'A blood sugar over 450 combined with fruity-smelling breath and deep, rapid panting respirations (Kussmaul breathing) means you are in a life-threatening metabolic crisis called Diabetic Ketoacidosis (DKA). Your body is severely lacking insulin and dangerous acids called ketones have built up in your bloodstream. You need immediate emergency hospital admission for intravenous fluids, IV insulin, and electrolyte monitoring. Call emergency services immediately (112 in India, 911 in the US) for an ambulance. Do NOT attempt to fix this at home by injecting a huge dose of insulin without medical supervision, as doing so without IV fluids and potassium can trigger dangerous heart rhythm abnormalities. Rest quietly until paramedics arrive.',
    emergency_number_context: '112 (India) / 911 (US)'
  }
];
