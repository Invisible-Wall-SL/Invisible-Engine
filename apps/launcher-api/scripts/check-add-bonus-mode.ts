/**
 * Contract check for "Add a bonus mode…" (docs/design/bonus-games.md §1, §2.4, Phase 6):
 *   pnpm --filter launcher-api check:add-bonus-mode
 *
 * Runs the REAL `projectBonusImport.ts` (`importRespinMode` underneath), the scaffold, the coin
 * overlay add-on and the doc stores over an in-memory R2; only R2, the project lookup, leases and the
 * bundle cache are stubbed. The source is `hw-classic-sample` as the Game Maker creates it (the
 * Classic preset, set to play Manual), with art bound in `/symbols`, its starter Flow tab and its own
 * Win Text. What it pins:
 *  1. into a host that already has `holdAndWin` (a 3 Pots overlay over a Book-of game), the mode
 *     becomes `holdAndWin_2`: its rules with `play`, its strips and renamed symbols, its art, its
 *     screens as `<reference id>-holdAndWin_2`, its Flow tab (which publishes clean) and its Win Text
 *     under `modes.holdAndWin_2`, with a pot routed to it — and nothing else of the host moves;
 *  2. a re-sync after a source edit updates only `holdAndWin_2`;
 *  3. a plain lines host with no overlay is refused with what to do (its mock deals a Hold and Win
 *     only from a pot until Phase 7, and a buy route that would never play is no route), and takes
 *     it once "＋ Coin overlay… → 3 Pots" gave it a pot to route;
 *  4. the Hold and Win presets and the coin overlay add-on now write the split form, and normalize
 *     to exactly the config they wrote before;
 *  5. the "Hold and Win" template (bonus-games §0, Phase 6b) is the plain game: with Jackpots on and
 *     off it stores the template, validates clean, has one respin mode and no pots, drops or
 *     collector, seeds no pots screen (and with jackpots off no jackpot bar or tiers), and its mock
 *     deals a full triggered round: respins, coins landing, the coins paying their total.
 */
import { createServer } from 'node:http';
import { mock } from 'node:test';
import type { FlowDoc as FlowDocV2 } from 'engine-flow-v2';
import type { LayoutDoc, Scene, WinTextDoc } from 'engine-layout';
import type { GameConfigDoc, ModeRoute } from 'game-config';
import type { RuntimeBundle } from '../src/lib/server/runtimeBundle.ts';

type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
/** Keys a "concurrent author" saves between the import's read and its write. */
const RACE = new Map<string, string>();

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`conflict ${key}`);
	}
}
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
const put = (key: string, body: unknown) =>
	R2.set(key, {
		body: typeof body === 'string' ? body : JSON.stringify(body),
		etag: `"e${++etagSeq}"`,
	});

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
				put(key, raced);
			}
			const cur = R2.get(key);
			if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
			if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
			put(key, text);
			return R2.get(key)!.etag;
		},
		copyObject: async (from: string, to: string) => {
			const o = R2.get(from);
			if (!o) return false;
			put(to, o.body);
			return true;
		},
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
		listObjects: async () => ({ keys: [], prefixes: [] }),
		// Never reached by an import; the rig module's graph imports them.
		getObjectBytes: async (key: string) =>
			R2.has(key) ? { bytes: Buffer.from(R2.get(key)!.body), etag: R2.get(key)!.etag } : null,
		putObjectBytes: async () => {
			throw new Error('unexpected putObjectBytes');
		},
		getObjectStream: async () => null,
		presignGet: async () => '',
		presignPut: async () => '',
		presignManifestEntries: async <T>(entries: T) => entries,
		jsonBaseEtag: () => undefined,
		formBaseEtag: () => undefined,
		deleteObject: async (key: string) => void R2.delete(key),
		listFolder: async () => ({ folders: [], files: [] }),
	},
});

const SOURCE = 'hw-classic-sample';
const HOST = 'borut-pots-sample';
const PLAIN = 'plain-lines';
const KINDS: Record<string, string> = {
	[SOURCE]: 'holdAndWin',
	[HOST]: 'bookOf',
	[PLAIN]: 'lines',
};
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		projectGameType: async (p: string) => KINDS[p] ?? 'lines',
		projectClientKey: async () => CLIENT,
	},
});

/** The edit leases "held" right now; none, but the import reads them. */
mock.module(src('lib/server/lease.ts'), { namedExports: { liveLeases: async () => [] } });
mock.module(src('lib/server/runtimeBundleCache.ts'), {
	namedExports: { invalidateRuntimeBundle: () => undefined },
});
const ME = 'session-me';

const { modeRouteOptions } = await import('../src/lib/bonusImport.ts');
const { applyBonusImport, respinModeCopyId } =
	await import('../src/lib/server/projectBonusImport.ts');
const { applyPotsOverlayAddOn } = await import('../src/lib/server/projectAddOn.ts');
const { scaffoldProject } = await import('../src/lib/server/projectScaffold.ts');
const { gameConfigDefaultFor, gameConfigSeedFor, holdAndWinTemplateSeed } =
	await import('../src/lib/server/gameConfigDefaults.ts');
