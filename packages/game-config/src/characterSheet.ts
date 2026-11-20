/**
 * THE CHARACTER SHEET (`docs/design/character-pipeline.md` §2, step C2a): how a character is
 * drawn, as data on its `arcade.characters` entry — its view, its animation source, its draw box
 * and its actions. An online class (`arcade.online.characters[]`) names its sheet by that entry's
 * id (`sheet`), and both must use the same component. SPARSE: a character with none of the four
 * fields has no sheet and plays as it always did, and a field at its default is not stored.
 *
 * CARRIED, NOT NORMALIZED. This package is in every runtime's bundle, and `normalizeArcade` and
 * `validateGameConfigDoc` are kept by the slot, match-3 and card bundles, which must stay the same
 * bytes (`check:runtime-bytes`). So neither learns the sheet: `normalizeGameConfigDoc` drops these
 * fields, as it drops `arcade.world3d`. Whoever needs a sheet reads it off the RAW doc with the
 * functions here, which only an arcade runtime, the launcher and the gates import. The launcher's
 * load and save put the fields back on the normalized doc ({@link withCharacterSheets}).
 */

/** The eight facings, clockwise from north as the screen draws them (`engine-layout`
 *  `CLIP_FACINGS`). */
export const CHARACTER_FACINGS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type CharacterFacing = (typeof CHARACTER_FACINGS)[number];

export const CHARACTER_VIEW_KINDS = ['side', 'topDown', 'isometric', '3d'] as const;
export type CharacterViewKind = (typeof CHARACTER_VIEW_KINDS)[number];

/**
 * How the character is seen, chosen once per character. It fixes the facing list and the facing
 * rule: `side` is `e` `w`; `topDown` is `n` `e` `s` `w`, or all eight; `isometric` is the four
 * diagonals, or all eight; `3d` has none (the body's yaw turns the model).
 */
export type CharacterView =
	| {
			kind: 'side';
			/** Its art cannot be flipped: no facing is drawn mirrored. Absent ⇒ mirrored. */
			mirror?: false;
	  }
	| {
			kind: 'topDown' | 'isometric';
			/** Absent ⇒ 4. */
			facings?: 8;
			mirror?: false;
	  }
	| { kind: '3d' };

/**
 * Where the animations come from. Only frame clips are a sheet's source so far; a character with
 * no `source` keeps its component's own state machine. A source of a kind this build does not
 * know is not read, and the character plays as one with no sheet.
 */
export type CharacterSource = {
	kind: 'clips';
	/** Its clips are named `<prefix>_<action>_<facing>`. */
	prefix: string;
	/** A second art set, tried first while the status of its key holds (`marked`: Salmons' golden
	 *  salmon), by status name. */
	variants?: Record<string, string>;
};

/** The box the art is drawn in. */
export type CharacterDraw = {
	/** How wide the art's Bounds box is drawn, world px. */
	width: number;
	/** Where the ground is down the box, 0 (top) to 1 (bottom). Absent ⇒ 1. */
	feet?: number;
	/** Named points across and down the box (0 to 1), mirrored with the art: `hand` is where a held
	 *  line starts. */
	points?: Record<string, { x: number; y: number }>;
};

export const CHARACTER_MOTIONS = ['still', 'moving'] as const;
export type CharacterMotion = (typeof CHARACTER_MOTIONS)[number];

export const CHARACTER_ABILITY_BUTTONS = ['ability1', 'ability2'] as const;
export type CharacterAbilityButton = (typeof CHARACTER_ABILITY_BUTTONS)[number];

/** What starts an action. */
export type CharacterTrigger =
	/** Found from how the character moves as drawn. */
	| { motion: CharacterMotion }
	/** The character uses the ability on this button. */
	| { ability: CharacterAbilityButton }
	/** A rules event names the character: as its user, or as its `target`. */
	| { event: string; as?: 'target' }
	/** While a status holds (`holding`, `marked`, a room status' name). */
	| { status: string };

export const CHARACTER_PLAYS = ['loop', 'once'] as const;
export type CharacterPlay = (typeof CHARACTER_PLAYS)[number];

/** One thing the character can do. */
export type CharacterAction = {
	/** Unique in the sheet: the `<action>` of the clip name rule. */
	id: string;
	name?: string;
	/** Absent ⇒ nothing starts it: it only stands in for another action (`fallback`). */
	when?: CharacterTrigger | CharacterTrigger[];
	/** Absent ⇒ `once` when an ability or an event starts it, else `loop`. */
	play?: CharacterPlay;
	/** Of the actions whose trigger holds, the highest plays. Absent ⇒ 3 for an ability or an
	 *  event, 2 for a status, 1 for a motion. */
	priority?: number;
	/** What may cut it while it plays `once`: absent ⇒ any other `once`; `priority` ⇒ only one of
	 *  the same priority or higher; `none` ⇒ nothing. A loop never cuts a `once`. */
	interrupt?: 'priority' | 'none';
	/** Started again while it plays: absent ⇒ it restarts; `ignore` ⇒ it plays on. */
	again?: 'ignore';
	/** Per facing, the clip. A facing left out is found by name. */
	anim?: Partial<Record<CharacterFacing, { clip: string }>>;
	/** The action drawn in its place when it has no clip in any facing. */
	fallback?: string;
};

/** The sheet's four fields, as they sit on an `arcade.characters` entry. */
export type CharacterSheet = {
	view?: CharacterView;
	source?: CharacterSource;
	draw?: CharacterDraw;
	actions?: CharacterAction[];
};

export const CHARACTER_SHEET_FIELDS = ['view', 'source', 'draw', 'actions'] as const;
