"""Semantic-logic tests. No torch, no ComfyUI, no model weights.

The headline test is `test_layer_order_does_not_change_routing`: the same layers in a
different order must produce byte-identical role assignments. Everything else in this
extension exists to make that true.
"""

from __future__ import annotations

import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import mod  # noqa: E402

schema = mod("semantic.schema")
rules = mod("semantic.rules")
taxonomy_mod = mod("semantic.taxonomy")
routing = mod("semantic.routing")
scoring = mod("semantic.scoring")
overrides_mod = mod("semantic.overrides")

LayerMetadata = schema.LayerMetadata
LayerMetadataSet = schema.LayerMetadataSet
Role = taxonomy_mod.Role
Thresholds = routing.Thresholds
SubjectWeights = scoring.SubjectWeights

TAX = taxonomy_mod.load_taxonomy()


def make_meta(
    layer_id: str,
    description: str,
    *,
    index: int = 0,
    area: float = 0.2,
    centroid: tuple[float, float] = (0.5, 0.5),
    confidence_scale: float = 1.0,
) -> LayerMetadata:
    """Build metadata the way the Analyze node does, so tests exercise the real path."""
    meta = LayerMetadata(
        layer_id=layer_id,
        source_layer=index,
        description=description,
        area_ratio=area,
        centroid=centroid,
        prominence=min(1.0, area ** 0.5),
    )
    match = rules.classify_text(description, TAX)
    rules.apply_category(meta, match, TAX, confidence=match.confidence * confidence_scale)
    return meta


def make_set(*metas: LayerMetadata) -> LayerMetadataSet:
    for i, meta in enumerate(metas):
        if meta.source_layer == 0 and i != 0:
            meta.source_layer = i
    return LayerMetadataSet(items=list(metas), source="test", image_dimensions=(640, 640))


def full_pipeline(meta_set: LayerMetadataSet, overrides: str = "", mode: str = routing.ReviewMode.AUTO):
    resolved = routing.resolve_subjects(
        meta_set, weights=SubjectWeights(), thresholds=Thresholds(), min_character_confidence=0.6
    )
    return routing.route(
        resolved,
        taxonomy=TAX,
        overrides=overrides_mod.parse_overrides(overrides, TAX),
        thresholds=Thresholds(),
        mode=mode,
    )


class TestTaxonomyAndRules(unittest.TestCase):
    def test_taxonomy_loads_from_yaml(self):
        self.assertTrue(TAX.source_path.endswith(".yaml"), TAX.source_path)
        self.assertIn(Role.MAIN_CHARACTER, TAX.roles)

    def test_rules_classify_what_not_role(self):
        match = rules.classify_text("a woman wearing a red jacket", TAX)
        self.assertEqual(match.category, "character")
        # Classification alone must never yield MAIN_CHARACTER.
        self.assertEqual(TAX.default_role("character"), Role.SECONDARY_CHARACTER)

    def test_effects_outrank_background_keywords(self):
        match = rules.classify_text("smoke drifting against the sky", TAX)
        self.assertEqual(match.category, "effect")

    def test_no_match_is_unknown_not_a_guess(self):
        match = rules.classify_text("zzzblorptech", TAX)
        self.assertFalse(match.matched)
        self.assertEqual(match.confidence, 0.0)


# The Atlas Maker's production target is a serverless worker with no durable filesystem,
# so a taxonomy_path can never resolve there. Inline YAML is the only way a project's own
# vocabulary reaches a production render.
INLINE_YAML = """
version: 1
roles: [BACKGROUND, MAIN_CHARACTER, SECONDARY_CHARACTER, ASSET, ENVIRONMENT, EFFECT, OTHER, UNRESOLVED]
categories:
  asset:
    default_role: ASSET
    importance: 1.0
rules:
  - category: asset
    keywords: [zzzblorptech]
    priority: 10
"""


