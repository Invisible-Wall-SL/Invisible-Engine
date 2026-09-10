# Invisible Sound

**Every sound the game makes, and every sound it owns.** Choose what plays at each
moment of the game, upload the music and SFX to choose from, listen to them, record
where each one came from, and approve the ones that are cleared to ship.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/sound` (granted to
  `music/SFX`, `developer`, `artist` and `pipelineTester` by default; `admin` always).
- **Scope:** per **active project** (use the project selector on the launcher home).
  Each project has its own library.

## The two halves

**The moments** — the sections at the top. Every beat the game sounds, with a picker
for what plays there and a ▶ to hear it.

**The library** — underneath. The files this project owns, their names, and what we
know about each one.

The only thing connecting them is the **name**, which is why the name matters more
than it looks.

## The moments

### Game moments

Every named beat the engine sounds: the reel stop, the cascade pop, a symbol landing,
a scatter landing, and so on. Each row says **what fires it** in plain words.

**Every one of these already has a sound.** They are the engine's own bindings, not
blanks — a game nobody has ever opened this tool for still makes all of them. Change
one only to depart from the default; a moment you leave alone keeps tracking the
engine's choice, so it improves when the engine's does. A changed moment shows a
**changed** tag and a **reset to default** link.

Some moments are a **ladder**: several sounds played in order so repeats escalate
rather than repeating. The cascade climbs `tumble_win_1…5` as a tumble chains; the
reels stop up the scale left to right. Each row says what decides the rung. Add or
remove rungs with **+ rung**, and pick **— none —** on a rung to drop it. Past the last
rung the ladder **holds** there — a sixth reel keeps playing rung five rather than
falling silent.

To play **nothing** at a moment, switch it to **silent**. That is deliberately a
different gesture from clearing the picker (which is not offered for a moment's only
cue), so that "I meant nothing here" stays distinguishable from "I emptied it by
accident" — a distinction the game itself cannot make, because a missing sound and a
silenced one both just… don't play.

### Per-symbol cues

A noise **one** symbol makes at a moment, instead of the game-wide cue above. Optional
and normally empty — add a row only for a symbol that should sound like itself.

Only the states the engine actually asks about are offered. A dropdown for a state nothing
plays would let you bind a cue that can never be heard, and never be told.

- **Land** — always.
- **Clear reel** — when the project **cascades _or_ clears its board** on a swap. Two
  different things play that state, and gating it on the cascade alone used to hide it from
  exactly the projects authoring the second: a swap-in-place board with _"clear the board"_
  ticked runs it every single round.
- **Intro** — when the swap style is **Emerge**, the only thing that fires it. Heard
  _alongside_ the ordinary landing cue rather than instead of it: an emerge has no game-wide
  slot of its own, so there is nothing for it to replace.

### Reel anticipation

The tease while a big win is still reachable on the reels yet to stop: a **sting** when
it starts, a **loop** that holds under it. Whether the tease runs at all, and how hard
it ramps per tier, is in [Invisible Symbols](./symbols-state-machine.md); what it
sounds like is here.

### Win tiers

What a celebration sounds like at each tier — the one-shot **sting** that opens it and
the **music** that runs under the count-up. Which tiers exist, and at what multiple, is
[Invisible Game Config](./game-config.md).

### Flow cues — read-only

A cue placed on the [flow graph](./flow.md) has wires, a condition and a position in a
sequence, so it stays where it can see them. They are listed here, with a link out, so
this page can still show _every_ sound the game makes.

> **Moved here.** These choices used to live in Invisible Game Config, Invisible
> Symbols and the Scene Editor. If this project was set up before the move, the page
> opens showing what it already plays — read out of those tools — and says so. Your
> first **Save** moves them here for good and those tools stop deciding.

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

**Renaming a sound does not update the moments that play it.** If the reel stop plays
`reel_stop_1` and you rename that sound, the moment still asks for `reel_stop_1` — its
picker turns red and says the sound no longer exists. Repoint it, or rename back.

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
