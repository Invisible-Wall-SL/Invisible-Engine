# ComfyUI-SemanticLayers

Turns the **variable, unordered** layer output of an image-decomposition model into a
**fixed semantic interface**:

```
BACKGROUND · MAIN_CHARACTER · SECONDARY_CHARACTERS · ASSETS · ENVIRONMENT · EFFECTS · OTHER
```

3 layers in, 7 layers in, 12 layers in — downstream nodes see the same seven sockets and
never need to know how many layers arrived or what order they came in.

```
Qwen Image Layered (or any decomposer)
      ↓
Semantic Layer Normalize     → SEMANTIC_LAYERS  (stable ids, alpha, measured geometry)
      ↓
Semantic Layer Analyze       → LAYER_METADATA   ("what is this?")
      ↓
Semantic Subject Resolver    → LAYER_METADATA   ("which character is THE character?")
      ↓
Semantic Layer Router        → the seven fixed outputs + SEMANTIC_ASSETS
      ↓
Semantic Layer Debug         → contact sheet + metadata JSON
```

---

## What the installed Qwen implementation actually does

Verified against this machine, not assumed. **ComfyUI 0.21.0**, portable build at
`C:\Invisible Wall SL\ComfyUI\ComfyUI_windows_portable`, running with
`--base-directory C:\Invisible Wall SL\ComfyUI\Shared`.

* **There is no third-party "Qwen Image Layered" custom node.** The support is
  **built into ComfyUI core**: `comfy_extras/nodes_qwen.py` defines
  **`EmptyQwenImageLayeredLatentImage`** (display name *Empty Qwen Image Layered Latent*),
  the only layered-specific node in the 1139 the server reports.
* Its output is a **5-D LATENT**: `torch.zeros([batch, 16, layers + 1, H/8, W/8])`.
  Note the `layers + 1` — you get one plane more than you asked for.
* **Layers are not separate outputs, not masks, and not an alpha stack.** The official
  workflow template (`comfyui_workflow_templates_media_image/templates/
  image_qwen_image_layered.json`, inside two subgraphs) folds the layer axis into the
  batch axis with **`LatentCutToBatch(dim="t", slice_size=1)`** and then runs a single
  **`VAEDecode`**. So the layers reach the graph as **one IMAGE batch of `layers + 1`
  frames**.
* **No alpha.** Nothing in `comfy/` ever sets a VAE's `output_channels` to 4, and
  `VAE.decode` clamps pixels to `self.output_channels`, so decode returns **3-channel
  RGB**. There is also **no per-layer metadata** of any kind — no labels, no ordering
  contract, nothing to read.
* Skipping `LatentCutToBatch` silently destroys the layers: `comfy/sd.py:984` does
  `if self.latent_dim == 2 and samples_in.ndim == 5: samples_in = samples_in[:, :, 0]`,
  i.e. it decodes **plane 0 only** and throws the rest away.
* The models themselves (`qwen_image_layered_bf16.safetensors`,
  `qwen_image_layered_vae.safetensors`, `qwen_2.5_vl_7b_fp8_scaled.safetensors`) are
  **not present** in `Shared\Models` — download them before running the example workflow.

**Consequences for this extension**, all of which it handles explicitly:

1. It must accept an arbitrary-length IMAGE batch — that is the entire interface.
2. It cannot read alpha; it has to *measure* coverage, and must be honest when the
   pixels give no usable signal (see *Alpha handling* below).
3. It cannot trust the `+1` plane to be at any particular index, so it never assumes —
   `composite_layer` is an explicit, opt-in setting.

---

## Install

The extension is self-contained and has **no pip dependencies** — torch, PyYAML, numpy
and Pillow all ship with ComfyUI.

Copy or link the folder into your `custom_nodes` directory (the one under
`--base-directory` if you use one):

```bash
# Windows, keeping the repo as the source of truth
cmd /c mklink /J "C:\Invisible Wall SL\ComfyUI\Shared\custom_nodes\ComfyUI-SemanticLayers" "C:\Invisible Wall SL\Engine\Invisible Engine\services\atlas-comfy-pod\custom_nodes\ComfyUI-SemanticLayers"
```

```bash
# Linux / macOS
ln -s /path/to/repo/services/atlas-comfy-pod/custom_nodes/ComfyUI-SemanticLayers \
      /path/to/ComfyUI/custom_nodes/ComfyUI-SemanticLayers
```

