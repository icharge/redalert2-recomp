# LAN WebRTC Joining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enter the game's Network screen, then create or join a WebRTC session through a browser dialog before using the original LAN lobby.

**Architecture:** Keep the native LAN screen on the canvas and intercept its entry with a browser session dialog. Reuse `LanPeer` and `LanIpXBridge`; follow the Exit confirmation's typed event, request ID, reply, and modal input isolation pattern. LAN pairing is asynchronous: the game's message pump and IPX discovery must continue while the dialog is open.

**Tech Stack:** Existing Emscripten C host, React 18, TypeScript, Radix Dialog, WebRTC, Vitest, and Playwright browser scripts.

**Spec:** The requested flow and constraints below, together with [D13](decisions.md#d13-browser-lan-play-one-peer-over-webrtc-manual-sdp-exchange). This is a documentation-only proposal dated 2026-10-25; W12.4–W12.8 are not implemented.

## Global constraints

- Show the original Network/LAN screen before opening the browser Create/Join dialog.
- Keep the game's native LAN lobby, game list, names, chat, options, Accept and Start flow.
- Pair exactly two browser clients with manual SDP offer/answer exchange.
- Keep `iceServers: []` and the `ipx` channel's `{ ordered: false, maxRetransmits: 0 }` configuration.
- Preserve the four-byte source/destination socket prefix and maximum 576-byte IPX payload.
- No signaling service, STUN/TURN, WOLAPI, room-code backend, or new dependencies in this change.
- Cover Red Alert 2 and Yuri's Revenge; native Windows/Linux behavior stays intact.
- Use session request IDs rather than exposing guest HWNDs to React.

## Review focus

- A dialog-created notification can precede painting: the player must see the LAN screen behind the browser dialog. Covered by W12.4 and W12.8.
- Cancel or a second attempt during ICE/SDP work must prevent late completion from reopening or connecting an abandoned session. Covered by W12.5 and W12.7.
- Pointer, keyboard, touch, and automatic pointer lock must stay isolated from the game while pairing. Covered by W12.6 and W12.8.
- Leaving lobby discovery for native host/join setup must preserve the connected transport through the match. Covered by W12.4, W12.7 and W12.8.
- A stale reply, a lost peer, or a crashed runtime must not resume a different lobby or call dead wasm exports. Covered by W12.5, W12.7 and W12.8.

## Requested flow and design

1. From the original main menu, click **Network**. Let the original LAN screen (`0xBB`) initialize and publish a frame.
2. Open a Radix dialog titled **LAN multiplayer** above that screen. Its initial choices are **Create WebRTC session**, **Join WebRTC session**, and **Cancel**. The floating LAN button is no longer the prerequisite for entering Network.
3. Create: generate an invitation, show selectable read-only SDP with **Copy invitation**, accept the other player's answer with **Paste from clipboard** or ordinary paste, then **Connect**.
4. Join: paste an invitation, generate an answer, and expose **Copy answer**. Keep the dialog open while the creator applies the answer and the data channel connects.
5. Only an open data channel enables **Continue to LAN lobby**. Continue acknowledges the current request, closes the browser dialog, and restores canvas focus. The connected bridge remains alive.
6. In the original game UI, the host clicks **New** (`0xBB:1740`, setup `0xBC`). The guest selects the advertised game (`0xBB:1353`), clicks **Join** (`0xBB:1741`, setup `0xBD`), then **Accept** (`0xBD:1439`). Native Start/check-in behavior stays as it is. A WebRTC session creator is a transport role; it does not automatically create a native game.
7. Cancel, Escape, or closing the pairing dialog abandons the pending peer and follows the native LAN Back/Cancel path to the main menu. Outside clicks do not dismiss the modal. Confirm the exact native cancel command in W12.4 before wiring it; do not synthesize coordinate clicks.
8. Failure stays in the browser dialog with readable status, Retry, and Cancel. A dropped connection during lobby setup reopens connection status; during a match, report loss without silently replacing the transport beneath an active lockstep session.
9. Keep the session through discovery, host/join setup, loading and gameplay. Close it on explicit disconnect, return to the main menu, runtime exit/crash, or component disposal. A fresh Network entry starts a fresh request.

The caller's wording selects the native-screen-plus-browser-dialog approach. The proposed entry point is Network/LAN entry, with Create/Join referring to WebRTC pairing. Native New/Join still operate the game lobby after pairing; this proposal does not automatically choose a native room for the player.

### Approaches

- **Recommended: intercept LAN entry through the existing dialog lifecycle callback.** `src/linux/script.c::dialog_created` already forwards dialog creation to `src/web/presenter.c::web_presenter_dialog_created` on Emscripten. Track `0xBB` there, publish the LAN picture, then emit a session request from the normal pump. This provides the requested flow without replacing the game lobby.
- **Intercept native New/Join individually.** Pairing would happen later, and a joiner needs WebRTC discovery before a remote game exists in the list. This adds a discovery bootstrap problem and is not the default for this plan.
- **Keep the standalone LAN toolbar button.** Reuses the current UI unchanged, but still makes players pair before entering the game's Network screen and does not deliver the requested interception.

Like the earlier Exit interception, the browser owns the replacement interaction and replies to the game. Unlike Exit's synchronous confirmation helper, this flow must not park the game thread while ICE gathers: the native lobby must paint, process network packets, and advertise games.

## Existing evidence and file responsibilities

`web/e2e/lan.mjs` currently pairs through the toolbar, then clicks Network and verifies IPX traffic and a shared match. It also verifies separate 128-digit `woldata.key` identities. `web/e2e/lan-peer.mjs` tests real data channels without loading wasm. Keep both levels of coverage.

| File | Responsibility in this change |
|---|---|
| `src/web/presenter.c` | Observe LAN/native-menu lifecycle, defer prompting until the LAN frame is published, gate queued game input while pairing |
| `src/web/main.c`, `src/web/web_api.h` | Request/reply mailbox and game-thread application of Continue/Cancel |
| `src/linux/script.c` | Existing Emscripten-only dialog callback; extend only if source tracing proves a missing notification |
| `web/src/game/protocol.ts`, `web/src/game/store.ts` | Typed session events, reply export binding, current pending request |
| `web/src/game/lan.ts` | Existing peer/bridge; invalidate asynchronous operations after close or replacement |
| `web/src/components/LanPanel.tsx`, `LanPanel.module.css` | Controlled Create/Join session dialog, status, retry, clipboard and cancellation |
| `web/src/screens/Play.tsx` | Connect the pending request to the dialog, focus, input and pointer-lock policy |
| Corresponding `*.test.ts(x)` files | Protocol, lifecycle, stale-operation and modal tests |
| `web/e2e/lan.mjs`, new `web/e2e/lan-session.mjs` | Successful game flow and cancellation/re-entry/failure checks |

Do not patch generated `src/recomp/gen*/` files. The existing callback is the first implementation path; a lift patch is only justified if W12.4 establishes that a necessary command cannot be intercepted there. Any such patch must be Emscripten-only, identify both targets unambiguously, and receive matcher tests in `tools/test_lift_patches.py`.

## Task W12.4: Prove the LAN lifecycle and cancellation boundary

**Files:** Inspect `src/linux/script.c`, `src/web/presenter.c`, the two local generated source trees, and `tools/lan/{host,joiner}.args`. Update this document with source anchors and trace results.

**Interfaces:** Produces a verified mapping for each edition: LAN enter, first published LAN frame, native Back/Cancel command, host/join transition, main-menu return. These are implementation prerequisites, not guessed virtual addresses.

- [ ] Trace Network (`0xE2:1400`) through `0xBB`, host `0xBC`, join `0xBD`, and return to the main menu in both editions. Record exact cancel control/message and its source handler.
- [ ] Confirm when the existing creation callback fires relative to visibility and frame publication. Establish an observable frame sequence boundary before prompting; an arbitrary timer is insufficient.
- [ ] Verify host/join/loading transitions can be distinguished from leaving LAN entirely. Destruction or hiding of `0xBB` alone must not end a connected session.
- [ ] Capture the original LAN screen and the successful native cancel trace. If the callback cannot support a required boundary, document the smallest verified additional hook before implementing it.
- [ ] Commit the evidence and final hook mapping separately: `docs: trace LAN session interception boundaries`.

## Task W12.5: Add the game/browser session handshake

**Files:** Modify `src/web/presenter.c`, `src/web/main.c`, `src/web/web_api.h`, `web/src/game/protocol.ts`, `web/src/game/store.ts`; extend `web/src/game/protocol.test.ts`, `store.test.ts`, and `loader.test.ts`.

**Interfaces:** New events `{ e: "lanSession"; request: number }` and `{ e: "lanSessionEnd"; request: number }`. New export `int ra2_lan_session_reply(uint32_t request, int connected)` mirrored as `ra2_lan_session_reply(request: number, connected: number): number`. Values 0/1 mean cancel/continue; return 1 accepts exactly one matching pending reply, otherwise 0. New store field `lanSession: { request: number } | null` and `resolveLanSession(request: number): void`.

- [ ] Write parser/store tests: accept nonzero uint32 requests; reject zero, fractional, negative and overflowing IDs; ignore an end event for another request; clear matching state on resolution, begin, exit and crash, including protocol mismatch.
- [ ] Run `pnpm --dir web test -- src/game/protocol.test.ts src/game/store.test.ts src/game/loader.test.ts`; confirm the new cases fail before implementation.
- [ ] Implement request allocation and an atomic reply mailbox. Main-thread exports only validate/queue replies; the normal game pump performs native Continue/Cancel work using W12.4's verified mapping. No guest window operations from React and no blocking wait inside the creation callback.
- [ ] Emit `lanSession` once per fresh entry after the verified LAN frame publication. Emit matching `lanSessionEnd` when leaving the overall LAN flow; do not end on the host/join transition. Keep the current request/generation for the connected session until its actual end.
- [ ] Increment the protocol in C and TypeScript together (currently 7; use 8 if unchanged at implementation time), add the export binding table entry, and update protocol documentation. Confirm how `EMSCRIPTEN_KEEPALIVE` retains exports before changing linker settings.
- [ ] Run the focused tests and `pnpm --dir web typecheck`. Use the browser harness from W12.8 to verify that zero, invalid choices, old IDs and duplicate replies return 0 and cannot navigate another lobby.
- [ ] Commit: `feat: expose browser LAN session requests`.

## Task W12.6: Replace toolbar-first pairing with the controlled session dialog

**Files:** Modify `web/src/components/LanPanel.tsx`, `LanPanel.module.css`, `web/src/screens/Play.tsx`; create `web/src/components/LanPanel.test.tsx`.

**Interfaces:** `LanPanel({ game, request, onContinue, onCancel }: { game: GameHandle; request: number | null; onContinue(request: number): void; onCancel(request: number): void })`. The component remains mounted for the live runtime so closing the modal after Continue does not dispose the connected peer/bridge. Play owns acknowledgement and only resolves a request after the export accepts its reply.

- [ ] Write tests for the exact Create/Join choices and offer/answer exchange, Continue disabled until channel open, failed acknowledgement keeping the prompt visible, manual paste when clipboard access is denied, and Escape invoking Cancel once.
- [ ] Run `pnpm --dir web test -- src/components/LanPanel.test.tsx`; confirm the new cases fail.
- [ ] Convert local `open`/toolbar ownership to the pending request. Preserve selectable invitation/answer text and clipboard fallbacks; replace the status that currently instructs players to open Network after pairing.
- [ ] Wire Continue/Cancel through `ra2_lan_session_reply`. Disable duplicate actions while acknowledging, prevent outside dismissal, and restore focus after the game consumes the decision.
- [ ] Extend both `attachInput.enabled` and automatic pointer-lock predicates in Play to include the LAN modal. Release capture on open; suppress game shortcuts, hidden textarea input, and stale queued pointer/key events while the modal owns focus. Apply the matching gate where presenter input drains so pre-open queued events cannot activate native controls.
- [ ] Run the component tests, `pnpm --dir web typecheck`, and `pnpm --dir web lint`.
- [ ] Commit: `feat: pair WebRTC sessions from the native LAN screen`.

## Task W12.7: Make cancellation, reconnect and cleanup safe

**Files:** Modify `web/src/game/lan.ts`, `lan.test.ts`, `web/src/components/LanPanel.tsx`, `LanPanel.test.tsx`, and store lifecycle tests as needed.

**Interfaces:** Preserve `LanPeer.createOffer(): Promise<string>`, `answerOffer(text: string): Promise<string>`, `acceptAnswer(text: string): Promise<void>`, `close(): void`, and existing `LanIpXBridge` methods. Each peer attempt and each dialog request gets an internal generation; obsolete async completions must not emit status/packets or alter a later attempt.

- [ ] Write fake-peer tests for close during ICE gathering, cancel during `setRemoteDescription`, stale callbacks from a replaced peer/channel, retry after malformed SDP, and delayed Blob decoding after disposal. Assert no abandoned invitation, status, packet, or game reply reaches the next request.
- [ ] Write component lifecycle tests: Continue keeps peer/bridge alive; native host/join transitions keep them alive; main-menu return, explicit disconnect, exit, crash and unmount stop each resource once; React effect cleanup/remount cannot leave duplicate bridge timers.
- [ ] Run `pnpm --dir web test -- src/game/lan.test.ts src/components/LanPanel.test.tsx src/game/store.test.ts`; confirm the added cases fail.
- [ ] Add attempt invalidation and cancellable ICE listeners/timers, guarded callbacks, and safe promise settlement. Permit retry for the current request only; never submit Continue from a stale attempt.
- [ ] Separate modal visibility from transport lifetime. A post-Continue disconnect reports loss; in lobby/setup it can reopen recovery UI for the current session, but gameplay loss must not automatically attach a different peer. Preserve the native game's disconnect handling.
- [ ] Run the focused tests and `pnpm --dir web typecheck`.
- [ ] Commit: `fix: invalidate abandoned LAN pairing attempts`.

## Task W12.8: Verify the requested flow with real games

**Files:** Modify `web/e2e/lan.mjs`; create `web/e2e/lan-session.mjs`; update `docs/web/testing.md`, `protocol.md`, `decisions.md`, `progress.md`, and the Stage 12 task rows.

**Interfaces:** Reuse `options`, `startPage`, screenshots, game log capture, and module overrides from `web/e2e/lib.mjs`. Keep `lan-peer.mjs` as the transport-only check. Support each edition with its own INI, build and file overrides instead of assuming `RA2MD.INI` for RA2.

- [ ] Change the successful two-client test to click native Network first, wait for `0xBB` and its published frame, then interact with the automatic browser dialog. It must never click the old toolbar LAN trigger.
- [ ] Before pairing, capture both native LAN backgrounds and the modal. Assert the frame boundary precedes `lanSession`; retain screenshots for visual review. Then exchange SDP, Continue, create/join the original room, Accept and start the same match.
- [ ] Keep distinct WOL-key assertions, nonempty IPX receive checks, and non-black active match frames on both clients. Add an observable order/response from each player so verification proves ongoing shared gameplay beyond merely loading a map.
- [ ] Add the failure-flow script: Cancel/Escape to native main menu; re-enter with a fresh request; reject old/duplicate replies; deny clipboard access; retry bad SDP; drop the channel in lobby/setup; ensure modal typing/clicks and pointer-lock attempts never reach the native lobby. Verify presenter/pump progress while ICE waits.
- [ ] Run the transport check from `web/`: `node e2e/lan-peer.mjs http://127.0.0.1:5178/`.
- [ ] Build both browser modules with the repository's existing web build commands, then run the full flow with the Vite server: `node web/e2e/lan.mjs --url http://127.0.0.1:5178/ --game game --shots work/web-lan-session-yr` and the equivalent RA2 invocation using its explicit build/INI selection. Run `lan-session.mjs` with the same URL/game/build arguments. Record the actual per-edition commands and logs in testing.md.
- [ ] Run `pnpm --dir web test`, `pnpm --dir web build`, and `pnpm --dir web lint`. Review the native LAN/modal, resumed lobby and match captures for both editions. Check native `menu-network`/`back-network` using the existing playtest cases if shared host/script behavior changed.
- [ ] Document the implemented protocol and the new entry flow, then mark W12.4–W12.8 complete only for checks actually passed. Keep Stage 13's Internet transport work separate.
- [ ] Commit: `test: cover native LAN entry and WebRTC session joining`.

## Completion criteria

A player clicks Network, sees the original LAN screen with a browser Create/Join dialog, pairs without a separate toolbar step, then completes native host/join setup and a shared match. Cancellation, re-entry, clipboard denial and connection failure have repeatable results; stale requests cannot change a later session. Evidence covers both editions. This plan does not claim those checks have been run yet.
