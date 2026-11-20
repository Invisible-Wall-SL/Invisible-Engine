import {
	CHARACTER_ABILITY_BUTTONS,
	CHARACTER_FACINGS,
	CHARACTER_MOTIONS,
	CHARACTER_SHEET_LIMITS,
	characterTriggers,
	normalizeCharacterSheet,
	type CharacterAction,
	type CharacterCell,
	type CharacterFacing,
	type CharacterSheet,
	type CharacterSource,
	type CharacterTrigger,
	type GameConfigDoc,
} from 'game-config';
import { STATUS } from 'engine-mechanics';
import { freshId } from './characterEdit';
import { clipSourceOf, editSheet, numberOf, sheetIssuesAt, sheetOf } from './characterSheetEdit';
import { CELL_KIND_LABELS, cellKindOf, cellText, type CellKind } from './sheetCore';

/**
 * How Invisible Characters edits the ACTIONS of a character sheet
 * (`docs/design/character-pipeline.md` §12.5, §12.6, step C2b): the rows, what starts each, how it
 * plays, what it draws per facing (a clip, a still image or a rig's animation) and its fallback.
 * Every edit goes through `./characterSheetEdit`
 * `editSheet`, so what is stored is what the normalizer makes of it; an edit that cannot be
 * stored is refused with the reason, and `null` is "done".
 *
 * Pure: `scripts/check-characters-tool.ts` §8 and §12 run each.
 */

const NO_ACTION = 'No such action.';

export const actionsOf = (sheet: CharacterSheet | undefined): CharacterAction[] =>
	sheet?.actions ?? [];

const actionIn = (sheet: CharacterSheet, actionId: string): CharacterAction | undefined =>
	sheet.actions?.find((a) => a.id === actionId);

/** {@link editSheet} on one action of the sheet. */
const editAction = (
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	change: (action: CharacterAction, sheet: CharacterSheet) => string | null | void,
): string | null =>
	editSheet(doc, id, (sheet) => {
		const action = actionIn(sheet, actionId);
		return action ? change(action, sheet) : NO_ACTION;
	});

/** Add an action nothing starts yet, last in the sheet, under a fresh id (`stem`, `stem2`…). */
export function addAction(
	doc: GameConfigDoc,
	id: string,
	stem = 'action',
): { refused: string | null; id?: string } {
	let made: string | undefined;
	const refused = editSheet(doc, id, (sheet) => {
		const actions = (sheet.actions ??= []);
		if (actions.length >= CHARACTER_SHEET_LIMITS.actions)
			return `A sheet reads at most ${CHARACTER_SHEET_LIMITS.actions} actions.`;
		made = freshId(
			stem,
			actions.map((a) => a.id),
		);
		actions.push({ id: made });
	});
	return refused ? { refused } : { refused: null, id: made };
}

/** Remove an action. The actions it stood in for (their `fallback` named it) lose that fallback:
 *  `clearedFallbacks` lists them. */
export function removeAction(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
): { refused: string | null; clearedFallbacks: string[] } {
	const clearedFallbacks: string[] = [];
	const refused = editSheet(doc, id, (sheet) => {
		if (!actionIn(sheet, actionId)) return NO_ACTION;
		sheet.actions = (sheet.actions ?? []).filter((a) => a.id !== actionId);
		for (const action of sheet.actions) {
			if (action.fallback !== actionId) continue;
			delete action.fallback;
			clearedFallbacks.push(action.id);
		}
	});
	return { refused, clearedFallbacks: refused ? [] : clearedFallbacks };
}

/**
 * The project's clips an action finds BY NAME: `<prefix>_<action>_<facing>` under the base prefix
 * (but for a facing whose `anim` cell names a clip) and under every variant's, in any of the eight
 * facings. What a rename of the action leaves behind.
 */
export function actionClipsByName(
	sheet: CharacterSheet | undefined,
	actionId: string,
	clipIds: Iterable<string>,
): string[] {
	const source = clipSourceOf(sheet);
	const action = sheet && actionIn(sheet, actionId);
	if (!source || !action) return [];
	const have = new Set(clipIds);
	const found: string[] = [];
	const prefixes = [source.prefix, ...Object.values(source.variants ?? {})];
	prefixes.forEach((prefix, index) => {
		for (const facing of CHARACTER_FACINGS) {
			if (index === 0 && action.anim?.[facing]) continue;
			const clipId = `${prefix}_${actionId}_${facing}`;
			if (have.has(clipId) && !found.includes(clipId)) found.push(clipId);
		}
	});
	return found;
}

/**
 * Rename an action. The `fallback` of every action that named it follows (`fallbacks`). Its clips
 * are found by name, so the ones the OLD name found among `clipIds` (the project's) no longer
 * match: `lostClips` lists them, for the page to say so; `foundClips` are the ones the new name
 * finds.
 */
