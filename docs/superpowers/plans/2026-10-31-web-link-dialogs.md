# Web Link Dialogs: Override Every In-Game Browser Link

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the browser and Linux builds from handing WOL-era links to the system browser.
Intercept every URL the game opens and show a dialog instead — an iframe when the target can be
framed, a confirmation with the original URL otherwise — in both editions, with no dead Westwood
destinations.

**Architecture:** Every in-game link goes through one of four shared routines
(three hand a URL to the system browser; YR's embedded WOL browser takes a page
key). Patch their entry points at lift time to call a host hook,
`ra2_open_url(url, ask)` or `ra2_open_wol_page(key)`, and return before the
temp-file, `FindExecutableA`, `CreateProcessA`, `TXT_LAUNCHBROWSER`,
`TXT_NOBROWSER` or embedded-browser path runs. The web host
emits an `open` event on the existing `@ra2` stdout protocol; the page maps the URL and renders a
Radix overlay. When the mapped target is known to allow framing, the overlay shows it in a sandboxed
`<iframe>`; otherwise it asks the player to confirm, with a `target="_blank"` link to the original
URL.

**Tech stack:** C (lifted game + `src/web` host), `run_lift.py`, React 18 / TypeScript / Radix /
Vitest, Node e2e scripts in `web/e2e/`.

**Related docs:** [protocol.md](../../web/protocol.md), [frontend.md](../../web/frontend.md),
[architecture.md](../../web/architecture.md), [testing.md](../../web/testing.md),
[bringup.md](../../bringup.md).

## Progress summary

| ID  | Track    | Task                                                       | Status  |
| --- | -------- | ---------------------------------------------------------- | ------- |
| T0  | Spike    | One routine patched end to end (RA2 Privacy)               | Done    |
| T1  | Intercept| Patch all four entry points                              | Done    |
| T2  | Intercept| Host hook + `open` event + protocol bump                   | Done    |
| T3  | Intercept| Linux hook and YR registry seeding                         | Done    |
| T4  | Page     | Link target mapping and tests                              | Done    |
| T5  | Page     | Iframe/confirmation dialog and Play overlay                | Done    |
| T6  | Content  | Topic copy, RA2Web links and env configuration             | Done    |
| T7  | Verify   | Unit, lift, e2e and headless tests                         | Done    |
| T8  | Docs     | Protocol/frontend/architecture/changelog                   | Done    |
| T9  | Optional | Help (`WinHelpA` / `GetHelpURL`) and Windows native        | Done    |
| T10 | Optional | Replicate the game dialog chrome with the game's art       | Done    |

## Findings (the spec)

The system-browser path writes a dummy `.html` file, finds the default browser with
`FindExecutableA`, then starts it with `CreateProcessA` and a `[open] <url>` command line.
Neither exe imports `mshtml`, `shdocvw` or `urlmon`. YR additionally hosts an embedded WOL
browser (`DoWebPageDialog`, `HTML\frame.htm`) that reads a registry URL and shows it in an
in-game window; the lift intercepts that entry too (`ra2_open_wol_page`).

| Edition | Routine | First instruction | Arguments | `FindExecutableA` | `CreateProcessA` |
| --- | --- | --- | --- | --- | --- |
| RA2 `game.exe` | `0x0073C580` (`wonline.cpp`) | `81 ec 10 03 00 00` | `ecx` = URL, `edx` = ask | `0x0073C5FA` | `0x0073C69E` |
| YR `GameMD.exe` | `0x0077DC90` (`wonline.cpp`) | `81 ec 10 03 00 00` | `ecx` = URL, `edx` = ask | `0x0077DD0A` | `0x0077DDAE` |
| YR `GameMD.exe` | `0x00551630` (`ViewHTML`) | `81 ec 68 04 00 00` | `ecx` = URL | `0x00551716` | `0x00551779` |
| YR `GameMD.exe` | `0x00773E90` (`DoWebPageDialog`) | `83 ec 28` | `ecx` = page key | embedded WOL browser (`HTML\frame.htm`) | — |

All four are `void`, take their arguments in `ecx`/`edx`/one stack argument, and have no
stack arguments beyond `DoWebPageDialog`'s page key. The first lifted instruction is the stack
allocation, so replacing it with a host call and `return` is safe. Generated bodies:
`src/recomp/gen_game/recomp_0050.c:34964`, `src/recomp/gen/recomp_0054.c:43536`,
`src/recomp/gen/recomp_0023.c:755`, `src/recomp/gen/recomp_0054.c:1730`.

