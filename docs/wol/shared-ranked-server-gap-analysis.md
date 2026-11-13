# Shared ranked server: gap analysis and task breakdown

Reviewed: 11 November 2026 against the local, uncommitted working trees.

Input: [handoff-shared-ranked-server.md](handoff-shared-ranked-server.md),
[shared-ranked-server.md](shared-ranked-server.md), and the sibling
`ra2web/docs/superpowers/plans/2026-11-11-shared-ranked-wol-vera.md`.
Also inspected Vera's `docs/lobby-protocol.md` and client wire types.

This is a review and proposed backlog, not an approved implementation design.
No product code was changed. The decisions below are recommendations unless
already recorded in the handoff.

## Assessment

The handoff correctly identifies the three native integration gaps, but its
recommended order enables native ranked play before the shared scoring and
Vera admission paths are ready. The server has useful implemented surfaces;
it should not yet be treated as a release-ready shared ranked service.

The first milestone should establish trustworthy, isolated, durable scoring.
The next should prove native ranked play end to end. Native ladder UI and
replay delivery are separate deliverables, with explicit scope decisions.

## Confirmed gaps

Paths beginning `server/` below are in `C:/Users/Norrapat/projects/ra2web`.
P0 means block public ranked enablement; P1 means required for the intended
release; P2 means a separately scoped follow-up.

| Priority | Gap and evidence | Consequence / required work |
|---|---|---|
| P0 | `VeraLobby.finish()` uses `matchById()` instead of the participant-checking `requireMatch()`. A local probe submitted Alice's report followed by an unrelated guest's matching winner claim. The match scored Alice +12 and Bob -12 without Bob reporting. | The claim that every roster member must agree is currently false. Authenticate the exact reporter set before accepting or settling reports. |
| P0 | Seasons are keyed by `(id, sku)`, but standings use `(username_key, season_id, ladder_type)` and match/history rows omit SKU. Every SKU bootstraps season 1. A RA2-only win made the same account's YR rating 1012. | RA2 and YR contaminate each other's ladders. Define a canonical competition key and migrate storage and reads before adding native scoring. This is an existing storage flaw, not necessarily introduced by the current changes. |
| P0 | `getCurrentSeason()` and `resolveSeason("current")` select the newest season without status/time checks. A probe closed season 1 and then successfully scored a Vera match into it. | Closing ranked play does not stop scoring. Define running-season and boundary rules, including matches crossing a rollover. |
| P0 | `VeraLobby.start()` never checks the stored readiness/map acknowledgements against the current revision, version or digests. A local probe started without any readiness exchange. | The protocol's admission agreement is not enforced. Relay-ready acknowledgements alone do not establish matching game content. |
| P0 | Vera ranking depends on a client-supplied tournament flag, two accounts and the existence of a season. A manually created two-player room can rank without a matchmaker pairing. No AI/co-op/repeat-roster eligibility check appears in that predicate. | The intended ranked eligibility policy is missing. Vera's documented policy also supports some team games, while this implementation rates only two humans. Choose the supported subset explicitly. |
| P0 | `LadderService.recordMatch()` writes individual standings, then the scored match row, then player history through separate storage calls; no transaction wraps settlement. | A storage failure/crash can leave partial ratings or a scored row with missing history. Game-ID deduplication alone does not provide atomic settlement. |
| P1 | Native ranked versions are rejected, normal native QM instances lack `nativeSku`, the result route rejects ranked instances, the browser requires `ranked:false`, and the four ladder COM methods remain stubs. | The handoff's native gaps are real. Split queue admission, result settlement, browser ACK handling and COM presentation into separate tasks. |
| P1 | Native report `GSKU` is not the ladder SKU: the decoder accepts 8960/16640/18688, but the ladder accepts only 16640/18688. | “Set the correct native SKU” is insufficient. Separate wire-edition validation from the canonical competition SKU and test both editions with captured packets. |
| P1 | Vera sessions, active matches, reports and remember tokens are in memory. `/v1/match/resume` always returns `unknown_match`. An incomplete match is archived only after the report-count threshold. | Missing reports, session expiry, host departure and process restart need explicit terminal outcomes and recovery behavior. Unanimity permits a loser to withhold a report; it does not prevent collusion. |
| P1 | `/v1/*` does not reuse WOL login/register limiters; JSON is read with `req.json()`. Replay uploads allocate `req.arrayBuffer()` before the 16 MiB check. | Body/deadline/concurrency and authentication abuse controls need their own work. Vera documents a 64 KiB JSON limit and bounded body arrival; the replay extension needs a separate bounded stream policy. |
| P1 | Vera matchmaking is reevaluated when a Match chat arrives, not by a periodic timer; its window starts at 100 while WOL starts at 120. WOL's missing version bypasses its version gate and is treated as a wildcard by `sameClientFamily()`. | Window widening may never pair an idle Vera queue. Claimed client-family isolation needs missing-version and party tests, plus an explicit shared/different queue policy. |
| P1 | Vera uses one event retention queue, whereas its protocol separates critical and soft events. Current tests cover two lobby cases and three HTTP cases. | Chat pressure, reconnect cursors, retries and stream/poll races are not established by the happy-path tests. |
| P1 | Vera replay upload is documented in code as a future client capability. Downloads use the existing text/plain route, with no format/version metadata. | An upload endpoint does not provide automatic recording/upload or playback in either client. Define replay formats, ownership, overwrite and retention rules. |

