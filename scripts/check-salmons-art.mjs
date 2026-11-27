// Salmons' original art, built in (packages/engine-layout/src/lib/salmonsArt; docs/status/salmons.md):
// - every region the drawing code names (`regions.ts`) is a frame of its committed sheet
//   (`sheets/frames.ts`, made by scripts/salmons/build-art.py), inside its page, and each page and
//   tile is a WebP of the size its frames say;
// - the pages ship as files of their own: config-vite never inlines them (`SALMONS_ART_RE`);
// - only a Salmons room reaches them: `engine-layout/salmons-art` is imported in one place, lazily
//   (`apps/lines` `game/online.ts` `FIELD_ART`, under the `salmonsRiver` generator), and neither
//   engine-layout entry exports it.
// - the bloodstains (`blood.ts`, `GuiltyForever/Salmon-` PR #8) are the old client's: its numbers,
//   each stain at its place raised with the ground, the same on every device, its colours under the
//   water's tint as the old client's tint over it; a salmon swimming in one is red for 3 s and
//   sheds a puff every 70 ms that fades over 3 s.
// - a press draws no circle (owner, 2026-11-20): the flow and the layout the export ships spawn
//   nothing on an `ability` (the old `salmonsSwipe` / `salmonsCast` circles); a swipe shows the
//   bear's claw and a cast its line, both drawn by the runtime's art.
// - the bear wades (owner, 2026-11-25; `wade.ts`, `wadeFilter.ts`): its waterline's arc and its
//   eased depth, pinned; a bear on open water of the original's level wades and one on the bank, a
//   sandbank, a rock or the sea does not, nor a fisherman on a bridge's deck, nor a salmon; on land
//   its look has no filter; under the line its colour is `underTint`'s, and the pass finds the
//   look's place at any zoom and resolution; the runtime wraps every mount it publishes.
// - zone art's trees (`@trees`, docs/design/zone-art.md): `/config`'s Default line names the six
//   trees the river draws; the river itself, mounted here over a stand-in app, draws every
//   scattered and forest tree with the trees' picture (a frame, variants, a clip) at the built-in
//   tree's place, depth and foot, its width times the scale, and every other piece exactly as
//   without it; with no picture loaded it draws exactly as without.
// - zone art's rigs: handed a rig drawing (the runtime's `zoneArtRig.ts`, stood in for here), the
//   river draws every rock and whirlpool whose zone has a rig stamp as its rig, at the built-in
//   picture's place and depth, the built-in size times the scale, a sandbank's stands upright on
//   its zone, fitted inside it; each starts where its zone's seed says, moves on with the river's
//   ticker and is destroyed with it; every other piece and every seeded choice is as without it,
//   and with no drawing handed, or a rig not loaded, the river draws exactly as without.
// - biomes (2026-11-26): a river with none authored is drawn piece for piece as before them
//   (`salmons/art-fingerprint.mjs`), and an authored stretch draws its own trees, floor, grass
//   tint and riverbed; with the trees' art, a biome's variants pick among its pictures.
//
// Run: pnpm check:salmons-art

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ISO_PROJECTOR_MIRRORED } from '../packages/engine-layout/src/lib/projection.ts';
import { SALMONS_SHEETS } from '../packages/engine-layout/src/lib/salmonsArt/sheets/frames.ts';
import {
	SALMONS_DRAWN,
	SALMONS_DRAWN_TILES,
	SALMONS_REGIONS,
	SALMONS_TILES,
	builtinSheetsNeeded,
	pickSalmonsRegions,
} from '../packages/engine-layout/src/lib/salmonsArt/regions.ts';
import {
	SALMONS_ART_GENERATORS,
	SALMONS_DRAWN_ZONE_FAMILIES,
	SALMONS_PROJECT_SHEETS,
	salmonsProjectManifestName,
	salmonsProjectSheetOf,
	usesSalmonsArt,
} from '../packages/game-config/src/salmonsProjectArt.ts';
import { ONLINE_GENERATOR_IDS } from '../packages/game-config/src/family.ts';
import { ZONE_ART_SCENERY } from '../packages/game-config/src/zoneArt.ts';
import { SALMONS_BUILT_IN_ZONE_ART } from '../apps/launcher-api/src/routes/(app)/config/zoneArtBuiltIn.ts';
import { salmonsProjectArtPlan } from './salmons/project-art.mjs';
import {
	BLOOD,
	bloodOpacity,
	createBlood,
	createRedness,
} from '../packages/engine-layout/src/lib/salmonsArt/blood.ts';
import { underTint } from '../packages/engine-layout/src/lib/salmonsArt/leap.ts';
import { CELL, K } from '../packages/engine-layout/src/lib/salmonsArt/scale.ts';
import {
	WADE,
	createWading,
	wadeDepth,
	wadeProgress,
	wades,
	wadingTint,
	waterlineAt,
	waterlineOf,
} from '../packages/engine-layout/src/lib/salmonsArt/wade.ts';
import { TINT_ALPHA, waterUnder } from '../packages/engine-layout/src/lib/salmonsArt/water.ts';
import {
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { SALMONS_MAP_SEED, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The Pixi engine-layout draws with: its ESM entry, beside the CommonJS one `require` finds, so
// the very copy `blood.ts` imports.
const PIXI_CJS = createRequire(join(ROOT, 'packages/engine-layout/package.json')).resolve(
	'pixi.js',
);
const {
	ColorMatrixFilter,
	colorMatrixFilterFrag,
	Container,
	FilterSystem,
	Matrix,
	Rectangle,
	RendererType,
	Texture,
} = await import(pathToFileURL(PIXI_CJS.replace(/index\.js$/, 'index.mjs')).href);
const ART = join(ROOT, 'packages/engine-layout/src/lib/salmonsArt');
const SHEETS = join(ART, 'sheets');

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
	} catch (error) {
		console.error(`✗ ${name}\n${error.message}`);
		process.exitCode = 1;
	}
};

/** A WebP's width and height, from its first chunk (VP8X, VP8L or VP8). */
function webpSize(file) {
	const b = readFileSync(file);
	assert.equal(b.toString('ascii', 0, 4), 'RIFF', `${file} is not a RIFF file`);
	assert.equal(b.toString('ascii', 8, 12), 'WEBP', `${file} is not a WebP`);
	const chunk = b.toString('ascii', 12, 16);
	if (chunk === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
	if (chunk === 'VP8L') {
		const bits = b.readUInt32LE(21);
		return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
	}
	assert.equal(chunk, 'VP8 ', `${file}: unknown WebP chunk ${chunk}`);
	return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}

for (const [sheet, names] of Object.entries(SALMONS_REGIONS)) {
	const doc = SALMONS_SHEETS[sheet];
	check(`${sheet}: its page is a WebP of the size its frames say`, () => {
		assert.ok(doc, `no sheet "${sheet}" in frames.ts`);
		assert.equal(doc.meta.image, `${sheet}.webp`);
		assert.deepEqual(webpSize(join(SHEETS, doc.meta.image)), doc.meta.size);
	});
	check(`${sheet}: every region drawn is a frame inside its page`, () => {
		for (const name of names) {
			const frame = doc?.frames[name]?.frame;
			assert.ok(frame, `"${name}" is not a frame of ${sheet}`);
			assert.ok(
				frame.x >= 0 &&
					frame.y >= 0 &&
					frame.x + frame.w <= doc.meta.size.w &&
					frame.y + frame.h <= doc.meta.size.h,
				`"${name}" lies outside its page`,
			);
		}
	});
}
check('the tiles are WebPs beside the sheets', () => {
	for (const tile of SALMONS_TILES) assert.ok(webpSize(join(SHEETS, `${tile}.webp`)).w > 0);
});
check('nothing in sheets/ but the pages, the tiles and frames.ts', () => {
	const expected = new Set([
		'frames.ts',
		...Object.keys(SALMONS_REGIONS).map((s) => `${s}.webp`),
		...SALMONS_TILES.map((t) => `${t}.webp`),
	]);
	assert.deepEqual(new Set(readdirSync(SHEETS)), expected);
});

check('config-vite never inlines a page or a tile', () => {
	const vite = readFileSync(join(ROOT, 'packages/config-vite/index.js'), 'utf8');
	const source = /const SALMONS_ART_RE = (\/.+\/);/.exec(vite)?.[1];
	assert.ok(source, 'config-vite has no SALMONS_ART_RE');
	assert.match(vite, /assetsInlineLimit: \(file\) =>[^\n]*!SALMONS_ART_RE\.test\(file\)/);
	const re = new Function(`return ${source}`)();
	for (const file of readdirSync(SHEETS).filter((f) => f.endsWith('.webp')))
		assert.ok(re.test(join(SHEETS, file)), `${file} would be inlined`);
});

/** Every source file under `dir` (no node_modules, builds or caches). */
function sources(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (['node_modules', 'build', '.svelte-kit', 'dist', '.cache', '.turbo'].includes(entry))
			continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) sources(path, out);
		else if (/\.(ts|js|mjs|svelte)$/.test(entry)) out.push(path);
	}
	return out;
}

