# Battlefield Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map and game objects look sharper and slightly richer in color while preserving the original interface.

**Architecture:** Add a frame-aligned coverage mask identifying pixels eligible for enhancement. Apply a restrained sharpening and color preset in the existing GPU presenters, only where the mask and sampling footprint contain battlefield content. Keep enhancement independent of resolution, scaling mode, and HD vehicles.

**Tech Stack:** Lifted C and Python lift patches; WebGL2/GLSL with TypeScript; Windows Direct3D 11/HLSL.

**Spec:** The proposed design below is the specification for this plan. Status: proposed for review; implementation has not started.

## Proposed design

### Intended result

Terrain, buildings, units, shadows, and world effects receive modest sharpening and color enhancement during a match. The result should retain the game's visual style and faction colors. This is an enhancement of the existing pixels; additional artwork detail would require a separate asset or rendering project.

Proposed UI protection includes the sidebar, radar, command buttons, text, tooltips, health bars, selection indicators, placement guides, cursors, and dialogs. These exclusions are a conservative design assumption from the user's request for effects on only the map and game objects.

The initial control is **Battlefield enhancement: Off / Enhanced**, default **Off**, applied immediately and remembered. One preset keeps the first implementation small. Separate sliders and additional presets can follow after viewing real matches.

Proposed platform scope is the browser WebGL2 presenter and Windows `--run` presenter, for Red Alert 2 and Yuri's Revenge. The browser 2D fallback, Windows `--classic`, and Linux's SDL presenter retain their current picture. Their unsupported state must be represented accurately if they expose the control. No work in the sibling `pcrecomp` repository is assumed.

### Existing evidence

- `web/src/game/gl-shaders.ts` already implements decoding, scaling, CRT, and blurred bars; `gl-presenter.ts` uploads the completed frame.
- `src/runtime/present.c` has the corresponding D3D11 texture presentation and embedded HLSL.
- `src/runtime/hdvox.c:ra2_vox_frame_blit` observes copies to the frame surface. Its comments explicitly warn that there are multiple copies per frame, including cursor-related updates. This is an observation point, not proof of a clean world/UI boundary.
- `docs/voxels.md` describes battlefield and staging surfaces and the existing HD composition technique. Its comparison of final colors with recorded voxel colors does not provide a complete UI coverage mask.
- `src/web/presenter.c`, `src/web/frame_buffers.*`, and `src/web/web_api.h` publish frames with shared-memory ownership rules. A new mask must follow the same rules.
- The page normally renders the match cursor separately, but it also supports a game-drawn cursor. Windows normally has the cursor embedded in the match image.
- `Shared.matchState` includes loading and score screens. It is insufficient on its own to enable a battlefield effect.

### Approaches considered

| Approach | Tradeoff | Decision |
| --- | --- | --- |
| Shade a rectangle covering the map | Small change, but also changes embedded overlays and dialogs | Reject for the requested scope |
| Track battlefield/UI coverage and shade eligible pixels | Preserves existing game drawing and reuses both presenters; requires mapping overlay writes | Recommended first implementation |
| Separate world and UI into full render layers | Most flexible for future effects, but requires substantially more rendering reconstruction, including transparency | Defer; reconsider only if coverage tracking cannot be made reliable |

The coverage approach is conditional on Task 1 proving that required drawing paths can be intercepted. A world rectangle or color comparison must not quietly replace that proof.

### Coverage and synchronization

Use an 8-bit source-sized mask: **255 = eligible world**, **0 = protected or unknown**. Base eligibility comes from verified battlefield drawing; overlay writes clear eligibility. Respect real clipping and transparency rather than clearing only fixed sidebar coordinates. Clearing a conservative bounding rectangle is acceptable for a temporary experiment, but not the finished mask if it leaves visible unenhanced holes around moving UI.

Track mask updates through actual surface copies and dirty redraws, including source/destination rectangles and offsets. Where world and UI draws interleave, preserve their order. Keep the mask associated with the pixels in each surface; do not clear the entire mask every tick if the game retains unchanged regions. Never identify UI solely by pixel color or equality with an earlier frame.

