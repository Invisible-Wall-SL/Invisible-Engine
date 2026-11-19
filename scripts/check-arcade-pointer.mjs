// Mouse and touch control of an online arcade player (docs/design/arcade-pointer-controller.md):
// what a press, a hover, a tap and a drag do, as the original Salmons did them
// (`GuiltyForever/Salmon-` client/input.js, game.js `tick`); how a canvas point reaches the field
// through the world camera and the isometric projection; the move it makes is a direction the room
// clamps to itself (server-authoritative, deterministic); and a game without `arcade.online.pointer`
// reads the keyboard only, as before.
//
// Run: pnpm check:arcade-pointer

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	MAX_TAPS,
	POINTER_DEFAULTS,
	createPointerTracker,
	pointerMove,
} from '../packages/engine-mechanics/src/pointerControl.js';
import { MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { CELL } from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	ARCADE_POINTER_DEFAULTS,
	normalizeGameConfigDoc,
	onlineGameOf,
} from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import {
	ISO_PROJECTOR_MIRRORED,
	isoProject,
	isoUnproject,
	screenToWorldDirection,
} from '../packages/engine-layout/src/lib/projection.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const { Container } = await import(
	pathToFileURL(createRequire(join(root, 'packages/engine-layout/package.json')).resolve('pixi.js'))
		.href
);

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
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const touch = (type, id, x, y) => ({ type, id, kind: 'touch', x, y });
const mouse = (type, x, y, button = 0) => ({ type, id: 1, kind: 'mouse', x, y, button });

console.log("the tracker: the original's touch and mouse");

check('a finger steers while it is down, and lifting it stops the player', () => {
	const t = createPointerTracker();
	assert.equal(t.target(), undefined);
	t.event(touch('down', 7, 100, 100));
	assert.deepEqual(t.target(), { x: 100, y: 100 });
	t.event(touch('move', 7, 160, 140));
	assert.deepEqual(t.target(), { x: 160, y: 140 });
	t.event(touch('up', 7, 160, 140));
	assert.equal(t.target(), undefined);
	assert.equal(t.takeTap(), undefined, 'a drag is not a tap');
});

check(
	'a tap is a lift within 12 px of the press (the original TOUCH_DEADZONE), at the lift',
	() => {
		assert.equal(POINTER_DEFAULTS.tapPx, 12);
		const t = createPointerTracker();
		t.event(touch('down', 1, 50, 50));
		t.event(touch('move', 1, 58, 58));
		t.event(touch('up', 1, 58, 58));
		assert.deepEqual(t.takeTap(), { x: 58, y: 58 });
		assert.equal(t.takeTap(), undefined, 'a tap is taken once');
		t.event(touch('down', 2, 50, 50));
		t.event(touch('move', 2, 63, 50));
		t.event(touch('move', 2, 50, 50));
		t.event(touch('up', 2, 50, 50));
		assert.equal(t.takeTap(), undefined, 'once moved past 12 px, it stays a drag');
	},
);

check('a cancelled touch neither taps nor keeps steering', () => {
	const t = createPointerTracker();
	t.event(touch('down', 3, 10, 10));
	t.event(touch('cancel', 3, 10, 10));
	assert.equal(t.target(), undefined);
	assert.equal(t.takeTap(), undefined);
});

check('multi-touch: the newest finger steers; the older one lifting does nothing', () => {
	const t = createPointerTracker();
	t.event(touch('down', 1, 10, 10));
	t.event(touch('down', 2, 300, 200));
	assert.deepEqual(t.target(), { x: 300, y: 200 });
	t.event(touch('move', 1, 20, 20));
	t.event(touch('up', 1, 20, 20));
	assert.deepEqual(t.target(), { x: 300, y: 200 });
	assert.equal(t.takeTap(), undefined);
	t.event(touch('up', 2, 300, 200));
	assert.deepEqual(t.takeTap(), { x: 300, y: 200 }, 'the steering finger lifted still = a tap');
	assert.equal(t.target(), undefined, 'and nobody steers until the next press');
});

