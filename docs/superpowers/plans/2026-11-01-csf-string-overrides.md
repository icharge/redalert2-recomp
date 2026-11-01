# CSF String Injection and Overrides from the Launcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> **Revision 2 (1 November 2026):** The overrides are a static, launcher-owned
> `web/public/strings.json`. They are not stored in a player's save store and the page has no
> editor for them. The first implementation used a per-installation `launcher.json` plus a Strings
> tab; that UI and storage path were removed at the owner's request. The codec, base-CSF source,
> loader application and both-edition e2e are the same.

**Goal:** Let the launcher operator change individual game strings (CSF labels) from a static JSON
file shipped with the launcher, without editing or shipping a whole `.csf`. The first use is the main
menu's Exit Game button reading **Exit to Launcher** in both editions.

**Architecture:** The web launcher fetches `<base>/strings.json`, finds the edition's base CSF (the
active mod's loose CSF, the import's loose CSF, or the copy inside `language.mix`/`langmd.mix`),
applies the JSON overrides, and writes a complete CSF into the in-memory `/game` folder before the
game starts. The engine reads the loose CSF instead of its MIX copy. No game code changes; native
builds keep their existing behavior (web-only v1). The file is not user-editable in the page.

**Tech stack:** React 18, TypeScript, Vitest, OPFS, Emscripten FS, Playwright e2e.

**Related docs:** [storage.md](../../web/storage.md), [frontend.md](../../web/frontend.md),
[decisions.md](../../web/decisions.md) (D7), [testing.md](../../web/testing.md),
[protocol.md](../../web/protocol.md).

## Progress summary

| ID       | Track    | Task                                                     | Status               |
| -------- | -------- | -------------------------------------------------------- | -------------------- |
| CSF-1    | Codec    | Parse and rewrite CSF files in TypeScript                | Done                 |
| CSF-2    | Codec    | CSF codec unit tests                                     | Done                 |
| MIX-1    | Source   | Read a MIX index and extract one entry (RSA + Blowfish)  | Done                 |
| MIX-2    | Source   | MIX reader unit tests                                    | Done                 |
| MIX-3    | Source   | Resolve the base CSF: mod -> loose file -> language MIX  | Done                 |
| JSON-1   | Config   | `strings.json` schema, fetch, validation                 | Done                 |
| JSON-2   | Config   | `strings.json` unit tests                                | Done                 |
| APPLY-1  | Launch   | Apply overrides and write the CSF before `callMain`      | Done                 |
| APPLY-2  | Launch   | Keep the generated CSF out of the save store             | Done                 |
| APPLY-3  | Launch   | Loader integration tests                                 | Done                 |
| UI-1     | Launcher | Strings tab in `LauncherGameSettings`                    | Removed (Revision 2) |
| UI-2     | Launcher | Component tests and encoding warnings                    | Removed (Revision 2) |
| E2E-1    | Verify   | Exit Game -> "Exit to Launcher" in both editions         | Done                 |
| E2E-2    | Verify   | Base CSF from the MIX, and the fail-closed paths         | Done                 |
| DOC-1    | Docs     | Update storage/frontend/decisions/testing/tasks/progress | Done                 |
| VERIFY-1 | Verify   | Typecheck, lint, unit tests, both-edition build          | Done                 |

**Completed 1 November 2026.** Unit coverage: `csf` 15, `mix` 9 (including
real `language.mix`/`langmd.mix` extraction), `csf-source` 8,
`launcher-strings` 9, `csf-apply` 9, `loader-csf` 2. The full frontend suite
is 54 files / 505 tests, typecheck and scoped ESLint pass, and
`pnpm --dir web build` produces the page. `e2e/csf-strings.mjs` read the static
`strings.json`, started both editions from imported profiles, read the
generated `/game/ra2.csf` and `/game/ra2md.csf`, captured the main menu, and
exited. Screenshots and reports are in `work/csf-strings/{ra2,ra2md}-static/`;
both show **Exit to Launcher**.

## Global constraints

- Web-only v1. Do not change native Windows or Linux behavior.
- Never modify the player's OPFS game files. Write only the in-memory `/game` file system.
- Do not persist the generated CSF to the save store. Apply it before `startSaveSync` takes its
  initial snapshot, and guard the path in the watcher.
