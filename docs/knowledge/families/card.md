# Card — family knowledge

What is always true about card games, and what has gone wrong with them. Owner agent:
`card-games`. Design: `docs/design/card-games.md`.

## What it is and must stay

- A card game is **one player's duel against the device**. Each side has a fixed deck, a hand, a
  board of units, a hero with health and a resource that grows each turn. A hero at 0 loses.
- It is **rules-decided only**: free play, no stake, no wallet, no RGS. An RGS card config is a
  validation error and `unplayable` (`packages/game-config/src/cardGame.ts`,
  `packages/engine-game/src/game/mechanic.ts`). Delivery and partner sessions refuse it.
- **Effects are data from closed lists**: seven verbs, four targets, five triggers, three keywords
  (§3, decision §13 #3). No scripts. The AI, the validator, the rules text and the Card Library
  form all read the same lists.
- The game runs in the shared runtime (`apps/lines`), never a fork. A card is a component: one
  frame, many cards.
- The family's tools: everything except Symbols, Win Text and Invisible Characters; Invisible Card
  Library (`/cards`) is card-only (`FAMILY_TOOLS` in `apps/launcher-api/src/lib/roles.ts`).

## Invariants

- **One rules module.** `packages/engine-mechanics/src/cards.js` is pure ESM: no drawing, no
  imports, `apply` never mutates its input, every random draw comes from the match's own stream.
  Gate: `check:card-rules` (replay byte for byte from `fixtures/cards-replay.json`).
- **The AI has its own stream.** `cardAi.js` seeds from `${seed}:ai:${side}` and never moves the
  match RNG; `hard` stays inside its `apply()` budget. Gate: `check:card-ai`.
- **The lists and ranges have one source.** `cards.js` exports `CARD_VERBS`, `CARD_TRIGGERS`,
  `CARD_TARGET_KINDS`, `CARD_KEYWORDS`, `CARD_VERB_TARGETS`, `CARD_RANGES`, `CARD_MAX_EFFECTS`,
  `CARD_SIDES`, `CARD_INCLUDES`, `CARD_UNTILS`. The Card Library's form offers exactly what
  `validateLibrary` accepts. Gate: `check:cards-tool` §1.
- **Readers drop, validators refuse.** `readLibrary` drops unknown fields and values
  (`docs/conventions/doc-readers.md`); `validateLibrary` refuses what an author submits. The Card
  Library shows a stored library's drops before a save.
- **`cardText` expects a validated card.** Generated English per effect; the English is the
  localization key. A card with errors gets no rules text (`rulesTextOf` in
  `apps/launcher-api/src/lib/cards/cardEdit.ts`).
- **Cards live in the config** (`GameConfigDoc.card`, decision §13 #1): one lease, one etag, one
  History with `/config`. No new asset class; the export and bake seed `cardGameComponentIds` and
  classify `cardGameParamRefs` (gate: `check:art-scope`).
- **The test match is the game's match.** `testMatch.ts` maps the config onto `createMatch` as
  `cardSession.ts` does; `check:cards-tool` §4 plays both move for move.
- **Slot parity.** A non-card config never reaches a card path; the card code ships in the shared
  bundle (+17.7 KB gz since C3; owner call in status open item 0a).

## Where the code lives

See the `card-games` agent's "What you own".

## Known failure modes

- **Prettier's Svelte plugin strips generics in markup.** `{@const x = y as Record<string, unknown>}`
  and snippet parameter types lost their type arguments, then failed `check:svelte`. Put types in
  the `<script>` (an alias or a helper), never in a template expression (C4, 2026-10-28).
- **The launcher build does not type-check.** A page calling a helper that was never exported built
  green and would have crashed at runtime; only `check:svelte` caught it. Run it on every
  launcher change (C4).
- **A new family must reach every copy of the family list**, the Director worker's
  `FAMILY_PACK_FAMILIES` and `PACK_FAMILY_LABELS` included. C3 missed it; `check:family-packs` and
  `check:svelte` went red on `main` until #1430.
- **Stored decks can hold what the pool cannot show** (a token, an unknown card, duplicate entries).
  The Card Library lists such strays once per card so they can be removed (C4).

## Gates

`pnpm check:card-rules`, `pnpm check:card-library`, `pnpm check:card-ai`; launcher
`check:card-family`, `check:card-runtime`, `check:cards-tool`, `check:family-tools`,
`check:game-config-family`; `pnpm check:svelte --only apps/launcher-api`. Playbook:
`docs/playtest/card-sample.md`.
