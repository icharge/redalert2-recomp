#!/usr/bin/env python3
"""Scripted play tests: walk every menu and game mode headless, in parallel, and keep the evidence.

Civilization III's runner (civ3 tools/playtest.py) adapted to RA2. A case is
a list of host arguments; the difference is how buttons are named. RA2's
menus are dialog resources, so a case says press('SinglePlayer') and the
runner resolves the label to a dialog and control ID with tools/dialogs.py's
map, and the host presses it once that dialog is actually open. No pixel
coordinates and no fixed times for menus (docs/testing.md).

A run leaves, in work/tests/<case>/:

    run.log      everything the host printed
    run.mp4      the recording
    sheet.png    a contact sheet, one frame every --every seconds

and the summary line says how it ended: the exit code (4 = the watchdog, the
normal end of a timed run), any fault or not-lifted report, the dialogs that
opened, and the frames blitted in game. Reading the sheets is the actual test:
a pass says a case reached what it expected and ran clean, not that every
pixel was right.

    py -3 tools/playtest.py --list
    py -3 tools/playtest.py menu-skirmish
    py -3 tools/playtest.py 'menu-*' 'back-*' --jobs 4
    py -3 tools/playtest.py skirmish-start --original   # the shipping code, same script

--original runs the shipping machine code under the same host, shims and
script (src/runtime/oracle.c), into work/tests/<case>.original/: where a case
fails on the lift and passes there, the lift is wrong; where both fail, the
host is.
"""
import argparse
import contextlib
import fnmatch
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# RA2_EXE: another build of the host to test (a clang-cl build, an A/B variant).
# RA2_TARGET=game: Red Alert 2 (game.exe, built into build-game\); the default
# is Yuri's Revenge (gamemd.exe, build\).
TARGET = os.environ.get('RA2_TARGET', 'gamemd')
GAME_EXE, GAME_INI = ('game.exe', 'RA2.INI') if TARGET == 'game' else ('gamemd.exe', 'RA2MD.INI')
# On Linux the native host (build-linux.sh) is the default once it is built.
NATIVE_HOST = os.path.join(ROOT, 'build-linux-game' if TARGET == 'game' else 'build-linux', 'ra2')
HOST = os.environ.get('RA2_EXE') or (NATIVE_HOST if os.name != 'nt' and os.path.exists(NATIVE_HOST)
                                     else os.path.join(ROOT, 'build-game' if TARGET == 'game' else 'build', 'ra2.exe'))
NATIVE = os.name != 'nt' and not HOST.lower().endswith('.exe')
OUT = os.path.join(ROOT, 'work', 'tests-game' if TARGET == 'game' else 'tests')
DIALOGS = os.path.join(ROOT, 'work', 'game' if TARGET == 'game' else '', 'dialogs.json')
# Off Windows the .exe is a cross build (build.sh) that runs under Wine:
# CrossOver's Steam bottle on a Mac, wine on Linux, or RA2_WINE, the launcher
# command. The native host runs as it is.
WINE = [] if os.name == 'nt' or NATIVE else shlex.split(os.environ.get('RA2_WINE') or (
    '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine --bottle Steam'
    if sys.platform == 'darwin' else 'wine'))
# The game folder's wsock32.dll is IPXEmu, the network games' IPX; Wine would
# load its own, which has none (error 10047 creating the IPX socket).
if WINE:
    os.environ.setdefault('WINEDLLOVERRIDES', 'wsock32=n,b')
# Under Wine two network screens at once share one IPX port (error 10048),
# so those cases take turns.
IPX = threading.Lock()


def host_path(p):
    """A path as the host takes it: Wine's Z: is the Mac's (or Linux's) /."""
    return p if os.name == 'nt' or NATIVE else 'Z:' + os.path.abspath(p).replace('/', '\\')


# The menu screens, by the dialog resource the game builds them from
# (py -3 tools/dialogs.py --show 0xE2 lists one).
MAIN, SINGLE, SKIRMISH, CAMPAIGN, LOADGAME = 0xE2, 0x100, 0x102, 0x94, 0xB7
OPTIONS, LAN, MOVIES, KEYBOARD, CONFIRM, NEWLAN = 0xD5, 0xBB, 0x101, 0xA3, 0x120, 0xBC

