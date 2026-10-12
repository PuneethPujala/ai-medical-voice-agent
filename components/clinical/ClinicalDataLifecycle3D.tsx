'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight } from 'lucide-react';

export interface LifecycleStage {
  id: string;
  stepNum: string;
  name: string;
  shortLabel: string;
  category: 'ingest' | 'asr' | 'arbiter' | 'cloud' | 'disposal' | 'audit';
  badge: string;
  boundary: string;
  headline: string;
  processingLocation: string;
  sovereigntyDetail: string;
  retentionDetail: string;
  vendorQualification?: string;
  coords: [number, number, number];
  isDisposal?: boolean;
}

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    id: 'audio_buffer',
    stepNum: '01',
    name: 'Audio Capture & Ingest',
    shortLabel: 'Audio Ingest',
    category: 'ingest',
    badge: 'Client Ingest',
    boundary: 'Volatile RAM Ring-Buffer',
    headline: 'Transient 16kHz PCM audio stream in volatile server RAM',
    processingLocation: 'Browser Client → Local Server Ingest',
    sovereigntyDetail:
      'Spoken audio is captured via standard browser MediaRecorder and transmitted as binary multipart FormData to /api/voice/stt over HTTPS.',
    retentionDetail:
      'Held strictly in volatile RAM buffer during active transcription. Never written to permanent disk storage or relational database.',
    coords: [-3.2, 0.45, 0],
  },
  {
    id: 'local_whisper',
    stepNum: '02',
    name: 'Local Speech Recognition',
    shortLabel: 'Local ASR',
    category: 'asr',
    badge: 'Local Execution',
    boundary: 'Local FastAPI Whisper base.en',
    headline: 'Neural speech-to-text decoding executes locally on server',
    processingLocation: 'Local Container (FastAPI Whisper base.en, 74M params)',
    sovereigntyDetail:
      'Spoken waveforms are converted to text locally on the server without streaming voice audio to third-party cloud speech services.',
    retentionDetail:
      'Ephemeral processing pass. Audio file is unlinked immediately in audio_service.py within a finally: os.remove() block.',
    coords: [-1.6, 0.45, 0],
  },
  {
    id: 'clinical_context',
    stepNum: '03',
    name: 'Clinical State & Safety Arbiter',
    shortLabel: 'Safety Arbiter',
    category: 'arbiter',
    badge: 'Local State Machine',
    boundary: 'Deterministic Rules Engine',
    headline: 'Deterministic symptom parsing & emergency acuity screening',
    processingLocation: 'Local Rule-Based Arbiter Engine',
    sovereigntyDetail:
      'Transcript text is evaluated against deterministic clinical safety rules for ACS, stroke, and pediatric vitals. Emergency states cannot be downgraded.',
    retentionDetail:
      'Encounter state is maintained in active session memory and committed to the consultation ledger upon turn completion.',
    coords: [0.0, 0.45, 0],
  },
  {
    id: 'cloud_inference',
    stepNum: '04',
    name: 'Clinical Reasoning (LLM)',
    shortLabel: 'Cloud LLM',
    category: 'cloud',
    badge: 'Cloud Boundary',
    boundary: 'Groq / NVIDIA NIM Cloud API',
    headline: 'Doctor dialogue synthesized via cloud LLM API',
    processingLocation: 'Cloud Inference Boundary (Groq LLaMA-3.3 / NVIDIA NIM)',
    sovereigntyDetail:
      'De-identified clinical state and multi-turn dialogue context are submitted to cloud LLM APIs. Voice audio NEVER leaves local infrastructure—only structured text is transmitted.',
    retentionDetail:
      'Ephemeral API request. Model prompt context is discarded post-inference.',
    vendorQualification:
      'Pilot Notice: Enterprise zero-retention contracts and dedicated BAA agreements remain under active pilot legal review.',
    coords: [1.6, 0.45, 0],
  },
  {
    id: 'audio_disposal',
    stepNum: '05A',
    name: 'Raw Audio Disposal',
    shortLabel: 'Audio Purge',
    category: 'disposal',
    badge: 'Memory Purge',
    boundary: 'Python finally: os.remove()',
    headline: 'Temporary audio buffers zeroized and unlinked post-ASR',
    processingLocation: 'Local Server File System',
    sovereigntyDetail:
      'Immediately after local Whisper returns text tokens, the temporary audio file is unlinked via os.remove() in audio_service.py.',
    retentionDetail:
      'ZERO persistent voice retention. No audio waveforms remain on server disk or database after call turn.',
    coords: [-1.6, -1.05, 0],
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
    headline: 'Tamper-evident SHA-256 hash-chained compliance ledger',
    processingLocation: 'PostgreSQL Database',
    sovereigntyDetail:
      'Clinical events, triage levels, and dispatch actions generate SHA-256 cryptographically chained entries linking to previousHash for audit integrity.',
    retentionDetail:
      'Stores cryptographic verification hashes, caller roles, and event timestamps. Does NOT store raw clinical audio.',
    coords: [3.2, 0.45, 0],
  },
];

