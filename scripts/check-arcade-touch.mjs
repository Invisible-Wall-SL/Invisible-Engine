// Touch control schemes of an online arcade player (docs/design/arcade-touch-controls.md): what a
// finger's hold, tap and drag become under each setting, as pure functions (`engine-mechanics`
// `touchControl.js`); that no gesture means two things (the leap, the climb, an ability, the
// screens' buttons); that a key pressed and lifted inside one device step is not lost; that the
// move is an input the room takes as sent; and the config block (`game-config` `touchScheme.ts`):
// carried past the normalizer, absent ⇒ nothing changes, Salmons' three classes.
//
// Run: pnpm check:arcade-touch

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import {
	MAX_PRESSES,
	STALL_MS,
	TOUCH_ABILITY_PRESSES,
	TOUCH_AIMS,
	TOUCH_DEFAULTS,
	TOUCH_GESTURES,
	TOUCH_STEERS,
	createPressLatch,
	createTouchControl,
	resolveTouch,
} from '../packages/engine-mechanics/src/touchControl.js';
import {
	ARCADE_TOUCH_ABILITY_PRESSES,
	ARCADE_TOUCH_AIMS,
	ARCADE_TOUCH_DEFAULTS,
	ARCADE_TOUCH_GESTURES,
	ARCADE_TOUCH_LIMITS,
	ARCADE_TOUCH_PRESETS,
	ARCADE_TOUCH_STEERS,
	normalizeGameConfigDoc,
	normalizeTouchScheme,
	onlineGameOf,
	touchOf,
	touchSchemeOf,
	validateTouchSchemes,
	withTouchSchemes,
} from '../packages/game-config/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
		console.log(`  ok  ${name}`);
	} catch (error) {
		console.error(`  ✗  ${name}`);
		throw error;
	}
};

const STEP_MS = 1000 / 30;
const SPEED = 240 / 30;
const UP = { moveX: 0, moveY: -MOVE_SCALE };
const RIGHT = { moveX: MOVE_SCALE, moveY: 0 };

/**
 * A player on a flat field drawn 1:1 with a camera that keeps it at canvas point (200, 400), as a
 * following camera does: a canvas point is `self + (point − centre)` on the field. `wall` stops
 * it at that field y. Each `step()` is one fixed step: the control's move is walked at SPEED.
 */
function world(scheme, options = {}) {
	const control = createTouchControl(scheme);
	const self = { x: 1000, y: 1000 };
	const centre = { x: 200, y: 400 };
	let ms = 0;
	let buttons = 0;
	const log = [];
	const game = {
		control,
		self,
		keys: false,
		playing: true,
		still: false,
		follow: options.follow !== false,
		onTarget: options.onTarget,
		/** A fixed camera's origin: where field (0, 0) is when the camera does not follow. */
		toField: (point) =>
			game.follow
				? { x: self.x + point.x - centre.x, y: self.y + point.y - centre.y }
				: { x: 1000 + point.x - centre.x, y: 1000 + point.y - centre.y },
		down: (id, x, y) => control.event({ type: 'down', id, x, y }, ms),
		move: (id, x, y) => control.event({ type: 'move', id, x, y }, ms),
		up: (id, x, y) => control.event({ type: 'up', id, x, y }, ms),
		cancel: (id, x, y) => control.event({ type: 'cancel', id, x, y }, ms),
		/** Real time passing with no step (inside one device step). */
		wait: (by) => {
			ms += by;
		},
		step(n = 1) {
			let last;
			for (let i = 0; i < n; i++) {
				last = control.step({
					self: { ...self },
					toField: game.toField,
					now: ms,
					playing: game.playing,
					keys: game.keys,
					still: game.still,
					pressed: buttons !== 0,
					onTarget: game.onTarget,
				});
				buttons = last.press ? 1 : 0;
				if (last.press) log.push(last.press);
				if (last.move && !game.still) {
					self.x += (last.move.moveX / MOVE_SCALE) * SPEED;
					const y = self.y + (last.move.moveY / MOVE_SCALE) * SPEED;
					self.y = options.wall !== undefined ? Math.max(options.wall, y) : y;
				}
				ms += STEP_MS;
			}
			return last;
		},
		/** A tap: down and up `held` ms apart, within one step unless `held` says more. */
		tap(id, x, y, held = 20) {
			game.down(id, x, y);
			game.wait(held);
			game.up(id, x, y);
		},
		presses: log,
	};
	return game;
}

