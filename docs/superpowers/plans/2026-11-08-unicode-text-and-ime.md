# Unicode Text and IME Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement an approved revision task by task. Steps use checkbox syntax for tracking.

**Goal:** Bring Vera20k-style multilingual text rendering and typing to both RA2 and YR across every existing recomp build.

**Architecture:** A shared CPU text library provides Unicode layout and glyph masks through a C ABI. Game-specific adapters measure and draw complete strings into the existing game surfaces; Windows, SDL/Linux and browser adapters feed committed text and composition to the active game edit.

**Tech stack proposed:** C host; a small Rust `staticlib` using Parley 0.12 (`std`, `complex-scripts`, system fonts disabled) and Swash 0.2.10; bundled OFL Noto fonts; existing DirectDraw/native32 and win32hle surfaces. No wgpu or winit dependency in recomp.

**Spec:** The requirements and findings below are the proposed brief. This is an investigation and staged plan, not an approved implementation specification. ABI discovery and mixed-toolchain linking remain explicit first-milestone work.

## Scope and constraints

- User requested inspection and a plan, then explicitly selected **all builds together**. No product implementation is authorized by this document alone.
- Follow-up scope explicitly includes visible text entry when needed: in-game chat, lobby chat and other eligible text fields, not only rendering already-committed messages.
- The user clarified that in-game chat and main-menu UI input boxes have different styles. Match each existing control's context; do not introduce one universal chat-box appearance.
- Cover `game` and `gamemd`: Windows MSVC x86, Windows clang-cl/xwin cross-builds used under Wine/CrossOver on macOS/Linux, Linux i386, and Emscripten/browser. macOS currently uses the Windows executable; this does not propose a native macOS renderer.
- Keep the game's simulation, save formats, packet layouts and original gameplay authority intact. A renderer upgrade must not imply that byte-limited fields or every network transport now support arbitrary Unicode.
- Existing original-font text keeps its native metrics and appearance. Extended text uses shaping, script fallback and a pixel-grid appearance. Preserve selected mod fonts and the explicit Thai-font option.
- Use one layout result for measurement, wrapping, painting and caret geometry. Do not shape each UTF-16 unit independently.
- All calls into guest state and all authoritative edit mutations run on the game thread. Platform/UI threads pass owned events with an edit-generation identifier.
- Do not edit generated lifted C by hand. Make repeatable changes through `run_lift.py`, target metadata and runtime adapters.
- This checkout and `../pcrecomp` contain existing unrelated edits. Preserve them; implementation should use isolated task-owned worktrees. Changes to win32hle belong in a separate pcrecomp commit and are a dependency of recomp builds.

## Visible typing behavior

The player sees an editable chat line or text field on screen while typing. Native builds render the draft, caret and composition through the game text path. For the browser, the user's follow-up proposes replacing the keyboard toggle with a visible browser text box styled like the game's components; the recommended browser variant is below. The existing TYPE button alone does not meet this requirement.

| Context | Visible input and activation | Send, cancel and focus |
| --- | --- | --- |
| In-game chat | The existing chat shortcut opens a bounded, readable chat line at the game's chat location. Show the current recipient/channel, draft, caret and a backdrop sufficient to read over the battlefield. Focus text entry immediately. Preserve the game's existing all/allies/listener shortcuts rather than introducing an unrelated shortcut. | Enter sends committed text and closes the line; Escape cancels and closes it. During IME composition, Enter confirms the candidate first and does not send chat; Escape cancels the composition first. Typing does not trigger gameplay commands. |
| Lobby and room/setup chat | Reuse the existing visible chat input beside its message history. Clicking it activates text entry and the same Unicode/IME behavior. Keep the lobby's own send control and recipient behavior. | Enter sends when no composition is active. After a successful send, clear the sent draft and keep the field ready for the next message. Leaving the screen ends its input session. |
| Other text fields | Clicking an eligible name, search or description field activates that field, visibly showing its draft and caret. Discover each field's actual character and storage limits before enabling it. | Use that field's existing submit/cancel behavior; Enter must not become a universal chat-send action. Byte-only fields retain their explicit restrictions. |

