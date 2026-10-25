# Game sidebar proof of concept

A standalone, disposable UI prototype of the [sidebar design](../../superpowers/specs/2026-10-25-game-sidebar-design.md). It does not import or start the real game. Production implementation tasks remain unstarted.

Open index.html directly in Chrome or Edge; no server is needed. Keep it in this directory so the relative game screenshot path continues to work.

Alternatively, from the repository root, serve it locally:

```powershell
python -m http.server 4188 --bind 127.0.0.1
```

Open [the prototype](http://127.0.0.1:4188/docs/prototypes/game-sidebar/).

- Hover or keyboard-focus the rail to reveal labels; leave it to collapse after 250 ms.
- The rail starts faded at 20% opacity, including when pinned. Hovering or focusing it animates toward full opacity; open menus and dialogs keep it visible. After one second without sidebar interaction, it fades back to 20%. Fade-in takes 0.3 seconds; fade-out takes five seconds. Reduced-motion preferences remove the fade animation.
- Pin it open, or use the explicit expand/collapse button on touch. Pinning reserves space on desktop; temporary expansion overlays the game without moving it.
- Open Settings with the gear or F10. Enable the focus-mute switch, click Play test sound, then switch tabs/windows to hear the output gate. Returning preserves the chosen volume. Sound is opt-in and can be stopped from either sound control.
- Home asks for confirmation, then opens a local prototype launcher. Open prototype returns to the preview. It performs no real game navigation, saving, or file operations.
- More demonstrates keyboard input, LAN/file entry points, and shortcuts. Capture pointer and fullscreen use real optional browser APIs; Esc releases pointer capture.
- Mouse clicks do not leave the rail permanently awake. Keyboard focus keeps it readable; open panels keep it expanded, and menus support arrow keys, Home/End, Tab, and Esc. Desktop pinning is remembered independently of the compact mobile layout.
- Settings uses a full-width sheet on small screens, with a scrolling body and always-visible close/Back to game actions. Sound and More anchor to their buttons and stay within short viewports.
- Volume, the last nonzero volume, and preview display/control choices are remembered. Reduced motion disables panel entrance animations as well as fades. Demo audio cannot restart from a pending activation after returning Home.

Gameplay is a still image from docs/screenshots/skirmish-units.png. HD vehicles/modern-controls switches demonstrate their UI only; scaling and backdrop controls apply simple preview treatments. Browser-control preferences use the separate ra2.sidebar-poc.v1 localStorage key and do not change the real application settings.

No build, dependencies, or network services are required. The screenshot path is relative to the repository's docs tree, so keep that tree intact or serve the repository root rather than copying only this directory.

Verification: exercised in Chrome with stable viewport bounds during hover, delayed collapse, pin and preference persistence, F10, foreground/background audio gain changes, preservation of volume zero, menu focus retention, Home cancellation/confirmation, touch expansion, and 320/375/414/768/1280 px layouts. The test tone uses real Web Audio output gates; there is no real game audio or runtime in this page.
