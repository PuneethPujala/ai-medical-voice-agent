import fs from "fs";
import path from "path";
import {
  ClinicalPassage,
  KnowledgeContext,
  ClinicalDomain,
  ClinicalSection,
  AuthorityTier,
  MedicationTaskType,
  MedicationQueryResult,
  ContextAwareQuery,
  PopulationTag,
} from "./types";
import { CURATED_GUIDELINES } from "./guidelines";
import { normalizeClinicalSymptoms } from "./synonyms";
import { getDb } from "@/config/db";
import { clinicalKnowledgePassagesTable } from "@/config/schema";
import { or, ilike } from "drizzle-orm";

function computeCosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  if (nA === 0 || nB === 0) return 0;
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

let cachedPassages: ClinicalPassage[] | null = null;

const AUTHORITY_PRIORITY: Record<AuthorityTier, number> = {
  deterministic_safety: 100,
  clinical_guideline: 80,
  national_guideline: 75,
  government_reference: 60,
  medication_label: 55,
  medication_identity: 50,
  regulatory_adverse: 45,
  peer_reviewed_evidence: 40,
};

function inferDomainFromTopic(topicTitle: string, content: string): ClinicalDomain {
  const text = (topicTitle + " " + content).toLowerCase();
  if (/\b(heart|cardiac|coronary|chest pain|angina|arrhythmia|hypertension|cholesterol|atherosclerosis|myocardial)\b/.test(text)) return "cardiology";
  if (/\b(stroke|brain|neurolog|headache|seizure|paralysis|tia|dementia|epilepsy|neuropathy|migraine)\b/.test(text)) return "neurology";
  if (/\b(pediatric|child|infant|newborn|baby|neonatal|toddler)\b/.test(text)) return "pediatrics";
  if (/\b(stomach|abdom|gastro|intestin|bowel|colon|liver|hepat|pancrea|gerd|ulcer|diarrhea|constipation|gall)\b/.test(text)) return "gastroenterology";
  if (/\b(lung|pulmon|asthma|bronch|pneumonia|copd|respiratory|wheez)\b/.test(text)) return "pulmonology";
  if (/\b(diabetes|thyroid|endocrin|insulin|hormone|pituitary|adrenal|metabol)\b/.test(text)) return "endocrinology";
  if (/\b(infection|bacteria|virus|fungal|antibiotic|sepsis|hiv|tuberculosis|malaria|hepatitis)\b/.test(text)) return "infectious_disease";
  if (/\b(pregnan|obstetric|gynecol|menstrual|ovarian|uterine|cervical|fertility)\b/.test(text)) return "obstetrics_gynecology";
  if (/\b(bone|joint|fracture|arthritis|spine|orthoped|musculoskeletal|tendon|ligament)\b/.test(text)) return "orthopedics";
  if (/\b(skin|dermat|rash|eczema|psoriasis|acne|melanoma|wound)\b/.test(text)) return "dermatology";
  if (/\b(mental|depress|anxiety|psychiatric|bipolar|schizophren|ptsd|ocd|panic)\b/.test(text)) return "psychiatry";
  if (/\b(ear|nose|throat|sinus|tonsil|laryn|pharyn|hearing|tinnitus)\b/.test(text)) return "ent";
  if (/\b(drug|medication|prescription|dose|contraindic|pharma)\b/.test(text)) return "medications";
  if (/\b(emergency|trauma|resuscit|cpr|first aid|poison|overdose|burn)\b/.test(text)) return "emergency_medicine";
  return "general";
}

