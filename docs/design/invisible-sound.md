# Invisible Sound — design

> Status: [docs/status/sound.md](../status/sound.md) · Guide: [docs/tools/sound.md](../tools/sound.md)

The online tool (route `/sound`) that owns a project's **sound library** — the files, who made
them, whether they are approved to ship — and the **usage index** that answers the one question
nothing in this system can answer today: *which of my sounds is actually bound to anything, and
which moments are still silent?*

It does **not** move the bindings. See §2.3 — that is the load-bearing decision in this document.

## 1. Why this exists

### 1.1 Audio is the last asset class with no pipeline

Every other asset a project authors online travels the rule-8 chain — export → `deploy/` → bake →
pull → register. Sound travels none of it:

| Fact | Where | Consequence |
|---|---|---|
| The playable names are a hardcoded TS union | `apps/lines/src/game/sound.ts` (`MusicName` / `SoundEffectName`, 53 literals) | A new sound needs an engine edit — impossible for a project vendoring the engine as a submodule. |
| The audio is one audiosprite baked into the app | `apps/lines/static/assets/audio/sounds.{mp3,json}`, registered as `{type:'audio'}` at `assets.ts:272` | Every project ships the **same** sounds. There is no per-project audio. |
| The player builds **one** `Howl` | `packages/utils-sound/src/createSound.svelte.ts` — `new Howl({ src, sprite })` from a single `LoadedAudio` | Even a file that reached the game could not be played: playback is by *sprite key* into that one sprite map. |

So "upload a sound and hear it in the game" is not hard today, it is **structurally impossible**.
Phase 1 of this tool is therefore not a UI, it is the missing asset class (§3, §5). Everything
else is downstream of it.

### 1.2 A name that exists is not a name that plays

`docs/status/engine.md` (2026-08-25): **26 of the 53 sounds in every game's audiosprite had never
been played by any code path.** `tumble_win_1…5` — a five-rung ladder cut for the cascade pop —
shipped from the fork playing nothing, while appearing in the Flow editor's sound dropdown, which
is generated from the `SoundName` union (`packages/engine-flow-v2/src/reference/soundEnums.generated.ts`)
and therefore lists **names, not wiring**.

The slot work on that date fixed the *binding* half (`packages/game-config/src/sounds.ts` +
`apps/lines/src/game/soundBindings.ts`). It did not fix the *visibility* half: there is still no
surface that can say "this sound is bound to nothing" or "this beat plays a hardcoded literal you
cannot re-bind". That surface is §7, and it is the reason this is a tool rather than a folder.

### 1.3 Silence is an invisible failure — so approval must NOT gate playback

Howler declines an unknown sprite key **silently**. A missing sound is not an error, a warning, or
a visible defect; it is nothing at all. That single fact drives two decisions in this design:

- the approval model is inverted relative to `/localization` (§6);
- the usage index carries a *bound-but-missing* check (§7), because that is the only way a typo
  ever becomes visible before a player hears the gap.

## 2. What this tool owns — and what it does not

### 2.1 It owns the LIBRARY

Files, upload/replace, audition, per-sound metadata, provenance, approval state. One name space
per project, sectioned for browsing (music / reels / symbols / wins / UI / free spins / …).

### 2.2 It owns the CHOICES

Which cue plays at each of the game's named moments, in categories: the game-wide slots, the
per-symbol exceptions, the anticipation tease, the win tiers. Authored here, saved into the same
doc as the library, resolved into the bundle by the export.

### 2.3 It owns the usage index

A read-across of every sound name the game asks for, checked against the library. Its job is to
name the failure you cannot hear: a bound name the project does not have, a sound nothing plays, a
played sound nobody approved. §7.

### 2.4 It does NOT own the flow cues

A cue node on the flow graph has wires, a condition and a position in a sequence. Editing it
anywhere else means editing it blind, so it stays in `/flow-v2` and this tool lists it read-only.

