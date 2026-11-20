import {
	CHARACTER_FACINGS,
	CHARACTER_SHEET_LIMITS,
	characterTriggers,
	characterViewFacings,
	normalizeCharacterSheet,
	type CharacterAction,
	type CharacterFacing,
	type CharacterSheet,
	type CharacterStill,
	type CharacterTrigger,
	type CharacterView,
	type GameConfigDoc,
} from 'game-config';
import { sheetStartFacing } from 'engine-layout';
import { cellRefusal } from './characterSheetActions';
import { editSheet, sheetOf, viewDrawing } from './characterSheetEdit';
import { cellValueOf, cellValueText, type CellValue } from './characterSheetPage';
import { sourceChangeLoss } from './characterSheetSources';
import { SOURCE_KIND_LABELS, SOURCE_KIND_WORDS, sheetUnplayed } from './sheetCore';

/**
 * STILL IMAGES ONTO A SHEET, MANY AT ONCE (`docs/design/character-pipeline.md` §12.4, step C6b):
 *
 *   - *Fill from names* ({@link fillFromNames}, {@link applyFill}): the frames of one project
 *     sheet named `<character>_<action>_<facing>` (or `<action>_<facing>`) each go to their cell.
 *     It is a PLAN first, which the card shows; applying it overwrites nothing unless told.
 *   - a character from such a sheet in one step ({@link startStillsCharacter});
 *   - a character whose every action is ONE image ({@link useOneStill}).
 *
 * Names are matched without regard to case, in the facing, the action and the character's
 * prefix, and a trailing image extension is ignored; the frame is stored under its own name. An
 * action the sheet does not have is the last word before the facing, lower-cased.
 *
 * Pure: `scripts/charactersTool/sources.ts` (§12 of `check:characters-tool`) runs each.
 */

/** The frames of one project sheet: its manifest key, its frame names and, when the caller has
 *  them, each frame's size in px. */
export interface FillSource {
	assetKey: string;
	regions: readonly string[];
	sizes?: Readonly<Record<string, { w: number; h: number }>>;
}

export interface FillCell {
	action: string;
	facing: CharacterFacing;
}

/** What *Fill from names* would do. Nothing in it is done until {@link applyFill}. */
export interface FillPlan {
	assetKey: string;
	/** Why nothing can be filled from this sheet (its key cannot ship, the source draws no still
	 *  image), in the validator's words; `null` when it can. */
	refused: string | null;
	/** The frames name more than one character and none was asked for: nothing is planned, and
	 *  `prefixes` are the ones to ask about. */
	ambiguous: boolean;
	/** The character prefixes the frames carry, lower-cased, in the order met (`''`: frames named
	 *  `<action>_<facing>` alone). */
	prefixes: string[];
	/** The prefix the plan is made for. */
	prefix?: string;
	/** Empty cells that get an image. */
	fills: (FillCell & { region: string })[];
	/** Cells that hold something else: written only with `overwrite`. */
	overwrites: (FillCell & { was: CellValue; region: string })[];
	/** Cells that already hold exactly this image. */
	unchanged: (FillCell & { region: string })[];
	/** Images of a facing the view does not have: not placed. */
	offView: (FillCell & { region: string })[];
	/** Frames of the prefix that match no cell: no facing at their end, or a second frame for a
	 *  cell another already fills. Frames of another prefix are not listed. */
	unmatchedRegions: string[];
	/** Per action the plan touches: the facings the view draws mirrored from a twin that has an
	 *  image, which need none of their own. */
	mirrored: FillCell[];
	/** Per action the plan touches: the facings that need an image and have none. */
	emptyCells: FillCell[];
	/** Actions the frames name and the sheet lacks: made only with `addActions`. */
	newActions: string[];
	/** The widest frame placed, px, when the sizes are known and the sheet has no draw width: a
	 *  width to start from. */
	width?: number;
	/** What the sheet still needs to be drawn once the plan is applied (with its new actions). */
	missing: string[];
}

const FACINGS: readonly string[] = CHARACTER_FACINGS;

type Parsed = { prefix: string; action: string; known: boolean; facing: CharacterFacing };

