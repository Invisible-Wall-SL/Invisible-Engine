# `.irig` as our own format — design + build plan

> **Status: APPROVED (owner, 2026-11-03), import only.** This reverses
> [invisible-rigger](invisible-rigger.md) §2.1 ("Do not fork the format"). Progress per phase is in
> [status/rigger](../status/rigger.md); until Phase 3 nothing writes irig v1.
> Related: [invisible-rigger](invisible-rigger.md) (the editor), [live-assets](live-assets.md) (the
> export → deploy → bake → pull → register chain), [multi-user-concurrency](multi-user-concurrency.md)
> (save path and backups). Current state of the Rigger: [status/rigger](../status/rigger.md).

## 1. The question

Since Phase 6 of the Rigger plan we own the runtime: `packages/engine-rig` reads, poses and draws
every rig in the games and the tools, and `scripts/check-rig-runtime-free.mjs` keeps every
third-party runtime out of the workspace. But the **file** is still a 4.2-format file: `.irig` is the
4.2 export JSON under our extension, new rigs are stamped `skeleton.spine: '4.2'`
(`riggerNewRig.ts`), and the Rig parity workflow compares `engine-rig` with the 4.2.120 reference.

This document proposes making `.irig` a versioned format we own, with 4.2 data reaching it through an
**importer**. It is **import only** (owner, 2026-11-02): artists do not take rigs back into the
external editor, so there is no user-facing export.

## 2. Why §2.1's reasons no longer hold, and what still does

[invisible-rigger](invisible-rigger.md) §2.1 gave two reasons not to fork:

| Reason in 2026-06                                                                  | Now                                                            |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| "The instant our format diverges we lose the **free runtime**."                    | Gone. The runtime is `engine-rig`, ours; no 4.2 runtime ships. |
| "…and inherit a permanent **round-trip-fidelity burden**" with an external editor. | Not needed: rigs only come in from that editor, never go back. |

Meanwhile our own features have nowhere to live in a 4.2 file, so each found a workaround, and each
workaround costs something:

| Feature                        | Where it lives today                                                                   | Cost                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Image pivot                    | inline `pivot` key on a region attachment ([invisible-rigger](invisible-rigger.md) §9) | the runtime discards it; an exception to "pure 4.2"                                                                  |
| Rig → FX binding               | inline `event.fx = { effectId, bone? }`                                                | the runtime discards it, so `rigFxExport.ts` re-walks the raw JSON and bakes a separate `rigFx` manifest             |
| Rig → Flipbook binding         | inline `event.flipbook = { clipId, bone? }`                                            | same again: `rigFlipbookExport.ts` and its own manifest                                                              |
| Localized rig text             | a naming convention, `<base>@<locale>` attachments (`rigLocale.ts`)                    | guarded by a "looks like a locale" regex, because `logo@big` once read as locale `big`; no rename for a text element |
| Atlas origin, text panel state | sidecar files `source.json`, `text.json`                                               | out-of-band from the rig they describe                                                                               |
| Shipping                       | a `.irig` is copied to the game as `<stem>.json` (`symbolExport.ts`, `rigFxExport.ts`) | a rename the runtime no longer needs: `engine-rig/pixi`'s `rigSkeletonAsset` already loads `.irig`                   |
| Versioning                     | pinned to 4.2.x; a 4.3 data change is a format break we don't control                  | the pin exists only because the file is theirs                                                                       |

**The gain is one place, with a type and a version, for everything a rig means to us.** The loss is
that a rig no longer opens in the external editor, which nobody does today.

## 3. Goals and non-goals

**Goals**

1. `.irig` carries a format id and a version of our own, and a migration path for every bump.
2. Our extensions (pivot, FX and Flipbook bindings, localized text, origin) are typed fields the
   runtime reads, instead of keys it throws away or names it pattern-matches.
3. 4.2 JSON comes in through an **importer**; nothing downstream of it knows 4.2 exists.
4. No game changes how it looks or plays. Every repo rig and every R2 rig gives identical poses before
   and after migration.

**Non-goals**

- Rewriting the runtime. `SkeletonData` (`packages/engine-rig/src/data.ts`) and everything that poses
  and draws from it stay as they are.
