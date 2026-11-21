/**
 * SALMONS' OWN RULES (`docs/design/phase-11.md` P11.3, `docs/design/realtime-multiplayer.md` §4):
 * the rules modules of `onlineRules.js` `ONLINE_RULES_MODULES` for what Salmons' data cannot say.
 * They run on the game server only; a device draws what the room reports. Rocks and waterfalls
 * that block are not here: they are solids of the level (`online.js` `onlineLevel`), which a device
 * predicts.
 *
 * - `waterfallClimb`: the original's climb (`GuiltyForever/Salmon-` 41811c2 `server/index.js`, the
 *   jump handler and `update`), in its grid cells ({@link CELL} px). A waterfall (a zone rule of
 *   `kind: 'waterfall'`, a one-way solid that stops a salmon from below) is as high as its zone's
 *   `height` (cells; 1 when it has none). A tap of jump by a salmon on its downstream side, within
 *   {@link CLIMB}`.radiusSq` of it and below its height, lifts it {@link CLIMB}`.step` (at most to
 *   the top) and holds it there: it climbs, and the tap does not leap. While it climbs it is held
 *   still and slides back {@link CLIMB}`.slidePerSecond`; at the top it is let go at that height
 *   (`climbed`), on the downstream side still, and falls under the leap's gravity; out of reach it
 *   is let go; at the bottom it is let go on the water. A salmon at least as high as a waterfall
 *   passes over it: the room steps it without that solid (`level`). Let go at the top, it passes
 *   that waterfall until it is back on the water; an original level's waterfall (`aloft` on its
 *   rule) only while it is still as high, so, as in the original, it keeps tapping at the top
 *   (each tap climbs it back there) while it steers upstream. There is no teleport.
 * - `sandbanks`: a free salmon on the water on a sandbank (`kind: 'sandbank'`: its centre in the
 *   zone, or, for a run of cells, within {@link SAND_REACH} cells of one of their centres) is
 *   `grounded`, held still and still catchable, until it taps jump (`grounded`, `jumped`); it is
 *   not grounded again before its centre has left the sand. Inside `salmons`, on an original
 *   level's sand (a rule with `cell`), it is grounded again every time it comes down on it, as the
 *   original's (not while its leap off the sand rises, nor in the step its tap let it go).
 * - `bridges`: a fisherman walks across a bridge on its deck, as high as it ({@link bridges}).
 * - `salmonJump` (in `salmons` only): the original's leap (`GuiltyForever/Salmon-` 41811c2
 *   `server/index.js` `onMessage('jump')` and `update`). A tap of jump by a free salmon on the
 *   water (its height `z` 0) launches it up at {@link JUMP}`.launch` cells/s, and it falls back
 *   under `JUMP.gravity` cells/s²: about 1.1 s in the air, its top about 3 cells up (`jumped`). A
 *   tap that climbs a waterfall does not leap; a tap that leaves a sandbank does, as the old
 *   server's did. In the air it is not grounded on sand nor hooked. It leaps towards the tapped
 *   point (the input's `aim`), else along its last move ({@link leapMove}), and carries that move
 *   while the stick rests until it is back on the water or steers (`carry`, which the room sends
 *   so a device predicts it). Half a cell up it passes over rocks and whirlpools (`lowPieces`).
 * - `fishingLine`: the original's travelling line (`GuiltyForever/salmon-` fb907fb `server/index.js`
 *   `onMessage('cast')` and the fisherman's `update`). A `hook` ability casts it at the input's aim
 *   when the fisherman has no line out. Not the original's: the line reaches only as far as he sees
 *   ({@link SIGHT}, a standard screen about him; `sees`, which a bot's aim is held to as well), so
 *   an aim past that is pulled in along its line to the sight's edge ({@link pullIntoSight}). The
 *   bobber lands there when that is on the river's water, and every step after the fisherman moved
 *   it is reeled home at {@link LINE}`.reelCellsPerSecond`. Until it hooks one, the first target in
 *   player order that is on the water (free or grounded, no higher than `CLEAR.hook`) within the
 *   ability's `reach` of the bobber is `hooked` and dragged with the bobber; within
 *   `LINE.landCells` of the fisherman the line is home and a hooked salmon is landed (`caught`,
 *   effect `hook`: out, the ability's score to the fisherman). There is no escape; the line breaks
 *   only when its fisherman drops or is held (`escaped`). The line is the fisherman's `lineX`,
 *   `lineY`, `lineActive`, which the room sends. A bot aims its cast as {@link BOT_AIM} says
 *   (`botAim.aimed`): after a reaction time, and short on a long cast.
 * - `goldenSalmon`: the last game's winner, rejoining as a salmon, is golden (its `mark`, from the
 *   player's `wonLast`, which only the server sets): cosmetic, it scores as any other.
 * - `bloodstains` (in `salmons` only): the original's bloodstains (`GuiltyForever/Salmon-` PR #8,
 *   `addBloodstain`). A salmon caught leaves a stain where it died: a bear's catch where it is, a
 *   line's landing where it was hooked (it is reeled onto the bank before it is landed). Stains stay
 *   for the room's life, through every round; past {@link STAINS}`.max` the oldest goes. The room
 *   sends them to every device (`stains`), which draws them and reddens a salmon swimming through.
 * - `botSalmon` (in `salmons` only): a BOT salmon's swim ({@link BOT_SWIM}; the rules' `botPlay`,
 *   since a brain's behaviours know nothing of a river), through the move and the jump button a
 *   person has. At the source it wins the game as a person's salmon does (the config's
 *   `bots.canWin`; owner, 2026-11-21).
 * - `salmons`: all of them, the module Salmons' config names, and the bear bots' reaction time
 *   ({@link BOT_SWIPE}: their swipe is a plain `catch` ability with no module of its own).
 *
 * Plain, dependency-free ESM, deterministic: no clock and no `Math.random`. It reaches the rules'
 * status codes and helpers through the `api` `createOnlineRules` passes, so it does not import
 * `onlineRules.js` back.
 */

import { BUTTONS, MOVE_SCALE, carriedInput, clampInput } from './online.js';
import { createStaticIndex } from './motion.js';
import { CELL, SALMONS_MAP } from './salmonsMap.js';

/** The character these rules are for. */
const SALMON = 'salmon';

/** The original's climb, in its grid cells: the reach (`WATERFALL_CLIMB_RADIUS_SQ`, cells²), a
 *  tap's lift (`WATERFALL_CLIMB_STEP`, cells) and the slide back (`WATERFALL_SLIDE_RATE`,
 *  cells/s). */
export const CLIMB = Object.freeze({ radiusSq: 4, step: 2.4, slidePerSecond: 0.8 });

/** The leap, in the old server's grid cells ({@link CELL} px): the launch speed (`vz = 11`) and the
 *  pull (`vz -= 20 * dt`), cells/s and cells/s². */
export const JUMP = Object.freeze({ launch: 11, gravity: 20 });

/** Heights (cells) above which a leaping salmon is clear of the water's rules, as the old server's:
 *  it is not grounded on a sandbank above `sand`, nor hooked above `hook`; above `steer` a move of
 *  0 does not stop it (it carries its leap's move). */
export const CLEAR = Object.freeze({ sand: 0.05, hook: 0.1, steer: 0.05 });

/** How near a sand cell's centre a salmon is on it, cells (the original's `onSandbank`, < 0.64
 *  cells²). */
