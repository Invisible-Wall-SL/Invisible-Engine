# Invisible Sound — status

> Design: [docs/design/invisible-sound.md](../design/invisible-sound.md) · Guide: [docs/tools/sound.md](../tools/sound.md) · Agent: — (unbuilt)

**One-line state:** shipped — build plan S1–S10 complete. A project picks what plays at every
moment of the game here, from a library it uploads, describes and approves on the same page, and it
ships through the full asset chain behind a publish gate. The library half is click-tested live; the
choices half is still owed a signed-in click-through (open item 1).

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
  `presignSoundUpload` / `getSoundFile`, and `parseRange`.
- **`soundAccess.ts`** — `requireSoundAccess`, shared by both routes (mirroring `spine.ts`), so a
  second route cannot ship a slightly different gate. The `?project=` scope is the launcher-wide
  `requireProjectScope` (`toolScope.ts`) since 2026-09-28, which refuses a project the user cannot
  access.
- **`POST /api/sounds/file`** — mints a presigned PUT for `sounds/files/<id>.<ext>`, id minted
  SERVER-side; the browser uploads the bytes STRAIGHT TO R2. It went through the launcher as a
  multipart body until 2026-09-15, which capped every sound at adapter-node's 512 KB
  `BODY_SIZE_LIMIT` — see the dated entry. It deliberately does **not** touch `sounds.json`: an
  upload that also wrote the doc would have to write it unconditionally, which is how one author's
  library silently replaces another's.
- **`GET /api/sounds/file?file=…`** — streams for audition, `inline` (not `attachment` like the FTP
  sibling), `no-store`, and honours Range so an `<audio>` element scrubbing a BGM track does not
  re-download the file on every seek.
- **`durationMs` is measured client-side, not here.** Deriving it would mean decoding five container
  formats server-side; the browser already decoded the file to show it, and its answer is the one
  that matters — it is the same decoder that will play the sound. The doc's normalize rejecting a
  non-positive duration is the guard that stops a wrong one becoming a silent sprite.

