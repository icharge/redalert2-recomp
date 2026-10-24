# Files and storage

The player's install goes from their disk into their browser's
origin-private file system (OPFS), once. The game reads it from there
through WasmFS. Nothing is uploaded, and nothing from the game is served by
the site.

## Getting the files in

| Browser | How |
|---|---|
| Chrome, Edge (and other Chromium) | `showDirectoryPicker()`: the player picks the install folder, and the page reads only the files it needs |
| Firefox, Safari | drag the folder onto the drop zone. `DataTransferItem.webkitGetAsEntry()` walks it |
| Either | an `<input type="file" webkitdirectory>` button as a last resort |

## What is copied

An install folder holds more than the game reads: tools, backups, other
mods, analysis files. Copying all of it can cost several GB (the folder this
repo was developed against is 2.6 GB, of which about 1 GB is the game). So
the import uses an allowlist, matched case-insensitively at the folder's top
level:

| Kind | Files |
|---|---|
| Exe | `gamemd.exe` (Yuri's Revenge), `game.exe` (Red Alert 2) |
| Libraries | `Blowfish.dll` (the host reads the archive key from it: without it the game stops at start, so the import refuses a folder that lacks it) and `binkw32.dll` (a warning if missing) |
| Archives | `*.mix` (but not `*.mix.bak`) |
| Sound | `audio.bag`, `audio.idx`, `audiomd.bag`, `audiomd.idx` |
| Data | `*.ini`, `*.csf`, `*.fnt`, `*.mmx`, `*.map`, `*.mpr`, `*.yrm` |
| Movies | `movies*.mix`, `movmd*.mix`: optional, but the game stops at start if a file is missing, so a skipped archive is replaced with an empty 12-byte archive. Without the real archives, video cutscenes show as black; static loading-screen images are separate game assets. The Import screen shows their size and lets the player skip them; the menu's own movies are in `ra2md.mix`. |
| Saves | `*.sav` at the top level (the game writes `SAVE0001.sav` beside its exe), and `Saved Games/*` of an older layout, if present: offered as "bring your saves" |

A loose `game.fnt` placed at the top of the selected game folder is imported and
read by the game before its MIX archive copy. Font overrides take effect on the
next game start; re-import the folder after adding or replacing the font.

Anything else is skipped. The list lives in `web/src/storage/install.ts` (`classify`);
the dev server serves the same list, so a run from the local folder has what an import
would have given it, and the Import screen can show what it skipped.

## The checks, before copying

1. **Which game.** `gamemd.exe` means Yuri's Revenge, and `game.exe` means
   Red Alert 2. An install with both imports both, sharing their common
   `.mix` files (the expansion needs the base game's).
2. **The right build.** The PE timestamp at `e_lfanew + 8` must match the
   lift's (`RA2_EXE_STAMP`), the same check as `exe_stamp()` in
   `src/linux/main.c`. The page reads it in TypeScript from the first 4 KB of
   the exe. A mismatch is a clear message ("this is not the build the game
   was lifted from") before anything is copied. The expected stamps come
   from the build (`web/public/game/build.json`, written by
   `build-web.sh`).
3. **Space.** `navigator.storage.estimate()` against the sum of the
   allowlisted files. If it won't fit, the page says how much is needed and
   suggests skipping the movies. The page asks for
   `navigator.storage.persist()`, so the browser doesn't evict the copy
   under storage pressure. If the browser refuses, the page says the copy
   may be cleared and would then need importing again.

## The copy

`web/src/storage/opfs.ts`, on the main thread with async OPFS APIs. Each
file is streamed (`file.stream().pipeTo(writable)`), never read whole, so a
280 MB `.mix` doesn't sit in memory. After each file, the manifest records
it with its size and `lastModified`. A reload or Cancel resumes from the
manifest. A file whose size doesn't match is copied again.

## Installations and storage namespaces

Each import creates a persistent numeric installation slot, even when the
same edition or folder was imported before. A folder containing both games
creates one slot with two launch choices. The installation records its
planned editions before copying, so a reload between editions remains
resumable. Use the slot's **Resume import** action for an incomplete copy;
**Import a folder** always creates another slot. Slot IDs are never reused.

New installations use separate namespaces:

```
game/slot-1/                         imported files shared by editions in slot 1
game/slot-1-ra2/mods/                slot 1's RA2 mod data
game/slot-1-ra2md/mods/              slot 1's Yuri mod data
save/slot-1-ra2/                     slot 1's RA2 saves and settings
save/slot-1-ra2md/                   slot 1's Yuri saves and settings
game/slot-2/                         another installation's own files
```

Common files are copied once within an installation. New installations do
not share files based on names, sizes, or timestamps. Saves, mod lists,
mod overlays, and Thai-font preferences use each edition record's storage
namespace. The guest still sees its fixed `/game` filesystem.

IndexedDB database `ra2-web`, schema version 2:

| Store | Key | Value |
|---|---|---|
| `installations` | auto-incremented numeric slot | name, import time, planned editions |
| `installation-games` | `[slot, edition]` | edition metadata, file references, save/mod namespace |
| `settings` | setting name | application settings and namespaced mod lists |

The schema upgrade groups existing v1 RA2/Yuri records into one installation.
Their explicit legacy file references (`game/ra2`, `game/ra2md`) and save/mod
namespaces are preserved. No large OPFS files are moved during the atomic
metadata upgrade. Even a new slot 1 uses `slot-1` namespaces, so an old
removed installation's retained saves cannot become a new import's saves.

Removing an installation deletes both edition records and their imported
files/mods. Exact storage references protect any legacy shared files still
in use. Saved games and settings are retained in their original namespace,
which is never assigned to a later slot.

## Saves

The game writes its saved games beside its exe (`SAVE%04lX.%3s`, so `SAVE0001.sav`), not in a
folder. `saves.ts` copies what the game writes into `save/<edition-storage>/` in OPFS and lays it
back over the imported files at every start. A save that came with the import is a plain
imported file in the slot instead.

The Library card offers "download saves": every `.sav` in `save/<edition-storage>/` (and any in an
older `Saved Games/` folder there), plus the saves that came with the import, zipped under the names
the game keeps them by, so a save can move to the desktop build or another browser. "Import saves"
takes the `.sav` files of such a zip, or a zip of just the files, and puts them in
`save/<edition-storage>/` where the game looks for them.

## Managing files

A Library card is an installation: both games of an import live in it, their shared files in one place
(`game/slot-N/`). When it has two games a picker on the card chooses which one the card shows and
starts (the choice is remembered per installation); Settings, Mods and the saves links follow it.

"Browse files" is one browser for the whole installation: every game's imported files in one list
(a shared file once), and a `Saves` folder with what the games themselves wrote (saved games,
`RA2MD.INI`; not mods or the host's own files), split into a folder per game when there are two.
Mods are separate (`game/<storage>/mods/`, "Mods…") and are not in this browser. The player can:

- **Upload files** into the folder that is open. A file with the name of one already there
  (without regard to case) asks first, then replaces it, keeping the spelling the record has.
  Imported files must be ones the import would take (`classify`, top level only): files the game does
  not read, and `.sav` files outside `Saves`, are refused with the reason. A file goes to every game
  that reads it and is stored once. `Saves/<game>` takes `.sav` files only.
- **Add a game** by uploading its exe (`game.exe`, `gamemd.exe`) to an installation that lacks it. The
  exe must be the build the game was lifted from. The new game shares every file already there that it
  reads, and the page says what else it needs (Yuri's Revenge reads files with `md` in their names).
  An exe of a game the installation has is checked against that game's own record.
- **Delete** files, or a folder with everything in it, after a confirmation that says what it
  means (the game cannot start without its exe, `Blowfish.dll` and archives). A file leaves every
  game's record and leaves OPFS once no game lists it. The `Saves` folders themselves stay.

An imported file is written to `game/<home>/<name>` and each game's record that lists it gets its new
size and time. A file the game wrote since is laid over the imported one at every start, so changing
an imported file also removes that name from that game's `Saves`, or the change would be hidden.
"Resume import" does not bring a deleted file back (a record with every file done is complete): upload
it again.

Nothing can be downloaded or exported from the browser, and the Play screen's live `/game` browser
stays read-only: that file system is in memory and its changes would not last.
