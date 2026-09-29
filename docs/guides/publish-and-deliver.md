# Publish and deliver

How a game's authored content gets to players, and how to put an earlier version back. This covers
the online **Publish** in Invisible Game Maker and switching a game between its published versions.
It also covers how the desktop **☁ Publish** and **📦 Deliver** builds relate to them. Their
steps are in the [Publisher runbook](publisher-runbook.md).

This runbook is about a game's **content**: scenes, art, flow, symbols, sounds, strings and config.
The **engine** that online games run is shipped separately, by a merge to `main`. See
[Release and rollback](release-and-rollback.md) for that.

## The three ways a game reaches players

| Path | Where it plays | Which engine it runs | What freezes the content | Where you press it |
| --- | --- | --- | --- | --- |
| **Online Publish** | `https://games.invisiblewall.org/<key>/`, against the mock RGS | the shared engine runtime, which every online game follows | a **published version** (snapshot) in R2 | `/game-maker` in the launcher |
| **Desktop ☁ Publish** | `https://games.invisiblewall.org/<cloud key>/`, against the mock RGS | compiled into this build from the game repo's engine submodule | the build itself | the desktop Invisible Launcher |
| **Desktop 📦 Deliver** | a partner's own site | compiled into this build, like ☁ Publish | the build itself; nothing is uploaded | the desktop Invisible Launcher |

A game made in Game Maker uses the online path. A game only needs its own repo and a desktop build
when it goes to a partner, or when it needs compiled code of its own.
[Build your first game](build-your-first-game.md) walks the whole path from an empty project.

## When to use this runbook

- You want players to get the edits you saved (online Publish, section A).
- A publish shipped something wrong, and you want players back on an earlier version (Make live,
  section B).
- An engine release has marked games **Engine update available** (section C).
- You need to know how a desktop build or a partner delivery differs from an online publish
  (section D). For the desktop steps themselves, use the [Publisher runbook](publisher-runbook.md).

Use a different runbook when:

- **An engine change is missing from a game, or broke every game.** Publishing cannot fix that. See
  [Release and rollback](release-and-rollback.md).
- **A game is blank or down, and nobody has just published or merged.** See
  [Incident first response](incident-first-response.md).
- **Authored files or the database were lost.** See [Backups and restores](backups.md).

## Permissions

These are granted to roles, not people. An admin changes them in `/admin` → Roles, or per user.

| To do this | You need |
| --- | --- |
| Open Game Maker, create or duplicate a project | the `gameMaker` tool. It is on by default for `admin`, `developer` and `pipelineTester`. |
| **Publish**, **Re-publish**, **Make live**, and the bulk republish buttons | the **Build & publish games** (`gamePublish`) capability, plus access to the project. It is on by default for `admin` only. |
| Publish past a **flow errors** or **paytable drift** refusal | the `admin` role |
| **Make live** a version tagged **flow errors** | the `admin` role |
| Desktop ☁ Publish and 📦 Deliver | Invisible Launcher v1.0.56 or newer, signed in with `gamePublish`. No R2 keys. |

## How to tell what players are getting

Check this before you change anything. "My edit isn't in the game" usually means the edit was saved
but never published, or someone made an older version live.

1. **The version line on the Game Maker card.** Under a published game's buttons, it reads
   *"Players get the version published `<date, time>` by `<who>`"*. If the scene layout was saved
   after that version, it adds **Scenes edited since — publish to ship them**. An amber note,
   *"Published before versioned snapshots — players get live authoring data"*, means the game has
   no published version yet. Republish it.
2. **The `X-IE-Runtime-Source` response header.** Open the game with **Play ↗**, open DevTools →
   Network, and filter for `runtime`. Select the request to
   `app.invisiblewall.org/api/editor/runtime` and read its response headers. The response body
   also has a `published` object with the version's `id` and `createdAt`.

   | `X-IE-Runtime-Source` | Meaning |
   | --- | --- |
   | `snapshot` | A player boot, served the published version. This is normal. |
   | `live` | An authoring boot (**Live ↗**, or a Games card on the launcher home page) built from the current saved data. Players never get this. |
   | `live-fallback` | A player boot of a game with no published version (published before versions existed, or its snapshot file is missing). Players are getting live authoring data. Republish it. |

3. **The engine, which is a separate question.** Online games follow the shared engine runtime. The
   game page's `X-Runtime-Release` header names the release it came from. See "Where to look" in
   [Release and rollback](release-and-rollback.md).
4. **For a desktop build,** type `__IE_BUILD__` in the game tab's console, or open
   `https://games.invisiblewall.org/<cloud key>/build-info.json`. Both give the build number and
   the engine, game and lockfile commits.

## A. Publish a game online

