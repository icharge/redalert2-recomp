# Mission console

Sources read in full:

- https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/game-ui-ux/SKILL.md
- https://raw.githubusercontent.com/gamedev-skills/awesome-gamedev-agent-skills/main/skills/disciplines/game-ui-ux/references/layout-and-flow.md

Applied: container-based layout and explicit aspect policy; a separate game/installation rail and launch stage, rather than visual recoloring. Mobile flows edition selection, launch, then collection tools. Critical content uses safe-area margins and scrolls on short screens; the existing artwork can bleed. Titles size independently for the longer expansion name. Targets are at least 44px and focus uses a visible outline in addition to the persistent selected checkmark.

Keyboard: initial Play focus in the standalone view only (embedded comparisons retain the parent selector's focus), existing horizontal edition arrows/Home/End, additional vertical edition arrows, and collection-tool vertical arrows/Home/End. Mouse, touch, and normal Tab navigation coexist. Existing utility dialogs form the single overlay level; native modal input ownership is reinforced by an inert launcher, and closing restores the invoking control including Escape. All existing IDs/listeners/Play URLs stay attached to the same nodes. Updates remain event-driven. No polling or animation was introduced.

Scope/tradeoffs: these are browser equivalents of the engine-neutral rules, not a Godot/Unity integration. A one-level native modal is sufficient for these six existing utility screens; there is no invented nested screen router. No gamepad mapping is claimed. The stronger library structure costs vertical space on mobile, where ordinary page scrolling keeps every action reachable. The shared preview game remains untouched. Integrated browser evidence belongs to the comparison harness; this note does not claim unobserved device testing.