That is the only exception. **Everything else moved here**, and the earlier draft of this section
argued the opposite — that a binding belongs next to the thing it describes, one fact one home.
The argument was wrong about which fact. "What plays at the reel stop" is not a fact about the reel
stop; it is a fact about the game's audio, and the game's audio was scattered across three tools
none of which could hear it. The concrete cost:

- `tumble_win_1…5` shipped in the audiosprite from the day of the fork and no code path ever played
  a rung. The names appeared in the flow editor's dropdown (generated from the `SoundName` union,
  which lists names, not wiring), so the sound looked bound while the board popped in silence.
- 26 of 53 audiosprite regions had never been played by anything.
- Choosing a game's audio meant opening `/config`, `/symbols` and the Scene Editor, knowing which
  one owned which moment, and having no way to hear any of them.

| What | Where it was | Where it is |
|---|---|---|
| Game-wide slot (`reelStop`, `tumbleExplosion`, …) | `/config` → Sounds (`GameConfigDoc.sounds`) | `/sound` → Game moments |
| Per symbol × state | `/symbols` (`SymbolsDoc.symbolSounds`) | `/sound` → Per-symbol cues |
| Anticipation sting + loop | `/symbols` → Reel anticipation | `/sound` → Reel anticipation (the per-tier VOLUMES stay in `/symbols`: they are the intensity ramp, not a choice of sound) |
| Win-tier `sfx`/`bgm` | `/config` win tiers + the `win` component's `<alias>Sfx`/`<alias>Bgm` params | `/sound` → Win tiers |
| One-off graph cue | `/flow-v2` | unchanged — listed here, edited there |

### 2.5 The migration is whole-doc, and one-way

`SoundsDoc.bindings` absent means "this project has not authored here yet", and the fallback reads
the old docs — so the page opens on what the game actually plays rather than an empty form. The
first save writes the block and the fallback never runs again.

Whole-doc, never per-field (`effectiveSoundBindings`). A per-field merge would resurrect a cue the
author deliberately cleared here out of the config doc that still holds it, and there would be no
gesture that means "no, really, nothing" — which is the exact class of invisible failure this tool
exists to end. An **empty** block is still a block.

The old fields stay in their schemas and are still read at runtime BELOW the sound doc, so a game
that shipped before the move keeps sounding the same until someone opens the tool. Only the
authoring UI was removed.

## 3. Banks — how an uploaded sound becomes playable

### 3.1 The model

`LoadedAudio` (`packages/pixi-svelte/src/lib/types.ts:15`) is `{ src, sprite, config }`, and
`createSound.load()` turns exactly one of them into exactly one `Howl`. The change is to make
`load()` take an **ordered list of banks**:

```ts
sound.load([builtinBank, projectBank, ...looseBanks]);
```

- each bank keeps its own `Howl`;
- a name resolves to the **last** bank declaring it, so a project sound overrides a builtin of the
  same name — the same last-wins rule `mergeBakedFontCatalog` already uses for fonts, for the same
  reason;
- an uploaded loose file is simply a one-entry bank (`sprite: { name: [0, durationMs] }`).

The play paths (`createPlayOnce` / `createPlayLoop` / `createPlayMusic`) currently close over a
single `howl` and call `howl.play(soundName)`. They take a **resolver** instead —
`bankFor(name).howl`. That is the whole engine change, and it is contained to `packages/utils-sound`.

`EnableSound.svelte:15` is the register seam: it already reads `loadedAssets['sound']` and calls
`sound.load()`. It gains the merge, exactly as `Game.svelte:602` merges the baked font catalog over
the built-in one.

**Why banks rather than repacking a per-project audiosprite server-side:** a repack needs ffmpeg in
`services/atlas-backend` before an uploaded sound is audible at all, and a v1 whose upload button
works but whose result cannot be heard is a v1 that stalls. Packing stays on the roadmap as an
*optimisation* (§10), not a precondition. Banks make it optional forever.

### 3.2 The five traps

1. **`hasSound()` must span every bank.** Today it reads `loadedAudio.sprite[name]`. Left
   single-bank it would report a project sound as missing — and it is the one probe that exists to
   make silent failures visible.
