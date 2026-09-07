"""Text -> semantic_category matching.

This module answers only "WHAT IS THIS?". It never returns a role. Keeping the two
apart is what lets a character be classified confidently while the main-character
decision stays relational and lives in scoring.py / the subject resolver.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from .taxonomy import Category, Taxonomy

#: Whole-word match (with a plural suffix) — full confidence in the keyword hit.
EXACT_CONFIDENCE = 0.90
#: Word-START prefix match ("smoke" in "smokestack") — weaker evidence.
LOOSE_CONFIDENCE = 0.70


@dataclass
class RuleMatch:
    category: str
    object_type: str
    confidence: float
    keyword: str
    exact: bool

    @property
    def matched(self) -> bool:
        return self.category != Category.UNKNOWN


NO_MATCH = RuleMatch(
    category=Category.UNKNOWN, object_type="", confidence=0.0, keyword="", exact=False
)

_WORD_CACHE: dict[str, re.Pattern[str]] = {}
_PREFIX_CACHE: dict[str, re.Pattern[str]] = {}


def _word_pattern(keyword: str) -> re.Pattern[str]:
    pat = _WORD_CACHE.get(keyword)
    if pat is None:
        pat = re.compile(r"(?<!\w)" + re.escape(keyword) + r"(?:s|es)?(?!\w)", re.IGNORECASE)
        _WORD_CACHE[keyword] = pat
    return pat


def _prefix_pattern(keyword: str) -> re.Pattern[str]:
    """Keyword at the START of a word, plus any suffix.

    The leading boundary is essential: a plain substring search matches "ground" inside
    "background" and quietly routes a backdrop to ENVIRONMENT.
    """
    pat = _PREFIX_CACHE.get(keyword)
    if pat is None:
        pat = re.compile(r"(?<!\w)" + re.escape(keyword) + r"\w*", re.IGNORECASE)
        _PREFIX_CACHE[keyword] = pat
    return pat


def classify_text(text: str, taxonomy: Taxonomy) -> RuleMatch:
    """Best rule hit for a free-text description.

    Selection order: highest rule priority, then exact-over-loose, then the LONGEST
    matched keyword. Length matters because "light rays" and "light" can both hit and
    the more specific phrase is the better description of the layer.
    """
    if not text or not text.strip():
        return NO_MATCH

    haystack = text.strip().lower()
    best: Optional[RuleMatch] = None
    best_key: tuple[int, int, int] = (-1, -1, -1)

    for rule in taxonomy.rules:  # already sorted by descending priority
        for keyword in rule.keywords:
            exact = bool(_word_pattern(keyword).search(haystack))
            # A loose hit must still begin a word, and be long enough to mean something:
            # unanchored substrings match "art" inside "heart" and "ground" inside
            # "background", which silently mis-routes layers.
            loose = (
                (not exact)
                and len(keyword) >= 5
                and bool(_prefix_pattern(keyword).search(haystack))
            )
            if not (exact or loose):
                continue
            key = (rule.priority, 1 if exact else 0, len(keyword))
            if key > best_key:
                best_key = key
                best = RuleMatch(
                    category=rule.category,
                    object_type=rule.object_type,
                    confidence=EXACT_CONFIDENCE if exact else LOOSE_CONFIDENCE,
                    keyword=keyword,
                    exact=exact,
                )

    return best or NO_MATCH


def apply_category(
    meta,
    match: RuleMatch,
    taxonomy: Taxonomy,
    confidence: float = -1.0,
) -> None:
    """Write a rule match onto a LayerMetadata, including the derived category flags.

    `confidence` overrides the rule's own confidence when the analyzer has a better
    estimate (a VLM that reports its own certainty). Pass -1 to keep the rule's value.
    """
    spec = taxonomy.category(match.category)
    meta.semantic_category = spec.name
    meta.object_type = match.object_type or meta.object_type
    meta.is_character = spec.is_character
    meta.is_background = spec.is_background
    meta.importance = spec.importance
    meta.confidence = match.confidence if confidence < 0 else max(0.0, min(1.0, confidence))
    if match.matched:
        kind = "exact" if match.exact else "loose"
        meta.note(f"rule: '{match.keyword}' ({kind}) -> {spec.name}")
    else:
        meta.note("rule: no keyword matched")
