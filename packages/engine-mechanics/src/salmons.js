/**
 * SALMONS AS DATA (`docs/design/game-families.md` P10.16, `docs/design/realtime-multiplayer.md`
 * §4, §7, §14 #4–#6): the river, and the online game config that plays it on the shared runtime and
 * the game server. Nothing here is a second engine: the room runs the config with `onlineRules.js`
 * and `onlineBots.js`, and a device draws it with the layout `engine-layout`'s
 * `salmonsReferenceLayout(river)` builds from the same river.
 *
 * The river is GENERATED from a seed (§14 #4) by {@link salmonsRiver}: bands from the sea (the
 * bottom, where salmon spawn) up to the source (the top, the goal), each with its banks, a current
 * running down, and now and then rapids or a whirlpool. The config is made from one river at
 * authoring time (`scripts/salmons/export.mjs`: what `/editor` and `/config` show) and names the
 * generator (`arcade.online.generator: 'salmonsRiver'`), so each ROOM plays a river of its own
 * (P11.2 (e)): the room picks a seed, `onlineGenerators.js` `generatedOnlineGame` swaps the river's
 * geometry ({@link salmonsGeometry}) into the game on the server and, from the seed the room
 * state carries, on every device, which also draws that river.
 *
 * Salmons' rules (§4's table): the current and the whirlpools are zone forces (on the original's
 * levels a whirlpool pulls towards its centre, {@link WHIRLPOOL_PULL}); rocks are solids, and
 * waterfalls one-way solids that stop a salmon from below. On P10.16's band river a bank is a force
 * that pushes a salmon back into the water, and the water, the sea and the source are solid to
 * bears and fishermen, so they stay on the banks. On the original's levels the original's bounds
 * hold instead ({@link SALMONS_BOUNDS}): a bank is a wall at a salmon's centre, bears walk in the
 * water, fishermen cross it on bridges, and the speeds and spawns are the original's. The bear's
 * swipe is a `catch` ability, the fisherman's cast a `hook`. The rules module `salmons`
 * (`salmonsRules.js`, P11.3) plays the rest: the climb up a waterfall by tapping, the sandbanks
 * that ground a salmon until it jumps, the line (hook, reel, land) and the golden salmon. The
 * first salmon at the source wins the round, and the next starts 15 s later (§14 #6). Bots fill
 * each room to 20 as bears and fishermen, and cannot win (§14 #5).
 *
 * Plain, dependency-free ESM like the rest of the package. Not exported from its entry itself,
 * but reachable from it through `onlineGenerators.js`: only tree-shaking keeps it out of a
 * runtime that never calls `generatedOnlineGame` (`check:family-runtimes` holds the sizes).
 */

import { createRng } from './board.js';
import { CELL, SALMONS_MAP } from './salmonsMap.js';
import { BRIDGE_SLOPE } from './salmonsRules.js';

/** The river the authored config and layout are made from (a room plays its own). */
export const SALMONS_SEED = 'salmons-1';

/** The river's size: a little wider than a desktop screen, nine screens tall. */
export const SALMONS_WORLD = Object.freeze({ w: 1800, h: 7200 });

/** How tall one band of the river is, px. */
const BAND = 450;

/** The source: the top of the river, the round's goal. */
const SOURCE_H = 240;

/** The sea: the bottom of the river, where salmon start. */
const SEA_H = 300;

/** The current's push down the river, px/s, and in rapids. */
const CURRENT = 60;
const RAPIDS = 140;

/** A band river's bank's push back into the water, px/s: more than a salmon's speed. */
const BANK_PUSH = 420;

/**
 * The original's whirlpool (`GuiltyForever/Salmon-` 41811c2 `server/index.js` `update`), on its own
 * levels (`salmonsMap`): it pulls a salmon towards its centre within 4 cells (radius² 16) by
 * `d · 14 · (1 − d / 4)` cells/s (on the unnormalised offset, `d` in cells: 14 at 2 cells, 6.1 at
 * 3.5), here in px and px/s. The room lets a salmon 0.5 cells up pass over it (`salmonsRules.js`).
 * P10.16's band river keeps its spinning current.
 */
