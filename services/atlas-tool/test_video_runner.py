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
    test_param_clamping()
    test_source_image_required()
    test_output_picking()
    test_session_id_validation()
    test_session_lifecycle()
    test_blueprint_kind()
    test_wrong_kind_is_refused()
    test_resume_after_restart()
    test_cancel_a_session_we_do_not_own()
    test_request_validation()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: {', '.join(FAILED)}")
        sys.exit(1)
    print("all video-runner fixtures pass")