/** A frame name read as `<prefix>_<action>_<facing>`: the facing is the last word, the action the
 *  longest of the sheet's that ends the rest, else the last word of it. */
function parseRegion(region: string, actionIds: readonly string[]): Parsed | undefined {
	const stem = region.trim().replace(/\.(png|webp|jpe?g)$/i, '');
	const cut = stem.lastIndexOf('_');
	const facing = stem.slice(cut + 1).toLowerCase();
	if (cut <= 0 || !FACINGS.includes(facing)) return undefined;
	const rest = stem.slice(0, cut).toLowerCase();
	const found = { facing: facing as CharacterFacing };
	for (const id of [...actionIds].sort((a, b) => b.length - a.length)) {
		const lower = id.toLowerCase();
		if (rest === lower) return { ...found, prefix: '', action: id, known: true };
		if (rest.endsWith(`_${lower}`))
			return { ...found, prefix: rest.slice(0, -lower.length - 1), action: id, known: true };
	}
	const split = rest.lastIndexOf('_');
	const action = rest.slice(split + 1);
	if (!action) return undefined;
	return { ...found, prefix: split < 0 ? '' : rest.slice(0, split), action, known: false };
}

const sameStill = (value: CellValue | undefined, still: CharacterStill): boolean =>
	value?.kind === 'still' && value.assetKey === still.assetKey && value.region === still.region;

/** What starts an action made from a frame's name, when no action of the sheet starts on it yet. */
const NEW_ACTION_TRIGGERS: Readonly<Record<string, CharacterTrigger>> = {
	idle: { motion: 'still' },
	walk: { motion: 'moving' },
};

const startsOn = (action: CharacterAction, trigger: CharacterTrigger): boolean =>
	characterTriggers(action).some((t) => JSON.stringify(t) === JSON.stringify(trigger));

const standsStill = (sheet: CharacterSheet): boolean =>
	(sheet.actions ?? []).some((action) => startsOn(action, NEW_ACTION_TRIGGERS.idle));

/**
 * What a sheet still needs for the game to draw it (`sheetCore.ts` `sheetUnplayed`), and to draw
 * it standing (the validator warns of a sheet with no action for `motion: still`), each as what
 * to do. Empty: it plays.
 */
export function stillMissing(sheet: CharacterSheet | undefined): string[] {
	const why = sheetUnplayed(sheet);
	const missing: string[] = [];
	if (why.includes('empty') || why.includes('source')) missing.push('Choose an animation source.');
	if (why.includes('facings')) missing.push('Pick a view with facings: a 3D view draws no image.');
	if (why.includes('empty') || why.includes('draw')) missing.push('Set a width for the draw box.');
	if (why.includes('empty') || why.includes('actions')) missing.push('Add an action.');
	else if (sheet && !standsStill(sheet))
		missing.push('Give one action the trigger "Standing still", or nothing is drawn while it stands.');
	return missing;
}

type FillOptions = { overwrite: boolean; addActions: boolean };
type FillCounts = {
	filled: number;
	overwritten: number;
	kept: number;
	addedActions: string[];
	skippedActions: string[];
};

/** Carry a plan out on `sheet`, in place. A cell is judged as it is NOW, not as the plan saw it:
 *  an empty one is filled, one that holds this image is left, and any other is written over only
 *  with `overwrite`. Returns why the first image cannot be stored, else the counts. */
function fillInto(sheet: CharacterSheet, plan: FillPlan, options: FillOptions): FillCounts | string {
	const counts: FillCounts = {
		filled: 0,
		overwritten: 0,
		kept: 0,
		addedActions: [],
		skippedActions: [],
	};
	const actions = (sheet.actions ??= []);
	for (const { action: actionId, facing, region } of [...plan.fills, ...plan.overwrites]) {
		let action = actions.find((a) => a.id === actionId);
		if (!action) {
			const addable =
				options.addActions &&
				plan.newActions.includes(actionId) &&
				actions.length < CHARACTER_SHEET_LIMITS.actions;
			if (!addable) {
				if (!counts.skippedActions.includes(actionId)) counts.skippedActions.push(actionId);
				continue;
			}
			const trigger = Object.hasOwn(NEW_ACTION_TRIGGERS, actionId)
				? NEW_ACTION_TRIGGERS[actionId]
				: undefined;
			const free = trigger && !actions.some((a) => startsOn(a, trigger));
			action = { id: actionId, ...(trigger && free ? { when: trigger } : {}) };
			actions.push(action);
			counts.addedActions.push(actionId);
		}
		const still = { assetKey: plan.assetKey, region };
		const refused = cellRefusal(sheet, actionId, facing, { still });
		if (refused) return refused;
		const held = cellValueOf(sheet, actionId, facing);
		if (sameStill(held, still)) continue;
		if (held && !options.overwrite) {
			counts.kept += 1;
			continue;
		}
		action.anim = { ...action.anim, [facing]: { still } };
		if (held) counts.overwritten += 1;
		else counts.filled += 1;
	}
	return counts;
}