export function renameAction(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	next: string,
	clipIds: Iterable<string> = [],
): { refused: string | null; fallbacks: string[]; lostClips: string[]; foundClips: string[] } {
	const value = next.trim();
	const have = [...clipIds];
	const fallbacks: string[] = [];
	let lostClips: string[] = [];
	const refused = editSheet(doc, id, (sheet) => {
		const action = actionIn(sheet, actionId);
		if (!action) return NO_ACTION;
		if (!value) return 'An action id cannot be blank.';
		if (value === actionId) return null;
		if (actionIn(sheet, value)) return `The sheet already has an action "${value}".`;
		lostClips = actionClipsByName(sheet, actionId, have);
		action.id = value;
		for (const other of sheet.actions ?? []) {
			if (other.fallback !== actionId) continue;
			other.fallback = value;
			fallbacks.push(other.id);
		}
	});
	if (refused) return { refused, fallbacks: [], lostClips: [], foundClips: [] };
	return {
		refused: null,
		fallbacks,
		lostClips,
		foundClips: value === actionId ? [] : actionClipsByName(sheetOf(doc, id), value, have),
	};
}

/** The display name; blank deletes it. */
export const setActionName = (
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	name: string,
): string | null =>
	editAction(doc, id, actionId, (action) => {
		action.name = name;
	});

/** Move an action up (-1) or down (+1): of two loops as high, the first in the sheet plays. */
export function moveAction(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	by: -1 | 1,
): string | null {
	return editSheet(doc, id, (sheet) => {
		const actions = sheet.actions ?? [];
		const i = actions.findIndex((a) => a.id === actionId);
		const j = i + by;
		if (i < 0) return NO_ACTION;
		if (j < 0 || j >= actions.length) return null;
		[actions[i], actions[j]] = [actions[j], actions[i]];
	});
}

// ── triggers ───────────────────────────────────────────────────────────────────────────────────

export const TRIGGER_KINDS = ['motion', 'ability', 'event', 'status'] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TRIGGER_KIND_LABELS: Record<TriggerKind, string> = {
	motion: 'Movement',
	ability: 'Ability',
	event: 'Event',
	status: 'Status',
};

export const MOTION_OPTIONS: readonly {
	value: (typeof CHARACTER_MOTIONS)[number];
	label: string;
}[] = [
	{ value: 'still', label: 'Standing still' },
	{ value: 'moving', label: 'Moving' },
];

export const ABILITY_BUTTON_OPTIONS: readonly {
	value: (typeof CHARACTER_ABILITY_BUTTONS)[number];
	label: string;
}[] = [
	{ value: 'ability1', label: 'Ability 1' },
	{ value: 'ability2', label: 'Ability 2' },
];

/** Whom an event names for the action to start: its user, or its target. */
export const EVENT_ROLE_OPTIONS: readonly { value: 'user' | 'target'; label: string }[] = [
	{ value: 'user', label: 'It does it' },
	{ value: 'target', label: 'It is done to it' },
];

/** The room events that name a character, offered as suggestions: a rules module may raise
 *  others, so the field takes any name. */
export const EVENT_SUGGESTIONS: readonly string[] = [
	'jumped',
	'climbed',
	'hit',
	'caught',
	'hooked',
	'escaped',
];

/** The statuses a room feeds a sheet (`apps/lines` `online.ts` `statusesOf`), as suggestions. */
export const STATUS_SUGGESTIONS: readonly string[] = ['holding', 'marked', ...Object.keys(STATUS)];

export const triggerKindOf = (trigger: CharacterTrigger): TriggerKind =>
	'motion' in trigger
		? 'motion'
		: 'ability' in trigger
			? 'ability'
			: 'event' in trigger
				? 'event'
				: 'status';

/** Every trigger of `kind` the "＋ Add" menu can make, in the order it offers them: the two
 *  movements, the two buttons, the suggested events (as its user) and statuses. */
const triggerChoices = (kind: TriggerKind): CharacterTrigger[] =>
	kind === 'motion'
		? MOTION_OPTIONS.map((o) => ({ motion: o.value }))
		: kind === 'ability'
			? ABILITY_BUTTON_OPTIONS.map((o) => ({ ability: o.value }))
			: kind === 'event'
				? EVENT_SUGGESTIONS.map((event) => ({ event }))
				: STATUS_SUGGESTIONS.map((status) => ({ status }));

/**
 * A trigger of `kind` with values that already work: the first choice of that kind that is not
 * one of `have` (an action's triggers), so "＋ Add → Ability" on an action already on Ability 1
 * adds Ability 2. `undefined` when the action has every one.
 */
export const newTrigger = (
	kind: TriggerKind,
	have: readonly CharacterTrigger[] = [],
): CharacterTrigger | undefined =>
	triggerChoices(kind).find((choice) => !have.some((trigger) => sameTrigger(trigger, choice)));

