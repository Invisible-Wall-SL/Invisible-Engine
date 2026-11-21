import {
	ARCADE_TOUCH_LIMITS,
	ARCADE_TOUCH_PRESETS,
	normalizeTouchScheme,
	type ArcadeOnline,
	type ArcadeOnlineTouch,
	type ArcadeTouchScheme,
	type GameConfigDoc,
} from 'game-config';

/**
 * How `/config` edits the touch control schemes of an online arcade game (`arcade.online.touch`;
 * `game-config` `touchScheme.ts`, `docs/design/arcade-touch-controls.md`): the project's named
 * schemes, and the scheme each online class is given. Invisible Characters' Online class card
 * gives a class its scheme with {@link setClassTouchScheme} too.
 *
 * Like `./onlineDoc`, every edit writes what the stored form is and nothing else
 * (`touchOf`): a scheme is `normalizeTouchScheme`'s (a default is not stored), a class names a
 * scheme that exists, an emptied `characters` is removed, and the block goes with its last scheme.
 * `check:game-config-family` runs each and reads the result back through the carry.
 */

export type TouchSchemeField = keyof ArcadeTouchScheme;

const onlineOf = (doc: GameConfigDoc): ArcadeOnline | undefined => doc.arcade?.online;

const has = (touch: ArcadeOnlineTouch | undefined, name: string): boolean =>
	!!touch && Object.hasOwn(touch.schemes, name);

/** `stem`, or `stem 2`, `stem 3`…: the first no scheme has. */
const freshName = (touch: ArcadeOnlineTouch | undefined, stem: string): string => {
	if (!has(touch, stem)) return stem;
	let n = 2;
	while (has(touch, `${stem} ${n}`)) n += 1;
	return `${stem} ${n}`;
};

const isFull = (touch: ArcadeOnlineTouch | undefined): boolean =>
	Object.keys(touch?.schemes ?? {}).length >= ARCADE_TOUCH_LIMITS.schemes;

/** Store `schemes` and `characters` as the block: no class naming a scheme leaves no
 *  `characters`, and no scheme leaves no block. */
function store(
	online: ArcadeOnline,
	schemes: Record<string, ArcadeTouchScheme>,
	characters: Record<string, string>,
): void {
	if (!Object.keys(schemes).length) delete online.touch;
	else online.touch = { schemes, ...(Object.keys(characters).length ? { characters } : {}) };
}

/** Whether another scheme can be added (a project holds {@link ARCADE_TOUCH_LIMITS}.schemes). */
export const canAddTouchScheme = (doc: GameConfigDoc): boolean =>
	!!onlineOf(doc) && !isFull(onlineOf(doc)?.touch);

/**
 * Add a scheme as a COPY of the built-in preset `preset`'s fields, named after the preset (with a
 * number when that name is taken), and answer its name. Nothing for an unknown preset, a game not
 * played online, or a project that already holds as many schemes as it can.
 */
export function addTouchScheme(doc: GameConfigDoc, preset: string): string | undefined {
	const online = onlineOf(doc);
	if (!online || !Object.hasOwn(ARCADE_TOUCH_PRESETS, preset) || isFull(online.touch)) return;
	const { label, scheme } = ARCADE_TOUCH_PRESETS[preset];
	const name = freshName(online.touch, label);
	store(
		online,
		{ ...online.touch?.schemes, [name]: normalizeTouchScheme(scheme) },
		{ ...online.touch?.characters },
	);
	return name;
}

/** Add a copy of the scheme `name` as `<name> copy`, after it, and answer the copy's name. No
 *  class is given the copy. */
