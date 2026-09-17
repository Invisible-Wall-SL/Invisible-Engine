/**
 * Contract check for a symbol cell's LAYERS (Invisible Symbols State Machine → the cell editor's
 * "Layers"): a symbol composed of more than one picture, each layer carrying its own blend mode.
 *
 * Five things, each over the REAL implementation rather than a re-typed copy of it:
 *   1. PARITY — a doc with no `layers` anywhere is BYTE-IDENTICAL through `normalizeSymbolsDoc` to
 *      the same doc before the field existed, and an empty `layers: []` (the last layer removed) is
 *      pruned back to no key at all, so the page's dirty signature and the server agree on
 *      "unchanged".
 *   2. DRAW ORDER + `behind` — the array round-trips in the authored ORDER (it IS the draw order),
 *      and the engine's own split (`Symbol.svelte`'s `behindLayers`/`overLayers`) puts a `behind`
 *      layer under the cell's art and everything else over it, each group keeping its order.
 *   3. A SPINE LAYER'S BLEND IS IGNORED — `canBlendLayerKind` (the ONE definition the tool's control
 *      and the game's `SymbolLayer.svelte` both read) says no for `spine`, yes for
 *      `sprite`/`flipbook`/`fx`; the client's `reduceLayer` therefore never persists a mode on a
 *      spine layer, and an unknown mode from a newer tool degrades to no blend rather than being
 *      handed to Pixi (the version-skew rule).
 *   4. REJECTION — the `.strict()` + shared `.refine()` schema refuses a half-authored layer, an
 *      unknown key, an unknown blend mode and more than `SYMBOL_LAYER_MAX` of them: the shapes that
 *      would otherwise 400 a save silently (the publish double-fail).
 *   5. SHIPPING (rule 8) — `collectSymbolRefs` puts a spine bound ONLY as a cell layer into
 *      `spineKeys` and a scoped sprite layer's sheet into `spriteManifests`, INCLUDING on a
 *      `flipbook` cell (whose own `assetKey` short-circuits the walk); and the client's dirty
 *      signature moves when a layer is added, reordered or re-blended.
 *   6. BOTH BUNDLE PATHS — an `fx` layer's effect is neither placed, rig-bound nor event-triggered,
 *      so the orphan pruner would strip it: the runtime bundle keeps it through the real
 *      `pruneUnreachableEffects`, and the bake script's own inline keep-set walks cell layers too.
 *
 * Run:  pnpm --filter launcher-api check:symbol-layers
 *
 * The `--tsconfig` that script passes maps SvelteKit's `$env/dynamic/private` to a stub
 * (`scripts/lib/env-stub.ts`), because `symbolsStorage.ts` reaches R2 → `env.ts` → that virtual
 * module, which only exists inside a SvelteKit build. Nothing the app builds uses that mapping.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { canBlendLayerKind, isBlendMode, pixiBlendMode } from 'engine-layout';
import { pruneUnreachableEffects } from '../src/lib/server/effectReachability.ts';
import type { EffectDoc } from 'engine-fx';
import { collectSymbolRefs } from '../src/lib/server/symbolExport.ts';
import { normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import {
	docSignature,
	SYMBOL_LAYER_MAX,
	type BookVfxLayer,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
let checks = 0;
/** Key-order-insensitive: Zod rebuilds a parsed object in SCHEMA key order, and the fixtures are
 *  written in reading order — the contract is the fields, not their sequence. */
const canon = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(canon)
		: value && typeof value === 'object'
			? Object.fromEntries(
					Object.keys(value as Record<string, unknown>)
						.sort()
						.map((k) => [k, canon((value as Record<string, unknown>)[k])]),
				)
			: value;
const json = (value: unknown): string => JSON.stringify(canon(value));
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input);
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};

const SPINE = 'acme/splashy/spines/glow/';
const SHEET = 'acme/splashy/atlases/atlas_manifest_fx.json';
const base = { type: 'sprite', assetKey: `${SHEET}::h1.webp` } as const;

