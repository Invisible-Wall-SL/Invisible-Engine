/**
 * A FIELD MADE PER ROOM (`docs/design/realtime-multiplayer.md` §14 #4, P11.2 (e)): an online game
 * whose config names a generator (`arcade.online.generator`) plays, in each room, a field of its
 * own made from the room's seed. The room picks the seed and carries it in its state; the server
 * (`services/game-server` `createRoomSim`) and every device (`apps/lines` `game/online.ts`) run
 * {@link generatedOnlineGame} on it, so both step the same field, and the device draws what the
 * generator made (`engine-layout` `FIELD_DRAWINGS`, by the same id).
 *
 * A generator decides the field's geometry only: its size, its zones and their rules, and where
 * players and bots start; the config's prop colliders (`arcade.online.props`, `propShape.js`) are
 * laid into those zones and rules (`geometry(made, props)`), so a collider moves the fingerprint and
 * the art a prop is drawn with cannot. Everything else (characters, speeds, abilities, the round, bots) stays
 * as the config says. Its zones and zone rules REPLACE the authored ones, whose river the editor
 * shows. Its field size may differ from the authored one: the device sizes the world scene that
 * holds the drawing to it (`online.ts` `withRoomField`). Plain ESM, like the rest of the package.
 *
 * ONE LEVEL FOR A ROOM AND ITS DEVICES (owner, 2026-11-25: "changing the seed generates a new
 * level, but does not update collisions"). The room reads `arcade.online.levels` from the
 * published config and a device from the config it booted with, and the two are not the same
 * config: a launcher link boots the project's live one, so levels saved in `/editor` and not yet
 * published drew one river while the room collided against another. So the room's state carries,
 * beside the seed, the levels its generator read and a fingerprint of the level it made
 * ({@link roomLevelState}); a device plays the room's levels in place of its own, and leaves a
 * room whose level it still cannot make ({@link roomLevelGame}).
 */

import { readPropShapes } from './propShape.js';
import { salmonsGeometry, salmonsRiver } from './salmons.js';
import { levelOverlay, levelShape, salmonsMapRiver, seedLevels } from './salmonsMap.js';

/**
 * The generators a config can name, by id (`game-config` `ONLINE_GENERATOR_IDS` lists them).
 * `make(seed, levels)` gets the config's `arcade.online.levels`: its `river`, `waterfalls`,
 * `generator` and `biomes` shape the level (none: the original's) and its overlays are laid on top;
 * `salmonsRiver` (P10.16's band river) takes none and is kept for the recorded traces.
 * A generator that reads levels also says what it read of them for one seed (`levels`, in a form
 * that is again a config's `levels`: `salmonsMap.js` `seedLevels`), which is what a room tells its
 * devices.
 */
export const ONLINE_GENERATORS = {
	salmonsRiver: { make: (seed) => salmonsRiver(seed), geometry: salmonsGeometry },
	salmonsMap: {
		make: (seed, levels) =>
			salmonsMapRiver(seed, levelOverlay(levels, seed), levelShape(levels, seed)),
		geometry: salmonsGeometry,
		levels: seedLevels,
	},
};

/** The generator a game names; `undefined` for none, or one this build does not know. */
const generatorOf = (game) => {
	const id = game.online.generator;
	return id ? ONLINE_GENERATORS[id] : undefined;
};

/**
 * The seed a new room plays (`docs/design/salmons-levels.md` §2 b): the next of the config's pinned
 * `levels.seeds`, by the room's count, or, with none pinned, `random` (the original's behaviour: a
 * new level per room).
 */
export function roomLevelSeed(levels, roomCount, random) {
	const seeds = levels?.seeds;
	if (seeds?.length) return seeds[roomCount % seeds.length];
	return random();
}

/**
 * `game` as a room seeded `seed` plays it, and what its generator made from the seed (for the
 * device to draw); a game that names no generator comes back as it is, with nothing made.
 */
export function generatedOnlineGame(game, seed) {
	const generator = generatorOf(game);
	if (!generator) return { game, made: undefined };
	const made = generator.make(seed, game.online.levels);
	const g = generator.geometry(made, game.online.props);
	const { online } = game;
	return {
		game: {
			...game,
			field: g.field,
			zones: g.zones,
			online: {
				...online,
				spawn: g.spawn,
				characters: online.characters.map((c) =>
					g.spawns[c.id] ? { ...c, spawns: g.spawns[c.id] } : c,
				),
				rules: { ...online.rules, zones: g.zoneRules },
				bots: { ...online.bots, spawns: g.botSpawns },
			},
		},
		made,
	};
}

