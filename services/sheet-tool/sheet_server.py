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
import storage             # noqa: E402  (R2 object storage + staging mirror)

SELF = Path(__file__).resolve().parent

_PP = project_paths.resolve()
STAGING_ROOT = _PP["staging_root"]
R2_PREFIX = _PP.get("r2_project_prefix")
ATLAS_MANIFEST_PREFIX = _PP.get("atlas_maker_manifest_prefix")

# Cloud: config lives in the R2-backed staging tree (not the app dir) so user
# edits survive container restarts.
CONFIG_PATH = STAGING_ROOT / "sheet_config.json"

# Project-centric mode: the launcher sends `?project=<key>` on the first
# request. We remember it in a cookie and re-hydrate staging on a switch.
# Serialised so an interleaved request can't observe half-hydrated staging.
_project_lock = threading.Lock()


def _apply_project_paths(pp: dict) -> None:
    """Re-point every module-level path at the (possibly new) project. Other
    functions read these via global lookup at call time (and the path helpers
    call resolve() fresh), so reassigning the module globals here genuinely
    redirects all file ops to the new project."""
    global _PP, STAGING_ROOT, R2_PREFIX, ATLAS_MANIFEST_PREFIX, CONFIG_PATH
    _PP = pp
    STAGING_ROOT = pp["staging_root"]
    R2_PREFIX = pp.get("r2_project_prefix")
    ATLAS_MANIFEST_PREFIX = pp.get("atlas_maker_manifest_prefix")
    CONFIG_PATH = STAGING_ROOT / "sheet_config.json"

PORT = int(os.environ.get("PORT", "8766"))
HOST = os.environ.get("SHEET_BIND_HOST", "0.0.0.0")
BUILD = "v2.2-cloud"

# Shared-secret access gate (the tool runs behind the launcher). Unset = open.
SHEET_TOOL_SECRET = os.environ.get("SHEET_TOOL_SECRET", "")


# ---------------------------------------------------------------------------
# R2 write-through helpers
# ---------------------------------------------------------------------------

def _mirror(p: Path) -> None:
    """Write-through: mirror a staging file to its R2 key so it persists."""
    if not (R2_PREFIX and STAGING_ROOT):
        return
    try:
        rel = Path(p).resolve().relative_to(Path(STAGING_ROOT).resolve()).as_posix()
        storage.push_file(Path(p), f"{R2_PREFIX}/{rel}")
    except Exception:  # noqa: BLE001 — best-effort mirror
        pass


def _mirror_dir(d: Path) -> None:
    """Mirror every file under a staging dir to R2 (used after upload/load)."""
    if not (R2_PREFIX and STAGING_ROOT):
        return
    try:
        rel = Path(d).resolve().relative_to(Path(STAGING_ROOT).resolve()).as_posix()
        storage.push_dir(Path(d), f"{R2_PREFIX}/{rel}")
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------------------
# config + helpers
# ---------------------------------------------------------------------------

def load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    _mirror(CONFIG_PATH)


_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


def safe_name(s: str, default: str = "sheet") -> str:
    s = _SAFE.sub("_", (s or "").strip()).strip("_.")
    return s or default


