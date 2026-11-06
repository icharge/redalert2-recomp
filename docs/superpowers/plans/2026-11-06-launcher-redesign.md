# Launcher Redesign (Direction A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the web launcher and the in-game page chrome to match the Direction A boards of the
"RA2 Web Launcher Redesign" canvas: one game install, separate mod slots, art-led screens, far less
text.

**Architecture:** A new launcher shell (full-width top bar, game rail under it) hosts four routes
(Play, Mods, Game, Settings) plus the restyled Install flow. The data model does not change: the
launcher shows one *active* installation out of the existing slots, and a settings change is written
to every edition of that installation ("All games"). The active mod is the host's existing
`[mods] active=` setting. The in-game page keeps its logic; only its overlay, F10 panel, loading
screen and dialogs are restyled.

**Tech Stack:** React 18.3.1, react-router 7.18.1, Radix Themes 3.2 (kept as the base theme), CSS
Modules, Vitest + Testing Library, the Playwright scripts in `web/e2e/`.

**Spec:** the canvas https://claude.ai/artifact/PHcz36m4jC7FR5Fm3UwqJ2 (private to the owner). Boards
are named below by file, for example `A-Play.dc.html`. The brief is `Main.dc.html` on the same
canvas; its "Must keep: every control today" list is the checklist for Tasks 7 to 11.

**Related docs:** [frontend.md](../../web/frontend.md), [storage.md](../../web/storage.md),
[testing.md](../../web/testing.md), [decisions.md](../../web/decisions.md).

## Scope

In this plan: shell, Play, Mods, Game, Install, Settings (5 tabs), backgrounds and brand images,
in-game overlay, F10 panel, loading screen, LAN / exit / sound / crash dialogs, phone layout.

Not in this plan (each gets its own plan; their tabs stay hidden until then):

- **Maps** (`A-Maps.dc.html`): custom map import, storage and export. New storage work.
- **Accounts and ladder** (`A-SignIn`, `A-Register`, `A-Ladder`): needs a server that does not exist.
  The profile chip in the top bar is hidden with them.
- **Mod repair** ("3 FILES MISSING / REPAIR" on `A-Mods`): no file check exists for mods yet.

## Progress summary

| ID | Task | Status |
| --- | --- | --- |
| 1 | Tokens, fonts, brand assets | Done |
| 2 | Key art background | Done |
| 3 | Active installation and edition | Done |
| 4 | "All games" writes | Done |
| 5 | Active mod | Done |
| 6 | Launcher shell | Done |
| 7 | Play screen | Done |
| 8 | Mods screen | Done |
| 9 | Game screen | Done |
| 10 | Install screen | Done |
| 11 | Settings screen | Done |
| 12 | Routes and App wiring | Done |
| 13 | In-game overlay and sound | Done |
| 14 | In-game F10 panel | Done |
| 15 | Loading screen and crash dialog | Done |
| 16 | LAN, exit and sound-start dialogs | Done |
| 17 | Phone layout, docs, e2e | Done |

## Global Constraints

- Work on a branch `launcher-redesign` off `main`; one commit per task.
- No new runtime dependencies. React 18.3.1, react-router 7.18.1, `@radix-ui/themes` ^3.2.1 stay.
- Styling: CSS Modules only, no Tailwind. Keep the root `<Theme appearance="dark" accentColor="red" grayColor="slate" radius="small">`.
- Tokens (in `web/src/styles/tokens.css`, used through `var(--…)`):
  `--bg #07080b`, `--text #f1ede6`, `--muted #a7a29a`, `--red #d3262b`, `--red-dark #8b1a1a`,
  `--red-deep #5a1214`, `--yuri #3a1d66`, `--yuri-mid #7b4ae0`, `--yuri-light #c9b8ff`,
  `--green #57d68d`, `--amber #f2b134`, `--panel rgba(18,19,23,0.92)`, `--line #2a2b30`,
  `--bar rgba(8,9,11,0.82)`, `--rail rgba(8,9,11,0.94)`.