Then **restart ComfyUI** (a browser refresh is not enough — node classes are registered
at server start). The nodes appear under the **`semantic layers`** category, and
`/object_info` will list `SemanticLayerNormalize` and friends.

Load `example_workflows/qwen_image_layered_semantic.json` to get the whole chain wired.

---

## The nodes

| Node | Does |
|---|---|
| **Semantic Layer Normalize** | IMAGE batch → `SEMANTIC_LAYERS`. Stable content-derived ids, alpha/mask preservation, measured geometry. |
| **Semantic Layer Analyze** | Runs a pluggable analyzer, classifies descriptions through the taxonomy. Produces categories — never roles. |
| **Semantic Subject Resolver** | Picks the main character from the detected characters using weighted, measurable signals. |
| **Semantic Layer Router** | The fixed seven outputs, plus `SEMANTIC_ASSETS`, routed `SEMANTIC_LAYERS`, `LAYER_METADATA` and a report. |
| **Semantic Asset Selector** | Filter/select assets by object type or label; merge or keep as a batch. |
| **Semantic Role Select** | IMAGE **+ MASK** for any single role, including `UNRESOLVED`. |
| **Semantic Layer Debug** | Contact sheet (id, label, category, role, confidence) + metadata JSON. |
| **Semantic Cache Clear** | Drop cached analyzer observations. |

### Custom socket types

`SEMANTIC_LAYERS`, `LAYER_METADATA`, `SEMANTIC_ASSETS` — real Python objects passed on
the graph, not JSON strings. ComfyUI only connects sockets whose type names match, so an
`IMAGE` can never be wired where a layer set is expected.

---

## Semantics vs role — the central split

The model is asked **what is this?**; the pipeline decides **what role should it have?**

```
semantic_category = character        does NOT mean        role = MAIN_CHARACTER
```

An analyzer can be completely correct that a layer shows a person and still have no
basis for calling that person the subject — that is a relational judgement about the
whole set. So classification stops at `character`, the taxonomy's `default_role` for
`character` is `SECONDARY_CHARACTER`, and only the **Subject Resolver** ever promotes
one layer to `MAIN_CHARACTER`.

**Decision priority**, highest first:

1. explicit manual override
2. deterministic semantic rules (taxonomy `category → default_role`)
3. subject resolver
4. AI/VLM classification (feeds 2)
5. fallback to `UNRESOLVED`

---

## Why order never matters

* `layer_id` is a **content hash** (32×32 average-pooled, quantised, SHA-1). The same
  pixels get the same id in any position, in any run.
* Everything downstream keys on `layer_id`, never on list position.
* Ties in the subject ranking break on `layer_id`, never on index.
* `layer_order_weight` defaults to **0.0** — using incoming order is opt-in.
* Same-role layers composite in `area_desc` order (largest first = furthest back), which
  is a property of the content. Set `merge_order = "source"` if you *want* the
  decomposer's order; it is the one setting that reintroduces the dependency.

`tests/test_semantic.py` shuffles a 7-layer scene 25 ways and asserts byte-identical
assignments; `tests/test_pipeline.py` does the same end-to-end and additionally asserts
the **composited pixels** match.

---

## Analyzers

Selected on the Analyze node. Add your own by subclassing `BaseSemanticAnalyzer` and
calling `register_analyzer` — it appears in the dropdown automatically.

| Analyzer | Needs | Notes |
|---|---|---|
| **`captions`** *(default)* | text | Model-agnostic and recommended. Feed any captioner's STRING output — or type it. |
| **`geometry`** | nothing | Coverage/edge statistics only. Flags full-frame backdrops; **will never claim a character**, because pixels alone cannot tell a person from a chair. |
| **`florence2`** | weights | Real VLM captioning via `transformers`. **Not installed on this machine** — downloads from HuggingFace on first use. |
| **`stub`** | scripted dict | Tests. Returns only what it is given. |

Caption input format — keyed by index or layer id (recommended), or one per line
positionally:

```
0 = blue sky and distant clouds
1 = a woman wearing a red jacket
2 = a wooden chair
```

### Confidence composition

```
metadata.confidence = observation.confidence × rule.confidence
```

The first factor is how much the backend trusts its own description; the second is how
cleanly that description maps onto a category. A hand-written caption hitting a keyword
exactly gives `1.00 × 0.90 = 0.90` (auto-routed). A geometry backdrop guess gives
`0.72 × 0.90 = 0.65` — inside the review band, so it routes but is flagged.

