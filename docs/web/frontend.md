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
    fonts/                  Russo One, Barlow, Barlow Condensed (OFL, self-hosted for offline use)
    brand/                  logo, edition icons, backgrounds: git-ignored, on the owner's machine only
  src/
    main.tsx                mounts <App>, registers the service worker
    App.tsx                 <Theme>, the routes, the active install and edition
    styles/tokens.css       colours, fonts and shapes as CSS variables
    screens/
      launcher/
        Shell.tsx           the top bar (logo, PLAY / MODS / GAME, storage) and the game rail
        PlayScreen.tsx      the edition's art and title, the mod (PROFILE) picker, PLAY, the status
        ModsScreen.tsx      every mod of the install, install / play / remove
        GameScreen.tsx      the install: editions, files, saved games, storage, other installs, remove
        settings/           SettingsScreen and one file per tab; controls.tsx (Toggle, Segmented, PipBar, Row)
      Import.tsx            the Install screen: pick or drop the folder, check it, copy it
      Play.tsx              the canvas, the page controls (GameTray), the dialogs over the game
      GameTray.tsx          the red star and the bar of page controls in game
      LoadingScreen.tsx     the copy and start-up screen over the edition's art
      CrashDialog.tsx, ExitConfirm.tsx
    components/
      KeyArt.tsx, BrandImage.tsx, brand.ts   the art and brand images, each with a fallback
      SettingsDialog.tsx    the in-game F10 panel (below)
      SoundControl.tsx      the "Sound is off until you click" bar, the volume pips and the two switches about when the game is heard
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
      active-install.ts     which install and edition the launcher shows
      all-games.ts          a settings change written to every edition of that install
      active-mod.ts         the mod PLAY loads: the host's `[mods] active=`
    styles/
      global.css            body, the canvas, the full-window play layout
