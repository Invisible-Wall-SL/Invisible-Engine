# The Play4Fun / HyperGaming RGS protocol

**What this is.** The wire contract our `rgs-translator-eagaming` package implements, read off the
partner's OWN reference client — their slot layer (`server-handler/hyper-gaming/`) and the
`p4f-game-core` / `p4f-slotty-core` libraries under it, shared 2026-09-17 — rather than inferred
from traffic. Everything below is the CONTRACT — request shapes, action names, event names,
config fields. None of their code is reproduced or vendored: it is their proprietary client, and we
implement the same protocol in our own engine.

Until now the only written source was a section of `CLAUDE.md` reconstructed from Hot Fruits
captures plus a WhatsApp thread. That was right about more than it had any business being, but it
was silent on most of the vocabulary and guessed at the rest. This supersedes it; `CLAUDE.md` points
here.

> "HyperGaming" is what their client calls this protocol. "Play4Fun" is the platform; `p4f-core` is
> their shared runtime. The two names describe the same wire format — ours is named
> `rgs-translator-eagaming` after the brand we first discovered it on. All three mean this document.

## Transport

```
POST {gameAPI}&seq={n}[&gid={gameRoundID}]
Body: [{action, context}, …]     (JSON array; `[]` is a balance probe)
```

`gameAPI` arrives from the host page ALREADY CARRYING its query string — hence `&seq=`, not `?seq=`.
Their client takes it whole from `serverConfig.gameAPI` (the page's `params.GameAPI`, e.g.
`/webnode/engine?sid=S0001e`), which is **relative**, i.e. same-origin with the page. That is the
arrangement `rgs.source: 'host'` implements (`docs/design/delivery-builds.md`); we rebuild the URL
from `GameSettings.service` + `.token` instead of consuming `GameAPI` whole, which yields the same
request.

Sibling endpoints are the SAME url with the last path segment swapped — `engine` → `freerounds`,
`engine` → `batchengine` (fast play, plus `&num=`). So the endpoint is a family, not one path.

### Requests are CORS simple requests, and always were

Their `XhrRequest.Post` calls `xhr.open()` then `xhr.send(jsonString)` and **never sets a
`Content-Type` header**, so the browser applies its default for a string body:
`text/plain;charset=UTF-8`. That is a CORS **simple request** — no preflight, ever.

This confirms `rgs.simpleRequest` from the other side. We added it defensively, after the 2-complex
node answered `Access-Control-Allow-Origin: *` with no `Access-Control-Allow-Headers` and refused a
JSON content type at the preflight. The reason is now plain: nothing on their platform has ever sent
a preflight, so nothing on their platform has ever had to answer one. A JSON content type is not
"stricter" here, it is unprecedented.

(Their Node path sends `application/x-www-form-urlencoded` — also simple. There is no code path in
their client that would trigger a preflight.)

### Failures arrive as HTTP 200

`onSuccessed` is only called when `response.error == null`; a body carrying `error` is routed to
`onFailed` despite the 200. This is what `partnerErrorText()` handles in `partnerRgs.ts`, and it is
worth restating because a transport that only checks `res.ok` will treat every refusal as a success.

An `error.action === 'continue'` means the error is non-fatal and the game should keep going.

### Resending — theirs, and ours (2026-09-29)

**Theirs**, read precisely (the earlier summary here over-stated it):

- A resend fires on exactly two things: the XHR `error` event (the request never completed) and an
  **HTTP 200 with an empty body**. Every 1 s, effectively forever
  (`MAX_RESEND_HTTP_REQUEST = Number.MAX_SAFE_INTEGER`).
- The resend reuses the **same URL** — same `seq`, same `gid` — because the URL is built, and the
  counter advanced, once, before the first send. That is what makes a resend a replay rather than a
  new action.
- A **timeout (30 s) is not resent**: it fails the request (`Could not connect to server`). A non-200
  status triggers neither path, so a 5xx leaves the request hanging with no callback.
- While one request is resending, a global gate holds every other request until it succeeds, so a
  retry storm cannot reorder actions — which matters a great deal when `seq` is a position.
- Reconnect start / success / failure are published as events; their popup layer shows a
  "reconnecting" popup and hides it on success.

**Ours** (`eagamingFetcher.ts`, `DEFAULT_RESEND_POLICY`):

|            |                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resent     | a network error, an attempt with no answer in **15 s** (aborted), any **5xx**, 408, 429, an empty 200                                                                                                                                        |
| Not resent | any answer — including an error envelope (a refusal stores nothing) and a 4xx                                                                                                                                                                |
| Pause      | a flat **1 s** (theirs), cut short by the browser's `online` event                                                                                                                                                                           |
| Budget     | up to **90 s** of resending for a request that is safe to resend, then the player is asked to reload — theirs never gives up. A lost round-opening `bet` is the exception: it is not resent at all unless the server names its round (below) |
| Offline    | while `navigator.onLine` is false nothing is sent; the request waits for the network                                                                                                                                                         |
| Order      | one request at a time per session (their gate); a background balance poll is one 5 s attempt, stands down while anything is in flight, and never binds or closes a round                                                                     |
| UI         | `reconnecting` → `connected` / `failed`, published for the overlay (`constants-shared/rgsConnection`)                                                                                                                                        |

