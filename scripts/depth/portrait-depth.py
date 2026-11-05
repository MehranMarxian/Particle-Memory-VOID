"""
The starter depth map for public/samples/void-portrait.webp (0.15.1).

Sculpted from simple forms placed on the photograph by hand - a head, a nose,
eye sockets, lips, a chin, a neck - not estimated by any model. White is near,
black is far. It is a starting point: paint over the PNG it writes, keeping
the same size and white-near, and VOID uses the painting instead.

    python scripts/depth/portrait-depth.py public/samples/void-portrait.depth.png
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

W = H = 720
y, x = np.mgrid[0:H, 0:W].astype(np.float32)


def ellipsoid(cx, cy, rx, ry):
    """0..1 height of an ellipsoid's cap, 0 outside it."""
    r2 = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
    return np.sqrt(np.clip(1.0 - r2, 0.0, 1.0))


def bump(cx, cy, sx, sy):
    return np.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2) / 2.0)


def ridge(x0, y0, x1, y1, width, h0, h1):
    """A ridge along a segment, rising from h0 to h1, gaussian across."""
    dx, dy = x1 - x0, y1 - y0
    length2 = dx * dx + dy * dy
    t = np.clip(((x - x0) * dx + (y - y0) * dy) / length2, 0.0, 1.0)
    px, py = x0 + t * dx, y0 + t * dy
    d2 = (x - px) ** 2 + (y - py) ** 2
    return (h0 + (h1 - h0) * t) * np.exp(-d2 / (2 * width * width))


# The room behind, and the hair around the head.
depth = np.full((H, W), 0.12, np.float32)
depth = np.maximum(depth, 0.22 + 0.24 * ellipsoid(390, 330, 360, 430))

# The face: an ellipsoid from the hairline to the chin.
face = 0.38 + 0.32 * ellipsoid(390, 410, 235, 290)
face += 0.03 * bump(390, 185, 170, 18)  # brow
face += 0.04 * (bump(250, 330, 60, 50) + bump(540, 322, 60, 50))  # cheekbones
face -= 0.09 * (bump(262, 222, 48, 30) + bump(515, 217, 48, 30))  # eye sockets
face += 0.035 * (bump(262, 222, 22, 14) + bump(515, 217, 22, 14))  # the eyes in them
# The nose: a bridge rising to the tip, its ball, and the wings of the nostrils.
face += ridge(390, 250, 403, 380, 30, 0.03, 0.11)
face += 0.05 * bump(405, 390, 36, 30)
face += 0.05 * (bump(357, 410, 22, 18) + bump(453, 407, 22, 18))
face -= 0.03 * bump(405, 445, 30, 14)  # under the nose
# The mouth: the lips forward, the corners drawn in.
face += 0.07 * bump(385, 515, 85, 30)
face -= 0.04 * (bump(288, 520, 18, 18) + bump(484, 514, 18, 18))
# The chin.
face += 0.05 * bump(380, 615, 55, 40)
# Blended in at its edge: a hard outline reads as a crease where face meets hair.
edge = np.clip(ellipsoid(390, 410, 245, 300) * 3.0, 0.0, 1.0)
depth = depth * (1 - edge) + np.maximum(depth, face) * edge

# The neck, behind the chin, and the shoulder at the bottom left.
neck = 0.30 + 0.12 * np.sqrt(np.clip(1.0 - ((x - 390) / 170) ** 2, 0.0, 1.0))
depth = np.where((y > 560) & (np.abs(x - 390) < 170), np.maximum(depth, neck), depth)
shoulder = 0.26 + 0.08 * bump(40, 690, 120, 90)
depth = np.where((x < 170) & (y > 540), np.maximum(depth, shoulder), depth)

img = Image.fromarray(np.clip(depth * 255, 0, 255).astype(np.uint8), "L")
img = img.filter(ImageFilter.GaussianBlur(4))
img.save(sys.argv[1] if len(sys.argv) > 1 else "void-portrait.depth.png", optimize=True)