1. **Save everything and check it on your current data.** Publish ships what is saved in the
   authoring tools. On the Game Maker card, press **Live ↗**. It opens the game on your current
   saved data, with unreviewed translations included.
   *Check:* the change you want to ship is in the game that opens.
2. **Press Publish** (the button reads **Re-publish** once the game exists). A dialog,
   *"Publish `<name>`?"*, names the project key and says when its scenes were last edited. Check
   that it is the right project, then confirm. A publish takes about 20–30 seconds.
   *Check:* the card reloads, and the version line says *"Players get the version published"* with
   the current time and your name. No red error appears under the card.
3. **If the publish is refused,** nothing has been written and players are unaffected. The refusals:

   | Refusal | Who can override | The proper fix |
   | --- | --- | --- |
   | Sounds still marked draft | anyone who can publish: **Publish anyway** in *"Publish with unapproved sounds?"* | approve them in Invisible Sound |
   | Flow errors | `admin` only: **Publish anyway** in *"Publish with flow errors?"*. Everyone else is told to fix it or ask an admin. | Invisible Flow → Validation panel, save, publish again |
   | The paytable differs from the partner's captured one | `admin` only: *"Publish with a paytable that differs from the partner's?"* | in Invisible Game Config, import the capture, or correct it |
   | *"… already has its own published build (a desktop-launcher game)"* | nobody; this refusal is final | publish that game from the desktop launcher (section D) |

   A flow errors override is recorded: the version is tagged **flow errors** in the version list.
   Only override when you know why the check is wrong for this game.
4. **Read the notes under the card.** They do not block, but each one is something players will see:
   a sound with a non-commercial licence or no licence, *"no saved flow"* (the game plays without
   the free-spin intro and outro), or *"spine bundle(s) resolved to nothing"* (they will be missing
   in the game). Fix these in the tool that owns them, then publish again.
5. **Play what players get.** Press **Play ↗**, which opens the published version.
   *Check:* the change is there, and `X-IE-Runtime-Source` is `snapshot`. Players get the new
   version on their next load. A tab that is already open keeps the old one until it reloads.

> **A math change reaches players when you publish, and not before.** The published version
> freezes the Game Config the player's game reads, and the test server's mock RGS deals players
> from that same published version. A change saved in `/config` is dealt only to **Live ↗** (the
> authoring boot, which the server deals from the saved config within seconds). So try a math
> change with **Live ↗**, then publish it. If a game's grid and the server's ever disagree, the
> server's grid wins and the game logs `[game-config] error: the RGS deals …` in the console.

## B. Put a game back on an earlier version (Make live)

Use this when a publish shipped something wrong. It changes the game's **content** only. The game
stays on the engine that is live now.

1. On the game's card, open **Published versions (n)**. The list only appears when there is more
   than one version. Each row shows the date, who published it, **engine `<commit>`** (the engine
   release that was live when it was published), a red **flow errors** tag if an admin published
   past the flow check, and **live** on the version players get now.
2. Press **Make live** on the version you want. The confirmation, *"Make this version live?"*, says
   who published it and which engine it was made on. Confirm.
   *Check:* the note *"Version switched — players get it on reload."* appears, **live** moves to
   the version you picked, and the version line shows its date.
3. **Verify as a player.** Reload the game from **Play ↗**.
   *Check:* the content is the older version. `published.createdAt` in the `/api/editor/runtime`
   response matches the version you picked.
4. **Roll forward** the same way: **Make live** on the newer version. Publishing again also creates
   a new version and makes it live.

Nothing is rebuilt, so the switch is instant. Limits:

- **Five versions are kept.** The live version is always kept, even after you roll back further
  than that.
- **Only `admin` can Make live a version tagged flow errors.** For anyone else, that row has no
  button.
- **A 409, *"Someone else changed the published version just now"*,** means another publish or
  switch landed first. Reload the page and retry.
- **The mock RGS math rolls back with it.** Players are dealt from the version that is live, so
  **Make live** takes the server's grid, paylines and paytable back too, within a few seconds.
  **Live ↗** still gets the saved Game Config.
- **Published versions are not in the nightly backup.** The authored data they are made from is
  backed up, and publishing again recreates a version from it. See
  [Backups and restores](backups.md).
- **This does not take the engine back.** If the engine is the problem, use the **Runtime rollback**
  workflow in [Release and rollback](release-and-rollback.md). The table at the end of that runbook
  says which rollback you need.

## C. After an engine release: republish stale games

A card shows an amber **Engine update available** badge when the shared engine was released after
the game was last published. The game already runs the new engine code. Republishing freezes a new
version of its content against that engine, which is required when an engine change reads data
that older versions do not contain. The engine PR, or its entry in
[status/engine](../status/engine.md), should say when that is the case.