class TestInlineTaxonomy(unittest.TestCase):
    def setUp(self):
        taxonomy_mod.clear_cache()

    def tearDown(self):
        taxonomy_mod.clear_cache()

    def test_inline_yaml_is_parsed_and_used(self):
        tax = taxonomy_mod.load_taxonomy("", INLINE_YAML)
        self.assertEqual(tax.source_path, "<inline>")
        self.assertEqual(getattr(tax, "load_note", ""), "")
        # A word the bundled taxonomy does not know, that this one does.
        self.assertEqual(rules.classify_text("zzzblorptech", tax).category, "asset")

    def test_inline_yaml_beats_a_path(self):
        """Both supplied: the text wins, so a param can override a baked-in path."""
        tax = taxonomy_mod.load_taxonomy("/nonexistent/taxonomy.yaml", INLINE_YAML)
        self.assertEqual(tax.source_path, "<inline>")
        self.assertEqual(getattr(tax, "load_note", ""), "")

    def test_broken_inline_yaml_degrades_and_SAYS_so(self):
        """Never raise — but never fail silently either. A render that quietly routes
        against the fallback vocabulary is the failure mode this note exists to stop."""
        tax = taxonomy_mod.load_taxonomy("", "roles: [UNCLOSED\n  bad: : :")
        self.assertIn("inline taxonomy", getattr(tax, "load_note", ""))
        self.assertTrue(tax.roles)

    def test_non_mapping_inline_yaml_degrades_and_says_so(self):
        tax = taxonomy_mod.load_taxonomy("", "- just\n- a\n- list")
        self.assertIn("not a YAML mapping", getattr(tax, "load_note", ""))

    def test_two_inline_taxonomies_do_not_share_a_cache_entry(self):
        """Keyed by content. A path-shaped key would collide across two nodes holding
        different inline taxonomies, and the second would silently get the first."""
        a = taxonomy_mod.load_taxonomy("", INLINE_YAML)
        b = taxonomy_mod.load_taxonomy("", INLINE_YAML.replace("zzzblorptech", "othertech"))
        self.assertEqual(rules.classify_text("zzzblorptech", a).category, "asset")
        self.assertFalse(rules.classify_text("zzzblorptech", b).matched)

    def test_yaml_pasted_into_the_PATH_field_still_refuses_and_points_at_the_new_input(self):
        tax = taxonomy_mod.load_taxonomy(INLINE_YAML, "")
        self.assertIn("taxonomy_yaml", getattr(tax, "load_note", ""))


