# Game URL Without Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `/game?edition=...` the normal game URL while keeping existing `/game/:slot` links working through a redirect.

**Architecture:** Resolve `/game` from the existing active-install and edition selection state in `App.tsx`. The legacy route records its numeric installation as active, then replaces the URL with `/game` while preserving the query string. Keep slot IDs in IndexedDB, OPFS, and interrupted-import resume URLs.

**Tech Stack:** React Router, TypeScript, Vitest and Testing Library (existing suite), Markdown documentation.

**Spec:** `docs/superpowers/specs/2026-11-08-game-url-without-slot-design.md`

## Global Constraints

- New imports remain limited to one installation per browser.
- RA2 and Yuri's Revenge remain editions within one installation and matching files remain shared.
- Internal installation slot IDs and `?resume=<slot>` remain supported.
- The edition remains selectable through `?edition=ra2` or `?edition=ra2md`.
- A valid legacy game URL selects its installation and then uses history replacement to reach `/game`.

## Review Focus

- A legacy link to an older but valid installation selects that exact installation before redirecting.
- A missing legacy slot does not launch another installation by mistake.
- Edition and runtime query parameters survive the legacy redirect.
- The canonical route works under a deployment base such as `/emu/`.
- A direct `/game` visit with no installation shows a useful route error.
- A production `/emu/game` request serves the shell despite the colliding static `game/` asset directory.

---

### Task 1: Canonical game route and legacy redirect

**Files:**

- Modify: `web/src/paths.ts`
- Modify: `web/src/App.tsx`
- Update: `web/src/App.test.tsx` existing route expectations
- Update: `web/e2e/import.mjs`, `web/e2e/perf-nav.mjs`, and `web/e2e/perf-nav.test.mjs` existing route expectations
- Update: `web/e2e/cursor-page-match.mjs`, `web/e2e/cursor-page-menu.mjs`, `web/e2e/playtest.mjs`, and `web/e2e/resolution-load-saved.mjs` existing route expectations

**Interfaces:**

- `gamePath` takes an optional edition and returns `/game` with an encoded `edition` query.
- `/game` resolves the current active installation and selected edition.
- If no edition query is present, use the selected edition of the active installation, then the documented fallback.
- `/game/:slot` validates the old slot, selects it as active, and navigates with `replace` to `/game` while carrying the original query string.

- [x] Change the game path helper and Play navigation to omit the slot segment.
- [x] Make the canonical game route pass the active installation's slot to the existing game loader.
- [x] Add a legacy route handler that selects a valid slot and replaces the URL; preserve the existing invalid-slot error behavior.
- [x] Update existing route assertions for the canonical route and legacy links.

### Task 2: Keep documentation aligned

**Files:**

- Modify: `docs/web/frontend.md`
- Modify: `docs/web/deploy.md`
- Modify: `docs/web/handoff-zerocopy.md`
- Modify: `docs/web/nginx.conf`
- Update: `docs/web/deploy.md` shell-route example
- Modify: `docs/web/decisions.md`

- [x] Document `/game?edition=...` as canonical and `/game/:slot` as a compatibility redirect.
- [x] Add an exact production-server rule for `/emu/game` so the `game/` asset directory cannot shadow the launch route.
- [x] Reconcile D14 with the current one-install importer rule; retain its explanation of old slots as internal/legacy records.
- [x] State that a single installation holds editions and shares matching imported files.

## Verification

- `pnpm --dir web typecheck` passed; Prettier check and `git diff --check` passed.
- Existing test and browser-flow expectations were updated but not run.
- Inspected the diff; manifest keys, OPFS paths, mod selection settings, and resume-import routes are unchanged.
