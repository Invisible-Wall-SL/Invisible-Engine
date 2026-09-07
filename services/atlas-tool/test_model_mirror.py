"""Offline self-test for model_mirror (no R2, no ComfyUI, no boto3 traffic).

Run:  py test_model_mirror.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

`model_mirror` is a DELIVERY ORACLE, not a gate, and the assertions below are
mostly about what it must never do:

  * it must never turn "we could not ask R2" into "the file is not there".
    `storage.get_strict`/`head` exist precisely to keep those apart, and the
    whole authority split rests on it — the TARGET'S inventory refuses a render,
    this module only ever explains how to fix one;
  * it must never CHOOSE between two files with the same name in different
    folders — that is a coin flip that sends gigabytes at a folder no loader
    reads;
  * `annotate` must never remove a key, must write nothing at all unless the
    index is genuinely readable, and must be byte-for-byte idempotent, because
    `_rescanblueprintmodels` decides whether to write with a raw
    `if man_bytes == before` — non-determinism there turns every click into a
    fresh R2 put plus a `hydrate(force=True)`;
  * and the silence test at the end: the same models through
    `survey_blueprint_models` + `enrich` in EVERY index state must produce the
    same `ready` as a run with no mirror at all.

`resolve`/`annotate`/`describe` are pure functions over dicts and are tested
with literals. The two I/O primitives are injected into a FakeMirror.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

import blueprint_models as bm
import blueprints
import model_mirror as mm
import storage

PASSED: list[str] = []
FAILED: list[str] = []


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def check_in(label: str, needle, haystack) -> None:
    ok = needle in haystack
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       {needle!r} not found in:\n       {haystack!r}")


def check_not_in(label: str, needle, haystack) -> None:
    ok = needle not in haystack
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       {needle!r} unexpectedly found in:\n       {haystack!r}")


# --------------------------------------------------------------------------
# The double. Same shape as test_comfy_catalog.py's FakeStorage: one tiny R2
# with a manifest object and a set of keys that "exist" for HEAD.
# --------------------------------------------------------------------------
class FakeMirror:
    """`get_bytes(key)` + `head(key)`, classifying like the strict primitives.

    `read_raises` / `head_raises` stand for "R2 is simply down" — they raise
    `ObjectUnreadable`, which is the ONE thing this module must never read as
    absence. `objects` is the set of keys HEAD finds (with their sizes); a
    manifest row whose key is absent from it is the indexed-but-gone case."""

    def __init__(self, doc: dict | None = None, *, raw: bytes | None = None,
                 objects: dict | None = None, read_raises: bool = False,
                 head_raises: bool = False, no_manifest: bool = False):
        self.doc = doc
        self.raw = raw
        self.objects = dict(objects or {})
        self.read_raises = read_raises
        self.head_raises = head_raises
        self.no_manifest = no_manifest
        self.heads: list[str] = []
        self.reads: list[str] = []

    def get_bytes(self, key: str) -> bytes | None:
        self.reads.append(key)
        if self.read_raises:
            raise storage.ObjectUnreadable(f"{key}: timeout")
        if self.no_manifest:
            return None
        if self.raw is not None:
            return self.raw
        return json.dumps(self.doc or {}).encode("utf-8")

    def head(self, key: str) -> dict | None:
        self.heads.append(key)
        if self.head_raises:
            raise storage.ObjectUnreadable(f"{key}: throttled")
        if key not in self.objects:
            return None
        return {"size": self.objects[key], "etag": "x", "mtime": 0}


def manifest(rows: list[dict], *, base_prefix: str | None = None) -> dict:
    doc: dict = {"version": 1, "models": rows}
    if base_prefix is not None:
        doc["base_prefix"] = base_prefix
    return doc


def row(key: str, d: str, name: str, size: int = 1000, sha: str = "sha") -> dict:
    return {"key": key, "dir": d, "name": name, "size": size, "sha256": sha}


LORA = row("comfyui-models/loras/comic-style-lora-000002.safetensors",
           "loras", "comic-style-lora-000002.safetensors", 168_000_000, "aaa")
UNET = row("comfyui-models/diffusion_models/flux1-dev-fp8.safetensors",
           "diffusion_models", "flux1-dev-fp8.safetensors", 11_900_000_000, "bbb")


def index_of(fake: FakeMirror) -> dict:
    return mm.load_index(get_bytes=fake.get_bytes)


# --------------------------------------------------------------------------
def test_an_exact_key_is_the_first_answer():
    fake = FakeMirror(manifest([LORA, UNET]))
    idx = index_of(fake)
    check("the index loaded", idx["state"], "ready")
    res = mm.resolve({"field": "lora_name", "save_path": "loras",
                      "filename": "comic-style-lora-000002.safetensors"}, idx)
    check("resolved as a hit", res["state"], "hit")
    check("matched on the constructed key", res["matched_on"], "key")
    check("and carries the key", res["key"], LORA["key"])
    check("and the size", res["size"], 168_000_000)
    check("and the sha", res["sha256"], "aaa")


def test_a_filename_hit_adopts_the_mirrors_own_folder():
    """`blueprints.MODEL_FIELD_DIRS` maps `unet_name` to the LEGACY alias `unet`,
    while the mirror holds the file under `diffusion_models`. ComfyUI reads both
    as one folder list, so this is the common case, not a fault — and the
    mirror's `dir` is what `pull-models.py` actually writes to, so it wins."""
    fake = FakeMirror(manifest([LORA, UNET]))
    idx = index_of(fake)
    res = mm.resolve({"field": "unet_name", "save_path": "unet",
                      "filename": "flux1-dev-fp8.safetensors"}, idx)
    check("the alias gap is crossed", res["state"], "hit")
    check("by falling back to the filename", res["matched_on"], "filename")
    check("the mirror's own dir is adopted", res["dir"], "diffusion_models")
    check("and its key, not the constructed one", res["key"], UNET["key"])


