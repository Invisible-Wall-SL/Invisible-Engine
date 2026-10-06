"""Seed first draft cards for the published library blueprints (ADR-0008 §2).

Each `card_seeds/<id>.json` is written to `_shared/blueprints/<id>/card.json`
only when that blueprint is in the library with the graph the seed was written
against (`graphSha`), and only create-only: an existing card — an owner's edit
above all — is never touched, so running this twice is a no-op. The service
runs the same step on every boot (`blueprints.hydrate`); this is the manual
handle, with a preview.

    set R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
    py seed_cards.py --dry-run     # what it would write, and why it skips the rest
    py seed_cards.py

Cards are read from R2 on every request, so no restart is needed afterwards.
"""
from __future__ import annotations

import argparse

import cards


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--dry-run", action="store_true",
                    help="list what would be written; write nothing")
    args = ap.parse_args()
    done = cards.seed_catalogue_cards(dry_run=args.dry_run, log=lambda _m: None)
    for bp_id, action in done:
        verb = f"would be {action}" if args.dry_run and action == "created" else action
        print(f"[seed-cards] {bp_id}: {verb}")
    if not done:
        print(f"[seed-cards] no seeds found in {cards.CARD_SEEDS}")


if __name__ == "__main__":
    main()