**`seq` moves only on an answer.** The position a request aims at is read, not reserved; it advances
by the stored-action count once the server ACCEPTS the request. A resend therefore goes to the same
position, and a request the server already stored comes back as a replay of what it dealt: a free
spin is not re-dealt and a `collect` is not credited twice. A refusal advances nothing — it stored
nothing — so the next action goes where the refused one would have. (Theirs reserves up front;
equivalent while their resend reuses the URL, but ours cannot aim a later request past a slot that
was never filled.)

**The round-opening `bet` is the one request a resend can double-charge.** It carries no `gid` — the
server names the round in its answer — and a `bet` posted at `seq=0` with no `gid` opens a NEW round
(measured live: "a fresh boot against an open round does not replay"). Their client resends it
blind. Ours asks first, with the non-stored `[]` probe (then `config`, for a server that refuses the
probe):

- **the server names an OPEN round** — `platform.gameRound` with `updating: true`, and not the round
  this session last saw close (the partner keeps naming a round after it closes) ⇒ the bet was taken,
  or an older round of the player's is still open — a round they paid for either way. Resend under
  that `gid`, which replays it.
- **anything else ⇒ stop** and ask the player to reload; the boot then shows the server's balance and
  resumes any round left open.

"No open round" is NOT taken as "the bet was not taken". An earlier version resent when the balance
had not moved either; the review of it found the hole. After a timeout or a proxy's 5xx the server may
still be working on the bet, so a probe can find nothing and the bet land a moment later — a resend
there was a second stake (`connection.fixture.ts` § 4, "late"). A zero-win round the server closed on
the spot, or on an auto-collecting server a win that exactly repaid the stake, look the same. The
price is a reload after a lost round-opening answer whose round is not held open; it is rare, because
a bet made while the browser knows it is offline is never sent at all.

**One resend no client can see: the browser's own.** Measured 2026-09-29 in the real game against
the lines mock through a proxy that forwarded a `bet+play` and then dropped the connection before any
byte of the answer: **Chromium re-sent the POST by itself**, on a fresh connection, and handed `fetch`
the second answer as if nothing had happened — the bet was taken twice and our transport saw one
clean success. This is Chromium's rule for a REUSED HTTP/1.1 keep-alive connection that closes before
the answer starts (it assumes the server closed an idle socket). `fetch` cannot opt out — it may not
send `Connection: close` — and the partner's XHR client is exposed identically. With the proxy sending
`Connection: close`, the same drop reached our transport and ended in the reload prompt with one bet
taken. Measured on HTTP/1.1 only, not over HTTP/2. Only a server can make that case safe, by treating
a re-posted round-opening request as a replay; worth raising with the partner if they ever report a
double stake after a network drop.

**A refusal inside a feature ends the session too (2026-10-02).** A refused request is not resent, because it stored nothing. But a feature that stops at one cannot be presented: it has no `gameEnd`, so the game would wait inside it for good. When a `play` or `collect` driven inside a feature is refused, the facade gives the session up exactly as when the resend budget runs out (`abandon`, reason `refused`). The overlay asks the player to reload, and the boot resumes what the server still holds. A refused bet or a refused base-round `collect` are unchanged: they still come back as an error for the game to show.

**A closed round still replays.** A `collect` whose answer is lost is resent into a round the server
has already closed. Both mocks keep closed rounds by session and `gid` for exactly this, and the lines mock —
which ignored `seq` entirely — now replays any request at a position it already holds, and names an
open round on the `[]` probe as the book mock and the partner's boot do.

Proven by `packages/rgs-translator-eagaming/connection.fixture.ts` — `pnpm check:connection`, in
`check:rgs` (CI): a hang, a 5xx, an empty 200, a lost answer mid-round and on the collect, the
round-opening cases (an open round replayed; a slow server's late bet NOT resent; a closed round named
by a probe or by a poll never lent to the new bet; an auto-collected round), offline/online, the give-up budget, request ordering, and the facade end to end.
What the partner's own server does with a re-posted request is owed — see "Checks owed on the live
node" at the end.

### `seq` is a position, and this is now confirmed

Their client:

1. builds the URL from the CURRENT counter, then
2. advances it by the NUMBER OF STORED ACTIONS just posted — `config` excluded.

So a request carrying `[bet, play]` advances by **two**, and the next action belongs at `seq+2`. This
is exactly `advance(storedActions)` in `sessionState.ts` (called once the answer arrives — see
"Resending" above); the earlier "one per request" version would
have written to an occupied position, which is how the server exposes **replay** — silently showing
an earlier spin again instead of advancing.

Their free-rounds path passes an explicit URL (bypassing the automatic advance) and so does
`self.sequence += 2` **by hand**, which is the same fact stated twice.

Two details their code confirms that we already had right: the balance probe (`[]`) and `config`
consume no position. Their filter for this is `data.action !== 'config' && data.action !== []` — the
second half is dead (`!==` against a fresh array literal is always true), but harmless, because the
balance probe posts an empty LIST whose length is zero anyway.

## Actions

| Action            | Context                                            | Notes                                       |
| ----------------- | -------------------------------------------------- | ------------------------------------------- |
| `config`          | —                                                  | Boot. Not stored, consumes no `seq`.        |
| `bet`             | `[x, betPoint]`                                    | See **The first bet argument** below.       |
| `play`            | `null`, or an outcome string                       | Round stays open ⇒ needs a later `collect`. |
| `collect`         | —                                                  | Closes the round. Needs `&gid=`.            |
| `gamble`          | `{type:'double_up', context:'game_round', choice}` | Double-up. **We do not implement this.**    |
| `pickRandomly`    | the pickup trigger data, with `item` chosen        | Player picks a bonus.                       |
| `[]` (empty body) | —                                                  | Balance heartbeat.                          |