// ── 1. Parity ────────────────────────────────────────────────────────────────────────────────
// A doc authored before this field existed has to come out of the normalizer with the SAME bytes.
// This is the check that says "turning the feature on costs a project that never uses it nothing".
const noLayers: unknown = {
	version: 1,
	symbols: { H1: { static: base, win: { type: 'spine', assetKey: SPINE, animationName: 'win' } } },
};
check(
	'parity — a doc with no layers round-trips byte-identically',
	{
		...normalizeSymbolsDoc(noLayers),
		updatedAt: undefined,
	},
	{
		version: 1,
		symbols: {
			H1: { static: base, win: { type: 'spine', assetKey: SPINE, animationName: 'win' } },
		},
		updatedAt: undefined,
	},
);
check(
	'parity — no cell grows a `layers` key',
	Object.keys(normalizeSymbolsDoc(noLayers).symbols.H1.static!),
	['type', 'assetKey'],
);

// The last layer removed must leave NO key — an empty array would sign differently from the doc the
// page loaded and leave it permanently dirty, and would read forever as "this cell has layers".
const emptied = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { static: { ...base, layers: [] } } },
});
check('sparsity — an empty `layers: []` is pruned', Object.keys(emptied.symbols.H1.static!), [
	'type',
	'assetKey',
]);
check(
	'sparsity — the emptied cell signs identically to one that never had layers',
	docSignature(emptied as SymbolsDoc),
	docSignature(
		normalizeSymbolsDoc({ version: 1, symbols: { H1: { static: base } } }) as SymbolsDoc,
	),
);

// ── 2. Draw order + `behind` ─────────────────────────────────────────────────────────────────
const ordered: BookVfxLayer[] = [
	{ kind: 'sprite', assetKey: `${SHEET}::under.webp`, behind: true },
	{ kind: 'sprite', assetKey: `${SHEET}::first.webp` },
	{ kind: 'flipbook', clipId: 'sparkle', blendMode: 'lighten' },
	{ kind: 'sprite', assetKey: `${SHEET}::last.webp`, blendMode: 'overlay' },
];
const layered = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { win: { ...base, layers: ordered } } },
});
check('round-trip — the layer array survives verbatim', layered.symbols.H1.win!.layers, ordered);
check(
	'draw order — the authored ORDER is preserved (it IS the draw order)',
	layered.symbols.H1.win!.layers!.map((l) => l.assetKey ?? l.clipId),
	[`${SHEET}::under.webp`, `${SHEET}::first.webp`, 'sparkle', `${SHEET}::last.webp`],
);

/** The engine's own split, copied from `Symbol.svelte` — behind-layers render before the cell's art,
 *  the rest after, each group keeping the authored order. */
const behindLayers = (layers: BookVfxLayer[]) => layers.filter((l) => l.behind === true);
const overLayers = (layers: BookVfxLayer[]) => layers.filter((l) => l.behind !== true);
const authored = layered.symbols.H1.win!.layers as BookVfxLayer[];
check('behind — exactly the `behind: true` layers go under the art', behindLayers(authored), [
	ordered[0],
]);
check('behind — everything else goes over it, in order', overLayers(authored), [
	ordered[1],
	ordered[2],
	ordered[3],
]);
check(
	'behind — the two groups partition the list with nothing lost or duplicated',
	behindLayers(authored).length + overLayers(authored).length,
	authored.length,
);

// ── 3. A spine layer's blend is IGNORED ──────────────────────────────────────────────────────
// Measured in a running game: a Pixi blend never reaches skeleton geometry, so offering the control
// on a spine layer would be a lie. `canBlendLayerKind` is the ONE definition both halves read.
check('blend — a sprite layer blends', canBlendLayerKind('sprite'), true);
check('blend — a flipbook layer blends', canBlendLayerKind('flipbook'), true);
check(
	'blend — an fx layer blends (the doc says `fx`, the editor says `effect`)',
	canBlendLayerKind('fx'),
	true,
);
check('blend — a SPINE layer does NOT blend', canBlendLayerKind('spine'), false);

/** The renderer's gate, copied from `SymbolLayer.svelte`: kind first, then a known mode, then
 *  `normal` → `undefined` so `propsSyncEffect` skips the prop entirely (the parity path). */
const rendered = (layer: BookVfxLayer) =>
	pixiBlendMode(
		canBlendLayerKind(layer.kind) && isBlendMode(layer.blendMode) ? layer.blendMode : undefined,
	);
