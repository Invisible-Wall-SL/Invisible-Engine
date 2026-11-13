# RGS — lessons

What has bitten RGS work before, newest first. Format and rules: [README](../README.md).
Current state lives in [status/engine.md](../../status/engine.md) and the wire contract in
[reference/play4fun-protocol.md](../../reference/play4fun-protocol.md); this file only keeps the
traps. It covers the translator (`packages/rgs-translator-eagaming`), the mock RGS
(`services/test-server`, `scripts/mock-rgs-server*.mjs`), money, `seq`/`gid`, resume and delivery
builds. Slot-type traps live in the family files, e.g. [lines](../families/lines.md).

### A line paid from the right lit the left end of the line

- **Symptom:** on the partner's Getting Hot, a 3-of-a-kind line win paid the right amount, but the
  lit cells and the drawn line were reels 0–2 (heart, shovel, club: no win), not the three clubs
  on reels 4, 3, 2 that paid.
- **Cause:** the partner reads some lines from the right (`spinWin` `context.direction:
  'right'`). The facade's `winPositions` handed over the whole payline and ignored `direction`;
  the engine's `winningPositionsOf` keeps the leftmost `kind` cells of a line.
- **Fix:** `winPositions` hands over only the `occurs` rightmost cells of a line read from the
  right. A left-read line is unchanged.
- **Guard:** `collectorRespin.fixture.ts` "right line win" (fails without the fix).
- **PR:** this one (2026-11-12) · source: `docs/status/hold-and-win.md`

### A partner free-spin retrigger would have played with no celebration

- **Symptom:** none seen live yet. Found by auditing the mocks against the partner's client: on a
  partner free-spins game, a retrigger would add its spins to the counter but play no retrigger
  celebration.
- **Cause:** the facade celebrated only our mock's `retrigger` event. The partner's client has no
  `retrigger` case; it reads a free-spin retrigger off a `spinTrigger` that arrives during free
  spins. Our mocks never sent one, so no gate ever played the partner's shape.
- **Fix:** the mocks send the partner's `spinTrigger` before our `retrigger`. The facade
  (`freeSpinRetriggerAt`) celebrates from the `spinTrigger`, once, whether or not a `retrigger`
  follows.
