# Doc readers ignore unknown fields

**Every reader of an authored doc must IGNORE a field it does not know: drop it, never fail the
doc over it.** The same holds for a VALUE it does not know in a field it does know (see
[Unknown enum values](#unknown-enum-values)). That covers save and load normalizers, Zod schemas, the bake and the runtime resolve
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
4. **Known fields keep their validation.** A wrong type or a failed `.refine()` on a known field
   is still an error. So is an out-of-set enum value on a SAVE; a read degrades it per field (see
   [Unknown enum values](#unknown-enum-values)).
5. **A doc with only known fields normalizes byte-identically.** The strip pass is the identity
   on such a doc.

## How to follow it

- **Zod schema readers.** Keep the schema as it is: `.strict()` still documents the closed shape.
  Run the input through `stripUnknownKeysWithWarning(schema, input, '<doc>', unknownValues)`
  before `.parse()`, with `unknownValues` = `'drop'` on a read and `'reject'` on an author's save.
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

## Unknown enum values

A newer launcher also adds VALUES: a symbol cell `type`, a layer `kind`, a blend mode, a sound
`kind`, `version: 2`. Each would fail the whole doc on an older reader, which then falls back to its
empty doc. Worse, the exporters then prune `deploy/editor-symbols/` and `deploy/sounds/` to match
that empty doc, so the game ships the coded symbols and no project sounds while the bake reports
success. So a READ decides per field, and a newer build's value costs one entry, not the doc.

**What counts as unknown.** An enum, a literal or a discriminator does not list the value, but it
has the same primitive type as the values it does list (`'video'` against `['sprite', 'spine']`,
`2` against `1`). A value of the wrong type (`type: 3`, `version: 'two'`) is malformed, not newer,
and still fails the doc.

**What a read does.** `stripUnknownKeys` applies one rule, so each decision below follows from the
schema's shape rather than from code per field:

1. **An optional field drops the field**, and the reader's default applies.
2. **A required field drops the smallest thing that can go without it**: the optional block, array
   element or record entry around it.
3. **A field wrapped in `readUnknownValueAs(schema, fallback)` reads as the fallback.** Use this
   where the entry is worth more than the field.

Each case logs one server warning that names the value's path and what was dropped, for example
`[symbols] dropping "symbols.H1.static" over unknown value "video" at "symbols.H1.static.type"`.

| Doc                       | Field                                                                 | A newer value…                                                                                            |
| ------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| symbols                   | cell `type` (`symbols.<id>.<state>`)                                  | drops that state's cell. The state falls through to the coded binding.                                    |
| symbols                   | stacked `art.type` / `winArt.type`                                    | drops that stacked symbol / just its win art.                                                             |
| symbols                   | layer `kind` (a cell's `layers[]`, `bookVfx.background`/`foreground`) | drops that layer / slot; its siblings stay.                                                               |
| symbols                   | `transition.kind`                                                     | drops the transition.                                                                                     |
| symbols                   | `highlight.type`, `boardGlow.type` (`'spine'` only)                   | drops the override; the coded payframe / glow plays.                                                      |
| symbols                   | `flights.<kind>.head.kind`                                            | drops the head; the coded glow flies.                                                                     |
| symbols                   | `blendMode` (layers, transition)                                      | falls back to normal.                                                                                     |
| symbols                   | cell `direction`                                                      | falls back to the clip's own.                                                                             |
| symbols                   | `highlight.tintMode`                                                  | falls back to no tint.                                                                                    |
| symbols                   | `winLine.text.placement`                                              | falls back to `line`.                                                                                     |
| symbols                   | `tumblePattern.pattern`                                               | falls back to all-at-once; the block (and its `stepMs`) prunes away.                                      |
| symbols                   | `flights.<kind>.ease`                                                 | falls back to the coded ease.                                                                             |
| symbols                   | `coinLabel.cash.format`                                               | falls back to money.                                                                                      |
| symbols, win text, sounds | `version`                                                             | reads as `1`, keeping every field this build knows.                                                       |
| sounds                    | entry `kind`                                                          | reads as `sfx` (`readUnknownValueAs`) and keeps the sound.                                                |
| sounds                    | entry `status` / `origin`                                             | reads as absent, so `draft` / `library`: the values that claim nothing. A reviewer on a draft is dropped. |
| published symbol defaults | cell `type`, `highlight.type`                                         | drops that default cell / the highlight default.                                                          |

Two choices in that table are deliberate:

- **Sounds keep the entry.** Dropping a sound would silence every binding that names it, and this
  doc has no backups, so the next save would delete the sound for good while its file stays
  orphaned in `sounds/files/`. `kind` only sections the library, because the call site picks the
  player, so reading `sfx` costs nothing at play.
- **`version` is read best-effort.** Failing a newer version would bring back the empty-doc
  fallback this rule exists to remove. The price is a promise: **a newer version must never change
  the meaning of a field that already exists.** Add a field instead. A change that cannot be read
  best-effort needs a new doc key (a new R2 object), so older readers never see it.

### Saves keep their typo guard

The save path passes `unknownValues: 'reject'` (`saveSymbolsDoc`, `saveWinTextDoc`,
`saveSoundsDoc`), so an unknown value in a posted doc still answers 400. That is the opposite of
what a save does with an unknown KEY, and on purpose:

- **The tool only writes values it offers**, from dropdowns and pickers. An unknown value in a
  posted doc is far more often a client bug than a newer build.
- **A drop on save loses more.** An unknown key costs only that key. A dropped value can cost a
  whole cell, layer or sound the author has just made, with only a server log line to say so. A
  400 keeps the edit in the author's tab.
- **The cost:** an author still in a NEWER tab after a rollback, or whose save lands on the old
  instance during a rolling deploy, gets a 400 if the doc uses a value the old server does not know.
  Their work stays in the tab: they retry after the deploy, or reload. That is loud and safe, and it
  can never make a project unsaveable, because the stored doc is only ever READ leniently. Only the
  posted doc is checked strictly.

Three write paths drop instead, because nobody typed what they carry:

- **Symbols backup restore** (`/api/editor/symbols/backups`). A backup a newer launcher wrote must
  still restore on an older one. Refusing it would leave the author unable to restore at all.
- **Published symbol defaults** (`savePublishedSymbolDefaults`). A refused publish is swallowed by
  the build's `--optional`, and the grid silently keeps a stale set.
- **Every load path** (`load*DocWithEtag`, and the export, bake and runtime-bundle reads that sit on
  them). `normalizeSymbolsDoc`, `normalizeWinTextDoc` and `normalizeSoundsDoc` default to `'drop'`,
  so a new reader is lenient unless it opts out.

The runtime needs no change. Every game-side and bake-side reader of these blocks already ignores an
unknown value per field (a cell draws blank, a mode falls back), and none fails a whole doc or bundle.

**Adding an enum field?** Decide which of the three cases it is: make it optional if it has a
default, or wrap it in `readUnknownValueAs` if its entry must survive. Then add a case to section 15
of `check-doc-readers-unknown-fields.ts`. That section proves the read, the warning, the output and
the save guard for every field in the table above.

## Not covered (by design or not yet)

- **Unknown enum values outside the four Zod readers.** The hand-written readers mostly fall back
  per field already: game config, localization, FX, flipbooks, the layout doc, component params.
  Three still fail a whole doc on a newer value:
  - **flow-v2:** an unknown node `kind` makes the validator throw, which fails export-flow and so
    the bake and publish;
  - **flow-v2:** a `version` other than 2 reads as no doc;
  - **components:** an unknown `scope` or `category` hides the whole def.

  These are tracked separately, because `engine-flow-v2` ships in the runtime.

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

  The same goes for anything a read DROPPED over an unknown value: a cell, layer, stacked symbol or
  override block. It goes from the stored doc on that older launcher's next save. Symbols backups
  keep it, because an autosave inside the coalescing window still takes a copy when the stored
  doc was written by another instance or build. A sound keeps its entry, with its `kind` /
  `status` / `origin` reset to the defaults. Two gaps remain:
  - **The older tool does not say what it dropped.** Only the server log names it. A banner would
    need the list returned by the GET.
  - **A lenient restore at the retention limit.** Restoring a newer backup on an older launcher
    writes the reduced doc, and the restore's prune can then delete the full backup it came from.

  That is still far better than the previous behaviour, which lost the whole doc. Preserving
  unknown TOP-LEVEL keys through a save is the planned next step. It covers unknown KEYS only, not
  a known block a read dropped over an unknown value (`transition`, `highlight`): that would look
  exactly like a block the author cleared. Graft onto the NORMALIZED output, never before a
  `'reject'` normalize, or a grafted newer value would 400 every save. Graft them from the stored
  object under the same ETag. Nested keys are left out, because grafting them could resurrect a
  parent the author deleted. Both protections only cover a rollback to a build that already
  contains them.

- **Save loses its typo guard for KEYS** (values keep theirs, see
  [Saves keep their typo guard](#saves-keep-their-typo-guard)). The normalizers run on save too, so a misspelt field from a
  client bug is now dropped with a server warning instead of answering 400. That is a deliberate
  trade for forward compatibility. The same applies to an author still working in a NEWER tab
  after a rollback: that tab's save succeeds, but the fields the older server does not know are
  dropped, and only the server log says so. Keep request envelopes (`baseEtag`, `force`, `backup`) OUT of
  the doc you hand a normalizer, or every save warns about them.
