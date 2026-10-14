"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Activity,
  Zap,
  PhoneCall,
  ExternalLink,
  Building2,
  ArrowRight,
  Sparkles,
  Check,
  Search,
  Crosshair,
  ShieldAlert,
  RotateCcw
} from "lucide-react";

interface TriageResult {
  triage_level: "emergency" | "priority" | "routine";
  triage_title: string;
  esi_score: number;
  specialty: string;
  detected_symptoms: string[];
  icd10_codes: string[];
  recommended_action: string;
  spoken_response: string;
  soap_summary: string;
}

interface HospitalItem {
  id: string;
  name: string;
  specialty: string[];
  city: string;
  state: string;
  address: string;
  phone: string;
  emergencyPhone: string;
  latitude: number;
  longitude: number;
  isEmergency24x7: boolean;
  rating: number;
  accreditation: string[];
  distanceKm: number;
  etaMinutes?: number;
  googleMapsUrl: string;
}

const SAMPLE_SCENARIOS = [
  {
    label: "🚨 Cardiac Emergency (ESI 1)",
    text: "58-year-old male with severe crushing chest pain radiating to left arm, cold sweats, and shortness of breath.",
  },
  {
    label: "🧠 Acute Stroke Symptoms (ESI 1)",
    text: "64-year-old female with sudden right-sided facial droop, slurred speech, and arm weakness that started 20 minutes ago.",
  },
  {
    label: "🫁 Severe Asthma Attack (ESI 2)",
    text: "28-year-old patient with acute asthma flare-up, audible wheezing, and inability to speak in full sentences.",
  },
  {
    label: "👶 Pediatric High Fever (ESI 3)",
    text: "3-year-old toddler with 103.2°F fever, lethargy, dry cough, and reduced fluid intake for 24 hours.",
  },
];