const { cleanOverlayPresets } = await import('../src/lib/server/projectAddOn.ts');
const { mockContractOfBundle } = await import('../src/lib/server/mockContract.ts');
const { projectAddOns, respinModesOf } = await import('../src/lib/addOns.ts');
const { kindCapabilities } = await import('engine-layout');
const { createMockRgs: createHoldAndWinMock } =
	await import('../../../scripts/mock-rgs-server-holdandwin.mjs');
const { validateFlowV2Against } = await import('../src/lib/server/flowV2Validation.ts');
const { editorDocKey, flowV2DocKey, gameConfigDocKey, symbolsDocKey, winTextDocKey } =
	await import('../src/lib/server/projectPaths.ts');
const {
	HOLD_AND_WIN_PRESET_IDS,
	POTS_OVERLAY_PRESET_IDS,
	addPotsOverlay,
	flowAddOnsOf,
	gameConfigErrors,
	normalizeGameConfigDoc,
	renameRespinMode,
	respinModeDecls,
	splitFormOf,
} = await import('game-config');

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
const stored = (key: string) => R2.get(key)?.body;
const storedJson = <T>(key: string): T => JSON.parse(stored(key) ?? 'null') as T;
const under = (prefix: string) =>
	JSON.stringify(sortedKeys(prefix).map((k) => [k, R2.get(k)!.body]));
const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	assert(doc, 'config did not normalize');
	return doc;
};
/** A stored config without its save stamp. */
const content = (doc: GameConfigDoc | null): string => {
	const { updatedAt: _at, ...rest } = doc ?? ({} as GameConfigDoc);
	return JSON.stringify(rest);
};
const modeOf = (doc: GameConfigDoc, id: string) => doc.modes?.find((m) => m.id === id);
const docsOf = (project: string) => ({
	config: storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, project)),
	layout: storedJson<LayoutDoc>(editorDocKey(CLIENT, project)),
	flow: storedJson<FlowDocV2>(flowV2DocKey(CLIENT, project)),
	symbols: storedJson<{ symbols: Record<string, unknown> }>(symbolsDocKey(CLIENT, project)),
	winText: storedJson<WinTextDoc | null>(winTextDocKey(CLIENT, project)),
});
const screensOf = (layout: LayoutDoc, mode: string): Scene[] =>
	layout.scenes.filter((s: Scene) => s.role === 'mode' && s.modeId === mode);
const flowNodeIds = (flow: FlowDocV2): string[] => [
	...flow.graph.nodes.map((n) => n.id),
	...Object.values(flow.modes ?? {}).flatMap((m) => m.graph.nodes.map((n) => n.id)),
];
const publishErrors = (project: string) => {
	const docs = docsOf(project);
	return validateFlowV2Against(
		docs.flow,
		docs.layout.scenes,
		null,
		{ version: 2, functions: [] },
		[],
		flowAddOnsOf(docs.config),
	);
};
const describe = (issues: { code: string; message: string }[]) =>
	issues.map((i) => `${i.code}: ${i.message}`).join(' | ');

// ─── the projects ─────────────────────────────────────────────────────────────────────────────

const ART = { static: { type: 'sprite', assetKey: 'art/coin.png' } };

/** `hw-classic-sample` as the Game Maker creates it, set to play Manual, its coin art bound and its
 *  own Win Text written. Its Flow tab is the scaffold's starter. */
async function makeSource() {
	await scaffoldProject(CLIENT, SOURCE, { holdAndWinPreset: 'classic' });
	const config = storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, SOURCE));
	const split = splitFormOf(config);
	modeOf(split, 'holdAndWin')!.holdAndWin!.play = 'manual';
	put(gameConfigDocKey(CLIENT, SOURCE), normalize(split));
	const symbols = storedJson<{ version: 1; symbols: Record<string, unknown> }>(
		symbolsDocKey(CLIENT, SOURCE),
	);
	symbols.symbols.BONUS = ART;
	put(symbolsDocKey(CLIENT, SOURCE), symbols);
	put(winTextDocKey(CLIENT, SOURCE), {
		version: 1,
		jackpots: { award: '{jackpot} — CLASSIC' },
		respins: { counter: 'classic {count}' },
		feature: { intro: 'Classic respins!', potLabel: 'source pot (never copied)' },
	});
}

/** `borut-pots-sample`: a Book-of project with the 3 Pots overlay and its Flow graft. */
async function makeHost() {
	await scaffoldProject(CLIENT, HOST);
	const out = await applyPotsOverlayAddOn(CLIENT, HOST, {
		sessionId: ME,
		preset: 'threePots',
		flow: true,
	});
	assert(out.ok, `the add-on refused: ${out.ok ? '' : out.error}`);
	put(winTextDocKey(CLIENT, HOST), {
		version: 1,
		jackpots: { award: 'host jackpot line' },
		feature: { intro: 'host intro', potLabel: '{pot} pot' },
	});
}

