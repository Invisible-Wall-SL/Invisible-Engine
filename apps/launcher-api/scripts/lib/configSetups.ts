/**
 * The Game Config setups a project can be in, as the stored config each leaves behind — shared by the
 * checks that pin a tool to `/config` for every kind and setup (`check-symbols-follow-config`,
 * `check-flow-symbols-follow-config`), so both walk the very same cases.
 */

import {
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_PRESETS,
	POTS_OVERLAY_PRESET_IDS,
	addHoldAndWinBonus,
	addPotsOverlay,
	importBonus,
	normalizeGameConfigDoc,
	primaryHoldAndWin,
	symbolsInPlay,
	symbolUses,
	type GameConfigDoc,
} from 'game-config';
import { gameConfigDefaultFor } from '../../src/lib/server/gameConfigDefaults.ts';

/** What a save then a load does to a config: the stored doc is always the normalized one. */
export const saved = (raw: unknown): GameConfigDoc => {
	const out = normalizeGameConfigDoc(structuredClone(raw));
	if (!out) throw new Error('a setup config did not normalize');
	return out;
};

/** `/config`'s badge click on an in-play symbol: every cell of it off every strip, never emptying a
 *  reel (`toggleInPlay`). */
export const takeOffReels = (doc: GameConfigDoc, name: string): GameConfigDoc => {
	const next = structuredClone(doc);
	for (const type of Object.keys(next.paddingReels)) {
		next.paddingReels[type] = next.paddingReels[type].map((reel) => {
			const kept = reel.filter((cell) => cell.name !== name);
			return kept.length ? kept : reel;
		});
	}
	return next;
};

/** …and on an unused one: one cell of it on every reel of every strip. */
export const putOnReels = (doc: GameConfigDoc, name: string): GameConfigDoc => {
	const next = structuredClone(doc);
	for (const strips of Object.values(next.paddingReels))
		for (const reel of strips) reel.push({ name });
	return next;
};

export const unusedOf = (doc: GameConfigDoc): string[] =>
	Object.entries(symbolUses(doc))
		.filter(([, use]) => use === 'unused')
		.map(([name]) => name);

export const templateOf = (kind: string): GameConfigDoc => {
	const template = gameConfigDefaultFor(kind);
	if (!template) throw new Error(`no committed template for ${kind}`);
	return template;
};

/** A stored `config.json` as `loadGameConfigDocWithEtag` reads it: `doc: null` when there is none,
 *  or it does not parse. */
export type Stored = { doc: GameConfigDoc | null; etag: string | null };

/** Every setup a project of `kind` can be in, as the stored config it leaves behind. */
export function setups(kind: string): Array<{ label: string; stored: Stored }> {
	const template = templateOf(kind);
	const savedAs = (doc: GameConfigDoc): Stored => ({ doc: saved(doc), etag: '"e"' });
	const out: Array<{ label: string; stored: Stored }> = [
		{ label: 'never saved', stored: { doc: null, etag: null } },
		{ label: 'an unreadable config.json', stored: { doc: null, etag: '"corrupt"' } },
		{ label: 'saved as the template', stored: savedAs(template) },
	];
	const inPlay = symbolsInPlay(template);
	out.push({
		label: `${inPlay[0]} taken off the reels`,
		stored: savedAs(takeOffReels(template, inPlay[0])),
	});
	for (const name of unusedOf(template)) {
		out.push({ label: `${name} put on the reels`, stored: savedAs(putOnReels(template, name)) });
	}
	const withExtra = structuredClone(template);
	withExtra.symbols.EXTRA = {};
	out.push({ label: 'a dictionary-only symbol', stored: savedAs(withExtra) });
	for (const id of POTS_OVERLAY_PRESET_IDS) {
		const result = addPotsOverlay(template, id);
		if (result.ok) out.push({ label: `pots overlay ${id}`, stored: savedAs(result.doc) });
	}
	for (const id of HOLD_AND_WIN_PRESET_IDS) {
		const result = addHoldAndWinBonus(template, id);
		if (result.ok) out.push({ label: `Hold and Win bonus ${id}`, stored: savedAs(result.doc) });
	}
	if (kind === 'holdAndWin') {
		for (const id of HOLD_AND_WIN_PRESET_IDS) {
			out.push({
				label: `Hold and Win preset ${id}`,
				stored: savedAs(saved(HOLD_AND_WIN_PRESETS[id])),
			});
		}
	}
	const host = addPotsOverlay(template, 'potsToFreeSpins');
	if (host.ok && !primaryHoldAndWin(host.doc)) {
		const imported = importBonus(host.doc, HOLD_AND_WIN_PRESETS.classic, {
			project: 'source',
			mode: 'holdAndWin',
			at: '2026-10-07T00:00:00.000Z',
		});
		if (imported.ok)
			out.push({ label: 'imported Hold and Win bonus', stored: savedAs(imported.doc) });
	}
	return out;
}