function loadAllPassages(): ClinicalPassage[] {
  if (cachedPassages) return cachedPassages;

  const passages: ClinicalPassage[] = [...CURATED_GUIDELINES];

  const passagesPath = path.join(process.cwd(), "data", "medlineplus", "processed", "passages.jsonl");
  if (fs.existsSync(passagesPath)) {
    try {
      const lines = fs.readFileSync(passagesPath, "utf-8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        // Prefer pre-tagged domain from ingestion pipeline; fall back to runtime inference
        const domain = (parsed.domain as ClinicalDomain) || inferDomainFromTopic(parsed.title, parsed.content);
        passages.push({
          id: parsed.id,
          topicId: parsed.topicId,
          title: parsed.title,
          section: parsed.section as ClinicalSection,
          source: parsed.source || "MedlinePlus",
          sourceUrl: parsed.sourceUrl,
          releaseDate: parsed.releaseDate || "2026-09-05",
          authority: parsed.authority || "government_reference",
          domain,
          content: parsed.content,
          keyTerms: parsed.keyTerms || [],
          // Phase 1: Population & context metadata from enriched ingestion pipeline
          population: parsed.population || undefined,
          acuity: parsed.acuity || undefined,
          conditions: parsed.conditions || undefined,
          country: parsed.country || undefined,
          sourceType: parsed.sourceType || undefined,
        });
      }
    } catch (err) {
      console.warn("[Retriever] Error reading MedlinePlus passages.jsonl:", err);
    }
  }

  cachedPassages = passages;
  return passages;
}

export class ClinicalKnowledgeRetriever {
  private passages: ClinicalPassage[];

  constructor() {
    this.passages = loadAllPassages();
  }

  public resolveCitation(passageId: string): ClinicalPassage | null {
    return this.passages.find((p) => p.id === passageId) || null;
  }

  public queryMedicationTask(drugName: string, task: MedicationTaskType): MedicationQueryResult {
    const cleanDrug = drugName.toLowerCase().trim();
    let targetAuthority: AuthorityTier = "medication_label";
    let primarySource: "RxNorm" | "DailyMed" | "openFDA" = "DailyMed";

    if (task === "identity") {
      targetAuthority = "medication_identity";
      primarySource = "RxNorm";
    } else if (task === "contraindication") {
      targetAuthority = "medication_label";
      primarySource = "DailyMed";
    } else if (task === "adverse_event") {
      targetAuthority = "regulatory_adverse";
      primarySource = "openFDA";
    }

    const matches = this.passages.filter((p) => {
      if (p.domain !== "medications") return false;
      const text = (p.title + " " + p.content + " " + p.keyTerms.join(" ")).toLowerCase();
      const hasDrug = text.includes(cleanDrug);
      return hasDrug && p.authority === targetAuthority;
    });

    const findings = matches.map((m) => m.content);

    return {
      task,
      primarySource,
      drugName,
      findings,
      passages: matches,
    };
  }

  public retrieveKnowledge(
    query: string,
    domain?: ClinicalDomain,
    options: {
      topK?: number;
      targetSection?: ClinicalSection;
      minScore?: number;
    } = {}
  ): KnowledgeContext {
    return this.retrieveWithContext({
      query,
      domain,
      targetSection: options.targetSection,
      topK: options.topK,
      minScore: options.minScore,
    });
  }

