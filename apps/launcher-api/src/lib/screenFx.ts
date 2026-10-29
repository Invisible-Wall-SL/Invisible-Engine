import {
	STAGE_FX_LIMITS,
	customElementFx,
	customElementFxList,
	findElementFxSpec,
	isCustomElementFxKind,
	isPlayableElementFxKind,
	readElementFxEntry,
	type ElementFxEntry,
	type ElementFxKindId,
} from 'constants-shared/elementFx';
import {
	SCREEN_TRANSITION_KINDS,
	readScreenTransition,
	type ScreenTransitionSpec,
} from 'constants-shared/screenTransition';
import {
	readPostFx,
	transitionCueStatus,
	type GameSettings,
	type TransitionCueStatus,
} from 'engine-layout';
import {
	POST_COST_BUDGET,
	POST_SAMPLE_BUDGET,
	TRANSITION_COST_BUDGET,
	TRANSITION_SAMPLE_BUDGET,
	builtinTwin,
	compileShaderGraph,
	isBreakTwin,
} from 'engine-shadergraph';
import {
	stageFxCapRefusal,
	stageFxFilterCount,
	stageFxJudge,
	stageFxRefusal,
} from 'pixi-svelte/elementFx';

/**
 * Game Settings → Screen FX in the Scene Editor (Shader Graph 8e, `shader-graph-screens.md` §9.2):
 * what the transition cue row and the post FX list offer, what each costs, and what the block
 * writes into `settings`. Every rule about the stage is the runtime's own
 * (`pixi-svelte/elementFx`), so the editor greys exactly what the game refuses.
 */

/** The reference phone the budget is set on (§10): 390 × 844 CSS px at DPR 2, in device pixels. */
export const REFERENCE_PHONE_PX = { width: 780, height: 1688 } as const;
const PHONE_PX = REFERENCE_PHONE_PX.width * REFERENCE_PHONE_PX.height;

/** The post FX budget on the reference phone: the graph cost a post FX may take × its pixels. */
export const POST_FX_LOAD_BUDGET = POST_COST_BUDGET * PHONE_PX;
/** The transition budget on the reference phone (§10): about four elements' worth. */
export const TRANSITION_LOAD_BUDGET = TRANSITION_COST_BUDGET * PHONE_PX;

export type ScreenFxLoad =
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

/** What a screen effect is held to: its graph cost and reads, and the words for it. */
const USES = {
	post: { cost: POST_COST_BUDGET, samples: POST_SAMPLE_BUDGET, name: 'the post FX budget' },
	transition: {
		cost: TRANSITION_COST_BUDGET,
		samples: TRANSITION_SAMPLE_BUDGET,
		name: 'the transition budget',
	},
} as const;
type ScreenFxUse = keyof typeof USES;

function loadOf(
	cost: { cost: number; samples?: number } | undefined,
	use: ScreenFxUse,
): ScreenFxLoad {
	if (cost === undefined) return { kind: 'none', px: PHONE_PX };
	const budget = USES[use];
	return {
		kind: 'compiled',
		px: PHONE_PX,
		cost: cost.cost,
		samples: cost.samples,
		load: cost.cost * PHONE_PX,
		budget: budget.cost * PHONE_PX,
		over: cost.cost > budget.cost || (cost.samples !== undefined && cost.samples > budget.samples),
	};
}

/** A custom kind's compiled cost, when its effect carries one. */
function compiledCost(kind: ElementFxKindId): { cost: number; samples?: number } | undefined {
	const effect = customElementFx(kind);
	return effect?.cost === undefined ? undefined : { cost: effect.cost, samples: effect.samples };
}

const twinCosts = new Map<string, { cost: number; samples: number } | undefined>();

/** A built-in kind's cost as its graph twin's (§10: built-in transitions are costed so), compiled
 *  once; `undefined` for a kind with no twin, or a break's (its pieces, not its graph, cost). */
function twinCost(kind: ElementFxKindId): { cost: number; samples: number } | undefined {
	if (!twinCosts.has(kind)) {
		const twin = builtinTwin(kind);
		const compiled = twin && !isBreakTwin(twin) ? compileShaderGraph(twin.doc) : undefined;
		twinCosts.set(
			kind,
			compiled?.ok ? { cost: compiled.shader.cost, samples: compiled.shader.samples } : undefined,
		);
	}
	return twinCosts.get(kind);
}

/**
 * What `kind` costs as a post FX on the reference phone: its compiled graph cost × the phone's
 * pixels, against {@link POST_FX_LOAD_BUDGET}. A kind whose effect carries no compiled cost (a
 * built-in, or a graph compiled without one) is `none`: nothing is guessed.
 */
export const postFxLoad = (kind: ElementFxKindId): ScreenFxLoad =>
	loadOf(compiledCost(kind), 'post');

/**
 * What `kind` costs as a transition on the reference phone, against
 * {@link TRANSITION_LOAD_BUDGET}: a custom kind's compiled cost, a built-in's as its graph twin
 * (§10). `none` when neither is known.
 */
export const transitionLoad = (kind: ElementFxKindId): ScreenFxLoad =>
	loadOf(isCustomElementFxKind(kind) ? compiledCost(kind) : twinCost(kind), 'transition');

/** `1.32 M`: a pixel count or a load, in millions. */
export const millions = (n: number): string => `${(n / 1e6).toFixed(2)} M`;