def test_an_empty_save_path_resolves_by_name_alone():
    """An unmapped field yields an EMPTY save_path by design (never a guess), so
    the constructed key is `<prefix>/<filename>` — which must not be allowed to
    stand in for a real answer."""
    fake = FakeMirror(manifest([LORA]))
    idx = index_of(fake)
    res = mm.resolve({"field": "pulid_file", "save_path": "",
                      "filename": "comic-style-lora-000002.safetensors"}, idx)
    check("still found", res["state"], "hit")
    check("by name, not by the rootward key", res["matched_on"], "filename")
    check("placed where the mirror says", res["dir"], "loras")
    check("the constructed key was never adopted", res["key"], LORA["key"])


def test_two_files_with_one_name_choose_nothing():
    dup_a = row("comfyui-models/loras/style.safetensors", "loras", "style.safetensors")
    dup_b = row("comfyui-models/checkpoints/style.safetensors", "checkpoints",
                "style.safetensors")
    fake = FakeMirror(manifest([dup_a, dup_b]))
    idx = index_of(fake)
    res = mm.resolve({"field": "lora_name", "save_path": "",
                      "filename": "style.safetensors"}, idx)
    check("reported as ambiguous", res["state"], "ambiguous")
    check("nothing was chosen", res["key"], "")
    check("both candidates are named", sorted(res["candidates"]),
          sorted([dup_a["key"], dup_b["key"]]))
    check_in("and the remedy asks a human to disambiguate", "nothing was chosen",
             mm.describe(res, "local"))


def test_an_indexed_row_whose_object_is_gone_is_demoted():
    fake = FakeMirror(manifest([LORA]), objects={})  # manifest row, no object
    idx = index_of(fake)
    model = {"field": "lora_name", "save_path": "loras",
             "filename": "comic-style-lora-000002.safetensors"}
    res = mm.verify(mm.resolve(model, idx), model, idx, head=fake.head)
    check("demoted", res["state"], "indexed_but_gone")
    check_in("and the remedy names push-models", "push-models.py",
             mm.describe(res, "local"))


def test_bytes_in_the_bucket_with_no_manifest_row_are_reported_honestly():
    """`push-models.py` keeps a whole `reindex` bucket for this state: the object
    is in R2, but no manifest row indexes it, so "Sync models" will never fetch
    it. Collapsing it into "not in the mirror" sends a human to re-upload a file
    that is already there."""
    key = "comfyui-models/loras/orphan.safetensors"
    fake = FakeMirror(manifest([LORA]), objects={key: 4096})
    idx = index_of(fake)
    model = {"field": "lora_name", "save_path": "loras",
             "filename": "orphan.safetensors"}
    res = mm.resolve(model, idx)
    check("the index alone says miss", res["state"], "miss")
    res = mm.verify(res, model, idx, head=fake.head)
    check("the HEAD-on-miss corrects it", res["state"], "in_bucket_unindexed")
    check("and names the key", res["key"], key)
    check_in("the remedy says the manifest is the gap", "NO manifest row",
             mm.describe(res, "local"))