  public retrieveWithContext(ctx: ContextAwareQuery): KnowledgeContext {
    const topK = ctx.topK || 4;
    // Clinical concept normalization (multilingual & colloquial mapping)
    const normalized = normalizeClinicalSymptoms(ctx.query);
    const cleanQuery = normalized.normalizedQuery.toLowerCase().trim();
    const queryTokens = cleanQuery
      .split(/[^a-z0-9-]+/)
      .filter((t) => t.length > 2);

    const isAcuteSymptomQuery =
      /sudden|acute|crushing|pressure|radiat|droop|weakness|numb|speech|fever|lethargy|grunting|pain|bleed|vomit/i.test(
        cleanQuery
      );
    const isDiagnosisQuery = /diagnos|test|workup|criteria|score/i.test(cleanQuery);
    const isPreventionQuery = /prevent|lifestyle|diet|exercise/i.test(cleanQuery);

    const patient = ctx.patient;
    const encounter = ctx.encounter;
    const isPediatricPatient =
      patient &&
      (patient.ageGroup === "neonate" ||
        patient.ageGroup === "infant" ||
        patient.ageGroup === "pediatric" ||
        (typeof patient.age === "number" && patient.age < 18));
    const isElderlyPatient =
      patient &&
      (patient.ageGroup === "older_adult" ||
        (typeof patient.age === "number" && patient.age >= 65));
    const isPregnant = patient && patient.pregnancyStatus === "pregnant";

    const scored = this.passages.map((passage) => {
      let score = 0;
      const titleLower = passage.title.toLowerCase();
      const contentLower = passage.content.toLowerCase();

      // 1. Lexical Exact Matches
      if (titleLower.includes(cleanQuery)) score += 35;
      if (cleanQuery.includes(titleLower)) score += 25;

      for (const token of queryTokens) {
        if (titleLower.includes(token)) score += 10;
        if (passage.keyTerms.some((k) => k.includes(token))) score += 5;
        if (contentLower.includes(token)) score += 2;
      }

      // 2. Domain Alignment
      // Invariant: Matching domain receives a boost; non-matching domains are NOT penalized (-10 removed)
      // to avoid suppressing valid cross-specialty differentials (e.g. GERD vs angina in chest pain)
      if (ctx.domain && ctx.domain !== "general") {
        if (passage.domain === ctx.domain) {
          score += 15;
        }
      }

      // 3. Section-Aware Boosting
      if (ctx.targetSection) {
        if (passage.section === ctx.targetSection) {
          score += 25;
        }
      } else {
        if (isAcuteSymptomQuery) {
          if (passage.section === "symptoms") score *= 1.8;
          else if (passage.section === "emergency_guidance") score *= 2.0;
          else if (passage.section === "prevention") score *= 0.4;
          else if (passage.section === "overview") score *= 1.1;
        } else if (isDiagnosisQuery) {
          if (passage.section === "diagnosis") score *= 2.0;
        } else if (isPreventionQuery) {
          if (passage.section === "prevention") score *= 2.0;
        }
      }

      // 4. Authority Multi-Tier Weighting
      const authorityWeight = AUTHORITY_PRIORITY[passage.authority] || 50;
      score += (authorityWeight / 100) * 8;

      // 5. Population-Aware Scoring
      if (patient) {
        const passagePop = passage.population || [];
        const isPediatricPassage =
          passagePop.some((p) => p === "pediatric" || p === "infant" || p === "neonate") ||
          passage.domain === "pediatrics" ||
          /\b(pediatric|child|infant|baby|newborn|toddler)\b/i.test(passage.title);

        if (isPediatricPatient) {
          if (isPediatricPassage) {
            score += 25;
          } else if (
            passagePop.length === 1 &&
            (passagePop.includes("adult") || passagePop.includes("older_adult"))
          ) {
            score -= 15;
          }
        } else {
          // Non-pediatric patient: penalize exclusively pediatric content
          if (isPediatricPassage && !passagePop.includes("adult")) {
            score -= 20;
          }
        }

        if (isElderlyPatient) {
          if (
            passagePop.includes("older_adult") ||
            /\b(geriatric|elderly|older adult)\b/i.test(contentLower)
          ) {
            score += 15;
          }
        }

        if (isPregnant) {
          if (
            passagePop.includes("pregnant") ||
            /\b(pregnant|pregnancy|prenatal|gestational)\b/i.test(passage.title) ||
            /\b(pregnancy|pregnant|fetal|teratogen)\b/i.test(contentLower)
          ) {
            score += 25;
          }
        }
      }

      // 6. Known Conditions & Comorbidity Context
      // Boosts evidence matching chronic diseases (e.g. peptic ulcer, asthma, diabetes)
      // Note: Allergy, pregnancy teratogenicity, and drug-drug interactions are strictly evaluated
      // by evaluatePharmacologySafetyShield() in the Deterministic Safety Arbiter to prevent
      // surfacing contraindication passages as treatment recommendations.
      if (patient?.knownConditions && patient.knownConditions.length > 0) {
        for (const cond of patient.knownConditions) {
          const cleanCond = cond.toLowerCase().replace(/_/g, " ");
          if (
            titleLower.includes(cleanCond) ||
            contentLower.includes(cleanCond) ||
            passage.conditions?.some((c) => c.toLowerCase().includes(cleanCond))
          ) {
            score += 14;
          }
        }
      }

      // 9. Acuity Level Modulation
      if (isAcuteSymptomQuery || (encounter?.severity && /^[7-9]|10/i.test(encounter.severity))) {
        if (passage.acuity?.includes("emergent") || passage.section === "emergency_guidance") {
          score += 20;
        } else if (passage.section === "symptoms") {
          score += 12;
        } else if (passage.section === "overview") {
          score -= 6;
        }
        if (passage.acuity?.includes("preventive") || passage.section === "prevention") {
          score -= 10;
        }
      }

      return {
        ...passage,
        relevanceScore: Math.round(score * 10) / 10,
      };
    });

    // Sort by relevance score descending, breaking ties by authority tier
    scored.sort((a, b) => {
      if ((b.relevanceScore || 0) !== (a.relevanceScore || 0)) {
        return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      }
      return (AUTHORITY_PRIORITY[b.authority] || 0) - (AUTHORITY_PRIORITY[a.authority] || 0);
    });

    const minScore = ctx.minScore || 5;
    const filtered = scored.filter((p) => (p.relevanceScore || 0) >= minScore);
    const topPassages = filtered.slice(0, topK);

    return {
      retrievedAt: new Date().toISOString(),
      query: ctx.query,
      domain: ctx.domain || "general",
      passages: topPassages,
      authorityHierarchyApplied: true,
      patientContextApplied: Boolean(patient || encounter),
    };
  }

