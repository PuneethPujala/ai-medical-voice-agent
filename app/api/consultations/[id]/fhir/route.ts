import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { eq } from "drizzle-orm";
import { generateFHIRBundle, ConsultationRecordFHIR, validateFhirR4Bundle } from "@/lib/fhir/bundle";
import { memoryConsultations } from "../../route";
import { getAuthContext, hasPermission } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id } = await params;

    // 1. Enforce Authentication (401 for unauthenticated requests unless in test/demo mode)
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      await logAuditEventAsync({
        actorId: "unauthenticated",
        actorRole: "patient",
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: id,
        status: "DENIED",
        metadata: { reason: "Unauthenticated request attempted to export FHIR bundle", format: "fhir_r4_bundle" },
      });

      return NextResponse.json(
        {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "error",
              code: "login",
              diagnostics: "Unauthorized: Authentication required to export clinical FHIR R4 documents.",
            },
          ],
        },
        {
          status: 401,
          headers: {
            "Content-Type": "application/fhir+json; charset=utf-8",
            "X-FHIR-Version": "4.0.1",
          },
        }
      );
    }

    // 2. Fetch record from Neon DB
    let record: any = null;
    const dbClient = getDb();
    let dbError: any = null;

    if (dbClient) {
      try {
        const records = await dbClient
          .select()
          .from(consultationsTable)
          .where(eq(consultationsTable.id, id))
          .limit(1);

        if (records.length > 0) {
          record = records[0];
        }
      } catch (err) {
        dbError = err;
        console.error("DB lookup error for FHIR export:", err);
      }
    }

    // In production, database failure must never fall back to synthetic clinical records
    if (process.env.NODE_ENV === "production") {
      if (dbError || !dbClient) {
        return NextResponse.json(
          {
            resourceType: "OperationOutcome",
            issue: [
              {
                severity: "fatal",
                code: "transient",
                diagnostics: "EHR datastore unavailable. Database connection could not be established.",
              },
            ],
          },
          {
            status: 503,
            headers: {
              "Content-Type": "application/fhir+json; charset=utf-8",
              "X-FHIR-Version": "4.0.1",
            },
          }
        );
      }
      if (!record) {
        return NextResponse.json(
          {
            resourceType: "OperationOutcome",
            issue: [
              {
                severity: "error",
                code: "not-found",
                diagnostics: `Consultation with ID ${id} was not found in the EHR repository.`,
              },
            ],
          },
          {
            status: 404,
            headers: {
              "Content-Type": "application/fhir+json; charset=utf-8",
              "X-FHIR-Version": "4.0.1",
            },
          }
        );
      }
    }

    // Fallback to memory store strictly for development and test environments
    if (!record) {
      const mem = memoryConsultations.find((c) => c.id === id);
      if (mem) {
        record = mem;
      }
    }

    if (!record) {
      return NextResponse.json(
        {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "error",
              code: "not-found",
              diagnostics: `Consultation with ID ${id} was not found in the EHR repository.`,
            },
          ],
        },
        {
          status: 404,
          headers: {
            "Content-Type": "application/fhir+json; charset=utf-8",
            "X-FHIR-Version": "4.0.1",
          },
        }
      );
    }

    // 3. Ownership & IDOR Protection:
    // Patients can only export their own health records (record.userId === auth.userId).
    // Platform administrators have authority to inspect/export records for governance.
    const isOwner = record.userId === auth.userId || (auth.isDemoMode && (record.userId === "anon-user" || record.userId === auth.userId));
    const isAdmin = auth.role === "admin";

    if (!isOwner && !isAdmin) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: id,
        status: "DENIED",
        metadata: {
          reason: "IDOR prevention: Patient attempted to export another patient's FHIR record",
          recordOwnerId: record.userId,
          attemptedBy: auth.userId,
          format: "fhir_r4_bundle",
        },
      });

      return NextResponse.json(
        {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "error",
              code: "forbidden",
              diagnostics: "Forbidden: You are only authorized to export your own clinical records.",
            },
          ],
        },
        {
          status: 403,
          headers: {
            "Content-Type": "application/fhir+json; charset=utf-8",
            "X-FHIR-Version": "4.0.1",
          },
        }
      );
    }

    // 4. Generate valid HL7 FHIR R4 Bundle
    const consultationRecord: ConsultationRecordFHIR = {
      ...record,
      audioMetrics: record.audioMetrics || record.interviewState?.audio_metrics,
      speechFeatures: record.speechFeatures || record.interviewState?.speech_features,
    };
    const bundle = generateFHIRBundle(consultationRecord);

    // 4b. Deterministic HL7 FHIR R4 structural & cardinality validation
    const validationResult = validateFhirR4Bundle(bundle as unknown as Record<string, unknown>);
    if (!validationResult.valid) {
      console.error("[FHIRValidationError] Generated bundle failed FHIR R4 validation:", validationResult.issues);
      return NextResponse.json(
        {
          resourceType: "OperationOutcome",
          issue: validationResult.issues.map((i) => ({
            severity: i.severity === "error" ? "fatal" : "warning",
            code: "structure",
            diagnostics: `${i.location}: ${i.diagnostics}`,
          })),
        },
        {
          status: 500,
          headers: {
            "Content-Type": "application/fhir+json; charset=utf-8",
            "X-FHIR-Version": "4.0.1",
          },
        }
      );
    }

    // 5. Durably log PHI export event in tamper-evident SHA-256 audit ledger
    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "CONSULTATION_ACCESSED",
      resourceType: "consultation",
      resourceId: id,
      status: "SUCCESS",
      metadata: {
        format: "fhir_r4_bundle",
        bundleId: bundle.id,
        patientName: record.patientName,
        triageLevel: record.triageLevel,
        totalEntries: bundle.entry?.length || 0,
      },
    });

    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/fhir+json; charset=utf-8",
        "X-FHIR-Version": "4.0.1",
        "Content-Disposition": `attachment; filename="fhir-bundle-${id}.json"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (error: any) {
    console.error("[FHIRSerializationError]", error);
    return NextResponse.json(
      {
        resourceType: "OperationOutcome",
        issue: [
          {
            severity: "fatal",
            code: "exception",
            diagnostics: process.env.NODE_ENV === "production" ? "Internal server error during clinical FHIR bundle serialization." : (error?.message || "Internal server error during FHIR bundle serialization."),
          },
        ],
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/fhir+json; charset=utf-8",
        },
      }
    );
  }
}

