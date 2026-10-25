# Native Match Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Save RA2/YR native Custom Match reports as unranked history.
**Architecture:** Native INetUtil sends copied packets to the authenticated browser client; a dedicated server endpoint validates the STARTG context and archives sanitized reports with existing history storage. Native completion is asynchronous and independent of relay cleanup.
**Tech Stack:** C/Emscripten COM bridge, TypeScript/Vitest, Bun/SQLite.
**Spec:** ../specs/2026-10-25-native-match-results-design.md

## Global Constraints

- Current checkout; preserve unrelated work. Commit only this feature when requested; no public deployment.
- No ladder, MMR or point changes. Keep ranked ingestion unchanged.
- No gameplay runs: the user owns that testing. Generated artifacts remain local.
- Operator-configured HTTP URL and context paths; never use legacy host/port for browser fetches.

## Review Focus

- Lobby return during HTTP submission must not discard or relabel the report.
- Re-login and sink replacement must not receive a stale completion.
- Native fields have native lengths and four-byte padding, including numeric IDNO.
- Conflicting, incomplete and duplicate reports must retain provenance without awarding points.
- AI/observer records and sensitive native fields must not corrupt roster checks or archives.

### Task 1: Decode and archive native reports

**Files:** sibling `ra2web/server/src/ladder/nativeGameRes.ts`, `http/nativeResults.ts`, `http/routes.ts`, `ladder/LadderService.ts`, storage interface and both implementations; `gserv/GservManager.ts`, `server/WolServer.ts`; tests `test/nativeResults.test.ts`.
**Interfaces:** `decodeNativeGameRes(bytes: Uint8Array): NativeGameRes`; `LadderService.recordNativeReport(gameId, reporter, report): void`; POST `/native-results/{gameId}` with Bearer session and raw packet. Server instance `nativeSku?: number` binds edition to channel type 33/41. Unscored payload has `nativeReports` audit entries and summary; storage `upsertUnscoredLadderMatch` never changes a scored row.

- [x] Write synthetic native field fixtures and failing tests: both SKUs, byte/boolean/int/string/binary widths, statistics, redaction, malformed/truncated fields, missing/duplicate required fields, authentication, numeric ID and SKU mismatch, human roster membership with AI records, duplicate/conflicting/incomplete reports, both storage engines and unchanged standings.
- [x] Run `bun test test/nativeResults.test.ts` in sibling server; verify RED.
- [x] Implement bounded parser, dedicated authenticated endpoint, server SKU binding and unscored persistence with per-reporter bounded audit history. Keep terminal summary over incomplete updates; show disagreement explicitly.
- [x] Run focused native tests plus existing ranked/storage/admin tests; verify GREEN. Run server typecheck.

### Task 2: Browser result submission

**Files:** `web/src/game/wol.ts`, `wol.test.ts`, `loader.ts`, `loader.test.ts`.
**Interfaces:** `WolClient.submitNativeResult(gameId: string, packet: Uint8Array): Promise<void>`; module `ra2WolReport(requestId: number, gameNumber: number, packet: Uint8Array): void`. Completion line `@wolapi gameres <requestId> <HRESULT>` to the native receive queue. Match IDs are captured from STARTG and checked against numeric IDNO.

- [x] Write failing transport/lifecycle tests: authenticated POST with prefix, copied bytes, failure/timeout, PART/lobby return, new login/context, stale completion.
- [x] Run focused Vitest files and observe RED.
- [x] Implement bounded HTTP request and retained per-client match contexts, excluding tickets/passwords from payload. Do not stop relay on native game-end notification.
- [x] Run focused tests, typecheck and scoped lint; verify GREEN.

### Task 3: Native capture and completion ABI

**Files:** `src/web/wolapi.c`, `wolapi_selftest.c`.
**Interfaces:** INetUtil slot 3 `(host, port, data, length)` calls browser report hook; slot 7 pumps native result completions; INetUtilEvent slot 5 receives one HRESULT. `RequestGameEnd()` succeeds as a lifecycle-only notification, without fabricating scores or clearing match state.

