'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  Cpu,
  Layers,
  Cloud,
  Trash2,
  Database,
  ShieldCheck,
  Clock,
  Terminal,
  Activity,
  ArrowRight,
  Lock,
} from 'lucide-react';

export interface LifecycleStage {
  id: string;
  stepNum: string;
  name: string;
  shortLabel: string;
  category: 'ingest' | 'asr' | 'arbiter' | 'cloud' | 'disposal' | 'audit';
  badge: string;
  boundary: string;
  headline: string;
  details: string;
  retention: string;
  technicalTruth: string;
  coords: [number, number, number];
  icon: React.ComponentType<{ className?: string }>;
  isDisposal?: boolean;
}

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    id: 'audio_buffer',
    stepNum: '01',
    name: 'Audio Capture & Ingest',
    shortLabel: 'Audio Ingest',
    category: 'ingest',
    badge: 'Client → Server Ingest',
    boundary: 'Volatile RAM Ring-Buffer',
    headline: 'MediaRecorder 16kHz PCM audio stream in volatile server memory',
    details: 'Spoken patient audio is captured in the browser via standard MediaRecorder and streamed as binary multipart FormData to /api/voice/stt.',
    retention: 'Held in volatile server RAM buffer strictly during active transcription.',
    technicalTruth: 'Local Ingest: Spoken audio is held in temporary memory. Never written to permanent disk storage or relational database.',
    coords: [-2.8, 0.35, 0],
    icon: Mic,
  },
  {
    id: 'local_whisper',
    stepNum: '02',
    name: 'Local Speech Recognition',
    shortLabel: 'Local ASR',
    category: 'asr',
    badge: 'Local Execution (CPU/GPU)',
    boundary: 'Local FastAPI Whisper base.en',
    headline: 'Neural speech-to-text decoding executes locally on server',
    details: 'The audio buffer is processed by local OpenAI Whisper (base.en, 74M parameters) running inside the local FastAPI container to produce a text transcript.',
    retention: 'Ephemeral processing pass. Audio unlinked immediately upon completion.',
    technicalTruth: 'Local Execution: Spoken waveforms are converted to text locally on the FastAPI backend without streaming audio to external cloud services.',
    coords: [-1.4, 0.35, 0],
    icon: Cpu,
  },
  {
    id: 'clinical_context',
    stepNum: '03',
    name: 'Clinical State & Safety Arbiter',
    shortLabel: 'Safety Arbiter',
    category: 'arbiter',
    badge: 'Local State Machine',
    boundary: 'Deterministic Rules Engine',
    headline: 'Deterministic symptom parsing & ESI urgency classification',
    details: 'Transcript text is analyzed by a deterministic rule-based safety arbiter, checking universal red flags across ACS, stroke, and pediatric vitals with strict non-downgrade invariants.',
    retention: 'State maintained in encounter session memory; committed to consultation record upon finish.',
    technicalTruth: 'Local Invariant: 100% deterministic rules engine runs locally before any generative model tokens are produced.',
    coords: [0.0, 0.35, 0],
    icon: Layers,
  },
  {
    id: 'cloud_inference',
    stepNum: '04',
    name: 'Clinical Reasoning (LLM)',
    shortLabel: 'Cloud LLM',
    category: 'cloud',
    badge: 'Cloud Inference Boundary',
    boundary: 'Groq / NVIDIA NIM Cloud API',
    headline: 'Contextual doctor dialogue synthesized via cloud LLM API',
    details: 'De-identified clinical state and multi-turn dialogue context are submitted to Cloud LLM APIs (Groq LLaMA-3.3 / NVIDIA NIM) to generate bedside doctor guidance.',
    retention: 'Zero-data-retention API contracts; clinical prompt discarded post-generation.',
    technicalTruth: 'Cloud Inference Boundary: De-identified clinical text prompt is submitted to cloud LLM API. Only text is transmitted—raw audio never leaves local infrastructure.',
    coords: [1.4, 0.35, 0],
    icon: Cloud,
  },
  {
    id: 'audio_disposal',
    stepNum: '05A',
    name: 'Raw Audio Disposal',
    shortLabel: 'Audio Purge',
    category: 'disposal',
    badge: 'Memory Lifecycle Purge',
    boundary: 'Python finally: block',
    headline: 'Temporary audio buffers unlinked and purged post-transcription',
    details: 'Immediately after Whisper returns the transcript text, the temporary audio file is deleted inside audio_service.py in an explicit finally: os.remove() block.',
    retention: 'ZERO persistent voice retention on server disk or database.',
    technicalTruth: 'Confirmed by Codebase: audio_service.py unlinks temporary files immediately; no voice waveforms are persisted.',
    coords: [-1.4, -1.05, 0],
    icon: Trash2,
    isDisposal: true,
  },
  {
    id: 'audit_ledger',
    stepNum: '05B',
    name: 'Chained Audit Ledger',
    shortLabel: 'Audit Ledger',
    category: 'audit',
    badge: 'PostgreSQL Ledger',
    boundary: 'SHA-256 Chained Hash Digest',
    headline: 'Cryptographic hash-chained audit ledger tracks consultation events',
    details: 'Each consultation creation, clinical decision, and emergency dispatch creates a tamper-evident SHA-256 chained entry linking to previousHash in PostgreSQL.',
    retention: 'Durable immutable ledger entries for regulatory compliance.',
    technicalTruth: 'Cryptographic Digest: Audit metadata contains verification hashes, timestamps, and caller role. Does NOT store raw clinical audio.',
    coords: [2.8, 0.35, 0],
    icon: Database,
  },
];

