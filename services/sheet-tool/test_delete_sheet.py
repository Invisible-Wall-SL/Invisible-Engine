"""Offline checks for `api_delete_sheet`'s R2 verification (no R2, no network).

    py test_delete_sheet.py     (from services/sheet-tool, PYTHONPATH=../_shared:.)

No framework — the sheet tool has no test infra, and the contract under test is
exactly the kind that cannot be verified by looking at the UI: the rail drops the
sheet either way, so a delete that never reached R2 LOOKS identical to one that
did. That is the bug this guards ("deleted here, still loadable elsewhere").

The verification is the whole point of the function, and it had two holes:
  * it re-listed `sheets/` and the manifests but NOT `sheet_src/`, so a silent
    failure there passed. Real orphan found in the bucket on 2026-09-22:
    `unassigned/cloud/sheet_src/S_UI_StaticElements/` — 17 sprites, ~2.4 MB, with
    no page and no manifest left to reach them by;
  * it asked with `storage.exists`, which folds EVERY error into "not there", so
    a throttled HEAD read as a successful delete — the exact false-pass the
    re-list exists to prevent. It now uses `storage.head` (only a real 404 is
    absence) and refuses outright when the check cannot be completed.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_STAGING = tempfile.mkdtemp(prefix="sheet-delete-")
os.environ["SHEET_STAGING"] = _STAGING
os.environ["SHEET_CLIENT"] = "invisible_wall"
os.environ["SHEET_PROJECT"] = "testproj"

import sheet_server  # noqa: E402
import storage  # noqa: E402

FAILED: list[str] = []
PREFIX = "invisible_wall/testproj"
SHEET = "S_Doomed"


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


class FakeR2:
    """An R2 whose objects live in a dict, with per-prefix failure injection."""

    def __init__(self, keys: list[str], undeletable: tuple[str, ...] = (),
                 unreadable: tuple[str, ...] = (),
                 unreadable_after: int | None = None) -> None:
        self.keys = set(keys)
        self.undeletable = undeletable    # delete() silently no-ops (read-only token)
        self.unreadable = unreadable      # list/head raise (throttle, 5xx, timeout)
        # Start failing only from the Nth list_keys call, so the DELETE phase can
        # succeed and the VERIFY phase's listing be the one that breaks — the two
        # are separate code paths and a fixture that trips the first never
        # reaches the second.
        self.unreadable_after = unreadable_after
        self.lists = 0
        self.bodies: dict[str, bytes] = {}

    def list_keys(self, prefix: str) -> list[dict]:
        self.lists += 1
        late = (self.unreadable_after is not None
                and self.lists > self.unreadable_after)
        if late or any(u in prefix for u in self.unreadable):
            raise storage.ObjectUnreadable(f"{prefix}: throttled")
        return [{"key": k, "size": 1, "mtime": 0.0}
                for k in sorted(self.keys) if k.startswith(prefix)]

    def get(self, key: str) -> bytes:
        if any(u in key for u in self.unreadable):
            raise storage.ObjectUnreadable(f"{key}: throttled")
        return self.bodies.get(key, b"{}")

    def head(self, key: str):
        if any(u in key for u in self.unreadable):
            raise storage.ObjectUnreadable(f"{key}: throttled")
        return {"size": 1, "etag": "x", "mtime": 0.0} if key in self.keys else None

    def delete(self, key: str) -> None:
        if any(u in key for u in self.undeletable):
            return                         # swallowed, exactly like the real one
        self.keys.discard(key)


def full_sheet() -> list[str]:
    """Every R2 object a saved sheet owns."""
    return [
        f"{PREFIX}/sheets/{SHEET}/{SHEET}.png",
        f"{PREFIX}/sheets/{SHEET}/{SHEET}.atlas",
        f"{PREFIX}/sheets/{SHEET}/{SHEET}.json",
        f"{PREFIX}/sheet_src/{SHEET}/a.png",
        f"{PREFIX}/sheet_src/{SHEET}/b.png",
        f"{PREFIX}/input/refs/atlasslices/{SHEET}/a.png",
        f"{PREFIX}/manifests/atlas_manifest_{SHEET}.json",
    ]


def run(fake: FakeR2) -> dict:
    real = (storage.list_keys, storage.head, storage.delete, storage.get)
    sheet_server.storage.list_keys = fake.list_keys
    sheet_server.storage.head = fake.head
    sheet_server.storage.delete = fake.delete
    sheet_server.storage.get = fake.get
    try:
        return sheet_server.api_delete_sheet({"sheet": SHEET})
    finally:
        (sheet_server.storage.list_keys, sheet_server.storage.head,
         sheet_server.storage.delete, sheet_server.storage.get) = real


def main() -> int:
    # 1. The happy path clears every tree the sheet owns, including the loose
    #    sprites and the Atlas Maker's slice mirror.
    fake = FakeR2(full_sheet())
    res = run(fake)
    check("a clean delete reports ok", res.get("ok"), True)
    check("...and R2 is empty of the sheet", sorted(fake.keys), [])

    # 2. The hole that let 17 orphaned sprites survive: `sheet_src/` is now
    #    verified, so a delete that could not clear it FAILS instead of claiming
    #    success and dropping the sheet from the rail.
    fake = FakeR2(full_sheet(), undeletable=("/sheet_src/",))
    res = run(fake)
    check("an undeletable sheet_src/ is caught", "error" in res, True)
    check("...and the orphans are named",
          sum(1 for k in fake.keys if "/sheet_src/" in k), 2)

    # 3. The slice mirror LOOKS sheet-owned (it is namespaced by sheet name) but
    #    a duplicated atlas copies `shape_ref`/`style_ref` verbatim, so a derived
    #    atlas keeps pointing at the original's tree. Real in the bucket today:
    #    `s_new_boot_idle_water` -> `atlasslices/S_New_Boot`. Deleting it would
    #    blank 25 source refs in a sheet nobody asked to touch.
    fake = FakeR2(full_sheet() + [f"{PREFIX}/manifests/atlas_manifest_Derived.json"])
    fake.bodies[f"{PREFIX}/manifests/atlas_manifest_Derived.json"] = (
        b'{"regions":[{"shape_ref":"'
        + f"{PREFIX}/input/refs/atlasslices/{SHEET}/a.png".encode()
        + b'"}]}')
    res = run(fake)
    check("a referenced slice tree is kept", res.get("ok"), True)
    check("...the slices really are still there",
          sum(1 for k in fake.keys if "/atlasslices/" in k), 1)
    check("...and the note names the manifest that still needs them",
          "atlas_manifest_Derived.json" in res.get("note", ""), True)

    # 3b. Unreferenced, it goes with the sheet.
    fake = FakeR2(full_sheet())
    res = run(fake)
    check("an unreferenced slice tree is deleted",
          sum(1 for k in fake.keys if "/atlasslices/" in k), 0)

    # 3c. A scan that cannot be COMPLETED is not proof of no users.
    fake = FakeR2(full_sheet(), unreadable=("/manifests/atlas_manifest_Other",))
    fake.keys.add(f"{PREFIX}/manifests/atlas_manifest_Other.json")
    res = run(fake)
    check("an unscannable reference check keeps the slices",
          sum(1 for k in fake.keys if "/atlasslices/" in k), 1)

    # 4. The manifest is what the Atlas picker reads, so a survivor there is the
    #    difference between "gone" and "still openable in the other tool".
    fake = FakeR2(full_sheet(), undeletable=("/manifests/",))
    check("an undeletable manifest is caught", "error" in run(fake), True)

    # 5. The false pass: a throttled HEAD used to read as absence, so the tool
    #    reported a delete it had not confirmed. Unverifiable is not clean.
    fake = FakeR2(full_sheet(), unreadable=("/manifests/",))
    res = run(fake)
    check("an unreadable manifest check refuses", "error" in res, True)
    check("...and says the CHECK failed, not the delete",
          "confirming read failed" in res.get("error", ""), True)

    # 6. Likewise for a listing that cannot be completed. The listings in order
    #    are: the slice-reference scan (1), the three delete-phase trees (2-4),
    #    then the verify-phase re-lists (5+) — so `unreadable_after=4` breaks the
    #    FIRST verify listing and exercises that branch rather than stopping in
    #    phase 1 the way a prefix-keyed failure would. The message assertion
    #    below is what actually pins the branch, so a drift in the count fails
    #    loudly instead of quietly testing the wrong one.
    fake = FakeR2(full_sheet(), unreadable_after=4)
    res = run(fake)
    check("an unreadable VERIFY listing refuses", "error" in res, True)
    check("...naming the confirming read, not the delete",
          "confirming read failed" in res.get("error", ""), True)

    # 7. A phase-1 listing that breaks is a DIFFERENT state — some objects are
    #    already deleted — and must not claim nothing happened.
    fake = FakeR2(full_sheet(), unreadable=("/sheet_src/",))
    res = run(fake)
    check("an unreadable DELETE listing refuses too", "error" in res, True)
    check("...and admits the delete stopped part-way",
          "part-way" in res.get("error", ""), True)

    # 8. A sheet named in the editor but never exported owns NO objects. That is
    #    still removable — empty prefixes verify clean rather than erroring.
    fake = FakeR2([])
    check("a never-exported sheet deletes cleanly", run(fake).get("ok"), True)

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all delete-sheet fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
