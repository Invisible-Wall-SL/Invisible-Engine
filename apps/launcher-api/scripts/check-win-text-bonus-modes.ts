/**
 * Contract check for bonus-games Phase 5d — Win Text and Localization per respin mode
 * (docs/design/bonus-games.md §2.4):
 *   pnpm --filter launcher-api check:win-text-bonus-modes
 *
 * What it pins, over the REAL `winTextStorage.ts` save path (only `r2.ts` is an in-memory bucket),
 * the runtime bundle's `winText` step, the game's own Win Text selection (sliced from
 * `apps/lines`) and the Localization harvest:
 *  1. A doc with TWO respin modes keeps each mode's own jackpot / respin / wheel / feature-frame
 *     lines through save → reload, and the bundle resolves them apart: mode 2 speaks its own, the
 *     primary its own.
 *  2. Mode 2 without lines reads the primary's, wholly and field by field; a stray entry under the
 *     primary's own id is never read for it.
 *  3. Localization lists both modes: the primary's "Win text" section, then a `Win text — <label>`
 *     section with mode 2's own tiers and lines, in the shared catalog (keyed by source text).
 *  4. Every current doc (the `hw-*` presets, `borut-pots-sample`, plain lines with free spins,
 *     bookOf, lines + an overlay) is byte-identical: its respin-mode list gives the tiers and wheel
 *     the legacy block gave, its Localization sections equal the pre-5d call's, and a doc without
 *     `modes` normalizes and resolves exactly as before.
 *  5. `saveWinTextDoc` stores both modes' lines and reloads them, and a save by THIS build keeps what
 *     a newer one wrote inside a mode's lines (`docs/conventions/doc-readers.md`).
 *  6. The runtime bundle's `winText` step (`shippedWinText`) ships a doc whose only lines are
 *     another mode's, and still ships nothing for an unauthored one.
 *  7. The game's selection — `modeWinText` (`holdAndWinText.ts`), `isPrimaryRespinMode` /
 *     `activeRespinMode` (`activeRespinMode.svelte.ts`) and `bakedWinTextFor` (`editor-scenes.ts`),
 *     sliced from their sources — draws the counter, the jackpot banner and the wheel in the mode on
 *     top of the stack, the primary's with none, and prefers the runtime bundle over the baked one.
 *  8. `/win-text`'s re-homing of a gone mode's lines (`swapWinTextModeLines`) moves or swaps them
 *     without losing a line, the primary included.
 *
 * The `--tsconfig` maps SvelteKit's `$env/dynamic/private` to a stub (`scripts/lib/env-stub.ts`).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import {
	formatWinText,
	jackpotCaption,
	kindCapabilities,
	resolveWinText,
	resolveWinTextForMode,
	swapWinTextModeLines,
	type ResolvedWinText,
	type WinTextDoc,
} from 'engine-layout';
import {
	HOLD_AND_WIN_PRESETS,
	addPotsOverlay,
	holdAndWinModeDecl,
	normalizeGameConfigDoc,
	primaryRespinMode,
	type GameConfigDoc,
	type PotsOverlayPresetId,
} from 'game-config';
import { respinModeOnStack } from '../../lines/src/game/respinModes.ts';
import { compileSlice, stripSliceTypes } from '../../../scripts/lib/compile-slice.mjs';

const bucket = new Map<string, { text: string; etag: string | null }>();
type Cond = { ifMatch?: string; ifNoneMatch?: string };
class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
const etagOf = (text: string): string => `"${createHash('md5').update(text).digest('hex')}"`;
mock.module(new URL('../src/lib/server/r2.ts', import.meta.url).href, {
	namedExports: {
		ConflictError,
		precondition: (baseEtag: string | null | undefined): Cond | undefined => {
			if (baseEtag === undefined) return undefined;
			return baseEtag === null ? { ifNoneMatch: '*' } : { ifMatch: baseEtag };
		},
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.text.length, lastModified: 0 } : null;
		},
		copyObject: async () => false,
		putObjectText: async (key: string, text: string, _type: string, cond?: Cond) => {
			const current = bucket.get(key);
			if (cond?.ifNoneMatch === '*' && current) throw new ConflictError(key);
			if (cond?.ifMatch !== undefined && current?.etag !== cond.ifMatch) {
				throw new ConflictError(key);
			}
			const etag = etagOf(text);
			bucket.set(key, { text, etag });
			return etag;
		},
		getObjectText: async (key: string) => bucket.get(key)?.text ?? null,
		getObjectTextWithEtag: async (key: string) => bucket.get(key) ?? null,
		listAllObjects: async () => [],
		deleteObjects: async () => {},
		listAllKeys: async () => [],
		listObjects: async () => ({ keys: [], prefixes: [] }),
		objectExists: async (key: string) => bucket.has(key),
	},
});

const { projectAddOns } = await import('../src/lib/addOns.ts');
const { gameConfigDefaultFor } = await import('../src/lib/server/gameConfigDefaults.ts');
const { WIN_TEXT_SECTION_ID, harvestProjectWinText, harvestWinText } =
	await import('../src/lib/server/localizationHarvest.ts');
const { winTextDocKey } = await import('../src/lib/server/projectPaths.ts');
const { loadWinTextDocWithEtag, normalizeWinTextDoc, saveWinTextDoc, shippedWinText } =
	await import('../src/lib/server/winTextStorage.ts');
const { winTextRespinModes } = await import('../src/lib/winTextModes.ts');

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const clone = <T>(v: T): T => structuredClone(v);
const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};
const withOverlay = (doc: GameConfigDoc, id: PotsOverlayPresetId): GameConfigDoc => {
	const result = addPotsOverlay(doc, id);
	if (!result.ok) throw new Error(result.reason);
	return normalize(result.doc);
};
/** Save → reload: the normalizer the PUT runs, through JSON, then the one the load runs. */
const saveReload = (doc: unknown): WinTextDoc =>
	normalizeWinTextDoc(JSON.parse(JSON.stringify(normalizeWinTextDoc(doc, 'reject'))));

