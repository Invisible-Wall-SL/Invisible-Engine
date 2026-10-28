/**
 * SALMONS AS DATA (`docs/design/game-families.md` P10.16, `docs/design/realtime-multiplayer.md`
 * §4, §7, §14 #4–#6): the river, and the online game config that plays it on the shared runtime and
 * the game server. Nothing here is a second engine: the room runs the config with `onlineRules.js`
 * and `onlineBots.js`, and a device draws it with the layout `engine-layout`'s
 * `salmonsReferenceLayout(river)` builds from the same river.
 *
 * The river is GENERATED from a seed (§14 #4) by {@link salmonsRiver}: bands from the sea (the
 * bottom, where salmon spawn) up to the source (the top, the goal), each with its banks, a current
 * running down, and now and then rapids or a whirlpool. The config is made from it once, at
 * authoring time (`scripts/salmons/export.mjs`), so the room and every device read the very same
 * zones; a new river per room is not built (the device's layout would have to be drawn from the
 * room's seed).
 *
 * Today's Salmons rules, as data (§4's table): the current and the whirlpools are zone forces; a
 * bank is a force that pushes a salmon back into the water; the bear's swipe and the fisherman's
 * cast are `catch` abilities (the hook and reel are one catch: the line itself, the climb and the
 * sandbanks are rules-module work, left open); the first salmon at the source wins the round, and
 * the next starts 15 s later (§14 #6). Bots fill each room to 20 as bears and fishermen, and cannot
 * win (§14 #5).
 *
 * Plain, dependency-free ESM like the rest of the package, and not exported from its entry: no game
 * bundle carries it.
 */

import { createRng } from './board.js';

/** The river every published Salmons plays (until rivers are made per room). */
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

/** A bank's push back into the water, px/s: more than a salmon's speed. */
const BANK_PUSH = 420;

const round = (v) => Math.round(v);

/**
 * The river a seed makes: the world, its bands (top to bottom, each `{ y, h, left, right, current }`
 * with the water between `left` and `right`), its whirlpools (`{ x, y, r, spin }`), the source, the
 * sea, and the bots' places on the banks.
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

/** The Salmons characters' component ids: the S0 art replaces these placeholders. */
export const SALMONS_COMPONENTS = Object.freeze({
	salmon: 'salmonsSalmon',
	bear: 'salmonsBear',
	fisherman: 'salmonsFisherman',
});

/** The characters' speeds, px/s. */
const SPEED = { salmon: 240, bear: 190, fisherman: 140 };

/** The online game config (a `GameConfigDoc`) that plays `river`. */
export function salmonsConfig(river = salmonsRiver()) {
	const C = SALMONS_COMPONENTS;
	const banks = () => river.botSpawns.map((p) => ({ ...p }));
	const zones = [];
	const rules = [];
	river.bands.forEach((band, i) => {
		const id = `band${i}`;
		zones.push({ id: `${id}Water`, x: band.left, y: band.y, w: band.right - band.left, h: band.h });
		rules.push({ zone: `${id}Water`, force: { x: 0, y: band.current }, characters: ['salmon'] });
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
	});
	river.whirlpools.forEach((pool, i) => {
		const id = `whirlpool${i}`;
		zones.push({ id, x: pool.x - pool.r, y: pool.y - pool.r, w: pool.r * 2, h: pool.r * 2 });
		rules.push({ zone: id, force: { x: pool.spin * 180, y: 120 }, characters: ['salmon'] });
	});
	zones.push({ id: 'source', ...river.source });
	rules.push({ zone: 'source', goal: true, characters: ['salmon'] });
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
			field: { ...river.world },
			bodies: {
				[C.salmon]: { shape: 'box', w: 90, h: 44, tags: ['salmon'] },
				[C.bear]: { shape: 'circle', r: 46, tags: ['bear'] },
				[C.fisherman]: { shape: 'box', w: 56, h: 88, tags: ['fisherman'] },
			},
			zones,
			characters: [
				{ id: 'bearBot', name: 'Bear (bot)', component: C.bear, brain: brainChase(SPEED.bear) },
				{
					id: 'fishermanBot',
					name: 'Fisherman (bot)',
					component: C.fisherman,
					brain: brainCast(SPEED.fisherman),
				},
			],
			online: {
				maxPlayers: 100,
				characters: [
					{ id: 'salmon', body: C.salmon, speed: SPEED.salmon },
					{ id: 'bear', body: C.bear, speed: SPEED.bear, max: 30, spawns: banks() },
					{
						id: 'fisherman',
						body: C.fisherman,
						speed: SPEED.fisherman,
						max: 20,
						spawns: banks().reverse(),
					},
				],
				spawn: { ...river.spawn },
				nearby: { w: 2400, h: 1800 },
				rules: {
					zones: rules,
					abilities: [
						{
							character: 'bear',
							button: 'ability1',
							reach: 110,
							targets: ['salmon'],
							effect: 'catch',
							ms: 3000,
							score: 1,
							cooldownMs: 1200,
						},
						{
							character: 'fisherman',
							button: 'ability1',
							reach: 280,
							targets: ['salmon'],
							effect: 'catch',
							ms: 4000,
							score: 2,
							cooldownMs: 3500,
						},
					],
					round: { seconds: 300, goalScore: 10 },
				},
				bots: {
					characters: [
						{ character: 'bear', brain: 'bearBot' },
						{ character: 'fisherman', brain: 'fishermanBot' },
					],
					spawns: banks(),
				},
			},
		},
	};
}
