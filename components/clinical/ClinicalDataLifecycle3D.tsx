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
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  Database,
  Lock,
  Terminal,
  Activity,
  Sparkles,
} from 'lucide-react';

export interface LifecycleStage {
  id: string;
  name: string;
  shortName: string;
  category: 'ingest' | 'asr' | 'arbiter' | 'cloud' | 'disposal' | 'audit';
  badge: string;
  boundary: string;
  headline: string;
  details: string;
  retention: string;
  technicalTruth: string;
  color: string;
  coords: [number, number, number];
  icon: React.ComponentType<{ className?: string }>;
}

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    id: 'audio_buffer',
    name: '1. Audio Capture & Ingest',
    shortName: '1. Ingest Buffer',
    category: 'ingest',
    badge: 'Client → Server Ingest',
    boundary: 'Volatile RAM Ring-Buffer',
    headline: 'MediaRecorder 16kHz PCM audio stream in volatile server memory',
    details: 'Spoken patient audio is captured in the browser via standard MediaRecorder and streamed as binary multipart FormData to /api/voice/stt.',
    retention: 'Held in volatile server RAM buffer strictly during active transcription.',
    technicalTruth: 'Raw audio is never written to permanent disk storage or relational database.',
    color: '#06b6d4',
    coords: [-3.1, 0.45, 0],
    icon: Mic,
  },
  {
    id: 'local_whisper',
    name: '2. Local Speech ASR',
    shortName: '2. Local Whisper',
    category: 'asr',
    badge: 'Local Execution (CPU/GPU)',
    boundary: 'Local FastAPI Whisper base.en',
    headline: 'Neural speech-to-text decoding executes locally on server',
    details: 'The audio buffer is processed by local OpenAI Whisper (base.en, 74M parameters) running inside the local FastAPI container to produce a text transcript.',
    retention: 'Ephemeral processing pass. Audio unlinked immediately upon completion.',
    technicalTruth: 'Local ASR ensures spoken waveforms are converted to text without cloud audio streaming.',
    color: '#0d9488',
    coords: [-1.55, 0.45, 0],
    icon: Cpu,
  },
  {
    id: 'clinical_context',
    name: '3. Clinical State & Arbiter',
    shortName: '3. Safety Arbiter',
    category: 'arbiter',
    badge: 'Local State Machine',
    boundary: 'Deterministic Rules Engine',
    headline: 'Deterministic symptom parsing & ESI urgency classification',
    details: 'Transcript text is analyzed by a deterministic rule-based safety arbiter, checking universal red flags across ACS, stroke, and pediatric vitals with strict non-downgrade invariants.',
    retention: 'State maintained in encounter session memory; committed to consultation record upon finish.',
    technicalTruth: '100% deterministic rules engine runs locally before any generative model tokens.',
    color: '#3b82f6',
    coords: [0.0, 0.45, 0],
    icon: Layers,
  },
  {
    id: 'cloud_inference',
    name: '4. Clinical Reasoning (LLM)',
    shortName: '4. Cloud LLM',
    category: 'cloud',
    badge: 'Cloud Inference Boundary',
    boundary: 'Groq / NVIDIA NIM Cloud API',
    headline: 'Contextual doctor dialogue synthesized via cloud LLM API',
    details: 'De-identified clinical state and multi-turn dialogue context are submitted to Cloud LLM APIs (Groq LLaMA-3.3 / NVIDIA NIM) to generate bedside doctor guidance.',
    retention: 'Zero-data-retention API contracts; clinical prompt discarded post-generation.',
    technicalTruth: 'Cloud Inference Boundary: Clinical text context is sent to cloud LLM API. Only text is sent—raw audio never leaves local infrastructure.',
    color: '#a855f7',
    coords: [1.55, 0.45, 0],
    icon: Cloud,
  },
  {
    id: 'audio_disposal',
    name: '5A. Raw Audio Disposal',
    shortName: '5A. Audio Purge',
    category: 'disposal',
    badge: 'Memory Lifecycle Purge',
    boundary: 'Python finally: block',
    headline: 'Temporary audio buffers unlinked and purged post-transcription',
    details: 'Immediately after Whisper returns the transcript text, the temporary audio file is deleted inside audio_service.py in an explicit finally: os.remove() block.',
    retention: 'ZERO persistent voice retention on server disk or database.',
    technicalTruth: 'Confirmed by codebase: audio_service.py unlinks temp files; no voice recordings are persisted.',
    color: '#10b981',
    coords: [-1.55, -1.25, 0],
    icon: Trash2,
  },
  {
    id: 'audit_ledger',
    name: '5B. Chained Audit Ledger',
    shortName: '5B. Audit Ledger',
    category: 'audit',
    badge: 'PostgreSQL Ledger',
    boundary: 'SHA-256 Chained Hash Digest',
    headline: 'Cryptographic hash-chained audit ledger tracks consultation events',
    details: 'Each consultation creation, clinical decision, and emergency dispatch creates a tamper-evident SHA-256 chained entry linking to previousHash in PostgreSQL.',
    retention: 'Durable immutable ledger entries for regulatory compliance.',
    technicalTruth: 'Audit metadata contains cryptographic verification hashes, timestamps, and caller role. Does NOT store raw clinical audio.',
    color: '#f59e0b',
    coords: [3.1, 0.45, 0],
    icon: Database,
  },
];

