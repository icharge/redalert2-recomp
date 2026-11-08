# Selectable Launcher Themes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task, with test-driven development and a final independent review.

**Goal:** Make the preserved launcher and all six trials selectable in the real app.

**Architecture:** A React Launcher owns the cinematic presentation and delegates collection management to Library. Scoped CSS preserves the trial designs; a lifecycle hook owns motion. A validated local preference persists the theme.

**Tech Stack:** Existing React, TypeScript, Radix, CSS, Vitest and Playwright; no new packages.

**Spec:** docs/superpowers/specs/2026-10-25-launcher-themes.md

## Global Constraints

- Original prototype files remain unchanged.
- Retro modern is the default; all seven options are available without reloading.
- Reuse real actions and readiness checks; no prototype navigation or mock game data in production.
- Honor reduced motion and clean up effects on theme changes, hidden pages and unmount.
- Work only in the new worktree. No changes to unrelated working-copy changes.

## Review Focus

- Missing, invalid or unavailable storage leaves a usable default and session selection.
- Switching themes preserves edition and installation choices.
- Empty and unfinished installations retain import/resume actions and cannot launch.
- Rapid theme changes cannot leave effects, listeners or frames running.
- Mobile and short viewports keep Play, appearance and dialogs reachable.

### Task 1: Theme preference and real launcher

**Files:** Create storage/launcher-theme.ts and tests; screens/Launcher.tsx and tests under web/src. Modify App.tsx to render Launcher. Keep Library as collection management.

**Interfaces:** readLauncherTheme(storage?) and writeLauncherTheme(theme, storage?); Launcher consumes LibraryProps. Theme IDs match comparison variants plus retro.

- [x] Write and run failing persistence and launcher tests, covering all seven selections, restore, invalid/blocked storage, preserved edition and real callbacks/readiness.
- [x] Implement validated preferences, themed React layouts, accessible appearance picker and real management dialogs.
- [x] Run preference, Launcher, Library and App tests and typecheck.

### Task 2: Visuals and motion

**Files:** Create web/src/launcher/ scoped CSS, useLauncherMotion.ts and artwork. Document source mappings.

**Interfaces:** Root data-theme and data-edition drive scoped styles. Motion hook accepts root ref and theme; returns no DOM mutations beyond animations.

- [x] Transfer baseline and six trial CSS with launcher-only scoping; reproduce structural layouts declaratively.
- [x] Add cleaned-up entrance/feedback/atmosphere effects with reduced-motion and hidden-page handling.
- [x] Verify all themes at mobile and desktop sizes, theme changes, edition switching and dialogs in Chrome; capture screenshots.

### Task 3: Final verification and review

- [x] Run full unit suite, typecheck, build, targeted lint/format and diff checks.
- [x] Request independent review; resolve material findings and rerun affected checks.
- [x] Document usage, source mappings and verification evidence. Leave changes reviewable in the worktree; no commit or merge requested.
