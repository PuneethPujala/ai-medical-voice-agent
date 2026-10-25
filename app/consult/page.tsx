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
import { AppFooter } from "../_components/AppFooter";
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
import { AcousticDSPAnalyzer, LiveAudioMetrics } from "@/lib/acoustic/acoustic-dsp-analyzer";
import { normalizeCompletenessPercent } from "@/lib/triage/clinical-state";
import { reconcileClinicalTranscript } from "@/lib/audio/transcript-reconciler";


type AudioState =
  | "IDLE"
  | "PATIENT_LISTENING"
  | "PROCESSING_TRANSCRIPTION"
  | "TRANSCRIPT_REVIEW"
  | "PROCESSING_CLINICAL"
  | "DOCTOR_SPEAKING"
  | "BARGE_IN_DETECTED"
  | "PROCESSING_INTERRUPTION";

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
  turnId?: string;
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
  const [userProfiles, setUserProfiles] = useState<any[]>([]);

  useEffect(() => {
    if (user?.id) {
      fetch("/api/patient/profile?all=true")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.profiles?.length > 0) {
            setUserProfiles(data.profiles);
            const defaultProfile = data.profiles.find((p: any) => p.relationshipToUser === "self") || data.profiles[0];
            setActiveProfile(defaultProfile);
          }
        })
        .catch((err) => console.warn("Failed to load patient profiles:", err));
    }
  }, [user?.id]);

  const draftRestoredRef = useRef<boolean>(false);
  // Recover transient session draft on page mount if user navigated away or reloaded
  useEffect(() => {
    if (draftRestoredRef.current) return;
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
                draftRestoredRef.current = true;
                stableEncounterIdRef.current = parsed.payload.id;
                setCurrentEncounterId(parsed.payload.id);
                setMessages(parsed.payload.transcript);
                setCallDuration(parsed.payload.durationSeconds || 0);
                setPersistenceStatus("saved");
                const uniqueToastId = `draft-restored-${parsed.payload.id || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                setClinicalToasts((prev) => {
                  if (prev.some((t) => t.id.startsWith("draft-restored-"))) return prev;
                  return [
                    ...prev,
                    {
                      id: uniqueToastId,
                      type: "info",
                      title: "Active Encounter Draft Restored",
                      description: `Recovered ${parsed.payload.transcript.length} turns from previous session (${parsed.payload.id}).`
                    }
                  ];
                });
                break;
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

  const [sessionMode, setSessionMode] = useState<ConsultSessionMode>("CONSULT_LOBBY");
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
  const [callActive, setCallActive] = useState<boolean>(false);

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
  const [pendingTranscript, setPendingTranscript] = useState<string>("");

  const [callDuration, setCallDuration] = useState<number>(0);
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [typedInput, setTypedInput] = useState<string>("");
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
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
    .filter((fact: string) => !/^ONSET_AND_LOCATION:/i.test(fact));
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
  } else if (audioState === "TRANSCRIPT_REVIEW") {
    contextSubtitle = "Reviewing speech transcript...";
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
  const currentCaseVersionRef = useRef<number>(1);
  const isPersistingEncounterRef = useRef<boolean>(false);
  const [currentEncounterId, setCurrentEncounterId] = useState<string>("");
  const [persistenceStatus, setPersistenceStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  const voicePillState: VoicePillState =
    audioState === "PATIENT_LISTENING"
      ? "listening"
      : audioState === "PROCESSING_TRANSCRIPTION"
      ? "transcribing"
      : audioState === "TRANSCRIPT_REVIEW"
      ? "review"
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
  const pendingAudioMetricsRef = useRef<LiveAudioMetrics | undefined>(undefined);
  const lastAudioMetricsRef = useRef<LiveAudioMetrics | undefined>(undefined);
  const callActiveRef = useRef<boolean>(false);

  useEffect(() => {
    audioStateRef.current = audioState;
  }, [audioState]);
  const consultationStartedAtRef = useRef<number | null>(null);
  const consultationCompletedAtRef = useRef<number | null>(null);
  const lastDoctorSpeechRef = useRef<string>("");
  const lastDoctorSpeechTimeRef = useRef<number>(0);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const persistentAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSessionTokenRef = useRef<number>(0);
  const chatAbortControllerRef = useRef<AbortController | null>(null);

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
  const transcriptionSessionTokenRef = useRef<number>(0);
  const isSubmittingUtteranceRef = useRef<boolean>(false);

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

      let isSettled = false;

      // Safety timeout guard: fail closed if recorder stalls without clean onstop completion
      const safetyTimeout = setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        console.warn("[MedVoice Voice] MediaRecorder stop timed out after 1500ms without onstop completion. Failing closed and discarding incomplete audio buffer.");
        try {
          recorder.onstop = null;
          recorder.ondataavailable = null;
        } catch {}
        audioChunksRef.current = [];
        resolve(null);
      }, 1500);

      recorder.onstop = () => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(safetyTimeout);
        const mime = recorder.mimeType || "audio/webm";
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: mime });
          audioChunksRef.current = [];
          resolve(blob);
        } else {
          resolve(null);
        }
      };

      try {
        if (typeof (recorder as any).requestData === "function" && recorder.state === "recording") {
          try {
            (recorder as any).requestData();
          } catch {}
        }
        recorder.stop();
      } catch (stopErr) {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(safetyTimeout);
        console.warn("[MedVoice Voice] MediaRecorder stop threw exception:", stopErr);
        audioChunksRef.current = [];
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
    transcriptionSessionTokenRef.current += 1;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    audioChunksRef.current = [];
    transcriptTextRef.current = "";
    accumulatedTranscriptRef.current = "";
    setTranscriptText("");
    setPendingTranscript("");
    pendingAudioMetricsRef.current = undefined;
    stopSpeechRecognitionListening();
    audioStateRef.current = "IDLE";
    setAudioState("IDLE");
  }, [stopSpeechRecognitionListening]);

  // Commits transcribed speech to the clinical pipeline (Whisper ASR canonical, SpeechRecognition interim fallback)
  const commitSpokenText = useCallback(async (forceText?: string) => {
    // Only commit if we are actively listening (prevents duplicate runs from simultaneous silence timer + user click)
    if (audioStateRef.current !== "PATIENT_LISTENING") {
      return;
    }

    transcriptionSessionTokenRef.current += 1;
    const currentSessionToken = transcriptionSessionTokenRef.current;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Capture preview text BEFORE resetting interim state and refs
    const capturedPreview = (
      forceText ||
      transcriptTextRef.current ||
      accumulatedTranscriptRef.current
    ).trim();

    accumulatedTranscriptRef.current = "";
    transcriptTextRef.current = "";
    setTranscriptText("");

    // Stop browser interim speech recognition
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
      acousticAnalyzerRef.current.dispose();
      acousticAnalyzerRef.current = null;
    }

    // Retrieve recorded utterance from MediaRecorder
    const audioBlob = await stopAndGetAudioBlob();

    // Release microphone tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    let finalTranscript = "";
    audioStateRef.current = "PROCESSING_TRANSCRIPTION";
    setAudioState("PROCESSING_TRANSCRIPTION");

    // Primary Canonical Path: Transcribe recorded utterance using Local / Cloud Whisper ASR
    if (audioBlob && audioBlob.size > 2000) {
      try {
        const formData = new FormData();
        const ext = audioBlob.type?.includes("mp4") ? "utterance.mp4" :
                    audioBlob.type?.includes("wav") ? "utterance.wav" : "utterance.webm";
        formData.append("file", audioBlob, ext);

        // Clinical Context Priming: Pass doctor's active inquiry and live preview
        const priorContext = lastDoctorSpeechRef.current.trim() ||
          ([...messagesRef.current].reverse().find(m => m.role === "doctor")?.text || "");
        const previewText = capturedPreview;
        if (priorContext) {
          formData.append("context", priorContext);
        }
        if (previewText) {
          formData.append("preview", previewText);
        }

        const sttRes = await fetch("/api/voice/stt", {
          method: "POST",
          body: formData,
        });

        if (!sttRes.ok) {
          console.warn(`[MedVoice STT] Whisper ASR returned HTTP ${sttRes.status}`);
          const fallbackText = capturedPreview;
          if (fallbackText) {
            console.warn("[MedVoice Voice] Recovering with interim browser preview:", fallbackText);
            setClinicalToasts((prev) => [
              ...prev,
              {
                id: `stt-warn-${Date.now()}`,
                type: "warning",
                title: "Speech Recognition Fallback",
                description: "Whisper ASR encountered a temporary issue. Populated your preview transcript so you can review, edit, or retry before sending.",
              },
            ]);
            finalTranscript = fallbackText;
          } else {
            setClinicalToasts((prev) => [
              ...prev,
              {
                id: `stt-err-${Date.now()}`,
                type: "warning",
                title: "Speech Recognition Unavailable",
                description: "Could not transcribe audio. Please ensure the backend is running, or type your symptoms to continue.",
              },
            ]);
            audioStateRef.current = "IDLE";
            setAudioState("IDLE");
            return;
          }
        } else {
          const sttData = await sttRes.json();
          const rawServerTranscript = (sttData.transcript || "").trim();

          // Double-check reconciliation on client with active doctor question and live preview
          const reconciled = reconcileClinicalTranscript({
            whisperText: rawServerTranscript,
            previewText: previewText,
            doctorLastQuestion: priorContext,
            currentSymptoms: triageData?.detectedSymptoms || [],
          });
          finalTranscript = reconciled.transcript.trim();

          if (finalTranscript.length > 0) {
            console.log("🎯 Canonical Clinical Reconciled Transcript:", finalTranscript);
          }
        }
      } catch (err) {
        console.error("Whisper STT request exception:", err);
        const fallbackText = capturedPreview;
        if (fallbackText) {
          finalTranscript = fallbackText;
        } else {
          setClinicalToasts((prev) => [
            ...prev,
            {
              id: `stt-net-err-${Date.now()}`,
              type: "warning",
              title: "Transcription Network Error",
              description: "Could not reach the transcription service. Please try speaking again or type your symptoms instead.",
            },
          ]);
          audioStateRef.current = "IDLE";
          setAudioState("IDLE");
          return;
        }
      }
    } else if (capturedPreview) {
      // Audio buffer was too short or unavailable, but browser interim recognition captured text
      finalTranscript = capturedPreview;
    }

    // Check if the transcription session is still valid (not canceled or restarted while awaiting ASR)
    if (
      transcriptionSessionTokenRef.current !== currentSessionToken ||
      audioStateRef.current !== "PROCESSING_TRANSCRIPTION"
    ) {
      console.log("Discarding stale transcription response (session canceled or re-recorded).");
      return;
    }

    if (!finalTranscript) {
      console.log("No intelligible speech detected in utterance.");
      setClinicalToasts((prev) => [
        ...prev,
        {
          id: `stt-empty-${Date.now()}`,
          type: "warning",
          title: "Speech Not Detected",
          description: "We couldn't hear enough to transcribe that. Please try speaking again, speak a little more clearly, or type your symptoms instead.",
        },
      ]);
      audioStateRef.current = "IDLE";
      setAudioState("IDLE");
      return;
    }

    console.log("🎤 Transcribed patient utterance ready for review:", finalTranscript);
    pendingAudioMetricsRef.current = liveAudioMetrics;
    setPendingTranscript(finalTranscript);
    audioStateRef.current = "TRANSCRIPT_REVIEW";
    setAudioState("TRANSCRIPT_REVIEW");
  }, [stopSpeechRecognitionListening]);

  // Confirms the transcribed/edited text and dispatches to the clinical pipeline
  const confirmAndSendTranscript = useCallback(() => {
    // Strictly prevent duplicate dispatch from rapid clicks or Enter presses
    if (isSubmittingUtteranceRef.current || audioStateRef.current !== "TRANSCRIPT_REVIEW") {
      return;
    }

    const textToSend = pendingTranscript.trim();
    if (!textToSend) return;

    audioStateRef.current = "PROCESSING_CLINICAL";
    const metrics = pendingAudioMetricsRef.current;
    lastAudioMetricsRef.current = metrics;
    pendingAudioMetricsRef.current = undefined;
    setPendingTranscript("");
    setAudioState("PROCESSING_CLINICAL");
    handleUserUtteranceRef.current?.(textToSend, false, metrics);
  }, [pendingTranscript]);

  // Cleans up current transcript and restarts speech intake
  const handleReRecord = useCallback(() => {
    transcriptionSessionTokenRef.current += 1;
    setPendingTranscript("");
    pendingAudioMetricsRef.current = undefined;
    cancelVoiceRecording();
    if (!callActiveRef.current) {
      callActiveRef.current = true;
      setCallActive(true);
    }
    startSpeechRecognitionListeningRef.current?.();
  }, [cancelVoiceRecording]);

  // Discards the current transcript and returns consultation to IDLE
  const handleDiscardTranscript = useCallback(() => {
    transcriptionSessionTokenRef.current += 1;
    setPendingTranscript("");
    pendingAudioMetricsRef.current = undefined;
    cancelVoiceRecording();
    audioStateRef.current = "IDLE";
    setAudioState("IDLE");
  }, [cancelVoiceRecording]);

  // Immediate Barge-In: cleanly halts doctor TTS and starts listening
  const triggerBargeIn = useCallback((customPhrase?: string) => {
    console.log("⚡ Interrupting doctor speech immediately.");
    // Invalidate any in-flight async TTS generation so late-arriving audio is suppressed
    playbackSessionTokenRef.current += 1;
    setPendingDoctorMessage(null);

    // Immediately cancel any in-flight AI deliberation over the network
    if (chatAbortControllerRef.current) {
      try { chatAbortControllerRef.current.abort(); } catch {}
      chatAbortControllerRef.current = null;
    }

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

    // Safety timeout: If playback doesn't start within 4s (e.g. autoplay policy blocked or network stall), force text display
    const safetyCommitTimer = setTimeout(() => {
      if (playbackSessionTokenRef.current === token && !textCommitted) {
        console.warn(`[MedVoice Audio Safety] Playback timeout reached; committing text transcript to preserve UX.`);
        commitDoctorText();
      }
    }, 4000);

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
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => {
        try { abortCtrl.abort("TTS_TIMEOUT"); } catch {}
      }, 3500);

      try {
        const response = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: chunkText,
            doctorId: targetDoctor.id,
            speed: targetDoctor.voiceProfile?.speed || 0.96,
          }),
          signal: abortCtrl.signal,
        });
        clearTimeout(timeoutId);

        const t_received = performance.now();

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await response.json().catch(() => ({}));
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
      } catch (err: any) {
        clearTimeout(timeoutId);
        const isAbort = err?.name === "AbortError" || abortCtrl.signal.aborted;
        throw new Error(isAbort ? "TTS_CHUNK_TIMEOUT" : (err?.message || "TTS_CHUNK_FAILED"));
      }
    };

    try {
      console.log(`[MedVoice Audio] Requesting speech (${chunks.length} chunk${chunks.length > 1 ? "s" : ""}) via TTS Dispatcher for ${targetDoctor.name}...`);

      // Immediately dispatch Chunk 0 for fast Time-To-First-Audio (TTFA)
      const chunk0Promise = fetchTTSChunk(chunks[0]);

      // In parallel, queue synthesis of remaining chunks in background with rejection suppression
      const remainingPromises = chunks.slice(1).map((c) => {
        const p = fetchTTSChunk(c);
        p.catch(() => {}); // Suppress unhandled rejection notices so abort doesn't bubble to Turbopack
        return p;
      });

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

        // Reset silence timer on speech activity. Gives the user 2.6s of silence to pause and think without cut-off.
        if (fullDisplay.length > 0) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = setTimeout(() => {
            const currentTotal = transcriptTextRef.current.trim();
            if ((currentTotal.length > 0 || audioChunksRef.current.length > 0) && audioStateRef.current === "PATIENT_LISTENING") {
              console.log("⏱️ Natural 2.6s silence pause detected. Committing speech for review:", currentTotal);
              commitSpokenText(currentTotal);
            }
          }, 2600);
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
    // Serialization Guard: Prevent concurrent persistence race conditions
    if (isPersistingEncounterRef.current) {
      await new Promise((r) => setTimeout(r, 60));
    }
    isPersistingEncounterRef.current = true;
    try {
      setPersistenceStatus("saving");
      setPersistenceError(null);

      const activeMessages = customMessages || messages;
      const activeTriage = customTriage !== undefined ? customTriage : triageData;

      const patientUtterances = activeMessages.filter((m) => m.role === "patient");
      const chiefConcern = initialConcernOverride || (patientUtterances.length > 0
        ? patientUtterances[0].text.replace(/^"|"$/g, "")
        : activeTriage?.detectedSymptoms?.length
        ? activeTriage.detectedSymptoms.join(", ")
        : "Clinical voice intake consultation");

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

      const effectiveCaseVersion = customCaseVersion !== undefined
        ? customCaseVersion
        : (currentCaseVersionRef.current ? currentCaseVersionRef.current + 1 : undefined);

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
        audioMetrics: interviewState?.audio_metrics || lastAudioMetricsRef.current || undefined,
        speechFeatures: interviewState?.speech_features || undefined,
        deliveredTurnRecords: interviewState?.deliveredTurnRecords || [],
        attributedFacts: interviewState?.attributedFacts || [],
        unmappedObservations: interviewState?.unmappedObservations || [],
        caseVersion: effectiveCaseVersion,
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

      const res = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        serverEncounterCreatedRef.current = true;
        setPersistenceStatus("saved");
        setPersistenceError(null);
        const serverVersion = resData?.consultation?.caseVersion ?? resData?.consultation?.version;
        if (serverVersion !== undefined && !isNaN(Number(serverVersion))) {
          currentCaseVersionRef.current = Number(serverVersion);
        } else if (effectiveCaseVersion !== undefined) {
          currentCaseVersionRef.current = effectiveCaseVersion;
        }
        if (statusOverride === "completed_pending_review" || statusOverride === "approved") {
          if (typeof window !== "undefined" && window.sessionStorage) {
            try {
              window.sessionStorage.removeItem(`medvoice_transient_draft_${encId}`);
            } catch {}
          }
        }
        return true;
      } else if (res.status === 409) {
        const conflictData = await res.json().catch(() => ({}));
        console.warn("[MedVoice] Concurrency conflict (HTTP 409) during persistence:", conflictData.error);

        // Explicit Recovery Strategy: If server communicated its current version, synchronize and retry once
        if (conflictData.currentVersion !== undefined) {
          const datastoreVersion = Number(conflictData.currentVersion);
          currentCaseVersionRef.current = datastoreVersion;
          const retryVersion = datastoreVersion + 1;
          console.log(`[MedVoice] Synchronizing with datastore version (${datastoreVersion}) and retrying with version ${retryVersion}...`);

          const retryPayload = { ...payload, caseVersion: retryVersion };
          const retryRes = await fetch("/api/consultations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(retryPayload),
          });

          if (retryRes.ok) {
            const retryData = await retryRes.json().catch(() => ({}));
            serverEncounterCreatedRef.current = true;
            setPersistenceStatus("saved");
            setPersistenceError(null);
            const updatedVersion = retryData?.consultation?.caseVersion ?? retryData?.consultation?.version;
            if (updatedVersion !== undefined && !isNaN(Number(updatedVersion))) {
              currentCaseVersionRef.current = Number(updatedVersion);
            } else {
              currentCaseVersionRef.current = retryVersion;
            }
            return true;
          }
        }

        // If recovery could not resolve: report explicit failure, never silently claim "saved"
        setPersistenceStatus("error");
        setPersistenceError("Encounter version conflict with server datastore.");
        return false;
      } else {
        const data = await res.json().catch(() => ({}));
        console.error("[MedVoice] Auto-persist encounter failure (HTTP " + res.status + "):", data.error || res.statusText);
        setPersistenceStatus("error");
        setPersistenceError(data.error || "Failed to persist encounter to datastore.");
        return false;
      }
    } catch (err: any) {
      console.error("[MedVoice] Auto-persist encounter network failure:", err?.message || err);
      setPersistenceStatus("error");
      setPersistenceError(err?.message || "Network error persisting consultation.");
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
        currentCaseVersionRef.current = 1;
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
      // Pre-initialize encounter on server so subsequent turns and voice chat succeed immediately
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
    setCurrentEncounterId("");
    setPersistenceStatus("idle");
    setPersistenceError(null);
    setSessionMode("CONSULT_LOBBY");
  };

  // Process User Utterance (Preserves exact spoken text without artificial tag prefixes)
  const handleUserUtterance = async (userText: string, isBargeIn: boolean = false, audioMetrics?: LiveAudioMetrics) => {
    if (isSubmittingUtteranceRef.current && !isBargeIn) {
      return;
    }
    const cleanUserText = userText.trim();
    if (!cleanUserText) return;

    isSubmittingUtteranceRef.current = true;

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

    const clientTurnId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `turn_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // Exact patient words — no "URGENT BARGE-IN" text injection!
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "patient",
      text: cleanUserText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isBargeIn,
      turnId: clientTurnId
    };

    setMessages((prev) => [...prev, userMessage]);

    // Ensure the encounter is registered on the server before sending the dialogue turn
    if (!serverEncounterCreatedRef.current && stableEncounterIdRef.current) {
      await ensureServerEncounter(stableEncounterIdRef.current, cleanUserText);
    }

    try {
      const chatPayload = {
        encounterId: stableEncounterIdRef.current,
        turnId: clientTurnId,
        clientTurnId: clientTurnId,
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
      };

      if (chatAbortControllerRef.current) {
        try { chatAbortControllerRef.current.abort(); } catch {}
      }
      const abortCtrl = new AbortController();
      chatAbortControllerRef.current = abortCtrl;

      let res = await fetch("/api/voice/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream, application/json",
          "x-turn-id": clientTurnId,
        },
        body: JSON.stringify({ ...chatPayload, stream: true }),
        signal: abortCtrl.signal,
      });

      // Self-healing recovery: if server lost in-memory state or encounter was not registered, register on server and retry once
      if (res.status === 404 && stableEncounterIdRef.current) {
        console.warn("[MedVoice] Encounter 404 detected; self-healing by registering encounter on server and retrying...");
        serverEncounterCreatedRef.current = false;
        await ensureServerEncounter(stableEncounterIdRef.current, cleanUserText);
        res = await fetch("/api/voice/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatPayload),
        });
      } else if (res.status === 409 && stableEncounterIdRef.current) {
        console.warn("[MedVoice] Encounter 409 concurrency conflict detected; checking for cached turn replay...");
        const conflictJson = await res.json().catch(() => ({}));
        res = await fetch("/api/voice/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream, application/json",
            "x-turn-id": clientTurnId,
          },
          body: JSON.stringify({
            ...chatPayload,
            stream: true,
          }),
        });
      }

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `Clinical response failed: ${res.status}`);
      }

      const clinicalReceivedTime = performance.now();
      const isSse = Boolean(res.headers.get("content-type")?.includes("text/event-stream"));
      let data: any;
      let earlyStreamAudioDispatched = false;

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

              if (eventType === "emergency" && !earlyStreamAudioDispatched) {
                earlyStreamAudioDispatched = true;
                const emergDocId = parsed.doctor?.id || selectedDoctor.id;
                speakDoctorResponse(parsed.directive, emergDocId, playbackSessionTokenRef.current);
              } else if (eventType === "done") {
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
      const serverChatVersion = data.caseVersion ?? data.interviewState?.caseVersion;
      if (serverChatVersion !== undefined && !isNaN(Number(serverChatVersion))) {
        currentCaseVersionRef.current = Number(serverChatVersion);
      }
      const turnMessages = [...messages, userMessage, newDoctorMessage];
      persistEncounterRecord(
        stableEncounterIdRef.current,
        currentElapsed,
        "in_progress",
        turnMessages,
        data.triage,
        undefined,
        currentCaseVersionRef.current + 1
      );

      if (!earlyStreamAudioDispatched) {
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
      } else {
        setPendingDoctorMessage(null);
        setMessages((prev) => {
          if (prev.some((m) => m.id === newDoctorMessage.id)) return prev;
          return [...prev, newDoctorMessage];
        });
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.message?.includes("aborted")) {
        console.log("⚡ [MedVoice] Dialogue turn cleanly cancelled by barge-in or navigation.");
        return;
      }
      console.error("Consultation chat error:", err);
      setPendingDoctorMessage(null);
      // Safe fallback: never revert to listening on a clinical failure
      setAudioState("IDLE");
      setClinicalToasts((prev) => [
        ...prev,
        {
          id: `chat-err-${Date.now()}`,
          type: "warning",
          title: "Clinical Response Interrupted",
          description: err?.message || "Communication with clinical deliberation service failed. Please retry your utterance or click Speak.",
        },
      ]);
    } finally {
      isSubmittingUtteranceRef.current = false;
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

  return (
    <div className="relative min-h-screen bg-transparent text-slate-900 flex flex-col font-sans selection:bg-cyan-500 selection:text-white overflow-x-clip">
      {/* React Bits Subtle Interactive Ambient Cursor Glow */}
      <GlowCursor color="rgba(6, 182, 212, 0.12)" size={350} blur={65} opacity={0.7} />

      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-16 flex flex-col gap-8">

        <AnimatePresence mode="wait">
          {/* ========================================================================= */}
          {/* STATE A: CONSULT LOBBY (CHOOSE YOUR CLINICIAN EXPERIENCE)                 */}
          {/* ========================================================================= */}
          {sessionMode === "CONSULT_LOBBY" && (
            <motion.div
              key="consult-lobby"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -16 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex flex-col gap-8 max-w-5xl mx-auto w-full"
            >
              {/* Calm Hero Header */}
              <div className="flex flex-col items-center text-center space-y-4 pt-2 sm:pt-4">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-50 border border-cyan-200/90 shadow-2xs font-mono">
                  <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-[0.1em] text-cyan-900">
                    MEDVOICE · VOICE CLINICAL CONSULTATION
                  </span>
                </div>
                <div className="space-y-1">
                  <SplitText
                    text="Ready when you are."
                    tag="h1"
                    className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-950 tracking-tight leading-[1.08]"
                  />
                  <div className="pt-0.5">
                    <GradientText
                      colors={["#0891b2", "#06b6d4", "#0e7490"]}
                      className="text-xs sm:text-sm font-bold uppercase tracking-wider font-mono"
                    >
                      Real-Time Clinical Voice Intelligence
                    </GradientText>
                  </div>
                </div>
                <p className="text-base sm:text-lg text-slate-600 max-w-2xl font-normal leading-relaxed">
                  Choose who you&apos;d like to consult with. Your symptoms will be carefully reviewed, with safety checks running continuously in the background.
                </p>

                {/* Linked Patient Profile Context Banner */}
                <div className="pt-1">
                  {activeProfile ? (
                    <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-white border border-slate-200/90 shadow-2xs text-xs">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
                      <span className="text-slate-500 font-medium">Consulting for:</span>
                      <strong className="text-slate-900 font-bold">{activeProfile.name || (activeProfile.relationshipToUser === "self" ? "Myself" : activeProfile.relationshipToUser)}</strong>
                      {activeProfile.age ? (
                        <span className="text-slate-500 font-mono text-[11px]">({activeProfile.age}y)</span>
                      ) : null}
                      {activeProfile.knownConditions?.length ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-800 text-[10px] font-bold">
                          {activeProfile.knownConditions.length} condition{activeProfile.knownConditions.length > 1 ? "s" : ""}
                        </span>
                      ) : null}
                      {userProfiles.length > 1 ? (
                        <select
                          aria-label="Switch patient profile"
                          value={activeProfile.id}
                          onChange={(e) => {
                            const chosen = userProfiles.find((p) => p.id === e.target.value);
                            if (chosen) setActiveProfile(chosen);
                          }}
                          className="text-[11px] font-semibold text-slate-700 bg-slate-100 rounded-lg px-2 py-0.5 border border-slate-200 cursor-pointer ml-1"
                        >
                          {userProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name || (p.relationshipToUser === "self" ? "Myself (Self)" : p.relationshipToUser)}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <Link
                        href="/profile"
                        className="ml-2 font-semibold text-cyan-700 hover:text-cyan-900 text-[11px] underline"
                      >
                        Edit Profile
                      </Link>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 border border-slate-200/80 text-xs text-slate-500 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                      <span>No medical profile attached.</span>
                      <Link href="/profile" className="text-cyan-700 hover:text-cyan-900 font-semibold text-[11px] underline">
                        Add Details (Optional)
                      </Link>
                    </div>
                  )}
                </div>
              </div>

              {/* Active Clinical Team Quick Roster Rail */}
              <div className="flex flex-col items-center gap-3">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500">
                  ACTIVE CLINICAL TEAM
                </span>
                <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
                  {DOCTOR_PROFILES.map((doc) => {
                    const isSelected = selectedDoctor.id === doc.id;
                    const liveStatus = getDoctorLiveStatus(doc);
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => handleSelectDoctor(doc)}
                        className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? "bg-slate-950 text-white shadow-sm ring-2 ring-cyan-500/30"
                            : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200/90 shadow-2xs"
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${isSelected ? "bg-cyan-400 animate-pulse" : liveStatus.dot}`} />
                        <span>{doc.name.split(" ")[1] || doc.name}</span>
                        <span className={`text-[10px] font-mono uppercase ${isSelected ? "text-cyan-300" : "text-slate-400"}`}>
                          {doc.specialty.split("&")[0].trim()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Featured Lead Clinician Surface */}
              <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col md:flex-row items-center md:items-start gap-6 sm:gap-8">
                {/* Doctor Portrait with Live Status */}
                <div className="relative flex-shrink-0">
                  <img
                    src={selectedDoctor.avatarUrl}
                    alt={selectedDoctor.name}
                    className="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl object-cover border border-slate-200 shadow-sm"
                  />
                  <div className="absolute -bottom-2 -right-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800 shadow-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Available now</span>
                  </div>
                </div>

                {/* Doctor Details & Action */}
                <div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left space-y-3">
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                      {selectedDoctor.name}
                    </h2>
                    <p className="text-sm sm:text-base text-cyan-800 font-semibold mt-0.5">
                      {selectedDoctor.department} · {selectedDoctor.experience}
                    </p>
                  </div>

                  <p className="text-sm text-slate-600 leading-relaxed max-w-xl font-normal">
                    &quot;{selectedDoctor.greeting}&quot;
                  </p>

                  {/* Clinical Focus Badges */}
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-1.5 pt-1">
                    {selectedDoctor.clinicalFocus.map((focus, i) => (
                      <span
                        key={i}
                        className="font-mono text-xs text-slate-600 bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-lg"
                      >
                        {focus}
                      </span>
                    ))}
                  </div>

                  {/* Begin Consultation CTA */}
                  <div className="pt-3">
                    <button
                      type="button"
                      onClick={() => startConsultation(selectedDoctor)}
                      className="inline-flex items-center justify-center gap-3 px-7 py-3.5 rounded-2xl bg-slate-950 hover:bg-slate-800 text-white text-sm sm:text-base font-bold shadow-md hover:shadow-lg transition-all cursor-pointer group"
                    >
                      <Mic className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform" />
                      <span>Begin Voice Consultation with {selectedDoctor.name.split(",")[0]} →</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Specialists Grid: All 5 Doctors with One-Click Consult */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-600">
                    Clinical Specialist Network (5 Board-Certified Agents)
                  </span>
                  <span className="text-xs text-slate-500 font-mono">High-Definition Audio</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {DOCTOR_PROFILES.map((doc) => {
                    const isSelected = selectedDoctor.id === doc.id;
                    const liveStatus = getDoctorLiveStatus(doc);
                    return (
                      <div
                        key={doc.id}
                        onClick={() => handleSelectDoctor(doc)}
                        className={`p-5 rounded-2xl bg-white border transition-all cursor-pointer flex flex-col justify-between gap-4 ${
                          isSelected
                            ? "border-cyan-500 ring-2 ring-cyan-400/20 shadow-md"
                            : "border-slate-200/90 hover:border-slate-300 shadow-2xs hover:shadow-xs"
                        }`}
                      >
                        <div className="flex items-start gap-3.5">
                          <img
                            src={doc.avatarUrl}
                            alt={doc.name}
                            className="w-12 h-12 rounded-xl object-cover border border-slate-200 flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-bold text-slate-950 truncate">{doc.name}</h3>
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${liveStatus.color}`}>
                                {liveStatus.label}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 truncate mt-0.5">{doc.department}</p>
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                          {doc.title}
                        </p>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startConsultation(doc);
                          }}
                          className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-950 hover:text-white text-slate-800 text-xs font-bold border border-slate-200/90 transition-all cursor-pointer"
                        >
                          <span>Consult with {doc.name.split(" ")[1] || doc.name}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Technical Trust Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs text-center">
                  <div className="text-xs font-bold text-slate-900 font-mono">ZERO AUDIO STORAGE</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Purged post-transcription</div>
                </div>
                <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs text-center">
                  <div className="text-xs font-bold text-slate-900 font-mono">NATURAL VOICE</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Real-time clinical dialogue</div>
                </div>
                <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs text-center">
                  <div className="text-xs font-bold text-slate-900 font-mono">HL7 FHIR R4 READY</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Automated EHR Bundles</div>
                </div>
                <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs text-center">
                  <div className="text-xs font-bold text-slate-900 font-mono">SAFETY CHECKS</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Continuous safety monitoring</div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ========================================================================= */}
          {/* STATE B: ACTIVE CONSULTATION WORKSPACE                                    */}
          {/* ========================================================================= */}
          {sessionMode === "ACTIVE_CONSULTATION" && (
            <motion.div
              key="active-consultation"
              initial={{ opacity: 0, scale: 0.98, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -16 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex flex-col gap-6 w-full"
            >
              {/* TOP COMMAND HEADER */}
              <header className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl bg-white/85 backdrop-blur-xl border border-slate-200/90 shadow-xs animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="relative flex-shrink-0">
                    <img
                      src={selectedDoctor.avatarUrl}
                      alt={selectedDoctor.name}
                      className="w-12 h-12 rounded-xl object-cover border border-cyan-400 shadow-2xs"
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base sm:text-lg font-black text-slate-950 truncate">
                        {selectedDoctor.name}
                      </span>
                      <span className="text-xs sm:text-sm text-slate-500 font-semibold truncate">
                        · {selectedDoctor.department}
                      </span>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/90">
                        Active Session
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span className="font-mono font-bold text-cyan-900 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200">
                        ⏱ {formatTimer(callDuration)}
                      </span>
                      <span>·</span>
                      <span className="text-slate-600 truncate">
                        {audioState === "DOCTOR_SPEAKING"
                          ? "Doctor speaking response..."
                          : audioState === "PATIENT_LISTENING"
                          ? "Listening to patient voice input..."
                          : audioState === "PROCESSING_TRANSCRIPTION"
                          ? "Transcribing patient speech..."
                          : audioState === "TRANSCRIPT_REVIEW"
                          ? "Awaiting transcript confirmation..."
                          : audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_INTERRUPTION" || pendingDoctorMessage
                          ? "Multi-specialist board analyzing..."
                          : "Consultation ready"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden md:flex items-center gap-2 text-xs font-mono font-semibold text-slate-600 bg-slate-50/80 px-3 py-1.5 rounded-xl border border-slate-200">
                    <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                    <span>5 Specialists Synchronized</span>
                  </div>

                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSoapModal(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200/90 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-cyan-700" />
                      <span>SOAP Report</span>
                    </button>
                  )}

                  {/* Refined, quiet End Consultation button */}
                  <button
                    type="button"
                    onClick={endConsultation}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-200/90 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 transition-colors shadow-2xs cursor-pointer group"
                  >
                    <PhoneOff className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-600 transition-colors" />
                    <span>End Consultation</span>
                  </button>
                </div>
              </header>

              {/* ACTIVE BOARD SPECIALIST HUD */}
              <section className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/70 backdrop-blur-md border border-slate-200/70 shadow-2xs overflow-x-auto scrollbar-none">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500">
                    Active Board:
                  </span>
                </div>
                <div className="flex items-center gap-2.5 overflow-x-auto scrollbar-none">
                  {DOCTOR_PROFILES.map((doc) => {
                    const isSelected = selectedDoctor.id === doc.id;
                    const liveStatus = getDoctorLiveStatus(doc);
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => handleSelectDoctor(doc)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex-shrink-0 ${
                          isSelected
                            ? "bg-cyan-500 text-white shadow-xs font-bold"
                            : "bg-white/90 text-slate-700 hover:bg-white border border-slate-200/80"
                        }`}
                      >
                        <img
                          src={doc.avatarUrl}
                          alt={doc.name}
                          className="w-5 h-5 rounded-full object-cover border border-white/40"
                        />
                        <span className="truncate max-w-[120px]">
                          {doc.name.split(" ")[1] || doc.name}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : liveStatus.dot}`} />
                      </button>
                    );
                  })}
                </div>
              </section>

        {/* CLINICAL WORKSPACE ENCLOSURE SHELL */}
        <section id="workspace" className="p-3 sm:p-6 lg:p-7 rounded-3xl bg-white/75 backdrop-blur-xl border border-slate-200/80 shadow-sm flex flex-col gap-6">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
              <span className="text-xs font-bold uppercase tracking-widest text-slate-700 font-mono">
                Clinical Consultation
              </span>
            </div>
          </div>

          {/* ASYMMETRIC WORKSPACE: 7:5 GRID */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

            {/* LEFT PANEL (7 cols): PRIMARY VOICE CONSOLE */}
            <section className="relative lg:col-span-7 flex flex-col gap-5 p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm overflow-hidden">

            {/* Conversation Console Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-200/80">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900">
                  Live Consultation Dialogue
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono">
                {audioState === "DOCTOR_SPEAKING" ? (
                  <span className="text-emerald-700 font-bold animate-pulse flex items-center gap-1.5">
                    ● {activeSpeaker.name.split(",")[0].split(" ").pop() || "Doctor"} Speaking
                  </span>
                ) : audioState === "PATIENT_LISTENING" ? (
                  <span className="text-cyan-700 font-bold animate-pulse flex items-center gap-1.5">
                    ● Listening...
                  </span>
                ) : audioState === "PROCESSING_TRANSCRIPTION" ? (
                  <span className="text-cyan-600 font-bold flex items-center gap-1.5">
                    ● Transcribing...
                  </span>
                ) : audioState === "TRANSCRIPT_REVIEW" ? (
                  <span className="text-cyan-700 font-bold flex items-center gap-1.5">
                    ● Review Transcript
                  </span>
                ) : audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_INTERRUPTION" || pendingDoctorMessage ? (
                  <span className="text-cyan-700 font-bold animate-pulse flex items-center gap-1.5">
                    ● Dr. {activeSpeaker.name.split(",")[0].split(" ").pop() || "Sarah"} is Thinking...
                  </span>
                ) : (
                  <span className="text-slate-500 flex items-center gap-1.5">
                    ● Ready
                  </span>
                )}
              </div>
            </div>

            {/* Visually hidden screen reader status announcement */}
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="sr-only"
            >
              {audioState === "PATIENT_LISTENING"
                ? "Microphone listening for patient speech."
                : audioState === "PROCESSING_TRANSCRIPTION"
                ? "Transcribing patient speech."
                : audioState === "TRANSCRIPT_REVIEW"
                ? "Review and edit your spoken transcript before submitting."
                : audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_INTERRUPTION"
                ? "Reviewing symptoms and updating clinical assessment."
                : audioState === "DOCTOR_SPEAKING"
                ? `${activeSpeaker.name.split(",")[0]} is speaking.`
                : micPermissionError
                ? `Microphone alert: ${micPermissionError}`
                : "Consultation ready."}
            </div>

            {/* Quiet Barge-In Interruption Bar */}
            <AnimatePresence>
              {audioState === "DOCTOR_SPEAKING" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-50/90 border border-amber-200/90 text-xs sm:text-sm text-amber-950 shadow-2xs"
                >
                  <span className="font-medium flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-amber-600" />
                    Doctor is speaking. Click Interrupt to speak
                  </span>
                  <button
                    type="button"
                    onClick={() => triggerBargeIn()}
                    className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    Interrupt
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mic Permission Alert */}
            {micPermissionError && (
              <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-xs sm:text-sm text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{micPermissionError}</span>
              </div>
            )}

            {/* Conversation Feed */}
            <div
              ref={chatScrollRef}
              className="h-[340px] sm:h-[380px] overflow-y-auto flex flex-col gap-4 pr-2"
            >
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 sm:p-10 text-slate-400 gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-cyan-50 border border-cyan-200 flex items-center justify-center mb-1 shadow-2xs">
                    <Stethoscope className="w-7 h-7 text-cyan-700" />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight">Ready when you are</h3>
                  <p className="text-sm sm:text-base text-slate-600 max-w-md leading-relaxed font-normal">
                    Start a voice consultation with {selectedDoctor?.name ? selectedDoctor.name.split(",")[0] : "your physician"}. You can speak naturally or type your symptoms below.
                  </p>
                </div>
              ) : (
                messages.map((msg, mIdx) => (
                  <div
                    key={`${msg.id || "msg"}-${mIdx}`}
                    className={`flex flex-col gap-1.5 ${
                      msg.role === "system"
                        ? "items-center w-full my-3"
                        : msg.role === "doctor"
                        ? "items-start"
                        : "items-end"
                    }`}
                  >
                    {/* System Handover / Event Divider */}
                    {msg.role === "system" && (
                      <div className="w-full flex items-center justify-center my-2">
                        <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-slate-100/90 border border-slate-200/80 text-xs font-semibold text-slate-700 shadow-2xs">
                          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                          <span>{msg.text}</span>
                          <span className="text-[10px] text-slate-400 font-mono">· {msg.timestamp}</span>
                        </div>
                      </div>
                    )}

                    {/* Doctor Message */}
                    {msg.role === "doctor" && (
                      <>
                        <span className="text-xs sm:text-sm font-black text-slate-900 tracking-wide flex items-center gap-2">
                          {msg.doctorName?.toUpperCase() || "DR. SARAH CHEN"}
                          <span className="text-xs font-semibold text-slate-500">· {msg.doctorSpecialty}</span>
                        </span>
                        <div className="max-w-[92%] text-slate-900 text-sm sm:text-base leading-relaxed font-medium bg-slate-50/90 border border-slate-200/70 rounded-2xl px-4 py-3">
                          "{msg.text}"
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                          <span>{msg.timestamp}</span>
                          {msg.wasInterrupted && (
                            <>
                              <span>·</span>
                              <span className="text-amber-600 font-sans font-semibold">Interrupted by patient</span>
                            </>
                          )}
                        </div>
                      </>
                    )}

                    {/* Patient Message */}
                    {msg.role === "patient" && (
                      <>
                        <div className="max-w-[85%] rounded-2xl px-5 py-3.5 bg-slate-950 text-white text-sm sm:text-base leading-relaxed shadow-2xs font-normal">
                          {msg.text}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-400 font-mono pr-1">
                          <span>{msg.timestamp}</span>
                          {msg.isBargeIn && (
                            <>
                              <span>·</span>
                              <span className="text-amber-600 font-sans font-semibold">Patient interruption</span>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}

              {/* Synchronized Pending Doctor Turn Indicator (visible while neural TTS synthesizes) */}
              {pendingDoctorMessage && (
                <div className="flex flex-col gap-1.5 items-start">
                  <span className="text-xs sm:text-sm font-black text-slate-900 tracking-wide flex items-center gap-2">
                    {pendingDoctorMessage.doctorName.toUpperCase()}
                    {pendingDoctorMessage.doctorSpecialty && (
                      <span className="text-xs font-semibold text-slate-500">· {pendingDoctorMessage.doctorSpecialty}</span>
                    )}
                  </span>
                  <div className="flex items-center gap-2.5 max-w-[92%] text-slate-700 text-sm font-medium bg-slate-50 border border-slate-200/80 rounded-2xl px-4 py-3 shadow-xs">
                    <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                    <span>Dr. {pendingDoctorMessage.doctorName.split(",")[0].split(" ").pop() || "Sarah"} is formulating clinical response...</span>
                  </div>
                </div>
              )}

              {/* ThoughtLine Micro-Interaction (active only when doctor is not formulating) */}
              {(callActive || audioState !== "IDLE" || Boolean(triageData?.isEmergency)) && !pendingDoctorMessage && (
                <div className="pt-2 pb-1 border-t border-slate-100 flex items-center justify-between">
                  <ThoughtLine
                    label={
                      triageData?.isEmergency
                        ? "Emergency override active"
                        : audioState === "PATIENT_LISTENING"
                        ? "Listening…"
                        : audioState === "PROCESSING_TRANSCRIPTION"
                        ? "Transcribing…"
                        : audioState === "TRANSCRIPT_REVIEW"
                        ? "Reviewing transcript…"
                        : audioState === "DOCTOR_SPEAKING"
                        ? "Speaking…"
                        : "Ready"
                    }
                    doneLabel="Clinical system ready"
                    working={
                      !triageData?.isEmergency &&
                      (audioState === "PATIENT_LISTENING" ||
                        audioState === "PROCESSING_TRANSCRIPTION" ||
                        audioState === "TRANSCRIPT_REVIEW" ||
                        audioState === "BARGE_IN_DETECTED")
                    }
                    isEmergency={Boolean(triageData?.isEmergency)}
                    emergencyDirective={
                      triageData?.isEmergency
                        ? "Deterministic Red Flag Detected · Emergency Escalation Active"
                        : undefined
                    }
                    steps={[]}
                    collapsible={false}
                    showTimer={false}
                    glyph={triageData?.isEmergency ? "none" : "sparkle"}
                    color="#0891b2"
                    glyphColor="#06b6d4"
                    className="w-full justify-between"
                  />
                </div>
              )}

            </div>

            {/* UNIFIED PHYSICAL VOICE PILL CONTROL */}
            <div className="pt-2 border-t border-slate-200/80">
              <VoicePill
                state={voicePillState}
                transcriptSnippet={transcriptText}
                typedValue={typedInput}
                onTypedChange={setTypedInput}
                pendingTranscript={pendingTranscript}
                onPendingTranscriptChange={setPendingTranscript}
                onConfirmSend={confirmAndSendTranscript}
                onReRecord={handleReRecord}
                onDiscard={handleDiscardTranscript}
                speakerName={activeSpeaker.name}
                speakerVoiceId={activeSpeaker.voiceId}
                onSubmitText={(text) => {
                  setTypedInput("");
                  if (audioState === "DOCTOR_SPEAKING") {
                    triggerBargeIn(text);
                  } else {
                    handleUserUtterance(text);
                  }
                }}
                onToggleRecord={() => {
                  if (audioState === "TRANSCRIPT_REVIEW") {
                    handleReRecord();
                  } else if (audioState !== "PATIENT_LISTENING") {
                    if (!callActive) {
                      callActiveRef.current = true;
                      setCallActive(true);
                    }
                    startSpeechRecognitionListening();
                  }
                }}
                onStopRecord={cancelVoiceRecording}
                onSendRecord={() => commitSpokenText()}
                onInterrupt={() => triggerBargeIn()}
              />
            </div>

            {/* Compact Clinical Safety Status */}
            <div className="pt-3 border-t border-slate-200/70">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-semibold text-slate-700">Clinical Safety</span>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                  triageData?.isEmergency
                    ? "text-rose-800 bg-rose-50 border-rose-200"
                    : "text-emerald-800 bg-emerald-50 border-emerald-200"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    triageData?.isEmergency ? "bg-rose-500" : "bg-emerald-500"
                  } animate-pulse`} />
                  {triageData?.isEmergency
                    ? "Emergency Detected"
                    : callActive
                    ? "Active · Protected"
                    : "Standby"}
                </span>
              </div>
            </div>
          </section>

          {/* RIGHT PANEL (5 cols): CLINICAL BOARD HERO + UNIFIED STATUS */}
          <div className="lg:col-span-5 flex flex-col gap-4">

            {/* HERO MODULE: LIVE CLINICAL BOARD REASONING */}
            <section className="relative flex flex-col gap-4 p-5 sm:p-6 rounded-2xl bg-[#F8FAFC] border border-slate-200/90 shadow-sm overflow-hidden">

              {/* Subtle CursorGrid background texture */}
              <CursorGrid
                cellSize={50}
                radius={100}
                falloff="smooth"
                holdTime={250}
                fadeDuration={700}
                lineWidth={0.8}
                maxOpacity={0.07}
                fillOpacity={0}
                gridOpacity={0.02}
                cellRadius={0}
                clickPulse={true}
                pulseSpeed={600}
              />

              <div className="relative z-10 flex flex-col gap-5">

                {/* Module Header */}
                <div className="relative flex flex-col gap-3 pb-3 border-b border-slate-200/80">

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-500 font-mono">
                        Assessment
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                        <span className="text-sm font-bold text-slate-900 uppercase tracking-wide font-mono">
                          {callActive ? "In Progress" : "Standby"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Clinical Segmented Tab Navigation */}
                <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-slate-100/90 border border-slate-200/70 text-sm font-semibold">
                  <button
                    type="button"
                    onClick={() => setActiveRightTab("board")}
                    className={`flex-1 py-2.5 px-4 rounded-xl transition-all cursor-pointer text-center text-xs sm:text-sm ${
                      activeRightTab === "board"
                        ? "bg-white text-slate-950 font-bold shadow-xs border border-slate-200/80"
                        : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                    }`}
                  >
                    Review
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveRightTab("context")}
                    className={`flex-1 py-2.5 px-4 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 text-xs sm:text-sm ${
                      activeRightTab === "context"
                        ? "bg-white text-slate-950 font-bold shadow-xs border border-slate-200/80"
                        : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                    }`}
                  >
                    <span>Context</span>
                    {hasContextFacts && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-teal-100 text-teal-800 font-bold">
                        {contextKnownFacts.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveRightTab("care")}
                    className={`flex-1 py-2.5 px-4 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 text-xs sm:text-sm ${
                      activeRightTab === "care"
                        ? "bg-white text-slate-950 font-bold shadow-xs border border-slate-200/80"
                        : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                    }`}
                  >
                    <span>Care Options</span>
                    {nearbyHospitals && nearbyHospitals.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-emerald-100 text-emerald-800 font-bold">
                        {nearbyHospitals.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* TAB: DELIBERATION STREAM (HUMAN-SCALE AGENT CARDS + REACT BITS ANIMATION) */}
                {activeRightTab === "board" && (
                  <div className="flex flex-col gap-5 pt-1">

                    {/* Active Inquiry Specialist Banner (if awaiting response) */}
                    {boardData?.phase === "active_inquiring" && boardData.active_requests && boardData.active_requests.length > 0 && (
                      <AnimatedContent contentKey={boardData.active_requests[0].targetSlot}>
                        <div className="p-4.5 rounded-2xl bg-amber-50/90 border border-amber-200 flex flex-col gap-2.5 shadow-2xs">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-slate-900">
                              {boardData.active_requests[0].doctorName.replace(", MD, FACC", "").replace(", MD, PhD", "").replace(", MD, FAAP", "").replace(", MD", "")}
                            </span>
                            <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-900 bg-amber-200/80 px-2.5 py-0.5 rounded-full border border-amber-300">
                              {boardData.active_requests[0].targetSlot.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-sm text-slate-800 italic leading-relaxed">
                            "{boardData.active_requests[0].suggestedQuestion}"
                          </p>
                        </div>
                      </AnimatedContent>
                    )}

                    {/* Agent Cards Feed with GlowingBorder & Tiny Pulse Motion */}
                    <div className="flex flex-col gap-4.5">
                      {(() => {
                        if (!boardData?.deliberation_messages || boardData.deliberation_messages.length === 0) {
                          return [
                            {
                              id: "intake-lead",
                              doctorName: selectedDoctor?.name ? selectedDoctor.name.split(",")[0] : "Lead Clinician",
                              specialty: selectedDoctor?.title || "Primary Care & Clinical Triage Lead",
                              role: "lead",
                              statusText: callActive ? "LIVE" : "STANDBY",
                              statusColor: "bg-cyan-500",
                              badgeLabel: "PRIMARY INTAKE",
                              badgeColor: "text-cyan-800 bg-cyan-50 border-cyan-200",
                              isLive: callActive,
                              content: callActive
                                ? `Active consultation in progress with ${selectedDoctor?.name ? selectedDoctor.name.split(",")[0] : "your clinician"}. Your symptoms are being reviewed for important warning signs.`
                                : `${selectedDoctor?.name ? selectedDoctor.name.split(",")[0] : "Your clinician"} is ready. Start a voice consultation to discuss your symptoms.`,
                              timestamp: "Live",
                              evidence: [] as Array<{ name: string; value: string }>
                            }
                          ];
                        }

                        const events: Array<{
                          id: string;
                          doctorName: string;
                          specialty: string;
                          role: string;
                          statusText: string;
                          statusColor: string;
                          badgeLabel: string;
                          badgeColor: string;
                          isLive: boolean;
                          content: string;
                          timestamp: string;
                          evidence: Array<{ name: string; value: string }>;
                        }> = [];

                        boardData.deliberation_messages.forEach((msg, idx) => {
                          if (msg.speakerRole === "safety_arbiter") return;

                          if (msg.speakerRole === "tool") {
                            if (events.length > 0) {
                              const lastEvent = events[events.length - 1];
                              const cleanToolName = (msg.tool_data?.tool_name || "Diagnostic Tool")
                                .replace(/^compute_|^analyze_|^calculate_/, "")
                                .toUpperCase();
                              const summary = msg.tool_data?.summary || msg.content.replace(/^Executed [^:]+:\s*/, "");
                              lastEvent.evidence.push({ name: cleanToolName, value: summary });
                            }
                            return;
                          }

                          const isLead = msg.speakerRole === "lead";
                          const cleanDocName = msg.doctorName
                            .replace(", MD, FACC", "")
                            .replace(", MD, PhD", "")
                            .replace(", MD, FAAP", "")
                            .replace(", MD, DVD", "")
                            .replace(", MD", "");
                          const specialtyClean = msg.specialty || (isLead ? "Primary Care & Clinical Triage Lead" : "Clinical Specialist");

                          let statusText = isLead ? "LIVE" : "REVIEWING";
                          let statusColor = isLead ? "bg-cyan-500" : "bg-purple-500";
                          let badgeLabel = isLead ? "PRIMARY INTAKE" : "ASSESSMENT";
                          let badgeColor = isLead
                            ? "text-cyan-800 bg-cyan-50 border-cyan-200"
                            : "text-purple-800 bg-purple-50 border-purple-200";

                          if (msg.type === "challenge") {
                            badgeLabel = "PEER CHALLENGE";
                            badgeColor = "text-amber-800 bg-amber-50 border-amber-200";
                            statusText = "CHALLENGING";
                            statusColor = "bg-amber-500";
                          } else if (msg.type === "synthesis") {
                            badgeLabel = "SYNTHESIS";
                            badgeColor = "text-emerald-800 bg-emerald-50 border-emerald-200";
                            statusText = "ALIGNED";
                            statusColor = "bg-emerald-500";
                          }

                          const evidence: Array<{ name: string; value: string }> = [];
                          if (msg.references && msg.references.length > 0) {
                            msg.references.forEach((ref) => {
                              const cit = boardData?.citations?.[ref];
                              evidence.push({
                                name: ref,
                                value: cit ? cit.title : "Clinical Protocol Reference"
                              });
                            });
                          }

                          events.push({
                            id: msg.id || `evt-${idx}`,
                            doctorName: cleanDocName,
                            specialty: specialtyClean,
                            role: msg.speakerRole,
                            statusText,
                            statusColor,
                            badgeLabel,
                            badgeColor,
                            isLive: isLead || msg.type === "synthesis",
                            content: msg.content.replace(/^"|"$/g, ""),
                            timestamp: msg.timestamp || "12:48 PM",
                            evidence
                          });
                        });

                        return events;
                      })().map((evt, idx) => {
                        return (
                          <AnimatedContent key={evt.id || idx} contentKey={evt.content}>
                            <GlowingBorder
                              active={evt.isLive}
                              glowColor={evt.role === "lead" ? "cyan" : "purple"}
                              intensity="subtle"
                              className="p-5 sm:p-6 rounded-2xl bg-white shadow-2xs flex flex-col gap-3.5 transition-shadow hover:shadow-xs border border-slate-200/90"
                            >
                              {/* Card Header: Doctor Name, Specialty, Status & Timestamp */}
                              <div className="flex flex-wrap items-start justify-between gap-2.5">
                                <div className="flex flex-col min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className={`w-2.5 h-2.5 rounded-full ${evt.statusColor} ${evt.isLive ? "animate-pulse" : ""}`} />
                                    <h4 className="text-base sm:text-lg font-bold text-slate-950 tracking-tight">
                                      {evt.doctorName}
                                    </h4>
                                  </div>
                                  <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                                    {evt.specialty}
                                  </p>
                                </div>

                                <div className="flex items-center gap-2.5 shrink-0">
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider border ${evt.badgeColor}`}>
                                    {evt.statusText}
                                  </span>
                                  <span className="text-xs font-mono text-slate-500 font-medium">
                                    {formatTimelineTime(evt.timestamp)}
                                  </span>
                                </div>
                              </div>

                              {/* Card Body: High-Legibility Clinical Summary */}
                              <p className="text-sm sm:text-base text-slate-700 font-normal leading-relaxed">
                                {evt.content}
                              </p>

                              {/* Evidence Accordion / Reference Footnote */}
                              {evt.evidence && evt.evidence.length > 0 && (
                                <div className="pt-2 border-t border-slate-100">
                                  <button
                                    type="button"
                                    onClick={() => toggleEvidence(evt.id)}
                                    className="text-xs font-semibold text-cyan-700 hover:text-cyan-900 flex items-center gap-1.5 cursor-pointer transition-colors"
                                  >
                                    {expandedEvidenceIds[evt.id] ? (
                                      <>
                                        <ChevronDown className="w-4 h-4" />
                                        <span>Hide clinical references</span>
                                      </>
                                    ) : (
                                      <>
                                        <ChevronRight className="w-4 h-4" />
                                        <span>Evidence & guidelines referenced ({evt.evidence.length})</span>
                                      </>
                                    )}
                                  </button>

                                  {expandedEvidenceIds[evt.id] && (
                                    <div className="mt-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col gap-2 animate-in fade-in duration-200">
                                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                                        Evidence & Validated Guidelines
                                      </span>
                                      <div className="space-y-1.5">
                                        {evt.evidence.map((item, eIdx) => (
                                          <div key={eIdx} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-white border border-slate-200/60 text-xs">
                                            <span className="font-mono font-bold text-xs text-slate-800 uppercase">
                                              {item.name}
                                            </span>
                                            <span className="font-medium text-xs text-slate-600 text-right truncate max-w-[220px]">
                                              {item.value}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </GlowingBorder>
                          </AnimatedContent>
                        );
                      })}
                    </div>



                  </div>
                )}

                {/* TAB: CLINICAL CONTEXT */}
                {activeRightTab === "context" && (
                  <div className="flex flex-col gap-4 py-1">
                    <SpotlightCard
                      spotlightColor="rgba(20, 184, 166, 0.12)"
                      className="p-5 sm:p-6 bg-white border border-slate-200/90 shadow-2xs flex flex-col gap-5"
                    >
                      {/* Context Header: Title & History Completeness */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-teal-700">
                            CLINICAL CONTEXT
                          </span>
                          <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug">
                            History Completeness
                          </h3>
                          <p className="text-xs sm:text-sm text-slate-600 font-medium flex items-center gap-1.5">
                            {(audioState === "PATIENT_LISTENING" || audioState === "PROCESSING_TRANSCRIPTION" || audioState === "PROCESSING_CLINICAL" || audioState === "PROCESSING_INTERRUPTION") && (
                              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                            )}
                            <span>{contextSubtitle}</span>
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-2xl sm:text-3xl font-bold font-mono text-slate-900">
                            <CountUp to={completenessPercent} duration={0.8} />%
                          </span>
                          <p className="text-xs font-mono text-slate-600 mt-0.5">
                            {hasContextFacts ? `${contextKnownFacts.length} elements confirmed` : "0 elements"}
                          </p>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden p-0.5 border border-slate-200/70">
                        <div
                          className="h-full bg-linear-to-r from-teal-500 via-emerald-500 to-cyan-500 rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.max(completenessPercent === 0 ? 0 : 4, completenessPercent))}%`
                          }}
                        />
                      </div>

                      {/* Section 0: CURRENT COMPLAINT */}
                      {hasContextFacts && (
                        <div className="p-3 rounded-xl bg-teal-50/60 border border-teal-200/80 flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-xs font-mono font-bold uppercase tracking-wider text-teal-900">
                              CURRENT COMPLAINT
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-slate-900 font-bold ml-4.5">
                            {formatClinicalFact(
                              contextKnownFacts.find(f => /throat|chest|headache|pain|dizz|weak/i.test(f)) ||
                              contextKnownFacts[0]
                            )}
                          </p>
                          {contextKnownFacts.some(f => /course|onset|duration/i.test(f)) && (
                            <p className="text-xs text-slate-600 ml-4.5">
                              {contextKnownFacts
                                .filter(f => /onset|duration|course/i.test(f))
                                .map(f => formatClinicalFact(f))
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Section 1: ESTABLISHED CLINICAL FINDINGS */}
                      <div className="pt-2 border-t border-slate-200/70 flex flex-col gap-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700">
                            ESTABLISHED FINDINGS {hasContextFacts ? `(${contextKnownFacts.length})` : ""}
                          </span>
                        </div>

                        {!hasContextFacts ? (
                          <div className="py-3 px-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col gap-1.5">
                            <p className="text-xs sm:text-sm text-slate-800 font-semibold">
                              No clinical information captured yet.
                            </p>
                            <p className="text-xs text-slate-600 font-normal leading-relaxed">
                              Start the consultation to establish the patient's presenting symptoms.
                            </p>
                          </div>
                        ) : (
                          <AnimatedContent contentKey={contextKnownFacts.length}>
                            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                              {contextKnownFacts.map((fact: string, idx: number) => {
                                const isDenied = /denied|none/i.test(fact);
                                return (
                                  <div
                                    key={idx}
                                    className={`flex items-start gap-2.5 p-2 rounded-lg border text-xs sm:text-sm font-medium leading-relaxed ${
                                      isDenied
                                        ? "bg-slate-50 border-slate-200 text-slate-700"
                                        : "bg-teal-50/50 border-teal-200/70 text-slate-900"
                                    }`}
                                  >
                                    <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${isDenied ? "text-slate-500" : "text-teal-600"}`} />
                                    <span>{formatClinicalFact(fact)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </AnimatedContent>
                        )}
                      </div>

                      {/* Section 2: STILL TO ESTABLISH */}
                      <div className="pt-2 border-t border-slate-200/70 flex flex-col gap-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700">
                            STILL TO ESTABLISH {contextMissingDimensions.length > 0 ? `(${contextMissingDimensions.length})` : ""}
                          </span>
                        </div>

                        {contextMissingDimensions.length === 0 ? (
                          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs sm:text-sm text-emerald-900 font-medium">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>Clinical context sufficient for triage acuity and care disposition</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 max-h-44 overflow-y-auto pr-1">
                            {contextMissingDimensions.map((dim: string, idx: number) => (
                              <div
                                key={idx}
                                className="flex items-center gap-3 py-1.5 px-2.5 rounded-lg bg-slate-50/60 border border-slate-200/50 text-xs sm:text-sm text-slate-800 font-medium"
                              >
                                <Circle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <span>{dim}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Section 3: RED-FLAG SAFETY SCREEN (INDEPENDENT) */}
                      <div className="pt-2 border-t border-slate-200/70 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700">
                            RED-FLAG SAFETY SCREEN
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-bold uppercase ${
                            triageData?.isEmergency || (triageData?.redFlagsTriggered && triageData.redFlagsTriggered.length > 0)
                              ? "bg-red-100 text-red-800 border border-red-200"
                              : hasContextFacts
                              ? "bg-amber-50 text-amber-800 border border-amber-200"
                              : "bg-slate-100 text-slate-600"
                          }`}>
                            {triageData?.isEmergency
                              ? "⚠ Emergency Triggered"
                              : hasContextFacts
                              ? "Screening In Progress"
                              : "Pending Intake"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          {triageData?.isEmergency
                            ? "Immediate safety intervention active. Contact emergency dispatch."
                            : "Airway, swallowing safety, and hemodynamic red flags monitored independently of history completeness."}
                        </p>
                      </div>

                      {/* Section 4: NEXT BEST QUESTION / CLINICAL TARGET */}
                      {boardData?.pending_question && (
                        <div className="p-3 rounded-xl bg-cyan-50/70 border border-cyan-200/80 flex flex-col gap-1.5">
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-900">
                            NEXT BEST QUESTION
                          </span>
                          <p className="text-xs sm:text-sm text-slate-900 font-semibold italic">
                            "{boardData.pending_question.question}"
                          </p>
                          <p className="text-xs text-cyan-800">
                            Purpose: {boardData.pending_question.purpose}
                          </p>
                        </div>
                      )}

                      {/* Footer Guidance Note */}
                      <div className="pt-2 border-t border-slate-200/70 flex items-center gap-2 text-xs text-slate-600 font-medium">
                        <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>Clinical facts and completeness update dynamically after each patient answer.</span>
                      </div>

                    </SpotlightCard>
                  </div>
                )}

                {/* TAB: CARE OPTIONS & HOSPITAL RAG */}
                {activeRightTab === "care" && (
                  <div className="flex flex-col gap-4 py-1">
                    {/* Location Permission & Status Banner */}
                    <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-900 font-mono">
                          <MapPin className="w-4 h-4 text-cyan-600" />
                          <span>Emergency Care Network</span>
                        </div>
                        <span className="text-xs font-mono uppercase px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-bold border border-slate-200">
                          Verified Registry RAG
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
                        Verified emergency departments matched by clinical specialty, verified 24/7 ER status, and strict Haversine distance.
                      </p>

                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
                        <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 font-medium">
                          <span className={`w-2.5 h-2.5 rounded-full ${userLocation ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
                          <span>
                            {userLocation ? "Location verified (GPS)" : "Default Hub (Andhra Pradesh / Telangana)"}
                          </span>
                        </div>
                        {!userLocation && (
                          <button
                            type="button"
                            onClick={handleRequestLocation}
                            className="text-xs sm:text-sm font-bold text-cyan-800 hover:text-cyan-950 flex items-center gap-1.5 cursor-pointer bg-cyan-50 px-3 py-1.5 rounded-xl border border-cyan-300 hover:bg-cyan-100 transition-colors"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            <span>Share Location</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Hospital Candidates List */}
                    <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto pr-1">
                      {nearbyHospitals && nearbyHospitals.length > 0 ? (
                        nearbyHospitals.map((h: any, idx: number) => {
                          const isGov = h.ownership === "government";
                          const isTrust = h.ownership === "trust";
                          const ownershipLabel = isGov ? "Government" : isTrust ? "Trust Hospital" : "Private Center";

                          const isVerifiedMatch = h.clinicalSuitability === "verified_match";
                          const isGeneralER = h.clinicalSuitability === "general_emergency";

                          const isTrafficAware = h.routingMode === "traffic_aware";
                          const isRoadNetwork = h.routingMode === "road_network";

                          return (
                            <div
                              key={h.id || idx}
                              className={`p-4 sm:p-5 rounded-2xl bg-white border shadow-2xs flex flex-col gap-3 transition-all hover:border-slate-300 ${
                                idx === 0 && isVerifiedMatch ? "border-cyan-400/80 ring-1 ring-cyan-200" : "border-slate-200/90"
                              }`}
                            >
                              {/* Header: Name, City, and Travel ETA */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-col min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm sm:text-base font-bold text-slate-950 truncate">
                                      {h.name}
                                    </span>
                                    {idx === 0 && isVerifiedMatch && h.estimatedTravelMinutes && (
                                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 font-extrabold tracking-wide">
                                        ⚡ Fastest Reachable
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs sm:text-sm text-slate-600 font-medium truncate mt-0.5">
                                    {h.city}, {h.address}
                                  </span>
                                </div>

                                <div className="flex flex-col items-end shrink-0">
                                  <span className="font-mono text-xs sm:text-sm font-black text-cyan-950 bg-cyan-50 px-2.5 py-1 rounded-lg border border-cyan-200">
                                    {h.durationDisplay && h.durationDisplay !== "Driving time unavailable"
                                      ? h.durationDisplay
                                      : h.distanceDisplay || `~${Math.round(h.distanceKm)} km`}
                                  </span>
                                  {h.roadDistanceKm && (
                                    <span className="text-[11px] font-mono text-slate-500 mt-0.5">
                                      ~{h.roadDistanceKm} km by road
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Badges: Routing Mode, Live Congestion, Clinical Suitability, Ownership */}
                              <div className="flex items-center gap-2 flex-wrap text-xs font-mono font-medium">
                                {/* Routing Mode Badge */}
                                {isTrafficAware ? (
                                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                                    🚗 Traffic-Aware ETA
                                  </span>
                                ) : isRoadNetwork ? (
                                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-semibold">
                                    🚗 Road-Network Estimate
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                    📏 Straight-Line Distance
                                  </span>
                                )}

                                {/* Live Traffic Congestion Telemetry */}
                                {h.congestionLevel && h.congestionLevel !== "unknown" && (
                                  <span className={`px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1.5 ${
                                    h.congestionLevel === "heavy"
                                      ? "bg-rose-50 text-rose-800 border-rose-200"
                                      : h.congestionLevel === "moderate"
                                      ? "bg-amber-50 text-amber-800 border-amber-200"
                                      : "bg-emerald-50 text-emerald-800 border-emerald-200"
                                  }`}>
                                    <span className={`w-2 h-2 rounded-full ${
                                      h.congestionLevel === "heavy"
                                        ? "bg-rose-500"
                                        : h.congestionLevel === "moderate"
                                        ? "bg-amber-500"
                                        : "bg-emerald-500"
                                    }`} />
                                    <span>
                                      {h.congestionLevel === "heavy" ? "Heavy Traffic" : h.congestionLevel === "moderate" ? "Moderate Traffic" : "Flowing Smoothly"}
                                      {h.trafficDelayMinutes ? ` (+${h.trafficDelayMinutes}m)` : ""}
                                    </span>
                                  </span>
                                )}

                                {/* Clinical Suitability Badge */}
                                {isVerifiedMatch ? (
                                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-50 text-cyan-950 border border-cyan-300 font-bold">
                                    ✓ Verified Specialty & ER
                                  </span>
                                ) : isGeneralER ? (
                                  <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                                    ● 24/7 ER (Specialty Unverified)
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                    ○ Discovered Facility
                                  </span>
                                )}

                                {/* Ownership Badge */}
                                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200 font-medium">
                                  🏛 {ownershipLabel}
                                </span>
                              </div>

                              {/* Typical vs Traffic Delay Sub-bar */}
                              {isTrafficAware && h.staticDurationMinutes && h.trafficDelayMinutes !== undefined && h.trafficDelayMinutes > 0 && (
                                <div className="text-xs text-slate-600 flex items-center gap-2 bg-amber-50/70 px-3 py-1.5 rounded-xl border border-amber-200/80 font-medium">
                                  <span className="font-bold text-amber-950">Traffic Impact:</span>
                                  <span>Typical drive is ~{h.staticDurationMinutes} min · Current congestion adds +{h.trafficDelayMinutes} min</span>
                                </div>
                              )}

                              {/* Affordability Notes (if verified) */}
                              {h.affordabilityNotes && (
                                <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 leading-relaxed font-normal">
                                  💡 {h.affordabilityNotes}
                                </p>
                              )}

                              {/* Footer: Provenance & Direct Dial */}
                              <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
                                <span className="text-xs text-slate-500 font-mono truncate max-w-[200px]" title={`${h.source} · ${h.freshnessLabel || "Calculated just now"}`}>
                                  ✓ {h.freshnessLabel || h.source || "Verified Registry"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleInitiateEmergencyCall(h.emergencyPhone || h.phone || "108", h.name)}
                                  className="text-xs sm:text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 px-3.5 py-2 rounded-xl flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
                                >
                                  <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Call {h.emergencyPhone || "108"}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-8 sm:p-10 rounded-2xl bg-white border border-slate-200/90 text-center flex flex-col items-center justify-center text-slate-400 gap-3.5 shadow-2xs">
                          <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shadow-2xs">
                            <Building2 className="w-7 h-7 text-slate-600" />
                          </div>
                          <h4 className="text-base sm:text-lg font-bold text-slate-950">No care network barriers triggered yet</h4>
                          <p className="text-xs sm:text-sm text-slate-600 max-w-sm leading-relaxed font-normal">
                            Care Network routing engages when financial constraints, remote outskirts, or transportation barriers are expressed by the patient.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* National Emergency Protocols Box */}
                    <div className="mt-2 p-4 sm:p-5 rounded-2xl bg-rose-50/90 border border-rose-200/90 flex flex-col gap-3 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs sm:text-sm font-mono font-bold uppercase tracking-wider text-rose-950 flex items-center gap-2">
                          <PhoneCall className="w-4 h-4 text-rose-600" />
                          <span>Emergency Dispatch (India)</span>
                        </span>
                        <span className="text-xs font-mono font-bold text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-200">
                          24/7 Priority
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => handleInitiateEmergencyCall("108", "Ambulance")}
                          className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold transition-all shadow-xs cursor-pointer"
                        >
                          <PhoneCall className="w-4 h-4" />
                          <span>Call 108 (Ambulance)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInitiateEmergencyCall("112", "National Emergency")}
                          className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-bold transition-all shadow-xs cursor-pointer"
                        >
                          <PhoneCall className="w-4 h-4" />
                          <span>Call 112 (National)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </section>

            {/* UNIFIED CLINICAL STATUS & SAFETY MODULE */}
            <GlowingBorder
              active={true}
              glowColor="emerald"
              intensity="subtle"
              className="p-6 sm:p-7 bg-white border border-slate-200/90 shadow-sm flex flex-col gap-5"
            >
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-200/80">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-6 h-6 text-emerald-600" />
                  <span className="text-base font-bold uppercase tracking-wider text-slate-950 font-mono">
                    Clinical Safety
                  </span>
                </div>
                <span className="inline-flex items-center gap-2 text-xs sm:text-sm font-mono text-emerald-800 bg-emerald-50 px-3.5 py-1.5 rounded-full border border-emerald-200 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>ACTIVE</span>
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 pt-1">

                {/* Left Card: Live Triage */}
                <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-5 flex flex-col justify-between gap-4 shadow-2xs">
                  <div>
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/60">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
                        Live Triage
                      </span>
                      {triageData ? (
                        <span className={`text-xs font-mono font-bold uppercase px-2.5 py-1 rounded-full border ${
                          triageData.triageLevel === "emergency"
                            ? "bg-rose-50 text-rose-700 border-rose-200 font-extrabold"
                            : triageData.triageLevel === "priority"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : triageData.triageLevel === "gathering_history"
                            ? "bg-cyan-50 text-cyan-800 border-cyan-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}>
                          {triageData.triageLevel === "gathering_history" ? "Intake Active" : triageData.triageLevel}
                        </span>
                      ) : (
                        <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-200/60 px-2.5 py-0.5 rounded-full">
                          Standby
                        </span>
                      )}
                    </div>

                    <div className="mt-3.5">
                      {triageData ? (
                        <AnimatedContent contentKey={`${triageData.esiScore}-${triageData.triageLevel}`}>
                          <div className="flex flex-col">
                            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                              ESI Acuity Index
                            </span>
                            {triageData.esiScore !== null && triageData.esiScore !== undefined ? (
                              <span className={`text-3xl sm:text-4xl font-black font-mono leading-tight mt-0.5 ${
                                triageData.triageLevel === "emergency" ? "text-rose-600" : "text-slate-900"
                              }`}>
                                Level {triageData.esiScore}
                              </span>
                            ) : (
                              <span className="text-3xl sm:text-4xl font-black font-mono leading-tight text-slate-300 mt-0.5">
                                —
                              </span>
                            )}
                            <h4 className="text-sm sm:text-base font-bold text-slate-950 leading-snug mt-1.5">
                              {triageData.triageTitle.replace(/^ESI LEVEL \d+:\s*(EMERGENT|URGENT|ROUTINE)?\s*—?\s*/i, "") || "Clinical History Gathering"}
                            </h4>
                            <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 mt-1 leading-relaxed font-normal">
                              {triageData.recommendedAction}
                            </p>
                          </div>
                        </AnimatedContent>
                      ) : (
                        <div className="py-1 flex flex-col gap-1.5">
                          <h4 className="text-base sm:text-lg font-bold text-slate-950">Awaiting symptoms</h4>
                          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
                            Your consultation is continuously assessed in real time as you provide more information.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-200/60">
                    {triageData?.triageLevel === "emergency" ? (
                      <Link
                        href="/emergency"
                        className="w-full py-2.5 px-3.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-2xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                      >
                        <Building2 className="w-4 h-4" />
                        <span>Hospital Dispatch →</span>
                      </Link>
                    ) : (
                      <div className="text-xs font-mono text-slate-500 font-medium flex items-center gap-2 py-0.5">
                        <span className="w-2 h-2 rounded-full bg-slate-400" />
                        <span>Emergency dispatch standby</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Card: Safety Guard */}
                <div className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-5 flex flex-col justify-between gap-4 shadow-2xs">
                  <div>
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/60">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
                        Safety Guard
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-800 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Protected</span>
                      </span>
                    </div>

                    <div className="mt-3.5 flex flex-col gap-1.5">
                      <h4 className="text-base sm:text-lg font-bold text-slate-950">Continuous Invariant Check</h4>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
                        Deterministic emergency safety rules remain active throughout the consultation.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-200/60">
                    <button
                      type="button"
                      onClick={() => setShowTechnicalTrace(!showTechnicalTrace)}
                      className="text-xs sm:text-sm font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <span>Safety details</span>
                      {showTechnicalTrace ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

              </div>

              {/* Patient-Facing Safety Details Drawer */}
              {showTechnicalTrace && (
                <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-xs sm:text-sm text-slate-700 leading-relaxed animate-in fade-in duration-200 flex flex-col gap-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-950 font-mono text-xs sm:text-sm uppercase tracking-wider">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Consultation Safety Policy</span>
                  </div>
                  <p className="text-slate-700 text-xs sm:text-sm leading-relaxed font-normal">
                    Safety protection is active. MedVoice continuously checks for critical symptoms during the consultation. If an emergency concern is detected, the consultation will prioritize urgent care guidance.
                  </p>
                </div>
              )}
            </GlowingBorder>

          </div>

        </div>
        </section>
            </motion.div>
          )}

          {/* ========================================================================= */}
          {/* STATE C: CONSULT COMPLETE (SOAP READY & RETURN TO LOBBY EXPERIENCE)       */}
          {/* ========================================================================= */}
          {sessionMode === "CONSULT_COMPLETE" && (
            <motion.div
              key="consult-complete"
              initial={{ opacity: 0, scale: 0.97, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex flex-col gap-6 max-w-4xl mx-auto w-full pt-4 sm:pt-6"
            >
              {/* Completion Banner */}
              <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col items-center text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 tracking-wider uppercase font-mono shadow-2xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>CONSULTATION COMPLETE</span>
                </div>

                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-950 tracking-tight">
                  Your consultation with {selectedDoctor.name.split(",")[0]}
                </h1>
                <p className="text-sm sm:text-base text-slate-600 max-w-xl font-normal leading-relaxed">
                  Your clinical history has been recorded and your assessment is ready to review.
                </p>

                {/* Real-time Persistence Status Indicator */}
                <div className="pt-0.5">
                  {persistenceStatus === "saving" && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-50 border border-cyan-200 text-xs font-mono text-cyan-800">
                      <span className="w-2 h-2 rounded-full bg-cyan-500 animate-ping" />
                      <span>Syncing encounter to clinical archive...</span>
                    </div>
                  )}
                  {persistenceStatus === "saved" && (
                    <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-mono font-bold text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Archived to Record · Pending Clinician Review</span>
                      {currentEncounterId && <span className="text-slate-400 font-normal">({currentEncounterId})</span>}
                    </div>
                  )}
                  {persistenceStatus === "error" && (
                    <div className="inline-flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span>Sync pending: {persistenceError}</span>
                      <button
                        type="button"
                        onClick={() => persistEncounterRecord(stableEncounterIdRef.current, callDuration)}
                        className="px-2.5 py-0.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-[11px] cursor-pointer"
                      >
                        Retry Sync
                      </button>
                    </div>
                  )}
                </div>

                {/* Clean 3-Card Summary Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 w-full max-w-2xl pt-2">
                  {/* Card 1: Consultation Duration */}
                  <div className="p-4.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-left flex flex-col justify-between">
                    <div className="text-[11px] font-mono font-bold text-slate-500 uppercase">Consultation</div>
                    <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1.5 font-sans">
                      {formatNaturalDuration(callDuration)}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {messages.filter(m => m.role === "patient").length || 1} answers recorded
                    </div>
                  </div>

                  {/* Card 2: Assessment */}
                  <div className="p-4.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-left flex flex-col justify-between">
                    <div className="text-[11px] font-mono font-bold text-slate-500 uppercase">Assessment</div>
                    <div className={`text-xl sm:text-2xl font-black mt-1.5 ${
                      triageData?.triageLevel === "emergency" ? "text-rose-600" : "text-slate-900"
                    }`}>
                      {triageData?.triageLevel === "emergency"
                        ? "Immediate attention"
                        : triageData?.triageLevel === "priority"
                        ? "Priority care"
                        : (triageData?.soap?.assessment || (triageData?.esiScore != null && triageData.triageLevel !== "gathering_history"))
                        ? "Review ready"
                        : "Assessment pending"}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {triageData?.triageLevel === "emergency"
                        ? "Emergency evaluation indicated"
                        : (triageData?.soap?.assessment || (triageData?.esiScore != null && triageData.triageLevel !== "gathering_history"))
                        ? "Symptoms reviewed"
                        : "Intake recorded for clinician review"}
                    </div>
                  </div>

                  {/* Card 3: Record */}
                  <div className="p-4.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-left flex flex-col justify-between">
                    <div className="text-[11px] font-mono font-bold text-slate-500 uppercase">Record</div>
                    <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1.5">
                      {triageData?.soap?.subjective && triageData?.soap?.assessment
                        ? "SOAP note available"
                        : "Intake summary ready"}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {triageData?.soap?.subjective && triageData?.soap?.assessment
                        ? "Clinical documentation compiled"
                        : "Patient narrative documented"}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-4 w-full">
                  <button
                    type="button"
                    onClick={() => setShowSoapModal(true)}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-bold shadow-md hover:shadow-lg transition-all cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    <span>View Full SOAP Clinical Report</span>
                  </button>

                  <button
                    type="button"
                    onClick={startNewConsultation}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-slate-950 hover:bg-slate-800 text-white text-sm font-bold shadow-md hover:shadow-lg transition-all cursor-pointer"
                  >
                    <ArrowRight className="w-4 h-4 text-cyan-400" />
                    <span>Start New Consultation</span>
                  </button>

                  <Link
                    href="/care"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 text-sm font-semibold border border-slate-200/90 shadow-2xs transition-all cursor-pointer"
                  >
                    <Building2 className="w-4 h-4 text-slate-500" />
                    <span>Hospital Care Options →</span>
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>



        {/* EMERGENCY CALL CONFIRMATION MODAL */}
        {emergencyCallTarget?.isOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="emergency-dialog-title"
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={() => setEmergencyCallTarget(null)}
          >
            <div
              className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 flex flex-col gap-4 animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                    <PhoneCall className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 id="emergency-dialog-title" className="text-base font-bold text-slate-900 leading-snug">
                      {emergencyCallTarget.title}
                    </h3>
                    <span className="text-xs text-slate-500 font-mono">
                      Target: {emergencyCallTarget.number} ({emergencyCallTarget.serviceName})
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEmergencyCallTarget(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 flex flex-col gap-1.5">
                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  {emergencyCallTarget.description}
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  MedVoice provides care guidance and navigation. Please confirm before initiating this outgoing call.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEmergencyCallTarget(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmEmergencyCall}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Open dialer ({emergencyCallTarget.number}) →</span>
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
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
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
          {clinicalToasts.map((toast, tIdx) => (
            <div key={`${toast.id || "toast"}-${tIdx}`} className="pointer-events-auto">
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
          patientName: patientDisplayName,
          doctorId: selectedDoctor.id,
          doctorName: selectedDoctor.name,
          specialty: selectedDoctor.department,
          callDuration: callDuration,
          transcript: messages.map((m) => ({
            role: m.role,
            text: m.text,
            timestamp: m.timestamp,
          })),
          triageLevel: triageData?.triageLevel || (boardData?.phase === "decided" ? "priority" : "routine"),
          triageTitle: triageData?.triageTitle || "Clinical Voice Consultation Evaluation",
          esiScore: triageData?.esiScore ?? null,
          detectedSymptoms: triageData?.detectedSymptoms || [],
          icdCodes: triageData?.icdCodes || [],
          recommendedAction: triageData?.recommendedAction || "Consultation complete. Follow clinical disposition.",
          soap: triageData?.soap || {
            subjective: "",
            objective: "",
            assessment: "",
            plan: "",
          },
          auditSha256: boardData?.trace?.audit_sha256,
          userId: user?.id,
        }}
        onSaveSuccess={() => {
          setPersistenceStatus("saved");
        }}
      />

      <AppFooter />
    </div>
  );
}


