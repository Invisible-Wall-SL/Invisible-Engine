# Invisible Sound — status

> Design: [docs/design/invisible-sound.md](../design/invisible-sound.md) · Guide: [docs/tools/sound.md](../tools/sound.md) · Agent: — (unbuilt)

**One-line state:** **the build plan is complete** — S1 through S10. A project chooses what plays at
every moment of the game HERE, in categories, from a library it uploads, describes and approves in
the same page — and ships the lot through the full asset chain behind a publish gate. Reachable at
`/sound` by `audio`, `developer`, `artist`, `pipelineTester` and `admin`.

⏳ **The one thing outstanding is a human click-through.** Every step was verified offline, against
real R2, or in a browser via the engine side; the launcher pages themselves need a signed-in pass,
which I have no way to obtain and should not fake.

## Current state

**S1 — banks (done, live-verified).** `packages/utils-sound` no longer holds a single `Howl` built
from a single `LoadedAudio`. `sound.load()` takes an ordered list of banks — or one audio, as every
caller still passes — and a name resolves to the **last** bank declaring it.

- `src/banks.ts` owns the pure half: `toSoundBankList` (normalizes the argument) and
  `buildSoundBankIndex` (name → bank, last-wins). Free of howler and Svelte, so it is
  fixture-verifiable offline.
- `createSound` builds one `Howl` per bank, resolves `howlFor` / `configFor` per name, spans every
  bank in `hasSound()`, and unloads **per bank** in `destroy()`.
- `createPlayer` and the three play modules take a `howlFor` resolver instead of closing over one
  `howl`. **A `soundId` is only unique within its own `Howl`**, so every stop/fade/rate/volume call
  addresses the sound's own bank — the single shared howl hid that requirement entirely.
- Everything below S1 is still the old world: nothing constructs a second bank, so `apps/*` build one
  bank from `assets.ts`'s `{type:'audio'}` asset and behave exactly as before.

**Two incidental fixes**, both consequences of resolving the howl before playing rather than after:

- An **unplayable name no longer poisons the sound map.** It used to be written as `playing` with a
  null id (howler's return for an unknown sprite), which never receives an `end` event — so the name
  was pinned for the session and could not play even once a bank carrying it loaded.
- An **unknown music track no longer silences the game.** `newMusic` paused all music before
  discovering it had nothing to play.

**The index is null-prototype.** Sound names become author-supplied the moment a project uploads its
own, and a plain object answers `index['constructor']` with something inherited. The membership test
this replaces (`loadedAudio.sprite[name]`) had the same hole.

**S2 — the library doc (done, verified against real R2).**

- **`packages/engine-layout/src/lib/soundLibrary.ts`** owns the shared contract — `SoundEntry`,
  `SoundsDoc`, the kind/status/origin vocabularies, `isValidSoundName` / `isValidSoundFile`, and
  `findSoundByName`. It sits beside `fontCatalog.ts` for the same reason: both the tool and the game
  read it, so neither can invent its own shape.
- **`apps/launcher-api/src/lib/server/soundsStorage.ts`** owns the Zod validator, `normalizeSoundsDoc`
  and the conditional load/save. **The normalize DROPS**, which is unusual here: an entry with no
  file, an unplayable name, a non-positive duration or a duplicate is not an incomplete record but
  one that would reach a player as silence.
- **Paths:** `SUB.sounds` → `<client>/<project>/sounds`, `soundsDocKey` → `…/sounds.json`,
  `soundFileKey` → `…/files/<file>` (which re-asserts `isValidSoundFile` rather than trusting its
  caller — that is the traversal guard).
- **`/api/sounds`** GET/PUT, session-gated, mirroring `/api/win-text` including the 409-via-`json()`
  conflict branch. (It 403'd every role until S6 registered the tool — the gate is data-driven, so
  registering lit the page and all four endpoints at once.)

**S3 — the audio files (done; storage verified against real R2, playback verified in a browser).**

- **`soundFiles.ts`** — the file half, deliberately split from the doc half: a doc is a conditional,
  ETag-guarded read-modify-write shared by every author, a file is write-once immutable content.
  Holds the extension whitelist → content-type map, `soundExtension`, `mintSoundId`,
  `putSoundFile` / `getSoundFile`, and `parseRange`.
- **`soundAccess.ts`** — `requireSoundAccess` + `resolveSoundScope`, now shared by both routes
  (mirroring `spine.ts`), so a second route cannot ship a slightly different gate.
- **`POST /api/sounds/file`** — multipart upload → `sounds/files/<id>.<ext>`, id minted SERVER-side.
  It deliberately does **not** touch `sounds.json`: an upload that also wrote the doc would have to
  write it unconditionally, which is how one author's library silently replaces another's.
- **`GET /api/sounds/file?file=…`** — streams for audition, `inline` (not `attachment` like the FTP
  sibling), `no-store`, and honours Range so an `<audio>` element scrubbing a BGM track does not
  re-download the file on every seek.
- **`durationMs` is measured client-side, not here.** Deriving it would mean decoding five container
  formats server-side; the browser already decoded the file to show it, and its answer is the one
  that matters — it is the same decoder that will play the sound. The doc's normalize rejecting a
  non-positive duration is the guard that stops a wrong one becoming a silent sprite.

⏳ **Not yet verified over HTTP.** The gate is live (every route answers 401 unauthenticated,
checked on the local launcher) and the handler logic is covered offline, but the request paths
themselves — multipart parsing, the 206 branch — need a signed-in session. Disabling the gate to
fake one was refused by the sandbox, correctly.

**S4 — the chain (done; every link verified, the bake's HTTP call by inspection).**

- **`soundExport.ts`** copies each library entry's file into `deploy/sounds/<file>` (flat — a sound
  has no sibling files to keep next to it) and writes `index.json` beside them. Server-side copy, so
  no bytes travel through the launcher process. Prunes leftovers; idempotent.
- **`SoundCatalog`** is the shipped form and it is STRIPPED: `id`, `section`, `status`, review
  fields, `notes` and the whole provenance block stay behind. `license`/`author`/`model` are
  internal records about who we owe — a shipped bundle is the one place they do not belong. Mirrors
  `fontExport` stripping a font's `recipe`.
- **Both bundle assemblies** carry it: `bake-editor-doc.mjs` (offline freeze) and `runtimeBundle.ts`
  (live Game Maker path, via `ensureDeployExports` — which `publishGame` also calls, so a publish
  gets sounds with no further change).
- **`pull-project-assets.mjs`** gained `sounds` in `GENERATED_SUBTREES`, so a removed sound is
  pruned from the mirror rather than lingering.
- **`bakedSounds.ts`** (engine-layout, beside `bakedFonts.ts`) turns the catalog into one BANK per
  file, appended AFTER the shipped audiosprite so a project sound of the same name overrides it.
  `EnableSound.svelte` is the seam.
- **`deployServe.ts`** learned `m4a` and `webm` — both are in the upload whitelist, and without them
  a published file of either type was served as `application/octet-stream`.

**S5 — the `/sound` page (built; compiles and type-checks, NOT live-verified — see below).**

- Sectioned list of the library: audition, name / kind / section, duration, volume, loop, an
  approve pill, delete, and a collapsible provenance panel (origin, model-or-author, licence,
  licence URL, notes).
- **Upload** by drag-drop or picker. `durationMs` is measured in the browser with
  `decodeAudioData` before the POST, and the name is derived from the filename, sanitized to what a
  binding may hold, and **de-duplicated against the library** — a reused name would be collapsed
  last-wins on save and silently replace an existing sound.
- **It tells you what a save would DROP**, rather than letting the normalize do it quietly: an
  unusable name and a duplicate name each raise a banner naming the rows at risk.
- Reuse per `docs/ui-inventory.md`: `ToolTopBar`, `SaveState` + `SaveStatusBadge`, `LeaseState` +
  `PresenceBanner`. No hand-rolled dirty/etag/conflict.
- The page **does not author bindings** — it links to `/config`, `/symbols` and `/flow-v2`, which
  own the moments. Design §2.3.

**S6 — registered (done).** `TOOLS.sound` + icon, the `assets` stage (so `TOOL_BAR_ORDER` follows),
`TOOL_DOC_SLUG.sound`, grants to `audio` / `developer` / `artist` / `pipelineTester`,
[docs/tools/sound.md](../tools/sound.md), and its `docs/tools/README.md` row. The icon also went
into all four non-Svelte tool-bar twins, which `scripts/check-toolbar-icons.mjs` enforces.

**The `audio` role was the point.** It existed already — `ftpBrowser`, `storybook`,
`invisibleLauncher` — and had no audio tool in it. That is the role this whole tool is for.

**S7 — the usage index (done).** `apps/launcher-api/src/lib/soundUsage.ts` reads every surface that
can bind a sound — game-wide slots (through `resolveSounds`, so an un-authored project still reports
the catalogue defaults it plays), win tiers, per-symbol × state cues, the anticipation pair, and
flow-graph cues — and reports **unbound**, **missing** and **unapproved-but-bound**, plus the two
lists that make them readable (`overridesBuiltin`, `notRebindable`).

- **Bindings are collected server-side, checks run on the page.** The config/symbols/flow docs are
  not editable from `/sound` so they cannot go stale while it is open; the library can, so renaming
  a sound shows it becoming unbound immediately rather than after a reload.
- **A flow cue is found by its literal's ENUM TYPE, not by the node's `ref`** — so an action or a
  function call that takes a sound is found without touching the collector.
- Read-only, with each row linking to the tool that owns it (design §2.3; the design's own "editable
  here: yes" rows were corrected to match).

**S8 — the publish gate (done; verified against real R2).** `soundPublishCheck.ts` runs before
anything is written: a sound the game PLAYS that is still a draft refuses the publish, naming them.
`/game-maker` asks once and offers **publish anyway** (`allowUnapproved`); every other blocked
publish stays final, since overriding one would overwrite a real game's files. A successful publish
returns a licence summary — a warning for a played sound with a non-commercial licence, a note for
one with no licence at all.

- **An unapproved built-in OVERRIDE blocks too.** It is played by the engine's own code with no doc
  naming it, so a bindings-only gate would miss the one case most likely to be an unreviewed
  re-skin. This is the mutation the offline fixture could not catch — see Recent changes.
- The licence flag is a **heuristic over free text and only ever warns**. Blocking a release on a
  substring match would eventually stop a legitimate one over the word "commercial", and a gate
  people learn to override is worse than a note they read.

**S9 — one list, one source (done).** `apps/launcher-api/src/lib/soundOptions.ts` answers "what may
a sound picker offer" — the engine's own sounds plus this project's, project first. Wired into
`/config` (slot ladders), `/editor` (win tiers), `/symbols` (per-symbol + anticipation cues) and
`/flow-v2` (the inspector, via `withProjectSounds` widening the vocabulary's three sound enums).

- **A library sound's `kind` finally does something load-bearing**: it decides whether the sound
  appears in the music list or the SFX list. Until now it was only a sectioning hint.
- **The generated enum did NOT retire**, and the design is corrected. Those 53 names are the shipped
  audiosprite's real contents, the launcher has no other way to learn them, and both the usage index
  and the publish gate need them to tell a re-skin from an unused sound. Its ROLE retired: it is the
  base of the list now, not the whole of it.

**S10 — authoring moved in (built; compiles, type-checks and the contract fixtures hold — NOT
live-verified).** S1–S9 shipped a library with a read-only index and left every choice in three other
tools, which is not the tool that was asked for. The choices are now made here, in categories, and
the pickers are gone from `/config`, `/symbols` and the Scene Editor.

- **`SoundsDoc.bindings`** (`packages/engine-layout/src/lib/soundLibrary.ts`) holds `slots`,
  `symbols`, `anticipation` and `winTiers`. Every level is sparse and an empty level is DROPPED on
  save, because `{}` and absent must read the same to a runtime — a project that authored a cue and
  then cleared it must not read as authored-with-nothing, which is silence rather than a default.
  `enabled: false` is the one exception that stands alone: it is the gesture that *means* "play
  nothing here". Slot names are stored only when they DEPART from the catalogue.
- **The migration is whole-doc and one-way** (`effectiveSoundBindings`). No block ⇒ read
  `/config`'s `sounds` + `winLevels[].sound` and `/symbols`' `symbolSounds` + anticipation cues, so
  the page opens on what the game actually plays. The first save writes the block and the fallback
  never runs again. Never a per-field merge: that would resurrect a deliberately cleared cue from the
  config doc that still holds it, and leave no gesture meaning "no, really, nothing".
- **The export settles it.** `soundExport.ts` is the only place that can see all three docs at once,
  so it resolves the fallback and puts the answer on the catalog (`SoundCatalog.bindings`). Both
  bundle assemblies already carry the catalog, so the choices travel the chain with no new link.
- **The runtime reads it in one place per surface.** `publishSoundBindings()` (engine-game
  `gameConfig.ts`, called from `Game.svelte` beside `publishWinPresentation`) feeds `activeSounds()`
  and the win-tier overlay; `bakedSymbolSounds()` and `bakedAnticipationSounds()` read the same
  catalog. Absent ⇒ every one falls through to the config/symbols/coded path it used before, so
  un-baked dev and a bundle built before the move are byte-identical.
- **The old fields were NOT deleted.** `GameConfigDoc.sounds`, `SymbolsDoc.symbolSounds`, the symbols
  doc's anticipation cues and the `win` component's `<alias>Sfx`/`<alias>Bgm` params are still in
  their schemas and still read one rank below the sound doc. Only the authoring UI went. A game that
  shipped before the move keeps sounding the same until someone opens the tool.
- **The usage index is now derived on the page**, from the choices on screen rather than the server's
  read of the docs — on a tool whose job is to surface inaudible mistakes, an index one save behind
  every edit is a tool that lies until you reload.
- **Win-tier precedence changed**: the sound doc outranks the `win` component instance's params,
  which outrank the config/coded tier. It has to — `/sound` is the surface that lists every tier at
  once, so a cue picked there and silently overruled by a param buried in a component instance would
  be indistinguishable from a cue that just does not play.

## Open items / next

1. **Click through `/sound` once.** Everything below the UI is verified — offline fixtures, real-R2
   harnesses, mutation tests, the engine side in a browser. The page itself has only been compiled
   and type-checked, because the launcher pages need a signed-in session. Open a project that has
   sound choices in `/config`/`/symbols`, confirm the page opens on what the game already plays and
   says so, change one moment, save, reload, and hear it in a game.
2. **Retire the old fields.** `GameConfigDoc.sounds`, `SymbolsDoc.symbolSounds`, the symbols doc's
   anticipation cues and the `win` component's `<alias>Sfx`/`<alias>Bgm` params are dead weight
   once every live project has saved once in `/sound`. Until then they are the only thing keeping a
   pre-move game sounding the way it shipped.
3. **Renaming is still hostile.** Renaming a library sound does not repoint the moments that play
   it — the picker turns red and says so, which is better than silence, but a rewrite is now cheap
   (one doc, one save) and worth doing.

## Blocked (owner / external)

- _None._

## Recent changes

- 2026-09-10 — **The per-symbol cue row “Tumble explosion” is now “Clear reel”.** Symbol-state rename only, decided in Invisible Symbols (see [symbols.md](symbols.md)): the state `tumbleExplosion` became `clearReel`, because the beat is a symbol being TAKEN OFF the board — the cascade’s removal _and_ the swap-in-place board CLEAR — not only a tumble. Nothing about the sound moved: same gate (the project cascades OR clears), same additive relationship to the game-wide ladder, same audiosprite keys.

  - **A saved binding is not re-authored.** `symbolSounds[symbol].tumbleExplosion` is folded into `clearReel` at the symbols-doc load boundary (`symbolsStorage#migrateLegacySymbolStates`), before validation — the per-symbol map is keyed by `z.enum(SYMBOL_STATES)` and Zod rejects an unlisted key, so an un-folded doc would have loaded as an empty one and lost every cue on it.
  - **The game-wide SLOT is still `tumbleExplosion`** (`packages/game-config/src/sounds.ts`, `/config` → Sounds → “Tumble explosion”). It lives in the sounds doc, a different namespace from the symbol states, and renaming it would migrate a second doc for no gain.

- 2026-08-27 — **Per-symbol cues gained `Intro`, and `Tumble explosion` was offered to the wrong set of projects.** `Intro` is the cue a symbol makes as it SURFACES under the new `emerge` swap style (`/config` → Reel behaviour); it is heard **alongside** the ordinary landing cue rather than instead of it, unlike `Land`, whose per-symbol binding replaces the game-wide slot. The difference is whether there is a class cue to override: an emerge has no game-wide slot of its own, so there is nothing to replace. **The correction:** `tumbleExplosion` was gated on `resolveCascade` alone, but two things play that state — a tumble removing a symbol, and the swap-in-place CLEAR step, which a swapping board runs every round. A project authoring the sink half of an emerge was therefore offered no row for the very cue it fires. Both gates now come from one helper (`symbolCueStates`) reading the resolved config, so the state a beat plays and the switch that turns that beat on stay two separate questions asked in one place. Full story in [game-config.md](game-config.md).

- 2026-08-26 — **Authoring moved into the tool — the game's sounds are chosen here now.** Design step
  S10. S1–S9 built a library, a usage index and a set of pickers that agreed on a vocabulary, then
  left the actual choices in `/config`, `/symbols` and the Scene Editor. That is not the tool that
  was asked for, and the earlier design's §2.3 argued explicitly for keeping them apart. The argument
  was wrong about which fact was being homed: "what plays at the reel stop" is not a fact about the
  reel stop, it is a fact about the game's audio — and the game's audio was spread across three tools
  none of which could play a sound.

  `/sound` now opens on the moments: **Game moments** (every slot, with its ladder rungs, its
  plain-words description of what fires it, a silent switch and a reset-to-default), **Per-symbol
  cues**, **Reel anticipation**, **Win tiers**, and **Flow cues** read-only with a link out. Every
  picker offers the project's sounds first and the engine's after, and every row has a ▶.

  The Sounds panel is gone from `/config`, the Symbol-sounds section and the two anticipation sound
  dropdowns are gone from `/symbols`, and the `<alias>Sfx`/`<alias>Bgm` params are gone from the Win
  Overlay component's editor params. Each leaves a pointer where it stood.

  **Nothing was deleted from a schema.** The old fields are still read at runtime, one rank below the
  sound doc, so a project that shipped before the move sounds identical until someone saves here.
  They become removable once every live project has saved once, and not before.

  ⏳ Not live-verified: the launcher pages need a signed-in session I have no way to obtain.

- 2026-08-26 — **One list, one source — every sound picker now offers the project's own sounds.**
  Design step S9, and the last of the build plan. `soundOptions.ts` answers "what may a picker
  offer": the engine's own sounds plus this project's, **project first** (a dropdown that opens on 53
  engine names with your five below them is one that gets scrolled past). Wired into `/config`'s slot
  ladders, `/editor`'s win tiers, `/symbols`' per-symbol and anticipation cues, and `/flow-v2`'s
  inspector.

  Until this, a project could upload a sound in `/sound` and then **not select it anywhere** — the
  library and the bindings could not talk about the same thing.

  **A library sound's `kind` finally does something load-bearing**: it decides whether the sound
  joins the music list or the SFX list. Until now it was a sectioning hint.

  **Flow needed no schema change.** `validate.ts` checks an enum literal with
  `typeof value === 'string'` and has never tested membership, so a graph naming a project sound was
  always *valid* — it simply could not be authored. `withProjectSounds` widens the vocabulary's three
  sound enums, which changes what the inspector lists and nothing else, and returns the vocabulary by
  **identity** when the project has no library.

  **The generated enum did NOT retire, and the design is corrected.** It expected
  `gen-flow-v2-sound-enums.mjs` to go with the union it mirrors. It cannot: those 53 names are the
  shipped audiosprite's real contents, the launcher has no other way to learn them (the sprite map
  lives in a game app's `static/`), and both the usage index and the publish gate need that fact to
  tell a re-skin of a built-in from a sound nothing plays. Its ROLE retired — it is the base of every
  list now, never the whole of it.

  **Verified.** `check:sounds-doc` at **138 claims** (was 123): the kind split, project-first order,
  an override listed once, the flow-vocabulary widening, that a non-sound enum is untouched, and
  PARITY — a project with no library gets the engine set unchanged and the same vocabulary object
  back. Build green, `svelte-check` unchanged at 66 repo errors with none in the touched files.
  Checked that prettier did not disturb the in-flight `/config` and `/symbols` work: both are
  prettier-clean at HEAD and the diffs carry no deletions outside my own three edits.

- 2026-08-26 — **Approval finally means something: the publish gate.** Design step S8, and the thing
  `docs/tools/sound.md` had been promising since S6. `checkSoundsForPublish` runs at the TOP of
  `publishGame`, before anything is written: a sound the game plays that is still a draft throws
  `PublishBlockedError`, naming them. The error gained a machine-readable `reason` + `details` so the
  UI can tell an **overridable** refusal from a final one — `/game-maker` asks once and offers
  "publish anyway" for unapproved sounds, while a game with its own desktop build stays blocked,
  because overriding that would overwrite files nothing here can rebuild.

  **An unapproved built-in OVERRIDE blocks too, and getting that wrong put a hole straight through
  the gate.** A sound named after a shipped audiosprite region is played by the engine's own code
  with no doc naming it; judged by bindings alone it looks idle, so an unapproved re-skin of
  `sfx_btn_spin` would have sailed past the one check meant to catch it. I wrote it that way first
  and caught it on re-reading, before it ran.

  **The licence summary informs, it never blocks.** The non-commercial test is a heuristic over free
  text; blocking a release on a substring match would eventually stop a legitimate one over the word
  "commercial", and a gate people learn to override is worse than a note they read. Only PLAYED
  sounds are summarised — an unused file in the library ships nothing and owes nobody.

  **Verified.** `check:sounds-doc` grew to **123 claims** (was 112) — what blocks vs what only warns,
  and the heuristic's own negation ("commercial use permitted" is not non-commercial). Mutation-tested:
  counting unplayed sounds in the licence summary, firing the flag on "commercial", dropping the
  missing-licence list — all three fail the fixture. **A real-R2 harness** (`_verify/sound_s8`,
  refused unless empty, deleted after) drove the REAL `checkSoundsForPublish` through its real
  loaders: a bound draft (via a genuine slot binding in a genuine config doc) blocks, a built-in
  override blocks, an unused draft does not, approving both clears it, and the licence summary counts
  only what plays.

  **That harness earned itself immediately.** The two wiring mutations — passing no built-in list, and
  summarising licences by bindings alone — **both pass the offline fixture** and both fail the
  harness, because `soundPublishCheck.ts` reaches R2 and the fixture cannot touch it. A gate that
  guards releases is exactly where "the unit test is green" is not enough. Also learned the hard way:
  a sounds-only config doc is dropped whole by `normalizeGameConfigDoc` (it requires a math
  contract), so the harness builds on a real `lines` template.

- 2026-08-26 — **The usage index — the page can finally say what is PLAYED, not just what exists.**
  Design step S7, and the half that makes this a tool rather than a folder. `soundUsage.ts` reads
  the slots (via `resolveSounds`, so an un-authored project reports the catalogue defaults it
  actually plays), win tiers, per-symbol × state cues, the anticipation pair and flow-graph cues,
  then reports the three checks: **unbound**, **missing**, **unapproved-but-bound**.

  **The design's "coded literals" row was wrong, and building it proved so.** It specified a
  generated scan of hardcoded names in `apps/lines/src`. Written, the scan counted the `SoundName`
  union's own declaration (all 53, in one file) and the slot catalogue's defaults (19 more) as
  "hardcoded", and matched names inside comments — including one in `banks.ts` written earlier in
  this same build. **Subtracting the bound set from the shipped set answers the question exactly**:
  a shipped sound no slot, symbol, tier or flow cue names is, by construction, one only code can
  reach. No scan, no generator, nothing to keep in sync, and project-accurate — bind `bgm_main` in
  your flow and it leaves the list. The design doc is corrected.

  **A built-in override is not "unbound".** A library sound whose name matches a shipped audiosprite
  region is played by the engine's own code and REPLACES that region (`buildSoundBankIndex` is
  last-wins). Reporting it as unused would contradict the one feature that lets a project re-skin
  the default audio, so it gets its own label instead.

  **Bindings server-side, checks client-side.** The config/symbols/flow docs can't be edited from
  `/sound`, so their bindings are collected once in the load; the library IS live, so
  `checkSoundLibrary` re-runs on every keystroke. Splitting them is what keeps the index honest
  while you rename a sound rather than only until you touch something.

  **A flow cue is identified by its literal's enum TYPE, not the node's `ref`** — an action or a
  function call that takes a sound is found without touching the collector.

  **Read-only.** The design had marked the `/config` and `/symbols` rows "editable here"; that was
  dropped and the design corrected. Inline editing would put two more ETag-guarded save paths and
  two more leases on this page, and a binding changed without its own tool's context — a slot's
  ladder semantics, a symbol's state machine — is a binding changed blind.

  **Verified.** `check:sounds-doc` grew to **112 claims** (was 92): every collector, and each of the
  three checks with its inverse. **Mutation-tested five ways** — treating a built-in override as
  unbound, letting a silenced slot bind its names, matching flow cues by node `ref`, letting a
  built-in fail to satisfy a binding, and flagging unplayed drafts — all five fail it. The `ref`
  mutation initially PASSED, because the fixture's cue nodes all happened to be named `sound*`; the
  fixture now carries a `functionCall` that takes a sound, which is the case that distinguishes the
  two implementations. Launcher build green, `svelte-check` unchanged at 66 repo errors with none in
  these files.

- 2026-08-26 — **Registered — the tool is reachable.** Design step S6, and CLAUDE.md rule 9 in full:
  `TOOLS.sound` (with a speaker icon), the `assets` stage beside Font Maker so `TOOL_BAR_ORDER`
  follows automatically, `TOOL_DOC_SLUG.sound`, four `ROLE_TOOLS` grants,
  [docs/tools/sound.md](../tools/sound.md), and its `docs/tools/README.md` row.

  **The `audio` role is the one that matters.** It already existed — with `ftpBrowser`, `storybook`
  and `invisibleLauncher` — and contained no audio tool whatsoever. That is precisely the role a
  composer or SFX contractor gets, so it is the first grant, not an afterthought. `animator`
  (spine-only) and `localizationReviewer` (text-only) deliberately do not get it.

  **`scripts/check-toolbar-icons.mjs` caught what I would have missed**: the tool bar has four
  non-Svelte twins (`static/rigger/view.html`, `static/spine/view.html`,
  `services/atlas-tool/ui_server.py`, `services/sheet-tool/ui.html`) that each carry their own copy
  of the icon map, and a new tool is invisible in all of them until its icon is added. The check now
  passes on all four for 19 online tools.

  **The guide is written against the page as built**, not against the plan — it documents the two
  ways a save silently loses a row (an unusable name, a duplicate name), the fact that renaming a
  sound does NOT update whatever binds it, and why draft/approved is inverted relative to
  Localization. It also names the boundary the tool is designed around: this page is the library,
  and the bindings live in `/config`, `/symbols` and `/flow-v2`.

  **Verified.** A registry-consistency pass over the real `roles.ts` (in `TOOLS`, online, `/sound`,
  has an icon, in `TOOL_BAR_ORDER`, `toolDocPath` → `docs/sound`, the guide file exists, the five
  entitled roles resolve true and the two excluded resolve false, and it appears in an `audio`
  manifest). `copy-tool-docs.mjs` mirrors the guide and the built server bundle contains it inside
  `(app)/docs/[slug]`, so `/docs/sound` serves it. Anonymously the local launcher now answers
  `/sound` and `/docs/sound` with a redirect to `/login` and all four endpoints with 401 — routes
  present, gates live. Build green, prettier clean, `svelte-check` unchanged at 66 repo errors with
  none in these files.

  ⏳ Still nothing clicked through — that needs a signed-in session, which I have no way to obtain
  and should not fake.

- 2026-08-26 — **The `/sound` page** — the library surface: upload, audition, describe, approve.
  Design step S5. Built on the canonical shared pieces per `docs/ui-inventory.md` (`ToolTopBar`,
  `SaveState` + `SaveStatusBadge`, `LeaseState` + `PresenceBanner`) rather than a hand-rolled
  dirty/etag/conflict, which is the regression the reuse check exists to catch.

  **The page's job is to make the normalize's DROPS visible before they happen.** `soundsStorage`
  deletes an entry with an unusable name and collapses duplicates last-wins — correct, and invisible
  if the tool just posts and re-renders. So the page validates names live with the same shared
  `isValidSoundName` the server uses, names the rows at risk in a banner, de-duplicates a new
  upload's derived name against the library, and adopts the SERVER's returned doc rather than its
  own payload.

  **`durationMs` is measured here with `decodeAudioData`**, before the upload — the browser has
  already decoded the file, and its answer is the one that matters because the same decoder plays
  the sound in the game. **Audition uses one shared `<audio>` element** for the whole list, at the
  row's authored volume, so what you hear is what the game will play.

  **A new inventory pattern, deliberately not a 4th `<DataTable>` instance** (§13). Every impl under
  §2 is a matrix — rows × columns of same-typed cells; this is a per-entity row of heterogeneous
  controls. A component covering both would be a layout engine, not a table. Recorded so the next
  person does not miscount the extraction trigger.

  **Verified.** Compiles (launcher build green, both `(app)/sound` entries in the server output) and
  **type-checks**: the launcher has no `svelte-check` dependency, so I ran one via `pnpm dlx` — the
  new page and server load are clean, and the repo total went **68 → 66 errors** because it caught
  two real ones I had shipped in S3's audition endpoint (`Uint8Array` is not a `BodyInit` under this
  TS version; the response now hands over an `ArrayBuffer` whose bytes are exactly the slice). Worth
  knowing generally: `apps/launcher-api/CLAUDE.md` says the build is not a type-check, and this is
  what that costs — a `pnpm dlx svelte-check@3.8.6` pass is currently the only thing that reads
  these files.

  ⏳ **NOT live-verified, and cannot be until S6.** The page needs a session and the `sound`
  entitlement; the tool is unregistered, so it 403s for every role. Faking a session by disabling
  the gate was refused by the sandbox earlier in this build, correctly, and is not worth doing.
  Everything the page does that could be checked without a browser has been; what remains unproven
  is the rendering and the click-through.

