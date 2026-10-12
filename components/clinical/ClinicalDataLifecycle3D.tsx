'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  ShieldCheck,
  Cpu,
  Layers,
  Cloud,
  Trash2,
  Database,
  Mic,
  Lock,
  Clock,
  ChevronRight,
  Info,
} from 'lucide-react';

export interface LifecycleStage {
  id: string;
  stepNum: string;
  name: string;
  shortLabel: string;
  headline: string;
  category: 'ingest' | 'asr' | 'arbiter' | 'cloud' | 'disposal' | 'audit';
  badge: string;
  boundary: string;
  processingLocation: string;
  dataIn: string;
  dataOut: string;
  voiceIsolationDetail: string;
  retentionDetail: string;
  vendorNotice?: string;
  coords: [number, number, number];
  isDisposal?: boolean;
}

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    id: 'audio_buffer',
    stepNum: '01',
    name: 'Audio Capture & Ingest',
    shortLabel: '01 Ingest',
    headline: 'Transient 16kHz PCM audio stream in volatile server RAM buffer',
    category: 'ingest',
    badge: 'CLIENT INGEST',
    boundary: 'Volatile RAM Ring-Buffer',
    processingLocation: 'Browser Client → Local Ingest API',
    dataIn: 'Microphone acoustic waveform (16kHz PCM chunks)',
    dataOut: 'In-memory multipart FormData stream',
    voiceIsolationDetail:
      'Captured via standard MediaRecorder and streamed to /api/voice/stt over HTTPS. Audio is held strictly in volatile server RAM during transcription.',
    retentionDetail:
      'Ephemeral RAM allocation. Never committed to permanent server disk storage or relational database.',
    coords: [-2.25, 0.55, 0],
  },
  {
    id: 'local_whisper',
    stepNum: '02',
    name: 'Local Speech Recognition',
    shortLabel: '02 Local ASR',
    headline: 'Neural speech-to-text decoding executes locally on server container',
    category: 'asr',
    badge: 'LOCAL EXECUTION',
    boundary: 'FastAPI Whisper base.en',
    processingLocation: 'Local Server Container (74M-Param Neural Network)',
    dataIn: '16kHz temporary audio buffer',
    dataOut: 'Raw transcript text tokens',
    voiceIsolationDetail:
      'Speech decoding executes 100% locally on the FastAPI container. Voice waveforms are converted to text without streaming audio to external cloud providers.',
    retentionDetail:
      'Temporary audio files are unlinked immediately inside audio_service.py in an explicit finally: os.remove() block.',
    coords: [-0.75, 0.55, 0],
  },
  {
    id: 'clinical_context',
    stepNum: '03',
    name: 'Clinical State & Safety Arbiter',
    shortLabel: '03 Arbiter',
    headline: 'Deterministic symptom parsing & emergency acuity screening',
    category: 'arbiter',
    badge: 'LOCAL STATE MACHINE',
    boundary: 'Deterministic Rules Engine',
    processingLocation: 'Local Server (Deterministic Arbiter Engine)',
    dataIn: 'Raw transcript text tokens & prior session state',
    dataOut: 'Structured clinical slots & deterministic ESI priority',
    voiceIsolationDetail:
      'Evaluates strict deterministic safety invariants for ACS, stroke, airway compromise, and pediatric vitals. Emergency acuity states cannot be downgraded.',
    retentionDetail:
      'Encounter state is held in active memory during dialogue and committed to the consultation ledger upon session completion.',
    coords: [0.75, 0.55, 0],
  },
  {
    id: 'cloud_inference',
    stepNum: '04',
    name: 'Clinical Reasoning (LLM)',
    shortLabel: '04 Cloud LLM',
    headline: 'Contextual doctor dialogue synthesized via cloud LLM API',
    category: 'cloud',
    badge: 'CLOUD INFERENCE',
    boundary: 'Groq / NVIDIA NIM Cloud API',
    processingLocation: 'Cloud Model Inference (LLaMA-3.3-70B)',
    dataIn: 'De-identified clinical context prompt & conversation history',
    dataOut: 'Doctor bedside guidance text tokens',
    voiceIsolationDetail:
      'STRICT BOUNDARY: Only structured text prompt is submitted to cloud LLM APIs. Spoken patient voice audio NEVER leaves local server infrastructure.',
    retentionDetail:
      'Ephemeral API request. Clinical prompt context is discarded post-inference.',
    vendorNotice:
      'Pilot Notice: Enterprise zero-retention contracts and dedicated BAA agreements remain under active pilot legal review.',
    coords: [2.25, 0.55, 0],
  },
  {
    id: 'audio_disposal',
    stepNum: '05A',
    name: 'Raw Audio Disposal',
    shortLabel: '05A Purge',
    headline: 'Temporary audio buffers zeroized and unlinked post-ASR',
    category: 'disposal',
    badge: 'MEMORY PURGE',
    boundary: 'Python finally: os.remove()',
    processingLocation: 'Local Server File System',
    dataIn: 'Temporary audio file path on server',
    dataOut: 'Unlinked file descriptor & zeroized memory',
    voiceIsolationDetail:
      'Codebase verification: audio_service.py executes explicit os.remove() in a finally block immediately after the local Whisper pass concludes.',
    retentionDetail:
      'ZERO persistent voice retention on server disk or database after call turn.',
    coords: [-0.75, -0.95, 0],
    isDisposal: true,
  },
  {
    id: 'audit_ledger',
    stepNum: '05B',
    name: 'Chained Audit Ledger',
    shortLabel: '05B Ledger',
    headline: 'Tamper-evident SHA-256 hash-chained compliance ledger',
    category: 'audit',
    badge: 'POSTGRESQL LEDGER',
    boundary: 'SHA-256 Hash Digest Chain',
    processingLocation: 'PostgreSQL Database',
    dataIn: 'Clinical encounter events, triage levels & dispatch actions',
    dataOut: 'Cryptographic SHA-256 hash linked to previousHash',
    voiceIsolationDetail:
      'Stores cryptographic verification hashes, caller roles, and UTC timestamps. Does NOT store raw clinical audio.',
    retentionDetail:
      'Durable immutable ledger entries for regulatory compliance and tamper-evident audit verification.',
    coords: [1.5, -0.95, 0],
  },
];

