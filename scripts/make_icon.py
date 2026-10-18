"""Draws the Mythra Board app icon (three linked notes) as a 1024px PNG."""
import sys
from PIL import Image, ImageDraw

S = 2048  # draw at 2x, then downscale for smooth edges
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# Background: rounded square with a vertical indigo gradient (macOS icon grid margins).
m, r = 200, 370
grad = Image.new("RGBA", (S, S))
top, bottom = (124, 108, 255), (72, 62, 214)
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    gd.line([(0, y), (S, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([m, m, S - m, S - m], radius=r, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
line = (255, 255, 255, 200)
notes = [(470, 600, 870, 850), (1180, 900, 1580, 1150), (470, 1200, 870, 1450)]

def mid_right(n): return (n[2], (n[1] + n[3]) // 2)
def mid_left(n): return (n[0], (n[1] + n[3]) // 2)

def curve(p0, p3, w=34, steps=400):
    c = (p3[0] - p0[0]) * 0.55
    p1, p2 = (p0[0] + c, p0[1]), (p3[0] - c, p3[1])
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t**2*p2[0] + t**3*p3[0]
        y = (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t**2*p2[1] + t**3*p3[1]
        pts.append((x, y))
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for x, y in pts:
        ld.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=(255, 255, 255, 255))
    layer.putalpha(layer.getchannel("A").point(lambda a: a * 215 // 255))
    img.alpha_composite(layer)

curve(mid_right(notes[0]), mid_left(notes[1]))
curve(mid_right(notes[2]), mid_left(notes[1]))

fills = [(255, 255, 255, 255), (255, 214, 102, 255), (255, 255, 255, 255)]
for n, f in zip(notes, fills):
    d.rounded_rectangle([n[0], n[1] + 18, n[2], n[3] + 18], radius=60, fill=(30, 20, 120, 70))
    d.rounded_rectangle(n, radius=60, fill=f)
    # two "text" lines on each note
    x0, y0 = n[0] + 70, n[1] + 80
    d.rounded_rectangle([x0, y0, n[2] - 70, y0 + 34], radius=17, fill=(60, 52, 140, 90))
    d.rounded_rectangle([x0, y0 + 74, n[2] - 170, y0 + 108], radius=17, fill=(60, 52, 140, 60))

img.resize((1024, 1024), Image.LANCZOS).save(sys.argv[1])
