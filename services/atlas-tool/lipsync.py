"""Voice clip → timed mouth shapes, for the Rigger's lip-sync (docs/design/rig-templates.md §5.2).

Runs Rhubarb Lip Sync (MIT; its bundled CMU Sphinx models are BSD-style, see its LICENSE.md),
installed into the image by `rhubarb_install.py`. A CPU job of a few seconds per line, so it runs
inline on the request thread like `/video/toclip`, not as a queued job.

The caller (the launcher's `/api/rigger/lipsync`) has already decoded the upload to a mono WAV, so
this sees one format only. It answers Rhubarb's own shape letters (A–H, X); which template image
each letter becomes is template data in the launcher, never decided here.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path

RHUBARB_BIN = os.environ.get("RHUBARB_BIN", "/opt/rhubarb/rhubarb")
RECOGNIZERS = ("pocketSphinx", "phonetic")
SHAPES = frozenset("ABCDEFGHX")
# A dialogue line, not a monologue: Rhubarb runs at roughly real time on one CPU, and the launcher
# waits on the answer.
MAX_SECONDS = 60
MAX_WAV_BYTES = 16 * 1024 * 1024
MAX_DIALOG_CHARS = 4000
TIMEOUT_S = 150


def wav_seconds(wav: bytes) -> float:
    """The length of a PCM WAV, from its `fmt ` and `data` chunks; ValueError when it is not one."""
    if len(wav) < 12 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise ValueError("The audio is not a WAV file.")
    pos, byte_rate, data = 12, 0, -1
    while pos + 8 <= len(wav):
        cid, size = wav[pos:pos + 4], int.from_bytes(wav[pos + 4:pos + 8], "little")
        if cid == b"fmt " and size >= 12:
            byte_rate = int.from_bytes(wav[pos + 16:pos + 20], "little")
        elif cid == b"data":
            data = min(size, len(wav) - pos - 8)
            break
        pos += 8 + size + (size & 1)
    if byte_rate <= 0 or data < 0:
        raise ValueError("The WAV file has no audio in it.")
    return data / byte_rate


def run(payload: dict) -> dict:
    """`{wav_b64, dialog?, recognizer?}` → `{duration, cues: [{start, end, value}]}`.

    ValueError for anything the author can fix (the page shows it as is); anything else is a fault.
    """
    try:
        wav = base64.b64decode(str(payload.get("wav_b64") or ""), validate=True)
    except ValueError:
        raise ValueError("The audio did not arrive intact.") from None
    if not wav:
        raise ValueError("No audio was sent.")
    if len(wav) > MAX_WAV_BYTES:
        raise ValueError("The audio is too large.")
    secs = wav_seconds(wav)
    if secs > MAX_SECONDS:
        raise ValueError(f"The line is {secs:.0f} s long; lip-sync takes up to {MAX_SECONDS} s. Split it.")
    if secs < 0.05:
        raise ValueError("The line is silent or too short.")
    recognizer = str(payload.get("recognizer") or "pocketSphinx")
    if recognizer not in RECOGNIZERS:
        raise ValueError(f"Unknown recognizer {recognizer!r}.")
    dialog = str(payload.get("dialog") or "").strip()
    if len(dialog) > MAX_DIALOG_CHARS:
        raise ValueError("The words are too long for one line.")
    if not Path(RHUBARB_BIN).is_file():
        raise RuntimeError(f"Rhubarb Lip Sync is not installed at {RHUBARB_BIN}.")

    with tempfile.TemporaryDirectory(prefix="iw-lipsync-") as tmp:
        src, out = Path(tmp, "line.wav"), Path(tmp, "cues.json")
        src.write_bytes(wav)
        args = [RHUBARB_BIN, "-q", "-f", "json", "--extendedShapes", "GHX", "-r", recognizer]
        if dialog:
            words = Path(tmp, "dialog.txt")
            words.write_text(dialog, encoding="utf-8")
            args += ["-d", str(words)]
        args += ["-o", str(out), str(src)]
        try:
            done = subprocess.run(args, capture_output=True, timeout=TIMEOUT_S, check=False)
        except subprocess.TimeoutExpired:
            raise RuntimeError("Rhubarb Lip Sync took too long.") from None
        if done.returncode != 0 or not out.is_file():
            tail = (done.stderr or b"").decode("utf-8", "replace").strip()[-300:]
            raise RuntimeError(f"Rhubarb Lip Sync failed ({done.returncode}): {tail}")
        result = json.loads(out.read_text(encoding="utf-8"))
    return {"duration": round(secs, 3), "cues": clean_cues(result)}


def clean_cues(result: dict) -> list[dict]:
    """Rhubarb's `mouthCues`, checked: known letters, times rising, nothing else carried."""
    cues = []
    last = -1.0
    for c in (result or {}).get("mouthCues") or []:
        start, end, value = float(c["start"]), float(c["end"]), str(c["value"])
        if value not in SHAPES:
            raise RuntimeError(f"Rhubarb answered an unknown shape {value!r}.")
        if start < last - 1e-6 or end < start:
            raise RuntimeError("Rhubarb answered cues out of order.")
        last = start
        cues.append({"start": round(start, 3), "end": round(end, 3), "value": value})
    return cues