// Dual-Rail Connecting Bus Highway
function DataHighway({
  start,
  end,
  dashed = false,
  color = '#2e2e38',
}: {
  start: [number, number, number];
  end: [number, number, number];
  dashed?: boolean;
  color?: string;
}) {
  const lineObj = useMemo(() => {
    const p0 = new THREE.Vector3(...start);
    const p3 = new THREE.Vector3(...end);
    const midX = (p0.x + p3.x) / 2;
    const p1 = new THREE.Vector3(midX, p0.y, 0.04);
    const p2 = new THREE.Vector3(midX, p3.y, 0.04);
    const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
    const points = curve.getPoints(40);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: dashed ? new THREE.Color('#3f3f4e') : new THREE.Color(color),
      transparent: true,
      opacity: dashed ? 0.6 : 0.9,
      linewidth: 2,
    });
    return new THREE.Line(geo, mat);
  }, [start, end, dashed, color]);

  return <primitive object={lineObj} />;
}

// Directional Photon Signal Packets
function SignalPhoton({
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
    const p1 = new THREE.Vector3(midX, p0.y, 0.06);
    const p2 = new THREE.Vector3(midX, p3.y, 0.06);
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
      <sphereGeometry args={[0.048, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} />
    </mesh>
  );
}

// Sculptural 3D Architectural Processing Module (Titanium Chassis, Wireframe Chamfers, Glass Deck, Station Core)
function ProcessingModule3D({
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

  const boxGeo = useMemo(() => new THREE.BoxGeometry(1.05, 0.78, 0.16), []);
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(boxGeo), [boxGeo]);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      // Elevate active module along Z towards camera (+0.22 units)
      const targetZ = isSelected ? 0.22 : isHovered ? 0.09 : 0;
      const targetScale = isSelected ? 1.05 : isHovered ? 1.02 : 1.0;
      groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, targetZ, 0.1);
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    }
    if (haloRef.current && isSelected) {
      const pulse = 1 + Math.sin(clock.getElapsedTime() * 2.8) * 0.025;
      haloRef.current.scale.set(pulse, pulse, 1);
    }
  });

  const isDisposal = stage.isDisposal;
  const isAudit = stage.category === 'audit';
  const activeColor = isDisposal ? '#34d399' : isAudit ? '#38bdf8' : '#67E8F9';
  const rimTrimColor = isSelected ? activeColor : isHovered ? '#64748b' : '#383846';

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
      {/* 1. Active Laser Reticle Frame */}
      {isSelected && (
        <mesh ref={haloRef} position={[0, 0, -0.015]}>
          <ringGeometry args={[0.55, 0.575, 48]} />
          <meshBasicMaterial color={activeColor} transparent opacity={0.85} />
        </mesh>
      )}

      {/* 2. Base Platform Chassis (Architectural Slate/Titanium Solid Block) */}
      <mesh position={[0, 0, 0]}>
        <primitive object={boxGeo} attach="geometry" />
        <meshStandardMaterial
          color={isHovered ? '#323242' : isSelected ? '#2b2b38' : '#22222d'}
          roughness={0.35}
          metalness={0.75}
        />
      </mesh>

      {/* 3. Razor-Sharp Precision Wireframe Chamfer Edges */}
      <lineSegments position={[0, 0, 0]}>
        <primitive object={edgesGeo} attach="geometry" />
        <lineBasicMaterial
          color={isSelected ? activeColor : isHovered ? '#818cf8' : '#47475c'}
          transparent
          opacity={isSelected ? 0.95 : isHovered ? 0.8 : 0.6}
        />
      </lineSegments>

      {/* 4. Outer Perimeter Bezel Trim */}
      <mesh position={[0, 0, 0.082]}>
        <boxGeometry args={[0.99, 0.72, 0.012]} />
        <meshStandardMaterial
          color={rimTrimColor}
          roughness={0.2}
          metalness={0.85}
          emissive={isSelected ? activeColor : '#000000'}
          emissiveIntensity={isSelected ? 0.35 : 0}
        />
      </mesh>

      {/* 5. Translucent Obsidian Glass Deck */}
      <mesh position={[0, 0, 0.09]}>
        <boxGeometry args={[0.92, 0.65, 0.02]} />
        <meshStandardMaterial
          color="#0d0d12"
          roughness={0.15}
          metalness={0.9}
        />
      </mesh>

      {/* 6. Station Architectural Hardware Badging */}
      <mesh position={[-0.34, 0.23, 0.105]}>
        <boxGeometry args={[0.18, 0.07, 0.01]} />
        <meshBasicMaterial color={isSelected ? activeColor : '#3e3e52'} />
      </mesh>

      {/* 7. Internal Station Architecture Core */}
      {stage.id === 'audio_buffer' && (
        /* Acoustic Sensor Core */
        <group position={[0, 0, 0.11]}>
          <mesh>
            <cylinderGeometry args={[0.2, 0.2, 0.04, 32]} />
            <meshStandardMaterial
              color={isSelected ? '#67E8F9' : '#22222e'}
              emissive={isSelected ? '#67E8F9' : '#0e1726'}
              emissiveIntensity={isSelected ? 1.6 : 0.2}
              metalness={0.5}
            />
          </mesh>
          <mesh position={[0, 0, 0.025]}>
            <ringGeometry args={[0.1, 0.13, 24]} />
            <meshBasicMaterial color={isSelected ? '#ffffff' : '#38bdf8'} />
          </mesh>
        </group>
      )}

      {stage.id === 'local_whisper' && (
        /* Neural ASR Silicon Core */
        <group position={[0, 0, 0.11]}>
          <mesh>
            <boxGeometry args={[0.34, 0.34, 0.05]} />
            <meshStandardMaterial
              color={isSelected ? '#67E8F9' : '#262634'}
              emissive={isSelected ? '#67E8F9' : '#082f49'}
              emissiveIntensity={isSelected ? 1.7 : 0.25}
              roughness={0.2}
              metalness={0.6}
            />
          </mesh>
          {/* Micro Pin Contacts */}
          <mesh position={[0, 0, 0.03]}>
            <boxGeometry args={[0.16, 0.16, 0.01]} />
            <meshBasicMaterial color={isSelected ? '#ffffff' : '#94a3b8'} />
          </mesh>
        </group>
      )}

      {stage.id === 'clinical_context' && (
        /* Safety Arbiter Diamond Shield */
        <group position={[0, 0, 0.11]} rotation={[0, 0, Math.PI / 4]}>
          <mesh>
            <boxGeometry args={[0.28, 0.28, 0.05]} />
            <meshStandardMaterial
              color={isSelected ? '#67E8F9' : '#222230'}
              emissive={isSelected ? '#67E8F9' : '#0e243a'}
              emissiveIntensity={isSelected ? 1.8 : 0.3}
              roughness={0.2}
              metalness={0.7}
            />
          </mesh>
        </group>
      )}

      {stage.id === 'cloud_inference' && (
        /* Cloud LLM Dual Cluster */
        <group position={[0, 0, 0.11]}>
          <mesh position={[-0.1, 0, 0]}>
            <boxGeometry args={[0.14, 0.3, 0.05]} />
            <meshStandardMaterial
              color={isSelected ? '#67E8F9' : '#222230'}
              emissive={isSelected ? '#67E8F9' : '#1e1b4b'}
              emissiveIntensity={isSelected ? 1.7 : 0.2}
            />
          </mesh>
          <mesh position={[0.1, 0, 0]}>
            <boxGeometry args={[0.14, 0.3, 0.05]} />
            <meshStandardMaterial
              color={isSelected ? '#67E8F9' : '#222230'}
              emissive={isSelected ? '#67E8F9' : '#1e1b4b'}
              emissiveIntensity={isSelected ? 1.7 : 0.2}
            />
          </mesh>
        </group>
      )}

      {stage.id === 'audio_disposal' && (
        /* Zeroize / Purge Chamber Core */
        <group position={[0, 0, 0.11]}>
          <mesh>
            <boxGeometry args={[0.34, 0.34, 0.05]} />
            <meshStandardMaterial
              color={isSelected ? '#34d399' : '#10b981'}
              emissive={isSelected ? '#34d399' : '#064e3b'}
              emissiveIntensity={isSelected ? 1.9 : 0.6}
            />
          </mesh>
          <mesh position={[0, 0, 0.03]}>
            <circleGeometry args={[0.07, 16]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      )}

      {stage.id === 'audit_ledger' && (
        /* Chained Block Ledger Core */
        <group position={[0, 0, 0.11]}>
          <mesh position={[-0.08, -0.04, 0]}>
            <boxGeometry args={[0.18, 0.18, 0.05]} />
            <meshStandardMaterial
              color={isSelected ? '#38bdf8' : '#252536'}
              emissive={isSelected ? '#38bdf8' : '#0c4a6e'}
              emissiveIntensity={isSelected ? 1.6 : 0.3}
            />
          </mesh>
          <mesh position={[0.08, 0.04, 0.02]}>
            <boxGeometry args={[0.18, 0.18, 0.05]} />
            <meshStandardMaterial
              color={isSelected ? '#67e8f9' : '#2d2d3e'}
              emissive={isSelected ? '#67e8f9' : '#075985'}
              emissiveIntensity={isSelected ? 1.6 : 0.3}
            />
          </mesh>
        </group>
      )}

      {/* 8. Active Laser Pin Bead */}
      {isSelected && (
        <mesh position={[0, 0, 0.17]}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
    </group>
  );
}

// Responsive Camera Controller with Stable Framing
function SceneCameraController({
  reducedMotion,
}: {
  reducedMotion: boolean;
}) {
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
    // Wide desktop aspect (~1.5+ in side-by-side) -> baseZ is 5.8 (cleanly frames width 4.5)
    // Mobile / square aspect (<1.15) -> baseZ scales to 13.5 so full architectural pipeline fits comfortably inside portrait viewport
    const baseZ =
      aspect < 1.15
        ? 13.5
        : aspect < 1.55
        ? Math.max(5.8, 5.5 * (1.45 / Math.max(aspect, 0.65)))
        : 5.8;

    if (reducedMotion) {
      camera.position.set(0, -0.15, baseZ);
      camera.lookAt(0, -0.15, 0);
      return;
    }

    const targetX = mouseRef.current.x * 0.14;
    const targetY = mouseRef.current.y * 0.08 - 0.15;

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.05);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.05);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, baseZ, 0.05);
    camera.lookAt(0, -0.15, 0);
  });

  return null;
}