export const WHIRLPOOL_PULL = Object.freeze({ radius: 4 * CELL, strength: 14 * CELL, unit: CELL });

/**
 * The original's bounds on its own levels (`server/index.js` `isInWater`, `isCatcherInBounds` and
 * `update`), in cells: a salmon's centre stays on the water; a bear or a fisherman stays within
 * `bank` of the water's edge and more than `ends` columns from the source and the sea; a bear
 * stays `fallReach` from a waterfall's cells, either side. A solid stops a body by its box, so
 * each is inset by the body's half size and tests the centre, as the original's points.
 */
export const SALMONS_BOUNDS = Object.freeze({ bank: 12, ends: 5, fallReach: 1.5 });

/** The characters' bodies (`arcade.bodies`, by online character id). */
const BODIES = Object.freeze({
	salmon: { shape: 'box', w: 90, h: 44 },
	bear: { shape: 'circle', r: 46 },
	fisherman: { shape: 'box', w: 56, h: 88 },
});

/** A body's half width and half height, px. */
const halfOf = (body) =>
	body.shape === 'circle' ? { x: body.r, y: body.r } : { x: body.w / 2, y: body.h / 2 };

/** The characters that stay out of the band river's water: to them it, the sea and the source are
 *  solid. */
const LAND = ['bear', 'fisherman'];

const round = (v) => Math.round(v);

/** A waterfall's thickness, px: it straddles the line between two bands. */
const FALL_H = 40;

/** How often a band has a rock and a sandbank, and its top a waterfall. */
const ROCK_CHANCE = 0.6;
const SAND_CHANCE = 0.5;
const FALL_CHANCE = 0.35;

/**
 * A river's rocks, sandbanks and waterfalls (P11.3), drawn from `rng` after its bands and
 * whirlpools, so a seed's bands and whirlpools are what they were before. Rocks (a fifth of the way
 * down a band) and sandbanks (three quarters down) sit in the water of every band but the first
 * and the last two, clear of the band's whirlpool; a waterfall crosses the river at the top of a
 * band but the first and the last, so the source and the swim out of the sea stay open. Every river
 * has at least one sandbank and one waterfall.
 */
function salmonsObstacles(bands, worldW, rng) {
	const rocks = [];
	const sandbanks = [];
	const waterfalls = [];
	const n = bands.length;
	const middle = Math.floor(n / 2);
	const inWater = (band, size) =>
		round(band.left + 30 + rng() * Math.max(0, band.right - band.left - 60 - size));
	const sandbank = (band) => {
		const sw = round(150 + rng() * 80);
		sandbanks.push({ x: inWater(band, sw), y: round(band.y + band.h * 0.72), w: sw, h: 60 });
	};
	const waterfall = (band) =>
		waterfalls.push({ x: 0, y: band.y - FALL_H / 2, w: worldW, h: FALL_H });
	bands.forEach((band, i) => {
		if (i >= 1 && i <= n - 3) {
			if (rng() < ROCK_CHANCE) {
				const size = round(50 + rng() * 40);
				rocks.push({
					x: inWater(band, size),
					y: round(band.y + band.h * 0.2 - size / 2),
					w: size,
					h: size,
				});
			}
			if (rng() < SAND_CHANCE) sandbank(band);
		}
		if (i >= 1 && i <= n - 2 && rng() < FALL_CHANCE) waterfall(band);
	});
	if (!sandbanks.length) sandbank(bands[middle - 1]);
	if (!waterfalls.length) waterfall(bands[middle]);
	return { rocks, sandbanks, waterfalls };
}

/**
 * The river a seed makes: the world, its bands (top to bottom, each `{ y, h, left, right, current }`
 * with the water between `left` and `right`), its whirlpools (`{ x, y, r, spin }`), its rocks,
 * sandbanks and waterfalls (`{ x, y, w, h }` each), the source, the sea, and the bots' places on the
 * banks.
 */
