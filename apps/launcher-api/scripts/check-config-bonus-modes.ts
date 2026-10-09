/**
 * Contract check for `/config` as a SPLIT-FORM WRITER (`docs/design/bonus-games.md` §2.1, §2.4,
 * Phase 5a):
 *   pnpm --filter launcher-api check:config-bonus-modes
 *
 * Runs the REAL `gameConfigStorage.ts` save and load over an in-memory R2, and the page's own shaping
 * around them (`src/routes/(app)/config/pageDoc.ts`): it opens the stored doc (`openDoc`, a legacy
 * pair migrated), edits that, PUTs it whole (`bodyFor`) and re-opens the doc the save returns
 * (`adoptSaved`). What it pins:
 *  - the page never holds or sends the legacy `holdAndWin` / `potsOverlay` keys;
 *  - the three Hold and Win samples and `borut-pots-sample` open, save and reload with NO diff to the
 *    stored doc (bar `updatedAt`) — stored normalized, or still in the legacy shape (bonus-games
 *    Phase 7b), which the open migrates and the save never writes back;
 *  - a lines project adds a Coin overlay and two respin modes from different presets, routes pot A →
 *    mode 1 and pot B → mode 2, and an edit to mode 2's rules survives a save and a reload;
 *  - the STORED JSON — what the `.mjs` mocks and `test-server` read — carries no legacy key, and its
 *    block views (`primaryHoldAndWin`, `potsOverlayOf`) are the primary mode's block, unchanged, and
 *    the pots;
 *  - a route to a respin mode other than `holdAndWin` saves with no warning: the game plays every
 *    respin mode (bonus-games Phase 4);
 *  - Play (Automatic / Manual) is stored per mode only when Manual (`setRespinPlay`), reaches the
 *    primary block for mode 1, and choosing Automatic deletes the key again;
 *  - removing a respin mode re-routes its pots (free spins) and saves;
 *  - (control) the same save with the stale legacy keys left on the body loses the edit — which is
 *    what `openDoc` prevents: the page never holds the pair, so `bodyFor` never sends it.
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import {
	HOLD_AND_WIN_PRESETS,
	addPotsOverlay,
	addRespinMode,
	holdAndWinMockInputs,
	joinHoldAndWin,
	normalizeGameConfigDoc,
	potsOverlayOf,
	primaryHoldAndWin,
	primaryRespinMode,
	removeRespinMode,
	triggerHalfFor,
	undealtRouteWarnings,
	type AddOnResult,
	type GameConfigDoc,
	type LegacyBonusKeys,
	type RawGameConfig,
} from 'game-config';

const bucket = new Map<string, { text: string; etag: string }>();
class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
	}
}
const etagOf = (text: string) => `"${createHash('md5').update(text).digest('hex')}"`;

const server = (path: string) => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (base: string | null | undefined) =>
			base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.text.length, lastModified: 0 } : null;
		},
		copyObject: async (from: string, to: string) => {
			const o = bucket.get(from);
			if (!o) return false;
			bucket.set(to, { ...o });
			return true;
		},
		putObjectText: async (
			key: string,
			text: string,
			_type: string,
			cond?: { ifMatch?: string; ifNoneMatch?: string },
		) => {
			const cur = bucket.get(key);
			if (cond?.ifNoneMatch === '*' && cur) throw new ConflictError(key);
			if (cond?.ifMatch !== undefined && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
			const etag = etagOf(text);
			bucket.set(key, { text, etag });
			return etag;
		},
		getObjectText: async (key: string) => bucket.get(key)?.text ?? null,
		getObjectTextWithEtag: async (key: string) => bucket.get(key) ?? null,
		listAllObjects: async (prefix: string) =>
			[...bucket]
				.filter(([key]) => key.startsWith(prefix))
				.map(([key, o]) => ({ key, size: o.text.length, lastModified: 0 })),
		deleteObjects: async (keys: string[]) => {
			for (const key of keys) bucket.delete(key);
		},
		listAllKeys: async (prefix: string) => [...bucket.keys()].filter((k) => k.startsWith(prefix)),
		listObjects: async () => ({ keys: [], prefixes: [] }),
		objectExists: async (key: string) => bucket.has(key),
	},
});

const { loadGameConfigDocWithEtag, saveGameConfigDoc } =
	await import('../src/lib/server/gameConfigStorage.ts');
const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
const { adoptSaved, bodyFor, openDoc, setRespinPlay } =
	await import('../src/routes/(app)/config/pageDoc.ts');

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
	}
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const withoutStamp = (doc: GameConfigDoc) => {
	const { updatedAt: _stamp, ...rest } = doc;
	return rest;
};
const docOf = (result: AddOnResult): GameConfigDoc => {
	if (!result.ok) throw new Error(result.reason);
	return result.doc;
};
const legacyKeys = (doc: object) => ['holdAndWin', 'potsOverlay'].filter((k) => k in doc);

const CLIENT = 'iw';

/** What `/config` does: open the stored doc in the split form. */
async function open(project: string) {
	const { doc, etag } = await loadGameConfigDocWithEtag(CLIENT, project);
	if (!doc) throw new Error(`${project}: nothing stored`);
	return { live: openDoc(doc), etag };
}
/** Save (the PUT body is the live doc, whole) and re-open what the save returned. */
async function saveAndReload(project: string, live: GameConfigDoc, etag: string | null) {
	const body = bodyFor(clone(live));
	check(`${project}: the page sends no legacy key`, legacyKeys(body), []);
	const saved = await saveGameConfigDoc(CLIENT, project, body, etag);
	return { saved, reopened: adoptSaved(saved.doc) };
}
const storedJson = (project: string): Record<string, unknown> =>
	JSON.parse(bucket.get(gameConfigDocKey(CLIENT, project))!.text);
