# Invisible Profiler

Invisible Profiler keeps the `?perf=1` readings of a project's published game, so you can see how
it runs on real devices. Open a capture on a phone from a QR code, play, and every reading the game
sends lands in the project's list, kept 15 days unless you keep it longer. Every desktop ☁ Publish
and 📦 Deliver also lands here as a build record, so you can see what each build shipped, how it
changed from the one before, and the readings taken on it. Each project has budgets (frame rate,
frame time, memory, size) and every device and build is marked pass, warn or fail against them.
**Findings** turns all of that into a ranked list of what to cut, and **Compare** puts any two
readings side by side.

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
   the project in the **Project** picker. The page has six tabs: **Readings** (with its count;
   four foldable sections: **New capture**, **Paste a reading**, **Lab runs** and **Readings**),
   **Devices**, **Builds** (with its count), **Findings** (with its count), **Compare** and
   **Budgets**. A link with `?tab=devices`, `?tab=builds`, `?tab=findings`, `?tab=compare` or
   `?tab=budgets` opens that tab; Compare also takes `&a=<reading id>&b=<reading id>`. Hover a
   section's title for what it does.

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
     reading on the same phone shows what that feature costs there, and becomes a **Feature
     cost** finding (see **Findings** below).
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

### Lab runs

A **lab run** plays each live online game in headless Chrome with `?perf=1` and sends its reading
here, marked `lab`, with the device label `lab · CI`. It runs nightly (03:17 UTC) over every live
online game, from the GitHub Actions workflow **Profiler lab run**; to run one game now, open that
workflow, click **Run workflow** and type its game key (empty runs them all). Each run plays a
warm-up round, resets the reading, idles 20 s, then spins 10 times. Free-play kinds only idle. A
forced feature round is tried where the game's mock accepts one; the player mock of an online game
refuses forcing today, so that step is skipped.

- **Lab runs (`<n>` games)** shows, for each game, its newest lab reading: game key, build, when, what it
  is compared with ("vs `<date>`", or "first lab run of this game") and **JSON**.
- Under it a table of what a frame does, for **idle** and **spinning**: **draws**, **passes**,
  **uploads**, **GL calls** and **JS ms**, plus **texture MB**. Each has three figures: this run, the
  previous lab run of the same game with the same test switches, and the change (`±0` for none).
- A change bigger than run-to-run noise is shown in bold orange. That is the thing to look at: a
  build that suddenly draws more, uploads more or holds more textures.
- Fps is never compared ("fps: not comparable"): the runner draws without a real graphics chip and
  its fps swings about 2× from run to run, while the counts stay steady. Judge fps on a phone.

### Read the list