export function salmonsRiver(seed = SALMONS_SEED) {
	const rng = createRng(seed);
	const { w, h } = SALMONS_WORLD;
	const bands = [];
	let centre = w / 2;
	for (let y = SOURCE_H, i = 0; y < h - SEA_H; y += BAND, i++) {
		centre = Math.min(w - 520, Math.max(520, centre + (rng() - 0.5) * 360));
		const width = 560 + rng() * 260;
		const rapids = i > 0 && rng() < 0.2;
		bands.push({
			y,
			h: Math.min(BAND, h - SEA_H - y),
			left: round(centre - width / 2),
			right: round(centre + width / 2),
			current: rapids ? RAPIDS : CURRENT,
		});
	}
	const whirlpools = [];
	bands.forEach((band, i) => {
		if (i === 0 || band.current === RAPIDS || rng() > 0.3) return;
		const r = 90;
		whirlpools.push({
			x: round(band.left + r + rng() * (band.right - band.left - 2 * r)),
			y: round(band.y + band.h / 2),
			r,
			spin: rng() < 0.5 ? -1 : 1,
		});
	});
	const obstacles = salmonsObstacles(bands, w, rng);
	const top = bands[0];
	const last = bands[bands.length - 1];
	const botSpawns = bands.slice(1).map((band, i) => ({
		x: round(i % 2 ? band.right + 120 : band.left - 120),
		y: round(band.y + band.h / 2),
	}));
	return {
		seed,
		world: { w, h },
		bands,
		whirlpools,
		...obstacles,
		source: { x: top.left, y: 0, w: top.right - top.left, h: SOURCE_H },
		sea: { x: 0, y: h - SEA_H, w, h: SEA_H },
		spawn: { x: round((last.left + last.right) / 2), y: h - SEA_H / 2 },
		botSpawns,
	};
}

const brainChase = (speed) => ({
	initial: 'roam',
	states: [
		{ id: 'roam', behaviour: 'wander', params: { speed: speed * 0.5, turnEvery: 2000 } },
		{ id: 'hunt', behaviour: 'chase', params: { tag: 'salmon', range: 360, speed } },
	],
	transitions: [
		{
			id: 'spot',
			from: 'roam',
			to: 'hunt',
			when: [{ kind: 'targetWithin', tag: 'salmon', px: 320 }],
		},
		{
			id: 'lose',
			from: 'hunt',
			to: 'roam',
			when: [{ kind: 'targetBeyond', tag: 'salmon', px: 480 }],
		},
	],
});

const brainCast = (speed) => ({
	initial: 'wait',
	states: [
		{ id: 'wait', behaviour: 'wander', params: { speed: speed * 0.4, turnEvery: 3000 } },
		{ id: 'aim', behaviour: 'keepDistance', params: { tag: 'salmon', distance: 200, speed } },
	],
	transitions: [
		{
			id: 'spot',
			from: 'wait',
			to: 'aim',
			when: [{ kind: 'targetWithin', tag: 'salmon', px: 420 }],
		},
		{
			id: 'lose',
			from: 'aim',
			to: 'wait',
			when: [{ kind: 'targetBeyond', tag: 'salmon', px: 560 }],
		},
	],
});

/** A bot salmon's brain: when it swims and when it rests on the current, about once in 15 s for
 *  a little over a second. How it swims a river is its rules' (`salmonsRules.js` `botSalmon`:
 *  a brain's behaviours know nothing of a river), so to the brain both states stand still. */
const brainSwim = () => ({
	initial: 'swim',
	states: [
		{ id: 'swim', behaviour: 'idle' },
		{ id: 'rest', behaviour: 'idle' },
	],
	transitions: [
		{
			id: 'tire',
			from: 'swim',
			to: 'rest',
			when: [{ kind: 'random', chance: 0.07, every: 1000 }],
		},
		{ id: 'go', from: 'rest', to: 'swim', when: [{ kind: 'timer', ms: 1200 }] },
	],
});

/** The Salmons characters' component ids: the S0 art replaces these placeholders. */
export const SALMONS_COMPONENTS = Object.freeze({
	salmon: 'salmonsSalmon',
	bear: 'salmonsBear',
	fisherman: 'salmonsFisherman',
});

/** The characters' speeds, px/s: P10.16's band river, and the original's on its own levels
 *  (`SALMON_SPEED` 6, `BEAR_SPEED` 4.5, `CATCHER_SPEED` 5 cells/s). */