1. For one game, press **Republish + Reconcile** in the badge. For all of them, press **Republish N
   stale games** in the *Your projects* header. **Republish all (N)** republishes every published
   game, stale or not.
2. The bulk run happens on the server, one game at a time, at about 20 seconds per game. You can
   leave the page and come back: the progress panel re-attaches. **Stop after this game** stops
   cleanly once the current game finishes.
   *Check:* each game ends *republished*, *skipped* (a desktop-built game, or one with flow errors,
   which you publish one at a time) or *failed*, with the reason shown.
3. *Check:* the badges clear, and the stale games now read **engine up to date**.

While a bulk run is going, the per-game Publish buttons are disabled.

## D. Desktop builds: ☁ Publish and 📦 Deliver

The desktop steps are in the [Publisher runbook](publisher-runbook.md): the checklist for both
buttons, what each **Build refused** dialog means, and the failure table. Every button is explained
in [Invisible Launcher (desktop)](../tools/invisible-launcher.md). This section covers only how the
desktop builds relate to the online path.

- **They build from the same saved data.** A desktop build pulls scenes, flow, Game Config and art
  from the portal at build time, so save online first. The engine refuses a build for the same
  invalid flow and paytable drift that the online Publish refuses, and 📦 Deliver adds a check for
  art that no shipped atlas contains.
- **They carry their own engine.** Every ☁ Publish and 📦 Deliver advances the game repo's
  engine submodule to the engine's `main` before it builds, so each build gets the current engine.
  **Never bump a game repo's engine submodule by hand.** An engine release does not reach a desktop
  build until its next build.
- **They have no published versions.** Make live and the Runtime rollback workflow do not apply. To
  take a desktop build back, fix the cause and build again.
- **They name themselves differently.** For a desktop build, the check is `__IE_BUILD__` in the game
  tab's console, or `https://games.invisiblewall.org/<cloud key>/build-info.json`. A delivery
  carries the same `build-info.json` in its folder, and `EMBED.md` §5 names the build for the
  partner.
- **Keep the keys apart.** An online game and a desktop build of the same game need different keys,
  for example `<game>remake` online and `<game>` for the desktop build. Each path refuses to
  overwrite the other's game.
- **📦 Deliver uploads nothing.** No card is registered and the test server is not told.
  **▶ Play it** in the result dialog is the only way to open a delivery before the partner does.

## If it goes wrong

| Symptom | Likely cause | Do this |
| --- | --- | --- |
| "My edit isn't in the game" | It was saved but not published, someone made an older version live, or you are comparing **Play ↗** with **Live ↗** | Read the version line and `X-IE-Runtime-Source` (see "How to tell what players are getting"), then publish |
| An engine fix is missing from every online game | An engine release problem, not a content one | [Release and rollback](release-and-rollback.md) |
| `X-IE-Runtime-Source: live-fallback` | No published version, or its snapshot file is missing | Republish the game |
| Publish returns 403, or *needs "Build & publish games"* | You do not have `gamePublish` | Ask an admin for the capability |
| A publish refusal | One of the gates in section A | Fix it in the tool named. Only an admin overrides flow or paytable refusals. |
| *"… already has its own published build"* | The key belongs to a desktop build | Publish it from the desktop launcher, or give the online project a different key |
| Publish buttons are disabled | A bulk republish is running | Wait for it to finish, or **Stop after this game** |
| The game stops on *"This game could not load"* | The game could not load its published data. The launcher is unreachable, or the link's token is wrong. | [Incident first response](incident-first-response.md) |
| Make live returns 409 | Another publish or switch landed first | Reload the page and retry |
| The game shows one paytable or board, and the server deals or pays another | The test server could not re-read the game's config (launcher unreachable, or a game published before the mock followed its config) and kept its last board | Publish again. If it persists, [Incident first response](incident-first-response.md) |
| A desktop ☁ Publish or 📦 Deliver fails | See the failure table | [Publisher runbook](publisher-runbook.md#other-failures) |

## Related

- [Invisible Game Maker](../tools/game-maker.md): every Game Maker control, including publish,
  versions and bulk republish.
- [Release and rollback](release-and-rollback.md): the engine runtime release, and which rollback
  you need.
- [Publisher runbook](publisher-runbook.md) and
  [Invisible Launcher (desktop)](../tools/invisible-launcher.md): the desktop ☁ Publish and
  📦 Deliver in full.
- [Build your first game](build-your-first-game.md): from an empty project to a published game.
- [Incident first response](incident-first-response.md): a game is blank, stale or down.
- [Backups and restores](backups.md): recovering authored data.
- [live-assets.md § Published snapshots](../design/live-assets.md) and
  [delivery-builds.md](../design/delivery-builds.md): why it works this way.
- [status/game-maker](../status/game-maker.md): the current state and open items.
