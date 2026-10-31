#!/usr/bin/env python3
"""Red Alert 2: Yuri's Revenge lift driver: work/functions.json -> src/recomp/gen/.

Drives pcrecomp's shared `tools/lift/generate.py` + `lift32`, the same shape
as The Movies' and Force Commander's run_lift.py (docs/architecture.md):

* **Closure-limited lifting** (`generate.closure`). Lift the call-graph closure
  from the OEP and give every other catalogued function a stub that aborts
  naming itself, so a run says exactly what to lift next. Bring-up uses --all
  (gamemd.exe is ~1M instructions, which compiles in minutes); the closure is
  there for bisecting a bad lift.
* **Extents by walking the branches** (`generate.true_extent`), capped by
  reach rather than the catalog's clamp; its docstring has why.

Every vtable slot RTTI names is injected as an entry (work/rtti_seeds.json):
MSVC's vtordisp adjustor thunks are reachable only through a vtable, so no
disassembler pass names them, and an unresolved slot answers eax = 0.

    py -3 run_lift.py                      # OEP closure, 3000 functions
    py -3 run_lift.py --max 20000
    py -3 run_lift.py --roots 0x007CD80F,0x004A1C30
    py -3 run_lift.py --virtual --max 60000   # plus every vtable method
    py -3 run_lift.py --all
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
# PCRECOMP picks another toolkit checkout, the same knob CMakeLists.txt has:
# the lifter and the runtime header must come from the same tree.
# Else ../pcrecomp, or ../tools where older setups put it.
_KIT = os.path.join(_HERE, '..', 'pcrecomp')
if not os.path.isdir(_KIT) and os.path.isdir(os.path.join(_HERE, '..', 'tools', 'runtime')):
    _KIT = os.path.join(_HERE, '..', 'tools')
_TOOLS = os.path.join(os.environ.get('PCRECOMP', _KIT), 'tools')
sys.path.insert(0, os.path.join(_TOOLS, 'lift'))
sys.path.insert(0, os.path.join(_TOOLS, 'pe'))

from capstone import Cs, CS_ARCH_X86, CS_MODE_32          # noqa: E402
from generate import (EXTENT_REACH, closure, find_splits, true_extent,  # noqa: E402
                      linear_disassemble_function, lift_function_linear, write_chunk)
from lift32 import Lifter                                  # noqa: E402
from pe_analyze import analyze_pe, build_iat_map           # noqa: E402

EXE = os.path.join(_HERE, 'game', 'gamemd.exe')
CATALOG = os.path.join(_HERE, 'work', 'functions.json')
SEEDS = os.path.join(_HERE, 'work', 'rtti_seeds.json')
OUT = os.path.join(_HERE, 'src', 'recomp', 'gen')
STATS = os.path.join(_HERE, 'work', 'lift_stats.json')

# Entries the catalog does not find, so a clean checkout lifts them too
# (docs/bringup.md 1 and 11). The CRT's static constructors are reachable only
# through the _initterm table; two window procedures are named only by a
# `mov reg, imm` behind a jump table. An unresolved ICALL answers eax = 0 and
# carries on, so a missing one shows up far from its cause.
RUN_SEEDS = [
    # static constructors
    0x0040FF90, 0x00410010, 0x0045B110, 0x004F4100, 0x005394C0, 0x0055F760,
    0x006A4AF0, 0x006E88B0, 0x006F2A50, 0x0071B740, 0x00747090, 0x0076F700,
    0x00777380,
    # window procedures (skirmish setup and its sub-dialogs)
    0x006163A0, 0x00618D40,
]

# Functions whose body is the host's instead of the lift: the host defines
# ra2_hook_<name>(void) and it runs like an import shim (arguments from
# g_esp, pops its own return address). src/runtime/host.c.
HOOKS = {
    # The debug printf. Compiled out of the retail build (a bare `ret`), so
    # the host gives it a body: --debuglog prints the game's own log, which
    # says what init is doing at a fraction of --argtrace's cost.
    0x004068E0: 'debuglog',
}

# ---- remaster patches: C emitted after one instruction ---------------------
# The lift stays faithful; a patch is a line of C added after an instruction
# the game repo names, for a fix the original game cannot have. The --original
# oracle runs the shipping code unpatched, so it remains the reference.

SIDEBAR_ROWS_MAX = 30


def dropdown_frame_patches(code, cs):
    """Copy the custom dropdown's two-pixel frame with its client image.

    ComboDropWin paints into AlternateSurface, including a frame two pixels
    outside its client rectangle. Its last copy to PrimarySurface covers only
    the client. Windows later repaints the parent and copies the missing edges;
    a host that paints just the invalid child leaves them offscreen (W4.17).
    Expand both copy rectangles so this paint publishes everything it drew.

    Find the final virtual Copy, the Primary/Alternate Unlock pair, and the
    trailing ValidateRect. The same sequence occurs once in each shipping exe
    (YR 0x0060E0A0, RA2 0x005EB880); the globals differ between the games.
    """
    pattern = re.compile(
        rb'\xff\x50\x08\x8b\x0d(.{4})\x8b\x01\xff\x50\x60'
        rb'\x8b\x0d(.{4})\x8b\x11\xff\x52\x60\x8b\x84\x24', re.S)
    out = {}
    for match in pattern.finditer(code):
        at = match.start()
        # lea edx,[esp+dst]; push edx immediately before Copy, followed by
        # mov eax,[esp+hwnd]; push 0; push eax; call [ValidateRect].
        if (code[at - 5:at - 2] != b'\x8d\x54\x24' or code[at - 1:at] != b'\x52'
                or code[match.end() + 4:match.end() + 9] != b'\x6a\x00\x50\xff\x15'
                or match[1] == match[2]):
            continue
        out[cs + at - 1] = (
            '{ uint32_t dst = MEM32(esp), src = MEM32(esp + 8); '
            'MEM32(dst) -= 2; MEM32(dst + 4) -= 2; '
            'MEM32(dst + 8) += 4; MEM32(dst + 12) += 4; '
            'if (src != dst) { MEM32(src) -= 2; MEM32(src + 4) -= 2; '
            'MEM32(src + 8) += 4; MEM32(src + 12) += 4; } } '
            '/* remaster: copy the drawn dropdown frame, run_lift.py dropdown_frame_patches */')
    # Do not guess among ambiguous copies in a different or modified build.
    return out if len(out) == 1 else {}


def sidebar_rows_patches(code, cs, lo=0x006A5000, hi=0x006AD000, globals_=(0x00886F9C, 0x00B0B4F8)):
    """The sidebar's cameo rows, capped at 30 so 4K fits its button array.

    The sidebar keeps its cameo buttons in a static array at 0x00B07E80: 240
    buttons, four tabs of 60 (0x006A4DC0 builds them; index = tab * 60 + i).
    Its height says how many rows of two to lay out, (height - 26 - top) / 50,
    and at 2160 lines that is about 41 rows: 82 buttons, past the tab's 60 and
    at the last tab past the array (docs/hires.md). Every place that computes
    the row count divides by 50 the same way -- imul by 0x51EB851F, sar 4, then
    `add r, (r >> 31)` to round toward zero -- so each is found by that shape,
    in the sidebar code that reads the sidebar's height (0x00886F9C) or its top
    (0x00B0B4F8), and the result register is capped right after the add. Up to
    1440 lines nothing changes (27 rows or fewer).
    """
    md = Cs(CS_ARCH_X86, CS_MODE_32)
    magic = b'\xb8\x1f\x85\xeb\x51'                      # mov eax, 0x51EB851F
    refs = tuple(g.to_bytes(4, 'little') for g in globals_)   # its height, its top
    out, i = {}, code.find(magic)
    while i != -1:
        va = cs + i
        if lo <= va < hi and any(r in code[max(0, i - 0x30):i] for r in refs):
            shr = None
            for ins in md.disasm(code[i:i + 0x30], va):
                if ins.mnemonic == 'shr' and ins.op_str.endswith(', 0x1f'):
                    shr = ins.op_str.split(',')[0]
                elif shr and ins.mnemonic == 'add' and ins.op_str.split(', ')[1] == shr:
                    reg = ins.op_str.split(',')[0]
                    out[ins.address] = ('if ((int32_t)%s > %d) %s = %d; /* remaster: sidebar rows, '
                                        'run_lift.py sidebar_rows_patches */' % (reg, SIDEBAR_ROWS_MAX, reg,
                                                                                 SIDEBAR_ROWS_MAX))
                    break
        i = code.find(magic, i + 1)
    return out


# HD voxels (docs/voxels.md). The finish stage of a unit's render, 0x00754510,
# turns its depth-sorted section records into pixels in the 256x256 buffer.
# Run three more times with each span's start moved half a pixel, and the four
# images interleave into one at twice the resolution: each pass is a complete,
# hole-free render, so the result is a true 2x sampling of the model. The
# rasterizers walk 8.8 fixed point in a 256-wide buffer, which a 2x projection
# would overflow; half-pixel starts stay inside it. Gated at run time by the
# host (src/runtime/hdvox.c): off, nothing here does anything.
def _hd_passes(arg):
    """C for the three extra runs of 0x00754510, ecx = esp + arg each time."""
    return ('{ extern int ra2_vox_hd_begin(uint32_t); extern void ra2_vox_hd_pass(int); '
            'extern uint32_t ra2_vox_hd_end(void); '
            'if (ra2_vox_hd_begin(eax)) { for (int _k = 1; _k < 4; _k++) { ra2_vox_hd_pass(_k); '
            'ecx = esp + 0x%X; RECOMP_CALL(sub_00754510); } eax = ra2_vox_hd_end(); } } '
            '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */' % arg)


def _hd_passes_7542f0():
    """C for the three extra runs of 0x007542F0, the finish stage voxel
    animations and debris use: ecx = esp+0x44 (its rect), edx = esp+0x20, one
    stack argument esp+0x1C (it returns with ret 4). Its outputs, esp+0x1C to
    esp+0x5C, are put back afterwards."""
    return ('{ extern int ra2_vox_hd_begin_at(uint32_t, uint32_t); extern void ra2_vox_hd_pass(int); '
            'extern uint32_t ra2_vox_hd_end(void); uint32_t _eax = eax; '
            'if (ra2_vox_hd_begin_at(esp + 0x1C, 0x40)) { for (int _k = 1; _k < 4; _k++) { ra2_vox_hd_pass(_k); '
            'ecx = esp + 0x44; edx = esp + 0x20; esp -= 4; MEM32(esp) = esp + 4 + 0x1C; '
            'RECOMP_CALL(sub_007542F0); } ra2_vox_hd_end(); } eax = _eax; } '
            '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */')


HD_VOXEL_PATCHES = {
    # 0x00756590: the span record handed to the rasterizer is at esp+0x20; its
    # starts, x at +0x18 and y at +0x1A, are 8.8 fixed point.
    0x0075683E: ('{ extern int16_t ra2_vox_dx, ra2_vox_dy; '
                 'MEM16(eax + 0x18) += ra2_vox_dx; MEM16(eax + 0x1A) += ra2_vox_dy; } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    # 0x00706ED0, just after the finish stage returned its rect (eax): the
    # extra passes, with the same argument (ecx = esp+0x4C). It preserves
    # ebx/esi/edi/ebp; ecx and edx are dead here.
    0x00706FEF: _hd_passes(0x4C),
    # 0x00706ED0 blits the 1x render onto the battlefield with 0x004AF2A0
    # (ecx the destination surface, edx the palette converter; on the stack
    # the source surface, its rect, the destination point, ...). Just before
    # and just after that call the host looks at the destination, to place
    # the 2x image where the 1x one went.
    0x00707233: ('{ extern void ra2_vox_hd_blit(uint32_t, uint32_t, uint32_t); ra2_vox_hd_blit(ecx, edx, esp); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    0x00707235: ('{ extern void ra2_vox_hd_blitted(void); ra2_vox_hd_blitted(); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    # 0x004373B0, the surface-to-surface blitter, after its `sub esp, 0x4C`:
    # its copy into the frame surface ends a frame, and the host publishes
    # the 2x layer it built during it.
    0x004373B0: ('{ extern void ra2_vox_frame_blit(uint32_t, uint32_t); ra2_vox_frame_blit(ecx, esp + 0x4C + 4); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    # 0x00706640: no voxel cache while HD voxels are on, so every unit is
    # rendered (and at 2x) each frame: a cache key of -1 is the path the
    # rules' DisableVoxelCache already takes.
    0x007067E4: ('{ extern int ra2_vox_hd_on; if (ra2_vox_hd_on) { eax = 0xFFFFFFFFu; MEM32(esp + 0x5C) = eax; } } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    # 0x0073B140: a unit's finished staging image (body, turret, barrel)
    # copied onto the battlefield by 0x004373B0: dest rect, staging surface,
    # source rect on the stack, the destination surface in ecx.
    0x0073B43F: ('{ extern void ra2_vox_unit_copy(uint32_t, uint32_t); ra2_vox_unit_copy(ecx, esp); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    0x0073B446: ('{ extern void ra2_vox_unit_copied(void); ra2_vox_unit_copied(); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    # Shadows. 0x00707280 renders a unit's shadow: sections through
    # 0x00753F90, then the same finish stage (0x00754510, ecx = esp+0x28), its
    # records plotted by 0x00756860, whose start is 8.8 fixed point at
    # [esp+0x5C] (x) and [esp+0x5E] (y) once both are stored.
    0x007568F0: ('{ extern int16_t ra2_vox_dx, ra2_vox_dy; '
                 'MEM16(esp + 0x5C) += ra2_vox_dx; MEM16(esp + 0x5E) += ra2_vox_dy; } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    # 0x00706BD0 draws a shadow from its own cache (a hit through 0x00707480,
    # a miss renders without blitting and goes back to the cache); key -1
    # (ebx, [esp+0x58]) renders and blits every time.
    0x00706C10: ('{ extern int ra2_vox_hd_on; if (ra2_vox_hd_on) { ebx = 0xFFFFFFFFu; MEM32(esp + 0x58) = ebx; } } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    0x00707387: _hd_passes(0x28),
    # Voxel animations and debris (VoxelAnimClass::Draw_It, 0x00749B70): a
    # shadow and then the body, each through 0x007542F0 and blitted onto the
    # battlefield by 0x004AF2A0. Opt-in (RA2_HD_VOXEL_ANIMS=1): no test yet
    # puts one on screen (docs/voxels.md).
    0x00749CFA: _hd_passes_7542f0(),
    0x00749D6D: ('{ extern void ra2_vox_anim_shadow_blit(uint32_t, uint32_t); ra2_vox_anim_shadow_blit(ecx, esp); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    0x00749D6E: ('{ extern void ra2_vox_anim_shadow_blitted(void); ra2_vox_anim_shadow_blitted(); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    0x00749DE6: _hd_passes_7542f0(),
    0x00749EE2: ('{ extern void ra2_vox_anim_blit(uint32_t, uint32_t, uint32_t); ra2_vox_anim_blit(ecx, edx, esp); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    0x00749EE4: ('{ extern void ra2_vox_anim_blitted(void); ra2_vox_anim_blitted(); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    # ...and blits the shadow with 0x004AF2A0 (the shadow converter in edx).
    0x00707431: ('{ extern void ra2_vox_shadow_blit(uint32_t, uint32_t); ra2_vox_shadow_blit(ecx, esp); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
    0x00707432: ('{ extern void ra2_vox_shadow_blitted(void); ra2_vox_shadow_blitted(); } '
                 '/* remaster: HD voxels, run_lift.py HD_VOXEL_PATCHES */'),
}


# The same sites in Red Alert 2 (game.exe), found by their shapes: the same
# instructions and stack offsets, but for the frame blitter's frame (0x48).
HD_VOXEL_SITES_GAME = {
    0x0075683E: 0x00719BEE, 0x00706FEF: 0x006D25E3, 0x00707233: 0x006D27E6, 0x00707235: 0x006D27E8,
    0x004373B0: 0x00434B40, 0x007067E4: 0x006D1E18, 0x0073B43F: 0x006FF66C, 0x0073B446: 0x006FF670,
    0x007568F0: 0x00719CA0, 0x00706C10: 0x006D2220, 0x00707387: 0x006D28F9, 0x00707431: 0x006D29A1,
    0x00707432: 0x006D29A2, 0x00749CFA: 0x0070D14A, 0x00749D6D: 0x0070D1BB, 0x00749D6E: 0x0070D1BC,
    0x00749DE6: 0x0070D234, 0x00749EE2: 0x0070D32E, 0x00749EE4: 0x0070D330,
}
HD_VOXEL_PATCHES_GAME = {
    HD_VOXEL_SITES_GAME[va]: c.replace('sub_00754510', 'sub_007178E0').replace('sub_007542F0', 'sub_007176C0')
                              .replace('esp + 0x4C + 4', 'esp + 0x48 + 4')
    for va, c in HD_VOXEL_PATCHES.items()
}


MODERN_CONTROLS_TARGETS = {
    'gamemd': {
        'message': 0x00693107, 'radar': 0x006539D3, 'radar_stack': 0x48,
        'action': 0x00693271, 'right_up': 0x004AAE6E,
        'special_state': 0x11A4, 'special_flags': 0x11B0, 'special_sentinel': 0x11B8,
        'box_clear': 0x004ABCD4, 'object_clear': 0x004ABE4A,
        'clear': 0x0048DC90, 'clear_skip': 'L_0048DCB1', 'clear_fn': 'sub_0048DC90',
        'after_left_up': 0x00693290,
        'type_select_down': 'sub_00732CA0', 'type_select_up': 'sub_00732CC0',
        'box_walk': 0x004ABCEB, 'box_walk_fn': 'sub_006D9FF0',
        'box_select': 0x004AC2F1, 'box_object': 'esi', 'is_selected': 0x83,
        'select_slot': 0x14C, 'deselect_slot': 0x150,
        'selection_count': 0x00A8ECC8, 'selection_data': 0x00A8ECBC,
        'unit_vtable': 0x007F5C70, 'infantry_vtable': 0x007EB058,
        'aircraft_vtable': 0x007E22A4,
    },
    'game': {
        'message': 0x0066A467, 'radar': 0x0062FE33, 'radar_stack': 0x44,
        'action': 0x0066A5D1, 'right_up': 0x0049B0CE,
        'special_state': 0x11A0, 'special_flags': 0x11AC, 'special_sentinel': 0x11B4,
        'box_clear': 0x0049BE44, 'object_clear': 0x0049BFB4,
        'clear': 0x00482BC0, 'clear_skip': 'L_00482BE1', 'clear_fn': 'sub_00482BC0',
        'after_left_up': 0x0066A5F0,
        'type_select_down': 'sub_006F7650', 'type_select_up': 'sub_006F7670',
        'box_walk': 0x0049BE5B, 'box_walk_fn': 'sub_006AA610',
        'box_select': 0x0049C470, 'box_object': 'edi', 'is_selected': 0x77,
        'select_slot': 0x140, 'deselect_slot': 0x144,
        'selection_count': 0x00A40C70, 'selection_data': 0x00A40C64,
        'unit_vtable': 0x007ADDF8, 'infantry_vtable': 0x007A3540,
        'aircraft_vtable': 0x0079B12C,
    },
}


QUEUE_FIVE_TARGETS = {
    'gamemd': {
        'count': 0x00A802C8, 'index': 0x00A802D0, 'ring': 0x00A802D4,
        'stamps': 0x00A83A54, 'get_async_key_state': 0x007E13E0,
        'time_get_time': 0x007E1530, 'sites': (0x006AB511, 0x006AB76E),
    },
    'game': {
        'count': 0x00A32338, 'index': 0x00A32340, 'ring': 0x00A32344,
        'stamps': 0x00A35AC4, 'get_async_key_state': 0x0079A3B4,
        'time_get_time': 0x0079A524, 'sites': (0x0068119E, 0x006813EF),
    },
}


def modern_controls_patches(target):
    """Modern controls' battlefield mouse behavior, for either game target."""
    t = MODERN_CONTROLS_TARGETS[target]
    clear_fn = t['clear_fn']
    addr = lambda key: '0x%08Xu' % t[key]
    special_expr = (
        'MEM32(esi + 0x%X) != 0 || '
        'MEM8(esi + 0x%X) || MEM8(esi + 0x%X) || MEM8(esi + 0x%X) || '
        'MEM8(esi + 0x%X) || MEM8(esi + 0x%X) || '
        'MEM32(esi + 0x%X) != 0xFFFFFFFFu'
    ) % (t['special_state'], t['special_flags'], t['special_flags'] + 1,
         t['special_flags'] + 2, t['special_flags'] + 3, t['special_flags'] + 4,
         t['special_sentinel'])
    patches = {
        # The game has already read the Windows message here. Route right
        # presses through left-button bookkeeping only when no active
        # placement/order mode needs its original right-up cancellation.
        t['message']: (
            '{ extern uint32_t ra2_modern_mouse_message(uint32_t, int); '
            'int special = %s; '
            'eax = ra2_modern_mouse_message(eax, special); } '
            '/* optional F10 Modern controls */') % special_expr,
        # Keep the mapped radar flags in the stack argument as well as DL;
        # later branches in this handler read the argument again.
        t['radar']: (
            '{ extern uint32_t ra2_modern_radar_event_flags(uint32_t); '
            'SET_LO8(edx, ra2_modern_radar_event_flags(LO8(edx))); '
            'MEM8(esp + 0x%X) = LO8(edx); } '
            '/* swap radar left/right event flags in Modern mode */') % t['radar_stack'],
        # In Modern mode, plain left-clicks select objects or clear the
        # selection on open ground; contextual orders remain on right-click.
        # The mouse-up handler (0x004AB9B0) still selects a selectable target
        # when the action is None, so a click that must not touch the
        # selection (0xFFFFFFFE) also clears the target slot it reads.
        t['action']: (
            '{ extern uint32_t ra2_modern_left_click_action(uint32_t, uint32_t, uint32_t, int, uint32_t, int); '
            'int special = %s; '
            'uint32_t target = MEM32(esp + 0x30); uint32_t vtable = target ? MEM32(target) : 0; '
            'uint32_t selection_count = MEM32(%s); uint32_t selected_in_group = 0; '
            'uint32_t selected_data = MEM32(%s); '
            'if (target && selected_data && selection_count <= 4096u) '
            'for (uint32_t i = 0; i < selection_count; ++i) '
            'if (MEM32(selected_data + i * 4u) == target) { selected_in_group = 1; break; } '
            'uint32_t action = ra2_modern_left_click_action(eax, target, vtable, selected_in_group, selection_count, special); '
            'if (action == 0xFFFFFFFFu) { RECOMP_CALL(%s); RECOMP_FLAGS_IN(); eax = 0; } '
            'else if (action == 0xFFFFFFFEu) { MEM32(esp + 0x30) = 0; eax = 0; } '
            'else eax = action; } '
            '/* optional F10 Modern controls */') % (special_expr, addr('selection_count'), addr('selection_data'), clear_fn),
        # Just after LeftMouseButtonUp returns: run a same-type selection the
        # click asked for (TypeSelectCommandClass's own key-down and key-up
        # halves, as one tap of its key), then end the click's one-shot
        # selection-clear skip.
        t['after_left_up']: (
            '{ extern int ra2_modern_take_type_select(void); '
            'extern void ra2_modern_end_left_up(void); '
            'if (ra2_modern_take_type_select()) { '
            'RECOMP_CALL(%s); RECOMP_FLAGS_IN(); RECOMP_CALL(%s); RECOMP_FLAGS_IN(); } '
            'ra2_modern_end_left_up(); } '
            '/* optional F10 Modern controls */') % (t['type_select_down'], t['type_select_up']),
        # A Shift box over units that are all selected already removes them.
        # With Shift held, walk the box once as a dry run (the walk clears the
        # box it reads, so put it back), let the presenter decide, then walk it
        # for real.
        t['box_walk']: (
            '@replace:{ extern int ra2_modern_shift_box_begin(void); '
            'extern void ra2_modern_shift_box_decide(void); extern void ra2_modern_shift_box_end(void); '
            'if (ra2_modern_shift_box_begin()) { '
            'uint32_t _box_this = ecx, _box_cb = MEM32(esp); '
            'uint32_t _box_a = MEM32(_box_this + 0xD90u), _box_b = MEM32(_box_this + 0xD94u); '
            'PUSH32(esp, _box_cb); RECOMP_CALL(%s); RECOMP_FLAGS_IN(); '
            'MEM32(_box_this + 0xD90u) = _box_a; MEM32(_box_this + 0xD94u) = _box_b; '
            'ecx = _box_this; ra2_modern_shift_box_decide(); } '
            'RECOMP_CALL(%s); ra2_modern_shift_box_end(); } '
            '/* optional F10 Modern controls */') % (t['box_walk_fn'], t['box_walk_fn']),
        # The box walk's per-object Select(): skipped in the dry run, Deselect()
        # when the whole box was already selected.
        t['box_select']: (
            '@replace:{ extern int ra2_modern_box_object(int); '
            'int _box = ra2_modern_box_object(MEM8(%s + 0x%X) != 0); '
            'if (_box == 1) RECOMP_ICALL(MEM32(edx + 0x%X)); '
            'else { if (_box == 2) RECOMP_ICALL(MEM32(edx + 0x%X)); eax = 0; } } '
            '/* optional F10 Modern controls */') % (
                t['box_object'], t['is_selected'], t['select_slot'], t['deselect_slot']),
        # The original right-up cleanup clears selection after camera pan.
        t['right_up']: (
            '@replace:{ extern int ra2_modern_consume_right_drag_release(void); '
            'if (!ra2_modern_consume_right_drag_release()) RECOMP_CALL(%s); } '
            '/* optional F10 Modern controls */') % clear_fn,
        # The drag-selection release normally clears the selection before
        # applying the rectangle. Keep it when Shift is held in Modern mode.
        t['box_clear']: (
            '@replace:{ extern int ra2_modern_preserve_shift_selection(void); '
            'if (!ra2_modern_preserve_shift_selection()) RECOMP_CALL(%s); } '
            '/* optional F10 Modern controls */') % clear_fn,
        # The virtual mouse-up path and the same-type selection can clear
        # selection through this shared routine instead of either mouse-up
        # clear site above.
        t['clear']: (
            '{ extern int ra2_modern_preserve_global_selection_clear(void); '
            'if (ra2_modern_preserve_global_selection_clear()) goto %s; } '
            '/* preserve existing selection during a Shift-click or Shift box drag */') % t['clear_skip'],
        # Mouse-up can also clear selection while processing a target object.
        t['object_clear']: (
            '@replace:{ extern int ra2_modern_preserve_shift_selection(void); '
            'if (!ra2_modern_preserve_shift_selection()) RECOMP_CALL(%s); } '
            '/* optional F10 Modern controls */') % clear_fn,
    }
    return patches


