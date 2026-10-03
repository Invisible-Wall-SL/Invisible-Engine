/**
 * Contract check for the Game Maker's pots overlay add-on (docs/design/pots-overlay.md §4):
 *   pnpm --filter launcher-api check:pots-overlay-add-on
 *
 * Runs the REAL `projectAddOn.ts`, `projectScaffold.ts` and the doc stores over an in-memory R2;
 * only R2 and the project lookup are stubbed. What it pins:
 *  - the symbols seed binds every token (and a Hold and Win bonus's role symbols) to placeholder
 *    art under the names AFTER renames, never touches a binding the doc has, and a re-run adds
 *    nothing;
 *  - the layout merge adds only the add-on screens the layout lacks, with the config's pots, and
 *    leaves every authored screen byte-identical;
 *  - the scaffold's scene set is byte-identical to before for every project without an add-on, and
 *    carries the overlay screens for one with;
 *  - end to end: the config is added once (a second add is refused), a part that loses its race is
 *    reported and filled by a re-run, the Flow is grafted only when asked, and nothing is written to
 *    Win Text;
 *  - the REAL symbols export does not report the seeded placeholder art as missing: the shared
 *    runtime registers those built-in frames itself, so "will render blank" was a false alarm on
 *    every overlay project. A bound frame nothing ships is still reported.
 */
import { mock } from 'node:test';
import type { LiveLease } from '../src/lib/server/lease.ts';
import { getFullSceneSet, type LayoutDoc, type Scene } from 'engine-layout';
import {
	HOLD_AND_WIN_PRESETS,
	addPotsOverlay,
	normalizeGameConfigDoc,
	type GameConfigDoc,
	type PotsOverlayPresetId,
} from 'game-config';

type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
/** Keys a "concurrent author" saves between the add-on's read and its write. */
const RACE = new Map<string, string>();

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`conflict ${key}`);
	}
}
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (base: string | null | undefined) =>
			base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
		objectExists: async (key: string) => R2.has(key),
		headObject: async (key: string) => (R2.has(key) ? { etag: R2.get(key)!.etag } : null),
		getObjectText: async (key: string) => R2.get(key)?.body ?? null,
		getObjectTextWithEtag: async (key: string) => {
			const o = R2.get(key);
			return o ? { text: o.body, etag: o.etag } : null;
		},
		putObjectText: async (
			key: string,
			text: string,
			_type: string,
			cond?: { ifMatch?: string; ifNoneMatch?: string },
		) => {
			const raced = RACE.get(key);
			if (raced !== undefined) {
				RACE.delete(key);
				R2.set(key, { body: raced, etag: `"e${++etagSeq}"` });
			}
			const cur = R2.get(key);
			if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
			if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
			R2.set(key, { body: text, etag: `"e${++etagSeq}"` });
			return R2.get(key)!.etag;
		},
		copyObject: async (from: string, to: string) => {
			const o = R2.get(from);
			if (!o) return false;
			R2.set(to, { ...o });
			return true;
		},
		getObjectBytes: async (key: string) => {
			const o = R2.get(key);
			return o ? new TextEncoder().encode(o.body) : null;
		},
		putObjectBytes: async (key: string, bytes: Uint8Array) => {
			R2.set(key, { body: new TextDecoder().decode(bytes), etag: `"e${++etagSeq}"` });
			return R2.get(key)!.etag;
		},
		deleteObject: async (key: string) => R2.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
		listObjects: async () => ({ keys: [], prefixes: [] }),
	},
});

const GAME_TYPES: Record<string, string> = {
	hw: 'holdAndWin',
	hwClassic: 'holdAndWin',
	hwNew: 'holdAndWin',
	hwFit: 'holdAndWin',
};
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		projectGameType: async (p: string) => GAME_TYPES[p] ?? 'bookOf',
	},
});

/** The edit leases "held" right now, by any session; the add-on reads them, never writes them. */
const LEASES: (LiveLease & { projectKey: string })[] = [];
mock.module(src('lib/server/lease.ts'), {
	namedExports: {
		liveLeases: async (keys: { toolId: string; docKey: string; projectKey: string }[]) =>
			LEASES.filter((l) =>
				keys.some(
					(k) => k.toolId === l.toolId && k.docKey === l.docKey && k.projectKey === l.projectKey,
				),
			),
	},
});
/** The projects whose runtime bundle the add-on invalidated, in order. */
const INVALIDATED: string[] = [];
mock.module(src('lib/server/runtimeBundleCache.ts'), {
	namedExports: { invalidateRuntimeBundle: (project: string) => INVALIDATED.push(project) },
});
/** The caller's own session. */
const ME = 'session-me';