console.log('hold to steer');

check('a held finger steers towards it, and keeps going for as long as it is down', () => {
	const game = world({});
	game.down(1, 200, 280);
	const first = game.step();
	assert.deepEqual(first.move, UP);
	game.step(300);
	assert.ok(game.self.y < 1000 - 299 * SPEED, 'ten seconds on, it has swum the whole way');
	assert.deepEqual(game.step().move, UP);
});

check('…past the point: a camera that stops following does not stop the player there', () => {
	// The finger's field point stays where it is (a camera at the world's edge, or one that
	// lags): the player reaches it, enters the dead zone, and keeps its heading.
	const game = world({ deadZone: 24 }, { follow: false });
	game.down(1, 200, 280);
	game.step(60);
	assert.ok(game.self.y < 1000 - 120 - 24, `it is past the finger's point (${game.self.y})`);
	assert.deepEqual(game.step().move, UP, 'and still heading the way it was sent');
});

check('a drag turns it: the heading follows the finger', () => {
	const game = world({});
	game.down(1, 200, 280);
	game.step(5);
	game.move(1, 320, 400);
	assert.deepEqual(game.step().move, RIGHT);
});

check('lifting stops it (releaseStops, the default)', () => {
	const game = world({});
	game.down(1, 200, 280);
	game.step(20);
	game.up(1, 200, 280);
	assert.equal(game.step().move, undefined);
	const at = game.self.y;
	game.step(10);
	assert.equal(game.self.y, at);
});

check('…or leaves it going (releaseStops: false), until a wall', () => {
	const game = world({ releaseStops: false }, { wall: 800 });
	game.down(1, 200, 280);
	game.step(10);
	game.up(1, 200, 280);
	assert.deepEqual(game.step().move, UP);
	game.step(200);
	assert.equal(game.self.y, 800);
	assert.equal(
		game.step().move,
		undefined,
		'no way made for half a second: the heading is dropped',
	);
});

check('a cancelled touch stops it and is no tap', () => {
	const game = world({});
	game.down(1, 200, 280);
	game.step(3);
	game.cancel(1, 200, 280);
	const after = game.step();
	assert.equal(after.move, undefined);
	assert.equal(game.presses.length, 0);
});

check('with gestures: tap, a held finger does not steer', () => {
	const game = world({ gestures: 'tap', ability: 'button' });
	game.down(1, 200, 280);
	game.wait(400);
	assert.equal(game.step(5).move, undefined);
});

console.log('the dead zone');

check('a finger put down on the player gives no heading; dragged out of the zone it does', () => {
	const game = world({ deadZone: 48 });
	game.down(1, 210, 420);
	assert.equal(game.step(3).move, undefined);
	game.move(1, 200, 340);
	assert.deepEqual(game.step().move, UP);
});

check('a finger dragged back onto the player keeps the heading it had', () => {
	const game = world({ deadZone: 48 });
	game.down(1, 200, 280);
	game.step(3);
	game.move(1, 205, 395);
	assert.deepEqual(game.step().move, UP);
});

console.log('a tap, by length and by distance');

check('a press lifted within tapMs and tapPx is a tap; a longer one is not', () => {
	const short = world({ tapMs: 250 });
	short.tap(1, 200, 280, 240);
	short.step(2);
	assert.equal(short.presses.length, 1);
	const long = world({ tapMs: 250 });
	long.tap(1, 200, 280, 260);
	long.step(2);
	assert.equal(long.presses.length, 0);
});

