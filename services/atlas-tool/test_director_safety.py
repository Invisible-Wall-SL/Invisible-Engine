"""Offline guard: the Atlas Maker safety changes the Invisible Director needs
(docs/director/DECISIONS/0008-blueprint-driven-art.md, card 8B). Each rule
applies to a Director call alone, and a person's call is unchanged.

Run:  PYTHONPATH=".;../_shared" py test_director_safety.py   (from services/atlas-tool)
      (also collects under pytest)

What must hold:

  1. `/saveconfig` `atlas_pipeline` (Director only) sets the ATLAS's pipeline
     (`manifest.settings.pipeline`), which a render uses whatever the global
     Pipeline says; a Director save carries no global key and never rewrites
     atlas_config.json; a person's `/saveconfig` is exactly as before, and a
     person cannot send `atlas_pipeline`;
  2. a blueprint region renders with the saved params of its EFFECTIVE pipeline
     (region > atlas > global); every existing manifest shape renders the same
     graph, byte for byte, as before; the resolved-workflow export agrees;
  3. `/render` refuses a Director token when the render would go over the
     `http` transport, and starts nothing; a person's render is unchanged;
  4. a Director `/setoutput` writes `refs/useroutput_<region>_<run>_<id>.png`
     create-only and points `output_override` at it, never overwriting a tile;
     compose and the card read that name from the manifest; a person's
     `/setoutput` writes `refs/useroutput_<region>.png` as before;
  5. `/newatlas` and `/duplicateatlas` under a Director token create the atlas
     but leave the project's active atlas (`manifest_path`) where it was; a
     person's still switch to it.

ASCII only in the labels (cp1252 console).
"""
from __future__ import annotations

import base64
import copy
import hashlib
import http.client
import io
import json
import os
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

os.environ["ATLAS_STAGING"] = tempfile.mkdtemp(prefix="director-safety-")

from PIL import Image  # noqa: E402

import batch_atlas  # noqa: E402
import cloud_paths as project_paths  # noqa: E402
import storage  # noqa: E402
import ui_server as u  # noqa: E402
from iw_common import launch  # noqa: E402

SIGNING = "test-signing-secret-0123456789"
ACT = {"tool": "director", "agent": "atlas-technician", "run": "run_07:abc-9"}

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)
    assert ok, label


def claims(**over) -> dict:
    now = int(time.time())
    c = {"v": 1, "typ": "api", "aud": "atlas", "sub": "u_alice", "uid": "u-1",
         "name": "Alice", "role": "artist", "client": "acme", "project": "slots_one",
         "caps": [], "iat": now, "exp": now + 120}
    c.update(over)
    return c


# --- an in-memory bucket ------------------------------------------------------

