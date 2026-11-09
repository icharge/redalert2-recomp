# Changelog: the browser build

Changes to the browser build (`web/`) that players notice. Format:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/), and the version is `web/package.json`'s. The
launcher's Settings › About shows the newest section.

The native releases (v0.1.0 to v0.1.3) are in the repository's
[CHANGELOG.md](../CHANGELOG.md); none of them include the browser build. The
commit after each entry is where to read more.

## [0.2.1] - 2026-11-09

### Fixed

- Internet matches reconnect reliably, including games with three or more
  players, and rematches can start after a reconnection screen.
- Custom Match rooms now use the selected map's playable player capacity.
- Westwood Online map icons render correctly.
- The browser repairs a joined WOL port and `[Options]` line in the game INI,
  and terminates the port line before the game appends settings.

## [0.2.0] - 2026-11-09

Changes since 0.1.0.

### Added

- **Map search**: the game's map lists have a search box that filters as you
  type, says when nothing matches, and keeps working when the game type
  changes. (602587ac, 36ae4765, e45ad846, 276fbdc0, 5a351c96)
- **Yuri's random maps**: the random map offers Archipelago, Urban and Desert.
  (aa95f18a)
- **Install from an archive or installer**: an archive or the game's installer
  can be installed directly, and is read in the background. (a0e065f7)
- **Mouse wheel**: the wheel scrolls the game's lists and the sidebar.
  (e31ee61f)
- **Crash log**: the crash dialog's log has a COPY button. (30e519da)
- **Unresolved saves**: a save that refers to something missing can be
  ignored. (743a4e75)
- **Westwood Online legend**: the legend shows its icons. (30042e5c)

### Changed

- The game opens at `/game`; old `/game/:slot` links still open the
  installation. (42283dea)
- One installation at a time; a new folder comes after REMOVE GAME.
  (c778790b)
- The import sorts the folder into game, movies, mods, maps, saves and
  settings; its mod count opens each mod's game, size and files.
  (6a7101eb, dd1ee1ad)
- Resolution defaults to the match browser's size; HD vehicles are off for
  now. (a03ce677)
- The main menu's version shows the launcher's, then the game's. (84e67449)
- The menus and the pause menu show the game's own arrow. (56c4a4f5)
- About has two columns, credits the web port to THAI RA2, and drops the copy
  and update-check buttons. (05acc4a3, 8ccd062a, 28637991, 63e6c589)

### Fixed

- REMOVE GAME deletes the game's files before its record. (4fd72466)
- An install for a removed installation installs instead of failing.
  (a13c62ba)

## [0.1.0] - 2026-11-07

The first browser release: everything since the port started on 2026-10-17.

### Added

- **Play in the browser**: Red Alert 2 and Yuri's Revenge run in Chrome from
  one page, and the page draws the game with WebGL2, falling back to a 2D
  canvas. (5f6d0140, e59ed78b, de4a7b40)
- **Bring your own game**: point the page at your installed game folder once.
  The files are copied into the browser's private storage and read in place,
  so the game starts in under five seconds. An import that stops can resume,
  space is checked first, and an installation that lost files can be
  repaired. The Library manages an installation's files. (7f91eaa2, f313d27e,
  4b1763f4, 585f5040)
- **Saves**: kept between visits; download them as a zip and bring them back
  from one. (7f91eaa2, 0409c2b8)
- **Sound and movies**: the game's sound, music and Bink movies play in the
  page. Sound mutes while the window is in the background. (7422b60e,
  eaf4a75e, b77c05cc)
- **Online and LAN play**: Custom Match and Internet games run through a
  bridge to the game's online service and a relay for its network traffic,
  with a short command delay; match results are reported. The LAN panel
  joins games on your network. (e44a0d2d, e803689d, 89b0f3b5, fecd2975,
  764f5a1a, 091b89d1)
- **Updates**: the page works offline once loaded and offers a new version
  when one is ready. (da0b2e5f)
- **Settings from the launcher**: the game's own settings (gameplay, audio,
  video, keys) and the page's (scaling, menu bars, FPS counter) are set
  from the launcher, and a change applies to every edition.
  (b7f17da6, d15d6142, 82d990c7)
- **Display**: 1920 × 1080 by default, with your screen's own size detected
  and offered. Full screen on launch, or only during matches. The in-game
  settings choose the next match's resolution, and a running match follows a
  window resize. (7b822850, ad958de3, 0a579073, a25c765b, 5df76ade)
- **Smooth cursor**: the page draws the game's cursor at your display's rate,
  in matches and menus alike. (1021b410, 7423a002, bbe4bf81, 60e3d64a)
- **Web links**: links from the game's old online menus open in a dialog
  drawn with the game's art, which asks before opening them. (563692ce,
  b5e19462, 48456423, 9f6d1bd3)
- **Thai typing**: text typed in the game arrives as Thai characters.
  (64125f31)
- **Start-up**: the game's boot screen shows while it starts; Escape or a
  click skips the logo, and the start-up logos can be replaced from the
  launcher. (b74ca345, 9bb4fc6e, d64f5de0)
- **New launcher**: Play, Mods, Game, Install and Settings screens beside a
  rail of your games, over each game's key art, with motion between them.
  Mods are picked from the launcher. (2c293eee, 75e0b0bf, 1a0fb609, 619333df,
  05d93a74, b8bf365c, 497d4295, 9cc2b7a7)
- **In-game controls**: a red star in the bottom-right corner opens the
  page's controls, which slide out of the way during a match. The in-game
  settings, loading screen and crash, LAN, exit and sound dialogs match the
  launcher. (b68eb961, 7a137ed9, cdb44518, f2e404f1, 66bce2d1)

### Changed

- Settings is a screen of its own; picking a game there returns to its Play
  screen. (42e4b848)

### Fixed

- The game keeps running while you look at another tab, and redraws the
  whole screen when you come back. (cba8332b)
- Leaving a match from the page opens the game's pause menu. (c8d5fbdb)
- Escape in full screen opens the game's pause menu instead of leaving full
  screen. (afc28106)
- Large match sizes no longer show a black picture. (7612ef55)
- Online games keep to the 1920-wide limit quietly in both editions.
  (d4a225cf, 6fc15e8b)
- The cursor no longer jumps when flicked into a screen edge. (63d007f3)
- The launcher's match speed is the speed the game plays at. (a785270b)
- Settings are saved under the file name the game reads. (67b1bf3a)
- Mod names in other scripts, and the campaign difficulty, show in the
  launcher. (a9777cf6)
- Menu music follows the game's own setting. (58045271)
- Crash and loading screens show above the game. (baf333ab)
- An import whose record disagreed with the stored files is put right.
  (bb5fbbe4)
- The campaign emblems light up on hover. (f54acfad)