// Helper to draw connecting 3D Bezier curve tubes
function DataBusPath({
  start,
  end,
  color,
  dashed = false,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  dashed?: boolean;
}) {
  const lineObj = useMemo(() => {
    const p0 = new THREE.Vector3(...start);
    const p3 = new THREE.Vector3(...end);
    const midX = (p0.x + p3.x) / 2;
    const p1 = new THREE.Vector3(midX, p0.y, 0.05);
    const p2 = new THREE.Vector3(midX, p3.y, 0.05);
    const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
    const points = curve.getPoints(40);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: dashed ? 0.35 : 0.65,
      linewidth: 1,
    });
    return new THREE.Line(geo, mat);
  }, [start, end, color, dashed]);

  return <primitive object={lineObj} />;
}

// 3D Pulse Packet travelling along a curve resembling clinical optical telemetry
function SignalPulse({
  start,
  end,
  color,
  speed = 1,
  offset = 0,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  speed?: number;
  offset?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const p0 = useMemo(() => new THREE.Vector3(...start), [start]);
  const p3 = useMemo(() => new THREE.Vector3(...end), [end]);
  const curve = useMemo(() => {
    const midX = (p0.x + p3.x) / 2;
    const p1 = new THREE.Vector3(midX, p0.y, 0.05);
    const p2 = new THREE.Vector3(midX, p3.y, 0.05);
    return new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  }, [p0, p3]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const elapsed = clock.getElapsedTime() * speed + offset;
    const t = (elapsed % 2.5) / 2.5;
    const pt = curve.getPoint(t);
    meshRef.current.position.copy(pt);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.045, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  );
}

// Precision Clinical Instrument Node Mesh
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
  const gimbalRef = useRef<THREE.Mesh>(null);
  const reticleRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (gimbalRef.current) {
      gimbalRef.current.rotation.z += delta * (isSelected ? 1.2 : 0.4);
    }
    if (reticleRef.current) {
      reticleRef.current.rotation.z -= delta * (isSelected ? 0.8 : 0.25);
    }
    if (groupRef.current) {
      const targetScale = isSelected ? 1.15 : isHovered ? 1.08 : 1.0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
    }
  });

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
      {/* 1. Outer Gimbal Precision Orbit Ring */}
      <mesh ref={gimbalRef}>
        <torusGeometry args={[0.38, 0.007, 12, 48]} />
        <meshBasicMaterial
          color={stage.color}
          transparent
          opacity={isSelected ? 0.9 : isHovered ? 0.6 : 0.3}
        />
      </mesh>

      {/* 2. Secondary Segmented Gauge Ring */}
      <mesh ref={reticleRef}>
        <ringGeometry args={[0.31, 0.325, 36]} />
        <meshBasicMaterial
          color={stage.color}
          transparent
          opacity={isSelected ? 0.8 : 0.35}
        />
      </mesh>

      {/* 3. Luminous Optic Sensor Face (Precision Glass/Optic Look) */}
      <mesh position={[0, 0, 0.02]}>
        <circleGeometry args={[0.26, 32]} />
        <meshStandardMaterial
          color="#0c1626"
          emissive={stage.color}
          emissiveIntensity={isSelected ? 0.5 : isHovered ? 0.3 : 0.15}
          roughness={0.2}
          metalness={0.3}
        />
      </mesh>

      {/* 4. Glowing Stage Optic Core */}
      <mesh position={[0, 0, 0.06]}>
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshStandardMaterial
          color={stage.color}
          emissive={stage.color}
          emissiveIntensity={isSelected ? 1.6 : isHovered ? 1.1 : 0.7}
          roughness={0.2}
          metalness={0.1}
        />
      </mesh>

      {/* 5. Center Laser Photon Bead (Brilliant White Core) */}
      <mesh position={[0, 0, 0.12]}>
        <sphereGeometry args={[0.042, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

// Scene controller with soft mouse parallax and focus easing
function SceneController({
  reducedMotion,
}: {
  reducedMotion: boolean;
}) {
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
      camera.position.set(0, -0.2, 5.2);
      camera.lookAt(0, -0.2, 0);
      return;
    }
    const targetX = mouseRef.current.x * 0.25;
    const targetY = mouseRef.current.y * 0.18 - 0.2;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.05);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.05);
    camera.lookAt(0, -0.2, 0);
  });

  return null;
}

