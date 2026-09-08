"""Offline self-test for blueprint model DECLARATION (no ComfyUI, no R2).

Run:  py test_blueprint_derive.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

Until `derive_models_from_graph` existed, `_uploadblueprint` wrote a hardcoded
`"models": []` five lines after it had already parsed the graph. So no blueprint
ever declared what it needed, which made `_validate_models`,
`blueprint_models.prepare_blueprint_models` and the whole ComfyUI-Manager
auto-install path dead weight for uploaded blueprints, and left model parity a
human habit.

That habit failed on 2026-09-07: `characterdesignertest3` named
`flux1-dev-fp8.safetensors` and `comic-style-lora-000002.safetensors`, both
absent from the machine it ran on, with nothing declaring them anywhere. The
graph below IS that graph's shape, and it is the primary fixture here.

Two risks are guarded, in this order of importance:

  1. FALSE POSITIVES. A declared "model" that is not a model file is a checklist
     entry nobody can ever satisfy, and — once a `save_path` is attached — a
     download aimed at a folder no loader reads. So the noise (a prompt, a
     `filename_prefix`, `sampler_name`, a wire) must come out empty, and an
     unmapped field must yield an EMPTY `save_path` rather than a guess.
  2. PROVENANCE LOSS. A re-import must not drop the `url`/`r2_key`/`sha256` a
     person attached to a model by hand — that regression would be silent until
     an install failed weeks later.

Everything here is a pure function over dicts: no network, no filesystem.
"""
from __future__ import annotations

import sys

import blueprint_models as bm
import blueprints as bp

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
# The 2026-09-07 graph: the FLUX stack the R&D pod has, plus every kind of
# string input that is NOT a model and must never be declared as one.
# --------------------------------------------------------------------------
REJECTED_GRAPH = {
    "2": {"class_type": "UNETLoader",
          "inputs": {"unet_name": "flux1-dev-fp8.safetensors",
                     "weight_dtype": "default"}},
    "22": {"class_type": "LoraLoaderModelOnly",
           "inputs": {"lora_name": "comic-style-lora-000002.safetensors",
                      "model": ["2", 0], "strength_model": 0.8}},
    "11": {"class_type": "DualCLIPLoader",
           "inputs": {"clip_name1": "t5xxl_fp8_e4m3fn.safetensors",
                      "clip_name2": "clip_l.safetensors",
                      "type": "flux"}},
    "10": {"class_type": "VAELoader",
           "inputs": {"vae_name": "ae.safetensors"}},
    "139": {"class_type": "PulidFluxModelLoader",
            "inputs": {"pulid_file": "pulid_flux_v0.9.1.safetensors"}},
    # --- noise: none of this is a model --------------------------------------
    "4": {"class_type": "CLIPTextEncode",
          "inputs": {"text": "a comic hero, safetensors of light",
                     "clip": ["11", 0]}},
    "17": {"class_type": "SaveImage",
           "inputs": {"filename_prefix": "invisible_wall/test7/batch/naty",
                      "images": ["8", 0]}},
    "1": {"class_type": "KSampler",
          "inputs": {"seed": 1899642439, "sampler_name": "euler",
                     "scheduler": "normal", "model": ["138", 0]}},
}


def names(models: list) -> list:
    return [m["filename"] for m in models]


def by_name(models: list, filename: str) -> dict:
    for m in models:
        if m["filename"] == filename:
            return m
    return {}


# --------------------------------------------------------------------------
def test_the_rejected_graph_now_declares_what_it_needs() -> None:
    """2026-09-07, the real payload: the two files the target machine did not
    have must be DECLARED, so the install path and the submit-time guard both
    have something to work with."""
    got = bp.derive_models_from_graph(REJECTED_GRAPH)
    check_in("the fp8 UNet is declared", "flux1-dev-fp8.safetensors", names(got))
    check_in("the trained LoRA is declared",
             "comic-style-lora-000002.safetensors", names(got))
    check("the UNet carries its own input name",
          by_name(got, "flux1-dev-fp8.safetensors")["field"], "unet_name")
    check("and lands in models/unet",
          by_name(got, "flux1-dev-fp8.safetensors")["save_path"], "unet")
    check("the LoRA lands in models/loras",
          by_name(got, "comic-style-lora-000002.safetensors")["save_path"],
          "loras")
    check("both DualCLIPLoader names are declared, not just the first",
          sorted(m["filename"] for m in got if m["save_path"] == "clip"),
          ["clip_l.safetensors", "t5xxl_fp8_e4m3fn.safetensors"])
    check("the VAE lands in models/vae",
          by_name(got, "ae.safetensors")["save_path"], "vae")
    check("PuLID's pulid_file lands in models/pulid",
          by_name(got, "pulid_flux_v0.9.1.safetensors")["save_path"], "pulid")
    check("six models, no more", len(got), 6)


