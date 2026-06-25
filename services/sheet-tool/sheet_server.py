"""
Invisible Sheet Maker — web UI (by Invisible Wall SL), cloud re-host.

Pack loose sprite PNGs into one sheet, edit region names + per-region AI fields,
then export any of: a libGDX/Spine `.atlas`, a TexturePacker JSON, and the
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

import json
import os
import re
import shutil
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cloud_paths as project_paths  # noqa: E402
import packer              # noqa: E402
import atlas_writers       # noqa: E402
import storage             # noqa: E402  (R2 object storage + staging mirror)
from iw_common.splash import splash_html  # noqa: E402  (shared CRT boot splash)
from iw_common import imgcache  # noqa: E402  (ETag/304 cache headers for images)

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

# Shared-secret access gate (the tool runs behind the launcher). Unset = open.
SHEET_TOOL_SECRET = os.environ.get("SHEET_TOOL_SECRET", "")


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
                        "unplaced")


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


def safe_name(s: str, default: str = "sheet") -> str:
    s = _SAFE.sub("_", (s or "").strip()).strip("_.")
    return s or default


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


def output_dir(sheet: str) -> Path:
    pp = project_paths.resolve()
    d = pp["output_root"] / safe_name(sheet)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _dest_output_dir(sheet: str, dest_dir: str) -> Path:
    """Resolve the export destination. Empty `dest_dir` -> the sheet's default
    output dir. Otherwise resolve the requested dir and CONFINE it to the
    `sheets/` subtree of the staging root — anything else (e.g. a `loadedDir`
    that points at `manifests/` after opening a sheet via its manifest) falls
    back to the default output dir, so the page/.atlas/json always land at the
    canonical keys the manifest back-references. Created if missing."""
    if not dest_dir:
        return output_dir(sheet)
    root = Path(project_paths.resolve()["staging_root"]).resolve()
    sheets_root = (root / "sheets").resolve()
    try:
        d = Path(dest_dir).resolve()
    except (OSError, ValueError):
        return output_dir(sheet)
    if sheets_root not in d.parents and d != sheets_root:
        return output_dir(sheet)
    d.mkdir(parents=True, exist_ok=True)
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
    to whatever is on disk."""
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
        "project_locked": bool((os.environ.get("IW_PROJECT_NAME") or "").strip()),
        # In the cloud the Atlas Maker shares this project's R2 tree; manifests
        # land in the shared manifests/ folder both tools read.
        "atlas_maker_found": bool(_ctx()["r2_prefix"]),
        "sheets": sheets,
        "session": session,
        "defaults": {
            "canvas_w": cfg.get("width", 1024),
            "canvas_h": cfg.get("height", 1024),
            "padding": cfg.get("padding", 2),
            "allow_rotation": cfg.get("allow_rotation", False),
        },
    }


def api_upload(fields: dict, files: list) -> dict:
    sheet = safe_name(fields.get("sheet", "sheet"))
    d = uploads_dir(sheet)
    saved = []
    for f in files:
        fn = safe_name(Path(f["filename"]).name, "sprite.png")
        if not fn.lower().endswith((".png", ".webp")):
            fn += ".png"
        dst = d / fn
        dst.write_bytes(f["data"])
        try:
            w, h = packer.measure(dst)
        except Exception as e:  # noqa: BLE001 — bad image upload, report it
            dst.unlink(missing_ok=True)
            return {"error": f"{fn}: not a readable image ({e})"}
        _mirror(dst)
        saved.append({"file": fn, "w": w, "h": h})
    # Full current sprite list for the sheet (so re-uploads accumulate).
    sprites = []
    for p in sorted(d.glob("*")):
        if p.suffix.lower() in (".png", ".webp"):
            w, h = packer.measure(p)
            sprites.append({"file": p.name, "w": w, "h": h})
    return {"sheet": sheet, "saved": saved, "sprites": sprites}


def api_arrange(payload: dict) -> dict:
    """Free-canvas auto-arrange: pack only the UNLOCKED sprites into the space
    left by the locked ones, inside a fixed canvas. Identity is the uploaded
    filename (`src`); display names are tracked client-side."""
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


