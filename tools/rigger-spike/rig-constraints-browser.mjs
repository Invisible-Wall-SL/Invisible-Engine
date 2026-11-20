// Browser gate for "constraints you can see" (docs/design/rig-controls.md §4.2–4.4, §4.6, phase K1).
//
//   node tools/rigger-spike/rig-constraints-browser.mjs
//   node tools/rigger-spike/rig-constraints-browser.mjs --shot <file.png>   # also save the stage
//
// Drives the REAL `apps/launcher-api/static/rigger/view.html` in a REAL Chromium against a fake
// launcher API, on the repo's `W` symbol (a path constraint and a transform constraint) and on a small
// rig with a tail. Checked, the way an author meets it:
//   - the Constraints list is in solve order, numbered, each row in its kind's colour; the section's
//     description is its header's tooltip;
//   - the stage draws W's constraints: its bones in the kind's colour, dashed links, the path's curve;
//   - ＋ Add constraint lists the presets, greys out the ones the bone cannot take and says why;
//   - Two-bone IK waits for a target, Esc cancels, ＋ New control makes the control and the IK at the
//     next free order, as one undo step;
//   - Orient picks its target by a click on the stage; the bone itself is refused and the pick waits;
//   - in Setup a row drags to another place: the runtime runs the new order and 💾 Save posts it; in
//     Animate rows do not drag;
//   - grabbing the gizmo on a bone the IK solves says so in the hint;
//   - Spline IK makes controls and a weighted path the path editor does not offer to drag.
// What it does NOT cover: the poses (`rig-presets.mjs` plays the same functions through engine-rig).
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { launchChrome } from './chrome.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const SYMBOLS3 = fileURLToPath(new URL('apps/lines/static/assets/spines/symbols3/', ROOT));
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');
const shotAt = process.argv.includes('--shot')
	? process.argv[process.argv.indexOf('--shot') + 1]
	: null;

const w = JSON.parse(readFileSync(join(SYMBOLS3, 'W.json'), 'utf8'));
const LEAF = 'exp_spark1';
const tail = {
	skeleton: { spine: '4.2.0' },
	bones: [
		{ name: 'root' },
		{ name: 'body', parent: 'root', y: 100 },
		{ name: 'head', parent: 'body', y: 120, length: 30 },
		{ name: 'tail1', parent: 'body', x: -20, rotation: 200, length: 30 },
		{ name: 'tail2', parent: 'tail1', x: 30, rotation: 20, length: 30 },
		{ name: 'tail3', parent: 'tail2', x: 30, rotation: 25, length: 25 },
		{ name: 'tail4', parent: 'tail3', x: 25, rotation: 15, length: 20 },
	],
	slots: [],
	skins: [{ name: 'default', attachments: {} }],
	animations: { idle: { bones: { body: { rotate: [{ time: 0 }, { time: 1, value: 5 }] } } } },
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const RIGS = { W: w, Tail: tail };
const ENTRIES = Object.keys(RIGS).map((name, id) => ({
	id,
	name,
	folder: name,
	dir_b64: b64(name),
	skeleton_file: `${name}.json`,
	atlas_file: 'symbols3.atlas',
	format: 'json',
	runtime: '4.2',
	version: '4.2',
	pma: false,
}));
const posted = [];
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.json': 'application/json',
	'.atlas': 'text/plain',
	'.svg': 'image/svg+xml',
};
const readBody = (req) =>
	new Promise((r) => {
		let s = '';
		req.on('data', (c) => (s += c));
		req.on('end', () => r(s));
	});
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const jsonOut = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/rig-viewer/skeletons')
			return jsonOut({ client: 'c', project: 'p', root: 'c/p/spines', skeletons: ENTRIES });
		if (p === '/rig-viewer/file') {
			const name = url.searchParams.get('name') ?? '';
			const rig = Object.keys(RIGS).find((n) => b64(n) === url.searchParams.get('dir'));
			if (rig && name === `${rig}.json`) return jsonOut(RIGS[rig]);
			if (rig && /^symbols3\.(atlas|png|webp)$/.test(name) && existsSync(join(SYMBOLS3, name)))
				return send(200, MIME[extname(name)], readFileSync(join(SYMBOLS3, name)));
			return send(404, 'text/plain', 'no such bundle file: ' + name);
		}
		if (p === '/api/rigger/save' && req.method === 'GET')
			return jsonOut({ ok: true, projectKey: 'p', etag: null });
		if (p === '/api/rigger/save') {
			posted.push(JSON.parse(await readBody(req)));
			return jsonOut({ ok: true, saved: true, key: 'x', etag: `etag-${posted.length}`, count: 2 });
		}
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/'))
			return jsonOut({
				effects: [],
				atlases: [],
				rigs: [],
				animations: [],
				clips: [],
				backups: [],
			});
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file))
			return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e));
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const browser = await launchChrome({
	name: 'rig-constraints',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
});
const { evaluate, waitFor, send, pageLog } = browser;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) pass++;
	else fail++;
	console.log(
		`  ${cond ? '✓' : '✗'} ${name}${!cond && detail !== undefined ? ` — ${detail}` : ''}`,
	);
	return cond;
};
async function step(title, fn) {
	console.log(`\n${title}`);
	try {
		await fn();
	} catch (e) {
		fail++;
		console.log(`  ✗ the harness threw — ${e.message}`);
	}
}
const q = JSON.stringify;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () =>
	waitFor('!document.getElementById("loadingOverlay").classList.contains("on")', 30000);