For native desktop builds, opening/focusing an eligible game edit enables platform text input automatically. For the browser, position the visible text control over the active input area so the browser supplies caret, selection and nearby IME candidates. On mobile, tapping that visible input must request keyboard focus within the user's gesture; a later game-thread notification alone must not be relied on to open the software keyboard.

Keep one authoritative draft per editing session: the guest edit on native builds; for the proposed visible browser editor, the DOM control owns the temporary draft until an explicit handoff. Preedit stays with that owner and is never sent before confirmation. When a field closes or another field takes focus, release gameplay key state as needed, clear preedit and invalidate the old edit token. Returning from typing restores gameplay input.

### Browser variant: context-specific text controls

Current implementation: `Play.tsx` renders a TYPE toggle that focuses a textarea; `Play.module.css:.textInput` makes it transparent and 1x1 pixels. `game/input.ts` sends each committed fragment immediately and empties the element. Making that element visible with CSS alone would therefore make the draft disappear as it is typed.

Recommended browser behavior:

- Replace the standalone keyboard toggle interaction with real text controls whose appearance follows the active game UI. Share input/IME handling, but use distinct presentation variants for in-game chat and shell/menu edit controls. Do not assume a universal metal border or red focus color.
- **In-game chat variant:** match the existing tactical chat line's location, recipient prefix, text colors, backing and scale. Open only while chat is active. Keep its compact battlefield presentation rather than borrowing the menu's input frame. A mobile send affordance, if needed, must fit that context.
- **Main-menu/lobby edit variant:** match the existing shell input box's frame, background, text insets, caret, focus/disabled state and surrounding screen theme. Apply it to the actual focused control, whether it is lobby chat, a name, search or another eligible field. Lobby chat uses the shell input style and its existing Send control; other fields retain their own actions.
- Inspect actual controls in both RA2 and YR before implementing CSS: capture an active in-game chat line, lobby chat field and ordinary shell edit in focused/unfocused states. Derive visual properties from those references and available game assets. Style differences must be observed, not invented from a generic "game-like" theme.
- Emit semantic field kind (in-game chat, lobby chat or ordinary shell edit), style/theme identity, bounds, recipient where applicable and edit-generation token from the game bridge. Select the browser presentation from that metadata, not from the existence of keyboard focus alone. Clicking/tapping the actual visible control opens the mobile keyboard directly.
- Let the browser handle local caret movement, selection, paste, dead keys and IME composition. Keep the full draft in the control while editing; do not retain the current clear-after-every-input behavior for this editor.
- Use explicit ownership: the DOM draft is the sole editable draft for the browser session. The guest edit is not also fed the same character stream. On Send/Enter outside composition, hand the validated committed draft to the existing game/chat consumer exactly once, then invoke its normal submission. Retain the draft until the bridge accepts it; Escape cancels without submission.
- For other eligible fields, handoff must use that field's own semantics, limits and required change notifications. Do not add a chat-style Send button to a normal menu input, or assume every edit can wait until Enter to affect its screen. Resolve fields that require live updates during the field inventory, preserving one editing owner. The chat editor is not an unrestricted injection box for whichever window happens to have focus.
- Preserve the existing native edit behavior and outgoing game/network path. The visible browser editor improves text entry; CP874 conversion and Unicode rendering/transport work from the other milestones are still required.

This browser variant supersedes the earlier hidden-textarea-only proposal when selected. It does not require native builds to embed a web UI. Before implementation, finalize placement and the draft-handoff contract from milestone 1's field inventory; do not implement simultaneous DOM and guest editing of the same draft.

Acceptance is a visible end-to-end interaction: open in-game chat, see `All: ภาษาไทย|` (illustrative recipient prefix and caret), compose/confirm another script, send it, and see the resulting message; then perform the same typing in a lobby's persistent chat field. Verify typing visibility, focus and composition independently of whether a particular transport can carry that script.

## What Vera20k actually does

Inspected local source at `b734cd8eb`; recomp at `276fbdc0`; pcrecomp at `9ca8527`. These identify the inspection baseline, not a claim of runtime parity.