def test_nothing_that_is_not_a_file_is_ever_declared() -> None:
    """The false-positive surface, and the expensive half of being wrong: a
    declared non-model is a checklist line nobody can satisfy and a download
    aimed at a folder no loader reads. Same rule as the submit-time guard
    (`batch_atlas.assert_graph_models_present`) — the VALUE has to look like a
    file, and nothing else counts."""
    got = names(bp.derive_models_from_graph(REJECTED_GRAPH))
    check_not_in("the prompt text is not a model",
                 "a comic hero, safetensors of light", got)
    check_not_in("the save prefix is not a model",
                 "invisible_wall/test7/batch/naty", got)
    check_not_in("the sampler is not a model", "euler", got)
    check_not_in("the scheduler is not a model", "normal", got)
    check_not_in("the weight dtype is not a model", "default", got)
    check_not_in("the DualCLIPLoader type is not a model", "flux", got)
    check("a wire is never mistaken for a filename",
          [m for m in bp.derive_models_from_graph(
              {"1": {"class_type": "KSampler",
                     "inputs": {"model": ["138", 0]}}})], [])
    check("nor is a number",
          bp.derive_models_from_graph(
              {"1": {"class_type": "KSampler", "inputs": {"seed": 1899642439}}}),
          [])
    check("an empty model name declares nothing (that is assert_models_named's "
          "job, and '' names no file)",
          bp.derive_models_from_graph(
              {"2": {"class_type": "UNETLoader", "inputs": {"unet_name": ""}}}),
          [])


def test_the_same_lora_twice_is_declared_once() -> None:
    """A graph may load the same LoRA on two branches. Declaring it twice would
    queue two installs and print it twice on the manual checklist."""
    graph = {
        "22": {"class_type": "LoraLoaderModelOnly",
               "inputs": {"lora_name": "comic-style-lora-000002.safetensors"}},
        "23": {"class_type": "LoraLoaderModelOnly",
               "inputs": {"lora_name": "comic-style-lora-000002.safetensors"}},
        "24": {"class_type": "LoraLoader",
               "inputs": {"lora_name": "comic-style-lora-000002.safetensors",
                          "strength_clip": 1.0}},
    }
    got = bp.derive_models_from_graph(graph)
    check("three loads of one LoRA -> one declaration", len(got), 1)
    check("and it keeps the right filename", got[0]["filename"],
          "comic-style-lora-000002.safetensors")


def test_an_unmapped_field_gets_an_empty_save_path_not_a_guess() -> None:
    """`model_name` belongs to UpscaleModelLoader, AnimateDiff and RIFE, in three
    different folders. An empty save_path means "not auto-installable, goes on
    the manual checklist" — a correct, graceful outcome. A guessed one sends
    gigabytes somewhere no loader reads."""
    graph = {
        "30": {"class_type": "UpscaleModelLoader",
               "inputs": {"model_name": "4x-UltraSharp.pth"}},
        "31": {"class_type": "SomeCustomNodeNobodyHasSeen",
               "inputs": {"weird_input": "mystery.gguf"}},
    }
    got = bp.derive_models_from_graph(graph)
    check("the upscaler is still declared (it IS needed)",
          by_name(got, "4x-UltraSharp.pth")["field"], "model_name")
    check("but with no save_path", by_name(got, "4x-UltraSharp.pth")["save_path"],
          "")
    check("an unknown custom node's model is declared too",
          by_name(got, "mystery.gguf")["field"], "weird_input")
    check("also with no save_path", by_name(got, "mystery.gguf")["save_path"], "")


