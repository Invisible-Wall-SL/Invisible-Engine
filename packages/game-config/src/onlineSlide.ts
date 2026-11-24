/**
 * THE SLIDE of an online arcade game's players against its solids (`arcade.online.slide`;
 * `engine-mechanics` `motion.js` `stepSlide`, the same step on the room and on a predicting
 * device). `corner`, field px: a player stopped by a solid that ends within this distance of it is
 * carried round that end at the speed of the move that was stopped, so it follows a bank drawn as a
 * stair of zones and rounds a prop's corner; a solid that goes on further stops it as before.
 * Absent ⇒ no slide, as every online game played before the setting.
 *
 * The shared normalizer drops the block (it ships in every runtime, and only an online arcade game
 * reads this): everything here reads the RAW doc as it is stored, as `touchScheme.ts` does, and
 * {@link withOnlineSlide} puts it on the game a room and a device play.
 */

import { onlineGameOf, type OnlineGame } from './arcadeOnline';
import { normalizeGameConfigDoc } from './normalize';
import { isObject, num } from './normalizeParts';
import type { GameConfigIssue } from './validate';

export type ArcadeOnlineSlide = { corner: number };

/** The bounds a room holds a slide to, whatever its config says. */
export const ARCADE_SLIDE_LIMITS = Object.freeze({ corner: { min: 1, max: 512 } });

/** `arcade.online.slide` of a RAW config as it is stored (any corner above 0), or `undefined`. */
export function slideOf(rawDoc: unknown): ArcadeOnlineSlide | undefined {
	const arcade = isObject(rawDoc) ? rawDoc.arcade : undefined;
	const online = isObject(arcade) ? arcade.online : undefined;
	const slide = isObject(online) ? online.slide : undefined;
	const corner = isObject(slide) ? num(slide.corner) : undefined;
	return corner !== undefined && corner > 0 ? { corner } : undefined;
}

/** The slide a room plays: {@link slideOf}, its corner held to {@link ARCADE_SLIDE_LIMITS}. */
export function resolveSlide(rawDoc: unknown): ArcadeOnlineSlide | undefined {
	const slide = slideOf(rawDoc);
	if (!slide) return undefined;
	const { min, max } = ARCADE_SLIDE_LIMITS.corner;
	return { corner: Math.min(max, Math.max(min, slide.corner)) };
}

/** A warning for a stored corner a room would not play as written. */
export function validateSlide(rawDoc: unknown): GameConfigIssue[] {
	const slide = slideOf(rawDoc);
	const { min, max } = ARCADE_SLIDE_LIMITS.corner;
	if (!slide || (slide.corner >= min && slide.corner <= max)) return [];
	return [
		{
			severity: 'warning',
			path: 'arcade.online.slide.corner',
			message: `Players slide round a corner within ${slide.corner} px; a room holds it to ${min}–${max}.`,
		},
	];
}

/**
 * `game` (an `onlineGameOf` answer, made from the normalized doc) with the slide of the RAW doc it
 * came from on `online.slide`. A game that is not online, or was refused, is returned as it is.
 * Every place that makes a room's or a device's game from a config goes through this, or the two
 * step differently.
 */
export function withOnlineSlide<G extends object | undefined>(game: G, rawDoc: unknown): G {
	const slide = resolveSlide(rawDoc);
	if (!slide || !game || !('online' in game) || !isObject(game.online)) return game;
	return { ...game, online: { ...game.online, slide } };
}

/**
 * The launcher's and the export's carry: the NORMALIZED config `doc` with the slide of `rawDoc` put
 * back on its `arcade.online`. `doc` itself when `rawDoc` has none or `doc` is not an online game.
 */
export function withSlide<T>(doc: T, rawDoc: unknown): T {
	const slide = slideOf(rawDoc);
	const arcade = isObject(doc) ? doc.arcade : undefined;
	const online = isObject(arcade) ? arcade.online : undefined;
	if (!slide || !isObject(arcade) || !isObject(online)) return doc;
	return { ...doc, arcade: { ...arcade, online: { ...online, slide } } };
}

/**
 * The online game a RAW config plays, as a room and a device make it: `onlineGameOf` of the
 * normalized doc, with its slide ({@link withOnlineSlide}). What a harness that plays "the game as
 * it ships" asks, rather than `onlineGameOf(normalizeGameConfigDoc(raw))`, which has no slide.
 */
export function playedOnlineGame(
	rawDoc: unknown,
	options: { size?: number } = {},
): OnlineGame | { refused: string } | undefined {
	return withOnlineSlide(onlineGameOf(normalizeGameConfigDoc(rawDoc) ?? null, options), rawDoc);
}
