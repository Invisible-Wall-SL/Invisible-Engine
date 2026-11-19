"""Offline guard for the DRAFT `qwen_character_facing` blueprint (no R2, no ComfyUI).

Run:  PYTHONPATH=".;../_shared" py test_character_facing_blueprint.py   (from services/atlas-tool)

Stage 1 of the character facings network (docs/design/character-facings-network.md):
one still of a character per facing, each an edit of the same reference image.

WHAT THIS CAN AND CANNOT SAY. The graph has never run on a GPU, and no test here
makes it run. What is checked is everything that can be read without one:

  * the manifest and its card pass the tool's own validators;
  * the graph is closed (every wire lands on a node) and names NO node class and
    NO node input that a bundled Qwen graph does not already name, so it asks the
    pod for nothing the repo has not asked for before. Those graphs are
    themselves unrun (rigger status, T6), so this is "no new unknown", not
    "known to work";
  * every model it loads is declared, and reads `clear` in the licence registry,
    which is what lets its card say `licence: ok`;
  * the still is a square 1024 whatever the reference's shape and whatever the
    atlas's generation size is, because the video stage takes a square still;
  * the runner drives it as the design says: the prompt is the atlas's shared
    framing around the region's view instruction, the reference arrives as the
    picture and never as a silhouette, and the stage it hands to exists.

ASCII only in the labels (cp1252 consoles).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

os.environ["ATLAS_STAGING"] = tempfile.mkdtemp(prefix="bp-facing-")

import batch_atlas as ba  # noqa: E402
import blueprints  # noqa: E402
import cards  # noqa: E402
import model_provenance as mp  # noqa: E402

FAILED: list[str] = []
PASSED: list[str] = []

BP_ID = "qwen_character_facing"
SIBLINGS = ("qwen_bust_face", "qwen_bust_face_variant")
NEXT_STAGE = "wan22_i2v_flipbook"


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}"
          + ("" if ok else f"\n       got  {got!r}\n       want {want!r}"))
    (PASSED if ok else FAILED).append(label)


def _read(bp_id: str, name: str) -> dict:
    return json.loads((blueprints.BUNDLED_SRC / bp_id / name).read_text(encoding="utf-8"))


def load(bp_id: str) -> dict:
    """A bundled blueprint as the library loads it."""
    bp = blueprints._load_blueprint(bp_id, _read(bp_id, "blueprint.json"),
                                    _read(bp_id, "workflow.json"))
    assert bp is not None, bp_id
    return bp


def is_wire(v) -> bool:
    return isinstance(v, list) and len(v) == 2 and isinstance(v[0], str)


def dangling_wires(graph: dict) -> list[str]:
    return sorted(f"{nid}.{field} -> {v[0]}"
                  for nid, node in graph.items()
                  for field, v in node["inputs"].items()
                  if is_wire(v) and v[0] not in graph)


def named_inputs(graphs) -> dict[str, set]:
    """class_type -> every input name the given graphs use on it."""
    out: dict[str, set] = {}
    for graph in graphs:
        for node in graph.values():
            out.setdefault(node["class_type"], set()).update(node["inputs"])
    return out


def test_manifest_and_graph() -> None:
    manifest, graph = _read(BP_ID, "blueprint.json"), _read(BP_ID, "workflow.json")
    blueprints.validate_against_graph(BP_ID, manifest, graph)
    check("passes the upload validator against its own graph", manifest["id"], BP_ID)
    check("an image blueprint, bundled, with no custom node",
          (manifest["kind"], manifest["author"], manifest["custom_nodes"]),
          ("image", blueprints.BUNDLED_AUTHOR, []))
    check("the description says it has not run",
          manifest["description"].startswith("DRAFT, never run on a GPU."), True)
    check("every wire lands on a node", dangling_wires(graph), [])

    known = named_inputs(load(s)["graph"] for s in SIBLINGS)
    mine = named_inputs([graph])
    check("no node class the bundled Qwen graphs do not already use",
          sorted(set(mine) - set(known)), [])
    check("no node input the bundled Qwen graphs do not already use",
          sorted(f"{cls}.{name}" for cls, names in mine.items()
                 for name in names - known.get(cls, set())), [])


def test_the_still_is_square_whatever_the_reference() -> None:
    bp = load(BP_ID)
    graph = bp["graph"]
    latent = graph[graph["11"]["inputs"]["latent_image"][0]]
    check("the sampler's latent is an empty one, not the encoded reference",
          (latent["class_type"], sorted(n["class_type"] for n in graph.values()
                                        if n["class_type"] == "VAEEncode")),
          ("EmptySD3LatentImage", []))
    check("...a square 1024", (latent["inputs"]["width"], latent["inputs"]["height"]),
          (1024, 1024))
    check("the reference conditions the positive AND the negative encode",
          [graph[n]["inputs"]["image1"] for n in ("6", "7")], [["5", 0], ["5", 0]])
    check("...and comes from the bound LoadImage",
          (graph["5"]["inputs"]["image"], graph["4"]["class_type"]), (["4", 0], "LoadImage"))


def test_bindings() -> None:
    bp = load(BP_ID)
    b = bp["bindings"]
    check("roles bound", sorted(b), ["output", "positive", "seed", "style_ref"])
    check("positive is the edit instruction", b["positive"], {"node": "6", "field": "prompt"})
    check("seed is the sampler's", b["seed"], {"node": "11", "field": "seed"})
    check("output is the SaveImage", bp["graph"][b["output"]["node"]]["class_type"], "SaveImage")
    # shape_ref on the same LoadImage would be written second and send a
    # grayscale silhouette instead of the character (lessons/atlas.md).
    check("the reference is bound once, as style_ref", "shape_ref" in b, False)
    check("width/height are deliberately unbound", ("width" in b, "height" in b), (False, False))
    check("params drive the sampler only",
          [(p["key"], p["node"], p["field"]) for p in bp["params"]],
          [("steps", "11", "steps"), ("cfg", "11", "cfg")])


def test_models_are_declared_and_clear() -> None:
    manifest, graph = _read(BP_ID, "blueprint.json"), _read(BP_ID, "workflow.json")
    derived = sorted(m["filename"] for m in blueprints.derive_models_from_graph(graph))
    declared = sorted(m["filename"] for m in manifest["models"])
    check("models[] is exactly what the graph loads", declared, derived)
    check("every declared model can be fetched by name",
          [m["filename"] for m in manifest["models"]
           if not all(m.get(k) for k in ("url", "save_path", "base", "filename"))], [])
    check("every model is in the licence registry as clear",
          {f: (mp.lookup(f) or {}).get("commercial") for f in declared},
          {f: "clear" for f in declared})
    prov = mp.provenance(graph, pipeline=BP_ID)
    check("a render is stamped clear, nothing blocked or unknown",
          (prov["commercial"], prov["blocked_by"], prov["unknown"]), ("clear", [], []))
    sibling = {m["filename"]: m for m in _read("qwen_bust_face_variant", "blueprint.json")["models"]}
    check("the same files, from the same place, as the bundled edit blueprint",
          {m["filename"]: (m["url"], m["save_path"]) for m in manifest["models"]},
          {f: (m["url"], m["save_path"]) for f, m in sibling.items()})


def test_the_runner_drives_it() -> None:
    bp = load(BP_ID)
    style = {"positive_prefix": "Keep the same bear",
             "positive_suffix": "plain flat light grey background",
             "negative": "blurry"}
    region = {"name": "bear_e", "prompt": "Turn the character to face right",
              "style_ref": "batch/bear_se_00001_.png", "seed": 7}
    real = (ba.GEN_WIDTH, ba.GEN_HEIGHT)
    ba.GEN_WIDTH, ba.GEN_HEIGHT = 512, 768
    try:
        wf, out = ba.build_workflow_blueprint(region, style, bp, {"steps": 500})
    finally:
        ba.GEN_WIDTH, ba.GEN_HEIGHT = real
    check("the prompt is the atlas's framing around the region's view instruction",
          wf["6"]["inputs"]["prompt"],
          "Keep the same bear, Turn the character to face right, "
          "plain flat light grey background")
    check("the negative encode stays empty (no negative role)", wf["7"]["inputs"]["prompt"], "")
    check("the reference arrives as the picture itself", wf["4"]["inputs"]["image"],
          "batch/bear_se_00001_.png")
    check("the region's seed reaches the sampler", wf["11"]["inputs"]["seed"], 7)
    check("the atlas's generation size does not reach the latent",
          (wf["8"]["inputs"]["width"], wf["8"]["inputs"]["height"]), (1024, 1024))
    check("an override is clamped into the param's range, the other keeps its default",
          (wf["11"]["inputs"]["steps"], wf["11"]["inputs"]["cfg"]), (50, 2.5))
    check("the variant is filed under the region's name",
          (out, wf["13"]["inputs"]["filename_prefix"].endswith("/batch/bear_e")), ("13", True))
    check("the bundled graph is not mutated",
          bp["graph"]["6"]["inputs"]["prompt"].startswith("Turn the character to face right, in"),
          True)


def test_card() -> None:
    bp = load(BP_ID)
    card = _read(BP_ID, "card.json")
    _, errors = cards.validate_card(card, bp_id=BP_ID, blueprint=bp,
                                    builtin_keys={"atlas": [], "region": []})
    check("the card passes against its blueprint", errors, [])
    check("it ships as a rev-1 draft", (card["status"], card["rev"]), ("draft", 1))
    check("licence ok is what the registry says of its graph",
          (card["licence"], mp.provenance(bp["graph"], pipeline=BP_ID)["commercial"]),
          ("ok", "clear"))
    check("its timings are a guess, and it says so", card["gpu"]["source"], "guess")
    check("the still is opaque at the latent's size",
          (card["outputs"]["alpha"], card["outputs"]["fixedPx"]),
          (False, bp["graph"]["8"]["inputs"]["width"]))
    nxt = load(NEXT_STAGE)
    check("the stage it hands to is a bundled video blueprint that takes a still",
          (card["chain"]["precedes"], nxt["meta"]["kind"], "style_ref" in nxt["bindings"]),
          ([NEXT_STAGE], "video", True))


if __name__ == "__main__":
    for fn in (test_manifest_and_graph, test_the_still_is_square_whatever_the_reference,
               test_bindings, test_models_are_declared_and_clear, test_the_runner_drives_it,
               test_card):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED: " + ", ".join(FAILED))
    sys.exit(1 if FAILED else 0)