- Fonts: `Russo One` for display titles, `Barlow Condensed` 500/600/700 uppercase with 0.12–0.16em
  letter spacing for labels, tabs and buttons, `Barlow` 400/500/600 for body. Self-hosted woff2
  under `web/public/fonts/` (the page works offline as a PWA); no Google Fonts request at runtime.
- Shapes: primary buttons use the cut-corner `clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)` (16px on the big PLAY). Switches are square. Progress uses segmented pips.
- Copy: short uppercase labels; explanations move into ⓘ tooltips (`title` plus `aria-label` on the
  icon button). No sentence that only restates a label.
- Layout sizes: top bar 64px, full width, `z-index` above everything in the launcher; rail 88px wide,
  starting under the bar; footer on Play 120px; YuriNet logo 58px tall at left 20px in the bar.
- Brand images are not committed. `web/public/brand/` is git-ignored and holds `yurinet.png`,
  `ra2-icon.png`, `yr-icon.png`, `bg-ra2.webp`, `bg-yr.webp` on the owner's machine. Every use has a
  fallback (text tile, gradient) so the public build shows no broken image.
- Accessibility: every control keyboard reachable and labelled; text contrast at least 4.5:1;
  `aria-current` on the selected tab, rail tile and settings section.
- Works from 360px to wide desktop, 16px side gutter on phones, no horizontal page scroll.
- `pnpm test`, `pnpm typecheck` and `pnpm lint` pass after every task (run from `web/`).

## Review Focus

1. **A fresh browser with nothing installed.** Play shows one INSTALL THE GAME call to action, the rail
   shows no edition tiles, Mods and Game say there is no game yet, and nothing throws. Test in Task 7.
2. **An install that has only one edition.** The rail shows that one tile, and an "All games" write
   touches only that edition's files. Tests in Tasks 4 and 6.
3. **A player with several legacy slots.** The remembered slot is used; the others are listed on the
   Game screen with USE and REMOVE; nothing is deleted by the redesign. Tests in Tasks 3 and 9.
4. **Brand images missing.** Logo, icons and backgrounds fall back without a broken-image icon. Tests
   in Tasks 1 and 2.
5. **The active mod was removed.** The profile reads as Vanilla, and removing the active mod clears
   `[mods] active`. Tests in Tasks 5 and 8.

---

### Task 1: Tokens, fonts, brand assets

**Files:**
- Create: `web/src/styles/tokens.css`, `web/src/components/brand.ts`, `web/src/components/brand.test.ts`, `web/src/components/BrandImage.tsx`, `web/src/components/BrandImage.test.tsx`, `web/public/fonts/*.woff2` and `web/public/fonts/OFL.txt`
- Modify: `web/src/main.tsx` (import `tokens.css`), `.gitignore` (add `web/public/brand/`)

