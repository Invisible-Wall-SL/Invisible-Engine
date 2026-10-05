"""Who saved a document, and whether a save may land — the Python half of
`docs/design/multi-user-concurrency.md` Phase 3 for AUTHORED docs (an Atlas Maker
manifest / `atlas_config.json`, a Sheet Maker sheet manifest).

`storage.put(if_match=…)` is the floor: a write lands only on the version it was
derived from. This module is the layer above it that a PAGE needs:

  * a `saved_by` stamp inside the doc — `{uid, sub, name, tool, at, rev}` — so a
    refused save can say WHO got there first, and
  * `check()`, which compares the version the page loaded (a `Base`) with the
    version the server just read from R2, and raises `DocConflict` when somebody
    else has saved in between.

`rev` is the part the ETag cannot do on its own. It changes on every USER save and
on nothing else: a render's post-hook, an FX rebuild, an auto-pack or a fit-mode
repair rewrites the doc (so its ETag moves) but carries the stamp through
unchanged. A page whose ETag is stale but whose `rev` still matches has only been
overtaken by those machine writes — and because every Atlas Maker edit is applied
server-side onto the freshly read doc, its save IS the merge. `allow_rev_merge`
turns that on per caller; a tool whose save REPLACES the doc wholesale (the Sheet
Maker's export rebuilds the manifest from the canvas) must leave it off, or it
would erase exactly the machine writes the rule exists to keep.
"""
from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass

SAVED_BY = "saved_by"

# Why a save was refused. The page words its prompt from this, and only some of
# them can be overwritten: "unseen" means the page is showing a DIFFERENT doc than
# the one the server would write (the active atlas was switched elsewhere), so
# "overwrite with mine" would put this page's edit into the wrong atlas.
STALE = "stale"        # someone saved since the page loaded it
EXISTS = "exists"      # a create found the name taken
DELETED = "deleted"    # the page loaded it, it is gone now
UNSEEN = "unseen"      # the page never loaded the doc this save would write
OVERWRITABLE = (STALE, EXISTS, DELETED)


def norm_etag(etag: str | None) -> str:
    """ETags compared without their quotes — R2 returns `"abc"`, a page may hold
    either spelling. Never used to BUILD a precondition: `put(if_match=)` always
    gets the verbatim value the server itself read."""
    return str(etag or "").strip().strip('"')


def stamp(doc: dict, identity, tool: str, now: float | None = None) -> dict:
    """Mark `doc` as saved by `identity` (a `launch.Identity`, or None) and give it
    a fresh `rev`. Returns the stamp. Only a USER save calls this."""
    ident = identity
    sub = str(getattr(ident, "sub", "") or "")
    by = {
        "uid": str(getattr(ident, "uid", "") or ""),
        "sub": sub,
        "name": str(getattr(ident, "name", "") or "") or sub,
        "tool": tool,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "rev": secrets.token_hex(6),
    }
    act_tool = str(getattr(ident, "act_tool", "") or "")
    if act_tool:
        # An agent's save names the agent and its run, not the tool it drove.
        by.update(tool=act_tool, agent=str(getattr(ident, "act_agent", "") or ""),
                  runId=str(getattr(ident, "act_run", "") or ""))
    doc[SAVED_BY] = by
    return by


def saved_by_of(doc) -> dict | None:
    by = doc.get(SAVED_BY) if isinstance(doc, dict) else None
    return by if isinstance(by, dict) else None


def rev_of(doc) -> str:
    return str((saved_by_of(doc) or {}).get("rev") or "")


def strip_stamp(doc: dict) -> dict:
    """A COPY of a doc (duplicate, handoff) is a new doc nobody has saved yet —
    carrying the source's stamp would name its author as the copy's."""
    doc.pop(SAVED_BY, None)
    return doc


@dataclass(frozen=True)
class Base:
    """The version of one doc a page loaded. `etag == ""` means the page saw the
    doc ABSENT (a create); `rev` is the `saved_by.rev` it saw ("" when unstamped)."""
    etag: str
    rev: str = ""


def parse_bases(raw: str | None) -> dict[str, Base]:
    """The `X-IW-Doc-Bases` header: `{"<doc id>": {"etag": …, "rev": …}}`. Anything
    malformed reads as "the page sent no bases", never as a crash."""
    try:
        data = json.loads(raw or "")
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, Base] = {}
    for key, v in data.items():
        if isinstance(key, str) and isinstance(v, dict):
            out[key] = Base(norm_etag(v.get("etag")), str(v.get("rev") or ""))
    return out


def version(etag: str | None, doc) -> dict:
    """What a page keeps for one doc, and what `check()` later compares against."""
    return {"etag": norm_etag(etag), "rev": rev_of(doc)}


def encode_versions(versions: dict[str, dict]) -> str:
    return json.dumps(versions, ensure_ascii=True, separators=(",", ":"))


class DocConflict(Exception):
    """A save refused because the doc is not the version the page loaded. Carries
    what the page needs to ask the author: who saved, and the version to overwrite
    ON if they choose to — never a blind write."""

    def __init__(self, doc_id: str, reason: str, *, etag: str | None = None,
                 doc=None):
        super().__init__(f"{doc_id}: {reason}")
        self.doc_id = doc_id
        self.reason = reason
        self.etag = norm_etag(etag)
        self.saved_by = saved_by_of(doc)
        self.rev = rev_of(doc)

    def payload(self) -> dict:
        return {
            "conflict": True,
            "doc": self.doc_id,
            "reason": self.reason,
            "saved_by": self.saved_by,
            "etag": self.etag,
            "rev": self.rev,
            "overwritable": self.reason in OVERWRITABLE,
        }


def check(doc_id: str, base: Base | None, cur_etag: str | None, cur_doc, *,
          allow_rev_merge: bool, missing_base: str = UNSEEN) -> None:
    """Raise `DocConflict` unless a save based on `base` may replace the version
    the server just read (`cur_etag`, None = absent; `cur_doc` its parsed body).

    `missing_base` is what a save with NO base means for this caller: the Atlas
    Maker says UNSEEN (its page always sends the doc it shows), a create in the
    Sheet Maker says EXISTS (Save As under a name somebody already holds)."""
    cur = norm_etag(cur_etag) if cur_etag is not None else None
    if cur is None:
        if base is not None and base.etag:
            raise DocConflict(doc_id, DELETED)
        return
    if base is None:
        raise DocConflict(doc_id, missing_base, etag=cur, doc=cur_doc)
    if not base.etag:
        raise DocConflict(doc_id, EXISTS, etag=cur, doc=cur_doc)
    if base.etag == cur:
        return
    # An EMPTY rev proves nothing: a doc no author has saved since this shipped
    # (or one rewritten wholesale by a writer that does not stamp) reads "" on
    # every version, so a foreign write would pass as a machine write.
    if allow_rev_merge and base.rev and base.rev == rev_of(cur_doc):
        return
    raise DocConflict(doc_id, STALE, etag=cur, doc=cur_doc)


def parse_doc(body: bytes | None):
    """A stored doc's JSON, or None when it is absent or not a JSON object — used
    only to read the stamp, so a corrupt body just has no author."""
    if not body:
        return None
    try:
        doc = json.loads(body)
    except ValueError:
        return None
    return doc if isinstance(doc, dict) else None