## Decisions taken (T0, 12 November 2026)

Settled with the project owner; these supersede the recommendations below.

| # | Decision | Effect on tasks |
|---|---|---|
| 1 | Rating key is `(account, canonical SKU, season, ladder type)`. **Vera is Yuri's Revenge**: `VERA_SKU` becomes 18688 and Vera shares the YR ladder with native/web YR. Source is provenance only. | T2 migration; `veraSku` default and docs change; T9 separates wire GSKU from canonical SKU. |
| 2 | First release ranks **authenticated 1v1 quick match only**, paired per client family. No AI, co-op or custom-room ranking; existing WOL 2v2 behavior is preserved, Vera team/FFA deferred. | T5 and T8 narrow eligibility; no pairing-reservation design for custom rooms. |
| 3 | A report deadline ends in an **unscored incomplete or disputed archive** with a reason; one report never awards a win. **Operator adjudication is in scope**: an admin endpoint resolves disputed/incomplete matches with an audit trail. | T6 gains an adjudication endpoint, audit record and tests. |
| 4 | Season is **bound at admitted start**; reports settle into it within a **grace window** (default 30 min, configurable). New ranked starts need a running season; reports past the grace window are archived unscored. | T3 defines the predicate and window; T4 and T6 use the bound season. |
| 5 | **No native in-game ladder or score-gain UI** in this release; standings come from the HTTP leaderboard/profile. Native ladder screens are planned for later. | **T11 is excluded** and documented as unsupported. T10 handles ACKs only and shows no gain. |
| 6 | Replays: format-aware download **and Vera automatic upload**. Native recomp recording availability is verified per source; cross-engine playback is not promised. | T13 includes a `vera20k` client upload hook and a real-client test. This is the one change needed outside `ra2web` and recomp. |

Consequence for T14: the release gate covers RA2 and YR native, web, and Vera
(YR). Because T11 is excluded, native ladder-screen checks are out of scope.

## Original decision notes (for reference)

1. **Competition identity.** Recommended: one account namespace and one rating
   per canonical SKU, season and ladder type; client source is provenance.
   Vera and WOL share a rating only when mapped to the same competition.
   Confirm which edition Vera belongs to: this is a Yuri's Revenge engine,
   but the server used to default `VERA_SKU` to 16640 (now 18688, decision 1). Do not infer this mapping
   from wire GSKU alone.
2. **Ranked scope.** Recommended first release: authenticated 1v1 quick match,
   separately paired by client family, with no AI/co-op or arbitrary custom-room
   ranking. Existing WOL 2v2 behavior must be preserved; adding Vera team/FFA
   ranking requires its own eligibility/result design.
3. **Unsettled outcomes.** Recommended: report deadline followed by an explicit
   unscored/incomplete or disputed archive; one missing report never awards a
   win. Decide whether deliberate report withholding is acceptable for the first
   release, and whether later adjudication is required.
4. **Season boundaries.** Recommended: capture competition/season at admitted
   start and permit settlement under a documented grace window; do not move a
   late finish into whatever season happens to be newest. Specify expiry,
   manual closure and rollover behavior separately.
5. **Native presentation.** Decide whether initial release needs the in-game
   leaderboard and immediate score gain, or API standings/history are sufficient.
   A storage acknowledgement and completed scoring are different events.
6. **Replay promise.** Recommended: format-specific download and native-client
   playback only in the first release. State whether native recomp recordings
   actually exist and whether Vera auto-upload is required. Cross-engine replay
   playback is a separate project.