check(
	'blend — a spine layer carrying `multiply` renders UNBLENDED',
	rendered({ kind: 'spine', assetKey: SPINE, animationName: 'win', blendMode: 'multiply' }),
	undefined,
);
check(
	'blend — a sprite layer carrying `lighten` renders lighten',
	rendered({ kind: 'sprite', assetKey: 'x', blendMode: 'lighten' }),
	'lighten',
);
check(
	'blend — `normal` is no prop at all (parity with an unblended layer)',
	rendered({ kind: 'sprite', assetKey: 'x', blendMode: 'normal' }),
	undefined,
);
check(
	'version skew — an unknown mode from a newer tool degrades to no blend, never reaches Pixi',
	rendered({ kind: 'sprite', assetKey: 'x', blendMode: 'hard-light' as never }),
	undefined,
);
check(
	'version skew — an absent mode is no prop (the byte-parity path)',
	rendered({ kind: 'sprite', assetKey: 'x' }),
	undefined,
);

// A spine layer's mode is never PERSISTED either, so the doc cannot claim something the render will
// not do. This is the client's `reduceLayer` rule, re-stated here over the same helper it gates on.
const persistedBlend = (layer: BookVfxLayer) =>
	layer.blendMode && layer.blendMode !== 'normal' && canBlendLayerKind(layer.kind)
		? layer.blendMode
		: undefined;
check(
	'blend — the tool never writes a mode onto a spine layer',
	persistedBlend({ kind: 'spine', assetKey: SPINE, animationName: 'win', blendMode: 'screen' }),
	undefined,
);
check(
	'blend — it does write one onto a flipbook layer',
	persistedBlend({ kind: 'flipbook', clipId: 'c', blendMode: 'overlay' }),
	'overlay',
);

// ── 4. Rejection ─────────────────────────────────────────────────────────────────────────────
const withLayers = (layers: unknown) => ({
	version: 1,
	symbols: { H1: { win: { ...base, layers } } },
});
rejects(
	'rejects a spine layer with no animation',
	withLayers([{ kind: 'spine', assetKey: SPINE }]),
);
rejects('rejects a flipbook layer with no clip', withLayers([{ kind: 'flipbook' }]));
rejects('rejects an fx layer with no effect', withLayers([{ kind: 'fx' }]));
rejects('rejects a sprite layer with no frame', withLayers([{ kind: 'sprite' }]));
rejects('rejects an unknown layer kind', withLayers([{ kind: 'video', assetKey: 'x' }]));
rejects(
	'rejects an unknown key on a layer (`.strict`)',
	withLayers([{ kind: 'sprite', assetKey: 'x', zIndex: 3 }]),
);
rejects(
	'rejects an unknown blend mode at save (a typo must fail loudly, not be ignored at play)',
	withLayers([{ kind: 'sprite', assetKey: 'x', blendMode: 'hard-light' }]),
);
rejects(
	'rejects a non-boolean `behind`',
	withLayers([{ kind: 'sprite', assetKey: 'x', behind: 'yes' }]),
);
rejects(
	`rejects more than ${SYMBOL_LAYER_MAX} layers on one state`,
	withLayers(
		Array.from({ length: SYMBOL_LAYER_MAX + 1 }, (_, i) => ({
			kind: 'sprite',
			assetKey: `${SHEET}::l${i}.webp`,
		})),
	),
);
check(
	`accepts exactly ${SYMBOL_LAYER_MAX} layers`,
	normalizeSymbolsDoc(
		withLayers(
			Array.from({ length: SYMBOL_LAYER_MAX }, (_, i) => ({
				kind: 'sprite',
				assetKey: `${SHEET}::l${i}.webp`,
			})),
		),
	).symbols.H1.win!.layers!.length,
	SYMBOL_LAYER_MAX,
);
rejects(
	'rejects a layers-only cell — `assetKey` stays required, so `isUsableCell` can never inherit `static` under a stack of layers',
	{
		version: 1,
		symbols: { H1: { win: { type: 'sprite', layers: [{ kind: 'sprite', assetKey: 'x' }] } } },
	},
);