class TestRoutingCases(unittest.TestCase):
    def test_1_single_background_layer(self):
        plan = full_pipeline(make_set(make_meta("bg", "blue sky with clouds", area=1.0)))
        self.assertEqual(plan.ids_for(Role.BACKGROUND), ["bg"])
        self.assertEqual(plan.ids_for(Role.MAIN_CHARACTER), [])

    def test_2_background_and_character(self):
        plan = full_pipeline(
            make_set(
                make_meta("bg", "blue sky with clouds", index=0, area=1.0),
                make_meta("her", "a woman in a red jacket", index=1, area=0.3),
            )
        )
        self.assertEqual(plan.ids_for(Role.BACKGROUND), ["bg"])
        self.assertEqual(plan.ids_for(Role.MAIN_CHARACTER), ["her"])

    def test_3_background_and_multiple_characters(self):
        plan = full_pipeline(
            make_set(
                make_meta("bg", "sky", index=0, area=1.0),
                make_meta("big", "a woman", index=1, area=0.40, centroid=(0.5, 0.5)),
                make_meta("small", "a man", index=2, area=0.05, centroid=(0.9, 0.9)),
            )
        )
        self.assertEqual(plan.ids_for(Role.MAIN_CHARACTER), ["big"])
        self.assertEqual(plan.ids_for(Role.SECONDARY_CHARACTER), ["small"])

    def test_4_character_and_assets(self):
        plan = full_pipeline(
            make_set(
                make_meta("her", "a woman", index=0, area=0.3),
                make_meta("chair", "a wooden chair", index=1, area=0.1),
            )
        )
        self.assertEqual(plan.ids_for(Role.MAIN_CHARACTER), ["her"])
        self.assertEqual(plan.ids_for(Role.ASSET), ["chair"])

    def test_5_no_character_leaves_main_empty(self):
        plan = full_pipeline(
            make_set(
                make_meta("bg", "sky", index=0, area=1.0),
                make_meta("chair", "a wooden chair", index=1, area=0.2),
            )
        )
        self.assertEqual(plan.ids_for(Role.MAIN_CHARACTER), [])
        self.assertEqual(plan.metadata.metadata.get("main_character"), None)

    def test_6_multiple_plausible_main_characters_picks_one_deterministically(self):
        def build():
            return make_set(
                make_meta("a", "a woman", index=0, area=0.30, centroid=(0.5, 0.5)),
                make_meta("b", "a man", index=1, area=0.30, centroid=(0.5, 0.5)),
            )

        first = full_pipeline(build()).ids_for(Role.MAIN_CHARACTER)
        second = full_pipeline(build()).ids_for(Role.MAIN_CHARACTER)
        self.assertEqual(len(first), 1)
        self.assertEqual(first, second)  # identical inputs, identical winner

    def test_6b_ambiguity_margin_flags_a_close_call(self):
        meta_set = make_set(
            make_meta("a", "a woman", index=0, area=0.30, centroid=(0.5, 0.5)),
            make_meta("b", "a man", index=1, area=0.30, centroid=(0.5, 0.5)),
        )
        resolved = routing.resolve_subjects(
            meta_set,
            weights=SubjectWeights(),
            thresholds=Thresholds(),
            min_character_confidence=0.6,
            ambiguity_margin=0.10,
        )
        self.assertTrue(resolved.metadata["subject_ambiguous"])
        self.assertTrue(all(m.uncertain for m in resolved.items if m.is_character))

    def test_7_low_confidence_goes_to_unresolved(self):
        plan = full_pipeline(
            make_set(
                make_meta("bg", "sky", index=0, area=1.0),
                make_meta("maybe", "a woman", index=1, area=0.3, confidence_scale=0.4),
            )
        )
        self.assertEqual(plan.ids_for(Role.UNRESOLVED), ["maybe"])
        self.assertEqual(plan.ids_for(Role.MAIN_CHARACTER), [])

    def test_7b_middle_band_routes_but_flags(self):
        meta_set = make_set(make_meta("bg", "sky", area=1.0, confidence_scale=0.78))
        plan = full_pipeline(meta_set)
        self.assertEqual(plan.ids_for(Role.BACKGROUND), ["bg"])
        self.assertTrue(plan.metadata.get("bg").uncertain)

    def test_8_manual_override_beats_classification(self):
        plan = full_pipeline(
            make_set(
                make_meta("bg", "sky", index=0, area=1.0),
                make_meta("chair", "a wooden chair", index=1, area=0.2),
            ),
            overrides="1 = main_character",
        )
        self.assertEqual(plan.ids_for(Role.MAIN_CHARACTER), ["chair"])
        self.assertEqual(plan.ids_for(Role.ASSET), [])

    def test_8b_override_by_layer_id_and_bad_lines_reported(self):
        plan = full_pipeline(
            make_set(make_meta("chair", "a wooden chair", area=0.2)),
            overrides="chair = EFFECT\nnonsense line\n9 = background",
        )
        self.assertEqual(plan.ids_for(Role.EFFECT), ["chair"])
        self.assertTrue(any("cannot parse" in e for e in plan.errors))
        self.assertTrue(any("no layer with index 9" in e for e in plan.errors))

    def test_8c_manual_mode_routes_only_overrides(self):
        plan = full_pipeline(
            make_set(
                make_meta("bg", "sky", index=0, area=1.0),
                make_meta("her", "a woman", index=1, area=0.3),
            ),
            overrides="0 = background",
            mode=routing.ReviewMode.MANUAL,
        )
        self.assertEqual(plan.ids_for(Role.BACKGROUND), ["bg"])
        self.assertEqual(plan.ids_for(Role.UNRESOLVED), ["her"])

    def test_9_multiple_layers_land_on_assets(self):
        plan = full_pipeline(
            make_set(
                make_meta("chair", "a wooden chair", index=0, area=0.20),
                make_meta("table", "a wooden table", index=1, area=0.15),
                make_meta("car", "a red sports car", index=2, area=0.10),
            )
        )
        self.assertEqual(sorted(plan.ids_for(Role.ASSET)), ["car", "chair", "table"])

    def test_10_multiple_layers_land_on_background(self):
        plan = full_pipeline(
            make_set(
                make_meta("sky", "clear sky", index=0, area=1.0),
                make_meta("grad", "a plain background gradient", index=1, area=0.9),
            )
        )
        self.assertEqual(sorted(plan.ids_for(Role.BACKGROUND)), ["grad", "sky"])

    def test_11_empty_layer_set(self):
        plan = full_pipeline(LayerMetadataSet())
        for role in taxonomy_mod.ROUTER_OUTPUT_ROLES:
            self.assertEqual(plan.ids_for(role), [], role)

    def test_12_arbitrary_layer_counts_share_one_interface(self):
        for count in (1, 3, 7, 12, 33):
            metas = [
                make_meta(f"L{i}", ["sky", "a woman", "a wooden chair", "smoke", "grass"][i % 5], index=i)
                for i in range(count)
            ]
            plan = full_pipeline(make_set(*metas))
            self.assertEqual(
                set(plan.assignments) - {Role.UNRESOLVED},
                set(taxonomy_mod.ROUTER_OUTPUT_ROLES),
                f"layer count {count}",
            )
            routed = sum(len(v) for v in plan.assignments.values())
            self.assertEqual(routed, count, f"every layer accounted for at count {count}")