**Interfaces:**
- Produces: `EDITION_BRAND: Record<GameId, { title: string; kicker: string | null; short: "RA2" | "YR"; icon: string; background: string; tile: string; tileBorder: string }>`;
  `LOGO_SRC = "brand/yurinet.png"`; `BrandImage({ src, alt, fallback, className }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

```ts
// brand.test.ts
expect(EDITION_BRAND.ra2.title).toBe("Red Alert 2");
expect(EDITION_BRAND.ra2md.title).toBe("Yuri’s Revenge");
expect(EDITION_BRAND.ra2md.kicker).toBe("EXPANSION");
expect(EDITION_BRAND.ra2.kicker).toBeNull();
expect(EDITION_BRAND.ra2.icon).toBe("brand/ra2-icon.png");
expect(EDITION_BRAND.ra2md.background).toBe("brand/bg-yr.webp");
```

```tsx
// BrandImage.test.tsx: "shows the fallback when the image fails"
render(<BrandImage src="brand/missing.png" alt="" fallback={<span>RA2</span>} />);
fireEvent.error(document.querySelector("img")!);
expect(screen.getByText("RA2")).toBeInTheDocument();
expect(document.querySelector("img")).toBeNull();
```

- [ ] **Step 2: Run them and see them fail** — `pnpm vitest run src/components/brand.test.ts src/components/BrandImage.test.tsx`; expected: module not found.

- [ ] **Step 3: Implement.** `brand.ts` holds the table above (tile colors: RA2 `--red-deep`/`--red-dark`, YR `--yuri`/`--yuri-mid`). Paths go through `appPath()` from `paths.ts` at the call site. `BrandImage` renders `<img>` until its `onError`, then the fallback. Download the four font families from Google Fonts (OFL) as woff2 into `web/public/fonts/` with `@font-face` rules in `tokens.css`.

- [ ] **Step 4: Run the tests and see them pass**, then `pnpm typecheck`.

- [ ] **Step 5: Commit** — `feat(web): launcher tokens, fonts and brand image fallback`

### Task 2: Key art background

**Files:**
- Create: `web/src/components/KeyArt.tsx`, `KeyArt.module.css`, `KeyArt.test.tsx`

**Interfaces:**
- Consumes: `EDITION_BRAND`, `BrandImage` (Task 1).
- Produces: `KeyArt({ edition, dim }: { edition: GameId | null; dim?: number }): JSX.Element`. It fills
  its positioned parent. `dim` (0–1) adds a flat dark layer (Mods 0.78, Game 0.78, Settings 0.84,
  Install 0.45, Sign-in 0.4).

- [ ] **Step 1: Write the failing tests:** "uses the edition's background" (`img` src ends with
  `brand/bg-ra2.webp` for `"ra2"`); "falls back to the gradient" (after `error`, an element with
  `data-fallback="gradient"` exists); "null edition uses the RA2 art"; "dim adds a layer"
  (`dim={0.78}` → an element whose style `background` is `rgba(7, 8, 11, 0.78)`).

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement.** Image `object-fit: cover`, `object-position: 60% 50%` (RA2) and
  `62% 50%` (YR). Two fixed shade layers from `KeyArt.dc.html` (`isBase` block): left
  `linear-gradient(90deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 32%, transparent 55%)` and bottom
  `linear-gradient(180deg, rgba(0,0,0,.35) 0%, transparent 18%, transparent 55%, rgba(0,0,0,.7) 100%)`.
  Gradient fallback: `radial-gradient(at 70% 40%, #5e1012, #07080b 70%)` for RA2,
  `radial-gradient(at 70% 40%, #3a1d66, #07080b 70%)` for YR.

- [ ] **Step 4: Run them and see them pass.**

- [ ] **Step 5: Commit** — `feat(web): key art background with fallback`

### Task 3: Active installation and edition

**Files:**
- Create: `web/src/storage/active-install.ts`, `active-install.test.ts`

**Interfaces:**
- Produces:
  `interface ActiveInstall { installation: InstallationRecord; editions: GameRecord[] }` (editions in the order `ra2`, `ra2md`);
  `pickActiveInstall(installations: InstallationRecord[], games: GameRecord[], remembered: number | null): ActiveInstall | null`;
  `readActiveSlot(storage?: Pick<Storage,"getItem">): number | null` and `writeActiveSlot(slot: number, storage?)` on key `ra2-active-slot`;
  `pickEdition(editions: GameRecord[], remembered: string | null): GameRecord | null` (reuses key `ra2-edition:<slot>`, same as `Library.tsx` today).

- [ ] **Step 1: Write the failing tests**

```ts
it("uses the remembered slot", () =>
  expect(pickActiveInstall([inst(1), inst(2)], [g(1,"ra2md"), g(2,"ra2")], 2)?.installation.slot).toBe(2));
it("ignores a remembered slot that is gone", () =>
  expect(pickActiveInstall([inst(1)], [g(1,"ra2md")], 5)?.installation.slot).toBe(1));
it("prefers the lowest slot with a complete game", () =>
  expect(pickActiveInstall([inst(1), inst(2)], [g(1,"ra2md",{complete:false}), g(2,"ra2")], null)?.installation.slot).toBe(2));
it("returns null with no installations", () => expect(pickActiveInstall([], [], null)).toBeNull());
it("orders editions RA2 then YR", () =>
  expect(pickActiveInstall([inst(1)], [g(1,"ra2md"), g(1,"ra2")], null)?.editions.map(e => e.id)).toEqual(["ra2","ra2md"]));
it("pickEdition falls back to YR, then to the first", () => {
  expect(pickEdition([g(1,"ra2"), g(1,"ra2md")], null)?.id).toBe("ra2md");
  expect(pickEdition([g(1,"ra2")], "ra2md")?.id).toBe("ra2");
});
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the four functions; storage calls wrapped in try/catch like `rememberedEdition` in `Library.tsx`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): pick the active installation and edition`

### Task 4: "All games" writes

**Files:**
- Create: `web/src/storage/all-games.ts`, `all-games.test.ts`

**Interfaces:**
- Consumes: `loadGameSettings`, `writeGameSettings`, `setIniValue`, `serializeIni`, `withDefaultHotkeys`, `GameSettingsDeps` from `storage/game-settings.ts`.
- Produces:
  `forEachEdition(editions: GameRecord[], write: (game: GameRecord) => void): void` (local-storage preferences: video, fullscreen, cursor, intro, Thai font, campaign speed control);
  `setMainValueForAll(editions: GameRecord[], section: string, key: string, value: string, deps?: Partial<GameSettingsDeps>): Promise<void>` (loads each edition's own main INI, sets, writes under its own file name);
  `setHotkeyForAll(editions: GameRecord[], name: string, value: number, deps?): Promise<string[]>` (returns the edition ids it wrote; skips an edition whose hotkey list has no `name`).

- [ ] **Step 1: Write the failing tests** with fake `readSave`/`writeSave`/`readImported` deps:
  "writes RA2.INI and RA2MD.INI" (`setMainValueForAll([ra2, yr], "Options", "GameSpeed", "4")` →
  two writes, names `RA2.INI` and `RA2MD.INI`, both contain `GameSpeed=4`); "one edition writes one
  file"; "a YR-only command skips RA2" (`setHotkeyForAll([ra2, yr], "VeterancyNav", 65)` resolves to
  `["ra2md"]`; `VeterancyNav` is in YR's default keyboard file and not RA2's); "forEachEdition calls
  once per edition".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Writes run in sequence, in edition order; the first failure rejects.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): write a setting to every edition`

### Task 5: Active mod

**Files:**
- Create: `web/src/storage/active-mod.ts`, `active-mod.test.ts`

**Interfaces:**
- Consumes: `loadGameSettings(...).host`, `setIniValue`, `getIniValue`, `writeGameSettings`, `listMods`.
- Produces:
  `readActiveMod(game: GameRecord, mods: ModRecord[], deps?): Promise<string>` (`""` is Vanilla;
  a name not in `mods` reads as `""`);
  `writeActiveMod(game: GameRecord, name: string, deps?): Promise<void>` (section `mods`, key `active`,
  the format `src/web/settings.c:116` reads at startup).

- [ ] **Step 1: Write the failing tests:** "no host file reads Vanilla"; "reads `[mods] active=Mental Omega`"
  when that mod is listed; "a removed mod reads Vanilla"; "write then read round-trips";
  "writing `""` leaves `active=` empty".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Write to `host.name` (the edition-named `.host` file).
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): read and set the active mod from the launcher`

### Task 6: Launcher shell

**Files:**
- Create: `web/src/screens/launcher/Shell.tsx`, `Shell.module.css`, `Shell.test.tsx`

**Interfaces:**
- Consumes: `EDITION_BRAND`, `BrandImage`, `LOGO_SRC` (Task 1); `StorageMeter`'s `estimate` prop shape.
- Produces:
  `Shell({ editions, edition, onEdition, children, estimate }: { editions: GameRecord[]; edition: GameRecord | null; onEdition(game: GameRecord): void; children: ReactNode; estimate?: () => Promise<{ quota?: number; usage?: number }> })`.
  Tabs are `NavLink`s: PLAY `/`, MODS `/mods`, GAME `/manage`. Rail bottom link: SETTINGS `/settings/launcher`.

- [ ] **Step 1: Write the failing tests** (render inside `MemoryRouter`):
  "marks the current tab" (at `/mods`, the MODS link has `aria-current="page"`);
  "shows one tile per edition" (editions `[ra2]` → one button named "Red Alert 2", none named "Yuri’s Revenge");
  "switches edition" (click "Red Alert 2" → `onEdition` called with the RA2 record);
  "shows the storage figure" (estimate 4.3 GB of 60 GB → text `4.3 / 60 GB`);
  "logo falls back to text" (after image error, text `YURINET` is present).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** per `A-Play.dc.html`: bar `position: fixed`, full width, `z-index: 2`, logo at left, tab row after 168px, storage meter right; rail fixed `top: 64px` below it, edition tiles 88×76 with the 52px icon (fallback: the RA2/YR text tile), selected tile `border-left: 3px solid var(--red)` and `rgba(255,255,255,.06)` fill. No MAPS, LADDER or profile chip (see Scope).
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): launcher shell with top bar and game rail`