2. **`destroy()` unloads per bank, once.** It currently calls `unload()` on the three players'
   `howl`, which is the same object three times. With N banks that becomes N unloads, not 3N.
3. **`config[name].volume` is per sound and has no default in the type.** An uploaded entry needs
   one written explicitly (1) or the base volume is `undefined` at play time.
4. **Music vs SFX is decided at the CALL SITE, not by the asset** — `players.music` / `.loop` /
   `.once`. A library entry carries a `kind` for sectioning and for validating a binding, but the
   runtime keeps choosing the player. Do not let the asset start dictating it.
5. **Mobile decode cost is per Howl.** 50 loose banks is 50 decodes on a phone. Acceptable while a
   project has a handful of overrides; it is the pressure that eventually justifies §10's pack step.
   The tool should show the count and the total bytes.

## 4. The doc

```
<client>/<project>/sounds/sounds.json          ← the library doc
<client>/<project>/sounds/files/<id>.<ext>     ← uploaded source files
```

```ts
type SoundsDoc = {
  version: 1;
  updatedAt: string;
  entries: SoundEntry[];
  bindings?: SoundBindings;   // WHAT PLAYS WHEN — absent ⇒ read the old homes (§2.5)
};

type SoundBindings = {
  slots?: Record<SoundSlotId, { names?: string[]; volume?: number; enabled?: boolean }>;
  symbols?: Record<string, Record<string, string>>;   // symbol → state → name
  anticipation?: { activation?: string; loop?: string };
  winTiers?: Record<string, { sfx?: string; bgm?: string }>;
};

type SoundEntry = {
  id: string;              // stable, never the display name
  name: string;            // THE PLAYABLE NAME — what a binding stores
  kind: 'music' | 'sfx';   // sectioning + binding validation (§3.2 trap 4)
  section?: string;        // browsing group: 'Reels', 'Wins', 'UI', …
  file: string;            // relative to sounds/files/
  durationMs: number;      // → the sprite region's LENGTH; must be > 0
  volume?: number;         // base volume 0..1 → LoadedAudio.config
  loop?: boolean;          // → the third element of the sprite tuple (see below)

  status: 'draft' | 'approved';
  reviewedBy?: string;
  reviewedAt?: string;
  notes?: string;

  origin: 'ai' | 'commissioned' | 'library' | 'builtin';
  model?: string;          // when origin === 'ai'
  author?: string;         // musician / studio
  license?: string;
  licenseUrl?: string;
};
```

**`loop` is a boolean, not a range** (corrected while building S1). Looping is expressed in exactly
one place — the optional third element of a howler sprite tuple, `[start, durationMs, loop]` — which
is why `createPlayer`'s `loop` option turned out to be dead. There is no sub-region loop to author,
so a `loopPoints` pair would be a field the runtime could not honour.

**`status` and `origin` default rather than being required**, and their defaults are chosen so that
absence never reads as a claim: an unreviewed sound is a `draft`, and an unstated provenance is
`library` — the one value that asserts nothing about who made it, so a missing field cannot launder
an unlicensed upload into a signed-off one.

`name` is the join key to every binding in the system, and it is therefore **rename-hostile in the
same way a sheet region is** (`docs/design/invisible-flipbook.md` → "Referential integrity"). A
rename must either be refused while the name is bound, or offered as a *rewrite* that updates the
bindings block and reports the flow cues it cannot touch. Silently allowing it reproduces the FX
`art.frames[]` dangling-ref class, and here the failure is inaudible. (Cheaper now that the
bindings live in the same doc: the rewrite is one save, not three.)

**Every level of `bindings` is sparse, and empty is dropped on save.** `{}` and absent must read
the same to a runtime, or a project that authored a cue and then cleared it reads as
authored-with-nothing — which is silence, not a default. The one exception is `enabled: false`: it
is the gesture that MEANS "play nothing here", so a choice carrying only that survives alone. A
slot's `names` are stored only when they DEPART from the catalogue, so a project matching the
defaults keeps tracking them when they improve instead of freezing today's copy.

## 5. Chain (rule 8 — export → bake → pull → register)

