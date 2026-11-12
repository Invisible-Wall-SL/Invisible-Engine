"""Offline guard for the shared ComfyUI client (iw_common/comfy.py).

Run:  PYTHONPATH=. py test_iw_comfy.py     (from services/_shared)

The Atlas Maker (its render subprocess, its per-user routing and the
"does this ComfyUI answer?" preflight) and the RunPod worker all talk to
ComfyUI through this module, so its contract is pinned here directly:

  * every call carries the non-blocked User-Agent (Cloudflare 403s
    Python-urllib's) and, when configured, BOTH halves of the CF Access token;
  * a per-user tunnel never receives the shared tunnel's token;
  * the execution error is read the way the worker summarises it AND the way
    the Atlas Maker classified it before the two shared one parser.

A real local HTTP server answers the calls — no ComfyUI, no network.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from iw_common import comfy
from iw_common.testkit import Suite

t = Suite()


class _Comfy(BaseHTTPRequestHandler):
    """Echoes what it was sent; `/history/<id>` answers like ComfyUI."""

    seen: list[dict] = []

    def log_message(self, *a):
        pass

    def _answer(self, obj) -> None:
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _headers(self) -> dict:
        return {k.lower(): v for k, v in self.headers.items()}

    def do_GET(self):
        self.seen.append({"method": "GET", "path": self.path, "headers": self._headers()})
        if self.path == "/history/done":
            self._answer({"done": {"status": {"status_str": "success"}}})
        elif self.path.startswith("/history/"):
            self._answer({})
        else:
            self._answer({"ok": True})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.seen.append({"method": "POST", "path": self.path, "headers": self._headers(),
                          "body": json.loads(self.rfile.read(n))})
        self._answer({"prompt_id": "p1"})


def test_cf_headers_come_from_the_env_given() -> None:
    both = {"CF_ACCESS_CLIENT_ID": "id", "CF_ACCESS_CLIENT_SECRET": "sec"}
    t.check("both halves set: UA + both token headers", comfy.cf_headers(both),
            {"User-Agent": "InvisibleAtlas/1.0", "CF-Access-Client-Id": "id",
             "CF-Access-Client-Secret": "sec"})
    t.check("one half alone sends no token at all",
            comfy.cf_headers({"CF_ACCESS_CLIENT_ID": "id"}), {"User-Agent": "InvisibleAtlas/1.0"})
    t.check("an empty half counts as absent (a quick tunnel clears them this way)",
            comfy.cf_headers({"CF_ACCESS_CLIENT_ID": "id", "CF_ACCESS_CLIENT_SECRET": ""}),
            {"User-Agent": "InvisibleAtlas/1.0"})
    t.check("the UA is never Python-urllib's", comfy.USER_AGENT.startswith("Python"), False)


def test_a_per_user_tunnel_never_gets_the_shared_token() -> None:
    shared = {"User-Agent": "InvisibleAtlas/1.0", "CF-Access-Client-Id": "shared-id",
              "cf-access-client-secret": "shared-sec"}
    t.check("no per-user COMFY_URL: the shared headers, unchanged",
            comfy.routed_headers(shared, {"COMFY_TRANSPORT": "http"}), shared)
    out = comfy.routed_headers(shared, {"COMFY_TRANSPORT": "http"})
    out["X"] = "y"
    t.check("...as a copy the caller may change", "X" in shared, False)
    t.check("a named tunnel: its own token replaces the shared one (any case)",
            comfy.routed_headers(shared, {"COMFY_URL": "https://mine", "CF_ACCESS_CLIENT_ID": "me",
                                          "CF_ACCESS_CLIENT_SECRET": "my-sec"}),
            {"User-Agent": "InvisibleAtlas/1.0", "CF-Access-Client-Id": "me",
             "CF-Access-Client-Secret": "my-sec"})
    t.check("a quick tunnel (empty token): no CF header at all",
            comfy.routed_headers(shared, {"COMFY_URL": "https://quick", "CF_ACCESS_CLIENT_ID": "",
                                          "CF_ACCESS_CLIENT_SECRET": ""}),
            {"User-Agent": "InvisibleAtlas/1.0"})


def test_the_json_calls_against_a_live_server() -> None:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Comfy)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    headers = comfy.cf_headers({"CF_ACCESS_CLIENT_ID": "id", "CF_ACCESS_CLIENT_SECRET": "sec"})
    _Comfy.seen.clear()
    try:
        t.check("get_json parses the answer", comfy.get_json(f"{base}/system_stats", headers, 5),
                {"ok": True})
        got = _Comfy.seen[-1]["headers"]
        t.check("...sending the UA and the token",
                (got.get("user-agent"), got.get("cf-access-client-id"),
                 got.get("cf-access-client-secret")), ("InvisibleAtlas/1.0", "id", "sec"))

        t.check("post_json parses the answer",
                comfy.post_json(f"{base}/prompt", {"prompt": {"1": {}}}, headers, 5),
                {"prompt_id": "p1"})
        sent = _Comfy.seen[-1]
        t.check("...posting the payload as JSON",
                (sent["body"], sent["headers"].get("content-type")),
                ({"prompt": {"1": {}}}, "application/json"))
        t.check("...with the same UA", sent["headers"].get("user-agent"), "InvisibleAtlas/1.0")

        t.check("history_entry: the prompt's entry once ComfyUI has it",
                comfy.history_entry(base, "done", headers, 5), {"status": {"status_str": "success"}})
        t.check("...and None while it is still running",
                comfy.history_entry(base, "pending", headers, 5), None)
    finally:
        srv.shutdown()

    seen: dict = {}

    def fake_urlopen(req, timeout="MISSING"):
        seen["timeout"] = timeout
        raise TimeoutError("stop")

    real = comfy.urlopen
    comfy.urlopen = fake_urlopen  # type: ignore[assignment]
    try:
        for fn, args in ((comfy.get_json, ("http://x", {}, 3.5)),
                         (comfy.post_json, ("http://x", {}, {}, 7.0))):
            try:
                fn(*args)
            except TimeoutError:
                pass
            t.check(f"{fn.__name__} passes its timeout through", seen.get("timeout"), args[-1])
    finally:
        comfy.urlopen = real  # type: ignore[assignment]


OOM = {
    "status_str": "error", "completed": False,
    "messages": [
        ["execution_start", {"prompt_id": "p1"}],
        ["execution_error", {
            "prompt_id": "p1", "node_id": "202", "node_type": "BiRefNetRMBG",
            "exception_type": "torch.OutOfMemoryError",
            "exception_message": "  CUDA out of memory.\n  Tried to allocate 2.00 GiB.  ",
        }],
        ["execution_error", {"node_type": "Second", "exception_message": "later"}],
    ],
}


def _atlas_reading_before(status: dict) -> tuple:
    """batch_atlas.run_region's inline loop as it was before the shared parser —
    the reference the shared one must reproduce for what ComfyUI sends."""
    msg = node = None
    for m in status.get("messages", []):
        if m and m[0] == "execution_error":
            info = m[1] or {}
            node = info.get("node_type") or info.get("node_id")
            msg = (info.get("exception_message") or "").strip()
            break
    return node, msg


def _atlas_reading_now(status: dict) -> tuple:
    msg = node = None
    info = comfy.execution_error(status)
    if info is not None:
        node = info.get("node_type") or info.get("node_id")
        msg = (info.get("exception_message") or "").strip()
    return node, msg


def test_the_execution_error() -> None:
    t.check("the FIRST execution_error event's data", comfy.execution_error(OOM)["node_id"], "202")
    t.check("no event: None", comfy.execution_error({"messages": [["execution_start", {}]]}), None)
    t.check("no messages / no status: None",
            (comfy.execution_error({"messages": None}), comfy.execution_error(None)), (None, None))
    t.check("a malformed entry is skipped, not trusted",
            comfy.execution_error({"messages": [["execution_error"], ["execution_error", "x"],
                                                ["execution_error", {"node_id": "9"}]]}),
            {"node_id": "9"})

    t.check("the worker's one-line summary",
            comfy.describe_execution_error(OOM),
            "BiRefNetRMBG #202: OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB.")
    t.check("...without a node id or exception type",
            comfy.describe_execution_error(
                {"messages": [["execution_error", {"node_type": "K", "exception_message": "m"}]]}),
            "K: m")
    t.check("...capped so the node name survives a traceback-sized message",
            len(comfy.describe_execution_error({"messages": [["execution_error", {
                "node_type": "KSampler", "exception_type": "RuntimeError",
                "exception_message": "x" * 1000}]]})) < 300, True)
    t.check("...and empty without an execution error", comfy.describe_execution_error({}), "")

    cases = [
        OOM,
        {"messages": []},
        {"messages": [["execution_error", {"node_id": "7", "exception_message": "no type"}]]},
        {"messages": [["execution_error", {}]]},
        {"messages": [["execution_cached", {"nodes": []}],
                      ["execution_error", {"node_type": "Login", "exception_message": None}]]},
    ]
    for i, status in enumerate(cases):
        t.check(f"the Atlas Maker reads case {i} exactly as before",
                _atlas_reading_now(status), _atlas_reading_before(status))


if __name__ == "__main__":
    t.run(test_cf_headers_come_from_the_env_given,
          test_a_per_user_tunnel_never_gets_the_shared_token,
          test_the_json_calls_against_a_live_server,
          test_the_execution_error)
    t.exit("iw_common.comfy")
