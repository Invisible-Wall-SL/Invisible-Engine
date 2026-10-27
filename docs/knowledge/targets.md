# Targets

What the pipeline is for, in one page. Read this before anything else. Details are in the linked
files; when this page and one of them disagree, the linked file wins. Fix this page.

## What we are building

**Invisible Wall SL makes casino and casual games and the tools to make them fast.** There are two
products:

1. **Invisible Engine**: one shared game runtime (`apps/lines`, Svelte 5 + PixiJS 8) that every
   online game boots. A game is **authored content** (art, layouts, flows, symbol states, text,
   sound, a math contract) that the runtime reads. It is not a code fork. Engine changes go to
   `main` and reach every online game through the runtime release.
2. **The Studio** (`apps/launcher-api`, app.invisiblewall.org): the online tools that author that
   content, plus Game Maker, which publishes it. The Python services (Atlas Maker, Sheet Maker) and
   ComfyUI on RunPod generate the art.

**The goal:** a person (or Director, for a reskin) can take a game from idea to a published,
playable, partner-ready build **in the tools, without writing code**, and no change to the pipeline
ever breaks a game that already ships.

## Who the games are for

- **Real-money slots** for the partner's RGS, the **Play4Fun** protocol
  (`docs/reference/play4fun-protocol.md`), through `packages/rgs-translator-eagaming`. Money must be
  exact: the client and the server agree on every win (`pnpm check:rgs`).
- **Delivery builds** that a partner hosts (`docs/design/delivery-builds.md`). For now they are
  slot only.
- **Non-slot families** (`docs/design/game-families.md`): match-3, then arcade, then card games.
  Each can be **rules-decided** (free play) or **RGS-decided** (real money). The arcade target is
  **Salmons**, a 100-player real-time game (`docs/design/realtime-multiplayer.md`).

## Game kinds and families

The one list is `packages/constants-shared/gameKinds.ts`. The slot kinds are lines, ways, cluster,
scatter and holdAndWin; `bookOf` is retired and is now Lines with the Book of Thermopylae preset.
The non-slot kinds are match3 and arcade. Add-ons on any slot: the pots overlay and bonus games.
Each family sees only its own tools (`FAMILY_TOOLS` in `apps/launcher-api/src/lib/roles.ts`).
Owners: `docs/knowledge/owners.json`.

## Non-negotiables

1. **Never break a current game.** The current-games harness (ADR-0004) rebuilds every published
   game and compares its key screens. A visible change needs the owner's approval.
2. **Math is locked.** Paytable, bet modes, RTP, reel strips and feature rules change only in Game
   Config, by a person. Agents never change them; a mockup or a note never does.
3. **Every asset class an R2 doc adds ships through the whole chain**: export → `deploy/` → bake →
   pull → register (root `CLAUDE.md` rule 8). Showing in the editor is not shipping.
4. **Tools are full-page and named "Invisible …"**, and every tool has its guide in the same change
   (rules 3 and 9).
5. **Secrets live only in env vars.** No secret in a commit, a prompt or a doc.
6. **Two users never overwrite each other**: leases plus conditional R2 writes
   (`docs/design/multi-user-concurrency.md`).
7. **Only the owner merges and publishes.** Agents propose, open draft PRs and stop at
   checkpoints.

## How work flows

- **A pipeline change** (tool, engine, template, agent definition) is its own branch and PR. It
  merges when the checks pass, the current-games check is green and the owner approves (ADR-0007).
- **A game change** is made in the tools on that project's content, then published in Game Maker.
- **Bugs** come in through Pipeline Bug Reports (`/bugs`) or Game Bug Reports (`/game-bugs`).
  Pipeline bugs go to a branch named `bug-<n>-…`. Game bugs are fixed in the project's content
  only (ADR-0009).

## Where to look next

`docs/STATUS.md` (roadmap, owner blockers, the map of every tool) → the tool's
`docs/status/<tool>.md` → `docs/knowledge/lessons/<area>.md` for what has bitten before.
