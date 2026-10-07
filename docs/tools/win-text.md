# Invisible Win Text

Author **what the game says about a win** — the message on the win line, how the
pay amount reads, and the info-bar message — per symbol and per match count. Every
field is a **template**, and every template is picked up automatically by
[Invisible Localization](./localization.md) for translation.

## What it is

One page per project that holds the game's win copy as templates. The game fills in
the numbers and names when a win pays; Invisible Localization translates the
templates.

- **Where it runs:** the launcher itself, at `/win-text` — a full-page tool inside the
  signed-in area, never an iframe.
- **Access:** the `admin`, `developer`, `artist`, `pipelineTester` and
  `localizationReviewer` roles get it by default; admins can grant or revoke it per
  role or per user in the admin panel.
- **Scope:** per **active project** (shown in the top bar; switch it with the project
  selector on the launcher home). Each project has its own win text.

### Templates, not strings

You don't write the finished sentence — you write a **template** with placeholders,
and the game fills them in:

| Placeholder    | Becomes                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `{amount}`     | the pay amount, already in the player's currency                                                 |
| `{count}`      | how many symbols matched                                                                         |
| `{symbolName}` | **the symbol's name** — "Banana"/"Bananas", from [Invisible Symbols](./symbols-state-machine.md) |
| `{symbol}`     | the paying symbol's raw id, e.g. `H1` (you usually want `{symbolName}`)                          |
| `{line}`       | the payline number                                                                               |

So `You win {amount} with {count} {symbolName}` shows as **You win $4.00 with 4
Bananas**.

This is also what makes win text **translatable**. A translator translates the
template once (`{count} {symbolName}` → `{count} × {symbolName}`) and the name
once, and the game fills them in afterwards — so one translation covers every win.
A finished sentence like "You win $1.00 with 2 Bananas" could never be translated,
because there'd have to be a separate translation for every possible amount.

You never need to translate the currency: `{amount}` is formatted for the player's
own locale and currency automatically, from the game URL.

## How to use it

### Name your symbols first

`{symbolName}` is the whole point: the game says **which** symbol paid, not how
many matched in the abstract. The names live in **Invisible Symbols** — each symbol
row in that tool has a **Name** and a **Plural** box (`H1` → "Banana" / "Bananas").

- Rename a symbol there and **every** message here follows, with no edit.
- The plural is used whenever the count isn't 1. Leave it blank for names that
  don't change ("Wild", "Bonus").
- A symbol you haven't named falls back to its raw id — the message still works, it
  just says "4 H1". The page shows a warning while none of the project's symbols has
  a name.

### The win-line message grid

Rows are your project's symbols, columns are the match counts (**2** to **5
matching**, then **Any count**). The rows are the ones
[Invisible Symbols](symbols.md) lists: every symbol Invisible Game Config shows **in play**,
then a pots overlay's coins. A symbol you take off every reel strip in Game Config loses its
row here too, but its messages are kept: put it back on a strip and the row returns with them.

A win uses the **most specific** box that has something in it:

```
this exact symbol × count  →  Any count (this symbol)  →  Any symbol (this count)  →  the default
```

Leave a box empty to inherit — the grey italic text in an empty box shows you
exactly what that win will say instead.

That means the common cases are one edit:

- **Change what every win says** — type in the corner box (**Any symbol × Any
  count**), e.g. `{count} {symbolName}`.
- **Change just two-symbol wins** — type in the **Any symbol** row under the **2
  matching** column, e.g. `PAIR!`.
- **Give one symbol its own line** — type in that symbol's **Any count** box.
- **Call out one exact win** — type in that symbol's box under that count, e.g.
  `JACKPOT LINE!` for `H1 × 5`.

A symbol rule beats a count rule: a symbol's own **Any count** line wins over the
**Any symbol** line for its count.

**Scatters are not in the grid.** A scatter pays anywhere rather than along a line, so
the game draws no win line for it and this message would never appear. The page names
the symbols it left out; use the **Info-bar message** for their wins.

### Win amount

How the pay amount is stamped on the win line. Default is just `{amount}`; make it
`WIN {amount}` if you want the word.

### Info-bar message

The message that flashes when a win pays — this is the one that **names the symbol**.
There are **four** boxes because the game says whatever fits what it knows about
the win:

- **Amount + symbol** — the normal case: `You win {amount} with {count} {symbolName}`
- **Expanded symbol win** — a Book-of expansion:
  `You win {amount} with {symbolName} on {count} reels`
- **Amount only** — a message fired without a symbol (any flow can fire one):
  `You win {amount}`
- **Symbol only** — no amount: `{count} {symbolName}`

The page shows a **live preview** of what the current templates will actually say,
using one of your real symbols — one for a normal win and one for an expanded win,
because the two must read differently.

**Expanded symbol win** appears only for a **Book-of** game, the one kind whose
special symbol expands. Other kinds don't show the box or its preview.

If a message is fired with no symbol, the game uses **Amount only** rather than
printing an empty name — so you never see a blank or a stray `{symbolName}`.