_dialogs = None


def control(dlg, label):
    """Control ID of the button captioned GUI:<label> in dialog `dlg`."""
    global _dialogs
    if _dialogs is None:
        if not os.path.exists(DIALOGS):
            subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'dialogs.py'), '--exe',
                            os.path.join(ROOT, 'game', GAME_EXE), '--out', DIALOGS], check=True)
        _dialogs = json.load(open(DIALOGS))
    for c in _dialogs['0x%X' % dlg]['controls']:
        if c['text'] == 'GUI:' + label:
            return c['id']
    raise KeyError('no GUI:%s in dialog 0x%X' % (label, dlg))


# Event times are seconds after the main menu first opened; --press and
# --select wait for their dialog on top of that, so they only need to come in
# the right order. One second apart is plenty.
class Script:
    def __init__(self):
        self.args, self.t, self.expect = [], 1.0, []

    def press(self, dlg, label, opens=None):
        """`label` is a GUI: caption, or a control ID for an uncaptioned one."""
        if TARGET == 'game' and dlg == SKIRMISH and label == 'StartGame':
            # Red Alert 2's skirmish starts at the fastest speed, uncapped: a few
            # hundred frames a second headless, and the AI wins in seconds. Its
            # INI setting does not hold (the dialog writes its own back), so
            # set the slider as a player would: one notch down, Yuri's
            # Revenge's GameSpeed=1.
            self.select(SKIRMISH, 1321, 5)
        cid = label if isinstance(label, int) else control(dlg, label)
        self.args += ['--press', '0x%X:%d@%g' % (dlg, cid, self.t)]
        self.t += 1
        if opens is not None:
            self.expect.append(opens)
        return self

    def select(self, dlg, ctrl, n):
        self.args += ['--select', '0x%X:%d=%d@%g' % (dlg, ctrl, n, self.t)]
        self.t += 1
        return self

    def waitlog(self, text):
        """Hold until the game's debug log prints `text` (Capture_Mouse: in game)."""
        self.args += ['--waitlog', '%s@%g' % (text, self.t)]
        self.t += 1
        return self

    def move(self, x, y, after=0):
        self.t += after
        self.args += ['--move', '%d,%d@%g' % (x, y, self.t)]
        self.t += 1
        return self

    def click(self, x, y, after=0, mods=''):
        """A left click at game pixel x, y; mods 'c', 's', 'a' held with it
        (Ctrl+click is force-fire)."""
        self.t += after
        self.args += ['--click', '%s%d,%d@%g' % (mods + '+' if mods else '', x, y, self.t)]
        self.t += 1
        return self

    def drag(self, x1, y1, x2, y2, after=0):
        """A band selection from x1, y1 to x2, y2 (game pixels)."""
        self.t += after
        self.args += ['--drag', '%d,%d,%d,%d@%g' % (x1, y1, x2, y2, self.t)]
        self.t += 2
        return self

    def select_mcv(self, after=0):
        """Select the starting MCV. The native host's start position is random, so a band
        over the whole view; the browser's is fixed, where the band does not select and a
        click on the MCV (236, 213 at 640x480) does."""
        if '--web' in sys.argv:
            return self.click(236, 213, after=after)
        return self.drag(8, 8, 470, 440, after=after)

    def key(self, vk, after=0):
        self.t += after
        self.args += ['--key', '%s@%g' % (vk, self.t)]
        self.t += 1
        return self


def S():
    return Script()


# name: (script, seconds the run lasts, what it must show)
#   expect 'dialogs': every listed dialog opened
#   expect 'ingame':  the game started (its own Capture_Mouse() log line) and
#                     the picture kept changing (5+ distinct sampled frames)
#   expect 'alive':   no human player was defeated
#   expect 'exit':    the exit code
#   expect 'ini':     RA2MD.INI values for the case's game folder, {section: {key: value}}
#   expect 'size':    the picture in game is this (w, h)
CASES = {}


def case(name, script, seconds=60, **expect):
    expect.setdefault('dialogs', script.expect)
    CASES[name] = (script.args, seconds, expect)


case('menu-idle', S(), 40, dialogs=[MAIN])

