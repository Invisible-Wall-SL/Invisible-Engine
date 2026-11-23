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
//  - a taken rig name (the sheet's 409) says so and leaves the dialog open, the cut still there;
//  - the page threw nothing.
//   node tools/rigger-spike/frame-rig-browser.mjs [--png <dir>]   (--png: the dialog, the report, the rig)
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
const html = readFileSync(join(STATIC, 'rigger/view.html'), 'utf8');

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
										frame: '/fx/frame.png',
										labels: '/fx/labels.png',
										overlay: '/fx/frame.png',
										track: '/fx/track.json',
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
