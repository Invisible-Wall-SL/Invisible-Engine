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
//
// Run: pnpm check:salmons-art

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
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
	createBlood,
	createRedness,
	underTintColour,
} from '../packages/engine-layout/src/lib/salmonsArt/blood.ts';
import { underTint } from '../packages/engine-layout/src/lib/salmonsArt/leap.ts';
import { CELL, K } from '../packages/engine-layout/src/lib/salmonsArt/scale.ts';
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
const { Container, Texture } = await import(
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
				reached.push(relative(ROOT, file));
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
		/const salmonsArt = async \(made: SalmonsRiverDrawing, seed: number\) =>\s*\(await import\('engine-layout\/salmons-art'\)\)\.loadSalmonsArt\(/,
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

check('bloodstains: the old client’s numbers', () => {
	assert.deepEqual(
		[BLOOD.alpha, BLOOD.contactCells, BLOOD.redMs, BLOOD.red, BLOOD.trailMs, BLOOD.trailEveryMs],
		[0.35, 0.8, 3000, 0xff3a3a, 3000, 70],
	);
	assert.deepEqual([BLOOD.trailAlpha, BLOOD.trailScale, BLOOD.turn], [0.5, 0.35, 0.4]);
	assert.deepEqual(BLOOD.scale, { min: 0.8, spread: 0.5 });
	assert.deepEqual(BLOOD.colours, { blood: 0x8a0f12, core: 0x5e0a0d });
});

check(
	'bloodstains: a stain’s colour under the water is the old picture’s, the tint over it',
	() => {
		const tint = 0x0ea5e9;
		const m = underTint(tint, 0.75);
		const c = BLOOD.colours.blood;
		const channel = (v, i) =>
			Math.round(255 * (m[i * 6] * (((v >> (16 - 8 * i)) & 0xff) / 255) + m[i * 5 + 4]));
		const mixed = underTintColour(c, tint, 0.75);
		for (let i = 0; i < 3; i++)
			assert.ok(Math.abs(((mixed >> (16 - 8 * i)) & 0xff) - channel(c, i)) <= 1, `channel ${i}`);
		assert.equal(underTintColour(c, undefined, 0.75), c, 'off the water, its own colour');
	},
);

/** A blood kit over a river that is water (tint `tint`) left of x = 1000 and raised 30 px past
 *  y = 500, drawn into a container through an app whose renderer makes plain textures. */
const bloodKit = (projector) => {
	const made = [];
	const blood = createBlood(
		(x) => (x < 1000 ? { tint: 0x0ea5e9 } : undefined),
		(_x, y) => (y < 500 ? 30 : 0),
		0.75,
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
	const [wake, sunk, surface] = river.children;
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
		assert.equal(low.alpha, BLOOD.alpha);
		assert.ok(low.scale.x >= K * 0.8 && low.scale.x <= K * 1.3);
		assert.ok(Math.abs(low.rotation) <= 0.2);
		drawn(two).forEach((s, i) => {
			assert.equal(s.rotation, drawn(one)[i].rotation, 'the same turn on every device');
			assert.equal(s.scale.x, drawn(one)[i].scale.x, 'the same size on every device');
		});
		assert.equal(one.made.length, 2, 'one texture for the water’s tint, one for dry ground');
		assert.ok(low.texture === high.texture && low.texture !== dry.texture);
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

check('bloodstains: the trail fades from 0.5 over 3 s, under the swimming salmon', () => {
	const { blood, wake } = bloodKit();
	blood.shed(300, 700, 1000);
	const puff = wake.children[0];
	assert.equal(puff.alpha, BLOOD.trailAlpha);
	assert.equal(puff.scale.x, K * BLOOD.trailScale);
	blood.frame(undefined, 2500);
	assert.ok(Math.abs(puff.alpha - 0.25) < 1e-9, 'half gone at 1.5 s');
	blood.frame(undefined, 4000);
	assert.equal(wake.children.length, 0, 'gone at 3 s');
	assert.deepEqual(blood.drawn(), { stains: 0, trail: 0 });
});

check(
	'bloodstains: drawn over the river, trail < swimming salmon < stains, in the players’ depth order',
	() => {
		const { blood, river, unmount, wake, sunk, surface } = bloodKit();
		assert.deepEqual(river.children, [wake, sunk, surface], 'wake, what swims, then the stains');
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

console.log(`check:salmons-art: ${passed} passed`);