**Show the symbol as an image.** Tick this and the `{symbolName}` in the info-bar
message is drawn as the symbol's own art, sized to the text, instead of its name. An
animated symbol (flipbook or rig) is held on its first frame so the sentence stays
readable, and a symbol with no art falls back to its name.

#### Why expanded wins get their own line

When a **Book-of special symbol expands**, it fills whole reels before the wins pay.
`{count}` is then the number of **reels** the symbol covers — not the number of icons
on the board. Said with the normal sentence, the game announces "You win €2500,00 with
4 Boots" over a board showing **twelve** boots, and the player can count the difference.

The expanded line frames the count as reels instead, which matches the columns they
see lit. Leave it blank and expanded wins fall back to **Amount + symbol**.

This is per-**spin**, not per-symbol: in a free-spin round the special symbol pays
ordinary line wins on the spins where it doesn't expand, and those still use the normal
sentence. Other symbols paying alongside an expansion are never affected.

### Free spins

The celebration line for a **retrigger** — when a player wins **extra free spins in
the middle of the feature**. Write `{count}` where the number of extra spins goes:

- **Retrigger (+N extra)** — `You won +{count} Extra Free Spins`

It's one sentence on purpose, so it **translates** as a whole (word order and where
the number sits are the translator's to decide). To show it in a game, author a
retrigger screen and bind a text node's **source** to `freeSpinsAddedText` — you keep
full control of the font, size, colour and position, exactly like any other text box.
(For a bare "+10" number with no words, bind `freeSpinsAdded` instead.)

A game whose kind is **Hold and Win** has no free spins, so it doesn't show this section (another
kind with a Hold and Win bonus keeps it).

### Hold and Win (jackpots, respins, feature, wheel)

These sections appear only for a game **with Hold and Win**: one whose kind is Hold and Win, or one
of any other kind whose [Invisible Game Config](./game-config.md) carries a `holdAndWin` block (for
example a Book-of game with a Hold and Win bonus). They hold the lines the respin feature shows. Each row has a live preview on its right. The **Wheel** section appears only
when the game's config has the pre-feature wheel.