check('mouse "hover": the cursor steers with no button; a press is the action at once', () => {
	const t = createPointerTracker({ mouse: 'hover' });
	assert.equal(t.target(), undefined, 'not before the mouse is used');
	t.event(mouse('move', 400, 300));
	assert.deepEqual(t.target(), { x: 400, y: 300 });
	t.event(mouse('down', 410, 300));
	assert.deepEqual(t.takeTap(), { x: 410, y: 300 });
	t.event(mouse('up', 410, 300));
	assert.equal(t.takeTap(), undefined, 'the release taps nothing more');
	t.event(mouse('down', 0, 0, 2));
	assert.equal(t.takeTap(), undefined, 'only the left button');
	assert.deepEqual(t.target(), { x: 410, y: 300 }, 'the last cursor point still steers');
});

check('a touch takes over from a hovering mouse until the mouse moves again', () => {
	const t = createPointerTracker({ mouse: 'hover' });
	t.event(mouse('move', 400, 300));
	t.event(touch('down', 9, 20, 30));
	t.event(touch('up', 9, 20, 30));
	t.takeTap();
	assert.equal(t.target(), undefined);
	t.event(mouse('move', 5, 6));
	assert.deepEqual(t.target(), { x: 5, y: 6 });
});

check('mouse "press" (the default): a mouse is a finger', () => {
	assert.equal(POINTER_DEFAULTS.mouse, 'press');
	const t = createPointerTracker();
	t.event(mouse('move', 400, 300));
	assert.equal(t.target(), undefined, 'a hover does not steer');
	t.event(mouse('down', 400, 300));
	assert.deepEqual(t.target(), { x: 400, y: 300 });
	t.event(mouse('up', 402, 301));
	assert.deepEqual(t.takeTap(), { x: 402, y: 301 });
	assert.equal(t.target(), undefined);
});

check('a lost focus forgets the press and its taps', () => {
	const t = createPointerTracker();
	t.event(touch('down', 1, 5, 5));
	t.event(touch('up', 1, 5, 5));
	t.event(touch('down', 2, 5, 5));
	t.release();
	assert.equal(t.target(), undefined);
	assert.equal(t.takeTap(), undefined);
	const h = createPointerTracker({ mouse: 'hover' });
	h.event(mouse('move', 40, 30));
	h.release();
	assert.equal(h.target(), undefined, 'a hovering mouse stops steering too');
	h.event(mouse('move', 41, 30));
	assert.deepEqual(h.target(), { x: 41, y: 30 }, 'until it moves again');
});

check('a burst of clicks keeps at most MAX_TAPS waiting', () => {
	const t = createPointerTracker({ mouse: 'hover' });
	for (let i = 0; i < 10; i++) t.event(mouse('down', i, 0));
	const taken = [];
	for (let tap = t.takeTap(); tap; tap = t.takeTap()) taken.push(tap.x);
	assert.equal(MAX_TAPS, 2);
	assert.deepEqual(taken, [0, 1]);
});

check('the tracker and Game Config share their defaults', () => {
	assert.deepEqual({ ...POINTER_DEFAULTS }, { ...ARCADE_POINTER_DEFAULTS });
});

console.log('the move: a direction the room clamps to itself');

check('full tilt towards the point; nothing within the dead zone or with no point', () => {
	assert.deepEqual(pointerMove({ x: 0, y: 0 }, { x: 500, y: 0 }, 72), { moveX: 127, moveY: 0 });
	assert.deepEqual(pointerMove({ x: 0, y: 0 }, { x: 0, y: -500 }, 72), { moveX: 0, moveY: -127 });
	assert.deepEqual(pointerMove({ x: 0, y: 0 }, { x: 71, y: 0 }, 72), { moveX: 0, moveY: 0 });
	assert.deepEqual(pointerMove({ x: 0, y: 0 }, { x: 73, y: 0 }, 72), { moveX: 127, moveY: 0 });
	assert.deepEqual(pointerMove({ x: 3, y: 3 }, { x: 3, y: 3 }, 0), { moveX: 0, moveY: 0 });
	assert.deepEqual(pointerMove(undefined, { x: 1, y: 1 }), { moveX: 0, moveY: 0 });
	assert.deepEqual(pointerMove({ x: 1, y: 1 }, undefined), { moveX: 0, moveY: 0 });
});