def uploads_dir(sheet: str) -> Path:
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
    output dir. Otherwise resolve the requested dir and CONFINE it to the staging
    root (any path outside falls back to the default output dir). Created if
    missing."""
    if not dest_dir:
        return output_dir(sheet)
    root = Path(project_paths.resolve()["staging_root"]).resolve()
    try:
        d = Path(dest_dir).resolve()
    except (OSError, ValueError):
        return output_dir(sheet)
    if root not in d.parents and d != root:
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

def api_state() -> dict:
    pp = project_paths.resolve()
    cfg = load_config()
    sheets = []
    out_root = pp["output_root"]
    if out_root.exists():
        sheets = sorted(p.name for p in out_root.iterdir() if p.is_dir())
    return {
        "build": BUILD,
        "launcher_url": os.environ.get("LAUNCHER_URL", "https://app.invisiblewall.org"),
        "project": pp["project"],
        "projects": project_paths.list_projects(),
        "project_root": "",
        "project_locked": bool((os.environ.get("IW_PROJECT_NAME") or "").strip()),
        # In the cloud the Atlas Maker is always reachable over R2 (no sibling
        # folder); the authored manifest is handed off to its R2 prefix.
        "atlas_maker_found": bool(ATLAS_MANIFEST_PREFIX),
        "sheets": sheets,
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
        regions.append({
            "name": safe_name(r.get("name") or Path(src).stem, Path(src).stem),
            "src": src,
            "x": int(r.get("x", 0)), "y": int(r.get("y", 0)),
            "w": int(r.get("w", 0)), "h": int(r.get("h", 0)),
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
    # ingests them instead of forcing a manual re-pick). The export landed in
    # the staging `output/<sheet>/` dir, which mirrors `{R2_PREFIX}/output/<sheet>`;
    # the loose trims (per-region sprites) live under `{R2_PREFIX}/input/<sheet>`.
    sheet_key = safe_name(sheet)
    export_prefix = f"{R2_PREFIX}/output/{sheet_key}" if R2_PREFIX else ""
    source_image_key = f"{export_prefix}/{sheet_png.name}" if export_prefix else ""
    input_prefix = f"{R2_PREFIX}/input/{sheet_key}" if R2_PREFIX else ""
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
        mp = out / man_name
        atlas_writers.write_manifest(mp, manifest)
        _mirror(mp)
        written.append(str(mp))
        # Cloud handoff: drop the manifest into the Atlas Maker's R2 prefix so
        # its manifest list picks it up (after that service restarts/hydrates).
        if ATLAS_MANIFEST_PREFIX:
            try:
                storage.put(f"{ATLAS_MANIFEST_PREFIX}/{man_name}",
                            mp.read_bytes(), "application/json")
                manifest_note = ("Manifest handed off to Atlas Maker (R2) -> "
                                 f"{man_name}. Restart the Atlas Maker to list it.")
            except Exception as e:  # noqa: BLE001 — R2 hiccup, report it
                manifest_note = f"Could not hand manifest to Atlas Maker: {e}"
        else:
            manifest_note = "Atlas Maker prefix not configured; manifest written to output only."

    manifest_path = str(out / f"atlas_manifest_{basename}.json")
    return {"written": written, "manifest_note": manifest_note,
            "output_dir": str(out), "dir": str(out),
            "manifest_path": manifest_path, "name": basename}


def api_set_project(payload: dict) -> dict:
    cfg = load_config()
    cfg["project"] = payload.get("project", cfg.get("project", ""))
    save_config(cfg)
    return {"ok": True, "note": "Restart the tool (or relaunch from the Launcher) "
            "for the new project's paths to take effect."}


# ---------------------------------------------------------------------------
# R2-backed file browser (mirrors the staging tree, which mirrors R2)
# ---------------------------------------------------------------------------

def api_browse(path: str, mode: str = "") -> dict:
    """List a directory inside the staging tree (which mirrors the project's R2
    subtree). Empty path defaults to the project output root. Paths are confined
    to the staging root. Default mode lists only project manifests
    (atlas_manifest_*.json); `mode == "import"` lists any coords/image file."""
    pp = project_paths.resolve()
    root = Path(pp["staging_root"]).resolve()
    out_root = Path(pp["output_root"]).resolve()

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
            elif mode == "import":
                if p.suffix.lower() in (".json", ".atlas", ".png", ".webp"):
                    files.append({"name": p.name, "path": str(p)})
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
    """Find the sheet image for a loaded coords file: try the stored path, then
    the same name beside the coords file, then a basename guess."""
    cands = []
    if image_ref:
        cands.append(Path(image_ref))
        cands.append(coords_path.parent / Path(image_ref).name)
    stem = coords_path.stem.replace("atlas_manifest_", "")
    cands += [coords_path.parent / f"{stem}.png", coords_path.parent / f"{stem}.webp"]
    for c in cands:
        if c.exists():
            return c
    return None


def api_load(payload: dict) -> dict:
    """Load an existing coords file, slice its sheet into per-region PNGs in the
    uploads dir, and return canvas dims + region list for the editor."""
    sheet = safe_name(payload.get("sheet", "loaded"))
    path = Path(payload.get("path", ""))
    if not path.exists():
        return {"error": f"File not found: {path}"}
    try:
        parsed = _parse_coords_file(path)
    except (OSError, json.JSONDecodeError, ValueError) as e:
        return {"error": f"Could not parse {path.name}: {e}"}

    img_path = _resolve_image(path, parsed["image"])
    if img_path is None:
        return {"error": f"Could not locate the sheet image for {path.name} "
                f"(looked for {parsed['image'] or '?'} and siblings)."}

    up = uploads_dir(sheet)
    sheet_img = Image.open(img_path).convert("RGBA")
    regions_out = []
    used = set()
    for r in parsed["regions"]:
        nm = safe_name(r["name"], "region")
        base_nm = nm
        k = 2
        while nm in used:
            nm = f"{base_nm}_{k}"; k += 1
        used.add(nm)
        w, h = r["w"], r["h"]
        fw, fh = (h, w) if r["rotated"] else (w, h)   # footprint on sheet
        crop = sheet_img.crop((r["x"], r["y"], r["x"] + fw, r["y"] + fh))
        if r["rotated"]:
            crop = crop.rotate(90, expand=True)        # back to upright
        src = f"{nm}.png"
        crop.save(up / src)
        regions_out.append({
            "src": src, "name": nm, "x": r["x"], "y": r["y"],
            "w": w, "h": h, "rotated": r["rotated"], "locked": False,
            "prompt": r["prompt"], "shape_ref": r["shape_ref"], "seed": r["seed"],
        })

    _mirror_dir(up)
    is_project = path.name.startswith("atlas_manifest_") and path.suffix.lower() == ".json"
    if is_project:
        name = path.name[len("atlas_manifest_"):-len(".json")]
    else:
        name = path.stem
    return {"sheet": sheet, "canvas_w": parsed["width"], "canvas_h": parsed["height"],
            "regions": regions_out, "count": len(regions_out),
            "source_path": str(path.resolve()), "source_dir": str(path.resolve().parent),
            "name": name, "is_project": is_project}


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

    def _send_bytes(self, data: bytes, ctype: str, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._apply_cookie()
        self.end_headers()
        self.wfile.write(data)

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

        On a real switch we re-resolve paths + re-hydrate staging under a lock
        so an interleaved request never sees half-hydrated staging."""
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

        with _project_lock:
            pp = project_paths.switch_context(chosen_client, chosen_project)
            if pp is not None:
                _apply_project_paths(pp)

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
        self._resolve_context()
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        q = urllib.parse.parse_qs(parsed.query)
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
                self._send_bytes(p.read_bytes(), ctype)
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
            elif path == "/api/set-project":
                self._send_json(api_set_project(payload))
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