### Task 7: Play screen

**Files:**
- Create: `web/src/screens/launcher/PlayScreen.tsx`, `PlayScreen.module.css`, `PlayScreen.test.tsx`

**Interfaces:**
- Consumes: `KeyArt`, `EDITION_BRAND`, `assessEditionReadiness` (storage/install), `readActiveMod`/`writeActiveMod`, `listMods`.
- Produces: `PlayScreen({ install, edition, build, mods, activeMod, onActiveMod, onPlay, onInstall, onResume }: { install: ActiveInstall | null; edition: GameRecord | null; build: BuildInfo; mods: ModRecord[]; activeMod: string; onActiveMod(name: string): Promise<void>; onPlay(game: GameRecord): void; onInstall(): void; onResume(slot: number): void })`.

- [ ] **Step 1: Write the failing tests:**
  "nothing installed shows one INSTALL THE GAME button" (calls `onInstall`; no PLAY button);
  "YR shows EXPANSION and YURI’S REVENGE"; "RA2 shows RED ALERT 2 without a kicker";
  "PLAY calls onPlay with the edition"; "PLAY is disabled with the readiness reason as the status"
  (missing required content → status text starts `Missing`); "an unfinished import shows RESUME INSTALL"
  (calls `onResume(slot)`); "the profile menu lists Vanilla and each mod, and picking one calls
  `onActiveMod(name)`"; "MANAGE MODS goes to /mods".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** per `A-Play.dc.html`: title block at left 152px / bottom 176px (88px Russo
  One); footer 120px with PROFILE picker (left), PLAY 320×76 (center), status dot and text (right).
  Status text: `Ready`, or the readiness message `Library.tsx` shows today.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): Play screen`

### Task 8: Mods screen

**Files:**
- Create: `web/src/screens/launcher/ModsScreen.tsx`, `ModsScreen.module.css`, `ModsScreen.test.tsx`
- Delete at Task 12: `web/src/components/ModLibrary.tsx`

**Interfaces:**
- Consumes: `importMod`, `removeMod`, `listMods`, `fileListSource`, `droppedSource`, `writeActiveMod`.
- Produces: `ModsScreen({ editions, manifest, target, activeMods, onChanged }: { editions: GameRecord[]; manifest: Manifest; target: CopyTarget; activeMods: Record<string, string>; onChanged(): void })` (`activeMods` keyed by `game.storage`).

- [ ] **Step 1: Write the failing tests:** "lists mods of every edition with its edition and size";
  "ALL / RED ALERT 2 / YURI’S REVENGE filters"; "the active mod shows IN USE"; "INSTALL MOD asks which
  edition when there are two" (then imports into that edition's storage); "a dropped folder installs";
  "REMOVE asks first, then removes"; "removing the active mod clears it" (`writeActiveMod(game, "")`
  called); "no game installed shows the install link".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** per `A-Mods.dc.html` (rows with a 64px thumbnail placeholder, PLAY sets the
  mod active then navigates to `/`, files and remove icon buttons with labels). Progress text while
  copying: `Copying 1.2 GB of 2.9 GB`. The drop zone text: `Drop a mod folder`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): Mods screen`