export const SAND_REACH = 0.8;

/** How far a bridge's slopes run onto the banks, cells (the original's `slopeLen`). */
export const BRIDGE_SLOPE = 2;

/** Heights (cells) at which a salmon passes over a low piece, as the old server's: a rock blocks
 *  it, and a whirlpool pulls it, only while it is lower (`obstacleHeight` 0.5; the whirlpool's
 *  `z < 0.5`). */
export const OVER = Object.freeze({ rock: 0.5, whirlpool: 0.5 });

/**
 * The leap's direction, as the original's jump handler (its grid cells: `vx` along the river, `vy`
 * across it; here `y` is along and `x` across, `salmonsMap.js`): to the tapped point when it is more
 * than `deadZone` cells away, else the last move (`fallback` before any), as a unit vector, then
 * `along` × the speed along the river and `across` × across it.
 */
export const LEAP_AIM = Object.freeze({
	deadZone: 0.5,
	along: 1,
	across: 0.9,
	/** The original's `{ vx: 0.7, vy: -0.7 }`: `vx` along (here y), `vy` across (here x). */
	fallback: Object.freeze({ x: -0.7, y: 0.7 }),
	/** A move shorter than this (of a full one) is not a direction (`|v| > 0.01`). */
	minMove: 0.01,
});

/** The most inputs a leap is carried for: a uint8 on the wire. */
const AIR_MAX = 254;

/**
 * The leap's move (whole input units, {@link MOVE_SCALE} a full one) for a tap of `input` by a body
 * at `body` whose last move was `last` (`{ x, y }`, input units, or none): {@link LEAP_AIM}. A tap
 * with no aim (`aimX` and `aimY` 0, as a key's) uses the last move.
 */
export function leapMove(body, input, last) {
	let x;
	let y;
	const aimX = input.aimX ?? 0;
	const aimY = input.aimY ?? 0;
	if (aimX !== 0 || aimY !== 0) {
		const tx = (aimX - body.x) / CELL;
		const ty = (aimY - body.y) / CELL;
		const d = Math.hypot(tx, ty);
		if (d > LEAP_AIM.deadZone) {
			x = tx / d;
			y = ty / d;
		}
	}
	if (x === undefined) {
		const lx = last ? last.x : LEAP_AIM.fallback.x;
		const ly = last ? last.y : LEAP_AIM.fallback.y;
		const d = Math.hypot(lx, ly);
		x = lx / d;
		y = ly / d;
	}
	const { moveX, moveY } = clampInput({
		moveX: x * LEAP_AIM.across * MOVE_SCALE,
		moveY: y * LEAP_AIM.along * MOVE_SCALE,
	});
	return { moveX, moveY };
}

/**
 * How many of a salmon's next inputs find it above {@link CLEAR}`.steer`, one a step, from its
 * height `z` and climb `vz` (px, px/s) after a step: the fall's own stepping (`fall` below), at most
 * {@link AIR_MAX}.
 */
export function stepsAloft(z, vz, tickHz) {
	const dt = 1 / tickHz;
	const pull = JUMP.gravity * CELL;
	const floor = CLEAR.steer * CELL;
	let n = 0;
	let h = z;
	let v = vz;
	while (h > floor && n < AIR_MAX) {
		n += 1;
		const next = h + v * dt;
		v -= pull * dt;
		h = next > 0 ? next : 0;
	}
	return n;
}

const above = (player, cells) => (player.z ?? 0) > cells * CELL;

/** What a tap of jump already did this input, for `salmonJump`: a sandbank's release (it leaps,
 *  already announced) or a climb (it does not leap). */
const TAP = Object.freeze({ released: 1, climbed: -1 });

/** The line, in the original's cells: how fast it reels home (`reelSpeed`), how close to its
 *  fisherman it is home (`ldist < 0.3`), and how near the fisherman a cast may not land (`0.1`). */
export const LINE = Object.freeze({ reelCellsPerSecond: 8, landCells: 0.3, minCastCells: 0.1 });

/**
 * A fisherman's sight, which is as far as his line reaches (owner, 2026-11-19: he casts only as far
 * as he can see). The room cannot see a device's window and a bot has none, so every fisherman has
 * the same standard screen: `screen` window px with him at its centre, a cell drawn `tile` window
 * px, the original's desktop tile (the cell's 2:1 diamond, 2 × {@link CELL} by `CELL` = 96 × 48,
 * at the camera's desktop zoom of 2/3: `engine-layout` `SALMONS_CAMERA.zoom`, which
 * `check:salmons-jump` holds this to). A larger window, a tablet or a phone held upright (zoom
 * 1/3) shows more; the line still reaches this far.
 */
export const SIGHT = Object.freeze({
	screen: Object.freeze({ w: 1920, h: 1080 }),
	tile: Object.freeze({ w: 64, h: 32 }),
});

/**
 * How far `at` is from `from` across the standard screen, as a share of the way to its edge (1 on
 * it), the larger of its two axes. On the 2:1 view a cell along x or y is half a tile across the
 * screen and half a tile down it: across is `dx − dy` half tiles and down `dx + dy`, so the edge is
 * 30 cells across and 33.75 down. Mirrored (as the river is drawn) only across changes its sign:
 * the same box.
 */
const sightShare = (from, at) => {
	const dx = (at.x - from.x) / CELL;
	const dy = (at.y - from.y) / CELL;
	return Math.max(
		(Math.abs(dx - dy) * SIGHT.tile.w) / SIGHT.screen.w,
		(Math.abs(dx + dy) * SIGHT.tile.h) / SIGHT.screen.h,
	);
};

/** Whether a world point is in the sight of a fisherman at `from` (both `{ x, y }`, world px): on
 *  his standard screen ({@link SIGHT}), its edge included. */
export const inSight = (from, at) => sightShare(from, at) <= 1;

/** An aim pulled in along the line from the fisherman at `from` until it is in his sight: `aim`
 *  itself when it already is, else where that line crosses the edge of his standard screen. */
export function pullIntoSight(from, aim) {
	const share = sightShare(from, aim);
	if (share <= 1) return aim;
	return { x: from.x + (aim.x - from.x) / share, y: from.y + (aim.y - from.y) / share };
}

/**
 * How a BOT fisherman aims (owner, 2026-11-20: soften the bots' aim): a person's eye and hand, not a
 * machine's. A person's cast is not touched, nor the room's rule for a cast: these only shape the
 * input a bot sends (`onlineBots.js` `botInput`'s `aim`, through this module's `botAim`). Not the
 * original's, which has no bots. Tuned on the shipped level against a room of bots
 * (`docs/status/salmons.md`, Recent changes, 2026-11-20).
 */
