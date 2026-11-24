/**
 * WHAT A CHARACTER WITH A SHEET PLAYS (`docs/design/character-pipeline.md` §3, steps C2a and C6a):
 * the one resolver, with an adapter for a sheet of frame clips or still images and one for a rig.
 * A sheet (`game-config` `characterSheet.ts`) is data on the character's `arcade.characters`
 * entry; whoever draws the character hands this a sample of it every frame, never inside a fixed
 * step, and draws what it answers. Three stages:
 *
 * 1. the action: of the loop actions whose trigger holds this frame the highest priority plays,
 *    and an event or an ability plays its action once over it; a held action plays once and then
 *    stays on its last frame while it is in force;
 * 2. the facing: one of the view's list, from the drawn velocity, with the dead bands and the turn
 *    hold of `characterClips.ts`;
 * 3. the adapter. Clips: `<prefix>_<action>_<facing>` (or the clip or the still image the
 *    action's `anim` names for that facing), a missing facing stood in for by its mirror twin and
 *    then the nearest facings outward, before the action's `fallback` is tried. A rig: the same
 *    order over its animations ({@link resolveSheetRig}).
 *
 * `characterClips.ts` is not edited and a `characterClips` block keeps playing through it. That a
 * block read as a sheet ({@link sheetOfCharacterClips}) draws the same clips through this module
 * is held by `scripts/check-character-sheet.mjs`, cell for cell and frame for frame.
 *
 * `game-config` is imported for its types only, so this module adds no edge between the two
 * packages to a runtime's bundle; the few rules of the sheet read here (an action's triggers, its
 * default play and priority, a view's facings) are copies of the ones `game-config` exports. The
 * gate compares the facings with `characterViewFacings` directly and the rest through what plays.
 * Plain literals, no top-level calls: a runtime that plays no sheet tree-shakes
 * this module away (`check:runtime-bytes`).
 *
 * Pure and Svelte-free: the gate runs it in Node.
 */

import type {
	CharacterAbilityButton,
	CharacterAction,
	CharacterSheet,
	CharacterStill,
	CharacterTrigger,
} from 'game-config';

import {
	CLIP_FACING8_DEADBAND,
	CLIP_FACING_DEADBAND,
	CLIP_FACINGS,
	CLIP_HAND,
	CLIP_MIRROR,
	CLIP_MOVING_HOLD_MS,
	CLIP_ONE_SHOT_MS,
	CLIP_STATE_FALLBACK,
	CLIP_STILL_SPEED,
	CLIP_TURN_MS,
	CLIP_VERTICAL,
	clipFacing8Of,
	clipFacingOf,
	clipMirrorOf,
	projectedVelocity,
	screenFlattening,
	type CharacterClipFrame,
	type CharacterClipSource,
	type ClipDiagonal,
	type ClipFacing,
} from './characterClips';
import {
	facingHeading,
	facingOfHeading,
	headingOf,
	headingWithin,
	blendWeight,
	leanOf,
	sheetTurnOf,
	turnTowards,
	type SheetTurn,
} from './characterTurn';
import { CHARACTER_CLIP_EVENTS, type CharacterClips } from './types';

/** The two facings of a side view. */
export type ClipSide = 'e' | 'w';

/** The four facings of a top-down view of four, clockwise from north. */
export const CLIP_STRAIGHTS = ['n', 'e', 's', 'w'] as const;
export type ClipStraight = (typeof CLIP_STRAIGHTS)[number];

const SIDES: readonly ClipFacing[] = ['e', 'w'];
const DIAGONALS: readonly ClipFacing[] = ['ne', 'se', 'sw', 'nw'];

const isDiagonal = (facing: ClipFacing): facing is ClipDiagonal => facing.length === 2;

/**
 * The facing of a side view: `e` or `w`, by the sign of the drawn sideways velocity. Standing
 * still keeps `previous`, and so does a direction within `CLIP_FACING_DEADBAND` of straight up or
 * down (as a share of its length): a straight jump does not flick it.
 */
export function clipFacingSideOf(dx: number, dy: number, previous: ClipSide): ClipSide {
	const length = Math.hypot(dx, dy);
	if (length < 1e-3) return previous;
	return Math.abs(dx) > CLIP_FACING_DEADBAND * length ? (dx < 0 ? 'w' : 'e') : previous;
}

const QUARTER = Math.PI / 2;

/** How many times flatter than wide the 2:1 isometric screen draws the ground (a view drawn with
 *  no projection of its own is drawn on it, as `projectedVelocity` has it). */
const ISO_FLATTENING = 2;

/**
 * The facing, of the four straight ones, of a direction on a flat screen: the nearest, 90° apart.
 * Standing still keeps `previous`, and so does a direction within `CLIP_FACING8_DEADBAND` (7.5°)
 * of its sector's edge, as {@link clipFacing8Of} has it.
 */
export function clipFacing4Of(dx: number, dy: number, previous: ClipStraight): ClipStraight {
	if (Math.hypot(dx, dy) < 1e-3) return previous;
	// Clockwise from north: the screen's y runs down.
	const turn = Math.atan2(dx, -dy);
	const from = turn - CLIP_STRAIGHTS.indexOf(previous) * QUARTER;
	const off = Math.abs(Math.atan2(Math.sin(from), Math.cos(from)));
	if (off <= QUARTER / 2 + CLIP_FACING8_DEADBAND) return previous;
	return CLIP_STRAIGHTS[(Math.round(turn / QUARTER) + 4) % 4];
}

/** A sheet's view as the resolver reads it. */
type View = {
	kind: 'side' | 'topDown' | 'isometric';
	eight: boolean;
	mirror: boolean;
	facings: readonly ClipFacing[];
	/** Its smooth turn (`characterTurn.ts`), if the sheet has one. */
	turn?: SheetTurn;
};

/** A sheet with no view is seen as every character was before the sheet: isometric, in the four
 *  diagonals. A `3d` view has no facing, so no clip. */
function viewOf(sheet: CharacterSheet): View | undefined {
	const { view } = sheet;
	if (!view) return { kind: 'isometric', eight: false, mirror: true, facings: DIAGONALS };
	if (view.kind === '3d') return undefined;
	const mirror = view.mirror !== false;
	if (view.kind === 'side') return { kind: 'side', eight: false, mirror, facings: SIDES };
	const eight = view.facings === 8;
	const four = view.kind === 'topDown' ? CLIP_STRAIGHTS : DIAGONALS;
	const turn = sheetTurnOf(view);
	return {
		kind: view.kind,
		eight,
		mirror,
		facings: eight ? CLIP_FACINGS : four,
		...(turn ? { turn } : {}),
	};
}

const startOf = (view: View): ClipFacing =>
	view.kind === 'side' ? 'e' : view.kind === 'topDown' ? 's' : 'se';

