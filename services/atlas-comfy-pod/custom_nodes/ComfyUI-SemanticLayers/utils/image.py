"""Tensor helpers. ComfyUI conventions: IMAGE is [B, H, W, C] float 0..1, MASK is
[B, H, W] float 0..1 where 1 means "selected"/opaque.

The alpha rules here are deliberately conservative. Qwen-Image-Layered decodes through a
standard VAE, so its layers arrive as 3-channel RGB with no alpha channel at all (see
README). We can *derive* coverage from the pixels, but a derived alpha is a guess about
compositing, not a fact from the model — so every derivation records how it was made in
`alpha_source`, and `auto` returns None when the image gives no honest signal.
"""

from __future__ import annotations

import hashlib
import math
from typing import Iterable, Optional, Sequence

import torch
import torch.nn.functional as F

ALPHA_MODES = (
    "auto", "from_image", "from_mask", "border_key", "black_key", "white_key", "none"
)
MERGE_MODES = ("alpha_over", "max", "mean", "batch", "first")

_SOFT_RANGE = 0.05  # width of the soft edge when keying, in 0..1 luminance
#: Mean absolute deviation below which a border counts as one flat colour.
_UNIFORM_BORDER = 0.06


class LayerShapeError(ValueError):
    """Raised when a tensor cannot be interpreted as a ComfyUI IMAGE."""


def ensure_bhwc(image: torch.Tensor) -> torch.Tensor:
    """Coerce a tensor to [B, H, W, C], or explain exactly why it cannot be."""
    if not isinstance(image, torch.Tensor):
        raise LayerShapeError(
            f"expected an IMAGE tensor, got {type(image).__name__}. Wire a real IMAGE "
            "output (e.g. VAE Decode) into this node."
        )
    t = image
    if t.ndim == 3:
        # [H, W, C] -> add batch. A 3-D tensor whose last dim is big is more likely
        # [B, H, W] (a MASK); treat that as single-channel.
        if t.shape[-1] in (1, 3, 4):
            t = t.unsqueeze(0)
        else:
            t = t.unsqueeze(-1)
    elif t.ndim == 2:
        t = t.unsqueeze(0).unsqueeze(-1)  # [H, W] -> [1, H, W, 1]
    elif t.ndim == 5:
        # A layered latent that reached an IMAGE socket, or a [B,1,H,W,C] singleton.
        if t.shape[1] == 1:
            t = t[:, 0]
        else:
            raise LayerShapeError(
                f"got a 5-D tensor {tuple(t.shape)} on an IMAGE input. A Qwen layered "
                "LATENT must go through 'Latent Cut To Batch' (dim=t) and 'VAE Decode' "
                "before it becomes an IMAGE."
            )
    if t.ndim != 4:
        raise LayerShapeError(
            f"cannot read {tuple(image.shape)} as an IMAGE; expected [B, H, W, C]"
        )
    if t.shape[-1] not in (1, 3, 4):
        raise LayerShapeError(
            f"IMAGE has {t.shape[-1]} channels; expected 1, 3 or 4 (shape {tuple(t.shape)})"
        )
    return t.float() if t.dtype != torch.float32 else t


def split_batch(image: torch.Tensor) -> list[torch.Tensor]:
    """[B, H, W, C] -> B tensors of [1, H, W, C]. This is how a Qwen layer batch is
    turned into individual layers."""
    t = ensure_bhwc(image)
    return [t[i : i + 1] for i in range(t.shape[0])]


def rgb_of(image: torch.Tensor) -> torch.Tensor:
    """Drop alpha, expand greyscale — always returns 3 channels, never destructively
    (the alpha channel is read separately by `alpha_channel`)."""
    t = ensure_bhwc(image)
    c = t.shape[-1]
    if c == 3:
        return t
    if c == 4:
        return t[..., :3]
    return t.repeat(1, 1, 1, 3)


