"""Generate tiny, independently authored TrueType fixtures for ABI regressions."""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


OUT = Path(__file__).parent


def rectangle(left: int, bottom: int, right: int, top: int):
    pen = TTGlyphPen(None)
    pen.moveTo((left, bottom))
    pen.lineTo((right, bottom))
    pen.lineTo((right, top))
    pen.lineTo((left, top))
    pen.closePath()
    return pen.glyph()


def build(path: Path, family: str, advance: int, rect: tuple[int, int, int, int]):
    fb = FontBuilder(1000, isTTF=True)
    order = [".notdef", "A", "i"]
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({ord("A"): "A", ord("i"): "i"})
    fb.setupGlyf({
        ".notdef": rectangle(0, 0, 500, 700),
        "A": rectangle(*rect),
        "i": rectangle(0, 0, 100, 700),
    })
    fb.setupHorizontalMetrics({".notdef": (500, 0), "A": (advance, 0), "i": (300, 0)})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({
        "familyName": family,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"RA2 test fixture {path.stem}",
        "fullName": f"{family} Regular",
        "psName": f"RA2-{path.stem}",
    })
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    fb.setupMaxp()
    fb.save(path)


if __name__ == "__main__":
    build(OUT / "same_name_override.ttf", "Noto Sans", 100, (0, 0, 100, 700))
    build(OUT / "oversized_outline.ttf", "RA2 Oversized Fixture", 100, (-15000, -15000, 15000, 15000))
