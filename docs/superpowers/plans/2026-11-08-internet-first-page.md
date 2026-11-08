# Internet first page: news and information panels

Date: 8 November 2026. Status: proposed plan; no product implementation.

## Follow-up prototype

At the user's request, a separate content-loading POC now lives in `web/e2e/internet-content/`, served by `web/e2e/internet-content.mjs`. It loads either a separate JSON feed or a styled HTML document into a preview of this page. HTML uses a read-only sandbox. The game shell is a static local reference, with a CSS fallback; production dialog integration is still pending.

The focused `web/e2e/internet-content-check.mjs` browser check passed for JSON/HTML HTTP loading under cross-origin isolation, loading/cached failure, HTML isolation, unavailable content, leaving/returning and a narrow viewport. Screenshots are in ignored `build-web/internet-content-poc/`. See the [POC README](../../../web/e2e/internet-content/README.md) for startup and limitations. This is a throwaway prototype, not completion of the implementation tasks below.

## Requested scope

Inspect the first Internet page in `C:/Users/Norrapat/projects/vera20k` and plan its presentation for recomp. The user selected **screen appearance only**, then specified **the Internet first page, news loading and related information**, and **browser build first**.

The deliverable is the news/information area visible immediately after choosing Internet. Preserve recomp's existing action buttons, navigation, login, lobby, match transport and result reporting. Account creation, guest login, password recovery, lobby redesign and VERA's matchmaking are outside this change.

Loading news is a read-only content operation for this page, independent of multiplayer authentication. The final feed URL and recomp's rules copy remain operator content decisions; they are not inferred from VERA's deployment.

## What VERA implements

Source inspection: VERA `0e0f2465e`; recomp `276fbdc0`, with existing local changes. Findings below describe source, not a newly captured runtime comparison.

| Area | Source in VERA | Observed implementation |
| --- | --- | --- |
| Entry | `src/app/shell_wol.rs` | The normal Internet visit opens the modern `0x10F` page directly. Retail welcome `0x10E` remains for diagnostics. |
| Layout | `src/ui/wol_login.rs`, `INFO_NEWS`, `INFO_RULES` | In an authored 800×600 shell, news is `(36,36,560,312)` and rules is `(36,364,560,176)`. Right-side buttons remain separate. |
| Panels | `src/app/frontend/skirmish_shell_render/wol_login.rs`, `paint_info_pane`, `push_info_panel` | Dark translucent fill, two list-frame rings, 12 px padding. Fill RGB is `(0.050,0.060,0.044)`, alpha `0.82`. Titles are white, summaries 80% gray and dates/status 60% gray; section headings use shell label color. |
| News rows | Same renderer | Date column 88 px; title and summary wrap to at most two lines each. Rows have 10 px spacing. A whole post is omitted when it cannot fit; there is no news scrolling control. |
| Rules | Same renderer | Heading plus numbered, wrapped rules; 20 px number column. Each rule occupies at most two lines, with 2 px spacing. |
| Content state | `src/app/shell_wol/login_info.rs` | Independent background reads on page entry. Initial state is loading. At most five posts, dates clipped to 10 characters, titles to 160 and summaries to 400. |
| Failure/refresh | Same owner and renderer | First-load failure or an empty post list displays an unavailable note. Existing posts remain visible during refresh and after a failed refresh. Failed activity refresh removes the count. |
| Activity | Same owner | Show players online if positive; otherwise games in the last 24 hours if positive; otherwise omit the count. |
| Copy | `src/i18n/vera20k.en.ini` | Labels include “Latest news”, “Loading the news...”, “The news is unavailable right now.” and “Online rules”. VERA-specific policy/contact text is separate content. |
| Capture reference | `src/app/diagnostics/shell_capture/movies/wol.rs` | Existing controlled checkpoint `wol-modern-login-page` fills the production pane with fixed posts and activity. |

VERA's native fetch implementation reads its lobby's `/v1/stats` and website `news.json?lang=…`. Its current WASM implementation does not fetch these: it reaches the unavailable state. Recomp's browser version should use the browser's own asynchronous fetch rather than copy that limitation.

## Mapping onto recomp