/** `doc` plus a second respin mode `holdAndWin_2` with renamed tiers and a wheel, saved the way a
 *  split-form writer saves it (the legacy keys deleted). */
const SECOND = 'holdAndWin_2';
const withSecondMode = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	delete out.holdAndWin;
	delete out.potsOverlay;
	const game = clone(primaryRespinMode(out.modes)!.holdAndWin);
	game.jackpots = game.jackpots.map((jackpot) => ({ ...jackpot, name: `GOLD_${jackpot.name}` }));
	game.wheel = clone(HOLD_AND_WIN_PRESETS.collector.holdAndWin!.wheel);
	out.modes = [
		...(out.modes ?? []),
		{ ...holdAndWinModeDecl(), id: SECOND, gameType: 'respin_2', label: 'Gold', holdAndWin: game },
	];
	out.paddingReels.respin_2 = clone(out.paddingReels.respin);
	return normalize(out);
};

const lines = normalize(gameConfigDefaultFor('lines'));
const two = withSecondMode(withOverlay(lines, 'threePots'));
const primaryTiers = two.holdAndWin!.jackpots.map((jackpot) => jackpot.name);

const authored: WinTextDoc = {
	version: 1,
	jackpots: { captions: { [primaryTiers[0]]: 'Bronze' }, award: '{jackpot} WIN' },
	respins: { counter: 'SPINS {count}' },
	feature: { intro: 'HOLD ON', potLabel: '{pot} {level}' },
	wheel: { coinBoost: 'BOOST ×{count}' },
	modes: {
		[SECOND]: {
			jackpots: {
				captions: { [`GOLD_${primaryTiers[0]}`]: 'Gold Bronze' },
				award: 'GOLD {jackpot}',
			},
			respins: { counter: 'GOLD SPINS {count}', last: 'LAST GOLD' },
			wheel: { coinBoost: 'GOLD BOOST ×{count}' },
			feature: { intro: 'GOLD RUSH', outro: 'GOLD OVER' },
		},
	},
};

