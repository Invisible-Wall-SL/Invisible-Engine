# Build your first game

This walks a **lines**, **Book-of** or **ways** reskin from an empty project to a delivered build.
It is a spine, not a manual. Each step says what you do, why it comes at that point, what usually
goes wrong, and how you know you're done. For every button and field, follow the link to that
tool's guide. The tool guides are the source of truth, and this page doesn't repeat them.

Every tool below is a full-page tool in the launcher at `app.invisiblewall.org`, and every one
works on the **active project** (the project selector on the launcher home). Pick your project
there before you open a tool. See [the launcher guide](../tools/launcher.md).

## Before you start

- **An account with the right tools.** Default roles are listed in
  [tools/README.md](../tools/README.md). Two gaps catch people out:
  - **Game Maker** (create + publish) is on `admin`, `developer` and `pipeline tester` by
    default, not `artist`.
  - **Publish** also needs the **Build & publish games** (`gamePublish`) capability. Only `admin`
    has it by default. Anyone else needs an admin to grant it in `/admin` → Roles.
- **Know which template you're reskinning.** The three templates share every step. The table
  shows where they differ, and each step flags its template-specific part.

| | Lines | Book of | Ways |
|---|---|---|---|
| **Game type** in Game Maker | Lines | Book of | Ways |
| How it pays | paylines | paylines, plus an expanding special symbol in free spins | ways: adjacent reels, left to right, from 3 reels |
| Mock RGS it spins against | `lines` | `book` (buy feature + free spins) | `ways` |
| Laid-out reference to import | yes | yes | yes (shares the lines art) |
| Starter flow | the Book-of starter (lines has no flow vocabulary of its own) | Book-of starter, with the `specialBook` screen and the expanding-symbol beats | ways starter, without the `specialBook` screen or the expanding beats |
| Extra authoring | — | `Book reveal` / `Book idle` symbol states; the **Expanded symbol win** message | **Save Game Config once** (step 5); paylines don't apply |

All three run on the same shared engine runtime. Each game type is data plus a mechanic, not a
separate app ([design](../design/game-type-templates.md)).

## 1. Create the project — Invisible Game Maker

**Do:** open `/game-maker`. Choose one:

- **Create a game:** fill in Name, Key, Client and **Game type**, then click **Create project**.
- **Duplicate…** an existing game onto a new key. **Game setup only** copies no art, sounds or
  fonts, so pick it only when new art is coming. **Everything** copies a game that plays as the
  original does, and you replace the art in place.

