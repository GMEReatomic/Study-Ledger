"""Generate the PWA raster icons from a simple line-art notebook mark."""

from pathlib import Path
from PIL import Image, ImageDraw

SCALE = 4
SIZE = 1024
OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(parents=True, exist_ok=True)

ink = (44, 62, 80, 255)
brown = (130, 99, 71, 255)
paper = (247, 242, 231, 255)
page = (255, 253, 249, 255)
line = (201, 182, 150, 130)

canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas, "RGBA")

# Paper card with a quiet inner rule.
draw.rounded_rectangle((0, 0, SIZE, SIZE), radius=220, fill=paper)
for y in range(170, 880, 64):
    draw.line((80, y, 944, y), fill=(44, 62, 80, 13), width=2)
draw.rounded_rectangle((44, 44, SIZE - 44, SIZE - 44), radius=195, outline=line, width=6)

# Open notebook.
left_page = [(210, 338), (500, 405), (500, 790), (210, 720)]
right_page = [(524, 405), (814, 338), (814, 720), (524, 790)]
for poly in (left_page, right_page):
    draw.polygon(poly, fill=page)
    draw.line(poly + [poly[0]], fill=ink, width=18, joint="curve")
draw.line((512, 412, 512, 792), fill=ink, width=16)

# Ruled lines inside the book.
for offset in (0, 55, 110):
    draw.line((264, 407 + offset, 450, 441 + offset), fill=brown, width=10)
    draw.line((574, 441 + offset, 760, 407 + offset), fill=brown, width=10)

# Spine shading, tiny bookmark, and a sparkle.
draw.line((500, 405, 500, 790), fill=(201, 182, 150, 170), width=7)
draw.line((524, 405, 524, 790), fill=(201, 182, 150, 170), width=7)
draw.polygon([(730, 364), (748, 364), (748, 428), (739, 415), (730, 428)], fill=brown)
star = [(818, 170), (838, 224), (892, 244), (838, 264), (818, 318), (798, 264), (744, 244), (798, 224)]
draw.polygon(star, fill=paper, outline=brown, width=8)

# Downsample for clean antialiasing.
for size in (512, 192, 180):
    icon = canvas.resize((size, size), Image.Resampling.LANCZOS)
    icon.save(OUT / f"icon-{size}.png", optimize=True)

print("Generated icon-512.png, icon-192.png and icon-180.png")
