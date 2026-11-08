# Cinematic sequence

Source read in full: [Animation Systems](https://raw.githubusercontent.com/MengTo/Skills/main/agent-skills/web-design/animation-systems/SKILL.md).

The existing geometry and palette stay intact. The opening sequence establishes artwork, title, then edition selection and Play. Its final beat settles within 1 second. Native Web Animations provide a bounded timeline; shared tokens use 160 ms interactions, 220 ms state changes and a 280 ms dialog entrance with a single settle curve. Mobile stagger is shorter. Hover lift requires a fine pointer; keyboard focus retains an immediate visible outline. Selection changes briefly introduce the new title and summary. Dialog exit remains immediate so native closing, validation and focus restoration retain their behavior.

All controls remain visible at their final hitboxes throughout. Pointer, keyboard or focus input cancels the opening sequence immediately. Replay restarts it. Hidden documents pause tracked animations; reduced motion cancels them and removes CSS movement. Only opacity and transforms animate, without layout measurement per frame, libraries or new assets.

Compare using Replay and observe the first second; then keyboard through edition tabs, open settings, press Escape and hover Play. Repeat with reduced motion and touch emulation. Tradeoff: the final still deliberately resembles the baseline; temporal hierarchy is the experiment. The background zoom is a one-time entrance, without ambient looping. Browser integration checks are coordinated by the parent task.