Recomp already renders the retail Internet screens. Its first Internet page is welcome dialog `0x10E`, not VERA's modern login page. For this appearance-only change, put the information panels on recomp's existing first page; do not change the route to login.

The existing `tools/dialogs.py --exe game/<edition>.exe --show 0x10E` was run for both executables. Both templates contain the left-side persona/statistics and icon-glossary children. Many labels and group boxes have anonymous ID `0xFFFFFFFF`; a list of `GetDlgItem` calls alone cannot hide them. RA2 and YR also have different authored coordinates and action sets. Keep those edition differences.

Relevant existing owners:

- `src/linux/script.c`: HLE dialog-created notification, already forwarding to browser helpers.
- `src/web/presenter.c`: browser dialog tracking, pump and `@ra2` event publication.
- `src/web/map_search.c`: precedent for modifying selected native dialog controls and publishing overlay geometry.
- `web/src/game/protocol.ts`, `src/web/web_api.h`, `web/src/game/store.ts`: the typed game-to-page event boundary and protocol version.
- `web/src/screens/Play.tsx`: game canvas and overlay composition.
- `web/src/screens/MapSearchStatus.tsx`: precedent for mapping logical game coordinates to a DOM overlay.
- `web/src/game/presenter.ts`: game size and capture APIs; a canvas-only capture will not contain DOM panels.
- `web/src/game/link-targets.ts`: an existing website `/news` link mapping, **not evidence that a JSON feed already exists**.

## Approaches and recommendation

1. **Browser React overlay aligned to the native first page — recommended.** Publish page visibility and panel geometry from the game thread; render news and rules in React. Fits the selected browser-first scope, existing overlay architecture and browser fetch. Requires careful native-child suppression, page lifecycle, cursor and screenshot composition.
2. **Render panels into the game's surface.** Better if all native builds become immediate scope; naturally participates in game-surface scaling and captures. Requires additional drawing/text integration and platform fetch adapters for the current browser-only request.

The overlay is an engineering recommendation, not a user-approved implementation design. Build no replacement welcome menu or duplicate native action buttons.

## Proposed visible result

At 800×600, use VERA's two panel rectangles as the initial visual reference:

```text
┌──────────────────────────────────────┬────────────────┐
│ Latest news             [activity]   │ Existing native│
│ Loading the news...                  │ Internet title │
│                                      │ and buttons    │
│ or dated titles and summaries        │                │
├──────────────────────────────────────┤                │
│ Online rules                         │                │
│ 1. ...                               │                │
│ 2. ...                               │                │
└──────────────────────────────────────┴────────────────┘
                  Existing native status line
```

Keep the retail backdrop visible beneath the translucent fill. Hide the old left-side widgets before drawing; otherwise their text and group frames show through. Retain title, right-side monitor/buttons and bottom help. At other logical sizes, fit panels within the actual free left area and reduce visible rows before allowing overlap. VERA's rectangles are authored pixels, not Win32 dialog units or browser CSS pixels.

Use text supplied for recomp, with the game's visual type style. Do not introduce a general font/shaping subsystem for this page; coordinate with the separate Unicode/IME proposal if that work proceeds.

## Implementation sequence

### 1. Capture and establish the page boundary

- [ ] Capture recomp's first Internet page for RA2 and YR at their actual menu sizes. Obtain a VERA `wol-modern-login-page` reference through its existing controlled capture path if a suitable capture is not already available; avoid rebuilding VERA just for source inspection.
- [ ] Identify the settled first-page window, its close/destruction, child modal visibility and transition boundaries through the existing HLE dialog/pump path. Do not infer page presence from login state or a generic “menu” flag.
- [ ] Inventory the left-side children, including anonymous labels/group boxes, by template identity/order, class and geometry. Preserve native controls and state; suppress only the replaced presentation. Ensure later game updates do not reveal them again.
- [ ] Resolve the alternate `0x11C` welcome variant if reachable in browser configuration; cover it or document the supported path explicitly.
- [ ] Define an `internetInfo` event carrying visibility, a page-generation value and news/rules rectangles in game pixels. Publish changes rather than every frame. Update both protocol definitions/version and reject malformed events.