const SPEED = { salmon: 240, bear: 190, fisherman: 140 };
const ORIGINAL_SPEED = { salmon: 6 * CELL, bear: 4.5 * CELL, fisherman: 5 * CELL };

/** `rect` less every one of `holes`, as rects (none of them empty). */
const without = (rect, holes) =>
	holes.reduce(
		(parts, hole) =>
			parts.flatMap((r) => {
				const x0 = Math.max(r.x, hole.x);
				const x1 = Math.min(r.x + r.w, hole.x + hole.w);
				const y0 = Math.max(r.y, hole.y);
				const y1 = Math.min(r.y + r.h, hole.y + hole.h);
				if (!(x1 > x0 && y1 > y0)) return [r];
				return [
					{ x: r.x, y: r.y, w: r.w, h: y0 - r.y },
					{ x: r.x, y: y1, w: r.w, h: r.y + r.h - y1 },
					{ x: r.x, y: y0, w: x0 - r.x, h: y1 - y0 },
					{ x: x1, y: y0, w: r.x + r.w - x1, h: y1 - y0 },
				].filter((p) => p.w > 0 && p.h > 0);
			}),
		[rect],
	);

/**
 * The original's bounds ({@link SALMONS_BOUNDS}) on one of its levels, as solid zones each for the
 * characters it names, inset by their bodies so that each stops a body where the original stops
 * its centre: the banks and the sea to a salmon (its centre stays on the water, the middle of the
 * edge cells); the land past the bank limit, and the ends, to bears and fishermen; the water to
 * fishermen but where a bridge crosses it (its deck, a cell wide, with its slopes); and each
 * waterfall to bears. Bands run whole cells; one of a band's zones overlaps the next band's by a
 * pixel, so that no line between two bands is open.
 */
function originalBounds(river, zones, rules) {
	const B = SALMONS_BOUNDS;
	const { w: worldW, h: worldH } = river.world;
	const solid = (id, rect, characters) => {
		if (!(rect.w > 0 && rect.h > 0)) return;
		zones.push({ id, ...rect });
		rules.push({ zone: id, solid: true, characters });
	};
	const salmon = halfOf(BODIES.salmon);
	const fisher = halfOf(BODIES.fisherman);
	const bridgeHoles = (river.bridges ?? []).map((b) => ({
		x: b.x - BRIDGE_SLOPE * CELL,
		y: b.y - fisher.y,
		w: b.w + 2 * BRIDGE_SLOPE * CELL,
		h: CELL + 2 * fisher.y,
	}));
	river.bands.forEach((band, i) => {
		const id = `band${i}`;
		const inLeft = band.left + CELL / 2;
		const inRight = band.right - CELL / 2;
		const y = band.y + salmon.y - 1;
		const h = band.h - 2 * salmon.y + 2;
		solid(`${id}Left`, { x: 0, y, w: inLeft - salmon.x, h }, ['salmon']);
		solid(`${id}Right`, { x: inRight + salmon.x, y, w: worldW - inRight - salmon.x, h }, [
			'salmon',
		]);
		for (const character of ['bear', 'fisherman']) {
			const half = halfOf(BODIES[character]);
			const left = inLeft - B.bank * CELL - half.x;
			const right = inRight + B.bank * CELL + half.x;
			solid(`${id}Beyond${character}Left`, { x: 0, y: band.y, w: left, h: band.h }, [character]);
			solid(`${id}Beyond${character}Right`, { x: right, y: band.y, w: worldW - right, h: band.h }, [
				character,
			]);
		}
		const water = { x: band.left, y: band.y, w: band.right - band.left, h: band.h };
		without(water, bridgeHoles).forEach((part, k) =>
			solid(`${id}Water${k ? k : ''}Fisherman`, part, ['fisherman']),
		);
	});
	const { sourceRows } = river.grid;
	const rowCentre = (gx) => (gx + sourceRows) * CELL + CELL / 2;
	for (const character of ['bear', 'fisherman']) {
		const half = halfOf(BODIES[character]);
		const top = rowCentre(B.ends) - half.y;
		const bottom = rowCentre(SALMONS_MAP.RIVER_LENGTH - B.ends) + half.y;
		solid(`source${character}`, { x: 0, y: 0, w: worldW, h: top }, [character]);
		solid(`sea${character}`, { x: 0, y: bottom, w: worldW, h: worldH - bottom }, [character]);
	}
	const seaY = river.sea.y + salmon.y - 1;
	solid('seaSalmon', { x: 0, y: seaY, w: worldW, h: worldH - seaY }, ['salmon']);
	const bear = halfOf(BODIES.bear);
	const reach = B.fallReach * CELL;
	(river.waterfalls ?? []).forEach((fall, i) => {
		const line = fall.y + fall.h / 2;
		const band = river.bands.find((b) => b.y === line);
		if (!band) return;
		// Around the original's waterfall cells, whose centres are half a cell below the line the
		// salmon's one-way solid stands on.
		const row = line + CELL / 2;
		const x = band.left + CELL / 2 - reach + bear.x;
		const y = row - reach + bear.y;
		solid(
			`waterfall${i}Bear`,
			{ x, y, w: band.right - CELL / 2 + reach - bear.x - x, h: row + reach - bear.y - y },
			['bear'],
		);
	});
}

