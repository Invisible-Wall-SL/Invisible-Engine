import { Text } from 'pixi.js';

import type { IsoProjector } from '../projection';
import { SALMONS_FIELD_LAYER } from '../referenceLayouts/salmonsRiver';
import { spawnLayerOf } from './river';
import { K } from './scale';
import { PIXEL_FONT } from './winAnimation';

/**
 * THE TEXTS THAT RISE OVER SALMONS' PLAYERS (the catcher's "you catch NAME!"), as the old client
 * drew them (`game.js` `player_caught`): 11 px, yellow with a black rim, rising 50 px over 1.8 s
 * from 30 px over the character's middle, fading over its last 30 %. They stand in the players'
 * spawn layer, over every player, each at the place its player is drawn: the same whether a clip,
 * a code look or the placeholder draws that player.
 */
const FLOAT = { ms: 1800, rise: 50, above: 30, fadeFrom: 0.7, fontSize: 11, fill: 0xffdd57 };

/** Where a player is drawn: its place (world px) and how far above it its middle is (screen px). */
export type FloatAt = { x: number; y: number; middle: number };

export type Floats = {
	/** Raise `text` over player `id`. */
	add: (id: string, text: string, atMs: number) => void;
	/** This frame: each text over where its player is drawn now; one whose player is not goes. */
	frame: (nowMs: number, at: (id: string) => FloatAt | undefined) => void;
	/** The texts standing in the layer now, by player (the probe's). */
	drawn: () => Record<string, string[]>;
	destroy: () => void;
};

export function createFloats(projector: () => IsoProjector): Floats {
	const texts: { id: string; text: Text; atMs: number }[] = [];
	return {
		add: (id, value, atMs) => {
			const text = new Text({
				text: value,
				style: {
					fontFamily: PIXEL_FONT,
					fontSize: FLOAT.fontSize * K,
					fill: FLOAT.fill,
					stroke: { color: 0x000000, width: 3 },
					align: 'center',
				},
			});
			text.anchor.set(0.5, 1);
			text.zIndex = Number.MAX_SAFE_INTEGER;
			texts.push({ id, text, atMs });
		},
		frame: (nowMs, at) => {
			if (!texts.length) return;
			const layer = spawnLayerOf(SALMONS_FIELD_LAYER);
			for (let i = texts.length - 1; i >= 0; i--) {
				const { id, text, atMs } = texts[i];
				const t = (nowMs - atMs) / FLOAT.ms;
				// A text the layer took with it when it went is already destroyed.
				const place = layer && !text.destroyed && t < 1 ? at(id) : undefined;
				if (!layer || !place) {
					if (!text.destroyed) text.destroy();
					texts.splice(i, 1);
					continue;
				}
				if (text.parent !== layer) layer.addChild(text);
				const on = projector().project(place.x, place.y);
				text.position.set(
					on.x,
					on.y - place.middle - (FLOAT.above + Math.max(0, t) * FLOAT.rise) * K,
				);
				text.alpha = t < FLOAT.fadeFrom ? 1 : 1 - (t - FLOAT.fadeFrom) / (1 - FLOAT.fadeFrom);
			}
		},
		drawn: () => {
			const by: Record<string, string[]> = {};
			for (const { id, text } of texts) if (text.parent) (by[id] ??= []).push(text.text);
			return by;
		},
		destroy: () => {
			for (const { text } of texts) if (!text.destroyed) text.destroy();
			texts.length = 0;
		},
	};
}
