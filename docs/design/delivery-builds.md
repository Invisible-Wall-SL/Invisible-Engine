# Delivery builds — a game we hand over, hosted by someone else

> Status: [engine](../status/engine.md) · Related: [games-deploy](games-deploy.md) · [invisible-game-maker](invisible-game-maker.md)

## The problem

Every game we ship today is launched by a card **we** write (`publishGame.ts` / `defaultGameUrl`), so the
two facts a build cannot know about itself — which RGS it talks to, and the player's session — arrive
as query params (`rgs_url`, `sessionID`).

A **delivery build** is the same `build/` folder handed to a partner, a client, or a casino
aggregator, who serves it from **their** domain and launches it from **their** page. None of our
params are there. Before this work the result was not a visible failure:

- `rgsUrl()` fell back to `''`, so the game POSTed `/rgs/engine` at the *host's* own origin;
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
credentials (`rgs-translator-eagaming`), and `+layout.ts`, which awaits the load alongside the
runtime bundle so `Authenticate` sees the resolved profile on its first call.

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

## Phase 3 — packaging (AFTER)

`publish-game-bundle.mjs` grows a package-for-delivery mode: zip `build/` plus a short embed
contract, instead of uploading to our R2 and registering a card. Keep it a separate mode — the
existing `--protocol lines|book` flag only picks which MOCK the test server mounts, which is
meaningless for a partner delivery, and the two publish paths already guard against clobbering each
other's cards.

## Open questions for the partner

1. Which query param does their embed carry the session token in? (`session.param` in
   `profiles/2complex.json` is currently a **guess**.)
2. `Access-Control-Max-Age` — our JSON content-type preflights; uncached that is an extra round-trip
   per spin.
3. Their page's CSP `connect-src` must allow the RGS host. Fails silently, looks like a network error.
4. Bet units: is `context[1]` per-line or total, and in cents?
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
