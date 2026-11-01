"""Build the missing WDT 800 art set from the shipped 640 art.

Only the 640 assets ship (WDTMap.ini references Art_800 files that are absent).
The 800 layout is 632x568 inside an 800x600 screen: sidebar 168x600, help bar
632x32. We upscale the 640 background/click map and stretch the shared chrome,
writing loose PCX files under game/ so they override the MIX.

Usage: python tools/wdt_art800.py [--map america|asia|europe]
"""
import argparse, struct
from PIL import Image

ART = "work/wdt-art"
GAME = "game"

SOURCES = {
    "america": ("background_00c2174_472x448", "clickmap_014af44_472x448",
                "America_WorldDom_A", "Amer_ClikMap_Temp"),
    "asia": ("background_021bec4_472x448", "clickmap_02a1f74_472x448",
             "Asia_WorldDom_A", "Asia_ClikMap_Temp"),
    "europe": ("background_03b7784_472x448", "clickmap_01f81a4_472x448",
               "Europe_WorldDom_A", "Euro_ClikMap_Temp"),
}
SIDEBAR = "sidebar_0445214_168x480"
HELPBAR = "helpbar_0440e64_472x32"

MAP_W, MAP_H = 632, 568
SIDE_W, SIDE_H = 168, 600
BAR_W, BAR_H = 632, 32


def pcx_header(w, h, planes):
    hdr = bytearray(128)
    hdr[0] = 0x0A          # manufacturer
    hdr[1] = 5             # version 5
    hdr[2] = 0             # no RLE
    hdr[3] = 8             # bits per pixel
    struct.pack_into("<4H", hdr, 4, 0, 0, w - 1, h - 1)
    struct.pack_into("<H", hdr, 12, 72)   # horizontal dpi
    struct.pack_into("<H", hdr, 14, 72)
    struct.pack_into("<H", hdr, 66, w)    # bytes per line
    struct.pack_into("<H", hdr, 68, 1)    # palette info
    hdr[65] = planes
    return bytes(hdr)


def write_rgb_pcx(path, img):
    w, h = img.size
    rgb = img.convert("RGB")
    planes = [rgb.getchannel(c).tobytes() for c in range(3)]
    body = bytearray()
    for y in range(h):
        for p in range(3):
            body.extend(planes[p][y * w:(y + 1) * w])
    with open(path, "wb") as f:
        f.write(pcx_header(w, h, 3))
        f.write(body)


def write_indexed_pcx(path, img):
    """img must be mode P; writes a single-plane 8-bit PCX with its palette."""
    w, h = img.size
    idx = img.tobytes()
    pal = img.getpalette() or []
    pal = (pal + [0] * 768)[:768]
    with open(path, "wb") as f:
        f.write(pcx_header(w, h, 1))
        f.write(idx)
        f.write(b"\x0c")
        f.write(bytes(pal))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", default="america", choices=sorted(SOURCES))
    args = ap.parse_args()
    bg, click, bg_name, click_name = SOURCES[args.map]

    background = Image.open(f"{ART}/{bg}.png").convert("RGB")
    clickmap = Image.open(f"{ART}/{click}.png")
    if clickmap.mode != "P":
        clickmap = clickmap.convert("P", palette=Image.ADAPTIVE, colors=32)
    sidebar = Image.open(f"{ART}/{SIDEBAR}.png").convert("RGB")
    helpbar = Image.open(f"{ART}/{HELPBAR}.png").convert("RGB")

    write_rgb_pcx(f"{GAME}/{bg_name}.pcx", background.resize((MAP_W, MAP_H), Image.LANCZOS))
    write_indexed_pcx(f"{GAME}/{click_name}.pcx", clickmap.resize((MAP_W, MAP_H), Image.NEAREST))
    write_rgb_pcx(f"{GAME}/WDTSd800.pcx", sidebar.resize((SIDE_W, SIDE_H), Image.LANCZOS))
    write_rgb_pcx(f"{GAME}/WDTBtm800.pcx", helpbar.resize((BAR_W, BAR_H), Image.LANCZOS))
    print(f"wrote {bg_name}.pcx {MAP_W}x{MAP_H}, {click_name}.pcx, "
          f"WDTSd800.pcx {SIDE_W}x{SIDE_H}, WDTBtm800.pcx {BAR_W}x{BAR_H}")


if __name__ == "__main__":
    main()