8. **Readings (`<n>`)** lists every reading of the project, newest first. The columns:
   - **Captured**: date and time, with a tag: `sent` (from a capture), `paste` or `lab` (a lab run;
     compare it in **Lab runs**, not on its fps).
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
    - **Shipped MB** and **GPU MB** are coloured by the project's budgets (see **Budgets** below):
      green for pass, orange for warn, red for fail. Hover the cell for the verdict per device
      class. A breakdown that names no size or no GPU estimate is not judged on it (hover: "not
      enough data").
    - **Devices**: a pill per device class (`phone`, `desktop`…) that has as-shipped readings on
      this build, coloured pass / warn / fail / not enough data. A class takes the verdict of its
      worst device (GPU), so a weak phone failing is not hidden by a strong one. Hover a pill for
      how many readings it is from; `–` means no as-shipped reading on this build yet.
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

### Devices

15. The **Devices** tab groups the project's readings by device class and graphics chip (GPU),
    worst first. With none yet it reads "No as-shipped readings yet — open a capture on the
    Readings tab and play the game on a phone." Each row shows:
    - **Device**: the class (`phone`, `desktop`) and the GPU under it (hover for the full name).
    - **Readings**: how many readings the group holds.
    - **Verdict**: `pass`, `warn`, `fail` or `not enough data` — the worst of the row's cells.
    - **Idle**, **Spinning**, **Round**: **fps** and **p95** (the median over the group's
      readings) and **>33** (hitches, added up over the readings).
    - **Draws** and **GPU MB**: the median draw calls a frame and texture memory.
16. A cell is coloured by the project's budget: green pass, orange warn, red fail, grey when there
    is not enough data or no budget for it. Hover a cell for its verdict and the warn and fail
    lines.
    - A phase only counts from readings with at least **120 frames** in it (about two seconds of
      play). With none, the cell says "not enough data" — never pass. Play each phase a little
      longer and send again.
    - Readings taken with a test switch (**Particles off** and the others) are left out: they
      measure what a feature costs, not the game players get. So are lab runs (their fps is a
      shared runner's, not a device's) and readings whose device class the game did not name. A
      line under the table says how many were left out.
17. Click a device's name to open its readings **build by build**, newest first, in a card under
    the table: each build (or the build number the game stamped, when no build record matches)
    with its readings judged the same way. Click the name again to close it.

### Findings

18. The **Findings** tab reads the project's readings and build records and lists what to cut,
    ranked. With nothing to read yet it says "Nothing to cut yet — the rules need readings
    (Readings tab) or build records (Builds tab)." The columns:
    - **Severity**: `high` (a budget fails, or fps fell from one build to the next), `medium` (a
      warn, or a cost worth cutting) or `low` (worth knowing).
    - **Finding**: what it is, with the rule and the game under it, and the facts it was read from,
      one per line.
    - **Saving**: what fixing it would save (fps, draws, MB, GPU MB or spikes) and what that number
      is. Every number is a measurement — a test switch's difference, a file's bytes, a breakdown
      figure. Where there is none it says `unmeasured`, never a guess.
    - **Owner**: who fixes it — an agent (for example `engine-pixi-svelte`, `invisible-fx`,
      `atlas-python-tools`, or the game kind's build agent) or a person ("Project author (Invisible
      FTP Browser)", "Publisher", "Whoever changed the build").
    - **Evidence**: the readings and builds it was read from. Click a reading to open it in
      **Compare** with the finding's other reading beside it; click a build to open its detail card
      on the **Builds** tab.
19. The list is ranked by severity first, then by the saving as a share of a typical budget (fps
    out of 60, MB out of 25, GPU MB out of 150, draws out of 100, spikes out of 10), so 5 fps and
    3 MB rank against each other; `unmeasured` comes last. The **Owner** and **Device** filters in
    the card header narrow it (Device `(build files)` is the findings about a build's files, not a
    device). "No finding matches these filters." means the filters hide them all.
20. The rules, one per kind of finding:
    - **Fps below budget**: a device (class and GPU) whose fps or p95 frame time on the current
      build is past its budget line, judged exactly as the **Devices** tab judges it.
    - **GPU- or CPU-bound**: for a device missing its fps budget, which side of the frame to cut —
      our JS (CPU-bound) or not our JS (the GPU or the browser). It names the side, not a saving.
    - **Feature cost**: what Particles, Element FX passes or Antialiasing cost on a device, in fps
      and draws a frame, shown when switching it off buys at least 2 fps or 10 % of the draws.
    - **Spikes by cause**: the frames over the spike line while a round plays (spinning, or wins
      with the reels at rest), counted by their likely cause (first use, particles, rigs, page JS,
      garbage collection, outside the game…). Spikes at idle are left out.
    - **Textures**: a device's texture memory over its GPU budget (the saving is what its five
      largest textures hold); KTX2 art a device fell back to WebP/PNG for; and pages over 4096 px on
      a side in a game's newest build, which many phones cannot load (those two say `unmeasured`:
      nothing measures what fixing them saves).
    - **Unused bytes**: files in a game's newest build that nothing loads, and files shipped twice.
    - **Optimize off**: a game's newest build was made without 🗜 Optimize; the saving is only what
      the breakdown measures Optimize would drop from files the game loads (a twin nothing loads is
      already counted under Unused bytes).
    - **Regression**: a game's newest build against the one before — shipped size or GPU estimate
      up; median fps down on a device; or a lab run's counts (draws, uploads…) up.
21. Fps findings speak for each game's **current build** — the newest build (by its build record,
    else its number), not the newest reading — so a finding a fix already replaced drops out once
    you take readings on the new build, and re-measuring an old build later does not bring it back.
    Lab runs count only for the rules that read counts — **Textures**, **Unused bytes** and the
    count part of **Regression** — never for fps.

To get a **Feature cost** finding, open a capture and take two readings on the same phone and the
same build: one from the **As shipped** QR code and one from **Particles off**, **Element FX off**
or **Antialias off**. Play each one the same way (idle, spin, wins) long enough for every phase to
have its frames, and send both. The rule pairs each test reading with the as-shipped reading
nearest in time on the same game, build, device and browser.

Readings kept before Findings shipped fill in over a few page loads: each load reads up to 12 of
them, so a project with many old readings shows its full list after a few visits.

### Compare

22. The **Compare** tab puts two readings side by side. Pick them in **A** and **B** (each reading
    is described by its time, device class and GPU, label, game, build, `lab` and test switches),
    or open one from a finding's evidence. Until both are picked it reads "Pick two readings — or
    open one from a finding's evidence."
23. The table shows, per phase, **fps**, **p95 ms**, **> 33 ms** and **frames**; then, for idle and
    spinning, what a frame did — draws, passes, uploads, GL calls and JS ms; then **texture MB**.
    Each row has A, B and **B − A**: green when B is better, red when it is worse (frames is not
    coloured). `—` means a reading has no figure there.
