"""Import helper.

The package directory is named `ComfyUI-SemanticLayers`, which is not a Python
identifier — so it cannot be `import`ed with a statement, but `import_module` takes any
on-disk name. This is also exactly how ComfyUI loads it, so the tests exercise the real
module layout rather than a repackaged copy.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parents[1]
PKG_NAME = PKG_ROOT.name

if str(PKG_ROOT.parent) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT.parent))


def mod(dotted: str):
    """Import a submodule, e.g. mod('semantic.routing')."""
    return importlib.import_module(f"{PKG_NAME}.{dotted}")
