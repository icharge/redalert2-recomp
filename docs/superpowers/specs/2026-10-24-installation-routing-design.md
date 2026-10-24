# Installation routes and game exit

## Intent

The launcher lives at `/`. `/game/1` launches imported installation slot 1.
Slots represent separate imported folders, including multiple copies of the
same edition. A folder containing RA2 and Yuri's Revenge creates one slot
with two launch choices. Exiting returns to the launcher and unloads the
game runtime. Existing imports, saves, and mods must remain usable.

## Approaches

Use React Router in declarative mode with `BrowserRouter` and a basename.
Use React Router 7.18.1, whose package metadata supports the existing React
18 and Node 22 runtime, rather than introducing a React upgrade for routing.
The user proposed React Router and clean URL paths. Hash routes would
change those URLs, and continuing with screen state would not support
bookmarks or direct links. Router navigation handles launcher screens;
leaving a loaded game uses a document navigation to release its runtime.

Fixed slots for game editions were considered and rejected by the user.
The user selected one slot per imported folder, with two launch choices
when both editions are present.

## URLs and deployment

- `/`: launcher, listing installations and available edition buttons.
- `/import`: import a new installation. A resume link explicitly selects
  an incomplete slot; importing another folder never silently replaces an
  existing complete installation.
- `/game/:slot`: launch that installation. Builder proposal: default to
  Yuri's Revenge when available, otherwise RA2. `?edition=ra2` or
  `?edition=ra2md` selects an edition explicitly.
- Unknown, incomplete, or unavailable slots/editions show an explanation
  and a launcher/import link. Never silently launch a different slot.

Use Vite's configured base (for example `--base=/emu/`) for the router,
public assets, WASM script/data/worker URLs, audio, font and file-browser
assets, and the service-worker scope and navigation fallback. URLs then
become `/emu/` and `/emu/game/1`. A static server must serve the application
HTML for non-file routes under that base while preserving real asset URLs.
Document the rewrite and verify direct loading and refreshing a game URL.
The base is a deployment setting; it is not guessed from a game URL.
Scope service-worker metadata and game-cache cleanup to the deployment
base so workers installed at different paths do not evict each other's
builds. Existing origin-wide user storage remains discoverable after
moving the application under a context path.

## Installation identity and storage

Add an IndexedDB installation store with persistent positive numeric slot
IDs, allocated transactionally and never reused. Keep edition identity
(`ra2`, `ra2md`) separate from slot identity. Each installation records its
folder name, import state, and edition records. Edition records retain PE
validation, file metadata, and references to their storage locations.

Copy common files once within a new installation. Give each installation
its own data namespace and each edition its own save/settings/mod
namespace. Do not deduplicate files across new installations based only
on names, sizes, or timestamps. Mod lists, mod files, save import/export,
Thai-font preferences, file browsing, and game loading all resolve through
the chosen slot and edition. Site-wide volume and UI settings remain
site-wide.

Builder proposal: keep the existing `game/<home>/...` and `save/<home>/...`
storage helpers, allowing opaque validated namespace strings. New imported
files use an installation namespace such as `slot-2`; edition writes and
mods use a namespace such as `slot-2-ra2md`. This avoids confusing the
guest's fixed `/game` virtual path with the browser deployment base.

Migrate existing edition-keyed records into one installation, retaining
their current file, save, mod, and preference locations through explicit
legacy references. Do not move or duplicate large OPFS files during the
IndexedDB upgrade. A committed metadata upgrade must be atomic; an upgrade
failure leaves the old data usable. New imports cannot overwrite legacy
locations. Deletion compares exact storage location plus filename, so
legacy shared files remain until no installation references them. Preserve
the existing policy of retaining saves on removal, without reassigning
them to a later slot.

An incomplete slot has an explicit Resume import action. Resume validates
the selected folder and reuses only complete matching files in that slot.
Folder name alone is never installation identity. A new import of a
previously imported folder creates another slot.

## Runtime and exit

Keep one game runtime per document. The route and edition fully identify
the running game; a mod restart reloads that same URL. Navigating to another
slot after a runtime has loaded must unload the previous document rather
than trying to reuse the classic Emscripten globals.

On normal game exit, stop input, presentation, LAN polling/connections,
audio, and save polling without calling exports after Emscripten has
exited. Flush pending saves/settings to OPFS, then replace the current
document with the base launcher URL, removing launch/debug parameters and
resume markers. Browser document teardown releases workers and makes the
WASM memory reclaimable; switching React screens alone is insufficient.
If persistence fails, keep the document and offer retry. Crashes retain
their diagnostics and an explicit return action. Cancel/Stay keeps the
current game running.

Developer/test launch queries remain supported as development fixtures,
with base-aware asset URLs. They do not allocate persistent installations.

## Verification and boundaries

Test migration of both old edition records, preservation of legacy shared
files/saves/mods, distinct copies of the same game, explicit import resume,
and deletion isolation. Test router deep links, edition selection, invalid
slots, launcher links, and root and `/emu/` deployment. Test save failure
and retry before document navigation. Run the real Exit confirmation test
for both games, asserting a clean exit event, launcher arrival, absent
runtime globals, and closed game workers. Check base-prefixed production
assets and service-worker offline navigation as well as development mode.

This change does not add new game editions, multiplayer features, or a
runtime capable of running two games in one page. No public deployment is
part of this task.

## Approval

The independent builder check reported no important unanswered questions.

Approved by the user on 24 October 2026 with "Approve and implement".
The user has already
chosen separate imported installations and one slot with two launch
choices for folders containing both games. Default edition selection and
the storage/migration mechanism above are builder proposals.