// Main 3D Canvas Scene
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
        camera={{ position: [0, -0.2, 5.2], fov: 44 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        {/* Soft, clinical precision illumination */}
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 5, 4]} intensity={1.0} color="#f0f9ff" />
        <directionalLight position={[-3, -3, -2]} intensity={0.4} color="#0891b2" />
        <pointLight position={[0, 0, 3]} intensity={0.8} color="#e0f2fe" distance={10} />

        <SceneController reducedMotion={reducedMotion} />

        {/* Main Stream Connecting Data Buses */}
        <DataBusPath
          start={LIFECYCLE_STAGES[0].coords}
          end={LIFECYCLE_STAGES[1].coords}
          color="#06b6d4"
        />
        <DataBusPath
          start={LIFECYCLE_STAGES[1].coords}
          end={LIFECYCLE_STAGES[2].coords}
          color="#0d9488"
        />
        <DataBusPath
          start={LIFECYCLE_STAGES[2].coords}
          end={LIFECYCLE_STAGES[3].coords}
          color="#3b82f6"
        />
        <DataBusPath
          start={LIFECYCLE_STAGES[3].coords}
          end={LIFECYCLE_STAGES[5].coords}
          color="#a855f7"
        />

        {/* Downward Branch: Ephemeral Audio Buffer Disposal */}
        <DataBusPath
          start={LIFECYCLE_STAGES[1].coords}
          end={LIFECYCLE_STAGES[4].coords}
          color="#10b981"
          dashed
        />

        {/* Subtle Optical Signal Pulses */}
        {!reducedMotion && (
          <>
            <SignalPulse
              start={LIFECYCLE_STAGES[0].coords}
              end={LIFECYCLE_STAGES[1].coords}
              color="#06b6d4"
              speed={1.0}
              offset={0}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[1].coords}
              end={LIFECYCLE_STAGES[2].coords}
              color="#0d9488"
              speed={1.0}
              offset={0.6}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[2].coords}
              end={LIFECYCLE_STAGES[3].coords}
              color="#3b82f6"
              speed={1.0}
              offset={1.2}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[3].coords}
              end={LIFECYCLE_STAGES[5].coords}
              color="#a855f7"
              speed={1.0}
              offset={1.8}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[1].coords}
              end={LIFECYCLE_STAGES[4].coords}
              color="#10b981"
              speed={0.8}
              offset={0.9}
            />
          </>
        )}

        {/* 3D Precision Instrument Nodes */}
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