const { applyPotsOverlayAddOn, cleanOverlayPresets, leaseBlocker, mergeAddOnScreens } =
	await import('../src/lib/server/projectAddOn.ts');
const { scaffoldProject, scaffoldLayoutDoc } = await import('../src/lib/server/projectScaffold.ts');
const { potsOverlaySymbolsSeed, symbolDefaultsFor } =
	await import('../src/lib/server/symbolDefaults.ts');
const { gameConfigDefaultFor } = await import('../src/lib/server/gameConfigDefaults.ts');
const { normalizeDoc } = await import('../src/lib/server/editorStorage.ts');
const { sceneSetOptionsFor } = await import('../src/lib/addOns.ts');
const { exportEditorSymbols } = await import('../src/lib/server/symbolExport.ts');
const { editorDocKey, flowV2DocKey, gameConfigDocKey, symbolsDocKey, winTextDocKey } =
	await import('../src/lib/server/projectPaths.ts');

const CLIENT = 'invisible_wall';
let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
	try {
		await fn();
		console.log(`  ok  ${name}`);
	} catch (e) {
		failures++;
		console.error(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
	}
}
function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}
const same = (a: unknown, b: unknown, msg: string) =>
	assert(
		JSON.stringify(a) === JSON.stringify(b),
		`${msg}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`,
	);

const normalized = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	assert(doc, 'config did not normalize');
	return doc;
};
const withOverlay = (doc: GameConfigDoc, preset: PotsOverlayPresetId) => {
	const result = addPotsOverlay(doc, preset);
	assert(result.ok, `add refused: ${result.ok ? '' : result.reason}`);
	return result;
};
const FIRST_RUN = { screens: true };
const RE_RUN = { screens: false };
const lines = gameConfigDefaultFor('lines');
assert(lines, 'no lines default');
const hwPots = normalized(HOLD_AND_WIN_PRESETS.pots);
const defaults = symbolDefaultsFor('holdAndWin').symbols;
const emptySymbols = { version: 1 as const, symbols: {} };
/** The placeholder a binding must equal: the default's type / assetKey / animationName. */
const placeholder = (source: string) =>
	Object.fromEntries(
		Object.entries(defaults[source]).map(([state, cell]) => [
			state,
			{
				type: cell.type,
				assetKey: cell.assetKey,
				...(cell.animationName ? { animationName: cell.animationName } : {}),
			},
		]),
	);

console.log('\n1. symbols seed');

await check('3 Pots on a lines host: every token and bonus symbol, blank excluded', () => {
	const { doc } = withOverlay(lines, 'threePots');
	const seed = potsOverlaySymbolsSeed(doc, emptySymbols);
	same(
		[...seed.added].sort(),
		[
			'BONUS',
			'BOOST',
			'COLLECT',
			'JACKPOT',
			'MULTI',
			'MYSTERY',
			'POT_BLUE',
			'POT_GREEN',
			'POT_RED',
		],
		'bound symbols',
	);
	same(seed.missingArt, [], 'missing art');
	same(seed.doc.symbols.POT_RED, placeholder('BOOST'), 'the red token borrows the payer art');
	same(seed.doc.symbols.POT_BLUE, placeholder('COLLECT'), 'the blue token borrows the collector');
	same(seed.doc.symbols.POT_GREEN, placeholder('MULTI'), 'the green token borrows the multiplier');
	same(seed.doc.symbols.BONUS, placeholder('BONUS'), 'the coin keeps its own art');
	assert(!('BLANK' in seed.doc.symbols), 'a blank was bound');
});

await check('pots to free spins: one token, no Hold and Win symbols', () => {
	const { doc } = withOverlay(lines, 'potsToFreeSpins');
	const seed = potsOverlaySymbolsSeed(doc, emptySymbols);
	same(seed.added, ['POT_GOLD'], 'bound symbols');
	same(seed.doc.symbols.POT_GOLD, placeholder('BONUS'), 'an unknown pot borrows the coin');
});

await check('renamed names are bound, the host symbol under the old name is not', () => {
	const host = structuredClone(lines);
	host.symbols.BONUS = {};
	host.symbols.POT_RED = {};
	const result = withOverlay(host, 'threePots');
	same(result.renamed.symbols.BONUS, 'BONUS_2', 'BONUS renamed');
	same(result.renamed.symbols.POT_RED, 'POT_RED_2', 'POT_RED renamed');
	const authored = {
		version: 1 as const,
		symbols: { BONUS: { static: { type: 'sprite' as const, assetKey: 'mine.png' } } },
	};
	const seed = potsOverlaySymbolsSeed(result.doc, authored);
	same(seed.doc.symbols.BONUS_2, placeholder('BONUS'), 'BONUS_2 takes the coin art');
	same(seed.doc.symbols.POT_RED_2, placeholder('BOOST'), 'POT_RED_2 takes the red art');
	same(seed.doc.symbols.BONUS, authored.symbols.BONUS, 'the host BONUS binding');
	assert(!seed.added.includes('POT_RED'), 'the host POT_RED was bound');
});