Frame publication carries pixels, mask, dimensions, and a common generation. Unknown state, mismatched dimensions, unavailable hooks, or generation mismatch produces an all-protected result for that publication. Menus, loading, scores, and match teardown invalidate world eligibility. Thread ownership must ensure the presenter never reads a mask being modified.

HD vehicles can change presentation dimensions. Project the eligibility mask into that picture using integer coordinate mapping; do not enable the effect on a frame whose HD dimensions or generation cannot be matched. This must not turn on the web's deferred experimental HD-layer composition.

### Shader behavior

Keep the current scale selection and letterbox behavior. Enhancement is a separate setting and never affects the blurred bars.

Starting preset, subject to screenshot review:

- Four axial neighbors, one game texel from the center.
- Sharpening strength **0.20**, applied as `center + 0.20 * (center - neighborMean)`.
- Limit the sharpened RGB to the minimum/maximum of the five sampled colors to suppress halos.
- Saturation **1.06**, around luminance weights **(0.2126, 0.7152, 0.0722)**.
- Contrast **1.03**, around **0.5**; clamp final RGB to `[0, 1]`.

These parameters operate on the decoded RGB values used by the current presenters; do not change texture color-space formats as part of this feature. Keep GLSL and HLSL formulas identical. Decode indexed neighbors through the palette before filtering.

All contributing samples must be world eligible, including the existing scale filter's source footprint. If any sample touches protected or unknown content, return the existing unenhanced output for that output pixel. Use nearest sampling for the mask. This intentionally leaves a narrow unenhanced boundary rather than pulling UI colors into sharpened terrain. Test fractional scaling and downscaling explicitly; a center-only mask test is insufficient.

No bloom, temporal processing, neural upscaling, lighting reconstruction, asset changes, or new dependencies are included.

## Global constraints

- Map and world objects receive the effect; interface content is protected.
- Off produces the current rendering result.
- Missing or mismatched coverage disables enhancement for that frame.
- Do not mutate the game's color pixels or simulation state to produce the effect.
- Do not edit generated lifted C directly; changes belong in `run_lift.py` and runtime helpers.
- Respect existing frame ownership and avoid per-frame heap allocation after buffers stabilize.
- Cover both editions with separately verified hooks; never reuse a Yuri's Revenge address blindly in Red Alert 2.
- Plan only in this change. Do not modify rendering code or commit unrelated workspace files.

## Review focus

1. Dirty redraws and cursor-only copies must not apply stale coverage to a newer image (Tasks 1–2).
2. Dialogs, translucent overlays, and game-drawn cursors must stay protected even inside map bounds (Tasks 1–3).
3. Fractional scaling, downscaling, and HD frames must not move the mask or introduce UI-colored halos (Tasks 2–4).
4. Memory growth, context loss, edition switches, and match teardown must release or invalidate paired resources (Tasks 2–4).
5. Unsupported renderers and old settings must preserve a working picture without pretending the effect is active (Tasks 3–5).

## File structure

| Files | Responsibility |
| --- | --- |
| `run_lift.py`, `tools/test_lift_patches.py` | Verified per-edition hook insertion and patch checks |
| New `src/runtime/battlefield_mask.h`, `.c` | Surface coverage lifecycle, draw classification, immutable snapshots |
| New `tools/test_battlefield_mask.c` | Platform-neutral coverage tests |
| `CMakeLists.txt` | Build the runtime helper for supported targets and its test target |
| `src/web/presenter.c`, `src/web/frame_buffers.h`, `.c`, `src/web/web_api.h` | Publish a mask paired with each browser frame |
| `web/src/game/protocol.ts`, `.test.ts`, `gl-presenter.ts`, `.test.ts`, `gl-shaders.ts`, `presenter.ts` | Shared contract, mask texture, enhancement configuration, fallback capability |
| `src/runtime/host.h`, `host.c`, `present.c` | Snapshot pixels and coverage together and apply the D3D11 effect |
| `src/web/settings.c`, `web/src/components/SettingsDialog.tsx`, `web/src/screens/Play.tsx` | Existing settings path and runtime application |
| New `web/e2e/battlefield-enhancement.mjs` | Deterministic paired GPU image checks |
| `docs/presenter.md`, `docs/web/architecture.md`, `docs/web/protocol.md` | User behavior and rendering contract |