| Placeholder   | Becomes                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{jackpot}`   | the jackpot tier's caption, e.g. "GRAND" (on an upgrade, the tier it rose to)                                                                                                        |
| `{amount}`    | what the jackpot or the feature paid, in the player's currency                                                                                                                       |
| `{count}`     | a number of respins — the respins left, awarded, or added                                                                                                                            |
| `{meter}`     | the name of the special a full pot activates, e.g. "PAYER"; a pot that activates none (a pots overlay pot that starts free spins or another mode) reads as its own name, e.g. "GOLD" |
| `{modifiers}` | the specials a feature runs with, e.g. "PAYER, MULTIPLIER"                                                                                                                           |
| `{pot}`       | a pot's name, e.g. "RED"                                                                                                                                                             |
| `{level}`     | a collector level's name ("DOUBLE"), or on a pot its fill level                                                                                                                      |
| `{max}`       | a pot's top level                                                                                                                                                                    |
| `{rows}`      | the rows an expanding respin board has open                                                                                                                                          |

- **Jackpots.** There is one box per jackpot tier. The tiers are the game's own, from
  [Invisible Game Config](./game-config.md), not a fixed list. Leave a tier blank and the
  game calls it by its config name. Below the tiers are the jackpot banners: the title
  (`{jackpot} JACKPOT`), the amount under it, the full-board amount
  (`FULL BOARD  {amount}`), the small banner over a jackpot coin (`{jackpot}`) and the line
  when an upgrade steps a jackpot coin up a tier (`{jackpot} UPGRADE`). For a progressive tier
  `{amount}` is the live pool the server paid, not its seed.
- **Platform jackpot** (every kind). The casino platform's own jackpot, shown only where the
  platform runs one. There is one box per platform tier (`Mini` … `Grand`, the platform's names;
  blank ⇒ the name in capitals), plus the celebration banner's title (`{jackpot} JACKPOT`) and the
  amount under it (`{amount}`, what the platform paid). Only what you write here is offered to
  Invisible Localization.
- **Respins.** The counter (`RESPINS {count}`), the award when the feature starts
  (`{count} RESPINS`), the reset (`RESPINS RESET`), the last respin (`LAST RESPIN`) and
  the respins an add-respins special adds (`+{count} RESPINS`).
- **Hold and Win feature.** These boxes hold:
  - the feature total (`BONUS WIN {amount}`);
  - an intro and an outro line, which draw nothing until you write them;
  - the instant collect (`INSTANT WIN`) and the Lucky Spin (`LUCKY SPIN`);
  - the pot-full line (`{meter} ACTIVATED`);
  - the modifiers a feature starts with (`{modifiers} ACTIVE`) and the ones a mystery
    unlocks (`UNLOCKED: {modifiers}`);
  - a collector the wheel raised, on the counter's second line (`{level} COLLECTOR`);
  - each pot's label over its bar (`{pot} {level}/{max}`);
  - an upgrade special raising coins (`UPGRADE`);
  - an expanding board opening a row: the banner title (`ROW UNLOCKED`) and the line under
    it (`{rows} ROWS`);
  - the names: the specials that `{meter}` and `{modifiers}` use (COLLECTOR, MULTIPLIER,
    PAYER, MYSTERY, ADD RESPINS, UPGRADE), the collector levels (DOUBLE, TRIPLE; an
    unnamed level reads ×4) and one box per pot in the config (an unnamed pot reads its id
    in capitals).
- **Wheel.** The segment labels (`COIN BOOST ×{count}`, `+{count} COLLECT`; a jackpot
  segment reads its tier's caption) and the banner a prize shows (`EVERY COIN ×{count}`,
  `{level} COLLECT`; a jackpot prize has no banner, its jackpot celebration follows).

The defaults are exactly what the game draws when nothing is written, so an untouched game
reads as it always has. Every one of these lines, each tier's caption and each pot's name is
listed in Localization for translation.

**Not on screen yet:** the respins awarded, reset and last-respin lines, the feature total,
the pot-full line and the intro / outro are saved and translated, but nothing draws them
until a scene or a beat uses them. The page says so above these sections.

### Pots (pots overlay)

A game with a **pots overlay** (a `potsOverlay` block in its
[Invisible Game Config](./game-config.md)) but no Hold and Win gets one **Pots** section instead of
the Hold and Win ones — its pots are the only part of that feature it has. (With Hold and Win too,
the same lines live in the Hold and Win feature section above.) It holds:

- **Pot full** — the line when a pot fills (`{meter} ACTIVATED`). Here `{meter}` is the pot's own
  name, and the preview uses the first pot. It is saved and translated, and shows once a beat uses
  it.
- **Pot label** — each pot's label over its bar (`{pot} {level}/{max}`), with a live preview.
- **One name per pot** in the config (`pot <id>`), which is what `{pot}` prints. An unnamed pot
  reads its id in capitals.

The placeholders are the ones in the table above. These lines and every pot's name are listed in
Localization for translation.

### Win-level captions

One box per **big-win tier** in the game's [Invisible Game Config](./game-config.md),
labelled with the tier's name (hover it for the tier id). A game whose config authors no
tiers shows the built-in five (`big`, `superwin`, `mega`, `epic`, `max`). A caption you
already wrote for a tier the config no longer has stays listed, so it isn't lost (clear
it to remove it).
**Usually leave these blank.** In most games the tier words (BIG WIN, MEGA WIN…) are painted into the
**big-win artwork**, and the game draws only the amount on top. If you fill one of
these in, you'll get a _second_ caption over art that already says it.

Fill them in only for a game whose big-win art carries **no words** — which is also
what lets those tiers be translated without re-cutting the artwork for every
language.

### Save

Changes are not saved until you click **Save** in the top bar. The pill beside it reads
**Unsaved** while you have changes and **Saved** with the time once they are stored.

- **Someone else saved first.** If another person saved this project's win text after
  you opened it, a banner says so. Your edits stay on the page: **Reload theirs** takes
  their version (your unsaved edits go), **Overwrite with mine** replaces theirs.
- **Someone else is editing.** Only one person edits at a time. When someone else (or
  another tab of yours) has the page open, the top bar reads "_name_ is editing this —
  read-only" and Save is disabled; **Take over** moves editing to you.

### Translate it

Everything you type here shows up in **Invisible Localization** under a **Win
text** section, with the source **read-only** (this tool owns it — edit it here).
Translate it there like any other string, review it, and save.

Only **reviewed** translations ship, exactly as for the rest of the game's text.

### Where it is stored and how it ships

One JSON document per project in the shared asset storage:

```
<client>/<project>/win-text/win-text.json
```

It's **sparse** — only what you actually typed is stored. Anything you leave blank
falls back to the game's built-in default, so a project that never opens this tool
behaves exactly as it did before.

The document holds the **source** templates; their translations travel with the
rest of the localization strings, and the game puts the two together as it draws.
There are no assets here, so nothing needs exporting — it ships with the next
build/publish of the game.

## Traps

- **The game still says the old wording.** — Players (and Game Maker's **Play ↗**) get the version
  frozen at the last Publish. Check the new text with **Live ↗** in
  [Game Maker](game-maker.md), then publish. A game opened from the test server's own list at
  `games.invisiblewall.org` runs the engine's sample game and never shows authored win text — open
  it from the launcher.
- **A translated win message ends in an English symbol name.** — `{symbolName}` is translated on
  its own, in Localization's **Symbol names** section. Translate and review the names as well as
  the templates.

## Known limitations / TODOs

- **The grid stops at 5 matching.** The match-count columns are fixed at 2–5, which
  covers every current 5-reel board; a wider board needs the list widened.
- **Some Hold and Win lines have no place on screen yet** — see "Not on screen yet" above.
- **Coin labels** (`MINI`, `×2`, the money on a coin) are not here: they belong to
  [Invisible Symbols](./symbols-state-machine.md).
- **Letters on a bitmap win-line font.** The win line is drawn in a bitmap font. If
  that font was made with digits only, a letter in your template has no glyph — check
  the win line in the game after adding words.
