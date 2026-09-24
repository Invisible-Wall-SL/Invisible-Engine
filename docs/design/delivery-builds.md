# Delivery builds — a game we hand over, hosted by someone else

> Status: [engine](../status/engine.md) · Related: [games-deploy](games-deploy.md) · [invisible-game-maker](invisible-game-maker.md)

## The problem

Every game we ship today is launched by a card **we** write (`publishGame.ts` / `defaultGameUrl`), so the
two facts a build cannot know about itself — which RGS it talks to, and the player's session — arrive
as query params (`rgs_url`, `sessionID`).

A **delivery build** is the same `build/` folder handed to a partner, a client, or a casino
aggregator, who serves it from **their** domain and launches it from **their** page. None of our
params are there. Before this work the result was not a visible failure:

- `rgsUrl()` fell back to `''`, so the game POSTed `/rgs/engine` at the _host's_ own origin;
- `sessionID()` minted a throwaway `demo-<uuid>`.

The build booted, looked healthy, and played against nothing. Making that impossible is the point
of the profile.

## What is already right (verified, not assumed)

The build artifact itself needs no work:

- `bundleStrategy: 'inline'` (`packages/config-svelte`) inlines JS + CSS into `index.html`.
- Emitted paths are relative (`./favicon.svg`), and baked assets resolve page-relative (`'assets/'`,
  `apps/lines/src/editor-scenes.ts`), so a build survives being dropped in a subdirectory such as
  `https://somecasino.example/games/stargate/`.
- The baked path is the DEFAULT; `?runtime=1` is the opt-in that makes a game phone home to the
  launcher. **A delivery build must never carry it** — otherwise the game dies whenever our launcher
  does, and a project read token ships to a third party.

## The constraint that shapes everything: cross-origin, unbounded

The frontend is hosted by clients and aggregators; the RGS stays on the partner's servers. So the
call is **always** cross-origin, to a set of hosting domains that grows without us being told.

That kills both escapes. Same-origin (a relative RGS path) needs the RGS to serve the page. Proxying
through our own infra puts us in every operator's spin path.

What is left is CORS done properly, and the decisive field is `rgs.withCredentials`. The `sid` in the
query string **is** the credential; the captured `credentials: 'include'` was an artifact of the
protocol being sniffed from a same-origin iframe. Credentialed CORS forbids a wildcard
`Access-Control-Allow-Origin` and forces the server to echo each caller's exact origin — the one
thing that cannot scale here. Uncredentialed, the partner answers `*` once and every future host
works. This gives up nothing: CORS is not an auth boundary (a server-side caller ignores it), and
origin lockdown, if wanted, belongs in the RGS validating Origin against the operator the session was
minted for.

## Phase 1 — the profile + `config.json` ✅ BUILT

`packages/delivery-profile` — a dependency-free leaf (the `game-config` shape), resolved later-wins:

1. `DEFAULT_DELIVERY_PROFILE` — restates the pre-profile behaviour exactly, so a build that bakes
   nothing is unchanged.
2. The profile baked at build time: `PUBLIC_DELIVERY_PROFILE=<name|path.json>` →
   `packages/config-vite` injects the JSON as `__IE_DELIVERY_PROFILE__`. It lives in the SHARED vite
   config, not an app's, because a shipped game is its own repo with the engine as a submodule —
   anything an app opts into by hand is something a delivery can be cut without. A named-but-missing
   profile **throws**: silently shipping internal defaults would point a client's players at no RGS.