def test_an_unreadable_r2_is_never_absence():
    fake = FakeMirror(read_raises=True)
    idx = mm.load_index(get_bytes=fake.get_bytes)
    check("the index says unreadable, not absent", idx["state"], "unreadable")
    check_not_in("and 'absent' is not what it reports", "absent", idx["state"])
    res = mm.resolve({"field": "lora_name", "save_path": "loras",
                      "filename": "comic-style-lora-000002.safetensors"}, idx)
    check("a model against it gets no verdict", res["state"], "unknown")
    text = mm.describe(res, "local")
    check_in("and the remedy says so in as many words",
             "NOT evidence", text)

    # An absent manifest is a DIFFERENT state, and must read differently.
    gone = mm.load_index(get_bytes=FakeMirror(no_manifest=True).get_bytes)
    check("a genuine 404 is 'absent'", gone["state"], "absent")

    # A truncated / garbled object is unreadable too — never an empty shelf.
    torn = mm.load_index(get_bytes=FakeMirror(raw=b"{not json").get_bytes)
    check("garbled bytes are unreadable", torn["state"], "unreadable")
    check("and index nothing", torn["by_key"], {})

    # A throttled HEAD must not demote a hit that the manifest just confirmed.
    ok = FakeMirror(manifest([LORA]), head_raises=True)
    oki = index_of(ok)
    model = {"field": "lora_name", "save_path": "loras",
             "filename": "comic-style-lora-000002.safetensors"}
    res = mm.verify(mm.resolve(model, oki), model, oki, head=ok.head)
    check("a throttled HEAD leaves the hit standing", res["state"], "hit")
    check("and does not claim it was verified", res.get("verified"), None)


def test_a_stored_key_is_a_fallback_and_never_an_override():
    stored = {"field": "lora_name", "save_path": "loras",
              "filename": "comic-style-lora-000002.safetensors",
              "r2_key": "comfyui-models/OLD/comic-style-lora-000002.safetensors"}
    live = index_of(FakeMirror(manifest([LORA])))
    res = mm.resolve(stored, live)
    check("a live read wins over the stored key", res["key"], LORA["key"])
    check("and says how it matched", res["matched_on"], "key")

    dead = mm.load_index(get_bytes=FakeMirror(read_raises=True).get_bytes)
    res = mm.resolve(stored, dead)
    check("with R2 down the stored key is used", res["key"], stored["r2_key"])
    check("and is labelled as such", res["matched_on"], "stored_r2_key")
    check_in("the remedy admits it was not verified",
             "could not be read", mm.describe(res, "local"))


def test_the_prefix_comes_from_the_manifest_not_the_constant():
    """`push-models.py::run` hard-exits on a prefix mismatch and the launcher
    DROPS keys outside `base_prefix`, so the doc's own value is the only one
    worth constructing a key from."""
    moved = row("models-v2/loras/x.safetensors", "loras", "x.safetensors")
    idx = index_of(FakeMirror(manifest([moved], base_prefix="models-v2")))
    check("the prefix is read off the doc", idx["prefix"], "models-v2")
    res = mm.resolve({"field": "lora_name", "save_path": "loras",
                      "filename": "x.safetensors"}, idx)
    check("so the constructed key matches", res["matched_on"], "key")
    check("a manifest with no base_prefix falls back to the constant",
          index_of(FakeMirror(manifest([LORA])))["prefix"], mm.MIRROR_PREFIX)


def test_the_remedy_names_the_button_or_the_command():
    idx = index_of(FakeMirror(manifest([LORA])))
    res = mm.resolve({"field": "lora_name", "save_path": "loras",
                      "filename": "comic-style-lora-000002.safetensors"}, idx)
    local = mm.describe(res, "local")
    check_in("local: the launcher button", "Sync models", local)
    check_in("local: and the restart it needs", "restart ComfyUI", local)
    check_in("local: with the size spelled out", "MB", local)
    pod = mm.describe(res, "serverless")
    check_in("serverless: the exact pull command",
             "runpod/pull-models.py --dest /workspace/ComfyUI/models", pod)
    check_in("serverless: and that a running worker keeps its old list",
             "fresh worker", pod)
    miss = mm.resolve({"field": "lora_name", "save_path": "loras",
                       "filename": "nobody.safetensors"}, idx)
    check_in("a miss points at the seeding script", "seed-comfyui-models.py",
             mm.describe(miss, "local"))
    # The diag card sits above a banner that prints the whole remedy, so its
    # own line stays a status and never restates it.
    check("the card's status line is short", mm.short_status(res),
          f"in the model mirror at {LORA['key']} (160.2 MB)")
    check("a miss reads plainly there too", mm.short_status(miss),
          "not in the model mirror")
    check_not_in("and it names no button", "Sync models", mm.short_status(res))