- Preserve every byte of an untouched CSF entry, including `WRTS` extra data (sound names and
  similar). Only the entries named in `strings.json` change.
- Fail closed: invalid JSON, invalid CSF, or no base CSF means the game starts unchanged. Never write
  a half-written CSF.
- Labels are case-insensitive; store and compare them uppercase, as the CSF does.
- `strings.json` is shipping content in `web/public/`, not a save-store file. The page does not edit
  it and no player can change it at runtime.
- Do not commit game data. The base CSF always comes from the player's installation.
- The Exit Game button's behavior is unchanged; only its caption changes.

## Config contract

`web/public/strings.json`, served at `<base>/strings.json`:

```json
{
  "version": 1,
  "ra2": {
    "encoding": "windows-1252",
    "strings": {
      "GUI:ExitGame": "Exit to Launcher"
    }
  },
  "ra2md": {
    "encoding": "windows-1252",
    "strings": {
      "GUI:ExitGame": "Exit to Launcher"
    }
  }
}
```

- Each of `ra2` and `ra2md` is optional; an absent edition has no overrides.
- `enabled`: default `true`; `false` disables an edition without deleting its map.
- `encoding`: `windows-1252` (default, the shipped English CSF) or `windows-874` (Thai; the Thai font
  fix should be on). Unknown encodings are rejected by validation.
- `strings`: label -> replacement text. Existing labels are replaced. Missing labels are ignored
  unless `inject` is true.
- `inject`: when true, a label absent from the base CSF is appended. Reject labels longer than the
  base CSF's longest label (the engine's label buffer is sized from it), and labels with NUL or
  non-ASCII characters.
- `extra`: optional `WRTS` extra bytes for an entry, hex-encoded (advanced; v1 preserves the original
  extra unless this is set). Validate the length and hex characters.

The file is part of the launcher build: an operator edits it and redeploys. It is not downloaded to,
or edited from, a player's browser.

## Base CSF resolution

1. **Active mod.** Read `[mods] active` from `/game/.host/<edition>.ini` after `restoreSaves` and
   `loadMods`. If `mods/<name>/<edition>.csf` exists in the in-memory FS, that is the base.
2. **Loose CSF in the import.** Otherwise, if `/game/<edition>.csf` exists (imported by the player or
   left by an earlier launch), use it.
3. **Language MIX.** Otherwise, extract the CSF from the player's archive:
   - RA2: `ra2.csf`, normally inside `language.mix`.
   - Yuri's Revenge: `ra2md.csf`, normally inside `langmd.mix`.
   - Read the MIX header/index. A new-format index may be encrypted: the 80-byte RSA block yields
     the 56-byte Blowfish key, and the index is Blowfish ECB. Find the entry by `mix_hash(name)`.
   - If the language archive does not have it, scan the other top-level `*.mix` files (header reads
     are cheap).
4. **Nothing.** Disable overrides for this launch and show: "These strings need a loose CSF or a
   language MIX; none was found."

The generated CSF replaces the source file, so the game never sees a partial table. Write it to the
active mod's path when the mod supplied the base; otherwise write `/game/<edition>.csf`.

## What the CSF format is

Header (24 bytes, little-endian): ` FSC` (`0x43534620`), version (3), label count, string count,
reserved, language id (version >= 2).

Each label entry: ` LBL` (`0x4C424C20`), pair count, label length, ASCII label, then one pair per
value:

- `STR ` (`0x53545220`) or `WRTS` (`0x53545257`), character count, inverted UTF-16LE code units.
- `WRTS` then carries an extra length and that many extra bytes (for example a sound name such as
  `ceva001e`). The extra is not text and is copied unchanged unless the JSON says otherwise.

The two shipped English tables were verified while writing this plan:

| Edition | Archive        | Entry       | Labels | `GUI:ExitGame` | Tooltip label / value                             |
| ------- | -------------- | ----------- | ------ | -------------- | ------------------------------------------------- |
| RA2     | `language.mix` | `ra2.csf`   | 4479   | `Exit Game`    | `STT:MainButtonExitGame` / `Quit Red Alert 2.`    |
| Yuri    | `langmd.mix`   | `ra2md.csf` | 5211   | `Exit Game`    | `STT:MainButtonExitGame` / `Quit Yuri's Revenge.` |