class _Bucket:
    """storage over a dict: put (with If-Match / If-None-Match), get,
    get_with_etag (what doc_sync reads) and push_file (what _mirror writes)."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.etags: dict[str, str] = {}
        self.real = {k: getattr(storage, k)
                     for k in ("put", "get", "get_with_etag", "push_file")}

    def put(self, key, body, content_type=None, *, if_match=None, if_none_match=None):
        if if_none_match == "*" and key in self.objects:
            raise storage.Conflict(key)
        if if_match and self.etags.get(key) != if_match:
            raise storage.Conflict(key)
        self.objects[key] = bytes(body)
        self.etags[key] = f'"{len(self.etags) + 1}"'
        return self.etags[key]

    def get(self, key):
        return self.objects.get(key)

    def get_with_etag(self, key):
        return (self.objects[key], self.etags[key]) if key in self.objects else None

    def push_file(self, path, key):
        self.put(key, path.read_bytes())
        return True

    def __enter__(self):
        for k in self.real:
            setattr(storage, k, getattr(self, k))
        return self

    def __exit__(self, *exc):
        for k, v in self.real.items():
            setattr(storage, k, v)


# --- a server under signed tokens ---------------------------------------------

class _Server:
    def __init__(self) -> None:
        self.env = {k: os.environ.get(k) for k in
                    ("ATLAS_TOOL_SIGNING_SECRET", "ATLAS_TOOL_SECRET", "COMFY_TRANSPORT")}
        self.started: dict[str, tuple] = {}
        self.real_render = u.run_render

    def __enter__(self):
        os.environ["ATLAS_TOOL_SIGNING_SECRET"] = SIGNING
        os.environ.pop("ATLAS_TOOL_SECRET", None)
        os.environ["COMFY_TRANSPORT"] = "serverless"
        u.run_render = lambda *a: self.started.__setitem__("render", a)
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), u.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.port = self.srv.server_address[1]
        self.agent = {launch.LAUNCH_HEADER: launch.sign(SIGNING, claims(act=ACT))}
        self.person = {launch.LAUNCH_HEADER: launch.sign(SIGNING, claims())}
        return self

    def __exit__(self, *exc):
        self.srv.shutdown()
        u.run_render = self.real_render
        with u._render_lock:
            u._render_state.update(running=False, owner=None)
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def req(self, method: str, path: str, headers: dict, body: dict | None = None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        c.request(method, path, body=json.dumps(body).encode() if body is not None else None,
                  headers=headers)
        r = c.getresponse()
        out = (r.status, r.read().decode())
        c.close()
        return out


MAIN = "atlas_manifest_main.json"
SYMBOLS = "atlas_manifest_symbols.json"


def _seed(cfg: dict | None = None) -> None:
    """Project acme/slots_one: `main` selected, `symbols` with two regions."""
    project_paths.set_context("acme", "slots_one")
    u.MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    for f in u.MANIFEST_DIR.glob("*.json"):
        f.unlink()
    (u.MANIFEST_DIR / MAIN).write_text(json.dumps({"regions": []}), encoding="utf-8")
    (u.MANIFEST_DIR / SYMBOLS).write_text(json.dumps({
        "atlas": {"layout": "pack"},
        "regions": [{"name": "H1", "prompt": "a crown"}, {"name": "H2", "prompt": "a gem"}],
    }), encoding="utf-8")
    u.CONFIG_PATH.write_text(json.dumps(dict({"manifest_path": MAIN, "pipeline": "sdxl"},
                                             **(cfg or {}))), encoding="utf-8")


def _manifest(name: str) -> dict:
    return json.loads((u.MANIFEST_DIR / name).read_text(encoding="utf-8"))


def _normalized(b64: str) -> bytes:
    """The bytes /setoutput stores for an upload: RGBA, re-encoded as PNG."""
    buf = io.BytesIO()
    Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA").save(buf, "PNG")
    return buf.getvalue()


def _r2_key(p) -> str:
    rel = p.resolve().relative_to(Path(str(u.STAGING_ROOT)).resolve()).as_posix()
    return f"{u.R2_PREFIX}/{rel}"


def _png(color: tuple) -> str:
    buf = io.BytesIO()
    Image.new("RGBA", (8, 8), color).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


# --- 1. atlas_pipeline ----------------------------------------------------------

def test_atlas_pipeline_director() -> None:
    _seed()
    with _Bucket(), _Server() as s:
        cfg_before = u.CONFIG_PATH.read_bytes()
        st, body = s.req("POST", f"/saveconfig?manifest={SYMBOLS}", s.agent,
                         {"atlas_pipeline": "FLUX", "gen_width": "768"})
        check("a Director save of atlas_pipeline is accepted", (st, body[:1]), (200, "✓"))
        m = _manifest(SYMBOLS)
        check("...stored as the atlas's settings.pipeline",
              (m["settings"].get("pipeline"), m["settings"].get("gen_width")), ("flux", 768))
        check("...without rewriting atlas_config.json", u.CONFIG_PATH.read_bytes(), cfg_before)

        for label, edits in (("the global Pipeline", {"pipeline": "flux"}),
                             ("Run generation on", {"atlas_pipeline": "sdxl", "run_on": "local"}),
                             ("the active atlas", {"manifest_path": MAIN}),
                             ("atlas geometry", {"atlas_layout": "grid"})):
            st, body = s.req("POST", f"/saveconfig?manifest={SYMBOLS}", s.agent, edits)
            check(f"a Director save carrying {label} is refused whole",
                  (st, body[:1], _manifest(SYMBOLS) == m, u.CONFIG_PATH.read_bytes() == cfg_before),
                  (200, "✖", True, True))

        st, body = s.req("POST", f"/saveconfig?manifest={SYMBOLS}", s.agent,
                         {"atlas_pipeline": "no_such_blueprint"})
        check("an unknown pipeline is refused", (body[:1], _manifest(SYMBOLS) == m), ("✖", True))

        st, body = s.req("POST", f"/saveconfig?manifest={SYMBOLS}", s.agent,
                         {"atlas_pipeline": ""})
        check("a blank atlas_pipeline clears it",
              (body[:1], "pipeline" in _manifest(SYMBOLS)["settings"]), ("✓", False))


def test_atlas_pipeline_wins_over_the_global() -> None:
    saved = batch_atlas.PIPELINE
    try:
        batch_atlas.PIPELINE = "sdxl"
        batch_atlas.apply_manifest_settings({"settings": {"pipeline": "flux"}})
        check("a render of that atlas runs its own pipeline",
              batch_atlas.region_pipeline({"name": "H1"}), "flux")
        check("...and a region's own override still wins",
              batch_atlas.region_pipeline({"name": "H1", "pipeline": "gpt_image"}), "gpt_image")
        check("the page shows the atlas's pipeline",
              u.atlas_pipeline({"settings": {"pipeline": "flux"}}, {"pipeline": "sdxl"}), "flux")
        check("...and the global one for any other atlas",
              u.atlas_pipeline({}, {"pipeline": "sdxl"}), "sdxl")
    finally:
        batch_atlas.PIPELINE = saved


def test_atlas_pipeline_person_unchanged() -> None:
    _seed()
    with _Bucket(), _Server() as s:
        before = (u.MANIFEST_DIR / SYMBOLS).read_bytes()
        cfg_before = u.CONFIG_PATH.read_bytes()
        st, body = s.req("POST", "/saveconfig", s.person, {"atlas_pipeline": "flux"})
        check("a person cannot send atlas_pipeline",
              (st, body[:1], (u.MANIFEST_DIR / SYMBOLS).read_bytes() == before,
               u.CONFIG_PATH.read_bytes() == cfg_before), (200, "✖", True, True))
        st, body = s.req("POST", "/saveconfig", s.person,
                         {"manifest_path": SYMBOLS})
        st, body = s.req("POST", "/saveconfig", s.person,
                         {"pipeline": "flux", "gen_width": "640"})
        check("a person's save answers as before",
              (st, body), (200, "Settings saved (per-atlas overrides + globals)"))
        cfg = json.loads(u.CONFIG_PATH.read_text(encoding="utf-8"))
        m = _manifest(SYMBOLS)
        check("...the Pipeline control is still global",
              (cfg.get("pipeline"), "pipeline" in (m.get("settings") or {})), ("flux", False))
        check("...and per-atlas keys still land on the atlas", m["settings"]["gen_width"], 640)


# --- 2. bpParams by the effective pipeline -------------------------------------

def _bp(bp_id: str) -> dict:
    """A blueprint with a prompt, a seed and two params sharing keys with the other."""
    return {
        "id": bp_id,
        "graph": {
            "1": {"class_type": "CLIPTextEncode", "inputs": {"text": ""}},
            "2": {"class_type": "KSampler", "inputs": {"seed": 0, "steps": 20, "cfg": 7.0}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "x"}},
        },
        "bindings": {"positive": {"node": "1", "field": "text"},
                     "seed": {"node": "2", "field": "seed"},
                     "output": {"node": "9", "field": "images"}},
        "params": [
            {"key": "steps", "node": "2", "field": "steps", "type": "int",
             "default": 20, "min": 1, "max": 100},
            {"key": "cfg", "node": "2", "field": "cfg", "type": "float",
             "default": 7.0, "min": 0, "max": 30},
        ],
    }


BLUEPRINTS = {"bp_a": _bp("bp_a"), "bp_b": _bp("bp_b")}

# Every shape a manifest could have before 8B: (atlas pipeline, bpParams, regions).
FIXTURES = {
    "built-in atlas, no overrides": (
        "sdxl", {"bp_a": {"steps": 33}}, [{"name": "R1", "seed": 5}]),
    "built-in atlas, a region on a blueprint with no saved params": (
        "sdxl", {}, [{"name": "R1", "seed": 5, "pipeline": "bp_a"}]),
    "blueprint atlas with saved params": (
        "bp_a", {"bp_a": {"steps": 33, "cfg": "4.5"}},
        [{"name": "R1", "seed": 5}, {"name": "R2", "seed": 6, "pipeline": "bp_a"}]),
    "blueprint atlas, a region on another blueprint with no saved params": (
        "bp_a", {"bp_a": {"steps": 33}},
        [{"name": "R1", "seed": 5}, {"name": "R2", "seed": 6, "pipeline": "bp_b"}]),
    "blueprint atlas, a region on a built-in": (
        "bp_a", {"bp_a": {"steps": 33}, "sdxl": {"steps": 9}},
        [{"name": "R1", "seed": 5, "pipeline": "bp_a"}]),
}


class _Graph(Exception):
    def __init__(self, wf: dict) -> None:
        self.wf = wf


def _rendered(pipe: str, bp_params: dict, region: dict) -> dict | None:
    """The graph `run_region` would send for `region` after main() loaded this
    manifest (None for a built-in, which never reads bpParams)."""
    if batch_atlas.region_pipeline(region) in ("sdxl", "flux", "gpt_image"):
        return None
    try:
        batch_atlas.run_region(region, {}, "", "")
    except _Graph as g:
        return g.wf
    raise AssertionError("run_region did not build a graph")


def _before_8b(region: dict) -> dict:
    """The graph run_region built before 8B: every blueprint region got the
    ACTIVE pipeline's params (BP_PARAM_OVERRIDES)."""
    bp = BLUEPRINTS[batch_atlas.region_pipeline(region)]
    return batch_atlas.build_workflow_blueprint(
        region, {}, bp, batch_atlas.BP_PARAM_OVERRIDES)[0]


