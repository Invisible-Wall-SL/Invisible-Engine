/**
 * SALMONS' OWN RULES (`docs/design/phase-11.md` P11.3, `docs/design/realtime-multiplayer.md` §4):
 * the rules modules of `onlineRules.js` `ONLINE_RULES_MODULES` for what Salmons' data cannot say.
 * They run on the game server only; a device draws what the room reports. Rocks and waterfalls
 * that block are not here: they are solids of the level (`online.js` `onlineLevel`), which a device
 * predicts.
 *
 * - `waterfallClimb`: a salmon at the foot of a waterfall (a zone rule of `kind: 'waterfall'`, a
 *   one-way solid that stops it from below) climbs it by tapping jump. Each tap adds
 *   {@link CLIMB}`.tap` of the height, the height drains while it waits, and at the top the salmon
 *   is lifted over the waterfall (`climbed`). Leaving the foot drops the height.
 * - `sandbanks`: a free salmon whose centre comes onto a sandbank (`kind: 'sandbank'`) is
 *   `grounded`, held still and still catchable, until it taps jump (`grounded`, `jumped`); it is not
 *   grounded again before its centre has left the sand.
 * - `fishingLine`: a `hook` ability hooks the nearest target in reach (`hooked`): the target is held
 *   and reeled towards its fisherman at {@link LINE}`.reelPxPerSecond`, and landed within
 *   `landPx` of it, which is the catch (`caught`, effect `hook`: out for the ability's `ms`, the
 *   ability's score to the fisherman). One line per fisherman. The salmon escapes with `escapeTaps`
 *   taps of jump; the line also breaks when the fisherman drops or is held (`escaped`).
 * - `goldenSalmon`: one salmon of the room is golden (its `mark`), chosen from the room's seed and
 *   the round at each round's start, and again whenever no salmon in the room is golden (`golden`).
 *   A catch of it, and its goal, score {@link GOLDEN_WORTH} times as much.
 * - `salmons`: all four, the module Salmons' config names.
 *
 * Plain, dependency-free ESM, deterministic: no clock and no `Math.random`; a choice is a hash of
 * the room's seed. It reaches the rules' status codes and helpers through the `api`
 * `createOnlineRules` passes, so it does not import `onlineRules.js` back.
 */

import { BUTTONS } from './online.js';
import { aabbOf } from './motion.js';

/** The character these rules are for. */
const SALMON = 'salmon';

/** The climb: a tap's share of the height, how fast the height drains, and how close below a
 *  waterfall a salmon is at its foot, px. */
export const CLIMB = Object.freeze({ tap: 0.25, drainPerSecond: 0.6, footPx: 8 });

/** The line: how fast it reels, px/s; how close to its fisherman a salmon is landed, px; the taps
 *  that shake the hook. */
export const LINE = Object.freeze({ reelPxPerSecond: 200, landPx: 60, escapeTaps: 5 });

/** What a catch of the golden salmon, or its goal, is worth against any other salmon's. */
export const GOLDEN_WORTH = 3;

/** Whether this input presses jump where the last one under `key` did not (a tap). */
const tapped = (player, input, key) => {
	const down = (input.buttons & BUTTONS.jump) !== 0;
	const was = player.memo[key] === 1;
	player.memo[key] = down ? 1 : 0;
	return down && !was;
};

/** The zones whose rules have this `kind`, with the characters those rules name. */
const zonesOfKind = (game, kind) => {
	const byId = new Map(game.zones.map((zone) => [zone.id, zone]));
	return (game.online.rules.zones ?? [])
		.filter((rule) => rule.kind === kind && byId.has(rule.zone))
		.map((rule) => {
			const { id, x, y, w, h } = byId.get(rule.zone);
			return { id, x, y, w, h, characters: rule.characters };
		});
};

const appliesTo = (zone, player) =>
	!zone.characters || zone.characters.includes(player.character.id);

const centreIn = (body, z) =>
	body.x >= z.x && body.x <= z.x + z.w && body.y >= z.y && body.y <= z.y + z.h;

/** A 32-bit hash of whole numbers: the same everywhere. */
const mix = (...values) => {
	let h = 0x811c9dc5;
	for (const v of values) {
		h = Math.imul(h ^ (v >>> 0), 0x01000193);
		h ^= h >>> 15;
	}
	return h >>> 0;
};

const waterfallClimb = {
	create(game, api) {
		const falls = zonesOfKind(game, 'waterfall');
		const footOf = (player) => {
			const box = aabbOf(player.body);
			return falls.find(
				(z) =>
					appliesTo(z, player) &&
					box.x1 > z.x &&
					box.x0 < z.x + z.w &&
					Math.abs(box.y0 - (z.y + z.h)) <= CLIMB.footPx,
			);
		};
		if (!falls.length) return {};
		return {
			input(player, input, world) {
				const tap = tapped(player, input, 'climbTap');
				if (player.status !== api.STATUS.free) return;
				const fall = footOf(player);
				if (!fall) {
					player.memo.climb = 0;
					return;
				}
				if (!tap) return;
				const height = (player.memo.climb ?? 0) + CLIMB.tap;
				if (height < 1) {
					player.memo.climb = height;
					return;
				}
				player.memo.climb = 0;
				player.body.y = fall.y - (player.body.y - aabbOf(player.body).y0);
				world.emit({ type: 'climbed', id: player.id, zone: fall.id });
			},
			step(world) {
				const drain = CLIMB.drainPerSecond / world.tickHz;
				for (const p of world.players) {
					if (p.memo.climb) p.memo.climb = Math.max(0, p.memo.climb - drain);
				}
			},
		};
	},
};