## Task breakdown

Each task has an independently reviewable result. Proposed new file names are
suggestions; existing paths identify the actual integration points.
Implementation should turn the decisions above into exact contracts before
writing dependent code.

### T0 — Freeze the release contract and inventory the working state

- **Repo/files:** all three repos; the two shared-ranked docs and sibling plan.
- **Deliverable:** record the six decisions, supported edition/channel/version
  matrix, source values, current baseline revisions and relevant uncommitted
  diffs. Reconcile the short doc's “nothing changes” and score-screen claims
  with the native gaps. Keep unrelated working changes outside this effort.
- **Acceptance:** every required behavior maps to a task below; exclusions such
  as Vera teams, native UI, account recovery and auto-upload are explicit.
- **Depends on:** none. Defect regressions can be prepared while decisions settle.

### T1 — Reject nonparticipant Vera results

- **Repo/files:** ra2web `server/src/vera/VeraLobby.ts`,
  `server/test/veraLobby.test.ts`.
- **Deliverable:** participant authentication before any finish mutation;
  settlement requires the exact authoritative roster, not a report count.
  Validate contradictory/unknown winner claims before deriving an outcome.
- **Acceptance:** outsider submission returns `not_in_match` without mutations;
  one real report plus an outsider cannot score; two valid matching reports score
  once; duplicate and conflicting reports cannot change a finalized result.
- **Depends on:** none; immediate P0 fix.

### T2 — Isolate competition storage and migrate existing data

- **Repo/files:** ra2web `server/src/storage/{Storage,MemoryStorage,SqliteStorage}.ts`,
  `server/src/ladder/LadderService.ts`, ladder/admin/shared-route consumers;
  `server/test/ladderService.test.ts`, `leaderboardRoutes.test.ts`.
- **Deliverable:** carry the agreed competition key through standings, matches,
  player history, season lookup/counts and admin reads. Correct the profile's
  unfiltered history/seasons queries. Define migration, backup and rollback.
- **Acceptance:** same account, season number and ladder type in RA2/YR remain
  independent in memory and SQLite; history and season names have the right
  scope. Migration reopens successfully and does not guess the origin of already
  mixed rows. Document ambiguous historical data requiring operator resolution.
- **Depends on:** T0 competition decision.

### T3 — Make running seasons and match attribution explicit

- **Repo/files:** ra2web `LadderService.ts`, `gserv/GservManager.ts`,
  `matchmaking/MatchmakingBot.ts`, `vera/VeraLobby.ts`, season/admin tests.
- **Deliverable:** one running-season predicate and admitted match context used
  by queue eligibility and settlement; historical reads remain available.
- **Acceptance:** closed/future/expired seasons reject new ranked starts;
  rollover/closure during play and delayed reports follow the chosen policy;
  no silent transfer into a new season; both protocols observe the same state.
- **Depends on:** T0 boundary decision, T2 key contract.

### T4 — Settle ratings and history atomically

- **Repo/files:** ra2web storage interface/backends, `LadderService.ts`,
  `ladderService.test.ts`; add focused storage failure tests if needed.
- **Deliverable:** a storage transaction/settlement boundary containing the
  dedupe check, all standings, scored ledger row and all player history rows.
  Preserve attached replays and native report evidence when promoting archives.
- **Acceptance:** injected failure at a write boundary leaves no partial rating
  changes; reopening/retrying produces one complete settlement. Same game ID
  through either ingest path cannot score twice. Memory and SQLite agree.
- **Depends on:** T2, T3.

### T5 — Enforce Vera admission and ranked eligibility

- **Repo/files:** ra2web `VeraLobby.ts`, `veraLobby.test.ts`;
  reference Vera `docs/lobby-protocol.md` and client options/ready payloads.
- **Deliverable:** authoritative roster, current options revision, readiness,
  version/rules/map/staging agreement, observer/AI handling, and selected ranked
  policy. Freeze admitted options and consume pairing reservations when required.
- **Acceptance:** absent/stale readiness, mismatched digests, changed options,
  forged tournament flags and roster substitution cannot create a ranked start;
  guests and unsupported modes receive an explicit unranked reason.
- **Depends on:** T0 scope, T3; T1 protects result ingestion independently.

### T6 — Define durable report collection and terminal states

- **Repo/files:** ra2web storage backends, `VeraLobby.ts`,
  `ladder/nativeGameRes.ts`, `LadderService.ts`, `http/nativeResults.ts`.
