import { NextResponse } from "next/server";
import { getDoctorById } from "@/config/doctors";
import { clinicalBoard } from "@/lib/agents/clinical-board";
import { extractSpeechFeatures } from "@/lib/acoustic/speech-features";
import { PatientCase, DeliveredTurnRecord } from "@/lib/agents/schemas";
import { PhiScrubber } from "@/lib/security/phi-scrubber";

import { conversationManager } from "@/lib/triage/conversation-manager";
import { clinicalKnowledgeRetriever } from "@/lib/clinical-knowledge/retriever";
import { generateDoctorTurnResponse } from "@/lib/ai/clinical-llm";
import { hospitalRagService } from "@/lib/care-network/hospital-rag";
import { buildProvenanceEvidenceFromClinicalState } from "@/lib/agents/provenance";
import { extractSubfieldState, detectQuestionTargetSlot, controlledFactReconciliationEngine } from "@/lib/triage/clinical-state";
import { evaluatePreArbiter } from "@/lib/triage/pre-arbiter";
import { PatientProfileService } from "@/lib/patient/patient-profile-service";
import { CallerProfile, PatientProfile, AttributedClinicalFact } from "@/lib/clinical-knowledge/types";
import { getAuthContext } from "@/lib/auth/rbac";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { and, eq } from "drizzle-orm";
import { memoryConsultations } from "@/app/api/consultations/route";

import {
  checkRateLimit,
  getClientIp,
  buildRateLimitResponse,
  RESOURCE_LIMITS,
} from "@/lib/security/rate-limiter";