export const BOT_AIM = Object.freeze({
	/** How long a salmon must have been in his sight before he casts at it, ms: drawn between the
	 *  two for each salmon as it comes into his sight, and again for every one when his line comes
	 *  home. Longer: fewer casts at a salmon swimming by, and more time to pass him after a miss. */
	reactMs: Object.freeze({ min: 700, max: 1500 }),
	/** He casts at what he saw this long ago, ms (drawn for each cast between the two): his cast
	 *  lands to the side of the salmon by as far as it moved in that time, on the side it came from.
	 *  A salmon that keeps still is hit (one resting on the current drifts 1.5 cells/s, at most 1.05
	 *  cells in this time: the hook's 1.5 cells still take it); one swimming up against the current
	 *  (about 4.5 cells/s) is missed by 2 to 3 cells. No longer than `reactMs.min`: he looks back no
	 *  further than he has watched (`check:room-bots` holds it). Across his line, not along it: a bobber short
	 *  of a salmon coming at him is swum into, one beyond it is reeled home through it. Longer: he
	 *  misses a swimmer by more, and a drifting salmon too past 1 s. */
	lagMs: Object.freeze({ min: 500, max: 700 }),
	/** After a cast he rests this long before he watches the water again, ms (drawn between the
	 *  two), counted from the cast, a cast the room refused too: he reels in, looks and casts again, so
	 *  his casts at one salmon come at least this and a reaction time apart (the room's own 250 ms
	 *  cooldown, a person's, is untouched).
	 *  Longer: fewer casts at a salmon swimming by; a still one waits longer for a second cast. */
	restMs: Object.freeze({ min: 2500, max: 4000 }),
	/** A cast no longer than this lands on the salmon, cells. Larger: he does not miss from further
	 *  off, and a salmon passing close to his bank is hooked more surely. */
	sureCells: 4,
	/** A longer cast falls short: the bobber lands up to this share of the cast's length past
	 *  `sureCells` nearer him than the salmon, and up to half of that to either side. Larger: his
	 *  long casts hook less often (the hook reaches 1.5 cells: at 0.5 a salmon that keeps still is
	 *  hooked for sure from 6 cells, by about 3 casts in 10 from 10 cells, 1 in 8 from 14, 1 in 20
	 *  from 20 and 1 in 50 from 30). A miss never lands beyond the salmon: the line is reeled home
	 *  through whatever is on its way, so that would be no miss. */
	spread: 0.5,
});

/**
 * How a BOT bear swipes (owner, 2026-11-20: "give the bear bots a reaction time too"): a person's
 * hand, not a machine's. As {@link BOT_AIM}: a person's swipe is not touched, nor the room's rule
 * for a swipe, its reach or its cooldown; this only shapes the input a bot sends (`botInput`'s
 * `aim.inReach`, through `salmons`' `botAim`).
 */
export const BOT_SWIPE = Object.freeze({
	/** How long a player must have been within his reach before he swipes at it, ms: drawn between
	 *  the two for each player as it comes within reach, again if it leaves and comes back, and
	 *  again for every one after each swipe. The slow end of what a person does. Longer: a player
	 *  that only crosses his reach gets by, and a swipe that misses is not followed by another at
	 *  once; a salmon he walks along with (within his reach for a median 3 s) is taken all the
	 *  same (`docs/status/salmons.md`, Recent changes, 2026-11-20). */
	reactMs: Object.freeze({ min: 500, max: 1000 }),
});

/**
 * How a BOT salmon swims (owner, 2026-11-20: "we also need to have Fish bots!"): a person's eye and
 * hand at a person's controls, not a machine's. As {@link BOT_AIM}: nothing of a person's salmon or
 * of the room's rules is touched; these only shape the input a bot sends (`botInput`'s `play`,
 * through `salmons`' `botPlay`). Tuned on the shipped level in rooms of bots
 * (`scripts/salmons/measure-room.mjs`; `docs/status/salmons.md`, Recent changes, 2026-11-20).
 */
export const BOT_SWIM = Object.freeze({
	/** How long a bear or a fisherman must have been near it (`noticeCells`), or a line out, before
	 *  it steers by it, ms: drawn between the two for each as it comes near, again if it goes and
	 *  comes back; and how long it lies on a sandbank before it jumps off. Longer: a bear that comes
	 *  at it gets nearer before it turns. */
	reactMs: Object.freeze({ min: 300, max: 700 }),
	/** How often it picks its way anew, ms (drawn between the two after each look): between two
	 *  looks it keeps its heading, so it steers by where a bear was up to this long ago. Longer: it
	 *  turns later for a bear that moves, and cuts corners round rocks and sand closer. */
	lookMs: Object.freeze({ min: 250, max: 450 }),
	/** How far off the way it picked its heading is, degrees to either side (drawn at each look).
	 *  Larger: it weaves more, and brushes what it meant to pass. */
	wobbleDeg: 12,
	/** The time between two of its taps of jump, ms (drawn after each): 4 to 8 taps a second, a
	 *  person's on one key. Longer: it climbs a waterfall more slowly (it slides back between). */
	tapMs: Object.freeze({ min: 130, max: 260 }),
	/** How near a bear or a fisherman must be for it to mind him, cells: well inside what its
	 *  screen shows (`sees`), as a person watches the water about his fish, not the screen's edge.
	 *  Larger: it gives bears a wider berth, and turns back from more of them. */
	noticeCells: 12,
	/** Making less than a cell of way for this long (ms, drawn between the two), it takes itself
	 *  to be stuck (a bot is told of no wall: a rock's corner, a bank, sand) and leaps aside towards
	 *  the open water. Longer: it stays pressed against what stopped it longer. */
	stuckMs: Object.freeze({ min: 600, max: 1000 }),
});

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
			const { id, x, y, w, h, height } = byId.get(rule.zone);
			return {
				id,
				x,
				y,
				w,
				h,
				height,
				characters: rule.characters,
				cell: rule.cell,
				aloft: rule.aloft === true,
			};
		});
};

const appliesTo = (zone, player) =>
	!zone.characters || zone.characters.includes(player.character.id);

const centreIn = (body, z) =>
	body.x >= z.x && body.x <= z.x + z.w && body.y >= z.y && body.y <= z.y + z.h;

/** A waterfall's height, cells: its zone's, else the original's lowest. */
export const fallHeight = (zone) => zone.height ?? SALMONS_MAP.WATERFALL_HEIGHT_MIN;

/**
 * The waterfalls of a game, as the climb measures them: the line they stand on (the middle of the
 * zone), their height in cells (`top`) and px, and the original's obstacle cells across the river
 * (`cells`, from the water band that starts at the line: one centred at each
 * `left + (k + ½)·CELL`, as `salmonsMap` places a cell's pieces), or none when no band does.
 */
export const waterfallsOf = (game) =>
	zonesOfKind(game, 'waterfall').map((zone) => {
		const line = zone.y + zone.h / 2;
		const water = game.zones.find((w) => /^band\d+Water$/.test(w.id) && w.y === line);
		const top = fallHeight(game.zones.find((z) => z.id === zone.id));
		return {
			...zone,
			line,
			top,
			height: top * CELL,
			cells: water ? { left: water.x, count: Math.round(water.w / CELL) } : undefined,
		};
	});

/** How far a body is from a waterfall's nearest obstacle cell, cells², as the original measures
 *  it: along the river from its line, across from the centre of the column's nearest cell (the
 *  zone's edges when it has no cells). */
export const fallReachSq = (fall, body) => {
	const along = (body.y - fall.line) / CELL;
	let across;
	if (fall.cells) {
		const at = (body.x - fall.cells.left) / CELL - 0.5;
		across = at - Math.min(fall.cells.count - 1, Math.max(0, Math.round(at)));
	} else across = Math.max(0, fall.x - body.x, body.x - fall.x - fall.w) / CELL;
	return along * along + across * across;
};

/** A climber's height, kept in the original's cells while it climbs so a step is the original's
 *  to the bit, and as the room's `z` (px). */