// ── 1. two respin modes keep distinct lines through save → reload → bundle ──────────────────────
{
	const reloaded = saveReload(authored);
	check('1. save → reload keeps every line of both modes', reloaded, authored);
	check('1. a second save is a no-op', saveReload(reloaded), reloaded);
	// The bake and the runtime bundle ship the saved doc as it is (`bundle.winText`); the game
	// resolves it through `bakedWinTextFor(<active mode>)`.
	const bundle: WinTextDoc = JSON.parse(JSON.stringify(reloaded));
	const primary = resolveWinTextForMode(bundle, undefined);
	const gold = resolveWinTextForMode(bundle, SECOND);
	check(
		'1. the primary speaks its own lines',
		[
			primary.jackpots.award,
			primary.respins.counter,
			primary.wheel.coinBoost,
			primary.feature.intro,
			primary.jackpots.captions[primaryTiers[0]],
		],
		['{jackpot} WIN', 'SPINS {count}', 'BOOST ×{count}', 'HOLD ON', 'Bronze'],
	);
	check(
		'1. mode 2 speaks its own lines',
		[
			gold.jackpots.award,
			gold.respins.counter,
			gold.respins.last,
			gold.wheel.coinBoost,
			gold.feature.intro,
			gold.feature.outro,
			gold.jackpots.captions[`GOLD_${primaryTiers[0]}`],
		],
		[
			'GOLD {jackpot}',
			'GOLD SPINS {count}',
			'LAST GOLD',
			'GOLD BOOST ×{count}',
			'GOLD RUSH',
			'GOLD OVER',
			'Gold Bronze',
		],
	);
	check(
		"1. mode 2 shares the game's pot lines and names",
		[gold.feature.potLabel, gold.feature.specialNames, gold.feature.potNames],
		[primary.feature.potLabel, primary.feature.specialNames, primary.feature.potNames],
	);
	check(
		'1. a blank mode line prunes, and an emptied mode drops the map',
		saveReload({ ...authored, modes: { [SECOND]: { respins: { counter: ' ' } } } }).modes,
		undefined,
	);
}

// ── 2. a mode without lines reads the primary's ─────────────────────────────────────────────────
{
	const { modes: _, ...primaryOnly } = authored;
	check(
		'2. mode 2 without an entry reads exactly the primary',
		resolveWinTextForMode(primaryOnly, SECOND),
		resolveWinText(primaryOnly),
	);
	const partial: WinTextDoc = { ...primaryOnly, modes: { [SECOND]: { respins: { last: 'X' } } } };
	const read = resolveWinTextForMode(partial, SECOND);
	check(
		'2. a mode that wrote one line reads the primary for every other',
		{ ...read, respins: { ...read.respins, last: resolveWinText(partial).respins.last } },
		resolveWinText(partial),
	);
	check(
		"2. an entry under the primary's own id is never read for the primary",
		resolveWinTextForMode(
			{ ...primaryOnly, modes: { holdAndWin: { respins: { counter: 'X' } } } },
			undefined,
		),
		resolveWinText(primaryOnly),
	);
	check(
		'2. an inherited key is not a mode',
		resolveWinTextForMode(primaryOnly, 'constructor'),
		resolveWinText(primaryOnly),
	);
}

// ── 3. Localization lists both modes ────────────────────────────────────────────────────────────
{
	check(
		'3. the respin modes, the primary first, each with its own tiers and wheel',
		winTextRespinModes(two).map(({ mode, label, jackpotTiers, hasWheel }) => [
			mode,
			label,
			jackpotTiers,
			hasWheel,
		]),
		[
			['holdAndWin', 'Hold and Win', primaryTiers, false],
			[SECOND, 'Gold', primaryTiers.map((tier) => `GOLD_${tier}`), true],
		],
	);
	const sections = harvestProjectWinText(authored, 'lines', two);
	check(
		'3. a "Win text" section, then one for mode 2',
		sections.map((s) => [s.sceneId, s.sceneName, s.origin]),
		[
			[WIN_TEXT_SECTION_ID, 'Win text', 'winText'],
			[`${WIN_TEXT_SECTION_ID}:${SECOND}`, 'Win text — Gold', 'winText'],
		],
	);
	const goldKeys = sections[1].items.map((i) => i.key);
	check(
		"3. mode 2's section lists its own tiers and lines",
		[
			'Gold Bronze',
			`GOLD_${primaryTiers[1]}`,
			'GOLD {jackpot}',
			'GOLD SPINS {count}',
			'LAST GOLD',
			'GOLD RUSH',
			'GOLD OVER',
			'GOLD BOOST ×{count}',
		].filter((key) => !goldKeys.includes(key)),
		[],
	);
	check(
		"3. …and what it reads from the primary, but none of the primary's tiers or pot lines",
		[
			goldKeys.includes('RESPINS RESET'),
			goldKeys.includes('Bronze'),
			goldKeys.includes('{pot} {level}'),
		],
		[true, false, false],
	);
	check(
		"3. the primary's section is unchanged by mode 2's lines",
		sections[0],
		harvestProjectWinText({ ...authored, modes: undefined }, 'lines', two)[0],
	);
}

