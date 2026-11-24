// Browser gate for 🗺 From my sheet (docs/design/frame-to-rig.md §13), on the SHIPPED view.html and
// vendor/rigger-motion.js in a real Chromium against a fake launcher API. The sheet is `sheet-rig.mjs`'s
// committed one (fixtures/sheet-rig/: the F2 fixture's parts turned, scaled and oddly named); the fake
// answers as the routes do with the shipped code: `/api/rigger/new` reads the mapping
// (`parseSheetMapping`), fits it (`sheetRig`) and makes the rig with `templateRig`, which the page
// then opens; `/api/rigger/from-sheet` answers the mapping it kept. The tracker is the page's own
// bundle, its face landmarker answered with the fixture's face (no model runs here). Checked:
//  - ＋ New rig → Half body, the sheet, 🗺 From my sheet: the dialog opens on that sheet, every region
//    a thumbnail; each body part's region is the one its name says, the decoys none, the four worn
//    things props on their parts; each part's joints are the bundle's guess from its drawing as the
//    page draws it;
//  - the head: the face found on it, the head's joints from the face, its row says so;
//  - a joint dragged on the stage moves by the drag (the row then says placed by hand); ⇅ swaps a
//    limb's ends, ⟲ guesses them again; a part given another region is guessed on that one;
//  - ＋ wears a region as a prop on the part picked, 🗑 takes it off, and a prop dragged on its part
//    moves where it sits;
//  - 🦴 Create rig sends ＋ New rig's create with the mapping as `sheet`: the template, the sheet, every
//    part's region and joints (the dragged one as dragged), the head's face, the props; the rig opens
//    with every mapped part drawn from its own region (`path`), the report says what was made;
//  - with that rig open, 🗺 opens its kept mapping again;
//  - the page threw nothing.
//   node tools/rigger-spike/sheet-rig-browser.mjs [--png <dir>] [--mutants]
//   S2R_HTML=<file> serves that page instead of view.html; --mutants runs each page mutant that way.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const VIEW = join(STATIC, 'rigger/view.html');
const SELF = fileURLToPath(import.meta.url);