export function VoiceCallSimulator() {
  const [customInput, setCustomInput] = useState<string>("");
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);
  const [liveTriage, setLiveTriage] = useState<TriageResult | null>(null);

  // Audio stream & visualizer states
  const [audioLevels, setAudioLevels] = useState<number[]>([15, 20, 30, 25, 18, 22, 16, 28, 20, 15, 22, 18]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  const [isWakeWordMode, setIsWakeWordMode] = useState<boolean>(true);
  const [isAwake, setIsAwake] = useState<boolean>(false);
  const [isSpeechRecognitionSupported, setIsSpeechRecognitionSupported] = useState<boolean>(true);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Browser STT Capability Detection & Resource Cleanup on Unmount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasSpeech = Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
      setIsSpeechRecognitionSupported(hasSpeech);
    }

    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.onend = null;
          speechRecognitionRef.current.onerror = null;
          speechRecognitionRef.current.onresult = null;
          speechRecognitionRef.current.stop();
        } catch (e) {}
        speechRecognitionRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Web Audio Synthetic Wake Chime
  const playWakeChime = () => {
    if (typeof window === "undefined") return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {}
  };

  // Matched hospitals state
  const [reportHospitals, setReportHospitals] = useState<HospitalItem[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState<boolean>(false);
  const [locationSearchInput, setLocationSearchInput] = useState<string>("");
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Fetch nearby hospitals for detected specialty and location
  const fetchReportHospitals = useCallback(
    async (specialty: string, searchLocation?: string, coords?: { lat: number; lng: number } | null) => {
      setHospitalsLoading(true);
      try {
        const params = new URLSearchParams();
        params.append("specialty", specialty || "emergency");
        if (searchLocation && searchLocation.trim()) {
          params.append("query", searchLocation.trim());
        }
        if (coords?.lat && coords?.lng) {
          params.append("lat", coords.lat.toString());
          params.append("lng", coords.lng.toString());
        }

        const res = await fetch(`/api/hospitals?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.hospitals) {
            setReportHospitals(data.hospitals.slice(0, 4));
          }
        }
      } catch (e) {
        console.warn("Error fetching report hospitals:", e);
      } finally {
        setHospitalsLoading(false);
      }
    },
    []
  );

  // Initial user coordinates detection
  useEffect(() => {
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserCoords(coords);
        },
        () => {}
      );
    }
  }, []);

  // Real Speech Synthesis function
  const speakTextOutLoud = (textToSpeak: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find((v) => v.lang.startsWith("en") && (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samantha")));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  // Run Triage API & trigger voice output
  const handleRunTriage = async (textToTriage: string) => {
    if (!textToTriage.trim()) return;

    setIsProcessing(true);
    setHasInteracted(true);
    stopSpeaking();

    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: textToTriage,
          patient_id: "P-1002",
          patient_name: "Live Intake Patient",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.triage) {
          setLiveTriage(data.triage);
          if (data.triage.spoken_response) {
            speakTextOutLoud(data.triage.spoken_response);
          }
          fetchReportHospitals(data.triage.specialty || "emergency", locationSearchInput, userCoords);
        }
      }
    } catch (e) {
      console.warn("Error calling triage backend API:", e);
    } finally {
      setIsProcessing(false);
    }
  };

  // Start Real Microphone & Web Audio Analyser
  const startRealMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // Real Audio Frequency Loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVisualizer = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        const levels = Array.from({ length: 12 }, (_, i) => {
          const val = dataArray[i * 2] || 0;
          return Math.max(12, Math.round((val / 255) * 85));
        });

        setAudioLevels(levels);
        animationFrameRef.current = requestAnimationFrame(updateVisualizer);
      };

      updateVisualizer();

      // Real Speech Recognition (STT)
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event: any) => {
          let currentTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }

          if (!currentTranscript.trim()) return;

          // 1. INSTANT BARGE-IN: If MedVoice is speaking, user speech immediately interrupts it!
          if (typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.speaking) {
            stopSpeaking();
          }

          // 2. WAKE WORD DETECTION
          if (isWakeWordMode) {
            const wakeMatch = currentTranscript.match(/(?:hey\s+)?(?:med\s*voice|doctor)/i);
            if (wakeMatch) {
              if (!isAwake) {
                playWakeChime();
                setIsAwake(true);
              }
              const cleanText = currentTranscript.replace(/(?:hey\s+)?(?:med\s*voice|doctor)/gi, "").trim();
              if (cleanText) {
                setCustomInput(cleanText);

                // Auto-triage after 1.4s silence pause
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = setTimeout(() => {
                  if (cleanText.length > 5) {
                    handleRunTriage(cleanText);
                    setIsAwake(false);
                  }
                }, 1400);
              }
            } else if (isAwake) {
              setCustomInput(currentTranscript);
              if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = setTimeout(() => {
                if (currentTranscript.trim().length > 5) {
                  handleRunTriage(currentTranscript.trim());
                  setIsAwake(false);
                }
              }, 1400);
            }
          } else {
            // Standard Manual Mode
            setCustomInput(currentTranscript);
          }
        };

        recognition.onerror = (event: any) => {
          console.warn("Speech recognition error:", event.error);
        };

        recognition.onend = () => {
          if (isListening && speechRecognitionRef.current) {
            try {
              recognition.start();
            } catch (e) {}
          }
        };

        recognition.start();
        speechRecognitionRef.current = recognition;
        setIsListening(true);
      } else {
        setIsSpeechRecognitionSupported(false);
        setIsListening(false);
        if (stream) stream.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
        if (audioCtx && audioCtx.state !== "closed") audioCtx.close().catch(() => {});
        audioContextRef.current = null;
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        alert("Live Speech Recognition is not supported by your current browser. You can type your symptoms below or select any sample scenario.");
      }
    } catch (err) {
      console.warn("Microphone access error:", err);
      alert("Microphone permission was not granted. You can type your symptoms or select a sample scenario below.");
    }
  };

  // Stop Real Microphone & Web Audio Analyser
  const stopRealMicrophone = () => {
    setIsListening(false);
    setIsAwake(false);

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.stop();
      } catch (e) {}
      speechRecognitionRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setAudioLevels([15, 20, 30, 25, 18, 22, 16, 28, 20, 15, 22, 18]);

    if (customInput.trim()) {
      handleRunTriage(customInput);
    }
  };

  const handleMicToggle = () => {
    if (!isSpeechRecognitionSupported) {
      alert("Live speech-to-text is not supported in this browser. Please type your symptoms in the box below or click any scenario.");
      return;
    }
    if (isListening) {
      stopRealMicrophone();
    } else {
      startRealMicrophone();
    }
  };

  const handleSelectScenario = (scenarioText: string) => {
    setCustomInput(scenarioText);
    handleRunTriage(scenarioText);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    if (isListening) stopRealMicrophone();
    handleRunTriage(customInput);
  };

  const parseSoap = (soapRaw: string) => {
    let subjective = "Patient presents with acute symptoms requiring immediate evaluation.";
    let objective = "Clinical indicators and vital signs parsed.";
    let assessment = "Urgent clinical risk profile established.";
    let plan = "Direct clinical emergency pathway initiated.";

    if (soapRaw.includes("S:") || soapRaw.includes("P:")) {
      const sMatch = soapRaw.match(/S:\s*([\s\S]*?)(?=\s*O:|\s*A:|\s*P:|$)/);
      const oMatch = soapRaw.match(/O:\s*([\s\S]*?)(?=\s*A:|\s*P:|$)/);
      const aMatch = soapRaw.match(/A:\s*([\s\S]*?)(?=\s*P:|$)/);
      const pMatch = soapRaw.match(/P:\s*([\s\S]*?)$/);

      if (sMatch) subjective = sMatch[1].trim();
      if (oMatch) objective = oMatch[1].trim();
      if (aMatch) assessment = aMatch[1].trim();
      if (pMatch) plan = pMatch[1].trim();
    }

    return { subjective, objective, assessment, plan };
  };

  return (
    <section id="playground" className="w-full py-8 md:py-12 bg-[#FAF9F6] border-b border-slate-200/80 text-slate-900">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 space-y-8">
        
        {/* HEADER */}
        <div className="text-center max-w-xl mx-auto space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-950 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <span>LIVE CLINICAL VOICE ENGINE</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-950">
            Tell MedVoice what's happening.
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 font-medium">
            Speak into your microphone or type symptoms to experience live speech transcription, clinical ESI triage, and voice guidance.
          </p>
        </div>

        {/* ============================================================ VOICE INTERACTION CONSOLE */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-sm space-y-6">
          
          {/* HANDS-FREE WAKE WORD TOGGLE BAR */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const newMode = !isWakeWordMode;
                  setIsWakeWordMode(newMode);
                  setIsAwake(false);
                }}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border ${
                  isWakeWordMode
                    ? "bg-cyan-50 text-cyan-950 border-cyan-300 ring-2 ring-cyan-500/10"
                    : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                }`}
              >
                <Sparkles className={`w-3.5 h-3.5 ${isWakeWordMode ? "text-cyan-600" : "text-slate-400"}`} />
                <span>Wake Word: "Hey MedVoice" {isWakeWordMode ? "(Enabled)" : "(Off)"}</span>
              </button>

              {isWakeWordMode && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Hands-Free Auto-Triage
                </span>
              )}
            </div>

            <span className="text-[11px] font-medium text-slate-500">
              {isWakeWordMode ? 'Say "Hey MedVoice [symptoms]"' : "Tap microphone to speak manually"}
            </span>
          </div>

          {/* REAL AUDIO FREQUENCY VISUALIZER */}
          <div className="flex flex-col items-center justify-center space-y-3 pt-1">
            <div className="flex items-center justify-center gap-1.5 h-16 w-full max-w-xs">
              {audioLevels.map((lvl, idx) => (
                <div
                  key={idx}
                  style={{ height: `${isListening ? lvl : 16}%` }}
                  className={`w-2 rounded-full transition-all duration-75 ${
                    isListening
                      ? isAwake
                        ? "bg-emerald-500 shadow-sm shadow-emerald-400/50"
                        : "bg-sky-500 shadow-sm shadow-sky-400/50"
                      : isSpeaking
                      ? "bg-cyan-500 animate-pulse"
                      : "bg-slate-200"
                  }`}
                />
              ))}
            </div>

            {/* LIVE STATUS TAG */}
            <div className="flex items-center gap-2">
              {isListening ? (
                isWakeWordMode && !isAwake ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-sky-50 text-sky-800 border border-sky-200">
                    <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
                    <span>Standby: Say "Hey MedVoice" to activate...</span>
                  </span>
                ) : isAwake ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-emerald-600" />
                    <span>"Hey MedVoice" heard! Listening to symptoms...</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-rose-600" />
                    <span>Listening live (Speak symptoms now)...</span>
                  </span>
                )
              ) : isSpeaking ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
                  <span>MedVoice Speaking Response (Speak to interrupt)</span>
                </span>
              ) : (
                <span className="text-xs font-semibold text-slate-400">
                  {isWakeWordMode ? 'Click mic or say "Hey MedVoice" to start' : "Tap microphone to speak or type symptoms below"}
                </span>
              )}

              {isSpeaking && (
                <button
                  onClick={stopSpeaking}
                  className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 border border-slate-200 transition-all cursor-pointer flex items-center gap-1"
                >
                  <VolumeX className="w-3 h-3" />
                  <span>Stop Voice</span>
                </button>
              )}
            </div>
          </div>

          {/* BROWSER COMPATIBILITY NOTICE */}
          {!isSpeechRecognitionSupported && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-amber-50 border border-amber-200/90 text-amber-900 text-xs font-medium">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Live microphone speech-to-text is not supported in this browser. You can type symptoms into the box below or click any clinical scenario for instant audio triage evaluation.
              </span>
            </div>
          )}

          {/* INPUT & CONTROL BAR */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative flex items-center rounded-2xl border border-slate-300 bg-slate-50/50 p-2 shadow-xs focus-within:border-slate-900 focus-within:bg-white transition-all">
              
              {/* MICROPHONE BUTTON */}
              <button
                type="button"
                onClick={handleMicToggle}
                className={`flex h-11 w-11 items-center justify-center rounded-xl font-bold transition-all shrink-0 cursor-pointer shadow-sm ${
                  isListening
                    ? "bg-rose-600 text-white ring-4 ring-rose-500/20 scale-105"
                    : "bg-slate-950 text-white hover:bg-slate-800"
                }`}
                title={isListening ? "Stop listening & analyze" : "Start speaking into microphone"}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* TRANSCRIPT INPUT FIELD */}
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder={isListening ? "Listening to your voice..." : "Describe symptoms (e.g. severe chest pressure, left arm pain)..."}
                className="w-full bg-transparent px-3 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />

              {/* RUN TRIAGE BUTTON */}
              <button
                type="submit"
                disabled={isProcessing || !customInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold transition-all shadow-sm shrink-0 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <span>Triage</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* QUICK PRESET CLINICAL SCENARIOS */}
          <div className="space-y-2 pt-1">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Or test standard clinical emergency scenarios:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SAMPLE_SCENARIOS.map((scenario, sIdx) => (
                <button
                  key={sIdx}
                  onClick={() => handleSelectScenario(scenario.text)}
                  className="text-left p-3 rounded-xl border border-slate-200 hover:border-slate-900 bg-white hover:bg-slate-50/80 transition-all cursor-pointer space-y-1 group"
                >
                  <div className="text-xs font-bold text-slate-900 group-hover:text-cyan-700 flex items-center justify-between">
                    <span>{scenario.label}</span>
                    <span className="text-[10px] text-slate-400 group-hover:translate-x-0.5 transition-transform">→</span>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-1">
                    {scenario.text}
                  </p>
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* ============================================================ LIVE CLINICAL TRIAGE PAYOFF REPORT */}
        {liveTriage && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-300">
            
            {/* PAYOFF HEADER */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase border ${
                    liveTriage.triage_level === "emergency"
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                    {liveTriage.triage_title}
                  </span>
                  <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                    ESI Score: Tier {liveTriage.esi_score}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-950">
                  {liveTriage.recommended_action}
                </h3>
              </div>

              {/* SPOKEN RESPONSE REPLAY BUTTON */}
              <button
                onClick={() => speakTextOutLoud(liveTriage.spoken_response)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-200 transition-all cursor-pointer shrink-0"
              >
                <Volume2 className="w-3.5 h-3.5 text-cyan-600" />
                <span>Replay Voice Guidance</span>
              </button>
            </div>

            {/* SPOKEN TEXT TRANSCRIPT BUBBLE */}
            <div className="p-4 rounded-2xl bg-cyan-50/60 border border-cyan-200/80 space-y-1.5">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-900 flex items-center gap-1.5">
                <Volume2 className="w-3 h-3 text-cyan-700" />
                <span>MEDVOICE CONVERSATIONAL SPOKEN GUIDANCE:</span>
              </div>
              <p className="text-xs font-semibold text-slate-800 leading-relaxed italic">
                "{liveTriage.spoken_response}"
              </p>
            </div>

            {/* CLINICAL GRID: DETECTED SYMPTOMS & ICD-10 CODES */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  EXTRACTED CLINICAL INDICATORS
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {liveTriage.detected_symptoms.map((symp, sIdx) => (
                    <span key={sIdx} className="text-xs font-semibold text-slate-800 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                      ✓ {symp}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  ICD-10 DIAGNOSTIC CODES
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {liveTriage.icd10_codes.map((code, cIdx) => (
                    <span key={cIdx} className="font-mono text-xs font-bold text-cyan-950 bg-cyan-50 px-2.5 py-1 rounded-lg border border-cyan-200">
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* STRUCTURED SOAP NOTE */}
            <div className="p-4 rounded-2xl bg-slate-950 text-white space-y-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-sky-400">
                EHR-READY PHYSICIAN SOAP DOCUMENTATION
              </div>
              {(() => {
                const { subjective, objective, assessment, plan } = parseSoap(liveTriage.soap_summary);
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
                    <div className="space-y-0.5">
                      <b className="text-white font-semibold">Subjective:</b>
                      <p className="line-clamp-2 text-slate-400">{subjective}</p>
                    </div>
                    <div className="space-y-0.5">
                      <b className="text-white font-semibold">Objective:</b>
                      <p className="line-clamp-2 text-slate-400">{objective}</p>
                    </div>
                    <div className="space-y-0.5">
                      <b className="text-white font-semibold">Assessment:</b>
                      <p className="line-clamp-2 text-slate-400">{assessment}</p>
                    </div>
                    <div className="space-y-0.5">
                      <b className="text-white font-semibold">Plan:</b>
                      <p className="line-clamp-2 text-slate-400">{plan}</p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* MATCHED 24/7 EMERGENCY HOSPITALS */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Matched Facilities with 24/7 Specialist Availability ({reportHospitals.length})</span>
                <span className="text-slate-500 font-normal">Sorted by shortest travel time</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {hospitalsLoading ? (
                  <div className="col-span-full py-6 text-center text-xs text-slate-400 animate-pulse">
                    Locating matched hospital facilities...
                  </div>
                ) : (
                  reportHospitals.map((hosp) => (
                    <div
                      key={hosp.id}
                      className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-slate-400 transition-all flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs font-bold text-slate-950 line-clamp-1">{hosp.name}</h4>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                            {hosp.distanceKm} km
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-1">{hosp.address}</p>
                      </div>

                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                        <a
                          href={`tel:${hosp.emergencyPhone || hosp.phone}`}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition-all shadow-xs"
                        >
                          <PhoneCall className="w-3 h-3" />
                          <span>Call ER</span>
                        </a>
                        <a
                          href={hosp.googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold transition-all shadow-xs"
                        >
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                          <span>Directions</span>
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

      </div>
    </section>
  );
}