- **Deliverable:** persisted admitted context/reports and explicit pending,
  scored, disputed, incomplete/expired outcomes. If active transport resume is
  excluded, restart still resolves affected games predictably without scoring.
  Specify compatible ACK/status fields: stored does not mean scored.
- **Acceptance:** opposite report arrival orders, repeated provisional/terminal
  packets, OOS, draws, missing reporter, expiry, host leave and server restart
  retain evidence and never manufacture wins. Retry after a settlement failure
  remains possible; terminal decisions and reasons survive reopening.
- **Depends on:** T0 result policy, T2–T4; T1 for Vera reporter checks.

### T7 — Harden Vera HTTP/auth and replay request ingestion

- **Repo/files:** ra2web `http/veraRoutes.ts`, `http/routes.ts`, `index.ts`,
  `auth/accountStore.ts`, config/rate-limit utilities; route/auth tests.
- **Deliverable:** bounded JSON/replay streams, body deadlines and concurrency,
  endpoint-specific rate limits and input schemas. Review shared ban enforcement,
  remember-token lifetime/revocation, reserved names and cross-protocol login
  collisions. Immediate registration and unavailable recovery stay explicit.
- **Acceptance:** oversized/slow/malformed requests fail before state changes or
  whole-body allocation; brute-force limits apply through `/v1/*`; a banned
  account cannot enter through another sign-in mode. WOL account rules regressions pass.
- **Depends on:** T0 supported account/replay contract; independent of native UI.

### T8 — Make queue behavior predictable and family-safe

- **Repo/files:** ra2web `MatchmakingBot.ts`, `VeraLobby.ts`,
  `matchbotVersion.test.ts`, `matchmakingTeamAllocation.test.ts`, Vera tests.
- **Deliverable:** native ranked version acceptance, explicit family/edition and
  ladder mapping, party-member validation, missing-version policy, periodic Vera
  reevaluation and stable tie/wait ordering. Decide whether window constants differ.
- **Acceptance:** native/native and web/web pair; native/web and incompatible
  editions never pair, including omitted versions and mixed parties. Fake-clock
  tests pair waiting Vera entries without new joins; cancellations leave no ghost
  pairings. Test long-wait starvation rather than assuming widening prevents it.
- **Depends on:** T0, T3; keep native scoring disabled until T9/T10.

### T9 — Add native ranked report settlement

- **Repo/files:** ra2web `GservManager.ts`, `MatchmakingBot.ts`,
  `http/nativeResults.ts`, `ladder/nativeGameRes.ts`, `LadderService.ts`;
  native-results/matchmaking/ladder tests.
- **Deliverable:** server-authorized ranked instance context, separate expected
  wire GSKU/canonical ladder SKU, exact authenticated roster consensus, duration
  and terminal/OOS checks, then settlement through T4. Custom history and WDT
  retain their existing semantics; submitting a packet cannot make a game ranked.
- **Acceptance:** captured RA2 and YR packets settle once after agreement;
  mismatched ID/edition/roster, extra humans, incomplete/OOS/too-short/disputed
  reports never score. Both storage backends retain unscored custom/WDT behavior.
- **Depends on:** T2–T4, T6, T8.

### T10 — Handle native stored/pending/scored acknowledgements

- **Repo/files:** recomp `web/src/game/{wol,loader}.ts` and corresponding tests;
  `src/web/wolapi.c`, `wolapi_selftest.c` if callback behavior changes.
- **Deliverable:** accept the agreed strict response shapes, including ranked
  storage before consensus; keep explicit game-ID and storage validation.
  Preserve stale-match/login callback guards and bounded retries.
- **Acceptance:** stored ranked/unranked/pending replies complete the native
  report send correctly; malformed ACK, timeout and stale completion fail safely.
  Do not display a gain before settlement. If gain is required, define an
  authenticated final-result fetch/event usable after lobby/relay teardown.
- **Depends on:** T6 ACK contract, T9. Score UI choice comes from T0.

### T11 — Implement native ladder presentation, if in scope

- **Repo/files:** recomp `src/web/wolapi.c`, `wolapi.h`, `wolapi_selftest.c`,
  browser transport/types and unit tests; `docs/web/testing.md`.
- **Deliverable:** first establish the four methods' argument/structure layouts,
  event sink slots, memory lifetime, rank/point units, paging/locale behavior and
  actual RA2/YR callers. Then implement asynchronous reads and game-thread callbacks.
  Investigate the native score-report callback separately; web numeric `730`
  support does not prove the native COM screen consumes it.
