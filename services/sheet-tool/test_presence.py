"""Offline guard: "X is editing this sheet" names the SIGNED holder (no R2, no network).

    PYTHONPATH=".;../_shared" py test_presence.py     (from services/sheet-tool; needs node)

The Sheet Maker's `/presence` is the Atlas Maker's (iw_common/presence.py), keyed
`sheetMaker/<sheet>`. Pinned, through the real gate and handler:

  * A claims a sheet; B, on the same sheet, is told A is editing it; A's other tab
    is told it is A; A releases and B takes it; B moving to another sheet frees
    the first.
  * Who holds it comes from the signed session only: a name or uid in the body
    is ignored, and an unsigned or forged caller is refused before any lease is
    written. With no gate configured (local dev) the holder is anonymous.
  * The page half (presence.js, inlined by `_page()`): a sheet switch releases
    the old sheet and claims the new one, one request at a time, and a late
    answer about the sheet it left never paints the banner.

ASCII only in the labels (cp1252 consoles).
"""
from __future__ import annotations

import base64
import http.client
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer

os.environ["SHEET_STAGING"] = tempfile.mkdtemp(prefix="sheet-presence-")
SIGNING = "sheet-presence-signing-0123456789"
os.environ["SHEET_TOOL_SIGNING_SECRET"] = SIGNING
for _k in ("SHEET_TOOL_SECRET", "R2_BUCKET"):
    os.environ.pop(_k, None)

import sheet_server as s  # noqa: E402
from iw_common import launch, presence, storage  # noqa: E402

FAILED: list[str] = []
LEASE = "acme/slots_one/_leases/sheetMaker/{}.json"


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        # ascii(): a banner carries an emoji, which a cp1252 console cannot print.
        print(f"       got  {ascii(got)}\n       want {ascii(want)}")
        FAILED.append(label)


class LeaseBucket:
    """The three calls lease.py makes, with R2's precondition semantics."""

    def __init__(self) -> None:
        self.o: dict[str, tuple[bytes, str]] = {}
        self.n = 0
        self.lock = threading.Lock()

    def get_with_etag(self, k):
        with self.lock:
            return self.o.get(k)

    def put(self, k, b, c=None, *, if_match=None, if_none_match=None):
        with self.lock:
            if if_none_match == "*" and k in self.o:
                raise storage.Conflict(k)
            if if_match and if_match != "*" and (k not in self.o or self.o[k][1] != if_match):
                raise storage.Conflict(k)
            self.n += 1
            self.o[k] = (bytes(b), f'"l{self.n}"')
            return self.o[k][1]

    def delete(self, k):
        with self.lock:
            self.o.pop(k, None)

    def row(self, sheet: str) -> dict | None:
        got = self.o.get(LEASE.format(sheet))
        return json.loads(got[0]) if got else None


def launch_token(sub: str, uid: str, name: str) -> str:
    now = int(time.time())
    return launch.sign(SIGNING, {
        "v": 1, "typ": "launch", "aud": "sheet", "sub": sub, "uid": uid, "name": name,
        "role": "artist", "client": "acme", "project": "slots_one", "caps": [],
        "iat": now, "exp": now + 120})


def _conn(port: int) -> http.client.HTTPConnection:
    return http.client.HTTPConnection("127.0.0.1", port, timeout=30)


def session(port: int, tok: str) -> str:
    c = _conn(port)
    c.request("GET", f"/?iw_launch={tok}")
    r = c.getresponse()
    r.read()
    cookies = r.msg.get_all("Set-Cookie") or []
    c.close()
    return next((x.split(";", 1)[0] for x in cookies if x.startswith("iw_sheet_session=")), "")


def post(port: int, cookie: str, body: dict) -> tuple[int, dict | None]:
    c = _conn(port)
    c.request("POST", "/presence", body=json.dumps(body),
              headers={"Cookie": cookie, "Content-Type": "text/plain"} if cookie
              else {"Content-Type": "text/plain"})
    r = c.getresponse()
    raw = r.read()
    c.close()
    try:
        return r.status, json.loads(raw)
    except ValueError:
        return r.status, None


