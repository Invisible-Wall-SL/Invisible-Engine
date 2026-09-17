# The Play4Fun / HyperGaming RGS protocol

**What this is.** The wire contract our `rgs-translator-eagaming` package implements, read off the
partner's OWN reference client (`server-handler/hyper-gaming/`, shared 2026-09-17) rather than
inferred from traffic. Everything below is the CONTRACT — request shapes, action names, event names,
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

A missing `config` event is **fatal** in their client (it throws). Ours should be at least as loud.

## Things we have no equivalent for

Recorded because each is a real feature of the protocol, not because any is scheduled:

- **Resume.** Their client keeps a `resumeData` action list and, before every request, replays any
  stored actions the server still expects (`getResumeActions(untilAction)`). This is what makes a
  reconnect mid-round recover rather than desync — the other half of `seq`-as-position. We have
  nothing here, and a delivery on a flaky mobile connection is where it would show.
- **Gamble** (double-up on a finished round).
- **Free rounds** — a separate `freerounds` endpoint with `&action=choose&frid=&betid=`, plus
  `gameRound.freeRound.totalWin` on the platform object.
- **Fast play** — `batchengine` with `&num=N`, returning an aggregate `platform.batch`.
- **History** — its own request; their client fetches it during boot.
- **Forced outcomes** — `play.context` takes an outcome string, gated by the config's
  `allowForcing` / `allowOutcomeBuy`.
