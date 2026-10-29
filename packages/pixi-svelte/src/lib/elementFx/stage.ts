/**
 * POST FX: Element FX on the whole stage (Invisible Shader Graph step 8e,
 * `docs/design/shader-graph-screens.md` §6.5 and §10). `playElementFx` on its host's `stage` runs in
 * STAGE MODE: pixel passes only, over the viewport.
 * - No motion is folded: the stage's transform belongs to the camera effects.
 * - Nothing is measured: the box is the viewport, so the whole game is never walked for its bounds.
 * - Its filters never go onto `stage.filters`: they are handed to the stage's POST FX SLOT, which
 *   whoever owns the stage's filters binds ({@link bindStagePostFxSlot}). The stage's own filters,
 *   filter area and transform are never touched.
 * - Exit, enter, motion-only and break kinds are refused, with the reason ({@link stageFxRefusal}),
 *   and so is an entry past {@link STAGE_FX_LIMITS}.
 *
 * `?fxdebug=1` on the page logs each post FX as it starts, is refused and ends, with its load (the
 * viewport's device pixels × its graph's cost, when the effect carries it), and, while any plays,
 * the frame times every {@link FRAME_REPORT_MS}.
 */

import {
	STAGE_FX_LIMITS,
	customElementFx,
	findElementFxSpec,
	type ElementFxKindId,
} from 'constants-shared/elementFx';
import { Rectangle, type Application, type Container, type Filter } from 'pixi.js';
import { stagePostFxSlot, type StagePostFxSlot } from '../screenFx/stageFilters';
import { kindImpl, passesOf } from './custom';

export type { StagePostFxSlot };

const slots = new WeakMap<Container, StagePostFxSlot>();
const playing = new WeakMap<Container, readonly Filter[]>();

/**
 * Send `stage`'s post FX to `slot`: called at once with what plays now (`null`: nothing), then on
 * every change. One slot per stage; binding again replaces it. Returns the unbind, after which the
 * slot hears nothing more (it clears its own filters).
 */
export function bindStagePostFxSlot(stage: Container, slot: StagePostFxSlot): () => void {
	slots.set(stage, slot);
	slot(playing.get(stage) ?? null);
	return () => {
		if (slots.get(stage) === slot) slots.delete(stage);
	};
}

/**
 * Play `app`'s post FX in its stage filter owner's post FX slot (`screenFx/stageFilters.ts`): after a
 * transition, before the camera, over the viewport. Returns the unbind, which empties the slot
 * while this bind is still the stage's, so a game torn down before its post FX stop leaves no filter
 * on the stage and a newer bind keeps its own.
 */
export function bindStagePostFx(app: Application): () => void {
	const slot = stagePostFxSlot(app);
	const unbind = bindStagePostFxSlot(app.stage, slot);
	return () => {
		const current = slots.get(app.stage) === slot;
		unbind();
		if (current) slot(null);
	};
}

/** The post FX filters playing on `stage` now, or `null`. */
export const stagePostFx = (stage: Container): readonly Filter[] | null =>
	playing.get(stage) ?? null;

/** The runtime's hand-off: the filters playing on `stage` now. */
export function publishStagePostFx(stage: Container, filters: readonly Filter[] | null): void {
	if (filters) playing.set(stage, filters);
	else playing.delete(stage);
	slots.get(stage)?.(filters);
}

/**
 * The padding a post FX stack has at least. Pixi pads a stack's input past the viewport, never
 * inside it, and an element pass reads 0 at its input's half-texel edge: unpadded, the viewport's
 * first column or row can read transparent and show the canvas's background.
 */
export const STAGE_FX_EDGE_PAD = 1;

/**
 * Why `kind` does not play on the stage, or `undefined` when it does (or is not known: an unknown
 * or unregistered kind plays nothing anywhere).
 */
export function stageFxRefusal(kind: ElementFxKindId): string | undefined {
	const spec = findElementFxSpec(kind);
	const impl = kindImpl(kind);
	if (!spec || !impl) return undefined;
	if (impl.breaks || impl.breakWindow) {
		return 'a break cuts its element up, and the stage is never cut';
	}
	if (spec.phase === 'exit') return 'an exit kind ends hidden, so it would hide the whole game';
	if (spec.phase === 'enter') return 'an enter kind starts hidden, so it would hide the whole game';
	if (!passesOf(impl).length) {
		return 'a motion-only kind moves its element, and the stage’s transform is the camera’s';
	}
	return undefined;
}

