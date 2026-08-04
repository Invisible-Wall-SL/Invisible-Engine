# Pipeline tools — multi-user concurrency (lost-update prevention)

Status: **Phases 0 + 1 + 2 SHIPPED + owner-verified live** (2026-08-04; migration 0014 applied,
two-profile tests run per tool). Phase 3 (Python tools Atlas/Sheet) is the only remaining concurrency
work — a separate later effort gated on threading a stable user id to those services. See the Phase 1
header below for the exact residual — the conditional-write floor is live across every authoring tool; what
remains inside Phase 1 is small and enumerated there.

Owner decision 2026-07-16: **lease now, CRDT later.** Two to three people share a
`(client, project)`; many more work concurrently on *different* projects through
the same pipeline. Today every authoring tool silently overwrites its neighbours.
The fix is layered — a Postgres **soft lease** so two people don't collide in the
first place, and R2 **conditional writes** (`If-Match`) underneath as the
correctness floor for everything a lease can't cover. Real-time collaborative
editing (CRDT/Yjs) is explicitly a **later, separate** project — it is not this
doc, and it is gated on the whole-doc blobs going granular first.

> Related: [atlas-per-user-session](atlas-per-user-session.md) (per-user *selection*;
> its accepted overwrite residual is superseded here) ·
> [unified-project-repo](unified-project-repo.md) (the R2 key layout) ·
> [invisible-rigger](invisible-rigger.md) §"Open questions" (resolved here).

## The problem (as observed)

The owner reports: tools autosave, and when more than one user is in the same
tool they overwrite each other's work.

That is real, and it is worse than "autosave races". **There is zero concurrency
control anywhere in the persistence layer.** Every save in every tool is an
unconditional, last-writer-wins whole-blob `PutObject`. Every ETag in the repo is
HTTP *read* caching (`If-None-Match` / 304); no write anywhere sends `If-Match`.

## Root cause — three distinct bugs wearing one costume

These have different blast radii and different fixes. Treating them as one
"locking problem" is how this stays broken.

### 1. Whole-doc blob clobber (the reported symptom)

The Scene Editor, Flow v2, Symbols and Localization each serialize the **entire**
client-side document and PUT it over the shared key. Both users loaded the doc at
page load; the later writer erases not just the *conflicting* nodes but
**everything the other person did**.

- `editorStorage.ts:73` `saveDoc` stamps `next.updatedAt` at `:79` and **never
  reads or compares it** — a write-only stamp. The client never sends a base
  version, so the server could not check even if it wanted to.
- Autosave makes the window tiny and constant: Scene Editor `AUTOSAVE_MS = 1200`
  (`routes/(app)/editor/+page.svelte`), Flow v2 `AUTOSAVE_MS = 800`
  (`routes/(app)/flow-v2/+page.svelte`), both resetting debounces armed by
  ~35 `markDirty()` call sites.
- Symbols, FX, Components and Localization are **manual-save**, so they are less
  acute — but equally unguarded.

### 2. Read-modify-write on GLOBAL indexes (the highest blast radius)

`rigger/rigs/save/+server.ts:84-97` does `getObjectText(index)` → mutate array →
`putObjectText(index)` with no guard. The same pattern rebuilds
`_shared/animations/index.json` and `skeletons.json`.

**`_shared/rigs/index.json` and `_shared/animations/index.json` are global across
every client and project** (`projectPaths.ts:180-199`). So this races between two
users **who share no project at all** — precisely the majority case for this team.
A per-project lease would never catch it. Losing the index row silently orphans a
rig whose `<id>.json` blob was written fine, so the corruption looks like "my rig
vanished" rather than "a save failed".

`componentStorage.ts` has a `version` field that *looks* like optimistic
concurrency but is **pinning, not CAS**: two concurrent saves both read N, both
compute N+1, both write the snapshot and the latest pointer. One is lost, and the
`.v<N>.json` snapshot can be overwritten despite the "immutable history" comment
at `projectPaths.ts:125-137`.

### 3. Atlas / Sheet staging divergence

Per [atlas-per-user-session](atlas-per-user-session.md), the Python tools hydrate
their staging tree from R2 **at startup only**, then `_mirror()` back. Any R2
change made by another user during the container's lifetime is invisible to the
running process, and its next mirror pushes a blob derived from stale startup
state. This one cannot be fixed by a lease yet — see the dependency in Phase 3.

## Why `If-Match` alone is not the answer (and why we still need it)

The obvious fix is conditional PUT: thread the ETag from load back to save, 412
on mismatch. But with a 1.2 s autosave, two people editing means the second user
eats a 412 every 1.2 s and then loses their session's work on reload anyway.
**That converts silent data loss into loud data loss.** Necessary, not sufficient.

So: the **lease** is what stops the collision happening; **`If-Match`** is what
makes "no lost write" a guarantee rather than a hope, covering the cases a lease
structurally cannot — a stale tab whose lease expired, a takeover mid-flight, the
Python tools that hold no lease, and any future tool that forgets to.

## The linchpin

Every TypeScript write in the launcher **app** funnels through **one module**:
`src/lib/server/r2.ts` — `putObjectText:109`, `putObjectBytes:124`. Nothing in
`src/` hand-rolls its own S3 client. (Two footnotes so Phase 1 isn't over-claimed:
`apps/launcher-api/scripts/r2-sync-spines.mjs:181` writes `skeletons.json`, and
`scripts/seed-game-editor.mjs:215` writes `editorDocKey` — **both with their own
`@aws-sdk` client, bypassing `r2.ts` entirely**. They are manual dev/ops scripts, not
runtime paths, so the chokepoint claim holds for the *app*, not for
`apps/launcher-api/scripts/*`.) `PutObjectCommand` is constructed with only
`Bucket/Key/Body/ContentType` (`:114-121`, `:128-136`), so no caller *can* pass a
precondition today.

Better still, the ETag is **already flowing and just gets dropped one layer too
early**: `getObjectBytes:30` returns `etag` (`:38`) and `headObject:215` exposes
one, but `getObjectText:104` — which every storage helper actually calls —
discards it. Add the precondition to those two writers and an ETag-carrying read,
and every tool inherits conditional writes without touching each endpoint.