/** The facings a sheet's view has, clockwise from north; none for a `3d` view. */
export const sheetFacings = (sheet: CharacterSheet): readonly ClipFacing[] =>
	viewOf(sheet)?.facings ?? [];

/** Whether a sheet's character turns smoothly (`view.turn`): its frames then carry a `lean`. */
export const sheetTurns = (sheet: CharacterSheet | undefined): boolean =>
	!!sheet && viewOf(sheet)?.turn !== undefined;

/**
 * The facing a character of this sheet starts in: `se` isometric (as every character did before
 * the sheet), `e` in a side view, `s` (towards the viewer) top-down.
 */
export function sheetStartFacing(sheet: CharacterSheet): ClipFacing {
	const view = viewOf(sheet);
	return view ? startOf(view) : 'se';
}

const triggersOf = (action: CharacterAction): CharacterTrigger[] =>
	action.when === undefined ? [] : Array.isArray(action.when) ? action.when : [action.when];

const startsOnce = (trigger: CharacterTrigger): boolean =>
	'ability' in trigger || 'event' in trigger;

/** An action's priority: its own, else the highest of its triggers' (3 for an ability or an
 *  event, 2 for a status, 1 for a motion). */
const priorityOf = (action: CharacterAction): number =>
	action.priority ??
	triggersOf(action).reduce(
		(highest, trigger) => Math.max(highest, startsOnce(trigger) ? 3 : 'status' in trigger ? 2 : 1),
		0,
	);

/** Whether an action loops while a motion or a status trigger of its holds: its own `play`, else
 *  only when no ability and no event is among its triggers. */
const loops = (action: CharacterAction): boolean =>
	action.play === undefined ? !triggersOf(action).some(startsOnce) : action.play === 'loop';

/** Whether an action is drawn while a motion or a status trigger of its holds: it loops, or it is
 *  held (played once, then its last frame). */
const inForce = (action: CharacterAction): boolean => loops(action) || action.play === 'hold';

/** A sheet as the resolver reads it. */
type Reading = {
	view: View;
	/** The clips' prefix; empty for still images and for a rig, which find nothing by it. */
	prefix: string;
	/** Status → the prefix tried first while it holds (a rig: the skin worn), in the sheet's
	 *  order. */
	variants: [string, string][];
	/** A rig source's one rig, and its rig per facing. */
	rig?: string;
	rigs?: Partial<Record<ClipFacing, string>>;
	actions: CharacterAction[];
	byId: Map<string, CharacterAction>;
	/** Action id → itself and the actions that stand in for it, nearest first. */
	chains: Map<string, CharacterAction[]>;
};

/** A sheet drawn through clips (`rig` false: frame clips with a prefix, or still images) or as a
 *  rig (`rig` true: a rig source that names a rig). */
function readSheet(sheet: CharacterSheet | undefined, rig = false): Reading | undefined {
	const source = sheet?.source;
	if (!sheet || !source) return undefined;
	if (rig) {
		if (source.kind !== 'rig' || (!source.rig && !Object.keys(source.rigs ?? {}).length))
			return undefined;
	} else if (source.kind === 'clips' ? !source.prefix : source.kind !== 'stills') return undefined;
	if (!sheet.draw || !(sheet.draw.width > 0) || !sheet.actions?.length) return undefined;
	const view = viewOf(sheet);
	if (!view) return undefined;
	const byId = new Map<string, CharacterAction>();
	for (const action of sheet.actions) if (!byId.has(action.id)) byId.set(action.id, action);
	return {
		view,
		prefix: source.kind === 'clips' ? source.prefix : '',
		variants: source.kind === 'stills' ? [] : Object.entries(source.variants ?? {}),
		...(source.kind === 'rig' ? { rig: source.rig, rigs: source.rigs } : {}),
		actions: [...byId.values()],
		byId,
		chains: new Map(),
	};
}

/**
 * Whether a sheet is drawn through clips: its source is frame clips or still images (a still is
 * drawn as a clip of one frame, {@link sheetStillClips}), it has a positive draw width and an
 * action, and its view has facings (not `3d`). A sheet that is neither this nor
 * {@link sheetPlaysRig} is drawn as a character with no sheet.
 */
export const sheetPlaysClips = (sheet: CharacterSheet | undefined): sheet is CharacterSheet =>
	readSheet(sheet) !== undefined;

/** Whether a sheet is drawn as a rig: its source is a rig that names one, it has a positive draw
 *  width and an action, and its view has facings. */
export const sheetPlaysRig = (sheet: CharacterSheet | undefined): sheet is CharacterSheet =>
	readSheet(sheet, true) !== undefined;

/**
 * The id a still image is registered under as a clip of one frame. No Flipbook clip can have it:
 * a clip's id has no colon.
 */
export const sheetStillClipId = (still: CharacterStill): string =>
	`still::${still.assetKey}::${still.region}`;

/**
 * The still images of a sheet drawn through clips, each as the clip of one frame the clip channel
 * draws it by (a Flipbook registry entry: whoever draws the sheet registers them before its first
 * frame). Played once, a still is held for `CLIP_ONE_SHOT_MS` (1 fps). None for a rig.
 */
export function sheetStillClips(sheet: CharacterSheet | undefined): {
	id: string;
	name: string;
	assetKey: string;
	frames: string[];
	fps: number;
	loop: boolean;
}[] {
	const reading = readSheet(sheet);
	const clips = new Map<string, CharacterStill>();
	for (const action of reading?.actions ?? [])
		for (const cell of Object.values(action.anim ?? {}))
			if (cell.still) clips.set(sheetStillClipId(cell.still), cell.still);
	return [...clips].map(([id, { assetKey, region }]) => ({
		id,
		name: region,
		assetKey,
		frames: [region],
		fps: 1,
		loop: false,
	}));
}

/**
 * An action and the actions drawn in its place, nearest first: its `fallback` is followed until
 * an action repeats or names none, so each action is tried once and a loop of fallbacks ends.
 * (`characterClips.ts` follows four states; no chain of `CLIP_STATE_FALLBACK` is longer before it
 * repeats, so the two agree on every block.)
 */
function chainOf(reading: Reading, actionId: string): CharacterAction[] {
	const known = reading.chains.get(actionId);
	if (known) return known;
	const chain: CharacterAction[] = [];
	let action = reading.byId.get(actionId);
	while (action && !chain.includes(action)) {
		chain.push(action);
		action = action.fallback === undefined ? undefined : reading.byId.get(action.fallback);
	}
	reading.chains.set(actionId, chain);
	return chain;
}

/** A clip tried for a facing: the facing it was made in, and whether it is drawn mirrored. */
type StandIn = readonly [facing: ClipFacing, flipX: boolean];

/** How far towards the viewer (south) and towards the east a facing looks, −2 to 2, by its place
 *  in `CLIP_FACINGS`. */
const southOf = (index: number) => 2 - Math.abs(4 - index);
const eastOf = (index: number) => southOf((index + 2) % 8);