// ── 4. every current doc is byte-identical ──────────────────────────────────────────────────────
{
	const book = normalize(gameConfigDefaultFor('bookOf'));
	const borut = withOverlay(book, 'threePots');
	borut.potsOverlay!.pots = borut.potsOverlay!.pots.map((p) =>
		p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p,
	);
	const docs: [string, string, GameConfigDoc | null][] = [
		['no config', 'lines', null],
		['lines (free spins)', 'lines', lines],
		['bookOf', 'bookOf', book],
		...Object.entries(HOLD_AND_WIN_PRESETS).map(
			([id, doc]) =>
				[`hw-${id}-sample`, 'holdAndWin', normalize(clone(doc))] as [string, string, GameConfigDoc],
		),
		['holdAndWin template', 'holdAndWin', normalize(gameConfigDefaultFor('holdAndWin'))],
		['borut-pots-sample', 'bookOf', normalize(borut)],
		...(['threePots', 'potsToFreeSpins'] as PotsOverlayPresetId[]).map(
			(id) => [`lines + ${id}`, 'lines', withOverlay(lines, id)] as [string, string, GameConfigDoc],
		),
	];
	/** The pre-5d Localization call (`localizationSections.ts`): tiers off the legacy block. */
	const before = (doc: WinTextDoc | undefined, kind: string, config: GameConfigDoc | null) => {
		const { addOns, potIds } = projectAddOns(config);
		const capabilities = kindCapabilities(kind, addOns);
		return harvestWinText(doc, {
			holdAndWin: capabilities.holdAndWin,
			pots: capabilities.pots,
			jackpots: (config?.holdAndWin?.jackpots ?? []).map((jackpot) => jackpot.name),
			meters: potIds ?? [],
		});
	};
	const { modes: _, ...current } = authored;
	for (const [name, kind, config] of docs) {
		const modes = winTextRespinModes(config);
		check(`4. ${name} · at most one respin mode`, modes.length <= 1, true);
		check(
			`4. ${name} · the /win-text tiers and wheel are the legacy block's`,
			[modes[0]?.jackpotTiers ?? [], modes[0]?.hasWheel ?? false],
			[
				(config?.holdAndWin?.jackpots ?? []).map((jackpot) => jackpot.name),
				Boolean(config?.holdAndWin?.wheel),
			],
		);
		for (const [which, doc] of [
			['unauthored', undefined],
			['authored', current],
		] as const) {
			check(
				`4. ${name} · ${which} · Localization sections`,
				harvestProjectWinText(doc, kind, config),
				before(doc, kind, config),
			);
		}
	}
	check(
		'4. a doc without modes normalizes without the key',
		Object.hasOwn(normalizeWinTextDoc(current), 'modes'),
		false,
	);
	check(
		'4. …and the game resolves it exactly as before',
		resolveWinTextForMode(current, undefined),
		resolveWinText(current),
	);
}

