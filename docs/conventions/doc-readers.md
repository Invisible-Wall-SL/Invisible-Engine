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
  it shows, so the doc the author saves from it lacks the field. The concurrency check cannot
  catch this, because it is a legitimate `If-Match` save. What survives that save:
  - **Unknown TOP-LEVEL blocks are kept.** Before an `If-Match` save, `saveSymbolsDoc` and
    `saveWinTextDoc` read the stored object. If its ETag is the save's `baseEtag`, they copy every
    top-level key the schema does not declare onto the doc they PUT (`storedUnknownBlocks` in
    `apps/launcher-api/src/lib/server/unknownBlocks.ts`). The keys come from the schema's shape,
    not from `stripUnknownKeys`, because both roots are `.strip()` and that walk drops their
    extras silently. Nothing is copied for a create (`baseEtag: null`), a forced overwrite (no
    precondition: the author chose to replace bytes they never loaded) or a stored ETag that is
    not `baseEtag` (the PUT 409s anyway). Neither is it copied from unparseable bytes, nor when
    the stored object has no ETag (`etagDiffers` reads a missing ETag as "same", so that check is
    explicit). The API's response omits the kept blocks. A doc with only known fields saves
    byte-identically. The cost is one extra full-body GET per `If-Match` save. A storage error on
    that GET fails the save (the tab keeps its edits and retries) rather than silently dropping
    the blocks.
  - **A symbols backup restore keeps the BACKUP's unknown blocks**, not the live doc's: the
    restore replaces the live doc wholesale.
  - **Win text also keeps unknown fields ONE LEVEL DOWN**, inside a family (`toast`, `jackpots`,
    `lineMessage`, …), since it has no backups to recover them from (`withUnknownFamilyFields`,
    same file, same `If-Match`/ETag conditions). They go back into their family after the
    author's edits, also when the author emptied or blanked the family's known fields and it was
    pruned away: the author cannot see an unknown field, so clearing what they could see says
    nothing about it, and a family is a fixed namespace, not an entity whose deletion should take
    its contents along. Deeper levels and open maps (`winLevels`, `captions`) are not walked.
  - **Symbols drops nested unknown keys**, because a graft could resurrect an entity the author
    deleted (a symbol, a state, a layer) along with what it held. They are recoverable from
    `/api/editor/symbols/backups`, which keeps the raw replaced bytes.
  - **Components keep unknown fields at the top level and inside every entity the author kept**
    (owner decision 2026-10-13; `withUnknownComponentFields` in
    `apps/launcher-api/src/lib/server/componentUnknownFields.ts`). A component has no backups, and
    the next phases of `docs/design/rive-style-editor.md` add fields to the def, its nodes and its
    rows. What `saveComponent` keeps from the stored def:
    - every top-level field the def does not declare;
    - inside each ENTITY, matched to its stored copy by id, the fields it does not declare: a node
      anywhere under `root` (the root included; matched by `id`, so a node moved to another parent
      keeps them), a param or signal (by `key`), a slot (by `slotId`), an input or an event (by
      `id`), a node's listeners (by `id` within the node), an event's payload fields (by `name`
      within the event), and a state-machine layer (by `id`) with its states and transitions (by
      `id` within that layer, so a namesake state in another layer is a different entity) and a
      state's `onEnter` rows (by `id` within the state). A listener, payload field or `onEnter`
      row the read dropped (an action kind, pointer event or payload type a newer build added, or
      a key it does not know INSIDE an action, a payload value or a payload field's `type`, which
      the read must not rebuild without) is put back where it stood, as an unreadable input is. A transition's `conditions` are
      its own known data: they have no id and are not walked, so a newer field inside a
      condition is dropped with it;
    - every field of `stateMachine` itself it does not declare. That block is a fixed namespace,
      like a win-text family, so those fields are kept also when the author removed every layer
      (the block is then `{ layers: [] }` plus them, which a read takes for no state machine).

    The stored twin of an entity is the row the author SAW: of a duplicated id, the first row the
    read keeps, never an input the read dropped for its kind. A node id that appears twice (a
    legacy doc) has no single twin, so neither copy is grafted, and the save logs it. Each grafted
    field goes back after the stored field before it, so a no-op save keeps the stored key order
    and does not bump over a reordering.

    "Does not declare" means not a key of the engine-layout TYPE (the sets in
    `apps/launcher-api/src/lib/server/componentFields.ts`, launcher-only so no game bundle carries
    them, written as `Record<keyof …, true>` so `pnpm check:svelte` fails in both directions when a
    type and its set drift). It does not mean "not kept by the normalizer". So a known field the
    author cleared (`rotation`, `standsFor`, `slots`) is never put back, and a known field the
    normalizer drops (`capability`) is not kept either.

    **Matching by id is what makes the nested graft safe.** Symbols refuses nested keys because a
    graft could resurrect a deleted entity. Here an entity whose id is gone from the save was
    deleted, so nothing of it comes back, and a new entity never takes a deleted one's fields.
    **That holds only while MINTED ids are never reused: an editor must never give a new node,
    layer, state or transition an id the stored doc holds for a different one** (a deleted state's
    `Win`, a transition's `t_Idle_Win`), or the new entity inherits the old one's unknown fields.
    The server cannot tell the two apart. Nodes take no `kind` guard, since a node keeps its id when
    it is converted to a button, and layers, states and transitions have no kind. **Name-keyed rows
    are different**: a param, signal or slot is keyed by its name, and the editor re-adds fixed
    names (`uniqueKey`, the catalog toggles). The engine binds a param by its key, so a row re-added
    under the same key is the same entity to it and takes the stored fields. A row that carries a
    `kind` (a param, slot or input) takes them only while the kind is the same, though: a `label`
    string param deleted and re-added as an image param is a different param and inherits nothing. A
    signal has no kind and always matches its key.

    Deleting an entity takes its unknown fields with it, also inside a known block the author
    cleared: deleting every slot deletes their unknown fields too. They are entities the
    author saw and removed, unlike a win-text family, which is a fixed namespace. A component has
    two fixed namespaces, the def itself and its `stateMachine`, whose own fields are always kept.

    The graft goes one level into each entity. The fields inside a known field (a node's
    `overrides`, `preview`, `bind`) are not walked. A child node's fields are never dropped by a
    READ: the normalizer passes `root.children` through, so the tab normally posts them back
    itself. For child nodes, the graft fills only what the posted node lacks, and a posted value
    stands. A NEWER tab's edit of a child node field therefore lands, unlike its edit of a
    top-level, root or row field, which the normalizer drops in favour of the stored copy. A NEWER
    tab cannot CLEAR one of those fields through an older server at all: the field's absence looks
    exactly like "this build never saw it", so the stored copy comes back. That is a change: before
    the graft, the child node's posted bytes were written as they were, so such a clear landed.

    The save's own read is the graft source, so this costs no extra GET. Unlike symbols, a
    **forced save grafts too** ("Save on top" after a 409): it CASes on the ETag of that same read,
    so the graft is as race-free as an `If-Match` one, and a stale tab is exactly the tab that
    lacks a newer launcher's fields. Nothing is kept for a create or unparseable bytes. The
    version bump is decided on what this build can see, so a no-op save from an older launcher
    does not bump. A save that leaves the known content as it is but changes the unknown fields
    does bump (a promote that carries the project's fields over the shared copy's). The compare
    covers only the entities the save still has, so a row the read dropped bumps nothing. The
    snapshot is the merged doc. **An existing `<id>.v<N>.json` is never rewritten**: a
    same-version save only creates a missing one (`If-None-Match: *`). A known-only def saves
    byte-identically, and every built-in does too (gate).

    **Promote to shared keeps the PROMOTED project def's unknown fields**, not the replaced shared
    copy's: the client sends `promotedFrom` (the project) and `sourceEtag` (the ETag its draft
    loaded). They are kept for **Promote on top** too, since `force` is about the target. When the
    project def was saved (or removed) since the draft loaded, the promote answers 409
    `source-conflict` and writes nothing: the author reloads, because promoting without its fields
    would drop them. A plain shared save keeps the shared copy's own fields.

    **"This game's defaults"** (`saveComponentDefaults`) keeps top-level fields beside
    `id`/`params` under the same `If-Match` conditions, at the cost of one extra GET. A restore
    keeps the BACKUP's fields, not the live sidecar's. `params` is an open map, written as posted.

  - **A NEWER tab saving to an older server** keeps the stored copy of an unknown block or family
    field, not the tab's edit of it: the server drops the posted value and copies the stored one.
  - **Retiring a field** is now a deliberate act. A top-level key (or win-text family field)
    removed from the schema reads as unknown and is carried through every save, so the change that
    retires it must delete it from the stored docs. The same holds for a component's def, node or
    row field removed from the engine-layout types, and with them from `componentFields.ts`.
  - **The graft is added after the save's `'reject'` normalize** and is never normalized itself,
    so a newer enum value inside a kept block cannot make every save answer 400.
  - The graft only helps after a rollback to a build that contains it.

  **A component row a read DROPPED over an unknown value.** A param of an unknown `kind` is dropped
  by the read, and with it every node binding that names it (`pruneOrphanParamBindings`). It is NOT
  kept in the latest copy: putting the row back without its bindings would store an unbound param
  that no author made. That matches symbols' rule for a known block a read dropped (below). The
  `<id>.v<N>.json` snapshot keeps both, because an existing snapshot is never rewritten, whether the
  older launcher's save bumps the version or not. **An INPUT of a kind this build does not know is the opposite, and its row is
  kept** (the gate stands one in as `vec2`; `text` was the stand-in until Phase 7 made it a known
  kind, so a stored `text` row now simply reads). The read drops the unknown row, and the save puts
  the stored row back by id, in its stored position. Two facts justify that. First, conditions name inputs by id and are not pruned when an
  input is missing, so the row alone restores a working interface, as a sound keeps its entry.
  Second, an older build can tell the row was never shown (its kind is unknown here), so its absence
  from the save is not a deletion. The kept row goes back after the nearest stored row before it
  that the save still has. It is not kept when the save now uses its id for an input or a signal
  (signals share the input id space): the author's entity wins and inherits none of it. A row with
  an empty id or kind is malformed, not newer, and is not kept. A forced save keeps it like any
  graft. Since it changes nothing this build can see, the version compare looks at the whole row, so
  a save that replaces it (a promote) still bumps. A transition the read dropped over a condition it
  cannot read is NOT kept: it names states by id, and the author may have deleted them. Like every
  graft, a kept row is never re-normalized, so a newer value inside it cannot make a save answer 400.

  **A known block a read DROPPED over an unknown value is NOT kept.** That covers a cell, layer,
  stacked symbol or override block (`transition`, `highlight`). It is not an unknown key, and
  keeping it would look exactly like a block the author cleared. It goes from the stored doc on
  that older launcher's next save. Symbols backups keep it, because an autosave inside the
  coalescing window still takes a copy when the stored doc was written by another instance or
  build. A sound keeps its entry, with its `kind` / `status` / `origin` reset to the defaults. Two
  gaps remain:
  - **The older tool does not say what it dropped.** Only the server log names it. A banner would
    need the list returned by the GET.
  - **A lenient restore at the retention limit.** Restoring a newer backup on an older launcher
    writes the reduced doc, and the restore's prune can then delete the full backup it came from.

  The gate is `apps/launcher-api/scripts/check-save-keeps-unknown-blocks.ts`.

- **Save loses its typo guard for KEYS** (values keep theirs, see
  [Saves keep their typo guard](#saves-keep-their-typo-guard)). The normalizers run on save too, so a misspelt field from a
  client bug is now dropped with a server warning instead of answering 400. That is a deliberate
  trade for forward compatibility. The same applies to an author still working in a NEWER tab
  after a rollback: that tab's save succeeds, but the fields the older server does not know are
  dropped, and only the server log says so. Keep request envelopes (`baseEtag`, `force`, `backup`) OUT of
  the doc you hand a normalizer, or every save warns about them.