def queue_five_patches(target):
    """Modern controls: Shift-click a sidebar build icon to queue five of it
    (docs/modern-controls.md)."""
    t = QUEUE_FIVE_TARGETS[target]

    def after_production_event():
        return (
            '{ extern int ra2_queue_five_append(uint32_t, uint32_t); '
            'extern int ra2_modern_controls(void); '
            'uint32_t _queue_five_event = eax; '
            'if (ra2_modern_controls()) { '
            'PUSH32(esp, 0x10u); '
            'RECOMP_ICALL(MEM32(0x%08Xu)); RECOMP_FLAGS_IN(); '
            'if (eax & 0x8000u) { uint32_t _queue_five_added = 0; '
            'while (_queue_five_added < 4u && MEM32(0x%08Xu) < 0x80u) { '
            'RECOMP_ICALL(MEM32(0x%08Xu)); RECOMP_FLAGS_IN(); '
            'if (!ra2_queue_five_append(_queue_five_event, eax)) break; '
            '++_queue_five_added; } } } '
            'eax = _queue_five_event; } '
            '/* Queue Five (Modern controls): Shift-click adds four matching events before the original. */'
        ) % (t['get_async_key_state'], t['count'], t['time_get_time'])

    # These are the two normal production-event branches for this target.
    return {site: after_production_event() for site in t['sites']}