Unlike `/win-text` and `/localization`, this tool ships **real assets**, so it needs the full chain.
Mirror `fontExport.ts` verbatim — it is the closest analogue (files + a catalog index):

1. **Path** — `projectPaths.ts`: `SUB.sounds(c,p)` → `<client>/<project>/sounds`.
2. **Storage** — `lib/server/soundsStorage.ts`: Zod schema, `normalizeSoundsDoc`, load/save.
   **Conditional writes** — §5.1.
3. **Export** — `lib/server/soundExport.ts` copies each entry's file plus a catalog into
   `<client>/<project>/deploy/sounds/<file…>` + `deploy/sounds/index.json`. Prunes leftovers from a
   previous export; idempotent. **The catalog also carries `bindings`** — the export is the one
   place that can see the sound, config and symbols docs at once, so it settles the §2.5 fallback
   there and the bundle ships a single answer instead of asking every runtime read point to
   re-derive it from documents it may not have.
4. **Bake** — `bake-editor-doc.mjs` triggers the export and embeds the catalog in the bundle.
   ⚠️ **And `lib/server/runtimeBundle.ts` too.** They are separate assemblies; a new baked-data class
   added to only one of them ships empty — the exact way `effects`/`rigFx` once did.
5. **Pull** — `pull-project-assets.mjs` mirrors `deploy/` → `static/assets/`; file names preserved
   verbatim so the catalog's relative references resolve.
6. **Register** — `bakedSoundCatalog()` in `editor-scenes.ts` (runtime → baked → undefined), merged
   into the bank list at `EnableSound.svelte`. The CHOICES ride the same accessor:
   `bakedSoundBindings()` feeds `publishSoundBindings()` at boot (`Game.svelte`, next to
   `publishWinPresentation`) so the slots and win tiers resolve from it, and
   `bakedSymbolSounds()` / `bakedAnticipationSounds()` read it directly. Absent ⇒ every one of
   them falls through to the config/symbols/coded path it used before.

**Parity is the acceptance test:** with no sounds doc, the bank list is `[builtinBank]` and the game
is byte-identical to today.

### 5.1 Conditional writes (`docs/design/multi-user-concurrency.md`)

The page loads the whole doc and PUTs the whole doc, so an unconditional write means the second
author to save erases the first's library. Follow the live convention — `r2.ts`
(`getObjectTextWithEtag` / `precondition` / `ConflictError` / `jsonBaseEtag`), body
`{ doc, baseEtag?, force? }`, **409 via `json()`, never `error()`** — with `editorStorage.ts` and
`api/flow-v2/save` as the exemplars.

> Do **not** mirror `symbolsStorage.ts` / `localization.ts`. They are the un-migrated legacy tier;
> copying them forward is how a new tool ships another unguarded `putObjectText`.

Report `existed` separately from the doc: a missing object and a present-but-corrupt one both
degrade to an empty doc but need opposite preconditions, and collapsing them gives a corrupt
`sounds.json` a permanent 412 with no way out from the UI.

## 6. Approval + provenance

The shape comes from `/localization` — `reviewed` on each entry, a review pass, a gate. **The gate
does not go in the same place.**

`/localization` gates the *runtime bundle*: `runtimeBundle.ts:243` drops unreviewed text unless
`includeUnreviewed` (set only on an authoring boot). That is safe because an unreviewed string
falls back to English — visible, wrong-language, obviously provisional.

An unapproved **sound** has no fallback. It falls back to silence, and §1.3 is the whole point:
silence is invisible. A reviewed-only bundle would ship a game that is quietly missing cues, and
nobody would find out in QA.

**So: approval gates PUBLISH, not playback.**

- A `draft` sound plays everywhere — dev, test server, authoring boot, player boot.
- `/game-maker` publish **refuses** when a sound that is *bound* to something is still `draft`,
  listing them, with an explicit `allowUnapproved` override for a deliberate test build.
- An unbound draft never blocks anything. That is what a library is for.