check('tapMs 0: a press of any length lifted in place is a tap (the original)', () => {
	const game = world({ tapMs: 0 });
	game.tap(1, 200, 280, 5000);
	game.step(2);
	assert.equal(game.presses.length, 1);
});

check('a press that moved more than tapPx is a drag, not a tap', () => {
	const game = world({ tapPx: 12 });
	game.down(1, 200, 280);
	game.move(1, 213, 280);
	game.up(1, 213, 280);
	game.step(2);
	assert.equal(game.presses.length, 0);
	const near = world({ tapPx: 12 });
	near.down(1, 200, 280);
	near.move(1, 211, 280);
	near.up(1, 211, 280);
	near.step(2);
	assert.equal(near.presses.length, 1);
});

check('a tap begun and ended inside one device step is not lost', () => {
	const game = world({});
	game.step(3);
	game.tap(1, 200, 280, 5);
	game.step();
	assert.equal(game.presses.length, 1);
});

console.log('tap to head');

check('a tap sets a heading that is kept with no finger down', () => {
	const game = world({ gestures: 'both', ability: 'button' });
	game.tap(1, 200, 280);
	assert.deepEqual(game.step().move, UP);
	game.step(100);
	assert.ok(game.self.y < 1000 - 99 * SPEED);
	assert.deepEqual(game.step().move, UP);
});

check('…until the next tap, which turns it', () => {
	const game = world({ gestures: 'both', ability: 'button' });
	game.tap(1, 200, 280);
	game.step(10);
	game.tap(1, 320, 400);
	assert.deepEqual(game.step().move, RIGHT);
});

check('…until a tap on itself, which stops it', () => {
	const game = world({ gestures: 'both', ability: 'button', deadZone: 48 });
	game.tap(1, 200, 280);
	game.step(10);
	game.tap(1, 210, 410);
	assert.equal(game.step().move, undefined);
});

check('…until a hold, which steers, and whose lifting stops it', () => {
	const game = world({ gestures: 'both', ability: 'button' });
	game.tap(1, 200, 280);
	game.step(10);
	game.down(1, 320, 400);
	game.wait(400);
	assert.deepEqual(game.step().move, RIGHT);
	game.up(1, 320, 400);
	assert.equal(game.step().move, undefined);
});

check('…until a movement key, which takes over for good', () => {
	const game = world({ gestures: 'both', ability: 'button' });
	game.tap(1, 200, 280);
	game.step(10);
	game.keys = true;
	assert.equal(game.step().move, undefined);
	game.keys = false;
	assert.equal(game.step().move, undefined);
});

check('…until a wall: no way made for STALL_MS drops it', () => {
	const game = world({ gestures: 'both', ability: 'button' }, { wall: 900 });
	game.tap(1, 200, 280);
	game.step(13);
	assert.equal(game.self.y, 900);
	assert.deepEqual(game.step().move, UP, 'not at once: a brush against a bank is no wall');
	game.step(Math.ceil((2 * STALL_MS) / STEP_MS));
	assert.equal(game.step().move, undefined);
});

check('…but not while the room holds the player still (a salmon climbing a waterfall)', () => {
	const game = world({ gestures: 'both', ability: 'button' });
	game.tap(1, 200, 280);
	game.step(5);
	game.still = true;
	game.step(Math.ceil((3 * STALL_MS) / STEP_MS));
	assert.deepEqual(game.step().move, UP);
	game.still = false;
	game.step(5);
	assert.deepEqual(game.step().move, UP);
});

check('with gestures: hold, a tap leaves no heading', () => {
	const game = world({ gestures: 'hold' });
	game.tap(1, 200, 280);
	assert.equal(game.step().move, undefined);
	assert.equal(game.step(5).move, undefined);
});

console.log('the ability, and what a tap cannot mean twice');

check('ability: tap — every tap presses the button once, aimed where tapped', () => {
	const game = world({});
	game.tap(1, 200, 280);
	const step = game.step();
	assert.deepEqual(step.press, { aim: { x: 1000, y: 880 } });
	assert.equal(game.step().press, undefined, 'one step only');
});