- **Acceptance:** both edition selftests exercise successful, empty, failed and
  stale responses; real native screens show agreed standings/gains without hangs.
  If excluded, document the supported API/web route rather than claiming UI support.
- **Depends on:** T0 UI decision, T2/T3 read contract; T10 for score-result delivery.

### T12 — Verify Vera event/relay interoperability

- **Repo/files:** ra2web `VeraLobby.ts`, `relayGrant.ts`, `index.ts`, Vera tests;
  reference Vera `services/relay-protocol` and `shell_wol/live_service`.
- **Deliverable:** cross-language ticket/key/certificate test vectors; cursor,
  retry and stream/poll behavior matching the released client's contract;
  critical/soft retention policy and renewal/admission timeout handling.
- **Acceptance:** Rust verifier accepts server grants and rejects altered/expired
  ones; real relay admission and renewal work; lost replies/repeated request IDs,
  replaced streams, old cursors and chat pressure preserve critical state.
- **Depends on:** T5/T7; T6 if resume/restart support is included.

### T13 — Deliver format-aware replays and history

- **Repo/files:** ra2web replay upload/download handlers, archive/storage metadata,
  `VeraLobby.saveReplay()` and route tests; client upload hook only if approved.
- **Deliverable:** format/version/provenance metadata, useful download names and
  MIME types, participant/source authorization, upload validation, overwrite and
  retention policy. Verify recorder availability separately for each match source.
- **Acceptance:** each supported client downloads and plays its own supported
  recording; missing replay is explicit; unauthorized or cross-source uploads
  cannot replace a recording. Finish-before-upload and upload retries work after
  restart. If automatic Vera upload is promised, test the real client hook.
- **Depends on:** T0 replay decision, T2/T6 archive contract, T7 bounded ingestion.

### T14 — Run staged integration and prepare rollout/rollback

- **Repo/files:** both servers/clients' test tooling and shared-ranked operator docs.
- **Deliverable:** private integration environment with separate test data,
  feature controls for Vera/native ranked enablement, backup/migration/rollback
  instructions and logs/metrics for settlement outcomes, rejected starts,
  queue waits and replay failures. Pin the reviewed cross-repo revisions.
- **Acceptance:** real two-client RA2, YR and Vera matches traverse queue →
  admission → play → reports → one settlement → history/leaderboard → replay
  where supported. Exercise disconnect, disputed result, season boundary and
  restart cases. Validate HTTPS/WebSocket and the real UDP relay, not just health.
  Reproduce and classify the five historical full-suite failures against an
  identified baseline before treating them as unrelated release exceptions.
- **Depends on:** required T1–T13 deliverables; T11 optional only by T0 decision.

## Execution order

1. Resolve T0 while preparing immediate T1 and storage isolation regressions.
2. Complete T1–T4 before expanding ranked participation.
3. Complete Vera admission/result lifecycle and HTTP controls (T5–T7).
   Queue work (T8) can proceed once competition/season contracts are fixed.
4. Complete T9/T10 as the native ranked vertical slice; verify actual native QM
   reaches the server with `RKD=1`, rather than relying only on synthetic queue tests.
5. Finish required native presentation (T11), Vera interoperability (T12), and
   replay delivery (T13), then the real-client release gate (T14).

These are dependency boundaries, not an instruction to modify multiple repos
concurrently. Keep schema/contract changes coordinated and each task reviewable.

## Verification performed for this review

From `C:/Users/Norrapat/projects/ra2web/server`:

```powershell
bun test test/veraLobby.test.ts test/veraRoutes.test.ts test/leaderboardRoutes.test.ts test/ladderService.test.ts test/nativeResults.test.ts test/matchmakingTeamAllocation.test.ts test/matchbotVersion.test.ts
```

Result: **64 pass, 0 fail, 270 assertions across 7 files**. This includes the
current test that expects native ranked version rejection; it is baseline
behavior, not proof that native ranked play works.

An additional temporary, memory-only probe called the actual ladder/lobby
services and demonstrated SKU leakage, closed-season scoring, start without
readiness, and nonparticipant finish scoring. The probe used minimum duration
and placement count zero to isolate those checks; it did not contact a running
service, modify persistent player data or use a relay.

No full-suite rerun, TypeScript check, WASM build, native-screen test or real
Vera transport test was performed in this review. Atomicity, replay semantics,
event retention and HTTP controls above are findings from source inspection;
their failure/recovery cases need focused regression tests in the owning tasks.