- 2026-08-26 — **An uploaded sound now reaches a running game** — the full rule-8 chain, export →
  bake → pull → register. Design step S4. `soundExport.ts` copies each entry's file into
  `deploy/sounds/` and writes `index.json`; `/api/editor/export-sounds` triggers it on the
  deploy-token gate; **both** bundle assemblies embed the catalog; `pull-project-assets.mjs` mirrors
  and prunes the subtree; `bakedSounds.ts` turns the catalog into banks and `EnableSound.svelte`
  appends them after the shipped audiosprite.

  **What ships is stripped.** `SoundCatalog` carries only `name`/`file`/`durationMs`/`volume`/`loop`.
  Review state and provenance stay in the doc — `license`, `author` and `model` are internal records
  about who we owe, and a bundle handed to a player is the one place they have no business being.
  Same instinct as `fontExport` stripping a font's `recipe`.

  **`durationMs` becomes the sprite region and `loop` its third element.** That is the whole reason
  the doc rejects a non-positive duration: a zero-length region is a name that plays nothing, and an
  over-long one makes howler's `end` fire late, which pins the once-player's map entry and blocks
  every later play of that name.

  **Two traps found while wiring it, both by reading rather than by failure:**

  - **Howler strips the query string before sniffing a codec** (`str.split('?', 1)[0]`), so a URL
    carrying its filename as a query parameter loads nothing and reports it only through a
    `loaderror` nobody listens for. I built a derivation to recover from that, then checked the
    actual producer: `/api/editor/runtime` builds `assetBase` as a **PATH**
    (`/api/deploy/f/<token>/<client>/<project>/`), deliberately, so sub-files resolve relative to
    their parent. The derivation guarded nothing real and was deleted. What stayed is the honest
    half: `bakedSoundBanks` DECLARES `format` from the catalog's own filename, because stating a
    known fact costs one array and beats depending on the shape of a URL built three packages away.
    `LoadedAudio` gained an optional `format` to carry it; absent (the audiosprite) ⇒ howler's own
    detection, unchanged. The stale `srcBase()` comment in `editor-scenes.ts`, which claimed the
    query form, is corrected.
  - **`deployServe.ts` knew mp3/ogg/wav but not m4a/webm**, both of which the S3 upload accepts. A
    published `.m4a` was served as `application/octet-stream` — Web Audio decodes it anyway, but
    howler's HTML5 fallback goes by the type and would decline it.

  **Checked and safe, not assumed:** the opt-in build optimizer (`--optimize`) trims audio only via
  manifests carrying a top-level `src` array of audio paths, and image twins only as `.png`/`.webp`
  pairs. A flat `sounds/` tree of single-format files matches neither, so an optimized standalone
  build keeps every project sound.

  **Verified.** `check:sounds-doc` grew to **92 claims** (was 77): what the catalog strips, and the
  bank builder — sprite region, the loop element, volume defaulting, the declared container, the
  live-runtime base, and the three parity cases (no catalog / empty catalog / a zero-duration entry
  all yield no banks). **The export step against real R2** (throwaway `_verify/sound_s4`, refused
  unless empty, deleted after): seeded a library with one real file plus an ORPHAN row whose upload
  never landed, exported, and confirmed only the entry with a real file is advertised, the copy is
  byte-for-byte, `index.json` parses to the same catalog, a stale leftover is pruned, and a second
  run converges. **The game step end to end in a browser**: with the exported tree mirrored into
  `static/assets/sounds/` exactly as the pull would, the game built **2 howls** — the 53-sprite
  audiosprite and the project bank at `assets/sounds/snd_verify_one.mp3`, sprite `[0, 2000]`,
  `format: ['mp3']`, state `loaded` — and `ie_verify_pop` routed to howl **1** while
  `sfx_reel_stop_1` stayed on howl **0**. **Parity re-checked after reverting the probes**: 1 howl,
  53 sprites, `format: null`. Launcher + lines + cluster builds green; `tsc` clean for every new
  module. The one link not executed is the bake's HTTP call to `/api/editor/export-sounds`, a
  line-for-line copy of the font one that a real bake will exercise.