export function duplicateTouchScheme(doc: GameConfigDoc, name: string): string | undefined {
	const online = onlineOf(doc);
	const touch = online?.touch;
	if (!online || !touch || !has(touch, name) || isFull(touch)) return;
	const copy = freshName(touch, `${name} copy`);
	const schemes: Record<string, ArcadeTouchScheme> = {};
	for (const [key, scheme] of Object.entries(touch.schemes)) {
		schemes[key] = scheme;
		if (key === name) schemes[copy] = normalizeTouchScheme(scheme);
	}
	store(online, schemes, { ...touch.characters });
	return copy;
}

/** Rename a scheme in its place, and every class that names it. A blank or taken name is refused
 *  (`false`). */
export function renameTouchScheme(doc: GameConfigDoc, from: string, to: string): boolean {
	const online = onlineOf(doc);
	const touch = online?.touch;
	const name = to.trim();
	if (!online || !touch || !has(touch, from) || !name || name === '__proto__' || has(touch, name))
		return false;
	store(
		online,
		Object.fromEntries(
			Object.entries(touch.schemes).map(([key, scheme]) => [key === from ? name : key, scheme]),
		),
		Object.fromEntries(
			Object.entries(touch.characters ?? {}).map(([id, given]) => [
				id,
				given === from ? name : given,
			]),
		),
	);
	return true;
}

/** Remove a scheme. The classes that named it are left with none; the last scheme takes the
 *  block. */
export function removeTouchScheme(doc: GameConfigDoc, name: string): void {
	const online = onlineOf(doc);
	const touch = online?.touch;
	if (!online || !touch || !has(touch, name)) return;
	store(
		online,
		Object.fromEntries(Object.entries(touch.schemes).filter(([key]) => key !== name)),
		Object.fromEntries(
			Object.entries(touch.characters ?? {}).filter(([, given]) => given !== name),
		),
	);
}

/**
 * One field of the scheme `name`. A choice is its value; a number is typed text, empty for the
 * default (the dead zone and the tap distance: the game's own); `releaseStops` is the toggle.
 * What the normalizer does not store (a default, an unknown choice, a number below 0) clears the
 * field, and a number above its limit is held to it.
 */
export function setTouchSchemeField(
	doc: GameConfigDoc,
	name: string,
	field: TouchSchemeField,
	value: string | boolean,
): void {
	const touch = onlineOf(doc)?.touch;
	if (!touch || !has(touch, name)) return;
	const typed =
		typeof value === 'boolean' || !(field in ARCADE_TOUCH_LIMITS)
			? value
			: value.trim() === ''
				? undefined
				: Number(value);
	touch.schemes[name] = normalizeTouchScheme({ ...touch.schemes[name], [field]: typed });
}

/** Give the online class `classId` the scheme `name`; empty for none. A name no scheme has, or a
 *  class the room has not, is refused. */
export function setClassTouchScheme(doc: GameConfigDoc, classId: string, name: string): void {
	const online = onlineOf(doc);
	const touch = online?.touch;
	if (!online || !touch || !online.characters.some((c) => c.id === classId)) return;
	if (name && !has(touch, name)) return;
	const characters = { ...touch.characters };
	if (name) characters[classId] = name;
	else delete characters[classId];
	store(online, touch.schemes, characters);
}

/** A class renamed keeps its scheme, under its new id (`./onlineDoc` calls this). */
export function renameTouchClass(online: ArcadeOnline, from: string, to: string): void {
	const touch = online.touch;
	if (!touch?.characters || !Object.hasOwn(touch.characters, from)) return;
	store(
		online,
		touch.schemes,
		Object.fromEntries(
			Object.entries(touch.characters).map(([id, given]) => [id === from ? to : id, given]),
		),
	);
}

/** A class removed no longer names a scheme (`./onlineDoc` calls this): nothing on the page
 *  could take the name off a class that is gone. */
export function removeTouchClass(online: ArcadeOnline, classId: string): void {
	const touch = online.touch;
	if (!touch?.characters || !Object.hasOwn(touch.characters, classId)) return;
	const { [classId]: _gone, ...characters } = touch.characters;
	store(online, touch.schemes, characters);
}
