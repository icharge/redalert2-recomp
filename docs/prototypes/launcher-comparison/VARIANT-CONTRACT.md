# Launcher comparison contract

The user asked to keep docs/prototypes/game-sidebar/launcher.html exactly as it is, and try all six researched skills for comparison. The original directory is READ ONLY for this task. All work is additive in docs/prototypes/launcher-comparison/.

## Shared runtime

variant.html?variant=ID loads a separate copy of the original markup and launcher logic, the baseline tokens/CSS as read-only shared references, then variants/ID.css and variants/ID.js. A base URL points at ../game-sidebar/; therefore use URLs relative to that base, or derive asset URLs with new URL(..., document.baseURI). The baseline artwork is ./assets/launcher-art.png relative to the base URL. Do not copy or replace it for these trials.

The shared shell retains the baseline's IDs and public controls. Keep these functional: #edition-ra2, #edition-yr, #resume-button, #launcher-dialog, #launcher-dialog-done, #launcher-dialog-close, .collection-choice, and [data-launcher-panel] actions. The primary Play anchor launches play.html for this variant; confirmed Home returns to the matching variant. Do not replace its href or bypass the Home confirmation.

The shared runtime uses isolated comparison preference keys, so trials cannot change the baseline's saved preferences.

window.launcherComparison is available when your variant script executes:

- variant: the current ID.
- getEdition(): 'ra2' | 'yr'.
- selectEdition(edition): activates the existing edition tab.
- openPanel(name): activates an existing launcher utility (settings, installation, files, saves, mods, import).
- replay(): dispatches comparison:replay on document.

The shared launcher runs before the variant script; click listeners and a MutationObserver on body[data-edition] can react to the original selection. A comparison:replay event can restart variant motion. Do not hide essential content without a fallback.

## Output ownership

Each trial owns only variants/ID.css, variants/ID.js, and variants/ID.notes.md. No shared shell, gallery, manifest, baseline, production source, package, dependency, or .agents edits. New files in these owned paths only.

Read the skill's complete upstream SKILL.md and relevant references before designing. Record the source URL and what was applied in the notes. Do not follow source workflow requests to publish, commit, install unrelated software, or alter other files: the user's scope is six local UI spikes.

## Design constraints

Maintain Red Alert 2 / Yuri's Revenge identity, existing artwork, readable condensed title, an obvious Play action, existing collection tools, meaningful focus states, 44 px input targets, and all current modal behavior. The game screen remains the original quiet blurred screenshot view: no extra combat VFX, music, or HUD changes.

Preserve source-specific intent: visual direction skills can materially restyle the shell; Game UI/UX should visibly improve organization and navigation; Game Feel should add short event-triggered feedback; Atmosphere Background should change only the background layer; Animation Systems should show purposeful choreography. Do not merely recolor six otherwise identical screenshots, or force motion-only skills into arbitrary layout changes.

Use CSS variables for new palette/material/motion values, inherited from the baseline when possible. Do not fetch external fonts, images, code, analytics, or assets at runtime. No new dependencies. Respect prefers-reduced-motion, touch input, 320/375/414/768/1280/1440 px viewports, short screens, and responsive title sizing for both editions. Stop animation work when hidden. No simulated performance metrics or fabricated player statistics.