def api_export(payload: dict) -> dict:
    """Compose the sheet from the client's current canvas geometry and write
    the selected formats. Stateless: geometry comes entirely from the payload."""
    sheet = safe_name(payload.get("sheet", "sheet"))
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
        })
    if not regions:
        return {"error": "Nothing to export — add some sprites first."}

    names = [r["name"] for r in regions]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        return {"error": f"Duplicate region names: {', '.join(dupes)}. Names must be unique."}

    out = _dest_output_dir(sheet, dest_dir)
    image_for = {r["name"]: (up / r["src"]) for r in regions}
    sheet_img = packer.compose(regions, width, height, image_for)
    sheet_png = out / f"{basename}.png"
    sheet_img.save(sheet_png)
    _mirror(sheet_png)
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
        _mirror(ap)
        written.append(str(ap))
        if export_prefix:
            atlas_file_key = f"{export_prefix}/{ap.name}"
    tp_json_key = ""
    if fmts.get("texturepacker"):
        jp = out / f"{basename}.json"
        atlas_writers.write_texturepacker_json(jp, sheet_png.name, width, height, regions)
        _mirror(jp)
        written.append(str(jp))
        if export_prefix:
            tp_json_key = f"{export_prefix}/{jp.name}"

    manifest_note = ""
    if fmts.get("manifest"):
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
        atlas_writers.write_manifest(mp, manifest)
        _mirror(mp)
        written.append(str(mp))
        manifest_note = (f"Manifest saved to the shared project folder -> {man_name}. "
                         "The Atlas Maker lists it after a Refresh (or restart).")

    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out
    manifest_path = str(man_dir / f"atlas_manifest_{basename}.json")
    return {"written": written, "manifest_note": manifest_note,
            "output_dir": str(out), "dir": str(out),
            "manifest_path": manifest_path, "name": basename}


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


def _patch_session_for_rename(old: str, new: str) -> None:
    """If the persisted editor session points at the renamed sheet, follow the
    rename so a later Refresh restores the new identity (best-effort)."""
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


def api_rename_sheet(payload: dict) -> dict:
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

    # 3. manifest: rewrite the baked back-refs, write it under the new name.
    if old_man.exists():
        try:
            man = json.loads(old_man.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError) as e:
            return {"error": f"Could not read the manifest to rename it: {e}"}
        if isinstance(man, dict):
            _rewrite_manifest_refs(man, old, new)
        new_man.write_text(json.dumps(man, indent=2, ensure_ascii=False), encoding="utf-8")
        _mirror(new_man)

    # 4. follow the rename in the persisted editor session (best-effort).
    _patch_session_for_rename(old, new)

    # 5. delete the OLD keys LAST — R2 (source of truth) then local staging.
    if r2_prefix:
        for pre in (f"{r2_prefix}/sheets/{old}/", f"{r2_prefix}/sheet_src/{old}/"):
            for obj in storage.list_keys(pre):
                storage.delete(obj["key"])
        storage.delete(f"{r2_prefix}/manifests/atlas_manifest_{old}.json")
    shutil.rmtree(old_out, ignore_errors=True)
    shutil.rmtree(old_src, ignore_errors=True)
    old_man.unlink(missing_ok=True)

    sheets = sorted(p.name for p in out_root.iterdir() if p.is_dir()) \
        if out_root.exists() else []
    return {"ok": True, "from": old, "to": new, "sheets": sheets,
            "note": f'Renamed "{old}" → "{new}".'}


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


def api_delete_sheet(payload: dict) -> dict:
    """Delete a saved sheet end-to-end. Mirrors api_rename_sheet's identity
    model: a sheet's bytes live in FOUR R2/staging locations —
    `sheets/<sheet>/<sheet>.{png,atlas,json}`, `sheet_src/<sheet>/*`, and
    `manifests/atlas_manifest_<sheet>.json`. This removes every object under
    those keys from R2 (the source of truth) AND the local staging copies.

    A partially-created / corrupted sheet may have NO objects at all (named in
    the editor but never exported, so nothing was ever flushed to R2). It is
    still removable: we always best-effort delete every candidate key/dir and
    clear any stale session pointer, then return the fresh sheet list. So the
    button works even when there is nothing on disk to remove."""
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

    # 1. R2 (source of truth) FIRST — prefix-list + delete the packed sheet and
    # loose-sprite trees, plus the shared manifest. Empty prefixes just yield no
    # keys, so a corrupted no-objects sheet is a clean no-op here.
    if r2_prefix:
        for pre in (f"{r2_prefix}/sheets/{sheet}/", f"{r2_prefix}/sheet_src/{sheet}/"):
            try:
                for obj in storage.list_keys(pre):
                    storage.delete(obj["key"])
            except Exception:  # noqa: BLE001 — transient R2 issue, keep going
                pass
        try:
            storage.delete(f"{r2_prefix}/manifests/atlas_manifest_{sheet}.json")
        except Exception:  # noqa: BLE001
            pass

    # 2. Local staging copies.
    shutil.rmtree(out, ignore_errors=True)
    shutil.rmtree(src, ignore_errors=True)
    man.unlink(missing_ok=True)

    # 3. If the deleted sheet was the persisted/open one, clear the session so a
    # refresh / restart doesn't restore a canvas pointing at the dead pile.
    _clear_session_if_sheet(sheet)

    sheets = sorted(p.name for p in out_root.iterdir() if p.is_dir()) \
        if out_root.exists() else []
    return {"ok": True, "deleted": sheet, "sheets": sheets,
            "note": f'Deleted "{sheet}".'}


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
    spine sheets under input/originals/spines/<name>/ are reachable; there `path`
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