def web_exit_confirmation_patches(code, cs, target):
    """Replace only the main menu's Exit confirmation call on Emscripten.

    Init.CPP resolves GUI:ExitAreYouSure, OK and Cancel, then pushes the
    message and four button arguments into its reusable confirmation helper.
    The helper returns 0 for OK and 1 for Cancel and pops 20 argument bytes.
    Match that call's argument setup and result test (YR 0x0052DE1C,
    RA2 0x00513A65). Other callers of the helper keep their native dialogs.
    """
    helper = {'gamemd': 0x005D3490, 'game': 0x005B46B0}[target]
    pattern = re.compile(rb'\x53\x53\x55\x57\x56\xe8(.{4})\x85\xc0\x75', re.S)
    matches = []
    for match in pattern.finditer(code):
        call = cs + match.start() + 5
        if call + 5 + int.from_bytes(match[1], 'little', signed=True) == helper:
            matches.append(call)
    if len(matches) != 1:
        return {}  # do not guess on modified/ambiguous code
    return {matches[0]: (
        '@replace:#ifdef __EMSCRIPTEN__\n'
        '    { extern uint32_t ra2_web_exit_confirmation(void);\n'
        '      RECOMP_REGS_OUT();\n'
        '      uint32_t answer = ra2_web_exit_confirmation();\n'
        '      RECOMP_REGS_IN(); eax = answer; esp += 20; }\n'
        '    #else\n'
        '    RECOMP_CALL(sub_%08X);\n'
        '    #endif /* web Exit confirmation: no native dialog is created */' % helper)}


def apply_patches(body, patches):
    """Add each patch's C after the line that lifts its instruction."""
    for va, c in patches.items():
        tag = '/* 0x%08X:' % va
        k = body.find(tag)
        if k != -1:
            start = body.rfind('\n', 0, k) + 1
            e = body.index('\n', k)
            if c.startswith('@replace:'):
                body = body[:start] + '    ' + c[len('@replace:'):] + '\n' + body[e + 1:]
            else:
                body = body[:e + 1] + '    ' + c + '\n' + body[e + 1:]
    return body


