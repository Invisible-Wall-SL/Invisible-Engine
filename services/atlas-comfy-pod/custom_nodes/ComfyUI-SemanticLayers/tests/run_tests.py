"""Run the whole suite.

    "<ComfyUI>/python_embeded/python.exe" tests/run_tests.py

Uses ComfyUI's own interpreter so the tests exercise the exact torch/PyYAML/Pillow the
nodes will run against. `test_semantic.py` alone needs no torch and runs anywhere.
"""

from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover(HERE, pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