check('every direction: whole numbers within MOVE_SCALE, near full tilt and on the heading', () => {
	const field = { w: 4000, h: 4000 };
	for (let i = 0; i < 3600; i++) {
		const a = (i / 3600) * Math.PI * 2;
		const target = { x: 2000 + Math.cos(a) * 900, y: 2000 + Math.sin(a) * 900 };
		const move = pointerMove({ x: 2000, y: 2000 }, target, 24);
		const len = Math.hypot(move.moveX, move.moveY);
		assert.ok(Number.isInteger(move.moveX) && Number.isInteger(move.moveY));
		assert.ok(len <= MOVE_SCALE && len >= MOVE_SCALE - 1.5, `${i}: length ${len}`);
		assert.ok(
			near(Math.atan2(move.moveY, move.moveX), Math.atan2(Math.sin(a), Math.cos(a)), 0.012) ||
				near(Math.abs(Math.atan2(move.moveY, move.moveX)), Math.PI, 0.012),
		);
		const input = { seq: i + 1, ...move, buttons: 1, aimX: target.x, aimY: target.y, view: 0 };
		const once = clampInput({ ...input }, field);
		assert.ok(once.moveX === move.moveX && once.moveY === move.moveY, 'the room takes the move');
		assert.deepEqual(clampInput({ ...once }, field), once, 'and the clamp is idempotent');
	}
});

check('an aim off the field is clamped onto it by the room, as every aim is', () => {
	const input = clampInput(
		{ seq: 1, moveX: 0, moveY: 0, buttons: 2, aimX: -40, aimY: 9e9, view: 0 },
		{ w: 100, h: 200 },
	);
	assert.equal(input.aimX, 0);
	assert.equal(input.aimY, 200);
});

console.log('screen to world: through the camera and the projection');

// The game's tree as the layout draws it (the same as check:arcade-characters §11): the main box
// scales the design view onto the canvas, the world container sits at the camera's view plus its
// shake, and the spawn layer's parent below it. A projected layer then un-projects (IsoWorld).
const tree = (camera, scale = 0.5, offset = { x: 40, y: 10 }) => {
	const main = new Container();
	main.scale.set(scale);
	main.position.set(offset.x, offset.y);
	const world = new Container();
	world.position.set(camera.shakeX - camera.x, camera.shakeY - camera.y);
	main.addChild(world);
	const layerParent = new Container();
	world.addChild(layerParent);
	return layerParent;
};

check(
	'a flat world: a canvas point maps onto the field point under it, wherever the camera is',
	() => {
		for (const camera of [
			{ x: 0, y: 0, shakeX: 0, shakeY: 0 },
			{ x: 1234, y: 5678, shakeX: 3, shakeY: -4 },
		]) {
			const layer = tree(camera);
			const canvas = { x: 40 + 0.5 * 700, y: 10 + 0.5 * 400 };
			const at = layer.toLocal(canvas);
			assert.ok(
				near(at.x, camera.x + 700 - camera.shakeX) && near(at.y, camera.y + 400 - camera.shakeY),
			);
		}
	},
);