# Red Alert 2 itself (game.exe, the same install) is a second target: its own
# catalog in work/game, its lift in src/recomp/gen_game, its own seeds, hooks
# and patches. Everything address-bound the host needs comes to it through
# recomp_target.h, written beside the lifted C.
RUN_SEEDS_GAME = [
    0x00524FF0,   # a static constructor (the _initterm table at 0x007C9000)
    0x007492D0,   # a callback named only by an immediate (0x007458D8: mov edx, 0x7492d0)
]
HOOKS_GAME = {
    0x004068F0: 'debuglog',            # the bare-ret debug printf, 1,592 callers
}

# Red Alert 2's menus at 800x600, like Yuri's Revenge (docs/resolution.md, the
# plan in docs/ra2-resolution-plan.md). The mode toggle [Video] AllowModeToggle
# (byte 0xA40D0B) is read from the INI in two places; both force it on. With it
# on, the shell is 800x600 (Startup's 0x006901B1 path), the switch back to the
# shell goes to 800x600 (three copies, at 0x0065D92B, 0x0065DF5C and 0x0065E6D2),
# and the Options dialog only stores a size (its native branch at 0x0054276B).
# The INI size (0xA40B38/3C) is left as the INI gives it: the match-start switch
# at 0x0065BF98 still goes to that size. Each site is checked by its bytes
# first; a different build gets no patches at all.
RA2_SHELL_SITES = {
    # Each site: the bytes of the instruction the patch lands on (checked).
    'toggle_ini': (0x0068E9D9, 'a20b0d a400'),       # mov [AllowModeToggle], al (INI read at startup)
    'toggle_options': (0x005D8E2D, 'a20b0d a400'),   # mov [AllowModeToggle], al (Options load)
    'shell_height': (0x006901B1, 'be90010000'),      # mov esi, 0x190 (the toggle-on shell's size)
}
# The three copies of the switch back to the shell (0x0065D92B, 0x0065DF5C,
# 0x0065E6D2). Each: the width compare at cmp_w (`cmp [0x839648], 0x280`) with
# its je, the height compare at cmp_h (`cmp [0x83964C], 0x1E0`) with its jle, and
# four mov immediates: the first pair sets edx and ecx for the call to 0x5434E0
# to 640x400 (or 640x480); the second pair is its retry. done is the label the
# switch skips to.
RA2_SHELL_SWITCH_BACK = (
    dict(cmp_w=0x0065D934, je=0x0065D93E, cmp_h=0x0065D940, jle=0x0065D94A, done=0x0065D97B,
         movs=((0x0065D959, 'edx', 0x190), (0x0065D95E, 'ecx', 0x280),
               (0x0065D96C, 'edx', 0x1E0), (0x0065D971, 'ecx', 0x280))),
    dict(cmp_w=0x0065DF65, je=0x0065DF6F, cmp_h=0x0065DF71, jle=0x0065DF7B, done=0x0065DFAC,
         movs=((0x0065DF8A, 'edx', 0x190), (0x0065DF8F, 'ecx', 0x280),
               (0x0065DF9D, 'edx', 0x1E0), (0x0065DFA2, 'ecx', 0x280))),
    dict(cmp_w=0x0065E6DC, je=0x0065E6E6, cmp_h=0x0065E6E8, jle=0x0065E6F2, done=0x0065E723,
         movs=((0x0065E701, 'edx', 0x190), (0x0065E706, 'ecx', 0x280),
               (0x0065E714, 'edx', 0x1E0), (0x0065E719, 'ecx', 0x280))),
)
# The shell's size: 800 x 600 (0x320 x 0x258), what Yuri's shell uses.
RA2_SHELL_W, RA2_SHELL_H = 0x320, 0x258
RA2_SHELL_TAG = '/* remaster: shell 800x600, run_lift.py ra2_shell_patches */'


# [Video] AllowHiResModes: the Options load stores it into the options object
# (esi + 0x29, 0xA40B41) at 0x005D8DF3. Forced on, the resolution list keeps
# every size up to 4096 (the readers are 0x00542A56, 0x00543D4B and friends).
RA2_HIRES_SITE = (0x005D8DF3, '884629')            # mov byte ptr [esi + 0x29], al


# Online play's resolution range (docs/ra2-resolution-plan.md, step 3). The
# join check sub_00745780 (wonline.cpp) reads the room's flags at [room + 0x20]:
# 0x400 (ResolutionLimited800) caps the width at 800, 0x200 (ResolutionLimited640)
# at 640, neither at 1024. The plan's new range: 0x400 and neither allow 1920
# (1920x1080), 0x200 allows 1024 (1024x768). The shipping exe skips the check with
# an unconditional jump (0x007457CC); the real check replaces it, and a width over
# the limit is clamped quietly (the width compared is the match size, 0xA40B38, when the
# mode toggle is on: the shell is always 800 wide, which no limit would ever catch): the size is stored for the next game (the live
# switch is not run), and the join is accepted. At match start an online game's
# size is held to 1024x768 .. 1920x1080 (0x0065BF98; session type 4 is the online
# lobby, read by sub_00755CD0).
RA2_ONLINE_SITES = {
    # va: (hex of the instruction the patch lands on, what it is)
    'limit_800': (0x007457AA, 'bb20030000'),          # mov ebx, 0x320 (ResolutionLimited800)
    'limit_and': (0x007457BA, '2580feffff'),          # and eax, 0xfffffe80
    'limit_add': (0x007457BF, '0500040000'),          # add eax, 0x400
    'jmp_check': (0x007457CC, 'e9'),                  # jmp 0x745895 (the skipped comparison)
    'size_edi':  (0x00745859, '8bd7'),                # mov edx, edi
    'live_call': (0x0074585B, 'e8'),                  # call 0x543a70 (the live display switch)
    'after_jle': (0x00745889, '7e0a'),                # jle 0x745895 (after the clamp)
    'match_w':   (0x0065BF98, 'a1380ba400'),          # mov eax, [0xa40b38] (match-start size)
}
RA2_ONLINE_TARGETS = {
    'jmp_check': 0x00745895,
    'live_call': 0x00543A70,
    'after_jle': 0x00745895,
}
RA2_ONLINE_LABELS = {'clamp': 0x0074582A, 'accept': 0x00745895}


# Yuri's Revenge's online resolution option (docs/hires.md).
#
# The Create Game dialog's "Limit screen resolution" checkbox (control 0x71E,
# [MultiPlayer] WOLLimitResolution in RA2MD.INI) is the room's only resolution
# control. The stock game force-clears the option when the host's match width is
# 1024 or more, disables the checkbox at that size, and publishes 640/800 caps.
# That is why a normal room (option off) still advertised no bits and every
# guest was compared against the stock 1024 default.
#
# New behaviour:
#  - the option can be enabled at any host size (force-off and the two dialog
#    width gates are removed);
#  - when it is on, the room publishes 0x400 (the remaster's 1920 bit) and the
#    host's own match size (0xA8EB84) is clamped to 1920x1080 and saved;
#  - a guest whose match size is above 1920 gets the stock prompt, whose text
#    is rewritten from 640x480/800x600 to 1920x1080 by
#    ra2_wol_limit_message (src/runtime/woltext.c); Yes stores 1920x1080 and
#    saves it, No aborts the join as before;
#  - a room with neither flag has no cap and no prompt: the join check accepts
#    immediately, so a normal game never asks the guest to lower its size.
YR_ONLINE_SITES = {
    # va: (hex of the instruction the patch lands on, what it is)
    'flag_load': (0x0078997B, '8b4720'),               # mov eax, [edi + 0x20] (room flags)
    'limit_800': (0x00789988, 'be20030000'),           # mov esi, 0x320
    'limit_and': (0x00789998, '2580feffff'),           # and eax, 0xfffffe80
    'limit_add': (0x0078999D, '0500040000'),           # add eax, 0x400
    'cmp_width': (0x007899A4, '393584eba800'),         # cmp [0xa8eb84], esi
    'jle_accept': (0x007899AA, '0f8e'),                # jle 0x789a58
    'message_push': (0x007899E1, '50'),                # push eax (the CSF prompt)
    'yes_clamp': (0x00789A08, '8bc6b960'),             # mov eax, esi; mov ecx, 0xa8eb60
    'force_off': (0x00789B79, '7c07c60540b5a80000'),   # jl; mov byte [0xa8b540], 0
    'publish': (0x00789DA8, '8b1584eba800'),           # mov edx, [0xa8eb84]
    'dialog_enable': (0x0078DF75, '52'),               # push edx (EnableWindow arg)
    'dialog_check': (0x0078DF84, '8a44241c'),          # mov al, [esp + 0x1c]
}
# ('rel32'/'rel8', target) for the two stock branches the patch relies on.
YR_ONLINE_TARGETS = {'jle_accept': ('rel32', 0x00789A58),
                     'force_off': ('rel8', 0x00789B82)}