const sandbanks = {
	create(game, api) {
		const banks = zonesOfKind(game, 'sandbank');
		if (!banks.length) return {};
		return {
			input(player, input, world) {
				const tap = tapped(player, input, 'sandTap');
				if (player.status !== api.STATUS.grounded || !tap) return;
				api.release(player);
				world.emit({ type: 'jumped', id: player.id });
			},
			step(world) {
				for (const p of world.players) {
					if (!p.connected) continue;
					const sand = banks.find((z) => appliesTo(z, p) && centreIn(p.body, z));
					if (!sand) {
						p.memo.onSand = 0;
						continue;
					}
					if (p.status !== api.STATUS.free || p.memo.onSand) continue;
					p.memo.onSand = 1;
					p.status = api.STATUS.grounded;
					p.until = 0;
					world.emit({ type: 'grounded', id: p.id, zone: sand.id });
				}
			},
		};
	},
};

const fishingLine = {
	create(game, api) {
		/** Fisherman id → its line: the hooked player's id, and what landing it does. */
		const lines = new Map();
		/** Hooked player id → its fisherman's id. */
		const hookedBy = new Map();
		const reel = LINE.reelPxPerSecond / game.online.tickHz;
		const cut = (by) => {
			const line = lines.get(by);
			lines.delete(by);
			if (line) hookedBy.delete(line.target);
		};
		return {
			reset() {
				lines.clear();
				hookedBy.clear();
			},
			hook(user, target, ability, world) {
				if (lines.has(user.id) || hookedBy.has(target.id)) return false;
				target.status = api.STATUS.hooked;
				target.until = 0;
				target.memo.escape = 0;
				lines.set(user.id, { target: target.id, score: ability.score, hold: ability.hold });
				hookedBy.set(target.id, user.id);
				world.emit({ type: 'hooked', by: user.id, target: target.id });
				return true;
			},
			input(player, input, world) {
				const tap = tapped(player, input, 'lineTap');
				const by = hookedBy.get(player.id);
				if (by === undefined || player.status !== api.STATUS.hooked || !tap) return;
				player.memo.escape = (player.memo.escape ?? 0) + 1;
				if (player.memo.escape < LINE.escapeTaps) return;
				cut(by);
				api.free(player, world.stamp);
				world.emit({ type: 'escaped', by, target: player.id });
			},
			step(world) {
				if (!lines.size) return;
				const byId = new Map(world.players.map((p) => [p.id, p]));
				for (const [by, line] of [...lines]) {
					const fisher = byId.get(by);
					const fish = byId.get(line.target);
					if (!fish || fish.status !== api.STATUS.hooked) {
						cut(by);
						continue;
					}
					if (!fisher || !fisher.connected || fisher.status !== api.STATUS.free) {
						cut(by);
						api.free(fish, world.stamp);
						world.emit({ type: 'escaped', by, target: fish.id });
						continue;
					}
					const dx = fisher.body.x - fish.body.x;
					const dy = fisher.body.y - fish.body.y;
					const d = Math.hypot(dx, dy);
					if (d <= LINE.landPx + reel) {
						cut(by);
						fish.status = api.STATUS.out;
						fish.until = world.stamp + line.hold;
						api.score(fisher, api.worth(fish, line.score));
						world.emit({ type: 'caught', by, target: fish.id, effect: 'hook' });
						continue;
					}
					fish.body.x += (dx / d) * reel;
					fish.body.y += (dy / d) * reel;
				}
			},
		};
	},
};

const goldenSalmon = {
	create() {
		const pick = (world) => {
			const live = [];
			for (const p of world.players) {
				if (p.character.id !== SALMON) continue;
				if (p.connected) {
					if (p.mark) return;
					live.push(p);
				}
			}
			for (const p of world.players) if (p.character.id === SALMON) p.mark = false;
			if (!live.length) return;
			const golden = live[mix(world.seed, world.round, world.stamp) % live.length];
			golden.mark = true;
			world.emit({ type: 'golden', id: golden.id });
		};
		return {
			reset: pick,
			step: pick,
			worth: (player, points) =>
				player.mark && player.character.id === SALMON ? points * GOLDEN_WORTH : points,
		};
	},
};

/** Several modules' hooks as one module's: each hook runs every part's, in order. */
const together = (game, api, parts) => {
	const made = parts.map((part) => part.create(game, api));
	const each = (name) => {
		const hooks = made.map((m) => m[name]).filter(Boolean);
		return hooks.length
			? (...args) => {
					for (const hook of hooks) hook(...args);
				}
			: undefined;
	};
	return {
		step: each('step'),
		input: each('input'),
		reset: each('reset'),
		hook: (...args) => made.some((m) => m.hook?.(...args) === true),
		worth: (player, points) => made.reduce((p, m) => (m.worth ? m.worth(player, p) : p), points),
	};
};

const salmons = {
	create: (game, api) =>
		together(game, api, [sandbanks, waterfallClimb, fishingLine, goldenSalmon]),
};

/** Salmons' entries of `ONLINE_RULES_MODULES`. Object literals only, so a runtime that never runs a
 *  room (every one but `arcade`) drops them. */
export const SALMONS_RULES = { waterfallClimb, sandbanks, fishingLine, goldenSalmon, salmons };
