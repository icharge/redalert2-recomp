import struct, os
from collections import Counter
from PIL import Image

SRC = "game/wdt.mix"
OUT = "work/wdt-art"
os.makedirs(OUT, exist_ok=True)
data = open(SRC, "rb").read()

def rle_decode(off, w, h, planes):
    at = off + 128
    per_line = struct.unpack_from("<H", data, off + 66)[0]
    total = per_line * planes * h
    out = bytearray()
    while len(out) < total:
        if at >= len(data):
            return None, at
        b = data[at]; at += 1
        if (b & 0xC0) == 0xC0:
            n = b & 0x3F
            if at >= len(data):
                return None, at
            out.extend([data[at]] * n); at += 1
        else:
            out.append(b)
    return out[:total], at

def to_image(w, h, planes, raw, pal):
    if planes == 1:
        px = bytearray()
        for y in range(h):
            px.extend(raw[y * w:(y + 1) * w])
        # stride correction is unnecessary when per_line == w
        img = Image.frombytes("P", (w, h), bytes(px))
        if pal:
            img.putpalette(bytes(pal))
        return img.convert("RGB")
    # 3 planes, 8 bits each: R plane, G plane, B plane per scanline
    rgb = bytearray(w * h * 3)
    per_line = w
    for y in range(h):
        base = y * per_line * 3
        for x in range(w):
            i = (y * w + x) * 3
            rgb[i] = raw[base + x]
            rgb[i + 1] = raw[base + per_line + x]
            rgb[i + 2] = raw[base + 2 * per_line + x]
    return Image.frombytes("RGB", (w, h), bytes(rgb))

cands = []
at = 0
while at < len(data) - 128:
    if data[at] != 0x0A:
        at += 1; continue
    if data[at + 2] not in (0, 1) or data[at + 3] != 8:
        at += 1; continue
    planes = data[at + 65]
    if planes not in (1, 3):
        at += 1; continue
    xmin, ymin, xmax, ymax = struct.unpack_from("<4H", data, at + 4)
    if xmin or ymin:
        at += 1; continue
    w, h = xmax + 1, ymax + 1
    if not (16 <= w <= 2048 and 16 <= h <= 2048):
        at += 1; continue
    per_line = struct.unpack_from("<H", data, at + 66)[0]
    if per_line < w:
        at += 1; continue
    raw, end = rle_decode(at, w, h, planes)
    if not raw:
        at += 1; continue
    pal = data[end + 1:end + 769] if planes == 1 and end + 769 <= len(data) and data[end] == 0x0C else None
    cands.append((at, w, h, planes, raw, pal))
    at = max(end, at + 1)

fallback = next((c[5] for c in cands if c[5]), None)
print("usable:", len(cands), "palette:", "yes" if fallback else "no")
for off, w, h, planes, raw, pal in cands:
    img = to_image(w, h, planes, raw, pal or fallback)
    c = Counter(img.getdata()); uniq = len(c)
    tag = "background" if uniq > 64 else "clickmap"
    if (w, h) == (168, 480):
        tag = "sidebar"
    elif (w, h) == (472, 32):
        tag = "helpbar"
    name = f"{tag}_{off:07x}_{w}x{h}.png"
    img.save(os.path.join(OUT, name))
    print(f"  {off:7d} {w}x{h} p={planes} uniq={uniq:4d} {name}")
