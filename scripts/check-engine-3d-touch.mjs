// The 3D field's touch controls (`packages/engine-3d/src/pure/touch.ts`; 3D review A N1: a phone
// could not move in the 3D field): the layout on a phone, a landscape phone and a tablet, which
// control each finger takes, the stick (dead zone, rim, run past the rim), the buttons, the look
// travel, the merge with the keys, and a played offline field — a thumb on the stick walks the
// player, the jump button jumps it. No DOM and no Pixi: what `src/touch.ts` draws and feeds.
//
// Run: pnpm check:engine-3d-touch

import {
	createLevel3d,
	createPlay3d,
	createTouch3d,
	mergeSticks3d,
	moveAxes,
	playField3d,
	STICK_DEAD_ZONE,
	STICK_RUN_AT,
	TOUCH_LOOK_GAIN,
	touchLayout3d,
} from '../packages/engine-3d/pure.ts';
import { MOVE_SCALE } from '../packages/engine-mechanics/src/motion3d.js';
import { BUTTONS3D } from '../packages/engine-mechanics/src/online3d.js';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
	if (ok) passed += 1;
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- The layout, on three screens.
for (const [name, w, h] of [
	['portrait phone', 390, 844],
	['landscape phone', 844, 390],
	['tablet', 1366, 1024],
	['small phone', 320, 568],
]) {
	const l = touchLayout3d(w, h);
	const inside = (x, y, r) => x - r >= 0 && y - r >= 0 && x + r <= w && y + r <= h;
	check(
		`${name}: every button is on screen`,
		l.buttons.every((b) => inside(b.x, b.y, b.r)),
	);
	check(
		`${name}: the buttons are on the right half`,
		l.buttons.every((b) => b.x - b.r > w / 2),
	);
	check(
		`${name}: no two buttons overlap`,
		l.buttons.every((a, i) =>
			l.buttons.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r),
		),
	);
	check(
		`${name}: the resting stick is on screen, on the left half`,
		inside(l.stickHome.x, l.stickHome.y, l.stickRadius) && l.stickHome.x + l.stickRadius < w / 2,
	);
	check(
		`${name}: every button is at least 44 px across (a thumb)`,
		l.buttons.every((b) => b.r * 2 >= 44),
		l.buttons.map((b) => Math.round(b.r * 2)).join(),
	);
	check(
		`${name}: jump, attack and interact`,
		l.buttons.map((b) => b.id).join() === 'jump,attack,interact' &&
			l.buttons[0].bit === BUTTONS3D.jump &&
			l.buttons[1].bit === BUTTONS3D.attack &&
			l.buttons[2].bit === BUTTONS3D.interact,
	);
}
const phone = touchLayout3d(390, 844);
const tablet = touchLayout3d(1366, 1024);
check('a tablet gets no saucers (the unit stops at 84 px)', near(tablet.stickRadius, 84 * 1.1));
check('a phone stick is thumb-sized', phone.stickRadius > 50 && phone.stickRadius < 80);