# Every main-menu button, and the way back from each screen it opens. Exit
# Game asks first (dialog 0x120, OK/Cancel), so an exit is two presses; a
# clean exit 0 proves the main menu came back and still works.
EXIT = lambda s: s.press(MAIN, 'ExitGame', CONFIRM).press(CONFIRM, 'OK')
for label, dlg in [('SinglePlayer', SINGLE), ('Options', OPTIONS), ('Network', LAN),
                   ('MoviesAndCredits', MOVIES), ('WWOnline', 0x10E)]:
    case('menu-' + label.lower(), S().press(MAIN, label, dlg))
case('menu-exit', EXIT(S()), 60, exit=0)
case('menu-exit-cancel', S().press(MAIN, 'ExitGame', CONFIRM).press(CONFIRM, 'Cancel', MAIN))

case('back-singleplayer', EXIT(S().press(MAIN, 'SinglePlayer', SINGLE).press(SINGLE, 'MainMenu')), 60, exit=0)
case('back-options', EXIT(S().press(MAIN, 'Options', OPTIONS).press(OPTIONS, 'MainMenu')), 60, exit=0)
case('back-movies', EXIT(S().press(MAIN, 'MoviesAndCredits', MOVIES).press(MOVIES, 'MainMenu')), 60, exit=0)
case('back-network', EXIT(S().press(MAIN, 'Network', LAN).press(LAN, 'MainMenu')), 60, exit=0)

# The LAN lobby's New Game: the host's game setup screen.
case('lan-new', S().press(MAIN, 'Network', LAN).press(LAN, 'New', NEWLAN))

# Single player's three doors.
SP = lambda: S().press(MAIN, 'SinglePlayer', SINGLE)
case('sp-skirmish', SP().press(SINGLE, 'Skirmish', SKIRMISH))
case('sp-campaign', SP().press(SINGLE, 'NewCampaign', CAMPAIGN))
case('sp-load', SP().press(SINGLE, 'LoadSavedGame', LOADGAME))

# Options' sub-screens and the movie/credit players.
case('options-keyboard', S().press(MAIN, 'Options', OPTIONS).press(OPTIONS, 'Keyboard', KEYBOARD))
case('movies-credits', S().press(MAIN, 'MoviesAndCredits', MOVIES).press(MOVIES, 'ViewCredits'), 90)
case('movies-sneakpeeks', S().press(MAIN, 'MoviesAndCredits', MOVIES).press(MOVIES, 'SneakPeeks'), 90)

# Into the game. A skirmish on the default map and settings; each campaign
# from the campaign screen's list (0 and 1: Allied and Soviet), at the
# default difficulty. In game the screen is blitted every frame, so the frame
# count says the game is running, and the sheet says what it shows.
# A skirmish played through by nobody: in game, H (centre on base -- headless,
# the view starts off the player's base and shows only black shroud; the
# original does the same, so it is the host's), then nothing. The idle player
# is beaten (at start 52,97 in about 4.5 minutes, on the shipping code too),
# the skirmish score screen opens, and Continue goes back to the main menu:
# the whole loop, start to menu.
INGAME = 'Capture_Mouse'
case('skirmish-start', SP().press(SINGLE, 'Skirmish', SKIRMISH).press(SKIRMISH, 'StartGame')
     .waitlog(INGAME).move(236, 240, after=2).key('0x48', after=10), 180, ingame=True)
# Orders by mouse: select and deploy the MCV, band-select everything on
# screen, then Ctrl+click (force-fire) at two of the tanks. Written to put
# explosions and debris (voxel animations) under the camera; it has not yet
# (docs/voxels.md), but it keeps --drag and modifier clicks working. The voxel
# animations and debris that follow are drawn at 2x with HD voxels
# (docs/voxels.md); this case is how they are exercised.
case('skirmish-forcefire', SP().press(SINGLE, 'Skirmish', SKIRMISH).press(SKIRMISH, 'StartGame')
     .waitlog(INGAME).move(236, 240, after=2).key('0x48', after=10)
     .click(236, 213, after=2).key('0x44', after=1)
     .drag(8, 8, 464, 440, after=15).click(352, 158, after=1, mods='c').click(110, 277, after=20, mods='c'),
     180, ingame=True)
