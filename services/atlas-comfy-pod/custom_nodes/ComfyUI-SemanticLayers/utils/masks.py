"""Coverage geometry: the measurable facts about a layer.

Everything here is arithmetic on pixels — no model, no guessing. These are the signals
the subject resolver leans on hardest, precisely because they cannot hallucinate.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import torch

from .image import ensure_bhwc

#: Coverage below this is treated as "no meaningful content" when computing a bbox.
_PRESENCE = 0.05


@dataclass
class Coverage:
    area_ratio: float
    bbox: Optional[tuple[int, int, int, int]]  # x0, y0, x1, y1 (exclusive far edge)
    centroid: Optional[tuple[float, float]]  # normalised 0..1
    prominence: float  # normalised bbox diagonal 0..1
    edge_contact: float  # fraction of the frame border the layer touches, 0..1
    is_empty: bool


EMPTY = Coverage(
    area_ratio=0.0, bbox=None, centroid=None, prominence=0.0, edge_contact=0.0, is_empty=True
)


def coverage_from_alpha(alpha: torch.Tensor) -> Coverage:
    """Measure a [1, H, W] coverage map."""
    a = alpha
    if a.ndim == 3:
        a = a[0]
    a = a.detach().float().clamp(0.0, 1.0)
    height, width = a.shape[-2], a.shape[-1]
    if height == 0 or width == 0:
        return EMPTY

    total = float(height * width)
    area_ratio = float(a.sum().item()) / total

    present = a > _PRESENCE
    if not bool(present.any().item()):
        return Coverage(
            area_ratio=area_ratio,
            bbox=None,
            centroid=None,
            prominence=0.0,
            edge_contact=0.0,
            is_empty=True,
        )

    rows = torch.any(present, dim=1).nonzero(as_tuple=False).flatten()
    cols = torch.any(present, dim=0).nonzero(as_tuple=False).flatten()
    y0, y1 = int(rows[0].item()), int(rows[-1].item()) + 1
    x0, x1 = int(cols[0].item()), int(cols[-1].item()) + 1

    weight = a.sum()
    if float(weight.item()) <= 1e-6:
        centroid = ((x0 + x1) / 2.0 / width, (y0 + y1) / 2.0 / height)
    else:
        ys = torch.arange(height, device=a.device, dtype=a.dtype).view(-1, 1)
        xs = torch.arange(width, device=a.device, dtype=a.dtype).view(1, -1)
        cy = float((a * ys).sum().item()) / float(weight.item())
        cx = float((a * xs).sum().item()) / float(weight.item())
        centroid = (cx / width, cy / height)

    diag = math.sqrt(((x1 - x0) / width) ** 2 + ((y1 - y0) / height) ** 2)
    prominence = min(1.0, diag / math.sqrt(2.0))

    border = torch.cat([present[0, :], present[-1, :], present[:, 0], present[:, -1]])
    edge_contact = float(border.float().mean().item())

    return Coverage(
        area_ratio=area_ratio,
        bbox=(x0, y0, x1, y1),
        centroid=centroid,
        prominence=prominence,
        edge_contact=edge_contact,
        is_empty=False,
    )


def coverage_of_layer(image: torch.Tensor, alpha: Optional[torch.Tensor]) -> Coverage:
    """Coverage for a layer, falling back to "the whole frame" when alpha is unknown.

    A layer with no transparency information genuinely does occupy every pixel, so
    area_ratio 1.0 and a centred centroid are the honest measurements — not a guess.
    """
    t = ensure_bhwc(image)
    height, width = t.shape[1], t.shape[2]
    if alpha is not None:
        return coverage_from_alpha(alpha)
    ones = torch.ones((1, height, width), device=t.device, dtype=t.dtype)
    return coverage_from_alpha(ones)
