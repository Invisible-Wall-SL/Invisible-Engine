# Add a pots overlay to an existing game

This walks the **pots overlay** onto a game you already have, from a safe copy to a playtest. The
example is Book of Borut with the **3 Pots** preset. Tokens and value coins drop on top of Borut's
symbols, tokens fly into red, blue and green pots, and a full pot starts a bonus. Borut keeps its
lines, its book and its free spins.

It is a spine, not a manual. For every button and field, follow the link to that tool's guide.
Why the overlay works this way is in [the pots overlay plan](../design/pots-overlay.md).

Every tool below is a full-page tool in the launcher at `app.invisiblewall.org` and works on the
**active project**. Make the copy from step 1 the active project before you open any later tool.

## 1. Make a copy — Invisible Game Maker

**Do:** open `/game-maker`, click **Duplicate…** on Book of Borut, give the copy a new name and key
(the sample uses `borut-pots-sample`), and set **What to copy** to **Everything**.
Guide: [Duplicate](../tools/game-maker.md#duplicate-reskin-for-another-client).

**Why Everything:** **Game setup only** copies no art, sounds or fonts. Its copy plays on
placeholder art, and everything that used Borut's art draws blank. Everything copies Borut's art,
sounds and fonts too, and the copy starts unpublished.

**Goes wrong:** a copy of more than 4000 files is refused, and nothing is written. Borut's published
versions are not copied and do not count.

**Never add the overlay to a live game.** The add-on writes the project's Game Config at once, and
the next Publish ships it to players.

**Done when:** the copy shows under **Your projects** and is the active project.

## 2. Add the overlay — Invisible Game Maker

**Do:** on the copy's card, click **＋ Pots overlay…**, pick **3 Pots (each pot a Hold and Win with
its special)**, leave the Flow checkbox off, and click **Add**. Read the report, then click
**Done**. Guide: [Add the pots overlay](../tools/game-maker.md#add-the-pots-overlay-to-a-project).

It adds the overlay and a Hold and Win bonus to the Game Config, placeholder art for the tokens and
the bonus's symbols, and the Pots, Jackpot bar and feature screens to the layout. It never
overwrites anything you authored. A copy made with **Everything** is playable from here, with
Borut's own art: every overlay beat has a built-in default.

**Goes wrong:**

- A **Renamed** line: the game already used one of the preset's names, so the new one got a `_2`
  suffix. Use the new names from here on.
- A part reads **changed meanwhile**: someone saved that doc during the run. Click **Run again for
  the rest**; it adds only what is missing.
- A tab you had open before refuses to save. Reload every open tab for the project.

## 3. Tune the pots — Invisible Game Config

**Do:** open `/config` → **Add-ons**. Each pot's **Starts** picks its bonus; for the sample, set the
green pot to `freeSpins`, so a full green pot starts Borut's own free spins. Adjust the pots' max
level and size stages, the drop chance, the drop table and the reels a token lands on, then
**Save**. Guide: [Add-ons](../tools/game-config.md#add-ons).

**Why here:** every later tool reads the pots from this config. Settle them now: a pot you add once
the Pots screen exists needs its Pot Meter placed by hand in step 4.

**Goes wrong:** the drop and bonus numbers are mock math. They shape what you see in testing; the
real RGS decides what drops and pays.

## 4. Place and skin the Pots screen — Invisible Scene Editor

**Do:** open `/editor`, select the **Pots** screen, and place and skin one Pot Meter per pot. With
the Hold and Win bonus, lay out the Jackpot bar and the feature's screens too.
Guide: [invisible-editor.md](../tools/invisible-editor.md).

**Goes wrong:**

- A screen is missing because the add-on skipped it. Use **＋ Add overlay screens**; it adds only
  the missing ones and never replaces your layout.
- A pot you added in step 3 has no meter. The Pots screen already exists, so add a Pot Meter for
  it by hand.
- The Jackpot bar does not show in the game. If the project's Flow drives the screens, it draws
  only screens the Flow shows. Add a **Show** of `jackpotBar` next to the one for `basegame`. The
  Pots screen needs no Show: the game draws it whenever the Flow never shows it.

## 5. Dress the tokens — Invisible Symbols State Machine

**Do:** open `/symbols`. Replace the placeholder art on each token row (Coin land, Coin idle, Fly to
meter) and on the bonus's coins, then style each pot's `toMeter:<id>` flight.
Guide: [Pots overlay projects](../tools/symbols-state-machine.md#pots-overlay-projects).

**Goes wrong:** a token with no art draws nothing. Bind every token row the add-on's report did not
cover.

## 6. Name the pots — Invisible Win Text

**Do:** open `/win-text` and give each pot its name, plus the pot-full line and pot labels. With a
Hold and Win bonus (as in the sample) they are in the **Hold and Win feature** section; a game with
pots only gets a **Pots** section. Guide: [win-text.md](../tools/win-text.md).

**Why:** the add-on writes no Win Text, so the built-in defaults play (an unnamed pot reads its id
in capitals) until you write your own. Translate them in [Localization](../tools/localization.md).

## 7. Optional: graft the overlay steps — Invisible Flow

**Do:** only if you want to author the overlay's beats. Open `/flow-v2` and click **＋ Add overlay
steps** on the Global tab. Guide:
[add-ons in Flow](../tools/flow.md#pots-overlay-and-hold-and-win-on-any-kind--add-ons).

Skip it and the overlay plays its built-in beats. The graft never touches a node you made.

## 8. Publish and playtest — Invisible Game Maker

**Do:** click **Publish** on the copy's card, then play it with **Play ↗**. Guide:
[Publish](../tools/game-maker.md#publish-and-re-publish).

To check it properly, run the sample's playbook,
[borut-pots-sample.md](../playtest/borut-pots-sample.md): token drops, flights, a full pot per
route, the green pot into free spins and the 6+ coin trigger.

**Done when:** drops land over the symbols, a full pot starts its bonus, and Borut's own free spins
still trigger from its book.

## The coins-only variant

Pick **Coins only (6+ value coins start a classic Hold and Win)** in step 2 instead. There are no
pots: value coins drop over the symbols, and 6 or more on one spin start a classic Hold and Win with
those coins held. Fewer are shown and then gone. With no pots there is no Pots screen and no token,
so step 4 is only the Jackpot bar and the feature's screens, step 5 only the bonus's coins, and
step 6 only the Hold and Win lines. In `/config` → Add-ons you can still add pots later; an overlay
can be pots only, coins only, or both.

## Limits today

- The test server deals the overlay over **Book of** games only. A lines or ways host is dealt its
  own game with no drops yet.
- To take the overlay off, use **Remove overlay** in [Game Config](../tools/game-config.md#add-ons).
