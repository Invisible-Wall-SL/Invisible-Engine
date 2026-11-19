"""The camera-image pass Cycles does not have: bloom, a little contrast and saturation, a vignette.

Plain Pillow + numpy, so it also runs outside Blender: `python post.py raw.png final.jpg`.
"""

from __future__ import annotations

import sys

import numpy as np
from PIL import Image, ImageFilter


def grade(src, dst, transparent=False, bloom=0.55, contrast=1.06, saturation=1.12, vignette=0.22, threshold=0.72):
	im = Image.open(src)
	alpha = im.getchannel('A') if im.mode == 'RGBA' else None
	rgb = np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
	h, w = rgb.shape[:2]

	if bloom > 0:
		lum = rgb.max(axis=2, keepdims=True)
		bright = rgb * np.clip((lum - threshold) / (1.0 - threshold), 0, 1)
		bim = Image.fromarray((bright * 255).astype(np.uint8))
		acc = np.zeros_like(rgb)
		for radius, weight in ((w / 220, 0.5), (w / 70, 0.32), (w / 24, 0.18)):
			acc += np.asarray(bim.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0 * weight
		acc *= bloom * 1.8
		rgb = 1.0 - (1.0 - rgb) * (1.0 - np.clip(acc, 0, 1))

	rgb = np.clip((rgb - 0.5) * contrast + 0.5, 0, 1)
	grey = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
	rgb = np.clip(grey[..., None] + (rgb - grey[..., None]) * saturation, 0, 1)

	if vignette > 0 and not transparent:
		yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
		d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
		rgb *= (1.0 - vignette * np.clip(d, 0, 1) ** 2.2)[..., None]

	out = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
	if transparent and alpha is not None:
		out.putalpha(alpha)
		out.save(dst)
	elif dst.lower().endswith('.png'):
		out.save(dst)
	else:
		out.save(dst, quality=88, subsampling=0)
	return dst


def sheet(paths, dst, cols, pad=0, bg=(12, 12, 16)):
	"""Tile images into one sheet (for turnarounds and line-ups)."""
	ims = [Image.open(p).convert('RGB') for p in paths]
	w, h = ims[0].size
	rows = (len(ims) + cols - 1) // cols
	out = Image.new('RGB', (cols * w + (cols + 1) * pad, rows * h + (rows + 1) * pad), bg)
	for i, im in enumerate(ims):
		out.paste(im, (pad + (i % cols) * (w + pad), pad + (i // cols) * (h + pad)))
	out.save(dst, quality=88, subsampling=0)
	return dst


if __name__ == '__main__':
	grade(sys.argv[1], sys.argv[2])
