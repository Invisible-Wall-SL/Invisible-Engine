# Invisible Profiler

Invisible Profiler keeps the `?perf=1` readings of a project's published game, so you can see how
it runs on real devices. Open a capture on a phone from a QR code, play, and every reading the game
sends lands in the project's list, kept 15 days unless you keep it longer. Every desktop ☁ Publish
and 📦 Deliver also lands here as a build record, so you can see what each build shipped, how it
changed from the one before, and the readings taken on it. Each project has budgets (frame rate,
frame time, memory, size) and every device and build is marked pass, warn or fail against them.
**Findings** turns all of that into a ranked list of what to cut, each one a click from a filed
bug, and **Compare** puts any two readings side by side.

## What it is

The game already measures itself: open any published game with `?perf=1` and a small readout at
the top shows its frame rate, and opens into the full reading (frame times while idle, spinning and
during a round's wins — or, for an arcade game, in its menus and while the field plays — the GPU,
draw calls, textures). Until now that reading travelled by hand,
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
5. Play: let the game idle a while, spin, and play through some wins. For an arcade game, stay a
   little in its menu or lobby, then play the field for a minute or more (the readout's header
   shows **play** fps once it counts). Then send the reading:
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

### Capture on a cloud phone (BrowserStack Live)

BrowserStack Live lends you a real phone in a browser tab, so you can measure phones nobody on
the team owns. A cloud phone cannot scan a QR code, so the Profiler opens the link on it for you:

- Sign in to BrowserStack in this browser once.
- In **New capture**, pick the phone under **Cloud phone**. The list holds the phones BrowserStack
  Live lists, grouped by brand (Samsung, Google, Apple iPhone, Xiaomi, OnePlus, Motorola, Vivo,
  Oppo, Realme, Android tablets, Apple iPad), several with more than one OS version; each reads
  "<model> · <OS> <version>". The **Device label** becomes "BS Live · <model> · <OS> <version>",
  so its readings carry the phone's name. Click **Open capture**.
- For a phone not in the list, pick **Other phone…** at the end and fill in **Live device name**,
  **OS** and **OS version** exactly as BrowserStack Live's device list shows them (for example
  "Samsung Galaxy A14", Android, "13.0"). Live only starts a phone whose name matches.
- Click **BrowserStack Live** under **As shipped** (or under a variant). A new tab starts that
  phone in BrowserStack Live, in Chrome on Android or Safari on iPhone, with the capture link
  already open.
- Play as in steps 4–5 with the mouse, then tap **Send**. The reading arrives in **Readings**.
  **Copy does not work on a cloud phone**: it copies to the cloud phone's own clipboard, and
  nothing brings that back. Always use **Send** there.
- For another phone, pick it and click **New session**: a session's links carry the label it was
  opened with.

The button only opens BrowserStack's own dashboard; no BrowserStack key is stored. What it hands
the phone is the capture link's short form, shown in grey under each QR code:
`app.invisiblewall.org/profiler/go/<variant>/<token>`, a launcher address that forwards to the
game with the capture session. It has no `?` or `&` in it, so BrowserStack cannot cut the session
off the link. It needs no sign-in and lasts as long as the session (24 hours). **Copy link**
copies this short form too, so you can also paste it into a phone's address bar yourself.

The dashboard address follows BrowserStack's integration-URL page: `os=iOS` or `os=Android`
(capitalised, as BrowserStack writes them), `os_version`, `device`, `device_browser`,
`scale_to_fit=true`, `speed=1`, `url=<short form>` and `start=true`. If the dashboard opens with no
phone running, compare its address bar with that list: a missing `device` means Live did not
know the phone by that name.

A capture link never says what kind of device it runs on. The published launch URL ends in
`device=desktop`, and capture links drop it. The game reads no `device` parameter either way: its
layout follows the screen and **Device** in the readout comes from the browser itself, so a phone
gets the phone layout and its readings are filed as `phone`.

If the readout on the phone has no **Send**, it says "no Send: this link has no capture session"
— the game was opened without its session; open it again from the button or a copied link. If
Send fails, the readout says "not sent: <reason>", for example that the capture link has
expired, or that the phone could not reach the launcher.