### Task 9: Game screen

**Files:**
- Create: `web/src/screens/launcher/GameScreen.tsx`, `GameScreen.module.css`, `GameScreen.test.tsx`

**Interfaces:**
- Consumes: the `Library` props it replaces (`onRenameInstallation`, `onRemove`, `onDownloadSaves`, `onImportSaves`, `browseSource`, `estimate`, `onResume`, `onImport`), `FileExplorer`, `ActiveInstall`.
- Produces: `GameScreen({ install, others, build, onUse, ...LibraryActions })` where `others: ActiveInstall[]` and `onUse(slot: number): void`.

- [ ] **Step 1: Port the cases from `Library.test.tsx`** that cover rename, remove confirmation (says
  the size and that saves and settings are kept), download and import saves, browse files, resume, and
  the storage figure, renamed to the new copy (`BROWSE FILES`, `DOWNLOAD .ZIP`, `IMPORT .ZIP`,
  `REMOVE GAME`). Add: "lists other installs with USE" (`onUse(2)`), "movies missing shows ADD MOVIES"
  (goes to `onResume(slot)`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** per `A-Game.dc.html`: INSTALLED panel (edition rows with icon, title,
  readiness), SAVED GAMES panel, BROWSER STORAGE panel, REMOVE GAME; OTHER INSTALLS panel only when
  `others.length > 0`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): Game screen`

### Task 10: Install screen

**Files:**
- Modify: `web/src/screens/Import.tsx`, `Import.module.css`, `Import.test.tsx`

**Interfaces:**
- Consumes: `KeyArt` (`dim 0.45`), `BrandImage`/`LOGO_SRC`. `ImportDeps` and the import logic stay as they are.

- [ ] **Step 1: Update the tests to the new copy:** heading `INSTALL THE GAME`, intro `Pick your Red Alert 2 folder. Nothing is uploaded.`, buttons `CHOOSE FOLDER`, `Use file picker`, review heading `READY TO INSTALL`, `INSTALL 2.9 GB`, `OTHER FOLDER`, copying heading `INSTALLING`, `CANCEL`; a step header with `1 FOLDER`, `2 CHECK`, `3 COPY` where the current one has `aria-current="step"`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Restyle** per `A-Install.dc.html`: a 600px panel centered over the key art, logo above
  it; options become the three checkboxes (Movies with size, Saved games, Settings and hotkeys); the
  non-persistent-storage warning stays, as one amber line.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): Install screen`

