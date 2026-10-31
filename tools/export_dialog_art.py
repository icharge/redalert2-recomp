#!/usr/bin/env python3
"""Export the game's own art for the web link dialog (docs/web/frontend.md).

The link dialog is a page component, but it should read as one of the game's
screens. The art it borrows is the chrome Yuri's Revenge's embedded WOL browser
already used (its HTML/ folder): the metal title strip, the red button plate
and the starfield background. Two small transforms are needed:

  * the title strip is cut into a 9-slice sheet (left cap + a text/button-free
    middle + right cap) so it stretches to any dialog width;
  * the button's baked "Cancel" lettering is removed by interpolating each
    row across the lettering, so the DOM button's real text can sit on the
    plate (the plan forbids text that only exists as a sprite).

The retail images are not redistributed (REPO_RULES section 3), so the PNG/JPEG
output lands in web/public/dialog-art/ (ignored) and only the sampled colour
palette is written into the committed component module. Run this once against
your own game folder:

    py -3 tools/export_dialog_art.py
    py -3 tools/export_dialog_art.py --selftest

Without the art the component falls back to the same palette in plain CSS, so
tests and a fresh checkout build without the game.
"""
import argparse
import json
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - the message is the point
    sys.exit("Pillow is required: py -3 -m pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join("HTML", "assets")
NAVBAR = "navbar_bkgd.jpg"
BACKGROUND = "standard_bkg.jpg"
# The starfield's inner panel: the outer metal frame is the dialog's own CSS
# bevel, so the background keeps only the dark map between the two frames.
BACKGROUND_CROP = (60, 55, 740, 505)
BUTTONS = (("button.png", "navcancel0.jpg"), ("button-hover.png", "navcancel1.jpg"))

# Crop boxes measured from the game's 800x40 navbar: the two button plates sit
# at x=265..374 and x=425..534, so [120, 260] is a clean stretchable middle.
TITLE_SLICE_X = 16
TITLE_LEFT = (0, 0, TITLE_SLICE_X, 40)
TITLE_MIDDLE = (120, 0, 260, 40)
TITLE_RIGHT = (784, 0, 800, 40)

# The "Cancel" lettering on the 109x26 plate. The plate keeps its red gradient
# above and below this band, so each affected row is interpolated across it.
TEXT_BOX = (26, 4, 100, 21)


def _load(path):
    return Image.open(path).convert("RGB")


def inpaint_button(image):
    """Remove the baked lettering, keeping the plate's gradient and bevel."""
    out = image.copy()
    pixels = out.load()
    x0, y0, x1, y1 = TEXT_BOX
    width = out.size[0]
    for y in range(y0, y1):
        left = max(0, x0 - 3)
        right = min(width - 1, x1 + 3)
        a = pixels[left, y]
        b = pixels[right, y]
        span = right - left
        for x in range(x0, x1):
            t = (x - left) / span if span else 0.0
            pixels[x, y] = tuple(round(a[c] + (b[c] - a[c]) * t) for c in range(3))
    return out


def title_sheet(navbar):
    """A 9-slice title strip: left cap, stretchable middle, right cap."""
    left = navbar.crop(TITLE_LEFT)
    middle = navbar.crop(TITLE_MIDDLE)
    right = navbar.crop(TITLE_RIGHT)
    sheet = Image.new("RGB", (left.width + middle.width + right.width, navbar.height))
    sheet.paste(left, (0, 0))
    sheet.paste(middle, (left.width, 0))
    sheet.paste(right, (left.width + middle.width, 0))
    return sheet, (TITLE_SLICE_X, 0, TITLE_SLICE_X, 0)


def _luminance(pixel):
    return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]


def _pixels(image):
    width, height = image.size
    data = image.load()
    return [data[x, y] for y in range(height) for x in range(width)]


def _is_metal(pixel):
    return max(pixel) - min(pixel) < 28 and _luminance(pixel) > 70


def _is_red(pixel):
    return pixel[0] > 100 and pixel[0] > pixel[1] + 50 and pixel[0] > pixel[2] + 50


def _pick(pixels, fraction):
    return pixels[min(len(pixels) - 1, max(0, int(len(pixels) * fraction)))]