/**
 * The clips tried for `facing`, nearest first (the order of `characterClips.ts`
 * `resolveCharacterClip`, which the gate holds this equal to):
 *
 * - isometric, four: itself, its mirror twin mirrored, its vertical twin, that twin's mirror;
 * - side: itself, then the other side mirrored;
 * - eight facings, and top-down four: the facings seen outward by angle (itself, 45° either side,
 *   and so on to its opposite), each as made before its mirror twin's clip mirrored. Of two as
 *   near, the one `prefer`red (the facing last seen) comes first, else the one looking more
 *   towards the viewer, else the eastern. A top-down view of four tries only its four.
 *
 * A view with `mirror: false` draws no clip mirrored: the mirrored entries are left out, and the
 * other facings of the view stand in as made (isometric four: the vertical twin, the mirror twin,
 * then the opposite).
 */
function standIns(view: View, facing: ClipFacing, prefer: ClipFacing | undefined): StandIn[] {
	if (view.kind === 'side') {
		const twin = clipMirrorOf(facing);
		return twin
			? [
					[facing, false],
					[twin, view.mirror],
				]
			: [[facing, false]];
	}
	if (view.kind === 'isometric' && !view.eight && isDiagonal(facing)) {
		const twin = CLIP_MIRROR[facing];
		const vertical = CLIP_VERTICAL[facing];
		return view.mirror
			? [
					[facing, false],
					[twin, true],
					[vertical, false],
					[CLIP_MIRROR[vertical], true],
				]
			: [
					[facing, false],
					[vertical, false],
					[twin, false],
					[CLIP_MIRROR[vertical], false],
				];
	}
	const made = view.kind === 'topDown' && !view.eight ? view.facings : CLIP_FACINGS;
	const at = CLIP_FACINGS.indexOf(facing);
	const near: StandIn[] = [];
	for (let away = 0; away <= 4; away++) {
		const a = (at + away) % 8;
		const b = (at - away + 8) % 8;
		const bFirst =
			CLIP_FACINGS[b] === prefer ||
			(CLIP_FACINGS[a] !== prefer &&
				(southOf(b) > southOf(a) || (southOf(b) === southOf(a) && eastOf(b) > eastOf(a))));
		for (const index of a === b ? [a] : bFirst ? [b, a] : [a, b]) {
			const seen = CLIP_FACINGS[index];
			if (made.includes(seen)) near.push([seen, false]);
			const twin = view.mirror ? clipMirrorOf(seen) : undefined;
			if (twin && made.includes(twin)) near.push([twin, true]);
		}
	}
	return near;
}

/** A clip found for an action. */
export type ResolvedSheetClip = {
	clipId: string;
	flipX: boolean;
	/** The action it plays: the one asked for, or one that stands in for it. */
	action: string;
	/** The status whose variant prefix it is under (`marked`: drawn as made, not tinted), if any. */
	variant: string | undefined;
	/** The facing it is seen in: its own, or its mirror twin's when drawn mirrored. */
	facing: ClipFacing;
};

/** The variant prefixes of the statuses that hold are tried first, each through the action and
 *  all its fallbacks, before the base prefix; only the base prefix reads an `anim` cell, which
 *  names a clip or a still image. With no prefix (still images) nothing is found by name. */
function resolveIn(
	reading: Reading,
	actionId: string,
	near: readonly StandIn[],
	statuses: readonly string[],
	has: (clipId: string) => boolean,
): ResolvedSheetClip | undefined {
	const chain = chainOf(reading, actionId);
	const { variants } = reading;
	for (let v = 0; v <= variants.length; v++) {
		const variant = v < variants.length ? variants[v] : undefined;
		if (variant && !statuses.includes(variant[0])) continue;
		const prefix = variant ? variant[1] : reading.prefix;
		for (const action of chain) {
			const cells = variant ? undefined : action.anim;
			for (const [clipFacing, flipX] of near) {
				const cell = cells?.[clipFacing];
				const clipId =
					cell?.clip ??
					(cell?.still
						? sheetStillClipId(cell.still)
						: prefix
							? `${prefix}_${action.id}_${clipFacing}`
							: undefined);
				if (clipId !== undefined && has(clipId))
					return {
						clipId,
						flipX,
						action: action.id,
						variant: variant?.[0],
						facing: (flipX && clipMirrorOf(clipFacing)) || clipFacing,
					};
			}
		}
	}
	return undefined;
}

/**
 * The clip `actionId` is drawn with facing `facing` while `statuses` hold, or `undefined` when
 * neither it nor any action that stands in for it has a clip in any facing (or the sheet is not
 * one this module plays, or has no such action). `has` says whether a clip id is registered.
 * `prefer` is the facing the character was last seen in ({@link standIns}).
 */
export function resolveSheetClip(
	sheet: CharacterSheet,
	actionId: string,
	facing: ClipFacing,
	statuses: readonly string[],
	has: (clipId: string) => boolean,
	prefer?: ClipFacing,
): ResolvedSheetClip | undefined {
	const reading = readSheet(sheet);
	return (
		reading && resolveIn(reading, actionId, standIns(reading.view, facing, prefer), statuses, has)
	);
}

/** What a character is doing this frame, as drawn. */
export type SheetSample = {
	atMs: number;
	/** Its drawn world velocity, px/s. */
	vx: number;
	vy: number;
	/** The statuses that hold (`holding`, `marked`, a room status' name). */
	statuses?: readonly string[];
	/** The screen's projection of a world vector. Absent ⇒ the 2:1 isometric screen for an
	 *  isometric view, and the world's own axes for a side or a top-down one. */
	project?: (x: number, y: number) => { x: number; y: number };
};

/** A moment that starts an action once: an ability used, or a rules event that names the
 *  character as its user or as its `target`. */
export type SheetSignal = { ability: CharacterAbilityButton } | { event: string; as?: 'target' };

/**
 * The picture a frame is turning FROM while a smooth turn mixes two (`view.turn`'s `blend`): the
 * frame that picture would be drawn by (its own `lean`, no blend of its own), how much of the
 * frame's own picture is drawn (`weight`, 0 to 1, `characterTurn.ts` `blendWeight`; the picture
 * left has the rest), and how long is left of the mix, ms. `pose` is whether the two may be mixed
 * as one pose (a rig's two animations, drawn the same way round, in one skin); otherwise they are
 * two pictures, cross-faded.
 */
export type SheetBlend<F> = { from: F; weight: number; leftMs: number; pose: boolean };

/** The clip to draw. `marked` is whether it is the `marked` variant's (drawn as made). `lean` is
 *  there only for a sheet that turns smoothly ({@link sheetTurns}): the rotation the clip is drawn
 *  at about its pivot ({@link sheetLeanPivot}), radians clockwise, after any mirror. `blend` is
 *  there only while such a sheet mixes two pictures. */
export type SheetClipFrame = CharacterClipFrame & {
	action: string;
	variant: string | undefined;
	lean?: number;
	blend?: SheetBlend<SheetClipFrame>;
};

