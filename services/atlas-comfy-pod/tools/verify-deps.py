"""Fail the build if the shared dependency base is not importable, or torch is the wrong build.

Why this exists: the image installs every custom node's `requirements.txt` in a loop with
`|| true`, so ONE node's stale pin silently rewrites a package every other node shares and
the build still goes green. That is exactly how `ComfyUI-PuLID-Flux2`'s `ml_dtypes==0.3.2`
shipped an image whose face stack could not import (2026-08-20): numpy was restored to 2.x
by the cu128 torch step afterwards, leaving a numpy-1.x-ABI wheel behind it.

Deliberately NOT a `pip check` replacement — the two catch different things, and pip check
alone would have MISSED that bug. `onnx` declares `ml_dtypes` with no version bound, so
0.3.2 satisfied the metadata and the tree looked clean. A wheel compiled against numpy's
1.x C API fails at IMPORT, not at resolution, so importing is the only way to see it.

That bug is now largely PREVENTED rather than merely detected: `constraints.txt` binds every
pip step (via `PIP_CONSTRAINT`), so a contradicting pin fails its own install instead of
rewriting a shared package. This file is the check that the prevention worked — and it also
now asserts the torch BUILD, the job that used to be done by ordering torch last.

Baked into the image (like fetch-models.py) so a live pod can re-run it after anything is
installed by hand or by ComfyUI-Manager:

    python /verify-deps.py
"""
from __future__ import annotations

import importlib
import os
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


def torch_build_ok() -> bool:
	"""Is the installed torch the CUDA build the image asked for?

	This is the guard that REPLACED "cu128 torch must be the last pip step". Ordering used
	to make the build unclobberable; `constraints.txt` does that now, which is what let the
	custom nodes move to the cheap tail of the Dockerfile. Neither is worth trusting blind:
	a cu124 torch on a Blackwell pod does not fail here, it fails at the artist's first
	render with "no kernel image is available for execution on the device".

	The expected build comes from the Dockerfile's `TORCH_CUDA` ARG, so this file never
	holds a second copy of it. Unset (a live pod re-running this by hand) → skipped.
	"""
	expected = os.environ.get("EXPECTED_TORCH_CUDA", "").strip()
	if not expected:
		print("  skip torch build  (EXPECTED_TORCH_CUDA unset)")
		return True
	try:
		import torch
	except Exception as exc:  # noqa: BLE001 — already reported by the import loop
		print(f"  FAIL torch build  not importable: {exc}")
		return False
	version = getattr(torch, "__version__", "")
	# A cu-index wheel carries the build as a PEP 440 local label: `2.11.0+cu128`. A stock
	# PyPI torch has no local label at all, so a silent swap shows up as a missing suffix.
	if version.split("+")[-1] == expected and "+" in version:
		print(f"  ok   torch build  {version}")
		return True
	print(f"  FAIL torch build  {version or '?'} is not a +{expected} build")
	print(
		"    Something resolved torch off PyPI instead of the cu index. On Blackwell "
		"(sm_120) that image renders nothing — 'no kernel image is available'. Check "
		"constraints.txt still pins torch, and that no pip step passes --no-deps around it."
	)
	return False


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
			"Add a FLOOR for it to constraints.txt — that file binds every pip step in the "
			"image, so the node's own install fails instead of the shared base — rather "
			"than pinning the package somewhere later and hoping the order holds."
		)
		return 1

	if not torch_build_ok():
		return 1

	print("verify-deps: all clear")
	return 0


if __name__ == "__main__":
	sys.exit(main())