/** Page mutants: each must turn this gate red. */
const PAGE_MUTANTS = [
	[
		'the suggestion not taken',
		'if (kept) s2rKeep(kept);\n    else s2rSuggest();',
		'if (kept) s2rKeep(kept);',
	],
	['a dragged joint not kept', 'dr.m.joints[dr.joint] = moved;', 'void moved;'],
	['the face not sent', '...(m.face ? { face: m.face } : {}) };\n  return {', '};\n  return {'],
	['the props not sent', 'props: s2r.props.map(', 'props: [].map('],
	[
		'a region not drawn where the rig draws it',
		'const dx = r.offX || 0, dy = r.origH ? r.origH - (r.offY || 0) - r.h : 0;',
		'const dx = 4, dy = 4;',
	],
	['the kept mapping not opened', 'if (r.ok) kept = (await r.json()).sheet;', 'void r;'],
];
if (process.argv.includes('--mutants')) {
	const tmp = mkdtempSync(join(tmpdir(), 'sheet-rig-browser-'));
	const src = readFileSync(VIEW, 'utf8');
	let bad = 0;
	for (const [what, from, to] of PAGE_MUTANTS) {
		if (!src.includes(from)) {
			console.log(`  ✗ mutant not planted: ${what}`);
			bad++;
			continue;
		}
		const file = join(tmp, 'view.html');
		writeFileSync(file, src.replace(from, to));
		const run = spawnSync(process.execPath, [SELF], {
			env: { ...process.env, S2R_HTML: file },
			encoding: 'utf8',
		});
		const red = run.status !== 0;
		if (!red) bad++;
		console.log(`  ${red ? 'red  ' : 'GREEN'} ${what}`);
	}
	console.log(
		`\n${bad === 0 ? '✅ PASS' : '✗ FAIL'} — ${PAGE_MUTANTS.length - bad}/${PAGE_MUTANTS.length} page mutants caught`,
	);
	process.exit(bad === 0 ? 0 : 1);
}
const html = readFileSync(process.env.S2R_HTML || VIEW, 'utf8');

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'sheet-rig-browser-')), 'server.mjs');
await esbuild.build({
	stdin: {
		contents: [
			"export * from './server/rigTemplates.ts';",
			"export * from './server/rigTemplateFit.ts';",
			"export * from './server/rigSheetFit.ts';",
			"export * from './rigSheetMap.ts';",
		].join('\n'),
		resolveDir: join(APP, 'src/lib'),
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
	plugins: [
		{
			name: 'env',
			setup(b) {
				b.onResolve({ filter: /^\$env\/dynamic\/private$/ }, () => ({
					path: 'env',
					namespace: 's',
				}));
				b.onLoad({ filter: /.*/, namespace: 's' }, () => ({
					contents: 'export const env = {};',
					loader: 'js',
				}));
			},
		},
	],
});
const S = await import(pathToFileURL(out).href);

const read = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
const PACKED = read('sheet.json');
const TRUTH = read('truth.json');
const SHEET_PNG = readFileSync(join(FIX, 'sheet.png'));
const MANIFEST = 'c/p/manifests/atlas_manifest_Sheet.json';
const PAGE_KEY = 'c/p/sheets/Sheet.png';
const PAGE = 'Sheet.png';
/**
 * `HandL` trimmed as TexturePacker trims (its offY from the top of its untrimmed box): the page draws
 * its ink where the rig's `.atlas` puts it, offY read from the bottom, so its true joints move there.
 */
const TRIM = { region: 'HandL', offX: 10, offY: 5, padW: 30, padH: 20 };
const SHEET = {
	...PACKED,
	regions: PACKED.regions.map((r) =>
		r.name === TRIM.region
			? { ...r, offX: TRIM.offX, offY: TRIM.offY, origW: r.w + TRIM.padW, origH: r.h + TRIM.padH }
			: r,
	),
};
const trimmedRegion = SHEET.regions.find((r) => r.name === TRIM.region);
const INK = [TRIM.offX, trimmedRegion.origH - TRIM.offY - trimmedRegion.h];
for (const t of Object.values(TRUTH.parts))
	if (t.region === TRIM.region)
		for (const [j, p] of Object.entries(t.joints)) t.joints[j] = [p[0] + INK[0], p[1] + INK[1]];
const REGIONS = SHEET.regions.map(({ name, w, h, origW, origH }) => ({ name, w, h, origW, origH }));
/** The `.atlas` ＋ New rig writes (`regionsToRigAtlas`): the trim as the manifest gives it. */
const atlasOf = () =>
	[
		PAGE,
		`size:${SHEET.width},${SHEET.height}`,
		'filter:Linear,Linear',
		...SHEET.regions.flatMap((r) => [
			r.name,
			`bounds:${r.x},${r.y},${r.w},${r.h}`,
			...(r.origW ? [`offsets:${r.offX},${r.offY},${r.origW},${r.origH}`] : []),
		]),
	].join('\n') + '\n';
const seen = { creates: [], kept: null };
let made = null;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.wasm': 'application/wasm',
};
const readBody = (req) =>
	new Promise((r) => {
		const parts = [];
		req.on('data', (c) => parts.push(c));
		req.on('end', () => r(JSON.parse(Buffer.concat(parts).toString() || '{}')));
	});
