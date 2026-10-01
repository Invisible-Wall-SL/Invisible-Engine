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
 * Section 15 holds the same readers to the UNKNOWN ENUM VALUE rule: on a read, a value a newer
 * build added drops the field (or the entry that cannot stand without it), or reads as a declared
 * fallback; one warning names it; the output equals the doc without it; a SAVE still refuses it;
 * a value of the wrong type still throws; a doc with no unknown value reads the same either way.
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
import {
	readUnknownValueAs,
	stripUnknownKeys,
	type UnknownValue,
} from '../src/lib/server/stripUnknownKeys.ts';
import { parseSymbolDefaults, symbolDefaultsSchema } from '../src/lib/server/symbolDefaults.ts';
import { normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import { normalizeWinTextDoc } from '../src/lib/server/winTextStorage.ts';
import hwDefaults from '../src/lib/data/symbolDefaults/holdAndWin.json';
import linesDefaults from '../src/lib/data/symbolDefaults/lines.json';
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

	const valuesBy = (schema: z.ZodTypeAny, input: unknown) => {
		const seen: UnknownValue[] = [];
		const out = stripUnknownKeys(
			schema,
			input,
			() => {},
			(u) => seen.push(u),
		);
		return { out: json(out), seen: json(seen) };
	};
	const cell = z.object({ type: z.enum(['a', 'b']), mode: z.enum(['x', 'y']).optional() }).strict();
	const untouched = stripUnknownKeys(cell, { type: 'c' }, () => {});
	check(
		'0. helper: without onUnknownValue (a save) an unknown value is left for the parse',
		json(untouched) === '{"type":"c"}',
		json(untouched),
	);
	const optional = valuesBy(cell, { type: 'a', mode: 'z' });
	check(
		'0. helper: an unknown OPTIONAL value drops the field alone',
		optional.out === '{"type":"a"}' &&
			optional.seen === '[{"path":"mode","value":"z","outcome":{"dropped":"mode"}}]',
		json(optional),
	);
	const listed = valuesBy(z.array(cell), [{ type: 'a' }, { type: 'c', mode: 'x' }]);
	check(
		'0. helper: an unknown REQUIRED value drops the array element holding it',
		listed.out === '[{"type":"a"}]' &&
			listed.seen === '[{"path":"1.type","value":"c","outcome":{"dropped":"1"}}]',
		json(listed),
	);
	const nested = valuesBy(z.object({ inner: z.object({ cell }), keep: z.number() }), {
		inner: { cell: { type: 'c' } },
		keep: 1,
	});
	check(
		'0. helper: it climbs required fields to the nearest droppable thing (a required root is left)',
		nested.out === '{"inner":{"cell":{"type":"c"}},"keep":1}' && nested.seen === '[]',
		json(nested),
	);
	const keyed = valuesBy(z.record(z.string(), cell), { k: { type: 'c' }, j: { type: 'b' } });
	check(
		'0. helper: … or the record entry holding it',
		keyed.out === '{"j":{"type":"b"}}' && keyed.seen.includes('"dropped":"k"'),
		json(keyed),
	);
	const literal = valuesBy(z.object({ version: z.literal(1).default(1) }), { version: 2 });
	check(
		'0. helper: a literal is an enum of one (a newer `version` is ignored)',
		literal.out === '{}' && literal.seen.includes('"value":2'),
		json(literal),
	);
	const wrongType = valuesBy(cell, { type: 3 });
	check(
		'0. helper: a value of the wrong type is malformed, not unknown — left for the parse',
		wrongType.out === '{"type":3}' && wrongType.seen === '[]',
		json(wrongType),
	);
	const tagged = valuesBy(
		z.array(
			z.discriminatedUnion('kind', [
				z.object({ kind: z.literal('a') }).strict(),
				z.object({ kind: z.literal('b'), n: z.number() }).strict(),
			]),
		),
		[{ kind: 'a' }, { kind: 'c' }],
	);
	check(
		'0. helper: an unknown discriminator tag drops the element',
		tagged.out === '[{"kind":"a"}]' && tagged.seen.includes('"path":"1.kind"'),
		json(tagged),
	);
	const variants = z.array(
		z.union([
			z.object({ t: z.literal('a'), n: z.number() }).strict(),
			z.object({ t: z.literal('b'), s: z.string() }).strict(),
		]),
	);
	const malformed = valuesBy(variants, [{ t: 'b', s: 5 }]);
	check(
		'0. helper: a malformed KNOWN union variant is left for the parse, not dropped as unknown',
		malformed.out === '[{"t":"b","s":5}]' && malformed.seen === '[]',
		json(malformed),
	);
	const newer = valuesBy(variants, [{ t: 'c' }, { t: 'a', n: 1 }]);
	check(
		'0. helper: a variant no option lists is dropped',
		newer.out === '[{"t":"a","n":1}]' && newer.seen.includes('"dropped":"0"'),
		json(newer),
	);
	const fallback = valuesBy(
		z.array(z.object({ kind: readUnknownValueAs(z.enum(['a', 'b']), 'a') })),
		[{ kind: 'c' }],
	);
	check(
		'0. helper: readUnknownValueAs reads an unknown value as its fallback, keeping the entry',
		fallback.out === '[{"kind":"a"}]' && fallback.seen.includes('"readAs":"a"'),
		json(fallback),
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
	throws('1. symbols', 'a cell whose type is not a string', () =>
		normalizeSymbolsDoc({ symbols: { H1: { static: { type: 3, assetKey: 'x' } } } }),
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
	throws('3. symbol defaults', 'a cell whose type is not a string', () =>
		parseSymbolDefaults({ ...base, symbols: { H1: { static: { ...cell, type: 3 } } } }),
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

// 15. unknown enum VALUES (`docs/conventions/doc-readers.md` §"Unknown enum values"). Each case
//     writes one value a newer build might add, and names the doc it must read the same as: the
//     doc without the field, without the entry that cannot stand without it, or with the declared
//     fallback in its place.
{
	type Doc = Record<string, unknown>;
	type Read = (doc: unknown, unknownValues?: 'drop' | 'reject') => unknown;
	/** The parent object (or array) and the last segment of a dotted path. */
	const at = (doc: Doc, path: string): [Record<string, unknown> | unknown[], string] => {
		const keys = path.split('.');
		const last = keys.pop() as string;
		let node: unknown = doc;
		for (const key of keys) node = (node as Record<string, unknown>)[key];
		return [node as Record<string, unknown> | unknown[], last];
	};
	const set = (path: string, value: unknown) => (doc: Doc) => {
		const [parent, key] = at(doc, path);
		(parent as Record<string, unknown>)[key] = value;
	};
	const del = (path: string) => (doc: Doc) => {
		const [parent, key] = at(doc, path);
		if (Array.isArray(parent)) parent.splice(Number(key), 1);
		else delete parent[key];
	};
	const variant = (base: Doc, edit: (doc: Doc) => void): Doc => {
		const doc = clone(base);
		edit(doc);
		return doc;
	};
	interface Case {
		label: string;
		edit: (doc: Doc) => void;
		/** The doc the edited one must read the same as. */
		reads: (doc: Doc) => void;
		/** Fragments of the one warning: the value's path and, when dropped, what went. */
		warns: readonly string[];
	}
	const values = (
		section: string,
		read: Read,
		base: Doc,
		cases: readonly Case[],
		{ save = true }: { save?: boolean } = {},
	): void => {
		const plain = run(() => read(base));
		check(
			`${section}: the base doc reads without throwing`,
			plain.threw === null,
			plain.threw ?? '',
		);
		check(`${section}: the base doc warns about nothing`, plain.warnings.length === 0);
		if (save)
			check(
				`${section}: a doc with no unknown value reads byte-identically on a read and a save`,
				plain.out === run(() => read(base, 'reject')).out,
			);
		for (const c of cases) {
			const label = `${section}: ${c.label}`;
			const edited = variant(base, c.edit);
			const got = run(() => read(edited));
			const want = run(() => read(variant(base, c.reads)));
			check(`${label} — the read does not throw`, got.threw === null, got.threw ?? '');
			check(
				`${label} — reads the same as the doc without it`,
				got.threw === null && got.out === want.out,
				`got  ${got.out}\n        want ${want.out}`,
			);
			check(
				`${label} — one warning names it`,
				got.warnings.length === 1 && c.warns.every((w) => got.warnings[0].includes(w)),
				got.warnings.join(' | ') || '(no warnings)',
			);
			if (save)
				check(
					`${label} — a save still refuses it`,
					run(() => read(edited, 'reject')).threw !== null,
				);
		}
	};
	const drops = (path: string, dropped = path) => [`at "${path}"`, `"${dropped}"`];

	const symbols: Doc = {
		version: 1,
		symbols: {
			H1: {
				static: { type: 'sprite', assetKey: 'symbols' },
				win: {
					type: 'flipbook',
					assetKey: 'sheet',
					clipId: 'h1Win',
					direction: 'reverse',
					layers: [
						{ kind: 'sprite', assetKey: 'glow', blendMode: 'add' },
						{ kind: 'fx', effectId: 'sparkle' },
					],
				},
			},
		},
		highlight: {
			type: 'spine',
			assetKey: 'payframe',
			sizeRatios: { width: 1, height: 1 },
			tintMode: 'fixed',
			tintColor: '#ff0000',
		},
		boardGlow: { type: 'spine', assetKey: 'reelhouse' },
		winLine: { text: { placement: 'boardCenter', size: 1.2 } },
		stackedPictures: {
			enabled: true,
			symbols: [
				{
					name: 'S1',
					height: 3,
					art: { type: 'sprite', assetKey: 'tall' },
					winArt: { type: 'spine', assetKey: 'tallWin', animationName: 'win' },
				},
			],
		},
		bookVfx: {
			background: { kind: 'sprite', assetKey: 'bookBg' },
			foreground: { kind: 'fx', effectId: 'bookFg' },
		},
		transition: { kind: 'flipbook', clipId: 'emerge', blendMode: 'screen' },
		tumblePattern: { pattern: 'rowsTop', stepMs: 40 },
		flights: { toTotal: { head: { kind: 'sprite', assetKey: 'coin' }, ease: 'easeIn', speed: 2 } },
		coinLabel: { cash: { format: 'betMultiple', decimals: 2 } },
	};
	const win = 'symbols.H1.win';
	values('15. symbols', normalizeSymbolsDoc, symbols, [
		{
			label: 'a new cell type drops that cell',
			edit: set('symbols.H1.static.type', 'video'),
			reads: del('symbols.H1.static'),
			warns: drops('symbols.H1.static.type', 'symbols.H1.static'),
		},
		{
			label: 'a new playback direction falls back to the clip’s own',
			edit: set(`${win}.direction`, 'bounce'),
			reads: del(`${win}.direction`),
			warns: drops(`${win}.direction`),
		},
		{
			label: 'a new layer kind drops that layer, not its siblings',
			edit: set(`${win}.layers.0.kind`, 'hologram'),
			reads: del(`${win}.layers.0`),
			warns: drops(`${win}.layers.0.kind`, `${win}.layers.0`),
		},
		{
			label: 'a new blend mode falls back to normal',
			edit: set(`${win}.layers.0.blendMode`, 'hard-light'),
			reads: del(`${win}.layers.0.blendMode`),
			warns: drops(`${win}.layers.0.blendMode`),
		},
		{
			label: 'a new book-VFX layer kind drops that slot',
			edit: set('bookVfx.foreground.kind', 'hologram'),
			reads: del('bookVfx.foreground'),
			warns: drops('bookVfx.foreground.kind', 'bookVfx.foreground'),
		},
		{
			label: 'a new transition kind drops the transition',
			edit: set('transition.kind', 'video'),
			reads: del('transition'),
			warns: drops('transition.kind', 'transition'),
		},
		{
			label: 'a new transition blend mode falls back to normal',
			edit: set('transition.blendMode', 'hard-light'),
			reads: del('transition.blendMode'),
			warns: drops('transition.blendMode'),
		},
		{
			label: 'a non-spine highlight drops the override (the coded payframe plays)',
			edit: set('highlight.type', 'flipbook'),
			reads: del('highlight'),
			warns: drops('highlight.type', 'highlight'),
		},
		{
			label: 'a new tint mode falls back to no tint',
			edit: set('highlight.tintMode', 'gradient'),
			reads: del('highlight.tintMode'),
			warns: drops('highlight.tintMode'),
		},
		{
			label: 'a non-spine board glow drops the override',
			edit: set('boardGlow.type', 'flipbook'),
			reads: del('boardGlow'),
			warns: drops('boardGlow.type', 'boardGlow'),
		},
		{
			label: 'a new amount placement falls back to the line',
			edit: set('winLine.text.placement', 'reelTop'),
			reads: del('winLine.text.placement'),
			warns: drops('winLine.text.placement'),
		},
		{
			label: 'a new tumble pattern falls back to all-at-once (its step goes with it)',
			edit: set('tumblePattern.pattern', 'spiral'),
			reads: del('tumblePattern'),
			warns: drops('tumblePattern.pattern'),
		},
		{
			label: 'a new flight head kind drops the head (the coded glow flies)',
			edit: set('flights.toTotal.head.kind', 'laser'),
			reads: del('flights.toTotal.head'),
			warns: drops('flights.toTotal.head.kind', 'flights.toTotal.head'),
		},
		{
			label: 'a new flight ease falls back to the coded one',
			edit: set('flights.toTotal.ease', 'bounce'),
			reads: del('flights.toTotal.ease'),
			warns: drops('flights.toTotal.ease'),
		},
		{
			label: 'a new cash format falls back to money',
			edit: set('coinLabel.cash.format', 'credits'),
			reads: del('coinLabel.cash.format'),
			warns: drops('coinLabel.cash.format'),
		},
		{
			label: 'a new stacked art type drops that stacked symbol',
			edit: set('stackedPictures.symbols.0.art.type', 'video'),
			reads: del('stackedPictures.symbols.0'),
			warns: drops('stackedPictures.symbols.0.art.type', 'stackedPictures.symbols.0'),
		},
		{
			label: 'a new win-art type drops the win art (the stack keeps its art)',
			edit: set('stackedPictures.symbols.0.winArt.type', 'video'),
			reads: del('stackedPictures.symbols.0.winArt'),
			warns: drops('stackedPictures.symbols.0.winArt.type', 'stackedPictures.symbols.0.winArt'),
		},
		{
			label: 'a newer version reads as 1, every known field kept',
			edit: set('version', 2),
			reads: () => {},
			warns: ['at "version"'],
		},
	]);
	throws('15. symbols', 'a blend mode that is not a string', () =>
		normalizeSymbolsDoc(variant(symbols, set(`${win}.layers.0.blendMode`, true))),
	);

	const winText: Doc = {
		version: 1,
		toast: { full: 'You win {amount}' },
		jackpots: { captions: { MINI: 'Mini' } },
	};
	values('15. win text', normalizeWinTextDoc, winText, [
		{
			label: 'a newer version reads as 1, every known field kept',
			edit: set('version', 2),
			reads: () => {},
			warns: ['at "version"'],
		},
	]);
	throws('15. win text', 'a version that is not a number', () =>
		normalizeWinTextDoc({ ...winText, version: 'two' }),
	);

	const sounds: Doc = {
		version: 1,
		entries: [
			{
				id: 's1',
				name: 'pop',
				kind: 'music',
				file: 'pop.mp3',
				durationMs: 420,
				status: 'approved',
				reviewedBy: 'ana',
				origin: 'ai',
				model: 'gen-2',
			},
		],
		bindings: { slots: { spinStart: { names: ['pop'] } } },
	};
	values('15. sounds', normalizeSoundsDoc, sounds, [
		{
			label: 'a new kind reads as sfx and KEEPS the sound (no backups; bindings name it)',
			edit: set('entries.0.kind', 'voice'),
			reads: set('entries.0.kind', 'sfx'),
			warns: ['at "entries.0.kind"', 'as "sfx"'],
		},
		{
			label: 'a new status reads as draft, so it never launders an approval',
			edit: set('entries.0.status', 'signedOff'),
			reads: del('entries.0.status'),
			warns: drops('entries.0.status'),
		},
		{
			label: 'a new origin reads as library, the value that claims nothing',
			edit: set('entries.0.origin', 'elevenlabs'),
			reads: del('entries.0.origin'),
			warns: drops('entries.0.origin'),
		},
		{
			label: 'a newer version reads as 1, every known field kept',
			edit: set('version', 3),
			reads: () => {},
			warns: ['at "version"'],
		},
	]);
	check(
		'15. sounds: a draft read off an unknown status carries no reviewer',
		!run(() => normalizeSoundsDoc(variant(sounds, set('entries.0.status', 'x')))).out.includes(
			'reviewedBy',
		),
	);
	throws('15. sounds', 'a kind that is not a string', () =>
		normalizeSoundsDoc(variant(sounds, set('entries.0.kind', 1))),
	);

	// Published defaults drop on the PUBLISH too: a refused publish is swallowed by the build's
	// `--optional` and leaves the grid stale, so there is no save mode to keep a typo guard for.
	const cell = { type: 'sprite', assetKey: 'symbols', sizeRatios: { width: 1, height: 1 } };
	const defaults: Doc = {
		version: 1,
		gameType: 'lines',
		symbols: { H1: { static: cell, win: { ...cell, type: 'spine', animationName: 'win' } } },
		highlight: { type: 'spine', assetKey: 'payframe', sizeRatios: { width: 1, height: 1 } },
	};
	values(
		'15. symbol defaults',
		(doc) => parseSymbolDefaults(doc),
		defaults,
		[
			{
				label: 'a new cell type drops that default cell',
				edit: set('symbols.H1.static.type', 'flipbook'),
				reads: del('symbols.H1.static'),
				warns: drops('symbols.H1.static.type', 'symbols.H1.static'),
			},
			{
				label: 'a non-spine highlight drops the highlight default',
				edit: set('highlight.type', 'flipbook'),
				reads: del('highlight'),
				warns: drops('highlight.type', 'highlight'),
			},
		],
		{ save: false },
	);
	for (const [name, published] of Object.entries({
		lines: linesDefaults,
		holdAndWin: hwDefaults,
	})) {
		const read = run(() => parseSymbolDefaults(published));
		check(
			`15. symbol defaults: the committed ${name} map reads exactly as the bare schema parses it`,
			read.warnings.length === 0 && read.out === json(symbolDefaultsSchema.parse(published)),
			read.warnings.join(' | '),
		);
	}
}

if (failures) {
	console.log(`\n${failures} of ${checks} check(s) failed`);
	process.exit(1);
}
console.log(`doc readers ignore unknown fields: all ${checks} checks passed`);