**R2 supports this.** Cloudflare's S3 API implements `If-Match`, `If-None-Match`,
`If-Modified-Since` and `If-Unmodified-Since` on `PutObject`
(<https://developers.cloudflare.com/r2/api/s3/api/>). We are on `@aws-sdk/client-s3`
against the R2 S3 endpoint (`r2.ts:1-28`) in long-lived Railway Node containers —
not Workers, not the R2 binding — so the header path is available to us. The
Python twin (`services/_shared/iw_common/storage.py:59`, boto3) needs the same
treatment.

## Scope

**In:** lost-update prevention for authored docs — Scene Editor, Flow v2, Rigger
(skeletons + the shared rig/animation libraries), FX, Symbols, Components,
Localization.

**Out (explicitly):**
- Real-time collaborative editing / CRDT. Later project, gated on granular docs.
- Making the whole-doc blobs granular. It is the right long-term move and the
  precondition for CRDT, but it is a per-tool refactor and not this plan.
- Per-user *selection* isolation — that is [atlas-per-user-session](atlas-per-user-session.md).
- The lease as a **security** boundary. It is a coordination hint, not authz;
  `toolScope.gate()` remains the actual gate.

## Build plan

Ordered by **blast radius**, not by tool.

### Phase 0 — Kill the cross-project index races
The only bug actively corrupting data between users who have nothing to do with
each other, and the one a lease can never fix. Smallest surface, highest value.

- `_shared/rigs/index.json` and `_shared/animations/index.json` are **pure
  metadata lists living in an object store for no good reason**. Move them to
  Postgres rows (`sharedRig`, `sharedAnimation`) — the race disappears
  *structurally* rather than being guarded. Drizzle + a migration; the `<id>.json`
  blobs stay in R2 as the heavy payload.
- **Four endpoints RMW these indexes, not two** — `rigs/{save,delete}` and
  `animations/{save,delete}`. The `delete` twins are *worse* than the saves:
  `rigs/delete/+server.ts:38-40` swallows a parse failure and leaves the row while
  the blob is already gone, so the save race orphans a blob (invisible) and the
  delete race dangles a row (a 404 in the user's face). Both silent today.
  `rigs/list` + `animations/list` are the only readers; both are launcher-internal.
- **Ordering hazard the migration inherits:** blob and row are two non-atomic
  operations either way. Write the row **after** the blob on save, and **before**
  the blob delete on delete, so the failure mode stays "orphaned blob"
  (invisible, garbage-collectable) rather than "dangling row" (a user-visible 404).
- **Do not mirror the index blobs.** *(Open question resolved 2026-07-16 by an
  exhaustive survey: the only readers are six launcher TS routes, all behind
  `rigs/list` / `animations/list`. Nothing in `services/`, `scripts/`, `packages/`,
  the bake/export chain, or the desktop launcher touches them.)* They are **left in
  place, unmaintained**, rather than deleted with the migration: they are the only
  record of what the catalog held at cut-over. Note honestly what that is and isn't
  — the blobs FREEZE at migration time and are never written again, so a rollback
  recovers the catalog **as of cut-over**, missing everything saved since. That is a
  partial-recovery net, not a rollback story.
- Backfill: **lazy** one-shot import on first list after deploy (not a manual
  script), so the library is never briefly empty while someone remembers to run it.
  Gated on an `app_settings` marker, **not** on the tables being empty — an
  empty-table check resurrects every deleted rig the moment a user deletes the last
  one. Runs in one transaction behind an advisory lock that the delete paths also
  take, so an import cannot slip between a delete and re-create the row.
- **The list path must fail SAFE if R2 errors, and the delete path must fail LOUD.**
  `getObjectText` rethrows everything but a 404, and `static/rigger/view.html`
  renders a failed list as "No saved rigs yet" — so an unhandled throw in the
  backfill makes a transient R2 blip reproduce the exact "my rig vanished" symptom
  this phase removes, on a catalog that no longer lives in R2. Delete is the
  opposite: deleting before the import has run deletes nothing, and the later import
  resurrects the row as a dangling pointer to a deleted blob — so a delete that
  cannot confirm the backfill must fail rather than proceed.

### Phase 0 — follow-up (retire the legacy path)
Once the backfill is confirmed live and the blobs are no longer wanted as a net,
delete **together**: the two index blobs, `backfillOnce` + its marker, and the now-dead
`sharedRigsIndexKey` / `sharedAnimationsIndexKey` exports in `projectPaths.ts` (the
backfill is their last consumer). Don't leave them to rot.
- **NOT in this phase: `skeletons.json`.** *(Scope corrected 2026-07-16 — an
  earlier draft of this doc lumped it in here; that was a category error.)* It is
  **derived by LIST**, not RMW (`spineIndex.ts:136` `buildSkeletonsIndex` →
  `listAllKeys:141`), so two concurrent saves each re-derive from current bucket
  state and the RMW race does not exist. It is **per-project**
  (`<client>/<project>/spines/skeletons.json`), so the Phase 2 lease covers it for
  free. And it has live readers on the **export→deploy path**
  (`editorArtExport.ts:402`, `symbolExport.ts:303`), so making Postgres its source
  of truth would carry asset-shipping blast radius for a race Phase 2 handles
  anyway. Its residual is a narrow LIST-races-an-in-flight-upload window — a
  different bug with a different fix.

### Phase 1 — Conditional writes through the chokepoint — **SHIPPED 2026-08-04**
The correctness floor. Contained because of the linchpin above.

> **Audited against code 2026-08-04. What shipped:** `r2.ts` carries the full
> convention (`PutPrecondition`, `precondition()`, `getObjectTextWithEtag()`,
> `ConflictError`, `isPreconditionFailed` = 412-only, `jsonBaseEtag`/`formBaseEtag`).
> **16 storage helpers** thread it and **13 authoring surfaces** (editor, flow-v2,
> flow-v2 library, symbols, fx, flipbook, win-text, game-config, localization,
> component, kind, template + the componentDefaults sidecar) are wired. Every
> autoserver and manual-save tool now: reads with an etag, distinguishes absent
> (`null`) from malformed (etag-carried), CAS-writes on save, and answers `409
> { error: 'conflict' }` via `json()`/`fail()` (never `error()`), with a visible,
> **non-destructive** conflict state ("Overwrite with mine" / "Reload theirs";
> components use a versioned confirm()). Every session-gated save (flow-v2, fx,
> flipbook) carries `projectKey` and refuses on `409 scope-mismatch`
> (non-forceable); the `?project=`-resolved tools (editor, symbols, win-text,
> game-config, localization) are safe by construction. The `symbols/+server.ts`
> `isConflict`-before-`error(502)` ordering, the fx create-clobber
> (`ifNoneMatch:'*'` via `baseEtag:null`), the fx meta-sidecar (guard the doc,
> write the sidecar after, unguarded), and the three global keys
> (`_shared/flow-v2/functions.json`, `_shared/editor-kinds/<id>.json`,
> `_shared/editor-templates/<gameType>.json`) are all done.
>
> **Residual status (updated 2026-08-04 — three of four CLOSED):**
> 1. **`baseEtag` fail-open — CLOSED.** `$lib/server/writeGuard.ts` makes it required + 400
>    at every save endpoint (kind exempt — create-guard model). See the dated note below.
> 2. **Components ETag load→editor→save — DONE.** `listComponentsWithEtags` /
>    `loadComponentWithEtag` carry the etag; page load returns a `componentEtags` map;
>    `components/+page.svelte` stamps `draftEtag` on open and re-adopts the save response's
>    new etag; the POST CASes per scope key; the GET `?id=` (no version) returns
>    `{ def, etag }`. Promote-to-shared GETs the shared key's etag first so it CASes the
>    global key. Scene Editor's "convert to component" sends `baseEtag: null`. Version-bump
>    snapshot recovery is preserved; the snapshot-before-pointer landmine is held by the
>    in-process `baseEtag` compare (verified offline: a stale save conflicts before any
>    `.v<N>` write). **Also fixed:** `componentStorage.ts` used `ConflictError` unimported —
>    conflicts were throwing `ReferenceError`→502; now 409.
> 3. **`componentDefaultsStorage` — DONE.** `loadComponentDefaultsWithEtag` (reports
>    `existed`) + `saveComponentDefaults(…, baseEtag)` + `precondition`; the
>    `/api/editor/component-defaults` POST is CAS-guarded and 409s (no UI writes it yet, so
>    it is future-proofed rather than fixing a live regression).
> 4. **Shared `$lib/saveState.svelte.ts` — HELPER BUILT 2026-08-04, migration staged.** The
>    rune module + `$lib/SaveStatusBadge.svelte` are written and verified offline (31
>    assertions over the real compiled module). The 8 page migrations onto them are
>    behavior-preserving and mechanical from the parity checklist, held for an owner
>    API-shape confirm + per-tool two-profile test. See **Phase 2a** below for the recorded
>    API and rationale.
>
> Everything below is the original plan, left for the rationale; it is DONE except where
> point 4 above says otherwise.

- `r2.ts`: optional `PutPrecondition` (`ifMatch` / `ifNoneMatch`) on `putObjectText` /
  `putObjectBytes`, which now RETURN the new ETag (`PutObjectOutput.ETag`) so a client
  can keep autosaving without a re-read. Plus `getObjectTextWithEtag()` — the ETag was
  always there on `getObjectBytes`, just dropped by `getObjectText`, which is the one
  every storage helper calls. A failed precondition → a typed `ConflictError`.
  **Only 412 counts as a lost CAS** — S3's 409 `ConditionalRequestConflict` means "two
  conditional writes raced, retry", i.e. transient; mapping it to the sticky conflict
  state would wedge the tab over a blip and push the author toward the destructive
  button. And only a request that CARRIED a precondition can fail one, so the
  translation is gated on that — otherwise an unconditional write that happens to 412
  would report "someone else saved this" about a doc nobody touched.
- Every endpoint returns a consistent `409 { error: 'conflict', … }` — **`json({error})`,
  never `error()`**, per the publish-502 lesson ([[gotcha_publish_502_flowv2_nodes_guard]]).
  ⚠ `routes/api/editor/symbols/+server.ts` has a catch-all `throw error(502)` that will
  swallow a `ConflictError` into an opaque 502 the moment `If-Match` lands — the
  `isConflict` branch must come FIRST.
- Storage helpers return the loaded ETag; save takes an expected ETag. Order:
  `editorStorage` + `flowV2Storage` (the two autosavers = the reported bug), then the
  **global** keys, then the manual-save tools.
- Clients thread the ETag through load → save → response. There is **no shared
  client save/dirty helper** — seven pages hand-roll it (five different `dirty`
  implementations; `postAction` is duplicated verbatim between editor and
  localization). That is seven chances to forget the ETag, and the next tool inherits
  nothing. A shared rune module (`$lib/saveState.svelte.ts` — **must** be `.svelte.ts`,
  [[gotcha_runes_in_plain_ts]]) is the lever that also makes Phase 2's read-only mode
  and takeover banner a one-place change. Deferred to Phase 2, noted here as its
  prerequisite.

**Dated decision — a missing `baseEtag` FAILS OPEN (2026-07-16).** An absent field means
an unconditional write, not a rejection, so a tab still running a pre-Phase-1 bundle can
still save across the deploy instead of having its work stranded. This is **temporary and
must be closed**: nothing bounds it today, so any future endpoint that forgets `baseEtag`
gets a silently unguarded write and a green build — exactly the "new tool ships another
unguarded `putObjectText`" regression the review gate exists to stop. **Trigger to remove:
once no pre-Phase-1 tabs can remain (a day after the Phase 1 deploy), make `baseEtag`
required at the endpoint layer and 400 without it.** The shared client helper below is what
makes that safe to enforce.

> **DONE 2026-08-04 (residual #1 closed).** The trigger was pulled: `$lib/server/writeGuard.ts`
> (`writeBaseEtagJson`/`writeBaseEtagForm`) makes the field REQUIRED — a save that sends
> neither a present `baseEtag` (string `ifMatch`, or `null` create) nor `force:true` is a
> 400 — and it is applied at every save endpoint (editor doc, flow-v2, flow-v2 library,
> symbols, fx, flipbook, win-text, game-config, localization, component, template,
> component-defaults). `jsonBaseEtag`/`formBaseEtag` survive only INSIDE `writeGuard` for the
> value mapping. **Kind is deliberately exempt:** it guards with `ifNoneMatch:'*'` +
> `overwrite`, never `baseEtag`, so it never had a fail-open to close.

**A `force` write must never cross a project boundary.** `toolScope.gate()` resolves the
project from the SESSION, while the tool pages resolve it from `?project=` (and sync it
back). So a tab can hold project X's doc while its save targets Y — a pre-existing silent
wrong-project clobber that `If-Match` turns into a *worse* failure: X's etag vs Y's object
→ 412 → a "someone else saved this, Overwrite?" banner that invites the author to destroy
an unrelated project. Any save whose client can't name its project must therefore send
`projectKey` and be REFUSED on mismatch (`409 scope-mismatch`, distinct from a conflict,
**not** forceable). Done for flow-v2; the editor was already safe because its `postAction`
re-appends `?project=`. Check this for every tool Phase 1 touches.

**The create path — `absent` vs `malformed` (do this first, it is structural).**
Every loader today catches a parse error and returns the SAME value as the not-found
path (`editorStorage:50` vs `:53-55`, `flowV2Storage:39` vs `:43-45`, `symbolsStorage`,
`localization`, `fxStorage`, `flowV2LibraryStorage`). So "the client has no ETag" does
NOT imply "no object". Sending `ifNoneMatch: '*'` on that assumption makes a
**corrupt-but-present doc permanently unsaveable** — 412 forever, no UI path out.
Helpers must report `existed` from the READ, not from parse success:
`!existed` → `ifNoneMatch: '*'`; `existed && malformed` → `ifMatch: <etag>` (overwrite
the corruption deliberately); `existed && parsed` → `ifMatch: <etag>`.

**Touch list corrections** *(from the Phase 1 survey, 2026-07-16 — the original list
missed these)*:
- **`_shared/flow-v2/functions.json` (`flowV2LibraryStorage.ts`) — the worst one, and
  it is not in Phase 0.** A GLOBAL key with a whole-doc PUT whose read-modify-write
  window is **the entire editing session** (read at page load, written at 800 ms
  autosave), not the ~ms of a single request. Two people on unrelated projects each
  editing a function: the second write erases the first's outright. A lease cannot
  cover a global key, so here `If-Match` is the WHOLE fix, not the floor. Do it first.
- **`kindStorage.ts:113`** (`_shared/editor-kinds/<id>.json`) and
  **`templateStorage.ts:56`** (`_shared/editor-templates/<gameType>.json`) — global
  authored docs, create-if-absent, written from the editor. Unguarded today; without
  `ifNoneMatch` one author's kind silently replaces another's of the same id.
- **`componentStorage.saveComponent` returns `void`** — the client cannot learn its
  reconciled version, let alone an ETag. Signature has to change.
- **✅ Components are now FINISHED (2026-08-04 — residual #2 closed).** The ETag is
  carried through `listComponentsWithEtags`/`loadComponentWithEtag` → the page's
  `componentEtags` map → `draftEtag` on open → `baseEtag` on save (re-adopted from each save
  response), with the POST CASing per scope key and a `ReferenceError`→502 conflict bug fixed
  (`ConflictError` was unimported). The prose below described the pre-fix state:* `listComponents`/`loadComponent` still return no
  ETag, so the Component Editor has none to send, so `saveComponent` falls back to the
  ETag of its own read. That closes only the **in-request** read→write window (tens of
  ms); the window this whole phase is about — A and B both open the def, A saves, B
  saves five minutes later — is still **last-writer-wins on the latest pointer**. What
  limits the damage is the version bump: A's work survives as `<id>.v<N+1>.json`, i.e.
  *recoverable by a human who knows to open the version browser*, NOT un-lost.
  **To finish: carry the ETag through `listComponents`/`loadComponent` → the editor →
  back on save.** That matters most for `scope: 'shared'` defs, which live on a GLOBAL
  key no lease can cover.
- **Landmine to remember if the snapshot guard is ever revisited:** writing the
  immutable `<id>.v<N>.json` BEFORE the latest pointer means a lost CAS on the pointer
  leaves an orphan snapshot at N+1 — and then every later save recomputes N+1, collides
  with the orphan, and 409s **forever**, unforceably. Fixed by comparing `baseEtag`
  in-process before ANY write, plus tolerating an `ifNoneMatch` 412 whose stored bytes
  are identical (an idempotent retry after a transient failure of the second write).
  Do not reorder these writes without re-deriving that.
- **`readComponent:108-123` swallows EVERY read failure** and returns `undefined`, so
  a transient R2 blip makes `saveComponent:157` believe the def is new, keep the posted
  version, and overwrite the stored def *and* its snapshot at the same version. The
  Phase 0 fail-safe-vs-fail-loud lesson, reproduced: the save path must fail LOUD.
- **FX create-path clobber:** a never-saved effect derives its id from its NAME
  (`fx/+page.svelte:97-98` → `fxStorage:137` slugs it), so "Save" on a new effect
  sharing a colleague's name silently overwrites it — and no ETag helps, because the
  client has none. Only `ifNoneMatch: '*'` → 409 "an effect named X already exists"
  fixes this.
- **`fxStorage.ts` writes doc + meta sidecar as two unconditional PUTs.** ~~Fold `FxMeta`
  into the doc~~ — **superseded 2026-07-16, on contact with the code.** The premise
  (two conditional PUTs can't be atomic, so collapse them into one object) was right but
  the conclusion was wrong: `FxMeta` holds nothing but editor VIEW state — camera
  pan/zoom and the last-selected layer (`fxStorage.ts:25`). It is not authored content,
  so it does not need a precondition at all. **Guard the doc; leave the sidecar
  unguarded and write it after.** Losing a race on the sidecar costs a scroll position,
  not work — whereas folding editor state into the shipped artifact would be a real
  architecture change to buy atomicity nobody needs. Two objects, one guard, no lost
  work.
- **Do NOT add `If-Match` to build output** — `editorArtExport`, `effectExport`,
  `flowExport`, `flowV2Export`, `fontExport`, `symbolExport`, `spine.ts:602` all write
  under `deploy/` and are re-derived wholesale on every export; a precondition would
  only make a re-run fail. Same for the `skeletons.json` rebuilds (derived by LIST).
- `projectScaffold.ts:91` seeds behind an `objectExists` check — a TOCTOU race whose
  seeds are idempotent, so impact is nil. Cheap win: `ifNoneMatch: '*'` + swallow the
  409, which also deletes a round trip.

- Conflict UX floor for this phase: a non-destructive "someone else saved this —
  reload" state that does **not** silently discard the local doc. **This is already the
  status quo** — every client clears `dirty` only on success and none reloads on
  failure. The requirement is therefore *don't regress it*: do not add an
  `invalidateAll()` to the conflict path. What's missing is only a visible state
  instead of flow-v2's silent `saveStatus = 'error'`.

### Phase 0 — newly-found scope (SHIPPED 2026-08-04)
The Phase 0 survey covered the rigger indexes and missed two more RMW-on-a-global-key
sites with the same blast radius — same bug, same "a lease can never catch it", same
"it's a metadata list living in an object store for no good reason" fix:
- **`testServerManifest.ts`** (`test_server/games.json`) — one global manifest for
  every game, get→mutate→put, called from `publishGame.ts`. Two users publishing
  **different games on different projects** silently drop each other's entry.
- **`routes/api/fonts/{save,delete}`** — the fonts catalog (`_shared/fonts/fonts.json`
  when shared-scope) is explicitly RMW. Note its existing 409 id-collision guard
  ([[bug_font_maker_id_collision]]) is a *within-request* check that this race defeats.

**Fix taken — `If-Match` conditional write + bounded CAS retry, NOT a Postgres move.**
Unlike the rigger indexes (whose only readers were launcher-internal, so a table
erased the race cleanly), both of these blobs have readers/writers a table would
break, so the faithful minimal fix is the Phase 1 conditional-write floor applied at
Phase 0's site — the same call it made for `skeletons.json`:
- **`test_server/games.json`** is read directly from R2 by a SEPARATE service
  (`services/test-server/server.mjs`, its own origin, no DB) and written by the
  standalone no-DB ops script `scripts/publish-game-bundle.mjs`. A Postgres move would
  break both. `upsertTestServerGame` now reads with an etag, merges, and PUTs under
  `ifMatch` (or `ifNoneMatch: '*'` when absent), retrying on `ConflictError` so a
  concurrent merge re-reads the winner's entry first. The standalone script mirrors the
  identical conditional-retry loop against its own S3 client. A present-but-corrupt
  manifest is overwritten deliberately via `ifMatch`, not wedged behind a create
  precondition (the create-path lesson from Phase 1).
- **The fonts catalog** is read on the export→deploy asset-shipping path
  (`fontExport.ts`), by `resolveEditorFonts`, `runtimeBundle.ts`, and the
  `r2-sync-fonts.mjs` script — moving it to Postgres carries asset-shipping blast
  radius for a race the conditional write closes directly (the same reasoning the doc
  used to KEEP `skeletons.json` in R2). `save` and `delete` now read the catalog with
  its etag, mutate, and PUT under `ifMatch`/`ifNoneMatch` with a bounded retry; the
  within-request id-collision 409 guard now re-runs against a FRESH read on every
  retry, so a cross-user same-id race surfaces as the descriptive collision 409 (not a
  silent clobber), while a genuine lost CAS returns `{ error: 'conflict' }` (never
  `error()`). Per-project catalogs get the same guard for free; the shared-scope global
  key — the one no lease can cover — is the case that mattered.

No new tables or migration: both sites keep their R2 blob as the source of truth (a
cross-service reader / no-DB writer each), guarded rather than relocated.

### Phase 2a — Shared save-state rune helper (consolidation)
Closes Phase 1 residual #4. Eight pages hand-roll etag/dirty/conflict/autosave (five
different `dirty` implementations; `postAction` duplicated verbatim between editor and
localization). That is eight chances to forget the ETag and the reason Phase 2c's
read-only mode / takeover banner would otherwise be an eight-place change. This phase is a
**behavior-preserving** consolidation onto one module — no lease, no read-only, no
presence (those are 2c). The must-not-regress bar: every tool saves, creates, autosaves at
the same cadence, conflicts, and force-overwrites EXACTLY as today.

> **SHIPPED 2026-08-04 (API-approved, full migration landed).** `$lib/saveState.svelte.ts`
> (the rune state machine) + `$lib/SaveStatusBadge.svelte` (the shared pill) are built and
> CONSUMED by every authoring surface — no tool hand-rolls save/dirty/etag/conflict any more.
> Verified offline over the REAL compiled module (**36 assertions**: state machine, ETag
> re-adoption, no-re-arm-on-conflict/scope, force, scope-mismatch terminality, both debounce
> semantics, `canAutosave` veto, create-path, coalescing, AND the during-flight-edit invariant
> — dropped in leading mode / preserved in trailing mode). Launcher build green.
>
> **A helper bug the migration caught + fixed:** the first cut cancelled the autosave timer on
> every success, which matched the editor's `$effect`-on-`dirty` cleanup but would have DROPPED
> flow-v2's mid-flight edit (whose fresh trailing-debounce timer must survive the in-flight
> success). Fix: cancel-on-success only in LEADING mode (`!resetDebounceOnEveryEdit`); fixture
> tests 12/13 lock both directions.
>
> **Instances wired (11 across 9 pages):** editor doc (leading 1200) + editor template
> (manual, global key); flow-v2 doc (trailing 800) + flow-v2 library (trailing 800, global
> key) — both via `<SaveStatusBadge>`; symbols, fx, flipbook, win-text, game-config,
> localization, components — manual. The badge renders flow-v2's two pills; the editor keeps a
> BESPOKE pill (span+Retry error, relative-time saved, interleaved crossType/preview) driven
> off `saveState`; the banner/`confirm()` tools keep their bespoke conflict UX off
> `state.status`/`state.message`. Per-tool live two-profile test is still owner-owed.
>
> **Flagged pre-existing latent bug (NOT touched — preserved verbatim):** symbols, fx and
> localization bind `onclick={save}` (bare handler), which passes the click EVENT as the
> `force` arg — so their manual Save has always been a FORCE overwrite, making their conflict
> `confirm()` dead on the button path. Preserved with a code comment at each site; the owner
> decides whether to fix (switch to `onclick={() => save()}`) separately.

**The recorded API (`$lib/saveState.svelte.ts` — MUST be `.svelte.ts`,
[[gotcha_runes_in_plain_ts]]):**

```ts
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'scope-mismatch';
type SaveOutcome =
	| { ok: true; etag: string | null }
	| { ok: false; reason: 'conflict' | 'scope-mismatch' | 'error'; message?: string };
interface SaveContext { baseEtag: string | null; force: boolean }
interface SaveStateOptions {
	save: (ctx: SaveContext) => Promise<SaveOutcome>; // caller owns the request + wire encoding
	initialEtag?: string | null;                      // page-load ETag; null = create path
	autosaveMs?: number;                              // omit/0 = manual (no debounce)
	resetDebounceOnEveryEdit?: boolean;               // true=flow trailing, false=editor leading
	canAutosave?: () => boolean;                      // extra arm gate (editor crossType)
	conflictMessage?: string;
}
class SaveState {
	get status; get busy; get dirty; get message; get etag; get blocked;
	adoptEtag(etag): void;   // Save-as create path (fx/flipbook repoint to null, restore on decline)
	setDirty(bool): void;    // for $derived-signature dirty (symbols/win-text/components)
	clearError(): void;      // editor: a fresh edit dismisses a stale 'error' (never a conflict)
	markDirty(): void;       // flag dirty + (re)arm debounce per the two semantics
	rearmAutosave(): void;   // imperative re-arm (editor undo/redo, ex-restartAutosave)
	cancelAutosave(): void;
	save({ force }?): Promise<boolean>; // TRUE only when the doc reached the store
}
```

Design decisions worth keeping:
- **The helper owns state + policy; the caller owns the transport.** The injected `save`
  callback makes a `fetch` and a SvelteKit form action fit one shape — the helper never
  touches the wire, so the JSON-`null`-vs-form-`''` create encoding stays caller-side.
- **The held ETag is the single source of truth**, re-adopted from every success. `docEtag`
  in every tool collapses into `state.etag`; `adoptEtag(null)` is the fx/flipbook "Save-as"
  repoint.
- **Two debounce semantics, faithfully.** Discovered during the audit: the editor's
  `$effect`-on-`dirty` arms only on the clean→dirty edge (fires ~1200 ms after the FIRST
  edit since the last save — a *leading batch*), while flow-v2's `markDirty` clears+sets
  every call (fires ~800 ms after the LAST edit — a *trailing debounce*).
  `resetDebounceOnEveryEdit` reproduces both; do NOT "unify" them.
- **`conflict`/`scope-mismatch` are sticky and never re-arm**; `scope-mismatch` is terminal
  (never forceable). `save()` coalesces an in-flight request and re-fires on settle only
  while still dirty — byte-for-byte the tools' `pendingSave` idiom.
- **No visual imposed.** The state is read by the caller; **`$lib/SaveStatusBadge.svelte`**
  renders the common saving/saved/dirty/error/conflict/scope-mismatch pill for the two
  pill consumers (editor, flow-v2 doc + library), parameterized where their pills have
  DRIFTED (`okAccent`: flow "Saved" is green, editor grey; `actionClass`: editor's purple
  `.save-btn` vs flow's grey pill). Banner/`confirm()` tools (win-text, config,
  localization, symbols, fx, flipbook, components) keep their bespoke conflict UX and drive
  it off `state.status`/`state.message` — the badge is not forced on them.

### Phase 2 — Soft lease + presence
What makes the tools usable for 2–3 people on a project.

> **Sub-phase 2b (BACKEND) — SHIPPED 2026-08-04.** The Postgres half is live and
> zero-regression (nothing calls it yet). `doc_leases` table (migration
> `0014_clammy_angel.sql`), composite-PK key tuple = the uniqueness constraint +
> `ON CONFLICT` target. `$lib/server/lease.ts` exposes `acquire`/`heartbeat`/
> `release`/`takeover` (+ pure `isTakeable`/`isSameHolder`, `LEASE_HEARTBEAT_MS`
> 10s / `LEASE_TTL_MS` 45s); `acquire` is the single conditional upsert so the DB
> adjudicates. Endpoint `POST /api/lease` (action discriminator), session-auth'd;
> not-held is `200 {held:false}` via `json()`. **Granularity decision made:
> per-project for now** (`docKey` = the tool's single project doc / its tool id).
> Verified offline over the real module against an in-memory conditional-upsert
> fake (27 assertions). Migration NOT applied; the SQL predicate + two-user test
> are owner-verify owed.
>
> **Sub-phase 2c-core — BUILT 2026-08-04 (editor + flow-v2 only; 2c-rest pending).**
> The CLIENT lease integration + presence UI, wired into TWO tools to prove the
> pattern. Files:
> - **`$lib/leaseState.svelte.ts`** (`LeaseState` rune) — owns the client lifecycle
>   against `POST /api/lease`. Ctor `{ toolId, clientKey, projectKey, docKey, enabled }`
>   (+ injectable `fetch`/`endpoint` for tests). `start()` acquires; on `held:true`
>   it heartbeats on the acquire-provided `heartbeatMs` (~10s); a heartbeat returning
>   `held:false` (taken over) flips read-only and STOPS beating. `takeover()` is always
>   available; `release()` is best-effort on unload (`sendBeacon`, else `keepalive`
>   fetch). Exposes reactive `held`, `readOnly`, `heldBy` (`{name,email,mine,activeAgoMs}`,
>   preferring the server `activeAgoMs`). **`enabled:false` no-ops entirely**;
>   **`readOnly` fails OPEN** before the first acquire and on any error (`readOnly` =
>   `enabled && resolved && heldBy!==null`), so a blip can never wedge a doc — the CAS
>   floor guards writes in those windows.
> - **`$lib/PresenceBanner.svelte`** — shown when `readOnly`: names the holder (or "You
>   have this open in another tab" when `heldBy.mine`), "active N ago", + always-enabled
>   **Take over**.
> - **`SaveState.blockWhen?: () => boolean`** — when true, BOTH autosave arming AND
>   `save()` are no-ops (`save()` returns `false`). Absent/false ⇒ zero behavior change.
>   A tool wires `blockWhen: () => lease.readOnly` into its DOC saveState only.
> - **Wiring:** editor doc saveState + flow-v2 doc saveState get `blockWhen`; both render
>   `<PresenceBanner>` in the tool chrome (replacing the save pill when read-only); both
>   `start()` on mount, `release()` on destroy/`pagehide`. The editor TEMPLATE saveState
>   and the flow-v2 LIBRARY saveState are left UNLEASED — GLOBAL `_shared/*` keys a
>   per-project lease can't cover (their `If-Match` CAS is the floor).
> - **Verified offline (39 assertions)** over the REAL compiled `.svelte.ts` modules
>   (esbuild type-strip → `compileModule` → mock `fetch`): acquire held/not-held,
>   disabled no-op, acquire-error fail-open, heartbeat→taken-over flips readOnly + stops
>   beating, takeover→held, release posts (and skips when not-held), and `blockWhen`
>   blocking both autosave + manual save (and unchanged when false). Launcher build green.
>   **Owner-verify owed:** the live two-profile test (below) + migration 0014.
>
> **Sub-phase 2c-rest batch A — BUILT 2026-08-04 (symbols, win-text, config,
> localization).** The four WHOLE-PROJECT-DOC authoring tools, wired MECHANICALLY to
> the 2c-core template (editor/flow-v2): each declares one `LeaseState`
> `{ toolId, clientKey, projectKey, docKey: toolId, enabled: projectKey.length > 0 }`
> before its doc `saveState`, adds `blockWhen: () => lease.readOnly` to that ONE doc
> saveState, renders `<PresenceBanner {lease} />` in the read-only branch of its
> `ToolTopBar` `meta` snippet (replacing the save pill) + disables Save when
> `lease.readOnly`, and `start()`s on mount / `release()`s on `pagehide` + teardown.
> Tool ids: `symbols`, `winText`, `gameConfig`, `localization`. `docKey === toolId`
> (one lease per project doc). localization saves via a SvelteKit FORM action — the
> `blockWhen` gate sits on `saveState.save()`, so the transport is untouched; its
> `+page.server.ts` load now also returns `clientKey` (it previously didn't) so the
> page can key the lease. No global `_shared/*` key was leased (none of the four has a
> second global-key saveState). Launcher build green. **Owner-verify owed:** the live
> two-profile test.
>
> **Sub-phase 2c-rest batch B — BUILT 2026-08-04 (fx, flipbook, components).** The three
> per-ITEM authoring tools. Unlike the whole-project-doc tools, each edits ONE item at a
> time and each item (effect / clip / component) is its OWN R2 object, so the lease `docKey`
> is the OPEN item's id and switching items re-keys the lease. `LeaseState` gained
> **`switchDoc(docKey: string | null)`** (additive; the fixed-docKey tools never call it and
> are byte-unchanged): it releases the current lease (against the OLD key — release before
> re-key), resets `resolved`/`held`/`heldBy` so the new item starts clean, then acquires the
> new key — or, for `null`/empty, goes INERT (`readOnly` false, no fetch) so a brand-new
> unsaved item is freely editable. `docKey` is now held in a private mutable `#docKey`; the
> observer-poll + fail-open + always-takeover invariants are intact.
> - **fx / flipbook** navigate (full reload) to open/new, so the only in-page item changes
>   are: first-save of a new/untitled item (→ `switchDoc(persistedId)` in the save transport,
>   guarded by a `leasedId` mirror so a re-save of the same item is a no-op), Save-As (its
>   copy's first save re-keys the same way; a declined overwrite restores the original id),
>   and deleting the open item (→ `switchDoc(null)`). The untitled sentinel
>   (`UNTITLED_EFFECT_ID` / `UNTITLED_CLIP_ID`) maps to `null` (nothing to lease). Save /
>   Save-As / Delete (+ flipbook's plist import) are disabled when `readOnly`; the doc
>   `saveState` carries `blockWhen: () => lease.readOnly`; `<PresenceBanner>` sits in the
>   subbar / meta.
> - **components** re-keys in `openComponent` (right beside the existing `adoptEtag`): a stored
>   def leases `def.id`; a never-saved draft (created via `createComponent`, not yet in
>   `components`) is `null` until its first save re-keys onto `saved.id` (in the transport's
>   `i === -1` branch). `closeComponent` (and delete-of-open, which calls it) → `switchDoc(null)`.
>   The bespoke conflict UX (versioned `confirm()`) is untouched — the lease only gates the
>   draft `saveState` (`blockWhen`) + disables "Save component" + shows the banner.
>   **Promote-to-shared is NOT leased** — it writes a global `_shared/editor-components/<id>`
>   key no per-project lease can cover, so its `If-Match` is the floor (as flow-v2's library
>   was left). Version inspect / back-to-latest keep the same item, so no re-key.
> - Each `onMount` does the initial `switchDoc` (inert when no item open) + `pagehide`/teardown
>   `release()`. **rigger stays out** (it leases via Phase 0's tables, separate work).
> - **Verified offline (37 assertions)** over the REAL compiled `leaseState.svelte.ts`
>   (esbuild strip → `compileModule` → mock fetch): `switchDoc(newId)` releases-old-then-acquires-new,
>   `switchDoc(null)` inert-from-fresh (no fetch) + release-only-when-held, not-held→held switch,
>   fixed-docKey lease unchanged (acquire/takeover/release all target its key), disabled no-op.
>   Launcher build green. **Owner-verify owed:** the live two-profile + item-switch test.
>
> Original plan (2c is the residual):

- Postgres table keyed `(toolId, clientKey, projectKey, docKey)`, holding
  `holderUserId`, `holderSessionId`, `acquiredAt`, `heartbeatAt`, `expiresAt`.
  Unique on the key tuple; acquire is a conditional upsert (expired lease is
  takeable) so the DB adjudicates, not the app.
- Endpoints: `acquire` / `heartbeat` / `release` / `takeover`. Heartbeat ~10 s,
  expiry ~45 s. `release` on page unload (best-effort; expiry is the real
  backstop).
- Shared client helper + a read-only banner: "X is editing this — active 3 s ago"
  + **Take over**. Takeover is explicit and always available — a lease must never
  be able to permanently wedge a doc (a crashed tab must not lock a project until
  someone SSHes into a database).
- Per-tool read-only mode: suppress autosave, disable mutation affordances.
- **Run the `reuse-check` skill before building the banner** — check
  `docs/ui-inventory.md` for an existing surface rather than inventing one.

### Phase 3 — Python tools (Atlas / Sheet)
**Blocked on a prerequisite, sequence last.** Per
[atlas-per-user-session](atlas-per-user-session.md)`:34-39`, those services
"literally cannot tell two users apart" — the launcher `session` cookie is
httpOnly and scoped to the launcher origin, so identity never crosses to their
separate Railway origins. They cannot hold a lease until that doc's **Phase 1
(thread a stable `user` id launcher → tools)** lands. Do not duplicate that work
here.

- Once `user` is available: acquire/heartbeat the same lease from the Python side.
- Add `IfMatch` to `iw_common/storage.py:59` `put` (boto3 `put_object` takes the
  same precondition) and give the staging mirror a precondition instead of a blind
  overwrite — which also blunts the startup-hydration staleness in §3.

### Phase 4 — Verify + document
- Two-user test per tool (two browser profiles, same project): A and B both open
  → B is read-only with A named; A goes idle 45 s → B can take over; A's stale tab
  then saves → **409, and A's work is not silently destroyed**.
- Cross-project test for Phase 0: A saves a rig in project X while B saves a rig
  in project Y → **both rows survive** (this is the bug that has no lease).
- Forced-conflict test: bypass the lease (curl a stale ETag) → 409, not a clobber.
- Update `docs/status/<tool>.md` for each tool touched; log to `docs/history.md`.

## Touch list
- `apps/launcher-api/src/lib/server/r2.ts` — `ifMatch` on both writers, ETag-carrying
  read, `isConflict` next to `isNotFound`
- `apps/launcher-api/src/lib/server/db/schema.ts` + a migration — lease table,
  `sharedRig` / `sharedAnimation` tables
- `apps/launcher-api/src/lib/server/` — `editorStorage.ts`, `flowV2Storage.ts`,
  `fxStorage.ts`, `symbolsStorage.ts`, `componentStorage.ts`, `localization.ts`,
  `flowV2LibraryStorage.ts`, `componentDefaultsStorage.ts`
- `apps/launcher-api/src/routes/api/rigger/{rigs,animations}/{save,delete,list}/+server.ts`
  — the inline `putObjectText` RMW callers; route them through a storage module
- `apps/launcher-api/src/routes/(app)/{editor,flow-v2,rigger,fx,symbols,components,localization}/`
  — ETag threading, read-only mode, banner
- `apps/launcher-api/src/lib/server/lease.ts` (new) + `src/routes/api/lease/*`
- `services/_shared/iw_common/storage.py` — `IfMatch` on `put`
- `docs/STATUS.md`, `docs/status/*.md`, `docs/design/atlas-per-user-session.md`,
  `docs/design/invisible-rigger.md`

## Risk / sequencing

Phase 0 is independent of everything else and fixes the worst bug — do it first
and ship it alone. Phase 1 is broad but shallow (one module, then mechanical
helper-by-helper). Phase 2 carries the most product weight: the failure mode to
design against is a lease that wedges a doc, so **takeover must always be
reachable from the UI**. Phase 3 cannot start until the Atlas identity phase
lands. Nothing here blocks the CRDT question, which stays open.

## Open questions
- ~~Do the R2 `_shared/*/index.json` blobs have any reader outside the launcher?~~
  **RESOLVED 2026-07-16: no.** Delete them, don't mirror. See Phase 0.
- Lease granularity: per-doc (`docKey`) or per-project? Per-doc is proposed —
  two people on different scenes of one project shouldn't block each other — but
  it only pays off once the Editor's whole-doc blob goes granular, since today a
  scene save rewrites the entire project doc anyway. Per-project may be the honest
  Phase 2 choice, with per-doc arriving alongside granular saves.
- Should Components' `version` become a real CAS token (reusing the ETag) or be
  retired in favour of the ETag alone?

## History
- 2026-07-16 — Owner: **lease now, CRDT later**; 2–3 users per project, many more
  across different projects concurrently. That second fact is what promotes the
  global-index race (§2) above the reported autosave symptom (§1).
- Supersedes the "accepted residual" in [atlas-per-user-session](atlas-per-user-session.md)`:12-17`
  (2026-06-06), which accepted same-file overwrites and named "shared assets +
  edit-lock" as the upgrade path if it ever bit. It bit.
- Resolves the open question at [invisible-rigger](invisible-rigger.md)`:227-228`
  ("last-write-wins + lock flag in the sidecar, or something with optimistic
  concurrency") — **both**: lease for coordination, `If-Match` for correctness.
  The lock flag does **not** live in the `.irig` sidecar; a lease in Postgres
  cannot be clobbered by the very race it exists to prevent.

> Build status: see [docs/status/launcher.md](../status/launcher.md); per-tool progress in each
> `docs/status/<tool>.md`; detailed log in [docs/history.md](../history.md).