def _parse_coords_file(path: Path) -> dict:
    """Return {image, width, height, regions:[{name,x,y,w,h,rotated,prompt,shape_ref,seed}]}.
    Supports our AI manifest, TexturePacker JSON, and libGDX/Spine .atlas."""
    suffix = path.suffix.lower()
    if suffix == ".atlas":
        return _parse_libgdx(path)
    data = json.loads(path.read_text(encoding="utf-8"))
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
    """All variant PNGs for EXACTLY this region, sorted ascending by name.
    Require the region name to be followed immediately by the numeric variant
    id so region '10x' never picks up '10x_shine_*.png' (and since 's' > '0'
    those would otherwise sort last and steal 'latest')."""
    pat = re.compile(rf"^{re.escape(name)}_\d+_?\.png$", re.IGNORECASE)
    return sorted((p for p in batch_dir.glob(f"{name}_*.png") if pat.match(p.name)),
                  key=lambda p: p.name)


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
    3. else the latest (lexically-last) variant."""
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
    try:
        parsed = _parse_coords_file(path)
    except (OSError, json.JSONDecodeError, ValueError) as e:
        return {"error": f"Could not parse {path.name}: {e}"}

    # A generation manifest (prompts, no geometry yet) gathers each region's
    # generated cutout as a loose sprite instead of slicing a packed sheet.
    if path.suffix.lower() == ".json":
        try:
            raw_manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw_manifest = {}
        if _is_generation_manifest(path, parsed, raw_manifest):
            return _load_generation_manifest(path, sheet, raw_manifest)

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
            "name": name, "is_project": is_project}


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
    # Look up the coords file against UNCREATED paths first: mkdir-ing before
    # this check would leave an empty sheets/<typo>/ behind that api_state then
    # lists in everyone's dropdown.
    out = project_paths.resolve()["output_root"] / sheet
    man_dir = Path(ctx["manifest_dir"]) if ctx.get("manifest_dir") else out
    coords = next((c for c in (man_dir / f"atlas_manifest_{sheet}.json",
                               out / f"{sheet}.atlas",
                               out / f"{sheet}.json") if c.exists()), None)
    if coords is None:
        return {"error": f"Sheet '{sheet}' has no coords file — looked for "
                f"atlas_manifest_{sheet}.json (manifests/), {sheet}.atlas and "
                f"{sheet}.json (sheets/{sheet}/). Try ↻ Refresh from R2."}
    try:
        parsed = _parse_coords_file(coords)
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
            "is_project": coords.name.startswith("atlas_manifest_")}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quieter console
        pass

    def _gate(self) -> tuple[bool, dict | None]:
        """Shared-secret access gate (the tool sits behind the launcher).
        Open when SHEET_TOOL_SECRET is unset. Accepts the secret via cookie,
        `X-Sheet-Secret` header, or `?k=` query (which also sets the cookie so
        later asset/fetch requests pass)."""
        if not SHEET_TOOL_SECRET:
            return True, None
        cookie = self.headers.get("Cookie", "") or ""
        if f"sheet_tool={SHEET_TOOL_SECRET}" in cookie:
            return True, None
        if self.headers.get("X-Sheet-Secret") == SHEET_TOOL_SECRET:
            return True, None
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if q.get("k", [""])[0] == SHEET_TOOL_SECRET:
            return True, {
                "Set-Cookie": f"sheet_tool={SHEET_TOOL_SECRET}; Path=/; "
                              f"HttpOnly; SameSite=None; Secure"
            }
        return False, None

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
        cookie = getattr(self, "_set_cookie", None)
        if cookie:
            for k, v in cookie.items():
                self.send_header(k, v)
        # Additional Set-Cookie headers (a dict can't hold two) — e.g. the
        # project cookie set alongside the gate's secret cookie.
        for c in getattr(self, "_extra_cookies", None) or ():
            self.send_header("Set-Cookie", c)

    def _resolve_context(self) -> None:
        """Pick + apply the (client, project) for THIS request.

        Resolution order for EACH key (independently):
          1. `?client=` / `?project=` query param (slug-validated)
          2. `iw_client` / `iw_project` cookie
          3. env default (`SHEET_CLIENT` / `SHEET_PROJECT`)

        A valid query param sticks into the matching cookie so in-tool
        navigation (which drops the param) stays in the same context. Legacy
        single-`?project=` requests fall back to the env-default client.

        The chosen context is set on THIS request thread (thread-local), so a
        concurrent request for a different project is fully isolated — no shared
        module state, no lock needed."""
        self._extra_cookies = []
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        p_param = (q.get("project", [""])[0] or "").strip()
        c_param = (q.get("client", [""])[0] or "").strip()
        cookie = self.headers.get("Cookie", "") or ""
        mp = re.search(r"iw_project=([^;]+)", cookie)
        mc = re.search(r"iw_client=([^;]+)", cookie)
        cookie_project = (mp.group(1).strip() if mp else "")
        cookie_client = (mc.group(1).strip() if mc else "")

        chosen_project = (project_paths.valid_project(p_param)
                          or project_paths.valid_project(cookie_project)
                          or project_paths.env_project())
        chosen_client = (project_paths.valid_client(c_param)
                         or project_paths.valid_client(cookie_client)
                         or project_paths.env_client())

        if p_param:
            self._extra_cookies.append(
                f"iw_project={chosen_project}; Path=/; SameSite=None; Secure")
        if c_param:
            self._extra_cookies.append(
                f"iw_client={chosen_client}; Path=/; SameSite=None; Secure")

        # Thread-local context: switch_context writes THIS request thread's
        # state and (on a real switch) hydrates its staging. No global lock and
        # no module-global copy — every handler reads paths via _ctx() at call
        # time, so concurrent requests for different projects can't interfere.
        project_paths.switch_context(chosen_client, chosen_project)

    # Back-compat alias — kept so any legacy in-process call still works.
    def _resolve_project(self) -> None:
        self._resolve_context()

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        ok, self._set_cookie = self._gate()
        if not ok:
            self._send_bytes(b"forbidden", "text/plain", 403)
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
        ok, self._set_cookie = self._gate()
        if not ok:
            self._send_bytes(b"forbidden", "text/plain", 403)
            return
        self._resolve_context()
        path = urllib.parse.urlparse(self.path).path
        ctype = self.headers.get("Content-Type", "")
        try:
            if path == "/api/upload":
                fields, files = parse_multipart(self._body(), ctype)
                self._send_json(api_upload(fields, files))
                return
            payload = {}
            raw = self._body()
            if raw:
                payload = json.loads(raw.decode("utf-8"))
            if path == "/api/arrange":
                self._send_json(api_arrange(payload))
            elif path == "/api/export":
                self._send_json(api_export(payload))
            elif path == "/api/load":
                self._send_json(api_load(payload))
            elif path == "/api/load-sheet":
                self._send_json(api_load_sheet(payload))
            elif path == "/api/rename-sheet":
                self._send_json(api_rename_sheet(payload))
            elif path == "/api/delete-sheet":
                self._send_json(api_delete_sheet(payload))
            elif path == "/api/session":
                self._send_json(api_session(payload))
            elif path == "/api/set-project":
                self._send_json(api_set_project(payload))
            elif path == "/api/refresh":
                self._send_json(api_refresh())
            elif path == "/api/clearcache":
                self._send_json(api_clearcache())
            else:
                self._send_bytes(b"Not found", "text/plain", 404)
        except Exception as e:  # noqa: BLE001 — surface errors to the UI
            self._send_json({"error": f"{type(e).__name__}: {e}"}, 500)


def _page() -> str:
    """Serve the UI from ui.html each request so edits show on reload."""
    return (SELF / "ui.html").read_text(encoding="utf-8")


def main():
    from iw_banner import print_banner
    print_banner("Sheet Maker", BUILD,
                 footer=f"http://{HOST}:{PORT}   ·   Ctrl+C to stop")
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
