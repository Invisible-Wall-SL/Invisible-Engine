// Rig modules on 🎞 Frame to rig (docs/design/rig-modules.md §5), headless on the SHIPPED code: the
// committed frame fixture's cut (atlas-tool's `fixtures/rig_from_frame/`, cut for Half body with
// hands) made into a rig with no hands, then a rig made with fingers changed to no hands and back by
// ✂ Edit cut's 🔄 Update rig (`updateFrameRig`, as `/api/rigger/from-frame/update` runs it), and the
// page's part of it. Asserted:
//  - request: with no hands, the parts request draws each hand into its forearm (`merge`, from
//    `drawnInto`) and places no hand or finger image, the fit has no fingers, a prop drawn over a
//    finger is drawn over the forearm; with the default set the request is exactly what it was;
//  - builds: the no-hands rig builds over the art and engine-rig loads it: no hand slot, no finger,
//    the bare wrist bone ending each arm;
//  - update: a rig made with fingers, keyed by its author on the arm and a finger, updated to no
//    hands loses the fingers, the hands' slots and the finger key, keeps the wrist, the arm's key and
//    every other bone; updated back, it has every finger and hand again and the arm's key;
//  - page: 🧩 on a frame rig opens ✂ Edit cut; its 🔄 Update rig sends the Modules row's set to both
//    steps and records it once saved, and with the rig's template unread sends none;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/rig-modules-frame.mjs [--only <guard>] [--no-mutants]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, RIG, runGate } from './owner-sheet.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIX = join(ROOT, 'services/atlas-tool/fixtures/rig_from_frame');
const PARTS = join(FIX, 'parts');
const sharp = createRequire(join(APP, 'package.json'))('sharp');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const TRACK = read(join(FIX, 'track.json'));
const CUT = { ...read(join(PARTS, 'cut.json')), clip: { id: 'nelly', frame: 1 } };
const SHEET = read(join(PARTS, 'sheet.json'));
const LABELS = await sharp(join(PARTS, 'labels.png'))
	.extractChannel(0)
	.raw()
	.toBuffer({ resolveWithObject: true });
const NONE = { hands: 'none' };
const FINGER = /^(thumb|index|middle|ring|pinky)_/;
const HAND = /^hand_[lr]/;
/** The sheet a no-hands parts job makes: no hand images (the forearms carry them). */
const NO_HAND_REGIONS = SHEET.regions.filter((r) => !HAND.test(r.name));

/** The parts request the route sends for template `t`, its parts left out drawn into `into`. */
const requestOf = (M, t, into) =>
	M.framePartsRequest(
		t,
		CUT,
		TRACK,
		M.propPivots(new Uint8Array(LABELS.data), LABELS.info.width, CUT),
		{},
		...(into ? [into] : []),
	);

