"""End-to-end tests through the real nodes with real tensors.

These run the same code ComfyUI runs — Normalize -> Analyze -> Resolve -> Route ->
Debug — on synthetic layers, including the case that matters most: the same layers fed
in a different order must produce the same semantic outputs, all the way down to the
content hashes that make the layer ids.
"""

from __future__ import annotations

import json
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import torch  # noqa: E402

from _bootstrap import mod  # noqa: E402

normalize_mod = mod("nodes.normalize")
analyze_mod = mod("nodes.analyze")
resolve_mod = mod("nodes.resolve")
router_mod = mod("nodes.router")
assets_mod = mod("nodes.assets")
debug_mod = mod("nodes.debug")
image_utils = mod("utils.image")
taxonomy_mod = mod("semantic.taxonomy")

Role = taxonomy_mod.Role

H = W = 64


def gradient_backdrop() -> torch.Tensor:
    """A full-frame plate with a non-black, non-white border: coverage is genuinely
    unknowable from the pixels, so alpha derivation must decline to guess."""
    ramp = torch.linspace(0.30, 0.60, H).view(1, H, 1, 1).expand(1, H, W, 3)
    return ramp.clone()


def blob(x0: int, y0: int, x1: int, y1: int, colour: float = 0.85) -> torch.Tensor:
    """An object on black — the shape a keyed layer actually has."""
    img = torch.zeros((1, H, W, 3))
    img[:, y0:y1, x0:x1, :] = colour
    return img


#: (name, image, caption). Areas and positions differ so scoring has something to rank.
LAYERS = [
    ("sky", gradient_backdrop(), "blue sky and distant clouds"),
    ("woman", blob(18, 10, 46, 56), "a woman wearing a red jacket"),
    ("man", blob(52, 40, 62, 60), "a man standing further back"),
    ("chair", blob(4, 44, 20, 60), "a wooden chair"),
    ("table", blob(24, 48, 44, 62), "a wooden table"),
    ("smoke", blob(40, 4, 60, 26), "smoke drifting through the air"),
]


def stack(names) -> torch.Tensor:
    return torch.cat([dict((n, i) for n, i, _ in LAYERS)[n] for n in names], dim=0)


def captions_for(names) -> dict[str, str]:
    return {n: c for n, _, c in LAYERS if n in names}


def run_chain(names, overrides: str = "", merge_mode: str = "alpha_over"):
    """Normalize -> Analyze -> Resolve -> Route, returning everything for assertions."""
    layer_set, _meta, _report = normalize_mod.SemanticLayerNormalize().normalize(
        images=stack(names),
        alpha_mode="auto",
        alpha_tolerance=0.04,
        composite_layer="none",
        drop_composite=False,
        source_label="test",
    )

    # Key captions by CONTENT (the stable layer id), never by position — this is how a
    # caller pins a description to a layer regardless of what order it arrived in.
    wanted = captions_for(names)
    caption_lines = []
    for layer in layer_set.layers:
        name = names[layer.source_index]
        caption_lines.append(f"{layer.layer_id} = {wanted[name]}")

    meta, layers_with_meta, _r = analyze_mod.SemanticLayerAnalyze().analyze(
        semantic_layers=layer_set,
        analyzer="captions",
        captions="\n".join(caption_lines),
        caption_confidence=1.0,
        use_cache=False,
        taxonomy_path="",
    )
    resolved, _r2 = resolve_mod.SemanticSubjectResolver().resolve(
        layer_metadata=meta,
        area_weight=1.0,
        centrality_weight=1.0,
        prominence_weight=0.7,
        semantic_weight=1.0,
        confidence_weight=0.5,
        layer_order_weight=0.0,
        min_character_confidence=0.60,
        ambiguity_margin=0.0,
    )
    outputs = router_mod.SemanticLayerRouter().route_layers(
        semantic_layers=layers_with_meta,
        layer_metadata=resolved,
        mode="AUTO",
        auto_threshold=0.85,
        uncertain_threshold=0.60,
        merge_mode=merge_mode,
        merge_order="area_desc",
        overrides=overrides,
        taxonomy_path="",
    )
    return layer_set, resolved, outputs