const seed = (project: string, raw: unknown) => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error(`${project}: did not normalize`);
	const text = JSON.stringify(doc, null, 2);
	bucket.set(gameConfigDocKey(CLIENT, project), { text, etag: etagOf(text) });
	return doc;
};

console.log('\n1. the samples open, save and reload with no diff to their stored docs');
const STRIP = ['PIC1', 'ACE', 'SCAT', 'KING', 'TEN'].map((name) => ({ name }));
const pays = { paytable: [{ '3': 5 }, { '4': 50 }, { '5': 150 }] };
const LINES: RawGameConfig = {
	providerName: 'invisible_wall',
	gameName: 'lines_host',
	gameID: 'lines_host',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { '1': [1, 1, 1, 1, 1], '2': [0, 0, 0, 0, 0], '3': [2, 2, 2, 2, 2] },
	symbols: {
		PIC1: pays,
		ACE: pays,
		KING: pays,
		TEN: pays,
		SCAT: { special_properties: ['scatter'] },
	},
	paddingReels: {
		basegame: Array.from({ length: 5 }, () => STRIP),
		freegame: Array.from({ length: 5 }, () => STRIP),
	},
};
const lines = normalizeGameConfigDoc(LINES)!;
/** As the sample was stored: the legacy pair, green re-routed to free spins, no coin overlay. */
const borutRaw: RawGameConfig = (() => {
	const { coinOverlay, ...doc } = clone(docOf(addPotsOverlay(lines, 'threePots')));
	const pots = potsOverlayOf({ coinOverlay })!;
	return {
		...doc,
		holdAndWin: primaryHoldAndWin({ coinOverlay, modes: doc.modes }),
		potsOverlay: {
			...pots,
			pots: pots.pots.map((p) => (p.id === 'green' ? { ...p, bonus: { mode: 'freeSpins' } } : p)),
		},
	};
})();
/** `doc` with the legacy pair it implies spread on, as a doc stored before Phase 7b carried it. */
const withLegacyKeys = (doc: GameConfigDoc): RawGameConfig => ({
	...clone(doc),
	holdAndWin: primaryHoldAndWin(doc),
	potsOverlay: potsOverlayOf(doc),
});
const samples: Record<string, unknown> = {
	'hw-3pots-sample': HOLD_AND_WIN_PRESETS.pots,
	'hw-classic-sample': HOLD_AND_WIN_PRESETS.classic,
	'hw-collector-sample': HOLD_AND_WIN_PRESETS.collector,
	'borut-pots-sample': borutRaw,
};
for (const [project, raw] of Object.entries(samples)) {
	const before = seed(project, raw);
	const { live, etag } = await open(project);
	check(`${project}: the page holds no legacy key`, legacyKeys(live), []);
	const { saved } = await saveAndReload(project, live, etag);
	check(`${project}: the stored doc is unchanged`, withoutStamp(saved.doc), before);
	// Bonus-games Phase 7a shows the base-game coin values panel again; it writes nothing until edited.
	check(
		`${project}: no base-game coin values are written unless authored`,
		[live.coinOverlay?.coins ?? null, saved.doc.coinOverlay?.coins ?? null],
		[null, null],
	);
	const json = storedJson(project) as unknown as GameConfigDoc;
	check(`${project}: the stored JSON carries no legacy key`, legacyKeys(json), []);
	check(
		`${project}: the stored JSON's block views are the ones the runtime reads`,
		[primaryHoldAndWin(json) ?? null, potsOverlayOf(json) ?? null],
		[primaryHoldAndWin(before) ?? null, potsOverlayOf(before) ?? null],
	);

	// The same doc still stored in the legacy shape: opened migrated, saved without the pair.
	const legacyProject = `${project}-legacy`;
	const text = JSON.stringify(withLegacyKeys(before), null, 2);
	bucket.set(gameConfigDocKey(CLIENT, legacyProject), { text, etag: etagOf(text) });
	const legacy = await open(legacyProject);
	check(`${legacyProject}: the page holds no legacy key`, legacyKeys(legacy.live), []);
	const resaved = (await saveAndReload(legacyProject, legacy.live, legacy.etag)).saved;
	check(`${legacyProject}: saved as the normalized doc`, withoutStamp(resaved.doc), before);
	check(`${legacyProject}: stored without the pair`, legacyKeys(storedJson(legacyProject)), []);
}