def test_annotate_writes_only_what_it_read_and_removes_nothing():
    models = [
        {"field": "lora_name", "save_path": "loras",
         "filename": "comic-style-lora-000002.safetensors", "url": "https://x/y",
         "base": "FLUX.1"},
        {"field": "pulid_file", "save_path": "", "filename": "private.bin",
         "r2_key": "hand/typed/key", "sha256": "typed"},
    ]
    idx = index_of(FakeMirror(manifest([LORA])))
    got, changed = mm.annotate(copy.deepcopy(models), idx)
    check("one entry gained a key", changed, 1)
    check("the resolved entry got the mirror's key", got[0]["r2_key"], LORA["key"])
    check("with its sha", got[0]["sha256"], "aaa")
    check("and its size", got[0]["size"], 168_000_000)
    check("the human's url is untouched", got[0]["url"], "https://x/y")
    check("an unresolved entry keeps its hand-typed key", got[1]["r2_key"],
          "hand/typed/key")
    check("and its hand-typed sha", got[1]["sha256"], "typed")
    check("nothing else was added to it", sorted(got[1]),
          sorted(models[1]))


def test_annotate_writes_nothing_when_the_mirror_cannot_be_read():
    """An R2 hiccup during a rescan must not strip provenance off every declared
    model and then PERSIST that."""
    models = [{"field": "lora_name", "save_path": "loras",
               "filename": "comic-style-lora-000002.safetensors",
               "r2_key": "comfyui-models/loras/comic-style-lora-000002.safetensors",
               "sha256": "aaa", "size": 168_000_000}]
    for state, fake in (("unreadable", FakeMirror(read_raises=True)),
                        ("absent", FakeMirror(no_manifest=True))):
        idx = mm.load_index(get_bytes=fake.get_bytes)
        check(f"the index is {state}", idx["state"], state)
        got, changed = mm.annotate(copy.deepcopy(models), idx)
        check(f"{state}: nothing was written", changed, 0)
        check(f"{state}: and the models come back identical", got, models)


DERIVED = [{"field": "lora_name", "save_path": "loras",
            "filename": "comic-style-lora-000002.safetensors"},
           {"field": "unet_name", "save_path": "unet",
            "filename": "flux1-dev-fp8.safetensors"},
           {"field": "pulid_file", "save_path": "", "filename": "private.bin"}]


def test_the_second_rescan_click_is_byte_identical():
    """`_rescanblueprintmodels` decides whether to write at all with a raw
    `if man_bytes == before`, and the cycle those bytes come from is
    derive -> merge_model_provenance -> annotate -> json.dumps. Asserting
    `annotate(annotate(x)) == annotate(x)` tested the wrong composition and hid
    the real churn: merge re-emits the provenance half in
    `MODEL_PROVENANCE_KEYS` order, so a key appended at the END by click 1 was
    MOVED by click 2 — same content, different bytes, so every click paid a
    staging write, an R2 put and a `hydrate(force=True)` (and opened a fresh
    window for `_sync_bundled`). Any model carrying `base` — i.e. every
    catalog-installable one — churned."""
    stored = [{"filename": "comic-style-lora-000002.safetensors",
               "save_path": "loras", "url": "https://x/y", "base": "FLUX.1"}]
    idx = index_of(FakeMirror(manifest([LORA, UNET])))

    merged, _ = blueprints.merge_model_provenance(copy.deepcopy(DERIVED), stored)
    first, first_changed = mm.annotate(merged, idx)
    check("the first click wrote something", first_changed, 2)
    by_name = {m["filename"]: m for m in first}
    check("the entry that had provenance still has it",
          by_name[LORA["name"]]["url"], "https://x/y")
    check("and gained the mirror's key",
          by_name[LORA["name"]]["r2_key"], LORA["key"])

    remerged, _ = blueprints.merge_model_provenance(copy.deepcopy(DERIVED), first)
    second, second_changed = mm.annotate(remerged, idx)
    check("the second click wrote nothing", second_changed, 0)
    check("and the whole cycle is byte-identical",
          json.dumps({"models": second}, indent=2),
          json.dumps({"models": first}, indent=2))

    # annotate alone must be stable too, or nothing above is meaningful.
    again, again_changed = mm.annotate(first, idx)
    check("annotate on its own is a no-op too", again_changed, 0)
    check("byte for byte", json.dumps(again, indent=2), json.dumps(first, indent=2))


