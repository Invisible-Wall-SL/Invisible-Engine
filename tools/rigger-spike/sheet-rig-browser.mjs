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
//  - ◧ Arranged asks `/api/rigger/from-sheet/preview` (faked with the shipped `sheetPreview`) and
//    draws every part and prop where that fit puts them (the stage's pixels sampled through the
//    preview's art); a part dragged moves by the drag and carries the part it holds, its parent
//    stays; dragged near the joint it meets it snaps onto it; ↻ turns it about its first joint with
//    the part it holds; the next preview puts every arranged part where the page drew it, with a
//    `frame` clip; a prop picked in the table drags on its part and turns;
//  - 🦴 Create rig sends ＋ New rig's create with the mapping as `sheet`: the template, the sheet, every
//    part's region and joints (the dragged one as dragged), the head's face, the props; the rig opens
//    with every mapped part drawn from its own region (`path`), the report says what was made; the
//    arrangement and the prop's turn go out as the page has them and the rig has its clip `frame`;
//  - ＋ New rig always starts on the first guess: closed untouched and opened again, the same guess and
//    nothing to reuse; closed after changes, the first guess and ↺ Reuse what you left, which brings
//    them back; with the made rig open (same sheet, same template), the first guess again — not its
//    mapping — and ↺ Reuse “Sheety”, which opens it, arrangement and all; ⤺ forgets the arrangement;
//  - ↺ Start over, the mapping changed by hand: asked first, then the first guess (the arrangement
//    gone), and ↶ brings back what it replaced; on a swapped sheet it reads the names as ⇄ says;
//    ↺ Start over then ✕: ↺ Reuse what you left brings back the mapping it replaced; a face still
//    being found lands on neither the first guess nor, after ↶, the mapping put back, and one being
//    found when ↺ Start over came is looked for again after ↶;
//  - 🗺 Edit mapping on that rig opens its mapping with 🔄 Update rig in Create rig's place (the sheet
//    fixed); a part re-mapped and 🔄 Update rig: `/api/rigger/from-sheet/update` (faked with the
//    shipped `updateSheetRig`) gets the edited mapping and the one the rig keeps, the merged rig is one
//    undo step with its mapping, saved, then its mapping PUT on the ETag it read; one ↶ takes both back;
//  - ⇄ Swap sides, on the sheet named the owner's way (the character's own sides): every part takes
//    the drawing it is, its joints guessed again as that side's (a joint dragged by hand kept on its
//    drawing); a part mapped by hand asked about and moved; a prop goes with its drawing; a moved
//    part starts over in ◧ Arranged; sent with the mapping, read back from it, off on a new one;
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
		'🔄 Update rig making a new rig instead',
		'() => (s2r.edit ? s2rUpdate() : s2rCreate())',
		's2rCreate',
	],
	[
		"an update's mapping not in its undo step",
		'sheetSrc.doc = sh ? JSON.parse(sh) : null;',
		'void sh;',
	],
	['the mapping not saved after the rig', 'await saveSheetSrc(saved, stem);', 'void saveSheetSrc;'],
	[
		'the suggestion not taken',
		'if (kept) s2rKeep(kept);\n    else s2rSuggest();',
		'if (kept) s2rKeep(kept);',
	],
	['a dragged joint not kept', 'dr.m.joints[dr.joint] = moved;', 'void moved;'],
	['the face not sent', '...(m.face ? { face: m.face } : {}) };\n  return {', '};\n  return {'],
	['the props not sent', 'props: st.props.map(', 'props: [].map('],
	[
		'a region not drawn where the rig draws it',
		'const dx = r.offX || 0, dy = r.origH ? r.origH - (r.offY || 0) - r.h : 0;',
		'const dx = 4, dy = 4;',
	],
	[
		"＋ New rig opening the open rig's mapping, not the first guess",
		'await s2rLoad($("#newRigAtlas").value || "");',
		'await s2rLoad(sheetSrc.doc ? sheetSrc.doc.manifestKey : $("#newRigAtlas").value || "", sheetSrc.doc, sheetSrc.doc && irigStem(selected));',
	],
	[
		"the open rig's mapping not offered",
		'if (rawDoc && selected && fits(sheetSrc.doc)){',
		'if (false){',
	],
	[
		'a mapping left in the dialog not offered',
		's2r.left = { mapping: s2rMapping(), at: Date.now() };',
		'void s2rMapping;',
	],
	[
		'the first guess counted as changed by hand',
		's2r.dirty = false;\n  s2rNote(Object.keys(got).length',
		's2rNote(Object.keys(got).length',
	],
	[
		'↺ Reuse opening the first guess, not the mapping',
		'await s2rLoad(c.mapping.manifestKey, c.mapping, c.from);',
		'await s2rLoad(c.mapping.manifestKey);',
	],
	[
		'↺ Start over not asking first',
		'if (s2r.dirty && !confirm("↺ Start over',
		'if (false && !confirm("↺ Start over',
	],
	[
		'↺ Start over keeping the arrangement',
		'Object.assign(s2r, { map: {}, props: [], arrange: null, faces: {},',
		'Object.assign(s2r, { map: {}, props: [], faces: {},',
	],
	[
		'↺ Start over not guessing again',
		'  s2rSuggest();\n  s2rRender(); s2rDraw();\n}\nfunction s2rUndoStartOver',
		'  s2rRender(); s2rDraw();\n}\nfunction s2rUndoStartOver',
	],
	[
		'↺ Start over forgetting ⇄ Swap sides',
		'Object.assign(s2r, { map: {}, props: [], arrange: null,',
		'Object.assign(s2r, { swap: false, map: {}, props: [], arrange: null,',
	],
	[
		'↶ not bringing the mapping back',
		'Object.assign(s2r, u, { undo: null,',
		'Object.assign(s2r, { undo: null,',
	],
	[
		'↺ Start over, then ✕, leaving nothing for ↺ Reuse',
		'else if (!s2r.edit && s2r.sheet && !s2r.dirty',
		'else if (false && !s2r.edit && s2r.sheet && !s2r.dirty',
	],
	[
		'↺ Start over letting a face found before it land on the first guess',
		'  ++s2r.gen;\n  s2rSuggest();',
		'  s2rSuggest();',
	],
	[
		"↶ letting ↺ Start over's face land on the mapping put back",
		'  ++s2r.gen;\n  // A face being found',
		'  // A face being found',
	],
	[
		'↶ leaving a face that was being found stuck',
		'if (f === "busy") s2rTrackFace(part);',
		'if (f === "busy") void part;',
	],
	[
		'◧ Arranged never asking the launcher',
		'if (key !== s2r.previewKey){ s2r.previewKey = key; s2rRequestPreview(); }',
		'void key;',
	],
	[
		'a drawing read off the preview turned the other way',
		'turn: -Math.atan2(m[2], m[0]) * 180 / Math.PI };',
		'turn: Math.atan2(m[2], m[0]) * 180 / Math.PI };',
	],
	[
		'a drawing turned the other way on the canvas',
		'g.rotate(s2rRad(it.place.turn));',
		'g.rotate(-s2rRad(it.place.turn));',
	],
	[
		'a part not carrying the parts it holds',
		'const parts = [it.part, ...s2rBelow(it.part)];',
		'const parts = [it.part];',
	],
	[
		'a dragged part not snapped',
		'if (to && Math.hypot(to[0] - first[0], to[1] - first[1]) * s2r.aview.k <= wsPx(S2R_SNAP)){',
		'if (false){',
	],
	[
		'a part turned about its middle, not its first joint',
		'pivot = s2rJointAt(it.part, names[0]) || pivot;',
		'void names;',
	],
	['the arrangement not sent', '    ...(Object.keys(arrange).length ? { arrange } : {}),\n', ''],
	["a prop's turn not sent", '...(t ? { turn: turn(t) } : {})', ''],
	[
		'the kept arrangement not opened',
		's2r.arrange = placed.length ?',
		's2r.arrange = null && placed.length ?',
	],
	[
		'⇄ the swap reading the names as before',
		'const got = RM.suggestSheetMap(parts, names, now);',
		'const got = RM.suggestSheetMap(parts, names, was);',
	],
	[
		'⇄ a swapped part keeping no joints (never guessed again)',
		'    s2rGuess(p);\n    // A joint dragged by hand',
		'    // A joint dragged by hand',
	],
	[
		'⇄ a joint dragged by hand lost when its drawing moves',
		'if (old) for (const j of old.placed)',
		'if (false) for (const j of old.placed)',
	],
	[
		'⇄ a part mapped by hand never asked about',
		'const moveHand = byHand.length > 0 && confirm(',
		'const moveHand = false && confirm(',
	],
	['⇄ a prop left on the part it was on', '      pr.host = host;\n', ''],
	[
		'⇄ an arranged part kept where its old drawing was',
		'    for (const p of moved) delete s2r.arrange[p];',
		'    void moved;',
	],
	['⇄ swapSides not sent', '    ...(st.swap ? { swapSides: true } : {}),\n', ''],
	[
		"⇄ the setting not read back from a rig's mapping",
		'swap: !!kept && kept.swapSides === true });',
		'swap: false });',
	],
	[
		'⇄ a new rig starting as the dialog left it',
		'swap: !!kept && kept.swapSides === true });',
		'swap: kept ? kept.swapSides === true : s2r.swap });',
	],
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
			"export { updateSheetRig } from './server/rigSheetUpdate.ts';",
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
/**
 * The same sheet named the owner's way (⇄ Swap sides): each sided region's side the other way round
 * (the character's own), one named exactly as the template's other side; as `sheet-rig.mjs`'s.
 */
