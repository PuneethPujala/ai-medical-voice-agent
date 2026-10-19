# MedVoice — Design System & Engineering Contract (DESIGN.md)

This document is the canonical design contract for MedVoice. It defines the visual identity, typography, color palette, spatial rhythms, component architectures, motion guidelines, and visual verification standards. All frontend engineering and UI modifications must adhere strictly to these standards.

---

## 1. Brand Essence & Clinical Aesthetic Stance

- **Aesthetic Stance**: *Clinical Precision Minimal* — high-craft, crisp, luminous, and reassuringly professional.
- **Core Principle**: Medical authority meets consumer simplicity. We design for high-trust clinical environments where clarity saves lives and ambiguity introduces risk.
- **No-AI-Slop Mandate**:
  - Avoid gratuitous floating gradients, rainbow neon strokes, and arbitrary card stacking.
  - Every surface, border, and transition must have functional intent (spatial hierarchy, interactive affordance, or clinical status indication).
  - High contrast for medical readability; strictly no light gray text on white backgrounds.

---

## 2. Canonical Color Palette & Four-Color Brand System

MedVoice is anchored by an intentional, surgical four-color visual identity:

### Core Four-Color Identity
| Token | Hex | Role & Functional Responsibility |
| :--- | :--- | :--- |
| **Pearl White** | `#FAF9F6` | **Main Canvas**: Primary background for pages, cards, and footer canvas. Soft, warm, non-stark editorial white. |
| **Ink Black** | `#05070F` | **Typography**: Monumental `MEDVOICE` wordmark, section headings, and primary high-contrast reading text. |
| **Forest Graphite** | `#18251D` | **Buttons & Controls**: Primary CTA buttons, key dark interactive surfaces, with pure white text. |
| **Acid Mint** | `#B7FF72` | **Shader & Highlights**: Localized footer shader, restrained atmospheric glows, icons on dark buttons, hover accents. |

### Color Usage Governance
- **Restraint Over Excess**: Acid Mint (`#B7FF72`) is a surgical highlight and unexpected visual signature. It must **never** be used to flood entire screens or create neon backdrops.
- **Canvas Purity**: All canvases remain warm Pearl White (`#FAF9F6`).
- **Button Invariant**: Primary CTAs always use Forest Graphite (`#18251D`) with white text and Acid Mint (`#B7FF72`) icons/details.
- **Clinical Urgency**: Emergency dispatch and critical ESI 1-2 alerts retain clinical red/rose (`bg-rose-600`) as non-negotiable patient safety markers.

---

## 3. Typography Scale & Hierarchy

- **Font Family**: Plus Jakarta Sans (`var(--font-plus-jakarta)`), fallback to system sans.
- **Display 1 (Hero)**: `text-4xl md:text-6xl font-bold tracking-tight text-slate-950 leading-[1.1]`
- **Display 2 (Section)**: `text-3xl md:text-4xl font-semibold tracking-tight text-slate-950 leading-[1.2]`
- **Heading 3 (Card)**: `text-xl md:text-2xl font-semibold text-slate-950`
- **Subheading (Clinical Lead)**: `text-base md:text-lg text-slate-600 leading-relaxed max-w-2xl`
- **Body**: `text-sm md:text-base text-slate-600 leading-normal`
- **Caption / Metadata**: `text-xs font-medium text-slate-400 tracking-wide uppercase`

---

## 4. Layout Architecture & Component Design Rules

### App Shell & Header
- **Navbar**: Preserved sticky top header with `GooeyNav` indicator, crisp border (`border-b border-slate-200/80`), and backdrop blur.
- **Max Width**: Standardized content container at `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`.
- **Card Geometry**: Standard rounded corners `rounded-2xl` for major cards, `rounded-xl` for interactive pills and controls.
- **Shadows**: Soft, multi-layered diffuse elevation:
  - `shadow-sm`: `0 1px 2px 0 rgb(0 0 0 / 0.05)`
  - `shadow-soft`: `0 10px 30px -10px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02)`
  - Never use harsh black drop-shadows.

---

## 5. Animation & Motion Architecture

Motion in MedVoice must feel **deliberate, organic, and non-blocking**. It informs the clinician or patient of system status without delaying interaction.

### The Animation Stack
1. **Lenis (`lenis`)** — *Smooth Scroll Foundation*:
   - Governs full-page scroll physics.
   - Synchronized directly to GSAP's ticker (`gsap.ticker.add(...)`) to eliminate scroll stutter and frame drops.
2. **GSAP (`gsap`, `@gsap/react`)** — *Orchestrated Storytelling*:
   - ScrollTrigger for scrubbed progress, pin-based stage transitions (*Listen → Understand → Act*), and layered parallax.
   - Staggered headline and metric reveals.
   - All timelines must clean up properly on unmount (`ctx.revert()`).
3. **Motion for React (`motion/react`)** — *Everyday Component Interactions*:
   - Button press scale (`whileTap={{ scale: 0.98 }}`), gentle card lift (`whileHover={{ y: -2 }}`).
   - Layout transitions (`layoutId` for active tab indicators and modal dialogs).
4. **CSS Transitions**:
   - Micro-state color shifts and border fades (`transition-colors duration-200 ease-out`).