// 3D Canvas Scene
function LifecycleCanvas({
  activeStageId,
  onSelectStageId,
  hoveredStageId,
  setHoveredStageId,
  reducedMotion,
}: {
  activeStageId: string;
  onSelectStageId: (id: string) => void;
  hoveredStageId: string | null;
  setHoveredStageId: (id: string | null) => void;
  reducedMotion: boolean;
}) {
  return (
    <div className="w-full h-full cursor-pointer relative">
      <Canvas
        camera={{ position: [0, -0.15, 5.8], fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.55} />
        {/* Key Light */}
        <directionalLight position={[5, 8, 6]} intensity={2.0} color="#ffffff" />
        {/* Cyan Rim Light for Specular Metallic Bevels */}
        <directionalLight position={[-6, 3, -2]} intensity={1.2} color="#67e8f9" />
        {/* Subtle Slate Fill Light */}
        <directionalLight position={[0, -5, 3]} intensity={0.6} color="#94a3b8" />
        {/* Center Point Light */}
        <pointLight position={[0, 0, 4]} intensity={0.9} color="#38bdf8" distance={14} />

        <SceneCameraController reducedMotion={reducedMotion} />

        {/* Spatial Tilt Group */}
        <group rotation={[0.1, -0.03, 0]}>
          {/* Main Conduits (01 -> 02 -> 03 -> 04) */}
          <DataHighway
            start={LIFECYCLE_STAGES[0].coords}
            end={LIFECYCLE_STAGES[1].coords}
          />
          <DataHighway
            start={LIFECYCLE_STAGES[1].coords}
            end={LIFECYCLE_STAGES[2].coords}
          />
          <DataHighway
            start={LIFECYCLE_STAGES[2].coords}
            end={LIFECYCLE_STAGES[3].coords}
          />

          {/* Downward Branch: Memory Purge (02 -> 05A) */}
          <DataHighway
            start={LIFECYCLE_STAGES[1].coords}
            end={LIFECYCLE_STAGES[4].coords}
            dashed
            color="#10b981"
          />

          {/* Downward Branch: Audit Ledger (03 -> 05B & 04 -> 05B) */}
          <DataHighway
            start={LIFECYCLE_STAGES[2].coords}
            end={LIFECYCLE_STAGES[5].coords}
            color="#38bdf8"
          />
          <DataHighway
            start={LIFECYCLE_STAGES[3].coords}
            end={LIFECYCLE_STAGES[5].coords}
            dashed
            color="#38bdf8"
          />

          {/* Photon Signals Traveling Along Conduits */}
          {!reducedMotion && (
            <>
              {/* Forward audio -> transcript */}
              <SignalPhoton
                start={LIFECYCLE_STAGES[0].coords}
                end={LIFECYCLE_STAGES[1].coords}
                speed={0.85}
                offset={0}
              />
              {/* Forward transcript -> arbiter */}
              <SignalPhoton
                start={LIFECYCLE_STAGES[1].coords}
                end={LIFECYCLE_STAGES[2].coords}
                speed={0.85}
                offset={0.6}
              />
              {/* Forward clinical context -> cloud LLM */}
              <SignalPhoton
                start={LIFECYCLE_STAGES[2].coords}
                end={LIFECYCLE_STAGES[3].coords}
                speed={0.85}
                offset={1.2}
              />
              {/* Branch A: Audio purge signal */}
              <SignalPhoton
                start={LIFECYCLE_STAGES[1].coords}
                end={LIFECYCLE_STAGES[4].coords}
                color="#34d399"
                speed={0.7}
                offset={0.9}
              />
              {/* Branch B: Arbiter audit commit */}
              <SignalPhoton
                start={LIFECYCLE_STAGES[2].coords}
                end={LIFECYCLE_STAGES[5].coords}
                color="#38bdf8"
                speed={0.75}
                offset={1.4}
              />
            </>
          )}

          {/* 3D Modular Blocks */}
          {LIFECYCLE_STAGES.map((st) => (
            <ProcessingModule3D
              key={st.id}
              stage={st}
              isSelected={activeStageId === st.id}
              isHovered={hoveredStageId === st.id}
              onPointerOver={() => setHoveredStageId(st.id)}
              onPointerOut={() => setHoveredStageId(null)}
              onClick={() => onSelectStageId(st.id)}
            />
          ))}
        </group>
      </Canvas>
    </div>
  );
}

// Accessible 2D Fallback
function StaticFlowchartFallback({
  activeStageId,
  onSelectStageId,
}: {
  activeStageId: string;
  onSelectStageId: (id: string) => void;
}) {
  return (
    <div className="w-full p-8 bg-[#08080a] text-white space-y-4">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <span className="font-mono text-xs font-semibold text-cyan-400">
          DATA LIFECYCLE ARCHITECTURE (2D SPECIFICATION)
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {LIFECYCLE_STAGES.map((st) => {
          const isSel = activeStageId === st.id;
          return (
            <button
              key={st.id}
              onClick={() => onSelectStageId(st.id)}
              className={`p-4 rounded-xl text-left transition-all cursor-pointer flex flex-col gap-1.5 ${
                isSel
                  ? 'bg-neutral-900 border border-cyan-400/80 shadow-sm'
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
  // SINGLE AUTHORITATIVE SOURCE OF TRUTH FOR ACTIVE STAGE
  const [activeStageId, setActiveStageId] = useState<string>('audio_buffer');
  const [hoveredStageId, setHoveredStageId] = useState<string | null>(null);
  const [webglSupported, setWebglSupported] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [isInView, setIsInView] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedStage = useMemo(
    () => LIFECYCLE_STAGES.find((s) => s.id === activeStageId) ?? LIFECYCLE_STAGES[0],
    [activeStageId]
  );

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
    const curIdx = LIFECYCLE_STAGES.findIndex((s) => s.id === activeStageId);
    const nextIdx = (curIdx + 1) % LIFECYCLE_STAGES.length;
    setActiveStageId(LIFECYCLE_STAGES[nextIdx].id);
  };

  return (
    <div
      ref={containerRef}
      style={{ backgroundColor: '#08080a' }}
      className={`relative w-full rounded-2xl sm:rounded-3xl bg-[#08080a] border border-neutral-800/80 text-white overflow-hidden shadow-2xl flex flex-col ${className}`}
    >
      {/* 1. Integrated Minimalist Header & Navigation Bar (Single Authoritative Strip) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between px-6 sm:px-8 py-4 border-b border-neutral-800/80 bg-[#0a0a0e] gap-4">
        <div>
          <span className="font-mono text-[11px] font-bold tracking-widest text-zinc-500 uppercase block">
            01 — 06 ARCHITECTURAL PIPELINE
          </span>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Interactive Clinical Data Lifecycle
          </h2>
        </div>

        {/* Minimalist Segmented Stage Tabs with Active Gliding Underline */}
        <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar pb-1 lg:pb-0">
          {LIFECYCLE_STAGES.map((st) => {
            const isSel = activeStageId === st.id;
            return (
              <button
                key={st.id}
                onClick={() => setActiveStageId(st.id)}
                className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer shrink-0 focus-visible:outline-none ${
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
                <span>{st.shortLabel.replace(/^[0-9A-B]+ /, '')}</span>
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
        </div>
      </div>

      {/* 2. Coordinated Side-by-Side Architectural Workspace (3D Canvas + Side Stage Inspector) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[500px] lg:min-h-[540px] w-full">
        {/* Left Column (8 cols): 3D Sculptural Visualizer */}
        <div className="lg:col-span-7 xl:col-span-8 relative h-[380px] sm:h-[440px] lg:h-full min-h-[380px] sm:min-h-[440px] bg-[#070709] border-b lg:border-b-0 lg:border-r border-neutral-800/80">
          {webglSupported && isInView ? (
            <LifecycleCanvas
              activeStageId={activeStageId}
              onSelectStageId={setActiveStageId}
              hoveredStageId={hoveredStageId}
              setHoveredStageId={setHoveredStageId}
              reducedMotion={reducedMotion}
            />
          ) : (
            <StaticFlowchartFallback
              activeStageId={activeStageId}
              onSelectStageId={setActiveStageId}
            />
          )}

          {/* Interactive Micro-Legend Anchored to Canvas */}
          <div className="absolute bottom-3 left-5 right-5 flex items-center justify-between font-mono text-[10px] text-zinc-500 pointer-events-none">
            <span className="truncate">
              PIPELINE: 16kHz PCM → NEURAL ASR → ARBITER → CLOUD LLM (DOWNWARD PURGE & LEDGER)
            </span>
            <span className="hidden sm:inline shrink-0 pl-3">
              SELECT ANY 3D MODULE TO INSPECT
            </span>
          </div>
        </div>

        {/* Right Column (4-5 cols): Integrated Stage Inspector Panel */}
        <div className="lg:col-span-5 xl:col-span-4 p-6 sm:p-7 bg-[#0a0a0d] flex flex-col justify-between">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedStage.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-5"
            >
              {/* Header: Stage Badge & Title */}
              <div className="space-y-1.5 border-b border-neutral-800/70 pb-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-cyan-400 tracking-wider">
                    {selectedStage.stepNum} — {selectedStage.badge}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
                    STAGE {selectedStage.stepNum} OF 06
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-snug">
                  {selectedStage.name}
                </h3>
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed font-normal pt-0.5">
                  {selectedStage.headline}
                </p>
              </div>

              {/* Data In & Data Out Specification */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-1">
                  <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                    DATA IN
                  </span>
                  <p className="text-xs text-zinc-200 leading-tight">
                    {selectedStage.dataIn}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800/80 space-y-1">
                  <span className="font-mono text-[10px] font-bold text-cyan-400 uppercase tracking-wider block">
                    DATA OUT
                  </span>
                  <p className="text-xs text-zinc-200 leading-tight">
                    {selectedStage.dataOut}
                  </p>
                </div>
              </div>

              {/* Processing Sovereignty & Voice Isolation */}
              <div className="space-y-1.5 pt-1">
                <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                  PROCESSING SOVEREIGNTY & ISOLATION
                </span>
                <p className="text-xs sm:text-[13px] text-zinc-200 leading-relaxed font-normal">
                  {selectedStage.voiceIsolationDetail}
                </p>
                <div className="pt-1">
                  <span className="inline-block font-mono text-[10px] text-zinc-400 bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded">
                    Boundary: {selectedStage.boundary}
                  </span>
                </div>
              </div>

              {/* Data Retention & Lifecycle */}
              <div className="space-y-1.5 pt-1">
                <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                  MEMORY & RETENTION LIFECYCLE
                </span>
                <p className="text-xs sm:text-[13px] text-zinc-200 leading-relaxed font-normal">
                  {selectedStage.retentionDetail}
                </p>
              </div>

              {/* Pilot Legal Disclaimer if Applicable */}
              {selectedStage.vendorNotice && (
                <div className="p-3 rounded-xl bg-neutral-900/90 border border-amber-900/40 text-amber-200/90 text-xs font-mono leading-relaxed flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{selectedStage.vendorNotice}</span>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Action Footer: Step Next Stage Button */}
          <div className="pt-6 border-t border-neutral-800/70 mt-6 flex items-center justify-between">
            <span className="font-mono text-[11px] text-zinc-400">
              Active: {selectedStage.shortLabel}
            </span>
            <button
              onClick={handleNextStage}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-mono text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-700/80 transition-all cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
            >
              <span>Step next</span>
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClinicalDataLifecycle3D;