export type SheetAnimator = {
	/** A moment about the character. Its action starts on the next frame, and of two between
	 *  frames the last wins; whether the sheet has an action for it. */
	raise(signal: SheetSignal): boolean;
	/** The clip of this frame, or `undefined` when the sheet has none. */
	frame(sample: SheetSample): SheetClipFrame | undefined;
	/** The action a signal starts, if the sheet has one: the first whose trigger is it. */
	actionOf(signal: SheetSignal): string | undefined;
	/** Whether `signal`'s action has a clip in some facing, without a fallback action. */
	plays(signal: SheetSignal, statuses?: readonly string[]): boolean;
	/** The action waiting to start or playing once at `atMs`, if any: a held one for as long as it
	 *  is held. */
	oneShot(atMs: number): string | undefined;
	/** The held action in force at `atMs` (`play: 'hold'`, playing or on its last frame): the one
	 *  an event or an ability started, else the one a status of `statuses` holds in force (at the
	 *  motion last drawn) when it has an animation of its own, not a fallback's. A hold only a
	 *  motion keeps in force is not answered: it is no reason to draw a player put out. */
	held(atMs: number, statuses?: readonly string[]): string | undefined;
	/** Forget the one-shot, the hold and the turn in hand; the facing is kept. A sheet that turns
	 *  smoothly ends its sweep where it was heading. */
	reset(): void;
	/** The facing drawn. */
	readonly facing: ClipFacing;
};

const NO_STATUSES: readonly string[] = [];

const answers = (trigger: CharacterTrigger, signal: SheetSignal): boolean =>
	'ability' in signal
		? 'ability' in trigger && trigger.ability === signal.ability
		: 'event' in trigger &&
			trigger.event === signal.event &&
			(trigger.as === 'target') === (signal.as === 'target');

/** What every source's answer says: the action drawn, mirrored or not, in which facing. */
type Found = { flipX: boolean; action: string; variant: string | undefined; facing: ClipFacing };

/** What a frame of either source carries of a smooth turn. */
type Turned<F> = { lean?: number; blend?: SheetBlend<F> };

/** A sheet's animator, whatever it draws: `F` is its frame. */
type Animator<F> = {
	/** A moment about the character. Its action starts on the next frame, and of two between
	 *  frames the last wins; whether the sheet has an action for it. */
	raise(signal: SheetSignal): boolean;
	/** What is drawn this frame, or `undefined` when the sheet has nothing for it. */
	frame(sample: SheetSample): F | undefined;
	/** The action a signal starts, if the sheet has one: the first whose trigger is it. */
	actionOf(signal: SheetSignal): string | undefined;
	/** Whether `signal`'s action has an animation in some facing, without a fallback action. */
	plays(signal: SheetSignal, statuses?: readonly string[]): boolean;
	/** The action waiting to start or playing once at `atMs`, if any: a held one for as long as it
	 *  is held. */
	oneShot(atMs: number): string | undefined;
	/** The held action in force at `atMs` (`play: 'hold'`, playing or on its last frame): the one
	 *  an event or an ability started, else the one a status of `statuses` holds in force (at the
	 *  motion last drawn) when it has an animation of its own, not a fallback's. A hold only a
	 *  motion keeps in force is not answered: it is no reason to draw a player put out. */
	held(atMs: number, statuses?: readonly string[]): string | undefined;
	/** Forget the one-shot, the hold and the turn in hand; the facing is kept. A sheet that turns
	 *  smoothly ends its sweep where it was heading. */
	reset(): void;
	/** The facing drawn. */
	readonly facing: ClipFacing;
};

/**
 * Stages 1 and 2 of the resolver, for every source: the facing, the loop and the action playing
 * once. `resolve` is the source's adapter (stage 3), `lengthMs` how long what it found plays once
 * (absent ⇒ `CLIP_ONE_SHOT_MS`), `frameOf` the frame it is drawn by.
 *
 * THE SMOOTH TURN (`view.turn`, `characterTurn.ts`). The facing rule above is not changed and no
 * second one is added: what it answers (dead bands and turn hold included) is the facing the
 * character is AIMED at, exactly the facing a sheet without the option draws. While the direction
 * it moves in is that facing's by the rule, its heading is aimed at too, held inside the facing's
 * sector; while a turn is in hand, the aim waits as the facing does. The DRAWN heading follows the
 * aim at the sheet's speed, the picture is the facing whose sector the drawn heading is in, and
 * the frame's `lean` is the drawn heading's distance from the middle of the facing its picture is
 * SEEN in (a stand-in's own, a one-shot's the one it started in), at most the sheet's lean, eased
 * back to none as the heading goes from that facing's sector to its opposite. So a
 * picture changes on the very edge of two sectors, where both lean the same way to the same
 * direction, and a heading that sits on an edge changes nothing: the aim crosses it only when the
 * rule turns the facing.
 *
 * THE BLEND (`turn.blend`). When the picture a LOOP is drawn by changes with the facing (the same
 * action, another facing drawn, another picture: `pictureOf`; and a pair the look can mix:
 * `mixes`), the frame carries the picture it left and a weight that
 * goes from 0 to 1 over the blend's time ({@link SheetBlend}); the look mixes the two. A blend
 * turned back before it ends goes back from the weight it had. While one is in hand the drawn
 * heading waits at the edge of the next sector, so every step of a sweep is blended whole and
 * never more than two pictures are mixed. An action played once, a hold and a change of action
 * are not blended: they keep, or change, their picture as before.
 */
