# Invisible Card Library

Author the **cards and decks of a card game**. Every card is drawn in its real card frame (the
component the game draws it in), its numbers and effects are a form, and its rules text writes
itself from the effects. A **test match** plays the decks against each other with the game's own
rules and AI, so you can check the balance before you publish.

- **Where it runs:** Cloud (the launcher itself, Railway), full-page at `/cards`.
- **Access:** sign in at `app.invisiblewall.org`, then open `/cards` (granted to `developer`,
  `artist` and `pipelineTester` by default — the same roles as Invisible Game Config; `admin`
  always).
- **Scope:** per **active project**, and **card projects only**. A slot, match-3 or arcade project
  does not list the tool, and a direct link shows "Invisible Card Library is not used by slot
  games" (or "match-3", "arcade") with a link back to the launcher.

## Where the cards are stored

The cards and decks live **inside the game config** (the `card` block of the project's Game Config
document: `card.library` and `card.decks`). So:

- they ship with the config — Publish and the bake carry them, with no extra export;
- **Save** writes the whole game config through the same save as Invisible Game Config, with the
  same conflict check and the same **History** of versions (open it from Game Config). If someone
  else saved while you were editing, a red note offers **Reload theirs** (your unsaved edits go)
  or **Overwrite with mine**;
- the two tools share **one edit lease**: while someone has Game Config (or this tool) open on the
  project, the other shows read-only with a presence banner in the top bar. Two people cannot edit
  both at once;
- the page holds the whole game config, so it needs the Game Config grant as well: a user given
  this tool without Game Config is refused (403), as `/config` would refuse them;
- the whole config must be valid to save. Errors outside the cards are listed in a note at the top
  ("fix them in Invisible Game Config") and keep **Save** disabled. The top bar shows the error
  count, **Unsaved** while there are changes, and **Saved** with the time after a save. Leaving the
  page with unsaved changes asks first.

The game's rules (hero health, hand and board limits, **Deck size**, **Copies per deck**, the
resource, who goes first) are set in Game Config's **Card game** section, not here. That section's
**Edit in Invisible Card Library** link opens this tool.

If the project's config is not a card config (its family is not set to Card in Game Config), the
page says so and stays read-only. If the stored library holds something this launcher does not
know (a verb from a newer launcher, say), a note names what it drops: saving writes the library
without it.

Each card's name, flavour, rules-text sentences and each deck's name are strings in
[Invisible Localization](localization.md)'s **Cards** section.

## The page

Three tabs: **Cards**, **Decks** and **Test match**.

### Cards

**The card grid (left).** Every card in the library, drawn small in its frame, with its id (and
`· token` for a token). A red dot marks a card with errors. Above it:

- **Search** — matches the id, name and flavour;
- **Type** (every type, units, spells), **Cost** (any, 0 … 6, 7+) and **Keyword** (any, `guard`,
  `swift`, `shield`) filters;
- **＋ Unit** / **＋ Spell** under the grid add a card (a new unit is cost 1, 1 / 1; a new spell
  starts with one effect).

Click a card to edit it. Its problems are listed at the top of the form.

**Card.**

