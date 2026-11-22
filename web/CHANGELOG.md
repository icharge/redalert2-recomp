# Changelog: the browser build

Changes to the browser build (`web/`) that players notice. Format:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/), and the version is `web/package.json`'s. The
launcher's Settings › About shows the newest section.

The native releases (v0.1.0 to v0.1.3) are in the repository's
[CHANGELOG.md](../CHANGELOG.md); none of them include the browser build. The
commit after each entry is where to read more.

## [0.3.0] - 2026-11-14

Changes since 0.2.1.

### Added

- **A new welcome page**: a full-screen page with a CREATE ACCOUNT and LOGIN
  panel beside the YuriNet title, and PLAY AS GUEST under them. New players
  are asked to become members first; a guest plays online unranked, with no
  clan.
- **Quick Match and Quick Co-op on a YuriNET server**: the Quick Match
  button of Yuri's Revenge and of Red Alert 2 finds the server's Quick Match
  lobby instead of ending in "Matching Server Not Found", and Yuri's Revenge's
  Quick Co-op button reaches the co-op lobby on a server that turns it on.
  Two players are paired, play, and a ranked Quick Match settles on the
  server's ladder. (8f2e3458, d5b2d4f1)
- **Members, guests and automatic online login**: a welcome page and an
  install guide open the launcher, and its ACCOUNT screen signs a member in
  and creates or claims their online nick (up to 9 letters). PLAY then gives
  the game a one-time ticket, so Internet goes straight to the lobby as that
  nick with no login dialog. A guest can give an online name instead; with
  none, the game's own login works as before. Needs a server with member
  support. (71911aca, 2ec3cde9, e1b17652, 55dd593c)
- **LADDER tab**: the ranked 1v1 standings of Red Alert 2 and Yuri's
  Revenge, with a season picker (the current season and past ones) and, for
  a signed-in member, their rank, rating, record and last ten matches.
  Reads the server's public ladder routes; there is no all-time table yet.
- **CLAN tab**: found a clan with a tag (2 to 6 characters) and a name, accept
  or decline invitations, and search the public clan list. Owners and officers
  invite players by game name and kick, promote, demote or hand over the clan;
  leaving and disbanding ask first. Each clan's members open at `/clan/TAG`.
  Needs a server with clans (the member routes `/v1/clans/*`).
- **FRIENDS tab and the Buddy List**: add players by game name and see who is
  online, in a lobby or in a game. In Yuri's Revenge the same list is the
  game's Buddy List, and `/on <name>` says where a player is in both games.
  Needs a server with friends (`/v1/friends`); members only.
- **MESSAGES**: a private-message panel beside the game, opened from the star
  tray, with a conversation per player and an unread count. Whispers and `/r`
  typed in the game show there too.
- **FRIENDS and profiles in the game**: the MESSAGES panel has a FRIENDS tab.
  Add a friend by game name, see where each friend is, and message them,
  remove them or open their profile (rating, rank, wins and losses, last ten
  matches). A conversation has a PROFILE button too. Members only; it is the
  same list as the launcher's FRIENDS page.
- **Right-click a player** in the lobby's player list: Add friend, Message or
  Profile.
- **Join a friend's game and invite friends**: in FRIENDS, JOIN takes you
  into the game room a friend is in, and while you are in a room INVITE asks a
  friend into it. The friend sees the invitation in their chat and in MESSAGES
  with a JOIN button.
- **`/r` and `/reply`** answer the last player who wrote to you privately, in
  the lobby, a game room or a match: `/r text` is a private message to them.
  With nobody to answer yet, a line in the chat log (only you see it) says to
  use `/pm name message`.
- **`/msg`, `/m`, `/pm` and `/p`** send a private message in the lobby's
  chat box and in the match panel: `/msg name hello` whispers to that player,
  as the game's `/page` does.
- **Chat times**: every lobby and game-room chat line starts with your local
  time, with a date row when the day changes. Settings > Launcher > ONLINE >
  Chat times turns it off.
- **YuriBOT, the lobby bot**: listed first with the operator icon; it
  announces joins and leaves, its announcements also reach players in a match,
  and its lines can show without its name and in a colour the server picks.
  Chat lines read `YuriBOT: hello` (no space before the colon).
- **A chat box for typing in the lobby**: the lobby, the game rooms and the
  Page dialogs get a real text box over the game's chat line, so a phone's
  keyboard and an input method (Thai and other languages) type into
  something you can see. It is see-through, with the game's yellow text.
  Enter sends it as the game's own chat, commands included. It replaces the
  TYPE button of the star tray. The lobby's Buddy List button opens the
  page's FRIENDS instead of the game's old Buddy List, and so does Yuri's
  Revenge's Page button in game rooms (the lobby's Page button is gone). The game draws Thai;
  other scripts show as "?".
- **Match messages and chat**: a panel at the bottom left of every match
  keeps a log of the game's messages (mission text, defeats, YuriBOT's
  announcements), each line with its time (Settings > Launcher > ONLINE >
  Chat times). In a LAN or online match it is also the chat: each player's
  lines in their colour, and the game's own chat keys open the line to type
  into: Backspace to allies, \ to everyone, and Enter to whoever you last
  chatted to in this match (everyone at first). Tab switches between all and
  allies, Enter sends and Escape closes. Lines fade after a
  while; pointing at the panel with the game's cursor shows the whole
  history, and clicking its tab keeps it open.

### Changed

- **Match game speed starts at Fastest**: a fresh install, the launcher's
  reset and its fallback start the skirmish, LAN and internet game speed at
  the fastest setting. The campaign's game speed is unchanged. (eb525a0f)
- The Westwood Online menu's title reads "YuriNET Online". (5a1fbdf1)

### Fixed

- A refused Westwood Online login now says the password is wrong or the
  account is banned, where it always read "Could not connect to Westwood
  Online". (36a28d78, a6b4fc39)
- A ranked match's result report is sent to the server and the server's
  answer (pending, scored, unscored, disputed, incomplete or expired) is
  understood, instead of being rejected as unknown. (cd1a95e9)
- Red Alert 2: chat in a Quick Match reaches the other player. Each game
  dropped the other's lines, as Yuri's Revenge did before 0.3.0.
- Whispers in a match (`/msg`, `/page`, `/r`) reach the other player and show
  as a row, and `/r` answers a player in a match. Before, the line was lost.
- MESSAGES shows whispers from the player who made a game room. They were
  left out as if they came from YuriBOT.
- In-match chat with three or more players no longer loses lines at random.
  The fix for the game name wrote 4 bytes past the name, into the packet
  the game was handling.

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