The main-menu dialog is `0xE2`; the Exit Game button is control `1006`, caption label
`GUI:ExitGame`. The label change is cosmetic: the button still runs the Exit Game path.

## Track 1: CSF codec (CSF)

### CSF-1: Parse and rewrite CSF files

**Files:**

- Create: `web/src/storage/csf.ts`
- Reuse: `crc32` from `web/src/storage/zip.ts` for the MIX hash, not for the codec.

**Interfaces:**

- `parseCsf(data: Uint8Array): CsfFile`
- `rewriteCsf(base: CsfFile, changes: CsfChanges): Uint8Array`
- `CsfFile = { version; language; entries: CsfEntry[] }`
- `CsfEntry = { label; value; extra: Uint8Array | null; raw: Uint8Array }`
- `CsfChanges = { strings: Record<string, string>; inject?: boolean; encoding: CsfEncoding; extra?: Record<string, Uint8Array> }`

**Steps:**

- [ ] Parse the header, labels, `STR`/`WRTS` pairs, inverted UTF-16LE values, and the extra bytes.
      Reject bad magic, truncated lengths, a label count that does not match the file, labels over 255
      bytes, and a file over 4 MiB.
- [ ] Keep each entry's original bytes so an unchanged entry is copied verbatim. An overridden entry
      is re-encoded: label unchanged, pair count unchanged, `WRTS` flag and extra unchanged (unless the
      JSON sets `extra`), value encoded in the selected code page and inverted as UTF-16LE.
- [ ] Use uppercase labels for lookup. An override whose label is not present is ignored when
      `inject` is false; when true, append a new `LBL` entry with one `STR` pair.
- [ ] Encode Windows-1252 and Windows-874 explicitly, not with `TextEncoder` (which is UTF-8). Reject
      characters the chosen code page cannot represent with a message naming the label and character.
- [ ] Recompute the header's label and string counts. Keep the version, reserved field, and
      language id from the base file.
- [ ] Round-trip: with no changes, the output must be byte-for-byte identical to the input.

**Acceptance:** A base `ra2md.csf` with `{"GUI:ExitGame": "Exit to Launcher"}` produces a valid CSF
whose only changed bytes are that entry's value; the `WRTS` entries' extras are unchanged.

### CSF-2: CSF codec tests

**Files:**

- Create: `web/src/storage/csf.test.ts`

**Steps:**

- [ ] Build a small fixture programmatically with `STR` and `WRTS` entries (including an extra such
      as `ceva001e`); assert parse -> rewrite with no changes is identical.
- [ ] Override `GUI:ExitGame` to `Exit to Launcher`; assert the value, header counts, and the extra of
      a neighbouring `WRTS` entry are unchanged.