function loadText(load: ScreenFxLoad, use: ScreenFxUse, what: string): string {
	if (load.kind === 'none') {
		return `No compiled cost for this ${what}, so no load is shown: it covers ${millions(load.px)} px on the reference phone.`;
	}
	const budget = USES[use];
	const reads =
		load.samples === undefined ? '' : `; ${load.samples} reads a pixel of ${budget.samples}`;
	return `Load ${millions(load.px)} px × cost ${load.cost} = ${millions(load.load)} of ${millions(load.budget)} (${budget.name}, cost ${budget.cost}${reads}).`;
}

/** The load line's words for `kind` as a post FX. */
export const postFxLoadText = (kind: ElementFxKindId): string =>
	loadText(postFxLoad(kind), 'post', 'kind');

/** The load line's words for `kind` as a transition. */
export const transitionLoadText = (kind: ElementFxKindId): string =>
	loadText(transitionLoad(kind), 'transition', 'transition');

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
 * Why each entry does not play in the game, by index (`undefined`: it plays, is off, or cannot be
 * read here): `readPostFx` itself, with the game's judge (`stageFxJudge`), so the editor marks
 * exactly the entries the game plays, each in the reader's words. A custom kind the project no
 * longer compiles takes no place, as in the game, and its row says so; an entry after one with the
 * same id is never read.
 */
export function postFxEntryRefusals(raw: unknown): (string | undefined)[] {
	const list = Array.isArray(raw) ? raw : [];
	const dropped = new Map<string, string>();
	readPostFx({ postFx: list }, stageFxJudge, (entry, why) => dropped.set(entry.id, why));
	const first = new Map<string, number>();
	return list.map((item, index) => {
		const entry = readElementFxEntry(item);
		if (!entry) return undefined;
		if ((first.get(entry.id) ?? index) !== index) return 'an entry before it has the same id';
		first.set(entry.id, index);
		return entry.disabled ? undefined : dropped.get(entry.id);
	});
}

/** The post FX list is full: one more entry would not play. */
export const postFxFull = (entries: readonly unknown[] | undefined): boolean =>
	(entries?.length ?? 0) >= STAGE_FX_LIMITS.entries;

/** What the Screen FX block holds. */
export interface ScreenFxState {
	transitionCue: ScreenTransitionSpec | undefined;
	postFx: readonly ElementFxEntry[] | undefined;
	stageFxAntialias: boolean;
}

/** The Screen FX block's part of `settings`, sparse: a field only when it is set. */
export function screenFxSettings({
	transitionCue,
	postFx,
	stageFxAntialias,
}: ScreenFxState): Pick<GameSettings, 'transitionCue' | 'postFx' | 'stageFxAntialias'> {
	return {
		...(transitionCue ? { transitionCue } : {}),
		...(postFx?.length ? { postFx: [...postFx] } : {}),
		...(stageFxAntialias ? { stageFxAntialias: true as const } : {}),
	};
}

/** A group of kinds in a transition picker. */
export interface ScreenTransitionKindGroup {
	label: string;
	kinds: ElementFxKindId[];
}

/**
 * The kinds a transition may play, as the pickers group them (§9.1, §9.2): the built-in exit
 * kinds, then the project's own Shader Graph effects as this page registered them. The `transition`
 * cue's row and the Flow's `screenTransition` inspector both list these.
 */
export function screenTransitionKindGroups(): ScreenTransitionKindGroup[] {
	const custom = customElementFxList().map((effect) => effect.spec.kind);
	return [
		{ label: 'Built-in (exit)', kinds: [...SCREEN_TRANSITION_KINDS] },
		...(custom.length ? [{ label: 'Custom (Shader Graph)', kinds: custom }] : []),
	];
}

/** A transition kind's name in a picker: its catalog label, or the stored id when it is unknown. */
export const screenTransitionKindLabel = (kind: string): string =>
	(isPlayableElementFxKind(kind) ? findElementFxSpec(kind)?.label : undefined) ?? kind;

/**
 * The `transition` cue's row as the game reads it (`readTransitionCue`), with what it says:
 * `transitionCueStatus` against the effects this page registered (as the game judges the ones it
 * ships). `flowFires` is whether the project's flow fires `transition` (`undefined`: no stored
 * flow, so the coded one does).
 */
export function transitionCueLine(
	transitionCue: unknown,
	flowFires: boolean | undefined,
): { status: TransitionCueStatus; text: string; warn: boolean } {
	const cue = readScreenTransition(transitionCue);
	const status = transitionCueStatus(
		{ settings: cue ? { transitionCue: cue } : undefined },
		(kind) => isPlayableElementFxKind(kind),
	);
	if (status === 'unplayable') {
		return {
			status,
			text: 'Its effect does not ship (its graph was deleted, or does not compile), so every transition cue plays the wipe.',
			warn: true,
		};
	}
	if (status === 'off') {
		return {
			status,
			text: 'Every transition cue plays the wipe (coded, or authored when Authored overlays → Transition is on).',
			warn: false,
		};
	}
	if (flowFires === false) {
		return {
			status,
			text: "The project's flow never fires transition, so this never plays: fire the transition cue in Invisible Flow, or leave the wipe.",
			warn: true,
		};
	}
	return {
		status,
		text: 'Every transition cue plays this instead of the wipe: the frame freezes, the flow goes on at once (about 1.6 s sooner than after the wipe) and the transition reveals what it shows next. The authored Transition pilot is set aside.',
		warn: false,
	};
}