console.log('\n2. a lines project: a coin overlay and two respin modes, pot A → 1 and pot B → 2');
{
	const project = 'two-bonuses';
	seed(project, LINES);
	let { live, etag } = await open(project);
	live = openDoc(docOf(addPotsOverlay(live, 'threePots')));
	live = docOf(addRespinMode(live, 'holdAndWin_2', 'collector'));
	check(
		'two respin modes with different presets',
		live.modes?.filter((m) => m.board === 'respinBoard').map((m) => m.label),
		['Hold and Win', 'Hold and Win — Collector streak (Super Hotfire Diamonds)'],
	);
	live.coinOverlay!.pots!.find((p) => p.id === 'red')!.bonus = { mode: 'holdAndWin' };
	live.coinOverlay!.pots!.find((p) => p.id === 'blue')!.bonus = { mode: 'holdAndWin_2' };
	let saved;
	({ saved, reopened: live } = await saveAndReload(project, live, etag));
	etag = saved.etag;
	check(
		'pot B → mode 2 saves with no warning: the game plays every respin mode (bonus-games Phase 4)',
		saved.warnings
			.filter((w) => w.path.startsWith('coinOverlay.'))
			.map((w) => `${w.severity} ${w.path}`),
		[],
	);
	check(
		'pot A → mode 1 and pot B → mode 2 are intact after a reload',
		live.coinOverlay?.pots?.map((p) => [p.id, p.bonus.mode]),
		[
			['red', 'holdAndWin'],
			['blue', 'holdAndWin_2'],
			['green', 'holdAndWin'],
		],
	);

	const first = live.modes!.find((m) => m.id === 'holdAndWin')!;
	first.holdAndWin!.respins.start = 4;
	// The control: the edited doc with the stale legacy keys still on it, as a page that held the
	// pair (one that skipped `openDoc`'s migration) would send it, saved to a copy of the project.
	const stale: GameConfigDoc & LegacyBonusKeys = {
		...clone(live),
		holdAndWin: primaryHoldAndWin(saved.doc),
		potsOverlay: potsOverlayOf(saved.doc),
	};
	const unshaped = await saveGameConfigDoc(CLIENT, `${project}-control`, clone(stale), null);
	check(
		'(control) saved with the stale legacy keys, the edit to mode 1 is lost',
		unshaped.doc.modes?.find((m) => m.id === 'holdAndWin')?.holdAndWin?.respins.start,
		saved.doc.modes?.find((m) => m.id === 'holdAndWin')?.holdAndWin?.respins.start,
	);
	check('...and openDoc takes them off', legacyKeys(openDoc(clone(stale))), []);
	check('...so bodyFor sends none', legacyKeys(bodyFor(clone(live))), []);
	const second = live.modes!.find((m) => m.id === 'holdAndWin_2')!;
	second.holdAndWin!.respins.start = 5;
	second.holdAndWin!.jackpots[0].multiplier = 77;
	const before = clone(saved.doc);
	({ saved, reopened: live } = await saveAndReload(project, live, etag));
	const rules = live.modes!.find((m) => m.id === 'holdAndWin_2')!.holdAndWin!;
	check(
		'an edit to the SECOND respin mode survives a save and a reload',
		[rules.respins.start, rules.jackpots[0].multiplier],
		[5, 77],
	);
	check(
		'...and one to the first',
		live.modes!.find((m) => m.id === 'holdAndWin')!.holdAndWin!.respins.start,
		4,
	);

	const json = storedJson(project) as unknown as GameConfigDoc;
	const primary = primaryRespinMode(saved.doc.modes)!;
	check('the primary is mode 1', primary.id, 'holdAndWin');
	check('the stored JSON carries no legacy key', legacyKeys(json), []);
	check(
		"the stored primary block is mode 1's rules with the routes that start it",
		primaryHoldAndWin(json),
		joinHoldAndWin(primary.holdAndWin, triggerHalfFor(saved.doc.coinOverlay, primary.id)),
	);
	const beforeBlock = primaryHoldAndWin(before)!;
	check("...with mode 1's edit, and only that", primaryHoldAndWin(json), {
		...beforeBlock,
		respins: { ...beforeBlock.respins, start: 4 },
	});
	check(
		'the stored pots route A to mode 1 and B to mode 2',
		potsOverlayOf(json)?.pots.map((p) => [p.id, p.bonus.mode]),
		[
			['red', 'holdAndWin'],
			['blue', 'holdAndWin_2'],
			['green', 'holdAndWin'],
		],
	);
	check(
		"the Hold and Win mock reads mode 1's rules from the stored JSON",
		holdAndWinMockInputs(json)?.block,
		primaryHoldAndWin(json),
	);

	console.log('\n2b. Play: Automatic / Manual (bonus-games Phase 4)');
	const storedBlock = () => primaryHoldAndWin(storedJson(project) as unknown as GameConfigDoc);
	const playOf = (doc: GameConfigDoc, id: string) => {
		const rules = doc.modes?.find((m) => m.id === id)?.holdAndWin;
		return rules && ('play' in rules ? rules.play : 'absent');
	};
	setRespinPlay(live.modes!.find((m) => m.id === 'holdAndWin_2')!.holdAndWin!, 'manual');
	({ saved, reopened: live } = await saveAndReload(project, live, saved.etag));
	check(
		'Manual on mode 2 is stored on mode 2 only, and survives a reload',
		[playOf(live, 'holdAndWin_2'), playOf(live, 'holdAndWin'), 'play' in storedBlock()!],
		['manual', 'absent', false],
	);
	setRespinPlay(live.modes!.find((m) => m.id === 'holdAndWin')!.holdAndWin!, 'manual');
	({ saved, reopened: live } = await saveAndReload(project, live, saved.etag));
	check(
		"Manual on mode 1 reaches the stored primary block (the mock's and the runtime's read)",
		[playOf(live, 'holdAndWin'), storedBlock()?.play],
		['manual', 'manual'],
	);
	for (const id of ['holdAndWin', 'holdAndWin_2'])
		setRespinPlay(live.modes!.find((m) => m.id === id)!.holdAndWin!, 'auto');
	({ saved, reopened: live } = await saveAndReload(project, live, saved.etag));
	check(
		'Automatic writes nothing: the key is gone again, as a project that never chose',
		[playOf(live, 'holdAndWin'), playOf(live, 'holdAndWin_2'), 'play' in (storedBlock() ?? {})],
		['absent', 'absent', false],
	);

	console.log('\n3. removing mode 1 re-routes its pots and saves');
	const removal = removeRespinMode(live, 'holdAndWin');
	live = docOf(removal);
	check(
		'...and asks for no rename: mode 2 plays under its own id',
		removal.ok && !removal.notes?.some((n) => n.includes('rename it to')),
		true,
	);
	({ saved, reopened: live } = await saveAndReload(project, live, saved.etag));
	check(
		'...it saves with no warning on blue',
		saved.warnings
			.filter((w) => w.path.startsWith('coinOverlay.'))
			.map((w) => `${w.severity} ${w.path}`),
		[],
	);
	check(
		'red and green start free spins; blue still starts mode 2, now the primary one',
		[
			live.coinOverlay?.pots?.map((p) => [p.id, p.bonus.mode]),
			primaryRespinMode(saved.doc.modes)?.id,
		],
		[
			[
				['red', 'freeSpins'],
				['blue', 'holdAndWin_2'],
				['green', 'freeSpins'],
			],
			'holdAndWin_2',
		],
	);
}

