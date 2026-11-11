# Handoff: a map preview in the native finder screen

Written 2026-11-11. Nothing below is implemented yet: the research is done, the code is not written.
The worktree is clean at `47e6240e` (branch `claude/online-maps`) apart from the untracked `build-proto2/`,
`dev.err` and `web/e2e/finder-try.mjs`.

## What was asked

> when select a map it should like show preview too, (it may download to temp and preserve when add)

In the game-drawn finder (`src/web/finder_screen.c`, built with `-DRA2_FINDER_NATIVE=ON`): picking a row in the
result list shows that map's preview in the top-right panel, as Customize Battle does. The map is downloaded
when it is picked, and the same bytes are used if the player then presses Add (no second download).

## How it works (the design)

1. **C, game thread.** Every pump, `follow_pick()` reads the list's picked row. When the picked map changes it
   forgets the old preview and sends the page `{"e":"mapFinderPreview","sha1":"<sha1>"}` (`""` = nothing picked).
2. **Page.** `NativeMapFinder` waits 250 ms (so arrowing down the list does not download every row), downloads
   the map through a small keep of downloads (a `Map<sha1, Promise<bytes>>`, the last 4), writes the bytes to
   the game's folder as `fp<seq>.tmp`, and calls `ra2_finder_preview(sha1, "fp<seq>.tmp")`.
   Add takes its bytes from the same keep, so a previewed map is not downloaded twice.
3. **C, game thread.** The pump takes that, and if the map is still the picked one it has the game's own
   preview code read the file (the code Customize Battle uses), removes the file, and asks for a repaint.
   The finder's `WM_PAINT` then draws the preview into control `0x468`.

A `.tmp` name is never listed as a map (the scan looks for map extensions), and the map scan is already held
while the finder is up (`map_search.c`).

### The game's preview code (Yuri's Revenge, `gamemd.exe`)

Found by reading Customize Battle's procedure `0x5E6920` and its loop callback `0x5E66F0`.

| Address | What | Call |
| --- | --- | --- |
| `0x7C8E17` | `operator new` | cdecl (bytes) |
| `0x7C8B3D` | `delete` | cdecl (pointer) |
| `0x6406E0` | preview object: constructor (the object is 4 bytes: `[0]` = its picture) | thiscall, no args |
| `0x6406F0` | preview object: lets its picture go | thiscall, no args |
| `0x641EE0` | load: opens the named file in the game's folder, reads it as an INI, reads `[Header]` start positions into the global scenario, builds the picture | thiscall (file name) |
| `0x640710` | draw: scales the picture into `GetDlgItem(dialog, 0x468)` and draws the start markers; does nothing when `[0]` is 0 | thiscall (dialog hwnd) |
| `0x607FD0` | what a screen's `WM_PAINT` ends with (shows what was drawn) | ecx = dialog |
| `0xAC0D30` | Customize Battle: the map-vector index its preview was last loaded for | data; set to `0xFFFFFFFF` to make it load again |

Customize Battle's `WM_PAINT` (at `0x5E696B`): `0x621E90(hwnd)` paint; `0x640710(preview, hwnd)`; `0x607FD0(hwnd)`;
`ValidateRect`. The shell's common handler `0x622B50`, which the finder's procedure already calls first, does the
paint and the `ValidateRect` but not `0x607FD0`.

The preview control in Customize Battle's template (dialog `0x6B`): id `0x468`, class Static (`0x82`),
exStyle `0x20`, style `0x50000004`, rect `428, 23, 96, 69` (dialog units).

## The tasks

A and B touch different files and can run at the same time. C needs both. D is the review; E the commit.
Each of A, B, C is written to be given to a small model as it stands.

Rules for every task: work only in
`C:\Users\Norrapat\projects\redalert2-recomp\.claude\worktrees\online-maps`; `cd` into it in every shell call;
no commit, no push, no stash, no reset, no branch switch; touch only the files the task names.

---

### Task A — `src/web/finder_screen.c` (C side)

Edit only `src/web/finder_screen.c`. Apply these changes exactly; do not build.

**A1.** In the header comment, before the closing ` (mapFinderAdd), and shows what the page answers … */`
paragraph ends, add after it (keep it inside the comment, i.e. move the `*/`):

```c
 *
 * A picked row shows the map's preview where Customize Battle shows one (control 0x468): the screen tells the page which
 * map is picked (mapFinderPreview), the page puts the map's file in the game's folder and says so (ra2_finder_preview), and
 * the game's own preview code reads that file and draws it. */
```