class TestAnalyzerDefault(unittest.TestCase):
    """The default backend must be one that reads PIXELS.

    A text backend keyed by index describes a slot, so reordering the layers mislabels
    them — the exact hardcoding this extension exists to remove. Pinning the default is
    how that stays true through future edits.
    """

    def spec(self):
        return analyze_mod.SemanticLayerAnalyze.INPUT_TYPES()["required"]["analyzer"]

    def test_default_is_florence2(self):
        options, config = self.spec()
        self.assertIn("florence2", options)
        self.assertEqual(config["default"], "florence2")

    def test_text_backends_remain_available(self):
        options, _ = self.spec()
        for name in ("captions", "geometry", "stub"):
            self.assertIn(name, options)

    def test_default_falls_back_when_a_backend_is_missing(self):
        """florence2 is optional — if its import fails, the default must still be sane."""
        pick = lambda have: next(  # noqa: E731 - mirrors the module's own expression
            (n for n in analyze_mod._PREFERRED_DEFAULTS if n in have), sorted(have)[0]
        )
        self.assertEqual(pick({"captions", "geometry", "stub"}), "captions")
        self.assertEqual(pick({"geometry", "stub"}), "geometry")
        self.assertEqual(pick({"stub"}), "stub")


class TestNormalize(unittest.TestCase):
    def test_splits_a_batch_of_any_size(self):
        node = normalize_mod.SemanticLayerNormalize()
        for count in (1, 3, 6):
            names = [n for n, _, _ in LAYERS][:count]
            layer_set, meta, report = node.normalize(
                images=stack(names),
                alpha_mode="auto",
                alpha_tolerance=0.04,
                composite_layer="none",
                drop_composite=False,
                source_label="test",
            )
            self.assertEqual(len(layer_set), count)
            self.assertEqual(len(meta), count)
            self.assertIn(f"normalized {count} layer(s)", report)

    def test_alpha_is_derived_for_keyed_layers_and_declined_for_the_plate(self):
        layer_set, _m, _r = normalize_mod.SemanticLayerNormalize().normalize(
            images=stack(["sky", "woman"]),
            alpha_mode="auto",
            alpha_tolerance=0.04,
            composite_layer="none",
            drop_composite=False,
            source_label="test",
        )
        sky, woman = layer_set.layers
        # A mid-grey border gives no honest signal, so no alpha is invented.
        self.assertIsNone(sky.alpha)
        self.assertEqual(sky.metadata.alpha_source, "none")
        self.assertAlmostEqual(sky.metadata.area_ratio, 1.0, places=3)
        # A subject on black keys cleanly.
        self.assertIsNotNone(woman.alpha)
        self.assertEqual(woman.metadata.alpha_source, "black_key")
        self.assertLess(woman.metadata.area_ratio, 0.5)
        self.assertGreater(woman.metadata.area_ratio, 0.2)

    def test_flat_midtone_background_is_keyed_by_colour(self):
        """The real Qwen case: a layer's empty area is a flat brown-grey, not black.

        Luminance keying is blind to that (mid luma), so `auto` must fall through to
        keying against the border COLOUR — otherwise the layer measures as full-frame
        and every area/centrality signal goes flat.
        """
        brown = torch.zeros((1, H, W, 3))
        brown[..., 0], brown[..., 1], brown[..., 2] = 0.42, 0.36, 0.30
        brown[:, 16:48, 16:48, :] = torch.tensor([0.85, 0.20, 0.15])  # the "content"

        layer_set, _m, report = normalize_mod.SemanticLayerNormalize().normalize(
            images=brown, alpha_mode="auto", alpha_tolerance=0.04,
            composite_layer="none", drop_composite=False, source_label="test",
        )
        layer = layer_set.layers[0]
        self.assertEqual(layer.metadata.alpha_source, "border_key")
        self.assertIsNotNone(layer.alpha)
        # 32x32 of content in a 64x64 frame == a quarter of the pixels.
        self.assertAlmostEqual(layer.metadata.area_ratio, 0.25, delta=0.05)
        self.assertIn("border_key", report)

    def test_varied_background_still_declines_to_guess(self):
        """A layer that genuinely fills the frame must NOT get invented coverage."""
        layer_set, _m, _r = normalize_mod.SemanticLayerNormalize().normalize(
            images=gradient_backdrop(), alpha_mode="auto", alpha_tolerance=0.04,
            composite_layer="none", drop_composite=False, source_label="test",
        )
        self.assertIsNone(layer_set.layers[0].alpha)
        self.assertEqual(layer_set.layers[0].metadata.alpha_source, "none")

    def test_layer_ids_are_content_derived_and_order_independent(self):
        node = normalize_mod.SemanticLayerNormalize()
        forward, _m, _r = node.normalize(
            images=stack(["sky", "woman", "chair"]),
            alpha_mode="auto", alpha_tolerance=0.04, composite_layer="none",
            drop_composite=False, source_label="test",
        )
        backward, _m2, _r2 = node.normalize(
            images=stack(["chair", "woman", "sky"]),
            alpha_mode="auto", alpha_tolerance=0.04, composite_layer="none",
            drop_composite=False, source_label="test",
        )
        self.assertEqual(
            {l.layer_id for l in forward.layers}, {l.layer_id for l in backward.layers}
        )

    def test_empty_batch_is_reported_not_crashed(self):
        layer_set, meta, report = normalize_mod.SemanticLayerNormalize().normalize(
            images=torch.zeros((0, H, W, 3)),
            alpha_mode="auto", alpha_tolerance=0.04, composite_layer="none",
            drop_composite=False, source_label="test",
        )
        self.assertEqual(len(layer_set), 0)
        self.assertEqual(len(meta), 0)
        self.assertIn("no layers", report)

    def test_composite_plane_can_be_marked_or_dropped(self):
        node = normalize_mod.SemanticLayerNormalize()
        marked, _m, _r = node.normalize(
            images=stack(["sky", "woman", "chair"]),
            alpha_mode="auto", alpha_tolerance=0.04, composite_layer="first",
            drop_composite=False, source_label="test",
        )
        self.assertTrue(marked.layers[0].metadata.is_composite)
        dropped, _m2, _r2 = node.normalize(
            images=stack(["sky", "woman", "chair"]),
            alpha_mode="auto", alpha_tolerance=0.04, composite_layer="first",
            drop_composite=True, source_label="test",
        )
        self.assertEqual(len(dropped), 2)

    def test_five_dim_latent_gets_an_actionable_error(self):
        with self.assertRaises(image_utils.LayerShapeError) as ctx:
            normalize_mod.SemanticLayerNormalize().normalize(
                images=torch.zeros((1, 16, 3, 8, 8)),
                alpha_mode="auto", alpha_tolerance=0.04, composite_layer="none",
                drop_composite=False, source_label="test",
            )
        self.assertIn("Latent Cut To Batch", str(ctx.exception))

    def test_mismatched_mask_batch_is_ignored_with_a_note(self):
        _ls, _m, report = normalize_mod.SemanticLayerNormalize().normalize(
            images=stack(["sky", "woman", "chair"]),
            alpha_mode="from_mask", alpha_tolerance=0.04, composite_layer="none",
            drop_composite=False, source_label="test",
            masks=torch.ones((2, H, W)),
        )
        self.assertIn("ignoring it", report)