3. `config.json` next to `index.html`, fetched at boot, **only when a profile was baked** (so an
   internal build never eats a 404). Page-relative, `no-store`, 3s timeout, absent = normal. This is
   what lets an operator move staging↔production without us rebuilding — the same artifact goes to
   many hosts, so a rebuild per host is the thing to avoid.
   It may **repoint the build but not re-police it**: `rgs.baseUrl`, `rgs.endpoint`, `session.param`
   and `id` are overridable; `rgs.withCredentials`, `rgs.allowUrlOverride` and `session.required`
   are bake-only, because they decide whether a missing token is fatal and whether the host page can
   repoint the wallet. A staging↔production move needs none of the three.
   **It resolves page-relative, like the baked asset base (`'assets/'`).** So the embed contract is
   that the build is served as a directory (`…/stargate/`, trailing slash, or `…/stargate/index.html`)
   — served at `…/stargate` with no slash, `config.json` AND every asset resolve one level up.
4. URL params, only while `rgs.allowUrlOverride` — true internally (the test server depends on it),
   false for a delivery. The profile's answer stands even when it is EMPTY: falling through to
   `?rgs_url=` on an empty base would hand a same-origin delivery's wallet back to the host page.

Fields and why each exists are documented in `src/types.ts`. The merge is defensive by design:
`config.json` sits on someone else's server, edited by people who cannot rebuild the game, so a bad
field warns and keeps the baked value rather than throwing, and `baseUrl` is whitelist-validated
(it becomes the prefix of every wallet call).

**Consumers:** `stateUrlDerived.rgsUrl()`/`sessionID()` (`state-shared`), the transport's endpoint +
credentials (`rgs-translator-eagaming`), and `Authenticate.svelte`, which awaits the load at the top
of its `onMount` — the one place EVERY app reaches, since only `apps/lines` has a layout `load`.

**The hard-fail.** With `session.required`, a missing token makes `sessionID()` return `''` and
`Authenticate.svelte` throws before calling any transport — the shape it already catches and
`ModalError` already renders. It lives there, not in the RGS facade, because the facade is only one
transport and a delivery cut by hand need not have selected it. A mis-wired embed has to look
broken; a phantom wallet taking spins against a session the operator never issued is the worst
available outcome.

**A broken profile fails the BUILD.** `config-vite` shape-checks the baked JSON (unknown/typo'd
keys, wrong types, and the two fields a delivery cannot work without) and throws. That is the
opposite posture from the runtime merge, deliberately: nothing is running yet, and a profile that
merged down to internal defaults would ship a delivery pointing at no RGS at all.

## Phase 1b — one bundle, several RGSs (`?rgs_profile=`) ✅ BUILT

A DELIVERED build is pinned to one RGS on purpose. The shared `_runtime/*` bundle is the opposite
case: **one artifact that has to reach several** — our own test server while developing, a partner's
for real play — without a rebuild per target, because every online game runs that same bundle.

So a build can compile a **registry** of profiles and the launch URL picks one:

- `PUBLIC_DELIVERY_PROFILES` (comma-separated names, or `*` for every profile in
  `packages/delivery-profile/profiles/`) injects `__IE_DELIVERY_PROFILES__`. The runtime release
  sets `*`.
- `?rgs_profile=<id>` selects. **It is a whitelist** — the URL picks among hosts we shipped, it can
  never name one, which is what separates this from re-opening `?rgs_url=`.
- **`internal` is reserved** and always available: the built-in default, our RGS through
  `?rgs_url=`. It is the third option, named rather than implied, so a launch URL can ask for
  development mode explicitly on a bundle that also carries partner profiles.
- An id the build does not carry **refuses loudly** and falls back to ours. A silent fallback would
  be a game that looks fine while playing somewhere the launch never intended.
- A **baked** profile still wins outright: a `?rgs_profile=` on a delivery is refused and reported,
  because that build fixed its RGS deliberately and the host page does not get to move it.
- A selected profile does **not** read `config.json`: one file beside a shared bundle would silently
  repoint every game running it. Repointing a selected profile means shipping a profile and doing a
  runtime release — the reviewable path.

Precedence, highest first: baked → `?rgs_profile=` → default. Nothing selected is byte-identical to
before.

## Phase 2 — the protocol deltas (NEXT)