## Task 1: Prove the world/UI boundary

**Deliverable:** A hook map and captured evidence establishing whether the recommended approach can meet the scope.

**Files:** inspect `run_lift.py`, `src/runtime/hdvox.c`, generated call sites, and `src/runtime/page_cursor.*`; create `docs/battlefield-rendering.md`. Temporary tracing belongs under `work/`, not in production shader code.

- [ ] Trace world drawing, UI drawing, and final surface copies separately for both editions. Record addresses, call ordering, surfaces, clipping rules, direct pixel writes, and whether callbacks occur before or after each write.
- [ ] Record dirty redraw behavior while scrolling, opening/closing tooltips, dragging selection boxes, showing health bars, opening pause/options dialogs, switching radar state, and moving each cursor type.
- [ ] Capture diagnostic coverage over the final image at 800x600, 1920x1080, and one noninteger display scale. Include at least one translucent overlay and a paused match.
- [ ] Establish an explicit active-battlefield signal; prove loading, scores, menus, and movies do not qualify.
- [ ] Decide whether observed hooks cover every required UI path. If not, document the missing paths and revise this plan before production implementation. Do not ship rectangle-only filtering as completion.

**Checkpoint:** The implementer can name and exercise every hook needed to classify actual writes. This work is the main uncertainty; a completion estimate is premature until it passes.

## Task 2: Implement and publish coverage paired with frames

**Files:** runtime mask helper, lift patches, frame buffers, shared API, protocol, host snapshot functions, and their tests from the file map.

**Interfaces:** `battlefield_mask.h` defines a `battlefield_mask_view` containing `const uint8_t *pixels`, `int width`, `height`, `pitch`, and `uint32_t generation`. Snapshot data is immutable while the existing frame reader owns it. No GPU consumer accesses mutable drawing storage. Exact hook signatures follow the verified call map in Task 1.

- [ ] Add meaningful coverage tests: clipped world writes, transparent UI holes, blended UI coverage, retained dirty regions, overlapping copies, cursor-only updates, and menu/resize invalidation. Expected eligibility is byte-exact in synthetic fixtures.
- [ ] Implement surface coverage and hook callbacks based on Task 1. Initialize unknown allocations as protected; preserve ordering through copies. Keep mask generation tied to the corresponding color snapshot.
- [ ] Add a mask allocation to each browser publication slot. Extend the shared protocol with slot-bound pointer, pitch, dimensions, and validity; bump its version and update C offset assertions and TypeScript protocol tests together. Release masks using the existing frame ownership rules.
- [ ] Pair Windows coverage with the image snapshot under a consistent acquisition sequence. Invalidate instead of pairing a current mask with an older color image. Respect the 1x/HD relationship.
- [ ] Test alternating readers/writers, buffer growth, size changes, game exit, and missing masks. Assert no publication exposes a mask from another frame and no retired buffer remains reachable by a reader.
- [ ] Run the new C test target and existing lift/protocol/frame-buffer tests; record commands and results. Commit the independently working coverage change when implementation is authorized.

## Task 3: Add the browser shader and setting

**Files:** `gl-shaders.ts`, `gl-presenter.ts`, `presenter.ts`, protocol/settings files and existing settings UI from the file map; presenter/protocol/UI tests and new browser image checks.

**Interfaces:** add `BattlefieldEnhancement = "off" | "enhanced"`. Extend `Presenter.configure(scale, bars, enhancement?)` with default `"off"`; expose a renderer capability indicating whether enhancement is supported. The 2D presenter accepts configuration but reports unsupported and retains its current path.

