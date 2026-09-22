"""Thin shim — R2 object storage lives in iw_common.storage (single source).

Kept so the ~existing `import storage` call sites stay unchanged.
"""
from iw_common.storage import (  # noqa: F401
    ObjectUnreadable,
    delete,
    dir_size,
    exists,
    get,
    head,
    human_bytes,
    list_keys,
    pull_prefix,
    push_dir,
    push_file,
    put,
)