  /**
   * Evaluates the open-world evidence situation across the three defined clinical modes:
   * Situation A: Relevant Evidence Retrieved (RAG provides high-confidence guidance)
   * Situation B: Weak or Irrelevant Evidence (Honest uncertainty, gather basic context)
   * Situation C: Serious Concern Emerges Without Specific Rule (Preserve concern, no down-triage, route safely)
   */
  public evaluateEvidenceSituation(
    query: string,
    isSeriousCandidate = false
  ): {
    situation: "SITUATION_A_RELEVANT" | "SITUATION_B_WEAK" | "SITUATION_C_SERIOUS_UNCLASSIFIED";
    passages: ClinicalPassage[];
    conversationalGuidance: string;
  } {
    const res = this.retrieveKnowledge(query, undefined, { topK: 3, minScore: 10 });
    const topPassage = res.passages[0];
    const hasHighRelevance = Boolean(topPassage && (topPassage.relevanceScore || 0) >= 42);

    // Situation C: Serious unclassified symptom without specific registry match
    if (isSeriousCandidate || /\b(collapse|passed out|blacked out|severe sudden|unbearable|can barely stand|cannot breathe)\b/i.test(query)) {
      return {
        situation: "SITUATION_C_SERIOUS_UNCLASSIFIED",
        passages: res.passages,
        conversationalGuidance: "Preserve the serious concern in state. False reassurance and down-triage are strictly prohibited. Ask safe clarifying questions regarding functional stability and timeline, and direct to clinician-approved urgent medical evaluation or emergency care."
      };
    }

    // Situation A: High-relevance evidence retrieved
    if (hasHighRelevance) {
      return {
        situation: "SITUATION_A_RELEVANT",
        passages: res.passages,
        conversationalGuidance: `Incorporate retrieved clinical evidence from [${topPassage.title}]. Ask focused, proportionate follow-up questions to explore the differential without asserting a definitive diagnosis.`
      };
    }

    // Situation B: Inconclusive / weak evidence retrieved
    return {
      situation: "SITUATION_B_WEAK",
      passages: [],
      conversationalGuidance: "Clinical evidence retrieval is inconclusive. Acknowledge uncertainty honestly: gather foundational clinical context (onset timeline, duration, constant vs intermittent, functional impact, and associated sensations) without pretending evidence supports any diagnosis."
    };
  }

