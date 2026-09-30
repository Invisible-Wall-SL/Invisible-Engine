"""Offline fixtures for tools/fetch-models.py (no Hugging Face, no volume, no GPU).

Run:  py test_fetch_models.py        (from services/atlas-comfy-pod)

On 2026-09-04 a torn `birefnet.py` under the Network Volume's SHARED
`models/RMBG/BiRefNet/` failed every video cutout for 14 hours: nothing fetched the
BiRefNet weights, so each worker's first use downloaded them into the one folder every
worker reads. What each group below stands for:

  * a download is checked BEFORE it takes the real name, so a torn or wrong file never
    sits where a node will load it — and a bad `.part` from a resume is thrown away;
  * a file already present is trusted only if it hashes right, not because its size
    matches (a NUL-filled file has exactly the right size);
  * `--verify` is what the serverless worker runs at every boot: offline, cheap (big
    files against the record a verified fetch left), and it says what is wrong in one
    last line the worker hands on as the reason it refuses cutout jobs;
  * `--stage` gives a container its OWN copy of the small files, because the node
    rewrites its `.py` in place on every load;
  * the pinned sets name exactly the files the pinned node downloads, and every model
    the Flipbook blueprint offers.

The HTTP layer is a double of `urllib.request.urlopen` that honours Range.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE / "tools" / "fetch-models.py"
_spec = importlib.util.spec_from_file_location("fetch_models", TOOL)
fm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fm)

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"ok   {label}")
        return
    print(f"FAIL {label}\n       got  {got!r}\n       want {want!r}")
    FAILED.append(label)


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class FakeResp:
    def __init__(self, body: bytes, status: int, length: int | None = None):
        self._body = io.BytesIO(body)
        self.status = status
        self.headers = {"Content-Length": str(len(body) if length is None else length)}

    def read(self, n: int = -1) -> bytes:
        return self._body.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeHub:
    """Serves `files` by URL, honouring `Range`, and records every request."""

    def __init__(self, files: dict[str, bytes]):
        self.files = files
        self.requests: list[tuple[str, str, str | None]] = []

    def urlopen(self, req, timeout=None):
        url, method, rng = req.full_url, req.get_method(), req.get_header("Range")
        self.requests.append((method, url, rng))
        body = self.files[url]
        if method == "HEAD":
            return FakeResp(b"", 200, length=len(body))
        if rng:
            return FakeResp(body[int(rng.split("=", 1)[1].rstrip("-")):], 206)
        return FakeResp(body, 200)

    def gets(self) -> list[tuple[str, str | None]]:
        return [(url, rng) for method, url, rng in self.requests if method == "GET"]


SMALL = b"from .BiRefNet_config import BiRefNetConfig\nprint('model code')\n"
REWRITTEN = SMALL.replace(b"from .BiRefNet_config", b"from BiRefNet_config")
BIG = bytes(range(256)) * 4
URL_SMALL = "https://hf.invalid/t/resolve/abc/birefnet.py"
URL_BIG = "https://hf.invalid/t/resolve/abc/w.safetensors"


def _test_set() -> dict:
    return {
        "title": "test set",
        "license": "test",
        "note": "test",
        "files": [
            {"dir": "RMBG/T", "name": "birefnet.py", "url": URL_SMALL, "size": len(SMALL),
             "sha256": sha(SMALL), "accept_sha256": [sha(REWRITTEN)]},
            {"dir": "RMBG/T", "name": "w.safetensors", "url": URL_BIG, "size": len(BIG),
             "sha256": sha(BIG)},
        ],
    }


def run_cli(hub: FakeHub | None, *argv: str) -> tuple[int, str]:
    """`main()` with this argv; returns (exit code, everything it printed + its exit
    message). A string SystemExit is exit 1, as the interpreter would make it."""
    out = io.StringIO()
    saved = sys.argv, sys.stdout, urllib.request.urlopen
    sys.argv, sys.stdout = ["fetch-models.py", *argv], out
    if hub is not None:
        urllib.request.urlopen = hub.urlopen
    code, msg = 0, ""
    try:
        fm.main()
    except SystemExit as e:
        if isinstance(e.code, str):
            code, msg = 1, e.code
        else:
            code = e.code or 0
    finally:
        sys.argv, sys.stdout, urllib.request.urlopen = saved
    return code, out.getvalue() + msg


def world() -> tuple[Path, FakeHub]:
    """A fresh volume dir, the test set registered, and "big" meaning > 128 bytes so the
    weights go through the verified record rather than a full hash."""
    fm.MODEL_SETS["t"] = _test_set()
    fm.FULL_HASH_MAX = 128
    root = Path(tempfile.mkdtemp(prefix="iw-fetch-models-"))
    return root, FakeHub({URL_SMALL: SMALL, URL_BIG: BIG})


def last_line(text: str) -> str:
    return text.rstrip("\n").splitlines()[-1] if text.strip() else ""


def can_symlink() -> bool:
    d = Path(tempfile.mkdtemp(prefix="iw-symlink-"))
    try:
        (d / "b").symlink_to(d / "a")
        return True
    except OSError:
        return False


def test_a_fetch_verifies_then_records_and_a_rerun_downloads_nothing() -> None:
    root, hub = world()
    code, out = run_cli(hub, "--set", "t", "--dest", str(root))
    check("a clean fetch succeeds", code, 0)
    check("the small file is the pinned bytes", (root / "RMBG/T/birefnet.py").read_bytes(), SMALL)
    check("so are the weights", (root / "RMBG/T/w.safetensors").read_bytes(), BIG)
    check("no .part is left behind", sorted(p.name for p in (root / "RMBG/T").glob("*.part")), [])
    rec = json.loads((root / fm.VERIFIED_RECORD).read_text(encoding="utf-8"))
    check("each verified file is recorded with its hash",
          rec.get("RMBG/T/w.safetensors", {}).get("sha256"), sha(BIG))
    check("a checksummed file is not HEADed for a size it already pins",
          [m for m, _, _ in hub.requests if m == "HEAD"], [])

    hub.requests.clear()
    code, out = run_cli(hub, "--set", "t", "--dest", str(root))
    check("a re-run succeeds", code, 0)
    check("and fetches nothing that already hashes right", hub.gets(), [])
    check("saying so", out.count("verified, skipped"), 2)


def test_a_bad_download_never_takes_the_real_name() -> None:
    root, hub = world()
    hub.files[URL_SMALL] = SMALL.replace(b"model", b"m\x00del")   # same size, torn
    code, out = run_cli(hub, "--set", "t", "--dest", str(root))
    check("a download that hashes wrong fails the fetch", code, 1)
    check("loudly, naming the file", "CHECKSUM MISMATCH for birefnet.py" in out, True)
    check("nothing was written under the real name", (root / "RMBG/T/birefnet.py").exists(), False)
    check("and the bad .part was deleted, not kept to resume from",
          (root / "RMBG/T/birefnet.py.part").exists(), False)


def test_a_torn_part_is_resumed_then_thrown_away_and_refetched() -> None:
    """A pod terminal drops mid-download and leaves a `.part`; the resume keeps those
    bytes. If they were bad, the whole file hashes wrong — so the `.part` goes and the
    download starts over once, instead of the torn head surviving every re-run."""
    root, hub = world()
    (root / "RMBG/T").mkdir(parents=True)
    torn = b"\x00" * (len(BIG) // 2)
    (root / "RMBG/T/w.safetensors.part").write_bytes(torn)
    code, out = run_cli(hub, "--set", "t", "--dest", str(root))
    check("the fetch recovers", code, 0)
    check("the weights end up whole and right", (root / "RMBG/T/w.safetensors").read_bytes(), BIG)
    big_gets = [rng for url, rng in hub.gets() if url == URL_BIG]
    check("it resumed first, then started over from byte 0",
          big_gets, [f"bytes={len(torn)}-", None])


def test_a_present_file_is_trusted_by_its_hash_not_its_size() -> None:
    root, hub = world()
    run_cli(hub, "--set", "t", "--dest", str(root))
    weights = root / "RMBG/T/w.safetensors"
    weights.write_bytes(b"\x00" * len(BIG))                         # right size, wrong bytes
    hub.requests.clear()
    code, out = run_cli(hub, "--set", "t", "--dest", str(root))
    check("a same-size corrupt file is re-downloaded", [u for u, _ in hub.gets()], [URL_BIG])
    check("and is right afterwards", weights.read_bytes(), BIG)
    check("saying why", "CHECKSUM MISMATCH on disk" in out, True)

    (root / "RMBG/T/birefnet.py").write_bytes(REWRITTEN)            # what the node writes
    hub.requests.clear()
    run_cli(hub, "--set", "t", "--dest", str(root))
    check("the node's own rewrite of its .py is accepted, not re-fetched", hub.gets(), [])


def test_verify_is_offline_and_names_what_is_wrong() -> None:
    """The boot check. Nothing may be downloaded by it, and its last line is the reason
    the worker quotes when it refuses a cutout job."""
    root, hub = world()
    run_cli(hub, "--set", "t", "--dest", str(root))
    hub.requests.clear()
    code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root))
    check("a fetched set verifies", code, 0)
    check("without a single request", hub.requests, [])

    small = root / "RMBG/T/birefnet.py"
    small.write_bytes(SMALL.replace(b"model", b"m\x00del"))
    code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root))
    check("a torn small file fails verification", code, 1)
    check("and the last line says which, and how to fix it",
          last_line(out).startswith("UNVERIFIED t under ")
          and "RMBG/T/birefnet.py: checksum mismatch" in last_line(out)
          and "python /fetch-models.py --set t" in last_line(out), True)
    small.write_bytes(REWRITTEN)
    check("the node-rewritten form verifies",
          run_cli(hub, "--verify", "--set", "t", "--dest", str(root))[0], 0)

    weights = root / "RMBG/T/w.safetensors"
    good = weights.read_bytes()
    weights.write_bytes(good[:-1])
    code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root))
    check("weights resized since the fetch verified them read as changed",
          "RMBG/T/w.safetensors: changed since it was verified" in out, True)
    weights.write_bytes(good)
    st = weights.stat()
    os.utime(weights, (st.st_atime, st.st_mtime + 60))
    check("a new mtime alone is not a change",
          run_cli(hub, "--verify", "--set", "t", "--dest", str(root))[0], 0)

    (root / fm.VERIFIED_RECORD).unlink()
    code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root))
    check("weights no fetch ever verified do not pass on their size alone",
          "RMBG/T/w.safetensors: never verified by fetch-models" in out, True)

    weights.unlink()
    code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root))
    check("and missing weights are named", "RMBG/T/w.safetensors: missing" in out, True)
    check("still without a request", hub.requests, [])


def test_stage_gives_the_container_its_own_copy() -> None:
    """The node rewrites its `.py` on every load. Staged, that write lands on the
    container's copy — the shared volume's is never touched."""
    root, hub = world()
    run_cli(hub, "--set", "t", "--dest", str(root))
    stage = Path(tempfile.mkdtemp(prefix="iw-stage-"))
    symlinks = can_symlink()
    if not symlinks:
        # This box cannot create symlinks (Windows without the privilege); every file is
        # "small" here so staging copies all of it. CI's Linux runner takes the full path.
        print("     (no symlink privilege here — weights are copied, not linked, in this run)")
        fm.FULL_HASH_MAX = 1 << 20
    code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root), "--stage", str(stage))
    check("a verified set stages", code, 0)
    staged_py = stage / "RMBG/T/birefnet.py"
    check("the .py is a real file, not a link to the volume",
          staged_py.is_file() and not staged_py.is_symlink(), True)
    if symlinks:
        staged_w = stage / "RMBG/T/w.safetensors"
        check("the weights are a link to the volume's verified copy",
              staged_w.is_symlink() and staged_w.resolve() == (root / "RMBG/T/w.safetensors").resolve(),
              True)
    staged_py.write_bytes(REWRITTEN)
    check("a rewrite of the staged .py leaves the volume's alone",
          (root / "RMBG/T/birefnet.py").read_bytes(), SMALL)

    check("--stage alone is refused — it only stages what --verify checked",
          run_cli(hub, "--set", "t", "--dest", str(root), "--stage", str(stage))[0], 1)


def staged(stage: Path) -> list[str]:
    d = stage / "RMBG/T"
    return sorted(q.name for q in d.iterdir()) if d.is_dir() else []


def test_a_partial_set_stages_what_verifies_and_leaves_out_the_rest() -> None:
    """Degrade, never refuse: each file that verifies is staged, each one that does not
    is left OUT, so the node downloads it into the container's own disk (private, can't
    tear the shared folder) and one bad variant costs nothing but itself. Still exit 1,
    so the boot log says so."""
    root, hub = world()
    run_cli(hub, "--set", "t", "--dest", str(root))
    if not can_symlink():
        fm.FULL_HASH_MAX = 1 << 20      # see test_stage_gives_the_container_its_own_copy
    (root / "RMBG/T/birefnet.py").write_bytes(b"\x00" * len(SMALL))
    stage = Path(tempfile.mkdtemp(prefix="iw-stage-"))
    code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root), "--stage", str(stage))
    check("a torn file still fails the check", code, 1)
    check("the torn .py is left out — its mismatching copy deleted — and the weights staged",
          staged(stage), ["w.safetensors"])
    check("the summary names the file that was left out",
          "RMBG/T/birefnet.py: checksum mismatch" in last_line(out), True)

    (root / "RMBG/T/birefnet.py").write_bytes(SMALL)
    (root / "RMBG/T/w.safetensors").unlink()
    stage = Path(tempfile.mkdtemp(prefix="iw-stage-"))
    code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root), "--stage", str(stage))
    check("missing weights fail the check", code, 1)
    check("but the .py that verified is still staged", staged(stage), ["birefnet.py"])


def test_a_staging_error_is_a_problem_for_that_file_not_a_crash() -> None:
    """A copy or link that raises (a full disk, `symlink_to` without the privilege) must
    not crash the boot or leave a half-written file for the node to load: that file is
    reported and left out, and the rest of the set is staged."""
    root, hub = world()
    run_cli(hub, "--set", "t", "--dest", str(root))
    stage = Path(tempfile.mkdtemp(prefix="iw-stage-"))
    real_symlink = Path.symlink_to

    def refuse(self, target, target_is_directory=False):
        raise OSError("simulated: symlink not permitted")

    Path.symlink_to = refuse
    try:
        code, out = run_cli(hub, "--verify", "--set", "t", "--dest", str(root),
                            "--stage", str(stage))
    finally:
        Path.symlink_to = real_symlink
    check("the boot check exits 1 rather than crashing", code, 1)
    check("naming the file it could not stage",
          "RMBG/T/w.safetensors: could not be checked or staged" in out, True)
    check("which is absent, with no temporary file left behind — the .py still staged",
          staged(stage), ["birefnet.py"])


def test_the_boot_command_on_an_empty_volume() -> None:
    """Exactly what the worker's start.sh runs, on a volume nobody has fetched to: it
    must fail without touching the network, and its last line must name the fix."""
    empty = Path(tempfile.mkdtemp(prefix="iw-empty-volume-"))
    stage = Path(tempfile.mkdtemp(prefix="iw-stage-"))
    env = {k: v for k, v in os.environ.items() if k != "HF_TOKEN"}
    proc = subprocess.run(
        [sys.executable, str(TOOL), "--verify", "--set", "rmbg", "--set", "birefnet",
         "--dest", str(empty), "--stage", str(stage)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=60)
    line = last_line(proc.stdout)
    check("an unfetched volume fails the boot check", proc.returncode, 1)
    check("naming the fix start.sh hands on to every refused job",
          line.startswith("UNVERIFIED rmbg+birefnet under ")
          and "python /fetch-models.py --set rmbg --set birefnet" in line, True)
    check("and every pinned file is reported missing",
          sum(1 for ln in proc.stdout.splitlines()
              if ln.startswith("   !! ") and ln.endswith(": missing")),
          len(fm.MODEL_SETS["rmbg"]["files"]) + len(fm.MODEL_SETS["birefnet"]["files"]))


def test_the_pinned_sets_match_the_node_and_the_blueprint() -> None:
    """The sets must name exactly what ComfyUI-RMBG @ nodes.json's sha downloads (its
    MODEL_CONFIG `files`, under `cache_dir`), pinned to a commit, with a checksum each —
    and cover every BiRefNet model the Flipbook blueprint lets an author pick, or that
    pick downloads at run time."""
    for key in ("rmbg", "birefnet"):
        for f in fm.MODEL_SETS[key]["files"]:
            check(f"{key}/{f['name']} has a sha256",
                  bool(re.fullmatch(r"[0-9a-f]{64}", f.get("sha256", ""))), True)
            check(f"{key}/{f['name']} is pinned to a commit",
                  bool(re.search(r"/resolve/[0-9a-f]{40}/", f["url"])), True)
    rmbg = {f["name"] for f in fm.MODEL_SETS["rmbg"]["files"]}
    check("rmbg is the node's RMBG-2.0 file list", rmbg,
          {"config.json", "model.safetensors", "birefnet.py", "BiRefNet_config.py"})
    check("under the node's cache_dir",
          {f["dir"] for f in fm.MODEL_SETS["rmbg"]["files"]}, {"RMBG/RMBG-2.0"})

    nodes = json.loads((HERE / "nodes.json").read_text(encoding="utf-8"))["nodes"]
    check("the sets were read off the node sha nodes.json pins",
          next(n["sha"] for n in nodes if n["name"] == "ComfyUI-RMBG"), "9edb2bec3900")

    bp = json.loads((HERE.parent / "atlas-tool" / "blueprints_src" / "wan22_i2v_flipbook"
                     / "blueprint.json").read_text(encoding="utf-8"))
    options = next(p for p in bp["params"] if p.get("key") == "birefnet_model")["options"]
    birefnet = {f["name"] for f in fm.MODEL_SETS["birefnet"]["files"]}
    check("every BiRefNet model the blueprint offers is fetched",
          sorted(o for o in options if f"{o}.safetensors" not in birefnet), [])
    check("plus the four files every variant shares, and nothing else",
          birefnet - {f"{o}.safetensors" for o in options},
          {"birefnet.py", "birefnet_lite.py", "BiRefNet_config.py", "config.json"})
    check("under the one folder they all share",
          {f["dir"] for f in fm.MODEL_SETS["birefnet"]["files"]}, {"RMBG/BiRefNet"})
    check("only the .py files the node rewrites carry a second accepted form",
          sorted(f["name"] for f in fm.MODEL_SETS["birefnet"]["files"] if "accept_sha256" in f),
          ["birefnet.py", "birefnet_lite.py"])


if __name__ == "__main__":
    REAL_FULL_HASH_MAX = fm.FULL_HASH_MAX
    for test in (
            test_a_fetch_verifies_then_records_and_a_rerun_downloads_nothing,
            test_a_bad_download_never_takes_the_real_name,
            test_a_torn_part_is_resumed_then_thrown_away_and_refetched,
            test_a_present_file_is_trusted_by_its_hash_not_its_size,
            test_verify_is_offline_and_names_what_is_wrong,
            test_stage_gives_the_container_its_own_copy,
            test_a_partial_set_stages_what_verifies_and_leaves_out_the_rest,
            test_a_staging_error_is_a_problem_for_that_file_not_a_crash,
            test_the_boot_command_on_an_empty_volume,
            test_the_pinned_sets_match_the_node_and_the_blueprint):
        try:
            test()
        finally:
            # `world()` bends these for the synthetic set; no test may inherit them.
            fm.FULL_HASH_MAX = REAL_FULL_HASH_MAX
            fm.MODEL_SETS.pop("t", None)
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all fetch-models fixtures pass")
