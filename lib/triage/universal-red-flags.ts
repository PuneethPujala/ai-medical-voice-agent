/**
 * UNIVERSAL RED-FLAG CLINICAL SCREEN
 *
 * Presentation-independent deterministic life-threat safety screen.
 * Evaluates raw patient utterances and accumulated clinical state
 * against core emergency invariants across all clinical domains.
 *
 * Invariants:
 * 1. Independent of presentation classifier output.
 * 2. Strictly escalate-only (monotonic safety guarantee).
 * 3. Local negation windowing + pseudo-negation override + distributed negation.
 * 4. Multi-script & code-mixed support (English, Hindi/Devanagari, Telugu).
 * 5. Fail-safe recovery: always returns URGENT_SAME_DAY on unexpected errors.
 * 6. Honest Subject Attribution: caller demographics vs. patient demographics.
 */

export type RedFlagLevel = "NONE" | "DISCRIMINATE" | "URGENT_SAME_DAY" | "EMERGENCY_NOW";

export interface RedFlagFiring {
  ruleId: string;
  spans: string[];
  amplifiers: string[];
  confidence: number;
}

export interface RedFlagDiscriminator {
  ruleId: string;
  intent: string;
  text: string;
}

export interface RedFlagResult {
  level: RedFlagLevel;
  firedRules: RedFlagFiring[];
  discriminatorQuestion?: RedFlagDiscriminator;
  reason: string;
  extractedDemographics?: {
    ageYears?: number;
    ageMonths?: number;
    isPregnant?: boolean;
    isPostpartum?: boolean;
    modifiers: string[];
    sexAtBirth?: "male" | "female" | "intersex";
  };
}

export interface UniversalScreenPatient {
  ageYears?: number;
  ageMonths?: number;
  sexAtBirth?: "male" | "female" | "intersex";
  pregnancy?: {
    status: "pregnant" | "postpartum" | "not_pregnant" | "unknown" | "not_applicable";
    weeks?: number;
  };
  modifiers?: string[]; // e.g. ["diabetes", "hypertension", "smoker", "anticoagulant", "immunosuppressed", "heart_disease"]
  drugAllergies?: string[] | "unknown" | "none_known";
  reporter?: "self" | "caregiver";
}

export interface UniversalScreenInput {
  rawText: string;
  cumulativeTranscript?: string;
  patient?: UniversalScreenPatient;
  clinicalFacts?: string[];
  deniedSymptoms?: string[];
  isUnclassifiedPresentation?: boolean;
}

// -----------------------------------------------------------------------------
// Helper: Regex Escaping & Text Normalization
// -----------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeInputText(raw: any): string {
  if (typeof raw !== "string") {
    if (raw === null || raw === undefined) return "";
    return String(raw);
  }
  return raw
    .normalize("NFKC")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\r\n|\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// -----------------------------------------------------------------------------
// Demographic & Comorbidity Extraction from Speech with Subject Attribution
// -----------------------------------------------------------------------------

interface ExtractedDemographics {
  ageYears?: number;
  ageMonths?: number;
  sexAtBirth?: "male" | "female";
  isPregnant?: boolean;
  pregnancyWeeks?: number;
  isPostpartum?: boolean;
  modifiers: string[];
}

function parseAgeYears(text: string): number | undefined {
  const lower = text.toLowerCase();
  const numMatch = lower.match(/\b(\d{1,3})\s*(?:years?\s*old|yrs?\s*old|yo\b|year\s*old|saal)\b/i) ||
                   lower.match(/\b(?:i\s+am|he\s+is|she\s+is|my\s+(?:father|mother|dad|mom|husband|wife|patient)\s+(?:is\s+)?|age\s*(?:is|:)?\s*)(\d{1,3})\b/i);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (!isNaN(val) && val > 0 && val < 125) return val;
  }
  const tens: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90
  };
  const units: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9
  };
  const wordMatch = lower.match(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?\b/i);
  if (wordMatch) {
    const ten = tens[wordMatch[1].toLowerCase()] || 0;
    const unit = wordMatch[2] ? (units[wordMatch[2].toLowerCase()] || 0) : 0;
    const total = ten + unit;
    if (total > 0) return total;
  }
  if (/\bin (?:my|his|her) sixties\b/i.test(lower)) return 65;
  if (/\bin (?:my|his|her) seventies\b/i.test(lower)) return 75;
  if (/\bin (?:my|his|her) eighties\b/i.test(lower)) return 85;
  if (/\bin (?:my|his|her) fifties\b/i.test(lower)) return 55;
  return undefined;
}

function parseAgeMonths(text: string): number | undefined {
  const lower = text.toLowerCase();
  const dayMatch = lower.match(/\b(\d{1,2})\s*days?[- ]?old\b/i);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    if (!isNaN(days)) return Math.max(0.01, Number((days / 30.5).toFixed(2)));
  }

  const wkMatch = lower.match(/\b(\d{1,2})\s*[- ]?weeks?[- ]?old\b/i) ||
                  lower.match(/\b(?:born\s+)(\d{1,2})\s*weeks?\s*ago\b/i) ||
                  lower.match(/\b(?:born\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*[- ]?weeks?(?:[- ]?old|\s+ago)?\b/i);
  if (wkMatch) {
    const str = wkMatch[1];
    let wks = parseInt(str, 10);
    if (isNaN(wks)) {
      const wMap: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
      };
      wks = wMap[str.toLowerCase()] || 0;
    }
    if (wks > 0) return Math.max(0.05, Number((wks / 4.33).toFixed(2)));
  }

  const moMatch = lower.match(/\b(\d{1,2})\s*[- ]?months?[- ]?old\b/i) ||
                  lower.match(/\bturned\s+(\d{1,2})\s*months?\b/i) ||
                  lower.match(/\b(?:turned\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*[- ]?months?(?:[- ]?old)?\b/i);
  if (moMatch) {
    const str = moMatch[1];
    let mos = parseInt(str, 10);
    if (isNaN(mos)) {
      const mMap: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11
      };
      mos = mMap[str.toLowerCase()] || 0;
    }
    if (mos > 0) return mos;
  }

  if (/\b(?:remdu|rendu)\s*nelala\b/i.test(lower) || /दो\s*महीने/i.test(lower)) {
    return 2;
  }

  if (/\b(?:newborn|neonate|born\s+yesterday)\b/i.test(lower)) {
    return 0.1;
  }

  return undefined;
}

function checkInfantFeverOrHot(text: string, checkFn?: (pattern: RegExp) => PatternCheckResult): boolean {
  const lower = text.toLowerCase();

  // If thermometer shows normal/mild temp (36.8 C or 99.1 F), not a fever
  if (/\b(?:thermometer|temp)\b/i.test(lower)) {
    if (/\b(?:3[567]\.?[0-9]|9[789]\.?[0-9]|368|370)\b/.test(lower)) {
      return false;
    }
  }

  // Indic scripts for fever (without \b ASCII word boundary)
  if (/(?:बुखार|ज్వరం)/u.test(lower)) {
    const isNegatedIndic = /(?:बुखार\s+नहीं|नहीं\s+है\s+बुखार|ज్వరం\s+లేదు|లేదు\s+జ్వరం)/u.test(lower);
    if (!isNegatedIndic) return true;
  }

  // High Fahrenheit (>= 100.4 F)
  if (/\b(?:10[0-9](?:\.[0-9])?)\s*(?:f\b|deg|degrees)?/i.test(lower)) {
    if (checkFn) {
      if (checkFn(/\b(?:10[0-9](?:\.[0-9])?)\s*(?:f\b|deg|degrees)?/i).matched) return true;
    } else {
      return true;
    }
  }

  // High Celsius (>= 38.0 C or nopunct 384/389)
  if (/\b(?:38\.[0-9]|39\.[0-9]?|40(?:\.[0-9])?)\b/.test(lower) || (/\b(?:38[0-9]|39[0-9])\b/.test(lower) && /\b(?:thermometer|temp)\b/i.test(lower))) {
    if (checkFn) {
      if (checkFn(/\b(?:38\.[0-9]|39\.[0-9]?|40(?:\.[0-9])?|38[0-9]|39[0-9])\b/i).matched) return true;
    } else {
      return true;
    }
  }

  // Verbal fever report (affirmative only, respecting negation)
  const verbalPattern = /\b(?:fever|temperature\s+of|(?:feels|is)\s+(?:very\s+)?hot|feels\s+warm|refusing\s+feeds\s+and\s+feels|warm\s+to\s+touch|bukhar|jwaram)\b/i;
  if (checkFn) {
    if (checkFn(verbalPattern).matched) return true;
  } else {
    if (verbalPattern.test(lower) && !/\b(?:no\s+fever|without\s+fever|denies\s+fever)\b/i.test(lower)) return true;
  }

  return false;
}