**Provenance is not decoration.** `origin` / `model` / `author` / `license` exist because sounds now
arrive from AI models and external musicians, and a non-commercial-licensed cue sitting in a shipped
slot is a worse problem than a wrong one — the same hazard already recorded for the image side
(Qwen vs FLUX-dev). Publish should surface the license summary of everything bound, once.

## 7. The usage index

The read-across table, assembled from every binding surface plus a scan of what is still coded:

| Source | Read from | Editable here? |
|---|---|---|
| Game-wide slots | `bindings.slots` + the `SOUND_SLOTS` catalogue defaults | **yes** — Game moments |
| Per symbol × state | `bindings.symbols` | **yes** — Per-symbol cues |
| Anticipation cues | `bindings.anticipation` | **yes** — Reel anticipation |
| Win tiers | `bindings.winTiers` | **yes** — Win tiers |
| Flow cues | the FlowDoc's sound-cue nodes | **no** — jump to node |
| **Not rebindable** | derived: shipped audiosprite names that NO surface above binds | **no** — informational |

That last row is the one that earns the tool. `soundBindings.ts` established "no literal below this
file" for the beats it covers, but plenty remain (`sfx_btn_spin`, `bgm_main`, the win-level family,
…). Listing them honestly turns "which beats are not authorable yet" from archaeology into a table,
and each entry is a candidate for promotion into `SOUND_SLOTS`.

> **Corrected while building S7.** This row originally specified *"a generated scan of the remaining
> hardcoded names in `apps/lines/src`"*. Built, that scan was wrong twice over: it counted the
> `SoundName` union's own declaration (all 53 names, in one file) and the slot catalogue's defaults
> (19 more) as "hardcoded", and it matched names inside comments — including one in `banks.ts`
> written earlier in this same build. **Subtracting the bound set from the shipped set answers the
> question exactly**, with no scanning, no generator and nothing to keep in sync: a shipped sound
> that no slot, symbol, tier or flow cue names is, by construction, one only code can reach. It is
> also project-accurate — bind `bgm_main` in your flow and it leaves the list.

**The index is derived from what is on the page, not from the server's read of the docs.** Every
count, chip and warning therefore answers for the state on screen now. A server-side index would be
one save behind every edit, which on a tool whose whole job is to surface inaudible mistakes would
be a tool that lies until you reload.

Three checks fall straight out of the index:

- **Unbound** — a library sound no binding references. This is the `tumble_win_*` class.
- **Bound-but-missing** — a binding naming a sound no bank declares. Uses `hasSound()` across banks
  (§3.2 trap 1); the only defence against a typo that is otherwise inaudible.
- **Unapproved-but-bound** — the publish gate (§6), shown before you reach publish.

## 8. Retire the generated enum

Every sound dropdown in the launcher today reads `soundEnums.generated.ts`, a codegen of
`apps/lines`' union. `docs/status/game-config.md` already flags this as stale for the win-tier
picker: *"the enum is the shipped `apps/lines` sound set — a game with its own `sounds.json` isn't
reflected yet."*

Once a project has a library doc, **every** picker reads it — `/flow-v2`'s inspector, `/config`'s
slot rows, `/editor`'s win tiers, `/symbols`' per-symbol and anticipation cues. One list, one source:
`apps/launcher-api/src/lib/soundOptions.ts`.

> **Corrected while building S9.** This section expected
> `scripts/gen-flow-v2-sound-enums.mjs` to **retire** with the union it mirrors. It cannot, and
> should not. Those 53 names are a real fact — which sounds a game has *before* it uploads anything —
> and the launcher has no other way to learn them: the sprite map lives in a game app's `static/`,
> which the launcher never reads. Both the usage index (§7) and the publish gate (§6) depend on that
> fact to tell a re-skin of a built-in from a sound nothing plays. What retired is its **role as the
> only source**: it is now the BASE of every picker's list, never the whole of it.
>
> The related claim — that the compile-time `SoundEffectName` union "stops being a contract" — did
> hold, and was already true: `validate.ts` checks an enum literal with `typeof value === 'string'`
> and has never tested membership, so a flow graph naming a project sound was always *valid*. It
> simply could not be authored through the UI. Widening the vocabulary's enums changes what the
> inspector offers and nothing else.

