"""Offline guard for licence provenance (no R2, no ComfyUI).

Run:  PYTHONPATH=".;../_shared" py test_model_provenance.py   (from services/atlas-tool)

Every generated asset is stamped with the models that made it and the worst
commercial status among them (model_provenance.py, model_licences.json). The
stamp is only worth anything if it is RIGHT about the graphs we actually run,
so the fixtures below are the real builders' output and the filenames the repo
really references — not synthetic names chosen to pass.

The contract these assertions pin:
  * the built-in SDXL default is BLOCKED (gameIconInstitute LoRA + RMBG-2.0),
    with Juggernaut read as conditional, not clear;
  * the built-in FLUX default is BLOCKED (flux1-dev + its ae VAE);
  * a PuLID graph records InsightFace antelopev2 as an IMPLICIT weight — the
    node loads it with no field naming it — and is blocked by it;
  * first-match-wins ordering holds where it matters (redux before dev,
    toonout before birefnet, lightning LoRA before the Wan base);
  * a model the table does not know is "unknown", never "clear";
  * wires and non-model strings are never read as models;
  * provenance never raises, whatever the graph looks like;
  * _persist_variant writes the sidecar beside the variant, and removes a
    stale one when a render has no stamp;
  * Create Atlas stamps each composed region and the manifest summary.

ASCII only in the labels: a non-Latin-1 glyph raises UnicodeEncodeError on this
box's cp1252 console and aborts the whole suite.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

# Sandbox staging BEFORE importing the tool: BATCH_DIR / MANIFEST_DIR resolve
# out of it, and atlas_config.json is absent so the builders use _DEFAULTS.
_STAGING = tempfile.mkdtemp(prefix="provenance-")
os.environ["ATLAS_STAGING"] = _STAGING

from PIL import Image  # noqa: E402

import batch_atlas as ba  # noqa: E402
import blueprints  # noqa: E402
import model_provenance as mp  # noqa: E402
import ui_server as u  # noqa: E402

FAILED: list[str] = []
PASSED: list[str] = []

_STYLE = {"positive_prefix": "", "positive_suffix": "", "negative": ""}


def _say(text: str) -> None:
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def _by_value(prov: dict, value: str) -> dict:
    return next((m for m in prov["models"] if m["value"] == value), {})


def _id(value: str):
    return (mp.lookup(value) or {}).get("id")


# --------------------------------------------------------------------------
def test_builtin_sdxl_default_is_blocked() -> None:
    wf = ba.build_workflow({"name": "H1", "prompt": "a cherry", "pipeline": "sdxl",
                            "style_ref": "refs/a.png"}, _STYLE, "")
    prov = mp.provenance(wf, pipeline="sdxl")
    check("sdxl: juggernaut is conditional",
          _by_value(prov, ba._DEFAULTS["checkpoint"]).get("commercial"),
          "conditional")
    check("sdxl: gameIconInstitute LoRA is blocked",
          _by_value(prov, ba._DEFAULTS["lora"]).get("commercial"), "blocked")
    check("sdxl: RMBG-2.0 (enum, no extension) is found and blocked",
          _by_value(prov, "RMBG-2.0").get("commercial"), "blocked")
    check("sdxl: the IPAdapter preset resolves to the plus entry",
          _by_value(prov, "PLUS (high strength)").get("licence_id"),
          "ipadapter-plus-sdxl")
    check("sdxl: the preset's CLIP-ViT-H is recorded as implicit",
          _by_value(prov, "CLIP-ViT-H-14-laion2B-s32B-b79K").get("implicit"), True)
    check("sdxl: the asset is blocked", prov["commercial"], "blocked")
    check("sdxl: blocked_by names exactly the two",
          sorted(prov["blocked_by"]),
          sorted([ba._DEFAULTS["lora"], "RMBG-2.0"]))
    check("sdxl: stamp carries the pipeline", prov["pipeline"], "sdxl")
    check("sdxl: stamp carries the table date",
          prov["licences_checked"], mp.load_licences()["checked"])


def test_builtin_flux_default_is_blocked() -> None:
    wf = ba.build_workflow({"name": "H1", "prompt": "a cherry", "pipeline": "flux",
                            "style_ref": "refs/a.png"}, _STYLE, "")
    prov = mp.provenance(wf, pipeline="flux")
    check("flux: flux1-dev blocked",
          _by_value(prov, "flux1-dev.safetensors").get("licence_id"), "flux1-dev")
    check("flux: ae blocked", _by_value(prov, "ae.safetensors").get("commercial"),
          "blocked")
    check("flux: redux resolves to its own entry, not dev",
          _by_value(prov, "flux1-redux-dev.safetensors").get("licence_id"),
          "flux1-redux-dev")
    check("flux: t5 clear",
          _by_value(prov, "t5xxl_fp16.safetensors").get("commercial"), "clear")
    check("flux: the asset is blocked", prov["commercial"], "blocked")


PULID_GRAPH = {
    "2": {"class_type": "UNETLoader",
          "inputs": {"unet_name": "flux1-dev-fp8.safetensors",
                     "weight_dtype": "default"}},
    "22": {"class_type": "LoraLoaderModelOnly",
           "inputs": {"lora_name": "comic-style-lora-000002.safetensors",
                      "model": ["2", 0], "strength_model": 0.8}},
    "11": {"class_type": "DualCLIPLoader",
           "inputs": {"clip_name1": "t5xxl_fp8_e4m3fn.safetensors",
                      "clip_name2": "clip_l.safetensors", "type": "flux"}},
    "10": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
    "139": {"class_type": "PulidFluxModelLoader",
            "inputs": {"pulid_file": "pulid_flux_v0.9.1.safetensors"}},
    "140": {"class_type": "PulidFluxInsightFaceLoader",
            "inputs": {"provider": "CUDA"}},
    "141": {"class_type": "PulidFluxEvaClipLoader", "inputs": {}},
    "138": {"class_type": "ApplyPulidFlux",
            "inputs": {"model": ["22", 0], "pulid_flux": ["139", 0],
                       "eva_clip": ["141", 0], "face_analysis": ["140", 0],
                       "image": ["5", 0], "weight": 1.0}},
    "17": {"class_type": "SaveImage",
           "inputs": {"filename_prefix": "invisible_wall/test7/batch/naty",
                      "images": ["8", 0]}},
}


def test_pulid_graph_records_implicit_weights() -> None:
    prov = mp.provenance(PULID_GRAPH, pipeline="characterdesignertest3",
                         blueprint={"id": "characterdesignertest3",
                                    "meta": {"graph_sha": "abc123"}})
    ante = _by_value(prov, "antelopev2")
    check("pulid: antelopev2 is added though no field names it",
          (ante.get("implicit"), ante.get("commercial")), (True, "blocked"))
    check("pulid: the CUDA provider is not taken for a model name",
          _by_value(prov, "CUDA"), {})
    check("pulid: EVA-CLIP implicit + clear",
          (_by_value(prov, "EVA02-CLIP-L-14-336").get("implicit"),
           _by_value(prov, "EVA02-CLIP-L-14-336").get("commercial")),
          (True, "clear"))
    check("pulid: facexlib weights implicit + unknown",
          [_by_value(prov, v).get("commercial")
           for v in ("retinaface_resnet50", "bisenet")], ["unknown", "unknown"])
    check("pulid: the adapter itself is clear",
          _by_value(prov, "pulid_flux_v0.9.1.safetensors").get("licence_id"),
          "pulid-flux")
    check("pulid: the pod-trained LoRA is blocked",
          _by_value(prov, "comic-style-lora-000002.safetensors").get("commercial"),
          "blocked")
    check("pulid: asset blocked", prov["commercial"], "blocked")
    check("pulid: antelopev2 is among blocked_by", "antelopev2" in prov["blocked_by"],
          True)
    check("pulid: blueprint id + graph_sha recorded", prov["blueprint"],
          {"id": "characterdesignertest3", "graph_sha": "abc123"})
    check("pulid: the SaveImage prefix is not a model",
          _by_value(prov, "invisible_wall/test7/batch/naty"), {})


CLEAN_WAN = {
    "172": {"class_type": "VAELoader", "inputs": {"vae_name": "wan_2.1_vae.safetensors"}},
    "173": {"class_type": "CLIPLoader",
            "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                       "type": "wan"}},
    "175": {"class_type": "UNETLoader",
            "inputs": {"unet_name": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"}},
    "179": {"class_type": "LoraLoaderModelOnly",
            "inputs": {"lora_name":
                       "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
                       "model": ["175", 0]}},
    "202": {"class_type": "BiRefNetRMBG",
            "inputs": {"model": "BiRefNet-general", "image": ["8", 0]}},
}

CLEAN_QWEN = {
    "1": {"class_type": "UNETLoader",
          "inputs": {"unet_name": "qwen_image_2512_fp8_e4m3fn.safetensors"}},
    "2": {"class_type": "CLIPLoader",
          "inputs": {"clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors"}},
    "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
}


def test_clean_graphs_are_clear() -> None:
    wan = mp.provenance(CLEAN_WAN, pipeline="video")
    check("wan + BiRefNet-general: clear", wan["commercial"], "clear")
    check("wan: nothing blocked or unknown", (wan["blocked_by"], wan["unknown"]),
          ([], []))
    check("qwen: clear", mp.provenance(CLEAN_QWEN, pipeline="x")["commercial"], "clear")
    schnell = {
        "1": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": "flux1-schnell-fp8.safetensors"}},
        "2": {"class_type": "BiRefNetRMBG", "inputs": {"model": "BiRefNet_lite"}},
    }
    check("schnell checkpoint + BiRefNet: clear",
          mp.provenance(schnell, pipeline="x")["commercial"], "clear")


def test_the_shipped_wan_flipbook_reads_unknown_via_toonout() -> None:
    """The real flipbook blueprint defaults to BiRefNet_toonout, whose fine-tune
    licence is unrecorded — so the honest answer is unknown, not clear."""
    g = json.loads((Path(__file__).resolve().parent / "blueprints_src"
                    / "wan22_i2v_flipbook" / "workflow.json").read_text(encoding="utf-8"))
    prov = mp.provenance(g, pipeline="video")
    check("flipbook: unknown", prov["commercial"], "unknown")
    check("flipbook: toonout is the only unknown", prov["unknown"], ["BiRefNet_toonout"])


def test_unknown_filename_is_unknown() -> None:
    g = {"1": {"class_type": "CheckpointLoaderSimple",
               "inputs": {"ckpt_name": "mystery_mix_v7.safetensors"}},
         "2": {"class_type": "VAELoader", "inputs": {"vae_name": "sdxl_vae.safetensors"}}}
    prov = mp.provenance(g, pipeline="x")
    check("unmatched model -> unknown", _by_value(prov, "mystery_mix_v7.safetensors"),
          {"value": "mystery_mix_v7.safetensors", "class_type": "CheckpointLoaderSimple",
           "field": "ckpt_name", "licence_id": None, "licence": "",
           "commercial": "unknown", "licence_url": ""})
    check("asset unknown (worse than clear)", prov["commercial"], "unknown")
    check("listed in unknown", prov["unknown"], ["mystery_mix_v7.safetensors"])
    g["3"] = {"class_type": "RMBG", "inputs": {"model": "RMBG-2.0"}}
    check("blocked outranks unknown",
          mp.provenance(g, pipeline="x")["commercial"], "blocked")


def test_links_and_non_models_are_ignored() -> None:
    g = {"1": {"class_type": "KSampler",
               "inputs": {"model": ["4", 0], "sampler_name": "euler",
                          "scheduler": "normal", "seed": 5}},
         "2": {"class_type": "CLIPTextEncode",
               "inputs": {"text": "made of model.safetensors glass",
                          "clip": ["4", 1]}},
         "3": {"class_type": "RMBG", "inputs": {"model": ["9", 0]}},
         "4": {"class_type": "CheckpointLoaderSimple",
               "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}}}
    got = mp.models_in_workflow(g)
    check("only the checkpoint is found", [m["value"] for m in got],
          ["sd_xl_base_1.0.safetensors"])
    dup = {"1": {"class_type": "LoraLoader", "inputs": {"lora_name": "x/Y.safetensors"}},
           "2": {"class_type": "LoraLoader", "inputs": {"lora_name": "x/y.safetensors"}}}
    check("deduped by value", len(mp.models_in_workflow(dup)), 1)
    check("a subdirectory value matches on its basename",
          _id("loras/juggernautXL_v9.safetensors"), "juggernaut-xl")


def test_never_raises() -> None:
    for label, g in (("None", None), ("list", [1, 2]), ("str", "x"),
                     ("node not a dict", {"1": "nope"}),
                     ("inputs not a dict", {"1": {"class_type": "X", "inputs": [1]}}),
                     ("no class_type", {"1": {"inputs": {"a": "b.safetensors"}}}),
                     ("non-str keys", {1: {"class_type": None, "inputs": {2: 3}}})):
        try:
            prov = mp.provenance(g, pipeline="x")
            ok = isinstance(prov, dict) and prov.get("commercial") in mp.COMMERCIAL_VALUES
        except Exception as e:  # noqa: BLE001
            ok = False
            _say(f"       raised {e!r}")
        check(f"odd graph ({label}) yields a stamp", ok, True)
    check("an empty graph is unknown, not clear",
          mp.provenance({}, pipeline="x")["commercial"], "unknown")


# Filenames the repo actually references, and the entry each must land on.
EXPECTED_IDS = {
    "flux1-dev-fp8.safetensors": "flux1-dev",
    "flux1-dev.safetensors": "flux1-dev",
    "flux1-redux-dev.safetensors": "flux1-redux-dev",
    "flux1-schnell-fp8.safetensors": "flux1-schnell",
    "flux1-krea-dev_fp8_scaled.safetensors": "flux1-krea-dev",
    "ae.safetensors": "flux1-ae",
    "t5xxl_fp8_e4m3fn.safetensors": "t5-v1_1-xxl",
    "t5xxl_fp16.safetensors": "t5-v1_1-xxl",
    "clip_l.safetensors": "clip-l",
    "sigclip_vision_patch14_384.safetensors": "siglip-so400m",
    "umt5_xxl_fp8_e4m3fn_scaled.safetensors": "umt5-xxl",
    "wan_2.1_vae.safetensors": "wan2.2",
    "wan2.2_vae.safetensors": "wan2.2",
    "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors": "wan2.2",
    "wan2.2_ti2v_5B_fp16.safetensors": "wan2.2",
    "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors": "wan2.2-lightning-lora",
    "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors": "wan2.2-lightning-lora",
    "BiRefNet_toonout": "birefnet-toonout",
    "BiRefNet-general": "birefnet",
    "BiRefNet-matting": "birefnet",
    "BiRefNet_lite": "birefnet",
    "RMBG-2.0": "rmbg-2.0",
    "rmbg-1.4": "rmbg-1.4",
    "INSPYRENET": "inspyrenet",
    "BEN2": "ben2",
    "flux-2-klein-base-4b-fp8.safetensors": "flux2-klein-4b",
    "flux-2-klein-9b-fp8.safetensors": "flux2-klein-9b",
    "flux2_vae.safetensors": "flux2-vae",
    "qwen_3_4b.safetensors": "qwen3-4b",
    "pulid_flux2_klein_v2.safetensors": "pulid-flux2-klein",
    "pulid_flux_v0.9.1.safetensors": "pulid-flux",
    "qwen_image_2512_fp8_e4m3fn.safetensors": "qwen-image",
    "qwen_image_layered_bf16.safetensors": "qwen-image",
    "qwen_image_vae.safetensors": "qwen-image",
    "qwen_2.5_vl_7b_fp8_scaled.safetensors": "qwen2.5-vl-7b",
    "juggernautXL_ragnarokBy.safetensors": "juggernaut-xl",
    "gameIconInstitute3d_v10.safetensors": "game-icon-institute-3d",
    "comic-style-lora-000002.safetensors": "comic-style-lora",
    "sd_xl_base_1.0.safetensors": "sdxl-base-1.0",
    "sdxl_vae.safetensors": "sdxl-vae",
    "controlnet-union-sdxl-1.0-promax.safetensors": "controlnet-union-sdxl-promax",
    "4x-UltraSharp.pth": "4x-ultrasharp",
    "RealESRGAN_x4plus.pth": "real-esrgan",
    "PLUS (high strength)": "ipadapter-plus-sdxl",
    "CLIP-ViT-H-14-laion2B-s32B-b79K": "clip-vit-h-14-laion2b",
    "gpt-image-1": "gpt-image",
    "antelopev2": "insightface-antelopev2",
    "EVA02-CLIP-L-14-336": "eva02-clip-l-336",
    "retinaface_resnet50": "facexlib",
    "bisenet": "facexlib",
}


def test_every_repo_filename_hits_the_right_entry() -> None:
    for value, want in EXPECTED_IDS.items():
        check(f"{value} -> {want}", _id(value), want)
    check("flux-2-klein 4B is clear",
          (mp.lookup("flux-2-klein-base-4b-fp8.safetensors") or {}).get("commercial"),
          "clear")


def test_licence_table_schema() -> None:
    table = mp.load_licences()
    models = table.get("models") or []
    check("table is non-empty", bool(models), True)
    check("table carries a checked date", bool(table.get("checked")), True)
    ids = [e.get("id") for e in models]
    check("ids are unique", len(ids), len(set(ids)))
    for e in models:
        eid = e.get("id")
        check(f"{eid}: has id/match/licence/commercial",
              all(e.get(k) for k in ("id", "match", "licence", "commercial")), True)
        check(f"{eid}: commercial in the allowed set",
              e.get("commercial") in mp.COMMERCIAL_VALUES, True)
        check(f"{eid}: match is a list of strings",
              isinstance(e.get("match"), list)
              and all(isinstance(p, str) and p for p in e["match"]), True)
        # Every entry must be reachable: some pattern of its own must resolve
        # to IT, not to an earlier entry that shadows it. A glob is probed with
        # its wildcards filled in.
        probes = [p.replace("*", "x").replace("?", "x") for p in e["match"]]
        check(f"{eid}: not shadowed by an earlier entry",
              any(_id(p) == eid for p in probes), True)


def test_extension_set_matches_blueprints() -> None:
    check("MODEL_FILE_EXTS mirrors blueprints.MODEL_FILE_EXTS",
          mp.MODEL_FILE_EXTS, blueprints.MODEL_FILE_EXTS)


def test_persist_variant_writes_the_sidecar() -> None:
    puts: list[tuple] = []
    real_put = ba.storage.put
    ba.storage.put = lambda key, body, ct=None, **kw: puts.append((key, ct))  # noqa: E731
    try:
        prov = mp.provenance(PULID_GRAPH, pipeline="p")
        ba._persist_variant("P1", "P1_00001_.png", b"png-bytes", provenance=prov)
        side = ba.BATCH_DIR / "P1_00001_.provenance.json"
        check("sidecar written next to the variant", side.exists(), True)
        check("sidecar round-trips", json.loads(side.read_text(encoding="utf-8")), prov)
        check("variant itself still written",
              (ba.BATCH_DIR / "P1_00001_.png").read_bytes(), b"png-bytes")
        r2_prefix = ba.project_paths.resolve().get("r2_project_prefix")
        if r2_prefix:
            check("sidecar mirrored to batch/ as json",
                  (f"{r2_prefix}/batch/P1_00001_.provenance.json", "application/json")
                  in puts, True)
        ba._persist_variant("P1", "P1_00001_.png", b"png-2")
        check("a render without a stamp removes the stale sidecar",
              side.exists(), False)
        ba.storage.put = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("R2 down"))
        ba._persist_variant("P1", "P1_00002_.png", b"png-3", provenance=prov)
        check("an R2 failure does not stop the local sidecar",
              (ba.BATCH_DIR / "P1_00002_.provenance.json").exists(), True)
    finally:
        ba.storage.put = real_put


def test_compose_stamps_regions_and_summary() -> None:
    batch = ba.BATCH_DIR
    batch.mkdir(parents=True, exist_ok=True)
    for name in ("C1", "C2"):
        Image.new("RGBA", (4, 4)).save(batch / f"{name}_00001_.png")
    clear = mp.provenance(CLEAN_QWEN, pipeline="qwen")
    (batch / "C1_00001_.provenance.json").write_text(json.dumps(clear), encoding="utf-8")
    man = Path(tempfile.mkdtemp()) / "atlas_manifest_prov.json"
    man.write_text(json.dumps({
        "atlas": {"width": 8, "height": 8}, "style": {},
        "regions": [
            {"name": "C1", "x": 0, "y": 0, "w": 4, "h": 4, "prompt": "keep me"},
            {"name": "C2", "x": 4, "y": 0, "w": 4, "h": 4},
            {"name": "C3", "x": 0, "y": 4, "w": 4, "h": 4,
             "provenance": {"commercial": "clear", "stale": True}},
        ]}), encoding="utf-8")
    real_mp, real_mirror = u.manifest_path, u._mirror
    u.manifest_path = lambda: man                                 # noqa: E731
    u._mirror = lambda p: None                                    # noqa: E731
    try:
        line = u.stamp_compose_provenance(man)
        m = json.loads(man.read_text(encoding="utf-8"))
        regs = {r["name"]: r for r in m["regions"]}
        check("C1 carries its sidecar's verdict",
              regs["C1"]["provenance"]["commercial"], "clear")
        check("C1 names the file it composes",
              regs["C1"]["provenance"]["file"], "C1_00001_.png")
        check("C1 keeps its other fields", regs["C1"]["prompt"], "keep me")
        check("C1's manifest copy keeps the licence ids but not the licence text",
              sorted(regs["C1"]["provenance"]["models"][0]),
              ["commercial", "licence_id", "value"])
        check("C2 (no sidecar) is unknown with a reason",
              (regs["C2"]["provenance"]["commercial"],
               "no provenance sidecar" in regs["C2"]["provenance"]["reason"]),
              ("unknown", True))
        check("C3 (no art, composes nothing) loses its stale stamp",
              "provenance" in regs["C3"], False)
        s = m["provenance_summary"]
        check("summary: worst-of", s["commercial"], "unknown")
        check("summary: one unknown region", s["regions_unknown"], 1)
        check("summary: nothing blocked", s["blocked_by"], [])
        check("a log line is returned", "commercial=unknown" in (line or ""), True)
        before = man.read_text(encoding="utf-8")
        u.stamp_compose_provenance(man)
        check("a second stamp with nothing changed does not rewrite",
              man.read_text(encoding="utf-8"), before)
    finally:
        u.manifest_path, u._mirror = real_mp, real_mirror


if __name__ == "__main__":
    for fn in (test_builtin_sdxl_default_is_blocked,
               test_builtin_flux_default_is_blocked,
               test_pulid_graph_records_implicit_weights,
               test_clean_graphs_are_clear,
               test_the_shipped_wan_flipbook_reads_unknown_via_toonout,
               test_unknown_filename_is_unknown,
               test_links_and_non_models_are_ignored,
               test_never_raises,
               test_every_repo_filename_hits_the_right_entry,
               test_licence_table_schema,
               test_extension_set_matches_blueprints,
               test_persist_variant_writes_the_sidecar,
               test_compose_stamps_regions_and_summary):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
