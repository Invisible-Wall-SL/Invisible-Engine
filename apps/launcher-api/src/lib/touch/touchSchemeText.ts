import {
	ARCADE_POINTER_DEFAULTS,
	ARCADE_TOUCH_DEFAULTS,
	touchSchemeOf,
	type ArcadeTouchScheme,
	type GameConfigDoc,
	type GameConfigIssue,
	type ResolvedTouchScheme,
} from 'game-config';

/**
 * What a touch control scheme (`game-config` `touchScheme.ts`, `arcade.online.touch`) is called
 * on a page: each choice's label, and a scheme in one line. Game Config's Mouse and touch card
 * edits a scheme and Invisible Characters' Online class card names one, so both read the words
 * here. Pure; `check:game-config-family` and `check:characters-tool` run it.
 */

export const TOUCH_GESTURE_LABELS: Record<ResolvedTouchScheme['gestures'], string> = {
	hold: 'Hold to steer',
	tap: 'Tap to head',
	both: 'Both',
};
export const TOUCH_STEER_LABELS: Record<ResolvedTouchScheme['steer'], string> = {
	finger: 'Towards the finger',
	stick: 'Virtual stick from where the finger went down',
};
export const TOUCH_ABILITY_LABELS: Record<ResolvedTouchScheme['ability'], string> = {
	tap: 'Any tap',
	target: 'A tap on a target',
	secondFinger: 'A second finger',
	button: 'An on-screen button',
};
export const TOUCH_AIM_LABELS: Record<ResolvedTouchScheme['aim'], string> = {
	point: 'Where tapped',
	ahead: 'As a key press',
};

/** The Mouse and touch card of Game Config, where a scheme is edited: its `SectionCard` id (scope
 *  `config`) and the anchor a link scrolls to. */
export const TOUCH_CARD_ID = 'onlinePointer';
export const TOUCH_CARD_ANCHOR = 'touch-schemes';

const TOUCH_PATH = 'arcade.online.touch';

/** Of a config's issues, the ones of the touch scheme the class `classId` is given: the class's
 *  own, its scheme's, and the block's (mouse and touch off). None for a class with no scheme whose
 *  name is not at fault. */
export function classTouchIssues(
	issues: GameConfigIssue[],
	doc: GameConfigDoc,
	classId: string,
): GameConfigIssue[] {
	const name = classTouchScheme(doc, classId);
	const own = `${TOUCH_PATH}.characters.${classId}`;
	return issues.filter(
		(i) =>
			i.path === own ||
			(name !== '' && (i.path === TOUCH_PATH || i.path === `${TOUCH_PATH}.schemes.${name}`)),
	);
}

/** The scheme a class is given, by name; `''` for none. */
export const classTouchScheme = (doc: GameConfigDoc, classId: string): string =>
	ownOf(doc.arcade?.online?.touch?.characters, classId) ?? '';

/** `map[key]` when it is the map's own: a class named `constructor` has no scheme. */
const ownOf = (map: Record<string, string> | undefined, key: string): string | undefined =>
	map && Object.hasOwn(map, key) ? map[key] : undefined;

/** The names of the project's schemes, in the order they are stored. */
export const touchSchemeNames = (doc: GameConfigDoc): string[] =>
	Object.keys(doc.arcade?.online?.touch?.schemes ?? {});

/** The classes that name the scheme `name`, in the room's order of classes. */
export const classesUsingTouchScheme = (doc: GameConfigDoc, name: string): string[] => {
	const online = doc.arcade?.online;
	const given = online?.touch?.characters ?? {};
	return (online?.characters ?? []).map((c) => c.id).filter((id) => ownOf(given, id) === name);
};

const lower = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1);

/** A scheme with every field named, in one line: what a finger does, then the ability. */
export function touchSchemeSummary(scheme: ResolvedTouchScheme): string {
	const holds = scheme.gestures !== 'tap';
	const parts = [
		scheme.gestures === 'both'
			? 'Hold to steer and tap to head'
			: TOUCH_GESTURE_LABELS[scheme.gestures],
		...(holds ? [lower(TOUCH_STEER_LABELS[scheme.steer])] : []),
		...(holds ? [scheme.releaseStops ? 'lifting stops' : 'lifting keeps going'] : []),
		`the ability by ${lower(TOUCH_ABILITY_LABELS[scheme.ability])}${
			scheme.ability === 'target' ? ` (within ${scheme.targetRadius} px)` : ''
		}, aimed ${lower(TOUCH_AIM_LABELS[scheme.aim])}`,
		`dead zone ${scheme.deadZone} px`,
		`a tap within ${scheme.tapPx} px${scheme.tapMs ? ` and ${scheme.tapMs} ms` : ''}`,
	];
	return parts.join(' · ');
}

/** The game's own dead zone and tap distance (`arcade.online.pointer`), which a scheme naming
 *  none plays with. */
export const gamePointerOf = (doc: GameConfigDoc): { deadZone: number; tapPx: number } => {
	const pointer = doc.arcade?.online?.pointer;
	return {
		deadZone: pointer?.deadZone ?? ARCADE_POINTER_DEFAULTS.deadZone,
		tapPx: pointer?.tapPx ?? ARCADE_POINTER_DEFAULTS.tapPx,
	};
};

/** The scheme of the class `classId` in one line ({@link touchSchemeSummary}); `''` for a class
 *  with no scheme. */
export function classTouchSummary(doc: GameConfigDoc, classId: string): string {
	const scheme = touchSchemeOf(doc, classId, gamePointerOf(doc));
	return scheme ? touchSchemeSummary(scheme) : '';
}

/** A stored scheme's choices as their controls show them: the stored value, or the default in
 *  force. */
export const touchChoicesOf = (
	scheme: ArcadeTouchScheme,
): Pick<ResolvedTouchScheme, 'gestures' | 'steer' | 'ability' | 'aim'> => ({
	gestures: scheme.gestures ?? ARCADE_TOUCH_DEFAULTS.gestures,
	steer: scheme.steer ?? ARCADE_TOUCH_DEFAULTS.steer,
	ability: scheme.ability ?? ARCADE_TOUCH_DEFAULTS.ability,
	aim: scheme.aim ?? ARCADE_TOUCH_DEFAULTS.aim,
});
