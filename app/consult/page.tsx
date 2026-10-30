"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  PhoneOff,
  Activity,
  ShieldCheck,
  Stethoscope,
  ChevronRight,
  ChevronDown,
  Send,
  Building2,
  Radio,
  Users,
  Zap,
  Award,
  Cpu,
  Hand,
  HeartPulse,
  Brain,
  Baby,
  CheckCircle2,
  AlertCircle,
  ClipboardCheck,
  HelpCircle,
  Clock,
  ArrowRight,
  Flame,
  Volume2,
  FileText,
  MapPin,
  Navigation,
  PhoneCall,
  Circle,
  Info,
  X,
  AlertTriangle
} from "lucide-react";
import Link from "next/link";
import { LandingFloatingNavbar } from "../_components/LandingFloatingNavbar";
import { ArchitecturalBrandLedgerFooter } from "../_components/ArchitecturalBrandLedgerFooter";
import { SoapReportModal } from "../_components/SoapReportModal";
import { DOCTOR_PROFILES, DoctorProfile, getDoctorById } from "@/config/doctors";
import { CursorGrid } from "@/components/ui/cursor-grid";
import RotatingText from "@/components/RotatingText";
import CountUp from "@/components/CountUp";
import SpecularButton from "@/components/SpecularButton";
import PremiumButton from "@/components/PremiumButton";
import AccordionGallery from "@/components/AccordionGallery";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { GlowingBorder } from "@/components/ui/glowing-border";
import { MovingBorder } from "@/components/ui/moving-border";
import GlowCursor from "@/components/ui/GlowCursor";
import { AnimatedContent } from "@/components/ui/animated-content";
import SplitText from "@/components/ui/SplitText";
import GradientText from "@/components/ui/GradientText";
import { VoicePill, VoicePillState } from "@/components/clinical/VoicePill";
import { ThoughtLine, ThoughtStep } from "@/components/clinical/ThoughtLine";
import { PulseHeart } from "@/components/clinical/PulseHeart";
import { SwipeToast } from "@/components/feedback/SwipeToast";
import { PeekRating } from "@/components/feedback/PeekRating";
import { splitIntoSpeechChunks } from "@/lib/audio/sentence-splitter";
import gsap from "gsap";
import { ExpressiveVoiceOrb, VoiceOrbState } from "./_components/ExpressiveVoiceOrb";
import { TranscriptReviewBar } from "./_components/TranscriptReviewBar";
import { ConsultHeader } from "./_components/ConsultHeader";
import { ConsultDialogueFeed } from "./_components/ConsultDialogueFeed";
import { ConsultClinicalContext } from "./_components/ConsultClinicalContext";
import { AcousticDSPAnalyzer, LiveAudioMetrics } from "@/lib/acoustic/acoustic-dsp-analyzer";
import { normalizeCompletenessPercent } from "@/lib/triage/clinical-state";


type AudioState =
  | "IDLE"
  | "INTRODUCING"
  | "PATIENT_LISTENING"
  | "PROCESSING_TRANSCRIPTION"
  | "PROCESSING_CLINICAL"
  | "DOCTOR_SPEAKING"
  | "BARGE_IN_DETECTED"
  | "PROCESSING_INTERRUPTION"
  | "TRANSCRIPT_REVIEW"
  | "REQUESTING_MIC"
  | "ERROR";

interface ChatMessage {
  id: string;
  role: "doctor" | "patient" | "system";
  text: string;
  timestamp: string;
  doctorName?: string;
  doctorSpecialty?: string;
  doctorId?: string;
  wasInterrupted?: boolean;
  isBargeIn?: boolean;
}

interface BoardMessage {
  id: string;
  speakerRole: "lead" | "specialist" | "tool" | "system" | "safety_arbiter";
  agentId: string;
  doctorName: string;
  specialty: string;
  round: number;
  type: "assessment" | "challenge" | "response" | "evidence_request" | "tool_result" | "revision" | "synthesis" | "safety_disposition";
  content: string;
  references?: string[];
  tool_data?: {
    tool_name: string;
    summary: string;
    status: string;
    latency_ms?: number;
    details?: any;
  };
  timestamp: string;
  case_version?: number;
}

interface LiveTriageData {
  triageLevel: "emergency" | "priority" | "routine" | "gathering_history";
  triageTitle: string;
  esiScore?: number | null;
  isEmergency?: boolean;
  arbiterOverride?: boolean;
  overrideRationale?: string;
  redFlagsTriggered?: string[];
  detectedSymptoms: string[];
  icdCodes: string[];
  recommendedAction: string;
  soap: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
}

interface BoardData {
  phase?: "dormant" | "active_inquiring" | "deliberating" | "decided" | "gathering_history" | "specialist_deliberation" | "board_decision";
  information_state?: string;
  status_summary?: string;
  consensus_summary?: string;
  completeness_score?: number;
  known_facts?: string[];
  missing_dimensions?: string[];
  active_requests?: Array<{
    id: string;
    fromAgent: string;
    doctorName: string;
    type: string;
    targetSlot: string;
    urgency: string;
    reason: string;
    suggestedQuestion: string;
    status: string;
  }>;
  pending_question?: {
    id: string;
    targetSlot: string;
    askedBy: string;
    doctorName: string;
    question: string;
    purpose: string;
  } | null;
  slots?: any;
  inquiry?: {
    doctor_id?: string;
    doctor_name: string;
    specialty: string;
    avatarUrl?: string;
    target_dimension?: string;
    question: string;
  };
  orchestrator_summary?: string;
  active_specialists: string[];
  specialists_summoned?: string[];
  deliberation_rounds?: number;
  tools_executed?: string[];
  tools_executed_details?: Array<{
    tool_name: string;
    clinical_summary: string;
    latency_ms: number;
    status: string;
  }>;
  peer_challenges_count?: number;
  peer_challenges?: Array<{
    from_agent: string;
    to_agent: string;
    claim_disputed: string;
    counter_evidence: string[];
    challenge_rationale: string;
    resolved?: boolean;
  }>;
  opinions?: Array<{
    doctor_name: string;
    specialty: string;
    concerns: string[];
    risk_level: string;
    confidence?: number;
    confidence_semantics?: string;
    primary_hypothesis?: string;
    recommended_actions?: string[];
  }>;
  differential?: Array<{
    condition: string;
    probability: string;
    supporting_agents?: string[];
  }>;
  conflicts?: Array<{
    topic: string;
    agents: string[];
    conflict_description: string;
    resolution: string;
  }>;
  deliberation_messages?: BoardMessage[];
  citations?: Record<string, {
    id: string;
    title: string;
    authority: string;
    source: string;
    section: string;
    content: string;
    releaseDate: string;
    organization: string;
    criteria?: string[];
  }>;
  trace?: {
    pre_arbiter_latency_us: number;
    post_arbiter_latency_us: number;
    total_board_latency_ms: number;
    orchestrator_latency_ms?: number;
    synthesis_latency_ms?: number;
    audit_sha256?: string;
    audit_hash_chain?: Array<{
      block_index: number;
      event_type: string;
      current_hash: string;
      previous_hash: string;
      payload_summary: string;
    }>;
  } | null;
}

const METHODOLOGY_STAGES = [
  {
    number: "01",
    label: "Speech & Acoustic Intake",
    description: "Real-time acoustic biomarker extraction, speech cadence tracking, and hands-free clinical transcription.",
    image: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1000&q=80",
    link: "#",
    alt: "Acoustic Biomarkers & Real-Time Transcription"
  },
  {
    number: "02",
    label: "Parallel Deliberation",
    description: "Cardiology, neurology, and pediatrics agent swarms evaluate symptoms concurrently in memory.",
    image: "https://images.unsplash.com/photo-1505751172876-fa1923c5c528?auto=format&fit=crop&w=1000&q=80",
    link: "#",
    alt: "Cardiology, Neurology, & Pediatrics Evaluation"
  },
  {
    number: "03",
    label: "Peer Cross-Examination",
    description: "Multi-agent peer cross-examination, clinical hypothesis revision, and targeted diagnostic inquiries.",
    image: "https://images.unsplash.com/photo-1551076805-e1869033e561?auto=format&fit=crop&w=1000&q=80",
    link: "#",
    alt: "Differential Diagnosis & Clarification Inquiries"
  },
  {
    number: "04",
    label: "Deterministic Safety Arbiter",
    description: "Algorithmic ESI v4 life-threat invariants evaluate instantly with deterministic safety guardrails.",
    image: "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1000&q=80",
    link: "#",
    alt: "Algorithmic ESI v4 Invariant Verification"
  },
  {
    number: "05",
    label: "Consensus & Audit Ledger",
    description: "Specialist conclusions reconciled into structured SOAP, ICD-10 codes, and tamper-proof SHA-256 hash chains.",
    image: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1000&q=80",
    link: "#",
    alt: "Structured SOAP, ICD-10 & SHA-256 Ledger"
  }
];

function formatTimelineTime(timestamp?: string): string {
  if (!timestamp || timestamp === "Live" || timestamp === "Pending") {
    return timestamp || "12:57 PM";
  }
  try {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
    }
  } catch {}
  return timestamp;
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function formatNaturalDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) {
    return `${secs} sec`;
  }
  if (secs === 0) {
    return `${mins} min`;
  }
  return `${mins} min ${secs} sec`;
}

function formatClinicalFact(raw: string): string {
  if (!raw) return "";
  const clean = raw.trim();

  // If format is KEY: value (e.g. "CHEST_TIGHTNESS: present", "CHARACTER: tightness", "ONSET: a week", "Frequency: once in a month")
  if (clean.includes(":")) {
    const parts = clean.split(":");
    const key = parts[0].trim().toUpperCase();
    const val = parts.slice(1).join(":").trim();

    if (val.toLowerCase() === "present") {
      return key
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase());
    }

    if (key === "FREQUENCY") {
      return `Episodes occur ${val}`;
    }

    if (key === "RISK FACTORS" || key === "RISK_FACTORS") {
      if (val.toLowerCase().includes("none")) {
        return "No known cardiac risk factors";
      }
      return `Risk factors: ${val}`;
    }

    if (key === "CHARACTER") {
      return `${val.charAt(0).toUpperCase() + val.slice(1)} sensation`;
    }

    if (key === "ONSET") {
      const cleanVal = val.replace(/^(?:approx\.?|roughly|about)\s*/i, "").trim();
      return `Started ~${cleanVal}`;
    }

    if (key === "DURATION") {
      const cleanVal = val.replace(/^(?:approx\.?|roughly|about)\s*/i, "").trim();
      return `Duration: ~${cleanVal}`;
    }

    if (key === "COURSE") {
      return `Course: ${val}`;
    }

    if (key === "ONSET_TYPE" || key === "ONSET TYPE") {
      return val.toLowerCase() === "sudden" ? "Onset: sudden" : "Onset: gradual";
    }

    if (key === "SEVERITY") {
      return `Severity: ${val}`;
    }

    if (key === "ABDOMINAL LOCATION") {
      return `Abdominal location: ${val}`;
    }

    if (key === "LIFESTYLE") {
      return `Lifestyle: ${val}`;
    }

    if (key === "SECONDARY_CONCERN" || key === "SECONDARY CONCERN") {
      return `Secondary concern: ${val}`;
    }

    if (key === "DISTRIBUTION") {
      return `Distribution: ${val}`;
    }

    if (key === "PATIENT_CONCERN" || key === "PATIENT CONCERN") {
      return `Patient concern: ${val}`;
    }

    if (key.startsWith("TIMELINE")) {
      return `${key}: ${val}`;
    }

    if (key === "VOICE_CHANGE" || key === "VOICE CHANGE") {
      return "Voice change present";
    }

    if (key === "THROAT_PAIN" || key === "THROAT PAIN") {
      return "Throat pain present";
    }

    if (key === "DENIED") {
      return `Denied: ${val}`;
    }

    if (key === "ASSOCIATED") {
      return `Associated ${val}`;
    }

    if (key === "NEUROLOGICAL") {
      return `Neurological: ${val}`;
    }

    const formattedKey = key.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    return `${formattedKey}: ${val}`;
  }

  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export type ConsultSessionMode = "CONSULT_LOBBY" | "ACTIVE_CONSULTATION" | "CONSULT_COMPLETE";