// Precision Architectural Connecting Bus
function DataBusPath({
  start,
  end,
  dashed = false,
}: {
  start: [number, number, number];
  end: [number, number, number];
  dashed?: boolean;
}) {
  const lineObj = useMemo(() => {
    const p0 = new THREE.Vector3(...start);
    const p3 = new THREE.Vector3(...end);
    const midX = (p0.x + p3.x) / 2;
    const p1 = new THREE.Vector3(midX, p0.y, 0.02);
    const p2 = new THREE.Vector3(midX, p3.y, 0.02);
    const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
    const points = curve.getPoints(32);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: dashed ? new THREE.Color('#3f3f46') : new THREE.Color('#27272a'),
      transparent: true,
      opacity: dashed ? 0.45 : 0.75,
      linewidth: 1,
    });
    return new THREE.Line(geo, mat);
  }, [start, end, dashed]);

  return <primitive object={lineObj} />;
}

// Single Signal Pulse Traveling Along Bus in MedVoice Cyan
function SignalPulse({
  start,
  end,
  color = '#67E8F9',
  speed = 0.9,
  offset = 0,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color?: string;
  speed?: number;
  offset?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const p0 = useMemo(() => new THREE.Vector3(...start), [start]);
  const p3 = useMemo(() => new THREE.Vector3(...end), [end]);
  const curve = useMemo(() => {
    const midX = (p0.x + p3.x) / 2;
    const p1 = new THREE.Vector3(midX, p0.y, 0.03);
    const p2 = new THREE.Vector3(midX, p3.y, 0.03);
    return new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  }, [p0, p3]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const elapsed = clock.getElapsedTime() * speed + offset;
    const t = (elapsed % 2.4) / 2.4;
    const pt = curve.getPoint(t);
    meshRef.current.position.copy(pt);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.038, 14, 14]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} />
    </mesh>
  );
}

