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

Against the 2-complex node (`gs.2-complex.science`), which speaks the protocol we already implemented:

1. **Bet encoding.** `context[0]` is now a mode enum (`0` base · `1` ante · `2` buy), not a lines
   count. We send `[5, betPerLine]` (lines) or `[costMultiplier, betPerLine]` (book). Add
   `bet.encoding` + a bet-mode → enum map to the profile and wire it in `engineFacade.requestBet`.
2. **Server-supplied bet levels.** `requestAuthenticate` currently INVENTS the ladder ($0.10–$100)
   and `disabledBuyFeature: true`, because the mock never supplied them. For an operator build the
   limits must match what the RGS accepts, and jurisdiction flags are regulatory. Either the partner
   adds them to the `config` event or they go per-operator in the profile — but we stop guessing.
3. **Cascade vocabulary.** `tumbleStep`/`multiplierCollect` in the facade are OUR mock's invention,
   not a capture. Stargate is Gates-of-Olympus math, so the real names and shapes must replace them.

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

## Phase 3 — the embeddable build ✅ BUILT

`pnpm --filter lines build:embed` (`PUBLIC_DELIVERY_EMBED=1` + `scripts/build-embed.mjs`) produces
the folder the partner's page loads: `game.js` at its root, `_app/` and `assets/` beside it. Drop it
at `{cdn}/{brand}/games/{versionPath}/{gameAlias}/` and their two lines work as written. Without the
flag nothing changes — the default build is still the single droppable `index.html`.

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
- **`publish-game-bundle.mjs`** still has no package-for-delivery mode.

`publish-game-bundle.mjs` would then grow one: zip that folder plus a short embed
contract, instead of uploading to our R2 and registering a card. Keep it a separate mode — the
existing `--protocol lines|book` flag only picks which MOCK the test server mounts, which is
meaningless for a partner delivery, and the two publish paths already guard against clobbering each
other's cards.

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
5. Does the server emit a boot `config` event (symbols, window, `availablePayLines`, paytable)? The
   facade derives the symbol whitelist, grid and paylines from it.
6. Does the RGS bind a session to the operator it was minted for and validate that per call? A
   delivery build is public and copyable.

## Boundary

`rgs-requests` (the stock transport) does not read the profile for its endpoint or credentials —
those two are the Play4Fun facade's. Everything transport-independent (which RGS, which session
param, and the missing-token refusal) is resolved above it, in `stateUrlDerived` and
`<Authenticate>`, so a delivery cut without `PUBLIC_RGS_TRANSPORT=play4fun` still fails correctly
rather than confusingly.
