# rgs-translator-eagaming

Plug-and-play translator between the **Invisible Engine** internal RGS request shape and the **Play4Fun `/rgs/engine`** batched-action protocol used by EAGaming-fronted casinos (and likely other Play4Fun-backed brands).

> **Naming note:** the package is currently named `rgs-translator-eagaming` because EAGaming was the discovery target. The actual protocol belongs to **Play4Fun** — the EAGaming brand wrapper proxies through to a Play4Fun RGS host (e.g. `www.best00qpin.com`). Will rename to `rgs-translator-play4fun` once we verify the same protocol on a second brand. Internal types/functions already use `Play4Fun*` names with `EAGaming*` aliases for back-compat.

## Why this exists

Invisible Engine games expect a particular RGS surface — a handful of single-purpose endpoints (`/wallet/play`, `/wallet/authenticate`, `/wallet/end-round`, …), each with its own request and response shape. The Play4Fun protocol is different: a single endpoint that takes a batched array of actions, with `seq` and `gid` query params managing a per-round state machine.

This package converts between the two so that:

- The existing Invisible Engine games (`apps/lines`, etc.) can run against a Play4Fun backend without modifying the game logic.
- Future translators for other operator protocols can follow the same pattern.

The original `rgs-fetcher` / `rgs-requests` path still works untouched — this is opt-in.

## Protocol summary

```
POST {origin}/rgs/engine?sid={sid}&seq={n}[&gid={gameRoundId}]
Body: [{action, context}, …]
```

### Actions

| Action       | Context             | Effect                                                       |
| ------------ | ------------------- | ------------------------------------------------------------ |
| `bet`        | `[a, betPerLine]`   | Debit. Total stake = `a * betPerLine`.                       |
| `play`       | `null`              | Spin. Round stays open; needs separate `collect`.            |
| `play`       | `''` (empty string) | Spin and auto-collect in one round-trip.                     |
| `collect`    | (omitted)           | Close an open round, credit win.                             |
| (empty `[]`) | —                   | Heartbeat. Server returns `{events:[], platform:{balance}}`. |

### Query parameters

- `sid` — session ID (typically from the launch URL)
- `seq` — the 0-based **position** in the round's stored action array at which the posted action(s) are placed, **not** a request counter: a request carrying `[bet, play]` advances it by **two**, so the next action belongs at `seq=2`. Omitting it appends. Writing to an already-occupied position is how the engine **replays** that step. `config` and the empty-body balance probe are not stored and consume no position
- `gid` — game round ID; only sent when continuing a round (e.g. `collect`). The server returns it in `platform.gameRound.id` after the opening `bet+play`

### Response shape

```ts
{
  events: [
    // already in Invisible Engine book-event format — pass-through
    { event: 'bet',           context: {...} },
    { event: 'gameStart',     context: {...} },
    { event: 'spinStart',     context: {...} },
    { event: 'spinWin',       context: {...} },  // 0..N occurrences
    { event: 'playedSpin',    context: [[...], [...], ...] },
    { event: 'gameEnd',       context: { win } },
    { event: 'gameRoundOver', context: { win } },  // only after collect or auto-collect
  ],
  platform: {
    balance: number,
    gameRound?: { updating: true, id: 'G...' }
  }
}
```

## Installation

It's a workspace package — already available to any app in the monorepo:

```jsonc
// apps/<your-app>/package.json
{
	"dependencies": {
		"rgs-translator-eagaming": "workspace:*",
	},
}
```

After editing `package.json`, run `pnpm install` from the repo root.

## API

### `createPlay4FunSessionState(sid)`

Owns the session's `seq` and `gid` lifecycle. Use one instance per session.

```ts
import { createPlay4FunSessionState } from 'rgs-translator-eagaming';

const session = createPlay4FunSessionState('S27932');
session.startRound(); // call before each new bet+play (the action array starts empty)
session.takeSeq(2); // position for a 2-action `bet+play` post; advances BY TWO
session.takeSeq(0); // a non-stored call (balance/config): reports, consumes nothing
session.bindRound('G123abc'); // record gid from server response
session.endRound(); // call after a successful collect
```

The fetcher (below) auto-binds gid from responses, so you usually only call `startRound()` and `endRound()` manually.

### `createPlay4FunFetcher(config, session)`

HTTP transport that builds the URL with `sid`/`seq`/`gid`, posts the body, parses JSON, and auto-binds the returned gid.

```ts
import { createPlay4FunFetcher, createPlay4FunSessionState } from 'rgs-translator-eagaming';

const session = createPlay4FunSessionState('S27932');
const fetcher = createPlay4FunFetcher(
	{ baseUrl: '', sid: session.sid }, // empty baseUrl = same-origin (recommended in-tab)
	session,
);

const result = await fetcher.post({
	body: [
		{ action: 'bet', context: [5, 2] },
		{ action: 'play', context: '' },
	],
});
// result.response is the parsed Play4FunResponse
// result.url, result.requestSeq, result.requestGid for debugging
```