const climbTo = (player, cells) => {
	player.memo.climbZ = cells;
	player.z = cells * CELL;
};

const waterfallClimbing = {
	create(game, api) {
		const falls = waterfallsOf(game);
		if (!falls.length) return {};
		const heights = [...new Set(falls.map((f) => f.height))].sort((a, b) => a - b);
		/** A level → the same level without the waterfalls a player passes, by how many heights it
		 *  clears and the waterfall it topped. */
		const cleared = new WeakMap();
		// A salmon let go at a waterfall's top passes it until it is back on the water, unless the
		// waterfall is an original level's (`aloft`): the original lets it pass only while it is
		// still as high, and it taps on at the top. P10.16's band river keeps the pass, as its traces
		// were recorded with it.
		const inReach = (fall, player) =>
			appliesTo(fall, player) && fallReachSq(fall, player.body) < CLIMB.radiusSq;
		return {
			holds: (player) => player.memo.climbing === 1,
			input(player, input) {
				const tap = tapped(player, input, 'climbTap');
				if (!tap || player.status !== api.STATUS.free) return;
				if (player.memo.leapTap === TAP.released) return;
				const z = player.memo.climbing === 1 ? player.memo.climbZ : (player.z ?? 0) / CELL;
				const fall = falls.find((f) => player.body.y > f.line && z < f.top && inReach(f, player));
				if (!fall) return;
				climbTo(player, Math.min(fall.top, z + CLIMB.step));
				player.memo.climbFall = falls.indexOf(fall);
				player.memo.over = 0;
				player.memo.vz = 0;
				player.memo.climbing = 1;
				player.memo.leapTap = TAP.climbed;
			},
			step(world) {
				const slide = CLIMB.slidePerSecond / world.tickHz;
				for (const p of world.players) {
					if (p.memo.climbing !== 1) continue;
					// The waterfall its tap climbs (the original finds any in reach; two never are, 40
					// columns apart, but an overlay could set them closer).
					const climbed = falls[p.memo.climbFall];
					const fall = p.status === api.STATUS.free && inReach(climbed, p) && climbed;
					if (!fall) {
						p.memo.climbing = 0;
						p.memo.letGo = 1;
						continue;
					}
					p.memo.vz = 0;
					if (p.memo.climbZ >= fall.top) {
						climbTo(p, fall.top);
						p.memo.climbing = 0;
						p.memo.letGo = 1;
						p.memo.over = fall.aloft ? 0 : falls.indexOf(fall) + 1;
						world.emit({ type: 'climbed', id: p.id, zone: fall.id });
						continue;
					}
					climbTo(p, p.memo.climbZ - slide);
					if (p.memo.climbZ <= 0) {
						climbTo(p, 0);
						p.memo.climbing = 0;
					}
				}
			},
			level(player, level) {
				const z = player.z ?? 0;
				if (!(z > 0) || !level?.solids) return level;
				let n = 0;
				while (n < heights.length && heights[n] <= z) n += 1;
				const topped = player.memo.over ?? 0;
				if (!n && !topped) return level;
				let byKey = cleared.get(level);
				if (!byKey) cleared.set(level, (byKey = new Map()));
				const key = `${n}:${topped}`;
				let passable = byKey.get(key);
				if (!passable) {
					const gone = new Set(
						falls
							.filter((f, i) => (n && f.height <= heights[n - 1]) || i === topped - 1)
							.map((f) => f.id),
					);
					passable = {
						...level,
						solids: createStaticIndex(
							level.solids.shapes.filter((s) => !gone.has(s.id)),
							level.solids.cellSize,
						),
					};
					byKey.set(key, passable);
				}
				return passable;
			},
		};
	},
};

/** Whether a body is on a sandbank: within {@link SAND_REACH} cells of one of its cells' centres
 *  when it is a run of cells (`cell` px a side, as the original's `onSandbank`), else its centre in
 *  the zone. */
const onSand = (body, zone) => {
	const { cell } = zone;
	if (!cell) return centreIn(body, zone);
	const nearest = (v, from, size) =>
		from +
		(Math.min(Math.round(size / cell) - 1, Math.max(0, Math.floor((v - from) / cell))) + 0.5) *
			cell;
	const dx = body.x - nearest(body.x, zone.x, zone.w);
	const dy = body.y - nearest(body.y, zone.y, zone.h);
	return dx * dx + dy * dy < (SAND_REACH * cell) ** 2;
};

/**
 * The sandbanks: `regrounds` (inside `salmons`, which also plays the leap off the sand) grounds a
 * salmon on an original level's sand (a zone with `cell`) every time it comes down on it, as the
 * original; anywhere else, once a visit (the latch: not again before its centre has left the sand),
 * so a salmon a tap frees without a leap is never held there for good.
 */
const sandbanksOf = (regrounds) => ({
	create(game, api) {
		const banks = zonesOfKind(game, 'sandbank');
		if (!banks.length) return {};
		return {
			input(player, input, world) {
				const tap = tapped(player, input, 'sandTap');
				if (player.status !== api.STATUS.grounded || !tap) return;
				api.release(player);
				player.memo.leapTap = TAP.released;
				player.memo.sandFree = world.stamp;
				world.emit({ type: 'jumped', id: player.id });
			},
			step(world) {
				for (const p of world.players) {
					if (!p.connected) continue;
					const sand = banks.find((z) => appliesTo(z, p) && onSand(p.body, z));
					if (!sand) {
						p.memo.onSand = 0;
						continue;
					}
					if (p.status !== api.STATUS.free || above(p, CLEAR.sand)) continue;
					if (regrounds && sand.cell) {
						// Not the step a tap let it go, nor while its leap off the sand rises.
						if (p.memo.sandFree === world.stamp || p.memo.vz > 0) continue;
					} else {
						if (p.memo.onSand) continue;
						p.memo.onSand = 1;
					}
					p.status = api.STATUS.grounded;
					p.until = 0;
					world.emit({ type: 'grounded', id: p.id, zone: sand.id });
				}
			},
		};
	},
});

const sandbanks = sandbanksOf(false);

/** Whether a move is a direction: longer than {@link LEAP_AIM}`.minMove` of a full one. */
const isDirection = (input) => Math.hypot(input.moveX, input.moveY) > LEAP_AIM.minMove * MOVE_SCALE;

/** The leap's launch: a tap of jump by a free salmon on the water, in its direction
 *  ({@link leapMove}), carried until it steers (`carry`). A free salmon's moves are its last
 *  direction (the original's `playerLastDir`), but not one's that only left a sandbank. */
const leap = {
	create(game, api) {
		const launch = JUMP.launch * CELL;
		const hz = game.online.tickHz;
		/** Inputs a leap is carried for: the steps after its first that find it above
		 *  `CLEAR.steer` (the fall steps it from the ground the step it launches). */
		const leapAir = stepsAloft(launch / hz, launch - (JUMP.gravity * CELL) / hz, hz);
		return {
			input(player, input, world) {
				if (player.character.id !== SALMON) return;
				const tap = tapped(player, input, 'leap');
				const before = player.memo.leapTap;
				player.memo.leapTap = 0;
				if (player.status !== api.STATUS.free) return;
				if (before !== TAP.released && isDirection(input)) {
					player.memo.dirX = input.moveX;
					player.memo.dirY = input.moveY;
					player.memo.dir = 1;
				}
				if (!tap || before === TAP.climbed) return;
				if ((player.z ?? 0) > 0 || player.memo.vz) return;
				player.memo.vz = launch;
				const last = player.memo.dir === 1 ? { x: player.memo.dirX, y: player.memo.dirY } : null;
				const move = leapMove(player.body, input, last);
				player.air = leapAir;
				player.carryX = move.moveX;
				player.carryY = move.moveY;
				player.memo.moveX = move.moveX;
				player.memo.moveY = move.moveY;
				if (before !== TAP.released) world.emit({ type: 'jumped', id: player.id });
			},
		};
	},
};

