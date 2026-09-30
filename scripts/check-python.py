"""Run every offline Python test in the repo and fail if any of them fails.

    python scripts/check-python.py            # everything runnable here, in parallel
    python scripts/check-python.py --list     # what would run, and what is skipped and why
    python scripts/check-python.py --only atlas-tool

The services' tests are plain scripts, not pytest modules: each documents
`Run: PYTHONPATH=".;../_shared" py test_x.py (from services/<svc>)` and exits
non-zero on a failure. This runs each exactly that way, discovered rather than
listed, so a new `test_*.py` is gated the moment it lands.

MARKERS. A test that needs something an offline runner cannot promise says so in
its first 40 lines:

    # check: requires torch — the pipeline tests exercise the real tensors
    # check: requires network — talks to a live ComfyUI

`requires <module>` runs only when that module imports here; `requires network`
runs only with `--network`. Anything else is a hard error, so a typo cannot
silently skip a suite.

Secrets are scrubbed from the environment first, so a test that would reach R2
or a real ComfyUI with a developer's credentials behaves exactly as it does in
CI, where there are none.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_S = 600
MARKER = re.compile(r"^#\s*check:\s*requires\s+(\S+)\s+[—-]+\s*(.+)$")
SECRET_ENV = re.compile(
    r"(KEY|SECRET|TOKEN|PASSWORD|DSN|DATABASE_URL|ENDPOINT|^R2_|^AWS_|^COMFY|^RUNPOD|^CF_)", re.I
)


@dataclass
class Check:
    id: str
    cwd: Path
    argv: list[str]
    marker_file: Path | None = None
    requires: list[tuple[str, str]] = field(default_factory=list)


def tracked(pattern: str) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard", pattern],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    return sorted(line for line in out.splitlines() if line)


def markers(path: Path) -> list[tuple[str, str]]:
    found = []
    with path.open(encoding="utf-8") as fh:
        for _, line in zip(range(40), fh):
            m = MARKER.match(line.strip())
            if m:
                found.append((m.group(1), m.group(2).strip()))
    return found


def discover() -> list[Check]:
    checks: list[Check] = []
    # Service test scripts, run from their own directory with the shared package on the path.
    for rel in tracked("services/*/test_*.py"):
        path = ROOT / rel
        checks.append(Check(rel, path.parent, [sys.executable, path.name], path))
    # unittest suites that ship a runner (the ComfyUI custom nodes).
    for rel in tracked("services/**/tests/run_tests.py"):
        path = ROOT / rel
        checks.append(Check(rel, path.parent.parent, [sys.executable, f"tests/{path.name}"], path))
    # The backup job has no suite; importing it and building its CLI is the offline part.
    checks.append(
        Check("scripts/backup/iwbackup.py --help", ROOT / "scripts" / "backup",
              [sys.executable, "iwbackup.py", "--help"], ROOT / "scripts/backup/iwbackup.py")
    )
    for check in checks:
        check.requires = markers(check.marker_file) if check.marker_file else []
    return checks


def skip_reason(check: Check, network: bool) -> str | None:
    for need, why in check.requires:
        if need == "network":
            if not network:
                return f"needs the network ({why}) — run with --network"
        elif importlib.util.find_spec(need) is None:
            return f"needs `{need}` ({why})"
    return None


def clean_env(cwd: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not SECRET_ENV.search(k)}
    env["PYTHONPATH"] = os.pathsep.join([".", str(ROOT / "services" / "_shared")])
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def run(check: Check) -> tuple[Check, bool, float, str]:
    started = time.monotonic()
    try:
        proc = subprocess.run(
            check.argv, cwd=check.cwd, env=clean_env(check.cwd), capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_S,
        )
        ok, out = proc.returncode == 0, proc.stdout + proc.stderr
    except subprocess.TimeoutExpired as exc:
        ok, out = False, f"{exc.stdout or ''}{exc.stderr or ''}\n... timed out after {TIMEOUT_S}s"
    return check, ok, time.monotonic() - started, out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--only")
    parser.add_argument("--network", action="store_true")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    args = parser.parse_args()

    checks = discover()
    for check in checks:
        for need, _ in check.requires:
            if not re.fullmatch(r"network|[A-Za-z_][\w.]*", need):
                print(f"{check.id}: unknown `# check: requires {need}` marker", file=sys.stderr)
                return 1
    if args.only:
        checks = [c for c in checks if args.only in c.id]
    runnable = [c for c in checks if not skip_reason(c, args.network)]
    skipped = [(c, skip_reason(c, args.network)) for c in checks if skip_reason(c, args.network)]

    if args.list:
        for c in runnable:
            print(f"  {c.id}")
        print(f"\n{len(runnable)} to run. Skipped:")
        for c, why in skipped:
            print(f"  {c.id} — {why}")
        return 0
    if not runnable:
        print("No Python checks selected — refusing to pass vacuously.", file=sys.stderr)
        return 1

    started = time.monotonic()
    failed = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for check, ok, secs, out in pool.map(run, runnable):
            print(f"{'✓' if ok else '✗'} {check.id} ({secs:.1f}s)", flush=True)
            if not ok:
                failed.append((check, out))
    for check, out in failed:
        tail = "\n".join(out.rstrip().splitlines()[-40:])
        print(f"\n──── ✗ {check.id}\n({check.cwd.relative_to(ROOT)}) {' '.join(check.argv[1:])}\n{tail}")
    for c, why in skipped:
        print(f"- skipped {c.id} — {why}")
    total = time.monotonic() - started
    print(f"\n{len(runnable) - len(failed)}/{len(runnable)} Python checks passed in {total:.0f}s.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