/**
 * What of the game a river decides: the field, its zones and their rules (the current, the banks,
 * the whirlpools, the source), where salmon start, and the banks the bears, fishermen and bots
 * start on (`spawns` by online character id).
 */
export function salmonsGeometry(river) {
	const original = river.generator === 'salmonsMap';
	const banks = () => river.botSpawns.map((p) => ({ ...p }));
	const zones = [];
	const rules = [];
	river.bands.forEach((band, i) => {
		const id = `band${i}`;
		zones.push({ id: `${id}Water`, x: band.left, y: band.y, w: band.right - band.left, h: band.h });
		// By the salmon's centre: on the line between two bands only one current carries it, as the
		// original's one current a tile (two rapids, 280 px/s, would hold it there against its 240).
		rules.push({
			zone: `${id}Water`,
			force: { x: 0, y: band.current },
			characters: ['salmon'],
			centre: true,
		});
		if (original) return;
		zones.push({ id: `${id}Left`, x: 0, y: band.y, w: band.left, h: band.h });
		rules.push({ zone: `${id}Left`, force: { x: BANK_PUSH, y: 0 }, characters: ['salmon'] });
		zones.push({
			id: `${id}Right`,
			x: band.right,
			y: band.y,
			w: river.world.w - band.right,
			h: band.h,
		});
		rules.push({ zone: `${id}Right`, force: { x: -BANK_PUSH, y: 0 }, characters: ['salmon'] });
		rules.push({ zone: `${id}Water`, solid: true, characters: LAND });
	});
	river.whirlpools.forEach((pool, i) => {
		const id = `whirlpool${i}`;
		if (original) {
			const { radius } = WHIRLPOOL_PULL;
			zones.push({ id, x: pool.x - radius, y: pool.y - radius, w: radius * 2, h: radius * 2 });
			rules.push({ zone: id, pull: { ...WHIRLPOOL_PULL }, characters: ['salmon'] });
			return;
		}
		zones.push({ id, x: pool.x - pool.r, y: pool.y - pool.r, w: pool.r * 2, h: pool.r * 2 });
		rules.push({ zone: id, force: { x: pool.spin * 180, y: 120 }, characters: ['salmon'] });
	});
	(river.rocks ?? []).forEach((rock, i) => {
		zones.push({ id: `rock${i}`, ...rock });
		rules.push({ zone: `rock${i}`, solid: true });
	});
	(river.sandbanks ?? []).forEach((sand, i) => {
		zones.push({ id: `sandbank${i}`, ...sand });
		rules.push({
			zone: `sandbank${i}`,
			kind: 'sandbank',
			characters: ['salmon'],
			...(original ? { cell: CELL } : {}),
		});
	});
	(river.waterfalls ?? []).forEach((fall, i) => {
		zones.push({ id: `waterfall${i}`, ...fall });
		rules.push({
			zone: `waterfall${i}`,
			solid: 'below',
			kind: 'waterfall',
			characters: ['salmon'],
			...(original ? { aloft: true } : {}),
		});
	});
	(river.bridges ?? []).forEach((bridge, i) => {
		zones.push({ id: `bridge${i}`, ...bridge });
		rules.push({ zone: `bridge${i}`, kind: 'bridge', characters: ['fisherman'] });
	});
	zones.push({ id: 'source', ...river.source });
	rules.push({ zone: 'source', goal: true, characters: ['salmon'] });
	zones.push({ id: 'sea', ...river.sea });
	if (original) originalBounds(river, zones, rules);
	else {
		rules.push({ zone: 'source', solid: true, characters: LAND });
		rules.push({ zone: 'sea', solid: true, characters: LAND });
	}
	return {
		field: { ...river.world },
		zones,
		zoneRules: rules,
		spawn: { ...river.spawn },
		spawns: original
			? { salmon: river.salmonSpawns.map((p) => ({ ...p })), bear: banks(), fisherman: banks() }
			: { salmon: [{ ...river.spawn }], bear: banks(), fisherman: banks().reverse() },
		botSpawns: banks(),
	};
}