# Building and training: deploy the MCV; build a power plant from the
# sidebar's first icon and place it beside the construction yard; then a
# barracks (the second row's first icon, once power is up) the same way; then
# the infantry tab and a GI. Each order is checked in the game's own event log
# (PRODUCE for each of the three, PLACE for the two buildings). Sidebar
# coordinates are for 640x480 (tabs: buildings, defences, infantry, vehicles);
# a hover first, as a player's cursor would be.
# Around the construction yard, near first: the first spot no unit stands on
# builds; a click on a taken spot is refused and costs nothing.
PLACES = [(330, 250), (150, 250), (236, 320), (330, 320), (120, 170), (130, 330), (380, 180),
          (360, 360), (90, 260), (400, 280), (236, 390), (110, 400), (380, 420), (70, 150)]


def place(script):
    for x, y in PLACES:
        script = script.click(x, y, after=1)
    return script


case('skirmish-build', place(place(
    SP().press(SINGLE, 'Skirmish', SKIRMISH).press(SKIRMISH, 'StartGame')
    .waitlog(INGAME).move(236, 240, after=2).key('0x48', after=10)
    .select_mcv(after=2).key('0x44', after=1).waitlog('Adding event DEPLOY')
    .move(523, 251, after=8).click(523, 251, after=1)                   # power plant
    .move(523, 251, after=28).click(523, 251, after=1))                  # ready: pick it up
    .move(523, 300, after=4).click(523, 300, after=1)                   # barracks
    .move(523, 300, after=31).click(523, 300, after=1))                  # ready: pick it up
    .move(573, 210, after=4).click(573, 210, after=1)                   # the infantry tab (third)
    .move(523, 251, after=2).click(523, 251, after=1),                  # a GI
    # Red Alert 2's Brutal AI beats an idle player within the run, so the player's
    # survival is not asked; the third cameo (the GI) comes after that, so two builds are.
    230, ingame=True, log={'Adding event PRODUCE': 2, 'Adding event PLACE': 2},
    # The sidebar's coordinates are 640x480's, whatever the player's INI says
    # (a CnCNet install had 3440x1440, and every click missed the sidebar).
    ini={'Video': {'ScreenWidth': 640, 'ScreenHeight': 480}})

case('skirmish-loop', SP().press(SINGLE, 'Skirmish', SKIRMISH).press(SKIRMISH, 'StartGame')
     .waitlog(INGAME).move(236, 240, after=2).key('0x48', after=10)
     .press(0x108, 'Continue', MAIN), 720, ingame=True)
# The campaign screen starts a campaign from its emblems: uncaptioned static
# controls, Allied on top (1770) and Soviet below (1772), with "Click the
# Allied icon to start Allied campaign" under each (tools/dialogs.py --show 0x94).
for side, emblem in [('allied', 1770), ('soviet', 1772)]:
    case('campaign-' + side, SP().press(SINGLE, 'NewCampaign', CAMPAIGN)
         .press(CAMPAIGN, emblem).waitlog(INGAME).move(236, 240, after=2).key('0x48', after=10),
         300, ingame=True, alive=True)


def set_ini(text, section, key, value):
    """RA2MD.INI with [section] key=value set, the section added if missing."""
    lines = text.split(b'\r\n') if b'\r\n' in text else text.split(b'\n')
    want = b'[' + section.encode() + b']'
    out, in_sec, done = [], False, False
    for l in lines:
        if l.strip().startswith(b'['):
            if in_sec and not done:
                out.append(b'%s=%s' % (key.encode(), str(value).encode()))
                done = True
            in_sec = l.strip().lower() == want.lower()
        elif in_sec and l.split(b'=')[0].strip().lower() == key.lower().encode():
            if not done:
                out.append(b'%s=%s' % (key.encode(), str(value).encode()))
                done = True
            continue
        out.append(l)
    if not done:
        if not in_sec:
            out += [b'', want]
        out.append(b'%s=%s' % (key.encode(), str(value).encode()))
    return b'\r\n'.join(out)