The phone is real, so its fps counts like any phone's. Keep the phone screen at its normal
size in Live, and play each phase a few seconds (Devices needs 120 frames a phase).

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
   - **Menu**, **Play**: the same three figures for an arcade game, in its menus (title, lobby,
     countdown, win screen) and while its field plays (online: while the room's round runs). The
     table shows the phase groups the listed readings have: a slot project only Idle, Spinning and
     Round, an arcade project Menu and Play, and both while older readings of an arcade game are
     still listed (a reading from before the arcade phases puts all its frames under Idle).
   - A **30 cap** tag after the time: the browser held the reading to 30 fps (iOS Low Power Mode,
     a battery saver) while its frames had room for 60. Its fps and p95 are not judged against the
     budgets. A game whose frames are too busy for 60 also runs at exactly 30 fps on a 60 Hz screen;
     that is not a cap, and it is judged.
   - **Draws**: draw calls a frame while spinning (while idle if the reading never spun); for an
     arcade game, while it plays (in its menus if it never played).
   - **Tex MB**: the textures in GPU memory.
   - **Transfer MB**: what the game's page downloaded (a reading from a readout of `perf: 9` or
     later; `–` for an older one), and **1st frame** under it: how long after the page started the
     game drew its first frame. Each file counts its body as served, whether that load took it from
     the cache or not, so a phone that had the game cached reads the same weight. A `+` after the
     number means some files hid their size (a server on another site that sends no
     Timing-Allow-Origin) and are not counted. Hover for the file count, what came from the cache,
     the largest file and the MB before the first frame. Click the number to open the reading's
     **Files** card under the list (click again to close it).
   - **Keep**: see below.
   - **JSON**: downloads the full reading as the game sent it, with every figure the readout has.

### A reading's files

The **Files** card (open it from a reading's **Transfer MB**) lists what the page downloaded,
heaviest first: each file's path (and its site, when it is not the game's), its class (Page, JS,
CSS, Images, KTX2 textures, Atlas / JSON, Rigs, Audio, Fonts, API / RGS, Other), its load stage
(**Before the first frame**, **Boot load**, **After boot**), its **MB** as served and **Decoded**,
where it came from (`cache`, `304`, `network`, or `size hidden`) and how long it took. Above the
table: the transfer, what came from the cache, the first frame, the MB of each stage, the RGS's
requests and their p95, and for an online arcade game the room's KB a second in and out and its
largest message; then the MB of each class. A reading sent as the page hid lists only its 20
heaviest files ("Sent trimmed"). File names are paths only: the game never sends a link's query or
a token.

### Keep a reading

9. A reading is deleted **15 days** after it was captured. The **Keep** column counts down the days
   left (`12 d`; hover for "Deleted in 12 day(s) unless kept"). Tick the box to keep it for good: it
   reads `kept` and is never deleted. Untick it to put it back on the 15-day clock, counted from
   when it was captured, so an old reading you untick goes at the next daily clean-up. Anyone with
   the Profiler can keep or release a reading.
   - **A filed bug's evidence is kept.** Filing a finding as a bug (see **File a finding as a bug**
     below) ticks **Keep** on every reading and build it cites. While the bug exists, Keep cannot
     be unticked: the page says which bug cites it ("BUG-`<n>` cites this reading: it stays kept
     while the bug exists."). The 15-day clean-up never deletes a reading or build a filed bug
     cites, whatever its Keep says.

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
    - **Transfer MB**: what the as-shipped readings taken on this build downloaded (the median);
      hover for the build before it of the same game and kind, and the change. `–` when no reading
      on the build says.
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
    the previous build's size and the change; **Downloaded (readings)**, what its readings fetched
    (hover for the build before); and **Readings on this build**, with their fps, texture memory and
    transfer MB.
13. A reading belongs to a build when it was taken on the same game (a capture link names its game;
    a pasted reading names the one you picked), reports the same build number and, when both name
    one, the same engine commit. Each reading shows its game under the device.
14. A build record is deleted **15 days** after it was sent unless you tick **Keep**, like a
    reading, except the newest build of each game and kind (one publish and one delivery per game),
    which always stays so there is something to compare with: its Keep column reads `newest`. A
    build a filed bug cites stays kept while the bug exists, as a reading does. A link with
    `?tab=builds&build=<id>` opens that build's detail card (a filed bug's evidence links use it).

### Devices