check('…and where taps head (the salmon), the same tap leaps and sets the heading', () => {
	const game = world({ gestures: 'both' });
	game.tap(1, 200, 280);
	const step = game.step();
	assert.deepEqual(step.press, { aim: { x: 1000, y: 880 } });
	assert.deepEqual(step.move, UP);
	assert.deepEqual(game.step(20).move, UP);
});

check('…taps at a waterfall’s foot (held still) each press, and the heading waits', () => {
	const game = world({ gestures: 'both' });
	game.still = true;
	for (let i = 0; i < 5; i++) {
		game.tap(1, 200, 280);
		game.step(4);
	}
	assert.equal(game.presses.length, 5);
	game.still = false;
	assert.deepEqual(game.step().move, UP);
});

check('aim: ahead — the press carries no aim (it is aimed as a key press is)', () => {
	const game = world({ aim: 'ahead' });
	game.tap(1, 200, 280);
	assert.deepEqual(game.step().press, {});
});

check('ability: target — a tap on a target acts there and does not move', () => {
	const game = world({ gestures: 'both', ability: 'target' }, { onTarget: (at) => at.y < 900 });
	game.tap(1, 200, 280);
	const step = game.step();
	assert.deepEqual(step.press, { aim: { x: 1000, y: 880 } });
	assert.equal(step.move, undefined);
});

check('…and a tap anywhere else heads there and does not act', () => {
	const game = world({ gestures: 'both', ability: 'target' }, { onTarget: (at) => at.y < 900 });
	game.tap(1, 320, 400);
	const step = game.step();
	assert.equal(step.press, undefined);
	assert.deepEqual(step.move, RIGHT);
	game.step(5);
	assert.equal(game.presses.length, 0);
});

check('ability: secondFinger — one finger’s tap only heads', () => {
	const game = world({ gestures: 'both', ability: 'secondFinger' });
	game.tap(1, 200, 280);
	const step = game.step();
	assert.equal(step.press, undefined);
	assert.deepEqual(step.move, UP);
});

check('…a second finger’s tap acts where it lands while the first keeps steering', () => {
	const game = world({ gestures: 'both', ability: 'secondFinger' });
	game.down(1, 200, 280);
	game.wait(400);
	game.step(3);
	game.tap(2, 320, 400);
	const step = game.step();
	assert.deepEqual(step.press, { aim: { x: game.self.x + 120, y: game.self.y + SPEED } });
	assert.deepEqual(step.move, UP, 'the first finger still steers');
	game.up(1, 200, 280);
	assert.equal(game.step().move, undefined);
	assert.equal(game.presses.length, 1, 'the first finger’s lift is no press');
});

check('without it (the original), the newest finger steers and an older one does nothing', () => {
	const game = world({});
	game.down(1, 200, 280);
	game.wait(400);
	game.step(2);
	game.down(2, 320, 400);
	game.wait(400);
	assert.deepEqual(game.step().move, RIGHT);
	game.up(1, 200, 280);
	assert.deepEqual(game.step().move, RIGHT);
	game.up(2, 320, 400);
	assert.equal(game.step().move, undefined);
	assert.equal(game.presses.length, 0);
});

check('ability: button — no tap on the field acts; the on-screen button does, unaimed', () => {
	const game = world({ gestures: 'both', ability: 'button' });
	game.tap(1, 200, 280);
	game.step(3);
	assert.equal(game.presses.length, 0);
	game.control.button();
	assert.deepEqual(game.step().press, {});
	assert.deepEqual(game.step().move, UP, 'and the button does not touch the heading');
});

check('a press waits for the release of the last: two quick taps are two presses', () => {
	const game = world({});
	game.tap(1, 200, 280, 5);
	game.tap(1, 200, 280, 5);
	const steps = [game.step(), game.step(), game.step(), game.step()];
	assert.deepEqual(
		steps.map((s) => !!s.press),
		[true, false, true, false],
	);
});

