import {
	CHARACTER_FACINGS,
	CHARACTER_SHEET_FIELDS,
	CHARACTER_SHEET_LIMITS,
	characterViewFacings,
	normalizeCharacterSheet,
	validateCharacterSheets,
	type ArcadeCharacter,
	type ArcadeOnlineCharacter,
	type CharacterClipSource,
	type CharacterFacing,
	type CharacterRigSource,
	type CharacterSheet,
	type CharacterView,
	type CharacterViewKind,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import { sheetOfCharacterClips, type CharacterClips } from 'engine-layout';
import { characterFacings } from '../flipbook/characterSet';
import { addCharacter, classesNamingSheet, findCharacter, renameCharacter } from './characterEdit';
import {
	SOURCE_KIND_LABELS,
	SOURCE_KIND_WORDS,
	cellKindOf,
	cellKindsRead,
	cellText,
	type CellKind,
} from './sheetCore';

/**
 * How Invisible Characters edits a CHARACTER SHEET (`docs/design/character-pipeline.md` §2, §5,
 * step C2b): the `view`, `source`, `draw` and `actions` of an `arcade.characters` entry, and the
 * `sheet` of the online class that names it (`game-config` `characterSheet.ts`).
 *
 * Every edit goes through {@link normalizeCharacterSheet}: it copies the entry's four fields,
 * changes the copy, normalizes it and writes back the fields that changed. So what the page holds
 * is always what a save stores: sparse (a default, an empty map or list is not stored) and in the
 * normalizer's key order. An edit that would store nothing new (a blank prefix, a width of 0, a
 * duplicate trigger) is REFUSED with the reason, as a string; `null` is "done".
 *
 * Here: the view, a frame-clip source and the variants of any source, the draw box, the online
 * class, the references kept in step and *Make this a sheet*. The choice of a source's kind and a
 * rig source are in `./characterSheetSources`; the actions in `./characterSheetActions`; the
 * comparison with the saved config, the tool's warnings and the page's issue list in
 * `./characterSheetCheck`. The triggers are C2a's: `motion`, `ability`, `event` and `status`,
 * `loop` and `once`.
 *
 * Pure, no Svelte and no server import: `scripts/check-characters-tool.ts` §8 and §12 run each.
 */

const NO_CHARACTER = 'No such character.';
const NO_SOURCE = 'Choose an animation source first.';
const NO_DRAW = 'Give the draw box a width first.';
const NO_VIEW = 'Pick a view first.';

/** A JSON copy: the page's doc is a `$state` proxy, which `structuredClone` refuses. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The sheet's four fields as an entry holds them, or `undefined` when it holds none. */
export function sheetFieldsOf(entry: CharacterSheet | undefined): CharacterSheet | undefined {
	if (!entry) return undefined;
	const sheet: CharacterSheet = {};
	if (entry.view !== undefined) sheet.view = entry.view;
	if (entry.source !== undefined) sheet.source = entry.source;
	if (entry.draw !== undefined) sheet.draw = entry.draw;
	if (entry.actions !== undefined) sheet.actions = entry.actions;
	return Object.keys(sheet).length ? sheet : undefined;
}

/** The sheet of the character `id`, as the doc holds it. */
export const sheetOf = (doc: GameConfigDoc, id: string): CharacterSheet | undefined =>
	sheetFieldsOf(findCharacter(doc, id));

export const hasSheet = (doc: GameConfigDoc, id: string): boolean => !!sheetOf(doc, id);

/** Write `next` as the entry's sheet. A field that did not change keeps its object; when a field
 *  appears or goes, the four are laid down again in the normalizer's order. */
function writeSheet(entry: ArcadeCharacter, next: CharacterSheet | undefined): void {
	const target = entry as CharacterSheet;
	const put = <K extends keyof CharacterSheet>(key: K, value: CharacterSheet[K]): void => {
		target[key] = value;
	};
	const kept: CharacterSheet = {};
	let reorder = false;
	for (const key of CHARACTER_SHEET_FIELDS) {
		const before = target[key];
		const after = next?.[key];
		if ((before === undefined) !== (after === undefined)) reorder = true;
		if (after === undefined) continue;
		const same = before !== undefined && JSON.stringify(before) === JSON.stringify(after);
		Object.assign(kept, { [key]: same ? before : after });
	}
	if (reorder) for (const key of CHARACTER_SHEET_FIELDS) delete target[key];
	for (const key of CHARACTER_SHEET_FIELDS) {
		const value = kept[key];
		if (value !== undefined && (reorder || value !== target[key])) put(key, value);
	}
}

/** Run `change` on a copy of the character's sheet and store what the normalizer makes of it.
 *  `change` returns why the edit is refused, in which case nothing is written. */
export function editSheet(
	doc: GameConfigDoc,
	id: string,
	change: (sheet: CharacterSheet) => string | null | void,
): string | null {
	const entry = findCharacter(doc, id);
	if (!entry) return NO_CHARACTER;
	const sheet = copy(sheetFieldsOf(entry) ?? {});
	const refused = change(sheet);
	if (refused) return refused;
	writeSheet(entry, normalizeCharacterSheet(sheet));
	return null;
}

/**
 * What the save's validator says of `sheet` at one path of it (`actions[0].anim.se`,
 * `draw.bones`), in its own words. An edit that would only store something the game does not read
 * asks this of the sheet it would make, and refuses with the answer, so the tool and the save
 * never word one fault twice. `sheet` is taken as authored: it need not be normalized.
 */
export function sheetIssuesAt(sheet: CharacterSheet, path: string): GameConfigIssue[] {
	const raw = { arcade: { characters: [{ id: 'c', component: 'c', ...sheet }] } };
	return validateCharacterSheets(raw).filter((i) => i.path === `arcade.characters[0].${path}`);
}

/** A typed value as a number, or `undefined` when it is blank or not one. */
export const numberOf = (value: string): number | undefined => {
	const n = Number(value);
	return value.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/** `map` with the key `from` renamed `to`, every key in its place (the order is read: variants
 *  are tried in it). */
const renamedKey = <V>(map: Record<string, V>, from: string, to: string): Record<string, V> =>
	Object.fromEntries(Object.entries(map).map(([key, value]) => [key === from ? to : key, value]));

/** Why `name` cannot be a new key of `map`, or `null`. */
function keyRefusal(
	map: Record<string, unknown> | undefined,
	name: string,
	what: string,
	max: number,
	adding: boolean,
): string | null {
	if (!name) return `A ${what} needs a name.`;
	if (name === '__proto__') return `"__proto__" cannot be a ${what}'s name.`;
	if (map && Object.hasOwn(map, name)) return `There is already a ${what} "${name}".`;
	if (adding && Object.keys(map ?? {}).length >= max)
		return `A sheet reads at most ${max} ${what}s.`;
	return null;
}

// ── view ───────────────────────────────────────────────────────────────────────────────────────

/** What each view kind is called. `3d` is listed so a stored one can be shown. */
export const VIEW_KIND_LABELS: Record<CharacterViewKind, string> = {
	side: 'Side',
	topDown: 'Top-down',
	isometric: 'Isometric',
	'3d': '3D',
};

/** The views the page offers. `3d` is not one: the only source so far is frame clips, which a 3D
 *  view does not draw (it has no facing), so choosing it would only blank the character. A stored
 *  `3d` view is shown and kept until another is picked or the view is cleared. */
export type EditableViewKind = Exclude<CharacterViewKind, '3d'>;
export const VIEW_KIND_OPTIONS: readonly { value: EditableViewKind; label: string }[] = [
	{ value: 'side', label: VIEW_KIND_LABELS.side },
	{ value: 'topDown', label: VIEW_KIND_LABELS.topDown },
	{ value: 'isometric', label: VIEW_KIND_LABELS.isometric },
];

export const VIEW_FACING_OPTIONS: readonly { value: 4 | 8; label: string }[] = [
	{ value: 4, label: '4 facings' },
	{ value: 8, label: '8 facings' },
];

/** Whether a view chooses between 4 and 8 facings (a side view has two, a 3D view none). */
export const viewTakesFacings = (view: CharacterView | undefined): boolean =>
	view?.kind === 'topDown' || view?.kind === 'isometric';

/** Whether a view can be told not to mirror (a 3D view draws no clip). */
export const viewTakesMirror = (view: CharacterView | undefined): boolean =>
	!!view && view.kind !== '3d';

/**
 * What a view draws: its `facings`, clockwise from north (a character with no view is drawn in
 * the four isometric diagonals, as before the sheet), split into the ones art is `made` for and
 * the ones `mirrored` from their twin, by the engine's rule (`engine-layout` `clipMirrorOf`, as
 * Flipbook's grid splits them: `characterFacings`). With `mirror: false` every facing is made.
 */
export function viewDrawing(view: CharacterView | undefined): {
	facings: CharacterFacing[];
	made: CharacterFacing[];
	mirrored: CharacterFacing[];
} {
	const facings = [...characterViewFacings(view)];
	const { drawn, mirrored } = characterFacings(view ? { view } : {});
	return { facings, made: facings.filter((f) => drawn.includes(f)), mirrored };
}

/** Pick the view. The new one keeps `mirror`, and `facings` where it has them (a side view has
 *  two). `anim` cells of facings it does not draw are kept: see {@link undrawnAnimCells}. */
export function setViewKind(doc: GameConfigDoc, id: string, kind: EditableViewKind): string | null {
	if (!VIEW_KIND_OPTIONS.some((o) => o.value === kind)) return 'Not a view this tool sets.';
	return editSheet(doc, id, (sheet) => {
		const was = sheet.view;
		const mirror = was && was.kind !== '3d' && was.mirror === false;
		const eight = was && (was.kind === 'topDown' || was.kind === 'isometric') && was.facings === 8;
		sheet.view =
			kind === 'side'
				? { kind, ...(mirror ? { mirror: false as const } : {}) }
				: {
						kind,
						...(eight ? { facings: 8 as const } : {}),
						...(mirror ? { mirror: false as const } : {}),
					};
	});
}

/** 4 or 8 facings, for a top-down or an isometric view. Only 8 is stored. */
export function setViewFacings(doc: GameConfigDoc, id: string, facings: 4 | 8): string | null {
	return editSheet(doc, id, (sheet) => {
		const view = sheet.view;
		if (!view) return NO_VIEW;
		if (view.kind !== 'topDown' && view.kind !== 'isometric')
			return view.kind === 'side'
				? 'A side view has two facings.'
				: 'A 3D view has no facings: the body turns the model.';
		if (facings === 8) view.facings = 8;
		else delete view.facings;
	});
}

/** Whether the west facings are drawn by mirroring the east ones. Only "off" is stored. */
export function setViewMirror(doc: GameConfigDoc, id: string, on: boolean): string | null {
	return editSheet(doc, id, (sheet) => {
		const view = sheet.view;
		if (!view) return NO_VIEW;
		if (view.kind === '3d') return 'A 3D view draws no clip to mirror.';
		if (on) delete view.mirror;
		else view.mirror = false;
	});
}

/** Take the view away: the character is drawn in the four isometric diagonals, as before. */
export const clearView = (doc: GameConfigDoc, id: string): string | null =>
	editSheet(doc, id, (sheet) => {
		delete sheet.view;
	});

/** A stored `anim` cell: what it holds (`kind`) and its value in words (`sheetCore.ts`
 *  `cellText`: a clip's id, a still's frame and sheet, a rig's animation). */
export type AnimCell = { action: string; facing: CharacterFacing; kind: CellKind; text: string };

/**
 * The `anim` cells of facings the sheet's view does not draw. A change of view KEEPS them (going
 * from 8 facings to 4 and back loses no work), and the game never reads one: a view tries only
 * its own facings. The page lists them and offers {@link dropUndrawnAnimCells}.
 */
export function undrawnAnimCells(sheet: CharacterSheet | undefined): AnimCell[] {
	if (!sheet) return [];
	const drawn = characterViewFacings(sheet.view);
	return (sheet.actions ?? []).flatMap((action) =>
		CHARACTER_FACINGS.flatMap((facing): AnimCell[] => {
			const cell = action.anim?.[facing];
			return cell && !drawn.includes(facing)
				? [{ action: action.id, facing, kind: cellKindOf(cell), text: cellText(cell) }]
				: [];
		}),
	);
}

/** Remove every `anim` cell of a facing the view does not draw, whatever it holds; how many
 *  were removed. */
export function dropUndrawnAnimCells(doc: GameConfigDoc, id: string): number {
	let dropped = 0;
	editSheet(doc, id, (sheet) => {
		const drawn = characterViewFacings(sheet.view);
		for (const action of sheet.actions ?? [])
			for (const facing of CHARACTER_FACINGS)
				if (action.anim?.[facing] && !drawn.includes(facing)) {
					delete action.anim[facing];
					dropped += 1;
				}
	});
	return dropped;
}

/**
 * The `anim` cells of a kind the sheet's source does not draw (`sheetCore.ts` `cellKindsRead`):
 * under a rig a clip or a still image, under frame clips a rig's animation, under still images
 * anything but a still. A change of the source's kind KEEPS them (changing it back loses no work),
 * the game does not read one, and the save's validator warns of each. The page lists them and
 * offers {@link dropUnreadCells}. None for a sheet with no source.
 */
export function unreadCells(sheet: CharacterSheet | undefined): AnimCell[] {
	if (!sheet?.source) return [];
	const read = cellKindsRead(sheet.source);
	return (sheet.actions ?? []).flatMap((action) =>
		CHARACTER_FACINGS.flatMap((facing): AnimCell[] => {
			const cell = action.anim?.[facing];
			return cell && !read.includes(cellKindOf(cell))
				? [{ action: action.id, facing, kind: cellKindOf(cell), text: cellText(cell) }]
				: [];
		}),
	);
}

/** Remove every `anim` cell the source does not draw ({@link unreadCells}); how many were. */
export function dropUnreadCells(doc: GameConfigDoc, id: string): number {
	let dropped = 0;
	editSheet(doc, id, (sheet) => {
		for (const { action, facing } of unreadCells(sheet)) {
			delete sheet.actions?.find((a) => a.id === action)?.anim?.[facing];
			dropped += 1;
		}
	});
	return dropped;
}

// ── animation source: frame clips, and the variants of any source ────────────────────────────

/** The sheet's source when it is frame clips. */
export const clipSourceOf = (sheet: CharacterSheet | undefined): CharacterClipSource | undefined =>
	sheet?.source?.kind === 'clips' ? sheet.source : undefined;

/**
 * Give the character frame clips named `<prefix>_<action>_<facing>`, or change the prefix. A
 * blank prefix is refused: {@link clearSource} takes the source away. Refused on a rig or still
 * images: a change of kind loses what the old source named, so it goes through
 * `./characterSheetSources` `setSourceKind`, which says what and asks first.
 */
export function setSourcePrefix(doc: GameConfigDoc, id: string, prefix: string): string | null {
	const value = prefix.trim();
	if (!value) return 'A prefix cannot be blank.';
	return editSheet(doc, id, (sheet) => {
		if (sheet.source && sheet.source.kind !== 'clips')
			return `The source is ${SOURCE_KIND_WORDS[sheet.source.kind]}, not frame clips: choose ${SOURCE_KIND_LABELS.clips} as the source first.`;
		sheet.source = { ...clipSourceOf(sheet), kind: 'clips', prefix: value };
	});
}

/** Take the source away, whatever its kind, with everything it names (`sourceChangeLoss` of
 *  `./characterSheetSources` says what, for the confirmation): the character keeps its
 *  component's own animation. The cells stay. */
export const clearSource = (doc: GameConfigDoc, id: string): string | null =>
	editSheet(doc, id, (sheet) => {
		delete sheet.source;
	});

/** A source that has variants: frame clips (a second prefix) or a rig (a skin). */
type VariantSource = CharacterClipSource | CharacterRigSource;

const variantSourceOf = (sheet: CharacterSheet | undefined): VariantSource | undefined =>
	sheet?.source && sheet.source.kind !== 'stills' ? sheet.source : undefined;

/** What a variant names, by the source's kind. */
export const VARIANT_VALUE_LABELS: Record<VariantSource['kind'], string> = {
	clips: 'prefix',
	rig: 'skin',
};

/** Why a sheet takes no variant: it has no source, or still images, which have none. */
const noVariants = (sheet: CharacterSheet): string =>
	sheet.source ? 'Still images have no variants: every cell names its image.' : NO_SOURCE;

/**
 * A source's variants in the order they are tried: `[status, value]`. Under frame clips the value
 * is a second prefix, tried first while the status holds; under a rig it is the skin worn while
 * it holds (the first that holds and that the rig has).
 */
export const variantsOf = (sheet: CharacterSheet | undefined): [string, string][] =>
	Object.entries(variantSourceOf(sheet)?.variants ?? {});

/** Add a variant for `status`: a prefix under frame clips, a skin under a rig. */
export function addVariant(
	doc: GameConfigDoc,
	id: string,
	status: string,
	value: string,
): string | null {
	const name = status.trim();
	const named = value.trim();
	return editSheet(doc, id, (sheet) => {
		const source = variantSourceOf(sheet);
		if (!source) return noVariants(sheet);
		const refused = keyRefusal(
			source.variants,
			name,
			'variant',
			CHARACTER_SHEET_LIMITS.variants,
			true,
		);
		if (refused) return refused;
		if (!named) return `A variant needs a ${VARIANT_VALUE_LABELS[source.kind]}.`;
		source.variants = { ...source.variants, [name]: named };
	});
}

/** Change the status a variant is drawn under; it keeps its place. */
export function renameVariant(
	doc: GameConfigDoc,
	id: string,
	status: string,
	next: string,
): string | null {
	const name = next.trim();
	return editSheet(doc, id, (sheet) => {
		const source = variantSourceOf(sheet);
		const variants = source?.variants;
		if (!source || !variants || !Object.hasOwn(variants, status)) return 'No such variant.';
		if (name === status) return null;
		const refused = keyRefusal(variants, name, 'variant', CHARACTER_SHEET_LIMITS.variants, false);
		if (refused) return refused;
		source.variants = renamedKey(variants, status, name);
	});
}

/** What a variant names: its prefix under frame clips, its skin under a rig. */
export function setVariantPrefix(
	doc: GameConfigDoc,
	id: string,
	status: string,
	value: string,
): string | null {
	const named = value.trim();
	return editSheet(doc, id, (sheet) => {
		const source = variantSourceOf(sheet);
		const variants = source?.variants;
		if (!source || !variants || !Object.hasOwn(variants, status)) return 'No such variant.';
		if (!named) return `A variant needs a ${VARIANT_VALUE_LABELS[source.kind]}.`;
		variants[status] = named;
	});
}

export const removeVariant = (doc: GameConfigDoc, id: string, status: string): string | null =>
	editSheet(doc, id, (sheet) => {
		const variants = variantSourceOf(sheet)?.variants;
		if (variants) delete variants[status];
	});

// ── draw box ───────────────────────────────────────────────────────────────────────────────────

/** Where a new point lands: the middle of the box. */
export const DEFAULT_POINT = { x: 0.5, y: 0.5 } as const;

/** How wide the art's Bounds box is drawn, world px: a number above 0. */
export function setDrawWidth(doc: GameConfigDoc, id: string, value: string): string | null {
	const width = numberOf(value);
	if (width === undefined || width <= 0) return 'A width is a number above 0.';
	return editSheet(doc, id, (sheet) => {
		sheet.draw = { ...sheet.draw, width };
	});
}

/** The points of the draw box that follow a bone of a rig (`draw.bones`): `[point, bone]`. */
export const bonesOf = (sheet: CharacterSheet | undefined): [string, string][] =>
	Object.entries(sheet?.draw?.bones ?? {});

/**
 * Tie the point `point` to the bone `bone` of the rig (`draw.bones`); a blank bone unties it.
 * The game reads only the `hand` point from a bone today (`engine-layout` `sheetRigPoints`: where
 * a held line starts); any other name is stored, and kept for when it reads more. The point need
 * not be one of the box's: on a rig that lacks the bone the game reads the point off the box, and
 * with no such point the default hand. Refused unless the source is a rig, in the validator's
 * words: a bone is read on a rig only.
 */
export function setPointBone(
	doc: GameConfigDoc,
	id: string,
	point: string,
	bone: string,
): string | null {
	const key = point.trim();
	const named = bone.trim();
	return editSheet(doc, id, (sheet) => {
		if (!sheet.draw) return NO_DRAW;
		const bones = sheet.draw.bones ?? {};
		if (!named) {
			delete bones[key];
			return null;
		}
		const refused = Object.hasOwn(bones, key)
			? null
			: keyRefusal(bones, key, 'point', CHARACTER_SHEET_LIMITS.points, true);
		if (refused) return refused;
		sheet.draw.bones = { ...bones, [key]: named };
		return sheetIssuesAt(sheet, 'draw.bones')[0]?.message ?? null;
	});
}

/** Take the draw box away, with its feet, its points and the bones they follow. */
export const clearDraw = (doc: GameConfigDoc, id: string): string | null =>
	editSheet(doc, id, (sheet) => {
		delete sheet.draw;
	});

/** Where the ground is down the box, 0 (top) to 1 (bottom). Blank or 1 is the default and is not
 *  stored. */
export function setDrawFeet(doc: GameConfigDoc, id: string, value: string): string | null {
	const feet = value.trim() === '' ? 1 : numberOf(value);
	if (feet === undefined || feet < 0 || feet > 1) return 'Feet is a number from 0 to 1.';
	return editSheet(doc, id, (sheet) => {
		if (!sheet.draw) return NO_DRAW;
		sheet.draw.feet = feet;
	});
}

/** The named points in their stored order. */
export const pointsOf = (
	sheet: CharacterSheet | undefined,
): { name: string; x: number; y: number }[] =>
	Object.entries(sheet?.draw?.points ?? {}).map(([name, at]) => ({ name, x: at.x, y: at.y }));

/** Add a named point, in the middle of the box unless `at` says where. */
export function addPoint(
	doc: GameConfigDoc,
	id: string,
	name: string,
	at: { x: number; y: number } = DEFAULT_POINT,
): string | null {
	const key = name.trim();
	return editSheet(doc, id, (sheet) => {
		if (!sheet.draw) return NO_DRAW;
		const refused = keyRefusal(
			sheet.draw.points,
			key,
			'point',
			CHARACTER_SHEET_LIMITS.points,
			true,
		);
		if (refused) return refused;
		if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return 'A point needs an x and a y.';
		sheet.draw.points = { ...sheet.draw.points, [key]: { x: at.x, y: at.y } };
	});
}

export function renamePoint(
	doc: GameConfigDoc,
	id: string,
	name: string,
	next: string,
): string | null {
	const key = next.trim();
	return editSheet(doc, id, (sheet) => {
		const points = sheet.draw?.points;
		if (!sheet.draw || !points || !Object.hasOwn(points, name)) return 'No such point.';
		if (key === name) return null;
		const refused = keyRefusal(points, key, 'point', CHARACTER_SHEET_LIMITS.points, false);
		if (refused) return refused;
		sheet.draw.points = renamedKey(points, name, key);
	});
}

/** One coordinate of a point, across (`x`) or down (`y`) the box: 0 to 1 is inside it. */
export function setPoint(
	doc: GameConfigDoc,
	id: string,
	name: string,
	axis: 'x' | 'y',
	value: string,
): string | null {
	const n = numberOf(value);
	if (n === undefined) return 'A point needs a number.';
	return editSheet(doc, id, (sheet) => {
		const points = sheet.draw?.points;
		if (!points || !Object.hasOwn(points, name)) return 'No such point.';
		points[name][axis] = n;
	});
}

export const removePoint = (doc: GameConfigDoc, id: string, name: string): string | null =>
	editSheet(doc, id, (sheet) => {
		if (sheet.draw?.points) delete sheet.draw.points[name];
	});

// ── the online class ───────────────────────────────────────────────────────────────────────────

const classesOf = (doc: GameConfigDoc): ArcadeOnlineCharacter[] =>
	doc.arcade?.online?.characters ?? [];

export const findClass = (doc: GameConfigDoc, classId: string): ArcadeOnlineCharacter | undefined =>
	classesOf(doc).find((c) => c.id === classId);

/** The index of a class in `arcade.online.characters`, which `/config`'s own setters take
 *  (`routes/(app)/config/onlineDoc.ts` `setOnlineCharacterField`); -1 for none. */
export const classIndex = (doc: GameConfigDoc, classId: string): number =>
	classesOf(doc).findIndex((c) => c.id === classId);

/** The classes drawn as `component`: the ones a character of that look can be the sheet of. */
export const classesOfComponent = (doc: GameConfigDoc, component: string): string[] =>
	classesOf(doc)
		.filter((c) => c.body === component)
		.map((c) => c.id);

/** Name `characterId` as the sheet of the class `classId`. Refused unless the class's `body` is
 *  the character's component: a class and its sheet use the same component. */
export function linkClassSheet(
	doc: GameConfigDoc,
	classId: string,
	characterId: string,
): string | null {
	const cls = findClass(doc, classId);
	const character = findCharacter(doc, characterId);
	if (!cls) return 'No such online class.';
	if (!character) return NO_CHARACTER;
	if (cls.body !== character.component)
		return `"${classId}" is the body "${cls.body}", but "${characterId}" is drawn as "${character.component}": a class and its sheet use the same component.`;
	cls.sheet = characterId;
	return null;
}

/** Take the `sheet` off a class: it is drawn as it was before the sheet. */
export function unlinkClassSheet(doc: GameConfigDoc, classId: string): string | null {
	const cls = findClass(doc, classId);
	if (!cls) return 'No such online class.';
	delete cls.sheet;
	return null;
}

/** Whether the room picks one of the class's spawns at random. Only `true` is stored, and only
 *  with spawns to pick from (the normalizer drops it otherwise). */
export function setClassRandomSpawn(
	doc: GameConfigDoc,
	classId: string,
	on: boolean,
): string | null {
	const cls = findClass(doc, classId);
	if (!cls) return 'No such online class.';
	if (on && !cls.spawns?.length) return 'Give the class spawn points first.';
	if (on) cls.randomSpawn = true;
	else delete cls.randomSpawn;
	return null;
}

// ── references kept in step ────────────────────────────────────────────────────────────────────

/** {@link renameCharacter}, saying which classes it touched: `followed` named the old id as their
 *  sheet and now name the new one; `adopted` already named the new id (their sheet was missing)
 *  and so name this character from now on. Of those, only a class whose body is this character's
 *  component is drawn from its sheet; `mismatched` are the adopted ones of another body, which
 *  name it and are not drawn from it. */
export function renameSheetCharacter(
	doc: GameConfigDoc,
	id: string,
	next: string,
): { refused: string | null; followed: string[]; adopted: string[]; mismatched: string[] } {
	const followed = classesNamingSheet(doc, id);
	const named = classesNamingSheet(doc, next.trim());
	const component = findCharacter(doc, id)?.component;
	const refused = renameCharacter(doc, id, next);
	if (refused || next.trim() === id) return { refused, followed: [], adopted: [], mismatched: [] };
	const fits = (classId: string): boolean => findClass(doc, classId)?.body === component;
	return {
		refused,
		followed,
		adopted: named.filter(fits),
		mismatched: named.filter((classId) => !fits(classId)),
	};
}

// ── make this a sheet ──────────────────────────────────────────────────────────────────────────

/** The sheet a `characterClips` block is: `sheetOfCharacterClips` as the config stores it. Nothing
 *  is retyped. */
export function makeSheetFrom(look: CharacterClips): CharacterSheet {
	return normalizeCharacterSheet(sheetOfCharacterClips(look)) ?? {};
}

const HAS_SHEET = (id: string) =>
	`"${id}" already has a sheet: clear its view, source, draw box and actions first.`;

/** Write the sheet of `look` onto the character `id`, which must have none. */
export function makeCharacterSheet(
	doc: GameConfigDoc,
	id: string,
	look: CharacterClips,
): string | null {
	if (hasSheet(doc, id)) return HAS_SHEET(id);
	return editSheet(doc, id, (sheet) => {
		Object.assign(sheet, makeSheetFrom(look));
	});
}

/**
 * Make the block `look` (the one the class plays today) the sheet of the online class `classId`,
 * and name it on the class. The sheet goes on the character `targetId` when one is given (the one
 * selected on the page: of two characters of one look, the first is not always the one meant),
 * refused unless that character is drawn as the class's `body`. With none given it goes on the
 * first config character drawn as the class's `body` (Salmons' `bearBot` for `bear`), and with no
 * such character a new entry is made for it, as Add character makes one (`created`; Salmons'
 * `salmon`). Refused when that character already has a sheet, or the class names another
 * character.
 */
export function makeClassSheet(
	doc: GameConfigDoc,
	classId: string,
	look: CharacterClips,
	targetId?: string,
): { refused: string | null; characterId?: string; created?: boolean } {
	const cls = findClass(doc, classId);
	if (!cls) return { refused: 'No such online class.' };
	const target = targetId === undefined ? undefined : findCharacter(doc, targetId);
	if (targetId !== undefined && !target) return { refused: NO_CHARACTER };
	if (target && target.component !== cls.body)
		return {
			refused: `"${classId}" is the body "${cls.body}", but "${target.id}" is drawn as "${target.component}": a class and its sheet use the same component.`,
		};
	const existing = target ?? (doc.arcade?.characters ?? []).find((c) => c.component === cls.body);
	if (cls.sheet && cls.sheet !== existing?.id)
		return { refused: `"${classId}" already names "${cls.sheet}" as its sheet.` };
	if (existing && hasSheet(doc, existing.id)) return { refused: HAS_SHEET(existing.id) };
	const characterId = existing?.id ?? addCharacter(doc, cls.body);
	if (!characterId) return { refused: `"${classId}" has no body to draw.` };
	const refused = makeCharacterSheet(doc, characterId, look);
	if (refused) return { refused };
	cls.sheet = characterId;
	return { refused: null, characterId, created: !existing };
}

/** Take the whole sheet off a character (its four fields). The classes that name it keep their
 *  `sheet`, and are drawn as before until it has one again. */
export function clearSheet(doc: GameConfigDoc, id: string): string | null {
	const entry = findCharacter(doc, id);
	if (!entry) return NO_CHARACTER;
	writeSheet(entry, undefined);
	return null;
}
