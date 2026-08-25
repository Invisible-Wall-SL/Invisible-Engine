"""Fail the build if the shared dependency base is not importable.

Why this exists: the image installs every custom node's `requirements.txt` in a loop with
`|| true`, so ONE node's stale pin silently rewrites a package every other node shares and
the build still goes green. That is exactly how `ComfyUI-PuLID-Flux2`'s `ml_dtypes==0.3.2`
shipped an image whose face stack could not import (2026-08-20): numpy was restored to 2.x
by the cu128 torch step afterwards, leaving a numpy-1.x-ABI wheel behind it.

Deliberately NOT a `pip check` replacement — the two catch different things, and pip check
alone would have MISSED that bug. `onnx` declares `ml_dtypes` with no version bound, so
0.3.2 satisfied the metadata and the tree looked clean. A wheel compiled against numpy's
1.x C API fails at IMPORT, not at resolution, so importing is the only way to see it.

Baked into the image (like fetch-models.py) so a live pod can re-run it after anything is
installed by hand or by ComfyUI-Manager:

    python /verify-deps.py
"""
from __future__ import annotations

import importlib
import sys

# Kept small on purpose: the shared numerical base, plus the face stack that the PuLID
# nodes (FLUX.1 and FLUX.2 alike) are the first to fail on when something under them moves.
# Every module here is CPU-importable, so this needs no GPU on a CI runner.
MODULES = [
	"numpy",
	"ml_dtypes",
	"onnx",
	"onnxruntime",
	"insightface",
	"cv2",
	"torch",
	"open_clip",
	"safetensors",
	# VideoHelperSuite's ffmpeg locator. If this one is missing the pack still imports
	# and only fails at RENDER with "No valid ffmpeg found" — the apt ffmpeg is a second
	# chance, not the primary path, so check the dep the requirements loop can swallow.
	"imageio_ffmpeg",
]


def main() -> int:
	broken: list[str] = []
	for name in MODULES:
		try:
			module = importlib.import_module(name)
		except Exception as exc:  # noqa: BLE001 — any import failure is the signal
			broken.append(name)
			print(f"  FAIL {name:12} {type(exc).__name__}: {exc}")
		else:
			print(f"  ok   {name:12} {getattr(module, '__version__', '?')}")

	if broken:
		print()
		print(f"Un-importable: {', '.join(broken)}")
		print(
			"A node's requirements.txt almost certainly moved a shared package backwards. "
			"Add a FLOOR for it to the face-stack pip step in the Dockerfile (the step runs "
			"after the requirements loop, so a floor there wins) rather than pinning it."
		)
		return 1

	print("verify-deps: all clear")
	return 0


if __name__ == "__main__":
	sys.exit(main())