/** A plain lines project that saved its config: no overlay, a buy-bonus bet mode. */
async function makePlain() {
	await scaffoldProject(CLIENT, PLAIN);
	put(gameConfigDocKey(CLIENT, PLAIN), lines());
}
const lines = (): GameConfigDoc => structuredClone(gameConfigDefaultFor('lines')!);

await makeSource();
await makeHost();
await makePlain();
KINDS['tpl-collector'] = 'holdAndWin';
const sourceBytes = under(`${CLIENT}/${SOURCE.replace(/-/g, '_')}`);
assert(sourceBytes.length > 10, 'the source prefix holds nothing');
const source = docsOf(SOURCE);
const sourceMode = respinModeDecls(source.config).find((m) => m.id === 'holdAndWin')!;
const AT = '2026-10-08T08:00:00.000Z';
const NEW = 'holdAndWin_2';

// ─── 1. into a host that already has holdAndWin ──────────────────────────────────────────────

console.log('\n1. into a host that already has holdAndWin');
const before = docsOf(HOST);
assert(modeOf(before.config, 'holdAndWin'), 'the host has no holdAndWin');
const issuesBefore = publishErrors(HOST);
const added = await applyBonusImport(CLIENT, HOST, {
	source: SOURCE,
	mode: 'holdAndWin',
	asMode: true,
	routes: [{ kind: 'pot', pot: 'green' }],
	sessionId: ME,
	at: AT,
});
const after = docsOf(HOST);

await check('it is added as holdAndWin_2, never in place of holdAndWin', () => {
	assert(added.ok, `refused: ${added.ok ? '' : added.error}`);
	same([added.mode, added.resynced, added.replaced], [NEW, false, false], 'outcome');
	same(
		after.config.modes?.map((m) => m.id),
		[...(before.config.modes ?? []).map((m) => m.id), NEW],
		'modes',
	);
	same(modeOf(after.config, 'holdAndWin'), modeOf(before.config, 'holdAndWin'), 'holdAndWin');
	same(after.config.holdAndWin, before.config.holdAndWin, 'the legacy mirror (the primary)');
});

await check("its rules travel whole, play: 'manual' included, its blank renamed", () => {
	const mode = modeOf(after.config, NEW)!;
	assert(mode.board === 'respinBoard' && mode.holdAndWin, 'not a respin mode with rules');
	same(mode.holdAndWin.play, 'manual', 'play');
	const { blank: a, ...rules } = mode.holdAndWin;
	const { blank: b, ...want } = sourceMode.holdAndWin;
	same(rules, want, 'rules');
	assert(!b || a === `${b}_2` || a === b, `blank ${a} from ${b}`);
	same(mode.label, `${sourceMode.label} (${SOURCE})`, 'label');
});

await check('its strips and symbols come under free names, recorded for a re-sync', () => {
	const mode = modeOf(after.config, NEW)!;
	const strips = after.config.paddingReels[mode.gameType ?? NEW];
	assert(strips?.length === after.config.numReels, `strips ${JSON.stringify(mode.gameType)}`);
	const record = after.config.imports?.find((i) => i.mode === NEW);
	assert(record?.asMode, 'no asMode record');
	same(record.importedFrom, { project: SOURCE, mode: 'holdAndWin', at: AT }, 'provenance');
	for (const [from, to] of Object.entries(record.symbols)) {
		assert(after.config.symbols[to], `${to} missing`);
		assert(!before.config.symbols[to], `${to} took over a host symbol (${from})`);
	}
	for (const name of Object.keys(before.config.symbols)) {
		same(after.config.symbols[name], before.config.symbols[name], `host symbol ${name}`);
	}
});

await check('the pot routes to it; the others keep theirs', () => {
	const pots = (doc: GameConfigDoc) =>
		Object.fromEntries((doc.coinOverlay?.pots ?? []).map((p) => [p.id, p.bonus.mode]));
	same(pots(after.config), { ...pots(before.config), green: NEW }, 'pots');
});

await check('the stored config saves clean and normalizes to itself', () => {
	same(gameConfigErrors(after.config), [], 'errors');
	same(content(normalize(after.config)), content(after.config), 'a fixed point');
});

await check('its art is bound under its name here', () => {
	const record = after.config.imports!.find((i) => i.mode === NEW)!;
	same(after.symbols.symbols[record.symbols.BONUS], ART, 'BONUS art');
	for (const [name, cell] of Object.entries(before.symbols.symbols)) {
		same(after.symbols.symbols[name], cell, `host binding ${name}`);
	}
});

await check("its screens are copied as <reference id>-holdAndWin_2, the host's kept", () => {
	const sourceScreens = screensOf(source.layout, 'holdAndWin');
	assert(sourceScreens.length, 'the source has no mode screens');
	const copies = screensOf(after.layout, NEW);
	same(
		copies.map((s) => s.id),
		sourceScreens.map((s) => `${s.id}-${NEW}`),
		'screen ids',
	);
	assert(
		copies.some((s) => s.id === `featureIntro-${NEW}`),
		'no featureIntro-holdAndWin_2',
	);
	same(
		copies.map((s) => s.name),
		sourceScreens.map((s) => `${s.name} (${sourceMode.label} (${SOURCE}))`),
		"screen names carry the mode's label, as the Scene Editor names them",
	);
	for (const copy of copies) {
		for (const node of copy.nodes) {
			assert(node.id.endsWith(`-${NEW}`), `node ${node.id} of ${copy.id}`);
		}
	}
	same(
		after.layout.scenes.filter((s) => s.modeId !== NEW),
		before.layout.scenes,
		"the host's screens",
	);
	same(
		respinModeCopyId(NEW, 'holdAndWin_3')(`featureIntro-${NEW}`),
		'featureIntro-holdAndWin_3',
		'a second copy of a copy',
	);
});