This is the actual unification, and it is cheap once §3 and §5 exist. It is also the point at which
the compile-time `SoundEffectName` union stops being a contract and becomes what
`soundBindings.ts` already calls it — a convenience for the coded call sites, cast once at the
boundary.

## 9. Build plan

| # | Step | Done when |
|---|---|---|
| **S1** | **Banks** — `utils-sound` takes an ordered bank list; `hasSound` spans banks; per-bank unload | `apps/lines` plays a second bank's sound; builtin-only path byte-identical |
| **S2** | Doc + storage + paths (`SUB.sounds`, Zod, normalize, conditional writes) | A doc round-trips through R2, and a stale `baseEtag` 409s |
| **S3** | Upload + audition endpoints (session+role gated) | A file lands in `sounds/files/` and plays back in the browser |
| **S4** | Chain — `soundExport.ts` → `deploy/sounds/`, both bundle assemblies, pull, register | An uploaded sound is audible in a **published** game |
| **S5** | `/sound` page — sections, library, audition, metadata, approval, `ToolTopBar` | Author + save online |
| **S6** | Registry + docs (rule 9) — `TOOLS`/`ROLE_TOOLS`/`TOOL_BAR_ORDER`/`TOOL_DOC_SLUG`, `docs/tools/sound.md`, `docs/tools/README.md` row, `docs/status/sound.md` | `/docs/sound` renders |
| **S7** | Usage index + the three checks (§7), incl. the coded-literal scan | The table names every bound and unbound sound in the project |
| **S8** | Publish gate + license summary (§6) | Publish refuses a bound draft, and the override works |
| **S9** | Dropdown unification; retire `gen-flow-v2-sound-enums.mjs` (§8) | Every picker offers the project's own names |
| **S10** | **Authoring moves in** — `bindings` on the doc, the categories UI, the pickers out of `/config`, `/symbols` and the Scene Editor, migration at export, runtime read path | Every moment is chosen in `/sound`, and a pre-move project's game sounds the same until someone opens it |

S1–S4 are the feature ("upload a sound, hear it in the game"). S5–S6 make it a tool. S7–S9 made the
pickers agree on a vocabulary. **S10 is the unification the tool was asked for**: S1–S9 shipped a
library with a read-only index and left the choices in three other tools, which is not the thing.

## 10. Open questions

- **The pack step.** Packing a project's loose banks into one audiosprite needs ffmpeg somewhere —
  `services/atlas-backend` is the natural host, mirroring what Sheet Maker does for images. Worth
  doing when a project's loose-bank count starts costing mobile load time (§3.2 trap 5), not before.
  It is a pure optimisation: the bank model does not change.
- **Loudness.** External musicians deliver at wildly different levels. Per-entry `volume` is the
  manual lever; whether to auto-analyse on upload (LUFS) and pre-fill it is open.
- **Who owns the slot catalogue.** `SOUND_SLOTS` stays in `packages/game-config` — it is the
  engine's contract about *when* a slot fires, and it must remain dependency-free and
  fixture-verifiable offline. `/sound` reads it. Do not move it — only the author's CHOICE moved,
  never the catalogue of what a moment IS.
- **The old fields.** `GameConfigDoc.sounds`, `SymbolsDoc.symbolSounds`, the symbols doc's
  anticipation sound fields and the `win` component's `<alias>Sfx`/`<alias>Bgm` params are still in
  their schemas and still read at runtime, one rank below the sound doc. That is deliberate: a game
  that shipped before the move must keep sounding the same until someone opens the tool. They become
  removable once every live project has saved once in `/sound`, and not before.
- **Builtin bank provenance.** The 53 shipped sounds inherit from the Stake Engine fork and their
  licensing has never been recorded. They should enter the index as `origin: 'builtin'` with an
  explicitly unknown license rather than being silently marked clean.
- **Book of Borut standalone** runs its own bundle, so S1's `utils-sound` change reaches the remake
  via an engine submodule bump, while anything touching `src/game/*` or `src/components/*` needs the
  usual mirror.