class TestOrderIndependence(unittest.TestCase):
    """The core guarantee."""

    LAYERS = [
        ("sky", "blue sky and distant clouds", 1.00, (0.50, 0.30)),
        ("woman", "a woman wearing a red jacket", 0.32, (0.48, 0.55)),
        ("man", "a man standing further back", 0.08, (0.85, 0.60)),
        ("chair", "a wooden chair", 0.10, (0.20, 0.80)),
        ("table", "a wooden table", 0.12, (0.30, 0.85)),
        ("smoke", "smoke drifting", 0.20, (0.70, 0.40)),
        ("floor", "a stone ground surface", 0.55, (0.50, 0.90)),
    ]

    def build(self, order):
        metas = []
        for index, name in enumerate(order):
            layer_id, description, area, centroid = next(l for l in self.LAYERS if l[0] == name)
            metas.append(
                make_meta(layer_id, description, index=index, area=area, centroid=centroid)
            )
        return LayerMetadataSet(items=metas, source="test", image_dimensions=(640, 640))

    def test_layer_order_does_not_change_routing(self):
        names = [layer[0] for layer in self.LAYERS]
        baseline = full_pipeline(self.build(names)).assignments

        rng = random.Random(20260907)
        for trial in range(25):
            shuffled = names[:]
            rng.shuffle(shuffled)
            plan = full_pipeline(self.build(shuffled))
            self.assertEqual(
                plan.assignments,
                baseline,
                f"trial {trial}: order {shuffled} changed routing",
            )

    def test_reversed_order_matches_exactly(self):
        names = [layer[0] for layer in self.LAYERS]
        self.assertEqual(
            full_pipeline(self.build(names)).assignments,
            full_pipeline(self.build(list(reversed(names)))).assignments,
        )

    def test_the_documented_three_layer_example(self):
        """0=background,1=character,2=chair  vs  0=chair,1=background,2=character."""
        def build(order):
            spec = {
                "background": ("bg", "blue sky", 1.0),
                "character": ("her", "a woman", 0.3),
                "chair": ("chair", "a wooden chair", 0.1),
            }
            return make_set(
                *[
                    make_meta(spec[n][0], spec[n][1], index=i, area=spec[n][2])
                    for i, n in enumerate(order)
                ]
            )

        a = full_pipeline(build(["background", "character", "chair"])).assignments
        b = full_pipeline(build(["chair", "background", "character"])).assignments
        self.assertEqual(a, b)
        self.assertEqual(a[Role.MAIN_CHARACTER], ["her"])
        self.assertEqual(a[Role.BACKGROUND], ["bg"])
        self.assertEqual(a[Role.ASSET], ["chair"])

    def test_order_weight_is_opt_in(self):
        """layer_order_weight defaults to 0, so order cannot leak in by accident."""
        self.assertEqual(SubjectWeights().order, 0.0)


