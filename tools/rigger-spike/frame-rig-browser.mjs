// Browser gate for frame to rig's 🦴 Create rig (docs/design/frame-to-rig.md, F2b), on the SHIPPED
// view.html in a real Chromium against a fake launcher API. The fake answers as the routes do with
// the shipped code: the clip's kept cut is atlas-tool's committed fixture cut
// (services/atlas-tool/fixtures/rig_from_frame/parts/), `/api/rigger/from-frame/sheet` answers the
// shipped fit (`framePartsRequest`) with the committed sheet, and `/api/rigger/new` checks that fit
// (`parseRigFit`) and makes the rig with `templateRig`, which the page then opens from the sheet's
// page. The routes themselves are `check:rig-from-frame`; the fit and the sheet, `frame-rig.mjs` and
// `test_rig_frame_parts.py`. Checked:
//  - picking the clip opens its kept cut at once, with no track (the tracker is not loaded here):
//    its frame, parts and props, ✂ on the strip's frame, and 🦴 Create rig enabled;
//  - a prop ticked ✗ is kept with the cut first (the touch-ups' POST), and the sheet is asked for on
//    the ETag that keep answered, under the rig name typed in the dialog;
//  - the rig is created from the sheet with the template and the fit (the frame's pose and the taken
//    props), the dialog closes, the rig opens with its `frame` clip and every cut part attached, and
//    the report names the frame, the CPU fill and the parts no frame makes;
//  - the prop editor (F2d): ＋ names a prop and the lasso paints it (its host is the part it took
//    the pixels from), a prop's bone is picked, 🗑 gives a prop's pixels back to the parts under them;
//    per-part frames: a part clicked, then another frame in the strip, is taken from that frame's kept
//    cut. 💾 keeps all of it in one edit (the shipped `applyCutEdits` answers it): the new names, the
//    props, the label map, the sources; the list shows the frame, the strip marks it, and the rig is
//    made with the part from there and the props on their bones;
//  - parts from other frames shown (F2h): frame 2's kept cut is the fixture moved SHIFT px right with
//    its colours inverted, so the assembled stage must draw the upper arm's pixels from there, back
//    where this frame draws it, outlined in frame 2's colour, and ▣ This frame shows this frame; the
//    part's row shows its frame on a chip, the strip marks frame 2 with the parts' colours; picking a
//    part's frame shows that part's score under each frame, Esc stops, a frame in the strip takes it,
//    this frame takes it back, and ★ offers the plan's frame on a kept cut;
//  - a taken rig name (the sheet's 409) says so and leaves the dialog open, the cut still there;
//  - the page threw nothing.
//   node tools/rigger-spike/frame-rig-browser.mjs [--png <dir>]   (--png: the dialog, the report, the rig)
//   F2R_HTML=<file> serves that page instead of view.html (a mutant, run by hand).
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './chrome.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const STATIC = join(APP, 'static/');
const FIX = fileURLToPath(new URL('services/atlas-tool/fixtures/rig_from_frame/', ROOT));
const html = readFileSync(process.env.F2R_HTML || join(STATIC, 'rigger/view.html'), 'utf8');