def test_clip_name_is_resolved_by_class_not_by_field_alone() -> None:
    """`clip_name` is the one genuinely ambiguous input name in core ComfyUI:
    CLIPLoader reads text_encoders/clip, CLIPVisionLoader reads clip_vision. The
    derivation always knows the class, so it must use it."""
    got = bp.derive_models_from_graph({
        "40": {"class_type": "CLIPVisionLoader",
               "inputs": {"clip_name": "clip_vision_g.safetensors"}},
        "41": {"class_type": "CLIPLoader",
               "inputs": {"clip_name": "t5xxl_fp16.safetensors"}},
    })
    check("CLIPVisionLoader.clip_name -> models/clip_vision",
          by_name(got, "clip_vision_g.safetensors")["save_path"], "clip_vision")
    check("CLIPLoader.clip_name -> models/clip",
          by_name(got, "t5xxl_fp16.safetensors")["save_path"], "clip")


def test_every_model_extension_is_recognised() -> None:
    """The extension list is shared with `batch_atlas` so the import-time
    declaration and the submit-time guard can never disagree about what a model
    is."""
    graph = {str(i): {"class_type": "Loader",
                      "inputs": {"ckpt_name": f"m{i}{ext}"}}
             for i, ext in enumerate(bp.MODEL_FILE_EXTS)}
    got = bp.derive_models_from_graph(graph)
    check("all of MODEL_FILE_EXTS are picked up", len(got),
          len(bp.MODEL_FILE_EXTS))
    check("an image ref is not one of them",
          bp.derive_models_from_graph(
              {"9": {"class_type": "LoadImage",
                     "inputs": {"image": "style_ref.png"}}}), [])
    check("nor a .json", bp.derive_models_from_graph(
        {"9": {"class_type": "X", "inputs": {"cfg": "workflow.json"}}}), [])
    check("case does not matter", names(bp.derive_models_from_graph(
        {"9": {"class_type": "Loader",
               "inputs": {"ckpt_name": "SHOUTY.SAFETENSORS"}}})),
        ["SHOUTY.SAFETENSORS"])


def test_ordering_is_deterministic() -> None:
    """Re-importing an unchanged graph must produce an IDENTICAL manifest.
    Otherwise every re-import churns a diff in the shared library and nobody can
    see the change that actually mattered."""
    got = bp.derive_models_from_graph(REJECTED_GRAPH)
    check("sorted by (save_path, filename)",
          [(m["save_path"], m["filename"]) for m in got],
          sorted((m["save_path"], m["filename"]) for m in got))
    # Same graph, every dict rebuilt in a different insertion order.
    shuffled = {k: REJECTED_GRAPH[k] for k in reversed(list(REJECTED_GRAPH))}
    check("node order in the graph does not change the output",
          bp.derive_models_from_graph(shuffled), got)
    check("neither does input order within a node",
          bp.derive_models_from_graph({
              "11": {"class_type": "DualCLIPLoader",
                     "inputs": {"clip_name2": "clip_l.safetensors",
                                "clip_name1": "t5xxl_fp8_e4m3fn.safetensors"}}}),
          bp.derive_models_from_graph({
              "11": {"class_type": "DualCLIPLoader",
                     "inputs": {"clip_name1": "t5xxl_fp8_e4m3fn.safetensors",
                                "clip_name2": "clip_l.safetensors"}}}))


def test_a_broken_graph_declares_nothing_instead_of_raising() -> None:
    """This runs inside an upload handler that must never 500."""
    check("None", bp.derive_models_from_graph(None), [])
    check("a list", bp.derive_models_from_graph([1, 2, 3]), [])
    check("an empty dict", bp.derive_models_from_graph({}), [])
    check("a node that isn't a dict",
          bp.derive_models_from_graph({"1": "nope"}), [])
    check("a node with no inputs",
          bp.derive_models_from_graph({"1": {"class_type": "X"}}), [])
    check("inputs that aren't a dict",
          bp.derive_models_from_graph({"1": {"class_type": "X",
                                             "inputs": ["a"]}}), [])