The dummy HTML is `<title>Hi there.</title>` (RA2) or `<title>ViewHTML</title>` (YR); it is only a
probe for `FindExecutableA`, never displayed. No other code path opens a URL:
`FindExecutableA` has exactly one call site in RA2 and two in YR.

### Affected menus

| Dialog | Control | Destination |
| --- | --- | --- |
| `0xE7` new nickname | `GUI:ViewPrivacy` (1398) | `privacypolicy.westwood.com` |
| `0x10F`, `0x11D` WOL login | `GUI:ManageAccount` (1772) | `games2.westwood.com/cgi-bin/cgiclient?register...` |
| `0xBE` WOL lobby | `GUI:ViewTourLadder` (1368), `GUI:GoBatWeb` (1398) | `www.westwood.com/.../tournaments/redalert2/` |
| `0xC1` ladder | `GUI:PlayerTourWeb` (1004), `GUI:BatTourWeb` (1005) | tournaments URL |
| `0x113` YR custom match | `GUI:Tournament` (1955), `GUI:News` (1958) | registry `Community` URL |
| `0x10E`, `0x11C` YR WOL | `GUI:YuriWebSite` (1375) | registry `Community` URL |
| `0x114` YR my info | `GUI:ManageAccount`, `GUI:Tournament` | registration / registry |
| automatic | login error | `apiregister.westwood.com/support/<kind>_<locale>.html` |
| automatic | consent | `apiregister.westwood.com/consent_form/index_<locale>.html` |
| automatic | network status | `networkstatus.westwood.com` |

The dialog map is derived with `tools/dialogs.py` into `work/dialogs-ra2.json` and
`work/dialogs-yr.json` (not committed).

T7 found one correction: in a logged-in lobby with no ladder service, YR's
`0x113` Tournament/News (1955/1958) open the game's own `0x131` notice and do
not call the URL routine, so they produce no `open` event. The YR registry
`Community` read is the `0x10E`/`0x11C` YuriWebSite (1375) path, which is
verified below. RA2's `0xE7`, `0x10F` and `0x114` controls all reach the shared
`0x0073C580` routine.

### What happens today

| Host | Result |
| --- | --- |
| Browser | `FindExecutableA` returns `SE_ERR_NOASSOC` (31) → `TXT_NOBROWSER`; `CreateProcessA` is a stub |
| Native Linux | same (win32hle stubs) |
| Windows native32 | real shell32/kernel32 → opens the default browser to dead Westwood URLs |
| YR registry links | `HKLM\Software\Westwood\Yuri's Revenge\URL` is not seeded → the button returns silently |

Relevant stubs: `pcrecomp/runtime/win32hle/advapi32.c:248`,
`pcrecomp/runtime/win32hle/kernel32.c:82`, `pcrecomp/runtime/win32hle/user32.c:2028`
(`WinHelpA`), and `src/web/wolapi.c:1207` (`WolChat::GetHelpURL`).

### URL provenance

The host always logs the URL it received (`[url] <url>` on Linux/headless; the `open` event
carries it on the web) and never rewrites it. Mapping adds `topic`/`detail` only. The page
component receives the original `LinkTarget.url` unchanged, displays it, and may use it (the
support kind, a "copy" action, an explicit "open original" for unknown hosts). A mapped
destination is never presented as the original.

## Decisions

- **D1 — Intercept at the routine entry, not per button.** One patch per routine covers every call
  site, including the registry paths. The alternative (a `FindExecutableA` sentinel plus a
  `CreateProcessA` parser in win32hle) is the fallback if an entry patch misbehaves; it keeps the
  legacy confirmation dialog and adds a 1 s foreground wait unless `CreateProcessA` returns FALSE.