**A2.** Add `#include <emscripten.h>` to the include block at the top (after `#include <stdint.h>`), and delete
the later line `#include <emscripten.h>` that sits just above `ra2_finder_results`.

**A3.** After `#define WM_COMMAND 0x0111u` add:

```c
#define WM_PAINT 0x000Fu
```

**A4.** In the `enum`, add `PREVIEW_ID = 0x468` as a last member.

**A5.** Replace the function `item` with:

```c
static void item_ex(uint32_t id, uint16_t cls, const char *text, int x, int y, int cx, int cy, uint32_t style, uint32_t ex) {
    while (g_at & 3) g_tmpl[g_at++] = 0;
    w32(0), w32(ex), w32(style);
    w16((uint16_t)x), w16((uint16_t)y), w16((uint16_t)cx), w16((uint16_t)cy);
    w32(id);
    w16(0xFFFF), w16(cls);
    wstr(text);
    w16(0);
}
static void item(uint32_t id, uint16_t cls, const char *text, int x, int y, int cx, int cy, uint32_t style) {
    item_ex(id, cls, text, x, y, cx, cy, style, 0);
}
```

**A6.** In `build_template`: change the item count `w16(8), w16(0), w16(0), w16(533), w16(369);` to start with
`w16(9)`, and after the `item(TITLE_ID, …)` line add:

```c
    item_ex(PREVIEW_ID, 0x82, "", 428, 23, 96, 69, 0x50000004u, 0x20u);   /* Customize Battle's preview control, as its template has it */
```

**A7.** Just above the comment `/* The dialog procedure, as a host function: …`, add:

```c
static void preview_paint(uint32_t dialog);
static void preview_load(const char *file);
static void preview_clear(void);
```

and in `finder_proc`, after the `else if (message == WM_COMMAND) { … }` block and before `RET(result, 4);`, add:

```c
    else if (message == WM_PAINT) preview_paint(hwnd);   /* over what the common handler painted */
```

(It continues the `if … else if` chain.)

**A8.** After the line `static char g_note[96];` add:

```c
static char g_picked[SHA1_CHARS + 1];   /* the picked row's map; "" when none is */
```

and in `show_rows`, replace `list_add(list, text, (uint32_t)(i + 1));` with:

```c
        int at = list_add(list, text, (uint32_t)(i + 1));
        if (at >= 0 && g_picked[0] && !strcmp(g_rows[i].sha1, g_picked)) hle_send(list, LB_SETCURSEL, (uint32_t)at, 0);
```

**A9.** In the "from the page" section: change the two declarations to

```c
static char g_in_results[MAX_ROWS * 160], g_in_note[96], g_in_added[SHA1_CHARS + 1];
static char g_in_preview[SHA1_CHARS + 1], g_in_preview_file[32];
static volatile int g_in_flags;   /* 1 results, 2 note, 4 added, 8 add failed, 16 preview; the page writes, the pump takes */
```

and after the function `ra2_finder_added` add:

```c
static void remove_game_file(const char *name) {
    char path[64];
    snprintf(path, sizeof path, "/game/%s", name);
    remove(path);
}
/* The map `sha1` is in the game's folder as `file`, for its preview. The file is ours to remove. */
EMSCRIPTEN_KEEPALIVE void ra2_finder_preview(const char *sha1, const char *file) {
    char dropped[sizeof g_in_preview_file] = "";
    lock();
    if (g_in_flags & 16) memcpy(dropped, g_in_preview_file, sizeof dropped);   /* one the pump never took */
    snprintf(g_in_preview, sizeof g_in_preview, "%s", sha1 ? sha1 : "");
    snprintf(g_in_preview_file, sizeof g_in_preview_file, "%s", file ? file : "");
    g_in_flags |= 16;
    unlock();
    if (dropped[0] && strcmp(dropped, g_in_preview_file)) remove_game_file(dropped);
}
/* A preview file the page sent that nothing will read (the screen closed). */
static void preview_drop_pending(void) {
    char file[sizeof g_in_preview_file] = "";
    lock();
    if (g_in_flags & 16) memcpy(file, g_in_preview_file, sizeof file), g_in_flags &= ~16;
    unlock();
    if (file[0]) remove_game_file(file);
}
```

**A10.** In `take_from_page`: declare two more locals, copy them under the lock, and change the end:

