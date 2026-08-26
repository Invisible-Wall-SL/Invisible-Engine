# Invisible Sound

**Every sound the game owns.** Upload music and SFX, listen to them, record where each
one came from, and approve the ones that are cleared to ship.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/sound` (granted to
  `music/SFX`, `developer`, `artist` and `pipelineTester` by default; `admin` always).
- **Scope:** per **active project** (use the project selector on the launcher home).
  Each project has its own library.

## What this tool is — and what it isn't

This is the **library**: the files, their names, and what we know about them.

It is **not** where you decide _when_ a sound plays. That lives with the moment it
belongs to:

| To change…                                                             | Go to                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| the cue for a game-wide moment (reel stop, tumble pop, symbol landing) | [Invisible Game Config](./game-config.md) → **Sounds**              |
| the cue one specific symbol makes                                      | [Invisible Symbols](./symbols-state-machine.md) → **Symbol sounds** |
| a one-off cue in the presentation                                      | [Invisible Flow](./flow.md)                                         |

Those tools bind a sound by **the name you give it here**. That is the only thing
connecting the two, which is why the name matters more than it looks.

Your sounds appear in those tools' dropdowns as soon as you **save** them here —
listed above the engine's own, since they're the ones you're usually reaching for.

## Adding a sound

Drop files onto the box at the top, or click **choose files**. You can add several at
once. Accepted: `mp3`, `ogg`, `m4a`, `wav`, `webm`, up to 25 MB each.

Each file gets a starting **name** taken from its filename, cleaned up to letters,
numbers, `_` and `-` (so `Tumble Pop 01.mp3` becomes `tumble_pop_01`). If that name is
already taken, a number is added rather than reusing it — see _Names_ below for why
that matters.

> **A file is stored the moment it uploads, but it only joins the library when you
> press Save.** If you close the tab without saving, the audio stays in storage with
> nothing pointing at it. Re-upload it; nothing is broken, it just isn't listed.

## Names

The name is what everything else in the pipeline uses to ask for this sound. It may
contain **letters, numbers, `_` and `-`** — nothing else, no spaces, up to 64
characters.

Two rules the tool will warn you about, because both silently lose work otherwise:

- **An unusable name is dropped on save.** If a name has a space or a dot in it, that
  row does not survive. The page tells you before you save, and outlines the row in
  red.
- **Two sounds cannot share a name.** If they do, only the last one survives a save —
  the other disappears from the library (its file stays in storage, unreferenced). The
  page names the clash so you can rename one first.

**Renaming a sound does not update anything that binds it.** If `/config` plays
`reel_stop_1` and you rename that sound, the config still asks for `reel_stop_1` and
the game goes quiet at that moment. Change the binding too.

## The row

| Control              | What it does                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **▶**               | Play/stop. Plays at the volume set on this row, so you hear what the game will.                                    |
| **name**             | The name bindings use (above).                                                                                     |
| **SFX / Music**      | Which player this is meant for — grouping and a sanity check; the game still decides.                              |
| **section**          | A free-text group ("Reels", "Wins", "UI"). Purely for browsing this page.                                          |
| duration             | Measured from the file. Read-only.                                                                                 |
| **vol**              | Base volume, `0`–`1`. Blank means full. This scales with the player's own volume setting — it doesn't override it. |
| **loop**             | Whether the sound repeats while it plays. Right for music beds, wrong for one-shots.                               |
| **Draft / Approved** | See below.                                                                                                         |
| **×**                | Remove from the library. The file itself stays in storage.                                                         |

**Where it came from** (the fold-out) records provenance: whether it's AI-generated,
commissioned, or from a library; the model or the musician; the licence and where its
terms live; and free-text notes.

This is not paperwork for its own sake. A sound with an unclear or non-commercial
licence sitting in a shipped game is a real problem, and nothing else in the pipeline
records where audio came from.

## Draft and Approved

Every sound starts as a **Draft**. Approving it is a human saying "this is the take,
and we're clear to use it".

**A draft still plays.** In the game, in a test build, here — everywhere. Approval does
not mute anything.

What it gates is **publishing**. Publishing a game **stops** if a sound that game plays is
still a draft: it names them and asks whether to go ahead anyway. Say no and nothing is
written; say yes and it publishes, because sometimes a test build is exactly what you want.

Only sounds that are actually **played** can stop a publish. A draft sitting unused in the
library never blocks anything — that's what a library is for. A sound named after a
built-in counts as played even though nothing "binds" it, because the engine plays it.

A successful publish also tells you what it just shipped, licence-wise: a warning when a
played sound has a non-commercial licence, or a note listing any played sounds with no
licence recorded at all.

This is deliberately the opposite way round from
[Invisible Localization](./localization.md), where unreviewed text simply doesn't ship.
An unreviewed _string_ falls back to English — visible, obviously provisional. An
unapproved _sound_ would fall back to **silence**, and silence is invisible: nobody
notices it in testing. So the check happens at the moment you ship, loudly, instead of
quietly removing audio.

Un-approving a sound clears the review — an approval you can't take back would be
worthless.

## Saving

Press **Save**. If someone else saved the library while you had it open you'll see a
conflict banner: your edits stay on the page, and you choose between taking their
version (reloading) or overwriting with yours. Nothing you typed is thrown away without
you asking.

While another person has the library open for editing you'll see a read-only banner
naming them, with **Take over** always available.

## How a sound reaches the game

Nothing extra to do — this happens on publish:

1. Your files are copied out of the library into the project's deploy tree.
2. A build (or the live runtime) picks them up along with the art and fonts.
3. The game loads each one, and any sound named the same as a built-in engine sound
   **replaces** it.

That last point is how you re-skin the engine's default audio: upload a sound named
`sfx_reel_stop_1` and the game plays yours instead of the shipped one, with nothing to
bind.

## Storage

`<client>/<project>/sounds/sounds.json` is the library; the audio sits beside it in
`<client>/<project>/sounds/files/`. Both are visible in the
[FTP Browser](./ftp-browser.md) if you ever need to look.
