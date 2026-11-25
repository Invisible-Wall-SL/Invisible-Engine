// Plays ZONE ART (docs/design/zone-art.md) on a plain arcade game, in the headless shell: the arcade
// sample (`arcade-play.mjs`'s snapshot: Game Maker's arcade scenes, its seed config, its starter
// flow) with three zones in its config and `arcade.zoneArt` drawing two of their families, the
// config as a publish stores it (zone art is carried past the normalizer). The art is a stub sheet
// exported as a publish exports one (`deploy/editor-art/`, listed in `editorArt`): a magenta frame
// for the `reef#` family and a two-frame green clip for `pond`.
//
// It boots the game twice, with and without the zone art, and checks: with it, the screen shows
// the magenta frame and the green clip; without it, neither colour; the round still plays (the
// sample's salmon is there and steers); no page error. Screenshots go to --out.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/zone-art-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
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
import { normalizeGameConfigDoc, withZoneArt } from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/zone-art-play') },
		chrome: { type: 'string' },
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
const raw = JSON.parse(
	readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
);
const zones = [
	{ id: 'reef1', x: 200, y: 150, w: 300, h: 160 },
	{ id: 'reef2', x: 900, y: 150, w: 300, h: 160 },
	{ id: 'pond', x: 560, y: 330, w: 300, h: 160 },
];
const zoneArt = {
	'reef#': { source: { kind: 'sprite', region: `${SHEET}::reef` }, placement: 'stamp' },
	pond: { source: { kind: 'flipbook', clip: 'pond_ripple', fps: 4 }, placement: 'stamp' },
};
const configOf = (art) => {
	const authored = { ...raw, arcade: { ...raw.arcade, zones, ...(art ? { zoneArt: art } : {}) } };
	return withZoneArt(normalizeGameConfigDoc(authored), authored);
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
const bundleOf = (art) => ({
	doc,
	componentDefs,
	componentDefaults: {},
	config: configOf(art),
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
	},
	...(art ? { characterArt: [`${SHEET}::reef`] } : {}),
});
for (const [name, art] of [
	['with', zoneArt],
	['without', undefined],
])
	writeFileSync(join(work, `runtime-${name}.json`), JSON.stringify(bundleOf(art)));

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

async function play(name) {
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
	});
	const game = await openPage(headlessShell(opt.chrome), join(work, `profile-${name}`));
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
		return {
			magenta: countNear(first, MAGENTA),
			green: [greens(first), greens(later)],
			salmon: (state.arcade?.bodies ?? []).filter((b) => b.tags.includes('player')).length,
			errors: await game.evaluate('window.__ZA_ERRORS__'),
			console: [...game.consoleLines],
		};
	} finally {
		await game.close();
		await snap.close?.();
	}
}

try {
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
	verdict(
		'without it neither is drawn',
		without.magenta === 0 && without.green.flat().every((n) => n === 0),
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