await check(
	'a Hold and Win game: renamed pots find their art, its own block is not the add-on',
	() => {
		const result = withOverlay(hwPots, 'threePots');
		same(result.renamed.pots, { red: 'red_2', blue: 'blue_2', green: 'green_2' }, 'pot renames');
		const seed = potsOverlaySymbolsSeed(result.doc, emptySymbols);
		same([...seed.added].sort(), ['POT_BLUE', 'POT_GREEN', 'POT_RED'], 'only the tokens');
		same(seed.doc.symbols.POT_RED, placeholder('BOOST'), 'red_2 borrows the red art');
	},
);

await check('an authored binding is never touched, and a re-run adds nothing', () => {
	const { doc } = withOverlay(lines, 'threePots');
	const mine = { static: { type: 'sprite' as const, assetKey: 'my_red.png' } };
	const first = potsOverlaySymbolsSeed(doc, { version: 1, symbols: { POT_RED: mine } });
	same(first.doc.symbols.POT_RED, mine, 'the authored token binding');
	assert(!first.added.includes('POT_RED'), 'POT_RED reported as added');
	const again = potsOverlaySymbolsSeed(doc, first.doc);
	same(again.added, [], 'second seed');
	assert(again.doc === first.doc, 'a no-op seed returned a new doc');
});

console.log('\n2. layout merge');

const bookLayout = (): LayoutDoc => ({
	...(getFullSceneSet('bookOf') as LayoutDoc),
	projectKey: 'book',
});
const sceneIds = (scenes: readonly Scene[]) => scenes.map((s) => s.id);
const potsOf = (doc: LayoutDoc) =>
	(doc.scenes.find((s) => s.id === 'pots')?.nodes ?? []).map((n) => n.id);

await check(
	'3 Pots: the pots, jackpot bar and Hold and Win mode screens, nothing else touched',
	() => {
		const { doc: config } = withOverlay(lines, 'threePots');
		const before = bookLayout();
		const merged = mergeAddOnScreens(before, 'bookOf', config, FIRST_RUN);
		same(
			merged.added,
			[
				'jackpotBar',
				'pots',
				'respinBackground',
				'respinBoard',
				'respinCounter',
				'totalWinBar',
				'letters',
				'wheel',
				'featureIntro',
				'jackpotWin',
				'featureOutro',
			],
			'added screens',
		);
		same(potsOf(merged.doc), ['pot-red', 'pot-blue', 'pot-green'], 'the config pots');
		for (const scene of before.scenes) {
			same(
				merged.doc.scenes.find((s) => s.id === scene.id),
				scene,
				`screen ${scene.id}`,
			);
		}
		same(
			sceneIds(merged.doc.scenes).filter((id) => !merged.added.includes(id)),
			sceneIds(before.scenes),
			'the authored order',
		);
		same(before, bookLayout(), 'the input was mutated');
		const again = mergeAddOnScreens(merged.doc, 'bookOf', config, FIRST_RUN);
		same(again.added, [], 'a second merge');
		assert(again.doc === merged.doc, 'a no-op merge returned a new doc');
	},
);

await check('pots to free spins: the Pots screen alone, with its gold pot', () => {
	const { doc: config } = withOverlay(lines, 'potsToFreeSpins');
	const merged = mergeAddOnScreens(bookLayout(), 'bookOf', config, FIRST_RUN);
	same(merged.added, ['pots'], 'added screens');
	same(potsOf(merged.doc), ['pot-gold'], 'the gold pot');
});

await check('a hand-authored layout keeps every screen; only the add-on screens join', () => {
	const { doc: config } = withOverlay(lines, 'potsToFreeSpins');
	const authored: LayoutDoc = {
		...bookLayout(),
		scenes: [
			{ id: 'mine', name: 'Mine', nodes: [] },
			{ id: 'pots', name: 'My pots', nodes: [] },
		],
	};
	const merged = mergeAddOnScreens(authored, 'bookOf', config, FIRST_RUN);
	same(merged.added, ['pot-gold'], 'only a meter for the pot that has none');
	same(merged.doc.scenes[0], authored.scenes[0], 'the other screen');
	same(merged.doc.scenes[1].name, 'My pots', 'the existing Pots screen is kept');
	same(potsOf(merged.doc), ['pot-gold'], 'its meter');
});

