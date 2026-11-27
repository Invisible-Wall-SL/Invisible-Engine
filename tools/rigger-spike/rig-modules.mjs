// Rig modules (docs/design/rig-modules.md): a template's switchable pieces, first the hands (Half body
// with fingers, simple or none; Full body simple or none), headless on the SHIPPED code: the
// built-ins with each option (`templateWithModules`), the owner's 🗺 From my sheet rig made with no
// hands, a synthetic performer's 3D capture imported into it as the page does, the template a rig is
// given (`rigTemplateForSidecar`) and ＋ New rig's build (`resolveNewRigBody`) with R2 stubbed, and the
// page's own filter of a template summary (`templateAsChosen`). Asserted:
//  - options: every option of every built-in validates, builds a rig engine-rig loads, and records
//    its choice; the default is the definition itself; a module or option it lacks is refused;
//  - nohands: no hands takes the fingers, the hand's slot, drawings and controls, and keeps the wrist
//    bone ending the arm — its IK, the IK control and its spaces, the capture's reach, the forearm's
//    foreshortening; no control, key, map entry, 3D view or picker button names what went;
//  - simple: one bone with its drawn poses (the pose swap no longer hides finger slots), no fingers;
//  - capture: a capture with hands, imported into the no-hands sheet rig in 3D, keys only bones and
//    controls the rig has, the arms reach the tracked wrists as the rig with hands does (the bare
//    wrist ends them), and the clip bakes and plays;
//  - sidecar: the rig's `template.json` names its modules, and the template it is then given (and ＋
//    New rig's build, plain or from a sheet) has them; a module it cannot have leaves the template whole;
//  - sheet: a mapping keeps its modules, a hand part mapped onto a no-hands template is refused, and
//    🔄 Update rig keeps the rig without hands;
//  - page: the dialogs' filtered template (`templateAsChosen`) has the parts, slots and bones the
//    server builds;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/rig-modules.mjs [--only <guard>] [--no-mutants]
import * as P from './performer3d.mjs';
import {
	FPS,
	RIG,
	SIZED,
	imported,
	ownerMapping,
	ownerRig,
	player,
	runGate,
} from './owner-sheet.mjs';

const NONE = { hands: 'none' };
const FINGER = /^(thumb|index|middle|ring|pinky)_/;
const HANDISH =
	/^(hand_[lr]|wrist_[lr]|fore_hand_[lr]|curl|thumb|spread|(thumb|index|middle|ring|pinky)_)/;