def _with_fixture(pipe: str, bp_params: dict, fn):
    saved = (batch_atlas.PIPELINE, batch_atlas.blueprints.get_blueprint,
             batch_atlas.assert_models_named, dict(batch_atlas.BP_PARAM_OVERRIDES),
             dict(batch_atlas.BP_PARAMS_ALL))

    def _stop(wf):
        raise _Graph(copy.deepcopy(wf))
    try:
        batch_atlas.blueprints.get_blueprint = lambda bp_id: copy.deepcopy(BLUEPRINTS.get(bp_id))
        batch_atlas.assert_models_named = _stop
        batch_atlas.PIPELINE = "sdxl"
        manifest = {"settings": {"pipeline": pipe, "bpParams": bp_params}}
        batch_atlas.apply_manifest_settings(manifest)
        batch_atlas.load_bp_params(manifest)
        return fn()
    finally:
        (batch_atlas.PIPELINE, batch_atlas.blueprints.get_blueprint,
         batch_atlas.assert_models_named) = saved[:3]
        batch_atlas.BP_PARAM_OVERRIDES.clear()
        batch_atlas.BP_PARAM_OVERRIDES.update(saved[3])
        batch_atlas.BP_PARAMS_ALL.clear()
        batch_atlas.BP_PARAMS_ALL.update(saved[4])