```c
    char note[sizeof g_in_note], added[sizeof g_in_added], preview[sizeof g_in_preview], file[sizeof g_in_preview_file];
    …
    memcpy(added, g_in_added, sizeof added);
    memcpy(preview, g_in_preview, sizeof preview);
    memcpy(file, g_in_preview_file, sizeof file);
    unlock();
    …
    if (flags & ~16) show_rows();          /* was: show_rows(); */
    if ((flags & 16) && file[0]) {
        if (!strcmp(preview, g_picked)) preview_load(file);   /* still the picked map */
        remove_game_file(file);
    }
```

**A11.** After the function `send_event` (the "to the page" section), add this new section:

```c
/* ---- the preview: the game's own, as Customize Battle shows one ------------------------------------------------------
 * The game's preview is an object of 4 bytes (its picture) that reads a map file by name (which also reads the map's start
 * positions into the scenario) and draws itself into the dialog's control 0x468. */
#define PREVIEW_INIT_VA 0x006406E0u    /* ecx = the object */
#define PREVIEW_FREE_VA 0x006406F0u    /* ecx = the object: lets its picture go */
#define PREVIEW_LOAD_VA 0x00641EE0u    /* ecx = the object, (file name) */
#define PREVIEW_DRAW_VA 0x00640710u    /* ecx = the object, (dialog) */
#define SCREEN_SHOW_VA 0x00607FD0u     /* ecx = the dialog: what a screen's WM_PAINT ends with */
#define GAME_NEW_VA 0x007C8E17u        /* cdecl (bytes) */
#define GAME_DELETE_VA 0x007C8B3Du     /* cdecl (pointer) */
#define MAP_SCREEN_PREVIEWED_VA 0x00AC0D30u   /* Customize Battle: the map its own preview was last loaded for */

static uint32_t g_preview;

static uint32_t call_this(uint32_t va, uint32_t self, int nargs, const uint32_t *args) {
    uint32_t keep = g_ecx;
    g_ecx = self;
    uint32_t r = hle_call_guest(va, nargs, args);
    g_ecx = keep;
    return r;
}

static void repaint(void) {
    if (g_screen) hle_call_guest(hle_resolve("InvalidateRect"), 3, (uint32_t[]){ g_screen, 0, 0 });
}

static void preview_clear(void) {
    if (!g_preview) return;
    call_this(PREVIEW_FREE_VA, g_preview, 0, NULL);
    hle_call_guest(GAME_DELETE_VA, 1, &g_preview);
    g_preview = 0;
    repaint();
}

static void preview_load(const char *file) {
    preview_clear();
    uint32_t bytes = 4, name = (uint32_t)(uintptr_t)file;
    uint32_t made = hle_call_guest(GAME_NEW_VA, 1, &bytes);
    if (!made) return;
    call_this(PREVIEW_INIT_VA, made, 0, NULL);
    g_preview = made;
    double began = emscripten_get_now();
    call_this(PREVIEW_LOAD_VA, g_preview, 1, &name);
    fprintf(stderr, "[finder] preview of %s: %s, %.0f ms\n", file, MEM32(g_preview) ? "a picture" : "none",
            emscripten_get_now() - began);
    repaint();
}

static void preview_paint(uint32_t dialog) {
    if (!g_preview || !MEM32(g_preview)) return;
    call_this(PREVIEW_DRAW_VA, g_preview, 1, &dialog);
    call_this(SCREEN_SHOW_VA, dialog, 0, NULL);
}

/* The picked row changed: its preview is asked of the page ("" stops it fetching). */
static void follow_pick(void) {
    uint32_t list = hle_dialog_item(g_screen, LIST_ID);
    const char *sha1 = "";
    int at = list ? (int)hle_send(list, LB_GETCURSEL, 0, 0) : -1;
    if (at >= 0) {
        uint32_t data = hle_send(list, LB_GETITEMDATA, (uint32_t)at, 0);
        if (data && data <= (uint32_t)g_nrows) sha1 = g_rows[data - 1].sha1;
    }
    if (!strcmp(sha1, g_picked)) return;
    snprintf(g_picked, sizeof g_picked, "%s", sha1);
    preview_clear();
    send_event("mapFinderPreview", "sha1", g_picked);
}
```

(`hle_call_guest` is `uint32_t hle_call_guest(uint32_t va, int nargs, const uint32_t *args)`, in `pcrecomp`'s
`win32hle.h`; it saves and restores the registers, so cdecl and stdcall targets both work.)

**A12.** In `open_now`, change `g_box = 0, g_nrows = 0;` to `g_box = 0, g_nrows = 0, g_picked[0] = 0;`.