def forge(cookie: str, **over) -> str:
    name, tok = cookie.split("=", 1)
    v, body, sig = tok.split(".")
    payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    payload.update(over)
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode())
    return f"{name}={v}.{raw.rstrip(b'=').decode()}.{sig}"


def test_presence_over_http(bucket: LeaseBucket) -> None:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), s.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    try:
        alice = session(port, launch_token("u_alice", "u-alice", "Alice"))
        bob = session(port, launch_token("u_bob", "u-bob", "Bob"))
        check("both launches open a session", bool(alice) and bool(bob), True)

        def beat(cookie, tab, doc="coins", **kw):
            st, j = post(port, cookie, {"doc": doc, "tab": tab, **kw})
            return st, (j or {}).get("holder")

        check("A claims the sheet: no banner", beat(alice, "a1"), (200, None))
        row = bucket.row("coins")
        check("the lease is keyed sheetMaker/<sheet> under the signed project",
              bool(row), True)
        check("...holding A's signed uid and name",
              row and (row["holderUserId"], row["holderName"], row["toolId"]),
              ("u-alice", "Alice", "sheetMaker"))

        st, h = beat(bob, "b1")
        check("B sees A editing the sheet", (st, h and h["name"], h and h["same_user"]),
              (200, "Alice", False))
        st, h = beat(bob, "b1", name="Mallory", uid="u-alice", sub="u_alice")
        check("a name or uid in the body changes nothing",
              (h and h["name"], h and h["same_user"], bucket.row("coins")["holderUserId"]),
              ("Alice", False, "u-alice"))
        st, h = beat(alice, "a2")
        check("A's other tab is told it is A", h and h["same_user"], True)
        check("the holder's own heartbeat keeps it", beat(alice, "a1"), (200, None))

        check("A releases", beat(alice, "a1", release=True), (200, None))
        check("...and B sees nobody: B now holds it", beat(bob, "b1"), (200, None))
        check("...under B's uid", bucket.row("coins")["holderUserId"], "u-bob")
        st, h = beat(alice, "a1")
        check("A, back, sees B", h and h["name"], "Bob")

        beat(bob, "b1", release=True)
        check("B switching sheets claims the new one", beat(bob, "b1", doc="gems"),
              (200, None))
        check("...and the sheet B left is free for A", beat(alice, "a1"), (200, None))
        check("a release from someone who does not hold it deletes nothing",
              (beat(bob, "b1", release=True), bucket.row("coins")["holderUserId"]),
              ((200, None), "u-alice"))

        writes = bucket.n
        check("an unsigned caller is refused", post(port, "", {"doc": "coins", "tab": "x"})[0],
              403)
        check("a forged session (edited name) is refused",
              post(port, forge(bob, name="Alice", uid="u-alice"),
                   {"doc": "coins", "tab": "b1"})[0], 403)
        check("...and neither wrote a lease", bucket.n, writes)
        check("no doc, no lease", beat(alice, "a1", doc=""), (200, None))
        check("...not even a write", bucket.n, writes)

        c = _conn(port)
        c.request("GET", "/?fast=1", headers={"Cookie": alice})
        page = c.getresponse().read().decode("utf-8")
        c.close()
        check("the page inlines the shared heartbeat",
              ("window.iwPresence" in page, "__IW_PRESENCE" in page,
               'var NOUN = "sheet"' in page), (True, False, True))
    finally:
        srv.shutdown()


def test_the_shared_module(bucket: LeaseBucket) -> None:
    anon = launch.Identity(via="open")
    check("no gate (local dev): the holder is anonymous",
          presence.beat("sheetMaker", "acme/slots_one", "dev", anon, "t1"), {"holder": None})
    row = bucket.row("dev")
    check("...recorded as such, with no name", row and (row["holderUserId"], "holderName" in row),
          ("anonymous", False))
    alice = launch.Identity(via="token", sub="u_alice", uid="u-alice", name="Alice")
    check("a prefix with no project is ignored",
          presence.beat("sheetMaker", "acme", "dev", alice, "t1"), {"holder": None})
    check("a doc key with a slash is ignored",
          presence.beat("sheetMaker", "acme/slots_one", "a/b", alice, "t1"), {"holder": None})
    presence.beat("sheetMaker", "acme/slots_one", "long", alice, "x" * 500)
    check("a tab id is capped", len(bucket.row("long")["holderSessionId"]), presence.TAB_MAX)
    check("the page script escapes '<' in a doc name",
          "</script>" in presence.script("sheet", "</script>"), False)


