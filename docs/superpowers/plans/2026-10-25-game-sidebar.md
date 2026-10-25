# Running Game Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation requires a later user request; the current request is documentation only.

**Goal:** Replace scattered running-game browser controls with a compact left sidebar that expands on hover/focus, supports pinning, confirms Home navigation, and optionally mutes audio while the page lacks focus.

**Architecture:** Play owns the existing runtime, canvas, preferences, and host-overlay coordination. A GameSidebar component owns rail presentation and temporary expansion; existing SoundControl, SettingsDialog, LanPanel, and FileExplorer retain their responsibilities. Focus muting gates the browser audio output independently of the persisted game volume, and Home reuses the existing save-flush/document-navigation lifecycle.

**Tech Stack:** React 18, TypeScript, Radix Themes/icons, CSS modules, Web Audio, localStorage, existing Manifest/OPFS save persistence, Vitest/Testing Library, and Playwright. No new dependencies or native/WASM rebuild.

**Spec:** [Running Game Sidebar Design](../specs/2026-10-25-game-sidebar-design.md).

## Global Constraints

- Documentation only until the user requests implementation. All tasks below remain unchecked.
- Compact rail 56 px; expanded sidebar 184 px; targets at least 44 px high; collapse delay 250 ms; width/label transitions at most 150 ms. Start at opacity 0.2; fade in over 0.3 seconds on interaction and fade out linearly over five seconds after one second idle. Keyboard focus and owned menus/dialogs prevent fading; stale mouse-click focus must not. Disable transitions and panel entrance animations with prefers-reduced-motion.
- Below 768 px, reserve only 56 px even if pinned; expanded content overlays the game. Preserve the saved desktop pin preference.
- Hover/focus expansion never changes canvas geometry or remounts the canvas. Keep software-cursor coordinates correct after adding the viewport offset.
- Default sidebarPinned and muteWhenUnfocused to false. Preserve the existing volume preference and every current game control.
- Preserve pointer lock, browser/game Esc behavior, F10, F11/Alt+Enter, F12, text input/IME, native Exit Game confirmation, normal exit, mod restart, and deployment-base-aware navigation.
- Home must confirm and flush saved files before document navigation. A failed flush must not navigate or leave save polling stopped if the player stays.
- Use the current checkout state as evidence, not assumptions from HEAD: it contains substantial unrelated work. Preserve those changes; do not reset, clean, stage broadly, or rebuild game artifacts.

## Review Focus

- Portaled menus can accidentally collapse the sidebar or return focus to the canvas while another host control remains active; Tasks 3 and 5 test owned-overlay retention and focus handoff.
- Pointer-lock edge scrolling and pressed inputs can leak into sidebar navigation or become stuck after focus moves; Tasks 4 and 5 test modal/button isolation, held-input release, and recapture gating.
- Startup while hidden, alternate focus/visibility event order, and closing audio during pending startup can produce a brief sound burst or revive dead resources; Task 2 tests initial gain and late events.
- A failed Home save flush can silently disable subsequent saving; Task 4 tests retry/cancel and save-polling lifecycle, including non-root destinations.
- Reserving sidebar width changes software-cursor coordinates and letterboxing; Tasks 3 and 6 test viewport offsets, stable hover bounds, narrow screens, and fullscreen.

## File map and dependencies

Paths below are relative to the repository root. Run pnpm commands from web/.

| Files | Responsibility |
| --- | --- |
| Create web/src/storage/play-preferences.ts and .test.ts | Safe persisted browser-control booleans. |
| Modify web/src/game/audio.ts and .test.ts; create game/focus-audio.ts and .test.ts | Output gain gate and disposable page-focus observation. |
| Create web/src/components/GameSidebar.tsx, .module.css, .test.tsx | Compact/expanded/pinned interaction and slots for existing controls. |
| Create web/src/components/ReturnToLauncherDialog.tsx and .test.tsx | Confirmation, pending, and retry/error presentation. |
| Modify web/src/screens/Play.tsx and Play.module.css; create screens/Play.test.tsx | Stable game viewport, preference ownership, Home state, and control integration. |
| Modify web/src/game/lifecycle.ts and .test.ts | Preserve save polling when navigation fails. |
| Modify web/src/game/input.ts and .test.ts; game/browser-controls.ts and .test.ts | Isolate host controls, release held inputs, gate pointer recapture. |
| Modify web/src/components/SoundControl.tsx, .module.css, .test.tsx | In-flow sidebar sound trigger and controlled popover ownership. |
| Modify web/src/components/SettingsDialog.tsx; create SettingsDialog.test.tsx and .module.css | Sound section and responsive sidebar-adjacent placement. |
| Modify web/src/components/LanPanel.tsx, .module.css, .test.tsx | Controlled dialog opening while preserving the mounted LAN peer. |
| Create web/e2e/game-sidebar.mjs; extend web/e2e/exit-confirm.mjs and audio.mjs | Browser interaction, lifecycle, geometry, and audio-output evidence. |
| Modify docs/web/frontend.md and testing.md during implementation | Document shipped behavior and reproducible checks. |