class TestFullPipeline(unittest.TestCase):
    ALL = [n for n, _, _ in LAYERS]

    def name_roles(self, names, overrides="") -> dict[str, str]:
        layer_set, _resolved, outputs = run_chain(names, overrides=overrides)
        routed_layers = outputs[8]
        out = {}
        for layer in routed_layers.layers:
            out[names[layer.metadata.source_layer]] = layer.metadata.role
        return out

    def test_routes_every_category(self):
        roles = self.name_roles(self.ALL)
        self.assertEqual(roles["sky"], Role.BACKGROUND)
        self.assertEqual(roles["woman"], Role.MAIN_CHARACTER)
        self.assertEqual(roles["man"], Role.SECONDARY_CHARACTER)
        self.assertEqual(roles["chair"], Role.ASSET)
        self.assertEqual(roles["table"], Role.ASSET)
        self.assertEqual(roles["smoke"], Role.EFFECT)

    def test_router_emits_seven_images_of_the_frame_size(self):
        _ls, _r, outputs = run_chain(self.ALL)
        for i in range(7):
            image = outputs[i]
            self.assertEqual(image.ndim, 4)
            self.assertEqual(tuple(image.shape[1:]), (H, W, 3))

    def test_empty_role_is_a_blank_frame_not_an_invented_layer(self):
        # No character captions at all.
        _ls, _r, outputs = run_chain(["sky", "chair"])
        main = outputs[1]
        self.assertEqual(tuple(main.shape), (1, H, W, 3))
        self.assertAlmostEqual(float(main.abs().sum().item()), 0.0, places=5)
        self.assertIn("MAIN_CHARACTER", outputs[10])

    def test_assets_collection_keeps_layers_separate(self):
        _ls, _r, outputs = run_chain(self.ALL)
        asset_set = outputs[7]
        self.assertEqual(len(asset_set), 2)
        labels = sorted(a.label for a in asset_set)
        self.assertEqual(labels, ["a wooden chair", "a wooden table"])
        self.assertEqual([a.asset_id for a in asset_set], ["asset_001", "asset_002"])

    def test_asset_selector_filters_and_merges(self):
        _ls, _r, outputs = run_chain(self.ALL)
        asset_set = outputs[7]
        node = assets_mod.SemanticAssetSelector()
        image, _mask, labels, count, filtered = node.select(
            assets=asset_set, index=-1, object_type="furniture",
            label_contains="", merge_mode="batch",
        )
        self.assertEqual(count, 2)
        self.assertEqual(image.shape[0], 2)  # batch mode keeps both frames
        self.assertIn("chair", labels)

        _i2, _m2, _l2, count2, _f2 = node.select(
            assets=asset_set, index=-1, object_type="vehicle",
            label_contains="", merge_mode="batch",
        )
        self.assertEqual(count2, 0)

    def test_role_select_returns_image_and_mask(self):
        _ls, _r, outputs = run_chain(self.ALL)
        image, mask, count, labels = assets_mod.SemanticRoleSelect().select(
            semantic_layers=outputs[8], role=Role.MAIN_CHARACTER, merge_mode="alpha_over"
        )
        self.assertEqual(count, 1)
        self.assertEqual(tuple(image.shape), (1, H, W, 3))
        self.assertEqual(tuple(mask.shape), (1, H, W))
        self.assertGreater(float(mask.sum().item()), 0.0)
        self.assertIn("woman", labels)

    def test_override_beats_the_classifier_end_to_end(self):
        roles = self.name_roles(self.ALL, overrides="3 = main_character")
        self.assertEqual(roles["chair"], Role.MAIN_CHARACTER)

    def test_debug_node_renders_a_contact_sheet(self):
        layer_set, resolved, outputs = run_chain(self.ALL)
        sheet, meta_json = debug_mod.SemanticLayerDebug().render(
            semantic_layers=outputs[8], columns=3, cell_size=96,
            show_notes=False, layer_metadata=outputs[9],
        )
        self.assertEqual(sheet.ndim, 4)
        self.assertGreater(sheet.shape[1], 96)
        self.assertGreater(sheet.shape[2], 96)
        payload = json.loads(meta_json)
        self.assertEqual(payload["layer_count"], 6)
        self.assertEqual(payload["roles"][Role.MAIN_CHARACTER], 1)

    def test_debug_handles_an_empty_set(self):
        empty, _m, _r = normalize_mod.SemanticLayerNormalize().normalize(
            images=torch.zeros((0, H, W, 3)),
            alpha_mode="auto", alpha_tolerance=0.04, composite_layer="none",
            drop_composite=False, source_label="test",
        )
        sheet, meta_json = debug_mod.SemanticLayerDebug().render(
            semantic_layers=empty, columns=4, cell_size=128, show_notes=False
        )
        self.assertEqual(sheet.ndim, 4)
        self.assertEqual(json.loads(meta_json)["layer_count"], 0)

    def test_router_rejects_inverted_thresholds(self):
        layer_set, resolved, _o = run_chain(self.ALL)
        with self.assertRaises(ValueError):
            router_mod.SemanticLayerRouter().route_layers(
                semantic_layers=layer_set, layer_metadata=resolved, mode="AUTO",
                auto_threshold=0.2, uncertain_threshold=0.9, merge_mode="alpha_over",
                merge_order="area_desc", overrides="", taxonomy_path="",
            )