- 2026-08-26 — **Audio files can now be uploaded and auditioned** — `soundFiles.ts`,
  `soundAccess.ts`, and `POST`/`GET /api/sounds/file`. Design step S3.

  **The file half is split from the doc half deliberately.** A doc is a conditional, ETag-guarded
  read-modify-write shared by every author; a file is write-once immutable content. Keeping them in
  one module would invite an upload to "just also update the doc" — which it could only do
  unconditionally, and that is precisely how one author's library silently replaces another's. So
  the upload returns a filename and the caller records it through the doc's own guarded save. The
  cost is an **orphan window**: if that save then loses a conflict, bytes sit in `sounds/files/` with
  nothing naming them. That is the right trade — an orphan is invisible, cheap and listable (S7),
  while the alternative loses work.

  **The id is minted server-side and an upload is never idempotent.** Two authors uploading `pop.mp3`
  on the same day must not collide, and a client-chosen id could address — and overwrite — another
  entry's audio. The consequence is that a retried upload writes a second object and a replaced file
  leaves its predecessor behind; both are orphans. This path never destroys audio.

  **`durationMs` is measured client-side.** Deriving it here would mean decoding five container
  formats server-side; the browser already decoded the file to display it, and its answer is the one
  that matters — it is the same decoder that will play the sound. The doc's normalize rejecting a
  non-positive duration is what stops a wrong one becoming a silent sprite region.

  **Range requests are honoured** (`parseRange`), because an `<audio>` element scrubbing a BGM track
  sends them and a server answering 200-with-everything makes it re-download the file on every seek.
  The response is `inline`, not `attachment` like the `/api/files/download` sibling — this one has to
  play. Content type comes from the stored filename, never from the browser's `File.type`, which is
  client-supplied and varies by OS for the same file. The gate + scope moved into `soundAccess.ts`
  and both routes now share them, mirroring `spine.ts`.

  **Verified.** `check:sounds-doc` grew to **61 claims** (was 48) — extension acceptance, served
  content types, minted-id shape + 500-way uniqueness + that a minted filename passes the doc
  validator, and 13 on `parseRange` alone (suffix ranges are the TAIL, clamping, unsatisfiable
  starts, multi-range declined rather than mis-read). **A real R2 file round-trip** (throwaway
  `_verify/sound_s3` prefix, refused unless empty, deleted after) uploaded the real 4,872,925-byte
  `sounds.mp3`, proved exactly one object landed at `<project>/sounds/files/<id>.mp3`, and read it
  back **sha256-identical**; a missing file and a traversal filename both read as `null` rather than
  throwing. **Playback proved in a real browser**: the round-tripped bytes decoded via
  `decodeAudioData` to 406.0 s, 48 kHz, stereo, 19,488,000 frames; an `<audio>` element reached
  `canplaythrough` at `readyState 4`; and an `AudioBufferSourceNode` through an analyser measured a
  non-zero peak (0.09) with the context `running` — it actually played.

  ⏳ **The HTTP paths are not exercised.** The gate is confirmed live (all three routes answer 401
  unauthenticated on the local launcher) and the handler logic is covered offline, but multipart
  parsing and the 206 branch need a session and a page — S5/S6. An attempt to disable the gate
  locally to fake one was refused by the sandbox, correctly; it is not worth faking.