// ── 5. the real save path, and a newer build's fields inside a mode ──────────────────────────────
{
	const key = winTextDocKey('c', 'p');
	const saved = await saveWinTextDoc('c', 'p', authored, null);
	const { doc: reloaded } = await loadWinTextDocWithEtag('c', 'p');
	const { updatedAt: _a, ...savedLines } = saved.doc;
	const { updatedAt: _b, ...reloadedLines } = reloaded;
	check('5. saveWinTextDoc stores both modes, and the load returns them', reloadedLines, authored);
	check('5. …as the save returned them', reloadedLines, savedLines);

	// A newer launcher wrote a field and a family this build does not know inside mode 2's lines.
	const future = JSON.parse(bucket.get(key)!.text);
	future.modes[SECOND].respins.future = 'kept';
	future.modes[SECOND].sparkle = { line: 'kept too' };
	future.modes.gone = { futureOnly: true };
	bucket.set(key, { text: JSON.stringify(future), etag: etagOf(JSON.stringify(future)) });
	const loaded = await loadWinTextDocWithEtag('c', 'p');
	const edited = structuredClone(loaded.doc);
	edited.modes![SECOND].respins = { counter: 'EDITED {count}' };
	await saveWinTextDoc('c', 'p', edited, loaded.etag);
	const stored = JSON.parse(bucket.get(key)!.text);
	check(
		"5. a save keeps a newer build's field inside a mode's family, and its family",
		[stored.modes[SECOND].respins, stored.modes[SECOND].sparkle, stored.modes.gone],
		[{ counter: 'EDITED {count}', future: 'kept' }, { line: 'kept too' }, { futureOnly: true }],
	);
	const plainKey = winTextDocKey('c', 'plain');
	const { modes: _m, ...plain } = authored;
	await saveWinTextDoc('c', 'plain', plain, null);
	check(
		'5. a doc without modes is stored without the key',
		Object.hasOwn(JSON.parse(bucket.get(plainKey)!.text), 'modes'),
		false,
	);
}

// ── 6. the runtime bundle's winText step ────────────────────────────────────────────────────────
{
	const onlyModes = normalizeWinTextDoc({ modes: { [SECOND]: { respins: { last: 'X' } } } });
	check("6. a doc whose only lines are another mode's ships", shippedWinText(onlyModes), onlyModes);
	check('6. an unauthored doc ships nothing', shippedWinText({ version: 1 }), undefined);
	check(
		'6. …nor one with only an emptied mode (pruned on save)',
		shippedWinText(normalizeWinTextDoc({ modes: { [SECOND]: { respins: { last: ' ' } } } })),
		undefined,
	);
}