# --------------------------------------------------------------------------
# Merge: the graph decides WHICH models; a person decides where one comes from.
# --------------------------------------------------------------------------
def test_reimport_keeps_the_provenance_a_person_added() -> None:
    """The nasty silent regression this prevents: an artist uploads a model,
    somebody re-imports a tweaked graph, and the r2_key/sha256/url that made it
    installable is gone — noticed weeks later, as a failed install."""
    previous = [
        {"field": "lora_name", "filename": "comic-style-lora-000002.safetensors",
         "save_path": "loras", "base": "FLUX.1",
         "url": "https://example.test/comic.safetensors",
         "r2_key": "_shared/models/abc123/comic-style-lora-000002.safetensors",
         "sha256": "abc123", "size": 144000000, "name": "Comic style",
         "type": "lora"},
        # In the old manifest, no longer anywhere in the graph.
        {"field": "ckpt_name", "filename": "sd_xl_base_1.0.safetensors",
         "save_path": "checkpoints", "url": "https://example.test/sdxl.safetensors"},
    ]
    derived = bp.derive_models_from_graph(REJECTED_GRAPH)
    models, dropped = bp.merge_model_provenance(derived, previous)

    lora = by_name(models, "comic-style-lora-000002.safetensors")
    check("the r2_key survives the re-import", lora.get("r2_key"),
          "_shared/models/abc123/comic-style-lora-000002.safetensors")
    check("so does the sha256", lora.get("sha256"), "abc123")
    check("so does the url", lora.get("url"),
          "https://example.test/comic.safetensors")
    check("so does the catalog base", lora.get("base"), "FLUX.1")
    check("and size/name/type", (lora.get("size"), lora.get("name"),
                                 lora.get("type")),
          (144000000, "Comic style", "lora"))
    check("the field/save_path still come from the GRAPH",
          (lora["field"], lora["save_path"]), ("lora_name", "loras"))

    check("a model the graph no longer references is dropped",
          "sd_xl_base_1.0.safetensors" not in names(models), True)
    check("and is reported, so the removal is visible", names(dropped),
          ["sd_xl_base_1.0.safetensors"])
    check("everything the graph names is still there", len(models), 6)
    check("a model with no stored twin carries no invented provenance",
          sorted(by_name(models, "ae.safetensors")),
          ["field", "filename", "save_path"])


def test_an_old_entry_without_a_save_path_still_matches_on_filename() -> None:
    """Hand-written entries often have only a filename + url. Matching strictly
    on (save_path, filename) would treat those as a different model, drop them,
    and lose the url."""
    previous = [{"filename": "flux1-dev-fp8.safetensors",
                 "url": "https://example.test/flux.safetensors"}]
    models, dropped = bp.merge_model_provenance(
        bp.derive_models_from_graph(REJECTED_GRAPH), previous)
    check("the url is carried onto the derived entry",
          by_name(models, "flux1-dev-fp8.safetensors").get("url"),
          "https://example.test/flux.safetensors")
    check("nothing is reported as dropped", dropped, [])
    check("the derived save_path still wins",
          by_name(models, "flux1-dev-fp8.safetensors")["save_path"], "unet")


def test_a_human_placed_an_unmappable_model_and_we_keep_that() -> None:
    """When the derivation can't place a field, a stored save_path is knowledge
    the graph does not contain — adopt it rather than blanking it."""
    graph = {"30": {"class_type": "UpscaleModelLoader",
                    "inputs": {"model_name": "4x-UltraSharp.pth"}}}
    previous = [{"field": "model_name", "filename": "4x-UltraSharp.pth",
                 "save_path": "upscale_models", "base": "upscale",
                 "url": "https://example.test/4x.pth"}]
    models, dropped = bp.merge_model_provenance(
        bp.derive_models_from_graph(graph), previous)
    check("the human's folder is kept", models[0]["save_path"], "upscale_models")
    check("along with the url", models[0].get("url"),
          "https://example.test/4x.pth")
    check("nothing dropped", dropped, [])


def test_the_legacy_source_and_dir_spellings_still_merge() -> None:
    """`_validate_models` accepts the older {source, dir} shape; the merge has to
    read it too or an old manifest loses its url on the first rescan."""
    graph = {"22": {"class_type": "LoraLoaderModelOnly",
                    "inputs": {"lora_name": "comic-style-lora-000002.safetensors"}}}
    previous = [{"filename": "comic-style-lora-000002.safetensors",
                 "dir": "loras", "source": "https://example.test/comic.safetensors"}]
    models, dropped = bp.merge_model_provenance(
        bp.derive_models_from_graph(graph), previous)
    check("legacy 'dir' matches the derived save_path", dropped, [])
    check("legacy 'source' becomes url", models[0].get("url"),
          "https://example.test/comic.safetensors")