HARNESS = r"""
const results = {calls: [], maxInFlight: 0};
let inFlight = 0;
global.window = global;
global.addEventListener = () => {};
global.navigator = {};
global.sessionStorage = {getItem() { return 'tabX'; }, setItem() {}};
let bar = null;
global.document = {readyState: 'complete', addEventListener() {},
  getElementById() { return bar; },
  createElement() { return {style: {}, remove() { bar = null; }}; },
  body: {firstChild: null, insertBefore(n) { bar = n; }}};
const holders = JSON.parse(process.env.HOLDERS);
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  results.calls.push(body);
  inFlight++;
  results.maxInFlight = Math.max(results.maxInFlight, inFlight);
  const slow = body.release ? 5 : body.doc === 'coins' ? 40 : 120;
  await new Promise(r => setTimeout(r, slow));
  inFlight--;
  return new Response(JSON.stringify({holder: body.release ? null : holders[body.doc] || null}),
                      {status: 200, headers: {'Content-Type': 'application/json'}});
};
__SCRIPT__
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms));
(async () => {
  iwPresence.track('coins');
  iwPresence.track('gems');
  // The answer about 'coins' (Alice) is in; the one about 'gems' is not yet.
  await settle(90);
  results.afterSwitch = bar ? bar.textContent : null;
  await settle();
  iwPresence.track('coins');
  await settle();
  results.onCoins = bar ? bar.textContent : null;
  iwPresence.track('');
  await settle();
  results.afterClose = bar ? bar.textContent : null;
  process.stdout.write(JSON.stringify(results) + '\n', () => process.exit(0));
})();
"""


def test_the_page_half() -> None:
    node = shutil.which("node")
    if not node:
        check("node is on PATH (presence.js cannot be exercised without it)", False, True)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write(HARNESS.replace("__SCRIPT__", presence.script("sheet")))
    try:
        out = subprocess.run(
            [node, f.name], capture_output=True, text=True, timeout=30, encoding="utf-8",
            env={**os.environ, "HOLDERS": json.dumps(
                {"coins": {"name": "Alice", "same_user": False, "since": 0}})})
    finally:
        os.unlink(f.name)
    if out.returncode != 0 or not out.stdout.strip():
        check("presence harness ran", out.stderr.strip()[-400:], "")
        return
    res = json.loads(out.stdout.strip().splitlines()[-1])
    check("a switch releases the old sheet and claims the new, in order",
          res["calls"][:3], [{"doc": "coins", "tab": "tabX"},
                             {"doc": "coins", "tab": "tabX", "release": True},
                             {"doc": "gems", "tab": "tabX"}])
    check("...one request at a time", res["maxInFlight"], 1)
    check("a late answer about the sheet it left paints nothing", res["afterSwitch"], None)
    check("back on the held sheet: the banner names the holder",
          (res["onCoins"] or "").startswith("\U0001f464 Alice is editing this sheet."), True)
    check("closing the sheet releases it and clears the banner",
          (res["calls"][-1], res["afterClose"]),
          ({"doc": "coins", "tab": "tabX", "release": True}, None))


def main() -> int:
    bucket = LeaseBucket()
    real = (storage.get_with_etag, storage.put, storage.delete)
    storage.get_with_etag, storage.put, storage.delete = (
        bucket.get_with_etag, bucket.put, bucket.delete)
    try:
        for fn in (test_presence_over_http, test_the_shared_module):
            print(f"\n-- {fn.__name__}")
            fn(bucket)
        print("\n-- test_the_page_half")
        test_the_page_half()
    finally:
        storage.get_with_etag, storage.put, storage.delete = real
    print(f"\n{'FAILED: ' + str(len(FAILED)) if FAILED else 'all passed'}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