**A13.** In `close_now`, after the line `g_screen = 0, g_close_request = 0;` add:

```c
    preview_clear();
    if (g_picked[0]) g_picked[0] = 0, send_event("mapFinderPreview", "sha1", "");
    preview_drop_pending();
    MEM32(MAP_SCREEN_PREVIEWED_VA) = 0xFFFFFFFFu;   /* ours read another map's start positions: Customize Battle loads its own again */
```

**A14.** In `web_finder_screen_pump`: replace `if (!g_screen) return;` with

```c
    if (!g_screen) {
        if (g_in_flags & 16) preview_drop_pending();   /* the page answered after the screen closed */
        return;
    }
```

and add `follow_pick();` as the function's last statement (after the `g_add_request` line).

Done when: every step is applied, the file still ends with `#endif`, and `git diff --stat` shows only
`src/web/finder_screen.c`. Report the diff stat and anything that did not match.

---

### Task B — the page (`web/src`)

Edit only these files: `web/src/game/protocol.ts`, `web/src/game/protocol.test.ts`, `web/src/game/store.ts`,
`web/src/game/store.test.ts`, `web/src/components/NativeMapFinder.tsx`,
`web/src/components/NativeMapFinder.test.ts`, `web/src/screens/Play.tsx`.

**B1. `protocol.ts`.**
- In the event union, after `| { e: "mapFinderAdd"; sha1: string }` add
  `| { e: "mapFinderPreview"; sha1: string }`.
- In the parser, after the `case "mapFinderAdd":` case add:
  ```ts
  case "mapFinderPreview":
    return typeof value.sha1 === "string" ? { e: "mapFinderPreview", sha1: value.sha1 } : null;
  ```
- In `Ra2Exports`, after `ra2_finder_added(sha1: string, added: number): void;` add (with a doc comment in the
  style of its neighbours): `ra2_finder_preview(sha1: string, file: string): void;` — "the map is in the game's
  folder as `file`, for the finder's preview; the game removes the file".
- In `EXPORT_SIGNATURES`, after the `ra2_finder_added` line add
  `ra2_finder_preview: { returns: null, args: ["string", "string"] },`.

**B2. `store.ts`.** The preview ask gets a field of its own. It must not share `mapFinderCommand`: a new search
empties the list, so the game sends `mapFinderSearch` and `mapFinderPreview ""` in the same tick, and one would
overwrite the other.
- In the state type, after `mapFinderCommand`:
  ```ts
  /** the native finder screen's picked map ("" for none), for its preview; `seq` makes each ask a new value */
  mapFinderPreview: { seq: number; sha1: string } | null;
  ```
- Initial state: `mapFinderPreview: null,`.
- In the event switch, after `case "mapFinderAdd":`:
  ```ts
  case "mapFinderPreview":
    this.set({
      mapFinderPreview: { seq: (this.state.mapFinderPreview?.seq ?? 0) + 1, sha1: event.sha1 },
    });
    return;
  ```

**B3. `Play.tsx`.** Next to `const mapFinderCommand = useGameState((s) => s.mapFinderCommand);` add
`const mapFinderPreview = useGameState((s) => s.mapFinderPreview);` and pass it:
`<NativeMapFinder game={handle.current} command={mapFinderCommand} preview={mapFinderPreview} />`.

**B4. `NativeMapFinder.tsx`.**
- Export a helper (so it can be tested without React):
  ```ts
  /** How long a picked row waits before its map is downloaded for the preview (arrowing down the list picks every row). */
  const PREVIEW_DELAY_MS = 250;
  /** How many downloaded maps are kept for Add (the largest map is 8 MB). */
  const KEPT_DOWNLOADS = 4;

  /**
   * Downloads kept by hash: asking for the same map again, while it downloads or after, gives the same bytes.
   * A failed download is forgotten, so it can be tried again; so is the oldest once more than `limit` are kept.
   */
  export function keptDownloads(
    download: (sha1: string) => Promise<Uint8Array>,
    limit = KEPT_DOWNLOADS,
  ): (sha1: string) => Promise<Uint8Array> {
    const kept = new Map<string, Promise<Uint8Array>>();
    return (sha1) => {
      const had = kept.get(sha1);
      if (had) return had;
      const made = download(sha1);
      kept.set(sha1, made);
      made.catch(() => {
        if (kept.get(sha1) === made) kept.delete(sha1);
      });
      while (kept.size > limit) kept.delete(kept.keys().next().value!);
      return made;
    };
  }
  ```