class TestNauticalScene(unittest.TestCase):
    """A real scene that the first version of the taxonomy could not classify.

    "raft" matched no rule, so a wooden raft fell to UNRESOLVED — the gap that only
    showed up the first time this ran against a real picture.
    """

    def test_pirate_on_a_raft_routes_three_ways(self):
        plan = full_pipeline(
            make_set(
                make_meta("water", "deep blue ocean water with white foam", index=0, area=1.0),
                make_meta(
                    "pirate",
                    "a pirate man in a tricorn hat holding a harpoon",
                    index=1,
                    area=0.28,
                    centroid=(0.45, 0.35),
                ),
                make_meta(
                    "raft", "a wooden raft made of broken planks", index=2, area=0.40,
                    centroid=(0.55, 0.65),
                ),
            )
        )
        self.assertEqual(plan.ids_for(Role.ENVIRONMENT), ["water"])
        self.assertEqual(plan.ids_for(Role.MAIN_CHARACTER), ["pirate"])
        self.assertEqual(plan.ids_for(Role.ASSET), ["raft"])
        self.assertEqual(plan.ids_for(Role.UNRESOLVED), [])

    def test_vehicle_beats_prop_when_both_match(self):
        """'raft' (vehicle, 60) must outrank 'plank' (prop, 55) in the same sentence."""
        match = rules.classify_text("a wooden raft made of broken planks", TAX)
        self.assertEqual(match.object_type, "vehicle")

    def test_character_beats_the_weapon_they_hold(self):
        match = rules.classify_text("a pirate holding a harpoon", TAX)
        self.assertEqual(match.category, "character")


class TestFlorenceLoaderSelection(unittest.TestCase):
    """The bug that made Florence-2 look 'incompatible' was picking the wrong loader.

    No weights needed — the branch itself is the thing that was wrong.
    """

    def setUp(self):
        self.f = mod("analyzers.florence2")

    def test_modern_transformers_uses_the_native_class(self):
        for v in ("4.51.0", "4.57.1", "5.8.0", "5.0.0.dev0", "6.1.2+cu128"):
            self.assertTrue(self.f.use_native_loader(v), v)

    def test_old_transformers_uses_remote_code(self):
        for v in ("4.50.3", "4.9.0", "4.44.2", "3.5.1"):
            self.assertFalse(self.f.use_native_loader(v), v)

    def test_version_compare_is_numeric_not_lexical(self):
        """'4.9.0' sorts AFTER '4.51.0' as a string — the trap this guards."""
        self.assertFalse(self.f.use_native_loader("4.9.0"))
        self.assertTrue(self.f.use_native_loader("4.51.0"))

    def test_unparseable_version_assumes_modern(self):
        for v in ("unknown", "", "not-a-version"):
            self.assertTrue(self.f.use_native_loader(v), v)


class TestFlorenceProcessorFallback(unittest.TestCase):
    """`microsoft/Florence-2-*` ships no processor_config.json, so its tokenizer loads
    as a plain RobertaTokenizer and the native processor's `tokenizer.image_token`
    raises. Verified against transformers 5.16.1; these cover the retry logic."""

    def setUp(self):
        self.f = mod("analyzers.florence2")

    class FakeAuto:
        """Stands in for transformers.AutoProcessor."""

        def __init__(self, fail_first: Exception = None):
            self.fail_first = fail_first
            self.calls = []

        def from_pretrained(self, model_id, **kwargs):
            self.calls.append(kwargs)
            if self.fail_first is not None and len(self.calls) == 1:
                raise self.fail_first
            return f"processor:{model_id}"

    def test_plain_load_is_tried_first_and_left_alone(self):
        auto = self.FakeAuto()
        out = self.f.load_processor(auto, "some/repo")
        self.assertEqual(out, "processor:some/repo")
        self.assertEqual(auto.calls, [{}], "a working repo must keep its own token")

    def test_missing_image_token_retries_with_the_name(self):
        auto = self.FakeAuto(AttributeError("RobertaTokenizer has no attribute image_token"))
        out = self.f.load_processor(auto, "microsoft/Florence-2-base")
        self.assertEqual(out, "processor:microsoft/Florence-2-base")
        self.assertEqual(len(auto.calls), 2)
        self.assertEqual(
            auto.calls[1], {"extra_special_tokens": {"image_token": self.f.IMAGE_TOKEN}}
        )

    def test_unrelated_attribute_error_is_not_swallowed(self):
        auto = self.FakeAuto(AttributeError("something else entirely"))
        with self.assertRaises(AttributeError):
            self.f.load_processor(auto, "some/repo")
        self.assertEqual(len(auto.calls), 1, "must not retry on an unrelated failure")

    def test_image_token_constant(self):
        self.assertEqual(self.f.IMAGE_TOKEN, "<image>")