Their boot sequence is `config` → history request → connected, then a heartbeat loop at
`balanceUpdateInterval || 30000` ms — the same default `<Authenticate>` uses.

### The first bet argument

`context[0]` is NOT one thing. It depends on the game's bet-config type:

| Bet config                  | `context[0]`                    |
| --------------------------- | ------------------------------- |
| `betOptions`                | the **index** into `betOptions` |
| `line` / `way` / `dynaways` | the **bet multiplier**          |

`context[1]` is always the bet point (the stake step). This is why a single "lines or multiplier"
encoding was never going to be right for both, and why the profile needs to know which game it is.

**Their buy-bonus convention: the LAST option.** Their client takes `betOptions.length - 1` for a
buy, and builds a forced outcome string `"betOption:" + betOptions[last]`. We do NOT copy this — our
menu is built FROM the server's table, so every key we offer round-trips to its own index by
construction, which is stronger than a positional convention. Worth knowing because it is what their
own games assume, and for game 2 (`betOptions: [10, 1000]`) the two agree.

## Response

```ts
{ events: [{ event, context }, …], platform: { balance, gameRound?: { id, freeRound? }, remote?, batch? } }
```

- `platform.gameRound.id` binds the `gid` for the rest of the round. We already do this.
- `platform.remote.freeBalance` present ⇒ the session has a free-rounds wallet.
- `platform.batch` (fast-play only) carries `{win, games, bet}`.

### Events are processed in TWO passes

Their client runs the array twice: **first** `bet` and `playedSpin` only, **then** everything else.
The stake and the board have to be established before any win event is interpreted, and a server is
free to order the array otherwise.

| Pass | Events                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `bet` · `playedSpin`                                                                                                                                                      |
| 2    | `symbolSetInMatrix` · `spinWin` · `spinTrigger` · `bonusWin` · `enterBonus` · `playedBonusSpin` · `gameEnd` · `gameRoundOver` · `pickRandomly` · `chooseBonus` · `gamble` |

Against our facade's vocabulary:

- **We handle:** `bet`, `playedSpin`, `spinWin`, `spinTrigger`, `bonusWin`, `enterBonus`,
  `playedBonusSpin`, `gameEnd`, `gameRoundOver`, `pickRandomly`, `config`.
- **We do not:** `symbolSetInMatrix`, `chooseBonus`, `gamble`.
- **We carry two their client has never heard of:** `tumbleStep`, `multiplierCollect`. These are our
  MOCK's invention, already flagged in `docs/design/delivery-builds.md` — this drop is the strongest
  evidence yet that they are not real, since a client covering gamble and pickups covers no cascade
  vocabulary at all.
- `gameStart` / `spinStart` appear in our captures but their client ignores them.
- The Hold and Win mock adds a whole family of its own on top of the partner's respin model — see
  [hold-and-win-wire.md](hold-and-win-wire.md), which is ours and marked as the swap seam.

## The boot `config` event

`config.context` — the answer to "does the server tell us the grid, paytable and paylines?", which
was an open question in the delivery plan. It does:

| Field                | Meaning                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `window`             | `{reels, rows}` — the grid.                                                                         |
| `availablePayLines`  | Array of lines, each an array of row indices per reel.                                              |
| `maxWays`            | Ways count; falls back to `availablePayLines.length`.                                               |
| `gameCost`           | Base cost; falls back to `availablePayLines.length`.                                                |
| `betOptions`         | Credit cost per option — the bet menu.                                                              |
| `oneCreditBuysLines` | Lines one credit buys (their "cost per line").                                                      |
| `costPerReel`        | Per-reel cost, for buy-a-reel games.                                                                |
| `paytable`           | `occurs[i]` pays `pay[i]`, in one of three wire shapes — see "The paytable is cross-checked" below. |
| `symbolsPay.scatter` | Which symbols are scatters.                                                                         |

Alongside `context`, the `config` EVENT itself carries the resume contract:

| Field     | Meaning                                         |
| --------- | ----------------------------------------------- |
| `actions` | The stored action array of an unfinished round. |
| `resume`  | `true` ⇒ that round is still open; continue it. |
| `replay`  | `true` ⇒ replay mode over those actions.        |

A missing `config` event is **fatal** in their client (it throws). Ours should be at least as loud.

### What reaches the engine (audited 2026-09-17, extended 2026-09-30)

The facade bridges three fields to the engine — `__IE_SERVER_CONFIG__` carries `availablePayLines`,
`symbols` and `window` — plus `betOptions` and `gameCost` consumed separately by `betOptions.ts`, and
since 2026-09-28 `paytable`, which is COMPARED rather than adopted (below).

Since 2026-09-30 three more are published and compared the same way — warned once per boot
(`[game-config] warning: the RGS's boot config disagrees …`), never adopted, because which side is
wrong is a question for the math (`game-config/src/serverDeclaration.ts`,
`serverDeclaration.fixture.mts`; run from `warnOnServerPaytableMismatch`, so no game calls it):

| Declared | Compared with | Not compared |
| --- | --- | --- |
| `maxWinMp` | the base bet mode's authored `max_win` — against `maxWinMp[0]` | later entries: what each one caps is not known. The book mock declares `[10000]` while the remake authors 5,000×, so that boot warns |
| `symbolsPay.scatter` | the symbols the config marks `special_properties: ['scatter']` | — |
| `maxWays` | the ways count of a `ways` game (product of `numRows`) | a lines game (their client uses it only as a payline-count fallback there) |

