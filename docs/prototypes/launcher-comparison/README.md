# Six launcher skill trials

Open index.html directly in Chrome or Edge. The gallery includes the preserved original, six screenshots, and live comparisons. preview.html lets you switch trials, keep the original alongside, choose a desktop/mobile viewport, replay motion, and open either version at full size.

## Original preservation

../game-sidebar/ is unchanged. preserved-baseline.json records a SHA-256 for every original file; preserved-baseline.zip contains the complete original prototype folder under game-sidebar/. The original is still opened at ../game-sidebar/launcher.html. Comparison files never write the original's preference keys.

These are six local spikes, not installed global skills or a production redesign. Each upstream SKILL.md is read and applied to its own trial; exact sources and application notes are linked below. The artwork is shared deliberately so the skill's effect can be compared without different illustrations biasing the result.

| Trial              | Skill                            | Kind                       | Notes                                           |
| ------------------ | -------------------------------- | -------------------------- | ----------------------------------------------- |
| Industrial depth   | High Contrast Skeuomorphic Clean | Material/visual direction  | [Applied rules](variants/skeuomorphic.notes.md) |
| Command frames     | Framed Tech Dark                 | Framing/visual direction   | [Applied rules](variants/framed-tech.notes.md)  |
| Mission console    | Game UI/UX                       | Layout and navigation      | [Applied rules](variants/game-ui.notes.md)      |
| Command feedback   | Game Feel                        | Short interaction feedback | [Applied rules](variants/game-feel.notes.md)    |
| Atmospheric light  | Atmosphere Background            | Background only            | [Applied rules](variants/atmosphere.notes.md)   |
| Cinematic sequence | Animation Systems                | Motion choreography        | [Applied rules](variants/animation.notes.md)    |

Motion and interaction skills intentionally retain more of the original appearance. Use their live trials and Replay rather than judging them only by still screenshots. Reduced motion disables nonessential animation.

## Navigation and isolation

variant.html?variant=ID opens a trial. Play opens play.html?variant=ID&edition=..., a separate copy of the quiet gameplay mockup. Confirmed Home returns to the matching trial. Edition/collection/settings preferences are isolated by trial, and the quiet toolbar uses separate comparison preference keys. No real game runtime, files, LAN connection, or save operations are started.

The shared shell reads the original CSS/tokens/artwork through an HTML base URL but never modifies them. Keep the docs tree intact when moving or serving the comparison. No dependency installation, external runtime assets, or network connection is needed to open these pages.

## Verification

All six trials were exercised in Chrome: source CSS/JS readiness; RA2/YR edition selection; settings; separate preference keys; collection naming; Play, Home cancellation, and confirmed return to the matching trial; both editions at 320/375/414/768/1280 px widths; and reduced motion. The gallery and live viewer were checked at the same five widths, including embedded-frame focus, desktop/mobile sizing, and original-pane toggling. Game Feel's test feedback and Animation Systems' replay were exercised; Atmosphere's canvas layer was checked. All ten preserved source-file hashes match the snapshot after verification.
