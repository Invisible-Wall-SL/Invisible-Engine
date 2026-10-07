"""Blueprint cards (ADR-0008 §2, card 8A): schema, compare-and-swap saves,
review rules, seeding and the agents' listing. No R2, no ComfyUI — `storage` is
a dict-backed bucket with real ETag preconditions.

Run:  PYTHONPATH=".;../_shared" py test_blueprint_cards.py   (from services/atlas-tool)

WHAT IS PINNED:

  * The card schema is CLOSED: an unknown key, a bad enum or an inverted range
    is refused with an error naming the path. A built-in card names only
    per-atlas / per-region Settings keys, in the right scope; a library card
    names only its blueprint's params, inside their ranges, and cannot claim a
    prompt or a source image the graph has no binding for.
  * A save is a compare-and-swap: of two editors on one version exactly one
    lands, a create racing a create is EXISTS, the previous version goes to
    `card.history/<rev>.json` create-only, and a refused save writes nothing.
    A history slot already holding a different version (a reused rev) never
    wedges the card: the replaced version is filed above the newest entry.
    A re-publish reset that loses to a person's save never clobbers it.
  * Only `pipelineMerge` (signed, not an agent) marks a card reviewed; an agent
    cannot write one at all; any plain save, and any re-publish of the
    blueprint, drops a reviewed card to draft; a changed graph makes it stale;
    a credit-billed card cannot be reviewed.
  * Bundled cards ship create-only and update only while nobody edited them;
    catalogue seeds write only onto the graph they were written against, once.
  * `GET /blueprints` lists only effectively reviewed cards by default, and
    ALWAYS for an agent; `all=1` lists every pipeline id for a person.
  * Deleting a blueprint deletes its card and history.

ASCII only in the labels (cp1252 consoles).
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ["ATLAS_STAGING"] = tempfile.mkdtemp(prefix="bp-cards-")
for _k in ("ATLAS_TOOL_SECRET", "ATLAS_TOOL_SIGNING_SECRET", "RUNPOD_ENDPOINT_GPU"):
    os.environ.pop(_k, None)

import storage  # noqa: E402
import blueprints  # noqa: E402
import cards  # noqa: E402
import doc_sync  # noqa: E402
import ui_server as u  # noqa: E402
from iw_common import docsave, launch  # noqa: E402

FAILED: list[str] = []
PASSED: list[str] = []


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}"
         + ("" if ok else f"\n     got  {got!r}\n     want {want!r}"))
    (PASSED if ok else FAILED).append(label)


class FakeR2:
    """iw_common.storage with R2's precondition semantics; `put` is atomic."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.n = 0
        self.lock = threading.Lock()
        self.puts: list[str] = []
        self.before_put = None

    def get_with_etag(self, key):
        with self.lock:
            return self.objects.get(key)

    def get_strict(self, key):
        got = self.get_with_etag(key)
        return got[0] if got else None

    def get(self, key):
        return self.get_strict(key)

    def put(self, key, body, content_type=None, *, if_match=None, if_none_match=None):
        hook, self.before_put = self.before_put, None
        if hook:
            hook(key)
        with self.lock:
            have = self.objects.get(key)
            if if_none_match == "*" and have is not None:
                raise storage.Conflict(key)
            if if_match and (have is None or have[1] != if_match):
                raise storage.Conflict(key)
            self.n += 1
            etag = f'"e{self.n}"'
            self.objects[key] = (bytes(body), etag)
            self.puts.append(key)
            return etag

    def delete(self, key):
        with self.lock:
            self.objects.pop(key, None)

    def list_keys(self, prefix, complete=True):
        with self.lock:
            return [{"key": k, "size": len(v[0]), "mtime": 0}
                    for k, v in sorted(self.objects.items()) if k.startswith(prefix)]


R2 = FakeR2()
for _name in ("get_with_etag", "get_strict", "get", "put", "delete", "list_keys"):
    setattr(storage, _name, getattr(R2, _name))
storage.pull_prefix = lambda *a, **k: 0  # staging is written directly below

BK = u.CARD_BUILTIN_KEYS
PFX = blueprints.SHARED_BLUEPRINTS_PREFIX

# A browser session minted just now, as the launcher's redirect leaves it.
OWNER = launch.Identity(via="token", sub="owner", uid="u1", name="Owner",
                        caps=(launch.PUBLISH_CAP, launch.REVIEW_CAP),
                        token_typ="session", issued_at=time.time())
ARTIST = launch.Identity(via="token", sub="artist", uid="u2", name="Artist",
                         caps=(launch.PUBLISH_CAP,), token_typ="session",
                         issued_at=time.time())
LEGACY = launch.Identity(via="legacy", sub="legacy")
AGENT = launch.Identity(via="token", sub="owner", uid="u1", name="Owner",
                        caps=(launch.PUBLISH_CAP, launch.REVIEW_CAP),
                        act_tool="director", act_agent="atlas-technician", act_run="run1",
                        token_typ="api", issued_at=time.time())
# A server-to-server call carrying the owner's caps but acting for no agent.
API_OWNER = launch.Identity(via="token", sub="owner", uid="u1", name="Owner",
                            caps=(launch.PUBLISH_CAP, launch.REVIEW_CAP),
                            token_typ="api", issued_at=time.time())
OLD_OWNER = launch.Identity(via="token", sub="owner", uid="u1", name="Owner",
                            caps=(launch.PUBLISH_CAP, launch.REVIEW_CAP),
                            token_typ="session", issued_at=time.time() - 3600)

MATTE_GRAPH = {
    "1": {"class_type": "LoadImage", "inputs": {"image": "in.png"}},
    "2": {"class_type": "BiRefNetRMBG", "inputs": {"image": ["1", 0], "blur": 10,
                                                   "model": "BiRefNet_toonout"}},
    "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0], "filename_prefix": "IW"}},
}
MATTE_PARAMS = [
    {"key": "blur", "type": "int", "node": "2", "field": "blur", "default": 10,
     "min": 0, "max": 64},
    {"key": "model", "type": "select", "node": "2", "field": "model",
     "default": "BiRefNet_toonout", "options": ["BiRefNet_toonout", "BiRefNet-general"]},
]
GEN_GRAPH = {
    "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "a coin"}},
    "2": {"class_type": "KSampler", "inputs": {"positive": ["1", 0], "steps": 20}},
    "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0], "filename_prefix": "IW"}},
}


def publish(bp_id: str, graph: dict, bindings: dict, params: list | None = None,
            kind: str = "image") -> dict:
    """A library blueprint in staging AND the bucket, as an upload leaves it."""
    man = {"version": 1, "id": bp_id, "name": bp_id, "author": "tester", "kind": kind,
           "bindings": bindings, "params": params or []}
    d = blueprints.BLUEPRINTS_STAGING / bp_id
    d.mkdir(parents=True, exist_ok=True)
    for name, doc in (("blueprint.json", man), ("workflow.json", graph)):
        blob = json.dumps(doc, indent=2).encode("utf-8")
        (d / name).write_bytes(blob)
        R2.objects[f"{PFX}/{bp_id}/{name}"] = (blob, '"bp"')
    bp = blueprints.get_blueprint(bp_id)
    assert bp is not None, bp_id
    return bp