function createAnimator<R extends Found, F extends Turned<F>>(
	reading: Reading | undefined,
	facing: ClipFacing | undefined,
	resolve: (
		reading: Reading,
		actionId: string,
		near: readonly StandIn[],
		statuses: readonly string[],
	) => R | undefined,
	lengthMs: (found: R) => number | undefined,
	frameOf: (found: R, loop: boolean, play: number) => F,
	pictureOf: (found: R) => string,
	mixes: (from: R, to: R) => 'pose' | 'fade' | undefined,
): Animator<F> {
	const view = reading?.view;
	const actions = reading?.actions ?? [];
	let at: ClipFacing =
		facing !== undefined && view?.facings.includes(facing)
			? facing
			: view
				? startOf(view)
				: (facing ?? 'se');
	const looping = actions
		.map((action) => ({
			action,
			priority: priorityOf(action),
			when: triggersOf(action).filter((trigger) => !startsOnce(trigger)),
		}))
		.filter((row) => row.when.length > 0 && inForce(row.action))
		.sort((a, b) => b.priority - a.priority);
	const rowOf = (motion: 'moving' | 'still', statuses: readonly string[]) =>
		looping.find(({ when }) =>
			when.some((trigger) =>
				'motion' in trigger
					? trigger.motion === motion
					: 'status' in trigger && statuses.includes(trigger.status),
			),
		);
	const starts = actions.flatMap((action) =>
		triggersOf(action)
			.filter(startsOnce)
			.map((trigger) => ({ trigger, action })),
	);
	const startedBy = (signal: SheetSignal): CharacterAction | undefined =>
		starts.find((start) => answers(start.trigger, signal))?.action;
	const turn = view?.turn;
	/** The facing drawn: `at`, but for a sheet that turns smoothly, whose drawn heading says. */
	let shown = at;
	/** A smooth turn's heading aimed at, its drawn heading, when that was last moved on and the
	 *  screen's flattening of the ground. */
	let aimed = facingHeading(at);
	let heading = aimed;
	let sweptAt: number | undefined;
	let flattening = 1;
	const orders: (StandIn[] | undefined)[] = [];
	const near = (prefer: ClipFacing | undefined): StandIn[] => {
		if (!view) return [];
		const key = CLIP_FACINGS.indexOf(shown) * 9 + (prefer ? CLIP_FACINGS.indexOf(prefer) + 1 : 0);
		return (orders[key] ??= standIns(view, shown, prefer));
	};
	let lastMovedAt = -Infinity;
	let turning: { to: ClipFacing; since: number } | undefined;
	let pending: CharacterAction | undefined;
	/** The action playing once; `until` is Infinity once a held one has played. */
	let oneShot: { found: R; play: number; asked: CharacterAction; until: number } | undefined;
	/** The held action a motion or a status trigger has in force, as it started. */
	let standing: { found: R; play: number; asked: CharacterAction } | undefined;
	let motion: 'moving' | 'still' = 'still';
	let plays = 0;
	/** The facing its loop was last seen in: of two stand-ins as near, it is kept. */
	let seen: ClipFacing | undefined;
	/** The loop of the last frame, if a loop was what it drew, and the facing it was drawn for. */
	let looped: { found: R; shown: ClipFacing } | undefined;
	/** A blend in hand: the picture left and the facing it was drawn for, and the share of its
	 *  time that had gone (`lead`) at `since`. */
	let fade: { from: R; left: ClipFacing; since: number; lead: number } | undefined;
	const progressOf = (atMs: number): number =>
		fade && turn && turn.blend > 0
			? Math.min(fade.lead + Math.max(atMs - fade.since, 0) / turn.blend, 1)
			: 1;

	const turned = (vx: number, vy: number, project: SheetSample['project']): ClipFacing => {
		if (!view) return at;
		const on = project?.(vx, vy);
		if (view.kind === 'isometric') {
			const { dx, dy } = on ? { dx: on.x, dy: on.y } : projectedVelocity(vx, vy);
			return view.eight
				? clipFacing8Of(dx, dy, at, project ? screenFlattening(project) : undefined)
				: clipFacingOf(dx, dy, isDiagonal(at) ? at : 'se');
		}
		const dx = on ? on.x : vx;
		const dy = on ? on.y : vy;
		if (view.kind === 'side') return clipFacingSideOf(dx, dy, at === 'w' ? 'w' : 'e');
		return view.eight
			? clipFacing8Of(dx, dy, at, 1)
			: clipFacing4Of(dx, dy, isDiagonal(at) ? 's' : at);
	};

	/** Where a smooth turn is aimed while the character moves in the direction of its facing. */
	const aim = (vx: number, vy: number, project: SheetSample['project']): void => {
		if (!view || !turn) return;
		const on = project?.(vx, vy);
		const { dx, dy } =
			view.kind === 'isometric'
				? on
					? { dx: on.x, dy: on.y }
					: projectedVelocity(vx, vy)
				: { dx: on ? on.x : vx, dy: on ? on.y : vy };
		aimed = headingWithin(headingOf(dx, dy, flattening), at, turn.sector);
	};

	/** Move a smooth turn's drawn heading on to `atMs`, and the facing drawn with it. */
	const sweep = (atMs: number): void => {
		if (!view || !turn) return;
		const ms = sweptAt === undefined ? 0 : Math.max(atMs - sweptAt, 0);
		sweptAt = atMs;
		const next = turn.speed > 0 ? turnTowards(heading, aimed, (turn.speed * ms) / 1000) : aimed;
		const into = facingOfHeading(next, view.facings, shown, turn.sector);
		// A blend in hand is of two pictures: the heading goes on into a third facing only once
		// it is done (back into the one it left, at any time).
		if (turn.speed > 0 && fade && into !== shown && into !== fade.left && progressOf(atMs) < 1) {
			heading = headingWithin(next, shown, turn.sector);
			return;
		}
		heading = next;
		shown = into;
	};

	const leaned = (found: R, loop: boolean, play: number): F => {
		const frame = frameOf(found, loop, play);
		if (turn) frame.lean = leanOf(heading, found.facing, turn.lean, flattening, turn.sector);
		return frame;
	};

	/** A frame that is not a loop's: it ends any blend. */
	const drawnAs = (found: R, loop: boolean, play: number): F => {
		looped = undefined;
		fade = undefined;
		return leaned(found, loop, play);
	};

	/** A loop's frame: blended from the picture it has just left, if the sheet blends. */
	const drawnLoop = (found: R, atMs: number): F => {
		const frame = leaned(found, true, 0);
		if (!turn || !(turn.blend > 0)) return frame;
		const picture = pictureOf(found);
		const last = looped;
		looped = { found, shown };
		if (last && last.found.action !== found.action) fade = undefined;
		else if (last && last.shown !== shown && pictureOf(last.found) !== picture)
			fade = mixes(last.found, found)
				? {
						from: last.found,
						left: last.shown,
						since: atMs,
						lead: fade && pictureOf(fade.from) === picture ? 1 - progressOf(atMs) : 0,
					}
				: undefined;
		if (!fade) return frame;
		const progress = progressOf(atMs);
		if (progress >= 1) {
			fade = undefined;
			return frame;
		}
		frame.blend = {
			from: leaned(fade.from, true, 0),
			weight: blendWeight(progress),
			leftMs: (1 - progress) * turn.blend,
			pose: mixes(fade.from, found) === 'pose',
		};
		return frame;
	};

	/** Whether `asked` may start while `playing` plays. */
	const cuts = (playing: CharacterAction, asked: CharacterAction): boolean => {
		if (asked === playing) return asked.again !== 'ignore';
		if (playing.interrupt === 'none') return false;
		return playing.interrupt !== 'priority' || priorityOf(asked) >= priorityOf(playing);
	};

	return {
		get facing() {
			return shown;
		},
		raise(signal) {
			const action = startedBy(signal);
			if (!action) return false;
			pending = action;
			return true;
		},
		actionOf(signal) {
			return startedBy(signal)?.id;
		},
		plays(signal, statuses = NO_STATUSES) {
			const action = startedBy(signal);
			if (!reading || !view || !action) return false;
			// From the view's first facing every facing is tried, the action's own first.
			const order = standIns(view, startOf(view), undefined);
			return resolve(reading, action.id, order, statuses)?.action === action.id;
		},
		oneShot(atMs) {
			return pending?.id ?? (oneShot && atMs < oneShot.until ? oneShot.found.action : undefined);
		},
		held(atMs, statuses = NO_STATUSES) {
			if (oneShot && atMs < oneShot.until && oneShot.asked.play === 'hold')
				return oneShot.found.action;
			const row = rowOf(motion, statuses);
			if (!reading || row?.action.play !== 'hold') return undefined;
			if (!row.when.some((t) => 'status' in t && statuses.includes(t.status))) return undefined;
			if (standing?.asked === row.action) return standing.found.action;
			const found = resolve(reading, row.action.id, near(seen), statuses);
			return found?.action === row.action.id ? found.action : undefined;
		},
		reset() {
			pending = undefined;
			oneShot = undefined;
			standing = undefined;
			turning = undefined;
			looped = undefined;
			fade = undefined;
			if (view && turn) {
				heading = aimed;
				sweptAt = undefined;
				shown = facingOfHeading(heading, view.facings, shown, turn.sector);
			}
		},
		frame({ atMs, vx, vy, statuses = NO_STATUSES, project }) {
			if (!reading) return undefined;
			if (turn && view?.kind === 'isometric')
				flattening = project ? screenFlattening(project) : ISO_FLATTENING;
			if (Math.hypot(vx, vy) > CLIP_STILL_SPEED) {
				const to = turned(vx, vy, project);
				if (to === at) turning = undefined;
				else if (turning?.to !== to) turning = { to, since: atMs };
				else if (atMs - turning.since >= CLIP_TURN_MS) {
					at = to;
					turning = undefined;
				}
				if (to === at) aim(vx, vy, project);
				lastMovedAt = atMs;
			} else turning = undefined;
			if (turn) sweep(atMs);
			else shown = at;
			motion = atMs - lastMovedAt <= CLIP_MOVING_HOLD_MS ? 'moving' : 'still';
			const row = rowOf(motion, statuses);
			const held = row?.action.play === 'hold';
			if (!held || standing?.asked !== row.action) standing = undefined;
			const loop =
				standing?.found ?? (row && resolve(reading, row.action.id, near(seen), statuses));
			if (loop) seen = loop.facing;
			if (pending) {
				const asked = pending;
				pending = undefined;
				const playing = oneShot && atMs < oneShot.until ? oneShot.asked : undefined;
				const next =
					!playing || cuts(playing, asked)
						? resolve(reading, asked.id, near(seen), statuses)
						: undefined;
				// One that falls back to the loop already playing would only restart it.
				if (next && next.action !== loop?.action) {
					plays += 1;
					oneShot = {
						found: next,
						play: plays,
						asked,
						until: asked.play === 'hold' ? Infinity : atMs + (lengthMs(next) ?? CLIP_ONE_SHOT_MS),
					};
				}
			}
			if (oneShot && atMs < oneShot.until) {
				standing = undefined;
				return drawnAs(oneShot.found, false, oneShot.play);
			}
			oneShot = undefined;
			if (held && loop && !standing) {
				plays += 1;
				standing = { found: loop, play: plays, asked: row.action };
			}
			if (standing) return drawnAs(standing.found, false, standing.play);
			if (loop) return drawnLoop(loop, atMs);
			looped = undefined;
			fade = undefined;
			return undefined;
		},
	};
}