check('only a Salmons room reaches the art: lazy imports alone, under its generators', () => {
	const reached = [];
	for (const top of ['apps', 'packages', 'services'])
		for (const file of sources(join(ROOT, top))) {
			if (file.startsWith(ART)) continue;
			const code = readFileSync(file, 'utf8');
			if (/(?:\bfrom|\bimport\s*\()\s*['"][^'"]*(?:salmons-art|salmonsArt\/)/.test(code))
				reached.push(relative(ROOT, file).split(sep).join('/'));
		}
	assert.deepEqual(reached, ['apps/lines/src/game/online.ts']);
	const online = readFileSync(join(ROOT, 'apps/lines/src/game/online.ts'), 'utf8');
	// Its types are erased (the statement may span lines); everything else must be a lazy import.
	const values = online.replace(/^import type \{[^}]*\} from 'engine-layout\/salmons-art';$/gm, '');
	const imports = [...values.matchAll(/^.*salmons-art.*$/gm)].map((m) => m[0].trim());
	assert.ok(
		imports.length > 0 &&
			imports.every((line) => /await import\('engine-layout\/salmons-art'\)/.test(line)),
		`a value import of the art: ${imports.join(' | ')}`,
	);
	assert.match(
		online,
		/editorArtSheetsWhere\(\(key\) => salmonsProjectSheetOf\(key\) !== undefined\)/,
		'the runtime hands the art only the Salmons project sheets',
	);
	assert.match(
		online,
		/const salmonsArt = async \(\s*made: SalmonsRiverDrawing,\s*seed: number,\s*stains\?: StainLook,\s*zoneArt\?: SalmonsZoneArt,\s*\) =>\s*\(await import\('engine-layout\/salmons-art'\)\)\.loadSalmonsArt\(/,
	);
	const fieldArt = /const FIELD_ART[\s\S]*?> = \{([^}]*)\}/.exec(online)?.[1] ?? '';
	const ids = [...fieldArt.matchAll(/(\w+): salmonsArt,/g)].map((m) => m[1]);
	assert.deepEqual(ids.sort(), [...SALMONS_ART_GENERATORS].sort());
	assert.equal(
		fieldArt.replace(/\s*\w+: salmonsArt,/g, '').trim(),
		'',
		'FIELD_ART has another entry',
	);
	// The start menu before the join is the same chunk's, for the same generators and no other game.
	assert.match(
		online,
		/const salmonsStart = async \(host: SalmonsStartHost\) =>\s*\(await import\('engine-layout\/salmons-art'\)\)\.chooseSalmonsStart\(host\);/,
	);
	const startMenu = /const START_MENU[\s\S]*?> = \{([^}]*)\}/.exec(online)?.[1] ?? '';
	const menuIds = [...startMenu.matchAll(/(\w+): salmonsStart,/g)].map((m) => m[1]);
	assert.deepEqual(menuIds.sort(), [...SALMONS_ART_GENERATORS].sort());
	assert.equal(
		startMenu.replace(/\s*\w+: salmonsStart,/g, '').trim(),
		'',
		'START_MENU has another entry',
	);
	for (const entry of ['index.ts', 'svelte.ts']) {
		const code = readFileSync(join(ROOT, 'packages/engine-layout/src/lib', entry), 'utf8');
		assert.doesNotMatch(code, /salmonsArt/, `engine-layout ${entry} exports the art`);
	}
});

// The project art (docs/status/salmons.md "Original art as project art"): the sheets
// `scripts/salmons/upload-art.py` writes, the runtime's choice between them and the built-in copy,
// and the art exporter's seed.
const plan = salmonsProjectArtPlan();
const builtinFrame = (name) => {
	for (const doc of Object.values(SALMONS_SHEETS))
		if (doc.frames[name]) return doc.frames[name].frame;
	return undefined;
};

check('the project sheets are the plan, one per built-in page, named for upload-art.py', () => {
	assert.deepEqual(plan.map((e) => e.sheet).sort(), Object.values(SALMONS_PROJECT_SHEETS).sort());
	for (const e of plan) {
		assert.match(e.sheet, /^salmons_[a-z_]+$/);
		assert.equal(e.image, `${e.sheet}.webp`);
		assert.deepEqual(webpSize(e.page), { w: e.width, h: e.height }, `${e.sheet}: its page`);
	}
});

check(
	'the project sheets hold every region drawn, once, inside its page, at its built-in size',
	() => {
		const seen = new Map();
		for (const e of plan)
			for (const f of e.frames) {
				assert.ok(!seen.has(f.name), `"${f.name}" is in ${seen.get(f.name)} and ${e.sheet}`);
				seen.set(f.name, e.sheet);
				assert.ok(
					f.x >= 0 && f.y >= 0 && f.x + f.w <= e.width && f.y + f.h <= e.height,
					`${e.sheet}: "${f.name}" lies outside its page`,
				);
				const built = builtinFrame(f.name);
				if (built) assert.deepEqual(f, { name: f.name, ...built }, `"${f.name}" moved or resized`);
			}
		for (const name of SALMONS_DRAWN) assert.ok(seen.has(name), `no project sheet holds "${name}"`);
	},
);

check(
	'each region drawn resolves from the project art, and from the built-in copy without it',
	() => {
		const tag = (prefix) => Object.fromEntries(SALMONS_DRAWN.map((n) => [n, `${prefix}:${n}`]));
		const project = tag('project');
		const builtin = tag('builtin');
		assert.deepEqual(pickSalmonsRegions(project, builtin), project);
		assert.deepEqual(pickSalmonsRegions({}, builtin), builtin);
		assert.deepEqual(builtinSheetsNeeded(project), []);
		assert.deepEqual(builtinSheetsNeeded({}).sort(), Object.keys(SALMONS_REGIONS).sort());
		for (const name of SALMONS_DRAWN) {
			const partial = { ...project };
			delete partial[name];
			const picked = pickSalmonsRegions(partial, builtin);
			assert.equal(picked[name], builtin[name], `"${name}" did not fall back`);
			assert.equal(Object.values(picked).filter((v) => v.startsWith('builtin:')).length, 1);
			const sheet = Object.keys(SALMONS_REGIONS).find((s) => SALMONS_REGIONS[s].includes(name));
			assert.deepEqual(builtinSheetsNeeded(partial), sheet ? [sheet] : []);
		}
		assert.throws(() => pickSalmonsRegions({}, {}), /no art for the region/);
	},
);

check('the exporter ships the project sheets for a Salmons generator, by manifest key only', () => {
	for (const sheet of Object.values(SALMONS_PROJECT_SHEETS))
		assert.equal(
			salmonsProjectSheetOf(
				`invisible_wall/salmons/manifests/${salmonsProjectManifestName(sheet)}`,
			),
			sheet,
		);
	assert.equal(
		salmonsProjectSheetOf('invisible_wall/salmons/manifests/atlas_manifest_props.json'),
		undefined,
	);
	assert.equal(
		salmonsProjectSheetOf('invisible_wall/salmons/sheets/salmons_props/salmons_props.json'),
		undefined,
	);
	for (const id of SALMONS_ART_GENERATORS) {
		assert.ok(ONLINE_GENERATOR_IDS.includes(id), `${id} is not a generator`);
		assert.ok(usesSalmonsArt({ arcade: { online: { generator: id } } }));
	}
	assert.ok(!usesSalmonsArt(null));
	assert.ok(!usesSalmonsArt({ arcade: { online: {} } }));
	const exporter = readFileSync(
		join(ROOT, 'apps/launcher-api/src/lib/server/editorArtExport.ts'),
		'utf8',
	);
	assert.match(
		exporter,
		/if \(usesSalmonsArt\(gameConfig\)\) \{[\s\S]{0,500}salmonsProjectSheetOf\(atlas\.key\)\)\s*salmonsSheetKeys\.push\(atlas\.key\)/,
	);
	assert.match(exporter, /if \(salmonsSheetKeys\.includes\(atlas\.key\)\) continue;/);
	assert.match(exporter, /for \(const key of salmonsSheetKeys\) await exportManifest\(key\);/);
});

check(
	'every name drawn resolves from the built-in copy load.ts loads (a built tile not drawn is not)',
	() => {
		const load = readFileSync(join(ART, 'load.ts'), 'utf8');
		const builtin = {};
		for (const doc of Object.values(SALMONS_SHEETS))
			for (const name of Object.keys(doc.frames)) builtin[name] = name;
		for (const tile of SALMONS_TILES)
			if (load.includes(`'./sheets/${tile}.webp'`)) builtin[tile] = tile;
		for (const tile of SALMONS_DRAWN_TILES)
			assert.ok(
				builtin[tile],
				`"${tile}" is drawn but load.ts does not load ./sheets/${tile}.webp`,
			);
		assert.doesNotThrow(() => pickSalmonsRegions({}, builtin));
	},
);

check('bloodstains: the old client’s numbers, but 70 % transparent', () => {
	assert.deepEqual(
		[BLOOD.contactCells, BLOOD.redMs, BLOOD.red, BLOOD.trailMs, BLOOD.trailEveryMs],
		[0.8, 3000, 0xff3a3a, 3000, 70],
	);
	assert.deepEqual([BLOOD.trailScale, BLOOD.turn], [0.35, 0.4]);
	assert.deepEqual(BLOOD.scale, { min: 0.8, spread: 0.5 });
	// Brighter than the old client's dark red, which at 30 % over blue water read as grey.
	assert.deepEqual(BLOOD.colours, { blood: 0xd01018, core: 0x8a0f12 });
	// Owner, 2026-11-24: the pool and the trail are 70 % transparent (alpha 0.3) unless the
	// game's config (`arcade.online.rules.stains`) says otherwise; an opacity is 0 to 1.
	assert.deepEqual([BLOOD.alpha, BLOOD.trailAlpha], [0.3, 0.3]);
	assert.deepEqual(bloodOpacity(undefined), { pool: 0.3, trail: 0.3 });
	assert.deepEqual(bloodOpacity({ opacity: 0.5, trailOpacity: 0.1 }), { pool: 0.5, trail: 0.1 });
	assert.deepEqual(bloodOpacity({ opacity: 9, trailOpacity: -1 }), { pool: 1, trail: 0 });
	assert.deepEqual(bloodOpacity({ opacity: Number.NaN }), { pool: 0.3, trail: 0.3 });
});

/** A blood kit over a river raised 30 px past y = 500, drawn into a container through an app
 *  whose renderer makes plain textures; `opacity` as a game's config names it. */
const bloodKit = (projector, opacity) => {
	const made = [];
	const blood = createBlood(
		(_x, y) => (y < 500 ? 30 : 0),
		bloodOpacity(opacity),
		...(projector ? [() => projector] : []),
	);
	const app = {
		renderer: {
			generateTexture: () => {
				const texture = new Texture();
				made.push(texture);
				return texture;
			},
		},
	};
	const river = new Container();
	const unmount = blood.mount(river, app);
	const [sunk, wake, surface] = river.children;
	return { blood, river, unmount, surface, wake, sunk, made };
};
const stainsOf = (list) => ({ length: list.length, at: (i) => list[i] });

check(
	'bloodstains: each stain at its place, raised with the ground, the same on every device',
	() => {
		const one = bloodKit();
		const two = bloodKit();
		const stains = [
			{ x: 300, y: 700 },
			{ x: 400, y: 200 },
			{ x: 1200, y: 800 },
		];
		one.blood.frame(stainsOf(stains), 0);
		two.blood.frame(stainsOf(stains), 0);
		const drawn = (kit) => kit.surface.children;
		assert.equal(drawn(one).length, 3);
		const [low, high, dry] = drawn(one);
		assert.deepEqual([low.x, low.y], [300 - 700, (300 + 700) / 2], 'projected');
		assert.deepEqual([high.x, high.y], [400 - 200, (400 + 200) / 2 - 30], 'raised by the ground');
		assert.equal(low.alpha, 0.3, '70 % transparent');
		assert.ok(low.scale.x >= K * 0.8 && low.scale.x <= K * 1.3);
		assert.ok(Math.abs(low.rotation) <= 0.2);
		drawn(two).forEach((s, i) => {
			assert.equal(s.rotation, drawn(one)[i].rotation, 'the same turn on every device');
			assert.equal(s.scale.x, drawn(one)[i].scale.x, 'the same size on every device');
		});
		// On the water or on a bank, its own colours: it lies on top, no tint of the water mixed in.
		assert.equal(one.made.length, 1, 'one texture, wherever it lies');
		assert.ok(low.texture === high.texture && low.texture === dry.texture);
		const set = bloodKit(undefined, { opacity: 0.6, trailOpacity: 0.2 });
		set.blood.frame(stainsOf(stains), 0);
		assert.equal(set.surface.children[0].alpha, 0.6, 'the config’s opacity');
		set.blood.shed(300, 700, 0);
		assert.equal(set.wake.children[0].alpha, 0.2, 'and its trail’s');
		one.blood.frame(stainsOf(stains), 16);
		assert.equal(drawn(one)[0], low, 'unchanged stains are not redrawn');
		one.blood.frame(stainsOf([...stains.slice(1), { x: 500, y: 600 }]), 32);
		assert.equal(drawn(one).length, 3, 'the oldest let go, the newest drawn');
		assert.deepEqual(one.blood.drawn(), { stains: 3, trail: 0 });
		// Salmons' screen is mirrored (`Scene.mirrored`): a stain, and a puff of the trail, are
		// placed by its projector, raised straight up the screen as the river's ground is.
		const mirrored = bloodKit(ISO_PROJECTOR_MIRRORED);
		mirrored.blood.frame(stainsOf(stains), 0);
		const [mLow, mHigh] = mirrored.surface.children;
		assert.deepEqual([mLow.x, mLow.y], [700 - 300, (300 + 700) / 2], 'mirrored');
		assert.deepEqual([mHigh.x, mHigh.y], [200 - 400, (400 + 200) / 2 - 30], 'mirrored, raised');
		mirrored.blood.shed(300, 700, 0);
		const [puff] = mirrored.wake.children;
		assert.deepEqual([puff.x, puff.y], [700 - 300, (300 + 700) / 2], 'the trail mirrored');
	},
);

check('bloodstains: within 0.8 cells a salmon is in one; past it, not', () => {
	const { blood } = bloodKit();
	blood.frame(stainsOf([{ x: 300, y: 700 }]), 0);
	const reach = 0.8 * CELL;
	assert.equal(blood.touches(300 + reach - 1, 700), true);
	assert.equal(blood.touches(300 + reach + 1, 700), false);
	assert.equal(blood.touches(300 + reach * 0.7, 700 - reach * 0.7), true);
});

check('bloodstains: swimming through one, red for 3 s, shedding a puff every 70 ms', () => {
	const redness = createRedness();
	assert.deepEqual(redness(true, false, 0), { red: false, shed: false });
	assert.deepEqual(redness(false, true, 10), { red: false, shed: false }, 'only a swimming one');
	assert.deepEqual(redness(true, true, 100), { red: true, shed: true });
	assert.deepEqual(redness(true, false, 150), { red: true, shed: false }, 'a puff per 70 ms');
	assert.deepEqual(redness(true, false, 170), { red: true, shed: true });
	assert.deepEqual(redness(false, false, 2000), { red: true, shed: false }, 'red in the air too');
	assert.deepEqual(redness(true, false, 3099), { red: true, shed: true });
	assert.deepEqual(redness(true, false, 3100), { red: false, shed: false }, '3 s after it left');
});

check('bloodstains: the trail fades from 0.3 over 3 s', () => {
	const { blood, wake } = bloodKit();
	blood.shed(300, 700, 1000);
	const puff = wake.children[0];
	assert.equal(puff.alpha, 0.3, '70 % transparent where it is shed');
	assert.equal(puff.scale.x, K * BLOOD.trailScale);
	blood.frame(undefined, 2500);
	assert.ok(Math.abs(puff.alpha - 0.15) < 1e-9, 'half gone at 1.5 s');
	blood.frame(undefined, 4000);
	assert.equal(wake.children.length, 0, 'gone at 3 s');
	assert.deepEqual(blood.drawn(), { stains: 0, trail: 0 });
});

check(
	'bloodstains: on top of the water, swimming salmon < trail < stains, in the players’ depth order',
	() => {
		const { blood, river, unmount, wake, sunk, surface } = bloodKit();
		// Bottom to top. The blood is over what swims under the surface, never beneath it.
		assert.deepEqual(river.children, [sunk, wake, surface], 'what swims, the trail, the stains');
		const players = new Container();
		const [deep, near] = [5, 2].map((zIndex) => {
			const instance = new Container();
			instance.zIndex = zIndex;
			const view = new Container();
			instance.addChild(new Container()).addChild(view);
			players.addChild(instance);
			return view;
		});
		blood.sink(deep, true);
		blood.sink(near, true);
		blood.sink(near, true);
		assert.deepEqual(sunk.renderLayerChildren, [deep, near], 'each once');
		sunk.sortRenderLayerChildren();
		assert.deepEqual(sunk.renderLayerChildren, [near, deep], 'by its instance’s depth');
		blood.sink(deep, false);
		assert.equal(deep.parentRenderLayer, null, 'surfaced: drawn in its own place');
		unmount();
		assert.equal(near.parentRenderLayer, null, 'the river gone: drawn in its own place');
		blood.sink(near, true);
		assert.equal(near.parentRenderLayer, null, 'not sunk into a layer that is not drawn');
		const orphan = new Container();
		blood.sink(orphan, true);
		assert.equal(orphan.parentRenderLayer, null, 'nor a look not mounted');
	},
);

check('a press draws no circle: the flow and the layout spawn nothing on an ability', () => {
	const { nodes, exec } = SALMONS_SEED_DOC.graph;
	const spawning = nodes.filter((node) => node.kind === 'spawn' || node.kind === 'despawn');
	assert.deepEqual(
		spawning.map((node) => node.id),
		[],
		'the Salmons flow spawns something: the swipe and the cast are drawn by the room’s art',
	);
	const signals = new Set(nodes.filter((n) => n.kind === 'gameSignals').map((n) => n.id));
	const onAbility = exec.filter((e) => signals.has(e.from.node) && e.from.pin === 'ability');
	assert.deepEqual(onAbility, [], 'the Salmons flow reacts to an ability');
	const characters = new Set(SALMONS_CHARACTER_COMPONENTS.map((def) => def.id));
	const referenced = new Set();
	const walk = (value) => {
		if (Array.isArray(value)) value.forEach(walk);
		else if (value && typeof value === 'object')
			for (const [key, child] of Object.entries(value))
				if (key === 'componentId' && typeof child === 'string') referenced.add(child);
				else if (key === 'spawnable' && Array.isArray(child))
					child.forEach((id) => referenced.add(id));
				else walk(child);
	};
	walk(salmonsReferenceLayout(salmonsMapRiver(SALMONS_MAP_SEED)));
	const placeholders = [...referenced].filter(
		(id) => /swipe|cast|splash/i.test(id) && !characters.has(id),
	);
	assert.deepEqual(placeholders, [], 'the Salmons layout holds an ability placeholder');
});

// The bear wades (`wade.ts`). The pass itself (`wadeFilter.ts`) is loaded with the two names it
// takes from `pixi-svelte` stood in for (Node has no GPU to ask): a renderer that carries
// `links: false` is one whose driver refuses the program. Pixi asks a document for a canvas to
// learn the GPU's float precision; there is none here.
globalThis.document ??= { createElement: () => ({ getContext: () => null }) };
registerHooks({
	resolve: (specifier, context, next) =>
		specifier === 'pixi-svelte/elementFx'
			? {
					url:
						'data:text/javascript,' +
						encodeURIComponent(
							'export const FILTER_VERTEX = "void main(void){gl_Position=vec4(0.0);}";' +
								'export const programLinks = (renderer) => renderer.links !== false;',
						),
					shortCircuit: true,
				}
			: next(specifier, context),
});
const { wadeSurface, warmWade } =
	await import('../packages/engine-layout/src/lib/salmonsArt/wadeFilter.ts');

check('wading: its tunables', () => {
	assert.deepEqual(WADE, {
		depth: 1.1,
		reach: 0.5,
		sag: 0.4,
		sagMax: 0.35,
		rim: { width: 3, alpha: 0.35 },
		bob: { px: 1.2, ms: 2400 },
		easeMs: 250,
		margin: 0.25,
		marginMin: 8,
	});
	assert.ok(Object.isFrozen(WADE) && Object.isFrozen(WADE.rim) && Object.isFrozen(WADE.bob));
});

check('wading: the waterline is the front arc of an ellipse, level beyond its ends', () => {
	const line = { level: -60, sag: 15, reach: 40 };
	assert.equal(waterlineAt(line, 0), -45, 'lowest in the middle: the level and the whole sag');
	assert.equal(waterlineAt(line, 40), -60, 'at the level at its ends');
	assert.equal(waterlineAt(line, -40), -60);
	assert.equal(waterlineAt(line, 70), -60, 'and beyond them');
	assert.equal(waterlineAt(line, -1000), -60);
	for (const x of [1, 7.5, 20, 33, 39.9]) {
		const y = waterlineAt(line, x);
		assert.equal(waterlineAt(line, -x), y, 'the same on both sides');
		// On the ellipse of half-axes `reach` and `sag` about the level.
		assert.ok(Math.abs(((y - line.level) / line.sag) ** 2 + (x / line.reach) ** 2 - 1) < 1e-12);
		assert.ok(y < waterlineAt(line, x - 1), 'rising to the sides (y is down)');
	}
	assert.equal(waterlineAt({ level: -30, sag: 0, reach: 40 }, 12), -30, 'no sag: a level line');
});

check('wading: a body’s line rises from under its look to over its middle, the arc opening', () => {
	// An upright look: 108 tall, drawn 75 wide (the stand-in of the owner's bear rig).
	const upright = { middle: 54, width: 75, bottom: 0 };
	const still = WADE.bob.ms;
	assert.deepEqual(waterlineOf(0, upright, still), { level: 0, sag: 0, reach: 37.5 });
	const full = waterlineOf(1, upright, still);
	assert.ok(Math.abs(full.level - -WADE.depth * 54) < 1e-9, 'its ends over the middle');
	assert.ok(Math.abs(full.sag - WADE.sag * 37.5) < 1e-12, 'the sag a share of its half-width');
	assert.equal(full.reach, WADE.reach * 75, 'its ends at the picture’s sides');
	// About half the body under: the line's ends above its middle, its middle below it.
	assert.ok(-full.level > 54 && -(full.level + full.sag) < 54);
	const half = waterlineOf(0.5, upright, still);
	assert.ok(
		Math.abs(half.level - full.level / 2) < 1e-9 && Math.abs(half.sag - full.sag / 2) < 1e-12,
	);
	// A look that reaches below its place (the bear seen from above, heading down the screen):
	// the line starts under all of it, so nothing is under the water the moment it steps in.
	const low = { middle: 24.8, width: 92, bottom: 21 };
	assert.equal(waterlineOf(0, low, still).level, 21);
	const flat = waterlineOf(1, low, still);
	// A low, wide look: the sag is held to a share of how high the line stands.
	assert.ok(Math.abs(flat.sag - WADE.sagMax * WADE.depth * 24.8) < 1e-12);
	assert.ok(flat.sag < WADE.sag * flat.reach);
	// The bob: a pixel or so, a slow cycle, none at the feet.
	const levels = Array.from({ length: 240 }, (_, i) => waterlineOf(1, upright, i * 10).level);
	const swing = (Math.max(...levels) - Math.min(...levels)) / 2;
	assert.ok(Math.abs(swing - WADE.bob.px) < 1e-3 && WADE.bob.px <= 2, `bobs ${swing} px`);
	assert.ok(
		Math.abs(waterlineOf(1, upright, 100).level - waterlineOf(1, upright, 2500).level) < 1e-9,
	);
	assert.equal(waterlineOf(0, upright, WADE.bob.ms / 4).level, 0);
	assert.equal(waterlineOf(1, { middle: 10, width: 0, bottom: 0 }, 0).reach, 1, 'never no width');
});

check('wading: stepping in takes 250 ms and stepping out as long, eased at both ends', () => {
	assert.equal(WADE.easeMs, 250);
	assert.equal(wadeProgress(0, true, 125), 0.5);
	assert.equal(wadeProgress(0.5, true, 125), 1);
	assert.equal(wadeProgress(0.5, true, 9000), 1, 'no further than in');
	assert.equal(wadeProgress(1, false, 100), 0.6);
	assert.equal(wadeProgress(0.2, false, 9000), 0, 'nor than out');
	assert.equal(wadeProgress(0.3, true, -50), 0.3, 'a clock that runs back moves nothing');
	assert.equal(wadeProgress(0, false, 16), 0);
	// At 60 fps: in after 250 ms, to a rounding of the frames' sum.
	let progress = 0;
	for (let i = 0; i < 14; i++) progress = wadeProgress(progress, true, 1000 / 60);
	assert.ok(progress < 0.94, `still stepping in after 233 ms (${progress})`);
	progress = wadeProgress(progress, true, 1000 / 60);
	assert.ok(1 - progress < 1e-9, `in after 250 ms (${progress})`);
	assert.deepEqual([wadeDepth(0), wadeDepth(0.5), wadeDepth(1)], [0, 0.5, 1]);
	assert.ok(wadeDepth(0.1) < 0.1 && wadeDepth(0.9) > 0.9, 'slow at both ends');
	for (let p = 0.05; p <= 1; p += 0.05) assert.ok(wadeDepth(p) > wadeDepth(p - 0.05));
});

// The original's level, as a room's device draws it.
const wadeRiver = salmonsMapRiver(SALMONS_MAP_SEED);
const wadeWater = (x, y) => waterUnder(wadeRiver, x, y);
const centreOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const WADE_PLACES = (() => {
	const blocked = [...wadeRiver.sandbanks, ...wadeRiver.rocks];
	const clear = (x, y) =>
		!blocked.some(
			(b) => x >= b.x - CELL && x < b.x + b.w + CELL && y >= b.y - CELL && y < b.y + b.h + CELL,
		);
	const band = wadeRiver.bands.find((b) => {
		const x = (b.left + b.right) / 2;
		return b.current <= 100 && b.right - b.left > 6 * CELL && clear(x, b.y + b.h / 2);
	});
	return {
		water: { x: (band.left + band.right) / 2, y: band.y + band.h / 2 },
		bank: { x: band.left - CELL, y: band.y + band.h / 2 },
		sandbank: centreOf(wadeRiver.sandbanks[0]),
		rock: centreOf(wadeRiver.rocks[0]),
		bridge: centreOf(wadeRiver.bridges[0]),
		sea: { x: wadeRiver.world.w / 2, y: wadeRiver.sea.y + CELL },
		source: centreOf(wadeRiver.source),
	};
})();

check('wading: only the bear, and only on open water that has a tint', () => {
	assert.deepEqual(['bear', 'salmon', 'fisherman', 'otter', ''].map(wades), [
		true,
		false,
		false,
		false,
		false,
	]);
	const at = (place) => wadeWater(place.x, place.y);
	assert.deepEqual(at(WADE_PLACES.water), { tint: 0x0ea5e9 });
	assert.equal(wadingTint('bear', at(WADE_PLACES.water)), 0x0ea5e9, 'a bear in the river wades');
	assert.equal(wadingTint('bear', at(WADE_PLACES.source)), 0x7dd3fc, 'in the source too');
	// The original's level has no rapids: the same river, running fast.
	const fast = { ...wadeRiver, bands: wadeRiver.bands.map((b) => ({ ...b, current: 101 })) };
	assert.equal(
		wadingTint('bear', waterUnder(fast, WADE_PLACES.water.x, WADE_PLACES.water.y)),
		0x38bdf8,
		'in the rapids too',
	);
	for (const dry of ['bank', 'sandbank', 'rock']) {
		assert.equal(at(WADE_PLACES[dry]), undefined, `${dry}: no water`);
		assert.equal(wadingTint('bear', at(WADE_PLACES[dry])), undefined, `a bear on a ${dry}`);
	}
	assert.deepEqual(at(WADE_PLACES.sea), { tint: undefined }, 'the sea has no tint');
	assert.equal(wadingTint('bear', at(WADE_PLACES.sea)), undefined);
	// A bridge's deck is over open water: the fisherman on it is not in it, the bear under it is.
	assert.deepEqual(at(WADE_PLACES.bridge), { tint: 0x0ea5e9 });
	assert.equal(
		wadingTint('fisherman', at(WADE_PLACES.bridge)),
		undefined,
		'a fisherman on a bridge',
	);
	assert.equal(wadingTint('bear', at(WADE_PLACES.bridge)), 0x0ea5e9);
	assert.equal(wadingTint('salmon', at(WADE_PLACES.water)), undefined, 'the salmon swims under it');
});

/** A WebGL renderer as far as the pass asks one; `links: false` is a GPU that refuses it. */
const wadeApp = (links = true) => ({ renderer: { type: RendererType.WEBGL, links } });
/** A look of `box` about its place, as a code look, a rig or a turned clip is mounted. */
const wadeLook = (box = new Rectangle(-37.5, -108, 75, 108)) => {
	const view = new Container();
	view.boundsArea = box;
	const log = [];
	return {
		log,
		mount: (into) => {
			into.addChild(view);
			log.push('mount');
			return () => {
				into.removeChild(view);
				log.push('unmount');
			};
		},
	};
};
/** A wading over the original's level whose surfaces are counted, and one player's frames in it. */
const wadeKit = (app = wadeApp()) => {
	const made = [];
	const wading = createWading(wadeWater, TINT_ALPHA, (pixi) => {
		const surface = wadeSurface(pixi);
		made.push(surface);
		return surface;
	});
	const frame = (character, place, atMs) => ({ character, ...place, atMs, middle: 54, width: 75 });
	/** As `<SpawnLayer>` draws a published mount: a container of its own, kept while it is the same. */
	const drawn = new Map();
	const publish = (id, mount) => {
		const was = drawn.get(id);
		if (was?.mount === mount) return was.into;
		was?.teardown();
		const into = new Container();
		drawn.set(id, { mount, into, teardown: mount(into, app) });
		return into;
	};
	const unpublish = (id) => {
		drawn.get(id)?.teardown();
		drawn.delete(id);
	};
	return { wading, made, frame, publish, unpublish, app };
};
const filtersOf = (into) => into.filters ?? [];
/** Whether a filter was destroyed: Pixi lets go of its program then. */
const destroyed = (filter) => filter.glProgram === null;
const uniformsOf = (filter) => filter.resources.wadeUniforms.uniforms;

check(
	'wading: on the bank a bear’s look has no filter; in the water it is half under underTint; out, none again',
	() => {
		const { wading, made, frame, publish } = wadeKit();
		const look = wadeLook();
		let at = 0;
		const step = (place, ms = 1000 / 60) => {
			at += ms;
			return publish('b', wading.mount('b', look.mount, frame('bear', place, at)));
		};
		const into = step(WADE_PLACES.bank, 0);
		for (let i = 0; i < 30; i++) step(WADE_PLACES.bank);
		assert.deepEqual(look.log, ['mount'], 'mounted once, by the wading’s own mount');
		assert.equal(into.filters, undefined, 'never touched on land');
		assert.equal(into.filterArea, undefined);
		assert.equal(made.length, 0, 'no filter is made for a bear that never wades');
		assert.deepEqual(wading.drawn(), {
			b: { depth: 0, tint: null, line: null, drawnUnder: false, pass: false },
		});

		// Into the water: the line rises from the feet to its level over 250 ms.
		const levels = [];
		for (let i = 0; i < 15; i++) {
			step(WADE_PLACES.water);
			levels.push(wading.drawn().b.line.level);
		}
		assert.equal(made.length, 1, 'one filter, made as it steps in');
		const [surface] = made;
		assert.deepEqual(filtersOf(into), [surface.filter]);
		assert.equal(surface.filter.look, into, 'on the container its look is mounted in');
		assert.ok(
			levels.every((level, i) => i === 0 || level < levels[i - 1]),
			'rising all the way',
		);
		assert.ok(levels[0] > -3 && levels[0] < 0, `from the feet (${levels[0]})`);
		const wet = wading.drawn().b;
		assert.equal(wet.depth, 1);
		assert.equal(wet.tint, 0x0ea5e9);
		assert.equal(wet.drawnUnder, true);
		assert.equal(wet.pass, true, 'a look that does not draw its own water: through the pass');
		assert.deepEqual(wet.line, waterlineOf(1, { middle: 54, width: 75, bottom: 0 }, at));
		const { uLine, uUnder } = uniformsOf(surface.filter);
		assert.deepEqual(
			[...uLine].slice(0, 3),
			[wet.line.level, wet.line.sag, wet.line.reach].map(Math.fround),
			'the pass draws that line',
		);
		// The colour under the line: the matrix the swimming salmon is drawn with, its own numbers.
		const matrix = underTint(0x0ea5e9, TINT_ALPHA);
		assert.deepEqual([...uUnder], [matrix[4], matrix[9], matrix[14], matrix[0]].map(Math.fround));
		// The pass covers the look's box and room round it, so a swinging limb is not cut.
		const area = into.filterArea;
		assert.ok(
			area.x <= -37.5 - 27 && area.y <= -108 - 27 && area.right >= 37.5 + 27 && area.bottom >= 27,
		);
		assert.deepEqual(look.log, ['mount'], 'and the look was not mounted again');

		// Back onto the bank: the line falls for 250 ms, then the look is as it was.
		const falling = [];
		for (let i = 0; i < 14; i++) {
			step(WADE_PLACES.bank);
			falling.push(wading.drawn().b.depth);
		}
		assert.ok(falling.every((depth, i) => depth > 0 && (i === 0 || depth < falling[i - 1])));
		assert.deepEqual(filtersOf(into), [surface.filter], 'still under the line while it falls');
		assert.equal(wading.drawn().b.tint, 0x0ea5e9, 'the tint of the water it leaves');
		step(WADE_PLACES.bank);
		assert.deepEqual(filtersOf(into), [], 'no filter on land');
		assert.equal(into.filterArea, undefined);
		assert.deepEqual(wading.drawn().b, {
			depth: 0,
			tint: null,
			line: null,
			drawnUnder: false,
			pass: false,
		});
		assert.equal(destroyed(surface.filter), false, 'kept for the next time it wades');
		step(WADE_PLACES.water);
		assert.deepEqual(filtersOf(into), [surface.filter]);
		assert.equal(made.length, 1);
	},
);

check(
	'wading: not on a sandbank, a rock or the sea; nor a fisherman on a bridge, nor a salmon',
	() => {
		for (const dry of ['sandbank', 'rock', 'sea', 'bank']) {
			const { wading, made, frame, publish } = wadeKit();
			const look = wadeLook();
			let into;
			for (let i = 0; i < 30; i++)
				into = publish('b', wading.mount('b', look.mount, frame('bear', WADE_PLACES[dry], i * 16)));
			assert.equal(into.filters, undefined, `a bear on the ${dry}`);
			assert.equal(made.length, 0);
			assert.equal(wading.drawn().b.depth, 0);
		}
		// Out of the water onto a sandbank: it steps out as onto a bank.
		{
			const { wading, frame, publish } = wadeKit();
			const look = wadeLook();
			const step = (place, at) =>
				publish('b', wading.mount('b', look.mount, frame('bear', place, at)));
			const into = step(WADE_PLACES.water, 0);
			assert.equal(filtersOf(into).length, 1);
			for (let i = 1; i <= 16; i++) step(WADE_PLACES.sandbank, i * 17);
			assert.deepEqual(filtersOf(into), []);
		}
		for (const [character, place] of [
			['fisherman', 'bridge'],
			['fisherman', 'water'],
			['salmon', 'water'],
		]) {
			const { wading, made, frame } = wadeKit();
			const look = wadeLook();
			for (let i = 0; i < 30; i++)
				assert.equal(
					wading.mount('p', look.mount, frame(character, WADE_PLACES[place], i * 16)),
					look.mount,
					`a ${character} over the ${place}: its look’s own mount, untouched`,
				);
			assert.equal(made.length, 0);
			assert.deepEqual(wading.drawn(), {});
		}
		// A bear under a bridge is in the river.
		const { wading, frame, publish } = wadeKit();
		const into = publish(
			'b',
			wading.mount('b', wadeLook().mount, frame('bear', WADE_PLACES.bridge, 0)),
		);
		assert.equal(filtersOf(into).length, 1);
	},
);

check(
	'wading: one mount a player and a look, the same every frame; another look takes it over where it stands',
	() => {
		const { wading, made, frame, publish, unpublish } = wadeKit();
		const first = wadeLook();
		const mounts = new Set();
		let into;
		for (let i = 0; i < 20; i++) {
			const mount = wading.mount('b', first.mount, frame('bear', WADE_PLACES.water, i * 16));
			mounts.add(mount);
			into = publish('b', mount);
		}
		assert.equal(mounts.size, 1, 'the same mount every frame: its look is never mounted again');
		assert.notEqual([...mounts][0], first.mount, 'the wading’s own');
		assert.deepEqual(first.log, ['mount']);
		// First seen in the water: it does not step in.
		assert.equal(wading.drawn().b.depth, 1);
		assert.equal(filtersOf(into).length, 1);
		const other = wadeLook();
		assert.notEqual(
			wading.mount('other', other.mount, frame('bear', WADE_PLACES.water, 320)),
			[...mounts][0],
			'another player’s is its own',
		);
		// Its sheet turns to another rig: another look, another mount, and the bear as deep as it was.
		const second = wadeLook();
		const next = wading.mount('b', second.mount, frame('bear', WADE_PLACES.water, 336));
		assert.ok(!mounts.has(next));
		const [surface] = made;
		const intoNext = publish('b', next);
		assert.deepEqual(first.log, ['mount', 'unmount']);
		assert.deepEqual(second.log, ['mount']);
		assert.deepEqual(filtersOf(into), [], 'the container it left has no filter');
		assert.deepEqual(filtersOf(intoNext), [surface.filter], 'the one it is in has it, at once');
		assert.equal(wading.drawn().b.depth, 1, 'no stepping in again');
		assert.equal(made.length, 1, 'one filter a wading player, and none for a look not mounted');
		// Mounted the other way round (the new one before the old is taken down): the same end.
		const third = wadeLook();
		const last = wading.mount('b', third.mount, frame('bear', WADE_PLACES.water, 352));
		const intoLast = new Container();
		last(intoLast, wadeApp());
		assert.deepEqual(filtersOf(intoLast), [surface.filter]);
		assert.deepEqual(filtersOf(intoNext), [], 'one container has the filter');
		unpublish('b');
		assert.deepEqual(second.log, ['mount', 'unmount']);
		assert.deepEqual(filtersOf(intoLast), [surface.filter], 'the old one’s teardown leaves it be');
	},
);

check(
	'wading: let go with the player, a respawn as another character and the room; a GPU that refuses draws it dry',
	() => {
		const { wading, made, frame, publish, unpublish } = wadeKit();
		const look = wadeLook();
		const wade = (id, character, at) =>
			publish(id, wading.mount(id, look.mount, frame(character, WADE_PLACES.water, at)));
		const gone = wade('gone', 'bear', 0);
		const kept = wade('kept', 'bear', 0);
		const turned = wade('turned', 'bear', 0);
		const [goneSurface, keptSurface, turnedSurface] = made;
		wading.keep((id) => id !== 'gone');
		assert.deepEqual(filtersOf(gone), [], 'a player no longer drawn: its look bare');
		assert.equal(destroyed(goneSurface.filter), true, 'and its filter destroyed');
		assert.deepEqual(Object.keys(wading.drawn()).sort(), ['kept', 'turned']);
		unpublish('gone');
		assert.deepEqual(filtersOf(kept), [keptSurface.filter]);
		// Respawned as a salmon: its new look is published as it is, and the bear's wading is gone.
		const salmon = wadeLook();
		assert.equal(
			wading.mount('turned', salmon.mount, frame('salmon', WADE_PLACES.water, 16)),
			salmon.mount,
		);
		assert.deepEqual(filtersOf(turned), []);
		assert.equal(destroyed(turnedSurface.filter), true);
		assert.deepEqual(Object.keys(wading.drawn()), ['kept']);
		wading.destroy();
		assert.deepEqual(filtersOf(kept), [], 'the room gone: every look bare');
		assert.equal(destroyed(keptSurface.filter), true);
		assert.deepEqual(wading.drawn(), {});
		// Taken down after the room went: nothing left to undo, and no throw.
		unpublish('kept');
		unpublish('turned');

		const refused = wadeKit(wadeApp(false));
		const warn = console.warn;
		const warned = [];
		console.warn = (...args) => warned.push(args.join(' '));
		try {
			let into;
			for (let i = 0; i < 20; i++)
				into = refused.publish(
					'b',
					refused.wading.mount('b', look.mount, refused.frame('bear', WADE_PLACES.water, i * 16)),
				);
			assert.equal(into.filters, undefined, 'a refused pass is never put on a look');
			assert.deepEqual(refused.made, [undefined], 'asked once a player');
			assert.deepEqual(refused.wading.drawn().b.drawnUnder, false);
			assert.equal(warned.length, 1);
			assert.match(warned[0], /wading pass did not compile/);
		} finally {
			console.warn = warn;
		}
		assert.equal(wadeSurface({ renderer: { type: RendererType.WEBGPU } }), undefined, 'WebGL only');
		// The driver is asked for the program as the river mounts, whatever the renderer is.
		warmWade({ renderer: { type: RendererType.WEBGPU } });
		warmWade(wadeApp(false));
		assert.match(
			readFileSync(join(ART, 'index.ts'), 'utf8'),
			/river: \(into, app\) => \{[\s\S]*?\n\t\t\twarmWade\(app\);\n/,
		);
	},
);

check(
	'wading: a look that draws its own water never takes the pass: it is told the line, and on land nothing',
	() => {
		const kit = wadeKit();
		const told = [];
		let drawsIt = true;
		const look = wadeLook();
		const mount = Object.assign(look.mount, {
			water: (under) => {
				told.push(under);
				return drawsIt;
			},
		});
		let into = kit.publish(
			'b',
			kit.wading.mount('b', mount, kit.frame('bear', WADE_PLACES.water, 0)),
		);
		into = kit.publish('b', kit.wading.mount('b', mount, kit.frame('bear', WADE_PLACES.water, 16)));
		assert.equal(into.filters, undefined, 'no filter on its container, ever');
		assert.equal(kit.made.length, 0, 'no pass is made for it');
		const last = told.at(-1);
		assert.ok(last && last.line.sag > 0, 'it is told the waterline');
		assert.deepEqual(last.under, underTint(0x0ea5e9, TINT_ALPHA), 'and the water’s colour matrix');
		assert.deepEqual(
			{ drawnUnder: kit.wading.drawn().b.drawnUnder, pass: kit.wading.drawn().b.pass },
			{ drawnUnder: true, pass: false },
		);
		for (let t = 32; t < 600; t += 16)
			kit.publish('b', kit.wading.mount('b', mount, kit.frame('bear', WADE_PLACES.bank, t)));
		assert.equal(told.at(-1), undefined, 'stepped out: told it is on land');
		assert.equal(into.filters, undefined);
		// A look whose GPU refused its programs is drawn through the pass instead.
		drawsIt = false;
		for (let t = 600; t < 1200; t += 16)
			kit.publish('b', kit.wading.mount('b', mount, kit.frame('bear', WADE_PLACES.water, t)));
		assert.deepEqual(filtersOf(into), [kit.made[0].filter], 'refused: the pass draws it');
		assert.equal(kit.wading.drawn().b.pass, true);
		kit.wading.destroy();
	},
);

const { packedAlpha } = await import('../packages/engine-layout/src/lib/salmonsArt/bodyShaders.ts');
check(
	'body shaders: the salmon’s step is ColorMatrixFilter’s fragment, and a mesh’s alpha packed as Pixi packs it',
	() => {
		assert.ok(new ColorMatrixFilter().resolution === 1, 'the pass it replaces ran at resolution 1');
		const source = readFileSync(join(ART, 'bodyShaders.ts'), 'utf8');
		const lines = colorMatrixFilterFrag
			.split('\n')
			.map((l) => l.trim())
			.filter((l) =>
				/^(result\.[rgba] [+]?= |if \(color\.a > 0\.0\) \{|color\.rgb \/= color\.a;|rgb \*= result\.a;|finalColor = vec4\(rgb, result\.a\);)/.test(
					l,
				),
			);
		assert.equal(
			lines.length,
			24,
			'the matrix, the un-premultiply and the premultiply of Pixi’s pass',
		);
		for (const line of lines) assert.ok(source.includes(line), `the step has \`${line}\``);
		assert.match(colorMatrixFilterFrag, /vec3 rgb = mix\(color\.rgb, result\.rgb, uAlpha\);/);
		assert.match(source, /vec3 rgb = mix\(color\.rgb, result\.rgb, uMatrixAlpha\);/);
		assert.equal(packedAlpha(0.5), 127 / 255);
		assert.equal(packedAlpha(1.2), 1, 'clamped to 1, as a group alpha is');
		assert.equal(packedAlpha(-0.1), 0);
		assert.match(
			readFileSync(join(ART, 'index.ts'), 'utf8'),
			/river: \(into, app\) => \{[\s\S]*?\n\t\t\twarmBodyShaders\(app\);\n/,
			'the driver is asked for the programs as the river mounts',
		);
	},
);

check(
	'wading: the pass draws underTint’s colour under the line and finds the look’s place at any zoom and resolution',
	() => {
		const surface = wadeSurface(wadeApp());
		const { filter } = surface;
		assert.equal(filter.resolution, 'inherit', 'at the screen’s resolution, not Pixi’s 1');
		assert.equal(filter.padding, 0, 'it draws nothing outside the look’s own pixels');
		const source = filter.glProgram.fragment;
		assert.match(source, /vec3 under = color\.rgb \* uUnder\.a \+ uUnder\.rgb \* color\.a;/);
		assert.match(
			source,
			/finalColor = vec4\(mix\(rgb, vec3\(color\.a\), rim\), color\.a\);/,
			'alpha kept',
		);
		assert.doesNotMatch(source, /fwidth|dFdx|dFdy/, 'nothing WebGL 1 lacks');
		// The line it draws: its fragment's own sums, each pinned, and the same sums done here meet
		// `waterlineAt` at every x.
		for (const [sum, why] of [
			[/vec2 at = \(uFeet \* vec3\(vTextureCoord, 1\.0\)\)\.xy;/, 'px about the place'],
			[/float across = min\(abs\(at\.x\) \/ uLine\.z, 1\.0\);/, 'level beyond its ends'],
			[
				/float below = at\.y - \(uLine\.x \+ uLine\.y \* sqrt\(1\.0 - across \* across\)\);/,
				'the arc of an ellipse',
			],
			[/float edge = 0\.5 \* uLine\.w;/, 'smoothed over one pixel of the screen'],
			[
				/vec3 rgb = mix\(color\.rgb, under, smoothstep\(-edge, edge, below\)\);/,
				'the tint under the line, not over it',
			],
			[
				/float rim = uRim\.y \* \(1\.0 - smoothstep\(0\.0, uRim\.x, abs\(below\)\)\);/,
				'the rim along it',
			],
		])
			assert.match(source, sum, why);
		assert.equal(filter.antialias, 'inherit', 'as smooth as the look is drawn without it');
		const { uRim } = uniformsOf(filter);
		assert.equal(uRim[0], WADE.rim.width);
		assert.ok(Math.abs(uRim[1] - WADE.rim.alpha) < 1e-6);
		const drawnLine = { level: -59, sag: 15, reach: 37.5 };
		surface.draw(new Container(), drawnLine, underTint(0x0ea5e9, TINT_ALPHA));
		const [level, sag, reach] = uniformsOf(filter).uLine;
		for (const x of [-80, -37.5, -20, 0, 9.25, 37.5, 60]) {
			const across = Math.min(Math.abs(x) / reach, 1);
			const below = waterlineAt(drawnLine, x) - (level + sag * Math.sqrt(1 - across * across));
			assert.ok(Math.abs(below) < 1e-9, `the pass's line is waterlineAt's at x ${x}`);
		}
		// Asked for `highp` (a place is hundreds of px, read to a fraction of one); Pixi lowers it on
		// a GPU that has none, as it has here, where there is no GPU.
		assert.match(
			readFileSync(join(ART, 'wadeFilter.ts'), 'utf8'),
			/const FRAGMENT = `precision highp float;\n/,
		);
		const look = new Container();
		for (const [tint, alpha] of [
			[0x0ea5e9, TINT_ALPHA],
			[0x38bdf8, TINT_ALPHA],
			[0x7dd3fc, 0.5],
		]) {
			const matrix = underTint(tint, alpha);
			surface.draw(look, { level: -59, sag: 15, reach: 37.5 }, matrix);
			const u = uniformsOf(filter).uUnder;
			// Premultiplied pixels, as the pass is handed them, whole and half see-through.
			for (const pixel of [
				[0.48, 0.29, 0.15, 1],
				[1, 1, 1, 1],
				[0, 0, 0, 1],
				[0.24, 0.145, 0.075, 0.5],
				[0, 0, 0, 0],
			]) {
				const [r, g, b, a] = pixel;
				const plain = a > 0 ? [r / a, g / a, b / a] : [0, 0, 0];
				for (let c = 0; c < 3; c++) {
					// Pixi's colour matrix pass on the un-premultiplied colour, premultiplied again.
					const viaMatrix =
						(matrix[c * 5] * plain[0] +
							matrix[c * 5 + 1] * plain[1] +
							matrix[c * 5 + 2] * plain[2] +
							matrix[c * 5 + 3] * a +
							matrix[c * 5 + 4]) *
						a;
					const viaPass = pixel[c] * u[3] + u[c] * a;
					assert.ok(Math.abs(viaMatrix - viaPass) < 1e-6, `channel ${c} of ${pixel}`);
				}
			}
		}
		// As the pass is drawn: Pixi maps its frame to the screen, and the look's world transform
		// says where its place is there and how large it is drawn.
		for (const [zoom, resolution, mirror] of [
			[1, 1, 1],
			[2 / 3, 2, 1],
			[1 / 3, 3, 1],
			[1.5, 2, -1],
		]) {
			const frame = { x: 211.5, y: 97, w: 256, h: 128 };
			const place = { x: 300.25, y: 180.5 };
			const applied = [];
			filter.look = { worldTransform: new Matrix(mirror * zoom, 0, 0, zoom, place.x, place.y) };
			const input = { source: { resolution } };
			filter.apply(
				{
					// Pixi's own mapping of the pass's frame, over a frame put where Pixi would put it.
					_activeFilterData: {
						inputTexture: { _source: { width: frame.w, height: frame.h } },
						bounds: { minX: frame.x, minY: frame.y },
					},
					calculateSpriteMatrix: FilterSystem.prototype.calculateSpriteMatrix,
					applyFilter: (...args) => applied.push(args),
				},
				input,
				'output',
				true,
			);
			assert.deepEqual(applied, [[filter, input, 'output', true]], 'drawn once, as Pixi asked');
			const { uFeet, uLine } = uniformsOf(filter);
			for (const [u, v] of [
				[0, 0],
				[0.5, 0.25],
				[1, 1],
			]) {
				const at = uFeet.apply({ x: u, y: v });
				// Upright px about the place, at the size the look was made: right is right even
				// under a mirrored parent.
				assert.ok(Math.abs(at.x - (frame.x + u * frame.w - place.x) / zoom) < 1e-9);
				assert.ok(Math.abs(at.y - (frame.y + v * frame.h - place.y) / zoom) < 1e-9);
			}
			assert.ok(
				Math.abs(uLine[3] - 1 / (zoom * resolution)) < 1e-6,
				'one screen pixel, in those px',
			);
		}
		surface.destroy();
		assert.equal(destroyed(filter), true);
		assert.equal(filter.look, undefined);
	},
);

check(
	'wading: the runtime wraps every mount it publishes, and only the Salmons art draws it',
	() => {
		const online = readFileSync(join(ROOT, 'apps/lines/src/game/online.ts'), 'utf8');
		const draws = /function drawCodeLooks\([\s\S]*?\n}\n/.exec(online)?.[0] ?? '';
		const published = [...draws.matchAll(/mounts\.set\(\s*instance,\s*([\s\S]*?)\);\n/g)].map((m) =>
			m[1].replace(/\s+/g, ' ').trim(),
		);
		assert.deepEqual(
			published,
			[
				'waded(id, player, mount, clip?.sheet && sheetDraw(clip.sheet).width)',
				'waded(id, player, look.mount)',
			],
			'a rig’s or a turned clip’s mount, and a code look’s',
		);
		assert.match(draws, /art\?\.wadersDrawn\(\(id\) => current\.drawn\.has\(id\)\);/);
		assert.match(
			draws,
			/if \(!art\) return mount;/,
			'a room with no such art publishes the look’s own',
		);
		assert.match(draws, /middle: standOf\(current, id\)\.middle \?\? body\.h \/ 2,/);
		assert.match(online, /wading: current\.art\.wading\(\),/, 'the probe reads who wades');
		// `<SpawnLayer>`, which every runtime bundles, knows nothing of it, and neither does the
		// package's index: the pass ships in the Salmons chunk alone.
		for (const file of ['SpawnLayer.svelte', 'MountedArt.svelte', 'index.ts', 'svelte.ts'])
			assert.doesNotMatch(
				readFileSync(join(ROOT, 'packages/engine-layout/src/lib', file), 'utf8'),
				/\bwad(e|ing)/i,
				`${file} knows of the wading`,
			);
		const pass = readFileSync(join(ART, 'wadeFilter.ts'), 'utf8');
		assert.match(pass, /import \{ FILTER_VERTEX, programLinks \} from 'pixi-svelte\/elementFx';/);
		assert.match(
			readFileSync(join(ROOT, 'packages/pixi-svelte/src/lib/elementFx/index.ts'), 'utf8'),
			/export \{ VERTEX as FILTER_VERTEX, programLinks, type ElementFxFilter \} from '\.\/shaders';/,
		);
	},
);

check(
	"/config's Zone art Default shows only regions the art draws, for the families it draws",
	() => {
		const known = new Set([...Object.values(SALMONS_REGIONS).flat(), ...SALMONS_DRAWN_TILES]);
		for (const [family, { pictures }] of Object.entries(SALMONS_BUILT_IN_ZONE_ART))
			for (const [sheet, region] of pictures) {
				assert.ok(sheet in SALMONS_PROJECT_SHEETS, `${family}: no sheet ${sheet}`);
				assert.ok(known.has(region), `${family}: ${region} is not drawn`);
			}
		assert.deepEqual(
			Object.keys(SALMONS_BUILT_IN_ZONE_ART).sort(),
			[...SALMONS_DRAWN_ZONE_FAMILIES, ...ZONE_ART_SCENERY].sort(),
		);
		// The trees: every tree the river draws (`tree_${variant}`), from the props sheet.
		const trees = SALMONS_REGIONS.props.filter((name) => name.startsWith('tree_'));
		assert.equal(trees.length, 6);
		assert.deepEqual(
			SALMONS_BUILT_IN_ZONE_ART['@trees'].pictures,
			trees.map((name) => ['props', name]),
		);
		assert.match(
			readFileSync(join(ART, 'river.ts'), 'utf8'),
			/: region\(`tree_\$\{variant\}`\)/,
			'the river draws the built-in trees by these names',
		);
	},
);

// The river mounted in Node: its textures stand-ins labelled by region, an app whose renderer makes
// plain textures and whose screen holds the whole world (every piece in view), the players' layer
// registered. Pixi's canvas for the displacement map is a stand-in too.
globalThis.OffscreenCanvas ??= class {
	constructor(width = 1, height = 1) {
		this.width = width;
		this.height = height;
	}
	getContext() {
		return null;
	}
};
globalThis.document.createElement = () => new OffscreenCanvas(256, 256);
registerHooks({
	resolve: (specifier, context, next) =>
		specifier.endsWith('/worldDrawing.svelte')
			? next(`${specifier}.ts`, context)
			: next(specifier, context),
});
const { AnimatedSprite } = await import(
	pathToFileURL(PIXI_CJS.replace(/index\.js$/, 'index.mjs')).href
);
const { mountSalmonsRiver } = await import(join(ART, 'river.ts'));
const { registerProjectedLayer } =
	await import('../packages/engine-layout/src/lib/worldDrawing.svelte.ts');
const { SALMONS_FIELD_LAYER } =
	await import('../packages/engine-layout/src/lib/referenceLayouts/salmonsRiver.ts');
const { registerFlipbooks } =
	await import('../packages/engine-layout/src/lib/registerFlipbooks.ts');
const { editorArtTextureKey } = await import('../packages/engine-layout/src/lib/editorArtKey.ts');
const { salmonsRiver } = await import('../packages/engine-mechanics/src/salmons.js');

const textureOf = (() => {
	const made = new Map();
	return (name, w = 64, h = 96) => {
		if (!made.has(name)) {
			const texture = new Texture({ frame: new Rectangle(0, 0, w, h) });
			texture.label = name;
			made.set(name, texture);
		}
		return made.get(name);
	};
})();
const riverArt = {
	region: (name) => textureOf(name),
	face: textureOf('waterfall_face'),
	cliff: textureOf('cliff'),
};
const riverApp = {
	renderer: { generateTexture: () => new Texture(), screen: { width: 1e7, height: 1e7 } },
	ticker: { add() {}, remove() {} },
};
const TREES = 'invisible_wall/salmons/manifests/atlas_manifest_S_Trees.json';
const treeAssets = {
	[editorArtTextureKey(TREES, 'pine')]: textureOf('pine', 40, 100),
	[editorArtTextureKey(TREES, 'fir')]: textureOf('fir', 60, 90),
	[editorArtTextureKey(TREES, 'sway_0')]: textureOf('sway_0', 50, 110),
	[editorArtTextureKey(TREES, 'sway_1')]: textureOf('sway_1', 50, 110),
};
registerFlipbooks([
	{ id: 'tree_sway', name: 'Sway', assetKey: TREES, frames: ['sway_0', 'sway_1'], fps: 4 },
]);
const PINE = { kind: 'sprite', region: `${TREES}::pine` };
const FIR = { kind: 'sprite', region: `${TREES}::fir` };
const SWAY = { kind: 'flipbook', clip: 'tree_sway' };
const TREE_W = 96 * K;

/** What a river of `seed` draws with `zoneArt`: every upright piece and every piece among the
 *  players, in order, and the regions it drew. */
const drawnRiver = (river, seed, zoneArt) => {
	const into = new Container();
	const layer = new Container();
	const unregister = registerProjectedLayer(SALMONS_FIELD_LAYER, layer);
	const drawn = mountSalmonsRiver(
		into,
		riverApp,
		riverArt,
		river,
		seed,
		ISO_PROJECTOR_MIRRORED,
		zoneArt,
	);
	const piece = (v) => ({
		label: v.label,
		x: v.x,
		y: v.y,
		z: v.zIndex,
		sx: v.scale.x,
		sy: v.scale.y,
		anchor: v.anchor ? [v.anchor.x, v.anchor.y] : undefined,
		texture: v.texture?.label ?? v.constructor.name,
		frames: v instanceof AnimatedSprite ? v.textures.map((t) => t.label) : undefined,
		frame: v instanceof AnimatedSprite ? v.currentFrame : undefined,
		playing: v instanceof AnimatedSprite ? v.playing : undefined,
	});
	const upright = into.children.at(-1);
	const out = {
		pieces: [...upright.children, ...layer.children].map(piece),
		regions: drawn.regions(),
	};
	drawn.teardown();
	unregister();
	return out;
};
const isTree = (p) => p.texture.startsWith('tree_');
const treeCount = (regions) =>
	Object.entries(regions)
		.filter(([name]) => name.startsWith('tree_'))
		.reduce((n, [, count]) => n + count, 0);
const SEED = 7;
const rivers = [
	['the band river', salmonsRiver()],
	["the original's map", salmonsMapRiver(SALMONS_MAP_SEED)],
];

for (const [label, river] of rivers) {
	const bare = drawnRiver(river, SEED);
	check(`zone art's trees, ${label}: nothing set or nothing loaded draws exactly as today`, () => {
		assert.ok(treeCount(bare.regions) > 100, 'the river draws its trees');
		assert.deepEqual(drawnRiver(river, SEED, { stamps: [], assets: () => treeAssets }), bare);
		assert.deepEqual(
			drawnRiver(river, SEED, {
				stamps: [],
				trees: { source: PINE, variants: [SWAY], placement: 'stamp' },
				assets: () => ({}),
			}),
			bare,
			'a picture not loaded draws the built-in tree',
		);
	});
	check(
		`zone art's trees, ${label}: every tree draws the frame, a tree's width times the scale, on its foot; nothing else moves`,
		() => {
			const art = drawnRiver(river, SEED, {
				stamps: [],
				trees: { source: PINE, placement: 'stamp', scale: 1.5 },
				assets: () => treeAssets,
			});
			const { 'zoneArt:@trees': trees, ...others } = art.regions;
			assert.equal(trees, treeCount(bare.regions), 'as many trees as the built-in art draws');
			assert.deepEqual(
				others,
				Object.fromEntries(
					Object.entries(bare.regions).filter(([name]) => !name.startsWith('tree_')),
				),
				'every other region as often',
			);
			assert.equal(art.pieces.length, bare.pieces.length);
			bare.pieces.forEach((was, i) => {
				const now = art.pieces[i];
				if (!isTree(was)) return assert.deepEqual(now, was, `piece ${i} (${was.texture}) moved`);
				assert.deepEqual(
					[now.x, now.y, now.z, now.anchor, now.texture],
					[was.x, was.y, was.z, [0.5, 1], 'pine'],
					`tree ${i}`,
				);
				assert.ok(
					Math.abs(now.sx * 40 - TREE_W * 1.5) < 1e-9 && now.sy === now.sx,
					`tree ${i}'s size`,
				);
			});
		},
	);
}

check(
	"zone art's trees: variants and a clip, by the seed and the cell, the same on every device",
	() => {
		const [, river] = rivers[0];
		const bare = drawnRiver(river, SEED);
		const trees = { source: PINE, variants: [FIR, SWAY], placement: 'stamp' };
		const one = drawnRiver(river, SEED, { stamps: [], trees, assets: () => treeAssets });
		assert.deepEqual(drawnRiver(river, SEED, { stamps: [], trees, assets: () => treeAssets }), one);
		const drawnTrees = one.pieces.filter((_, i) => isTree(bare.pieces[i]));
		const kinds = (list) => list.map((p) => (p.frames ? 'sway' : p.texture));
		const count = (name) => kinds(drawnTrees).filter((k) => k === name).length;
		assert.ok(
			['pine', 'fir', 'sway'].every((k) => count(k) > drawnTrees.length / 6),
			JSON.stringify({ pine: count('pine'), fir: count('fir'), sway: count('sway') }),
		);
		const other = drawnRiver(river, SEED + 1, { stamps: [], trees, assets: () => treeAssets });
		assert.notDeepEqual(kinds(other.pieces), kinds(one.pieces), 'another seed picks otherwise');
		for (const tree of drawnTrees.filter((p) => p.frames)) {
			assert.deepEqual(tree.frames, ['sway_0', 'sway_1']);
			assert.ok(tree.playing, 'a clip plays');
		}
		const starts = new Set(drawnTrees.filter((p) => p.frames).map((p) => p.frame));
		assert.deepEqual([...starts].sort(), [0, 1], "a clip's trees start on different frames");
	},
);

// Zone art's rigs: the river handed a stand-in rig drawing, each picture a container measured as a
// 40 × 20 box, recording what it was asked and how far it was moved on.
const { normalizeZoneArt, zoneArtPhaseFor, zoneArtStamps } =
	await import('../packages/game-config/src/zoneArt.ts');
const rigDrawing = () => {
	const made = [];
	const draw = (source, phase) => {
		const view = new Container({ label: `rig:${source.rig}` });
		view.boundsArea = new Rectangle(-20, -10, 40, 20);
		const rig = {
			view,
			w: 40,
			h: 20,
			source,
			phase,
			moved: 0,
			destroyed: false,
			update(ms) {
				this.moved += ms;
			},
			drawn: () => ({}),
			destroy() {
				this.destroyed = true;
				if (!view.destroyed) view.destroy();
			},
		};
		made.push(rig);
		return rig;
	};
	return { draw, made };
};
/** A river's zones as its room's are named: its rocks, whirlpools and sandbanks. */
const riverZones = (river) => [
	...(river.rocks ?? []).map((r, i) => ({ id: `rock${i}`, x: r.x, y: r.y, w: r.w, h: r.h })),
	...river.whirlpools.map((p, i) => ({
		id: `whirlpool${i}`,
		x: p.x - p.r,
		y: p.y - p.r,
		w: 2 * p.r,
		h: 2 * p.r,
	})),
	...(river.sandbanks ?? []).map((b, i) => ({
		id: `sandbank${i}`,
		x: b.x,
		y: b.y,
		w: b.w,
		h: b.h,
	})),
];
const rigOf = (rig) => ({ kind: 'rig', rig, animation: 'idle' });
const RIG_MAP = normalizeZoneArt({
	'rock#': { source: rigOf('R_Rock'), placement: 'stamp', scale: 1.5 },
	'whirlpool#': { source: rigOf('R_Pool'), placement: 'stamp' },
	'sandbank#': { source: rigOf('R_Sand'), placement: 'stamp' },
});
const labelled = (pieces, label) => pieces.filter((p) => p.label === label);
const isBuiltInStamp = (p) =>
	p.texture.startsWith('rock_') || (p.frames ?? []).some((f) => f.startsWith('whirlpool_'));

for (const [label, river] of rivers) {
	const stamps = zoneArtStamps(riverZones(river), RIG_MAP, SEED);
	const bare = drawnRiver(river, SEED);
	check(
		`zone art's rigs, ${label}: no rig drawing handed, or a rig not loaded, draws exactly as today`,
		() => {
			assert.deepEqual(drawnRiver(river, SEED, { stamps, assets: () => ({}) }), bare);
			assert.deepEqual(
				drawnRiver(river, SEED, { stamps, assets: () => ({}), rig: () => undefined }),
				bare,
			);
		},
	);
	check(
		`zone art's rigs, ${label}: every rock and whirlpool is its rig at the built-in picture's place, depth and size times the scale; a sandbank's stands on its zone; nothing else moves`,
		() => {
			const { draw, made } = rigDrawing();
			const art = drawnRiver(river, SEED, { stamps, assets: () => ({}), rig: draw });
			const rocks = river.rocks.length;
			const pools = river.whirlpools.length;
			const banks = river.sandbanks.length;
			const {
				'zoneArt:rock#': r,
				'zoneArt:whirlpool#': w,
				'zoneArt:sandbank#': b,
				...others
			} = art.regions;
			assert.deepEqual([r, w, b], [rocks, pools, banks]);
			assert.deepEqual(
				others,
				Object.fromEntries(
					Object.entries(bare.regions).filter(
						([name]) => !name.startsWith('rock_') && !name.startsWith('whirlpool_'),
					),
				),
				'every other region as often, none of the built-in rocks and whirlpools',
			);
			assert.deepEqual(
				art.pieces.filter((p) => !p.label?.startsWith('rig:')),
				bare.pieces.filter((p) => !isBuiltInStamp(p)),
				'every other piece where it was, in its order',
			);
			const pairs = [
				['rig:R_Rock', bare.pieces.filter((p) => p.texture.startsWith('rock_')), 1.5],
				['rig:R_Pool', bare.pieces.filter((p) => isBuiltInStamp(p) && p.frames), 1],
			];
			for (const [rig, builtIn, scale] of pairs) {
				const drawn = labelled(art.pieces, rig);
				assert.equal(drawn.length, builtIn.length, rig);
				drawn.forEach((now, i) => {
					const was = builtIn[i];
					assert.deepEqual([now.x, now.y, now.z], [was.x, was.y, was.z], `${rig} ${i}'s place`);
					// The stand-ins are 64 px wide; the rig's box 40: its size is the picture's.
					for (const axis of ['sx', 'sy'])
						assert.ok(
							Math.abs(now[axis] - (was[axis] * 64 * scale) / 40) < 1e-9,
							`${rig} ${i}'s ${axis}: ${now[axis]} for ${was[axis]}`,
						);
				});
			}
			const sand = labelled(art.pieces, 'rig:R_Sand');
			assert.equal(sand.length, banks);
			for (const stamp of stamps.filter((s) => s.family === 'sandbank#')) {
				const fit = Math.min(stamp.w / 40, stamp.h / 20);
				assert.ok(
					sand.some((p) => Math.abs(p.sx - fit) < 1e-9 && p.sy === p.sx),
					`${stamp.zone} fitted inside its zone`,
				);
			}
			assert.deepEqual(
				made.map((m) => [m.source.rig, m.phase]).sort(),
				stamps.map((s) => [s.source.rig, zoneArtPhaseFor(s.zone, SEED)]).sort(),
				'each starts where its zone and the seed say',
			);
			assert.ok(
				made.every((m) => m.destroyed),
				'and goes with the river',
			);
		},
	);
}

check("zone art's rigs: each moves on with the river's ticker while in view", () => {
	const [, river] = rivers[0];
	const { draw, made } = rigDrawing();
	const ticks = [];
	const app = { ...riverApp, ticker: { add: (fn) => ticks.push(fn), remove() {} } };
	const into = new Container();
	const layer = new Container();
	const unregister = registerProjectedLayer(SALMONS_FIELD_LAYER, layer);
	const drawn = mountSalmonsRiver(into, app, riverArt, river, SEED, ISO_PROJECTOR_MIRRORED, {
		stamps: zoneArtStamps(riverZones(river), RIG_MAP, SEED),
		assets: () => ({}),
		rig: draw,
	});
	made[0].view.visible = false;
	for (const tick of ticks) tick({ deltaMS: 16 });
	assert.ok(made.length > 3);
	assert.equal(made[0].moved, 0, 'one out of view is not moved on');
	assert.ok(made.slice(1).every((m) => m.moved === 16));
	drawn.teardown();
	unregister();
	assert.ok(made.every((m) => m.destroyed));
});

// Biomes (2026-11-26; `engine-mechanics` `salmonsBiomes.js`): the river drawn in Node, piece for
// piece (`salmons/art-fingerprint.mjs`): a level with no biomes block is drawn exactly as it was.
// The hashes were of the drawing at main a404522, before the biomes were data, and the same of
// main's after its trees' art (#1922). Since the river is drawn in chunks (2026-11-27) they are of
// what is drawn and in which order, not of the containers that hold it; recorded of main 665b407's
// drawing, the last laid loose, which this one draws alike.
const { riverArtFingerprint } = await import('./salmons/art-fingerprint.mjs');
const { ISO_PROJECTOR } = await import('../packages/engine-layout/src/lib/projection.ts');
const { levelShape } = await import('../packages/engine-mechanics/src/salmonsMap.js');
const { SALMONS_LEVELS } = await import('../packages/engine-mechanics/src/salmons.js');
const DRAWN_BEFORE_BIOMES = [
	{ seed: 1, levels: undefined, projector: 'mirrored', hash: '6a92bfaa1328bae46bf10584' },
	{ seed: 7, levels: SALMONS_LEVELS, projector: 'mirrored', hash: '1958546a26690ea154a35aed' },
	{
		seed: 123,
		levels: { river: {}, waterfalls: { heightMin: 5, heightMax: 10 } },
		projector: 'mirrored',
		hash: 'b5fb208cb528704ff1cb5f01',
	},
	{ seed: 42, levels: undefined, projector: 'plain', hash: '083661d70dd1ab4fab36c9c6' },
];
const PROJECTORS = { mirrored: ISO_PROJECTOR_MIRRORED, plain: ISO_PROJECTOR };
const riverOf = (seed, levels) => salmonsMapRiver(seed, undefined, levelShape(levels, seed));
const fingerprints = [];
for (const { seed, levels, projector, hash } of DRAWN_BEFORE_BIOMES) {
	const drawn = await riverArtFingerprint(riverOf(seed, levels), PROJECTORS[projector]);
	fingerprints.push({ seed, hash, drawn });
}
check('biomes: with none authored the river is drawn as before them, piece for piece', () => {
	for (const { seed, hash, drawn } of fingerprints)
		assert.equal(drawn.hash, hash, `seed ${seed}: ${drawn.pieces} pieces`);
});

const AUTHORED = {
	kinds: [
		{
			id: 'birch',
			trees: [4],
			forestFloor: '#6a5a2a',
			grassTint: '#e0f0a0',
			riverbed: ['#101010', '#202020'],
			grass: 2,
			forest: 4,
		},
		{ id: 'forest1' },
	],
	sequences: {
		'*': [
			{ from: 0, biome: 'birch' },
			{ from: 200, biome: 'forest1' },
		],
	},
};
const authoredRiver = riverOf(7, { ...SALMONS_LEVELS, biomes: AUTHORED });
const authoredArt = await riverArtFingerprint(authoredRiver, ISO_PROJECTOR_MIRRORED);
const builtInArt = await riverArtFingerprint(
	riverOf(7, { ...SALMONS_LEVELS, biomes: {} }),
	ISO_PROJECTOR_MIRRORED,
	{ omit: (into) => into.children[3].children[0].children[0].destroy() },
);
check(
	'biomes: the built-in six, authored as a block, draw the river as before but its floor',
	() => {
		assert.equal(builtInArt.hash, fingerprints[1].hash);
	},
);
check('biomes: an authored stretch draws its own trees, floor, grass tint and riverbed', () => {
	const rows = authoredArt.rows;
	const trees = rows.filter((r) => /^tree_\d$/.test(r.at(-1) ?? ''));
	assert.ok(trees.length > 1000, `${trees.length} trees`);
	const fills = rows.filter((r) => r[0] === 'Graphics').map((r) => r.at(-1));
	const floor = (hex) => fills.some((f) => f.includes(`"fill",${parseInt(hex.slice(1), 16)},`));
	assert.ok(floor('#6a5a2a'), 'the birch floor is drawn');
	assert.ok(floor('#28591e'), 'and the original floor below it');
	const made = rows.filter((r) => typeof r.at(-1) === 'string' && r.at(-1).startsWith('made:'));
	assert.ok(
		made.some((r) => r.at(-1).includes(`"fill",${0x101010},`)),
		'the birch riverbed is drawn',
	);
	const TINT = 8;
	const tinted = rows.filter((r) => r[TINT] === 0xe0f0a0 && /^grass_/.test(r.at(-1)));
	assert.ok(tinted.length > 100, `${tinted.length} tinted grass tiles`);
	assert.ok(
		rows.filter((r) => /^grass_/.test(r.at(-1) ?? '') && r[TINT] === 0xffffff).length > 100,
		'the stretch below is untinted',
	);
	// The birch grows tree 4 alone, the original's first stretch below it trees 0 and 1.
	const variants = new Set(trees.map((r) => r.at(-1)));
	assert.deepEqual([...variants].sort(), ['tree_0', 'tree_1', 'tree_4']);
});

check("biomes and the trees' art: a biome's variants pick among the authored pictures", () => {
	const trees = { source: PINE, variants: [FIR, SWAY], placement: 'stamp' };
	const art = { stamps: [], trees, assets: () => treeAssets };
	const kindsOf = (biomes) => {
		const drawn = drawnRiver(riverOf(SEED, { biomes }), SEED, art);
		const bare = drawnRiver(riverOf(SEED, { biomes }), SEED);
		const picked = drawn.pieces.filter((_, i) => isTree(bare.pieces[i]));
		return new Set(picked.map((p) => (p.frames ? 'sway' : p.texture)));
	};
	// Variant v draws picture v of the source and its variants, round again past the last.
	assert.deepEqual([...kindsOf({ kinds: [{ id: 'a', trees: [1] }] })], ['fir']);
	assert.deepEqual([...kindsOf({ kinds: [{ id: 'a', trees: [0, 2] }] })].sort(), ['pine', 'sway']);
	assert.deepEqual([...kindsOf({ kinds: [{ id: 'a', trees: [3] }] })], ['pine']);
	// No biomes: the seed and the cell pick, as main draws it.
	const plain = drawnRiver(riverOf(SEED), SEED, art);
	assert.deepEqual(plain, drawnRiver(salmonsMapRiver(SEED), SEED, art));
});

const { MENU, riverLineScale } = await import(join(ART, 'screens.ts'));
check(
	"the lobby's players line pops inside the margins on a narrow canvas, and rests at 1 on a wide one",
	() => {
		const top = 0.5;
		for (const room of [0.4, 0.8, 1, 1.1, 1.15, 2]) {
			const atTop = riverLineScale(room, top);
			assert.ok(
				atTop <= room + 1e-9,
				`room ${room}: the top of the pop is ${atTop}, past the margins`,
			);
			assert.ok(atTop > riverLineScale(room, -1), `room ${room}: no pop`);
		}
		assert.equal(riverLineScale(2, -1), 1);
		assert.equal(riverLineScale(2, top), 1 + MENU.popGrow);
	},
);

// The spawn layer's depth order (2026-11-27, `depthOrder.ts`): a projected world's instances are
// sorted only when a body's depth changes the order. Played against a layer whose zIndex is set
// every frame, as before: moves (ties and crossings), spawns (sorted at once, as a mount sorts),
// despawns and pieces with a fixed zIndex coming and going; the order drawn is the same every
// frame, every body's zIndex is its depth whenever a draw list is built, and the lazy layer sorts
// on far fewer of them.
const { setDepth } = await import('../packages/engine-layout/src/lib/depthOrder.ts');
check('the spawn layer sorts only when a depth changes the order, and draws the same order', () => {
	let seed = 7;
	const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	const eager = new Container();
	const lazy = new Container();
	const bodies = [];
	const pieces = [];
	let next = 0;
	const spawn = () => {
		const id = next++;
		const body = { id, depth: Math.floor(rand() * 40) * 4, a: new Container(), b: new Container() };
		body.a.label = body.b.label = `b${id}`;
		body.a.zIndex = body.depth;
		setDepth(body.b, body.depth);
		eager.addChild(body.a);
		eager.sortChildren();
		lazy.addChild(body.b);
		lazy.sortChildren();
		bodies.push(body);
	};
	const order = (parent) => parent.children.map((child) => child.label).join();
	const sorts = { eager: 0, lazy: 0 };
	const render = (parent, key) => {
		parent.onRender?.(undefined);
		if (parent.sortDirty) {
			sorts[key]++;
			// What reads a zIndex as the draw list is built (the underwater layer) reads the depth.
			if (parent === lazy)
				for (const body of bodies)
					assert.equal(body.b.zIndex, body.depth, `${body.b.label}'s zIndex at a build`);
		}
		if (parent.sortableChildren) parent.sortChildren();
	};
	for (let i = 0; i < 12; i++) spawn();
	for (let frame = 0; frame < 3000; frame++) {
		for (const body of bodies) {
			if (rand() < 0.6) body.depth += Math.floor(rand() * 3) - 1;
			body.a.zIndex = body.depth;
			setDepth(body.b, body.depth);
		}
		if (rand() < 0.02) spawn();
		if (rand() < 0.015 && bodies.length > 4) {
			const [gone] = bodies.splice(Math.floor(rand() * bodies.length), 1);
			gone.a.destroy();
			gone.b.destroy();
		}
		if (rand() < 0.03) {
			const z = Math.floor(rand() * 40) * 4;
			const a = new Container();
			const b = new Container();
			a.label = b.label = `p${next++}`;
			a.zIndex = b.zIndex = z;
			eager.addChild(a);
			lazy.addChild(b);
			pieces.push([a, b]);
		}
		if (rand() < 0.03 && pieces.length) {
			const [a, b] = pieces.splice(Math.floor(rand() * pieces.length), 1)[0];
			a.removeFromParent();
			b.removeFromParent();
		}
		render(eager, 'eager');
		render(lazy, 'lazy');
		assert.equal(order(lazy), order(eager), `frame ${frame}`);
	}
	assert.ok(sorts.lazy * 4 < sorts.eager, `sorted ${sorts.lazy} times, every frame ${sorts.eager}`);
});

console.log(`check:salmons-art: ${passed} passed`);