def alpha_channel(image: torch.Tensor) -> Optional[torch.Tensor]:
    """The image's own alpha, if it actually has one. None is not "opaque" — it is
    "unknown", and callers must keep that distinction."""
    t = ensure_bhwc(image)
    if t.shape[-1] == 4:
        return t[..., 3].clone()
    return None


def _luma(rgb: torch.Tensor) -> torch.Tensor:
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).clamp(0.0, 1.0)


def _border_pixels(rgb: torch.Tensor) -> torch.Tensor:
    """The 1-px frame as [N, 3] — our only evidence of what "empty" looks like."""
    t = rgb[0]
    if t.shape[0] < 2 or t.shape[1] < 2:
        return t.reshape(-1, 3)
    return torch.cat([t[0, :, :], t[-1, :, :], t[:, 0, :], t[:, -1, :]], dim=0)


def _border_luma(rgb: torch.Tensor) -> float:
    """Mean luminance of the 1-px frame — used to guess what the empty area looks like."""
    lum = _luma(rgb)[0]
    if lum.numel() == 0:
        return 0.5
    edges = torch.cat([lum[0, :], lum[-1, :], lum[:, 0], lum[:, -1]])
    return float(edges.mean().item())


def _border_colour(rgb: torch.Tensor) -> tuple[torch.Tensor, float]:
    """(median border colour [3], how uniform the border is as a std).

    Qwen-Image-Layered does not clear a layer's empty area to black or white — it comes
    back a flat mid-tone (a brown-grey on the layers we measured). Luminance keying
    cannot see that, so the empty region has to be identified by COLOUR instead.
    """
    px = _border_pixels(rgb)
    if px.numel() == 0:
        return torch.zeros(3, device=rgb.device, dtype=rgb.dtype), 1.0
    median = px.median(dim=0).values
    spread = float((px - median).abs().mean().item())
    return median, spread


def derive_alpha(
    image: torch.Tensor,
    mode: str = "auto",
    tolerance: float = 0.04,
    mask: Optional[torch.Tensor] = None,
) -> tuple[Optional[torch.Tensor], str]:
    """Return (alpha [1,H,W] or None, alpha_source).

    `auto` prefers a real alpha channel, then an explicit mask, then keys against a
    uniform black/white border. If the border is neither, it returns None rather than
    inventing coverage.
    """
    t = ensure_bhwc(image)
    if mode == "none":
        return None, "none"

    if mode in ("auto", "from_image"):
        own = alpha_channel(t)
        if own is not None:
            return own.clamp(0.0, 1.0), "image_alpha"
        if mode == "from_image":
            return None, "none"

    if mode in ("auto", "from_mask"):
        if mask is not None:
            m = normalise_mask(mask, t.shape[1], t.shape[2])
            return m, "mask_input"
        if mode == "from_mask":
            return None, "none"

    rgb = rgb_of(t)
    if mode == "auto":
        border = _border_luma(rgb)
        if border <= 0.12:
            mode = "black_key"
        elif border >= 0.88:
            mode = "white_key"
        else:
            # Not black or white — but if the border is a UNIFORM colour, that colour is
            # the layer's "empty". This is the real Qwen-Image-Layered case: its cleared
            # areas come back a flat mid-tone, which luminance keying is blind to.
            _, spread = _border_colour(rgb)
            if spread <= _UNIFORM_BORDER:
                mode = "border_key"
            else:
                # A genuinely varied border means the layer fills the frame, or the
                # empty colour is unknowable. Say so instead of guessing.
                return None, "none"

    if mode == "border_key":
        median, spread = _border_colour(rgb)
        # Distance in RGB from the empty colour, normalised to 0..1.
        dist = ((rgb - median.view(1, 1, 1, 3)) ** 2).sum(dim=-1).sqrt() / math.sqrt(3.0)
        # A noisier flat needs more distance before a pixel counts as content, so the
        # threshold adapts rather than needing a hand-tuned tolerance per image.
        threshold = tolerance + 2.0 * spread
        alpha = (dist - threshold) / max(_SOFT_RANGE, 1e-5)
        return alpha.clamp(0.0, 1.0), "border_key"

    lum = _luma(rgb)
    if mode == "black_key":
        alpha = (lum - tolerance) / max(_SOFT_RANGE, 1e-5)
        return alpha.clamp(0.0, 1.0), "black_key"
    if mode == "white_key":
        alpha = ((1.0 - lum) - tolerance) / max(_SOFT_RANGE, 1e-5)
        return alpha.clamp(0.0, 1.0), "white_key"

    return None, "none"


