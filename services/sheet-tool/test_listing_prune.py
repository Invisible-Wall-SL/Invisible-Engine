"""Offline fixtures for staging<->R2 listing reconciliation (no R2, no network).

    py test_listing_prune.py    (from services/sheet-tool, PYTHONPATH=../_shared:.)

The mirror image of the Atlas Maker's `prune_manifests`, and needed for the same
reason: `pull_prefix` only ever DOWNLOADS. `_refresh_listing_subtrees` re-pulls
`sheets/` + `manifests/` on EVERY state load, so this tool was never stale in the
"missing something new" direction — but it could not make a DELETED thing go
away, because nothing reconciled the other half. The rail lists local `sheets/`
directories, so a sheet deleted at the source (another replica, the Atlas Maker
writing to the shared `manifests/` prefix, or an edit straight in the bucket)
kept appearing here.

The three rails are what stop the reconciliation being a data-loss bug of its
own, and the third is specific to this tool: `output_dir()` mkdirs
`sheets/<sheet>/` the moment a sheet is NAMED, so an empty local directory is a
sheet being authored right now. It has no R2 objects for exactly the same reason
a ghost has none — only the local files tell them apart.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_STAGING = tempfile.mkdtemp(prefix="sheet-prune-")
os.environ["SHEET_STAGING"] = _STAGING

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


def stage(project: str, sheets: dict[str, list[str]],
          manifests: tuple[str, ...] = ()) -> Path:
    """Build a staging tree: `sheets/<name>/<files>` and `manifests/<name>`.

    A sheet mapped to `[]` is an EMPTY directory — a sheet just named in the
    editor and not yet exported."""
    root = Path(tempfile.mkdtemp(prefix=f"{project}-", dir=_STAGING))
    for name, files in sheets.items():
        d = root / "sheets" / name
        d.mkdir(parents=True, exist_ok=True)
        for f in files:
            (d / f).write_bytes(b"x")
    man = root / "manifests"
    man.mkdir(parents=True, exist_ok=True)
    for m in manifests:
        (man / m).write_text("{}", encoding="utf-8")
    return root


def on_disk(root: Path, sub: str) -> list[str]:
    d = root / sub
    return sorted(p.name for p in d.iterdir()) if d.is_dir() else []


def install_fake(sheet_names: tuple[str, ...] = (),
                 man_keys: tuple[str, ...] = ()) -> None:
    """Stub BOTH listings the prune uses: `list_prefixes` (delimited, one level —
    which sheet names R2 still has) and `list_keys` (the manifest files)."""
    storage.list_prefixes = (
        lambda prefix, complete=True: [prefix + n + "/" for n in sheet_names])
    storage.list_keys = lambda prefix, complete=True: [
        {"key": prefix + r, "size": 1, "mtime": 0.0} for r in man_keys]


def install_raising(exc: Exception) -> None:
    def _raise(prefix: str, complete: bool = True):
        raise exc
    storage.list_prefixes = _raise
    storage.list_keys = _raise


def main() -> int:
    real = (storage.list_keys, storage.list_prefixes)
    try:
        # 1. The bug: a sheet R2 no longer has leaves the rail, and so does a
        #    manifest deleted from the shared prefix.
        root = stage("p1", {"live": ["live.png"], "ghost": ["ghost.png"]},
                     ("atlas_manifest_live.json", "atlas_manifest_ghost.json"))
        install_fake(("live",), ("atlas_manifest_live.json",))
        check("a deleted sheet and manifest are both pruned",
              cloud_paths.prune_listing_ghosts(CLIENT, "p1", root), (1, 1))
        check("...and only the live sheet remains", on_disk(root, "sheets"), ["live"])
        check("...and only the live manifest remains",
              on_disk(root, "manifests"), ["atlas_manifest_live.json"])

        # 2. Rail one: an unreadable R2 is NOT an empty R2. Wiping the whole rail
        #    on a throttle would be far worse than the ghost it removes.
        root = stage("p2", {"a": ["a.png"], "b": ["b.png"]}, ("m.json",))
        install_raising(storage.ObjectUnreadable("throttled"))
        check("a failed listing prunes nothing",
              cloud_paths.prune_listing_ghosts(CLIENT, "p2", root), (0, 0))
        check("...and the rail is untouched", on_disk(root, "sheets"), ["a", "b"])

        # 3. Rail two: work this container has not confirmed into R2 is exempt —
        #    a failed mirror must not cost the user their packed sheet.
        root = stage("p3", {"mine": ["mine.png"], "ghost": ["ghost.png"]})
        cloud_paths.note_authored(CLIENT, "p3", "sheets", "mine")
        install_fake()
        check("an unpushed sheet survives the prune",
              cloud_paths.prune_listing_ghosts(CLIENT, "p3", root), (1, 0))
        check("...and it is the ghost that went", on_disk(root, "sheets"), ["mine"])

        # 4. ...but a CONFIRMED push releases the claim, so a later delete at the
        #    source can prune it. Without this the claim would mean "written
        #    once", exempting every sheet this container ever saved.
        root = stage("p4", {"saved": ["saved.png"]})
        cloud_paths.note_authored(CLIENT, "p4", "sheets", "saved")
        cloud_paths.clear_authored(CLIENT, "p4", "sheets", "saved")
        install_fake()
        check("a confirmed push releases the claim, so a later delete prunes",
              cloud_paths.prune_listing_ghosts(CLIENT, "p4", root), (1, 0))

        # 5. Rail three: an EMPTY local sheet dir is a sheet being authored right
        #    now (`output_dir()` mkdirs on naming), not a leftover. It has no R2
        #    objects for the same reason a ghost has none.
        root = stage("p5", {"being_named": [], "ghost": ["g.png"]})
        install_fake()
        check("an empty (just-named) sheet dir is never pruned",
              cloud_paths.prune_listing_ghosts(CLIENT, "p5", root), (1, 0))
        check("...and it is still on the rail",
              on_disk(root, "sheets"), ["being_named"])

        # 6. The claim is per (client, project) AND per kind — a manifest claim
        #    must not vouch for a sheet of the same name.
        root = stage("p6", {"shared_name": ["x.png"]})
        cloud_paths.note_authored(CLIENT, "p6", "manifests", "shared_name")
        install_fake()
        check("a manifest claim does not protect a sheet of the same name",
              cloud_paths.prune_listing_ghosts(CLIENT, "p6", root), (1, 0))

        # 7. `live` for manifests matches the full one-segment name, so a key
        #    nested deeper does not vouch for a top-level file.
        root = stage("p7", {}, ("x.json",))
        install_fake((), ("sub/x.json",))
        check("a nested key does not vouch for a top-level manifest",
              cloud_paths.prune_listing_ghosts(CLIENT, "p7", root), (0, 1))

        # 8. `_mirror`'s (kind, name) derivation — the riskiest new code, since a
        #    wrong key means either no protection or an immortal claim. Only
        #    `sheets/<sheet>/...` and a ONE-segment `manifests/<name>` claim;
        #    everything else falls through to a plain push.
        import sheet_server  # noqa: PLC0415 — after the staging env is set
        cloud_paths.set_context(CLIENT, "p9")
        root = cloud_paths.resolve()["staging_root"]
        pushed: list[str] = []
        real_push = sheet_server.storage.push_file
        sheet_server.storage.push_file = lambda p, key: (pushed.append(key), True)[1]
        try:
            for rel in ("sheets/foo/foo.png", "manifests/atlas_manifest_foo.json",
                        "sheet_src/foo/a.png", "sheet_config.json",
                        "manifests/sub/deep.json"):
                f = Path(root) / rel
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(b"x")
                sheet_server._mirror(f)
        finally:
            sheet_server.storage.push_file = real_push
        check("every path still pushes", len(pushed), 5)
        # A confirmed push releases, so nothing above may remain claimed.
        check("a confirmed push leaves no claim anywhere",
              cloud_paths.in_flight_count(CLIENT, "p9"), 0)

        # 8b. ...and when the push FAILS, only the two claimable kinds are held.
        sheet_server.storage.push_file = lambda p, key: False
        try:
            for rel in ("sheets/bar/bar.png", "manifests/atlas_manifest_bar.json",
                        "sheet_src/bar/a.png", "sheet_config.json",
                        "manifests/sub/deep.json"):
                f = Path(root) / rel
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(b"x")
                sheet_server._mirror(f)
        finally:
            sheet_server.storage.push_file = real_push
        check("a failed push flags the sheet and the top-level manifest only",
              cloud_paths.unpushed_count(CLIENT, "p9"), 2)
        check("...and holds no in-flight claim once _mirror has returned",
              cloud_paths.in_flight_count(CLIENT, "p9"), 0)

        # 8c. `_sheet_key` names the TOP-LEVEL segment under sheets/, so a
        #     redirected nested export claims the name the prune actually reads.
        cloud_paths.set_context(CLIENT, "p10")
        out_root = Path(cloud_paths.resolve()["output_root"])
        check("a nested dest resolves to its top-level sheet",
              sheet_server._sheet_key(out_root / "top" / "nested"), "top")
        check("...the sheets root itself claims nothing",
              sheet_server._sheet_key(out_root), "")
        check("...and so does a path outside it",
              sheet_server._sheet_key(Path(_STAGING) / "elsewhere"), "")

        # 8d. The claim is a COUNT, not a flag. The handler holds one for the
        #     whole operation while `_mirror` takes and drops its own per push —
        #     with a flag, `_mirror` releasing after the FIRST push dropped the
        #     handler's protection with three writes still to come, and the rest
        #     of the export wrote into a directory the prune had removed.
        cloud_paths.set_context(CLIENT, "p11")
        root = cloud_paths.resolve()["staging_root"]
        f = Path(root) / "sheets" / "op" / "op.png"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
        sheet_server.storage.push_file = lambda p, key: True
        try:
            with sheet_server._claim_scope("sheets", "op"):
                sheet_server._mirror(f)          # a confirmed push mid-operation
                check("a push inside a handler scope does NOT drop protection",
                      cloud_paths.in_flight_count(CLIENT, "p11"), 1)
        finally:
            sheet_server.storage.push_file = real_push
        check("...and the scope releases it on exit",
              cloud_paths.in_flight_count(CLIENT, "p11"), 0)

        # 8e. The scope releases on an exception too — an export that raises
        #     part-way must not leave its name immortal.
        try:
            with sheet_server._claim_scope("sheets", "boom"):
                raise RuntimeError("compose failed")
        except RuntimeError:
            pass
        check("a scope releases when the handler raises",
              cloud_paths.in_flight_count(CLIENT, "p11"), 0)

        # 8f. A FAILED push protects the key until a push succeeds — and that
        #     protection must be a flag, not an extra unit of a balanced count.
        #     As a count it leaked monotonically: one transient R2 error and the
        #     sheet was never prunable again on this container, which is the
        #     ghost symptom returning by another door.
        cloud_paths.set_context(CLIENT, "p12")
        root = cloud_paths.resolve()["staging_root"]
        f = Path(root) / "sheets" / "flaky" / "flaky.png"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
        sheet_server.storage.push_file = lambda p, key: False
        try:
            sheet_server._mirror(f)
        finally:
            sheet_server.storage.push_file = real_push
        check("a failed push protects the sheet",
              cloud_paths.unpushed_count(CLIENT, "p12"), 1)
        install_fake()
        check("...so the prune leaves it alone",
              cloud_paths.prune_listing_ghosts(CLIENT, "p12", Path(root)), (0, 0))
        sheet_server.storage.push_file = lambda p, key: True
        try:
            sheet_server._mirror(f)          # the retry lands
        finally:
            sheet_server.storage.push_file = real_push
        check("a later SUCCESSFUL push clears it (no monotonic leak)",
              cloud_paths.unpushed_count(CLIENT, "p12"), 0)
        check("...and it is prunable again",
              cloud_paths.prune_listing_ghosts(CLIENT, "p12", Path(root)), (1, 0))

        # 8g. The plist wrapper must claim the name the IMPORT will use. The
        #     field is normally blank (placeholder: "from the .plist name"), and
        #     the wrapper once defaulted to "sheet" while the body used the
        #     plist's stem — so the real directory was unprotected throughout.
        files = [{"filename": "Hero_Atlas.plist"}, {"filename": "Hero_Atlas.png"}]
        check("a blank name resolves to the plist stem, as the body does",
              sheet_server._plist_sheet_name({}, files), "Hero_Atlas")
        check("...and an explicit name still wins",
              sheet_server._plist_sheet_name({"sheet": " Named "}, files), "Named")

        # 8h. Deriving the export key must NOT create the directory: claiming
        #     runs before the body validates, so a mkdir here leaves an empty
        #     sheets/<name>/ behind every REJECTED export — listed on the rail
        #     and made immortal by rail three.
        cloud_paths.set_context(CLIENT, "p13")
        out_root = Path(cloud_paths.resolve()["output_root"])
        dest = sheet_server._resolve_dest("rejected", "")
        check("resolving the destination names the sheet",
              sheet_server._sheet_key(dest), "rejected")
        check("...without creating it", dest.exists(), False)

        # 8i. `discard_all_authored` is the escape hatch for a claim whose
        #     release was lost. It spans EVERY project because `api_clearcache`
        #     rmtrees every project's tree.
        cloud_paths.note_authored(CLIENT, "p11", "sheets", "stuck")
        check("discard_all_authored clears a leaked claim",
              cloud_paths.discard_all_authored() >= 1, True)
        check("...leaving nothing held",
              cloud_paths.in_flight_count(CLIENT, "p11"), 0)

        # 8j. The key must be protected at EVERY instant of a failed `_mirror`.
        #     The flag has to go on before the count comes off: releasing first
        #     left a window where the key was neither counted nor flagged, and
        #     the prune runs on every state load.
        cloud_paths.set_context(CLIENT, "p14")
        root = cloud_paths.resolve()["staging_root"]
        f = Path(root) / "sheets" / "atomic" / "atomic.png"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
        gaps: list[str] = []
        real_clear = cloud_paths.clear_authored

        def _spy(ck, pk, kind, name):
            real_clear(ck, pk, kind, name)
            if not cloud_paths.is_protected(ck, pk, kind, name):
                gaps.append(name)

        cloud_paths.clear_authored = _spy
        sheet_server.storage.push_file = lambda p, key: False
        try:
            sheet_server._mirror(f)
        finally:
            cloud_paths.clear_authored = real_clear
            sheet_server.storage.push_file = real_push
        check("a failed push leaves no unprotected instant", gaps, [])

        # 8k. ...and a name whose files are gone for good is forgotten, or its
        #     failure flag prints on every state load for ever.
        sheet_server._forget_sheet("atomic")
        check("forgetting a removed sheet clears its failure flag",
              cloud_paths.unpushed_count(CLIENT, "p14"), 0)

        # 8l. The listings the prune trusts must fail CLOSED on a truncated page
        #     with no continuation token. `list_prefixes` used to return the
        #     partial page as if complete — absence there authorises a delete —
        #     and `list_keys` re-issued page one for ever, which is a hang on
        #     what is now an every-state-load path.
        import iw_common.storage as iws  # noqa: PLC0415 — after env is set

        class _Truncated:
            def list_objects_v2(self, **kw):
                return {"IsTruncated": True, "Contents": [], "CommonPrefixes": []}

        real_cli, real_bucket = iws._client, iws._bucket
        iws._client, iws._bucket = (lambda: _Truncated()), (lambda: "b")
        try:
            for label, fn in (("list_prefixes", iws.list_prefixes),
                              ("list_keys", iws.list_keys)):
                try:
                    fn("p/")
                    got = "returned"
                except iws.ObjectUnreadable:
                    got = "raised"
                check(f"{label} fails closed on a cursorless truncated page",
                      got, "raised")
                check(f"...and {label} can still opt out", fn("p/", complete=False), [])
        finally:
            iws._client, iws._bucket = real_cli, real_bucket

        # 9. A fresh container with nothing staged is a no-op, not a crash.
        install_fake()
        check("an unhydrated staging tree is a no-op",
              cloud_paths.prune_listing_ghosts(CLIENT, "p8", Path(_STAGING) / "nope"),
              (0, 0))
    finally:
        storage.list_keys, storage.list_prefixes = real

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
        return 1
    print("all listing-prune fixtures pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