def test_merging_is_idempotent() -> None:
    """The rescan route re-runs this on its own output. A second pass must not
    change anything, or every rescan rewrites the manifest for no reason."""
    derived = bp.derive_models_from_graph(REJECTED_GRAPH)
    once, _ = bp.merge_model_provenance(derived, [])
    twice, dropped = bp.merge_model_provenance(derived, once)
    check("second pass is identical", twice, once)
    check("and drops nothing", dropped, [])


def test_an_empty_or_absent_previous_is_fine() -> None:
    """Every blueprint authored so far has `models: []`."""
    derived = bp.derive_models_from_graph(REJECTED_GRAPH)
    for label, prev in (("None", None), ("empty list", []),
                        ("junk entries", ["nope", 7, None])):
        models, dropped = bp.merge_model_provenance(derived, prev)
        check(f"previous = {label} -> the derivation passes through",
              models, derived)
        check(f"previous = {label} -> nothing dropped", dropped, [])


def test_the_derived_entry_shape_is_what_validate_models_normalises() -> None:
    """The entry keys have to be the ones `_validate_models` reads and
    `blueprint_models` installs from — an invented key is silently discarded on
    the next load."""
    got = bp.derive_models_from_graph(REJECTED_GRAPH)
    check("exactly field/filename/save_path", sorted(got[0]),
          ["field", "filename", "save_path"])
    manifest = {"id": "t", "bindings": {}, "models": got}
    normalised = bp._validate_models("t", manifest)
    check("survives normalisation unchanged in count", len(normalised), len(got))
    check("filenames unchanged", names(normalised), names(got))
    check("save_paths unchanged", [m["save_path"] for m in normalised],
          [m["save_path"] for m in got])
    # Auto-install needs (url, save_path, base, filename). Two of those come off
    # the graph and two only a person can supply — so the derived keys plus the
    # merged provenance keys have to COVER the catalog tuple, or a blueprint can
    # never reach an installable state no matter what anyone fills in.
    derivable = {"field", "filename", "save_path"} | set(bp.MODEL_PROVENANCE_KEYS)
    check("nothing blueprint_models needs is unreachable",
          sorted(set(bm.CATALOG_KEYS) - derivable), [])
    merged, _ = bp.merge_model_provenance(
        bp.derive_models_from_graph(
            {"22": {"class_type": "LoraLoaderModelOnly",
                    "inputs": {"lora_name": "comic-style-lora-000002.safetensors"}}}),
        [{"filename": "comic-style-lora-000002.safetensors",
          "url": "https://example.test/comic.safetensors", "base": "FLUX.1"}])
    check("a derived+merged entry really is auto-installable",
          bm._is_installable(merged[0]), True)


# --------------------------------------------------------------------------
# Content digests: telling a real publish apart from a no-op
#
# `library_status` reported PRESENCE only — in_r2 / on_disk / loaded — so a
# blueprint whose bytes were last week's looked identical to one that had just
# landed. On 2026-09-08 that cost most of a session: a corrected graph was
# published, the render kept failing on the thing that had been fixed, and
# nothing anywhere could say which version the library held.
#
# The digest has to be CANONICAL, not a hash of the file bytes: `_uploadblueprint`
# stores `json.dumps(graph, indent=2)`, so the stored bytes never equal the bytes
# the author picked, and a byte hash would mismatch for a file that landed
# perfectly. That is the property these tests are really pinning.
# --------------------------------------------------------------------------
import hashlib
import json
import tempfile
from pathlib import Path

_GRAPH = {
    "11": {"class_type": "ImageScaleToTotalPixels",
           "inputs": {"image": ["10", 0], "upscale_method": "lanczos",
                      "megapixels": 1.0}},
    "10": {"class_type": "LoadImage", "inputs": {"image": "ref.png"}},
}


def _oneliner(obj) -> str:
    """The command the tooltip and the docs tell an author to run. If this ever
    stops agreeing with `canonical_digest`, the advice is a lie."""
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()[:12]