check(`a burst is not played out late: at most ${MAX_PRESSES} wait`, () => {
	const game = world({});
	for (let i = 0; i < 6; i++) game.tap(1, 200, 280, 5);
	game.step(20);
	assert.equal(game.presses.length, MAX_PRESSES);
});

check('while the player is out (the death screen, Respawn) a touch neither moves nor acts', () => {
	const game = world({ gestures: 'both' });
	game.tap(1, 200, 280);
	game.step(5);
	game.playing = false;
	assert.deepEqual(game.step(), {});
	// The finger that presses Respawn, and a tap after it.
	game.tap(1, 200, 600);
	assert.deepEqual(game.step(), {});
	game.playing = true;
	assert.deepEqual(game.step(), {}, 'back in play: no heading and no press left over');
	assert.equal(game.presses.length, 1, 'only the tap before it was out');
});

check('a lost focus (release) forgets the fingers, the heading and what waits', () => {
	const game = world({ gestures: 'both' });
	game.tap(1, 200, 280);
	game.step(3);
	game.down(1, 320, 400);
	game.tap(2, 200, 280, 5);
	game.control.release();
	assert.equal(game.control.held(), false);
	assert.deepEqual(game.step(), {});
});

console.log('a virtual stick');

check('the heading is the way the finger was dragged from where it went down', () => {
	const game = world({ steer: 'stick' });
	// Down far below and left of the player: towards the finger would be down-left.
	game.down(1, 40, 760);
	game.wait(400);
	assert.equal(game.step(3).move, undefined, 'no drag yet: no heading');
	game.move(1, 40, 700);
	assert.deepEqual(game.step().move, UP);
	game.move(1, 100, 760);
	assert.deepEqual(game.step().move, RIGHT);
	game.up(1, 100, 760);
	assert.equal(game.step().move, undefined);
});

console.log('the input, and the keys');

check('every heading is a move within MOVE_SCALE that the room’s clamp takes as sent', () => {
	for (let a = 0; a < 360; a += 7) {
		const game = world({});
		game.down(
			1,
			200 + Math.cos((a * Math.PI) / 180) * 150,
			400 + Math.sin((a * Math.PI) / 180) * 150,
		);
		const { move } = game.step();
		assert.ok(Number.isInteger(move.moveX) && Number.isInteger(move.moveY));
		assert.ok(Math.hypot(move.moveX, move.moveY) <= MOVE_SCALE);
		const input = { seq: 1, ...move, buttons: 0, aimX: 0, aimY: 0, view: 0, respawn: 0 };
		const clamped = clampInput(input, { w: 4000, h: 4000 });
		assert.equal(clamped.moveX, move.moveX);
		assert.equal(clamped.moveY, move.moveY);
	}
});

check('a key pressed and lifted inside one device step is still that step’s press', () => {
	const latch = createPressLatch();
	latch.press('Space');
	latch.lift('Space');
	assert.deepEqual([...latch.held()], []);
	assert.deepEqual([...latch.take()], ['Space']);
	assert.deepEqual([...latch.take()], [], 'once');
});

check('a held key is in every step; a lost focus clears the latch', () => {
	const latch = createPressLatch();
	latch.press('KeyJ');
	assert.deepEqual([...latch.take()], ['KeyJ']);
	assert.deepEqual([...latch.take()], ['KeyJ']);
	latch.press('Space');
	latch.clear();
	assert.deepEqual([...latch.take()], []);
});

check('the device: the canvas keeps its touches, and the keys go through the latch', () => {
	const online = read('apps/lines/src/game/online.ts');
	assert.match(online, /canvas\.style\.touchAction = 'none'/);
	assert.match(online, /canvas\.style\.touchAction = touchAction;/);
	assert.match(online, /for \(const code of keyLatch\.take\(\)\)/);
	assert.match(online, /touchSchemeOf\(raw, id, pointer\)/);
});

console.log('the config block');