const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const p = url.pathname;
	const send = (code, type, body) => {
		res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
		res.end(body);
	};
	const json = (v, code = 200) => send(code, MIME['.json'], JSON.stringify(v));
	try {
		if (p === '/') return send(200, MIME['.html'], html);
		if (p === '/api/rigger/templates') return json({ templates: S.rigTemplateList() });
		if (p === '/api/rigger/atlases')
			return json({
				atlases: [{ manifestKey: MANIFEST, label: 'Sheet', regions: REGIONS.map((r) => r.name) }],
			});
		if (p === '/api/editor/regions' && url.searchParams.get('sheet') === MANIFEST)
			return json({
				assetKey: MANIFEST,
				pageKey: PAGE_KEY,
				pageVersion: 'v1',
				pageWidth: SHEET.width,
				pageHeight: SHEET.height,
				regions: SHEET.regions,
			});
		if (p === '/api/editor/asset' && url.searchParams.get('key') === PAGE_KEY)
			return send(200, 'image/png', SHEET_PNG);
		if (p === '/api/rigger/from-sheet') return json({ sheet: made ? seen.kept : null });
		if (p === '/api/rigger/new') {
			const body = await readBody(req);
			seen.creates.push(body);
			if (body.manifestKey !== MANIFEST || body.sheet?.manifestKey !== MANIFEST)
				return json({ message: 'the sheet mapping is of another atlas than the one picked' }, 400);
			const parsed = S.parseSheetMapping(body.sheet);
			if ('problem' in parsed)
				return json({ message: `bad sheet mapping: ${parsed.problem}` }, 400);
			const fitted = S.sheetRig(S.HALF_BODY, REGIONS, parsed.mapping);
			if (!fitted.ok) return json({ message: fitted.problem }, 400);
			made = {
				name: body.name,
				rig: S.templateRig(S.HALF_BODY, REGIONS, fitted.value.fit, fitted.value.art),
				fit: fitted.value.fit,
			};
			seen.kept = parsed.mapping;
			return json({
				ok: true,
				dir: Buffer.from(body.name).toString('base64url'),
				stem: body.name,
				atlas_file: `${body.name}.atlas`,
				regions: REGIONS.length,
				template: S.templateReport(made.rig),
				sheet: { scale: fitted.value.scale, face: fitted.value.face },
			});
		}
		if (p === '/rig-viewer/skeletons')
			return json({
				client: 'c',
				project: 'p',
				root: 'c/p/spines',
				skeletons: made
					? [
							{
								id: 0,
								name: made.name,
								folder: made.name,
								dir_b64: Buffer.from(made.name).toString('base64url'),
								skeleton_file: `${made.name}.irig`,
								atlas_file: `${made.name}.atlas`,
								format: 'json',
								runtime: '4.2',
								version: '4.2',
								pma: false,
							},
						]
					: [],
			});
		if (p === '/rig-viewer/file' && made) {
			const name = url.searchParams.get('name');
			if (name === `${made.name}.irig`) return json(made.rig.skeleton);
			if (name === `${made.name}.atlas`) return send(200, 'text/plain', atlasOf());
			if (name === PAGE) return send(200, 'image/png', SHEET_PNG);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template')
			return json({
				template: S.rigTemplateFromSidecar(
					JSON.stringify({ id: 'half-body', version: S.HALF_BODY.version, fit: made?.fit }),
				),
			});
		if (p === '/api/rigger/save' && req.method === 'GET')
			return json({ ok: true, projectKey: 'p', etag: null });
		if (p === '/api/rigger/text' && req.method === 'GET') return send(404, 'text/plain', 'none');
		if (p.startsWith('/api/'))
			return json({ effects: [], atlases: [], rigs: [], animations: [], clips: [], backups: [] });
		const file = join(STATIC, p.replace(/^\//, ''));
		if (file.startsWith(STATIC) && existsSync(file))
			return send(200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
		return send(404, 'text/plain', 'not found');
	} catch (e) {
		send(500, 'text/plain', String(e && e.stack));
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await launchChrome({
	name: 'sheet-rig',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000', '--mute-audio'],
});
const { evaluate, waitFor, send, pageLog } = browser;
const PNG = process.argv.includes('--png') ? process.argv[process.argv.indexOf('--png') + 1] : null;
async function shot(name) {
	if (!PNG) return;
	const { data } = await send('Page.captureScreenshot', { format: 'png' });
	writeFileSync(join(PNG, name), Buffer.from(data, 'base64'));
}

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
const q = JSON.stringify;
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

try {
	await waitFor('typeof rawDoc !== "undefined" && document.getElementById("newRigBtn")', 30000);
	// The face the tracker finds on the head: the fixture's, in the picture's 0…1 (no model runs here).
	const head = TRUTH.parts.head;
	const headRegion = SHEET.regions.find((r) => r.name === head.region);
	const face = head.face.map(([x, y]) => [x / headRegion.w, y / headRegion.h]);
	await evaluate(`(() => {
		window.__alerts = []; window.__tracked = [];
		window.alert = (m) => window.__alerts.push(String(m));
		window.confirm = () => true;
		document.getElementById("newRigBtn").click();
		return true;
	})()`);
	await waitFor(
		`!!document.querySelector('#newRigApply option[value="template:half-body"]') && !!document.querySelector('#newRigAtlas option[value=${q(MANIFEST)}]')`,
		15000,
	);
	await evaluate(`(async () => {
		document.getElementById("newRigApply").value = "template:half-body";
		document.getElementById("newRigAtlas").value = ${q(MANIFEST)};
		document.getElementById("newRigName").value = "Sheety";
		await ensureRiggerMotion();
		window.RiggerMotion.track = async (kinds, src) => {
			window.__tracked.push({ kinds, w: src.width, h: src.height });
			return { width: src.width, height: src.height, frames: [{ t: 0, face: { landmarks: ${q(face)}, blend: {} } }] };
		};
		document.getElementById("newRigFromSheet").click();
		return true;
	})()`);
	await waitFor(
		'document.getElementById("s2rModal").classList.contains("open") && !!s2r.sheet && s2r.faces.head === "found"',
		20000,
	);
	const opened = await evaluate(`({
		sheet: document.getElementById("s2rSheet").value,
		thumbs: document.querySelectorAll("#s2rRegions .f2rThumb").length,
		name: document.getElementById("s2rName").value,
		map: Object.fromEntries(Object.entries(s2r.map).map(([p, m]) => [p, m.region])),
		props: s2r.props.map((p) => [p.region, p.host, p.bone]),
		rows: Object.fromEntries([...document.querySelectorAll("#s2rParts .s2rRow")].map((r) => [r.dataset.part, r.querySelector("select").value])),
		create: !document.getElementById("s2rCreate").disabled,
		tracked: window.__tracked,
	})`);
	const want = Object.fromEntries(Object.entries(TRUTH.parts).map(([p, t]) => [p, t.region]));
	ok(
		'the dialog opens on the sheet picked, every region a thumbnail, the rig name taken',
		opened.sheet === MANIFEST && opened.thumbs === SHEET.regions.length && opened.name === 'Sheety',
		q(opened),
	);
	ok(
		'each body part is the region its name says, nothing else is mapped',
		Object.entries(want).every(([p, r]) => opened.map[p] === r) &&
			Object.keys(opened.map).length === Object.keys(want).length,
		q(opened.map),
	);
	ok(
		'the table shows each mapping',
		Object.entries(want).every(([p, r]) => opened.rows[p] === r),
		q(opened.rows),
	);
	const props = Object.fromEntries(opened.props.map(([r, h]) => [r, h]));
	ok(
		'the four worn things are props on their parts',
		TRUTH.props.every((p) => props[p.region] === p.host) &&
			opened.props.length === TRUTH.props.length,
		q(opened.props),
	);
	ok('🦴 Create rig is enabled', opened.create);
	ok(
		'the head is looked at for a face, once',
		opened.tracked.length === 1 && opened.tracked[0].kinds === 'face',
		q(opened.tracked),
	);

	// Each part's joints: the bundle's guess on the drawing as the page draws it, the head's from its face.
	const guessed = await evaluate(`(() => {
		const out = {};
		for (const [part, m] of Object.entries(s2r.map)) out[part] = m.joints;
		return out;
	})()`);
	const truthGuess = (await import(pathToFileURL(out).href)).faceJoints(head.face);
	let worst = 0;
	for (const [part, t] of Object.entries(TRUTH.parts)) {
		if (part === 'head') continue;
		const r = SHEET.regions.find((x) => x.name === t.region);
		for (const [j, p] of Object.entries(t.joints))
			worst = Math.max(worst, d2(guessed[part][j], p) / Math.max(r.w, r.h));
	}
	const ink = await evaluate(`(() => {
		const r = ${q(trimmedRegion)}, c = s2rCanvas(r.name);
		const want = document.createElement("canvas");
		want.width = r.origW; want.height = r.origH;
		want.getContext("2d").drawImage(s2r.sheet.page, r.x, r.y, r.w, r.h, ${INK[0]}, ${INK[1]}, r.w, r.h);
		const a = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
		const b = want.getContext("2d").getImageData(0, 0, r.origW, r.origH).data;
		let off = 0;
		for (let i = 3; i < b.length; i += 4) off = Math.max(off, Math.abs(a[i] - b[i]));
		return { size: [c.width, c.height], off };
	})()`);
	ok(
		'a trimmed region is drawn at its untrimmed size, its ink where the rig’s .atlas puts it',
		ink.size[0] === trimmedRegion.origW && ink.size[1] === trimmedRegion.origH && ink.off === 0,
		q(ink),
	);
	ok(
		'every joint guessed on the page lands within 0.12 of its drawing of the true one',
		worst <= 0.12,
		worst.toFixed(3),
	);
	ok(
		"the head's joints come from its face",
		d2(guessed.head.neck, truthGuess.neck) < 0.2 && d2(guessed.head.face, truthGuess.face) < 0.2,
		q([guessed.head, truthGuess]),
	);
	ok(
		'the head row says a face was found',
		(await evaluate(
			`document.querySelector('#s2rParts [data-part="head"] .s2rState').textContent`,
		)) === '🙂',
	);
	await shot('sheet-rig-dialog.png');

	// A joint dragged on the stage: the left upper arm's elbow, 30 stage pixels down.
	const dragged = await evaluate(`(() => {
		document.querySelector('#s2rParts [data-part="upper_arm_l"]').click();
		const m = s2r.map.upper_arm_l, c = s2rCanvas(m.region), b = s2rBox(c);
		const cv = document.getElementById("s2rStage"), rect = cv.getBoundingClientRect();
		const to = (x, y) => ({ bubbles: true, clientX: rect.left + x * rect.width / cv.width, clientY: rect.top + y * rect.height / cv.height });
		const [ex, ey] = m.joints.elbow, before = [ex, ey];
		const px = b.x + ex * b.k, py = b.y + ey * b.k;
		cv.dispatchEvent(new MouseEvent("mousedown", to(px, py)));
		window.dispatchEvent(new MouseEvent("mousemove", to(px, py + 15)));
		window.dispatchEvent(new MouseEvent("mousemove", to(px, py + 30)));
		window.dispatchEvent(new MouseEvent("mouseup", to(px, py + 30)));
		return { before, after: m.joints.elbow, k: b.k, placed: m.placed, state: document.querySelector('#s2rParts [data-part="upper_arm_l"] .s2rState').textContent };
	})()`);
	ok(
		'a joint dragged on the stage moves by the drag',
		Math.abs(dragged.after[0] - dragged.before[0]) < 0.11 &&
			Math.abs(dragged.after[1] - dragged.before[1] - 30 / dragged.k) < 0.11,
		q(dragged),
	);
	ok(
		'its row then says placed by hand',
		dragged.state === '✋' && dragged.placed.includes('elbow'),
		q(dragged),
	);

	// ⇅ and ⟲ on the left forearm; another region for it, then its own again.
	const tools = await evaluate(`(() => {
		document.querySelector('#s2rParts [data-part="lower_arm_l"]').click();
		const m = () => s2r.map.lower_arm_l;
		const before = JSON.parse(JSON.stringify(m().joints));
		document.getElementById("s2rSwap").click();
		const swapped = JSON.parse(JSON.stringify(m().joints));
		document.getElementById("s2rGuess").click();
		const again = JSON.parse(JSON.stringify(m().joints));
		const s = document.querySelector('#s2rParts [data-part="lower_arm_l"] select');
		s.value = "ArmR2"; s.dispatchEvent(new Event("change"));
		const other = { region: m().region, joints: JSON.parse(JSON.stringify(m().joints)) };
		const s2 = document.querySelector('#s2rParts [data-part="lower_arm_l"] select');
		s2.value = ${q(TRUTH.parts.lower_arm_l.region)}; s2.dispatchEvent(new Event("change"));
		return { before, swapped, again, other, back: m().joints };
	})()`);
	ok(
		'⇅ swaps a limb’s two ends',
		q(tools.swapped) === q({ elbow: tools.before.wrist, wrist: tools.before.elbow }),
		q(tools),
	);
	ok('⟲ guesses them again', q(tools.again) === q(tools.before), q(tools));
	ok(
		'another region is guessed on that one, and back again',
		tools.other.region === 'ArmR2' &&
			q(tools.other.joints) !== q(tools.before) &&
			q(tools.back) === q(tools.before),
		q(tools),
	);

	// ＋ wears a region as a prop on the part picked, 🗑 takes it off; the watch dragged on its forearm.
	const worn = await evaluate(`(() => {
		document.querySelector('#s2rParts [data-part="torso"]').click();
		const thumb = [...document.querySelectorAll("#s2rRegions .f2rThumb")].find((t) => t.querySelector("b").textContent === "bg_glow");
		thumb.querySelector("button").click();
		const added = s2r.props.find((p) => p.region === "bg_glow");
		const n = s2r.props.length;
		const row = [...document.querySelectorAll("#s2rProps .s2rRow")].find((r) => r.querySelector("input").value === added.name);
		row.querySelector('button[aria-label^="Remove"]').click();
		const i = s2r.props.findIndex((p) => p.region === "watch_R");
		document.querySelectorAll("#s2rProps .s2rRow")[i].click();
		const p = s2r.props[i], before = [...p.at];
		const b = s2rBox(s2rCanvas(s2r.map[p.host].region));
		const cv = document.getElementById("s2rStage"), rect = cv.getBoundingClientRect();
		const to = (x, y) => ({ bubbles: true, clientX: rect.left + x * rect.width / cv.width, clientY: rect.top + y * rect.height / cv.height });
		const px = b.x + p.at[0] * b.k, py = b.y + p.at[1] * b.k;
		cv.dispatchEvent(new MouseEvent("mousedown", to(px, py)));
		window.dispatchEvent(new MouseEvent("mousemove", to(px - 20, py)));
		window.dispatchEvent(new MouseEvent("mouseup", to(px - 20, py)));
		return { added: added && [added.host, added.bone, added.name], n, after: s2r.props.length, before, at: p.at, k: b.k };
	})()`);
	ok(
		'＋ wears a region as a prop on the part picked, on its drawing bone',
		q(worn.added) === q(['torso', 'torso_image', 'prop_bg_glow']) &&
			worn.n === TRUTH.props.length + 1,
		q(worn),
	);
	ok('🗑 takes it off', worn.after === TRUTH.props.length, q(worn));
	ok(
		'a prop dragged moves where it sits on its part',
		Math.abs(worn.before[0] - 20 / worn.k - worn.at[0]) < 0.11 &&
			Math.abs(worn.before[1] - worn.at[1]) < 0.11,
		q(worn),
	);

	// 🦴 Create rig.
	await evaluate('document.getElementById("s2rCreate").click(); true');
	await waitFor(
		'!!skeleton && !!rawDoc && !document.getElementById("s2rModal").classList.contains("open")',
		30000,
	);
	const create = seen.creates.at(-1);
	const sent = create?.sheet;
	ok(
		'🦴 Create rig sends ＋ New rig’s create with the mapping: template, sheet, regions, joints, face, props',
		create?.name === 'Sheety' &&
			create.templateId === 'half-body' &&
			create.manifestKey === MANIFEST &&
			sent?.template?.id === 'half-body' &&
			Object.entries(want).every(([p, r]) => sent.parts[p]?.region === r) &&
			Math.abs(sent.parts.upper_arm_l.joints.elbow[1] - dragged.after[1]) < 1e-9 &&
			sent.parts.head.face?.length === head.face.length &&
			sent.props.length === TRUTH.props.length &&
			Math.abs(sent.props.find((x) => x.region === 'watch_R').at[0] - worn.at[0]) < 0.06,
		q(
			create && {
				name: create.name,
				parts: Object.keys(sent?.parts ?? {}),
				props: sent?.props?.length,
			},
		),
	);
	const rig = await evaluate(`(() => {
		const sk = rawDoc.skins[0].attachments;
		return {
			parts: ${q(Object.keys(want))}.filter((p) => { const a = sk[p] && sk[p][p]; return a && a.type === "mesh"; }),
			paths: Object.fromEntries(${q(Object.keys(want))}.map((p) => [p, sk[p] && sk[p][p] && sk[p][p].path])),
			drawn: ${q(Object.keys(want))}.filter((p) => { const s = skeleton.findSlot(p); return !!(s && s.getAttachment()); }),
			props: ${q((sent?.props ?? []).map((p) => p.name))}.filter((n) => !!skeleton.findBone(n)),
		};
	})()`);
	ok(
		'the rig opens: every body part a mesh drawn from its own region, each prop on a bone of its own',
		rig.parts.length === Object.keys(want).length &&
			Object.entries(want).every(([p, r]) => rig.paths[p] === r) &&
			rig.drawn.length === Object.keys(want).length &&
			rig.props.length === TRUTH.props.length,
		q(rig),
	);
	const report = await evaluate('document.getElementById("alertMsg").textContent');
	ok(
		'the report says what was made, the face and what is not mapped',
		/Half body over the sheet Sheet/.test(report) &&
			/on their bones/.test(report) &&
			/face/i.test(report) &&
			/mouth_rest/.test(report),
		report,
	);
	await shot('sheet-rig-report.png');
	await evaluate('closeAlert(); true');

	// With that rig open, 🗺 opens its kept mapping.
	await evaluate(`(() => {
		s2r.dirty = false;
		document.getElementById("newRigBtn").click();
		return true;
	})()`);
	await waitFor(`!!document.querySelector('#newRigAtlas option[value=${q(MANIFEST)}]')`, 15000);
	await evaluate('document.getElementById("newRigFromSheet").click(); true');
	await waitFor(
		'document.getElementById("s2rModal").classList.contains("open") && !!s2r.sheet && s2r.from === "Sheety"',
		20000,
	);
	const reopened = await evaluate(
		`({ elbow: s2r.map.upper_arm_l && s2r.map.upper_arm_l.joints.elbow, props: s2r.props.length, note: document.getElementById("s2rNote").textContent })`,
	);
	ok(
		'🗺 opens the open rig’s kept mapping again, every joint as placed',
		Math.abs(reopened.elbow?.[1] - dragged.after[1]) < 1e-9 &&
			reopened.props === TRUTH.props.length &&
			/Sheety/.test(reopened.note),
		q(reopened),
	);
	await shot('sheet-rig-reopened.png');

	const thrown = pageLog.filter((l) => l.startsWith('[uncaught]'));
	ok('the page threw nothing', thrown.length === 0, thrown.join(' | '));
	ok(
		'no native alert',
		(await evaluate('window.__alerts.length')) === 0,
		await evaluate('window.__alerts.join(" | ")'),
	);
} catch (e) {
	fail++;
	console.log(`  ✗ the harness threw — ${e.message}`);
	console.log(
		await evaluate(
			'JSON.stringify({ note: document.getElementById("s2rNote").textContent, sheet: !!s2r.sheet, faces: s2r.faces, alert: document.getElementById("alertMsg").textContent })',
		).catch((x) => String(x)),
	);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — 🗺 From my sheet ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