def test_the_checklist_prints_the_verdict_and_the_remedy():
    """The `mirror:` line and the `->` remedy under each row ARE the product of
    this whole feature, and `format_checklist` runs inside the SystemExit(2)
    path — a regression there costs a human the only message they get."""
    fake = FakeMirror(manifest([LORA]), objects={LORA["key"]: 168_000_000})
    hit = bm._checklist_entry({"filename": LORA["name"], "save_path": "loras"},
                              "not installed")
    with_url = bm._checklist_entry(
        {"filename": "nobody.safetensors", "save_path": "loras",
         "url": "https://example.com/nobody.safetensors"}, "not installed")
    mm.enrich([hit, with_url], "local", get_bytes=fake.get_bytes, head=fake.head)

    out = bm.format_checklist(bm.PrepareResult(ready=False,
                                               still_missing=[hit, with_url]))
    check_in("the hit prints its key and its size",
             f"      mirror: {LORA['key']}  (160.2 MB)", out)
    check_in("with the remedy under it", "      -> ", out)
    check_in("and the launcher button in it", "Sync models", out)
    check_not_in("a verdict retires the useless empty source line",
                 "(no source URL)", out)
    check_in("but a real URL still prints",
             "source: https://example.com/nobody.safetensors", out)
    check_in("and a miss says so plainly",
             "      mirror: not in the model mirror", out)

    text = bm.format_advisories(bm.PrepareResult(advisories=[hit]))
    check_in("advisories render the same rows", f"mirror: {LORA['key']}", text)
    check_in("under the could-not-verify header",
             "could not be verified on this target", text)

    ambiguous = bm._checklist_entry({"filename": "style.safetensors",
                                     "save_path": ""}, "not installed")
    dup = FakeMirror(manifest([
        row("comfyui-models/loras/style.safetensors", "loras",
            "style.safetensors"),
        row("comfyui-models/checkpoints/style.safetensors", "checkpoints",
            "style.safetensors")]))
    mm.enrich([ambiguous], "local", get_bytes=dup.get_bytes, head=dup.head)
    check_in("an ambiguous row names both candidates, chooses neither",
             "several files with this name", bm.format_advisories(
                 bm.PrepareResult(advisories=[ambiguous])))

    unreadable = bm._checklist_entry({"filename": LORA["name"],
                                      "save_path": "loras"}, "not installed")
    down = FakeMirror(read_raises=True)
    mm.enrich([unreadable], "local", get_bytes=down.get_bytes, head=down.head)
    check_in("an unreadable mirror says so, and claims nothing",
             "mirror: could not be read", bm.format_advisories(
                 bm.PrepareResult(advisories=[unreadable])))

    # Only `enrich` writes `mirror`, but this renderer is the last thing between
    # a refused render and a traceback, so a malformed value must not crash it.
    broken = dict(hit)
    broken["mirror"] = "not a dict"
    bm.format_checklist(bm.PrepareResult(ready=False, still_missing=[broken]))
    check("a malformed mirror value does not take the checklist down", True, True)


def test_enrich_explains_every_row_and_never_raises():
    fake = FakeMirror(manifest([LORA]), objects={LORA["key"]: 168_000_000})
    rows = [{"filename": "comic-style-lora-000002.safetensors",
             "save_path": "loras", "reason": "not installed"},
            {"filename": "nobody.safetensors", "save_path": "loras",
             "reason": "not installed"},
            "this is not a dict"]
    state = mm.enrich(rows, "local", get_bytes=fake.get_bytes, head=fake.head)
    check("the index state comes back", state, "ready")
    check("the hit is resolved", rows[0]["mirror"]["state"], "hit")
    check("and verified by the HEAD", rows[0]["mirror"].get("verified"), True)
    check_in("with a human size", "MB", rows[0]["mirror"]["size_human"])
    check("the miss is a miss", rows[1]["mirror"]["state"], "miss")
    check("both rows carry a remedy",
          [bool(r.get("remedy")) for r in rows[:2]], [True, True])
    check("a non-dict row is skipped, not fatal", rows[2], "this is not a dict")
    # A FRESH double: `fake` has already recorded a read and two HEADs, so
    # asserting on it here would pass by proving that I/O happened.
    idle = FakeMirror(manifest([LORA]), objects={LORA["key"]: 168_000_000})
    check("an empty list does no I/O at all",
          (mm.enrich([], "local", get_bytes=idle.get_bytes, head=idle.head),
           idle.reads, idle.heads),
          ("skipped", [], []))