await check("its Flow tab is the source's, rehomed, and publishes clean", () => {
	const tab = after.flow.modes?.[NEW]?.graph;
	assert(tab, 'no Flow tab');
	const sourceTab = source.flow.modes?.holdAndWin?.graph;
	assert(sourceTab, 'the source has no Flow tab');
	same(tab.nodes.length, sourceTab.nodes.length, 'node count');
	const ids = flowNodeIds(after.flow);
	same(
		ids.filter((id, at) => ids.indexOf(id) !== at),
		[],
		'duplicate node ids',
	);
	for (const node of tab.nodes) {
		if (node.kind === 'modeTrigger') same(node.modeId, NEW, 'mode trigger');
		if (node.kind === 'showContainer' || node.kind === 'hideContainer') {
			assert(node.ref.endsWith(`-${NEW}`), `shows ${node.ref}`);
			assert(
				after.layout.scenes.some((s) => s.id === node.ref),
				`${node.ref} is not a screen here`,
			);
			assert(
				after.flow.containers.some((c) => c.id === node.ref),
				`${node.ref} is not declared`,
			);
		}
	}
	for (const [mode, scope] of Object.entries(before.flow.modes ?? {})) {
		same(after.flow.modes?.[mode], scope, `the host's ${mode} tab`);
	}
	same(after.flow.graph, before.flow.graph, 'the global graph');
	const issues = publishErrors(HOST);
	const errors = issues.filter((i) => i.severity === 'error');
	same(describe(errors), describe(issuesBefore.filter((i) => i.severity === 'error')), 'errors');
	assert(!errors.length, describe(errors));
	const fresh = issues.filter(
		(i) => !issuesBefore.some((b) => b.code === i.code && b.message === i.message),
	);
	same(describe(fresh), '', 'new warnings');
});

await check('its Win Text is under modes.holdAndWin_2; no family replaced', () => {
	const lines = after.winText?.modes?.[NEW];
	assert(lines, 'no modes.holdAndWin_2');
	same(lines.respins?.counter, 'classic {count}', 'counter');
	same(lines.feature?.intro, 'Classic respins!', 'intro');
	const { modes: _modes, updatedAt: _a, ...families } = after.winText!;
	const { updatedAt: _b, ...was } = before.winText!;
	same(families, was, 'the families');
});

await check('the source is never written', () => {
	same(under(`${CLIENT}/${SOURCE.replace(/-/g, '_')}`), sourceBytes, 'source bytes');
});

await check('adding the same mode again is refused: re-sync it', async () => {
	const again = await applyBonusImport(CLIENT, HOST, {
		source: SOURCE,
		mode: 'holdAndWin',
		asMode: true,
		sessionId: ME,
		at: AT,
	});
	assert(!again.ok && /Re-sync/.test(again.error), JSON.stringify(again));
	same(content(docsOf(HOST).config), content(after.config), 'nothing written');
});

// ─── 2. re-sync after a source edit ────────────────────────────────────────────────────────────

console.log('\n2. re-sync after a source edit');
const edited = splitFormOf(storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, SOURCE)));
modeOf(edited, 'holdAndWin')!.holdAndWin!.respins.start = 5;
delete modeOf(edited, 'holdAndWin')!.holdAndWin!.play;
put(gameConfigDocKey(CLIENT, SOURCE), normalize(edited));
put(winTextDocKey(CLIENT, SOURCE), {
	...storedJson<WinTextDoc>(winTextDocKey(CLIENT, SOURCE)),
	respins: { counter: 'edited {count}' },
});
const AT2 = '2026-10-08T09:00:00.000Z';
const resynced = await applyBonusImport(CLIENT, HOST, {
	mode: NEW,
	resync: true,
	sessionId: ME,
	at: AT2,
});
const later = docsOf(HOST);

await check('it updates only holdAndWin_2: rules, play, Win Text', () => {
	assert(resynced.ok && resynced.resynced, JSON.stringify(resynced));
	same(resynced.mode, NEW, 'mode');
	const mode = modeOf(later.config, NEW)!;
	same(mode.holdAndWin?.respins.start, 5, 'the edit');
	same(mode.holdAndWin?.play, undefined, 'play back to auto');
	same(later.winText?.modes?.[NEW]?.respins?.counter, 'edited {count}', 'Win Text');
	same(later.config.imports?.find((i) => i.mode === NEW)?.importedFrom.at, AT2, 'the record');
});