- Add the prop `preview: { seq: number; sha1: string } | null`.
- In the component: `const fetchMap = useRef(keptDownloads((sha1) => downloadMap(sha1, AbortSignal.timeout(DOWNLOAD_LIMIT_MS))));`
- The Add path uses it: replace
  `const limit = AbortSignal.timeout(DOWNLOAD_LIMIT_MS); await installMap(game, sha1, await downloadMap(sha1, limit));`
  with `await installMap(game, sha1, await fetchMap.current(sha1));` (keep the comment and the `TimeoutError` handling).
- A second effect for the preview:
  ```ts
  const previewHandled = useRef(preview?.seq ?? 0);
  const wanted = useRef("");
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(previewTimer.current), []);
  useEffect(() => {
    if (!preview || preview.seq === previewHandled.current) return;
    previewHandled.current = preview.seq;
    clearTimeout(previewTimer.current);
    const { sha1, seq } = preview;
    wanted.current = sha1;
    if (!sha1) return;
    previewTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const bytes = await fetchMap.current(sha1);
          if (wanted.current !== sha1) return; // another row was picked meanwhile
          const file = `fp${seq}.tmp`;
          game.writeGameFile(file, bytes);
          game.exports.ra2_finder_preview(sha1, file);
        } catch (reason) {
          console.warn(`[finder] no preview of ${sha1}:`, reason);
        }
      })();
    }, PREVIEW_DELAY_MS);
  }, [preview, game]);
  ```
- Update the component's doc comment and `MapFinderCommand`'s neighbourhood to say what the preview does
  (one sentence each; no change to `MapFinderCommand` itself).

**B5. Tests.**
- `protocol.test.ts`, in the test that parses `mapFinderAdd`: also expect
  `parseEventLine('@ra2 {"e":"mapFinderPreview","sha1":"ab"}')` to equal `{ e: "mapFinderPreview", sha1: "ab" }`,
  `'@ra2 {"e":"mapFinderPreview","sha1":""}'` to equal `{ e: "mapFinderPreview", sha1: "" }`, and
  `'@ra2 {"e":"mapFinderPreview"}'` to be null.
- `store.test.ts`, in the test with `mapFinderCommand`: after the existing lines, send
  `@ra2 {"e":"mapFinderPreview","sha1":"ab"}` and expect `mapFinderPreview` to equal `{ seq: 1, sha1: "ab" }`
  and `mapFinderCommand` to be unchanged (`{ seq: 2, add: "ab" }`); send it again with `"sha1":""` and expect
  `{ seq: 2, sha1: "" }`. If the test file has an "exports signature" test listing every export, add the new one.
- `NativeMapFinder.test.ts`, a `describe("keptDownloads")`: (1) asking twice for one hash calls `download`
  once and both get the same bytes; (2) a rejected download is tried again on the next ask; (3) with
  `limit` 2, asking a, b, c then a calls `download` for a a second time.

Then run, from `web/`, and fix what they report in the files above only:

```bash
pnpm typecheck
```
```bash
pnpm test
```
```bash
pnpm lint
```

Done when all three pass. Report their last lines.

---

### Task C — build and try it in the browser (after A and B)

**C1. Build** (PowerShell, about 4 minutes; run it in the background and wait for it):

```powershell
Set-Location C:\Users\Norrapat\projects\redalert2-recomp\.claude\worktrees\online-maps; $env:EMSDK='C:\Users\Norrapat\projects\emsdk'; $env:PCRECOMP='C:\Users\Norrapat\projects\pcrecomp'; $env:RA2_TARGET='gamemd'; $env:BUILD_DIR='build-proto2'; $env:CMAKE_ARGS='-DRA2_FINDER_NATIVE=ON'; cmd /c ".\build-web.cmd" *> build-proto2.log; "exit $LASTEXITCODE" | Out-File -Encoding ascii build-proto2.exit
```

`build-proto2.exit` must say `exit 0`; otherwise report the first `error:` lines of `build-proto2.log` and
stop. Delete `build-proto2.exit` and `build-proto2.log` afterwards (they are not to be committed).