def yr_online_patches(code, cs):
    """Yuri's Revenge's 1920 online cap and its optional prompt (see YR_ONLINE_SITES).

    Every site is checked by its bytes first; the branches' displacements must
    reach their stock targets. A different build gets no patches."""
    def at(va, hexbytes):
        raw = bytes.fromhex(hexbytes)
        return code[va - cs:va - cs + len(raw)] == raw

    checks = [at(va, shape) for name, (va, shape) in YR_ONLINE_SITES.items()
              if name not in YR_ONLINE_TARGETS]
    for name, (kind, target) in YR_ONLINE_TARGETS.items():
        va = YR_ONLINE_SITES[name][0]
        if kind == 'rel32':
            rel = int.from_bytes(code[va - cs + 2:va - cs + 6], 'little', signed=True)
            checks.append(at(va, YR_ONLINE_SITES[name][1]) and va + 6 + rel == target)
        else:
            rel = int.from_bytes(code[va - cs + 1:va - cs + 2], 'little', signed=True)
            checks.append(at(va, YR_ONLINE_SITES[name][1]) and va + 2 + rel == target)
    if not all(checks):
        print('[*] yr_online_patches: a site does not match this build; no online patches')
        return {}

    tag = '/* remaster: online resolution range, run_lift.py yr_online_patches */'
    sites = YR_ONLINE_SITES
    return {
        # No resolution bits: a normal room is uncapped and never prompts.
        # Otherwise every limited room means 1920 wide, whatever bit it set.
        sites['flag_load'][0]: ('@replace:eax = MEM32(edi + 0x20); '
                                'if (!(eax & 0x600u)) goto L_00789A58; '
                                'esi = 0x780u; goto L_007899A4; ' + tag),
        # The stock prompt names 640x480/800x600. Rewrite the looked-up text
        # (its own encoding is preserved) before it is handed to the dialog.
        sites['message_push'][0]: ('@replace:{ extern const uint16_t *ra2_wol_limit_message(const uint16_t *); '
                                   'eax = (uint32_t)(uintptr_t)ra2_wol_limit_message((const uint16_t *)(uintptr_t)eax); } '
                                   'PUSH32(esp, eax); ' + tag),
        # Yes: store the remaster size and save it, then continue to the
        # stock re-check (which now passes) and the join.
        sites['yes_clamp'][0]: ('@replace:{ MEM32(0x00A8EB84) = 0x780u; MEM32(0x00A8EB88) = 0x438u; '
                                'ecx = 0x00A8EB60u; RECOMP_CALL(sub_005FAD10); RECOMP_FLAGS_IN(); } '
                                'goto L_00789A3E; ' + tag),
        # The option survives at 1024+ instead of being cleared.
        sites['force_off'][0]: '@replace:goto L_00789B82; ' + tag,
        # The room advertises 1920 and the host's own match size is capped too.
        # The reserved value is kept in a local across SaveSettings, which
        # returns in eax (RECOMP_CALL reloads the guest register).
        sites['publish'][0]: ('@replace:{ uint32_t _reserved = eax | 0x400u; '
                              'if ((int32_t)MEM32(0x00A8EB84) > 1920) { '
                              'MEM32(0x00A8EB84) = 0x780u; MEM32(0x00A8EB88) = 0x438u; '
                              'ecx = 0x00A8EB60u; RECOMP_CALL(sub_005FAD10); RECOMP_FLAGS_IN(); } '
                              'eax = _reserved; } goto L_00789DC6; ' + tag),
        # The checkbox is usable at any host size and shows the option's state.
        sites['dialog_enable'][0]: '@replace:PUSH32(esp, 1); ' + tag,
        sites['dialog_check'][0]: '@replace:SET_LO8(eax, 0); ' + tag,
    }


def ra2_online_patches(code, cs):
    """Red Alert 2's online resolution range (see RA2_ONLINE_SITES).

    Every site is checked by its bytes first: the opcodes, and for the jumps and
    the call the target they reach. A different build gets no patches."""
    def at(va, hexbytes):
        raw = bytes.fromhex(hexbytes.replace(' ', ''))
        return code[va - cs:va - cs + len(raw)] == raw

    def rel_target(va, length):
        """The target of the rel32 branch of `length` bytes at va."""
        rel = int.from_bytes(code[va - cs + length - 4:va - cs + length], 'little', signed=True)
        return va + length + rel

    checks = []
    for name in ('limit_800', 'limit_and', 'limit_add', 'size_edi', 'match_w'):
        va, shape = RA2_ONLINE_SITES[name]
        checks.append(at(va, shape))
    va = RA2_ONLINE_SITES['jmp_check'][0]
    checks.append(at(va, 'e9') and rel_target(va, 5) == RA2_ONLINE_TARGETS['jmp_check'])
    va = RA2_ONLINE_SITES['live_call'][0]
    checks.append(at(va, 'e8') and rel_target(va, 5) == RA2_ONLINE_TARGETS['live_call'])
    va = RA2_ONLINE_SITES['after_jle'][0]
    checks.append(at(va, '7e0a'))
    if not all(checks):
        print('[*] ra2_online_patches: a site does not match this build; no online patches')
        return {}

    tag = '/* remaster: online resolution range, run_lift.py ra2_online_patches */'
    sites = RA2_ONLINE_SITES
    out = {
        sites['limit_800'][0]: 'ebx = 0x780u; ' + tag,
        sites['limit_and'][0]: '@replace:eax = eax & 0xFFFFFC80u; ' + tag,
        sites['limit_add'][0]: '@replace:eax = eax + 0x780u; ' + tag,
        # The shipping jump makes the old clamp unreachable here, so the lifter
        # puts it in another C function. Keep the quiet stores and INI save inline
        # instead of jumping to that function's label (or its dialog cleanup).
        sites['jmp_check'][0]: ('@replace:{ uint32_t _w = MEM8(0x00A40D0B) ? MEM32(0x00A40B38) : MEM32(0x008523E0); '
                                'if ((int32_t)_w <= (int32_t)ebx) goto L_%08X; } '
                                '{ esi = (ebx == 0x400u) ? 0x400u : 0x780u; '
                                'edi = (esi == 0x400u) ? 0x300u : 0x438u; '
                                'MEM32(0x00A40B38) = esi; MEM32(0x00A40B3C) = edi; '
                                'ecx = 0x00A40B18u; RECOMP_CALL(sub_005D91B0); RECOMP_FLAGS_IN(); } '
                                'goto L_%08X; %s') % (RA2_ONLINE_LABELS['accept'], RA2_ONLINE_LABELS['accept'], tag),
        # The clamped size, for the next game: 1024x768 for the 1024 limit,
        # else 1920x1080. edx carries the height the store below uses.
        sites['size_edi'][0]: ('esi = (ebx == 0x400u) ? 0x400u : 0x780u; '
                               'edi = (esi == 0x400u) ? 0x300u : 0x438u; edx = edi; ' + tag),
        sites['live_call'][0]: '@replace:eax = 1u; /* stored, not switched live */ ' + tag,
        sites['after_jle'][0]: '@replace:goto L_%08X; %s' % (RA2_ONLINE_LABELS['accept'], tag),
        sites['match_w'][0]: ('{ if (MEM32(0x00A3D298) == 4u) { uint32_t _w = eax, _h = MEM32(0x00A40B3C); '
                              'if (_w < 1024u) _w = 1024u; if (_h < 768u) _h = 768u; '
                              'if (_w > 1920u) _w = 1920u; if (_h > 1080u) _h = 1080u; '
                              'eax = _w; MEM32(0x00A40B38) = _w; MEM32(0x00A40B3C) = _h; } } ' + tag),
    }
    return out


# The "The display mode will be changed..." confirm (dialog 0xD9, Ok/Cancel) that
# a picked size opens. Two callers: the Options resolution combo's change
# (call 0x00542719, proc 0x00542160) and Display Options' Proceed (call
# 0x00543B0C, proc 0x00543C40). Each pushes one argument (0) right before the
# call to 0x005FF610, which pops it (ret 4). The patch pops it too and treats
# the dialog as Ok: Options then stores the picked size (the toggle is forced
# on, so the store-only branch at 0x0054276B runs, not the live switch), and
# Display Options keeps the current mode (its "Keeping display mode" branch).
RA2_CONFIRM_SITES = {
    # name: (call va, expected push 0 before it, result slot offset after the pop)
    'options': (0x00542719, 0x00542705, 0x60),
    'display': (0x00543B0C, 0x00543B0A, 0x10),
}
RA2_CONFIRM_TARGET = 0x005FF610     # the dialog creator both calls reach


def ra2_confirm_patches(code, cs):
    """Skip the 0xD9 size confirm: Ok, no dialog, no live switch (RA2_CONFIRM_SITES).

    Each site is checked by bytes first: the push 0 and the call with its
    rel32 target at RA2_CONFIRM_TARGET. A different build gets no patches."""
    def at(va, hexbytes):
        raw = bytes.fromhex(hexbytes)
        return code[va - cs:va - cs + len(raw)] == raw

    out = {}
    for name, (va, push_va, slot) in RA2_CONFIRM_SITES.items():
        if not at(push_va, '6a00') or not at(va, 'e8'):
            print('[*] ra2_confirm_patches: the %s confirm call does not match this build; no patches' % name)
            return {}
        rel = int.from_bytes(code[va - cs + 1:va - cs + 5], 'little', signed=True)
        if va + 5 + rel != RA2_CONFIRM_TARGET:
            print('[*] ra2_confirm_patches: the %s confirm call targets another function; no patches' % name)
            return {}
        out[va] = ('@replace:{ esp += 4; MEM32(esp + 0x%X) = 1u; eax = 0; } '
                   '/* remaster: the size confirm is Ok, no dialog (run_lift.py ra2_confirm_patches) */' % slot)
    return out



# A saved game never reached the match-start switch (0x0065BF98 is Start_Scenario's);
# its loader (sub_00656A60's caller chain, ending at "LOADING GAME [%s] - Complete")
# runs the whole mission at the shell's 800x600. After the loader's last step
# (call 0x006F30F0, the same call Start_Scenario makes before its switch) the
# same switch runs: when the toggle is on and the INI size differs from the current
# mode, sub_005434E0 goes to it, and the switch back at the end of a game is the
# existing one (RA2_SHELL_SWITCH_BACK).
RA2_LOAD_SITE = 0x00656B1E            # call 0x006F30F0, last step of the saved-game loader
RA2_LOAD_TARGET = 0x006F30F0
RA2_LOAD_AFTER = (0x00656B23, '56')   # push esi: the "LOADING GAME ... Complete" log argument


def ra2_load_patches(code, cs):
    """Switch to the INI size when a saved game has loaded (RA2_LOAD_SITE).

    Checked by bytes first: the call and its target, the push after it. A
    different build gets no patch."""
    def at(va, hexbytes):
        raw = bytes.fromhex(hexbytes)
        return code[va - cs:va - cs + len(raw)] == raw

    va, (after_va, after) = RA2_LOAD_SITE, RA2_LOAD_AFTER
    if not at(va, 'e8') or not at(after_va, after):
        print('[*] ra2_load_patches: the saved-game loader does not match this build; no load patch')
        return {}
    rel = int.from_bytes(code[va - cs + 1:va - cs + 5], 'little', signed=True)
    if va + 5 + rel != RA2_LOAD_TARGET:
        print('[*] ra2_load_patches: the saved-game loader calls another function; no load patch')
        return {}
    return {va: ('if (MEM8(0xA40D0B) != 0u && (MEM32(0x00839648) != MEM32(0x00A40B38) || '
                 'MEM32(0x0083964C) != MEM32(0x00A40B3C))) { uint32_t _keep = eax; '
                 'ecx = MEM32(0x00A40B38); edx = MEM32(0x00A40B3C); RECOMP_CALL(sub_005434E0); '
                 'RECOMP_FLAGS_IN(); ' + RA2_PROFILE_RESET + ' eax = _keep; } '
                 '/* remaster: a loaded game switches to the INI size, run_lift.py ra2_load_patches */')}

