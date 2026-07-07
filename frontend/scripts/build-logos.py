"""
Generate web-ready, optimized Interlaken logo assets from the official source PNGs.

Source of truth : frontend/assets/*.png  (2000x2000, on white)
Output          : frontend/public/assets/  (color + knockout, webp + png)
                  frontend/public/          (favicon / PWA / OG)

Run: python scripts/build-logos.py   (from the frontend/ directory)

Rules honored (see BRAND_LOGO_GUIDE.md):
  - Never recolor / re-typeset the artwork. Colored versions keep the exact
    original pixels; only white-background keying and a straight white knockout
    (for dark backgrounds) are derived.
  - Preserve aspect ratio; trim only surrounding whitespace + keep clear-space.
"""
import os
from PIL import Image, ImageChops, ImageOps

SRC = "assets"
OUT = "public/assets"
PUB = "public"
os.makedirs(OUT, exist_ok=True)

WEBP = dict(format="WEBP", quality=90, method=6)


def trim(im, pad_frac=0.04):
    """Trim the transparent margin (via the alpha channel), then re-add
    uniform clear-space padding. Sources are already transparent PNGs."""
    im = im.convert("RGBA")
    box = im.split()[-1].getbbox()
    if not box:
        return im
    im = im.crop(box)
    w, h = im.size
    pad = int(round(max(w, h) * pad_frac))
    out = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    out.paste(im, (pad, pad))
    return out


def knockout(im):
    """Solid-white silhouette of the artwork on transparent bg (for dark bg).
    Keeps the original alpha (shapes + anti-aliasing), forces RGB to white."""
    im = im.convert("RGBA")
    alpha = im.split()[-1]
    white = Image.new("RGBA", im.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    return white


def cap(im, max_dim):
    """Downscale so the longest side <= max_dim (never upscale)."""
    w, h = im.size
    s = min(1.0, max_dim / max(w, h))
    if s < 1.0:
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    return im


def save_pair(im, name):
    """Write <name>.webp + <name>.png into OUT."""
    im.save(f"{OUT}/{name}.png")
    im.save(f"{OUT}/{name}.webp", **WEBP)
    print(f"  {name}.png / .webp  {im.size}")


# --- load sources ------------------------------------------------------------
horizontal = Image.open(f"{SRC}/logo-horizontal.png")
vertical = Image.open(f"{SRC}/logo-vertical.png")
seal = Image.open(f"{SRC}/logo-40 anos.png")

print("Exporting color logos (transparent bg)…")
h_col = cap(trim(horizontal), 1200)
save_pair(h_col, "logo-horizontal")

v_col = cap(trim(vertical), 900)
save_pair(v_col, "logo-vertical")

seal_col = cap(trim(seal), 900)
save_pair(seal_col, "logo-seal-40")

print("Exporting knockout (white) logos for dark backgrounds…")
save_pair(cap(knockout(trim(horizontal)), 1200), "logo-horizontal-white")
save_pair(cap(knockout(trim(vertical)), 900), "logo-vertical-white")

print("Cropping the clock isotipo from the vertical logo…")
# clock lives above the red rule at y=1240 in the 2000px source
iso_src = vertical.crop((0, 0, 2000, 1180))
iso = cap(trim(iso_src, pad_frac=0.06), 512)
save_pair(iso, "logo-isotipo")

# --- favicon / PWA / OG ------------------------------------------------------
print("Building favicon / PWA / OG assets…")


def on_white(im, size, pad_frac=0.10):
    """Square canvas, white bg, isotipo centered with padding."""
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    inner = int(size * (1 - 2 * pad_frac))
    art = cap(im.copy(), inner)
    x = (size - art.size[0]) // 2
    y = (size - art.size[1]) // 2
    canvas.alpha_composite(art, (x, y))
    return canvas.convert("RGB")


iso_hires = trim(vertical.crop((0, 0, 2000, 1180)), pad_frac=0.06)

# favicon.ico (multi-res, on white for legibility at tiny sizes)
ico = on_white(iso_hires, 256)
ico.save(f"{PUB}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print(f"  favicon.ico")

# transparent svg-ish png favicon + apple + PWA icons
on_white(iso_hires, 180).save(f"{PUB}/apple-touch-icon.png")
on_white(iso_hires, 192).save(f"{PUB}/icon-192.png")
on_white(iso_hires, 512).save(f"{PUB}/icon-512.png")
# maskable-safe: more padding so it survives Android circle mask
on_white(iso_hires, 512, pad_frac=0.18).save(f"{PUB}/icon-maskable-512.png")
print("  apple-touch-icon.png / icon-192 / icon-512 / icon-maskable-512")

# Open Graph 1200x630 — white horizontal knockout on brand-dark bg
og = Image.new("RGBA", (1200, 630), (8, 5, 22, 255))  # #080516
logo_ko = knockout(trim(horizontal))
logo_ko = cap(logo_ko, 860)
ox = (1200 - logo_ko.size[0]) // 2
oy = (630 - logo_ko.size[1]) // 2
og.alpha_composite(logo_ko, (ox, oy))
og.convert("RGB").save(f"{PUB}/og-image.png")
print("  og-image.png  (1200x630)")

print("Done.")