def test_existing_manifests_render_byte_identically() -> None:
    for label, (pipe, bp_params, regions) in FIXTURES.items():
        for r in regions:
            got = _with_fixture(pipe, bp_params, lambda r=r: _rendered(pipe, bp_params, r))
            if got is None:
                continue
            want = _with_fixture(pipe, bp_params, lambda r=r: _before_8b(r))
            check(f"byte-identical graph: {label} ({r['name']})",
                  json.dumps(got, sort_keys=True).encode(),
                  json.dumps(want, sort_keys=True).encode())


def test_region_renders_its_own_pipelines_params() -> None:
    bp_params = {"bp_a": {"steps": 33, "cfg": "4.5"}, "bp_b": {"steps": 50}}
    region = {"name": "R2", "seed": 6, "pipeline": "bp_b"}
    wf = _with_fixture("bp_a", bp_params, lambda: _rendered("bp_a", bp_params, region))
    check("a region on bp_b renders bp_b's saved params, not the atlas's",
          (wf["2"]["inputs"]["steps"], wf["2"]["inputs"]["cfg"]), (50, 7.0))
    wf = _with_fixture("sdxl", bp_params, lambda: _rendered("sdxl", bp_params, region))
    check("...on a built-in atlas too", wf["2"]["inputs"]["steps"], 50)
    wf = _with_fixture("bp_a", bp_params,
                       lambda: _rendered("bp_a", bp_params, {"name": "R1", "seed": 5}))
    check("a region on the atlas's blueprint keeps the atlas's params",
          (wf["2"]["inputs"]["steps"], wf["2"]["inputs"]["cfg"]), (33, 4.5))


