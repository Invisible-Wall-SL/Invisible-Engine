import {
	STAGE_FX_LIMITS,
	customElementFx,
	readElementFxEntries,
	type ElementFxEntry,
	type ElementFxKindId,
} from 'constants-shared/elementFx';
import type { GameSettings } from 'engine-layout';
import { POST_COST_BUDGET, POST_SAMPLE_BUDGET } from 'engine-shadergraph';
import { stageFxCapRefusal, stageFxFilterCount, stageFxRefusal } from 'pixi-svelte/elementFx';

/**
 * Game Settings → Screen FX in the Scene Editor (Shader Graph 8e, `shader-graph-screens.md` §9.2):
 * what the post FX list offers, what each entry costs, and what the block writes into
 * `settings`. Every rule about the stage is the runtime's own (`pixi-svelte/elementFx`), so the
 * editor greys exactly what the game refuses.
 */

/** The reference phone the budget is set on (§10): 390 × 844 CSS px at DPR 2, in device pixels. */
export const REFERENCE_PHONE_PX = { width: 780, height: 1688 } as const;
const PHONE_PX = REFERENCE_PHONE_PX.width * REFERENCE_PHONE_PX.height;

/** The post FX budget on the reference phone: the graph cost a post FX may take × its pixels. */
export const POST_FX_LOAD_BUDGET = POST_COST_BUDGET * PHONE_PX;

export type PostFxLoad =
	| { kind: 'none'; px: number }
	| {
			kind: 'compiled';
			px: number;
			cost: number;
			samples: number | undefined;
			load: number;
			budget: number;
			over: boolean;
	  };

/**
 * What `kind` costs as a post FX on the reference phone: its compiled graph cost × the phone's
 * pixels, against {@link POST_FX_LOAD_BUDGET}. A kind whose effect carries no compiled cost (a
 * built-in, or a graph compiled without one) is `none`: nothing is guessed.
 */
export function postFxLoad(kind: ElementFxKindId): PostFxLoad {
	const effect = customElementFx(kind);
	if (effect?.cost === undefined) return { kind: 'none', px: PHONE_PX };
	const load = effect.cost * PHONE_PX;
	return {
		kind: 'compiled',
		px: PHONE_PX,
		cost: effect.cost,
		samples: effect.samples,
		load,
		budget: POST_FX_LOAD_BUDGET,
		over:
			effect.cost > POST_COST_BUDGET ||
			(effect.samples !== undefined && effect.samples > POST_SAMPLE_BUDGET),
	};
}

/** `1.32 M`: a pixel count or a load, in millions. */
export const millions = (n: number): string => `${(n / 1e6).toFixed(2)} M`;

/** The load line's words for `kind`. */
export function postFxLoadText(kind: ElementFxKindId): string {
	const load = postFxLoad(kind);
	if (load.kind === 'none') {
		return `No compiled cost for this kind, so no load is shown: it covers ${millions(load.px)} px on the reference phone.`;
	}
	const reads =
		load.samples === undefined ? '' : `; ${load.samples} reads a pixel of ${POST_SAMPLE_BUDGET}`;
	return `Load ${millions(load.px)} px × cost ${load.cost} = ${millions(load.load)} of ${millions(load.budget)} (the post FX budget, cost ${POST_COST_BUDGET}${reads}).`;
}

/** The filters each enabled entry but `skip` draws, for the stage's caps. */
const othersDrawing = (entries: readonly ElementFxEntry[], skip: number | undefined): number[] =>
	entries.flatMap((entry, i) =>
		i === skip || entry.disabled ? [] : [stageFxFilterCount(entry.kind) ?? 0],
	);

/**
 * Why `kind` cannot be picked for the post FX entry at `index` (`undefined`: a new entry), given
 * the list as it is, or `undefined` when it can: the stage's own refusal first, then its caps
 * (`STAGE_FX_LIMITS`) against every other enabled entry. The entry itself counts as enabled, so
 * turning it on later never passes a cap.
 */
export function postFxKindRefusal(
	entries: readonly ElementFxEntry[],
	kind: ElementFxKindId,
	index: number | undefined,
): string | undefined {
	return (
		stageFxRefusal(kind) ??
		stageFxCapRefusal(othersDrawing(entries, index), stageFxFilterCount(kind) ?? 0)
	);
}

/**
 * Why each entry does not play in the game, by index (`undefined`: it plays, or is off): the
 * reader's own order (`readPostFx`), a trigger that is not `always` / `cue`, a refused kind, then
 * the caps against the entries before it that play. A custom kind the project no longer compiles
 * takes its place as the reader gives it one (it plays nothing, and its row says so).
 */
export function postFxEntryRefusals(raw: unknown): (string | undefined)[] {
	const playing: number[] = [];
	return (Array.isArray(raw) ? raw : []).map((item) => {
		const [entry] = readElementFxEntries([item]);
		if (!entry || entry.disabled) return undefined;
		if (entry.trigger !== 'always' && entry.trigger !== 'cue') {
			return 'a post FX plays always or on a cue';
		}
		const filters = stageFxFilterCount(entry.kind) ?? 0;
		const refusal = stageFxRefusal(entry.kind) ?? stageFxCapRefusal(playing, filters);
		if (!refusal) playing.push(filters);
		return refusal;
	});
}

/** The post FX list is full: one more entry would not play. */
export const postFxFull = (entries: readonly unknown[] | undefined): boolean =>
	(entries?.length ?? 0) >= STAGE_FX_LIMITS.entries;

/** The Screen FX block's part of `settings`, sparse: a field only when it is set. */
export function screenFxSettings(
	postFx: readonly ElementFxEntry[] | undefined,
	stageFxAntialias: boolean,
): Pick<GameSettings, 'postFx' | 'stageFxAntialias'> {
	return {
		...(postFx?.length ? { postFx: [...postFx] } : {}),
		...(stageFxAntialias ? { stageFxAntialias: true as const } : {}),
	};
}
