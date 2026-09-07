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
            from transformers import AutoModelForCausalLM, AutoProcessor
        except ImportError as exc:
            raise AnalyzerUnavailable(
                "the 'florence2' analyzer needs the `transformers` package. Install it "
                "into ComfyUI's python, or switch the analyzer to 'captions' and wire an "
                "existing captioner node into the `captions` input."
            ) from exc

        self._device, self._dtype = _pick_device()
        try:
            self._processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
            self._model = AutoModelForCausalLM.from_pretrained(
                model_id, trust_remote_code=True, torch_dtype=self._dtype
            ).to(self._device).eval()
            self._loaded_id = model_id
        except Exception as exc:  # noqa: BLE001 - offline, gated repo, bad revision…
            raise AnalyzerUnavailable(
                f"could not load Florence-2 model {model_id!r}: {exc}\n"
                "First use downloads it from HuggingFace, so this fails offline. Either "
                "pre-download the repo, or use the 'captions' analyzer with a captioner "
                "node you already have installed."
            ) from exc

        context.note(f"florence2: {model_id} on {self._device} ({self._dtype})")

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