const OWNER_MANIFEST = 'c/p/manifests/atlas_manifest_Owner.json';
const OWNER_NAMES = {
	L_arm_upper: 'R_arm_upper',
	arm_lower_left: 'arm_lower_right',
	HandL: 'hand_r',
	ArmR1: 'ArmL1',
	ArmR2: 'ArmL2',
	'hand-right': 'hand-left',
	earring_L: 'earring_R',
	watch_R: 'watch_L',
};
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
const seen = {
	creates: [],
	kept: null,
	keptEtag: null,
	previews: 0,
	updates: [],
	saves: 0,
	sheetPuts: [],
};
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
		if (p === '/api/editor/regions' && url.searchParams.get('sheet') === OWNER_MANIFEST)
			return json({
				assetKey: OWNER_MANIFEST,
				pageKey: PAGE_KEY,
				pageVersion: 'v1',
				pageWidth: SHEET.width,
				pageHeight: SHEET.height,
				regions: SHEET.regions.map((r) => ({ ...r, name: OWNER_NAMES[r.name] ?? r.name })),
			});
		if (p === '/api/editor/asset' && url.searchParams.get('key') === PAGE_KEY)
			return send(200, 'image/png', SHEET_PNG);
		if (p === '/api/rigger/from-sheet' && req.method === 'PUT') {
			const body = await readBody(req);
			seen.sheetPuts.push(body);
			if (body.baseEtag !== seen.keptEtag)
				return json({ ok: false, error: 'conflict', message: 'the mapping changed' }, 409);
			seen.kept = body.sheet;
			seen.keptEtag = `sheet-${seen.sheetPuts.length + 1}`;
			return json({ ok: true, etag: seen.keptEtag });
		}
		if (p === '/api/rigger/from-sheet')
			return json({ sheet: made ? seen.kept : null, etag: made ? seen.keptEtag : null });
		if (p === '/api/rigger/from-sheet/update') {
			const body = await readBody(req);
			seen.updates.push(body);
			const [now, was] = [S.parseSheetMapping(body.sheet), S.parseSheetMapping(body.kept)];
			if ('problem' in now || 'problem' in was) return json({ message: 'bad sheet mapping' }, 400);
			const res = S.updateSheetRig({
				template: S.HALF_BODY,
				regions: REGIONS,
				was: was.mapping,
				mapping: now.mapping,
				current: body.skeleton,
				keep: new Set(body.keep ?? []),
			});
			if (!res.ok) return json({ message: res.problem }, 400);
			return json({
				ok: true,
				skeleton: res.value.doc,
				sheet: { ...now.mapping, template: { id: S.HALF_BODY.id, version: S.HALF_BODY.version } },
				report: res.value.report,
			});
		}
		if (p === '/api/rigger/save' && req.method === 'POST') {
			const body = await readBody(req);
			seen.saves++;
			made.rig.skeleton = body.skeleton;
			return json({ ok: true, saved: true, etag: `irig-${seen.saves}` });
		}
		if (p === '/api/rigger/from-sheet/preview') {
			const body = await readBody(req);
			seen.previews++;
			const parsed = S.parseSheetMapping(body.sheet);
			if ('problem' in parsed)
				return json({ message: `bad sheet mapping: ${parsed.problem}` }, 400);
			const pv = S.sheetPreview(S.HALF_BODY, REGIONS, parsed.mapping);
			return pv.ok ? json(pv.value) : json({ message: pv.problem }, 400);
		}
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
			seen.keptEtag = 'sheet-1';
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
/** A mouse event lands on a whole pixel: a turn by a handle 46 stage pixels out is that far off, degrees. */
const MOUSE_TURN = 1.5;
/** A joint guessed from its drawing's shape lies within this share of the drawing's size of the true one. */
const GUESS_OFF = 0.15;

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

	// Closed untouched and opened again: the same first guess, nothing left to reuse.
	const firstGuess = await evaluate('JSON.parse(JSON.stringify(s2rMapping()))');
	const reuseNow = () =>
		evaluate(
			'[...document.querySelectorAll("#s2rReuse button")].map((b) => [b.textContent, b.title])',
		);
	/** ✕, then ＋ New rig's 🗺 From my sheet again: the dialog read anew (`s2r.gen` moves on). */
	const reopen = async () => {
		const gen = await evaluate('s2r.gen');
		await evaluate(
			'document.getElementById("s2rClose").click(); document.getElementById("newRigFromSheet").click(); true',
		);
		await waitFor(
			`s2r.gen > ${gen} && document.getElementById("s2rModal").classList.contains("open") && !!s2r.sheet && s2r.faces.head === "found"`,
			20000,
		);
	};
	await reopen();
	const untouched = await evaluate('JSON.parse(JSON.stringify(s2rMapping()))');
	const untouchedReuse = await reuseNow();
	ok(
		'closed untouched and opened again: the same first guess, and nothing to ↺ Reuse',
		q(untouched) === q(firstGuess) && untouchedReuse.length === 0,
		q(untouchedReuse),
	);

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

	// Closed with those changes and opened again: the first guess, the changes offered, not taken.
	const changed = await evaluate('JSON.parse(JSON.stringify(s2rMapping()))');
	await reopen();
	const leftOpen = await evaluate('JSON.parse(JSON.stringify(s2rMapping()))');
	const leftReuse = await reuseNow();
	ok(
		'closed with changes and opened again, a new rig starts on the first guess; what was left is offered as ↺ Reuse, not taken',
		q(leftOpen) === q(firstGuess) &&
			leftReuse.length === 1 &&
			/^↺ Reuse what you left \d/.test(leftReuse[0][0]),
		q(leftReuse),
	);
	const beforeLeft = await evaluate('s2r.gen');
	await evaluate('document.querySelector("#s2rReuse button").click(); true');
	await waitFor(`s2r.gen > ${beforeLeft} && !!s2r.sheet`, 20000);
	const tookLeft = await evaluate(
		'({ mapping: JSON.parse(JSON.stringify(s2rMapping())), note: document.getElementById("s2rNote").textContent })',
	);
	ok(
		'↺ Reuse what you left brings those changes back as they were',
		q(tookLeft.mapping) === q(changed) && /the mapping you left/.test(tookLeft.note),
		q(tookLeft.note),
	);
	// The watch picked again, as it was when the dialog closed (◧ Arranged grabs the part picked first).
	await evaluate(`(() => {
		const i = s2r.props.findIndex((p) => p.region === "watch_R");
		document.querySelectorAll("#s2rProps .s2rRow")[i].click();
		return true;
	})()`);

	// ◧ Arranged: every part drawn where the preview (the create's own fit) puts it.
	const previewsBefore = seen.previews;
	await evaluate(`document.querySelector('#s2rView button[data-view="arranged"]').click(); true`);
	await waitFor(
		'!!s2r.preview && !!s2r.aview && getComputedStyle(document.getElementById("s2rArrange")).display !== "none"',
		15000,
	);
	/**
	 * In the page: the stage's pixels against each drawing's own, sampled through the preview's art where
	 * that drawing is the top one (the share alike, and how many sampled).
	 */
	const drawnAsRig = `(() => {
		const cv = document.getElementById("s2rArrange"), st = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
		const p = s2r.preview;
		let n = 0, same = 0;
		const shown = s2rArrangeItems().map((it) => it.name);
		for (const a of p.art){
			if (!shown.includes(a.name)) continue;
			const it = s2rArrangeItems().find((x) => x.name === a.name), c = it.c;
			const own = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, m = a.matrix;
			for (let gy = 0; gy < 14; gy++) for (let gx = 0; gx < 14; gx++){
				const x = Math.floor((gx + 0.5) * c.width / 14), y = Math.floor((gy + 0.5) * c.height / 14), o = (y * c.width + x) * 4;
				if (own[o + 3] < 250) continue;
				const [qx, qy] = [x + 0.5 - c.width / 2, c.height / 2 - (y + 0.5)];
				const w = [m[0] * qx + m[1] * qy + m[4], m[2] * qx + m[3] * qy + m[5]];
				const [sx, sy] = s2rToStage([p.origin[0] + w[0] / p.scale, p.origin[1] - w[1] / p.scale]).map(Math.floor);
				if (sx < 0 || sy < 0 || sx >= cv.width || sy >= cv.height) { n++; continue; }
				const top = s2rArrangeHit(s2rArrangeItems(), [sx + 0.5, sy + 0.5]);
				if (!top || top.name !== a.name) continue;
				const s = (sy * cv.width + sx) * 4;
				n++;
				if (st[s + 3] > 200 && Math.abs(st[s] - own[o]) + Math.abs(st[s + 1] - own[o + 1]) + Math.abs(st[s + 2] - own[o + 2]) < 60) same++;
			}
		}
		return { n, same: same / n, items: shown.length };
	})()`;
	const atRest = await evaluate(drawnAsRig);
	ok(
		'◧ Arranged asks the launcher, and draws every mapped part and prop where its fit puts them',
		seen.previews > previewsBefore &&
			atRest.items === Object.keys(want).length + TRUTH.props.length &&
			atRest.same >= 0.8,
		q(atRest),
	);
	await shot('sheet-rig-arranged-rest.png');
	/**
	 * Mouse events on the arrange canvas at stage pixels `pts` (down on the first, up on the last). A
	 * MouseEvent's client point is a whole pixel, so a canvas at a fractional place (another font, another
	 * viewport) gets a drag a fraction off the one asked for: what the page got, in stage px, is returned.
	 */
	const dragOn = (pts) => `(() => {
		const cv = document.getElementById("s2rArrange"), rect = cv.getBoundingClientRect();
		const to = ([x, y]) => ({ bubbles: true, clientX: rect.left + x * rect.width / cv.width, clientY: rect.top + y * rect.height / cv.height });
		const pts = ${pts}, evs = [];
		const fire = (on, type, p) => { const e = new MouseEvent(type, to(p)); evs.push(e); on.dispatchEvent(e); };
		fire(cv, "mousedown", pts[0]);
		for (const p of pts.slice(1)) fire(window, "mousemove", p);
		fire(window, "mouseup", pts[pts.length - 1]);
		const a = evs[0], z = evs[evs.length - 1];
		return { dx: (z.clientX - a.clientX) * cv.width / rect.width, dy: (z.clientY - a.clientY) * cv.height / rect.height };
	})()`;
	const placeOf = `((n) => { const p = s2rPlaceOf(n); return p && { at: [...p.at], turn: p.turn }; })`;
	const grab = `(() => { const e = s2rJointAt("lower_arm_r", "elbow"), w = s2rJointAt("lower_arm_r", "wrist"); return s2rToStage([e[0] + (w[0] - e[0]) * 0.12, e[1] + (w[1] - e[1]) * 0.12]); })()`;
	// Each step below reads, drags and reads again in ONE evaluate: the launcher's next preview (asked
	// for after every change) can land between two evaluates and move a part nobody arranged, and the
	// stage's camera follows its canvas, so a read and the drag after it must see the same page.
	// The right forearm dragged off: it carries its hand, the upper arm stays.
	const { before, off, got } = await evaluate(`(() => {
		const before = { fore: ${placeOf}("lower_arm_r"), hand: ${placeOf}("hand_r"), upper: ${placeOf}("upper_arm_r"), k: s2r.aview.k, from: ${grab} };
		const f = before.from;
		const got = ${dragOn(`[f, [f[0] + 30, f[1] + 20], [f[0] + 60, f[1] + 40]]`)};
		return { before, got, off: { sel: s2r.sel, fore: ${placeOf}("lower_arm_r"), hand: ${placeOf}("hand_r"), upper: ${placeOf}("upper_arm_r"), arranged: Object.keys(s2r.arrange || {}) } };
	})()`);
	const moved = (a, b) => [a.at[0] - b.at[0], a.at[1] - b.at[1]];
	// The drag asked for was (60, 40) stage px; the page got that to within a pixel.
	const by = Math.hypot(got.dx - 60, got.dy - 40) < 1.5 ? [got.dx / before.k, got.dy / before.k] : [NaN, NaN];
	const near = (a, b, e = 0.02) => Math.abs(a[0] - b[0]) <= e && Math.abs(a[1] - b[1]) <= e;
	ok(
		'a part dragged moves by the drag and carries the part it holds; its parent stays',
		off.sel?.part === 'lower_arm_r' &&
			near(moved(off.fore, before.fore), by) &&
			near(moved(off.hand, before.hand), by) &&
			near(moved(off.upper, before.upper), [0, 0], 1e-9),
		q({ off, by, got }),
	);
	// Back near its upper arm's elbow (wherever the latest preview has the upper arm): it snaps there.
	const snapped = await evaluate(`(() => {
		const back = ${grab}, e = s2rToStage(s2rJointAt("lower_arm_r", "elbow")), u = s2rToStage(s2rJointAt("upper_arm_r", "elbow"));
		${dragOn(`[back, [back[0] + u[0] - e[0] + 3, back[1] + u[1] - e[1] + 2]]`)};
		return { fore: s2rJointAt("lower_arm_r", "elbow"), upper: s2rJointAt("upper_arm_r", "elbow"), hand: ${placeOf}("hand_r"), foreAt: ${placeOf}("lower_arm_r") };
	})()`);
	ok(
		'a part dragged near the joint it meets snaps its first joint onto it, its hand with it',
		near(snapped.fore, snapped.upper, 1e-6) &&
			near(moved(snapped.hand, off.hand), moved(snapped.foreAt, off.fore), 1e-6),
		q(snapped),
	);
	// Turned 30° clockwise by its ↻ handle: about its elbow, the hand with it.
	const turned = await evaluate(`(() => {
		const h = s2rHandle(s2rArrangeItems().find(s2rIsSel)), o = h.stage;
		const spin = (p, deg) => { const r = deg * Math.PI / 180, x = p[0] - o[0], y = p[1] - o[1]; return [o[0] + Math.cos(r) * x - Math.sin(r) * y, o[1] + Math.sin(r) * x + Math.cos(r) * y]; };
		${dragOn(`[h.handle, spin(h.handle, 15), spin(h.handle, 30)]`)};
		return { fore: ${placeOf}("lower_arm_r"), hand: ${placeOf}("hand_r"), elbow: s2rJointAt("lower_arm_r", "elbow") };
	})()`);
	ok(
		'↻ turns a part about its first joint, with the part it holds',
		Math.abs(turned.fore.turn - snapped.foreAt.turn - 30) < MOUSE_TURN &&
			Math.abs(turned.hand.turn - snapped.hand.turn - (turned.fore.turn - snapped.foreAt.turn)) <
				1e-9 &&
			near(turned.elbow, snapped.fore, 1e-6),
		q({ turned, was: snapped }),
	);
	// The launcher places them where the page has them: the next preview's art is the arrangement.
	await waitFor(
		`(() => { const a = s2rPreviewPlace("lower_arm_r"), b = s2r.arrange && s2r.arrange.lower_arm_r; return !!a && !!b && Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) < 0.05; })()`,
		15000,
	);
	const agreed = await evaluate(`(() => {
		let worst = 0, turn = 0;
		for (const [p, b] of Object.entries(s2r.arrange)){
			const a = s2rPreviewPlace(p);
			worst = Math.max(worst, Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]));
			turn = Math.max(turn, Math.abs(((a.turn - b.turn) % 360 + 540) % 360 - 180));
		}
		return { worst, turn, frame: s2r.preview.frame, parts: Object.keys(s2r.arrange) };
	})()`);
	const arrangedDraw = await evaluate(drawnAsRig);
	ok(
		'the rig fitted to the arrangement puts every arranged part where the page drew it, with a frame clip',
		agreed.frame === true && agreed.worst < 0.02 && agreed.turn < 0.01 && arrangedDraw.same >= 0.8,
		q({ agreed, arrangedDraw }),
	);
	await shot('sheet-rig-arranged.png');
	// A prop picked in the table drags on its part (even under the part over it) and turns by ↻.
	const glasses = TRUTH.props.find((p) => p.region === 'Sunglasses');
	const propBefore = await evaluate(`(() => {
		const i = s2r.props.findIndex((p) => p.region === "Sunglasses");
		document.querySelectorAll("#s2rProps .s2rRow")[i].click();
		document.querySelector('#s2rView button[data-view="arranged"]').click();
		const p = s2r.props[i], place = s2rPropPlace(p);
		return { i, at: [...p.at], place, stage: s2rToStage(place.at), k: s2r.aview.k, turn: p.turn || 0 };
	})()`);
	const propGot = await evaluate(
		dragOn(`[${q(propBefore.stage)}, [${propBefore.stage[0] + 12}, ${propBefore.stage[1]}]]`),
	);
	const propMoved = await evaluate(
		`(() => { const p = s2r.props[${propBefore.i}]; return { at: [...p.at], place: s2rPropPlace(p) }; })()`,
	);
	const propHandle = await evaluate(
		`(() => { const h = s2rHandle(s2rArrangeItems().find(s2rIsSel)); return { pivot: h.stage, handle: h.handle }; })()`,
	);
	const pspin = (deg) => {
		const r = (deg * Math.PI) / 180;
		const [x, y] = [
			propHandle.handle[0] - propHandle.pivot[0],
			propHandle.handle[1] - propHandle.pivot[1],
		];
		return [
			propHandle.pivot[0] + Math.cos(r) * x - Math.sin(r) * y,
			propHandle.pivot[1] + Math.sin(r) * x + Math.cos(r) * y,
		];
	};
	await evaluate(dragOn(`[${q(propHandle.handle)}, ${q(pspin(-10))}, ${q(pspin(-20))}]`));
	const propTurned = await evaluate(`s2r.props[${propBefore.i}].turn || 0`);
	ok(
		`a prop (${glasses.part}) dragged on the canvas moves where it sits on its part, and ↻ turns it`,
		near(
			[
				propMoved.place.at[0] - propBefore.place.at[0],
				propMoved.place.at[1] - propBefore.place.at[1],
			],
			[propGot.dx / propBefore.k, propGot.dy / propBefore.k],
			0.12,
		) &&
			Math.hypot(propMoved.at[0] - propBefore.at[0], propMoved.at[1] - propBefore.at[1]) > 1 &&
			Math.abs(propTurned - propBefore.turn + 20) < MOUSE_TURN,
		q({ propBefore, propMoved, propTurned }),
	);
	const arranged = await evaluate('JSON.parse(JSON.stringify(s2rMapping()))');

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
	ok(
		'🦴 Create rig sends the arrangement and the prop’s turn as the page has them',
		q(sent?.arrange) === q(arranged.arrange) &&
			Object.keys(sent?.arrange ?? {}).includes('lower_arm_r') &&
			Math.abs(
				(sent?.props.find((x) => x.region === 'Sunglasses')?.turn ?? Infinity) - propTurned,
			) < 0.002,
		q({ sent: sent?.arrange, page: arranged.arrange, propTurned }),
	);
	ok(
		'the rig opens with its clip “frame”, the arranged pose',
		await evaluate(
			'!!(rawDoc.animations && rawDoc.animations.frame && rawDoc.animations.frame.bones.lower_arm_r)',
		),
		await evaluate('JSON.stringify(Object.keys(rawDoc.animations || {}))'),
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
		'the rig opens: every body part drawn from its own region (the torso and the drawn face bend, every other part an image rigid on its bone), each prop on a bone of its own',
		rig.parts.join() === 'torso,head' &&
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

	// ＋ New rig again with that rig open, the same sheet and template: the first guess, not the rig's
	// mapping, which ↺ Reuse offers and brings back.
	await evaluate('document.getElementById("newRigBtn").click(); true');
	await waitFor(
		`!!document.querySelector('#newRigApply option[value="template:half-body"]') && !!document.querySelector('#newRigAtlas option[value=${q(MANIFEST)}]')`,
		15000,
	);
	const beforeNew = await evaluate('s2r.gen');
	await evaluate(`(() => {
		document.getElementById("newRigApply").value = "template:half-body";
		document.getElementById("newRigAtlas").value = ${q(MANIFEST)};
		document.getElementById("newRigFromSheet").click();
		return true;
	})()`);
	await waitFor(
		`s2r.gen > ${beforeNew} && document.getElementById("s2rModal").classList.contains("open") && !!s2r.sheet && s2r.faces.head === "found"`,
		20000,
	);
	const anew = await evaluate(
		'({ mapping: JSON.parse(JSON.stringify(s2rMapping())), from: s2r.from })',
	);
	const anewReuse = await reuseNow();
	ok(
		'＋ New rig after a rig of the same sheet and template opens on the first guess (every part the region its name says, its joints guessed, the props suggested, nothing arranged), not that rig’s mapping',
		q(anew.mapping) === q(firstGuess) && anew.from === null,
		q({ from: anew.from, elbow: anew.mapping.parts.upper_arm_l?.joints.elbow }),
	);
	ok(
		'… and offers that rig’s mapping as ↺ Reuse “Sheety”, and nothing else',
		anewReuse.length === 1 &&
			anewReuse[0][0] === '↺ Reuse “Sheety”' &&
			/Sheety/.test(anewReuse[0][1]),
		q(anewReuse),
	);
	const beforeReuse = await evaluate('s2r.gen');
	await evaluate('document.querySelector("#s2rReuse button").click(); true');
	await waitFor(`s2r.gen > ${beforeReuse} && !!s2r.sheet && s2r.from === "Sheety"`, 20000);
	const reopened = await evaluate(
		`({ elbow: s2r.map.upper_arm_l && s2r.map.upper_arm_l.joints.elbow, props: s2r.props.length, note: document.getElementById("s2rNote").textContent })`,
	);
	ok(
		'↺ Reuse “Sheety” brings the rig’s mapping back, every joint as placed',
		Math.abs(reopened.elbow?.[1] - dragged.after[1]) < 1e-9 &&
			reopened.props === TRUTH.props.length &&
			/Sheety/.test(reopened.note),
		q(reopened),
	);
	await shot('sheet-rig-reopened.png');
	// …with its arrangement: the same mapping goes out again; ⤺ forgets it.
	await evaluate(`document.querySelector('#s2rView button[data-view="arranged"]').click(); true`);
	await waitFor('!!s2r.preview && !!s2r.aview && s2r.preview.frame === true', 15000);
	const again = await evaluate('JSON.parse(JSON.stringify(s2rMapping()))');
	// ↺ Start over on it, changed by hand (the neck given another drawing): asked first, then the first
	// guess, the arrangement gone too; ↶ brings back what it replaced.
	const edited = await evaluate(`(() => {
		window.__confirms = [];
		window.confirm = (m) => (window.__confirms.push(String(m)), true);
		const s = document.querySelector('#s2rParts [data-part="neck"] select');
		s.value = "bg_glow"; s.dispatchEvent(new Event("change"));
		return JSON.parse(JSON.stringify(s2rMapping()));
	})()`);
	await evaluate('document.getElementById("s2rStartOver").click(); true');
	await waitFor('!!s2r.undo && s2r.faces.head === "found"', 15000);
	const over = await evaluate(
		'({ mapping: JSON.parse(JSON.stringify(s2rMapping())), confirms: window.__confirms.slice(), undo: document.getElementById("s2rUndoStart").style.display !== "none" })',
	);
	ok(
		'↺ Start over asks first, then the first guess: every part the region its name says, its joints guessed, the props suggested, nothing arranged',
		over.confirms.length === 1 &&
			/Start over/.test(over.confirms[0]) &&
			q(over.mapping) === q(firstGuess) &&
			over.undo &&
			!!edited.arrange,
		q({ confirms: over.confirms, undo: over.undo, arrange: over.mapping.arrange }),
	);
	await evaluate('document.getElementById("s2rUndoStart").click(); true');
	const undoneStart = await evaluate(
		'({ mapping: JSON.parse(JSON.stringify(s2rMapping())), undo: document.getElementById("s2rUndoStart").style.display !== "none", confirms: window.__confirms.length })',
	);
	ok(
		'↶ brings back the mapping it replaced, the arrangement and the neck with it, in one step',
		q(undoneStart.mapping) === q(edited) && !undoneStart.undo && undoneStart.confirms === 1,
		q({ undo: undoneStart.undo, neck: undoneStart.mapping.parts.neck?.region }),
	);
	await evaluate(
		'window.confirm = () => true; document.getElementById("s2rUnarrange").click(); true',
	);
	const forgot = await evaluate('({ arrange: s2r.arrange, sent: "arrange" in s2rMapping() })');
	ok(
		'the kept arrangement opens again as arranged (the prop’s turn too), and ⤺ forgets it',
		q(again.arrange) === q(sent?.arrange) &&
			q(again.props) === q(sent?.props) &&
			forgot.arrange === null &&
			forgot.sent === false,
		q({ again: again.arrange, forgot }),
	);
	await waitFor('!!s2r.preview && s2r.preview.frame === false', 15000);
	await shot('sheet-rig-unarranged.png');

	// 🗺 Edit mapping → 🔄 Update rig: the neck re-mapped, merged into the open rig (the launcher's
	// merge), one undo step with its mapping, the rig saved and then its mapping, on the ETag it read.
	await evaluate('closeSheetToRig(); true');
	await waitFor(
		'!!sheetSrc.doc && document.getElementById("editMapBtn").style.display !== "none"',
		15000,
	);
	await evaluate('document.getElementById("editMapBtn").click(); true');
	await waitFor(
		'document.getElementById("s2rModal").classList.contains("open") && !!s2r.sheet && !!s2r.edit && !!s2r.map.neck',
		20000,
	);
	const mode = await evaluate(
		'({ label: document.getElementById("s2rCreate").textContent, locked: document.getElementById("s2rSheet").disabled })',
	);
	ok(
		'🗺 Edit mapping opens the rig’s mapping with 🔄 Update rig in Create rig’s place, the sheet fixed',
		mode.label === '🔄 Update rig' && mode.locked,
		q(mode),
	);
	await evaluate('s2rSetRegion("neck", "bg_glow"); s2r.dirty = true; s2rRender(); true');
	const steps = await evaluate('rigHist.past.length');
	await evaluate('document.getElementById("s2rCreate").click(); true');
	await waitFor(
		'/updated from its mapping/.test(document.getElementById("alertMsg").textContent)',
		20000,
	);
	const upd = await evaluate(`({
		path: rawDoc.skins[0].attachments.neck.neck.path,
		kept: sheetSrc.doc.parts.neck.region,
		steps: rigHist.past.length,
		open: document.getElementById("s2rModal").classList.contains("open"),
	})`);
	const put = seen.sheetPuts.at(-1);
	ok(
		'🔄 Update rig merges the re-mapped neck into the open rig as one undo step, sending the mapping the rig keeps',
		upd.path === 'bg_glow' &&
			upd.kept === 'bg_glow' &&
			upd.steps === steps + 1 &&
			!upd.open &&
			seen.updates.length === 1 &&
			seen.updates[0].kept?.parts?.neck?.region === 'Neck01',
		q({ upd, updates: seen.updates.length }),
	);
	ok(
		'the rig is saved, then its mapping, conditional on the sheet.json it read',
		seen.saves >= 1 &&
			put?.baseEtag === 'sheet-1' &&
			put?.sheet?.parts?.neck?.region === 'bg_glow' &&
			seen.kept?.parts?.neck?.region === 'bg_glow',
		q({ saves: seen.saves, put: put && { baseEtag: put.baseEtag, neck: put.sheet?.parts?.neck } }),
	);
	await evaluate('closeAlert(); rigUndo(); true');
	const undone = await evaluate(
		'({ path: rawDoc.skins[0].attachments.neck.neck.path, kept: sheetSrc.doc && sheetSrc.doc.parts.neck.region })',
	);
	ok(
		'one ↶ undo takes the rig and its mapping back',
		undone.path !== 'bg_glow' && undone.kept === 'Neck01',
		q(undone),
	);

	// ⇄ Swap sides, on the sheet named the owner's way (the character's own left and right).
	await evaluate(`(async () => {
		window.__confirms = [];
		window.confirm = (m) => (window.__confirms.push(String(m)), true);
		document.getElementById("s2rModal").classList.add("open");
		await s2rLoad(${q(OWNER_MANIFEST)});
		return true;
	})()`);
	await waitFor(`!!s2r.sheet && s2r.sheetKey === ${q(OWNER_MANIFEST)}`, 20000);
	const owner = (name) => OWNER_NAMES[name] ?? name;
	const drawingOf = Object.fromEntries(SHEET.regions.map((r) => [owner(r.name), r.name]));
	const unswapped = await evaluate(`(() => {
		// By hand: a hand pose mapped, an upper arm's elbow dragged, two parts arranged.
		s2rSetRegion("hand_l_fist", ${q(owner('hand-right'))});
		const arm = Object.keys(s2r.map).find((p) => s2r.map[p].region === ${q(owner('L_arm_upper'))});
		const m = s2r.map[arm];
		m.joints.elbow = [m.joints.elbow[0] + 3.5, m.joints.elbow[1] - 2.5];
		m.placed = ["elbow"];
		s2r.arrange = { torso: { at: [400, 300], turn: 0 }, [arm]: { at: [300, 250], turn: 90 } };
		return {
			arm, elbow: m.joints.elbow,
			map: Object.fromEntries(Object.entries(s2r.map).map(([p, x]) => [p, x.region])),
			swap: s2r.swap,
		};
	})()`);
	ok(
		"unswapped, the sheet named the owner's way lands each sided drawing on the other side",
		!unswapped.swap &&
			Object.entries(TRUTH.parts).every(
				([p, t]) => !/_[lr]$/.test(p) || drawingOf[unswapped.map[p]] !== t.region,
			),
		q(unswapped.map),
	);
	await evaluate('document.getElementById("s2rSwapSides").click(); true');
	const swapped = await evaluate(`(() => {
		const guess = (p) => {
			const c = s2rCanvas(s2r.map[p].region);
			const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
			const alpha = new Uint8Array(c.width * c.height);
			for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
			return window.RiggerMotion.guessSheetJoints(s2rKind(p), s2rSide(p), { w: c.width, h: c.height, alpha });
		};
		return {
			map: Object.fromEntries(Object.entries(s2r.map).map(([p, x]) => [p, { region: x.region, joints: x.joints, placed: x.placed, guess: guess(p) }])),
			props: s2r.props.map((p) => [p.region, p.host, p.bone, s2rPart(p.host).bone]),
			arrange: s2r.arrange && Object.keys(s2r.arrange),
			confirms: window.__confirms,
			pressed: document.getElementById("s2rSwapSides").getAttribute("aria-pressed"),
			sent: s2rMapping().swapSides,
		};
	})()`);
	const sm = swapped.map;
	ok(
		"⇄ Swap sides: every part takes the drawing it is (ArmL1, the picture's right arm, on upper_arm_r)",
		Object.entries(TRUTH.parts).every(([p, t]) => drawingOf[sm[p]?.region] === t.region) &&
			sm.upper_arm_r?.region === 'ArmL1',
		q(Object.fromEntries(Object.entries(sm).map(([p, x]) => [p, x.region]))),
	);
	const armNow = Object.keys(sm).find((p) => sm[p].region === owner('L_arm_upper'));
	const sidedPart = (p) => !!S.sheetSide(S.HALF_BODY.parts.find((x) => x.name === p).slot);
	/** A guessed joint's distance from the true one, a share of its drawing's size. */
	const offTruth = (p, j) => {
		const r = SHEET.regions.find((x) => x.name === TRUTH.parts[p].region);
		return d2(sm[p].joints[j], TRUTH.parts[p].joints[j]) / Math.max(r.w, r.h);
	};
	ok(
		"… its joints guessed again as that side's, a joint dragged by hand still where it was dragged on its drawing",
		Object.entries(sm).every(
			([p, x]) =>
				!sidedPart(p) ||
				Object.entries(x.joints).every(([j, v]) =>
					p === armNow && j === 'elbow' ? q(v) === q(unswapped.elbow) : q(v) === q(x.guess[j]),
				),
		) &&
			sm[armNow]?.placed.includes('elbow') &&
			offTruth('upper_arm_l', 'shoulder') <= GUESS_OFF &&
			offTruth('upper_arm_r', 'shoulder') <= GUESS_OFF &&
			offTruth('upper_arm_r', 'elbow') <= GUESS_OFF,
		q({
			armNow,
			wrong: Object.entries(sm)
				.filter(([p]) => sidedPart(p))
				.flatMap(([p, x]) =>
					Object.entries(x.joints)
						.filter(([j, v]) => !(p === armNow && j === 'elbow') && q(v) !== q(x.guess[j]))
						.map(([j, v]) => [p, j, v, x.guess[j]]),
				),
			dragged: [sm[armNow]?.joints.elbow, unswapped.elbow],
		}),
	);
	ok(
		'… a part mapped by hand asked about, and moved to the other side on OK',
		swapped.confirms.length === 1 &&
			/hand_l_fist/.test(swapped.confirms[0]) &&
			sm.hand_r_fist?.region === owner('hand-right') &&
			!sm.hand_l_fist,
		q({ confirms: swapped.confirms, fist: [sm.hand_l_fist?.region, sm.hand_r_fist?.region] }),
	);
	ok(
		"… each prop on the drawing it is worn on, its bone that part's",
		TRUTH.props.every((t) =>
			swapped.props.some(
				([r, host, bone, own]) => r === owner(t.region) && host === t.host && bone === own,
			),
		),
		q(swapped.props),
	);
	ok(
		'… a part whose drawing changed starts over on its bones in ◧ Arranged, the others kept',
		q(swapped.arrange) === q(['torso']),
		q(swapped.arrange),
	);
	ok(
		'… shown on, and sent with the mapping',
		swapped.pressed === 'true' && swapped.sent === true,
		q({ pressed: swapped.pressed, sent: swapped.sent }),
	);
	const kept = await evaluate('JSON.parse(JSON.stringify(s2rMapping()))');
	await evaluate('window.__confirms = []; document.getElementById("s2rStartOver").click(); true');
	const restarted = await evaluate(`({
		map: Object.fromEntries(Object.entries(s2r.map).map(([p, x]) => [p, x.region])),
		swap: s2r.swap, arrange: s2r.arrange, confirms: window.__confirms.length,
	})`);
	ok(
		'↺ Start over reads the names as ⇄ Swap sides says: every part the drawing it is, the fist mapped by hand gone, nothing arranged',
		restarted.swap &&
			Object.entries(TRUTH.parts).every(([p, t]) => drawingOf[restarted.map[p]] === t.region) &&
			!restarted.map.hand_r_fist &&
			!restarted.map.hand_l_fist &&
			restarted.arrange === null &&
			restarted.confirms === 1,
		q(restarted),
	);
	const reread = await evaluate(`(async () => {
		const kept = ${q(kept)};
		await s2rLoad(${q(OWNER_MANIFEST)}, kept);
		const fromKept = s2r.swap;
		await s2rLoad(${q(OWNER_MANIFEST)});
		const fresh = s2r.swap;
		return { fromKept, fresh };
	})()`);
	ok(
		'a kept mapping opens swapped as it was made; a new one unswapped, whatever the dialog last had',
		reread.fromKept === true && reread.fresh === false,
		q(reread),
	);

	// ↺ Start over, then ✕ and opened again: what was left is the mapping it replaced.
	await reopen();
	const replaced = await evaluate(`(() => {
		const s = document.querySelector('#s2rParts [data-part="neck"] select');
		s.value = "bg_glow"; s.dispatchEvent(new Event("change"));
		return JSON.parse(JSON.stringify(s2rMapping()));
	})()`);
	await evaluate('document.getElementById("s2rStartOver").click(); true');
	await waitFor('!!s2r.undo && s2r.faces.head === "found"', 15000);
	await reopen();
	const leftOver = (await reuseNow()).findIndex(([t]) => /^↺ Reuse what you left/.test(t));
	const beforeOver = await evaluate('s2r.gen');
	if (leftOver >= 0)
		await evaluate(`document.querySelectorAll("#s2rReuse button")[${leftOver}].click(); true`);
	await waitFor(`s2r.gen > ${beforeOver} && !!s2r.sheet`, 20000);
	const tookOver = await evaluate('JSON.parse(JSON.stringify(s2rMapping()))');
	ok(
		'↺ Start over, then ✕ and opened again: ↺ Reuse what you left brings back the mapping it replaced',
		leftOver >= 0 && q(tookOver) === q(replaced),
		q({ leftOver, neck: tookOver.parts.neck?.region }),
	);

	// Faces found late: the tracker held until let go, the face it finds another (ALT) or the head's.
	const alt = face.map(([x, y]) => [x + 0.03, y]);
	const tick = 'await new Promise((r) => setTimeout(r, 100));';
	const late = await evaluate(`(async () => {
		window.__track0 = window.RiggerMotion.track;
		window.__gates = [];
		window.RiggerMotion.track = (kinds, src) => new Promise((r) => window.__gates.push((landmarks) =>
			r({ width: src.width, height: src.height, frames: [{ t: 0, face: { landmarks, blend: {} } }] })));
		const before = JSON.parse(JSON.stringify(s2rMapping()));
		document.getElementById("s2rStartOver").click();
		const busy = s2r.faces.head;
		document.getElementById("s2rUndoStart").click();
		while (window.__gates.length) window.__gates.shift()(${q(alt)});
		${tick}
		return { same: q(JSON.parse(JSON.stringify(s2rMapping()))) === q(before), busy, face: s2r.faces.head };
		function q(v){ return JSON.stringify(v); }
	})()`);
	ok(
		'a face ↺ Start over looks for, found after ↶, leaves the mapping put back as it was',
		late.busy === 'busy' && late.face === 'found' && late.same,
		q(late),
	);
	const stuck = await evaluate(`(async () => {
		const region = s2r.map.head.region, c = s2rCanvas(region);
		s2rSetRegion("head", region); s2rRender();
		document.getElementById("s2rStartOver").click();
		window.__gates.shift()(${q(alt)});
		${tick}
		const mid = { face: s2r.faces.head, found: !!s2r.map.head.face };
		document.getElementById("s2rUndoStart").click();
		window.__gates.shift()(${q(alt)});
		const again = window.__gates.shift();
		if (again) again(${q(face)});
		${tick}
		const want = [Math.round(${face[0][0]} * c.width * 10) / 10, Math.round(${face[0][1]} * c.height * 10) / 10];
		window.RiggerMotion.track = window.__track0;
		return { mid, again: !!again, face: s2r.faces.head, at: s2r.map.head.face && s2r.map.head.face[0], want };
	})()`);
	ok(
		'a face looked for before ↺ Start over lands on neither the first guess nor, after ↶, the mapping put back; ↶ looks for it again',
		stuck.mid.face === 'busy' &&
			!stuck.mid.found &&
			stuck.again &&
			stuck.face === 'found' &&
			q(stuck.at) === q(stuck.want),
		q(stuck),
	);
	await evaluate('closeSheetToRig(); window.confirm = () => true; true');

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
