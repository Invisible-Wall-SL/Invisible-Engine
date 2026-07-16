# Invisible Win Text

Author **what the game says about a win** — the message on the win line, how the
pay amount reads, and the info-bar message — per symbol and per match count. Every
field is a **template**, and every template is picked up automatically by
[Invisible Localization](./localization.md) for translation.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/win-text` (granted to
  `developer` and `artist` by default; `admin` always).
- **Scope:** per **active project** (use the project selector on the launcher home).
  Each project has its own win text.

## Templates, not strings

You don't write the finished sentence — you write a **template** with placeholders,
and the game fills them in:

| Placeholder | Becomes |
|---|---|
| `{count}` | the match count — the N in "N of a kind" |
| `{amount}` | the pay amount, already in the player's currency |
| `{symbol}` | the paying symbol's id, e.g. `H1` |
| `{line}` | the payline number |

So `{count} OF A KIND` shows as **3 OF A KIND** on a three-symbol win and **5 OF A
KIND** on a five.

This is also what makes win text **translatable**. A translator translates the
template once (`{count} OF A KIND` → `{count} GLEICHE`), and the game fills the
number in afterwards — so one translation covers every win. A finished sentence
like "Win $1.00 — 2 of a kind" could never be translated, because there'd have to
be a separate translation for every possible amount.

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
  count**), e.g. `{count} OF A KIND`.
- **Change just "2 of a kind"** — type in the **Any symbol** row under the **2 of a
  kind** column, e.g. `PAIR!`.
- **Give one symbol its own line** — type in that symbol's **Any count** box, e.g.
  `SCATTER` for `S`.
- **Call out one exact win** — type in that symbol's box under that count, e.g.
  `JACKPOT LINE!` for `H1 × 5`.

A symbol rule beats a count rule: `S` → `SCATTER` wins over `2` → `PAIR!`, because
a scatter pays anywhere and isn't really a "2 of a kind" at all.

## Win amount

How the pay amount is stamped on the win line. Default is just `{amount}`; make it
`WIN {amount}` if you want the word.

## Info-bar message

The message that flashes when a win pays. There are **three** boxes because the
game says whatever fits what it knows about the win:

- **Amount + count** — the normal case: `Win {amount} — {count} of a kind`
- **Amount only** — a win with no match count: `Win {amount}`
- **Count only** — `{count} of a kind`

## Win-level captions

**Usually leave these blank.** In most games the tier words (BIG WIN, MEGA WIN…)
are painted into the **big-win artwork**, and the game draws only the amount on
top. If you fill one of these in, you'll get a *second* caption over art that
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
