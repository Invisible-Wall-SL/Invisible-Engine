"""Offline fixtures for the Flipbook video runner (no ComfyUI, no RunPod, no R2).

Run:  py test_video_runner.py     (from services/atlas-tool, PYTHONPATH=../_shared:.)

These cover the contracts that a green build would NOT catch — the tool ships as
plain Python behind an http.server, so nothing type-checks these call sites. Each
assertion below stands for a specific way this has gone wrong before:

  * the `width`/`height` roles silently inheriting the 1024 STILL-image default
    and pushing it through an 81-frame video batch;
  * a param whose (node, field) doesn't exist quietly doing nothing;
  * a preview output being persisted instead of the real animated WEBP.
"""
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from urllib.error import URLError

import video_runner

FAILED: list[str] = []
# Every `project_paths.set_context` call the stubbed world saw: (thread id, args).
# A stub that only answered True could not tell a worker thread that set the
# context from one that never did — and one that never did lands every file in
# the env-default project.
SET_CONTEXT_CALLS: list[tuple[int, tuple]] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


def check_raises(label: str, fn, needle: str = "") -> None:
    try:
        fn()
    except Exception as e:  # noqa: BLE001 — asserting the raise
        if needle and needle.lower() not in str(e).lower():
            print(f"FAIL {label}\n       raised {e!r}, expected to mention {needle!r}")
            FAILED.append(label)
            return
        print(f"ok   {label}")
        return
    print(f"FAIL {label} — did not raise")
    FAILED.append(label)


BP_DIR = Path(__file__).resolve().parent / "blueprints_src" / "wan22_i2v_flipbook"
REAL_CANCEL_JOB = video_runner._cancel_job


def load_blueprint() -> dict:
    """The real shipped blueprint, loaded the way `blueprints._read_blueprint_dir`
    shapes it — so these fixtures break if the published asset drifts."""
    manifest = json.loads((BP_DIR / "blueprint.json").read_text(encoding="utf-8"))
    graph = json.loads((BP_DIR / "workflow.json").read_text(encoding="utf-8"))
    return {
        "id": manifest["id"],
        "graph": graph,
        "bindings": manifest["bindings"],
        "params": manifest.get("params") or [],
        "meta": {k: v for k, v in manifest.items() if k != "bindings"},
    }


def test_workflow_build() -> None:
    bp = load_blueprint()
    wf = video_runner.build_video_workflow(
        bp, prompt="a spinning gold coin", negative="blurry", seed=12345,
        source_ref="sheet_src/H1.png", overrides={"duration": 2, "fps": 8},
        filename_prefix="iwvid_test_001")

    check("positive prompt injected", wf["170"]["inputs"]["text"], "a spinning gold coin")
    check("negative prompt injected", wf["194"]["inputs"]["text"], "blurry")
    check("seed injected on the ADD_NOISE stage", wf["180"]["inputs"]["noise_seed"], 12345)
    check("seed NOT injected on the disabled stage", wf["181"]["inputs"]["noise_seed"], 0)
    check("source image injected", wf["97"]["inputs"]["image"], "sheet_src/H1.png")
    check("output filename_prefix set", wf["200"]["inputs"]["filename_prefix"],
          "iwvid_test_001")

    # THE trap: build_workflow_blueprint fills these from GEN_WIDTH/GEN_HEIGHT
    # (default 1024). The video path must leave the graph's own size alone.
    check("generation width untouched by a role", wf["165"]["inputs"]["width"], 640)
    check("generation height untouched by a role", wf["165"]["inputs"]["height"], 640)

    # Overrides beat defaults; unspecified params still get their default.
    check("override applied (duration)", wf["191"]["inputs"]["value"], 2)
    check("override applied (fps)", wf["192"]["inputs"]["value"], 8)
    check("param default applied (fast_lora on)", wf["171"]["inputs"]["value"], True)
    check("param default applied (cutout on)", wf["203"]["inputs"]["value"], True)
    check("param default applied (lossless off)", wf["200"]["inputs"]["lossless"], False)

    # The save fps stays WIRED to node 192 rather than being overwritten with a
    # literal — otherwise the preview drifts from the motion rate again.
    check("save fps still linked to the fps node", wf["200"]["inputs"]["fps"], ["192", 0])

    # The blueprint's own graph must be untouched (it is cached per process).
    check("blueprint graph not mutated",
          bp["graph"]["170"]["inputs"]["text"].startswith("The white dragon"), True)


def test_birefnet_surface_is_complete() -> None:
    """Every BiRefNet input is exposed and drivable. Checked against the node's
    REAL contract (1038lab/ComfyUI-RMBG at the pinned RMBG_REF), because a param
    whose value is out of the node's domain is a run-time graph rejection, not a
    validation error we would catch here."""
    bp = load_blueprint()
    cutout = {p["key"]: p for p in bp["params"] if p.get("group") == "Cutout"}
    driven = {p["field"] for p in cutout.values() if p["node"] == "202"}
    check("every BiRefNet node input is exposed", driven, {
        "model", "sensitivity", "mask_blur", "mask_offset",
        "invert_output", "refine_foreground", "background", "background_color"})

    # Types + domains must match the node, or an override is rejected at run time.
    check("mask_blur is an INT (the node declares INT 0-64, not float)",
          (cutout["mask_blur"]["type"], cutout["mask_blur"]["min"], cutout["mask_blur"]["max"]),
          ("int", 0, 64))
    check("mask_offset keeps the node's -20..20 domain",
          (cutout["mask_offset"]["min"], cutout["mask_offset"]["max"]), (-20, 20))
    check("sensitivity keeps the node's 0..1 domain",
          (cutout["sensitivity"]["min"], cutout["sensitivity"]["max"]), (0.0, 1.0))
    # The baked list is the OFFLINE FALLBACK — a sleeping pod still gets a
    # dropdown — so it must stay complete even now that the panel re-reads the
    # live one through `options_from`.
    check("the baked fallback list is still the node's full 12",
          len(cutout["birefnet_model"]["options"]), 12)
    check("and the authored default is in it",
          cutout["birefnet_model"]["default"] in cutout["birefnet_model"]["options"], True)
    check("background offers exactly the node's two modes",
          cutout["background"]["options"], ["Alpha", "Color"])
    # Where the LIVE list comes from: a model installed on the pod today must
    # show up on reopening the blueprint, not on a re-import.
    check("the model list says where to re-read itself",
          cutout["birefnet_model"]["options_from"],
          {"class": "BiRefNetRMBG", "field": "model"})
    check("so does the background mode",
          cutout["background"]["options_from"],
          {"class": "BiRefNetRMBG", "field": "background"})

    # An override must actually reach the node.
    wf = video_runner.build_video_workflow(
        bp, "p", "", 1, "r.png",
        {"birefnet_model": "BiRefNet-matting", "sensitivity": 0.75, "mask_blur": 4,
         "invert_output": True, "background": "Color", "background_color": "#ff00ff"}, "px")
    got = {k: v for k, v in wf["202"]["inputs"].items() if k != "image"}
    check("every override lands on the node", got, {
        "model": "BiRefNet-matting", "sensitivity": 0.75, "mask_blur": 4,
        "mask_offset": 5, "invert_output": True, "refine_foreground": False,
        "background": "Color", "background_color": "#ff00ff"})

    # An out-of-domain select falls back rather than poisoning the graph.
    wf = video_runner.build_video_workflow(
        bp, "p", "", 1, "r.png", {"birefnet_model": "NotAModel"}, "px")
    check("an unknown model falls back to the default",
          wf["202"]["inputs"]["model"], "BiRefNet_toonout")


def test_param_clamping() -> None:
    bp = load_blueprint()
    wf = video_runner.build_video_workflow(
        bp, "p", "", 1, "ref.png", {"duration": 999, "quality": -5}, "px")
    check("out-of-range override clamps to max", wf["191"]["inputs"]["value"], 10)
    check("out-of-range override clamps to min", wf["200"]["inputs"]["quality"], 1)


def test_a_param_with_no_declared_domain_cannot_be_clamped() -> None:
    """The live 400 this change exists for:

        /prompt rejected (400): node 372 "sensitivity": Value 50.0 bigger than max of 1.0

    The clamp was never missing — it only ever bites on a DECLARED domain, and a
    blueprint imported from a workflow declared none, because the importer typed
    each param from the value the graph baked in. So the fix is upstream of the
    clamp: read the node's real contract (`comfy_specs`) and record it."""
    bp = load_blueprint()
    wf = video_runner.build_video_workflow(
        bp, "p", "", 1, "r.png", {"sensitivity": 50.0}, "px")
    check("a declared domain clamps the value ComfyUI would have rejected",
          wf["202"]["inputs"]["sensitivity"], 1.0)

    # The same param as an IMPORTED blueprint used to carry it: no min, no max.
    stripped = json.loads(json.dumps(bp))
    for p in stripped["params"]:
        if p["key"] == "sensitivity":
            p.pop("min", None)
            p.pop("max", None)
    wf = video_runner.build_video_workflow(
        stripped, "p", "", 1, "r.png", {"sensitivity": 50.0}, "px")
    check("with no declared domain nothing can clamp it — this IS the 400",
          wf["202"]["inputs"]["sensitivity"], 50.0)


# One ComfyUI `/object_info` answer, in the exact shape the real endpoint returns.
OBJECT_INFO = {
    "BiRefNetRMBG": {"input": {
        "required": {
            "image": ["IMAGE"],
            "model": [["BiRefNet-general", "BiRefNet_toonout", "BiRefNet_lite",
                       "AnotherOneInstalledToday"],
                      {"default": "BiRefNet-general"}],
            "sensitivity": ["FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0,
                                      "step": 0.01, "round": False}],
            "mask_blur": ["INT", {"default": 0, "min": 0, "max": 64, "step": 1}],
            "invert_output": ["BOOLEAN", {"default": False}],
            "background": [["Alpha", "Color"], {"default": "Alpha"}],
        },
        "optional": {
            "background_color": ["STRING", {"default": "#222222", "multiline": False}],
        }}},
    "PrimitiveFloat": {"input": {"required": {
        "value": ["FLOAT", {"default": 0.0, "min": -1.7976931348623157e308,
                            "max": 1.7976931348623157e308, "step": 0.01}]}}},
}