def test_resolved_export_agrees() -> None:
    bp_params = {"bp_a": {"steps": 33}, "bp_b": {"steps": 50}}
    manifest = {"settings": {"pipeline": "bp_a", "bpParams": bp_params},
                "regions": [{"name": "R1", "seed": 5},
                            {"name": "R2", "seed": 6, "pipeline": "bp_b"}]}
    saved = (batch_atlas.blueprints.get_blueprint, batch_atlas.refresh_config_globals)
    try:
        batch_atlas.blueprints.get_blueprint = lambda bp_id: copy.deepcopy(BLUEPRINTS.get(bp_id))
        batch_atlas.refresh_config_globals = lambda: {}
        wf = batch_atlas.resolve_blueprint_workflow(manifest, "R2")[0]
        check("the resolved-workflow export uses the region's own params",
              wf["2"]["inputs"]["steps"], 50)
        wf = batch_atlas.resolve_blueprint_workflow(manifest, "R1")[0]
        check("...and the atlas's for a region on the atlas's blueprint",
              wf["2"]["inputs"]["steps"], 33)
        wf = batch_atlas.resolve_blueprint_workflow(manifest, "R1", "bp_b")[0]
        check("...and an explicit blueprint's own params, as the page asks for them",
              wf["2"]["inputs"]["steps"], 50)
    finally:
        batch_atlas.blueprints.get_blueprint, batch_atlas.refresh_config_globals = saved


# --- 3. /render on the http transport ----------------------------------------

def test_render_refused_for_director_on_http() -> None:
    _seed()
    with _Bucket(), _Server() as s:
        render = {"names": ["H1"], "variants": 1}
        json_hdr = {"Accept": "application/json"}
        for label, env, run_on in (("the service default is http", "http", ""),
                                   ("Run generation on is My computer", "serverless", "local")):
            os.environ["COMFY_TRANSPORT"] = env
            _seed({"run_on": run_on} if run_on else None)
            s.started.clear()
            st, body = s.req("POST", f"/render?manifest={SYMBOLS}",
                             dict(s.agent, **json_hdr), render)
            ans = json.loads(body)
            check(f"a Director render is refused when {label}",
                  (st, ans["started"], ans.get("refused")), (403, False, "transport"))
            check("...the slot stays free and nothing starts",
                  (u._render_state.get("running"), "render" in s.started), (False, False))
            st, body = s.req("POST", f"/render?manifest={SYMBOLS}", s.agent, render)
            check("...also on the plain-text path", (st, body[:1]), (403, "✖"))

        os.environ["COMFY_TRANSPORT"] = "http"
        _seed({"run_on": "pod"})
        st, body = s.req("POST", f"/render?manifest={SYMBOLS}", dict(s.agent, **json_hdr), render)
        check("a Director render on RunPod starts", (st, json.loads(body)["started"]), (200, True))
        with u._render_lock:
            u._render_state.update(running=False, owner=None)

        _seed()
        s.started.clear()
        st, body = s.req("POST", "/render", dict(s.person, **json_hdr), render)
        check("a person's render on http starts as before",
              (st, json.loads(body)["started"]), (200, True))
        with u._render_lock:
            u._render_state.update(running=False, owner=None)


def test_render_worker_rechecks_the_transport() -> None:
    """`/render` answered on RunPod, then someone picked My computer before the
    worker read the setting: the worker refuses too."""
    _seed({"run_on": "local"})
    ran: list = []
    real = u._run_cmd if hasattr(u, "_run_cmd") else None
    try:
        if real:
            u._run_cmd = lambda *a, **k: ran.append(a) or 0
        u._render_caller.director = True
        rc = u._render_job(["H1"], 1, "")
        check("a Director render the setting moved to http never runs",
              (rc, ran, u._render_state.get("running")), (None, [], False))
    finally:
        u._render_caller.director = False
        if real:
            u._run_cmd = real
        with u._render_lock:
            u._render_state.update(running=False, owner=None, log="")