/** The filters `kind` draws on the stage, or `undefined` for a kind that cannot play now. */
export const stageFxFilterCount = (kind: ElementFxKindId): number | undefined => {
	const impl = kindImpl(kind);
	return impl ? passesOf(impl).length : undefined;
};

/**
 * What the stage knows of a kind, in the shape `engine-layout`'s `readPostFx` takes as its judge:
 * the game and the Scene Editor read a doc's post FX through this one, so the editor shows exactly
 * the entries the game plays.
 */
export const stageFxJudge = { refusal: stageFxRefusal, filters: stageFxFilterCount } as const;

/**
 * Why one more effect drawing `filters` does not fit beside `others` (each the filter count of an
 * effect already on the stage), or `undefined` when it does.
 */
export function stageFxCapRefusal(others: readonly number[], filters: number): string | undefined {
	if (others.length >= STAGE_FX_LIMITS.entries) {
		return `the stage plays at most ${STAGE_FX_LIMITS.entries} post FX at once`;
	}
	const drawn = others.reduce((sum, n) => sum + n, 0);
	if (drawn + filters > STAGE_FX_LIMITS.filters) {
		return `the stage draws at most ${STAGE_FX_LIMITS.filters} post FX filters (${drawn} drawing, this one ${filters})`;
	}
	return undefined;
}

const warned = new Set<string>();

/** Say once per kind and reason that `kind` was refused on the stage. */
export function warnStageFxRefused(kind: ElementFxKindId, reason: string): void {
	debugLine(`post fx ${kind} on the stage: refused (${reason})`);
	const key = `${kind}\u0000${reason}`;
	if (warned.has(key)) return;
	warned.add(key);
	console.warn(`Element FX: ${kind} does not play on the stage: ${reason}.`);
}

let debugging: boolean | undefined;
const debug = (): boolean =>
	(debugging ??=
		typeof location !== 'undefined' && new URLSearchParams(location.search).has('fxdebug'));

const debugLine = (text: string): void => {
	if (debug()) console.log(`[fxdebug] ${text}`);
};

const millions = (n: number): string => `${(n / 1e6).toFixed(2)} M`;

/**
 * A post FX's load on the stage, design §10: the viewport's device pixels × its graph's cost, when
 * the effect carries it (a compiled one made for its use), else the pixels alone.
 */
export function stageFxLoadText(
	kind: ElementFxKindId,
	viewport: Rectangle,
	resolution: number,
): string {
	const px = viewport.width * viewport.height * resolution * resolution;
	const cost = customElementFx(kind)?.cost;
	return cost === undefined
		? `${millions(px)} px × cost not compiled in`
		: `${millions(px)} px × cost ${cost} = ${millions(px * cost)}`;
}

/** Log a post FX starting or ending, with what the stage plays after it. */
export function debugStageFx(
	kind: ElementFxKindId,
	state: 'on' | 'off',
	counts: { entries: number; filters: number },
	load: () => string,
): void {
	if (!debug()) return;
	const caps = `${counts.entries}/${STAGE_FX_LIMITS.entries} entries, ${counts.filters}/${STAGE_FX_LIMITS.filters} filters`;
	debugLine(
		`post fx ${kind} on the stage: ${state} (${caps})${state === 'on' ? `; ${load()}` : ''}`,
	);
}

/** How often the frame times are printed while post FX play. */
const FRAME_REPORT_MS = 10_000;

const nth = (sorted: readonly number[], q: number): number =>
	sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/**
 * A frame clock for the stage's runtime under `?fxdebug=1`: fed each frame's real length, it prints
 * the median and 95th percentile every {@link FRAME_REPORT_MS}. `undefined` without the flag.
 */
export function stageFrameClock(): ((deltaMs: number) => void) | undefined {
	if (!debug()) return undefined;
	let frames: number[] = [];
	let spent = 0;
	return (deltaMs) => {
		frames.push(deltaMs);
		spent += deltaMs;
		if (spent < FRAME_REPORT_MS) return;
		const sorted = frames.sort((a, b) => a - b);
		debugLine(
			`post fx: frame p50 / p95 over the last ${Math.round(spent / 1000)} s ${nth(sorted, 0.5).toFixed(1)} / ${nth(sorted, 0.95).toFixed(1)} ms`,
		);
		frames = [];
		spent = 0;
	};
}

/** The viewport of `screen` at (0, 0), into `out` (a fresh one when its size changed). */
export const viewportOf = (screen: Rectangle, out: Rectangle | undefined): Rectangle =>
	out && out.width === screen.width && out.height === screen.height
		? out
		: new Rectangle(0, 0, screen.width, screen.height);