// Precision Connecting Bus
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
    const points = curve.getPoints(36);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: dashed ? new THREE.Color('#3f3f46') : new THREE.Color('#27272a'),
      transparent: true,
      opacity: dashed ? 0.45 : 0.8,
      linewidth: 1,
    });
    return new THREE.Line(geo, mat);
  }, [start, end, dashed]);

  return <primitive object={lineObj} />;
}

// Directional Signal Pulses
function SignalPulse({
  start,
  end,
  color = '#67E8F9',
  speed = 0.85,
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
    const p1 = new THREE.Vector3(midX, p0.y, 0.04);
    const p2 = new THREE.Vector3(midX, p3.y, 0.04);
    return new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  }, [p0, p3]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const elapsed = clock.getElapsedTime() * speed + offset;
    const t = (elapsed % 2.2) / 2.2;
    const pt = curve.getPoint(t);
    meshRef.current.position.copy(pt);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.048, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} />
    </mesh>
  );
}

// Commanding Precision Node (Enlarged, Architectural, Focal Point)
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
      const targetScale = isSelected ? 1.08 : isHovered ? 1.04 : 1.0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
    }
    if (haloRef.current && isSelected) {
      const pulse = 1 + Math.sin(clock.getElapsedTime() * 2.5) * 0.03;
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
      {/* 1. Active Focus Halo (Delicate Outer Reticle) */}
      {isSelected && (
        <mesh ref={haloRef} position={[0, 0, 0.01]}>
          <ringGeometry args={[0.46, 0.478, 48]} />
          <meshBasicMaterial color={activeColor} transparent opacity={0.8} />
        </mesh>
      )}

      {/* 2. Precision Metallic Bezel Ring */}
      <mesh position={[0, 0, 0.02]}>
        <ringGeometry args={[0.36, 0.385, 48]} />
        <meshBasicMaterial
          color={isSelected ? activeColor : isHovered ? '#71717a' : '#27272a'}
          transparent
          opacity={isSelected ? 0.95 : 0.45}
        />
      </mesh>

      {/* 3. Dark Ceramic Face Disc */}
      <mesh position={[0, 0, 0.03]}>
        <circleGeometry args={[0.35, 40]} />
        <meshStandardMaterial
          color="#0b0b0e"
          roughness={0.35}
          metalness={0.8}
        />
      </mesh>

      {/* 4. Center Optic Core (Cyan when Selected, Graphite when Inactive) */}
      <mesh position={[0, 0, 0.06]}>
        <sphereGeometry args={[isSelected ? 0.13 : 0.08, 24, 24]} />
        <meshStandardMaterial
          color={isSelected ? activeColor : isHovered ? '#a1a1aa' : isDisposal ? '#10b981' : '#3f3f46'}
          emissive={isSelected ? activeColor : isHovered ? '#52525b' : isDisposal ? '#064e3b' : '#18181b'}
          emissiveIntensity={isSelected ? 1.6 : isDisposal ? 0.4 : 0.2}
          roughness={0.2}
          metalness={0.3}
        />
      </mesh>

      {/* 5. Center Laser Highlight Pin on Active Node */}
      {isSelected && (
        <mesh position={[0, 0, 0.14]}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
    </group>
  );
}

// Parallax Scene Controller with Dynamic Aspect Ratio Scaling
function SceneController({ reducedMotion }: { reducedMotion: boolean }) {
  const { camera, size } = useThree();
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
    const aspect = size.width / Math.max(size.height, 1);
    // Smooth camera Z adaptation:
    // Wide desktop aspect (~2.4) -> baseZ is 4.4
    // Narrow mobile aspect (~1.0) -> baseZ smoothly scales to ~7.6 so all nodes fit
    const baseZ = aspect < 1.8 ? Math.min(8.2, 4.4 * (1.85 / Math.max(aspect, 0.75))) : 4.4;

    if (reducedMotion) {
      camera.position.set(0, -0.1, baseZ);
      camera.lookAt(0, -0.1, 0);
      return;
    }
    const targetX = mouseRef.current.x * 0.18;
    const targetY = mouseRef.current.y * 0.1 - 0.1;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.05);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.05);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, baseZ, 0.05);
    camera.lookAt(0, -0.1, 0);
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
        camera={{ position: [0, -0.1, 4.4], fov: 44 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[2, 4, 3]} intensity={1.2} color="#ffffff" />
        <directionalLight position={[-3, -2, -1]} intensity={0.3} color="#94a3b8" />
        <pointLight position={[0, 0, 3.5]} intensity={0.4} color="#67e8f9" distance={8} />

        <SceneController reducedMotion={reducedMotion} />

        {/* Linear Connecting Buses (01 -> 02 -> 03 -> 04 -> 05B) */}
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

        {/* Signal Pulses Along Paths */}
        {!reducedMotion && (
          <>
            <SignalPulse
              start={LIFECYCLE_STAGES[0].coords}
              end={LIFECYCLE_STAGES[1].coords}
              speed={0.85}
              offset={0}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[1].coords}
              end={LIFECYCLE_STAGES[2].coords}
              speed={0.85}
              offset={0.55}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[2].coords}
              end={LIFECYCLE_STAGES[3].coords}
              speed={0.85}
              offset={1.1}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[3].coords}
              end={LIFECYCLE_STAGES[5].coords}
              speed={0.85}
              offset={1.65}
            />
            <SignalPulse
              start={LIFECYCLE_STAGES[1].coords}
              end={LIFECYCLE_STAGES[4].coords}
              color="#34d399"
              speed={0.7}
              offset={0.85}
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