# Hi-res and widescreen: the game's own resolution setting, the in-game
# picture at that size, in a skirmish and a campaign (docs/hires.md).
RES = [(1280, 720), (1366, 768), (1920, 1080), (2560, 1440), (3440, 1440), (3840, 2160), (5120, 1440)]
for w, h in RES:
    video = {'Video': {'ScreenWidth': w, 'ScreenHeight': h}}
    seconds = 300 if (w, h) == (5120, 1440) else 180
    resolution_expect = dict(ingame=True, size=(w, h), mode_sequence=[(800, 600), (w, h)], ini=video)
    if (w, h) == (5120, 1440):
        # Recording/downscaling a 5K frame holds the game's surface lock for
        # too long. Verify the full mode cycle without the optional recorder.
        resolution_expect.update(no_record=True, min_distinct=0, defeated=True,
                                 mode_sequence=[(800, 600), (w, h), (800, 600)])
    case('res-%dx%d' % (w, h), SP().press(SINGLE, 'Skirmish', SKIRMISH).press(SKIRMISH, 'StartGame')
         .waitlog(INGAME).move(w // 2 - 80, h // 2, after=2).key('0x48', after=10),
         seconds, **resolution_expect)
# Picking a size in Options: no "display mode will be changed" confirm (0xD9),
# and the size is what the next skirmish opens at. Combo 1773 lists the sizes
# from 640x480 up, so index 4 is 1280x720 (the host's list, src/runtime/host.c).
if TARGET == 'game':
    case('options-pick-size', S().press(MAIN, 'Options', OPTIONS).select(OPTIONS, 1773, 4)
         .press(OPTIONS, 'MainMenu').press(MAIN, 'SinglePlayer', SINGLE).press(SINGLE, 'Skirmish', SKIRMISH)
         .press(SKIRMISH, 'StartGame').waitlog(INGAME).move(560, 360, after=2).key('0x48', after=10),
         240, ingame=True, size=(1280, 720), mode_sequence=[(800, 600), (1280, 720)], absent=[0xD9])
if TARGET == 'game':
    # The in-game menu (Escape) at the toggled size: the last frame has to show its
    # sidebar piece at the right edge (docs/ra2-resolution-handoff.md).
    case('res-pause-menu-1280x720', SP().press(SINGLE, 'Skirmish', SKIRMISH).press(SKIRMISH, 'StartGame')
         .waitlog(INGAME).move(560, 360, after=2).key('0x1B', after=10),
         180, ingame=True, size=(1280, 720), mode_sequence=[(800, 600), (1280, 720)],
         ini={'Video': {'ScreenWidth': 1280, 'ScreenHeight': 720}})
case('res-campaign-1920x1080',SP().press(SINGLE, 'NewCampaign', CAMPAIGN).press(CAMPAIGN, 1770)
     .waitlog(INGAME).move(880, 540, after=2).key('0x48', after=10), 300, ingame=True, alive=True,
     size=(1920, 1080), ini={'Video': {'ScreenWidth': 1920, 'ScreenHeight': 1080}})


def farm(d, ini=None):
    """A private game folder for one case, made of hard links to game/.

    The game writes into its folder (RA2MD.INI, saves, debug files), so cases
    sharing one would clobber each other; links cost no space. RA2MD.INI is
    copied, with the intro off: four minutes of cinematic before every case
    is a waste, and the intro has its own case in tools/conformance.py.
    """
    src = os.path.join(ROOT, 'game')
    for dirpath, dirs, files in os.walk(src):
        out = os.path.join(d, os.path.relpath(dirpath, src))
        os.makedirs(out, exist_ok=True)
        for f in files:
            t = os.path.join(out, f)
            if f.upper() == GAME_INI:
                if os.path.exists(t):
                    os.remove(t)
                text = open(os.path.join(dirpath, f), 'rb').read()
                text = re.sub(rb'(?im)^Play=\w+', b'Play=no', text)
                for sec, kv in (ini or {}).items():
                    for k, v in kv.items():
                        text = set_ini(text, sec, k, v)
                open(t, 'wb').write(text)
            elif not os.path.exists(t):
                try:
                    os.link(os.path.join(dirpath, f), t)
                except OSError:                      # game/ on another drive (a Steam library): a symlink
                    os.symlink(os.path.join(dirpath, f), t)
    return d


def run(name, args, seconds, expect, every, original=False, web=None, web_headed=False, web_import=False):
    d = os.path.join(OUT, name + ('.web' if web else '.original' if original else ''))
    if os.path.isdir(os.path.join(d, 'game')):
        shutil.rmtree(os.path.join(d, 'game'))      # a fresh folder: no saves left over
    os.makedirs(d, exist_ok=True)
    game = farm(os.path.join(d, 'game'), expect.get('ini'))
    mp4, log = os.path.join(d, 'run.mp4'), os.path.join(d, 'run.log')
    cmd = WINE + [HOST, '--headless', '--run', '--mute', '--debuglog', '--watchdog', str(seconds)]
    if not expect.get('no_record'):
        cmd += ['--record', host_path(mp4)]
    cmd += ['--exe', host_path(os.path.join(game, GAME_EXE)),
                  '--game', host_path(game)] + args
    cmd += os.environ.get('RA2_HOST_ARGS', '').replace('{case}', d).split()  # extra host flags; {case} is the case's folder
    if original:
        cmd.append('--original')
    if web:
        config = os.path.join(d, 'browser.json')
        with open(config, 'w') as f:
            json.dump({'game': game, 'output': d, 'seconds': seconds, 'every': every,
                       'args': args + shlex.split(os.environ.get('RA2_HOST_ARGS', '')),
                       'url': web, 'target': TARGET, 'headed': web_headed, 'import': web_import}, f)
        cmd = ['node', os.path.join(ROOT, 'web', 'e2e', 'playtest.mjs'), config]
    lan = WINE and ('network' in name or 'lan' in name)
    with open(log, 'w', errors='replace') as f, (IPX if lan else contextlib.nullcontext()):
        try:
            code = subprocess.run(cmd, cwd=ROOT, stdout=f, stderr=subprocess.STDOUT,
                                  timeout=seconds + 360).returncode
        except subprocess.TimeoutExpired:
            code = 'timeout'
    text = open(log, errors='replace').read()
    if os.path.exists(mp4):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mp4, '-vf',
                        'fps=1/%g,scale=320:-1,tile=4x4' % max(every, seconds / 16.0), '-frames:v', '1',
                        os.path.join(d, 'sheet.png')], cwd=ROOT)
    lines = text.splitlines()
    # An unresolved ICALL returns 0 and the game carries on: the voxel
    # rasterizer was one, and every vehicle was invisible (docs/voxels.md).
    bad = [l for l in lines if l.startswith(('===', '[not-lifted]', 'ITAIL', 'ICALL', '[messagebox]'))]
    bad += [l for l in lines if l.startswith('[input]') and ('never opened' in l or 'no such control' in l)]
    opened = []
    for m in re.finditer(r'\[dialog\] open 0x([0-9A-F]+)', text):
        if not opened or opened[-1] != m.group(1):
            opened.append(m.group(1))
    distinct = len(set(re.findall(r'\[record\] frame \d+ (?:at \S+ )?checksum ([0-9A-F]{8})', text)))
    ingame = '[game] Capture_Mouse()' in text
    modes = re.findall(r'\[(?:headless|ddraw)\] SetDisplayMode\((\d+)x(\d+)x\d+\)', text)
    mode_sizes = [tuple(map(int, mode)) for mode in modes]
    defeated = re.search(r'\[game\] MPlayer_Defeated\(\) - Player <human player> has been defeated', text)
    seen = ['dialogs ' + ' '.join(opened)] if opened else []
    if ingame:
        seen.append('in game (no recording)' if expect.get('no_record') else 'in game, %d distinct frames' % distinct)
    if defeated:
        seen.append('human defeated')
    for dlg in expect.get('dialogs', []):
        if '%X' % dlg not in opened:
            bad.append('dialog 0x%X never opened' % dlg)
    # absent: dialogs that must not open (the size confirm 0xD9, once a size is picked)
    for dlg in expect.get('absent', []):
        if '%X' % dlg in opened:
            bad.append('dialog 0x%X opened, it must not' % dlg)
    min_distinct = expect.get('min_distinct', 5)
    if expect.get('ingame') and not (ingame and distinct >= min_distinct):
        bad.append('never in game' if not ingame else 'picture stopped (%d frames)' % distinct)
    if 'size' in expect and tuple(expect['size']) not in mode_sizes:
        bad.append('never entered %dx%d (modes: %s)' %
                   (*expect['size'], ' -> '.join('%dx%d' % size for size in mode_sizes) or 'none'))
    if 'mode_sequence' in expect:
        at = 0
        for size in expect['mode_sequence']:
            try:
                at = mode_sizes.index(tuple(size), at) + 1
            except ValueError:
                bad.append('mode sequence %s missing from %s' %
                           (' -> '.join('%dx%d' % tuple(size) for size in expect['mode_sequence']),
                            ' -> '.join('%dx%d' % size for size in mode_sizes) or 'none'))
                break
    if modes and ingame:
        seen.append('modes ' + ' -> '.join('%dx%d' % size for size in mode_sizes))
    if expect.get('alive') and defeated:
        bad.append('the human player was defeated')
    if expect.get('defeated') and not defeated:
        bad.append('the human player was not defeated before the watchdog')
    # log: {text: at least n}, lines the game's own debug log must print
    # ("Adding event PRODUCE" for each order to build or train).
    for text, n in expect.get('log', {}).items():
        got = sum(text in l for l in lines)
        if got < n:
            bad.append('"%s" %d times, wanted %d' % (text, got, n))
        elif n:
            seen.append('%s x%d' % (text.split()[-1].lower(), got))
    if 'exit' in expect and code != expect['exit']:
        bad.append('expected exit %d' % expect['exit'])
    elif 'exit' not in expect and code not in (0, 4):
        bad.append('exit %s' % code)
    return name, code, bad, seen