✅ **Verified over HTTP on 2026-09-15**, signed in against production — which is how the 512 KB
ceiling was found at all: it lived in the one step every offline fixture had to skip. After the fix,
the engine's own 4,872,925-byte `sounds.mp3` went through the REAL page: mint → presigned PUT →
entry appended (`snd_<16 hex>.mp3`, measured 406.00 s, matching the S3 harness) → **Save enabled**,
no errors. It streamed back byte-exact as `audio/mpeg`, and the Range branch answered
`206 bytes 0-99/4872925`. The probe object was deleted afterwards and nothing was saved into the
project's library.

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
- **`pull-project-assets.mjs`** mirrors `sounds/` and prunes it (`sounds` is in
  `GENERATED_SUBTREES`, since 2026-09-28 / #839), so a removed or renamed sound does not linger in
  a desktop/delivery build.
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
- (Originally the page did not author bindings; S10 below moved the choices in.)

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
a sound picker offer" — the engine's own sounds plus this project's, project first. It was wired
into `/config` (slot ladders), `/editor` (win tiers), `/symbols` (per-symbol + anticipation cues)
and `/flow-v2` (the inspector, via `withProjectSounds` widening the vocabulary's three sound enums).
**S10 then took the first three pickers away, so only `/flow-v2` still reads it** — see the
2026-09-15 cleanup in Recent changes.

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

1. **Finish the click-through.** The LIBRARY half is now done live (2026-09-15, `test6`): the page
   opens on a hard load, a 4.9 MB upload lands, the entry appears, Save lights up, and the sound
   auditions back byte-exact. The CHOICES half is still only compiled and type-checked — open a
   project that has sound choices in `/config`/`/symbols`, confirm the page opens on what the game
   already plays and says so, change one moment, save, reload, and hear it in a game. 61 offline
   claims and a real-R2 round trip did not catch a defect that made every upload impossible; the
   click-through is the only thing that finds this class.
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

- 2026-10-01 — **A newer `kind`, `status` or `origin` no longer wipes the whole sound library.**
  Each was a Zod enum, so one value a newer launcher wrote failed the parse.
  `loadSoundsDocWithEtag` then fell back to the empty library and the export pruned
  `deploy/sounds/`. Now a READ keeps the entry: an unknown `kind` reads as `sfx`, and an unknown
  `status` / `origin` reads as `draft` / `library` (a reviewer on that draft is dropped). A newer
  `version` reads as `1`. Each case logs one server warning. The entry is kept rather than dropped
  because this doc has no backups: a dropped sound would be gone on the next save and silence every
  binding that names it. A save (`PUT /api/sounds`) still answers 400. Rule:
  `docs/conventions/doc-readers.md` §"Unknown enum values".

- 2026-09-28 — **A removed or renamed sound no longer ships in desktop/delivery builds.** This file
  said twice that `pull-project-assets.mjs` had `sounds` in `GENERATED_SUBTREES`; `git log -S`
  shows it never did, so the pull mirrored `deploy/sounds/` but never converged the local copy on
  it and every superseded file stayed in `static/assets/sounds/` and shipped. Added, and verified
  against a mock `/api/deploy`: with the origin/main script two stale sounds survive a pull; with
  this one they are pruned, the current sound and `index.json` stay, and the committed
  `audio/` audiosprite is untouched (no game commits into `sounds/`, so the subtree is wholly
  export-owned). Online games were never affected: they read `deploy/` directly.

- 2026-09-28 (security) — **`/api/sounds` and `/api/sounds/file` refuse a project the caller cannot
  access.** Both resolved any `?project=` once the role had `sound`, so a caller could overwrite
  another client's library, mint an upload into its `sounds/files/`, or stream its audio. They now
  scope through the launcher-wide `requireProjectScope` (403 on an inaccessible or unknown key; the
  page always sends its own project, so authors see no change). `resolveSoundScope` is deleted.
  Details: [launcher.md](launcher.md) Recent changes, 2026-09-28.
- 2026-09-23 — **Nothing in this pipeline had ever looked at HOW an upload was encoded, and a 256 kbps music bed was reaching every player.** Found while measuring why the Book of Borut remake's build had grown to ~70 MB (see [engine status](engine.md) for the texture half). The audio looked like duplication at first — the game fetches a 3.55 MB `assets/audio/sounds.ogg` AND a 6.84 MB `snd_*.mp3` from the deploy API — but it is **not**: the shipped audiosprite holds **53 distinct cues** (read live off `Howler._howls`) that every engine default and a dozen hardcoded literals still play, while the uploaded track is separate music. Removing either silences real sound. The actual waste was the ENCODING: the track measured **256 kbps / 48 kHz stereo over 224 s** (MPEG-1 Layer III first-frame header), where the only existing control anywhere is a 25 MB per-upload cap in `soundLibrary.ts`. `audioTranscode.ts` + `ENV.SOUND_TRANSCODE` (ON, cap `SOUND_MAX_KBPS` = 128) now re-encode on the way into `deploy/sounds/`: **6.84 MB → 3.42 MB** in 2.6 s, measured on the real file. **Three properties that are the point of the design, not incidental:** (a) the UPLOAD is never touched — `sounds/files/` deliberately never destroys audio, so this caps the exported copy only and `SOUND_TRANSCODE=0` + a re-export restores the original bytes exactly; (b) same container in, same container out, because an entry's `file` is the name the catalog and the game resolve — which is also why `wav` is skipped (a bitrate cap is meaningless for PCM and the real fix would rename it, so **a wav-heavy library is still a size hazard**); (c) a re-encode is kept **only when it is actually smaller** (`KEEP_BELOW = 0.9`) rather than decided by a bitrate probe — verified that re-capping an already-128k file and "capping" one at 320k both return null and ship the source, so no generation loss and no size regression. Caching is not optional here: this exporter runs on the per-boot `/api/editor/runtime` assemble (`runtimeBundle.ts`), so `sounds/_transcode.json` — kept beside the SOURCES, never under `deploy/`, so it is not mirrored into game builds or hit by the deploy prune — records source ETag+size+cap per file, including for files that shipped verbatim, or an unbeatable track would re-encode on every boot. `TRANSCODE_REVISION` exists for the `KTX2_ENCODER_REVISION` reason: a cache keyed only on the source can never let a settings fix reach unchanged audio. ⚠️ **Infra:** this adds `ffmpeg-static` to the launcher, whose install DOWNLOADS an ~83 MB binary and only runs because it is in root `onlyBuiltDependencies` — a failed download degrades silently to verbatim audio rather than failing the build (see [INFRA](../INFRA.md) § "launcher build-time binary"). **Shipped and VERIFIED LIVE** (#775, `d3f97cef`): deployed and re-exported — the remake's bed is now **3.42 MB on the wire, down from 6.84 MB**, and the second export's `sounds` phase dropped 6233→684 ms, so the cache is doing its job on the runtime-assemble path. Both guards were measured against the real track before shipping (re-capping an already-128k file and "capping" one at 320k each return null and ship the source). Known remaining overlap, deliberately NOT done: `bgm_main` + `bgm_freespin` in the shipped sprite (~1.77 MB) are genuinely dead for a project with its own music, but splitting the sprite and gating it edits the SHARED runtime — it re-points every online game on merge, and an inverted gate silences music for games with no uploaded track.
- 2026-09-15 — **The music a game comes BACK to is authored now, and a cue can carry its own level.**
  Three owner questions off one uploaded soundtrack: _"it starts correct, but it doesn't loop, and I
  do not see any option to make it loop"_ · _"when I get out of the big win, there is no more music
  playing, and I would like SM to play instead"_ · _"the music I selected have different volumes, and
  I would like to be able to specify a specific volume to play at, probably from the flow itself."_

  **Looping was already authorable and already shipped** — `loop` on the library row → normalize →
  `soundCatalogEntries` → `bakedSounds.ts`'s sprite tuple `[0, durationMs, true]`, which is the only
  place looping is expressed anywhere in the engine. The shipped audiosprite marks 8 of its 53
  regions the same way (`bgm_main` is `[71000, 132452.83, true]`), which is the entire reason a
  built-in bed loops "by default" and an upload does not. No hop drops the flag. What was broken is
  that **the ▶ audition ignored it**, so the one experiment that could teach an author what the
  checkbox does answered "nothing" — fixed, ▶ now honours `loop` and `vol` both.

  **The real gap was the RESTORE.** `winLevelSoundsStop` named `bgm_main` / `bgm_freespin` as
  literals, as did the free-spin switch, the bet-mode switch and the boot autoplay. So a project
  could author the track for the start of the game (a flow cue), and for every win tier
  (`winTiers`), and the first big win still handed the game back to a name its author had never
  chosen — or to silence, in a bundle that no longer carries it. The one beat nobody could author
  sat at the end of the loudest moment in the game. **Two new catalogue slots** — `baseMusic` and
  `freeSpinMusic`, defaults `bgm_main` / `bgm_freespin` — make it the same kind of authored answer as
  every other moment, and because the tool renders `SOUND_SLOTS`, they appear in Game moments with no
  UI change — FIRST in the list, since they are what a project with its own soundtrack sets before
  anything else (`SOUND_SLOT_IDS` and `SOUND_SLOTS` must stay in step; `sounds.fixture.ts` zips them).
  All four of `apps/lines`' call sites go through `broadcastMusicCue` / `musicCue`
  (`soundBindings.ts`) — the other reference apps still carry their own literals, which is fine
  while they stay dev/reference. A project that has authored nothing resolves to the same two names
  it played before.

  **The slot decides what the game comes BACK to, not what starts it.** Under a flow that drives the
  screens the boot autoplay is deliberately suppressed, so the opening track is still the
  `soundMusic` cue on Game Signals' `tapToStart` pin — a project that sets the slot and leaves that
  node on `bgm_main` opens on the engine's music and switches to its own only after the first
  restore. Said in the slot's own help text and in the guide, because the help text is the only
  instruction an author gets.

  The tool's own **`notRebindable`** list — "shipped sounds this project can NOT rebind … each a
  candidate for promotion into `SOUND_SLOTS`" — drops `bgm_main` and `bgm_freespin` as a
  consequence, with no change to the usage index: a slot's resolved names count as bound, defaults
  included. That list was the standing description of exactly this bug, waiting for someone to hit
  it.

  **And a per-firing volume on the flow cues.** `soundMusic` and `soundOnce` gained an OPTIONAL
  `volume` pin (`optional: true` matters: a required data-in would have raised `unfilled-data-in` on
  every sound cue in every graph already authored). The event already carried `volume` for
  `soundOnce`; the music player now takes one the way `createPlayOnce` always has — stored on
  `soundVolume` before `initSoundVolume` folds it into `playerVolume × volume × the entry's own
  level`, so it scales with the player's music slider and can only attenuate. **The resume path
  needed it too**: music PAUSES rather than stops, so re-firing the base bed after a big win takes
  the `paused` branch, which would have dropped a newly asked-for level every time. An
  already-playing bed re-mixes without restarting.

  **PER-FIRING means per-firing, and getting that wrong was the review's catch.** The first cut kept
  `volume ?? sound.soundVolume` — which is right for a one-shot, whose map entry is DELETED by its
  `end` handler, and wrong for music, whose entry lives forever so a track can be paused and
  resumed. It made the level sticky: one `soundMusic(theme, 0.3)` anywhere in a flow re-mixed every
  later restore of that track, `winLevelSoundsStop`'s included, for the rest of the session —
  inaudibly, since nothing says a number it never asked for is being applied. A firing that asks for
  nothing now resets the multiplier to 1 (the row's level). The cost, recorded so nobody
  rediscovers it: a music track faded with `soundFade` and then re-fired comes back at its row level
  rather than the faded one — re-asking for a track is a request to play it, and no music is faded
  today (the only `soundFade` in the engine targets the anticipation LOOP).

  **The flow's number is the first author-set volume that reaches the players unguarded** — the
  inspector's number input has no range, and howler IGNORES a volume outside 0..1 (it returns the
  current level instead), so `2` would be a silent no-op that then skewed every later mix. Both
  players now run it through `usablePlayVolume`, which DISCARDS out of range rather than clamping —
  the same rule `readVolume` and `normalizeSoundsDoc` already apply to the authored paths.

  **Verified.** `packages/utils-sound/banks.fixture.ts` grew a 9th section, **12 claims** driving
  the real players against fake howls: unasked ⇒ the entry's own level; asked ⇒ multiplied, not
  substituted (0.4 × 0.5 = 0.2); a resume replays by id AND re-mixes; a level change does not
  restart the bed; **a per-firing level does not outlive its firing**, neither across a
  pause/resume nor while the bed keeps playing; out of range falls back to the row's level on both
  players. Mutation-tested — dropping the volume handling from the resume branch alone fails
  "…and the new level lands on the resume". `check:sounds-doc`, `check:sound-bindings` and
  `game-config`'s `sounds.fixture.ts` all still hold (their slot claims are generic over
  `SOUND_SLOT_IDS`, and both new slots ship defaults). `node scripts/gen-flow-vocabulary.mjs
  --check` passes — the launcher's generated `emitterVocabularies.ts` is the second output of that
  generator and CI gates it, so a hand-edit of the game-side copy alone would have failed the PR.
  `pnpm --filter lines build` and `pnpm --filter launcher-api build` green; `engine-flow-v2` and
  `game-config` typecheck clean.

- 2026-09-15 — **Leaving the page mid-upload no longer eats the file silently.** Same day, same
  owner, the report one layer in: _"I have add 2 sounds, I have seen them writing 'uploading' … but
  when I go in the flow editor … this new sounds are not appearing, and I am not even sure how to
  check if they are there."_

  **Measured first, on production.** Their project's `sounds.json` had **zero** entries, and a walk
  of EVERY client/project prefix in the bucket found **no `sounds/files/` object anywhere at all** —
  so the bytes never landed, which rules out "uploaded but not saved" (that leaves an orphan). Then
  the same two files were put through the real page: an upload takes **~5 s per file** — the decode
  runs before a single byte is sent — and for those five seconds the box said only `Uploading 1…`
  with no name, no progress and no completion line. That is the window the author walked out of.

  **What the exit actually does, verified rather than assumed.** Every tool-bar link is an `<a href>`
  that SvelteKit intercepts as a CLIENT-SIDE navigation, so `beforeunload` never fires — and a PUT
  already in flight is **not** aborted by it (probed live: mint → PUT → `link.click()` to `/flow-v2`
  one second in → the PUT still answered 200). So an author who leaves mid-PUT gets an orphan they
  cannot see, and one who leaves during the DECODE — before the PUT starts — gets nothing at all,
  which is what happened here. `/sound` had no guard of any kind: the five sibling tools (editor, fx,
  flipbook, components, admin) at least register `beforeunload`, and this page did not.

  **The fixes.** `beforeNavigate` now confirms before a client-side exit and `beforeunload` covers the
  real unload, both keyed on one `leaveCost` derived that distinguishes the two losses — an upload in
  flight (unrecoverable: no entry, maybe no object) from an unsaved library (recoverable by Save).
  The progress line names the file and counts the queue behind it; a bordered line then confirms what
  was added and that Save is what keeps it, because the rows themselves render far enough down the
  page to be off-screen from the drop zone. Saving clears that line. The drop zone is also disabled
  under a read-only lease, which until now accepted uploads it could never file.

  **Nothing downstream was broken.** Verified by fixture against the real `soundOptionsFor` +
  `withProjectSounds`: a SAVED entry — draft included, there is no approval filter — is offered by
  all three flow enums (`MusicName`, `SoundEffectName`, `SoundName`), project names FIRST, with the
  built-ins still present. The flow editor could not show the owner's sounds because the library was
  genuinely empty, not because it cannot see a library.

  **It has to be `beforeNavigate`, not `onNavigate`** — the first version shipped on the latter,
  which runs AFTER a client-side navigation is committed and whose argument carries no `cancel`, so
  the prompt appeared and the page left anyway. Caught only by clicking it on production: `vite
  build` does not typecheck and the launcher has no `svelte-check` script, so a wrong-but-valid hook
  is invisible until a human (or an automated click) tries the behaviour.

  **Two more holes closed while the guard was fresh.** `addFiles` was re-entrant: a second pick
  during a run would race the first's `finally`, clear `uploadingName`, and DISARM the leave guard
  while bytes were still in flight — so the controls are now disabled while busy and `addFiles`
  refuses a second run. And `input.value` was cleared only when the upload promise settled, so
  re-picking the same file mid-run fired no `change` event at all (a dead-looking control on the
  retry after a failure); it is cleared synchronously now, copying the live `FileList` first, since
  clearing `value` empties the very list just handed over. The run also carries an `AbortController`,
  aborted on teardown, so a doomed PUT stops rather than completing into an invisible orphan.

  **What this did NOT do, and should.** The exit gap is not specific to this tool: `beforeNavigate`
  is the launcher's first, five tools (editor, fx, flipbook, components, admin) have only the
  `beforeunload` half that never fires on a tool-bar switch, and four manual-save tools (config,
  win-text, localization, symbols) have no guard at all. The registered next step is an opt-in
  `guardExit(() => cost)` on the shared `saveState.svelte.ts` — which already owns `dirty` for eight
  tools — adopted by `/sound` first and then replacing the five copies. Kept out of a bug fix so it
  does not land in five other tools' files mid-flight. Two more from the same audit:
  `svelte.config.js` has no `kit.version` block, so no tab ever learns its JS is a build behind (the
  structural answer to any request-contract change like #669's multipart→JSON); and real PUT
  progress (XHR `upload.onprogress`) would replace a frozen filename on a 25 MB file.

- 2026-09-15 — **S10's leftover: three pages paid an R2 read for a value nothing read.** S9 gave
  `/config`, `/editor`, `/symbols` and `/flow-v2` a `soundOptions` payload; S10 moved sound
  authoring into `/sound` and deleted the pickers from the first three — but left their loaders
  still computing it. Each therefore did an extra `loadSoundsDoc` (an R2 `sounds.json` GET) on
  **every** page load, awaited inline in the returned object, and threw the result away.

  Removed from those three loaders, along with the now-unused `soundOptionsFor` / `loadSoundsDoc`
  imports. **`/flow-v2` is untouched** — it is the one real consumer
  (`withProjectSounds(templateVocabulary(doc.templateId), data.soundOptions)`), and `/sound` reads
  the doc by its own separate `loadSoundsDocWithEtag` path.

  Checked before cutting, because a loader could have wanted the doc for a second reason:
  `loadSoundsDoc` and `soundOptionsFor` each appeared exactly once per file, on that one line. No
  component, child route or `$page.data` reference to `soundOptions` exists outside `/flow-v2`, and
  none of the three pages spreads or bracket-indexes its page `data`. 15 lines deleted, nothing
  added. Build green; `check:sounds-doc` and `check:sound-bindings` hold; lint unchanged (its 158
  pre-existing errors are byte-identical before and after, none in these files).

- 2026-09-15 — **A sound can be uploaded at all now, and a hard load of `/sound` stops being a 500.**
  Two unrelated defects, both reached from one owner report: _"I added some sounds, I can't find them
  anywhere, there was no upload button, and Save never activated."_

  **The upload could never have carried a real sound.** `POST /api/sounds/file` took a MULTIPART
  body, so the bytes travelled through the launcher — where adapter-node truncates any request body
  at `BODY_SIZE_LIMIT`, **512 KB** by default and unset on Railway. Probed live: a 400 KB body
  reached the handler (415, its own format check), a 600 KB one did not (400 "Expected a multipart
  upload") — because the truncated stream makes `request.formData()` reject, so the handler reported
  a parse failure and never saw a size. Every sound past a short blip therefore failed under a
  message pointing at the wrong thing, and the handler's own 25 MB cap was unreachable. This is the
  exact wall the font, spine and flipbook imports already route around, and the fix is theirs: the
  endpoint MINTS a presigned PUT (`presignSoundUpload`, 10 min TTL) and the browser uploads straight
  to R2. `putSoundFile` went with it — nothing else called it. `MAX_SOUND_BYTES` moved to
  `engine-layout`, so the page, the message and the mint endpoint share one number instead of the
  page hardcoding "25 MB" in prose; the cap is now checked against the DECLARED size, which catches
  an honest 300 MB drop rather than a liar, and a liar here is a logged-in author entitled to the
  tool. **The rest of the report follows from it**: no bytes ever landed, so nothing was there to
  find; the entry is only appended after a successful upload, so the doc never went dirty; and Save
  is enabled only by a dirty doc, so it stayed grey. There is no upload button by design — picking
  or dropping files IS the upload. Failures now list one line per file and print the endpoint's
  `message` rather than the raw JSON body.

  **And `/sound` answered 500 to every hard load** (typed URL, refresh) while reaching it from
  another tool page worked — the shape that hid it, since only a hard load renders on the server.
  `+page.server.ts` was fine (`/sound/__data.json` returned the full payload); the SSR RENDER threw.
  Cause: on the client a `$derived` is lazy, first read during render, but the server compiles
  `$derived.by(fn)` to a plain **`fn()` at its declaration site** — so the `bindings` index ran while
  `SOURCE_HREF`, a `const` 40 lines below it, was still in its temporal dead zone. `Cannot access
  before initialization`, every project, every load. The two lookup tables now sit above the derived
  that reads them, with the reason on them. Worth carrying: **`/sound` is one of the few tool pages
  that does NOT set `ssr = false`** (editor, symbols, flow-v2, fx, fonts, flipbook, components all
  do), so it is the page where declaration ORDER inside the instance script is load-bearing. Symbol-state rename only, decided in Invisible Symbols (see [symbols.md](symbols.md)): the state `tumbleExplosion` became `clearReel`, because the beat is a symbol being TAKEN OFF the board — the cascade’s removal _and_ the swap-in-place board CLEAR — not only a tumble. Nothing about the sound moved: same gate (the project cascades OR clears), same additive relationship to the game-wide ladder, same audiosprite keys.

  - **A saved binding is not re-authored.** `symbolSounds[symbol].tumbleExplosion` is folded into `clearReel` at the symbols-doc load boundary (`symbolsStorage#migrateLegacySymbolStates`), before validation — the per-symbol map is keyed by `z.enum(SYMBOL_STATES)` and Zod rejects an unlisted key, so an un-folded doc would have loaded as an empty one and lost every cue on it.
  - **The game-wide SLOT is still `tumbleExplosion`** (`packages/game-config/src/sounds.ts`, `/config` → Sounds → “Tumble explosion”). It lives in the sounds doc, a different namespace from the symbol states, and renaming it would migrate a second doc for no gain.

- 2026-08-27 — **Per-symbol cues gained `Intro`, and `Tumble explosion` was offered to the wrong set of projects.** `Intro` is the cue a symbol makes as it SURFACES under the new `emerge` swap style (`/config` → Reel behaviour); it is heard **alongside** the ordinary landing cue rather than instead of it, unlike `Land`, whose per-symbol binding replaces the game-wide slot. The difference is whether there is a class cue to override: an emerge has no game-wide slot of its own, so there is nothing to replace. **The correction:** `tumbleExplosion` was gated on `resolveCascade` alone, but two things play that state — a tumble removing a symbol, and the swap-in-place CLEAR step, which a swapping board runs every round. A project authoring the sink half of an emerge was therefore offered no row for the very cue it fires. Both gates now come from one helper (`symbolCueStates`) reading the resolved config, so the state a beat plays and the switch that turns that beat on stay two separate questions asked in one place. Full story in [game-config.md](game-config.md).

- 2026-08-26 — **S1–S10 built in one pass** (banks → library doc → files → chain → page → registered →
  usage index → publish gate → one picker list → authoring moved in). What each step does is under
  _Current state_; the traps worth keeping that are not visible from the code:
  - **Howler strips the query string before sniffing a codec**, so a sound URL must carry its
    extension in the PATH. `/api/editor/runtime` builds `assetBase` as a path on purpose, and
    `bakedSoundBanks` also DECLARES `format` from the catalog filename (`LoadedAudio.format`).
  - **`durationMs` becomes the sprite region, `loop` its third element** — a zero-length region plays
    nothing and an over-long one fires `end` late, pinning the once-player's map entry. That is why
    the doc drops a non-positive duration. There is no sub-region loop (`loop: boolean`, not
    `loopPoints`).
  - **Uploads are never idempotent** (id minted server-side, never touches `sounds.json`), so a
    retried upload or a lost doc-save conflict leaves an orphan file. Deliberate: an orphan is cheap
    and listable; an upload that also wrote the doc could only do it unconditionally.
  - **Normalize defaults assert nothing**: unreviewed ⇒ `draft`, unstated provenance ⇒ `library`,
    review metadata stripped from a draft (demoting revokes approval); duplicates collapse
    last-wins on `name` and `id`, the same rule `buildSoundBankIndex` applies to banks.
  - **The usage index finds code-only sounds by SUBTRACTION** (shipped set − bound set), not a scan
    of `apps/lines/src` — a scan counted the `SoundName` union and comments. A built-in OVERRIDE is
    labelled as such, never "unbound", and it blocks the publish gate when unapproved.
  - **Flow needed no schema change**: `validate.ts` never tested enum membership; `withProjectSounds`
    widens the three sound enums and returns the vocabulary by identity when the library is empty.
  - **Real-R2 harnesses caught what fixtures could not**: two publish-gate wiring mutations passed
    `check:sounds-doc` and failed the R2 harness; the S2 harness found `updatedAt` written to R2 but
    stripped on read. A sounds-only config doc is dropped whole by `normalizeGameConfigDoc` (it
    needs a math contract), so a harness must build on a real template.
  - **A new tool's icon goes in the four non-Svelte tool-bar twins too** —
    `scripts/check-toolbar-icons.mjs` enforces it.
  - The opt-in `--optimize` build trims audio only via manifests with a `src` array, so a flat
    `sounds/` tree survives it (checked, not assumed).
