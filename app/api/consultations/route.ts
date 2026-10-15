import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { getAuthContext, hasPermission } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";

// Baseline synthetic clinical demonstration encounters (strictly segregated from production patient queries)
export const memoryConsultations: any[] = [
  {
    id: "MED-2026-ACS-8841",
    userId: "anon-user",
    patientName: "Marcus Vance",
    patientAge: "56",
    patientGender: "male",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Interventional Cardiology",
    chiefComplaint: "Crushing retrosternal chest pressure radiating into left arm and neck with profuse diaphoresis for 40 minutes.",
    triageLevel: "emergency",
    triageTitle: "ESI LEVEL 2: EMERGENT — SUSPECTED ACUTE CORONARY SYNDROME (ACS)",
    icd10Codes: ["I20.9", "I21.9", "R07.9"],
    detectedSymptoms: ["Substernal Chest Pressure", "Left Arm Pain Radiation", "Diaphoresis / Cold Sweats"],
    soapSubjective: "Patient (Marcus Vance, 56M) presents with acute crushing retrosternal pressure radiating down left arm, associated with cold sweats and nausea starting at rest 40 minutes ago.",
    soapObjective: "Clinical features parsed via ESI v4 Arbiter. Identified signs: Substernal chest pressure, radiation to arm, diaphoresis. Diagnostic ICD-10 Tags: I20.9, I21.9, R07.9. Triage Urgency: EMERGENCY (ESI Tier 2). Red Flags: ACS_CHEST_PAIN_WITH_HIGH_RISK_RADIATION_OR_DIAPHORESIS.",
    soapAssessment: "ESI LEVEL 2: EMERGENT — SUSPECTED ACUTE CORONARY SYNDROME (ACS) under specialty consultation by Dr. Sarah Chen, MD (Interventional Cardiology). Urgent 12-lead ECG within 10 minutes of ED arrival. Serial cardiac troponins.",
    soapPlan: "1. Recommended Action: Proceed immediately to nearest Emergency Department equipped with 24/7 Cardiac Cath Lab / PCI.\n2. Specialty Care: Interventional Cardiology\n3. Pre-Arrival Protocol: Transmit pre-arrival Code STEMI alert. Chew 325mg non-enteric coated aspirin.\n4. Safety Arbiter Status: OVERRIDE_ACTIVATED (Forced Emergency Tier)",
    recommendedSpecialists: ["Interventional Cardiology", "Emergency Medicine"],
    recommendedAction: "Proceed immediately to the nearest Emergency Department equipped with 24/7 Cardiac Cath Lab / PCI.",
    durationSeconds: 142,
    status: "approved",
    approvedAt: new Date(Date.now() - 3500000).toISOString(),
    approvedBy: "dr-sarah-chen",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    transcript: [
      { role: "doctor", text: "Hello Marcus, I am Dr. Sarah Chen. How are you feeling today?", timestamp: "11:00 AM" },
      { role: "patient", text: "Doctor, I have this heavy elephant-like weight on my chest and my left arm hurts bad.", timestamp: "11:01 AM" },
      { role: "doctor", text: "Are you sweating or feeling short of breath right now?", timestamp: "11:01 AM" },
      { role: "patient", text: "Yes, I'm drenched in cold sweat and feeling dizzy.", timestamp: "11:02 AM" },
      { role: "doctor", text: "I am detecting signs of critical cardiac distress. Please stay completely still, sit upright, and have someone call 911 immediately.", timestamp: "11:02 AM" }
    ]
  },
  {
    id: "MED-2026-STR-9102",
    userId: "anon-user",
    patientName: "Elena Rostova",
    patientAge: "64",
    patientGender: "female",
    doctorId: "dr-marcus-vance",
    doctorName: "Dr. Marcus Vance, MD",
    specialty: "Neurology & Stroke Care",
    chiefComplaint: "Sudden onset right facial droop and slurred speech starting 25 minutes ago while speaking on phone.",
    triageLevel: "emergency",
    triageTitle: "ESI LEVEL 2: EMERGENT — ACUTE STROKE / NEUROLOGICAL RED FLAG",
    icd10Codes: ["I63.9", "R47.01"],
    detectedSymptoms: ["Right Facial Droop", "Dysarthria / Slurred Speech", "Acute Neurological Deficit"],
    soapSubjective: "Patient (Elena Rostova, 64F) reports sudden difficulty articulating words with acute right-sided facial sagging noticed by family 25 minutes ago.",
    soapObjective: "Clinical features parsed via ESI v4 Arbiter. Identified signs: Facial droop, speech difficulty. Diagnostic ICD-10 Tags: I63.9, R47.01. Triage Urgency: EMERGENCY (ESI Tier 2). Red Flags: BE_FAST_ACUTE_ISCHEMIC_STROKE_SYMPTOMS.",
    soapAssessment: "ESI LEVEL 2: EMERGENT — ACUTE ISCHEMIC STROKE SUSPICION within acute thrombolytic treatment window (<4.5 hrs). Code Stroke activation indicated.",
    soapPlan: "1. Recommended Action: Immediate ambulance dispatch to certified Comprehensive Stroke Center.\n2. Protocol: Emergency Code Stroke activation. Non-contrast CT scan within 20 minutes. Evaluate for IV thrombolysis (tPA/TNK).\n3. Keep patient NPO. Do not administer aspirin prior to CT.",
    recommendedSpecialists: ["Neurology & Stroke Care", "Emergency Medicine"],
    recommendedAction: "Immediate ambulance dispatch to certified Primary Stroke Center.",
    durationSeconds: 98,
    status: "approved",
    approvedAt: new Date(Date.now() - 7100000).toISOString(),
    approvedBy: "dr-marcus-vance",
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    transcript: [
      { role: "doctor", text: "Hello Elena, Dr. Marcus Vance here. What symptoms brought you in?", timestamp: "10:15 AM" },
      { role: "patient", text: "My daughter said my mouth is crooked on one side and I can't say my words right.", timestamp: "10:16 AM" },
      { role: "doctor", text: "These symptoms indicate an acute neurological emergency. Immediate emergency evaluation is critical within the acute treatment window.", timestamp: "10:16 AM" }
    ]
  },
  {
    id: "MED-2026-AMB-4412",
    userId: "anon-user",
    patientName: "David Kim",
    patientAge: "34",
    patientGender: "male",
    doctorId: "dr-emily-watson",
    doctorName: "Dr. Emily Watson, MD",
    specialty: "Primary Care & Internal Medicine",
    chiefComplaint: "Mild scratchy throat, nasal congestion, and clear rhinorrhea for 2 days. No shortness of breath or fever.",
    triageLevel: "routine",
    triageTitle: "ESI LEVEL 4: LESS URGENT CLINICAL EVALUATION",
    icd10Codes: ["J06.9"],
    detectedSymptoms: ["Mild Rhinorrhea", "Scratchy Throat", "Absence of Respiratory Distress"],
    soapSubjective: "Patient (David Kim, 34M) reports 48 hours of mild nasal congestion and scratchy throat without fever, dyspnea, or chest pain.",
    soapObjective: "ESI v4 Arbiter feature extraction. Identified signs: Mild upper respiratory symptoms without red flags. Triage Urgency: ROUTINE (ESI Tier 4).",
    soapAssessment: "ESI LEVEL 4: LESS URGENT — Likely Viral Upper Respiratory Infection (URI).",
    soapPlan: "1. Recommended Action: Schedule outpatient primary care consultation or home supportive care.\n2. Hydration, saline nasal spray, and rest.\n3. Return precautions for high fever (>101 F) or respiratory difficulty.",
    recommendedSpecialists: ["Primary Care & Internal Medicine"],
    recommendedAction: "Schedule visit with primary care physician or walk-in outpatient clinic.",
    durationSeconds: 110,
    status: "completed_pending_review",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    transcript: [
      { role: "doctor", text: "Hello David, how can I help you today?", timestamp: "09:00 AM" },
      { role: "patient", text: "Just woke up with a runny nose and scratchy throat, wondering if I need antibiotics.", timestamp: "09:01 AM" },
      { role: "doctor", text: "I understand. I've noted your mild symptoms. Are you experiencing any fever or shortness of breath?", timestamp: "09:01 AM" },
      { role: "patient", text: "No, no fever and breathing is totally normal.", timestamp: "09:02 AM" }
    ]
  }
];