check('an isometric world: a ground point drawn on the canvas maps back onto itself', () => {
	const camera = { x: -800, y: 2400, shakeX: 0, shakeY: 0 };
	const layer = tree(camera, 0.75, { x: 0, y: 0 });
	for (const ground of [
		{ x: 900, y: 6800 },
		{ x: 1500, y: 3100 },
		{ x: 0, y: 0 },
	]) {
		const drawn = isoProject(ground.x, ground.y);
		const canvas = layer.toGlobal(drawn);
		const local = layer.toLocal(canvas);
		const back = isoUnproject(local.x, local.y);
		assert.ok(near(back.x, ground.x, 1e-6) && near(back.y, ground.y, 1e-6), JSON.stringify(back));
	}
	assert.match(
		read('packages/engine-layout/src/lib/SpawnLayer.svelte'),
		/const local = parent\.parent\.toLocal\(\{ x, y \}\);\s*return projection \? projection\.unproject\(local\.x, local\.y\)/,
	);
	assert.match(
		read('packages/engine-layout/src/lib/IsoWorld.svelte'),
		/unproject: \(x, y\) => drawing\.projector\.unproject\(x, y\),/,
	);
});

check(
	'a mirrored, zoomed isometric world (Salmons): the view centre is the box centre, and a point maps back',
	() => {
		const m = ISO_PROJECTOR_MIRRORED;
		const box = { w: 1422, h: 800 };
		for (const zoom of [1, 2 / 3, 1 / 3]) {
			const view = { x: 1300, y: 9000, w: box.w / zoom, h: box.h / zoom, shakeX: 0, shakeY: 24 };
			const centre = m.project(view.x + view.w / 2, view.y + view.h / 2);
			const main = new Container();
			main.scale.set(0.75);
			const world = new Container();
			world.scale.set(zoom);
			world.position.set(
				zoom * (view.shakeX + view.w / 2 - centre.x),
				zoom * (view.shakeY + view.h / 2 - centre.y),
			);
			main.addChild(world);
			const mid = world.toGlobal(m.project(view.x + view.w / 2, view.y + view.h / 2));
			assert.ok(near(mid.x, 0.75 * (box.w / 2)), `${zoom}: ${mid.x}`);
			assert.ok(near(mid.y, 0.75 * (box.h / 2 + zoom * view.shakeY)), `${zoom}: ${mid.y}`);
			for (const ground of [
				{ x: 900, y: 6800 },
				{ x: 1500, y: 9100 },
			]) {
				const local = world.toLocal(world.toGlobal(m.project(ground.x, ground.y)));
				const back = m.unproject(local.x, local.y);
				assert.ok(near(back.x, ground.x, 1e-6) && near(back.y, ground.y, 1e-6));
			}
		}
	},
);

