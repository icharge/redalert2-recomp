# Atmospheric light

Source read in full: [Atmosphere Background](https://raw.githubusercontent.com/MengTo/Skills/main/agent-skills/web-design/atmosphere-background/SKILL.md).

The tank artwork, typography, layout and controls are preserved. Six curved canvas ribbons overlap using screen compositing. A vertical alpha mask fades their tops; a lower-right bloom gathers their warm red light. Sine drift takes roughly 80–120 seconds per cycle. The tint comes from the baseline red token. The original scrim remains above the entire effect to protect reading contrast. Mobile lowers the layer opacity.

The renderer caps DPR at 1.5 and drawing at 24 fps. It reads dimensions only on resize. Hidden documents cancel RAF; resuming retains elapsed scene time. Reduced motion draws a single fixed frame and schedules no RAF. A CSS still supplies the atmosphere when JavaScript or canvas is unavailable. The canvas is decorative, ignores pointer input, and needs no pointer tracking, including on touch devices.

Compare by leaving the screen still for 15–20 seconds, watching the folds around the tank's right silhouette, then using Replay to reset their phase. Test both editions and reduced motion. A still screenshot captures the composition but cannot demonstrate the drift. Tradeoff: intentionally small foreground difference, with modest continuous canvas work while visible. Browser integration checks are coordinated by the parent task; no performance claims are inferred from the frame cap.
