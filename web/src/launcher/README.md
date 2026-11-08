# Launcher appearance

Use **Appearance** in the launcher header to select a theme. The choice applies immediately and is stored under `ra2.launcher.theme`. Retro modern is the default; unknown or unavailable storage falls back safely. Theme selection is independent of game and installation settings.

`Launcher.tsx` renders the real installation and edition controls. Play uses the existing readiness checks and app callback. Settings, files, saves and mods use the existing app services. Manage collection reuses Library for rename, resume, import and confirmed removal. Its edition selection is shared with the launcher. Game routing, lifecycle and game pixels are unchanged.

`LauncherThemeProvider.tsx` owns the saved appearance for the whole app and publishes `data-launcher-theme` on the document. This reaches Radix body portals, nested confirmations, dropdowns and the import route. Standalone launchers supply a provider and nested launchers reuse the current one. Document attributes and visibility listeners are cleaned up when the owner unmounts.

`themes.css` ports the approved original and comparison launcher styles under `.launcher-page` and each trial under `data-theme`. Structural variants are rendered declaratively in React. `integration.css` styles real installation/appearance controls. `surfaces.css` supplies all seven materials for dialogs, alerts, selects, fields, switches, buttons, cards, import and the vendored file-browser chrome. It preserves semantic warning/destructive colors and hidden inputs. Dialog entrances and control feedback respect reduced motion and pause when the page is hidden. `useLauncherMotion.ts` owns the main launcher's animations, listeners, canvas and frame cleanup.

| Theme              | Approved source                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retro modern       | Original `docs/prototypes/game-sidebar/launcher.html`                                                                                            |
| Industrial depth   | [High Contrast Skeuomorphic Clean](https://github.com/MengTo/Skills/blob/main/agent-skills/web-design/high-contrast-skeuomorphic-clean/SKILL.md) |
| Command frames     | [Framed Tech Dark](https://github.com/MengTo/Skills/blob/main/agent-skills/web-design/framed-tech-dark-border-gradient/SKILL.md)                 |
| Mission console    | [Game UI/UX](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/game-ui-ux/SKILL.md)                    |
| Command feedback   | [Game Feel](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/game-feel/SKILL.md)                      |
| Atmospheric light  | [Atmosphere Background](https://github.com/MengTo/Skills/blob/main/agent-skills/web-design/atmosphere-background/SKILL.md)                       |
| Cinematic sequence | [Animation Systems](https://github.com/MengTo/Skills/blob/main/agent-skills/web-design/animation-systems/SKILL.md)                               |

The artwork is the original ImageGen tank/airship illustration from the approved prototype, copied unchanged. The original prompt and provenance are preserved in [ARTWORK.md](./ARTWORK.md). No remote assets are requested at runtime. No skills or packages were installed for this change.

For visual inspection without a game build or imported files, run the Vite dev server and visit `/e2e/launcher-themes.html`. That development fixture uses the production component with explicit preview callbacks and is not a production entry point. The ordinary app entry point remains `/`.

## Verification

- All 315 tests in 39 web test files pass, including storage failures, real launcher callbacks, readiness, file browser refresh stability, shared edition state, focus restoration and motion cleanup.
- TypeScript and targeted ESLint checks pass. New theme files and the modified Library pass Prettier; the App integration preserves surrounding pre-existing formatting.
- Production app and service worker build pass. Vite reports its standard advisory for the main JavaScript chunk exceeding 500 kB.
- Chrome: seven themes, both editions, six widths (320, 375, 414, 768, 1280, 1440), theme restoration, mobile import icon, utility-dialog focus, reduced motion and preview Play callback pass with no page errors or horizontal overflow.
- Original prototype preservation manifest: all 10 files unchanged. All 57 prototype files were migrated byte-for-byte from the main checkout into this worktree; main docs/prototypes is clean and unrelated main changes are untouched.
- Independent review findings fixed and re-reviewed: stable open file source, restored opener focus and shared edition selection. The shared provider/portal/component changes also passed independent review (20 related tests rerun). No important findings remain.

Run the browser check against a running dev server with `node e2e/launcher-themes.mjs --url http://127.0.0.1:5173/` from `web/`. Screenshots are written to the ignored `web/e2e/shots/` directory. Live game startup was not exercised by the visual fixture; it tests presentation and callbacks while the existing routing tests cover app integration.

The shared-component browser check is `node e2e/launcher-surfaces.mjs --url http://127.0.0.1:5173/`. It checks all seven themes at 1440, 375 and 320 px across settings and dropdowns, saves, collection cards, nested removal confirmations, the lazy-loaded file browser, mods and the import screen, plus reduced motion. The preview fixture uses in-memory mod settings and read-only sample files; it never writes IndexedDB or OPFS data.