// ── 7. the game's own selection ─────────────────────────────────────────────────────────────────
{
	const source = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
	const sliceBetween = (text: string, what: string, from: string, to: string) => {
		const start = text.indexOf(from);
		if (start < 0) throw new Error(`${what}: could not find "${from}"`);
		const end = text.indexOf(to, start + from.length);
		if (end < 0) throw new Error(`${what}: could not find "${to}" after it`);
		return text.slice(start, end + to.length);
	};
	const text = source('lines/src/game/holdAndWinText.ts');
	const active = source('lines/src/game/activeRespinMode.svelte.ts');
	const scenes = source('lines/src/editor-scenes.ts');
	const strip = (what: string, slice: string) =>
		stripSliceTypes(what, slice)
			.replaceAll('export const', 'const')
			.replaceAll('export function', 'function');

	const modes = winTextRespinModes(two).map((m) => ({ mode: m.mode }));
	const stack: string[] = [];
	const bundles: { runtime: { winText?: WinTextDoc } | null; baked: { winText?: WinTextDoc } } = {
		runtime: null,
		baked: { winText: authored },
	};
	const game = compileSlice({
		what: 'check-win-text-bonus-modes#the game selection',
		names: [
			'respinModeOnStack',
			'respinModes',
			'stateModes',
			'resolveWinTextForMode',
			'hasRuntimeBundle',
			'bundles',
			'bakedWinText',
			'formatWinText',
			'jackpotCaption',
		],
		body: `${strip(
			'activeRespinMode.svelte.ts',
			sliceBetween(active, 'activeRespinMode', 'export const activeRespinMode = (', '\t);\n') +
				sliceBetween(
					active,
					'isPrimaryRespinMode',
					'export const isPrimaryRespinMode = (',
					'\n};\n',
				),
		)}
const runtimeBundle = bundles.runtime;
const bakedBundle = bundles.baked;
${strip('editor-scenes.ts', sliceBetween(scenes, 'bakedWinTextFor', 'export function bakedWinTextFor(', '\n}\n'))}
${strip(
	'holdAndWinText.ts',
	sliceBetween(text, 'modeWinText', 'const modeWinText = () =>', ';\n') +
		sliceBetween(text, 'respinCounterText', 'export const respinCounterText = (', '\n};\n') +
		sliceBetween(text, 'jackpotBannerText', 'export const jackpotBannerText = (', '\n};\n') +
		sliceBetween(text, 'wheelPrizeText', 'export const wheelPrizeText = (', '\n};\n'),
)}
return { respinCounterText, jackpotBannerText, wheelPrizeText, isPrimaryRespinMode };`,
	});
	const draw = () =>
		game(
			respinModeOnStack,
			() => modes,
			{ state: { stack: stack.map((id) => ({ id })) } },
			resolveWinTextForMode,
			() => bundles.runtime !== null,
			bundles,
			(): ResolvedWinText => resolveWinText(bundles.baked.winText),
			formatWinText,
			jackpotCaption,
		) as {
			respinCounterText: (left: number) => string;
			jackpotBannerText: (tier: string, amount: string, full: boolean) => { title: string };
			wheelPrizeText: (prize: { type: 'coinBoost'; multiplier: number }) => string;
			isPrimaryRespinMode: () => boolean;
		};
	const lines = () => {
		const g = draw();
		return [
			g.isPrimaryRespinMode(),
			g.respinCounterText(3),
			g.jackpotBannerText(`GOLD_${primaryTiers[0]}`, '$1', false).title,
			g.wheelPrizeText({ type: 'coinBoost', multiplier: 2 }),
		];
	};
	check('7. the base game (no respin mode on the stack) draws the primary', lines(), [
		true,
		'SPINS 3',
		`GOLD_${primaryTiers[0]} WIN`,
		'BOOST ×2',
	]);
	stack.push('basegame', 'holdAndWin');
	check('7. the primary on the stack draws the primary', lines()[1], 'SPINS 3');
	stack.splice(0, stack.length, 'basegame', SECOND);
	check('7. mode 2 on top draws its own lines', lines(), [
		false,
		'GOLD SPINS 3',
		'GOLD Gold Bronze',
		'GOLD BOOST ×2',
	]);
	bundles.runtime = { winText: { version: 1 } };
	check('7. the runtime bundle wins over the baked one', lines()[1], 'RESPINS 3');
	bundles.runtime = null;
	bundles.baked = { winText: { ...authored, modes: undefined } };
	check("7. mode 2 without lines draws the primary's", lines()[1], 'SPINS 3');
}

// ── 8. re-homing a gone mode's lines ────────────────────────────────────────────────────────────
{
	const gone: WinTextDoc = {
		version: 1,
		jackpots: { award: 'P' },
		feature: { intro: 'P intro', potLabel: 'pot' },
		modes: { old: { respins: { counter: 'OLD' }, feature: { outro: 'OLD out' } } },
	};
	check(
		'8. moved to a mode with no lines: moved, the gone entry dropped',
		swapWinTextModeLines(gone, 'old', SECOND).modes,
		{ [SECOND]: { respins: { counter: 'OLD' }, feature: { outro: 'OLD out' } } },
	);
	const toPrimary = swapWinTextModeLines(gone, 'old', undefined);
	check(
		"8. moved to the primary: they become the families, the primary's go to the gone slot",
		[toPrimary.jackpots, toPrimary.respins, toPrimary.feature, toPrimary.modes],
		[
			undefined,
			{ counter: 'OLD' },
			{ potLabel: 'pot', outro: 'OLD out' },
			{ old: { jackpots: { award: 'P' }, feature: { intro: 'P intro' } } },
		],
	);
	check(
		'8. swapping back restores the doc',
		normalizeWinTextDoc(swapWinTextModeLines(toPrimary, 'old', undefined)),
		normalizeWinTextDoc(gone),
	);
	check(
		'8. a mode id named like a prototype member is its own key',
		Object.hasOwn(swapWinTextModeLines(gone, 'old', 'constructor').modes!, 'constructor'),
		true,
	);
}

if (failures) {
	console.log(`\ncheck:win-text-bonus-modes — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`check:win-text-bonus-modes — all ${checks} checks pass`);
