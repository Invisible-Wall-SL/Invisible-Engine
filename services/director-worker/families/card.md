---
family: card
---
# Card family pack

This run re-themes a card game: a duel against the device on one table, where each side draws from
its deck, spends a resource to play units and spells, and attacks the other hero until one falls.
It is played for free with no wallet; the rules engine (`cards.js`) decides every match from its
seed. What follows is what the card family adds to your definition. Where it is more specific than
your definition, it wins.

## Locked items

The whole Game Config is locked, and with it:
- the card library: every card's id, type, cost, attack, health and effects;
- the decks, their sizes, the hand size, the draw and the extra card for the second player;
- the resource, its start and growth, the hero health, the board limit, the copies per card, who
  goes first, the turn limit and the other rules numbers;
- the device's play and its pace;
- the match result the game's flow reads.

A mockup element that depends on one of these is Left out, naming the item: for example a card the
library does not hold, a cost or stat the card does not have, or a second resource the rules do not
keep.

## Mockup screen tags

The owner tags each mockup with the screen it shows:
- **Table**: the board in play, with both heroes, the units on each side, the resource and deck
  readouts and the end-turn button.
- **Hand**: the player's hand of cards, a card frame up close, and the enemy hand as card backs.
- **Deck pick**: the screen where the player picks a deck before a match.
- **Match won**: the result screen when the player wins.
- **Match lost**: the result screen when the player loses.
- **Match drawn**: the result screen when the match ends in a draw.
- **Intro**: the splash or intro screen before play.

## Region batch order

Plan region batches in this order unless the owner reorders: Card art, Card frames & backs, Heroes,
Table & backgrounds, HUD & UI kit, Result banners.

Judge a card's art at the size the hand shows it, not only on the table: its name, cost, attack and
health must stay readable over it. A card frame keeps its zones and hit area: re-skin inside them,
never move or resize them.

## QA books and screens

A card game is played from its seed with scripted drags, not books. No current-games screen script
covers the card family yet; report the table at load, a card dragged from the hand onto the board,
an attack on a unit and on the hero, and the result screen.

## Never

- Edit a math contract: Game Config, the card library, decks, costs, stats, effects, the resource
  or the turn rules.
- Rebind or remove anything bound to the rules (a card's library values, the `$engine` readouts,
  a hero's health, the End Turn action), even if it appears in a layout.
- Use Symbols or Win Text: the card family has neither.
