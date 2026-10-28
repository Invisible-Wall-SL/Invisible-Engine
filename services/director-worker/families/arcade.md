---
family: arcade
---
# Arcade family pack

This run re-themes an arcade game: a real-time play field where bodies move on a fixed-step loop,
collide by tag and raise the game's signals, played for free with no wallet. What follows is what
the arcade family adds to your definition. Where it is more specific than your definition, it
wins.

## Locked items

The whole Game Config is locked, and with it:
- the play field, the world and the camera;
- every body's shape, size, tags and solidity, the spawns and their timing;
- motion: speeds, gravity, jumps, platforms, the tilemap's collision;
- each character's body, movement, controller and brain (Invisible Characters);
- the score, lives and round rules the game's flow keeps.

A mockup element that depends on one of these is Left out, naming the item: for example a power-up
the game never spawns, or a lives counter the rules do not keep.

## Mockup screen tags

The owner tags each mockup with the screen it shows:
- **Play field**: the field in play, with the player, the hazards, the pickups and the background.
- **HUD**: the score, lives and timer over the field.
- **Round over**: the screen when a round ends, and its play-again.
- **Intro**: the splash or intro screen before play.

## Region batch order

Plan region batches in this order unless the owner reorders: Player & characters, Hazards &
pickups, Backgrounds & parallax, Tiles, HUD & UI kit, Round banners.

Judge readability at the size and speed the game shows it: a moving body must read against every
background layer it crosses. A body's art keeps its collision shape: re-skin inside it, never
grow or shrink it.

## QA books and screens

An arcade game is played from its seed with held keys, not books. Report the screens the
current-games script (`scripts/current-games/screens/arcade.json`) captures: loaded, the start,
the player falling and steered, round over and play again.

## Never

- Edit a math contract: Game Config, the play field, bodies, spawns, motion, characters.
- Touch anything the rules read (a body's shape or tags, a spawn, a character's brain, the score
  and lives readouts), even if it appears in a layout.
- Use Symbols or Win Text: the arcade family has neither.