| Responsibility | Vera source | Observed behavior |
| --- | --- | --- |
| Common text facade | `../vera20k/src/render/bit_font.rs` | Shared measurement, wrapping and drawing for shell and sidebar. Strings fully covered by GAME.FNT retain native measurement/wrapping; other strings use the Unicode engine. |
| Layout | `../vera20k/src/render/text_engine/mod.rs` | Parley shapes full strings, performs bidi ordering, script fallback and line breaking, and retains source cluster offsets. Layouts are cached independently of drawing scale; cache limit is 8,192. |
| Retail font integration | `../vera20k/src/render/text_engine/fnt_font.rs`, `fnt_fill.rs` | Builds an in-memory TrueType face from GAME.FNT pixel squares, keeping it first in the stack. Adds missing letters in its style; CJK fill uses a separately licensed Unifont-derived asset. |
| Font policy | `../vera20k/src/render/text_engine/fonts.rs` | 21 bundled Noto faces; no system fonts. Baseline 13 native pixels; Latin size 12.6, weight 700, width 82%; CJK 15 pixels, weight 400; Thai/other Brahmic scripts 13.4 pixels, weight 600. These are Vera's fitted choices, not universal game constants. |
| Rasterization | `../vera20k/src/render/text_engine/pixels.rs` | Converts outlines to on/off native-grid pixels, then scales those pixels. Fractional scaling blends block edges. This is not conventional smooth vector-font rendering. |
| GPU delivery | `../vera20k/src/render/text_engine/atlas.rs` | Cached white coverage glyphs in an RGBA wgpu atlas; begins at 1024 square and grows up to the device limit capped at 4096. This GPU layer does not fit recomp's current drawing architecture. |
| Screen integration | `../vera20k/src/render/shell_text.rs`, `sidebar_text.rs`, `shell_text_reveal.rs` | Shell clipping/alignment and sidebar effects share BitFont. Reveal/fade uses source cluster information. Vera also adds progressive narrowing/shrinking to fit translations. |
| Desktop typing | `../vera20k/src/app/input/ime.rs`, `chat.rs`, `handler.rs` | winit preedit/commit events; IME enabled only for eligible active chat edits; composition stored separately from committed text; key presses withheld while composing, releases still handled. |
| Browser typing | `../vera20k/src/web/ime.rs`, `ime_protocol.rs` | Hidden textarea over the active edit supplies composition and commit events. Handles keyCode 229/Process, focus transfer and UTF-16-to-byte cursor conversion. |

The bundled font directory is approximately **28.6 MB uncompressed**, including notices and the Unifont-derived fill. A full embedded font set therefore needs explicit download/binary-size measurement.

Vera is not an unrestricted Unicode editor: its IME module limits eligibility to four chat targets, documents other edits as residuals, retains native byte-only player-name restrictions, and notes imperfect browser candidate placement. Its in-game message edit appends/deletes UTF-16 units (`ui/messages.rs`), so copying it would not automatically provide safe supplementary-character or grapheme editing. Do not advertise emoji coverage: these bundled fonts are not a complete emoji font stack.

## Where recomp differs today