Still read by nothing: `oneCreditBuysLines` · `costPerReel` — the lines/reels cost model, for games
priced that way. None of ours is.

### The paytable is cross-checked, not adopted (2026-09-28)

The game's info page is built from the AUTHORED config, so a partner who changes a price on their side
— the kind of change nobody tells the client team about — used to leave the game quoting one
paytable while the server paid another. Now `readDeclaredPaytable`
(`packages/rgs-translator-eagaming/src/paytable.ts`) reads the declared table, the facade publishes
it in engine symbol names, and `warnOnServerPaytableMismatch` (`engine-game`) compares it with the
paytable the game shows and logs one `[game-config] warning` per boot, row by row. It warns and does
not "fix": which side is wrong is a question for the math. Proven offline by
`node scripts/verify-server-paytable.mts`.

Since 2026-09-29 the same comparison also runs BEFORE shipping. A partner's `config` cannot be read
server-side (the edge challenges it), so `/config` takes a browser capture of it pasted as text
(`findCapturedConfig` finds the context in a response, an event or a sniffer dump), imports its rows
for review, and keeps it as the project's partner reference. Publish and the delivery bake refuse a
config whose shown paytable disagrees with that reference unless an admin overrides — see
`docs/status/game-config.md`. The scatter row is authored now too (the scatter symbol's own
paytable), so a partner scatter price is imported and compared like any line row.

The wire shape is not one thing, and the field table above was written from one of them:

- `{ line: [entry…], scatter: [entry…] }`, each entry `{ on: { occurs, of, mode }, pay }` — the live
  Book of Thermopylae wire, mirrored by our book mock;
- `{ PIC1: { occurs, pay } }` — our lines mock — or `{ PIC1: [entry…] }`, the shape their client
  names;
- a flat array of entries.

A row with no `mode` is `scatter` when its symbol is in `symbolsPay.scatter` and `line` otherwise.
Every mode but `scatter` is compared as one class, because the info page labels every per-symbol row
`line` whatever the win model — a ways server's `ways` rows are the same claim under another name.

Both sides quote the same stake, so raw multipliers compare directly: a `line` row pays
`pay × betPerLine` on the wire and `multiplier × totalBet / lines` on the info page; a `scatter` row
multiplies the total bet on both. A row the server does not declare is reported only when the server
declared rows of that mode at all — our lines mock pays its scatter off a table it never announces,
and flagging that on every game would train everyone to ignore the warning.

**This audit said Book-of's authored config and the server agreed. They do not.** Measured
2026-09-28: the live `bookofborutremake` authored config (R2) still carries the template's
paytable — `H1` `3:5 4:10 5:20` — while its server (`games.invisiblewall.org`, i.e.
`scripts/mock-rgs-server-book.mjs`) declares and pays `PIC1` `2:10 3:100 4:1000 5:5000`. Nine of the
ten rows disagree, most by one to two orders of magnitude; only the scatter row matches. The new
check names all nine on boot.

Expect it locally too: the BUNDLED `apps/lines` template quotes placeholder prices, so booting it
against either mock warns (7 rows against the lines mock, 9 against the book mock). That is true, not
noise. Online LINES-protocol test-server games stay quiet, because that mock is fed each project's
own authored table (`symbolPaytable`); the book mock is not, which is how the Borut remake drifted.

## Resume — smaller than it looks, and here is the measurement

Their client keeps a `resumeData` queue and, before every request, replays any stored actions the
server still expects (`getResumeActions(untilAction)`), recovering the stake from the stored `bet`
and the round from `platform.gameRound.id`. We implement the part of it a Book-of needs — see
"What we built" at the end of this section.

**That reads like the most dangerous gap in this document. Measured against the live node, it is
not**, and the reason is worth stating because it is not obvious from the protocol alone.

### A round settles in about a second; the rest is animation

Buying the feature on Book of Borut (`gs.2-complex.science`, 2026-09-17) produced **sixteen
requests in 918 ms**:

| `seq`  | What                                           |
| ------ | ---------------------------------------------- |
| 0      | `[bet, play]` — the buy, bet-option index 1    |
| 2 … 11 | ten free spins, one request each, ~70 ms apart |
| 12     | `collect`                                      |

The free-spin INTRO screen had not even appeared yet. By the time the player sees "you win 10 free
spins", the server has already played all ten, closed the round and paid. Everything after that
first second is presentation over a settled outcome.

So the window in which a round is open is roughly one second per spin, not the ~60 s a feature takes
to play out. **Verified the hard way:** reloading the tab in the middle of the free-spin
presentation, the balance came back `€10,168.50` — the full `€177.50` feature win, banked, despite
the client never finishing the animation. Nothing was lost and there was nothing to resume.

### What the live runs actually showed

- **A fresh boot against an open round does not replay.** Reasoning from `seq`-as-position, the
  obvious inference is that starting over re-posts `bet` at an occupied position and triggers the
  replay path. It does not: the server issued a **fresh round id** and a real spin. Replay is reached
  by re-posting within a round the client is still tracking, not by starting over.
- **The one real cost is a stale wallet.** With a round left open, the HUD sat €1.00 below the
  server's own figure, because our two-step balance leaves it on the interim from `requestBet` until
  `requestEndRound` lands. A reload revealed the true number.