### Action builders

```ts
import {
	buildBetActions,
	buildHeartbeat,
	buildCollectAction,
	buildSingleAction,
} from 'rgs-translator-eagaming';

buildBetActions({ amount: 10, mode: 'BASE', currency: 'USD', betLinesOrConfig: 5 });
// → [{action:'bet', context:[5, 2]}, {action:'play', context:''}]

buildHeartbeat();
// → []

buildCollectAction();
// → [{action:'collect'}]

buildSingleAction('myCustomAction', { foo: 1 });
// → [{action:'myCustomAction', context:{foo:1}}]
```

`buildBetActions` defaults to **auto-collect** (`play.context = ''`). Pass `playContext: null` to keep the round open and call `buildCollectAction()` separately.

### `translateBetResponse(raw, currency?)`

Reshapes a `Play4FunResponse` into the Invisible Engine `res_play` shape so the existing `utils-book` event pipeline can consume it unchanged.

```ts
import { translateBetResponse } from 'rgs-translator-eagaming';

const translated = translateBetResponse(result.response, 'USD');
// translated.status     -> { statusCode: 'SUCCESS' }
// translated.balance    -> { amount: 1290, currency: 'USD' }
// translated.round      -> { roundID, amount, payout, payoutMultiplier, active, state: events[] }
// translated._raw       -> the original Play4FunResponse, kept for debugging
```

The `state` field IS the events array — already in the right shape for Invisible Engine's book-event handlers.

## End-to-end usage

```ts
import {
	createPlay4FunFetcher,
	createPlay4FunSessionState,
	buildBetActions,
	buildCollectAction,
	translateBetResponse,
} from 'rgs-translator-eagaming';

const session = createPlay4FunSessionState(SID_FROM_URL);
const fetcher = createPlay4FunFetcher({ baseUrl: '', sid: session.sid }, session);

// Auto-collect round (one round-trip)
session.startRound();
const r = await fetcher.post({
	body: buildBetActions({ amount: 10, mode: 'BASE', currency: 'USD', betLinesOrConfig: 5 }),
});
const translated = translateBetResponse(r.response);
console.log('events:', translated.round.state);
console.log('balance:', translated.balance.amount);
session.endRound();

// Manual-collect round (two round-trips)
session.startRound();
const r1 = await fetcher.post({
	body: buildBetActions({
		amount: 10,
		mode: 'BASE',
		currency: 'USD',
		betLinesOrConfig: 5,
		playContext: null,
	}),
});
// inspect r1.response.events, decide to collect
const r2 = await fetcher.post({ body: buildCollectAction() });
session.endRound();
```

## Cloudflare and where this can run

The EAGaming edge sits behind Cloudflare's "managed challenge". This means:

- ❌ Server-side fetches (Node, curl, server-rendered SvelteKit) get bounced with a 403 + JS challenge page.
- ❌ Cross-origin browser fetches (Storybook on `localhost:6001`) hit CORS first, then CF.
- ✅ In-tab fetches from the live game origin work — the challenge is already solved for that tab.
- ✅ Same-origin from a deployment under the operator's domain works (you'd need to be hosted there).
- ✅ Local development against the [mock RGS server](../../scripts/mock-rgs-server.mjs) works freely.

For protocol research, use the [console snippets](../../scripts/) pasted into the live game iframe console.

## Testing

The mock server in [scripts/mock-rgs-server.mjs](../../scripts/mock-rgs-server.mjs) speaks the same protocol locally without auth or Cloudflare. Use it for translator development and integration tests.

```bash
node scripts/mock-rgs-server.mjs        # starts on :7777
node scripts/smoke-mock.mjs              # full round-lifecycle smoke test
```

## Discovery scripts

| Script                                                 | Purpose                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [console-sniffer.js](../../scripts/console-sniffer.js) | Monkey-patches `fetch` and `XMLHttpRequest` in the live game iframe; logs every request to `window.eaSniffed`. |
| [console-probe.js](../../scripts/console-probe.js)     | Paste-in probe runner; fires a sequence of test actions against the live endpoint.                             |
| [probe.mjs](../../scripts/probe.mjs)                   | Standalone Node probe (CF will block it for EAGaming-fronted hosts).                                           |
| [smoke-mock.mjs](../../scripts/smoke-mock.mjs)         | Round-lifecycle smoke test against the mock server.                                                            |

## Source files

| File                     | Purpose                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `src/types.ts`           | Wire-format types for requests, responses, events. Sample payloads at the bottom of the file. |
| `src/sessionState.ts`    | sid + seq + gid lifecycle.                                                                    |
| `src/translator.ts`      | Action builders + `translateBetResponse`.                                                     |
| `src/eagamingFetcher.ts` | HTTP transport (`createPlay4FunFetcher`). Auto-binds gid.                                     |

## License

MIT.