```

`web/public/game/` is build output from the lift, so it's in `.gitignore`.
The page builds and its tests run without it, and the Play screen then says
the game isn't built.

## Screens

The app uses clean routes under its deployment base: `/` (Play), `/mods`, `/manage` (Game) and
`/settings/<tab>` are the launcher; `/import` installs a folder; `/game/:slot` launches an
install, with `?edition=ra2` or `?edition=ra2md` naming the edition. `/settings` and an unknown tab
go to `/settings/launcher`. Invalid or unfinished slots explain the problem and link back to the
launcher or to Resume import. Game routes survive refreshes.

**One install.** The manifest keeps every install slot, and several copies of the game are still
allowed. The launcher shows one of them, the *active install*: the slot remembered in
`ra2-active-slot`, else the lowest slot with a complete game, else the lowest slot
(`storage/active-install.ts`). Its editions are the tiles in the game rail, Red Alert 2 first; the
chosen one is remembered per slot in `ra2-edition:<slot>` and defaults to Yuri's Revenge. The Game
screen lists the other installs under OTHER INSTALLS with USE and remove; a new copy becomes the
active install when its import finishes.

**All games.** A setting changed on the Settings screen is written to every edition of the active
install, each into its own files (`storage/all-games.ts`): `RA2.INI` and `RA2MD.INI`, both
`.host` files, and the per-`storage` local-storage preferences. A key binding that only Yuri's
Revenge has (VeterancyNav, PreviousObject, CursorCheat) is written to that edition only, and
Campaign difficulty only to Yuri's Revenge. The values shown are those of the edition last chosen in the
rail. Settings is a screen of its own: no rail tile is marked there, and a tile goes back to that
edition's Play screen. Writes run one at a time.

**The active mod.** The PROFILE picker on Play and the PLAY of a mod row set the host's
`[mods] active=` in the edition's `.host` file, the value the host reads at start-up
(`src/web/settings.c`); F9 in game still switches mods. A mod that is no longer there reads as
Vanilla, and removing the active mod clears it.

Normal Exit stops browser input, presentation, audio, and LAN callbacks,
flushes pending saves/settings, then replaces the document with the base
launcher URL. Document teardown ends workers and makes WASM memory reclaimable.
Failed persistence keeps the page with a retry action. Crashes keep their
message and log, with RELOAD and LAUNCHER. Browser Back or switching
a loaded game's route also uses document navigation; the classic runtime
is never reused for another slot. Mod/font restarts reload the same game URL.

1. **Browser check** (only if needed). This browser lacks something the
   game needs: `SharedArrayBuffer` (the page isn't cross-origin isolated),
   WebGL2, or OPFS. It says what, and which browsers have it.
2. **Play.** The edition's art and title, the PROFILE (mod) picker, PLAY and a status line
   ("Ready", or what is missing). With nothing installed, one INSTALL THE GAME button. An
   unfinished import offers RESUME INSTALL.
3. **Mods.** Every mod of the install with its edition and size, filtered by edition; IN USE marks
   the active one. INSTALL MOD (or a dropped folder) asks which edition when there are two.
4. **Game.** The install's editions and their readiness, BROWSE FILES, RESUME INSTALL, ADD MOVIES,
   the saved games of the chosen edition (DOWNLOAD .ZIP, IMPORT .ZIP), browser storage, REMOVE
   GAME (an alert dialog says the size and that saves and settings are kept), and OTHER INSTALLS.
5. **Install** (`/import`, full screen). Steps 1 FOLDER, 2 CHECK, 3 COPY: the folder picker
   (`showDirectoryPicker`, Chromium), the file picker and a drop zone; then the checks from
   [storage.md](storage.md) and three options (movies, saved games, settings and hotkeys); then
   the copy with CANCEL. It's resumable: a reload continues from the manifest.
6. **Settings.** Launcher, Gameplay, Audio, Video and Keyboard (below), then About: the launcher's
   version (`web/package.json`, imported by `src/version.ts`) and the build id from
   `build.json`, COPY BUILD INFO for bug reports, CHECK FOR UPDATES (asks the service worker), what's
   new (the newest section of [web/CHANGELOG.md](../../web/CHANGELOG.md), read at build time by
   `changelog.ts`), the credits with their GitHub links, and the legal notes and licences. About
   needs no game, so it shows before one is installed. The version under SETTINGS in the rail opens
   it. A release bumps `package.json` and starts a new changelog section.
7. **In game.** The canvas fills the window. A red star in the bottom-right corner opens the page
   controls: SETTINGS F10, TYPE, FILES, LAN, the volume and F11. While a match plays the bar slides into
   the star and the star fades to a quarter, so the page doesn't draw the eye; pointing at it,
   keyboard focus, an open pop-up or the game's pause menu brings the bar back. The page knows a
   match is playing without a flag of its own: the match state is set and the game draws its own
   cursor (the pause menu and score screen switch to the overlay or arrow cursor, `matchQuiet`).
   Under Pointer Lock there is no hover, so Esc (the pause menu) is the way to the bar mid-match.
   The loading screen shows the edition's art and a segmented bar; "Sound is off until you click"
   waits for the first gesture.

On a phone (under 720px) the rail becomes a row under the bar, the tabs scroll sideways in the
bar, Play's footer stacks, and the Settings sections become a row.

## Settings: what lives where

Game settings stay in the game's own files, so each setting has one copy. The launcher's Settings
screen edits them for every edition of the install (All games, above): its Launcher tab has Skip
intro, the host presentation settings (scaling, menu bars, cursor, HD vehicles, FPS counter) and
the Thai font, and its Gameplay,
Audio, Video and Keyboard tabs read and write the per-edition
`RA2.INI`/`RA2MD.INI` and `KEYBOARD.INI`/`KEYBOARDMD.INI` in
`save/<storage>/`. The host settings live in `.host/<edition>.ini`; a fresh
profile starts at smooth scaling. The Video tab also holds the launcher's resolution override (it
defaults to 1920×1080; the list also marks the desktop's own size as "(Native)" and offers "Match
browser size") and the browser
fullscreen preference: fullscreen on start, or game match only, where the launcher and the game's
menus stay windowed, the game page enters fullscreen at the match's loading screen and gives the
window back after the score screen. Escape in fullscreen opens the game's pause
menu (the page locks the key with `navigator.keyboard.lock`); leaving fullscreen
is F11, the F11 page control, or a two-second Escape hold in
Chromium. The in-game F10 menu has the same Resolution choice (fixed sizes
or "Match browser size"); changing it writes the game's INI/options. In a skirmish or
campaign (either edition) it applies at once, between two frames; otherwise (an online
match, the menus) from the next match. "Match browser size" follows a resized window, sending the size
400 ms after the resize settles ([hires.md](../hires.md), "Live resize in the browser"). The Keyboard tab
follows the game's own Customize Keyboard
layout: pick a
category, pick a command, read its description, then capture and assign a key
(or reset every binding to the game's defaults). With no keyboard file in the
import, it starts from the game's standard bindings and writes a complete file
on the first change. Gameplay is grouped into Player, Match, Controls, Camera
and Interface; Player holds the name written to `[MultiPlayer] Handle`,
Match has the `-SPEEDCONTROL` switch that puts the speed slider in campaign
missions, Controls has the MOBA-style right-click-to-order toggle (`.host`
settings), and RESET DEFAULTS restores the open tab only. Explanations are ⓘ tooltips. The
Install screen leaves the folder's settings files out unless "Settings and hotkeys" is
ticked, so a fresh import starts from `web/src/storage/game-settings-defaults.ts`;
`ensureDefaultMainSettings` writes that profile into the save store before the
first launch. The in-game F10 panel (a Radix Dialog shown as a side panel) has what applies while
the game runs (scaling, resolution, menu bars, HD vehicles, MOBA style, lock pointer, FPS counter,
the mod) and these browser settings:

| Setting | Where it's kept |
|---|---|
| Fullscreen on start, and game match only | localStorage, `ra2.fullscreen.<storage>`; the launcher's Video tab writes it, the game page reads it |
| Game resolution (the next match) | the game's `RA2.INI`/`RA2MD.INI` `[Video]`, via the host's F10 setting (`RA2_SETTING_RESOLUTION`); the choice is also kept in localStorage, `ra2.video.<storage>` ("Match browser size" is the marker `"browser"`, resolved to the page's pixel size) |
| Pointer lock in a window (edge scrolling) | IndexedDB |
| Master volume | IndexedDB, sent to the game (`ra2_set_volume`) |
| Mute when the window loses focus (off by default) | IndexedDB; a page-side gain, the game keeps mixing |
| Menu music (on by default) | IndexedDB, sent to the game (`ra2_set_menu_music`); the launcher's Audio → Music tab has the same switch |
| Storage: used, quota, "persist storage" request, remove a game | OPFS, `navigator.storage` |
| The active install, and the edition per install | localStorage, `ra2-active-slot` and `ra2-edition:<slot>` |
| The page controls open or collapsed | localStorage, `ra2-tray-open` |
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
framed; every link shows the same permission prompt and **Open** / **Cancel**
([protocol.md](protocol.md), "Web links"). YR's embedded browser supplies a
page key; the host maps a known key
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

The redesign's tokens are CSS variables in `web/src/styles/tokens.css` (`--bg`, `--red`, `--yuri`,
`--amber`, `--panel`, ...), used through CSS Modules. Radix Themes stays the base
(`appearance="dark"`, red accent) for its dialogs and focus handling. Display titles use Russo One,
labels, tabs and buttons Barlow Condensed in capitals, and body text Barlow; the fonts are
self-hosted under `web/public/fonts/` so the page works offline. Primary buttons have the cut
corner (`--cut`), switches are square, and progress is segmented pips.

The logo, the edition icons and the two backgrounds are EA artwork, so they are not in git:
`web/public/brand/` holds them on the owner's machine (`yurinet.png`, `ra2-icon.png`,
`yr-icon.png`, `bg-ra2.webp`, `bg-yr.webp`). Every use falls back without a broken image: the logo
to the word YURINET, an icon to an RA2 / YR tile, a background to a gradient
(`BrandImage`, `KeyArt`).

Motion is CSS only (no animation library) and lives next to each screen's styles. The background
drifts slowly on the page's own clock and a faint radar sweep crosses it (`KeyArt`); the first
picture of the page fades in and later ones don't, so a tab change doesn't dip to black. On a tab
change the red underline draws in and the screen's parts rise one after another; the Play title
slides in, PLAY glints and glows, and the status dot pings. Settings switches slide and the loading
bar's newest segment pulses. The bar and the rail are one layout route in `App.tsx`, so they keep
their place (and their animation state) when the tab changes. In game, the only motion is
the page controls sliding away into the star while a match plays (above): a match shouldn't be
distracted. One rule in `tokens.css` ends every animation and transition at
once under `prefers-reduced-motion`, so a new effect needs nothing extra to respect it.

Accessibility: every control is reachable by keyboard and labelled; the current tab, rail tile and
settings section carry `aria-current`; the pip bars are sliders for the keyboard (arrow keys move
one pip); progress and errors are announced (`aria-live`).

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