def main():
    global OUT
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cases', nargs='*', help='case names or globs (default: all)')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--jobs', type=int, default=3)
    ap.add_argument('--every', type=float, default=5, help='contact-sheet spacing, seconds')
    ap.add_argument('--original', action='store_true', help='run the shipping code instead (oracle.c)')
    ap.add_argument('--web', action='store_true', help='run the same cases in Chromium against the built page')
    ap.add_argument('--headed', action='store_true', help='show Chromium during --web runs')
    ap.add_argument('--web-import', action='store_true',
                    help='with --web: import the case folder into OPFS as the launcher does, and play from there '
                         '(the game is read in place: needs the dev server, and no memory for a full copy)')
    ap.add_argument('--web-url', default='http://127.0.0.1:4173/', help='built page on pnpm preview')
    ap.add_argument('--out', help='artifact directory (use separate directories for concurrent runs)')
    a = ap.parse_args()
    if a.out:
        OUT = os.path.abspath(a.out)
    if a.web and a.original:
        ap.error('--original runs native machine code and cannot be used with --web')
    if a.web_import and not a.web:
        ap.error('--web-import requires --web')
    if a.headed and not a.web:
        ap.error('--headed requires --web')
    if a.list:
        for n, (args, s, e) in CASES.items():
            print('%-20s %4ds  %s' % (n, s, ' '.join(args)))
        return 0
    if not ((a.web or os.path.exists(HOST)) and os.path.isdir(os.path.join(ROOT, 'game'))):
        print('playtest: skipped -- needs game/ (your copy) and build/ra2.exe (README)')
        return 0
    names = [n for n in CASES if not a.cases or any(fnmatch.fnmatch(n, p) for p in a.cases)]
    if not names:
        ap.error('no cases match the requested names')
    failed = 0
    os.makedirs(OUT, exist_ok=True)
    summary = open(os.path.join(OUT, 'summary%s.txt' % ('.web' if a.web else '.original' if a.original else '')), 'w')
    with ThreadPoolExecutor(a.jobs) as ex:
        for name, code, bad, seen in ex.map(lambda n: run(n, *CASES[n], a.every, a.original,
                                                       a.web_url if a.web else None, a.headed, a.web_import), names):
            name += '.web' if a.web else '.original' if a.original else ''
            line = '%s %-20s exit %-7s %s%s' % ('FAIL' if bad else 'pass', name, code, '; '.join(seen) or '-',
                                                ('  !! ' + ' | '.join(bad[:3])) if bad else '')
            print(line, flush=True)
            summary.write(line + '\n')
            summary.flush()
            failed += bool(bad)
    print('%d of %d failed' % (failed, len(names)))
    summary.write('%d of %d failed\n' % (failed, len(names)))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