def matte() -> dict:
    return publish("matte", MATTE_GRAPH,
                   {"style_ref": {"node": "1", "field": "image"}, "output": {"node": "3"}},
                   MATTE_PARAMS)


def matte_card(**over) -> dict:
    c = {
        "purpose": "Cut a still to alpha.",
        "whenToUse": ["after a generate step"], "whenNotToUse": [],
        "inputs": {"prompt": "none", "negative": "none", "reference": "none", "shape": "none",
                   "sourceImage": "required", "mask": "none", "layer": "none"},
        "outputs": {"kind": "image", "alpha": True, "count": 1, "sizeRule": "source size"},
        "settings": [{"key": "blur", "default": 2, "min": 0, "max": 16}],
        "chain": {"position": "process", "follows": ["sdxl"], "precedes": []},
        "gpu": {"secondsPerImage": {"1024": 3}, "coldStart": 60},
        "variants": {"draft": 1, "final": 1, "max": 1},
        "billing": "gpu", "licence": "conditional", "gotchas": [],
    }
    c.update(over)
    return c


def stored(bp_id: str) -> dict | None:
    got = R2.objects.get(cards.card_key(bp_id))
    return json.loads(got[0]) if got else None


def etag_of(bp_id: str) -> str:
    return R2.objects[cards.card_key(bp_id)][1]


def history_keys(bp_id: str) -> list[str]:
    return sorted(k for k in R2.objects if k.startswith(cards.history_prefix(bp_id)))


def save(bp_id, card, base, ident=ARTIST, review=False, can_publish=True):
    return cards.save_card(bp_id, card, base=base, identity=ident, can_publish=can_publish,
                           review=review, builtin_keys=BK)


def conflict_of(fn) -> docsave.DocConflict | None:
    try:
        fn()
    except docsave.DocConflict as e:
        return e
    return None


def refused(fn) -> bool:
    try:
        fn()
    except cards.CardRefused:
        return True
    return False


def full_card(bp_id: str, body: dict, *, status="draft", rev=1, **over) -> dict:
    bp = cards.lookup_blueprint(bp_id)
    c = {"version": 1, "id": bp_id, "status": status, "rev": rev,
         "graphSha": (bp or {}).get("graph_sha", ""), "mapSha": (bp or {}).get("map_sha", ""),
         "reviewedBy": "Owner" if status == "reviewed" else "", "reviewedAt": "",
         **body}
    c["gpu"] = dict(c["gpu"], source="guess")
    c.update(over)
    return c


def raw_card(bp_id: str, card: dict) -> None:
    R2.put(cards.card_key(bp_id), cards._dump(card))


def reset() -> None:
    R2.objects.clear()
    R2.puts.clear()
    R2.before_put = None
    shutil.rmtree(blueprints.BLUEPRINTS_STAGING, ignore_errors=True)
    blueprints.BLUEPRINTS_STAGING.mkdir(parents=True, exist_ok=True)
    blueprints._HYDRATED = True  # the tests write staging themselves


# --------------------------------------------------------------------------
# Schema
# --------------------------------------------------------------------------
def errs(card, bp_id="matte", blueprint=None) -> list[str]:
    bp = blueprint if blueprint is not None else cards.lookup_blueprint(bp_id)
    return cards.validate_card(card, bp_id=bp_id, blueprint=bp, builtin_keys=BK)[1]


def has(errors: list[str], needle: str) -> bool:
    return any(needle in e for e in errors)


def test_schema() -> None:
    reset()
    matte()
    good = full_card("matte", matte_card())
    check("a valid card passes", errs(good), [])
    check("unknown top-level key refused, named",
          has(errs({**good, "colour": "red"}), "colour: unknown key"), True)
    check("unknown nested key refused, named",
          has(errs({**good, "outputs": {**good["outputs"], "dpi": 72}}), "outputs.dpi: unknown key"),
          True)
    check("bad enum refused", has(errs({**good, "billing": "cash"}), "billing: must be one of"), True)
    check("bad licence refused", has(errs({**good, "licence": "maybe"}), "licence"), True)
    check("inputs value enum",
          has(errs({**good, "inputs": {**good["inputs"], "mask": "sometimes"}}), "inputs.mask"), True)
    missing = dict(good["inputs"])
    missing.pop("layer")
    check("all seven inputs required", has(errs({**good, "inputs": missing}), "inputs.layer: required"),
          True)
    check("variants above max refused",
          has(errs({**good, "variants": {"draft": 3, "final": 1, "max": 2}}), "variants.draft"), True)
    check("setting min above max refused",
          has(errs({**good, "settings": [{"key": "blur", "min": 9, "max": 2}]}), "is above max"), True)
    check("duplicate setting key refused",
          has(errs({**good, "settings": [{"key": "blur"}, {"key": "blur"}]}), "appears twice"), True)
    check("count 0 refused",
          has(errs({**good, "outputs": {**good["outputs"], "count": 0}}), "outputs.count"), True)
    check("purpose required",
          has(errs({**good, "purpose": "  "}), "purpose: required"), True)
    check("purpose length capped", has(errs({**good, "purpose": "x" * 301}), "at most 300"), True)
    check("21 whenToUse entries refused",
          has(errs({**good, "whenToUse": ["a"] * 21}), "at most 20 entries"), True)
    check("gpu px keys are pixel sizes",
          has(errs({**good, "gpu": {**good["gpu"], "secondsPerImage": {"big": 3}}}), "pixel size"),
          True)
    check("gpu.source enum",
          has(errs({**good, "gpu": {**good["gpu"], "source": "vibes"}}), "gpu.source"), True)
    check("a boolean is not a number",
          has(errs({**good, "outputs": {**good["outputs"], "count": True}}), "outputs.count"), True)
    check("builtin:true only on a built-in id",
          has(errs({**good, "builtin": True}), "builtin: only"), True)

    sdxl = json.loads((blueprints.BUNDLED_SRC / "sdxl" / "card.json").read_text(encoding="utf-8"))
    base = {**sdxl, "settings": []}
    check("built-in: PER_ATLAS_KEYS key ok",
          errs({**base, "settings": [{"key": "ksampler_steps", "default": 30}]}, "sdxl"), [])
    check("built-in: ADV_FIELDS key with scope region ok",
          errs({**base, "settings": [{"key": "fit_mode", "scope": "region"}]}, "sdxl"), [])
    check("built-in: a key in both sets takes either scope",
          errs({**base, "settings": [{"key": "ipadapter_weight"},
                                     {"key": "controlnet_strength", "scope": "region"}]}, "sdxl"), [])
    check("built-in: global-only key refused",
          has(errs({**base, "settings": [{"key": "flux_steps"}]}, "flux"), "global-only"), True)
    check("built-in: region-only key at atlas scope refused",
          has(errs({**base, "settings": [{"key": "fit_mode"}]}, "sdxl"), "set scope 'region'"), True)
    check("built-in: atlas-only key at region scope refused",
          has(errs({**base, "settings": [{"key": "lora_strength", "scope": "region"}]}, "sdxl"),
              "per-atlas setting only"), True)
    check("built-in: the refs and the pipeline are not settings",
          has(errs({**base, "settings": [{"key": "style_ref", "scope": "region"}]}, "sdxl"),
              "global-only"), True)
    check("built-in: kind is image",
          has(errs({**base, "outputs": {**base["outputs"], "kind": "video"}}, "sdxl"), "outputs.kind"),
          True)


