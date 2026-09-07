"""Offline guard for the Settings-panel save/merge contract (no R2, no ComfyUI).

Run:  PYTHONPATH=../_shared py test_config_defaults.py   (from services/atlas-tool)

The outage this exists for, in full, because every step looked harmless alone:

  1. `ui_server.load_config` reads atlas_config.json RAW — it does NOT merge
     `batch_atlas._DEFAULTS`. So a key the file predates renders as an EMPTY box
     in the Settings panel even though the render would have used 3.5.
  2. `cfgData()` posts EVERY `[data-cfg]` field, blanks included.
  3. The save handler's global branch stored that blank verbatim
     (`cfg[k] = _num(v)`; `_num("")` returns `""`). The per-atlas, geometry and
     deploy branches each had an explicit blank rule — the global branch never
     did.
  4. `batch_atlas.load_config` then let `""` SHADOW the numeric default.
  5. Every FLUX render died at:

         File "batch_atlas.py", line 2278, in build_workflow_flux
           "inputs": {"conditioning": pos_cond, "guidance": float(FLUX_GUIDANCE)}
         ValueError: could not convert string to float: ''

One Save on a project whose config predated a field was enough to kill
generation for that project, and nothing in the UI showed why.

The contract these assertions pin:
  * a blank NUMERIC never shadows its default (and an already-poisoned config
    heals itself on load — no migration);
  * a blank TEXT still means blank, because a blank `flux_controlnet` /
    `flux_redux_style_model` deliberately DISABLES that optional node;
  * saving a blank numeric DROPS the key rather than storing "".

ASCII only in the labels: a non-Latin-1 glyph raises UnicodeEncodeError on this
box's cp1252 console and aborts the whole suite.
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path

import batch_atlas as ba
import ui_server as u

FAILED: list[str] = []
PASSED: list[str] = []


def _say(text: str) -> None:
    """Print through this console's encoding, whatever it is — a FAILING
    assertion may dump text carrying glyphs cp1252 cannot encode, and the
    diagnostic must not destroy the diagnosis."""
    enc = sys.stdout.encoding or "utf-8"
    print(text.encode(enc, errors="replace").decode(enc, errors="replace"))


def check(label: str, got, want) -> None:
    ok = got == want
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       got  {got!r}\n       want {want!r}")


def check_in(label: str, needle: str, haystack: str) -> None:
    ok = needle in haystack
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       {needle!r} not found in:\n       {haystack!r}")


def check_not_in(label: str, needle: str, haystack: str) -> None:
    ok = needle not in haystack
    _say(f"{'ok  ' if ok else 'FAIL'} {label}")
    (PASSED if ok else FAILED).append(label)
    if not ok:
        _say(f"       {needle!r} unexpectedly found in:\n       {haystack!r}")


def load_with(doc: dict) -> dict:
    """`batch_atlas.load_config()` against a config file holding `doc`."""
    real = ba._config_paths
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "atlas_config.json"
        p.write_text(json.dumps(doc), encoding="utf-8")
        ba._config_paths = lambda: [p]        # type: ignore[assignment]
        try:
            return ba.load_config()
        finally:
            ba._config_paths = real           # type: ignore[assignment]


# --------------------------------------------------------------------------
# 1. The exact production failure
# --------------------------------------------------------------------------
def test_the_poisoned_config_from_the_outage_renders_again() -> None:
    # Verbatim shape of the config that produced the traceback above.
    cfg = load_with({
        "pipeline": "flux",
        "flux_guidance": "",
        "flux_steps": "",
        "flux_lora_strength": "",
        "flux_redux_strength": "",
        "ksampler_cfg": "",
        "ksampler_steps": "",
        "gen_width": "",
    })
    check("flux_guidance falls back to the default", cfg["flux_guidance"], 3.5)
    check("flux_steps falls back", cfg["flux_steps"], 20)
    check("flux_lora_strength falls back", cfg["flux_lora_strength"], 0.9)
    check("flux_redux_strength falls back", cfg["flux_redux_strength"], 1.0)
    check("ksampler_cfg falls back", cfg["ksampler_cfg"], 8.5)
    check("gen_width falls back", cfg["gen_width"], 1024)
    # The line that actually raised.
    try:
        guidance = float(cfg["flux_guidance"])
        crashed = ""
    except ValueError as e:  # noqa: BLE001 — this IS the regression
        guidance, crashed = None, str(e)
    check("float(FLUX_GUIDANCE) no longer raises", crashed, "")
    check("and is the number the graph needs", guidance, 3.5)
    check("int(FLUX_STEPS) works too", int(cfg["flux_steps"]), 20)


def test_a_real_value_still_wins() -> None:
    cfg = load_with({"flux_guidance": 4.5, "flux_steps": 28,
                     "padding_pct": 0, "credits_eur_rate": 0})
    check("an authored float is kept", cfg["flux_guidance"], 4.5)
    check("an authored int is kept", cfg["flux_steps"], 28)
    # 0 is a REAL value, not a blank — it must never be mistaken for unset.
    check("a zero is kept, not treated as blank", cfg["padding_pct"], 0)
    check("a zero rate is kept", cfg["credits_eur_rate"], 0)


def test_a_blank_required_model_falls_back_too() -> None:
    """The second half of the same outage, reported a day later:

        /prompt rejected (400): vae_name: '' not in ['ae.safetensors', ...]

    `flux_vae` is TEXT, so the numeric-only rule let `""` through; it reached
    the graph and cost a queued RunPod job and a cold start to be told a
    required field was empty. A required model has no meaningful blank either.
    """
    cfg = load_with({"pipeline": "flux", "flux_vae": "", "flux_unet": "",
                     "flux_clip_t5": "", "flux_clip_l": "",
                     "flux_sampler": "", "flux_scheduler": "",
                     "flux_weight_dtype": "", "checkpoint": "",
                     "rmbg_model": ""})
    check("flux_vae falls back (the field that failed)",
          cfg["flux_vae"], ba._DEFAULTS["flux_vae"])
    check("flux_unet falls back", cfg["flux_unet"], ba._DEFAULTS["flux_unet"])
    check("flux_clip_t5 falls back",
          cfg["flux_clip_t5"], ba._DEFAULTS["flux_clip_t5"])
    check("flux_sampler falls back",
          cfg["flux_sampler"], ba._DEFAULTS["flux_sampler"])
    check("checkpoint falls back", cfg["checkpoint"], ba._DEFAULTS["checkpoint"])
    check("rmbg_model falls back", cfg["rmbg_model"], ba._DEFAULTS["rmbg_model"])
    # ...and the OPTIONAL ones in the very same config stay blank.
    check("flux_controlnet is still optional",
          load_with({"flux_controlnet": ""})["flux_controlnet"], "")
    check("flux_checkpoint is still optional",
          load_with({"flux_checkpoint": ""})["flux_checkpoint"], "")
    check("flux_redux_style_model is still optional",
          load_with({"flux_redux_style_model": ""})["flux_redux_style_model"], "")
    check("an authored required value still wins",
          load_with({"flux_vae": "flux2-vae.safetensors"})["flux_vae"],
          "flux2-vae.safetensors")


def test_a_graph_with_an_empty_model_name_is_never_submitted() -> None:
    """The guard that makes this class of bug cost nothing. The graph below is
    the shape build_workflow_flux emits, with node "3" exactly as the GPU
    rejected it."""
    good = {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": "flux1-dev.safetensors",
                         "weight_dtype": "fp8_e4m3fn"}},
        "3": {"class_type": "VAELoader",
              "inputs": {"vae_name": "ae.safetensors"}},
        "11": {"class_type": "CLIPTextEncode",
               "inputs": {"clip": ["2", 0], "text": ""}},
    }
    ba.assert_models_named(good)      # must not raise
    check("a complete graph passes", True, True)
    check("an empty NEGATIVE PROMPT is not a model name and is left alone",
          good["11"]["inputs"]["text"], "")

    bad = json.loads(json.dumps(good))
    bad["3"]["inputs"]["vae_name"] = ""
    try:
        ba.assert_models_named(bad)
        msg = "(no error)"
    except RuntimeError as e:
        msg = str(e)
    check("the empty vae_name is refused", msg != "(no error)", True)
    check_in("the message names the node", "node 3", msg)
    check_in("and the ComfyUI input", "vae_name", msg)
    check_in("and the SETTING to fix, not just the node", "flux_vae", msg)
    check_in("and says nothing was submitted", "retry", msg)

    # A wire (list) is not a name, and must never be mistaken for one.
    wired = {"5": {"class_type": "VAEDecode",
                   "inputs": {"samples": ["4", 0], "vae": ["3", 0]}}}
    ba.assert_models_named(wired)
    check("a node wired to another node passes", True, True)


def test_a_wrong_family_vae_is_refused_before_the_gpu_runs() -> None:
    """2026-09-04: a FLUX render sampled for 117s on the local 4070, then died
    at the LAST node with

        VAEDecode: Given groups=1, weight of size [64, 4, 3, 3], expected
        input[1, 16, 128, 128] to have 4 channels, but got 16 channels instead

    The Settings FLUX VAE was `taesdxl` - ComfyUI's tiny SDXL autoencoder, one
    row from `taef1` in the dropdown. It IS a valid VAELoader name, so the
    existence preflight waved it through to the GPU. Only the FAMILY was wrong,
    and nothing checked that."""
    check("taesdxl is caught for FLUX", ba.wrong_family_vae("taesdxl"), 4)
    check("so is taesd", ba.wrong_family_vae("taesd"), 4)
    check("taef1 (tiny FLUX) is fine", ba.wrong_family_vae("taef1"), None)
    check("taesd3 is 16-channel too", ba.wrong_family_vae("taesd3"), None)
    check("the real FLUX autoencoder is fine",
          ba.wrong_family_vae("ae.safetensors"), None)
    check("case and stray spaces do not smuggle it past",
          ba.wrong_family_vae("  TAESDXL "), 4)
    # The guard must stay narrow: it only knows ComfyUI's four built-in tiny
    # AEs. Refusing every unrecognised name would block flux2-vae.safetensors,
    # ae.sft, and whatever a user names their own file.
    check("an unknown filename is left to ComfyUI",
          ba.wrong_family_vae("flux2-vae.safetensors"), None)
    check("a blank name belongs to the empty-name guard, not this one",
          ba.wrong_family_vae(""), None)
    check("and the table reads in the other direction too",
          ba.wrong_family_vae("taef1", latent_channels=4), 16)

    # End to end through preflight_models, with ComfyUI absent so the existence
    # loop skips every check and only the family guard can speak.
    saved = {k: getattr(ba, k) for k in
             ("PIPELINE", "FLUX_VAE", "FLUX_CHECKPOINT", "_available")}
    ba.PIPELINE, ba.FLUX_VAE, ba.FLUX_CHECKPOINT = "flux", "taesdxl", ""
    ba._available = lambda node, field: None
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            ba.preflight_models([{"name": "naty"}])
        code = "(no exit)"
    except SystemExit as e:
        code = e.code
    finally:
        for key, value in saved.items():
            setattr(ba, key, value)
    out = buf.getvalue()
    check("the render stops before a job is queued", code, 2)
    check_in("the message names the SETTING to fix", "flux_vae", out)
    check_in("and the value that is wrong", "taesdxl", out)
    check_in("and names a working replacement", "ae.safetensors", out)
    check_in("and explains the channel mismatch", "16 channels", out)

    # The all-in-one checkpoint carries its own VAE, so there is no name to be
    # wrong about - the guard must not fire and strand that path.
    saved_ck = (ba.PIPELINE, ba.FLUX_VAE, ba.FLUX_CHECKPOINT, ba._available)
    ba.PIPELINE, ba.FLUX_VAE = "flux", "taesdxl"
    ba.FLUX_CHECKPOINT = "flux1-schnell-fp8.safetensors"
    ba._available = lambda node, field: None
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            ba.preflight_models([{"name": "naty"}])
        raised = False
    except SystemExit:
        raised = True
    finally:
        (ba.PIPELINE, ba.FLUX_VAE,
         ba.FLUX_CHECKPOINT, ba._available) = saved_ck
    check("the all-in-one checkpoint path is exempt", raised, False)


def test_blank_text_still_means_blank() -> None:
    # Documented behaviour: blank disables that optional node. If the fix had
    # been "no empty value ever shadows a default", Redux could never be
    # switched off (its default is a real model name).
    cfg = load_with({"flux_controlnet": "", "flux_redux_style_model": "",
                     "flux_lora": "", "mockup_image": "", "lora": ""})
    check("blank flux_controlnet stays blank", cfg["flux_controlnet"], "")
    check("blank flux_redux_style_model stays blank (disables Redux)",
          cfg["flux_redux_style_model"], "")
    check("blank flux_lora stays blank", cfg["flux_lora"], "")
    check("blank lora stays blank", cfg["lora"], "")
    check("a text default is still there when the key is absent",
          load_with({})["flux_redux_style_model"],
          ba._DEFAULTS["flux_redux_style_model"])


def test_blank_shadows_default_is_precise() -> None:
    check("blank + numeric default = shadowed",
          ba.blank_shadows_default("flux_guidance", ""), True)
    check("whitespace counts as blank",
          ba.blank_shadows_default("flux_guidance", "   "), True)
    check("a real value is not blank",
          ba.blank_shadows_default("flux_guidance", "3.5"), False)
    check("zero is not blank", ba.blank_shadows_default("padding_pct", 0), False)
    check("blank + OPTIONAL text default = left alone",
          ba.blank_shadows_default("flux_controlnet", ""), False)
    check("blank + REQUIRED model = shadowed",
          ba.blank_shadows_default("flux_vae", ""), True)
    check("a real model name is not blank",
          ba.blank_shadows_default("flux_vae", "ae.safetensors"), False)
    check("an unknown key is left alone",
          ba.blank_shadows_default("not_a_setting", ""), False)


# --------------------------------------------------------------------------
# 2. The save path stops writing the poison
# --------------------------------------------------------------------------
def test_saving_a_blank_numeric_drops_the_key() -> None:
    cfg = {"flux_guidance": 3.5, "flux_steps": 20}
    u.apply_global_edit(cfg, "flux_guidance", "")
    check("a blank numeric is dropped, not stored as ''",
          "flux_guidance" in cfg, False)
    check("its neighbour is untouched", cfg["flux_steps"], 20)
    # Dropped => the default applies again.
    check("and the dropped key reads as its default",
          load_with(cfg)["flux_guidance"], 3.5)

    u.apply_global_edit(cfg, "flux_steps", "28")
    check("a typed int is stored as an int", cfg["flux_steps"], 28)
    u.apply_global_edit(cfg, "flux_guidance", "4.5")
    check("a typed float is stored as a float", cfg["flux_guidance"], 4.5)

    # OPTIONAL text keys keep blank-means-blank on save, too.
    cfg2 = {"flux_controlnet": "some-cn.safetensors"}
    u.apply_global_edit(cfg2, "flux_controlnet", "")
    check("a blank OPTIONAL text key IS stored blank (disables the node)",
          cfg2, {"flux_controlnet": ""})
    # A REQUIRED one is dropped so the default applies.
    cfg3 = {"flux_vae": "ae.safetensors"}
    u.apply_global_edit(cfg3, "flux_vae", "")
    check("a blank REQUIRED model is dropped, not stored", cfg3, {})
    check("so it reads as its default again",
          load_with(cfg3)["flux_vae"], ba._DEFAULTS["flux_vae"])
    # And the panel stops OFFERING a blank for a required field.
    out = u._control_html("flux_vae", "text", "ae.safetensors",
                          {("VAELoader", "vae_name"): ["ae.safetensors",
                                                       "flux2-vae.safetensors"]})
    check_not_in("no '(blank - none)' choice on a required model",
                 "blank", out)
    check_in("it offers the default instead", "(default: ae.safetensors)", out)
    opt = u._control_html("flux_controlnet", "text", "",
                          {("ControlNetLoader", "control_net_name"): ["a.pth"]})
    check_in("an OPTIONAL model still offers a blank", "none", opt)


def test_a_poisoned_config_heals_on_the_next_save() -> None:
    # What the user's live config looks like right now.
    poisoned = {"pipeline": "flux", "flux_guidance": "", "flux_steps": ""}
    # The panel re-posts every field; the blanks now drop instead of persisting.
    for k, v in dict(poisoned).items():
        u.apply_global_edit(poisoned, k, v)
    check("the empty numerics are gone from the file",
          sorted(poisoned), ["pipeline"])
    check("pipeline survived", poisoned["pipeline"], "flux")


# --------------------------------------------------------------------------
# 3. The invariant both halves of the fix rest on
# --------------------------------------------------------------------------
def test_every_numeric_field_has_a_numeric_default() -> None:
    """`apply_global_edit` decides 'numeric' from CONFIG_FIELDS, while
    `blank_shadows_default` decides it from `_DEFAULTS`. If those two ever
    disagree, a field is dropped on save and then has no default to fall back
    to — blank forever. Geometry keys live on the manifest, not the config."""
    mismatched = []
    for key in sorted(u.NUMERIC_CONFIG_KEYS):
        if key in u._ATLAS_GEOM_KEYS:
            continue
        d = ba._DEFAULTS.get(key)
        if isinstance(d, bool) or not isinstance(d, (int, float)):
            mismatched.append((key, d))
    check("every CONFIG_FIELDS number has a numeric batch_atlas default",
          mismatched, [])
    check("run_on is text, so a blank there is kept (= service default)",
          "run_on" in u.NUMERIC_CONFIG_KEYS, False)


def test_per_atlas_inherit_label_names_the_real_global() -> None:
    # "(inherit global: )" claimed the global was EMPTY while the render used
    # 1024 — the same lie as the blank box, one level down.
    check("an unset global resolves to the engine default",
          u.effective_global({}, "gen_width"), "1024")
    check("a blank stored global resolves too",
          u.effective_global({"gen_width": ""}, "gen_width"), "1024")
    check("an authored global still wins",
          u.effective_global({"gen_width": 768}, "gen_width"), "768")
    check("a key with no default stays empty",
          u.effective_global({}, "mockup_image"), "")
    # A numeric per-atlas field renders as an <input>, so the inherit hint
    # rides the placeholder; blank_label only shows on the <select> fields.
    gv = u.effective_global({}, "gen_width")
    out = u._control_html("gen_width", "number", "", {}, allow_blank=True,
                          blank_label=f"(inherit global: {gv})",
                          placeholder=f"global: {gv}")
    check("the numeric input's placeholder names the global",
          'placeholder="global: 1024"' in out, True)
    # A model field DOES render a <select>, so there the blank option carries it.
    out = u._control_html("rmbg_model", "text", "", {"x": None},
                          allow_blank=True,
                          blank_label=f"(inherit global: "
                                      f"{u.effective_global({}, 'rmbg_model')})")
    check("the select's blank option names the global",
          f"(inherit global: {ba._DEFAULTS['rmbg_model']})" in out
          or '<input data-cfg="rmbg_model"' in out, True)


def test_an_empty_numeric_box_shows_its_default() -> None:
    check("empty numeric box advertises the default",
          u.default_placeholder("flux_guidance", "number", ""), "default: 3.5")
    check("a filled box says nothing",
          u.default_placeholder("flux_guidance", "number", 4.5), "")
    check("a text field gets no default placeholder",
          u.default_placeholder("flux_controlnet", "text", ""), "")
    html_out = u._control_html("flux_guidance", "number", "", {},
                               placeholder=u.default_placeholder(
                                   "flux_guidance", "number", ""))
    check("and it reaches the rendered input",
          'placeholder="default: 3.5"' in html_out, True)

@contextlib.contextmanager
def comfy_declaring(classes, *, transport: str = "http"):
    """Stand in for a live ComfyUI that declares exactly `classes`.

    `/object_info/<cls>` answers `{cls: {...}}` for a class it has and `{}` for
    one it does not — the real shape, confirmed against a running 8188 (an
    absent class returns `{}`, not a 404). `probed` records every class asked
    for, so the caching claim is testable rather than asserted."""
    probed: list[str] = []

    def fake_get(path: str) -> dict:
        cls = path.rsplit("/", 1)[-1]
        probed.append(cls)
        return {cls: {"input": {}}} if cls in set(classes) else {}

    real_get, real_alive, real_tx = ba.comfy_get, ba._comfy_alive, ba.COMFY_TRANSPORT
    ba.comfy_get = fake_get                    # type: ignore[assignment]
    ba._comfy_alive = lambda: True             # type: ignore[assignment]
    ba.COMFY_TRANSPORT = transport
    ba._CLASS_PRESENT.clear()
    try:
        yield probed
    finally:
        ba.comfy_get, ba._comfy_alive = real_get, real_alive   # type: ignore[assignment]
        ba.COMFY_TRANSPORT = real_tx
        ba._CLASS_PRESENT.clear()


def test_a_graph_whose_node_types_are_missing_is_never_submitted() -> None:
    """2026-09-07: a blueprint authored on the R&D pod was run against the
    artist's LOCAL ComfyUI, which has no PuLID pack. ComfyUI answered
    `missing_node_type` for ONE class and stopped — so a three-node gap costs
    three failed jobs to enumerate by hand. This guard asks /object_info per
    distinct class first and names the whole gap in one message."""
    graph = {
        "1": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": "sdxl.safetensors"}},
        "12": {"class_type": "PulidModelLoader", "inputs": {}},
        "13": {"class_type": "PulidEvaClipLoader", "inputs": {}},
        "14": {"class_type": "ApplyPulid", "inputs": {"pulid": ["12", 0]}},
        "22": {"class_type": "ApplyPulid", "inputs": {"pulid": ["12", 0]}},
        "17": {"class_type": "SaveImage", "inputs": {"images": ["16", 0]}},
    }
    have = {"CheckpointLoaderSimple", "SaveImage"}

    with comfy_declaring(have) as probed:
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                ba.assert_nodes_installed(graph)
            msg = "(no error)"
        except RuntimeError as e:
            msg = str(e)
        out = buf.getvalue()
        check("a graph with missing node types is refused", msg != "(no error)", True)
        for cls in ("PulidModelLoader", "PulidEvaClipLoader", "ApplyPulid"):
            check_in(f"the message names {cls}", cls, msg)
        check_in("the report names the graph nodes using the class",
                 "(graph node 14, 22)", out)
        check_in("and says nothing was submitted", "Nothing was submitted", out)
        check_in("and offers the RunPod target", "RunPod", out)
        check_in("and the sync script", "sync-local-nodes.py", out)
        check_not_in("an INSTALLED class is never reported",
                     "CheckpointLoaderSimple", msg)

        # Cached: a second graph over the same classes must not re-probe. The
        # per-region call site depends on this - only the first region pays.
        before = len(probed)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                ba.assert_nodes_installed(graph)
        except RuntimeError:
            pass
        check("the second call re-probes nothing", len(probed), before)

    # Everything present -> silent, and the graph goes through.
    with comfy_declaring(have | {"PulidModelLoader", "PulidEvaClipLoader",
                                 "ApplyPulid"}):
        with contextlib.redirect_stdout(io.StringIO()):
            ba.assert_nodes_installed(graph)
        check("a fully installed graph passes", True, True)


def test_the_node_guard_stays_silent_when_it_cannot_know() -> None:
    """A guard that cries wolf gets ignored, which costs more than the failure
    it was added to catch. Three ways this one must decline to have an opinion
    rather than accuse a healthy install."""
    graph = {"12": {"class_type": "PulidModelLoader", "inputs": {}},
             "17": {"class_type": "SaveImage", "inputs": {}}}

    # 1. The probe itself is broken (an edge answering 404/{} for everything):
    #    the SaveImage sentinel reads absent, so no verdict is possible.
    with comfy_declaring(set()):
        with contextlib.redirect_stdout(io.StringIO()):
            ba.assert_nodes_installed(graph)
        check("a probe that denies even SaveImage raises nothing", True, True)

    # 2. Serverless transport: there is no live ComfyUI to ask, and that
    #    worker's node set is fixed in its own image.
    with comfy_declaring({"SaveImage"}, transport="serverless") as probed:
        with contextlib.redirect_stdout(io.StringIO()):
            ba.assert_nodes_installed(graph)
        check("serverless is not probed at all", probed, [])

    # 3. A transport failure is NOT an absence: _class_installed returns None,
    #    which is never a verdict.
    def boom(_path: str) -> dict:
        raise ConnectionError("tunnel down")

    real_get, real_alive = ba.comfy_get, ba._comfy_alive
    ba.comfy_get = boom                        # type: ignore[assignment]
    ba._comfy_alive = lambda: True             # type: ignore[assignment]
    ba._CLASS_PRESENT.clear()
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            ba.assert_nodes_installed(graph)
        check("a dead tunnel accuses no node", True, True)
    finally:
        ba.comfy_get, ba._comfy_alive = real_get, real_alive   # type: ignore[assignment]
        ba._CLASS_PRESENT.clear()



if __name__ == "__main__":
    for fn in (test_the_poisoned_config_from_the_outage_renders_again,
               test_a_real_value_still_wins,
               test_a_blank_required_model_falls_back_too,
               test_a_graph_with_an_empty_model_name_is_never_submitted,
               test_a_graph_whose_node_types_are_missing_is_never_submitted,
               test_the_node_guard_stays_silent_when_it_cannot_know,
               test_a_wrong_family_vae_is_refused_before_the_gpu_runs,
               test_blank_text_still_means_blank,
               test_blank_shadows_default_is_precise,
               test_saving_a_blank_numeric_drops_the_key,
               test_a_poisoned_config_heals_on_the_next_save,
               test_every_numeric_field_has_a_numeric_default,
               test_per_atlas_inherit_label_names_the_real_global,
               test_an_empty_numeric_box_shows_its_default):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    sys.exit(1 if FAILED else 0)
