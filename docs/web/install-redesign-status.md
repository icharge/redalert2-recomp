# Install flow redesign: status

Plan: [2026-11-15-install-flow-redesign.md](../superpowers/plans/2026-11-15-install-flow-redesign.md).
Designs: `docs/superpowers/specs/assets/2026-11-15-install-redesign/`.

## Tests that already failed before this work

`pnpm test` in `web/` before Task 1: 3 failures, 981 passes, none in files this plan touches.

- `src/storage/cursor-preferences.test.ts`: cursor choice keeps the launcher's choice per installation.
- `src/screens/launcher/settings/SettingsScreen.test.tsx`: stores the software-cursor choice for the next launch.
- `src/screens/launcher/settings/SettingsScreen.test.tsx`: hints are tooltips.

They belong to the session that owns the Cursor setting and are left alone.

## Tasks

- [x] 1. `runImport` reports its slot and each finished file.
- [x] 2. Per-part progress.
- [x] 3. Empty Play tab.
- [x] 4. Install frame.
- [x] 5. Choose step.
- [x] 6. Review step.
- [ ] 7. Installing and failed steps.
- [ ] 8. Browser check.

## Decisions

- Task 6: the left-out disclosure reads "1 other file is left out" for one file, and "{n} other files are left out" otherwise (the plan's wording is the plural only).
- Task 6: a browser whose `estimate()` gives no quota still gets the existing "not enough room" block from `checkSpace` (`storage/install.ts`, not touched here): with no quota, free space counts as 0. The meter is hidden as the plan says; the INSTALL button is disabled by that existing check. Not changed.

## Left

`docs/web/frontend.md` still needs its install section updated by the session that owns it.
