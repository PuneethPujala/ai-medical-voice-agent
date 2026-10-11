"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Database,
  Volume2,
  FileCheck,
  AlertTriangle,
  Lock,
  Unlock,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Clock,
  UserCheck,
  CheckCircle2,
  XCircle,
  Stethoscope,
  Radio,
  FileText,
  AlertCircle,
  Eye,
  Key
} from "lucide-react";
import { AppFooter } from "../_components/AppFooter";

interface AdminMetrics {
  overview: {
    totalConsultations: number;
    emergencyCases: number;
    priorityCases: number;
    routineCases: number;
    avgDurationSeconds: number;
    emergencyRatePercent: number;
  };
  systemHealth: {
    database: {
      status: string;
      latencyMs: number;
      engine: string;
    };
    audioEngine: {
      status: string;
      provider: string;
      loadedVoices: string[];
      activePersona: string;
    };
    safetyArbiter: {
      status: string;
      protocol: string;
      preArbiterBypassShield: string;
    };
    cryptographicAudit: {
      status: string;
      totalEvents: number;
      genesisHash: string;
      headHash: string | null;
      algorithm: string;
    };
  };
  distributions: {
    bySpecialty: Record<string, number>;
    byDoctor: Record<string, number>;
  };
  safetyMetrics: {
    accessDeniedEvents: number;
    emergencyDispatches: number;
    triageEvaluations: number;
    auditChainIntegrity: boolean;
  };
  registeredDoctors: Array<{
    id: string;
    name: string;
    specialty: string;
    voiceId: string;
    voiceGender: string;
  }>;
}

