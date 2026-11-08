# Selectable launcher themes

The six approved comparison trials become selectable themes in the real React launcher. Retro modern remains the default and the original prototype files remain unchanged. The user authorized implementation in a new worktree on 2026-10-25.

Appearance offers Retro modern, Industrial depth, Command frames, Mission console, Command feedback, Atmospheric light, and Cinematic sequence. Selection applies immediately, survives reloads and returning from the game, and falls back to Retro modern when saved data is invalid or inaccessible. Theme changes preserve the selected installation and edition.

Use the existing artwork and styles for the launcher and shared app chrome. Express structural variants in React, never by moving React-owned DOM. Keep real installation selection, edition readiness checks, settings, file browsing, saves, mods, import/resume, rename and confirmed removal. Reuse the existing library as the collection management dialog. Existing game routing, teardown and game pixels remain authoritative.

Animations must clean up on theme changes and unmount, stop when hidden, and respect reduced motion. Feedback cannot delay Play. All content must remain usable at 320 px and on short screens. No runtime network assets or new dependencies.

## Shared component coverage (2026-10-26)

The selected theme also governs all app-owned dialogs, alerts, dropdown menus, forms, collection cards, file-browser chrome and the import screen. A shared React provider owns the existing preference; a document-level theme attribute reaches Radix portals as well as the main app. Nested launcher previews reuse the nearest provider. Theme state survives launcher route changes, and the provider restores its document attribute on unmount.

Each theme carries its material, border, typography, accent and focus treatment into these surfaces. Industrial depth uses inset controls and raised housings; Command frames uses sharp technical edges; Mission console uses compact section hierarchy; Command feedback uses brief interaction feedback; Atmospheric light adds restrained static panel lighting; Cinematic sequence adds short dialog entrances. Background art and animation stay behind content. Honor reduced motion and page visibility. Semantic warnings and destructive actions retain their meaning. Game pixels and runtime behavior remain unchanged.