def test_node_contracts_are_read_not_guessed() -> None:
    """A baked value says "float" and nothing else. `/object_info` says 0..1, and
    says which twelve models this ComfyUI actually has installed."""
    import comfy_specs

    specs = comfy_specs.normalize_class(OBJECT_INFO["BiRefNetRMBG"])
    check("a COMBO becomes a select carrying the node's real list", specs["model"],
          {"kind": "select",
           "options": ["BiRefNet-general", "BiRefNet_toonout", "BiRefNet_lite",
                       "AnotherOneInstalledToday"],
           "default": "BiRefNet-general"})
    check("a FLOAT carries the domain the 400 was about", specs["sensitivity"],
          {"kind": "float", "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01})
    check("an INT stays an INT (a float step would be rejected)", specs["mask_blur"],
          {"kind": "int", "default": 0, "min": 0, "max": 64, "step": 1})
    check("a BOOLEAN is a bool", specs["invert_output"],
          {"kind": "bool", "default": False})
    check("an OPTIONAL input is covered too — knobs live there routinely",
          specs["background_color"], {"kind": "text", "multiline": False,
                                      "default": "#222222"})
    check("a wired input has no widget for a param to drive", "image" in specs, False)

    # ComfyUI writes a sentinel, not an absent key, when an input has no limit.
    prim = comfy_specs.normalize_class(OBJECT_INFO["PrimitiveFloat"])["value"]
    check("a primitive's 1e308 stand-in publishes as UNBOUNDED, not as a slider",
          ("min" in prim, "max" in prim), (False, False))


def test_a_sleeping_pod_is_not_an_error() -> None:
    """The pod is asleep most of the time. Unreachable, unknown class, malformed
    spec — all of them mean "no known contract", and the caller keeps the baked
    list it already had. None of them is a failure anyone should be told about."""
    import comfy_specs

    cat = comfy_specs.comfy_catalog
    real = (comfy_specs._source, cat._http_get_json, cat.load, cat.commit_live)
    catalog: dict = {}
    try:
        comfy_specs._cache.clear()
        cat._pending.clear()
        comfy_specs._source = lambda target, alive=None: "http://comfy.test"
        # R2 stays out of it: the catalog tier is whatever this dict says.
        cat.load = lambda target="local", force=False: catalog
        cat.commit_live = lambda **kw: False

        def fake_fetch(url, headers, timeout=None):
            cls = url.rsplit("/", 1)[-1]
            if cls not in OBJECT_INFO:
                raise URLError("404")
            return {cls: OBJECT_INFO[cls]}

        cat._http_get_json = fake_fetch
        res = comfy_specs.specs_for_classes(["BiRefNetRMBG", "NodeThePodLacks"])
        check("a class this ComfyUI does not have is simply absent",
              sorted(res["classes"]), ["BiRefNetRMBG"])
        check("and the rest still resolved", res["ok"], True)
        check("every COMBO list seen live is handed to the shared catalog",
              cat._pending.get("BiRefNetRMBG|model"),
              ["BiRefNet-general", "BiRefNet_toonout", "BiRefNet_lite",
               "AnotherOneInstalledToday"])

        # The panel path: no class is recorded on these params, so each one is
        # resolved through the blueprint's OWN graph — which is what makes an
        # already-published blueprint refresh with no re-import.
        comfy_specs._cache.clear()
        res = comfy_specs.specs_for_blueprint(load_blueprint())
        check("a param resolves its class through the graph it points into",
              res["params"]["sensitivity"],
              {"kind": "float", "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01})
        check("so the model dropdown lists what the pod has TODAY",
              res["params"]["birefnet_model"]["options"][-1],
              "AnotherOneInstalledToday")

        comfy_specs._cache.clear()
        comfy_specs._source = lambda target, alive=None: ""
        res = comfy_specs.specs_for_classes(["BiRefNetRMBG"], target="pod")
        check("nothing answering is an empty answer, never a raise",
              (res["ok"], res["classes"]), (False, {}))
        check("and it says so in one plain sentence", "asleep" in res["note"], True)
        res = comfy_specs.specs_for_classes(["BiRefNetRMBG"], target="local")
        check("and names the local tunnel when that is the target",
              "did not answer" in res["note"], True)

        # The middle tier: with nothing answering, a select falls back to the LAST
        # list anything saw (the shared catalog) before the import-day bake — and a
        # range has no such tier, so it stays whatever the blueprint published.
        catalog.update({"fields": {"BiRefNetRMBG|model": ["FromTheCatalog"]}})
        res = comfy_specs.specs_for_blueprint(load_blueprint())
        check("a list comes from the catalog when the pod is asleep",
              res["params"].get("birefnet_model"),
              {"kind": "select", "options": ["FromTheCatalog"]})
        check("a range does not", "sensitivity" in res["params"], False)
    finally:
        (comfy_specs._source, cat._http_get_json, cat.load, cat.commit_live) = real
        comfy_specs._cache.clear()
        cat._pending.clear()


def test_the_catalog_is_the_machine_that_runs_the_graph() -> None:
    """A contract must describe the machine that will RUN the graph. "pod" is a
    RunPod pod (pinned via `COMFY_CATALOG_URL` or discovered) and never
    `COMFY_BASE` — production still has `COMFY_URL` set to the owner's LOCAL
    tunnel, a different machine; "local" is `COMFY_BASE` and nothing else. The
    rule is `comfy_catalog._probe_sources`', shared with Refresh model lists."""
    import comfy_specs
    ba = comfy_specs.batch_atlas
    cat = comfy_specs.comfy_catalog
    real = (ba.COMFY_BASE, cat._http_get_json, cat.runpod_control.running_pods)
    real_env = os.environ.get("COMFY_CATALOG_URL")
    try:
        ba.COMFY_BASE = "http://local.tunnel"
        cat._http_get_json = lambda url, headers, timeout=None: {}
        cat.runpod_control.running_pods = lambda: []
        os.environ["COMFY_CATALOG_URL"] = "http://catalog.pod"

        check("pod never reads the local tunnel, even when it answers",
              comfy_specs._source("pod", alive=lambda: True), "http://catalog.pod")
        check("local reads the ComfyUI that runs the graph",
              comfy_specs._source("local", alive=lambda: True), "http://local.tunnel")
        check("and local does not borrow the pod when it is down",
              comfy_specs._source("local", alive=lambda: False), "")

        os.environ.pop("COMFY_CATALOG_URL")
        check("pod with nothing pinned and no pod running has no source at all",
              comfy_specs._source("pod", alive=lambda: True), "")
    finally:
        ba.COMFY_BASE, cat._http_get_json, cat.runpod_control.running_pods = real
        if real_env is None:
            os.environ.pop("COMFY_CATALOG_URL", None)
        else:
            os.environ["COMFY_CATALOG_URL"] = real_env


def test_options_from_survives_the_param_whitelist() -> None:
    """`_validate_params` normalizes through an explicit key whitelist, so a new
    field that is not in it is dropped on publish with nothing said — the blueprint
    then behaves as if the author never declared it."""
    bp = video_runner.blueprints
    src = {"class": "BiRefNetRMBG", "field": "model"}
    out = bp._validate_params("t", {"params": [
        {"key": "m", "type": "select", "node": "202", "field": "model",
         "options": ["a"], "options_from": src},
        {"key": "s", "type": "float", "node": "202", "field": "sensitivity",
         "min": 0.0, "max": 1.0, "step": 0.01},
    ]}, {})
    check("options_from survives the whitelist", out[0]["options_from"], src)
    check("and so do the bounds beside it",
          (out[1]["min"], out[1]["max"], out[1]["step"]), (0.0, 1.0, 0.01))

    check_raises("an options_from that is not an object is refused",
                 lambda: bp._validate_params("t", {"params": [
                     {"key": "m", "type": "select", "node": "1", "field": "f",
                      "options": ["a"], "options_from": "BiRefNetRMBG"}]}, {}),
                 "options_from")
    check_raises("and one with no field is refused by name",
                 lambda: bp._validate_params("t", {"params": [
                     {"key": "m", "type": "select", "node": "1", "field": "f",
                      "options": ["a"], "options_from": {"class": "X"}}]}, {}),
                 "'field'")


def test_source_image_required() -> None:
    bp = load_blueprint()
    check("i2v blueprint declares it needs a source image",
          video_runner.blueprint_wants_source_image(bp), True)
    check("a blueprint with no ref role does not",
          video_runner.blueprint_wants_source_image(
              {"bindings": {"positive": {"node": "1", "field": "text"}}}), False)


def test_output_picking() -> None:
    pick = video_runner._pick_video_output
    out = {"images": [
        {"filename": "ComfyUI_preview_00001_.png", "image": "cHJldmlldw=="},
        {"filename": "iwvid_s_001_00001_.webp", "image": "d2VicA=="},
    ]}
    check("prefers OUR prefixed webp over a preview png",
          pick(out, "iwvid_s_001")[0], "iwvid_s_001_00001_.webp")
    check("returns decoded bytes", pick(out, "iwvid_s_001")[1], b"webp")

    # No prefix match (a graph that renamed the save) still finds the webp.
    other = {"images": [
        {"filename": "prev.png", "image": "cA=="},
        {"filename": "thing.webp", "image": "d2VicA=="},
    ]}
    check("falls back to any .webp", pick(other, "nomatch")[0], "thing.webp")

    # A VHS-style blueprint reports under `gifs`; accept it rather than claiming
    # "no output" (the failure mode the current worker collector has today).
    gifs = {"gifs": [{"filename": "a.webp", "image": "d2VicA=="}]}
    check("accepts a `gifs` output key", pick(gifs, "x")[0], "a.webp")

    check_raises("empty output raises", lambda: pick({"images": []}, "x"), "no output")
    check_raises("worker error surfaces verbatim",
                 lambda: pick({"error": "OOM on node 181"}, "x"), "OOM on node 181")


def test_an_empty_payload_names_its_real_cause() -> None:
    """A job RunPod calls COMPLETED that hands back NOTHING is not a graph problem —
    the worker returns `{"images": …}` or `{"error": …}` and never nothing, so an
    empty payload means the render finished and the result was lost on the way back.

    Every failure of this shape in the live records had one thing in common, and it
    was not the graph: background removal switched OFF. The same render is 4.5 MB
    with the cutout and blows RunPod's cap without it, because a LOSSLESS WEBP of
    opaque frames is several times the size of a mostly-transparent one. The old
    message said "job returned no output files", which points at the graph — the one
    place the answer is not."""
    check_raises(
        "an empty payload explains itself",
        lambda: video_runner._pick_video_output({}, "pfx"),
        "too large")
    check_raises(
        "and names the setting that actually fixes it",
        lambda: video_runner._pick_video_output({}, "pfx"),
        "lossless")
    # A result that DID come back but carries no images is a different fault and must
    # keep its own message — that one really is about the graph.
    check_raises(
        "a populated result with no images keeps the old wording",
        lambda: video_runner._pick_video_output({"status": "ok"}, "pfx"),
        "no output files")
    check_raises(
        "and a worker error still wins over both",
        lambda: video_runner._pick_video_output({"error": "comfy execution error"},
                                                "pfx"),
        "comfy execution error")


def test_a_render_is_read_back_from_storage_not_the_wire() -> None:
    """The other half of lifting RunPod's payload cap: the worker reports a SLOT and
    the bytes are fetched from R2. The picking rule stays here — teaching the worker
    to choose would put one decision on both sides of the wire."""
    _stub_world()
    keys = ["c/p/video/_out/pfx_0.webp", "c/p/video/_out/pfx_1.webp"]
    video_runner.storage.put(keys[0], b"PREVIEW")
    video_runner.storage.put(keys[1], b"THE-REAL-RENDER")

    name, blob = video_runner._pick_video_output(
        {"images": [{"filename": "preview.png", "slot": 0},
                    {"filename": "pfx_00001_.webp", "slot": 1}]},
        "pfx", keys)
    check("the .webp wins over a preview, as it always did", name, "pfx_00001_.webp")
    check("and its bytes come from the slot it claimed", blob, b"THE-REAL-RENDER")

    # Inline and uploaded entries must be able to coexist: a failed upload falls back
    # to base64 per FILE, not per job.
    import base64 as _b64
    name2, blob2 = video_runner._pick_video_output(
        {"images": [{"filename": "pfx_00001_.webp",
                     "image": _b64.b64encode(b"INLINE").decode()}]},
        "pfx", keys)
    check("an inline entry still decodes", (name2, blob2), ("pfx_00001_.webp", b"INLINE"))

    check_raises(
        "with NO keys at all it says the render is in R2 and uncollected",
        lambda: video_runner._pick_video_output(
            {"images": [{"filename": "x.webp", "slot": 0, "bytes": 5918564}]},
            "pfx", []),
        "no upload keys")
    check_raises(
        "a slot that was never handed out is refused, not read blindly",
        lambda: video_runner._pick_video_output(
            {"images": [{"filename": "x.webp", "slot": 9}]}, "pfx", keys),
        "never handed out")
    check_raises(
        "and a slot whose object is missing says the URL may have expired",
        lambda: video_runner._pick_video_output(
            {"images": [{"filename": "x.webp", "slot": 0}]}, "pfx",
            ["c/p/video/_out/gone.webp"]),
        "expired")


def test_a_resumed_job_can_still_find_its_uploaded_render() -> None:
    """A deploy mid-render hands the job to a FRESH container, which re-attaches by
    the persisted `job_id`. The upload keys lived only in the submitting process, so
    the result came back saying "slot 0" with nothing to resolve 0 against, and a
    finished, paid render was reported as "output entry carried no data" while the
    file sat in R2 — 5.9 MB of it, exactly the size the worker reported.

    The keys are DERIVED from the prefix now, which is built from the session id and
    the variation index, so both processes compute the same list from the same two
    facts and there is no new stored field to fall out of step."""
    _stub_world()
    prefix = "iwvid_20260902_135136_e5a4_001"
    keys = video_runner._upload_slot_keys(prefix)
    check("the keys a submitting process would sign…",
          keys[0], "clientx/projecty/video/_out/iwvid_20260902_135136_e5a4_001_0.webp")
    # …are the keys a DIFFERENT process derives from the same prefix, with nothing
    # carried over between them.
    check("…are what a fresh process derives from the prefix alone",
          video_runner._upload_slot_keys(prefix), keys)

    video_runner.storage.put(keys[0], b"THE-RENDER-THAT-WAS-NEARLY-LOST")
    name, blob = video_runner._pick_video_output(
        {"images": [{"filename": prefix + "_00001_.webp", "slot": 0,
                     "bytes": 5918564}]},
        prefix, video_runner._upload_slot_keys(prefix))
    check("so the resumed collect finds the render",
          blob, b"THE-RENDER-THAT-WAS-NEARLY-LOST")
    check("under its own name", name, prefix + "_00001_.webp")


def test_the_handoff_degrades_rather_than_failing() -> None:
    """R2 unreachable at submit time must cost the CEILING, not the render: the job
    runs the old way and small renders keep working."""
    _stub_world()
    real = video_runner.storage.presign_put

    def no_presign(key, expires=3600):
        raise RuntimeError("R2 unreachable")

    video_runner.storage.presign_put = no_presign
    try:
        urls, keys = video_runner._upload_slots("pfx")
    finally:
        video_runner.storage.presign_put = real
    check("no slots, and no exception", (urls, keys), ([], []))

    started = video_runner.start_session(_req("still runs"), ("clientx", "projecty"))
    check("and a session still completes on the old path",
          _await_session(started["id"]).get("status"), "finished")


def test_a_session_list_is_complete_or_it_is_an_error() -> None:
    """Owner: "after a refresh most of my generations disappear, as if they were never
    registered!" — and nothing had ever been lost from the bucket. The LIST had
    stopped mentioning it.

    `list_sessions` reads one doc per session, and `storage.get` folds a transport
    failure into the same `None` as a genuinely absent object. A flaky read therefore
    made that session cease to exist, silently, in an answer that looked ordered and
    complete. With thirty-odd sessions that is one round trip per session per refresh:
    likely, not rare, and worse the longer you have used the tool.
    """
    _stub_world()
    ctx = ("clientx", "projecty")
    for name in ("alpha", "beta", "gamma"):
        sid = video_runner.start_session(_req(name), ctx)["id"]
        _await_session(sid)
    with video_runner._LOCK:
        video_runner._SESSIONS.clear()   # force the answer to come from storage
    check("all three list normally", len(video_runner.list_sessions()), 3)

    real = video_runner.storage.get_strict
    hits = {"n": 0}

    def flaky(key):
        hits["n"] += 1
        if "meta.json" in key and hits["n"] == 2:
            raise video_runner.storage.ObjectUnreadable(f"{key}: timeout")
        return real(key)

    video_runner.storage.get_strict = flaky
    try:
        got = video_runner.list_sessions()
    finally:
        video_runner.storage.get_strict = real
    check("a single flaky read is retried, not treated as a missing session",
          len(got), 3)

    def always_down(key):
        raise video_runner.storage.ObjectUnreadable(f"{key}: connection reset")

    video_runner.storage.get_strict = always_down
    try:
        check_raises(
            "and a read that will not come back RAISES rather than shortening the list",
            video_runner.list_sessions, "connection reset")
    finally:
        video_runner.storage.get_strict = real

    # A doc that is genuinely gone, or corrupt, is a different thing: it really is
    # unusable, so skipping it is honest and must NOT take the listing down with it.
    video_runner.storage.delete("clientx/projecty/video/"
                                + video_runner.list_sessions()[0]["id"] + "/meta.json")
    check("a genuinely absent doc is skipped, not raised over",
          len(video_runner.list_sessions()), 2)


def test_opening_and_cancelling_survive_a_flaky_read_too() -> None:
    """The listing was the loudest version, not the only one. Every path that reads a
    stored session had the same fault, so a moment's trouble reaching R2 also produced
    "No such session" on open and on cancel — for a session sitting right there."""
    _stub_world()
    sid = video_runner.start_session(_req("still here"), ("clientx", "projecty"))["id"]
    _await_session(sid)
    with video_runner._LOCK:
        video_runner._SESSIONS.clear()   # force reads to go to storage

    real = video_runner.storage.get_strict
    hits = {"n": 0}

    def first_read_fails(key):
        hits["n"] += 1
        if hits["n"] == 1:
            raise video_runner.storage.ObjectUnreadable(f"{key}: reset by peer")
        return real(key)

    video_runner.storage.get_strict = first_read_fails
    try:
        got = video_runner.get_session(sid)
    finally:
        video_runner.storage.get_strict = real
    check("opening a session rides out one bad read", got is not None, True)
    check("and it is the right session", (got or {}).get("id"), sid)

    hits["n"] = 0
    video_runner.storage.get_strict = first_read_fails
    try:
        res = video_runner.cancel_session(sid)
    finally:
        video_runner.storage.get_strict = real
    check("so does cancelling one", res.get("ok"), True)


def test_absent_and_unreadable_are_not_the_same_answer() -> None:
    """The root cause in one line: `storage.get` returns None for both, so every
    caller that skips a missing object also silently skips one it failed to read."""
    _stub_world()
    video_runner.storage.put("clientx/projecty/video/x/meta.json", b"{}")
    check("a stored object reads back",
          video_runner.storage.get_strict("clientx/projecty/video/x/meta.json"), b"{}")
    check("a genuinely absent one is None",
          video_runner.storage.get_strict("clientx/projecty/video/nope.json"), None)


def test_session_id_validation() -> None:
    check("accepts a generated id",
          video_runner.valid_session_id(video_runner._new_session_id()), True)
    check("rejects a path traversal", video_runner.valid_session_id("../../etc"), False)
    check("rejects empty", video_runner.valid_session_id(""), False)
    check("seeds stay under the JS-safe integer ceiling",
          video_runner.MAX_SEED < (1 << 53), True)


def _stub_world():
    """Replace RunPod + R2 + the path resolver with in-memory doubles, so the
    session lifecycle (threading, context hand-off, persistence, status
    transitions) can be exercised with no GPU, no network and no credentials."""
    import base64 as _b64
    import tempfile
    import time as _time

    import batch_atlas

    tmp = Path(tempfile.mkdtemp(prefix="iw-video-test-"))
    objects: dict[str, bytes] = {}

    # Start from an idle runner. A test that leaves a session behind would
    # otherwise QUEUE the next test's session instead of running it — and now that
    # the dispatcher renews a lease on its own loop, its tail outlives the session's
    # terminal status, so the previous test's worker has to be given the moment it
    # needs to let go or it writes into THIS test's bucket.
    _await_idle()
    # A renew cadence a test can afford. In production this is 10s (a third of the
    # TTL); here every dispatcher wait is bounded by it, so a long one would make
    # every session-shaped fixture wait that long to wind down.
    video_runner.LEASE_RENEW_SECONDS = 0.05
    video_runner._SESSIONS.clear()
    video_runner._QUEUE.clear()
    video_runner._META_ETAGS.clear()
    video_runner._ACTIVE = None
    video_runner._cancel_job = REAL_CANCEL_JOB

    # An etag-aware double, because `_write_meta` is a compare-and-swap now: the
    # whole point is that a stale writer is REFUSED, and a dict that accepts every
    # put cannot tell the fix from the bug.
    etags: dict[str, str] = {}
    stamp = {"n": 0}

    def _put(k, b, c=None, *, if_match=None, if_none_match=None):
        if if_none_match == "*" and k in objects:
            raise video_runner.storage.Conflict(k)
        if if_match and etags.get(k) != if_match:
            raise video_runner.storage.Conflict(k)
        stamp["n"] += 1
        objects[k] = b
        etags[k] = f'"{stamp["n"]:08x}"'
        return etags[k]

    def _get_with_etag(k):
        return (objects[k], etags.get(k, '"0"')) if k in objects else None

    video_runner.storage.put = _put
    video_runner.storage.get_with_etag = _get_with_etag
    video_runner.storage.get = lambda k: objects.get(k)
    # The lease reads and writes through `iw_common.storage` DIRECTLY, while the
    # tool's `storage` is a shim that re-exported those names at import — so
    # patching one module leaves the other holding the real, credentialled client.
    # Both get the double, or the lease quietly talks to R2 in a unit test.
    from iw_common import storage as _shared_storage
    _shared_storage.put = _put
    _shared_storage.get_with_etag = _get_with_etag
    # The listing reads through `get_strict`, whose whole point is that a transport
    # failure is NOT the same answer as a missing object — so the double has to keep
    # them apart too, or the fixture cannot tell the bug from the fix.
    video_runner.storage.get_strict = lambda k: objects.get(k)
    _delete = lambda k: (objects.pop(k, None), etags.pop(k, None))[0]  # noqa: E731
    video_runner.storage.delete = _delete
    _shared_storage.delete = _delete
    # The per-tile delete VERIFIES with `head`, whose contract is that only a real
    # 404 is absence — so the double answers `None` for a missing key rather than
    # raising, or every clean discard would report itself unconfirmed.
    _head = lambda k: ({"size": len(objects[k]), "etag": etags.get(k, '"0"'),  # noqa: E731
                        "mtime": _time.time()} if k in objects else None)
    video_runner.storage.head = _head
    _shared_storage.head = _head
    # `mtime` is part of the real answer and the boot sweep filters on it, so the
    # double has to carry one or the sweep sees every session as ancient.
    video_runner.storage.list_keys = lambda p: [
        {"key": k, "mtime": _time.time()} for k in list(objects) if k.startswith(p)]
    video_runner.storage.list_prefixes = lambda p: sorted({
        k[:len(p) + k[len(p):].index("/") + 1]
        for k in list(objects) if k.startswith(p) and "/" in k[len(p):]})

    video_runner.project_paths.resolve = lambda: {
        "r2_project_prefix": "clientx/projecty", "staging_root": tmp}
    SET_CONTEXT_CALLS.clear()
    video_runner.project_paths.set_context = (
        lambda *a, **k: SET_CONTEXT_CALLS.append((threading.get_ident(), a)) or True)
    video_runner.project_paths.project_name = lambda: "projecty"
    # The listing matches a live session on BOTH keys, so the double has to answer
    # both — with only the project stubbed it would compare "clientx" against the
    # env default and hide every in-memory session.
    video_runner.project_paths.client_name = lambda: "clientx"

    bp = load_blueprint()
    video_runner.blueprints.get_blueprint = lambda i: bp

    # No real refs to resolve — the ref routing is batch_atlas's own contract and
    # is exercised by the still-image path, not re-proven here.
    batch_atlas._serverless_workflow_images = lambda wf: []

    polls: dict[str, int] = {}

    def fake_post(path, payload):
        if path == "/run":
            jid = f"job{len(polls) + 1}"
            polls[jid] = 0
            return {"id": jid}
        return {}

    def fake_get(path):
        jid = path.rsplit("/", 1)[-1]
        polls[jid] = polls.get(jid, 0) + 1
        if polls[jid] < 2:
            return {"status": "IN_PROGRESS"}
        return {"status": "COMPLETED", "output": {"images": [
            {"filename": "out.webp",
             "image": _b64.b64encode(b"WEBPDATA").decode()}]}}

    batch_atlas._runpod_post = fake_post
    batch_atlas._runpod_get = fake_get
    video_runner.POLL_SECONDS = 0.01
    return tmp, objects


def _await_idle(timeout: float = 10.0) -> None:
    """Wait for every dispatcher to have LET GO — not just for `_ACTIVE` to clear.

    `_run_session` settles the session's status first and releases the runner and
    the lease last, so a check made the instant `_await_session` returns is racing
    that tail. And `_ACTIVE` alone is not enough to watch: a fixture that clears it
    by hand (simulating a restart) makes the runner look idle while the previous
    dispatcher is still alive, still heartbeating, and still writing into the
    bucket this fixture is about to make assertions on. The threads are named, so
    wait for the real thing.
    """
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        alive = [t for t in threading.enumerate()
                 if t.name.startswith("video-session-") and t.is_alive()]
        if not alive and video_runner._ACTIVE is None:
            return
        time.sleep(0.02)


def _await_session(sid: str, timeout: float = 15.0) -> dict:
    import time
    deadline = time.time() + timeout
    cur = {}
    while time.time() < deadline:
        cur = video_runner.get_session(sid) or {}
        if cur.get("status") in ("finished", "cancelled"):
            # A terminal STATUS is not the end of the dispatcher: it still has to
            # write the doc, release the lease and hand the runner back. Callers
            # invariably go on to mutate the very doc that tail is about to write,
            # so waiting here is what every one of them actually means.
            _await_idle()
            return video_runner.get_session(sid) or cur
        time.sleep(0.02)
    return cur


def test_session_lifecycle() -> None:
    tmp, objects = _stub_world()
    started = video_runner.start_session(
        {"blueprint": "wan22_i2v_flipbook", "prompt": "a spinning coin",
         "source_ref": "sheet_src/H1.png", "variations": 2,
         "params": {"duration": 2}},
        ("clientx", "projecty"), user="gualt")
    sid = started["id"]

    check("start returns a JSON-safe session (no private keys)",
          [k for k in started if k.startswith("_")], [])
    check("seeds are assigned per variation",
          len({v["seed"] for v in started["variations"]}), 2)

    final = _await_session(sid)
    check("session finishes", final.get("status"), "finished")
    check("every variation completed",
          [v["status"] for v in final["variations"]], ["done", "done"])
    check("files are numbered per variation",
          [v["file"] for v in final["variations"]], ["001.webp", "002.webp"])
    check("payload bytes recorded", final["variations"][0]["bytes"], len(b"WEBPDATA"))

    check("variation mirrored to R2",
          objects.get("clientx/projecty/video/%s/001.webp" % sid), b"WEBPDATA")
    check("variation written to staging",
          (tmp / "video" / sid / "001.webp").read_bytes(), b"WEBPDATA")
    check("meta.json mirrored to R2",
          "clientx/projecty/video/%s/meta.json" % sid in objects, True)

    meta = json.loads(objects["clientx/projecty/video/%s/meta.json" % sid])
    check("meta records the blueprint", meta["blueprint"], "wan22_i2v_flipbook")
    check("meta records the prompt", meta["prompt"], "a spinning coin")
    check("meta carries no private keys", [k for k in meta if k.startswith("_")], [])

    check("read_variation serves the stored bytes",
          video_runner.read_variation(sid, "001.webp"), b"WEBPDATA")
    check("read_variation refuses a traversing name",
          video_runner.read_variation(sid, "../meta.json"), None)

    listed = video_runner.list_sessions()
    check("session is listed", any(s["id"] == sid for s in listed), True)

    # A finished session releases the one-at-a-time guard.
    second = video_runner.start_session(
        {"blueprint": "wan22_i2v_flipbook", "prompt": "p",
         "source_ref": "r.png", "variations": 1}, ("clientx", "projecty"))
    _await_session(second["id"])
    check("a second session can start once the first finished",
          video_runner.get_session(second["id"])["status"], "finished")

    video_runner.delete_session(sid)
    check("delete removes the session's objects",
          [k for k in objects if sid in k], [])


def test_blueprint_kind() -> None:
    """A blueprint belongs to ONE tool. The Atlas Maker's image networks and the
    Flipbook's video networks share a library but must never share a picker."""
    import blueprints

    bp_dir = BP_DIR
    manifest = json.loads((bp_dir / "blueprint.json").read_text(encoding="utf-8"))
    graph = json.loads((bp_dir / "workflow.json").read_text(encoding="utf-8"))

    check("the shipped blueprint declares itself video",
          blueprints.validate_against_graph("wan", dict(manifest), graph)["kind"],
          "video")

    # Every blueprint authored before `kind` existed must keep working AND keep
    # showing up in the Atlas Maker, so absent means image.
    legacy = {k: v for k, v in manifest.items() if k != "kind"}
    check("an absent kind defaults to image",
          blueprints.validate_against_graph("legacy", legacy, graph)["kind"], "image")

    bad = dict(manifest)
    bad["kind"] = "audio"
    check_raises("an unknown kind is refused",
                 lambda: blueprints.validate_against_graph("bad", bad, graph),
                 "not one of")


def test_bundled_blueprints_stay_in_step() -> None:
    """Adding a param to `blueprints_src/` in the repo must reach the live library.

    The first version of the self-seed only published what was MISSING, which
    froze every bundled blueprint at whatever was seeded first — so a repo change
    had no effect on the live tool and nothing said the definition was stale.
    Updating is safe only because a bundled blueprint carries `author:
    iw-builtin` while anything published through the tool is stamped with a real
    username, which is what tells "ours, out of date" apart from "someone's now".
    """
    import tempfile

    import blueprints
    import storage

    tmp = Path(tempfile.mkdtemp(prefix="iw-bp-"))
    blueprints.BLUEPRINTS_STAGING = tmp
    objects: dict[str, bytes] = {}
    storage.get = lambda k: objects.get(k)
    writes: list[str] = []

    def put(k, b, c=None):
        writes.append(k)
        objects[k] = b

    storage.put = put

    key = "_shared/blueprints/wan22_i2v_flipbook/blueprint.json"
    bundled = (BP_DIR / "blueprint.json").read_bytes()

    def cutout_count() -> int:
        return sum(1 for p in json.loads(objects[key])["params"]
                   if p.get("group") == "Cutout")

    blueprints._sync_bundled()
    check("an empty library gets the bundled blueprint", cutout_count(), 9)

    # THE BUG: a stored copy from an earlier release, missing the newer params.
    stale = json.loads(bundled)
    stale["params"] = [p for p in stale["params"] if p.get("group") != "Cutout"][:3]
    objects[key] = json.dumps(stale).encode()
    blueprints._sync_bundled()
    check("a STALE stored copy is brought up to date", cutout_count(), 9)

    writes.clear()
    blueprints._sync_bundled()
    check("an identical copy costs no write at all", writes, [])

    # A human took it over: their version must survive untouched.
    theirs = json.loads(bundled)
    theirs["author"] = "someone"
    theirs["name"] = "Their tuned version"
    objects[key] = json.dumps(theirs).encode()
    writes.clear()
    blueprints._sync_bundled()
    check("a re-published blueprint is never clobbered",
          (json.loads(objects[key])["author"], json.loads(objects[key])["name"]),
          ("someone", "Their tuned version"))
    check("and no write was attempted on it", key in writes, False)


def test_wrong_kind_is_refused() -> None:
    """Defence in depth: the picker is filtered, but a stale tab can still name an
    image blueprint, and running one here burns a GPU job for a single still."""
    _stub_world()
    bp = load_blueprint()
    bp["meta"] = {**bp["meta"], "kind": "image", "name": "Some Atlas Network"}
    video_runner.blueprints.get_blueprint = lambda i: bp
    check_raises("an IMAGE blueprint is refused by the video runner",
                 lambda: video_runner.start_session(
                     {"blueprint": "x", "prompt": "p", "source_ref": "r.png",
                      "variations": 1}, ("clientx", "projecty")),
                 "belongs to the Atlas Maker")


def test_resume_after_restart() -> None:
    """A session lives in memory, so a deploy kills its worker mid-flight. The
    stored meta must carry enough to re-attach to a job RunPod already ran —
    otherwise the result (and the money) is simply lost, which is what happened.
    """
    tmp, objects = _stub_world()
    started = video_runner.start_session(
        {"blueprint": "wan22_i2v_flipbook", "prompt": "p", "source_ref": "r.png",
         "variations": 2}, ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = "clientx/projecty/video/%s/meta.json" % sid
    meta = json.loads(objects[key])
    check("the job id is persisted, not just held in memory",
          bool(meta["variations"][0]["job_id"]), True)

    # Simulate the restart: memory is gone, only the stored meta survives, and it
    # was captured mid-flight with variation 1 running.
    meta["status"] = "running"
    meta["variations"][0].update(status="running", file="", bytes=0)
    meta["variations"][1].update(status="queued")
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    resumed = video_runner.get_session(sid)
    check("reading an orphaned session adopts it", resumed is not None, True)
    final = _await_session(sid)
    check("the resumed session finishes", final.get("status"), "finished")
    check("both variations end up done",
          [v["status"] for v in final["variations"]], ["done", "done"])

    # A variation interrupted BEFORE its id was recorded cannot be re-attached,
    # and must not be silently re-submitted at cost.
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="", file="")
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None
    out = video_runner.get_session(sid)
    v0 = out["variations"][0]
    check("an unrecorded in-flight job is failed, not re-billed", v0["status"], "failed")
    check("and it says why", "restart" in v0["error"].lower(), True)


def test_cancel_a_session_we_do_not_own() -> None:
    """The session someone most wants to stop is the one a restart orphaned — and
    refusing that ("no such running session") left the stop button inert while the
    stored doc went on claiming to run."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(
        {"blueprint": "wan22_i2v_flipbook", "prompt": "p", "source_ref": "r.png",
         "variations": 2}, ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = "clientx/projecty/video/%s/meta.json" % sid
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="job-abc")
    meta["variations"][1].update(status="queued")
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    cancelled = []
    video_runner._cancel_job = lambda jid: cancelled.append(jid)

    res = video_runner.cancel_session(sid)
    check("cancelling an unowned session succeeds", res["ok"], True)
    check("it was recognised as unowned", res["adopted"], True)
    check("the in-flight job is stopped remotely", cancelled, ["job-abc"])

    after = json.loads(objects[key])
    check("the stored session stops claiming to run", after["status"], "cancelled")
    check("its unfinished variations are closed out",
          [v["status"] for v in after["variations"]], ["cancelled", "cancelled"])

    check_raises("an unknown session is still refused",
                 lambda: video_runner.cancel_session("20990101_000000_dead"),
                 "no such session")


def _gate_job(name: str = "job1"):
    """Hold ONE job at IN_PROGRESS until the returned event is set, so a test has a
    genuinely in-flight variation to act around."""
    import threading

    import batch_atlas

    gate = threading.Event()
    passthrough = batch_atlas._runpod_get

    def gated_get(path):
        if path.endswith(name) and not gate.is_set():
            return {"status": "IN_PROGRESS"}
        return passthrough(path)

    batch_atlas._runpod_get = gated_get
    return gate


def _gate_first_job():
    return _gate_job("job1")


def _await_idle(timeout: float = 5.0) -> str | None:
    """Wait for the runner to be handed on.

    A session's status flips to terminal a beat BEFORE `_release` runs — the
    finaliser writes `meta.json` in between — so asserting `_ACTIVE is None` the
    instant `_await_session` returns is a race, and it is the fixture that is
    wrong, not the hand-off."""
    import time
    deadline = time.time() + timeout
    while time.time() < deadline and video_runner._ACTIVE is not None:
        time.sleep(0.01)
    return video_runner._ACTIVE


def _await_var(sid: str, index: int, want: str, timeout: float = 10.0) -> dict:
    import time
    deadline = time.time() + timeout
    cur = {}
    while time.time() < deadline:
        s = video_runner.get_session(sid) or {}
        cur = next((v for v in s.get("variations", [])
                    if v["index"] == index), {})
        if cur.get("status") == want:
            return cur
        time.sleep(0.02)
    return cur


def _await_status(sid: str, want: str, timeout: float = 10.0) -> dict:
    import time
    deadline = time.time() + timeout
    cur = {}
    while time.time() < deadline:
        cur = video_runner.get_session(sid) or {}
        if cur.get("status") == want:
            return cur
        time.sleep(0.02)
    return cur


def _await_in_flight(sid: str, timeout: float = 10.0) -> str:
    """Wait until a variation actually HOLDS a RunPod job id.

    `_await_status(sid, "running")` is not the same thing: the worker marks the
    variation running BEFORE it submits, so for a moment the session is running with
    nothing in flight. A cancel landing in that window has no job to cancel — which is
    real behaviour, but it is not what a test about cancelling a live job means to
    exercise."""
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        for v in (video_runner.get_session(sid) or {}).get("variations", []):
            if v.get("status") == "running" and v.get("job_id"):
                return str(v["job_id"])
        time.sleep(0.02)
    return ""


def _req(prompt: str, variations: int = 1) -> dict:
    return {"blueprint": "wan22_i2v_flipbook", "prompt": prompt,
            "source_ref": "r.png", "variations": variations}


def test_a_queued_session_survives_a_restart() -> None:
    """The destructive half of "after a refresh most of my generations disappear".

    `meta.json` used to be written first by the WORKER, when it started the first
    variation — so a session waiting its turn behind another existed nowhere but in
    RAM. A restart erased it with no trace: no file, no record, nothing to recover.
    Not a lost render, a lost REQUEST.

    Queueing is what makes it likely. The tool invites you to line ideas up behind the
    one running, and every one of them was unwritten until its turn came, so the more
    you had queued the more a single deploy took."""
    tmp, objects = _stub_world()
    ctx = ("clientx", "projecty")

    first = video_runner.start_session(_req("holds the runner"), ctx)
    _await_in_flight(first["id"])
    queued = video_runner.start_session(_req("waiting its turn"), ctx)
    qid = queued["id"]
    check("the second session is genuinely waiting, not running",
          video_runner.get_session(qid).get("queue_position") >= 1, True)
    check("and it is on disk BEFORE any worker has touched it",
          f"clientx/projecty/video/{qid}/meta.json" in objects, True)

    # The restart: memory is gone, only what reached storage survives.
    with video_runner._LOCK:
        video_runner._SESSIONS.clear()
        video_runner._QUEUE.clear()
        video_runner._ACTIVE = None

    listed = [x["id"] for x in video_runner.list_sessions()]
    check("so it is still listed after a restart", qid in listed, True)
    back = video_runner.get_session(qid)
    check("its prompt survived", (back or {}).get("prompt"), "waiting its turn")
    check("with every slot it was created with",
          len((back or {}).get("variations", [])), 1)
    _await_session(qid)


def test_a_second_session_queues() -> None:
    """A second prompt LINES UP behind the running one instead of being refused.
    The refusal is what made an author cancel a paid run just to start the next
    idea — the tool told them to, and the cancel cost the render."""
    _stub_world()
    ctx = ("clientx", "projecty")
    gate = _gate_first_job()
    try:
        first = video_runner.start_session(_req("one"), ctx)
        _await_status(first["id"], "running")

        second = video_runner.start_session(_req("two"), ctx)
        third = video_runner.start_session(_req("three"), ctx)
        check("a second session is queued, not refused", second["status"], "queued")
        check("and it is told where it stands", second["queue_position"], 1)
        check("a third lines up behind it", third["queue_position"], 2)
        check("only one session holds the runner",
              video_runner._ACTIVE, first["id"])
        check("a waiting session has submitted nothing",
              [v["job_id"] for v in second["variations"]], [""])

        # Cancelling a session that never started is free, and closes it out here
        # and now — no worker exists to notice the flag.
        video_runner.cancel_session(second["id"])
        s2 = video_runner.get_session(second["id"])
        check("a waiting session cancels outright", s2["status"], "cancelled")
        check("its variations are closed out",
              [v["status"] for v in s2["variations"]], ["cancelled"])
        check("the one behind it moves up",
              video_runner.get_session(third["id"])["queue_position"], 1)
        check("the running session is untouched by that cancel",
              video_runner.get_session(first["id"])["status"], "running")

        gate.set()
        check("the running session finishes",
              _await_session(first["id"]).get("status"), "finished")
        check("and the queued one then runs on its own",
              _await_session(third["id"]).get("status"), "finished")
        check("a session cancelled while waiting is never run",
              video_runner.get_session(second["id"])["status"], "cancelled")
        check("the runner ends idle", _await_idle(), None)
        check("with nothing left in line", video_runner._QUEUE, [])
        check("queue position is served live, never frozen into meta.json",
              "queue_position" in json.loads(
                  video_runner.storage.get(
                      "clientx/projecty/video/%s/meta.json" % third["id"])),
              False)
    finally:
        gate.set()


def test_queue_depth_is_capped() -> None:
    """The queue is serial, so it never raises the burn RATE — but it does
    extend the tail, and an author lining up an afternoon of GPU time should be
    told, not surprised."""
    _stub_world()
    ctx = ("clientx", "projecty")
    gate = _gate_first_job()
    running = None
    try:
        running = video_runner.start_session(_req("running"), ctx)
        _await_status(running["id"], "running")
        for i in range(video_runner.MAX_QUEUED_SESSIONS):
            video_runner.start_session(_req("waiting %d" % i), ctx)
        check("the queue fills to the cap",
              len(video_runner._QUEUE), video_runner.MAX_QUEUED_SESSIONS)
        check_raises("and the next one is refused with a way out",
                     lambda: video_runner.start_session(_req("overflow"), ctx),
                     "cancel one to make room")
    finally:
        for sid in list(video_runner._QUEUE):
            video_runner.cancel_session(sid)
        gate.set()
        if running:
            _await_session(running["id"])


def test_cancelling_reads_as_cancelled_not_failed() -> None:
    """Stopping a session must READ as stopped. The status poll used to run before
    the cancel flag was re-checked, so RunPod's own CANCELLED came back first and
    the author's stop was painted as a red FAILED tile with a raw status dict in
    it."""
    import batch_atlas

    _stub_world()
    stopped: set[str] = set()
    passthrough = batch_atlas._runpod_post

    def tracking_post(path, payload):
        if path.startswith("/cancel/"):
            stopped.add(path.rsplit("/", 1)[-1])
            return {}
        return passthrough(path, payload)

    def cancel_aware_get(path):
        jid = path.rsplit("/", 1)[-1]
        # Exactly what RunPod reports once a job has been cancelled remotely —
        # the payload that used to reach the author as their "error".
        if jid in stopped:
            return {"id": jid, "status": "CANCELLED"}
        return {"status": "IN_PROGRESS"}

    batch_atlas._runpod_post = tracking_post
    batch_atlas._runpod_get = cancel_aware_get

    started = video_runner.start_session(_req("stop me", variations=3),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_status(sid, "running")
    video_runner.cancel_session(sid)

    final = _await_session(sid)
    check("the session reads as cancelled", final.get("status"), "cancelled")
    check("the in-flight variation reads as cancelled, not failed",
          [v["status"] for v in final["variations"]],
          ["cancelled", "cancelled", "cancelled"])
    check("and carries no error text",
          [v["error"] for v in final["variations"]], ["", "", ""])
    check("the job was stopped remotely, so it stops burning",
          sorted(stopped), ["job1"])
    check("the runner is handed back", _await_idle(), None)


def test_a_transient_status_blip_does_not_lose_a_job() -> None:
    """One unreadable status poll must not fail a variation. RunPod's status API
    returns the odd 500 (and a 404 for a job it has not indexed yet) while the
    render carries on regardless — but the read raised straight out of
    `_await_job`, so a paid, still-running twenty-minute job was reported to the
    author as a red FAILED tile and then left burning with nobody to collect it.
    """
    import batch_atlas

    _stub_world()
    reads = {"n": 0}
    b64 = __import__("base64").b64encode(b"WEBPDATA").decode()

    def flaky_get(path):
        reads["n"] += 1
        # The exact shape the author hit: HTTP 500 mid-render, twice over.
        if reads["n"] in (2, 3):
            raise RuntimeError(
                f"RunPod {path} failed: HTTP 500 Internal Server Error: "
                '{"status":500,"title":"Internal Server Error"}')
        if reads["n"] < 5:
            return {"status": "IN_PROGRESS"}
        return {"status": "COMPLETED", "output": {"images": [
            {"filename": "out.webp", "image": b64}]}}

    cancelled: list[str] = []
    passthrough = batch_atlas._runpod_post

    def tracking_post(path, payload):
        if path.startswith("/cancel/"):
            cancelled.append(path.rsplit("/", 1)[-1])
            return {}
        return passthrough(path, payload)

    batch_atlas._runpod_get = flaky_get
    batch_atlas._runpod_post = tracking_post

    started = video_runner.start_session(_req("ride out a blip"),
                                         ("clientx", "projecty"))
    final = _await_session(started["id"])
    check("the variation rides out the blip and completes",
          [v["status"] for v in final["variations"]], ["done"])
    check("with no error text", final["variations"][0]["error"], "")
    check("and the job is NOT cancelled over a read that merely failed",
          cancelled, [])


def test_contact_lost_for_good_stops_the_job() -> None:
    """The other side of the grace window: once reads have failed CONTINUOUSLY
    for `STATUS_GRACE_SECONDS` the job really is unreachable, so it is stopped
    rather than left to bill out the endpoint's whole timeout unread."""
    import batch_atlas

    _stub_world()
    grace = video_runner.STATUS_GRACE_SECONDS
    video_runner.STATUS_GRACE_SECONDS = 0.05

    def always_500(path):
        raise RuntimeError(f"RunPod {path} failed: HTTP 500 Internal Server Error")

    cancelled: list[str] = []
    passthrough = batch_atlas._runpod_post

    def tracking_post(path, payload):
        if path.startswith("/cancel/"):
            cancelled.append(path.rsplit("/", 1)[-1])
            return {}
        return passthrough(path, payload)

    batch_atlas._runpod_get = always_500
    batch_atlas._runpod_post = tracking_post
    try:
        started = video_runner.start_session(_req("gone for good"),
                                             ("clientx", "projecty"))
        final = _await_session(started["id"])
    finally:
        video_runner.STATUS_GRACE_SECONDS = grace
    check("a job we can no longer read is failed", 
          [v["status"] for v in final["variations"]], ["failed"])
    check("the message says contact was lost, not that the job failed",
          "lost contact" in final["variations"][0]["error"], True)
    check("and it is stopped so it stops burning", cancelled, ["job1"])


def _job_not_found(path):
    """RunPod's answer for a job it no longer has — the literal body from the
    2026-09-07 incident."""
    import batch_atlas
    raise batch_atlas.RunPodHTTPError(
        404, f"RunPod {path} failed: HTTP 404 Not Found: "
             '{"status":404,"title":"Not Found","detail":"job not found"}')


def _worker_that_uploads(blob: bytes):
    """`(_upload_slots, _submit)` doubles for a worker that delivers its render to
    R2 rather than through RunPod.

    The slots have to be handed out by hand because the stub world has no R2 to
    presign against, and the render has to land AFTER `_submit` — which empties the
    slots on the way past, so that a re-roll can never rescue the attempt before
    it."""
    real_submit = video_runner._submit

    def slots(prefix):
        keys = video_runner._upload_slot_keys(prefix)
        return [f"https://r2.invalid/{k}" for k in keys], keys

    def submit(wf, prefix=""):
        jid, wf_out, keys = real_submit(wf, prefix)
        if keys:
            video_runner.storage.put(keys[0], blob)
        return jid, wf_out, keys
    return slots, submit


def _interrupted(objects: dict, sid: str, index: int = 1) -> str:
    """Rewrite a session's stored doc the way a container swap leaves it: the
    variation is back to `running` with its job id persisted, and memory is empty.
    Returns the meta key."""
    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    for v in meta["variations"]:
        if v["index"] == index:
            v.update(status="running", file="", bytes=0)
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None
    return key


def _cancel_tracker(cancelled: list):
    import batch_atlas
    passthrough = batch_atlas._runpod_post

    def tracking_post(path, payload):
        if path.startswith("/cancel/"):
            cancelled.append(path.rsplit("/", 1)[-1])
            return {}
        return passthrough(path, payload)
    return tracking_post


def test_a_purged_job_collects_the_render_it_left_in_r2() -> None:
    """The 2026-09-07 loss, end to end. A Railway rollout takes the poller with it;
    the GPU finishes anyway and PUTs the render into its hand-off slot; the next
    container re-attaches by the persisted job id — and RunPod, which keeps a
    finished job about half an hour, answers 404 "job not found". Five renders were
    reported to the author as "lost contact with RunPod" while sitting complete in
    R2, and had to be moved back into their sessions by hand.

    A 404 is an ANSWER, not a failure to answer, so a RE-ATTACHED job — one this
    process never submitted and RunPod no longer admits to — must not burn the
    three-minute grace budgeted for an unreadable API, and the collect must go
    where the render actually is."""
    import batch_atlas

    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("purged mid-render"),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)
    _interrupted(objects, sid)
    # What the GPU delivered while the poller was already gone.
    video_runner.storage.put(
        video_runner._upload_slot_keys(f"iwvid_{sid}_001")[0], b"THE-RENDER-THAT-RAN")

    cancelled: list[str] = []
    batch_atlas._runpod_get = _job_not_found
    batch_atlas._runpod_post = _cancel_tracker(cancelled)
    long_grace, short_grace = (video_runner.STATUS_GRACE_SECONDS,
                               video_runner.NOT_FOUND_GRACE_SECONDS)
    # The long grace stays LONG: if a 404 on a re-attach fell through to it, the
    # session would still be running when this test gives up waiting, and that is
    # the assertion.
    video_runner.STATUS_GRACE_SECONDS = 30.0
    video_runner.NOT_FOUND_GRACE_SECONDS = 0.05
    try:
        video_runner.get_session(sid)  # someone opens it: re-attach
        final = _await_session(sid, timeout=8.0)
    finally:
        video_runner.STATUS_GRACE_SECONDS = long_grace
        video_runner.NOT_FOUND_GRACE_SECONDS = short_grace

    v = (final.get("variations") or [{}])[0]
    check("a job RunPod has forgotten is not a lost render", v.get("status"), "done")
    check("the bytes are the ones the worker uploaded",
          v.get("bytes"), len(b"THE-RENDER-THAT-RAN"))
    check("and the tile carries no error", v.get("error"), "")
    check("nothing is 'cancelled' that RunPod has no record of", cancelled, [])


def test_a_purged_job_with_nothing_to_collect_says_what_happened() -> None:
    """The other half: 404 and an EMPTY slot really is a lost variation — and the
    message must name the cause. "lost contact with RunPod for 182s" sent the owner
    looking for a network fault; the job record had simply expired because nothing
    had watched it for two and a half hours."""
    import batch_atlas

    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("nothing to collect"),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)
    _interrupted(objects, sid)

    cancelled: list[str] = []
    batch_atlas._runpod_get = _job_not_found
    batch_atlas._runpod_post = _cancel_tracker(cancelled)
    short_grace = video_runner.NOT_FOUND_GRACE_SECONDS
    video_runner.NOT_FOUND_GRACE_SECONDS = 0.05
    try:
        video_runner.get_session(sid)
        final = _await_session(sid, timeout=8.0)
    finally:
        video_runner.NOT_FOUND_GRACE_SECONDS = short_grace

    v = (final.get("variations") or [{}])[0]
    check("with an empty slot the variation does fail", v.get("status"), "failed")
    check("and it says the record is gone, not that contact was lost",
          "no longer has a record" in v.get("error", ""), True)
    check("still nothing to cancel", cancelled, [])


def test_an_unreadable_job_still_collects_a_render_that_landed() -> None:
    """The rescue is not 404-only. Any outcome we could not read leaves the render
    question open, so the slot is checked whatever made the status unreadable —
    including the 500 run that `test_contact_lost_for_good_stops_the_job` covers,
    where the job is stopped first because it may still be burning."""
    import batch_atlas

    _stub_world()

    def always_500(path):
        raise RuntimeError(f"RunPod {path} failed: HTTP 500 Internal Server Error")

    cancelled: list[str] = []
    batch_atlas._runpod_get = always_500
    batch_atlas._runpod_post = _cancel_tracker(cancelled)
    real_slots, real_submit = video_runner._upload_slots, video_runner._submit
    grace = video_runner.STATUS_GRACE_SECONDS
    video_runner._upload_slots, video_runner._submit = _worker_that_uploads(
        b"LANDED-ANYWAY")
    video_runner.STATUS_GRACE_SECONDS = 0.05
    try:
        started = video_runner.start_session(_req("unreadable but landed"),
                                             ("clientx", "projecty"))
        final = _await_session(started["id"], timeout=8.0)
    finally:
        video_runner._upload_slots, video_runner._submit = real_slots, real_submit
        video_runner.STATUS_GRACE_SECONDS = grace

    v = (final.get("variations") or [{}])[0]
    check("an unreadable job whose render landed is done", v.get("status"), "done")
    check("the job is still stopped, because it might have been running",
          cancelled, ["job1"])


def test_a_job_runpod_calls_failed_still_hands_back_its_render() -> None:
    """The rescue used to hang off `_Unresolved` alone, so it only fired when the
    OUTCOME was unreadable. Every other way of ending badly walked straight past a
    finished render sitting in R2: RunPod reporting FAILED or TIMED_OUT after the
    worker's upload, a COMPLETED job whose payload came back empty, a stop landing
    a moment late. Same "paid render, red tile", one branch along."""
    import batch_atlas

    _stub_world()
    real_slots, real_submit = video_runner._upload_slots, video_runner._submit
    video_runner._upload_slots, video_runner._submit = _worker_that_uploads(
        b"UPLOADED-THEN-THE-JOB-DIED")

    def failed_after_upload(path):
        return {"status": "FAILED", "error": "worker fell over after saving"}

    batch_atlas._runpod_get = failed_after_upload
    try:
        started = video_runner.start_session(_req("failed but delivered"),
                                             ("clientx", "projecty"))
        final = _await_session(started["id"], timeout=8.0)
    finally:
        video_runner._upload_slots, video_runner._submit = real_slots, real_submit

    v = (final.get("variations") or [{}])[0]
    check("a FAILED job whose render landed is collected, not reported as failed",
          v.get("status"), "done")
    check("with the uploaded bytes", v.get("bytes"),
          len(b"UPLOADED-THEN-THE-JOB-DIED"))
    check("and no error on the tile", v.get("error"), "")


def test_an_empty_payload_is_not_a_lost_render_when_the_slot_has_one() -> None:
    """`COMPLETED` with nothing in it means the result was lost between the worker
    and us — which is exactly when the slot is worth reading before giving up."""
    import batch_atlas

    _stub_world()
    real_slots, real_submit = video_runner._upload_slots, video_runner._submit
    video_runner._upload_slots, video_runner._submit = _worker_that_uploads(
        b"TOO-BIG-TO-RETURN-BUT-IN-R2")
    batch_atlas._runpod_get = lambda path: {"status": "COMPLETED", "output": {}}
    try:
        started = video_runner.start_session(_req("empty payload"),
                                             ("clientx", "projecty"))
        final = _await_session(started["id"], timeout=8.0)
    finally:
        video_runner._upload_slots, video_runner._submit = real_slots, real_submit

    check("the render comes from the slot instead of the empty payload",
          (final.get("variations") or [{}])[0].get("status"), "done")


def test_a_stop_after_the_upload_keeps_the_render() -> None:
    """Cancel stops the SPEND. The GPU time behind a render already in R2 is spent
    either way, and a re-roll of that slot would delete it (`_submit` empties the
    slots), so "leave it for later" is not an option — take it."""
    import batch_atlas

    tmp, objects = _stub_world()
    real_slots, real_submit = video_runner._upload_slots, video_runner._submit
    video_runner._upload_slots, video_runner._submit = _worker_that_uploads(
        b"DELIVERED-JUST-BEFORE-THE-STOP")

    started = video_runner.start_session(_req("stop me"), ("clientx", "projecty"))
    sid = started["id"]

    def never_settles(path):
        return {"status": "IN_PROGRESS"}

    batch_atlas._runpod_get = never_settles
    try:
        import time as _t
        deadline = _t.time() + 5
        while _t.time() < deadline:
            live = video_runner.get_session(sid) or {}
            if (live.get("variations") or [{}])[0].get("job_id"):
                break
            _t.sleep(0.02)
        video_runner.cancel_session(sid)
        final = _await_session(sid, timeout=8.0)
    finally:
        video_runner._upload_slots, video_runner._submit = real_slots, real_submit

    v = (final.get("variations") or [{}])[0]
    check("a stop that lands after the upload keeps the render",
          v.get("status"), "done")
    check("and the file is persisted under the session",
          f"clientx/projecty/video/{sid}/001.webp" in objects, True)


def test_a_lost_job_id_does_not_lose_the_render_too() -> None:
    """`_adopt`'s one irrecoverable case — a variation interrupted before its job
    id reached storage — is only irrecoverable for the JOB. The slot keys come from
    the session id and the variation index, never from the job id, so the render is
    still addressable; marking the tile failed without looking threw it away."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("id lost, render kept", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="", file="", bytes=0)
    objects[key] = json.dumps(meta).encode()
    video_runner.storage.put(
        video_runner._upload_slot_keys(f"iwvid_{sid}_001")[0], b"ORPHANED-BUT-HERE")
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    out = video_runner.get_session(sid) or {}
    v = (out.get("variations") or [{}])[0]
    check("the render is collected instead of the tile being failed",
          v.get("status"), "done")
    check("with the bytes that were in the slot", v.get("bytes"),
          len(b"ORPHANED-BUT-HERE"))
    _await_session(sid)

    # …and with an EMPTY slot it still refuses to re-bill a job it cannot re-attach.
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="", file="", bytes=0)
    objects[key] = json.dumps(meta).encode()
    video_runner.storage.delete(video_runner._upload_slot_keys(f"iwvid_{sid}_001")[0])
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None
    v = ((video_runner.get_session(sid) or {}).get("variations") or [{}])[0]
    check("an unrecorded job with nothing uploaded is still failed, not re-billed",
          v.get("status"), "failed")
    check("and says nothing was uploaded",
          "nothing was uploaded" in v.get("error", ""), True)


def test_a_restart_reattaches_before_anyone_opens_the_page() -> None:
    """Adoption existed, but only a READ triggered it — and the reader is a person.
    On 2026-09-07 two sessions sat orphaned for two and a half hours because nobody
    opened them, which is precisely how their jobs aged past RunPod's record.

    So the container sweeps for interrupted sessions when it BOOTS. Narrowly: only
    work already submitted (a `running` variation with a job id) is re-attached — a
    session whose variations are merely queued has spent nothing, and starting one
    from a stored doc would bill a GPU nobody asked to start."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("orphaned by a deploy", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    interrupted = json.loads(objects[key])
    interrupted["status"] = "running"
    interrupted["variations"][0].update(status="running", file="", bytes=0)
    objects[key] = json.dumps(interrupted).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    check("the boot sweep finds the session the last container was rendering",
          video_runner.resume_orphans(), [sid])
    final = _await_session(sid)
    check("and finishes it with nobody having opened the page",
          final.get("status"), "finished")
    check("collecting the job that was already paid for",
          [v["status"] for v in final["variations"]], ["done", "done"])

    # Nothing submitted => nothing to collect => not ours to start.
    queued = json.loads(objects[key])
    queued["status"] = "running"
    queued["variations"][0].update(status="queued", job_id="", file="", bytes=0)
    objects[key] = json.dumps(queued).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None
    check("a session with nothing paid for is left for its author to open",
          video_runner.resume_orphans(), [])


def test_a_boot_collects_the_running_job_and_starts_nothing_else() -> None:
    """The sharp edge of the same rule, inside ONE session. A grid interrupted at
    variation 1 of 3 has two slots its author queued and nothing has spent — so a
    boot that "resumed" it would submit those two unattended, hours after they
    walked away, once per rollout that caught the session.

    The boot collects the job RunPod is already holding, leaves the tail queued,
    and hands the session back to storage still `running`. Opening it is what
    starts the rest, which is a person deciding to spend."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("collect, don't start", variations=3),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", file="", bytes=0)
    for v in meta["variations"][1:]:
        v.update(status="queued", job_id="", file="", bytes=0)
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    submits_before = _job_ids_issued(objects, key)
    check("the boot sweep takes it on", video_runner.resume_orphans(), [sid])
    settled = _await_handed_back(objects, key, sid)
    check("the job already paid for is collected",
          settled["variations"][0]["status"], "done")
    check("and the tail it never started is still queued",
          [v["status"] for v in settled["variations"][1:]], ["queued", "queued"])
    check("so the session is still running, not falsely finished",
          settled.get("status"), "running")
    check("with no new job submitted by the boot",
          _job_ids_issued(objects, key), submits_before)
    _await_idle()
    check("and the runner is free again", video_runner._ACTIVE, None)

    # A person opens it: THAT starts what is left.
    video_runner.get_session(sid)
    final = _await_session(sid)
    check("opening the session finishes the tail", final.get("status"), "finished")
    check("every tile done", [v["status"] for v in final["variations"]],
          ["done", "done", "done"])


def _job_ids_issued(objects: dict, key: str) -> list[str]:
    return [v.get("job_id") for v in json.loads(objects[key])["variations"]]


def _await_handed_back(objects: dict, key: str, sid: str,
                       timeout: float = 15.0) -> dict:
    """Wait for a collect-only pass to finish: it settles nothing, so what marks the
    end is the session leaving memory for whoever opens it next."""
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        with video_runner._LOCK:
            live = sid in video_runner._SESSIONS
        if not live:
            break
        time.sleep(0.02)
    return json.loads(objects[key])


def test_two_adopters_cannot_take_the_same_session_twice() -> None:
    """A boot sweep and a reconnecting browser are two adopters, and they arrive at
    the same moment by construction — the sweep runs because the container just
    restarted, which is when the page reconnects.

    Adoption used to read `_SESSIONS`, decide the session was orphaned, and only
    then install its own copy: two of them would each install a dict and start a
    worker over it, and with separate `in_flight` sets neither claim excluded the
    other — the same queued variation submitted twice, one job id overwritten and
    never collected, and two dicts racing each other's `meta.json`."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("one owner only", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", file="", bytes=0)
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    video_runner.get_session(sid)                      # the page reconnects
    with video_runner._LOCK:
        live = video_runner._SESSIONS.get(sid)
    second = video_runner._adopt(json.loads(objects[key]), collect_only=True)
    with video_runner._LOCK:
        check("the second adopter does not install a copy of its own",
              video_runner._SESSIONS.get(sid) is live, True)
    check("it answers with the session that is already live",
          (second or {}).get("id"), sid)
    final = _await_session(sid)
    check("and the session still finishes exactly once",
          [v["status"] for v in final["variations"]], ["done", "done"])


def test_a_404_before_the_job_is_ever_read_keeps_the_long_grace() -> None:
    """The short grace is for a record that is GONE, and a 404 only means that if
    the job was ever known to exist. RunPod also 404s a job it has not INDEXED yet,
    seconds after submit — giving up on that one in fifteen seconds would abandon a
    live render, uncancelled, to bill out the endpoint's own timeout.

    So a first-poll 404 on a job this process submitted waits the full window and
    then stops the job, exactly as an unreadable API does."""
    import batch_atlas

    _stub_world()
    cancelled: list[str] = []
    batch_atlas._runpod_get = _job_not_found
    batch_atlas._runpod_post = _cancel_tracker(cancelled)
    long_grace, short_grace = (video_runner.STATUS_GRACE_SECONDS,
                               video_runner.NOT_FOUND_GRACE_SECONDS)
    video_runner.STATUS_GRACE_SECONDS = 0.05
    video_runner.NOT_FOUND_GRACE_SECONDS = 0.05
    try:
        started = video_runner.start_session(_req("never indexed"),
                                             ("clientx", "projecty"))
        final = _await_session(started["id"], timeout=8.0)
    finally:
        video_runner.STATUS_GRACE_SECONDS = long_grace
        video_runner.NOT_FOUND_GRACE_SECONDS = short_grace

    v = (final.get("variations") or [{}])[0]
    check("a job we never once read is treated as unreachable, not as gone",
          "lost contact" in v.get("error", ""), True)
    check("so it is stopped rather than left to bill", cancelled, ["job1"])


def test_a_mixed_run_of_bad_reads_takes_the_long_grace() -> None:
    """404 then 500 is not a record that vanished — it is an API we cannot read, and
    it must widen back to the full window rather than giving up on the short one."""
    import batch_atlas

    _stub_world()
    reads = {"n": 0}

    def flaky(path):
        reads["n"] += 1
        if reads["n"] == 1:
            return {"status": "IN_PROGRESS"}      # seen once: the record exists
        if reads["n"] == 2:
            _job_not_found(path)                  # …and now it 404s
        raise RuntimeError(f"RunPod {path} failed: HTTP 500 Internal Server Error")

    cancelled: list[str] = []
    batch_atlas._runpod_get = flaky
    batch_atlas._runpod_post = _cancel_tracker(cancelled)
    long_grace, short_grace = (video_runner.STATUS_GRACE_SECONDS,
                               video_runner.NOT_FOUND_GRACE_SECONDS)
    video_runner.STATUS_GRACE_SECONDS = 1.5
    video_runner.NOT_FOUND_GRACE_SECONDS = 0.05
    try:
        started = video_runner.start_session(_req("mixed failures"),
                                             ("clientx", "projecty"))
        final = _await_session(started["id"], timeout=8.0)
    finally:
        video_runner.STATUS_GRACE_SECONDS = long_grace
        video_runner.NOT_FOUND_GRACE_SECONDS = short_grace

    v = (final.get("variations") or [{}])[0]
    check("a run that stops being 404-only latches back to the long grace",
          "lost contact" in v.get("error", ""), True)
    check("and takes more than the zero-length 404 window to get there",
          reads["n"] > 2, True)


def test_a_reroll_cannot_rescue_the_attempt_before_it() -> None:
    """The slot keys are derived from the session id and the variation index, so a
    re-roll reuses the ones its own earlier attempt wrote into — and the slots are
    only cleared on a successful collect. Without emptying them at submit, a re-roll
    that ended unreadable would rescue the PREVIOUS attempt's render and show it as
    the new seed's."""
    _stub_world()
    prefix = "iwvid_20260907_134356_d3ed_005"
    keys = video_runner._upload_slot_keys(prefix)
    video_runner.storage.put(keys[0], b"THE-ATTEMPT-BEFORE")
    check("a stale render can be sitting in the slot",
          video_runner._rescue_upload(keys), b"THE-ATTEMPT-BEFORE")

    real_slots = video_runner._upload_slots
    video_runner._upload_slots, _ = _worker_that_uploads(b"")
    try:
        video_runner._submit({"1": {"class_type": "X", "inputs": {}}}, prefix)
    finally:
        video_runner._upload_slots = real_slots
    check("submitting the next attempt empties it first",
          video_runner._rescue_upload(keys), None)


def test_the_rescue_prefers_the_clip_over_a_preview() -> None:
    """Slot order is the worker's output order, not a ranking, and a graph may emit
    a preview beside the clip — the same reason `_pick_video_output` exists. Taking
    whatever is in the lowest slot would hand back the preview."""
    _stub_world()
    keys = video_runner._upload_slot_keys("iwvid_test_002")
    preview = b"RIFF" + b"\x00" * 60 + b"a still frame, no ANIM chunk, and bigger" * 4
    clip = b"RIFF" + b"\x00" * 8 + b"WEBPVP8X" + b"\x00" * 8 + b"ANIM" + b"frames"
    video_runner.storage.put(keys[0], preview)
    video_runner.storage.put(keys[1], clip)
    check("the animated one wins even from the higher slot",
          video_runner._rescue_upload(keys), clip)


def test_an_unreadable_slot_is_not_an_empty_one() -> None:
    """`storage.get` answers a flaky read and a missing object identically, so
    rescuing through it would report a finished render as a failure over one bad
    read — the bug being fixed, one layer down."""
    _stub_world()
    keys = video_runner._upload_slot_keys("iwvid_test_003")
    video_runner.storage.put(keys[0], b"THE-RENDER")
    tries = {"n": 0}
    real = video_runner.storage.get_strict

    def flaky_strict(k):
        tries["n"] += 1
        if tries["n"] < 3:
            raise video_runner.storage.ObjectUnreadable(f"R2 hiccup on {k}")
        return real(k)

    video_runner.storage.get_strict = flaky_strict
    try:
        check("the rescue retries a transport failure instead of calling it empty",
              video_runner._rescue_upload(keys), b"THE-RENDER")
    finally:
        video_runner.storage.get_strict = real


def test_a_failure_before_the_job_exists_still_settles_the_tile() -> None:
    """The widened failure arm reads `upload_keys`, which is bound INSIDE the try —
    so every way of dying before `_submit` returns (RunPod refusing `/run`, a
    missing ref image, a bad blueprint, an R2 wobble on the first meta write) hit
    the handler with the name unbound, raised out of a function whose contract is
    "never raises", and left the tile spinning at `running` with no error and no
    way to re-roll it. The most ordinary failure of all, turned into the exact
    symptom this work exists to remove."""
    import batch_atlas

    _stub_world()
    passthrough = batch_atlas._runpod_post

    def refuse_run(path, payload):
        if path == "/run":
            raise RuntimeError(
                "RunPod /run failed: HTTP 500 Internal Server Error")
        return passthrough(path, payload)

    batch_atlas._runpod_post = refuse_run
    started = video_runner.start_session(_req("submit refused"),
                                         ("clientx", "projecty"))
    final = _await_session(started["id"], timeout=8.0)

    v = (final.get("variations") or [{}])[0]
    check("a refused submit settles the tile", v.get("status"), "failed")
    check("and says why", "HTTP 500" in v.get("error", ""), True)
    check("the session does not sit there claiming to run",
          final.get("status"), "finished")


def test_a_rescue_that_cannot_be_persisted_does_not_wedge_the_runner() -> None:
    """`_collect_stranded` runs inside `except` arms, where a raise is not caught by
    a sibling handler — it escapes `_run_variation`, whose claim `run_one`'s
    `finally` has already released, so the dispatcher re-picks the still-`running`
    tile as a resume candidate and spins on it (measured at ~500 re-attaches in six
    seconds, with `_ACTIVE` pinned and every later Generate refused). An R2 PUT
    wobble is enough to trigger it."""
    import batch_atlas

    _stub_world()
    real_slots, real_submit = video_runner._upload_slots, video_runner._submit
    video_runner._upload_slots, video_runner._submit = _worker_that_uploads(
        b"LANDED-BUT-UNSAVEABLE")
    real_put = video_runner.storage.put

    def put_that_fails_on_the_render(key, body, ctype=None):
        if key.endswith(".webp") and "/_out/" not in key:
            raise RuntimeError("R2 PUT wobble")
        return real_put(key, body, ctype)

    batch_atlas._runpod_get = lambda path: {"status": "FAILED", "error": "died"}
    video_runner.storage.put = put_that_fails_on_the_render
    try:
        started = video_runner.start_session(_req("unsaveable rescue"),
                                             ("clientx", "projecty"))
        final = _await_session(started["id"], timeout=10.0)
    finally:
        video_runner.storage.put = real_put
        video_runner._upload_slots, video_runner._submit = real_slots, real_submit

    v = (final.get("variations") or [{}])[0]
    check("the variation still reaches a terminal state", v.get("status"), "failed")
    check("the session finishes instead of spinning", final.get("status"),
          "finished")
    _await_idle()
    check("and the runner is handed back", video_runner._ACTIVE, None)


def test_a_stale_slot_is_not_offered_as_this_attempt_s_render() -> None:
    """The paths that do NOT go through `_submit` — `_adopt`'s lost-job-id arm, a
    `queued` tile caught by a sweep — cannot rely on the submit-time clear, so they
    date the slot against the attempt's `started`. Without that, a tile stopped and
    then re-rolled could come back green showing the CANCELLED attempt's render
    under the new seed's recipe: wrong bytes, silently, which is worse than the red
    tile it replaces."""
    _stub_world()
    keys = video_runner._upload_slot_keys(
        video_runner._slot_prefix("20260907_120000_abcd", 1))
    video_runner.storage.put(keys[0], b"AN-OLDER-ATTEMPT")
    check("undated, the slot is collected as before",
          video_runner._rescue_upload(keys), b"AN-OLDER-ATTEMPT")
    check("dated against a LATER attempt, it is ignored",
          video_runner._rescue_upload(keys, newer_than=video_runner._now() + 60),
          None)
    check("dated against an EARLIER attempt, it is still collected",
          video_runner._rescue_upload(keys, newer_than=video_runner._now() - 60),
          b"AN-OLDER-ATTEMPT")


def test_a_rescue_during_adoption_is_persisted() -> None:
    """`_keep` empties the slot, so unlike a `failed` verdict a rescued `done` is
    NOT re-derivable: a later read that found the doc still saying `running` would
    look in an empty slot, write `failed`, and orphan the render just rescued."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("persist my rescue", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="", file="", bytes=0,
                                 started=video_runner._now() - 5)
    objects[key] = json.dumps(meta).encode()
    video_runner.storage.put(
        video_runner._upload_slot_keys(video_runner._slot_prefix(sid, 1))[0],
        b"RESCUED-DURING-ADOPTION")
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    video_runner.get_session(sid)
    stored = json.loads(objects[key])
    v = stored["variations"][0]
    check("the rescue is written back to storage, not just to memory",
          v.get("status"), "done")
    check("with the file recorded", v.get("file"), "001.webp")
    _await_session(sid)


def test_stopping_an_orphaned_session_keeps_what_it_delivered() -> None:
    """The session someone most wants to stop is the orphaned one — which is also
    the one whose job has had the longest to finish and upload. That arm settled
    every tile `cancelled` in the stored doc without ever looking in the slot."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("stop the orphan"),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="job-orphan", file="",
                                 bytes=0, started=video_runner._now() - 5)
    objects[key] = json.dumps(meta).encode()
    video_runner.storage.put(
        video_runner._upload_slot_keys(video_runner._slot_prefix(sid, 1))[0],
        b"PAID-AND-DELIVERED")
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    video_runner.cancel_session(sid)
    v = json.loads(objects[key])["variations"][0]
    check("a stop does not discard a render already in R2", v.get("status"), "done")
    check("with its bytes", v.get("bytes"), len(b"PAID-AND-DELIVERED"))


def test_deleting_a_session_takes_its_hand_off_slots_with_it() -> None:
    """The slots live under `video/_out/`, not under the session, so a delete that
    walked only the session prefix leaked one object per stranded render — paid
    for, unreferenced and unreachable."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("delete me"), ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)
    slot = video_runner._upload_slot_keys(video_runner._slot_prefix(sid, 7))[0]
    video_runner.storage.put(slot, b"LEFTOVER")
    check("a slot object exists before the delete", slot in objects, True)

    video_runner.delete_session(sid)
    check("the session's objects are gone",
          [k for k in objects if f"/video/{sid}/" in k], [])
    check("and so are its hand-off slots", slot in objects, False)


def test_a_delete_r2_refused_is_reported_not_drawn_as_gone() -> None:
    """`storage.delete` swallows every error, so a read-only token produced a
    session that vanished from the rail while every byte it owned stayed in the
    bucket — billed, unreachable, and invisible. The delete now re-lists and says
    so, which is the same verify pass the Sheet Maker's delete already runs."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("refuse me"), ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)
    before = sorted(k for k in objects if f"/video/{sid}/" in k)
    check("the session has objects before the delete", bool(before), True)

    # A token that may list but not delete — exactly how R2 answers a misconfigured
    # key, and indistinguishable from success to every caller before this.
    video_runner.storage.delete = lambda k: None

    check_raises("a refused delete raises",
                 lambda: video_runner.delete_session(sid), "still remain")
    check("nothing was reported gone that is still there",
          sorted(k for k in objects if f"/video/{sid}/" in k), before)
    check("and staging is left intact, so the render is still viewable",
          (tmp / "video" / sid / "001.webp").is_file(), True)
    # The rail is rebuilt from the stored meta, so the row comes back rather than
    # leaving the surviving objects with nothing pointing at them.
    check("the session is listed again after the refusal",
          any(s["id"] == sid for s in video_runner.list_sessions()), True)


def test_a_delete_that_cannot_be_verified_is_not_called_clean() -> None:
    """"I could not check" is not "there is nothing there". A listing that throws
    used to be caught and printed while the delete returned ok, so a transport
    failure read as a successful removal."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("unverifiable"), ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    def _blow_up(prefix):
        raise URLError("r2 unreachable")

    video_runner.storage.list_keys = _blow_up
    check_raises("an unverifiable delete raises",
                 lambda: video_runner.delete_session(sid), "still remain")
    check("staging survives an unverifiable delete",
          (tmp / "video" / sid / "001.webp").is_file(), True)


def test_the_sweep_rehomes_a_render_nothing_is_coming_back_for() -> None:
    """The backstop. Every terminal path collects now, so a hand-off slot should
    only ever be occupied between a worker's PUT and its collect — but on
    2026-09-07 thirteen finished renders sat in `_out/` for up to five days and
    were found only because someone went looking. This is what makes the invariant
    checkable instead of assumed."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("sweep me", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    final = _await_session(sid)
    check("the session settles first", final.get("status"), "finished")

    # v001 is `done`; strand a render for v002 as if its collect never happened.
    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["variations"][1].update(status="failed", file="", bytes=0,
                                 error="job FAILED: worker fell over",
                                 started=video_runner._now() - 60)
    objects[key] = json.dumps(meta).encode()
    slot = video_runner._upload_slot_keys(video_runner._slot_prefix(sid, 2))[0]
    video_runner.storage.put(slot, b"NOBODY-IS-COMING-BACK-FOR-THIS")
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    out = video_runner.sweep_stranded_slots("clientx/projecty/")
    check("the sweep collects it", out["collected"], 1)
    v = json.loads(objects[key])["variations"][1]
    check("the tile is repaired in storage, not just in memory",
          v.get("status"), "done")
    check("with the stranded bytes", v.get("bytes"),
          len(b"NOBODY-IS-COMING-BACK-FOR-THIS"))
    check("and its error is cleared", v.get("error"), "")
    check("the slot is emptied so the next sweep has nothing to do",
          slot in objects, False)
    check("a second sweep is a no-op",
          video_runner.sweep_stranded_slots("clientx/projecty/"),
          {"collected": 0, "deleted": 0, "left": 0})


def test_the_sweep_deletes_what_can_never_be_collected() -> None:
    """Scratch, not renders: a slot beside a tile that is already `done` (a
    `_clear_upload_slots` delete that failed), one whose variation or whose whole
    session is gone, and one that PREDATES the attempt it would be offered as —
    which `_submit` would have deleted on the next attempt anyway. Leaving those
    behind is what made "is anything stranded?" unanswerable."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("tidy up"), ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["variations"][0]["started"] = video_runner._now()      # slot below is older
    objects[key] = json.dumps(meta).encode()

    done_slot = video_runner._upload_slot_keys(
        video_runner._slot_prefix(sid, 1))[0]
    gone_var = video_runner._upload_slot_keys(
        video_runner._slot_prefix(sid, 9))[0]
    gone_session = video_runner._upload_slot_keys(
        video_runner._slot_prefix("20260101_000000_dead", 1))[0]
    for k in (done_slot, gone_var, gone_session):
        video_runner.storage.put(k, b"SCRATCH")
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    # `_stub_world`'s listing stamps every object with `now`, so the done tile's
    # slot is dated AFTER `started` — it is deleted for being beside a done tile.
    out = video_runner.sweep_stranded_slots("clientx/projecty/")
    check("all three are removed", out["deleted"], 3)
    check("and nothing was collected", out["collected"], 0)
    check("the done tile's leftover is gone", done_slot in objects, False)
    check("the discarded variation's is gone", gone_var in objects, False)
    check("the dead session's is gone", gone_session in objects, False)
    check("the done tile is untouched",
          json.loads(objects[key])["variations"][0]["status"], "done")


def test_the_sweep_keeps_its_hands_off_a_live_session() -> None:
    """A job in flight may have uploaded seconds ago with its own poller about to
    collect. Taking it first would leave that poller reporting "the worker said it
    uploaded, but nothing is there" — the sweep would become the thing it exists to
    prevent."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("still going"),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="job-live", file="",
                                 bytes=0, started=video_runner._now() - 5)
    objects[key] = json.dumps(meta).encode()
    slot = video_runner._upload_slot_keys(video_runner._slot_prefix(sid, 1))[0]
    video_runner.storage.put(slot, b"MID-FLIGHT")
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None

    out = video_runner.sweep_stranded_slots("clientx/projecty/")
    check("a running session's slot is left alone", out,
          {"collected": 0, "deleted": 0, "left": 1})
    check("and the bytes are still there for its own poller", slot in objects, True)