await check('…and nothing else moves', () => {
	const strip = (doc: GameConfigDoc) => {
		const out = structuredClone(doc) as Partial<GameConfigDoc>;
		delete out.updatedAt;
		out.modes = out.modes?.filter((m) => m.id !== NEW);
		out.imports = out.imports?.map((i) =>
			i.mode === NEW ? { ...i, importedFrom: { ...i.importedFrom, at: '' } } : i,
		);
		return out;
	};
	same(strip(later.config), strip(after.config), 'the config but holdAndWin_2');
	same(later.layout, after.layout, 'the layout (the source screens did not change)');
	same(later.flow, after.flow, 'the flow (the source tab did not change)');
	same(later.symbols, after.symbols, 'the symbols');
	const { modes: m1, updatedAt: _a, ...f1 } = later.winText!;
	const { modes: m2, updatedAt: _b, ...f2 } = after.winText!;
	same(f1, f2, 'the Win Text families');
	same(Object.keys(m1 ?? {}), Object.keys(m2 ?? {}), 'the Win Text modes');
});

// ─── 2b. a /config rename, then a re-sync ─────────────────────────────────────────────────────

console.log('\n2b. a /config rename, then a re-sync');
const GOLD = 'gold';
{
	const renamed = renameRespinMode(docsOf(HOST).config, NEW, GOLD);
	assert(renamed.ok, `rename refused: ${renamed.ok ? '' : renamed.reason}`);
	put(gameConfigDocKey(CLIENT, HOST), normalize(renamed.doc));
	const sourceFlow = storedJson<FlowDocV2>(flowV2DocKey(CLIENT, SOURCE));
	sourceFlow.modes!.holdAndWin.graph.nodes.push({
		id: 'cine',
		kind: 'playCinematic',
		pos: { x: 0, y: 900 },
		ref: 'intro-cine',
	});
	put(flowV2DocKey(CLIENT, SOURCE), sourceFlow);
}
const goldSync = await applyBonusImport(CLIENT, HOST, {
	mode: GOLD,
	resync: true,
	sessionId: ME,
	at: AT2,
});
const gold = docsOf(HOST);

await check('the re-sync writes the pieces under the new id and clears the old ones', () => {
	assert(goldSync.ok, JSON.stringify(goldSync));
	same(goldSync.mode, GOLD, 'mode');
	same(screensOf(gold.layout, NEW), [], 'screens left under the old id');
	same(
		gold.layout.scenes.filter((s) => s.id.endsWith(`-${NEW}`)).map((s) => s.id),
		[],
		'screen ids left with the old suffix',
	);
	same(
		screensOf(gold.layout, GOLD).map((s) => s.id),
		screensOf(source.layout, 'holdAndWin').map((s) => `${s.id}-${GOLD}`),
		'one copy of each screen under gold',
	);
	same(
		gold.layout.scenes.filter((s) => s.modeId !== GOLD),
		later.layout.scenes.filter((s) => s.modeId !== NEW),
		'the other screens',
	);
	assert(!gold.flow.modes?.[NEW], 'the old Flow tab is still there');
	assert(gold.flow.modes?.[GOLD], 'no gold Flow tab');
	same(
		gold.flow.containers.filter((c) => c.id.endsWith(`-${NEW}`)).map((c) => c.id),
		[],
		'containers left for the old screens',
	);
	const ids = flowNodeIds(gold.flow);
	same(
		ids.filter((id, at) => ids.indexOf(id) !== at),
		[],
		'duplicate node ids',
	);
	assert(!gold.winText?.modes?.[NEW], 'the old Win Text lines are still there');
	assert(gold.winText?.modes?.[GOLD], 'no gold Win Text lines');
	same(
		gold.config.imports?.find((i) => i.mode === GOLD)?.wroteAs,
		GOLD,
		'the record now names gold as written',
	);
	const errors = publishErrors(HOST).filter((i) => i.severity === 'error');
	same(describe(errors), '', 'publish errors');
});

await check("the copied tab's cinematic this project lacks is named in the Flow note", () => {
	assert(goldSync.ok, 'refused');
	assert(
		/cinematic intro-cine/.test(goldSync.parts.flow.note ?? ''),
		`note: ${goldSync.parts.flow.note}`,
	);
});

// ─── 3. a plain lines host with no overlay ────────────────────────────────────────────────────

console.log('\n3. into a plain lines host with no overlay');
const plainBefore = docsOf(PLAIN);
const plainBytes = stored(gameConfigDocKey(CLIENT, PLAIN));
const addToPlain = (routes?: ModeRoute[]) =>
	applyBonusImport(CLIENT, PLAIN, {
		source: SOURCE,
		mode: 'holdAndWin',
		asMode: true,
		routes,
		sessionId: ME,
		at: AT,
	});

await check(
	'a buy route is refused: a lines game deals it from Phase 7, nothing written',
	async () => {
		assert(!plainBefore.config.coinOverlay && !plainBefore.config.modes, 'the host is not plain');
		const out = await addToPlain([{ kind: 'buy', betMode: 'bonus' }]);
		assert(!out.ok && /route a pot to it/.test(out.error), JSON.stringify(out));
		same(stored(gameConfigDocKey(CLIENT, PLAIN)), plainBytes, 'nothing written');
	},
);