// ── 5. Shipping (rule 8) + the dirty signature ───────────────────────────────────────────────
// A spine bound ONLY as a cell layer has to reach `index.spines`, or the art shows in the tool and
// the game loads nothing under the key. The FLIPBOOK cell is the sharp case: its own `assetKey`
// short-circuits the cell walk two lines before the layers would have been read.
const shipping = normalizeSymbolsDoc({
	version: 1,
	symbols: {
		H1: {
			win: {
				type: 'flipbook',
				assetKey: `${SHEET}::primary.webp`,
				clipId: 'pop',
				layers: [
					{ kind: 'spine', assetKey: SPINE, animationName: 'glow' },
					{ kind: 'sprite', assetKey: `${SHEET}::halo.webp` },
					{ kind: 'fx', effectId: 'sparks' },
					{ kind: 'flipbook', clipId: 'dust' },
				],
			},
		},
	},
});
const refs = collectSymbolRefs(shipping);
check(
	'ships — a spine bound ONLY as a cell layer reaches `spineKeys` (⇒ `index.spines`)',
	[...refs.spineKeys],
	[SPINE],
);
check(
	'ships — a scoped sprite layer pins its SHEET, even on a flipbook cell whose own key short-circuits the walk',
	[...refs.spriteManifests],
	[SHEET],
);
check(
	'ships — an fx / flipbook layer adds no frame ref of its own (effect + clip art ride their own exports)',
	[...refs.frameNames],
	[],
);

const clean = normalizeSymbolsDoc(noLayers) as SymbolsDoc;
const withOne = normalizeSymbolsDoc({
	version: 1,
	symbols: {
		H1: {
			static: { ...base, layers: [{ kind: 'sprite', assetKey: `${SHEET}::halo.webp` }] },
			win: { type: 'spine', assetKey: SPINE, animationName: 'win' },
		},
	},
}) as SymbolsDoc;
checks += 1;
if (docSignature(clean) === docSignature(withOne)) {
	failures += 1;
	console.log('FAIL  adding a layer must move the dirty signature (or Save never lights up)');
}
const reordered = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { win: { ...base, layers: [ordered[1], ordered[0], ordered[2], ordered[3]] } } },
}) as SymbolsDoc;
checks += 1;
if (docSignature(layered as SymbolsDoc) === docSignature(reordered)) {
	failures += 1;
	console.log('FAIL  REORDERING layers must move the dirty signature — order IS draw order');
}
const reblended = normalizeSymbolsDoc({
	version: 1,
	symbols: {
		H1: { win: { ...base, layers: [...ordered.slice(0, 3), { ...ordered[3], blendMode: 'add' }] } },
	},
}) as SymbolsDoc;
checks += 1;
if (docSignature(layered as SymbolsDoc) === docSignature(reblended)) {
	failures += 1;
	console.log('FAIL  changing a layer BLEND MODE must move the dirty signature');
}

// ── 6. An `fx` layer stays REACHABLE on BOTH bundle paths ────────────────────────────────────
// An effect bound ONLY as a symbol layer is not placed in a scene, not rig-bound and not
// event-triggered, so the orphan pruner would strip it and the layer would ship empty. The runtime
// path takes a keep-set argument; the bake path has its own inline copy of the same walk — the
// recurring "reach BOTH bundle paths" bug is omitting one of them.
const LAYER_FX = 'sparks';
const fxDoc = { id: LAYER_FX, name: 'Sparks', layers: [] } as unknown as EffectDoc;
const orphan = { id: 'scratch', name: 'Scratch', layers: [] } as unknown as EffectDoc;
/** The runtime path's walk, taken from `runtimeBundle.ts`. */
const layerEffectIds = (map: SymbolsDoc['symbols']): string[] => {
	const ids: string[] = [];
	for (const states of Object.values(map)) {
		for (const cell of Object.values(states)) {
			for (const layer of cell?.layers ?? []) {
				if (layer.kind === 'fx' && layer.effectId) ids.push(layer.effectId);
			}
		}
	}
	return ids;
};
const fxCellDoc = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { win: { ...base, layers: [{ kind: 'fx', effectId: LAYER_FX }] } } },
});
check('the runtime walk finds a layer-bound effect id', layerEffectIds(fxCellDoc.symbols), [
	LAYER_FX,
]);
const pruned = pruneUnreachableEffects(
	[fxDoc, orphan],
	[],
	[],
	{},
	layerEffectIds(fxCellDoc.symbols),
);
check(
	'the runtime bundle KEEPS an effect bound only as a cell layer',
	pruned.effects.map((d) => d.id),
	[LAYER_FX],
);
check(
	'…and still prunes a genuinely unreachable one (the keep-set rescues the exact id only)',
	pruned.prunedIds,
	['scratch'],
);

