# Game URL Without Slot Design

## Intent

Remove the installation number from the normal game URL so the URL describes the game screen, while preserving bookmarked numeric game URLs. The browser continues to have one newly imported installation at a time, with Red Alert 2 and Yuri's Revenge as editions of that installation.

## Goals

- Use `/game?edition=ra2` or `/game?edition=ra2md` for newly launched games.
- Resolve `/game` through the existing active-install choice and the existing edition selection rules.
- When `/game` has no `edition` query, use the remembered edition of the active installation, then fall back to Yuri's Revenge or the first available edition.
- For a valid old `/game/:slot` URL, select that installation, then replace the URL with `/game`, preserving the edition and supported game query options.
- Keep numeric slots as internal installation IDs for IndexedDB, OPFS paths, interrupted-import resume, and older stored installations.
- Preserve the current one-install import rule: a fresh import is rejected while an installation exists; users remove the existing game before importing a different folder.
- Preserve sharing of matching files between editions in the same installation.

## Non-goals

- Merging or migrating existing IndexedDB/OPFS slot data.
- Removing `?resume=<slot>` from interrupted-import URLs.
- Changing how the active installation is selected or how editions are remembered.
- Allowing multiple newly imported installations.

## Approaches

1. **Canonical `/game`, with legacy redirects (chosen).** New Play actions navigate to `/game?edition=...`. A valid `/game/:slot` deep link selects its installation and redirects with history replacement. This removes slot IDs from normal and resulting game URLs while keeping old bookmarks useful.
2. **Canonical `/game`, with no legacy route.** This is simpler, but existing game bookmarks stop working. It does not fit the requested compatibility choice.

## Constraints and behavior

- The active-install and edition-selection helpers remain the source of truth for `/game`.
- The exact `/emu/game` server route must return the application shell even though `/emu/game/` is also the static assets directory.
- A valid legacy slot URL first updates the remembered active installation. The redirect then uses the active-install route, so the exact bookmarked installation opens even if another legacy installation was active.
- Invalid legacy slot IDs continue to show the existing missing-install error.
- The `edition` query remains public because it chooses between the two game editions. Existing supported runtime query options are carried across the legacy redirect.
- Internal slots remain in storage. Current importer code rejects a second fresh installation, while resume imports target their existing slot. Old installations can still exist in upgraded browser data.
- When both editions are imported into one installation, `Manifest.beginImport` reuses matching files from the other edition's record, so common game files are copied once and shared from the installation's OPFS home.

## Likely code and documentation touchpoints

- `web/src/paths.ts`: make the game URL helper produce `/game` plus the optional edition.
- `web/src/App.tsx`: make Play and the game route resolve the active installation; add the legacy numeric route redirect.
- `web/src/App.test.tsx`: cover the canonical route, active-install selection, legacy redirect, invalid legacy slot, and deployment base path.
- `docs/web/frontend.md`: document `/game` and retain the one-install/import-sharing behavior.
- `docs/web/decisions.md`: reconcile D14, which currently says a second import can create another copy and conflicts with `runImport`'s current one-install guard.

## Open implementation detail

Preserve the full query string and hash on legacy game URLs. Existing runtime, edition, and browser automation links may depend on parameters that the launcher does not create itself.
