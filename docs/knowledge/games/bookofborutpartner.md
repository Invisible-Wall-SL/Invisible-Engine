# bookofborutpartner — game brief

Book of Borut on the shared runtime, playing a partner's real Book-of RGS instead of our mock.
Owner agent: `lines-games` ([family](../families/lines.md)).

## What it must be

- The Book of Borut game, dealt by the partner's server: 5×3, 10 lines, `SCAT` scatter + wild,
  `betOptions [10,1000]` (the Book of Thermopylae wire shape), per the delivery profile
  `packages/delivery-profile/profiles/2complex.json` ([book-feature](../../design/book-feature.md)
  §2).
- **Must keep playing the partner RGS unchanged** through every engine change and the Book-of
  migration (book-feature §7 "Done when").
- Client (R2 client folder): not recorded. The partner's commercial terms: not for this file.

## Kind and add-ons

- A known Book-of game (book-feature §2); its done-when lists it as a `lines` project with
  `freeSpins.expandingSymbol` after the migration (built, not yet run). Its recorded kind today:
  not recorded.
- The migration never republishes it: it has no test-server card (game-config status, "Never
  republished").
- Add-ons: none recorded.

## Where it lives

- Content: `<client>/bookofborutpartner/` in R2 with a published snapshot under `…/published/`
  (`docs/INFRA.md`); the client folder is not recorded.
- **No test-server manifest entry**: `games.invisiblewall.org/bookofborutpartner/` answers 404
  (read 2026-10-07). The partner path is `?rgs_profile=2complex-bookof`, sessions minted by
  `GET /api/partner-session` (`apps/launcher-api/src/lib/server/partnerRgs.ts`).
- Wire: Play4Fun ([protocol](../../reference/play4fun-protocol.md)) through
  `packages/rgs-translator-eagaming`.

## How it is tested

- Playbook: none of its own. [borut-remake.md](../../playtest/borut-remake.md) is the closest
  (same art and flow, but against our mock).
- Current games: rendered from its snapshot. With no manifest entry the harness deals it a
  contract derived from its kind (`contractFor` in `scripts/current-games/lib/plan.mjs`) and plays
  the kind's script ([`bookOf.json`](../../../scripts/current-games/screens/bookOf.json) for
  `bookOf`); no `pots` scenario.
- Money: `pnpm check:rgs`. The partner node itself: the replay checks owed in
  [play4fun-protocol](../../reference/play4fun-protocol.md#checks-owed-on-the-live-node).

## State and quirks

- Played on the partner node 2026-09-17 (`docs/status/engine-history.md`): the buy feature ran as
  16 requests in under a second.
- Ships an edited (author's) copy of `freeSpinCounter` (current-games 1G); its other built-in
  copies date from engine `e29a993` ([open question 2](../../director/OPEN_QUESTIONS.md)).
- The partner edge sits behind Cloudflare: probe only from a real browser tab (root `CLAUDE.md`).
- Owner blocker: the partner replay check is open in `docs/STATUS.md`.