class TestClipConcepts(unittest.TestCase):
    """The CLIP backend's candidate labels come from the taxonomy, and its aggregation
    must not depend on how many keywords each category happens to list."""

    def setUp(self):
        self.clip = mod("analyzers.clip")

    def test_concepts_come_from_the_taxonomy(self):
        concepts = self.clip.build_concepts(TAX)
        self.assertGreater(len(concepts), 50)
        keywords = {c.keyword for c in concepts}
        # Anything added to the YAML becomes a CLIP candidate for free.
        self.assertIn("raft", keywords)
        self.assertIn("smoke", keywords)
        by_kw = {c.keyword: c for c in concepts}
        self.assertEqual(by_kw["raft"].category, "asset")
        self.assertEqual(by_kw["smoke"].category, "effect")

    def test_a_keyword_is_claimed_by_the_highest_priority_rule(self):
        concepts = self.clip.build_concepts(TAX)
        self.assertEqual(len({c.keyword for c in concepts}), len(concepts), "no duplicates")

    def test_aggregation_ignores_how_many_keywords_a_category_has(self):
        """The bug this guards: summing per category gave `asset` (121 keywords) five
        times the prior of `background` (22) for no reason but YAML verbosity."""
        C = self.clip.Concept
        concepts = [C(keyword=f"a{i}", category="asset", object_type="prop") for i in range(50)]
        concepts.append(C(keyword="sky", category="background", object_type="backdrop"))
        # Every asset label scores weakly; the single background label scores strongly.
        probs = [0.01] * 50 + [0.5]
        ranked, best = self.clip.rank_categories(probs, concepts)
        self.assertEqual(ranked[0][0], "background", "a padded category must not win by bulk")
        self.assertEqual(best["background"][1].keyword, "sky")

    def test_scores_are_renormalised_to_a_distribution(self):
        C = self.clip.Concept
        concepts = [
            C(keyword="a", category="asset", object_type="prop"),
            C(keyword="w", category="environment", object_type="terrain"),
        ]
        ranked, _ = self.clip.rank_categories([0.3, 0.1], concepts)
        self.assertAlmostEqual(sum(score for _, score in ranked), 1.0, places=5)
        self.assertAlmostEqual(ranked[0][1], 0.75, places=5)

    def test_empty_scores_do_not_divide_by_zero(self):
        C = self.clip.Concept
        ranked, _ = self.clip.rank_categories(
            [0.0], [C(keyword="a", category="asset", object_type="prop")]
        )
        self.assertEqual(ranked[0], ("asset", 0.0))

    def test_crop_box_pads_and_clamps(self):
        box = self.clip.crop_box((10, 10, 50, 50), 100, 100)
        x0, y0, x1, y1 = box
        self.assertLess(x0, 10)
        self.assertGreater(x1, 50)
        self.assertGreaterEqual(x0, 0)
        self.assertLessEqual(x1, 100)

    def test_crop_box_rejects_degenerate_boxes(self):
        self.assertIsNone(self.clip.crop_box(None, 100, 100))
        self.assertIsNone(self.clip.crop_box((10, 10, 10, 10), 100, 100))
        self.assertIsNone(self.clip.crop_box((0, 0, 3, 3), 100, 100), "too small to score")


class TestStableIds(unittest.TestCase):
    def test_duplicate_fingerprints_get_deterministic_suffixes(self):
        ids = schema.stable_layer_ids(["aaa", "bbb", "aaa", "aaa"])
        self.assertEqual(ids, ["aaa", "bbb", "aaa#2", "aaa#3"])
        self.assertEqual(len(set(ids)), 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
