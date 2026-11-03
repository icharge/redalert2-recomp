# The page

The page is a React app in `web/`. It doesn't run the game: it gets the
player's files in, starts the game, hands it the canvas, and shows what the
browser needs from the player. The game draws and plays on its own thread
([architecture.md](architecture.md)).

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict`, `noUncheckedIndexedAccess` |
| UI | React 18 |
| Components | Radix Themes for layout, type and colour. Radix Primitives where Themes has no component |
| Icons | Radix Icons |
| Styling | Radix Themes tokens. CSS Modules for our own components. No Tailwind, no CSS-in-JS |
| Routing | React Router 7, BrowserRouter with the deployment basename |
| State | React state and context. One external store for the game's events, read with `useSyncExternalStore` |
| Routing | none: four screens, chosen by state |
| Build | Vite, with `vite-plugin-pwa` for the service worker |
| Package manager | pnpm, lockfile committed |
| Lint and format | ESLint (typescript-eslint, react-hooks), Prettier. CI runs both; a pre-commit hook (`.githooks/`, set up by `pnpm install`) formats and lints the staged files with lint-staged |
| Tests | Vitest and Testing Library for the page, Playwright for the game ([testing.md](testing.md)) |

## Layout

```
web/
  index.html
  package.json, pnpm-lock.yaml
  vite.config.ts            COOP/COEP on the dev server, the PWA plugin
  tsconfig.json
  e2e/                      local end-to-end checks in a real Chrome (testing.md)
  fonts/                    Liberation Sans (OFL), preloaded into the game's file system
  public/
    game/                   ra2.js/.wasm/.data (RA2) and ra2md.js/.wasm/.data (Yuri; local build output)
    icons/, manifest.webmanifest
  src/
    main.tsx                mounts <App>, registers the service worker
    App.tsx                 <Theme>, picks the screen
    screens/
      Import.tsx            pick or drop the folder, check it, copy it
      Library.tsx           the games found, storage use, remove
      Play.tsx              the canvas, the first-click bar, the crash view
    components/
      SettingsDialog.tsx    browser-side settings (below)
      StorageMeter.tsx
      SoundControl.tsx      the "click to start sound" bar, the volume and the two switches about when the game is heard
      LanPanel.tsx          one-peer LAN setup through a manual WebRTC offer/answer
      LinkDialog.tsx        a WOL-era link: iframe or confirmation, in game chrome
      GameDialogChrome.tsx  the game's frame, title strip and button plates
      ImportProgress.tsx
      CrashReport.tsx
      BrowserCheck.tsx      what this browser lacks, and what that means
    game/
      loader.ts             sets window.Module, loads the selected edition module, puts game files in /game
      store.ts              the game's state, from its events (protocol.md)
      protocol.ts           the types of every message, export and shared-memory word
      presenter.ts          draws the game's shared picture and cursor on the canvas
      input.ts              the mouse and keys, as calls on the game's exports; the key table
      audio.ts              the AudioContext and the worklet over the sound ring; resumes on the first gesture; a gain after the worklet goes quiet when asked (`setQuiet`)
      lan.ts                WebRTC peer signaling and the page-to-IPX datagram bridge
      volume.ts             the volume, kept in the manifest's settings
      sound-preferences.ts  "mute when the window loses focus" and "menu music", kept the same way
      attention.ts          `useAttention`: the tab shows and the window has the focus
    storage/
      opfs.ts               copying into OPFS, reading back, removing
      manifest.ts           what is imported (IndexedDB)
      install.ts            the allowlist and the PE checks (storage.md)
      settings.ts           the page's settings (IndexedDB)
    styles/
      global.css            body, the canvas, the full-window play layout
