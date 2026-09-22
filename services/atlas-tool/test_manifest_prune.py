"""Offline fixtures for staging<->R2 manifest reconciliation (no R2, no GPU).

Run:  py test_manifest_prune.py   (from services/atlas-tool, PYTHONPATH=../_shared:.)

`pull_prefix` only ever DOWNLOADS, so before `prune_manifests` a manifest
deleted at the SOURCE lived on in this container's staging forever. Two visible
bugs came out of that, and both were reported together on 2026-09-22:

  * the picker kept offering a sheet the author had deleted in the Sheet Maker;
  * opening it re-saved the stale copy, and `_mirror` pushed it back into R2 —
    RESURRECTING the manifest minutes after a verified delete had removed it.
    (Confirmed in the bucket: `atlas_manifest_S_AutomationTest.json` was back,
    stamped with this tool's `output_override`, while every other object of that
    sheet — page, `.atlas`, TexturePacker json, loose sprites — stayed gone.)

Staging is ephemeral container disk that mirrors R2 1:1 by contract, so a file
R2 does not have is a ghost, not authored work. The rails below are what keep
that from becoming a data-loss bug in its own right — and the LIFETIME of the
authored claim is itself load-bearing, which is what `claim` cases 3-5 pin: an
add-only "this tool wrote it once" claim exempts every manifest the user has
opened and saved, i.e. exactly the sheet they then delete, and the ghost would
survive the prune built to remove it.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_STAGING = tempfile.mkdtemp(prefix="manifest-prune-")
os.environ["ATLAS_STAGING"] = _STAGING

import cloud_paths  # noqa: E402
import storage  # noqa: E402

FAILED: list[str] = []
CLIENT = "invisible_wall"


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        print(f"       got  {got!r}\n       want {want!r}")
        FAILED.append(label)


def stage_root(project: str) -> Path:
    return cloud_paths.STAGING_BASE / CLIENT / project


def staging(project: str, *names: str) -> Path:
    """Populate `manifests/` in the staging tree the prune will be pointed at."""
    man = stage_root(project) / "manifests"
    man.mkdir(parents=True, exist_ok=True)
    for n in names:
        (man / n).write_text("{}", encoding="utf-8")
    return man


def names_on_disk(man: Path) -> list[str]:
    return sorted(p.name for p in man.iterdir())


def fake_list(*rels: str):
    """`storage.list_keys` returning exactly these keys under the prefix asked for."""
    return lambda prefix: [{"key": prefix + r, "size": 2, "mtime": 0.0} for r in rels]


def raising_list(exc: Exception):
    def _raise(prefix: str):
        raise exc
    return _raise


def main() -> int:
    real_list = storage.list_keys
    try:
        # 1. The bug: a manifest R2 no longer has is dropped from staging, so it
        #    leaves the picker and can never be re-mirrored back into the bucket.
        man = staging("p1", "atlas_manifest_live.json", "atlas_manifest_ghost.json")
        storage.list_keys = fake_list("atlas_manifest_live.json")
        check("a manifest deleted at the source is pruned",
              cloud_paths.prune_manifests(CLIENT, "p1", stage_root("p1")), 1)
        check("...and only the ghost goes",
              names_on_disk(man), ["atlas_manifest_live.json"])

        # 2. Rail one: an unreadable R2 is NOT an empty R2. A throttle or a
        #    transport error must leave staging alone — wiping every local
        #    manifest on a hiccup would be far worse than the ghost.
        man = staging("p2", "atlas_manifest_a.json", "atlas_manifest_b.json")
        storage.list_keys = raising_list(storage.ObjectUnreadable("throttled"))
        check("a failed listing prunes nothing",
              cloud_paths.prune_manifests(CLIENT, "p2", stage_root("p2")), 0)
        check("...and staging is untouched",
              names_on_disk(man), ["atlas_manifest_a.json", "atlas_manifest_b.json"])

        # 3. Rail two: a manifest written here whose push has NOT been confirmed
        #    may be the only copy of the user's prompts/seeds, so it is exempt.
        man = staging("p3", "atlas_manifest_mine.json", "atlas_manifest_ghost.json")
        cloud_paths.note_authored(CLIENT, "p3", "atlas_manifest_mine.json")
        storage.list_keys = fake_list()
        check("an unpushed local manifest survives the prune",
              cloud_paths.prune_manifests(CLIENT, "p3", stage_root("p3")), 1)
        check("...and it is the ghost that went",
              names_on_disk(man), ["atlas_manifest_mine.json"])

        # 4. ...but the claim is RELEASED once the push is confirmed, so R2 can
        #    speak for it again. Without this the claim would mean "this tool
        #    wrote it once", which exempts every manifest the user has opened —
        #    including the one they go on to delete in the Sheet Maker. That
        #    would defeat the whole fix in its own repro.
        man = staging("p4", "atlas_manifest_saved.json")
        cloud_paths.note_authored(CLIENT, "p4", "atlas_manifest_saved.json")
        cloud_paths.clear_authored(CLIENT, "p4", "atlas_manifest_saved.json")
        storage.list_keys = fake_list()
        check("a CONFIRMED push releases the claim, so a later delete prunes",
              cloud_paths.prune_manifests(CLIENT, "p4", stage_root("p4")), 1)
        check("...and the staged copy is gone", names_on_disk(man), [])

        # 5. The authored claim is per (client, project): another project's
        #    same-named manifest is still a ghost here.
        staging("p5", "atlas_manifest_mine.json")
        cloud_paths.note_authored(CLIENT, "pOTHER", "atlas_manifest_mine.json")
        storage.list_keys = fake_list()
        check("the authored claim does not leak across projects",
              cloud_paths.prune_manifests(CLIENT, "p5", stage_root("p5")), 1)

        # 6. `live` matches on the FULL relative name, one segment deep: a key
        #    nested below `manifests/` is a different object and must not vouch
        #    for a local file that merely shares its basename.
        man = staging("p6", "x.json")
        storage.list_keys = fake_list("sub/x.json")
        check("a nested key does not vouch for a top-level manifest",
              cloud_paths.prune_manifests(CLIENT, "p6", stage_root("p6")), 1)

        # 7. The prune's scope is every file in `manifests/`, which also holds
        #    `.atlas` geometry and the scaffold's `.keep`. Both are R2-sourced,
        #    so they appear in `live` and stay — but say so, because nothing
        #    else in the code does.
        man = staging("p7", "symbols2.atlas", ".keep", "atlas_manifest_ghost.json")
        storage.list_keys = fake_list("symbols2.atlas", ".keep")
        check("`.atlas` and `.keep` survive when R2 still has them",
              cloud_paths.prune_manifests(CLIENT, "p7", stage_root("p7")), 1)
        check("...and only the ghost went",
              names_on_disk(man), [".keep", "symbols2.atlas"])

        # 8. `is_authored` is the same question the ACTIVATION-time 404 unlink in
        #    `_refresh_manifest_from_r2` has to ask. It skipped it at first, which
        #    made it the one delete that could destroy the only copy of a
        #    brand-new atlas whose mirror had failed — and then blame the loss on
        #    "deleted in another tool".
        cloud_paths.note_authored(CLIENT, "p8", "atlas_manifest_unpushed.json")
        check("an unpushed manifest reads as authored",
              cloud_paths.is_authored(CLIENT, "p8", "atlas_manifest_unpushed.json"),
              True)
        check("...a ghost does not",
              cloud_paths.is_authored(CLIENT, "p8", "atlas_manifest_ghost.json"),
              False)
        cloud_paths.clear_authored(CLIENT, "p8", "atlas_manifest_unpushed.json")
        check("...and a confirmed push clears it",
              cloud_paths.is_authored(CLIENT, "p8", "atlas_manifest_unpushed.json"),
              False)

        # 9. An empty staging tree (fresh container) is a clean no-op, not a crash.
        storage.list_keys = fake_list()
        check("no manifests/ dir is a no-op",
              cloud_paths.prune_manifests(CLIENT, "never_hydrated",
                                          stage_root("never_hydrated")), 0)
    finally:
        storage.list_keys = real_list

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all manifest-prune fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
