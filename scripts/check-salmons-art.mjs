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
	SALMONS_PROJECT_SHEETS,
	salmonsProjectManifestName,
	salmonsProjectSheetOf,
	usesSalmonsArt,
} from '../packages/game-config/src/salmonsProjectArt.ts';
import { ONLINE_GENERATOR_IDS } from '../packages/game-config/src/family.ts';
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
const { Container, FilterSystem, Matrix, Rectangle, RendererType, Texture } = await import(
	pathToFileURL(PIXI_CJS.replace(/index\.js$/, 'index.mjs')).href
);
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
		/const salmonsArt = async \(made: SalmonsRiverDrawing, seed: number, stains\?: StainLook\) =>\s*\(await import\('engine-layout\/salmons-art'\)\)\.loadSalmonsArt\(/,
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
		assert.deepEqual(wading.drawn(), { b: { depth: 0, tint: null, line: null, filtered: false } });

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
		assert.equal(wet.filtered, true);
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
		assert.deepEqual(wading.drawn().b, { depth: 0, tint: null, line: null, filtered: false });
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
			assert.deepEqual(refused.wading.drawn().b.filtered, false);
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

console.log(`check:salmons-art: ${passed} passed`);