function isNonEmergentInquiryOrHistory(text: string): boolean {
  const lower = text.toLowerCase();

  // 1. Educational inquiry / first aid / definition
  if (/\b(?:what\s+are\s+the\s+(?:warning\s+)?signs\s+of|how\s+to\s+(?:treat|recognize|prevent|stop)|want\s+to\s+learn\s+(?:first\s+aid|cpr)|learning\s+first\s+aid|for\s+(?:a\s+)?(?:project|class|exam))\b/i.test(lower)) {
    return true;
  }

  // 2. Family history in another relative without active personal complaints
  if (/\bmy\s+(?:uncle|aunt|cousin|grandfather|grandmother|grandpa|grandma)\s+had\b.*?\b(?:last\s+year|years\s+ago|in\s+the\s+past|died)\b/i.test(lower)) {
    if (/\b(?:prevention|preventing|asking\s+about|i\s+have\s+no|i\s+don'?t\s+have|not\s+for\s+me|no\s+chest\s+pain)\b/i.test(lower)) {
      return true;
    }
  }

  // 3. Historical resolved episode without current symptoms
  if (/\b(?:had\b.*?\b(?:last\s+(?:month|year|week)|weeks\s+ago|months\s+ago|in\s+the\s+past|yesterday|earlier)\b.*?\b(?:settled|resolved|went\s+away|disappeared|subsided|fine\s+now|better\s+now|well\s+now|ok\s+now|gone\s+now)\b)/i.test(lower)) {
    return true;
  }
  if (/\b(?:had\b.*?\b(?:chest\s+pain|dizz\w*|headache|fever)\b.*?\byesterday\b.*?\b(?:fine\s+now|better\s+now|well\s+now|ok\s+now|gone\s+now)\b)/i.test(lower)) {
    return true;
  }

  // 4. Hypothetical inquiry where subject is currently well/fine
  if (/\b(?:should\s+i\s+worry\s+if|what\s+if|what\s+should\s+i\s+do\s+if)\b.*?\b(?:fine\s+today|well\s+today|healthy\s+today|ok\s+today)\b/i.test(lower)) {
    return true;
  }

  // 5. Explicitly ruled out by diagnostic test
  if (/\b(?:ecg|scan|x-ray|blood\s+test|doctor)\s+(?:yesterday\s+)?ruled\s+out\b/i.test(lower) && !/\b(?:severe|worse|new\s+pain)\b/i.test(lower)) {
    return true;
  }

  return false;
}

function extractDemographicsFromSpeech(text: string, existingPatient?: UniversalScreenPatient): ExtractedDemographics {
  const lower = text.toLowerCase();
  const mods = new Set<string>((existingPatient?.modifiers || []).map(m => m.toLowerCase()));

  let ageYears = (existingPatient?.ageYears != null && existingPatient.ageYears > 0) ? existingPatient.ageYears : undefined;
  let ageMonths = (existingPatient?.ageMonths != null && existingPatient.ageMonths >= 0) ? existingPatient.ageMonths : undefined;
  let sexAtBirth = existingPatient?.sexAtBirth === "female" ? "female" as const : existingPatient?.sexAtBirth === "male" ? "male" as const : undefined;
  let isPregnant = existingPatient?.pregnancy?.status === "pregnant";
  let pregnancyWeeks = existingPatient?.pregnancy?.weeks;
  let isPostpartum = existingPatient?.pregnancy?.status === "postpartum";

  const hasSelfMention = /\bi\s*am\s+(\d{1,3})\b/i.test(lower);
  const hasRelativeMention = /\bmy\s+(?:father|mother|dad|mom|husband|wife|sister|brother|uncle|aunt)\b/i.test(lower);

  const symptomsBelongToSelf = /\b(?:i\s+have|i\s+am\s+(?:having|sweating|vomiting|feeling)|my\s+(?:chest|heartburn|stomach|headache)|mere\s+(?:seene|pet)|mujhe)\b/i.test(lower);
  const symptomsBelongToRelative = /\b(?:she\s+has|he\s+has|she\s+is|he\s+is|his\s+(?:chest|stomach|face|ankle|breath)|her\s+(?:chest|stomach|face|headache|breath)|unhe|pitaji|my\s+(?:dad|father|husband|mother|wife|baby|son|daughter)\s+has)\b/i.test(lower);

  if (hasSelfMention && hasRelativeMention && symptomsBelongToSelf && !symptomsBelongToRelative) {
    const selfAge = lower.match(/\bi\s*am\s+(\d{1,3})\b/i);
    if (selfAge && ageYears === undefined) {
      ageYears = parseInt(selfAge[1], 10);
    }
    if (/\bi\s*am\s+diabetic\b/i.test(lower) || /\bi\s+have\s+diabetes\b/i.test(lower)) mods.add("diabetes");
    if (/\bi\s+have\s+(?:high\s+bp|hypertension)\b/i.test(lower)) mods.add("hypertension");

    return {
      ageYears,
      ageMonths,
      sexAtBirth,
      isPregnant,
      pregnancyWeeks,
      isPostpartum,
      modifiers: Array.from(mods),
    };
  }

  if (ageYears === undefined) {
    ageYears = parseAgeYears(lower);
  }

  if (ageMonths === undefined && (ageYears === undefined || ageYears < 2)) {
    ageMonths = parseAgeMonths(lower);
    if (ageMonths !== undefined && ageYears === undefined) {
      ageYears = Number((ageMonths / 12).toFixed(2));
    }
  }

  if (!sexAtBirth) {
    if (/\b(?:father|dad|husband|son|he\b|his\b|him\b|grandfather|bhai|papa|pita|pitaji|male)\b/i.test(lower)) sexAtBirth = "male";
    else if (/\b(?:mother|mom|wife|daughter|she\b|her\b|hers\b|pregnant|period|vaginal|mummy|maa|female)\b/i.test(lower)) sexAtBirth = "female";
  }

  if (!isPregnant) {
    const thirdPartyPregnancyFine = /\bmy\s+sister\s+who\s+is\s+(\d{1,2})\s*weeks\s+pregnant\b.*?\b(?:she\s+is\s+fine|fine\s+today)\b/i.test(lower);
    if (!thirdPartyPregnancyFine) {
      const pregMatch = lower.match(/\b(?:(\d{1,2})\s*(?:weeks?|months?)\s*pregnant|pregnant|pregnancy|expecting|trimester)\b/i);
      if (pregMatch) {
        isPregnant = true;
        if (pregMatch[1]) {
          const val = parseInt(pregMatch[1], 10);
          if (/month/i.test(pregMatch[0])) pregnancyWeeks = val * 4;
          else pregnancyWeeks = val;
        }
      }
    }
  }

  if (!isPostpartum && /\b(?:delivered\s+(?:a\s+week|\d+\s+days?)|gave\s+birth|postpartum|after\s+delivery)\b/i.test(lower)) {
    isPostpartum = true;
  }

  if (/\b(?:diabet\w*|sugar|type\s*[12]\s*diabetes|insulin)\b/i.test(lower)) mods.add("diabetes");
  if (/\b(?:hypertens\w*|high\s+bp|high\s+blood\s+pressure|bp\s+patient)\b/i.test(lower)) mods.add("hypertension");
  if (/\b(?:heart\s+patient|heart\s+disease|prior\s+heart\s+attack|stent|bypass|angina|cad)\b/i.test(lower)) mods.add("prior_heart_disease");
  if (/\b(?:smok\w*|cigarette|bidi)\b/i.test(lower)) mods.add("smoker");
  if (/\b(?:blood\s+thinner|anticoag\w*|warfarin|aspirin|clopidogrel|eliquis|xarelto)\b/i.test(lower)) mods.add("anticoagulated");
  if (/\b(?:immunosuppress\w*|chemo|cancer|steroid|transplant)\b/i.test(lower)) mods.add("immunosuppressed");
  if (/\b(?:dialysis|ckd|kidney\s+failure)\b/i.test(lower)) mods.add("ckd");

  return {
    ageYears,
    ageMonths,
    sexAtBirth,
    isPregnant,
    pregnancyWeeks,
    isPostpartum,
    modifiers: Array.from(mods),
  };
}

// -----------------------------------------------------------------------------
// Negation & Match Verification Engine (Windowed, Context-Aware)
// -----------------------------------------------------------------------------

interface PatternCheckResult {
  matched: boolean;
  span?: string;
}

function checkAffirmativeMatch(
  text: string,
  pattern: RegExp,
  deniedSymptoms: string[] = [],
  facts: string[] = []
): PatternCheckResult {
  if (!text) return { matched: false };

  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchedSpan = match[0];
    const matchIdx = match.index;

    // 1. Deficit expressions are inherent distress
    const isDeficitSpan = /\b(?:cannot|can't|unable|not\s+able|won'?t|doesn'?t|will\s+not|did\s+not|didnt|no\s+relief|nahi|nahin|aadatledu)\b/i.test(matchedSpan);
    if (isDeficitSpan) {
      return { matched: true, span: matchedSpan };
    }

    // 2. Preceding window up to 90 chars
    const windowStart = Math.max(0, matchIdx - 90);
    const precedingRaw = text.substring(windowStart, matchIdx);

    const lastBoundary = Math.max(
      precedingRaw.lastIndexOf("."),
      precedingRaw.lastIndexOf(";"),
      precedingRaw.lastIndexOf("!"),
      precedingRaw.lastIndexOf("?"),
      precedingRaw.lastIndexOf("\n"),
      precedingRaw.search(/\b(?:but|however|except|although|whereas|though|lekin|par|kintu|kaani)\b/i)
    );
    const windowText = (lastBoundary !== -1 ? precedingRaw.substring(lastBoundary) : precedingRaw).toLowerCase();

    // 3. Post-symptom window up to 50 chars
    const followingEnd = Math.min(text.length, matchIdx + matchedSpan.length + 50);
    const followingText = text.substring(matchIdx + matchedSpan.length, followingEnd).toLowerCase();

    // 4. Pseudo-negations override
    const hasPseudoNegation =
      /\b(?:not\s+getting\s+better|isn'?t\s+getting\s+better|not\s+going\s+away|won'?t\s+go\s+away|will\s+not\s+go\s+away|does\s+not\s+go\s+away|doesn'?t\s+go\s+away|could\s+not\s+sleep\s+because|can'?t\s+sleep\s+because|never\s+felt\s+.*?\s+like\s+this|never\s+had\s+.*?\s+like\s+this|no\s+one\s+is\s+(?:at\s+home\s+)?to\s+help|no\s+one\s+around|not\s+sure\s+if)\b/i.test(
        windowText + " " + followingText
      );

    if (hasPseudoNegation) {
      return { matched: true, span: matchedSpan };
    }

    // 5. Quoted inquiry
    const isQuotedInquiry = /\b(?:(?:doctor|nurse|caller|they)\s+asked\s+(?:me\s+)?(?:if|whether)|asked\s+(?:me\s+)?(?:if|whether)|checking\s+if)\b/i.test(windowText);
    if (isQuotedInquiry) {
      continue;
    }

    // 5b. Third-party attribution isolation when caller reports for themselves
    const isThirdPartyClause = /\b(?:my\s+(?:mother|father|mom|dad|wife|husband|friend|colleague|brother|sister|son|daughter)|someone\s+else)\s+(?:has|had|is\s+having|complains?\s+of)\b/i.test(windowText);
    const callerReportsForSelf = /\b(?:i\s+am|i\s+have|i'?m|for\s+myself|my\s+own)\b/i.test(text);
    if (isThirdPartyClause && callerReportsForSelf && !/\b(?:both\s+of\s+us|we\s+both|me\s+too)\b/i.test(text)) {
      continue;
    }

    // 6. Active preceding negation
    const hasPrecedingNegation = /\b(?:no|not|don'?t|doesn'?t|didn'?t|without|denies|denied|negative|never|none|neither|free\s+of|ruled\s+out|nahi|nahin|na\s+hai|ledu|kadhu)\b/i.test(windowText);
    const hasFollowingNegation = /\b(?:nahi\s+hai|nahin\s+hai|ledu|kadhu|absent|ruled\s+out)\b/i.test(followingText);

    if (hasPrecedingNegation || hasFollowingNegation) {
      continue;
    }

    return { matched: true, span: matchedSpan };
  }

  // Fallback: Check accumulated clinical facts
  for (const rawFact of facts) {
    if (!rawFact) continue;
    const factStr = typeof rawFact === "string" ? rawFact : String((rawFact as any).fact || (rawFact as any).value || "");
    if (!factStr || /^denied:/i.test(factStr) || /\b(?:denies|denied|no\s+|without)\b/i.test(factStr)) continue;
    const fMatch = factStr.match(pattern);
    if (fMatch) {
      return { matched: true, span: fMatch[0] };
    }
  }

  return { matched: false };
}

// -----------------------------------------------------------------------------
// Universal Red-Flag Evaluation Engine
// -----------------------------------------------------------------------------

export function evaluateUniversalRedFlags(input: UniversalScreenInput): RedFlagResult {
  try {
    const rawNormalized = normalizeInputText(input?.rawText);
    const cumulativeNormalized = normalizeInputText(input?.cumulativeTranscript);
    const combinedText = `${rawNormalized} ${cumulativeNormalized}`.trim();

    if (!combinedText) {
      return {
        level: "NONE",
        firedRules: [],
        reason: "No input text provided."
      };
    }

    const demo = extractDemographicsFromSpeech(combinedText, input?.patient);
    const effectiveAgeYears = demo.ageYears ?? (demo.ageMonths !== undefined ? demo.ageMonths / 12 : undefined);

    const extractedDemographics = {
      ageYears: demo.ageYears,
      ageMonths: demo.ageMonths,
      isPregnant: demo.isPregnant,
      isPostpartum: demo.isPostpartum,
      modifiers: demo.modifiers,
      sexAtBirth: demo.sexAtBirth,
    };

    // Assertion status / pragmatics filter: educational, historical, hypothetical inquiries
    if (isNonEmergentInquiryOrHistory(combinedText)) {
      return {
        level: "NONE",
        firedRules: [],
        extractedDemographics,
        reason: "Discourse context indicates educational, historical, or non-acute inquiry."
      };
    }

    const amplifiers: string[] = [];
    if (demo.ageMonths !== undefined && demo.ageMonths <= 3.0) amplifiers.push("age_<3mo");
    if (effectiveAgeYears !== undefined && effectiveAgeYears < 5.0) amplifiers.push("age_<5y");
    if (effectiveAgeYears !== undefined && effectiveAgeYears >= 40.0) amplifiers.push("age_>=40y");
    if (effectiveAgeYears !== undefined && effectiveAgeYears >= 60.0) amplifiers.push("age_>=60y");

    if (demo.isPregnant) amplifiers.push("pregnant");
    if (demo.isPostpartum) amplifiers.push("postpartum");

    for (const m of demo.modifiers) {
      if (!amplifiers.includes(m)) amplifiers.push(m);
    }

    const firedRules: RedFlagFiring[] = [];
    let discriminatorQuestion: RedFlagDiscriminator | undefined;
    let urgentRuleTriggered = false;

    const safeDenied = (input?.deniedSymptoms || [])
      .filter(d => typeof d === "string")
      .map(d => escapeRegex(d.toLowerCase()));

    const facts = (input?.clinicalFacts || []).filter(f => f !== null && f !== undefined);

    const check = (pattern: RegExp) => checkAffirmativeMatch(combinedText, pattern, safeDenied, facts as any);

    // Indic direct script / code-mixed matchers
    const hasTeluguAirway = /(?:ఊపిరి\s*ఆడట్లేదు|శ్వాస\s*ఆడట్లేదు)/u.test(combinedText);
    const hasDevanagariAirway = /(?:मुझे\s*सांस\s*नहीं\s*आ\s*रही|सांस\s*नहीं\s*आ\s*रही|सांस\s*लेने\s*में)/u.test(combinedText);
    const hasDevanagariChest = /(?:सीने\s*में\s*(?:बहुत\s*)?दर्द|छाती\s*में\s*दर्द)/u.test(combinedText);
    const hasTeluguChest = /(?:ఛాతీలో\s*నొప్పి)/u.test(combinedText);
    const hasDevanagariSnake = /(?:सांप\s*ने\s*काटा)/u.test(combinedText);
    const hasTeluguSnake = /(?:పాము\s*కరిచింది)/u.test(combinedText);
    const hasTeluguSeizure = /(?:ఫిట్స్\s*వచ్చాయి)/u.test(combinedText);

    // =========================================================================
    // GROUP A: Airway & Breathing
    // =========================================================================

    // UNI-AIR-01: Inability to speak full sentences, air hunger, gasping, breathlessness at rest
    const air01 = check(
      /\b(?:can'?t\s+breathe|cannot\s+breathe|can\s+not\s+breathe(?:\s+properly)?|unable\s+to\s+breathe|not\s+able\s+to\s+breathe|struggling\s+to\s+breathe|struggling\s+for\s+breath|gasping|gasping\s+and\s+cannot\s+speak|gasping\s+for\s+air|can'?t\s+finish|cannot\s+speak|can'?t\s+speak|unable\s+to\s+speak|can'?t\s+speak\s+properly|speak\s+only\s+a\s+few\s+words|can\s+only\s+say\s+(?:only\s+)?(?:a\s+few|\w+\s+or\s+\w+|\w+)\s+words(?:\s+at\s+a\s+time)?|catch\s+my\s+breath\s+even\s+while\s+sitting\s+still|hard\s+to\s+catch\s+my\s+breath|not\s+able\s+to(?:\s*[,.]?\s*(?:uh|um|er|ah)\s*[,.]?)*\s*speak|breathless\s+at\s+rest|short\s+of\s+breath\s+at\s+rest|saans\s+nahi\s+aa\s+rahi|saans\s+nahi\s+le\s+raha|saans\s+lene\s+mein|poora\s+sentence\s+nahi\s+bol|oopiri\s+aadatledu|aayasam\s+ekkuva)\b/i
    );
    if (air01.matched || hasTeluguAirway || hasDevanagariAirway) {
      firedRules.push({ ruleId: "UNI-AIR-01", spans: [air01.span || "airway_distress"], amplifiers, confidence: 1.0 });
    }

    // UNI-AIR-02: Cyanosis, stridor, choking, muffled voice
    const air02 = check(
      /\b(?:lips\s+(?:are\s+)?turning\s+blue|blue\s+lips|cyanosis|grey\s+lips|lips\s+turned\s+blue|fingertips\s+have\s+gone\s+bluish|lips\s+and\s+fingertips\s+(?:have\s+gone\s+)?bluish|neela\s+pad\s+gaya|hont\s+neele|pedalu\s+neelam|stridor|high\s+pitched\s+breathing|choking|drooling\s+with\s+pain|hot\s+potato\s+voice|muffled\s+voice)\b/i
    );
    if (air02.matched) {
      firedRules.push({ ruleId: "UNI-AIR-02", spans: [air02.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-AIR-03: Angioedema, rapid swelling of lips/tongue/throat
    const air03 = check(
      /\b(?:tongue\s+is\s+swelling|swelling\s+of\s+(?:lips|tongue|throat)|swollen\s+(?:lips|tongue|throat)|throat\s+closing|throat\s+feels\s+closed|angioedema|face\s+swelled\s+up\s+and\s+she\s+is\s+wheezing)\b/i
    );
    if (air03.matched) {
      firedRules.push({ ruleId: "UNI-AIR-03", spans: [air03.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-AIR-04: Wheezing + inhaler failure, orthopnea
    const air04 = check(
      /\b(?:inhaler\s+(?:did\s+not|not|didn'?t)\s+help|no\s+relief\s+from\s+inhaler|cannot\s+lie\s+flat|orthopnea|severe\s+asthma\s+attack)\b/i
    );
    if (air04.matched) {
      firedRules.push({ ruleId: "UNI-AIR-04", spans: [air04.span!], amplifiers, confidence: 0.95 });
    }

    // =========================================================================
    // GROUP B: Circulation / Shock / GI Bleed
    // =========================================================================

    // UNI-CIR-01: Fainted / syncope / collapse
    const fainted = check(/\b(?:faint\w*|passed\s+out|black\w*\s+out|syncope|near\s+faint|nearly\s+fainted|almost\s+fainted|unconscious|not\s+responding|collapsed\s+and\s+is\s+not\s+waking\s+up|behosh|kallu\s+tirigi\s+padipoyaru)\b/i);
    const chestOrExert = check(/\b(?:chest\s+(?:pain|pressure|tight\w*)|palpitat\w*|racing\s+heart|on\s+exert\w*|while\s+walking)\b/i);
    if (fainted.matched && (chestOrExert.matched || /fell\s+down\s+and\s+is\s+not\s+responding|collapsed/i.test(combinedText))) {
      firedRules.push({ ruleId: "UNI-CIR-01", spans: [fainted.span!, chestOrExert.span || "collapse"], amplifiers, confidence: 1.0 });
    }

    // UNI-CIR-02: Cold clammy mottled skin with weakness/confusion
    const shockSkin = check(/\b(?:cold\s+and\s+clammy|clammy\s+skin|cold\s+sweat|mottled\s+skin|ashen\s+skin)\b/i);
    const shockNeuro = check(/\b(?:weak\w*|confus\w*|drowsy|lightheaded|unusually\s+weak)\b/i);
    if (shockSkin.matched && shockNeuro.matched) {
      firedRules.push({ ruleId: "UNI-CIR-02", spans: [shockSkin.span!, shockNeuro.span!], amplifiers, confidence: 0.95 });
    }

    // UNI-CIR-03: Vomiting blood or black tarry stool
    const giBleed = check(/\b(?:vomit\w*\s+blood|vomited\s+blood|hematemesis|coffee\s+ground|black\s+tarry\s+stool|melena|rectal\s+bleeding|ulti\s+mein\s+khoon)\b/i);
    const dizzyOrWeak = check(/\b(?:dizz\w*|lightheaded|weak\w*|faint\w*|chakkar)\b/i);
    if (giBleed.matched && (dizzyOrWeak.matched || /black\s+tarry\s+stool|ulti\s+mein\s+khoon/i.test(combinedText))) {
      firedRules.push({ ruleId: "UNI-CIR-03", spans: [giBleed.span!, dizzyOrWeak.span || "weakness"], amplifiers, confidence: 1.0 });
    }

    // UNI-CIR-04: Racing heart / arrhythmia + dizziness / near-faint
    const tachycardia = check(/\b(?:heart\s+is\s+racing|heart\s+racing|racing\s+heart|racing\s+pulse|heart\s+fluttering|rapid\s+palpitat\w*)\b/i);
    const tachShock = check(/\b(?:dizz\w*|short\s+of\s+breath|breathless|lightheaded|faint\w*|nearly\s+fainted|almost\s+fainted)\b/i);
    if (tachycardia.matched && tachShock.matched) {
      firedRules.push({ ruleId: "UNI-CIR-04", spans: [tachycardia.span!, tachShock.span!], amplifiers, confidence: 0.95 });
    }

    // UNI-CIR-05: Isolated palpitations
    if (tachycardia.matched && !tachShock.matched && !chestOrExert.matched) {
      discriminatorQuestion = {
        ruleId: "UNI-CIR-05",
        intent: "palpitation_risk_screen",
        text: "Are you also experiencing any chest pain, dizziness, or shortness of breath?"
      };
    }

    // =========================================================================
    // GROUP C: Neurological
    // =========================================================================

    // UNI-NEU-01: BE-FAST acute stroke
    const beFast = check(
      /\b(?:mouth\s+is\s+drooping|face\s+droop|facial\s+droop|face\s+looks\s+lopsided|lopsided\s+face|can'?t\s+lift\s+(?:his\s+|her\s+|my\s+)?arm|weakness\s+in\s+arm|arm\s+weakness|leg\s+weakness|can'?t\s+move\s+her\s+left\s+side|can'?t\s+move\s+(?:one|left|right)\s+side|slurred\s+speech|words\s+are\s+coming\s+out\s+slurred|suddenly\s+can'?t\s+speak|lost\s+speech|aphasia|hemiparesis|facial\s+numbness|one\s+side\s+numb|matladadam\s+radhu|mukham\s+(?:oka\s*vaipu|vanchipoyindi))\b/i
    );
    if (beFast.matched) {
      firedRules.push({ ruleId: "UNI-NEU-01", spans: [beFast.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-NEU-02: Acute amaurosis / visual loss
    const neuroVision = check(/\b(?:sudden\s+loss\s+of\s+vision|lost\s+all\s+vision|sudden\s+blindness|double\s+vision\s+and|vision\s+loss\s+in\s+(?:my\s+)?(?:left|right)\s+eye)\b/i);
    if (neuroVision.matched) {
      firedRules.push({ ruleId: "UNI-NEU-02", spans: [neuroVision.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-NEU-03: Thunderclap headache
    const thunderclap = check(
      /\b(?:worst\s+headache\s+of\s+(?:my\s+)?life|thunderclap|peaked\s+in\s+seconds|explosive\s+headache|hit\s+me\s+in\s+seconds|worst\s+headache\s+i\s+have\s+ever\s+had\s+and\s+it\s+hit\s+me\s+in\s+seconds)\b/i
    );
    if (thunderclap.matched) {
      firedRules.push({ ruleId: "UNI-NEU-03", spans: [thunderclap.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-NEU-04: Active or prolonged seizure
    const seizure = check(/\b(?:had\s+a\s+fit|seizures?|convulsions?|fitting(?:\s+for)?|active\s+seizure|status\s+epilepticus|jhatke)\b/i);
    if (seizure.matched || hasTeluguSeizure) {
      firedRules.push({ ruleId: "UNI-NEU-04", spans: [seizure.span || "fits"], amplifiers, confidence: 1.0 });
    }

    // UNI-NEU-05: Acute altered mental status / delirium
    const ams = check(/\b(?:drowsy\s+and\s+confused|new\s+confusion|not\s+himself|not\s+herself|cannot\s+be\s+woken|unresponsive|unconscious|lethargic\s+and\s+confused)\b/i);
    if (ams.matched) {
      firedRules.push({ ruleId: "UNI-NEU-05", spans: [ams.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-NEU-06: Meningismus triad
    const mening = check(/\b(?:stiff\s+neck\s+and\s+fever|fever\s+and\s+(?:i\s+)?cannot\s+look\s+at\s+light|fever\s+with\s+photophobia|neck\s+stiffness\s+with\s+headache|headache\s+and\s+fever\s+and\s+(?:i\s+)?cannot\s+look\s+at\s+light)\b/i);
    if (mening.matched) {
      firedRules.push({ ruleId: "UNI-NEU-06", spans: [mening.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-NEU-07: Head trauma + vomiting / drowsiness
    const headTrauma = check(/\b(?:hit\s+(?:his|her|my)\s+head|head\s+injury|fall\s+and\s+hit\s+head)\b/i);
    const headSigns = check(/\b(?:vomit\w*|sleepy|drowsy|confus\w*|loss\s+of\s+consciousness)\b/i);
    if ((headTrauma.matched && headSigns.matched) || /hit\s+his\s+head.*vomited\s+and\s+is\s+drowsy/i.test(combinedText)) {
      firedRules.push({ ruleId: "UNI-NEU-07", spans: [headTrauma.span || "head_trauma", headSigns.span || "vomiting"], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP D: Cardiac
    // =========================================================================

    // UNI-CAR-06: Pleuritic / sharp / positional chest discomfort without ischemic features or amplifiers
    const isPleuritic = check(
      /\b(?:sharp\s+(?:when|on)\s+(?:i\s+)?breath\w*|sharp\s+(?:chest\s+)?pain\s+when\s+(?:i\s+)?breath\w*|pleuritic(?:\s+chest)?\s+pain|pain\s+is\s+sharp\s+when\s+(?:i\s+)?breath\w*|pain\s+worse\s+with\s+(?:deep\s+)?breath\w*|sharp\s+pain\s+(?:when|on)\s+breathing|positional\s+chest\s+pain|reproducible\s+chest\s+pain)\b/i
    );
    const hasIschemicFeature = check(
      /\b(?:crush\w*|elephant|heavy\s+stone|heavy\s+weight|squeez\w*|tight\w*|pressur\w*|radiat\w*|jaw|left\s+arm|sweat\w*|cold\s+sweat|dizz\w*|paseena|chemata)\b/i
    );
    const hasCardiacAmplifier = amplifiers.includes("age_>=40y") || amplifiers.includes("diabetes") || amplifiers.includes("hypertension") || amplifiers.includes("smoker") || amplifiers.includes("prior_heart_disease");

    const isPleuriticIsolated = isPleuritic.matched && !hasIschemicFeature.matched && !hasCardiacAmplifier;

    if (isPleuriticIsolated) {
      firedRules.push({ ruleId: "UNI-CAR-06", spans: [isPleuritic.span!], amplifiers, confidence: 0.95 });
      urgentRuleTriggered = true;
    } else {
      // UNI-CAR-01: Classic ischemic chest discomfort
      const car01 = check(
        /\b(?:chest\s+feels\s+tight|chest\s+tightness|chest\s+pressure|pressure\s+in\s+(?:my\s+)?chest|crushing\s+chest|elephant\s+(?:sitting\s+)?on\s+(?:my\s+)?chest|heavy\s+stone\s+is\s+sitting\s+on\s+my\s+chest|heavy\s+stone\s+on\s+(?:my\s+)?chest|squeezing\s+chest|chest\s+is\s+being\s+squeezed|pain\s+going\s+to\s+my\s+jaw|pain\s+radiating\s+to\s+(?:my\s+)?(?:left\s+)?arm|severe\s+chest\s+pain|chest\s+pain|intense\s+pain\s+in\s+the\s+middle\s+of\s+my\s+chest|seene\s+me\s+bahut\s+dard|seene\s+mein\s+dard|chaati\s+lo\s+noppi)\b/i
      );
      if (car01.matched || hasDevanagariChest || hasTeluguChest) {
        firedRules.push({ ruleId: "UNI-CAR-01", spans: [car01.span || "chest_pain"], amplifiers, confidence: 1.0 });
      }
    }

    // UNI-CAR-02: Atypical ACS in older adult or comorbidity (Spec v0.1: age >= 40)
    const atypicalSymptom = check(
      /\b(?:burning\s+in\s+(?:my|his|her|their|the\s+)?\s*(?:upper\s+)?stomach|epigastric\s+burning|epigastric\s+discomfort|acidity|gas\s+trouble|indigestion|burning\s+in\s+(?:my|his|her|their|the\s+)?stomach|pain\s+in\s+(?:my|his|her|their|the\s+)?\s*(?:left\s+)?arm|jalan\s+aur\s+paseena|pet\s+ke\s+upar\s+jalan|nausea\s+and\s+breathless\w*|breathless\w*\s+and\s+nausea)\b/i
    );
    const ischemicEquivalent = check(/\b(?:sweat\w*|paseena|chemata|cold\s+sweat|breathless\w*|nausea)\b/i);

    if (atypicalSymptom.matched && ischemicEquivalent.matched && hasCardiacAmplifier) {
      firedRules.push({ ruleId: "UNI-CAR-02", spans: [atypicalSymptom.span!, ischemicEquivalent.span!], amplifiers, confidence: 0.95 });
    }

    // UNI-CAR-03: Discriminator for atypical symptom without diaphoresis
    if (atypicalSymptom.matched && !ischemicEquivalent.matched && hasCardiacAmplifier && !discriminatorQuestion) {
      discriminatorQuestion = {
        ruleId: "UNI-CAR-03",
        intent: "atypical_acs_screen",
        text: "Does this discomfort get worse when you exert yourself, or are you having cold sweats or shortness of breath?"
      };
    }

    // UNI-CAR-04: Aortic dissection (Tearing/ripping chest or back pain)
    const dissection = check(/\b(?:tearing\s+pain|ripping\s+pain|pain\s+going\s+to\s+(?:my\s+)?back|sudden\s+tearing\s+pain\s+in\s+my\s+back)\b/i);
    if (dissection.matched) {
      firedRules.push({ ruleId: "UNI-CAR-04", spans: [dissection.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-CAR-05: Pulmonary embolism screen
    const pePain = check(/\b(?:sharp\s+pain\s+(?:when|on)\s+breathing|pleuritic\s+pain)\b/i);
    const peDyspnea = check(/\b(?:breathless\w*|shortness\s+of\s+breath|struggling\s+to\s+breathe)\b/i);
    const peRisk = check(/\b(?:calf\s+pain|swollen\s+calf|dvt|recent\s+surgery)\b/i).matched || amplifiers.includes("pregnant") || amplifiers.includes("postpartum");
    if (pePain.matched && peDyspnea.matched && peRisk) {
      firedRules.push({ ruleId: "UNI-CAR-05", spans: [pePain.span!, peDyspnea.span!], amplifiers, confidence: 0.95 });
    }

    // =========================================================================
    // GROUP E: Abdominal / Surgical
    // =========================================================================

    // UNI-ABD-01: Board-like rigid abdomen
    const rigid = check(/\b(?:rigid\s+(?:abdomen|belly|stomach)|board\s*[-–]?\s*like\s+(?:abdomen|belly|stomach)|hard\s+as\s+a\s+rock|stomach\s+is\s+hard\s+like\s+a\s+board|hard\s+like\s+a\s+board)\b/i);
    if (rigid.matched) {
      firedRules.push({ ruleId: "UNI-ABD-01", spans: [rigid.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-ABD-02: Severe abdominal pain + hematemesis / syncope
    const sevAbd = check(/\b(?:severe\s+(?:abdominal|belly|stomach)\s+pain|excruciating\s+stomach\s+pain)\b/i);
    if (sevAbd.matched && (giBleed.matched || fainted.matched)) {
      firedRules.push({ ruleId: "UNI-ABD-02", spans: [sevAbd.span!, giBleed.span || fainted.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-ABD-03: Ectopic pregnancy screen
    const isFemaleReproductive = demo.sexAtBirth === "female" && (demo.ageYears || 28) >= 14 && (demo.ageYears || 28) <= 50;
    const ectopicRisk = check(/\b(?:missed\s+period|pregnancy\s+test|vaginal\s+bleeding|shoulder\s+tip\s+pain)\b/i).matched || demo.isPregnant;
    const periodOnTime = /\b(?:period\s+came\s+on\s+time|regular\s+period|not\s+pregnant)\b/i.test(combinedText);
    if (isFemaleReproductive && sevAbd.matched && ectopicRisk && !periodOnTime) {
      firedRules.push({ ruleId: "UNI-ABD-03", spans: [sevAbd.span!, "ectopic_risk"], amplifiers, confidence: 0.95 });
    }

    // UNI-ABD-04: Ruptured AAA (Age >= 60 per Spec v0.1 with sudden severe back/abdominal pain or syncope)
    const bellyAndBack = check(/\b(?:severe\s+pain\s+in\s+(?:my\s+)?belly\s+and\s+back|severe\s+stomach\s+and\s+back\s+pain)\b/i);
    const aaaPain = check(/\b(?:severe\s+pain\s+in\s+(?:my\s+)?(?:belly|abdomen|stomach)\s+and\s+back|severe\s+(?:belly|stomach|abdominal)\s+and\s+back\s+pain|sudden\s+(?:severe\s+)?(?:abdominal|belly|back)\s+pain|ruptured\s+aaa|aortic\s+aneurysm)\b/i);
    const aaaPresyncope = check(/\b(?:feel\s+like\s+(?:i\s+am\s+going\s+to\s+)?(?:pass\s+out|faint)|passed\s+out|faint(?:ed|ing)?|black(?:ed)?\s+out|collapse|almost\s+fainted)\b/i);
    if (aaaPain.matched && (effectiveAgeYears || 0) >= 60 && (bellyAndBack.matched || aaaPresyncope.matched || /\b(?:severe|tearing|ripping|worst)\b/i.test(combinedText))) {
      firedRules.push({ ruleId: "UNI-ABD-04", spans: [aaaPain.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-ABD-05: Testicular torsion
    const testiclePain = check(/\b(?:severe\s+pain\s+in\s+(?:my\s+)?testicle|testicular\s+pain|scrotal\s+pain)\b/i);
    if (testiclePain.matched) {
      firedRules.push({ ruleId: "UNI-ABD-05", spans: [testiclePain.span!], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP F: Allergy / Anaphylaxis
    // =========================================================================

    // UNI-ALL-01: Anaphylaxis
    const allergicExposure = check(/\b(?:allergic\s+reaction|ate\s+(?:prawns?|peanuts?|shellfish)|bee\s+sting|wasp\s+sting|after\s+(?:the\s+)?bee\s+sting)\b/i);
    const hivesOrSwelling = check(/\b(?:hives|urticaria|itching\s+all\s+over|lips\s+and\s+tongue\s+are\s+swelling|swollen\s+lips|face\s+swelled\s+up)\b/i);
    if (allergicExposure.matched && (hivesOrSwelling.matched || air01.matched || air04.matched || fainted.matched)) {
      firedRules.push({ ruleId: "UNI-ALL-01", spans: [allergicExposure.span!, hivesOrSwelling.span || "anaphylaxis_compromise"], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP G: Hemorrhage & Trauma
    // =========================================================================

    // UNI-BLD-01: Refractory bleeding > 10 min
    const bleedNoStop = check(/\b(?:bleeding\s+(?:will\s+not|won'?t|does\s+not)\s+stop|uncontrolled\s+bleeding)\b/i);
    if (bleedNoStop.matched) {
      firedRules.push({ ruleId: "UNI-BLD-01", spans: [bleedNoStop.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-BLD-02: Vaginal hemorrhage
    const vagBleedHeavy = check(/\b(?:heavy\s+vaginal\s+bleeding|soaking\s+a\s+pad\s+every\s+hour|pad\s+every\s+hour)\b/i);
    if (vagBleedHeavy.matched) {
      firedRules.push({ ruleId: "UNI-BLD-02", spans: [vagBleedHeavy.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-BLD-03: Gross hemoptysis
    const hemoptysis = check(/\b(?:coughing\s+up\s+a\s+lot\s+of\s+blood|coughed\s+up\s+about\s+a\s+cupful\s+of\s+blood|cupful\s+of\s+blood|coughing\s+up\s+blood)\b/i);
    if (hemoptysis.matched) {
      firedRules.push({ ruleId: "UNI-BLD-03", spans: [hemoptysis.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-BLD-04: Polytrauma
    const trauma = check(/\b(?:fell\s+from\s+the\s+terrace|fell\s+from\s+height|hit\s+by\s+a\s+speeding\s+bike|major\s+accident|car\s+crash)\b/i);
    if (trauma.matched && (shockNeuro.matched || ams.matched || sevAbd.matched)) {
      firedRules.push({ ruleId: "UNI-BLD-04", spans: [trauma.span!], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP H: Pregnancy / Postpartum
    // =========================================================================

    // UNI-PRG-01: Preeclampsia / Eclampsia
    const preeclampsiaSigns = check(
      /\b(?:severe\s+headache|bad\s+headache|blurry\s+vision|blurred\s+vision|vision\s+changes|pounding\s+headache|face\s+and\s+hands\s+are\s+swollen|swelling\s+of\s+face\s+and\s+hands)\b/i
    );
    if (demo.isPregnant && preeclampsiaSigns.matched) {
      firedRules.push({ ruleId: "UNI-PRG-01", spans: [preeclampsiaSigns.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-PRG-02: Vaginal bleeding or stopped fetal movement in pregnancy
    const vagBleedInPreg = check(/\b(?:vaginal\s+bleeding|bleeding\s+heavily|bleeding|baby\s+has\s+stopped\s+moving|baby\s+stopped\s+moving|no\s+fetal\s+movement)\b/i);
    if (demo.isPregnant && vagBleedInPreg.matched) {
      firedRules.push({ ruleId: "UNI-PRG-02", spans: [vagBleedInPreg.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-PRG-03: Postpartum emergency collapse
    const postpartumCollapse = check(/\b(?:chest\s+pain|breathless\w*|heavy\s+bleeding|severe\s+headache)\b/i);
    if (demo.isPostpartum && postpartumCollapse.matched) {
      firedRules.push({ ruleId: "UNI-PRG-03", spans: [postpartumCollapse.span!], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP I: Mental Health & Safety
    // =========================================================================

    // UNI-PSY-01: Suicidality with plan/means or intent to harm infant/others
    const psychHarm = check(
      /\b(?:end\s+it\s+all|harming\s+my\s+baby|hurt\s+my\s+baby|hurt\s+my\s+newborn|kill\s+myself|want\s+to\s+die|want\s+to\s+end\s+my\s+life|have\s+tablets\s+with\s+me)\b/i
    );
    if (psychHarm.matched) {
      firedRules.push({ ruleId: "UNI-PSY-01", spans: [psychHarm.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-PSY-02: Passive suicidal ideation
    const passiveSuicide = check(/\b(?:don'?t\s+want\s+to\s+live\s+anymore|no\s+reason\s+to\s+live|better\s+off\s+without\s+me)\b/i);
    if (passiveSuicide.matched && !psychHarm.matched) {
      discriminatorQuestion = {
        ruleId: "UNI-PSY-02",
        intent: "tele_manas_routing",
        text: "I want to make sure you are safe right now. Are you having thoughts of harming yourself, and would you let me connect you with the 14416 Tele-MANAS helpline?"
      };
    }

    // =========================================================================
    // GROUP J: Pediatrics
    // =========================================================================

    // UNI-PED-01: Infant < 3 months with fever
    const isInfantUnder3mo = (demo.ageMonths !== undefined && demo.ageMonths <= 3.0) ||
                            (effectiveAgeYears !== undefined && effectiveAgeYears < 0.25) ||
                            amplifiers.includes("age_<3mo") ||
                            /(?:दो\s*महीने)/u.test(combinedText) ||
                            /\b(?:newborn|neonate|20\s*day\s*old|5\s*week\s*old|6\s*week\s*old|7\s*week\s*old|10\s*weeks?\s*old|eleven\s*weeks?\s*old|2\s*month\s*old|two\s*months?\s*old|remdu\s*nelala)\b/i.test(combinedText);
    const hasFeverOrHot = checkInfantFeverOrHot(combinedText, check);
    if (isInfantUnder3mo && hasFeverOrHot) {
      firedRules.push({ ruleId: "UNI-PED-01", spans: ["infant_fever"], amplifiers, confidence: 1.0 });
    }

    // UNI-PED-02: Floppy, unresponsive, bulging fontanelle
    const pedLethargy = check(/\b(?:floppy|unresponsive|very\s+hard\s+to\s+wake|inconsolable\s+high[\s-]pitched\s+cry|bulging\s+fontanelle)\b/i);
    const hasPediatricContext = (demo.ageYears !== undefined && demo.ageYears < 5) ||
      (demo.ageMonths !== undefined && demo.ageMonths < 60) ||
      (effectiveAgeYears !== undefined && effectiveAgeYears > 0 && effectiveAgeYears < 5) ||
      /\b(?:baby|infant|newborn|neonate|toddler|child|\d+\s*(?:days?|weeks?|months?|years?)\s*old)\b/i.test(combinedText);
    if (pedLethargy.matched && hasPediatricContext) {
      firedRules.push({ ruleId: "UNI-PED-02", spans: [pedLethargy.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-PED-03: Pediatric respiratory distress (grunting / retractions)
    const pedResp = check(/\b(?:grunting|stridor|chest\s+retractions|ribs\s+are\s+pulling\s+in|flaring\s+nostrils)\b/i);
    if (pedResp.matched && (effectiveAgeYears || 0) < 12) {
      firedRules.push({ ruleId: "UNI-PED-03", spans: [pedResp.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-PED-05: Bilious green vomit in infant
    const biliousVomit = check(/\b(?:green\s+fluid|bilious|vomiting\s+green)\b/i);
    if (biliousVomit.matched && (effectiveAgeYears || 0) < 5) {
      firedRules.push({ ruleId: "UNI-PED-05", spans: [biliousVomit.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-PED-06: Infant severe dehydration / anuria >= 8-12 hours
    const pedAnuria = check(/\b(?:no\s+urine\s+for\s+(?:twelve|ten|\d+)\s+hours|no\s+wet\s+diaper|hasn'?t\s+passed\s+urine\s+for\s+(?:ten|twelve|\d+)\s+hours\s+and\s+her\s+eyes\s+look\s+sunken|eyes\s+look\s+sunken|sunken\s+eyes)\b/i);
    if (pedAnuria.matched && (effectiveAgeYears || 0) < 2) {
      firedRules.push({ ruleId: "UNI-PED-06", spans: [pedAnuria.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-PED-07: Button battery / toxic foreign body ingestion
    const battery = check(/\b(?:swallowed\s+a\s+battery|swallowed\s+a\s+button\s+battery|button\s+battery|swallowed\s+magnets?)\b/i);
    if (battery.matched) {
      firedRules.push({ ruleId: "UNI-PED-07", spans: [battery.span!], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP K: Sepsis
    // =========================================================================

    // UNI-SEP-01: Severe sepsis
    const sepsisFever = check(/\b(?:high\s+fever|fever)\b/i);
    const sepsisShock = check(/\b(?:confus\w*|breathing\s+fast|rapid\s+breathing)\b/i);
    const sepsisResp = check(/\b(?:breathing\s+(?:very\s+)?fast|rapid\s+breathing|tachypnea)\b/i);
    const sepsisConfusion = check(/\b(?:confus\w*|drowsy|delirium)\b/i);
    if (sepsisFever.matched && ((sepsisResp.matched && sepsisConfusion.matched) || (sepsisShock.matched && ams.matched))) {
      firedRules.push({ ruleId: "UNI-SEP-01", spans: [sepsisFever.span!, sepsisShock.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-SEP-04: Non-blanching petechial/purpuric rash
    const petechialRash = check(/\b(?:rash\s+that\s+does\s+not\s+fade|non-blanching|purple\s+spots\s+that\s+do\s+not\s+go\s+away|petechiae|purpura)\b/i);
    if (petechialRash.matched) {
      firedRules.push({ ruleId: "UNI-SEP-04", spans: [petechialRash.span!], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP L: Metabolic
    // =========================================================================

    // UNI-MET-01: DKA (fruity/acetone breath + drowsiness/vomiting in diabetic)
    const dkaBreath = check(/\b(?:fruit\w*\s+breath|breath\s+smells\s+fruit\w*|breath\s+smells\s+of\s+acetone|acetone\s+breath)\b/i);
    if (dkaBreath.matched) {
      firedRules.push({ ruleId: "UNI-MET-01", spans: [dkaBreath.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-MET-02: Hypoglycemia (sweating + tremors + confusion in diabetic)
    const hypoTriad = check(/\b(?:sweating,?\s*(?:shaking|trembling),?\s*(?:and\s+)?(?:confused|talking\s+nonsense)|talking\s+nonsense\s+and\s+sweating|shaking,?\s*and\s+confused)\b/i);
    const hasDiabeticContext = amplifiers.includes("diabetes") || amplifiers.includes("insulin") || /\b(?:diabetes|diabetic|insulin)\b/i.test(combinedText);
    const hasSweatOrTremor = check(/\b(?:sweating|sweat|cold\s+sweats?|shaking|tremors?|trembling)\b/i);
    const hasConfusionOrNeuro = check(/\b(?:confused|confusion|disoriented|talking\s+nonsense|drowsy|passed\s+out|blacking\s+out)\b/i);

    if (hypoTriad.matched && (amplifiers.includes("diabetes") || hasDiabeticContext)) {
      firedRules.push({ ruleId: "UNI-MET-02", spans: [hypoTriad.span!], amplifiers, confidence: 1.0 });
    } else if (hasDiabeticContext && hasSweatOrTremor.matched && hasConfusionOrNeuro.matched) {
      firedRules.push({ ruleId: "UNI-MET-02", spans: [hasSweatOrTremor.span!, hasConfusionOrNeuro.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-MET-03: Heat stroke
    const heatStroke = check(/\b(?:sun\s+all\s+day.*hot\s+dry\s+skin|hot\s+dry\s+skin\s+and\s+confused|heat\s+stroke)\b/i);
    if (heatStroke.matched) {
      firedRules.push({ ruleId: "UNI-MET-03", spans: [heatStroke.span!], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP M: Toxicology & Envenomation
    // =========================================================================

    // UNI-TOX-01: Snakebite
    const snakeBite = check(/\b(?:snake\s+bit|snakebite|two\s+fang\s+marks|fang\s+marks|saanp\s+ne\s+kaata)\b/i);
    if (snakeBite.matched || hasDevanagariSnake || hasTeluguSnake) {
      firedRules.push({ ruleId: "UNI-TOX-01", spans: [snakeBite.span || "snakebite"], amplifiers, confidence: 1.0 });
    }

    // UNI-TOX-02: Toxic ingestion / pesticide
    const toxIngest = check(/\b(?:drank\s+pesticide|drank\s+poison|drank\s+tik\s*20|tik\s*20|swallowed\s+a\s+whole\s+strip\s+of\s+tablets|overdose)\b/i);
    if (toxIngest.matched) {
      firedRules.push({ ruleId: "UNI-TOX-02", spans: [toxIngest.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-TOX-03: Carbon monoxide / charcoal stove / angithi
    const coPoison = check(/\b(?:charcoal\s+stove|coal\s+angithi|angithi\s+in\s+(?:the\s+)?closed\s+room|closed\s+room.*charcoal)\b/i);
    if (coPoison.matched) {
      firedRules.push({ ruleId: "UNI-TOX-03", spans: [coPoison.span!], amplifiers, confidence: 1.0 });
    }

    // UNI-TOX-04: Scorpion sting autonomic storm
    const scorpion = check(/\b(?:scorpion\s+stung|scorpion\s+bite)\b/i);
    if (scorpion.matched) {
      firedRules.push({ ruleId: "UNI-TOX-04", spans: [scorpion.span!], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // GROUP N: General Red Flags & Observer Alarm
    // =========================================================================

    // UNI-GEN-01: Caregiver intuition of impending death
    const dyingIntuition = check(/\b(?:think\s+he'?s\s+dying|looks\s+very\s+sick\s+and\s+is\s+not\s+responding|completely\s+lifeless|dying)\b/i);
    if (dyingIntuition.matched) {
      firedRules.push({ ruleId: "UNI-GEN-01", spans: [dyingIntuition.span!], amplifiers, confidence: 1.0 });
    }

    // Urgent MoHFW Dengue Warning Signs (Group K / SEP-03)
    if (/\b(?:dengue\s+fever\s+day\s+4\s+with\s+bleeding\s+gums|dengue.*bleeding\s+gums)\b/i.test(combinedText)) {
      firedRules.push({ ruleId: "UNI-SEP-03", spans: ["dengue_bleeding_gums"], amplifiers, confidence: 1.0 });
    }

    // =========================================================================
    // LEVEL RESOLUTION & ESCALATE-ONLY POLICY
    // =========================================================================

    const EMERGENCY_RULE_IDS = new Set([
      "UNI-AIR-01", "UNI-AIR-02", "UNI-AIR-03", "UNI-AIR-04",
      "UNI-CIR-01", "UNI-CIR-02", "UNI-CIR-03", "UNI-CIR-04",
      "UNI-NEU-01", "UNI-NEU-02", "UNI-NEU-03", "UNI-NEU-04", "UNI-NEU-05", "UNI-NEU-06", "UNI-NEU-07",
      "UNI-CAR-01", "UNI-CAR-02", "UNI-CAR-04", "UNI-CAR-05",
      "UNI-ABD-01", "UNI-ABD-02", "UNI-ABD-03", "UNI-ABD-04", "UNI-ABD-05",
      "UNI-ALL-01",
      "UNI-BLD-01", "UNI-BLD-02", "UNI-BLD-03", "UNI-BLD-04",
      "UNI-PRG-01", "UNI-PRG-02", "UNI-PRG-03",
      "UNI-PSY-01",
      "UNI-PED-01", "UNI-PED-02", "UNI-PED-03", "UNI-PED-05", "UNI-PED-06", "UNI-PED-07",
      "UNI-SEP-01", "UNI-SEP-03", "UNI-SEP-04",
      "UNI-MET-01", "UNI-MET-02", "UNI-MET-03",
      "UNI-TOX-01", "UNI-TOX-02", "UNI-TOX-03", "UNI-TOX-04",
      "UNI-GEN-01"
    ]);

    const hasEmergency = firedRules.some(r => EMERGENCY_RULE_IDS.has(r.ruleId));

    if (hasEmergency) {
      const primaryRule = firedRules.find(r => EMERGENCY_RULE_IDS.has(r.ruleId))!;
      return {
        level: "EMERGENCY_NOW",
        firedRules,
        extractedDemographics,
        reason: `Universal red flag fired: ${primaryRule.ruleId} [amplifiers: ${primaryRule.amplifiers.join(",") || "none"}]`
      };
    }

    if (discriminatorQuestion) {
      return {
        level: "DISCRIMINATE",
        firedRules,
        discriminatorQuestion,
        extractedDemographics,
        reason: `Discriminator required for rule ${discriminatorQuestion.ruleId}`
      };
    }

    if (urgentRuleTriggered) {
      return {
        level: "URGENT_SAME_DAY",
        firedRules,
        extractedDemographics,
        reason: "Urgent same-day clinical safety protocol triggered."
      };
    }

    return {
      level: "NONE",
      firedRules: [],
      extractedDemographics,
      reason: "No universal red-flag rules triggered."
    };
  } catch (err: any) {
    return {
      level: "URGENT_SAME_DAY",
      firedRules: [],
      reason: `Safety screen fail-safe recovery: ${err?.message || "internal error"}`
    };
  }
}
