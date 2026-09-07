"""Optional Florence-2 VLM backend.

This is a *reference* implementation of the analyzer interface against a real vision
model, not a hard dependency. It is unavailable until the weights are fetched, and it
says so plainly instead of degrading into invented captions.

Note on this machine: no Florence-2 weights are present under the ComfyUI models tree,
so selecting this backend triggers a HuggingFace download on first use (~0.5 GB for
`base`, ~1.5 GB for `large`). Prefer the `captions` backend to reuse a captioner you
already have in the graph.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

from .base import (
    AnalysisContext,
    AnalyzerUnavailable,
    BaseSemanticAnalyzer,
    LayerObservation,
    register_analyzer,
)
from ..semantic.schema import SemanticLayer, SemanticLayerSet
from ..utils.image import to_pil

MODELS = (
    "microsoft/Florence-2-base",
    "microsoft/Florence-2-base-ft",
    "microsoft/Florence-2-large",
    "microsoft/Florence-2-large-ft",
)

#: Florence-2 task prompts, shortest to most verbose.
TASKS = ("<CAPTION>", "<DETAILED_CAPTION>", "<MORE_DETAILED_CAPTION>")


#: transformers gained a first-party Florence-2 implementation in 4.51. At or above
#: this, loading via trust_remote_code is not just unnecessary but actively wrong.
NATIVE_SINCE = (4, 51)


def use_native_loader(version: str) -> bool:
    """Whether to use transformers' own Florence-2 instead of the model repo's code.

    Compares numerically, not as strings — "4.9.0" sorts after "4.51.0" lexically, which
    would pick the wrong loader on exactly the versions the split exists for.
    """
    head = version.split("+", 1)[0].split(".")[:2]
    try:
        parts = tuple(int(p) for p in head)
    except ValueError:
        return True  # unrecognised (dev build, "unknown") -> assume modern
    if len(parts) < 2:
        return True
    return parts >= NATIVE_SINCE


def _transformers_version() -> str:
    try:
        import transformers

        return getattr(transformers, "__version__", "unknown")
    except Exception:  # noqa: BLE001
        return "not installed"


#: Attributes Florence-2's remote modeling code reads off its config, which newer
#: transformers releases no longer synthesise. Seeing any of these in the failure means
#: version skew, not a download problem — and saying "download it again" wastes an hour.
_CONFIG_SKEW_MARKERS = (
    "forced_bos_token_id",
    "Florence2LanguageConfig",
    "Florence2Config",
    "_supports_sdpa",
)


def _diagnose(exc: Exception, model_id: str) -> str:
    """Turn a load failure into the sentence that actually names the cause."""
    text = str(exc)
    version = _transformers_version()

    if any(marker in text for marker in _CONFIG_SKEW_MARKERS):
        return (
            f"Florence-2 ({model_id}) hit the legacy trust_remote_code path on "
            f"transformers {version}, which should not happen.\n"
            f"  underlying error: {text}\n"
            "The weights are fine — this error comes from the MODEL REPO's own modeling "
            "code reading config attributes modern transformers no longer synthesises. "
            f"transformers >= {NATIVE_SINCE[0]}.{NATIVE_SINCE[1]} ships Florence-2 "
            "natively and this analyzer is supposed to use that class instead. Seeing "
            "this means the version check picked wrong — please report the version above. "
            "Workaround meanwhile: use the 'captions' analyzer. Do NOT pin transformers "
            "backwards; that drags every other custom node with it."
        )

    lowered = text.lower()
    if any(w in lowered for w in ("connection", "offline", "resolve", "timed out", "network")):
        return (
            f"could not download Florence-2 model {model_id!r}: {text}\n"
            "First use fetches it from HuggingFace, so this fails without network access. "
            "Pre-download the repo, or use the 'captions' analyzer instead."
        )

    return (
        f"could not load Florence-2 model {model_id!r} (transformers {version}): {text}\n"
        "Use the 'captions' analyzer with a captioner node you already have installed — "
        "it loads no model and needs no weights."
    )


def _pick_device() -> tuple[Any, Any]:
    import torch

    try:  # ComfyUI's allocator knows about the rest of the graph's VRAM use
        import comfy.model_management as mm

        device = mm.get_torch_device()
        dtype = torch.float16 if mm.should_use_fp16(device) else torch.float32
        return device, dtype
    except Exception:  # noqa: BLE001 - standalone / test use
        if torch.cuda.is_available():
            return torch.device("cuda"), torch.float16
        return torch.device("cpu"), torch.float32


@register_analyzer
class Florence2Analyzer(BaseSemanticAnalyzer):
    name = "florence2"
    description = (
        "Florence-2 captioning via transformers. Downloads weights on first use; "
        "raises a clear error if unavailable rather than guessing."
    )

    def __init__(self) -> None:
        self._model = None
        self._processor = None
        self._device = None
        self._dtype = None
        self._loaded_id = ""

    def prepare(self, layer_set: SemanticLayerSet, context: AnalysisContext) -> None:
        model_id = str(context.settings.get("florence_model", MODELS[0]))
        if self._model is not None and self._loaded_id == model_id:
            return

        try:
            import transformers
            from transformers import AutoProcessor
        except ImportError as exc:
            raise AnalyzerUnavailable(
                "the 'florence2' analyzer needs the `transformers` package. Install it "
                "into ComfyUI's python, or switch the analyzer to 'captions' and wire an "
                "existing captioner node into the `captions` input."
            ) from exc

        self._device, self._dtype = _pick_device()
        native = use_native_loader(transformers.__version__)
        try:
            if native:
                # transformers >= 4.51 ships Florence-2 itself. Loading it through the
                # legacy trust_remote_code path instead pulls the model repo's own stale
                # modeling code, which reads config attributes modern transformers no
                # longer synthesises — that is where 'forced_bos_token_id' comes from.
                # The weights are fine; only the code path was wrong.
                from transformers import Florence2ForConditionalGeneration

                self._processor = AutoProcessor.from_pretrained(model_id)
                self._model = (
                    Florence2ForConditionalGeneration.from_pretrained(
                        model_id, torch_dtype=self._dtype
                    )
                    .to(self._device)
                    .eval()
                )
            else:
                from unittest.mock import patch as _patch

                from transformers import AutoModelForCausalLM
                from transformers.dynamic_module_utils import get_imports

                # Older transformers needs the remote code, whose import list names
                # flash_attn even on machines that cannot build it.
                def _drop_flash_attn(filename):
                    return [i for i in get_imports(filename) if i != "flash_attn"]

                with _patch(
                    "transformers.dynamic_module_utils.get_imports", _drop_flash_attn
                ):
                    self._processor = AutoProcessor.from_pretrained(
                        model_id, trust_remote_code=True
                    )
                    self._model = (
                        AutoModelForCausalLM.from_pretrained(
                            model_id, trust_remote_code=True, torch_dtype=self._dtype
                        )
                        .to(self._device)
                        .eval()
                    )
            self._loaded_id = model_id
        except Exception as exc:  # noqa: BLE001 - offline, gated repo, version skew…
            raise AnalyzerUnavailable(_diagnose(exc, model_id)) from exc

        context.note(
            f"florence2: {model_id} on {self._device} ({self._dtype}) via the "
            f"{'native transformers' if native else 'legacy trust_remote_code'} loader "
            f"(transformers {transformers.__version__})"
        )

    def analyze(self, layer: SemanticLayer, context: AnalysisContext) -> LayerObservation:
        return self.analyze_many([layer], context)[0]

    def analyze_many(
        self, layers: Sequence[SemanticLayer], context: AnalysisContext
    ) -> list[LayerObservation]:
        if self._model is None or self._processor is None:
            raise AnalyzerUnavailable("florence2 analyzer used before prepare() succeeded")

        import torch

        task = str(context.settings.get("florence_task", TASKS[1]))
        if task not in TASKS:
            task = TASKS[1]
        max_new_tokens = int(context.settings.get("florence_max_tokens", 256))

        out: list[LayerObservation] = []
        for layer in layers:
            image = to_pil(layer.image).convert("RGB")
            inputs = self._processor(text=task, images=image, return_tensors="pt")
            inputs = {
                k: (v.to(self._device, self._dtype) if v.dtype.is_floating_point else v.to(self._device))
                for k, v in inputs.items()
            }
            with torch.inference_mode():
                generated = self._model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=max_new_tokens,
                    num_beams=3,
                    do_sample=False,
                )
            text = self._processor.batch_decode(generated, skip_special_tokens=False)[0]
            parsed = self._processor.post_process_generation(
                text, task=task, image_size=image.size
            )
            description = str(parsed.get(task, "")).strip()

            out.append(
                LayerObservation(
                    description=description,
                    # Florence-2 emits no calibrated score. Reporting a fixed, clearly
                    # documented value beats inventing a probability it never produced.
                    confidence=float(context.settings.get("florence_confidence", 0.80)),
                    extra={"task": task, "model": self._loaded_id},
                )
            )
        return out

    def close(self) -> None:
        self._model = None
        self._processor = None
        self._loaded_id = ""
        try:
            import comfy.model_management as mm

            mm.soft_empty_cache()
        except Exception:  # noqa: BLE001
            pass
