"""Offline guard: a paused RunPod endpoint is reported in words, with the fix.

Run:  PYTHONPATH=../_shared py test_runpod_paused.py   (from services/atlas-tool)

Reported 2026-11-16 from the Flipbook: every slot showed RunPod's raw
`409 ... "code":"ENDPOINT_PAUSED"` JSON. The endpoint's Max workers had been set
to 0, which is a console setting, not a fault, so the tool now says what it is and
where to change it. Any other RunPod error keeps its raw answer.
"""
from __future__ import annotations

import io
import json
import os
import sys
from urllib.error import HTTPError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("RUNPOD_API_KEY", "test-key")

import batch_atlas  # noqa: E402

PAUSED_BODY = json.dumps({
    "status": 409,
    "title": "Conflict",
    "detail": "Endpoint is paused (max_workers=0). Set max_workers > 0 to accept work.",
    "code": "ENDPOINT_PAUSED",
})


def _answer(code: int, reason: str, body: str):
    def fake_urlopen(req, timeout=None):
        raise HTTPError(req.full_url, code, reason, {}, io.BytesIO(body.encode("utf-8")))
    return fake_urlopen


def _raised(fn) -> batch_atlas.RunPodHTTPError:
    try:
        fn()
    except batch_atlas.RunPodHTTPError as e:
        return e
    raise AssertionError("expected RunPodHTTPError")


def test_a_paused_endpoint_is_said_in_words() -> None:
    batch_atlas.urlopen = _answer(409, "Conflict", PAUSED_BODY)
    e = _raised(lambda: batch_atlas._runpod_post("/run", {"input": {}}, "ep123"))
    assert e.code == 409
    msg = str(e)
    assert "paused" in msg and "Max workers" in msg and "Edit endpoint" in msg, msg
    assert "ENDPOINT_PAUSED" not in msg and "{" not in msg, msg


def test_a_paused_endpoint_on_status_reads_the_same() -> None:
    batch_atlas.urlopen = _answer(409, "Conflict", PAUSED_BODY)
    e = _raised(lambda: batch_atlas._runpod_get("/status/abc", "ep123"))
    assert e.code == 409 and "Max workers" in str(e)


def test_other_errors_keep_the_raw_answer() -> None:
    batch_atlas.urlopen = _answer(500, "Internal Server Error", "boom")
    e = _raised(lambda: batch_atlas._runpod_post("/run", {"input": {}}, "ep123"))
    assert e.code == 500
    assert str(e) == "RunPod /run failed: HTTP 500 Internal Server Error: boom", str(e)


def test_a_409_with_another_code_keeps_the_raw_answer() -> None:
    body = json.dumps({"status": 409, "code": "SOMETHING_ELSE"})
    batch_atlas.urlopen = _answer(409, "Conflict", body)
    e = _raised(lambda: batch_atlas._runpod_post("/run", {"input": {}}, "ep123"))
    assert str(e).startswith("RunPod /run failed: HTTP 409 Conflict: "), str(e)


if __name__ == "__main__":
    real = batch_atlas.urlopen
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
    finally:
        batch_atlas.urlopen = real
    print(f"{len(tests)} passed")