/**
 * The leap's carried move (the original's `move` handler: above {@link CLEAR}`.steer` a move of 0
 * leaves a salmon's velocity as it was): the room steps a free salmon with `online.js`
 * `carriedInput`. As it goes up (a launch, or let go at a waterfall's top) it is given as many
 * inputs to carry for as the steps it will be that high ({@link stepsAloft}: `air`, with the move
 * `carryX` / `carryY`), spent one an input, which the room sends so a device folds the same. Counted
 * by inputs, not steps, a stall (steps with no input, when no body moves) pauses the carry with the
 * body, so the leap still covers the original's ground and the device's fold stays exact. Its
 * velocity (`moveX` / `moveY` in its notes) is the last move it was stepped with, or steered with
 * while it climbs. Grounded, 0; caught, hooked, grounded or climbing, it carries nothing.
 */
const carry = {
	create(game, api) {
		const clear = (p) => {
			if (p.air || p.carryX || p.carryY) {
				p.air = 0;
				p.carryX = 0;
				p.carryY = 0;
			}
		};
		return {
			steer(player, input) {
				if (player.character.id !== SALMON) return input;
				const moved = carriedInput(player, input);
				player.memo.moveX = moved.moveX;
				player.memo.moveY = moved.moveY;
				return moved;
			},
			input(player, input) {
				if (player.memo.climbing !== 1 || (input.moveX === 0 && input.moveY === 0)) return;
				player.memo.moveX = input.moveX;
				player.memo.moveY = input.moveY;
			},
			step(world) {
				for (const p of world.players) {
					if (p.character.id !== SALMON) continue;
					const climbing = p.memo.climbing === 1;
					// Let go from a climb this step (at the top, or out of reach): it falls from there,
					// carrying the move it last had.
					const letGo = p.memo.letGo === 1;
					p.memo.letGo = 0;
					if (p.status !== api.STATUS.free || climbing) {
						if (p.status === api.STATUS.grounded) {
							p.memo.moveX = 0;
							p.memo.moveY = 0;
						}
						clear(p);
						continue;
					}
					if (letGo) {
						p.air = stepsAloft(p.z ?? 0, p.memo.vz ?? 0, world.tickHz);
						p.carryX = p.memo.moveX ?? 0;
						p.carryY = p.memo.moveY ?? 0;
					}
					if (!p.air) clear(p);
				}
			},
		};
	},
};

/**
 * A salmon high enough passes over the low pieces of the river (the original's `update`): a rock
 * stops it only below {@link OVER}`.rock`, and a whirlpool pulls it only below `OVER.whirlpool`.
 * The room steps it on the level without them (`level`). The pieces are the river's `rock<n>` and
 * `whirlpool<n>` zones (`salmons.js` `salmonsGeometry`).
 */
const lowPieces = {
	create(game) {
		const ids = (pattern) => new Set(game.zones.filter((z) => pattern.test(z.id)).map((z) => z.id));
		const rocks = ids(/^rock\d+$/);
		const pools = ids(/^whirlpool\d+$/);
		if (!rocks.size && !pools.size) return {};
		const cleared = new WeakMap();
		const without = (index, gone) =>
			createStaticIndex(
				index.shapes.filter((s) => !gone.has(s.id)),
				index.cellSize,
			);
		return {
			level(player, level) {
				const z = player.z ?? 0;
				const overRocks = rocks.size > 0 && z >= OVER.rock * CELL;
				const overPools = pools.size > 0 && z >= OVER.whirlpool * CELL;
				if (!level || (!overRocks && !overPools)) return level;
				let byKey = cleared.get(level);
				if (!byKey) cleared.set(level, (byKey = new Map()));
				const key = (overRocks ? 1 : 0) + (overPools ? 2 : 0);
				let passable = byKey.get(key);
				if (!passable) {
					passable = {
						...level,
						currents: overPools ? without(level.currents, pools) : level.currents,
						solids: overRocks && level.solids ? without(level.solids, rocks) : level.solids,
					};
					byKey.set(key, passable);
				}
				return passable;
			},
		};
	},
};

/** The fall back to the water under the leap's gravity, for anything aloft that is not climbing
 *  nor on a bridge (the original's `update`: the climb or the gravity, one a step). Held, it is on
 *  the water. */
const fall = {
	create(game, api) {
		const pull = JUMP.gravity * CELL;
		return {
			step(world) {
				const dt = 1 / world.tickHz;
				for (const p of world.players) {
					const vz = p.memo.vz ?? 0;
					if ((!vz && !p.z) || p.memo.climbing === 1 || p.memo.bridge === 1) continue;
					if (p.status !== api.STATUS.free) {
						p.z = 0;
						p.memo.vz = 0;
						p.memo.over = 0;
						continue;
					}
					const z = (p.z ?? 0) + vz * dt;
					p.memo.vz = vz - pull * dt;
					if (z > 0) p.z = z;
					else {
						p.z = 0;
						p.memo.vz = 0;
						p.memo.over = 0;
					}
				}
			},
		};
	},
};