/**
 * Plan *Fill from names* for `sheet` from the frames of one project sheet. With frames of more
 * than one character in it (`bear_idle_n` and `fisherman_idle_n`) the plan does NOT guess:
 * it comes back `ambiguous` with the `prefixes` found, to be asked again with `options.prefix`.
 * Only the facings of the sheet's view are placed; of those, a facing the view mirrors needs no
 * image of its own.
 */
export function fillFromNames(
	sheet: CharacterSheet | undefined,
	source: FillSource,
	options: { prefix?: string } = {},
): FillPlan {
	const assetKey = source.assetKey.trim();
	const plan: FillPlan = {
		assetKey,
		refused: null,
		ambiguous: false,
		prefixes: [],
		fills: [],
		overwrites: [],
		unchanged: [],
		offView: [],
		unmatchedRegions: [],
		mirrored: [],
		emptyCells: [],
		newActions: [],
		missing: [],
	};
	plan.refused = cellRefusal(
		{ source: sheet?.source ?? { kind: 'stills' }, actions: [{ id: 'a' }] },
		'a',
		'se',
		{ still: { assetKey, region: 'a' } },
	);
	if (plan.refused) return plan;
	const actionIds = (sheet?.actions ?? []).map((a) => a.id);
	const parsed: (Parsed & { region: string })[] = [];
	for (const region of source.regions) {
		const read = parseRegion(region, actionIds);
		if (read) parsed.push({ ...read, region });
		else plan.unmatchedRegions.push(region);
	}
	plan.prefixes = [...new Set(parsed.map((p) => p.prefix))];
	const asked = options.prefix?.trim().toLowerCase();
	if (asked === undefined && plan.prefixes.length > 1) {
		plan.ambiguous = true;
		return plan;
	}
	const prefix = asked ?? plan.prefixes[0];
	if (prefix !== undefined) plan.prefix = prefix;
	const drawn = characterViewFacings(sheet?.view);
	const taken = new Set<string>();
	const touched: string[] = [];
	for (const { action, facing, region, known } of parsed.filter((p) => p.prefix === prefix)) {
		const cell = { action, facing, region };
		if (!drawn.includes(facing)) {
			plan.offView.push(cell);
			continue;
		}
		if (taken.has(`${action}|${facing}`)) {
			plan.unmatchedRegions.push(region);
			continue;
		}
		taken.add(`${action}|${facing}`);
		if (!touched.includes(action)) touched.push(action);
		if (!known && !plan.newActions.includes(action)) plan.newActions.push(action);
		const was = cellValueOf(sheet, action, facing);
		if (!was) plan.fills.push(cell);
		else if (sameStill(was, { assetKey, region })) plan.unchanged.push(cell);
		else plan.overwrites.push({ ...cell, was });
	}
	const { made, mirrored } = viewDrawing(sheet?.view);
	const placed = (action: string, facing: CharacterFacing): boolean =>
		taken.has(`${action}|${facing}`);
	for (const action of touched) {
		for (const facing of made) if (!placed(action, facing)) plan.emptyCells.push({ action, facing });
		for (const facing of mirrored) if (!placed(action, facing)) plan.mirrored.push({ action, facing });
	}
	const widths = [...plan.fills, ...plan.overwrites, ...plan.unchanged].map(
		({ region }) => source.sizes?.[region]?.w ?? 0,
	);
	const widest = Math.max(0, ...widths);
	if (widest > 0 && !sheet?.draw) plan.width = widest;
	const outcome: CharacterSheet = JSON.parse(JSON.stringify(sheet ?? {})) as CharacterSheet;
	fillInto(outcome, plan, { overwrite: true, addActions: true });
	plan.missing = stillMissing(normalizeCharacterSheet(outcome));
	return plan;
}