15. The **Devices** tab groups the project's readings by device class and graphics chip (GPU),
    worst first. With none yet it reads "No as-shipped readings yet — open a capture on the
    Readings tab and play the game on a phone." Each row shows:
    - **Device**: the class (`phone`, `desktop`) and the GPU under it (hover for the full name).
    - **Readings**: how many readings the group holds.
    - **Verdict**: `pass`, `warn`, `fail` or `not enough data` — the worst of the row's cells.
    - **Idle**, **Spinning**, **Round** (an arcade game's **Menu** and **Play**): **fps** and
      **p95** (the median over the group's readings) and **>33** (hitches, added up over the
      readings). A device is judged only on its readings' own phases.
    - **Draws** and **GPU MB**: the median draw calls a frame and texture memory.
    - **Transfer MB** and **Largest file**: the median of what the readings downloaded and of their
      heaviest file (readings from `perf: 9` on; with none, the cells read `—` and are not judged).
16. A cell is coloured by the project's budget: green pass, orange warn, red fail, grey when there
    is not enough data or no budget for it. Hover a cell for its verdict and the warn and fail
    lines.
    - A phase only counts from readings with at least **120 frames** in it (about two seconds of
      play). With none, the cell says "not enough data" — never pass. Play each phase a little
      longer and send again.
    - Readings taken with a test switch (**Particles off** and the others) are left out: they
      measure what a feature costs, not the game players get. So are lab runs (their fps is a
      shared runner's, not a device's) and readings whose device class the game did not name. A
      reading with the **30 cap** tag counts for draws and GPU MB but not for fps and p95. Lines
      under the table say how many were left out, and how many were at a 30 fps cap.
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
    - **Bug**: **File as bug**, or the bug it was filed as (see **File a finding as a bug** below).
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
      Our JS is weighed against the frame the screen gives (16.7 ms at 60 Hz), not against the
      frame the game managed: when our JS alone is longer, it is CPU-bound, and every frame waits a
      second refresh (a steady 30 fps on a 60 Hz screen).
    - **Feature cost**: what Particles, Element FX passes or Antialiasing cost on a device, in fps
      and draws a frame, shown when switching it off buys at least 2 fps or 10 % of the draws.
    - **Spikes by cause**: the frames over the spike line while a round plays (spinning, or wins
      with the reels at rest) or an arcade game's field plays, counted by their likely cause (first
      use, particles, rigs, page JS, garbage collection, outside the game…). An arcade game's spikes
      have causes of their own: **sim catch-up** (the sim ran several steps at once after a long
      frame), **sim** (one step took the frame), **spawn burst** (many bodies spawned or despawned),
      **tilemap/upload** (texture data uploaded while the camera moved: the next ground coming into
      view) and **state patch** (the room's messages took the frame). Spikes at idle and in an
      arcade game's menus are left out.
    - **Sim catch-up** (arcade): the share of play frames that ran more than one fixed sim step,
      with the steps a frame, the time in them, and the time the sim dropped (motion slowed). It
      says when the frame rate is below the sim's rate, so every frame catches up.
    - **Spawn churn** (arcade): bodies spawned and despawned a play frame, and the most in one
      frame — pool them rather than make and destroy them.
    - **Cost per body** (arcade): the sim's time a body a step, and what it would cost at the most
      bodies seen against a 60 Hz frame.
    - **Patch / jitter stutter** (online arcade games): the room's states arriving later than the
      room's own clock says — what moves stutters while the fps holds — with the room's bytes a
      second and the time its messages take a frame.
    - The four arcade rules name no saving (`unmeasured`) and are owned by the arcade games'
      agent (`arcade-games`).
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
    - **Heavy downloads**: what a device class's readings downloaded past its **Transfer** budget
      (with the classes that weigh most), and every file past the **Largest file** budget, each with
      what would make it lighter (🗜 Optimize for a PNG, a smaller or split page, one audio format…)
      and the GPU memory it holds when it is a texture. Owned by the art pipeline's agent
      (`atlas-python-tools`) for art, the engine's for code.
    - **Uncompressed text**: JSON, JS, CSS or atlas text over 8 KB served without gzip or brotli,
      with the server that sent it (`unmeasured`: what compression would save is not measured).
    - **Downloaded again**: files a device downloaded again on its next page load though the load
      before had fetched them (the cache kept nothing), a reload that still downloads them, or a file
      downloaded twice in one load. The saving is the MB downloaded again. Never a lab run (each starts
      with an empty cache). These two are the server's caching and compression (`infra-railway`).
    - **Before the first frame**: the MB the page fetches before the game draws anything — the
      player looks at a blank page for all of it — from 1.5 MB, with the first frame's time and the
      largest of those files.
    - **Slow or heavy messages**: the RGS answering slowly (p95 from 500 ms, from a device, never a
      lab run) or with a large answer, and an online arcade room sending a lot (from 30 KB a second,
      or one message over 32 KB). The RGS host is named: in production it is the partner's server.
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

### File a finding as a bug

22. Click **File as bug** in a finding's **Bug** column. It opens the report form of the bug list
    the finding belongs in, filled in from the finding; check it, add screenshots if you like, and
    click **Report bug**. Nothing is filed until you do.
    - A **game bug**, in [Invisible Game Bug Reports](game-bugs.md), is the game's own content:
      texture memory, pages over 4096 px, unused bytes, **Optimize off**, a build that grew, and
      what the game's own Particles or Element FX cost.
    - A **pipeline bug**, in [Invisible Pipeline Bug Reports](pipeline-bugs.md), is the engine or
      a tool: fps below budget, GPU- or CPU-bound, spikes, KTX2 art that fell back, what
      Antialiasing costs, and fps or lab-count regressions. Its **Tool or area** is the tool the
      finding's owning agent owns, else **Game runtime (engine)**, and its project is the
      Profiler's project (it cannot be changed in the form).
    - The **Title** reads "Profiler: `<finding>`". The **Description** holds the rule and
      severity, what was measured, the saving, the owner, and a link to each reading (opening
      **Compare**) and each build (opening its card on **Builds**, `?build=`), each with its JSON.
23. Once filed, the column reads **Filed as BUG-`<n>`**, a link to the bug, with its status under
    it. A finding is filed once: a second filing, even by two people at the same moment, is
    refused and names the bug ("This finding is already filed as BUG-`<n>`."). If the bug is
    deleted, the finding can be filed again.
24. Filing keeps the evidence: every reading and build the finding cites is marked **Keep** and
    stays while the bug exists (see **Keep a reading** above).
25. Filing needs the Profiler and the bug list's own tool (**Game bugs** or **Pipeline bugs**;
    every role has both by default). Without that tool the column shows `—`.

