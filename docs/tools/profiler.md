# Invisible Profiler

Invisible Profiler keeps the `?perf=1` readings of a project's published game, so you can see how
it runs on real devices. Open a capture on a phone from a QR code, play, and every reading the game
sends lands in the project's list, kept 15 days unless you keep it longer.

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
   the project in the **Project** picker. The page has three foldable sections: **New capture**,
   **Paste a reading** and **Readings**. Hover a section's title for what it does.

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
   **Device label** if you like and click **Keep reading**. It is kept like a sent reading, marked
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
   - **Build**: the build version the game reports.
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

## Known limitations / TODOs

This is the first step of the Profiler (P1, "Capture and keep"). Planned in
[the design](../design/invisible-profiler.md), not built yet:

- **Builds** (P2): build records with their size breakdown from the desktop launcher's Publish and
  Deliver, the difference from the previous build, and readings joined to their build. Until then
  a pasted delivery reading is not tied to its delivery build; only the build version it reports
  is shown.
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
- Purging a project deletes its readings with it. A duplicated project starts with none.
