"""Take only named fields of an exported document into the live one (`upload-project.py --fields`).

The Salmons export is a whole config, and the live config also holds what the owner authored in
the tools (a character's sheet and its link, tuned numbers). Replacing it would delete those. A
field is a dotted path of object keys from the document's top (`arcade.online.levels`); the live
document keeps everything else exactly as it is.
"""

from __future__ import annotations

import copy

MISSING = object()


def parse_fields(text: str) -> list[str]:
    """`a.b, c.d` → `['a.b', 'c.d']`; an empty path or an empty key is refused."""
    fields = [part.strip() for part in text.split(',') if part.strip()]
    for path in fields:
        if any(not key for key in path.split('.')):
            raise ValueError(f'"{path}" is not a dotted path of keys')
    return fields


def field_of(doc: object, path: str) -> object:
    """The value at `path`, or `MISSING`."""
    at = doc
    for key in path.split('.'):
        if not isinstance(at, dict) or key not in at:
            return MISSING
        at = at[key]
    return at


def with_fields(live: dict, exported: dict, fields: list[str]) -> dict:
    """`live` with each of `fields` as `exported` has it; neither argument is changed.

    A field the export has is set (its parents made where the live document has none); one the
    export has not is taken out of the live document. A parent that is there but is not an object
    is refused: the path does not mean in the live document what it means in the export.
    """
    out = copy.deepcopy(live)
    for path in fields:
        value = field_of(exported, path)
        keys = path.split('.')
        at = out
        for depth, key in enumerate(keys[:-1]):
            if key not in at:
                if value is MISSING:
                    at = None
                    break
                at[key] = {}
            elif not isinstance(at[key], dict):
                raise ValueError(f'{".".join(keys[: depth + 1])} is not an object in the live document')
            at = at[key]
        if at is None:
            continue
        if value is MISSING:
            at.pop(keys[-1], None)
        else:
            at[keys[-1]] = copy.deepcopy(value)
    return out