Against the 2-complex node (`gs.2-complex.science`), which speaks the protocol we already implemented.
**The full contract is now `docs/reference/play4fun-protocol.md`**, read off the partner's own
reference client rather than inferred — which settled two of these three and corrected the first.

1. ~~**Bet encoding.** `context[0]` is a mode enum (`0` base · `1` ante · `2` buy).~~ **WRONG, and
   the reference client says why it looked right.** `context[0]` depends on the game's bet-config
   TYPE: a `betOptions` game sends the **index into `betOptions`**, a line/way/dynaways game sends
   the **bet multiplier**. Game 2 declares `betOptions: [10, 1000]`, so its only two legal values are
   `0` and `1` — which reads exactly like "0 base, 1 ante" if you only ever see that game. It is not
   an enum, there is no third value, and a mode→enum map in the profile would have been a wrong
   abstraction built on a two-element coincidence. We already send the index (`betOptionIndexFor`),
   so the remaining work is only the line/way branch.
2. **Server-supplied bet levels.** `requestAuthenticate` currently INVENTS the ladder ($0.10–$100)
   and `disabledBuyFeature: true`, because the mock never supplied them. For an operator build the
   limits must match what the RGS accepts, and jurisdiction flags are regulatory. **Both halves of
   the answer now exist and neither is ours to invent:** the `config` event carries `betOptions` /
   `gameCost` / `oneCreditBuysLines` / `costPerReel`, and the host page carries `betMultipliers` +
   `initialBetMultiplierIndex` + `minNormalBet` / `maxNormalBet`. See the host-settings table above.
3. **Cascade vocabulary.** `tumbleStep`/`multiplierCollect` in the facade are OUR mock's invention,
   not a capture — and the reference client is the strongest evidence yet: it covers gamble, pickups,
   free rounds and fast play, and has **no cascade vocabulary at all**. Whatever Stargate's tumbles
   are called, it is not these. Replace them when we have a capture, not before.

## The embed — how the partner's page loads us (SETTLED 2026-09-17)

The partner hosts ONE HTML page per brand that serves every game built on the same client
technology. It is server-rendered; the `<?= ?>` parts are theirs and we never touch them. Our half
is two lines:

```html
<div id="game"></div>
<script src="<?=baseUrl?><?=gameAlias?>/game.js"></script>
```

- **`baseUrl`** is `cdnUrl + '/' + brand + '/games/' + versionPath + '/'`. `brand` groups games by
  client technology (`eanew` today; it will change, but stays fixed while we test) and `versionPath`
  is a per-game server-config string.
- **`gameAlias`** is the game's name with spaces removed — game 2's `"Book Of Bet Options"` →
  `BookOfBetOptions` — available server-side and mirrored on the CDN by convention.
- The CDN layout is **ours to choose**; `brand/games/version/gameAlias` is their convention and we
  follow it, because the page builds that URL and cannot be told otherwise per game.

Two consequences that are not preferences:

- **No iframe of our own.** Their page already sits inside iframes they do not control (casino
  operator, external app), so an iframe from us would nest inside those. We mount into their div.
- **Fixed filename, no content hash.** One page serves every game, so the filename must be identical
  across games; and `versionPath` is already the cache-buster, so a hash is not merely unnecessary —
  the server composes the URL and cannot know one.

## Host settings — what their page hands the client

`window.params.GameSettings` = `{ token, service, config: { … } }`. `token` is the session (which is
why `session.source: 'host'` exists), `service` the RGS endpoint, and `config` the brand's declared
settings. Each setting has a **scope**, and only `client` / `server|client` ones reach us —
`packages/delivery-profile/src/host.ts` reads them via `hostNumber` / `hostBoolean`.

The full `eanew` set as of 2026-09-17 (client-visible unless marked server-only):

