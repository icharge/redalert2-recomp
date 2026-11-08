# Command feedback

Sources read in full:

- https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/game-feel/SKILL.md
- https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/game-feel/references/feedback-recipes.md

Applied: attach feedback to discrete events, begin with a few channels, ease into a settle, scale response to importance, and always return to rest. Routine press has a 150ms compression/release; edition selection gets a 280ms restrained overshoot plus 220ms title settle and textual acknowledgement; launch has a slightly stronger 360ms button response plus directional arrow follow-through. The small confirmation check uses a 260ms pop. The response strip resets after 1.2 seconds. The familiar baseline composition remains recognizable.

The explicit Test feedback control and comparison replay event demonstrate selection and launch feedback without navigation. Actual Play uses the original href immediately: feedback never delays launch, blocks input, or simulates a loading process. Pointer, keyboard-generated clicks, and existing arrow-driven selection all use the same event hooks. Native utility dialogs and shared launcher preferences retain ownership of behavior. No continuous loop, screen shake, hit-stop, audio, particles, or preview-game changes are added. Routine menu actions do not justify the skill's strongest impact effects.

Reduced motion preserves the status/check/selected state but suppresses all Web Animations. Hiding or leaving the page cancels current animations and pending demo/status timers. Rapid repeated events cancel the prior animation on that element, so they do not build an unbounded queue. All transforms end at identity and run without fill persistence. All status changes are bounded to discrete user events.

Layout guardrails: safe-area padding, at least 44px control targets, expansion-specific title sizing, and compact mobile feedback wrapping. Tradeoff: the most visible actual launch feedback appears during pointer press because navigation remains immediate; Test feedback exposes the full sequence to comparison reviewers. No synthesized sound or fabricated activity state. Integrated browser evidence belongs to the comparison harness; this note does not claim unobserved device testing.