/** Template `t` rigged over placeholder art (a region per part), loaded by engine-rig: bones, slots. */
function loads(M, t) {
	const regions = t.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const made = M.templateRig(t, regions);
	const lines = ['page.png', 'size:8192,8192', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x % 8000},${Math.floor(x / 8000) * 400},${r.w},${r.h}`);
		x += r.w;
	}
	const atlas = new RIG.TextureAtlas(lines.join('\n') + '\n');
	for (const p of atlas.pages)
		p.setTexture({
			getImage: () => ({ width: 1, height: 1 }),
			setFilters() {},
			setWraps() {},
			dispose() {},
		});
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(made.skeleton)),
	);
	return { made, data };
}

/** Every name a template's controls, map, 3D setup and clips use, by what they name. */
function named(t) {
	const ch = new Set(t.channels.map((c) => c.id));
	const bones = new Set(t.bones.map((b) => b.name));
	const slots = new Set(t.slots.map((s) => s.name));
	const out = [];
	const need = (what, ok, name) => ok || out.push(`${what} ${name}`);
	for (const c of t.channels) {
		for (const d of c.drives ?? []) need('drive', bones.has(d.bone), `${c.id}→${d.bone}`);
		for (const s of c.sets ?? []) need('set', ch.has(s.channel), `${c.id}→${s.channel}`);
		for (const h of c.hides ?? []) need('hide', slots.has(h.slot), `${c.id}→${h.slot}`);
		for (const s of c.order?.slots ?? []) need('order', slots.has(s), `${c.id}→${s}`);
	}
	const m = t.motion;
	for (const k of ['face', 'body', 'hand'])
		for (const e of m?.[k]?.entries ?? [])
			need(`${k} map`, !e.channel || ch.has(e.channel), e.channel);
	for (const e of m?.bones3d?.entries ?? []) need('3D turn', bones.has(e.bone), e.bone);
	for (const f of m?.bones3d?.fingers ?? []) need('finger segment', bones.has(f.bone), f.bone);
	for (const r of m?.bones3d?.replaces ?? []) need('replaces', ch.has(r), r);
	for (const s of Object.keys(t.rig3d?.views ?? {})) need('3D view', slots.has(s), s);
	for (const ss of Object.values(t.rig3d?.layers ?? {}))
		for (const s of ss) need('layer', slots.has(s), s);
	for (const b of Object.keys(t.controls?.bones ?? {})) need('control', bones.has(b), b);
	for (const i of t.controls?.picker?.items ?? [])
		need('picker', !i.bone || bones.has(i.bone), i.bone ?? i.set ?? i.limb);
	for (const c of t.clips)
		for (const k of c.keys) need('clip key', ch.has(k[1]), `${c.name}:${k[1]}`);
	return out;
}

const GUARDS = {
	/** Every option of every built-in validates, builds and loads; the default is the definition. */
	options(M, ok, log) {
		let good = true;
		const rows = [];
		for (const t of [M.HALF_BODY, M.FULL_BODY]) {
			good =
				ok(`options (${t.id}): no choice is the definition`, M.templateWithModules(t, {}) === t) &&
				good;
			for (const m of t.modules ?? [])
				for (const o of m.options) {
					const x = M.templateWithModules(t, { [m.id]: o.id });
					const problem = M.rigTemplateProblem(x);
					let loaded;
					try {
						const { made, data } = loads(M, x);
						loaded = { bones: data.bones.length, slots: data.slots.length, ref: made.ref };
					} catch (e) {
						loaded = { error: String(e.message ?? e) };
					}
					rows.push(`${t.id} ${o.id}: ${loaded.bones ?? '✗'} bones, ${loaded.slots ?? '✗'} slots`);
					const def = o.id === m.default;
					good =
						ok(`options (${t.id} ${m.id} ${o.id}): validates`, problem === null, String(problem)) &&
						ok(
							`options (${t.id} ${m.id} ${o.id}): builds a rig engine-rig loads`,
							!!loaded.bones,
							JSON.stringify(loaded),
						) &&
						ok(
							`options (${t.id} ${m.id} ${o.id}): the rig records its modules off their default`,
							JSON.stringify(loaded.ref?.modules ?? null) ===
								JSON.stringify(def ? null : { [m.id]: o.id }) && (def ? x === t : true),
							JSON.stringify(loaded.ref),
						) &&
						ok(
							`options (${t.id} ${m.id} ${o.id}): nothing names what went`,
							!named(x).length,
							named(x).slice(0, 6).join('; '),
						) &&
						good;
				}
			good =
				ok(
					`options (${t.id}): a module it lacks is refused`,
					!!M.moduleChoiceProblem(t, { legs: 'none' }),
				) &&
				ok(
					`options (${t.id}): an option it lacks is refused`,
					!!M.moduleChoiceProblem(t, { hands: 'paws' }),
				) &&
				good;
		}
		log(rows.join('; '));
		return good;
	},

	/** No hands: the fingers, the hand's slot, drawings and controls go; the wrist ends the arm. */
	nohands(M, ok, log) {
		let good = true;
		for (const t of [M.HALF_BODY, M.FULL_BODY]) {
			const x = M.templateWithModules(t, NONE);
			const bones = new Set(x.bones.map((b) => b.name));
			const ch = new Set(x.channels.map((c) => c.id));
			const handish = (n) => HANDISH.test(n);
			const kept = ['l', 'r'].every(
				(s) =>
					bones.has(`hand_${s}`) &&
					bones.has(`hand_ik_${s}`) &&
					!x.slots.some((sl) => sl.bone === `hand_${s}`) &&
					(x.rig3d.ik ?? []).some((k) => k.end === `hand_${s}`) &&
					!!x.controls.limbs?.[`arm_${s}`] &&
					x.motion.bones3d.positions.limbs.some((l) => l.end === `hand_${s}`) &&
					x.channels
						.find((c) => c.id === `fore_lower_arm_${s}`)
						?.drives?.some((d) => d.bone === `hand_${s}` && d.prop === 'y'),
			);
			const leftovers = [
				...x.bones.filter((b) => FINGER.test(b.name)).map((b) => b.name),
				...x.parts
					.filter((p) => /^hand_|^(thumb|index|middle|ring|pinky)_/.test(p.name))
					.map((p) => p.name),
				...x.channels.filter((c) => handish(c.id)).map((c) => c.id),
				...(x.motion.hand ? ['the hand map'] : []),
				...(x.motion.bones3d.fingers?.length ? ['finger segments'] : []),
				...x.motion.bones3d.entries.filter((e) => /^hand_/.test(e.bone)).map((e) => `3D ${e.bone}`),
				...x.motion.body.entries.filter((e) => handish(e.channel)).map((e) => `map ${e.channel}`),
				...Object.keys(x.rig3d.views ?? {}).filter((s) => /^hand_/.test(s)),
				...Object.keys(x.controls.bones).filter((b) => /^hand_[lr]$/.test(b) || FINGER.test(b)),
				...Object.keys(x.controls.sets).filter((s) => /finger/.test(s)),
				...x.controls.picker.items
					.filter((i) => /^hand_[lr]$/.test(i.bone ?? '') || /finger/.test(i.set ?? ''))
					.map((i) => `picker ${i.bone ?? i.set}`),
				...x.clips.flatMap((c) =>
					c.keys.filter((k) => handish(k[1])).map((k) => `${c.name}:${k[1]}`),
				),
			];
			log(
				`${t.id}: ${t.bones.length} → ${x.bones.length} bones, ${t.slots.length} → ${x.slots.length} slots, ${t.channels.length} → ${x.channels.length} controls`,
			);
			good =
				ok(
					`nohands (${t.id}): the wrist stays, bare, ending the arm (IK, its control, the capture's reach, foreshortening)`,
					kept,
				) &&
				ok(
					`nohands (${t.id}): no finger, hand drawing, hand control, map entry, 3D view, picker button or key is left`,
					!leftovers.length,
					leftovers.slice(0, 8).join(', '),
				) &&
				ok(
					`nohands (${t.id}): Wave and the other starter clips stay`,
					x.clips.length === t.clips.length && ch.has('elbow_l'),
				) &&
				good;
		}
		return good;
	},

	/** Simple hands: one bone with its drawn poses, no fingers. */
	simple(M, ok, log) {
		const x = M.templateWithModules(M.HALF_BODY, { hands: 'simple' });
		const pose = x.channels.find((c) => c.id === 'hand_l');
		const fingers = x.bones.filter((b) => FINGER.test(b.name)).map((b) => b.name);
		log(
			`half-body simple: hand pose swaps ${pose?.swaps?.length}, hides ${pose?.hides?.length ?? 0}; ${fingers.length} finger bones`,
		);
		return (
			ok(
				'simple: the hand keeps its slot, its drawn poses and its Wrist',
				x.slots.some((s) => s.name === 'hand_l') &&
					x.parts.some((p) => p.name === 'hand_l_fist') &&
					x.channels.some((c) => c.id === 'wrist_l') &&
					!!pose?.swaps?.length,
			) &&
			ok(
				'simple: no finger bones, segments or finger controls; the pose hides no finger slot',
				!fingers.length &&
					!x.motion.bones3d.fingers &&
					!x.channels.some((c) => /^curl|^spread|^thumb_/.test(c.id)) &&
					!(pose.hides ?? []).length,
				fingers.join(', '),
			)
		);
	},

	/** A capture with hands, imported into the no-hands sheet rig in 3D, keys only what the rig has. */
	capture(M, ok, log) {
		const rig = ownerRig(M, { modules: NONE });
		const bones = new Set(rig.tpl.bones.map((b) => b.name));
		const ch = new Set(rig.tpl.channels.map((c) => c.id));
		const t = P.track(30, FPS, (i) => ({
			pose: { arms: { l: { upper: P.dir(-30 - i, 10), lower: P.dir(-100 + 2 * i, 20) } } },
			opts: { hands: true, face: P.ry(0) },
		}));
		// Following positions, the picture's shoulders on the rig's (the reference's default line-up).
		const s0 = player(rig.irig)(null);
		const [l, r] = ['l', 'r'].map((x) => s0.findBone(`upper_arm_${x}`));
		const k = Math.hypot(r.worldX - l.worldX, r.worldY - l.worldY) / 180;
		const lineUp = {
			k,
			x0: (l.worldX + r.worldX) / 2 - k * 500,
			y0: (l.worldY + r.worldY) / 2 + k * 200,
		};
		const follow = { follow: { lineUp, depths: { ...rig.tpl.rig3d.depths } } };
		const solved = M.solveMotion(
			{ bones: rig.tpl.bones, channels: rig.tpl.channels, motion: rig.tpl.motion },
			t,
			{ three: true, face: true, body: true, hand: true, ...follow },
		);
		const keyed = [...Object.keys(solved.bones3d ?? {}), ...Object.keys(solved.keys2d ?? {})];
		const strays = [
			...keyed.filter((b) => !bones.has(b)),
			...solved.keys.map((k) => k[1]).filter((c) => !ch.has(c)),
			...keyed.filter((b) => /^hand_|^(thumb|index|middle|ring|pinky)_/.test(b)),
		];
		const out = imported(rig, t, follow);
		const reach = solved.follow?.limbs ?? {};
		// The same rig with its hands, the same capture: the arms reach as far as they did.
		const handed = ownerRig(M);
		const was = M.solveMotion(
			{ bones: handed.tpl.bones, channels: handed.tpl.channels, motion: handed.tpl.motion },
			t,
			{ three: true, face: true, body: true, hand: true, ...follow },
		).follow?.limbs;
		let plays;
		try {
			const s = player(out.irig)(0.5);
			plays = s.bones.every((b) => Number.isFinite(b.worldX) && Number.isFinite(b.worldY));
		} catch {
			plays = false;
		}
		log(
			`no-hands sheet rig: ${rig.irig.bones.length} bones; the import keyed ${keyed.length} bones, ${new Set(solved.keys.map((k) => k[1])).size} controls; strays ${strays.length}`,
		);
		return (
			ok(
				'capture: the import keys only bones and controls the rig has, no hand or finger',
				!strays.length,
				[...new Set(strays)].slice(0, 8).join(', '),
			) &&
			ok(
				'capture: the arms reach the tracked wrists as the rig with hands does (Follow positions)',
				Object.keys(reach).length === 2 && JSON.stringify(reach) === JSON.stringify(was),
				`${JSON.stringify(reach)} vs ${JSON.stringify(was)}`,
			) &&
			ok(
				'capture: the rig has no hand drawing and no finger',
				!rig.irig.slots.some((s) => /^hand_|^(thumb|index|middle|ring|pinky)_/.test(s.name)) &&
					!rig.irig.bones.some((b) => FINGER.test(b.name)),
			) &&
			ok('capture: the clip bakes and plays', plays)
		);
	},

	/** The rig's `template.json` names its modules; the template it is given and ＋ New rig have them. */
	async sidecar(M, ok, log) {
		const made = M.templateRig(M.templateWithModules(M.HALF_BODY, NONE), SIZED);
		const text = M.templateSidecar(made);
		const given = await M.rigTemplateForSidecar(text);
		const whole = await M.rigTemplateForSidecar(
			JSON.stringify({ id: 'half-body', version: 3, modules: { hands: 'paws' } }),
		);
		const plain = await M.resolveNewRigBody('', 'half-body', SIZED, undefined, undefined, NONE);
		const fromSheet = await M.resolveNewRigBody(
			'',
			'half-body',
			SIZED,
			undefined,
			M.parseSheetMapping(JSON.parse(JSON.stringify(ownerMapping(M, { modules: NONE })))).mapping,
		);
		let refused = false;
		try {
			await M.resolveNewRigBody('', 'half-body', SIZED, undefined, undefined, { hands: 'paws' });
		} catch {
			refused = true;
		}
		const handless = (s) =>
			!s.bones.some((b) => FINGER.test(b.name)) && !s.parts.some((p) => /^hand_l/.test(p.name));
		log(
			`template.json ${text}; given ${given.parts.length} parts, choice ${JSON.stringify(given.choice)}`,
		);
		return (
			ok(
				'sidecar: template.json names the modules',
				JSON.parse(text).modules?.hands === 'none',
				text,
			) &&
			ok(
				'sidecar: the template a rig is given has them (no hand, no finger, no hand map)',
				handless(given) &&
					JSON.stringify(given.choice) === '{"hands":"none"}' &&
					!given.motion.hand,
				JSON.stringify(given.choice),
			) &&
			ok(
				'sidecar: a module the template cannot have leaves it whole',
				!whole.choice && whole.parts.length === M.HALF_BODY.parts.length,
			) &&
			ok(
				'sidecar: ＋ New rig builds with the modules picked, and records them',
				JSON.stringify(plain.template.ref.modules) === '{"hands":"none"}' &&
					!plain.skeleton.bones.some((b) => FINGER.test(b.name)),
			) &&
			ok(
				'sidecar: ＋ New rig from a sheet takes its mapping’s modules',
				JSON.stringify(fromSheet.template.ref.modules) === '{"hands":"none"}' &&
					fromSheet.sheet.mapping.template.modules?.hands === 'none' &&
					!fromSheet.skeleton.slots.some((s) => s.name === 'hand_l'),
			) &&
			ok('sidecar: a choice the template lacks is refused', refused)
		);
	},

	/** A mapping keeps its modules; a hand part on a no-hands template is refused; Update keeps it. */
	sheet(M, ok, log) {
		const m = M.parseSheetMapping(
			JSON.parse(JSON.stringify(ownerMapping(M, { modules: NONE }))),
		).mapping;
		const handed = ownerMapping(M);
		const withHand = { ...m, parts: { ...m.parts, hand_l: handed.parts.hand_l } };
		const refused = M.sheetRig(M.asMapped(M.HALF_BODY, withHand), SIZED, withHand);
		const rig = ownerRig(M, { mapping: m });
		const res = M.updateSheetRig({
			template: M.HALF_BODY,
			regions: SIZED,
			was: m,
			mapping: m,
			current: rig.irig,
		});
		const doc = res.ok ? res.value.doc : null;
		log(
			`mapping template ${JSON.stringify(m.template)}; a hand part: ${refused.ok ? 'made' : refused.problem}; update ${res.ok ? `${doc.bones.length} bones, removed ${res.value.report.removed.length}` : res.problem}`,
		);
		return (
			ok(
				'sheet: the mapping keeps its modules',
				m.template.modules?.hands === 'none',
				JSON.stringify(m.template),
			) &&
			ok(
				'sheet: a hand part mapped onto a no-hands template is refused',
				!refused.ok && /hand_l/.test(refused.problem),
				refused.problem,
			) &&
			ok(
				'sheet: 🔄 Update rig keeps the rig without hands, removing nothing',
				!!doc &&
					!doc.slots.some((s) => s.name === 'hand_l') &&
					!doc.bones.some((b) => FINGER.test(b.name)) &&
					!res.value.report.removed.length &&
					!res.value.report.handEdited.length,
				JSON.stringify(res.ok ? res.value.report.removed : res.problem),
			)
		);
	},

	/** The page's filtered template (the dialogs') has what the server builds. */
	page(M, ok, log) {
		const F = M.page(['templateAsChosen']);
		let good = true;
		const rows = [];
		for (const t of [M.HALF_BODY, M.FULL_BODY])
			for (const m of t.modules)
				for (const o of m.options) {
					const choice = { [m.id]: o.id };
					const server = M.rigTemplateSummary(M.templateWithModules(t, choice));
					const page = F.templateAsChosen(
						M.rigTemplateSummary(t),
						o.id === m.default ? {} : choice,
					);
					const same = (k, f = (x) => x) =>
						JSON.stringify(server[k].map(f)) === JSON.stringify(page[k].map(f));
					const agrees =
						same('parts', (p) => p.name) && same('slots') && same('bones', (b) => b.name);
					rows.push(`${t.id} ${o.id} ${agrees ? 'agrees' : 'differs'}`);
					good =
						ok(
							`page (${t.id} ${o.id}): the dialogs' template has the server's parts, slots and bones`,
							agrees,
							`${server.bones.length} vs ${page.bones.length} bones`,
						) && good;
				}
		log(rows.join(', '));
		return good;
	},
};