const base = () => {
	const doc = salmonsConfig();
	delete doc.arcade.online.touch;
	return doc;
};

check('the engine’s defaults and lists are the config’s', () => {
	assert.deepEqual({ ...TOUCH_DEFAULTS }, { ...ARCADE_TOUCH_DEFAULTS });
	assert.deepEqual([...TOUCH_GESTURES], [...ARCADE_TOUCH_GESTURES]);
	assert.deepEqual([...TOUCH_STEERS], [...ARCADE_TOUCH_STEERS]);
	assert.deepEqual([...TOUCH_ABILITY_PRESSES], [...ARCADE_TOUCH_ABILITY_PRESSES]);
	assert.deepEqual([...TOUCH_AIMS], [...ARCADE_TOUCH_AIMS]);
	assert.deepEqual(resolveTouch({}), { ...ARCADE_TOUCH_DEFAULTS });
});

check('absent ⇒ nothing: no scheme, and the carry hands the same doc back', () => {
	const raw = base();
	const doc = normalizeGameConfigDoc(raw);
	assert.equal(touchOf(raw), undefined);
	assert.equal(touchSchemeOf(raw, 'salmon'), undefined);
	assert.equal(withTouchSchemes(doc, raw), doc);
	assert.deepEqual(validateTouchSchemes(raw), []);
});

check(
	'the normalizer drops the block (the slot runtimes never learn it); the carry puts it back',
	() => {
		const raw = salmonsConfig();
		const doc = normalizeGameConfigDoc(raw);
		assert.equal(doc.arcade.online.touch, undefined);
		const carried = withTouchSchemes(doc, raw);
		assert.deepEqual(carried.arcade.online.touch, raw.arcade.online.touch);
		assert.equal(doc.arcade.online.touch, undefined, 'the normalized doc is not changed');
		assert.equal(
			Object.keys(carried.arcade.online).at(-1),
			'touch',
			'after the block’s other fields',
		);
		// Stored and loaded again: the same bytes.
		const again = withTouchSchemes(normalizeGameConfigDoc(carried), carried);
		assert.equal(JSON.stringify(again), JSON.stringify(carried));
	},
);

check(
	'a scheme is stored sparse: defaults and unknown values are left out, numbers bounded',
	() => {
		assert.deepEqual(
			normalizeTouchScheme({
				gestures: 'hold',
				steer: 'finger',
				tapMs: ARCADE_TOUCH_DEFAULTS.tapMs,
				ability: 'tap',
				aim: 'point',
				releaseStops: true,
				targetRadius: 72,
			}),
			{},
		);
		assert.deepEqual(
			normalizeTouchScheme({
				gestures: 'both',
				steer: 'stick',
				deadZone: 5000,
				tapPx: 20,
				tapMs: 0,
				releaseStops: false,
				ability: 'target',
				aim: 'ahead',
				targetRadius: 96,
				extra: 1,
			}),
			{
				gestures: 'both',
				steer: 'stick',
				deadZone: ARCADE_TOUCH_LIMITS.deadZone.max,
				tapPx: 20,
				tapMs: 0,
				releaseStops: false,
				ability: 'target',
				aim: 'ahead',
				targetRadius: 96,
			},
		);
		assert.deepEqual(normalizeTouchScheme({ gestures: 'swipe', tapMs: -1, deadZone: 'x' }), {});
	},
);

check('a class plays the scheme it names; two classes that name one share it', () => {
	const raw = base();
	raw.arcade.online.touch = {
		schemes: { walk: { gestures: 'both', deadZone: 30 }, unused: {} },
		characters: { bear: 'walk', fisherman: 'walk', salmon: 'gone', ghost: 'walk' },
	};
	const pointer = onlineGameOf(normalizeGameConfigDoc(raw)).online.pointer;
	const bear = touchSchemeOf(raw, 'bear', pointer);
	assert.deepEqual(bear, {
		...ARCADE_TOUCH_DEFAULTS,
		gestures: 'both',
		deadZone: 30,
		tapPx: pointer.tapPx,
	});
	assert.deepEqual(touchSchemeOf(raw, 'fisherman', pointer), bear);
	assert.equal(touchSchemeOf(raw, 'salmon', pointer), undefined, 'a scheme that is not there');
	// One edit of the shared scheme reaches both.
	raw.arcade.online.touch.schemes.walk.steer = 'stick';
	assert.equal(touchSchemeOf(raw, 'bear', pointer).steer, 'stick');
	assert.equal(touchSchemeOf(raw, 'fisherman', pointer).steer, 'stick');
});