24. It is a difference, not a verdict: two devices differ for reasons no build caused. With a lab
    run on one side and a device on the other, it warns "A lab run beside a device: compare the
    counts, not the fps." The page link keeps both picks (`?tab=compare&a=…&b=…`), so you can send
    it to someone.

### Budgets

25. The **Budgets** tab holds the lines this project is judged against, in four foldable sections:
    **Phone**, **Tablet**, **Desktop** and **Every device** (shipped size). Each row is one metric
    (and phase): **fps**, **p95 frame**, **Draws a frame**, **GPU memory**, **Shipped size**.
    - **Warn** and **Fail** are the project's lines, filled in with the line in force. For fps,
      below the line is bad (`<`); for the others, above it (`>`). A blank line is not checked.
    - **Studio default** shows the studio's line beside it, and a `project` tag when this project
      has its own.
26. The studio defaults:

    | Device        | Metric                 | Warn     | Fail     |
    | ------------- | ---------------------- | -------- | -------- |
    | Phone, tablet | fps idle               | < 58     | < 55     |
    | Phone, tablet | fps spinning, round    | < 55     | < 50     |
    | Phone, tablet | p95 frame, every phase | > 20 ms  | > 25 ms  |
    | Phone, tablet | GPU memory             | > 120 MB | > 150 MB |
    | Desktop       | fps, every phase       | < 58     | < 55     |
    | Desktop       | p95 frame, every phase | > 20 ms  | > 25 ms  |
    | Every device  | Shipped size           | > 20 MB  | > 25 MB  |

    "60 fps" means locked to a 60 Hz screen, which measures 59.x, hence the lines at 58 and 55.
    Draws a frame and desktop GPU memory have no default; set one if your project wants it.

27. To change a line, type a value and press **Enter** (or leave the field). **Escape** drops what
    you typed. A value out of range, or a warn line on the wrong side of the fail line, is refused
    with the reason beside it (for example "The warn line must be at or above the fail line (more
    fps is better)."). The reset icon at the end of a row with its own line ("Reset to the studio
    default") brings back the studio default.
28. Everyone with the Profiler and the project can edit its budgets. A budget belongs to one
    project; the studio defaults are not editable here. If someone else saved the same line first,
    yours is not saved: the row shows theirs, with "Someone else changed this budget line first —
    it now shows their value." and the warn and fail you had typed. Type yours again to save it
    over theirs.

## Known limitations / TODOs

The Profiler is built in steps; P1 ("Capture and keep"), P2 ("Builds"), P3 ("Devices and
budgets"), P4 ("Findings" and "Compare") and P6 ("Lab runs") are done. Planned in
[the design](../design/invisible-profiler.md), not built yet:

- **File as bug** (P5): a finding filed as a bug from its row.
- **Cloud phones** from an online device service (P7).

Today:

- Leaving-the-page sends have not yet been checked on a real iPhone or Android phone.
- A scripted read (`window.__IE_PERF__('reset' | 'take')`) never sends on its own.
- Reading the list means scanning rows; there is no filter, grouping or chart. The page shows the
  newest 500 readings.
- A reading cannot be deleted by hand; untick **Keep** and the clean-up removes it once it is past
  15 days.
- Only readings from a game whose readout reports `perf: 7` are read. A reading from a newer or
  older readout is refused with its version.
- Purging a project deletes its readings, build records and budgets with it. A duplicated
  project starts with no readings or builds, and on the studio budgets: its overrides are not
  copied.
- Only desktop builds are recorded (Invisible Launcher v1.0.68 or later); an older launcher sends
  nothing, and an online Publish from Game Maker makes no build record.
- A pasted reading left on **Not sure** is matched on its build number and commit alone, so two
  games of one project with the same number and commit both list it.
- A reading over 480 KB sent from a phone arrives without its per-texture list and spike records
  ("sent — trimmed" in the readout), until the storage accepts uploads from the games site.
- A reading from an online game is tagged with the engine release live when it arrived, not when
  the phone loaded the game; a release in between would tag the newer one.
- The build list shows the newest 200 builds.
- **Findings** and **Compare** read only what the page holds: the newest 500 readings and 200
  builds. A reading that arrived trimmed has no per-texture list or spike records, so the
  **Textures** and **Spikes by cause** findings it feeds may say `unmeasured` or miss it.
- Findings for readings kept before P4 shipped fill in over a few page loads (up to 12 a load);
  until then the list can be incomplete.
- The game tells phones and desktops apart only, so no reading is judged as a tablet yet; the
  **Tablet** budgets wait for it.
- Lab runs are nightly and on demand, not yet after each Publish. They cover only the idle and
  spinning phases (no forced feature on an online game's player mock), and a game that ships its own
  built bundle (not the shared runtime) is not run.