class TestOrderIndependenceEndToEnd(unittest.TestCase):
    ALL = [n for n, _, _ in LAYERS]

    def signature(self, names):
        """Role -> the set of layer NAMES routed there. Order-free by construction."""
        layer_set, _resolved, outputs = run_chain(names)
        routed = outputs[8]
        index_to_name = {i: n for i, n in enumerate(names)}
        sig = {}
        for layer in routed.layers:
            sig.setdefault(layer.metadata.role, set()).add(
                index_to_name[layer.metadata.source_layer]
            )
        return sig

    def test_shuffling_the_input_does_not_change_semantic_outputs(self):
        baseline = self.signature(self.ALL)
        rng = random.Random(4711)
        for trial in range(8):
            shuffled = self.ALL[:]
            rng.shuffle(shuffled)
            self.assertEqual(
                self.signature(shuffled), baseline, f"trial {trial}: {shuffled}"
            )

    def test_reversed_input_is_identical(self):
        self.assertEqual(self.signature(self.ALL), self.signature(list(reversed(self.ALL))))

    def test_merged_pixels_match_across_orders(self):
        """Not just the assignment — the composited BACKGROUND/ASSETS pixels too."""
        _l1, _r1, forward = run_chain(self.ALL)
        _l2, _r2, backward = run_chain(list(reversed(self.ALL)))
        for i, name in enumerate(
            ["BACKGROUND", "MAIN_CHARACTER", "SECONDARY", "ASSETS", "ENV", "EFFECTS", "OTHER"]
        ):
            self.assertTrue(
                torch.allclose(forward[i], backward[i], atol=1e-5),
                f"{name} differs between layer orders",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
