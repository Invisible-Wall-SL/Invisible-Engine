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
import sys
from pathlib import Path

import video_runner

FAILED: list[str] = []


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
    check("the model list is the node's full 12",
          len(cutout["birefnet_model"]["options"]), 12)
    check("and the authored default is in it",
          cutout["birefnet_model"]["default"] in cutout["birefnet_model"]["options"], True)
    check("background offers exactly the node's two modes",
          cutout["background"]["options"], ["Alpha", "Color"])

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

    import batch_atlas

    tmp = Path(tempfile.mkdtemp(prefix="iw-video-test-"))
    objects: dict[str, bytes] = {}

    # Start from an idle runner. A test that leaves a session behind would
    # otherwise QUEUE the next test's session instead of running it.
    video_runner._SESSIONS.clear()
    video_runner._QUEUE.clear()
    video_runner._ACTIVE = None
    video_runner._cancel_job = REAL_CANCEL_JOB

    video_runner.storage.put = lambda k, b, c=None: objects.__setitem__(k, b)
    video_runner.storage.get = lambda k: objects.get(k)
    video_runner.storage.delete = lambda k: objects.pop(k, None)
    video_runner.storage.list_keys = lambda p: [
        {"key": k} for k in list(objects) if k.startswith(p)]

    video_runner.project_paths.resolve = lambda: {
        "r2_project_prefix": "clientx/projecty", "staging_root": tmp}
    video_runner.project_paths.set_context = lambda *a, **k: True
    video_runner.project_paths.project_name = lambda: "projecty"

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


def _await_session(sid: str, timeout: float = 15.0) -> dict:
    import time
    deadline = time.time() + timeout
    cur = {}
    while time.time() < deadline:
        cur = video_runner.get_session(sid) or {}
        if cur.get("status") in ("finished", "cancelled"):
            return cur
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


def _req(prompt: str, variations: int = 1) -> dict:
    return {"blueprint": "wan22_i2v_flipbook", "prompt": prompt,
            "source_ref": "r.png", "variations": variations}


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


def test_our_cap_sits_above_the_endpoints_own_timeout() -> None:
    """`JOB_TIMEOUT_SECONDS` is a backstop for a job RunPod never resolves, NOT a
    render budget: RunPod times a job from worker pickup, this counts from
    submit. At 1800 it cancelled two-pass renders the endpoint was still happy to
    finish, so it must stay well above any endpoint Execution Timeout."""
    check("the cap is loose enough for a multi-pass video blueprint",
          video_runner.JOB_TIMEOUT_SECONDS >= 9000, True)


def test_a_dead_worker_does_not_wedge_the_runner() -> None:
    """`_ACTIVE` was only cleared on the happy path, so any escape before it left
    the tool answering "a video session is already running" until the container
    restarted — with no way out from the UI."""
    _stub_world()
    ctx = ("clientx", "projecty")
    real = video_runner._run_variations

    def explode(sid, session):
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


def test_a_session_will_not_grow_past_its_ceiling() -> None:
    """The per-session ceiling has to hold on EVERY path that grows a session, or
    the one that skipped it becomes the way around it."""
    _stub_world()
    ctx = ("clientx", "projecty")
    sid = video_runner.start_session(_req("p", 1), ctx)["id"]
    _await_session(sid)
    session = video_runner._SESSIONS[sid]
    # Fill it to the ceiling without paying for the renders.
    with video_runner._LOCK:
        session["variations"].extend(
            dict(video_runner._new_variation(i), status="done", file=f"{i:03d}.webp")
            for i in range(2, video_runner.MAX_SESSION_VARIATIONS + 1))
    check_raises("a duplicate past the ceiling is refused",
                 lambda: video_runner.duplicate_variation(sid, {"index": 1}, ctx),
                 "ceiling")
    check_raises("and so is an add",
                 lambda: video_runner.add_variations(sid, {"count": 1}, ctx),
                 str(video_runner.MAX_SESSION_VARIATIONS))


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

    check_raises("a runaway add is refused",
                 lambda: video_runner.add_variations(sid, {"count": 500}, ctx),
                 "between 1 and")

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
    check_raises("a runaway variation count is refused",
                 lambda: video_runner.start_session(
                     {"blueprint": "wan22_i2v_flipbook", "prompt": "x",
                      "source_ref": "r.png", "variations": 500}, ctx),
                 "between 1 and")


if __name__ == "__main__":
    test_workflow_build()
    test_birefnet_surface_is_complete()
    test_param_clamping()
    test_source_image_required()
    test_output_picking()
    test_session_id_validation()
    test_session_lifecycle()
    test_blueprint_kind()
    test_bundled_blueprints_stay_in_step()
    test_wrong_kind_is_refused()
    test_resume_after_restart()
    test_cancel_a_session_we_do_not_own()
    test_a_second_session_queues()
    test_queue_depth_is_capped()
    test_cancelling_reads_as_cancelled_not_failed()
    test_a_transient_status_blip_does_not_lose_a_job()
    test_contact_lost_for_good_stops_the_job()
    test_our_cap_sits_above_the_endpoints_own_timeout()
    test_a_dead_worker_does_not_wedge_the_runner()
    test_regenerate_one_variation()
    test_discard_one_variation()
    test_add_variations_to_a_session()
    test_duplicate_a_variation_with_new_settings()
    test_a_session_will_not_grow_past_its_ceiling()
    test_a_reroll_mid_run_joins_the_pass_already_under_way()
    test_request_validation()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all video-runner fixtures pass")