| Group                 | Settings                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bet ladder**        | `betMultipliers` · `initialBetMultiplierIndex` · `betFactors` · `betPoints` · `minNormalBet` · `maxNormalBet` · `showBetRanges`                                                               |
| **Lines / cost**      | `oneCreditBuysLines` · `reelsCost` · `ignoreLines` _(server)_                                                                                                                                 |
| **Jurisdiction**      | `showTheoreticalPayback` · `showBuyBonusPayback` · `showHighChancePayback` · `showCreditValue` · `allowOutcomeBuy` · `deniedCountryCodes` · `allowedCountryCodes` · `certificator` _(server)_ |
| **Autoplay / turbo**  | `allowAutoplay` · `autoplayDisabled` · `autoplaySpins` · `enableTurbo` · `minSpinDuration` · `confirmGameRoundStart`                                                                          |
| **Money & locale**    | `currencyFormat` · `currencySymbol` · `locale` · `isLockChangeCurrency` · `balanceUpdateInterval`                                                                                             |
| **Chrome**            | `home` · `whiteLabel` · `brandName` · `errorPanel` · `clock` · `showTime` · `elapsedTime` · `scale` · `gameId`                                                                                |
| **History**           | `historyClient` · `externalHistoryUrl` · `showFreeRoundBet`                                                                                                                                   |
| **Jackpot**           | `jackpot` · `jpspin`                                                                                                                                                                          |
| **Build / injection** | `versionPath` · `certifiedVersionPaths` · `customJs` · `beforeGameEmbedHeadInclude` · `flash`                                                                                                 |
| **Math** _(server)_   | `usesMathPools` · `poolScriptHash` · `outcomes` · `script` · `rtp` · `supportsWinInjection`                                                                                                   |

**`betMultipliers` + `initialBetMultiplierIndex` are the `M` in `betOptions[x] × M`.** The host
supplies the multiplier ladder and the default selection, so the game does not have to invent one —
which is most of Phase 2 item 2 below, from the other direction: `betOptions` (server) gives the
credit cost per option, `betMultipliers` (host) gives the stake steps.

### The set is per-brand, and it is a REQUEST CHANNEL

This is not a fixed contract we discover and conform to. The schema is declared **per brand**, and
the partner extends it on request: we name a field, its type and its scope, they add it to the
brand, set it server-side, and it appears in `config` on the next `get_game`. Their words: _"you can
tell me add variable 'wtf' as a stringlist … and it will be part of server knowledge"_.

Brands differ because their games do — a `crash` brand carries `externalWsHost` (it needs a socket),
`mainBetMultiplierIndexes`, `maxMultiplier` and its own history model, and simply does not have most
of the slot chrome above. So OUR brand's set is ours to shape, and `eanew` is only where we start
because that is where game 2 lives.

`host.ts` is already built for this: it reads **by name** and returns null when a field is absent, so
honouring a new one is a one-line read that cannot break an operator who has not set it. Adding a
field is cheap on both sides; the expensive thing is inventing client behaviour for a value the
operator never declared, which is the mistake `betOptionsName` nearly walked us into.

### What we should ask for — and what we should honour first

Nothing is blocking: every field the client currently reads already exists in `eanew`. The gap runs
the other way — fields that are **already there** and which we still answer ourselves:

| Already declared, not yet honoured                                                                                  | What we do instead today               |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `betMultipliers` · `initialBetMultiplierIndex` · `minNormalBet` · `maxNormalBet`                                    | `requestAuthenticate` invents a ladder |
| `currencySymbol` · `currencyFormat` · `isLockChangeCurrency`                                                        | format money from our own config       |
| `locale`                                                                                                            | Lingui's own resolution                |
| `allowAutoplay` · `autoplayDisabled` · `autoplaySpins`                                                              | a coded autoplay menu                  |
| `minSpinDuration`                                                                                                   | coded spin timing                      |
| `home`                                                                                                              | no lobby/exit affordance               |
| `showCreditValue` · `showBetRanges` · `errorPanel` · `clock` · `elapsedTime` · `showTime` · `confirmGameRoundStart` | coded on/off                           |
| `historyClient` · `externalHistoryUrl`                                                                              | no history surface                     |