// Clean Precision Geometric Node (Architectural, No Spinning Radar Rings)
function Node3D({
  stage,
  isSelected,
  isHovered,
  onPointerOver,
  onPointerOut,
  onClick,
}: {
  stage: LifecycleStage;
  isSelected: boolean;
  isHovered: boolean;
  onPointerOver: () => void;
  onPointerOut: () => void;
  onClick: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const targetScale = isSelected ? 1.12 : isHovered ? 1.06 : 1.0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
    }
    if (haloRef.current && isSelected) {
      const pulse = 1 + Math.sin(clock.getElapsedTime() * 3) * 0.04;
      haloRef.current.scale.set(pulse, pulse, 1);
    }
  });

  const isDisposal = stage.isDisposal;
  const activeColor = isDisposal ? '#34d399' : '#67E8F9';

  return (
    <group
      ref={groupRef}
      position={stage.coords}
      onPointerOver={(e) => {
        e.stopPropagation();
        onPointerOver();
      }}
      onPointerOut={() => onPointerOut()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* 1. Subtle Outer Focus Ring on Selected Node Only (Clean, Not Spinning) */}
      {isSelected && (
        <mesh ref={haloRef} position={[0, 0, 0.01]}>
          <ringGeometry args={[0.29, 0.302, 48]} />
          <meshBasicMaterial color={activeColor} transparent opacity={0.75} />
        </mesh>
      )}

      {/* 2. Precision Bezel Ring */}
      <mesh position={[0, 0, 0.02]}>
        <ringGeometry args={[0.22, 0.235, 40]} />
        <meshBasicMaterial
          color={isSelected ? activeColor : isHovered ? '#71717a' : '#27272a'}
          transparent
          opacity={isSelected ? 0.95 : 0.45}
        />
      </mesh>

      {/* 3. Dark Precision Face (Near-Black Ceramic Surface) */}
      <mesh position={[0, 0, 0.03]}>
        <circleGeometry args={[0.21, 32]} />
        <meshStandardMaterial
          color="#09090b"
          roughness={0.4}
          metalness={0.7}
        />
      </mesh>

      {/* 4. Center Optic Core (Cyan when Selected, Graphite when Inactive) */}
      <mesh position={[0, 0, 0.06]}>
        <sphereGeometry args={[isSelected ? 0.082 : 0.058, 20, 20]} />
        <meshStandardMaterial
          color={isSelected ? activeColor : isHovered ? '#a1a1aa' : isDisposal ? '#10b981' : '#3f3f46'}
          emissive={isSelected ? activeColor : isHovered ? '#52525b' : isDisposal ? '#064e3b' : '#18181b'}
          emissiveIntensity={isSelected ? 1.5 : isDisposal ? 0.4 : 0.2}
          roughness={0.2}
          metalness={0.3}
        />
      </mesh>

      {/* 5. Center Laser Bead (White Highlight on Active Node) */}
      {isSelected && (
        <mesh position={[0, 0, 0.11]}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
    </group>
  );
}

// Subtle Parallax Controller (Restrained, Smooth Easing)
function SceneController({ reducedMotion }: { reducedMotion: boolean }) {
  const { camera } = useThree();
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (reducedMotion) return;
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [reducedMotion]);

  useFrame(() => {
    if (reducedMotion) {
      camera.position.set(0, -0.15, 5.0);
      camera.lookAt(0, -0.15, 0);
      return;
    }
    const targetX = mouseRef.current.x * 0.18;
    const targetY = mouseRef.current.y * 0.12 - 0.15;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.05);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.05);
    camera.lookAt(0, -0.15, 0);
  });

  return null;
}

// 3D Canvas Scene
function LifecycleCanvas({
  selectedStage,
  onSelectStage,
  hoveredStageId,
  setHoveredStageId,
  reducedMotion,
}: {
  selectedStage: LifecycleStage;
  onSelectStage: (stage: LifecycleStage) => void;
  hoveredStageId: string | null;
  setHoveredStageId: (id: string | null) => void;
  reducedMotion: boolean;
}) {
  return (
    <div className="w-full h-full cursor-pointer">
      <Canvas
        camera={{ position: [0, -0.15, 5.0], fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        {/* Restrained Precision Illumination */}
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 4, 3]} intensity={1.1} color="#ffffff" />
        <directionalLight position={[-3, -2, -1]} intensity={0.3} color="#94a3b8" />
        <pointLight position={[0, 0, 3.5]} intensity={0.4} color="#67e8f9" distance={8} />

        <SceneController reducedMotion={reducedMotion} />

        {/* Main Linear Bus (01 -> 02 -> 03 -> 04 -> 05B) */}
        <DataBusPath
          start={LIFECYCLE_STAGES[0].coords}
          end={LIFECYCLE_STAGES[1].coords}
        />
        <DataBusPath
          start={LIFECYCLE_STAGES[1].coords}
          end={LIFECYCLE_STAGES[2].coords}
        />
        <DataBusPath
          start={LIFECYCLE_STAGES[2].coords}
          end={LIFECYCLE_STAGES[3].coords}
        />
        <DataBusPath
          start={LIFECYCLE_STAGES[3].coords}
          end={LIFECYCLE_STAGES[5].coords}
        />

        {/* Downward Branch: Post-ASR Temp Audio Purge (02 -> 05A) */}
        <DataBusPath
          start={LIFECYCLE_STAGES[1].coords}
          end={LIFECYCLE_STAGES[4].coords}
          dashed
        />

        {/* Restrained Cyan Signal Pulses */}
        {!reducedMotion && (
          <>
            <SignalPulse
              start={LIFECYCLE_STAGES[0].coords}
              end={LIFECYCLE_STAGES[1].coords}
              speed={0.9}
              offset={0}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[1].coords}
              end={LIFECYCLE_STAGES[2].coords}
              speed={0.9}
              offset={0.6}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[2].coords}
              end={LIFECYCLE_STAGES[3].coords}
              speed={0.9}
              offset={1.2}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[3].coords}
              end={LIFECYCLE_STAGES[5].coords}
              speed={0.9}
              offset={1.8}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[1].coords}
              end={LIFECYCLE_STAGES[4].coords}
              color="#34d399"
              speed={0.7}
              offset={0.9}
            />
          </>
        )}

        {/* 3D Geometric Nodes */}
        {LIFECYCLE_STAGES.map((st) => (
          <Node3D
            key={st.id}
            stage={st}
            isSelected={selectedStage.id === st.id}
            isHovered={hoveredStageId === st.id}
            onPointerOver={() => setHoveredStageId(st.id)}
            onPointerOut={() => setHoveredStageId(null)}
            onClick={() => onSelectStage(st)}
          />
        ))}
      </Canvas>
    </div>
  );
}

