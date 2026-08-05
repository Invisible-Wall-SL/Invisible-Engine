import type { Scene } from './types';

/**
 * The engine-default Select-Feature (buy-bonus) SELECT scene — the in-canvas twin of the
 * retired HTML `ModalBuyBonus`. A `canvas`-space takeover: a dimmed backdrop rect behind a
 * `repeater` that renders one `featureCard` per non-default bet mode (fed by the `featureCards`
 * source `registerBuyFeature` installs). Both nodes are window-anchored (`screenAnchor {0.5,0.5}`)
 * so the menu covers the real viewport regardless of the design box. The `<BuyFeatureScreen>`
 * takeover falls back to THIS scene when a game passes no authored scene, and every reference
 * layout seeds a copy of it so a fresh editor project of any game type ships an authorable page.
 *
 * The card size is `FEATURE_CARD_WIDTH`×`HEIGHT` (280×380); the repeater carries anchor `{0.5,0.5}`
 * so the engine centres the WHOLE laid-out card group on the node position (no manual half-card
 * offset) — an author repositions/styles the cards + backdrop here.
 */
export function defaultBuyFeatureScene(): Scene {
	return {
		id: 'buyFeature',
		name: 'Select Feature',
		space: 'canvas',
		nodes: [
			{
				id: 'buy-feature-dim',
				label: 'Backdrop',
				kind: 'rect',
				screenAnchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 0,
				// Oversized so it covers any viewport; the default {0.5,0.5} rect anchor keeps
				// it centred on the window via `screenAnchor`.
				width: 4000,
				height: 4000,
				color: 0x000000,
				alpha: 0.7,
			},
			{
				id: 'buy-feature-cards',
				label: 'Feature cards',
				kind: 'repeater',
				screenAnchor: { x: 0.5, y: 0.5 },
				anchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 0,
				source: 'featureCards',
				componentId: 'featureCard',
				layout: { direction: 'row', gap: 24 },
			},
		],
	};
}