export default function ConsultPage() {
  const { user } = useUser();
  const [activeProfile, setActiveProfile] = useState<any>(null);

  useEffect(() => {
    if (user?.id) {
      fetch("/api/patient/profile")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.profile) {
            setActiveProfile(data.profile);
          }
        })
        .catch((err) => console.warn("Failed to load patient profile:", err));
    }
  }, [user?.id]);

  // Recover transient session draft on page mount if user navigated away or reloaded
  useEffect(() => {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    try {
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key && key.startsWith("medvoice_transient_draft_")) {
          const raw = window.sessionStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.expiresAt && Date.now() < parsed.expiresAt && parsed.payload?.transcript?.length > 0) {
              if (messages.length === 0 && !callActiveRef.current) {
                stableEncounterIdRef.current = parsed.payload.id;
                serverEncounterCreatedRef.current = true;
                setCurrentEncounterId(parsed.payload.id);
                setMessages(parsed.payload.transcript);
                setCallDuration(parsed.payload.durationSeconds || 0);
                setPersistenceStatus("saved");
                setClinicalToasts((prev) => [
                  ...prev,
                  {
                    id: `draft-restored-${Date.now()}`,
                    type: "info",
                    title: "Active Encounter Draft Restored",
                    description: `Recovered ${parsed.payload.transcript.length} turns from previous session (${parsed.payload.id}).`
                  }
                ]);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("[MedVoice] Session draft restore notice:", err);
    }
  }, []);

  const patientDisplayName = activeProfile?.name || user?.fullName || user?.firstName || "Patient";

  // Dynamic clinical personalized greeting resolver (ChatGPT-style conversational intake)
  const getPersonalizedGreeting = useCallback((doc: DoctorProfile) => {
    const rawName = activeProfile?.name || user?.firstName || user?.fullName || "Puneeth";
    const cleanFirstName = rawName && rawName.trim().length > 0 && !/^patient$/i.test(rawName.trim()) && !/^anonymous/i.test(rawName.trim())
      ? rawName.trim().split(" ")[0].trim()
      : "Puneeth";
    return `Hi ${cleanFirstName}, I'm ${doc.name}. I'm here to help you work through what's been bothering you. What would you like us to focus on today?`;
  }, [activeProfile?.name, user?.firstName, user?.fullName]);

  const [sessionMode, setSessionMode] = useState<ConsultSessionMode>("ACTIVE_CONSULTATION");
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorProfile>(DOCTOR_PROFILES[0]);
  const [activeSpeaker, setActiveSpeaker] = useState<{
    id: string;
    name: string;
    voiceId: string;
    specialty: string;
    department: string;
    avatarUrl: string;
    voiceGender: "female" | "male";
    voiceEngine: string;
  }>({
    id: DOCTOR_PROFILES[0].id,
    name: DOCTOR_PROFILES[0].name,
    voiceId: DOCTOR_PROFILES[0].voiceId,
    specialty: DOCTOR_PROFILES[0].specialty,
    department: DOCTOR_PROFILES[0].department,
    avatarUrl: DOCTOR_PROFILES[0].avatarUrl,
    voiceGender: DOCTOR_PROFILES[0].voiceGender,
    voiceEngine: "Kokoro",
  });
  const [callActive, setCallActive] = useState<boolean>(true);
  const [consultationStarted, setConsultationStarted] = useState(false);

  // WebGL & DSP Thread Isolation: Dispatch global event to pause background canvases when voice session is active
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("medvoice:voice-session-active", { detail: { active: callActive } })
      );
    }
    return () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("medvoice:voice-session-active", { detail: { active: false } })
        );
      }
    };
  }, [callActive]);

  const [audioState, setAudioState] = useState<AudioState>("IDLE");

  const [callDuration, setCallDuration] = useState<number>(0);
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [typedInput, setTypedInput] = useState<string>("");
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingReviewTranscript, setPendingReviewTranscript] = useState<string>("");
  const pendingAudioMetricsRef = useRef<LiveAudioMetrics | undefined>(undefined);
  const [liveAudioLevel, setLiveAudioLevel] = useState<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const [pendingDoctorMessage, setPendingDoctorMessage] = useState<{
    id: string;
    doctorName: string;
    doctorSpecialty?: string;
  } | null>(null);
  const [triageData, setTriageData] = useState<LiveTriageData | null>(null);
  const [boardData, setBoardData] = useState<BoardData | null>(null);
  const [interviewState, setInterviewState] = useState<any>(null);
  
  const [activeRightTab, setActiveRightTab] = useState<"board" | "context" | "safety" | "care">("context");
  const [nearbyHospitals, setNearbyHospitals] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude?: number; longitude?: number; city?: string } | null>(null);
  const [locationPermission, setLocationPermission] = useState<"granted" | "denied" | "unknown">("unknown");

  // Context Tab State Calculations
  const contextKnownFacts: string[] = (boardData?.known_facts || interviewState?.slots?.known_facts || [])
    .filter((fact: string) => !/^ONSET_AND_LOCATION:/i.test(fact) && !/duration:\s*~?3\s*days/i.test(fact))
    .map(formatClinicalFact);
  const hasContextFacts = contextKnownFacts.length > 0;

  const defaultMissingDimensions = [
    "Symptoms & chief complaint",
    "Onset & timeline",
    "Episode duration & frequency",
    "Character & severity",
    "Associated symptoms",
  ];

  const contextMissingDimensions: string[] = boardData?.missing_dimensions !== undefined && boardData.missing_dimensions.length > 0
    ? boardData.missing_dimensions
    : (hasContextFacts ? [] : defaultMissingDimensions);

  const rawCompleteness = boardData?.completeness_score !== undefined
    ? boardData.completeness_score
    : (hasContextFacts ? Math.min(0.95, Math.round((contextKnownFacts.length / (contextKnownFacts.length + (contextMissingDimensions.length || 1))) * 100) / 100) : 0);

  const completenessPercent = normalizeCompletenessPercent(rawCompleteness);

  const contextTitle = hasContextFacts ? "Context established" : "Consultation context";
  let contextSubtitle = "Building as you talk";

  if (audioState === "PATIENT_LISTENING") {
    contextSubtitle = "Listening to patient...";
  } else if (audioState === "PROCESSING_TRANSCRIPTION") {
    contextSubtitle = "Transcribing speech...";
  } else if (audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_INTERRUPTION") {
    contextSubtitle = "Updating context...";
  } else if (audioState === "DOCTOR_SPEAKING") {
    contextSubtitle = `${activeSpeaker?.name ? activeSpeaker.name.split(",")[0] : "Doctor"} speaking...`;
  } else if (hasContextFacts) {
    contextSubtitle = "Context updated";
  } else {
    contextSubtitle = "Building as you talk";
  }

  const handleRequestLocation = useCallback(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserLocation(coords);
        setLocationPermission("granted");
      },
      (err) => {
        console.warn("Location permission error:", err);
        setLocationPermission("denied");
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, []);

  const [showTechnicalTrace, setShowTechnicalTrace] = useState<boolean>(false);
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<Record<string, boolean>>({});
  const toggleEvidence = (id: string) => {
    setExpandedEvidenceIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const [showSoapModal, setShowSoapModal] = useState<boolean>(false);
  const [showRatingModal, setShowRatingModal] = useState<boolean>(false);
  const [clinicalToasts, setClinicalToasts] = useState<Array<{ id: string; type: "success" | "warning" | "info"; title: string; description: string }>>([]);

  // Encounter Persistence & Review State Machine
  const stableEncounterIdRef = useRef<string>("");
  const serverEncounterCreatedRef = useRef<boolean>(false);
  const serverEncounterPromiseRef = useRef<Promise<boolean> | null>(null);
  const isPersistingEncounterRef = useRef<boolean>(false);
  const encounterVersionRef = useRef<number>(0);
  const [currentEncounterId, setCurrentEncounterId] = useState<string>("");
  const [persistenceStatus, setPersistenceStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  // Test harness hook for automated verification in development
  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      (window as any).__testSetTranscriptReview = (sampleText: string) => {
        setPendingReviewTranscript(sampleText);
        setAudioState("TRANSCRIPT_REVIEW");
      };
      (window as any).__testGetConsultationState = () => ({
        audioState,
        consultationStarted,
        messagesCount: messages.length,
        messages: messages.map(m => ({ role: m.role, text: m.text })),
        pendingReviewTranscript,
        persistenceStatus,
        encounterId: stableEncounterIdRef.current,
        encounterVersion: encounterVersionRef.current,
      });
    }
  }, [audioState, consultationStarted, messages, pendingReviewTranscript, persistenceStatus]);

  const voicePillState: VoicePillState = 
    audioState === "PATIENT_LISTENING"
      ? "listening"
      : audioState === "PROCESSING_TRANSCRIPTION"
      ? "transcribing"
      : audioState === "PROCESSING_CLINICAL"
      ? "understanding"
      : audioState === "DOCTOR_SPEAKING"
      ? "responding"
      : audioState === "BARGE_IN_DETECTED" || audioState === "PROCESSING_INTERRUPTION"
      ? "understanding"
      : "idle";

  const clinicalThoughtSteps: ThoughtStep[] = [
    {
      id: "step-audio",
      label: "Voice stream captured (high-fidelity audio)",
      detail: audioState === "PATIENT_LISTENING" ? "Streaming clear microphone intake" : "Acoustic intake channel ready",
      status: callActive || audioState !== "IDLE" ? "completed" : "pending"
    },
    {
      id: "step-transcription",
      label: "Speech recognized & acoustic noise filtered",
      detail: transcriptText ? `Transcribed: "${transcriptText.slice(0, 36)}..."` : (messages.some(m => m.role === "patient") ? "Patient utterance transcribed" : "Awaiting patient voice"),
      status: transcriptText || messages.some(m => m.role === "patient") ? "completed" : (audioState === "PATIENT_LISTENING" ? "running" : "pending")
    },
    {
      id: "step-entities",
      label: "Clinical entity extraction & chief complaint",
      detail: triageData?.detectedSymptoms && triageData.detectedSymptoms.length > 0
        ? `Identified: ${triageData.detectedSymptoms.slice(0, 3).join(", ")}`
        : (hasContextFacts ? `${contextKnownFacts.length} verified facts extracted` : "Extracting symptom semantics"),
      status: (triageData?.detectedSymptoms && triageData.detectedSymptoms.length > 0) || hasContextFacts ? "completed" : (audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_INTERRUPTION" ? "running" : "pending")
    },
    {
      id: "step-deliberation",
      label: "Multi-specialist clinical review",
      detail: boardData?.opinions && boardData.opinions.length > 0
        ? `${boardData.opinions.length} specialist evaluations synthesized`
        : (boardData?.deliberation_messages && boardData.deliberation_messages.length > 0)
        ? `${boardData.deliberation_messages.length} specialist assessments active`
        : "Cardiology, neurology, and internal medicine monitoring",
      status: (boardData?.opinions && boardData.opinions.length > 0) || (boardData?.deliberation_messages && boardData.deliberation_messages.length > 0) ? "completed" : (audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_INTERRUPTION" ? "running" : "pending")
    },
    {
      id: "step-esi",
      label: "ESI triage urgency assessment",
      detail: triageData?.esiScore
        ? `Assigned ESI-${triageData.esiScore} (${triageData.triageLevel.toUpperCase()})`
        : "Awaiting history completeness for disposition lock",
      status: triageData?.esiScore ? "completed" : "pending"
    },
    {
      id: "step-response",
      label: "Consensus response ready & clinical guidance",
      detail: audioState === "DOCTOR_SPEAKING" ? `${activeSpeaker?.name ? activeSpeaker.name.split(",")[0] : "Doctor"} audio synthesis streaming` : (messages.length > 0 ? "SOAP encounter note compiled" : "Standby for response synthesis"),
      status: audioState === "DOCTOR_SPEAKING" || messages.some(m => m.role === "doctor") ? "completed" : (audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_INTERRUPTION" ? "running" : "pending")
    }
  ];

  const [emergencyCallTarget, setEmergencyCallTarget] = useState<{
    isOpen: boolean;
    number: string;
    title: string;
    description: string;
    serviceName: string;
  } | null>(null);

  const handleInitiateEmergencyCall = (number: string, serviceName?: string) => {
    if (number === "108") {
      setEmergencyCallTarget({
        isOpen: true,
        number: "108",
        title: "Call 108 ambulance services?",
        description: "This will open your phone's dialer for 108 (ambulance services).",
        serviceName: "Ambulance Services"
      });
    } else if (number === "112") {
      setEmergencyCallTarget({
        isOpen: true,
        number: "112",
        title: "Call 112 emergency services?",
        description: "This will open your phone's dialer for India's national emergency number.",
        serviceName: "National Emergency"
      });
    } else {
      setEmergencyCallTarget({
        isOpen: true,
        number,
        title: `Call ${serviceName || number}?`,
        description: `This will open your phone's dialer for ${serviceName || number}.`,
        serviceName: serviceName || "Emergency Contact"
      });
    }
  };

  const handleConfirmEmergencyCall = () => {
    if (emergencyCallTarget?.number) {
      const num = emergencyCallTarget.number;
      setEmergencyCallTarget(null);
      window.location.href = `tel:${num}`;
    }
  };

  useEffect(() => {
    if (!emergencyCallTarget) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEmergencyCallTarget(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [emergencyCallTarget]);

  // Audio refs & Audio Guard
  const recognitionRef = useRef<any>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioStateRef = useRef<AudioState>("IDLE");
  const callActiveRef = useRef<boolean>(false);
  const consultationStartedAtRef = useRef<number | null>(null);
  const consultationCompletedAtRef = useRef<number | null>(null);
  const lastDoctorSpeechRef = useRef<string>("");
  const lastDoctorSpeechTimeRef = useRef<number>(0);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const persistentAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSessionTokenRef = useRef<number>(0);

  // Natural conversational voice intake refs
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedTranscriptRef = useRef<string>("");
  const transcriptTextRef = useRef<string>("");
  const startSpeechRecognitionListeningRef = useRef<() => void>(() => {});
  const handleUserUtteranceRef = useRef<(userText: string, isBargeIn?: boolean, audioMetrics?: LiveAudioMetrics) => void>(() => {});
  const acousticAnalyzerRef = useRef<AcousticDSPAnalyzer | null>(null);

  // Canonical Whisper ASR Audio Capture refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastRecordedAudioBlobRef = useRef<Blob | null>(null);

  // Helper to safely stop MediaRecorder and retrieve recorded audio Blob
  const stopAndGetAudioBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording") {
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          audioChunksRef.current = [];
          resolve(blob);
        } else {
          resolve(null);
        }
        return;
      }

      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mime });
        audioChunksRef.current = [];
        resolve(blob);
      };

      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    });
  };

  // Hardware Audio Latency Inspector via Web Audio API (baseLatency + outputLatency)
  const getHardwareAudioLatency = useCallback((): number | null => {
    if (typeof window === "undefined") return null;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const latency = (((ctx as any).outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
      if (ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
      return Math.round(latency * 10) / 10;
    } catch {
      return null;
    }
  }, []);

  // Safely stops and unloads active HTML5 AudioElement without triggering spurious error events
  const stopAndClearActiveAudio = useCallback(() => {
    if (activeAudioRef.current) {
      try {
        const audio = activeAudioRef.current;
        activeAudioRef.current = null;
        audio.onended = null;
        audio.onerror = null;
        audio.onplaying = null;
        audio.onloadeddata = null;
        audio.oncanplay = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {}
    }
    if (persistentAudioRef.current) {
      try {
        const pAudio = persistentAudioRef.current;
        pAudio.onended = null;
        pAudio.onerror = null;
        pAudio.onplaying = null;
        pAudio.onloadeddata = null;
        pAudio.oncanplay = null;
        pAudio.pause();
        pAudio.removeAttribute("src");
        pAudio.load();
      } catch {}
    }
  }, []);

  // Cleanly stops active microphone and removes all event listeners to prevent hardware / thread locks
  const stopSpeechRecognitionListening = useCallback(() => {
    if (acousticAnalyzerRef.current) {
      acousticAnalyzerRef.current.dispose();
      acousticAnalyzerRef.current = null;
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    audioChunksRef.current = [];

    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.stop();
      } catch {
        try {
          rec.abort();
        } catch {}
      }
    }
  }, []);

  // Top-level unmount lifecycle cleanup: ensures no audio keeps playing, speech synthesis is halted,
  // in-flight async TTS generation is discarded, and microphone hardware tracks are stopped on route departure.
  useEffect(() => {
    return () => {
      playbackSessionTokenRef.current += 1;
      stopSpeechRecognitionListening();
      stopAndClearActiveAudio();
      if (acousticAnalyzerRef.current) {
        acousticAnalyzerRef.current.dispose();
        acousticAnalyzerRef.current = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, [stopSpeechRecognitionListening, stopAndClearActiveAudio]);

  // Cancels recording without transcribing or sending — pure discard-and-return-to-IDLE
  const cancelVoiceRecording = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    audioChunksRef.current = [];
    transcriptTextRef.current = "";
    accumulatedTranscriptRef.current = "";
    setTranscriptText("");
    stopSpeechRecognitionListening();
    setAudioState("IDLE");
  }, [stopSpeechRecognitionListening]);

  // Commits transcribed speech to the clinical pipeline (Whisper ASR canonical, SpeechRecognition interim fallback)
  const commitSpokenText = useCallback(async (forceText?: string) => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // CAPTURE live interim browser transcript BEFORE clearing any buffers!
    const capturedWebSpeech = (
      forceText?.trim() ||
      accumulatedTranscriptRef.current ||
      transcriptTextRef.current ||
      transcriptText ||
      ""
    ).trim();

    // Clear live speech display buffers now that we've captured the fallback
    accumulatedTranscriptRef.current = "";
    transcriptTextRef.current = "";
    setTranscriptText("");

    // Stop browser interim speech recognition cleanly
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    // Extract live acoustic metrics from DSP analyzer prior to stopping media tracks
    let liveAudioMetrics: LiveAudioMetrics | undefined;
    if (acousticAnalyzerRef.current) {
      try {
        liveAudioMetrics = acousticAnalyzerRef.current.finalize();
      } catch (dspErr) {
        console.warn("Acoustic DSP finalization notice:", dspErr);
      }
      acousticAnalyzerRef.current = null;
    }

    // Retrieve recorded utterance from MediaRecorder
    const audioBlob = await stopAndGetAudioBlob();
    if (audioBlob) {
      lastRecordedAudioBlobRef.current = audioBlob;
    }

    // Release microphone tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    let finalTranscript = "";
    setAudioState("PROCESSING_TRANSCRIPTION");

    // Primary Canonical Path: Transcribe recorded utterance using Local Whisper ASR
    if (audioBlob && audioBlob.size > 2000) {
      try {
        const formData = new FormData();
        const ext = audioBlob.type?.includes("mp4") ? "utterance.mp4" :
                    audioBlob.type?.includes("wav") ? "utterance.wav" : "utterance.webm";
        formData.append("file", audioBlob, ext);

        const sttRes = await fetch("/api/voice/stt", {
          method: "POST",
          body: formData,
        });

        if (sttRes.ok) {
          const sttData = await sttRes.json().catch(() => ({}));
          finalTranscript = (sttData.transcript || "").trim();
          if (finalTranscript.length > 0) {
            console.log("🎯 Canonical Local Whisper ASR Transcript:", finalTranscript);
          }
        } else {
          console.warn(`[MedVoice STT] Local Whisper ASR offline or busy (${sttRes.status}). Seamlessly falling back to browser Web Speech API...`);
        }
      } catch (err: any) {
        console.warn("[MedVoice STT] Whisper STT request notice:", err?.message || err);
      }
    }

    // Secondary Resilient Fallback: Real-time Web Speech API transcript (prevents speech loss if Whisper is offline or returns 503)
    if (!finalTranscript && capturedWebSpeech) {
      console.log("🎯 Browser Web Speech API fallback transcript engaged:", capturedWebSpeech);
      finalTranscript = capturedWebSpeech;
    }

    if (!finalTranscript) {
      console.log("No intelligible speech detected in utterance.");
      setClinicalToasts((prev) => [
        ...prev,
        {
          id: `toast-${Date.now()}`,
          type: "warning",
          title: "Microphone Audio Notice",
          description: "No clear speech captured. Please repeat or type your symptoms in the composer below.",
        },
      ]);
      if (callActiveRef.current) {
        setAudioState("PATIENT_LISTENING");
      } else {
        setAudioState("IDLE");
      }
      return;
    }

    console.log("🎤 Finalized patient utterance for review:", finalTranscript);
    pendingAudioMetricsRef.current = liveAudioMetrics;
    setPendingReviewTranscript(finalTranscript);
    setAudioState("TRANSCRIPT_REVIEW");
  }, [stopSpeechRecognitionListening, transcriptText]);

  // Immediate Barge-In: cleanly halts doctor TTS and starts listening
  const triggerBargeIn = useCallback((customPhrase?: string) => {
    console.log("⚡ Interrupting doctor speech immediately.");
    // Invalidate any in-flight async TTS generation so late-arriving audio is suppressed
    playbackSessionTokenRef.current += 1;
    setPendingDoctorMessage(null);

    stopAndClearActiveAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }

    setAudioState("BARGE_IN_DETECTED");

    // Mark previous doctor message as interrupted without duplicating
    setMessages((prev) => {
      const updated = [...prev];
      for (let i = updated.length - 1; i >= 0; i--) {
        if (updated[i].role === "doctor") {
          updated[i] = { ...updated[i], wasInterrupted: true };
          break;
        }
      }
      return updated;
    });

    if (customPhrase) {
      handleUserUtteranceRef.current?.(customPhrase, true);
    } else {
      setTimeout(() => {
        startSpeechRecognitionListeningRef.current?.();
      }, 100);
    }
  }, [stopAndClearActiveAudio]);

  // Telemetry logger for empirical lifecycle latency breakdown
  const logPlaybackLifecycle = useCallback((t: {
    doctorName: string;
    engine: string;
    t_clinical_received?: number;
    t_tts_started: number;
    t_tts_received: number;
    t_blob_ready: number;
    t_audio_loaded: number;
    t_play_called: number;
    t_playback_started: number;
    t_text_rendered?: number;
    hardwareOutputLatencyMs?: number | null;
    bufferLeadTimeMs?: number | null;
    modelWarmupMs?: number | null;
    queueStarvationMs?: number | null;
  }) => {
    const base = t.t_clinical_received ?? t.t_tts_started;
    const p = (ts?: number) => ts !== undefined ? `+${(ts - base).toFixed(1)} ms` : "N/A";
    const delta = (t2: number, t1: number) => `+${(t2 - t1).toFixed(1)} ms`;
    const gap = t.t_text_rendered && t.t_playback_started ? Math.abs(t.t_text_rendered - t.t_playback_started).toFixed(1) : "0.0";
    const bufferLeadStr = t.bufferLeadTimeMs !== null && t.bufferLeadTimeMs !== undefined
      ? (t.bufferLeadTimeMs >= 0 ? `+${t.bufferLeadTimeMs.toFixed(1)} ms (Healthy lead: Chunk 1 ready before Chunk 0 ended)` : `${t.bufferLeadTimeMs.toFixed(1)} ms (Stall warning)`)
      : "Single chunk turn";
    const warmupStr = t.modelWarmupMs && t.modelWarmupMs > 0 ? `${t.modelWarmupMs} ms` : "Model warmed & memory-resident";
    const starvationStr = t.queueStarvationMs !== undefined && t.queueStarvationMs !== null
      ? (t.queueStarvationMs === 0 ? "0.0 ms (Continuous playback, zero inter-chunk gap)" : `+${t.queueStarvationMs.toFixed(1)} ms stall`)
      : "N/A (Single Chunk)";

    console.log(
      `%c[MedVoice Audio Timing] ── Full Lifecycle Breakdown ─────────────────────\n` +
      `  1. Clinical response received:     ${p(t.t_clinical_received)}  (baseline)\n` +
      `  2. TTS request started:            ${p(t.t_tts_started)}  (delta: ${delta(t.t_tts_started, base)})\n` +
      `  3. TTS response received:          ${p(t.t_tts_received)}  (delta: ${delta(t.t_tts_received, t.t_tts_started)} Server Synthesis)\n` +
      `  4. Audio blob ready:               ${p(t.t_blob_ready)}  (delta: ${delta(t.t_blob_ready, t.t_tts_received)})\n` +
      `  5. Audio decoded/loaded:           ${p(t.t_audio_loaded)}  (delta: ${delta(t.t_audio_loaded, t.t_blob_ready)})\n` +
      `  6. audio.play() called:            ${p(t.t_play_called)}  (delta: ${delta(t.t_play_called, t.t_audio_loaded)})\n` +
      `  7. Actual playback started:        ${p(t.t_playback_started)}  (delta: ${delta(t.t_playback_started, t.t_play_called)} hardware buffer)\n` +
      `  8. Doctor text rendered:           ${p(t.t_text_rendered)}  (SYNCHRONIZED: text-to-voice gap: ${gap} ms)\n` +
      `────────────────────────────────────────────────────────────────────────\n` +
      `  Doctor: ${t.doctorName} | Engine: ${t.engine}\n` +
      `  Model Warmup Latency: ${warmupStr}\n` +
      `  Buffer Lead Time: ${bufferLeadStr}\n` +
      `  Queue Starvation: ${starvationStr}\n` +
      `  Hardware Output Latency: ${t.hardwareOutputLatencyMs !== null && t.hardwareOutputLatencyMs !== undefined ? `${t.hardwareOutputLatencyMs} ms` : "Unreported by OS"}\n` +
      `────────────────────────────────────────────────────────────────────────`,
      "color: #06b6d4; font-family: monospace; font-size: 11px; font-weight: bold;"
    );
  }, []);

  // Text-To-Speech with Kokoro-first Neural Audio, regional accent variation & race-safe synchronized playback
  const speakDoctorResponse = useCallback(async (
    text: string,
    doctorId: string,
    expectedToken?: number,
    options?: {
      clinicalReceivedAt?: number;
      onPlaybackStart?: () => void;
      onFallback?: () => void;
    }
  ) => {
    const cleanText = text.replace(/[*_#`\[\]()]/g, "").trim();
    if (!cleanText) {
      options?.onFallback?.();
      if (callActiveRef.current) {
        setAudioState("PATIENT_LISTENING");
      } else {
        setAudioState("IDLE");
      }
      return;
    }

    // 1. Resolve immutable doctor persona strictly from doctorId (server-authoritative)
    const targetDoctor = getDoctorById(doctorId);

    // 2. Playback Session Token Guard
    if (expectedToken === undefined) {
      playbackSessionTokenRef.current += 1;
    }
    const token = expectedToken ?? playbackSessionTokenRef.current;

    // Synchronize active speaker identity across UI components
    setActiveSpeaker({
      id: targetDoctor.id,
      name: targetDoctor.name,
      voiceId: targetDoctor.voiceId,
      specialty: targetDoctor.specialty,
      department: targetDoctor.department,
      avatarUrl: targetDoctor.avatarUrl,
      voiceGender: targetDoctor.voiceGender,
      voiceEngine: "Kokoro",
    });

    // 3. Halt any ongoing audio and speech intake immediately
    stopSpeechRecognitionListening();

    stopAndClearActiveAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }

    lastDoctorSpeechRef.current = cleanText.toLowerCase();
    lastDoctorSpeechTimeRef.current = Date.now();

    // Guard to ensure text commit happens exactly once per turn
    let textCommitted = false;
    const commitDoctorText = () => {
      if (textCommitted) return;
      textCommitted = true;
      if (playbackSessionTokenRef.current === token) {
        options?.onPlaybackStart?.();
      }
    };

    // Safety timeout: If playback doesn't start within 10s (e.g. autoplay policy blocked or network stall), force text display
    const safetyCommitTimer = setTimeout(() => {
      if (playbackSessionTokenRef.current === token && !textCommitted) {
        console.warn(`[MedVoice Audio Safety] Playback timeout reached; committing text transcript to preserve UX.`);
        commitDoctorText();
      }
    }, 10000);

    const handleSpeechEnd = () => {
      clearTimeout(safetyCommitTimer);
      if (playbackSessionTokenRef.current !== token) return;

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try { window.speechSynthesis.cancel(); } catch {}
      }
      activeAudioRef.current = null;

      if (callActiveRef.current) {
        // Safe 300ms buffer so room acoustic decay completes before re-arming patient mic
        setTimeout(() => {
          if (callActiveRef.current && playbackSessionTokenRef.current === token) {
            startSpeechRecognitionListeningRef.current?.();
          }
        }, 300);
      } else {
        setAudioState("IDLE");
      }
    };

    // Helper for deterministic, persona-safe browser TTS fallback (Only used when primary neural provider is offline/unconfigured)
    const playBrowserFallback = (targetLocale?: string) => {
      clearTimeout(safetyCommitTimer);
      if (playbackSessionTokenRef.current !== token) return;
      console.warn(`[MedVoice Audio Fallback] Primary TTS engine unavailable for ${targetDoctor.name} (${targetDoctor.voiceProfile?.provider} / ${targetDoctor.voiceId}). Attempting deterministic fallback...`);
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setActiveSpeaker((prev) => ({ ...prev, voiceEngine: "Text Only" }));
        commitDoctorText();
        handleSpeechEnd();
        return;
      }

      const isFemale = targetDoctor.voiceGender === "female";
      const isBritish = targetDoctor.voiceProfile?.accent === "british";
      const isIndian = targetDoctor.voiceProfile?.accent === "indian" || targetLocale === "en-IN";
      const voices = window.speechSynthesis.getVoices();
      const englishVoices = voices.filter((v) => v.lang.startsWith("en"));

      // Regional accent matching
      let candidateVoices = englishVoices;
      if (isIndian) {
        const indianVoices = englishVoices.filter((v) => v.lang.includes("IN") || /India|Heera|Veena|Kavya|Hindi/i.test(v.name));
        if (indianVoices.length > 0) candidateVoices = indianVoices;
      } else if (isBritish) {
        const britishVoices = englishVoices.filter((v) => v.lang.includes("GB") || /UK|British|George|Hazel|Oliver|Victoria/i.test(v.name));
        if (britishVoices.length > 0) candidateVoices = britishVoices;
      } else {
        const americanVoices = englishVoices.filter((v) => v.lang.includes("US") || /US|American|Samantha|David|Zira|Jenny/i.test(v.name));
        if (americanVoices.length > 0) candidateVoices = americanVoices;
      }

      // Per-doctor specific preferred voice name patterns
      const DOCTOR_FALLBACK_PATTERNS: Record<string, RegExp> = {
        "dr-sarah-chen": /Samantha|Zira|Jenny|Aria/i,
        "dr-marcus-vance": /David|Guy|Alex|Mark|Male/i,
        "dr-elena-rostova": /Hazel|Victoria|Emma|Libby|Female/i,
        "dr-arthur-pendelton": /George|Oliver|Daniel|Male/i,
        "dr-anna-bennett": /Nicole|Samantha|Victoria|Zira|Jenny|Female/i,
      };

      const pattern = DOCTOR_FALLBACK_PATTERNS[targetDoctor.id];
      let chosenVoice: SpeechSynthesisVoice | undefined;

      if (pattern && candidateVoices.length > 0) {
        chosenVoice = candidateVoices.find((v) => pattern.test(v.name));
      }

      // Strict gender preservation: NEVER play cross-gender voice
      if (!chosenVoice && candidateVoices.length > 0) {
        if (isFemale) {
          chosenVoice =
            candidateVoices.find((v) => /female|woman|zira|samantha|victoria|jenny|karen|hazel|emma|heera|veena|kavya/i.test(v.name)) ||
            candidateVoices.find((v) => !/male|david|mark|george|alex|daniel|guy|oliver/i.test(v.name));
        } else {
          chosenVoice = candidateVoices.find((v) => /male|man|david|mark|george|guy|alex|daniel|oliver/i.test(v.name));
        }
      }

      // If still no voice from regional pool, check general english voices with gender constraint
      if (!chosenVoice && englishVoices.length > 0) {
        if (isFemale) {
          chosenVoice = englishVoices.find((v) => /female|woman/i.test(v.name)) || englishVoices.find((v) => !/male/i.test(v.name));
        } else {
          chosenVoice = englishVoices.find((v) => /male|man/i.test(v.name));
        }
      }

      // If no gender-appropriate voice is available, MUTE rather than mis-gender doctor persona
      if (!chosenVoice) {
        console.warn(`[MedVoice Audio Safety] No appropriate ${targetDoctor.voiceGender} voice found in browser for ${targetDoctor.name}. Suppressing audio to preserve persona identity.`);
        setActiveSpeaker((prev) => ({ ...prev, voiceEngine: "Text Only" }));
        commitDoctorText();
        setClinicalToasts((prev) => [
          ...prev,
          {
            id: `tts-no-voice-${Date.now()}`,
            type: "info",
            title: "Voice Playback Muted (Persona Safety)",
            description: `No natural ${targetDoctor.voiceGender} voice found on system for ${targetDoctor.name}. Displaying text transcript to preserve identity.`,
          },
        ]);
        handleSpeechEnd();
        return;
      }

      const engineLabel = isIndian ? "Browser Fallback (en-IN Dev Mode)" : "Browser Fallback";
      setActiveSpeaker((prev) => ({ ...prev, voiceEngine: engineLabel }));

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.voice = chosenVoice;
      utterance.rate = targetDoctor.voiceProfile?.speed || 1.0;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        if (playbackSessionTokenRef.current === token) {
          setAudioState("DOCTOR_SPEAKING");
          commitDoctorText();
          const t_playback_started = performance.now();
          logPlaybackLifecycle({
            doctorName: targetDoctor.name,
            engine: engineLabel,
            t_clinical_received: options?.clinicalReceivedAt,
            t_tts_started: options?.clinicalReceivedAt || t_playback_started,
            t_tts_received: t_playback_started,
            t_blob_ready: t_playback_started,
            t_audio_loaded: t_playback_started,
            t_play_called: t_playback_started,
            t_playback_started,
            t_text_rendered: t_playback_started,
            hardwareOutputLatencyMs: getHardwareAudioLatency(),
          });
        }
      };
      utterance.onend = handleSpeechEnd;
      utterance.onerror = () => {
        commitDoctorText();
        handleSpeechEnd();
      };

      window.speechSynthesis.speak(utterance);
    };

    // 4. Primary Path: Multi-Provider Neural Audio Dispatcher with Chunk-Level Pipelining
    const chunks = splitIntoSpeechChunks(cleanText, 24);
    const t_tts_started = performance.now();

    const fetchTTSChunk = async (chunkText: string): Promise<{ blob: Blob; engineHeader: string; t_received: number; modelWarmupMs?: number | null }> => {
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chunkText,
          doctorId: targetDoctor.id,
          speed: targetDoctor.voiceProfile?.speed || 0.96,
        }),
      });

      const t_received = performance.now();

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        if (data.fallbackRequired) {
          throw new Error(`Fallback signal: ${data.reason}`);
        }
      }

      if (!response.ok) {
        throw new Error(`TTS route returned status ${response.status}`);
      }

      const blob = await response.blob();
      const engineHeader = response.headers.get("X-TTS-Engine") || (targetDoctor.voiceProfile?.provider === "azure-speech" ? "Azure Speech" : "Kokoro");
      const modelWarmupHeader = response.headers.get("X-TTS-Model-Warmup-Ms");
      const modelWarmupMs = modelWarmupHeader ? parseInt(modelWarmupHeader, 10) : null;
      return { blob, engineHeader, t_received, modelWarmupMs };
    };

    try {
      console.log(`[MedVoice Audio] Requesting speech (${chunks.length} chunk${chunks.length > 1 ? "s" : ""}) via TTS Dispatcher for ${targetDoctor.name}...`);
      
      // Immediately dispatch Chunk 0 for fast Time-To-First-Audio (TTFA)
      const chunk0Promise = fetchTTSChunk(chunks[0]);
      
      // In parallel, queue synthesis of remaining chunks in background
      const remainingPromises = chunks.slice(1).map((c) => fetchTTSChunk(c));

      let chunk1ReadyTime: number | null = null;
      if (remainingPromises.length > 0) {
        remainingPromises[0].then(() => {
          chunk1ReadyTime = performance.now();
        }).catch(() => {});
      }

      const { blob: blob0, engineHeader, t_received: t_tts_received, modelWarmupMs } = await chunk0Promise;
      const t_blob_ready = performance.now();

      if (playbackSessionTokenRef.current !== token) {
        clearTimeout(safetyCommitTimer);
        console.log(`[MedVoice Audio] Discarding in-flight TTS result for ${targetDoctor.name} (token mismatch).`);
        return;
      }

      const audioUrl0 = URL.createObjectURL(blob0);

      // Reuse persistent warmed Audio element rather than allocating a new DOM element per turn
      let audio = persistentAudioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        persistentAudioRef.current = audio;
      }
      activeAudioRef.current = audio;

      // Detach any previous listeners before binding new ones
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      audio.onloadeddata = null;
      audio.oncanplay = null;

      let t_audio_loaded = performance.now();
      audio.onloadeddata = () => {
        t_audio_loaded = performance.now();
      };

      // Playback chain for subsequent chunks with queue starvation measurement
      let currentChunkIdx = 1;
      let totalQueueStarvationMs = 0;
      let transitionsCount = 0;

      const playNextChunk = async (t_prev_ended: number) => {
        if (playbackSessionTokenRef.current !== token) return;
        if (currentChunkIdx >= chunks.length) {
          handleSpeechEnd();
          return;
        }

        try {
          const nextIdx = currentChunkIdx;
          currentChunkIdx++;

          const nextChunk = await remainingPromises[nextIdx - 1];
          if (playbackSessionTokenRef.current !== token) return;

          // Queue starvation: gap between when previous chunk audio stopped and next chunk was ready
          const starvationMs = Math.max(0, performance.now() - t_prev_ended);
          totalQueueStarvationMs += starvationMs;
          transitionsCount++;

          if (starvationMs === 0) {
            console.log(`[MedVoice Audio] Chunk ${nextIdx} queue transition: 0.0 ms starvation (Seamless, buffer ahead)`);
          } else {
            console.warn(`[MedVoice Audio] Chunk ${nextIdx} queue starvation: +${starvationMs.toFixed(1)} ms gap`);
          }

          const nextAudioUrl = URL.createObjectURL(nextChunk.blob);
          audio.pause();
          audio.removeAttribute("src");
          audio.src = nextAudioUrl;
          audio.load();

          audio.onended = () => {
            URL.revokeObjectURL(nextAudioUrl);
            playNextChunk(performance.now());
          };

          audio.onerror = () => {
            URL.revokeObjectURL(nextAudioUrl);
            handleSpeechEnd();
          };

          audio.play().catch(() => {
            URL.revokeObjectURL(nextAudioUrl);
            handleSpeechEnd();
          });
        } catch (chainErr) {
          console.warn("[MedVoice Audio] Chunk stream chained chunk notice:", chainErr);
          handleSpeechEnd();
        }
      };

      audio.onended = () => {
        clearTimeout(safetyCommitTimer);
        URL.revokeObjectURL(audioUrl0);
        if (chunks.length > 1) {
          playNextChunk(performance.now());
        } else {
          if (activeAudioRef.current === audio) {
            activeAudioRef.current = null;
          }
          handleSpeechEnd();
        }
      };

      audio.onerror = () => {
        clearTimeout(safetyCommitTimer);
        if (playbackSessionTokenRef.current !== token) return;
        const mediaErr = audio.error;
        const detail = mediaErr ? `Code ${mediaErr.code}: ${mediaErr.message || "playback issue"}` : "media decode notice";
        console.warn(`[MedVoice Audio] Audio element playback notice (${detail}). Transitioning to browser voice fallback for ${targetDoctor.name}...`);
        URL.revokeObjectURL(audioUrl0);
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
        }
        commitDoctorText();
        playBrowserFallback(targetDoctor.voiceProfile?.locale);
      };

      // Playback Synchronization: Trigger text reveal and DOCTOR_SPEAKING state at the exact moment audio output begins
      audio.onplaying = () => {
        clearTimeout(safetyCommitTimer);
        if (playbackSessionTokenRef.current !== token) return;
        const t_playback_started = performance.now();
        setAudioState("DOCTOR_SPEAKING");
        commitDoctorText();
        const t_text_rendered = performance.now();
        const chunk0DurationMs = (audio.duration && !isNaN(audio.duration) && audio.duration > 0)
          ? audio.duration * 1000
          : 0;

        const bufferLeadTimeMs = (chunk1ReadyTime !== null && chunk0DurationMs > 0)
          ? Math.round((t_playback_started + chunk0DurationMs) - chunk1ReadyTime)
          : (chunks.length > 1 ? 0 : null);

        logPlaybackLifecycle({
          doctorName: targetDoctor.name,
          engine: `${engineHeader}${chunks.length > 1 ? ` (Chunk 1/${chunks.length} Pipelined)` : ""}`,
          t_clinical_received: options?.clinicalReceivedAt,
          t_tts_started,
          t_tts_received,
          t_blob_ready,
          t_audio_loaded,
          t_play_called,
          t_playback_started,
          t_text_rendered,
          hardwareOutputLatencyMs: getHardwareAudioLatency(),
          bufferLeadTimeMs,
          modelWarmupMs,
          queueStarvationMs: chunks.length > 1 ? 0 : null,
        });
      };

      audio.removeAttribute("src");
      audio.src = audioUrl0;
      audio.load();

      const t_play_called = performance.now();
      audio.play().then(() => {
        setActiveSpeaker((prev) => ({ ...prev, voiceEngine: engineHeader }));
        console.log(`[MedVoice Audio] ${engineHeader} audio play() request dispatched successfully for ${targetDoctor.name}.`);
      }).catch((playErr: any) => {
        clearTimeout(safetyCommitTimer);
        if (playbackSessionTokenRef.current !== token) return;
        console.warn(`[MedVoice Audio] Audio play() notice: ${playErr?.message || playErr}. Transitioning to fallback...`);
        audio.onended = null;
        audio.onerror = null;
        audio.onplaying = null;
        URL.revokeObjectURL(audioUrl0);
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
        }
        commitDoctorText();
        playBrowserFallback(targetDoctor.voiceProfile?.locale);
      });
    } catch (err: any) {
      clearTimeout(safetyCommitTimer);
      console.warn(`[MedVoice Audio] Synthesis route error for ${targetDoctor.name} (${targetDoctor.voiceId}):`, err.message);
      commitDoctorText();
      if (playbackSessionTokenRef.current === token) {
        playBrowserFallback(targetDoctor.voiceProfile?.locale);
      }
    }
  }, [stopSpeechRecognitionListening, stopAndClearActiveAudio, logPlaybackLifecycle, getHardwareAudioLatency]);

  // Active Consultation Speaker Transition Handler
  const handleSelectDoctor = useCallback((doc: DoctorProfile) => {
    if (selectedDoctor.id === doc.id) return;

    if (sessionMode !== "ACTIVE_CONSULTATION" || !callActiveRef.current) {
      setSelectedDoctor(doc);
      setActiveSpeaker({
        id: doc.id,
        name: doc.name,
        voiceId: doc.voiceId,
        specialty: doc.specialty,
        department: doc.department,
        avatarUrl: doc.avatarUrl,
        voiceGender: doc.voiceGender,
        voiceEngine: "Kokoro",
      });
      return;
    }

    // Active consultation speaker handover
    // 1. Halt existing audio and intake immediately
    stopAndClearActiveAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
    stopSpeechRecognitionListening();

    // 2. Invalidate any in-flight async TTS generation
    playbackSessionTokenRef.current += 1;
    const currentToken = playbackSessionTokenRef.current;

    // 3. Update active doctor and speaker state
    setSelectedDoctor(doc);
    setActiveSpeaker({
      id: doc.id,
      name: doc.name,
      voiceId: doc.voiceId,
      specialty: doc.specialty,
      department: doc.department,
      avatarUrl: doc.avatarUrl,
      voiceGender: doc.voiceGender,
      voiceEngine: "Kokoro",
    });

    // 4. Create explicit system announcement and new doctor greeting in the transcript
    const timeNow = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const systemNotice: ChatMessage = {
      id: `sys-switch-${Date.now()}`,
      role: "system",
      text: `${doc.name} (${doc.department}) has joined the consultation.`,
      timestamp: timeNow,
    };

    const greetingText = `I am ${doc.name}, ${doc.department}. I've reviewed the clinical information gathered so far. How can I assist with your symptoms?`;
    const doctorMessage: ChatMessage = {
      id: `doc-switch-${Date.now() + 1}`,
      role: "doctor",
      text: greetingText,
      timestamp: timeNow,
      doctorName: doc.name,
      doctorSpecialty: doc.department,
      doctorId: doc.id,
    };

    setMessages((prev) => [...prev, systemNotice]);
    setPendingDoctorMessage({
      id: doctorMessage.id,
      doctorName: doc.name,
      doctorSpecialty: doc.department,
    });

    // 5. Synthesize intro using new doctor's authoritative voice
    speakDoctorResponse(greetingText, doc.id, currentToken, {
      clinicalReceivedAt: performance.now(),
      onPlaybackStart: () => {
        setPendingDoctorMessage(null);
        setMessages((prev) => {
          if (prev.some((m) => m.id === doctorMessage.id)) return prev;
          return [...prev, doctorMessage];
        });
      },
      onFallback: () => {
        setPendingDoctorMessage(null);
        setMessages((prev) => {
          if (prev.some((m) => m.id === doctorMessage.id)) return prev;
          return [...prev, doctorMessage];
        });
      },
    });
  }, [selectedDoctor.id, sessionMode, stopSpeechRecognitionListening, speakDoctorResponse]);

  // Speech Recognition with Continuous Intake, MediaRecorder audio buffering & Natural Silence Detection
  const startSpeechRecognitionListening = useCallback(() => {
    if (typeof window === "undefined") return;

    // Stop and cleanly detach any previous recognition and recorder instance
    stopSpeechRecognitionListening();

    accumulatedTranscriptRef.current = "";
    transcriptTextRef.current = "";
    setTranscriptText("");
    audioChunksRef.current = [];

    // 1. Initialize MediaRecorder for canonical Whisper ASR
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }).then((stream) => {
        mediaStreamRef.current = stream;

        // Initialize Live Paralinguistic DSP Analyzer on the active MediaStream
        try {
          if (acousticAnalyzerRef.current) {
            acousticAnalyzerRef.current.dispose();
          }
          const analyzer = new AcousticDSPAnalyzer();
          analyzer.start(stream);
          acousticAnalyzerRef.current = analyzer;
        } catch (dspErr) {
          console.warn("Acoustic DSP Analyzer initialization notice:", dspErr);
        }

        try {
          let mimeType = "";
          if (typeof MediaRecorder !== "undefined") {
            if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
              mimeType = "audio/webm;codecs=opus";
            } else if (MediaRecorder.isTypeSupported("audio/webm")) {
              mimeType = "audio/webm";
            } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
              mimeType = "audio/mp4";
            }
          }
          const options = mimeType ? { mimeType } : undefined;
          const recorder = new MediaRecorder(stream, options);
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              audioChunksRef.current.push(e.data);
            }
          };
          recorder.start(250);
          mediaRecorderRef.current = recorder;
          setAudioState("PATIENT_LISTENING");
          setMicPermissionError(null);
        } catch (recErr) {
          console.warn("MediaRecorder initialization notice:", recErr);
        }
      }).catch((streamErr) => {
        console.warn("Microphone stream access notice:", streamErr);
        if (streamErr?.name === "NotAllowedError" || streamErr?.name === "PermissionDeniedError") {
          setMicPermissionError("Microphone access denied. Please click the camera/mic icon in your browser address bar to allow.");
          setAudioState("IDLE");
        }
      });
    }

    // 2. Initialize browser SpeechRecognition for interim live preview captions
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      // Continuous = true ensures the engine does not prematurely abort when the user pauses
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setMicPermissionError(null);
        setAudioState("PATIENT_LISTENING");
      };

      recognition.onresult = (event: any) => {
        let currentInterim = "";
        let newFinal = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            newFinal += res[0].transcript + " ";
          } else {
            currentInterim += res[0].transcript;
          }
        }

        if (newFinal) {
          accumulatedTranscriptRef.current = (accumulatedTranscriptRef.current + " " + newFinal).replace(/\s+/g, " ").trim();
        }

        const fullDisplay = (accumulatedTranscriptRef.current + " " + currentInterim).replace(/\s+/g, " ").trim();
        transcriptTextRef.current = fullDisplay;
        setTranscriptText(fullDisplay);

        // Reset silence timer on speech activity. Gives the user 1.8s of silence to pause without cut-off.
        if (fullDisplay.length > 0) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = setTimeout(() => {
            const currentTotal = transcriptTextRef.current.trim();
            if ((currentTotal.length > 0 || audioChunksRef.current.length > 0) && audioStateRef.current === "PATIENT_LISTENING") {
              console.log("⏱️ Natural 1.8s silence pause detected. Committing speech:", currentTotal);
              commitSpokenText(currentTotal);
            }
          }, 1800);
        }
      };

      recognition.onerror = (e: any) => {
        console.warn("Speech recognition notice:", e.error);
        if (e.error === "not-allowed") {
          setMicPermissionError("Microphone access denied. Please click the camera/mic icon in your browser address bar to allow.");
          setAudioState("IDLE");
          stopSpeechRecognitionListening();
        }
      };

      recognition.onend = () => {
        // Continuous listening watchdog: if browser times out stream while still in listening state, restart cleanly
        if (callActiveRef.current && audioStateRef.current === "PATIENT_LISTENING") {
          setTimeout(() => {
            if (callActiveRef.current && audioStateRef.current === "PATIENT_LISTENING") {
              try {
                recognition.start();
              } catch {
                // If recognition restart fails, MediaRecorder is still active
              }
            }
          }, 200);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setAudioState("PATIENT_LISTENING");
    } catch (err: any) {
      console.warn("Speech recognition start notice:", err);
      if (err?.message?.includes("already started")) {
        setAudioState("PATIENT_LISTENING");
      }
    }
  }, [stopSpeechRecognitionListening, commitSpokenText]);

  // Synchronize dynamic refs
  useEffect(() => {
    startSpeechRecognitionListeningRef.current = startSpeechRecognitionListening;
  }, [startSpeechRecognitionListening]);

  // Non-blocking background model pre-warming on consultation mount:
  // Preloads Kokoro model and executes initial JIT/memory buffer allocation in the background,
  // completely decoupled from user UI interactions and microphone arming.
  useEffect(() => {
    const tPrewarmStart = performance.now();
    fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prewarm: true, doctorId: selectedDoctor.id }),
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          console.log(
            `%c[MedVoice Audio] Background Kokoro TTS prewarmed in ${(performance.now() - tPrewarmStart).toFixed(0)} ms (Engine latency: ${data.latencyMs} ms)`,
            "color: #10b981; font-family: monospace; font-size: 11px; font-weight: bold;"
          );
        }
      })
      .catch((err) => {
        console.warn("[MedVoice Audio] Background prewarm notice:", err);
      });
  }, [selectedDoctor.id]);

  // Active Consultation Live Timer Effect
  useEffect(() => {
    if (!callActive) return;
    const interval = setInterval(() => {
      if (consultationStartedAtRef.current) {
        const elapsed = Math.floor((Date.now() - consultationStartedAtRef.current) / 1000);
        setCallDuration(elapsed);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [callActive]);

  // Start consultation session
  const startConsultation = async (doc?: DoctorProfile) => {
    const doctorToUse = doc || selectedDoctor;
    if (doc) setSelectedDoctor(doc);
    setActiveSpeaker({
      id: doctorToUse.id,
      name: doctorToUse.name,
      voiceId: doctorToUse.voiceId,
      specialty: doctorToUse.specialty,
      department: doctorToUse.department,
      avatarUrl: doctorToUse.avatarUrl,
      voiceGender: doctorToUse.voiceGender,
      voiceEngine: "Kokoro",
    });
    const now = Date.now();
    consultationStartedAtRef.current = now;
    consultationCompletedAtRef.current = null;
    callActiveRef.current = true;
    setCallActive(true);
    setCallDuration(0);
    setMicPermissionError(null);
    setSessionMode("ACTIVE_CONSULTATION");

    if (!stableEncounterIdRef.current) {
      const genId = `ENC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      stableEncounterIdRef.current = genId;
      setCurrentEncounterId(genId);
      serverEncounterCreatedRef.current = false;
      ensureServerEncounter(genId, "Clinical voice consultation initiation").catch((err) =>
        console.warn("[MedVoice] Pre-initialize encounter notice:", err)
      );
    }

    // Pre-warm the persistent HTML5 AudioElement during the user gesture to prime autoplay privileges
    if (typeof window !== "undefined" && !persistentAudioRef.current) {
      try {
        const warmAudio = new Audio();
        warmAudio.preload = "auto";
        persistentAudioRef.current = warmAudio;
      } catch {}
    }

    const initialGreeting: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "doctor",
      text: doctorToUse.greeting,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      doctorName: doctorToUse.name,
      doctorSpecialty: doctorToUse.specialty || doctorToUse.department
    };

    setPendingDoctorMessage({
      id: initialGreeting.id,
      doctorName: doctorToUse.name,
      doctorSpecialty: doctorToUse.specialty || doctorToUse.department,
    });

    speakDoctorResponse(doctorToUse.greeting, doctorToUse.id, undefined, {
      clinicalReceivedAt: performance.now(),
      onPlaybackStart: () => {
        setPendingDoctorMessage(null);
        setMessages([initialGreeting]);
      },
      onFallback: () => {
        setPendingDoctorMessage(null);
        setMessages([initialGreeting]);
      },
    });
  };

  // Handle initial voice consultation start from pending_activation orb (ChatGPT-style voice initiation)
  const handleStartVoiceConsultation = useCallback(() => {
    setConsultationStarted(true);
    // Prime audio element synchronously during user gesture for browser autoplay privileges
    if (typeof window !== "undefined" && !persistentAudioRef.current) {
      try {
        const warmAudio = new Audio();
        warmAudio.preload = "auto";
        persistentAudioRef.current = warmAudio;
      } catch {}
    }
    // Generate encounter ID if not yet assigned
    if (!stableEncounterIdRef.current) {
      const genId = `ENC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      stableEncounterIdRef.current = genId;
      setCurrentEncounterId(genId);
      encounterVersionRef.current = 0;
      serverEncounterCreatedRef.current = false;
      ensureServerEncounter(genId, "Clinical voice consultation initiation").catch((err) =>
        console.warn("[MedVoice] Pre-initialize encounter notice:", err)
      );
    }
    consultationStartedAtRef.current = Date.now();

    const greetingText = getPersonalizedGreeting(selectedDoctor);
    const initialGreetingMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "doctor",
      text: greetingText,
      timestamp: "Just now",
      doctorName: selectedDoctor.name,
      doctorSpecialty: selectedDoctor.specialty || selectedDoctor.department,
      doctorId: selectedDoctor.id,
    };

    setPendingDoctorMessage({
      id: initialGreetingMessage.id,
      doctorName: selectedDoctor.name,
      doctorSpecialty: selectedDoctor.specialty || selectedDoctor.department,
    });
    // Set explicit INTRODUCING state so UI displays synthesizing indicator, NOT speaking prematurely
    setAudioState("INTRODUCING");

    // Synthesize opening doctor speech via Kokoro Neural TTS
    speakDoctorResponse(greetingText, selectedDoctor.id, undefined, {
      clinicalReceivedAt: performance.now(),
      onPlaybackStart: () => {
        setPendingDoctorMessage(null);
        setMessages([initialGreetingMessage]);
      },
      onFallback: () => {
        setPendingDoctorMessage(null);
        setMessages([initialGreetingMessage]);
      },
    });
  }, [selectedDoctor, speakDoctorResponse, getPersonalizedGreeting]);

  // Persist consultation record to primary archive (State machine: completed_pending_review)
  const persistEncounterRecord = async (
    encId: string,
    durationSecs: number,
    statusOverride: "in_progress" | "incomplete_intake" | "completed_pending_review" | "approved" = "completed_pending_review",
    customMessages?: ChatMessage[],
    customTriage?: any,
    initialConcernOverride?: string,
    customCaseVersion?: number
  ): Promise<boolean> => {
    if (isPersistingEncounterRef.current) {
      return false;
    }
    isPersistingEncounterRef.current = true;
    setPersistenceStatus("saving");
    setPersistenceError(null);

    const activeMessages = customMessages || messages;
    const activeTriage = customTriage !== undefined ? customTriage : triageData;

    const patientUtterances = activeMessages.filter((m) => m.role === "patient");
    const chiefConcern = initialConcernOverride || (
      patientUtterances.length > 0
        ? patientUtterances[0].text.replace(/^"|"$/g, "")
        : activeTriage?.detectedSymptoms?.length
        ? activeTriage.detectedSymptoms.join(", ")
        : "Clinical voice intake consultation"
    );

    const hasCompleteSoap = Boolean(activeTriage?.soap?.subjective && activeTriage?.soap?.assessment);
    const isEarlyTermination = !hasCompleteSoap && statusOverride === "completed_pending_review";

    const soapSubjective = activeTriage?.soap?.subjective || (
      isEarlyTermination
        ? `[INCOMPLETE INTAKE - GATHERING HISTORY]\nChief Concern: ${chiefConcern}\nDialogue turns recorded: ${activeMessages.length}. Patient ended consultation prior to formal multi-agent clinical consensus.`
        : statusOverride === "in_progress"
        ? `[IN PROGRESS DRAFT - GATHERING HISTORY]\nChief Concern: ${chiefConcern}\nTurns recorded: ${activeMessages.length}.`
        : ""
    );
    const soapObjective = activeTriage?.soap?.objective || (
      isEarlyTermination
        ? "[INCOMPLETE INTAKE] Telemetry and physical examination unassessed. Physical presence not established."
        : statusOverride === "in_progress"
        ? "[IN PROGRESS] History gathering in progress. Physical telemetry unassessed."
        : ""
    );
    const soapAssessment = activeTriage?.soap?.assessment || (
      isEarlyTermination
        ? "[INCOMPLETE INTAKE] Intake terminated prior to multi-agent deliberation. Formal differential diagnosis deferred pending complete history."
        : statusOverride === "in_progress"
        ? "[IN PROGRESS] Clinical evaluation in progress. Differential diagnosis deferred."
        : ""
    );
    const soapPlan = activeTriage?.soap?.plan || (
      isEarlyTermination
        ? "[INCOMPLETE INTAKE] Recommend re-initiating full clinical intake or scheduling an in-person evaluation with a physician."
        : statusOverride === "in_progress"
        ? "[IN PROGRESS] Continue clinical intake dialogue."
        : ""
    );

    // Monotonic optimistic concurrency version calculation
    let nextCaseVersion: number;
    if (customCaseVersion !== undefined) {
      nextCaseVersion = customCaseVersion;
    } else if (interviewState?.caseVersion && typeof interviewState.caseVersion === "number") {
      nextCaseVersion = Math.max(interviewState.caseVersion, encounterVersionRef.current + 1);
    } else if (encounterVersionRef.current === 0) {
      nextCaseVersion = 1;
    } else {
      nextCaseVersion = encounterVersionRef.current + 1;
    }

    const payload = {
      id: encId,
      patientName: patientDisplayName || "Anonymous Patient",
      patientAge: activeProfile?.age != null ? String(activeProfile.age) : undefined,
      patientGender: activeProfile?.gender || undefined,
      doctorId: selectedDoctor.id,
      doctorName: selectedDoctor.name,
      specialty: selectedDoctor.department || selectedDoctor.specialty,
      chiefComplaint: chiefConcern,
      transcript: activeMessages.map((m) => ({
        role: m.role,
        text: m.text,
        timestamp: m.timestamp,
      })),
      triageLevel: activeTriage?.triageLevel || (boardData?.phase === "decided" ? "priority" : "routine"),
      triageTitle: isEarlyTermination
        ? "INCOMPLETE INTAKE: GATHERING HISTORY"
        : activeTriage?.triageTitle || "Clinical Voice Consultation Evaluation",
      esiScore: activeTriage?.esiScore ?? null,
      icd10Codes: activeTriage?.icdCodes || [],
      detectedSymptoms: activeTriage?.detectedSymptoms || [],
      soapSubjective,
      soapObjective,
      soapAssessment,
      soapPlan,
      recommendedSpecialists: selectedDoctor?.department ? [selectedDoctor.department] : [],
      recommendedAction: isEarlyTermination
        ? "Consultation ended early. Please schedule an in-person evaluation or restart clinical intake."
        : activeTriage?.recommendedAction || "Consultation complete.",
      durationSeconds: durationSecs,
      status: statusOverride,
      interviewState: interviewState,
      deliveredTurnRecords: interviewState?.deliveredTurnRecords || [],
      attributedFacts: interviewState?.attributedFacts || [],
      unmappedObservations: interviewState?.unmappedObservations || [],
      caseVersion: nextCaseVersion,
    };

    // Client-side transient recovery cache update (tab-isolated with 15-minute TTL)
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const recoveryRecord = {
          payload,
          savedAt: Date.now(),
          expiresAt: Date.now() + 15 * 60 * 1000,
        };
        window.sessionStorage.setItem(`medvoice_transient_draft_${encId}`, JSON.stringify(recoveryRecord));
      } catch {}
    }

    try {
      const consultEndpoint = (!user?.id) ? "/api/consultations?demo=true" : "/api/consultations";
      const res = await fetch(consultEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        const serverVersion = resData.consultation?.caseVersion ?? resData.consultation?.version ?? nextCaseVersion;
        encounterVersionRef.current = Number(serverVersion);
        setPersistenceStatus("saved");
        setPersistenceError(null);
        serverEncounterCreatedRef.current = true;
        if (statusOverride === "completed_pending_review" || statusOverride === "approved") {
          if (typeof window !== "undefined" && window.sessionStorage) {
            try {
              window.sessionStorage.removeItem(`medvoice_transient_draft_${encId}`);
            } catch {}
          }
        }
        return true;
      } else if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        console.warn("[MedVoice Concurrency] 409 conflict during persist:", data.error);
        const match = typeof data.error === "string" ? data.error.match(/datastore version \((\d+)\)/) : null;
        const currentDatastoreVersion = match ? parseInt(match[1], 10) : encounterVersionRef.current + 1;
        encounterVersionRef.current = currentDatastoreVersion + 1;

        // Auto-reconcile with bumped version without crashing UI
        try {
          const retryPayload = { ...payload, caseVersion: encounterVersionRef.current };
          const retryRes = await fetch(consultEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(retryPayload),
          });
          if (retryRes.ok) {
            const retryData = await retryRes.json().catch(() => ({}));
            const serverVersion = retryData.consultation?.caseVersion ?? retryData.consultation?.version ?? encounterVersionRef.current;
            encounterVersionRef.current = Number(serverVersion);
            serverEncounterCreatedRef.current = true;
            setPersistenceStatus("saved");
            setPersistenceError(null);
            return true;
          }
        } catch (retryErr) {
          console.warn("[MedVoice Concurrency] Auto-reconciliation retry notice:", retryErr);
        }
        setPersistenceStatus("error");
        setPersistenceError(data.error || "Encounter version conflict.");
        return false;
      } else {
        const data = await res.json().catch(() => ({}));
        console.warn("[MedVoice Encounter Sync] Persistence notice:", data.error || res.statusText);
        setPersistenceStatus("error");
        setPersistenceError(data.error || "Failed to persist consultation to clinical archive.");
        return false;
      }
    } catch (err: any) {
      console.warn("Auto-persist encounter error:", err);
      setPersistenceStatus("error");
      setPersistenceError(err?.message || "Encounter sync failed.");
      return false;
    } finally {
      isPersistingEncounterRef.current = false;
    }
  };

  // Pre-initialize or confirm encounter record exists on the server datastore
  const ensureServerEncounter = async (encId: string, initialChiefConcern?: string): Promise<boolean> => {
    if (serverEncounterCreatedRef.current) return true;
    if (serverEncounterPromiseRef.current) {
      return serverEncounterPromiseRef.current;
    }
    const p = (async () => {
      const ok = await persistEncounterRecord(
        encId,
        0,
        "in_progress",
        messages.length > 0 ? messages : undefined,
        undefined,
        initialChiefConcern,
        1
      );
      if (ok) {
        serverEncounterCreatedRef.current = true;
      }
      return ok;
    })();
    serverEncounterPromiseRef.current = p;
    try {
      return await p;
    } finally {
      serverEncounterPromiseRef.current = null;
    }
  };

  // End consultation session
  const endConsultation = () => {
    playbackSessionTokenRef.current += 1;
    setPendingDoctorMessage(null);
    const completedAt = Date.now();
    consultationCompletedAtRef.current = completedAt;
    const startedAt = consultationStartedAtRef.current || completedAt;
    const elapsedSeconds = Math.max(1, Math.round((completedAt - startedAt) / 1000));
    setCallDuration(elapsedSeconds);

    setCallActive(false);
    callActiveRef.current = false;
    setAudioState("IDLE");
    setTranscriptText("");
    transcriptTextRef.current = "";
    accumulatedTranscriptRef.current = "";
    setInterviewState(null);
    stopAndClearActiveAudio();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
    stopSpeechRecognitionListening();
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (!stableEncounterIdRef.current) {
      const genId = `ENC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
      stableEncounterIdRef.current = genId;
      setCurrentEncounterId(genId);
    }

    setSessionMode("CONSULT_COMPLETE");

    // Distinguish incomplete intake from completed clinical assessment
    const hasCompleteSoap = Boolean(triageData?.soap?.subjective && triageData?.soap?.assessment);
    const finalStatus = hasCompleteSoap ? "completed_pending_review" : "incomplete_intake";
    persistEncounterRecord(stableEncounterIdRef.current, elapsedSeconds, finalStatus);
  };

  // Return to lobby and start new consultation
  const startNewConsultation = () => {
    playbackSessionTokenRef.current += 1;
    setPendingDoctorMessage(null);
    stopSpeechRecognitionListening();
    if (typeof window !== "undefined" && window.sessionStorage && stableEncounterIdRef.current) {
      try {
        window.sessionStorage.removeItem(`medvoice_transient_draft_${stableEncounterIdRef.current}`);
      } catch {}
    }
    consultationStartedAtRef.current = null;
    consultationCompletedAtRef.current = null;
    setMessages([]);
    setTriageData(null);
    setBoardData(null);
    setCallDuration(0);
    setTranscriptText("");
    transcriptTextRef.current = "";
    accumulatedTranscriptRef.current = "";
    setTypedInput("");
    setInterviewState(null);
    setAudioState("IDLE");
    stableEncounterIdRef.current = "";
    serverEncounterCreatedRef.current = false;
    encounterVersionRef.current = 0;
    setCurrentEncounterId("");
    setPersistenceStatus("idle");
    setPersistenceError(null);
    setSessionMode("CONSULT_LOBBY");
  };

  // Process User Utterance (Preserves exact spoken text without artificial tag prefixes)
  const handleUserUtterance = async (userText: string, isBargeIn: boolean = false, audioMetrics?: LiveAudioMetrics) => {
    const cleanUserText = userText.trim();
    if (!cleanUserText) return;

    if (!consultationStarted) {
      setConsultationStarted(true);
      if (!consultationStartedAtRef.current) {
        consultationStartedAtRef.current = Date.now();
      }
    }

    // Cleanly stop microphone while backend deliberates
    stopSpeechRecognitionListening();

    if (!callActive) {
      callActiveRef.current = true;
      setCallActive(true);
    }

    setAudioState(isBargeIn ? "PROCESSING_INTERRUPTION" : "PROCESSING_CLINICAL");
    setTranscriptText("");
    transcriptTextRef.current = "";
    accumulatedTranscriptRef.current = "";

    // Exact patient words — no "URGENT BARGE-IN" text injection!
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "patient",
      text: cleanUserText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isBargeIn
    };

    setMessages((prev) => [...prev, userMessage]);

    const clientTurnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Ensure the encounter is registered on the server before sending the dialogue turn
    if (!serverEncounterCreatedRef.current && stableEncounterIdRef.current) {
      await ensureServerEncounter(stableEncounterIdRef.current, cleanUserText);
    }

    try {
      const chatPayload = {
        encounterId: stableEncounterIdRef.current,
        doctorId: selectedDoctor.id,
        message: cleanUserText,
        conversationHistory: [...messages, userMessage],
        patientName: patientDisplayName,
        patientAge: activeProfile?.age != null ? String(activeProfile.age) : undefined,
        patientId: activeProfile?.id,
        patientRelationship: activeProfile?.relationshipToUser || "self",
        patientProfile: activeProfile || undefined,
        userId: user?.id,
        isInterruption: isBargeIn,
        interruptedAgent: selectedDoctor.name,
        interviewState: interviewState,
        userLocation: userLocation || undefined,
        locationPermission: locationPermission,
        audioMetrics: audioMetrics || undefined,
        stream: true,
      };

      let res = await fetch("/api/voice/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream, application/json",
          "x-turn-id": clientTurnId,
        },
        body: JSON.stringify(chatPayload),
      });

      // Self-healing recovery: if server reported 404 encounter not found, register on server and retry once
      if (res.status === 404 && stableEncounterIdRef.current) {
        console.warn("[MedVoice] Encounter 404 detected; self-healing by registering encounter on server and retrying...");
        serverEncounterCreatedRef.current = false;
        await ensureServerEncounter(stableEncounterIdRef.current, cleanUserText);
        res = await fetch("/api/voice/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream, application/json",
            "x-turn-id": clientTurnId,
          },
          body: JSON.stringify(chatPayload),
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Clinical response failed: ${res.status}`);
      }

      const clinicalReceivedTime = performance.now();
      const isSse = Boolean(res.headers.get("content-type")?.includes("text/event-stream"));
      let data: any;

      if (isSse && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalData: any = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";

          for (const block of blocks) {
            if (!block.trim()) continue;
            let eventType = "message";
            let eventData = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventType = line.slice(6).trim();
              else if (line.startsWith("data:")) eventData = line.slice(5).trim();
            }
            if (eventData) {
              let parsed: any;
              try { parsed = JSON.parse(eventData); } catch { parsed = eventData; }
              if (eventType === "done") {
                finalData = parsed;
              }
            }
          }
        }
        data = finalData || { doctorReply: "I have received your symptoms and documented them." };
      } else {
        data = await res.json();
      }
      const doctorReplyText = data.doctorReply || "I have received your symptoms and documented them.";

      const respondingDoctorId = data.doctor?.id || selectedDoctor.id;
      const respondingDoctorProfile = getDoctorById(respondingDoctorId) || selectedDoctor;
      const respondingDoctorName = data.doctor?.name || respondingDoctorProfile.name;
      const respondingDoctorSpecialty = data.doctor?.specialty || respondingDoctorProfile.specialty || respondingDoctorProfile.department;

      setActiveSpeaker({
        id: respondingDoctorProfile.id,
        name: respondingDoctorProfile.name,
        voiceId: respondingDoctorProfile.voiceId,
        specialty: respondingDoctorProfile.specialty,
        department: respondingDoctorProfile.department,
        avatarUrl: respondingDoctorProfile.avatarUrl,
        voiceGender: respondingDoctorProfile.voiceGender,
        voiceEngine: "Kokoro",
      });

      const newDoctorMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "doctor",
        text: doctorReplyText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        doctorName: respondingDoctorName,
        doctorSpecialty: respondingDoctorSpecialty
      };

      // Set pending state to display doctor formulation indicator during TTS synthesis
      setPendingDoctorMessage({
        id: newDoctorMessage.id,
        doctorName: respondingDoctorName,
        doctorSpecialty: respondingDoctorSpecialty,
      });

      if (data.interviewState) {
        setInterviewState(data.interviewState);
      }

      if (data.nearbyHospitals && data.nearbyHospitals.length > 0) {
        setNearbyHospitals(data.nearbyHospitals);
        // If the patient expressed an access constraint, proactively bring attention to Care Options
        if (data.interviewState?.structuredHistory?.accessConstraints?.financial || data.interviewState?.structuredHistory?.accessConstraints?.remoteLocation) {
          setActiveRightTab("care");
        }
      }

      if (data.triage) {
        setTriageData(data.triage);
        if (data.triage.triageLevel === "emergency") {
          setClinicalToasts((prev) => [
            ...prev,
            {
              id: `triage-emerg-${Date.now()}`,
              type: "warning",
              title: "ESI-2 Emergency Triage Flagged",
              description: "Critical clinical invariants flagged. Immediate hospital ED escalation recommended."
            }
          ]);
        } else if (data.triage.esiScore && data.triage.esiScore <= 3) {
          setClinicalToasts((prev) => [
            ...prev,
            {
              id: `triage-esi-${Date.now()}`,
              type: "info",
              title: `ESI-${data.triage.esiScore} Urgency Classified`,
              description: `Triage rating: ${data.triage.triageTitle || "Priority Outpatient Evaluation"}.`
            }
          ]);
        }
      }
      if (data.board) {
        setBoardData(data.board);
        const isHistoryGathering =
          data.board.phase === "dormant" ||
          data.board.phase === "gathering_history" ||
          data.board.phase === "active_inquiring" ||
          data.triage?.triageLevel === "gathering_history" ||
          data.interviewState?.informationState === "insufficient";

        if (isHistoryGathering) {
          setActiveRightTab("context");
        } else {
          setActiveRightTab("context");
        }
      }

      // Autosave turn-by-turn draft encounter so navigating away never loses dialogue state
      if (!stableEncounterIdRef.current) {
        const genId = `ENC-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
        stableEncounterIdRef.current = genId;
        setCurrentEncounterId(genId);
      }
      const currentStartedAt = consultationStartedAtRef.current || Date.now();
      const currentElapsed = Math.max(1, Math.round((Date.now() - currentStartedAt) / 1000));
      const turnMessages = [...messages, userMessage, newDoctorMessage];
      persistEncounterRecord(stableEncounterIdRef.current, currentElapsed, "in_progress", turnMessages, data.triage);

      speakDoctorResponse(doctorReplyText, respondingDoctorId, undefined, {
        clinicalReceivedAt: clinicalReceivedTime,
        onPlaybackStart: () => {
          setPendingDoctorMessage(null);
          setMessages((prev) => {
            if (prev.some((m) => m.id === newDoctorMessage.id)) return prev;
            return [...prev, newDoctorMessage];
          });
        },
        onFallback: () => {
          setPendingDoctorMessage(null);
          setMessages((prev) => {
            if (prev.some((m) => m.id === newDoctorMessage.id)) return prev;
            return [...prev, newDoctorMessage];
          });
        },
      });
    } catch (err) {
      console.error("Consultation chat error:", err);
      setPendingDoctorMessage(null);
      if (callActiveRef.current) {
        setAudioState("PATIENT_LISTENING");
      } else {
        setAudioState("IDLE");
      }
    }
  };

  useEffect(() => {
    handleUserUtteranceRef.current = handleUserUtterance;
  });

  // Auto-scroll conversation feed to latest turn or pending response
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, pendingDoctorMessage]);

  // Helper for Doctor Status
  const getDoctorLiveStatus = (doc: DoctorProfile) => {
    if (audioState === "DOCTOR_SPEAKING" && activeSpeaker.id === doc.id) {
      return { label: "Speaking", color: "text-emerald-700 bg-emerald-50", dot: "bg-emerald-500 animate-pulse" };
    }
    if (doc.id === "dr-sarah-chen") {
      return { label: "Lead", color: "text-cyan-800 bg-cyan-50", dot: "bg-cyan-500" };
    }
    // Check if specialist has an active request
    const isSpecialistInquiring = boardData?.active_requests?.some((r: any) =>
      r.status === "pending" && doc.name.toLowerCase().includes(r.doctorName?.toLowerCase().split(" ")[1] || "")
    );
    if (isSpecialistInquiring) {
      return { label: "Inquiring", color: "text-amber-800 bg-amber-50", dot: "bg-amber-500 animate-pulse" };
    }
    if (boardData?.active_specialists?.some(s => s.toLowerCase().includes(doc.name.toLowerCase().split(" ")[1] || ""))) {
      return { label: "In Board", color: "text-blue-800 bg-blue-50", dot: "bg-blue-500" };
    }
    return { label: "Standby", color: "text-slate-500 bg-slate-100", dot: "bg-slate-300" };
  };

  // Doctor Icons
  const getDoctorIcon = (docName: string, specialty: string) => {
    const s = (specialty + " " + docName).toLowerCase();
    if (s.includes("cardio") || s.includes("vance")) {
      return <HeartPulse className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />;
    }
    if (s.includes("neuro") || s.includes("arthur") || s.includes("pendelton")) {
      return <Brain className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />;
    }
    if (s.includes("pedia") || s.includes("rostova")) {
      return <Baby className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />;
    }
    return <Stethoscope className="w-3.5 h-3.5 text-cyan-600 flex-shrink-0" />;
  };

  // Event Badges
  const getEventBadge = (type: string, isLead: boolean) => {
    switch (type) {
      case "challenge":
        return { label: "↳ CHALLENGE", color: "text-amber-700" };
      case "response":
        return { label: "↻ RESPONSE", color: "text-purple-700" };
      case "revision":
        return { label: "↗ REVISION", color: "text-indigo-700" };
      case "synthesis":
        return { label: "★ SYNTHESIS", color: "text-cyan-700" };
      case "assessment":
      default:
        return isLead
          ? { label: "● INTAKE", color: "text-cyan-700" }
          : { label: "● ASSESSMENT", color: "text-slate-600" };
    }
  };

  const activeSpecialistsCount = boardData?.active_specialists?.length || (boardData?.opinions?.length ? boardData.opinions.length : 1);
  const currentRound = boardData?.deliberation_rounds || (boardData?.peer_challenges_count ? 2 : 1);


  // GSAP subtle entrance choreography for consult room
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ctx = gsap.context(() => {
      gsap.from(".consult-room-container", {
        opacity: 0,
        y: 14,
        duration: 0.5,
        ease: "power2.out",
      });
    });
    return () => ctx.revert();
  }, []);

  const getOrbState = (): VoiceOrbState => {
    if (!consultationStarted) return "pending_activation";
    if (micPermissionError) return "error";
    switch (audioState) {
      case "INTRODUCING":
        return "thinking";
      case "PATIENT_LISTENING":
        return "listening";
      case "PROCESSING_TRANSCRIPTION":
        return "transcribing";
      case "TRANSCRIPT_REVIEW":
        return "reviewing";
      case "PROCESSING_CLINICAL":
        return "thinking";
      case "DOCTOR_SPEAKING":
        return "speaking";
      case "BARGE_IN_DETECTED":
        return "interrupted";
      case "REQUESTING_MIC":
        return "requesting_mic";
      case "ERROR":
        return "error";
      case "IDLE":
      default:
        return "ready";
    }
  };

  const handleApproveTranscript = (approvedText: string) => {
    const textToSend = approvedText.trim();
    if (!textToSend) return;
    setPendingReviewTranscript("");
    setAudioState("PROCESSING_CLINICAL");
    handleUserUtteranceRef.current?.(textToSend, false, pendingAudioMetricsRef.current);
  };

  const handleReRecord = () => {
    setPendingReviewTranscript("");
    setAudioState("PATIENT_LISTENING");
    startSpeechRecognitionListening();
  };

  const handleCancelReview = () => {
    setPendingReviewTranscript("");
    if (callActiveRef.current) {
      setAudioState("PATIENT_LISTENING");
    } else {
      setAudioState("IDLE");
    }
  };

  const handleMicClick = () => {
    if (!consultationStarted) {
      handleStartVoiceConsultation();
      return;
    }
    if (audioState === "PATIENT_LISTENING") {
      commitSpokenText();
    } else if (audioState === "DOCTOR_SPEAKING") {
      triggerBargeIn();
    } else if (audioState === "ERROR") {
      setMicPermissionError(null);
      startSpeechRecognitionListening();
    } else if (audioState === "IDLE" || audioState === "TRANSCRIPT_REVIEW") {
      setPendingReviewTranscript("");
      startSpeechRecognitionListening();
    }
  };
  return (
    <div className="relative min-h-screen bg-[#FAF9F6] text-[#05070F] flex flex-col font-sans selection:bg-[#B7FF72] selection:text-[#05070F] overflow-x-clip">
      <LandingFloatingNavbar />

      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-32 sm:pt-36 pb-16 flex flex-col gap-6 consult-room-container">
        {/* 1. TOP HEADER: Clinician status, Timer, Specialists count, SOAP & End consultation */}
        <ConsultHeader
          doctor={selectedDoctor}
          callDuration={callDuration}
          isSessionActive={consultationStarted}
          audioStateLabel={
            audioState === "DOCTOR_SPEAKING"
              ? "Doctor speaking response…"
              : audioState === "INTRODUCING"
              ? "Connecting doctor voice…"
              : audioState === "PATIENT_LISTENING"
              ? "Listening to your voice…"
              : audioState === "TRANSCRIPT_REVIEW"
              ? "Reviewing captured speech…"
              : audioState === "PROCESSING_TRANSCRIPTION"
              ? "Transcribing with Whisper…"
              : audioState === "PROCESSING_CLINICAL"
              ? "Clinical synthesis in progress…"
              : !consultationStarted
              ? "Awaiting session start"
              : "Attending clinician ready"
          }
          hasMessages={messages.length > 0}
          onOpenSoapModal={() => setShowSoapModal(true)}
          onEndConsultation={endConsultation}
          onSelectDoctor={handleSelectDoctor}
          isDoctorSwitchingDisabled={audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_TRANSCRIPTION"}
        />

        {/* 2. MAIN WORKSPACE ASYMMETRIC GRID (7:5) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* LEFT PANEL (7 cols): Primary Voice Console & Conversation Stage */}
          <section className="lg:col-span-7 flex flex-col justify-between p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs min-h-[580px]">
            {/* STAGE A: When conversation has just started (only initial greeting) */}
            {messages.length <= 1 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 py-2">
                {/* Doctor Opening Statement Banner */}
                <div className="flex items-start gap-3.5 p-4 rounded-2xl bg-[#FAF9F6] border border-slate-200/90 shadow-2xs">
                  <div className="relative shrink-0">
                    <img
                      src={selectedDoctor.avatarUrl}
                      alt={selectedDoctor.name}
                      className="w-11 h-11 rounded-xl object-cover border border-slate-200"
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#B7FF72] border-2 border-white ring-1 ring-[#18251D]" />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-xs text-[#05070F] tracking-wide uppercase">
                          {selectedDoctor.name}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500 font-sans">
                          · {selectedDoctor.specialty || selectedDoctor.department}
                        </span>
                      </div>
                      {audioState === "DOCTOR_SPEAKING" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#18251D] text-[#B7FF72] border border-[#18251D]">
                          <Volume2 className="w-3 h-3 animate-pulse text-[#B7FF72]" />
                          <span>Doctor speaking…</span>
                        </span>
                      ) : audioState === "INTRODUCING" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#18251D] text-white border border-[#18251D]">
                          <span className="w-2 h-2 rounded-full bg-[#B7FF72] animate-ping" />
                          <span>Synthesizing voice…</span>
                        </span>
                      ) : !consultationStarted ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-50 text-amber-900 border border-amber-200">
                          Awaiting start · click orb below
                        </span>
                      ) : audioState === "PATIENT_LISTENING" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-900 border border-emerald-300">
                          <Mic className="w-3 h-3 text-emerald-600 animate-pulse" />
                          <span>Your turn to speak</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-400">Just now</span>
                      )}
                    </div>
                    <p className="text-sm sm:text-base text-slate-900 leading-relaxed font-medium">
                      {!consultationStarted
                        ? `Ready to begin consultation with ${selectedDoctor.name}. Click the voice orb below to start.`
                        : messages[0]?.text
                        ? `"${messages[0].text}"`
                        : "Preparing doctor greeting…"}
                    </p>
                  </div>
                </div>

                {/* Central ElevenLabs-Inspired Voice Stage */}
                <div className="flex-1 flex flex-col items-center justify-center py-4">
                  <ExpressiveVoiceOrb
                    state={getOrbState()}
                    audioLevel={liveAudioLevel}
                    speakerName={selectedDoctor.name}
                    errorMessage={micPermissionError || undefined}
                    onMicClick={handleMicClick}
                    onInterrupt={triggerBargeIn}
                    onStartConsultation={handleStartVoiceConsultation}
                  />

                  {/* Clinical Chief Complaint Starters */}
                  <div className="mt-4 flex flex-col items-center gap-2 w-full max-w-lg">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-slate-400">
                      Or select a symptom to discuss:
                    </span>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {[
                        "Crushing retrosternal chest pain",
                        "Severe throbbing migraine with aura",
                        "High fever with chills & cough",
                      ].map((prompt, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setTypedInput(prompt);
                          }}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-950 border border-slate-200/80 transition-all cursor-pointer shadow-2xs"
                        >
                          ⚡ {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* STAGE B: When multi-turn conversation is active */
              <div className="flex-1 flex flex-col gap-4">
                {/* Compact Acoustic Monitor Strip */}
                <ExpressiveVoiceOrb
                  state={getOrbState()}
                  audioLevel={liveAudioLevel}
                  speakerName={selectedDoctor.name}
                  errorMessage={micPermissionError || undefined}
                  onMicClick={handleMicClick}
                  onInterrupt={triggerBargeIn}
                  compact={true}
                />

                {/* Multi-Turn Conversation Feed */}
                <ConsultDialogueFeed
                  messages={messages}
                  pendingDoctorMessage={pendingDoctorMessage}
                  selectedDoctorName={selectedDoctor.name}
                  isDoctorSpeaking={audioState === "DOCTOR_SPEAKING"}
                  onInterrupt={triggerBargeIn}
                  micPermissionError={micPermissionError}
                />
              </div>
            )}

            {/* TRANSCRIPT REVIEW & CORRECTION BAR (Progressive disclosure on capture) */}
            {audioState === "TRANSCRIPT_REVIEW" && pendingReviewTranscript && (
              <div className="my-3 animate-in fade-in slide-in-from-top-2 duration-200">
                <TranscriptReviewBar
                  initialTranscript={pendingReviewTranscript}
                  onSend={handleApproveTranscript}
                  onReRecord={handleReRecord}
                  onCancel={handleCancelReview}
                />
              </div>
            )}

            {/* UNIFIED VOICE & TEXT COMPOSER */}
            <div className="pt-3 border-t border-slate-100">
              <VoicePill
                state={voicePillState}
                isSessionActive={consultationStarted}
                transcriptSnippet={transcriptText}
                typedValue={typedInput}
                onTypedChange={setTypedInput}
                speakerName={activeSpeaker.name}
                speakerVoiceId={activeSpeaker.voiceId}
                onSubmitText={(text) => {
                  setTypedInput("");
                  if (audioState === "DOCTOR_SPEAKING") {
                    triggerBargeIn(text);
                  } else {
                    handleUserUtterance(text, false);
                  }
                }}
                onToggleRecord={handleMicClick}
                onInterrupt={triggerBargeIn}
              />
            </div>
          </section>

          {/* RIGHT PANEL (5 cols): Clinical Context, History Completeness & Facilities */}
          <aside className="lg:col-span-5 flex flex-col gap-4">
            <ConsultClinicalContext
              completenessPercent={completenessPercent}
              establishedFindings={contextKnownFacts}
              missingElements={contextMissingDimensions}
              isEmergency={Boolean(triageData?.isEmergency)}
              triageLevel={triageData?.triageLevel}
              triageTitle={triageData?.triageTitle}
              esiScore={triageData?.esiScore}
              boardMessages={boardData?.opinions || []}
              nearbyHospitals={nearbyHospitals}
              onTriggerEmergencyCall={(num) => handleInitiateEmergencyCall(num, "Emergency Services")}
            />
          </aside>
        </div>

        {/* EMERGENCY CONFIRMATION MODAL */}
        {emergencyCallTarget && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={() => setEmergencyCallTarget(null)}
          >
            <div
              className="max-w-md w-full bg-white rounded-3xl p-6 shadow-2xl border border-slate-200 flex flex-col gap-4 animate-in zoom-in-95 duration-150 text-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                  <PhoneCall className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-[#05070F]">
                    Emergency Dispatch Call
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    Target: {emergencyCallTarget.number} ({emergencyCallTarget.serviceName || "Emergency Services"})
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex flex-col gap-1.5">
                <p className="font-medium text-slate-800">
                  {emergencyCallTarget.description}
                </p>
                <p className="text-[11px] text-slate-500">
                  MedVoice provides clinical guidance. Confirm to initiate this outgoing emergency call.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEmergencyCallTarget(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmEmergencyCall}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Open Dialer ({emergencyCallTarget.number}) →</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* POST-CONSULTATION CLINICAL FEEDBACK (PEEK RATING) */}
        {showRatingModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={() => setShowRatingModal(false)}
          >
            <div
              className="max-w-md w-full animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <PeekRating
                onSubmit={(r, tags) => {
                  console.log("Clinical review logged:", r, tags);
                  setTimeout(() => setShowRatingModal(false), 1200);
                }}
              />
            </div>
          </div>
        )}

        {/* TRANSIENT CLINICAL EVENT TOASTS (SWIPE TOAST) */}
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {clinicalToasts.map((toast) => (
            <div key={toast.id} className="pointer-events-auto">
              <SwipeToast
                id={toast.id}
                type={toast.type}
                title={toast.title}
                description={toast.description}
                onDismiss={(id) => setClinicalToasts((prev) => prev.filter((t) => t.id !== id))}
              />
            </div>
          ))}
        </div>
      </main>

      {/* CLINICAL ENCOUNTER SOAP REVIEW & FINALIZATION MODAL (ROOT LAYER OVERLAY) */}
      <SoapReportModal
        isOpen={showSoapModal}
        onClose={() => setShowSoapModal(false)}
        encounter={{
          id: currentEncounterId || stableEncounterIdRef.current || `ENC-${Date.now().toString().slice(-6)}`,
          patientName: patientDisplayName || "Anonymous Patient",
          patientAge: activeProfile?.age ? String(activeProfile.age) : undefined,
          patientGender: activeProfile?.gender || undefined,
          doctorId: selectedDoctor.id,
          doctorName: selectedDoctor.name,
          specialty: selectedDoctor.specialty || selectedDoctor.department,
          callDuration: callDuration,
          transcript: messages.map((m) => ({ role: m.role, text: m.text, timestamp: m.timestamp })),
          triageLevel: triageData?.triageLevel || "routine",
          triageTitle: triageData?.triageTitle || "Clinical Voice Consultation Evaluation",
          esiScore: triageData?.esiScore ?? null,
          detectedSymptoms: triageData?.detectedSymptoms || [],
          icdCodes: triageData?.icdCodes || [],
          recommendedAction: triageData?.recommendedAction || "Consultation complete.",
          soap: {
            subjective: triageData?.soap?.subjective || "",
            objective: triageData?.soap?.objective || "",
            assessment: triageData?.soap?.assessment || "",
            plan: triageData?.soap?.plan || "",
          },
          auditSha256: boardData?.trace?.audit_sha256,
          userId: user?.id,
          userRole: (user?.publicMetadata?.role as string) || "patient",
          caseVersion: encounterVersionRef.current ? encounterVersionRef.current + 1 : undefined,
        }}
        onSaveSuccess={() => {
          setPersistenceStatus("saved");
        }}
      />

      <ArchitecturalBrandLedgerFooter />
    </div>
  );
}
