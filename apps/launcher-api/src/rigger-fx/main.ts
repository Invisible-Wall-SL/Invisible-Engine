/**
 * Invisible Rigger — the LIVE FX overlay entry (a standalone, non-Svelte vendored bundle).
 *
 * The Rigger stage is raw `spine-webgl` on a hand-rolled WebGL context, NOT Pixi, so it can't host
 * the engine's Pixi particle stack directly. This module is the thin IIFE SHIM around the shared
 * overlay CORE (`$lib/fx/fxOverlay.client.ts`): it creates one overlay instance and exposes it as the
 * global `window.RiggerFx` the Rigger's `view.html` drives via a `<script>` tag (exactly like the
 * vendored `spine-webgl-*.js`). Built as an IIFE by `vite.rigger-fx.config.ts` (has no module system,
 * so nothing may stay external) and committed to `static/rigger/vendor/rigger-fx.js`.
 *
 * ALL the load-bearing logic — the transparent Pixi `Application`, the `engine-fx`
 * `normalizeEffectDoc`/`planLayer`/`bindArt` reduction, the two gotchas (never `Assets.load` the
 * query-string art URL; never JSON-clone a `bindArt` result), and the sprite-only Tier-A/B scope —
 * lives in the shared core so the Symbols State-Machine stage can reuse the SAME overlay verbatim.
 */

import { createFxOverlay, type FxOverlayApi } from '../lib/fx/fxOverlay.client';

/** Back-compat alias — `view.html` types the global against this name. */
export type RiggerFxApi = FxOverlayApi;

const api: FxOverlayApi = createFxOverlay();

declare global {
	interface Window {
		RiggerFx: FxOverlayApi;
	}
}

if (typeof window !== 'undefined') {
	window.RiggerFx = api;
}

export default api;
