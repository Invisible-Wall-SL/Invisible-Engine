# Card games: a duel against the device (the card family)

> Status: **PLAN APPROVED (owner, 2026-10-27): all seven §13 decisions accepted as recommended.**
> Written the same day. C1 (#1391) and C2 (#1408) are merged; C3 is built (§5.4); C4 is next. This is the design that
> [game-families.md](game-families.md) §10 promised for the fourth family, once P10.7 had shipped
> (§9 #15). P10.3 (variables, timers), P10.4 (drag, Align Target) and P10.7 (spawning, live sets)
> are on `main`; progress on this plan will live in
> [status/game-families.md](../status/game-families.md), as Phase 10's does.
>
> What is settled already is owned by game-families.md, and this doc links to it rather than
> restating it: the outcome (rules-decided only, §10 and §9 #4; §10 now points here), card PvP staying later (§9 #16),
> the tool table (§6.5), the family model ("What a family means", §1) and the shared runtime (§6.4,
> §9 #3). The owner's decisions on this doc are in §13.
>
> Grounded against `main` e8f7a92 (2026-10-27). "Exists" means it is in that tree; "new" means it is
> proposed here.

## Contents

1. [Scope](#1-scope)
2. [The rules engine](#2-the-rules-engine-cardsjs)
3. [Effects as data](#3-effects-as-data)
4. [The opponent](#4-the-opponent-an-on-device-ai)
5. [The table in the game](#5-the-table-in-the-game)
6. [The card frame](#6-the-card-frame-component)
7. [Where card data lives](#7-where-card-data-lives-9-14-for-cards)
8. [Invisible Card Library](#8-invisible-card-library-cards)
9. [Pipeline: config, kinds, ship chain, publish](#9-pipeline)
10. [Ownership](#10-ours-not-theirs-the-directors-ownership-rule)
11. [Not in v1](#11-not-in-v1)
12. [Build plan and gates](#12-build-plan)
13. [Decisions (owner)](#13-decisions-owner)

---

## 1. Scope

**In short:** one player plays a duel against the device. Each side has a fixed deck, a hand, a
board of units, a hero with health and a resource that grows each turn. The game's own rules decide
everything; there is no stake and no win in money. It is built the way the other families were: one
small rules module, a Flow vocabulary, data in Game Config, and the shared runtime.

**v1 is:**

- **A duel against an on-device AI** (§4). No network: the AI runs in the player's browser, in the
  same bundle.
- **Fixed decks.** The author builds the player's deck and one or more AI decks in Invisible Card
  Library (§8). The player picks among the decks the game offers, if it offers more than one; the
  player never edits a deck.
- **Free play, rules-decided, no money** (game-families §10, §9 #4): the `rules` outcome, the
  `freePlay` protocol, no wallet. An RGS-decided card config is a validation error (§9.1).
- **Two card types:** a **unit**, which stays on the board, attacks and can be attacked, and a
  **spell**, which resolves its effects and goes to the discard pile.
- **A closed list of effects** (§3): every card's behaviour is data picked from that list, so cards
  can be authored in a form and the AI can read them.
- **Replay from a seed.** A match is its seed, the two decks, the AI difficulty and the player's
  actions. Those replay it exactly, in tests and on any device.

**One match, start to end:**

1. Each deck is shuffled with the match's seeded RNG. Each player draws an opening hand; the second
   player gets one extra card (§2.5).
2. Turns alternate. A turn runs the phases start → draw → main → combat → end (§2.2).
3. The player plays cards by dragging them from the hand onto the board, or onto a target. The
   player attacks by dragging a unit onto an enemy unit or the enemy hero (§5.2).
4. A hero at 0 health loses. If both reach 0 together, the match is a draw.

---

## 2. The rules engine (`cards.js`)

**In short:** a new module, `packages/engine-mechanics/src/cards.js` (+ `cards.d.ts`), holds the
whole rule set as plain functions over a match value. It is the same shape as the match-3 board
(`board.js`): no drawing, no imports outside the package, nothing mutates its input, and every
random draw comes from the match's own seeded stream, held in the value.

**Why `engine-mechanics`.** It is the package for "the rules of a non-slot family, as plain logic
with no drawing" (`packages/engine-mechanics/index.ts`), already reached by the client through the
workspace and written as dependency-free ESM so a non-package caller can share the same file, as
the match-3 mock RGS shares `board.js` (game-families §4.0). For cards that caller is a future PvP
server (§11); in v1 the shared runtime and the Card Library's test match (§8.3) are the callers, and
the AI (§4) simulates moves with the same `apply()` the game plays.

**The RNG lives in the value.** `board.js`'s `createRng(seed)` (mulberry32, a string seed hashed
with FNV-1a) returns a closure with hidden, mutable state: "the one piece of state is the board's
`rng`, which each draw advances" (`board.js`). A match copied for the AI's look-ahead would share
that closure, so a `randomEnemy` resolved in a trial would advance the real match's stream. So a
match holds its stream as a number, `rngState`, and draws with a pure step, `rngNext(state) →
{ value, state }` (new, exported from `board.js` beside `createRng` and built on the same mulberry32
step, so both modules use one generator). `cards.js` imports it from `./board.js`, as
`behaviours.js` imports `./motion.js`.

### 2.1 The match value and the zones

```ts
interface Match {
	seed: string | number;
	rngState: number;         // the stream's state; each draw returns a new match with the next
	turn: number;             // 1, 2, 3 …; both players' turns count
	active: 0 | 1;            // whose turn it is
	phase: Phase;
	players: [PlayerState, PlayerState];
	queue: QueuedEffect[];    // the effect queue (§2.4)
	nextUid: number;          // card instances get unique ids, never reused
	result: null | { winner: 0 | 1 | 'draw'; reason: 'hero' | 'concede' | 'loop' | 'turnLimit' };
}

interface PlayerState {
	health: number;
	maxHealth: number;
	resource: { current: number; max: number };
	fatigue: number;          // the damage the next empty-deck draw deals (§2.5)
	deck: CardInstance[];     // ordered; the top is the end of the array
	hand: CardInstance[];
	board: CardInstance[];    // ordered left to right; that order is also trigger order
	discard: CardInstance[];
}

interface CardInstance {
	uid: number;
	cardId: string;           // the library entry (§3.1)
	owner: 0 | 1;
	attack: number;           // current values: the card's base plus buffs
	health: number;
	damage: number;           // a unit dies when damage >= health
	keywords: Keyword[];
	buffs: { attack: number; health: number; until: 'endOfTurn' | 'permanent' }[];
	summonedOnTurn: number;   // for the "cannot attack the turn it arrives" rule
	attacksLeft: number;
}
```

- **Four zones per player:** deck, hand, board and discard. The hero is not a card. It is the
  player's `health`, and it can be a target (§3.3).
- **Limits, from the config (§9.1):** `handLimit` (default 10; a card drawn into a full hand goes
  straight to the discard pile, and an event says so) and `boardLimit` (default 7; a unit cannot be
  played, and `summon` does nothing, when the board is full).
- **A value, not a store.** Every function returns a new match; the old one is unchanged. That is
  what lets the AI try a move and throw it away, and what lets a fixture compare two replays.

### 2.2 Turn phases

| Phase | What happens | How it ends |
|---|---|---|
| `start` | The active player's resource max grows (§2.3) and refills; each of their units gets its `attacksLeft`; `turnStart` triggers queue and resolve | By itself |
| `draw` | The active player draws one card (fatigue on an empty deck, §2.5). The first player skips it on turn 1 | By itself |
| `main` | The player plays cards from the hand | The player ends it (`endPhase`) |
| `combat` | The player declares attacks, one at a time; each resolves before the next | The player ends it (`endPhase`) |
| `end` | `endOfTurn` buffs expire; the turn passes | By itself |

- **The phases are strict in v1.** No card is played once combat has started. This is the order
  game-families' first outline of the family gave. It keeps the legal-action list short and the AI's search small. A
  Hearthstone-like mix of playing and attacking is a config switch for later (§13 #2).
- The three automatic phases run inside `apply()`. A caller only ever sees the match waiting in
  `main` or `combat`, or ended.
- **An expiring `endOfTurn` health buff never kills.** When it lapses in `end`, the unit is left at
  1 health at least, its damage cut to fit (the genre's rule). A `permanent` negative health buff
  still kills (§3.2).

### 2.3 The resource

One resource per player. Its on-screen name ("mana", "energy") is the game's text, not the rules'.

- `resource: { start, perTurn, max }` in the config. Defaults: 1, 1, 10.
- At its owner's `start` phase, `max` grows by `perTurn` up to the cap, and `current` is set to
  `max`. Unspent resource is lost at the end of the turn.
- Playing a card costs its `cost`. A card whose cost is above `current` is not a legal play.
- There is no verb that changes the resource in v1 (§3.2).

### 2.4 Legal plays, apply and the effect queue

The module's public functions:

| Function | What it does |
|---|---|
| `createMatch({ seed, decks, library, rules, first })` | Shuffles both decks, deals the opening hands, runs turn 1 to `main` |
| `legalActions(match)` | Every action the active player may take now |
| `apply(match, action)` | `{ match, events }`. Throws `IllegalAction` (with a code) for an action `legalActions` would not list |
| `isOver(match)` | `match.result !== null` |
| `cardText(card, library)` | The rules text generated from a card's effects (§3.6) |
| `validateLibrary(library)` | The schema and closed-list checks of §3, as issues |

**Actions:**

```ts
type Action =
	| { type: 'play'; uid: number; slot?: number; target?: TargetRef } // from the hand
	| { type: 'attack'; attacker: number; target: TargetRef }           // in combat
	| { type: 'endPhase' }                                              // main → combat, combat → end
	| { type: 'concede' };

type TargetRef = { unit: number } | { hero: 0 | 1 };
```

**A play is legal** when the match waits in `main`, the card is in the active player's hand, its
cost is at most `current`, a unit has a free board slot (`slot` is where it goes; absent is the
right end), and every `chosen` target its effects need (§3.3) is given and passes its filter. A card
with a `chosen` effect and no valid target is not playable.

**An attack is legal** when the match waits in `combat`, the attacker is the active player's unit
with `attacksLeft > 0`, and it did not arrive this turn unless it has `swift`. The target is an
enemy unit or the enemy hero; if the enemy has any unit with `guard`, the target must be one of
those (§3.4).

**Combat** is simultaneous: the attacker deals its attack to the target and, if the target is a
unit, takes the target's attack back. `onAttack` triggers queue before the damage; `onDamaged`
triggers queue after it.

**The effect queue.** One effect resolves at a time, first in, first out:

1. A play or an attack queues its effects (a card's `onPlay` effects in authored order).
2. The front effect resolves. Its targets are fixed at that moment: a `chosen` target from the
   action, an `allEnemies` set read now, a `randomEnemy` drawn now from the match RNG. A target that
   has left the board since is skipped.
3. **Deaths are checked after every effect.** Every unit with `damage >= health` dies at once, in
   board order, active player first. Each goes to its owner's discard pile, and its `onDeath`
   effects are queued.
4. Triggers raised by an effect (`onDamaged`, `onDeath`, a summoned unit's own triggers) go to the
   back of the queue, active player's first, then in board order. The order never depends on
   anything but the match, so a replay is exact.
5. When the queue is empty, a hero at 0 ends the match (both at 0: a draw).

**A loop guard.** Two cards can feed each other forever (a death that summons a unit that dies…).
The queue resolves at most `MAX_QUEUE_STEPS` (500) effects per action. Past that, the match ends as
a draw with the reason `loop`, and the library validator warns about the cards it can see in such a
cycle. This is the same idea as `board.js`'s `DEFAULT_MAX_STEPS` for a cascade.

**A turn limit.** A match also ends as a draw at turn `turnLimit` (default 60), so an AI that never
attacks cannot hang a game.

### 2.5 Draws, fatigue and who goes first

- **Opening hands:** `openingHand` (default 3) for the first player, one more for the second.
- **Who goes first:** `first: 'player' | 'ai' | 'random'` in the config (default `random`, drawn
  from the match RNG).
- **An empty deck:** a draw from it deals `fatigue` damage to the drawing hero, then `fatigue`
  grows by one. So a match always ends.
- **No mulligan in v1** (§11).

### 2.6 Events

`apply()` returns an ordered list of what happened, for the presentation and for Flow. It is the
card family's book: the same list in a test, a replay and the game.

`turnStarted {player, turn}` · `phaseChanged {phase}` · `drawn {player, uid, burned}` ·
`fatigue {player, amount}` · `played {player, uid, slot}` · `attacked {attacker, target}` ·
`damaged {target, amount, by, shieldBroken}` · `healed {target, amount}` · `buffed {uid, attack,
health}` · `keywordGiven {uid, keyword}` · `summoned {player, uid, slot}` · `destroyed {uid}` ·
`died {uid}` · `buffsExpired {uids}` · `matchEnded {winner, reason}`.

Each event carries the uids it names, never positions, because the board shifts when a unit dies.

---

## 3. Effects as data

**In short:** a card is a short record: what it costs, its numbers, its keywords and a list of
effects. Each effect is one **trigger**, one **verb** and one **target**, all picked from closed
lists. There are no scripts and no expressions. A card the lists cannot express is not in v1.

The lists are closed **on purpose**: the AI evaluates every card the same way (§4), the rules text
is generated from them (§3.6), the validator can check every card, and a library saved today plays
the same in any later runtime.

### 3.1 The card

```ts
interface CardDef {
	id: string;                  // stable; decks and replays name it
	name: string;                // display text; a localization key (§3.6)
	type: 'unit' | 'spell';
	cost: number;                // 0 … 10
	attack?: number;             // units only, 0 … 20
	health?: number;             // units only, 1 … 20
	keywords?: Keyword[];        // units only
	effects?: CardEffect[];      // at most 3
	flavor?: string;             // optional display text, not rules; a localization key
	frame?: string;              // a card-frame component id; absent ⇒ the game's default (§6)
	params?: Record<string, string | number | boolean>; // the frame's param overrides: the art (§9.3)
	token?: true;                // only summoned, never in a deck
}
```

### 3.2 Verbs

| Verb | Fields | Allowed targets | Does |
|---|---|---|---|
| `damage` | `amount` 1…20 | any | Deals damage. A `shield` absorbs the whole hit and is lost |
| `heal` | `amount` 1…20 | any | Removes damage (a unit) or adds health up to `maxHealth` (a hero) |
| `draw` | `amount` 1…5 | none: the card's owner draws | Draws cards (fatigue applies) |
| `summon` | `card` (a library id), `count` 1…3 | none: the owner's board, to the right of the source | Puts new units on the board; skipped when it is full |
| `buff` | `attack` −10…10, `health` −10…10, `until` | units | Adds to attack and health. A negative health buff can kill |
| `destroy` | — | units | The unit dies (its `onDeath` triggers; `shield` does not stop it) |
| `giveKeyword` | `keyword` | units | Adds a keyword |

### 3.3 Targets

| Target | Fields | Means |
|---|---|---|
| `self` | — | The unit the card is. Not allowed on a spell |
| `chosen` | `side: 'enemy' \| 'friendly' \| 'any'`, `include: 'units' \| 'characters'` | The player picks one when the card is played. Only on an `onPlay` effect: no other trigger has a moment to choose in |
| `allEnemies` | `include` | Every enemy unit, plus the enemy hero when `include` is `characters` |
| `randomEnemy` | `include` | One of those, drawn from the match RNG at resolution |

"Characters" means units and the hero, as in the genre. `allFriendly` and `randomFriendly` are not in
v1 (§13 #3).

### 3.4 Triggers

| Trigger | When | On |
|---|---|---|
| `onPlay` | The card is played from the hand | Units and spells (a spell's effects are all `onPlay`) |
| `onDeath` | The unit dies (after the death check) | Units |
| `turnStart` | Its owner's `start` phase | Units on the board |
| `onAttack` | The unit attacks, before damage | Units |
| `onDamaged` | The unit takes damage and survives the hit or not | Units |

A summoned unit's `onPlay` does **not** fire: it was not played. A `turnStart` effect on a unit
played this turn first fires on its owner's next turn.

### 3.5 Keywords

| Keyword | Means |
|---|---|
| `guard` | Enemies must attack a `guard` unit before any other target (§2.4) |
| `swift` | Can attack the turn it arrives |
| `shield` | The next damage to it is absorbed in full, then the shield is gone |

The names are ours; the rules are common to the genre (§10).

### 3.6 Exact schema, validation and rules text

```ts
type Keyword = 'guard' | 'swift' | 'shield';
type Trigger = 'onPlay' | 'onDeath' | 'turnStart' | 'onAttack' | 'onDamaged';
type Include = 'units' | 'characters';

type Target =
	| { kind: 'self' }
	| { kind: 'chosen'; side: 'enemy' | 'friendly' | 'any'; include: Include }
	| { kind: 'allEnemies'; include: Include }
	| { kind: 'randomEnemy'; include: Include };

type CardEffect = { trigger: Trigger } & (
	| { verb: 'damage'; amount: number; target: Target }
	| { verb: 'heal'; amount: number; target: Target }
	| { verb: 'draw'; amount: number }
	| { verb: 'summon'; card: string; count?: number }
	| { verb: 'buff'; attack: number; health: number; until: 'endOfTurn' | 'permanent'; target: Target }
	| { verb: 'destroy'; target: Target }
	| { verb: 'giveKeyword'; keyword: Keyword; target: Target }
);
```

**Validation** (`validateLibrary`, and the same checks in the Game Config validator, §9.1). Errors
refuse a save; warnings show.

- Errors: an unknown verb, trigger, target or keyword; a verb with a target its row in §3.2 does
  not allow; `self` on a spell; `chosen` off `onPlay`; a spell with a non-`onPlay` effect; a unit
  without `attack` / `health`; a number outside its range; a `summon` of a card that is not a unit
  or does not exist; a duplicate id; more than three effects.
- Warnings: a `summon` cycle that can loop (§2.4); a card no deck uses; a token in a deck.

**Unknown fields and values follow [doc-readers.md](../conventions/doc-readers.md).** A reader
drops what it does not know and never fails the doc over it: an unknown field on a card is dropped,
and an unknown verb, trigger, target kind or keyword drops the smallest element around it (the
effect, or the keyword), with one server warning, as `stripUnknownKeys` does. So the "unknown verb …"
errors above are the **validator's**, raised on what an author submits in this launcher; a stored
library from a newer launcher still loads. The cost is the one doc-readers.md accepts: an older
launcher that saves such a library drops the newer effects. A card that lost an effect is then
playable but different, so the Card Library shows the read's warning on the card before a save.
Keeping unknown blocks on save, as Symbols and Win Text do, is not proposed for the config.

**Rules text is generated, never typed.** `cardText(card, library)` turns the effects into one
sentence each, from a fixed template per verb and target, in English ("Deal 2 damage to a chosen
enemy unit."). The text is the card's source string, and with the source-as-key model the
Localization tool already uses (`localizationHarvest.ts`), the English is the key: a translator
translates each generated sentence once, and every card that says the same thing shares it. A new
"Cards" harvest section (§9.4) collects every card's name, flavour and generated sentences.

---

## 4. The opponent: an on-device AI

**In short:** the AI plays its turn by trying each legal action on a copy of the match, scoring the
result, and taking the best. It is a module beside the rules (`cardAi.js`), pure and seeded, so
an AI turn replays exactly. Built in C2; what C2 settled that this section left open is in §4.4.

### 4.1 The policy

Each time the AI must act, it chooses one action, then is asked again, until it chooses
`endPhase` out of `combat`:

1. **Lethal first.** In `combat`, if the damage its ready units can deal to the enemy hero (through
   or past any `guard`) is enough, it attacks the hero.
2. **Otherwise, one step of look-ahead.** For each legal action, `apply()` it to a copy and score
   the result with `evaluate(match, side, weights)`. Take the highest. `endPhase` is scored too, so
   the AI stops when nothing beats doing nothing.
3. **Ties** go to the action listed first by `legalActions`, which lists in a fixed order (hand
   order, board order). Randomness enters only through §4.2's `mistakes`.

`evaluate` is a weighted sum, read off the match:

| Term | Default weight |
|---|---|
| My hero's health − the enemy hero's | 1.0 |
| My board's total attack + health − the enemy's | 1.5 |
| Units I have with `guard` / `shield` | 0.5 each |
| Cards in my hand − in the enemy's | 0.7 |
| The enemy hero at 0 | +1000 |
| My hero at 0 | −1000 |

This plays its best affordable card, and takes trades that win board value: the two things
the family's first outline asked of it. It reads every card the same way because every card is the closed
lists of §3.

**A random target is not looked ahead.** An action with a `randomEnemy` effect is scored by its
expected result over the possible targets, so the AI never peeks at the RNG.

### 4.2 Difficulty

A per-deck setting, in the config beside the AI decks (§9.1):

| Setting | `easy` | `normal` | `hard` |
|---|---|---|---|
| `mistakes`: chance to take a random legal action instead of the best | 0.30 | 0.10 | 0 |
| `lethal`: checks for lethal first | no | yes | yes |
| `plan`: looks at whole sequences of plays in `main` (beam search, width 4, depth 3) instead of one action | no | no | yes |
| `weights` | the defaults, board term 1.0 | the defaults | the defaults |

The authored deck matters as much as the difficulty; a designer tunes both in Invisible Card
Library's test match (§8.3). `weights` can be overridden per AI deck for a deck that should play
aggressively or defensively.

### 4.3 Seeds and replay

- The AI draws only from its **own** stream, seeded from `${seed}:ai:${side}`, never from the
  match's.
  So an AI mistake roll never shifts a shuffle or a random target, and the match's own draws are
  the same whichever difficulty plays.
- **A replay record** is `{ seed, decks, library, rules, first, ai, actions }`: `ai` seats the AI
  (`{ side, difficulty, weights }`; two seats for an AI-vs-AI test match), and `actions` are the
  player's only. Replaying runs the AI again and reaches the same match, so the AI's actions need
  not be stored. `check:card-ai` pins this (§12).
- **The AI's thinking time is presentation.** It decides at once; the table waits a short
  authored delay (a Flow timer, P10.3) before showing each action, so the player can follow it.
  Speed never changes a choice.
- **Budget.** `hard`'s plan search tries every play from the match, keeps the 4 best sequences and
  extends each by every play, three plays deep: about A + 4·A + 4·A trials, where A is the plays
  listed at a step (fewer as the resource runs out). A trial is one `apply()` call, or four when the
  play draws from the stream (§4.4), and such a play ends its sequence. `MAX_PLAN_APPLIES` (600) caps
  every `apply()` one decision makes, the lethal search's and the samples' included; a search that
  reaches it stops and takes the best found so far. It must finish under 16 ms on a mid phone.
  `check:card-ai` pins the real call count (a fixed count, not wall time) on two full boards: a hand
  of plain units and two targeted spells (36 actions listed) takes **200** calls and completes; a
  hand of ten targeted spells (95 actions listed) would take 704 and **stops at 600**. The second
  measured 11–14 ms on the build machine; a phone's time is C3's to measure.

### 4.4 What C2 settled

- **The API** (`cardAi.js` + `.d.ts`): `aiSettings({ difficulty, weights })` resolves a preset with
  a deck's weight overrides (only the known weights are read; a non-number throws);
  `createAi({ seed, side, difficulty, weights })` is the AI as a value;
  `chooseAction(ai, match) → { action, ai, applies }` never changes either input and never
  concedes; `evaluate(match, side, weights)`; `replayMatch(record)`.
- **One stream per AI side,** `${seed}:ai:${side}`, so two AIs in a test match never share one.
- **Each decision rolls once** on that stream for a mistake, and once more to pick the mistaken
  action (any listed action but `concede`).
- **The look-ahead never reads the match's stream.** Every trial runs on a copy whose `rngState` is
  one of four fixed sample streams, chosen so their first draws fall in the middle of each quarter
  of [0, 1). An action whose first trial draws nothing is certain and scored once; otherwise it is
  scored by the mean over the four, which weighs a pick from two or four targets exactly and from
  any other number closely. The lethal search counts a branch that draws as no win, and a plan
  does not extend a play that drew: what follows it would rest on one sample's outcome.
- **Nor the deck's hidden order.** A trial of a `draw` puts the real top card in the copy's hand,
  so a plan only plays cards that were in the hand when the decision began. The evaluation reads
  the hand's size, never its cards.
- **The lethal search** runs in `combat` for `normal` and `hard`: depth first, at each `guard` while
  one stands, then at the hero with the first attacker whose attack draws nothing, inside
  `MAX_LETHAL_APPLIES` (100) of the budget. It is skipped when the ready units' attack and
  `onAttack` damage cannot reach the hero (our units' `onDamaged` / `onDeath` damage is not
  counted, so a lethal that needs it is not sought).
- **A certain win in one action is taken at once** by every level, before any other is scored,
  unless that decision's mistake roll fires.
- **Doing nothing is the match as it is,** scored without an `apply()`, and it wins ties; among the
  rest the first listed wins. Ending `combat` therefore never looks worse for the enemy's coming
  draw.
- **Two readings of §4.1's table:** a unit counts as it will be once its `endOfTurn` buffs lapse (so
  a temporary buff is worth nothing on its own), and the `guard` / `shield` term is mine minus the
  enemy's (so breaking an enemy shield counts), like every other term.
- **A replay record** carries the library, rules and `first` the module needs, and its difficulty
  lives on each `ai` seat (§4.3), not at the top.

---

## 5. The table in the game

**In short:** the shared runtime gets a card branch, as it has a match-3 and an arcade branch. A
driver runs the match, raises its events into Flow, and asks the AI for its turn. The hand and the
boards are spawn layers. Dragging a card is the P10.4 drag; deciding where it was dropped is new.

### 5.1 The runtime branch

It follows the match-3 layering (game-families §6.4, option A), and mounts like arcade: today
`Game.svelte` mounts `<ArcadeStage />` instead of the reel stack when `mechanic.playField` is set,
and the reel stack otherwise. That `if / else` becomes three-way, with `<CardTable />` under the new
`cardTable` flag.

| Layer | Match-3 (exists) | Card (new) |
|---|---|---|
| Rules | `engine-mechanics` `board.js` | `engine-mechanics` `cards.js`, `cardAi.js` |
| Session and driver | `engine-game` `match3Session.ts`, `match3Driver.ts` | `engine-game` `cardSession.ts`, `cardDriver.ts` |
| Runtime module | `apps/lines/src/game/match3.svelte.ts` | `apps/lines/src/game/cards.svelte.ts` |
| Mounted view | `<Match3Input />` beside `<Board />` (arcade: `<ArcadeStage />` instead of the reel stack) | `<CardTable />` instead of the reel stack |
| Mechanic | `MATCH3_RULES_MECHANIC` (`engine-game` `mechanic.ts`) | `CARD_RULES_MECHANIC`: no spins, bets, RGS session or wallet; a new flag `cardTable: true` |

- `mechanicFor()` returns `CARD_RULES_MECHANIC` for a `card` rules config, and an `unplayable`
  mechanic for a `card` config that says `rgs`, as it does for arcade today. The boot then refuses
  it with the existing boot-failure screen.
- `MechanicId` gains `'card'`.

### 5.2 Hands, boards and drag

- **The zones are spawn layers** (P10.7): `hand` (the player's), `board` and `enemyBoard`, plus the
  enemy hand drawn as card backs. Each is a `spawnLayer` node on the table screen with the card
  frame (and any per-card frame) in its `spawnable` list, so the ship chain already collects them
  (game-families §6.3). Flow's `forEach` over `$live.board` is "my units".
- **The driver owns the spawns,** not Flow: a drawn card spawns into the hand, a played unit moves
  to the board. Flow reacts to the events (§5.3), as a match-3 Flow reacts to the board's.
- **Per-instance params are new.** A spawned instance today is a component with no params of its own
  (`SpawnedInstance` in `engine-flow-v2` `spawn.ts`). A card needs its own art and frame params. The
  driver's spawns carry a `params` map, which `<SpawnLayer>` passes to `ComponentInstance` as a
  placed instance's params are passed. Flow's `spawn` node is unchanged in v1.
- **Layout in a zone** (a fanned hand, a centred board row) is the table's job, computed from the
  zone's count and its node's size, and written as each instance's x / y, as the arcade loop writes
  positions. Reordering animates with the existing tweens.
- **Drag** is P10.4's: the card frame's listeners raise `dragStart` / `drag` / `dragEnd` with the
  pointer payload, in the instance's space. Align Target moves a node *inside* the frame, so the
  art follows the finger while the instance itself stays in its zone; the table converts the
  pointer reading to the table's space for the drop, and lifts the dragged instance's z-order while
  the drag lasts.
- **Dropping is new.** Nothing today asks "which instance or zone is under this point". The table
  hit-tests the drop point against the board zone's rectangle (play a unit at the nearest slot) and
  the live instances' bounds and the hero portraits (a target). The candidates are only those
  `legalActions` allows for the dragged card, so the frames light `targetable` (§6) during the drag
  and an illegal drop snaps the card back.
- **Taps work too:** tap a card, then tap a target, for players without drag precision.

### 5.3 The Flow vocabulary (`CARD_VOCAB`)

A new `packages/engine-flow-v2/src/reference/cards.ts`, registered in `TEMPLATE_VOCABULARIES`
(`reference/registry.ts`) with a starter in the driven-seed registry, as match-3 and arcade are. It
keeps the standard palette's presentation surfaces (screens, sounds, cues, camera and element
effects) and none of its reel, bet or payline surfaces, as `MATCH3_VOCAB` does.

**Signals** (one per §2.6 event the presentation reacts to): `matchReady {first}`,
`turnStarted {mine, turn}`, `phaseChanged {phase}`, `cardDrawn {card, mine, burned}`,
`cardPlayed {card, mine}`, `unitAttacked {attacker, target}`, `damaged {target, amount}`,
`healed`, `unitSummoned`, `unitDied {card}`, `matchEnded {won, reason}`.

**Actions:** `cardsEndPhase`, `cardsConcede`, `cardsNewMatch {deck}`, `cardsSetInput {enabled}`
(hold the player's input during a cutscene), and `cardsHint` (light a playable card).

**Engine keys** (read-only `$engine`): `myHealth`, `enemyHealth`, `resource`, `resourceMax`,
`deckCount`, `enemyDeckCount`, `turn`, `phase`. The HUD can also bind them as value sources, as
`var:<id>` sources are bound (P10.3).

**What Flow does not do:** decide anything. Like an RGS-decided match-3 flow, a card flow is
presentation and game flow (menus, the deck pick, the result screen), never rules. There is no
`withOutcome` strip because there are no rules-only actions to strip: the rules are all in
`cards.js`.

### 5.4 What C3 settled

- **Per-instance values ride `registerInstanceValues`, not spawn params.** A spawned card's frame
  reads its live values (name, rules text, cost, attack, health, art and the 0 / 1 look flags) as
  `engineProvided` params fed under its instance id, so `spawn.ts` and `<SpawnLayer>` are unchanged
  and a stat change redraws without a remount. The §6 inputs are declared on the frame too, for an
  authored state machine.
- **Drag is the frame's own P10.4 listeners.** The placeholder's hit rect raises `cardTap`,
  `cardDragStart`, `cardDrag`, `cardDragEnd` and Aligns its body (`cardFrame-body`) to the pointer;
  the runtime observes the events by instance id (`observeComponentEvents`) and reads the drop from
  the canvas pointer in each zone's space (`spawnLayerPoint`). A snapped-back card is respawned, which
  resets its aligned body. A tap picks a card and a second tap (a unit, a hero, the board) is its drop.
- **The table is the `basegame` screen**, shown from boot under the loading and deck-pick screens:
  the runtime needs a `basegame` scene, and `<CardTable />` is inside it.
- **What is registered before the layout mounts:** the `cards.*` value sources, the End Turn button's
  action and the Flow effects are registered at `Game.svelte` init for a card table, because a
  readout or a button looks its source up once, when it mounts.
- **Signal payloads:** a card is its library id (`card`, `attacker`), a target a unit's card id or
  `myHero` / `enemyHero`, `matchReady.first` a bool (true when the player starts).
- **The device's pace** is the driver's `deviceDelayMs` (600 ms) before each action, presentation
  only (§4.3). A new match after the first is seeded `${seed}:${n}`, so each replays.
- **The config validator runs `cards.js`'s `validateLibrary`:** `game-config` depends on
  `engine-mechanics` (dependency-free) rather than restating §3.6.

---

## 6. The card-frame component

**In short:** a card is a component authored in the Component Editor, used for every card in the
game: frame art, text boxes, number readouts and a state machine. One frame, many cards. A card
changes only its inputs and its art.

**Inputs** (`COMPONENT_INPUT_KINDS` already has `bool`, `number`, `trigger` and `text`):

| Input | Kind | Fed by |
|---|---|---|
| `name`, `rulesText`, `flavor` | text (a localization key, P10.3's widened `source`) | the driver, from the card |
| `cost`, `attack`, `health` | number | the driver; current values |
| `damaged`, `buffed`, `debuffed` | bool | the driver: draw a number red or green |
| `guard`, `shield`, `swift` | bool | the driver |
| `faceDown` | bool | the driver (the enemy hand, the deck) |
| `inHand`, `onBoard` | bool | the driver: which zone it is in. Bools, not one `zone` value: a `text` input is a localization key, and the state machine never conditions on one |
| `playable`, `ready`, `targetable`, `attacking`, `dying` | bool | the driver, from `legalActions` and the events |
| `hit`, `healed`, `summoned` | trigger | the driver, on the events |

**State machine states** (the component's own, `engine-layout` `stateMachine.ts`), switched by the
bool inputs above and the pointer listeners:

| State | When | Typically |
|---|---|---|
| `inHand` | In the hand, not playable | Dimmed |
| `playable` | In the hand and legal to play now | A glow |
| `hover` | The pointer is over it in the hand | Lifted and enlarged |
| `dragging` | Being dragged | Tilt, shadow |
| `onBoard` | A unit at rest on the board | The compact board look |
| `ready` | On the board and can attack | A glow |
| `targetable` | A legal target of the card or unit being dragged | A marker |
| `attacking` | Its attack is playing | A timeline that lunges at the target (§5.2 places it) |
| `dying` | It died | A death timeline; the driver despawns it when the state ends |

**A frame is a component, not data:** components are shared and presentation only
(rive-style-editor.md §2), the principle game-families §9 #7 applied to arcade bodies. The card's numbers
and effects are game rules and live in the config (§7); the frame only shows them. A game may have
more than one frame (a unit frame, a spell frame, a legendary frame), named per card with `frame`,
and every frame must take the inputs above (the Card Library's validator checks the interface).

**The default frame.** Game Maker's card scaffold (§9.2) ships a placeholder frame with every input
and state above, as the arcade scaffold ships placeholder components, so a new card project plays
before any art exists.

---

## 7. Where card data lives (§9 #14 for cards)

**In short — decided (§13 #1): in Game Config, as a `card` block**, as arcade characters are (§9 #14).
A doc of its own stays possible later, behind the same helpers.

| | **A. `GameConfigDoc.card` (decided)** | B. A card doc of its own |
|---|---|---|
| Ship chain | The config's bake already carries it; two collectors, mirroring `betModeCardIds` and `betModeCardParamRefs`, ship the frames and art | A new asset class: export → `deploy/` → bake → pull → register, end to end (rule 8), its own `check:art-scope` arm |
| Versions, backups, conflict check | The config's (`saveGameConfigDoc`: etag, `putDocWithBackup`, History) | New: its storage helper, etag and backups (`pipeline-concurrency` work) |
| Lease | One lease with Game Config: two people cannot edit cards and config at once | Its own lease |
| The rules engine's input | One object: the rules and the cards together | Two docs to load and keep in step |
| Size | A 200-card library is about 60 KB of JSON inside the config, inside the runtime bundle; fine | Same bytes, another file |

**Why A.** For a card game the config holds little besides the cards: no paytable, no reels, no
bet modes. The person editing the cards is the person editing the rules, so the shared lease costs
almost nothing, and A reuses the bake, versions, backups and lease that already work.

**When to move to B:** if a game's library outgrows the config (a guard at 512 KB of card data, in
the Card Library, would say so), or two people regularly need to edit cards and rules at once. The
move is a storage change behind `cardLibraryOf(config)`; nothing that reads cards would change.

---

## 8. Invisible Card Library (`/cards`)

**In short:** a new tool for a card project's cards and decks. Every card is shown in the real
card-frame component; its numbers and effects are a form; the rules text writes itself; a test
match plays the decks against each other. It is a new tool, so rule 9 applies.

### 8.1 Registry and access

- **`TOOLS.cards`** in `apps/launcher-api/src/lib/roles.ts`: name **Invisible Card Library**, `kind:
  'online'`, `url: '/cards'`, an icon, `isNew`. In the `build` stage of `TOOL_STAGES` beside
  `characters`, so `TOOL_BAR_ORDER` follows.
- **`ROLE_TOOLS`:** the roles that hold `gameConfig` today (`developer`, `artist`,
  `pipelineTester`; `admin` has every tool).
- **`FAMILY_TOOLS`:** `cards` is added to the exclusions of `slot`, `match3` and `arcade`, and
  `card: ['symbols', 'winText', 'characters']` is added (game-families §6.5's table already has the
  Card column). `FAMILY_TOOLS` is typed `Record<GameFamily, …>`, but the launcher build does not
  type-check (`apps/launcher-api/CLAUDE.md`), so a missing key is caught by `check:family-tools`
  and `check:card-family` (§12.1), not by the compiler.
- **`TOOL_DOC_SLUG.cards = 'invisible-card-library'`.**
- **Two grants, as Invisible Characters:** the page holds the whole config, so it needs the Game
  Config grant too, and refuses (403) without it (`(app)/characters/+page.server.ts` is the
  pattern).

### 8.2 The page

- **The card list:** a grid of every card drawn in its real frame (the `ComponentInstance` the game
  uses, through the editor's component rendering), with filters by type, cost and keyword, and a
  search.
- **The card form:** name, type, cost, attack, health, keywords as toggles, the frame, the frame's
  art param (an image picker over the project's atlases, as the Component Editor's param row has),
  flavour, and up to three effects. Each effect is three dropdowns (trigger, verb, target) and the
  verb's numbers; a dropdown offers only what §3's tables allow for the choices already made, so an
  invalid effect cannot be built.
- **Live preview:** the card in its frame, updated as the form changes, with the generated rules
  text, and buttons that show each state (§6).
- **Decks:** the player decks and the AI decks, each a list of `{ card, count }` with its size
  checked against `deckSize`, a cost curve chart, and, for an AI deck, its difficulty and weights.
- **The test match (§8.3).**
- **Saving** goes through `PUT /api/game-config`, under the `gameConfig` lease, with the config's
  conflict check and History, as `/characters` does. Validation errors anywhere in the config are
  listed; the card ones link to the card.

### 8.3 The test match

A match in the page, with placeholder table art: pick two decks and a difficulty, play one side, or
watch the AI play both sides at a chosen speed. It runs `cards.js` and `cardAi.js` themselves, the
code the game runs. "Run 100" plays 100 AI-vs-AI matches on seeds 1…100 and shows the win rate per
deck, the average match length and the cards most often left in the hand: the designer's balance
check. Any match can be copied as its replay record, to file a bug against.

### 8.4 Its docs (rule 9), in the same change as the tool

- **`docs/tools/invisible-card-library.md`**, written by the `docs-keeper` agent from the real
  route: what it edits, where the cards are stored (the config, the shared lease, History), the
  form, decks, the test match, and that it shows only for card projects.
- **Its row in `docs/tools/README.md`**: `/cards` (card projects only), the default roles.
- **The onboarding link:** `/docs/invisible-card-library` renders it.
- **Game Config's guide** (`docs/tools/game-config.md`, the Game family part) gains the card family,
  and `/config`'s card section links to the Card Library as its Arcade section links to Invisible
  Characters.

---

## 9. Pipeline

### 9.1 The `card` family in Game Config

All in `packages/game-config`, sparse and optional like `match3` and `arcade`, so every existing doc
normalizes byte for byte (`check:family-defaults-identity`).

- **`CONFIG_FAMILIES`** gains `'card'`; it must match `GAME_FAMILIES` (`family.fixture.ts` fails if
  they part).
- **`GameConfigDoc.family`** widens to `'match3' | 'arcade' | 'card'`.
- **`GameConfigDoc.card`** (new, `CardBlock`):

```ts
type CardBlock = {
	rules?: {
		startHealth?: number;     // default 30
		openingHand?: number;     // default 3
		handLimit?: number;       // default 10
		boardLimit?: number;      // default 7
		deckSize?: number;        // default 30; decks must match it
		maxCopies?: number;       // default 2 per card per deck
		resource?: { start?: number; perTurn?: number; max?: number }; // 1, 1, 10
		first?: 'player' | 'ai' | 'random';                            // random
		turnLimit?: number;       // default 60
	};
	library?: CardDef[];         // §3.1
	decks?: {
		id: string;
		name: string;            // a localization key
		side: 'player' | 'ai';
		cards: { card: string; count: number }[];
		ai?: { difficulty: 'easy' | 'normal' | 'hard'; weights?: Partial<AiWeights> };
	}[];
};
```

- **`resolveCard(doc)`** applies the defaults, as `resolveArcade` does.
- **The normalizer.** Today it refuses a doc with no symbols and strips unless it is arcade
  (`normalize.ts`: `if (!hasBoard && family !== 'arcade') return undefined`). A card doc has no
  board either, so that line names a set of board-less families, `arcade` and `card`, instead of one
  family. `normalizeCard` keeps the block only beside `family: 'card'`.
- **Validation** (`familyValidate.ts`): an RGS-decided card config is an error ("a card game is
  decided by its own rules"), as an RGS arcade config is (§9 #21's pattern), so `/config` offers
  the card family only **Rules**; the library checks of §3.6; each deck's size, copies, and card
  ids; at least one player deck and one AI deck.
- **`/config` sections** (`familySections.ts`): `configSectionsFor('card', 'rules')` returns a new
  `card` section only: the rules numbers, and a link to the Card Library with the card and deck
  counts. Cards and decks are edited in the Card Library, not in `/config`. Raw JSON shows, as for
  every family.
- **The family picker** (`/config` `FamilySection.svelte`) offers Card beside Match-3 and Arcade;
  it is still never shown to a slot project (§9 #22).
- **Two collectors** for the ship chain: `cardGameComponentIds(doc)` (every `frame` named by a
  card) and `cardGameParamRefs(doc)` (each card's `params` with its frame), the twins of
  `betModeCardIds` / `betModeCardParamRefs`. The names say "card game" because "card" already means
  a buy-feature card in the config (`betModePresentation[mode].card`).

### 9.2 `GAME_KINDS`, kind capabilities and Game Maker

- **`packages/constants-shared/gameKinds.ts`:** `GAME_KINDS` gains `'card'`, `GAME_FAMILIES` gains
  `'card'`, and `FAMILY_OF_KIND` maps `card → card`. `SLOT_GAME_KINDS` is unchanged, so the
  slot-only consumers stay as they are (§9 #27).
- **The copies of the family map** must learn it in the same change: `kindCapabilities.ts`
  (`FAMILY_KINDS`, a hand copy kept so the current-games harness's built-in defs load with no
  install, and `familyCapabilities`, with `board: false`, `wallet: false`, `betControls: false`),
  `familyGate.ts`'s `FAMILY_NAMES`, `roles.ts`'s `FAMILY_LABELS` (`card: 'card'`) and the delivery
  gate's message (`scripts/delivery-family-gate.mjs`). Three of these are typed `Record`s over the
  family (`FAMILY_TOOLS`, `FAMILY_LABELS`, `FAMILY_NAMES`), but a type error still builds green in
  the launcher, so the guard is a runtime gate: `check:card-family` (§12.1) checks every list, and
  `check:game-config-family` already pins `FAMILY_KINDS`. The harness's
  `SCRIPT_FOR_KIND` (`scripts/current-games/lib/plan.mjs`) gains `card` when a card game first goes
  live, with its screen script.
- **Game Maker** offers `card` only once `engine-layout` has its full scene set: the launcher's
  `selectableGameKinds()` (`gameKinds.ts`) offers a kind registered in `FULL_SCENE_SOURCES`
  (`engine-layout` `referenceLayouts/index.ts`). So C3 adds a `card` reference layout there and a
  `card` layout template (`templates/card.ts`), with the table screen (the zones as spawn layers, the hero portraits, the resource and deck
  readouts, an end-turn button), a deck-pick screen and the result screen. It seeds the config
  (`family: 'card'`, `outcome: 'rules'`, a small sample library and two decks), the starter Flow
  and the placeholder frame. No outcome question: a card game has one.
- **The scaffold** (`projectScaffold.ts`) creates the placeholder frame component for a card
  project, as it does the arcade sample's components.

### 9.3 The ship chain (rule 8)

**No new R2 asset class** under §7's decision. Everything a card game needs is already on the
chain, and the cards ride the config:

| Step | What carries the card game |
|---|---|
| **Export** | `editorArtExport.ts` seeds its component walk with `cardGameComponentIds` (as it seeds `characterComponentIds`), and classifies `cardGameParamRefs` by the frame's param kind (image → atlas, rig → bundle), as it does `betModeCardParamRefs`. So a card's art ships though no scene places it |
| **`deploy/`** | Unchanged: the frames' defs and their atlases are written as every component's are |
| **Bake** | `runtimeBundle.ts` seeds the def resolution with the same ids (beside `characterIds`), and the config, with its `card` block, is baked as `config` already is |
| **Pull** | Unchanged: the atlases are mirrored into `static/assets/` with the rest |
| **Register** | The runtime reads the cards with `resolveCard(bakedGameConfig())`; the frames register as every component does |

- `check:art-scope` gains a card arm: a card whose frame or art is named only in the config ships.
- The current-games fixture bake mirrors publish, so it seeds the same ids.
- **If the data ever moves to B (§7's "When to move")** this table becomes a new asset class: `cardsExport.ts` →
  `deploy/cards.json` → an index in the bundle → pulled → `registerCards()`, mirroring `fontExport.ts`.

### 9.4 Localization

The **"Cards"** harvest section (new, `localizationHarvest.ts`, listed in
`localizationSections.ts`) collects each card's `name`, `flavor` and its `cardText()` sentences, and
each deck's name. They live in the config, which the scene walk never sees, so this is the same
reason the "Bet modes" section exists. A rules-text template change re-harvests; the reviewed-only
bake applies as for every section.

### 9.5 Publish and `familyGate`

- **No change to the gate.** `unplayableFamilyMessage` (`familyGate.ts`) refuses on
  `mechanicFor(config).unplayable`, never on the family (§9 #26). The family, its config and its
  playable mechanic land in the same step (C3), so a rules card config publishes from the day it
  can be made; only an RGS card config is `unplayable` and refused (§5.1). `FAMILY_NAMES` gains
  `card: 'card'`.
- **Protocol:** a rules game is dealt `freePlay` by its outcome (`deriveMockContract` in
  `mockContract.ts`; `protocolFor` maps only the kind), whose mock refuses every request, as for a
  free-play match-3 or arcade game. No new protocol and no mock RGS.
- **Partner sessions and delivery** stay refused: `partnerRgsRefusal` already refuses every
  non-slot game, and `scripts/delivery-family-gate.mjs` already refuses "any other family … any
  added later". Both need only their names learned.
- **`runtimeFor()`** stays `SHARED_RUNTIME_ID`. The card code joins the inlined bundle; C3 reports
  its size, as P10.5 and P10.8 did, and the per-family runtime build (status open item 8) would
  take it out of slot bundles too.

---

## 10. Ours, not theirs (the Director's ownership rule)

The Director's rule is that what we ship is ours or the client's (`docs/director/SPEC.md` ground
rule 6; the ownership check of ADR-0005). For cards:

- **The mechanics are common to the genre** and are not owned: a cost, a resource that grows, units
  that attack, a "must be attacked first" rule.
- **Names, rules text, frames and art must be our own or the client's.** So the keywords have our
  names (`guard`, `swift`, `shield`), the generated rules text has our wording, and the sample
  library is invented. No card, frame, card name, set symbol or rules phrase is copied from Magic:
  The Gathering, Hearthstone or any other game, including as a placeholder.
- **Director** has no Card Library ops. It may author card libraries only once its own plan
  (`docs/director/`) adds card games, and then through the same ownership check its mockups go
  through. Its gate already refuses, for a card project, the ops of the tools the family hides
  (Symbols, Win Text), by the rule of game-families §6.5.
- **The Card Library has no import in v1** (§13 #6). If one is added, a pasted or uploaded card
  list is accepted only with the same confirmation Director asks for a mockup.

---

## 11. Not in v1

- **Online play** and any PvP (§9 #16), and so no game server for cards.
- **Packs, collections, an economy, rewards**; **deck-building by players**; a mulligan.
- **Scripted or custom effects**, and any verb, target, trigger or keyword outside §3's lists.
- **Money of any kind** (§9 #4), and so no RGS-decided card game, no wallet, no delivery.
- **Interleaving play and combat** (§13 #2), secrets / hidden traps, auras ("while this is on the
  board"), weapons, hero powers, discover / choose-one, card generation into the hand.
- **A server-side record** of matches or a ladder; a high score, if any, is on the device (§9 #8).
- **A card doc of its own** (§7, §13 #1).

---

## 12. Build plan

**In short:** five steps after this plan is approved. The rules and the AI come first, with no
caller, as the board module did (P10.2). A card game is playable after C3 and authorable in its own
tool after C4. Every step is a pipeline change under the Director rules, and none changes a slot
game (game-families §7.1 applies to each).

| # | Step | Scope | Packages | Size |
|---|---|---|---|---|
| C0 | **Plan + decisions** (this doc) — ✅ approved 2026-10-27 | Owner review of §13 | docs | S |
| C1 | **The rules engine** — ✅ merged (#1391) | `cards.js` + `cards.d.ts`: the match value, zones, phases, the resource, `legalActions`, `apply`, the effect queue, the death check, the loop and turn limits, fatigue; `validateLibrary`; `cardText`; fixtures. No caller | `engine-mechanics` | M |
| C2 | **The AI** — ✅ built 2026-10-27 | `cardAi.js` + `.d.ts`: lethal, one-step evaluation, the three difficulties with `hard`'s plan search, its own seeded stream; replay records; the budget | `engine-mechanics` | M |
| C3 | **Card family, end to end** — ✅ built 2026-10-28 | `card` in `GAME_KINDS` / `GAME_FAMILIES` / `CONFIG_FAMILIES` and every copy of the family map (§9.2); `GameConfigDoc.card`, `resolveCard`, the normalizer's board-less set, validation, the `/config` card section and picker; the two collectors on the ship chain; `CARD_RULES_MECHANIC`; `cardSession.ts`, `cardDriver.ts`, `cards.svelte.ts`, `<CardTable />` with drop hit-testing and per-instance spawn params; `CARD_VOCAB` and its starter; the `card` layout template and scene set (which puts `card` in Game Maker); the scaffold's placeholder frame; the "Cards" localization section; the bundle-size cost reported; a sample game and `docs/playtest/card-sample.md` | `constants-shared`, `game-config`, `engine-game`, `engine-layout`, `engine-flow-v2`, `apps/lines`, launcher | L |
| C4 | **Invisible Card Library** | `/cards`: registry, roles, `FAMILY_TOOLS`, the doc slug; the list, form, live preview, decks, test match and "Run 100"; its docs under rule 9 in the same PR | launcher, `docs/tools/` | L |
| C5 | *(optional, after a decision)* **Phase switches and more lists** | Interleaved play and combat (§13 #2); any verbs, targets or keywords the owner adds to the closed lists (§13 #3) | `engine-mechanics`, launcher | M |

**Why this order.** C1 and C2 are pure and gated in Node, so the rules can be argued about with
fixtures before any screen exists. C3 before C4 because a tool that edits cards no runtime can play
would only make a library no one can test in the game; until C4 the sample library is edited as
Raw JSON in `/config`. C4 then makes it authorable.

### 12.1 Gates

| Step | Check | What it proves |
|---|---|---|
| C1 | `check:card-rules` | Each phase's order; the resource's growth and refill; every legality rule of §2.4 (cost, board full, `chosen` required and filtered, `guard`, `swift`, exhausted attackers); each verb on each allowed target; `shield` absorbing one hit; simultaneous deaths in board order, active player first; trigger order; the loop guard ends as `loop`; fatigue; the turn limit; a seed and an action list replay byte for byte; `apply` never mutates its input |
| C1 | `check:card-library` | `validateLibrary` errors and warnings for every rule in §3.6; `cardText` for every verb × target, pinned as strings; the reader drops unknown card fields (§3.6) |
| C2 | `check:card-ai` | Lethal is taken when there; the AI never makes an illegal action; each difficulty replays under a seed; the AI's draws never move the match RNG; `hard` stays inside its `apply()` budget on a full board; `normal` beats `easy` on seeds 1…100 with the sample decks |
| C3 | `check:card-family` | `card` in every family list (constants, config, kind capabilities, the harness copies, the gates' names); a slot doc and every committed fixture normalize unchanged (with `check:family-defaults-identity`); an RGS card config is refused and `unplayable`; `/config` shows a card project only its section; `FAMILY_TOOLS` hides Symbols, Win Text and Characters from a card project and Card Library from every other family (with `check:family-tools`) |
| C3 | `check:card-runtime` | The starter game plays headless to a result from a seed; the free-play branch sends no RGS request; every §2.6 event reaches its Flow signal; a drop off a legal target snaps back |
| C3 | `check:art-scope` (extended) | A frame and art named only in the card library ship |
| C3 | `check:flow-publish-gate` (extended) | The card starter flow passes the publish gate |
| C4 | `check:cards-tool` | The page's form offers only valid trigger × verb × target choices; it saves through the config endpoint under the `gameConfig` lease; it needs both grants; the test match uses the same modules as the game |

The slot parity rules of game-families §7.1 (docs byte-identical, published snapshots untouched,
the bundle diff naming only new modules and the named edited ones, the current-games harness at 0
changed screens, `check:svelte` not rising) hold for C3 and C4.

---

## 13. Decisions (owner)

**#1–#7 DECIDED (owner, 2026-10-27): every recommendation is accepted as written.** No question
is open. The C0 row is done, C1 and C2 are merged and C3 is built; C4 is next.

1. **Where card data lives.** *(owner, 2026-10-27: as recommended)*
   - **In Game Config, as `GameConfigDoc.card`** (§7, option A). It reuses the bake, versions,
     backups and lease, and needs no new asset class. The cost is the shared lease, which matters
     little when the config holds almost nothing else. A doc of its own only if a library outgrows
     the config or two people must edit at once.
2. **Strict phases, or play and attack in any order?** *(owner, 2026-10-27: as recommended)*
   - **Strict phases in v1** (start → draw → main → combat → end, §2.2), the order the family's
     first outline gave. It keeps the rules and the AI's search simple and the turn readable. Mixed
     order (the Hearthstone feel) is an optional C5 switch, if playtests ask for it.
3. **The size of the closed lists.** *(owner, 2026-10-27: as recommended)*
   - **Exactly §3's lists for v1**: seven verbs, four targets, five triggers, three keywords.
     Additions come later, each from a card a designer cannot make (one entry in the list, the
     validator, `cardText` and the AI's scoring). The first likely ones are `allFriendly` and a
     resource verb.
4. **Who goes first, and the second player's compensation.** *(owner, 2026-10-27: as recommended)*
   - **Random, with one extra card for the second player** (§2.5), both in the config. A spendable
     "coin" card is a later choice once the sample is played.
5. **AI difficulty levels.** *(owner, 2026-10-27: as recommended)*
   - **Three presets, `easy` / `normal` / `hard`** (§4.2), set per AI deck, with weight overrides
     for a deck's style. `hard` is the only one that plans a whole turn, within a fixed budget.
6. **Card imports into the Card Library.** *(owner, 2026-10-27: as recommended)*
   - **No bulk import in v1.** Cards are authored in the form. If an import is added later, it
     requires the same ownership confirmation Director asks for mockups (§10), so a copied card list
     cannot enter a project unconfirmed.
7. **The first sample game.** *(owner, 2026-10-27: as recommended)*
   - **A small invented set of about 24 cards and two decks** (one per side, ~15 cards each in the
     sample, `deckSize` lowered to match), with placeholder frames, made by C3. It is enough to
     exercise every verb, target, trigger and keyword once, and it is ours.
