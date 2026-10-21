<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# MedVoice — Design & Frontend Engineering Contract

## 1. Design Quality & Permanent Skills
- **Mandatory Quality Standard**: Treat premium visual craft and clinical clarity as default requirements, not optional polish.
- **Global Design Skills**: The following global skills are installed under `C:\Users\punee\.gemini\config\skills\` and must be invoked for corresponding tasks:
  1. `design-taste-frontend`: Use for art direction, visual composition, typography hierarchy, and non-generic page styling.
  2. `redesign-existing-projects`: Use when auditing and upgrading existing pages to high craft without breaking functionality.
  3. `web-design-guidelines`: Use for objective interface audits against accessibility, keyboard navigation, and UX best practices.
  4. `image-to-code`: Use when reproducing design references or screenshots faithfully inside the existing application.
  5. `playwright-skill`: Use for automated browser testing, dev-server verification, and layout validation.
- **Canonical Design Specification**: Consult `DESIGN.md` at the project root for the authoritative color palette, typography scale, spacing tokens, and component guidelines before writing UI code.

## 2. Product Preservation & Workspace Boundaries
- **Preserve Existing Architecture**: Always work inside the established Next.js application shell.
- **Landing Page Redesign Scope**: The public landing page (`app/page.tsx`) is explicitly authorized for a complete creative redesign from scratch (signature acoustic motif, progressive storytelling, motion architecture, non-generic footer and CTA).
- **Preserve Working Product Routes**: Protect `/consult`, `/care`, `/profile`, `/history`, and all active consultation workflows. Do not break or alter their routing, UI, or state.
- **Do Not Disrupt Core Logic**: Never alter clinical decision logic, triage rules, Kokoro TTS pipelines, hospital routing APIs, or Clerk authentication as part of a frontend or visual task.
- **No Unsubstantiated Claims**: Strictly eliminate unsubstantiated regulatory and safety assertions (e.g. "HIPAA Invariant Active", "zero hallucinations", "verified accreditation"). Use accurate, evidence-backed statements (e.g. "Deterministic ESI preemption", "In-memory ephemeral buffer", "Investigational clinical decision support").
- **Coordinate Across Workstreams**: Respect branch and worktree boundaries. Do not modify unrelated voice-intake or authentication files. Work exclusively inside `c:\dev\Capstone-landing`.

## 3. Motion Architecture & Implementation Hierarchy
- **Stack Roles**:
  - **Lenis (`lenis`)**: Governs smooth page scrolling. Must bind to GSAP's ticker to ensure synchronous frame execution.
  - **GSAP (`gsap`, `@gsap/react`)**: Governs orchestrated scroll sequences, ScrollTrigger pinning, SplitText reveals, and section storytelling.
  - **Motion for React (`motion/react`)**: Governs React component micro-interactions (press scale, hover lift, layout shifts, spring feel).
  - **CSS Transitions**: Used for simple 150ms-200ms color and border state changes.
- **No Competing Engines**: Avoid overlapping animation libraries on the same DOM element.
- **Accessibility**: Honor `prefers-reduced-motion` everywhere with instant, non-animated fallbacks.

## 4. Mandatory Reference Sources
For relevant engineering tasks, consult the official documentation:
- **Lenis**: https://lenis.darkroom.engineering/ (smooth scroll & lifecycle)
- **GSAP**: https://gsap.com/ (ScrollTrigger, timelines, cleanup)
- **Motion for React**: https://motion.dev/ (component animations & gestures)
- **React Spring**: https://www.react-spring.dev/ (physics-based interactions only when needed)
- **Anime.js**: https://animejs.com/ (specialized SVG path/micro-animations only when needed)
- **Awesome Design MD**: https://getdesign.md/ (design tokens & system patterns)
- **Lando**: https://lando.dev/ (local container dev environments; not for frontend animation)

Verify all APIs against installed package versions before implementation.

## 5. Build → Inspect → Correct Verification Loop
- **Baseline First**: Capture existing layout and component states before modifying code.
- **Live Browser Inspection**: Use Playwright to inspect the running dev server on both desktop (1440px) and mobile (375px) viewports.
- **Runtime Checks**: Actively verify zero browser console errors, zero failed network requests, and zero horizontal scroll overflow.
- **Evidence-Based Completion**: Distinguish between *code written*, *tests passed*, and *visually verified*. Never claim visual success without capturing and inspecting real browser output.