| Layer | Current owner and limitation | Port consequence |
| --- | --- | --- |
| Lifted bitmap text | `src/runtime/thai_font.c/.h`, `run_lift.py:THAI_FONT_CALLS` | Optional CP874 bitmap mark placement already wraps direct and virtual calls. Reuse the interception mechanism, but general shaping requires the whole string and matching width hooks. |
| Known hook entry points | YR layout `0x00434CD0`, glyph `0x00434120`, direct text `0x00434500`; RA2 `0x00432490`, `0x004318E0`, `0x00431CC0` | These are confirmed existing hook targets, not an exhaustive text API. The YR lifted direct-text body reads 16-bit units. |
| Width/alignment | Vera names YR measure `0x00433CF0`; inspected lifted `0x004A59E0` calls `0x00433ED0` | Trace both width paths and callers. The existing Thai target list does not cover all measurement/alignment. RA2 counterparts and complete ABIs remain to be established. |
| Windows presentation input | `src/runtime/present.c`, `host.c` | Presenter forwards key events and drops its WM_CHAR/WM_SYSCHAR to avoid duplicate insertion; guest windows use ANSI APIs. Unicode commits cannot simply be posted as large WM_CHAR values. Wine tracks a logical guest focus distinct from the presenter. |
| Linux input | `../pcrecomp/runtime/win32hle/screen.c`, `user32.c` | SDL physical keys become virtual keys; TranslateMessage uses a US character map. The inspected event pump has no SDL_TEXTINPUT/SDL_TEXTEDITING handling. |
| Browser input | `web/src/game/input.ts`, `screens/Play.tsx`, `src/web/presenter.c` | TYPE button focuses a textarea; composition commits are already deduplicated, but preedit is not sent to the game. UTF-8 commits are narrowed to CP874 and unsupported characters become `?`. The 512-event ring can drop individual characters when full. |
| HLE edit storage | `../pcrecomp/runtime/win32hle/user32.c:edit_proc` | Default edit control storage and selection use byte strings. WM_CHAR inserts `(char)w`; wide text needs an explicit route, not an assumed Unicode WM_CHAR contract. Game-subclassed NewEdit paths must be traced separately. |
| HLE conversions | `../pcrecomp/runtime/win32hle/kernel32_crt.c` | GetACP reports 1252; inspected narrow/wide conversions use the CP1252 table and ignore the requested codepage. Fixing browser input alone will not fix later conversions. |
| GDI text | `../pcrecomp/runtime/win32hle/gdidc.c` versus native Windows GDI | Separate font/text API path: SDL_ttf `TTF_SizeText`/`TTF_RenderText` on HLE, real GDI on Windows. Inventory actual game callers before claiming all screen text is covered by BitFont. |

## Approaches and recommendation

1. **Extend only the CP874 bitmap fix.** Smallest change; useful for Thai-specific cleanup. It cannot deliver Arabic shaping, bidi, CJK IME or general Unicode. It does not meet the proposed scope.
2. **Shared CPU library with Vera's upstream layout/raster stack — recommended.** New recomp-owned integration around Parley/Swash; preserve existing surfaces and presenters. This keeps one font/shaping policy across platforms and avoids adding a second GPU renderer. Cost: Rust build integration, font payload and an Emscripten ABI compatibility milestone.
3. **Implement equivalent layout with C/C++ libraries.** HarfBuzz plus a rasterizer and explicit bidi, fallback and dictionary-breaking support can fit CMake. It avoids Rust integration but adds several independently coordinated text subsystems. Keep as the fallback if milestone 1 demonstrates that Rust cannot fit the actual build matrix; do not maintain both backends.

The recommendation is an engineering proposal, not a user-selected architecture. Copying Vera source is a separate choice: Vera's README/LEGAL.md identify GPLv3 plus additional terms, while recomp's LICENSE is MIT. Plan on new integration code and upstream libraries, sourcing OFL font assets with their notices rather than wholesale source transplantation. This records repository license declarations; it is not a compatibility determination.

## Proposed boundaries

| Files to create or modify | Responsibility |
| --- | --- |
| `text/Cargo.toml`, `text/Cargo.lock`, `text/src/{lib,layout,font,raster}.rs` | New CPU-only library; immutable layout handles; bundled font registration; pixel masks. No dependency on Vera, its app, or its GPU batch types. |
| `src/runtime/text_engine.h`, `text_runtime.c` | Stable C contract, initialization, font generation, layout lifetime and cache ownership. |
| `src/runtime/text_guest.c/.h` | Edition-aware string decoding, ABI adapters, measure/draw dispatch, guest-surface access and existing color/reveal semantics. |
| `src/runtime/text_input.c/.h` | Active edit identity, generation, composition and commit routing; explicit browser draft handoff into the guest consumer. No competing editable buffers. |
| `src/runtime/text_win32.c` | Unicode/IME messages from the visible native presenter, candidate positioning and clipboard text normalization. |
| `assets/fonts/`, `assets/fonts/README.md`, `cmake/text.cmake` | Font data/notices and shared-library build/package integration. Record provenance and payload sizes. |
| `run_lift.py`, generated target metadata, `CMakeLists.txt`, existing build scripts | Reproducible hooks for both editions; include the shared library in every host. |
| `src/web/presenter.c`, `web_api.h`, `web/src/game/{input,protocol}.ts`, `web/src/screens/Play.tsx` | Owned UTF-8 preedit/commit protocol, active-edit feedback and textarea/candidate placement. |
| `../pcrecomp/runtime/win32hle/screen.c`, `user32.c`, `win32hle.h` | Generic SDL text events, focus/caret notifications and duplicate-character suppression. Keep game addresses out of pcrecomp. |
| `../pcrecomp/runtime/win32hle/kernel32_crt.c`, `gdidc.c`, related selftests | Only the conversion/GDI behavior demonstrated necessary by the caller inventory. Do not turn this into an unrelated rewrite of all Win32 text APIs. |