const cells = (n: number): string => `${n} ${n === 1 ? 'image' : 'images'}`;

/** A plan in lines, for the card to show before it is applied: one per action (`idle: 5 images,
 *  3 facings mirrored, nothing missing.`), then what it would overwrite, leave, and cannot place. */
export function fillPlanText(plan: FillPlan): string[] {
	if (plan.refused) return [plan.refused];
	if (plan.ambiguous)
		return [
			`The sheet holds images of ${plan.prefixes.length} characters (${plan.prefixes.map((p) => p || 'no prefix').join(', ')}): pick which one this is.`,
		];
	const placed = [...plan.fills, ...plan.overwrites, ...plan.unchanged];
	const lines = [...new Set(placed.map((c) => c.action))].map((action) => {
		const of = <T extends FillCell>(list: readonly T[]): T[] => list.filter((c) => c.action === action);
		const empty = of(plan.emptyCells);
		const mirrored = of(plan.mirrored).length;
		return `${action}${plan.newActions.includes(action) ? ' (a new action)' : ''}: ${cells(of(placed).length)}${mirrored ? `, ${mirrored} ${mirrored === 1 ? 'facing' : 'facings'} mirrored` : ''}, ${empty.length ? `missing ${empty.map((c) => c.facing).join(', ')}` : 'nothing missing'}.`;
	});
	if (!placed.length) lines.push('No image is named for an action and a facing of this view.');
	else if (!plan.fills.length && !plan.overwrites.length)
		lines.push('Nothing to do: every image is already in its cell.');
	for (const { action, facing, was, region } of plan.overwrites)
		lines.push(`${action}, facing ${facing} holds ${cellValueText(was)}: "${region}" replaces it only if you say so.`);
	if (plan.offView.length)
		lines.push(
			`The view has no facing ${[...new Set(plan.offView.map((c) => c.facing))].join(', ')}: ${cells(plan.offView.length)} not placed (${plan.offView.map((c) => c.region).join(', ')}).`,
		);
	if (plan.unmatchedRegions.length)
		lines.push(`Not placed, by their names: ${plan.unmatchedRegions.join(', ')}.`);
	return [...lines, ...plan.missing];
}

/**
 * Carry out a plan on the character's sheet. `overwrite`: write over the cells that hold
 * something else (the plan's `overwrites`); without it they are `kept`. `addActions`: make the
 * actions the sheet lacks (`idle` starts when the character stands still, `walk` when it moves,
 * unless an action already does; any other has no trigger yet); without it their images are
 * skipped (`skippedActions`). An ambiguous or refused plan is refused. `missing` is what the
 * sheet still needs to be drawn.
 */
export function applyFill(
	doc: GameConfigDoc,
	id: string,
	plan: FillPlan,
	options: FillOptions,
): FillCounts & { refused: string | null; missing: string[] } {
	let counts: FillCounts = {
		filled: 0,
		overwritten: 0,
		kept: 0,
		addedActions: [],
		skippedActions: [],
	};
	const none = counts;
	const refused = editSheet(doc, id, (sheet) => {
		if (plan.refused) return plan.refused;
		if (plan.ambiguous) return fillPlanText(plan)[0];
		const done = fillInto(sheet, plan, options);
		if (typeof done === 'string') return done;
		counts = done;
	});
	return { ...(refused ? none : counts), refused, missing: stillMissing(sheetOf(doc, id)) };
}

const STRAIGHTS: readonly CharacterFacing[] = ['n', 'e', 's', 'w'];

/**
 * The smallest view that has every one of `facings`: a side view for `e` and `w` alone, the four
 * isometric diagonals, the four straight facings top-down, else all eight (isometric: the view a
 * character has when none is chosen). `undefined` for none.
 */