- **`seq` is right at scale.** That 13-position round is the strongest test this implementation has
  had — a per-request counter would have mis-numbered every free spin after the first.

### The round that sent no `collect` — a losing spin (settled 2026-09-29)

Across the first live session, one spin in four sent no `collect`. **That is the protocol working,
not a round left open.** The server closes a **zero-win** round itself, in the `bet+play` answer:
that answer carries `gameRoundOver`, the fetcher ends the round on it, and `requestEndRound` — which
collects only while a round is bound — has nothing to collect. The partner's own client agrees: it
raises its collect step only when a round ends with `totalPoint > 0`, so it sends no `collect` for a
losing spin either. Three winning rounds and one losing one is exactly "three collected, one did
not".

Reproduced against the book mock in the partner's `AUTO_COLLECT=0` mode (`connection.fixture.ts`
§ 9, twelve spins through the real facade): every winning round sent a `collect`, no losing round
did, and every round ended closed on the server with the wallet to the cent. Not a bug of ours.

**Confirmed on the live node, 2026-09-29.** Ten base spins of the branch build through
`?rgs_profile=2complex` on the partner's test node: every losing `bet+play` answer carried `gameEnd`
**and** `gameRoundOver` and no `collect` followed; every winning one carried `spinWin`…`gameEnd`
without `gameRoundOver`, and its `collect` went at `seq=2` with the round's `gid` and was credited.
Also seen there: the partner names the round on `platform.gameRound` even in the answer that CLOSES
it — so the transport remembers the last round an answer closed and never takes a probe naming that
one for a round a lost bet opened.

### What we built (2026-09-28)

The boot now finishes a round the session left open, instead of starting over beside it. The
mechanism is the partner's own, read off their client (`processResumeData` / `getResumeActions`):

1. **Detect.** The boot `config` event carries `resume: true` and the round's stored `actions`, and
   the response names the round on `platform.gameRound.id`. All three are required; `replay: true`
   alone is their history viewer, not a round owed to anyone.
2. **Replay.** Bind that `gid` and re-post the stored actions from `seq=0`, grouped the way they were
   first sent — each request ends at a player-driven action (`play`, `collect`, a pick, a gamble)
   with a `bet` riding ahead of its `play`. Every position is occupied, so the server answers each
   with the result it already dealt: **no stake is taken twice, no board is re-dealt.** Their client
   groups and numbers them the same way (`sequence` advances by the stored-action count).
3. **Continue.** A feature cut off between free spins is played out live from the next free position
   and collected, exactly as `requestBet` carries a fresh bonus.
4. **Present.** The facade returns the whole round as an `active` round from `authenticate` — the
   shape of a Stake resumed bet — so the engine's existing `resumeBet` path presents it from its
   first event and ends it through `requestEndRound`, which collects a base win like any spin. The
   player sees the outcome they paid for and ends on the wallet the server holds.

Always resumed on the **base** mode: the stake was debited when the round began, and the resume
machine never drops a bought mode back to base the way a fresh bet does — so a resumed buy would
leave the next spin buying again.

**Every replayed response must name the round it was aimed at.** Anything else means the server took
the re-posted `bet` as a new stake — the one way this can charge twice — and the resume stops with an
error rather than present a second round. That, a refused step, or a dropped request all abandon it
the same way: no round is presented, the `gid` is released, and the balance is re-read.

**Owed: one check on the live node.** That the partner replays a re-posted `bet` under its `gid` is
read off their client and proven against our mock, not yet against their server. Before a partner
delivery: leave a base win open with a raw `bet+play`, reload, and confirm the balance does not move.

It also fixed a quieter bug: before this, the boot's `config` response auto-bound the open round's
`gid` and nothing ever released it, so `requestBalance` (which stands down mid-round) skipped every
cashier-deposit poll until the player's next spin.