def test_blueprint_rules() -> None:
    reset()
    matte()
    publish("gen", GEN_GRAPH, {"positive": {"node": "1", "field": "text"}, "output": {"node": "3"}},
            [{"key": "steps", "type": "int", "node": "2", "field": "steps", "default": 20}])
    good = full_card("matte", matte_card())
    check("param key unknown refused",
          has(errs({**good, "settings": [{"key": "steps"}]}), "not one of this blueprint's"), True)
    check("range outside the param's min/max refused",
          has(errs({**good, "settings": [{"key": "blur", "max": 80}]}), "outside the blueprint's own"),
          True)
    check("default outside the param's range refused",
          has(errs({**good, "settings": [{"key": "blur", "default": -1}]}), "default"), True)
    check("options must be a subset of the select's",
          has(errs({**good, "settings": [{"key": "model", "options": ["Lucida"]}]}), "not options"),
          True)
    check("options subset passes",
          errs({**good, "settings": [{"key": "model", "options": ["BiRefNet-general"]}]}), [])
    check("prompt without a positive binding refused",
          has(errs({**good, "inputs": {**good["inputs"], "prompt": "optional"}}), "inputs.prompt"),
          True)
    gen = full_card("gen", matte_card(settings=[], inputs={**good["inputs"], "prompt": "required"}))
    check("sourceImage required without a ref binding refused",
          has(errs(gen, "gen"), "inputs.sourceImage"), True)
    check("kind mismatch refused",
          has(errs({**good, "outputs": {**good["outputs"], "kind": "video"}}), "outputs.kind"), True)
    check("an id not in the library", has(errs({**good, "id": "ghost"}, "ghost"), "no such blueprint"),
          True)


# --------------------------------------------------------------------------
# Compare-and-swap
# --------------------------------------------------------------------------
def test_cas() -> None:
    reset()
    matte()
    first = save("matte", matte_card(), docsave.Base(""))
    check("a create lands", (first["ok"], first["card"]["rev"], first["card"]["status"]),
          (True, 1, "draft"))
    check("...create-only", R2.puts[-1], cards.card_key("matte"))
    loaded = docsave.Base(docsave.norm_etag(etag_of("matte")), first["version"]["rev"])

    alice = save("matte", matte_card(purpose="Alice's"), loaded)
    check("first of two editors on one version lands", alice["ok"], True)
    check("rev increments", alice["card"]["rev"], 2)
    hist = R2.objects.get(cards.history_key("matte", 1))
    check("history/1.json holds the previous version",
          json.loads(hist[0])["purpose"] if hist else None, "Cut a still to alpha.")

    before = dict(R2.objects)
    e = conflict_of(lambda: save("matte", matte_card(purpose="Bob's"), loaded))
    check("the second is refused STALE naming the saver",
          (e and e.reason, e and (e.saved_by or {}).get("name")), ("stale", "Artist"))
    check("...and a stale save writes nothing (no history, no card)", R2.objects, before)
    check("no base on an existing card is STALE, never a blind write",
          (conflict_of(lambda: save("matte", matte_card(), None)) or e).reason, "stale")
    check("a create over an existing card is EXISTS",
          conflict_of(lambda: save("matte", matte_card(), docsave.Base(""))).reason, "exists")

    # Two creates that both saw the card absent: the second put loses.
    reset()
    matte()
    R2.before_put = lambda key: R2.objects.__setitem__(
        cards.card_key("matte"), (b'{"saved_by":{"name":"Alice"}}', '"other"'))
    e = conflict_of(lambda: save("matte", matte_card(), docsave.Base("")))
    check("a create racing a create is EXISTS", (e and e.reason, e and e.saved_by["name"]),
          ("exists", "Alice"))

    # A save whose card write lost after its history landed must not wedge the card.
    reset()
    matte()
    save("matte", matte_card(), docsave.Base(""))
    cur = R2.objects[cards.card_key("matte")]
    R2.put(cards.history_key("matte", 1), cur[0])
    again = save("matte", matte_card(purpose="later"),
                 docsave.Base(docsave.norm_etag(cur[1])))
    check("an identical leftover history entry does not block the next save", again["ok"], True)
    invalid = save("matte", matte_card(billing="cash"),
                   docsave.Base(docsave.norm_etag(etag_of("matte"))))
    check("a validation failure is ok:false with the errors", (invalid["ok"], bool(invalid["errors"])),
          (False, True))
    check("the client cannot set the server-owned fields",
          save("matte", matte_card(status="reviewed", rev=99, gpu={"secondsPerImage": {"1024": 3},
                                                                  "coldStart": 0, "source": "measured"}),
               docsave.Base(docsave.norm_etag(etag_of("matte"))))["card"]
          and (stored("matte")["status"], stored("matte")["rev"], stored("matte")["gpu"]["source"]),
          ("draft", 3, "guess"))
    R2.objects[cards.history_key("matte", 3)] = (b'{"other":"version"}', '"x"')
    base = docsave.Base(docsave.norm_etag(etag_of("matte")))
    kept = R2.objects[cards.card_key("matte")][0]
    res = save("matte", matte_card(purpose="later still"), base)
    check("a DIFFERENT version under that history rev is a reused rev, not a wedge",
          (res["ok"], res["card"]["rev"], stored("matte")["purpose"]), (True, 5, "later still"))
    check("...the replaced version is filed above it, renumbered, the stranger untouched",
          (cards.get_history_version("matte", 4),
           R2.objects[cards.history_key("matte", 3)][0]),
          ({**json.loads(kept), "rev": 4}, b'{"other":"version"}'))

    # A card replaced by the bundled sync after a save filed history but lost the
    # card write: the overwrite must land, keeping both earlier versions.
    reset()
    cards.sync_bundled_cards(log=lambda _m: None)
    first = R2.objects[cards.card_key("sdxl")]
    src = Path(tempfile.mkdtemp(prefix="bp-src-"))
    shutil.copytree(blueprints.BUNDLED_SRC / "sdxl", src / "sdxl")
    f = src / "sdxl" / "card.json"
    f.write_text(json.dumps({**json.loads(f.read_text(encoding="utf-8")),
                             "purpose": "new in the repo"}), encoding="utf-8")
    on_card_put("sdxl", lambda: cards.sync_bundled_cards(src, log=lambda _m: None))
    mine = dict(stored("sdxl"), purpose="mine")
    e = conflict_of(lambda: save("sdxl", mine, docsave.Base(docsave.norm_etag(first[1]))))
    check("a save racing the bundled sync loses STALE",
          (e and e.reason, stored("sdxl")["purpose"]), ("stale", "new in the repo"))
    res = save("sdxl", mine, docsave.Base(e.etag))
    check("...and its overwrite lands instead of wedging on history/1",
          (res["ok"], stored("sdxl")["purpose"], stored("sdxl")["rev"]), (True, "mine", 3))
    check("...with both earlier versions in history",
          (R2.objects[cards.history_key("sdxl", 1)][0] == first[0],
           cards.get_history_version("sdxl", 2)["purpose"]), (True, "new in the repo"))

    # History left behind by a deleted blueprint (a delete that could not list).
    reset()
    matte()
    save("matte", matte_card(purpose="old life"), docsave.Base(""))
    save("matte", matte_card(purpose="old life 2"), base_of("matte"))
    R2.delete(cards.card_key("matte"))
    save("matte", matte_card(purpose="new life"), docsave.Base(""))
    res = save("matte", matte_card(purpose="new life 2"), base_of("matte"))
    check("leftover history from a deleted card does not wedge the new one",
          (res["ok"], res["card"]["rev"], cards.get_history_version("matte", 2)["purpose"],
           cards.get_history_version("matte", 1)["purpose"]),
          (True, 3, "new life", "old life"))