export function viewForFacings(facings: readonly CharacterFacing[]): CharacterView | undefined {
	if (!facings.length) return undefined;
	if (facings.every((f) => f === 'e' || f === 'w')) return { kind: 'side' };
	if (facings.every((f) => f.length === 2)) return { kind: 'isometric' };
	if (facings.every((f) => STRAIGHTS.includes(f))) return { kind: 'topDown' };
	return { kind: 'isometric', facings: 8 };
}

const lossRefusal = (sheet: CharacterSheet): string | null => {
	const loss = sourceChangeLoss(sheet, 'stills').text;
	return loss
		? `Changing the source to ${SOURCE_KIND_WORDS.stills} loses ${loss}: confirm it first.`
		: null;
};

/**
 * "These images are a character", in one step: make the source still images, fill the cells from
 * the frames' names with the actions they name ({@link fillFromNames}, {@link applyFill} with
 * `addActions` and no overwrite), and give the draw box a width when it has none (`options.width`,
 * else the widest frame placed when the sizes are known). A sheet with NO view is given the
 * smallest that has every facing the frames name ({@link viewForFacings}; `view` answers it): a
 * view already chosen is kept. Nothing is written when the frames name several characters and no
 * `prefix` is given, or when another kind of source would lose what it names and `confirmLoss` is
 * not set.
 */
export function startStillsCharacter(
	doc: GameConfigDoc,
	id: string,
	source: FillSource,
	options: { prefix?: string; width?: number; confirmLoss?: boolean } = {},
): {
	refused: string | null;
	plan: FillPlan;
	view?: CharacterView;
	width?: number;
	filled: number;
	kept: number;
	addedActions: string[];
	missing: string[];
} {
	let plan = fillFromNames({ ...sheetOf(doc, id), source: { kind: 'stills' } }, source, options);
	let view: CharacterView | undefined;
	let width: number | undefined;
	let counts: FillCounts | undefined;
	const refused = editSheet(doc, id, (sheet) => {
		if (plan.refused || plan.ambiguous) return fillPlanText(plan)[0];
		const loss = options.confirmLoss ? null : lossRefusal(sheet);
		if (loss) return loss;
		sheet.source = { kind: 'stills' };
		if (!sheet.view) {
			const named = [...plan.fills, ...plan.overwrites, ...plan.unchanged, ...plan.offView];
			view = viewForFacings(CHARACTER_FACINGS.filter((f) => named.some((c) => c.facing === f)));
			if (view) sheet.view = view;
		}
		plan = fillFromNames(sheet, source, options);
		if (plan.refused) return plan.refused;
		const done = fillInto(sheet, plan, { overwrite: false, addActions: true });
		if (typeof done === 'string') return done;
		counts = done;
		if (!sheet.draw) width = options.width ?? plan.width;
		if (width !== undefined && width > 0) sheet.draw = { width };
	});
	return {
		refused,
		plan,
		...(!refused && view ? { view } : {}),
		...(!refused && width !== undefined && width > 0 ? { width } : {}),
		filled: counts?.filled ?? 0,
		kept: counts?.kept ?? 0,
		addedActions: counts?.addedActions ?? [],
		missing: stillMissing(sheetOf(doc, id)),
	};
}

/** Whether `action`, through its fallbacks, is drawn as `target` when it has no image. */
function reaches(sheet: CharacterSheet, action: CharacterAction, target: string): boolean {
	const seen = new Set<string>();
	let at: CharacterAction | undefined = action;
	while (at && !seen.has(at.id)) {
		if (at.id === target) return true;
		seen.add(at.id);
		const next: string | undefined = at.fallback;
		at = sheet.actions?.find((a) => a.id === next);
	}
	return false;
}

/**
 * Draw the whole character as ONE image: the source becomes still images, the action it stands
 * still in (the first that starts on `motion: still`, else `idle`, made when the sheet has
 * neither) gets the image in the facing the character starts in (`engine-layout`
 * `sheetStartFacing`; every other facing stands in from it), and every other action falls back to
 * that action, so each is drawn as the image until it has art of its own.
 *
 * Says what it did: `created` (the action was made), `replaced` (what the cell held), `fallbacks`
 * (the actions now standing in through it) and `replacedFallbacks` (the ones whose own fallback
 * did not lead to it, with what it was). Cells of the other actions are kept. `options.width`
 * gives the draw box a width when it has none. Refused when another kind of source would lose
 * what it names and `confirmLoss` is not set, and for an image that cannot ship.
 */