Tasks 1-3 establish interfaces; Tasks 4-5 integrate them; Task 6 verifies the result. No broad architecture or source cleanup is included.

## Task 1: Persist browser-control preferences

**Files:** Create web/src/storage/play-preferences.ts and play-preferences.test.ts.

**Interfaces:** Export PlayPreferences { sidebarPinned: boolean; muteWhenUnfocused: boolean }, readPlayPreferences(storage?: Pick<Storage, "getItem"> | null): PlayPreferences, and writePlayPreferences(value: PlayPreferences, storage?: Pick<Storage, "setItem"> | null): void. Default storage is obtained with a guarded localStorage accessor. Use key ra2.play-controls.v1; validate each field independently and persist only these booleans, both defaulting to false. Writes never throw. Network (LAN) visibility is configured separately through `VITE_SHOW_NETWORK_LAN` in [LAN joining prerequisite W12.0](../../web/lan-webrtc-joining-plan.md#task-w120-configure-network-lan-sidebar-visibility-first), not persisted in this interface.

- [ ] Add failing tests named defaults_missing_or_invalid_fields_to_false, round_trips_both_preferences, ignores_extra_fields, and tolerates_blocked_storage. Assert false/false for absent or invalid data and preserve a valid sibling field when one field is malformed. An obsolete showNetworkLan field is ignored and never overrides Vite configuration.
- [ ] Run `pnpm test src/storage/play-preferences.test.ts`; expect failures for the missing module/API.
- [ ] Implement the interface with guarded JSON parsing and storage access. Do not move or migrate the Manifest-backed volume preference.
- [ ] Rerun the focused test command; expect all preference tests to pass.
- [ ] Commit only this task's files with message `feat(web): persist play control preferences`.

## Task 2: Mute the output while the page is away

**Files:** Modify web/src/game/audio.ts and audio.test.ts; create web/src/game/focus-audio.ts and focus-audio.test.ts.

**Interfaces:** Add GameAudio.setFocusMuted(muted: boolean): void. It caches the value before startup, controls a GainNode between worklet and destination, and becomes harmless after close(). Export FocusAudioEnv { isVisible(): boolean; hasFocus(): boolean; listen(onChange: () => void): () => void } and attachFocusMute(audio: Pick<GameAudio, "setFocusMuted">, enabled: boolean, env?: FocusAudioEnv): () => void. Default listen observes document visibilitychange and window focus/blur. Attach evaluates immediately; dispose removes listeners and clears the temporary gate safely.

- [ ] Extend FakeContext with a fake GainNode. Add failing tests asserting worklet -> gain -> destination wiring, gain 0 before destination connection when muted before start, gain 1 when restored, unchanged AudioState and runtime audio-live behavior, and no resource recreation after close or delayed addModule completion.
- [ ] Add focus-observer tests for enabled && (!visible || !focused), initial background attachment, both focus/visibility event orders, disabled preference, same-page control focus, and cleanup. Assert focus restoration cannot unmute a still-hidden document. Assert no calls to volume persistence or ra2_set_volume originate from this helper.
- [ ] Run `pnpm test src/game/audio.test.ts src/game/focus-audio.test.ts`; expect missing behavior to fail.
- [ ] Implement the output gate and observer. Keep the context/worklet running while muted, preserve gesture recovery, initialize gain before connecting, and guard asynchronous startup against close(). Do not add a new host setting or suspend/resume for focus policy.
- [ ] Rerun the focused tests; expect all to pass, including existing suspended/unavailable audio tests.
- [ ] Commit only these task files with message `feat(web): add optional page focus audio muting`.

## Task 3: Build the adjustable sidebar and stable game viewport

**Files:** Create GameSidebar.tsx, GameSidebar.module.css, and GameSidebar.test.tsx. Modify Play.tsx and Play.module.css; start Play.test.tsx.

**Interfaces:** GameSidebarProps contains pinned: boolean; onPinnedChange(value: boolean): void; pointerLocked: boolean; disabled: boolean; fullscreen: boolean; onHome(): void; onFullscreen(): void; onSettings(): void; sound: ReactNode; more: ReactNode; ownedOverlayOpen: boolean; onInteractionChange(active: boolean): void. GameSidebar owns pointer/focus/touch temporary expansion and its timer. Play owns the persisted pinned prop and the reserved viewport width. Use an accessible navigation landmark named Game controls and buttons Pin sidebar, Unpin sidebar, Expand sidebar, and Collapse sidebar as applicable.

- [ ] Add failing fake-timer tests for immediate pointer/focus expansion, delayed 250 ms collapse, canceled collapse on re-entry, keeping expansion while ownedOverlayOpen, unmount cleanup, pin callbacks, and touch toggle behavior. Assert pointerLocked suppresses hover expansion and every icon retains an accessible action name.
- [ ] Run `pnpm test src/components/GameSidebar.test.tsx src/screens/Play.test.tsx`; expect the new component/layout assertions to fail.
- [ ] Implement the sidebar using existing Radix components/icons and theme tokens. Use the exact compact/expanded dimensions and narrow-screen override in the spec. Add a clipped, positioned game viewport to the right of the reserved rail; put canvas/backdrop/text sink inside it, but keep the software cursor stage-relative so Presenter coordinates stay correct. Keep terminal overlays covering the full stage and loading/game overlays covering the viewport. Do not animate canvas width.
- [ ] Add Play integration assertions that expansion leaves the same canvas node mounted, Pin changes the reserved width, and host/loading/error layers remain reachable. Cover default idle opacity, the one-second fade delay, restoring visibility on interaction, and mouse versus keyboard focus ownership. Put live bounding-box and computed animation-duration assertions in Task 6 because jsdom does not compute layout.
- [ ] Rerun the focused tests and `pnpm typecheck`; expect success. The sidebar may initially be integrated behind existing controls until Task 5 wires every action; do not remove old entry points yet.
- [ ] Commit this task's files with message `feat(web): add adjustable game sidebar layout`.

## Task 4: Confirm Home navigation and isolate host input

**Files:** Create ReturnToLauncherDialog.tsx and ReturnToLauncherDialog.test.tsx. Modify Play.tsx/Play.test.tsx, lifecycle.ts/lifecycle.test.ts, input.ts/input.test.ts, and browser-controls.ts/browser-controls.test.ts.

**Interfaces:** ReturnToLauncherDialogProps { open: boolean; pending: boolean; error: string | null; onCancel(): void; onConfirm(): void }. Play owns the dialog state and reuses its guarded returnToLauncher callback. Preserve leaveGame(session, destination?, navigate?): Promise<void>, changing save ordering to successful flush -> stop -> navigation. Extend autoLockPointer(canvas) return value with setBlocked(blocked: boolean): void; true releases lock without forgetting explicit Escape release. After host interaction, clearing the block or subsequent update(active) transitions must retain a wait-for-canvas-click latch rather than recapture. The next canvas click clears that latch. Existing update(active) still handles initial gameplay activation. Export no new WASM interface.

- [ ] Add failing confirmation tests asserting exact spec copy, initial Stay in game focus, no outside-click dismissal, Esc/cancel with no flush or navigation, one request on repeated confirm, pending disablement, and inline Retry/Stay in game after rejection. Test an incoming native exit confirmation taking priority with only one modal open.
- [ ] Update lifecycle tests to assert flush resolves before stop/navigation, a non-root launcher destination remains correct, failed flush does not stop polling or clear the resume marker, retry succeeds, and failed startup still permits navigation. Preserve terminal exit/mod restart coverage.
- [ ] Add input tests that sidebar buttons/links/menu items do not receive game key forwarding or preventDefault, held game keys/buttons release on focus transfer, game text/IME still work, and canvas shortcuts remain intact. Add pointer tests for setBlocked(true), no recapture on unblock or later update(false)/update(true), explicit canvas-click recapture, and unchanged gameplay Escape behavior.
- [ ] Run `pnpm test src/components/ReturnToLauncherDialog.test.tsx src/screens/Play.test.tsx src/game/lifecycle.test.ts src/game/input.test.ts src/game/browser-controls.test.ts`; confirm the intended failures.
- [ ] Implement the dialog and lifecycle ordering. Render live-session errors inside the Home dialog rather than only the terminal exit view. Wire host-input ownership and the pointer blocker through refs read by existing runtime callbacks, so sidebar/modal changes do not restart the runtime effect. Keep gameplay disabled during confirmation/pending navigation and release existing held inputs before disabling. Use the existing base-aware document navigation, not a Router link.
- [ ] Rerun the focused tests; expect all to pass, including prior input, terminal-exit, and Escape tests.
- [ ] Commit the scoped changes with message `feat(web): confirm return home and isolate game controls`.

## Task 5: Consolidate Settings, Sound, and More

Label the corresponding More action **Network (LAN)** and conditionally render it using `networkLanVisible()` from W12.0's `web/src/config.ts`, which reads `import.meta.env.VITE_SHOW_NETWORK_LAN`. The exact string `false` hides it; `true`, unset, empty, or unrecognized values show it. Pass a read-only showNetworkLan boolean to the sidebar/More owner; add no Settings control or persisted visibility preference. Test both environment configurations, absence from keyboard/accessibility navigation when hidden, and LAN ownership remaining independent of menu rendering. This completes the UI portion of LAN prerequisite W12.0 before subsequent LAN joining tasks; document restart/rebuild requirements in W12.0's env example and README.

**Files:** Modify Play.tsx/Play.test.tsx; SoundControl.tsx/.module.css/.test.tsx; SettingsDialog.tsx and new SettingsDialog.test.tsx/.module.css; LanPanel.tsx/.module.css/.test.tsx.

**Interfaces:** Play loads Task 1 preferences, updates/persists them on user changes, and attaches Task 2's observer when audio or mute preference changes. Add SoundControl props open: boolean and onOpenChange(open: boolean): void; retain audio, volume, onVolume, giveBack and add renderable in-flow Sound/Enable sound presentation. Add SettingsDialog props volume: number; onVolume(value: number): void; muteWhenUnfocused: boolean; onMuteWhenUnfocusedChange(value: boolean): void, retaining existing host-setting props. Add LanPanel optional open/onOpenChange props and showTrigger?: boolean (default true for existing callers); Play uses controlled mode with showTrigger=false. Controlled opening must not remount the component or replace its peer.

- [ ] Add failing tests for labeled sidebar actions, no duplicate corner triggers, shared volume updates through Sound and Settings, the exact focus-mute label/helper/default/persistence, blocked storage, Enable sound after browser suspension, and retained host settings/mod/pointer controls.
- [ ] Add portaled-popover tests: moving from rail to Sound or More does not collapse it; closing a nested menu returns focus to its trigger; Back to game returns focus to the canvas. Text-input action retains its current IME behavior. Keyboard input/Hide keyboard, Multiplayer (LAN), and Browse files reach existing surfaces; unavailable file browsing remains absent/disabled consistently.
- [ ] Add LAN tests that closing/reopening the dialog or More preserves the same connected peer and polling lifecycle, while runtime termination still stops polling. Assert no simultaneous settings/Home/LAN/file dialogs and no gameplay events or recapture while host interaction owns input.
- [ ] Run `pnpm test src/screens/Play.test.tsx src/components/SoundControl.test.tsx src/components/SettingsDialog.test.tsx src/components/LanPanel.test.tsx`; expect missing integrations to fail.
- [ ] Wire the sidebar slots and controlled overlay state in Play. Before opening a dialog from More, close More and transfer focus ownership without an intervening canvas focus. Include sidebar focus, open popovers, dialogs, and pending navigation in the host-input/pointer blocker. Move the sound trigger into the rail and the LAN trigger into More, keeping the actual LAN peer mounted. Replace the old topMenu and corner trigger positions only after equivalents work.
- [ ] Add the Sound section to Settings with a shared desired-volume handler and browser-owned focus preference. Keep host settings driven by acknowledgments. Anchor the accessible dialog beside the sidebar on desktop; on small screens use 12 px viewport margins with a scrolling body and fixed header/action footer. Anchor popovers to their triggers and clamp them to short viewports. Ensure menu Tab navigation skips controls hidden on mobile. Remove only obsolete CSS rules, not unrelated styling or components.
- [ ] Rerun focused tests plus `pnpm typecheck`; expect success. Verify focus observer cleanup on audio replacement, runtime exit, and unmount, including disabled persistence.
- [ ] Commit scoped changes with message `feat(web): consolidate running game controls in sidebar`.

## Task 6: Browser verification and documentation

**Files:** Create web/e2e/game-sidebar.mjs using existing e2e/lib.mjs; extend web/e2e/exit-confirm.mjs and audio.mjs; update docs/web/frontend.md and docs/web/testing.md.

**Interfaces:** The new check accepts existing lib options --url, --shots, --headed, --game, --build. Build URLs relative to the supplied base; do not hard-code root paths. Reuse public accessible names and existing canvas geometry helpers. Native Exit Game and Home are separate scenarios. Use mocked session/save rejection in Play tests for deterministic errors rather than adding production failure toggles.

- [ ] Add browser assertions for compact/hover/pinned bounds, unchanged canvas element and bounding box on hover, expected width change on pin, correct software cursor/hit-testing with the left offset, touch/keyboard expansion, focus retention across portaled content, and no edge-trigger expansion while pointer-locked. Capture compact, expanded, pinned, settings, and Home confirmation screenshots.
- [ ] Cover Home cancel, confirmed base-aware launcher return, absent old module/session and workers after return, and native Exit Game regression separately. Run for both RA2 and Yuri's Revenge; cover root and /emu/ deployments. A script must verify document teardown, not only that a launcher heading appears.
- [ ] Extend audio checks with a real controlled output-tone/render test through the same focus gain path: enabled background output is silent, foreground output returns, and desired volume zero stays silent. Ring peak()/stats() alone cannot prove output silence because focus muting happens after the ring. Exercise real window/tab focus transitions in headed Chrome; report browser focus limitations explicitly instead of treating synthetic blur as full end-to-end evidence.
- [ ] From web/, run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Expected: all checks pass. Separate pre-existing unrelated failures with their baseline evidence; do not silently fix unrelated work or claim a passing suite when it is not passing.
- [ ] With the dev server and the corresponding existing game build available, run `node e2e/game-sidebar.mjs --url http://127.0.0.1:5173/ --headed --shots ../work/game-sidebar/yr`, then the same check with `--url http://127.0.0.1:5173/?target=game` and `--shots ../work/game-sidebar/ra2`. Run existing `node e2e/exit-confirm.mjs` and `node e2e/audio.mjs` against each edition. Use --build/--game when the available runtime requires them. Repeat navigation checks against a server configured with RA2_BASE=/emu/ and URL http://127.0.0.1:5173/emu/. Record actual prerequisites and commands in testing.md; unavailable real-game checks remain explicitly unverified.
- [ ] Inspect 320, 375, 414, 768, and 1280 px widths, a wide desktop, short landscape height, fullscreen, zoom, and reduced motion. Confirm no horizontal overflow, hidden action, wrapped button label, pointer-offset error, or gameplay input leakage. Check existing dialogs/menus and startup/crash/error screens remain usable.
- [ ] Update frontend.md with shipped sidebar, Home, and audio behavior; update testing.md with the new commands and browser-focus caveats. Keep this plan's boxes synchronized with evidence and record any deliberate deviations from the spec.
- [ ] Review only the scoped diff and commit the final browser checks/documentation with message `test(web): verify adjustable game controls and home lifecycle`.

## Completion and current handoff

Implementation is complete only when the spec's acceptance criteria have direct test or manual evidence, both editions have been checked where builds are available, and unverified browser behavior is named. This documentation request stops here: no implementation, dependency installation, build, staging, or commit has been performed for the plan.