Each is an operator's declaration about a REGULATED or contractual surface, so each one we answer
ourselves is a place a delivery can be wrong for a jurisdiction. Work through them by how much they
cost to get wrong — the bet ladder first, then currency, then autoplay.

### A real delivery names no RGS host at all (`rgs.source: 'host'`) ✅ BUILT

**Confirmed 2026-09-17:** their embed reaches the RGS through `RequestController.getBaseUrl()` — a
relative path on the page's own origin, with `GameSettings.service` naming it. So a delivery's RGS
is **same-origin**, and the whole CORS apparatus is moot for exactly the case it was built for: no
preflight per spin, no `Access-Control-Allow-Origin` for an open-ended set of client and aggregator
domains, no `simpleRequest` content-type dodge, and no absolute host baked into an artifact several
operators receive. The RGS host stops being something the build knows and goes back to being
something the operator's own infrastructure decides — the only party that actually knows it.

We could not express that. `rgsUrl()` already returned an empty (same-origin) base for a pinned
profile, but `config-vite` **required a non-empty `rgs.baseUrl`**, so a same-origin delivery could
not be built; and `service` was read and then ignored, because the baked `rgs.endpoint` won.

`rgs.source` closes both:

| | `profile` (default) | `host` |
| --- | --- | --- |
| Origin | `rgs.baseUrl` | the page's own |
| Path | `rgs.endpoint` | `GameSettings.service`, falling back to `rgs.endpoint` |

It is **bake-only**, like `allowUrlOverride`: an operator's `config.json` may repoint a build between
their own hosts, but changing it from "the RGS we shipped you" to "whatever your page says" is a
different power. And it has to be an explicit declaration — an omitted or empty `baseUrl` on its own
still fails the build, because a delivery shipped pointing at no RGS at all is the accident that
check exists to stop.

`hostServicePath()` refuses anything carrying a scheme, a protocol-relative `//host`, or unsafe
characters. The page is the operator's, so this is not a trust boundary in the usual sense — but a
`service` that resolved off-origin would quietly turn "same-origin, no CORS" back into an absolute
URL nobody declared, which is the one thing this mode promises cannot happen.

`profiles/operator-embed.json` is the shape; `profiles/2complex.json` stays absolute because the test
node is reached cross-origin from our own machines. **Verified end-to-end**: built with the profile,
loaded through the embed harness, and the game posted to `{page origin}/webnode/engine?sid=…` with
the token from `GameSettings.token`.

### The build validator is now testable, which it never was

`deliveryProfileProblems()` moved to `packages/config-vite/deliveryProfile.js`, a dependency-free
leaf. In `index.js` it could not be driven by a fixture at all: that module's factory builds a real
vite config, so `sveltekit()` and `lingui()` run — and throw — before the check is reached, and a
fixture calling it reports whatever those plugins did instead. **That is the direct cause of the
`KNOWN` list drifting twice.** `profile.fixture.ts` now imports the list rather than scraping the
file for it (the scrape would have passed on a field mentioned in a comment), compares it **both
ways**, and asserts every shipped profile survives its own validator.
## Phase 3 — the embeddable build ✅ BUILT

### Producing one

From a GAME REPO — Book of Borut and anything else that vendors the engine at `engine/`:

```bash
node engine/scripts/build-delivery.mjs [--profile operator-embed] [--out delivery]
```

That runs the game's own `pnpm build` (editor bake, R2 asset pull, symbol publish — all unchanged)
with the three env vars a delivery needs, then writes `game.js`. `--out` copies the result somewhere
`pnpm build` will not overwrite, which matters for a folder you are about to hand over.

It lives in the ENGINE and takes no per-repo setup on purpose. `new-game.mjs` writes a repo's scripts
once at scaffold time and nothing refreshes them — the snapshot problem that had every scaffolded
game building a months-old `src/`. A delivery script added only to the scaffold would work for games
created after today and for none that exist. Scaffolded repos get `build:delivery` /
`serve:delivery` as thin aliases; older repos run the same script by path, with no package.json
change at all.