// Accessible 2D Fallback
function StaticFlowchartFallback({
  selectedStage,
  onSelectStage,
}: {
  selectedStage: LifecycleStage;
  onSelectStage: (stage: LifecycleStage) => void;
}) {
  return (
    <div className="w-full p-6 bg-[#08080a] rounded-2xl border border-neutral-800 text-white space-y-4">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <span className="font-mono text-xs font-bold text-cyan-400">
          DATA LIFECYCLE FLOWCHART (2D ARCHITECTURAL SPECIFICATION)
        </span>
        <span className="text-xs text-zinc-400 font-mono">Standard Mode</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {LIFECYCLE_STAGES.map((st) => {
          const isSel = selectedStage.id === st.id;
          const Icon = st.icon;
          return (
            <button
              key={st.id}
              onClick={() => onSelectStage(st)}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1.5 ${
                isSel
                  ? 'bg-[#18181b] border-cyan-400/80 shadow-sm ring-1 ring-cyan-400/30'
                  : 'bg-[#101012] border-neutral-800 hover:border-neutral-700 text-zinc-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold text-cyan-400">{st.stepNum}</span>
                <Icon className="w-4 h-4 text-zinc-400" />
              </div>
              <span className="text-xs font-bold text-white">{st.name}</span>
              <span className="text-[11px] text-zinc-400 font-mono">{st.badge}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ClinicalDataLifecycle3D({
  className = '',
}: {
  className?: string;
}) {
  const [selectedStage, setSelectedStage] = useState<LifecycleStage>(LIFECYCLE_STAGES[0]);
  const [hoveredStageId, setHoveredStageId] = useState<string | null>(null);
  const [webglSupported, setWebglSupported] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [isInView, setIsInView] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      setWebglSupported(Boolean(gl));
    } catch {
      setWebglSupported(false);
    }

    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mq.matches);
      const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const ActiveIcon = selectedStage.icon;

  return (
    <div
      ref={containerRef}
      style={{ backgroundColor: '#070709' }}
      className={`relative w-full rounded-2xl bg-[#070709] border border-neutral-800 text-white overflow-hidden shadow-2xl flex flex-col ${className}`}
    >
      {/* 1. Header Bar: Concise Instrument Title & One Useful Action */}
      <div
        style={{ backgroundColor: '#0a0a0d' }}
        className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 sm:p-5 border-b border-neutral-800/80 gap-3"
      >
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span className="font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-zinc-400">
              MEDVOICE / ARCHITECTURE & BOUNDARIES
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-[#F5F5F5] tracking-tight">
            Clinical Data Lifecycle & Execution Boundaries
          </h3>
        </div>

        {/* Step Through Action Button */}
        <button
          onClick={() => {
            const curIdx = LIFECYCLE_STAGES.findIndex((s) => s.id === selectedStage.id);
            const nextIdx = (curIdx + 1) % LIFECYCLE_STAGES.length;
            setSelectedStage(LIFECYCLE_STAGES[nextIdx]);
          }}
          className="px-3.5 py-1.5 rounded-xl font-mono text-xs text-zinc-300 hover:text-white bg-[#131316] hover:bg-[#1a1a1e] border border-neutral-700/80 transition-all cursor-pointer flex items-center gap-2 shrink-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        >
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span>Step Next Stage ↗</span>
        </button>
      </div>

      {/* 2. Responsive Stage Navigator (Grid layout: Never Clips, Fully Visible) */}
      <div
        style={{ backgroundColor: '#08080a' }}
        className="relative z-10 p-2.5 sm:p-3 border-b border-neutral-800/80"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {LIFECYCLE_STAGES.map((st) => {
            const isSel = selectedStage.id === st.id;
            return (
              <button
                key={st.id}
                onClick={() => setSelectedStage(st)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all cursor-pointer border active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
                  isSel
                    ? 'bg-[#18181b] border-cyan-400/80 text-white shadow-xs ring-1 ring-cyan-400/25'
                    : 'bg-[#101012] border-neutral-800/90 hover:border-neutral-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isSel
                      ? 'bg-cyan-400 shadow-[0_0_8px_#67e8f9]'
                      : st.isDisposal
                      ? 'bg-emerald-500/70'
                      : 'bg-neutral-600'
                  }`}
                />
                <div className="min-w-0 flex flex-col">
                  <span
                    className={`font-mono text-[10px] font-bold tracking-wider leading-none ${
                      isSel ? 'text-cyan-400' : 'text-zinc-500'
                    }`}
                  >
                    {st.stepNum}
                  </span>
                  <span className="text-xs font-semibold truncate leading-tight mt-0.5">
                    {st.shortLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. 3D Visualization Viewport (Clean Near-Black Canvas) */}
      <div
        style={{ backgroundColor: '#060608' }}
        className="relative w-full h-[300px] sm:h-[340px] lg:h-[360px]"
      >
        {webglSupported && isInView ? (
          <LifecycleCanvas
            selectedStage={selectedStage}
            onSelectStage={(st) => setSelectedStage(st)}
            hoveredStageId={hoveredStageId}
            setHoveredStageId={setHoveredStageId}
            reducedMotion={reducedMotion}
          />
        ) : (
          <StaticFlowchartFallback
            selectedStage={selectedStage}
            onSelectStage={(st) => setSelectedStage(st)}
          />
        )}

        {/* Technical Boundary Micro-Label */}
        <div
          style={{ backgroundColor: '#0a0a0d' }}
          className="absolute bottom-2.5 right-3 z-10 font-mono text-[10px] text-zinc-400 px-2.5 py-1 rounded-lg border border-neutral-800 pointer-events-none shadow-xs"
        >
          Select any node or stage to inspect architectural boundary
        </div>
      </div>

      {/* 4. Stage Inspector Detail Layer (Restrained Specification Cards) */}
      <div
        style={{ backgroundColor: '#09090c' }}
        className="relative z-10 p-5 sm:p-6 border-t border-neutral-800 text-white"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedStage.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start w-full"
          >
            {/* Left Column: Stage Identity & Boundary */}
            <div className="w-full lg:col-span-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-cyan-400 bg-[#141417] border border-neutral-700/80 shrink-0">
                  <ActiveIcon className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 block">
                    {selectedStage.badge}
                  </span>
                  <h4 className="text-base sm:text-lg font-bold text-[#F5F5F5] tracking-tight leading-snug">
                    {selectedStage.stepNum} — {selectedStage.name}
                  </h4>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-zinc-300 font-normal leading-relaxed">
                {selectedStage.headline}
              </p>

              <div className="flex items-center gap-2 pt-0.5 font-mono text-xs">
                <span className="text-zinc-500">Execution Boundary:</span>
                <span className="px-2 py-0.5 rounded-lg font-semibold text-xs bg-[#141416] border border-neutral-700/80 text-zinc-200">
                  {selectedStage.boundary}
                </span>
              </div>
            </div>

            {/* Right Column: Specification Cards */}
            <div className="w-full lg:col-span-7 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {/* Retention Lifecycle Card */}
                <div
                  style={{ backgroundColor: '#111114' }}
                  className="p-3.5 sm:p-4 rounded-xl border border-neutral-800 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                      Retention Lifecycle
                    </span>
                  </div>
                  <p className="text-xs sm:text-[13px] text-zinc-200 font-sans leading-relaxed">
                    {selectedStage.retention}
                  </p>
                </div>

                {/* Architectural Boundary Truth Card */}
                <div
                  style={{ backgroundColor: '#111114' }}
                  className="p-3.5 sm:p-4 rounded-xl border border-neutral-800 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">
                      Architectural Boundary
                    </span>
                  </div>
                  <p className="text-xs sm:text-[13px] text-zinc-200 font-sans leading-relaxed">
                    {selectedStage.technicalTruth}
                  </p>
                </div>
              </div>

              {/* Technical Implementation Detail */}
              <div
                style={{ backgroundColor: '#0d0d10' }}
                className="p-3 sm:p-3.5 rounded-xl border border-neutral-800/90"
              >
                <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                  {selectedStage.details}
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default ClinicalDataLifecycle3D;