/**
 * A character's clips, frame to frame, from its sheet: its facing, its loop and the action it is
 * playing once.
 *
 * THE LOOP: of the actions that loop and have a motion or a status trigger holding this frame,
 * the highest priority, and of two as high the first in the sheet. `moving` holds for
 * `CLIP_MOVING_HOLD_MS` after the character last moved faster than `CLIP_STILL_SPEED`.
 *
 * ONCE: an ability or an event plays the first action it is a trigger of, once, whatever that
 * action's `play` (a moment cannot loop); a motion or a status never starts an action whose
 * `play` is `once`. It starts on the frame after the signal, keeps the facing it started in, plays
 * for its clip's length (else `CLIP_ONE_SHOT_MS`) and then the loop resumes. One that resolves,
 * through its fallbacks, to the action the loop is drawing does not start. While one plays,
 * another may cut it by the playing action's `interrupt`, and the same one starts again unless its
 * `again` is `ignore`.
 *
 * HOLD (`play: 'hold'`): the clip is handed on unlooped, so it plays once and stays on its last
 * frame, in the facing it started in. Started by an ability or an event, it is a once that never
 * ends by itself: only another once its `interrupt` lets cut it, the same one again, or `reset`
 * ends it (a loop never does). Started by a motion or a status trigger, it is that trigger's loop
 * in the choice above, drawn once and then on its last frame while it stays the loop in force; a
 * once played over it starts it again when the once ends.
 *
 * A sheet this module does not draw through clips ({@link sheetPlaysClips}) gives no clip.
 */
export function createSheetAnimator(
	sheet: CharacterSheet,
	clips: CharacterClipSource,
	facing?: ClipFacing,
): SheetAnimator {
	const has = (clipId: string) => clips.has(clipId);
	return createAnimator(
		readSheet(sheet),
		facing,
		(reading, actionId, near, statuses) => resolveIn(reading, actionId, near, statuses, has),
		(found) => clips.cycleMs(found.clipId),
		(found, loop, play): SheetClipFrame => ({
			clipId: found.clipId,
			flipX: found.flipX,
			loop,
			play,
			marked: found.variant === 'marked',
			action: found.action,
			variant: found.variant,
		}),
		(found) => `${found.clipId}|${found.flipX}`,
		() => 'fade',
	);
}

/** What a rig source is asked: whether a rig has an animation (`false` for a rig not loaded),
 *  how long it is, and whether it has a skin (absent ⇒ every skin named is worn). */
export type SheetRigSource = {
	has(rig: string, animation: string): boolean;
	durationMs(rig: string, animation: string): number | undefined;
	hasSkin?(rig: string, skin: string): boolean;
};

/** A rig animation found for an action. */
export type ResolvedSheetRig = Found & {
	rig: string;
	animation: string;
	/** The skin worn: the first variant whose status holds and that the rig has. */
	skin: string | undefined;
};

/** The facings that look west: with one rig, an animation named for the action alone is drawn
 *  mirrored in them. */
const looksWest = (facing: ClipFacing): boolean =>
	facing === 'w' || facing === 'sw' || facing === 'nw';

/**
 * A rig source's adapter. For the action, then each action that stands in for it, the facings are
 * tried as a clip's are (`near`: itself, its mirror twin mirrored, the nearest outward). In a
 * facing, the rig is the cell's, else the facing's own (`rigs`), else the one rig; the animation
 * is the cell's, else the one named `<action>_<facing>`, else, on a facing's own rig, the one
 * named `<action>`. When no facing has one, the one rig's `<action>` is drawn in the facing asked,
 * mirrored when it looks west (unless the view's `mirror` is `false`).
 */