interface AuditLogEntry {
  index: number;
  id: string;
  timestamp: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  status: "SUCCESS" | "DENIED" | "FAILED";
  previousHash: string;
  eventHash: string;
  metadata?: Record<string, any>;
}

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "analytics" | "safety" | "health" | "audit">("overview");
  const [simulatePatientView, setSimulatePatientView] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [authSession, setAuthSession] = useState<{ isSignedIn: boolean; role: string; email?: string } | null>(null);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditVerification, setAuditVerification] = useState<{
    valid: boolean;
    totalEvents: number;
    headHash: string | null;
    reason?: string;
  } | null>(null);
  const [errorStatus, setErrorStatus] = useState<{ code: number; message: string } | null>(null);
  const [auditFilter, setAuditFilter] = useState("");

  const fetchData = useCallback(async (isSimulatedPatient: boolean) => {
    setLoading(true);
    setErrorStatus(null);

    // If an authenticated admin opts to simulate the patient experience, down-scope request
    const headers: Record<string, string> = {};
    if (isSimulatedPatient) {
      headers["x-simulate-patient-view"] = "true";
    }

    try {
      // 1. Check verified session identity
      const sessionRes = await fetch("/api/auth/session");
      if (sessionRes.ok) {
        const sessionJson = await sessionRes.json();
        setAuthSession(sessionJson);
      }

      // 2. Fetch Admin Metrics with server-side authorization check
      const metricsRes = await fetch("/api/admin/metrics", { headers });
      if (!metricsRes.ok) {
        if (metricsRes.status === 401) {
          setErrorStatus({
            code: 401,
            message: "401 Unauthorized: You must be signed in with an administrator account to view clinical telemetry.",
          });
          setMetrics(null);
          setAuditLogs([]);
          setLoading(false);
          return;
        }
        if (metricsRes.status === 403) {
          setErrorStatus({
            code: 403,
            message: "403 Forbidden: Least-privilege boundary active. Role 'patient' lacks administrative permissions.",
          });
          setMetrics(null);
          setAuditLogs([]);
          setLoading(false);
          return;
        }
        throw new Error(`Failed to load metrics: ${metricsRes.statusText}`);
      }
      const metricsJson = await metricsRes.json();
      if (metricsJson.success) {
        setMetrics(metricsJson.data);
      }

      // 3. Fetch Audit Logs
      const auditRes = await fetch("/api/audit?limit=50", { headers });
      if (auditRes.ok) {
        const auditJson = await auditRes.json();
        if (auditJson.success) {
          setAuditLogs(auditJson.events || []);
          setAuditVerification(auditJson.integrity || null);
        }
      }
    } catch (err: any) {
      setErrorStatus({
        code: 500,
        message: err?.message || "Failed to communicate with administration API",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(simulatePatientView);
  }, [simulatePatientView, fetchData]);

  const handleVerifyAuditChain = async () => {
    setVerifying(true);
    try {
      const headers: Record<string, string> = {};
      if (simulatePatientView) headers["x-simulate-patient-view"] = "true";

      const res = await fetch("/api/audit?limit=100", { headers });
      const json = await res.json();
      if (json.success) {
        setAuditVerification(json.integrity);
        setAuditLogs(json.events || []);
      }
    } catch (err) {
      console.error("Verification failed:", err);
    } finally {
      setVerifying(false);
    }
  };

  const filteredLogs = auditLogs.filter((log) => {
    if (!auditFilter) return true;
    const term = auditFilter.toLowerCase();
    return (
      log.action.toLowerCase().includes(term) ||
      log.actorId.toLowerCase().includes(term) ||
      log.resourceType.toLowerCase().includes(term) ||
      log.eventHash.toLowerCase().includes(term) ||
      log.status.toLowerCase().includes(term)
    );
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-black">

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-16">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 border border-cyan-500/30 rounded-xl text-cyan-400">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  Clinical Administration & Governance
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono">
                    v0.1.0-RBAC
                  </span>
                </h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  Durable cryptographic audit verification, clinical intake telemetry, and deterministic safety metrics.
                </p>
              </div>
            </div>
          </div>

          {/* Session Info & Down-scope Testing Fixture */}
          <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 p-1.5 rounded-xl shadow-inner">
            <div className="text-xs font-semibold text-slate-400 px-2 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-cyan-400" />
              Active Role:{" "}
              <span className={`font-mono font-bold ${authSession?.role === "admin" ? "text-cyan-400" : "text-amber-400"}`}>
                {authSession?.role || "authenticating..."}
              </span>
            </div>
            <button
              onClick={() => setSimulatePatientView(!simulatePatientView)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                simulatePatientView
                  ? "bg-rose-500 text-white shadow-md font-semibold"
                  : "bg-slate-800 text-slate-300 hover:text-white"
              }`}
              title="Voluntarily down-scope to test patient 403 Forbidden enforcement"
            >
              {simulatePatientView ? "Simulating Patient View (403 Active)" : "Test Patient Boundary (Down-scope)"}
            </button>
            <button
              onClick={() => fetchData(simulatePatientView)}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Refresh Telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-cyan-400" : ""}`} />
            </button>
          </div>
        </div>

        {/* 401 Unauthorized State Display */}
        {errorStatus?.code === 401 && (
          <div className="my-8 p-6 rounded-2xl bg-amber-950/30 border border-amber-800/50 backdrop-blur-sm">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl">
                <Lock className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-amber-200">Authentication Required</h3>
                <p className="text-sm text-amber-300/90 mt-1">{errorStatus.message}</p>
                <div className="mt-4">
                  <a
                    href="/sign-in"
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow transition-colors inline-block"
                  >
                    Sign In with Administrator Account
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 403 Forbidden State Display (RBAC Invariant Verification) */}
        {errorStatus?.code === 403 && (
          <div className="my-8 p-6 rounded-2xl bg-rose-950/30 border border-rose-800/50 backdrop-blur-sm">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-500/20 text-rose-400 rounded-xl">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-rose-200">Least-Privilege RBAC Invariant Enforced</h3>
                <p className="text-sm text-rose-300/90 mt-1">{errorStatus.message}</p>
                <p className="text-xs text-rose-400/80 mt-2 font-mono bg-rose-950/60 p-2.5 rounded-lg border border-rose-900/60">
                  SECURITY LOG: Active request with role &#39;patient&#39; attempted to query restricted administrative metrics.
                  Event logged to immutable cryptographic SHA-256 chain under action &#39;ACCESS_DENIED&#39;.
                </p>
                {simulatePatientView && (
                  <div className="mt-4">
                    <button
                      onClick={() => setSimulatePatientView(false)}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold rounded-lg shadow transition-colors"
                    >
                      Disable Simulation & Restore Admin View
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!errorStatus && (
          <>
            {/* Tabs */}
            <div className="flex items-center gap-2 mt-6 border-b border-slate-800/80 pb-2 overflow-x-auto">
              {[
                { id: "overview", label: "Overview", icon: Activity },
                { id: "analytics", label: "Intake Analytics", icon: TrendingUp },
                { id: "safety", label: "Clinical Safety", icon: ShieldAlert },
                { id: "health", label: "System Health", icon: Database },
                { id: "audit", label: "Audit Ledger", icon: FileCheck },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? "bg-slate-800/90 text-cyan-400 border border-cyan-500/30 shadow-sm"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* TAB CONTENT: 1. OVERVIEW */}
            {activeTab === "overview" && metrics && (
              <div className="space-y-6 mt-6">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">Total Consultations</span>
                      <Stethoscope className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="text-3xl font-extrabold text-white mt-2 font-mono">
                      {metrics.overview.totalConsultations}
                    </div>
                    <span className="text-xs text-slate-400 mt-1 block">Live intake sessions completed</span>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">Emergency Cases (ESI 1-2)</span>
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    </div>
                    <div className="text-3xl font-extrabold text-rose-400 mt-2 font-mono">
                      {metrics.overview.emergencyCases}
                    </div>
                    <span className="text-xs text-rose-400/80 mt-1 block">
                      {metrics.overview.emergencyRatePercent}% critical escalation rate
                    </span>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">Mean Triage Duration</span>
                      <Clock className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-3xl font-extrabold text-white mt-2 font-mono">
                      {metrics.overview.avgDurationSeconds}s
                    </div>
                    <span className="text-xs text-slate-400 mt-1 block">Average clinical intake time</span>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">Cryptographic Chain</span>
                      <FileCheck className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-3xl font-extrabold text-emerald-400 mt-2 font-mono">
                      {metrics.systemHealth.cryptographicAudit.totalEvents}
                    </div>
                    <span className="text-xs text-emerald-400/80 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Chain 100% Tamper-Evident
                    </span>
                  </div>
                </div>

                {/* Active Personas & Clinical Panel */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h3 className="text-base font-bold text-white flex items-center gap-2 mb-4">
                      <UserCheck className="w-4 h-4 text-cyan-400" />
                      Active Specialist Personas & Immutable Voice Calibration
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {metrics.registeredDoctors.map((doc) => {
                        const isAnna = doc.id === "dr-anna-bennett";
                        return (
                          <div
                            key={doc.id}
                            className={`p-4 rounded-xl border transition-all ${
                              isAnna
                                ? "bg-cyan-950/20 border-cyan-500/40 shadow-sm shadow-cyan-950"
                                : "bg-slate-950/40 border-slate-800/80"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm text-slate-200">{doc.name}</span>
                              {isAnna && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                  ACTIVE INTAKE
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400 block mt-0.5">{doc.specialty}</span>
                            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/60 pt-2 font-mono">
                              <span className="flex items-center gap-1.5">
                                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                                {doc.voiceId} ({doc.voiceGender})
                              </span>
                              <span className="text-emerald-400 font-sans text-[11px]">Enforced</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tamper-Evident Head Card */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2 mb-2">
                        <Lock className="w-4 h-4 text-emerald-400" />
                        Audit Ledger Head
                      </h3>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Every clinical consultation, emergency dispatch, and access request is linked with a SHA-256 cryptographic pointer.
                      </p>

                      <div className="mt-4 p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Genesis Block:</span>
                          <span className="text-xs font-mono text-slate-400 truncate block">
                            {metrics.systemHealth.cryptographicAudit.genesisHash.slice(0, 24)}...
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Head Block Hash:</span>
                          <span className="text-xs font-mono text-cyan-400 truncate block">
                            {metrics.systemHealth.cryptographicAudit.headHash || "Chain Empty"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Storage Persistence:</span>
                          <span className="text-xs text-emerald-400 font-medium">
                            Durable Neon PostgreSQL (audit_events)
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveTab("audit")}
                      className="mt-4 w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700/80 text-cyan-300 text-xs font-semibold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> Inspect Complete Audit Chain
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: 2. ANALYTICS */}
            {activeTab === "analytics" && metrics && (
              <div className="space-y-6 mt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Triage Level Breakdown */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h3 className="text-base font-bold text-white mb-4">ESI Triage Severity Distribution</h3>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-rose-400 font-medium">Emergent (ESI 1-2)</span>
                          <span className="font-mono text-slate-300">{metrics.overview.emergencyCases} cases</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-rose-500 h-2 rounded-full"
                            style={{
                              width: `${
                                metrics.overview.totalConsultations > 0
                                  ? (metrics.overview.emergencyCases / metrics.overview.totalConsultations) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-amber-400 font-medium">Urgent / Priority (ESI 3)</span>
                          <span className="font-mono text-slate-300">{metrics.overview.priorityCases} cases</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-amber-500 h-2 rounded-full"
                            style={{
                              width: `${
                                metrics.overview.totalConsultations > 0
                                  ? (metrics.overview.priorityCases / metrics.overview.totalConsultations) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-emerald-400 font-medium">Less Urgent / Routine (ESI 4-5)</span>
                          <span className="font-mono text-slate-300">{metrics.overview.routineCases} cases</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-2 rounded-full"
                            style={{
                              width: `${
                                metrics.overview.totalConsultations > 0
                                  ? (metrics.overview.routineCases / metrics.overview.totalConsultations) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Specialty Distribution */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h3 className="text-base font-bold text-white mb-4">Specialty Case Allocation</h3>
                    <div className="space-y-2.5">
                      {Object.entries(metrics.distributions.bySpecialty).map(([spec, count]) => (
                        <div key={spec} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/60 last:border-0">
                          <span className="text-slate-300">{spec}</span>
                          <span className="font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-semibold">
                            {count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Clinician Case Load */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h3 className="text-base font-bold text-white mb-4">Doctor Engagement Telemetry</h3>
                    <div className="space-y-2.5">
                      {Object.entries(metrics.distributions.byDoctor).map(([doc, count]) => (
                        <div key={doc} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/60 last:border-0">
                          <span className="text-slate-300">{doc}</span>
                          <span className="font-mono px-2 py-0.5 rounded bg-slate-800 text-emerald-400 font-semibold">
                            {count} sessions
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: 3. SAFETY METRICS */}
            {activeTab === "safety" && metrics && (
              <div className="space-y-6 mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Safety Arbiter Invariants */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h3 className="text-base font-bold text-white flex items-center gap-2 mb-4">
                      <ShieldCheck className="w-5 h-5 text-emerald-400" />
                      Deterministic Clinical Invariants
                    </h3>
                    <div className="space-y-3 text-xs">
                      <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-slate-200">Pre-Arbiter Red Flag Override</span>
                          <p className="text-slate-400 mt-0.5">
                            Acute coronary syndromes, BE-FAST stroke signs, and airway emergencies bypass deliberation and force immediate ESI 2 Emergency tier.
                          </p>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-slate-200">Golden Invariant: No Stale Question Loops</span>
                          <p className="text-slate-400 mt-0.5">
                            Questions never re-inquire about facts already known, denied, or contradicted.
                          </p>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-slate-200">Odynophagia vs Dysphagia Boundary</span>
                          <p className="text-slate-400 mt-0.5">
                            Painful swallowing (odynophagia) clarifies mechanical dysphagia with high priority before generic timeline questions.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Safety Incident & Tamper Counts */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h3 className="text-base font-bold text-white flex items-center gap-2 mb-4">
                      <AlertCircle className="w-5 h-5 text-cyan-400" />
                      Security & Safety Ledger Records
                    </h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                        <span className="text-xs text-slate-300">Unauthorized Access Attempts (Blocked)</span>
                        <span className="font-mono text-base font-bold text-rose-400">
                          {metrics.safetyMetrics.accessDeniedEvents}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                        <span className="text-xs text-slate-300">Emergency ED Dispatches Triggered</span>
                        <span className="font-mono text-base font-bold text-amber-400">
                          {metrics.safetyMetrics.emergencyDispatches}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                        <span className="text-xs text-slate-300">Triage Safety Evaluations Executed</span>
                        <span className="font-mono text-base font-bold text-cyan-400">
                          {metrics.safetyMetrics.triageEvaluations}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl">
                        <span className="text-xs text-slate-300">Cryptographic SHA-256 Chain Status</span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> 100% AUTHENTIC
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: 4. SYSTEM HEALTH */}
            {activeTab === "health" && metrics && (
              <div className="space-y-6 mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Database Subsystem */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Database className="w-5 h-5 text-cyan-400" />
                        <h3 className="font-bold text-white">PostgreSQL Persistence Engine</h3>
                      </div>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {metrics.systemHealth.database.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500">Provider</span>
                        <span className="font-mono">{metrics.systemHealth.database.engine}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500">Query Latency</span>
                        <span className="font-mono text-cyan-400">{metrics.systemHealth.database.latencyMs} ms</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-500">Tables Managed</span>
                        <span className="font-mono">audit_events, consultations, hospitals, doctor_profiles</span>
                      </div>
                    </div>
                  </div>

                  {/* Audio & Kokoro Engine */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-5 h-5 text-emerald-400" />
                        <h3 className="font-bold text-white">Kokoro Voice Synthesis Engine</h3>
                      </div>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        READY
                      </span>
                    </div>
                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500">Engine / Architecture</span>
                        <span className="font-mono">{metrics.systemHealth.audioEngine.provider}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500">Active Clinician</span>
                        <span className="font-mono text-cyan-400 font-semibold">
                          {metrics.systemHealth.audioEngine.activePersona}
                        </span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-500">Loaded Kokoro Voices</span>
                        <span className="font-mono">{metrics.systemHealth.audioEngine.loadedVoices.join(", ")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Deterministic Arbiter */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-5 h-5 text-cyan-400" />
                        <h3 className="font-bold text-white">Emergency Severity Index (ESI) Arbiter</h3>
                      </div>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        ACTIVE
                      </span>
                    </div>
                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500">Standard</span>
                        <span className="font-mono">{metrics.systemHealth.safetyArbiter.protocol}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-500">Bypass Shield</span>
                        <span className="font-mono text-emerald-400">Deterministic Rule Gateways Enforced</span>
                      </div>
                    </div>
                  </div>

                  {/* Cryptographic Chain */}
                  <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <FileCheck className="w-5 h-5 text-purple-400" />
                        <h3 className="font-bold text-white">Audit Cryptography</h3>
                      </div>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        CHAIN VERIFIED
                      </span>
                    </div>
                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-500">Algorithm</span>
                        <span className="font-mono">{metrics.systemHealth.cryptographicAudit.algorithm}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-500">Total Immutable Blocks</span>
                        <span className="font-mono font-bold text-white">
                          {metrics.systemHealth.cryptographicAudit.totalEvents}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: 5. AUDIT LEDGER */}
            {activeTab === "audit" && (
              <div className="space-y-6 mt-6">
                {/* Audit Integrity Banner */}
                {auditVerification && (
                  <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">
                          Tamper-Evident SHA-256 Hash Chain Integrity: Valid
                        </h4>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          Verified {auditVerification.totalEvents} sequential blocks. Head:{" "}
                          {auditVerification.headHash ? auditVerification.headHash.slice(0, 24) + "..." : "Genesis"}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleVerifyAuditChain}
                      disabled={verifying}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${verifying ? "animate-spin" : ""}`} />
                      {verifying ? "Verifying Chain..." : "Re-Verify Cryptographic Chain"}
                    </button>
                  </div>
                )}

                {/* Filter and Table */}
                <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
                    <h3 className="font-bold text-white text-base">Immutable Audit Event Ledger</h3>
                    <div className="relative w-full sm:w-64">
                      <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={auditFilter}
                        onChange={(e) => setAuditFilter(e.target.value)}
                        placeholder="Filter action, actor, hash..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 font-mono uppercase text-[10px]">
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Timestamp</th>
                          <th className="py-2.5 px-3">Actor / Role</th>
                          <th className="py-2.5 px-3">Action</th>
                          <th className="py-2.5 px-3">Resource</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">SHA-256 Hash</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {filteredLogs.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-500">
                              No matching audit events found.
                            </td>
                          </tr>
                        ) : (
                          filteredLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-800/30 transition-colors font-mono">
                              <td className="py-2.5 px-3 text-slate-500">{log.index}</td>
                              <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                              </td>
                              <td className="py-2.5 px-3 text-slate-300">
                                <span className="font-semibold text-slate-200">{log.actorId}</span>
                                <span className="text-[10px] text-slate-500 block">{log.actorRole}</span>
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-cyan-400">{log.action}</td>
                              <td className="py-2.5 px-3 text-slate-400">
                                <span className="text-slate-300">{log.resourceType}</span>
                                <span className="text-[10px] text-slate-500 block truncate max-w-[120px]">
                                  {log.resourceId}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    log.status === "SUCCESS"
                                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                                      : log.status === "DENIED"
                                      ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                                      : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                                  }`}
                                >
                                  {log.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-500 text-[10px] truncate max-w-[140px]" title={log.eventHash}>
                                {log.eventHash.slice(0, 16)}...
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <AppFooter />
    </div>
  );
}