# --------------------------------------------------------------------------
# Review rules
# --------------------------------------------------------------------------
def base_of(bp_id: str) -> docsave.Base:
    got = R2.objects.get(cards.card_key(bp_id))
    return docsave.Base(docsave.norm_etag(got[1]) if got else "")


def test_review() -> None:
    reset()
    matte()
    check("review without pipelineMerge refused",
          refused(lambda: save("matte", matte_card(), base_of("matte"), ARTIST, review=True)), True)
    check("a legacy session cannot review",
          refused(lambda: save("matte", matte_card(), base_of("matte"), LEGACY, review=True)), True)
    check("an agent cannot review", refused(lambda: save("matte", matte_card(), base_of("matte"),
                                                         AGENT, review=True)), True)
    check("an agent cannot save a draft either",
          refused(lambda: save("matte", matte_card(), base_of("matte"), AGENT)), True)
    check("no publish capability, no save",
          refused(lambda: save("matte", matte_card(), base_of("matte"), OWNER, can_publish=False)),
          True)
    check("nothing was written by the refusals", stored("matte"), None)

    ok = save("matte", matte_card(), base_of("matte"), OWNER, review=True)
    check("pipelineMerge marks it reviewed, naming who",
          (ok["ok"], stored("matte")["status"], stored("matte")["reviewedBy"]),
          (True, "reviewed", "Owner"))
    check("reviewed pins the live graph", stored("matte")["graphSha"],
          blueprints.get_blueprint("matte")["graph_sha"])
    check("effective status reviewed",
          cards.effective_status(stored("matte"), blueprints.get_blueprint("matte")), "reviewed")

    save("matte", matte_card(purpose="tweak"), base_of("matte"), OWNER)
    check("a plain save of a reviewed card is a draft",
          (stored("matte")["status"], stored("matte")["reviewedBy"]), ("draft", ""))

    credits = save("matte", matte_card(billing="credits"), base_of("matte"), OWNER, review=True)
    check("a credit-billed card cannot be reviewed",
          (credits["ok"], has(credits.get("errors") or [], "credit-billed")), (False, True))
    empty = save("matte", matte_card(gpu={"secondsPerImage": {}, "coldStart": 0}), base_of("matte"),
                 OWNER, review=True)
    check("no GPU seconds, no review", has(empty.get("errors") or [], "secondsPerImage"), True)
    check("...but it may be saved as a draft",
          save("matte", matte_card(gpu={"secondsPerImage": {}, "coldStart": 0}), base_of("matte"),
               OWNER)["ok"], True)

    save("matte", matte_card(), base_of("matte"), OWNER, review=True)
    publish("matte", {**MATTE_GRAPH, "4": {"class_type": "Note", "inputs": {}}},
            {"style_ref": {"node": "1", "field": "image"}, "output": {"node": "3"}}, MATTE_PARAMS)
    check("a changed graph makes the reviewed card stale",
          cards.effective_status(stored("matte"), blueprints.get_blueprint("matte")), "stale")
    check("...and so does a deleted blueprint", cards.effective_status(stored("matte"), None), "stale")
    check("can_review: open dev gate yes, legacy no",
          (cards.can_review(launch.Identity(via="open")), cards.can_review(LEGACY)), (True, False))


class UploadHandler:
    """Enough of the request object for `_uploadblueprint`."""
    can_publish = True
    _identity = OWNER

    def _publish_author(self) -> str:
        return "tester"

    def _reset_card_on_republish(self, bp_id: str, what: str = "re-published") -> str:
        return u.Handler._reset_card_on_republish(self, bp_id, what)


def upload(name: str, graph: dict) -> str:
    return u.Handler._uploadblueprint(UploadHandler(), {
        "name": name, "description": "", "kind": "image", "base": "sdxl",
        "workflow_text": json.dumps(graph),
        "bindings": {"output": {"node": "3"}, "style_ref": {"node": "1", "field": "image"}},
        "params": [], "overwrite": True, "use_for_atlas": False})


def on_card_put(bp_id: str, fn) -> None:
    """Run `fn` just before the next write of `bp_id`'s card.json lands."""
    def hook(key):
        if key == cards.card_key(bp_id):
            fn()
        else:
            R2.before_put = hook
    R2.before_put = hook


def test_reset_races_a_save() -> None:
    reset()
    matte()
    save("matte", matte_card(), base_of("matte"), OWNER, review=True)
    loaded = base_of("matte")
    on_card_put("matte", lambda: save("matte", matte_card(purpose="edited"), loaded, ARTIST))
    check("a reset that loses to a person's draft save resets nothing",
          cards.reset_on_republish("matte", OWNER), False)
    card = stored("matte")
    check("...and the person's save stands untouched",
          (card["purpose"], card["status"], card["rev"], card.get("resetReason"),
           card["saved_by"]["name"]), ("edited", "draft", 2, None, "Artist"))
    check("...history complete", history_keys("matte"), [cards.history_key("matte", 1)])

    reset()
    matte()
    save("matte", matte_card(), base_of("matte"), OWNER, review=True)
    loaded = base_of("matte")
    on_card_put("matte", lambda: save("matte", matte_card(purpose="re-reviewed"), loaded,
                                      OWNER, review=True))
    check("a reset that loses to a person's review retries on THEIR card",
          cards.reset_on_republish("matte", OWNER), True)
    card = stored("matte")
    check("...keeping their content and stamp, rev after theirs",
          (card["purpose"], card["status"], card["rev"], card["saved_by"]["name"]),
          ("re-reviewed", "draft", 3, "Owner"))
    check("...their reviewed version is in history",
          cards.get_history_version("matte", 2)["status"], "reviewed")


