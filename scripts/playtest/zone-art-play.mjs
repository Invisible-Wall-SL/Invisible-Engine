// Plays ZONE ART (docs/design/zone-art.md) on a plain arcade game, in the headless shell: the arcade
// sample (`arcade-play.mjs`'s snapshot: Game Maker's arcade scenes, its seed config, its starter
// flow) with three zones in its config and `arcade.zoneArt` drawing two of their families, the
// config as a publish stores it (zone art is carried past the normalizer). The art is a stub sheet
// exported as a publish exports one (`deploy/editor-art/`, listed in `editorArt`): a magenta frame
// for the `reef#` family and a two-frame green clip for `pond`; and a stub RIG for the `lamp#`
// family, exported as a publish exports a rig (`deploy/editor-art/<name>/`, listed in
// `editorArt.spines` under its bundle name) and named in `characterArt` by the real
// `zoneArtArtNames`: one slot whose `blink` animation shows a cyan drawing, then a yellow one,
// every second. The two lamps are the pair of zone ids whose seed-picked starts
// (`zoneArtPhaseFor`) are nearest half a cycle apart.
//
// It boots the game twice, with and without the zone art, and checks: with it, the screen shows
// the magenta frame and the green clip; the rig is drawn, each lamp changes colour as its
// animation plays, and the two lamps show different colours at one moment (they do not play in
// lockstep); without it, none of those colours; the round still plays (the sample's salmon is
// there and steers); no page error. Screenshots go to --out.
//
// `--cost` plays nothing of that: it boots the sample three times with 430 zones of one family on
// one screen (as many as Salmons' trees), drawn by nothing, by the reef frame, or by a tree rig of 8
// bones and 6 parts swaying (`fixtures/zoneRigStubs.mjs`), and records in `result.json` (`cost`)
// the wall time per frame of 120 frames stepped without the GL draw (the JS) and of 20 drawn, and
// how many rigs the runtime's `?perf=1` readout saw updated a frame.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/zone-art-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>] \
//     [--cost]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PNG } from 'pngjs';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	ARCADE_SAMPLE_COMPONENTS,
	arcadeReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import { ARCADE_DRIVEN_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/arcadeSeed.ts';
import {
	normalizeGameConfigDoc,
	withZoneArt,
	zoneArtArtNames,
	zoneArtPhaseFor,
} from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { BLINK_RIG, CYAN, TREE_RIG, YELLOW, exportStubRig } from './fixtures/zoneRigStubs.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/zone-art-play') },
		chrome: { type: 'string' },
		cost: { type: 'boolean', default: false },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'zone-art-sample';

const SHEET = 'invisible_wall/zone_art/manifests/atlas_manifest_S_ZoneStub.json';
const MAGENTA = [255, 0, 255];
const GREENS = [
	[0, 220, 0],
	[0, 170, 0],
];
const RIG = 'ZoneRig';
const TREE_RIG_NAME = 'TreeRig';
const LEAVES = [0x20, 0x90, 0x30];
const raw = JSON.parse(
	readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
);
// The two lamps whose starts are nearest half a cycle apart (offline the seed is 0): at any moment
// one shows the cyan drawing and the other the yellow, unless the rigs play in lockstep.
const [LEFT_LAMP, RIGHT_LAMP] = (() => {
	const ids = Array.from({ length: 24 }, (_, i) => `lamp${i + 1}`);
	let best = ['lamp1', 'lamp2'];
	let off = 1;
	for (const a of ids)
		for (const b of ids) {
			const d = Math.abs(Math.abs(zoneArtPhaseFor(a, 0) - zoneArtPhaseFor(b, 0)) - 0.5);
			if (a !== b && d < off) [best, off] = [[a, b], d];
		}
	return best;
})();
const ZONES = [
	{ id: 'reef1', x: 200, y: 150, w: 300, h: 160 },
	{ id: 'reef2', x: 900, y: 150, w: 300, h: 160 },
	{ id: 'pond', x: 560, y: 330, w: 300, h: 160 },
	{ id: LEFT_LAMP, x: 200, y: 520, w: 200, h: 140 },
	{ id: RIGHT_LAMP, x: 1000, y: 520, w: 200, h: 140 },
];
const zoneArt = {
	'reef#': { source: { kind: 'sprite', region: `${SHEET}::reef` }, placement: 'stamp' },
	pond: { source: { kind: 'flipbook', clip: 'pond_ripple', fps: 4 }, placement: 'stamp' },
	'lamp#': { source: { kind: 'rig', rig: RIG, animation: 'blink' }, placement: 'stamp' },
};
const authoredOf = (art, zones = ZONES) => ({
	...raw,
	arcade: { ...raw.arcade, zones, ...(art ? { zoneArt: art } : {}) },
});
const configOf = (art, zones) =>
	withZoneArt(normalizeGameConfigDoc(authoredOf(art, zones)), authoredOf(art, zones));