await check('every pot metered on another screen: no Pots screen, no second meter', () => {
	const { doc: config } = withOverlay(lines, 'threePots');
	const first = mergeAddOnScreens(bookLayout(), 'bookOf', config, FIRST_RUN).doc;
	const meters = first.scenes.find((s) => s.id === 'pots')?.nodes ?? [];
	const moved: LayoutDoc = {
		...first,
		scenes: first.scenes
			.filter((s) => s.id !== 'pots')
			.map((s) =>
				s.id === 'jackpotBar'
					? {
							...s,
							nodes: [...s.nodes, { id: 'box', kind: 'container', x: 0, y: 0, children: meters }],
						}
					: s,
			) as LayoutDoc['scenes'],
	};
	for (const run of [FIRST_RUN, RE_RUN]) {
		const again = mergeAddOnScreens(moved, 'bookOf', config, run);
		same(again.added, [], `screens: ${run.screens}`);
	}
});

await check('a re-run revives no deleted screen; a pot with no meter anywhere is reported', () => {
	const { doc: config } = withOverlay(lines, 'threePots');
	const first = mergeAddOnScreens(bookLayout(), 'bookOf', config, FIRST_RUN).doc;
	const trimmed: LayoutDoc = {
		...first,
		scenes: first.scenes.filter((s) => !['pots', 'wheel', 'letters'].includes(s.id)),
	};
	const again = mergeAddOnScreens(trimmed, 'bookOf', config, RE_RUN);
	same(again.added, [], 'nothing re-added');
	assert(again.doc === trimmed, 'the layout changed');
	assert(again.note?.includes('red, blue, green'), `no note naming the pots: ${again.note}`);
});

console.log('\n2b. an overlay with no pots (value coins only)');

/** A coins-only overlay, by hand: the 3 Pots add with its pots and tokens taken out again. */
const coinsOnly = (): GameConfigDoc => {
	const doc = structuredClone(withOverlay(lines, 'threePots').doc);
	for (const pot of doc.potsOverlay?.pots ?? []) delete doc.symbols[pot.token];
	if (doc.potsOverlay) {
		doc.potsOverlay.pots = [];
		doc.potsOverlay.drops.table = [{ coin: true, weight: 1 }];
	}
	return doc;
};

await check('no tokens bound, the Hold and Win bonus symbols still are', () => {
	const seed = potsOverlaySymbolsSeed(coinsOnly(), emptySymbols);
	same(
		[...seed.added].sort(),
		['BONUS', 'BOOST', 'COLLECT', 'JACKPOT', 'MULTI', 'MYSTERY'],
		'bound symbols',
	);
});

await check('no Pots screen; the jackpot bar and Hold and Win mode screens join', () => {
	const merged = mergeAddOnScreens(bookLayout(), 'bookOf', coinsOnly(), FIRST_RUN);
	assert(!merged.added.includes('pots'), 'a Pots screen was merged');
	same(
		merged.added,
		[
			'jackpotBar',
			'respinBackground',
			'respinBoard',
			'respinCounter',
			'totalWinBar',
			'letters',
			'wheel',
			'featureIntro',
			'jackpotWin',
			'featureOutro',
		],
		'added screens',
	);
});

console.log('\n3. scaffold scene set');

const KINDS = ['lines', 'bookOf', 'ways', 'cluster', 'scatter', 'holdAndWin'];
/** What the scaffold passed before the add-ons: a Hold and Win kind's `maxRows`, nothing else. */
const legacyOptions = (kind: string, doc: GameConfigDoc | null) => {
	const maxRows = kind === 'holdAndWin' ? doc?.holdAndWin?.expansion?.maxRows : undefined;
	return maxRows ? { maxRows } : {};
};

await check('every project without an add-on: byte-identical to before', () => {
	const expanding = structuredClone(hwPots);
	if (expanding.holdAndWin) {
		expanding.holdAndWin.expansion = { startRows: 3, maxRows: 6, rule: 'fullRow' };
	}
	const configs: (GameConfigDoc | null)[] = [
		null,
		lines,
		hwPots,
		normalized(HOLD_AND_WIN_PRESETS.classic),
		normalized(HOLD_AND_WIN_PRESETS.collector),
		expanding,
	];
	for (const kind of KINDS) {
		for (const doc of configs) {
			if (doc && doc !== lines && kind !== 'holdAndWin') continue;
			same(
				getFullSceneSet(kind, sceneSetOptionsFor(kind, doc)),
				getFullSceneSet(kind, legacyOptions(kind, doc)),
				`${kind} with ${doc?.gameName ?? 'no config'}`,
			);
		}
	}
});