/** Salmons' lobby (owner, 2026-11-17): 4 people, or 60 s after the first, then a 10 s countdown. */
export const SALMONS_LOBBY = Object.freeze({
	minPlayers: 4,
	maxWaitSeconds: 60,
	countdownSeconds: 10,
});

/**
 * What Salmons' bots are called, by class (`bots.characters[].names`; owner, 2026-11-21: "made up
 * fun names, that have to do with the character"): puns and character names, each list longer
 * than its class's places in a room of 100 (60 / 25 / 15), so no name there takes a number.
 */
export const SALMONS_BOT_NAMES = Object.freeze({
	salmon: Object.freeze([
		'Sockeye Sally',
		'Coho Cody',
		'Chinook Chip',
		'Finn Upstream',
		'Gill Gallop',
		'Roe Runner',
		'Splashy Sue',
		'Bubbles McFin',
		'Scaly Skip',
		"Leapin' Lena",
		'Rapid Rita',
		'Current Kim',
		'Gravel Gus',
		'Eddy Swirl',
		'Torrent Tess',
		'Upriver Ula',
		'Silverside Sid',
		'Pink Pip',
		'Redd Riley',
		'Spawnie Shawn',
		'Smolt Molly',
		'Fry Freddie',
		'Parr Patty',
		'Kelt Kelly',
		'Jack Jumper',
		'Grilse Grace',
		'Alevin Al',
		'Ripple Rosie',
		'Wiggle Wendy',
		'Flippy Flo',
		'Finnegan Leap',
		'Gilly Goodswim',
		'Captain Upstream',
		'Professor Gills',
		'Sir Swims-a-Lot',
		'Lady Leapsalot',
		'Countess Coho',
		'Duke of Dorsal',
		'Baron von Fin',
		'Little Lox',
		'Lox Lomond',
		'Smoky Sockeye',
		'Bagel Buddy',
		'Tailwind Tina',
		'Dorsal Dot',
		'Pectoral Percy',
		'Scales McGee',
		'Glimmer Gill',
		'Shimmer Shoal',
		'Twinkle Fin',
		'Waterfall Wes',
		'Hopscotch Hal',
		'Pebble Polly',
		'Bubbly Bea',
		'Zippy Zander',
		'Upstream Ulysses',
		'Spray Daisy',
		'Mighty Minnow',
		'Rainbow Rae',
		'Steelhead Stu',
		'Atlantic Annie',
		'King Chinook',
		'Chummy Chad',
		'Keta Kate',
		'Masu Max',
		'Pinksalmon Pam',
		'Silver Sven',
		'Freshwater Fern',
		'Brook Bailey',
		'River Rory',
		'Rill Rascal',
		'Gurgle Gwen',
		'Splishy Splash',
		"Dash O'Fin",
		'Spring Springer',
		'Fall Run Flynn',
		'Sunny Scales',
		'Moonlit Milo',
		'Sparkle Fins',
		'Puddle Jumper',
		'Monsieur Saumon',
		'Señor Salmón',
		'Gilbert Gillsworth',
		'Finley Flick',
		'Wavy Davy',
		'Nimble Nell',
		'Brave Bree',
		'Bold Bodhi',
		'Leap Year Lou',
		'Pinky Swim',
	]),
	fisherman: Object.freeze([
		'Reel Ray',
		'Hooky Hank',
		'Lure Laura',
		'Bobber Bob',
		'Casting Cass',
		'Tackle Ted',
		'Net Nancy',
		'Captain Catch',
		'Old Salty',
		'Wader Wade',
		'Fly Fiona',
		'Sinker Sam',
		'Line Linda',
		'Rod Rodney',
		'Knotty Ned',
		'Patient Pat',
		'Bait Betty',
		'Spool Sully',
		'Drift Della',
		'Angler Angie',
		'Reely Rhonda',
		'Hook Line Harry',
		'Snag Sinclair',
		'Wormy Wes',
		'Floaty Flo',
		'Gaff Gaffney',
		'Nibble Nora',
		'Waiting Walter',
		'Lucky Lucas',
		'Skipper Sue',
		'Tall Tale Tom',
		'Big One Barry',
		'Fly Guy Phil',
		'Creel Cecil',
		'Jig Jessie',
		'Trolling Trudy',
		'Spinner Sid',
		'Bucket Bill',
		'Feather Fay',
		'Marshall Mudboots',
	]),
	bear: Object.freeze([
		'Grizzly Gus',
		'Honey Paws',
		'Berry Bear',
		'Kodiak Kat',
		'Bruin Bruno',
		'Fluffy Fernando',
		'Claw-dia',
		'Ursa Majorie',
		'Big Paw Paula',
		'Snuffles',
		'Grumbles',
		'Hibernia',
		'Napsalot',
		'Bearnard',
		'Bearry',
		'Teddy Swipe',
		'Growly Greta',
		"Paws O'Malley",
		'Sir Snoozes',
		'Furball Frank',
		'Salmon Snatcher',
		'Berry Picker',
		'Woolly Will',
		'Honeycomb Hal',
		'Cubby',
		'Mama Bruin',
		'Papa Bruin',
		'Brownie Bonnie',
		'Scruffy Shane',
		'Rumbletum',
		'Bramble',
		'Pawsome Pete',
		'Clawdette',
		'Snoutsworth',
	]),
});