  /**
   * Primary Database Path:
   * When DATABASE_URL is configured, queries clinicalKnowledgePassagesTable using Drizzle ORM
   * with lexical matching, synonym expansion, and optional vector cosine similarity.
   */
  public async retrieveFromDatabase(
    ctx: ContextAwareQuery,
    queryEmbedding?: number[]
  ): Promise<ClinicalPassage[] | null> {
    if (!process.env.DATABASE_URL) return null;
    const dbClient = getDb();
    if (!dbClient) return null;

    try {
      const normalized = normalizeClinicalSymptoms(ctx.query);
      const cleanQuery = normalized.normalizedQuery.toLowerCase().trim();
      const tokens = cleanQuery.split(/[^a-z0-9-]+/).filter((t) => t.length > 2);
      if (tokens.length === 0) return null;

      const conditions = tokens.slice(0, 5).map((tok) =>
        or(
          ilike(clinicalKnowledgePassagesTable.title, `%${tok}%`),
          ilike(clinicalKnowledgePassagesTable.text, `%${tok}%`)
        )
      );

      const dbRows = await dbClient
        .select()
        .from(clinicalKnowledgePassagesTable)
        .where(or(...conditions))
        .limit(20);

      if (!dbRows || dbRows.length === 0) return null;

      const passages: ClinicalPassage[] = dbRows.map((row) => {
        const titleLower = row.title.toLowerCase();
        const textLower = row.text.toLowerCase();
        let score = 0;

        if (titleLower.includes(cleanQuery)) score += 35;
        if (cleanQuery.includes(titleLower)) score += 25;

        for (const t of tokens) {
          if (titleLower.includes(t)) score += 10;
          if (textLower.includes(t)) score += 2;
          if (row.keywords && row.keywords.some((k) => k.toLowerCase().includes(t))) score += 5;
        }

        // Vector cosine similarity integration if embeddings are present
        if (queryEmbedding && row.embedding && Array.isArray(row.embedding)) {
          const cosSim = computeCosineSimilarity(queryEmbedding, row.embedding);
          score += cosSim * 40;
        }

        const domain = inferDomainFromTopic(row.title, row.text);

        return {
          id: row.passageId,
          topicId: row.topicId,
          title: row.title,
          section: (row.section as ClinicalSection) || "overview",
          source: "MedlinePlus (PostgreSQL)",
          sourceUrl: row.url || undefined,
          releaseDate: row.updatedAt ? new Date(row.updatedAt).toISOString().split("T")[0] : "2026-09-05",
          authority: "government_reference" as AuthorityTier,
          domain,
          content: row.text,
          keyTerms: row.keywords || [],
          relevanceScore: Math.round(score * 10) / 10,
        };
      });

      passages.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      return passages;
    } catch (err) {
      console.warn("[Retriever] Database query fallback to local index:", (err as any)?.message || err);
      return null;
    }
  }

  /**
   * Hybrid Dual-Path Retrieval:
   * Queries PostgreSQL clinicalKnowledgePassagesTable first when available.
   * If database query returns results, incorporates them; otherwise seamlessly falls back to
   * the local zero-config MedlinePlus index.
   */
  public async retrieveHybrid(
    ctx: ContextAwareQuery,
    queryEmbedding?: number[]
  ): Promise<KnowledgeContext> {
    const dbPassages = await this.retrieveFromDatabase(ctx, queryEmbedding);
    if (dbPassages && dbPassages.length > 0) {
      const minScore = ctx.minScore || 5;
      const topK = ctx.topK || 4;
      const filtered = dbPassages.filter((p) => (p.relevanceScore || 0) >= minScore).slice(0, topK);
      if (filtered.length > 0) {
        return {
          retrievedAt: new Date().toISOString(),
          query: ctx.query,
          domain: ctx.domain || "general",
          passages: filtered,
          authorityHierarchyApplied: true,
          patientContextApplied: Boolean(ctx.patient || ctx.encounter),
        };
      }
    }

    // Seamless zero-config local fallback
    return this.retrieveWithContext(ctx);
  }
}

export const clinicalKnowledgeRetriever = new ClinicalKnowledgeRetriever();