export async function POST(request: Request) {
  const startTime = performance.now();
  let redactionCount = 0;
  let phiVault = new Map<string, string>();

  try {
    // 1. Abuse Protection: Rate limit per client IP
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(
      `voice_chat:${clientIp}`,
      RESOURCE_LIMITS.VOICE_CHAT_RATE_LIMIT_PER_MINUTE,
      60000
    );
    if (!rateLimit.allowed) {
      return buildRateLimitResponse(rateLimit, "/api/voice/chat");
    }

    // 2. Authoritative Session Identity: Server-side resolution only (never trust body.userId)
    const auth = await getAuthContext(request);
    const effectiveUserId = auth.userId === "unauthenticated" && auth.isDemoMode
      ? "anon-user"
      : auth.userId;

    const body = await request.json();
    const {
      doctorId = "dr-sarah-chen",
      message = "",
      conversationHistory = [],
      patientName = "Patient",
      patientAge,
      patientId: requestedPatientId,
      patientRelationship,
      encounterId: rawEncounterId,
      consultationId,
      // body.patientProfile and body.userId are intentionally discarded to enforce tenant isolation
      audioMetrics,
      isInterruption = false,
      interruptedAgent = "",
      userLocation,
      locationPermission,
    } = body;
    const encounterId = rawEncounterId || consultationId;

    // 2. Abuse Protection: Enforce strict payload constraints before expensive AI reasoning
    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message is required and must be text." }, { status: 400 });
    }

    if (message.length > RESOURCE_LIMITS.VOICE_CHAT_MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        {
          error: `Message exceeds maximum allowed length of ${RESOURCE_LIMITS.VOICE_CHAT_MAX_MESSAGE_CHARS} characters.`,
          code: "PAYLOAD_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    if (Array.isArray(conversationHistory) && conversationHistory.length > RESOURCE_LIMITS.VOICE_CHAT_MAX_HISTORY_ITEMS) {
      return NextResponse.json(
        {
          error: `Conversation history exceeds maximum allowed limit of ${RESOURCE_LIMITS.VOICE_CHAT_MAX_HISTORY_ITEMS} turns.`,
          code: "PAYLOAD_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    // 2b. Zero-Trust PHI De-Identification before external LLMs, acoustic models, or debug logs
    const scrubResult = PhiScrubber.scrub(message, patientName);
    const cleanMsg = scrubResult.sanitizedText.trim();
    const cleanMsgLower = cleanMsg.toLowerCase();
    redactionCount = scrubResult.redactionCount;
    phiVault = scrubResult.vault as Map<string, string>;

    const sanitizedConversationHistory = Array.isArray(conversationHistory)
      ? conversationHistory.map((item: any) => ({
          ...item,
          text: typeof item.text === "string" ? PhiScrubber.scrub(item.text, patientName).sanitizedText : item.text,
        }))
      : [];

    const buildJsonResponse = (payload: any, status = 200) => {
      const headers = new Headers();
      headers.set("x-fast-loop-latency-ms", String(Math.round(performance.now() - startTime)));
      headers.set("x-phi-redactions", String(redactionCount));
      if (payload && payload.doctorReply) {
        payload.doctorReply = PhiScrubber.rehydrate(payload.doctorReply, phiVault);
      }
      return NextResponse.json(payload, { status, headers });
    };

    const doctor = getDoctorById(doctorId);

    // P0 SAFETY CHECK: Red-flag scan on incoming utterance MUST execute BEFORE greeting or acknowledgment shortcuts!
    // Ensures utterances like "ok but my chest hurts now" or "hi having chest pain" immediately enter emergency escalation.
    const preCheck = evaluatePreArbiter({
      transcript: cleanMsg,
      speech_features: body.speechFeatures,
      demographics: {
        age: body.interviewState?.patientDemographics?.age,
        age_group: (body.interviewState?.patientDemographics?.age_group || "unknown") as any,
      },
    });

    const hasRedFlagOnCurrentUtterance = preCheck.immediate_danger || (preCheck.pre_safety_flags && preCheck.pre_safety_flags.length > 0);

    // Only allow greeting, thank-you, or acknowledgment short-circuit when NO red flags exist on current utterance
    if (!hasRedFlagOnCurrentUtterance) {
      const isGreeting =
        /^(hello|hi|hey|good\s+(morning|afternoon|evening)|can\s+you\s+hear\s+me|testing|greetings)[.!?\s]*$/i.test(cleanMsgLower);

      const isPureThankYou =
        /^(?:thank\s+you|thanks)(?:\s+(?:doctor|dr\b|chen|vance|rostova|pendelton|bennett|so\s+much|a\s+lot))?[.!?\s]*$/i.test(cleanMsgLower) ||
        /^(?:bye|goodbye|take\s+care)[.!?\s]*$/i.test(cleanMsgLower);

      const isPureAcknowledgment =
        /^(?:ok(?:ay)?|got\s+it|understood|sure|alright|fine|sounds\s+good|cool)(?:\s+(?:doctor|dr\b|chen|vance|rostova|pendelton|bennett|thanks|thank\s+you))?[.!]?$/i.test(cleanMsgLower);

      if (isGreeting) {
        const greetingReplies: Record<string, string> = {
          "dr-sarah-chen": "Hello! I'm Dr. Sarah Chen, Chief of Internal Medicine. I can hear you clearly. What symptoms or medical concerns brought you in today?",
          "dr-marcus-vance": "Hello, I'm Dr. Marcus Vance, Senior Cardiologist. I'm listening closely. Please describe any chest discomfort, palpitations, or symptoms you're feeling.",
          "dr-elena-rostova": "Hello! I'm Dr. Elena Rostova, Consultant Pediatrician. How can I assist you or your family today?",
          "dr-arthur-pendelton": "Good day, I'm Dr. Arthur Pendelton in Neurology. How are you feeling today, and what symptoms would you like us to evaluate?",
          "dr-anna-bennett": "Hello, I'm Dr. Anna Bennett, Consultant Dermatologist. Please tell me about any symptoms, skin changes, or reactions you're experiencing."
        };
        const doctorGreeting = greetingReplies[doctor.id] || `Hello! I'm ${doctor.name}. I'm here and ready to help. What symptoms are you experiencing?`;

        return buildJsonResponse({
          doctorReply: doctorGreeting,
          doctor: {
            id: doctor.id,
            name: doctor.name,
            specialty: doctor.specialty,
            avatarUrl: doctor.avatarUrl,
            voiceGender: doctor.voiceGender,
            voiceId: doctor.voiceId,
          },
          phase: "greeting",
          board: null,
          speech_features: null,
          triage: null
        });
      }

      if (isPureThankYou || (isPureAcknowledgment && (body.interviewState?.phase === "decided" || body.interviewState?.phase === "closing"))) {
        const isEmergencyDecided = body.interviewState?.informationState === "emergency_preempted" ||
          body.interviewState?.slots?.known_facts?.some((f: string) => /EMERGENCY|ESI LEVEL [12]|CRITICAL/i.test(f));

        const closingDoctorReply = isEmergencyDecided
          ? "Please remember this requires urgent emergency medical evaluation. If you haven't already, please call 112 or 108 immediately or have someone take you to the nearest emergency department right now. Do not wait."
          : "You're very welcome! Please don't hesitate to reach back out if your symptoms change or worsen. Take care and stay safe.";

        return buildJsonResponse({
          doctorReply: closingDoctorReply,
          doctor: {
            id: doctor.id,
            name: doctor.name,
            specialty: doctor.specialty,
            avatarUrl: doctor.avatarUrl,
            voiceGender: doctor.voiceGender,
            voiceId: doctor.voiceId,
          },
          phase: "closing",
          interviewState: body.interviewState,
          board: null,
          speech_features: null,
          triage: null
        });
      }
    }

    // Cumulative patient utterances for comprehensive clinical context (filtering out raw greetings)
    const patientHistory = sanitizedConversationHistory
      .filter((m: any) => m.role === "patient" || m.role === "user")
      .map((m: any) => (m.text || m.content || "").trim())
      .filter((t: string) => t.length > 0 && !/^(hello|hi|hey|good\s+(morning|afternoon|evening)|can\s+you\s+hear\s+me)[.!?\s]*$/i.test(t));
    
    const allUtterances = [...patientHistory, cleanMsg];
    // Remove exact duplicate phrases from consecutive submissions
    const uniqueUtterances = allUtterances.filter((u, i) => allUtterances.indexOf(u) === i);
    const cumulativeTranscript = uniqueUtterances.join(". ");

    // 1. Extract measured speech features & paralinguistics
    const speechFeatures = extractSpeechFeatures({
      transcriptText: message,
      durationMs: audioMetrics?.durationMs,
      pauseCount: audioMetrics?.pauseCount,
      totalPauseDurationMs: audioMetrics?.totalPauseDurationMs,
      wordCount: audioMetrics?.wordCount,
      energyVariance: audioMetrics?.energyVariance,
      pitchVariance: audioMetrics?.pitchVariance,
      meanF0Hz: audioMetrics?.meanF0Hz,
      speechPauseRatio: audioMetrics?.speechPauseRatio,
      meanPauseDurationMs: audioMetrics?.meanPauseDurationMs,
      isLiveDsp: audioMetrics?.isLiveDsp,
    });

    // Resolve target patient profile strictly scoped to authenticated user
    let activeProfile: PatientProfile | null = null;
    let inferredSubject: "self" | "mother" | "child" | "third_party" = "self";

    if (effectiveUserId !== "unauthenticated") {
      const resolved = await PatientProfileService.resolveTargetPatientProfile(
        effectiveUserId,
        cleanMsg,
        requestedPatientId,
        patientRelationship
      );
      // Double check tenant isolation: profile must strictly belong to authenticated user
      if (resolved.profile && resolved.profile.userId === effectiveUserId) {
        activeProfile = resolved.profile;
      }
      inferredSubject = resolved.inferredSubject;
    }

    let ageNum: number | null = null;
    let ageSource: "patient_reported" | "profile" | "unknown" = "unknown";
    let ageGroup: "infant" | "pediatric" | "adult" | "geriatric" | "unknown" = "unknown";

    if (patientAge && !isNaN(parseInt(patientAge, 10))) {
      ageNum = parseInt(patientAge, 10);
      ageSource = "profile";
      ageGroup = ageNum < 1 ? "infant" : ageNum < 18 ? "pediatric" : ageNum > 65 ? "geriatric" : "adult";
    } else if (activeProfile?.age != null && !isNaN(activeProfile.age) && activeProfile.age >= 0) {
      ageNum = activeProfile.age;
      ageSource = "profile";
      ageGroup = ageNum < 1 ? "infant" : ageNum < 18 ? "pediatric" : ageNum > 65 ? "geriatric" : "adult";
    } else {
      // Check if age was explicitly reported in cumulative transcript, e.g. "I am 32 years old", "my 4-year-old"
      const ageMatch = cumulativeTranscript.match(/\b(?:i(?:'m| am)|patient is|aged?)\s+(\d{1,3})\s*(?:years?|yrs?|yo)?\b/i);
      if (ageMatch && parseInt(ageMatch[1], 10) > 0 && parseInt(ageMatch[1], 10) < 120) {
        ageNum = parseInt(ageMatch[1], 10);
        ageSource = "patient_reported";
        ageGroup = ageNum < 1 ? "infant" : ageNum < 18 ? "pediatric" : ageNum > 65 ? "geriatric" : "adult";
      } else {
        const isInfant = /\b(newborn|neonate|infant|baby|\d+\s*-(?:week|month|day)-old|\d+\s+(?:weeks?|months?|days?)\s+old)\b/i.test(cumulativeTranscript);
        if (isInfant) {
          ageNum = 0;
          ageSource = "patient_reported";
          ageGroup = "infant";
        } else {
          ageNum = null;
          ageSource = "unknown";
          ageGroup = "unknown";
        }
      }
    }

    // 2. Server-Authoritative State Resolution:
    // If encounterId is provided, query authoritative state from primary datastore / memory store,
    // falling back to client-provided body.interviewState only if no server state exists yet.
    let authoritativeInterviewState = body.interviewState;
    if (encounterId && effectiveUserId !== "unauthenticated") {
      const dbClient = getDb();
      if (dbClient) {
        try {
          const existingEncounter = await dbClient
            .select()
            .from(consultationsTable)
            .where(
              auth.role === "admin"
                ? eq(consultationsTable.id, encounterId)
                : and(eq(consultationsTable.id, encounterId), eq(consultationsTable.userId, effectiveUserId))
            )
            .limit(1);
          if (existingEncounter.length > 0 && existingEncounter[0].interviewState) {
            authoritativeInterviewState = existingEncounter[0].interviewState as any;
          }
        } catch (fetchErr) {
          console.warn("[VoiceChat] Server encounter state fetch notice:", fetchErr);
        }
      } else {
        const memEncounter = memoryConsultations.find(
          c => c.id === encounterId && (c.userId === effectiveUserId || auth.role === "admin" || effectiveUserId === "anon-user")
        );
        if (memEncounter && memEncounter.interviewState) {
          authoritativeInterviewState = memEncounter.interviewState;
        }
      }
    }

    // Stateful Clinical Conversation Manager Turn Execution
    // Invariant: Do not default unknown age to "adult" — preserve "unknown" so pediatric checks are not bypassed
    const turnResult = await conversationManager.processTurn(
      cleanMsg,
      authoritativeInterviewState,
      {
        age: ageNum ?? undefined,
        age_group: ageGroup,
        age_source: ageSource
      },
      undefined,
      { patientProfile: activeProfile || undefined }
    );

    const knownFactsCount = turnResult.state.slots.known_facts.length;
    const slots = turnResult.state.slots;
    const hasAnySymptoms = knownFactsCount > 0 || Boolean(slots.character || slots.onset);

    // Domain detection
    const isThroat = /\b(throat|swallow)\b/i.test(turnResult.state.cumulativeTranscript) ||
      turnResult.state.slots.known_facts.some(f => /throat/i.test(f));
    const isChest = /\b(chest|heart|sternum|angina)\b/i.test(turnResult.state.cumulativeTranscript) ||
      Boolean(slots.character || slots.location === "chest");
    const isNeuro = /\b(headache|dizz|droop|weak|speech)\b/i.test(turnResult.state.cumulativeTranscript) ||
      slots.neurological_signs.length > 0;

    const subfields = extractSubfieldState(slots, turnResult.state.slots.known_facts, turnResult.state.conversationMemory);

    let calculatedMissingDims: string[] = [];
    if (!hasAnySymptoms) {
      calculatedMissingDims = [
        "Symptoms & chief complaint",
        "Onset & timeline",
        "Course & progression",
        "Character & severity",
        "Associated symptoms",
      ];
    } else if (isThroat) {
      if (!subfields.onset.isResolved) {
        if (subfields.onset.duration && subfields.onset.onsetPattern === "unknown") {
          calculatedMissingDims.push("Onset pattern (sudden vs gradual)");
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern !== "unknown") {
          calculatedMissingDims.push("Onset timeline & duration");
        } else {
          calculatedMissingDims.push("Onset & timeline");
        }
      }
      if (!turnResult.state.slots.known_facts.some(f => /course/i.test(f))) calculatedMissingDims.push("Course & progression");
      const hasVoiceChange = turnResult.state.slots.associated_symptoms.includes("voice change") ||
        turnResult.state.slots.known_facts.some(f => /voice/i.test(f));
      const voiceCharKnown = turnResult.state.slots.known_facts.some(f => /voice_character|hoarse|aphonia/i.test(f));
      if (hasVoiceChange && !voiceCharKnown) calculatedMissingDims.push("Voice-change character (hoarseness vs aphonia)");
      const dysphagiaAssessed = turnResult.state.slots.known_facts.some(f => /swallowing_difficulty/i.test(f)) ||
        turnResult.state.conversationMemory?.deniedSymptoms.includes("swallowing_difficulty");
      if (!dysphagiaAssessed) calculatedMissingDims.push("Difficulty swallowing (saliva/fluids)");
      const feverAssessed = turnResult.state.slots.known_facts.some(f => /fever/i.test(f)) ||
        turnResult.state.conversationMemory?.deniedSymptoms.includes("fever");
      if (!feverAssessed) calculatedMissingDims.push("Fever / chills");
      // Independent character & severity breakdown
      if (!subfields.characterSeverity.character && !subfields.characterSeverity.severity) {
        calculatedMissingDims.push("Character & severity");
      } else if (!subfields.characterSeverity.character) {
        calculatedMissingDims.push("Symptom character / sensation");
      } else if (!subfields.characterSeverity.severity) {
        calculatedMissingDims.push("Pain severity (0-10)");
      }
      const earAssessed = turnResult.state.slots.known_facts.some(f => /ear/i.test(f)) ||
        turnResult.state.conversationMemory?.deniedSymptoms.includes("ear_pain");
      if (!earAssessed) calculatedMissingDims.push("Referred ear pain (Otalgia)");
    } else {
      if (!subfields.onset.isResolved) {
        if (subfields.onset.duration && subfields.onset.onsetPattern === "unknown") {
          calculatedMissingDims.push("Onset pattern (sudden vs gradual)");
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern !== "unknown") {
          calculatedMissingDims.push("Onset timeline & duration");
        } else {
          calculatedMissingDims.push("Onset & timeline");
        }
      }
      // Independent character & severity breakdown
      if (!subfields.characterSeverity.character && !subfields.characterSeverity.severity) {
        calculatedMissingDims.push("Character & severity");
      } else if (!subfields.characterSeverity.character) {
        calculatedMissingDims.push("Symptom character / sensation");
      } else if (!subfields.characterSeverity.severity) {
        calculatedMissingDims.push("Pain severity (0-10)");
      }

      // Independent episodic duration & frequency breakdown
      const isEpisodic = subfields.episodic.isEpisodic || /\b(episode|comes\s+and\s+goes|intermittent|spasm|attack)\b/i.test(turnResult.state.cumulativeTranscript);
      if (isEpisodic) {
        if (!subfields.episodic.episodeDuration && !subfields.episodic.frequency) {
          calculatedMissingDims.push("Episode duration & frequency");
        } else if (!subfields.episodic.episodeDuration) {
          calculatedMissingDims.push("Episode duration");
        } else if (!subfields.episodic.frequency) {
          calculatedMissingDims.push("Episode frequency");
        }
      }

      if (!slots.radiation && /\b(chest|heart|angina|leg|calf|back)\b/i.test(turnResult.state.cumulativeTranscript)) {
        calculatedMissingDims.push("Radiation & spread");
      }
      if (!slots.exertional && /\b(chest|heart|angina)\b/i.test(turnResult.state.cumulativeTranscript)) {
        calculatedMissingDims.push("Exertional relation");
      }
      if (slots.associated_symptoms.length === 0) {
        calculatedMissingDims.push("Associated symptoms");
      }
    }

    // Deterministic Clinical History Completeness Calculation
    let earnedPoints = 0;
    if (turnResult.state.structuredHistory?.chiefComplaint || turnResult.state.slots.known_facts.some(f => /chief complaint|throat_pain|chest_tightness|pain/i.test(f))) {
      earnedPoints += 20; // Chief complaint
    }
    if (slots.onset) earnedPoints += 15; // Onset
    if (turnResult.state.slots.known_facts.some(f => /course|worsening|sudden/i.test(f))) earnedPoints += 15; // Course
    if (slots.character || slots.severity || turnResult.state.slots.associated_symptoms.includes("voice change") || turnResult.state.slots.known_facts.some(f => /voice/i.test(f))) {
      earnedPoints += 15; // Character / severity / voice change
    }
    const swallowingEvaluated = turnResult.state.slots.known_facts.some(f => /swallow/i.test(f)) ||
      turnResult.state.conversationMemory?.deniedSymptoms.includes("swallowing_difficulty");
    if (swallowingEvaluated) earnedPoints += 15; // Swallowing safety screen

    const feverEvaluated = turnResult.state.slots.known_facts.some(f => /fever/i.test(f)) ||
      turnResult.state.conversationMemory?.deniedSymptoms.includes("fever");
    if (feverEvaluated) earnedPoints += 10; // Fever / constitutional screen

    if (slots.severity) earnedPoints += 10; // Numeric severity rating

    const completenessScore = Math.min(100, earnedPoints);

    // Invariant: Preserve unanswered dimensions already tracked by conversationManager
    // (e.g. compound question sub-targets such as fever, neck_stiffness, nausea).
    // Do NOT overwrite with a generic checklist; merge them and prune already resolved facts.
    const existingUnanswered = turnResult.state.structuredHistory?.unansweredDimensions || [];
    const mergedUnanswered = Array.from(new Set([...existingUnanswered, ...calculatedMissingDims])).filter(dim => {
      const dimLower = dim.toLowerCase();
      if (dimLower === "fever" && (turnResult.state.slots.known_facts.some(f => /fever/i.test(f)) || turnResult.state.conversationMemory?.deniedSymptoms.includes("fever"))) {
        return false;
      }
      if (dimLower === "neck_stiffness" && (turnResult.state.slots.known_facts.some(f => /neck/i.test(f)) || turnResult.state.conversationMemory?.deniedSymptoms.some(d => /neck/i.test(d)))) {
        return false;
      }
      if (dimLower === "nausea" && (turnResult.state.slots.known_facts.some(f => /nausea/i.test(f)) || turnResult.state.conversationMemory?.deniedSymptoms.includes("nausea"))) {
        return false;
      }
      if ((dimLower === "onset_pattern" || dimLower === "sudden_vs_gradual") && turnResult.state.slots.known_facts.some(f => /onset_type|onset pattern|sudden|gradual/i.test(f))) {
        return false;
      }
      return true;
    });

    const missingDims = mergedUnanswered;
    if (turnResult.state.structuredHistory) {
      turnResult.state.structuredHistory.unansweredDimensions = mergedUnanswered;
    }

    // Conditioned Care Network RAG Trigger:
    // Invoke when an acute emergency/danger is detected (ESI-1/ESI-2),
    // OR when an access constraint (financial or remote location) is present,
    // OR when the patient specifically mentions outskirts, affordability, or hospital needs.
    const constraints = turnResult.state.structuredHistory?.accessConstraints;
    let nearbyHospitals: any[] = turnResult.state.structuredHistory?.nearbyHospitals || [];
    let careOptions: any[] = [];
    let careNetworkSummary: string | undefined = undefined;

    const hasEmergencyEvidence = Boolean(
      turnResult.preArbiterResult?.immediate_danger ||
      (turnResult.preArbiterResult?.pre_safety_flags && turnResult.preArbiterResult.pre_safety_flags.length > 0) ||
      /\b(stridor|droop|facial\s+droop|slurred\s+speech|cannot\s+breathe|choking|unresponsive|cyanosis|crushing\s+chest|substernal)\b/i.test(turnResult.state.cumulativeTranscript)
    );

    const needsCareRouting = Boolean(
      hasEmergencyEvidence ||
      constraints?.financial ||
      constraints?.remoteLocation ||
      /\b(outskirts|hospital|far\s+away|remote|village|afford|poor|cost|ambulance)\b/i.test(cleanMsgLower)
    );

    if (needsCareRouting) {
      const isNeuroFlag = turnResult.preArbiterResult.pre_safety_flags.some((f: string) => f.includes("NEURO")) ||
        /\b(droop|facial|arm|weakness|speech|slur|stroke|tia)\b/i.test(turnResult.state.cumulativeTranscript);
      const isCardioFlag = turnResult.preArbiterResult.pre_safety_flags.some((f: string) => f.includes("ACS") || f.includes("CARDIO")) ||
        /\b(chest|crushing|pressure|radiat|angina)\b/i.test(turnResult.state.cumulativeTranscript);

      const specialtyRequired = isNeuroFlag ? "Neurology" : isCardioFlag ? "Cardiology" : undefined;
      const prioritizeAffordable = Boolean(constraints?.financial);

      const userCoords = userLocation?.latitude && userLocation?.longitude
        ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
        : undefined;

      const ragResult = await hospitalRagService.findEmergencyCareFacilities({
        userCoords,
        cityOrLandmark: userLocation?.city,
        specialtyRequired,
        prioritizeAffordable,
        maxResults: 3,
      });

      nearbyHospitals = ragResult.facilities;
      careOptions = ragResult.careOptions;
      careNetworkSummary = ragResult.summaryForLLM;

      if (turnResult.state.structuredHistory) {
        turnResult.state.structuredHistory.nearbyHospitals = nearbyHospitals;
      }
    }

    // 3. Generative Clinical Turn Response (NVIDIA NIM / Groq LLM with Pre-Arbiter Emergency Invariant)
    const callerProfile: CallerProfile = {
      id: effectiveUserId || "caller-session",
      name: patientName,
      relationshipToPatient: inferredSubject === "mother" ? "child" : inferredSubject === "child" ? "parent" : "self",
    };

    const llmResult = await generateDoctorTurnResponse({
      patientUtterance: cleanMsg,
      conversationHistory: sanitizedConversationHistory,
      interviewState: turnResult.state,
      preArbiterResult: turnResult.preArbiterResult,
      demographics: { age: ageNum ?? undefined, age_group: ageGroup, age_source: ageSource },
      doctor,
      missingDimensions: missingDims,
      fallbackReply: turnResult.doctorReply,
      careNetworkSummary,
      callerProfile,
      patientProfile: activeProfile || undefined,
      targetSubject: inferredSubject,
      isClarificationRequest: turnResult.action === "CLARIFY",
      clarificationGuidance: turnResult.action === "CLARIFY" ? turnResult.doctorReply : undefined,
    });

    // LLM-First Dialogue Resolution:
    // If the LLM generated a safe, validated reply, use it even on clarification turns.
    // Retain turnResult.doctorReply as deterministic fallback when generation fails, is empty, or falls back.
    const activeDoctorReply = (llmResult.liveGenerated && llmResult.reply)
      ? llmResult.reply
      : turnResult.doctorReply;

    // Ingest candidate clinical facts into durable state through controlled reconciliation
    if (llmResult.candidateFacts && Array.isArray(llmResult.candidateFacts) && llmResult.candidateFacts.length > 0) {
      const callerForRecon: CallerProfile = callerProfile || {
        id: "caller-session",
        name: "Caller",
        relationshipToPatient: "self",
        authorizedPatientIds: [activeProfile?.id || "pt-session"],
      };
      const patientForRecon: PatientProfile = activeProfile || {
        id: "pt-session",
        name: patientName || "Patient",
        age: ageNum ?? 35,
        gender: "other",
        language: "en",
        conditions: [],
        medications: [],
        allergies: [],
      };

      const existingAttributed: AttributedClinicalFact[] = (turnResult.state.attributedFacts || []).map(f => ({
        id: f.id,
        targetPatientId: patientForRecon.id,
        reporterId: callerForRecon.id,
        concept: f.concept,
        assertionStatus: f.assertionStatus,
        verificationStatus: "unverified",
        temporalScope: f.temporality === "historical" ? "historical" : "current",
        source: f.attribution === "caregiver_report" ? "caregiver_reported" : "patient_reported",
        turnId: f.turnId,
        timestamp: f.timestamp,
        provenanceDetails: {
          reliability: "moderate",
          clinicalType: "subjective_symptom",
        },
        normalizedText: f.sourceUtterance,
        confidence: f.confidence === "calibrated_score" ? 0.9 : 0.6,
        requiresReconfirmation: f.assertionStatus === "uncertain",
      }));

      const recon = controlledFactReconciliationEngine.reconcileCandidateFacts(
        existingAttributed,
        llmResult.candidateFacts,
        callerForRecon,
        patientForRecon,
        turnResult.state.caseVersion
      );

      turnResult.state.attributedFacts = recon.acceptedFacts.map(fact => ({
        id: fact.id,
        concept: fact.concept,
        assertionStatus: fact.assertionStatus,
        temporality: fact.temporalScope === "historical" ? "historical" : "current",
        attribution: fact.source === "caregiver_reported" ? "caregiver_report" : (callerForRecon.relationshipToPatient === "child" ? "third_party" : "patient"),
        coverage: "assessed",
        sourceUtterance: fact.normalizedText || `${fact.concept}: ${fact.assertionStatus}`,
        sourceSpeaker: fact.source === "caregiver_reported" ? "caregiver" : "patient",
        turnId: fact.turnId,
        confidence: fact.assertionStatus === "uncertain" ? "explicit_unknown" : "calibrated_score",
        timestamp: fact.timestamp,
      }));

      for (const fact of recon.acceptedFacts) {
        const factText = `${fact.concept}: ${fact.assertionStatus}`;
        if (!turnResult.state.slots.known_facts.includes(factText)) {
          turnResult.state.slots.known_facts.push(factText);
        }
        if (turnResult.state.conversationMemory && !turnResult.state.conversationMemory.confirmedFacts.includes(factText)) {
          turnResult.state.conversationMemory.confirmedFacts.push(factText);
        }
      }
    }

    // Ingest unmapped observations into durable state
    if (llmResult.unmappedObservations && Array.isArray(llmResult.unmappedObservations)) {
      if (!turnResult.state.unmappedObservations) turnResult.state.unmappedObservations = [];
      for (const rawObs of llmResult.unmappedObservations) {
        const obsStr = typeof rawObs === "string" ? rawObs : ((rawObs as any).rawEvidence || "");
        if (obsStr && !turnResult.state.unmappedObservations.some(o => o.rawEvidence.toLowerCase() === obsStr.toLowerCase())) {
          turnResult.state.unmappedObservations.push({
            id: `obs-${Date.now()}-${turnResult.state.unmappedObservations.length + 1}`,
            rawEvidence: obsStr,
            status: "unverified_proposal",
            turnId: turnResult.state.structuredHistory?.turnCount || 1,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    const turnCount = turnResult.state.structuredHistory?.turnCount || 1;
    const targets = llmResult.liveGenerated && llmResult.intendedTargets && llmResult.intendedTargets.length > 0
      ? llmResult.intendedTargets
      : (turnResult.state.pendingQuestion?.targetSlot ? [turnResult.state.pendingQuestion.targetSlot] : []);

    // Record DeliveredTurnRecord (tracks generated vs delivered vs heard)
    const deliveredRecord: DeliveredTurnRecord = {
      turnId: turnCount,
      deliveredText: activeDoctorReply,
      conversationalAction: (llmResult.conversationalAction as any) || (turnResult.action === "CLARIFY" ? "CLARIFY_AMBIGUITY" : "INQUIRE"),
      intendedTargets: targets,
      targetResolutionStatuses: {},
      relevantEvidenceRefs: [],
      caseVersion: turnResult.state.caseVersion,
      timestamp: new Date().toISOString(),
      audioDeliveryStatus: "pending",
    };
    if (!turnResult.state.deliveredTurnRecords) turnResult.state.deliveredTurnRecords = [];
    turnResult.state.deliveredTurnRecords.push(deliveredRecord);

    // Synchronize pendingQuestion: Bind both question text and targetSlot to the doctor's spoken question
    if (activeDoctorReply.includes("?")) {
      const activeTarget = targets[0] || detectQuestionTargetSlot(activeDoctorReply);
      if (!turnResult.state.pendingQuestion) {
        turnResult.state.pendingQuestion = {
          id: `req-active-${Date.now()}`,
          targetSlot: activeTarget,
          targetSlots: targets.length > 0 ? targets : [activeTarget],
          askedBy: "sarah",
          doctorName: doctor.name,
          patientFacingSpeaker: "sarah",
          question: activeDoctorReply,
          purpose: llmResult.understoodContext || `Inquire regarding ${activeTarget}`,
          required: true,
          priority: "normal",
          status: "pending",
          createdAt: new Date().toISOString(),
          caseVersion: turnResult.state.caseVersion,
        };
      } else {
        turnResult.state.pendingQuestion.question = activeDoctorReply;
        if (llmResult.liveGenerated && targets.length > 0) {
          turnResult.state.pendingQuestion.targetSlot = targets[0];
          turnResult.state.pendingQuestion.targetSlots = targets;
        }
      }
      if (turnResult.state.conversationMemory) {
        turnResult.state.conversationMemory.lastDoctorQuestion = activeDoctorReply;
        if (activeTarget && !turnResult.state.conversationMemory.questionsAlreadyAsked.includes(activeTarget)) {
          turnResult.state.conversationMemory.questionsAlreadyAsked.push(activeTarget);
        }
      }
    } else {
      // Invariant: If doctor reply does not ask a question (e.g. ACKNOWLEDGE, EXPLAIN, REASSURE, PROVIDE_SUPPORT, EMERGENCY_DIRECTIVE, CONVENE_BOARD),
      // clear pendingQuestion so stale questions from previous turns do not linger and miscapture subsequent patient statements.
      if (turnResult.state.pendingQuestion) {
        turnResult.state.pendingQuestion.status = "superseded";
        turnResult.state.pendingQuestion = null;
      }
    }

    const history = turnResult.state.structuredHistory || (turnResult.state.structuredHistory = {} as any);
    history.recentDoctorReplies = history.recentDoctorReplies || [];
    if (history.recentDoctorReplies.length > 0) {
      history.recentDoctorReplies[history.recentDoctorReplies.length - 1] = activeDoctorReply;
    } else {
      history.recentDoctorReplies.push(activeDoctorReply);
    }

    // Structured multi-specialist intake deliberation messages
    const intakeDeliberationMessages: any[] = [];
    if (hasAnySymptoms) {
      if (isThroat) {
        intakeDeliberationMessages.push({
          id: `delib-sarah-${Date.now()}-1`,
          speakerRole: "lead",
          agentId: "internal-medicine-chen",
          doctorName: "Dr. Sarah Chen, MD",
          specialty: "Chief of Internal Medicine",
          type: "assessment",
          content: "Presenting with acute pharyngeal discomfort. Clinical timeline established. Screening for odynophagia, epiglottic compromise, and vocal alteration character.",
          timestamp: new Date().toISOString(),
        });
        intakeDeliberationMessages.push({
          id: `delib-marcus-${Date.now()}-2`,
          speakerRole: "specialist",
          agentId: "cardiology-vance",
          doctorName: "Dr. Marcus Vance, MD, FACC",
          specialty: "Cardiology",
          type: "assessment",
          content: "Cardiovascular review: No substernal crushing sensation, exertional radiation, or diaphoresis. Ischemic risk low.",
          timestamp: new Date().toISOString(),
        });
        intakeDeliberationMessages.push({
          id: `delib-arthur-${Date.now()}-3`,
          speakerRole: "specialist",
          agentId: "neurology-pendelton",
          doctorName: "Dr. Arthur Pendelton, MD, PhD",
          specialty: "Neurology",
          type: "assessment",
          content: "Neurological review: Reported voice change is consistent with laryngeal inflammation rather than acute central dysarthria. BE-FAST stroke signs non-contributory.",
          timestamp: new Date().toISOString(),
        });
      } else if (isChest) {
        intakeDeliberationMessages.push({
          id: `delib-sarah-${Date.now()}-1`,
          speakerRole: "lead",
          agentId: "internal-medicine-chen",
          doctorName: "Dr. Sarah Chen, MD",
          specialty: "Chief of Internal Medicine",
          type: "assessment",
          content: "Active chest presentation. Tracking onset acuity, character, and radiation to evaluate potential cardiopulmonary causes.",
          timestamp: new Date().toISOString(),
        });
        intakeDeliberationMessages.push({
          id: `delib-marcus-${Date.now()}-2`,
          speakerRole: "specialist",
          agentId: "cardiology-vance",
          doctorName: "Dr. Marcus Vance, MD, FACC",
          specialty: "Cardiology",
          type: "evidence_request",
          content: "Evaluating for acute coronary syndrome. Screening for exertional triggers, radiation, and autonomic indicators (cold sweats, nausea).",
          timestamp: new Date().toISOString(),
        });
      }
    }

    // POST-DECISION RE-EVALUATION: If the patient was already in 'decided' phase from a previous
    // board session but new pre-arbiter red flags have appeared on this turn (e.g. "my voice is muffled"
    // adding PTA risk after the board already ran), force re-convening rather than returning ASK_PATIENT.
    const previousPhase = body.interviewState?.phase;
    const previousFlags = new Set<string>(body.interviewState?.slots?.known_facts
      ?.filter((f: string) => f.startsWith("PRE_FLAG_"))
      || []);
    const currentFlags = turnResult.preArbiterResult.pre_safety_flags || [];
    const newRedFlags = currentFlags.filter((f: string) => !previousFlags.has(f));

    const wasAlreadyDecidedPhase = previousPhase === "decided" || previousPhase === "board_decision" || previousPhase === "closing";
    if (wasAlreadyDecidedPhase && newRedFlags.length > 0 &&
        (turnResult.action === "ASK_PATIENT" || turnResult.action === "CLARIFY")) {
      console.warn(`[MedVoice AI Post-Decision Re-evaluation] New red flags detected post-decision: [${newRedFlags.join(", ")}]. Forcing board re-convene.`);
      turnResult.action = "EMERGENCY_CONVENE_BOARD" as any;
      turnResult.state.phase = "decided";
      turnResult.state.informationState = "emergency_preempted";
    }

    const persistTurnStateAsync = async (stateToPersist: any) => {
      if (!encounterId || effectiveUserId === "unauthenticated") return;
      const dbClient = getDb();
      if (dbClient) {
        try {
          const existingRows = await dbClient
            .select()
            .from(consultationsTable)
            .where(
              auth.role === "admin"
                ? eq(consultationsTable.id, encounterId)
                : and(eq(consultationsTable.id, encounterId), eq(consultationsTable.userId, effectiveUserId))
            )
            .limit(1);

          if (existingRows.length > 0) {
            await dbClient
              .update(consultationsTable)
              .set({
                interviewState: stateToPersist,
                deliveredTurnRecords: stateToPersist.deliveredTurnRecords,
                attributedFacts: stateToPersist.attributedFacts,
                unmappedObservations: stateToPersist.unmappedObservations,
                caseVersion: stateToPersist.caseVersion,
              })
              .where(eq(consultationsTable.id, encounterId));
          } else {
            await dbClient.insert(consultationsTable).values({
              id: encounterId,
              userId: effectiveUserId,
              doctorId: doctor.id,
              doctorName: doctor.name,
              specialty: doctor.specialty,
              chiefComplaint: cleanMsg.slice(0, 200),
              interviewState: stateToPersist,
              deliveredTurnRecords: stateToPersist.deliveredTurnRecords,
              attributedFacts: stateToPersist.attributedFacts,
              unmappedObservations: stateToPersist.unmappedObservations,
              caseVersion: stateToPersist.caseVersion,
              status: "in_progress",
            } as any);
          }
        } catch (persistErr) {
          console.warn("[VoiceChat] Server turn state persistence notice:", persistErr);
        }
      } else {
        const mem = memoryConsultations.find(
          c => c.id === encounterId && (c.userId === effectiveUserId || auth.role === "admin" || effectiveUserId === "anon-user")
        );
        if (mem) {
          mem.interviewState = stateToPersist;
          mem.deliveredTurnRecords = stateToPersist.deliveredTurnRecords;
          mem.attributedFacts = stateToPersist.attributedFacts;
          mem.unmappedObservations = stateToPersist.unmappedObservations;
          mem.caseVersion = stateToPersist.caseVersion;
        } else {
          memoryConsultations.push({
            id: encounterId,
            userId: effectiveUserId,
            doctorId: doctor.id,
            doctorName: doctor.name,
            specialty: doctor.specialty,
            chiefComplaint: cleanMsg.slice(0, 200),
            interviewState: stateToPersist,
            deliveredTurnRecords: stateToPersist.deliveredTurnRecords,
            attributedFacts: stateToPersist.attributedFacts,
            unmappedObservations: stateToPersist.unmappedObservations,
            caseVersion: stateToPersist.caseVersion,
            status: "in_progress",
            transcript: [],
          });
        }
      }
    };

    // If conversation manager determined patient follow-up or clarification is needed
    if (turnResult.action === "ASK_PATIENT" || turnResult.action === "CLARIFY") {
      // Dual-loop non-blocking blackboard background deliberation:
      // Fire non-blocking blackboard deliberation when symptoms exist to precompute specialist insights
      if (hasAnySymptoms) {
        try {
          const bgPatientCase: PatientCase = {
            patient_id: `PT-BG-${Date.now().toString().slice(-4)}`,
            patient_name: patientName,
            transcript: cumulativeTranscript,
            conversation_history: sanitizedConversationHistory,
            demographics: {
              age: ageNum ?? undefined,
              age_group: ageGroup as any,
            },
            detected_symptoms: turnResult.state.slots.known_facts,
            vitals: {},
            speech_features: speechFeatures,
            pre_safety_flags: turnResult.preArbiterResult.pre_safety_flags,
            immediate_danger_detected: turnResult.preArbiterResult.immediate_danger,
            provenance_evidence: [],
            is_interruption: Boolean(isInterruption),
            interrupted_agent: interruptedAgent || undefined,
            case_version: turnResult.state.caseVersion,
          };
          clinicalBoard.evaluate(bgPatientCase).catch((err: any) => {
            console.debug("[DualLoopBackground] Non-blocking blackboard evaluation deferred:", err?.message);
          });
        } catch {
          // non-blocking
        }
      }

      await persistTurnStateAsync(turnResult.state);

      return buildJsonResponse({
        doctorReply: activeDoctorReply,
        doctor: {
          id: doctor.id,
          name: doctor.name,
          specialty: doctor.specialty,
          avatarUrl: doctor.avatarUrl,
          voiceGender: doctor.voiceGender,
          voiceId: doctor.voiceId,
        },
        phase: turnResult.state.phase,
        interviewState: turnResult.state,
        nearbyHospitals: nearbyHospitals.length > 0 ? nearbyHospitals : undefined,
        careOptions: careOptions.length > 0 ? careOptions : undefined,
        llmMeta: {
          provider: llmResult.provider,
          model: llmResult.model,
          latencyMs: llmResult.latencyMs,
          fallbackReason: llmResult.fallbackReason,
          responseProvenance: (llmResult as any).responseProvenance || (
            (turnResult.preArbiterResult.immediate_danger || (turnResult.action as string) === "EMERGENCY_CONVENE_BOARD")
              ? "deterministic_safety_arbiter"
              : (llmResult.liveGenerated && llmResult.reply)
                ? "llm_generative_dialogue"
                : "validated_fallback"
          ),
        },
        board: {
          phase: turnResult.state.phase,
          information_state: turnResult.state.informationState,
          status_summary: turnResult.state.informationState === "sufficient_for_specialist"
            ? "Specialist Review Active · Inquiring"
            : "Clinical History Gathering",
          active_specialists: [
            "Dr. Sarah Chen, MD (Lead - Primary Care)",
            "Dr. Marcus Vance, MD, FACC (Cardiology)",
            "Dr. Arthur Pendelton, MD, PhD (Neurology)",
          ],
          active_requests: turnResult.state.agentRequests.filter(r => r.status === "pending"),
          pending_question: turnResult.state.pendingQuestion,
          completeness_score: completenessScore,
          known_facts: turnResult.state.slots.known_facts,
          missing_dimensions: calculatedMissingDims,
          slots: turnResult.state.slots,
          opinions: [],
          consensus_summary: "Clinical board actively reviewing intake evidence across internal medicine, cardiology, and neurology.",
          differential: [],
          conflicts: [],
          key_findings: turnResult.state.slots.known_facts,
          deliberation_messages: intakeDeliberationMessages,
          trace: null,
        },
        speech_features: speechFeatures,
        triage: {
          triageLevel: "gathering_history",
          triageTitle: "Clinical History Gathering",
          esiScore: null,
          isEmergency: false,
          arbiterOverride: false,
          overrideRationale: null,
          redFlagsTriggered: turnResult.preArbiterResult.pre_safety_flags,
          detectedSymptoms: turnResult.state.slots.known_facts,
          icdCodes: [],
          recommendedAction: "Clinical history in progress. Triage disposition will lock once evidence is sufficient.",
          soap: null,
        },
        patientProfile: activeProfile ? {
          id: activeProfile.id,
          name: activeProfile.name,
          relationshipToUser: activeProfile.relationshipToUser,
          age: activeProfile.age,
          knownConditions: activeProfile.knownConditions,
          currentMedications: activeProfile.currentMedications,
          allergyStatus: activeProfile.allergyStatus,
          drugAllergies: activeProfile.drugAllergies,
        } : null,
        targetSubject: inferredSubject,
      });
    }

    // 3. Assemble Normalized Patient Case for Full Board Deliberation (Convene Board or Emergency Preemption)
    const patientId = `PT-${Date.now().toString().slice(-4)}`;
    const provenanceEvidence = buildProvenanceEvidenceFromClinicalState({
      state: turnResult.state,
      speechFeatures,
      vitals: {},
      transcript: turnResult.state.cumulativeTranscript,
      patientName,
      patientId,
    });

    const patientCase: PatientCase = {
      patient_id: patientId,
      patient_name: patientName,
      transcript: turnResult.state.cumulativeTranscript,
      conversation_history: sanitizedConversationHistory,
      demographics: {
        age: ageNum ?? undefined,
        age_group: ageGroup as any,
      },
      detected_symptoms: turnResult.state.slots.known_facts,
      vitals: {},
      speech_features: speechFeatures,
      pre_safety_flags: turnResult.preArbiterResult.pre_safety_flags,
      immediate_danger_detected: turnResult.preArbiterResult.immediate_danger,
      provenance_evidence: provenanceEvidence,
      is_interruption: Boolean(isInterruption),
      interrupted_agent: interruptedAgent || undefined,
      case_version: turnResult.state.caseVersion,
    };

    // 4. Execute Multi-Agent Clinical Board (Pre-Arbiter -> Orchestrator -> Specialists -> Synthesizer -> Post-Arbiter)
    const boardOutput = await clinicalBoard.evaluate(patientCase);

    const sufficiency = {
      is_sufficient: true,
      completeness_score: Math.min(100, Math.round((knownFactsCount / (knownFactsCount + missingDims.length || 1)) * 100)),
      dimensions: {
        known_facts: turnResult.state.slots.known_facts,
        missing_dimensions: missingDims,
      },
    };

    const resolvedCitations: Record<string, any> = {};
    const allCitationIds = new Set<string>();

    boardOutput.trace.opinions?.forEach((o: any) => {
      o.retrieved_citations?.forEach((c: string) => allCitationIds.add(c));
    });
    boardOutput.trace.deliberation_messages?.forEach((m: any) => {
      m.references?.forEach((r: string) => {
        if (typeof r === "string" && (r.startsWith("GUIDELINE-") || r.startsWith("MPLUS-") || r.startsWith("RXNORM-") || r.startsWith("DAILYMED-") || r.startsWith("OPENFDA-"))) {
          allCitationIds.add(r);
        }
      });
    });

    for (const id of allCitationIds) {
      const p = clinicalKnowledgeRetriever.resolveCitation(id);
      if (p) {
        resolvedCitations[id] = {
          id: p.id,
          title: p.title,
          authority: p.authority,
          source: p.source,
          section: p.section,
          content: p.content,
          releaseDate: p.releaseDate,
          organization: p.source,
          criteria: p.keyTerms || [],
        };
      }
    }

    const isEmergency = Boolean(
      turnResult.action === "EMERGENCY_CONVENE_BOARD" ||
      turnResult.preArbiterResult?.immediate_danger ||
      (turnResult.preArbiterResult?.pre_safety_flags && turnResult.preArbiterResult.pre_safety_flags.length > 0) ||
      boardOutput?.post_arbiter?.final_triage_level === "emergency"
    );

    const wasAlreadyDecided = body.interviewState?.phase === "decided" || body.interviewState?.phase === "board_decision";

    let finalDoctorReply: string;

    if (isEmergency || wasAlreadyDecided) {
      // Emergency preemption or post-decision turn: active conversational guidance takes absolute precedence
      finalDoctorReply = activeDoctorReply || turnResult.doctorReply || boardOutput?.doctor_reply || "";
      if (isEmergency && !/\b(108|112|emergency|ambulance|hospital|urgent|er\b|immediately)\b/i.test(finalDoctorReply)) {
        finalDoctorReply = `This is a medical emergency. Please call 112 or 108 immediately or proceed to the nearest emergency department. ${finalDoctorReply}`.trim();
      }
    } else if (activeDoctorReply) {
      // LLM-first conversational response controls patient-facing dialogue
      finalDoctorReply = activeDoctorReply;
    } else if (boardOutput && boardOutput.doctor_reply) {
      // Pre-TTS Validator for non-emergency board reply fallback: ensure no fabricated unassessed vitals
      const text = boardOutput.doctor_reply.toLowerCase();
      const hasFabricatedVitals = /\b(blood\s+pressure\s+is\s+\d+|bp\s+is\s+\d+|heart\s+rate\s+is\s+\d+)\b/i.test(text);
      if (hasFabricatedVitals) {
        finalDoctorReply = turnResult.doctorReply || "I have reviewed your symptoms with our clinical board.";
      } else {
        finalDoctorReply = boardOutput.doctor_reply;
      }
    } else {
      finalDoctorReply = turnResult.doctorReply;
    }

    // Voice-length guard: board output may be clinician-length text. Truncate for TTS.
    const finalWordCount = finalDoctorReply.split(/\s+/).filter(Boolean).length;
    if (finalWordCount > 60) {
      const sentences = finalDoctorReply.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length >= 2) {
        const truncated = sentences.slice(0, 2).join(" ").trim();
        if (truncated.split(/\s+/).length <= 55) {
          finalDoctorReply = truncated;
        }
      }
    }

    const decidedInterviewState = {
      ...turnResult.state,
      phase: "decided" as const,
      informationState: "sufficient_for_decision" as const,
    };

    await persistTurnStateAsync(decidedInterviewState);

    return buildJsonResponse({
      doctorReply: finalDoctorReply,
      doctor: {
        id: doctor.id,
        name: doctor.name,
        specialty: doctor.specialty,
        avatarUrl: doctor.avatarUrl,
        voiceGender: doctor.voiceGender,
        voiceId: doctor.voiceId,
      },
      phase: "board_decision",
      interviewState: decidedInterviewState,
      nearbyHospitals: nearbyHospitals.length > 0 ? nearbyHospitals : undefined,
      careOptions: careOptions.length > 0 ? careOptions : undefined,
      llmMeta: {
        provider: llmResult.provider,
        model: llmResult.model,
        latencyMs: llmResult.latencyMs,
        fallbackReason: llmResult.fallbackReason,
        responseProvenance: (llmResult as any).responseProvenance || (
          (turnResult.preArbiterResult.immediate_danger || turnResult.action === "EMERGENCY_CONVENE_BOARD")
            ? "deterministic_safety_arbiter"
            : (llmResult.liveGenerated && llmResult.reply)
              ? "llm_generative_dialogue"
              : "validated_fallback"
        ),
      },
      sufficiency,
      board: {
        phase: "board_decision",
        status_summary: "Clinical Context Complete · Deliberation Active",
        completeness_score: sufficiency.completeness_score,
        known_facts: sufficiency.dimensions.known_facts,
        missing_dimensions: sufficiency.dimensions.missing_dimensions,
        orchestrator_summary: boardOutput.consensus.orchestrator_summary,
        active_specialists: boardOutput.consensus.active_specialists,
        specialists_summoned: boardOutput.trace.specialists_summoned,
        opinions: boardOutput.trace.opinions,
        differential: boardOutput.consensus.differential,
        conflicts: boardOutput.consensus.conflicts,
        key_findings: boardOutput.consensus.key_findings,
        consensus_risk: boardOutput.consensus.consensus_risk,
        deliberation_rounds: boardOutput.trace.deliberation_rounds,
        tools_executed: boardOutput.trace.tools_executed,
        tools_executed_details: boardOutput.trace.tools_executed_details,
        peer_challenges_count: boardOutput.trace.peer_challenges_count,
        peer_challenges: boardOutput.trace.peer_challenges,
        deliberation_messages: boardOutput.trace.deliberation_messages || [],
        citations: resolvedCitations,
        trace: {
          pre_arbiter_latency_us: boardOutput.trace.pre_arbiter_latency_us,
          orchestrator_latency_ms: boardOutput.trace.orchestrator_latency_ms,
          synthesis_latency_ms: boardOutput.trace.synthesis_latency_ms,
          post_arbiter_latency_us: boardOutput.trace.post_arbiter_latency_us,
          total_board_latency_ms: boardOutput.trace.total_board_latency_ms,
          audit_sha256: boardOutput.trace.root_audit_hash,
          audit_hash_chain: boardOutput.trace.audit_hash_chain,
        },
      },
      speech_features: speechFeatures,
      triage: {
        triageLevel: boardOutput.post_arbiter.final_triage_level,
        triageTitle: boardOutput.post_arbiter.final_esi_title,
        esiScore: boardOutput.post_arbiter.final_esi_level,
        isEmergency: boardOutput.post_arbiter.final_triage_level === "emergency",
        arbiterOverride: boardOutput.post_arbiter.arbiter_override_applied,
        overrideRationale: boardOutput.post_arbiter.override_rationale,
        redFlagsTriggered: boardOutput.post_arbiter.red_flags,
        detectedSymptoms: boardOutput.consensus.key_findings,
        icdCodes: boardOutput.post_arbiter.icd10_codes,
        recommendedAction: boardOutput.post_arbiter.final_disposition,
        soap: boardOutput.soap_note,
      },
      patientProfile: activeProfile ? {
        id: activeProfile.id,
        name: activeProfile.name,
        relationshipToUser: activeProfile.relationshipToUser,
        age: activeProfile.age,
        knownConditions: activeProfile.knownConditions,
        currentMedications: activeProfile.currentMedications,
        allergyStatus: activeProfile.allergyStatus,
        drugAllergies: activeProfile.drugAllergies,
      } : null,
      targetSubject: inferredSubject,
    });
  } catch (error: any) {
    console.error("[VoiceChatError]", error);
    return NextResponse.json(
      { error: process.env.NODE_ENV === "production" ? "Internal server error during clinical consultation." : (error?.message || "Internal server error during multi-agent clinical consultation.") },
      { status: 500 }
    );
  }
}