### Task 11: Settings screen

**Files:**
- Create: `web/src/screens/launcher/settings/SettingsScreen.tsx`, `SettingsScreen.module.css`, and one file per tab: `LauncherTab.tsx`, `GameplayTab.tsx`, `AudioTab.tsx`, `VideoTab.tsx`, `KeyboardTab.tsx`; shared controls in `controls.tsx` (`Toggle`, `Segmented`, `PipBar`, `InfoTip`, `Row`)
- Move tests: `web/src/components/LauncherGameSettings.test.tsx` → `web/src/screens/launcher/settings/SettingsScreen.test.tsx`
- Delete: `web/src/components/LauncherGameSettings.tsx` and its CSS module once the tests pass

**Interfaces:**
- Consumes: Task 4 (`forEachEdition`, `setMainValueForAll`, `setHotkeyForAll`) and every preference read/write the old component uses.
- Produces: `SettingsScreen({ editions, edition, tab, gameSettingsDeps }: { editions: GameRecord[]; edition: GameRecord; tab: "launcher" | "gameplay" | "audio" | "video" | "keyboard"; gameSettingsDeps?: Partial<GameSettingsDeps> })`. Sections link to `/settings/<tab>`.

- [ ] **Step 1: Move the 21 existing cases** and re-target them at `SettingsScreen` (values are read
  from `edition`). Add: "shows ALL GAMES"; "a Gameplay change writes both INI files"
  (`writeSave` called for `RA2.INI` and `RA2MD.INI`); "a Launcher toggle writes both storages"
  (`ra2-skip-intro` style keys for both `game.storage` values); "hints are tooltips" (the Cursor hint
  text is the `title` of an `InfoTip`, not visible text); "RESET DEFAULTS resets the open tab only".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** per `A-Settings.dc.html` and the four `A-Settings-*.dc.html` boards: left
  section nav (200px), content max 760px, rows 52–60px with a bottom line. Launcher tab: Skip intro;
  DISPLAY (Scaling Sharp/Smooth/CRT/Nearest/Integer, Menu bars Blur/Black, Cursor Smooth/Classic with
  tip, HD vehicles, FPS counter); THAI TEXT (font choice and switch). The other tabs keep every
  control listed in the brief's "Must keep" for that tab. Volume sliders become 10-pip `PipBar`s
  (keyboard: arrow keys change by one pip).
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): Settings screen for all games`

### Task 12: Routes and App wiring

**Files:**
- Modify: `web/src/App.tsx`, `web/src/App.test.tsx`
- Delete: `web/src/screens/Library.tsx`, `Library.module.css`, `Library.test.tsx` (cases moved in Task 9), `web/src/components/ModLibrary.tsx`

**Interfaces:**
- Consumes: Tasks 3, 5, 6–11.
- Produces: routes `/` Play, `/mods`, `/manage`, `/settings/:tab`, `/import` (unchanged URL, now inside the
  shell with a BACK link), `/game/:slot` (unchanged). `/settings` and an unknown tab redirect to
  `/settings/launcher`.

- [ ] **Step 1: Update `App.test.tsx`:** "/ shows PLAY in the bar"; "/manage shows GAME as current";
  "/settings/nope redirects to /settings/launcher"; "picking an edition in the rail is remembered"
  (`ra2-edition:<slot>` written); "Play navigates to /game/<slot>?edition=<id>" (the existing
  fullscreen and `cursor=game` flag logic moved, not changed).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Wire it.** `Main` computes `pickActiveInstall`, `pickEdition`, the mod lists and the
  active mod for the selected edition, and passes the existing callbacks (saves, remove, rename,
  browse) to `GameScreen`. `UpdatePrompt` ("A new version is ready. Reload") stays, restyled as a
  36px amber strip under the top bar. `BrowserCheck`, the "Starting…" state and the build-missing
  callout keep their logic and get the tokens and fonts only.
- [ ] **Step 4: Run the whole suite** — `pnpm test`, `pnpm typecheck`, `pnpm lint`; all pass.
- [ ] **Step 5: Commit** — `feat(web): route the launcher through the new shell`

### Task 13: In-game overlay and sound

**Files:**
- Modify: `web/src/screens/Play.tsx`, `Play.module.css`, `web/src/components/SoundControl.tsx`, `SoundControl.module.css`, `SoundControl.test.tsx`, `web/src/screens/FrameStats.module.css`

**Interfaces:**
- Consumes: existing `Play.tsx` handlers (settings, type, files, LAN, fullscreen) and `SoundControl` props; no new props.

- [ ] **Step 1: Update `SoundControl.test.tsx`:** volume is a group of 10 buttons named
  `Volume 10%` … `Volume 100%`, the current one `aria-pressed="true"`; the two switches are
  `Mute when in background` and `Menu music`. Add a `Play` tray test if one can mount without the
  game (else cover it in Task 17's e2e).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Restyle** per `A-InGame.dc.html`: a 52×44 red star toggle at top-left; open, it shows
  SETTINGS F10 · TYPE · FILES · LAN (green dot when connected) · volume % · F11, on a dark bar with a
  2px `--red-dark` bottom line; collapsed, only the star at 40% opacity. FPS readout: green
  (`#6ff2a4` on `rgba(5,12,8,.82)`), rows GAME / PAGE / SIZE.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): in-game overlay restyle`

