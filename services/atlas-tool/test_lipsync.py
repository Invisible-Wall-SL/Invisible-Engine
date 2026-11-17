"""Offline fixtures for the Rigger's lip-sync job (lipsync.py) — no Rhubarb binary needed.

Run:  py test_lipsync.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

Rhubarb itself is replaced by a stand-in for `subprocess.run` that writes a fixed answer, so these
prove what this module owns: what it refuses before spending CPU, the command it builds, and that
only Rhubarb's own shape letters, in time order, come back. With `RHUBARB_BIN` pointing at a real
binary the last check runs it too.
"""
from __future__ import annotations

import base64
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

import lipsync
import rhubarb_install

FAILED: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


def refuses(label: str, payload: dict, needle: str) -> None:
    try:
        lipsync.run(payload)
    except ValueError as e:
        check(label, needle in str(e), True)
        return
    check(label, "no ValueError", needle)


def wav(seconds: float, rate: int = 16000) -> bytes:
    n = int(seconds * rate)
    data = b"\x00\x00" * n
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * 2, 2, 16)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt
    body += b"LIST" + struct.pack("<I", 4) + b"INFO"
    body += b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731

check("wav length read past a LIST chunk", round(lipsync.wav_seconds(wav(1.5)), 3), 1.5)
refuses("not a wav", {"wav_b64": b64(b"ID3" + b"\x00" * 64)}, "not a WAV")
refuses("bad base64", {"wav_b64": "%%%"}, "intact")
refuses("empty", {"wav_b64": ""}, "No audio")
refuses("too long", {"wav_b64": b64(wav(61, rate=800))}, "Split it")
refuses("silent stub", {"wav_b64": b64(wav(0.01))}, "too short")
refuses("unknown recognizer", {"wav_b64": b64(wav(1)), "recognizer": "whisper"}, "recognizer")

ANSWER = {"mouthCues": [
    {"start": 0, "end": 0.22, "value": "X"},
    {"start": 0.22, "end": 0.28, "value": "F"},
    {"start": 0.28, "end": 0.62, "value": "C"},
    {"start": 0.62, "end": 0.9, "value": "X"},
]}
seen: dict = {}


def fake_run(args, **kw):
    seen["args"] = list(args)
    if "-d" in args:
        seen["dialog"] = Path(args[args.index("-d") + 1]).read_text(encoding="utf-8")
    Path(args[args.index("-o") + 1]).write_text(json.dumps(seen.get("answer", ANSWER)))
    return subprocess.CompletedProcess(args, 0, b"", b"")


real_bin, real_run = lipsync.RHUBARB_BIN, lipsync.subprocess.run
lipsync.RHUBARB_BIN = __file__
lipsync.subprocess.run = fake_run
try:
    out = lipsync.run({"wav_b64": b64(wav(0.9)), "dialog": "  Welcome back.  ", "recognizer": "phonetic"})
    check("answer = duration + cues", out, {"duration": 0.9, "cues": [
        {"start": 0, "end": 0.22, "value": "X"},
        {"start": 0.22, "end": 0.28, "value": "F"},
        {"start": 0.28, "end": 0.62, "value": "C"},
        {"start": 0.62, "end": 0.9, "value": "X"},
    ]})
    a = seen["args"]
    check("json out, extended shapes", (a[a.index("-f") + 1], a[a.index("--extendedShapes") + 1]), ("json", "GHX"))
    check("recognizer passed", a[a.index("-r") + 1], "phonetic")
    check("dialog file passed, trimmed", seen.get("dialog"), "Welcome back.")
    seen.clear()
    lipsync.run({"wav_b64": b64(wav(0.5))})
    check("no words = no dialog file", "-d" in seen["args"], False)
    check("default recognizer", seen["args"][seen["args"].index("-r") + 1], "pocketSphinx")
    for label, cues in (
        ("unknown shape refused", [{"start": 0, "end": 1, "value": "Q"}]),
        ("cues out of order refused", [{"start": 0.5, "end": 1, "value": "A"}, {"start": 0.1, "end": 0.2, "value": "B"}]),
    ):
        seen["answer"] = {"mouthCues": cues}
        try:
            lipsync.run({"wav_b64": b64(wav(1))})
            check(label, "accepted", "refused")
        except RuntimeError:
            check(label, True, True)
finally:
    lipsync.RHUBARB_BIN, lipsync.subprocess.run = real_bin, real_run

check("install pins a sha256", len(rhubarb_install.SHA256) == 64 and rhubarb_install.VERSION in rhubarb_install.URL, True)

if os.environ.get("RHUBARB_BIN") and Path(lipsync.RHUBARB_BIN).is_file():
    out = lipsync.run({"wav_b64": b64(wav(1))})
    check("real Rhubarb: silence is the rest shape", {c["value"] for c in out["cues"]}, {"X"})

if FAILED:
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("\nall passed")