- **Guard:** `check:mock-wire` plays every outcome each mock deals through the facade, including a
  retrigger with our `retrigger` stripped out. The table in `reference/play4fun-protocol.md` ("Mock
  audit") marks every event the mocks send as captured, partner client, other provider or ours. An
  event marked ours needs a capture before a game ships on it.
- **PR:** this one (2026-11-12) · source: `docs/status/engine.md`

### Getting Hot paid its line wins but no symbol animated
- **Symptom:** on the partner's collector game (Getting Hot), a line win credited the WIN meter
  but the winning symbols never played their win animation and no line was drawn.
- **Cause:** `normalizeCollectorRespin` (`collectorRespin.ts`) re-emits a spin as its board's
  `playedSpin` followed by the spin's "tail" events. `spinWin` arrives after `playWindow`, so it
  fell into the tail and reached the facade AFTER the reveal. The facade turns buffered `spinWin`s
  into `winInfo` only at `playedSpin`, so the wins stayed buffered and were dropped; `gameEnd` still
  paid the amount.
- **Fix:** the rewrite puts `spinWin` in the segment's head, before its `playedSpin`.
- **Guard:** `collectorRespin.fixture.ts` "line win" (part of `pnpm check:holdandwin`): one
  `winInfo` right after the reveal. Our partner-wire mock deals the same order, so the bug showed
  there too; the 14 capture was a buy round with no line win, so no fixture had one.
- **PR:** this one (2026-11-12) · source: `docs/status/hold-and-win.md`

### A refused ante or buy blanked the reels
- **Symptom:** with the operator's ante switched off, pressing spin cleared the board to empty
  reels (and opened the error modal).
- **Cause:** the roll starts on the press, before the server answers; a refused bet runs the
  machine's error path, whose `settle()` with no board empties every reel.
- **Fix:** `actor.ts` keeps the board on screen when the round began; the `onBetRefused` hook ends
  the roll with the new `enhancedBoard.cancelPreSpin()` (the loop finishes its lap at home; a bare
  `settle` leaves the loop and `rolling` running, and landing a synthetic `spin` left the board
  undrawn), then settles that board. The refusal is a toast and the option leaves the menu
  (`refuseBetMode`). Only a mode marked `refusable`: 110 is also the "malformed bet" code, which
  must stay an error.
- **Guard:** none automated — played against `DISABLED_OPTIONS=1,2,3` on the partner-wire mock.
- **PR:** 14c (2026-11-09) · source: `docs/status/hold-and-win.md`

### A 200 page instead of the protocol crashed the spin; an unpriced bet went out as 5 lines
- **Symptom:** a bet answered by an HTTP 200 that was not JSON (an edge's challenge page, a proxy's
  HTML) ended in a `TypeError` inside `translateBetResponse` instead of an error the modal names.
  A bet on a session whose boot config never arrived was sent as `[5, amount / 5]`.
- **Cause:** `httpFailure` treated a body-less answer as a failure only outside 2xx, so a 2xx page
  fell through to the round code. `betLineCount` guessed Hot Fruits' 5 lines when no payline set
  was declared, which a server with an option table reads as option index 5.
- **Fix:** a body-less answer is an error at ANY status (`ERR_HTTP_BAD_BODY` for a 2xx); the
  transport already left `seq` where it was. A bet with no option table and no declared paylines
  is refused before anything is sent (`refuseUnpricedBet`, `ERR_GE`).
- **Guard:** `check:connection` §2b, §11, §12.
- **PR:** not recorded (2026-11-09) · source: `docs/status/engine.md`

### A free-spin feature stalled mid-round after a publish or refusal
- **Symptom:** the client sat at free spin 7/20 with no way out.
- **Cause:** every publish or runtime release `POST /refresh`es the test server, which rebuilt each
  mock with `round: null`; and a refusal mid-feature still presented a book with no `gameEnd`.
- **Fix:** `openRounds.mjs` holds open rounds; a refusal mid-feature `abandon`s ("Reload").
- **Guard:** `openRounds.fixture.mjs`; `check:connection` §10 and §10b.
- **PR:** not recorded (2026-10-02) · source: `docs/status/engine.md` ·
  [lines.md](../families/lines.md#known-failure-modes)

### A tab was priced by the partner's bet table after its project switched mock
- **Symptom:** a tab booted on our Hold and Win table `[10, 1000]` was charged 50 for its buy
  once the project gained `holdAndWin.enhancements`, until it reloaded.
- **Cause:** the test server's rebuild carried a runtime tab's `configSent` and bet table across
  mock types; the partner mock reads the option index against its own `[10, 50, 500, 1000]`.
- **Fix:** `makeMock` stamps the partner mock's `wire`; a rebuild that changes wire (`sameWire`)
  drops the carried config, so the tab's bet is refused and a reload re-reads. A held open round is
  judged against the instance that dealt it, never the latest swap, which a chain of swaps re-stamps.
- **Guard:** `services/test-server/mockSwitch.fixture.mjs` (idle and held-round tabs, swap and
  `/refresh` chains).
- **PR:** not recorded (2026-11-12) · source: `docs/status/hold-and-win.md`

### The operator's turbo, autoplay and opening bet were ignored
- **Symptom:** a licence's "no turbo" did nothing, and every game opened on $1.
- **Cause:** the facade spread `hostJurisdiction()` BEFORE its hardcoded defaults, so they won;
  the engine read only `disabledFullscreen` and never `defaultBetLevel`. Three silent breaks.
- **Fix:** host flags spread last; `setJurisdiction` + `lockUiFeatures` (`state-shared`) lock what
  a licence forbids so authored settings cannot lift it; the opening bet is `defaultBetLevel`.
- **Guard:** `authenticate.fixture.ts`, `services/test-server/hostSettings.fixture.mjs`.
- **PR:** not recorded (2026-09-28) · source: `docs/status/engine.md`

### A bet was taken twice and fetch saw one clean answer
- **Symptom:** under a fault proxy the server stored the bet twice; the client sent it once.
- **Cause:** Chromium itself resends a POST when a reused keep-alive connection closes before the
  answer starts. `fetch` cannot send `Connection: close`; the partner's XHR is exposed the same.
- **Fix:** none possible in the client; recorded in the protocol reference for the server side.
- **Guard:** none. Do not "fix" it with client resend logic.
- **PR:** #858 (2026-09-29) · source: `docs/reference/play4fun-protocol.md`

### A lost answer hung the spin or charged twice
- **Symptom:** a hung request froze the game; a lost answer was a dead game.
- **Cause:** `eagamingFetcher` took the `seq` position BEFORE the fetch, with no timeout or resend;
  a blind resend of the round-opening `bet` (no `gid`) would open a second round.
- **Fix:** resend at the SAME `seq` and `gid`; `seq` advances only on an answer
  (`sessionState.advance`); the opening `bet` is resent only under a round the server names open.
- **Guard:** `pnpm check:connection` (in `check:rgs`), incl. a late-landing bet.
- **PR:** #858 (2026-09-29) · source: `docs/status/engine.md`

### A second tab charged my base spin as a buy
- **Symptom:** a $1 spin in one tab was debited 10000 and entered the feature.
- **Cause:** the demo `sessionID` lived in `localStorage`, so every tab shared one mock session:
  wallet, open round, `seq` positions and the bet table it was told about.
- **Fix:** the minted `demo-<uuid>` lives in `sessionStorage` (`state-shared` `stateUrl.svelte.ts`).
- **Guard:** none; a duplicated tab still shares (it copies `sessionStorage`).
- **PR:** found by #853 review (2026-09-29) · source: `docs/status/engine.md`

### A buy card debited the base bet
- **Symptom:** a $100 buy card was debited $1 and dealt a base spin.
- **Cause:** the lines-family mock declared no `betOptions`, so the facade sent the legacy
  `[lines, betPerLine]`, which carries no mode. The book mock's case is in the lines family file.
- **Fix:** the launcher puts authored modes on the mock contract (`mockContract.ts`); the mock
  prices `bet [x, M]` as `betOptions[x] × M` and refuses an unknown index.
- **Guard:** `pnpm check:buy-cost`; a mode the server's table cannot name is refused before sending.
- **PR:** #853 (2026-09-29) · source: `docs/status/engine.md`

### A test-server refresh took minutes
- **Symptom:** a runtime pin took 166 s to go live in a rollback drill.
- **Cause:** `hydrate()` re-GET every object of every desktop build (~750 MB) on each `/refresh`.
- **Fix:** `readFiles(key, previous)` reuses objects whose ETag is unchanged: ~160 s → ~1.6 s.
- **Guard:** none.
- **PR:** found in the #844 drill (2026-09-29) · source: `docs/status/engine.md`

### A round left open was never finished
- **Symptom:** after a reload mid-round the player never saw the paid outcome; a win sat uncredited.
- **Cause:** the boot ignored the `resume` contract on the `config` event; and the boot auto-bound
  an open `gid` nothing released, so balance polls stood down until the next spin.
- **Fix:** `requestAuthenticate` re-posts the stored actions from `seq=0` under the round's `gid`
  (a replay, no second stake); every boot that resumes nothing releases the `gid`.
- **Guard:** `pnpm check:resume`. Owed: one live replay check on the partner node.
- **PR:** #802 (2026-09-28) · source: `docs/status/engine.md`

### The info page quoted one paytable while the server paid another
- **Symptom:** none visible: a partner re-pricing their math would have gone unnoticed.
- **Cause:** the info page is built from Game Config, never from the server's `config` paytable.
- **Fix:** `readDeclaredPaytable` (`src/paytable.ts`) reads the three wire shapes; boot compares
  with `comparePaytables` (`game-config/src/serverPaytable.ts`) and warns on drift.
- **Guard:** `scripts/verify-server-paytable.mts`. Our mock pays what `/config` sets.
- **PR:** not recorded (2026-09-28) · source: `docs/status/engine.md`

### A delivery guard passed its fixture and blocked the real delivery
- **Symptom:** `build-delivery.mjs` refused `bookofborutremake` within the hour of shipping.
- **Cause:** the source guard was tested on a synthetic tree whose `assets/` held one PNG; real
  bundles carry `assets/**/index.ts` manifests. Exempting them then left them in the zip.
- **Fix:** strip what the running game never loads; refuse `.map`/`.env` everywhere.
- **Guard:** rule: test a guard on a real delivery tree; nothing a game does not load ships.
- **PR:** not recorded (2026-09-24) · source: `docs/status/engine.md`

### The partner's embed page rode in the CDN folder
- **Symptom:** a delivery would have published the partner's server-side page source on a CDN.
- **Cause:** their `embed.html` is a server template; the `{alias}/` folder is uploaded wholesale.
- **Fix:** `zipDir`'s `extra` puts the page at the archive root, outside `{alias}/`. Never invent
  a page of our own either: the partner already has one.
- **Guard:** none; see [delivery-builds](../../design/delivery-builds.md).
- **PR:** not recorded (2026-09-24) · source: `docs/status/engine.md`

### Every win showed in the HUD but none was credited
- **Symptom:** on the partner node rounds stayed open and wins went uncredited, HUD unchanged.
- **Cause:** our mocks auto-collect, so `requestEndRound` answered from a stash first and its
  `collect` branch was unreachable; the partner credits only on an explicit `collect`.
- **Fix:** an open round is closed first and the `collect`'s balance is final.
- **Guard:** `AUTO_COLLECT=0` on the book mock; `check:resume`, `check:connection`.
- **PR:** not recorded (2026-09-17) · source: `docs/status/engine-history.md`

### A JSON content type was refused at the CORS preflight
- **Symptom:** the 2-complex node refused our POST before it was sent.
- **Cause:** it answers no preflight: their client never sets a `Content-Type`, so every request
  is a CORS simple request (`text/plain`).
- **Fix:** `rgs.simpleRequest` on the delivery profile sends `text/plain;charset=UTF-8`.
- **Guard:** none. Probe EAGaming hosts from a browser tab: Cloudflare bounces Node and curl.
- **PR:** not recorded (2026-09-17) · source: `docs/reference/play4fun-protocol.md`

### seq counted requests, which silently replays a round
- **Symptom:** none locally; against the real server `collect` would re-run the previous step.
- **Cause:** `seq` is the position in the round's stored action array: `[bet, play]` advances it
  by two. Writing to an occupied position is a replay. Our mock ignored `seq`.
- **Fix:** `sessionState.advance(storedActions)`; `config` and `[]` consume none.
- **Guard:** `seq.fixture.ts` (in `check:all`); both mocks now replay by position.
- **PR:** not recorded (2026-09-16) · source: `docs/status/engine-history.md`

### The count-up and the wallet disagreed on non-5-line games
- **Symptom:** a win counted up to 14× while the wallet credited 56×.
- **Cause:** `requestBet` hardcoded 5 lines; the server pays its own payline set. The mock's
  payout base also did not mirror the client's `payoutDivisor()` for ways and cluster.
- **Fix:** the bet declares the server's line count; `payoutBaseFor` beside the divisor.
- **Guard:** `pnpm check:stake` (real facade vs real mock: `finalWin ÷ 100 === payoutMultiplier`).
- **PR:** not recorded (2026-08-21) · source: `docs/status/engine-history.md`
  Also [scatter.md](../families/scatter.md#known-failure-modes).

### Translator code shipped without ever running
- **Symptom:** cascade translation was "prettier- and eslint-clean but never executed".
- **Cause:** `apps/lines` does not import the package's code paths, so no build compiled them.
- **Fix:** fixtures stand the REAL mock on a port and drive the REAL facade (`requestAuthenticate`
  → `requestBet`), e.g. `cascadeCollect.fixture.ts`.
- **Guard:** the `packages/rgs-translator-eagaming/*.fixture.ts` set, run by `check:rgs`.
- **PR:** not recorded (2026-08-20) · source: `docs/status/engine-history.md`

### A bought feature's win text read 100 times too small
- **Symptom:** "$0.03 shown, $200 paid" on a bought free-spin round. Money was right.
- **Cause:** the win denominator came from the debited total, which a buy inflates by its price;
  wins are priced on the base bet.
- **Fix:** the denominator is `betPerLine × paylines.length` (`engineFacade.ts`).
- **Guard:** none dedicated; `check:buy-cost` pins the debit, not the win text.
- **PR:** not recorded (2026-06-20) · source: `docs/history.md`

### A refused bet showed "Empty state in data.round"
- **Symptom:** a generic error modal mid-play, e.g. on a buy the balance could not cover.
- **Cause:** refusals arrive as HTTP 200 with `error` and no `events`; the facade read `.events`
  and built a SUCCESS round with an empty state.
- **Fix:** `isPlay4FunError` returns an error shape carrying the code and reason.
- **Guard:** none dedicated; never trust `res.ok` on this protocol.
- **PR:** not recorded (2026-06-19) · source: `docs/history.md`

### Two crossing paylines paid the same symbols twice
- **Symptom:** a low symbol "paying twice", a real over-credit.
- **Cause:** the mock is the live math; it emitted `lineCoinciding: false` and nothing read it.
- **Fix:** `LINE_COINCIDING` + `dedupeCoincidingWins` in both `scripts/mock-rgs-server*.mjs`.
- **Guard:** none dedicated; a config flag the code does not read is a bug.
- **PR:** not recorded (2026-06-19) · source: `docs/history.md`