Proposed C entry points, finalized after milestone 1: `ra2_text_init`, `ra2_text_shutdown`, `ra2_text_set_font`, `ra2_text_layout_utf16`, `ra2_text_layout_destroy`, `ra2_text_blit`, `ra2_text_input_preedit`, `ra2_text_input_commit`, `ra2_text_input_cancel`.

Layout takes explicit UTF-16 length, locale, direction, wrap width, font generation and style; returns bounds, positioned masks and source-cluster mappings. Blit takes a validated surface descriptor (pixels, dimensions, signed pitch, pixel format and clip). Input events take an edit-generation token and explicit text length. Rust allocations are released by Rust; no panic may unwind into C. Define exact structs/signatures in milestone 1 after the guest adapters' needs are known.

Draw glyph masks into the game's actual destination surface with its pitch, clip and RGB packing. Preserve shell clipping, sidebar effects, reveal colors and draw order. Keep a per-font-generation legacy eligibility decision: original-compatible text follows the original path; a string requiring shaping has both measurement and drawing handled by the new path. An option must never cause the old Thai shaper and new engine to shape the same string twice.

Start at the game's existing pixel grid. Reusing Vera's window-resolution glyph rendering would additionally require deferred drawing integrated with every presenter and capture path; that is a separate fidelity enhancement, not a prerequisite for Unicode text.

## Review focus

1. Non-ASCII text reaches the right wide-string consumer without CP874/CP1252 loss or double insertion.
2. IME Enter/Escape affects composition first; switching edit, screen or focus cannot deliver a late commit to a different field.
3. Combining sequences, RTL runs and surrogate pairs retain valid storage and matching measurement/caret geometry.
4. Mod-font reload, cached text and surface changes do not retain stale masks, pointers or pitch assumptions.
5. Legacy byte fields and network messages keep their limits and encoding contracts; unsupported transport is reported accurately.

## Milestone 1: Prove build integration and guest seams

**Files:** `cmake/text.cmake`, `text/Cargo.toml`, `text/src/lib.rs`, `src/runtime/text_engine.h`, a small C ABI selftest; extend this document with the resulting ABI table.

- [ ] Write a tiny failing C-to-Rust test that lays out/rasterizes a fixed string and releases its result. Make the initial library test exercise a real Parley/Swash path, not just an integer FFI call.
- [ ] Build and run it for i686-pc-windows-msvc with static CRT, i686-unknown-linux-gnu, and wasm32-unknown-emscripten. Build the Windows archive through the clang-cl/xwin cross-build path too. Test Wine/CrossOver execution where available.
- [ ] Match Rust's Emscripten ABI to this project's Emscripten 6.0.12, pthread/shared-memory and `-fwasm-exceptions` flags. Test final `emcc` linking and execution in the existing worker model. Pin the working Rust toolchain and lockfile; if std must be rebuilt, document that dependency explicitly.
- [ ] Inventory live callers of the two font paths, width/alignment, GDI text, NewEdit and in-game chat for both editions. Record argument locations, stack cleanup, returns, destination surface, clipping and string representation. Include native presenter and classic-mode input routing.
- [ ] Identify the actual in-game and lobby edit owners, activation/close events, recipient mode, visible field bounds and caret position in both editions. Trace the complete shortcut/click -> visible draft -> submit/cancel interaction; finding a font draw call alone is insufficient.
- [ ] Record each supported field's semantic kind, shell/in-game style identity, focus states and live-update versus submit behavior. Capture reference visuals for tactical chat, lobby chat and an ordinary menu input in both editions; the browser adapter must choose the correct presentation variant.
- [ ] Establish whether the guest's wide edit buffers and native IME insertion path can accept Unicode without new authoritative storage. Vera's named YR addresses (`0x00614B30`, `0x005D4510`, `0x007781B0`) are leads, not proof of a safe insertion ABI or RA2 equivalence.
- [ ] Acceptance: real text links/runs on all available build families, and a precise per-edition hook/input contract exists. Record unavailable runtime checks as outstanding. If Rust fails a required build, select the C/C++ alternative before proceeding; do not silently omit a platform.

