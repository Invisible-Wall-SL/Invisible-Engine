"""No card thumbnail is allowed to stay broken.

Run:  py test_image_delivery.py   (from services/atlas-tool, PYTHONPATH=../_shared)

A 60-region atlas paints ~120 `<img>` at once. Some of those requests get
dropped — by the proxy, by a worker thread, by a decode — and the browser keeps
each dropped one as a broken tile for the life of the page. The art is on disk
and the link is good; the request just never got an answer. Reported
2026-09-09 as "images do not get loaded ... they are there ... the page
discards them too fast".

Three things now stand between a dropped request and a broken tile, and each
one is invisible enough to be deleted by accident:

  * the cards ask lazily, so the burst is viewport-sized instead of ~120;
  * the page retries a failed image with backoff before it gives up, so a
    dropped request costs a delay rather than the picture;
  * a handler that raises still ANSWERS. Without that the exception reaches
    socketserver, which closes the socket having written nothing — which is
    the one failure the retry loader cannot tell from a slow network, and
    which no amount of reloading fixes.

These assert the mechanism is present, not that a browser honours it (the
browser half is exercised by hand against a flaky endpoint).
"""
from __future__ import annotations

import sys
from http.server import ThreadingHTTPServer

import ui_server

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


class FakeHandler(ui_server.Handler):
    """The real dispatch over a captured response — no socket, no gate."""

    def __init__(self, fn) -> None:
        self.path = "/"
        self.sent: list[dict] = []
        self._fn = fn

    def _send(self, code, ctype, body, extra_headers=None):
        self._responded = True
        self.sent.append({"code": code, "ctype": ctype, "body": body})

    def run(self):
        self._dispatch(self._fn)


def test_cards_ask_lazily() -> None:
    card = ui_server.CARD
    check("both card thumbs are lazy (output + reference)",
          card.count('loading="lazy"'), 2)
    check("...and every card <img> is one of them",
          card.count("<img "), 2)
    check("decoding is off the main thread too",
          card.count('decoding="async"'), 2)


def test_page_retries_a_dropped_image() -> None:
    page = ui_server.PAGE
    check("the page carries a retry loader", "imgretry" in page, True)
    # In <head>: the card <img> tags are parsed from the body, so a loader
    # installed after them can miss the first errors it exists to catch.
    head = page.split("</head>", 1)[0]
    check("...installed in <head>, before the first card <img>",
          "imgretry" in head, True)
    check("...in the capture phase, since load/error do not bubble",
          head.count("addEventListener('error',"), 1)
    # A failed response can be negatively cached, so re-pointing at the SAME
    # URL is a no-op — the URL has to change for the browser to re-request.
    check("...with a cache-busting param on each retry",
          "searchParams.set('retry'" in head, True)
    check("...and a visible give-up state", ".imgfail" in page, True)


def test_a_raising_handler_still_answers() -> None:
    def boom():
        raise RuntimeError("thumbnail decode blew up")

    h = FakeHandler(boom)
    h.run()
    check("a handler that raises answers instead of dropping the socket",
          [s["code"] for s in h.sent], [500])
    check("...saying what happened",
          b"thumbnail decode blew up" in h.sent[0]["body"], True)


def test_a_half_sent_response_is_not_doubled() -> None:
    def half(h=None):
        handler.sent.append({"code": 200, "ctype": "image/jpeg", "body": b"x"})
        handler._responded = True
        raise OSError("client hung up mid-body")

    handler = FakeHandler(half)
    handler.run()
    check("a reply already on the wire is never followed by a second one",
          [s["code"] for s in handler.sent], [200])


def test_the_listen_backlog_holds_a_burst() -> None:
    # The stdlib default is 5: a burst of image requests past the fifth pending
    # connection is refused by the OS, which is exactly the broken tile.
    check("the backlog is bigger than the stdlib default",
          ui_server._Server.request_queue_size > ThreadingHTTPServer.request_queue_size,
          True)
    check("...and the server actually used is that one",
          issubclass(ui_server._Server, ThreadingHTTPServer), True)


def main() -> int:
    test_cards_ask_lazily()
    test_page_retries_a_dropped_image()
    test_a_raising_handler_still_answers()
    test_a_half_sent_response_is_not_doubled()
    test_the_listen_backlog_holds_a_burst()
    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all image-delivery fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
