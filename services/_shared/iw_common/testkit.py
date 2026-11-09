"""The assertion helpers the services' plain-script tests share.

The tests under ``services/*/test_*.py`` are scripts, not pytest modules:
``scripts/check-python.py`` runs each one and reads its exit code. Every one of
them grew its own ``check()`` and ``FAILED`` list; this is that pair once.

    from iw_common.testkit import Suite

    t = Suite()

    def test_something() -> None:
        t.check("the answer", answer(), 42)
        t.check_in("and it says why", "because", message())

    if __name__ == "__main__":
        t.run(test_something)
        t.exit()

Labels and values are printed console-safe: a cp1252 console (Windows) cannot
encode the emoji a banner carries, and the diagnostic must not destroy the
diagnosis.
"""
from __future__ import annotations

import sys
import traceback
from collections.abc import Callable
from typing import NoReturn


class Stop(AssertionError):
    """A failed check in a `Suite(stop_on_failure=True)`: the rest of the test is moot."""


class Suite:
    """One script's checks: what failed, and the exit code that says so."""

    def __init__(self, *, stop_on_failure: bool = False) -> None:
        self.stop_on_failure = stop_on_failure
        self.failed: list[str] = []
        self.passed = 0

    def _say(self, text: str) -> None:
        enc = sys.stdout.encoding or "utf-8"
        print(text.encode(enc, errors="backslashreplace").decode(enc), flush=True)

    def _record(self, label: str, ok: bool, detail: str) -> bool:
        self._say(f"{'ok  ' if ok else 'FAIL'} {label}")
        if ok:
            self.passed += 1
            return True
        self._say(detail)
        self.failed.append(label)
        if self.stop_on_failure:
            raise Stop(label)
        return False

    def check(self, label: str, got: object, want: object = True) -> bool:
        """`got == want` (default: `got` is True). Returns whether it held."""
        return self._record(label, got == want,
                            f"       got  {got!r}\n       want {want!r}")

    def check_in(self, label: str, needle: str, haystack: str) -> bool:
        """`needle` occurs in `haystack`."""
        return self._record(label, needle in haystack,
                            f"       {needle!r} not found in:\n       {haystack!r}")

    def run(self, *tests: Callable[[], object]) -> None:
        """Run each test, headed by its name. One that RAISES is a failure, not
        a crash: the remaining tests still run and the summary still prints."""
        for fn in tests:
            # A functools.partial (a test that takes a fixture) names its function.
            name = getattr(fn, "__name__", "") or getattr(getattr(fn, "func", None),
                                                          "__name__", repr(fn))
            self._say(f"\n-- {name}")
            try:
                fn()
            except Stop:
                return
            except Exception:  # noqa: BLE001 — an error is a failed test, reported in full
                self._say(traceback.format_exc())
                self.failed.append(f"{name} raised")

    def exit(self, name: str = "") -> NoReturn:
        """Print the summary and exit non-zero if anything failed."""
        what = f"{name}: " if name else ""
        if self.failed:
            self._say(f"\n{what}{len(self.failed)} FAILED: {', '.join(self.failed)}")
            raise SystemExit(1)
        self._say(f"\n{what}all {self.passed} checks passed")
        raise SystemExit(0)