function resolveRigIn(
	reading: Reading,
	actionId: string,
	near: readonly StandIn[],
	statuses: readonly string[],
	rigs: SheetRigSource,
): ResolvedSheetRig | undefined {
	const found = (
		rig: string,
		animation: string,
		action: string,
		facing: ClipFacing,
		flipX: boolean,
	): ResolvedSheetRig => {
		const worn = reading.variants.find(
			([status, skin]) => statuses.includes(status) && (rigs.hasSkin?.(rig, skin) ?? true),
		);
		return { rig, animation, action, facing, flipX, variant: worn?.[0], skin: worn?.[1] };
	};
	for (const action of chainOf(reading, actionId)) {
		for (const [rigFacing, flipX] of near) {
			const cell = action.anim?.[rigFacing];
			const own = reading.rigs?.[rigFacing];
			const rig = (cell?.anim !== undefined && cell.rig) || own || reading.rig;
			if (!rig) continue;
			const names =
				cell?.anim !== undefined
					? [cell.anim]
					: own
						? [`${action.id}_${rigFacing}`, action.id]
						: [`${action.id}_${rigFacing}`];
			const animation = names.find((name) => rigs.has(rig, name));
			if (animation !== undefined)
				return found(
					rig,
					animation,
					action.id,
					(flipX && clipMirrorOf(rigFacing)) || rigFacing,
					flipX,
				);
		}
		const asked = near[0]?.[0];
		if (reading.rig && asked && rigs.has(reading.rig, action.id))
			return found(
				reading.rig,
				action.id,
				action.id,
				asked,
				reading.view.mirror && looksWest(asked),
			);
	}
	return undefined;
}

/**
 * The rig animation `actionId` is drawn with facing `facing` while `statuses` hold, or
 * `undefined` when neither it nor any action that stands in for it has one (or the sheet is not
 * drawn as a rig, {@link sheetPlaysRig}). `prefer` is as {@link resolveSheetClip}'s.
 */
export function resolveSheetRig(
	sheet: CharacterSheet,
	actionId: string,
	facing: ClipFacing,
	statuses: readonly string[],
	rigs: SheetRigSource,
	prefer?: ClipFacing,
): ResolvedSheetRig | undefined {
	const reading = readSheet(sheet, true);
	return (
		reading &&
		resolveRigIn(reading, actionId, standIns(reading.view, facing, prefer), statuses, rigs)
	);
}

/** The rig animation to draw: `play` changes when an action starts once (so a repeat plays
 *  again). */
export type SheetRigFrame = {
	rig: string;
	animation: string;
	skin: string | undefined;
	flipX: boolean;
	loop: boolean;
	play: number;
	action: string;
	variant: string | undefined;
	/** As a clip frame's ({@link SheetClipFrame}): only for a sheet that turns smoothly. */
	lean?: number;
	blend?: SheetBlend<SheetRigFrame>;
};

export type SheetRigAnimator = Animator<SheetRigFrame>;

/**
 * A character's rig animations, frame to frame, from its sheet: the loop, the action playing once
 * and the facing of {@link createSheetAnimator}, through the rig adapter ({@link resolveSheetRig}).
 * An action played once lasts its animation's length (`CLIP_ONE_SHOT_MS` for one of no length);
 * a held one stays on its last pose. A rig not loaded yet has no animation, so nothing is drawn
 * until it is. A sheet not drawn as a rig gives no frame.
 */
export function createSheetRigAnimator(
	sheet: CharacterSheet,
	rigs: SheetRigSource,
	facing?: ClipFacing,
): SheetRigAnimator {
	return createAnimator(
		readSheet(sheet, true),
		facing,
		(reading, actionId, near, statuses) => resolveRigIn(reading, actionId, near, statuses, rigs),
		// An animation of no length (a pose of one key) is held as one with no length known.
		(found) => rigs.durationMs(found.rig, found.animation) || undefined,
		(found, loop, play): SheetRigFrame => ({
			rig: found.rig,
			animation: found.animation,
			skin: found.skin,
			flipX: found.flipX,
			loop,
			play,
			action: found.action,
			variant: found.variant,
		}),
		(found) => `${found.rig}|${found.animation}|${found.flipX}|${found.skin ?? ''}`,
		// One rig drawn the same way round in one skin has one skeleton to pose; its mirrored twin
		// is another picture; another rig is another look's, and the two are not mixed.
		(from, to) =>
			from.rig !== to.rig
				? undefined
				: from.flipX === to.flipX && from.skin === to.skin
					? 'pose'
					: 'fade',
	);
}

/**
 * Whom a room signal is about, and what it raises on each one's sheet: an `ability` is its
 * button's, on the player that used it; any other event names its user (`player`, or `by`) and
 * its `target`, each of which is told it in its own role. `payload` is the signal's as the Flow
 * gets it (`engine-mechanics` `flowSignalsOf`).
 */
export function sheetSignalsOf(
	name: string,
	payload: Readonly<Record<string, unknown>>,
): { id: string; signal: SheetSignal }[] {
	const user = payload.player ?? payload.by;
	if (name === 'ability') {
		const { button } = payload;
		return typeof user === 'string' && (button === 'ability1' || button === 'ability2')
			? [{ id: user, signal: { ability: button } }]
			: [];
	}
	const out: { id: string; signal: SheetSignal }[] = [];
	if (typeof user === 'string') out.push({ id: user, signal: { event: name } });
	if (typeof payload.target === 'string')
		out.push({ id: payload.target, signal: { event: name, as: 'target' } });
	return out;
}

/**
 * How far above the character's place the point is that its lean turns it about, px as drawn: the
 * middle of its box (the `middle` {@link sheetClipPoints} answers), or 0 for a sheet whose turn
 * names its feet. `box` is the clip's, or the rig's.
 */
export function sheetLeanPivot(sheet: CharacterSheet, box: { w: number; h: number }): number {
	const { view } = sheet;
	if (!view || (view.kind !== 'topDown' && view.kind !== 'isometric')) return 0;
	if (!view.turn || view.turn.pivot === 'feet') return 0;
	return sheetClipPoints(sheet, box, false).middle;
}

/** How wide a sheet's clips are drawn and where their feet are down the box (absent ⇒ 1). */
export const sheetDraw = (sheet: CharacterSheet): { width: number; anchorY: number } => ({
	width: sheet.draw?.width ?? 0,
	anchorY: sheet.draw?.feet ?? 1,
});

const pointAt = (
	sheet: CharacterSheet,
	point: { x: number; y: number },
	box: { w: number; h: number },
	flipX: boolean,
): { dx: number; lift: number } => {
	const { width, anchorY } = sheetDraw(sheet);
	const across = (point.x - 0.5) * width;
	return { dx: flipX ? -across : across, lift: ((anchorY - point.y) * width * box.h) / box.w };
};