/** Planted mutants: [guard, what it breaks, [file, from, to][]]. */
const MUTANTS = [
	[
		'options',
		'the default option taken as a choice (a rig with none rebuilt)',
		[
			[
				'rigTemplateModules.ts',
				'([id, opt]) => t.modules?.find((m) => m.id === id)?.default !== opt,',
				'() => true,',
			],
		],
	],
	[
		'nohands',
		'what hangs from a bone taken left in place (the finger tips)',
		[
			[
				'rigTemplateModules.ts',
				'\tfor (const b of t.bones) if (b.parent && gone.has(b.parent)) gone.add(b.name);\n',
				'',
			],
		],
	],
	[
		'nohands',
		'a bare wrist keeps its turns (Wrist stays)',
		[
			[
				'rigTemplateModules.ts',
				'(d) => !gone.has(d.bone) && !(stripped.has(d.bone) && !MOVES.has(d.prop)),',
				'(d) => !gone.has(d.bone),',
			],
		],
	],
	[
		'nohands',
		'a control that only set dead ones kept alive (Curl)',
		[
			[
				'rigTemplateModules.ts',
				'!!c.sets?.some((s) => alive.has(s.channel));',
				'!!c.sets?.length;',
			],
		],
	],
	[
		'nohands',
		'the bare wrist still turned in 3D',
		[
			[
				'rigTemplateModules.ts',
				'entries: b3.entries.filter((e) => !off(e.bone))',
				'entries: b3.entries',
			],
		],
	],
	[
		'nohands',
		'the picker keeps buttons of bones that went',
		[['rigTemplateModules.ts', '!(i.bone && off(i.bone)) &&', 'true &&']],
	],
	[
		'capture',
		'the finger segments left in the 3D map',
		[
			[
				'rigTemplateModules.ts',
				'fingers: b3.fingers.filter((f) => !gone.has(f.bone))',
				'fingers: b3.fingers',
			],
		],
	],
	[
		'sidecar',
		'the template a rig is given ignores its modules',
		[
			[
				'rigTemplateStore.ts',
				'const given = withModulesOf(whole, ref.modules);',
				'const given = whole;',
			],
		],
	],
	[
		'sidecar',
		'a sidecar’s modules not read',
		[
			[
				'rigTemplates.ts',
				'const choice = parseModuleChoice(modules);',
				'const choice = parseModuleChoice(undefined);',
			],
		],
	],
	[
		'sheet',
		'a mapping built ignoring its modules',
		[['rigSheetUpdate.ts', 'templateWithModules(t, m.template.modules);', 't;']],
	],
	[
		'page',
		'the dialogs’ template keeps the bones a module took',
		[['view.html', 'bones: tpl.bones.filter((b) => !gone.has(b.name)), ', '']],
	],
];

await runGate('rig-modules', GUARDS, MUTANTS);