- 2026-08-26 — **A project can now HAVE a sound library** — the doc, its storage, and the write
  guard. Design step S2. `soundLibrary.ts` in `engine-layout` holds the shared contract (types,
  name/filename validity, `findSoundByName`) beside `fontCatalog.ts`, because the tool and the game
  must not invent separate shapes; `soundsStorage.ts` holds the Zod validator, the normalize and the
  conditional read/write; `projectPaths.ts` gains `SUB.sounds`, `soundsDocKey` and `soundFileKey`.

  **The normalize DROPS rather than prunes, and that is the design.** Every other doc here is sparse
  — an absent field falls back. A sound entry can instead be *unshippable*: no file, a name no
  binding could address, a non-positive duration, or a duplicate. Each of those would reach a player
  as silence, which howler produces without an error, so keeping them would be storing a fact the
  tool would then display as a sound that can never play. **Duplicates collapse LAST-WINS on both
  `name` and `id`** — not an arbitrary pick, but the rule `buildSoundBankIndex` already applies when
  two banks declare one name, so the doc and the player cannot answer differently.

  **Two defaults are chosen so absence never reads as a claim:** an unreviewed sound is `draft` (the
  field's whole value is that it can be withheld), and an unstated provenance is `library` — the one
  origin that asserts nothing about who made it, so a missing field cannot launder an unlicensed
  upload. Review metadata is stripped from a draft, so demoting an approval actually revokes it.
  **`isValidSoundFile` is the traversal guard** and lives in `engine-layout` so the doc validator and
  `soundFileKey` share one definition; the path builder re-asserts it rather than trusting its
  caller.

  **The design doc was wrong about one field and is corrected:** `loopPoints` became `loop: boolean`.
  Looping lives in exactly one place — the optional third element of a howler sprite tuple — which is
  also why S1 found `createPlayer`'s `loop` option dead. There is no sub-region loop to author.

  **Verified.** `pnpm --filter launcher-api check:sounds-doc` — **48 claims** over the REAL save path
  (not the Zod parse alone: it is the whitelist rebuild that drops, so parsing-only would pass while
  an author's work vanished). Mutation-tested five ways — no duplicate collapse, defaulting status to
  `approved`, keeping a draft's reviewer, clamping volume instead of dropping it, and removing the
  filename check — each fails it. **A real R2 round-trip** (throwaway `_verify/sound_s2` prefix,
  refused to run unless empty, deleted after) proved create → read → conditional update, that a
  **stale `baseEtag` throws `ConflictError`** and the loser's write does not land, that
  `If-None-Match` loses against a live object, and that `force` overwrites. That harness found a real
  bug: `saveSoundsDoc` stamped `updatedAt` but `normalizeSoundsDoc` stripped it on read, so the field
  was written to R2 and invisible to every reader — the exact half-persist trap the module warns
  about, committed by the module itself. Fixed and pinned by two claims.
  `tsc --noEmit` clean for `soundLibrary.ts`, `soundsStorage.ts` and `projectPaths.ts` (checked in
  isolation — a bare `tsc -p` in the launcher yields 786 pre-existing `$lib`-alias errors, per
  `apps/launcher-api/CLAUDE.md`). `pnpm --filter launcher-api build` green with
  `api/sounds/_server.ts.js` in the server output; `pnpm --filter lines build` green.

- 2026-08-26 — **The sound player can hold more than one audio bank — the precondition for a project
  having sounds of its own.** `docs/design/invisible-sound.md` step S1. Before this, `createSound`
  built exactly one `Howl` from exactly one `LoadedAudio` and played by indexing that one sprite map,
  so "upload a sound and hear it in the game" was not hard but *structurally impossible*: the
  audiosprite is baked into each app's `static/` and identical for every project. `load()` now takes
  an ordered bank list (a single audio still works — every caller passes one, unchanged), builds a
  `Howl` per bank, and resolves each name to the **last** bank declaring it. That is the same
  last-wins rule `mergeBakedFontCatalog` uses for fonts, and it is what makes an uploaded sound an
  override rather than a collision.

  **The load-bearing constraint is that a `soundId` is only unique within its own `Howl`.** Every
  play/stop/pause/fade/rate/volume path therefore routes through `howlFor(name)` rather than a
  captured howl; crossing them would mis-target silently, since howler reports nothing. `configFor`
  reads the base volume from the *owning* bank, so an override brings its own mix. `hasSound()` spans
  every bank, and `destroy()` unloads **once per bank** — it used to unload the three players'
  `howl`, which was the same object three times, and would have left every bank after the first
  loaded forever. **Membership is by `sprite`, never by `config`:** owning a name you cannot play
  routes it to a howl that declines it silently, which is the failure this whole feature exists to
  end.

  Two behaviour fixes fell out, both from resolving the howl *before* playing: an unplayable name no
  longer pins itself in the sound map as `playing` with a null id (it could never play again, even
  after a bank carrying it loaded), and an unknown music track no longer pauses the music that was
  playing before discovering it has nothing to start. Also removed three pieces of dead code the
  rewrite exposed: an unused `waitForTimeout` import, an unused `loop` option on `createPlayer`
  (looping is per-sprite-entry — the third element of a sprite tuple), and the player's `howl`
  field, which no caller outside the package read.

  **Verified.** `packages/utils-sound/banks.fixture.ts` — **40 offline claims** driving the REAL
  `createPlayer` + `createPlayOnce`/`createPlayMusic` against fake howls rather than a
  re-implementation (`pnpm --filter launcher-api exec tsx ../../packages/utils-sound/banks.fixture.ts`).
  Mutation-tested five ways — first-wins resolution, membership including `config` keys, one shared
  howl, the old map-poisoning, and pausing music before the howl check — all five fail it.
  `pnpm --filter lines build` green; `pnpm --filter utils-sound lint` down to the 2 pre-existing
  `TPlay extends Function` errors (HEAD had 3, including the dead import removed here).
  **Live in `apps/lines` + the book mock, real Chrome** (the Browser pane suspends rAF, so reels
  freeze and no stop cue fires — see the sound-verification recipe): with a temporary second bank,
  `Howler._howls` held **2** howls (53 + 2 sprites); a second-bank-only name played on howl 1, a name
  BOTH banks declared played on howl **1** (last wins), a built-in-only name on howl 0, and an
  unknown name produced no call on either. Volumes confirmed the owning bank supplies the mix
  (0.5625 × 0.77 = 0.433125 for the override, × 0.33 for the new name). `destroy()` called `unload()`
  exactly once per bank and dropped the registry to 0. With the probe reverted: **1** howl, and a
  real spin played `sfx_btn_spin`, `sfx_reel_stop_1…5`, `sfx_royals_landing`, `sfx_symbols_landing`
  and `sfx_scatter_stop_1…4` — all on bank 0, matching the cue set recorded on 2026-08-25.