/** Whether a world point is on the river's water (its `band<n>Water` zones). */
const waterOf = (game) => {
	const waters = game.zones.filter((z) => /^band\d+Water$/.test(z.id));
	return (x, y) => waters.some((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
};

const showLine = (player, line) => {
	player.lineActive = line ? 1 : 0;
	player.lineX = line ? line.x : 0;
	player.lineY = line ? line.y : 0;
};

const fishingLine = {
	create(game, api) {
		const inWater = waterOf(game);
		/** Fisherman id → its line: the bobber, the ability that cast it, and the hooked player. */
		const lines = new Map();
		const reel = (LINE.reelCellsPerSecond * CELL) / game.online.tickHz;
		const cut = (fisher, by) => {
			lines.delete(by);
			if (fisher) showLine(fisher);
		};
		const hookable = (p, line, fisher, stamp) =>
			p !== fisher &&
			p.connected &&
			line.targets.includes(p.character.id) &&
			(p.status === api.STATUS.free || p.status === api.STATUS.grounded) &&
			stamp >= p.safeUntil &&
			!above(p, CLEAR.hook) &&
			Math.hypot(p.body.x - line.x, p.body.y - line.y) < line.reach;
		return {
			reset(world) {
				lines.clear();
				for (const p of world.players) if (p.lineActive) showLine(p);
			},
			sees: (player, at) => inSight(player.body, at),
			botAim: {
				aimed: {
					reactMs: BOT_AIM.reactMs,
					lagMs: BOT_AIM.lagMs,
					restMs: BOT_AIM.restMs,
					surePx: BOT_AIM.sureCells * CELL,
					spread: BOT_AIM.spread,
				},
			},
			cast(user, ability, aim) {
				if (lines.has(user.id)) return false;
				// An aim past the sight is not refused: the line lands as far towards it as it reaches.
				const at = pullIntoSight(user.body, aim);
				if (!inWater(at.x, at.y)) return false;
				if (Math.hypot(at.x - user.body.x, at.y - user.body.y) < LINE.minCastCells * CELL)
					return false;
				const line = {
					x: at.x,
					y: at.y,
					reach: ability.reach,
					targets: ability.targets,
					score: ability.score,
					hold: ability.hold,
				};
				lines.set(user.id, line);
				showLine(user, line);
				return true;
			},
			step(world) {
				if (!lines.size) return;
				const byId = new Map(world.players.map((p) => [p.id, p]));
				for (const [by, line] of [...lines]) {
					const fisher = byId.get(by);
					const fish = line.hooked === undefined ? undefined : byId.get(line.hooked);
					// Left the room, or let go by another rule: the line is empty again.
					if (!fish || fish.status !== api.STATUS.hooked) line.hooked = undefined;
					if (!fisher || !fisher.connected || fisher.status !== api.STATUS.free) {
						cut(fisher, by);
						if (fish && fish.status === api.STATUS.hooked) {
							api.free(fish, world.stamp);
							world.emit({ type: 'escaped', by, target: fish.id });
						}
						continue;
					}
					const dx = fisher.body.x - line.x;
					const dy = fisher.body.y - line.y;
					const d = Math.hypot(dx, dy);
					if (d < LINE.landCells * CELL) {
						cut(fisher, by);
						if (line.hooked === undefined) continue;
						api.out(fish, world.stamp, line.hold);
						api.score(fisher, api.worth(fish, line.score));
						world.emit({
							type: 'caught',
							by,
							target: fish.id,
							effect: 'hook',
							byName: fisher.name ?? '',
						});
						continue;
					}
					const step = Math.min(d, reel);
					line.x += (dx / d) * step;
					line.y += (dy / d) * step;
					if (line.hooked === undefined) {
						const hooked = world.players.find((p) => hookable(p, line, fisher, world.stamp));
						if (hooked) {
							hooked.status = api.STATUS.hooked;
							hooked.until = 0;
							line.hooked = hooked.id;
							// Where its bloodstain goes, if it is landed (`bloodstains`).
							hooked.memo.hookAt = 1;
							hooked.memo.hookX = hooked.body.x;
							hooked.memo.hookY = hooked.body.y;
							world.emit({ type: 'hooked', by, target: hooked.id });
						}
					}
					const on = line.hooked === undefined ? undefined : byId.get(line.hooked);
					if (on) {
						on.body.x = line.x;
						on.body.y = line.y;
					}
					showLine(fisher, line);
				}
			},
		};
	},
};

/** The most stains a room keeps (the original's `MAX_BLOODSTAINS`): the oldest goes past it. */
export const STAINS = Object.freeze({ max: 300 });

/**
 * A stain where each salmon is caught (the status `out`), once a catch: at its place, or, landed by
 * a line, at the place it was hooked (noted while it is `hooked`, before the line reels it in). Runs
 * before `fishingLine`, so the place noted is the hook's, not the first reel's.
 */
const bloodstains = {
	create(game, api) {
		const stains = { list: [], made: 0 };
		return {
			stains: () => stains,
			step(world) {
				for (const p of world.players) {
					if (p.character.id !== SALMON) continue;
					if (p.status === api.STATUS.hooked) {
						if (p.memo.hookAt !== 1) {
							p.memo.hookAt = 1;
							p.memo.hookX = p.body.x;
							p.memo.hookY = p.body.y;
						}
						continue;
					}
					if (p.status !== api.STATUS.out) {
						p.memo.hookAt = 0;
						p.memo.stained = 0;
						continue;
					}
					if (p.memo.stained === 1) continue;
					const hooked = p.memo.hookAt === 1;
					stains.list.push({
						x: hooked ? p.memo.hookX : p.body.x,
						y: hooked ? p.memo.hookY : p.body.y,
					});
					if (stains.list.length > STAINS.max) stains.list.shift();
					stains.made += 1;
					p.memo.stained = 1;
					p.memo.hookAt = 0;
				}
			},
		};
	},
};

const goldenSalmon = {
	create() {
		const mark = (world) => {
			for (const p of world.players) {
				const golden = p.wonLast === true && p.character.id === SALMON;
				if (p.mark === golden) continue;
				p.mark = golden;
				if (golden) world.emit({ type: 'golden', id: p.id });
			}
		};
		return { reset: mark, step: mark };
	},
};

/**
 * A fisherman on a bridge (a zone of `kind: 'bridge'`: a row of cells across the water, as high
 * as its `height`, cells), as the original's `update`: with its centre within half a cell of the
 * deck's row, over the deck or a slope {@link BRIDGE_SLOPE} cells onto either bank, it is put on the
 * deck's row and as high as the deck (`z`), ramped down the slopes; off it, back on the ground. The
 * water is open to it under a bridge (`salmons.js` `salmonsGeometry`); a salmon and a bear pass
 * under.
 */
const bridges = {
	create(game, api) {
		const decks = zonesOfKind(game, 'bridge');
		if (!decks.length) return {};
		const deckOf = (p) => {
			const { x, y } = p.body;
			for (const d of decks) {
				if (!appliesTo(d, p) || Math.abs(y - (d.y + CELL / 2)) > CELL / 2) continue;
				const from = d.x + CELL / 2;
				const to = d.x + d.w - CELL / 2;
				const off = Math.max(0, from - x, x - to) / CELL;
				if (off <= BRIDGE_SLOPE)
					return { deck: d, lift: (d.height ?? 0) * (1 - off / BRIDGE_SLOPE) };
			}
			return undefined;
		};
		return {
			step(world) {
				for (const p of world.players) {
					if (!decks.some((d) => appliesTo(d, p))) continue;
					const on = p.status === api.STATUS.free ? deckOf(p) : undefined;
					if (on) {
						p.body.y = on.deck.y + CELL / 2;
						p.z = on.lift * CELL;
						p.memo.bridge = 1;
					} else if (p.memo.bridge === 1) {
						p.z = 0;
						p.memo.bridge = 0;
					}
				}
			},
		};
	},
};

/** The ways a bot salmon weighs at each look, degrees from straight up the river. */
const SWIM_WAYS = Object.freeze([0, 20, -20, 40, -40, 65, -65, 90, -90, 135, -135, 180]);

/** How a bot salmon weighs a way ({@link swim}): it looks `seconds` along it in `samples` steps
 *  (the nearer ones count for more: `near`), a cell of way up the river is worth `way`, and each
 *  sample costs what is there. Distances in cells. */
const SWIM_WEIGH = Object.freeze({
	seconds: 1,
	samples: 5,
	near: Object.freeze([1, 1, 0.8, 0.6, 0.5]),
	way: 1.2,
	/** Per cell its way ends from its own lane. */
	lane: 0.12,
	/** Within this of the water's edge. */
	bank: Object.freeze({ within: 1, cost: 6 }),
	rock: Object.freeze({ pad: 1, cost: 3 }),
	pool: Object.freeze({ pad: 0.2, cost: 3.5 }),
	sand: Object.freeze({ pad: 0.4, cost: 5 }),
	/** A catcher (a bear): past its reach by `[cells, cost]`, the nearest first. */
	catcher: Object.freeze([
		[0.5, 14],
		[2, 6],
		[4.5, 1.5],
	]),
	/** A caster (a fisherman): within `[cells, cost]` of him. */
	caster: Object.freeze([
		[5.5, 2.5],
		[9, 0.6],
	]),
	/** A hazard this costly in the first `leapSamples` of its way: it leaps. */
	leap: 3,
	leapSamples: 2,
	/** Its lane, as a share of the water's half width less `laneEdge` cells. */
	laneSpread: 0.8,
	laneEdge: 2,
	/** A bear this near (cells) wakes it from a rest. */
	wake: 7,
	/** A line whose bobber, or whose way home, is this near (cells): it leaps. */
	line: 2.5,
	/** Moved further than this in one input (cells), it was put somewhere: a new run. */
	moved: 4,
	/** Stuck, it heads this way aside (of a full move across, the rest up) for `asideMs`. */
	aside: 0.8,
	asideMs: 900,
});

/**
 * What a bot salmon knows of its river (a person has it on the screen): the water's edges and the
 * current by row of cells, what lies in each row (rocks, whirlpools, sand: `{ x0, y0, x1, y1, cost,
 * low }`, padded; `low` is passed over in a leap), the waterfalls, a salmon's speed, and who
 * catches a salmon (the abilities that target it, by character: `reach` px, `casts` for a line).
 * `null` for a game with no river (no `band<n>Water` zone): its bot salmon is its brain's.
 */
const swimChart = (game) => {
	const byId = new Map(game.zones.map((zone) => [zone.id, zone]));
	const forces = new Map();
	for (const rule of game.online.rules.zones ?? []) if (rule.force) forces.set(rule.zone, rule);
	const waters = game.zones.filter((z) => /^band\d+Water$/.test(z.id)).sort((a, b) => a.y - b.y);
	if (!waters.length) return null;
	const top = waters[0].y;
	const bottom = waters[waters.length - 1].y + waters[waters.length - 1].h;
	const rows = [];
	for (let y = top + CELL / 2, i = 0; y < bottom; y += CELL) {
		while (i < waters.length - 1 && y >= waters[i].y + waters[i].h) i += 1;
		const water = waters[i];
		rows.push({
			left: water.x,
			right: water.x + water.w,
			current: forces.get(water.id)?.force.y ?? 0,
			things: [],
		});
	}
	const rowOf = (y) => Math.min(rows.length - 1, Math.max(0, Math.floor((y - top) / CELL)));
	const W = SWIM_WEIGH;
	const lay = (zone, { pad, cost }, low) => {
		const thing = {
			x0: zone.x - pad * CELL,
			y0: zone.y - pad * CELL,
			x1: zone.x + zone.w + pad * CELL,
			y1: zone.y + zone.h + pad * CELL,
			cost,
			low,
		};
		for (let r = rowOf(thing.y0); r <= rowOf(thing.y1); r++) rows[r].things.push(thing);
	};
	for (const zone of game.zones) {
		if (/^rock\d+$/.test(zone.id)) lay(zone, W.rock, true);
		else if (/^whirlpool\d+$/.test(zone.id)) lay(zone, W.pool, true);
	}
	for (const rule of game.online.rules.zones ?? [])
		if (rule.kind === 'sandbank' && byId.has(rule.zone)) lay(byId.get(rule.zone), W.sand, false);
	const threats = new Map();
	for (const ability of game.online.rules.abilities ?? []) {
		if (!ability.targets.includes(SALMON)) continue;
		threats.set(ability.character, {
			reach: ability.reach + (ability.ahead ?? 0),
			casts: ability.effect === 'hook',
		});
	}
	return {
		rows,
		rowOf,
		falls: waterfallsOf(game),
		speed: game.online.characters.find((c) => c.id === SALMON)?.speed ?? 0,
		threats,
	};
};

const inBox = (box, x, y) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;

/** How far the point `(px, py)` is from the stretch from `a` to `b`, px. */
const offStretch = (px, py, a, b) => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = dx * dx + dy * dy;
	const t = length ? Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / length)) : 0;
	return Math.hypot(px - a.x - dx * t, py - a.y - dy * t);
};