## Milestone 2: Shared font, layout and raster core

**Files:** `text/src/{font,layout,raster}.rs`, `assets/fonts/`, `src/runtime/text_runtime.c`, `src/runtime/text_engine.h`, library tests.

- [ ] Add focused failing tests for original bitmap glyphs at 1x/2x, stacked Thai marks, Arabic joining with Latin numbers, CJK wrapping and a missing character. Assert valid cluster boundaries and agreement between measured bounds and emitted masks; use independently established expectations rather than Vera-generated output as the sole oracle.
- [ ] Implement the finalized C ABI, GAME.FNT-first font policy, shaping and native-grid masks using upstream libraries. Derive font geometry from the selected FNT; treat Vera's baseline/size choices as tuning references. Preserve legacy character-code maps rather than treating every FNT slot as Unicode.
- [ ] Keep bounded layout/mask caches keyed by content, style, locale, direction and font generation. Add a mod-font reload test proving invalidation. Avoid per-frame font registration and shaping unchanged labels.
- [ ] Bring in the OFL Noto script set with source/notices. Decide whether the extra Unifont fill and generated GAME.FNT-style missing letters are needed after comparing the simpler fallback; they are optional visual refinements, not required to accept Unicode.
- [ ] Run the new library tests and C ABI harness. Measure compressed browser payload, loaded memory and representative cold/warm layout cost; publish measured values in the implementation PR. Commit this independently testable core.

## Milestone 3: Connect measurement and drawing across the game

**Files:** `src/runtime/text_guest.c/.h`, `run_lift.py`, target metadata, `CMakeLists.txt`, `src/runtime/thai_font.c/.h`, focused lift/runtime tests.

- [ ] Add failing tests for both editions' direct and virtual interception, untouched non-text calls, preserved guest register/stack contracts, and a string requiring fallback whose width and draw use the same layout.
- [ ] Implement complete-string interception and all associated measurement paths identified in milestone 1. Decode plain wide strings, legacy FNT codes and encoded reveal/color spans according to the caller; never globally invert or reinterpret every UTF-16 string.
- [ ] Blit into real game surfaces; test clipped glyphs, nontrivial pitch and the active RGB format. Preserve baseline, tabs, CR/LF behavior, alignment, missing-glyph behavior, tint and cluster-safe reveal. Keep original-only text on the original path.
- [ ] Integrate any proven GDI callers as part of the same coverage inventory. Verify bitmap, GDI and mod-font paths separately; do not claim universal coverage from one menu caption.
- [ ] Give the new engine precedence for opted-in Unicode strings while preserving the selected legacy Thai option. Test enabling/disabling and font switches without double mark placement.
- [ ] Run the existing `ThaiFontCallTests`, the new hook/runtime tests, and capture a menu, sidebar tooltip and chat line for each edition on each platform family. Compare original-font text to the baseline. Commit after actual rendered-output inspection.

## Milestone 4: Unicode commits through the active guest edit

**Files:** `src/runtime/text_input.c/.h`, `text_guest.c`, `src/web/presenter.c`, `web_api.h`, native host hooks, minimal pcrecomp notifications, input tests.