**C2. Dev server.** `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5180/` must answer 200. It was
down when this note was written. Start it with the preview tool, configuration `web-online-maps`
(it is in the main checkout's `.claude/launch.json`); not with a shell command.

**C3. Extend `web/e2e/finder-native.mjs`** (edit only this file):
- Near the top, after `const count = …`:
  ```js
  const downloads = [];
  t.page.on("requestfinished", (r) => {
    if (r.url().includes("/maps-api/yr/")) downloads.push(r.url());
  });
  ```
- After `await t.clickGame(150, FIRST_ROW_Y); // the first row`, replace `await sleep(700);` with:
  ```js
  await sleep(7000); // the pick is followed, the map downloaded, its preview drawn
  await t.moveGame(400, 560);
  await sleep(500);
  await t.shot("fn-3b-preview");
  const previewed = count(/\[finder\] preview of .*: a picture/);
  ```
- After the `fn-4-added` shot: `const downloadsAtAdd = downloads.length;`
- In the problems list:
  ```js
  if (previewed !== 1) problems.push(`the picked map's preview was loaded ${previewed} times, not once`);
  if (downloadsAtAdd !== 1)
    problems.push(`the map was downloaded ${downloadsAtAdd} times: Add did not use the preview's download`);
  ```
- Mention the preview in the file's header comment.

**C4. Run it** from `web/`:

```bash
node e2e/finder-native.mjs --url "http://127.0.0.1:5180/?mute" --game E:/Games/Westwood/RA2 --build ../build-proto2/out
```

Report: the printed `[finder]` and `[maps]` lines, `ok` or the `FAIL:` line, and where the screenshots
`fn-3b-preview`, `fn-4-added`, `fn-5-back` were written. Do not judge the pictures; the reviewer looks at them.

Game-pixel positions the script uses (800x600): Single Player (719,221), Skirmish (720,305), Customize Battle
(720,305), Find (719,305), finder search box (325,137), Search (719,221), Add (719,263), Back (719,557),
first result row y = 158 (+19 a row). The preview panel is at about x 643–786, y 37–150.

---

### Task D — review (the planner, not a small model)

- Read the whole diff.
- Look at `fn-3b-preview`: a map picture with start markers in the top-right panel, inside the frame.
- Look at `fn-5-back`: Customize Battle shows the preview of *its* picked map, not the finder's
  (that is what resetting `0xAC0D30` is for).
- Things only a run can tell, to check by hand or with a second script:
  - a new search, or picking the "Type a map name…" note row, clears the preview (the common handler's paint
    is expected to draw the background over it; if the old picture stays, paint the control's rect explicitly);
  - arrowing quickly through rows downloads only the row the pick rests on;
  - the `[finder] preview of …` line's time: the load reads the whole file as an INI on the game's thread, so
    a 1–2 MB map may hold the game for a noticeable moment. `finder-add-live.mjs` measures such stalls;
  - a map that gives `none` (no picture) leaves the panel empty and nothing breaks.
- Also run `finder-add-live.mjs` (same arguments) to see adding still does not stop the game.

### Task E — note and commit (after D)

- `docs/web/online-maps-research.md`: a paragraph on the preview (what the player sees; the game functions in
  the table above; the temp file; that Add reuses the download). Delete this handoff, or cut it down to what
  is still open.
- Commit on `claude/online-maps`, only the files changed here. No push, no merge. The commit hook runs
  eslint on staged files; do not bypass it. End the message with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Risks and unknowns

- **None of this has run.** The addresses come from reading the lifted code; the calling conventions are as
  read, not as tried.
- The screen set-up `0x622820` is called with Customize Battle's id (`0x6B`), so it should treat control
  `0x468` as it does there (its frame). If the control draws wrongly, compare with how Customize Battle's
  set-up handles `0x468`.
- `0x641EE0` writes the map's start positions into the global scenario. Customize Battle is made to load its
  own again on Back; nothing else is known to read them while the finder is up.
- `remove()` of `/game/fp*.tmp` is called from the game's thread and, for a dropped file, from the page's
  thread. `/game` is the in-memory file system, where the page already writes maps, so both should work.
- Not part of this task and still open: a double-click on a row adds nothing (the host's user32 makes no
  `WM_LBUTTONDBLCLK`); the page-panel finder (the default build) still scans the maps on every add;
  `RA2_FINDER_NATIVE` is still opt-in.

## Other state

- `pcrecomp` (sibling repo) is at `f27c624` for this work (`hle_dialog_resource_forget`). Another session has
  uncommitted changes there in `runtime/win32hle/user32.c`, `win32hle.h`, `wsock32.c`: leave them alone.
  This task needs no change in `pcrecomp`.
- `web/e2e/finder-try.mjs` is an uncommitted helper that opens a headed browser for trying the finder by hand.
- `tools/`, `names/` and `docs/reverse-engineering.md` exist only in the main checkout (branch `web-port`).
  Use `python`, not `py -3`, on this machine.