/**
 * A bot salmon's next move and buttons (`botPlay`), as a person plays a salmon: up the river in a
 * lane of its own; every {@link BOT_SWIM}`.lookMs` it weighs the ways it could go
 * ({@link SWIM_WAYS}, {@link SWIM_WEIGH}) by the way each makes, the banks, rocks, whirlpools and
 * sand on it and the bears and fishermen it minds (`known` ones within `noticeCells` for its
 * reaction time), and keeps the best, a little off, until the next look. It taps jump, a tap
 * every `tapMs`: against a waterfall (the climb, then over the top), to leap what it cannot pass
 * or a whirlpool that has it, off a sandbank after its reaction time, and over a line whose bobber
 * or way home is on it. While its brain rests (`bot.state` `rest`) it lies on the current, unless a
 * bear is near or the river holds it. Told of no wall, it knows it is stuck by making no way, and
 * leaps aside. Seeded: its steering draws from the bot's `swim` stream and its reactions from
 * `eye`, so what it does before it minds a bear is what it does with none.
 */
const swim = (chart, STATUS, self, known, bot) => {
	const S = BOT_SWIM;
	const W = SWIM_WEIGH;
	const n = bot.notes;
	const { seq } = bot;
	const { x, y } = self.body;
	const hand = bot.stream('swim');
	const eye = bot.stream('eye');
	const inputs = (rng, ms) => Math.round((ms.min + rng() * (ms.max - ms.min)) / 1000 / bot.dt);
	const rest = { moveX: 0, moveY: 0, buttons: 0 };
	const held = self.status === STATUS.grounded;
	if (self.status !== STATUS.free && !held) {
		n.run = undefined;
		return rest;
	}
	if (!n.run || Math.hypot(x - n.run.x, y - n.run.y) > W.moved * CELL)
		n.run = {
			lane: (hand() * 2 - 1) * W.laneSpread,
			lookAt: 0,
			tapAt: 0,
			way: { x: 0, y: -1 },
			leap: false,
			from: { x, y, seq },
			watched: new Map(),
		};
	const run = n.run;
	run.x = x;
	run.y = y;

	const minded = [];
	const watch = (key, other, d) => {
		let w = run.watched.get(key);
		if (!w) run.watched.set(key, (w = { ready: seq + inputs(eye, S.reactMs) }));
		w.seen = seq;
		if (seq >= w.ready) minded.push({ other, threat: chart.threats.get(other.character.id), d });
		return seq >= w.ready;
	};
	let line = false;
	for (const other of known) {
		const threat = chart.threats.get(other.character.id);
		if (!threat) continue;
		const d = Math.hypot(other.body.x - x, other.body.y - y);
		if (threat.casts && other.lineActive) {
			const bobber = { x: other.lineX, y: other.lineY };
			if (
				offStretch(x, y, bobber, other.body) < W.line * CELL &&
				watch(`line:${other.id}`, other, d)
			)
				line = true;
		}
		if (d <= S.noticeCells * CELL) watch(other.id, other, d);
	}
	for (const [key, w] of run.watched) if (w.seen !== seq) run.watched.delete(key);

	const z = self.z ?? 0;
	const aloft = z >= OVER.rock * CELL;
	const row = chart.rows[chart.rowOf(y)];
	const costAt = (px, py, i) => {
		const at = chart.rows[chart.rowOf(py)];
		let cost = 0;
		let hazard = 0;
		if (px < at.left + W.bank.within * CELL || px > at.right - W.bank.within * CELL)
			cost += W.bank.cost;
		for (const thing of at.things) {
			if (px < thing.x0 || px > thing.x1 || py < thing.y0 || py > thing.y1) continue;
			if (aloft && (thing.low || i < W.leapSamples)) continue;
			hazard = Math.max(hazard, thing.cost);
		}
		for (const { other, threat } of minded) {
			const d = Math.hypot(other.body.x - px, other.body.y - py) / CELL;
			const bands = threat.casts ? W.caster : W.catcher;
			const past = threat.casts ? d : d - threat.reach / CELL;
			const band = bands.find(([cells]) => past < cells);
			if (band) cost += band[1];
		}
		return { cost: cost + hazard, hazard };
	};
	if (seq >= run.lookAt) {
		run.lookAt = seq + Math.max(1, inputs(hand, S.lookMs));
		let best;
		for (const deg of SWIM_WAYS) {
			const turn = (deg * Math.PI) / 180;
			const ux = Math.sin(turn);
			const uy = -Math.cos(turn);
			let score = 0;
			let leap = false;
			let px = x;
			let py = y;
			for (let i = 0; i < W.samples; i++) {
				const t = ((i + 1) * W.seconds) / W.samples;
				px = x + ux * chart.speed * t;
				py = y + (uy * chart.speed + row.current) * t;
				const { cost, hazard } = costAt(px, py, i);
				score -= cost * W.near[i];
				if (i < W.leapSamples && hazard >= W.leap) leap = true;
			}
			const end = chart.rows[chart.rowOf(py)];
			const lane =
				(end.left + end.right) / 2 +
				run.lane * Math.max(0, (end.right - end.left) / 2 - W.laneEdge * CELL);
			score += ((y - py) / CELL) * W.way - (Math.abs(px - lane) / CELL) * W.lane;
			if (!best || score > best.score) best = { score, ux, uy, leap };
		}
		const off = ((hand() * 2 - 1) * S.wobbleDeg * Math.PI) / 180;
		run.way = {
			x: best.ux * Math.cos(off) - best.uy * Math.sin(off),
			y: best.ux * Math.sin(off) + best.uy * Math.cos(off),
		};
		run.leap = best.leap;
	}

	// Making no way: stuck, unless it is the river's own hold (a climb, a leap, the sand).
	if (z > 0 || held || Math.hypot(x - run.from.x, y - run.from.y) > CELL) run.from = { x, y, seq };
	const near = minded.some(({ threat, d }) => !threat.casts && d < W.wake * CELL);
	const pooled = !aloft && row.things.some((t) => t.cost === W.pool.cost && inBox(t, x, y));
	const fall = chart.falls.find((f) => y > f.line && y - f.line < CELL && z < f.height);
	if (bot.state === 'rest' && !near && !pooled && !line && !held && !fall && z === 0) {
		run.from = { x, y, seq };
		run.pressed = false;
		return rest;
	}
	run.stuckFor ??= inputs(hand, S.stuckMs);
	if (seq - run.from.seq > run.stuckFor) {
		run.asideUntil = seq + Math.round(W.asideMs / 1000 / bot.dt);
		run.asideTo = x < (row.left + row.right) / 2 ? 1 : -1;
		run.asideLeap = true;
		run.from = { x, y, seq };
		run.stuckFor = inputs(hand, S.stuckMs);
	}
	let way = run.way;
	let tap = run.leap || pooled || line;
	if (seq < (run.asideUntil ?? 0)) {
		way = { x: run.asideTo * W.aside, y: -Math.sqrt(1 - W.aside * W.aside) };
		tap = run.asideLeap;
	}
	if (held) {
		run.freeAt ??= seq + inputs(eye, S.reactMs);
		tap = seq >= run.freeAt;
	} else run.freeAt = undefined;
	// At a waterfall, heading up: it climbs, a tap at a time, and swims on over the top.
	if (fall && way.y < 0 && !held) {
		way = { x: 0, y: -1 };
		tap = true;
	} else if (z > 0 && !held) tap = false;
	let buttons = 0;
	if (tap && !run.pressed && seq >= run.tapAt) {
		buttons = BUTTONS.jump;
		run.tapAt = seq + Math.max(2, inputs(hand, S.tapMs));
		run.asideLeap = false;
	}
	run.pressed = buttons !== 0;
	return { moveX: way.x * MOVE_SCALE, moveY: way.y * MOVE_SCALE, buttons };
};

