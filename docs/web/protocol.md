# The page and the game

What the page (TypeScript, main thread) and the game (C, its own thread) say
to each other. Every shape here has one TypeScript type in
`web/src/game/protocol.ts` and one C declaration in `src/web/web_api.h`, and
the two are changed together.

Keep it small. Most of the game's work (drawing, input, sound, files) goes
through SDL and WasmFS without any message of ours.

## Starting the game

```ts
const mod = await createRa2({
  canvas,                       // an HTMLCanvasElement, transferred by Emscripten
  arguments: ["--run", "--game", "/game/ra2md"],
  print: (line) => store.log(line),
  printErr: (line) => store.log(line),
  onAbort: (what) => store.crashed(what),
});
```

`main()` mounts OPFS ([storage.md](storage.md)), maps the exe and enters the
game. The game folder is passed with `--game`, as on Linux. Any other
argument from the URL query (`?arg=--hd-voxels`, for tests and debugging) is
appended, as on Linux.

## Page to game: exported functions

Called with `mod.ccall`. Emscripten runs each on the main thread, so each
does nothing but set a value or queue a request the game thread picks up in
its pump (`hle_set_pump_hook`).

| Function | Arguments | What it does |
|---|---|---|
| `ra2_resize` | `int w, int h, float dpr` | the canvas's new CSS size and device pixel ratio. The host resizes the SDL window, and `screen.c` letterboxes |
| `ra2_set_volume` | `float v` (0 to 1) | `hle_dsound_set_master(v)` |
| `ra2_focus` | `int focused` | the tab or window lost or gained focus. The game pauses the way it does when deactivated on Windows |
| `ra2_quit` | none | posts `WM_CLOSE` to the game's window, as closing the window does on Linux |
| `ra2_crash_report` | `char *buf, int len` → `int` | formats `g_cur_func` and the indirect-call ring into `buf`. Safe to call after the game thread has died, because it only reads memory |
| `ra2_script` | `const char *line` | queues one scripted event in `src/linux/script.c`'s grammar (`--press DLG:CTRL@s` without the `--`). For tests ([testing.md](testing.md)) |

Fallback only, if SDL's own DOM event handling doesn't reach a pthread
(stage 5):

| Function | Arguments |
|---|---|
| `ra2_input_pointer` | `int kind, int x, int y, int buttons, int mods` |
| `ra2_input_key` | `int down, int vk, int mods` |
| `ra2_input_wheel` | `int dy` |

## Game to page: events

The game prints one line per event to stdout, prefixed `@ra2 ` and followed
by JSON. `loader.ts` takes those lines out of the log and dispatches them to
the store. Plain text, so the same events show up in a Node run's output and
in test logs.

| Event | Fields | When |
|---|---|---|
| `boot` | `title`, `exe`, `stamp` | the exe is mapped and bound |
| `menu` | none | the main menu's dialog (0xE2) opened: `phase` becomes `running` |
| `mode` | `w`, `h` | the game set a display mode |
| `fps` | `fps`, `ms` | once a second, if the overlay is on |
| `exit` | `code` | the game's entry returned |
| `error` | `message` | something the player should see that isn't a crash (a missing file) |

Example: `@ra2 {"e":"mode","w":1280,"h":720}`.

## Versions

`protocol.ts` and `web_api.h` both carry `RA2_WEB_PROTOCOL` (an integer).
The `boot` event includes it. If the page and the loaded `ra2.wasm`
disagree (a stale cached wasm), the page says so and offers a reload,
instead of misreading events.