// `--cost`: 430 zones of one family (as many as Salmons' trees) on one screen, a 30 × 15 grid,
// drawn by nothing, by a frame, or by the tree rig.
const COST_ZONES = Array.from({ length: 430 }, (_, i) => ({
	id: `tree${i}`,
	x: 20 + (i % 30) * 42,
	y: 20 + Math.floor(i / 30) * 46,
	w: 40,
	h: 44,
}));
const COST_LOOKS = {
	costBare: undefined,
	costFrame: {
		'tree#': { source: { kind: 'sprite', region: `${SHEET}::reef` }, placement: 'stamp' },
	},
	costRig: {
		'tree#': { source: { kind: 'rig', rig: TREE_RIG_NAME, animation: 'sway' }, placement: 'stamp' },
	},
};

const doc = arcadeReferenceLayout();
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...ARCADE_SAMPLE_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'zone-art-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy', 'editor-art'), { recursive: true });

// The stub sheet: three 64 × 32 frames, a magenta reef and two greens of the pond's clip.
const page = new PNG({ width: 192, height: 32 });
for (let y = 0; y < 32; y++)
	for (let x = 0; x < 192; x++) {
		const rgb = x < 64 ? MAGENTA : GREENS[x < 128 ? 0 : 1];
		page.data.set([...rgb, 255], (y * 192 + x) * 4);
	}
writeFileSync(join(snapshot, 'deploy', 'editor-art', 'S_ZoneStub.png'), PNG.sync.write(page));
const frame = (i) => ({
	frame: { x: i * 64, y: 0, w: 64, h: 32 },
	rotated: false,
	trimmed: false,
	spriteSourceSize: { x: 0, y: 0, w: 64, h: 32 },
	sourceSize: { w: 64, h: 32 },
});
writeFileSync(
	join(snapshot, 'deploy', 'editor-art', 'S_ZoneStub.json'),
	JSON.stringify({
		frames: { reef: frame(0), ripple0: frame(1), ripple1: frame(2) },
		meta: { image: 'S_ZoneStub.png', format: 'RGBA8888', size: { w: 192, h: 32 }, scale: '1' },
	}),
);
const pngOf = (w, h, paint) => {
	const image = new PNG({ width: w, height: h });
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) image.data.set([...paint(x, y), 255], (y * w + x) * 4);
	return PNG.sync.write(image);
};
const spines = [
	exportStubRig(snapshot, RIG, BLINK_RIG, pngOf),
	exportStubRig(snapshot, TREE_RIG_NAME, TREE_RIG, pngOf),
];
const bundleOf = (art, zones = ZONES) => ({
	doc,
	componentDefs,
	componentDefaults: {},
	config: configOf(art, zones),
	flowV2: ARCADE_DRIVEN_SEED_DOC,
	flipbooks: [
		{
			id: 'pond_ripple',
			name: 'pond_ripple',
			assetKey: SHEET,
			frames: ['ripple0', 'ripple1'],
			loop: true,
			bounds: { x: -32, y: -16, w: 64, h: 32 },
		},
	],
	editorArt: {
		sheets: [{ key: SHEET, json: 'editor-art/S_ZoneStub.json' }],
		images: [],
		spines,
	},
	// As the art export lists them: the frame and the rig the zone art names.
	...(art ? { characterArt: zoneArtArtNames(authoredOf(art, zones)) } : {}),
});
for (const [name, art] of [
	['with', zoneArt],
	['without', undefined],
])
	writeFileSync(join(work, `runtime-${name}.json`), JSON.stringify(bundleOf(art)));
for (const [name, art] of Object.entries(COST_LOOKS))
	writeFileSync(join(work, `runtime-${name}.json`), JSON.stringify(bundleOf(art, COST_ZONES)));