- [x] Add failing selftests for stack cleanup, immediate copy, binary NUL/high bytes, invalid bounds, delayed success/failure, duplicate/stale completion and sink changes.
- [x] Compile/run selftest for both edition defines and verify RED.
- [x] Implement capture using main-thread synchronous byte copy; track request generation/sink and pump completion on game thread. Verify existing native Custom Match report enqueue path statically; preserve original offline/LAN code.
- [x] Compile/run both selftests and verify GREEN.

### Task 4: Integration review and delivery

- [x] Run full frontend suite, typecheck, relevant server suite and both COM tests. No gameplay.
- [x] Build private RA2 and YR artifacts without publishing over live assets.
- [x] Fresh independent code review of changed files; fix material findings and rerun affected checks.
- [x] Update handoff and manual result-inspection steps, record test evidence and limitations.

## Execution rulings and progress

- User approved implementation; execute inline without another plan approval round.
- Reuse existing unscored payload storage rather than adding a separate result database. Persist sanitized packet bytes, not legacy account/IP fields.
- Research: original type library confirms INetUtil slot 3 and callback slot 5; YR builder 0x6c6f50, RA2 builder 0x698d00. Native slots are zero indexed; native IDNO is numeric. Verify widths from FieldClass constructors and PacketClass serialization before fixtures.

### Execution ledger

- Task 1 implemented: 59 focused server tests pass, including existing ranked and ladder tests, both storage engines, provisional outcomes, protected ranked rows, bounded input and late-report lifecycle. Server TypeScript passes.
- Task 2 implemented: 43 focused browser tests pass, including prefix/authentication, binary copying, timeout, HTTP rejection, explicit storage ACK, lobby return, new login and new-match isolation. TypeScript and scoped ESLint pass.
- Task 3 implemented: both RA2 and YR COM selftests pass. Observed RED before result implementation and before the retry-pump fix. Original completed-match logs corroborate that native Custom Match invokes the report builder; no extra native hook needed.
- Full frontend suite: 287 tests / 35 files passed before the final acknowledgement/timeout assertions; the final focused rerun covers those changes.
- Ruling: snapshot the message queue's write index for each pump — native OnGameresSent failure can synchronously request another send and queue another failure; the previous drain-until-empty loop could starve the game thread. A finite retry fixture failed before and passes after this change.
- Ruling: require a JSON storage ACK matching gameId and `ranked:false`, not HTTP 200 alone — prevents a proxy/login response from being reported as stored.
- Ruling: native instances become active after all roster peers connect and retain their server metadata after the last departure — required to accept results from long matches and late score continuation.
- Ruling: execute in the authorized current checkout, leave changes uncommitted and do not replace another task's live preview assets. Repaired missing frontend packages from the offline pnpm cache without changing dependency versions.
- Independent fresh review found no material issues. A follow-up reviewed the pump snapshot and explicit ACK changes and found no material issues.
- Broader admin tests: three replay-fixture failures on Windows due to colon-containing filenames. Native/ranked result tests remain green; no unrelated fixture changes made.
- Both private edition rebuilds succeeded. RA2 required prewarming the already-installed default FreeType/HarfBuzz variants before SDL_ttf, then compiling objects with EMCC_DEBUG=0 and linking with EMCC_DEBUG=1. Published WASM SHA256 matches both build outputs. No public deployment or gameplay tests.

- Final WOL creation/gserv lifecycle regression: 63 additional tests passed, bringing focused server checks to 122 across six files. Both repository diffs pass whitespace checks. Live preview unchanged.
- Commit checkpoint: the user requested commits. Fresh pre-commit verification passed (43 browser tests, 122 server tests and both COM variants). Companion RA2Web server commit: `9752731`; bridge, tests and feature documentation form the paired recomp commit. Unrelated latency/compression work is excluded.