/** Why no trigger of `kind` is left to add. */
const NONE_LEFT: Record<TriggerKind, string> = {
	motion: 'The action already starts on both movements.',
	ability: 'The action already starts on both ability buttons.',
	event:
		'The action already starts on every event this tool suggests. Change one of its event triggers to name another event.',
	status:
		'The action already starts on every status this tool suggests. Change one of its status triggers to name another status.',
};

/** "＋ Add" of a kind: add {@link newTrigger} for the action, or refuse with why none is left. */
export function addTriggerOfKind(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	kind: TriggerKind,
): string | null {
	const sheet = sheetOf(doc, id);
	const action = sheet && actionIn(sheet, actionId);
	if (!action) return NO_ACTION;
	const trigger = newTrigger(kind, characterTriggers(action));
	return trigger ? addTrigger(doc, id, actionId, trigger) : NONE_LEFT[kind];
}

/** `trigger` as the sheet stores it, or `undefined` when it is not one this build reads. */
const readTrigger = (trigger: CharacterTrigger): CharacterTrigger | undefined => {
	const read = normalizeCharacterSheet({ actions: [{ id: 'a', when: trigger }] })?.actions?.[0];
	return read && characterTriggers(read)[0];
};

const sameTrigger = (a: CharacterTrigger, b: CharacterTrigger): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

const BAD_TRIGGER = 'A trigger needs a movement, a button, an event name or a status name.';
const DUPLICATE_TRIGGER = 'The action already starts on that.';

/** Add a trigger: the action starts on any of its triggers. */
export function addTrigger(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	trigger: CharacterTrigger,
): string | null {
	const read = readTrigger(trigger);
	if (!read) return BAD_TRIGGER;
	return editAction(doc, id, actionId, (action) => {
		const triggers = characterTriggers(action);
		if (triggers.some((t) => sameTrigger(t, read))) return DUPLICATE_TRIGGER;
		if (triggers.length >= CHARACTER_SHEET_LIMITS.triggers)
			return `An action reads at most ${CHARACTER_SHEET_LIMITS.triggers} triggers.`;
		action.when = [...triggers, read];
	});
}

/** Replace the trigger at `index`. */
export function setTrigger(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	index: number,
	trigger: CharacterTrigger,
): string | null {
	const read = readTrigger(trigger);
	if (!read) return BAD_TRIGGER;
	return editAction(doc, id, actionId, (action) => {
		const triggers = characterTriggers(action);
		if (!triggers[index]) return 'No such trigger.';
		if (triggers.some((t, i) => i !== index && sameTrigger(t, read))) return DUPLICATE_TRIGGER;
		action.when = triggers.map((t, i) => (i === index ? read : t));
	});
}

export const removeTrigger = (
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	index: number,
): string | null =>
	editAction(doc, id, actionId, (action) => {
		const triggers = characterTriggers(action);
		if (!triggers[index]) return 'No such trigger.';
		action.when = triggers.filter((_, i) => i !== index);
	});

// ── how an action plays ────────────────────────────────────────────────────────────────────────

export const PLAY_OPTIONS = ['default', 'loop', 'once'] as const;
export type PlayChoice = (typeof PLAY_OPTIONS)[number];
export const PLAY_LABELS: Record<PlayChoice, string> = {
	default: 'By its triggers',
	loop: 'Loop',
	once: 'Once',
};

export const INTERRUPT_OPTIONS = ['default', 'priority', 'none'] as const;
export type InterruptChoice = (typeof INTERRUPT_OPTIONS)[number];
export const INTERRUPT_LABELS: Record<InterruptChoice, string> = {
	default: 'Any other once',
	priority: 'Same priority or higher',
	none: 'Nothing',
};

export const AGAIN_OPTIONS = ['default', 'ignore'] as const;
export type AgainChoice = (typeof AGAIN_OPTIONS)[number];
export const AGAIN_LABELS: Record<AgainChoice, string> = {
	default: 'Restarts',
	ignore: 'Plays on',
};

/** `loop`, `once`, or `default` (by its triggers). A choice equal to the default is not stored,
 *  so {@link playChoiceOf} then reads `default`. */
export const setActionPlay = (
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	play: PlayChoice,
): string | null =>
	editAction(doc, id, actionId, (action) => {
		if (play === 'default') delete action.play;
		else action.play = play;
	});

export const playChoiceOf = (action: CharacterAction): PlayChoice => action.play ?? 'default';

/** The priority: any number; blank is the default (the highest of its triggers'). */
export function setActionPriority(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	value: string,
): string | null {
	const priority = numberOf(value);
	if (value.trim() !== '' && priority === undefined) return 'A priority is a number.';
	return editAction(doc, id, actionId, (action) => {
		if (priority === undefined) delete action.priority;
		else action.priority = priority;
	});
}