def palette(navbar, button):
    """The dialog's colours, sampled from the plates it borrows.

    Silver and red are separated by hue, so the metal bevel and the button
    plate each get their own light/mid/dark stops regardless of how much of
    the source image is background.
    """
    pixels = _pixels(navbar) + _pixels(button)
    metals = sorted((p for p in pixels if _is_metal(p)), key=_luminance)
    reds = sorted((p for p in _pixels(button) if _is_red(p)), key=_luminance)
    alls = sorted(pixels, key=_luminance)

    def hexed(pixel):
        return "#%02x%02x%02x" % pixel

    def stop(group, fraction, fallback):
        return hexed(_pick(group, fraction)) if group else fallback

    return {
        "metalLight": stop(metals, 0.94, "#e6e6e6"),
        "metal": stop(metals, 0.55, "#b0b0b0"),
        "metalDark": stop(metals, 0.08, "#4a4a4a"),
        "plate": stop(reds, 0.5, "#a00000"),
        "plateLight": stop(reds, 0.85, "#d02020"),
        "plateDark": stop(reds, 0.2, "#4a0000"),
        "accent": stop(reds, 0.5, "#7a1212"),
        "ink": hexed(_pick(alls, 0.02)),
    }


PALETTE_MODULE = '''// Generated by tools/export_dialog_art.py from the game's HTML/ browser chrome.
// Colours only: the retail images stay in web/public/dialog-art/ (ignored).
// The link dialog uses these as its CSS fallback when that art is absent.
export const GAME_DIALOG_PALETTE = {
  metalLight: "%(metalLight)s",
  metal: "%(metal)s",
  metalDark: "%(metalDark)s",
  plate: "%(plate)s",
  plateLight: "%(plateLight)s",
  plateDark: "%(plateDark)s",
  accent: "%(accent)s",
  ink: "%(ink)s",
} as const;

export type GameDialogPalette = typeof GAME_DIALOG_PALETTE;
'''


def export(game, out, palette_path):
    assets = os.path.join(game, ASSETS)
    navbar_path = os.path.join(assets, NAVBAR)
    if not os.path.isfile(navbar_path):
        sys.exit("no %s: pass --game <a folder with HTML/assets>" % navbar_path)
    os.makedirs(out, exist_ok=True)
    navbar = _load(navbar_path)
    sheet, slices = title_sheet(navbar)
    sheet.save(os.path.join(out, "title.png"))
    background = _load(os.path.join(assets, BACKGROUND))
    background.crop(BACKGROUND_CROP).save(os.path.join(out, "background.jpg"))
    colors = None
    for name, source in BUTTONS:
        plate = _load(os.path.join(assets, source))
        colors = colors or palette(navbar, plate)
        inpaint_button(plate).save(os.path.join(out, name))
    manifest = {
        "source": "HTML/assets from the game folder",
        "files": {
            "title.png": {
                "nineSlice": list(slices),
                "width": sheet.width,
                "height": sheet.height,
            },
            "background.jpg": {"crop": list(BACKGROUND_CROP)},
            "button.png": {"width": 109, "height": 26, "textRemoved": list(TEXT_BOX)},
            "button-hover.png": {"width": 109, "height": 26, "textRemoved": list(TEXT_BOX)},
        },
        "palette": colors,
    }
    with open(os.path.join(out, "dialog-art.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    os.makedirs(os.path.dirname(palette_path), exist_ok=True)
    with open(palette_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(PALETTE_MODULE % colors)
    print("dialog art -> %s" % out)
    print("palette    -> %s" % palette_path)


def _selftest():
    nav = Image.new("RGB", (800, 40), (30, 4, 4))
    for x in range(800):
        for y in range(3):
            nav.putpixel((x, y), (210, 210, 210))  # silver top bevel
        nav.putpixel((x, 39), (120, 120, 120))
    plate = Image.new("RGB", (109, 26), (150, 20, 20))
    for x in range(TEXT_BOX[0], TEXT_BOX[2]):
        for y in range(TEXT_BOX[1], TEXT_BOX[3]):
            plate.putpixel((x, y), (255, 240, 170))  # pretend lettering
    clean = inpaint_button(plate)
    for x in range(TEXT_BOX[0], TEXT_BOX[2]):
        for y in range(TEXT_BOX[1], TEXT_BOX[3]):
            assert clean.getpixel((x, y)) != (255, 240, 170), (x, y)
    sheet, slices = title_sheet(nav)
    assert sheet.size == (TITLE_SLICE_X + 140 + TITLE_SLICE_X, 40), sheet.size
    assert slices == (TITLE_SLICE_X, 0, TITLE_SLICE_X, 0), slices
    colors = palette(nav, plate)
    assert set(colors) == {
        "metalLight", "metal", "metalDark", "plate", "plateLight", "plateDark", "accent", "ink"
    }, colors
    assert colors["metalLight"] == "#d2d2d2", colors
    assert colors["plate"] == "#961414", colors
    print("export_dialog_art.py self-test OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--game", default=os.path.join(ROOT, "game"))
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "dialog-art"))
    ap.add_argument(
        "--palette",
        default=os.path.join(ROOT, "web", "src", "components", "game-dialog-palette.ts"),
    )
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        return _selftest()
    export(args.game, args.out, args.palette)


if __name__ == "__main__":
    main()