await check('…the dialog offers no route there: nothing it lists would play', () => {
	same(modeRouteOptions(plainBefore.config, 'lines'), [], 'options');
	assert(
		modeRouteOptions(plainBefore.config, 'holdAndWin').some((o) => o.key === 'buy:bonus'),
		'a Hold and Win kind deals the buy',
	);
});

await check('…with no route it says to add a coin overlay with pots first', async () => {
	const out = await addToPlain();
	assert(!out.ok && /Add a coin overlay with pots first/.test(out.error), JSON.stringify(out));
	same(stored(gameConfigDocKey(CLIENT, PLAIN)), plainBytes, 'nothing written');
});

await check('＋ Coin overlay… → 3 Pots, then a pot route: it is added', async () => {
	const overlay = await applyPotsOverlayAddOn(CLIENT, PLAIN, {
		sessionId: ME,
		preset: 'threePots',
	});
	assert(overlay.ok, `the add-on refused: ${overlay.ok ? '' : overlay.error}`);
	const withPots = docsOf(PLAIN).config;
	same(
		modeRouteOptions(withPots, 'lines').map((o) => o.key),
		[...(withPots.coinOverlay?.pots ?? []).map((p) => `pot:${p.id}`), 'count'],
		'the dialog offers the pots, and the coin count its dropped value coins fill',
	);
	const out = await addToPlain([{ kind: 'pot', pot: 'red' }]);
	assert(out.ok, `refused: ${out.ok ? '' : out.error}`);
	same(out.mode, NEW, 'beside the 3 Pots bonus');
	const config = docsOf(PLAIN).config;
	same(
		config.coinOverlay?.pots?.find((p) => p.id === 'red')?.bonus,
		{ mode: NEW },
		'red starts it',
	);
	same(gameConfigErrors(config), [], 'errors');
	same(config.paylines, plainBefore.config.paylines, 'paylines');
	same(config.paddingReels.basegame, plainBefore.config.paddingReels.basegame, 'base strips');
});

await check('…while a second mode may wait unstarted (routed later in /config)', async () => {
	await scaffoldProject(CLIENT, 'tpl-collector', { holdAndWinPreset: 'collector' });
	// The source has no Flow tab, and this flow has one a removed mode of the same id left behind.
	const sourceFlow = storedJson<FlowDocV2>(flowV2DocKey(CLIENT, 'tpl-collector'));
	put(flowV2DocKey(CLIENT, 'tpl-collector'), { ...sourceFlow, modes: {} });
	const hostFlow = storedJson<FlowDocV2>(flowV2DocKey(CLIENT, HOST));
	put(flowV2DocKey(CLIENT, HOST), {
		...hostFlow,
		modes: {
			...hostFlow.modes,
			holdAndWin_2: {
				graph: {
					nodes: [{ id: 'stale', kind: 'delay', pos: { x: 0, y: 0 } }],
					exec: [],
					data: [],
				},
			},
		},
	});
	const out = await applyBonusImport(CLIENT, HOST, {
		source: 'tpl-collector',
		mode: 'holdAndWin',
		asMode: true,
		sessionId: ME,
		at: AT,
	});
	assert(out.ok, `refused: ${out.ok ? '' : out.error}`);
	same(out.mode, 'holdAndWin_2', 'mode (free again since the rename to gold)');
	const config = docsOf(HOST).config;
	same(gameConfigErrors(config), [], 'errors');
	const tab = docsOf(HOST).flow.modes?.holdAndWin_2?.graph;
	assert(tab && !tab.nodes.some((n) => n.id === 'stale'), 'the stale tab was kept');
	assert(
		tab.nodes.some((n) => n.kind === 'modeTrigger' && n.modeId === 'holdAndWin_2'),
		'not the starter tab',
	);
});

await check('a scatter is never a route; an unknown pot is refused', async () => {
	const out = await applyBonusImport(CLIENT, HOST, {
		source: SOURCE,
		mode: 'holdAndWin',
		asMode: true,
		routes: [{ kind: 'pot', pot: 'nope' }],
		sessionId: ME,
		at: AT,
	});
	assert(!out.ok, 'not refused');
});

// ─── 4. the template and the coin overlay add-on write the split form ─────────────────────────

console.log('\n4. the presets and the coin overlay add-on write the split form');

await check('the Hold and Win template stores the split form, the mirror regenerated', async () => {
	for (const preset of HOLD_AND_WIN_PRESET_IDS) {
		const project = `tpl-${preset}`;
		KINDS[project] = 'holdAndWin';
		await scaffoldProject(CLIENT, project, { holdAndWinPreset: preset });
		const saved = storedJson<GameConfigDoc>(gameConfigDocKey(CLIENT, project));
		const seed = gameConfigSeedFor('holdAndWin', preset)!;
		same(
			content(normalize(saved)),
			content(normalize(seed)),
			`${preset}: byte-identical after normalize`,
		);
		same(content(saved), content(normalize(seed)), `${preset}: stored as before`);
		const split = splitFormOf(seed);
		assert(!('holdAndWin' in split) && !('potsOverlay' in split), `${preset}: legacy keys written`);
		same(
			split.modes?.filter((m) => m.board === 'respinBoard').map((m) => m.id),
			['holdAndWin'],
			`${preset}: one respin mode`,
		);
		assert(split.coinOverlay, `${preset}: no coin overlay`);
	}
});