- Reading the external editor's project file. It is proprietary; out of scope now as before.
- Exporting back to the external editor. Rigs come in from it; they do not go back.
- Diverging the _semantics_ in the first version. v1 means exactly what 4.2 means, plus our
  extensions. Real divergence (new constraint kinds, our own curve types, …) is a later, separate,
  versioned step.

## 4. The shape: document, runtime model, formats

Today there are two layers, and the file is one of them:

```
4.2 JSON (the file, edited raw by the Rigger) ──SkeletonJson──► SkeletonData ──► pose / draw
```

Proposed — three layers, the file is the middle one:

```
              importers                                    compile
4.2 JSON ───┐                                   ┌────────────────────────► SkeletonData ──► pose / draw
4.2 .skel ──┼──► IrigDoc  ◄──read/write──► .irig (irig v1)
(4.3 later)─┘       │
                    └──── 4.2 writer (internal: tests + Rigger adapter) ───► 4.2 JSON
```

- **`IrigDoc`** — a typed, plain-data, serializable document: bones, slots, skins, attachments,
  constraints, events, animations, and our extensions. Name-based references, like the file. This is
  what the Rigger edits and what the server inspects. Built in Phase 0 as
  `packages/engine-rig/src/irig/`: `schema.ts` holds the schema as data, and the importer, the reader
  and the TypeScript types all come from it; `irig.ts` has `readIrig(text | object) → IrigDoc`
  (strict: any value outside the schema refuses the document) and `writeIrig(doc) → string`.
- **`compileIrig(doc, attachmentLoader) → SkeletonData`** — replaces `SkeletonJson` on the runtime
  path. Because v1 is semantically 4.2, it is a port of `skeletonJson.ts` (~980 lines) reading typed
  fields instead of raw JSON, and keeps its `scale` handling and linked-mesh resolution.
- **Importers** — `importSpine42Json(json) → { doc, issues }` keeps every key the 4.2 reader reads
  plus our extensions, in source order (the first animation is the default one; timelines apply in
  order). Anything else is left out and listed in `issues`: a key the reader ignores, or a value of
  the wrong type. One bad item drops its whole list rather than shifting the indices after it.
  `.skel` import is harder: `skeletonBinary.ts` produces `SkeletonData`, not a document, so it needs
  either a `SkeletonData → IrigDoc` decompiler or to stay view-only, as `.skel` is today (§9 Q3).
- **4.2 writer, internal only** — `exportSpine42Json(doc) → object`: the 4.2 JSON back, with the
  extensions inline where today's files carry them. Not a feature: no UI or route offers it. It
  exists because v1 is isomorphic to 4.2, which makes it cheap, and three things need it: the Phase 0
  round-trip gate, the Rigger adapter (Phase 4a), and the Rig parity gate on our files (§8). It goes
  away once the Rigger is ported (4b) and parity no longer needs it.

### 4.1 irig v1 on the wire

JSON, so diffs, backups and the R2 viewers stay readable. The field list is fixed by
`packages/engine-rig/src/irig/schema.ts` (Phase 0):

```jsonc
{
  "irig": 1,                       // format version
  "skeleton": { "hash": "…", "importedFrom": "4.1.23", "x": 0, "y": 0, "width": 0, "height": 0 },
  "bones": [ … ],                  // 4.2 semantics, field for field
  "slots": [ … ],
  "ik": [ … ], "transform": [ … ], "path": [ … ], "physics": [ … ],
  "skins": [ … ],                  // always the list form; a region may carry "pivot": [u, v]
  "events": { … },
  "animations": {
    "idle": {
      …,                           // 4.2 timelines
      "events": [ { "time": 0.4, "name": "burst", "fx": { "effectId": "…", "bone": "…" } } ]
    }
  }
}
```