### Task 14: In-game F10 panel

**Files:**
- Modify: `web/src/components/SettingsDialog.tsx`, `SettingsDialog.test.tsx`; reuse `controls.tsx` from Task 11

- [ ] **Step 1: Update the tests:** it is a `dialog` named `Settings`; Scaling has five radios;
  Resolution has the tip `Takes effect next match.`; Lock pointer shows key `Esc`, FPS counter shows
  `Alt+Shift+F`, Mod row shows the mod name and `F9`; BACK TO GAME closes it.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Restyle** per `A-InGameMenu.dc.html`: right side panel 460px, `border-left: 3px solid var(--red)`, DISPLAY and CONTROLS groups, footer with F11 and BACK TO GAME.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): in-game settings panel restyle`

### Task 15: Loading screen and crash dialog

**Files:**
- Modify: `web/src/screens/LoadingScreen.tsx`, `LoadingScreen.module.css`, `LoadingScreen.test.tsx`; the crash dialog in `Play.tsx`

- [ ] **Step 1: Update the tests:** a `progressbar` with `aria-valuenow` equal to the copy percent and
  40 segments; the edition title (`YURI’S REVENGE` with `EXPANSION`); the line `1.1 of 2.9 GB · ra2md.mix`
  from `describeLoading`. Crash: heading `THE GAME STOPPED`, buttons `RELOAD`, `LAUNCHER`, and `LOG`
  with `aria-expanded` toggling the last 80 log lines.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Restyle** per `A-Loading.dc.html` (key art, 220px bottom band, title left, 560px
  segmented bar right) and the crash card on `A-InGameDialogs.dc.html`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): loading screen and crash dialog restyle`