console.log(
	'\n4. a route the game does not deal warns (bonus-games Phase 6, `undealtRouteWarnings`)',
);
{
	const two = docOf(
		addRespinMode(
			normalizeGameConfigDoc(docOf(addPotsOverlay(lines, 'threePots')))!,
			'holdAndWin_2',
			'classic',
		),
	);
	const routed = clone(two);
	routed.coinOverlay = {
		...routed.coinOverlay!,
		trigger: {
			...routed.coinOverlay!.trigger,
			buy: [{ betMode: 'base', mode: 'holdAndWin_2', guaranteed: [], boostedSpecials: false }],
		},
		pots: routed.coinOverlay!.pots!.map((p) =>
			p.id === 'green' ? { ...p, bonus: { mode: 'holdAndWin_2' } } : p,
		),
	};
	const doc = normalizeGameConfigDoc(routed)!;
	// Bonus-games Phase 7a: the deal is decided by the doc, and the coin overlay over a lines game
	// deals a buy, so the route that warned in Phase 6 no longer does.
	check(
		'on a lines game neither the buy to holdAndWin_2 nor the pot warns (Phase 7a)',
		undealtRouteWarnings(doc, 'lines'),
		[],
	);
	check('on the Hold and Win kind nothing warns', undealtRouteWarnings(doc, 'holdAndWin'), []);
	check(
		'on a Book-of game, whose mock sells no authored bet mode, only the buy warns',
		undealtRouteWarnings(doc, 'bookOf').map((w) => `${w.severity} ${w.path}`),
		['warning coinOverlay.trigger.buy.0.mode'],
	);
	const metered = clone(routed);
	metered.coinOverlay = {
		...metered.coinOverlay!,
		meters: [
			{
				id: 'gems',
				symbol: 'BONUS',
				maxLevel: 10,
				activates: 'collector',
				sizeStages: [],
				mode: 'holdAndWin_2',
			},
		],
	} as typeof metered.coinOverlay;
	check(
		'a symbol-filled meter still warns where the overlay deals the game: a landing symbol fills it',
		undealtRouteWarnings(normalizeGameConfigDoc(metered)!, 'lines').map((w) => w.path),
		['coinOverlay.meters.0.mode'],
	);
	check(
		'it never blocks a save: no error among the issues',
		undealtRouteWarnings(doc, 'bookOf').filter((w) => w.severity === 'error'),
		[],
	);
	check(
		'every sample warns nothing for its kind',
		Object.entries(samples).flatMap(([project, raw]) =>
			undealtRouteWarnings(
				normalizeGameConfigDoc(raw)!,
				project.startsWith('hw-') ? 'holdAndWin' : 'bookOf',
			).map((w) => `${project} ${w.path}`),
		),
		[],
	);
}

console.log(
	failures === 0 ? '\nAll /config bonus-modes assertions passed.\n' : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