/** `doc` read by engine-rig over `regions` (a stub page). */
function loads(doc, regions) {
	const lines = ['page.png', `size:${SHEET.width},${SHEET.height}`, 'filter:Linear,Linear'];
	for (const r of regions) lines.push(r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`);
	const atlas = new RIG.TextureAtlas(lines.join('\n') + '\n');
	for (const p of atlas.pages)
		p.setTexture({
			getImage: () => ({ width: 1, height: 1 }),
			setFilters() {},
			setWraps() {},
			dispose() {},
		});
	return new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(doc)),
	);
}

/** A rig 🦴 Create rig made from the cut with template `t` over `regions`, and its frame source. */
function made(M, t, regions, fit) {
	const doc = M.templateRig(t, regions, fit).skeleton;
	const source = M.frameSourceOf({
		rig: 'Nelly',
		template: { id: t.id, version: t.version },
		cut: CUT,
		cutEtag: '"c1"',
		frames: {},
		parts: M.madeParts(
			doc,
			M.madeAttachments(doc).map((a) => a.name),
		),
		art: 'c/p/manifests/atlas_manifest_Nelly_parts.json',
		artRevision: 'rev-a',
	});
	return { doc, source };
}

const names = (xs) => xs.map((x) => x.name);
const clipKeys = (doc, clip) => Object.keys(doc.animations?.[clip]?.bones ?? {});

/** The page's 🔄 Update rig over stubbed globals: what it sent where. */
async function pageUpdate(M, modules, was) {
	const F = M.page(['f2rUpdate', 'f2rUpdatePlan', 'putModules']);
	const sent = [];
	const g = globalThis;
	Object.assign(g, {
		f2r: {
			edit: { dir: 'ZA', stem: 'Nelly', job: CUT.job },
			cut: { job: CUT.job, etag: '"c1"' },
			busy: false,
			modules,
			modulesWas: was,
		},
		rawDoc: { bones: [] },
		selected: { dir_b64: 'ZA' },
		irigStem: () => 'Nelly',
		rigGen: 1,
		dirty: false,
		rigProjectKey: 'p',
		curProjectKey: 'p',
		frameSrc: { doc: {} },
		f2rDirty: () => false,
		f2rRenderCut() {},
		renderEditCut() {},
		f2rNote() {},
		showLoading() {},
		hideLoading() {},
		showAlert() {},
		confirm: () => true,
		f2rUpdateWarnings: () => '',
		f2rApplyUpdate: async () => {},
		saveToR2: async () => {},
		reportFrameUpdate() {},
		respErr: async () => 'HTTP',
		$: () => ({ classList: { remove() {}, add() {} } }),
		fetch: async (url, init) => {
			const body = JSON.parse(init.body);
			sent.push({ url, method: init.method, body });
			const answer = url.endsWith('/from-frame/sheet')
				? { manifestKey: 'm', templateId: 'half_body', fit: {} }
				: url.endsWith('/from-frame/update')
					? { report: { handEdited: [] }, modules: body.modules ?? was ?? {} }
					: { ok: true };
			return { ok: true, json: async () => answer };
		},
	});
	await F.f2rUpdate();
	return sent;
}

const GUARDS = {
	/** The parts request with no hands: the hands drawn into the forearms, no hand or finger image. */
	request(M, ok, log) {
		const t = M.templateWithModules(M.HALF_BODY, NONE);
		const into = M.drawnInto(M.HALF_BODY, t);
		const r = requestOf(M, t, into);
		const plain = requestOf(M, M.HALF_BODY);
		const same = requestOf(M, M.HALF_BODY, M.drawnInto(M.HALF_BODY, M.HALF_BODY));
		const slots = new Set(names(t.slots));
		const props = r.ok ? (r.value.fit.props ?? []) : [];
		log(
			r.ok
				? `merge ${JSON.stringify(r.value.merge)}; parts ${names(r.value.parts).join(' ')}; props after ${props.map((p) => `${p.name}→${p.after ?? p.before}`).join(', ')}`
				: r.problem,
		);
		return (
			ok(
				'request: each hand is drawn into its forearm',
				into.hand_l === 'lower_arm_l' && into.hand_r === 'lower_arm_r',
				JSON.stringify(into),
			) &&
			ok('request: the no-hands request is made', r.ok, r.ok ? '' : r.problem) &&
			ok(
				'request: it draws the cut hands into the forearms and places no hand or finger image',
				JSON.stringify(r.value.merge) ===
					JSON.stringify({ hand_r: 'lower_arm_r', hand_l: 'lower_arm_l' }) &&
					!r.value.parts.some((p) => HAND.test(p.name) || FINGER.test(p.name)) &&
					!r.value.order.some((n) => HAND.test(n)),
				JSON.stringify(r.value.merge),
			) &&
			ok(
				'request: the fit has no fingers',
				!Object.keys(r.value.fit.fingers ?? {}).length,
				Object.keys(r.value.fit.fingers ?? {}).join(' '),
			) &&
			ok(
				'request: a prop drawn over a finger is drawn over what the template still draws',
				props.every((p) => slots.has(p.after ?? p.before)),
				props.map((p) => `${p.name}→${p.after ?? p.before}`).join(', '),
			) &&
			ok(
				'request: with the default set the request is what it was',
				plain.ok && same.ok && !same.value.merge && JSON.stringify(same) === JSON.stringify(plain),
			)
		);
	},

	/** The no-hands rig built over its art, as ＋ New rig builds it, loads in engine-rig. */
	builds(M, ok, log) {
		const t = M.templateWithModules(M.HALF_BODY, NONE);
		const r = requestOf(M, t, M.drawnInto(M.HALF_BODY, t));
		if (!ok('builds: the request is made', r.ok, r.ok ? '' : r.problem)) return false;
		const { doc } = made(M, t, NO_HAND_REGIONS, r.value.fit);
		let data = null;
		try {
			data = loads(doc, NO_HAND_REGIONS);
		} catch (e) {
			log(String(e));
		}
		const bones = names(doc.bones);
		log(`${doc.bones.length} bones, ${doc.slots.length} slots`);
		return (
			ok('builds: engine-rig loads the no-hands rig', !!data) &&
			ok(
				'builds: no hand slot, no finger, the bare wrist ending each arm',
				!doc.slots.some((s) => HAND.test(s.name) || FINGER.test(s.name)) &&
					!bones.some((b) => FINGER.test(b)) &&
					bones.includes('hand_l') &&
					bones.includes('hand_r') &&
					doc.slots.some((s) => s.name === 'lower_arm_l'),
				bones.filter((b) => FINGER.test(b) || HAND.test(b)).join(' '),
			)
		);
	},

	/** ✂ Edit cut's 🔄 Update rig to no hands and back, the author's keys following. */
	update(M, ok, log) {
		const none = M.templateWithModules(M.HALF_BODY, NONE);
		const [rFull, rNone] = [
			requestOf(M, M.HALF_BODY),
			requestOf(M, none, M.drawnInto(M.HALF_BODY, none)),
		];
		if (!ok('update: the requests are made', rFull.ok && rNone.ok)) return false;
		const first = made(M, M.HALF_BODY, SHEET.regions, rFull.value.fit);
		const doc = structuredClone(first.doc);
		const finger = doc.bones.find((b) => FINGER.test(b.name)).name;
		doc.animations = {
			...doc.animations,
			wave: {
				bones: {
					lower_arm_l: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 0.5, value: 30 },
						],
					},
					[finger]: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 0.5, value: 40 },
						],
					},
				},
			},
		};
		const out = M.updateFrameRig({
			template: none,
			regions: NO_HAND_REGIONS,
			fit: rNone.value.fit,
			current: doc,
			made: first.source,
			props: CUT.props,
			from: M.HALF_BODY,
		});
		const gone = out.doc;
		const before = new Set(names(doc.bones));
		const kept = names(gone.bones);
		const mods = out.report.modules;
		log(
			`to none: ${mods ? `${mods.bones.length} bones, slots ${mods.slots.join(' ')}, ${mods.keys} keys` : 'no module change'}; ${gone.bones.length} bones`,
		);
		const back = M.updateFrameRig({
			template: M.HALF_BODY,
			regions: SHEET.regions,
			fit: rFull.value.fit,
			current: gone,
			made: { ...first.source, parts: out.parts },
			props: CUT.props,
			from: none,
		});
		const again = back.doc;
		const fresh = names(first.doc.bones).filter((b) => FINGER.test(b));
		let loaded = true;
		try {
			loads(gone, NO_HAND_REGIONS);
			loads(again, SHEET.regions);
		} catch (e) {
			loaded = false;
			log(String(e));
		}
		log(
			`back: ${back.report.modules ? `${back.report.modules.added.bones.length} bones, slots ${back.report.modules.added.slots.length}` : 'no module change'}; ${again.bones.length} bones`,
		);
		return (
			ok(
				'update: to no hands the fingers, the hands and the finger key go; the wrist, the arm key and every other bone stay',
				!!mods &&
					!kept.some((b) => FINGER.test(b)) &&
					!gone.slots.some((s) => HAND.test(s.name) || FINGER.test(s.name)) &&
					kept.includes('hand_l') &&
					kept.includes('hand_r') &&
					[...before].every((b) => FINGER.test(b) || kept.includes(b)) &&
					JSON.stringify(clipKeys(gone, 'wave')) === JSON.stringify(['lower_arm_l']),
				`${kept.filter((b) => FINGER.test(b)).join(' ')} | ${clipKeys(gone, 'wave').join(' ')}`,
			) &&
			ok(
				'update: the frame source no longer names a hand image, nor the report one the cut stopped making',
				!Object.keys(out.parts).some((p) => HAND.test(p)) && !out.report.removed.length,
				`${Object.keys(out.parts).join(' ')} | removed ${out.report.removed.map((r) => r.name).join(' ')}`,
			) &&
			ok(
				'update: back to fingers, every finger and hand is in again with the arm key',
				fresh.every((b) => names(again.bones).includes(b)) &&
					again.slots.some((s) => s.name === 'hand_l') &&
					again.slots.some((s) => s.name === 'hand_r') &&
					clipKeys(again, 'wave').includes('lower_arm_l'),
				`${fresh.filter((b) => !names(again.bones).includes(b)).join(' ')}`,
			) &&
			ok('update: engine-rig loads both', loaded)
		);
	},

	/** 🧩 on a frame rig opens ✂ Edit cut; its 🔄 Update rig sends the set and records it. */
	async page(M, ok, log) {
		const F = M.page(['openModules']);
		let opened = '';
		Object.assign(globalThis, {
			rawDoc: {},
			rigTemplate: { modules: [{ id: 'hands' }] },
			sheetSrc: { doc: null },
			frameSrc: { doc: { job: CUT.job } },
			openSheetToRig: () => (opened = 'mapping'),
			openEditCut: () => (opened = 'cut'),
		});
		try {
			F.openModules();
		} catch (e) {
			opened = String(e);
		}
		const changed = await pageUpdate(M, NONE, {});
		const unread = await pageUpdate(M, null, null);
		const bodies = (sent, end) => sent.filter((s) => s.url.endsWith(end)).map((s) => s.body);
		const puts = changed.filter((s) => s.method === 'PUT');
		log(
			`🧩 → ${opened}; sent ${changed.map((s) => `${s.method} ${s.url}`).join(', ')}; unread ${unread.map((s) => s.url).join(', ')}`,
		);
		return (
			ok('page: 🧩 on a rig cut from a frame opens ✂ Edit cut', opened === 'cut', opened) &&
			ok(
				"page: 🔄 Update rig sends the Modules row's set to the parts and to the merge",
				bodies(changed, '/from-frame/sheet')[0]?.modules?.hands === 'none' &&
					bodies(changed, '/from-frame/update')[0]?.modules?.hands === 'none',
			) &&
			ok(
				'page: a changed set is recorded once saved',
				puts.length === 1 && puts[0].body.modules?.hands === 'none',
				JSON.stringify(puts.map((p) => p.body)),
			) &&
			ok(
				"page: with the rig's template unread, no set is sent and none recorded",
				unread.every((s) => !('modules' in s.body)) && !unread.some((s) => s.method === 'PUT'),
				JSON.stringify(unread.map((s) => s.body.modules)),
			)
		);
	},
};

/** Planted mutants: [guard, what it breaks, [file, from, to][]]. */
const MUTANTS = [
	[
		'request',
		'a part the template draws no image for still placed alone',
		[
			[
				'rigFrameFit.ts',
				'const own = [...new Set(cutParts.map((n) => merge[n] ?? n))];',
				'const own = cutParts;',
			],
		],
	],
	[
		'request',
		'a part on an image bone not counted as on its bone (a hand into the torso)',
		[
			[
				'rigTemplateModules.ts',
				'for (const b of host ? [bone, host] : [bone])',
				'for (const b of [bone])',
			],
		],
	],
	[
		'request',
		"a prop's place in the draw order left on a finger",
		[['rigFrameFit.ts', '{ after: slotIn(p.after) }', '{ after: p.after }']],
	],
	[
		'request',
		'the merge left out of the request',
		[['rigFrameFit.ts', '...(Object.keys(merge).length ? { merge } : {}),', '']],
	],
	[
		'update',
		'the update ignores the module change',
		[['rigFrameUpdate.ts', '	if (o.from) {\n', '	if (o.from && false) {\n']],
	],
	[
		'update',
		'the merge built on the rig as it was, not as changed',
		[
			[
				'rigFrameUpdate.ts',
				'const base = { current, fresh, freshBind, made: o.made, props, links };',
				'const base = { current: o.current, fresh, freshBind, made: o.made, props, links };',
			],
		],
	],
	[
		'update',
		'what the module change took out reported as the cut no longer making it',
		[['rigFrameUpdate.ts', 'removed: report.removed.filter((r) => !tookSlots.has(r.slot)),', '']],
	],
	[
		'page',
		'🧩 on a frame rig opens the New-rig dialog',
		[['view.html', '  if (frameSrc.doc){ openEditCut(); return; }\n', '']],
	],
	[
		'page',
		"the parts made for the rig's recorded set, not the row's",
		[
			[
				'view.html',
				'rig: { dir: e.dir, stem: e.stem } }, f2r.modules ? { modules: f2r.modules } : {})',
				'rig: { dir: e.dir, stem: e.stem } }, {})',
			],
		],
	],
	[
		'page',
		'the changed set never recorded',
		[['view.html', '    if (moved && !dirty){', '    if (false){']],
	],
	[
		'page',
		'an unread template sent as the default set',
		[
			[
				'view.html',
				'keep, ...(f2r.modules ? { modules: f2r.modules } : {}),',
				'keep, modules: f2r.modules || {},',
			],
		],
	],
];

await runGate('rig-modules-frame', GUARDS, MUTANTS);
