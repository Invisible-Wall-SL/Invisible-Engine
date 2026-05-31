"""Thin shim — the startup banner lives in iw_common.banner (single source).

Kept so the existing `from iw_banner import print_banner` call sites stay
unchanged.
"""
from iw_common.banner import banner, print_banner  # noqa: F401
