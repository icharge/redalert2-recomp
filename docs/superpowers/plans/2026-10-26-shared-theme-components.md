# Shared Theme Components Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline with test-driven development and independent review.

**Goal:** Carry all seven launcher appearances into dialogs and other app components.

**Architecture:** A shared provider owns the existing theme preference and publishes a lifecycle-managed document attribute. Scoped component CSS applies palette, materials, typography and interaction tokens to app surfaces and Radix portals; the external file explorer receives themed chrome without changing its data/actions.

**Tech Stack:** Existing React, TypeScript, Radix, CSS, Vitest and Playwright.

**Spec:** docs/superpowers/specs/2026-10-25-launcher-themes.md, Shared component coverage.

## Global Constraints

- Keep the chosen default and original prototype files unchanged.
- Theme selection survives navigation and reaches nested dialogs and dropdowns.
- No new dependencies or runtime network assets.
- Preserve semantic warning/danger colors, keyboard/focus behavior, reduced motion and game pixels.
- Continue in the existing launcher-themes worktree; no commit or merge requested.

## Review Focus

- Portal content inherits the selected theme even though it is outside the launcher DOM.
- Navigating to import retains the selected appearance.
- Nested providers/dialogs do not reset theme, modal state or focus.
- File browser remains usable after theme changes and stylesheet lazy loading.
- Dialog content and controls remain readable and reachable at 320 px and short heights.

### Task 1: Shared state and portal coverage

- [x] Write failing tests for provider, nested reuse, portal selection and route-like launcher unmount.
- [x] Add LauncherThemeProvider and useLauncherTheme; replace local launcher theme state and wrap app.
- [x] Run provider, launcher, App and storage tests.

### Task 2: All component materials and motion

- [x] Apply seven sets of shared surface tokens to dialogs, alerts, select menus, forms, buttons, cards, import and file-browser chrome.
- [x] Add brief theme-specific CSS feedback and entrances; disable motion when hidden/reduced.
- [x] Extend visual fixture and Chrome checks for settings/dropdowns, saves, files, mods, collection/removal and import; inspect desktop/mobile screenshots.

### Task 3: Verification

- [x] Run full web tests, typecheck/build, targeted lint/format and diff checks.
- [x] Independently review and resolve material findings.
- [x] Update usage and verification docs, retaining uncommitted worktree changes.
