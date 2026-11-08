"""Visual regression check for PCX images in the Westwood Online legend."""
import sys
from PIL import Image

image = Image.open(sys.argv[1]).convert("RGB")
width, height = image.size
scale = width / 800.0
# WOL legend icon HWNDs in the game's 800x600 coordinate space, as created by
# online.cpp. These five rows are PCX-backed Static controls.
rows = [325, 351, 375, 400, 424]
for row in rows:
    left = round(96 * scale)
    top = round((row - 2) * scale)
    right = round(130 * scale)
    bottom = round((row + 18) * scale)
    crop = image.crop((left, top, right, bottom))
    visible = sum(1 for pixel in crop.get_flattened_data() if max(pixel) > 120)
    assert visible >= 8, f"PCX icon at game y={row} is missing: only {visible} visible pixels"
print(f"PCX legend icons visible in {sys.argv[1]}")
