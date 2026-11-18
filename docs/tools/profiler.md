# Invisible Profiler

Invisible Profiler keeps the `?perf=1` readings of a project's published game, so you can see how
it runs on real devices. Open a capture on a phone from a QR code, play, and every reading the game
sends lands in the project's list, kept 15 days unless you keep it longer. Every desktop ☁ Publish
and 📦 Deliver also lands here as a build record, so you can see what each build shipped, how it
changed from the one before, and the readings taken on it.

## What it is

The game already measures itself: open any published game with `?perf=1` and a small readout at
the top shows its frame rate, and opens into the full reading (frame times while idle, spinning and
during a round's wins, the GPU, draw calls, textures). Until now that reading travelled by hand,
with **Copy** and a paste into a chat. The Profiler opens the game with a **capture session**, so
the readout gets a **Send** button and the reading goes straight to the project's list.

- **Where it runs:** the launcher itself, at `/profiler`. It opens full-page behind the launcher's
  sign-in, never in an iframe. On the launcher home it sits in the **Create** section; in the tool
  bar it is **Profiler**.
- **Scope:** one project at a time. It opens on the **active project**; the **Project** picker
  beside the heading switches to another one you can open (it becomes your active project too). A
  link with `?project=<key>` opens that project.
- **Access:** the `profiler` tool. By default every role has it: `admin`, `developer`, `artist`,
  `animator`, `pipelineTester`, `localizationReviewer` and `audio`. Admins turn it on or off per
  role in **Admin › Roles**. Not signed in, you are sent to the sign-in page; signed in without the
  tool, the page shows a 403 error, "Your role does not have access to the Invisible Profiler."
- **The phone needs no sign-in.** The capture link carries a token that lets that one phone send
  readings for that one project, for 24 hours. It stops working early if the person who opened the
  capture loses the Profiler or the project.

## How to use it

1. Sign in to the launcher (`app.invisiblewall.org`), open the **Invisible Profiler** card and pick
   the project in the **Project** picker. The page has two tabs, each with its count: **Readings**
   (three foldable sections: **New capture**, **Paste a reading** and **Readings**) and **Builds**
   (a link with `?tab=builds` opens it). Hover a section's title for what it does.

### Capture on a phone

2. In **New capture**, type a **Device label** if you like (for example "Galaxy A14"; up to 80
   characters, shown on every reading the session sends) and click **Open capture**. A project with
   nothing published yet reads "This project has no published game yet — publish it from Game
   Maker first."
3. The section shows "Session open until `<date and time>`" and, for each of the project's
   published games, four QR codes, each with **Open** and **Copy link**:
   - **As shipped** (the large one): the game exactly as players get it.
   - **Particles off**, **Element FX off**, **Antialias off**: the same game with one cost turned
     off (`particles=off`, `fx=0`, `aa=0`). A reading from one of these beside an **As shipped**
     reading on the same phone shows what that feature costs there.
4. Scan a QR code with the phone's camera (or send yourself the copied link). The game opens with
   the readout at the top. Tap the readout to open it: under the figures are **Copy**, **Send** and
   **Reset**.
5. Play: let the game idle a while, spin, and play through some wins. Then send the reading:
   - **Send** posts the reading as it stands. The readout says "sent", or "not sent: `<reason>`".
   - **Reset** sends the reading on its own before clearing it (if it has frames not sent yet), so
     you can Reset between tests and each one is kept. The readout then says "sent (auto)".
   - Leaving the page (switching app, locking the phone) also tries to send it on its own, without
     the per-texture list and the spike records so it fits a request that outlives the page. A phone
     may suspend the page first, so tap **Send** or **Reset** before you put the phone away.
6. Back in the Profiler, new readings appear in **Readings** within about 10 seconds while the tab
   is visible. **New session** opens a fresh capture (for example for another device label); a
   session takes up to 200 readings, then asks for a new one.

A game opened with `?perf=1` but without a capture link shows no **Send** button and sends nothing.
Players never load the readout at all.

### Paste a reading from a delivery

7. A delivery runs on a partner's page, and nothing can be sent from there. Open it with `?perf=1`,
   open the readout and tap **Copy**. In **Paste a reading**, paste the text into the box, add a
   **Device label** if you like, pick the **Game** it was taken on (so it joins that game's builds;
   **Not sure** joins on the build number alone) and click **Keep reading**. It is kept like a sent reading, marked
   `paste`, and the section says "Kept." The same works for any reading you were sent by hand.
   A paste that is not a reading is refused with the reason (for example "Not JSON — paste the text
   ?perf=1 Copy gives." or "The report holds no frames yet — play a little, then send it.").

### Read the list

8. **Readings (`<n>`)** lists every reading of the project, newest first. The columns:
   - **Captured**: date and time, with a tag: `sent` (from a capture) or `paste`.
   - **Device**: the device class the game detected and the device label, then the browser and
     system (for example `Chrome 131 · Android`), the pixel ratio and the canvas size. A reading
     taken with a variant link shows its switch underneath in orange (for example `particles=off`).
   - **GPU**: the graphics chip the browser reports (hover for the full name).
   - **Build**: the build version the game reports (on the **Builds** tab, a reading is matched to
     its build by this number).
   - **Idle**, **Spinning**, **Round**: for the game idling, the reels spinning, and a round's wins
     and features with the reels at rest, three figures each: **fps**, **p95** (95 % of frames
     took less than this many ms) and **>33** (frames that took over 33 ms, the hitches you see).
     `–` means the reading has no frames in that phase.
   - **Draws**: draw calls a frame while spinning (while idle if the reading never spun).
   - **Tex MB**: the textures in GPU memory.
   - **Keep**: see below.
   - **JSON**: downloads the full reading as the game sent it, with every figure the readout has.

### Keep a reading

9. A reading is deleted **15 days** after it was captured. The **Keep** column counts down the days
   left (`12 d`; hover for "Deleted in 12 day(s) unless kept"). Tick the box to keep it for good: it
   reads `kept` and is never deleted. Untick it to put it back on the 15-day clock, counted from
   when it was captured, so an old reading you untick goes at the next daily clean-up. Anyone with
   the Profiler can keep or release a reading.

### Builds

10. Build records come from the desktop launcher (the Invisible Launcher, v1.0.68 or later): after
    each ☁ Publish or 📦 Deliver it sends the build's breakdown here and says so in its result,
    "📈 Profiler: build vN recorded" (see [the launcher guide](invisible-launcher.md)). There is
    nothing to do on this page to add one. With none yet, the tab reads "No builds yet — the
    desktop launcher sends one after each ☁ Publish or 📦 Deliver."
11. **Builds (`<n>`)** lists them newest first. The columns:
    - **Built**: when the build was made.
    - **Build**: `v<n>` with tags for the kind (`publish` or `delivery`, plus the delivery profile),
      `opt` (built with 🗜 Optimize) and `debug` (debug tooling included, in orange), and the game
      key underneath. Build numbers count per game, so compare a row with the rows of its own game.
    - **By category**: a bar split by what the build shipped (code, art, symbols, fonts, sounds…).
      Hover a part for its name and size.
    - **Shipped MB**, and **Δ MB**: the change from the previous build of the same game and kind
      (`±0` when it is under 0.05 MB, `–` when there is none to compare with).
    - **GPU MB**: an estimate of the memory its images take on the graphics chip.
    - **Issues**: the errors and warnings its build breakdown found, or `none`.
    - **Readings**: how many readings were taken on this build.
    - **Keep**: as for readings (below).
    - **Breakdown** opens the same build breakdown page the launcher writes, in a new tab;
      **JSON** downloads it.
12. Click a build number for its detail card, under the list (the newest build is shown until you
    pick one). It shows what it shipped and in how many files, code, GPU (est.), what the build left
    out, the bytes nothing loads and the engine commit; a line comparing it with the previous build
    of the same game and kind (shipped, GPU, files, errors, warnings); a table of each category with
    the previous build's size and the change; and **Readings on this build**, with their fps and
    texture memory.
13. A reading belongs to a build when it was taken on the same game (a capture link names its game;
    a pasted reading names the one you picked), reports the same build number and, when both name
    one, the same engine commit. Each reading shows its game under the device.
14. A build record is deleted **15 days** after it was sent unless you tick **Keep**, like a
    reading, except the newest build of each game and kind (one publish and one delivery per game),
    which always stays so there is something to compare with: its Keep column reads `newest`.

## Known limitations / TODOs

The Profiler is built in steps; P1 ("Capture and keep") and P2 ("Builds") are done. Planned in
[the design](../design/invisible-profiler.md), not built yet:

- **Devices and budgets** (P3): readings grouped by device and GPU, fps and size targets per
  project, pass / warn / fail.
- **Findings** (P4): a ranked list of what to cut, and **Compare** for two readings side by side.
- **File as bug** (P5), **lab runs** in headless Chrome after each Publish (P6), and **cloud
  phones** from an online device service (P7).

Today:

- Leaving-the-page sends have not yet been checked on a real iPhone or Android phone.
- A scripted read (`window.__IE_PERF__('reset' | 'take')`) never sends on its own.
- Reading the list means scanning rows; there is no filter, grouping or chart. The page shows the
  newest 500 readings.
- A reading cannot be deleted by hand; untick **Keep** and the clean-up removes it once it is past
  15 days.
- Only readings from a game whose readout reports `perf: 7` are read. A reading from a newer or
  older readout is refused with its version.
- Purging a project deletes its readings and build records with it. A duplicated project starts
  with none.
- Only desktop builds are recorded (Invisible Launcher v1.0.68 or later); an older launcher sends
  nothing, and an online Publish from Game Maker makes no build record.
- A pasted reading left on **Not sure** is matched on its build number and commit alone, so two
  games of one project with the same number and commit both list it.
- A reading over 480 KB sent from a phone arrives without its per-texture list and spike records
  ("sent — trimmed" in the readout), until the storage accepts uploads from the games site.
- A reading from an online game is tagged with the engine release live when it arrived, not when
  the phone loaded the game; a release in between would tag the newer one.
- The build list shows the newest 200 builds.