await check('with an add-on: the overlay screens, the config pots', () => {
	const { doc } = withOverlay(lines, 'threePots');
	const book = getFullSceneSet('bookOf', sceneSetOptionsFor('bookOf', doc));
	assert(
		book?.scenes.some((s) => s.id === 'pots'),
		'bookOf has no Pots screen',
	);
	const hw = withOverlay(hwPots, 'threePots').doc;
	const set = getFullSceneSet('holdAndWin', sceneSetOptionsFor('holdAndWin', hw));
	same(
		potsOf(set as LayoutDoc),
		['pot-red', 'pot-blue', 'pot-green', 'pot-red_2', 'pot-blue_2', 'pot-green_2'],
		'a Hold and Win game lists its meters and its pots',
	);
});

console.log('\n4. end to end');

const stored = (key: string) => R2.get(key)?.body;
const storedJson = <T>(key: string): T => JSON.parse(stored(key) ?? 'null') as T;

await check(
	'a Book-of project: config, symbols and screens added; Flow and Win Text untouched',
	async () => {
		await scaffoldProject(CLIENT, 'book');
		const flowBefore = stored(flowV2DocKey(CLIENT, 'book'));
		const layoutBefore = storedJson<LayoutDoc>(editorDocKey(CLIENT, 'book'));
		assert(!R2.has(gameConfigDocKey(CLIENT, 'book')), 'the scaffold authored a bookOf config');
		same(
			layoutBefore.scenes,
			scaffoldLayoutDoc('book', 'bookOf', getFullSceneSet('bookOf')).scenes,
			'the scaffold layout without an add-on',
		);

		const out = await applyPotsOverlayAddOn(CLIENT, 'book', { sessionId: ME, preset: 'threePots' });
		same(INVALIDATED, ['book'], 'the runtime bundle invalidated once');
		assert(out.ok, `refused: ${out.ok ? '' : out.error}`);
		assert(out.configAdded, 'config not added');
		same(out.seeds.symbols.status, 'added', 'symbols');
		same(out.seeds.layout.status, 'added', 'layout');
		same(out.seeds.winText.status, 'present', 'win text');
		assert(!out.seeds.flow, 'the flow was grafted unasked');
		assert(
			storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, 'book')).potsOverlay,
			'no overlay stored',
		);
		const symbols = storedJson<{ symbols: Record<string, unknown> }>(symbolsDocKey(CLIENT, 'book'));
		assert(symbols.symbols.POT_RED, 'POT_RED not bound');
		const layout = storedJson<LayoutDoc>(editorDocKey(CLIENT, 'book'));
		assert(
			layout.scenes.some((s) => s.id === 'pots'),
			'no Pots screen stored',
		);
		// The editor store normalizes the scaffold's raw doc on its first save, as any save would.
		for (const scene of normalizeDoc(layoutBefore, 'book').scenes) {
			same(
				layout.scenes.find((s) => s.id === scene.id),
				scene,
				`screen ${scene.id}`,
			);
		}
		same(stored(flowV2DocKey(CLIENT, 'book')), flowBefore, 'the flow');
		assert(!R2.has(winTextDocKey(CLIENT, 'book')), 'a win text doc was written');
	},
);

await check(
	'a second add is refused; the re-run without a preset finds nothing to add',
	async () => {
		const config = stored(gameConfigDocKey(CLIENT, 'book'));
		const again = await applyPotsOverlayAddOn(CLIENT, 'book', {
			sessionId: ME,
			preset: 'potsToFreeSpins',
		});
		assert(!again.ok && again.status === 409, 'a second overlay was not refused');
		same(stored(gameConfigDocKey(CLIENT, 'book')), config, 'the config');
		const fill = await applyPotsOverlayAddOn(CLIENT, 'book', { sessionId: ME });
		assert(fill.ok && !fill.configAdded, 'the re-run');
		same([fill.seeds.symbols.status, fill.seeds.layout.status], ['present', 'present'], 'parts');
	},
);

await check('seeding without an overlay is refused', async () => {
	await scaffoldProject(CLIENT, 'plain');
	const out = await applyPotsOverlayAddOn(CLIENT, 'plain', { sessionId: ME });
	assert(!out.ok && out.status === 400, 'not refused');
	assert(!R2.has(gameConfigDocKey(CLIENT, 'plain')), 'a config was written');
});