def test_a_slot_name_is_read_back_the_way_it_was_written() -> None:
    """`_slot_prefix` writes the name and `_slot_owner` reads it — a second
    spelling of that shape would send the sweep looking at the wrong session."""
    sid = "20260907_134356_d3ed"
    key = video_runner._upload_slot_keys(video_runner._slot_prefix(sid, 5))[2]
    check("round trip", video_runner._slot_owner(key), (sid, 5))
    check("a session object is not mistaken for a slot",
          video_runner._slot_owner(f"clientx/projecty/video/{sid}/005.webp"), None)
    check("nor is anything else in the bucket",
          video_runner._slot_owner("clientx/projecty/atlas/H1.png"), None)


def _other_container(sid: str, user: str = "system", ttl_ms: int = 45_000) -> None:
    """Make it look as though ANOTHER container holds this session's lease.

    Waits for the runner to be idle first: a dispatcher whose session has already
    reported `finished` is still winding down, and its drain heartbeats — so a
    foreign row fabricated underneath it can be legitimately reclaimed a moment
    later, which is the runner behaving correctly and the fixture racing it.
    """
    _await_idle()
    from iw_common import lease as _lease
    _lease.acquire(video_runner._lease_key(sid),
                   _lease.LeaseHolder(user, "some-other-container"),
                   ttl_ms=ttl_ms)