- **Id** — the name the decks and summon effects use. Type a new one and press **Rename**: the id
  changes everywhere it is named (decks and other cards' summons). An id is letters, digits, `-`
  and `_`; a taken one is refused.
- **Name**, **Type** (Unit or Spell), **Cost** (0–10) and, for a unit, **Attack** (0–20) and
  **Health** (1–20). A number outside its range is put back in it. Switching a unit to a spell
  drops its attack, health, keywords and token, and refits its effects (a spell's effects all fire
  when played); a spell switched to a unit gets 1 / 1.
- **Keywords** (units): **guard**, **swift**, **shield** as toggles, and **token** — a card that is
  only summoned, never put in a deck.
- **Flavour** — display text, not rules.
- **Duplicate** copies the card right below it with a new id. **Delete** asks first and removes the
  card from every deck; it is refused while another card summons it ("change those first").

**Effects.** Up to three per card. Each effect is a row of dropdowns read left to right:
**trigger** → **verb** (with its numbers) → **target**. Each dropdown offers only what the rules
allow after the choices to its left, so an invalid effect cannot be built:

- **Trigger** — When played, When it dies, At its turn start, When it attacks, When damaged. A
  spell only has When played.
- **Verb** — `damage`, `heal`, `draw` (an amount), `summon` (a unit from the library, × 1–3; only
  offered once the library has a unit), `buff` (atk and hp, −10 … 10, permanently or until end of
  turn), `destroy`, `giveKeyword` (a keyword).
- **Target** — itself (units only), a chosen target (only When played; then enemy, friendly or
  any), all enemies, a random enemy; and whether it hits **units** or **units or hero** (the hero
  only for `damage` and `heal`). `draw` and `summon` have no target.

**＋ Effect** adds one (greyed out at three); **×** removes one.

**Frame and art.**

- **Frame** — the component the card is drawn in. Blank uses the game's default (`cardFrame`); the
  list offers the components named by a card or that take a card's `name` and `rulesText` inputs.
  A frame that is not a component in this project is marked "(not found)" and warned about.
- **Art** — one image picker per image param the frame has, over the project's atlases. A frame
  with no image param has no per-card art.
- A frame that does not take every card input warns, naming the missing ones: the game cannot show
  all of a card on it.

**Preview (right).** The card drawn larger in its frame, updated as you edit. The look buttons —
**In hand**, **Playable**, **On board**, **Ready**, **Targetable**, **Face down**, **Damaged**,
**Buffed** — show the card as the frame draws each state (damaged shows one damage, buffed +1 /
+1). Below it, the **Rules text**: one sentence per effect, written from the effects. It is written
once the card's own errors are fixed. The preview is a light drawing of the frame (containers,
rects, text, sprites and nested components); any other node in the frame is named under the card
as "Not drawn here".

### Decks

**The deck list (left)**, in two groups: **Player decks** and **AI decks**. Each row shows the
deck's name, its id, its size against the **Deck size** rule and, for an AI deck, its
difficulty; a red dot marks a deck with errors. **＋ Player deck** / **＋ AI deck** add one (up to
8 a side). A card game needs at least one of each.

For the selected deck:

- **Id** (with **Rename**) and **Name**; the size reads `n / deckSize` cards, at most `maxCopies`
  of each (both from Game Config's rules), and turns red when the size is off.
- **Duplicate** and **Delete** (asks first; its cards stay in the library).
- **Cost curve** — a bar chart of how many cards in the deck cost 0, 1, … 6 and 7+.
- **The AI** (AI decks only) — **Difficulty** (easy, normal, hard) and the weight overrides
  **health**, **board**, **keyword**, **hand** and **win**. A blank weight uses the difficulty's
  own (shown greyed); weights give a deck its style.
- **Cards** — every card the library has that a deck can hold (tokens are left out), drawn in its
  frame with a **−** / **＋** counter. **＋** stops at the copies limit.

The deck's problems (wrong size, too many copies, a card not in the library) are listed at the top.

### Test match

A match on the page, with placeholder text in place of table art. It runs the game's own rules and
AI code on the config **as it is on the page**, saved or not. It needs a valid library and decks:
with card or deck errors it says to fix them first.

- **Side A** and **Side B** — a deck and a difficulty each (any deck, player or AI).
- **Match** — a **Seed** (the same seed gives the same match), the **Mode** (**Watch the AI play
  both sides**, or **Play side A yourself**) and the **AI speed** (Slow, Normal, Fast, Instant).
- **Start match** deals it. The table shows each side's hero health, resource, deck and hand
  counts, its board and its hand (side B's hand is face down while you play). Playing side A, the
  buttons on your cards play them (on a target where it needs one) or attack; **End** the phase or
  **Concede** sit in the status line. **What happened** logs each turn, play, attack, damage,
  death and the result.
- **Run 100** plays 100 AI-vs-AI matches between the two picked decks on seeds 1 … 100 and shows
  each side's win rate, draws, the average number of turns, what the matches ended by, and the
  cards most often left in hand — the balance check.
- **Copy replay** copies the current match's replay record (seed, decks, library, rules, AI and
  every action) to the clipboard, to attach to a bug report.

## Traps

- Deleting a card removes it from every deck: a deck that held it is then short until you refill
  it.
- Rules text is not written for a card with errors, so its frame shows none until they are fixed.
- The test match plays what the page holds right now, saved or not: save before you publish.

## Known limitations / TODOs

- **The test match has no table art.** It is a text table, not the game's frames and board; play
  the published game to see the real table.
- **The preview is a stand-in.** Frame nodes other than containers, rects, text, sprites and nested
  components (a rig, an effect) are not drawn.
- **Closed lists.** Triggers, verbs, targets and keywords are the rules engine's fixed set; a new
  one needs an engine change, not a config edit.