def normalise_mask(mask: torch.Tensor, height: int, width: int) -> torch.Tensor:
    """Coerce a MASK to [1, H, W] at the given size."""
    m = mask
    if not isinstance(m, torch.Tensor):
        raise LayerShapeError(f"expected a MASK tensor, got {type(m).__name__}")
    m = m.float()
    if m.ndim == 2:
        m = m.unsqueeze(0)
    elif m.ndim == 4:  # [B,H,W,1] from a node that emitted an image-shaped mask
        m = m[..., 0]
    if m.ndim != 3:
        raise LayerShapeError(f"cannot read {tuple(mask.shape)} as a MASK; expected [B, H, W]")
    m = m[:1]
    if m.shape[1] != height or m.shape[2] != width:
        m = F.interpolate(m.unsqueeze(1), size=(height, width), mode="bilinear", align_corners=False)[
            :, 0
        ]
    return m.clamp(0.0, 1.0)


def resize_to(image: torch.Tensor, height: int, width: int) -> torch.Tensor:
    t = ensure_bhwc(image)
    if t.shape[1] == height and t.shape[2] == width:
        return t
    chw = t.permute(0, 3, 1, 2)
    out = F.interpolate(chw, size=(height, width), mode="bilinear", align_corners=False)
    return out.permute(0, 2, 3, 1).clamp(0.0, 1.0)


def blank_image(
    height: int, width: int, channels: int = 3, like: Optional[torch.Tensor] = None
) -> torch.Tensor:
    """A fully black, fully transparent-by-convention placeholder for an empty output.

    ComfyUI IMAGE sockets cannot carry "nothing" without breaking every downstream node,
    so an empty role emits this plus an all-zero MASK. The mask being zero everywhere is
    the machine-readable way to say "this role matched no layers".
    """
    kwargs = {}
    if like is not None:
        kwargs = {"device": like.device, "dtype": like.dtype}
    return torch.zeros((1, max(1, height), max(1, width), channels), **kwargs)


