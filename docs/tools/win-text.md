# Invisible Win Text

Author **what the game says about a win** — the message on the win line, how the
pay amount reads, and the info-bar message — per symbol and per match count. Every
field is a **template**, and every template is picked up automatically by
[Invisible Localization](./localization.md) for translation.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/win-text` (granted to
  `developer`, `artist`, `pipelineTester` and `localizationReviewer` by default;
  `admin` always).
- **Scope:** per **active project** (use the project selector on the launcher home).
  Each project has its own win text.

## Templates, not strings

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

### Name your symbols first

`{symbolName}` is the whole point: the game says **which** symbol paid, not how
many matched in the abstract. The names live in **Invisible Symbols** — each symbol
row in that tool has a **Name** and a **Plural** box (`H1` → "Banana" / "Bananas").

- Rename a symbol there and **every** message here follows, with no edit.
- The plural is used whenever the count isn't 1. Leave it blank for names that
  don't change ("Wild", "Bonus").
- A symbol you haven't named falls back to its raw id — the message still works, it
  just says "4 H1". This tool tells you when nothing is named yet.

This is also what makes win text **translatable**. A translator translates the
template once (`{count} {symbolName}` → `{count} × {symbolName}`) and the name
once, and the game fills them in afterwards — so one translation covers every win.
A finished sentence like "You win $1.00 with 2 Bananas" could never be translated,
because there'd have to be a separate translation for every possible amount.

You never need to translate the currency: `{amount}` is formatted for the player's
own locale and currency automatically, from the game URL.

## The win-line grid

Rows are your project's symbols, columns are the match counts.

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
- **Give one symbol its own line** — type in that symbol's **Any count** box, e.g.
  `SCATTER` for `S`.
- **Call out one exact win** — type in that symbol's box under that count, e.g.
  `JACKPOT LINE!` for `H1 × 5`.

A symbol rule beats a count rule: `S` → `SCATTER` wins over `2` → `PAIR!`, because
a scatter pays anywhere rather than in a run along a line.

## Win amount

How the pay amount is stamped on the win line. Default is just `{amount}`; make it
`WIN {amount}` if you want the word.

## Info-bar message

The message that flashes when a win pays — this is the one that **names the symbol**.
There are **three** boxes because the game says whatever fits what it knows about
the win:

- **Amount + symbol** — the normal case: `You win {amount} with {count} {symbolName}`
- **Amount only** — a message fired without a symbol (any flow can fire one):
  `You win {amount}`
- **Symbol only** — no amount: `{count} {symbolName}`

The page shows a **live preview** of what the current templates will actually say,
using one of your real symbols.

If a message is fired with no symbol, the game uses **Amount only** rather than
printing an empty name — so you never see a blank or a stray `{symbolName}`.

## Free spins

The celebration line for a **retrigger** — when a player wins **extra free spins in
the middle of the feature**. Write `{count}` where the number of extra spins goes:

- **Retrigger** — `You won +{count} Extra Free Spins`

It's one sentence on purpose, so it **translates** as a whole (word order and where
the number sits are the translator's to decide). To show it in a game, author a
retrigger screen and bind a text node's **source** to `freeSpinsAddedText` — you keep
full control of the font, size, colour and position, exactly like any other text box.
(For a bare "+10" number with no words, bind `freeSpinsAdded` instead.)

## Win-level captions

**Usually leave these blank.** In most games the tier words (BIG WIN, MEGA WIN…)
are painted into the **big-win artwork**, and the game draws only the amount on
top. If you fill one of these in, you'll get a _second_ caption over art that
already says it.

Fill them in only for a game whose big-win art carries **no words** — which is also
what lets those tiers be translated without re-cutting the artwork for every
language.

## Translating it

Everything you type here shows up in **Invisible Localization** under a **Win
text** section, with the source **read-only** (this tool owns it — edit it here).
Translate it there like any other string, review it, and save.

Only **reviewed** translations ship, exactly as for the rest of the game's text.

## Storage

One JSON document per project in R2 (bucket `invisibleassets`):

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
