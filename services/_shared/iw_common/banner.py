"""
Invisible Wall SL — standard console startup banner.

The default boot identity for every Invisible Wall server / DOS window.
Compact corner-bracket emblem (mirrors the atlas maker web boot screen),
printed to stdout with UTF-8 forced so the box-drawing glyphs render in
modern Windows Terminal / cmd.exe.

Usage:
    from iw_common.banner import print_banner
    print_banner("Atlas Maker", "v1.0",
                 footer="http://127.0.0.1:8765   ·   Ctrl+C to stop")

Single source of truth: each service exposes a thin `iw_banner.py` shim that
re-exports from here, so the banner stays identical across tools.
"""

import sys

_WIDTH = 44  # inner bar length


def banner(tool: str, version: str = "", footer: str = "") -> str:
    """Return the standard Invisible Wall startup banner as a string."""
    bar = "━" * _WIDTH
    name = f"{tool.upper()}"
    if version:
        name = f"{name}   ·   {version}"
    lines = [
        "",
        "   ┏" + bar,
        "   ┃   I N V I S I B L E   W A L L   S L",
        "   ┃   " + "─" * (_WIDTH - 4),
        "   ┃   " + name,
        "   ┃",
    ]
    if footer:
        lines.append("        " + footer)
    lines.append("")
    return "\n".join(lines)


def print_banner(tool: str, version: str = "", footer: str = "") -> None:
    """Force UTF-8 on stdout (best effort) and print the startup banner."""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001 — older Python / non-reconfigurable stream
        pass
    print(banner(tool, version, footer))


if __name__ == "__main__":
    print_banner("Atlas Maker", "v1.0",
                 footer="http://127.0.0.1:8765   ·   Ctrl+C to stop")