def composite_over(
    dst_rgb: torch.Tensor,
    dst_a: torch.Tensor,
    src_rgb: torch.Tensor,
    src_a: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Standard non-premultiplied source-over. Shapes: rgb [1,H,W,3], a [1,H,W]."""
    sa = src_a.unsqueeze(-1)
    da = dst_a.unsqueeze(-1)
    out_a = sa + da * (1.0 - sa)
    out_rgb = (src_rgb * sa + dst_rgb * da * (1.0 - sa)) / out_a.clamp(min=1e-6)
    return out_rgb.clamp(0.0, 1.0), out_a[..., 0].clamp(0.0, 1.0)


def merge_layers(
    images: Sequence[torch.Tensor],
    alphas: Sequence[Optional[torch.Tensor]],
    mode: str = "alpha_over",
) -> tuple[torch.Tensor, torch.Tensor]:
    """Combine same-role layers into one IMAGE + MASK.

    Layers whose alpha is unknown are treated as fully opaque for compositing — which
    means, in `alpha_over`, that a later opaque layer hides an earlier one. That is the
    correct reading of "no transparency information", not a bug; use `batch` to keep
    every layer separate, or supply masks so the real coverage is known.
    """
    if not images:
        raise ValueError("merge_layers called with no layers")

    height, width = images[0].shape[1], images[0].shape[2]
    rgbs = [rgb_of(resize_to(img, height, width)) for img in images]

    covs: list[torch.Tensor] = []
    for rgb, alpha in zip(rgbs, alphas):
        if alpha is None:
            covs.append(torch.ones((1, height, width), device=rgb.device, dtype=rgb.dtype))
        else:
            covs.append(normalise_mask(alpha, height, width))

    if mode == "batch":
        return torch.cat(rgbs, dim=0), torch.cat(covs, dim=0)

    if mode == "first":
        return rgbs[0], covs[0]

    if mode == "max":
        stacked = torch.stack([r * c.unsqueeze(-1) for r, c in zip(rgbs, covs)], dim=0)
        return stacked.max(dim=0).values.clamp(0.0, 1.0), torch.stack(covs, 0).max(0).values

    if mode == "mean":
        weight = torch.stack(covs, dim=0).unsqueeze(-1)  # [N,1,H,W,1]
        stacked = torch.stack(rgbs, dim=0) * weight
        denom = weight.sum(dim=0).clamp(min=1e-6)
        return (stacked.sum(dim=0) / denom).clamp(0.0, 1.0), torch.stack(covs, 0).mean(0)

    # alpha_over (default)
    out_rgb = torch.zeros_like(rgbs[0])
    out_a = torch.zeros((1, height, width), device=rgbs[0].device, dtype=rgbs[0].dtype)
    for rgb, cov in zip(rgbs, covs):
        out_rgb, out_a = composite_over(out_rgb, out_a, rgb, cov)
    return out_rgb, out_a


def with_alpha(rgb: torch.Tensor, alpha: torch.Tensor) -> torch.Tensor:
    """[B,H,W,3] + [B,H,W] -> [B,H,W,4].

    ComfyUI IMAGE tensors may carry four channels — that is how a decomposed layer keeps
    its transparency through a graph, and what SplitImageWithAlpha exists to take apart.
    """
    base = rgb_of(ensure_bhwc(rgb))
    a = alpha if alpha.ndim == 4 else alpha.unsqueeze(-1)
    if a.shape[0] == 1 and base.shape[0] > 1:
        a = a.expand(base.shape[0], -1, -1, -1)
    return torch.cat([base, a.clamp(0.0, 1.0).to(base.dtype)], dim=-1)


def to_pil(image: torch.Tensor):
    """[1,H,W,C] -> PIL.Image. Used by VLM backends and the contact sheet."""
    from PIL import Image

    t = ensure_bhwc(image)[0]
    arr = (t.detach().cpu().clamp(0.0, 1.0) * 255.0).round().to(torch.uint8).numpy()
    if arr.shape[-1] == 1:
        return Image.fromarray(arr[..., 0], mode="L")
    if arr.shape[-1] == 4:
        return Image.fromarray(arr, mode="RGBA")
    return Image.fromarray(arr, mode="RGB")


def from_pil(image) -> torch.Tensor:
    """PIL.Image -> [1,H,W,C] IMAGE tensor."""
    import numpy as np

    arr = np.asarray(image).astype("float32") / 255.0
    if arr.ndim == 2:
        arr = arr[..., None]
    return torch.from_numpy(arr).unsqueeze(0)


def fingerprint(image: torch.Tensor, size: int = 32, length: int = 12) -> str:
    """Deterministic content hash of one layer.

    This is what makes layer ids order-independent AND makes analyzer caching safe: the
    same pixels always produce the same id, in any position, in any run.
    """
    t = ensure_bhwc(image)[:1]
    chw = t.permute(0, 3, 1, 2).detach().to(torch.float32).cpu()
    pooled = F.adaptive_avg_pool2d(chw, (size, size))
    quantised = (pooled.clamp(0.0, 1.0) * 255.0).round().to(torch.uint8).numpy().tobytes()
    digest = hashlib.sha1(quantised + repr((t.shape[1], t.shape[2], t.shape[3])).encode())
    return digest.hexdigest()[:length]