- [ ] Add a new label with `inject: true`; assert it parses and appears once.
- [ ] Ignore a missing label with `inject: false`, but report it in the result (a `missing` list).
- [ ] Case-insensitive lookup; duplicate labels (last wins, matching the engine's hash insert).
- [ ] Reject a truncated header, bad magic, bad `LBL`/`STR` magic, invalid UTF-16 lengths, non-ASCII
      labels, overlong labels, and an unrepresentable character in the chosen code page.
- [ ] CP874: a Thai value round-trips to the expected bytes; the Thai font fix warning is outside the
      codec.

**Acceptance:** `pnpm --dir web test -- csf` passes.

## Track 2: Base CSF from a MIX (MIX)

### MIX-1: Read a MIX index and extract one entry

**Files:**

- Create: `web/src/storage/mix.ts`
- Create: `web/src/storage/csf-source.ts`

**Interfaces:**

- `mixHash(name: string): number` (uppercase + Westwood padding + CRC-32)
- `readMixEntry(data: Uint8Array, name: string, options?: { rsaModulus?: bigint }): Uint8Array | null`
- `findBaseCsf(fs, game, options?): Promise<{ bytes; path; source: "mod" | "loose" | "mix" } | null>`

**Steps:**

- [ ] Implement the old header (u16 count at 0), the new header (flags at 2), the encrypted index
      (80-byte RSA block at 4, Blowfish key, ECB index at 84), and the unencrypted new index. Validate
      every offset and length; cap the index size.
- [ ] Derive the Blowfish P/S tables from the staged `/game/Blowfish.dll` (scan for the pi constants
      `0x243F6A88, 0x85A308D3` exactly as `src/linux/blowfish.c` does). Cache the parsed tables per
      launch. Do not read or log the player's archive names beyond the entry being extracted.
- [ ] Use the public RSA modulus and exponent from the accepted MIX format; keep them in one
      documented constant. Tests may inject a different modulus.
- [ ] `findBaseCsf`: read the active mod from `/game/.host/<edition>.ini` (`[mods] active`), then
      check the mod's `<edition>.csf`, the loose `<edition>.csf`, the language MIX, and the other
      top-level MIX files, in that order.
- [ ] Return the source path and a diagnostic source tag for the launcher UI.

**Acceptance:** On the development install, `findBaseCsf(fs, "ra2md")` returns the 573,269-byte
`ra2md.csf` from `langmd.mix`; `findBaseCsf(fs, "ra2")` returns the 485,776-byte `ra2.csf` from
`language.mix`.

### MIX-2: MIX reader tests

**Files:**

- Create: `web/src/storage/mix.test.ts`

**Steps:**

- [ ] Hash/padding vectors for `ra2.csf` and `ra2md.csf`; the IDs must match the extracted archives.
- [ ] Unencrypted old and new format fixtures; encrypted fixture with a test RSA modulus.
- [ ] Truncated header/index, key block, and entry; not-found name; an entry whose range exceeds the
      file.
- [ ] A fixture with the real modulus and a synthetic index encrypted with the derived key (test the
      production path without shipping a game archive).
- [ ] `findBaseCsf` ordering: mod CSF wins over loose, loose wins over MIX; no CSF returns null.

**Acceptance:** `pnpm --dir web test -- mix` passes.

## Track 3: Static launcher strings (JSON)

### JSON-1: Schema, fetch, validation

**Files:**

- Create: `web/src/storage/launcher-strings.ts`
- Create: `web/public/strings.json` (shipping content, not a save file)

**Interfaces:**

- `type LauncherStringsConfig = { version: number; editions: Partial<Record<GameId, LauncherEditionStrings>> }`
- `readLauncherStrings(fetcher?, url?): Promise<LauncherStringsConfig>`
- `validateLauncherStrings(value: unknown): LauncherStringsConfig`
- `parseLauncherStrings(text): LauncherStringsConfig`
- `editionStrings(config, game): LauncherEditionStrings | null`
- `launcherExtras(csf): Record<string, Uint8Array>`

**Steps:**

- [x] Fetch `<base>/strings.json` with `cache: "no-cache"`; a 404 means no overrides.
- [x] Validate the version, each known edition object, the encoding enum, string maps, label syntax,
      and the total size (256 KiB).
- [x] Normalize labels and hex; reject malformed input with a user-readable error.
- [x] Do not write the file from the page. The operator edits it and redeploys.

**Acceptance:** A missing file yields an empty config; a malformed file throws before launch; the
shipped file provides `GUI:ExitGame` for both editions.

### JSON-2: Unit tests

**Files:**

- Create: `web/src/storage/launcher-strings.test.ts`

**Steps:**

- [x] Missing file, `{}`, `version: 2`, wrong encoding, non-string value, overlong label, invalid
      JSON, and a file over the size cap.
- [x] Round-trip `GUI:ExitGame` -> `Exit to Launcher`.
- [x] Per-edition selection: `ra2` and `ra2md` are independent.
- [x] A 404 is empty; a 500 is an error.

**Acceptance:** `pnpm --dir web test -- launcher-strings` passes.

## Track 4: Apply at launch (APPLY)

### APPLY-1: `applyCsfOverrides`

**Files:**

- Modify: `web/src/game/loader.ts`
- Create: `web/src/game/csf-apply.ts` (or keep the helper in `loader.ts` if it stays small)

**Steps:**

- [ ] Read `strings.json` for the edition. If it is absent, disabled, or has no strings, do nothing:
      do not extract a base CSF and do not create a loose file.
- [ ] Resolve the base CSF (`findBaseCsf`). If none, return a warning; the game starts unchanged.
- [ ] Parse the base, apply the overrides, and write the complete CSF to the active mod's path when
      the base came from that mod, otherwise to `/game/<edition>.csf`.
- [ ] If the base came from a MIX, write the loose `/game/<edition>.csf`; this is what shadows the
      MIX copy.
- [ ] If `encoding` is `windows-874` and the Thai font fix is off, add a visible warning ("Thai bytes
      need the Thai font fix; the text may not render"). Do not block the launch.
- [ ] On any error, leave the FS untouched, report a non-fatal warning, and let the game start.

**Acceptance:** With the Exit Game override, `/game/ra2md.csf` (or `ra2.csf`) exists before `callMain`
and contains `GUI:ExitGame` -> `Exit to Launcher`; the rest of the table is unchanged.

### APPLY-2: Keep the generated CSF out of the save store

**Files:**

- Modify: `web/src/game/loader.ts`
- Modify: `web/src/storage/saves.ts` if a guard is needed

**Steps:**

- [ ] Apply the CSF after `loadFiles` (which includes `restoreSaves` and `loadMods`) and
      `stageRuntimeBundle`, and before `startSaveSync`.
- [ ] `startSaveSync` snapshots `/game` at that moment, so the generated CSF counts as unchanged.
      Add an explicit generated-path guard so a later toolbar or game write cannot copy it.
- [ ] Add a test: after apply, `flush()` does not write `save/<storage>/<edition>.csf`; an imported
      loose CSF that the user expects to keep is still handled as before.
- [ ] Confirm `restoreSaves` never restores a generated CSF (the guard prevents it being stored in the
      first place).

**Acceptance:** The player's save store has no generated CSF after a launch and exit.

### APPLY-3: Loader integration tests

**Files:**

- Modify: `web/src/game/loader.test.ts`

**Steps:**

- [ ] A fake FS with a base CSF and a `strings.json` config; assert the generated bytes and path.
- [ ] Active mod with its own CSF: the mod file is patched, not the root file.
- [ ] No config, empty strings, invalid JSON, missing base CSF, and a malformed base CSF: the game starts
      with no generated CSF (or the original bytes).
- [ ] A MIX-sourced base: the generated loose CSF is written.
- [ ] `restart`/reload applies the current config again; changing it between launches changes the
      generated CSF.
- [ ] The save watcher ignores the generated CSF.

**Acceptance:** `pnpm --dir web test -- loader` passes.

## Track 5: Launcher UI (removed in Revision 2)

The first implementation added a Strings tab backed by a per-installation `launcher.json`.
The owner asked for the overrides to be part of the launcher itself, not a player-editable save
file, so the tab, its component, its tests and its OPFS storage module were removed. There is no
launcher UI for `strings.json`; it is shipping content in `web/public/`.

## Track 6: End-to-end (E2E)

### E2E-1: The Exit Game example in both editions

**Files:**

- Create: `web/e2e/csf-strings.mjs`

**Steps:**

- [ ] Start with an imported profile (the existing `work/perf/profile-fresh` pattern).
- [ ] Confirm the static `web/public/strings.json` maps `GUI:ExitGame` to `Exit to Launcher`.
- [ ] Launch; read `/game/<edition>.csf` from the module FS (as `launcher-settings.mjs` reads the
      INI) and assert the label value.
- [ ] Capture the main menu screenshot to `work/csf-strings/<edition>-static/main-menu.png`.
- [ ] Click the Exit Game button through the existing dialog/control driver if available; confirm the
      game exits to the launcher. The button's caption is cosmetic; the path must not change.
- [ ] Assert the tooltip `STT:MainButtonExitGame` still has the shipped value and a `WRTS` entry's
      extra bytes are unchanged.
- [ ] Run for `--edition ra2md` and `--edition ra2`.

**Acceptance:** Both editions show "Exit to Launcher" on the next launch, still exit, and return to
the launcher.

### E2E-2: Base CSF source and fail-closed paths

**Steps:**

- [ ] With a normal install (no loose CSF), confirm the launcher extracts the base from the language
      MIX and the override applies.
- [ ] With no `strings.json`, confirm no `/game/<edition>.csf` is created and the game starts.
- [ ] With a malformed `strings.json`, confirm the launcher reports the error and the game starts
      unchanged.
- [ ] With a malformed base CSF, confirm the game starts unchanged and the error is visible.

**Acceptance:** The MIX source works and every failure leaves the game playable.

## Track 7: Docs and verification (DOC/VERIFY)

### DOC-1: Documentation

**Files:**

- Modify: `docs/web/storage.md` (strings.json, generated CSF, base CSF source)
- Modify: `docs/web/frontend.md` (static strings.json, no page editor, next-launch note)
- Modify: `docs/web/decisions.md` (D7 exception: the launcher owns strings.json and generates a CSF
  in memory; the game's files and OPFS game content are not changed)
- Modify: `docs/web/testing.md` (the new e2e)
- Modify: `docs/web/tasks.md` and `docs/web/progress.md` (plan link and status)

- [ ] Record the `GUI:ExitGame` example and the loose-CSF precedence.
- [ ] Record the MIX/Blowfish dependency and that the base CSF is never committed.

### VERIFY-1: Checks

- [ ] `pnpm --dir web typecheck`
- [ ] Focused tests: `csf`, `mix`, `launcher-strings`, `csf-apply`, `loader-csf`
- [ ] `pnpm --dir web test`
- [ ] `pnpm --dir web lint`
- [ ] `pnpm --dir web format:check` (changed files clean)
- [ ] Build both editions with `-DWEB_LINK_OPT=-O1` into separate output directories.
- [ ] Headless boot for both editions: `boot` -> `settings` -> `mode` -> `menu`.
- [ ] Run `csf-strings.mjs` for both editions.

## Acceptance criteria (end state)

1. The shipped `web/public/strings.json` mapping `GUI:ExitGame` to `Exit to Launcher` makes the
   main menu's Exit Game button read **Exit to Launcher** in both RA2 and Yuri's Revenge at the next
   launch.
2. The Exit Game button still exits the game and returns to the launcher; its tooltip is unchanged
   unless the JSON overrides it.
3. Every untouched CSF entry, including `WRTS` extras, is byte-identical to the base.
4. A vanilla install with no loose CSF still works: the launcher extracts the base from
   `language.mix`/`langmd.mix`.
5. The generated CSF is never written to OPFS or the player's saves, and no game file in OPFS is
   modified.
6. Invalid JSON, invalid CSF, or no base CSF leaves the game booting unchanged with a clear launcher
   message.
7. Native Windows and Linux behavior is unchanged.
8. Typecheck, lint, unit tests, both-edition build, and the new e2e pass.

## Risks and open questions

- **Loose CSF precedence.** The plan assumes a loose `/game/<edition>.csf` shadows the copy inside the
  language MIX. Verify with the first e2e. If the engine prefers the MIX, fall back to a runtime hook
  after `sub_007346A0` (strings.json stays; only the apply step changes). That hook is the
  contingency, not the default.
- **MIX encryption.** The RSA + Blowfish reader is the largest new piece. Keep it isolated in
  `mix.ts`, test it with synthetic fixtures, and never log keys or archive contents.
- **Encoding and fonts.** CP874 text needs the Thai font fix; the launcher should warn, not silently
  produce unreadable text. Windows-1252 cannot represent Thai.
- **Button width.** "Exit to Launcher" is five characters longer than "Exit Game". The main-menu
  button is 108 dialog units wide; check the screenshot for clipping. Do not shrink the game's font
  or change the dialog template.
- **Mods with a CSF inside a MIX.** A mod that ships its CSF inside `expandmd##.mix` rather than a
  loose `ra2md.csf` may bypass the loose file. Document the limitation; the loose-file form is the
  supported one.
- **Duplicate labels and pair counts.** The shipped CSFs have one pair per label; keep the codec
  general, but test the single-pair case first.
- **Performance.** Extracting a ~600 KB CSF and parsing 4,500–5,200 labels at launch is small; measure
  it once and keep the MIX index read lazy (only when there is an override).
- **Launcher availability.** The launcher is only reachable while no game runs. Do not write
  `strings.json` during play; the file is fetched before `callMain`.

## Implementation note for the first example

- Base CSF labels: `GUI:ExitGame` is the main-menu button caption (dialog `0xE2`, control `1006`).
  `STT:MainButtonExitGame` is its tooltip and stays unchanged.
- Yuri also has `STT:MainButtonExitGamemd`; it is not the button caption and needs no override.
- The override is cosmetic: the button's click path and the fast-exit behavior are untouched.