export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get("userId");
    const datasetParam = searchParams.get("dataset");
    const isSyntheticDemo = datasetParam === "synthetic_demo" || searchParams.get("demo") === "true";

    // 1. Explicit Synthetic Demonstration Dataset Mode
    // Synthetic records are strictly segregated and watermarked. They are never mixed into production queries.
    if (isSyntheticDemo) {
      return NextResponse.json({
        success: true,
        isSyntheticDataset: true,
        warning: "SYNTHETIC DEMONSTRATION DATASET · FOR EVALUATION ONLY · NOT REAL PATIENT RECORDS",
        consultations: memoryConsultations.map((c) => ({
          ...c,
          isSynthetic: true,
          syntheticWatermark: "DEMO / SYNTHETIC",
        })),
      });
    }

    // 2. RBAC & Tenant Isolation: Patients can only view their own consultations.
    // Platform administrators have authority to inspect platform records for maintenance.
    const canReadAll = auth.role === "admin";
    if (!canReadAll && userIdParam && userIdParam !== auth.userId) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: userIdParam,
        status: "DENIED",
        metadata: {
          reason: "Patient attempted to access another user's clinical records",
          attemptedUserId: userIdParam,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: You are only authorized to access your own clinical consultation records.",
        },
        { status: 403 }
      );
    }

    // Determine target user scope based on verified server-side identity (never trust client userId)
    const targetUserId = canReadAll ? (userIdParam || null) : auth.userId;

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "CONSULTATION_ACCESSED",
      resourceType: "consultation",
      resourceId: targetUserId || "all_records",
      status: "SUCCESS",
      metadata: { targetUserId: targetUserId || "all", canReadAll },
    });

    // 3. Fetch from primary database (Neon PostgreSQL)
    const dbClient = getDb();
    if (dbClient) {
      try {
        let results;
        if (targetUserId) {
          results = await dbClient
            .select()
            .from(consultationsTable)
            .where(eq(consultationsTable.userId, targetUserId))
            .orderBy(desc(consultationsTable.createdAt))
            .limit(50);
        } else {
          results = await dbClient
            .select()
            .from(consultationsTable)
            .orderBy(desc(consultationsTable.createdAt))
            .limit(50);
        }
        return NextResponse.json({
          success: true,
          consultations: results,
          isSyntheticDataset: false,
        });
      } catch (dbErr) {
        console.error("Neon DB query error:", dbErr);
        return NextResponse.json(
          {
            success: false,
            error: "Clinical datastore query failure. Unable to retrieve authorized records.",
            code: "SERVICE_UNAVAILABLE",
          },
          { status: 503 }
        );
      }
    }

    // In production, database absence must return 503 Service Unavailable (never synthetic fallback)
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          success: false,
          error: "Clinical records service unavailable. Primary database connection could not be established.",
          code: "SERVICE_UNAVAILABLE",
        },
        { status: 503 }
      );
    }

    // Fallback strictly for local automated test runners (NODE_ENV === 'test' with test harness secret)
    if (auth.isDemoMode && process.env.NODE_ENV === "test") {
      const filtered = targetUserId
        ? memoryConsultations.filter((c) => c.userId === targetUserId)
        : memoryConsultations;

      return NextResponse.json({
        success: true,
        consultations: filtered.slice().reverse(),
        isSyntheticDataset: false,
      });
    }

    // When DB is unconfigured in development, return 503 rather than silent fake records
    return NextResponse.json(
      {
        success: false,
        error: "Database unconfigured. Real clinical datastore required.",
        code: "DATABASE_UNCONFIGURED",
      },
      { status: 503 }
    );
  } catch (error: any) {
    console.error("[ConsultationsGetError]", error);
    return NextResponse.json(
      { success: false, error: process.env.NODE_ENV === "production" ? "Failed to retrieve consultation records" : (error?.message || "Failed to fetch consultations") },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);

    // 1. RBAC: Verify permission to record clinical consultations
    if (!hasPermission(auth.role, "consultations:create")) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: "new_record",
        status: "DENIED",
        metadata: { requiredPermission: "consultations:create", role: auth.role },
      });

      return NextResponse.json(
        { success: false, error: "Forbidden: Role not authorized to record clinical consultations." },
        { status: 403 }
      );
    }

    // 2. Derive authoritative user identity from server session
    // Never trust client-supplied userId to establish ownership
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Authentication required to persist consultation records.",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    // Authoritative tenant/patient isolation: server identity strictly enforced.
    // Client-supplied userId is discarded unless caller possesses verified administrator role.
    const effectiveUserId = auth.role === "admin" && body.userId ? body.userId : auth.userId;

    const {
      id,
      patientName = "Anonymous Patient",
      patientAge,
      patientGender,
      doctorId = "dr-sarah-chen",
      doctorName = "Dr. Sarah Chen, MD",
      specialty = "General Physician",
      chiefComplaint = "",
      transcript = [],
      triageLevel = "routine",
      triageTitle = "LEVEL 3: ROUTINE CLINICAL CARE",
      icd10Codes = [],
      detectedSymptoms = [],
      soapSubjective = "",
      soapObjective = "",
      soapAssessment = "",
      soapPlan = "",
      recommendedSpecialists = [],
      recommendedAction = "",
      durationSeconds = 0,
      status: requestedStatus,
    } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { success: false, error: "Invalid consultation: Stable encounter 'id' is required." },
        { status: 400 }
      );
    }

    const dbClient = getDb();
    if (!dbClient && process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          success: false,
          error: "Database configuration unavailable in production environment.",
          code: "DATABASE_UNCONFIGURED",
        },
        { status: 503 }
      );
    }

    // Clinical signing authority validation:
    // Only clinicians and administrators possess authority to create or transition a consultation to approved.
    const isApprovingRequested = requestedStatus === "approved";
    if (isApprovingRequested && !hasPermission(auth.role, "consultations:approve")) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: id,
        status: "DENIED",
        metadata: {
          reason: "Unauthorized attempt to create or mark consultation as approved without clinical signing authority",
          userRole: auth.role,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Clinical signing authority required to approve medical records. Only clinicians and administrators may sign notes.",
          code: "FORBIDDEN_SIGNING_AUTHORITY",
        },
        { status: 403 }
      );
    }

    // 3. Check for existing consultation (Idempotent persistence & state transition)
    let existingRecord: any = null;
    if (dbClient) {
      try {
        const existingList = await dbClient
          .select()
          .from(consultationsTable)
          .where(eq(consultationsTable.id, id))
          .limit(1);
        if (existingList.length > 0) {
          existingRecord = existingList[0];
        }
      } catch (dbErr) {
        console.error("Neon DB existence check error:", dbErr);
        return NextResponse.json(
          { success: false, error: "Failed to access clinical datastore.", code: "PERSISTENCE_FAILURE" },
          { status: 503 }
        );
      }
    } else {
      existingRecord = memoryConsultations.find((c) => c.id === id);
    }

    // 4. If record exists: verify ownership and perform idempotent update
    if (existingRecord) {
      if (existingRecord.userId !== effectiveUserId && auth.role !== "admin") {
        await logAuditEventAsync({
          actorId: auth.userId,
          actorRole: auth.role,
          action: "ACCESS_DENIED",
          resourceType: "consultation",
          resourceId: id,
          status: "DENIED",
          metadata: {
            reason: "IDOR attempt: User attempted to modify another patient's consultation",
            recordOwner: existingRecord.userId,
            attemptedBy: effectiveUserId,
          },
        });
        return NextResponse.json(
          {
            success: false,
            error: "Forbidden: You are not authorized to update another patient's consultation record.",
            code: "FORBIDDEN",
          },
          { status: 403 }
        );
      }

      // STATE MACHINE RULE 1: Stale Downgrade Rejection
      // If a consultation is already approved, it can NEVER be downgraded to pending review, incomplete intake, or draft.
      if (existingRecord.status === "approved" && requestedStatus && requestedStatus !== "approved") {
        return NextResponse.json(
          {
            success: false,
            error: "Conflict: Consultation record is already approved and signed. Stale draft updates and status downgrades are prohibited.",
            code: "STATUS_CONFLICT",
          },
          { status: 409 }
        );
      }

      // STATE MACHINE RULE 2: Stale Draft Protection on Already Approved Records
      // If the record is already approved, and the incoming request is a delayed retry of an unapproved draft,
      // return the existing approved record idempotently without overwriting signed clinical content.
      if (existingRecord.status === "approved" && !isApprovingRequested) {
        return NextResponse.json({
          success: true,
          consultation: existingRecord,
          isExisting: true,
          message: "Idempotent retry: Existing approved clinical record preserved.",
        });
      }

      // STATE MACHINE RULE 3: Completed Intake Protection
      // A consultation that reached completed_pending_review cannot be downgraded back to in_progress or incomplete_intake
      if (existingRecord.status === "completed_pending_review" && (requestedStatus === "in_progress" || requestedStatus === "incomplete_intake")) {
        return NextResponse.json(
          {
            success: false,
            error: "Conflict: Consultation record is completed and pending review. Cannot downgrade to in-progress or incomplete intake.",
            code: "STATUS_CONFLICT",
          },
          { status: 409 }
        );
      }

      // STATE MACHINE RULE 0: Idempotent Retry Check
      if (body.idempotencyKey && existingRecord.idempotencyKey && body.idempotencyKey === existingRecord.idempotencyKey) {
        return NextResponse.json({
          success: true,
          consultation: existingRecord,
          isExisting: true,
          isIdempotentRetry: true,
        });
      }

      // STATE MACHINE RULE 4: Optimistic Concurrency Check (caseVersion & version)
      const submittedVersion = body.caseVersion !== undefined ? Number(body.caseVersion) : (body.version !== undefined ? Number(body.version) : undefined);
      const existingVersion = existingRecord.caseVersion !== undefined ? Number(existingRecord.caseVersion) : (existingRecord.version !== undefined ? Number(existingRecord.version) : undefined);
      if (submittedVersion !== undefined && existingVersion !== undefined) {
        if (submittedVersion < existingVersion) {
          return NextResponse.json(
            {
              success: false,
              error: `Concurrency conflict: Submitted version (${submittedVersion}) is behind datastore version (${existingVersion}).`,
              code: "CONCURRENCY_CONFLICT",
            },
            { status: 409 }
          );
        }
      }

      const isTransitioningToApproved = isApprovingRequested && existingRecord.status !== "approved";
      const finalStatus = isApprovingRequested ? "approved" : (requestedStatus || existingRecord.status || "completed_pending_review");

      const updateData: any = {
        patientName,
        patientAge: patientAge ? String(patientAge) : existingRecord.patientAge,
        patientGender: patientGender ?? existingRecord.patientGender,
        doctorId,
        doctorName,
        specialty,
        chiefComplaint: chiefComplaint || existingRecord.chiefComplaint,
        transcript: transcript.length > 0 ? transcript : existingRecord.transcript,
        triageLevel: triageLevel || existingRecord.triageLevel,
        triageTitle: triageTitle || existingRecord.triageTitle,
        icd10Codes: icd10Codes.length > 0 ? icd10Codes : existingRecord.icd10Codes,
        detectedSymptoms: detectedSymptoms.length > 0 ? detectedSymptoms : existingRecord.detectedSymptoms,
        soapSubjective: soapSubjective || existingRecord.soapSubjective,
        soapObjective: soapObjective || existingRecord.soapObjective,
        soapAssessment: soapAssessment || existingRecord.soapAssessment,
        soapPlan: soapPlan || existingRecord.soapPlan,
        recommendedSpecialists: recommendedSpecialists.length > 0 ? recommendedSpecialists : existingRecord.recommendedSpecialists,
        recommendedAction: recommendedAction || existingRecord.recommendedAction,
        durationSeconds: durationSeconds || existingRecord.durationSeconds,
        status: finalStatus,
        version: submittedVersion !== undefined ? submittedVersion : (existingRecord.version ? existingRecord.version + 1 : 2),
        caseVersion: submittedVersion !== undefined ? submittedVersion : (existingRecord.caseVersion ? existingRecord.caseVersion + 1 : 2),
        interviewState: body.interviewState !== undefined ? body.interviewState : existingRecord.interviewState,
        deliveredTurnRecords: body.deliveredTurnRecords !== undefined ? body.deliveredTurnRecords : existingRecord.deliveredTurnRecords,
        attributedFacts: body.attributedFacts !== undefined ? body.attributedFacts : existingRecord.attributedFacts,
        unmappedObservations: body.unmappedObservations !== undefined ? body.unmappedObservations : existingRecord.unmappedObservations,
        idempotencyKey: body.idempotencyKey || existingRecord.idempotencyKey,
      };

      if (isTransitioningToApproved) {
        updateData.approvedAt = new Date();
        updateData.approvedBy = auth.userId;
      }

      if (dbClient) {
        try {
          const { version, ...dbUpdateData } = updateData;
          await dbClient
            .update(consultationsTable)
            .set(dbUpdateData)
            .where(
              and(
                eq(consultationsTable.id, id),
                auth.role === "admin" ? undefined : eq(consultationsTable.userId, effectiveUserId)
              )
            );
        } catch (dbErr) {
          console.error("Neon DB update error:", dbErr);
          return NextResponse.json(
            { success: false, error: "Failed to persist consultation update.", code: "PERSISTENCE_FAILURE" },
            { status: 503 }
          );
        }
      } else {
        Object.assign(existingRecord, updateData);
      }

      try {
        await logAuditEventAsync({
          actorId: auth.userId,
          actorRole: auth.role,
          action: isApprovingRequested ? "CONSULTATION_APPROVED" : "CONSULTATION_UPDATED",
          resourceType: "consultation",
          resourceId: id,
          status: "SUCCESS",
          metadata: {
            previousStatus: existingRecord.status,
            newStatus: finalStatus,
            effectiveUserId,
          },
        });
      } catch (auditErr: any) {
        console.error("Critical: Audit ledger write failure during consultation update:", auditErr);
        if (dbClient) {
          try {
            await dbClient
              .update(consultationsTable)
              .set({
                status: existingRecord.status,
                approvedAt: existingRecord.approvedAt || null,
                approvedBy: existingRecord.approvedBy || null,
              })
              .where(eq(consultationsTable.id, id));
          } catch {}
        }
        return NextResponse.json(
          {
            success: false,
            error: "Audit ledger persistence failure. Operation aborted to preserve compliance integrity.",
            code: "AUDIT_FAILURE",
          },
          { status: 500 }
        );
      }

      const updatedRecord = {
        ...existingRecord,
        ...updateData,
      };

      return NextResponse.json({
        success: true,
        consultation: updatedRecord,
        isExisting: true,
      });
    }

    // 5. If record does not exist: perform initial insertion
    const initialStatus = requestedStatus || "completed_pending_review";
    const newRecord = {
      id,
      userId: effectiveUserId,
      patientName,
      patientAge: patientAge ? String(patientAge) : undefined,
      patientGender,
      doctorId,
      doctorName,
      specialty,
      chiefComplaint,
      transcript,
      triageLevel,
      triageTitle,
      icd10Codes,
      detectedSymptoms,
      soapSubjective,
      soapObjective,
      soapAssessment,
      soapPlan,
      recommendedSpecialists,
      recommendedAction,
      durationSeconds,
      status: initialStatus,
      version: body.version !== undefined ? Number(body.version) : 1,
      caseVersion: body.caseVersion !== undefined ? Number(body.caseVersion) : (body.version !== undefined ? Number(body.version) : 1),
      interviewState: body.interviewState || null,
      deliveredTurnRecords: body.deliveredTurnRecords || [],
      attributedFacts: body.attributedFacts || [],
      unmappedObservations: body.unmappedObservations || [],
      idempotencyKey: body.idempotencyKey || null,
      approvedAt: initialStatus === "approved" ? new Date() : null,
      approvedBy: initialStatus === "approved" ? auth.userId : null,
      createdAt: new Date(),
    };

    if (dbClient) {
      try {
        const { version, ...dbRecord } = newRecord;
        await dbClient.insert(consultationsTable).values(dbRecord as any);
      } catch (dbErr: any) {
        const isUniqueViolation =
          dbErr?.code === "23505" ||
          dbErr?.cause?.code === "23505" ||
          dbErr?.message?.toLowerCase().includes("unique") ||
          dbErr?.message?.toLowerCase().includes("duplicate key") ||
          dbErr?.cause?.message?.toLowerCase().includes("unique") ||
          dbErr?.cause?.message?.toLowerCase().includes("duplicate key");

        if (isUniqueViolation) {
          console.log(`Concurrent insert race resolved for encounter ${id}`);
          const reFetched = await dbClient
            .select()
            .from(consultationsTable)
            .where(eq(consultationsTable.id, id))
            .limit(1);
          if (reFetched.length > 0) {
            return NextResponse.json({
              success: true,
              consultation: reFetched[0],
              isExisting: true,
            });
          }
        }
        console.error("Neon DB insert error:", dbErr);
        return NextResponse.json(
          {
            success: false,
            error: "Failed to persist consultation record to primary clinical datastore.",
            code: "PERSISTENCE_FAILURE",
          },
          { status: 503 }
        );
      }
    } else {
      memoryConsultations.push(newRecord);
    }

    try {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: initialStatus === "approved" ? "CONSULTATION_APPROVED" : "CONSULTATION_CREATED",
        resourceType: "consultation",
        resourceId: id,
        status: "SUCCESS",
        metadata: {
          triageLevel,
          specialty,
          effectiveUserId,
          status: initialStatus,
          icd10Count: icd10Codes.length,
        },
      });
    } catch (auditErr: any) {
      console.error("Critical: Audit ledger write failure during initial consultation creation:", auditErr);
      if (dbClient) {
        try {
          await dbClient.delete(consultationsTable).where(eq(consultationsTable.id, id));
        } catch {}
      }
      return NextResponse.json(
        {
          success: false,
          error: "Audit ledger persistence failure. Encounter creation aborted to preserve compliance integrity.",
          code: "AUDIT_FAILURE",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      consultation: newRecord,
      isExisting: false,
    });
  } catch (error: any) {
    console.error("[ConsultationsPostError]", error);
    return NextResponse.json(
      { success: false, error: process.env.NODE_ENV === "production" ? "Failed to record consultation" : (error?.message || "Failed to save consultation") },
      { status: 500 }
    );
  }
}
