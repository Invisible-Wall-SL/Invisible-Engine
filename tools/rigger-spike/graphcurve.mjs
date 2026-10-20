// Graph editor spike — prove each channel the Rigger's GRAPH view draws is the curve engine-rig
// plays, including the SECOND value of a two-value channel (translate y, scale y).
//   node tools/rigger-spike/graphcurve.mjs <skeleton.json> <skeleton.atlas>
//
// Runs the SHIPPED sampler out of view.html (`GRAPH_CHANS`, `graphValueAt`, `sampleChannel`,
// `bezierValue`), not a re-implementation, over keys as the Rigger holds them once a rig is open
// (`normalizeKeys`, also shipped).
//
// The regressions it guards:
//   • A translate/scale key's bezier `curve` holds four numbers PER VALUE INDEX (x at 0..3, y at
//     4..7), and `sampleChannel` takes a field's index from its position in the field list it is
//     given. The graph once sampled `[c.field]` alone, so y read x's tangents: a y key with flat
//     handles drew as a sharp V while the bone eased smoothly through it.
//   • Rig JSON leaves a value out at its default, and a scale's default is 1. The graph read an
//     omitted value as 0, so anticipation1_intro's `glow` (`[{"x":0.6},{"time":0.6667}]`, the
//     second bone here) drew x falling to 0 and y flat at 0 while the bone played x 0.6 → 1, y 1.
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
		pull('const KEY_DEFAULTS = {', '\n};'),
		pull('function fillKeyFields(', '\n}'),
		pull('function fillKeyDefaults(', '\n}'),
		pull('function normalizeKeyTimes(', '\n}'),
		pull('function normalizeKeys(', '}'),
		'Object.assign(globalThis, { GRAPH_CHANS });',
	].join('\n'),
	sandbox,
	{ filename: 'view.html#graph' },
);
const { GRAPH_CHANS, graphValueAt, sampleChannel, normalizeKeys, normalizeKeyTimes } = sandbox;

// ---- a bone whose x and y (and scaleX and scaleY) ease DIFFERENTLY ------------------------
// The translate keys are the reported case: a deep y dip whose middle key has flat tangents, next
// to a shallow x dip with its own handles. A second bone's keys leave values to their defaults.
const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const [boneName, omitName] = raw.bones.filter((b) => b.parent).map((b) => b.name);
if (!omitName) {
	console.error('✗ the rig needs two bones besides the root');
	process.exit(2);
}
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
			[omitName]: {
				rotate: [{ time: 0.2 }, { time: 1.2, value: 60 }],
				translate: [{ y: -40 }, { time: 1, x: 30 }, { time: 1.8 }],
				scale: [{ x: 0.6 }, { time: 0.6667 }],
			},
		},
	},
};
// What the Rigger holds once the rig is open, and what it held before key defaults were filled.
const held = JSON.parse(JSON.stringify(raw));
normalizeKeys(held);
const timesOnly = JSON.parse(JSON.stringify(raw));
normalizeKeyTimes(timesOnly);

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
// What the runtime poses, read back in the KEYED units the graph plots (offsets from setup for
// rotate/translate, a multiplier of setup for scale).
const PLAYED = {
	rotation: (b) => b.rotation - b.data.rotation,
	x: (b) => b.x - b.data.x,
	y: (b) => b.y - b.data.y,
	scaleX: (b) => b.scaleX / b.data.scaleX,
	scaleY: (b) => b.scaleY / b.data.scaleY,
};
function playedAt(name, t) {
	sk.setToSetupPose();
	anim.apply(sk, 0, t, false, null, 1, MixBlend.setup, MixDirection.mixIn);
	const b = sk.findBone(name);
	return Object.fromEntries(Object.entries(PLAYED).map(([label, read]) => [label, read(b)]));
}

let pass = true;
const log = (ok, msg) => {
	console.log((ok ? '  ✅ ' : '  ✗ ') + msg);
	if (!ok) pass = false;
};
console.log(
	`\n=== Graph editor curves vs engine-rig: ${jsonPath} (bones "${boneName}", "${omitName}") ===`,
);

const times = Array.from({ length: 41 }, (_, i) => i * 0.05);
const worstMiss = (c, played) => {
	let worst = 0;
	let worstT = 0;
	let notANumber = 0;
	times.forEach((t, i) => {
		const d = Math.abs(graphValueAt(c, t) - played[i][c.label]);
		// A curve read past the end of `curve` samples NaN, and SVG drops the line without a word.
		if (!Number.isFinite(d)) notANumber++;
		else if (d > worst) {
			worst = d;
			worstT = t;
		}
	});
	return { worst, worstT, notANumber };
};
for (const name of [boneName, omitName]) {
	console.log(
		`  bone "${name}"${name === omitName ? ' — keys that leave values to their defaults' : ''}`,
	);
	const played = times.map((t) => playedAt(name, t));
	for (const ch of GRAPH_CHANS) {
		const c = { ...ch, keys: held.animations.graphAnim.bones[name][ch.ch] };
		if (!PLAYED[c.label]) {
			log(false, `${c.label}: no runtime reading for this graph channel — extend PLAYED`);
			continue;
		}
		const vals = c.keys.map((k) => k[c.field]);
		// The runtime plays a bezier as ten straight pieces, so allow 2% of the curve's span.
		const tol = 0.02 * (Math.max(...vals) - Math.min(...vals));
		const { worst, worstT, notANumber } = worstMiss(c, played);
		log(
			notANumber === 0 && worst <= tol,
			`${c.label}: graph follows the played curve (worst Δ ${worst.toFixed(3)} @${worstT.toFixed(2)}s, tol ${tol.toFixed(3)}, ${notANumber} non-finite)`,
		);
		if (name === boneName && c.vi > 0) {
			// Keep the fixture sharp: a second value sampled on its own must visibly miss, or a
			// regression to `sampleChannel(keys, t, [c.field])` would pass unnoticed.
			const fieldOnly = Math.max(
				...times.map((t, i) =>
					Math.abs(sampleChannel(c.keys, t, [c.field])[c.field] - played[i][c.label]),
				),
			);
			log(
				fieldOnly > 10 * tol,
				`${c.label}: sampled alone it would miss by ${fieldOnly.toFixed(3)} — the fixture catches the old bug`,
			);
		}
		if (name === omitName) {
			// The key dots and the value range read `k[c.field]`: each key holds the value it plays at
			// (10 µs on, as the runtime stores key times in single precision).
			const off = c.keys
				.map((k) =>
					Math.abs(k[c.field] - playedAt(name, Math.min(k.time + 1e-5, anim.duration))[c.label]),
				)
				.filter((d) => !(d <= tol + 1e-3));
			log(
				off.length === 0,
				`${c.label}: every key dot sits on the played curve (${off.length} off)`,
			);
		}
	}
	if (name === omitName) {
		// Keep it sharp: scale's omitted 1, read as 0, must visibly miss.
		for (const label of ['scaleX', 'scaleY']) {
			const ch = GRAPH_CHANS.find((x) => x.label === label);
			const { worst } = worstMiss(
				{ ...ch, keys: timesOnly.animations.graphAnim.bones[name][ch.ch] },
				played,
			);
			log(
				worst > 0.5,
				`${label}: unfilled it would miss by ${worst.toFixed(3)} — the fixture catches the old reading`,
			);
		}
	}
}

console.log(pass ? '\n✅ PASS — every graphed curve is the curve the runtime plays.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
