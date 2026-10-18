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
| Data | `*.ini`, `*.csf`, `*.mmx`, `*.map`, `*.mpr`, `*.yrm` |
| Movies | `movies*.mix`, `movmd*.mix`: optional, but the game stops at start if the file is missing, so a movie archive the player skips is written as an empty 12-byte archive instead. The Import screen shows their size and lets the player skip them (the default, until movies play: stage 8) |
| Saves | `Saved Games/*` if present, offered as "bring your saves" |

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

## The layout in OPFS

```
/game/
  ra2md/            Yuri's Revenge: its own files, and the shared ones
  ra2/              Red Alert 2
/save/
  ra2md/            the game's writes: Saved Games, RA2MD.INI, DEBUG.LOG
  ra2/
```

The game sees one folder as `C:\` ([architecture.md](architecture.md)).
At start the page copies `/game/<id>` into the game's in-memory file system and puts `/save/<id>` over it;
what the game then writes is copied back to `/save/<id>` (decisions.md, D11).
Removing a game deletes `/game/<id>` and keeps `/save/<id>` unless the
player asks. On Linux, the mods layer (`src/linux/mods.c`) does the same job
of laying one folder over another, so it's reused where it fits.

The shared files are stored once, under `ra2md`, and `ra2` reads them from
there. The manifest records which game needs which file, so removing one game
keeps the files the other still needs.

## The manifest and the page's settings

IndexedDB, database `ra2-web`:

| Store | Key | Value |
|---|---|---|
| `games` | `ra2md`, `ra2` | `{ title, exeStamp, importedAt, bytes, files: { name: { size, lastModified, done } } }` |
| `settings` | setting name | its value ([frontend.md](frontend.md), Settings) |

The game's own settings stay in its own files (`RA2MD.INI`, `ra2.ini` for
the host's presenter settings), under `/save`, as on the other platforms.

## Exporting saves

The Library card offers "download saves": `/save/<id>/Saved Games` zipped in
the page and handed to the player, so a save can move to the desktop build
or another browser. Importing saves comes from the same allowlist entry.