// Accessible 2D Static Fallback if WebGL fails or reduced motion
function StaticFlowchartFallback({
  selectedStage,
  onSelectStage,
}: {
  selectedStage: LifecycleStage;
  onSelectStage: (stage: LifecycleStage) => void;
}) {
  return (
    <div className="w-full p-6 bg-slate-900/90 rounded-2xl border border-slate-800 text-white space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <span className="font-mono text-xs font-bold text-cyan-400">
          DATA LIFECYCLE FLOWCHART (ACCESSIBLE 2D SPECIFICATION)
        </span>
        <span className="text-xs text-slate-400 font-mono">Standard Specification</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {LIFECYCLE_STAGES.map((st) => {
          const isSel = selectedStage.id === st.id;
          const Icon = st.icon;
          return (
            <button
              key={st.id}
              onClick={() => onSelectStage(st)}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-2 ${
                isSel
                  ? 'bg-slate-800 border-cyan-400 shadow-md ring-1 ring-cyan-400/50'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <Icon className="w-4 h-4 text-cyan-400" />
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: st.color }} />
              </div>
              <span className="text-xs font-bold text-white">{st.name}</span>
              <span className="text-[11px] text-slate-400 font-mono">{st.badge}</span>
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
  compact?: boolean;
}) {
  const [selectedStage, setSelectedStage] = useState<LifecycleStage>(LIFECYCLE_STAGES[0]);
  const [hoveredStageId, setHoveredStageId] = useState<string | null>(null);
  const [webglSupported, setWebglSupported] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [isInView, setIsInView] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check WebGL support and reduced motion
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

  // Pause rendering when offscreen
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
      style={{ backgroundColor: '#090D1A' }}
      className={`relative w-full rounded-3xl bg-slate-950 border border-slate-800 text-white overflow-hidden shadow-2xl flex flex-col ${className}`}
    >
      {/* Visual Ambient Atmosphere */}
      <div className="absolute top-0 right-1/4 w-96 h-64 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-96 h-64 bg-violet-600/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Header HUD Bar */}
      <div
        style={{ backgroundColor: '#0B1120' }}
        className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 sm:p-6 border-b border-slate-800/80 gap-3"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-cyan-400">
              CLINICAL DATA LIFECYCLE · 3D INSTRUMENT
            </span>
          </div>
          <h3 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
            Transient Audio Buffer, Local ASR & Cloud Reasoning Architecture
          </h3>
        </div>

        {/* Boundary status badge */}
        <div
          style={{ backgroundColor: '#070C18' }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700/80 font-mono text-xs text-slate-300 shrink-0"
        >
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span>Interactive 3D Stage Inspector</span>
        </div>
      </div>

      {/* Stage Selector HUD Strip (Clean, Professional Tabs) */}
      <div
        style={{ backgroundColor: '#070C18' }}
        className="relative z-10 px-4 sm:px-6 py-3 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto no-scrollbar"
      >
        <span className="text-[11px] font-mono text-slate-400 uppercase font-semibold shrink-0 mr-1 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span>Stages:</span>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {LIFECYCLE_STAGES.map((st) => {
            const isSel = selectedStage.id === st.id;
            return (
              <button
                key={st.id}
                onClick={() => setSelectedStage(st)}
                style={isSel ? { backgroundColor: '#1E293B', borderColor: '#22D3EE' } : { backgroundColor: '#0F172A', borderColor: '#334155' }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-mono text-xs font-semibold transition-all cursor-pointer border active:scale-[0.98] ${
                  isSel
                    ? 'text-white shadow-[0_0_12px_rgba(6,182,212,0.35)] font-bold'
                    : 'text-slate-300 hover:text-white hover:border-slate-500'
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: st.color }} />
                <span>{st.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3D Scene Viewport */}
      <div
        style={{ backgroundColor: '#090D1A' }}
        className="relative w-full h-[360px] sm:h-[420px] lg:h-[460px]"
      >
        {/* 3D Canvas or Fallback */}
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

        {/* Technical boundary indicator */}
        <div
          style={{ backgroundColor: '#070C18' }}
          className="absolute bottom-3 right-4 z-10 font-mono text-[10px] text-slate-300 px-3 py-1.5 rounded-lg border border-slate-800 pointer-events-none shadow-md"
        >
          Click 3D nodes or tabs above to inspect security boundaries
        </div>
      </div>

      {/* Synchronized Stage Inspector Card (Robust Responsive Layout - Never Collapses) */}
      <div
        style={{ backgroundColor: '#070B16' }}
        className="relative z-10 p-5 sm:p-7 border-t border-slate-800 text-white"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedStage.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full"
          >
            {/* Left: Stage Title, Category Badge & Headline */}
            <div className="w-full lg:col-span-5 space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-md ring-1 ring-white/10"
                  style={{ backgroundColor: selectedStage.color }}
                >
                  <ActiveIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400 block">
                    {selectedStage.badge}
                  </span>
                  <h4 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-snug">
                    {selectedStage.name}
                  </h4>
                </div>
              </div>

              <p className="text-sm text-slate-200 font-medium leading-relaxed">
                {selectedStage.headline}
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
                <span className="text-slate-400">Execution Boundary:</span>
                <span
                  className="px-2.5 py-1 rounded-lg font-bold text-white border text-xs"
                  style={{
                    backgroundColor: `${selectedStage.color}25`,
                    borderColor: `${selectedStage.color}60`,
                    color: selectedStage.color,
                  }}
                >
                  {selectedStage.boundary}
                </span>
              </div>
            </div>

            {/* Right: Technical Reality & Retention Policy Cards (Guaranteed min-w-[260px], Never Narrow Pills) */}
            <div className="w-full lg:col-span-7 space-y-4">
              {/* Responsive Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                {/* Retention State Card */}
                <div
                  style={{ backgroundColor: '#0F172A' }}
                  className="w-full min-w-[260px] p-4 sm:p-5 rounded-2xl border border-slate-700/80 space-y-2 shadow-inner"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs uppercase font-bold text-slate-300 tracking-wider">
                      Retention Lifecycle
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-100 font-sans font-medium leading-relaxed break-words whitespace-normal">
                    {selectedStage.retention}
                  </p>
                </div>

                {/* Technical Reality Truth Card */}
                <div
                  style={{ backgroundColor: '#0F172A' }}
                  className="w-full min-w-[260px] p-4 sm:p-5 rounded-2xl border border-slate-700/80 space-y-2 shadow-inner"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="text-xs uppercase font-bold text-cyan-400 tracking-wider">
                      Verified Architectural Boundary
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-100 font-sans font-medium leading-relaxed break-words whitespace-normal">
                    {selectedStage.technicalTruth}
                  </p>
                </div>
              </div>

              {/* Detailed Technical Explanation */}
              <div
                style={{ backgroundColor: '#0B1324' }}
                className="p-4 rounded-xl border border-slate-800"
              >
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
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