/**
 * The online game config (a `GameConfigDoc`) that plays `river`, and a new river per room from the
 * generator that made it (`salmonsMap`'s rivers name theirs; P10.16's band river is `salmonsRiver`).
 * With `lobby` ({@link SALMONS_LOBBY}, what the export ships) a room waits before its first round.
 */
export function salmonsConfig(river = salmonsRiver(), { lobby } = {}) {
	const C = SALMONS_COMPONENTS;
	const geometry = salmonsGeometry(river);
	const original = river.generator === 'salmonsMap';
	const speed = original ? ORIGINAL_SPEED : SPEED;
	/** The original picks a place at random at every spawn; the band river's are taken in turn. */
	const spawnsOf = (id) =>
		geometry.spawns[id]
			? { spawns: geometry.spawns[id], ...(original ? { randomSpawn: true } : {}) }
			: {};
	return {
		version: 1,
		family: 'arcade',
		outcome: 'rules',
		providerName: 'invisible_wall',
		gameName: 'Salmons',
		gameID: 'salmons',
		rtp: 0,
		numReels: 0,
		numRows: [],
		betModes: {},
		paylines: {},
		symbols: {},
		paddingReels: {},
		arcade: {
			field: geometry.field,
			bodies: {
				[C.salmon]: { ...BODIES.salmon, tags: ['salmon'] },
				[C.bear]: { ...BODIES.bear, tags: ['bear'] },
				[C.fisherman]: { ...BODIES.fisherman, tags: ['fisherman'] },
			},
			zones: geometry.zones,
			characters: [
				{ id: 'bearBot', name: 'Bear (bot)', component: C.bear, brain: brainChase(speed.bear) },
				{
					id: 'fishermanBot',
					name: 'Fisherman (bot)',
					component: C.fisherman,
					brain: brainCast(speed.fisherman),
				},
				{ id: 'salmonBot', name: 'Salmon (bot)', component: C.salmon, brain: brainSwim() },
			],
			online: {
				maxPlayers: 100,
				characters: [
					{ id: 'salmon', body: C.salmon, speed: speed.salmon, ...spawnsOf('salmon') },
					{ id: 'bear', body: C.bear, speed: speed.bear, ...spawnsOf('bear') },
					{
						id: 'fisherman',
						body: C.fisherman,
						speed: speed.fisherman,
						...spawnsOf('fisherman'),
					},
				],
				spawn: geometry.spawn,
				generator: river.generator ?? 'salmonsRiver',
				// The box: what every device is sent, whatever it says of its screen, and what holds
				// a bot fisherman's aim. It must cover what the layout's camera shows (`engine-layout`
				// `SALMONS_CAMERA`) on the two windows `check:room-bots` names, and a fisherman's
				// sight (`salmonsRules.js` `SIGHT`): whoever can hook a salmon is in its state.
				// `max`: a device that says what its window shows is sent the players there too, as
				// far as this: a 3840 × 2160 window at the desktop zoom.
				nearby: { w: 3300, h: 3300, max: { w: 6400, h: 6400 } },
				// The original's touch and mouse (`client/input.js`, `game.js` `tick`): every class
				// follows the cursor or the finger and stops within 1.5 tiles of it; a tap or a click
				// jumps a salmon, swipes a bear and casts a fisherman's line.
				pointer: {
					mouse: 'hover',
					deadZone: 1.5 * CELL,
					taps: { salmon: 'jump', bear: 'ability1', fisherman: 'ability1' },
				},
				// A finger (`docs/design/arcade-touch-controls.md`; owner, 2026-11-21): a hold steers for
				// as long as it is down, as the original's did under its camera, and never stops on the
				// point. The salmon's tap leaps where it is sent, as the original's, and keeps that
				// heading; a bear and a fisherman share one scheme, the original's (a tap swipes, a tap
				// casts where tapped).
				touch: {
					schemes: { swim: { gestures: 'both' }, walk: {} },
					characters: { salmon: 'swim', bear: 'walk', fisherman: 'walk' },
				},
				// The original's keys (`client/input.js`): screen-relative on the isometric river, and
				// Space swipes a bear (a fisherman's cast is aimed, so Space does nothing for him).
				keys: 'screen',
				rules: {
					zones: geometry.zoneRules,
					// The original's (`GuiltyForever/salmon-` fb907fb `server/index.js`): a bear swipes
					// 1.5 tiles around the tile ahead of its last move and catches anyone there; a
					// fisherman casts at the tapped water and hooks the first salmon within 1.5 tiles
					// of its travelling bobber. Each scores 1; a bot is back after `ms`.
					abilities: [
						{
							character: 'bear',
							button: 'ability1',
							reach: 1.5 * CELL,
							ahead: CELL,
							targets: ['salmon', 'bear', 'fisherman'],
							effect: 'catch',
							ms: 3000,
							score: 1,
							cooldownMs: 100,
							onPress: true,
						},
						{
							character: 'fisherman',
							button: 'ability1',
							reach: 1.5 * CELL,
							targets: ['salmon'],
							effect: 'hook',
							ms: 3000,
							score: 1,
							cooldownMs: 250,
							onPress: true,
						},
					],
					// One game a room: the first salmon to the source wins it.
					round: { goalScore: 0, endsGame: true },
					respawn: 'manual',
					...(lobby ? { lobby: { ...lobby } } : {}),
					module: 'salmons',
				},
				bots: {
					// By shares: the room is kept full, and with no person in it 60% are salmon, 25%
					// fishermen and 15% bears (`game-config` `botShareCounts`).
					characters: [
						{ character: 'salmon', brain: 'salmonBot', share: 60 },
						{ character: 'fisherman', brain: 'fishermanBot', share: 25 },
						{ character: 'bear', brain: 'bearBot', share: 15 },
					].map((bot) => ({ ...bot, names: [...SALMONS_BOT_NAMES[bot.character]] })),
					spawns: geometry.botSpawns,
					// Owner, 2026-11-21: a bot salmon at the source wins the game as a person does.
					canWin: true,
				},
			},
		},
	};
}