async function openRig(name) {
	const found = await evaluate(`(() => {
		document.getElementById("loadRigBtn").click();
		const row = [...document.querySelectorAll("#list .item")].find((d) => d.querySelector(".nm").textContent === ${q(name)});
		if (row) row.click();
		return !!row;
	})()`);
	await settle();
	return found;
}
const setMode = (m) =>
	evaluate(`document.querySelector('#modeSeg button[data-mode="${m}"]').click(); mode`);
const selectBoneNamed = (n) =>
	evaluate(`selectBone(skeletonData.bones.findIndex((b) => b.name === ${q(n)})); true`);
const rows = () =>
	evaluate(
		'JSON.stringify([...document.querySelectorAll("#consList .trow")].map((r) => r.dataset.cons))',
	);
const runOrder = () =>
	evaluate(`JSON.stringify((() => {
		const kind = new Map();
		for (const [k, l] of [["ik", skeleton.ikConstraints], ["transform", skeleton.transformConstraints], ["path", skeleton.pathConstraints], ["physics", skeleton.physicsConstraints]])
			for (const c of l) kind.set(c, k + " " + c.data.name);
		return skeleton._updateCache.filter((u) => kind.has(u)).map((u) => kind.get(u));
	})())`);
const menuItems = () =>
	evaluate(
		'JSON.stringify([...document.querySelectorAll("#curveMenu button")].map((b) => [b.firstChild.textContent, b.disabled, b.title]))',
	);
const clickMenu = (label) =>
	evaluate(
		`(() => { const b = [...document.querySelectorAll("#curveMenu button")].find((x) => x.firstChild.textContent === ${q(label)}); if (!b) return false; b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); return true; })()`,
	);
const hint = () => evaluate('document.getElementById("hint").textContent');
/** Page coordinates of a bone's origin (or of a point `dx` CSS px to its right). */
const screenOf = (n, dx = 0) =>
	evaluate(`(() => {
		const b = skeleton.findBone(${q(n)}), cv = document.getElementById("cv"), dpr = window.devicePixelRatio || 1;
		const v = new RIG.Vector3(b.worldX, b.worldY, 0);
		renderer.camera.worldToScreen(v, cv.width, cv.height);
		const r = cv.getBoundingClientRect();
		return { x: Math.round(r.left + v.x / dpr + ${dx}), y: Math.round(r.top + cv.clientHeight - v.y / dpr) };
	})()`);
