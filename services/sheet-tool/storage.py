"""Thin shim — R2 object storage lives in iw_common.storage (single source).

Kept so the ~existing `import storage` call sites stay unchanged.
"""
from iw_common.storage import (  # noqa: F401
    Conflict,
    ObjectUnreadable,
    delete,
    dir_size,
    exists,
    get,
    get_strict,
    get_with_etag,
    head,
    human_bytes,
    list_keys,
    list_prefixes,
    pull_prefix,
    push_dir,
    push_file,
    put,
)
