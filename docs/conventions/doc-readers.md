# Doc readers ignore unknown fields

**Every reader of an authored doc must IGNORE a field it does not know: drop it, never fail the
doc over it.** That covers save and load normalizers, Zod schemas, the bake and the runtime resolve
paths. A malformed value under a field the reader DOES know still fails, as loudly as before.

> **Source of truth = code, not this page.** The helper is `stripUnknownKeys` /
> `stripUnknownKeysWithWarning` in `apps/launcher-api/src/lib/server/stripUnknownKeys.ts`. The
> gate that holds every reader to this rule is
> `apps/launcher-api/scripts/check-doc-readers-unknown-fields.ts`. If this page and the code
> disagree, the code wins: fix this page.

## Why

A doc can be read by an OLDER build than the one that wrote it. This happens:

- during a rolling deploy;
- after a rollback (launcher or `Runtime rollback`);
- when a published runtime snapshot outlives the code that wrote it;
- when a game pins an older engine submodule.

If the reader is strict, one new field fails the whole doc, and the reader falls back to its
empty doc or its coded defaults. **Every authored value then silently vanishes**: in the tool, in
the bake and in the game. Worse, the author sees the empty doc, and the next save overwrites the
real one.

This is not hypothetical. Hold and Win Phase 8 (#954) added two fields to the win-text doc,
`potLabel` and `potNames`. Until that change deployed, `main`'s `.strict()` win-text schema
rejected `hw-3pots-sample`'s WHOLE `win-text.json`.

## The rule, concretely

1. **Unknown object key → dropped.** This applies at the top level and at any depth.
2. **Unknown key in a closed map → dropped.** A closed map is a record keyed by an enum, such as
   the symbol state records keyed by `SYMBOL_STATES`. A state a newer launcher added is an
   unknown key, not a malformed doc.
3. **The reader warns, naming the dotted path**, for example
   `[symbols] ignoring unknown field "coinLabel.style.weight" (written by a newer build?)`.
   The warning is required wherever a schema used to REJECT the key (a `.strict()` object, an
   enum-keyed record). Where unknown keys were already dropped silently (a `.strip()` object such
   as the symbols doc root, or a hand-written whitelist rebuild), they stay silent: some of those
   are expected every load, like the engine-only `winFrame` a game's published symbol defaults
   carry.
4. **Known fields keep their validation.** A wrong type, an out-of-set enum value or a failed
   `.refine()` on a known field is still an error.
5. **A doc with only known fields normalizes byte-identically.** The strip pass is the identity
   on such a doc.

## How to follow it

- **Zod schema readers.** Keep the schema as it is: `.strict()` still documents the closed shape.
  Run the input through `stripUnknownKeysWithWarning(schema, input, '<doc>')` before `.parse()`.
  The helper walks the schema and removes only what the schema does not declare. It walks
  objects (including a catchall), records keyed by an enum, arrays, unions and discriminated
  unions, and the usual wrappers. It does NOT walk a `z.preprocess` (which may rename keys),
  intersections, tuples, maps or sets, so a strict object inside one of those still fails the
  doc. Restructure the schema, or extend the helper and its section of the gate.
  `normalizeSymbolsDoc`, `normalizeWinTextDoc` and `parseSymbolDefaults` are the references.
- **Hand-written normalizers** (scenes, flow, game config, localization, FX, flipbooks, sounds,
  rig text, art bounds, components). Rebuild the output from the fields you know (a whitelist).
  Never write `if (!KNOWN.has(key)) return null` and never `throw` on an extra key.
- **A new doc type, or a new block on an existing one.** Add a section to
  `check-doc-readers-unknown-fields.ts`. It must show that an extra field at the top level and in a
  nested block normalizes to the same output as the doc without it.

## Not covered (by design or not yet)

- **Unknown enum VALUES** in a known field are still errors. Examples: a new symbol cell `type`, a
  new blend mode, a new sound `kind`. So is `version: 2` against a `z.literal(1)`. These need a
  per-field decision (drop the entry, or fall back to a default), so they are not swept up by this
  rule.
- **The build-time delivery profile validator** (`packages/config-vite/deliveryProfile.js`)
  rejects unknown fields ON PURPOSE, because a typo in a delivery must fail the build. Its
  runtime twin, `packages/delivery-profile`, warns and ignores.
- **`game-spec`** (`packages/game-spec`) is a hand-authored CLI input, not a stored doc. Its
  top-level `.strict()` is deliberate typo protection.
- **Round-tripping.** An older launcher that loads a newer doc drops the unknown field from what
  it shows. If the author saves from that older launcher, the field is gone from the stored doc.
  The concurrency check does not catch this, because it is a legitimate `If-Match` save.
  - **Symbols:** the field can be recovered from `/api/editor/symbols/backups`, which keeps the
    raw replaced bytes.
  - **Win text:** it cannot be recovered, because win text has no backups.

  That is still far better than the previous behaviour, which lost the whole doc. Preserving
  unknown TOP-LEVEL blocks through a save is the planned next step: graft them from the stored
  object under the same ETag. Nested keys are left out, because grafting them could resurrect a
  parent the author deleted. Both protections only cover a rollback to a build that already
  contains them.

- **Save loses its typo guard.** The normalizers run on save too, so a misspelt field from a
  client bug is now dropped with a server warning instead of answering 400. That is a deliberate
  trade for forward compatibility. The same applies to an author still working in a NEWER tab
  after a rollback: that tab's save succeeds, but the fields the older server does not know are
  dropped, and only the server log says so. Keep request envelopes (`baseEtag`, `force`, `backup`) OUT of
  the doc you hand a normalizer, or every save warns about them.