/**
 * A bot salmon's swim ({@link swim}). At the source it wins the game as a person does (Salmons'
 * `bots.canWin`): the rules' goal, not this module, decides that.
 */
const botSalmon = {
	create(game, api) {
		let chart;
		return {
			botPlay(self, known, bot) {
				if (self.character.id !== SALMON) return undefined;
				if (chart === undefined) chart = swimChart(game);
				return chart ? swim(chart, api.STATUS, self, known, bot) : undefined;
			},
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
	const seers = made.filter((m) => m.sees);
	const aims = made.filter((m) => m.botAim).map((m) => m.botAim);
	return {
		step: each('step'),
		input: each('input'),
		reset: each('reset'),
		cast: (...args) => made.some((m) => m.cast?.(...args) === true),
		sees: seers.length ? (player, at) => seers.every((m) => m.sees(player, at)) : undefined,
		botAim: aims.length ? Object.assign({}, ...aims) : undefined,
		botPlay: made.find((m) => m.botPlay)?.botPlay,
		stains: made.find((m) => m.stains)?.stains,
		holds: (player) => made.some((m) => m.holds?.(player) === true),
		level: (player, level) => made.reduce((l, m) => (m.level ? m.level(player, l) : l), level),
		steer: (player, input) => made.reduce((i, m) => (m.steer ? m.steer(player, i) : i), input),
	};
};

/** The leap, its fall, its carried move and the low pieces it passes over, run inside `salmons`
 *  only: a rules id would reach every runtime's game-config. */
export const salmonJump = {
	create: (game, api) => together(game, api, [leap, fall, carry, lowPieces]),
};

/** The climb, with the fall that brings a salmon down from the top. */
const waterfallClimb = {
	create: (game, api) => together(game, api, [fall, waterfallClimbing]),
};

/** The bears' limit as bots ({@link BOT_SWIPE}), in `salmons` only: the swipe itself is a plain
 *  `catch` ability of the config, with no module of its own. */
const bearSwipe = { create: () => ({ botAim: { inReach: { reactMs: BOT_SWIPE.reactMs } } }) };

/** The fall steps before the climb, so a step either climbs or falls, as the original's `update`;
 *  the climb's tap is read before the leap's; the carry counts after both; a hooked salmon's place
 *  is noted for its stain before the line reels it. */
const salmons = {
	create: (game, api) =>
		together(game, api, [
			sandbanksOf(true),
			fall,
			waterfallClimbing,
			leap,
			bloodstains,
			fishingLine,
			goldenSalmon,
			carry,
			lowPieces,
			bridges,
			bearSwipe,
			botSalmon,
		]),
};

/** Salmons' entries of `ONLINE_RULES_MODULES`. Object literals only, so a runtime that never runs a
 *  room (every one but `arcade`) drops them. */
export const SALMONS_RULES = { waterfallClimb, sandbanks, fishingLine, goldenSalmon, salmons };