- [ ] Add tests for default Off, settings persistence and invalid-value fallback, immediate toggle without a new game frame, missing mask bypass, and texture recreation after context loss or WebAssembly memory growth.
- [ ] Upload the paired mask as an unsigned normalized R8 texture using nearest filtering; honor mask pitch. Upload only when its frame changes and reuse buffers and texture storage when dimensions are stable.
- [ ] Implement the specified shader math, sampling-footprint protection, and a zero-effect bypass before extra texture samples. Keep raw frame capture behavior intact; add an explicit enhanced-output capture option for image checks.
- [ ] Add the setting to the existing presenter settings path, with capability-aware behavior. Preserve old settings and the current scaling controls.
- [ ] Compare synthetic GPU fixtures against a small test-only CPU reference: flat colors, dark/light edges, indexed palettes, UI of the same color as adjacent terrain, fractional scaling, and downscaling. Require exact protected output relative to the Off render and at most 2/255 channel error against the arithmetic reference for eligible pixels.
- [ ] Verify source-space world pixels change in a suitable fixture, protected pixels do not, Off matches baseline, and context loss produces a working restored picture.
- [ ] Run focused Vitest suites, `pnpm typecheck`, and the new browser image check with real WebGL2. Commit the browser implementation when authorized.

## Task 4: Add the Windows shader and setting

**Files:** `src/runtime/present.c`, `host.h`, `host.c`; D3D verification fixture or capture helper under `tools/`.

**Consumes:** Task 2's paired snapshot and Task 3's preset definition and test fixtures.

- [ ] Add D3D11 mask texture/SRV lifecycle and correctly aligned constant-buffer fields for the enhancement setting. Resize, disable, and dispose them alongside the frame resources.
- [ ] Port the same five-sample math and footprint protection to HLSL. Make HD dimensions explicit and bypass when pairing fails.
- [ ] Add Off/Enhanced to F10 and persist `battlefield_enhancement=off|enhanced` under `[present]` in `ra2.ini`, defaulting invalid or missing values to Off. Keep it separate from `scale` and `hdvoxels`.
- [ ] Render the same synthetic fixtures through D3D11, read back the render target, and apply the protected-output and arithmetic tolerances from Task 3. Test embedded cursors as well as overlays.
- [ ] Build using `build.cmd`, then check window resize, fullscreen, device/resource recreation, both editions, HD on/off, and entering/leaving a match. Record any unavailable case explicitly rather than claiming it passed.
- [ ] Commit the independently verified native implementation when authorized.

## Task 5: Review the actual picture and cost

**Files:** new browser image check; existing playtest/capture helpers; documentation from the file map.

- [ ] Capture the same fixed game frame with Off and Enhanced for grass, snow, desert/urban terrain, water, bright explosions, damaged buildings, infantry, and voxel vehicles. Compare zoomed crops and the full frame; use the same captured pixels for A/B comparison rather than two moving simulations.
- [ ] Confirm faction colors remain recognizable, shadows retain detail, fine textures do not become noisy, edges show no halos, and panning causes no new flicker. Tune the single preset if needed, keeping both shader formulas synchronized.
- [ ] Demonstrate unchanged sidebar, radar, dialogs, text, placement/selection indicators, and both cursor paths in diagnostic comparisons. Inspect mask boundaries at 1x, fractional scale, and HD presentation.
- [ ] Measure identical busy scenes with effect Off/Enhanced after warm-up. Initial budget: no more than 5% median FPS regression and no more than 10% game-thread CPU-time increase at 1080p on the recorded machine. Measure GPU overhead where supported; record mask memory as well as frame memory. If the budget fails, optimize or document a scope revision before enabling the preset by default.
- [ ] Exercise unsupported renderers, missing/new protocol combinations, repeated matches, and teardown. Preserve graceful fallback and invalidate old coverage.
- [ ] Update user and architecture docs, record screenshot comparisons and measurements, and present the visual result for review. Default remains Off unless explicitly changed after that review.

## Plan review

All requested behavior maps to Tasks 1–5. The unproven part is UI coverage, not shader support. Task 1 intentionally gates later work; it must produce concrete call-site evidence before hook signatures and address-specific patches can be finalized. No shader, runtime, settings, build, or test code was changed while writing this plan.