From the MONOREPO, for the reference game: `pnpm --filter lines build:embed`.

### Playing one before it ships

A delivery build **cannot be opened**. There is no `index.html`, and it reads its session and RGS
path from `window.params.GameSettings`, which only the partner's page provides — so it refuses to
boot anywhere else, correctly. Without a harness the only way to find out whether a delivery works is
to hand it over and wait.

```bash
node engine/scripts/serve-embed.mjs <build-dir> --sid <token> --rgs https://gs.2-complex.science
```

It plays both halves of an operator: a fake server-rendered page at `/operator/`, the game at a
CDN-shaped path that shares nothing with it, and a proxy that answers the game's same-origin RGS
calls by forwarding them to a real node. The two paths share nothing deliberately — a
document-relative URL, the failure this build mode exists to prevent, cannot pass by accident when
"relative to the page" and "relative to the bundle" resolve somewhere different. That is how both
non-script-relative asset paths were caught, and it is why any 404 it logs is worth reading.

### The artifact

`game.js` at the root, `_app/` and `assets/` beside it, plus two partner-facing files that are not
part of the runtime: `EMBED.md` (the contract) and `example.html` (a worked host page). Drop it at
`{cdn}/{brand}/games/{versionPath}/{gameAlias}/` and their two lines work as written. Without
`PUBLIC_DELIVERY_EMBED` nothing changes — the default build is still the single droppable
`index.html`.

**`example.html` is an example, not a page we serve** (added 2026-09-24, because the partner asked
for "the HTML" and prose alone had not answered it). It is generated from the baked profile like
`EMBED.md`, and it exists because three parts of the contract can each be got subtly wrong and only
discovered at runtime: `window.params` must be assigned **before** the script tag, the container
needs a **size** (an unstyled `<div>` is zero-high, so the game mounts and draws nothing, which
reads as a broken build), and the script must stay a classic `<script src>`.

It is deliberately **not** named `index.html` — that name is what a CDN hands out for the folder
itself, which is the exact hazard the SvelteKit shell is deleted to avoid. `example.html` is
reachable when you go looking for it and inert when you do not.

**The bet ladder is the one key we cannot supply.** `betMultipliers` is read *only* from the
operator's page (`betOptions.ts`) — nothing in the engine, in any game repo, or in the test server
declares one, so there is no "our real ladder" to put in the example and a list presented as one
would be a fabricated contract. What the example states instead is the identity that makes a ladder
checkable, `total stake = betOptions[x] × M`, plus a worked figure from the real Play4Fun capture:
with `betOptions: [10, 1000]` at denom `0.01`, `M = 4` is a `0.40` base spin and a `40.00` buy. The
shipped ladder opens on that rung, so the one number in the block that is real is the captured one,
and the surrounding list is labelled as the operator's to replace.

Its `config` block otherwise lists **only keys the engine actually reads** (`betMultipliers`,
`initialBetMultiplierIndex`, `enableTurbo`, `allowOutcomeBuy`, `showTheoreticalPayback`,
`balanceUpdateInterval`). An example is read as a contract, so a field in it that we ignore is a
promise we did not make — note that `serve-embed.mjs`'s fake operator page also sets
`allowAutoplay`, `currencySymbol` and `versionPath`, which **nothing reads**. Harmless in our own
harness, misleading in a partner's hands, so they are not copied. The generator's header names each
key's reader, because this list rots the moment someone adds a host-config consumer.

**Verified 2026-09-17** against a harness that serves the page at `/partner/` and the game at
`/cdn/eanew/games/v1.0/BookOfBetOptions/`, i.e. paths that share nothing, so a document-relative URL
cannot pass by accident: the game renders inside the operator's `<div id="game">` and every asset —
spines, atlases, bitmap fonts, the audiosprite, the KTX2 transcoder blob — resolves under the CDN
path. The only 404s left are the boot-splash index this game has never configured and the RGS the
harness does not run.