/**
 * A named point of a character drawn by a clip, from its place (its feet) in px as drawn: `dx`
 * right of the place and `lift` above it. `box` is the clip's (`clipBox`), drawn the sheet's
 * width wide with its feet at the sheet's `feet`; a clip drawn mirrored (`flipX`) has the point
 * on the other side. `undefined` for a point the sheet does not name.
 */
export function sheetPoint(
	sheet: CharacterSheet,
	name: string,
	box: { w: number; h: number },
	flipX: boolean,
): { dx: number; lift: number } | undefined {
	const points = sheet.draw?.points;
	return points && Object.hasOwn(points, name)
		? pointAt(sheet, points[name], box, flipX)
		: undefined;
}

/**
 * The points of a character drawn by a clip of its sheet, as `clipPoints` gives a block's: its
 * `hand` (a line it holds starts there; `CLIP_HAND` when the sheet names none) and its `middle`
 * (how far above its place).
 */
export function sheetClipPoints(
	sheet: CharacterSheet,
	box: { w: number; h: number },
	flipX: boolean,
): { hand: { dx: number; lift: number }; middle: number } {
	const { width, anchorY } = sheetDraw(sheet);
	return {
		hand: pointAt(sheet, sheet.draw?.points?.hand ?? CLIP_HAND, box, flipX),
		middle: ((anchorY - 0.5) * width * box.h) / box.w,
	};
}

/** A rig's box in its own px, y down: the skeleton's Bounds box (the Rigger's), else its bounds
 *  as posed. */
export type RigBox = { x: number; y: number; w: number; h: number };

/**
 * How a rig is placed to be drawn by its sheet: scaled so its box is the sheet's width wide, and
 * moved so the middle of the box, at the sheet's `feet` down it, is the character's place. `x`
 * and `y` are where the rig's own origin goes, from the place, unmirrored; a rig drawn mirrored
 * is flipped about the place (`x` negated).
 */
export function sheetRigPlacement(
	sheet: CharacterSheet,
	box: RigBox,
): { scale: number; x: number; y: number } {
	const { width, anchorY } = sheetDraw(sheet);
	const scale = box.w > 0 ? width / box.w : 0;
	return {
		scale,
		x: 0 - (box.x + box.w / 2) * scale,
		y: 0 - (box.y + anchorY * box.h) * scale,
	};
}

/**
 * The points of a character drawn as a rig, as {@link sheetClipPoints} gives a clip's. A point
 * the sheet ties to a bone (`draw.bones`) is where `bone` finds it (in the rig's own px, as its
 * box is); a bone the rig lacks, and any other point, is read off the box as a clip's is.
 */
export function sheetRigPoints(
	sheet: CharacterSheet,
	box: RigBox,
	flipX: boolean,
	bone: (name: string) => { x: number; y: number } | undefined,
): { hand: { dx: number; lift: number }; middle: number } {
	const onBox = sheetClipPoints(sheet, box, flipX);
	const bones = sheet.draw?.bones;
	const at = bones && Object.hasOwn(bones, 'hand') ? bone(bones.hand) : undefined;
	if (!at) return onBox;
	const { scale, x, y } = sheetRigPlacement(sheet, box);
	const dx = at.x * scale + x;
	return { hand: { dx: flipX ? -dx : dx, lift: -(at.y * scale + y) }, middle: onBox.middle };
}

/**
 * A `characterClips` block read as a sheet: the same clips, drawn the same, through this module
 * (`scripts/check-character-sheet.mjs` holds it, cell for cell and frame for frame).
 *
 * - the view is isometric, in the block's four or eight facings;
 * - the source is its base prefix, with its `marked` prefix as the `marked` variant;
 * - the draw is its width, its feet and its hand;
 * - `idle` is the action still (and moving too, in a block with no `walk`), `walk` the action
 *   moving, `holding` the action while the status `holding` holds;
 * - an event's state is an action that event starts: `ability` answers either button, `caught`
 *   names the character as its target, and two events that name one state are one action;
 * - `CLIP_STATE_FALLBACK` is written out as each action's `fallback`, with an action nothing
 *   starts for every state only a fallback reaches.
 *
 * A state the block both loops and plays on an event keeps looping (`play: 'loop'`, at its loop's
 * priority); the event still plays it once over another loop.
 */
export function sheetOfCharacterClips(look: CharacterClips): CharacterSheet {
	const rows = new Map<string, { when: CharacterTrigger[]; loop: number; once: boolean }>();
	const rowOf = (state: string) => {
		let row = rows.get(state);
		if (!row) rows.set(state, (row = { when: [], loop: 0, once: false }));
		return row;
	};
	const looped = (state: string, trigger: CharacterTrigger, priority: number) => {
		const row = rowOf(state);
		row.when.push(trigger);
		row.loop = Math.max(row.loop, priority);
	};
	const started = (state: string, trigger: CharacterTrigger) => {
		const row = rowOf(state);
		row.when.push(trigger);
		row.once = true;
	};
	looped(look.idle, { motion: 'still' }, 1);
	looped(look.walk ?? look.idle, { motion: 'moving' }, 1);
	if (look.holding) looped(look.holding, { status: 'holding' }, 2);
	for (const event of CHARACTER_CLIP_EVENTS) {
		const state = look.on?.[event];
		if (!state) continue;
		if (event === 'ability') {
			started(state, { ability: 'ability1' });
			started(state, { ability: 'ability2' });
		} else started(state, event === 'caught' ? { event, as: 'target' } : { event });
	}
	const fallbackOf = (state: string): string | undefined =>
		Object.hasOwn(CLIP_STATE_FALLBACK, state) ? CLIP_STATE_FALLBACK[state] : undefined;
	for (const state of [...rows.keys()]) {
		let next = fallbackOf(state);
		while (next !== undefined && !rows.has(next)) {
			rowOf(next);
			next = fallbackOf(next);
		}
	}
	const actions: CharacterAction[] = [];
	for (const [id, { when, loop, once }] of rows) {
		const action: CharacterAction = { id };
		if (when.length) action.when = when.length === 1 ? when[0] : when;
		if (loop && once) {
			action.play = 'loop';
			action.priority = loop;
		}
		const fallback = fallbackOf(id);
		if (fallback !== undefined) action.fallback = fallback;
		actions.push(action);
	}
	const { marked } = look.prefixes;
	return {
		view: look.facings === 8 ? { kind: 'isometric', facings: 8 } : { kind: 'isometric' },
		source: {
			kind: 'clips',
			prefix: look.prefixes.base,
			...(marked ? { variants: { marked } } : {}),
		},
		draw: {
			width: look.displayWidth,
			...(look.anchorY !== undefined && look.anchorY !== 1 ? { feet: look.anchorY } : {}),
			...(look.hand ? { points: { hand: { x: look.hand.x, y: look.hand.y } } } : {}),
		},
		actions,
	};
}