def test_a_finished_render_never_loses_a_merge() -> None:
    """`_merge_meta` is the whole of the fix for the reported bug, so it is tested on
    its own: one container collected a render, persisted `00N.webp` and marked the
    tile `done` while the other's older snapshot landed last and put it back to
    `failed` — the render surviving in R2 with no tile pointing at it."""
    ours = {"status": "running", "cancel": False, "variations": [
        {"index": 1, "status": "failed", "error": "job FAILED", "file": ""},
        {"index": 2, "status": "running"}]}
    theirs = {"status": "running", "cancel": True, "variations": [
        {"index": 1, "status": "done", "file": "001.webp", "bytes": 9},
        {"index": 3, "status": "done", "file": "003.webp", "bytes": 4}]}
    merged = video_runner._merge_meta(ours, theirs)
    by = {v["index"]: v for v in merged["variations"]}
    check("a done tile with a file beats our stale failure",
          (by[1]["status"], by[1]["file"]), ("done", "001.webp"))
    check("our own newer state is kept where theirs has no render",
          by[2]["status"], "running")
    check("a variation only THEY know about survives our older snapshot",
          by[3]["file"], "003.webp")
    check("a stop that landed anywhere is sticky", merged["cancel"], True)
    check("and done_count is recounted, not inherited", merged["done_count"], 2)

    # …and the rule is symmetric: ours wins when it is the one holding the render.
    back = video_runner._merge_meta(theirs, ours)
    check("whichever side has the render, the render wins",
          {v["index"]: v.get("file", "") for v in back["variations"]}[1], "001.webp")


