// Graph editor spike — prove every curve the Rigger's GRAPH view draws is the curve engine-rig
// plays, including the SECOND value of a two-value channel (translate y, scale y).
//   node tools/rigger-spike/graphcurve.mjs <skeleton.json> <skeleton.atlas>
//
// Runs the SHIPPED sampler out of view.html (`GRAPH_CHANS`, `graphValueAt`, `sampleChannel`,
// `bezierValue`), not a re-implementation.
//
// The regression it guards: a translate/scale key's bezier `curve` holds four numbers PER VALUE
// INDEX (x at 0..3, y at 4..7), and `sampleChannel` takes a field's index from its position in the
// field list it is given. The graph once sampled `[c.field]` alone, so y read x's tangents: a y key
// with flat handles drew as a sharp V while the bone eased smoothly through it.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, MixBlend, MixDirection } =
	await import(RIG_CORE);

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) {
	console.error('usage: node tools/rigger-spike/graphcurve.mjs <skeleton.json> <skeleton.atlas>');
	process.exit(2);
}

// ---- the SHIPPED graph sampler, out of view.html ----------------------------------------
const html = readFileSync(
	new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url),
	'utf8',
);
function pull(head, close) {
	const i = html.indexOf('\n' + head);
	const end = i < 0 ? -1 : html.indexOf(close, i);
	if (end < 0) {
		console.error(`✗ "${head}" not found in view.html — the markers moved`);
		process.exit(2);
	}
	return html.slice(i, end + close.length);
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
	[
		pull('const GRAPH_CHANS = [', '\n];'),
		pull('function bezierValue(', '\n}'),
		pull('function sampleChannel(', '\n}'),
		pull('function graphValueAt(', '\n}'),
		'Object.assign(globalThis, { GRAPH_CHANS });',
	].join('\n'),
	sandbox,
	{ filename: 'view.html#graph' },
);
const { GRAPH_CHANS, graphValueAt, sampleChannel } = sandbox;

// ---- a bone whose x and y (and scaleX and scaleY) ease DIFFERENTLY ------------------------
// The translate keys are the reported case: a deep y dip whose middle key has flat tangents, next
// to a shallow x dip with its own handles.
const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const boneName = (raw.bones.find((b) => b.parent) || raw.bones[0]).name;
raw.animations = {
	graphAnim: {
		bones: {
			[boneName]: {
				rotate: [
					{ time: 0, value: 0, curve: [0.5, 0, 0.6, 90] },
					{ time: 1.5, value: 90 },
				],
				translate: [
					{ time: 0, x: 25, y: 25, curve: [0.28, 25, 0.47, 5, 0.33, 25, 0.25, -380] },
					{ time: 0.83, x: 5, y: -380, curve: [1.3, 5, 1.5, 25, 1.45, -375, 1.5, 25] },
					{ time: 2, x: 25, y: 25 },
				],
				scale: [
					{ time: 0, x: 1, y: 1, curve: [0.2, 1.2, 0.4, 1.2, 0.8, 1, 0.95, 0.4] },
					{ time: 1, x: 1.2, y: 0.4 },
				],
			},
		},
	},
};
const cb = raw.animations.graphAnim.bones[boneName];

const atlas = new TextureAtlas(readFileSync(atlasPath, 'utf8'));
const stub = {
	getImage: () => ({ width: 2048, height: 2048 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
for (const p of atlas.pages) {
	p.width = 2048;
	p.height = 2048;
	try {
		p.setTexture(stub);
	} catch {
		p.texture = stub;
	}
}
const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
	JSON.parse(JSON.stringify(raw)),
);
const anim = data.findAnimation('graphAnim');
const sk = new Skeleton(data);
const bone = sk.findBone(boneName);
const bd = bone.data;
// What the runtime poses, read back in the KEYED units the graph plots (offsets from setup for
// rotate/translate, a multiplier of setup for scale).
const PLAYED = {
	rotation: () => bone.rotation - bd.rotation,
	x: () => bone.x - bd.x,
	y: () => bone.y - bd.y,
	scaleX: () => bone.scaleX / bd.scaleX,
	scaleY: () => bone.scaleY / bd.scaleY,
};
function playedAt(t) {
	sk.setToSetupPose();
	anim.apply(sk, 0, t, false, null, 1, MixBlend.setup, MixDirection.mixIn);
	return Object.fromEntries(Object.entries(PLAYED).map(([label, read]) => [label, read()]));
}

let pass = true;
const log = (ok, msg) => {
	console.log((ok ? '  ✅ ' : '  ✗ ') + msg);
	if (!ok) pass = false;
};
console.log(`\n=== Graph editor curves vs engine-rig: ${jsonPath} (bone "${boneName}") ===`);

const times = Array.from({ length: 41 }, (_, i) => i * 0.05);
const played = times.map(playedAt);
for (const ch of GRAPH_CHANS) {
	const c = { ...ch, keys: cb[ch.ch] };
	if (!PLAYED[c.label]) {
		log(false, `${c.label}: no runtime reading for this graph channel — extend PLAYED`);
		continue;
	}
	const vals = c.keys.map((k) => k[c.field]);
	// The runtime plays a bezier as ten straight pieces, so allow 2% of the curve's span.
	const tol = 0.02 * (Math.max(...vals) - Math.min(...vals));
	let worst = 0;
	let worstT = 0;
	let fieldOnly = 0;
	times.forEach((t, i) => {
		const d = Math.abs(graphValueAt(c, t) - played[i][c.label]);
		if (d > worst) {
			worst = d;
			worstT = t;
		}
		fieldOnly = Math.max(
			fieldOnly,
			Math.abs(sampleChannel(c.keys, t, [c.field])[c.field] - played[i][c.label]),
		);
	});
	log(
		worst <= tol,
		`${c.label}: graph follows the played curve (worst Δ ${worst.toFixed(3)} @${worstT.toFixed(2)}s, tol ${tol.toFixed(3)})`,
	);
	// Keep the fixture sharp: a second value sampled on its own must visibly miss, or a regression
	// to `sampleChannel(keys, t, [c.field])` would pass unnoticed.
	if (c.vi > 0)
		log(
			fieldOnly > 10 * tol,
			`${c.label}: sampled alone it would miss by ${fieldOnly.toFixed(3)} — the fixture catches the old bug`,
		);
}

console.log(pass ? '\n✅ PASS — every graphed curve is the curve the runtime plays.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
