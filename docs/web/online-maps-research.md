# Online maps in Customize Battle: research

Can the page list maps from an online source and download one while the player is on Customize Battle
(dialog `0x6B`), so it shows up in the map list and can be played? This is research only (2026-11-08);
no code was written. The map search it follows is in [map-search-status.md](map-search-status.md).

**Short answer: yes, for Yuri's Revenge, with a same-origin relay and a small C addition.** The
CnCNet map database has the maps and a JSON search, but sends no CORS headers, so the page cannot
read it directly. The game scans for maps once, at start, from a list it never clears, but it reads
the folder with live `FindFirstFile` calls and the dialog walks the list each time it fills, so a map
can be added later. In LAN and WOL the game never sends a map: the joiner must already hold a file
with the host's name and digest.

## 1. Online sources

All checked on 2026-11-08 with `curl` (an `Origin: https://example.org` header) and a page fetch.

| Source | What it offers | Page can fetch (CORS) | Formats | Terms | Size |
|---|---|---|---|---|---|
| CnCNet MapDB 2 (`mapdb2.cncnet.org`, server source [CnCNet/cncnet-map-api](https://github.com/CnCNet/cncnet-map-api), Django) | JSON search `GET /maps/search/?game_slug=yr&search=lake&limit=30&offset=0`; legacy download `GET /yr/<sha1>.zip`; files also under `/silo/yr/maps/<id>/…zip` | No. 200 responses carry no `Access-Control-Allow-Origin`; an `OPTIONS` preflight answers 403. No CORS setting in the server's `kirovy/settings/_base.py` | One `.zip` holding `<sha1>.map` (sample: 186 KB). The `.map` has `[Basic]` (`Name`, `GameMode`, `Official`, `MinPlayer`, `MaxPlayer`) and a `[Digest]` at its end | None stated for the maps. Server code is AGPL-3.0. Uploads come from the CnCNet client automatically (`MapSharer.Upload` in [xna-cncnet-client](https://github.com/CnCNet/xna-cncnet-client)) | `yr`: 28,390 records (`remaining_count` 28,389 with `limit=1`). `ra2`: 0. In a sample of 289 (the first 200 and the last 89) none is published or legacy and every one is `incomplete_upload`; the last 89 are also `is_temporary`, and some are named `legacy_client_upload_<sha1>`. |
| CnCNet MapDB 1 (`mapdb.cncnet.org`, behind Cloudflare, PHP) | Search page with a JS app ("limited to 30 and from the last year"); the same `/yr/<sha1>.zip` download | No ACAO header on the page or the zip | same zip | none stated | tabs TD, RA, D2, TS, YR, DTA (no RA2) |
| C&C Labs ([cnclabs.com](https://www.cnclabs.com/maps/redalert2/yuris-revenge-maps.aspx)) | Browsable list, download page per map | No ACAO on the list page. Download links carry a per-link `?token=`; `robots.txt` disallows `/downloads/file/` and `/api/`; no API or feed | archives (not stated on the list) | "Legal" link only; no per-file licence on the list | 279 YR maps, 12 pages |
| ra2maps.zzattack.org | Plain directory listing (`Red Alert 2/`, `Yuri's Revenge/`, one 1.59 GB `.rar`) | No ACAO | folders and `.rar` | none | about 1.6 GB of YR maps |
| CnCNet forum collection ([topic 3806](https://forums.cncnet.org/topic/3806-ra2-yr-maps-a-ginormous-collection-of-maps/)) | Links to packs on MediaFire, Dropbox, Google Drive | Not a data source | `.zip`/`.rar` | none stated | "1137 unsorted RA2 & YR maps", "3000+ YR Maps" (2015 post) |

What this means:

- **Only MapDB can be driven by a page.** It is the one source with a search API and a direct
  download by hash. The others are web pages, token links or archives.
- **The page needs a relay.** The page is cross-origin isolated (`Cross-Origin-Embedder-Policy:
  require-corp`, [deploy.md](deploy.md)), and a `fetch` to a host without `Access-Control-Allow-Origin`
  fails. A pass-through route on the page's own server (for example `/maps-api/` to
  `mapdb2.cncnet.org`, as `nginx.conf` already does for `/emu/`) fixes that. The better fix is a
  request to CnCNet to add the header: the server code is theirs and MapDB 2.0 is meant to "expose the
  map list, search, details and downloads through an API for game clients" ([project
  page](https://opencollective.com/cncnet/projects/new-map-database-and-browser), still in development).
- **The file name is the SHA1 of the map file.** The CnCNet client downloads
  `<MapDBDownloadURL>/<game>/<sha1>.zip` (`MapSharer.DownloadMain`), so the page can check a
  download against the hash it asked for.
- **Yuri's Revenge only.** MapDB 2 has no `ra2` maps and MapDB 1 has no RA2 tab. Red Alert 2 maps would
  have to come from C&C Labs or the packs, by hand.
- **Nobody states a licence for the maps.** They are fan-made files; the databases moderate by
  removal (MapDB 2.0: staff "hide, edit or remove"). Anonymous client uploads may not be kept ("still
  in debate"). Treat every file as unreviewed content.

## 2. How the game builds its map list

Both games build the list once, in `Session` one-time init, and keep it in a vector that nothing clears.

**Yuri's Revenge** (`gamemd.exe`): `Session` one-time init `0x697AD0` is called at `0x53171C` with
`ecx = 0xA8B238` (the Session object). It calls the scan `0x699980` (its only caller, `0x697AD7`),
which works on the vector at `Session + 0x690` (`0xA8B8C8`; the item array at `0xA8B8CC`, the count at
`0xA8B8D8`):

1. `MISSIONSMD.PKT` (opened by name through the game's file class, so a copy in a MIX or in the folder), its
   `[MultiMaps]` section, each entry's map loaded by `0x69A3B0` (`.MAP`, `Description`, `MinPlayers`,
   `MaxPlayers`, `GameMode`, `Digest`).
2. Every loose `*.PKT` in the game folder (`FindFirstFileA` at `0x699AE6`), the same way.
3. Every loose `*.YRO` (`0x699C58`): a mission pack, opened as a MIX, whose `MISSIONS.YRO` lists its maps.
4. Every loose `*.YRM` (`0x69A002`): one map per file. `0x6994F0` reads only the start of the file
   for `[Basic]` (`Name`, `Official`, `MinPlayers`, `MaxPlayers`, `GameMode`) and the end for
   `[Digest]` (`Digest`; "No Digest" if missing). It then makes the entry with `operator new(0x1BC)`
   (`0x69A101`) and `0x69A980`, and appends it to the vector at `0x69A180`.

There is no `*.MPR` or `*.MAP` scan in Yuri's Revenge: a loose `.map` is listed only if a PKT names it.
(`storage.md` imports loose `.mpr` for both games; for Yuri's Revenge that file is not scanned.)

**Red Alert 2** (`game.exe`): the same shape in `0x670C50` (called once): `MISSIONS.PKT`, `*.PKT`
(`0x670DA7`), `*.MMX` (`0x670F1E`, a map pack) and loose `*.MPR` (`0x6712C3`).

**Reading the list.** A dialog procedure, `0x5E6920`, walks the vector (count `0xA8B8D8`,
items `0xA8B8CC`, from `0x5E6A6C`) to fill list box `0x553` (1363), and the list beside it (`0x6EB`).
It is the procedure that fills the map list; only the list id was matched in the code, not the
dialog id `0x6B`. The game-type change refills it the same way (the status doc:
"the search applies to the new list at once"). The join check in `0x5E3D10` reads the same vector.
Each item is a 0x1BC-byte heap object with the file name at `+0x58` (the join check compares it to the
host's scenario name at `0xA8B8E0`).

**Can it run later?** Not by calling the scan again: it appends without clearing, so every PKT, YRO and
YRM map would be listed twice. Two ways that work:

| Way | What it takes | Notes |
|---|---|---|
| Add one entry | A function in `src/web/` that, for a new `.yrm`, repeats steps 4 above: `new(0x1BC)`, the two lifted calls `0x6994F0` and `0x69A980`, and the vector append (the vector's grow call is the virtual at `+8`) | Small, but it copies private layout; a lift change moves the addresses. Needs a run to confirm the list sorts (or not) the way the others do. |
| Truncate and rescan | Set the count `0xA8B8D8` to 0 (leaking the old entries), then call `0x699980` | Smaller code, but reloads every map (the `MultiMaps` loads read MIXes), and the `.PKT`/`.YRO` pass runs again. |

Either runs on the game's thread, in the presenter pump like `web_map_search_pump` (`presenter.c`),
not from the page. The dialog shows the new item the next time it fills: on opening, and on a
game-type change. Making it appear at once means asking the dialog to refill (not checked).

## 3. Where a downloaded file goes

- **The game's folder is live.** pcrecomp's `FindFirstFileA` (`runtime/win32hle/kernel32_ext.c:490`)
  calls `opendir` on `/game` when asked, so a file written there before the scan runs is found.
- **The page already writes to `/game`.** `web/src/game/loader.ts` does `fs.writeFile("/game/…")` for
  the exe, the ini, the Thai font and mod files (lines 156, 268, 467). Files under 1 MiB are plain
  memory files there; only big ones are links into OPFS (storage.md, "How the game reads its files").
  A map is 50 to 300 KB, so it is a memory file.
- **Writing while the game runs is not checked.** The page reads the running game's folder (the save
  watcher's `fs.readdir` every few hundred ms, `saves.ts:212,365`); nothing writes a new file into it
  mid-game today. The game runs on its own thread (`PROXY_TO_PTHREAD`, toolchain.md), so the safe
  route is the one the net packets use (`ra2_net_packet` in `src/web/main.c`): the page copies the bytes into a
  buffer the game exports, and C writes the file on the game's thread.
- **It must survive a reload.** `/game` is rebuilt at every start from OPFS. A downloaded map needs a
  home like the saves': `save/<storage>/maps/`, laid back over `/game` at start (as `saves.ts`
  restores saves). Then the start-up scan lists it with no rescan, and the rescan above is only for
  the first time, in the same session.
- **Naming.** MapDB gives `<sha1>.map`. For Yuri's Revenge the file must be `*.yrm`, so the page
  renames it: `<sha1>.yrm`. A commenter in the forum thread above says `.yrm` and `.map` are the same file
  renamed, and the game's reader looks only at `[Basic]` and `[Digest]`, both of which the sample has.
  Not yet tried in the game.

## 4. Multiplayer

The game does not send maps. In LAN and WOL games the host sends the scenario file name and its digest
(`0xA8B8E0` and `0xA8BAE2`). The joiner's `0x5E3D10` (netshare.cpp) looks the name up in its own vector
(`stricmp` against the item at `+0x58`), opens that file, reads its `[Digest]` and compares. If either
is missing or different it logs "Not same scenario" and shows `GUI:JoinerNoMap` (`0x5E55CA`). There is
no transfer code in that path.

What the page would have to do for a joiner:

1. Learn the host's file name and digest when the check fails: a hook at the `GUI:JoinerNoMap` branch
   (`0x5E55B9`), reading `0xA8B8E0` and `0xA8BAE2`, sent to the page as an event.
2. Find the file. MapDB is keyed by the SHA1 of the file, not by the game's `[Digest]` or file name, so
   a name that is not a hash cannot be looked up. If every download is saved as `<sha1>.yrm`, two
   players who both fetched through the page have the same name, and a host who picked a hand-copied
   `lake.yrm` cannot be matched. Only a name that is 40 hex digits plus `.yrm` can be fetched by the joiner.
3. Download, add the map (section 3), and re-run the lookup; the lobby then needs the player to unready and
   ready again (not checked).

So online maps work for solo play on any map, and in multiplayer only between players who got the map
through the same naming. A joiner with a different file gets the game's own message.

## 5. The UI: overlay or the game's list

| | Page overlay (like `MapSearchStatus.tsx`) | Entries in the game's list |
|---|---|---|
| What the player sees | A button and a panel the page draws over Customize Battle: search box, results, DOWNLOAD | The map appears in list `1363` after the download, searchable with the existing box |
| Search and results | Plain React, fetch and pagination are easy; thumbnails: MapDB records carry an `images` list, empty in the sample | The game's list has no place for "not downloaded" entries |
| Cost | Page work; reuses the pointer routing that already exists for `mapSearch` (`pictureRect()`, the placed label) | A C function per entry, and the dialog refill |
| Risk | Mouse and keys go to the page while it is open; the game's own screen must be inert (the page already gates input for its dialogs) | A bad entry stops the game (the status doc: an empty or renumbered list did) |

They are not alternatives: the overlay finds and downloads, and the game's list is where the map ends up.
Listing remote maps as entries in the game's list is not worth doing (a fake entry that downloads on Use Map
would run inside the game's own click handling and block on the network).

## Recommended approach

1. **Relay** (about a day). A pass-through route for MapDB 2's search and the `/yr/<sha1>.zip` download on
   the page's server, with a size cap, a short cache and no storing; and ask CnCNet in parallel to add
   `Access-Control-Allow-Origin` on `mapdb2.cncnet.org`, which removes it.
2. **Page panel** (about two days). A "Get maps" button and a Radix dialog opened over Customize Battle
   by an event from `map_search.c` (the screen is already tracked there). Search box, pages of results,
   DOWNLOAD. Unzip (7z-wasm already opens zips) and check the SHA1 against the file name.
3. **Store and name** (about a day). Save `<sha1>.yrm` to `save/<storage>/maps/`, restore it with the saves at start; add a
   "Downloaded maps" line in the Game screen's file list with REMOVE.
4. **Game side** (two to three days). An exported buffer and a C function on the game's pump that writes the
   file into `/game` and adds the entry (section 2, first row), then a dialog refill. Test with
   `testmap.yrm` and a MapDB map first, before any page work.
5. **Multiplayer** (two days, last). The `GUI:JoinerNoMap` hook and fetch-by-name for `<sha1>.yrm` names.

Rough total: one to one and a half weeks for Yuri's Revenge, solo and hash-named multiplayer. Red Alert 2
is a separate, smaller job with no database behind it.

## Risks

- **Content.** Unreviewed fan files, no licence, some with unfit names. A map is an INI file that
  can carry its own sections for rules, so an unreviewed one can change the rules or crash the game. The project's rule is
  that nothing generated from the game is distributed ([deploy.md](deploy.md)); maps are not generated
  from it, but a relay that stores them would make the project a mirror, so it stays pass-through.
- **CnCNet's terms.** No terms or rate limit are published for the API. The plan above makes the same
  request as the official client; it needs their agreement before it ships.
- **Brittle C.** The addition copies the entry layout and addresses of Yuri's Revenge; a re-lift must
  keep them (the same exposure as `map_search.c` has with the list box).
- **Sorting and filters.** Not known whether the list sorts or filters by `GameMode`; a map with a mode the
  game type does not match will not show.
- **Digest.** Maps without `[Digest]` are listed as "No Digest" and cannot match a host's (section 4).

## Prototype result

Tried on 8 November 2026 in a separate worktree (branch `claude/online-maps-prototype`, Yuri's Revenge, a
fast `-O1` build). `src/web/map_search.c` got `ra2_maps_rescan(truncate)` and `ra2_maps_dump()`: the first
sets a flag that the presenter's pump takes on the game thread, which then (optionally) sets the vector's
count to 0 and calls `0x699980` with ecx = Session. `web/e2e/maps-rescan.mjs` drives it in headless Chrome:

1. The skirmish setup screen is open with 162 maps in the vector (`testmap.yrm`, a FinalAlert map the folder
   already held, is the last and does list).
2. From the page's main thread, `Module.FS.writeFile("/game/protodl.yrm", ...)` writes a copy of that map
   with a new `Name=`. The write works while the game runs.
3. `ra2_maps_rescan(1)` takes the vector from 162 to 163 maps; the new file is the last entry.
4. Customize Battle, opened after that, lists "ZZ Proto Download" (the search box finds it) and shows its
   preview. Use Map and Start Game load it and play it at 62 frames a second.

### Second step: the whole path, in the page (8 to 9 November 2026)

Branch `claude/online-maps`, checked in headless Chrome with a real MapDB map and the game folder served
from the Yuri's Revenge install (`web/e2e/maps-download.mjs`; `?mute`).

- **Relay.** `vite.config.ts` forwards `/maps-api/` to `https://mapdb2.cncnet.org` (`server.proxy`, dev server
  only). Search (`/maps/search/?game_slug=yr&search=…`) and `/yr/<sha1>.zip` both answer 200 through it. A
  release needs the same route on the real host (the `nginx.conf` `/emu/` block is the model), a cache, a size
  limit on the body, and a decision on whether CnCNet is happy to be proxied; the better fix is CORS on their side.
- **Panel.** `MapDownloadPanel`: search box, result list, DOWNLOAD. Results carry an UNREVIEWED tag when MapDB
  marks the upload incomplete or temporary. It opens from the game's own Find Maps button (third step below).
- **Download.** `src/game/mapdb.ts` fetches the zip (stored or deflate, read by hand: it holds one file), checks
  the file's SHA1 against the name in the URL, and refuses more than 8 MiB.
- **MapDB data.** Every record the search returned was `incomplete_upload` and `is_temporary`, and none was
  published or reviewed, but the legacy `/yr/<sha1>.zip` download works for them, and the zip's contents hash to
  the name. The search's own file URLs are `http://` on the same host: the relay uses the `/yr/` route instead.
- **Into the game.** The page writes `/game/<sha1>.yrm` (`GameHandle.writeGameFile`), calls
  `ra2_maps_rescan(1)`, and the game thread rescans. "Dustbowl Battleground v2.0 (MNR) by Matty K" (a real map,
  8 players) then lists under Battle, the search box in the game finds it, and the preview shows. Use Map and Start
  Game start a match on it (the Yuri HUD and credits come up).
- **A screen that is already open.** After the rescan the C side posts `WM_COMMAND` with `LBN_SELCHANGE` of the
  game type list (id 0x6EB) to the dialog, which rebuilds list 1363 from the vector (`0x5E6B78`). The first try
  sent id 0x583, which is the Random Map button, and opened the map generator: the id matters. The refill resets
  the highlight to the first map. That refill worked once only: see the third step.
- **Kept across a reload.** `src/storage/downloaded-maps.ts` keeps each map in OPFS under
  `downloaded-maps/yr/<sha1>.yrm`, and the loader writes them into `/game` before the game starts (before its one
  scan). Checked: download in one run, close the browser, open a new page on the same profile, and the map is
  listed with no download. They belong to the origin, not to an install.
- **Search in the game.** The list shows the map's `[Basic] Name`, not MapDB's title, so "matty k" finds the map
  above and "mattyk" does not.

Not done or not checked: the 40-character file name works but name length
at `+0x58` was not pushed further; duplicates by digest; multiplayer (a joiner needs the same file name and digest,
which `<sha1>.yrm` gives only to players who both used the panel); Red Alert 2; deleting a kept map (the store has
`removeDownloadedMap`, no UI); a release build (the relay, `nginx.conf`, the service worker, quota); and the
list refill is a posted message, so it lands on the game's next message pump, not instantly. The unit tests for
`mapdb.ts` pass; the page's other tests were not run here (`jsdom` was missing from this machine's
`node_modules`).

### Third step: the preview freeze, and a button in the game (9 November 2026)

The match on a downloaded map draws it: a screenshot 25 seconds in shows terrain, units and buildings (the black is shroud),
which settles the doubt left by the second step.

- **The freeze.** After a second download, clicking maps moved the highlight but the preview picture stayed on
  the old map, until the player left and re-entered Customize Battle. Cause: the game type handler (`0x5E6B78`)
  returns at once when the picked game type is the one it last filled the list for (the global `0x8316FC`). The
  first refill ran only because that global differed; every later one did nothing, so list 1363 kept item pointers
  to the scan before. The map-changed routine (`0x5E66F0`) looks the picked item up in the vector, finds nothing,
  and skips the preview without a sound. Fix: set `0x8316FC` to -1 before posting the refill (and pass the game
  type list as `lParam`, as Windows does). `web/e2e/maps-freeze.mjs` rescans twice and downloads two maps, then
  checks that the picture changes with the picked map. Before the fix it fails after two rescans.
- **The button.** Customize Battle (`0x6B`, Yuri's Revenge only) gets a copy of the Random Map button (id
  `0x583`, owner-drawn) with id `0x7FFD` one row below it, on the next empty plate (`ra2_map_dialog_button` in
  `src/web/map_dialog.c`, added by the same template swap as the search box). The game draws it as one of its own
  buttons, and on the red plate, though that took finding what decides it. The game lays a screen out in `0x60C0C0`,
  one control at a time, and asks `0x608CD0` whether the screen's id table knows it. The table is code: per screen,
  a list of control ids (Customize Battle, `0x6B`: Random Map `0x583` and Use Map `0x6C5`). A known control goes to
  the button layout (`0x60B000`: 156x42, at x=644, flush with the screen's right edge, and its plate object); any
  other goes to the generic layout and is drawn on a flat grey plate. So the template makes the Find Maps button
  with Random Map's id (`0x583`, the second control with it); once the game has made the screen, the pump
  (`find_button_settle` in `map_search.c`) gives it its own id (`0x7FFD`; the game reads a control's id when it
  is pressed, not before, so a press reaches the dialog as `0x7FFD` and not as Random Map) and puts it under
  Random Map. That needs three small calls in pcrecomp's user32: `hle_dialog_item_nth`, `hle_set_control_id`,
  `hle_move_window`. What did not change the plate, and was reverted: the button's place in the template;
  enlarging the game's own resource entry for `0x6B` (636 to 716 bytes); the game's window-keyed tables, which
  already held the button (`0xAC1B48`, read by the draw procedure `0x612B70`, and the button objects at `0xAC1B00`,
  `0x208` bytes with the next at `+0x204`; the object differs from Use Map's only in `+0xB4` and per-button
  pointers, and setting `+0xB4` did nothing); and giving the button Random Map's size and column by hand after
  the layout. (vera20k, a Rust rewrite, draws this shell from the game's own art with its own code; its notes on
  these addresses were what pointed at the tables.) `web/e2e/maps-button.mjs` checks the press, and the screen
  was checked reopened. Its text is the game's own label `GUI:Find` ("Find", in the player's language): a label the table does
  not have shows as `MISSING:'…'`. A press reaches the dialog as `WM_COMMAND`; `map_search.c` sees it through the
  proc hook (script.c's `watch`) and sends the page `mapFinder`, which opens the panel. The hook sees a message at
  every procedure that passes it along, so one press arrives four times: the C side takes the first and ignores
  repeats for 300 ms. `web/e2e/maps-button.mjs` checks one press is one event.
- **A screen of the game's own (prototype, `-DRA2_FINDER_NATIVE=ON`; `src/web/finder_screen.c`).** The Find
  button can open a whole new screen that the game draws as one of its own. The game builds a shell screen in
  steps: a dialog from a resource (`0x775700`), then the screen set-up `0x622820` (ecx = the dialog, edx = its
  resource id), which registers the dialog and its controls for the game's drawing, loads the screen's
  background, lays the controls out (`0x60C0C0`, with the per-screen id table above) and gives its buttons their
  plates. The screen's procedure hands every message to the shell's common handler `0x622B50` first, and the
  game's screen loop (`0x7759E0`) sends it `0x4A9` as it starts. The prototype does the same from the host: a
  template built in C (533 x 369 units, like the map screens'), a dialog procedure that is a host function (a
  user32 shim registered with `win32hle_register`, called as a guest procedure is), `CreateDialogIndirectParamA`,
  then `0x622820` with Customize Battle's id (`0x6B`) and its control ids (Use Map `0x6C5`, Random Map `0x583`,
  Cancel `0x5C0`, the map list `1363`), every message through `0x622B50`, and `0x4A9`. The game then draws the
  screen's background, its header title, red plates on Search, Add and Back, and frames on the search box and
  the list; Back (the host proc sees the `WM_COMMAND`) destroys the screen, shows Customize Battle again and
  puts the game's current-screen global (`0xAC48A8`) back, and Customize Battle comes back whole.
  `web/e2e/finder-screen.mjs` checks it. Texts must be existing labels (`GUI:Search`, `GUI:Add`, `GUI:Back`,
  `GUI:ChooseMap`, `GUI:GameMap`): any other shows as `MISSING:'...'`. What did not work: the **list's rows**. The
  game's list handler (`0x618D40`) answers `LB_ADDSTRING` on the screen's list with `-1` without calling the
  original list (an import trace shows only window-rect calls), and rows put in the host's list directly
  (`hle_list_add`, before or after the set-up, with strings or with map-shaped data objects) are not drawn.
  What a screen's own procedure gives its lists, which makes the handler take rows, is not found; the next place
  to look is the first message the real procedures answer for a list (Customize Battle's `0x5E6920`, Generate
  Map's `0x596300`). Also not done: the search box's text, the buttons' actions beyond Back, and the page's
  results. The default build is unchanged: Find opens the page's panel.
- **Restyled.** The panel is inside `GameDialogChrome` (the link dialogs' frame, title strip and red plates), with a
  dark list well and yellow text like the game's lists. It is still a page panel, not a game screen.
- **A screen of the game's own.** Not done, and not possible from the host alone. A game screen is a dialog template
  plus the game's own procedure, which is lifted code. The host can edit a template or swap it for a screen the game
  already opens, and watch or send messages, but it has no way to add a procedure, so there is nothing to run a new
  screen. What can be done in the game: (a) keep this panel but dress it as a game screen (the link dialogs'
  `GameDialogChrome` art); (b) turn Customize Battle's own list and search box into the finder while it is on
  (list rows and Download from the host, the way `hle_list_filter` already changes what the list shows). The map
  preview and Use Map would not apply to a map that is not on disk yet, and the game's paint code for the list was
  not read for what it does with a row it did not make.

## Open questions

- Does a MapDB `.map` renamed to `.yrm` list and start? (`testmap.yrm` does; run the sample `<sha1>.map`.)
- The scan reads the keys `MinPlayers` and `MaxPlayers`; the sample map has `MinPlayer` and `MaxPlayer`. What
  shows in the list when they differ?
- Does a write into `/game` from the page reach the scan when the file is large? A small one does (see Prototype result).
- Is the file name buffer at `+0x58` long enough for `<40 hex>.yrm`?
- Will CnCNet add CORS to `mapdb2.cncnet.org`, and allow third-party pages to use it?
- Does the lobby recheck the joiner's map after a late download, or must the player leave and rejoin?
- What does the list do with a map it already has under another name (same `[Digest]`)?