# The display profile (sub_006F3650's objects at 0xAC1184.., the layout rectangles
# at 0xAC11B4..0xAC1200: the sidebar at x = width - 168, the bottom bar at y = height - 32)
# is built from the mode of the moment. RA2's own order for a match is the profile
# reset (sub_006F30F0), then the switch to the INI size (sub_005434E0), so the
# profile built for the 800x600 shell outlived the switch: the in-game menu drew its
# sidebar piece at x = 632. Yuri's order is the switch, then the reset. After each
# switch to the match size the profile is torn down and built again for the new mode,
# with the same steps ra2_cache_patches uses. The in-game rectangle set (0xAC11A0.., flag
# 0xAC11B0, sub_006F4620's lazy build) is a second profile with its own rebuild, sub_006F44D0.
RA2_PROFILE_RESET = ('MEM8(0xAC119C) = 1u; RECOMP_CALL(sub_006F30F0); RECOMP_FLAGS_IN(); '
                     'RECOMP_CALL(sub_0051A2B0); RECOMP_FLAGS_IN(); '
                     'RECOMP_CALL(sub_006F3D50); RECOMP_FLAGS_IN(); '
                     'ecx = MEM32(0x7F871C); edx = 0x00AC1184u; PUSH32(esp, 0x00AC1188u); '
                     'RECOMP_CALL(sub_006F1FA0); RECOMP_FLAGS_IN(); '
                     'ecx = MEM32(0x7F8720); edx = 0x00AC118Cu; PUSH32(esp, 0x00AC1190u); '
                     'RECOMP_CALL(sub_006F1FA0); RECOMP_FLAGS_IN(); '
                     'ecx = MEM32(0x7F8724); edx = 0x00AC1194u; PUSH32(esp, 0x00AC1198u); '
                     'RECOMP_CALL(sub_006F1FA0); RECOMP_FLAGS_IN(); '
                     'edx = MEM32(0x008523E4); ecx = MEM32(0x008523E0); RECOMP_CALL(sub_006F3E70); RECOMP_FLAGS_IN(); '
                     'RECOMP_CALL(sub_006F44D0); RECOMP_FLAGS_IN(); '
                     'MEM8(0xAC119C) = 1u;')
RA2_PROFILE_SITE = 0x0065BFD0         # call 0x5434E0 in Start_Scenario (the match-start switch)


def ra2_profile_patches(code, cs):
    """Rebuild the display profile after the match-start switch (RA2_PROFILE_SITE)."""
    va = RA2_PROFILE_SITE
    rel = int.from_bytes(code[va - cs + 1:va - cs + 5], 'little', signed=True)
    if code[va - cs] != 0xE8 or va + 5 + rel != 0x005434E0:
        print('[*] ra2_profile_patches: the match-start switch does not match this build; no profile patch')
        return {}
    return {va: ('{ uint32_t _eax = eax; ' + RA2_PROFILE_RESET + ' eax = _eax; } '
                 '/* remaster: the display profile follows the switch, run_lift.py ra2_profile_patches */')}


# The command bar (the tab's row of buttons along the bottom, sub_006A1880) is placed from
# the in-game rectangle set (0xAC11FC, the bar's y) cached at one-time init in 0xABE374 and
# 0xABE37C, and sub_005434E0 positions the buttons (TabClass sub_006A0C50) straight after
# its layout resize (sub_006F33B0), while the rectangles still describe the old mode. A
# match at another size drew the bar's buttons at the 800x600 shell's y, under the map, and
# only a hover or a click repainted them. Rebuild the rectangle set and the two cached
# values between the resize and the placement, at every switch.
RA2_TAB_SITE = 0x005439E9               # call 0x6F33B0 in sub_005434E0, before TabClass sub_006A0C50
RA2_TAB_TARGET = 0x006F33B0


def ra2_tab_patches(code, cs):
    """Rebuild the in-game layout before the switch places the command bar's buttons."""
    va = RA2_TAB_SITE
    rel = int.from_bytes(code[va - cs + 1:va - cs + 5], 'little', signed=True)
    if code[va - cs] != 0xE8 or va + 5 + rel != RA2_TAB_TARGET:
        print('[*] ra2_tab_patches: the layout resize in the switch does not match this build; no tab patch')
        return {}
    return {va: ('{ uint32_t _ecx = ecx, _edx = edx; RECOMP_CALL(sub_006F44D0); RECOMP_FLAGS_IN(); '
                 'MEM32(0xABE374) = MEM32(MEM32(0xAC11FC) + 4u); '
                 'ecx = MEM32(0xABE2AC); RECOMP_CALL(sub_006A0670); RECOMP_FLAGS_IN(); '
                 'ecx = _ecx; edx = _edx; } '
                 '/* remaster: the command bar follows the switch, run_lift.py ra2_tab_patches */')}


# A mode switch invalidates the display profile cache (sub_006F4160) and sets
# AC119C back to zero. The next resize through sub_006F33B0 previously jumped
# straight into sub_006F3E70, which dereferences the now-empty AC1010/AC1128
# profiles. Match the normal lazy-init path from sub_006F3650 before that resize.
RA2_CACHE_SITE = (0x006F3450, 'e91b0a0000')  # jmp 0x006F3E70, after deleting old surfaces


def ra2_cache_patches(code, cs):
    """Reload invalidated display profiles before the next surface resize."""
    va, shape = RA2_CACHE_SITE
    raw = bytes.fromhex(shape)
    if code[va - cs:va - cs + len(raw)] != raw:
        print('[*] ra2_cache_patches: the resize site does not match this build; not patched')
        return {}

    tag = '/* remaster: reload invalidated display profiles, run_lift.py ra2_cache_patches */'
    return {va: ('@replace:if (MEM8(0xAC119C) == 0) { '
        'RECOMP_CALL(sub_0051A2B0); RECOMP_FLAGS_IN(); '
        'RECOMP_CALL(sub_006F3D50); RECOMP_FLAGS_IN(); '
        'ecx = MEM32(0x7F871C); edx = 0x00AC1184u; PUSH32(esp, 0x00AC1188u); '
        'RECOMP_CALL(sub_006F1FA0); RECOMP_FLAGS_IN(); '
        'ecx = MEM32(0x7F8720); edx = 0x00AC118Cu; PUSH32(esp, 0x00AC1190u); '
        'RECOMP_CALL(sub_006F1FA0); RECOMP_FLAGS_IN(); '
        'ecx = MEM32(0x7F8724); edx = 0x00AC1194u; PUSH32(esp, 0x00AC1198u); '
        'RECOMP_CALL(sub_006F1FA0); RECOMP_FLAGS_IN(); '
        'MEM8(0xAC119C) = 1u; } goto L_006F3E70; ' + tag)}


def ra2_hires_patches(code, cs):
    """Force AllowHiResModes on, as the mode toggle is forced (ra2_shell_patches).

    Checked by its bytes first, like the shell patches."""
    va, shape = RA2_HIRES_SITE
    raw = bytes.fromhex(shape)
    if code[va - cs:va - cs + len(raw)] != raw:
        print('[*] ra2_hires_patches: the AllowHiResModes store does not match this build; not patched')
        return {}
    return {va: 'MEM8(esi + 0x29) = 1u; /* remaster: AllowHiResModes forced on, run_lift.py ra2_hires_patches */'}


# With AllowHiResModes set, both mode enumerators accept dimensions up to the
# constant pushed here. 5120x1440 is in the supported list, so 4096 was too low.
RA2_MODE_CAP_SITES = (
    (0x00542A5F, '6800100000'), (0x00542A64, '6800100000'),  # Options resolution combo
    (0x00543D56, '6800100000'), (0x00543D5B, '6800100000'),  # Display Options list
)


def ra2_mode_cap_patches(code, cs):
    """Raise the width and height caps in both resolution lists to 8192."""
    if not all(code[va - cs:va - cs + len(bytes.fromhex(shape))] == bytes.fromhex(shape)
               for va, shape in RA2_MODE_CAP_SITES):
        print('[*] ra2_mode_cap_patches: a cap push does not match this build; no patches')
        return {}
    tag = '/* remaster: mode enumeration cap 8192, run_lift.py ra2_mode_cap_patches */'
    return {va: '@replace:PUSH32(esp, 0x2000u); ' + tag for va, _shape in RA2_MODE_CAP_SITES}


