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
matching**, then **Any count**).

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

If a message is fired with no symbol, the game uses **Amount only** rather than
printing an empty name — so you never see a blank or a stray `{symbolName}`.

**Show the symbol as an image.** Tick this and the `{symbolName}` in the info-bar
message is drawn as the symbol's own art, sized to the text, instead of its name. An
animated symbol (flipbook or spine) is held on its first frame so the sentence stays
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

### Win-level captions

One box per big-win level (`big`, `superwin`, `mega`, `epic`, `max`). **Usually leave
these blank.** In most games the tier words (BIG WIN, MEGA WIN…) are painted into the
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
  another tab of yours) has the page open, the top bar reads "*name* is editing this —
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
- **Leaving the page drops unsaved edits without asking.** — This page has no leave warning: the
  tool bar, Back or closing the tab discards anything not saved. **Save** first.

## Known limitations / TODOs

- **The grid stops at 5 matching.** The match-count columns are fixed at 2–5, which
  covers every current 5-reel board; a wider board needs the list widened.
- **The win-level list is fixed.** The caption boxes are a built-in list of level
  names rather than the tiers authored in [Invisible Game Config](./game-config.md).
- **Letters on a bitmap win-line font.** The win line is drawn in a bitmap font. If
  that font was made with digits only, a letter in your template has no glyph — check
  the win line in the game after adding words.