/** The most characters of levels a room's state carries. A longer one (about 1,600 removed cells
 *  or 400 added pieces of overlay) is not sent: its devices are held to the fingerprint alone. A
 *  device reads no more than this either, whatever a room sends. */
export const ROOM_LEVELS_MAX = 16384;

/**
 * The levels a room of `seed` plays, as its generator read them for that seed (its `levels`);
 * `undefined` for a game whose generator reads none, or that names none.
 */
export function roomLevels(game, seed) {
	const read = generatorOf(game)?.levels;
	return read ? read(game.online.levels, seed) : undefined;
}

/** A fingerprint hashes every number as a whole count of this many to the unit. */
const HASH_UNITS = 1000;

/** `value` as the text a fingerprint hashes: an object's keys in name order (quoted, so no two
 *  plain values share a text), the `undefined` ones left out, every number as whole
 *  {@link HASH_UNITS}ths. */
function hashText(value) {
	if (typeof value === 'number') return String(Math.round(value * HASH_UNITS));
	if (typeof value === 'string') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(hashText).join(',')}]`;
	if (value === null || typeof value !== 'object') return String(value);
	return `{${Object.keys(value)
		.filter((key) => value[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${hashText(value[key])}`)
		.join(',')}}`;
}

const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');

/** 64 bits of `text` as 16 hex digits: two 32-bit multiply-xor passes, mixed at the end (whole
 *  number arithmetic only, so every JS engine agrees). It tells levels apart; it guards nothing. */
function hashOf(text) {
	let a = 0xdeadbeef;
	let b = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		a = Math.imul(a ^ code, 2654435761);
		b = Math.imul(b ^ code, 1597334677);
	}
	a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
	b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
	return hex(b) + hex(a);
}

/**
 * A fingerprint of the level `game`'s generator `made`, 16 hex digits ('' when it made none): of
 * its geometry (the field, the zones and their rules, the spawns), which is all a room and a
 * device step by, and of nothing else the config says, so two configs that differ outside their
 * levels still agree.
 *
 * THE SAME ON EVERY JS ENGINE. A generator's numbers may come from `Math.sin`, `cos`, `tan`, `**`
 * and `hypot` (`salmonsMap.js`: the meander table, a winding course's reaches), whose last bit is
 * the engine's own libm's and need not be the same in JavaScriptCore as in V8. Every number of a
 * Salmons level reaches its geometry through `Math.round`, `floor` or `ceil`, as whole px
 * (`check:room-levels` holds it), so such a bit moves the fingerprint only where it moves a cell
 * of the level, and then the two levels do differ. A number that is not whole is hashed to the
 * thousandth, so a later generator's last bit moves the fingerprint only at a rounding edge; a
 * generator whose geometry is not whole should round it itself.
 */
export function levelHash(game, made) {
	const generator = generatorOf(game);
	if (!generator || !made) return '';
	return hashOf(
		`${game.online.generator}|${hashText(generator.geometry(made, game.online.props))}`,
	);
}

/**
 * What a room of `seed` writes in its state beside the seed, for the level `made` by its own
 * {@link generatedOnlineGame}: `levels`, the JSON of {@link roomLevels} ('' when its generator
 * reads none, or past {@link ROOM_LEVELS_MAX}), `levelHash`, its {@link levelHash}, and, only
 * when the game has prop colliders (`online.props`), `props`, their JSON (left out past
 * {@link ROOM_LEVELS_MAX}: its devices are held to the fingerprint alone). `undefined` for a game
 * that names no generator: its room says nothing.
 */
export function roomLevelState(game, seed, made) {
	if (!generatorOf(game) || !made) return undefined;
	const levels = roomLevels(game, seed);
	const text = levels ? JSON.stringify(levels) : '';
	const state = {
		levels: text.length > ROOM_LEVELS_MAX ? '' : text,
		levelHash: levelHash(game, made),
	};
	const props = game.online.props ? JSON.stringify(game.online.props) : '';
	if (props && props.length <= ROOM_LEVELS_MAX) state.props = props;
	return state;
}

/** The levels a room said, read again by the device's generator (so both sides' are in its one
 *  form); `undefined` when it said none, more than {@link ROOM_LEVELS_MAX}, nothing that reads as
 *  levels, or the device's generator reads none. */
function saidLevels(generator, said, seed) {
	if (!generator.levels || typeof said !== 'string' || !said) return undefined;
	if (said.length > ROOM_LEVELS_MAX) return undefined;
	try {
		const levels = JSON.parse(said);
		return levels && typeof levels === 'object' ? generator.levels(levels, seed) : undefined;
	} catch {
		return undefined;
	}
}

/** The parts of two levels (their top-level keys) that are not the same, in name order. */
const partsThatDiffer = (a, b) =>
	[...new Set([...Object.keys(a), ...Object.keys(b)])]
		.filter((part) => JSON.stringify(a[part]) !== JSON.stringify(b[part]))
		.sort();

/** The prop colliders a room said: none when it said none (a room of a game without them, or a
 *  game server older than them), or nothing that reads as them. */
function saidProps(said) {
	if (typeof said !== 'string' || !said || said.length > ROOM_LEVELS_MAX) return undefined;
	try {
		return readPropShapes(JSON.parse(said));
	} catch {
		return undefined;
	}
}

/** A shape as the rules play it: without the `from` stamp, which a re-pin changes alone. */
const playedShape = (shape) => (shape ? JSON.stringify({ ...shape, from: undefined }) : '');

/** The kinds of prop whose colliders differ between two sets (`bridges`), in name order. */
const propsThatDiffer = (a = {}, b = {}) =>
	[
		...new Set(
			[...new Set([...Object.keys(a), ...Object.keys(b)])]
				.filter((family) => playedShape(a[family]) !== playedShape(b[family]))
				.map((family) => `${(a[family] ?? b[family]).zoneKind}s`),
		),
	].sort();

/**
 * THE DEVICE'S WHOLE DECISION: what a device plays in a room of `seed` whose state said `said`
 * (`{ levels, levelHash, props }` as {@link roomLevelState} wrote them), from its own resolved `game`.
 *
 *  - The room said its levels ⇒ the device plays THEM. `differs` names the parts of its own
 *    config's that are not the room's (`river`, `waterfalls`, `overlays`), `adopted` whether any
 *    is; with none it plays its own config, which is the room's.
 *  - The device plays the ROOM's prop colliders (`props`, `arcade.online.props`), and none when
 *    the room said none (a game without them, or a game server older than them, which played
 *    none). `differs` names the kinds whose colliders are not its own config's (`bridges`); a
 *    shape that differs only in its `from` stamp is the same collider.
 *  - The room said a fingerprint ⇒ the level the device made must have it, or the answer is
 *    `{ refused }` and the device must leave: `'generator'` when it made the level from the room's
 *    own levels (its generator is not the room's: the runtime and the game server are of different
 *    releases), `'levels'` when it had none of the room's to make it from (not sent, too long, or
 *    not its generator's to read) and its own config's level is another.
 *  - The room said neither (a game server older than the two fields) ⇒ its own config's level,
 *    unchecked, as before them.
 *  - `game` names no generator ⇒ `game` as it is: nothing read, made or checked.
 *
 * `levelHash` is the device's fingerprint when the room said one ('' otherwise) and
 * `roomLevelHash` the room's ('' when it said none).
 */
export function roomLevelGame(game, seed, said) {
	const generator = generatorOf(game);
	if (!generator)
		return { game, made: undefined, adopted: false, differs: [], levelHash: '', roomLevelHash: '' };
	const theirs = saidLevels(generator, said?.levels, seed);
	const levelParts = theirs ? partsThatDiffer(roomLevels(game, seed), theirs) : [];
	const theirProps = saidProps(said?.props);
	const propParts = propsThatDiffer(game.online.props, theirProps);
	const differs = [...levelParts, ...propParts].sort();
	const adopted = differs.length > 0;
	let online = game.online;
	if (levelParts.length) online = { ...online, levels: theirs };
	if (propParts.length) {
		online = { ...online, props: theirProps };
		if (!theirProps) delete online.props;
	}
	const played = generatedOnlineGame(adopted ? { ...game, online } : game, seed);
	const roomLevelHash = typeof said?.levelHash === 'string' ? said.levelHash : '';
	const report = {
		adopted,
		differs,
		levelHash: roomLevelHash ? levelHash(played.game, played.made) : '',
		roomLevelHash,
	};
	if (report.levelHash !== roomLevelHash)
		return { refused: theirs ? 'generator' : 'levels', ...report };
	return { ...played, ...report };
}