### Task 16: LAN, exit and sound-start dialogs

**Files:**
- Modify: `web/src/components/LanPanel.tsx`, `LanPanel.module.css`, `LanPanel.test.tsx`; the exit confirm and the sound-start banner in `Play.tsx`

- [ ] **Step 1: Update the tests:** LAN has HOST / JOIN radios; three numbered steps, the current one
  marked, done ones show ✓; a status badge (`WAITING FOR ANSWER` when hosting before the answer);
  COPY and PASTE buttons on the code boxes; footnote `Same network only. Nothing goes through a server.`
  Exit: `LEAVE THE GAME?` with `STAY` and `EXIT GAME`. Sound: `Sound is off until you click.` with `TURN ON`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Restyle** per `A-InGameDialogs.dc.html`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** — `feat(web): LAN, exit and sound dialogs restyle`

### Task 17: Phone layout, docs, e2e

**Files:**
- Modify: `Shell.module.css`, `PlayScreen.module.css`, `SettingsScreen.module.css`; `docs/web/frontend.md` (screens, routes, the active-install and all-games rules); `docs/web/decisions.md` (new entries: one active install over slots; settings written to every edition; brand images kept out of git); `web/e2e/smoke.mjs`, `web/e2e/launcher-settings.mjs`, `web/e2e/import.mjs`

- [ ] **Step 1: Phone layout.** Under 720px: the rail becomes a 64px row under the bar, tabs scroll
  sideways inside the bar, the Play footer stacks (profile, then PLAY full width), settings nav
  becomes a horizontal segmented row. Check at 360×740 in the dev server: no horizontal page scroll.
- [ ] **Step 2: e2e.** Update selectors in the three scripts to the new copy and routes; run them per
  `docs/web/testing.md` against a local build; all pass.
- [ ] **Step 3: Docs** as listed above; update this plan's Progress summary.
- [ ] **Step 4: Final check** — `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` in `web/`.
- [ ] **Step 5: Commit** — `docs(web): launcher redesign notes; e2e on the new launcher`