# --- 4. versioned /setoutput ----------------------------------------------------

def test_setoutput_versioned_for_director() -> None:
    _seed()
    refs = u.INPUT_DIR / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    human_tile = refs / "useroutput_H1.png"
    human_tile.write_bytes(b"a person's committed tile")
    with _Bucket() as bucket, _Server() as s:
        st, body = s.req("POST", f"/setoutput?manifest={SYMBOLS}", s.agent,
                         {"name": "H1", "data": _png((255, 0, 0, 255))})
        rel = _manifest(SYMBOLS)["regions"][0].get("output_override", "")
        check("a Director commit answers OK", (st, body[:1]), (200, "✓"))
        check("...under refs/useroutput_<region>_<run>_<id>.png",
              (rel.startswith("refs/useroutput_H1_run-07-abc-9_"), rel.endswith(".png"),
               len(rel.rsplit("_", 1)[1]) == len("0123456789ab.png")), (True, True, True))
        written = (u.INPUT_DIR / rel).read_bytes()
        check("...whose id is the tile's content digest",
              rel.rsplit("_", 1)[1][:-4], hashlib.sha256(written).hexdigest()[:12])
        check("...created in R2 too", bucket.objects.get(_r2_key(u.INPUT_DIR / rel)), written)
        check("the person's tile is untouched", human_tile.read_bytes(),
              b"a person's committed tile")
        check("compose reads the versioned name from the manifest",
              batch_atlas.override_image_path(_manifest(SYMBOLS)["regions"][0]),
              u.INPUT_DIR / rel)

        st, body = s.req("POST", f"/setoutput?manifest={SYMBOLS}", s.agent,
                         {"name": "H1", "data": _png((255, 0, 0, 255))})
        check("a replay lands on the same file",
              (body[:1], _manifest(SYMBOLS)["regions"][0]["output_override"]), ("✓", rel))

        st, body = s.req("POST", f"/setoutput?manifest={SYMBOLS}", s.agent,
                         {"name": "H1", "data": _png((0, 0, 255, 255))})
        rel2 = _manifest(SYMBOLS)["regions"][0]["output_override"]
        check("a second commit gets a new file", (body[:1], rel2 != rel), ("✓", True))
        check("...and the first is never overwritten", (u.INPUT_DIR / rel).read_bytes(), written)

        m_before = _manifest(SYMBOLS)
        green = _png((0, 255, 0, 255))
        clash = u.INPUT_DIR / u.versioned_output_rel("H2", ACT["run"], _normalized(green))
        # Same name, different bytes: only possible if something else wrote it.
        bucket.objects[_r2_key(clash)] = b"somebody else's bytes"
        st, body = s.req("POST", f"/setoutput?manifest={SYMBOLS}", s.agent,
                         {"name": "H2", "data": green})
        check("a name another writer holds is refused, nothing changed",
              (body[:1], _manifest(SYMBOLS) == m_before, clash.exists()), ("✖", True, False))

        s.req("POST", "/saveconfig", s.person, {"manifest_path": SYMBOLS})
        st, body = s.req("POST", "/clearoutput", s.person, {"name": "H1"})
        check("a person's revert of a run's tile drops the pointer",
              "output_override" in _manifest(SYMBOLS)["regions"][0], False)
        check("...keeps the run's file and the person's older tile",
              ((u.INPUT_DIR / rel2).exists(), human_tile.read_bytes()),
              (True, b"a person's committed tile"))

        st, body = s.req("POST", f"/setoutput?manifest={SYMBOLS}", s.agent,
                         {"name": "NOPE", "data": _png((0, 0, 0, 255))})
        check("a region the atlas lacks is refused, never added",
              (any(r["name"] == "NOPE" for r in _manifest(SYMBOLS)["regions"]),
               any("NOPE" in p.name for p in refs.iterdir())), (False, False))


def test_director_save_never_ok_from_staging_alone() -> None:
    _seed()
    with _Bucket() as bucket, _Server() as s:
        def broken(*a, **k):
            raise OSError("R2 is down")
        bucket.put = broken
        storage.put = broken
        before = (u.MANIFEST_DIR / SYMBOLS).read_bytes()
        st, body = s.req("POST", f"/saveconfig?manifest={SYMBOLS}", s.agent,
                         {"atlas_pipeline": "flux"})
        check("a Director save R2 did not take is refused, not answered OK",
              (st, body.startswith("✓"), (u.MANIFEST_DIR / SYMBOLS).read_bytes() == before),
              (503, False, True))


