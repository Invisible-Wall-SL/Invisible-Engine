/**
 * Contract check for "readers ignore unknown fields" (`docs/conventions/doc-readers.md`): a doc
 * authored against a NEWER launcher must not fail, or silently vanish, on this build's reader.
 *
 * For every authored doc type the launcher reads, a realistic base doc is normalized twice — as is,
 * and with an unknown field added at the top level AND inside a nested CLOSED object (one whose keys
 * are a fixed set, not an open map where an extra key is simply a new entry). Both must normalize
 * without throwing and to byte-identical output.
 *
 * The three readers that validate through a Zod schema (symbols, win text, published symbol
 * defaults) strip unknown keys with `stripUnknownKeys`, so for them the check also proves:
 *   - the server WARNS once per unknown field, naming its dotted path;
 *   - the base doc warns about nothing;
 *   - an unknown symbol STATE key (records keyed by `z.enum(SYMBOL_STATES)`) is ignored too;
 *   - a malformed value under a KNOWN key still throws — ignoring the unknown is not ignoring junk.
 * Every other reader rebuilds its doc from a whitelist, which drops an unknown key silently.
 *
 * Three readers deliberately PASS THROUGH a subtree verbatim rather than whitelisting it — layout
 * nodes (`editorStorage.normalizeNode`), a component root's `children`, and each baked flight style
 * (`bakeFlights`). An unknown field there is KEPT, not ignored; it neither throws nor drops the doc,
 * so it meets the rule, and those sections assert the pass-through so a change to it is visible.
 *
 * Run:  pnpm --filter launcher-api check:doc-readers-unknown-fields
 *
 * The `--tsconfig` maps SvelteKit's `$env/dynamic/private` to a stub (`scripts/lib/env-stub.ts`),
 * because the storage modules reach R2 → `env.ts` → that virtual module.
 */