def ra2_shell_patches(code, cs):
    """Red Alert 2's menus at 800x600, with the mode toggle forced on.

    The toggle [Video] AllowModeToggle (byte 0xA40D0B) is read from the INI at
    0x0068E9D9 and again by the Options load at 0x005D8E2D; both store it, and
    both are forced to 1 here. With it on, Startup takes the path that sets the
    shell's size (0x006901B1: 640 x 400 by default, now 800 x 600). The switch
    back to the shell goes to 800 x 600 instead of 640 x 400/480 (three copies,
    listed in RA2_SHELL_SWITCH_BACK). Options already stores its size without a
    live switch while the toggle is on (0x0054276B), so it needs no patch.
    The INI size (0xA40B38/3C) is left alone: the match-start switch at
    0x0065BF98 still goes to it.

    Each site is checked by its bytes first: a different build gets no patches
    at all (the same rule as dropdown_frame_patches).
    """
    def at(va, hexbytes):
        raw = bytes.fromhex(hexbytes.replace(' ', ''))
        return code[va - cs:va - cs + len(raw)] == raw

    def mov_imm(reg, imm):           # mov edx/ecx, imm32
        return ('ba' if reg == 'edx' else 'b9') + imm.to_bytes(4, 'little').hex()

    checks = [at(va, shape) for va, shape in RA2_SHELL_SITES.values()]
    for site in RA2_SHELL_SWITCH_BACK:
        # cmp [0x839648], 0x280 at cmp_w, its je 10 bytes on; cmp [0x83964C], 0x1E0
        # at cmp_h, its jle 10 bytes on. The je/jle opcode is short (74/7E) or near (0F 84/8E).
        checks.append(at(site['cmp_w'], '813d48968300' + '80020000'))
        checks.append(site['je'] == site['cmp_w'] + 10 and (at(site['je'], '74') or at(site['je'], '0f84')))
        checks.append(at(site['cmp_h'], '813d4c968300' + 'e0010000'))
        checks.append(site['jle'] == site['cmp_h'] + 10 and (at(site['jle'], '7e') or at(site['jle'], '0f8e')))
        checks += [at(va, mov_imm(reg, imm)) for va, reg, imm in site['movs']]
    if not all(checks):
        print('[*] ra2_shell_patches: a site does not match this build; no shell patches')
        return {}
    out = {}
    for name in ('toggle_ini', 'toggle_options'):
        va = RA2_SHELL_SITES[name][0]
        out[va] = 'MEM8(0xA40D0B) = 1u; ' + RA2_SHELL_TAG
    out[RA2_SHELL_SITES['shell_height'][0]] = 'ebx = 0x%Xu; esi = 0x%Xu; %s' % (
        RA2_SHELL_W, RA2_SHELL_H, RA2_SHELL_TAG)
    for site in RA2_SHELL_SWITCH_BACK:
        out[site['je']] = ('@replace:if (MEM32(0x839648) == 0x%Xu && MEM32(0x83964C) == 0x%Xu) '
                           'goto L_%08X; %s' % (RA2_SHELL_W, RA2_SHELL_H, site['done'], RA2_SHELL_TAG))
        out[site['jle']] = '@replace:/* width and height decided above */ ' + RA2_SHELL_TAG
        for va, reg, _old in site['movs']:
            new = RA2_SHELL_W if reg == 'ecx' else RA2_SHELL_H
            out[va] = '%s = 0x%Xu; %s' % (reg, new, RA2_SHELL_TAG)
    return out

# Route direct font-path calls through the optional translated runtime shaper.
# The original lifted function remains intact and is called by the wrapper.
THAI_FONT_CALLS = {
    'gamemd': (0x00434CD0, 0x00434120, 0x00434500),  # layout, glyph, direct text
    'game': (0x00432490, 0x004318E0, 0x00431CC0),
}


def thai_font_call_replacements(body, target):
    """Route direct and indirect layout/render/text calls through the shaper."""
    for font_va in THAI_FONT_CALLS.get(target, ()):
        name = 'sub_%08X' % font_va
        body = body.replace('RECOMP_CALL(%s)' % name,
                            'RECOMP_THAI_CALL(0x%08Xu, %s)' % (font_va, name))
    # The glyph renderer is reached through virtual dispatch in parts of the
    # UI (including network chat). RECOMP_CALL replacements alone miss those
    # paths, so route indirect calls through a target-aware dispatcher too.
    body = body.replace('RECOMP_ICALL(', 'RECOMP_THAI_ICALL(')
    return body


def targets():
    return {
        'gamemd': dict(exe=EXE, catalog=CATALOG, seeds=SEEDS, out=OUT, stats=STATS,
                       run_seeds=RUN_SEEDS, hooks=HOOKS, exe_name='gamemd.exe', ini_name='RA2MD.INI',
                       title="Yuri's Revenge", game_frame=0x00A8ED84, stamp=0x3BDF544E,
                       patches=lambda code, cs: {**sidebar_rows_patches(code, cs), **dropdown_frame_patches(code, cs), **HD_VOXEL_PATCHES,
                                                 **modern_controls_patches('gamemd'), **queue_five_patches('gamemd'),
                                                 **yr_online_patches(code, cs),
                                                 **web_exit_confirmation_patches(code, cs, 'gamemd')}),
        'game': dict(exe=os.path.join(_HERE, 'game', 'game.exe'),
                     catalog=os.path.join(_HERE, 'work', 'game', 'functions.json'),
                     seeds=os.path.join(_HERE, 'work', 'game', 'rtti_seeds.json'),
                     out=os.path.join(_HERE, 'src', 'recomp', 'gen_game'),
                     stats=os.path.join(_HERE, 'work', 'game', 'lift_stats.json'),
                     run_seeds=RUN_SEEDS_GAME, hooks=HOOKS_GAME, exe_name='game.exe', ini_name='RA2.INI',
                     title='Red Alert 2', game_frame=0x00A40D2C, stamp=0x3B1EBBED,
                     # Red Alert 2's sidebar: its code at 0x0067B000..0x00683000, its
                     # height 0x0083962C and top 0x00ABCD64, the globals the same divide
                     # by 50 reads as Yuri's Revenge's does.
                     patches=lambda code, cs: {**sidebar_rows_patches(code, cs, 0x0067B000, 0x00683000,
                                                                     (0x0083962C, 0x00ABCD64)),
                                               **dropdown_frame_patches(code, cs), **HD_VOXEL_PATCHES_GAME,
                                               **modern_controls_patches('game'), **queue_five_patches('game'),
                                               **web_exit_confirmation_patches(code, cs, 'game'),
                                               **ra2_shell_patches(code, cs), **ra2_hires_patches(code, cs),
                                               **ra2_online_patches(code, cs), **ra2_confirm_patches(code, cs),
                                               **ra2_cache_patches(code, cs), **ra2_mode_cap_patches(code, cs),
                                               **ra2_load_patches(code, cs), **ra2_profile_patches(code, cs),
                                               **ra2_tab_patches(code, cs)}),
    }


def write_target_header(out, name, t):
    """recomp_target.h: what the host needs to know about the binary it runs."""
    debuglog = [a for a, h in t['hooks'].items() if h == 'debuglog']
    with open(os.path.join(out, 'recomp_target.h'), 'w', newline='\n') as f:
        f.write('/* Generated by run_lift.py --target %s: the binary this build runs. */\n#pragma once\n' % name)
        f.write('#define RA2_TARGET_%s 1\n' % name.upper())
        f.write('#define RA2_EXE_NAME "%s"\n' % t['exe_name'])
        f.write('#define RA2_INI_NAME "%s"\n' % t['ini_name'])
        f.write('#define RA2_TITLE "%s"\n' % t['title'])
        f.write('#define RA2_HOOK_DEBUGLOG_VA 0x%08Xu\n' % (debuglog[0] if debuglog else 0))
        f.write('#define RA2_GAME_FRAME_VA 0x%08Xu   /* the game\'s frame count */\n' % t['game_frame'])
        f.write('#define RA2_EXE_STAMP 0x%08Xu   /* its PE timestamp: the build lifted */\n' % t['stamp'])
        modern = MODERN_CONTROLS_TARGETS[name]
        queue = QUEUE_FIVE_TARGETS[name]
        for key, macro in (('unit_vtable', 'RA2_MODERN_UNIT_VTABLE'),
                           ('infantry_vtable', 'RA2_MODERN_INFANTRY_VTABLE'),
                           ('aircraft_vtable', 'RA2_MODERN_AIRCRAFT_VTABLE')):
            f.write('#define %s 0x%08Xu\n' % (macro, modern[key]))
        for key, macro in (('count', 'RA2_QUEUE_FIVE_COUNT_VA'), ('index', 'RA2_QUEUE_FIVE_INDEX_VA'),
                           ('ring', 'RA2_QUEUE_FIVE_RING_VA'), ('stamps', 'RA2_QUEUE_FIVE_STAMPS_VA')):
            f.write('#define %s 0x%08Xu\n' % (macro, queue[key]))


def exe_stamp(path):
    """The PE header's TimeDateStamp: which build of the game an exe is."""
    with open(path, 'rb') as f:
        head = f.read(4096)
    nt = int.from_bytes(head[0x3C:0x40], 'little')
    return int.from_bytes(head[nt + 8:nt + 12], 'little')