def test_republish_resets_review() -> None:
    reset()
    msg = upload("Matte", MATTE_GRAPH)
    check("published", msg.startswith("✓"), True)
    save("matte", matte_card(settings=[]), base_of("matte"), OWNER, review=True)
    rev = stored("matte")["rev"]
    msg = upload("Matte", MATTE_GRAPH)
    card = stored("matte")
    check("re-publishing (identical bytes) resets reviewed -> draft",
          (card["status"], card["reviewedBy"], card["rev"]), ("draft", "", rev + 1))
    check("...with the reason recorded", card.get("resetReason", "").startswith(
        "blueprint re-published by Owner at "), True)
    check("...the previous version kept in history",
          json.loads(R2.objects[cards.history_key("matte", rev)][0])["status"], "reviewed")
    check("...and the reply says so", "returns to draft" in msg, True)
    msg = upload("Matte", MATTE_GRAPH)
    check("a draft card is left alone by a re-publish",
          (stored("matte")["rev"], "returns to draft" in msg), (rev + 1, False))


# --------------------------------------------------------------------------
# Seeding
# --------------------------------------------------------------------------
def test_bundled_sync() -> None:
    reset()
    blueprints._sync_bundled_blueprints()
    done = dict(cards.sync_bundled_cards(log=lambda _m: None))
    check("every bundled card is created",
          done, {i: "created" for i in ("flux", "gpt_image", "sdxl", "wan22_i2v_flipbook")})
    wan = blueprints.read_blueprint_r2("wan22_i2v_flipbook")
    check("a non-built-in bundled card pins the library's graph",
          (stored("wan22_i2v_flipbook")["graphSha"], stored("wan22_i2v_flipbook")["mapSha"]),
          (wan["graph_sha"], wan["map_sha"]))
    check("...and the built-in ones pin nothing", stored("sdxl").get("graphSha", ""), "")
    n = len(R2.puts)
    done = dict(cards.sync_bundled_cards(log=lambda _m: None))
    check("re-running writes nothing", (len(R2.puts) - n, set(done.values())), (0, {"unchanged"}))

    src = Path(tempfile.mkdtemp(prefix="bp-src-"))
    for i in ("sdxl", "flux"):
        shutil.copytree(blueprints.BUNDLED_SRC / i, src / i)
        f = src / i / "card.json"
        c = json.loads(f.read_text(encoding="utf-8"))
        c["purpose"] = "changed in the repo"
        f.write_text(json.dumps(c), encoding="utf-8")
    edited = stored("flux")
    docsave.stamp(edited, OWNER, "atlas")
    raw_card("flux", edited)
    done = dict(cards.sync_bundled_cards(src, log=lambda _m: None))
    check("an unedited card follows the repo", (done["sdxl"], stored("sdxl")["purpose"]),
          ("updated", "changed in the repo"))
    check("an edited card is never overwritten",
          (done["flux"], stored("flux")["purpose"] != "changed in the repo"),
          ("kept: edited in the tool", True))

    rogue = Path(tempfile.mkdtemp(prefix="bp-src-"))
    shutil.copytree(blueprints.BUNDLED_SRC / "gpt_image", rogue / "gpt_image")
    f = rogue / "gpt_image" / "card.json"
    c = json.loads(f.read_text(encoding="utf-8"))
    c["status"] = "reviewed"
    f.write_text(json.dumps(c), encoding="utf-8")
    before = stored("gpt_image")
    done = dict(cards.sync_bundled_cards(rogue, log=lambda _m: None))
    check("a repo file cannot ship a review",
          (done["gpt_image"], stored("gpt_image") == before),
          ("refused: shipped as reviewed", True))

    reset()
    blueprints._HYDRATED = False
    blueprints.hydrate()
    check("hydrate ships the bundled cards", stored("sdxl") is not None, True)


def test_catalogue_seed() -> None:
    reset()
    bp = matte()
    publish("other", MATTE_GRAPH, {"style_ref": {"node": "1", "field": "image"},
                                   "output": {"node": "3"}})
    seeds = Path(tempfile.mkdtemp(prefix="card-seeds-"))
    for bp_id, sha in (("matte", bp["graph_sha"]), ("other", "000000000000"),
                       ("absent", "000000000000")):
        c = full_card("matte", matte_card(settings=[]), id=bp_id, graphSha=sha, mapSha="")
        (seeds / f"{bp_id}.json").write_text(json.dumps(c), encoding="utf-8")
    dry = dict(cards.seed_catalogue_cards(seeds, dry_run=True, log=lambda _m: None))
    check("a dry run writes nothing", (dry["matte"], stored("matte")), ("created", None))
    done = dict(cards.seed_catalogue_cards(seeds, log=lambda _m: None))
    check("only the seed whose graphSha matches is written",
          (done["matte"], done["other"].startswith("skipped: graph"),
           done["absent"], stored("other")),
          ("created", True, "skipped: not in the library", None))
    check("...pinning the live mapSha", stored("matte")["mapSha"], bp["map_sha"])
    check("...create-only", R2.puts[-1], cards.card_key("matte"))
    n = len(R2.puts)
    done = dict(cards.seed_catalogue_cards(seeds, log=lambda _m: None))
    check("a second run is a no-op", (len(R2.puts) - n, done["matte"]), (0, "skipped: a card exists"))
    save("matte", matte_card(purpose="owner's"), base_of("matte"), OWNER)
    cards.seed_catalogue_cards(seeds, log=lambda _m: None)
    check("an edited card is never overwritten", stored("matte")["purpose"], "owner's")

    reset()
    matte()
    rogue = Path(tempfile.mkdtemp(prefix="card-seeds-"))
    c = full_card("matte", matte_card(settings=[]), id="matte", graphSha=bp["graph_sha"],
                  mapSha="", status="reviewed")
    (rogue / "matte.json").write_text(json.dumps(c), encoding="utf-8")
    done = dict(cards.seed_catalogue_cards(rogue, log=lambda _m: None))
    check("a seed cannot ship a review", (done["matte"], stored("matte")),
          ("refused: shipped as reviewed", None))

    for f in sorted(list(blueprints.BUNDLED_SRC.glob("*/card.json"))
                    + list(cards.CARD_SEEDS.glob("*.json"))):
        c = json.loads(f.read_text(encoding="utf-8"))
        check(f"{f.parent.name}/{f.name} is structurally valid", cards.validate_structure(c)[1], [])
        check(f"{f.parent.name}/{f.name} ships as a rev-1 draft", (c["status"], c["rev"]),
              ("draft", 1))
    for i in cards.BUILTIN_IDS:
        c = json.loads((blueprints.BUNDLED_SRC / i / "card.json").read_text(encoding="utf-8"))
        check(f"bundled {i} card passes the full built-in key validation", errs(c, i), [])
    wan_dir = blueprints.BUNDLED_SRC / "wan22_i2v_flipbook"
    wan = blueprints._load_blueprint(
        "wan22_i2v_flipbook", json.loads((wan_dir / "blueprint.json").read_text(encoding="utf-8")),
        json.loads((wan_dir / "workflow.json").read_text(encoding="utf-8")))
    check("bundled wan22 card passes against its bundled blueprint",
          errs(json.loads((wan_dir / "card.json").read_text(encoding="utf-8")),
               "wan22_i2v_flipbook", wan), [])
    check("the seeds cover the six library ids",
          sorted(p.stem for p in cards.CARD_SEEDS.glob("*.json")),
          sorted(["birefnet", "removebackgroundsam3__2_", "composite4layers_sam_",
                  "characterdesignertest3", "bluprinttest", "wanloopingvideo__3_"]))