Exit: a deterministic open/closed/geometry signal with no changes to button commands, account state or WOL transport.

### 2. Build the information panels with fixed content

- [ ] Add proposed `web/src/screens/InternetInfo.tsx` and its CSS module, mounted in `Play.tsx` from the typed store event.
- [ ] Map the logical rectangles to the canvas's actual picture rectangle, including letterboxing, fullscreen, device scaling and presenter scaling modes. Reuse or extract existing coordinate calculations only where needed.
- [ ] Match the panel fill, frame, heading, date column, body colors, wrapping and bounded row count described above. Derive borders from recomp's existing game chrome where possible, rather than adding a new theme.
- [ ] Keep panels read-only and out of the keyboard tab order. Preserve pointer delivery to the game. Check the page-layer cursor remains visible above the DOM panels; pointer pass-through alone does not solve cursor stacking.
- [ ] Remove panels immediately on leaving the first page, starting a transition, opening an overlapping modal, game exit or crash. Retain content separately so a temporary modal does not discard posts.

Exit: fixed loading, populated and unavailable fixtures render correctly without obscuring native buttons, help, cursor or dialogs.

### 3. Connect read-only news loading

- [ ] Add proposed `web/src/game/internet-info.ts`: bounded feed parsing, loading/result state and per-page refresh. Keep this separate from `WolClient` authentication and commands.
- [ ] Define a deployment-owned JSON feed contract `{ posts: [{ date, title, summary }] }`, optionally selected by language. Start with an operator-configured or same-origin feed; choose the actual URL/content before connecting production. Recomp's existing `/news` webpage is not automatically a JSON endpoint.
- [ ] Fetch asynchronously on page entry, with a finite timeout and cancellation on session disposal. Render strings as text. Retain the last good posts in memory across page revisits; ignore results from obsolete session/language generations.
- [ ] Match initial loading, successful posts, empty-feed unavailable and first-load failure states. Preserve cached posts through a failed refresh. Avoid polling continuously while the page is open.
- [ ] Keep online rules as deployment-owned static copy. Do not ship VERA's branding, contact address or service-specific promises as recomp's rules.
- [ ] Omit activity unless a real compatible public source is configured. If provided, apply VERA's online/recent-games/hidden behavior; failed activity reads must not hide the news.

Exit: slow or unavailable content never blocks navigation. Live news works in the browser when the configured feed is reachable, independently of WOL login.

### 4. Verify in the real browser

- [ ] Add focused tests for production feed parsing/refresh behavior, including malformed/oversized input, stale completion and cached-post preservation.
- [ ] Add component/protocol coverage for loading, populated and unavailable states, plus hiding the overlay when the native page closes.
- [ ] Extend existing browser e2e support with intercepted feed responses: slow success, failure and cached refresh. Capture the **composed browser stage**, not just the game canvas.
- [ ] Check both editions at 800×600, the supported smaller menu size, and a widescreen/fullscreen browser viewport. Confirm wrapped text fits and no replaced retail labels show through.
- [ ] Press existing Internet actions and Back/Main Menu; confirm the overlay leaves at the correct boundary and existing destinations still open. No new match-start/playthrough work is needed for an information-panel change.
- [ ] Run affected Vitest tests, frontend typecheck/build and scoped lint; build the changed browser C integration for both editions. Keep private outputs separate from the existing live preview bundles.
- [ ] Update `docs/web/protocol.md`, `docs/web/frontend.md` and `docs/web/testing.md` with the implemented event, feed configuration and screenshot procedure.

## Acceptance and remaining decisions

The first Internet page has VERA-style news and rules panels, visibly loads real configured news, remains usable while loading/offline, and removes the panels cleanly when the user leaves. Both browser editions retain their existing native actions.

Before product implementation, settle the feed location and recomp rules copy, then review the proposed overlay approach. Activity is optional and absent without genuine data. Native desktop integration and changes to Internet navigation remain separate future scope.

Existing dirty files in `src/linux/script.c`, `src/web/presenter.c`, `src/web/map_search.c`, `src/runtime/host.c` and tooling belong to other work. This planning task edits none of them; implementation must preserve those changes and coordinate the overlapping integration points.