check(
	"Salmons' screen-relative keys turn through the mirrored projector (the original's input.js)",
	() => {
		const m = ISO_PROJECTOR_MIRRORED;
		const near = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
		const r = Math.SQRT1_2;
		// Up: up the screen, the world's (−1, −1) (the original's gx − 1, gy − 1): up-river and left.
		assert.ok(near(screenToWorldDirection(m, 0, -1), { x: -r, y: -r }));
		// Up + Left: straight up the river (world −y); Down + Right: straight down it.
		assert.ok(near(screenToWorldDirection(m, -1, -1), { x: 0, y: -1 }));
		assert.ok(near(screenToWorldDirection(m, 1, 1), { x: 0, y: 1 }));
		// Left / Right: across, Left towards world +x (the original's gy + 1).
		assert.ok(near(screenToWorldDirection(m, -1, 0), { x: r, y: -r }));
		assert.ok(near(screenToWorldDirection(m, 1, 0), { x: -r, y: r }));
		const online = read('apps/lines/src/game/online.ts');
		assert.match(
			online,
			/const projector = worldCamera\?\.projector;\s*const move = projector \? screenMoveBy\(projector\) : axisMove;/,
		);
		assert.match(online, /screenToWorldDirection\(projector, Math\.sign\(x\), Math\.sign\(y\)\)/);
		assert.doesNotMatch(online, /isoUnproject|isoProject\(/);
	},
);

check(
	"the device maps each step's pointer through the players' layer (re-mapped as the camera follows)",
	() => {
		const online = read('apps/lines/src/game/online.ts');
		assert.match(online, /spawnLayerPoint\(current\.game\.online\.layer, global\.x, global\.y\)/);
		assert.match(online, /const target = fieldPoint\(current, pointerIo\.tracker\.target\(\)\);/);
		assert.match(online, /Object\.assign\(input, pointerMove\(own, target, pointer\.deadZone\)\);/);
		assert.match(online, /const raw = withPointer\(\s*current,\s*keyInput\(/);
		assert.match(online, /const input = clampInput\(raw, current\.game\.field\);/);
	},
);

console.log('the config: off unless named; Salmons as the original');

const arcadeDoc = (online) => ({
	family: 'arcade',
	outcome: 'rules',
	arcade: {
		field: { w: 1000, h: 1000 },
		bodies: { hero: { shape: 'box', w: 40, h: 40 } },
		online: { characters: [{ id: 'hero', body: 'hero', speed: 200 }], ...online },
	},
});

check(
	'absent: no pointer block survives, none resolves, the device reads the keyboard only',
	() => {
		const doc = normalizeGameConfigDoc(arcadeDoc({}));
		assert.equal('pointer' in doc.arcade.online, false);
		const game = onlineGameOf(doc);
		assert.equal(game.online.pointer, undefined);
		const online = read('apps/lines/src/game/online.ts');
		assert.match(online, /if \(!pointerIo \|\| !pointer\) return input;/);
		assert.match(
			online,
			/const unpoint =\s+canvas && toGlobal && pointer \? listenPointer\(canvas, toGlobal, pointer\) : undefined;/,
		);
	},
);

check(
	'present: an empty block turns it on with the defaults; defaults are dropped when stored',
	() => {
		const doc = normalizeGameConfigDoc(arcadeDoc({ pointer: {} }));
		assert.deepEqual(doc.arcade.online.pointer, {});
		assert.deepEqual(onlineGameOf(doc).online.pointer, { ...ARCADE_POINTER_DEFAULTS, taps: {} });
		const again = normalizeGameConfigDoc(
			arcadeDoc({ pointer: { mouse: 'press', deadZone: 24, tapPx: 12, taps: { hero: 'nope' } } }),
		);
		assert.deepEqual(again.arcade.online.pointer, {});
	},
);

check(
	'values are held to their limits; a tap of an unknown character or an unused button warns',
	() => {
		const doc = normalizeGameConfigDoc(
			arcadeDoc({
				pointer: { deadZone: 5000, tapPx: 7, taps: { ghost: 'jump', hero: 'ability2' } },
			}),
		);
		assert.equal(onlineGameOf(doc).online.pointer.deadZone, 1000);
		const issues = validateFamily(doc).filter((i) => i.path.startsWith('arcade.online.pointer'));
		assert.deepEqual(
			issues.map((i) => [i.severity, i.path]),
			[
				['warning', 'arcade.online.pointer.deadZone'],
				['warning', 'arcade.online.pointer.taps.ghost'],
				['warning', 'arcade.online.pointer.taps.hero'],
			],
		);
	},
);

check(
	'Salmons: the cursor and the finger steer every class, 1.5 tiles dead zone, a tap acts',
	() => {
		const doc = normalizeGameConfigDoc(salmonsConfig());
		const pointer = onlineGameOf(doc).online.pointer;
		assert.deepEqual(pointer, {
			mouse: 'hover',
			deadZone: 1.5 * CELL,
			tapPx: 12,
			taps: { salmon: 'jump', bear: 'ability1', fisherman: 'ability1' },
		});
		const abilities = doc.arcade.online.rules.abilities;
		for (const [character, button] of Object.entries(pointer.taps).filter(([, b]) => b !== 'jump'))
			assert.ok(abilities.some((a) => a.character === character && a.button === button));
		assert.deepEqual(
			validateFamily(doc).filter((i) => i.path.startsWith('arcade.online.pointer')),
			[],
		);
	},
);

console.log(`check:arcade-pointer — ${passed} checks passed`);