# --------------------------------------------------------------------------
# GET /blueprints, the card routes, delete
# --------------------------------------------------------------------------
class RouteHandler(u.Handler):
    """The real `_get`/`_post` + `_dispatch` + `_send`, over captured bytes."""

    def __init__(self, method: str, path: str, ident, body=None, bases=None,
                 can_publish=True) -> None:
        raw = json.dumps(body).encode("utf-8") if body is not None else b""
        self.command = method
        self.path = path
        self.headers = {"Content-Length": str(len(raw))}
        if bases is not None:
            self.headers["X-IW-Doc-Bases"] = json.dumps(bases)
        self.rfile = io.BytesIO(raw)
        self.wfile = io.BytesIO()
        self._identity = ident
        self._can = can_publish
        self.sent_headers: dict = {}
        self.code = None

    def _authenticate(self):
        return True

    def _resolve_context(self):
        pass

    def _resolve_publish(self):
        self.can_publish = self._can

    def send_response(self, code, message=None):
        self.code = code

    def send_header(self, k, v):
        self.sent_headers[k] = v

    def end_headers(self):
        pass

    def json(self):
        return json.loads(self.wfile.getvalue() or b"null")


def get(path: str, ident) -> RouteHandler:
    h = RouteHandler("GET", path, ident)
    h.do_GET()
    return h


def post(path: str, ident, body, bases=None, can_publish=True) -> RouteHandler:
    h = RouteHandler("POST", path, ident, body, bases, can_publish)
    h.do_POST()
    return h


def ids(h: RouteHandler) -> list[str]:
    return [e["id"] for e in h.json()["blueprints"]]


def test_listing() -> None:
    reset()
    for bp_id in ("good", "rough", "old"):
        matte_bp = publish(bp_id, MATTE_GRAPH, {"style_ref": {"node": "1", "field": "image"},
                                                "output": {"node": "3"}}, MATTE_PARAMS)
    publish("clip", MATTE_GRAPH, {"style_ref": {"node": "1", "field": "image"},
                                  "output": {"node": "3"}}, MATTE_PARAMS, kind="video")
    publish("sdxl", GEN_GRAPH, {"positive": {"node": "1", "field": "text"}, "output": {"node": "3"}})
    body = matte_card()
    raw_card("good", full_card("good", body, status="reviewed"))
    raw_card("rough", full_card("rough", body))
    raw_card("old", full_card("old", body, status="reviewed", graphSha="feedfacecafe"))
    raw_card("clip", full_card("clip", {**body, "outputs": {**body["outputs"], "kind": "video"}},
                               status="reviewed"))
    os.environ["RUNPOD_ENDPOINT_GPU"] = "L40S (48 GB)"
    try:
        h = get("/blueprints", ARTIST)
        check("default lists only reviewed (not draft, not stale)", ids(h), ["clip", "good"])
        check("gpu echoes RUNPOD_ENDPOINT_GPU", h.json()["gpu"], "L40S (48 GB)")
    finally:
        os.environ.pop("RUNPOD_ENDPOINT_GPU", None)
    check("kind filter", ids(get("/blueprints?kind=image", ARTIST)), ["good"])
    every = get("/blueprints?all=1", ARTIST).json()["blueprints"]
    check("all=1 lists every id, built-ins first, minus the library's reference copies",
          [e["id"] for e in every],
          ["sdxl", "flux", "gpt_image", "clip", "good", "old", "rough"])
    by = {e["id"]: e for e in every}
    check("...each with its effective state",
          (by["good"]["status"], by["rough"]["status"], by["old"]["status"], by["old"]["stale"],
           by["sdxl"]["status"]), ("reviewed", "draft", "stale", True, "none"))
    check("...roles and params of the live blueprint",
          (by["good"]["roles"], [p["key"] for p in by["good"]["params"]]),
          (["output", "style_ref"], ["blur", "model"]))
    check("...a built-in carries its settings keys",
          ("fit_mode" in by["sdxl"]["settingsKeys"]["region"],
           "flux_steps" in by["sdxl"]["settingsKeys"]["atlas"]), (True, False))
    check("an agent asking all=1 still gets reviewed only",
          ids(get("/blueprints?all=1", AGENT)), ["clip", "good"])
    publish("broken", MATTE_GRAPH, {"style_ref": {"node": "1", "field": "image"},
                                    "output": {"node": "3"}}, MATTE_PARAMS)
    raw_card("broken", full_card("broken", {**body, "settings": [{"key": "gone"}]},
                                 status="reviewed"))
    every = get("/blueprints?all=1", ARTIST).json()["blueprints"]
    check("a reviewed card that no longer validates carries problems",
          bool({e["id"]: e for e in every}["broken"]["problems"]), True)
    served = set(ids(get("/blueprints", AGENT)))
    check("offered on every all=1 entry is exactly 'an agent is served it'",
          [(e["id"], e["offered"]) for e in every],
          [(e["id"], e["id"] in served) for e in every])
    check("...and the agent list is the offered set", sorted(served),
          sorted(e["id"] for e in every if e["offered"]))

    v = get("/card?id=rough", ARTIST).json()
    check("GET /card: card, version, state and abilities",
          (v["status"], v["version"]["etag"], v["canEdit"], v["canReview"], v["prefill"]),
          ("draft", docsave.norm_etag(etag_of("rough")), True, False, None))
    p = get("/card?id=good_new", ARTIST)
    check("GET /card on an unknown id is 404", p.code, 404)
    publish("fresh", GEN_GRAPH, {"positive": {"node": "1", "field": "text"},
                                 "style_ref": {"node": "1", "field": "text"}, "output": {"node": "3"}},
            [{"key": "steps", "type": "int", "node": "2", "field": "steps", "default": 20,
              "min": 1, "max": 60}])
    pre = get("/card?id=fresh", OWNER).json()
    check("no card: a prefill from the graph",
          (pre["card"], pre["prefill"]["inputs"]["prompt"], pre["prefill"]["inputs"]["reference"],
           pre["prefill"]["inputs"]["sourceImage"], pre["prefill"]["settings"],
           pre["canReview"]),
          (None, "required", "optional", "none",
           [{"key": "steps", "default": 20, "min": 1, "max": 60}], True))

    h = post("/card/save", AGENT, {"id": "rough", "card": matte_card()})
    check("POST /card/save refuses an agent 403", (h.code, h.json()["ok"]), (403, False))
    base = {"card:rough": {"etag": docsave.norm_etag(etag_of("rough")), "rev": ""}}
    h = post("/card/save", ARTIST, {"id": "rough", "card": matte_card(purpose="edited")}, base)
    vers = json.loads(h.sent_headers.get("X-IW-Doc-Versions") or "{}")
    check("a save answers 200 ok and hands back the card's version",
          (h.code, h.json()["ok"], vers.get("card:rough", {}).get("etag")),
          (200, True, docsave.norm_etag(etag_of("rough"))))
    h = post("/card/save", ARTIST, {"id": "rough", "card": matte_card(purpose="stale")}, base)
    check("a stale save is the 409 doc-guard answers",
          (h.code, h.json().get("doc"), h.json().get("reason")), (409, "card:rough", "stale"))
    h = post("/card/save", ARTIST, {"id": "rough", "card": matte_card(billing="cash")},
             {"card:rough": vers["card:rough"]})
    check("a validation failure is 200 ok:false with errors",
          (h.code, h.json()["ok"], bool(h.json()["errors"])), (200, False, True))
    h = post("/card/save", ARTIST, {"id": "rough", "card": matte_card(), "review": True},
             {"card:rough": vers["card:rough"]})
    check("review without pipelineMerge is 403", h.code, 403)
    rev1 = get("/card/history?id=rough&rev=1", ARTIST).json()
    check("GET /card/history returns one stored version", rev1["card"]["rev"], 1)