def test_a_stale_container_cannot_undo_a_collected_render() -> None:
    """The reported bug, end to end. A rolling deploy overlaps two containers; the
    old one collects a render and marks the tile `done`; the new one writes the
    snapshot it took before that and the tile goes back to `failed`, with
    `00N.webp` sitting in R2 and nothing pointing at it. `_write_meta` is a
    compare-and-swap now: the loser is REFUSED, re-reads, merges, and writes again."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("two containers", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)
    key = f"clientx/projecty/video/{sid}/meta.json"

    # What OUR process still has in memory: v1 not finished.
    stale = json.loads(objects[key])
    stale["variations"][0].update(status="failed", file="", bytes=0,
                                  error="job FAILED: worker fell over")

    # Meanwhile the other container collects v1 and writes it — a different etag.
    theirs = json.loads(objects[key])
    theirs["variations"][0].update(status="done", file="001.webp", bytes=42,
                                   error="")
    video_runner.storage.put(key, json.dumps(theirs).encode(), "application/json")
    video_runner._META_ETAGS.clear()          # our remembered etag is now stale

    session = dict(stale)
    session["_blueprint"] = load_blueprint()
    with video_runner._LOCK:
        video_runner._SESSIONS[sid] = session
    video_runner._write_meta(sid, session)

    v = json.loads(objects[key])["variations"][0]
    check("the collected render is still recorded", v.get("status"), "done")
    check("with its file", v.get("file"), "001.webp")
    check("and the stale writer's error is not resurrected", v.get("error"), "")


def test_a_session_another_container_holds_is_left_alone() -> None:
    """Two dispatchers over one session is the double-submit: both claim the same
    queued variation, both pay, and — because `_submit` empties the hand-off slots
    before its job runs — the second one DELETES the render the first one's job had
    already uploaded."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("mine, not yours", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="job-theirs", file="",
                                 bytes=0, started=video_runner._now() - 5)
    meta["variations"][1].update(status="queued", job_id="", file="", bytes=0)
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None
    video_runner._META_ETAGS.clear()
    _other_container(sid)

    import batch_atlas
    submits: list = []
    passthrough = batch_atlas._runpod_post

    def counting_post(path, payload):
        if path == "/run":
            submits.append(path)
        return passthrough(path, payload)

    batch_atlas._runpod_post = counting_post
    slot = video_runner._upload_slot_keys(video_runner._slot_prefix(sid, 1))[0]
    video_runner.storage.put(slot, b"THEIR-JOBS-RENDER")

    video_runner.get_session(sid)                  # would adopt, if it were free
    import time as _t
    _t.sleep(0.3)
    with video_runner._LOCK:
        adopted = sid in video_runner._SESSIONS
    check("we do not adopt a session another container holds", adopted, False)
    check("so nothing is submitted a second time", submits, [])
    check("and their job's render is still in its slot", slot in objects, True)

    # The boot sweep is the least aggressive claimant of all: it defers too.
    check("the boot sweep also leaves it", video_runner.resume_orphans(), [])
    check("and so does the slot sweep",
          video_runner.sweep_stranded_slots("clientx/projecty/")["left"], 1)