Guide: [game-maker.md](../tools/game-maker.md#create-a-game).

**Why first:** the game type seeds everything after this step. It decides the starting scene
layout, the Game Config template, the starter flow and which mock RGS the game is dealt by. Create
also scaffolds the project's cloud folders, so the other tools have somewhere to save.

**Goes wrong:**

- The key becomes the project key **and** the game's URL (`games.invisiblewall.org/<key>/`), so
  choose it carefully. Online and desktop builds of one game need **different** keys
  ([why](../tools/invisible-launcher.md#-scaffold--give-an-online-project-a-standalone-build)).
- You picked the wrong game type. Fix it now, before you author anything on top of it.

**Done when:** the project shows under **Your projects** and you've made it the active project on
the launcher home.

## 2. Lay out the screens — Invisible Scene Editor

**Do:** open `/editor`. Use **＋ Load scenes…** → **Import composed reference** to get a laid-out
game for your type, or **New game from kind** to get a bare engine scaffold. Then place the
background, board frame, logo and HUD, and set the reel grid's position and size. Author
`desktop` first, then adjust `tablet · landscape · portrait`.
Guide: [invisible-editor.md](../tools/invisible-editor.md#1-pick-or-create-a-screen).

**Why here:** the layout tells you which art you actually need: regions, frames, spines and fonts.
Lay it out with reference or placeholder art now, then swap your own in after step 3. The reel
grid's cell size scales the whole board; each symbol's size within its cell comes from its art
([Symbol size on the reel](../tools/invisible-editor.md#symbol-size-on-the-reel)).

**Goes wrong:**

- The canvas box doesn't match the game type's box. Use the amber **Match game box** warning
  ([Canvas size](../tools/invisible-editor.md#canvas-size-the-main-box)).
- A brand-new screen shows in the editor but not in the game
  ([Known limitations](../tools/invisible-editor.md#known-limitations--todos)). The bet menu,
  auto spin and free-spin screens only appear once the flow shows them (step 9).
- A layout of a different game type is only a preview and won't autosave. **Save** converts the
  project to that type, so only save it if you mean to.

**Done when:** the save pill reads **Saved**, and the header shows no **Asset issues** (a node
pointing at art the game can't load would render blank).

## 3. Make the art and fonts — Atlas, Sheet and Font Makers

**Do:**

- **Invisible Sheet Maker** (`/sheet`): pack PNGs you already have into a named sheet and export
  it. Name symbol regions per the [symbol naming convention](../conventions/symbol-naming.md)
  (`H1`, `L1`, `W`, `S` …). The engine keys behaviour off those names.
  Guide: [sheet-maker.md](../tools/sheet-maker.md#typical-workflow).
- **Invisible Atlas Maker** (`/atlas`): generate the art region by region with AI. Pick a variant
  per region, then **Create Atlas** and **Deploy atlas**.
  Guide: [atlas-maker.md](../tools/atlas-maker.md#typical-workflow).
- **Invisible Font Maker** (`/fonts`): import a BMFont, or bake one from a TTF/OTF, for the HUD
  and win amounts. Guide: [font-maker.md](../tools/font-maker.md#generate--bake-a-bitmap-font-from-a-ttfotf).

Then go back to the Scene Editor and swap the placeholders for your art (Library → Atlases /
Sheets).

**Why here:** everything after this step picks from what's in the project's storage. That covers
the editor Library, the Symbols frame picker and the font lists. Art that doesn't exist yet can't
be bound.

**Goes wrong:**

- Always open the Atlas and Sheet Makers **from the launcher**. A bookmarked tool URL expires, and
  the only way to change project is back through the launcher
  ([Atlas gotchas](../tools/atlas-maker.md#known-gotchas--limitations)).
- A variant you picked isn't the same as a locked slot, and a re-render moves an unlocked pick
  ([Picking vs locking](../tools/atlas-maker.md#picking-a-variant-vs-locking-a-slot)).
- The **Currency** font preset bakes no letters. If the HUD then draws a letter, the game
  black-screens on spin ([Font limitations](../tools/font-maker.md#known-limitations--todos)).
  Also check the font has the glyphs for every language you'll sell in (step 8).

**Done when:** your atlases, sheets and fonts show up in the Scene Editor's Library, and the
layout uses them in place of the reference art.

## 4. Bind the symbols — Invisible Symbols State Machine

**Do:** open `/symbols`. For each symbol, bind each state (`Static`, `Spin`, `Land`, `Win`,
`Post-win`, `Explosion`) to a sprite frame, a spine animation or a flipbook clip. Click **Apply**
in the cell editor, then **Save**. Give every symbol a **Name** and **Plural**. Win Text uses them
in step 7. Guide: [symbols-state-machine.md](../tools/symbols-state-machine.md#how-to-use-it).

**Book of:** you also get `Book reveal` and `Book idle` columns. Left empty, they borrow `Win`.

**Why here:** you need the art from step 3. The names you set here feed Win Text and
Localization later.

**Goes wrong:**

- A symbol is missing from the grid. The grid shows only the symbols **in play** in Game Config,
  so check the next step before you look for a bug.
- A spine cell left on **(first animation)** plays the wrong clip, or a blank setup pose, when the
  rig has several animations or none. The banner above the grid lists those cells.
- You re-exported a spine but the grid shows the old one. Click **↻ Reload from R2**.

**Done when:** every in-play symbol reads correctly in every state, the header shows **Saved**,
and every symbol has a name.

## 5. Set the math contract — Invisible Game Config

**Do:** open `/config`. Set the grid, the win model, the symbol dictionary and paytable, the bet
modes and the big-win tiers. If the math team sent the config as JSON, click **raw JSON**, paste
it and **Apply**. Then **Save**. Guide: [game-config.md](../tools/game-config.md).

**Where the paytable comes from:**

- **The math team's JSON**, pasted as above.
- **A partner's game:** use **Import from a pasted capture**. The capture is kept as the project's
  **partner reference**, and from then on it **gates Publish**. While your paytable disagrees with
  it, a red box lists the rows. Game Maker's Publish refuses (an admin can override), and
  desktop and delivery builds stop at the bake
  ([the Publish check](../tools/game-config.md#the-partner-reference-and-the-publish-check)).
- **Import paytable from server** reads your published game's server. It stays disabled until the
  game has been published once, so come back after step 10 if you need it.

**Ways:** **Save**, even if you changed nothing. A project that has never saved a config ships no
config and plays like lines ([Making a ways game](../tools/game-config.md#making-a-ways-game)).

**Why here:** the grid and win model decide what the board draws and what the mock deals. The
in-play set decides which symbols the Symbols tool shows. The bet-mode copy you write here is
translated in step 8.

**Goes wrong:**

- A symbol is in the dictionary but on no strip. It shows **unused**, and it can never be dealt
  ([The strips are the gate](../tools/game-config.md#the-strips-are-the-gate)).
- A word painted into bet-mode card art can't be changed or translated by any field.
- A config save reaches **Live ↗**, and the test-server mock that deals it, within seconds.
  **Players** get the config, and the board their mock deals, frozen into the last Publish. After
  a math change on a live game, republish (step 10).

**Done when:** there are no errors at the top of the page (warnings don't block), the page is
saved, and there's no red partner-reference box.

## 6. Add the audio — Invisible Sound

**Do:** open `/sound`. Drop in your music and SFX, then press **Save**. An upload doesn't join the
library until you save. Point **Base game music** and **Free-spin music** at your own tracks and
tick **loop** on both of their rows. Change any game moment you want to sound different, fill in
**Where it came from** for each file, and mark the takes that are cleared to ship **Approved**.
Guide: [sound.md](../tools/sound.md).

**Why here:** the moments list covers symbol, tier and anticipation cues. Those only exist once
steps 4 and 5 define the symbols and tiers.

**Goes wrong:**

- A music bed without **loop** plays once, and the game goes quiet underneath itself
  ([the two music beds](../tools/sound.md#the-two-music-beds)). The **opening** music comes from
  the flow's `soundMusic` cue on **tapToStart** (step 9). Point that at your track too.
- Two sounds with the same name, or a name with a space or a dot, lose a row on save. Renaming a
  sound doesn't re-point the moments that play it ([Names](../tools/sound.md#names)).
- A draft sound that the game plays stops Publish (step 10). Approve it, or publish anyway on
  purpose ([Draft and Approved](../tools/sound.md#draft-and-approved)).

**Done when:** each moment plays your sound when you press ▶, both beds loop, and every sound the
game plays is Approved.

## 7. Write the win messages — Invisible Win Text

**Do:** open `/win-text`. Write the templates for the win line, the win amount and the info-bar
messages, using placeholders like `{amount}`, `{count}` and `{symbolName}`.
Guide: [win-text.md](../tools/win-text.md).

**Book of:** fill in **Expanded symbol win**. Otherwise an expanded win counts reels as if they
were icons ([why](../tools/win-text.md#why-expanded-wins-get-their-own-line)).

**Why here:** `{symbolName}` needs the names from step 4
([Name your symbols first](../tools/win-text.md#name-your-symbols-first)). Win Text has to come
before Localization, which collects these templates for translation.

**Goes wrong:**

- A caption filled in over big-win art that already has the words painted on shows the text twice
  ([Win-level captions](../tools/win-text.md#win-level-captions)).

**Done when:** the live preview reads the way you want, for a normal win and (Book of) an
expanded one.

## 8. Translate — Invisible Localization

**Do:** open `/localization`. Set the source and target languages and a **Never translate** list
(game name, brand terms). Click **Translate all missing**, **Save**, and read the result in the
running game. Then mark the good rows reviewed (**Mark reviewed**) and **Save** again.
Guide: [localization.md](../tools/localization.md#review-flow).

**Why here:** Localization only lists text it can collect from the other tools: scene text, win
text, symbol names, bet-mode copy and flow messages. Do it after the tools that own the text. If
you add Text Message nodes in step 9, come back afterwards.

**Goes wrong:**

- Only **reviewed** translations reach players. **Live ↗** also shows unreviewed ones, so
  something that looks translated there may still be English for players
  ([where each shows](../tools/localization.md#selecting-the-language-in-the-game)).
- Source text is read-only here. Fix it in the tool that owns it.
- The font lacks the glyphs for a script, which can black-screen the game. Arabic, Hebrew and
  Persian also need RTL layout, which the HUD doesn't do.

**Done when:** every row in every language you sell in is filled in and reviewed.

## 9. Wire the presentation — Invisible Flow

**Do:** open `/flow-v2`. Your project already has its game type's **starter flow**, saved at
Create, so a game plays even if nobody opens this tool. Change only what your reskin needs:

- point the opening `soundMusic` cue at your track;
- add the **Show** nodes for any bet menu or auto spin screens you built in step 2;
- splice in cues for characters you placed in the Scene Editor.

The tool autosaves.
Guide: [flow.md](../tools/flow.md).

**Why here:** the flow shows your screens, fires your cues and plays your sounds, so it comes
after all of them.

**Goes wrong:**

- Wiring a spare **Game Signals** pin hands that moment to the flow and switches off the game's own
  handling. The board can stop revealing. Splice new nodes **in series** into a chain the flow
  already drives
  ([Trap 1](../tools/flow.md#scene-cues--animate-a-placed-character)).
- The free-spin intro or outro hangs or skips. A **Hold** needs a screen with a **Tap to Continue**,
  and neither screen may be shown from a start-up chain
  ([Free-spin intro and outro](../tools/flow.md#free-spin-intro-and-outro--the-flow-holds-the-round)).
- The bet menu and auto spin screens never open until their HUD pins are wired
  ([worked example](../tools/flow.md#the-bet-menu-and-the-auto-spin-menu--a-worked-example)).
- A project created before starter flows existed has no flow and publishes without a free-spin
  intro or outro. Make any edit here to save the starter, or ask an admin to **Rescaffold** it.

**Done when:** the sub-bar pill reads **✓ valid**. Any **red** error in the
[Validation panel](../tools/flow.md#validation) blocks Publish; warnings and hints don't.

## 10. Publish — Invisible Game Maker

**Do:** back in `/game-maker`, click **Publish** on the project's card (**Re-publish** once it
exists). A publish takes about 20–30 s.
Guide: [game-maker.md](../tools/game-maker.md#publish-and-re-publish).

**What Publish does:** it freezes everything you authored into an immutable **published version**.
That's layout, art, fonts, sounds, symbols, flow and config. **Players always boot the published
version.** Your later edits reach them only when you publish again. So when a change "isn't in the
game", first check whether it was published:

- **Play ↗** opens what players get: the published version.
- **Live ↗** opens your current, unpublished authoring data.
- A line under the buttons says which version players get, and warns when scenes were edited
  after it.

**Publish refuses, before writing anything,** on: sounds still marked draft; flow validation
errors; a paytable that differs from the partner reference; or a game that has its own desktop
build. Each refusal names the problem. Fix it in the tool that owns it. Overriding a flow or
paytable refusal is admin-only.

**Rolling back content:** **Published versions** → **Make live** switches players to an older
version on their next load. This rolls back the game's **data**, not the engine. Engine releases
and their rollback are a separate lever. See [Release and rollback](release-and-rollback.md).

**Goes wrong:**

- The **Publish** button returns 403. You need `gamePublish` (see
  [Before you start](#before-you-start)).
- An **Engine update available** badge means the shared engine shipped after your last publish.
  **Republish + Reconcile** picks it up
  ([the badge](../tools/game-maker.md#engine-update-available-the-staleness-badge)).
- A language shows English under **Play ↗** because that row isn't reviewed yet (step 8).

**Done when:** **Play ↗** boots the game at `games.invisiblewall.org/<key>/` and it spins against
the mock RGS (fake money, see [test-server.md](../tools/test-server.md)). Play a base round, a
win, a big win and a free-spin feature in each device layout.

The full publish runbook, including what to check after a publish, is
[Publish and deliver](publish-and-deliver.md).

## 11. Deliver — the desktop Invisible Launcher

A game published in Game Maker plays on **our** test server. A **delivery** is a build folder that
**someone else** hosts: a client, an operator or an aggregator. You make it in the desktop
**Invisible Launcher**, not in the browser.

**Do:**

1. A Game Maker project is data-only: it has no repo and no build. On its card in the desktop
   launcher, press **🏗 Scaffold** once to give it one. If the game is already published online,
   give the desktop build its **own** key.
2. Untick **🐞 Debug** (it would ship our debug tools to the partner), then press **📦 Deliver**.
   Pick the delivery profile (`operator-embed` for a real handover) and confirm the **game alias**
   with the partner.
3. **▶ Play it** in the result dialog with a session from their platform, then send them the zip.

Guides: [the desktop launcher's Deliver section](../tools/invisible-launcher.md#-deliver--build-the-folder-a-partner-hosts),
the one-page [publisher runbook](publisher-runbook.md), [Publish and deliver](publish-and-deliver.md),
and the design: [delivery builds](../design/delivery-builds.md) ·
[games deploy](../design/games-deploy.md).

**Goes wrong:**

- **Build refused:** the desktop build runs the same gates as Publish (flow validation, paytable
  drift), plus a missing-art check on Deliver. Fix the data in its tool, not in the build
  ([what each refusal means](publisher-runbook.md#when-the-engine-refuses-the-build)).
- A wrong alias makes the partner's script tag 404.
- Not signed in to the portal: the build falls back to placeholder art.

**Done when:** **▶ Play it** plays the build against the partner's RGS exactly as it will run on
their page, and the partner has the zip.

## When something's wrong

- **An edit isn't in the game:** compare **Play ↗** (published) with **Live ↗** (authoring). If
  only Live has it, publish (step 10).
- **The game is blank, stale or won't load, the launcher is down, generation fails, or the RGS
  errors:** see [Incident first response](incident-first-response.md).
- **What a tool can't do yet:** each tool's current state is in [`docs/status/`](../status/) and
  the index in [STATUS.md](../STATUS.md).