check('a scheme with no dead zone or tap distance of its own takes the game’s', () => {
	const raw = base();
	raw.arcade.online.touch = { schemes: { a: {} }, characters: { salmon: 'a' } };
	const pointer = onlineGameOf(normalizeGameConfigDoc(raw)).online.pointer;
	assert.equal(touchSchemeOf(raw, 'salmon', pointer).deadZone, pointer.deadZone);
	assert.equal(touchSchemeOf(raw, 'salmon').deadZone, ARCADE_TOUCH_DEFAULTS.deadZone);
});

check('what does nothing is warned of, and nothing is an error', () => {
	const raw = base();
	raw.arcade.online.touch = {
		schemes: { act: { ability: 'button' }, two: { gestures: 'tap', ability: 'secondFinger' } },
		characters: { salmon: 'two', bear: 'missing', ghost: 'act', fisherman: 'act' },
	};
	delete raw.arcade.online.pointer.taps.fisherman;
	const issues = validateTouchSchemes(raw);
	assert.ok(issues.every((i) => i.severity === 'warning'));
	assert.deepEqual(issues.map((i) => i.path).sort(), [
		'arcade.online.touch.characters.bear',
		'arcade.online.touch.characters.fisherman',
		'arcade.online.touch.characters.ghost',
		'arcade.online.touch.schemes.two',
	]);
	const off = base();
	off.arcade.online.touch = { schemes: { a: {} }, characters: { salmon: 'a' } };
	delete off.arcade.online.pointer;
	assert.deepEqual(
		validateTouchSchemes(off).map((i) => i.path),
		['arcade.online.touch'],
	);
});

check('every preset is a scheme as it is stored', () => {
	assert.deepEqual(ARCADE_TOUCH_PRESETS.steer.scheme, {});
	for (const [id, preset] of Object.entries(ARCADE_TOUCH_PRESETS)) {
		assert.deepEqual(normalizeTouchScheme(preset.scheme), preset.scheme, id);
		assert.ok(preset.label && preset.about, id);
	}
});

check(
	'Salmons: the salmon holds or taps to head and leaps on the tap; the catchers share one scheme',
	() => {
		const raw = salmonsConfig();
		const pointer = onlineGameOf(normalizeGameConfigDoc(raw)).online.pointer;
		assert.deepEqual(touchOf(raw), {
			schemes: { swim: { gestures: 'both' }, walk: {} },
			characters: { salmon: 'swim', bear: 'walk', fisherman: 'walk' },
		});
		const salmon = touchSchemeOf(raw, 'salmon', pointer);
		assert.equal(salmon.gestures, 'both');
		assert.equal(salmon.ability, 'tap');
		assert.equal(salmon.aim, 'point');
		assert.equal(salmon.deadZone, pointer.deadZone);
		assert.equal(salmon.releaseStops, true);
		assert.deepEqual(touchSchemeOf(raw, 'bear', pointer), touchSchemeOf(raw, 'fisherman', pointer));
		assert.equal(touchSchemeOf(raw, 'bear', pointer).gestures, 'hold');
		assert.deepEqual(validateTouchSchemes(raw), []);
	},
);

check('Salmons’ export ships the schemes', () => {
	const exporter = read('scripts/salmons/export.mjs');
	assert.match(exporter, /withTouchSchemes\(normalizeGameConfigDoc\(authored\), authored\)/);
});

console.log(`check:arcade-touch — ${passed} checks passed`);