```

`web/public/game/` is build output from the lift, so it's in `.gitignore`.
The page builds and its tests run without it, and the Play screen then says
the game isn't built.

## Screens

The app uses clean routes under its deployment base: `/` is the installation
launcher, `/import` imports a folder, and `/game/:slot` launches an installation.
Each slot has its own available edition buttons; `?edition=ra2` or
`?edition=ra2md` selects one explicitly. Yuri's Revenge is the default when
both are available. Invalid or unfinished slots explain the problem and
link back to the launcher or to Resume import. Game routes survive refreshes.

The launcher groups editions by imported folder and supports multiple copies
of the same game. Returning from a cancelled or failed import refreshes its
metadata so the incomplete slot is immediately resumable.

Normal Exit stops browser input, presentation, audio, and LAN callbacks,
flushes pending saves/settings, then replaces the document with the base
launcher URL. Document teardown ends workers and makes WASM memory reclaimable.
Failed persistence keeps the page with a retry action. Crashes retain their
report and an explicit Back to launcher action. Browser Back or switching
a loaded game's route also uses document navigation; the classic runtime
is never reused for another slot. Mod/font restarts reload the same game URL.

1. **Browser check** (only if needed). This browser lacks something the
   game needs: `SharedArrayBuffer` (the page isn't cross-origin isolated),
   WebGL2, or OPFS. It says what, and which browsers have it.
2. **Import.** No game in this browser yet. A button for the folder picker
   (`showDirectoryPicker`, Chromium) and a drop zone (everywhere). Then the
   checks from [storage.md](storage.md): which game was found, whether it's
   the build the lift came from, and how much space it needs against the
   quota. Then the copy, with a Radix Progress bar, the current file, and
   Cancel. It's resumable: a reload continues from the manifest.
3. **Library.** One card per installation, with separate RA2/Yuri launch
   choices, file browsing, edition settings and saves, and installation
   removal (a Radix AlertDialog confirms). "Import a folder" creates another
   slot. Unfinished slots offer Resume import.
4. **Play.** The canvas fills the window. A thin bar says "click to start
   sound" until the first gesture. Esc is the game's key, so the page's own
   menu is a small button in a corner that fades out after a few seconds,
   opening Settings and Quit. If the game thread dies, the canvas gives way
   to the crash report.

## Settings: what lives where

Game settings stay in the game's own F10 menu during play, drawn by the host as
on Linux, so each setting has one copy. The launcher's `LauncherGameSettings`
dialog edits the same files: its Launcher tab has the host presentation
settings (scaling, blur menu bars, HD vehicles, cursor, FPS overlay), and its
Gameplay,
Audio, Video and Keyboard tabs read and write the per-edition
`RA2.INI`/`RA2MD.INI` and `KEYBOARD.INI`/`KEYBOARDMD.INI` in
`save/<storage>/`. The host settings live in `.host/<edition>.ini`; a fresh
profile starts at smooth scaling. The Video tab also holds the launcher's resolution override (it
starts at the desktop's own size, which the list marks "(Native)") and the browser fullscreen
preference: fullscreen on start, or only in game, where the launcher stays windowed, the game page
enters fullscreen with the loading screen and gives the window back when the game ends. The
Keyboard tab follows the game's own Customize Keyboard layout: pick a
category, pick a command, read its description, then capture and assign a key
(or reset every binding to the game's defaults). With no keyboard file in the
import, it starts from the game's standard bindings and writes a complete file
on the first change. Gameplay is grouped into Player, Match, Campaign, Camera,
Controls and Interface; Player holds the name written to `[MultiPlayer] Handle`,
Campaign has the `-SPEEDCONTROL` switch that puts the speed slider in campaign
missions, Controls has the MOBA-style right-click-to-order toggle (`.host`
settings), and each settings tab can restore its section's defaults. The Import
screen leaves
the folder's settings files out unless "Bring my settings and hotkeys" is
ticked, so a fresh import starts from `web/src/storage/game-settings-defaults.ts`;
`ensureDefaultMainSettings` writes that profile into the save store before the
first launch. The page's in-game Settings dialog (Radix Dialog with Tabs) has only
what belongs to the browser:

| Setting | Where it's kept |
|---|---|
| Fullscreen on start, and fullscreen only in game | localStorage, `ra2.fullscreen.<storage>`; the launcher's Video tab writes it, the game page reads it |
| Pointer lock in a window (edge scrolling) | IndexedDB |
| Master volume | IndexedDB, sent to the game (`ra2_set_volume`) |
| Mute when the window loses focus (off by default) | IndexedDB; a page-side gain, the game keeps mixing |
| Menu music (on by default) | IndexedDB, sent to the game (`ra2_set_menu_music`); the launcher's Audio → Music tab has the same switch |
| Storage: used, quota, "persist storage" request, remove a game | OPFS, `navigator.storage` |
| Show the frame-time overlay | IndexedDB |

## The game's state in React

`game/store.ts` holds one object: `{ phase, title, size, fps, error, log }`,
where `phase` is `idle | loading | booting | running | exited | crashed`. The
loader writes to it from the game's events ([protocol.md](protocol.md)).
Components read it with `useSyncExternalStore`, selecting what they need.

Rules:

- **No React work per frame.** The canvas belongs to the game thread. `fps`
  updates the store at most once a second.
- **The canvas is created once and never re-rendered.** `Play` creates it in
  a ref, and `presenter.ts` draws on it once per animation frame from the
  game's shared memory. React never touches it again. Its size comes from CSS
  (`object-fit: contain`), and a `ResizeObserver` tells the game.
- **No game logic in the page.** If something is about the game, it belongs
  in the C host.

The game's dialogs that the page replaces live in this store too:
`exitConfirmation` (the main menu's Exit prompt) and `openLink` (a WOL-era
link the game asked the system browser to open). `Play` mounts one Radix
dialog for each and gates game input while one is open; closing them only
clears the field, so the game keeps running. `openLink` is mapped by
`link-targets.ts` into a topic, the original URL, and whether the page may be
framed or offered as an outbound link ([protocol.md](protocol.md), "Web
links"). YR's embedded browser supplies a page key; the host maps a known key
to the retail installer's registry URL (`src/web/wol_pages.h`), so the event
carries the real Westwood URL. An unknown key has `url: ""` and the key in
`page`, and the dialog names the page.

### Link dialog art

The link dialog is skinned as one of the game's own panels: `GameDialogChrome`
draws the metal frame, the embedded WOL browser's title strip and the red
button plates, while Radix's `Dialog` keeps focus management, Escape and the
`aria-labelledby` label. Text is always real DOM text; the exported button
plate has the game's baked "Cancel" lettering painted out.

The retail images are not in the repository (REPO_RULES section 3), so
`web/public/dialog-art/` is ignored. Run the exporter once against your own
game folder:

```powershell
py -3 tools/export_dialog_art.py
py -3 tools/export_dialog_art.py --selftest
```

It writes `title.png` (a 9-slice strip from `HTML/assets/navbar_bkgd.jpg`),
`button.png` / `button-hover.png` (from `navcancel0/1.jpg`), `background.jpg`
(from `standard_bkg.jpg`) and `dialog-art.json` (the cuts), and regenerates
`components/game-dialog-palette.ts` with the colours sampled from those
plates. Every CSS layer has a gradient under it, so a checkout without the art
still shows the game's palette and bevels; the component tests cover both.

## Look

Radix Themes with `appearance="dark"` by default (the game is dark), and
the accent colour taken from the game (red for Red Alert 2, purple for Yuri's
Revenge, set on the Library card and the Play screen). Radix's scale is used
as it comes: no custom tokens until a screen needs one. The UI is only on
screens around the game. During play, the page shows nothing but the canvas
and the corner button.

Accessibility comes mostly free with Radix Primitives: focus management in
dialogs, keyboard navigation and labels. The Import drop zone is also a
button. Progress and errors are announced (`aria-live`).

## Conventions

- Function components and hooks only. Named exports.
- One component per file. A component's CSS Module sits beside it
  (`Import.module.css`).
- No `any`. Messages and exports are typed in `game/protocol.ts`, and both
  sides of a message use that type.
- Async storage work goes in `storage/`, never in components. Components
  call it, and show `loading` and `error` from the result.
- Strings in components for now. If the page is ever translated, they move
  to one file then, not before.