const HOOK = `(() => {
	const errors = (window.__ZA_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'lines',
	name: 'Zone art sample',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: '7' });

/** The pixels of a screenshot near `rgb` (each channel within 24). */
const countNear = (shot, rgb) => {
	const png = PNG.sync.read(shot);
	let n = 0;
	for (let i = 0; i < png.data.length; i += 4)
		if (rgb.every((c, k) => Math.abs(png.data[i + k] - c) <= 24)) n += 1;
	return n;
};

/** Which of the rig's colours shows on each half of a screenshot, and how much of each. */
const lampColours = (shot) => {
	const png = PNG.sync.read(shot);
	const near = (i, rgb) => rgb.every((c, k) => Math.abs(png.data[i + k] - c) <= 24);
	const half = { left: { cyan: 0, yellow: 0 }, right: { cyan: 0, yellow: 0 } };
	for (let y = 0; y < png.height; y++)
		for (let x = 0; x < png.width; x++) {
			const i = (y * png.width + x) * 4;
			const side = x < png.width / 2 ? half.left : half.right;
			if (near(i, CYAN)) side.cyan += 1;
			else if (near(i, YELLOW)) side.yellow += 1;
		}
	const shows = (side) =>
		side.cyan + side.yellow < 500 ? 'none' : side.cyan > side.yellow ? 'cyan' : 'yellow';
	return { left: shows(half.left), right: shows(half.right), counts: half };
};

/** A page of the sample booted on the bundle `name`, its round started; `perf` turns on the
 *  runtime's frame readout (`?perf=1`, `window.__IE_PERF__`). */
async function open(name, perf = false) {
	const snap = await serveSnapshot({
		dir: snapshot,
		bundleFile: join(work, `runtime-${name}.json`),
		name: 'Zone art sample',
		snapshotId: `zone-art-${name}`,
	});
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: `zone-art-${name}`,
		editorDocBase: snap.origin,
		rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
		sessionID: `zone-art-${name}`,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		arseed: 'sample',
		...(perf ? { perf: '1' } : {}),
	});
	const game = await openPage(headlessShell(opt.chrome), join(work, `profile-${name}`));
	const close = async () => {
		await game.close();
		await snap.close?.();
	};
	try {
		await game.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
		await game.navigate(`${server.origin}/${KEY}/?${params}`);
		for (let i = 0; i < 300; i++) {
			if (await game.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		const steps = (list) => playScenario({ steps: list }, { page: game, draw: 'last' });
		await steps([
			{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 },
			{ op: 'tapToStart' },
			{ op: 'waitFor', until: { playerIn: true } },
			{ op: 'step', frames: 20 },
		]);
	} catch (error) {
		await close();
		throw error;
	}
	return { game, close };
}

async function play(name) {
	const { game, close } = await open(name);
	try {
		const state = await game.evaluate('window.__IE_DETERMINISM__.state()');
		await game.evaluate(`window.__IE_DETERMINISM__.step(1, { draw: 'last' })`);
		const first = await game.screenshot();
		await game.evaluate(`window.__IE_DETERMINISM__.step(20, { draw: 'last' })`);
		const later = await game.screenshot();
		for (const [label, shot] of [
			['a', first],
			['b', later],
		]) {
			const file = `${name}-${label}.png`;
			writeFileSync(join(out, file), shot);
			result.shots.push(file);
		}
		const greens = (shot) => GREENS.map((g) => countNear(shot, g));
		// The lamps, a tenth of a second apart over two seconds: on each side of the screen, which
		// of the rig's two colours shows.
		const lamps = [];
		for (let i = 0; i < 20; i++) {
			await game.evaluate(`window.__IE_DETERMINISM__.step(6, { draw: 'last' })`);
			const shot = await game.screenshot();
			if (i === 0 || i === 5) {
				const file = `${name}-lamps-${i}.png`;
				writeFileSync(join(out, file), shot);
				result.shots.push(file);
			}
			lamps.push(lampColours(shot));
		}
		return {
			magenta: countNear(first, MAGENTA),
			green: [greens(first), greens(later)],
			lamps,
			salmon: (state.arcade?.bodies ?? []).filter((b) => b.tags.includes('player')).length,
			errors: await game.evaluate('window.__ZA_ERRORS__'),
			console: [...game.consoleLines],
		};
	} finally {
		await close();
	}
}

/**
 * `--cost`: the three pages of 430 zones open at once, each measured three times, interleaved,
 * the median kept: the wall time of 120 frames stepped without the GL draw (the JS: every rig's
 * update) and of 20 drawn (the draws and the rigs' mesh rebuilds too, under this machine's GL),
 * per frame; how much of the tree rig's leaves is on screen; and the rig updates a frame.
 */
async function measure() {
	const pages = {};
	try {
		for (const name of Object.keys(COST_LOOKS)) pages[name] = await open(name, true);
		const msPerFrame = async (game, frames, draw) => {
			const start = performance.now();
			await game.evaluate(`window.__IE_DETERMINISM__.step(${frames}, { draw: '${draw}' })`);
			return (performance.now() - start) / frames;
		};
		const cost = {};
		for (const [name, { game }] of Object.entries(pages)) {
			await msPerFrame(game, 10, 'every');
			const shot = await game.screenshot();
			writeFileSync(join(out, `${name}.png`), shot);
			result.shots.push(`${name}.png`);
			cost[name] = { leaves: countNear(shot, LEAVES), js: [], drawn: [] };
		}
		for (let round = 0; round < 3; round++)
			for (const [name, { game }] of Object.entries(pages)) {
				cost[name].js.push(await msPerFrame(game, 120, 'last'));
				// How many rigs the runtime's readout saw updated a frame (`RigView.probe`). Its
				// timers read the harness's virtual clock, which stands still within a frame.
				await game.evaluate(`window.__IE_PERF__?.('reset')`);
				cost[name].drawn.push(await msPerFrame(game, 20, 'every'));
				const work = JSON.parse(
					(await game.evaluate(`window.__IE_PERF__?.() ?? 'null'`)) ?? 'null',
				)?.work;
				cost[name].rigUpdates = Math.max(
					0,
					...Object.values(work ?? {}).map((w) => w.perFrame?.rigs?.mean ?? 0),
				);
			}
		const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
		for (const [name, { game }] of Object.entries(pages)) {
			cost[name].jsMsPerFrame = median(cost[name].js);
			cost[name].drawnMsPerFrame = median(cost[name].drawn);
			cost[name].errors = await game.evaluate('window.__ZA_ERRORS__');
		}
		return cost;
	} finally {
		for (const page of Object.values(pages)) await page.close();
	}
}

try {
	if (opt.cost) {
		const cost = await measure();
		result.cost = cost;
		for (const [name, c] of Object.entries(cost))
			console.log(
				`  ${name}: js ${c.jsMsPerFrame.toFixed(2)} ms/frame, drawn ${c.drawnMsPerFrame.toFixed(1)} ms/frame, ${c.rigUpdates} rig updates a frame`,
			);
		verdict(
			'430 tree rigs on one screen are drawn (their leaves) and all moved on a frame, and nothing else is',
			cost.costRig.leaves > 20_000 &&
				cost.costRig.rigUpdates >= 430 &&
				cost.costBare.leaves < 500 &&
				cost.costFrame.leaves < 500,
			Object.fromEntries(Object.entries(cost).map(([name, c]) => [name, c.leaves])),
		);
		verdict(
			'no page error',
			Object.values(cost).every((c) => !c.errors.length),
			Object.values(cost).map((c) => c.errors),
		);
	} else {
		const withArt = await play('with');
		const without = await play('without');
		verdict(
			'with zone art the reef frame is drawn (magenta on screen)',
			withArt.magenta > 2000,
			withArt,
		);
		verdict(
			'… and the pond clip, which plays (both of its greens over time)',
			withArt.green.flat().reduce((a, b) => a + b, 0) > 2000 &&
				withArt.green[0].some((n) => n > 0) &&
				GREENS.every((_, i) => withArt.green.some((g) => g[i] > 0)),
			withArt.green,
		);
		const sides = (side) => withArt.lamps.map((lamp) => lamp[side]);
		verdict(
			'… and the lamps’ rig, on both sides, in its own colours',
			[...sides('left'), ...sides('right')].every((shows) => shows !== 'none'),
			withArt.lamps,
		);
		verdict(
			'… which animates: each lamp shows both of its drawings over two seconds',
			['left', 'right'].every(
				(side) => sides(side).includes('cyan') && sides(side).includes('yellow'),
			),
			{ left: sides('left'), right: sides('right') },
		);
		verdict(
			'… and its rigs do not play in lockstep: the two lamps mostly show different drawings',
			withArt.lamps.filter((lamp) => lamp.left !== lamp.right).length >= 14,
			{ lamps: [LEFT_LAMP, RIGHT_LAMP], left: sides('left'), right: sides('right') },
		);
		verdict(
			'without it none is drawn',
			without.magenta === 0 &&
				without.green.flat().every((n) => n === 0) &&
				without.lamps.every((lamp) => lamp.left === 'none' && lamp.right === 'none'),
			without,
		);
		verdict(
			'the round plays either way: one salmon in the field',
			withArt.salmon === 1 && without.salmon === 1,
			[withArt.salmon, without.salmon],
		);
		verdict('no page error', !withArt.errors.length && !without.errors.length, [
			withArt.errors,
			without.errors,
		]);
	}
} catch (error) {
	verdict('the play ran', false, String(error?.stack ?? error));
} finally {
	server.stop();
	rmSync(work, { recursive: true, force: true });
}

writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok);
for (const v of failed) console.log(`  ✗ ${v.name}: ${JSON.stringify(v.detail)}`);
console.log(
	failed.length ? `\nzone art play: ${failed.length} FAILED` : `\nzone art play: OK → ${out}`,
);
process.exit(failed.length ? 1 : 0);