### Compare

26. The **Compare** tab puts two readings side by side. Pick them in **A** and **B** (each reading
    is described by its time, device class and GPU, label, game, build, `lab` and test switches),
    or open one from a finding's evidence. Until both are picked it reads "Pick two readings — or
    open one from a finding's evidence."
27. The table shows, per phase, **fps**, **p95 ms**, **> 33 ms** and **frames**; then, for idle and
    spinning (an arcade game's menu and play), what a frame did — draws, passes, uploads, GL calls
    and JS ms, and for an arcade game its sim steps, sim ms, bodies, room states, their bytes and
    the time its messages took; then **texture MB**; then, for readings from `perf: 9` on, what
    each downloaded: transfer MB, from the cache, files, sizes hidden, the largest file, the MB before
    the first frame, the first frame, the RGS's p95 and the room's KB a second.
    Each row has A, B and **B − A**: green when B is better, red when it is worse (frames is not
    coloured). `—` means a reading has no figure there.
28. It is a difference, not a verdict: two devices differ for reasons no build caused. With a lab
    run on one side and a device on the other, it warns "A lab run beside a device: compare the
    counts, not the fps." The page link keeps both picks (`?tab=compare&a=…&b=…`), so you can send
    it to someone.

### Budgets

29. The **Budgets** tab holds the lines this project is judged against, in four foldable sections:
    **Phone**, **Tablet**, **Desktop** and **Every device** (shipped size). Each row is one metric
    (and phase): **fps**, **p95 frame**, **Draws a frame**, **GPU memory**, **Transfer**, **Largest
    file**, **Shipped size**. The
    phases are the project's game kind's: Idle, Spinning and Round for a slot, Menu and Play for an
    arcade game (plus any other phase the project has its own line for).
    - **Warn** and **Fail** are the project's lines, filled in with the line in force. For fps,
      below the line is bad (`<`); for the others, above it (`>`). A blank line is not checked.
    - **Studio default** shows the studio's line beside it, and a `project` tag when this project
      has its own.
30. The studio defaults:

    | Device        | Metric                    | Warn     | Fail     |
    | ------------- | ------------------------- | -------- | -------- |
    | Phone, tablet | fps idle, menu            | < 58     | < 55     |
    | Phone, tablet | fps spinning, round, play | < 55     | < 50     |
    | Phone, tablet | p95 frame, every phase    | > 20 ms  | > 25 ms  |
    | Phone, tablet | GPU memory                | > 120 MB | > 150 MB |
    | Desktop       | fps, every phase          | < 58     | < 55     |
    | Desktop       | p95 frame, every phase    | > 20 ms  | > 25 ms  |
    | Every class   | Transfer                  | > 20 MB  | > 25 MB  |
    | Every class   | Largest file              | > 3 MB   | > 6 MB   |
    | Every device  | Shipped size              | > 20 MB  | > 25 MB  |

    "60 fps" means locked to a 60 Hz screen, which measures 59.x, hence the lines at 58 and 55.
    Draws a frame and desktop GPU memory have no default; set one if your project wants it. An
    arcade game's **menu** takes idle's lines and its **play** spinning's — a studio default by
    analogy, not an owner number; change them here if your game needs others. **Transfer** takes
    the shipped-size line (what a first visit downloads is what the game ships); **Largest file** is
    a studio default (a 6 MB file is about 5 s alone on a 10 Mbit/s phone link).

31. To change a line, type a value and press **Enter** (or leave the field). **Escape** drops what
    you typed. A value out of range, or a warn line on the wrong side of the fail line, is refused
    with the reason beside it (for example "The warn line must be at or above the fail line (more
    fps is better)."). The reset icon at the end of a row with its own line ("Reset to the studio
    default") brings back the studio default.
32. Everyone with the Profiler and the project can edit its budgets. A budget belongs to one
    project; the studio defaults are not editable here. If someone else saved the same line first,
    yours is not saved: the row shows theirs, with "Someone else changed this budget line first —
    it now shows their value." and the warn and fail you had typed. Type yours again to save it
    over theirs.

## Known limitations / TODOs

The Profiler is built in steps; P1 ("Capture and keep"), P2 ("Builds"), P3 ("Devices and
budgets"), P4 ("Findings" and "Compare"), P5 ("File as bug"), P6 ("Lab runs"), P8 ("Arcade
phases") and P9 ("Network") are done.
Planned in [the design](../design/invisible-profiler.md), not built yet:

- **Scripted cloud phones** (P7), parked: they need a BrowserStack Automate plan. Cloud phones
  are tested by hand today (see **Capture on a cloud phone** above).

Today:

- Leaving-the-page sends have not yet been checked on a real iPhone or Android phone.
- A scripted read (`window.__IE_PERF__('reset' | 'take')`) never sends on its own.
- Reading the list means scanning rows; there is no filter, grouping or chart. The page shows the
  newest 500 readings.
- A reading cannot be deleted by hand; untick **Keep** and the clean-up removes it once it is past
  15 days.
- What a page downloads is read only from a readout of `perf: 9` on; older readings show `–` under
  **Transfer MB** and are not judged on it. A file from a site that sends no Timing-Allow-Origin
  (the partner's RGS, the arcade game server's matchmaking) has its time but not its size. A 3D
  arcade game does not count its room's messages yet. The browser keeps the first 250 files before
  the readout starts listening; a page that fetched more before that misses the earliest.
- Only readings from a game whose readout reports `perf: 7`, `8` or `9` are read. A reading from
  a newer or older readout is refused with its version. A `perf: 7` reading names no game kind, so
  it is read in the slot's phases even from an arcade game (its frames are all **Idle**).
- An arcade game is read in two phases, **Menu** and **Play**. A 3D arcade game counts its play
  frames but not yet its sim, bodies or room states.
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
- A filed bug is a snapshot: its text is not updated when the finding changes, and it is not
  resolved when the finding drops out. When the bug is deleted, the readings and builds it cited
  stay ticked **Keep**; untick them by hand to put them back on the 15-day clock.
- Lab runs are nightly and on demand, not yet after each Publish. They cover only the idle and
  spinning phases (an arcade game's lab run only sits in its menu), with no forced feature on an
  online game's player mock, and a game that ships its own
  built bundle (not the shared runtime) is not run.
