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
- **`soundAccess.ts`** — `requireSoundAccess`, shared by both routes (mirroring `rig.ts`), so a
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
  (live Game Maker path, via the `exporters.ts` pass — which `publishGame` also calls, so a publish
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

**S7 — the usage index (done).** `apps/launcher-api/src/lib/soundUsage.ts` checks the library against
what the game names — the choices on the page, flow-graph cues, and (since 2026-11-12) the export's
own walk of everything else — and reports **unbound**, **missing** and **unapproved-but-shipped**,
plus the two lists that make them readable (`overridesBuiltin`, `notRebindable`). Unbound and the
not-approved list follow the export once its answer arrives, so the page lists exactly the drafts
the publish gate refuses.

- **Bindings are collected server-side, checks run on the page.** The config/symbols/flow docs are
  not editable from `/sound` so they cannot go stale while it is open; the library can, so renaming
  a sound shows it becoming unbound immediately rather than after a reload.
- **Which flow nodes play which sound has one home since 2026-11-12:** `$lib/flowSoundCues.ts`
  walks every graph (the flow's own, each mode's, group bodies, called library functions) and
  reads a sound pin by its vocabulary declaration or by a sound-enum literal, so a function call
  that takes a sound is found without touching the collector. The usage index, the publish gate
  and the export's reachability all read it.
- Read-only, with each row linking to the tool that owns it (design §2.3; the design's own "editable
  here: yes" rows were corrected to match).

**S8 — the publish gate (done; verified against real R2).** `soundPublishCheck.ts` runs before
anything is written: a draft the build SHIPS refuses the publish, naming them. Since 2026-11-12
"ships" is the export's own answer (`soundReachability.ts`, with the same resolved choices).
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
4. **The shipped audiosprite still loads whole.** Every game downloads and decodes all 408 s of
   it; 26–175 s of that is unreachable per game. Plan and numbers: the 2026-11-12 entry below.
   _Done 2026-11-12: it ships as 34 banks and a game loads those it can reach (Recent changes)._

## Blocked (owner / external)

- _None._

## Recent changes

- 2026-11-12 — **The engine's stock audio ships as banks, and a game loads only the ones it can
  reach** (branch `engine/stock-sound-banks`, committed locally, not pushed; owner-approved plan
  from the entry below). Every game downloaded the whole 408 s stock audiosprite and decoded all
  of it, ≈ 144 MB of PCM, whatever it could play.
  - **The split** (`scripts/split-stock-audio.mjs`): 34 banks in `static/assets/audio/stock/`,
    each a region of the sprite or a run of neighbours always loaded together (a slot ladder, or
    regions the engine's code plays). Cut by STREAM COPY, not re-encoded (re-encoding costs
    ~20 dB, `author-sfx-btn-stop.mjs`): every bank's packets are byte-identical to a run of the
    sprite's. Ogg and MP3 regions decode to the same samples; AAC and AC-3 differ only by
    their decoder noise (noise substitution, mantissa dither), ±0.03 dB per 2048-sample block.
    A copy cuts on packets, so each file carries a measured `lead` (ms) and the runtime picks
    the container itself to apply it: the first the bank lists that the browser plays
    (`canPlayAudioFormat`), as howler did with a sprite's `src`. Checked in the
    browsers by decoding sprite and banks with Web Audio and locating every region: Chromium
    ogg/m4a/mp3 and WebKitGTK ogg land on the sample. WebKitGTK MP3 sits 1105 samples earlier
    than its OWN decode of the sprite, because GStreamer ignores the sprite's gapless header
    (it played every MP3 region 25 ms late); from a bank it starts where Chromium and FFmpeg
    do. `--check` re-cuts and compares byte for byte.
  - **What loads** (`apps/lines/src/game/stockSounds.ts`): a bank loads when the game's DATA
    names one of its sounds (`SoundCatalog.stock`, written by the export from the same walk as
    the library), the engine's CODE plays one (`CODED_STOCK_SOUNDS`, the `always` rows of
    `stockSoundRules.ts`, held to every source literal by `check-stock-sound-coverage.mjs`), or
    a SLOT resolves to one (as `activeSounds()` does). The data half comes from the export and
    the other two from the runtime, because a snapshot keeps booting on later releases.
    A stock sound the project replaces with its own upload is not loaded.
  - **Every doubt loads every bank:** no list (a bundle exported before this, or a project with no
    saved layout), a list of another `STOCK_SOUND_REACH_VERSION` (bump it when the runtime gains a
    sound source the export does not read), a flow other than the bundle's (the dev opt-ins), or
    a game repo whose `static/` still holds the old sprite.
  - **The chain:** the runtime release publishes `assets/audio/stock/` (and now sends `audio/mp4`
    and `audio/ac3`). A standalone build gets the banks from `pull:assets`: a game repo's
    `static/` is a scaffold-time copy, so `lib/stockAudioRefresh.mjs` replaces its old engine
    sprite with the banks before the build (a sprite naming a sound the engine never shipped is
    the game's own and is left alone). 🗜 Optimize trims each bank to the requested containers
    and lists them in that order, mp3 first, because the launcher then drops every non-mp3 file
    (a runtime trying ogg first would have asked for a file the build no longer has). The game
    build then leaves out the banks the game never plays, files and manifest entries
    (`stockSoundBuild.ts`, the boot's own decision on the baked bundle, run by `config-vite`
    `stockAssetPrune.js` beside the stock art); the build breakdown lists them under "Stock
    sounds the game never plays". Delivery is the same build; bank files resolve beside
    `sounds.json`, as the sprite's did.
  - **Desktop build, overlay-buffaloduel** (☁ Publish, 🗜 Optimize: its audio steps run for real
    over the published snapshot, then the real `build-breakdown.mjs`): Sounds **18 files,
    6.15 MB → 31 files, 3.46 MB**. The stock audio was the whole sprite as one 4.90 MB mp3 ("even
    music"); it is now 14 bank mp3s, 2.09 MB. `bgm_main` and 19 other banks are left out; the
    free-spin bed (the `freeSpinMusic` default) and the win beds (played by code) stay, because the
    game can still play them. The "before" is the owner's own figure to the byte count. The
    remake: 4 files, 8.10 MB → 21 files, 7.25 MB (stock 4.90 → 4.00 MB; it reaches 18 banks).
  - **Containers.** An Optimize build ships mp3 only, and every browser plays it. Without
    Optimize all four ship and the runtime picks ogg (Chromium, Firefox, WebKitGTK, a Safari that
    plays Ogg) or m4a (a Safari that does not); mp3 only where neither plays, ac3 never. So ogg
    and m4a are the two a full build needs; mp3 and ac3 are dead weight there, but trimming is
    Optimize's job and stays opt-in.
  - **Measured online, stock audio downloaded and all audio decoded at boot, before → after**, on
    every published game booted from its snapshot: Chromium through the harness's hook on audio
    XHR bytes and `decodeAudioData` output, WebKitGTK from the files it fetched and their decoded
    length (44.1 kHz stereo float). Both browsers pick ogg. A game's own sounds are unchanged.

    | Game | Stock banks | Stock MB | PCM MB, Chromium | PCM MB, WebKitGTK |
    |---|---|---|---|---|
    | overlay-buffaloduel | 14 | 3.73 → 1.90 | 177 → 94 | 147 → 64 |
    | bookofborutremake, borut-pots-sample | 18 | 3.73 → 3.47 | 223 → 197 | 223 → 197 |
    | commonoverlayproject, overlay-wallstreet, -wallstreet2, -wishworld, rocketreskintest1 | 17 | 3.73 → 3.41 | 147 → 118 | 147 → 118 |
    | getting-hot, holdandwintestsolo, test-card | 16 | 3.73 → 3.39 | 144 → 114 | 144 → 115 |
    | cloud, hw-3pots-sample, particlespin, test1, test2 | 19 | 3.73 → 3.50 | 144 → 119 | 144 → 119 |
    | test6 | 19 | 3.73 → 3.50 | 205 → 180 | 205 → 180 |
    | salmons | — | no audio: it refuses to boot without a game server, both sides | | |

    WebKitGTK's buffaloduel figure is lower because this GStreamer cannot decode the project's m4a
    sounds, before and after alike. Safari was not measured: it plays the first container a bank
    lists that it answers `canPlayType` for, ogg where it plays Ogg Vorbis, else m4a (mp3 in an
    Optimize build), each with that file's own lead.
  - **Proof.** The current-games harness on all 18 published games, every scenario, main's
    runtime (`5122d0d`) against this branch's, the branch's stock list in each bundle: 15 games
    pass with **0 changed screens**, and across 3,729 sound plays the two sides' sequences (name,
    stock or project, frame) are identical, with no missing-sound warning and no load error.
    The remake still returns to the stock `bgm_main` after a win bed, at the same frame. cloud,
    salmons and test-card do not play under the harness on either side (the same stall at the
    same step, a refusal without a game server, a card game under the slot script), so only their
    boots compare, and those match. Five games republished during the run were measured on their
    new snapshots. Fixtures, each with planted mutants:
    `stockSounds.fixture.ts` (claims 1–6 on the real rule and the shipped manifest, 11 mutants),
    `check:sound-reachability` (stock list, 3 more mutants), `check-stock-audio-build.mjs`
    (refresh, optimize and its order, 8 mutants), `check-stock-sound-prune.mts` (the build keeps
    exactly what the boot loads, the prune; 7 mutants), `check-build-breakdown-desktop.mjs`,
    `check-stock-sound-coverage.mjs`.
  - **Not done:** `scripts/author-sfx-btn-stop.mjs` predates the split and works on the other
    apps' sprites only. A desktop build opened in live mode (`?project=…&k=…`) or with a dev flow
    opt-in may want a bank its build left out; that sound is silent there, as left-out art is.

- 2026-11-12 — **Publish blocks every draft the build ships** (branch
  `launcher-sound-gate-ships`, committed locally, not pushed; owner-approved). Closes open item 5.
  The gate read config, symbols and the flow through its own collectors, so it never saw a sound
  chosen on `/sound` (`SoundsDoc.bindings`) or a cinematic cue: 27 shipped drafts on 7 projects
  went out unblocked.
  - **The rule.** `checkSoundsForPublish` asks the export's question:
    `resolveSoundBindings` → `collectPlayedSoundNames` → `shippedSoundEntries`, the three calls
    `exportProjectSounds` makes. A draft blocks when the build ships it, and licences cover what
    ships. So every place the export finds a name counts: the `/sound` choices (a silenced slot's
    kept names too), flow cues (the whole function library), screen timelines, components,
    cinematic cues and their `pick` alternates. **Engine-named drafts block:** the export ships
    them because they replace a sound the engine plays from its own code, and that is the re-skin
    most in need of review. `soundExport.ts` and `soundReachability.ts` are untouched (the
    sprite-split branch reshapes both). The gate's old collectors (`collectSoundBindings`,
    `slot`/`winTier`/`symbolSoundBindings`, `analyseSoundUsage`) had no other caller and are gone.
  - **When unsure, the gate answers what the export does.** The sounds doc cannot be read: the
    export ships no library sound, so nothing blocks. Any other source cannot be read, a cinematic
    is only partly read, or a flow cue builds its name at run time: the export ships every sound,
    so every draft blocks. A run-time name can be any of them, and an unreadable document may name
    any of them; a transient failure costs a retry or "publish anyway", where staying quiet would
    let an unreviewed sound out unnoticed.
  - **`/sound` lists the same drafts.** The server streams the export's walk of everything but the
    page's own choices (`shipsElsewhere`, unawaited: from this container it takes 4–19 s,
    cinematics most of it); the page adds its live choices with `soundBindingNames`, which reads a
    choices block as the export's `collectSoundNames` does. `checkSoundLibrary` takes the answer
    as `ships`: "unbound" and the not-approved list follow it, "missing" and "not rebindable" stay
    about the bindings. Until the walk lands the page says "Still reading the rest of the game…"
    and falls back to the bindings; when the export cannot tell, the page says so. A row nothing
    on the page binds but the build ships reads **ships**, no longer "unused". The
    not-approved line now reads "N sounds the game ships are not approved … Publish stops on
    them".
  - **Measured read-only on today's R2:** **27 drafts on 7 projects newly block**, exactly the
    item-5 list, and no draft stops blocking. overlay_buffaloduel 4 → 15 (`small_explosions`,
    `rocket_Fire`, `reel_stop_1`, `counter_loop`, `spinification`, `big_win_awesome`,
    `big_win_big`, `big_win_fantastic`, `scatter_first`, `scatter_other` from `/sound` choices;
    `gearpile-explosion-3-386885` from a cinematic). overlay_wallstreet, overlay_wallstreet2,
    overlay_wishworld, commonoverlayproject, rocketreskintest1 0 → 3 (`small_explosions`,
    `rocket_Fire`, `gearpile-explosion-3-386885`). test6 1 → 2
    (`magiksolo-pirate-tavern-full-version-167990`). bookofborutremake and borut_pots_sample
    unchanged at 1. On buffaloduel, test6 and overlay_wallstreet the page's list, computed with its
    own functions on the real docs, equals the gate's (15, 2, 3).
  - **Proof.** `check:sound-reachability` §6 (Lint): over five scenarios (the fixture project, a
    run-time flow name, an unreadable layout, a partly read cinematic, an unreadable sounds doc) the
    real gate blocks exactly the drafts the real export ships, and `/sound`'s list equals it. A
    `/sound`-only, silenced-slot-only, cinematic-only, `pick`-only, flow-only and engine-named draft
    each blocks; an unnamed draft and an approved shipped sound do not. 8 planted gate mutants and 1
    page mutant are caught (56 claims). `check:sounds-doc` §16 pins `ships`. 8 source mutants
    planted by hand in `soundPublishCheck.ts` and `soundUsage.ts` were each caught.
  - Not done: the gate does not skip an orphaned entry (a doc row whose file is missing in R2),
    which the export's copy loop drops; such a draft blocks though nothing ships. ⏳ The streamed
    list was not seen in a signed-in browser: the server render shows the waiting line, and the
    resolved list is held by the fixture and the real-doc comparison.