async function click(pt) {
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
	await send('Input.dispatchMouseEvent', {
		type: 'mousePressed',
		x: pt.x,
		y: pt.y,
		button: 'left',
		clickCount: 1,
	});
	await send('Input.dispatchMouseEvent', {
		type: 'mouseReleased',
		x: pt.x,
		y: pt.y,
		button: 'left',
		clickCount: 1,
	});
}
/** Lines the stage draws in one frame, by colour: { "r,g,b": count }. */
const linesByColour = () =>
	evaluate(`new Promise((done) => {
		const seen = {}, line = renderer.line;
		renderer.line = function (x1, y1, x2, y2, c){ const k = [c.r, c.g, c.b].map((v) => v.toFixed(2)).join(","); seen[k] = (seen[k] || 0) + 1; return line.apply(this, arguments); };
		requestAnimationFrame(() => requestAnimationFrame(() => { renderer.line = line; done(JSON.stringify(seen)); }));
	})`);
const colourKey = (rgb) => rgb.map((v) => v.toFixed(2)).join(',');

try {
	await step('1. open W in Setup: the Constraints list in solve order', async () => {
		await waitFor('typeof skeletons !== "undefined" && skeletons.length === 2');
		await evaluate(
			'window.confirm = () => true; window.alert = () => {}; window.prompt = () => "x"; true',
		);
		// the boot splash can still be up in a headless window, over the stage the clicks below aim at
		await evaluate('document.querySelectorAll(".iw-crt").forEach((e) => e.remove()); true');
		ok('W opens', await openRig('W'));
		await setMode('setup');
		ok(
			'the rows are the order engine-rig runs, numbered from 1',
			(await rows()) === (await runOrder()) &&
				(await evaluate(
					'[...document.querySelectorAll("#consList .trow .num")].map((n) => n.textContent).join()',
				)) === '1,2',
			`${await rows()} vs ${await runOrder()}`,
		);
		ok(
			'in Setup each row drags; the section says what it is in its header tooltip',
			(await evaluate(
				'[...document.querySelectorAll("#consList .trow")].every((r) => r.draggable)',
			)) &&
				/solve order/.test(
					await evaluate('document.querySelector("#secConstraints > summary").title'),
				),
		);
	});

	await step('2. the stage draws W’s constraints', async () => {
		const seen = JSON.parse(await linesByColour());
		const tc = seen[colourKey([0.72, 0.52, 1])] || 0;
		const path = seen[colourKey([0.25, 0.85, 0.8])] || 0;
		ok(
			'transform links and its tinted bone in violet, the path’s curve in teal',
			tc >= 3 && path >= 12,
			JSON.stringify(seen),
		);
		await evaluate('document.getElementById("bonesBtn").click(); true');
		const off = JSON.parse(await linesByColour());
		ok(
			'with Bones off, none of it is drawn',
			!off[colourKey([0.72, 0.52, 1])],
			JSON.stringify(off),
		);
		await evaluate('document.getElementById("bonesBtn").click(); true');
	});

	await step('3. ＋ Add constraint lists the presets', async () => {
		await selectBoneNamed('root');
		await evaluate('document.getElementById("consAdd").click(); true');
		const items = JSON.parse(await menuItems());
		const byLabel = Object.fromEntries(items.map(([l, d, t]) => [l.replace(/ …$/, ''), { d, t }]));
		ok(
			'every preset of §4.4 is there',
			[
				'Two-bone IK',
				'Aim / look at',
				'Spline IK',
				'Orient',
				'Copy location',
				'Copy scale',
				'Child of',
				'Look (eyes)',
				'Jiggle',
				'Path',
				'IK',
				'Transform',
			].every((l) => byLabel[l]),
			items.map((i) => i[0]).join(', '),
		);
		ok(
			'on the root, Two-bone IK and Aim are greyed out and say why',
			byLabel['Two-bone IK'].d &&
				byLabel['Aim / look at'].d &&
				/root/.test(byLabel['Aim / look at'].t) &&
				!byLabel.Orient.d,
		);
		await evaluate('closeCurveMenu(); true');
	});

	await step('4. Two-bone IK: Esc cancels, ＋ New control makes it', async () => {
		await selectBoneNamed(LEAF);
		const bones0 = await evaluate('rawDoc.bones.length');
		await evaluate('document.getElementById("consAdd").click(); true');
		await clickMenu('Two-bone IK …');
		ok(
			'it waits for a target: the strip and the hint say so',
			/🎯/.test(await evaluate('document.getElementById("consTools").textContent')) &&
				/click the target bone/.test(await hint()),
		);
		await send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			key: 'Escape',
			code: 'Escape',
			windowsVirtualKeyCode: 27,
		});
		await send('Input.dispatchKeyEvent', {
			type: 'keyUp',
			key: 'Escape',
			code: 'Escape',
			windowsVirtualKeyCode: 27,
		});
		ok(
			'Esc cancels: nothing added',
			!(await evaluate('constraintPick')) && (await evaluate('(rawDoc.ik || []).length')) === 0,
		);
		await evaluate('document.getElementById("consAdd").click(); true');
		await clickMenu('Two-bone IK …');
		await evaluate(
			'[...document.querySelectorAll("#consTools button")].find((b) => b.textContent.includes("New control")).click(); true',
		);
		const ik = JSON.parse(await evaluate('JSON.stringify(rawDoc.ik)'));
		ok(
			'＋ New control: a control bone and the IK at the next free order (2), selected',
			ik.length === 1 &&
				ik[0].order === 2 &&
				ik[0].target === `${LEAF}_ik` &&
				(await evaluate('rawDoc.bones.length')) === bones0 + 1 &&
				(await evaluate('selIk')) === `${LEAF}_ik`,
			JSON.stringify(ik),
		);
		ok(
			'the list shows it third, and the runtime runs it third',
			(await rows()) === (await runOrder()) && JSON.parse(await rows())[2] === `ik ${LEAF}_ik`,
		);
		ok(
			'its panel header has ✎ and 🗑 icon buttons',
			(await evaluate(
				'[...document.querySelectorAll("#consDetail .chead button")].map((b) => b.getAttribute("aria-label")).join()',
			)) === 'Rename,Delete',
		);
		await wait(50);
		await evaluate('document.getElementById("undoBtn").click(); true');
		ok(
			'↶ takes back the control and the IK together',
			(await evaluate('(rawDoc.ik || []).length')) === 0 &&
				(await evaluate('rawDoc.bones.length')) === bones0,
		);
		await evaluate('document.getElementById("redoBtn").click(); true');
	});

	await step('5. grabbing the gizmo on a bone the IK solves', async () => {
		const parent = await evaluate(`rawDoc.bones.find((b) => b.name === ${q(LEAF)}).parent`);
		await selectBoneNamed(parent);
		await evaluate('document.getElementById("hint").textContent = ""; true');
		const ring = await evaluate('58 / (window.devicePixelRatio || 1)');
		const at = await screenOf(parent, ring);
		await click(at);
		ok(
			'the hint says the IK solves its rotation and what to do',
			/IK ".*_ik" \(mix 1\) solves this bone's rotation .* move its target/.test(await hint()),
			`${await hint()} · under the click: ${await evaluate(`(document.elementFromPoint(${at.x}, ${at.y}) || {}).tagName`)}`,
		);
	});

	await step('6. Orient: the target is clicked on the stage', async () => {
		await selectBoneNamed(LEAF);
		await evaluate('document.getElementById("consAdd").click(); true');
		await clickMenu('Orient …');
		await evaluate(`finishConstraintPick(${q(LEAF)}); true`);
		ok(
			'the bone itself is refused as its own target and the pick waits',
			/moves with/.test(await hint()) && !!(await evaluate('constraintPick')),
			await hint(),
		);
		const target = await evaluate(`(() => {
			const banned = new Set([${q(LEAF)}, ...descendantNames(${q(LEAF)})]);
			const cv = document.getElementById("cv"), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
			for (const b of skeleton.bones){
				if (banned.has(b.data.name) || !b.parent) continue;
				const v = new RIG.Vector3(b.worldX, b.worldY, 0); renderer.camera.worldToScreen(v, cv.width, cv.height);
				// a bone whose origin no other bone's handle is near: a click a pixel off still picks it
				const x = Math.round(r.left + v.x / dpr), y = Math.round(r.top + cv.clientHeight - v.y / dpr), i = skeleton.bones.indexOf(b);
				const near = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => nearestBone({ clientX: x + dx, clientY: y + dy }) === i);
				if (x > r.left + 10 && x < r.right - 10 && y > r.top + 10 && y < r.bottom - 10 && near) return b.data.name;
			}
			return null;
		})()`);
		await click(await screenOf(target));
		const tc = JSON.parse(
			await evaluate(
				`JSON.stringify(rawDoc.transform.find((c) => c.name === ${q(`${LEAF}_orient`)}) || null)`,
			),
		);
		ok(
			`clicking "${target}" makes the orient: rotate only, reaching it`,
			!!tc &&
				tc.target === target &&
				tc.mixRotate === 1 &&
				tc.mixX === 0 &&
				!(await evaluate('constraintPick')),
			JSON.stringify(tc),
		);
	});

	await step('7. drag a row to another place', async () => {
		const before = JSON.parse(await rows());
		const drag = (from, to, below) =>
			evaluate(`(() => {
				const rows = [...document.querySelectorAll("#consList .trow")], src = rows[${from}], dst = rows[${to}], dt = new DataTransfer();
				const fire = (el, type) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: ${below} ? r.bottom - 2 : r.top + 2 })); };
				fire(src, "dragstart"); fire(dst, "dragover"); fire(dst, "drop"); fire(src, "dragend");
				return true;
			})()`);
		await drag(before.length - 1, 0, false);
		const after = JSON.parse(await rows());
		const want = [before.at(-1), ...before.slice(0, -1)];
		ok(
			'the last row dropped above the first runs first; the runtime runs the list as shown',
			q(after) === q(want) && (await rows()) === (await runOrder()),
			`${q(after)} vs ${q(want)}`,
		);
		await drag(0, 1, true);
		ok(
			'…and dropped below the second, it runs second',
			q(JSON.parse(await rows())) === q([want[1], want[0], ...want.slice(2)]),
		);
		const n = posted.length;
		await evaluate('document.getElementById("saveBtn").click(); true');
		await waitFor(`${n} < 0 || document.getElementById("err").textContent !== "" || true`);
		await wait(600);
		const sent = posted.at(-1)?.skeleton;
		const orders =
			sent &&
			['ik', 'transform', 'path', 'physics'].flatMap((k) =>
				(sent[k] || []).map((c) => [`${k} ${c.name}`, c.order]),
			);
		ok(
			'💾 Save posts the new order, orders 0..count−1',
			posted.length === n + 1 &&
				orders
					.map(([, o]) => o)
					.sort()
					.join() === [...orders.keys()].join(),
			q(orders),
		);
		await setMode('animate');
		ok(
			'in Animate the rows do not drag',
			await evaluate(
				'[...document.querySelectorAll("#consList .trow")].every((r) => !r.draggable)',
			),
		);
		await setMode('setup');
	});

	await step('8. Spline IK on a tail', async () => {
		await selectBoneNamed(LEAF);
		await evaluate('document.getElementById("consAdd").click(); true');
		await clickMenu('Orient …');
		ok(
			'opening another rig while W waits for a target drops the pick',
			(await openRig('Tail')) &&
				(await evaluate('constraintPick === null && !!document.getElementById("consAdd")')),
		);
		await setMode('setup');
		await selectBoneNamed('tail1');
		await evaluate('document.getElementById("consAdd").click(); true');
		await clickMenu('Spline IK');
		const path = JSON.parse(await evaluate('JSON.stringify(rawDoc.path || [])'));
		const ctl = await evaluate(
			'rawDoc.bones.filter((b) => b.name.startsWith("tail1_spline")).length',
		);
		ok(
			'a path constraint on the 4 tail bones in chain mode, 3 controls',
			path.length === 1 &&
				path[0].bones.join() === 'tail1,tail2,tail3,tail4' &&
				path[0].rotateMode === 'chain' &&
				ctl === 3,
			q(path),
		);
		await evaluate(`selectSlot(${q(path[0]?.target)}); true`);
		ok(
			'its slot shows the path as bound to the controls, with no points to drag',
			/bound to 3 bones/.test(
				await evaluate('document.getElementById("slotDetail").textContent'),
			) && (await evaluate('pathCtx')) === null,
			await evaluate('document.getElementById("slotDetail").textContent'),
		);
		const seen = JSON.parse(await linesByColour());
		ok(
			'the stage draws the spline in teal',
			(seen[colourKey([0.25, 0.85, 0.8])] || 0) >= 12,
			q(seen),
		);
		if (shotAt) {
			// the tail with its Spline IK, plus a two-bone IK on a new control, its panel open
			await selectBoneNamed('tail3');
			await evaluate(`(() => {
				addConstraintPreset("aim", null);
				document.getElementById("secBones").open = false;
				const s = document.getElementById("secConstraints");
				s.open = true; s.scrollIntoView();
				const t = skeleton.findBone("tail2"), cam = renderer.camera;
				cam.position.x = t.worldX; cam.position.y = t.worldY; cam.zoom = 0.18;
				return true;
			})()`);
			await wait(300);
			const { data } = await send('Page.captureScreenshot', { format: 'png' });
			writeFileSync(shotAt, Buffer.from(data, 'base64'));
		}
	});

	await step('9. the easing menu, now the shared floating menu, still eases a key', async () => {
		await openRig('W');
		await setMode('animate');
		const before = await evaluate('JSON.stringify(rawDoc.animations)');
		const opened = await evaluate(`(() => {
			const dots = [...document.querySelectorAll("#timeline .tl-key")].filter((d) => d.dataset.tid.startsWith("bone:"));
			const dot = dots.find((d) => { const tr = dopeTrackById[d.dataset.tid]; return tr && trackKeyEasable(tr, parseFloat(d.dataset.t)) && trackKeyTimes(tr).at(-1) > parseFloat(d.dataset.t); });
			if (!dot) return null;
			const r = dot.getBoundingClientRect();
			dot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + 2 }));
			return [...document.querySelectorAll("#curveMenu button")].map((b) => b.textContent).join("|");
		})()`);
		ok(
			'right-clicking a key lists the five easings',
			opened && /^(✓ )?Linear\|(✓ )?Stepped\|(✓ )?Ease In\|(✓ )?Ease Out\|(✓ )?Ease In-Out$/.test(opened),
			opened,
		);
		await clickMenu('Ease In');
		ok(
			'choosing Ease In changes the clip and closes the menu',
			(await evaluate('JSON.stringify(rawDoc.animations)')) !== before &&
				(await evaluate('!document.getElementById("curveMenu")')),
		);
	});

	await step('10. the page threw nothing', async () => {
		const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
		ok('no uncaught exception', thrown.length === 0, thrown.join(' | '));
	});
} finally {
	if (fail && pageLog.length)
		console.log('\npage console:\n  ' + pageLog.slice(0, 25).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