await check('a part that loses its race is reported, and a re-run fills it in', async () => {
	await scaffoldProject(CLIENT, 'race');
	const theirs = JSON.stringify({
		version: 1,
		symbols: { H1: { static: { type: 'sprite', assetKey: 'h.png' } } },
	});
	RACE.set(symbolsDocKey(CLIENT, 'race'), theirs);
	const out = await applyPotsOverlayAddOn(CLIENT, 'race', {
		sessionId: ME,
		preset: 'potsToFreeSpins',
	});
	assert(out.ok, 'refused');
	same(out.seeds.symbols.status, 'conflict', 'symbols');
	same(out.seeds.layout.status, 'added', 'layout');
	same(stored(symbolsDocKey(CLIENT, 'race')), theirs, 'the concurrent save');
	const fill = await applyPotsOverlayAddOn(CLIENT, 'race', { sessionId: ME });
	assert(fill.ok, 'the re-run');
	same(fill.seeds.symbols.added, ['POT_GOLD'], 'symbols filled');
	same(fill.seeds.layout.status, 'present', 'layout');
	const symbols = storedJson<{ symbols: Record<string, unknown> }>(symbolsDocKey(CLIENT, 'race'));
	assert(symbols.symbols.H1 && symbols.symbols.POT_GOLD, 'the merge lost a binding');
});

await check('the Flow graft runs only when asked, once', async () => {
	await scaffoldProject(CLIENT, 'flow');
	const before = stored(flowV2DocKey(CLIENT, 'flow'));
	const out = await applyPotsOverlayAddOn(CLIENT, 'flow', {
		sessionId: ME,
		preset: 'threePots',
		flow: true,
	});
	assert(out.ok && out.seeds.flow, 'no flow part');
	same(out.seeds.flow.status, 'added', 'flow');
	assert(out.seeds.flow.added.includes('modes.holdAndWin'), 'no Hold and Win mode section');
	assert(stored(flowV2DocKey(CLIENT, 'flow')) !== before, 'the flow was not written');
	const again = await applyPotsOverlayAddOn(CLIENT, 'flow', { sessionId: ME, flow: true });
	assert(again.ok && again.seeds.flow, 'no flow part');
	same(again.seeds.flow.status, 'present', 'a second graft');
	R2.delete(flowV2DocKey(CLIENT, 'flow'));
	const none = await applyPotsOverlayAddOn(CLIENT, 'flow', { sessionId: ME, flow: true });
	assert(none.ok && none.seeds.flow, 'no flow part');
	same(none.seeds.flow.status, 'skipped', 'an unauthored flow');
	assert(!R2.has(flowV2DocKey(CLIENT, 'flow')), 'a flow was seeded');
});

await check(
	'a new Hold and Win game with the overlay: renamed pots, its own symbols kept',
	async () => {
		await scaffoldProject(CLIENT, 'hwNew');
		const symbolsBefore = stored(symbolsDocKey(CLIENT, 'hwNew'));
		const layoutBefore = normalizeDoc(
			storedJson<LayoutDoc>(editorDocKey(CLIENT, 'hwNew')),
			'hwNew',
		);
		const out = await applyPotsOverlayAddOn(CLIENT, 'hwNew', {
			sessionId: ME,
			preset: 'threePots',
		});
		assert(out.ok, 'refused');
		same(out.renamed.pots, { red: 'red_2', blue: 'blue_2', green: 'green_2' }, 'renames');
		same([...out.seeds.symbols.added].sort(), ['POT_BLUE', 'POT_GREEN', 'POT_RED'], 'symbols');
		same(
			[out.seeds.layout.status, out.seeds.layout.added],
			['added', ['pot-red_2', 'pot-blue_2', 'pot-green_2']],
			'a Pot Meter for each overlay pot',
		);
		const layout = storedJson<LayoutDoc>(editorDocKey(CLIENT, 'hwNew'));
		const potsBefore = layoutBefore.scenes.find((s) => s.id === 'pots');
		const potsAfter = layout.scenes.find((s) => s.id === 'pots');
		assert(potsBefore && potsAfter, 'no Pots screen');
		same(
			potsAfter.nodes.slice(0, potsBefore.nodes.length),
			potsBefore.nodes,
			'the existing Pot Meters',
		);
		same(
			potsAfter.nodes.map((n) => n.id),
			['pot-red', 'pot-blue', 'pot-green', 'pot-red_2', 'pot-blue_2', 'pot-green_2'],
			'the Pots screen',
		);
		for (const scene of layoutBefore.scenes.filter((s) => s.id !== 'pots')) {
			same(
				layout.scenes.find((s) => s.id === scene.id),
				scene,
				`screen ${scene.id}`,
			);
		}
		const again = await applyPotsOverlayAddOn(CLIENT, 'hwNew', { sessionId: ME });
		assert(again.ok, 'the re-run');
		same(again.seeds.layout.status, 'present', 'a second run adds no meter');
		const symbols = storedJson<{ symbols: Record<string, unknown> }>(
			symbolsDocKey(CLIENT, 'hwNew'),
		);
		const before = JSON.parse(symbolsBefore ?? '{}') as { symbols: Record<string, unknown> };
		for (const [name, cells] of Object.entries(before.symbols)) {
			same(symbols.symbols[name], cells, `binding ${name}`);
		}
	},
);