| Band | Default | Behaviour |
|---|---|---|
| `≥ auto_threshold` | 0.85 | routed silently |
| `≥ uncertain_threshold` | 0.60 | routed, `uncertain = True`, shown in the report and the contact sheet |
| below | — | `UNRESOLVED` — never forced into a category to fill an output |

---

## Alpha handling

Qwen layers arrive as **opaque RGB**, so coverage has to be derived. `alpha_mode`:

| Mode | Behaviour |
|---|---|
| `auto` *(default)* | real alpha channel → mask input → key against a **uniform** black/white border. If the border is neither, returns **none** rather than inventing coverage. |
| `from_image` | only a genuine 4th channel |
| `from_mask` | only the MASK input |
| `black_key` / `white_key` | force a key |
| `none` | no coverage at all |

Every layer records how its coverage was obtained in `alpha_source`, so a derived alpha
is never mistaken for a fact from the model. A layer with **no** coverage information
honestly measures as full-frame (`area_ratio = 1.0`) — it really does occupy every pixel.

When merging, layers with unknown alpha are treated as opaque, so in `alpha_over` a
later layer hides an earlier one. That is the correct reading of "no transparency
information". Use `merge_mode = "batch"` to keep every layer as a separate frame, or
supply masks.

---

## Configuration

### Taxonomy (`configs/default_taxonomy.yaml`)

Roles, category properties and every keyword rule live in YAML — no keyword is
hard-coded in Python. Copy the file, edit it, and point `taxonomy_path` at your copy.

```yaml
categories:
  character:
    default_role: SECONDARY_CHARACTER   # MAIN_CHARACTER is the resolver's job
    is_character: true
    importance: 1.00

rules:
  - category: effect
    object_type: particles
    priority: 90                        # effects beat backdrop keywords
    keywords: [smoke, fire, sparks, glow, mist, ...]
```

Highest-priority keyword hit wins; ties break on the longest match, so
`"light rays"` beats `"light"`. Matching is **word-anchored** — an unanchored substring
search matches `ground` inside `background` and quietly mis-routes a backdrop.

### Subject scoring weights (Subject Resolver)

```
score = (area·wa + centrality·wc + prominence·wp + importance·ws + confidence·wf + order·wo)
        ────────────────────────────────────────────────────────────────────────────────────
                                   wa + wc + wp + ws + wf + wo
```

Defaults: area 1.0, centrality 1.0, prominence 0.7, semantic 1.0, confidence 0.5,
**layer order 0.0**. `ambiguity_margin > 0` flags a too-close call as uncertain instead
of pretending the winner was clear.

### Overrides (Router)

Highest priority of anything. One per line; `#` comments allowed:

```
4 = main_character     # by original layer index
chair = EFFECT         # by stable layer id
2 -> background
```

Unparseable lines and keys that match no layer are **reported**, never silently dropped.

### Review modes (Router)

* **AUTO** — route automatically.
* **REVIEW** — route, but report every confidence for inspection.
* **MANUAL** — route **only** what the overrides name; everything else is `UNRESOLVED`.

---

## Empty outputs

If no layer is a character, `MAIN_CHARACTER` emits a **black frame with an all-zero
mask** — never an invented layer. A ComfyUI `IMAGE` socket cannot carry "nothing"
without breaking downstream nodes, so the all-zero mask is the machine-readable "this
role matched no layers". The router's report names every empty role, and
`Semantic Role Select` returns `count = 0`.

---

## Tests

```bash
"C:\Invisible Wall SL\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe" tests/run_tests.py
```

45 tests. `test_semantic.py` (25) is pure logic — no torch, no ComfyUI, runs anywhere.
`test_pipeline.py` (20) drives the real node classes with real tensors.

---

## Extending

* **New decomposer** — only `nodes/normalize.py` knows the input format. Everything
  downstream consumes `SEMANTIC_LAYERS`.
* **New analyzer** — subclass `BaseSemanticAnalyzer`, `@register_analyzer`.
* **New category or keyword** — edit the YAML.
* **New role** — add it to `roles:` in the YAML. It routes to `OTHER` until you give it
  a dedicated output in `ROUTER_OUTPUT_ROLES`; reachable immediately via
  `Semantic Role Select`.
