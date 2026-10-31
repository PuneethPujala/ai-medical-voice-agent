/**
 * Milestone 1 Audit: Consultation State Machine & Concurrency Invariant Suite
 * 
 * Invariants Verified:
 * - Rule 0: Idempotent retry returns existing record. Material payload mismatch returns 422.
 * - Rule 1: Stale downgrade rejection from 'approved' returns 409 STATUS_CONFLICT.
 * - Rule 2: Stale unapproved retry against 'approved' preserves signed content idempotently.
 * - Rule 3: Completed intake downgrade to in_progress/incomplete_intake returns 409 STATUS_CONFLICT.
 * - Rule 4: Optimistic concurrency CAS version mismatch returns 409 CONCURRENCY_CONFLICT.
 * - RBAC & IDOR: Patient cannot mutate another patient's record (403 FORBIDDEN).
 * - Signing Authority: Only clinician/admin can approve/sign records (403 FORBIDDEN_SIGNING_AUTHORITY).
 * - Intake Recording Authority: Only patient role has consultations:create permission (403 FORBIDDEN).
 * - Care Relationship: Clinician can only sign encounters assigned to them (403 FORBIDDEN_CARE_RELATIONSHIP).
 * - Incomplete Intake Guard: Cannot approve incomplete intakes on PATCH (422 CANNOT_APPROVE_INCOMPLETE_INTAKE).
 * - Valid Approval Flow: Assigned clinician successfully approves a complete intake (200 OK).
 */