await check('re-scaffolding an overlay project seeds its overlay screens', async () => {
	R2.delete(editorDocKey(CLIENT, 'book'));
	await scaffoldProject(CLIENT, 'book');
	const layout = storedJson<LayoutDoc>(editorDocKey(CLIENT, 'book'));
	assert(
		layout.scenes.some((s) => s.id === 'pots'),
		'the re-scaffold has no Pots screen',
	);
	const pots = layout.scenes.find((s) => s.id === 'pots')?.nodes.map((n) => n.id);
	same(pots, ['pot-red', 'pot-blue', 'pot-green'], 'the config pots');
});

console.log('\n5. re-runs, leases, unreadable docs, presets that do not fit');

/** Every stored object, to prove a refusal wrote nothing. */
const snapshot = () => JSON.stringify([...R2.entries()].sort(([a], [b]) => a.localeCompare(b)));

await check(
	'the reported repro: meters moved, Pots / wheel / letters deleted, re-run',
	async () => {
		await scaffoldProject(CLIENT, 'moved');
		const out = await applyPotsOverlayAddOn(CLIENT, 'moved', {
			sessionId: ME,
			preset: 'threePots',
		});
		assert(out.ok, 'refused');
		const key = editorDocKey(CLIENT, 'moved');
		const layout = storedJson<LayoutDoc>(key);
		const meters = layout.scenes.find((s) => s.id === 'pots')?.nodes ?? [];
		layout.scenes = layout.scenes
			.filter((s) => !['pots', 'wheel', 'letters'].includes(s.id))
			.map((s) => (s.id === 'jackpotBar' ? { ...s, nodes: [...s.nodes, ...meters] } : s));
		R2.set(key, { body: JSON.stringify(layout), etag: `"e${++etagSeq}"` });
		const before = stored(key);
		const again = await applyPotsOverlayAddOn(CLIENT, 'moved', { sessionId: ME });
		assert(again.ok, 'the re-run');
		same(again.seeds.layout.status, 'present', 'layout');
		same(stored(key), before, 'the layout bytes');
	},
);

await check('leases: another session blocks with its name, my own tabs do not (pure)', () => {
	const targets = [
		{ toolId: 'gameConfig', docKey: 'gameConfig', path: '/config' },
		{ toolId: 'symbols', docKey: 'symbols', path: '/symbols' },
	];
	const lease = (holderSessionId: string, holderName: string | null) => ({
		toolId: 'symbols',
		docKey: 'symbols',
		holderSessionId,
		holderName,
	});
	same(leaseBlocker([], ME, targets), null, 'no lease');
	same(leaseBlocker([lease(ME, 'Me')], ME, targets), null, 'my own tab');
	assert(
		leaseBlocker([lease('other', 'Ana')], ME, targets)?.startsWith('Ana is editing /symbols'),
		'named',
	);
	assert(
		leaseBlocker([lease('other', null)], ME, targets)?.startsWith('Someone is editing'),
		'unnamed',
	);
	same(
		leaseBlocker([{ ...lease('other', 'Ana'), toolId: 'flow', docKey: 'flow' }], ME, targets),
		null,
		'a doc it does not write',
	);
});

await check('a live lease held elsewhere: 409, and nothing written', async () => {
	await scaffoldProject(CLIENT, 'leased');
	LEASES.push({
		toolId: 'editor',
		docKey: 'editor',
		projectKey: 'leased',
		holderSessionId: 'other',
		holderName: 'Ana',
	});
	const before = snapshot();
	const out = await applyPotsOverlayAddOn(CLIENT, 'leased', { sessionId: ME, preset: 'threePots' });
	assert(!out.ok && out.status === 409, 'not refused');
	assert(out.error.startsWith('Ana is editing /editor'), out.error);
	same(snapshot(), before, 'R2');
	LEASES.push({
		toolId: 'flow',
		docKey: 'flow',
		projectKey: 'leased',
		holderSessionId: ME,
		holderName: 'Me',
	});
	LEASES.splice(0, 1);
	const mine = await applyPotsOverlayAddOn(CLIENT, 'leased', {
		sessionId: ME,
		preset: 'threePots',
		flow: true,
	});
	assert(mine.ok, 'my own lease blocked the add-on');
	LEASES.length = 0;
});