// 2D Accessible Fallback
function StaticFlowchartFallback({
  selectedStage,
  onSelectStage,
}: {
  selectedStage: LifecycleStage;
  onSelectStage: (stage: LifecycleStage) => void;
}) {
  return (
    <div className="w-full p-8 bg-[#080808] text-white space-y-4">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <span className="font-mono text-xs font-semibold text-cyan-400">
          DATA LIFECYCLE SPECIFICATION (2D ACCESSIBLE VIEW)
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {LIFECYCLE_STAGES.map((st) => {
          const isSel = selectedStage.id === st.id;
          return (
            <button
              key={st.id}
              onClick={() => onSelectStage(st)}
              className={`p-4 rounded-xl text-left transition-all cursor-pointer flex flex-col gap-1.5 ${
                isSel
                  ? 'bg-neutral-900 border border-cyan-400/80'
                  : 'bg-neutral-950/60 border border-neutral-800/80 text-zinc-300'
              }`}
            >
              <span className="font-mono text-xs font-bold text-cyan-400">{st.stepNum}</span>
              <span className="text-sm font-bold text-white">{st.name}</span>
              <span className="text-xs text-zinc-400 font-mono">{st.badge}</span>
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

  const handleNextStage = () => {
    const curIdx = LIFECYCLE_STAGES.findIndex((s) => s.id === selectedStage.id);
    const nextIdx = (curIdx + 1) % LIFECYCLE_STAGES.length;
    setSelectedStage(LIFECYCLE_STAGES[nextIdx]);
  };

  return (
    <div
      ref={containerRef}
      style={{ backgroundColor: '#080808' }}
      className={`relative w-full rounded-2xl sm:rounded-3xl bg-[#080808] border border-neutral-800/80 text-white overflow-hidden shadow-2xl flex flex-col ${className}`}
    >
      {/* 1. Integrated Minimalist Header & Borderless Apple-Style Stage Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 sm:px-8 pt-6 pb-3 border-b border-neutral-800/60 gap-4">
        <div>
          <span className="font-mono text-[11px] font-bold tracking-widest text-zinc-500 uppercase block">
            01 — 06 ARCHITECTURE
          </span>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Clinical Data Lifecycle
          </h2>
        </div>

        {/* Borderless Stage Tabs with Gliding Cyan Underline */}
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
          {LIFECYCLE_STAGES.map((st) => {
            const isSel = selectedStage.id === st.id;
            return (
              <button
                key={st.id}
                onClick={() => setSelectedStage(st)}
                className={`group relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer shrink-0 focus-visible:outline-none ${
                  isSel
                    ? 'text-white font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span
                  className={`font-mono text-[10px] sm:text-[11px] font-bold ${
                    isSel ? 'text-cyan-400' : 'text-zinc-500 group-hover:text-zinc-400'
                  }`}
                >
                  {st.stepNum}
                </span>
                <span>{st.shortLabel}</span>
                {isSel && (
                  <motion.div
                    layoutId="active-stage-indicator"
                    className="absolute -bottom-1 left-2 right-2 h-[2px] bg-cyan-400 shadow-[0_0_8px_#67e8f9]"
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  />
                )}
              </button>
            );
          })}

          <button
            onClick={handleNextStage}
            className="hidden lg:flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-cyan-400 transition-colors cursor-pointer pl-3 shrink-0"
          >
            <span>Next</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Primary 3D Visualization Viewport (Commanding Focal Point) */}
      <div
        style={{ backgroundColor: '#080808' }}
        className="relative w-full h-[360px] sm:h-[400px] lg:h-[440px]"
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

        {/* Visual Stream Bus Indicator Overlays */}
        <div className="absolute bottom-3 left-6 right-6 flex items-center justify-between font-mono text-[10px] text-zinc-500 pointer-events-none">
          <span>PIPELINE: 16kHz PCM → NEURAL ASR → ARBITER INVARIANTS → CLOUD LLM → LEDGER</span>
          <span className="hidden sm:inline">SELECT ANY NODE TO INSPECT ARCHITECTURAL BOUNDARY</span>
        </div>
      </div>

      {/* 3. Spacious Editorial Details Section (No Box-in-a-Box Clutter) */}
      <div className="p-6 sm:p-8 lg:p-10 border-t border-neutral-800/60 bg-[#0a0a0c]">
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedStage.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* Stage Title and Summary */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-mono text-xs text-cyan-400 font-semibold tracking-wider">
                <span>{selectedStage.stepNum}</span>
                <span>—</span>
                <span className="uppercase">{selectedStage.badge}</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {selectedStage.name}
              </h3>
              <p className="text-base sm:text-lg text-zinc-300 max-w-3xl leading-relaxed">
                {selectedStage.headline}
              </p>
            </div>

            {/* Two Clean Editorial Specification Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-10 pt-4 border-t border-neutral-800/60">
              <div className="space-y-2">
                <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                  Processing Sovereignty
                </span>
                <p className="text-sm text-zinc-200 leading-relaxed font-normal">
                  {selectedStage.sovereigntyDetail}
                </p>
                <div className="pt-1">
                  <span className="inline-block font-mono text-[11px] text-zinc-400 bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-md">
                    Execution Boundary: {selectedStage.boundary}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                  Data Retention & Memory Lifecycle
                </span>
                <p className="text-sm text-zinc-200 leading-relaxed font-normal">
                  {selectedStage.retentionDetail}
                </p>
              </div>
            </div>

            {/* Qualified Vendor Pilot Disclaimer (Truthful, Zero-Hype) */}
            {selectedStage.vendorQualification && (
              <div className="pt-2">
                <div className="p-3.5 rounded-xl bg-neutral-900/90 border border-neutral-800 text-xs text-amber-200/90 font-mono leading-relaxed flex items-start gap-2.5">
                  <span className="text-amber-400 font-bold shrink-0">ⓘ</span>
                  <span>{selectedStage.vendorQualification}</span>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default ClinicalDataLifecycle3D;
