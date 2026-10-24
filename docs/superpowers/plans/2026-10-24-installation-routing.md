# Installation Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Launch separate imported installations through context-aware URLs and return to the launcher with saves persisted and the runtime unloaded.

**Architecture:** React Router 7.18.1 owns clean paths under Vite's base. Persistent numeric installations contain edition records referencing isolated file/save/mod namespaces. Document navigation ends a running game; metadata migration preserves legacy OPFS paths.

**Tech Stack:** React 18, React Router 7.18.1, Vite, TypeScript, IndexedDB, OPFS, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-installation-routing-design.md`

## Global Constraints

- One slot per imported folder, with two launch choices when both editions are present.
- Positive persistent numeric slot IDs, never reused.
- Preserve existing imports, saves, mods, preferences, and legacy shared files without copying large OPFS files during migration.
- `/game/:slot` defaults to Yuri's Revenge when available; `?edition=ra2` selects RA2.
- Deployment base applies to routes, assets, runtime files, and service workers.
- No game content or generated lifts committed. Preserve unrelated working changes.
- Implement in the current checkout to retain the already built game and existing user work; no branch integration requested.

## Review Focus

- Reimporting the same edition must create another installation without overwriting the first.
- An interrupted import must explicitly resume its slot instead of allocating or replacing another.
- Removing legacy shared files must compare exact locations, not filenames alone.
- Back navigation and game switches must not leave a live runtime behind the launcher.
- Failed final persistence must prevent navigation and remain retryable.

## Task 1: Installation metadata and migration

**Files:** `web/src/storage/manifest.ts`, `web/src/storage/manifest.test.ts`.

**Interfaces:** Add `InstallationRecord { slot: number; name: string; importedAt: number }`; edition `GameRecord` gains `slot` and `storage` (save/mod namespace), file `home` becomes an opaque namespace string. Add `createInstallation(name)`, `getInstallation(slot)`, `listInstallations()`, `removeInstallation(slot)`; edition operations take a slot as an additional argument, default 1 for legacy API callers. `listGames(slot?)` returns edition records.

- [x] Write tests for two same-edition slots, transactional stable IDs, upgrade from v1 retaining file/save/mod references, resume isolation, exact-reference deletion, and missing slots.
- [x] Run `pnpm test src/storage/manifest.test.ts`; observe failures.
- [x] Upgrade IndexedDB to v2 with installation and compound-key edition stores; keep legacy OPFS references. New slots use `slot-N` data and `slot-N-<edition>` save/mod namespaces.
- [x] Rerun focused tests until green.

## Task 2: Import and storage isolation

**Files:** `storage/{importer,opfs,saves,mods,thai-fonts,file-browser}.ts`, their tests, `components/ModLibrary.tsx`, `game/loader.ts` and tests.

**Interfaces:** `runImport` accepts optional explicit resume slot and returns its slot; otherwise creates one installation for all detected editions. Read/write functions accept namespace strings; actual edition selection remains `GameId`. Loader restores saves/mods using `record.storage`, reads files using `entry.home`, and selects executable using `record.id`.

- [x] Add failing tests for repeated complete imports, shared files only within one slot, explicit resume, isolated mods/saves/preferences, and safe removal of only one installation.
- [x] Run affected Vitest files and observe missing behavior.
- [x] Implement the storage namespace changes and import lifecycle, retaining old namespaces during migration.
- [x] Run affected tests and typecheck; update fixtures to describe complete edition records.

## Task 3: Base-aware URLs and service worker

**Files:** create `web/src/paths.ts` and tests; modify `game/loader.ts`, `storage/install.ts`, `components/file-explorer-assets.ts`, `sw.ts`, `swlogic.ts` and tests, `vite.dev-game.ts`, `vite.config.ts`, `index.html`, relevant e2e fixture routing.

**Interfaces:** `appPath(relative, base = import.meta.env.BASE_URL): string` joins a deployment base and application-relative path. Guest virtual paths stay `/game`. Runtime/public paths use `appPath`. Service-worker matching takes the configured base and ignores URLs outside it; navigation fallback is base-relative.

- [x] Add failing tests for `/emu/` runtime/build/file-browser URLs and worker matching excluding sibling bases.
- [x] Run focused Vitest tests and observe failures.
- [x] Implement base paths and base-scoped worker cache names; dev fixture transport strips its observed prefix safely.
- [x] Verify root and prefixed production builds/typecheck.

## Task 4: Router and installation launcher

**Files:** `web/package.json`, lockfile, `src/App.tsx`, `App.test.tsx`, `screens/{Library,Import}.tsx`, tests.

**Interfaces:** BrowserRouter basename is the deployment base. Routes `/`, `/import`, `/game/:slot`, fallback. Launcher groups edition records by installation and links to route-selected editions. `/import?resume=<slot>` resumes an incomplete installation. Slot validation rejects malformed/nonpositive IDs. Selection is stable across reloads and bookmarks.

- [x] Install React Router 7.18.1; add failing route tests for deep links, default/explicit editions, empty/incomplete/missing slots, grouping duplicate editions, and launcher links.
- [x] Observe failures, then implement route rendering and grouped installation cards, removing edition-keyed resume navigation.
- [x] Keep legacy `?dev`/`?test` fixtures functional; use full document navigation when departing an already loaded runtime.
- [x] Run screen/route tests and typecheck.

## Task 5: Exit cleanup and persistence

**Files:** `screens/Play.tsx`, `game/{audio,loader}.ts`, `components/LanPanel.tsx`, create focused lifecycle helper/tests if needed, `web/e2e/exit-confirm.mjs`.

**Interfaces:** On terminal runtime state, stop browser callbacks synchronously without invoking dead exports. Await session/save readiness, stop save polling and flush. On success replace document with `appPath('')`; on failure show retry. Crashes retain diagnostics. Normal mod restarts reload current slot/edition URL.

- [x] Extend real browser Exit test to require launcher navigation, absent module/session globals, zero old game workers; baseline failed because navigation is absent and dead exports are still polled.
- [x] Add focused tests proving no navigation before persistence, retry after failure, and no WASM calls after shutdown.
- [x] Implement cleanup and exit navigation, including Back/switch handling.
- [x] Run focused tests, then real Exit tests for both games at root and prefixed base.

## Task 6: Verification and documentation

**Files:** `docs/web/{frontend,storage,deploy,testing,progress}.md`, e2e routing checks.

- [x] Exercise migration, two installations, edition selection, and save separation in an integration test. Verify direct route reload at `/emu/game/1` and service-worker offline navigation under the prefix.
- [x] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, focused ESLint, and `git diff --check`; report any unrelated failures by name.
- [x] Document routes, installation layout/migration, context-path build/rewrite commands, and exit lifecycle.
- [x] Obtain a fresh code review, address material issues, and report only verified behavior. Leave the requested dev server running.

Execution is native in this session. Design and implementation are already authorized; no extra implementation approval is requested. No commits are planned because unrelated work shares this checkout.