def test_delete() -> None:
    reset()
    matte()
    save("matte", matte_card(), base_of("matte"))
    save("matte", matte_card(purpose="v2"), base_of("matte"))
    check("a card and its history exist", (stored("matte") is not None, len(history_keys("matte"))),
          (True, 1))
    res = blueprints.delete_blueprint("matte")
    check("deleting the blueprint removes card.json and card.history/",
          (res["existed"], stored("matte"), history_keys("matte"),
           [k for k in R2.objects if k.startswith(f"{PFX}/matte/")]),
          (True, None, [], []))


def test_doc_guard_names_a_card() -> None:
    js = (Path(u.__file__).parent / "doc-guard.js").read_text(encoding="utf-8")
    check("doc-guard words card:<id> as the card", "'the card “' + id.slice(5)" in js, True)


# --------------------------------------------------------------------------
# Review round (PR #1078)
# --------------------------------------------------------------------------
def test_the_page_renders() -> None:
    """`_index` once bound a local `cards` list over the `cards` module, so the
    page 500ed for everyone. Render it for real."""
    reset()
    for ident in (ARTIST, OWNER):
        h = get("/_index_html", ident)
        page = h.wfile.getvalue().decode("utf-8", "replace")
        check(f"the page renders ({ident.name})", h.code, 200)
        check(f"...with the review flag ({ident.name})",
              f"const CARD_CAN_REVIEW={'true' if ident is OWNER else 'false'};" in page, True)
    check("...and carries the card editor", "openCardEditor" in page, True)


def test_review_needs_a_recent_browser_launch() -> None:
    reset()
    matte()
    check("an api token with pipelineMerge cannot review",
          refused(lambda: save("matte", matte_card(), base_of("matte"), API_OWNER, review=True)),
          True)
    check("...though it is neither an agent nor missing the cap",
          (cards.is_agent(API_OWNER), API_OWNER.can(launch.REVIEW_CAP)), (False, True))
    check("a session older than REVIEW_MAX_AGE cannot review",
          refused(lambda: save("matte", matte_card(), base_of("matte"), OLD_OWNER, review=True)),
          True)
    check("...and is told to relaunch",
          (cards.review_needs_relaunch(OLD_OWNER), cards.review_needs_relaunch(OWNER)),
          (True, False))
    check("...but may still save a draft",
          save("matte", matte_card(), base_of("matte"), OLD_OWNER)["ok"], True)
    v = get("/card?id=matte", OLD_OWNER).json()
    check("GET /card says why the review button is gone",
          (v["canReview"], v["reviewNeedsRelaunch"]), (False, True))
    check("nothing was reviewed", stored("matte")["status"], "draft")
    gate = launch.LaunchGate(aud="atlas", signing_env="T_SIGN", legacy_env="T_LEGACY",
                             legacy_cookie="t", legacy_header="X-T")
    os.environ["T_SIGN"] = "s" * 32
    try:
        now = int(time.time())
        claims = {"v": 1, "typ": "api", "aud": "atlas", "sub": "owner", "client": "c",
                  "project": "p", "caps": [launch.REVIEW_CAP], "iat": now, "exp": now + 60}
        res = gate.authenticate("/card", {launch.LAUNCH_HEADER: launch.sign("s" * 32, claims)})
        check("the gate marks an X-IW-Launch identity as an api token",
              (res.ok, res.identity.token_typ, res.identity.is_browser,
               cards.can_review(res.identity)), (True, "api", False, False))
        cookie = gate.mint_session({**claims, "typ": "launch"})
        res = gate.authenticate("/", {"Cookie": f"{gate.session_cookie}={cookie}"})
        check("...and a session cookie as a fresh browser launch that may review",
              (res.identity.token_typ, res.identity.is_browser, cards.can_review(res.identity)),
              ("session", True, True))
    finally:
        os.environ.pop("T_SIGN", None)


def test_agents_never_read_a_card_directly() -> None:
    reset()
    matte()
    save("matte", matte_card(), base_of("matte"), OWNER)
    check("GET /card refuses an agent", get("/card?id=matte", AGENT).code, 403)
    check("GET /card/history refuses an agent", get("/card/history?id=matte&rev=1", AGENT).code,
          403)

    def unreadable(key):
        raise storage.ObjectUnreadable(key)

    real = storage.get_with_etag
    storage.get_with_etag = unreadable
    try:
        check("GET /card answers 503 when R2 cannot be read",
              get("/card?id=matte", ARTIST).code, 503)
    finally:
        storage.get_with_etag = real
    real = storage.get_strict
    storage.get_strict = unreadable
    try:
        check("GET /card/history answers 503 when R2 cannot be read",
              get("/card/history?id=matte&rev=1", ARTIST).code, 503)
    finally:
        storage.get_strict = real


MODEL_GRAPH = {
    "1": {"class_type": "LoadImage", "inputs": {"image": "in.png"}},
    "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "toon.safetensors"}},
    "3": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "IW"}},
}


def review_now(bp_id: str, **over) -> None:
    res = save(bp_id, matte_card(settings=[], **over), base_of(bp_id), OWNER, review=True)
    assert res["ok"], res