def lifter_stamp():
    """What a lift depends on besides the game: the toolkit's lifter and this
    file's patches. Setup re-lifts when it differs from the one the lift wrote
    (src/recomp/gen/lift_stamp.txt), so a lifter fix reaches an existing install:
    a lift from before MMX paddusb was lifted drew every light as a black circle."""
    h = hashlib.sha1()
    for p in (os.path.join(_TOOLS, 'lift', 'lift32.py'), os.path.join(_TOOLS, 'lift', 'generate.py'),
              os.path.abspath(__file__)):
        h.update(open(p, 'rb').read().replace(b'\r\n', b'\n'))
    return h.hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', choices=('gamemd', 'game'), default='gamemd',
                    help="gamemd: Yuri's Revenge (the default); game: Red Alert 2")
    ap.add_argument('--exe')
    ap.add_argument('--catalog')
    ap.add_argument('--out')
    ap.add_argument('--roots', default='', help='comma-separated extra root VAs')
    ap.add_argument('--max', type=int, default=3000, help='closure size cap')
    ap.add_argument('--all', action='store_true', help='lift every function')
    ap.add_argument('--virtual', action='store_true',
                    help='root the closure at every RTTI vtable method too')
    ap.add_argument('--split', type=int, default=400, help='functions per .c file')
    # More entries a run found, on top of RUN_SEEDS (seed_from_log.py JSON).
    ap.add_argument('--seeds', default=None,
                    help='seed_from_log.py JSON of unresolved targets from runs')
    ap.add_argument('--check', action='store_true',
                    help='exit 0 if the lift is current (this lifter, these patches), 1 if not')
    args = ap.parse_args()
    tgt = targets()[args.target]
    if args.check:
        try:
            sys.exit(0 if open(os.path.join(args.out or tgt['out'], 'lift_stamp.txt')).read().strip()
                     == lifter_stamp() else 1)
        except OSError:
            sys.exit(1)
    args.exe = args.exe or tgt['exe']
    args.catalog = args.catalog or tgt['catalog']
    args.out = args.out or tgt['out']
    if args.seeds is None:
        args.seeds = os.path.join(os.path.dirname(tgt['catalog']), 'run_seeds.json')
    if not os.path.exists(args.catalog):
        sys.exit('no catalog at %s -- run disasm32.py first (README, Step by step)' % args.catalog)

    # The patches below are at this build's addresses; another build lifts,
    # but they land in the wrong code, and it crashes in game (issue #2).
    stamp = exe_stamp(args.exe)
    if stamp != tgt['stamp']:
        sys.exit('%s is not the build this project supports: its PE timestamp is 0x%08X, '
                 'the Steam and EA App release\'s is 0x%08X (docs/RECON.md). A different '
                 'release (a CD, a CnCNet- or mod-patched exe) needs its own addresses; '
                 'use the Steam or EA App build\'s %s.' % (args.exe, stamp, tgt['stamp'], tgt['exe_name']))
    info = analyze_pe(args.exe)
    iat = build_iat_map(info)
    cs, ce = info.code_start, info.code_end
    print('[*] base=0x%08X code=0x%08X-0x%08X IAT=%d' % (info.image_base, cs, ce, len(iat)))

    cat = json.load(open(args.catalog))
    byaddr = {f['address']: f for f in cat['functions'] if cs <= f['address'] < ce}
    print('[*] catalog: %d functions inside .text' % len(byaddr))

    # Vtable slots. Bound each by the next known entry: a slot landing mid-code
    # handed `ce` makes the extent walk descend the whole of .text.
    want = {a for a in tgt['run_seeds'] if cs <= a < ce and a not in byaddr}
    for path in [tgt['seeds']] + ([args.seeds] if args.seeds else []):
        if os.path.exists(path):
            want |= {e['address'] for e in json.load(open(path))
                     if cs <= e['address'] < ce and e['address'] not in byaddr}
    known = sorted(set(byaddr) | want)
    nxt = {a: (known[i + 1] if i + 1 < len(known) else ce) for i, a in enumerate(known)}
    for a in want:
        byaddr[a] = {'address': a, 'end': min(nxt[a], a + 0x100), 'calls_to': [],
                     'entry_kind': 'start'}
    print('[*] vtable slots not in the catalog: %d injected' % len(want))

    entry = info.image_base + info.entry_point_rva
    roots = [entry] + [int(x, 0) for x in args.roots.split(',') if x.strip()]
    if args.virtual and os.path.exists(tgt['seeds']):
        roots += sorted(e['address'] for e in json.load(open(tgt['seeds'])))
    if args.all:
        chosen = set(byaddr)
    else:
        chosen = set(closure(byaddr, roots, args.max))
    print('[*] lifting %d of %d functions (%s)'
          % (len(chosen), len(byaddr), 'all' if args.all else 'closure, cap %d' % args.max))

    md = Cs(CS_ARCH_X86, CS_MODE_32)
    md.detail = True
    text = [s for s in info.sections if s.name == '.text'][0]
    code = open(args.exe, 'rb').read()[text.raw_offset:text.raw_offset + text.raw_size]

    # Known targets become RECOMP_CALL; anything else a decoded `call` names
    # becomes RECOMP_ICALL, which reports at run time instead of failing the build.
    # precise carry: adc/sbb take their carry from the flag state that set it.
    # The default reads a `_cf` that add/sub/cmp never write, which breaks
    # every 64-bit add and subtract. The Movies lost its menu video to it
    # (its docs/bringup.md); off by default in lift32 only because Fury3 leans
    # on the imprecision.
    patches = tgt['patches'](code, cs)
    print('[*] remaster patches: %d' % len(patches))
    lifter = Lifter(iat_map=iat, lifted=set(byaddr), precise_carry=True, precise_sbb=True)
    os.makedirs(args.out, exist_ok=True)
    for fn in os.listdir(args.out):                 # a smaller lift must not leave stale chunks
        if fn.startswith('recomp_') and fn.endswith('.c'):
            os.remove(os.path.join(args.out, fn))
    entries, chunk, idx, errors, dirty = [], [], 0, 0, 0
    ordered = sorted(byaddr)
    starts = {a for a in ordered if byaddr[a].get('entry_kind') != 'alias'}
    t_split = time.time()
    splits = find_splits(md, code, cs, ce, starts)
    starts -= splits          # still dispatchable; just not a wall inside its parent
    print('[*] split entries (the middle of the function before them): %d, %.0fs'
          % (len(splits), time.time() - t_split))
    t0 = time.time()

    def flush(force=False):
        nonlocal chunk, idx
        if chunk and (force or len(chunk) >= args.split):
            write_chunk(args.out, idx, chunk)
            idx += 1
            chunk = []

    def lift_one(addr, name, end, reached):
        nonlocal errors

        if addr in tgt['hooks']:
            hook = tgt['hooks'][addr]
            chunk.append(('extern void ra2_hook_%s(void);\nvoid %s(void) { ra2_hook_%s(); }\n'
                          % (hook, name, hook), addr, name))
            entries.append((addr, name))
            return
        try:
            lo = min(reached) if reached else addr   # a chunk can sit below the entry
            insns, leaders = (linear_disassemble_function(md, code, cs, lo, end, reached=reached)
                              if end > addr else ([], None))
            if leaders is not None:
                leaders.add(addr)
            body = (lift_function_linear(lifter, name, insns, leaders, addr) if insns
                    else 'void %s(void) { }\n' % name)
            body = apply_patches(body, {va: c for va, c in patches.items() if reached and va in reached})
            body = thai_font_call_replacements(body, args.target)
        except Exception as e:                      # noqa: BLE001 -- counted, not hidden
            body = '/* ERROR %s: %s */\nvoid %s(void) { }\n' % (name, e, name)
            errors += 1
        chunk.append((body, addr, name))
        entries.append((addr, name))
        if len(chunk) >= args.split:
            flush()
            print('[*]   %d/%d (%d err)' % (len(entries), len(chosen), errors), flush=True)

    # A direct branch that leaves a body backward to an address nothing
    # catalogued is a tail call the catalog missed (__mtterm: jmp 0x00AD6FB7)
    # or a jump into shared code in a neighbour (hand-written x87 math:
    # __ffexpm1 jne 0x00AE01F0). A direct call can name one too: the catalog
    # dropped 0x00C10170, called directly, because a false start inside the
    # jump table before it decoded over it. Either way the target has to be dispatchable,
    # or the RECOMP_ITAIL cannot resolve. So each round's outside targets
    # become entries and are lifted in the next round, until none are new.
    todo, added = sorted(chosen), 0
    while todo:
        outside = set()
        for addr in todo:
            name = 'sub_%08X' % addr
            reached, behind, called = set(), set(), set()
            end, clean = true_extent(md, code, cs, addr, min(addr + EXTENT_REACH, ce), starts,
                                     reached=reached, behind=behind, called=called)
            outside |= {t for t in behind if t not in reached} | called
            dirty += not clean
            lift_one(addr, name, end, reached)
        todo = sorted(t for t in outside if cs <= t < ce and t not in byaddr)
        for t in todo:
            byaddr[t] = {'address': t, 'end': ce, 'calls_to': [], 'entry_kind': 'start'}
            chosen.add(t)
        added += len(todo)
    print('[*] branch and call targets outside the catalog, added as entries: %d' % added)

    stubs = [a for a in ordered if a not in chosen]
    for a in stubs:
        name = 'sub_%08X' % a
        chunk.append(('void %s(void) { RECOMP_NOT_LIFTED(0x%08Xu); }\n' % (name, a), a, name))
        entries.append((a, name))
        flush()
    flush(force=True)

    with open(os.path.join(args.out, 'recomp_funcs.h'), 'w', newline='\n') as f:
        f.write('/* gamemd.exe - AUTO-GENERATED by run_lift.py */\n#pragma once\n'
                '#include <stdint.h>\n\n'
                '#include "thai_font.h"\n\n'
                'void recomp_not_lifted(uint32_t va);\n'
                '#define RECOMP_NOT_LIFTED(va) recomp_not_lifted(va)\n\n')
        for a, n in entries:
            f.write('void %s(void);\n' % n)
    with open(os.path.join(args.out, 'recomp_dispatch.c'), 'w', newline='\n') as f:
        f.write('/* gamemd.exe - AUTO-GENERATED by run_lift.py */\n'
                '#include "recomp_types.h"\n#include "recomp_funcs.h"\n\n'
                'const recomp_dispatch_entry_t recomp_dispatch_table[] = {\n')
        for a, n in sorted(entries):
            f.write('    { 0x%08Xu, %s },\n' % (a, n))
        f.write('};\nconst uint32_t recomp_dispatch_count = %d;\n'
                'const uint32_t ra2_entry_va = 0x%08Xu;\n' % (len(entries), entry))

    # Readable names, and a header on every function saying what it is, from
    # what the binary itself says: RTTI's vtables, debug messages, vtable
    # stores (pcrecomp's tools/lift/name_lift.py). An older toolkit without it
    # leaves the address names; nothing else depends on them.
    try:
        import name_lift
    except ImportError:
        print('[*] names: no tools/lift/name_lift.py in this pcrecomp; functions keep their address names')
    else:
        rtti_path = os.path.join(os.path.dirname(tgt['seeds']), 'rtti.json')
        rtti = json.load(open(rtti_path)) if os.path.exists(rtti_path) else {}
        known = {va: 'hook_%s' % hook for va, hook in tgt['hooks'].items()}
        named = name_lift.name_lift(args.out, name_lift.Image(args.exe), rtti, known)
        print('[*] names: %d of %d functions named from the binary\'s own evidence'
              % (sum(1 for f in named.values() if f.name), len(named)))

    lines = sum(sum(1 for _ in open(os.path.join(args.out, fn), encoding='utf-8', errors='replace'))
                for fn in os.listdir(args.out))
    stats = {'lifted': len(chosen), 'stubs': len(stubs), 'errors': errors,
             'no_terminator': dirty, 'files': idx, 'lines': lines}
    json.dump(stats, open(tgt['stats'], 'w'), indent=1)
    write_target_header(args.out, args.target, tgt)
    open(os.path.join(args.out, 'lift_stamp.txt'), 'w').write(lifter_stamp() + '\n')
    print('=' * 60)
    print('  lifted %d   not-lifted stubs %d   errors %d   no terminator %d'
          % (len(chosen), len(stubs), errors, dirty))
    print('  %s lines of C in %d files, %.1fs' % (format(lines, ','), idx, time.time() - t0))
    print('=' * 60)


if __name__ == '__main__':
    main()
