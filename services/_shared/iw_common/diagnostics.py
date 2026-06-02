"""iw_common.diagnostics — structured failure feedback (shared framework).

The cloud tools (Atlas Maker first, Sheet Maker later) used to surface failures
as raw subprocess log text or one-line toasts. This module turns every failure
into a structured *diagnostic*: ``what happened -> why -> how to fix``.

Design constraints (owner decisions):
  - **explain-only** — diagnostics never carry fix buttons or auto-actions.
  - **tool-agnostic** — NO tool-specific wording lives here; each tool owns a
    ``CATALOG`` dict (code -> {severity, title, explain, fix}) of templates.
  - **stdlib only**, no heavy deps — importable in the generation subprocess
    and the web server alike.

Wire protocol between the generation subprocess and the web server:
  ``emit(d)`` prints the human-readable ``canonical(d)`` (so the raw log stays
  readable) followed by a single machine-readable line
  ``@@DIAG@@{json}``. The server's stdout reader calls ``parse_diag_line`` on
  every line; a hit becomes a structured card and the marker line is hidden
  from the visible log.

Importable both as ``from iw_common.diagnostics import ...`` and (via the
tool's existing sys.path / PYTHONPATH=/app shim) the same way ``storage`` /
``cloud_paths`` already import ``iw_common``.
"""
from __future__ import annotations

import json

# --- severity ---------------------------------------------------------------

ERROR = "error"
WARN = "warn"
INFO = "info"

SEVERITY = (ERROR, WARN, INFO)

GLYPH = {ERROR: "✖", WARN: "⚠", INFO: "ℹ"}  # ✖ ⚠ ℹ

# Marker that prefixes the machine-readable JSON line on stdout.
DIAG_MARKER = "@@DIAG@@"


def _safe_format(template, ctx):
    """Format ``template`` with ``ctx`` but never raise on a missing key."""
    if not isinstance(template, str):
        return str(template)
    try:
        return template.format(**ctx)
    except (KeyError, IndexError, ValueError):
        # A placeholder referenced a key we weren't given (or a malformed
        # template). Fall back to the raw template so the user still gets text.
        return template


def diag(code, catalog, **ctx):
    """Build a structured diagnostic dict from ``catalog[code]`` + ``ctx``.

    Returns ``{"code","severity","title","explain","fix"}`` with every
    ``str.format``-able template substituted from ``ctx``.

    NEVER raises: if ``code`` is missing from ``catalog`` (or the entry is
    malformed) a safe generic diagnostic is returned — severity ``error``,
    title = the code, explain = the raw context.
    """
    entry = None
    if isinstance(catalog, dict):
        entry = catalog.get(code)

    if not isinstance(entry, dict):
        return {
            "code": str(code),
            "severity": ERROR,
            "title": str(code),
            "explain": _generic_explain(ctx),
            "fix": "",
        }

    severity = entry.get("severity", ERROR)
    if severity not in SEVERITY:
        severity = ERROR

    return {
        "code": str(code),
        "severity": severity,
        "title": _safe_format(entry.get("title", str(code)), ctx),
        "explain": _safe_format(entry.get("explain", ""), ctx),
        "fix": _safe_format(entry.get("fix", ""), ctx),
    }


def _generic_explain(ctx):
    if not ctx:
        return "An unexpected error occurred."
    parts = [f"{k}={v}" for k, v in ctx.items()]
    return "An unexpected error occurred. " + ", ".join(parts)


def canonical(d):
    """Uniform multi-line human-readable form of a diagnostic dict."""
    sev = d.get("severity", ERROR)
    glyph = GLYPH.get(sev, GLYPH[ERROR])
    title = d.get("title", d.get("code", "Error"))
    explain = d.get("explain", "")
    fix = d.get("fix", "")
    lines = [f"{glyph} {title}"]
    if explain:
        lines.append(explain)
    if fix:
        lines.append(f"→ Fix: {fix}")  # → Fix:
    return "\n".join(lines)


def emit(d):
    """Print a diagnostic for both humans and the card renderer.

    First the canonical multi-line text (keeps the raw log readable), then a
    single ``@@DIAG@@{json}`` marker line the server parses into a card.
    """
    print(canonical(d), flush=True)
    print(DIAG_MARKER + json.dumps(d), flush=True)


def parse_diag_line(line):
    """If ``line`` is a ``@@DIAG@@`` marker line, return the dict; else None."""
    if line is None:
        return None
    stripped = line.rstrip("\r\n")
    if not stripped.startswith(DIAG_MARKER):
        return None
    payload = stripped[len(DIAG_MARKER):]
    try:
        parsed = json.loads(payload)
    except (ValueError, TypeError):
        return None
    if isinstance(parsed, dict):
        return parsed
    return None