await check('an unreadable or invalid Game Config: 409, and nothing written', async () => {
	for (const [project, body] of [
		['badJson', '{not json'],
		['badShape', '{"foo": 1}'],
	] as const) {
		await scaffoldProject(CLIENT, project);
		R2.set(gameConfigDocKey(CLIENT, project), { body, etag: `"e${++etagSeq}"` });
		const before = snapshot();
		const out = await applyPotsOverlayAddOn(CLIENT, project, {
			sessionId: ME,
			preset: 'threePots',
		});
		assert(!out.ok && out.status === 409, `${project}: not refused`);
		same(snapshot(), before, `${project}: R2`);
	}
});

await check('unreadable symbols, layout and flow: skipped, their bytes untouched', async () => {
	await scaffoldProject(CLIENT, 'badDocs');
	const bad: [string, string][] = [
		[symbolsDocKey(CLIENT, 'badDocs'), 'null'],
		[editorDocKey(CLIENT, 'badDocs'), '{"scenes":"oops"}'],
		[flowV2DocKey(CLIENT, 'badDocs'), '[]'],
	];
	for (const [key, body] of bad) R2.set(key, { body, etag: `"e${++etagSeq}"` });
	const out = await applyPotsOverlayAddOn(CLIENT, 'badDocs', {
		sessionId: ME,
		preset: 'threePots',
		flow: true,
	});
	assert(out.ok && out.seeds.flow, 'refused');
	same(
		[out.seeds.symbols.status, out.seeds.layout.status, out.seeds.flow.status],
		['skipped', 'skipped', 'skipped'],
		'parts',
	);
	for (const [key, body] of bad) same(stored(key), body, key);
	for (const body of ['[]', '"x"', '{"symbols":"oops"}']) {
		R2.set(symbolsDocKey(CLIENT, 'badDocs'), { body, etag: `"e${++etagSeq}"` });
		const again = await applyPotsOverlayAddOn(CLIENT, 'badDocs', { sessionId: ME });
		assert(again.ok, 'the re-run');
		same(again.seeds.symbols.status, 'skipped', `symbols ${body}`);
		same(stored(symbolsDocKey(CLIENT, 'badDocs')), body, `symbols ${body} bytes`);
	}
});

await check('presets offered are the ones that add cleanly', () => {
	same(cleanOverlayPresets(lines), ['threePots', 'potsToFreeSpins', 'coinsOnly'], 'lines');
	same(cleanOverlayPresets(hwPots), ['threePots', 'potsToFreeSpins'], 'a 3 Pots game');
	for (const id of ['classic', 'collector'] as const) {
		same(cleanOverlayPresets(normalized(HOLD_AND_WIN_PRESETS[id])), ['potsToFreeSpins'], id);
	}
	same(cleanOverlayPresets(withOverlay(lines, 'threePots').doc), [], 'one already added');
	same(cleanOverlayPresets(null), [], 'no config');
});

await check('a preset that does not fit: a readable refusal, no validator paths', async () => {
	await scaffoldProject(CLIENT, 'hwFit', { holdAndWinPreset: 'classic' });
	const before = snapshot();
	const out = await applyPotsOverlayAddOn(CLIENT, 'hwFit', { sessionId: ME, preset: 'threePots' });
	assert(!out.ok && out.status === 400, 'not refused');
	assert(out.error.startsWith("This preset doesn't fit this game: "), out.error);
	assert(!/potsOverlay\.|holdAndWin\./.test(out.error), `a path leaked: ${out.error}`);
	same(snapshot(), before, 'R2');
});

console.log('\n6. the seeded art is not reported missing');

await check('the overlay symbols export: no missing frame, no missing spine', async () => {
	const symbols = storedJson<{ symbols: Record<string, unknown> }>(symbolsDocKey(CLIENT, 'book'));
	assert(symbols.symbols.POT_RED && symbols.symbols.BONUS, 'section 4 seeded no overlay symbols');
	const { index } = await exportEditorSymbols(CLIENT, 'book');
	same(index.missing, [], 'missing frames');
	same(index.spinesMissing, [], 'missing spines');
});

await check('a bound frame nothing ships is still reported', async () => {
	const key = symbolsDocKey(CLIENT, 'book');
	const doc = storedJson<{ symbols: Record<string, Record<string, unknown>> }>(key);
	doc.symbols.POT_RED.static = { type: 'sprite', assetKey: 'not_in_any_atlas.png' };
	R2.set(key, { body: JSON.stringify(doc), etag: `"e${++etagSeq}"` });
	const { index } = await exportEditorSymbols(CLIENT, 'book');
	same(index.missing, ['not_in_any_atlas.png'], 'missing frames');
});

if (failures) {
	console.error(`\ncheck:pots-overlay-add-on — ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:pots-overlay-add-on — all passed');
