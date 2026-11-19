# Battle of the Year — Devils vs Defenders (game plan)

> Status: **PLAN** (2026-11-19, owner brief of the same day). Nothing in this file is built yet;
> what the 3D engine already has is in [`status/3d.md`](../../status/3d.md). This file replaces the
> red-vs-blue, seven-hero BOTY content of [`3d-games.md`](../3d-games.md) §6 (Phases 3 and 5); the
> engine plan there (runtime, tiers, assets, byte isolation) is unchanged. Decisions still open are
> in §9; a rule marked **(Q n)** is the recommended answer to question n and changes if the owner
> answers otherwise.

## 1. The game in one paragraph

Online, first person, 16 seats, bots fill the empty ones. A round is played on one of three
**stages** — a **Library**, a **Dance Club**, a **Casino** — with a **Hell Gate** in it: a burning
pit that is both where the **Devils** come from and where they score. The **Devils** are small
winged creatures: they fly around the stage, grab anything that is not bolted down and throw it
into the Gate. The **Defenders** are humans: they pick up whatever the stage offers as a weapon (a
mic stand, a stack of vinyl, a heavy encyclopedia, a croupier's rake), beat a Devil until it is
**stunned**, then pick it up and throw it back into the Gate. The Devils win if they feed the Gate
enough of the stage before the clock runs out; the Defenders win if the stage survives. The core
of BOTY's Crash mode is kept — carry things, throw them in the pit, team score, a timer — but the
two teams now play different games.

## 2. What changes from the red-vs-blue BOTY

| | BOTY Crash (the 3D plan so far) | Devils vs Defenders |
|---|---|---|
| Teams | red vs blue, mirror | **Devils** vs **Defenders**, asymmetric |
| Classes | 7 heroes (Archer … Wizard) | **one Devil, one Defender**; more classes are data later (§10) |
| Movement | walk, sprint, jump, double jump, trampolines | Defenders as before; **Devils fly** (Q 2) |
| What goes in the pit | pieces from destructibles, corpses | Devils throw **stage props**; Defenders throw **stunned Devils** |
| Combat | hp, death, corpse, respawn | **stun, not death** (Q 3, Q 4): a beaten Devil is stunned and carriable, a Defender is only knocked down |
| Weapons | per hero, from config | **found on the stage**, themed per stage; dropped when spent |
| Win | team score at 180 s | **Destruction meter** vs the clock (Q 1) |
| Maps | seeded procedural CrashArena | **three authored stages** (Q 7) |
| Presentation | none planned for v1 | **cinematic intro, Devil emergence, round-end sequences** (§5) |

## 3. Rules (all numbers are data, tuned in playtests)

### Factions

| | Devils | Defenders |
|---|---|---|
| Spawn | out of the Hell Gate, with a short emergence (§5) | at the stage's doors |
| Moves | fly: flap up, hover, glide down; slower and lower when carrying something heavy | walk, sprint, jump, double jump |
| Picks up | stage props | weapons; a **stunned** Devil |
| Attacks | **shove** (knockback, no damage); a prop thrown at a Defender knocks it down (Q 3) | with the weapon in hand; bare-handed push otherwise |
| Scores by | throwing a prop into the Gate: its value fills the Destruction meter | throwing a stunned Devil into the Gate: the meter drops a little, the Devil is out for a while |
| Taken out by | being stunned, carried and thrown into the Gate | never; knocked down for ~1.5 s by a shove or a thrown prop (Q 4) |

### The Hell Gate

One per stage (Q 7). A zone with a lip collider: a prop or Devil thrown or dropped into it is
**banished**. It glows hotter and widens (presentation only) as the Destruction meter rises — the
successor of BOTY's rising pit fluid. A Defender who falls in is put back at a door after 3 s (Q 4).

### Objects

| Kind | Who picks it up | Data |
|---|---|---|
| **Prop** (book cart, lamp, globe; speaker, bottle crate; chip rack, bar stool …) | Devils | model, weight class (light / medium / heavy → lift and speed while carried), value (meter points), spawn marker |
| **Weapon** | Defenders | type `melee` or `thrown` (a `special` per stage later), reach / arc / swing time, stun per hit, durability or ammo, model, spawner marker with respawn time |
| **Stunned Devil** | Defenders | it is the Devil player itself, held at the carrier's socket |

- Pick up and throw are one button (`interact`): press to pick up what is in front, press again to
  throw along the aim (pitch included). Holding an object takes the attack button away (Devils) or
  replaces the weapon in hand (Defenders drop what they held).
- A Devil that is hit while carrying **drops** its prop, and the prop is back in play. Props are
  Devil-only in v1 (Q 6): the Defenders' answer to a carrier is to hit it, not to carry the prop
  away.
- Thrown objects are server bodies (ballistic, bounce, rest). A thrown prop that hits a Defender
  knocks it down; a thrown weapon that hits a Devil stuns by its value.

### Stun, banish, respawn

- Every Devil has a **stun bar** (BOTY's hp, renamed). Hits empty it; at zero the Devil is stunned for
  ~5 s: it drops what it carried, falls to the floor and can be picked up. A stunned Devil that is
  not banished in time recovers with a full bar and flies off.
- A carried Devil can struggle (mashing `interact` fills a break-free bar, faster with more
  Devils nearby). **Later**, not v1.
- A banished Devil is out for ~6 s (its player watches the banish from the Gate camera, §5), then
  re-emerges from the Gate with a short invulnerability.

### Round and win (Q 1)

- Phases (the room's): `lobby → intro → running → ended → lobby`. `intro` plays the stage's intro
  sequence on every device at the room's clock; `ended` plays the winner's sequence.
- `running`: 180 s. Each stage's props add up to more than 100 % of the meter (so the Defenders
  cannot simply guard everything) — e.g. 140 %.
- **Devils win** the moment the meter reaches 100 %. **Defenders win** when the clock runs out
  first. Each banished Devil pushes the meter back a little (e.g. 3 %, never below 0).

### Seats (Q 5)

16 seats, **8 Devils vs 8 Defenders**, the faction picked in the lobby (honoured unless it
unbalances the teams, BOTY's rule), bots fill both sides; a human joining mid-round takes a bot's
seat on their side.

## 4. Stages

Each stage is one authored level (Q 7): floors, walls, ramps and stairs, balconies, a ceiling (the
Devils' flying limit), the Gate, the doors, prop and weapon markers, a look (lights, fog, toon ramp,
music). Weapons are three per stage — one melee, one thrown, one special (the specials are a later
pass; v1 ships melee + thrown).

| | **Library** (first, the vertical slice) | **Dance Club** | **Casino** |
|---|---|---|---|
| Layout | tall reading hall with a mezzanine ring of shelves, spiral stairs, rolling ladders; the Gate tears open the floor of the central reading room | a sunken dance floor, the DJ booth on a raised stage, bar and VIP balconies; the Gate opens under the dance floor | gaming floor of tables and slot rows, a raised high-roller pit and a cashier cage; the Gate opens in the middle of the roulette area |
| Melee weapon | **Encyclopedia** (slow, big stun) | **Mic stand** (long reach) | **Croupier's rake** (wide arc) |
| Thrown weapon | **Hardbacks** (stack of 3) | **Vinyl records** (stack of 5, flat arc) | **Poker chips** (stack of 8, fast, small stun) |
| Special (later) | fire extinguisher (stun cloud) | bass speaker (shockwave knockback) | champagne bottle (spray, then a melee shard) |
| Props for the Devils | book carts, globes, reading lamps, busts, chairs, card catalogues | speakers, bottle crates, bar stools, light rigs, the disco ball (heavy, high value) | chip racks, bar stools, card shoes, dice tables (heavy), a slot machine (heaviest) |

The three stages share one Defender, one Devil and the rules; only level, props, weapons and look
change, so stage two and three are **content passes**, not tech.

## 5. Cinematic presentation

| Moment | What the player sees | Length |
|---|---|---|
| **Match intro** (room phase `intro`) | a camera flight through the stage, the title card ("THE LIBRARY"), the floor cracks, the Gate opens, the Devils burst out; cut to the Defenders at the doors; countdown into first person | 8–12 s, skippable on the device (the room still waits) |
| **Devil emergence** (every spawn) | a short third-person shot of the own Devil climbing out of the Gate, then first person | ~1.5 s |
| **Banish cam** (banished Devil's player) | the Gate camera shows the own body falling in, then the respawn timer | the out time |
| **Meter milestones** (50 %, 75 %, 90 %) | camera shake, the Gate flares, a HUD sting — no cut | — |
| **Round end** (room phase `ended`) | Devils win: the Gate swallows the stage, Devils dance on the rubble. Defenders win: the Gate seals, Defenders pose. Then the scoreboard (most banished, most destroyed) | 6–10 s |

**How (recommended): Blender is the sequencer.** A sequence is authored in Blender as one file —
the camera's animated move, puppet characters playing their actions, and **timeline markers** for
cues (`sound:gate_open`, `fx:gate_burst`, `title:library`, `cut`) — and exported by `ie_export.py`
as a sequence GLB (`anim/sequences/<stage>_<moment>.glb`, markers in the glTF `extras`). The game
plays it with a **sequence player** in `engine-3d`: the camera director plays the camera clip as a
top-priority rig (the authored-moves path of 3D Phase 2), puppets are spawned only for the sequence
from the same character models and clip libraries, and each marker raises a Flow signal so sound, FX
and HUD titles stay in the tools that own them (Invisible Sound, FX, Win Text, Scene Editor
screens). A Flow node `playSequence3d` plays one and finishes on its last frame. Online, the room's
phase timestamp says when it started, so every device is on the same frame; a late joiner starts in
the middle. A launcher editor for 3D sequences (Invisible Cinematic's planned `camera3d` track) is
**not** needed for v1: Blender's timeline, camera and graph editor already do it better.

## 6. The tech this needs

What exists or is in flight is in §7 Pass 0; this is what is **new**. Everything new keeps the four
2D runtimes byte-identical: it lives in new `engine-mechanics` files reached only from 3D paths, in
`engine-3d`, in the `arcade3d` seam, on the game server, or in launcher/Blender tooling.

| Need | New work | Lives in |
|---|---|---|
| **Flight** (Devils) | a `flight` block in a character's motion (lift, hover drag, glide fall speed, ceiling margin, lift and speed per carried weight class); a `descend` button bit; IEEE-exact like the rest of the step, so the device still predicts the own Devil bit for bit; a flight replay fixture; ground characters' replays unchanged | `engine-mechanics` `motion3d.js` / `online3d.js` (new exports), `check:arcade-3d`, `check:room-sim-3d` |
| **Object entities** | one typed **entity** model for props, weapons and held players: weight, value, who may pick it up, carried-by link, ballistic throw, drop on hit, rest; the room's `Entity` map; devices interpolate entities and draw their own pick-up / throw at once (reconciled by the room's event) | game server room + rules; `engine-3d` device view |
| **Factions** | factions as data (name, characters, spawn rule, what they may pick up, how they score), per-faction seats and bots, the lobby pick | config block read raw (as `arcade.world3d`), room |
| **Stun / banish / knock-down** | stun bar, stunned status that makes a player carriable, held-player attach, banish + out timer + re-emerge, knock-down for Defenders | rules module + room |
| **Weapons** | weapon definitions (`melee` / `thrown`), equip / drop / durability / ammo, stun per hit; thrown weapons as entities; weapon spawners with respawn | rules module, config |
| **Destruction meter + win** | meter from banished props, pushback per banished Devil, Devils-win threshold, timer win, the `intro` phase | rules module, room |
| **Bots** | Devil brain: pick a prop by value / distance, fly to it, grab, fly to the Gate, dodge Defenders, shove; **flight navigation** (a height map of the level: fly over the tallest obstacle on the way, ray-checked); Defender brain: get a weapon, chase the carrying Devil first, stun, carry to the Gate | server-only bots |
| **Characters** | the Devil on the shared humanoid skeleton **plus wing and tail bones** (a winged variant), wings on their own masked layer; carry poses; the stunned / held pose attached to the carrier's socket; first-person viewmodels for each held weapon and prop | Blender conventions + `engine-3d` anim graph |
| **World-space HUD** | `world.project(x, y, z)` → screen; Pixi HUD markers for stun bars over Devils, the carried prop's value, the Gate marker and off-screen arrow, "pick up" prompts | `engine-3d` + the `arcade3d` seam's HUD |
| **Sequences** | `ie_export.py` sequence export (camera + puppet actions + markers), the `engine-3d` sequence player, `playSequence3d` Flow node, room-clock sync, skip | `tools/blender`, `engine-3d`, Flow vocabulary (3D only) |
| **Stages from Blender** | the level import: a stage blend whose objects carry `ie.collision` / `ie.marker` properties becomes an `arcade.world3d` level, markers and model placements; untagged colliders refused (gameplay evaluation §5) | `tools/blender` + launcher import |
| **Stage look** | per-stage lights, fog, toon ramp, background, music cue, as data | `engine-3d`, config |

## 7. Build passes

Each session is its own branch and draft PR (`claude/boty-<pass>-<slug>`), built through the named
agent, gated by the checks listed, reviewed by someone who did not write it (§8), and merged by the
coordinator. Passes on one row run in parallel.

**Choosing the model** (prices per million tokens in / out: Fable 5.2 $8 / $40, Opus 5.5 $4 / $20,
Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50):

| Kind of session | Model · effort | Why |
|---|---|---|
| New simulation or netcode in the **predicted path**, where a subtle error costs days (bit-exact prediction, held bodies across the wire) | **Fable 5.2 · high** | the most capable model; its gains above `high` are uneven, so `high` |
| Design-heavy build on existing code (rules, sequences, level import, bots, characters) | **Opus 5.5 · xhigh** | the default model; `xhigh` is its best setting for long agentic coding |
| Build with a clear spec (HUD, a stage's data, integration, a fix list from a review) | **Opus 5.5 · high** | same model, less deliberation |
| Content data, playtests, conflict rebases with a known resolution, doc sync | **Sonnet 5.5 · high** | half Opus' price, strong at well-specified work |
| Mechanical sweeps (renames, link fixes, re-recording a manifest from CI) | **Haiku 5.5 · medium** | rarely needed; only where nothing has to be decided |
| Independent review before merge | **Opus 5.5 · high**, `code-reviewer` (+ `pipeline-concurrency` for any save path) | a fresh read, never the author session |

| Pass | Session(s) — goal | Agent | Model · effort | Needs | Done when |
|---|---|---|---|---|---|
| **0 — Land what is built** | the in-flight 3D PRs (#1745, #1754, #1755, #1756, #1760, #1766–#1769, #1772, #1777, #1779, #1780: tier chooser, character loading, camera director, dynamic resolution, animation graph, bots, Crash rules and combat, Crash device Flow, arena generator, model derive fixes) reviewed and merged in dependency order; the order is being worked out | coordinator + integration sessions | Opus 5.5 · high (conflicts), Sonnet 5.5 · high (re-records) | — | all merged, `main`'s push run shows the four 2D runtimes "unchanged" |
| **1 — Rules lock** | the coordinator folds the owner's answers (§9) into §3–§5; writes `docs/knowledge/games/boty.md` and the playtest playbook `docs/playtest/boty.md` | coordinator | (this session) | §9 answered | owner says "locked" |
| **2a — Flight** | the `flight` motion block, `descend` button, carried-weight lift, ceiling; flight replay fixture; a flying player in the 3D room predicted with 0 corrections | `arcade-games` | **Fable 5.2 · high** | 0 | `check:arcade-3d` (new flight checks, old replay hash unchanged), `check:room-sim-3d` flight case, `check:runtime-bytes` (four 2D manifests untouched) |
| **2b — Entities: pick up, carry, throw** | one entity model for props, weapons and held players (weight, value, who may pick up, carried-by, ballistic throw, drop on hit, rest), the room's `Entity` map, device interpolation + instant own pick-up / throw, built on what Pass 0 lands of the Crash pieces | `arcade-games` → `games-3d` for the device side | **Fable 5.2 · high** | 0 | a room gate: pick up / carry / throw / drop-on-hit / rest across two devices with jittery links; live two-window check |
| **3 — Faction rules** | factions as data, stun bar + stunned + held player, banish + out timer + re-emerge, Defender knock-down, weapons (`melee` / `thrown`, durability / ammo, spawners), Destruction meter + win, `intro` phase, faction seats | `arcade-games` | **Opus 5.5 · xhigh** | 2a, 2b | a rules gate playing whole rounds by seed (both win paths), room-sim equality, Flow signals for every one-shot |
| **4a — Sequences** | sequence export in `ie_export.py` (camera + puppet actions + markers), the `engine-3d` sequence player, `playSequence3d` Flow node, room-clock sync, skip | `games-3d` (+ `invisible-flow` for the node) | **Opus 5.5 · xhigh** | 0 (camera director) | a sequence GLB made from a test blend plays on two devices at the same frame; markers raise their signals; skip works |
| **4b — World-space HUD** | `world.project`, stun bars over Devils, carried-value tag, Gate marker + off-screen arrow, pick-up prompts, faction HUD (meter, timer, weapon + ammo) | `games-3d` | **Opus 5.5 · high** | 0 | `check:engine-3d` projection checks; screenshot at three tiers |
| **4c — Characters** | the winged Devil skeleton variant in the conventions + validator, wing layer, carry poses, the held-player attach, first-person viewmodels for held weapons and props, placeholder Devil and Defender made through the Blender MCP | `games-3d` | **Opus 5.5 · xhigh** | 0 (loader, anim graph), 2b | both placeholders through `/models` → game; a Devil carried by a Defender reads right from both sides |
| **5a — Stages from Blender** | the level import (`ie.collision` / `ie.marker` → `arcade.world3d` + markers + model placements), stage look as data, the rule-8 chain for the level | `games-3d` + `atlas-python-tools` (Blender scripts), `launcher-studio` for the import route; review `pipeline-concurrency` | **Opus 5.5 · xhigh** | 0 | a test blend → a playable level; an untagged collider refused; deploy → bake → pull → register proven |
| **5b — Library blockout** | the Library as a greybox blend with a placeholder kit: Gate, doors, mezzanine, ceiling, props with values, Encyclopedia + Hardbacks spawners, look | `games-3d` | **Sonnet 5.5 · high** | 5a, 3 | plays offline and online; props total ≥ 140 % of the meter |
| **6 — Bots** | Devil brain + flight navigation (height map, ray check), Defender brain (weapon, chase the carrier, stun, carry to the Gate), faction seat filling | `arcade-games` | **Opus 5.5 · xhigh** | 3, 5b | 16 bots play a full Library round by seed, both sides win some seeds; a bot replay gate |
| **7 — Vertical slice: the Library** | a BOTY project made in Game Maker on `arcade3d`; intro, emergence, banish cam and round-end sequences blocked out in Blender; sound and FX cues placeholder; online with bots | `games-3d` | **Opus 5.5 · high** | 2–6 | **owner plays it** |
| 7b — playtest loop | play rounds, find and fix bugs on the playbook | `game-playtester` | **Sonnet 5.5 · high** | 7 | the playbook's checks pass |
| **8 — Dance Club · Casino** | each stage: blend, props, Mic stand + Vinyl / Rake + Chips, look, its sequences | `games-3d` | **Sonnet 5.5 · high** (×2, parallel) | 7 + the owner's art kits | each plays a full round with bots |
| **9 — Specials and polish** | the `special` weapon type (cone / shockwave), struggle-free, breakable fixtures (Q 8), meter-milestone flares | `arcade-games` | **Opus 5.5 · high** | 7 | gates as in 3 |
| **10 — Ship** | touch flight controls, gamepad, `quarter`-tier performance on a phone, the desktop `full` build, `arcade3d` released to the live game, guides | `games-3d`; `docs-keeper` (**Sonnet 5.5 · medium**); `infra-railway` for the release | **Opus 5.5 · high** | 8 | owner's go |

Art runs beside the tech, not after it: the owner's Devil and Defender models, the Library kit and
the weapon and prop models can start as soon as Pass 4c fixes the winged skeleton; until then every
pass uses placeholders from the Blender MCP.

## 8. How the coordinator runs it

The coordinator is one long-lived session (the one that wrote this file). It does not build
features; it starts, steers, reviews, merges and archives.

1. **Start a pass.** Write the session's brief (goal, the rows of this file it builds, the files and
   gates, the branch name, "run `code-reviewer`, open a draft PR, update `status/3d.md`") and start
   it as a cloud session with the model and effort of its row, tagged `boty` and `boty-pass-<n>`.
2. **Steer.** Read its progress; answer its questions from this file; escalate to the owner only a
   decision that is the owner's (§9-type questions), never an implementation choice.
3. **Review.** When its CI is green (Lint, `runtime-bytes`, the 3D gates), run an independent review
   (`code-reviewer`, plus `pipeline-concurrency` when it writes to R2) and send the findings back to
   the same session to fix. A PR whose four 2D manifests (`lines`, `match3`, `arcade`, `card`) moved
   does not merge — 3D work must not reach them.
4. **Merge, one at a time.** Squash-merge, scope in the title. Only one PR that re-records
   `scripts/runtime-bytes/arcade3d.json` merges at a time: after each, the next merges `main` and
   re-records `arcade3d` from its own CI artifact (the merge-skew rule, `status/3d.md` open item 6).
5. **After the merge.** Watch `main`'s push run (the four runtimes "unchanged"), mark the pass ✅
   with its PR in the table above, make sure `status/3d.md` carries the detail, then **archive** the
   session. A stuck or failed session is archived only after what it learned is in the next brief.
6. **Owner gates** — the coordinator stops and asks at: Pass 0 done (the backlog landed), Pass 1
   (rules locked), Pass 7 (the slice played), and before `arcade3d` is released to players.
   Everything else it merges on green; any merge is one squash revert away.

## 9. Questions for the owner

Each has a recommended answer, which this file already assumes.

1. **How a round is won.** Recommended: the **Destruction meter** — Devils win at 100 %, Defenders
   win if the 180 s clock runs out first, each banished Devil pushes the meter back a little.
   Alternative: two scores (props banished vs Devils banished), highest at the clock wins — harder
   to read and to balance.
2. **How Devils fly.** Recommended: **free hover flight** up to the stage's ceiling (flap up,
   hover, glide down), slower and lower with a heavy prop. Alternative: flutter-hops with a stamina
   bar (closer to a double jump; keeps Devils within a Defender's reach more often).
3. **Do Devils fight back?** Recommended: a **shove** (knockback, no damage), and a prop thrown at a
   Defender knocks it down — at the price of not putting that prop in the Gate.
4. **Can Defenders be taken out?** Recommended: **no** — knocked down for ~1.5 s, never killed; a
   Defender who falls into the Gate is back at a door after 3 s. Devils carrying a downed Defender to
   the Gate would be a fun mirror, but it doubles the held-player cases — later, if at all.
5. **Seats.** Recommended: 16 seats, **8 vs 8**, faction picked in the lobby, bots fill both sides.
   Alternative: asymmetric (e.g. 10 Devils vs 6 Defenders) if playtests show Defenders dominate.
6. **Props are Devil-only?** Recommended: **yes** in v1 — Defenders stop a carrier by hitting it.
7. **Stages authored by hand in Blender, one Gate each** (recommended), rather than generated per
   theme. This also means BOTY's old FBX tiles and props are not needed for these stages, which
   retires the provenance question in `3d-games.md` §8 item 3 for this game.
8. **Breakable fixtures** (a bookshelf that spills books, a slot machine that spills coins)?
   Recommended: **later** (Pass 9), not in the first slice.
9. **Camera.** First person for both factions (the 2026-11-18 decision) — or third person for the
   Devils, since flying with a prop reads better from behind? Recommended: keep first person and try
   a Devil third-person rig in the slice; the camera director has both, so it is a data switch.
10. **Cinematics in v1:** intro, Devil emergence, round end (recommended), banish cam if cheap. Who
    animates them: the owner or an artist in Blender; Claude blocks out placeholder sequences through
    the Blender MCP so the tech is proven before the art.
11. **Art:** who makes the Devil, the Defender and the three stage kits, and when? Placeholders are
    used until then.
12. **Weapons and props in §4** are a first pass — change them freely.
13. **Pass 0:** may the coordinator land the in-flight 3D PRs (after review, in the §7 order) now?

## 10. Later: the fantasy world

Nothing above is specific to devils and humans in code: factions, their characters, what each may
pick up, weapons, props and stages are data. A fantasy setting is then a content pass — new
characters (more Defender classes: knight, mage, archer — the old BOTY heroes come back as classes),
new stages, new weapons — plus whatever new **weapon types** it needs (a projectile spell is a
`thrown` entity with no arc; a heal is an ability). Classes per faction need only a lobby picker and
per-class stats, both already shaped by the Characters tool.