- [ ] Add failing integration tests for committing `Hello ภาษาไทย 你好` to eligible shell/chat edits, a rejected stale edit token, and a long paste at the real guest capacity. Confirm rejected text does not partially split a surrogate pair.
- [ ] Test visible input lifecycle through production paths: the game chat shortcut opens and focuses its readable draft line with recipient and caret; Enter sends/closes and Escape cancels/closes outside composition. Clicking the lobby field focuses it; sending clears the sent draft and retains typing focus. A different text field uses its own submit behavior.
- [ ] Route UTF-8/UTF-16 commits to the proven guest wide-input consumers. Preserve the guest edit's limits, notifications, cancel/send behavior and authoritative text. Bypass the browser's CP874 narrowing only for this explicit Unicode route; keep legacy conversion at actual byte boundaries.
- [ ] Implement one input ownership rule: while an edit is accepting platform text, physical key events still update required key state but do not synthesize printable guest characters a second time. Preserve controls, hotkey behavior outside edits and all key releases.
- [ ] Use owned, bounded commit messages across threads; accept/reject a batch at valid scalar boundaries. Do not enqueue a raw pointer into temporary JS/FFI memory or silently drop half a paste through the existing character ring.
- [ ] For the proposed browser editor, add an acknowledged draft-submit operation bound to the edit token. Validate the complete draft against the destination's capacity/encoding before mutation, insert and submit through the proven game consumer once, and retain the DOM draft on rejection. Test stale targets, a full queue and repeated Send activation.
- [ ] Test selection replacement, deletion, prefix protection, over-limit paste, edit destruction and screen transitions through production consumers. Supplementary characters must remain valid even without a glyph; grapheme-level editing must be explicitly specified per upgraded edit, not inferred from Vera's UTF-16-unit model.
- [ ] Commit once both editions can type and read the chosen Unicode samples locally. This does not certify network round trips; milestone 6 owns that claim.

## Milestone 5: Composition and candidate placement on every platform

**Files:** `src/runtime/text_win32.c`, `present.c`, `host.c`, `src/linux/main.c`, `../pcrecomp/runtime/win32hle/screen.c`, `user32.c`, `win32hle.h`, browser input/protocol/Play files and tests.

- [ ] Add failing event-sequence tests: composition start/update/commit/cancel; Enter confirms without sending chat; Escape cancels; blur, edit-generation change and screen exit clear preedit; delayed commits cannot enter a replacement edit.
- [ ] Windows: acquire Unicode composition/result strings at the visible input window, respecting guest logical focus. Position system candidates from the shaped caret transformed through presenter scaling/letterboxing. Handle native ANSI/Wide message behavior explicitly, preserve original/classic paths, and verify duplicate suppression under Wine/CrossOver.
- [ ] Linux: add generic SDL_TEXTINPUT and SDL_TEXTEDITING event delivery, start/stop text input with edit eligibility, and update SDL_SetTextInputRect. Keep game addresses/eligibility in recomp; keep SDL transport in pcrecomp. Suppress printable US-map synthesis only while platform text owns it.
- [ ] Browser: replace the TYPE toggle interaction with context-specific visible textarea/input variants: tactical chat and shell/menu edit. Use milestone 1's reference visuals and field/style metadata. Preserve the draft during editing and use milestone 4's acknowledged handoff; do not also stream its characters into the guest edit. Guard isComposing, Process and keyCode 229 before Send/Enter. Let the DOM own caret, selection and preedit, and position the editor using active-edit bounds from the game.
- [ ] Native builds draw preedit separately with a distinct composition style; the visible browser control uses the browser's composition presentation. Candidate selection remains owned by the OS/browser. Update placement on resizing, fullscreen and scale changes. Preedit never enters chat transport or persistent guest text before confirmation.
- [ ] Check the visible draft, caret, composition and input backdrop while typing over gameplay and in lobby fields. Verify that tapping the visible browser input on mobile opens the software keyboard. Test browser selection replacement/paste, exactly-once submit, draft retention on rejection and restoration of gameplay focus after closing.
- [ ] Compare the tactical-chat and shell-edit variants against their respective game references in both editions. Verify that a normal menu field receives its own style/actions, lobby chat retains the shell style, and switching between screens cannot leave the previous field's style, recipient or draft attached to the next control.
- [ ] Run event tests and real Thai typing plus Chinese/Japanese IME sessions on Windows, Linux, browser and Wine/CrossOver. Synthetic browser events alone do not prove native IME behavior. Commit each repository's coordinated changes.