Proven by `packages/rgs-translator-eagaming/resume.fixture.ts` — `pnpm check:resume`, in CI (real
facade over the real book mock in `AUTO_COLLECT=0` partner mode, a reload simulated by a fresh facade
instance) and in the browser on
`apps/lines`: a base win and a buy cut off after two free spins both presented, collected and landed
on the server's balance to the cent, with the wire walk `0:bet+play · 2 · 3` (replay) `· 4…11:play ·
12:collect`.

**Still not built — the full queue.** Their client keeps replaying across player-driven steps (a
pickup, a gamble) where the server genuinely waits on input mid-round. We replay everything stored
at boot and then drive the rest ourselves, which is right for a game whose rounds need no input.
A game with a pick or gamble would need the queue.

## Where the host glue lives (and why we did not find it)

Neither `p4f-game-core` nor `p4f-slotty-core` reads `window.params` or `GameSettings` anywhere. The
cores take an already-built `serverConfig` (`gameAPI`, `urlHistory`, `outcomes`,
`balanceUpdateInterval`, …); assembling it from the embed page is each GAME PROJECT's own bootstrap,
which neither drop includes.

Nothing turns on it. We build the request URL from `GameSettings.service` + `.token` via
`host.ts`, where they consume the page's pre-assembled `params.GameAPI`; the two produce the same
request against the same origin.

## Host settings — `GameSettings.config` (2026-09-30)

`window.params.GameSettings.config` is the OPERATOR's declaration of what this launch may do. The
set is per brand and extensible on request (`docs/design/delivery-builds.md` § "Host settings");
the table below is every field we know of — the `eanew` set, plus the few the partner's client
names that `eanew` does not carry yet.

**The rule (owner decision, 2026-09-30): any game may ship under ANY jurisdiction.** So there is no
per-jurisdiction logic anywhere in the game. Every behaviour below is driven ONLY by what the
operator declared, and a field that is absent — or present with a value we cannot read — gives the
**neutral default**: the behaviour off, the surface not shown. Never a market's assumed value. A
launch that declares nothing (every game we host ourselves) therefore behaves exactly as it did
before any of this was read.

**Where the semantics come from.** Neither core reads `GameSettings` (above), so no field's meaning
is read off an assignment. Where the core's own `GameConfig` / `BalanceConfig` carries the SAME name
(`minSpinDuration`, `confirmGameRoundStart`, `autoplayDisabled`, `autoplaySpins`, `historyClient`,
`locale`, `isLockChangeCurrency`, `currencySymbol`, `denom`) the meaning is what the core does with
it; the rest are read from their names and marked _inferred_. Every inferred one is on the owed list
at the end.

**One reader.** `delivery-profile/src/operator.ts` (`readOperatorSettings`) types every field the
engine honours beyond the bet ladder and the jurisdiction flags; `state-shared` holds the result as
`stateOperator`, adopted once at boot in `Authenticate`. Unreadable ⇒ neutral, per field:
`operator.fixture.ts`. A boolean counts only when it is the literal `true` (a `"true"` string is
silence), a ladder with one bad rung is no ladder, and a link must be `http(s)` or a same-origin path.

**Trying one without the partner.** The Invisible Test Server injects a real `window.params` from a
project's `hostSettings` (its `test_server/games.json` entry) and, per launch, from
`?host={"minSpinDuration":3000}` (URL-encoded JSON, merged over the project's) on a link that also
carries the project's read token `k` — so a crafted link cannot repoint a HOME button or a money
symbol. A dev server reads the same `?host=`; a production build does not. `services/test-server/hostSettings.fixture.mjs`.

### The fields

Units are the protocol's: stakes in **credits** (`betOptions[x] × M`), money = credits × `denom`,
durations in **ms**.

| Field | Meaning | Absent ⇒ | Where the engine honours it |
| --- | --- | --- | --- |
| **Bet ladder** | | | |
| `betMultipliers` | The M values: total stake = `betOptions[x] × M` | placeholder $0.10–$100 ladder | `rgs-translator-eagaming/betOptions.ts` `buildBetLadder` |
| `initialBetMultiplierIndex` | Rung the game opens on | ladder's own default | same |
| `minNormalBet` · `maxNormalBet` | Lowest / highest total BASE stake, credits — _inferred units_ | no clamp | facade authenticate ladder: rungs outside dropped, default moved inside; a clamp that would empty the ladder is refused with a warning |
| `showBetRanges` | Show lowest – highest bet | not shown | info page `BET RANGE` block (`infoManifest.ts`) |
| `denom` | Money per credit — a whole number of millionths (finer cannot be priced in engine units, so it is refused) | `0.01` (the protocol's; 1 credit = 1 cent) | amount scale in `rgs-translator-eagaming/src/amounts.ts`; the placeholder ladder snaps to whole credits |
| `showCreditValue` | Show what a credit is worth | not shown | info page `CREDIT VALUE` block, with as many decimals as the credit has |
| `betFactors` · `betPoints` | Their older point-ladder encoding | — | **not read** — `betMultipliers` states the same ladder |
| `oneCreditBuysLines` · `reelsCost` · `ignoreLines` | Lines / reels cost model (`ignoreLines` server-only) | — | **not read** — the server's `betOptions` price every game we ship |
| **Speed** | | | |
| `enableTurbo` | `false` forbids turbo (and hold-to-spin-fast) | allowed | facade → `jurisdiction.disabledTurbo` → `setJurisdiction` lock |
| `allowAutoplay` | `false` forbids autoplay (and hold-Space) | allowed | facade → `jurisdiction.disabledAutoplay` |
| `autoplayDisabled` | `true` forbids autoplay — the core's own name for the same lock | allowed | same; either field forbidding wins |
| `autoplaySpins` | Round counts the autoplay menu offers; `-1` = until stopped | the engine's `10 … 1000, ∞` | `stateUi` live ladder → HTML modal + authored repeater sources |
| `lossLimits` · `singleWinLimits` | Limit options, **multiples of the stake**, `-1` = none — _ours to define: not in `eanew`, named by the core_ | the engine's `5× … 100×, ∞` | same |
| `minSpinDuration` | No spin shows its result sooner than this after it started — every spin, free spins included, turbo and slam included | no minimum | `state-shared/spinClock.ts`, held in `presentReveal` (the reels keep rolling) |
| `confirmGameRoundStart` | Ask before every paid round | no prompt | `newGame` gate (`utils-xstate`) + `RoundStartConfirm` (in-canvas `ConfirmDialog`) |
| **Payback** | | | |
| `showTheoreticalPayback` | Show the game's RTP | not shown | facade → `jurisdiction.displayRTP` → info page `RTP` block |
| `showBuyBonusPayback` | Show the buy modes' RTP | not shown | info page `BUY FEATURE RTP` (never while buying is forbidden) |
| `showHighChancePayback` | Show the ante ("high chance") modes' RTP | not shown | info page `HIGH CHANCE RTP` |
| `allowOutcomeBuy` | `false` removes every bought feature | allowed | facade → `jurisdiction.disabledBuyFeature` |
| **Money & locale** | | | |
| `currencySymbol` | The glyph to print | the currency code's own | `utils-shared/amount.ts` `numberToCurrencyString` |
| `currencyFormat` | Money pattern, numeral-style: `{0}` = symbol, `#,#` = grouping, `.00`/`.#0` = decimals — _inferred from the core's `balanceFormat`_ | the locale's own layout | same |
| `locale` | UI language (`en`, `pt_BR`, `es-ES`) | `?lang=`, then `en` | `stateUrlDerived.lang()` |
| `isLockChangeCurrency` | Locks the player's credits ↔ money toggle | — | **nothing to lock** — the engine always shows money and has no toggle |
| `balanceUpdateInterval` | Wallet re-poll, ms (floored at 5000) | never polled | `Authenticate` |
| **Chrome** | | | |
| `home` | Lobby link — a HOME button | no button | operator chrome + authorable `home` action |
| `clock` · `showTime` | Show the wall clock — _inferred_ (`showTime` is the core's `isShowTime`) | not shown | operator chrome + `clock` value source |
| `elapsedTime` | Show how long the session has run — _inferred_ | not shown | operator chrome + `sessionTime` value source |
| `errorPanel` | _Unknown_ — no name in either core | — | **not read** — owed item 3 |
| `whiteLabel` · `brandName` · `scale` · `gameId` | Branding / layout / id | — | **not read** — no behaviour of ours depends on them |
| **History** | | | |
| `externalHistoryUrl` | Where round history lives — a HISTORY button — _inferred_ | no button | operator chrome + authorable `history` action |
| `historyClient` | This launch IS the history viewer: with the boot `config`'s `replay: true` the core replays that round instead of playing | a normal launch | **not read** — owed item 4 |
| `showFreeRoundBet` | Free-rounds display | — | **not read** — we implement no free rounds |
| **Not ours** | | | |
| `jackpot` · `jpspin` | Jackpot | — | not read — no jackpot |
| `deniedCountryCodes` · `allowedCountryCodes` · `certificator` | Enforced by their page/server before we load | — | not read |
| `versionPath` · `certifiedVersionPaths` · `customJs` · `beforeGameEmbedHeadInclude` · `flash` | Build / page injection | — | not read |
| `demo` · `allowForcing` | Added by their page (`session.demo`, outcome forcing) | — | not read |

The boot `config` EVENT (server-side, above) carries four more that are the game's, not the
operator's: `symbolsPay.scatter`, `maxWays`, `costPerReel`, `maxWinMp` — see "What reaches the
engine".

### The rules, where a line in the table is not enough

- **Bet clamp** (`clampBetLadder`, `betOptions.ts`). A rung's base stake in credits is
  `level / amountScale()`; rungs below `minNormalBet` or above `maxNormalBet` (inclusive bounds) are
  dropped, and an opening rung that was dropped moves to the nearest one left (the lower on a tie).
  A clamp that would leave NO rung — what a misread unit looks like — is refused whole and warned
  once: a wrong guess costs a limit, never a game that cannot bet. Applies to the server ladder and
  the placeholder alike, on the Play4Fun transport only.
- **Autoplay ladders** (`stateUi.svelte.ts`). A declared list (at most 24 options) is offered
  exactly, sorted, `-1` read as `∞`; the current pick, when the list does not offer it, reads as the list's FIRST option (for a
  limit, the most protective). The coded ladders and defaults stand when nothing is declared. An
  ante's "activate" still writes `∞` to both limits; under a declared list without `∞` that reads as
  the first option.