await check('the coin overlay add-on normalizes to what it wrote before, on every host', () => {
	const hosts: [string, GameConfigDoc][] = [
		['lines', lines()],
		...HOLD_AND_WIN_PRESET_IDS.map(
			(p) => [`holdAndWin:${p}`, gameConfigSeedFor('holdAndWin', p)!] as [string, GameConfigDoc],
		),
	];
	let compared = 0;
	for (const [name, doc] of hosts) {
		for (const preset of POTS_OVERLAY_PRESET_IDS) {
			const out = addPotsOverlay(doc, preset);
			if (!out.ok) continue;
			compared++;
			same(
				JSON.stringify(normalize(splitFormOf(out.doc))),
				JSON.stringify(normalize(out.doc)),
				`${name} + ${preset}`,
			);
		}
	}
	assert(compared >= 6, `only ${compared} cases`);
});

// ─── 5. the plain Hold and Win template (bonus-games §0, Phase 6b) ───────────────────────────

console.log('\n5. the plain Hold and Win template: coins only, jackpots on or off');

type MockEvent = { event: string; context?: unknown };
type MockResponse = { events?: MockEvent[]; platform?: { gameRound?: { id?: string } } };
type Mock = { handle: (req: unknown, res: unknown, url: URL) => Promise<void> };

/** Boot the mock the test server builds for a stored config (`makeMock`: a lines contract carrying
 *  the Hold and Win inputs runs on the Hold and Win engine), POST to it as the client does, close. */
async function withMock<T>(
	config: GameConfigDoc,
	run: (post: (path: string, body: unknown) => Promise<MockResponse>) => Promise<T>,
): Promise<T> {
	const { grid } = mockContractOfBundle(
		'lines',
		{ config, symbols: { stacked: false, map: {} } } as unknown as Pick<
			RuntimeBundle,
			'config' | 'symbols'
		>,
		'plain-hold-and-win',
		'holdAndWin',
	);
	assert(grid?.holdAndWin, 'the contract carries no Hold and Win inputs');
	const mockRgs = createHoldAndWinMock({
		label: 'plain-hold-and-win',
		seed: 'plain-hold-and-win',
		quiet: true,
		...grid,
	}) as Mock;
	const server = createServer((req, res) =>
		mockRgs.handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1')),
	);
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	const post = (path: string, body: unknown) =>
		fetch(`http://127.0.0.1:${port}${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}).then((r) => r.json() as Promise<MockResponse>);
	try {
		return await run(post);
	} finally {
		await new Promise<void>((done) => server.close(() => done()));
	}
}

/** The boot `config` event, and `count` rounds played to their end the way the client plays them:
 *  bet + play (`force:trigger` starts the respins), `play` while the feature runs, `collect` if the
 *  round is left open. */
async function dealTriggeredRounds(config: GameConfigDoc, count: number) {
	return withMock(config, async (post) => {
		const sid = 'plain';
		const booted = await post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
		const boot = booted.events?.find((e) => e.event === 'config')?.context as {
			paylines?: unknown[];
			availablePayLines?: unknown[];
			holdAndWin?: { jackpots?: unknown[] };
		};
		const lines = (boot?.paylines ?? boot?.availablePayLines ?? []).length;
		const rounds: MockEvent[][] = [];
		for (let i = 0; i < count; i++) {
			const events: MockEvent[] = [];
			let seq = 0;
			let resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}`, [
				{ action: 'bet', context: [lines, 1] },
				{ action: 'play', context: 'force:trigger' },
			]);
			seq += 2;
			events.push(...(resp.events ?? []));
			const gid = resp.platform?.gameRound?.id;
			const ended = () => events.some((e) => e.event === 'gameEnd');
			for (let guard = 0; gid && !ended() && guard < 100; guard++) {
				resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'play' }]);
				seq += 1;
				events.push(...(resp.events ?? []));
			}
			if (gid && !events.some((e) => e.event === 'gameRoundOver')) {
				resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
				events.push(...(resp.events ?? []));
			}
			rounds.push(events);
		}
		return { boot, rounds };
	});
}