## Milestone 6: Compatibility, screen coverage and release gate

**Files:** targeted tests in existing playtest/browser suites, `src/web/wolapi.c` tests where relevant, implementation documentation; transport code only if a proven conversion defect requires it.

- [ ] Audit lobby and in-game chat send/receive separately, including WOL Unicode callbacks and the actual LAN/in-game packet encoding. Trace every conversion after input. Exercise a two-client Unicode round trip on each supported chat transport; do not widen packets or names incidentally.
- [ ] Keep byte-only names, filenames, login fields and save descriptions on their established contracts until each is traced. For a field that cannot represent a character, reject or explain the limit at that field rather than silently changing network/save formats.
- [ ] Run a matrix of both editions by Windows, Linux, browser, and Windows-under-Wine/CrossOver: main menu, multiplayer setup, lobby/chat, sidebar/tooltips, in-game chat, load/save screens and a mod font. Record render coverage and typing eligibility separately.
- [ ] Include 800x600 menus, widescreen gameplay, 1x/2x/fractional display scaling, window resize, focus loss and font/mod changes. Verify native screenshots/headless recordings contain the same text as the visible presenter.
- [ ] Compare warmed text-heavy-frame cost with the current build; unchanged labels must hit caches, and font/layout work must not add per-character indirect-dispatch overhead to every frame. Investigate any measurable regression before default enablement.
- [ ] Keep the feature behind a shared opt-in switch until the matrix is checked. Enable by default only after every existing build family has passed its applicable checks. Document remaining byte-only fields and unsupported glyph classes precisely.

## Verification commands for execution

These are future checks, not commands run for this investigation:

- `python -m unittest tools.test_lift_patches.ThaiFontCallTests` plus the new focused hook tests.
- From `web/`: `pnpm test -- src/game/input.test.ts` and `pnpm typecheck`; add the composition/protocol tests to that focused invocation.
- New library: `cargo test --manifest-path text/Cargo.toml --lib`, plus C ABI executables on each target. Cross-target compilation alone is not a runtime pass.
- Windows: `build.cmd` for `gamemd`; a separate build directory with `CMAKE_ARGS=-DRA2_TARGET=game` for RA2. Exercise the existing clang-cl/xwin cross-build too.
- Linux: `build-linux.sh`, then a separate `BUILD_DIR` with `CMAKE_ARGS=-DRA2_TARGET=game ./build-linux.sh`.
- Browser: `build-web.cmd`/`build-web.sh` for both editions. During C iteration use a separate BUILD_DIR with `-DWEB_LINK_OPT=-O1` and WEB_OUT outside `web/public/game`, as CLAUDE.md requires; use release flags for performance/release checks.
- Run focused native playtests from `docs/testing.md`, then inspect captures for text correctness. Existing menu-transition tests alone do not verify Unicode or IME.

## External API references

- [Parley 0.12 layout API](https://docs.rs/parley/0.12.0/parley/) confirms shared font/layout resources and shaping, bidi, wrapping and alignment capabilities.
- [Rust Emscripten platform support and ABI guidance](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-emscripten.html) explains C/C++ interoperability and the requirement to match Emscripten ABI flags/toolchains; compatibility with this build is not presumed.
- [SDL2 text-input workflow](https://wiki.libsdl.org/SDL2/Tutorials-TextInput) distinguishes committed text from composition and assigns composition drawing to the application; [SDL_SetTextInputRect](https://wiki.libsdl.org/SDL2/SDL_SetTextInputRect) provides candidate positioning.
- [Microsoft IME composition values](https://learn.microsoft.com/en-us/windows/win32/intl/ime-composition-string-values) distinguishes composition, cursor and committed-result retrieval.

## Deliverable status

Source inspection and this port proposal only. No builds, gameplay captures or IME sessions were run, and no renderer/input code was changed. The next implementation deliverable is milestone 1's cross-platform link proof and per-edition hook contract; runtime fidelity and full Unicode transport remain unproven until the later milestones.