def test_an_expired_lease_is_taken_over_and_the_tail_runs_once() -> None:
    """The owner dying mid-render must cost one TTL, not the session. After that the
    next read adopts and finishes the tail — exactly once."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("dead owner", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="job-dead", file="",
                                 bytes=0, started=video_runner._now() - 5)
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None
    video_runner._META_ETAGS.clear()
    _other_container(sid, ttl_ms=-1)               # holder died; lease already stale

    from iw_common import lease as _lease
    check("a stale lease reads as nobody's",
          _lease.held_by(video_runner._lease_key(sid)), None)
    video_runner.get_session(sid)
    final = _await_session(sid)
    check("the session is finished by whoever picked it up",
          final.get("status"), "finished")
    check("every tile ends done",
          [v["status"] for v in final["variations"]], ["done", "done"])


def test_stop_reaches_a_session_this_container_does_not_own() -> None:
    """Cancel is the takeover: it must never be blocked, because the session someone
    most wants to stop is the one another container is holding after a restart."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("stop across the wire"),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)

    key = f"clientx/projecty/video/{sid}/meta.json"
    meta = json.loads(objects[key])
    meta["status"] = "running"
    meta["variations"][0].update(status="running", job_id="job-theirs", file="",
                                 bytes=0, started=video_runner._now() - 5)
    objects[key] = json.dumps(meta).encode()
    video_runner._SESSIONS.clear()
    video_runner._ACTIVE = None
    video_runner._META_ETAGS.clear()
    _other_container(sid)

    out = video_runner.cancel_session(sid)
    check("the stop is accepted", out.get("ok"), True)
    from iw_common import lease as _lease
    row = _lease.held_by(video_runner._lease_key(sid))
    check("and it took the lease, so the old owner stands down",
          (row or {}).get("holderSessionId"), video_runner.INSTANCE_ID)
    check("the session reads cancelled in storage",
          json.loads(objects[key]).get("status"), "cancelled")


def test_the_lease_fails_open() -> None:
    """A lease that can wedge a render is worse than the race it prevents. With the
    store unreadable and unwritable, everything behaves exactly as it did before the
    lease existed — the compare-and-swap is the floor under that window."""
    tmp, objects = _stub_world()
    real_get, real_put = (video_runner.storage.get_with_etag,
                          video_runner.storage.put)

    def dead_get(k):
        if "/_leases/" in k:
            raise video_runner.storage.ObjectUnreadable(k)
        return real_get(k)

    def dead_put(k, b, c=None, **kw):
        if "/_leases/" in k:
            raise RuntimeError("lease store is down")
        return real_put(k, b, c, **kw)

    video_runner.storage.get_with_etag = dead_get
    video_runner.storage.put = dead_put
    try:
        started = video_runner.start_session(_req("no lease store", variations=2),
                                             ("clientx", "projecty"))
        final = _await_session(started["id"], timeout=10.0)
    finally:
        video_runner.storage.get_with_etag = real_get
        video_runner.storage.put = real_put

    check("the session still runs and finishes", final.get("status"), "finished")
    check("with both renders", [v["status"] for v in final["variations"]],
          ["done", "done"])


def test_the_lease_predicates_read_like_the_store_enforces_them() -> None:
    """`is_takeable` / `is_same_holder` are pure so they can be fixtured on their
    own, exactly as they are on the TypeScript side — they have to agree with the
    condition the store applies, and that is only checkable in isolation."""
    from iw_common import lease as _lease
    mine = _lease.LeaseHolder("user-a", "container-1")
    same_user_other_box = _lease.LeaseHolder("user-a", "container-2")
    row = {"holderUserId": "user-a", "holderSessionId": "container-1",
           "expiresAt": 10_000}
    check("nothing held is takeable", _lease.is_takeable(None, mine, 0), True)
    check("our own lease is takeable", _lease.is_takeable(row, mine, 0), True)
    check("someone else's live lease is not",
          _lease.is_takeable(row, same_user_other_box, 0), False)
    check("…until it expires",
          _lease.is_takeable(row, same_user_other_box, 10_001), True)
    check("one user in two containers is two holders",
          _lease.is_same_holder(row, same_user_other_box), False)
    check("the timings match the TypeScript half",
          (_lease.LEASE_HEARTBEAT_MS, _lease.LEASE_TTL_MS), (10_000, 45_000))