const esbuild = await import(ESBUILD);
const out = join(mkdtempSync(join(tmpdir(), 'frame-rig-browser-')), 'server.mjs');
await esbuild.build({
	stdin: {
		contents: [
			"export * from './rigTemplates.ts';",
			"export * from './rigTemplateFit.ts';",
			"export * from './rigFrameFit.ts';",
			"export * from './rigCutEdits.ts';",
		].join('\n'),
		resolveDir: join(APP, 'src/lib/server'),
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
const CUT = read('parts/cut.json');
const TRACK = read('track.json');
const SHEET = read('parts/sheet.json');
const SHEET_PNG = readFileSync(join(FIX, 'parts/sheet.png'));
const LABELS = await createRequire(join(APP, 'package.json'))('sharp')(
	join(FIX, 'parts/labels.png'),
)
	.extractChannel(0)
	.raw()
	.toBuffer({ resolveWithObject: true });
const CLIP = {
	id: 'nelly',
	name: 'NellyAnimTest',
	assetKey: 'c/p/manifests/atlas_manifest_Nelly.json',
	frames: ['f0', 'f1', 'f2'],
};
const KEPT = 1;
/** Another frame's kept cut (frame 2): the fixture again, under its own job. */
const OTHER = 'f2r-fixture-0002';
const MANIFEST = 'c/p/manifests/atlas_manifest_Nelly_parts.json';
const PAGE = 'Nelly_parts.png';

/** The `.atlas` ＋ New rig writes for the sheet: `regionsToRigAtlas` of its untrimmed regions. */
const atlasOf = (regions) =>
	[
		PAGE,
		`size:${SHEET.width},${SHEET.height}`,
		'filter:Linear,Linear',
		...regions.flatMap((r) => [r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`]),
	].join('\n') + '\n';
const seen = { edits: [], sheets: [], creates: [], cuts: [] };
let etag = '"e1"';
let made = null;
let kept = structuredClone(CUT);
let labelsNow = new Uint8Array(LABELS.data);
const sharpOf = createRequire(join(APP, 'package.json'))('sharp');

// Frame 2's kept cut: the fixture moved SHIFT px right (its labels and joints with it) and its colours
// inverted, so a part drawn from it can be told from this frame's and must be moved back.
const SHIFT = 16;
const [FW2, FH2] = CUT.size;
const shifted = (src, channels, fill, map = (v) => v) => {
	const out = Buffer.alloc(FW2 * FH2 * channels, fill);
	for (let y = 0; y < FH2; y++)
		for (let x = SHIFT; x < FW2; x++)
			for (let k = 0; k < channels; k++)
				out[(y * FW2 + x) * channels + k] = map(src[(y * FW2 + x - SHIFT) * channels + k], k);
	return out;
};
const frameRaw = await sharpOf(join(FIX, 'frame.png')).ensureAlpha().raw().toBuffer();
const FRAME2 = await sharpOf(
	shifted(frameRaw, 4, 0, (v, k) => (k < 3 ? 255 - v : v)),
	{ raw: { width: FW2, height: FH2, channels: 4 } },
)
	.png()
	.toBuffer();
const LABELS2 = await sharpOf(shifted(LABELS.data, 1, 255), {
	raw: { width: FW2, height: FH2, channels: 1 },
})
	.png()
	.toBuffer();
const TRACK2 = structuredClone(TRACK);
for (const pts of [
	TRACK2.pose.landmarks,
	TRACK2.face?.landmarks ?? [],
	...TRACK2.hands.map((h) => h.landmarks),
])
	for (const p of pts) if (p) p[0] += SHIFT / FW2;

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.png': 'image/png',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
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
		if (p === '/fx/frame.png') return send(200, 'image/png', readFileSync(join(FIX, 'frame.png')));
		if (p === '/fx/labels.png')
			return send(200, 'image/png', readFileSync(join(FIX, 'parts/labels.png')));
		if (p === '/fx/track.json') return json(TRACK);
		if (p === '/fx/frame-2.png') return send(200, 'image/png', FRAME2);
		if (p === '/fx/labels-2.png') return send(200, 'image/png', LABELS2);
		if (p === '/fx/track-2.json') return json(TRACK2);
		if (p === '/api/rigger/templates') return json({ templates: S.rigTemplateList() });
		if (p === '/api/editor/flipbooks') return json({ clips: [CLIP] });
		// A cut (✂ Cut on the kept cut's frame): the fixture cut again, under the job it was sent.
		if (p === '/api/rigger/from-frame' && req.method === 'POST') {
			const body = await readBody(req);
			seen.cuts.push(body);
			return json({
				...CUT,
				job: body.job ?? CUT.job,
				clipId: CLIP.id,
				frame: body.frame,
				etag: '"c1"',
				urls: {
					frame: '/fx/frame.png',
					labels: '/fx/labels.png',
					overlay: '/fx/frame.png',
					track: '/fx/track.json',
				},
			});
		}
		if (p === '/api/rigger/from-frame' && req.method === 'GET')
			return json({
				cuts:
					url.searchParams.get('clipId') === CLIP.id
						? [
								{
									...kept,
									root: `c/p/rig-from-frame/${CUT.job}`,
									clipId: CLIP.id,
									frame: KEPT,
									etag,
									saved: Date.parse('2026-11-22T09:09:43Z'),
									urls: {
										frame: '/fx/frame.png',
										labels: '/fx/labels.png',
										overlay: '/fx/frame.png',
										track: '/fx/track.json',
									},
								},
								{
									...CUT,
									job: OTHER,
									root: `c/p/rig-from-frame/${OTHER}`,
									clipId: CLIP.id,
									frame: 2,
									etag: '"o1"',
									saved: Date.parse('2026-11-22T08:00:00Z'),
									urls: {
										frame: '/fx/frame-2.png',
										labels: '/fx/labels-2.png',
										overlay: '/fx/frame-2.png',
										track: '/fx/track-2.json',
									},
								},
							]
						: [],
			});
		if (p === '/api/rigger/from-frame/edits') {
			const body = await readBody(req);
			seen.edits.push(body);
			if (body.etag !== etag) return json({ error: 'changed' }, 409);
			// As the route does: the shipped edits, then the label map checked and counted.
			const applied = S.applyCutEdits(kept, body, S.HALF_BODY, typeof body.labels === 'string');
			if (!applied.ok) return json({ error: applied.message }, applied.status);
			const next = applied.value.cut;
			if (applied.value.jobs.some((j) => j !== OTHER)) return json({ error: 'no such cut' }, 400);
			if (typeof body.labels === 'string') {
				const png = Buffer.from(body.labels.split(',')[1], 'base64');
				const raw = await sharpOf(png).extractChannel(0).raw().toBuffer();
				const outline = raw.every((v, i) => (v === 255) === (LABELS.data[i] === 255));
				if (!outline || raw.some((v) => v !== 255 && v >= next.names.length))
					return json({ error: 'bad label map' }, 400);
				labelsNow = new Uint8Array(raw);
				const counts = S.labelCounts(labelsNow, next.names.length);
				for (const q of [...next.parts, ...next.props]) q.px = counts[next.names.indexOf(q.name)];
			}
			kept = next;
			etag = `"e${seen.edits.length + 1}"`;
			return json({
				ok: true,
				etag,
				names: kept.names,
				parts: kept.parts,
				props: kept.props,
				sources: kept.sources ?? {},
			});
		}
		if (p === '/api/rigger/from-frame/sheet') {
			const body = await readBody(req);
			seen.sheets.push(body);
			if (body.name === 'Taken')
				return json(
					{ message: 'a rig named "Taken" already exists (names are case-insensitive)' },
					409,
				);
			if (body.etag !== etag) return json({ message: 'The cut changed since it was opened.' }, 409);
			const cut = kept;
			const pivots = S.propPivots(labelsNow, LABELS.info.width, cut);
			const sources = Object.fromEntries(
				Object.entries(cut.sources ?? {}).map(([part, job]) => [
					part,
					{ job, cut: CUT, track: TRACK },
				]),
			);
			const got = S.framePartsRequest(S.HALF_BODY, cut, TRACK, pivots, sources);
			seen.requests = [...(seen.requests ?? []), got.ok ? got.value : got];
			if (!got.ok) return json({ message: got.problem }, 422);
			return json({
				manifestKey: MANIFEST,
				templateId: 'half-body',
				fit: got.value.fit,
				fill: 'cpu',
				parts: SHEET.parts,
				foreshortened: got.value.foreshortened,
				frames: Object.fromEntries(Object.keys(sources).map((part) => [part, 2])),
			});
		}
		if (p === '/api/rigger/new') {
			const body = await readBody(req);
			seen.creates.push(body);
			const parsed = S.parseRigFit(body.fit);
			if ('problem' in parsed) return json({ message: `bad fit: ${parsed.problem}` }, 400);
			const regions = SHEET.regions.filter(
				(r) => body.fit.props?.some((q) => q.name === r.name) || !r.name.startsWith('prop_'),
			);
			made = {
				name: body.name,
				rig: S.templateRig(S.HALF_BODY, regions, parsed.fit),
				atlas: atlasOf(regions),
				fit: parsed.fit,
			};
			return json({
				ok: true,
				dir: Buffer.from(body.name).toString('base64url'),
				stem: body.name,
				atlas_file: `${body.name}.atlas`,
				regions: regions.length,
				template: S.templateReport(made.rig),
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
			if (name === `${made.name}.atlas`) return send(200, 'text/plain', made.atlas);
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
	name: 'frame-rig',
	url: `http://127.0.0.1:${PORT}/`,
	args: ['--window-size=1600,1000'],
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

try {
	await waitFor('typeof rawDoc !== "undefined" && document.getElementById("newRigBtn")', 30000);
	await evaluate(`(() => {
		window.__alerts = []; window.__confirms = [];
		window.alert = (m) => window.__alerts.push(String(m));
		window.confirm = (m) => { window.__confirms.push(String(m)); return true; };
		// No tracker here: the kept cut must open without it.
		ensureRiggerMotion = async () => false;
		document.getElementById("newRigBtn").click();
		return true;
	})()`);
	await waitFor(
		'!!document.querySelector(\'#newRigApply option[value="template:half-body"]\')',
		15000,
	);
	await evaluate(`(() => {
		document.getElementById("newRigApply").value = "template:half-body";
		document.getElementById("newRigName").value = "Taken";
		document.getElementById("newRigFromFrame").click();
		return true;
	})()`);
	await waitFor(
		'document.getElementById("f2rModal").classList.contains("open") && !!document.querySelector(\'#f2rClip option[value="nelly"]\')',
		15000,
	);
	ok(
		'the dialog takes the New-rig name',
		(await evaluate('document.getElementById("f2rName").value')) === 'Taken',
	);
	await evaluate(
		`(() => { const s = document.getElementById("f2rClip"); s.value = "nelly"; s.dispatchEvent(new Event("change")); return true; })()`,
	);
	await waitFor('!!f2r.cut && !!f2r.labels && !f2r.busy', 15000);
	const opened = await evaluate(`({
		sel: f2r.sel, job: f2r.cut.job, parts: document.querySelectorAll("#f2rParts .f2rRow").length,
		props: document.querySelectorAll("#f2rProps input[type=checkbox]").length,
		create: !document.getElementById("f2rCreate").disabled,
		why: document.getElementById("f2rWhy").textContent,
		labels: f2r.labels.length, track: !!f2r.frame && !!f2r.frame.pose,
	})`);
	ok(
		'picking the clip opens its kept cut at once, without the track: its frame, parts, props and joints',
		opened.sel === KEPT &&
			opened.job === CUT.job &&
			opened.parts === CUT.parts.length + 1 &&
			opened.props === CUT.props.length &&
			opened.labels === CUT.size[0] * CUT.size[1] &&
			opened.track &&
			/kept/.test(opened.why),
		q(opened),
	);
	ok('🦴 Create rig is enabled on it', opened.create);
	await shot('frame-rig-dialog.png');

	// The prop editor and per-part frames (F2d): a prop added by the lasso on the left wrist, the
	// chain's bone picked, the glasses removed, the left upper arm taken from frame 2; one 💾.
	const [FW, FH] = CUT.size;
	const wrist = [TRACK.pose.landmarks[16][0] * FW, TRACK.pose.landmarks[16][1] * FH];
	await evaluate(`(() => {
		document.querySelector('#f2rProps button[aria-label="Add a prop"]').click();
		document.getElementById("f2rAddName").value = "Watch!";
		document.querySelector('#f2rProps button[aria-label="Add this prop, then paint it"]').click();
		const lasso = document.getElementById("f2rLasso");
		lasso.checked = true; lasso.dispatchEvent(new Event("change"));
		const cv = document.getElementById("f2rStage"), b = f2rBox(), rect = cv.getBoundingClientRect();
		const to = (x, y) => ({ bubbles: true, clientX: rect.left + (b.x + x * b.k) * rect.width / cv.width, clientY: rect.top + (b.y + y * b.k) * rect.height / cv.height });
		const [x, y] = ${JSON.stringify(wrist)}, r = 9;
		const loop = [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
		cv.dispatchEvent(new MouseEvent("mousedown", to(...loop[0])));
		for (const q of loop.slice(1)) window.dispatchEvent(new MouseEvent("mousemove", to(...q)));
		window.dispatchEvent(new MouseEvent("mouseup", to(...loop[3])));
		const bone = document.querySelector('#f2rProps [data-prop="prop_chain"] select.f2rBone');
		bone.value = "neck"; bone.dispatchEvent(new Event("change"));
		document.querySelector('#f2rProps button[aria-label^="Remove prop_glasses"]').click();
		// No tracker here: the strip the tracking would give, three frames.
		f2r.track = { frames: [0, 1, 2].map(() => JSON.parse(JSON.stringify(f2r.frame))) };
		f2r.scores = { best: 1, rows: [0, 1, 2].map((i) => ({ i, score: 0.9, reasons: [] })) };
		f2r.thumbs = [0, 1, 2].map(() => { const c = document.createElement("canvas"); c.width = c.height = 8; return c; });
		f2rRenderStrip(); f2rRenderCut();
		document.querySelector('#f2rParts [data-part="upper_arm_l"]').click();
		document.getElementById("f2rStrip").children[2].click();
		return true;
	})()`);
	await waitFor('!!(f2r.cut.sources && f2r.cut.sources.upper_arm_l) && !f2r.busy', 15000);
	const shown = await evaluate(`({
		part: document.querySelector('#f2rParts [data-part="upper_arm_l"]').textContent,
		strip: document.getElementById("f2rStrip").children[2].textContent,
		names: f2r.cut.names.slice(),
		save: !document.getElementById("f2rSave").disabled,
	})`);
	ok(
		'the props are edited and a part taken from frame 2 without cutting again; the list and the strip show it',
		/◧ frame 2/.test(shown.part) &&
			shown.strip.startsWith('◧') &&
			shown.names.includes('prop_watch') &&
			!shown.names.includes('prop_glasses') &&
			shown.save &&
			seen.sheets.length === 0,
		q(shown),
	);

	// Parts from other frames shown (F2h). The lasso off, the stage assembles the cut: the upper arm
	// from frame 2's cut, which draws it SHIFT px right with its colours inverted.
	await evaluate(
		`(() => { const l = document.getElementById("f2rLasso"); l.checked = false; l.dispatchEvent(new Event("change")); return true; })()`,
	);
	await waitFor('!!f2rComposite()', 15000);
	const asm = await evaluate(`(() => {
		const c = f2rComposite(), [w, h] = f2r.cut.size, out = c.getContext("2d").getImageData(0, 0, w, h).data;
		const main = f2rPixels(f2r.frameImg, w, h), L = f2r.labels;
		const arm = f2r.cut.names.indexOf("upper_arm_l"), torso = f2r.cut.names.indexOf("torso");
		const inside = (i, v, r) => {
			const x = i % w, y = (i / w) | 0;
			for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++){
				const xx = x + dx, yy = y + dy;
				if (xx < 0 || yy < 0 || xx >= w || yy >= h || L[yy * w + xx] !== v) return false;
			}
			return true;
		};
		const off = (i, inv) => Math.max(...[0, 1, 2].map((k) => Math.abs(out[i * 4 + k] - (inv ? 255 - main[i * 4 + k] : main[i * 4 + k]))));
		const col = f2rColourOf(f2rLends(), 2), rgb = [1, 3, 5].map((k) => parseInt(col.slice(k, k + 2), 16));
		const n = { arm: 0, armOk: 0, torso: 0, torsoOk: 0, edge: 0, edgeOk: 0 };
		const rim = (i) => [i - 1, i + 1, i - w, i + w].some((j) => L[j] !== arm);
		for (let i = 0; i < L.length; i++){
			if (L[i] === arm && rim(i)){ n.edge++; if ([0, 1, 2].every((k) => out[i * 4 + k] === rgb[k])) n.edgeOk++; }
			if (main[i * 4 + 3] !== 255) continue;
			if (L[i] === arm && inside(i, arm, 3)){ n.arm++; if (off(i, true) <= 2) n.armOk++; }
			if (L[i] === torso && inside(i, torso, 3)){ n.torso++; if (off(i, false) <= 2) n.torsoOk++; }
		}
		// A stage pixel inside the arm, away from its tag: the assembled stage, then ▣ This frame.
		const cen = f2r.centres.upper_arm_l;
		let best = -1, far = -1;
		for (let i = 0; i < L.length; i++){
			if (L[i] !== arm || main[i * 4 + 3] !== 255 || !inside(i, arm, 4)) continue;
			const d = Math.hypot((i % w) - cen[0], ((i / w) | 0) - cen[1]);
			if (d > far){ far = d; best = i; }
		}
		const g = document.getElementById("f2rStage").getContext("2d");
		const read = () => { const b = f2rBox(); return [...g.getImageData(Math.floor(b.x + ((best % w) + 0.5) * b.k), Math.floor(b.y + (((best / w) | 0) + 0.5) * b.k), 1, 1).data]; };
		const inv = [0, 1, 2].map((k) => 255 - main[best * 4 + k]);
		const dist = (p) => Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - inv[k])));
		f2rDraw();
		const shown = { assembled: f2rAssembled(), active: document.querySelector("#f2rView button.active").dataset.view, off: dist(read()) };
		document.querySelector('#f2rView button[data-view="frame"]').click();
		const flat = { assembled: f2rAssembled(), active: document.querySelector("#f2rView button.active").dataset.view, off: dist(read()) };
		document.querySelector('#f2rView button[data-view="assembled"]').click();
		return { n, shown, flat, back: f2rAssembled() };
	})()`);
	ok(
		"the stage assembles the cut: the upper arm's pixels from frame 2's cut where this frame draws it, the rest this frame's, outlined in frame 2's colour",
		asm.n.arm > 200 &&
			asm.n.armOk === asm.n.arm &&
			asm.n.torso > 500 &&
			asm.n.torsoOk === asm.n.torso &&
			asm.n.edgeOk / asm.n.edge > 0.95 &&
			asm.shown.assembled &&
			asm.shown.active === 'assembled' &&
			asm.shown.off <= 30,
		q(asm),
	);
	ok(
		'▣ This frame shows the picked frame, ◧ Assembled the cut again',
		!asm.flat.assembled && asm.flat.active === 'frame' && asm.flat.off > 60 && asm.back,
		q(asm),
	);
	// Frame 2 drawing that upper arm 1.5 times as long: the elbow, the forearm and the hand move out
	// along this frame's arm by the half it gains; the torso and the arm's own joint stay.
	const chain = await evaluate(`(() => {
		const S = f2r.sourceCuts[${q(OTHER)}].data, keep = S.segs, segs = JSON.parse(JSON.stringify(keep));
		const [a, b] = segs.seg.upper_arm_l;
		segs.seg.upper_arm_l = [a, [a[0] + (b[0] - a[0]) * 1.5, a[1] + (b[1] - a[1]) * 1.5]];
		S.segs = segs;
		const asm = f2rAssembly();
		S.segs = keep;
		const [w, h] = f2r.cut.size, m = f2rSegments(f2r.frame, w, h).seg.upper_arm_l;
		return { fore: asm.lower_arm_l.d, hand: asm.hand_l.d, arm: asm.upper_arm_l.d, torso: asm.torso.d, want: [(m[1][0] - m[0][0]) / 2, (m[1][1] - m[0][1]) / 2] };
	})()`);
	const at = (p, w) => Math.hypot(p[0] - w[0], p[1] - w[1]) < 0.01;
	ok(
		'an arm segment from another frame keeps its own length: the joints down the arm move out with it, nothing else',
		at(chain.fore, chain.want) &&
			at(chain.hand, chain.want) &&
			at(chain.arm, [0, 0]) &&
			at(chain.torso, [0, 0]) &&
			Math.hypot(...chain.want) > 10,
		q(chain),
	);
	const marks = await evaluate(`(() => {
		const css = (c) => { const s = document.createElement("i").style; s.borderColor = c; return s.borderColor; };
		const chip = (p) => document.querySelector('#f2rParts [data-part="' + p + '"] button.f2rSrc');
		const strip = [...document.getElementById("f2rStrip").children];
		const colour = css(f2rColourOf(f2rLends(), 2));
		return {
			colour,
			arm: { text: chip("upper_arm_l").textContent, border: chip("upper_arm_l").style.borderColor, thumb: !!chip("upper_arm_l").querySelector("canvas") },
			head: { text: chip("head").textContent, border: chip("head").style.borderColor },
			badges: strip.map((d) => [...d.querySelectorAll(".f2rBadge i")].map((s) => s.dataset.part + " " + s.style.background)),
			border: strip[2].style.borderColor,
		};
	})()`);
	ok(
		"the Parts row shows the frame a part is cut from: frame 2's thumbnail and number in frame 2's colour, the rest this frame's",
		marks.arm.text === '2' &&
			marks.arm.border === marks.colour &&
			marks.arm.thumb &&
			marks.head.text === String(KEPT) &&
			marks.head.border === '',
		q(marks),
	);
	ok(
		"the strip marks frame 2 with the upper arm's colour, round it frame 2's own; no other frame",
		q(marks.badges) === q([[], [], ['upper_arm_l rgb(60, 220, 60)']]) &&
			marks.border === marks.colour,
		q(marks),
	);
	await shot('frame-rig-editor.png');
	await evaluate('document.getElementById("f2rSave").click(); true');
	await waitFor('document.getElementById("f2rSave").disabled && !f2r.busy', 15000);
	const kept1 = seen.edits[0];
	const names = CUT.names.filter((n) => n !== 'prop_glasses').concat('prop_watch');
	const raw = kept1?.labels
		? new Uint8Array(
				await sharpOf(Buffer.from(kept1.labels.split(',')[1], 'base64'))
					.extractChannel(0)
					.raw()
					.toBuffer(),
			)
		: new Uint8Array();
	const was = CUT.names.indexOf('prop_glasses');
	const nParts = CUT.parts.length;
	let given = 0;
	let back = 0;
	raw.forEach((v, i) => {
		if (LABELS.data[i] === was) {
			given++;
			if (v < nParts) back++;
		}
	});
	const watchPx = raw.filter((v) => v === names.indexOf('prop_watch')).length;
	const watchProp = kept1?.props.find((x) => x.name === 'prop_watch');
	ok(
		'💾 keeps it in one edit: the names without the removed prop and with the new one, the new one on the part it was painted over, the chain on the bone picked, the part from frame 2',
		q(kept1?.names) === q(names) &&
			CUT.parts.some((x) => x.name === watchProp?.host) &&
			kept1.props.find((x) => x.name === 'prop_chain')?.bone === 'neck' &&
			kept1.sources?.upper_arm_l === OTHER &&
			Object.entries(kept1.sources).every(([n, j]) => n === 'upper_arm_l' || j === null),
		q(kept1 && { names: kept1.names, props: kept1.props, sources: kept1.sources }),
	);
	ok(
		'… with the label map: the new prop painted, the removed one given back to the parts under it',
		watchPx > 50 && given > 0 && back === given && raw.every((v) => v === 255 || v < names.length),
		q({ watchPx, given, back }),
	);
	ok(
		'… and the page takes the kept cut back (nothing left to keep)',
		(await evaluate(
			'document.getElementById("f2rSave").disabled && f2r.cut.props.every((p) => !p.added) && f2r.cut.sources.upper_arm_l === ' +
				q(OTHER),
		)) === true,
	);

	// A taken name: the sheet's 409 is said, the dialog stays open with the cut.
	await evaluate('document.getElementById("f2rCreate").click(); true');
	await waitFor('document.getElementById("alertModal").classList.contains("open")', 15000);
	ok(
		'a taken rig name says so; the dialog stays open, the cut still there',
		(await evaluate(
			'/already in use|already exists/.test(document.getElementById("alertMsg").textContent) && document.getElementById("f2rModal").classList.contains("open") && !!f2r.cut',
		)) && seen.creates.length === 0,
		await evaluate('document.getElementById("alertMsg").textContent'),
	);
	await evaluate('closeAlert(); true');

	// Each part's best frame (F2g): the shipped scorer as the tracker's bundle exports it, on a track
	// whose frames 0 and 1 (the cut's) draw the right forearm toward the camera and frame 2 draws it
	// whole. Before the cut the Parts list plans it from frame 2; a fresh cut takes it from there.
	const scorer = (
		await esbuild.build({
			entryPoints: [join(APP, 'src/lib/rigFrameScore.ts')],
			bundle: true,
			format: 'iife',
			globalName: '__score',
			write: false,
			logLevel: 'error',
		})
	).outputFiles[0].text;
	await evaluate(
		`(() => { ${scorer}; window.RiggerMotion = { bestPartFrames: __score.bestPartFrames, scoreParts: __score.scoreParts }; return true; })()`,
	);
	const bestOf = await evaluate(`(async () => {
		const keep = { track: f2r.track, sources: f2r.cut.sources, dirty: f2r.sourcesDirty, cut: f2r.cut };
		const state = ["cut", "labels", "frameImg", "overlay", "saved", "brushDirty", "propsDirty", "namesDirty", "sourcesDirty", "moved"];
		const kept = Object.fromEntries(state.map((k) => [k, f2r[k]]));
		const [W, H] = ${JSON.stringify(CUT.size)};
		const whole = JSON.parse(JSON.stringify(f2r.frame));
		whole.pose.world = whole.pose.landmarks.map((p) => [((p[0] - 0.5) * W) / 100, ((p[1] - 0.5) * H) / 100, 0]);
		const short = JSON.parse(JSON.stringify(whole));
		const [e, w] = [short.pose.landmarks[13], short.pose.landmarks[15]];
		short.pose.landmarks[15] = [e[0] + (w[0] - e[0]) * 0.3, e[1] + (w[1] - e[1]) * 0.3, w[2]];
		f2r.track = { width: W, height: H, frames: [short, short, whole] };
		f2r.plan = f2rPlanFor(f2r.sel);
		const rows = () => Object.fromEntries([...document.querySelectorAll("#f2rParts .f2rRow.part")].map((d) => [d.dataset.part, d.textContent]));
		f2r.cut = null; f2rRenderCut();
		const before = rows();
		const head = document.querySelector("#f2rParts .f2rRow").title;
		f2r.cut = keep.cut; f2r.cut.sources = {}; f2rRenderCut();
		const atCut = rows();
		f2r.cut.sources = keep.sources;
		// ✂ Cut: the frame cut again (a fresh cut, no part picked by hand), then the plan taken.
		document.getElementById("f2rCut").click();
		await new Promise((done) => { const t = setInterval(() => { if (!f2r.busy && f2r.cut !== keep.cut){ clearInterval(t); done(); } }, 20); });
		await new Promise((done) => { const t = setInterval(() => { if (!f2r.busy && /best frames/.test(document.getElementById("f2rNote").textContent)){ clearInterval(t); done(); } }, 20); setTimeout(done, 5000); });
		const after = rows();
		const sources = { ...(f2r.cut.sources || {}) };
		const note = document.getElementById("f2rNote").textContent;
		Object.assign(f2r, kept, { track: keep.track, plan: null });
		f2rBuildOverlay(); f2rRenderStrip(); f2rRenderCut(); f2rDraw();
		return { before, atCut, after, sources, note, head, tip: document.querySelector("#f2rModal b[title]").title };
	})()`);
	ok(
		'before the cut the Parts list plans each part: the forearm drawn short here from frame 2, scored, the rest from this frame',
		/◧ frame 2 · 1\.00/.test(bestOf.before.lower_arm_r ?? '') &&
			/^head · frame 1 · /.test(bestOf.before.head ?? '') &&
			/taken with the head/.test(bestOf.before.neck ?? '') &&
			/shows it best/.test(bestOf.head),
		q(bestOf.before),
	);
	ok(
		'on the cut the list says why this frame scores the forearm low',
		/frame 1 · 0\.30.*at 0\.30 of its length/.test(bestOf.atCut.lower_arm_r ?? ''),
		q(bestOf.atCut.lower_arm_r),
	);
	ok(
		"✂ Cut cuts this frame, then takes the forearm from frame 2's kept cut, and only it; the list and the note say so",
		seen.cuts.length === 1 &&
			seen.cuts[0].frame === KEPT &&
			bestOf.sources.lower_arm_r === OTHER &&
			Object.keys(bestOf.sources).length === 1 &&
			/◧ frame 2 · 1\.00/.test(bestOf.after.lower_arm_r ?? '') &&
			/lower_arm_r from their best frames/.test(bestOf.note),
		q({
			cuts: seen.cuts.length,
			sources: bestOf.sources,
			row: bestOf.after.lower_arm_r,
			note: bestOf.note,
		}),
	);
	ok(
		"the dialog's tooltip gives the quick way first",
		/^The quick way: pick the clip, ✂ Cut, 🦴 Create rig\./.test(bestOf.tip),
		bestOf.tip.slice(0, 80),
	);

	// Picking a part's frame (F2h), on the kept cut with the same track: ★ offers the plan's frame for
	// the forearm; its chip starts the pick, the strip shows the forearm's score under each frame; Esc
	// stops; frame 2 takes it; this frame takes it back. Then the cut is put back as it was.
	const PICK = `
		const row = () => document.querySelector('#f2rParts [data-part="lower_arm_r"]');
		const strip = () => [...document.getElementById("f2rStrip").children];
		const bar = () => document.getElementById("f2rPickBar").classList.contains("on");`;
	const picked = {};
	Object.assign(
		picked,
		await evaluate(`(() => {
		window.__pickKeep = { track: f2r.track, plan: f2r.plan, sources: { ...f2r.cut.sources }, dirty: f2r.sourcesDirty };
		const [W, H] = ${JSON.stringify(CUT.size)};
		const whole = JSON.parse(JSON.stringify(f2r.frame));
		whole.pose.world = whole.pose.landmarks.map((p) => [((p[0] - 0.5) * W) / 100, ((p[1] - 0.5) * H) / 100, 0]);
		const short = JSON.parse(JSON.stringify(whole));
		const [e, w] = [short.pose.landmarks[13], short.pose.landmarks[15]];
		short.pose.landmarks[15] = [e[0] + (w[0] - e[0]) * 0.3, e[1] + (w[1] - e[1]) * 0.3, w[2]];
		f2r.track = { width: W, height: H, frames: [short, short, whole] };
		f2r.plan = f2rPlanFor(f2r.sel);
		f2rRenderStrip(); f2rRenderCut(); f2rDraw();${PICK}
		const star = row().querySelector("button.f2rBest");
		const offered = { star: star ? star.textContent : null, all: !!document.querySelector('#f2rParts .f2rRow:not(.part) button[aria-label^="Take lower_arm_r"]') };
		row().querySelector("button.f2rSrc").click();
		const during = {
			row: row().classList.contains("pick"), bar: bar(), text: document.getElementById("f2rPickText").textContent,
			scores: strip().map((d) => d.querySelector("b").textContent), cand: strip().map((d) => d.classList.contains("cand")),
		};
		return { offered, during };
	})()`),
	);
	ok(
		'on a kept cut ★ offers the frame the plan takes the forearm from, on its row and for every such part',
		picked.offered.star === '★ 2' && picked.offered.all,
		q(picked.offered),
	);
	ok(
		"a part's frame chip starts the pick: its row lit, the status line says so, the strip shows that part's score under each frame and lights the best",
		picked.during.row &&
			picked.during.bar &&
			/lower_arm_r/.test(picked.during.text) &&
			q(picked.during.scores) === q(['0.30', '▣ 0.30', '1.00']) &&
			q(picked.during.cand) === q([false, false, true]),
		q(picked.during),
	);
	picked.esc = await evaluate(`(() => {${PICK}
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		return { pickFor: f2r.pickFor, bar: bar(), open: document.getElementById("f2rModal").classList.contains("open"), taken: !!(f2r.cut && f2r.cut.sources && f2r.cut.sources.lower_arm_r), scores: strip().map((d) => d.querySelector("b").textContent) };
	})()`);
	ok(
		'Esc stops picking, takes nothing and leaves the dialog open',
		picked.esc.pickFor === null &&
			!picked.esc.bar &&
			picked.esc.open &&
			!picked.esc.taken &&
			!picked.esc.scores.includes('1.00'),
		q(picked.esc),
	);
	Object.assign(
		picked,
		await evaluate(`(async () => {${PICK}
		row().querySelector("button.f2rSrc").click();
		strip()[2].click();
		await new Promise((done) => { const t = setInterval(() => { if (!f2r.busy){ clearInterval(t); done(); } }, 20); });
		const taken = {
			job: f2r.cut.sources.lower_arm_r || null, bar: bar(), row: row().textContent, chip: row().querySelector("button.f2rSrc").textContent,
			badge: [...strip()[2].querySelectorAll(".f2rBadge i")].map((s) => s.dataset.part), star: !!row().querySelector("button.f2rBest"),
		};
		row().querySelector("button.f2rSrc").click();
		strip()[${KEPT}].click();
		const back = { job: f2r.cut.sources.lower_arm_r || null, row: row().textContent, chip: row().querySelector("button.f2rSrc").textContent };
		const keep = window.__pickKeep;
		Object.assign(f2r, { track: keep.track, plan: keep.plan, sourcesDirty: keep.dirty, composite: null });
		f2r.cut.sources = keep.sources;
		f2rRenderStrip(); f2rRenderCut(); f2rDraw();
		return { taken, back };
	})()`),
	);
	ok(
		"a frame clicked in the strip takes the part from it: the row, its chip and the strip's badge say so",
		picked.taken.job === OTHER &&
			!picked.taken.bar &&
			/◧ frame 2/.test(picked.taken.row) &&
			picked.taken.chip === '2' &&
			picked.taken.badge.includes('lower_arm_r') &&
			picked.taken.badge.includes('upper_arm_l') &&
			!picked.taken.star,
		q(picked.taken),
	);
	ok(
		'this frame clicked takes it back',
		picked.back.job === null &&
			/frame 1 · /.test(picked.back.row) &&
			picked.back.chip === String(KEPT),
		q(picked.back),
	);

	// A prop ticked ✗, a new name, Create: the touch-up is kept first, the sheet asked on its ETag.
	await evaluate(`(() => {
		const row = [...document.querySelectorAll("#f2rProps .f2rRow")].find((d) => d.textContent.includes("prop_earring_l"));
		const cb = row.querySelector("input[type=checkbox]"); cb.checked = false; cb.dispatchEvent(new Event("change"));
		document.getElementById("f2rName").value = "Nelly";
		document.getElementById("f2rCreate").click();
		return true;
	})()`);
	await waitFor(
		'!document.getElementById("f2rModal").classList.contains("open") && document.getElementById("alertModal").classList.contains("open")',
		30000,
	);
	const sheet = seen.sheets[1];
	const create = seen.creates[0];
	ok(
		'the ✗ prop is kept with the cut first, and the sheet asked for on the ETag that keep answered',
		seen.edits.length === 2 &&
			seen.edits[1].props.find((x) => x.name === 'prop_earring_l')?.take === false &&
			sheet?.etag === '"e3"' &&
			sheet.job === CUT.job &&
			sheet.name === 'Nelly',
		q({ edits: seen.edits.map((e) => e.props), sheet }),
	);
	ok(
		'the create names the cut it was made from, which the rig remembers (✂ Edit cut, F2j)',
		create?.frame?.job === CUT.job,
		q(create?.frame),
	);
	ok(
		"the rig is created from the sheet with the template and the fit: the frame's pose, the taken props only",
		create?.manifestKey === MANIFEST &&
			create.name === 'Nelly' &&
			create.templateId === 'half-body' &&
			Object.keys(create.fit.frame ?? {}).includes('upper_arm_l') &&
			create.fit.props
				.map((x) => x.name)
				.sort()
				.join() === 'prop_chain,prop_watch,prop_wrist_r' &&
			create.fit.props.find((x) => x.name === 'prop_chain')?.bone === 'neck' &&
			create.fit.props.every((x) => Array.isArray(x.at)),
		q(create && { manifestKey: create.manifestKey, props: create.fit.props?.map((x) => x.name) }),
	);
	await waitFor(
		'!!skeleton && skeleton.data.name !== undefined && !!rawDoc && !!rawDoc.animations',
		30000,
	);
	const rig = await evaluate(`(() => {
		const has = (slot) => { const s = skeleton.findSlot(slot); return !!(s && s.getAttachment()); };
		return {
			frame: !!rawDoc.animations.frame,
			parts: ${q(CUT.names.filter((n) => !n.startsWith('prop_')))}.filter(has).length,
			chain: has("prop_chain"),
			earring: !!skeleton.findSlot("prop_earring_l"),
		};
	})()`);
	ok(
		'the made rig opens: its frame clip, every cut part attached, the taken props on slots of their own',
		rig.frame &&
			rig.parts === CUT.names.filter((n) => !n.startsWith('prop_')).length &&
			rig.chain &&
			!rig.earring,
		q(rig),
	);
	const report = await evaluate('document.getElementById("alertMsg").textContent');
	ok(
		'the report names the frame and the sheet, what the CPU filled and the parts no frame makes',
		/made from frame 1 of NellyAnimTest/.test(report) &&
			/Nelly_parts/.test(report) &&
			/filled on the CPU/.test(report) &&
			/torso \d/.test(report) &&
			/mouth_rest/.test(report) &&
			/upper_arm_l from frame 2/.test(report),
		report,
	);
	const planned = seen.requests?.at(-1);
	const fromThere = planned?.parts?.find((x) => x.name === 'upper_arm_l');
	ok(
		'the rig is made with the upper arm read off frame 2’s cut and the new prop on a bone of its own',
		fromThere?.source?.job === OTHER &&
			planned.parts.some((x) => x.name === 'prop_watch' && !x.source) &&
			planned.parts.filter((x) => x.source).length === 1,
		q(planned?.parts?.map((x) => [x.name, x.source?.job ?? ''])),
	);
	await shot('frame-rig-report.png');
	await evaluate('closeAlert(); true');
	await shot('frame-rig-opened.png');

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
			'JSON.stringify({ note: document.getElementById("f2rNote").textContent, why: document.getElementById("f2rWhy").textContent, cut: !!f2r.cut, busy: f2r.busy, alert: document.getElementById("alertMsg").textContent })',
		).catch((x) => String(x)),
	);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(
	`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — frame to rig, Create rig ${pass}/${pass + fail}`,
);
process.exit(fail === 0 ? 0 : 1);
