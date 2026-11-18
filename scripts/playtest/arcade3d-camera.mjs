// Plays the 3D camera director (`docs/design/3d-games.md` Phase 2, animation evaluation §4 A4–A5) on
// an `arcade3d` runtime build, in the headless shell: the arcade sample on the placeholder arena,
// with its flow extended by the camera's Flow words — a tap plays the Blender intro move
// (`cameraPlayMove`, awaited, then `cameraMoveFinished`), keys 1–4 switch rigs (`cameraActivate`)
// and K shakes (`cameraShake`, standing in for a hit until 3D combat exists).
//
// It checks: the intro plays, raises `cameraMoveFinished` and hands back to first person (the
// default rig: the owner's choice) without a pop; each switch first person → follow → orbit →
// shoulder → first person blends with no frame-to-frame jump;
// after a drag turns the orbit, W walks the way the camera looks; the shoulder camera pulls in
// against the south wall and eases back out; K shakes the first-person view and it settles; walking
// into the pit, the ghost camera detaches, rises and watches where the body fell, then hands back to
// the eyes; no page error.
// Screenshots go to --out (read them).
//
//   PUBLIC_IE_FAMILIES=arcade PUBLIC_IE_3D=1 PUBLIC_RGS_TRANSPORT=play4fun \
//     PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/arcade3d-camera.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//   … --serve prints the game's URL and keeps serving it: play it by hand (1–4, K, drag, wheel).
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	ARCADE_SAMPLE_COMPONENTS,
	arcadeReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import { ARCADE_DRIVEN_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/arcadeSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { fromYawPitchRoll } from '../../packages/engine-3d/pure.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/arcade3d-camera') },
		seed: { type: 'string', default: '7' },
		chrome: { type: 'string' },
		serve: { type: 'boolean', default: false },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'arcade-sample';

const config = normalizeGameConfigDoc(
	JSON.parse(
		readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
	),
);

/** The sample's flow with the camera words wired in. */
const cameraFlow = () => {
	const doc = structuredClone(ARCADE_DRIVEN_SEED_DOC);
	const { nodes, exec } = doc.graph;
	const text = (value) => ({ kind: 'literal', type: { t: 'string' }, value });
	const float = (value) => ({ kind: 'literal', type: { t: 'float' }, value });
	let row = 40;
	const add = (node) => {
		nodes.push({ ...node, pos: { x: 0, y: 120 * row++ } });
		return node.id;
	};
	const after = (from, pin, to) =>
		exec.push({ from: { node: from, pin }, to: { node: to, pin: 'exec' } });
	// The tap that starts the round plays the intro, then marks it done.
	const intro = add({
		id: 'cam_intro',
		kind: 'action',
		ref: 'cameraPlayMove',
		inputs: { clip: text('intro'), blendIn: float(0), blendOut: float(900) },
	});
	after('ar_tapped_start', 'exec', intro);
	const finished = add({
		id: 'cam_finished',
		kind: 'setVariable',
		variable: 'introDone',
		inputs: { value: text('yes') },
	});
	after('ar_signals', 'cameraMoveFinished', finished);
	doc.variables.push({ id: 'introDone', type: 'string', initial: '', scope: 'game' });
	const rigs = {
		camFollow: ['1', 'follow'],
		camOrbit: ['2', 'orbit'],
		camShoulder: ['3', 'shoulder'],
		camFirst: ['4', 'firstPerson'],
	};
	for (const [action, [key, rig]] of Object.entries(rigs)) {
		doc.inputs.push({ action, keys: [key] });
		const on = add({ id: `cam_on_${action}`, kind: 'onInput', action });
		const go = add({
			id: `cam_go_${action}`,
			kind: 'action',
			ref: 'cameraActivate',
			inputs: { rig: text(rig), blendMs: float(700) },
		});
		after(on, 'exec', go);
	}
	doc.inputs.push({ action: 'camShake', keys: ['k'] });
	const onShake = add({ id: 'cam_on_shake', kind: 'onInput', action: 'camShake' });
	const shake = add({
		id: 'cam_shake',
		kind: 'action',
		ref: 'cameraShake',
		inputs: { strength: float(0.9), duration: float(700) },
	});
	after(onShake, 'exec', shake);
	return doc;
};

const doc = arcadeReferenceLayout();
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...ARCADE_SAMPLE_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { shots: [], verdicts: [], measured: {} };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'arcade3d-camera-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: cameraFlow() }),
);

const HOOK = `(() => {
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'lines',
	name: 'Arcade sample',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: opt.seed });
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Arcade sample',
	snapshotId: 'sample',
	assetBase: `${server.origin}/${KEY}/`,
});
const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'arcade3d-camera',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `arcade3d-camera-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	arseed: 'camera-playtest',
	ie_determinism: opt.seed,
});