def test_a_merge_survives_the_next_write() -> None:
    """The repair has to reach MEMORY, not just R2. The conflict path merges and
    re-CASes correctly, but the merged doc used to be a local variable: the next
    write took the fast path on our freshly-cached etag, nobody else had written in
    between, and our un-merged snapshot landed — undoing the collected render this
    whole mechanism had just saved, one write later."""
    tmp, objects = _stub_world()
    started = video_runner.start_session(_req("merge must stick", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    _await_session(sid)
    key = f"clientx/projecty/video/{sid}/meta.json"

    stale = json.loads(objects[key])
    stale["variations"][0].update(status="failed", file="", bytes=0,
                                  error="job FAILED: worker fell over")
    session = dict(stale)
    session["_blueprint"] = load_blueprint()
    with video_runner._LOCK:
        video_runner._SESSIONS[sid] = session
    video_runner._META_ETAGS.clear()

    theirs = json.loads(objects[key])
    theirs["variations"][0].update(status="done", file="001.webp", bytes=42,
                                   error="", finished=video_runner._now())
    video_runner.storage.put(key, json.dumps(theirs).encode(), "application/json")

    video_runner._write_meta(sid, session)          # 412 -> merge -> re-CAS
    check("the conflicting write is repaired",
          json.loads(objects[key])["variations"][0]["status"], "done")

    video_runner._write_meta(sid, session)          # …and the NEXT write keeps it
    v = json.loads(objects[key])["variations"][0]
    check("and the write after it does not undo the repair", v["status"], "done")
    check("with the file still recorded", v["file"], "001.webp")
    with video_runner._LOCK:
        live = video_runner._SESSIONS[sid]["variations"][0]
    check("because the merge was folded back into memory", live["status"], "done")


def test_the_merge_respects_a_delete_and_an_ended_session() -> None:
    """Two rules the first cut got wrong in opposite directions: a stale snapshot
    resurrecting a tile its author had explicitly discarded, and a container that
    was still running putting a session the OTHER one had finished back to
    `running` — which `resume_orphans` would then re-dispatch and the slot sweep
    would refuse to tidy."""
    ours = {"status": "running", "finished": 0, "variations": [
        {"index": 1, "status": "deleted", "file": ""},
        {"index": 2, "status": "done", "file": "002.webp", "finished": 10.0}]}
    theirs = {"status": "finished", "finished": 99.0, "variations": [
        {"index": 1, "status": "done", "file": "001.webp"},
        {"index": 2, "status": "done", "file": "002b.webp", "finished": 20.0}]}
    merged = video_runner._merge_meta(ours, theirs)
    by = {v["index"]: v for v in merged["variations"]}
    check("an explicit delete is not resurrected by a stale render",
          by[1]["status"], "deleted")
    check("a session the other side ended stays ended", merged["status"], "finished")
    check("with its finish time", merged["finished"], 99.0)
    check("and when both sides have a render the later one wins, deterministically",
          by[2]["file"], "002b.webp")


def test_the_lease_is_renewed_while_a_render_is_running() -> None:
    """The dispatcher renews on its own loop — which means the loop has to come back
    round. With untimed waits it blocked for the whole of a render (minutes) while
    the lease lives 45 seconds, so our own lease lapsed under us and the session read
    as free to every other container: the double-submit, from the inside."""
    import batch_atlas

    tmp, objects = _stub_world()
    from iw_common import lease as _lease
    real_renew = video_runner.LEASE_RENEW_SECONDS
    video_runner.LEASE_RENEW_SECONDS = 0.02

    polls = {"n": 0}
    beats: list = []

    def slow_job(path):
        polls["n"] += 1
        if polls["n"] < 12:                      # several dispatcher wait cycles
            row = _lease.held_by(video_runner._lease_key(sid_box[0])) or {}
            beats.append(row.get("heartbeatAt"))
            return {"status": "IN_PROGRESS"}
        return {"status": "COMPLETED", "output": {"images": [
            {"filename": "out.webp",
             "image": __import__("base64").b64encode(b"WEBP").decode()}]}}

    sid_box = [""]
    batch_atlas._runpod_get = slow_job
    try:
        started = video_runner.start_session(_req("long render", variations=2),
                                             ("clientx", "projecty"))
        sid_box[0] = started["id"]
        final = _await_session(started["id"], timeout=15.0)
    finally:
        video_runner.LEASE_RENEW_SECONDS = real_renew

    seen = [b for b in beats if b]
    check("the session completes", final.get("status"), "finished")
    check("the lease was held throughout the render", len(seen) > 0, True)
    check("and it was renewed while the job ran, not just at the start",
          len(set(seen)) > 1, True)


def test_the_takeable_boundary_matches_the_sql() -> None:
    """`expires_at < now()` in the SQL twin, so `<` here. One millisecond, but the
    whole reason these predicates are pure is that they must read identically to the
    condition the store enforces."""
    from iw_common import lease as _lease
    mine = _lease.LeaseHolder("atlas-tool", "container-2")
    row = {"holderUserId": "atlas-tool", "holderSessionId": "container-1",
           "expiresAt": 10_000}
    check("at the instant it expires it is still held",
          _lease.is_takeable(row, mine, 10_000), False)
    check("a millisecond later it is takeable",
          _lease.is_takeable(row, mine, 10_001), True)


def test_our_cap_sits_above_the_endpoints_own_timeout() -> None:
    """`JOB_TIMEOUT_SECONDS` is a backstop for a job RunPod never resolves, NOT a
    render budget: RunPod times a job from worker pickup, this counts from
    submit. At 1800 it cancelled two-pass renders the endpoint was still happy to
    finish, so it must stay well above any endpoint Execution Timeout."""
    check("the cap is loose enough for a multi-pass video blueprint",
          video_runner.JOB_TIMEOUT_SECONDS >= 9000, True)


def test_a_cancel_runpod_refuses_is_reported_not_swallowed() -> None:
    """`_cancel_job` caught every exception and said nothing, so a cancel that never
    landed left a job rendering at full cost while the session, the tile and the
    button all said it had stopped. The local stop still stands — but the author is
    told, because this is money and they cannot see it anywhere else."""
    import batch_atlas

    _stub_world()
    passthrough = batch_atlas._runpod_post

    def refuse_cancels(path, payload):
        if path.startswith("/cancel/"):
            raise RuntimeError("RunPod /cancel/job1 failed: HTTP 500 Internal Server Error")
        return passthrough(path, payload)

    batch_atlas._runpod_post = refuse_cancels
    batch_atlas._runpod_get = lambda path: {"status": "IN_PROGRESS"}

    started = video_runner.start_session(_req("wont stop", variations=2),
                                         ("clientx", "projecty"))
    sid = started["id"]
    check("a job is in flight to cancel", _await_in_flight(sid), "job1")
    res = video_runner.cancel_session(sid)

    check("the cancel still returns ok — the local stop stands", res.get("ok"), True)
    check("but it says RunPod would not take it",
          "would not cancel" in str(res.get("warning", "")), True)
    check("naming the job, so it can be killed by hand",
          "job1" in str(res.get("warning", "")), True)
    check("and saying what that costs",
          "billing" in str(res.get("warning", "")), True)
    final = _await_session(sid)
    check("the session still reads as cancelled", final.get("status"), "cancelled")

    # The happy path must stay silent: a warning on every cancel is one nobody reads.
    _stub_world()
    ok = video_runner.start_session(_req("stops fine"), ("clientx", "projecty"))
    _await_in_flight(ok["id"])
    check("a cancel RunPod accepts carries no warning",
          "warning" in video_runner.cancel_session(ok["id"]), False)
    _await_session(ok["id"])


def test_cancelling_a_session_no_worker_owns() -> None:
    """The exact state the owner hit: "I try to click the cancel button ... but
    nothing is happening!"

    A session ADOPTED from its stored doc after a restart carries variations still
    marked `running` — that is what they said when the old process died. The settle
    test used to read those and infer a worker was watching, so it left everything to
    a thread that does not exist. The session sat at "running" for over half an hour
    and Cancel did nothing whatsoever; the flag was not even persisted, so R2 went on
    reporting `cancel: false` while the author clicked.
    """
    _stub_world()
    ctx = ("clientx", "projecty")

    # Someone else holds the runner, so no worker will ever be dispatched for ours.
    holder = video_runner.start_session(_req("holds the runner"), ctx)
    _await_in_flight(holder["id"])

    # An orphan exactly as a restart leaves it: in memory, NOT `_ACTIVE`, with a
    # variation frozen mid-flight and a job id still attached.
    sid = "20260902_083441_25a3"
    orphan = {
        "id": sid, "status": "running", "cancel": False, "client": "clientx",
        "project": "projecty", "blueprint": "wan22_i2v_flipbook", "prompt": "p",
        "source_ref": "r.png", "negative": "", "params": {}, "seed_base": 1,
        "variations": [
            {"index": 1, "status": "done", "seed": 1, "file": "001.webp",
             "error": "", "job_id": "old1", "started": 1.0, "finished": 2.0},
            {"index": 2, "status": "running", "seed": 2, "file": "", "error": "",
             "job_id": "ad5b2256", "started": 3.0, "finished": None},
            {"index": 3, "status": "queued", "seed": 3, "file": "", "error": "",
             "job_id": "", "started": 0.0, "finished": None},
        ],
    }
    with video_runner._LOCK:
        video_runner._SESSIONS[sid] = orphan
    check("the orphan is not the session holding the runner",
          video_runner._ACTIVE == sid, False)

    res = video_runner.cancel_session(sid)

    check("cancelling it settles it here, since nothing else ever will",
          video_runner.get_session(sid).get("status"), "cancelled")
    check("every unfinished slot is closed out",
          [v["status"] for v in video_runner.get_session(sid)["variations"]],
          ["done", "cancelled", "cancelled"])
    check("the finished one is left alone",
          video_runner.get_session(sid)["variations"][0]["file"], "001.webp")
    check("its in-flight job is stopped remotely", res.get("cancelling"), 1)

    # The flag must reach R2, not just memory: a restart that forgets the stop was
    # asked for is how a cancelled session comes back to life.
    import json
    stored = json.loads(
        video_runner.storage.get(f"clientx/projecty/video/{sid}/meta.json"))
    check("and the stored doc records the cancel", stored.get("cancel"), True)
    check("as cancelled, not running", stored.get("status"), "cancelled")

    # The session that DOES have a worker is untouched by any of this.
    check("the running session still holds the runner",
          video_runner._ACTIVE, holder["id"])
    _await_session(holder["id"])


def test_a_dead_worker_does_not_wedge_the_runner() -> None:
    """`_ACTIVE` was only cleared on the happy path, so any escape before it left
    the tool answering "a video session is already running" until the container
    restarted — with no way out from the UI."""
    _stub_world()
    ctx = ("clientx", "projecty")
    real = video_runner._run_variations

    def explode(sid, session, ctx):
        raise RuntimeError("worker exploded")

    video_runner._run_variations = explode
    try:
        dead = video_runner.start_session(_req("doomed"), ctx)
        final = _await_session(dead["id"])
        check("a session whose worker dies is closed out, not left running",
              final.get("status"), "finished")
        check("its variations say what happened",
              [v["status"] for v in final["variations"]], ["failed"])
        check("including why",
              "exploded" in final["variations"][0]["error"], True)
        check("and the runner is released", _await_idle(), None)
    finally:
        video_runner._run_variations = real

    nxt = video_runner.start_session(_req("after the crash"), ctx)
    check("so the next session runs instead of being refused",
          _await_session(nxt["id"]).get("status"), "finished")


def test_regenerate_one_variation() -> None:
    """A tile is re-rolled IN PLACE, in the session it belongs to: same slot, same
    number, a new render. The two knobs move independently — hold the seed and
    change the prompt, or hold the prompt and take a new seed."""
    _stub_world()
    ctx = ("clientx", "projecty")
    started = video_runner.start_session(_req("a spinning coin", 2), ctx)
    sid = started["id"]
    first = _await_session(sid)
    check("the session finishes first", first.get("status"), "finished")
    held = first["variations"][0]["seed"]

    # Hold the seed, change the prompt.
    out = video_runner.regenerate_variation(
        sid, {"index": 1, "prompt": "a spinning coin, on fire",
              "seed": str(held)}, ctx)
    check("a settled session re-opens", out["status"] in ("queued", "running"), True)
    done = _await_session(sid)
    v1 = done["variations"][0]
    check("the slot keeps its number", v1["index"], 1)
    check("the seed is held exactly", v1["seed"], held)
    check("the changed prompt is recorded on the TILE", v1["prompt"],
          "a spinning coin, on fire")
    check("the SESSION's prompt is untouched", done["prompt"], "a spinning coin")
    check("so the other tile still reads as the session's",
          done["variations"][1]["prompt"], "")
    check("and the re-roll produced a render", v1["status"], "done")
    check("the untouched tile was not re-run",
          done["variations"][1]["status"], "done")

    # Hold the prompt, take a new seed.
    video_runner.regenerate_variation(
        sid, {"index": 1, "prompt": "a spinning coin", "seed": ""}, ctx)
    again = _await_session(sid)["variations"][0]
    check("a blank seed rolls a fresh one", again["seed"] != held, True)
    check("a prompt back at the session's clears the override",
          again["prompt"], "")

    check_raises("a non-numeric seed is refused",
                 lambda: video_runner.regenerate_variation(
                     sid, {"index": 1, "seed": "abc"}, ctx), "whole number")
    check_raises("an empty prompt is refused",
                 lambda: video_runner.regenerate_variation(
                     sid, {"index": 1, "prompt": "  "}, ctx), "enter a prompt")
    check_raises("an index this session does not have is refused",
                 lambda: video_runner.regenerate_variation(
                     sid, {"index": 99}, ctx), "no variation")


def test_discard_one_variation() -> None:
    """Deleting a tile removes its RENDER and stops the grid drawing it — but the
    slot keeps its index, because that index IS the stored filename and a clip may
    already have been packed from it."""
    tmp, objects = _stub_world()
    ctx = ("clientx", "projecty")
    sid = video_runner.start_session(_req("p", 3), ctx)["id"]
    _await_session(sid)

    key = "clientx/projecty/video/%s/002.webp" % sid
    check("the render is there to begin with", key in objects, True)

    out = video_runner.discard_variation(sid, {"index": 2})
    check("the slot is marked deleted", out["variations"][1]["status"], "deleted")
    check("indexes are NOT resequenced under the survivors",
          [v["index"] for v in out["variations"]], [1, 2, 3])
    check("its neighbours are untouched",
          [v["status"] for v in out["variations"]], ["done", "deleted", "done"])
    check("the stored render is gone from R2", key in objects, False)
    check("and gone from staging",
          (tmp / "video" / sid / "002.webp").exists(), False)
    check("the done count is recomputed", out["done_count"], 2)

    stored = json.loads(objects["clientx/projecty/video/%s/meta.json" % sid])
    check("and the deletion is persisted, not just held in memory",
          stored["variations"][1]["status"], "deleted")

    check_raises("re-rolling a deleted slot is refused",
                 lambda: video_runner.regenerate_variation(
                     sid, {"index": 2}, ctx), "deleted")
    check("a confirmed removal carries no warning", "warning" in out, False)


def test_a_tile_r2_would_not_drop_still_goes_but_says_so() -> None:
    """The tile's own 🗑 is the opposite call from the session's: the author asked
    for the tile to go, so it goes even when the byte removal fails — refusing
    would leave a tile on screen to report a storage problem nobody can act on
    from the grid. But the confirm dialog says "removed for good", so a survivor
    is NAMED rather than swallowed. `storage.delete` reports nothing, so before
    this a read-only token dropped the tile and kept the bytes, silently."""
    tmp, objects = _stub_world()
    ctx = ("clientx", "projecty")
    sid = video_runner.start_session(_req("p", 2), ctx)["id"]
    _await_session(sid)
    key = "clientx/projecty/video/%s/002.webp" % sid

    # Lists and heads fine, deletes nothing — a misconfigured key, and until now
    # indistinguishable from success.
    video_runner.storage.delete = lambda k: None

    out = video_runner.discard_variation(sid, {"index": 2})
    check("the tile still goes", out["variations"][1]["status"], "deleted")
    check("the surviving object is named", "STILL stored in R2" in out.get("warning", ""), True)
    check("and it really did survive", key in objects, True)
    check("the warning is never persisted into the session",
          "warning" in json.loads(objects["clientx/projecty/video/%s/meta.json" % sid]), False)


def test_a_tile_whose_removal_cannot_be_confirmed_says_that_instead() -> None:
    """A HEAD that throws is "could not check", not "it is gone" — the distinction
    `head` exists to keep (`exists` folds both into False). The wording has to
    differ too: telling an author their render is still stored when the truth is
    that nobody could reach R2 sends them looking for an object that may not
    be there."""
    tmp, objects = _stub_world()
    sid = video_runner.start_session(_req("p", 2), ("clientx", "projecty"))["id"]
    _await_session(sid)

    def _blow_up(key):
        raise URLError("r2 unreachable")

    video_runner.storage.head = _blow_up
    out = video_runner.discard_variation(sid, {"index": 2})
    check("the tile still goes", out["variations"][1]["status"], "deleted")
    check("and the warning says unconfirmed, not still-stored",
          "could not be confirmed" in out.get("warning", ""), True)


def _capture_workflows():
    """Record every graph submitted, keyed by the filename prefix the runner stamps
    on it — which carries the variation index, so a test can ask what ONE slot
    actually ran rather than trusting the meta it wrote about itself."""
    import batch_atlas
    real = batch_atlas._runpod_post
    seen: dict[str, dict] = {}

    def spy(path, payload):
        if path == "/run":
            wf = ((payload or {}).get("input") or {}).get("workflow") or {}
            node = wf.get("200") or {}
            prefix = (node.get("inputs") or {}).get("filename_prefix", "")
            seen[str(prefix)[-3:]] = wf
        return real(path, payload)

    batch_atlas._runpod_post = spy
    return seen


def test_duplicate_a_variation_with_new_settings() -> None:
    """The owner's actual experiment: the same render with the background cutout
    on and with it off, side by side. So a duplicate ADDS a tile (the original is
    the thing being compared against and must survive), HOLDS the seed by default
    (or the difference you see is another roll of the dice, not the setting you
    changed), and records only what it CHANGED (the session's recipe still
    describes the rest of the grid)."""
    _stub_world()
    seen = _capture_workflows()
    ctx = ("clientx", "projecty")
    started = video_runner.start_session(
        {"blueprint": "wan22_i2v_flipbook", "prompt": "a spinning coin",
         "negative": "blurry", "source_ref": "sheet_src/H1.png", "variations": 2,
         "params": {"duration": 2}}, ctx)
    sid = started["id"]
    first = _await_session(sid)
    check("the session finishes first", first.get("status"), "finished")
    held = first["variations"][0]["seed"]

    # Same everything, cutout off.
    out = video_runner.duplicate_variation(
        sid, {"index": 1, "params": {"duration": 2, "remove_background": False}},
        ctx)
    check("a settled session re-opens to run it",
          out["status"] in ("queued", "running"), True)
    check("the source tile is still there",
          [v["index"] for v in out["variations"]][:2], [1, 2])
    done = _await_session(sid)
    dup = done["variations"][2]

    check("the duplicate is a NEW slot, appended", dup["index"], 3)
    check("it holds the source's seed exactly", dup["seed"], held)
    check("the source render is untouched",
          (done["variations"][0]["seed"], done["variations"][0]["file"]),
          (held, "001.webp"))
    check("and it rendered", dup["status"], "done")
    check("it records where it came from", dup["from_index"], 1)
    check("only what CHANGED is recorded on it",
          dup["settings"], {"params": {"duration": 2, "remove_background": False}})
    check("an unchanged prompt is not recorded as an override", dup["prompt"], "")
    check("the SESSION's recipe is untouched",
          (done["prompt"], done["negative"], done["params"]),
          ("a spinning coin", "blurry", {"duration": 2}))

    # What it actually RAN — the whole point. A recorded override that never
    # reaches the graph is the failure mode this exists to catch.
    check("the duplicate's graph has the cutout OFF",
          seen["003"]["203"]["inputs"]["value"], False)
    check("while the original's had it ON",
          seen["001"]["203"]["inputs"]["value"], True)
    check("and everything else it did not change came along",
          (seen["003"]["170"]["inputs"]["text"],
           seen["003"]["194"]["inputs"]["text"],
           seen["003"]["97"]["inputs"]["image"],
           seen["003"]["191"]["inputs"]["value"]),
          ("a spinning coin", "blurry", "sheet_src/H1.png", 2))

    # A duplicate OF a duplicate carries the first one's changes forward. Falling
    # back to the session's recipe here would silently revert the experiment.
    video_runner.duplicate_variation(
        sid, {"index": 3, "prompt": "a spinning coin, on fire"}, ctx)
    chained = _await_session(sid)["variations"][3]
    check("a chained duplicate keeps the settings it was made from",
          chained["settings"], {"params": {"duration": 2, "remove_background": False}})
    check("and takes the new prompt", chained["prompt"], "a spinning coin, on fire")
    check("still on the same seed", chained["seed"], held)

    # A deliberately EMPTY negative must mean "none", not "the session's". This is
    # why the settings bag is read by key PRESENCE.
    video_runner.duplicate_variation(sid, {"index": 1, "negative": ""}, ctx)
    blank = _await_session(sid)["variations"][4]
    check("an emptied negative is recorded as an override",
          blank["settings"], {"negative": ""})
    check("and the graph really ran without one",
          seen["005"]["194"]["inputs"]["text"], "")

    # A blank seed is the one way to ask for a different roll as well.
    video_runner.duplicate_variation(sid, {"index": 1, "seed": ""}, ctx)
    rolled = _await_session(sid)["variations"][5]
    check("an explicitly blank seed rolls a fresh one", rolled["seed"] != held, True)

    check_raises("a non-numeric seed is refused",
                 lambda: video_runner.duplicate_variation(
                     sid, {"index": 1, "seed": "abc"}, ctx), "whole number")
    check_raises("an emptied prompt is refused",
                 lambda: video_runner.duplicate_variation(
                     sid, {"index": 1, "prompt": "   "}, ctx), "enter a prompt")
    check_raises("an i2v duplicate with the source cleared is refused",
                 lambda: video_runner.duplicate_variation(
                     sid, {"index": 1, "source_ref": ""}, ctx), "source image")
    check_raises("an index this session does not have is refused",
                 lambda: video_runner.duplicate_variation(
                     sid, {"index": 99}, ctx), "no variation")

    video_runner.discard_variation(sid, {"index": 3})
    check_raises("a deleted slot has no recipe left to duplicate",
                 lambda: video_runner.duplicate_variation(
                     sid, {"index": 3}, ctx), "deleted")

    # The EXACT body the panel posts, captured from the running page — every field
    # present, the seed as the string an <input> yields. Nothing here type-checks
    # the wire, so this is the only place the two ends are held together.
    video_runner.duplicate_variation(sid, {
        "session": sid,
        "index": 1,
        "prompt": "a spinning coin, dramatic lighting",
        "negative": "blurry",
        "source_ref": "sheet_src/W.png",
        "seed": str(held),
        "params": {"duration": 2, "remove_background": True},
    }, ctx)
    posted = _await_session(sid)["variations"][-1]
    check("the panel's own payload is accepted whole",
          (posted["seed"], posted["prompt"], posted["status"]),
          (held, "a spinning coin, dramatic lighting", "done"))
    check("and only its real differences are recorded",
          posted["settings"],
          {"source_ref": "sheet_src/W.png",
           "params": {"duration": 2, "remove_background": True}})


def test_a_session_has_no_variation_ceiling() -> None:
    """How many variations a grid holds is the author's call, on every path that
    grows a session. The only refusal left is a count below one."""
    _stub_world()
    ctx = ("clientx", "projecty")
    sid = video_runner.start_session(_req("p", 1), ctx)["id"]
    _await_session(sid)
    session = video_runner._SESSIONS[sid]
    # A grid far past the old ceiling, without paying for the renders.
    with video_runner._LOCK:
        session["variations"].extend(
            dict(video_runner._new_variation(i), status="done", file=f"{i:03d}.webp")
            for i in range(2, 101))
    video_runner.duplicate_variation(sid, {"index": 1}, ctx)
    _await_session(sid)
    video_runner.add_variations(sid, {"count": 50}, ctx)
    _await_session(sid)
    check("a duplicate and a 50-wide add both land past 100 slots",
          len(video_runner._live_variations(video_runner._SESSIONS[sid])), 151)
    check_raises("a count below one is still refused",
                 lambda: video_runner.add_variations(sid, {"count": -1}, ctx),
                 "at least 1")


def test_add_variations_to_a_session() -> None:
    """More rolls of the same idea belong in the SAME grid — that grid is the
    comparison the author is actually making."""
    _stub_world()
    ctx = ("clientx", "projecty")
    sid = video_runner.start_session(_req("a coin", 2), ctx)["id"]
    _await_session(sid)

    out = video_runner.add_variations(sid, {"count": 2}, ctx)
    check("a settled session re-opens to take them",
          out["status"] in ("queued", "running"), True)
    check("numbering continues from the highest slot",
          [v["index"] for v in out["variations"]], [1, 2, 3, 4])

    done = _await_session(sid)
    check("every slot ends done",
          [v["status"] for v in done["variations"]], ["done"] * 4)
    check("the new ones run the session's own prompt",
          [v["prompt"] for v in done["variations"]], [""] * 4)
    check("each carries its own seed",
          len({v["seed"] for v in done["variations"]}), 4)

    # A deleted slot frees its room but never gives its NUMBER back: 003.webp may
    # still be referenced by a clip packed from it.
    video_runner.discard_variation(sid, {"index": 3})
    grown = video_runner.add_variations(sid, {"count": 1}, ctx)
    check("numbering skips past a deleted slot",
          [v["index"] for v in grown["variations"]], [1, 2, 3, 4, 5])
    _await_session(sid)


def test_a_reroll_mid_run_joins_the_pass_already_under_way() -> None:
    """The worker RE-PICKS the lowest pending slot every iteration instead of
    walking the list once, so arming an earlier tile while a later one is in flight
    is collected by the running pass — no second worker, no second session."""
    _stub_world()
    ctx = ("clientx", "projecty")
    gate = _gate_job("job2")
    try:
        sid = video_runner.start_session(_req("p", 3), ctx)["id"]
        _await_var(sid, 1, "done")  # #001 finished; #002 is held in flight

        video_runner.regenerate_variation(sid, {"index": 1, "seed": "12345"}, ctx)
        check("the re-roll did not open a second session",
              video_runner._QUEUE, [])
        check("and did not take the runner off this one",
              video_runner._ACTIVE, sid)

        gate.set()
        done = _await_session(sid)
        check("the armed slot was re-run by the pass already going",
              done["variations"][0]["seed"], 12345)
        check("every slot ends done",
              [v["status"] for v in done["variations"]], ["done"] * 3)
    finally:
        gate.set()


def _fan_out_world(fail: frozenset[str] = frozenset()) -> dict:
    """A RunPod double for the fan-out fixtures. Every job holds at IN_PROGRESS
    until it is released, and the double counts how many jobs are submitted but not
    yet terminal at any one moment — the one number the fan-out must never exceed.
    Job ids are dealt in submit order, so the first wave under a cap of 3 is always
    `job1..job3`, and the wave that replaces it `job4..job6`."""
    import threading
    import time

    import batch_atlas

    b64 = __import__("base64").b64encode(b"WEBPDATA").decode()
    lock = threading.Lock()
    w: dict = {"live": set(), "peak": 0, "submitted": 0, "released": set(),
               "cancelled": set(), "release_all": False}

    def post(path, payload):
        with lock:
            if path == "/run":
                w["submitted"] += 1
                jid = f"job{w['submitted']}"
                w["live"].add(jid)
                w["peak"] = max(w["peak"], len(w["live"]))
                return {"id": jid}
            if path.startswith("/cancel/"):
                jid = path.rsplit("/", 1)[-1]
                w["cancelled"].add(jid)
                w["live"].discard(jid)
            return {}

    def get(path):
        jid = path.rsplit("/", 1)[-1]
        with lock:
            if jid in w["cancelled"]:
                return {"id": jid, "status": "CANCELLED"}
            if not (w["release_all"] or jid in w["released"]):
                return {"status": "IN_PROGRESS"}
            w["live"].discard(jid)
        if jid in fail:
            return {"status": "FAILED", "error": "worker fell over"}
        return {"status": "COMPLETED", "output": {"images": [
            {"filename": "out.webp", "image": b64}]}}

    def release(*jids: str) -> None:
        """Let the named jobs complete — or, with no names, every job from now on."""
        with lock:
            if jids:
                w["released"].update(jids)
            else:
                w["release_all"] = True

    def hold() -> None:
        """Hold every job from now on again — the state a fresh double starts in,
        without dealing the job ids from `job1` a second time."""
        with lock:
            w["release_all"] = False
            w["released"].clear()

    def await_live(want: set[str], timeout: float = 10.0) -> list[str]:
        """Wait until EXACTLY these jobs are in flight. A count would be satisfied
        by the wave that has not been collected yet; the set is not."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            with lock:
                if w["live"] == want:
                    return sorted(w["live"])
            time.sleep(0.02)
        with lock:
            return sorted(w["live"])

    batch_atlas._runpod_post = post
    batch_atlas._runpod_get = get
    w["release"] = release
    w["hold"] = hold
    w["await_live"] = await_live
    return w


def test_parallel_jobs_fan_out_across_workers() -> None:
    """RunPod only wakes a second worker when a second job is WAITING. The runner
    submitted one job at a time, so an endpoint with three workers ran a twelve-tile
    grid on one of them while the other two never left idle. With `PARALLEL_JOBS`
    raised, up to that many of a session's variations are in flight at once —
    and never more, because the surplus would only sit IN_QUEUE."""
    _, objects = _stub_world()
    w = _fan_out_world()
    saved = video_runner.PARALLEL_JOBS
    video_runner.PARALLEL_JOBS = 3
    try:
        sid = video_runner.start_session(_req("grid", 12), ("clientx", "projecty"))["id"]
        check("three jobs go out before any has finished",
              w["await_live"]({"job1", "job2", "job3"}), ["job1", "job2", "job3"])
        w["release"]("job1", "job2", "job3")
        check("the freed slots are refilled with the next three",
              w["await_live"]({"job4", "job5", "job6"}), ["job4", "job5", "job6"])
        w["release"]()
        final = _await_session(sid)
        check("all twelve end done",
              [v["status"] for v in final["variations"]], ["done"] * 12)
        check("each in its own slot",
              [v["file"] for v in final["variations"]],
              ["%03d.webp" % i for i in range(1, 13)])
        check("the peak in flight was exactly the cap, never more", w["peak"], 3)
        check("the session reads finished", final.get("status"), "finished")
        # Idle FIRST: the status flips a beat before the finaliser writes
        # `meta.json`, and the hand-off comes after that write — see `_await_idle`.
        check("the runner ends idle", _await_idle(), None)
        meta = json.loads(objects["clientx/projecty/video/%s/meta.json" % sid])
        check("meta.json written by twelve threads still agrees with memory",
              (meta["done_count"], [v["status"] for v in meta["variations"]]),
              (12, ["done"] * 12))
        # The context is thread-local, and a variation thread inherits nobody's.
        workers = {t for t, _ in SET_CONTEXT_CALLS if t != threading.get_ident()}
        check("the project context was set on at least three worker threads",
              len(workers) >= 3, True)
        check("and every time to the session's own client/project",
              {a for _, a in SET_CONTEXT_CALLS}, {("clientx", "projecty")})
    finally:
        video_runner.PARALLEL_JOBS = saved
        w["release"]()


def test_default_stays_serial() -> None:
    """The default cap is 1, and at 1 the runner is what it was: one job out, the
    next only after it has finished. Every extra worker is a cold start and a
    multiplied burn rate, so nobody pays for fan-out without asking for it."""
    _stub_world()
    w = _fan_out_world()
    saved = video_runner.PARALLEL_JOBS
    video_runner.PARALLEL_JOBS = 1
    try:
        sid = video_runner.start_session(_req("serial", 4), ("clientx", "projecty"))["id"]
        check("one job goes out", w["await_live"]({"job1"}), ["job1"])
        w["release"]("job1")
        check("the second only once the first has finished",
              w["await_live"]({"job2"}), ["job2"])
        w["release"]()
        final = _await_session(sid)
        check("every slot ends done",
              [v["status"] for v in final["variations"]], ["done"] * 4)
        check("and at no point was more than one in flight", w["peak"], 1)
    finally:
        video_runner.PARALLEL_JOBS = saved
        w["release"]()


def test_cancel_mid_fanout_stops_every_inflight_job() -> None:
    """Cancelling a fanned-out session has to stop EVERY job it has in flight, not
    just the one a serial runner would have had — and must not hand the runner on
    while any of those threads is still live, or the next session races them."""
    _stub_world()
    w = _fan_out_world()
    saved = video_runner.PARALLEL_JOBS
    video_runner.PARALLEL_JOBS = 3
    try:
        ctx = ("clientx", "projecty")
        sid = video_runner.start_session(_req("stop", 12), ctx)["id"]
        w["await_live"]({"job1", "job2", "job3"})
        video_runner.cancel_session(sid)
        final = _await_session(sid)
        check("the session reads cancelled", final.get("status"), "cancelled")
        check("every in-flight job was cancelled remotely",
              sorted(w["cancelled"]), ["job1", "job2", "job3"])
        check("nothing further was submitted after the stop", w["submitted"], 3)
        check("every slot reads cancelled, none failed",
              [v["status"] for v in final["variations"]], ["cancelled"] * 12)
        check("and none carries an error",
              [v["error"] for v in final["variations"]], [""] * 12)
        check("the runner is handed back", _await_idle(), None)

        w["release"]()
        nxt = video_runner.start_session(_req("after the stop", 1), ctx)
        check("so a following session runs",
              _await_session(nxt["id"]).get("status"), "finished")
    finally:
        video_runner.PARALLEL_JOBS = saved
        w["release"]()


def test_one_failure_in_a_fanout_does_not_sink_the_rest() -> None:
    """A job that fails on its worker is one red tile, exactly as it was when the
    runner was serial. The other eleven finish."""
    _stub_world()
    w = _fan_out_world(fail=frozenset({"job5"}))
    saved = video_runner.PARALLEL_JOBS
    video_runner.PARALLEL_JOBS = 3
    w["release"]()
    try:
        sid = video_runner.start_session(_req("mixed", 12), ("clientx", "projecty"))["id"]
        final = _await_session(sid)
        statuses = [v["status"] for v in final["variations"]]
        check("eleven finish", statuses.count("done"), 11)
        check("one fails", statuses.count("failed"), 1)
        bad = next(v for v in final["variations"] if v["status"] == "failed")
        check("and it says why", "FAILED" in bad["error"], True)
        check("the session still reads finished, with the right count",
              (final.get("status"), final.get("done_count")), ("finished", 11))
        check("the runner ends idle", _await_idle(), None)
    finally:
        video_runner.PARALLEL_JOBS = saved


def test_a_reroll_mid_fanout_takes_a_free_slot_at_once() -> None:
    """With nothing eligible and a job still in flight the dispatcher sleeps on
    its condition, and the only thing that used to wake it was a worker exiting.
    A re-roll (or ＋ Add) armed in that state was re-picked correctly — but only
    once the held job finished: tile 1 sat `queued` beside two free slots for as
    long as tile 2 took. The arming call sites now wake the dispatcher themselves."""
    _stub_world()
    w = _fan_out_world()
    saved = video_runner.PARALLEL_JOBS
    video_runner.PARALLEL_JOBS = 3
    try:
        ctx = ("clientx", "projecty")
        sid = video_runner.start_session(_req("wake", 2), ctx)["id"]
        w["await_live"]({"job1", "job2"})
        w["release"]("job1")
        _await_var(sid, 1, "done")  # #001 finished; #002 is held in flight

        video_runner.regenerate_variation(sid, {"index": 1, "seed": "777"}, ctx)
        check("the re-roll is submitted while #002 is still held",
              w["await_live"]({"job2", "job3"}), ["job2", "job3"])

        w["release"]()
        final = _await_session(sid)
        check("the re-rolled tile carries its new seed",
              final["variations"][0]["seed"], 777)
        check("both end done",
              [v["status"] for v in final["variations"]], ["done"] * 2)
    finally:
        video_runner.PARALLEL_JOBS = saved
        w["release"]()


def test_cancel_settles_resumed_tiles_the_cap_never_claimed() -> None:
    """A grid run at `VIDEO_PARALLEL_JOBS=3`, the variable lowered, the service
    redeployed: the new process adopts a doc holding three `running` tiles and,
    under a cap of 1, claims only the first. Stop `/cancel`led all three jobs
    remotely, but the dispatcher's sweep settled only `queued` tiles — so the two
    it never claimed stayed `running` with no thread behind them, and re-rolling
    either was refused for good with "still rendering. Cancel the session first"."""
    import time

    import batch_atlas

    _, objects = _stub_world()
    w = _fan_out_world()
    w["release"]()
    saved = video_runner.PARALLEL_JOBS
    video_runner.PARALLEL_JOBS = 3
    try:
        ctx = ("clientx", "projecty")
        sid = video_runner.start_session(_req("wide", 3), ctx)["id"]
        _await_session(sid)
        _await_idle()

        # The restart: memory is gone, and the stored doc was captured with all
        # three in flight — under the old, wider cap.
        key = "clientx/projecty/video/%s/meta.json" % sid
        meta = json.loads(objects[key])
        meta["status"] = "running"
        for v in meta["variations"]:
            v.update(status="running", file="", bytes=0, finished=None)
        objects[key] = json.dumps(meta).encode()
        video_runner._SESSIONS.clear()
        video_runner._ACTIVE = None
        video_runner.PARALLEL_JOBS = 1
        w["hold"]()

        polled: set[str] = set()
        inner = batch_atlas._runpod_get

        def spy(path):
            polled.add(path.rsplit("/", 1)[-1])
            return inner(path)

        batch_atlas._runpod_get = spy

        check("reading the orphan adopts it",
              video_runner.get_session(sid) is not None, True)
        deadline = time.time() + 5
        while "job1" not in polled and time.time() < deadline:
            time.sleep(0.01)
        check("the one slot the cap allows is re-attached and polling",
              "job1" in polled, True)

        video_runner.cancel_session(sid)
        final = _await_session(sid)
        check("the session reads cancelled", final.get("status"), "cancelled")
        check("every tile reads cancelled — the two the cap never claimed included",
              [v["status"] for v in final["variations"]], ["cancelled"] * 3)
        check("none is left running", any(
            v["status"] == "running" for v in final["variations"]), False)
        check("all three jobs were stopped remotely",
              sorted(w["cancelled"]), ["job1", "job2", "job3"])
        check("the runner is handed back", _await_idle(), None)

        # Which is the whole point: a tile the old sweep left `running` re-rolls.
        w["release"]()
        video_runner.regenerate_variation(sid, {"index": 2, "seed": "9"}, ctx)
        redone = _await_session(sid)
        check("an unclaimed tile can be re-rolled after the stop",
              redone["variations"][1]["status"], "done")
    finally:
        video_runner.PARALLEL_JOBS = saved
        w["release"]()


def test_request_validation() -> None:
    _stub_world()
    ctx = ("clientx", "projecty")
    check_raises("no blueprint is refused",
                 lambda: video_runner.start_session({"prompt": "x"}, ctx),
                 "blueprint")
    check_raises("no prompt is refused",
                 lambda: video_runner.start_session(
                     {"blueprint": "wan22_i2v_flipbook"}, ctx), "prompt")
    check_raises("an i2v blueprint with no source image is refused",
                 lambda: video_runner.start_session(
                     {"blueprint": "wan22_i2v_flipbook", "prompt": "x"}, ctx),
                 "source image")
    check_raises("a variation count below one is refused",
                 lambda: video_runner.start_session(
                     {"blueprint": "wan22_i2v_flipbook", "prompt": "x",
                      "source_ref": "r.png", "variations": -1}, ctx),
                 "at least 1")


if __name__ == "__main__":
    test_workflow_build()
    test_birefnet_surface_is_complete()
    test_param_clamping()
    test_a_param_with_no_declared_domain_cannot_be_clamped()
    test_node_contracts_are_read_not_guessed()
    test_a_sleeping_pod_is_not_an_error()
    test_the_catalog_is_the_machine_that_runs_the_graph()
    test_options_from_survives_the_param_whitelist()
    test_source_image_required()
    test_output_picking()
    test_an_empty_payload_names_its_real_cause()
    test_a_render_is_read_back_from_storage_not_the_wire()
    test_a_resumed_job_can_still_find_its_uploaded_render()
    test_the_handoff_degrades_rather_than_failing()
    test_a_session_list_is_complete_or_it_is_an_error()
    test_opening_and_cancelling_survive_a_flaky_read_too()
    test_absent_and_unreadable_are_not_the_same_answer()
    test_session_id_validation()
    test_session_lifecycle()
    test_blueprint_kind()
    test_bundled_blueprints_stay_in_step()
    test_wrong_kind_is_refused()
    test_resume_after_restart()
    test_cancel_a_session_we_do_not_own()
    test_a_queued_session_survives_a_restart()
    test_a_second_session_queues()
    test_queue_depth_is_capped()
    test_cancelling_reads_as_cancelled_not_failed()
    test_a_cancel_runpod_refuses_is_reported_not_swallowed()
    test_cancelling_a_session_no_worker_owns()
    test_a_transient_status_blip_does_not_lose_a_job()
    test_contact_lost_for_good_stops_the_job()
    test_a_purged_job_collects_the_render_it_left_in_r2()
    test_a_purged_job_with_nothing_to_collect_says_what_happened()
    test_an_unreadable_job_still_collects_a_render_that_landed()
    test_a_404_before_the_job_is_ever_read_keeps_the_long_grace()
    test_a_mixed_run_of_bad_reads_takes_the_long_grace()
    test_a_reroll_cannot_rescue_the_attempt_before_it()
    test_the_rescue_prefers_the_clip_over_a_preview()
    test_an_unreadable_slot_is_not_an_empty_one()
    test_a_job_runpod_calls_failed_still_hands_back_its_render()
    test_an_empty_payload_is_not_a_lost_render_when_the_slot_has_one()
    test_a_stop_after_the_upload_keeps_the_render()
    test_a_lost_job_id_does_not_lose_the_render_too()
    test_a_restart_reattaches_before_anyone_opens_the_page()
    test_a_boot_collects_the_running_job_and_starts_nothing_else()
    test_two_adopters_cannot_take_the_same_session_twice()
    test_a_failure_before_the_job_exists_still_settles_the_tile()
    test_a_rescue_that_cannot_be_persisted_does_not_wedge_the_runner()
    test_a_stale_slot_is_not_offered_as_this_attempt_s_render()
    test_a_rescue_during_adoption_is_persisted()
    test_stopping_an_orphaned_session_keeps_what_it_delivered()
    test_deleting_a_session_takes_its_hand_off_slots_with_it()
    test_a_delete_r2_refused_is_reported_not_drawn_as_gone()
    test_a_delete_that_cannot_be_verified_is_not_called_clean()
    test_the_sweep_rehomes_a_render_nothing_is_coming_back_for()
    test_the_sweep_deletes_what_can_never_be_collected()
    test_the_sweep_keeps_its_hands_off_a_live_session()
    test_a_slot_name_is_read_back_the_way_it_was_written()
    test_a_finished_render_never_loses_a_merge()
    test_a_stale_container_cannot_undo_a_collected_render()
    test_a_session_another_container_holds_is_left_alone()
    test_an_expired_lease_is_taken_over_and_the_tail_runs_once()
    test_stop_reaches_a_session_this_container_does_not_own()
    test_the_lease_fails_open()
    test_the_lease_predicates_read_like_the_store_enforces_them()
    test_a_merge_survives_the_next_write()
    test_the_merge_respects_a_delete_and_an_ended_session()
    test_the_lease_is_renewed_while_a_render_is_running()
    test_the_takeable_boundary_matches_the_sql()
    test_our_cap_sits_above_the_endpoints_own_timeout()
    test_a_dead_worker_does_not_wedge_the_runner()
    test_regenerate_one_variation()
    test_discard_one_variation()
    test_a_tile_r2_would_not_drop_still_goes_but_says_so()
    test_a_tile_whose_removal_cannot_be_confirmed_says_that_instead()
    test_add_variations_to_a_session()
    test_duplicate_a_variation_with_new_settings()
    test_a_session_has_no_variation_ceiling()
    test_a_reroll_mid_run_joins_the_pass_already_under_way()
    test_parallel_jobs_fan_out_across_workers()
    test_default_stays_serial()
    test_cancel_mid_fanout_stops_every_inflight_job()
    test_one_failure_in_a_fanout_does_not_sink_the_rest()
    test_a_reroll_mid_fanout_takes_a_free_slot_at_once()
    test_cancel_settles_resumed_tiles_the_cap_never_claimed()
    test_request_validation()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all video-runner fixtures pass")
