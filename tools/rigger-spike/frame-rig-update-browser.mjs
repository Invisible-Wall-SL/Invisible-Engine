// Browser gate for frame to rig's ✂ Edit cut and 🔄 Update rig (docs/design/frame-to-rig.md §12 F2j),
// on the SHIPPED view.html in a real Chromium against a fake launcher API that answers as the routes
// do with the shipped code: the rig is 🦴 Create rig's of atlas-tool's committed fixture cut
// (`framePartsRequest`, `templateRig`, `frameSourceOf`), the author has since keyed it in a clip of
// their own and dragged a vertex of the left hand's mesh, and `/api/rigger/from-frame/update` merges
// with `updateFrameRig`. The merge itself is `frame-rig-update.mjs`'s; this is the page around it.
// Checked:
//  - a frame-made rig shows ✂ Edit cut in its panel; a rig posed by a `frame` clip from before rigs
//    remembered their cut offers to find it, and links it; a rig not made from a frame shows none;
//  - ✂ opens the dialog on the rig's OWN cut (not the newest cut of its frame), with its clip fixed,
//    no rig name, and 🔄 Update rig in 🦴 Create rig's place;
//  - the cut re-edited — a prop removed, the upper arm taken from frame 2 — then 🔄 Update rig: the
//    touch-ups kept first, the parts made on the rig's other sheet, the merge asked of the open rig as
//    the page holds it, the hand-edited mesh offered and kept, the removed prop's keys named before it
//    goes, and the answer taken as ONE undo step drawn with the new sheet's art;
//  - the update saved through 💾's path with the rig's source on its ETag, which then follows the save;
//  - ↶ puts back the rig, its source and its art; ↷ the update; a save after ↶ sends the old source;
//  - the page threw nothing.
//   node tools/rigger-spike/frame-rig-update-browser.mjs [--png <dir>]
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
const out = join(mkdtempSync(join(tmpdir(), 'frame-rig-update-browser-')), 'server.mjs');
await esbuild.build({
	stdin: {
		contents: [
			"export * from './rigTemplates.ts';",
			"export * from './rigTemplateFit.ts';",
			"export * from './rigFrameFit.ts';",
			"export * from './rigCutEdits.ts';",
			"export * from './rigFrameUpdate.ts';",
			"export { frameSourceProblems } from '../rigFrameSource.ts';",
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
const sharp = createRequire(join(APP, 'package.json'))('sharp');

const read = (p) => JSON.parse(readFileSync(join(FIX, p), 'utf8'));
const CUT = { ...read('parts/cut.json'), clip: { id: 'nelly', frame: 1 } };
const TRACK = read('track.json');
const SHEET = read('parts/sheet.json');
const SHEET_PNG = readFileSync(join(FIX, 'parts/sheet.png'));
const LABELS = await sharp(join(FIX, 'parts/labels.png'))
	.extractChannel(0)
	.raw()
	.toBuffer({ resolveWithObject: true });
const PAGE_RAW = await sharp(SHEET_PNG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
// The new sheet: the same parts with their colours inverted, so the page can be seen drawing from it.
const SHEET_B_PNG = await sharp(
	Buffer.from(PAGE_RAW.data.map((v, i) => (i % 4 === 3 ? v : 255 - v))),
	{ raw: { width: PAGE_RAW.info.width, height: PAGE_RAW.info.height, channels: 4 } },
)
	.png()
	.toBuffer();
const CLIP = {
	id: 'nelly',
	name: 'NellyAnimTest',
	assetKey: 'c/p/manifests/atlas_manifest_Nelly.json',
	frames: ['f0', 'f1', 'f2'],
};
const KEPT = 1;
const OTHER = 'f2r-fixture-0002';
const NEWER = 'f2r-fixture-0003';
const A = 'c/p/manifests/atlas_manifest_Nelly_parts.json';
const B = 'c/p/manifests/atlas_manifest_Nelly_parts_b.json';
const REMOVED = 'prop_glasses';
const EDITED = 'hand_l';

const atlasOf = (page, regions) =>
	[
		page,
		`size:${SHEET.width},${SHEET.height}`,
		'filter:Linear,Linear',
		...regions.flatMap((r) => [r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`]),
	].join('\n') + '\n';
const alphas = (regions) => {
	const m = new Map();
	for (const r of regions) {
		const data = new Uint8Array(r.w * r.h);
		for (let y = 0; y < r.h; y++)
			for (let x = 0; x < r.w; x++)
				data[y * r.w + x] = PAGE_RAW.data[((r.y + y) * PAGE_RAW.info.width + r.x + x) * 4 + 3];
		m.set(r.name, { data, w: r.w, h: r.h });
	}
	return m;
};
const skinOf = (doc) => doc.skins.find((s) => s.name === 'default') ?? doc.skins[0];
const slotOf = (doc, name) =>
	Object.entries(skinOf(doc).attachments).find(([, by]) => by[name])?.[0];

// ---- the rigs in the project -----------------------------------------------------------------------
const made = (() => {
	const r = S.framePartsRequest(
		S.HALF_BODY,
		CUT,
		TRACK,
		S.propPivots(new Uint8Array(LABELS.data), LABELS.info.width, CUT),
		{},
	);
	const rig = S.templateRig(S.HALF_BODY, SHEET.regions, r.value.fit);
	const names = S.madeAttachments(rig.skeleton).map((a) => a.name);
	const source = S.frameSourceOf({
		rig: 'Nelly',
		template: rig.ref,
		cut: CUT,
		cutEtag: '"c1"',
		frames: {},
		parts: S.madeParts(rig.skeleton, names),
		art: A,
		artRevision: 'rev-a',
	});
	// The author's work since: a clip keying the arm and the glasses' bone, a vertex of the hand dragged.
	const doc = structuredClone(rig.skeleton);
	doc.animations.wave = {
		bones: {
			upper_arm_l: { rotate: [{ value: 0 }, { time: 1, value: 30 }] },
			[REMOVED]: { rotate: [{ value: 0 }, { time: 1, value: 12 }] },
		},
	};
	skinOf(doc).attachments[slotOf(doc, EDITED)][EDITED].vertices[2] += 6;
	return { doc, source, fit: r.value.fit };
})();
const rigs = {
	Nelly: {
		doc: made.doc,
		etag: '"r1"',
		frame: { doc: { ...made.source, irig: 'mark' }, etag: '"f1"' },
		atlas: atlasOf('Nelly_parts.png', SHEET.regions),
		page: 'Nelly_parts.png',
	},
	Old: {
		doc: structuredClone(made.doc),
		etag: '"o1"',
		frame: null,
		atlas: atlasOf('Old_parts.png', SHEET.regions),
		page: 'Old_parts.png',
	},
	Plain: {
		doc: (() => {
			const d = structuredClone(made.doc);
			delete d.animations.frame;
			return d;
		})(),
		etag: '"p1"',
		frame: null,
		atlas: atlasOf('Plain.png', SHEET.regions),
		page: 'Plain.png',
	},
};
const cutOf = (job, frame) => ({
	...CUT,
	job,
	clip: { id: CLIP.id, frame },
	root: `c/p/rig-from-frame/${job}`,
	clipId: CLIP.id,
	frame,
	etag: job === CUT.job ? etag : `"${job}"`,
	saved: Date.parse(job === NEWER ? '2026-11-24T09:00:00Z' : '2026-11-22T09:00:00Z'),
	urls: {
		frame: '/fx/frame.png',
		labels: '/fx/labels.png',
		overlay: '/fx/frame.png',
		track: '/fx/track.json',
	},
});
const seen = { edits: [], sheets: [], updates: [], saves: [], links: [] };
const sheetRevs = new Map();
let etag = '"c1"';
let kept = structuredClone(CUT);
let labelsNow = new Uint8Array(LABELS.data);

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
const stemOf = (url) => Buffer.from(url.searchParams.get('dir') ?? '', 'base64url').toString();
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
		if (p === '/fx/sheet-b.png') return send(200, 'image/png', SHEET_B_PNG);
		if (p === '/api/rigger/templates') return json({ templates: S.rigTemplateList() });
		if (p === '/api/editor/flipbooks') return json({ clips: [CLIP] });
		if (p === '/api/rigger/from-frame' && req.method === 'GET') {
			const job = url.searchParams.get('job');
			if (job !== null)
				return json({
					cut:
						job === CUT.job
							? { ...cutOf(CUT.job, KEPT), ...kept, etag }
							: job === OTHER
								? cutOf(OTHER, 2)
								: null,
				});
			// The newest cut of the rig's frame is another one, cut since: ✂ Edit cut must not open it.
			return json({ cuts: [cutOf(NEWER, KEPT), cutOf(OTHER, 2)] });
		}
		if (p === '/api/rigger/from-frame/edits') {
			const body = await readBody(req);
			seen.edits.push(body);
			if (body.etag !== etag) return json({ error: 'changed' }, 409);
			const applied = S.applyCutEdits(kept, body, S.HALF_BODY, typeof body.labels === 'string');
			if (!applied.ok) return json({ error: applied.message }, applied.status);
			const next = applied.value.cut;
			if (typeof body.labels === 'string') {
				const png = Buffer.from(body.labels.split(',')[1], 'base64');
				labelsNow = new Uint8Array(await sharp(png).extractChannel(0).raw().toBuffer());
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
			if (body.etag !== etag) return json({ message: 'The cut changed since it was opened.' }, 409);
			if (!body.rig) return json({ message: 'this fake only updates' }, 400);
			const sources = Object.fromEntries(
				Object.entries(kept.sources ?? {}).map(([part, job]) => [
					part,
					{ job, cut: CUT, track: TRACK },
				]),
			);
			const got = S.framePartsRequest(
				S.HALF_BODY,
				kept,
				TRACK,
				S.propPivots(labelsNow, LABELS.info.width, kept),
				sources,
			);
			if (!got.ok) return json({ message: got.problem }, 422);
			// The rig's sheet its bundle is not drawn from, made again: a revision of its own each time.
			const idle = (rigs[body.rig.stem].frame?.doc.art ?? A) === A ? B : A;
			sheetRevs.set(idle, `rev-${seen.sheets.length + 1}`);
			return json({
				manifestKey: idle,
				templateId: 'half-body',
				fit: got.value.fit,
				fill: 'cpu',
				parts: SHEET.parts,
				frames: { upper_arm_l: 2 },
			});
		}
		if (p === '/api/rigger/from-frame/update') {
			const body = await readBody(req);
			seen.updates.push(body);
			const problems = S.frameSourceProblems(body.source);
			if (problems.length) return json({ message: problems.join('; ') }, 400);
			const parsed = S.parseRigFit(body.fit);
			if ('problem' in parsed) return json({ message: parsed.problem }, 400);
			const names = new Set([
				...kept.parts.map((x) => x.name),
				...kept.props.filter((x) => x.take !== false).map((x) => x.name),
			]);
			const regions = SHEET.regions.filter((r) => names.has(r.name));
			const result = S.updateFrameRig({
				template: S.HALF_BODY,
				regions,
				fit: parsed.fit,
				current: body.skeleton,
				made: body.source,
				props: kept.props,
				keep: new Set(body.keep ?? []),
				outlines: { before: alphas(SHEET.regions), after: alphas(regions) },
			});
			const source = S.frameSourceOf({
				rig: body.stem,
				template: { id: 'half-body', version: S.HALF_BODY.version },
				cut: kept,
				cutEtag: etag,
				frames: { upper_arm_l: 2 },
				parts: result.parts,
				art: body.manifestKey,
				artRevision: sheetRevs.get(body.manifestKey),
			});
			return json({
				ok: true,
				skeleton: result.doc,
				source,
				report: result.report,
				frames: { upper_arm_l: 2 },
				atlas: {
					text: atlasOf('Nelly_parts_b.png', regions),
					page: `/fx/sheet-b.png?${source.artRevision}`,
				},
			});
		}
		if (p === '/api/rigger/from-frame/link') {
			const stem = req.method === 'GET' ? url.searchParams.get('stem') : (await readBody(req)).stem;
			if (stem !== 'Old')
				return json({ found: null, why: 'it was not made from a frame', frameMade: false });
			if (req.method === 'GET')
				return json({ found: { job: CUT.job, clip: CLIP.id, frame: KEPT } });
			seen.links.push(stem);
			const doc = { ...made.source, rig: 'Old', linked: true };
			rigs.Old.frame = { doc, etag: '"l1"' };
			return json({ ok: true, doc, etag: '"l1"' });
		}
		if (p === '/rig-viewer/skeletons')
			return json({
				client: 'c',
				project: 'p',
				root: 'c/p/spines',
				skeletons: Object.keys(rigs).map((name, id) => ({
					id,
					name,
					folder: name,
					dir_b64: Buffer.from(name).toString('base64url'),
					skeleton_file: `${name}.irig`,
					atlas_file: `${name}.atlas`,
					format: 'json',
					runtime: '4.2',
					version: '4.2',
					pma: false,
				})),
			});
		if (p === '/rig-viewer/file') {
			const rig = rigs[stemOf(url)];
			const name = url.searchParams.get('name');
			if (!rig) return send(404, 'text/plain', 'no such rig');
			if (name.endsWith('.irig')) return json(rig.doc);
			if (name.endsWith('.atlas')) return send(200, 'text/plain', rig.atlas);
			if (name === rig.page) return send(200, 'image/png', SHEET_PNG);
			return send(404, 'text/plain', 'no such file');
		}
		if (p === '/api/rigger/template')
			return json({
				template: S.rigTemplateFromSidecar(
					JSON.stringify({ id: 'half-body', version: S.HALF_BODY.version, fit: made.fit }),
				),
			});
		if (p === '/api/rigger/save' && req.method === 'GET') {
			const rig = rigs[url.searchParams.get('stem')];
			return json({
				ok: true,
				projectKey: 'p',
				etag: rig?.etag ?? null,
				frame: rig?.frame ?? null,
			});
		}
		if (p === '/api/rigger/save' && req.method === 'POST') {
			const body = await readBody(req);
			seen.saves.push(body);
			const rig = rigs[body.stem];
			if (body.baseEtag !== rig.etag)
				return json({ ok: false, error: 'conflict', etag: rig.etag, message: 'theirs' }, 409);
			if (body.frameSource !== undefined) {
				if (body.frameSourceBaseEtag !== (rig.frame?.etag ?? null))
					return json(
						{
							ok: false,
							error: 'conflict',
							etag: rig.etag,
							frameEtag: rig.frame?.etag ?? null,
							message: 'theirs',
						},
						409,
					);
				const problems = S.frameSourceProblems({ ...body.frameSource, rig: body.stem });
				if (problems.length)
					return json({ ok: false, error: 'frame-invalid', message: problems.join('; ') }, 422);
				rig.frame = { doc: body.frameSource, etag: `"f${seen.saves.length + 1}"` };
			}
			rig.doc = body.skeleton;
			rig.etag = `"r${seen.saves.length + 1}"`;
			return json({
				ok: true,
				etag: rig.etag,
				frameEtag: rig.frame?.etag ?? null,
				...(body.frameSource ? { artSwitched: true } : {}),
				controlsDropped: [],
				rebaked: [],
				detached: [],
				unmet: [],
			});
		}
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
	name: 'frame-rig-update',
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
const open = async (name) => {
	await evaluate(
		`(async () => { await loadSkeletons(true); const t = skeletons.find((s) => s.name === ${q(name)}); await selectSkeleton(t); return true; })()`,
	);
	await waitFor(`!!rawDoc && irigStem(selected) === ${q(name)} && !!skeleton`, 30000);
	// The link lookup answers after the rig opens.
	await new Promise((r) => setTimeout(r, 300));
};
const button = () =>
	evaluate(
		'(() => { const b = document.getElementById("editCutBtn"); return { shown: b.style.display !== "none", title: b.title }; })()',
	);

try {
	await waitFor('typeof rawDoc !== "undefined" && document.getElementById("editCutBtn")', 30000);
	await evaluate(`(() => {
		window.__alerts = []; window.__confirms = [];
		window.alert = (m) => window.__alerts.push(String(m));
		window.confirm = (m) => { window.__confirms.push(String(m)); return true; };
		ensureRiggerMotion = async () => false; // no tracker: the kept cut opens without it
		return true;
	})()`);

	await open('Nelly');
	const b0 = await button();
	ok(
		'a frame-made rig shows ✂ Edit cut in its panel, saying which frame it was cut from',
		b0.shown && /frame 1 of its clip/.test(b0.title),
		q(b0),
	);
	const base = await evaluate(
		'({ etag: frameSrc.etag, art: frameSrc.doc && frameSrc.doc.art, atlas: rigAtlas() === assetMgr.require(selected.atlas_file) })',
	);
	ok(
		'its source opened with it, on its ETag, the bundle drawing its art',
		base.etag === '"f1"' && base.art === A && base.atlas,
		q(base),
	);

	await evaluate('document.getElementById("editCutBtn").click(); true');
	await waitFor(
		'document.getElementById("f2rModal").classList.contains("open") && !!f2r.cut && !!f2r.labels && !f2r.busy',
		20000,
	);
	const dlg = await evaluate(`({
		job: f2r.cut.job, sel: f2r.sel, edit: f2r.edit && f2r.edit.stem,
		create: document.getElementById("f2rCreate").textContent, enabled: !document.getElementById("f2rCreate").disabled,
		name: document.getElementById("f2rName").style.display, clip: document.getElementById("f2rClip").value,
		clipLocked: document.getElementById("f2rClip").disabled, why: document.getElementById("f2rWhy").textContent,
	})`);
	ok(
		"✂ opens the dialog on the rig's own cut, not the newest cut of its frame",
		dlg.job === CUT.job && dlg.sel === KEPT && dlg.edit === 'Nelly',
		q(dlg),
	);
	ok(
		'…its clip fixed, no rig name, 🔄 Update rig in 🦴 Create rig’s place',
		dlg.create === '🔄 Update rig' &&
			dlg.enabled &&
			dlg.name === 'none' &&
			dlg.clip === CLIP.id &&
			dlg.clipLocked &&
			/Update rig/.test(dlg.why),
		q(dlg),
	);
	await shot('edit-cut-dialog.png');

	// The cut re-edited: the glasses removed, the upper arm taken from frame 2's kept cut.
	await evaluate(`(() => {
		document.querySelector('#f2rProps button[aria-label^="Remove ${REMOVED}"]').click();
		f2rSetSource("upper_arm_l", ${q(OTHER)});
		document.getElementById("f2rCreate").click();
		return true;
	})()`);
	await waitFor(
		'document.getElementById("alertModal").classList.contains("open") && /updated from its cut/.test(document.getElementById("alertMsg").textContent)',
		30000,
	);

	const edit = seen.edits.at(-1);
	ok(
		'the touch-ups are kept with the cut first',
		seen.edits.length === 1 && !edit.names.includes(REMOVED) && edit.sources.upper_arm_l === OTHER,
		q(edit && { names: edit.names, sources: edit.sources }),
	);
	const sheet = seen.sheets.at(-1);
	ok(
		"the parts are made for the rig (its other sheet), on the kept cut's ETag",
		sheet?.rig?.stem === 'Nelly' &&
			sheet.name === undefined &&
			sheet.etag === '"e2"' &&
			sheet.job === CUT.job,
		q(sheet),
	);
	const [u0, u1] = seen.updates;
	ok(
		'the merge is asked of the open rig as the page holds it, with its source',
		seen.updates.length === 2 &&
			!!u0.skeleton.animations.wave &&
			u0.source.job === CUT.job &&
			u0.manifestKey === B &&
			q(u0.keep) === '[]',
		q(seen.updates.map((x) => x.keep)),
	);
	const asked = await evaluate('window.__confirms.slice()');
	ok(
		'the hand-edited mesh is offered (its drawing did not change) and kept when OK',
		asked.some((m) => /mesh of hand_l by hand/.test(m) && /OK keeps your mesh/.test(m)) &&
			q(u1?.keep) === q([EDITED]),
		q(asked),
	);
	ok(
		"the removed prop's keys are named before it goes",
		asked.some((m) => new RegExp(`no longer makes ${REMOVED}`).test(m) && /“wave”/.test(m)),
		q(asked),
	);

	const after = await evaluate(`(() => {
		const has = (n) => rawDoc.bones.some((b) => b.name === n);
		const skin = rawDoc.skins.find((s) => s.name === "default");
		const slot = Object.entries(skin.attachments).find(([, by]) => by[${q(EDITED)}])[0];
		const img = rigAtlas().pages[0].texture._image.src;
		return {
			removed: !has(${q(REMOVED)}) && !rawDoc.slots.some((s) => s.name === ${q(REMOVED)}),
			wave: JSON.stringify(rawDoc.animations.wave), hand: JSON.stringify(skin.attachments[slot][${q(EDITED)}]),
			art: frameSrc.doc.art, img, undo: rigHist.past.length, dirty, text: frameSrc.text === JSON.stringify(frameSrc.doc), etag: frameSrc.etag,
			modal: document.getElementById("f2rModal").classList.contains("open"),
		};
	})()`);
	const handBefore = JSON.stringify(skinOf(made.doc).attachments[slotOf(made.doc, EDITED)][EDITED]);
	// The page writes a first key's time out (`normalizeKeys`) when it opens a rig.
	const keysOf = (wave) =>
		q(JSON.parse(wave).bones.upper_arm_l.rotate.map((k) => [k.time ?? 0, k.value]));
	const waveKept =
		Object.keys(JSON.parse(after.wave).bones).join() === 'upper_arm_l' &&
		keysOf(after.wave) === keysOf(q(made.doc.animations.wave));
	ok(
		"the rig is updated: the removed prop's bone and slot gone (and its keys), the author's clip and kept mesh as they were",
		after.removed && waveKept && after.hand === handBefore,
		q({ removed: after.removed, wave: after.wave, hand: after.hand === handBefore }),
	);
	ok(
		'…drawn with the new sheet’s art, as one undo step, the dialog closed',
		after.art === B && /sheet-b\.png/.test(after.img) && after.undo === 1 && !after.modal,
		q(after),
	);
	const save = seen.saves.at(-1);
	ok(
		"the update is saved through 💾's path: the rig on its ETag, its new source on the source's",
		seen.saves.length === 1 &&
			save.baseEtag === '"r1"' &&
			save.frameSource?.art === B &&
			save.frameSourceBaseEtag === '"f1"' &&
			!save.skeleton.bones.some((b) => b.name === REMOVED),
		q(save && { base: save.baseEtag, art: save.frameSource?.art, fb: save.frameSourceBaseEtag }),
	);
	ok(
		'…and the source follows the save (stored text, its new ETag), the rig clean',
		after.text && after.etag === '"f2"' && !after.dirty,
		q(after),
	);
	const report = await evaluate('document.getElementById("alertMsg").textContent');
	ok(
		'the report says what changed, that it is saved, and that ↶ undoes it',
		/and saved/.test(report) &&
			/↶ undoes it/.test(report) &&
			new RegExp(`Removed .*${REMOVED}`).test(report) &&
			/Your own meshes kept: hand_l/.test(report),
		report,
	);
	await shot('update-report.png');
	await evaluate('closeAlert(); true');

	const undo = await evaluate(`(() => {
		rigUndo();
		const back = { glasses: rawDoc.bones.some((b) => b.name === ${q(REMOVED)}), art: frameSrc.doc.art, own: rigAtlas() === assetMgr.require(selected.atlas_file) };
		rigRedo();
		const again = { glasses: rawDoc.bones.some((b) => b.name === ${q(REMOVED)}), art: frameSrc.doc.art, img: rigAtlas().pages[0].texture._image.src };
		rigUndo();
		return { back, again };
	})()`);
	ok(
		'↶ puts back the rig, its source and the art it drew with; ↷ the update',
		undo.back.glasses &&
			undo.back.art === A &&
			undo.back.own &&
			!undo.again.glasses &&
			undo.again.art === B &&
			/sheet-b\.png/.test(undo.again.img),
		q(undo),
	);
	await evaluate('saveToR2().then(() => { window.__saved = true; }); true');
	await waitFor('window.__saved === true', 20000);
	const resaved = seen.saves.at(-1);
	ok(
		'a save after ↶ sends the source the rig had, so the bundle goes back to its art',
		seen.saves.length === 2 &&
			resaved.frameSource?.art === A &&
			resaved.frameSourceBaseEtag === '"f2"',
		q(resaved && { art: resaved.frameSource?.art, fb: resaved.frameSourceBaseEtag }),
	);

	// Two more updates, the second making the rig's first sheet again (another revision of it): ↶
	// twice back to the rig as it opened must draw the art it opened with, not the second's.
	const runUpdate = async () => {
		const before = seen.saves.length;
		await evaluate('document.getElementById("editCutBtn").click(); true');
		await waitFor(
			'document.getElementById("f2rModal").classList.contains("open") && !!f2r.cut && !f2r.busy',
			20000,
		);
		await evaluate('document.getElementById("f2rCreate").click(); true');
		await waitFor(
			`${q(seen.saves.length)} >= 0 && document.getElementById("alertModal").classList.contains("open")`,
			30000,
		);
		await evaluate('closeAlert(); true');
		return seen.saves.length > before;
	};
	const ran = [await runUpdate(), await runUpdate()];
	const twice = await evaluate(`(() => {
		const top = { art: frameSrc.doc.art, rev: frameSrc.doc.artRevision };
		rigUndo(); rigUndo();
		return { top, art: frameSrc.doc.art, rev: frameSrc.doc.artRevision, own: rigAtlas() === assetMgr.require(selected.atlas_file) };
	})()`);
	ok(
		'after two more updates (the second making the first sheet again), ↶ twice draws the art the rig opened with',
		ran.every(Boolean) &&
			twice.top.art === A &&
			twice.top.rev !== 'rev-a' &&
			twice.art === A &&
			twice.rev === 'rev-a' &&
			twice.own,
		q({ ran, twice }),
	);
	await evaluate('rigRedo(); rigRedo(); true');

	await open('Old');
	const b1 = await button();
	ok(
		'a frame-made rig from before offers to find its cut',
		b1.shown && /made before rigs remembered their cut/.test(b1.title),
		q(b1),
	);
	await evaluate('window.__confirms = []; document.getElementById("editCutBtn").click(); true');
	await waitFor(
		'document.getElementById("f2rModal").classList.contains("open") && !!f2r.cut && !f2r.busy',
		20000,
	);
	const linked = await evaluate(
		'({ asked: window.__confirms.slice(), stem: f2r.edit && f2r.edit.stem, job: f2r.cut.job, src: !!frameSrc.doc, past: rigHist.present.doc.split("\\u0000").length })',
	);
	ok(
		'…asks, links it and opens the cut, the source in its history',
		seen.links.length === 1 &&
			linked.asked.some((m) => /Find it and link/.test(m)) &&
			linked.stem === 'Old' &&
			linked.job === CUT.job &&
			linked.src &&
			linked.past === 4,
		q(linked),
	);
	await evaluate('closeFrameToRig(); true');

	await open('Plain');
	const b2 = await button();
	ok('a rig not made from a frame shows no ✂', !b2.shown, q(b2));

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
			'JSON.stringify({ note: document.getElementById("f2rNote").textContent, why: document.getElementById("f2rWhy").textContent, cut: !!f2r.cut, busy: f2r.busy, alert: document.getElementById("alertMsg").textContent, err: document.getElementById("err").textContent })',
		).catch((x) => String(x)),
	);
} finally {
	if (fail) console.log('\npage console:\n  ' + pageLog.slice(0, 40).join('\n  '));
	server.close();
	await browser.close();
}
console.log(
	`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — frame to rig, Edit cut + Update rig ${pass}/${pass + fail}`,
);
process.exit(fail === 0 ? 0 : 1);