### Motion Governance & Constraints
- **Timing Scale**:
  - Micro-interactions (hover, active): `150ms - 200ms`
  - Content reveals & collapses: `300ms - 400ms`
  - Section-level ScrollTrigger sequences: Scrubbed or `600ms - 800ms`
- **Easing**: Default `cubic-bezier(0.16, 1, 0.3, 1)` (smooth deceleration).
- **Reduced Motion**:
  - Every animated component must honor `@media (prefers-reduced-motion: reduce)`.
  - Provide immediate static fallbacks with zero opacity/translation delays when reduced motion is preferred.

---

## 6. Required Reference Library

The following official documentation sources are mandatory references for any relevant frontend or animation task:

1. **Lenis**: [lenis.darkroom.engineering](https://lenis.darkroom.engineering/) — Smooth scroll lifecycle, GSAP ticker integration, anchor link handling.
2. **GSAP**: [gsap.com](https://gsap.com/) — ScrollTrigger, timeline sequencing, pinning, split-text reveals, and cleanup.
3. **Motion for React**: [motion.dev](https://motion.dev/) — Gesture animations, layout springs, exit/enter animations, React 19 compatibility.
4. **React Spring**: [react-spring.dev](https://www.react-spring.dev/) — Consult only when physical drag inertia or advanced spring physics are required.
5. **Anime.js**: [animejs.com](https://animejs.com/) — Consult only for specialized SVG path morphing or standalone canvas animation.
6. **Awesome Design MD**: [getdesign.md](https://getdesign.md/) — Design system structures, typography scales, token contracts.
7. **Lando**: [lando.dev](https://lando.dev/) — Local dev environment orchestration. **Note:** Lando is an infrastructure tool, not a frontend animation package.

---

## 7. Build → Inspect → Correct Verification Loop

Frontend changes are never approved based solely on code compilation. Every visual task must follow the 5-step loop:

1. **Baseline Audit**: Inspect existing layout and capture baseline state before modification.
2. **Design Specification**: Cross-reference against this `DESIGN.md` and installed skills.
3. **Implementation**: Edit components within the existing Next.js app shell; never create a duplicate page.
4. **Browser Verification (Playwright)**:
   - Capture desktop (1440px) and mobile (375px) screenshots.
   - Verify zero console errors, zero failed network requests, and zero horizontal overflow.
5. **Report Evidence**: Provide exact screenshot diffs, checks performed, and test statuses.

---

## 8. Canonical Reference-Evidence Ledger

The visual and interaction design of MedVoice is grounded in verified patterns from curated design archives. Each pattern is adapted to our clinical requirements:

| Gallery Reference | Inspected Pattern & URL | Visual / Interaction Lesson | MedVoice Adaptation |
| :--- | :--- | :--- | :--- |
| **Scrolltide** | [scrolltide.com](https://scrolltide.com) · Continuous Pinned Canvas Scrubbing | Avoid disconnected fade cards. Pin the section and continuously transform a central canvas based on scroll progress. | `OrchestratedClinicalJourney.tsx`: Pinned 4-stage viewport where conversational speech physically decomposes into ICD-10 tokens, passes through the deterministic safety gate, and resolves into structured FHIR/SOAP bundles. |
| **Navbar Gallery** | [navbar.gallery](https://navbar.gallery) · Floating Frosted Pill Header | Floating header with `backdrop-blur-xl`, micro-border `border-slate-200/80`, centered pill nav, and clean brand telemetry. | `ArchitecturalNavbar.tsx`: Light frosted glass shell with sticky elevation, truthful emergency routing badge (108/112), and active consult trigger. |
| **Supahero** | [supahero.io](https://supahero.io) · Light Editorial Hero & 3D Centerpiece | Generous display typography (`leading-[1.12]`), restrained ambient teal/cyan light wells, and signature 3D sculptural visual. | Hero section in `app/page.tsx` featuring the validated transparent iridescent sculptural acoustic ribbon, high-contrast typography, and technical capability badges. |
| **Refero** | [refero.design](https://refero.design) · High-Density Clinical Schema Display | Dissect raw narrative into structured token chips with semantic tinting (rose = acute, emerald = negated, teal = confirmed). | `AmbientAcousticConsole.tsx` and Stage 2 of `OrchestratedClinicalJourney.tsx` displaying ICD-10 R07.9, NegEx invariants, and ESI urgency badges. |
| **CTA Gallery** | [cta.gallery](https://cta.gallery) · High-Contrast Dual Action Cluster | Grounding deep slate-950 primary button paired with a crisp white/bordered secondary action, avoiding competing primary colors. | Hero dual CTA cluster: "Start Voice Consultation" (`bg-slate-950`) + "Explore Hospital Network" (`bg-white border-slate-200`). |
| **Footer.design** | [footer.design](https://footer.design) · Architectural Brand Ledger | Top emergency crisis rail, multi-column functional index, and transparent architecture policy disclosure. | `ArchitecturalBrandLedgerFooter.tsx`: Crisis dispatch rail (Ambulance 108 / Emergency 112), zero persistent disk retention policy, and legal decision-support sign-off. |
| **getdesign.md** | [getdesign.md](https://getdesign.md) · Anti-Slop Design Token Governance | High-contrast ink scales, no light gray text on white, purposeful borders, and strictly no gratuitous neon gradients. | Sections 1–4 of `DESIGN.md`: `#020617` primary ink, `#FAF9F6` canvas, `#ffffff` cards, and deliberate functional motion. |