// --- The stick.
{
	const t = createTouch3d(390, 844);
	const r = t.layout().stickRadius;
	check('a finger on the left half takes the stick', t.down(1, 100, 600) && t.owns(1));
	const v0 = t.view().stick;
	check('the base lands under the thumb', v0.held && v0.base.x === 100 && v0.base.y === 600);
	t.move(1, 100, 600 - r * STICK_DEAD_ZONE * 0.9);
	let f = t.read();
	check(
		'inside the dead zone the stick rests',
		f.right === 0 && f.forward === 0,
		JSON.stringify(f),
	);
	t.move(1, 100, 600 - r);
	f = t.read();
	check('pushed to the rim, up: full forward', near(f.forward, 1) && near(f.right, 0));
	check('at the rim it walks (no run)', !(f.buttons & BUTTONS3D.sprint));
	t.move(1, 100 + r / 2, 600);
	f = t.read();
	const half = (0.5 - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
	check(
		'half way right: the rest of the travel past the dead zone',
		near(f.right, half),
		String(f.right),
	);
	t.move(1, 100, 600 + r * (STICK_RUN_AT + 0.05));
	f = t.read();
	check(
		'past the rim: backward at full and running',
		near(f.forward, -1) && !!(f.buttons & BUTTONS3D.sprint),
	);
	const knob = t.view().stick;
	check(
		'the knob stays on the rim when the thumb is past it',
		near(Math.hypot(knob.knob.x - knob.base.x, knob.knob.y - knob.base.y), r, 1e-6) && knob.run,
	);
	t.move(1, 100, 600 + r * 1.05);
	check('back just inside the run point it still runs', !!(t.read().buttons & BUTTONS3D.sprint));
	t.move(1, 100, 600 + r * 0.9);
	check('back inside the rim it walks', !(t.read().buttons & BUTTONS3D.sprint));
	check('a second thumb on the left half is not taken', !t.down(2, 60, 700) && !t.owns(2));
	t.up(1);
	f = t.read();
	check('lifted, the stick rests and the finger is let go', f.forward === 0 && !t.owns(1));
	const rest = t.view().stick;
	check(
		'at rest the stick is drawn at its home',
		!rest.held && rest.base.x === t.layout().stickHome.x && rest.knob.y === t.layout().stickHome.y,
	);
	t.down(3, 2, 843);
	const edge = t.view().stick.base;
	check('a base at the screen edge is kept a radius inside', edge.x === r && edge.y === 844 - r);
}

// --- The buttons.
{
	const t = createTouch3d(390, 844);
	const [jump, attack, interact] = t.layout().buttons;
	check('a finger on jump takes it', t.down(1, jump.x, jump.y));
	check('jump is held while the finger is down', t.read().buttons === BUTTONS3D.jump);
	check('it stays held across reads', t.read().buttons === BUTTONS3D.jump);
	t.down(2, attack.x + attack.r * 1.1, attack.y);
	check(
		'a finger a little wide of attack still presses it',
		(t.read().buttons & BUTTONS3D.attack) !== 0,
	);
	t.down(3, interact.x, interact.y);
	check(
		'three buttons at once',
		t.read().buttons === (BUTTONS3D.jump | BUTTONS3D.attack | BUTTONS3D.interact) &&
			t.view().pressed.size === 3,
	);
	t.up(1);
	check(
		'jump lifted, the others held',
		t.read().buttons === (BUTTONS3D.attack | BUTTONS3D.interact),
	);
	t.move(2, 10, 10);
	check(
		'a button finger that slides off still holds its button',
		(t.read().buttons & BUTTONS3D.attack) !== 0,
	);
	t.clear();
	check('clear lets every finger go', t.read().buttons === 0 && !t.owns(2) && !t.owns(3));
}

// --- The look.
{
	const t = createTouch3d(390, 844);
	check('a finger on the right half, off the buttons, looks', t.down(1, 300, 300) && t.owns(1));
	t.move(1, 310, 296);
	let f = t.read();
	check(
		`its travel × ${TOUCH_LOOK_GAIN} is the look`,
		near(f.lookX, 10 * TOUCH_LOOK_GAIN) && near(f.lookY, -4 * TOUCH_LOOK_GAIN),
		JSON.stringify(f),
	);
	check('a read consumes the travel', t.read().lookX === 0);
	check('looking moves nothing', f.right === 0 && f.forward === 0 && f.buttons === 0);
	t.down(2, 320, 200);
	t.move(1, 360, 296);
	t.move(2, 330, 200);
	f = t.read();
	check(
		'the newest look finger looks, the older one is spent',
		near(f.lookX, 10 * TOUCH_LOOK_GAIN),
	);
	check('a spent finger is still owned (it must not aim)', t.owns(1));
	t.down(3, 80, 600);
	t.move(3, 80, 600 - t.layout().stickRadius);
	t.move(2, 340, 200);
	f = t.read();
	check(
		'two thumbs: walk and look in the same frame',
		near(f.forward, 1) && near(f.lookX, 10 * TOUCH_LOOK_GAIN),
	);
	t.resize(844, 390);
	check(
		'a resize lays the controls out again',
		t.layout().width === 844 && t.layout().buttons[0].x > 700,
	);
}

// --- The merge with the keys.
{
	const keys = { right: 1, forward: 1, buttons: BUTTONS3D.sprint };
	const idle = { right: 0, forward: 0, buttons: 0 };
	const alone = mergeSticks3d(keys, idle);
	check(
		'the keys alone give what they gave',
		alone.right === 1 && alone.forward === 1 && alone.buttons === BUTTONS3D.sprint,
	);
	const both = mergeSticks3d(keys, { right: 0.5, forward: 1, buttons: BUTTONS3D.jump });
	check(
		'keys and a stick: each axis held to 1, the buttons join',
		both.right === 1 && both.forward === 1 && both.buttons === (BUTTONS3D.sprint | BUTTONS3D.jump),
	);
	check(
		'opposite pushes cancel',
		mergeSticks3d({ right: -1, forward: 0, buttons: 0 }, { right: 1, forward: 0, buttons: 0 })
			.right === 0,
	);
	check('a stick up is forward: −z at yaw 0', moveAxes(0, 1, 0).mz === -MOVE_SCALE);
}

// --- Played: a phone moves the player (the review's 0 m).
{
	const field = playField3d(undefined);
	const arena = field.level;
	const play = createPlay3d({
		level: createLevel3d(arena),
		spawn: arena.spawn,
		spec: field.motion,
	});
	const t = createTouch3d(390, 844);
	const keys = { right: 0, forward: 0, buttons: 0 };
	const frame = (ms) => {
		const stick = mergeSticks3d(keys, t.read());
		const move = moveAxes(stick.right, stick.forward, 0);
		play.advance(ms, { ...move, yaw: 0, buttons: stick.buttons });
	};
	for (let i = 0; i < 60; i++) frame(1000 / 60);
	const start = { ...play.player };
	t.down(1, 100, 600);
	t.move(1, 100, 600 - t.layout().stickRadius);
	for (let i = 0; i < 60; i++) frame(1000 / 60);
	const walked = { ...play.player };
	check(
		'a thumb on the stick walks the player forward (−z)',
		walked.z < start.z - 2 && Math.abs(walked.x - start.x) < 0.01,
		`z ${start.z.toFixed(2)} → ${walked.z.toFixed(2)}`,
	);
	t.up(1);
	for (let i = 0; i < 30; i++) frame(1000 / 60);
	const [jump] = t.layout().buttons;
	t.down(2, jump.x, jump.y);
	let peak = play.player.y;
	for (let i = 0; i < 10; i++) {
		frame(1000 / 60);
		peak = Math.max(peak, play.player.y);
	}
	t.up(2);
	for (let i = 0; i < 40; i++) {
		frame(1000 / 60);
		peak = Math.max(peak, play.player.y);
	}
	check('the jump button jumps it', peak > 1, `peak ${peak.toFixed(2)} m`);
}

if (failures.length) {
	console.error(`check:engine-3d-touch — ${failures.length} failed:\n  ${failures.join('\n  ')}`);
	process.exit(1);
}
console.log(`check:engine-3d-touch — ${passed} checks passed`);