export function useOneStill(
	doc: GameConfigDoc,
	id: string,
	still: CharacterStill,
	options: { width?: number; confirmLoss?: boolean } = {},
): {
	refused: string | null;
	action?: string;
	facing?: CharacterFacing;
	created: boolean;
	replaced?: CellValue;
	fallbacks: string[];
	replacedFallbacks: { action: string; was: string }[];
	lost: string;
	missing: string[];
} {
	const image = { assetKey: still.assetKey.trim(), region: still.region.trim() };
	let did:
		| {
				action: string;
				facing: CharacterFacing;
				created: boolean;
				replaced?: CellValue;
				fallbacks: string[];
				replacedFallbacks: { action: string; was: string }[];
				lost: string;
		  }
		| undefined;
	const refused = editSheet(doc, id, (sheet) => {
		const loss = options.confirmLoss ? null : lossRefusal(sheet);
		if (loss) return loss;
		const lost = sourceChangeLoss(sheet, 'stills').text;
		sheet.source = { kind: 'stills' };
		const actions = (sheet.actions ??= []);
		let target =
			actions.find((a) => startsOn(a, NEW_ACTION_TRIGGERS.idle)) ??
			actions.find((a) => a.id === 'idle');
		const created = !target;
		if (!target) {
			if (actions.length >= CHARACTER_SHEET_LIMITS.actions)
				return `A sheet reads at most ${CHARACTER_SHEET_LIMITS.actions} actions.`;
			target = { id: 'idle' };
			actions.push(target);
		}
		if (!startsOn(target, NEW_ACTION_TRIGGERS.idle))
			target.when = [...characterTriggers(target), NEW_ACTION_TRIGGERS.idle];
		const facing = sheetStartFacing(sheet);
		const cannot = cellRefusal(sheet, target.id, facing, { still: image });
		if (cannot) return cannot;
		const held = cellValueOf(sheet, target.id, facing);
		target.anim = { ...target.anim, [facing]: { still: image } };
		const others = actions.filter((a) => a !== target);
		const fallbacks: string[] = [];
		const replacedFallbacks: { action: string; was: string }[] = [];
		const targetId = target.id;
		for (const action of others.filter((a) => !a.fallback)) {
			action.fallback = targetId;
			fallbacks.push(action.id);
		}
		for (const action of others) {
			if (reaches(sheet, action, targetId)) continue;
			replacedFallbacks.push({ action: action.id, was: action.fallback ?? '' });
			action.fallback = targetId;
			fallbacks.push(action.id);
		}
		if (!sheet.draw && options.width !== undefined && options.width > 0)
			sheet.draw = { width: options.width };
		did = {
			action: targetId,
			facing,
			created,
			...(held && !sameStill(held, image) ? { replaced: held } : {}),
			fallbacks,
			replacedFallbacks,
			lost,
		};
	});
	const missing = stillMissing(sheetOf(doc, id));
	return did && !refused
		? { refused: null, ...did, missing }
		: { refused, created: false, fallbacks: [], replacedFallbacks: [], lost: '', missing };
}

/** What {@link useOneStill} did, in a sentence for the card. */
export function oneStillText(did: ReturnType<typeof useOneStill>): string {
	if (did.refused || !did.action) return did.refused ?? '';
	const parts = [
		`${SOURCE_KIND_LABELS.stills}: "${did.action}"${did.created ? ', a new action,' : ''} draws the image facing ${did.facing}, and every other facing from it.`,
		...(did.replaced ? [`It replaced ${cellValueText(did.replaced)}.`] : []),
		...(did.fallbacks.length
			? [`${did.fallbacks.map((a) => `"${a}"`).join(', ')} ${did.fallbacks.length === 1 ? 'falls' : 'fall'} back to it.`]
			: []),
		...did.replacedFallbacks.map((r) => `"${r.action}" fell back to "${r.was}" before.`),
		...(did.lost ? [`The source lost ${did.lost}.`] : []),
		...did.missing,
	];
	return parts.join(' ');
}