- **Minimum spin duration** (`spinClock.ts`, held in `presentReveal`). A paid round's first reveal is
  timed from the PRESS (marked in `newGame` after any confirmation, so the RGS round trip and the
  pre-spin count, as on their client); every later reveal of the book — each free spin — and a
  resumed round's first reveal from their own start. The reels keep rolling through the hold (a free
  spin or a turbo/Space-hold round starts the pre-spin roll itself); a swap-in-place board just
  waits. A plain timer: slam and turbo cannot shorten it, and land the reels at once when it ends.
  So a result shows no sooner than the minimum PLUS the reels' landing — their client holds the
  result the same way and lands after it. Replay is exempt. The time a round-start question is open
  does not count.
- **Round-start confirmation** (`roundConfirm.svelte.ts`, `RoundStartConfirm.svelte`). Asked in
  `newGame`, before anything rolls, for every PAID round — each autoplay and Space-hold round
  included, a bought feature too (after its own buy confirmation). Free spins are never asked. While
  it is open the spin press is inert (the unskippable-presentation latch) and Space/Enter keydown is
  held back from the game. A no places nothing, ends the machine without an error, and stops autoplay
  and a Space hold. The question shows the stake. An authored `roundConfirm` scene replaces the
  engine's dialog.
- **Money** (`utils-shared/money.ts`). `currencySymbol` alone: the locale's own layout, with the
  currency part swapped for the symbol. `currencyFormat`: the first run of `#0,.` is the number — a
  `,` before the `.` turns grouping on (the LOCALE decides the separators), the digits after the `.`
  are the decimals (none ⇒ 0, capped at 4) — everything else is literal text and `{0}` is the symbol
  (the declared one, else the currency's own). A pattern with fewer than two decimals still prints two
  for an amount with cents, so `0.5` never reads `1`. Social coins (`XGC`/`XSC`) keep their own form.
  The compact bet-ladder tiles follow the pattern's decimals.
- **Locale** (`localeResolution.ts`). A declared `locale` that maps to a language the game ships
  (case-insensitive, `_` = `-`, exact tag then primary subtag: `pt_BR` → `pt`) wins; otherwise `?lang=`
  exactly as before, then `en`. A declared locale we do not ship never forces `en`. The same answer
  drives Lingui, money and number formatting, and the `language` sent to the RGS.
- **`denom`** (`rgs-translator-eagaming/src/amounts.ts`). Every wire amount is credits; engine units
  per credit are `1,000,000 × denom`, so a denom must be a whole number of millionths (`validDenom`)
  — `1e-7` would price every credit at zero. Absent or refused ⇒ 0.01, the scale every game has
  always used. The placeholder ladder (a server with no bet table, or no `betMultipliers`) is priced
  in money and snapped to whole credits, so the stake shown is the stake charged.
- **Operator chrome** (`registerOperatorChrome.svelte.ts`, `OperatorChrome.svelte`, mounted from
  `GlobalStyle` so every game has it without authoring). A thin strip at the top edge shows the
  declared clock (`HH:MM`, the locale's), `SESSION TIME H:MM:SS` since boot, HOME and HISTORY. It
  renders no element when nothing is declared and starts no timer. Each item yields to the HUD: an
  authored text box bound to `clock`/`sessionTime`, or an element gated by
  `clockShow`/`sessionTimeShow`/`homeShow`/`historyShow` (or a button on the `home`/`history` action),
  hides that item from the strip. HOME navigates the TOP window (this frame's when the top is
  cross-origin); HISTORY opens a new tab, `noopener`. Both links must be `http(s)` or a same-origin
  path — anything else is no link at all.

### Owed to the partner — what only they can settle

1. **`minNormalBet` / `maxNormalBet` units.** Read as credits of the total base stake. Neither core
   reads them (the per-game bootstrap is not in the drop). The safety valve keeps a misread from
   emptying the ladder, but a wrong unit still clamps wrongly.
2. **`clock` · `showTime` · `elapsedTime` · `home` · `externalHistoryUrl` · `currencyFormat`** — names
   read at face value (`currencyFormat` as their core's `balanceFormat` pattern). Confirm the types
   (booleans / URL strings) and that `home` is a lobby URL rather than a flag.
3. **`errorPanel`** — no meaning known; not read.
4. **`historyClient`** — their core opens as a history VIEWER when this is `true` and the boot
   `config` says `replay: true`. We have no such mode for this protocol: a launch declaring it plays
   normally. Needed only if they launch our games as their own history viewer.
5. **`lossLimits` / `singleWinLimits`** are not in `eanew`; we defined them (multiples of the stake).
   If a regulator needs them, this is the field to request, with that meaning.
6. **`maxWinMp`** beyond index 0.

## Things we have no equivalent for

Recorded because each is a real feature of the protocol, not because any is scheduled:

- **Resume across player input** — a round waiting on a pick or gamble; see "Resume" above.
- **Gamble** (double-up on a finished round).
- **Free rounds** — a separate `freerounds` endpoint with `&action=choose&frid=&betid=`, plus
  `gameRound.freeRound.totalWin` on the platform object.
- **Fast play** — `batchengine` with `&num=N`, returning an aggregate `platform.batch`.
- **History** — its own request; their client fetches it during boot.
- **Forced outcomes** — `play.context` takes an outcome string, gated by the config's
  `allowForcing` / `allowOutcomeBuy`.

## Checks owed on the live node

Three replay claims are proven against our mocks and read off the partner's client, not yet
observed on their server (the losing-spin close was observed — see above). None can be probed from here: reaching the replay path means posting real stored
actions into a real session, and we hold no wallet on that node that is ours to spend. So this is
the procedure for the owner, in a real browser tab on the game origin (the node is behind a
Cloudflare challenge; a server-side fetch is bounced). Each step costs at most one minimum stake.

1. **Open** the partner's test launch of the game. In DevTools, filter the network panel on
   `engine`, with "Preserve log" on.
2. **A re-posted request replays.** Spin until one WINS (the round stays open). Before the count-up
   ends, copy that `seq=0` request (right-click → Copy → Copy as fetch), note the balance, and run
   it in the console **with `&gid=<platform.gameRound.id from its answer>` appended to the URL**.
   Expected: the same `playedSpin` board and the same balance — nothing charged. Then let the game
   collect.
3. **A collect replays after the round closed.** Copy that `collect` request (it carries `seq=2` and
   the `gid`) and run it again. Expected: an answer with `gameRoundOver` and the balance unchanged —
   neither an `unexpected action` error nor a second credit.
4. **The probe names an open round.** Spin until a win and, before it collects, run the same
   engine URL with `seq=0`, no `gid`, and body `[]`. Expected: `platform.gameRound.id` present. If
   it answers `not authorized` (code 118), repeat with body `[{"action":"config"}]` — the transport
   falls back to it — and expect the same id.

If 2 or 3 fails, a lost answer inside a round ends in the reload prompt instead of a replay — never
a double charge, since the transport takes an error as an answer and stops resending. If 4 fails
both ways (or the open round is not marked `updating: true`), a lost round-opening answer on that
node always ends in a reload — safe, only less forgiving. Report either and the reference gets the measured behaviour.