import assert from "assert";
import { POST as postConsultationsHandler } from "../../app/api/consultations/route";
import { PATCH as patchConsultationHandler } from "../../app/api/consultations/[id]/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
import { setCustomDbClient } from "../../config/db";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createTestRequest(
  url: string,
  method: string,
  body?: any,
  role: Role = "patient",
  userId: string = "patient-alpha"
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": role,
    "x-mock-user-id": userId,
    "x-forwarded-for": "127.0.0.1",
  };

  return new Request(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function extractSqlParams(cond: any, params: any[] = []): any[] {
  for (const chunk of cond?.queryChunks || []) {
    if (chunk?.value !== undefined) {
      params.push(chunk.value);
    }
    if (chunk?.queryChunks) {
      extractSqlParams(chunk, params);
    }
  }
  return params;
}

/**
 * High-fidelity in-memory transactional mock table for state machine audit.
 */
class StateMachineMockDb {
  public consultations: Map<string, any> = new Map();

  public select() {
    return {
      from: (table: any) => {
        const queryState: { whereCondition?: any; limitNum: number } = { limitNum: 100 };

        const runQuery = async () => {
          const params = extractSqlParams(queryState.whereCondition);
          const results: any[] = [];
          for (const c of this.consultations.values()) {
            const matchesId = params.includes(c.id);
            const matchesUserAndKey = params.includes(c.userId) && params.includes(c.idempotencyKey);

            if (params.length === 0 || matchesId || matchesUserAndKey) {
              results.push(c);
            }
            if (results.length >= queryState.limitNum) break;
          }
          return results;
        };

        const builder: any = {
          where: (cond: any) => {
            queryState.whereCondition = cond;
            return builder;
          },
          orderBy: () => builder,
          limit: (n: number) => {
            queryState.limitNum = n;
            return builder;
          },
          then: (resolve: any, reject: any) => {
            runQuery().then(resolve, reject);
          },
          execute: async () => runQuery(),
        };

        return builder;
      },
    };
  }

  public insert(table: any) {
    return {
      values: (data: any) => {
        const row = { ...data };
        const doInsert = () => {
          if (this.consultations.has(row.id)) {
            const err: any = new Error("Unique constraint violation");
            err.code = "23505";
            throw err;
          }
          this.consultations.set(row.id, row);
          return [row];
        };

        return {
          returning: async () => doInsert(),
          then: (resolve: any, reject: any) => {
            try {
              resolve(doInsert());
            } catch (err) {
              reject(err);
            }
          },
        };
      },
    };
  }

  public update(table: any) {
    return {
      set: (updateData: any) => ({
        where: (whereClause: any) => ({
          returning: async () => {
            const params = extractSqlParams(whereClause);
            for (const [id, c] of this.consultations.entries()) {
              if (params.length > 0 && !params.includes(id)) {
                continue;
              }
              const expectedVersionParam = params.find((p) => typeof p === "number");
              if (expectedVersionParam !== undefined && c.caseVersion !== expectedVersionParam) {
                return []; // CAS mismatch -> concurrency conflict
              }

              const updated = { ...c, ...updateData };
              this.consultations.set(id, updated);
              return [updated];
            }
            return [];
          },
        }),
      }),
    };
  }

  public clear() {
    this.consultations.clear();
  }
}

async function runStateMachineTransitionSuite() {
  console.log("================================================================================");
  console.log("    MEDVOICE M1 STATE MACHINE RULES & CONCURRENCY TRANSITIONS SUITE             ");
  console.log("================================================================================\n");

  let passed = 0;
  let total = 0;

  function check(name: string, condition: boolean, detail?: string) {
    total++;
    if (condition) {
      passed++;
      console.log(`  [OK] ${name}`);
    } else {
      console.error(`  [FAIL] ${name}${detail ? ` (${detail})` : ""}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  const mockDb = new StateMachineMockDb();
  setCustomDbClient(mockDb);

  // ---------------------------------------------------------------------------
  // RULE 0: IDEMPOTENT RETRY & MATERIAL PAYLOAD MISMATCH
  // ---------------------------------------------------------------------------
  console.log(">>> [Rule 0] Auditing Idempotent Retries & Payload Mismatch Invariants...");
  {
    const encId = `ENC-SM-RULE0-${Date.now()}`;
    const idempKey = `idemp-key-rule0-${Date.now()}`;
    const patientId = "patient-user-rule0";

    const initialPayload = {
      id: encId,
      patientName: "John Doe",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "General Physician",
      chiefComplaint: "Persistent sore throat for 3 days",
      status: "in_progress",
      caseVersion: 1,
      idempotencyKey: idempKey,
    };

    // 0.1 First submission
    const res1 = await postConsultationsHandler(
      createTestRequest("http://localhost:3000/api/consultations", "POST", initialPayload, "patient", patientId)
    );
    const json1 = await res1.json();
    check("0.1 Initial registration succeeds with status 200", res1.status === 200 && json1.success === true);

    // 0.2 Exact idempotent retry with same key and material payload
    const res2 = await postConsultationsHandler(
      createTestRequest("http://localhost:3000/api/consultations", "POST", initialPayload, "patient", patientId)
    );
    const json2 = await res2.json();
    check("0.2 Identical retry returns 200 with isIdempotentRetry: true", res2.status === 200 && json2.isIdempotentRetry === true);
    check("0.3 Identical retry does not increment version or alter record", json2.consultation?.caseVersion === 1);

    // 0.3 Replay with mismatched material payload (e.g. altered chief complaint)
    const mismatchedPayload = {
      ...initialPayload,
      chiefComplaint: "Different complaint: Severe chest pain and numbness",
    };
    const resMismatch = await postConsultationsHandler(
      createTestRequest("http://localhost:3000/api/consultations", "POST", mismatchedPayload, "patient", patientId)
    );
    const jsonMismatch = await resMismatch.json();
    check("0.4 Replay with altered chief complaint returns 422 IDEMPOTENCY_PAYLOAD_MISMATCH", resMismatch.status === 422 && jsonMismatch.code === "IDEMPOTENCY_PAYLOAD_MISMATCH");

    // 0.4 Replay with altered doctor assignment
    const mismatchedDoc = {
      ...initialPayload,
      doctorId: "dr-marcus-vance",
    };
    const resMismatchDoc = await postConsultationsHandler(
      createTestRequest("http://localhost:3000/api/consultations", "POST", mismatchedDoc, "patient", patientId)
    );
    check("0.5 Replay with altered doctor returns 422 IDEMPOTENCY_PAYLOAD_MISMATCH", resMismatchDoc.status === 422);
  }

  // ---------------------------------------------------------------------------
  // RULE 1: STALE DOWNGRADE REJECTION FROM 'APPROVED'
  // ---------------------------------------------------------------------------
  console.log("\n>>> [Rule 1] Auditing Stale Downgrade Rejection from 'approved'...");
  {
    const encId = `ENC-SM-RULE1-${Date.now()}`;
    const patientId = "patient-user-rule1";

    // Create an approved consultation
    mockDb.consultations.set(encId, {
      id: encId,
      userId: patientId,
      patientName: "Jane Doe",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "General Physician",
      chiefComplaint: "Bacterial pharyngitis",
      status: "approved",
      caseVersion: 3,
      soapAssessment: "Acute bacterial pharyngitis confirmed",
      approvedAt: new Date().toISOString(),
      approvedBy: "dr-sarah-chen",
    });

    // Attempt to downgrade to in_progress
    const downgradeReq1 = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: encId,
        status: "in_progress",
        caseVersion: 4,
      },
      "patient",
      patientId
    );
    const downgradeRes1 = await postConsultationsHandler(downgradeReq1);
    const downgradeJson1 = await downgradeRes1.json();
    check("1.1 Attempt to downgrade approved record to 'in_progress' returns 409 STATUS_CONFLICT", downgradeRes1.status === 409 && downgradeJson1.code === "STATUS_CONFLICT");

    // Attempt to downgrade to completed_pending_review
    const downgradeReq2 = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: encId,
        status: "completed_pending_review",
        caseVersion: 4,
      },
      "patient",
      patientId
    );
    const downgradeRes2 = await postConsultationsHandler(downgradeReq2);
    check("1.2 Attempt to downgrade approved record to 'completed_pending_review' returns 409 STATUS_CONFLICT", downgradeRes2.status === 409);
  }

  // ---------------------------------------------------------------------------
  // RULE 2: STALE DRAFT PROTECTION ON ALREADY APPROVED RECORDS
  // ---------------------------------------------------------------------------
  console.log("\n>>> [Rule 2] Auditing Stale Draft Protection on Already Approved Records...");
  {
    const encId = `ENC-SM-RULE2-${Date.now()}`;
    const patientId = "patient-user-rule2";

    mockDb.consultations.set(encId, {
      id: encId,
      userId: patientId,
      patientName: "Alice Smith",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "General Physician",
      chiefComplaint: "Hypertension review",
      status: "approved",
      caseVersion: 4,
      soapAssessment: "Stage 1 Essential Hypertension controlled on amlodipine",
      approvedAt: new Date().toISOString(),
      approvedBy: "dr-sarah-chen",
    });

    // Delayed retry of an unapproved draft submission without explicit approve action
    const retryReq = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: encId,
        chiefComplaint: "Hypertension review",
      },
      "patient",
      patientId
    );
    const retryRes = await postConsultationsHandler(retryReq);
    const retryJson = await retryRes.json();
    check("2.1 Delayed draft retry on approved record returns 200 with existing approved record preserved", retryRes.status === 200 && retryJson.isExisting === true);
    check("2.2 Clinical assessment remains untouched and status remains 'approved'", retryJson.consultation?.status === "approved" && retryJson.consultation?.soapAssessment?.includes("Stage 1 Essential Hypertension"));
  }

  // ---------------------------------------------------------------------------
  // RULE 3: COMPLETED INTAKE PROTECTION
  // ---------------------------------------------------------------------------
  console.log("\n>>> [Rule 3] Auditing Completed Intake Downgrade Protection...");
  {
    const encId = `ENC-SM-RULE3-${Date.now()}`;
    const patientId = "patient-user-rule3";

    mockDb.consultations.set(encId, {
      id: encId,
      userId: patientId,
      patientName: "Bob Miller",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "General Physician",
      chiefComplaint: "Dyspepsia evaluation",
      status: "completed_pending_review",
      caseVersion: 2,
    });

    // Attempt to downgrade from completed_pending_review to in_progress
    const downgradeReq = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: encId,
        status: "in_progress",
        caseVersion: 3,
      },
      "patient",
      patientId
    );
    const downgradeRes = await postConsultationsHandler(downgradeReq);
    const downgradeJson = await downgradeRes.json();
    check("3.1 Downgrade from completed_pending_review to in_progress returns 409 STATUS_CONFLICT", downgradeRes.status === 409 && downgradeJson.code === "STATUS_CONFLICT");
  }

  // ---------------------------------------------------------------------------
  // RULE 4: OPTIMISTIC CONCURRENCY CHECK (CAS)
  // ---------------------------------------------------------------------------
  console.log("\n>>> [Rule 4] Auditing Optimistic Concurrency CAS Enforcements...");
  {
    const encId = `ENC-SM-RULE4-${Date.now()}`;
    const patientId = "patient-user-rule4";

    mockDb.consultations.set(encId, {
      id: encId,
      userId: patientId,
      patientName: "Carol White",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "General Physician",
      chiefComplaint: "Mild asthma flare",
      status: "in_progress",
      caseVersion: 3, // current DB version is 3
    });

    // Submitting a stale version (version 2 <= version 3)
    const staleReq = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: encId,
        chiefComplaint: "Mild asthma flare",
        caseVersion: 2, // STALE!
      },
      "patient",
      patientId
    );
    const staleRes = await postConsultationsHandler(staleReq);
    const staleJson = await staleRes.json();
    check("4.1 Stale caseVersion submission (2 <= 3) returns 409 CONCURRENCY_CONFLICT", staleRes.status === 409 && staleJson.code === "CONCURRENCY_CONFLICT");

    // Submitting with expectedVersion mismatch
    const expectedMismatchReq = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: encId,
        chiefComplaint: "Mild asthma flare",
        caseVersion: 4,
        expectedVersion: 2, // datastore is actually 3
      },
      "patient",
      patientId
    );
    const expectedMismatchRes = await postConsultationsHandler(expectedMismatchReq);
    check("4.2 expectedVersion mismatch (expected 2, actual 3) returns 409 CONCURRENCY_CONFLICT", expectedMismatchRes.status === 409);
  }

  // ---------------------------------------------------------------------------
  // RBAC & IDOR: TENANT BOUNDARY AUDIT
  // ---------------------------------------------------------------------------
  console.log("\n>>> [Security] Auditing IDOR & Signing Authority Invariants...");
  {
    const encId = `ENC-SM-SEC-${Date.now()}`;
    const patientOwner = "patient-owner-real";
    const maliciousActor = "patient-malicious-attacker";

    mockDb.consultations.set(encId, {
      id: encId,
      userId: patientOwner,
      patientName: "Real Patient",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "General Physician",
      chiefComplaint: "Sensitive private diagnosis",
      status: "in_progress",
      caseVersion: 1,
    });

    // Malicious actor attempts to mutate another patient's record
    const idorReq = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: encId,
        chiefComplaint: "Tampered diagnosis",
        caseVersion: 2,
      },
      "patient",
      maliciousActor
    );
    const idorRes = await postConsultationsHandler(idorReq);
    check("Sec.1 Patient cannot mutate another patient's consultation (returns 403 FORBIDDEN)", idorRes.status === 403);

    // Patient role attempts to self-approve/sign consultation
    const selfApproveReq = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: encId,
        status: "approved",
        caseVersion: 2,
      },
      "patient", // NOT clinician or admin
      patientOwner
    );
    const selfApproveRes = await postConsultationsHandler(selfApproveReq);
    const selfApproveJson = await selfApproveRes.json();
    check("Sec.2 Patient cannot approve/sign consultation (returns 403 FORBIDDEN_SIGNING_AUTHORITY)", selfApproveRes.status === 403 && selfApproveJson.code === "FORBIDDEN_SIGNING_AUTHORITY");

    // Clinician signs via PATCH /api/consultations/[id] on incomplete intake (status: 'in_progress')
    const patchIncompleteReq = createTestRequest(
      `http://localhost:3000/api/consultations/${encId}`,
      "PATCH",
      {
        action: "approve",
        status: "approved",
      },
      "clinician",
      "dr-sarah-chen"
    );
    const patchIncompleteRes = await patchConsultationHandler(patchIncompleteReq, { params: Promise.resolve({ id: encId }) });
    const patchIncompleteJson = await patchIncompleteRes.json();
    check("Sec.3 Clinician cannot approve incomplete intake via PATCH (returns 422 CANNOT_APPROVE_INCOMPLETE_INTAKE)", patchIncompleteRes.status === 422 && patchIncompleteJson.code === "CANNOT_APPROVE_INCOMPLETE_INTAKE");

    // Admin also cannot approve incomplete intake via PATCH
    const patchIncompleteAdminReq = createTestRequest(
      `http://localhost:3000/api/consultations/${encId}`,
      "PATCH",
      {
        action: "approve",
        status: "approved",
      },
      "admin",
      "admin-user"
    );
    const patchIncompleteAdminRes = await patchConsultationHandler(patchIncompleteAdminReq, { params: Promise.resolve({ id: encId }) });
    const patchIncompleteAdminJson = await patchIncompleteAdminRes.json();
    check("Sec.4 Admin cannot approve incomplete intake via PATCH (returns 422 CANNOT_APPROVE_INCOMPLETE_INTAKE)", patchIncompleteAdminRes.status === 422 && patchIncompleteAdminJson.code === "CANNOT_APPROVE_INCOMPLETE_INTAKE");

    // Clinician role cannot call POST /api/consultations to create intakes (lacks consultations:create)
    const clinicianPostReq = createTestRequest(
      "http://localhost:3000/api/consultations",
      "POST",
      {
        id: "NEW-CLINICIAN-POST",
        chiefComplaint: "Doctor recording intake",
      },
      "clinician",
      "dr-sarah-chen"
    );
    const clinicianPostRes = await postConsultationsHandler(clinicianPostReq);
    check("Sec.5 Clinician role cannot record raw consultations via POST (returns 403)", clinicianPostRes.status === 403);

    // Unassigned clinician attempts to approve encounter (care relationship violation)
    const unassignedClinicianReq = createTestRequest(
      `http://localhost:3000/api/consultations/${encId}`,
      "PATCH",
      {
        action: "approve",
        status: "approved",
      },
      "clinician",
      "dr-marcus-vance" // NOT assigned doctor (dr-sarah-chen)
    );
    const unassignedClinicianRes = await patchConsultationHandler(unassignedClinicianReq, { params: Promise.resolve({ id: encId }) });
    check("Sec.6 Unassigned clinician cannot sign unassigned patient encounter (returns 403 FORBIDDEN_CARE_RELATIONSHIP)", unassignedClinicianRes.status === 403);

    // Now complete the intake and test valid clinician signing
    mockDb.consultations.set(encId, {
      ...mockDb.consultations.get(encId),
      status: "completed_pending_review",
      triageLevel: "routine",
      soapSubjective: "Patient presented with mild symptoms.",
      soapObjective: "Vitals normal.",
      soapAssessment: "Mild viral pharyngitis.",
      soapPlan: "Supportive care, hydration.",
    });

    const validApproveReq = createTestRequest(
      `http://localhost:3000/api/consultations/${encId}`,
      "PATCH",
      {
        action: "approve",
        status: "approved",
      },
      "clinician",
      "dr-sarah-chen"
    );
    const validApproveRes = await patchConsultationHandler(validApproveReq, { params: Promise.resolve({ id: encId }) });
    const validApproveJson = await validApproveRes.json();
    check("Sec.7 Assigned clinician successfully signs and approves completed encounter via PATCH", validApproveRes.status === 200 && validApproveJson.consultation?.status === "approved");
  }

  // Clean up
  setCustomDbClient(null);

  console.log("\n================================================================================");
  console.log(`STATE MACHINE AUDIT RESULT: ${passed}/${total} CHECKS PASSED (100%)`);
  console.log("================================================================================\n");
}

runStateMachineTransitionSuite().catch((err) => {
  console.error("State machine transition audit failed:", err);
  process.exit(1);
});