def test_other_blueprint_changes_reset_review() -> None:
    reset()
    publish("rescan", MODEL_GRAPH, {"style_ref": {"node": "1", "field": "image"},
                                    "output": {"node": "3"}})
    review_now("rescan")
    msg = UploadHandler()
    msg = u.Handler._rescanblueprintmodels(msg, {"id": "rescan"})
    check("a rescan that changes the manifest resets review",
          (msg.startswith("✓"), stored("rescan")["status"],
           stored("rescan").get("resetReason", "").startswith("blueprint models rescanned by Owner")),
          (True, "draft", True))
    review_now("rescan")
    msg = u.Handler._rescanblueprintmodels(UploadHandler(), {"id": "rescan"})
    check("a rescan that changes nothing leaves the review alone",
          ("already up to date" in msg, stored("rescan")["status"]), (True, "reviewed"))

    reset()
    blueprints._sync_bundled_blueprints()
    wan = "wan22_i2v_flipbook"
    wan_card = json.loads((blueprints.BUNDLED_SRC / wan / "card.json").read_text(encoding="utf-8"))
    body = {k: v for k, v in wan_card.items() if k in cards.CLIENT_FIELDS}
    res = save(wan, body, base_of(wan), OWNER, review=True)
    check("the bundled wan22 card can be reviewed", res["ok"], True)
    blueprints._sync_bundled_blueprints()
    check("an unchanged bundled blueprint at boot leaves the review alone",
          stored(wan)["status"], "reviewed")
    key = f"{PFX}/{wan}/blueprint.json"
    man = json.loads(R2.objects[key][0])
    man["description"] = "an older copy"
    R2.objects[key] = (json.dumps(man).encode("utf-8"), '"old"')
    blueprints._sync_bundled_blueprints()
    check("a bundled blueprint updated at boot resets its reviewed card",
          (stored(wan)["status"],
           stored(wan).get("resetReason", "").startswith(
               "blueprint updated from the bundled copy by the boot sync")),
          ("draft", True))


def lag_staging(bp_id: str) -> None:
    """The bucket moves on; the staging mirror still holds the old graph."""
    key = f"{PFX}/{bp_id}/workflow.json"
    graph = {**MATTE_GRAPH, "9": {"class_type": "Note", "inputs": {}}}
    R2.objects[key] = (json.dumps(graph, indent=2).encode("utf-8"), '"new"')


def test_review_and_staleness_read_the_bucket() -> None:
    reset()
    old = matte()
    lag_staging("matte")
    review_now("matte")
    r2 = blueprints.read_blueprint_r2("matte")
    check("a review pins the graph the bucket holds, not the lagging mirror",
          (stored("matte")["graphSha"] == r2["graph_sha"],
           stored("matte")["graphSha"] == old["graph_sha"]), (True, False))
    check("...and the listing calls it reviewed", ids(get("/blueprints", ARTIST)), ["matte"])

    reset()
    matte()
    review_now("matte")
    lag_staging("matte")
    check("the mirror still matches the card",
          cards.effective_status(stored("matte"), blueprints.get_blueprint("matte")), "reviewed")
    every = {e["id"]: e for e in get("/blueprints?all=1", ARTIST).json()["blueprints"]}
    check("...but a reviewed card is judged against the bucket: stale",
          (every["matte"]["status"], ids(get("/blueprints", ARTIST))), ("stale", []))
    check("GET /card agrees", get("/card?id=matte", ARTIST).json()["status"], "stale")


def test_agents_never_get_a_card_with_problems() -> None:
    reset()
    bp = matte()
    raw_card("matte", full_card("matte", matte_card(settings=[{"key": "gone"}]),
                                status="reviewed", graphSha=bp["graph_sha"],
                                mapSha=bp["map_sha"]))
    check("a reviewed card with problems is withheld from the agents' list",
          (ids(get("/blueprints", ARTIST)), ids(get("/blueprints", AGENT))), ([], []))
    every = {e["id"]: e for e in get("/blueprints?all=1", ARTIST).json()["blueprints"]}
    check("...the editor still lists it, with its problems",
          (every["matte"]["status"], has(every["matte"]["problems"], "gone")), ("reviewed", True))


def test_publish_names_the_blueprint_id() -> None:
    reset()
    body = {"name": "My Fancy Matte!", "description": "", "kind": "image", "base": "sdxl",
            "workflow_text": json.dumps(MATTE_GRAPH),
            "bindings": {"output": {"node": "3"}, "style_ref": {"node": "1", "field": "image"}},
            "params": [], "overwrite": True, "use_for_atlas": False}
    h = post("/uploadblueprint", ARTIST, body)
    check("the publish reply names the server's slugged id",
          (h.wfile.getvalue().decode("utf-8").startswith("✓"),
           h.sent_headers.get("X-IW-Blueprint-Id")), (True, "my_fancy_matte_"))
    h = post("/uploadblueprint", ARTIST, {**body, "workflow_text": "not json"})
    check("...and a failed publish names none", h.sent_headers.get("X-IW-Blueprint-Id"), None)
    js = (Path(u.__file__).parent / "card-editor.js").read_text(encoding="utf-8")
    check("the page saves the card under that id, never a client-side slug",
          ("X-IW-Blueprint-Id" in u.PAGE, "toLowerCase" in js), (True, False))


def test_bundled_cards_that_cannot_ship() -> None:
    reset()
    blueprints._sync_bundled_blueprints()
    src = Path(tempfile.mkdtemp(prefix="bp-bad-"))
    for i in ("sdxl", "flux", "gpt_image"):
        (src / i).mkdir()
    (src / "sdxl" / "card.json").write_text("[1, 2]", encoding="utf-8")
    flux = json.loads((blueprints.BUNDLED_SRC / "flux" / "card.json").read_text(encoding="utf-8"))
    (src / "flux" / "card.json").write_text(json.dumps({**flux, "id": "sdxl"}), encoding="utf-8")
    shutil.copy(blueprints.BUNDLED_SRC / "gpt_image" / "card.json", src / "gpt_image" / "card.json")
    done = dict(cards.sync_bundled_cards(src, log=lambda _m: None))
    check("a card that is not an object, or names another id, is skipped; the rest ship",
          (done["sdxl"], done["flux"], done["gpt_image"], stored("sdxl"), stored("flux")),
          ("skipped: not a JSON object", "skipped: id does not match its directory", "created",
           None, None))


def test_history_is_summarised_on_open() -> None:
    reset()
    matte()
    for n in range(9):
        save("matte", matte_card(purpose=f"v{n}"), base_of("matte"))
    reads = []
    real = storage.get_strict
    storage.get_strict = lambda key: (reads.append(key), real(key))[1]
    try:
        hist = get("/card?id=matte", ARTIST).json()["history"]
    finally:
        storage.get_strict = real
    check("GET /card lists every version", [h["rev"] for h in hist], list(range(9, 0, -1)))
    check("...but reads only the newest few in full",
          (sum(1 for k in reads if "/card.history/" in k),
           [h.get("loaded", True) for h in hist].count(False)),
          (cards.HISTORY_DETAIL, 8 - cards.HISTORY_DETAIL))
    check("an older one is read on demand",
          get("/card/history?id=matte&rev=1", ARTIST).json()["card"]["purpose"], "v0")


if __name__ == "__main__":
    for fn in (test_schema, test_blueprint_rules, test_cas, test_review,
               test_reset_races_a_save, test_republish_resets_review, test_bundled_sync,
               test_catalogue_seed, test_listing, test_delete, test_doc_guard_names_a_card,
               test_the_page_renders, test_review_needs_a_recent_browser_launch,
               test_agents_never_read_a_card_directly, test_other_blueprint_changes_reset_review,
               test_review_and_staleness_read_the_bucket,
               test_agents_never_get_a_card_with_problems, test_publish_names_the_blueprint_id,
               test_bundled_cards_that_cannot_ship, test_history_is_summarised_on_open):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED: " + ", ".join(FAILED))
    sys.exit(1 if FAILED else 0)