def test_the_digest_ignores_formatting_because_the_upload_reserialises() -> None:
    """The whole point. The author's file and the stored file differ in bytes
    (indent=2, key order) and MUST still agree."""
    as_author_saved = json.loads(json.dumps(_GRAPH, indent=4))
    as_tool_stored = json.loads(json.dumps(_GRAPH, indent=2, sort_keys=True))
    check("indentation does not move the digest",
          bp.canonical_digest(as_author_saved),
          bp.canonical_digest(as_tool_stored))
    check("and neither does key order",
          bp.canonical_digest({"a": 1, "b": 2}),
          bp.canonical_digest({"b": 2, "a": 1}))


def test_the_documented_command_reproduces_it_exactly() -> None:
    """An author compares the UI's digest to one they compute themselves. The
    two must be the same number, not merely 'a hash of the same thing'."""
    check("the one-liner in the tooltip/docs agrees",
          bp.canonical_digest(_GRAPH), _oneliner(_GRAPH))
    check("it is 12 hex chars", len(bp.canonical_digest(_GRAPH)), 12)


def test_the_real_change_from_that_session_moves_the_digest() -> None:
    """The exact edit that kept 'not landing': one added input on node 11."""
    fixed = json.loads(json.dumps(_GRAPH))
    fixed["11"]["inputs"]["resolution_steps"] = 64
    check_not_in("adding resolution_steps changes the digest",
                 bp.canonical_digest(fixed), [bp.canonical_digest(_GRAPH)])
    check("a value change is caught too, not just a new key",
          bp.canonical_digest({"x": 1}) == bp.canonical_digest({"x": 2}), False)


def test_an_authored_digest_cannot_impersonate_the_real_content() -> None:
    """`graph_sha` is ASSIGNED, never setdefault — otherwise a manifest could
    carry a hand-written value and the one field whose job is to be trustworthy
    would report whatever the file claimed."""
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / "fake_bp"
        d.mkdir()
        (d / "workflow.json").write_text(json.dumps(_GRAPH), encoding="utf-8")
        (d / "blueprint.json").write_text(json.dumps({
            "version": 1, "id": "fake_bp", "name": "Fake",
            "graph_sha": "deadbeefcafe",          # a lie, in the file
            "bindings": {"positive": {"node": "10", "field": "image"},
                         "seed": {"node": "11", "field": "megapixels"},
                         "output": {"node": "11"}},
        }), encoding="utf-8")
        loaded = bp._read_blueprint_dir(d)
        check("the blueprint still loads", bool(loaded), True)
        check("the digest is the real one, not the authored one",
              loaded["graph_sha"], bp.canonical_digest(_GRAPH))
        check("and meta carries the real one too",
              loaded["meta"]["graph_sha"], bp.canonical_digest(_GRAPH))
        check_not_in("the lie does not survive", "deadbeefcafe",
                     [loaded["graph_sha"], loaded["meta"]["graph_sha"]])


def test_a_digest_never_breaks_a_listing() -> None:
    """A digest is a convenience. Nothing unserialisable should be able to stop
    `library_status` or the manage list from rendering."""
    class Unserialisable:
        pass
    check("an unhashable value yields empty, not an exception",
          bp.canonical_digest({"bad": Unserialisable()}), "")


if __name__ == "__main__":
    for fn in (test_the_rejected_graph_now_declares_what_it_needs,
               test_nothing_that_is_not_a_file_is_ever_declared,
               test_the_same_lora_twice_is_declared_once,
               test_an_unmapped_field_gets_an_empty_save_path_not_a_guess,
               test_clip_name_is_resolved_by_class_not_by_field_alone,
               test_every_model_extension_is_recognised,
               test_ordering_is_deterministic,
               test_a_broken_graph_declares_nothing_instead_of_raising,
               test_reimport_keeps_the_provenance_a_person_added,
               test_an_old_entry_without_a_save_path_still_matches_on_filename,
               test_a_human_placed_an_unmappable_model_and_we_keep_that,
               test_the_legacy_source_and_dir_spellings_still_merge,
               test_merging_is_idempotent,
               test_an_empty_or_absent_previous_is_fine,
               test_the_derived_entry_shape_is_what_validate_models_normalises,
               test_the_digest_ignores_formatting_because_the_upload_reserialises,
               test_the_documented_command_reproduces_it_exactly,
               test_the_real_change_from_that_session_moves_the_digest,
               test_an_authored_digest_cannot_impersonate_the_real_content,
               test_a_digest_never_breaks_a_listing):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
