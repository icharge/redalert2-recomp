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
- [ ] 3. Empty Play tab.
- [ ] 4. Install frame.
- [ ] 5. Choose step.
- [ ] 6. Review step.
- [ ] 7. Installing and failed steps.
- [ ] 8. Browser check.

## Decisions

(none yet)

## Left

`docs/web/frontend.md` still needs its install section updated by the session that owns it.