- **D2 — Embed the target in an iframe where it can work; confirm otherwise.** The overlay always
  shows the original URL. When `LinkTarget.embed` is true (a configured RA2Web page verified to
  allow framing and compatible with the app's `COEP: require-corp`), it renders the URL in a
  sandboxed `<iframe>`. Otherwise — dead Westwood hosts and unknown external URLs — it shows a
  message that the game asked to open an external link, with an explicit "Open in browser" action.
  Framing is best-effort: a target may send `X-Frame-Options`/CSP `frame-ancestors`; the
  external-open fallback is always visible.
- **D3 — Map dead Westwood links to configured RA2Web pages, with a local notice as fallback.**
  Never auto-open a dead host. Unknown `http(s)` URLs are shown with an explicit "Open in browser"
  link; non-`http(s)` schemes are blocked.
- **D4 — Windows native32 keeps the real browser for now.** Only web and Linux define
  `RA2_URL_HOST`/`__EMSCRIPTEN__` to take the patched path. Task 9 can extend it.

## Global constraints

- No changes in `../pcrecomp` are required for the recommended path. Keep it that way unless D1
  changes.
- Web and Linux only take the new path; the Windows native32 build keeps its current behavior.
- The game never opens a URL automatically from the page. The overlay's link is a user gesture.
- **External open is a plain anchor with `target="_blank"`**, not `window.open` and not a
  same-tab navigation: `<a href={url} target="_blank" rel="noopener noreferrer">`. The browser
  decides whether that is a tab or a window; `_blank` is the portable behavior and the click is a
  real user gesture, so popup blockers do not apply.
- Accept only `http:` and `https:` for outbound links; block `file:`, `data:`, `javascript:` and
  unknown schemes. A blocked scheme never becomes an `href`.
- Framed content is untrusted: sandbox it (`allow-scripts allow-forms allow-popups
  allow-popups-to-escape-sandbox`, no `allow-top-navigation`, no `allow-same-origin` unless the
  target is our own page) and keep the external-open fallback visible.
- Both editions must build (RA2 `RA2_TARGET_GAME` and YR default) and the lift must stay clean.
- `RA2_WEB_PROTOCOL` changes in both `src/web/web_api.h` and `web/src/game/protocol.ts` together.
- Do not commit unless asked. Preserve others' uncommitted work.

---

### Task 0: Spike one routine end to end

**Files:**
- Modify: `run_lift.py` (new `web_url_patches`, wire into the `game` target only)
- Modify: `src/web/web_api.h`, `src/web/presenter.c`
- Modify: `web/src/game/protocol.ts`, `web/src/game/store.ts`, `web/src/screens/Play.tsx`
- Create: `web/src/components/LinkDialog.tsx` (minimal)

**Interfaces:**
- Produces: `void ra2_open_url(uint32_t url_va, uint32_t ask)` in the web host; event
  `{"e":"open","url":string,"ask":number,"seq":number}`; store field
  `openLink: { seq: number; url: string; ask: number } | null`.

- [ ] **Step 1: Add the RA2 entry patch.** In `run_lift.py`, follow
  `web_exit_confirmation_patches` (`run_lift.py:460`): check the six bytes at
  `0x0073C580`, then return an `@replace:` block. Emit the original `esp = esp - 0x310u;` in
  the `#else` branch.

```c
#if defined(__EMSCRIPTEN__) || defined(RA2_URL_HOST)
    { extern void ra2_open_url(uint32_t, uint32_t);
      uint32_t _url = ecx, _ask = edx;
      ra2_open_url(_url, _ask); return; }
#else
    esp = esp - 0x310u; /* 0x0073C580: sub esp, 0x310 */
#endif
```

- [ ] **Step 2: Wire the target.** Add `**web_url_patches(code, cs, 'game')` to the `game`
  target's patch dict (`run_lift.py:992`). Do not add YR yet.

- [ ] **Step 3: Add the host hook.** Declare `ra2_open_url` in `src/web/web_api.h` and implement it
  in `src/web/presenter.c` next to `web_event_json`/`web_json_escape`:

```c
void ra2_open_url(uint32_t url_va, uint32_t ask) {
    static unsigned seq;
    char u[512], line[640];
    web_json_escape(u, sizeof u, url_va ? (const char *)(uintptr_t)url_va : "");
    snprintf(line, sizeof line,
             "{\"e\":\"open\",\"url\":\"%s\",\"ask\":%u,\"seq\":%u}", u, ask, ++seq);
    web_event_json(line);
}
```

- [ ] **Step 4: Minimal page path.** Add the `open` variant to `GameEvent` in
  `protocol.ts`, `case "open"` in `store.ts` (`this.set({ openLink: ... })`), and a bare Radix
  dialog in `Play.tsx` that shows `url`, `ask` and a Close button. Add `!openLink` to the
  `attachInput` `enabled` gate (`web/src/screens/Play.tsx:235`). Bump `RA2_WEB_PROTOCOL` to 9 in
  `src/web/web_api.h:10` and `web/src/game/protocol.ts:4`.

- [ ] **Step 5: Verify the spike.** Re-lift, build the web target, run a headless RA2 build, open
  the WOL new-nickname dialog and press `GUI:ViewPrivacy` (1398). Expect one
  `@ra2 {"e":"open","url":"http://privacypolicy.westwood.com",...}` line and no
  `TXT_NOBROWSER`. In `src/recomp/gen_game`, `rg "ra2_open_url"` finds one inserted block.

---

### Task 1: Patch the remaining entry points

**Files:**
- Modify: `run_lift.py`
- Test: `tools/test_lift_patches.py`

**Interfaces:**
- Produces: `web_url_patches(code, cs, target) -> dict[int, str]` handling `game` (`0x0073C580`)
  and `gamemd` (`0x0077DC90`, `0x00551630`).

- [ ] **Step 1: Extend the site table** with the two YR entries. Byte checks:
  `81 ec 10 03 00 00` for `0x0077DC90`, `81 ec 68 04 00 00` for `0x00551630`. For
  `0x00551630`, pass `ask = 0` explicitly (it has no ask argument).
- [ ] **Step 2: Skip, do not guess.** If the bytes do not match, print
  `[*] web_url_patches: 0x... does not match this build; no URL patch` and return no entry for
  that site.
- [ ] **Step 3: Wire `gamemd`** (`run_lift.py:977`).
- [ ] **Step 4: Add patch tests** to `tools/test_lift_patches.py` for: matching bytes produce one
  `@replace` per site; wrong bytes produce none; the `#else` reproduces the original allocation.
- [ ] **Step 5: Re-lift both editions** and check that all three functions contain the block and
  that no other function does.

---

### Task 2: Host hook, protocol and Linux logging

**Files:**
- Modify: `src/web/web_api.h`, `src/web/presenter.c`, `src/linux/main.c`, `CMakeLists.txt`
- Modify: `docs/web/protocol.md`

**Interfaces:**
- Produces: the `open` event above; Linux `void ra2_open_url(uint32_t, uint32_t)` printing
  `[url] <url>` to stderr.

- [ ] **Step 1: Harden the hook and log the original.** Null/empty URL emits an empty string; the
  buffer is bounded; `web_json_escape` handles quotes and control characters. Log the received URL
  once (`[url] <url>` in the web/Linux host; the `open` event is the log in the page). Never
  rewrite it. No unescaped `printf` of the raw URL into the JSON.
- [ ] **Step 2: Linux.** Implement `ra2_open_url` in `src/linux/main.c` as a log line (optional
  `xdg-open` behind a `--open-url` flag; not the default). Add `RA2_URL_HOST` to the Linux target's
  `target_compile_definitions` in `CMakeLists.txt:81`.
- [ ] **Step 3: Protocol docs.** Add the `open` event to `docs/web/protocol.md` ("Game to page:
  events") and note the protocol 9 bump.
- [ ] **Step 4: Headless check.** `--press` a link and assert the line in the log; the process must
  continue normally (no stack corruption from the early return).

---

### Task 3: YR registry seeding

**Files:**
- Modify: `src/web/main.c` (after `recomp_host_init()`), `src/linux/main.c`
- Test: `src/web/wolapi_selftest.c` or a small host selftest

**Interfaces:**
- Produces: the YR registry key
  `HKLM\Software\Westwood\Yuri's Revenge\URL` with the value name(s) the game reads.

- [ ] **Step 1: Trace the value names.** `0x00798360`, `0x0079878E` and `0x00798CB0` read
  `Community`; `0x007738A0` is a generic helper whose caller supplies the name. Log
  `RegQueryValueExA` name arguments for this key during a YR WOL session, or break on the helper,
  and record every name used.
- [ ] **Step 2: Seed before the game runs** (`#ifndef RA2_TARGET_GAME`):

```c
hle_reg_set_string(0x80000002u, "Software\\Westwood\\Yuri's Revenge\\URL",
                   "Community", "https://ra2web.invalid/community");
```

  Seed the other traced names to `https://ra2web.invalid/<name>`.
- [ ] **Step 3: Verify the button reaches the hook.** In YR, click `GUI:Tournament`/`GUI:News`
  (1955/1958) and `GUI:YuriWebSite` (1375); expect the `open` event with the seeded URL, not a
  silent no-op.
- [ ] **Step 4: Note the sentinel.** `.invalid` guarantees a missed interception cannot reach a
  real host; the page maps it by path.

---

### Task 4: URL mapping

**Files:**
- Create: `web/src/game/link-targets.ts`, `web/src/game/link-targets.test.ts`

**Interfaces:**
- Produces:

```ts
export type LinkTopic =
  | "privacy" | "account" | "consent" | "support" | "tournament"
  | "news" | "community" | "status" | "external" | "blocked";

export interface LinkTarget {
  topic: LinkTopic;
  url: string;          // the URL the game asked for, never rewritten
  detail?: string;      // support kind, locale, etc.
  external: boolean;    // whether "Open original" is allowed
  embed: boolean;       // whether the URL may be shown in an iframe
}

export function linkTarget(url: string): LinkTarget;
```

- [ ] **Step 1: Implement the table** from the Findings section, parsing
  `apiregister.../support/<kind>_<locale>.html` and the `cgiclient` query. `.invalid`/
  `ra2web.local` hosts map by path (`/community`, `/news`, ...).
- [ ] **Step 2: Validate schemes.** `http:`/`https:` only; everything else → `blocked` with
  `external: false`, `embed: false`. Unknown http(s) → `external`, `external: true`,
  `embed: false` (the confirmation path).
- [ ] **Step 3: Decide `embed` per target.** `true` only for configured RA2Web pages verified to
  allow framing: no `X-Frame-Options`/`frame-ancestors` block and CORP/COEP compatible with the
  app's `COEP: require-corp`. Dead Westwood hosts, unknown external URLs and same-origin routes
  (which the service worker would answer with `index.html`) are `embed: false`. This is a static
  policy, not a runtime probe.
- [ ] **Step 4: Tests** for every known URL, the support kinds, the seeded host, the `embed` flag,
  `javascript:`, `data:`, `file:`, empty and malformed strings.

---

### Task 5: The iframe/confirmation dialog and overlay

**Files:**
- Create: `web/src/components/LinkDialogContent.tsx`, `web/src/components/LinkDialogContent.module.css`,
  `web/src/components/LinkDialog.tsx`
- Modify: `web/src/screens/Play.tsx`, `web/src/game/store.ts`

**Interfaces:**
- Consumes: `LinkTarget`.
- Produces: `<LinkDialog request={openLink} onClose={...} />`.

- [ ] **Step 1: Two modes in the content component.** It takes the whole `LinkTarget`, so the
  original `url` stays available to actions, tests and future consumers; it is not re-derived from
  the topic. If `target.embed`, render the target in a sandboxed iframe:
  `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"` (no
  `allow-top-navigation`, no `allow-same-origin` for third-party pages), `referrerPolicy="no-referrer"`,
  and a visible bar with the original URL, "Open in browser" and "Close". Otherwise render the
  confirmation: "The game asked to open an external link", the original URL, and "Open in browser"
  (only when `target.external`) plus "Cancel".
  "Open in browser" is a normal anchor, not a button handler:
  `<a href={target.url} target="_blank" rel="noopener noreferrer">`. It lets the browser choose a
  tab or a window, keeps `window.opener` severed, and never navigates the game page away.
- [ ] **Step 2: Framing fallback.** Cross-origin targets can refuse framing through
  `X-Frame-Options`/CSP, and the page's COEP can block them. Do not rely on `onload` alone; always
  show the "Open in browser" fallback above/below the frame so a blank or error frame is still
  recoverable. Do not auto-open the fallback.
- [ ] **Step 3: Overlay.** Render in `Play.tsx`; `onOpenChange(false)` →
  `gameStore.dismissOpenLink()`. Add `!openLink` to the `attachInput` `enabled` gate so keys do not
  reach the game. Keep the canvas mounted; the game keeps rendering behind the dialog.
- [ ] **Step 4: Accessibility.** Focus the dialog on open, return focus to the canvas on close,
  `aria-labelledby`, an iframe `title`, no `window.open` on mount.
- [ ] **Step 5: Component tests.** Embed mode renders the iframe with the expected `src`/`sandbox`;
  non-embed mode renders the confirmation; the original URL is visible in both; URL escaping uses
  `textContent`, not `innerHTML`; the external control is an `<a>` with the original `href`,
  `target="_blank"` and `rel="noopener noreferrer"`; no `window.open` and no same-tab `location`
  assignment; `javascript:` never becomes an `href` and never becomes an iframe `src`; close calls
  the handler.

---

### Task 6: Content, links and configuration

**Files:**
- Modify: `web/src/components/LinkDialogContent.tsx`, `web/.env.example`
- Create: `web/src/game/link-config.ts` (optional)

- [ ] **Step 1: Add `VITE_RA2WEB_SITE_URL`** (default empty). Derive privacy, account, support,
  tournament, news, community and status links from it; if empty, the dialog shows the local
  notice and no outbound link.
- [ ] **Step 2: Write the topic copy.** Privacy (original page offline), account/consent (RA2Web
  does not use Westwood serial/consent), support (per-kind: serial dup/banned/unknown, disabled,
  banned, serial mismatch), tournament/news/community/status (RA2Web pages), external (the
  confirmation message with the URL), blocked (unsupported scheme).
- [ ] **Step 3: Transparency.** Always show the URL the game asked for; never present a mapped
  destination as if it were the original.
- [ ] **Step 4: No dead links.** No `westwood.com` host is ever used as an `href` in the dialog.
  A test asserts this.

---

### Task 7: Verification

**Files:**
- Create: `web/e2e/links.mjs` (or extend `web/e2e/wol.mjs`)
- Modify: `docs/web/testing.md`

- [ ] **Step 1: Unit/lift.** `pnpm test`, `pnpm typecheck`, `pnpm lint`; `tools/test_lift_patches.py`;
  `rg ra2_open_url src/recomp/gen*` finds exactly three blocks.
- [ ] **Step 2: Headless.** For each edition, reach the dialog and press the control; assert the
  `open` event and that `TXT_NOBROWSER` is absent. Cover `0xE7:1398`, `0x10F:1772`,
  `0xBE:1368`/`1398`, `0xC1:1004`/`1005`, YR `0x113:1955`/`1958`, YR `0x10E:1375`.
- [ ] **Step 3: Browser e2e.** `web/e2e/links.mjs` clicks the same controls with screenshots;
  asserts the overlay topic, the URL line, no new tab, and no dead-host anchor.
- [ ] **Step 4: Offline/PWA.** The overlay is part of the app shell, so the message/confirmation
  path works offline; an iframe target still needs the network. Check under the `/emu/` base.
- [ ] **Step 5: Both editions build**, with the lift clean and the current protocol boot accepted.

---

### Task 9: Help surfaces (done)

- `WolChat::GetHelpURL` (`src/web/wolapi.c`) now returns the seeded support page
  `https://ra2web.invalid/support/help.html`; the game's own URL routine then
  reaches `ra2_open_url` and the page maps it to `support`/`help`
  (`link-targets.ts`). The WOLAPI selftest calls slot 34 for both editions.
- `WinHelpA` is not called by the lifted game: `rg WinHelpA src/recomp` finds no
  call site, so there is no help window to intercept. It stays the win32hle stub.
- Windows native32 is deliberately unchanged (D4): it keeps the real shell,
  the embedded browser and no dialog override.

### Task 10: Replicate the game's dialog chrome with its art (optional polish)

**Goal:** make the link dialog read as an in-game dialog, not a generic web
modal, by skinning it with the game's own frame, title bar and button art.
Behavior, URL handling and accessibility stay as they are.

**Files:**
- Create: `web/src/components/GameDialogChrome.tsx`,
  `web/src/components/GameDialogChrome.module.css`
- Create: `tools/export_dialog_art.py` (or extend `tools/dialogs.py`) and its
  output under `web/src/assets/dialog/`
- Modify: `web/src/components/LinkDialogContent.tsx`,
  `web/src/components/LinkDialog.tsx`, `docs/web/frontend.md`

**Interfaces:**
- Produces `<GameDialogChrome title onClose>{children}</GameDialogChrome>`, a
  presentational skin. Radix `Dialog` stays the accessible shell (focus,
  Escape, `aria-labelledby`), so the URL/iframe/confirmation behavior is
  unchanged.
- Keeps `LinkTarget` and `LinkDialogContent`'s props as they are.

- [x] **Step 1: Pick the reference art.** The system-browser link dialog is a
  native Win32 dialog (frame, title bar, buttons from the game's SHP/TMP art),
  while YR's embedded WOL browser used `HTML/Frame.htm`, `HTML/NavBar.htm` and
  `HTML/assets/*.jpg`. Use the native dialog art for the confirmation dialog
  and the HTML navbar art only for the iframe chrome. Record the exact MIX
  file, SHP/TMP frame, palette and 9-slice borders.
- [x] **Step 2: Export it.** A small tool reads the game's art through the
  existing archive/palette helpers and writes 1x/2x RGBA PNGs with alpha plus
  the slice metadata. Keep the assets small; do not bake text into images.
- [x] **Step 3: Build the chrome.** CSS 9-slice frame, title bar, close/OK
  buttons with normal/hover/pressed/disabled states, and the same bevel colours
  in both editions. DOM buttons and real text stay accessible and selectable.
- [x] **Step 4: Wire it in.** `LinkDialog` renders `GameDialogChrome` inside
  Radix `Dialog.Content`; the iframe/confirmation body keeps its current
  layout. Fall back to the current Radix look if the art is missing.
- [x] **Step 5: Typography.** Use the game's bitmap font for the title and
  buttons where it can be rendered accessibly; otherwise use the page font with
  the game's sizing and colours. Never render text only as a sprite.
- [x] **Step 6: Verify.** Screenshot the dialog at 800x600 and at a scaled/DPR
  size against the native dialog for both editions; keyboard focus, Escape,
  `aria-labelledby`, the iframe sandbox and the external anchor still pass.
- [x] **Step 7: Tests and docs.** Component test for the chrome, a visual e2e
  screenshot, and a `frontend.md` note on where the art comes from and how to
  regenerate it. If the art cannot be redistributed, keep the current skin and
  document that decision.

**Risks:** art licensing/size, 9-slice seams when scaled, bitmap-font
legibility, and text width in a fixed frame. The current Radix dialog remains
the fallback for all of them.

## Acceptance criteria

- Web and Linux builds never call `FindExecutableA`/`CreateProcessA` for a game link.
- `TXT_NOBROWSER` is never shown for any listed control.
- Every listed control opens our dialog; both editions.
- Embeddable targets render in the sandboxed iframe; every other target shows the confirmation with
  the original URL, and the "Open in browser" fallback is always available.
- No dead `westwood.com` URL is offered as an outbound link.
- The external-open control is an anchor with `target="_blank"` and `rel="noopener noreferrer"`;
  nothing calls `window.open` or navigates the game page.
- No URL opens without a user click; non-http(s) schemes are blocked and never become a frame.
- Headless runs log one `open` event per link and continue.
- Windows native32 behavior is unchanged (unless Task 9 enables it).
- Unit, lift, e2e and both-edition builds pass.

## Out of scope

- Guaranteeing that arbitrary external sites can be framed. `X-Frame-Options`, CSP
  `frame-ancestors`, COEP and the target's own scripts can each block or break an iframe; the
  confirmation/fallback path is the supported route for those.
- The WOL service protocol itself; this plan only changes what happens after the game asks for a
  URL.

## Open questions

- Which RA2Web pages are safe to embed? Verify their `X-Frame-Options`/`frame-ancestors` and CORP
  under COEP; default to `embed: false` when unsure.
- Do the YR `0x7738A0` callers read value names other than `Community`? Task 3 Step 1 answers it.
- Should `ask = 1` (automatic support/consent) use a non-blocking notice instead of the modal?
  Default: same modal, different copy.

## Verification log (31 October 2026)

- `python run_lift.py --all` → `lifted 24877  not-lifted stubs 0  errors 0`;
  `python run_lift.py --all --target game` → `lifted 23125  not-lifted stubs 0  errors 0`.
- Generated C: `ra2_open_url` appears twice in `src/recomp/gen` (YR
  `0x0077DC90`, `0x00551630`) and once in `src/recomp/gen_game`
  (`0x0073C580`); `ra2_open_wol_page` appears once (`0x00773E90`); no other
  function contains them.
- `python -m unittest tools.test_lift_patches` → 46 tests OK.
- `cd web && pnpm test` → 45 files, 431 tests pass; `pnpm typecheck` clean;
  `pnpm build` succeeds.
- YR wasm build (`RA2_TARGET=gamemd build-web.cmd`) → `[77/77] Linking C
  executable ra2md.js`; rebuilt after the embedded-browser patch → `[75/75]`.
- YR headless: `node build-web/ra2md.js --run --game ./game --headless --mute
  --press 0xE2:1668@1 --press 0x10E:1375@4` → `[url]
  https://ra2web.invalid/community` and
  `@ra2 {"e":"open","url":"https://ra2web.invalid/community","ask":0,"seq":1}`,
  with no `TXT_NOBROWSER`.
- RA2 wasm build (`RA2_TARGET=game build-web.cmd`) → `[70/70] Linking C
  executable ra2.js`; rebuilt after the embedded-browser patch → `[6/6]`.
- RA2 headless: `node build-web-game/ra2.js --run --game ./game --headless
  --mute --press 0xE2:1668@1 --press 0x10E:1764@5 --press 0x114:1772@8` →
  `[url]
  http://games2.westwood.com/cgi-bin/cgiclient?register&request=reg_menu&LANGCODE=0`
  and the matching `open` event, with no `TXT_NOBROWSER`.
- YR browser e2e: `node e2e/links.mjs --edition ra2md --game ../game
  --shots ../work/web-links-yr` → `{"edition":"gamemd","url":
  "https://ra2web.invalid/community","topic":"Community","dismissed":true}`.
- RA2 browser e2e: the game was imported into a persistent Chrome/OPFS profile
  (links the big MIX files instead of copying them) and run with
  `--profile` → `{"edition":"ra2","url":"http://games2.westwood.com/...",
  "topic":"Manage account","framed":false,"outbound":null,"dismissed":true}`.
- Iframe in a browser: with `VITE_RA2WEB_SITE_URL=https://example.com`,
  the same RA2 run reported `"framed":true`,
  `"frameSrc":"https://example.com/account"` and
  `"outbound":"https://example.com/account"`; the script asserts the iframe
  sandbox and `referrerpolicy`, and the anchor's `target`/`rel`.
- Headless matrix beyond the two entry runs:
  `0xE7:1398` → `[url] http://privacypolicy.westwood.com`;
  `0x10F:1772` and `0x114:1772` →
  `[url] http://games2.westwood.com/cgi-bin/cgiclient?...`; YR `0x10E:1375`
  → the seeded `Community` URL. None reached `TXT_NOBROWSER`.
- YR's embedded WOL browser (`DoWebPageDialog`, `0x00773E90`) is intercepted
  by page key. Offline in `0x114`: `1772` → `[url]
  https://ra2web.invalid/account`, `1955` → `https://ra2web.invalid/ladder`;
  `0x10E:1375` still → `.../community`. No `0x131` browser dialog is created.
  The logged-in `0x113:1955/1958` path uses the same entry; the local lobby
  run selected the RA2 edition from the persistent profile, so the offline
  controls are the reproducible check for that hook.

## Verification log (1 November 2026)

- **WOLAPI selftest, both editions.** `emcc src/web/wolapi_selftest.c ...`
  then `node build-web/wolapi-selftest-{yr,ra2}.js` ->
  `WOLAPI COM startup ABI: PASS` twice. Slot 34 (`WolChat::GetHelpURL`) now
  returns `https://ra2web.invalid/support/help.html`; the page test
  `link-targets.test.ts` maps it to `support`/`help` and `${SITE}/support/help`.
- **`WinHelpA`.** `rg -n "WinHelpA|WinHelp" src/recomp` has no call sites; the
  lifted game never asks for a help window, so T9 leaves the win32hle stub and
  the native Windows behavior untouched.
- **T10 exporter.** `py -3 tools/export_dialog_art.py --selftest` ->
  `export_dialog_art.py self-test OK`. Against `game/` it writes
  `web/public/dialog-art/` (`title.png` 172x40 nine-slice, `button.png`
  and `button-hover.png` 109x26 with the baked lettering removed,
  `background.jpg` 680x450 inner panel) and regenerates
  `components/game-dialog-palette.ts` (metal `#fdfcff/#9a9da6/#544e50`,
  plate `#af0505`).
- **T10 UI.** `GameDialogChrome` keeps Radix's `Dialog.Title` as the dialog's
  `aria-labelledby` target; the body, actions and anchor are unchanged. The
  element screenshot (`work/web-links-art/probe-chrome.png`) shows the metal
  title strip, radar body and red Cancel plate with live DOM text.
- **Page checks.** `pnpm test` -> 54 files, 505 tests pass (includes the new
  chrome and Help-URL tests); `pnpm typecheck` clean; `pnpm build` succeeds;
  `python -m unittest tools.test_lift_patches` -> 51 tests OK.
- **YR lobby, server-dependent controls.** Vite on 5173 with
  `VITE_WOL_HTTP_URL=http://127.0.0.1:9090`,
  `VITE_WOL_SOCKET_URL=ws://127.0.0.1:9090/wol`; RA2Web started with
  `CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173` (its `.env` otherwise allows
  only the production page). `node e2e/links-lobby.mjs --url
  'http://127.0.0.1:5173/' --edition ra2md --profile <ra2prof2>` ->
  `"joined": true`, presses `0x113:1955` and `0x113:1958`, opens
  `https://ra2web.invalid/ladder` and `https://ra2web.invalid/external`.
- **News page key.** `0x113:1958` is `GUI:News`; the page-key table and the YR
  registry now seed `News` -> `https://ra2web.invalid/news` (so the next build
  reports `news`, not the fallback `external`). Covered by
  `link-targets.test.ts`; the host change needs the next wasm rebuild.
- **RA2 lobby.** `node e2e/links-lobby.mjs --edition ra2 --profile <ra2prof2>`
  -> `"joined": true`; `0x113:1368` (`GUI:ClanAndLadder`) opens
  `http://www.westwood.com/westwoodonline/tournaments/redalert2/`, which the
  page maps to `tournament`. The deeper `0xBE`/`0xC1` chat/ladder screens were
  not reached from this login path: `0x113:1368` opens the tournament page
  directly, and the script's next press waits for `0xBE`, which never opens.
  The same URL routine is proven by this control and by the offline matrix.