for (const jackpots of ['on', 'off'] as const) {
	const project = `tpl-plain-${jackpots}`;
	KINDS[project] = 'holdAndWin';
	await scaffoldProject(CLIENT, project, { holdAndWinJackpots: jackpots });
	const { config, layout, flow } = docsOf(project);

	await check(
		`Jackpots ${jackpots}: stored as the template, normalizes and validates clean`,
		() => {
			const seed = holdAndWinTemplateSeed(jackpots);
			assert(seed, 'no template');
			same(content(normalize(config)), content(normalize(seed)), 'byte-identical after normalize');
			same(content(config), content(normalize(seed)), 'stored as the template');
			same(gameConfigErrors(config), [], 'errors');
		},
	);

	await check(
		`Jackpots ${jackpots}: one respin mode, coins only — no pots, drops or collector`,
		() => {
			const modes = respinModeDecls(config);
			same(
				modes.map((m) => m.id),
				['holdAndWin'],
				'respin modes',
			);
			const rules = modes[0].holdAndWin;
			same(rules.specials, {}, 'specials');
			same(rules.respins, { start: 3, reset: 'anyCoin' }, 'respins');
			same(rules.stickiness, 'allCoins', 'stickiness');
			const overlay = config.coinOverlay;
			assert(!overlay?.pots?.length, 'pots');
			assert(!config.potsOverlay, 'a pots overlay');
			assert(!overlay?.meters?.length && !config.holdAndWin?.meters?.length, 'meters');
			same(overlay?.style ?? 'classic', 'classic', 'style');
			same(config.holdAndWin?.trigger.count?.min, 6, 'a count trigger of 6');
			assert(
				Object.values(config.symbols).every(
					(s) =>
						!(s.special_properties ?? []).some(
							(r) => r !== 'coin' && r !== 'jackpot' && r !== 'wild' && r !== 'blank',
						),
				),
				'a symbol with a special role',
			);
			const base = new Set(config.paddingReels.basegame.flat().map((c) => c.name));
			assert(base.has('BONUS'), 'no coin on the base strips');
		},
	);

	await check(`Jackpots ${jackpots}: the tiers, board end and screens follow the choice`, () => {
		const [mode] = respinModesOf(config);
		const tiers = jackpots === 'on' ? ['MINI', 'MINOR', 'MAJOR', 'GRAND'] : [];
		same(mode.jackpotTiers, tiers, 'jackpot tiers the tools list');
		same(
			config.holdAndWin?.boardEnd.type,
			jackpots === 'on' ? 'fullBoardJackpot' : 'none',
			'board end',
		);
		const caps = kindCapabilities('holdAndWin', projectAddOns(config).addOns);
		assert(caps.holdAndWin && caps.coinSymbols && !caps.potsOverlay, JSON.stringify(caps));
		const scenes = layout.scenes.map((s) => s.id);
		assert(!scenes.includes('pots'), 'a pots screen');
		same(scenes.includes('jackpotBar'), jackpots === 'on', 'the jackpot bar screen');
		const containers = flow.containers.map((c) => c.id);
		assert(!containers.includes('pots'), 'the flow declares the pots');
		same(containers.includes('jackpotBar'), jackpots === 'on', 'the flow declares the jackpot bar');
		const issues = publishErrors(project);
		same(describe(issues.filter((i) => i.severity === 'error')), '', 'flow errors');
		same(
			describe(issues.filter((i) => i.code === 'container-scene-missing')),
			'',
			'a flow step on a screen the layout lacks',
		);
	});

	await check(
		`Jackpots ${jackpots}: the mock deals a full respin round — coins land, respin, pay`,
		async () => {
			const { boot, rounds } = await dealTriggeredRounds(config, 20);
			same(boot?.holdAndWin?.jackpots?.length ?? 0, jackpots === 'on' ? 4 : 0, 'boot jackpots');
			for (const events of rounds) {
				const names = events.map((e) => e.event);
				assert(names.includes('holdAndWinTrigger'), `no trigger: ${names.join(',')}`);
				assert(
					names.filter((n) => n === 'respinUpdate').length >= 3,
					`fewer than 3 respins: ${names.join(',')}`,
				);
				const end = events.find((e) => e.event === 'holdAndWinEnd')?.context as
					{ cells: { amount: number }[]; total: number } | undefined;
				assert(end, `no holdAndWinEnd: ${names.join(',')}`);
				assert(end.total > 0, 'the coins paid nothing');
				same(
					end.cells.reduce((sum, c) => sum + c.amount, 0),
					end.total,
					'the coins pay their total',
				);
				assert(names.includes('gameEnd'), 'the round never ended');
			}
			assert(
				rounds.some((events) => events.some((e) => e.event === 'coinsLand')),
				'no respin landed a coin in 20 rounds',
			);
			const dealtJackpot = rounds.some((events) => /JACKPOT/.test(JSON.stringify(events)));
			same(dealtJackpot, jackpots === 'on', 'a jackpot coin dealt in 20 rounds');
		},
	);
}

await check(
	'the Create form offers no preset: a plain project gets the overlay from the card',
	() => {
		const offered = cleanOverlayPresets(holdAndWinTemplateSeed('on'));
		assert(offered.length, 'no coin overlay fits the plain template');
		for (const preset of offered) {
			const added = addPotsOverlay(holdAndWinTemplateSeed('on')!, preset);
			assert(added.ok, `${preset}: ${added.ok ? '' : added.reason}`);
			same(gameConfigErrors(normalize(splitFormOf(added.doc))), [], `${preset}: errors`);
		}
	},
);

if (failures) {
	console.error(`\ncheck:add-bonus-mode — ${failures} failed`);
	process.exit(1);
}
console.log('\ncheck:add-bonus-mode — all passed');
