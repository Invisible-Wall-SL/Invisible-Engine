"""Content-addressed cache for analyzer observations.

Re-running a graph in ComfyUI re-executes every node whose inputs changed. Changing a
router weight should not re-run a VLM over eight layers, so observations are keyed by
(analyzer, analyzer settings, layer content hash) — the layer id already IS a content
hash, so identical pixels hit the cache across runs, across graphs, and regardless of
what position the layer arrived in.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from typing import Any, Optional

_DEFAULT_CAPACITY = 512


class ObservationCache:
    """A small thread-safe LRU. Bounded so a long session cannot grow without limit."""

    def __init__(self, capacity: int = _DEFAULT_CAPACITY) -> None:
        self._capacity = max(1, capacity)
        self._store: "OrderedDict[str, Any]" = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def key(analyzer: str, layer_id: str, settings: Optional[dict[str, Any]] = None) -> str:
        blob = json.dumps(settings or {}, sort_keys=True, default=str)
        digest = hashlib.sha1(blob.encode("utf-8")).hexdigest()[:8]
        return f"{analyzer}:{digest}:{layer_id}"

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
                self.hits += 1
                return self._store[key]
            self.misses += 1
            return None

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            while len(self._store) > self._capacity:
                self._store.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self.hits = 0
            self.misses = 0

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"entries": len(self._store), "hits": self.hits, "misses": self.misses}


#: Process-wide cache shared by every analyzer instance.
CACHE = ObservationCache()
