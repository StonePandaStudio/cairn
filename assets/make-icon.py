#!/usr/bin/env python3
"""Generate assets/cairn.ico — a stacked-stone cairn mark.

A cairn is a stack of balanced stones left to mark a trail; see README.
Rendered at 8x then downsampled, emitted as a multi-size .ico.

    python assets/make-icon.py
"""

from PIL import Image, ImageDraw, ImageFilter

SS = 8                      # supersample factor
S = 256 * SS                # working canvas edge
OUT = "assets/cairn.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]

BG_TOP = (54, 62, 74)      # slate, lit
BG_BOT = (30, 34, 41)      # slate, shadow

# bottom -> top: stones get lighter and smaller, like distance haze in reverse
STONES = [
    # (cx, cy, rx, ry, fill)
    (128, 210, 82, 34, (122, 128, 137)),
    (122, 158, 66, 30, (150, 156, 165)),
    (133, 112, 49, 25, (176, 182, 190)),
    (127,  74, 33, 20, (201, 206, 213)),
]


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def main():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # vertical gradient background
    for y in range(S):
        draw.line([(0, y), (S, y)], fill=lerp(BG_TOP, BG_BOT, y / S) + (255,))

    def sc(v):
        return v * SS

    for cx, cy, rx, ry, fill in STONES:
        cx, cy, rx, ry = sc(cx), sc(cy), sc(rx), sc(ry)
        box = [cx - rx, cy - ry, cx + rx, cy + ry]
        # contact shadow
        sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse(
            [cx - rx * 0.95, cy + ry * 0.15, cx + rx * 0.95, cy + ry * 1.15],
            fill=(0, 0, 0, 90),
        )
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(sc(6))))
        draw.ellipse(box, fill=fill + (255,))
        # top highlight
        hl = lerp(fill, (255, 255, 255), 0.35) + (255,)
        draw.ellipse(
            [cx - rx * 0.6, cy - ry * 0.75, cx + rx * 0.6, cy - ry * 0.1],
            fill=hl,
        )
        # re-seat the stone body over the hard highlight edge
        body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(body).ellipse(box, fill=fill + (40,))
        img.alpha_composite(body)
        # crisp rim
        draw.ellipse(box, outline=lerp(fill, BG_BOT, 0.5) + (255,), width=sc(2))

    # clip to rounded square
    mask = rounded_mask(S, sc(56))
    img.putalpha(mask)

    img = img.resize((256, 256), Image.LANCZOS)
    img.save(OUT, format="ICO", sizes=[(n, n) for n in SIZES])
    print(f"wrote {OUT}: {', '.join(f'{n}x{n}' for n in SIZES)}")


if __name__ == "__main__":
    main()