def test_deeplink_never_switches_for_director() -> None:
    _seed()
    with _Bucket(), _Server() as s:
        cfg_before = u.CONFIG_PATH.read_bytes()
        s.req("GET", "/?atlas=symbols", s.agent)
        check("a Director deep link leaves the active atlas alone",
              u.CONFIG_PATH.read_bytes(), cfg_before)


def test_setoutput_person_unchanged() -> None:
    _seed({"manifest_path": SYMBOLS})
    with _Bucket(), _Server() as s:
        st, body = s.req("POST", "/setoutput", s.person,
                         {"name": "H2", "data": _png((9, 9, 9, 255))})
        check("a person's commit answers as before",
              (st, body), (200, "Using your image for H2 (not processed). "
                                "Create Atlas to apply; ✕ revert to generate again."))
        check("...writing refs/useroutput_<region>.png",
              _manifest(SYMBOLS)["regions"][1]["output_override"], "refs/useroutput_H2.png")
        first = (u.INPUT_DIR / "refs/useroutput_H2.png").read_bytes()
        s.req("POST", "/setoutput", s.person, {"name": "H2", "data": _png((1, 2, 3, 255))})
        check("...overwritten in place on the next commit, as before",
              (u.INPUT_DIR / "refs/useroutput_H2.png").read_bytes() != first, True)


# --- 5. /newatlas and /duplicateatlas keep the selection --------------------------

def test_new_and_duplicate_keep_selection_for_director() -> None:
    _seed()
    with _Bucket(), _Server() as s:
        cfg_before = u.CONFIG_PATH.read_bytes()
        st, body = s.req("POST", "/newatlas", s.agent, {"name": "scratch"})
        check("a Director /newatlas creates the atlas",
              (body[:1], (u.MANIFEST_DIR / "atlas_manifest_scratch.json").exists()), ("✓", True))
        check("...without switching the active atlas", u.CONFIG_PATH.read_bytes(), cfg_before)
        st, body = s.req("POST", "/newatlas", s.agent, {"name": "symbols"})
        check("an existing name is not switched to either",
              (body[:1], "switched" in body, u.CONFIG_PATH.read_bytes() == cfg_before),
              ("⚠", False, True))
        st, body = s.req("POST", f"/duplicateatlas?manifest={SYMBOLS}", s.agent,
                         {"name": "symbols_cut", "prefix": "cut"})
        dup = u.MANIFEST_DIR / "atlas_manifest_symbols_cut.json"
        check("a Director /duplicateatlas copies the pinned atlas",
              (body[:1], [r["name"] for r in json.loads(dup.read_text())["regions"]]),
              ("✓", ["cut_H1", "cut_H2"]))
        check("...without switching the active atlas", u.CONFIG_PATH.read_bytes(), cfg_before)


def test_new_and_duplicate_person_unchanged() -> None:
    _seed({"manifest_path": SYMBOLS})
    with _Bucket(), _Server() as s:
        def selected():
            return json.loads(u.CONFIG_PATH.read_text(encoding="utf-8"))["manifest_path"]
        st, body = s.req("POST", "/newatlas", s.person, {"name": "fresh"})
        check("a person's /newatlas switches to it",
              (body[:1], selected()), ("✓", "atlas_manifest_fresh.json"))
        st, body = s.req("POST", "/newatlas", s.person, {"name": "symbols"})
        check("...and to an existing one rather than overwriting",
              ("switched" in body, selected()), (True, SYMBOLS))
        st, body = s.req("POST", "/duplicateatlas", s.person, {"name": "copy", "prefix": "c"})
        check("a person's /duplicateatlas switches to the copy",
              (body[:1], selected()), ("✓", "atlas_manifest_copy.json"))


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(f"\n-- {name}")
            try:
                fn()
            except AssertionError:
                pass
    if FAILED:
        print(f"\nFAILED: {len(FAILED)}")
        raise SystemExit(1)
    print("\nall passed")
