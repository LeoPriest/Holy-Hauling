"""Build the home-screen icons from the brand logo.

Run from the repo root:  python scripts/make_app_icons.py

Writes into app/frontend/public/:
  apple-touch-icon.png  180x180  iPhone "Add to Home Screen"
  icon-192.png          192x192  Android / manifest
  icon-512.png          512x512  Android splash / manifest
  icon-maskable-512.png 512x512  Android adaptive icon (extra padding for the crop)
  favicon-32.png        32x32    browser tab

The white logo mark (rays, cross, truck) sits on Workday green. Phones mask
transparent icons with black, so every icon gets a solid background.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "app" / "frontend" / "public"
MARK = PUBLIC / "brand" / "logo-mark-white.png"
BG = (27, 109, 96, 255)  # --pr #1b6d60

# Share of the icon's width the logo fills. Maskable icons must keep the logo
# inside the centre 80% circle, so they get more room around it.
ICONS = [
    ("apple-touch-icon.png", 180, 0.72),
    ("icon-192.png", 192, 0.72),
    ("icon-512.png", 512, 0.72),
    ("icon-maskable-512.png", 512, 0.56),
    ("favicon-32.png", 32, 0.86),
]


def make_icon(mark: Image.Image, size: int, fill: float) -> Image.Image:
    logo = mark.crop(mark.getbbox())
    scale = size * fill / max(logo.size)
    logo = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.LANCZOS)
    icon = Image.new("RGBA", (size, size), BG)
    icon.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    return icon.convert("RGB")


def main() -> None:
    mark = Image.open(MARK).convert("RGBA")
    for name, size, fill in ICONS:
        make_icon(mark, size, fill).save(PUBLIC / name, optimize=True)
        print(f"[ok] {name} {size}x{size}")


if __name__ == "__main__":
    main()
