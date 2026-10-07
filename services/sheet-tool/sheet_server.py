"""
Invisible Sheet Maker — web UI (by Invisible Wall SL), cloud re-host.

Pack loose sprite PNGs into one sheet, edit region names + per-region AI fields,
then export any of: a libGDX/Spine-format `.atlas`, a TexturePacker JSON, and the
Invisible AI manifest (atlas_manifest_<name>.json) that the Invisible Atlas
Maker consumes. The authored manifest is also handed off to the cloud Atlas
Maker (over R2) so it shows up in that tool's manifest list.

Cloud port of the local tool: all pathlib/PIL code runs against an R2-backed
*staging* directory (see cloud_paths.py + storage.py); writes mirror back to R2
so state survives container restarts. Pure Pillow/CPU — no ComfyUI.

Run:  python sheet_server.py   ->  binds 0.0.0.0:$PORT (default 8766)
Zero external deps beyond Pillow + boto3 (stdlib http.server).
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import shutil
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cloud_paths as project_paths  # noqa: E402
import packer              # noqa: E402
import atlas_writers       # noqa: E402
import plist_import        # noqa: E402  (verbatim cocos2d .plist atlas import)
import storage             # noqa: E402  (R2 object storage + staging mirror)
from iw_common.splash import splash_html  # noqa: E402  (shared CRT boot splash)
from iw_common import imgcache  # noqa: E402  (ETag/304 cache headers for images)
from iw_common import errors  # noqa: E402  (Sentry reporting; no-op without SENTRY_DSN)
from iw_common import launch  # noqa: E402  (launcher-signed identity + scope)
from iw_common import docsave  # noqa: E402  (saved_by stamp + compare-and-swap check)
from iw_common import presence  # noqa: E402  (the person-level "X is editing" soft lease)

SELF = Path(__file__).resolve().parent

# CRT boot splash (shared with the Atlas Maker — see iw_common/splash.py).
# Served instantly for the first `/` visit; the splash JS background-fetches
# the real UI at `?fast=1`, which is the request that hydrates staging.
SHEET_PHRASES = [
    "Heating cathode-ray tube",
    "Calibrating scanlines",
    "Reading sheet manifest",
    "Trimming transparent pixels",
    "Negotiating with the bin packer",
    "Sorting sprites by height",
    "Rotating stubborn rectangles",
    "Computing atlas occupancy",
    "Padding bleed margins",
    "Deduplicating identical frames",
    "Compressing phosphor green",
    "Indexing sheet_src uploads",
    "Mirroring staging to R2",
    "Aligning pixel grid",
    "Counting wasted pixels",
    "Packing the last awkward sprite",
    "Writing libGDX geometry",
    "Exporting TexturePacker json",
    "Reticulating splines",
    "Polishing the trim heuristics",
]
SPLASH = splash_html("SHEET MAKER", phrases=SHEET_PHRASES)


# Per-request path resolution. There is NO module-level copy of the active
# (client, project): each handler/helper resolves the paths it needs from
# project_paths.resolve() at call time, on the request's own thread. This is
# what makes the service safe under concurrent different-project requests — a
# global set by one request's thread can never be read by another's.
def _ctx() -> dict:
    """Resolve this request thread's paths from the thread-local context."""
    pp = project_paths.resolve()
    return {
        "pp": pp,
        "staging_root": pp["staging_root"],
        "r2_prefix": pp.get("r2_project_prefix"),
        # Shared project manifest folder (staging mirror of <C>/<P>/manifests).
        "manifest_dir": pp.get("manifest_dir"),
        "config_path": pp["staging_root"] / "sheet_config.json",
    }


PORT = int(os.environ.get("PORT", "8766"))
HOST = os.environ.get("SHEET_BIND_HOST", "0.0.0.0")
BUILD = "v2.2-cloud"

# Who is calling and for which (client, project): a launcher-signed token (see
# iw_common/launch.py). SHEET_TOOL_SECRET is the pre-token shared-secret gate,
# kept for the transition window only; both unset = open (local dev).
GATE = launch.LaunchGate(aud="sheet", signing_env="SHEET_TOOL_SIGNING_SECRET",
                         legacy_env="SHEET_TOOL_SECRET", legacy_cookie="sheet_tool",
                         legacy_header="X-Sheet-Secret")


# ---------------------------------------------------------------------------
# R2 write-through helpers
# ---------------------------------------------------------------------------

# Local-disk size/format helpers live in iw_common.storage (shared with the
# Atlas Maker); re-exposed under the original private names so the call sites
# below stay unchanged.
_dir_size = storage.dir_size
_human_bytes = storage.human_bytes


def _mirror(p: Path) -> None:
    """Write-through: mirror a staging file to its R2 key so it persists."""
    ctx = _ctx()
    r2_prefix, staging_root = ctx["r2_prefix"], ctx["staging_root"]
    if not (r2_prefix and staging_root):
        return
    try:
        rel = Path(p).resolve().relative_to(Path(staging_root).resolve()).as_posix()
        # Listing state is claimed BEFORE the push and released only once the
        # push is CONFIRMED, so the claim means "not known to be in R2" rather
        # than "this tool wrote it once" — an add-only claim would exempt every
        # sheet we have saved and defeat the prune in its own case. One confirmed
        # file is enough to release a SHEET: the prune asks whether the sheet's
        # R2 prefix has any object at all, and now it does.
        # A claimable key is `sheets/<sheet>/<file>` or a ONE-segment
        # `manifests/<name>` — the two shapes the prune actually iterates. A
        # file loose at either root is neither, and must not park a bogus name.
        parts = rel.split("/")
        kind = name = ""
        if parts[0] == "sheets" and len(parts) >= 3:
            kind, name = "sheets", parts[1]
        elif parts[0] == "manifests" and len(parts) == 2:
            kind, name = "manifests", parts[1]
        if name:
            ck = project_paths.r2_slug(project_paths.client_name())
            pk = project_paths.r2_slug(project_paths.project_name())
            # The claim covers the write->push window and is always released;
            # whether the bytes LANDED is recorded separately, because that
            # outcome has to persist until a push succeeds and must not leak a
            # unit of a balanced count when it does not.
            #
            # ORDER MATTERS: the flag goes on BEFORE the count comes off, or
            # there is an instant where the key is neither counted nor flagged
            # and a concurrent prune deletes it. `landed` is pre-bound so a push
            # that somehow raises still records "did not land" rather than
            # skipping the flag entirely and leaving the key unprotected.
            landed = False
            project_paths.note_authored(ck, pk, kind, name)
            try:
                landed = storage.push_file(Path(p), f"{r2_prefix}/{rel}")
            finally:
                project_paths.mark_pushed(ck, pk, kind, name, landed)
                project_paths.clear_authored(ck, pk, kind, name)
            return
        storage.push_file(Path(p), f"{r2_prefix}/{rel}")
    except Exception:  # noqa: BLE001 — best-effort mirror
        pass


# ---------------------------------------------------------------------------
# config + helpers
# ---------------------------------------------------------------------------

def load_config() -> dict:
    config_path = _ctx()["config_path"]
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(cfg: dict) -> None:
    config_path = _ctx()["config_path"]
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    _mirror(config_path)


def _session_path() -> Path:
    """The persisted editor session for the ACTIVE (client, project). Lives
    next to sheet_config.json at the staging root, so it mirrors to the R2 key
    `<C>/<P>/sheet_session.json` and survives container restarts (hydrate()
    pulls it back eagerly)."""
    return Path(_ctx()["staging_root"]) / "sheet_session.json"