export const setActionInterrupt = (
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	interrupt: InterruptChoice,
): string | null =>
	editAction(doc, id, actionId, (action) => {
		if (interrupt === 'default') delete action.interrupt;
		else action.interrupt = interrupt;
	});

export const setActionAgain = (
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	again: AgainChoice,
): string | null =>
	editAction(doc, id, actionId, (action) => {
		if (again === 'default') delete action.again;
		else action.again = again;
	});

/** A source that draws a cell of `kind`, to ask the validator about a cell of a sheet that has
 *  no source yet: it checks a cell only under one. */
const SOURCE_FOR: Record<CellKind, CharacterSource> = {
	clip: { kind: 'clips', prefix: 'p' },
	still: { kind: 'stills' },
	rig: { kind: 'rig', rig: 'r' },
};

/**
 * Why `cell` cannot be stored for `actionId` facing `facing`, or `null`. The save's validator is
 * asked about the sheet the write would make, and its warning for that cell is the reason
 * (`characterSheetEdit.ts` `sheetIssuesAt`): a kind the source does not draw (under a rig a clip
 * or a still image, under frame clips a rig's animation, under still images anything but a
 * still), a still image with no frame or whose sheet is not named by its manifest key (an output
 * prefix or a bare name cannot ship), a cell that names nothing.
 */
export function cellRefusal(
	sheet: CharacterSheet | undefined,
	actionId: string,
	facing: CharacterFacing,
	cell: CharacterCell,
): string | null {
	const actions = sheet?.actions ?? [];
	const index = actions.findIndex((a) => a.id === actionId);
	if (index < 0) return NO_ACTION;
	const asked: CharacterSheet = {
		...sheet,
		source: sheet?.source ?? SOURCE_FOR[cellKindOf(cell)],
		actions: actions.map((action, i) =>
			i === index ? { ...action, anim: { ...action.anim, [facing]: cell } } : action,
		),
	};
	return sheetIssuesAt(asked, `actions[${index}].anim.${facing}`)[0]?.message ?? null;
}

/** Why a cell that holds a value of another kind is not written over without `replace`. */
const heldRefusal = (held: CharacterCell): string =>
	`The cell holds a ${CELL_KIND_LABELS[cellKindOf(held)].toLowerCase()} (${cellText(held)}): replace it, or empty the cell first.`;

/**
 * Store `cell` for one facing of an action, or empty the cell (`undefined`: it is found by name
 * again, and under still images draws nothing of its own). A value is refused when the source
 * does not draw it or it cannot ship ({@link cellRefusal}). Nothing is written over silently: a
 * cell that holds a value of ANOTHER kind is replaced only with `replace`, which the editor sets
 * once it has shown what is there. A value of the same kind is changed, as a field is retyped.
 */
export function setActionCell(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	facing: CharacterFacing,
	cell: CharacterCell | undefined,
	options: { replace?: boolean } = {},
): string | null {
	if (!CHARACTER_FACINGS.includes(facing)) return 'No such facing.';
	return editAction(doc, id, actionId, (action, sheet) => {
		const anim = (action.anim ??= {});
		if (!cell) {
			delete anim[facing];
			return null;
		}
		const refused = cellRefusal(sheet, actionId, facing, cell);
		if (refused) return refused;
		const held = anim[facing];
		if (held && cellKindOf(held) !== cellKindOf(cell) && !options.replace)
			return heldRefusal(held);
		anim[facing] = cell;
	});
}

/**
 * The clip of one facing, as its field is typed; blank ⇒ found by name
 * (`<prefix>_<action>_<facing>`). The clip field never touches a cell that holds a still image or
 * a rig's animation, blank or not: that is {@link setActionCell}'s, with `replace`.
 */
export function setActionAnim(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	facing: CharacterFacing,
	clip: string,
): string | null {
	if (!CHARACTER_FACINGS.includes(facing)) return 'No such facing.';
	const value = clip.trim();
	const held = actionIn(sheetOf(doc, id) ?? {}, actionId)?.anim?.[facing];
	if (held && !held.clip) return heldRefusal(held);
	return setActionCell(doc, id, actionId, facing, value ? { clip: value } : undefined);
}

/** The action drawn in this one's place when it has no clip in any facing; blank ⇒ none. */
export function setActionFallback(
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	fallback: string,
): string | null {
	const value = fallback.trim();
	return editAction(doc, id, actionId, (action, sheet) => {
		if (!value) {
			delete action.fallback;
			return null;
		}
		if (value === actionId) return 'An action cannot stand in for itself.';
		if (!actionIn(sheet, value)) return `No action is "${value}".`;
		action.fallback = value;
	});
}