### What the measurement found

**Measured against a real `apps/lines` build, 2026-09-17** — because the premise was that
`bundleStrategy: 'inline'` had to be undone, and undoing it turned out to be most of the job:

- **The loadable bundle already exists.** The build emits `_app/immutable/bundle.<hash>.js`
  (3.0 MB, a **classic** script, not a module) _and_ a 3.0 MB `index.html` with that same bundle
  copied into it verbatim. Inlining does not replace the file, it duplicates it — so the artifact
  the partner needs is already being produced, just not used.
- **Asset URLs are already script-relative.** `apps/lines/src/game/assets.ts` writes
  `new URL('../../assets/…', import.meta.url)`, and for a classic script Vite compiles
  `import.meta.url` to `document.currentScript.src || document.baseURI`. Loaded via `<script src>`
  that resolves against the **CDN folder**, so moving the folder per `versionPath` works with no
  `base` config and no URL rewriting. Inlined, `currentScript.src` is empty and it falls back to
  `document.baseURI` — which is precisely why today's build only works when the HTML sits in the
  folder with the assets.
- `assets/` (59 MB in the reference game) is already a plain sibling folder fetched at runtime.
- **What the HTML shell still owns**, and a bundle would have to carry: the two stylesheets (16 KB,
  inlined today), the Typekit `<link>`, the boot splash + `window.__ieBoot`, and SvelteKit's
  `start()` call with its config object.

### Two things that were NOT script-relative

Everything that goes through the asset table resolved correctly the moment the bundle stopped being
inlined. Two paths did not, because they are built as STRINGS rather than from `import.meta.url`,
and both were invisible until the document stopped being ours:

- **`srcBase()`** (the boot splash index and a project's own exported sound banks) returned the
  page-relative `'assets/'`. It now resolves against the bundle — see `gameAssetsBase()` in
  `apps/lines/src/game/assets.ts`, which anchors on an emitted file rather than a bare directory
  because only a path Vite can resolve to an asset is rewritten at build time.
- **The audiosprite's own `src` list.** `sounds.json` names its media from the deploy root
  (`./assets/audio/sounds.ogg`) and howler resolves that against the DOCUMENT, so a delivery would
  have run silently. `assetLoad.ts` re-anchors each entry beside the sprite JSON it came from,
  taking the filename only — which also means a game repo carrying its own older `sounds.json`
  needs no change.

Both fixes are no-ops for every build we host, where the document and the bundle share a folder;
verified by building the default way and getting the identical 404 set.

### Still open

- **The boot splash** (`window.__ieBoot`, the overlay markup) lives in `app.html`, which a delivery
  never serves. Every call site is optional-chained, so an embed simply has no pre-Pixi splash — the
  operator's page covers that stretch and the in-canvas `LoadingBar` takes over. Worth revisiting
  only if a partner asks.
- **`config.json` is aimed at the wrong folder for an embed** (measured 2026-09-18 against a real
  delivery: the boot requested `/operator/config.json`). It resolves page-relative — correct when the
  page was ours and sat in the folder with the assets, but a delivery has no page of ours, so the
  operator would have to put the file beside the page that serves EVERY game. One file would repoint
  all of them, which is the exact hazard `?rgs_profile=` refuses `config.json` for. Harmless today
  (absent = normal, one 404 per boot) and the staging↔production story it exists for is not one a
  partner has asked for yet. If it is ever wanted for a delivery it should resolve beside `game.js`,
  like the assets do — which is a change to what an operator may repoint, so it needs deciding rather
  than patching.

## Phase 4 — the handover ✅ BUILT

The plan was for `publish-game-bundle.mjs` to grow a package-for-delivery mode. It did not, and the
reason is worth keeping: that script exists to upload to OUR R2 and register a card, and a delivery
does neither. Everything a package step needs — which profile was baked, what the alias is, where the
folder ended up — is already in `build-delivery.mjs`, so the mode went there and the publish path was
left alone.

`build-delivery.mjs` now finishes the handover rather than stopping at a folder:

- **`EMBED.md`**, written beside `game.js` and generated FROM THE BAKED PROFILE, so it cannot
  describe a build we did not make: where the folder goes, the two lines for their page, the two
  values that cannot vary per game (`id="game"`, `game.js`) and why, what `window.params` must carry,
  and whether the RGS is same-origin or cross-origin with the CORS that implies.
- **`--zip`**, rooted at the `gameAlias` so an unzip lands in the shape their CDN expects. Written by
  hand on `node:zlib` (`scripts/zip-dir.mjs`) — this script runs from a game repo's engine submodule
  and takes no per-repo setup, and a game repo installs from its own lockfile, so a dependency would
  be present or absent depending on which repo you were standing in.
- **`--alias`**, because the alias is the partner's and a wrong one is a 404 on their CDN. Derived
  from the repo name when omitted, and the guess is stated rather than assumed.
- **`--list-profiles` / `--print-env` / `--json` / `--skip-build`** — the seams a UI needs.

### The button

The desktop launcher's **📦 Deliver** (a separate repo, `Invisible-Wall-SL/invisible-launcher`) is
what makes a delivery something other than a thing you type. It is not a publish: nothing is
uploaded, no card is registered, the test server is never told.

It **cannot** run `build-delivery.mjs` in one shot, and the reason generalises to any GUI caller:
`vite build` regularly finishes writing its output and then never exits — an open sass-embedded or
esbuild handle keeps Node alive — which `spawnSync` cannot escape. The launcher already solves that
by watching the output and killing the settled tree, so it runs the build itself with `--print-env`'s
variables and calls back with `--skip-build` to package. That is what those two flags are for; a
one-shot terminal run is unchanged.

Nothing about a delivery is restated in the launcher: the env comes from `--print-env`, the profile
picker from `--list-profiles`, the paths from `--json`. The one thing it knows better is the alias —
the partner composes the CDN folder from the display name with spaces removed, and the launcher has
that name, so it prefills it instead of letting the engine re-capitalise a slug.

The result dialog offers **▶ Play it**, which is `serve-embed.mjs` with a session token and an RGS
origin. That pairing is the point: producing a delivery and playing one were two commands, and the
second is the one people skip.

## Open questions for the partner

1. ~~Which query param does their embed carry the session token in?~~ **ANSWERED** — not a query
   param at all: their page puts it on `window.params.GameSettings.token`, which is what
   `session.source: 'host'` reads. `session.param` stays as the fallback for a plain launch URL.
2. `Access-Control-Max-Age` — our JSON content-type preflights; uncached that is an extra round-trip
   per spin.
3. Their page's CSP `connect-src` must allow the RGS host. Fails silently, looks like a network error.
4. ~~Bet units: is `context[1]` per-line or total, and in cents?~~ **ANSWERED** — total stake is
   `betOptions[x] × M` in credits, `denom` 0.01, so 1 credit = 1 cent. The `M` ladder is the host's
   `betMultipliers`.
5. ~~Does the server emit a boot `config` event (symbols, window, `availablePayLines`, paytable)?~~
   **ANSWERED** — yes, and a missing one is fatal in their own client. Full field list in
   `docs/reference/play4fun-protocol.md`.
6. Does the RGS bind a session to the operator it was minted for and validate that per call? A
   delivery build is public and copyable.

## Boundary

`rgs-requests` (the stock transport) does not read the profile for its endpoint or credentials —
those two are the Play4Fun facade's. Everything transport-independent (which RGS, which session
param, and the missing-token refusal) is resolved above it, in `stateUrlDerived` and
`<Authenticate>`, so a delivery cut without `PUBLIC_RGS_TRANSPORT=play4fun` still fails correctly
rather than confusingly.