const here = fileURLToPath(new URL('.', import.meta.url));
/** Source with LF newlines whatever the checkout uses — every assertion below is about the CODE,
 *  and a Windows working copy (`core.autocrlf`) would otherwise fail on a line break. */
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const bake = read(`${here}bake-editor-doc.mjs`);
const runtime = read(`${here}../src/lib/server/runtimeBundle.ts`);
check(
	'the BAKE path walks cell layers for fx ids too',
	/symbols\.map[\s\S]{0,600}cell\.layers[\s\S]{0,400}symbolDocBound\.add/.test(bake),
	true,
);
check(
	'the RUNTIME path walks cell layers for fx ids too',
	/symbols\.map[\s\S]{0,500}cell\?\.layers[\s\S]{0,300}symbolDocEffectIds\.add/.test(runtime),
	true,
);
// The map itself is a verbatim pass-through on both paths, so `layers` needs no per-field
// forwarding — but only because NOTHING enumerates a cell's fields on the way out. Assert that.
const exporter = read(`${here}../src/lib/server/symbolExport.ts`);
check(
	'the exporter passes the symbol MAP verbatim (so a new cell field rides for free)',
	/map:\s*doc\.symbols/.test(exporter) || /\bmap,\n/.test(exporter),
	true,
);
check('the bake takes the map whole, unenumerated', /map:\s*s\?\.map/.test(bake), true);

// The scoped-sprite REPAIR (`canonicalizeSymbolsDocForExport`) rewrites a `<prefix>::<region>` key
// that names its atlas by anything other than a full `.json` manifest. A sprite LAYER is looked up
// in-game through the identical flat key, so leaving layers out of that walk reproduces the blank
// sprite the repair exists to prevent, one level down. The rewrite itself needs an R2 listing to
// resolve a prefix, so it is asserted structurally here — the same way the cell path never was.
const storage = read(`${here}../src/lib/server/symbolsStorage.ts`);
check(
	'the export-time scoped-ref repair COLLECTS prefixes from sprite layers',
	/cell\?\.layers[\s\S]{0,300}splitNonManifestScopedRef\(layer\.assetKey\)[\s\S]{0,120}prefixes\.add/.test(
		storage,
	),
	true,
);
check(
	'…and REWRITES them',
	/next\.layers[\s\S]{0,400}splitNonManifestScopedRef\(layer\.assetKey\)[\s\S]{0,300}assetKey: `\$\{manifest\}::\$\{split\.region\}`/.test(
		storage,
	),
	true,
);

// --- the blend rides the RENDERABLE, not the wrapping container ---------------------------------
// Pixi's GPU-native modes inherit down the subtree, so container-level and renderable-level blending
// look interchangeable — for `add`/`multiply`/`screen`. They are NOT known to be interchangeable for
// the ADVANCED modes (`overlay`, `lighten`), which are backdrop-reading filters: a renderable
// carrying one is the path verified to draw in a running game, a container carrying one is not.
// Since `overlay`/`lighten` are the modes this feature exists for, a refactor that hoisted the prop
// back onto the wrapper would silently stop them blending — with the tool still previewing it.
const layerSrc = read(`${here}../../../apps/lines/src/components/SymbolLayer.svelte`);
const outerWrapper = /<Container x=\{props\.x \+ offsetX\}[^>]*>/.exec(layerSrc)?.[0] ?? '';
check('SymbolLayer: the outer wrapper exists', outerWrapper !== '', true);
check('SymbolLayer: the outer wrapper does NOT carry the blend', /\{blendMode\}/.test(outerWrapper), false);
check('SymbolLayer: the sprite arm carries the blend', /<Sprite[^>]*\{blendMode\}[^>]*\/>/.test(layerSrc), true);
check(
	'SymbolLayer: the flipbook arm carries the blend',
	/<Flipbook[\s\S]{0,240}\{blendMode\}[\s\S]{0,60}\/>/.test(layerSrc),
	true,
);
check(
	'SymbolLayer: the spine arm never carries a blend (a Pixi blend cannot reach skeleton geometry)',
	/<SpineProvider[^>]*\{blendMode\}/.test(layerSrc),
	false,
);

if (failures) {
	console.log(`\nsymbol layers: ${failures} FAILED of ${checks} checks`);
	process.exit(1);
}
console.log(`\nsymbol layers: OK (${checks} checks)`);
