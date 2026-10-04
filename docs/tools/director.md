# Invisible Director

> **Early access.** The page exists so you can find it. It does not do anything yet.

Invisible Director will make a new game by re-theming a game that already works. Today the page only
explains the plan.

## What it is

Director is planned to build a new game from a working template game. Runtime agents will do the
work inside the existing tools, and the run will stop at checkpoints for you to review. Agents will
never publish and never change the template's math. You publish in Invisible Game Maker.

- **Where it runs:** the launcher itself, at `/director`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it sits in the **Create** section, next to Game
  Maker and Game Config.
- **Access:** the `director` tool. By default only the `admin` role has it. Admins can grant or
  revoke it per role in **Admin › Roles**, or per user.
  - Not signed in: you are sent to the sign-in page.
  - Signed in without access: the page shows a 403 error, "Your role does not have access to
    Invisible Director."

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`).
2. Open the **Invisible Director** card in the Create section, or go to `/director`.
3. Read the page. It shows an **early access** tag, a short explanation and three cards for the
   screens that are coming:
   - **New game** — name the project and pick its client, game type and a template game to re-theme.
     Choose an art preset, upload mockups or describe the style, and set the checkpoints.
   - **Mockup breakdown** — the first checkpoint. Each mockup element is mapped to a template
     region, and anything that clashes with the locked math is flagged. Nothing renders until you
     confirm.
   - **Live run** — agents work across Atlas Maker, Symbols, Scene Editor and the other tools. You
     approve or redo each region and can message the coordinator mid-run.

The cards are not buttons. As the page says: "Nothing on this page does anything yet." To make a
game today, use [Invisible Game Maker](game-maker.md).

## What's coming

This is the plan, not working features. Source: `docs/director/SPEC.md` §1.

- **New game screen.** The same project fields as Game Maker, a template (an existing project of the
  chosen game type), an art preset, mockups and/or a style description, and the checkpoints. The
  template's math, reel strips and feature rules are locked. You must confirm the mockups belong to
  us or to the client before a run can start.
- **Mockup breakdown.** Shows what was found in each mockup, which template region it maps to, and
  what clashes with the locked math. Nothing goes to RunPod until you confirm.
- **Live run.** Progress by step and by region group, a review panel to approve or redo each region,
  an activity feed, and a message box to the coordinator. "Play draft" opens the authoring build,
  never a publish.

## Known limitations / TODOs

- Everything. The page is an explanation only: no form, no runs, no agents.
- The build plan and progress live in `docs/director/PLAN.md` and `docs/director/HISTORY.md`.
