# MedVoice AI: Clinical Terminology & Knowledge Base License Register

**Document Status:** FORMAL GOVERNANCE REGISTER  
**Jurisdiction:** India / International Research  
**Regulatory Contact:** National Resource Centre for EHR Standards (NRCeS) / National Library of Medicine (NLM)  
**Last Updated:** November 15, 2026  

---

## 1. Overview & Statutory Purpose

MedVoice AI incorporates standardized clinical knowledge representations, medical vocabularies, and clinical practice guidelines to facilitate safe decision support. This register records the licensing basis, permitted operational scope, attribution obligations, and distribution constraints for each integrated clinical terminology source.

---

## 2. Integrated Terminology Licenses

### 2.1 SNOMED CT (Systematized Nomenclature of Medicine -- Clinical Terms)
- **Licensing Authority:** SNOMED International & National Resource Centre for EHR Standards (NRCeS), Ministry of Health and Family Welfare (MoHFW), Government of India.
- **License Type:** SNOMED International Affiliate License (India Member Territory).
- **Access Basis:** Royalty-free access within India under the National Country License held by the Government of India.
- **Licensing Requirements:**
  - Deployment and distribution within India require registration of an **Affiliate License** through the NRCeS Affiliate Licensing Portal (https://www.snomedctnrc.in/).
  - Annual Usage Reports must be submitted to NRCeS detailing application deployments.
  - Sublicensing: End-users of software containing SNOMED CT within India are covered under the national release; international redistribution requires SNOMED International licensing.
- **Project Permitted Use:** Clinical concept resolution, symptom entity mapping, and interoperability code generation (research & non-commercial clinical decision support).
- **Redistribution Constraint:** Raw SNOMED CT distribution tables must not be bundled in public open-source Git repositories without licensing validation. Only derivative concept IDs and mapped relationship tables are utilized.

### 2.2 Unified Medical Language System (UMLS) Metathesaurus
- **Licensing Authority:** U.S. National Library of Medicine (NLM), National Institutes of Health.
- **License Type:** UMLS Metathesaurus License Agreement.
- **Access Basis:** Individual and institutional user licensing; access provided following NLM license verification.
- **Vocabulary Source Level Restrictions:**
  - UMLS aggregates multiple vocabularies with distinct copyright categories:
    - *Category 0 (Public Domain / Open)*: MeSH (Medical Subject Headings), NCBI Taxonomy.
    - *Category 1 (Open with Attribution)*: MedDRA (excluded from distribution).
    - *Category 2 (Country License Required)*: SNOMED CT (covered via NRCeS in India).
    - *Category 3 (Special Permission Required)*: CPT, LOINC (LOINC is free for research with copyright notice).
- **Project Permitted Use:** Entity normalization and synonym resolution in developmental test harnesses.
- **Redistribution Constraint:** Raw UMLS Knowledge Source (RRF) files are strictly excluded from repository check-ins via `.gitignore`.

### 2.3 MedlinePlus XML Clinical Knowledge Corpus
- **Licensing Authority:** U.S. National Library of Medicine (NLM).
- **Access Basis:** Publicly accessible federal government health information.
- **Permitted Scope:** MedlinePlus XML health topics are available for free download and integration into health informatics systems.
- **Attribution Requirement:** Explicit citation of MedlinePlus and the U.S. National Library of Medicine in all clinical retrieval outputs.
- **Implementation Status:** 2,112 processed passages indexed locally with source provenance.

### 2.4 RxNorm & DailyMed
- **Licensing Authority:** U.S. National Library of Medicine (RxNorm) & U.S. Food and Drug Administration (DailyMed).
- **Access Basis:** Free open access for healthcare software developers.
- **Usage in MedVoice:** Offline medication identification, brand-to-generic mapping, and structured contraindication rules.

---

## 3. Terminology Data Storage & Repository Boundary Invariants

To guarantee license compliance:
1. **No Raw Relational Terminology Dumps**: Multi-gigabyte raw UMLS (`MRCONSO.RRF`) and SNOMED release bundles are machine-excluded via `.gitignore`.
2. **Derivative Concept Lookups Only**: MedVoice includes only curated, task-specific concept dictionaries (e.g., universal red-flag lemma lookups) compiled specifically for emergency recognition.
3. **Audit Trail Verification**: Any automated tool evaluating entity normalization must verify that local terminology extracts operate within open category permissions or licensed affiliate boundaries.
