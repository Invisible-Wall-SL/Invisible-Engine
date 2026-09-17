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

### Their resilience model, which we do not have

Worth knowing before judging our own behaviour on a flaky connection:

- A network error or an **empty response body** triggers a resend, every 1s, effectively forever
  (`MAX_RESEND_HTTP_REQUEST = Number.MAX_SAFE_INTEGER`). Request timeout is 30s.
- While reconnecting, a global gate holds every other request until the first one succeeds, so a
  retry storm cannot reorder actions — which matters a great deal when `seq` is a position.
- Reconnect start/success/failure are published as events, so the UI can say so.

### `seq` is a position, and this is now confirmed

Their client:

1. builds the URL from the CURRENT counter, then
2. advances it by the NUMBER OF STORED ACTIONS just posted — `config` excluded.

So a request carrying `[bet, play]` advances by **two**, and the next action belongs at `seq+2`. This
is exactly `takeSeq(storedActions)` in `sessionState.ts`; the earlier "one per request" version would
have written to an occupied position, which is how the server exposes **replay** — silently showing
an earlier spin again instead of advancing.

Their free-rounds path passes an explicit URL (bypassing the automatic advance) and so does
`self.sequence += 2` **by hand**, which is the same fact stated twice.

Two details their code confirms that we already had right: the balance probe (`[]`) and `config`
consume no position. Their filter for this is `data.action !== 'config' && data.action !== []` — the
second half is dead (`!==` against a fresh array literal is always true), but harmless, because the
balance probe posts an empty LIST whose length is zero anyway.

## Actions

| Action | Context | Notes |
| --- | --- | --- |
| `config` | — | Boot. Not stored, consumes no `seq`. |
| `bet` | `[x, betPoint]` | See **The first bet argument** below. |
| `play` | `null`, or an outcome string | Round stays open ⇒ needs a later `collect`. |
| `collect` | — | Closes the round. Needs `&gid=`. |
| `gamble` | `{type:'double_up', context:'game_round', choice}` | Double-up. **We do not implement this.** |
| `pickRandomly` | the pickup trigger data, with `item` chosen | Player picks a bonus. |
| `[]` (empty body) | — | Balance heartbeat. |

Their boot sequence is `config` → history request → connected, then a heartbeat loop at
`balanceUpdateInterval || 30000` ms — the same default `<Authenticate>` uses.

### The first bet argument

`context[0]` is NOT one thing. It depends on the game's bet-config type:

| Bet config | `context[0]` |
| --- | --- |
| `betOptions` | the **index** into `betOptions` |
| `line` / `way` / `dynaways` | the **bet multiplier** |

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

| Pass | Events |
| --- | --- |
| 1 | `bet` · `playedSpin` |
| 2 | `symbolSetInMatrix` · `spinWin` · `spinTrigger` · `bonusWin` · `enterBonus` · `playedBonusSpin` · `gameEnd` · `gameRoundOver` · `pickRandomly` · `chooseBonus` · `gamble` |

Against our facade's vocabulary:

- **We handle:** `bet`, `playedSpin`, `spinWin`, `spinTrigger`, `bonusWin`, `enterBonus`,
  `playedBonusSpin`, `gameEnd`, `gameRoundOver`, `pickRandomly`, `config`.
- **We do not:** `symbolSetInMatrix`, `chooseBonus`, `gamble`.
- **We carry two their client has never heard of:** `tumbleStep`, `multiplierCollect`. These are our
  MOCK's invention, already flagged in `docs/design/delivery-builds.md` — this drop is the strongest
  evidence yet that they are not real, since a client covering gamble and pickups covers no cascade
  vocabulary at all.
- `gameStart` / `spinStart` appear in our captures but their client ignores them.

## The boot `config` event

`config.context` — the answer to "does the server tell us the grid, paytable and paylines?", which
was an open question in the delivery plan. It does:

| Field | Meaning |
| --- | --- |
| `window` | `{reels, rows}` — the grid. |
| `availablePayLines` | Array of lines, each an array of row indices per reel. |
| `maxWays` | Ways count; falls back to `availablePayLines.length`. |
| `gameCost` | Base cost; falls back to `availablePayLines.length`. |
| `betOptions` | Credit cost per option — the bet menu. |
| `oneCreditBuysLines` | Lines one credit buys (their "cost per line"). |
| `costPerReel` | Per-reel cost, for buy-a-reel games. |
| `paytable` | `{symbol: [{on: {of, occurs}, pay: [...]}]}` — `occurs[i]` pays `pay[i]`. |
| `symbolsPay.scatter` | Which symbols are scatters. |

Alongside `context`, the `config` EVENT itself carries the resume contract:

| Field | Meaning |
| --- | --- |
| `actions` | The stored action array of an unfinished round. |
| `resume` | `true` ⇒ that round is still open; continue it. |
| `replay` | `true` ⇒ replay mode over those actions. |

A missing `config` event is **fatal** in their client (it throws). Ours should be at least as loud.

## Resume — what happens when a player comes back

This is the part of the protocol we have no answer for, and the one most likely to bite a delivery.

On boot, if `config.actions` is non-empty and `config.resume` (or `replay`) is set, their client:

1. reads the stored `bet` action to recover the stake — `context[0]` is the bet param, `context[1]`
   the bet point — so the UI comes back showing what the player actually staked;
2. takes `platform.gameRound.id` as the round to continue;
3. queues the actions, and from then on **every request prepends the pending stored actions** up to
   the one it wants (`getResumeActions('play')`, `getResumeActions('collect')`), shifting them off as
   they are sent.

So the server holds the round; the client replays its way back to the present and carries on.

**Why this matters more than it looks.** `seq` is a position. A client that boots fresh against a
server with an open round will post its first `bet` at a position the server already has filled —
which is not an error, it is the **replay** path. The player would watch an old spin and wonder
where their money went. Closing a tab mid-free-spins is not an exotic case on mobile, and a delivery
is all mobile.

We currently have neither the resume queue nor a check for `config.resume`. At minimum the facade
should notice an open round at boot and refuse to start a new one, rather than silently replaying.

## Where the host glue lives (and why we did not find it)

Neither `p4f-game-core` nor `p4f-slotty-core` reads `window.params` or `GameSettings` anywhere. The
cores take an already-built `serverConfig` (`gameAPI`, `urlHistory`, `outcomes`,
`balanceUpdateInterval`, …); assembling it from the embed page is each GAME PROJECT's own bootstrap,
which neither drop includes.

Nothing turns on it. We build the request URL from `GameSettings.service` + `.token` via
`host.ts`, where they consume the page's pre-assembled `params.GameAPI`; the two produce the same
request against the same origin.

## Things we have no equivalent for

Recorded because each is a real feature of the protocol, not because any is scheduled:

- **Resume** — see its own section above. The biggest gap.
- **The retry/reconnect model** — see "Their resilience model" above.
- **Gamble** (double-up on a finished round).
- **Free rounds** — a separate `freerounds` endpoint with `&action=choose&frid=&betid=`, plus
  `gameRound.freeRound.totalWin` on the platform object.
- **Fast play** — `batchengine` with `&num=N`, returning an aggregate `platform.batch`.
- **History** — its own request; their client fetches it during boot.
- **Forced outcomes** — `play.context` takes an outcome string, gated by the config's
  `allowForcing` / `allowOutcomeBuy`.