import type { ComponentDef } from 'engine-layout';
import {
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	freshDrivenSeedDoc,
	templateVocabulary,
	validateFlowDoc,
	type FlowDoc,
} from 'engine-flow-v2';
import { normalizeFlipbookClip, normalizeFlipbookDoc } from 'engine-flipbook';
import { normalizeEffectDoc } from 'engine-fx';
import { normalizeGameConfigDoc } from 'game-config';
import { z } from 'zod';
import { normalizeArtBoundsDoc } from '../src/lib/artBounds.ts';
import { normalizeComponent } from '../src/lib/server/componentStorage.ts';
import { normalizeDoc as normalizeLayoutDoc } from '../src/lib/server/editorStorage.ts';
import { isFlowV2Doc } from '../src/lib/server/flowV2Storage.ts';
import { normalizeFxMeta } from '../src/lib/server/fxStorage.ts';
import { normalizeDoc as normalizeLocalizationDoc } from '../src/lib/server/localization.ts';
import { normalizeRigTextDoc } from '../src/lib/server/riggerText.ts';
import { normalizeSoundsDoc } from '../src/lib/server/soundsStorage.ts';
import { stripUnknownKeys } from '../src/lib/server/stripUnknownKeys.ts';
import { parseSymbolDefaults } from '../src/lib/server/symbolDefaults.ts';
import { normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import { normalizeWinTextDoc } from '../src/lib/server/winTextStorage.ts';
import { bakeCoinLabel } from './lib/bakeCoinLabel.mjs';
import { bakeFlights } from './lib/bakeFlights.mjs';

let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	checks += 1;
	if (ok) return;
	failures += 1;
	console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

const json = (value: unknown): string => JSON.stringify(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Run {
	out: string;
	threw: string | null;
	warnings: string[];
}
/** Run a reader, capturing its result, whether it threw, and every `console.warn` it made. */
const run = (fn: () => unknown): Run => {
	const warnings: string[] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
	try {
		return { out: json(fn()), threw: null, warnings };
	} catch (e) {
		return { out: '', threw: String(e), warnings };
	} finally {
		console.warn = warn;
	}
};

/**
 * The doc with extras normalizes without throwing, to exactly what the base doc normalizes to.
 * `kept` are fragments the normalized base must contain — the objects that carry an extra really
 * survive normalization, so the equality is not two docs that both lost them.
 */
const ignores = <T>(
	section: string,
	read: (doc: T) => unknown,
	base: T,
	extras: T,
	kept: readonly string[],
): Run => {
	const a = run(() => read(base));
	const b = run(() => read(extras));
	check(`${section}: the base doc normalizes`, a.threw === null, a.threw ?? '');
	for (const fragment of kept)
		check(`${section}: the base keeps ${fragment}`, a.out.includes(fragment), a.out);
	check(`${section}: unknown fields do not throw`, b.threw === null, b.threw ?? '');
	check(
		`${section}: unknown fields leave the output byte-identical`,
		a.out === b.out,
		`base   ${a.out}\n        extras ${b.out}`,
	);
	return b;
};

/** {@link ignores}, plus: a warning names every unknown path, and the base doc warns about none. */
const ignoresWithWarning = <T>(
	section: string,
	read: (doc: T) => unknown,
	base: T,
	extras: T,
	kept: readonly string[],
	paths: readonly string[],
): void => {
	check(
		`${section}: the base doc warns about nothing`,
		run(() => read(base)).warnings.length === 0,
	);
	const { warnings } = ignores(section, read, base, extras, kept);
	for (const path of paths)
		check(
			`${section}: a warning names "${path}"`,
			warnings.some((w) => w.includes(`"${path}"`)),
			warnings.join(' | ') || '(no warnings)',
		);
	check(
		`${section}: one warning per unknown field`,
		warnings.length === paths.length,
		warnings.join(' | '),
	);
};

const throws = (section: string, label: string, fn: () => unknown): void =>
	check(`${section}: ${label} still throws`, run(fn).threw !== null);

// 0. the helper itself, on the Zod shapes the three schemas do not exercise yet.
{
	const removedBy = (schema: z.ZodTypeAny, input: unknown) => {
		const removed: string[] = [];
		const out = stripUnknownKeys(schema, input, (p) => removed.push(p));
		return { out: json(out), removed: removed.join(',') };
	};
	const a = z.object({ a: z.number() }).strict();
	const ab = z.object({ a: z.number(), b: z.number() }).strict();
	const union = removedBy(z.union([a, ab]), { a: 1, b: 2 });
	check(
		'0. helper: a union keeps a value a LATER option accepts as-is',
		union.out === '{"a":1,"b":2}' && union.removed === '',
		json(union),
	);
	const fewest = removedBy(z.union([a, ab]), { a: 1, b: 2, c: 3 });
	check(
		'0. helper: otherwise the option needing the fewest removals wins',
		fewest.out === '{"a":1,"b":2}' && fewest.removed === 'c',
		json(fewest),
	);
	const renamed = z.preprocess(
		(v) => (v && typeof v === 'object' && 'old' in v ? { neu: (v as { old: number }).old } : v),
		z.object({ neu: z.number() }).strict(),
	);
	const pre = removedBy(renamed, { old: 1 });
	check(
		'0. helper: a preprocess is not walked (it may rename keys)',
		pre.out === '{"old":1}' && pre.removed === '',
		json(pre),
	);
	const loose = removedBy(z.object({ a: z.number() }), { a: 1, extra: 2 });
	check(
		'0. helper: a `.strip()` object drops extras silently',
		loose.out === '{"a":1}' && loose.removed === '',
		json(loose),
	);
	const caught = removedBy(z.object({}).catchall(a), { k: { a: 1, x: 2 } });
	check(
		'0. helper: a catchall value is stripped against the catchall',
		caught.out === '{"k":{"a":1}}' && caught.removed === 'k.x',
		json(caught),
	);
}

// 1. symbols — strip-and-warn through `symbolsDocSchema`.
{
	const base = {
		version: 1,
		symbols: {
			H1: {
				static: { type: 'sprite', assetKey: 'symbols', sizeRatios: { width: 1, height: 1 } },
				win: { type: 'spine', assetKey: 'symbols/h1', animationName: 'win', loop: false },
			},
			BONUS: { coinIdle: { type: 'sprite', assetKey: 'coins' } },
		},
		names: { H1: { singular: 'Banana', plural: 'Bananas' } },
		winExplode: { enabled: true },
		coinLabel: {
			style: { font: 'coinFont', size: 0.4, tint: '#ffcc00' },
			cash: { format: 'betMultiple', decimals: 2 },
			animation: { landPop: { enabled: true, scale: 1.4, ms: 300 } },
		},
		flights: {
			toTotal: { head: { kind: 'glow', scale: 1.2 }, path: { bend: 0.3 }, speed: 900 },
		},
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.publishedBy = 'a newer launcher';
	Object.assign(extras.symbols.H1, { celebrate: { type: 'sprite', assetKey: 'symbols' } });
	Object.assign(extras.symbols.H1.static, { glowColor: '#fff' });
	Object.assign(extras.winExplode, { delayMs: 120 });
	Object.assign(extras.coinLabel.style, { weight: 'bold' });
	Object.assign(extras.flights.toTotal.head, { wobble: 2 });
	ignoresWithWarning(
		'1. symbols',
		normalizeSymbolsDoc,
		base,
		extras,
		[
			'"static":{"type":"sprite"',
			'"winExplode":{"enabled":true}',
			'"coinLabel":{"style":{',
			'"flights":{"toTotal":{"head":{',
		],
		// `publishedBy` sits on the `.strip()` root, which always dropped extras silently: no warning.
		[
			'symbols.H1.celebrate',
			'symbols.H1.static.glowColor',
			'winExplode.delayMs',
			'coinLabel.style.weight',
			'flights.toTotal.head.wobble',
		],
	);
	throws('1. symbols', 'winExplode.enabled: "yes"', () =>
		normalizeSymbolsDoc({ ...base, winExplode: { enabled: 'yes' } }),
	);
	throws('1. symbols', 'a cell with an unknown type', () =>
		normalizeSymbolsDoc({ symbols: { H1: { static: { type: 'gif', assetKey: 'x' } } } }),
	);
	// A key named like an `Object.prototype` member is unknown too, not "known through the chain".
	ignoresWithWarning(
		'1. symbols (prototype-named keys)',
		normalizeSymbolsDoc,
		base,
		JSON.parse(
			JSON.stringify(base).replace(
				'"winExplode":{"enabled":true}',
				'"winExplode":{"enabled":true,"toString":1,"__proto__":{"enabled":"yes"}}',
			),
		) as typeof base,
		['"winExplode":{"enabled":true}'],
		['winExplode.toString', 'winExplode.__proto__'],
	);
}

// 2. win text — strip-and-warn through `winTextDocSchema`; the incident shape was a Hold and Win doc.
{
	const base = {
		version: 1,
		lineMessage: { default: '{count} {symbolName}', byCount: { '2': 'PAIR!' } },
		toast: { full: 'You win {amount}', symbolAsImage: true },
		jackpots: { captions: { MINI: 'Mini', GRAND: 'Grand' }, award: '{jackpot}!' },
		respins: { counter: '{count} LEFT' },
		feature: { total: 'TOTAL {amount}', intro: 'HOLD ON', potNames: { red: 'Ruby' } },
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.bonusWheel = { spin: 'SPIN!' };
	Object.assign(extras.toast, { duration: 'long' });
	Object.assign(extras.jackpots, { ticker: '{jackpot} {amount}' });
	Object.assign(extras.feature, { meterEmpty: 'EMPTY' });
	ignoresWithWarning(
		'2. win text',
		normalizeWinTextDoc,
		base,
		extras,
		['"toast":{', '"jackpots":{', '"feature":{'],
		// `bonusWheel` sits on the `.strip()` root: dropped silently, as it always was.
		['toast.duration', 'jackpots.ticker', 'feature.meterEmpty'],
	);
	throws('2. win text', 'a non-string template', () =>
		normalizeWinTextDoc({ ...base, jackpots: { award: 3 } }),
	);
}

// 3. published symbol defaults — strip-and-warn through `symbolDefaultsSchema`.
{
	const cell = { type: 'sprite', assetKey: 'symbols', sizeRatios: { width: 1, height: 1 } };
	const base = {
		version: 1,
		gameType: 'lines',
		symbols: { H1: { static: cell, win: { ...cell, type: 'spine', animationName: 'win' } } },
		highlight: { type: 'spine', assetKey: 'payframe', sizeRatios: { width: 1, height: 1 } },
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.publishedAt = '2026-10-01';
	Object.assign(extras.symbols.H1, { celebrate: cell });
	Object.assign(extras.symbols.H1.static, { winFrame: 'frame' });
	Object.assign(extras.highlight, { glow: true });
	ignoresWithWarning(
		'3. symbol defaults',
		parseSymbolDefaults,
		base,
		extras,
		['"static":{"type":"sprite"', '"highlight":{'],
		// `publishedAt` and the cell's engine-only `winFrame` sit on `.strip()` objects: silent.
		['symbols.H1.celebrate', 'highlight.glow'],
	);
	throws('3. symbol defaults', 'a cell with an unknown type', () =>
		parseSymbolDefaults({ ...base, symbols: { H1: { static: { ...cell, type: 'gif' } } } }),
	);
}

// 4. scenes / layout — `editorStorage.normalizeDoc` rebuilds the doc and each scene; nodes pass.
{
	const node = { id: 'logo', kind: 'sprite', x: 0, y: 0, assetKey: 'ui::logo' };
	const base = {
		version: 2,
		projectKey: 'demo',
		gameType: 'lines',
		mainSizesMap: { desktop: { width: 1920, height: 1080 } },
		settings: { jurisdiction: 'UK', features: { turbo: true } },
		scenes: [{ id: 'basegame', name: 'Base game', role: 'basegame', nodes: [node] }],
		updatedAt: '2026-10-01T00:00:00.000Z',
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.theme = 'dark';
	Object.assign(extras.settings, { autoplayLimit: 50 });
	Object.assign(extras.settings.features, { quickSpin: true });
	Object.assign(extras.scenes[0], { parallax: 0.5 });
	Object.assign(extras.mainSizesMap.desktop, { dpi: 2 });
	ignores('4. layout', (d) => normalizeLayoutDoc(d, 'demo'), base, extras, [
		'"features":{"turbo":true}',
		'"id":"basegame"',
	]);

	const withNodeField = clone(base);
	Object.assign(withNodeField.scenes[0].nodes[0], { glow: 0.2 });
	const kept = run(() => normalizeLayoutDoc(withNodeField, 'demo'));
	check('4. layout: a node with an unknown field does not throw', kept.threw === null);
	check(
		'4. layout: a node passes through verbatim (unknown field KEPT, by design)',
		kept.out.includes('"glow":0.2'),
	);
}

// 5. flow v2 — the shape guard and the validator agree with and without extras.
{
	const base: FlowDoc = freshDrivenSeedDoc('lines');
	const extras = clone(base) as FlowDoc & Record<string, unknown>;
	extras.authoredBy = 'a newer launcher';
	Object.assign(extras.graph, { comments: [] });
	Object.assign(extras.graph.nodes[0], { color: '#ff0000' });
	const issues = (doc: FlowDoc) =>
		validateFlowDoc(
			doc,
			templateVocabulary(doc.templateId),
			{ version: 2, functions: [] },
			BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
		);
	check('5. flow v2: the base doc passes the shape guard', isFlowV2Doc(base));
	check('5. flow v2: unknown fields keep it passing the shape guard', isFlowV2Doc(extras));
	ignores('5. flow v2', issues, base, extras, []);
}

// 6. game config — `normalizeGameConfigDoc` rebuilds field by field.
{
	const base = {
		providerName: 'Invisible Wall',
		gameName: 'Demo',
		gameID: 'demo',
		rtp: 96.2,
		numReels: 3,
		numRows: [3, 3, 3],
		paylines: { '0': [0, 0, 0] },
		symbols: { H1: { name: 'H1' } },
		paddingReels: { BR: [['H1'], ['H1'], ['H1']] },
		betModes: {},
		reelBehaviour: { swapInPlace: true, swapStyle: 'columnCascade', columnStaggerMs: 140 },
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.volatility = 'high';
	Object.assign(extras.reelBehaviour, { bounce: true });
	Object.assign(extras.symbols.H1, { rarity: 3 });
	ignores('6. game config', normalizeGameConfigDoc, base, extras, [
		'"reelBehaviour":{',
		'"symbols":{"H1":',
	]);
}

// 7. localization — `localization.normalizeDoc` rebuilds the doc and each entry.
{
	const base = {
		sourceLang: 'en',
		targetLangs: ['es'],
		context: 'A fruit slot.',
		protectedTerms: ['Borut'],
		entries: [
			{
				id: 'e1',
				key: 'BIG WIN',
				source: 'BIG WIN',
				origin: 'winText',
				translations: { es: { text: 'GRAN PREMIO', reviewed: true } },
			},
		],
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.glossaryVersion = 3;
	Object.assign(extras.entries[0], { maxLength: 12 });
	Object.assign(extras.entries[0].translations.es, { reviewedBy: 'ana' });
	ignores('7. localization', normalizeLocalizationDoc, base, extras, [
		'"translations":{"es":{"text":"GRAN PREMIO"',
	]);
}

// 8. effects — `normalizeEffectDoc` (the layer's `config` is an open emitter config, kept verbatim)
//    and the editor-only `normalizeFxMeta` sidecar.
{
	const base = {
		version: 1,
		id: 'sparkle',
		name: 'Sparkle',
		layers: [
			{
				key: 'main',
				config: { lifetime: { min: 0.5, max: 1 }, behaviors: [] },
				art: { assetKey: 'fx', frames: ['star'] },
				placement: { space: 'free', offset: { x: 0, y: 10 } },
				trigger: { on: 'event', eventType: 'win', duration: 1 },
			},
		],
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.preview = { background: '#000' };
	Object.assign(extras.layers[0], { solo: true });
	Object.assign(extras.layers[0].art, { tint: '#fff' });
	Object.assign(extras.layers[0].placement, { rotation: 45 });
	Object.assign(extras.layers[0].trigger, { delayMs: 100 });
	ignores('8. effect doc', normalizeEffectDoc, base, extras, [
		'"art":{"assetKey":"fx"',
		'"placement":{"space":"free"',
		'"trigger":{"on":"event"',
	]);

	const meta = { camera: { x: 10, y: 20, scale: 1.5 }, selectedLayer: 'main' };
	const metaExtras = { ...clone(meta), grid: true, camera: { ...meta.camera, rotation: 0 } };
	ignores('8. fx meta', normalizeFxMeta, meta, metaExtras, ['"camera":{']);
}

// 9. flipbooks — the collection and the per-clip save gate.
{
	const clip = {
		id: 'coinSpin',
		name: 'Coin spin',
		assetKey: 'coins',
		frames: ['c1', 'c2', 'c2', 'c3'],
		fps: 24,
		loop: true,
		direction: 'pingpong',
		bounds: { x: -50, y: -50, w: 100, h: 100 },
	};
	const clipExtras = { ...clone(clip), easing: 'linear', bounds: { ...clip.bounds, pad: 4 } };
	ignores('9. flipbook clip', normalizeFlipbookClip, clip, clipExtras, ['"bounds":{']);
	ignores(
		'9. flipbook doc',
		normalizeFlipbookDoc,
		{ version: 1, clips: [clip] },
		{ version: 1, clips: [clipExtras], folders: ['coins'] },
		['"clips":[{"id":"coinSpin"'],
	);
}

// 10. sounds — `soundsDocSchema` is `.strip()` everywhere, then rebuilt field by field.
{
	const base = {
		version: 1,
		entries: [
			{
				id: 's1',
				name: 'tumble_pop',
				kind: 'sfx',
				file: 'tumble_pop.mp3',
				durationMs: 420,
				volume: 0.8,
				status: 'approved',
				reviewedBy: 'ana',
			},
		],
		bindings: {
			slots: { spinStart: { names: ['tumble_pop'], volume: 0.5 } },
			anticipation: { activation: 'tumble_pop' },
		},
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.library = 'v2';
	Object.assign(extras.entries[0], { bpm: 120 });
	Object.assign(extras.bindings, { music: { base: 'theme' } });
	Object.assign(extras.bindings.slots.spinStart, { pan: -0.2 });
	Object.assign(extras.bindings.anticipation, { stop: 'tumble_pop' });
	ignores('10. sounds', normalizeSoundsDoc, base, extras, [
		'"id":"s1"',
		'"spinStart":{',
		'"anticipation":{',
	]);
}

// 11. rig text — `normalizeRigTextDoc` rebuilds the page, each element, style and variant.
{
	const base = {
		version: 1,
		page: { file: 'rigtext-0123abcd.png', width: 512, height: 256 },
		elements: [
			{
				id: 'title',
				key: 'FREE SPINS',
				fontId: 'f1',
				fontName: 'Gold',
				fontSize: 48,
				sourceLocale: 'en',
				slot: 'text_title',
				style: { color: '#ffcc00', strokeColor: '#000000', strokeWidth: 4 },
				variants: [{ locale: 'en', text: 'FREE SPINS', x: 0, y: 0, w: 300, h: 60 }],
			},
		],
		updatedAt: '2026-10-01T00:00:00.000Z',
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.bakedBy = 'rigger@2';
	Object.assign(extras.page, { format: 'png' });
	Object.assign(extras.elements[0], { align: 'center' });
	Object.assign(extras.elements[0].style, { shadow: true });
	Object.assign(extras.elements[0].variants[0], { baseline: 40 });
	ignores('11. rig text', normalizeRigTextDoc, base, extras, [
		'"page":{',
		'"style":{"color"',
		'"variants":[{',
	]);
}

// 12. art bounds — rebuilt field by field.
{
	const base = { version: 1, bounds: { 'symbols::H1': { x: -60, y: -60, w: 120, h: 120 } } };
	const extras = {
		version: 1,
		note: 'x',
		bounds: { 'symbols::H1': { x: -60, y: -60, w: 120, h: 120, rotation: 90 } },
	};
	ignores('12. art bounds', normalizeArtBoundsDoc, base, extras, ['"symbols::H1":{']);
}

// 13. components — `normalizeComponent` (the load path's normalizer) rebuilds the def and root; the
//     root's `children` are nodes and pass through, like the layout doc's.
{
	const base = {
		id: 'c_spin',
		name: 'Spin button',
		version: 3,
		scope: 'project',
		category: 'ui',
		root: { id: 'root', kind: 'container', x: 0, y: 0, width: 200, height: 200, children: [] },
		params: [{ key: 'label', kind: 'string', default: 'SPIN', group: 'Copy' }],
		signals: [{ key: 'onSpin', note: 'pressed' }],
	};
	const extras = clone(base) as typeof base & Record<string, unknown>;
	extras.thumbnail = 'thumb.png';
	Object.assign(extras.root, { pivot: { x: 0.5, y: 0.5 } });
	Object.assign(extras.params[0], { tooltip: 'Button text' });
	Object.assign(extras.signals[0], { payload: 'none' });
	ignores('13. component', (d) => normalizeComponent(d as unknown as ComponentDef), base, extras, [
		'"root":{',
		'"params":[{',
		'"signals":[{',
	]);
}

// 14. the bake's rebuilds of `symbols.coinLabel` (whitelist) and `symbols.flights` (per-style pass).
{
	const label = {
		style: { font: 'coinFont', size: 0.4 },
		jackpots: { MINI: { text: 'Mini', style: { tint: '#ffffff' } } },
		placement: { x: 0.1, y: -0.2 },
		animation: { landPop: { enabled: true, ms: 300 }, countMs: 900 },
	};
	const labelExtras = clone(label) as typeof label & Record<string, unknown>;
	labelExtras.ticker = true;
	Object.assign(labelExtras.style, { weight: 'bold' });
	Object.assign(labelExtras.animation, { shake: 2 });
	Object.assign(labelExtras.animation.landPop, { ease: 'out' });
	Object.assign(labelExtras.jackpots.MINI, { icon: 'gem' });
	ignores('14. bake coinLabel', bakeCoinLabel, label, labelExtras, [
		'"style":{',
		'"landPop":{',
		'"MINI":{',
	]);

	const flights = { toTotal: { head: { kind: 'glow' }, speed: 900 } };
	const kept = run(() =>
		bakeFlights({ toTotal: { head: { kind: 'glow', wobble: 2 }, speed: 900, curve: 'arc' } }),
	);
	check('14. bake flights: the base block bakes', run(() => bakeFlights(flights)).threw === null);
	check('14. bake flights: unknown fields do not throw', kept.threw === null);
	check(
		'14. bake flights: a style passes through verbatim (unknown field KEPT, by design)',
		kept.out.includes('"wobble":2') && kept.out.includes('"curve":"arc"'),
	);
}

if (failures) {
	console.log(`\n${failures} of ${checks} check(s) failed`);
	process.exit(1);
}
console.log(`doc readers ignore unknown fields: all ${checks} checks passed`);