What changes versus 4.2: the `irig` version; the header's `spine` becomes `importedFrom` (provenance
only); skins are always a list; `pivot` (a region's `[u, v]`), `fx` and `flipbook` (an animation
event's bindings, every field the Rigger writes) are declared fields. What Phase 0 decided against:

- **`source.json` stays a sidecar.** It records the rig BUNDLE's atlas sync (`rigBundleSync.ts`),
  one per bundle and written by the sync, not by an author editing the rig.
- **No `text` map yet.** Localized text keeps its `<base>@<locale>` attachment names until §9 Q6 is
  answered; `text.json` (panel state) stays a sidecar either way (§9 Q4).

Whether the runtime keeps `pivot` / `fx` / `flipbook` on `SkeletonData` is Phase 1 (§9 Q5).

**What the gate found in the repo** (155 skeleton files, 33 distinct; none is `.irig`, those live on
R2): every key imports except 100 bones' `transform`, a 4.1 export's name for `inherit` that the
4.2 reader never reads. The R2 rigs are checked by Phase 5's dry run.

### 4.2 Detection, not extension

`rigSkeletonAsset` (`engine-rig/pixi/assets.ts`) today accepts an `.irig` only when the root has
`skeleton` and `bones`. It becomes: root has a numeric `irig` → `readIrig` + `compileIrig`; root looks
like 4.2 JSON → `importSpine42Json` + `compileIrig`. Both paths end in the same compile, so there is
one runtime path, and old files keep loading for as long as we want.

## 5. Who has to change

Grouped from a sweep of every source file that names `.irig` or reads rig JSON (2026-11-02):

| Group                                                              | Files                                                                                                                                                                                                                                            | Change                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime model readers** — read `SkeletonData` / a posed skeleton | `packages/pixi-svelte` rig components, `rigLocale.ts`, `rigBounds.ts`, the editor / FX / Symbols stages, `apps/lines`                                                                                                                            | none, except `rigLocale.ts` moving to the explicit text map                                                                                                                                           |
| **File movers** — copy, back up, list, index, by key               | `r2.ts`, `riggerIrig.ts` backups, `rigIndex.ts`, `rigBundleSync.ts`, `projectPaths.ts`, `editorArtExport.ts`, `symbolExport.ts`, `scripts/backup/iwbackup.py`, the `/api/rigger/*` delete / backups / upload routes                              | none; drop the `.json` rename once every runtime release in use reads irig v1                                                                                                                         |
| **Raw-JSON readers on the server**                                 | `rig.ts` `resolveEditorRigMeta` (the chokepoint every editor dropdown reads), `riggerIrig.ts` `irigDocProblem`, `/api/rigger/rigs/save`, `director/ops/rigger.ts`, `rigFxExport.ts`, `rigFlipbookExport.ts`, `engine-flipbook/animationPlist.ts` | read through `readIrig` / `IrigDoc`; `irigDocProblem` becomes the doc validator                                                                                                                       |
| **The Rigger**                                                     | `static/rigger/view.html` (~14.5k lines) + `cinematic.js`                                                                                                                                                                                        | edits a raw 4.2 object (`rawDoc`) directly — roughly 450 `.bones` / `.slots` / `.skins` touches — and samples channels with its own evaluator (open item 16 in status). The largest piece; §6 Phase 4 |
| **New rigs**                                                       | `riggerNewRig.ts`                                                                                                                                                                                                                                | writes irig v1                                                                                                                                                                                        |
| **Spikes and gates**                                               | `tools/rigger-spike/*` (8 name `.irig`), `tools/rig-parity/*`, `check-rigger-writes.ts`, `check-shared-rig-promote.ts`, `check-director-adapters.ts`                                                                                             | fixtures move to v1; parity compares via the internal 4.2 writer (§8)                                                                                                                                 |

## 6. Build plan

Each phase merges on its own and leaves every game unchanged. **Order matters for one reason: an
engine merge is a runtime release to every online game within seconds, and players boot published
snapshots.** So every runtime that might load a rig must read irig v1 _before_ any file is written in
it, and a runtime rollback must never go back past that reader (§7).

**Phase 0 — schema and the round-trip gate.** _Built 2026-11-03 — see §4 and status._ `IrigDoc` types, `readIrig` / `writeIrig`,
`importSpine42Json`, `exportSpine42Json`. A new offline gate in `check:all`: every repo rig
goes 4.2 → `IrigDoc` → irig v1 → `IrigDoc` → 4.2 with no semantic loss, and a rig carrying every
extension keeps them all through irig v1. No consumer changes. This is where the field list in §4.1
gets fixed.

**Phase 1 — the runtime reads irig v1.** `compileIrig`, detection in `rigSkeletonAsset` and in the
WebGL bundle (`build:invisible-rig`). Gate: for every repo rig, `compileIrig(import(json))` and
`SkeletonJson(json)` produce identical `SkeletonData`, poses and events over every animation — the
same comparisons `tools/rig-parity/parity.mjs` makes, run engine-rig against itself. Merge = runtime
release. Nothing writes v1 yet, so this is invisible.

**Phase 2 — server consumers read through the doc.** The raw-JSON readers in §5 accept both layouts
via `readIrig` / import. Still nothing writes v1.

**Phase 3 — new rigs and the importer UI.** `riggerNewRig.ts` writes v1. Uploading a 4.2 export
(`/api/rigger/upload`) imports it to v1 beside the artist's source, the way the Rigger saves an
`.irig` beside it today. Text and origin sidecars fold in on import.

**Phase 4 — the Rigger.** Two steps:

- **4a, adapter (small):** the Rigger keeps its 4.2-shaped working copy; load = `exportSpine42Json` +
  extensions re-attached, save = `importSpine42Json` + extensions → `writeIrig`. Ships v1 writes from
  the Rigger quickly, with the existing spikes still meaningful.
- **4b, port (large, incremental):** panels move from `rawDoc` to `IrigDoc` one at a time, starting
  with the extensions (pivot, event bindings, text), which are the ones the adapter makes awkward.
  The Rigger's own channel sampler goes away in favour of `engine-rig`'s, which also closes status
  open item 16.

**Phase 5 — migrate R2.** A script, like `apps/launcher-api/scripts/r2-sync-rigs.mjs`, upgrades every `.irig` to v1
under the existing backup rule (`backupIrigBeforeOverwrite` first), with a dry-run report, and proves
pose equality per rig before writing. Saves already upgrade lazily from Phase 4a; this catches the
rest. Then the `.json` rename on export is dropped.

**Phase 6 — retire the 4.2 assumptions.** The 4.2.x pin message in `tools/rigger-spike/rig.mjs` and
the Rig parity workflow move onto the internal 4.2 writer (§8). The 4.2 importer stays for as long as artists
send 4.2 exports.

Any real semantic divergence (irig v2) is a new decision after Phase 6, with its own migration.

## 7. Risks

- **Runtime rollback below the Phase 1 reader** would blank every v1 rig in every online game. After
  Phase 3, the "Runtime rollback" workflow needs a floor (refuse a target older than the reader), or
  Phase 1 needs to sit long enough that no rollback target predates it.
- **Published snapshots** carry the files they were published with, so an old snapshot keeps its 4.2
  files and keeps working. A re-publish takes the current runtime and the migrated files together.
- **Re-importing over Rigger edits.** An artist who changes a rig in the external editor and sends a
  new export re-_imports_ it, which replaces the Rigger's edits on that rig. That is the same as
  today, where the `.irig` shadows a newer source `.json`. With import only there is no way back into
  that editor, by decision (§9 Q1).
- **Two loaders during the transition.** Both end in `compileIrig`, and the Phase 1 gate compares
  them on every repo rig, so they cannot drift silently.

## 8. What happens to the Esoteric references

- `scripts/check-rig-runtime-free.mjs` stays exactly as it is.
- `tools/rig-parity` keeps fetching the 4.2.120 reference at run time, never as a dependency, and
  compares it with `engine-rig` on `exportSpine42Json(irig)` for every repo rig. That tests the
  importer, the internal writer and the runtime at once. When the writer goes (Phase 4b), parity
  falls back to testing the importer on the 4.2 fixtures.
- `tools/rig-parity/fetch-examples.mjs` stays: the reference's example rigs are 4.2 import fixtures.

## 9. Open questions for the owner

1. ~~**Do artists still go back to the external editor?**~~ **Decided 2026-11-02: no, import
   only.** No user-facing export; the 4.2 writer is internal (§4).
2. **Keep the `.irig` extension?** Proposed yes: the version lives in the file, not the name.
3. **`.skel` import** — needed, or stays view-only as today?
4. **`text.json` panel state** — fold into the rig, or stay a sidecar? It is editor state, not rig
   data, which argues for the sidecar.
5. **FX / Flipbook manifests** — read from the loaded rig at runtime, or keep baking? Baking avoids
   loading a rig to learn its bindings, and is already built.
6. **Localized text** — keep the `@locale` attachment names alongside the explicit map (cheap,
   compatible) or replace them?