if (opt.serve) {
	params.delete('ie_determinism');
	console.log(`${server.origin}/${KEY}/?${params}`);
	await new Promise(() => {});
}

const KEYS = {
	KeyW: [87, 'w'],
	KeyS: [83, 's'],
	KeyK: [75, 'k'],
	Digit1: [49, '1'],
	Digit2: [50, '2'],
	Digit3: [51, '3'],
	Digit4: [52, '4'],
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const turned = (a, b) => {
	const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
	return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};

let page;
try {
	page = await openPage(headlessShell(opt.chrome), join(work, 'profile'));
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: 1280,
		height: 720,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	const key = async (code, type) => {
		const [vk, name] = KEYS[code];
		await page.page('Input.dispatchKeyEvent', {
			type: type === 'down' ? 'rawKeyDown' : 'keyUp',
			key: name,
			code,
			windowsVirtualKeyCode: vk,
		});
	};
	const press = async (code) => {
		await key(code, 'down');
		await key(code, 'up');
	};
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	/** The camera this frame (`__IE_CAMERA3D__`) and the own player. */
	const read = () =>
		page.evaluate(`(() => {
			const view = window.__IE_CAMERA3D__?.view();
			const me = window.__IE_DETERMINISM__.state().arcade?.bodies.find((b) => b.tags.includes('player'));
			return view ? { live: view.live, blending: view.blending, yaw: view.yaw, pitch: view.pitch, pose: view.pose, me } : null;
		})()`);
	/** Step one frame at a time and record the camera. */
	const track = async (frames) => {
		const seen = [];
		for (let i = 0; i < frames; i++) {
			await page.evaluate(`window.__IE_DETERMINISM__.step(1, { draw: 'last' })`);
			seen.push(await read());
		}
		return seen;
	};
	/** The largest frame-to-frame move and turn of the camera in a run. */
	const jumps = (seen) => {
		let move = 0;
		let turn = 0;
		for (let i = 1; i < seen.length; i++) {
			move = Math.max(move, dist(seen[i].pose.position, seen[i - 1].pose.position));
			turn = Math.max(turn, turned(seen[i].pose.rotation, seen[i - 1].pose.rotation));
		}
		return { move: +move.toFixed(3), turn: +turn.toFixed(2) };
	};
	let shots = 0;
	const shot = async (label) => {
		const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
		writeFileSync(join(out, file), await page.screenshot());
		result.shots.push(file);
	};

	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }]);
	await play([{ op: 'tapToStart' }, { op: 'waitFor', until: { playerIn: true } }]);
	for (let i = 0; i < 60 && !(await read()); i++) await play([{ op: 'step', frames: 5 }]);

	// --- The intro move (Blender → glTF → cameraPlayMove), then the hand-back to first person.
	const start = await read();
	verdict(
		'the tap plays the intro move',
		!!start && start.live.startsWith('move:intro'),
		start?.live,
	);
	const intro = await track(60);
	await shot('intro');
	const introRest = await track(250);
	const all = [...intro, ...introRest];
	const back = all.findIndex((v) => v.live === 'firstPerson');
	const flowSaw = await page.evaluate(`window.__IE_FLOW_V2__?.state?.read('introDone')`);
	verdict('the intro raised cameraMoveFinished in Flow', flowSaw === 'yes', flowSaw);
	result.measured.introJumps = jumps(all);
	verdict(
		'the intro hands back to first person without a pop',
		back > 200 &&
			back < 260 &&
			result.measured.introJumps.move < 1.2 &&
			result.measured.introJumps.turn < 8,
		{ handBackFrame: back, ...result.measured.introJumps },
	);
	await play([{ op: 'step', frames: 60 }]);
	await shot('first-person');

	// --- Switch first person → follow → orbit → shoulder → first person, each blended.
	for (const [code, rig] of [
		['Digit1', 'follow'],
		['Digit2', 'orbit'],
		['Digit3', 'shoulder'],
		['Digit4', 'firstPerson'],
	]) {
		const before = await read();
		await press(code);
		const seen = [before, ...(await track(55))];
		const j = jumps(seen);
		result.measured[`to-${rig}`] = j;
		const last = seen.at(-1);
		verdict(
			`${before.live} → ${rig} blends without a pop`,
			last.live === rig &&
				!last.blending &&
				seen.some((v) => v.blending) &&
				j.move < 0.9 &&
				j.turn < 6,
			{ ...j, live: last.live },
		);
		await shot(rig);
	}

	// --- A drag turns the orbit; W then walks the way the camera looks.
	await press('Digit2');
	await play([{ op: 'step', frames: 50 }]);
	const drag = [
		{ type: 'mousePressed', x: 640, y: 420, buttons: 1 },
		...Array.from({ length: 10 }, (_, i) => ({
			type: 'mouseMoved',
			x: 640 - 30 * (i + 1),
			y: 420,
			buttons: 1,
		})),
		{ type: 'mouseReleased', x: 340, y: 420, buttons: 0 },
	];
	for (const e of drag) {
		await page.page('Input.dispatchMouseEvent', { ...e, button: 'left', clickCount: 1 });
		await play([{ op: 'step', frames: 1 }]);
	}
	await play([{ op: 'step', frames: 20 }]);
	const turnedView = await read();
	await key('KeyW', 'down');
	await play([{ op: 'step', frames: 40 }]);
	await key('KeyW', 'up');
	await play([{ op: 'step', frames: 10 }]);
	const walked = await read();
	const fwd = {
		x: -Math.sin((turnedView.yaw * Math.PI) / 180),
		z: -Math.cos((turnedView.yaw * Math.PI) / 180),
	};
	const dx = walked.me.x - turnedView.me.x;
	const dz = walked.me.z - turnedView.me.z;
	const along = (dx * fwd.x + dz * fwd.z) / Math.max(1e-6, Math.hypot(dx, dz));
	verdict(
		'after the orbit turns, W walks the way the camera looks',
		Math.abs(turnedView.yaw) > 20 && Math.hypot(dx, dz) > 2 && along > 0.95,
		{ yaw: turnedView.yaw, moved: Math.hypot(dx, dz), along },
	);
	await shot('orbit-turned');

	// --- The shoulder camera against the south wall (z 16): back the player up to it.
	await press('Digit1');
	await play([{ op: 'step', frames: 60 }]);
	await press('Digit3');
	await play([{ op: 'step', frames: 60 }]);
	const open = await read();
	const pivotGap = (v) => dist(v.pose.position, { x: v.me.x, y: v.me.y + 1.6, z: v.me.z });
	await key('KeyS', 'down');
	await play([{ op: 'step', frames: 150 }]);
	await key('KeyS', 'up');
	await play([{ op: 'step', frames: 5 }]);
	const wall = await read();
	await shot('shoulder-wall');
	result.measured.wall = {
		openGap: +pivotGap(open).toFixed(3),
		wallGap: +pivotGap(wall).toFixed(3),
		playerZ: wall.me.z,
		cameraZ: wall.pose.position.z,
	};
	verdict(
		'the shoulder camera pulls in against the wall (and stays out of it)',
		wall.me.z > 14.5 && pivotGap(wall) < pivotGap(open) * 0.6 && wall.pose.position.z < 16,
		result.measured.wall,
	);
	await key('KeyW', 'down');
	const leaving = await track(40);
	await key('KeyW', 'up');
	const gaps = leaving.map(pivotGap);
	verdict(
		'leaving the wall it eases back out',
		gaps.at(-1) > gaps[0] + 0.5 && gaps.every((g, i) => i === 0 || g >= gaps[i - 1] - 0.05),
		{ from: gaps[0], to: gaps.at(-1) },
	);

	// --- A shake (K stands in for a hit): the view trembles, the aim does not, then it settles.
	await press('Digit4');
	await play([{ op: 'step', frames: 60 }]);
	await press('KeyK');
	const shaking = await track(12);
	await shot('shake');
	const off = (v) => {
		const q = fromYawPitchRoll(v.yaw, v.pitch);
		return turned(v.pose.rotation, q);
	};
	const peak = Math.max(...shaking.map(off));
	await play([{ op: 'step', frames: 60 }]);
	const settled = off(await read());
	result.measured.shake = { peakDeg: +peak.toFixed(2), settledDeg: +settled.toFixed(4) };
	verdict(
		'K shakes the view, then it settles',
		peak > 0.5 && settled < 0.05,
		result.measured.shake,
	);

	// --- Death: steer the first-person player into the pit (x 6..10, z −10..−6) by looking and W.
	/** Turn the first-person view toward a point (a drag: yaw −= px × 0.2°) and walk a little. */
	const walkToward = async (x, z, frames) => {
		const v = await read();
		const want = (Math.atan2(-(x - v.me.x), -(z - v.me.z)) * 180) / Math.PI;
		const turn = ((((v.yaw - want) % 360) + 540) % 360) - 180;
		const px = Math.max(-300, Math.min(300, turn / 0.2));
		if (Math.abs(px) >= 1) {
			const moves = [
				{ type: 'mousePressed', x: 640, y: 420, buttons: 1 },
				{ type: 'mouseMoved', x: 640 + px / 2, y: 420, buttons: 1 },
				{ type: 'mouseMoved', x: 640 + px, y: 420, buttons: 1 },
				{ type: 'mouseReleased', x: 640 + px, y: 420, buttons: 0 },
			];
			for (const e of moves) {
				await page.page('Input.dispatchMouseEvent', { ...e, button: 'left', clickCount: 1 });
				await play([{ op: 'step', frames: 1 }]);
			}
		}
		await key('KeyW', 'down');
		const seen = await track(frames);
		await key('KeyW', 'up');
		return seen;
	};
	let ghost;
	/** The frames from the ghost's first one on. */
	let ghostRun = [];
	// Round the east ramp's side face (x 5..11, z ±1.5) and the trampoline (x 11..14, z 2..5).
	for (const [x, z] of [
		[15, 8],
		[15, -4],
		[8, -8],
	])
		for (let leg = 0; leg < 12 && !ghost; leg++) {
			const seen = await walkToward(x, z, 15);
			ghostRun = seen.slice(
				Math.max(
					0,
					seen.findIndex((v) => v.live === 'ghost'),
				),
			);
			ghost = seen.find((v) => v.live === 'ghost');
			const at = seen.at(-1).me;
			(result.measured.deathWalk ??= []).push({
				to: [x, z],
				at: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)],
				yaw: +seen.at(-1).yaw.toFixed(1),
				live: seen.at(-1).live,
			});
			if (Math.hypot(at.x - x, at.z - z) < 0.8) break;
		}
	// Over the pit the body still falls ~1.6 s to the death plane.
	if (!ghost) {
		const seen = await track(150);
		ghost = seen.find((v) => v.live === 'ghost');
		if (ghost) ghostRun = seen.slice(seen.indexOf(ghost));
	}
	verdict('falling into the pit hands the camera to the ghost', !!ghost, result.measured.deathWalk);
	if (ghost) {
		// 60 frames into the ghost (the run so far, topped up).
		const dying = [...ghostRun, ...(await track(Math.max(0, 61 - ghostRun.length)))];
		await shot('ghost');
		const risen = dying[60];
		result.measured.ghost = {
			from: ghost.pose.position,
			to: risen.pose.position,
			pitch: risen.pitch,
		};
		verdict(
			'the ghost rises and looks down at where the body fell',
			risen.live === 'ghost' &&
				risen.pose.position.y > ghost.pose.position.y + 1 &&
				risen.pitch < -20,
			result.measured.ghost,
		);
		const after = await track(110);
		const home = after.findIndex((v) => v.live === 'firstPerson');
		verdict(
			'after the death cam the eyes come back (respawned)',
			home >= 0 && after.at(-1).live === 'firstPerson' && !after.at(-1).blending,
			{ frame: home },
		);
		await shot('respawned');
	}

	// --- A portrait phone: the lens holds the FOV across (a rig's FOV is vertical).
	const landscape = (await track(2)).at(-1);
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: 390,
		height: 844,
		deviceScaleFactor: 1,
		mobile: false,
	});
	const portrait = (await track(10)).at(-1);
	const aspect = 390 / 844;
	const across = (fov, a) => (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * a) * 180) / Math.PI;
	result.measured.portrait = {
		rig: portrait.live,
		landscapeFov: landscape.pose.fov,
		portraitFov: +portrait.pose.fov.toFixed(2),
		acrossWithout: +across(landscape.pose.fov, aspect).toFixed(1),
		across: +across(portrait.pose.fov, aspect).toFixed(1),
	};
	verdict(
		'on a portrait phone the lens widens the view across',
		portrait.live === landscape.live &&
			portrait.pose.fov > landscape.pose.fov &&
			result.measured.portrait.across > result.measured.portrait.acrossWithout + 15,
		result.measured.portrait,
	);
	await shot('portrait');
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: 1280,
		height: 720,
		deviceScaleFactor: 1,
		mobile: false,
	});

	const errors = await page.evaluate('window.__AR_ERRORS__');
	verdict('no page error', errors.length === 0, errors);
} catch (error) {
	const errors = await page?.evaluate('window.__AR_ERRORS__').catch(() => undefined);
	verdict('the playtest ran', false, { error: String(error?.stack ?? error), errors });
	if (page)
		writeFileSync(join(out, 'failed.png'), await page.screenshot().catch(() => Buffer.alloc(0)));
} finally {
	await page?.close?.();
	await server.close?.();
	await snap.close?.();
	// The browser may still hold its profile for a moment; a leftover temp folder is harmless.
	try {
		rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	} catch (error) {
		console.warn(`left ${work} behind: ${error.code ?? error}`);
	}
}

writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
const failed = result.verdicts.filter((v) => !v.ok);
for (const v of result.verdicts) console.log(`${v.ok ? 'PASS' : 'FAIL'} ${v.name}`);
console.log(JSON.stringify(result.measured));
if (failed.length) {
	for (const v of failed) console.log(JSON.stringify(v.detail));
	process.exit(1);
}
