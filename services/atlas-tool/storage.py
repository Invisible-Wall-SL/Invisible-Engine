"""Thin shim — R2 object storage lives in iw_common.storage (single source).

Kept so the ~existing `import storage` call sites stay unchanged.
"""
from iw_common.storage import (  # noqa: F401
    Conflict,
    delete,
    dir_size,
    exists,
    ObjectUnreadable,
    get,
    get_with_etag,
    get_strict,
    head,
    human_bytes,
    list_keys,
    list_prefixes,
    presign_put,
    pull_prefix,
    push_dir,
    push_file,
    put,
)