def load_session() -> dict | None:
    """The saved working session, or None when absent/corrupt/malformed — a bad
    file is silently ignored so the editor just starts clean (never 500s)."""
    try:
        sess = json.loads(_session_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(sess, dict) or not isinstance(sess.get("regions"), list):
        return None
    return sess


# Exactly the per-region fields the canvas needs to reconstruct itself; anything
# else a (future/concurrent) client sends is dropped on save.
_SESSION_REGION_KEYS = ("src", "name", "x", "y", "w", "h", "iw", "ih", "ow", "oh",
                        "rotated", "locked", "prompt", "shape_ref", "seed",
                        "unplaced", "fx_of", "fx_mode")


def api_session(payload: dict) -> dict:
    """Persist (or clear, with {"clear": true}) the editor's working session so
    a browser refresh / container restart restores the canvas exactly. The UI
    debounces its POSTs; concurrent tabs are last-write-wins by design. The
    payload is re-shaped server-side (known keys only, ints coerced) so a
    malformed body can't poison the stored file."""
    sp = _session_path()
    if payload.get("clear"):
        sp.unlink(missing_ok=True)
        r2_prefix = _ctx()["r2_prefix"]
        if r2_prefix:
            storage.delete(f"{r2_prefix}/{sp.name}")   # drop the mirror too
        return {"ok": True, "cleared": True}

    def _i(key: str, default: int) -> int:
        try:
            return int(payload.get(key, default))
        except (TypeError, ValueError):
            return default

    regions = []
    for r in payload.get("regions") or []:
        if not isinstance(r, dict) or not r.get("src"):
            continue
        regions.append({k: r.get(k) for k in _SESSION_REGION_KEYS})
    loaded = payload.get("loaded")
    sess = {
        "version": 1,
        "sheet": safe_name(str(payload.get("sheet") or "sheet")),
        "display_name": str(payload.get("display_name") or "")[:200],
        "active_sheet": safe_name(str(payload.get("active_sheet") or ""), ""),
        "canvas_w": _i("canvas_w", 1024),
        "canvas_h": _i("canvas_h", 1024),
        "padding": _i("padding", 2),
        "allow_rotation": bool(payload.get("allow_rotation")),
        "loaded": loaded if isinstance(loaded, dict) else {},
        "regions": regions,
    }
    sp.parent.mkdir(parents=True, exist_ok=True)
    sp.write_text(json.dumps(sess, indent=2, ensure_ascii=False), encoding="utf-8")
    _mirror(sp)
    return {"ok": True, "regions": len(regions)}


_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")

# The only page/sprite formats the pipeline accepts. Both carry an ALPHA channel, which cut-out
# sprite art requires: a format without one (JPEG) would box every frame in an opaque rectangle,
# and its lossy edges would bleed colour across the exact rects an atlas slices on.
_PAGE_EXTS = (".png", ".webp")


def safe_name(s: str, default: str = "sheet") -> str:
    s = _SAFE.sub("_", (s or "").strip()).strip("_.")
    return s or default


_DIGITS = re.compile(r"(\d+)")


def natural_key(name: str) -> list:
    """Sort key that compares NUMERIC runs numerically, so `f2` precedes `f10`.

    Plain lexicographic order gets an image sequence wrong the moment it passes
    9 frames and isn't zero-padded: `explosion_1, explosion_10, explosion_2`.
    Frame ORDER is the whole contract a flipbook clip is built on (a sheet is
    otherwise an unordered bag of cells), and the order sprites land in here
    flows straight through — `api_upload`'s list drives the client's `regions`
    array, which drives the manifest's region order, which is what the clip
    editor reads. So a mis-sorted upload silently authors a scrambled animation.

    Case-insensitive on the text runs so `Frame_2` and `frame_10` interleave the
    way an author expects. See docs/design/invisible-flipbook.md.

    Each part is a UNIFORMLY-TYPED tuple rather than a bare int-or-str: mixing the
    two raises `TypeError: '<' not supported between 'str' and 'int'` the moment a
    name starting with a digit is sorted against one starting with a letter
    (`01_intro.png` vs `boom.png` — a completely ordinary pair to drop into one
    sheet, which would 500 the upload).
    """
    return [
        (0, int(part), "") if part.isdigit() else (1, 0, part.lower())
        for part in _DIGITS.split(name or "")
        if part != ""
    ]


def uploads_dir(sheet: str) -> Path:
    # The uploaded sprite pile hydrates lazily (cloud_paths excludes sheet_src/
    # from the eager pull). Pull it on first access for this (client, project)
    # so a sheet's existing sprites are present for serve/export — never an
    # empty local dir. ensure_lazy is idempotent + incremental: cheap no-op
    # after the first call.
    project_paths.ensure_lazy("sheet_src/")
    pp = project_paths.resolve()
    d = pp["input_dir"] / safe_name(sheet)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _sheet_key(out: Path) -> str:
    """The name `prune_listing_ghosts` would iterate for this destination.

    The TOP-LEVEL segment under `sheets/`, not the basename: an export can be
    redirected into a nested `dest_dir`, and claiming the basename there claims
    a name the prune never consults. "" for the sheets root itself or a path
    outside it, so neither takes a bogus immortal claim."""
    try:
        rel = Path(out).resolve().relative_to(
            Path(project_paths.resolve()["output_root"]).resolve()).as_posix()
    except (ValueError, OSError):
        return ""
    name = rel.split("/")[0]
    return "" if name in ("", ".") else name


def _plist_sheet_name(fields: dict, files: list) -> str:
    """The sheet an import will actually write to.

    Shared with `_import_plist` rather than re-derived: the two fallbacks used
    to differ (`"sheet"` here, the plist's stem there) and the field is normally
    BLANK — its placeholder is "(from the .plist name)" — so the wrapper held a
    claim on a directory the import never touched, leaving the real one exposed
    for the whole write."""
    named = safe_name(str(fields.get("sheet", "")).strip(), "")
    if named:
        return named
    src = next((f for f in files
                if Path(f["filename"]).suffix.lower() == ".plist"), None)
    return safe_name(Path(src["filename"]).stem) if src else ""


def _forget_sheet(name: str) -> None:
    """Drop every trace of a sheet whose files are gone for good (rename step 5,
    delete). Without it a failed push recorded under that name outlives the
    sheet and the stuck-work line prints for ever."""
    if not name:
        return
    ck = project_paths.r2_slug(project_paths.client_name())
    pk = project_paths.r2_slug(project_paths.project_name())
    project_paths.forget(ck, pk, "sheets", name)
    project_paths.forget(ck, pk, "manifests", f"atlas_manifest_{name}.json")
    project_paths.forget(ck, pk, "manifests", f"{name}.json")


def _claim_scope(kind: str, name: str):
    """Hold a claim on `<kind>/<name>` for a whole handler, or nothing at all.

    Between a local write and its confirmed push, staging holds files while R2
    holds nothing — the signature `prune_listing_ghosts` reads as a ghost — and
    that prune runs on EVERY state load, so the window is live traffic. The
    claim must span the WHOLE operation: an export writes the page, the
    `.atlas`, the TexturePacker json and the manifest into one directory, so
    releasing on the first confirmed push (which is all `_mirror` can know
    about) would drop protection with three writes still to come."""
    if not name:
        return contextlib.nullcontext()
    return project_paths.authored_scope(
        project_paths.r2_slug(project_paths.client_name()),
        project_paths.r2_slug(project_paths.project_name()), kind, name)


def output_dir(sheet: str) -> Path:
    pp = project_paths.resolve()
    d = pp["output_root"] / safe_name(sheet)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _resolve_dest(sheet: str, dest_dir: str) -> Path:
    """Where an export's files go, WITHOUT creating anything.

    Empty `dest_dir` -> the sheet's default output dir. Otherwise resolve the
    requested dir and CONFINE it to the `sheets/` subtree of the staging root —
    anything else (e.g. a `loadedDir` that points at `manifests/` after opening
    a sheet via its manifest) falls back to the default, so the page/.atlas/json
    always land at the canonical keys the manifest back-references."""
    pp = project_paths.resolve()
    default = pp["output_root"] / safe_name(sheet)
    if not dest_dir:
        return default
    try:
        sheets_root = Path(pp["output_root"]).resolve()
        d = Path(dest_dir).resolve()
    except (OSError, ValueError):
        return default
    if sheets_root not in d.parents and d != sheets_root:
        return default
    return d


# ---------------------------------------------------------------------------
# minimal multipart/form-data parser (py3.13 has no cgi module)
# ---------------------------------------------------------------------------

def parse_multipart(body: bytes, content_type: str) -> tuple[dict, list]:
    """Return (fields, files). fields: {name: str}. files: [{field,filename,data}]."""
    m = re.search(r"boundary=([^;]+)", content_type)
    if not m:
        return {}, []
    boundary = m.group(1).strip().strip('"')
    delim = b"--" + boundary.encode("latin-1")
    fields: dict[str, str] = {}
    files: list[dict] = []
    for part in body.split(delim):
        if not part or part in (b"--\r\n", b"--", b"\r\n"):
            continue
        if part.startswith(b"\r\n"):  # the CRLF the spec puts before each part body
            part = part[2:]
        if not part or part.startswith(b"--"):  # closing boundary marker
            continue
        head, _, data = part.partition(b"\r\n\r\n")
        if not _:
            continue
        if data.endswith(b"\r\n"):  # trailing CRLF before the next delimiter only
            data = data[:-2]
        headers = head.decode("latin-1", "replace")
        disp = ""
        for line in headers.split("\r\n"):
            if line.lower().startswith("content-disposition"):
                disp = line
                break
        name_m = re.search(r'name="([^"]*)"', disp)
        file_m = re.search(r'filename="([^"]*)"', disp)
        if not name_m:
            continue
        field = name_m.group(1)
        if file_m and file_m.group(1):
            files.append({"field": field, "filename": file_m.group(1), "data": data})
        else:
            fields[field] = data.decode("utf-8", "replace")
    return fields, files


# ---------------------------------------------------------------------------
# API handlers
# ---------------------------------------------------------------------------

def _refresh_listing_subtrees(pp: dict) -> None:
    """Force a fresh, incremental R2 pull of just the cheap listing subtrees
    (packed `sheets/` + shared `manifests/`) into staging so the sheets rail
    reflects shared cloud state on EVERY load — not only once per container.

    hydrate() dedups per (client, project) per process (force=False), so a
    long-lived Railway container that hydrated this project while its `sheets/`
    prefix was still empty never re-pulls sheets saved later from another
    machine; the rail then shows "(no saved sheets)" until ↻ Refresh. We re-pull
    here using the SAME size+mtime-aware storage.pull_prefix hydrate() uses, with
    the prefixes/paths resolve() already computed. The heavy `sheet_src/` pile is
    deliberately NOT pulled (it stays lazy via ensure_lazy). Best-effort: any R2
    error leaves the local staging mirror as-is so the listing still falls back
    to whatever is on disk.

    Pulling is only half a mirror. `pull_prefix` never deletes, so a sheet (or a
    shared manifest) removed at the SOURCE stayed on this container's rail
    forever no matter how often we re-pulled — the reason a deleted sheet could
    still be opened here. `prune_listing_ghosts` reconciles the other direction;
    it is safe to run on every load because it is guarded on successful listings
    and skips anything not yet confirmed into R2."""
    base = pp.get("r2_project_prefix")
    staging_root = pp.get("staging_root")
    if not base or staging_root is None:
        return
    kr = base + "/"
    for sub in ("sheets/", "manifests/"):
        try:
            storage.pull_prefix(base + "/" + sub, staging_root, kr)
        except Exception:  # noqa: BLE001 — first run / empty bucket / transient R2 error
            pass
    # Keys from the SAME resolve() that produced `base`/`staging_root` above, so
    # the prune can never reconcile one project's staging against another's
    # listing.
    ck, pk = pp.get("client_key") or "", pp.get("project_key") or ""
    if not (ck and pk):
        return
    sheets, mans = project_paths.prune_listing_ghosts(ck, pk, staging_root)
    if sheets or mans:
        print(f"[sheet] pruned {sheets} sheet(s) + {mans} manifest(s) deleted at "
              f"the source ({ck}/{pk})", flush=True)
    # Only genuinely STUCK work: an in-flight claim comes and goes with every
    # ordinary export, and a line that fires constantly stops meaning anything.
    stuck = project_paths.unpushed_count(ck, pk)
    if stuck:
        print(f"[sheet] {stuck} item(s) failed to mirror to R2 — kept local, so "
              f"not prunable until a save succeeds ({ck}/{pk})", flush=True)


def api_state() -> dict:
    pp = project_paths.resolve()
    # Re-pull the listing subtrees from R2 so the rail reflects shared cloud
    # state on every load (resolve()'s hydrate() only pulls once per process).
    _refresh_listing_subtrees(pp)
    cfg = load_config()
    sheets = []
    out_root = pp["output_root"]
    if out_root.exists():
        sheets = sorted(p.name for p in out_root.iterdir() if p.is_dir())
    # Saved working session (refresh-survival). Annotate which region sprite
    # files are actually present so the UI can drop dead regions with a clear
    # message instead of rendering broken thumbnails. uploads_dir() lazily
    # hydrates sheet_src/ from R2 first, so a fresh container still finds them.
    session = load_session()
    if session and session.get("regions"):
        d = uploads_dir(str(session.get("sheet") or "sheet"))
        missing = []
        for r in session["regions"]:
            src = r.get("src") if isinstance(r, dict) else None
            if not src:
                continue
            fn = safe_name(str(src), "")
            if not fn or not (d / fn).exists():
                missing.append(str(src))
        session["missing"] = sorted(set(missing))
    return {
        "build": BUILD,
        "launcher_url": os.environ.get("LAUNCHER_URL", "https://app.invisiblewall.org"),
        "project": pp["project"],
        "projects": project_paths.list_projects(),
        "project_root": "",
        # Signed launches fix the project per session: switching goes through the launcher.
        "project_locked": (GATE.mode() == "signed"
                           or bool((os.environ.get("IW_PROJECT_NAME") or "").strip())),
        # In the cloud the Atlas Maker shares this project's R2 tree; manifests
        # land in the shared manifests/ folder both tools read.
        "atlas_maker_found": bool(_ctx()["r2_prefix"]),
        "sheets": sheets,
        # Sheets imported VERBATIM (a `.plist` atlas): the rail marks them and
        # every geometry write refuses until they're unlocked.
        "locked_sheets": [s for s in sheets if _is_locked(s)],
        "session": session,
        "defaults": {
            "canvas_w": cfg.get("width", 1024),
            "canvas_h": cfg.get("height", 1024),
            "padding": cfg.get("padding", 2),
            "allow_rotation": cfg.get("allow_rotation", False),
        },
    }


# Canonical FX-naming convention — mirrors atlas-tool/shine.py FX_SUFFIX_MODE.
# A region named `<base>_<mode>` is an FX layer derived from `<base>` by the
# Invisible Atlas Maker. The Sheet Maker spawns same-size placeholder cells with
# these names (packing a copy of the base art) so the FX travels the pipeline.
FX_MODES = ("shine", "glow", "shadow", "blur", "zoom", "colour")


def api_fx_sync(payload: dict) -> dict:
    """Materialise the FX placeholder sprite files for a base sprite.

    Given a base sprite (`base_src`) and the FULL desired set of FX `modes`,
    ensure a per-mode copy of the base image exists on disk (named
    `<stem>_<mode><ext>`) for every requested mode, and delete the copies for
    every known mode NOT requested. The copies are ordinary loose sprites (so
    packing / compose / export treat them as normal regions) that just happen to
    be named for the Atlas Maker's FX convention. Returns each live child's
    file name + measured size so the client can register/refresh its region."""
    sheet = safe_name(payload.get("sheet", "sheet"))
    # FX cells are new sprites that must be PACKED into the page to exist, so
    # spawning them on a verbatim import can only end in a re-pack.
    blocked = _locked_error(sheet, "Adding FX layers")
    if blocked:
        return {"error": blocked}
    base_src = safe_name(Path(str(payload.get("base_src") or "")).name, "")
    if not base_src:
        return {"error": "No base sprite given."}
    want = {m for m in (payload.get("modes") or []) if m in FX_MODES}

    d = uploads_dir(sheet)
    base = d / base_src
    stem, ext = Path(base_src).stem, Path(base_src).suffix or ".png"
    # A delete-only sync (want == {}) never touches the base, so a missing base
    # must still be able to clean up its orphaned copies (e.g. base deleted while
    # local staging was cleared). Only creating copies needs the base pixels.
    if want and not base.exists():
        return {"error": f"Base sprite not found: {base_src}"}

    ctx = _ctx()
    r2_prefix = ctx["r2_prefix"]
    input_prefix = f"{r2_prefix}/sheet_src/{sheet}" if r2_prefix else ""

    children, removed = [], []
    data = base.read_bytes() if base.exists() else b""
    for mode in FX_MODES:
        child_name = f"{stem}_{mode}{ext}"
        child = d / child_name
        if mode in want:
            # (Re)copy the base pixels so the placeholder tracks the source.
            child.write_bytes(data)
            try:
                w, h = packer.measure(child)
            except Exception as e:  # noqa: BLE001 — unreadable copy, skip it
                child.unlink(missing_ok=True)
                return {"error": f"{child_name}: copy failed ({e})"}
            _mirror(child)
            children.append({"mode": mode, "file": child_name, "w": w, "h": h})
        elif child.exists():
            child.unlink(missing_ok=True)
            if input_prefix:
                storage.delete(f"{input_prefix}/{child_name}")
            removed.append(child_name)
    return {"base_src": base_src, "children": children, "removed": removed}


def api_upload(fields: dict, files: list) -> dict:
    sheet = safe_name(fields.get("sheet", "sheet"))
    d = uploads_dir(sheet)

    # REFUSE an unsupported format; never rename it into one. This used to append ".png" to
    # anything else, so `photo.jpg` was stored as `photo.jpg.png` — a JPEG carrying a PNG
    # extension. Pillow sniffs content, so the tool looked fine, but PIXI picks its loader by
    # EXTENSION, so the mislabelled page shipped and failed in the game. (JPEG is also the wrong
    # format for sprite art: no alpha, and lossy ringing bleeds colour across packed rects.)
    #
    # The whole batch is validated BEFORE anything is written, so one bad file cannot leave half
    # an upload on disk and in R2 — same discipline as the .plist import.
    names: list[str] = []
    for f in files:
        fn = safe_name(Path(f["filename"]).name, "sprite.png")
        if not fn.lower().endswith(_PAGE_EXTS):
            return {
                "error": f"{Path(f['filename']).name}: unsupported image format. "
                f"Sprites must be {' or '.join(e.lstrip('.').upper() for e in _PAGE_EXTS)} — "
                f"formats without an alpha channel (JPEG) cannot hold cut-out sprite art."
            }
        names.append(fn)

    saved = []
    for f, fn in zip(files, names):
        dst = d / fn
        dst.write_bytes(f["data"])
        try:
            w, h = packer.measure(dst)
        except Exception as e:  # noqa: BLE001 — bad image upload, report it
            dst.unlink(missing_ok=True)
            return {"error": f"{fn}: not a readable image ({e})"}
        _mirror(dst)
        saved.append({"file": fn, "w": w, "h": h})
    # Order the just-saved batch NATURALLY rather than leaving it in whatever order the
    # browser's file input handed us. The client pushes `saved` straight into its `regions`
    # array, so this IS the authored order of an imported image sequence — and an unsorted
    # (or lexicographic) batch lands `frame_10` before `frame_2`.
    saved.sort(key=lambda s: natural_key(s["file"]))
    # Full current sprite list for the sheet (so re-uploads accumulate).
    sprites = []
    for p in sorted(d.glob("*"), key=lambda p: natural_key(p.name)):
        if p.suffix.lower() in (".png", ".webp"):
            w, h = packer.measure(p)
            sprites.append({"file": p.name, "w": w, "h": h})
    return {"sheet": sheet, "saved": saved, "sprites": sprites}


# ---------------------------------------------------------------------------
# Sheet lock — a VERBATIM import must not have its geometry rewritten
# ---------------------------------------------------------------------------
#
# A sheet imported from a `.plist` describes an atlas that ALREADY SHIPPED: the
# page bytes and every rect were reused unchanged precisely so a game bound to
# those coordinates keeps rendering. Re-packing it (arrange / save) silently
# invalidates that contract — the sheet still looks right in this tool while the
# game's frames land somewhere else. So the manifest carries `"locked": true`
# and every geometry-writing path refuses until the author explicitly unlocks.

def _manifest_path_for(sheet: str) -> Path:
    """Path of a sheet's AI manifest in the shared manifests/ folder."""
    ctx = _ctx()
    key = safe_name(sheet, "")
    out = project_paths.resolve()["output_root"] / key
    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out
    return man_dir / f"atlas_manifest_{key}.json"


def _read_manifest(sheet: str) -> dict | None:
    """A sheet's manifest, or None when absent/corrupt (never raises)."""
    if not safe_name(sheet, ""):
        return None
    try:
        data = json.loads(_manifest_path_for(sheet).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _is_locked(sheet: str) -> bool:
    return bool((_read_manifest(sheet) or {}).get("locked"))


def _locked_error(sheet: str, action: str) -> str:
    """The refusal message for a locked sheet, or "" when it may be written."""
    man = _read_manifest(sheet)
    if not man or not man.get("locked"):
        return ""
    imp = man.get("import") or {}
    src = imp.get("source") or "an existing packed atlas"
    return (f"Sheet '{safe_name(sheet)}' is read-only — it was imported VERBATIM from "
            f"{src}, so its page and every rect are byte-identical to the original. "
            f"{action} would re-pack it and rewrite coordinates a shipped game may "
            "already depend on. Unlock it first (Unlock button / POST "
            "/api/unlock-sheet) if you really mean to re-author it, or Save As a "
            "new copy to leave the import untouched.")


# ---------------------------------------------------------------------------
# Manifest versions — compare-and-swap saves
# ---------------------------------------------------------------------------
#
# A sheet's version IS its manifest's R2 ETag: `manifests/atlas_manifest_<S>.json`
# is the one object every save rewrites, and the Atlas Maker writes the same key.
# A load hands the page that ETag; a save states which version it replaces
# (`base_etag`, "" = "I believe the name is free") and lands only on that version
# — `If-Match` on it, or `If-None-Match: *` for a create. The Sheet Maker's export
# REBUILDS the manifest from the canvas, so it is always strict (no rev merge):
# see iw_common/docsave.py for why a wholesale writer must not merge.

_REQUEST = threading.local()


def set_request_identity(identity) -> None:
    """Who the CURRENT request thread is saving as (a `launch.Identity`, or None).
    Thread-local for the same reason the project context is: one thread per request."""
    _REQUEST.identity = identity


def _identity():
    return getattr(_REQUEST, "identity", None)


# One lock per (client, project, sheet): serialises the read-check-compose-write of
# exports / renames / imports / unlocks of ONE sheet inside this container, so two
# tabs racing the same sheet can never both pass the pre-check and both compose.
# Across containers only the R2 precondition protects — see `_write_manifest_cas`.
_SHEET_LOCKS: dict[tuple[str, str, str], threading.Lock] = {}
_SHEET_LOCKS_GUARD = threading.Lock()


@contextlib.contextmanager
def _sheet_guard(*sheets: str):
    """Hold the per-sheet lock of every named sheet, taken in sorted order so a
    rename A->B and a rename B->A cannot deadlock."""
    ck = project_paths.r2_slug(project_paths.client_name())
    pk = project_paths.r2_slug(project_paths.project_name())
    with _SHEET_LOCKS_GUARD:
        locks = [_SHEET_LOCKS.setdefault((ck, pk, s), threading.Lock())
                 for s in sorted({s for s in sheets if s})]
    with contextlib.ExitStack() as stack:
        for lk in locks:
            stack.enter_context(lk)
        yield


def _doc_id(sheet: str) -> str:
    return f"manifests/atlas_manifest_{safe_name(sheet, '')}.json"


def _cas_on() -> bool:
    """Whether manifest writes are versioned. Off for a local run with no R2 (no
    bucket configured): there is no shared store to race on, and every read would
    otherwise fail as "R2 unreadable" and refuse the save."""
    return bool(_ctx()["r2_prefix"]) and bool(os.environ.get("R2_BUCKET"))


def _manifest_key(sheet: str) -> str:
    return f"{_ctx()['r2_prefix']}/{_doc_id(sheet)}"


def _manifest_bytes(doc: dict) -> bytes:
    # Byte-identical to atlas_writers.write_manifest, so a staged copy and its R2
    # object compare equal and the load-time re-sync is a no-op when nothing moved.
    return json.dumps(doc, indent=2, ensure_ascii=False).encode("utf-8")


def _read_manifest_r2(sheet: str) -> tuple[dict | None, str | None, bytes | None]:
    """`(doc, etag, raw)` of a sheet's manifest as R2 holds it NOW — etag verbatim
    (the value `If-Match` must send back), None when the object is absent.

    With versioning off it reads staging and returns etag None. Raises
    `storage.ObjectUnreadable` when R2 could not be asked: never read that as
    absence, or a create-only claim would go through over a live sheet."""
    if not _cas_on():
        try:
            raw = _manifest_path_for(sheet).read_bytes()
        except OSError:
            return None, None, None
        return docsave.parse_doc(raw), None, raw
    got = storage.get_with_etag(_manifest_key(sheet))
    if got is None:
        return None, None, None
    raw, etag = got
    return docsave.parse_doc(raw), etag, raw


def _stage_bytes(p: Path, body: bytes) -> None:
    """Write a staging file atomically: a concurrent reader (a load, the lock
    check) sees the old bytes or the new ones, never a torn manifest."""
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_bytes(body)
        os.replace(tmp, p)
    finally:
        tmp.unlink(missing_ok=True)


def _put_manifest(sheet: str, doc: dict, *, if_match: str | None = None,
                  if_none_match: str | None = None) -> str | None:
    """Write a sheet's manifest to R2 WITH its precondition, then to staging.

    Not `_mirror`: that pushes unconditionally and swallows every failure, which
    is exactly the blind overwrite this replaces. R2 goes FIRST so a refused
    write leaves staging untouched — staging only ever mirrors a version R2
    accepted. Raises `storage.Conflict` when R2 refuses (412) and anything else
    the put raises; returns the new ETag (verbatim), None with versioning off.

    Claim bookkeeping follows `_mirror`'s ordering rules: claimed before the push,
    the landed flag recorded BEFORE the count comes off. A put that did not land
    records nothing — unlike `_mirror`, nothing was written locally, so there is
    no local-only state to protect and a failure flag would only park a bogus
    stuck-work line."""
    mp = _manifest_path_for(sheet)
    body = _manifest_bytes(doc)
    if not _cas_on():
        _stage_bytes(mp, body)
        _mirror(mp)
        return None
    ck = project_paths.r2_slug(project_paths.client_name())
    pk = project_paths.r2_slug(project_paths.project_name())
    landed = False
    project_paths.note_authored(ck, pk, "manifests", mp.name)
    try:
        etag = storage.put(_manifest_key(sheet), body, "application/json",
                           if_match=if_match, if_none_match=if_none_match)
        landed = True
        try:
            _stage_bytes(mp, body)
        except OSError:
            pass    # R2 took it; the next load re-syncs staging from there
        return etag
    finally:
        if landed:
            project_paths.mark_pushed(ck, pk, "manifests", mp.name, True)
        project_paths.clear_authored(ck, pk, "manifests", mp.name)


def _sync_manifest(sheet: str) -> tuple[dict, bytes | None]:
    """Bring the staged manifest up to R2's version for a LOAD, and say which
    version that is: `({etag, saved_by, version_unknown}, raw)`.

    The coords a load returns and the ETag it returns must describe the SAME
    bytes, or the page's next save would claim a version it never saw — so the
    caller parses `raw` rather than re-reading the file. R2 unreadable falls back
    to staging with etag "" + `version_unknown`: a save then asks for a CREATE,
    which fails loud on an existing sheet instead of overwriting it blind. An
    object absent in R2 leaves staging alone (it may be unpushed local work) and
    returns etag "" too — the next save is a create."""
    if not _cas_on():
        doc = _read_manifest(sheet)
        return {"etag": "", "saved_by": docsave.saved_by_of(doc),
                "version_unknown": False}, None
    try:
        doc, etag, raw = _read_manifest_r2(sheet)
    except storage.ObjectUnreadable:
        return {"etag": "", "saved_by": docsave.saved_by_of(_read_manifest(sheet)),
                "version_unknown": True}, None
    if raw is None:
        return {"etag": "", "saved_by": None, "version_unknown": False}, None
    mp = _manifest_path_for(sheet)
    try:
        staged = mp.read_bytes()
    except OSError:
        staged = None
    if staged != raw:
        _stage_bytes(mp, raw)
    return {"etag": docsave.norm_etag(etag), "saved_by": docsave.saved_by_of(doc),
            "version_unknown": False}, raw


def _conflict(sheet: str, c: docsave.DocConflict) -> dict:
    return {**c.payload(), "sheet": safe_name(sheet, "")}


def _check_base(sheet: str, base_etag) -> tuple[str | None, dict | None]:
    """The pre-write check: does the version this save was based on still stand?

    Returns `(etag to write on, refusal)`. The etag is the verbatim value just
    read (None = absent → create-only). A save with no base (Save As / a new
    sheet / an import) is a create, so a name somebody already holds is EXISTS.
    Runs BEFORE anything is composed or written, so a refused save writes nothing."""
    if not _cas_on():
        return None, None
    try:
        doc, etag, _ = _read_manifest_r2(sheet)
    except storage.ObjectUnreadable as e:
        return None, {"error": f"Could not read the saved version of '{sheet}' from R2 "
                      f"({e}). Nothing was saved — saving without knowing what is "
                      "there could overwrite someone else's work. Try again."}
    raw_base = str(base_etag or "").strip()
    base = docsave.Base(docsave.norm_etag(raw_base)) if raw_base else None
    try:
        docsave.check(_doc_id(sheet), base, etag, doc, allow_rev_merge=False,
                      missing_base=docsave.EXISTS)
    except docsave.DocConflict as c:
        return None, _conflict(sheet, c)
    return etag, None


def _refused(sheet: str, read_etag: str | None) -> dict:
    """R2 refused the conditional write although the pre-check passed: another
    CONTAINER wrote the manifest in between. Re-read it so the page can say who."""
    try:
        doc, etag, _ = _read_manifest_r2(sheet)
    except storage.ObjectUnreadable:
        return _conflict(sheet, docsave.DocConflict(_doc_id(sheet), docsave.STALE))
    base = docsave.Base(docsave.norm_etag(read_etag)) if read_etag else None
    try:
        docsave.check(_doc_id(sheet), base, etag, doc, allow_rev_merge=False,
                      missing_base=docsave.EXISTS)
    except docsave.DocConflict as c:
        return _conflict(sheet, c)
    return _conflict(sheet, docsave.DocConflict(_doc_id(sheet), docsave.STALE,
                                                etag=etag, doc=doc))


def _write_manifest_cas(sheet: str, manifest: dict,
                        read_etag: str | None) -> tuple[str | None, dict | None]:
    """Write a stamped manifest on exactly the version `_check_base` read.
    Returns `(new etag, refusal)`."""
    try:
        etag = _put_manifest(sheet, manifest, if_match=read_etag,
                             if_none_match=None if read_etag else "*")
    except storage.Conflict:
        return None, _refused(sheet, read_etag)
    except Exception as e:  # noqa: BLE001 — a transport failure is not a conflict
        return None, {"error": f"The sheet's manifest could not be saved to R2 "
                      f"({type(e).__name__}: {e}), so its page was not uploaded either. "
                      "Save again."}
    return etag, None


def _unstage(paths: list[Path]) -> None:
    """Put staged files back to what R2 holds after a refused save.

    A save composes its page/.atlas/.json into staging and pushes them only once
    its manifest has landed, so on a refusal R2 still has the winner's files and
    only staging holds the loser's. Staging must not keep them: a later load
    re-slices from the staged page, and hydration never overwrites a NEWER local
    file. A file R2 lacks, or that cannot be read back, is removed rather than
    left as the loser's bytes — the next load pulls R2's copy on demand."""
    ctx = _ctx()
    r2_prefix, staging_root = ctx["r2_prefix"], ctx["staging_root"]
    for p in paths:
        blob = None
        if _cas_on() and staging_root:
            try:
                rel = Path(p).resolve().relative_to(
                    Path(staging_root).resolve()).as_posix()
                blob = storage.get_strict(f"{r2_prefix}/{rel}")
            except Exception:  # noqa: BLE001 — unreadable: drop the loser's copy
                blob = None
        try:
            if blob is None:
                Path(p).unlink(missing_ok=True)
            else:
                _stage_bytes(Path(p), blob)
        except OSError:
            pass


def _holder_note(by: dict | None) -> str:
    return f" (saved by {by.get('name') or 'someone'})" if by else ""


_UNLOCK_ATTEMPTS = 4    # the first try + 3 retries through a concurrent write


def api_presence(payload: dict) -> dict:
    """The "X is editing this sheet" heartbeat (iw_common/presence.py), keyed
    `sheetMaker/<sheet>` — the sheet whose manifest a Save writes."""
    return presence.beat("sheetMaker", _ctx()["r2_prefix"] or "",
                         safe_name(str(payload.get("doc") or ""), ""), _identity(),
                         payload.get("tab"), release=bool(payload.get("release")))


def api_unlock_sheet(payload: dict) -> dict:
    """Clear a sheet's verbatim-import lock so it can be re-packed again."""
    sheet = safe_name(payload.get("sheet", ""), "")
    if not sheet:
        return {"error": "No sheet name given."}
    with _sheet_guard(sheet):
        return _unlock_sheet(sheet, str(payload.get("base_etag") or "").strip())


def _unlock_sheet(sheet: str, base: str = "") -> dict:
    """A server-side read-modify-write of the manifest: a write that loses to a
    concurrent save simply re-reads and re-applies the one field it changes
    rather than asking anybody.

    The reply's `etag` is one the page may ADOPT as its loaded version, so it is
    returned only when the unlock was applied to exactly the version the page
    holds (`base`, sent when the page unlocks the sheet it has open). Otherwise
    somebody saved since the page loaded, and adopting the post-unlock version
    would let the page's next Save — a canvas from before their save — replace
    it silently. With no `etag` the page keeps its own, and that Save conflicts."""
    def adoptable(read_etag: str | None, reply_etag: str | None) -> dict:
        if base and docsave.norm_etag(read_etag) == docsave.norm_etag(base):
            return {"etag": docsave.norm_etag(reply_etag)}
        return {}

    done = {"sheet": sheet, "locked": False,
            "note": f"'{sheet}' unlocked — saving it now RE-PACKS the page and "
                    "rewrites every rect. The original coordinates are gone once "
                    "you save."}
    for _ in range(_UNLOCK_ATTEMPTS):
        try:
            man, etag, raw = _read_manifest_r2(sheet)
        except storage.ObjectUnreadable as e:
            return {"error": f"Could not read '{sheet}' from R2 ({e}) — nothing was "
                    "changed. Try again."}
        if man is None:
            if raw is not None:
                return {"error": f"Sheet '{sheet}''s manifest could not be parsed, so "
                        "it cannot be unlocked."}
            return {"error": f"Sheet '{sheet}' has no manifest to unlock (looked for "
                    f"atlas_manifest_{sheet}.json in manifests/)."}
        if not man.get("locked"):
            if raw is not None and etag is not None:
                _stage_bytes(_manifest_path_for(sheet), raw)   # staging may say locked
            return {"sheet": sheet, "locked": False, **adoptable(etag, etag),
                    "saved_by": docsave.saved_by_of(man),
                    "note": f"'{sheet}' was not locked."}
        man["locked"] = False
        by = docsave.stamp(man, _identity(), "sheet")
        try:
            new = _put_manifest(sheet, man, if_match=etag)
        except storage.Conflict:
            continue
        return {**done, **adoptable(etag, new), "saved_by": by}
    return {"error": f"'{sheet}' kept changing while it was being unlocked (another "
            "save landed each time) — nothing was changed. Try again."}


def api_arrange(payload: dict) -> dict:
    """Free-canvas auto-arrange: pack only the UNLOCKED sprites into the space
    left by the locked ones, inside a fixed canvas. Identity is the uploaded
    filename (`src`); display names are tracked client-side."""
    blocked = _locked_error(str(payload.get("sheet") or ""), "Auto-arranging")
    if blocked:
        return {"error": blocked}
    canvas_w = int(payload.get("canvas_w", 1024))
    canvas_h = int(payload.get("canvas_h", 1024))
    padding = int(payload.get("padding", 2))
    rot = bool(payload.get("allow_rotation", False))

    items = []
    for r in payload.get("regions", []):
        if not r.get("src"):
            continue
        items.append({
            "name": r["src"],          # geometric identity
            "w": int(r["w"]), "h": int(r["h"]),
            "locked": bool(r.get("locked")),
            "x": int(r.get("x", 0)), "y": int(r.get("y", 0)),
            "rotated": bool(r.get("rotated")),
        })
    if not items:
        return {"error": "No sprites to arrange."}

    res = packer.arrange(canvas_w, canvas_h, items, padding=padding, allow_rotation=rot)
    # Re-key by src for the client.
    out = [{"src": r["name"], "x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"],
            "rotated": r["rotated"], "locked": r["locked"]} for r in res["regions"]]
    return {"placements": out, "unplaced": res["unplaced"]}


def api_rescale_sheet(payload: dict) -> dict:
    """Downscale a whole sheet: resample every loose sprite in this sheet's pile
    by `factor`. The client scales the canvas and every rect by the same factor.

    Why the ART has to be resampled and not just the rects: compose() fits each
    source image into its region box and NEVER upscales, so the drawn size is
    `min(box/native, 1)`. Leaving 4k art under a 1k cell would make every
    deliberately PADDED region (box larger than the art, transparent margin
    baked into the frame) suddenly FILL its cell — the layout would change
    silently. Shrinking the source by the same factor keeps `box > native`, so
    every margin scales with it.

    Destructive by design — the pile is overwritten in place. It is a PER-SHEET
    pile (`sheet_src/<sheet>/`, never shared), so no other sheet and no original
    on the author's disk is touched; the UI gates this behind an explicit
    confirmation that says the full-resolution pixels are gone.
    """
    sheet = safe_name(payload.get("sheet", ""), "")
    if not sheet:
        return {"error": "No sheet name given."}
    # A verbatim import promises byte-identical art at byte-identical rects.
    blocked = _locked_error(sheet, "Downscaling")
    if blocked:
        return {"error": blocked}
    try:
        factor = float(payload.get("factor", 0))
    except (TypeError, ValueError):
        factor = 0.0
    if not 0 < factor < 1:
        return {"error": "Downscale factor must be between 0 and 1 — this resizes "
                         "DOWN only. Scaling a sheet back up cannot restore detail "
                         "the downscale threw away; re-upload the originals instead."}

    d = uploads_dir(sheet)
    files = sorted((p for p in d.glob("*") if p.suffix.lower() in _PAGE_EXTS),
                   key=lambda p: natural_key(p.name))
    if not files:
        return {"error": f"Sheet '{sheet}' has no sprite files to downscale "
                         f"(sheet_src/{safe_name(sheet)}/ is empty)."}

    # Measure everything BEFORE writing anything: a corrupt file found halfway
    # through would otherwise leave the pile at two different scales, which no
    # later save can untangle (the originals are gone).
    sizes: list[tuple[Path, int, int]] = []
    for p in files:
        try:
            w, h = packer.measure(p)
        except Exception as e:  # noqa: BLE001 — unreadable sprite, refuse the batch
            return {"error": f"{p.name}: not a readable image ({e}). Nothing was "
                             "downscaled — remove or re-upload that sprite first."}
        sizes.append((p, w, h))

    # Half-UP, not Python's banker's round(): the browser scales every rect with
    # Math.round, and a source that rounded the other way would sit a pixel out
    # of step with its own cell.
    def _px(v: float) -> int:
        return int(v + 0.5)

    sprites, clamped, done = [], [], []
    for p, w, h in sizes:
        nw, nh = _px(w * factor), _px(h * factor)
        if nw < 1 or nh < 1:
            clamped.append(p.name)
        nw, nh = max(1, nw), max(1, nh)
        try:
            with Image.open(p) as im:
                out = im.convert("RGBA").resize((nw, nh), Image.LANCZOS)
            # Lossless WebP: the default is lossy q80, which smears cut-out
            # sprite edges and their alpha — exactly what packed art cannot take.
            if p.suffix.lower() == ".webp":
                out.save(p, lossless=True)
            else:
                out.save(p)
        except Exception as e:  # noqa: BLE001 — surface WHERE it stopped
            return {"error": f"{p.name}: downscale failed ({e}). "
                             f"{len(done)} sprite(s) were already resampled to "
                             f"{round(factor * 100)}% ({', '.join(done[:5])}"
                             f"{'…' if len(done) > 5 else ''}) — this sheet's pile is "
                             "now at two different scales. Re-upload the originals "
                             "before saving."}
        _mirror(p)
        done.append(p.name)
        sprites.append({"file": p.name, "w": nw, "h": nh, "was_w": w, "was_h": h})

    return {"sheet": sheet, "factor": factor, "count": len(sprites),
            "sprites": sprites, "clamped": clamped}


def api_export(payload: dict) -> dict:
    """Claim the destination sheet for the whole export, then run it.

    The destination is resolved ONCE here and handed to the body: deriving it
    twice is how the `.plist` import came to claim a directory its own body
    never wrote to."""
    sheet = safe_name(payload.get("sheet", "sheet"))
    dest = _resolve_dest(sheet, str(payload.get("dest_dir") or "").strip())
    # The manifest is claimed too: losing it is the "sheet in the rail with no
    # coords" failure the rest of this path works hard to prevent.
    with (_sheet_guard(sheet),
          _claim_scope("sheets", _sheet_key(dest) or sheet),
          _claim_scope("manifests", f"atlas_manifest_{sheet}.json")):
        return _export(payload, dest)


def _export(payload: dict, dest: Path) -> dict:
    """Compose the sheet from the client's current canvas geometry and write
    the selected formats. Stateless: geometry comes entirely from the payload."""
    sheet = safe_name(payload.get("sheet", "sheet"))
    # Saving IS the re-pack: compose() redraws the page and every writer below
    # emits fresh geometry. A verbatim import must be unlocked (or saved under a
    # new name) first. Gated on the TARGET sheet, so "Save As" to a new name is
    # still allowed — that copies rather than overwriting the import.
    blocked = _locked_error(sheet, "Saving")
    if blocked:
        return {"error": blocked}
    basename = sheet
    dest_dir = (payload.get("dest_dir") or "").strip()
    fmts = payload.get("formats", {})
    width = int(payload.get("canvas_w", 1024))
    height = int(payload.get("canvas_h", 1024))

    up = uploads_dir(sheet)
    regions = []
    for r in payload.get("regions", []):
        src = r.get("src")
        if not src:
            continue
        w = int(r.get("w", 0))
        h = int(r.get("h", 0))
        # Image draw size inside the region box (defaults to the box). The region
        # is kept at least as large as the image so the centred art never spills
        # into a neighbouring packed cell.
        iw = max(int(r.get("iw") or w), 1)
        ih = max(int(r.get("ih") or h), 1)
        w, h = max(w, iw), max(h, ih)
        regions.append({
            "name": safe_name(r.get("name") or Path(src).stem, Path(src).stem),
            "src": src,
            "x": int(r.get("x", 0)), "y": int(r.get("y", 0)),
            "w": w, "h": h, "iw": iw, "ih": ih,
            "rotated": bool(r.get("rotated")),
            "prompt": r.get("prompt", ""),
            "shape_ref": r.get("shape_ref", ""),
            "seed": r.get("seed", ""),
            # FX placeholder cells (named `<base>_<mode>`) carry their mode so the
            # manifest opens them in the Atlas Maker's matching local-FX mode.
            "fx_mode": r.get("fx_mode", ""),
        })
    if not regions:
        return {"error": "Nothing to export — add some sprites first."}

    names = [r["name"] for r in regions]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        detail = "; ".join(
            f"{n} <- " + ", ".join(
                sorted(r.get("src") or "?" for r in regions if r["name"] == n))
            for n in dupes)
        return {"error": "Duplicate region names — each name must be unique within a "
                f"sheet. Collisions ({detail}). This usually means two FX cells (e.g. "
                "a stray _glow/_shine copy left by an atlas round-trip) resolved to the "
                "same name: delete the extra cell, re-tick the FX on the base, and export."}

    # Compare-and-swap, checked BEFORE compose writes a single byte: a save based
    # on a version somebody has since replaced is refused with who did it, and
    # the page is left exactly as the winner wrote it. `base_etag` absent or ""
    # = Save As / a new sheet, which may only CREATE the name.
    read_etag, refusal = _check_base(sheet, payload.get("base_etag"))
    if refusal:
        return refusal

    # Each sheet keeps its OWN sprite copies under sheet_src/<sheet>/ — they are
    # not shared between sheets. A region whose file isn't in THIS sheet's folder
    # would crash compose with a raw FileNotFoundError, so surface it as an
    # actionable error naming exactly what to re-upload.
    # Resolved by the caller (which claimed it); created only now, so a REJECTED
    # export above leaves no empty sheets/<name>/ on the rail.
    out = dest
    out.mkdir(parents=True, exist_ok=True)
    image_for = {r["name"]: (up / r["src"]) for r in regions}
    missing = sorted({r["src"] for r in regions if not (up / r["src"]).exists()})
    if missing:
        return {"error": "These sprites are missing from this sheet's files ("
                + f"sheet_src/{safe_name(sheet)}/): " + ", ".join(missing)
                + ". Re-upload them here — a sprite added to another sheet isn't "
                "shared; each sheet keeps its own copies."}
    # The page, .atlas and json are written to STAGING here and pushed to R2 only
    # once the manifest has landed (see the CAS write below), so a refused save
    # never touches R2's copy of the winner's page. Between these local writes
    # and their pushes staging holds files R2 lacks — what `prune_listing_ghosts`
    # reads as a ghost — which is why `api_export` holds the sheet's claim for
    # the whole export.
    staged: list[Path] = []
    sheet_img = packer.compose(regions, width, height, image_for)
    sheet_png = out / f"{basename}.png"
    sheet_img.save(sheet_png)
    staged.append(sheet_png)
    written = [str(sheet_png)]

    # B14 — self-contained manifest. Compute the R2 keys of everything this
    # export emits so the manifest can back-reference them (the Atlas Maker
    # ingests them instead of forcing a manual re-pick). The packed sheet landed
    # in the staging `sheets/<sheet>/` dir, which mirrors `{R2_PREFIX}/sheets/<sheet>`;
    # the loose trims (per-region sprites) live under `{R2_PREFIX}/sheet_src/<sheet>`.
    ctx = _ctx()
    r2_prefix = ctx["r2_prefix"]
    sheet_key = safe_name(sheet)
    # Derive the prefix from where the files ACTUALLY landed (`out`), not from
    # an assumed `sheets/<sheet>` — a custom dest under sheets/ would otherwise
    # produce a manifest whose back-references point at files that don't exist.
    try:
        out_rel = out.resolve().relative_to(
            Path(project_paths.resolve()["staging_root"]).resolve()).as_posix()
    except ValueError:
        out_rel = f"sheets/{sheet_key}"
    export_prefix = f"{r2_prefix}/{out_rel}" if r2_prefix else ""
    source_image_key = f"{export_prefix}/{sheet_png.name}" if export_prefix else ""
    input_prefix = f"{r2_prefix}/sheet_src/{sheet_key}" if r2_prefix else ""
    region_shape_keys = {
        r["name"]: f"{input_prefix}/{r['src']}"
        for r in regions if input_prefix and r.get("src")
    }

    atlas_file_key = ""
    if fmts.get("libgdx"):
        ap = out / f"{basename}.atlas"
        atlas_writers.write_libgdx_atlas(ap, sheet_png.name, width, height, regions)
        staged.append(ap)
        written.append(str(ap))
        if export_prefix:
            atlas_file_key = f"{export_prefix}/{ap.name}"
    tp_json_key = ""
    if fmts.get("texturepacker"):
        jp = out / f"{basename}.json"
        atlas_writers.write_texturepacker_json(jp, sheet_png.name, width, height, regions)
        staged.append(jp)
        written.append(str(jp))
        if export_prefix:
            tp_json_key = f"{export_prefix}/{jp.name}"

    # The manifest is ALWAYS written, regardless of the format checkbox: it is
    # the canonical coords the loader (api_load_sheet) looks for FIRST, and the
    # only artifact that carries the AI fields + shape_ref back-refs needed to
    # recover the original loose sprites on a re-open. Unticking it (and the
    # other two boxes) used to mirror the PNG but persist ZERO coords, leaving a
    # sheet that shows in the rail yet hard-errors on Load with no way back. The
    # `.atlas` / TexturePacker JSON above stay optional (interop extras); the
    # manifest does not. The checkbox now only controls the user-facing note.
    manifest = atlas_writers.build_manifest(
        sheet_image=str(sheet_png), width=width, height=height,
        regions=regions, deploy_basename=basename,
        export_prefix=export_prefix,
        source_image_path=source_image_key,
        atlas_file=atlas_file_key,
        texturepacker_json=tp_json_key,
        region_shape_keys=region_shape_keys)
    man_name = f"atlas_manifest_{basename}.json"
    # The manifest lands in the SHARED manifests/ folder (mirrored to
    # <C>/<P>/manifests) — the single source of truth both tools read. No
    # cross-tool copy: the Atlas Maker hydrates the same manifests/ key.
    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out
    man_dir.mkdir(parents=True, exist_ok=True)
    mp = man_dir / man_name
    saved_by = docsave.stamp(manifest, _identity(), "sheet")
    # Lands only on the version `_check_base` read. The sheet lock only orders
    # Sheet Maker saves in THIS container; the manifest key is also written by
    # other Sheet Maker containers and by the Atlas Maker (render post-hooks, FX
    # rebuild, activation seeding, author edits), none of which take it — so a
    # refusal here is possible anywhere. That is why the page files are pushed
    # only AFTER this lands: a refused save restores staging from R2 and has
    # written nothing there.
    # RESIDUAL: once the manifest has landed there is a short window (until the
    # pushes below finish) where R2 holds the new coords beside the previous
    # page; a push that fails leaves the name flagged unpushed, as `_mirror` does.
    new_etag, refusal = _write_manifest_cas(sheet, manifest, read_etag)
    if refusal:
        _unstage(staged)
        return refusal
    for p in staged:
        _mirror(p)
    written.append(str(mp))
    manifest_note = ""
    if fmts.get("manifest"):
        manifest_note = (f"Manifest saved to the shared project folder -> {man_name}. "
                         "The Atlas Maker lists it after a Refresh (or restart).")

    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out
    manifest_path = str(man_dir / f"atlas_manifest_{basename}.json")
    return {"written": written, "manifest_note": manifest_note,
            "output_dir": str(out), "dir": str(out),
            "manifest_path": manifest_path, "name": basename,
            "etag": docsave.norm_etag(new_etag), "saved_by": saved_by}


def _swap_sheet_path(v: str, old: str, new: str) -> str:
    """Rewrite a `sheets/<old>/<old>.<ext>` or bare `sheets/<old>` reference to
    <new>. Only the sheet's own dir + basename are swapped, never an unrelated
    substring."""
    v = v.replace(f"sheets/{old}/{old}.", f"sheets/{new}/{new}.")
    v = re.sub(rf"sheets/{re.escape(old)}(?=/|$)", f"sheets/{new}", v)
    return v


def _rewrite_manifest_refs(man: dict, old: str, new: str) -> None:
    """In-place rewrite of every baked sheet-name reference inside a manifest so
    a renamed sheet's back-references (page / .atlas / json keys + per-region
    shape_refs) keep resolving. Conservative: only values matching the expected
    old-name patterns are touched, so a hand-set shape_ref pointing elsewhere is
    left alone."""
    atlas = man.get("atlas")
    if isinstance(atlas, dict):
        if atlas.get("source_image") == f"{old}.png":
            atlas["source_image"] = f"{new}.png"
        for k in ("source_image_path", "atlas_file", "texturepacker_json"):
            v = atlas.get(k)
            if isinstance(v, str) and v:
                atlas[k] = _swap_sheet_path(v, old, new)
    for k in ("export_prefix", "deploy_path"):
        v = man.get(k)
        if isinstance(v, str) and v:
            man[k] = _swap_sheet_path(v, old, new)
    if man.get("deploy_basename") == old:
        man["deploy_basename"] = new
    for r in man.get("regions") or []:
        if isinstance(r, dict):
            sr = r.get("shape_ref")
            if isinstance(sr, str) and sr:
                r["shape_ref"] = sr.replace(f"sheet_src/{old}/", f"sheet_src/{new}/")


def _patch_session_for_rename(old: str, new: str, etag: str = "",
                              moved_etag: str | None = None) -> None:
    """If the persisted editor session points at the renamed sheet, follow the
    rename so a later Refresh restores the new identity (best-effort).

    The session is shared per project, so its canvas may come from ANY version
    of the old sheet. It inherits the new key's `etag` only when its loaded
    version is the one the rename moved (`moved_etag`); otherwise it gets "" —
    its next save is then a create, refused as EXISTS, never a blind write."""
    sp = _session_path()
    try:
        sess = json.loads(sp.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return
    if not isinstance(sess, dict):
        return
    changed = False
    for k in ("sheet", "active_sheet", "display_name"):
        if sess.get(k) == old:
            sess[k] = new
            changed = True
    loaded = sess.get("loaded")
    if isinstance(loaded, dict):
        if loaded.get("name") == old:
            loaded["name"] = new
            same = (moved_etag is not None and docsave.norm_etag(moved_etag)
                    and docsave.norm_etag(loaded.get("etag")) == docsave.norm_etag(moved_etag))
            loaded["etag"] = etag if same else ""
            changed = True
        for k in ("path", "dir"):
            v = loaded.get(k)
            if isinstance(v, str) and v:
                nv = _swap_sheet_path(v.replace("\\", "/"), old, new)
                if nv != v:
                    loaded[k] = nv
                    changed = True
    if changed:
        try:
            sp.write_text(json.dumps(sess, indent=2, ensure_ascii=False), encoding="utf-8")
            _mirror(sp)
        except OSError:
            pass


def _repull_tree(rel_prefix: str, prune: bool) -> None:
    """Re-download every object under `<project>/<rel_prefix>` into staging,
    STRICTLY: a listing or read that fails raises, so the caller can refuse
    rather than work from a half-refreshed tree (`pull_prefix` swallows per-file
    errors and skips "newer" local files, which is the wrong trade here).
    `prune` also drops staged files R2 no longer has."""
    ctx = _ctx()
    r2_prefix, root = ctx["r2_prefix"], Path(ctx["staging_root"])
    listed: set[Path] = set()
    for obj in storage.list_keys(f"{r2_prefix}/{rel_prefix}"):
        key = obj["key"]
        blob = storage.get_strict(key)
        if blob is None:
            continue                     # deleted between the listing and the read
        dest = root / key[len(r2_prefix) + 1:]
        _stage_bytes(dest, blob)
        listed.add(dest.resolve())
    local = root / rel_prefix
    if prune and local.is_dir():
        for p in local.rglob("*"):
            if p.is_file() and p.resolve() not in listed:
                p.unlink(missing_ok=True)


def api_rename_sheet(payload: dict) -> dict:
    """Claim BOTH names for the whole rename, then run it.

    The new one is unpushed while it is written; the old one must survive the
    copy loop still reading it. Scoped rather than claimed-and-forgotten because
    step 5 DELETES the old name for good — nothing would ever push under it
    again, so a bare claim there leaks for the life of the process and makes the
    held-claims diagnostic permanent noise."""
    old = safe_name(payload.get("from", ""), "")
    new = safe_name(payload.get("to", ""), "")
    with (_sheet_guard(old, new),
          _claim_scope("sheets", old),
          _claim_scope("sheets", new),
          _claim_scope("manifests", f"atlas_manifest_{new}.json" if new else "")):
        return _rename_sheet(payload)


def _rename_sheet(payload: dict) -> dict:
    """Rename a saved sheet end-to-end. The sheet's identity (`safe_name`) is
    baked into FOUR R2/staging locations AND the manifest's internal back-refs:
    `sheets/<sheet>/<sheet>.{png,atlas,json}`, `sheet_src/<sheet>/*`,
    `manifests/atlas_manifest_<sheet>.json`, and the manifest's own
    `source_image*/atlas_file/texturepacker_json/export_prefix` + every region
    `shape_ref`. A correct rename moves all of them and rewrites the refs, else
    original-sprite recovery breaks (see api_load_sheet). New keys are written +
    mirrored FIRST; the old keys are deleted LAST, so a mid-way failure stays
    recoverable. R2 is the source of truth — every move mirrors through."""
    old = safe_name(payload.get("from", ""), "")
    new = safe_name(payload.get("to", ""), "")
    if not old:
        return {"error": "No sheet selected to rename."}
    if not new:
        return {"error": "The new sheet name is empty after sanitising."}
    if new == old:
        return {"error": "The new name matches the current one."}

    ctx = _ctx()
    pp = project_paths.resolve()
    r2_prefix = ctx["r2_prefix"]
    out_root = pp["output_root"]
    input_dir = pp["input_dir"]
    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out_root

    # Make sure the source's lazily-pulled sprite pile is present to move.
    uploads_dir(old)

    old_out, new_out = out_root / old, out_root / new
    old_src, new_src = input_dir / old, input_dir / new
    old_man = man_dir / f"atlas_manifest_{old}.json"
    new_man = man_dir / f"atlas_manifest_{new}.json"

    if not (old_out.exists() or old_man.exists()):
        return {"error": f"Sheet '{old}' not found — try ↻ Refresh from R2 first."}
    if new_out.exists() or new_man.exists():
        return {"error": f"A sheet named '{new}' already exists — pick another name."}

    # The OLD manifest as R2 holds it — staging can be stale, and whatever is read
    # here is what moves. A page renaming the sheet it has open sends the version
    # it loaded: renaming a sheet somebody has saved since would carry their work
    # under a name they do not know about, so that is refused like a stale save.
    cas = _cas_on()
    base_raw = str(payload.get("base_etag") or "").strip()
    try:
        man, old_etag, old_raw = _read_manifest_r2(old)
    except storage.ObjectUnreadable as e:
        return {"error": f"Could not read '{old}' from R2 ({e}) — nothing was "
                "renamed. Try again."}
    if old_raw is not None and man is None:
        return {"error": f"Could not read the manifest to rename it: "
                f"atlas_manifest_{old}.json is not a JSON object."}
    if cas and base_raw:
        try:
            docsave.check(_doc_id(old), docsave.Base(docsave.norm_etag(base_raw)),
                          old_etag, man, allow_rev_merge=False)
        except docsave.DocConflict as c:
            by = c.saved_by
            return {**_conflict(old, c),
                    "error": (f"'{old}' was deleted since you opened it — nothing was renamed."
                              if c.reason == docsave.DELETED else
                              f"'{old}' was saved{_holder_note(by)} since you opened it — "
                              "nothing was renamed. Reload it, then rename.")}
    if man is None and cas and old_etag is None:
        man = _read_manifest(old)      # not in R2: unpushed local work, carry it over

    # The copy below reads STAGING, the manifest came from R2. If they differ,
    # another writer saved since this container hydrated, and copying the staged
    # page would put fresh coords over a stale page under the new name. Re-pull
    # the old sheet's files first; if that cannot be done, refuse.
    if cas and old_raw is not None:
        try:
            staged_man = old_man.read_bytes()
        except OSError:
            staged_man = None
        if staged_man != old_raw:
            try:
                _repull_tree(f"sheets/{old}/", prune=True)
                _repull_tree(f"sheet_src/{old}/", prune=False)
                _stage_bytes(old_man, old_raw)
            except Exception as e:  # noqa: BLE001 — a half-refreshed copy is worse
                return {"error": f"'{old}' changed in R2 since this server loaded it, and "
                        f"its files could not be re-read ({type(e).__name__}: {e}) — "
                        "nothing was renamed. Try ↻ Refresh from R2, then rename."}

    # CLAIM the new name before copying anything: the manifest goes first,
    # create-only, so a name somebody else holds in R2 (another container's
    # sheet this staging has never seen) refuses the rename with nothing written.
    # A sheet with no manifest has nothing to claim with; the staging check above
    # is all it gets, as before.
    new_etag = None
    new_by = None
    if man is not None:
        man = json.loads(json.dumps(man))
        _rewrite_manifest_refs(man, old, new)
        new_by = docsave.stamp(man, _identity(), "sheet")
        try:
            new_etag = _put_manifest(new, man, if_none_match="*")
        except storage.Conflict:
            try:
                holder = docsave.saved_by_of(_read_manifest_r2(new)[0])
            except storage.ObjectUnreadable:
                holder = None
            return {"error": f"A sheet named '{new}' already exists"
                    f"{_holder_note(holder)} — pick another name."}
        except Exception as e:  # noqa: BLE001 — nothing is copied yet; say so
            return {"error": f"Could not create '{new}' in R2 ({type(e).__name__}: "
                    f"{e}) — nothing was renamed."}

    # 1. packed output sheets/<old>/ -> sheets/<new>/ (rename the <old>.* files).
    if old_out.exists():
        new_out.mkdir(parents=True, exist_ok=True)
        for p in sorted(old_out.iterdir()):
            if not p.is_file():
                continue
            nm = (new + p.name[len(old):]) if p.name.startswith(old + ".") else p.name
            dest = new_out / nm
            dest.write_bytes(p.read_bytes())
            _mirror(dest)

    # 2. loose sprites sheet_src/<old>/ -> sheet_src/<new>/ (filenames unchanged).
    if old_src.exists():
        new_src.mkdir(parents=True, exist_ok=True)
        for p in sorted(old_src.iterdir()):
            if p.is_file():
                dest = new_src / p.name
                dest.write_bytes(p.read_bytes())
                _mirror(dest)

    # 3. the manifest was written under the new name first (the claim above).

    # 4. follow the rename in the persisted editor session (best-effort).
    _patch_session_for_rename(old, new, docsave.norm_etag(new_etag), old_etag)

    def sheets_now() -> list[str]:
        return (sorted(p.name for p in out_root.iterdir() if p.is_dir())
                if out_root.exists() else [])

    done ={"ok": True, "from": old, "to": new,
            "etag": docsave.norm_etag(new_etag), "saved_by": new_by}

    # 5. delete the OLD keys LAST — but only the version that was copied. If the
    # old name was saved while this ran (another container: here the sheet lock
    # holds it off) its newest work exists nowhere else, so everything under it
    # is kept and the author is told. RESIDUAL: a save landing between this
    # re-read and the deletes below is still lost — S3 deletes are unconditional.
    if cas:
        try:
            _, now_etag, _ = _read_manifest_r2(old)
            moved = now_etag is not None and (docsave.norm_etag(now_etag)
                                              != docsave.norm_etag(old_etag))
            why = "was saved by someone while the rename ran" if moved else ""
        except storage.ObjectUnreadable:
            why = "could not be re-checked in R2 after the copy"
        if why:
            return {**done, "sheets": sheets_now(), "kept_old": True,
                    "note": f'Copied "{old}" → "{new}", but "{old}" {why}, so it was '
                            f'KEPT rather than deleted — both sheets now exist. Check '
                            f'"{old}" and delete it yourself once nothing in it is needed.'}
    if r2_prefix:
        for pre in (f"{r2_prefix}/sheets/{old}/", f"{r2_prefix}/sheet_src/{old}/"):
            for obj in storage.list_keys(pre):
                storage.delete(obj["key"])
        storage.delete(f"{r2_prefix}/manifests/atlas_manifest_{old}.json")
    shutil.rmtree(old_out, ignore_errors=True)
    shutil.rmtree(old_src, ignore_errors=True)
    old_man.unlink(missing_ok=True)
    _forget_sheet(old)

    return {**done, "sheets": sheets_now(), "note": f'Renamed "{old}" → "{new}".'}


def _clear_session_if_sheet(sheet: str) -> None:
    """Drop the persisted editor session if it points at `sheet`, so a refresh
    after deleting the open sheet starts on a clean canvas (best-effort)."""
    sp = _session_path()
    try:
        sess = json.loads(sp.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return
    if not isinstance(sess, dict):
        return
    if sess.get("sheet") == sheet or sess.get("active_sheet") == sheet:
        sp.unlink(missing_ok=True)
        r2_prefix = _ctx()["r2_prefix"]
        if r2_prefix:
            storage.delete(f"{r2_prefix}/{sp.name}")


def _slice_tree_users(r2_prefix: str, sheet: str) -> list[str] | None:
    """Manifests OTHER than `sheet`'s own that point into
    `input/refs/atlasslices/<sheet>/`, or None when that cannot be determined.

    None and a non-empty list mean the same thing to the caller — do not delete
    the tree — but they are different facts and the caller reports them
    differently. A scan that failed is not proof of no users."""
    own = {f"atlas_manifest_{sheet}.json", f"{sheet}.json"}
    needle = f"atlasslices/{sheet}/"
    users: list[str] = []
    try:
        for obj in storage.list_keys(f"{r2_prefix}/manifests/"):
            name = obj["key"].rsplit("/", 1)[-1]
            if name in own or not name.endswith(".json"):
                continue
            blob = storage.get(obj["key"])
            if blob and needle in blob.decode("utf-8", "replace"):
                users.append(name)
    except Exception:  # noqa: BLE001 — unscannable is not unreferenced
        return None
    return users


def api_delete_sheet(payload: dict) -> dict:
    """Delete a saved sheet end-to-end. A sheet's bytes live in several R2/staging
    locations: the packed output `sheets/<sheet>/*`, the loose sprites
    `sheet_src/<sheet>/*`, and the manifest(s) `manifests/atlas_manifest_<sheet>.json`
    / `manifests/<sheet>.json`. R2 is the SOURCE OF TRUTH — every consumer (e.g. the
    Invisible Symbols State Machine) lists sheets straight off the live `sheets/`
    prefix, so a sheet is only really gone once those objects leave R2.

    Three failure modes this guards against (all produced "deleted here, still
    loadable in the State Machine"):
      - the old code measured success against LOCAL STAGING and dropped the sheet
        from the rail even when R2 never changed;
      - `storage.delete` swallows every error (read-only token, transport hiccup),
        so a silent R2 failure was reported as success;
      - the verification itself used `storage.exists`, which folds EVERY error
        into "not there" — a throttled or timed-out HEAD read as a successful
        delete, which is the very bug the re-list was added to catch. It now uses
        `storage.head` (only a real 404 is absence) and refuses when the check
        cannot be completed at all: unverifiable is not verified-clean.
    So after deleting we RE-LIST R2 and fail loudly if anything survives, and the
    returned rail reflects R2 only once the source is confirmed clean.

    `deploy/` is deliberately NOT touched. It is a BUILD ARTIFACT of Export
    Symbols, not the sheet's source bytes, and the exporter already drops a sheet
    whose packed page is gone — so it self-heals on the next export. Deleting a
    live bundle's files out from under it would be the riskier move; instead we
    say so in the returned note when a deployed copy is still standing.

    The Atlas Maker's slice mirror is removed only when nothing else points at
    it — see `_slice_tree_users`. Sheet-name namespacing is NOT ownership here.

    A partially-created / corrupted sheet may have NO objects at all (named in the
    editor but never exported). That is still removable: the prefixes come back
    empty, verification passes, and we clear local staging + any stale session."""
    sheet = safe_name(payload.get("sheet", ""), "")
    if not sheet:
        return {"error": "No sheet selected to delete."}

    ctx = _ctx()
    pp = project_paths.resolve()
    r2_prefix = ctx["r2_prefix"]
    out_root = pp["output_root"]
    input_dir = pp["input_dir"]
    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out_root

    out = out_root / sheet
    src = input_dir / sheet
    man = man_dir / f"atlas_manifest_{sheet}.json"

    # The cloud tool always runs under a project; without an R2 prefix we cannot
    # touch the source, so refuse rather than "delete" only the local mirror (the
    # original false-success bug).
    if not r2_prefix:
        return {"error": "No project / R2 context — cannot delete from the source. "
                "Open the tool from the Launcher with a project selected."}

    # Every R2 tree that is the sheet's ALONE: `sheets/` (packed page + .atlas +
    # TexturePacker json) and `sheet_src/` (the uploaded sprites).
    # NOT included: `input/refs/useroutput_<region>.png`, keyed by REGION name and
    # therefore SHARED by every manifest in the project — two sheets with a region
    # of the same name share one file, so deleting it here would blank a surviving
    # sheet's art. Those are left to the Atlas Maker, which owns that namespace.
    trees = [f"{r2_prefix}/sheets/{sheet}/", f"{r2_prefix}/sheet_src/{sheet}/"]
    manifest_keys = (f"{r2_prefix}/manifests/atlas_manifest_{sheet}.json",
                     f"{r2_prefix}/manifests/{sheet}.json")

    # `input/refs/atlasslices/<sheet>/` is the Atlas Maker's slice mirror of this
    # sheet's page. It LOOKS sheet-owned — it is namespaced by sheet name — but a
    # duplicated atlas copies `shape_ref`/`style_ref` VERBATIM (`_DUPLICATE_DROP`
    # does not clear them), so a derived atlas keeps pointing at the tree of the
    # sheet it was copied from. Real cross-references in the bucket today:
    # `s_new_boot_idle_water` → `atlasslices/S_New_Boot` (25 refs) and
    # `mmBG` → `atlasslices/SingleImage` (176). So it is only removable once
    # nothing else refers to it, and a scan we cannot complete means "leave it".
    slices = f"{r2_prefix}/input/refs/atlasslices/{sheet}/"
    slice_users = _slice_tree_users(r2_prefix, sheet)
    if slice_users is None or slice_users:
        pass                     # referenced elsewhere, or unknowable — keep it
    else:
        trees.append(slices)

    # 1. R2 (source of truth) FIRST — prefix-list + delete each tree, plus both
    # manifest spellings. Empty prefixes just yield no keys, so a corrupted
    # no-objects sheet is a clean no-op here. `list_keys` RAISES on a transport
    # error (it is the strict one), which must read back as an actionable
    # refusal rather than a 500 on a button press.
    try:
        for pre in trees:
            for obj in storage.list_keys(pre):
                storage.delete(obj["key"])
    except Exception as e:  # noqa: BLE001 — a half-listed tree is a half-delete
        return {"error": f'Deleting "{sheet}" stopped part-way — R2 could not be '
                f"read ({type(e).__name__}: {e}). SOME of its objects are already "
                "gone and others may remain, so the sheet is left on the rail "
                "rather than reported as deleted. Deleting again is safe and "
                "finishes the job."}
    for key in manifest_keys:
        storage.delete(key)

    # 2. VERIFY against R2. `storage.delete` never raises, so re-read every key
    # that gates a sheet's visibility (the prefixes the State Machine reads, plus
    # the manifests the Atlas picker reads). Anything left means the delete
    # silently failed — surface it instead of lying, and leave staging intact so
    # the rail keeps showing the sheet that is, in fact, still there.
    #
    # A check that cannot be COMPLETED is not a pass: `list_keys` raises and
    # `head` raises ObjectUnreadable on anything but a real 404, and both land
    # here. Reporting success off a failed read is exactly how the tool used to
    # lie about a delete it never made.
    try:
        remaining = [o["key"] for pre in trees for o in storage.list_keys(pre)]
        remaining += [k for k in manifest_keys if storage.head(k) is not None]
    except Exception as e:  # noqa: BLE001 — unverifiable is NOT verified-clean
        return {"error": f'Sent the deletes for "{sheet}" — most likely they all '
                "landed — but the confirming read failed "
                f"({type(e).__name__}: {e}), so it is NOT reported as deleted. "
                "The sheet stays on the rail until a delete can be verified; "
                "running it again is safe and settles it either way."}
    if remaining:
        return {"error": f'Could not delete "{sheet}" from R2 — {len(remaining)} '
                "object(s) still remain at the source, so it was NOT removed. The "
                "tool's R2 token may lack delete permission. (First leftover: "
                f"{remaining[0]})"}

    # 3. Local staging copies — only now that the source is confirmed clean.
    shutil.rmtree(out, ignore_errors=True)
    shutil.rmtree(src, ignore_errors=True)
    man.unlink(missing_ok=True)
    (man_dir / f"{sheet}.json").unlink(missing_ok=True)

    # 4. If the deleted sheet was the persisted/open one, clear the session so a
    # refresh / restart doesn't restore a canvas pointing at the dead pile.
    _clear_session_if_sheet(sheet)
    _forget_sheet(sheet)

    # 5. A deployed copy is a build artifact, not a leftover we own (see the
    # docstring) — but say it is there, so "I deleted it and the game still
    # ships it" is answered before it is asked.
    note = f'Deleted "{sheet}" from R2.'
    if slice_users:
        note += (f" Kept its Atlas Maker slices — {len(slice_users)} other "
                 f"manifest(s) still reference them (e.g. {slice_users[0]}).")
    elif slice_users is None:
        note += (" Kept its Atlas Maker slices — could not check whether another "
                 "atlas still uses them.")
    try:
        if storage.list_keys(f"{r2_prefix}/deploy/editor-symbols/{sheet}/"):
            note += (" A previously EXPORTED copy is still under deploy/ — it "
                     "drops out of the next Export Symbols once the symbols doc "
                     "stops binding it.")
    except Exception:  # noqa: BLE001 — a courtesy note must never fail the delete
        pass

    sheets = sorted(p.name for p in out_root.iterdir() if p.is_dir()) \
        if out_root.exists() else []
    return {"ok": True, "deleted": sheet, "sheets": sheets, "note": note}


def api_set_project(payload: dict) -> dict:
    cfg = load_config()
    cfg["project"] = payload.get("project", cfg.get("project", ""))
    save_config(cfg)
    return {"ok": True, "note": "Restart the tool (or relaunch from the Launcher) "
            "for the new project's paths to take effect."}


# ---------------------------------------------------------------------------
# R2-backed file browser (mirrors the staging tree, which mirrors R2)
# ---------------------------------------------------------------------------

def api_refresh() -> dict:
    """Re-pull this project's R2 subtree into staging (force), so the file
    browser surfaces sheets/manifests exported by other tools (e.g. the Atlas
    Maker) without restarting or switching projects. Outputs pull synchronously
    in hydrate(), so the browser shows fresh manifests as soon as this returns."""
    try:
        pp = project_paths.resolve()
        project_paths.hydrate(
            project_paths.r2_slug(project_paths.client_name()),
            project_paths.r2_slug(project_paths.project_name()),
            Path(pp["staging_root"]),
            force=True,
        )
    except Exception as e:  # noqa: BLE001 — transient R2 issue, not fatal
        return {"error": f"Refresh from R2 hit a snag — try again in a moment "
                f"({type(e).__name__}: {e})"}
    # Fresh sheet list so the "Add to sheet" dropdown can repopulate without a
    # second /api/state round-trip (the load-sheet error text points here).
    out_root = pp["output_root"]
    sheets = sorted(p.name for p in out_root.iterdir() if p.is_dir()) \
        if out_root.exists() else []
    return {"ok": True, "sheets": sheets}


def api_clearcache() -> dict:
    """TRUE reset of the ACTIVE (client, project) from R2: rmtree the whole
    per-project staging subtree, then force-hydrate to rebuild it EXACTLY from
    R2. Because pull_prefix only adds/overwrites (never prunes) and our listings
    come from the local staging glob, a file deleted from R2 (e.g. via the
    launcher FTP browser or a separate container) would otherwise linger here
    forever. Deleting the whole subtree first guarantees staging matches R2
    afterwards — anything dropped from R2 is dropped here too.

    Inactive project trees are still deleted whole (bound disk growth). The
    active subtree is deleted whole as well — including sheet_session.json — then
    force-hydrate re-pulls the eager subtrees (manifests/ + sheet_config.json +
    sheet_session.json + sheets/ sync) and clears the lazy guards so sheet_src/
    re-pulls on demand. The session file mirrors to R2 and hydrate pulls it back
    eagerly, so the saved canvas is restored from the cloud (R2 is source of
    truth). R2 is canonical, so nothing local is unique — local-disk only, never
    touches R2. Returns the bytes freed.

    Serialized against the lazy-hydrate lock so the rmtree can't interleave with
    an in-flight `ensure_lazy` pull (which would otherwise leave a half-populated
    sheet_src/ behind its still-set guard). Active lazy guards are discarded
    BEFORE the rmtree (under the lazy lock), not relying solely on the
    post-rmtree force-hydrate. The active (client, project) context is preserved
    — we rebuild the same project in place, never switch."""
    base = Path(project_paths.STAGING_BASE).resolve()
    before = _dir_size(base)
    pp = project_paths.resolve()
    active = Path(pp["staging_root"]).resolve()
    with project_paths.lazy_lock():
        # Discard the active guards first so a concurrent ensure_lazy parked on
        # the lazy lock re-pulls after us instead of trusting a stale guard over
        # the tree we are about to delete.
        project_paths.discard_active_lazy_guards()
        # Claims describe local files, and every local file is about to go. A
        # claim whose release was lost (a crashed write) would otherwise exempt
        # its name from the prune for the life of the process, and this is the
        # escape hatch `prune_listing_ghosts` tells people to reach for.
        project_paths.discard_all_authored()
        # Drop every (client, project) tree entirely, the active one included —
        # guarded so we only ever rmtree a per-(client, project) subtree, never
        # STAGING_BASE itself or a stray sibling at the wrong depth.
        if base.exists():
            for client_dir in base.iterdir():
                if not client_dir.is_dir():
                    continue
                for proj_dir in client_dir.iterdir():
                    if proj_dir.is_dir():
                        shutil.rmtree(proj_dir, ignore_errors=True)
                if not any(client_dir.iterdir()):
                    shutil.rmtree(client_dir, ignore_errors=True)
        # Re-ensure the active project's essential dirs exist (resolve() also
        # recreates them, but be explicit so a read before the next resolve()
        # can't trip).
        for d in (pp["input_dir"], pp["output_root"], pp["manifest_dir"]):
            try:
                Path(d).mkdir(parents=True, exist_ok=True)
            except OSError:
                pass
        # Rebuild the active project from R2: manifests/ + config + session +
        # packed sheets/ pull synchronously (so the sheet list + saved session
        # are fresh and any R2-deleted sheet/manifest is gone), sheet_src/ pulls
        # lazily on next access.
        try:
            project_paths.hydrate(
                project_paths.r2_slug(project_paths.client_name()),
                project_paths.r2_slug(project_paths.project_name()),
                active,
                force=True,
            )
        except Exception:  # noqa: BLE001 — best-effort re-hydrate of essentials
            pass
    freed = max(0, before - _dir_size(base))
    return {"ok": True, "freed": freed, "freed_human": _human_bytes(freed),
            "note": f"Reset from R2 — freed {_human_bytes(freed)}"}


def _safe_rel(path: str) -> str:
    """Normalise a project-relative R2 prefix/key from the client: strip leading
    slashes, reject absolute paths and any `..` escape. Returns "" for the
    project root. The result is always confined to the active project prefix."""
    rel = (path or "").strip().replace("\\", "/").strip("/")
    if not rel:
        return ""
    if Path(rel).is_absolute() or any(seg in ("..", "") for seg in rel.split("/")):
        return ""
    return rel


_IMPORT_SUFFIXES = (".json", ".atlas", ".png", ".webp")


def _browse_r2_import(rel: str) -> dict:
    """One-level folder view of the project's R2 tree under `rel` (a
    project-relative prefix; "" = project root). The R2 keystore is flat, so we
    list the whole project prefix once and derive the immediate level: distinct
    next path segments become dirs, terminal files (by suffix) become files.
    `path` values returned are project-relative keys/prefixes, which api_load
    fetches from R2 on demand."""
    ctx = _ctx()
    r2_prefix = ctx["r2_prefix"]
    if not r2_prefix:
        # No project prefix bound (first run / misconfig) — nothing to browse.
        return {"cwd": "/", "parent": "", "dirs": [], "files": [], "mode": "import"}

    # The R2 prefix under which we enumerate this level. `level` is the number of
    # path segments already consumed, so the "next segment" is at index `level`.
    sub = f"{rel}/" if rel else ""
    list_prefix = f"{r2_prefix}/{sub}"
    level = len([s for s in rel.split("/") if s]) if rel else 0

    dir_names: set[str] = set()
    files: list[dict] = []
    seen_files: set[str] = set()
    try:
        for entry in storage.list_keys(list_prefix):
            key = entry["key"]
            # Path of this key relative to the active project prefix.
            proj_rel = key[len(r2_prefix) + 1:]
            segs = [s for s in proj_rel.split("/") if s]
            if len(segs) <= level:
                continue
            seg = segs[level]
            if len(segs) > level + 1:
                dir_names.add(seg)            # deeper key → `seg` is a subfolder
            elif Path(seg).suffix.lower() in _IMPORT_SUFFIXES:
                child_rel = f"{rel}/{seg}" if rel else seg
                if child_rel not in seen_files:
                    seen_files.add(child_rel)
                    files.append({"name": seg, "path": child_rel})
    except Exception as e:  # noqa: BLE001 — transient R2 issue, surface it
        return {"error": f"R2 list failed: {type(e).__name__}: {e}"}

    dirs = [{"name": n, "path": (f"{rel}/{n}" if rel else n)}
            for n in sorted(dir_names, key=str.lower)]
    files.sort(key=lambda f: f["name"].lower())
    parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
    return {"cwd": rel or "/", "parent": parent if rel else "",
            "dirs": dirs, "files": files, "mode": "import"}


def api_browse(path: str, mode: str = "") -> dict:
    """Default ("projects") mode lists the SHARED manifests/ folder in local
    staging (atlas_manifest_*.json from both tools). `mode == "import"` browses
    the ENTIRE project's R2 tree (not just hydrated staging), so the real packed
    rig sheets under input/originals/spines/<name>/ are reachable; there `path`
    is a project-RELATIVE R2 prefix and the returned dir/file `path` values are
    project-relative R2 keys that api_load fetches on demand."""
    if mode == "import":
        return _browse_r2_import(_safe_rel(path))

    pp = project_paths.resolve()
    root = Path(pp["staging_root"]).resolve()
    out_root = Path(pp["manifest_dir"]).resolve()

    base = Path(path).resolve() if path else out_root
    # Confine browsing to the staging tree.
    if root not in base.parents and base != root:
        base = out_root
    if base.is_file():
        base = base.parent
    if not base.exists():
        base = out_root if out_root.exists() else root

    dirs, files = [], []
    try:
        for p in sorted(base.iterdir(), key=lambda x: x.name.lower()):
            if p.name.startswith("."):
                continue
            if p.is_dir():
                dirs.append({"name": p.name, "path": str(p)})
            elif p.name.startswith("atlas_manifest_") and p.suffix.lower() == ".json":
                files.append({"name": p.name, "path": str(p)})
    except OSError as e:
        return {"error": str(e)}

    parent = str(base.parent) if base != root and base.parent != base else ""
    return {"cwd": str(base), "parent": parent, "dirs": dirs, "files": files, "mode": mode}


# ---------------------------------------------------------------------------
# load existing (manifest / .atlas / TexturePacker JSON) by slicing
# ---------------------------------------------------------------------------

def _parse_coords_file(path: Path, raw: bytes | None = None) -> dict:
    """Return {image, width, height, regions:[{name,x,y,w,h,rotated,prompt,shape_ref,seed}]}.
    Supports our AI manifest, TexturePacker JSON, and libGDX/Spine-format .atlas.
    `raw` = the JSON bytes already read (the version a load reports), parsed
    instead of re-reading a file another request may have replaced since."""
    suffix = path.suffix.lower()
    if suffix == ".atlas":
        return _parse_libgdx(path)
    data = json.loads(raw if raw is not None else path.read_text(encoding="utf-8"))
    if "frames" in data:
        return _parse_texturepacker(data)
    return _parse_manifest(data)


def _parse_manifest(data: dict) -> dict:
    atlas = data.get("atlas", {})
    regions = []
    for r in data.get("regions", []) + data.get("rotated_regions", []):
        regions.append({
            "name": r.get("name", ""),
            "x": int(r.get("x", 0)), "y": int(r.get("y", 0)),
            "w": int(r.get("w", 0)), "h": int(r.get("h", 0)),
            "rotated": bool(r.get("rotated")),
            "prompt": r.get("prompt", ""), "shape_ref": r.get("shape_ref", ""),
            "seed": str(r.get("seed", "") or ""),
        })
    return {"image": atlas.get("source_image", ""),
            "width": int(atlas.get("width", 0)), "height": int(atlas.get("height", 0)),
            "regions": regions}


def _parse_texturepacker(data: dict) -> dict:
    meta = data.get("meta", {})
    size = meta.get("size", {})
    regions = []
    for key, fr in (data.get("frames") or {}).items():
        f = fr.get("frame", {})
        rotated = bool(fr.get("rotated"))
        ss = fr.get("sourceSize", {})
        # display size = sourceSize; frame w/h are the (possibly swapped) footprint.
        regions.append({
            "name": Path(key).stem,
            "x": int(f.get("x", 0)), "y": int(f.get("y", 0)),
            "w": int(ss.get("w", f.get("w", 0))), "h": int(ss.get("h", f.get("h", 0))),
            "rotated": rotated, "prompt": "", "shape_ref": "", "seed": "",
        })
    return {"image": meta.get("image", ""),
            "width": int(size.get("w", 0)), "height": int(size.get("h", 0)),
            "regions": regions}


def _parse_libgdx(path: Path) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    image, W, H = "", 0, 0
    regions, cur = [], None
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines):
        image = lines[i].strip(); i += 1

    def flush(c):
        if not c:
            return
        if "bounds" in c:
            x, y, w, h = (c["bounds"] + [0, 0, 0, 0])[:4]
        else:
            x, y = (c.get("xy", [0, 0]) + [0, 0])[:2]
            w, h = (c.get("size", [0, 0]) + [0, 0])[:2]
        rot = c.get("rotate", "false")
        rotated = str(rot).lower() not in ("false", "0", "")
        regions.append({"name": c["name"], "x": int(x), "y": int(y),
                        "w": int(w), "h": int(h), "rotated": rotated,
                        "prompt": "", "shape_ref": "", "seed": ""})

    while i < len(lines):
        line = lines[i].strip(); i += 1
        if not line:
            continue
        if ":" in line:
            k, _, v = line.partition(":")
            k = k.strip().lower(); v = v.strip()
            if k == "size" and cur is None:
                n = [int(float(t)) for t in v.split(",") if t.strip()]
                if len(n) >= 2:
                    W, H = n[0], n[1]
            elif k in ("filter", "format", "repeat", "scale", "pma") and cur is None:
                pass
            elif cur is not None:
                if k == "rotate":
                    cur["rotate"] = v
                elif k in ("bounds", "xy", "size", "orig", "offset", "offsets"):
                    cur[k] = [int(float(t)) for t in v.split(",") if t.strip()]
            continue
        flush(cur); cur = {"name": line}
    flush(cur)
    return {"image": image, "width": W, "height": H, "regions": regions}


def _resolve_image(coords_path: Path, image_ref: str) -> Path | None:
    """Find the sheet/atlas image for a loaded coords file.

    A manifest authored by the SHEET Maker keeps its page beside it (in
    sheets/<sheet>/). A manifest authored by the ATLAS Maker — now visible here
    via the SHARED manifests/ folder — references a page that lives elsewhere in
    the unified project tree (atlas/, input/refs/atlas/, input/). So search the
    stored ref, the coords dir, then those sibling folders, trying the ref
    basename, the manifest stem, and the atlas `<stem>_new` naming as .png/.webp;
    finally fall back to a recursive search for the ref basename."""
    # The exact stored ref (absolute or cwd-relative) wins if it resolves.
    if image_ref and Path(image_ref).exists():
        return Path(image_ref)

    names: list[str] = []
    if image_ref:
        names.append(Path(image_ref).name)
    stem = coords_path.stem.replace("atlas_manifest_", "")
    for base in (stem, f"{stem}_new"):
        names += [f"{base}.png", f"{base}.webp"]

    dirs = [coords_path.parent]
    root: Path | None = None
    try:
        root = Path(project_paths.resolve()["staging_root"])
        dirs += [root / "atlas", root / "input" / "refs" / "atlas",
                 root / "input", root / "sheets"]
    except Exception:  # noqa: BLE001 — fall back to coords-dir only
        pass

    for d in dirs:
        for nm in names:
            c = d / nm
            if c.exists():
                return c

    # The ref's basename anywhere already in local staging.
    if root is not None and image_ref:
        try:
            for found in root.rglob(Path(image_ref).name):
                if found.is_file():
                    return found
        except OSError:
            pass

    # Cross-tool fetch: an Atlas-authored manifest's page lives in a sibling
    # folder the Sheet Maker doesn't hydrate (e.g. the Atlas Maker's input/), so
    # it isn't on local disk. Pull it from R2 by basename into staging on demand.
    if root is not None and image_ref:
        try:
            r2_prefix = _ctx()["r2_prefix"]
        except Exception:  # noqa: BLE001
            r2_prefix = None
        if r2_prefix:
            base = Path(image_ref).name
            try:
                for entry in storage.list_keys(r2_prefix + "/"):
                    key = entry["key"]
                    if key.rsplit("/", 1)[-1] == base and key.lower().endswith((".png", ".webp")):
                        dest = root / key[len(r2_prefix) + 1:]
                        blob = storage.get(key)
                        if blob:
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            dest.write_bytes(blob)
                            return dest
            except OSError:
                pass
    return None


# ---------------------------------------------------------------------------
# generation-manifest support: gather a region's GENERATED cutout (in batch/)
# as a loose sprite. Ported self-contained from the Atlas Maker's batch_atlas
# (which imports ComfyUI deps we must not pull in) — the resolution priority
# here MUST mirror that tool's compose exactly so both pick the same variant.
# ---------------------------------------------------------------------------

def _variant_id(path: Path) -> str | None:
    """ComfyUI writes '<region>_<NNNNN>_.png'; region names can contain
    underscores, so match the final digit group, not split('_')[1]."""
    m = re.search(r"_(\d+)_?$", path.stem)
    return m.group(1) if m else None


def _variant_files(batch_dir: Path, name: str) -> list[Path]:
    """All variant PNGs for EXACTLY this region, sorted ascending by variant id.
    Require the region name to be followed immediately by the numeric variant
    id so region '10x' never picks up '10x_shine_*.png' (and since 's' > '0'
    those would otherwise sort last and steal 'latest').

    Ordered with `natural_key`, NOT lexicographically: callers take `files[-1]`
    as the latest variant, and a plain name sort puts `region_10_.png` before
    `region_9_.png` — so past nine renders 'latest' silently froze on variant 9
    while newer ones existed."""
    pat = re.compile(rf"^{re.escape(name)}_\d+_?\.png$", re.IGNORECASE)
    return sorted((p for p in batch_dir.glob(f"{name}_*.png") if pat.match(p.name)),
                  key=lambda p: natural_key(p.name))


def _seed_in_png(path: Path) -> int | None:
    """The ComfyUI KSampler seed embedded in a generated PNG's text metadata
    (info['prompt'] is a JSON workflow). Best-effort: None on any error."""
    try:
        prompt = Image.open(path).info.get("prompt")
        if not prompt:
            return None
        for node in json.loads(prompt).values():
            if node.get("class_type") == "KSampler":
                return node["inputs"].get("seed")
    except Exception:  # noqa: BLE001 — best-effort metadata read
        return None
    return None


def _override_image_path(region: dict, input_dir: Path) -> Path | None:
    """A region's user-supplied output image (output_override), if set+present.
    Absolute path, or relative to the project's input dir."""
    ov = region.get("output_override")
    if not ov:
        return None
    p = Path(ov) if Path(ov).is_absolute() else input_dir / ov
    return p if p.exists() else None


def _pick_variant_png(batch_dir: Path, region: dict) -> Path | None:
    """Pick a region's generated variant, mirroring the Atlas Maker's priority:
    1. the committed 'variant' id (authoritative — a locked seed is reused
       across renders so many variants share one seed);
    2. else the variant whose embedded KSampler seed matches a locked 'seed';
    3. else the latest — the HIGHEST-numbered variant (natural order, so v10
       beats v9; this was a lexical sort and froze on v9 past nine renders)."""
    files = _variant_files(batch_dir, region.get("name", ""))
    if not files:
        return None
    picked = str(region.get("variant", "")).strip()
    if picked:
        for p in files:
            if _variant_id(p) == picked:
                return p
    locked = region.get("seed")
    if locked is not None:
        try:
            locked_i = int(locked)
        except (TypeError, ValueError):
            locked_i = None
        if locked_i is not None:
            for p in files:
                if _seed_in_png(p) == locked_i:
                    return p
    return files[-1]


def _is_generation_manifest(path: Path, parsed: dict, raw: dict) -> bool:
    """True iff this is an Atlas-Maker GENERATION manifest: our AI manifest
    (has 'regions', not a TexturePacker 'frames' file, not a .atlas) whose
    atlas has no positive size AND no region has positive geometry — i.e.
    prompts exist but nothing has been packed yet."""
    if path.suffix.lower() == ".atlas":
        return False
    if "frames" in raw or "regions" not in raw:
        return False
    atlas = raw.get("atlas", {}) or {}
    if int(atlas.get("width", 0) or 0) > 0 and int(atlas.get("height", 0) or 0) > 0:
        return False
    for r in parsed.get("regions", []):
        if int(r.get("w", 0) or 0) > 0 and int(r.get("h", 0) or 0) > 0:
            return False
    return True


def _load_generation_manifest(path: Path, sheet: str, raw: dict) -> dict:
    """Gather each region's GENERATED cutout (already RMBG-transparent) from the
    project's batch/ pile as a LOOSE, unplaced sprite for the user to arrange."""
    ctx = _ctx()
    r2_prefix = ctx["r2_prefix"]
    staging_root = Path(ctx["staging_root"])
    input_dir = project_paths.resolve()["input_dir"]
    batch_dir = staging_root / "batch"

    # batch/ is heavy and not in the eager hydrate; pull it on this explicit
    # load so the variant globbing below sees the generated PNGs.
    if r2_prefix:
        try:
            storage.pull_prefix(f"{r2_prefix}/batch/", staging_root, f"{r2_prefix}/")
        except Exception:  # noqa: BLE001 — best-effort; glob what's local
            pass

    up = uploads_dir(sheet)
    regions_out = []
    written = []
    missing = []
    used = set()
    for region in raw.get("regions", []):
        name = region.get("name", "") or ""
        img = _override_image_path(region, input_dir) or _pick_variant_png(batch_dir, region)
        if img is None:
            missing.append(name or "(unnamed)")
            continue
        nm = safe_name(name, "region")
        base_nm = nm
        k = 2
        while nm in used:
            nm = f"{base_nm}_{k}"; k += 1
        used.add(nm)
        try:
            cutout = Image.open(img).convert("RGBA")
        except Exception:  # noqa: BLE001 — unreadable generated image
            missing.append(name or "(unnamed)")
            continue
        src = f"{nm}.png"
        cutout.save(up / src)
        written.append(up / src)
        regions_out.append({
            "src": src, "name": nm, "x": 0, "y": 0,
            "w": cutout.width, "h": cutout.height,
            "rotated": False, "locked": False,
            "prompt": region.get("prompt", ""),
            "shape_ref": region.get("shape_ref", ""),
            "seed": str(region.get("seed", "") or ""),
        })

    for p in written:
        _mirror(p)

    atlas = raw.get("atlas", {}) or {}
    canvas_w = int(atlas.get("width", 0) or 0) or 1024
    canvas_h = int(atlas.get("height", 0) or 0) or 1024
    name = path.name[len("atlas_manifest_"):-len(".json")] \
        if path.name.startswith("atlas_manifest_") else path.stem
    return {"sheet": sheet, "canvas_w": canvas_w, "canvas_h": canvas_h,
            "regions": regions_out, "count": len(regions_out),
            "skipped": [], "missing": missing, "packed": False,
            "source_path": str(path.resolve()), "source_dir": str(path.resolve().parent),
            "name": name, "is_project": True}


def _project_manifest_sheet(path: Path) -> str:
    """The sheet name when `path` is a sheet's canonical manifest
    (`manifests/atlas_manifest_<S>.json` in this project's staging), else "".
    Only that key is versioned; a manifest-shaped file anywhere else is a plain
    import and gets no version."""
    if not (path.name.startswith("atlas_manifest_") and path.suffix.lower() == ".json"):
        return ""
    name = path.name[len("atlas_manifest_"):-len(".json")]
    if not name or safe_name(name, "") != name:
        return ""
    try:
        if path.resolve().parent != Path(_ctx()["manifest_dir"]).resolve():
            return ""
    except (OSError, TypeError):
        return ""
    return name


def api_load(payload: dict) -> dict:
    """Load an existing coords file, slice its sheet into per-region PNGs in the
    uploads dir, and return canvas dims + region list for the editor."""
    sheet = safe_name(payload.get("sheet", "loaded"))
    raw_path = payload.get("path", "") or ""
    path = Path(raw_path)
    if not path.exists():
        # Not an already-hydrated local file → treat it as a project-relative R2
        # key (from import-mode browse). Fetch {r2_prefix}/<key> into staging so
        # the existing parse + _resolve_image flow runs against a real local
        # file. _resolve_image then pulls the page image from R2 by basename, so
        # a .atlas whose page (e.g. symbols3.png) was never hydrated still loads.
        rel = _safe_rel(raw_path)
        ctx = _ctx()
        r2_prefix, staging_root = ctx["r2_prefix"], ctx["staging_root"]
        fetched = None
        if rel and r2_prefix and staging_root:
            blob = storage.get(f"{r2_prefix}/{rel}")
            if blob is not None:
                dest = Path(staging_root) / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(blob)
                fetched = dest
        if fetched is None:
            return {"error": f"File not found: {raw_path}"}
        path = fetched
    # A project manifest is a versioned doc: bring staging up to R2's copy and
    # report WHICH version the page got, so a later in-place save can prove it
    # replaces exactly that one.
    version: dict = {}
    man_raw = None
    proj_sheet = _project_manifest_sheet(path)
    if proj_sheet:
        version, man_raw = _sync_manifest(proj_sheet)
    try:
        parsed = _parse_coords_file(path, man_raw)
    except (OSError, json.JSONDecodeError, ValueError) as e:
        return {"error": f"Could not parse {path.name}: {e}"}

    # A generation manifest (prompts, no geometry yet) gathers each region's
    # generated cutout as a loose sprite instead of slicing a packed sheet.
    if path.suffix.lower() == ".json":
        try:
            raw_manifest = json.loads(man_raw if man_raw is not None
                                      else path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw_manifest = {}
        if _is_generation_manifest(path, parsed, raw_manifest):
            return {**_load_generation_manifest(path, sheet, raw_manifest), **version}

    img_path = _resolve_image(path, parsed["image"])
    if img_path is None:
        return {"error": f"Could not locate the sheet image for {path.name} "
                f"(looked for {parsed['image'] or '?'} and siblings)."}

    up = uploads_dir(sheet)
    sheet_img = Image.open(img_path).convert("RGBA")
    regions_out = []
    used = set()
    written = []   # exactly the region PNGs sliced here → mirror only these
    skipped = []   # regions with no positive area (would crash PIL on save)
    for r in parsed["regions"]:
        w, h = r["w"], r["h"]
        fw, fh = (h, w) if r["rotated"] else (w, h)   # footprint on sheet
        # A zero/negative-area region produces an empty crop — PIL raises
        # "cannot write empty image" on save. Skip it (and clamp to the sheet
        # so an off-sheet box never yields an empty crop) rather than abort the
        # whole load over one bad region in the manifest.
        x0 = max(0, min(int(r["x"]), sheet_img.width))
        y0 = max(0, min(int(r["y"]), sheet_img.height))
        x1 = max(x0, min(r["x"] + fw, sheet_img.width))
        y1 = max(y0, min(r["y"] + fh, sheet_img.height))
        if w <= 0 or h <= 0 or x1 <= x0 or y1 <= y0:
            skipped.append(r["name"] or "(unnamed)")
            continue
        nm = safe_name(r["name"], "region")
        base_nm = nm
        k = 2
        while nm in used:
            nm = f"{base_nm}_{k}"; k += 1
        used.add(nm)
        crop = sheet_img.crop((x0, y0, x1, y1))
        if r["rotated"]:
            crop = crop.rotate(90, expand=True)        # back to upright
        src = f"{nm}.png"
        crop.save(up / src)
        written.append(up / src)
        regions_out.append({
            "src": src, "name": nm, "x": r["x"], "y": r["y"],
            "w": w, "h": h, "rotated": r["rotated"], "locked": False,
            "prompt": r["prompt"], "shape_ref": r["shape_ref"], "seed": r["seed"],
        })

    # Mirror exactly the files this load just sliced (not a whole-dir re-push):
    # the set is provably {up/<nm>.png for each region} written in the loop.
    for p in written:
        _mirror(p)
    is_project = path.name.startswith("atlas_manifest_") and path.suffix.lower() == ".json"
    if is_project:
        name = path.name[len("atlas_manifest_"):-len(".json")]
    else:
        name = path.stem
    return {"sheet": sheet, "canvas_w": parsed["width"], "canvas_h": parsed["height"],
            "regions": regions_out, "count": len(regions_out),
            "skipped": skipped,
            "source_path": str(path.resolve()), "source_dir": str(path.resolve().parent),
            "name": name, "is_project": is_project, **version}


def _recover_sheet_from_sprites(sheet: str) -> dict | None:
    """Recover a coords-less sheet from its loose sprite pile (sheet_src/<sheet>/).

    A sheet whose packed PNG was mirrored but whose coords were never written
    (e.g. an export with every format box unticked, pre-fix) shows in the rail
    yet has no manifest/.atlas/.json to load. Its ORIGINAL uploads are still in
    sheet_src/<sheet>/, so we rebuild them as UNPLACED regions for the user to
    auto-arrange and re-export (which now always writes the manifest). Returns
    None when there's nothing to recover, so the caller can fall back to the
    hard error."""
    up = uploads_dir(sheet)            # hydrates sheet_src/<sheet>/ from R2
    # Natural order, matching api_upload: a recovered sheet must rebuild its regions in the
    # same sequence the author originally uploaded, or a frame animation authored over it
    # silently scrambles on recovery.
    sprites = sorted((p for p in up.glob("*")
                      if p.suffix.lower() in (".png", ".webp")),
                     key=lambda p: natural_key(p.name))
    if not sprites:
        return None
    regions_out = []
    used_names: set[str] = set()
    for p in sprites:
        try:
            w, h = packer.measure(p)
        except Exception:  # noqa: BLE001 — skip an unreadable loose sprite
            continue
        nm = safe_name(p.stem, "region")
        base_nm = nm
        k = 2
        while nm in used_names:
            nm = f"{base_nm}_{k}"; k += 1
        used_names.add(nm)
        regions_out.append({
            "src": p.name, "name": nm, "x": 0, "y": 0,
            "w": w, "h": h, "iw": w, "ih": h, "ow": w, "oh": h,
            "rotated": False, "locked": False,
            "prompt": "", "shape_ref": "", "seed": "",
        })
    if not regions_out:
        return None
    cfg = load_config()
    return {"sheet": sheet,
            "canvas_w": int(cfg.get("width", 1024)),
            "canvas_h": int(cfg.get("height", 1024)),
            "regions": regions_out, "count": len(regions_out),
            "skipped": [], "missing": [], "packed": False, "recovered": True,
            "source_path": "", "source_dir": str(up.resolve()),
            "name": sheet, "is_project": False}


def api_load_sheet(payload: dict) -> dict:
    """Add sprites to an EXISTING sheet: load one of this project's saved
    sheets back into the editor so new uploads pack on top of it.

    Source of truth per piece:
      * loose sprites  -> sheet_src/<sheet>/ (the ORIGINAL uploads, untouched
        pixels — found via each region's manifest shape_ref, which
        build_manifest defaults to exactly that R2 key);
      * names + geometry + AI fields -> atlas_manifest_<sheet>.json in the
        shared manifests/ folder (fallback: the .atlas / TexturePacker JSON
        beside the packed PNG, which carry geometry but no AI fields);
      * any region whose loose sprite is gone -> re-sliced out of the packed
        sheet PNG (same crop/unrotate as api_load).

    Unlike api_load, the session keys on the sheet's OWN name: uploads
    accumulate into the same sheet_src/<sheet>/ pile and Save overwrites the
    sheet + its manifest in place, so the Atlas Maker handoff updates the same
    atlas_manifest_<sheet>.json."""
    sheet = safe_name(payload.get("sheet", ""), "")
    if not sheet:
        return {"error": "No sheet name given."}

    ctx = _ctx()
    # R2's manifest first, into staging: the coords this returns and the version
    # it reports must be the same bytes (see _sync_manifest).
    version, man_raw = _sync_manifest(sheet)
    # Look up the coords file against UNCREATED paths first: mkdir-ing before
    # this check would leave an empty sheets/<typo>/ behind that api_state then
    # lists in everyone's dropdown.
    out = project_paths.resolve()["output_root"] / sheet
    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out
    man_path = man_dir / f"atlas_manifest_{sheet}.json"
    coords = next((c for c in (man_path,
                               out / f"{sheet}.atlas",
                               out / f"{sheet}.json") if c.exists()), None)
    if coords is None:
        # No coords anywhere — but the rail listed this sheet because its packed
        # PNG (or a loose-sprite pile) exists in R2. Rather than a dead-end, try
        # to RECOVER it from the original loose sprites under sheet_src/<sheet>/
        # so the user can re-arrange + re-export (Export now always writes the
        # manifest, so re-exporting fully restores coords). Only when there's
        # genuinely nothing to recover do we surface the hard error.
        recovered = _recover_sheet_from_sprites(sheet)
        if recovered is not None:
            return {**recovered, **version}
        return {"error": f"Sheet '{sheet}' has no coords file — looked for "
                f"atlas_manifest_{sheet}.json (manifests/), {sheet}.atlas and "
                f"{sheet}.json (sheets/{sheet}/). Try ↻ Refresh from R2."}
    try:
        parsed = _parse_coords_file(coords, man_raw if coords == man_path else None)
    except (OSError, json.JSONDecodeError, ValueError) as e:
        return {"error": f"Could not parse {coords.name}: {e}"}
    up = uploads_dir(sheet)            # hydrates sheet_src/ lazily from R2
    out = output_dir(sheet)            # same path as above, now created

    # The packed page, for re-slicing regions whose loose sprite is gone.
    page_path: Path | None = out / f"{sheet}.png"
    if not page_path.exists():
        page_path = _resolve_image(coords, parsed.get("image", ""))
    page_img = None                    # opened lazily — only if a slice is needed

    # build_manifest defaults shape_ref to the region's loose sprite under this
    # exact prefix; a ref that still points there recovers the original file.
    input_prefix = f"{ctx['r2_prefix']}/sheet_src/{sheet}" if ctx["r2_prefix"] else ""

    regions_out, written, skipped, missing = [], [], [], []
    used_names: set[str] = set()
    used_srcs: set[str] = set()
    for r in parsed["regions"]:
        nm = safe_name(r["name"], "region")
        base_nm = nm
        k = 2
        while nm in used_names:
            nm = f"{base_nm}_{k}"; k += 1
        used_names.add(nm)

        # 1. the original loose sprite, via the manifest's shape_ref back-ref
        src = ""
        src_from_ref = False
        resliced = False
        ref = (r.get("shape_ref") or "").replace("\\", "/")
        ref_is_ours = bool(input_prefix) and ref.startswith(input_prefix + "/")
        if ref_is_ours:
            cand = ref[len(input_prefix) + 1:]
            if cand and "/" not in cand and (up / cand).exists():
                src = cand
                src_from_ref = True
        # 2. else by region name (the upload default: name == file stem)
        if not src:
            for ext in (".png", ".webp"):
                if (up / (nm + ext)).exists():
                    src = nm + ext
                    break
        if src and src in used_srcs:
            src = ""                   # two regions, one file → slice a copy
            src_from_ref = False
        w, h = int(r["w"]), int(r["h"])
        ow = oh = 0
        if src:
            try:
                ow, oh = packer.measure(up / src)
            except Exception:  # noqa: BLE001 — corrupt loose sprite; re-slice
                src = ""
                src_from_ref = False
        if not src:
            # 3. re-slice this region out of the packed sheet (api_load's crop:
            # clamp the rotated footprint to the page, skip zero-area regions).
            resliced = True
            if page_img is None:
                if page_path is None or not page_path.exists():
                    missing.append(r["name"] or "(unnamed)")
                    continue
                page_img = Image.open(page_path).convert("RGBA")
            fw, fh = (h, w) if r["rotated"] else (w, h)
            x0 = max(0, min(int(r["x"]), page_img.width))
            y0 = max(0, min(int(r["y"]), page_img.height))
            x1 = max(x0, min(int(r["x"]) + fw, page_img.width))
            y1 = max(y0, min(int(r["y"]) + fh, page_img.height))
            if w <= 0 or h <= 0 or x1 <= x0 or y1 <= y0:
                skipped.append(r["name"] or "(unnamed)")
                continue
            crop = page_img.crop((x0, y0, x1, y1))
            if r["rotated"]:
                crop = crop.rotate(90, expand=True)   # back to upright
            # Deterministic name: bump ONLY past files claimed by an earlier
            # region of THIS load; otherwise overwrite this slice's own prior
            # output (or the corrupt original) in place — bumping past every
            # existing file minted nm_2, nm_3, … (a new R2 object) per load.
            src = f"{nm}.png"
            i = 2
            while src in used_srcs:
                src = f"{nm}_{i}.png"; i += 1
            crop.save(up / src)
            written.append(up / src)
            ow, oh = crop.width, crop.height
        geom_ok = w > 0 and h > 0
        if not geom_ok:
            w, h = ow, oh              # broken geometry; the sprite itself is fine
        used_srcs.add(src)
        # A ref into this sheet's own sheet_src/ that did NOT yield the source
        # (missing / corrupt / shared → name-matched or re-sliced) is dangling:
        # build_manifest prefers any truthy shape_ref over the recomputed key,
        # so passing it through would persist the dead R2 key on Save. Blank it
        # so export recomputes from the new src; hand-set refs under OTHER
        # prefixes pass through untouched.
        shape_ref = r.get("shape_ref", "")
        if ref_is_ours and not src_from_ref:
            shape_ref = ""
        # Image draw size = the loose sprite's NATIVE size, fitted into the
        # region frame (aspect-preserved, shrink-only). The art keeps its
        # original size and is centred in the cell — never stretched to the
        # frame. A re-sliced sprite IS the padded cell already, so it fills it.
        if resliced or ow <= 0 or oh <= 0:
            iw, ih = w, h
        else:
            s = min(w / ow, h / oh, 1.0)
            iw = max(1, round(ow * s))
            ih = max(1, round(oh * s))
        regions_out.append({
            "src": src, "name": nm, "x": int(r["x"]), "y": int(r["y"]),
            "w": w, "h": h, "iw": iw, "ih": ih, "ow": ow, "oh": oh,
            # Loaded regions arrive LOCKED (when their geometry was sound) so
            # auto-arrange packs new uploads AROUND the existing layout instead
            # of reshuffling the whole sheet. Unlock per-sprite to repack.
            "rotated": bool(r["rotated"]), "locked": geom_ok,
            "prompt": r.get("prompt", ""), "shape_ref": shape_ref,
            "seed": r.get("seed", ""),
        })

    # Mirror exactly the sprites this load re-sliced (originals are already
    # in R2 — re-pushing the whole pile would be wasted writes).
    for p in written:
        _mirror(p)

    cfg = load_config()
    canvas_w = int(parsed.get("width") or 0) or int(cfg.get("width", 1024))
    canvas_h = int(parsed.get("height") or 0) or int(cfg.get("height", 1024))
    return {"sheet": sheet, "canvas_w": canvas_w, "canvas_h": canvas_h,
            "regions": regions_out, "count": len(regions_out),
            "skipped": skipped, "missing": missing,
            "source_path": str(coords.resolve()), "source_dir": str(out.resolve()),
            "name": sheet,
            "locked": _is_locked(sheet),
            "is_project": coords.name.startswith("atlas_manifest_"),
            **version}


# ---------------------------------------------------------------------------
# Verbatim .plist import
# ---------------------------------------------------------------------------



def api_import_plist(fields: dict, files: list) -> dict:
    """Claim the destination sheet for the whole import, then run it.

    A verbatim import is the user's only copy of those bytes — it is never
    re-derivable from anything else in staging."""
    name = _plist_sheet_name(fields, files)
    with (_sheet_guard(name),
          _claim_scope("sheets", name),
          _claim_scope("manifests", f"atlas_manifest_{name}.json" if name else "")):
        return _import_plist(fields, files)


def _import_plist(fields: dict, files: list) -> dict:
    """Import a pre-packed cocos2d atlas (`.plist` + its page) VERBATIM.

    The point is REUSE, not re-authoring: the page is written byte-for-byte and
    every rect is converted rather than repacked, so a game already bound to
    these coordinates keeps rendering. See plist_import.py for the two
    conversions that are easy to get wrong (rotated footprint, trim origin).

    `editable=1` opts into the lossy path instead — the frames are re-sliced
    into ordinary loose sprites and opened on the canvas, which drops per-frame
    trim offsets (the region model centres art in its cell and cannot express an
    off-centre offset). That sheet is NOT locked, because it is no longer the
    original atlas."""
    plist_file = next((f for f in files
                       if Path(f["filename"]).suffix.lower() == ".plist"), None)
    page_file = next((f for f in files
                      if Path(f["filename"]).suffix.lower() in _PAGE_EXTS), None)
    if plist_file is None or page_file is None:
        return {"error": "Pick exactly two files: the .plist and its .png/.webp page."}
    if len(files) != 2:
        return {"error": f"Expected exactly two files (.plist + its page), got "
                f"{len(files)}: " + ", ".join(f["filename"] for f in files)}

    sheet = _plist_sheet_name(fields, files)
    editable = str(fields.get("editable", "0")).strip().lower() not in ("", "0", "false")
    lock = str(fields.get("lock", "1")).strip().lower() not in ("0", "false")
    if editable:
        # An editable import has already lost the verbatim guarantee, so locking
        # it would protect coordinates that are about to be re-packed anyway.
        lock = False

    # parse_plist takes a path; stage the upload, parse, then drop it — the
    # `.plist` itself is not part of the project (the JSON + manifest replace it).
    tmp_dir = Path(project_paths.resolve()["staging_root"]) / "_import_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_plist = tmp_dir / safe_name(Path(plist_file["filename"]).name, "import.plist")
    try:
        tmp_plist.write_bytes(plist_file["data"])
        parsed = plist_import.parse_plist(tmp_plist)
    except plist_import.PlistImportError as e:
        # Verbatim message — it already names the unsupported format and the fix.
        return {"error": str(e)}
    finally:
        tmp_plist.unlink(missing_ok=True)

    warnings: list[str] = []
    try:
        with Image.open(io.BytesIO(page_file["data"])) as im:
            page_w, page_h = im.size
    except Exception as e:  # noqa: BLE001 — bad page upload, report it
        return {"error": f"{page_file['filename']}: not a readable image ({e})"}
    if not parsed["width"] or not parsed["height"]:
        # No `metadata.size` — trust the actual page so validate() can still
        # bounds-check the rects.
        parsed["width"], parsed["height"] = page_w, page_h
    elif (parsed["width"], parsed["height"]) != (page_w, page_h):
        warnings.append(
            f"The plist declares a {parsed['width']}x{parsed['height']} page but "
            f"{page_file['filename']} is {page_w}x{page_h} — check you paired the "
            "right two files.")

    problems = plist_import.validate(parsed)
    if problems:
        # Overlapping rects mean the geometry decoded WRONG. Importing anyway
        # would ship an atlas that renders as sliced-up garbage and reads as bad
        # art rather than a bad import, so refuse while the message can say so.
        return {"error": "Refusing to import — the geometry doesn't check out "
                "against its own page, so the rects are probably being misread: "
                + "; ".join(problems[:6])
                + ("…" if len(problems) > 6 else "")}

    frames = parsed["frames"]
    if not frames:
        return {"error": "That plist has no frames."}
    sequences = plist_import.detect_sequences([f["name"] for f in frames])

    # An import CREATES a sheet under this name: over one that exists it is
    # refused (naming who saved it) until the page re-sends the version it was
    # shown as `base_etag` — never a blind replace of somebody's sheet.
    read_etag, refusal = _check_base(sheet, fields.get("base_etag"))
    if refusal:
        return refusal

    # --- write the page BYTE-FOR-BYTE ----------------------------------------
    # Stored verbatim, rotated frames and all. cocos2d packs a rotated frame in the SAME
    # direction PIXI un-rotates it (both are the TexturePacker convention), so the runtime
    # renders a rotated frame correctly straight from the untouched page. An earlier version
    # flipped each rotated block 180° to satisfy the tool PREVIEW (whose RegionThumb un-rotates
    # the OTHER way, matching the Sheet Maker's own packer) — but that broke the GAME, which
    # showed rotated frames upside down. The preview is reconciled instead: `loadRegionSet` marks
    # a plist import so RegionThumb un-rotates it the TexturePacker way. So: never re-encode here,
    # and the "reuse the atlas exactly as is" promise holds for rotated frames too.
    ext = Path(page_file["filename"]).suffix.lower()
    out = output_dir(sheet)
    page_path = out / f"{sheet}{ext}"
    page_path.write_bytes(page_file["data"])
    staged = [page_path]         # pushed only once the manifest lands (see _export)
    written = [str(page_path)]

    # --- TexturePacker JSON: the coords file the rest of the pipeline reads --
    # `meta.image` must name the page as WE stored it, not the original
    # textureFileName, or the coords point at a file that isn't here.
    original_image = parsed.get("image", "")
    parsed["image"] = page_path.name
    json_path = out / f"{sheet}.json"
    json_path.write_text(
        json.dumps(plist_import.to_texturepacker(parsed), indent=2), encoding="utf-8")
    staged.append(json_path)
    written.append(str(json_path))

    # --- the AI manifest, in exactly build_manifest's shape ------------------
    ctx = _ctx()
    r2_prefix = ctx["r2_prefix"]
    try:
        out_rel = out.resolve().relative_to(
            Path(project_paths.resolve()["staging_root"]).resolve()).as_posix()
    except ValueError:
        out_rel = f"sheets/{sheet}"
    export_prefix = f"{r2_prefix}/{out_rel}" if r2_prefix else ""
    source_image_key = f"{export_prefix}/{page_path.name}" if export_prefix else ""
    tp_json_key = f"{export_prefix}/{json_path.name}" if export_prefix else ""
    # Carry the TRIM through: `w/h` is the tight packed rect, but a trimmed frame sits inside a
    # larger `orig_w × orig_h` canvas at `off_x/off_y`, and WITHOUT that every renderer scales the
    # tight rect to fill its box independently so the art pulses. build_manifest emits these as
    # offX/offY/origW/origH, which the launcher's parseRegions reads. (parse_plist already y-flips
    # the cocos centre-origin offset into top-left space.)
    man_regions = [{"name": f["name"], "x": f["x"], "y": f["y"],
                    "w": f["w"], "h": f["h"], "rotated": f["rotated"],
                    "off_x": f["trim_x"], "off_y": f["trim_y"],
                    "orig_w": f["source_w"], "orig_h": f["source_h"]}
                   for f in frames]
    manifest = atlas_writers.build_manifest(
        sheet_image=str(page_path), width=parsed["width"], height=parsed["height"],
        regions=man_regions, deploy_basename=sheet,
        export_prefix=export_prefix,
        source_image_path=source_image_key,
        texturepacker_json=tp_json_key)
    manifest["locked"] = bool(lock)
    manifest["import"] = {"kind": "plist",
                          "source": Path(plist_file["filename"]).name,
                          "verbatim": True}
    # The hint the /flipbook tool reads to offer "create clip from sequence".
    # Recorded, not acted on, here.
    manifest["sequences"] = sequences
    if original_image and original_image != page_path.name:
        manifest["import"]["original_image"] = original_image
    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out
    man_dir.mkdir(parents=True, exist_ok=True)
    mp = man_dir / f"atlas_manifest_{sheet}.json"
    saved_by = docsave.stamp(manifest, _identity(), "sheet")
    # As in `_export`: the page and JSON reach R2 only after the manifest lands,
    # so a refusal (any other writer of this key) leaves R2's files untouched.
    new_etag, refusal = _write_manifest_cas(sheet, manifest, read_etag)
    if refusal:
        _unstage(staged)
        return refusal
    for p in staged:
        _mirror(p)
    written.append(str(mp))

    if editable:
        warnings.append(
            "Editable import: per-frame TRIM OFFSETS are LOST. The editor centres "
            "each sprite in its cell and cannot represent an off-centre offset, so "
            "art that scales frame-to-frame will jitter. Saving re-packs the page — "
            "the original coordinates do not survive.")
        # Re-slice the frames into ordinary loose sprites and open them on the
        # canvas. api_load_sheet already does exactly this (crop the packed
        # rect, un-rotate, fall back to the page when no loose sprite exists),
        # so reuse it rather than duplicating the crop maths.
        loaded = api_load_sheet({"sheet": sheet})
        if loaded.get("error"):
            warnings.append("Could not open it in the editor: " + loaded["error"])
        else:
            api_session({
                "sheet": sheet, "display_name": sheet, "active_sheet": sheet,
                "canvas_w": loaded.get("canvas_w", parsed["width"]),
                "canvas_h": loaded.get("canvas_h", parsed["height"]),
                # allow_rotation is FALSE here even though the imported sheet had rotated
                # frames, and that is the point: `api_load_sheet` above just UN-ROTATED every
                # frame into an upright loose sprite, so arming rotation would immediately
                # re-rotate art we had just normalised — silently re-importing the one thing
                # that makes atlases ambiguous.
                #
                # A rotated region is the only place PixiJS and rig disagree: our packers
                # store it 90 CW (the TexturePacker/Pixi convention, proven by
                # atlas-tool/_rot_roundtrip_check.py), while rig's parser wants CCW, so a
                # rotated region only renders upright in a rig once its page pixels are
                # reoriented 180 (`reorientRotatedRegionsForRig` in the launcher). Nothing
                # rotated means nothing to disagree about.
                #
                # This matches the pipeline default everywhere else (`packer.pack` /
                # `pack.arrange` default allow_rotation=False; Atlas Maker's auto-pack passes
                # False explicitly). The UI checkbox stays available for an artist who needs
                # the packing density and accepts the reorient round-trip — it just is not
                # switched on behind their back by an import.
                "padding": 2, "allow_rotation": False,
                "loaded": {"path": loaded.get("source_path"),
                           "dir": loaded.get("source_dir"),
                           "name": sheet, "is_project": True,
                           "etag": loaded.get("etag", "")},
                "regions": loaded.get("regions") or [],
            })

    return {"sheet": sheet,
            "frames": len(frames),
            "rotated": sum(1 for f in frames if f["rotated"]),
            "sequences": sequences,
            "locked": bool(lock),
            "editable": editable,
            "warnings": warnings,
            "written": written,
            "page": str(page_path),
            "etag": docsave.norm_etag(new_etag), "saved_by": saved_by}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def status_for(result) -> int:
    """409 for a refused compare-and-swap save (the body is the conflict payload
    the page words its prompt from), 200 for everything else — handler errors
    stay 200 + `{"error"}`, which is what the page already reads."""
    return 409 if isinstance(result, dict) and result.get("conflict") is True else 200


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quieter console
        pass

    def _authenticate(self) -> bool:
        """Who is calling and for which (client, project) — see
        iw_common/launch.py. Answers the request itself and returns False on a
        refusal, and on a launch (the redirect that takes the token out of the
        URL once the session cookie is set)."""
        res = GATE.authenticate(self.path, self.headers)
        self._identity = res.identity
        self._extra_cookies = list(res.cookies)
        if not res.ok:
            self._send_bytes("Forbidden — open the Sheet Maker from the launcher."
                             .encode("utf-8"), "text/plain; charset=utf-8", 403)
            return False
        if res.redirect and self.command == "GET":
            self._send_bytes(b"", "text/plain", 303, {"Location": res.redirect})
            return False
        return True

    def _reply(self, result) -> None:
        self._send_json(result, status_for(result))

    def _send_json(self, obj, code=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self._apply_cookie()
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, data: bytes, ctype: str, code=200,
                    extra_headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        # Default to no-store (HTML/JSON/dynamic). Image routes pass their own
        # Cache-Control (via imgcache.cache_headers) for ETag revalidation — let
        # that win instead of emitting an uncacheable no-store alongside it.
        headers = extra_headers or {}
        if "Cache-Control" not in headers:
            self.send_header("Cache-Control", "no-store")
        for k, v in headers.items():
            self.send_header(k, v)
        self._apply_cookie()
        self.end_headers()
        self.wfile.write(data)

    def _serve_sprite(self, p: Path, ctype: str):
        """Serve a sprite file with ETag-based revalidation. Uses `max-age=0,
        must-revalidate` so the browser ALWAYS revalidates before reusing a
        cached copy: a re-uploaded sprite (same URL, new pixels → new mtime/size
        → new ETag) is fetched fresh (200), while an unchanged one stays a cheap
        stat-only 304. Without max-age=0 the browser would keep serving the stale
        cached image for the whole max-age window after a re-upload — the bug
        where a recoloured sprite kept showing its old version."""
        etag = imgcache.etag_for_path(p)
        inm = self.headers.get("If-None-Match")
        if etag and imgcache.not_modified(inm, etag):
            self._send_bytes(b"", ctype, 304, imgcache.cache_headers(etag, max_age=0))
            return
        self._send_bytes(p.read_bytes(), ctype, 200, imgcache.cache_headers(etag, max_age=0))

    def _apply_cookie(self):
        # The gate's Set-Cookie headers (session, or the legacy scope cookies).
        for c in getattr(self, "_extra_cookies", None) or ():
            self.send_header("Set-Cookie", c)

    def _resolve_context(self) -> None:
        """Apply the caller's (client, project) to THIS request thread.

        With a signed launch the scope comes from the token/session ONLY — a
        `?client=` / `?project=` in the URL is ignored, and switching project
        goes back through the launcher. The legacy/open modes keep the old
        query-then-cookie resolution (done in the gate). Missing keys fall back
        to the env default (`SHEET_CLIENT` / `SHEET_PROJECT`).

        Thread-local: a concurrent request for a different project is fully
        isolated — every handler reads paths via _ctx() at call time."""
        project_paths.switch_context(self._identity.client, self._identity.project)

    # Back-compat alias — kept so any legacy in-process call still works.
    def _resolve_project(self) -> None:
        self._resolve_context()

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == "/healthz":
            # Gate-exempt liveness for the uptime monitor; names nothing private.
            self._send_bytes(launch.healthz_body("sheet-tool", BUILD), "application/json")
            return
        if not self._authenticate():
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        q = urllib.parse.parse_qs(parsed.query)
        if path == "/" and q.get("fast", ["0"])[0] != "1":
            # First visit: serve the CRT splash BEFORE _resolve_context() —
            # a cold switch_context() hydrates the whole sheets/ tree from R2
            # and would block the first byte for seconds (blank tab). The
            # splash JS background-fetches `?fast=1` built from this URL's
            # query, so the client/project params + cookies ride along and
            # context resolution/hydration happen on THAT request while the
            # splash types. history.replaceState keeps fast=1 afterwards, so
            # in-UI location.reload() skips straight to the real page.
            self._send_bytes(SPLASH.encode("utf-8"), "text/html; charset=utf-8")
            return
        self._resolve_context()
        if path == "/":
            self._send_bytes(_page().encode("utf-8"), "text/html; charset=utf-8")
            return
        if path == "/api/state":
            self._send_json(api_state())
            return
        if path == "/api/sprite":
            sheet = safe_name((q.get("sheet") or [""])[0])
            fn = safe_name((q.get("file") or [""])[0], "")
            p = uploads_dir(sheet) / fn
            if fn and p.exists():
                ctype = "image/webp" if p.suffix.lower() == ".webp" else "image/png"
                self._serve_sprite(p, ctype)
            else:
                self._send_bytes(b"", "image/png", 404)
            return
        if path == "/api/browse":
            self._send_json(api_browse((q.get("path") or [""])[0],
                                       (q.get("mode") or [""])[0]))
            return
        if path in ("/logo", "/favicon.ico"):
            self._serve_logo()
            return
        self._send_bytes(b"Not found", "text/plain", 404)

    def _serve_logo(self):
        p = SELF / "iw-emblem.svg"
        if p.exists():
            self._send_bytes(p.read_bytes(), "image/svg+xml")
        else:
            self._send_bytes(b"", "image/svg+xml", 404)

    def do_POST(self):
        if not self._authenticate():
            return
        self._resolve_context()
        # Who a save is stamped with (`saved_by`) — read by the handlers below.
        set_request_identity(self._identity)
        path = urllib.parse.urlparse(self.path).path
        ctype = self.headers.get("Content-Type", "")
        try:
            if path == "/api/upload":
                fields, files = parse_multipart(self._body(), ctype)
                self._send_json(api_upload(fields, files))
                return
            if path == "/api/import-plist":
                fields, files = parse_multipart(self._body(), ctype)
                self._reply(api_import_plist(fields, files))
                return
            payload = {}
            raw = self._body()
            if raw:
                payload = json.loads(raw.decode("utf-8"))
            if path == "/api/arrange":
                self._send_json(api_arrange(payload))
            elif path == "/api/fx-sync":
                self._send_json(api_fx_sync(payload))
            elif path == "/api/export":
                self._reply(api_export(payload))
            elif path == "/api/load":
                self._send_json(api_load(payload))
            elif path == "/api/load-sheet":
                self._send_json(api_load_sheet(payload))
            elif path == "/api/rename-sheet":
                self._reply(api_rename_sheet(payload))
            elif path == "/api/unlock-sheet":
                self._reply(api_unlock_sheet(payload))
            elif path == "/api/rescale-sheet":
                self._send_json(api_rescale_sheet(payload))
            elif path == "/api/delete-sheet":
                self._send_json(api_delete_sheet(payload))
            elif path == "/api/session":
                self._send_json(api_session(payload))
            elif path == "/presence":
                self._send_json(api_presence(payload))
            elif path == "/api/set-project":
                self._send_json(api_set_project(payload))
            elif path == "/api/refresh":
                self._send_json(api_refresh())
            elif path == "/api/clearcache":
                self._send_json(api_clearcache())
            else:
                self._send_bytes(b"Not found", "text/plain", 404)
        except Exception as e:  # noqa: BLE001 — surface errors to the UI
            errors.capture_request_error(self, e)
            self._send_json({"error": f"{type(e).__name__}: {e}"}, 500)


def _page() -> str:
    """Serve the UI from ui.html each request so edits show on reload, with the
    shared "X is editing this sheet" heartbeat inlined."""
    return (SELF / "ui.html").read_text(encoding="utf-8").replace(
        "/*__IW_PRESENCE_JS__*/", presence.script("sheet"))


class _Server(errors.ReportingServerMixin, ThreadingHTTPServer):
    """Reports what socketserver would only print: a GET that raises, or a POST
    that fails before its own catch (the gate, the context resolve)."""


def main():
    from iw_banner import print_banner
    print_banner("Sheet Maker", BUILD,
                 footer=f"http://{HOST}:{PORT}   ·   Ctrl+C to stop")
    errors.init_error_tracking("sheet-tool")
    print(GATE.describe(), flush=True)
    srv = _Server((HOST, PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
