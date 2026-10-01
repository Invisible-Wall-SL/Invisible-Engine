"""The person-level "X is editing this <doc>" soft lease, for both Python tools.

Every open tab heartbeats `POST /presence` every 10 s (`presence.js`, served
inline by each tool through `script()`), and `beat()` answers who ELSE holds the
doc the tab shows (multi-user-concurrency.md Phase 3b). Advisory only: it blocks
nothing — the compare-and-swap on every save is what keeps work from being lost;
this makes the collision visible before it happens.

The lease is `lease.py`'s, one object per doc at
`<client>/<project>/_leases/<tool_id>/<doc_key>.json`: `atlasMaker/<manifest stem>`
in the Atlas Maker, `sheetMaker/<sheet>` in the Sheet Maker. The holder is
`(user, tab)` taken from the SIGNED launch identity (`launch.Identity`) — never
from the request body — so the same person in two tabs sees their own other tab
named, not a stranger. Fails open like every lease: an unreachable store reports
nobody.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import lease

TAB_MAX = 64

_JS = (Path(__file__).resolve().parent / "presence.js").read_text(encoding="utf-8")


def _js_json(value) -> str:
    """JSON for an inline `<script>`: `<` escaped so a doc name cannot close it."""
    return json.dumps(value).replace("<", "\\u003c")


def script(noun: str, doc: str = "") -> str:
    """The page half, ready to inline in a `<script>`: defines `iwPresence.track(doc)`
    and, given `doc`, starts tracking it. `noun` is what the banner calls the doc."""
    js = _JS.replace("__IW_PRESENCE_NOUN__", _js_json(noun))
    return js + (f"\niwPresence.track({_js_json(doc)});\n" if doc else "")


def beat(tool_id: str, r2_prefix: str, doc_key: str, identity, tab,
         *, release: bool = False) -> dict:
    """One heartbeat (or, with `release`, the hand-back) of `identity`'s `tab` on
    `doc_key`. Answers `{"holder": None}` when this tab holds it (or nobody can be
    read), else `{"holder": {name, same_user, since}}` naming who does."""
    tab = str(tab or "")[:TAB_MAX]
    if not doc_key or "/" in doc_key or not tab or "/" not in r2_prefix:
        return {"holder": None}
    client, project = r2_prefix.split("/", 1)
    key = lease.LeaseKey(tool_id, client, project, doc_key)
    holder = lease.LeaseHolder(str(identity.uid or identity.sub or "anonymous"), tab,
                               str(identity.name or identity.sub or ""))
    if release:
        lease.release(key, holder)
        return {"holder": None}
    if lease.acquire(key, holder):
        return {"holder": None}
    try:
        row = lease.held_by(key)
    except Exception:  # noqa: BLE001 — unreadable holds nobody
        return {"holder": None}
    if not row:
        return {"holder": None}
    return {"holder": {
        "name": row.get("holderName") or "Someone",
        "same_user": str(row.get("holderUserId") or "") == holder.user_id,
        "since": int(row.get("acquiredAt") or 0),
    }}