- 2026-11-12 — **Flow cues count: `/sound` lists them, and Publish blocks a draft only the Flow
  plays** (worktree branch, committed locally, not pushed). Closes the old open item 5, found by
  the reachability work below. `flowSoundBindings` (`soundUsage.ts`) read `flow.nodes`, which no
  FlowDoc has, so it returned nothing on all 20 projects with a flow (overlay_buffaloduel: 0,
  where `doc.graph` holds 3 cues and its `holdAndWin` mode 5). Its fixture fed it a bare
  `{ nodes }`, the same wrong shape, so it passed.
  - **One home.** `$lib/flowSoundCues.ts` holds the walk `soundReachability.ts` already did
    (structural: every `{ nodes, data }` pair, so the flow's graph, each mode's, a group's body at
    any depth, a library function's body) and one rule for a sound pin: declared by a vocabulary,
    or holding a sound-enum literal. A wire, an accessor or a data edge into the pin makes the
    name a run-time one: the export then ships every sound and the usage index lists nothing (an
    edge wins over the node's literal in `resolveDataIn`). `namesSoundAtRunTime` and
    `flowSoundBindings` both read it; neither keeps a copy.
  - **The library.** The usage index and the gate count only the library functions the flow
    calls, and those they call: the library is shared, and a function nothing calls plays
    nothing here. The export still reads it whole (uncertainty keeps). Today it holds one
    function, `StaggerStop`; it has no sound cue and no flow calls it, so no number changes.
  - **Labels.** A row now says where the node sits: `soundMusic · fireCue-1 (holdAndWin mode)`,
    `… (freeSpins mode › group Outer)`, `… (function Fanfare)`. A cue in the flow's own graph
    reads as before.
  - **A stricter gate (owner-approved).** `checkSoundsForPublish` reads the flow and the library
    through the same walk. Measured read-only on today's R2 docs (20 projects with a flow, 9 with
    a library, every library sound a draft): `/sound` lists 0 → 5–9 flow cues on 16 projects, and
    **7 drafts on 4 projects now block Publish** until approved, none of them blocked before:
    overlay_buffaloduel `loader_music` and `background_music` (flow graph),
    `prizes_to_win_awesome_fantastic` and `medium_pay` (holdAndWin mode); bookofborutremake and
    borut_pots_sample `playlistsons-wild-west-466301`; test6
    `art_roseman-swing-big-band-600073`. The other library projects' flows play engine sounds only.
  - **Proof.** `check:sounds-doc` §15 runs over a real FlowDoc (graph, a mode, groups nested in a
    mode, a called function and one it calls, an uncalled one, an edge-overridden literal); 9
    planted mutants each caught, among them "reads `flow.nodes`", "the flow's own graph only",
    "skips the mode graphs", "one level of groups only" and "reads the whole library".
    `check:sound-reachability` §6 runs the real `checkSoundsForPublish` over the mocked storage
    (42 claims). 11 source mutants planted by hand in `flowSoundCues.ts`, `soundUsage.ts` and
    `soundPublishCheck.ts` were each caught by one of the two.
  - **Rendered.** The built `/sound` page, rendered server-side with overlay_buffaloduel's real
    docs, lists its 8 flow cues with their placement labels, and the 4 drafts the flow plays show
    a "Flow:" use in their "played by" chip. The page's data shape is unchanged. ⏳ Not
    click-tested in a signed-in browser.

- 2026-11-12 — **A game ships only the sounds it can play** (worktree branch, committed locally,
  not pushed). The owner: _"We are also shipping sounds and music that we are not using in the
  final game; this should get the same treatment as the art assets."_ `soundExport.ts` copied
  every library entry, drafts and unused takes included, into `deploy/sounds/` and the catalog.
  That cost players, not just storage: `bakedSoundBanks` makes one preloaded `Howl` per catalogued
  sound when `EnableSound` mounts, so each one was downloaded and decoded at boot.
  - **The rule** is `soundReachability.ts`, beside `clipReachability.ts`. An entry ships when the
    engine's own code may play it (`SOUND_NAMES` and the slot defaults: an upload under such a
    name replaces the shipped region with no doc naming it) or when any game data names it. "Names"
    is the build breakdown's "uses" walk over every string, plus the sound inside a timeline cue
    (`sfx:` / `music:` / `stop:`, read with the runtime's own `cueSoundOf`).
  - **Sources:** the `/sound` choices as the export resolves them, the config and symbols docs
    whole (legacy cues, `winLevels[].sound`, a mode's `music`), and the layout doc (screen
    timelines, the `win` instance's `<alias>Sfx` / `<alias>Bgm`, a reel grid's anticipation
    `sound`). Also every component def, the exact versions the layout pins, and the per-project
    param defaults. Then the flow (graph, modes, groups), the shared function library, and the
    cinematics (cues and `pick` alternates).
  - **Not sources:** FX (plays no audio), rig events (broadcast by name; the skeleton's `audio`
    field is read by nothing), win text, localization, fonts, shaders. The fixture scans for the
    first two.
  - **Uncertainty keeps.** These ship every sound: a source that throws, a partly read cinematic
    list, or a flow sound cue fed by a wire, an accessor or an edge. A library of engine names
    only reads nothing else. The runtime pass hands over its cinematics; a route call (the bake)
    loads its own.
  - **Measured** on the 18 published versions (read-only R2), and again after most were
    republished an hour later, with the same numbers. 7 have a library. 6 ship two
    firework SFX nothing names, 101,080 B and 6.2 s (≈ 2.3 MB decoded per player):
    overlay-buffaloduel 17 → 15 sounds (1,636,088 → 1,535,008 B); commonoverlayproject,
    overlay-wallstreet, overlay-wallstreet2, overlay-wishworld and rocketreskintest1 5 → 3
    (239,700 → 138,620 B). bookofborutremake, borut_pots_sample and test6 already ship only what
    they play. The branch rule run against today's R2 docs drops exactly what a walk of each
    frozen snapshot calls unnamed, and never a sound the snapshot names. The walk took 5–24 s from
    this container (cinematics 20 s of it, already loaded by the runtime pass).
  - **Proof.** `check:sound-reachability` (Lint's launcher gates): 40 claims, 14 planted rule
    mutants each caught, and 6 source mutants caught by hand.
    The current-games harness ran the 6 affected games, every `bookOf` scenario (pots included),
    in determinism mode. Base was the published snapshot and branch the same snapshot as this
    export writes it, on one runtime (this change touches no runtime input). Every `Howl` bank and
    every play was logged by name, bank and frame: 42 scenario pairs, 1,715 plays, identical
    sequences, 0 sound warnings, 0 load errors, 0 errors or stalls, and "6 pass · 0 changed
    screen(s)". The logs show why each source is load-bearing: `gearpile-explosion` plays only
    from a cinematic cue and `medium_pay` only from the `holdAndWin` mode graph. The other 12
    games' export is unchanged byte for byte (same catalog, same files); bookofborutremake and
    test6 were also run (`big-wins`, `free-spins`) on their newer snapshots: same plays, 0 changed.
    Web fonts drew in the fallback face on both sides: the Typekit mirror is missing from R2 and
    this container cannot reach Adobe.
  - **The shipped audiosprite: not gated.** The 2026-09-23 premise does not hold. 17 of 18 games
    reach `bgm_main` through the `baseMusic` slot default, and bookofborutremake is one of them:
    its own track starts from a flow cue, but its `baseMusic` slot is unset, so the engine's
    returns (after a win-level count-up, at the free-spin end) ask for `bgm_main`. The harness log
    shows it: the remake opens on its own track (frame 122), and after its first big win
    (`bgm_winlevel_big`, frame 1900) it plays `bgm_main` (frame 2280). test6, with two tracks of
    its own, plays `bgm_main` too. All 18 reach `bgm_freespin` (the `freeSpinMusic` default,
    often a flow cue too). A "has music of its own" gate would silence those returns. A
    reachability gate is safe, but today it frees only overlay-buffaloduel's `bgm_main`: 132.5 s,
    ≈ 1.21 MB ogg / 1.36 MB m4a, ≈ 47–51 MB decoded. The larger cost is the sprite itself, 408 s
    decoded whole (≈ 144–157 MB of PCM per player). Per game, 26.5–175 s of it is named by no
    data, no resolved slot and no coded call: buffaloduel 175 s (≈ 1.6 MB ogg, ≈ 62–67 MB
    decoded), the rest 26–38 s.
  - **Plan, not done:** split the sprite into separately loadable files (music beds each on their
    own, SFX together), re-encoding the four containers. Have the export compute the reachable
    stock cues (this walk plus slot resolution) and carry the list in the catalog, with absent
    meaning load everything. The runtime loads only listed files. Prove it with this play log,
    because the harness compares pixels and a silenced bed draws nothing. It edits the shared
    runtime, so it re-points every online game on merge.
  - Done the same day, by stream copy rather than re-encoding: see the entry above.

- 2026-10-28 — **A Hold and Win coin can sound as it lands in the total** (branch
  `claude/fervent-ride-ccp7qf`, in review). Asked for a sound on the coin collect at the end of
  the respins: the end tally (`presentHoldAndWinEnd`) flew every coin into the Total Win bar
  silently, and nothing could bind one (no slot, and Flow cannot listen to `respinTallyStep`).
  `/sound` now has a **Hold and Win coins** section: every symbol with a Hold and Win role but
  `blank` and `meterSpecial`, one moment, `COIN_COLLECT_SOUND_MOMENT` (`collectToTotal`) in
  `engine-layout`'s `soundLibrary.ts`, stored in the coin's `bindings.symbols` row like the token
  moments. The tally's per-coin landing (`step`) plays it through `playCoinCollectSound`, forced so
  every coin is heard. Layer 1 only: unbound ⇒ silent, so no current game changes. The per-symbol
  grid now hides a row that holds only this cue, and its × clears the grid's own states only. Gate:
  `check:sounds-doc` round-trips the cue. ⏳ Not heard in a live game yet.

- 2026-10-27 — **Invisible Director can re-point a project's cues** (Director card 9H,
  [ADR-0011](../director/DECISIONS/0011-reskin-adapters-sound-fx-components.md), PR #1413, in
  review). Two adapter ops for the builder agent, `sound.get_doc` and `sound.set_cues`
  (`apps/launcher-api/src/lib/server/director/ops/sound.ts`), save through `saveSoundsDoc` with
  `baseEtag`. They bind only the moments this page offers (`$lib/soundMoments.ts`, now shared with
  the loader, which also moved `symbolCueStates` there) to built-ins or **approved** library
  sounds. They never approve a sound, re-enable a silenced slot, upload a file or add a moment. A
  doc with no `bindings` block has the legacy choices carried over on the first save
  (`soundLegacy.ts` `resolveSoundBindings`, now shared with `soundExport.ts`), and that write
  refuses if a legacy doc cannot be read. `loadSoundsDocWithEtag` gains an additive `corrupt`
  flag; the page and endpoint ignore it. Nothing changes for a person using `/sound`.
  - **Found on the way, not fixed here:** `soundPublishCheck.ts` collects bound names from config,
    symbols and flow only, never from `SoundsDoc.bindings`, so a draft chosen on this page may not
    block a publish. The owner is filing it as a pipeline bug. Director refuses drafts outright
    because of it.

- 2026-10-27 — **Timeline cues: component timelines play their sounds, and every sound cue takes
  options** (branch `editor/timeline-sound-cues`, in review). A component timeline's `sfx:` /
  `music:` cue used to be dropped at runtime (`routeComponentCue`: "no sound player"); it now plays
  on placed, spawned, symbol, win and nested instances alike. One function,
  `playCueSound` (`engine-layout`'s `cueSound.ts`), plays every timeline's sound cue — screen
  timelines and cinematics (`FlowV2Cinematics`) and component timelines (the sink
  `apps/lines`' `Sound.svelte` registers with `registerCueSound`; `engine-layout` still imports no
  audio). **Format:** a cue key `{ time, cue }` may carry an optional `sound` object; absent ⇒ the
  plain cue, which makes exactly the call it always made (`once.play({ name })` /
  `music.play({ name })`). A STOP is in the cue string, `stop:sfx:<name>` / `stop:music:<name>`, not
  an option: an older runtime plays every `sfx:` / `music:` cue on a screen timeline, so a stop
  option would start the sound after a rollback, while `stop:` only makes it broadcast `sfx:<name>`.
  Read through `readCueSound` (per-kind whitelist, clamped into
  `CUE_SOUND_RANGES`). **Shipped options:** SFX `volume`, `volumeJitter`, `rate`, `rateJitter`,
  `pan` (Web Audio only), `loop` (on the loop player, until a stop cue), `fadeIn`, `offset` (into
  the sound's own region), `overlap` (replay while playing; default skip, as before), `pick`
  (≤ 8 random alternates); stop cues with `fadeOut`; music `volume`, `loop`
  override, `fadeIn` as a crossfade, stop with `fadeOut`. **Dropped:** music "layer over the bed"
  (the music player holds one bed by design; layer with an SFX loop cue instead), "max
  simultaneous instances" (a player tracks one id per name — `overlap` is the honest switch), a
  `fadeOut` on a PLAY cue (it would need the sound's end time; fade out with a stop cue), and a
  signal payload (the component-signal bus carries none). `utils-sound` gained player `pan` /
  `loop` / `seek` / `level`, a per-play level on the loop player and a music `fade`; every existing
  caller is unchanged. Turbo/skip: neither path skips sound cues (the screen path never did).
  Gates: `check:timeline-cue-sound` (options read, editor/runtime parity, plain-cue parity, the
  save → export → embed → component player → sink chain) and `banks.fixture.ts` claim 10 (the
  options reach howler). **Behaviour change:** live projects with sound cues on component
  timelines start making those sounds; none exist in the repo's reference layouts or seeds.
  ⏳ Not heard in a live game yet.

- 2026-10-27 — **A pots overlay's tokens get their own sounds: land, take off, reach the pot**
  (branch `claude/fervent-ride-ccp7qf`, in review). Asked for a project whose overlay drops coins and
  rockets: neither could be given a landing sound, and a rocket needed one as it fires and as it
  explodes at the pot. The landing cue already played per token (`overlayPresentation.ts` →
  `playSymbolLandSound`), but `/sound`'s per-symbol rows offer only `symbolsInPlay` (the strips), and
  a token is never on a strip. `/sound` now has an **Overlay tokens** grid (tokens from
  `symbolsUsed` / `symbolUses === 'token'`, the `/symbols` Coins group's list) with three moments,
  `TOKEN_SOUND_MOMENTS` in `engine-layout`'s `soundLibrary.ts`: `land`, `flyToMeter` and `potArrive`
  (not a symbol state; stored in the same `bindings.symbols` row, so the doc, the export and the bake
  carry it unchanged). The runtime plays them in `presentMeterUpdate` (`holdAndWinPresentation.ts`):
  take-off in the flight's `onStart` beside `liftToken`, arrival when `flyTo` resolves (the head
  landing), both through `soundBindings.ts`'s `playTokenTakeOffSound` / `playTokenPotArriveSound`.
  Layer 1 only: unbound ⇒ silent, so no current game changes. A base-board special flying into a Hold
  and Win meter (not a token) is not covered. Gate: `check:sounds-doc` round-trips every token moment.
  ⏳ Not heard in a live game yet: bind the rocket's cues on `/sound`, export, and play a fill.

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
  - 2026-11-12: measured on the 18 published games, the "genuinely dead" premise does not hold.
    17 reach `bgm_main` (the `baseMusic` slot default, the remake included) and all 18 reach
    `bgm_freespin`. Still not done; the numbers and the plan are in the 2026-11-12 entry.
  - 2026-11-12, later: done, as banks loaded by reach rather than by "music of its own".
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
  exact wall the font, rig and flipbook imports already route around, and the fix is theirs: the
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