def test_no_mirror_state_can_ever_refuse_a_render():
    """THE INVARIANT. The target's own inventory is the only thing allowed to
    refuse a render; the mirror is only ever allowed to explain how to fix one.
    So the same models through `survey_blueprint_models` + `enrich` must produce
    the same `ready` in EVERY index state as they do with no mirror at all."""
    models = [{"field": "unet_name", "save_path": "unet",
               "filename": "flux1-dev-fp8.safetensors"},
              {"field": "pulid_file", "save_path": "", "filename": "private.bin"}]
    baseline = bm.survey_blueprint_models(copy.deepcopy(models))
    check("the no-mirror baseline is ready", baseline.ready, True)
    check("and refuses nothing", baseline.still_missing, [])

    fakes = {
        "ready": FakeMirror(manifest([LORA, UNET])),
        "absent": FakeMirror(no_manifest=True),
        "unreadable": FakeMirror(read_raises=True),
        "garbled": FakeMirror(raw=b"<html>503</html>"),
        "head down": FakeMirror(manifest([LORA, UNET]), head_raises=True),
        "indexed but gone": FakeMirror(manifest([LORA, UNET]), objects={}),
    }
    for label, fake in fakes.items():
        res = bm.survey_blueprint_models(copy.deepcopy(models))
        mm.enrich(res.still_missing + res.advisories, "serverless",
                  get_bytes=fake.get_bytes, head=fake.head)
        check(f"{label}: ready is untouched", res.ready, baseline.ready)
        check(f"{label}: still_missing is untouched", res.still_missing, [])
        check(f"{label}: every model is still reported",
              len(res.advisories), len(models))
        check(f"{label}: and every row got an explanation",
              all(r.get("remedy") for r in res.advisories), True)
        check_not_in(f"{label}: the checklist stays empty", "->",
                     bm.format_checklist(res))


# --------------------------------------------------------------------------
# Drift pin. The two literals live in FOUR places: here, push-models.py (both)
# and pull-models.py (the manifest key). Those two are standalone `__main__`
# scripts that deliberately import nothing from the service, so this is the only
# file that can hold them together — and `test_push_models.py` cannot, because
# its documented invocation carries no PYTHONPATH and `model_mirror` needs
# `../_shared` for `storage`.
# --------------------------------------------------------------------------
def _load(name: str, filename: str):
    path = Path(__file__).resolve().parent / "runpod" / filename
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_two_literals_have_not_drifted():
    pm = _load("push_models", "push-models.py")
    pull = _load("pull_models", "pull-models.py")
    check("the mirror prefix matches push-models", mm.MIRROR_PREFIX,
          pm.DEFAULT_PREFIX)
    check("the manifest key matches push-models", mm.MANIFEST_KEY,
          pm.MANIFEST_KEY)
    check("and pull-models", mm.MANIFEST_KEY, pull.MANIFEST_KEY)
    # `model_mirror` may not import `blueprints` (the module docstring says
    # why), so the key order it writes in is a restatement — and this is what
    # keeps the rescan no-op above honest if that tuple ever changes.
    check("the provenance key order still matches blueprints",
          mm._PROVENANCE_ORDER, blueprints.MODEL_PROVENANCE_KEYS)


if __name__ == "__main__":
    for fn in (test_an_exact_key_is_the_first_answer,
               test_a_filename_hit_adopts_the_mirrors_own_folder,
               test_an_empty_save_path_resolves_by_name_alone,
               test_two_files_with_one_name_choose_nothing,
               test_an_indexed_row_whose_object_is_gone_is_demoted,
               test_bytes_in_the_bucket_with_no_manifest_row_are_reported_honestly,
               test_an_unreadable_r2_is_never_absence,
               test_a_stored_key_is_a_fallback_and_never_an_override,
               test_the_prefix_comes_from_the_manifest_not_the_constant,
               test_the_remedy_names_the_button_or_the_command,
               test_annotate_writes_only_what_it_read_and_removes_nothing,
               test_annotate_writes_nothing_when_the_mirror_cannot_be_read,
               test_the_second_rescan_click_is_byte_identical,
               test_the_checklist_prints_the_verdict_and_the_remedy,
               test_enrich_explains_every_row_and_never_raises,
               test_no_mirror_state_can_ever_refuse_a_render,
               test_the_two_literals_have_not_drifted):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
