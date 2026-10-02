/**
 * Invisible Flow v2 — the `holdAndWin` vocabulary and starter flow (Hold and Win Phase 5).
 *
 *   pnpm --filter flow-spike run v2holdandwin
 *
 * Proves, headlessly over the REAL modules:
 *   1. The vocabulary is well formed: every struct / enum a type names is declared, no list declares
 *      a name twice.
 *   2. It hides what the kind does not use, read off `kindCapabilities('holdAndWin')` (engine-layout,
 *      which `engine-flow-v2` cannot import): no free-spin, stacked-picture, Book-of, cascade or
 *      multiplier-board surface.
 *   3. Its Hold and Win events mirror `engine-game` `HoldAndWinEventFields` field for field (names and
 *      optionality, read by the TypeScript checker off the source), and its enums mirror the engine's
 *      and the Game Config's.
 *   4. EVERY registered vocabulary is backed by the shared runtime: each action is a `flowEffects.ts`
 *      effect or an intent command, each cue an emitter member (the generated
 *      `emitterVocabulary.ts`, kept fresh by `gen:flow-vocab:check`), each value and collection a
 *      `linesEngineReader` key — and each Hold and Win cue carries the emitter member's fields. A
 *      planted unbacked action is caught.
 *   5. The starter flow validates with no error, keeps the feature in `modes.holdAndWin` and the base
 *      game in the global graph, owns exactly the beats the runtime backs, and declares the Hold and
 *      Win template's screens it shows and none of the free-spin ones or the tap-held intro/outro.
 *   6. PLAYED: the real Hold and Win mock (all three presets and the `pots-extra` test fixture, a forced
 *      beat of every kind) through the real facade, every book event replayed through the seed with
 *      the mode stack moved the way the play seam moves it. Each owned event runs its beat with the
 *      event itself as `bookEvent`, in the graph it belongs to; the mode's enter starts the feature
 *      music and "all modes finished" brings the base music back; nothing the chains fire is outside the vocabulary; every event payload
 *      carries its declared fields. The screens: the jackpot bar and pots from boot, the mode's
 *      screens exactly while the mode is on screen, and each beat screen (`luckySpin`, `wheel`,
 *      `jackpotWin`) shown for its beat and hidden after it. The add-respins and upgrade specials
 *      (Phase 11a) play only on the test fixture: each forced upgrade rule arrives as that rule, a

 *      non-sticky add-respins leaves through `clearRespinCells`, and no preset ever deals either.
 *   7. RESUMED: a resume rebuilds the mode stack silently (no enter), then replays the feature's last
 *      snapshot. That `holdAndWinState` alone puts the mode's screens up, starts the feature music
 *      and restores the board — the later beats then play on a fully mounted feature.
 *
 * Prints PASS/FAIL per assertion + a final `V2 HOLD AND WIN: PASSED`.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import {
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	BOOK_OF_DRIVEN_SEED_LIBRARY,
	HOLD_AND_WIN_CAUSES,
	HOLD_AND_WIN_DRIVEN_SEED_DOC,
	HOLD_AND_WIN_JACKPOT_SOURCES,
	HOLD_AND_WIN_SPECIAL_KINDS,
	HOLD_AND_WIN_STICKINESS,
	HOLD_AND_WIN_UPGRADE_TARGETS,
	HOLD_AND_WIN_VOCAB,
	TEMPLATE_VOCABULARIES,
	createContainerMountModel,
	createFlowV2Env,
	flowOwnsSignal,
	freshDrivenSeedDoc,
	runFlowEvent,
	runFlowModeTransition,
	validateFlowDoc,
	type FlowModeTransition,
	type RunContext,
	type TemplateVocabulary,
	type TypeRef,
} from 'engine-flow-v2';
import { kindCapabilities } from 'engine-layout';

import { LINES_EMITTER_VOCABULARY } from '../../apps/lines/src/game/emitterVocabulary';
import { LINES_ENGINE_KEYS } from '../../apps/lines/src/game/flowEngineKeys';
import { INTENT_COMMANDS } from '../../apps/lines/src/game/flowIntentCommands';
import {
	HOLD_AND_WIN_TEST_FIXTURES,
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_SPECIALS,
	STICKINESS,
	UPGRADE_TARGETS,
	holdAndWinMockInputs,
	normalizeGameConfigDoc,
} from '../../packages/game-config/index';
import { createMockRgs } from '../../scripts/mock-rgs-server-holdandwin.mjs';
import {
	requestAuthenticate,
	requestBet,
} from '../../packages/rgs-translator-eagaming/src/engineFacade';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
const check = (label: string, cond: boolean, detail = ''): void => {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? ` — ${detail}` : ''}`);
	if (!cond) failures += 1;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const realLog = console.log.bind(console);
const realWarn = console.warn.bind(console);
const hush = async <T>(fn: () => T | Promise<T>): Promise<T> => {
	console.log = () => {};
	console.warn = () => {};
	try {
		return await fn();
	} finally {
		console.log = realLog;
		console.warn = realWarn;
	}
};

const vocab = HOLD_AND_WIN_VOCAB;
const doc = HOLD_AND_WIN_DRIVEN_SEED_DOC;

// ---------------------------------------------------------------------------
// 1. Well formed.
// ---------------------------------------------------------------------------

const named = (t: TypeRef, out: { structs: Set<string>; enums: Set<string> }): void => {
	if (t.t === 'list') named(t.of, out);
	else if (t.t === 'struct') out.structs.add(t.name);
	else if (t.t === 'enum') out.enums.add(t.name);
};
const referenced = { structs: new Set<string>(), enums: new Set<string>() };
for (const s of vocab.structs) for (const f of s.fields) named(f.type, referenced);
for (const list of [vocab.events.map((e) => e.payload), vocab.actions.map((a) => a.params)])
	for (const params of list) for (const p of params) named(p.type, referenced);
for (const c of vocab.cues) for (const p of c.payload) named(p.type, referenced);
for (const v of vocab.values) named(v.type, referenced);
const structNames = new Set(vocab.structs.map((s) => s.name));
const enumNames = new Set(vocab.enums.map((e) => e.name));
check(
	'1. every struct a type names is declared',
	[...referenced.structs].every((n) => structNames.has(n)),
	[...referenced.structs].filter((n) => !structNames.has(n)).join(),
);
check(
	'1. every enum a type names is declared',
	[...referenced.enums].every((n) => enumNames.has(n)),
	[...referenced.enums].filter((n) => !enumNames.has(n)).join(),
);
const dupes = (names: string[]) => names.filter((n, i) => names.indexOf(n) !== i);
for (const [label, names] of Object.entries({
	structs: vocab.structs.map((s) => s.name),
	enums: vocab.enums.map((e) => e.name),
	events: vocab.events.map((e) => e.name),
	actions: vocab.actions.map((a) => a.name),
	cues: vocab.cues.map((c) => c.name),
	values: vocab.values.map((v) => v.name),
})) {
	check(`1. no ${label} declared twice`, !dupes(names).length, dupes(names).join());
}

// ---------------------------------------------------------------------------
// 2. Kind gating.
// ---------------------------------------------------------------------------

const caps = kindCapabilities('holdAndWin');
const surfaces = [...vocab.events, ...vocab.actions, ...vocab.cues, ...vocab.values].map(
	(s) => s.name,
);
const gated: [flag: keyof typeof caps, pattern: RegExp][] = [
	['freeSpins', /freeSpin|FreeSpin|FreeGame/],
	['stackedPictures', /StackedPictures/],
	['bookReveal', /^setExpandingSymbol$|^expandBookColumns$|^setSpecialSymbol$|^specialBook/],
	['cascade', /^tumble|Tumble|GlobalMult/],
	['multiplierCollect', /^boardMultiplier|multiplierBoard/],
];
for (const [flag, pattern] of gated) {
	const offered = surfaces.filter((n) => pattern.test(n));
	check(
		`2. kindCapabilities.${flag} is ${caps[flag]} ⇒ ${caps[flag] ? 'offered' : 'none offered'}`,
		caps[flag] ? offered.length > 0 : offered.length === 0,
		offered.join(),
	);
}
check(
	'2. the kind has the Hold and Win feature',
	caps.holdAndWin && surfaces.includes('holdAndWinTrigger'),
);

// ---------------------------------------------------------------------------
// 3. Mirrors the engine contract.
// ---------------------------------------------------------------------------

const engineFile = resolve(ROOT, 'packages/engine-game/src/game/holdAndWin.ts');
const program = ts.createProgram([engineFile], {
	strict: true,
	noEmit: true,
	skipLibCheck: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(engineFile)!;
const alias = (name: string): ts.TypeAliasDeclaration => {
	const found = source.statements.find(
		(s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === name,
	);
	if (!found) throw new Error(`engine-game holdAndWin.ts declares no type ${name}`);
	return found;
};
const literals = (name: string): string[] => {
	const type = checker.getTypeAtLocation(alias(name).name);
	return (type.isUnion() ? type.types : [type]).map((t) => String((t as ts.LiteralType).value));
};
const fieldsDecl = alias('HoldAndWinEventFields');
const engineEvents = checker
	.getPropertiesOfType(checker.getTypeAtLocation(fieldsDecl.name))
	.map((event) => ({
		name: event.name,
		fields: checker
			.getPropertiesOfType(checker.getTypeOfSymbolAtLocation(event, fieldsDecl))
			.map((f) => `${f.name}${f.flags & ts.SymbolFlags.Optional ? '?' : ''}`)
			.sort(),
	}));
check(
	'3. the checker read the engine contract',
	engineEvents.length === 23,
	`${engineEvents.length}`,
);
for (const { name, fields } of engineEvents) {
	const decl = vocab.events.find((e) => e.name === name);
	const declared = (decl?.payload ?? []).map((p) => `${p.name}${p.optional ? '?' : ''}`).sort();
	check(
		`3. ${name} mirrors HoldAndWinEventFields`,
		Boolean(decl) && same(declared, fields),
		`vocab [${declared}] engine [${fields}]`,
	);
}
const enumValues = (name: string) => vocab.enums.find((e) => e.name === name)?.values ?? [];
check(
	'3. HoldAndWinCause = the engine union',
	same(HOLD_AND_WIN_CAUSES, literals('HoldAndWinCause')),
);
check(
	'3. HoldAndWinJackpotSource = the engine union',
	same(HOLD_AND_WIN_JACKPOT_SOURCES, literals('HoldAndWinJackpotSource')),
);
check(
	'3. HoldAndWinSpecial = game-config',
	same(HOLD_AND_WIN_SPECIAL_KINDS, [...HOLD_AND_WIN_SPECIALS]),
);
check('3. Stickiness = game-config', same(HOLD_AND_WIN_STICKINESS, [...STICKINESS]));
check(
	'3. UpgradeTarget = game-config',
	same(HOLD_AND_WIN_UPGRADE_TARGETS, [...UPGRADE_TARGETS]) &&
		same(enumValues('UpgradeTarget'), HOLD_AND_WIN_UPGRADE_TARGETS),
);
check(
	'3. the enums are the ones declared',
	same(enumValues('HoldAndWinCause'), HOLD_AND_WIN_CAUSES),
);

// ---------------------------------------------------------------------------
// 4. Backed by the runtime.
// ---------------------------------------------------------------------------

const effects = new Set([
	...LINES_EMITTER_VOCABULARY.effects.map((e) => e.name),
	...Object.keys(INTENT_COMMANDS),
]);
const emitter = new Map(LINES_EMITTER_VOCABULARY.events.map((e) => [e.type, e.fields ?? []]));
const engineKeys = new Set<string>(LINES_ENGINE_KEYS);
const unbacked = (v: TemplateVocabulary): string[] => [
	...v.actions.filter((a) => !effects.has(a.name)).map((a) => `action ${a.name}`),
	...v.cues.filter((c) => !emitter.has(c.name)).map((c) => `cue ${c.name}`),
	...[...v.values, ...v.collections]
		.filter((x) => !engineKeys.has(x.name))
		.map((x) => `value ${x.name}`),
];
for (const [id, v] of Object.entries(TEMPLATE_VOCABULARIES)) {
	const missing = unbacked(v);
	check(`4. ${id}: every action, cue and value is backed`, !missing.length, missing.join(', '));
}
check(
	'4. a planted unbacked action is caught',
	same(
		unbacked({
			...vocab,
			actions: [...vocab.actions, { name: 'noSuchBeat', params: [], category: 'command' }],
		}),
		['action noSuchBeat'],
	),
);
const hwEmitter = LINES_EMITTER_VOCABULARY.events
	.filter((e) => e.group === 'Hold and Win' || e.group === 'Flights')
	.map((e) => e.type);
const OWN_CUES = vocab.cues.slice(0, hwEmitter.length);
check(
	'4. the Hold and Win cues open the cue list: every Hold and Win and Flights emitter member',
	same(OWN_CUES.map((c) => c.name).sort(), [...hwEmitter].sort()),
	`${OWN_CUES.map((c) => c.name)}`,
);
for (const cue of OWN_CUES) {
	const fields = (emitter.get(cue.name) ?? [])
		.map((f) => `${f.key}${f.required ? '' : '?'}`)
		.sort();
	const declared = cue.payload.map((p) => `${p.name}${p.optional ? '?' : ''}`).sort();
	check(
		`4. cue ${cue.name} carries the emitter's fields`,
		same(declared, fields),
		`vocab [${declared}] emitter [${fields}]`,
	);
}

// ---------------------------------------------------------------------------
// 5. The starter flow.
// ---------------------------------------------------------------------------

const errors = validateFlowDoc(
	doc,
	vocab,
	BOOK_OF_DRIVEN_SEED_LIBRARY,
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
).filter((i) => i.severity !== 'info');
check(
	'5. the seed validates with no error or warning',
	!errors.length,
	errors.map((e) => `${e.code}: ${e.message}`).join(' | '),
);
check(
	'5. a holdAndWin project is seeded with it',
	freshDrivenSeedDoc('holdAndWin').templateId === 'holdAndWin',
);
check(
	'5. the feature lives in modes.holdAndWin',
	Object.keys(doc.modes ?? {}).join() === 'holdAndWin',
);
const MODE_SCREENS = ['respinBackground', 'respinBoard', 'respinCounter', 'totalWinBar', 'letters'];
const BEAT_SCREENS: Record<string, string> = {
	luckySpin: 'luckySpin',
	holdAndWinWheel: 'wheel',
	jackpotWin: 'jackpotWin',
};
check(
	'5. declares exactly the screens it shows',
	same(
		doc.containers.map((c) => c.id).sort(),
		[
			...['basegame', 'hudBar', 'hudCorners', 'jackpotBar', 'pots'],
			...['loading', 'buyFeature', 'buyConfirm'],
			...MODE_SCREENS,
			'luckySpin',
			'wheel',
			'jackpotWin',
		].sort(),
	),
	doc.containers.map((c) => c.id).join(),
);

/** Each presented event → its beat. Base events run in the global graph, feature events in the mode. */
const BASE_BEATS: Record<string, string> = {
	luckySpin: 'playLuckySpinIntro',
	meterUpdate: 'fillMeter',
	coinInstantCollect: 'instantCollect',
	randomMetreTrigger: 'fireRandomMetre',
	jackpotWin: 'showJackpotWin',
};
const FEATURE_BEATS: Record<string, string> = {
	holdAndWinTrigger: 'showRespinBoard',
	holdAndWinWheel: 'spinWheel',
	respinReveal: 'spinRespin',
	coinsLand: 'stickCoins',
	mysteryReveal: 'revealMystery',
	coinPay: 'payCoins',
	respinsAdded: 'addRespins',
	coinUpgrade: 'upgradeCoins',
	coinBoost: 'boostCoins',
	specialBecomesCoin: 'turnSpecialIntoCoin',
	coinCollect: 'collectCoins',
	cellsCleared: 'clearRespinCells',
	columnComplete: 'lightLetter',
	jackpotWin: 'showJackpotWin',
	respinUpdate: 'setRespinCounter',
	holdAndWinState: 'restoreRespinBoard',
	holdAndWinEnd: 'hideRespinBoard',
};
const CODED = ['meterLevels'];
for (const t of Object.keys(FEATURE_BEATS)) {
	check(`5. ${t} is owned by the mode`, flowOwnsSignal(doc, t, 'holdAndWin'));
	if (!(t in BASE_BEATS))
		check(`5. ${t} is not owned at base`, !flowOwnsSignal(doc, t, 'basegame'));
}
for (const t of Object.keys(BASE_BEATS))
	check(`5. ${t} is owned at base`, flowOwnsSignal(doc, t, 'basegame'));
for (const t of CODED) {
	check(`5. ${t} falls through to its coded handler`, !flowOwnsSignal(doc, t, 'holdAndWin'));
}

// ---------------------------------------------------------------------------
// 6. Played.
// ---------------------------------------------------------------------------

type BookEvent = { type: string; [key: string]: unknown };
type Fired = { kind: 'effect' | 'cue'; name: string; payload: Record<string, unknown> };

const fired: Fired[] = [];
const mount = createContainerMountModel(
	doc.containers.map((c) => ({ id: c.id, sceneId: c.sceneId, z: c.z })),
);
let active = 'basegame';
const screens: string[] = [];
const env = createFlowV2Env({
	mount: {
		...mount,
		show: (id) => {
			screens.push(`show ${id}`);
			mount.show(id);
		},
		hide: (id) => {
			screens.push(`hide ${id}`);
			mount.hide(id);
		},
		awaitComplete: async () => {},
	},
	effect: (name) => (payload) => {
		fired.push({ kind: 'effect', name, payload });
	},
	broadcast: (cue, payload) => {
		fired.push({ kind: 'cue', name: cue, payload });
	},
	waitForTimeout: () => Promise.resolve(),
	timeScale: () => 1,
	engineRead: () => undefined,
});
const ctx: RunContext = {
	vocab,
	library: BOOK_OF_DRIVEN_SEED_LIBRARY,
	env,
	activeMode: () => active,
};
const take = () => fired.splice(0, fired.length);

await runFlowEvent(doc, ctx, 'load', {});
await runFlowEvent(doc, ctx, 'complete:loading', {});
for (const id of ['basegame', 'hudBar', 'hudCorners', 'jackpotBar', 'pots'])
	check(`6. after boot, ${id} is shown`, mount.isShown(id));
for (const id of [...MODE_SCREENS, ...Object.values(BEAT_SCREENS)])
	check(`6. after boot, ${id} is not shown`, !mount.isShown(id));
check('6. after boot, loading is hidden', !mount.isShown('loading'));
take();

const startMock = async (preset: string, force: string): Promise<Server> => {
	const config = normalizeGameConfigDoc(
		HOLD_AND_WIN_PRESETS[preset] ?? HOLD_AND_WIN_TEST_FIXTURES[preset],
	);
	const mock = createMockRgs({
		label: `seed-${preset}`,
		quiet: true,
		seed: `seed-${preset}-${force}`,
		reels: config.numReels,
		rows: Math.max(...config.numRows),
		paylines: Object.values(config.paylines),
		holdAndWin: holdAndWinMockInputs(config),
		force,
	});
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	await new Promise<void>((done) => server.listen(0, done));
	return server;
};

const CASES: [preset: string, force: string][] = [
	['pots', 'trigger'],
	['pots', 'special:payer'],
	['pots', 'special:multiplier'],
	['pots', 'special:collector'],
	['pots', 'mystery:jackpot:MINI'],
	['pots', 'unlock:payer'],
	['pots', 'meter:red'],
	['pots', 'lucky'],
	['pots', 'fullBoard'],
	['pots', 'chain'],
	['classic', 'letters'],
	['classic', 'trigger:randomMetre'],
	['collector', 'wheel:coinBoost'],
	['collector', 'instant'],
	['pots-extra', 'special:addRespins'],
	['pots-extra', 'special:upgrade:all'],
	['pots-extra', 'special:upgrade:adjacent'],
	['pots-extra', 'special:upgrade:jackpotTier'],
	['pots-extra', 'mystery:upgrade'],
];
const EXTRA_EVENTS = ['respinsAdded', 'coinUpgrade'];

const declared = new Map(vocab.events.map((e) => [e.name, e.payload]));
const surfaceNames = new Set([...vocab.actions, ...vocab.cues].map((s) => s.name));
const ran = new Set<string>();
const thrown: string[] = [];
const wrongBeat: string[] = [];
const shapeIssues: string[] = [];
const outside: string[] = [];
let enters = 0;
let featureBook: BookEvent[] = [];
let finishes = 0;
let musicOk = true;
const screenIssues: string[] = [];
const beatScreens = new Set<string>();
const extraInPresets: string[] = [];
const upgradeRules: string[] = [];
let appliedCleared = false;

const transition = async (t: FlowModeTransition): Promise<Fired[]> => {
	await runFlowModeTransition(doc, ctx, t);
	return take();
};

for (const [index, [preset, force]] of CASES.entries()) {
	const server = await hush(() => startMock(preset, force));
	const rgsUrl = `localhost:${(server.address() as AddressInfo).port}`;
	const sessionID = `hw-seed-${index}`;
	const events = await hush(async () => {
		await requestAuthenticate({ sessionID, rgsUrl, language: 'en' });
		const bet = await requestBet({ sessionID, currency: 'EUR', amount: 1, mode: 'BASE', rgsUrl });
		return ((bet as { round?: { state?: BookEvent[] } })?.round?.state ?? []) as BookEvent[];
	});
	server.close();
	if (force === 'chain') featureBook = events;
	if (preset !== 'pots-extra')
		for (const e of events)
			if (EXTRA_EVENTS.includes(e.type)) extraInPresets.push(`${preset} ${force}: ${e.type}`);
	const rule = /^special:upgrade:(\w+)$/.exec(force)?.[1];
	if (rule) {
		const got = events.filter((e) => e.type === 'coinUpgrade').map((e) => String(e.target));
		// The forced upgrade is the first; a later one that lands naturally draws its own rule.
		if (got[0] !== rule) upgradeRules.push(`${force} → [${got}]`);
	}
	if (force === 'special:addRespins')
		appliedCleared = events.some((e) => e.type === 'cellsCleared' && e.reason === 'applied');
	for (const event of events) {
		const payload = declared.get(event.type);
		if (!payload) outside.push(`event ${event.type}`);
		else if (engineEvents.some((e) => e.name === event.type)) {
			const keys = Object.keys(event).filter((k) => k !== 'type' && k !== 'index');
			const extra = keys.filter((k) => !payload.some((p) => p.name === k));
			const missing = payload.filter((p) => !p.optional && !(p.name in event)).map((p) => p.name);
			if (extra.length || missing.length)
				shapeIssues.push(`${event.type} extra [${extra}] missing [${missing}]`);
		}

		// The play seam: a mode-opening event enters its mode first; a mode-closing one leaves it after.
		if (event.type === 'holdAndWinTrigger') {
			active = 'holdAndWin';
			const music = await transition({
				kind: 'enter',
				mode: 'holdAndWin',
				cause: String(event.cause),
			});
			const off = MODE_SCREENS.filter((id) => !mount.isShown(id));
			if (off.length) screenIssues.push(`after enter, not shown: ${off}`);
			enters += 1;
			musicOk &&= same(
				music.map((f) => [f.name, f.payload.name]),
				[['soundMusic', 'bgm_freespin']],
			);
		}
		if (flowOwnsSignal(doc, event.type, active)) {
			screens.length = 0;
			try {
				await runFlowEvent(doc, ctx, event.type, event, { bookEvents: events });
			} catch (err) {
				thrown.push(`${event.type}: ${(err as Error).message}`);
			}
			// Every snapshot re-asserts the mode's screens and music (what a resume needs; idempotent
			// otherwise), so for `holdAndWinState` those lead the beat.
			const snapshot = event.type === 'holdAndWinState';
			const all = take();
			const out = snapshot
				? all.filter((f) => !(f.name === 'soundMusic' && f.payload.name === 'bgm_freespin'))
				: all;
			if (snapshot && all.length - out.length !== 1)
				wrongBeat.push('holdAndWinState: no feature music');
			const screen = BEAT_SCREENS[event.type];
			const expected = snapshot
				? MODE_SCREENS.map((id) => `show ${id}`)
				: screen
					? [`show ${screen}`, `hide ${screen}`]
					: [];
			const beatScreen = event.type === 'jackpotWin' && active !== 'holdAndWin' ? [] : expected;
			if (!same(screens, beatScreen))
				screenIssues.push(`${event.type} (${active}): ${screens.join(', ') || 'no screen'}`);
			if (screen && beatScreen.length) beatScreens.add(screen);
			for (const f of out) if (!surfaceNames.has(f.name)) outside.push(`${f.kind} ${f.name}`);
			const beat = (active === 'holdAndWin' ? FEATURE_BEATS : BASE_BEATS)[event.type];
			if (beat) {
				ran.add(event.type);
				const ok =
					out.length === 1 &&
					out[0].kind === 'effect' &&
					out[0].name === beat &&
					(beat === 'playLuckySpinIntro'
						? same(out[0].payload, {})
						: out[0].payload.bookEvent === event);
				if (
					!ok &&
					!wrongBeat.includes(`${event.type} → ${out.map((f) => f.name).join('+') || 'nothing'}`)
				)
					wrongBeat.push(`${event.type} → ${out.map((f) => f.name).join('+') || 'nothing'}`);
			}
		} else if (!CODED.includes(event.type) && event.type in { ...BASE_BEATS, ...FEATURE_BEATS }) {
			wrongBeat.push(`${event.type} not owned while ${active} is on screen`);
		}
		if (event.type === 'holdAndWinEnd') {
			active = 'basegame';
			await transition({ kind: 'exit', mode: 'holdAndWin', total: Number(event.total) });
			const on = MODE_SCREENS.filter((id) => mount.isShown(id));
			if (on.length) screenIssues.push(`after exit, still shown: ${on}`);
			const back = await transition({ kind: 'allFinished' });
			finishes += 1;
			musicOk &&= same(
				back.map((f) => [f.name, f.payload.name]),
				[['soundMusic', 'bgm_main']],
			);
		}
	}
}

check(
	'6. every forced feature entered the mode and finished',
	enters === CASES.length - 1 && finishes === enters,
	`${enters} entered, ${finishes} finished`,
);
check('6. the mode starts the feature music and the return brings the base music back', musicOk);
check('6. no owned chain threw', !thrown.length, thrown.join(' | '));
check(
	'6. the mode screens follow the mode, each beat screen frames exactly its beat',
	!screenIssues.length,
	[...new Set(screenIssues)].join(' | '),
);
for (const id of Object.values(BEAT_SCREENS))
	check(`6. the ${id} screen was shown around its beat`, beatScreens.has(id));
check(
	'6. each owned event ran exactly its beat, fed the event itself',
	!wrongBeat.length,
	wrongBeat.join(' | '),
);
check(
	'6. every event and every fired surface is in the vocabulary',
	!outside.length,
	[...new Set(outside)].join(),
);
check(
	'6. every Hold and Win event payload carries exactly its declared fields',
	!shapeIssues.length,
	[...new Set(shapeIssues)].join(' | '),
);
check(
	'6. no preset deals an add-respins or an upgrade',
	!extraInPresets.length,
	extraInPresets.join(' | '),
);
check(
	'6. each forced upgrade rule applied as that rule',
	!upgradeRules.length,
	upgradeRules.join(' | '),
);
check('6. a non-sticky add-respins left the board (cellsCleared applied)', appliedCleared);
for (const t of [...Object.keys(BASE_BEATS), ...Object.keys(FEATURE_BEATS)]) {
	check(`6. the cases presented a ${t} through the seed`, ran.has(t));
}

// ---------------------------------------------------------------------------
// 7. Resumed.
// ---------------------------------------------------------------------------

const snapshots = featureBook.filter((e) => e.type === 'holdAndWinState');
const snapshot = snapshots[Math.floor(snapshots.length / 2)];
check('7. the chain round has a mid-feature snapshot to resume from', Boolean(snapshot));
if (snapshot) {
	for (const id of MODE_SCREENS) mount.hide(id);
	take();
	screens.length = 0;
	// The play seam restored the stack without a transition: the mode is simply on screen.
	active = 'holdAndWin';
	await runFlowEvent(doc, ctx, 'holdAndWinState', snapshot, { bookEvents: featureBook });
	const out = take();
	check(
		'7. the resumed snapshot puts every mode screen up',
		MODE_SCREENS.every((id) => mount.isShown(id)),
		MODE_SCREENS.filter((id) => !mount.isShown(id)).join(),
	);
	check(
		'7. …starts the feature music, then restores the board from the snapshot',
		same(
			out.map((f) => [f.name, f.payload.name ?? null, f.payload.bookEvent === snapshot]),
			[
				['soundMusic', 'bgm_freespin', false],
				['restoreRespinBoard', null, true],
			],
		),
		JSON.stringify(out.map((f) => f.name)),
	);
	const next = featureBook.slice(featureBook.indexOf(snapshot) + 1);
	const end = next.find((e) => e.type === 'holdAndWinEnd');
	await runFlowEvent(doc, ctx, 'holdAndWinEnd', end ?? {}, { bookEvents: featureBook });
	check(
		'7. the resumed feature ends on its own beat with the screens still up',
		Boolean(end) &&
			take().some((f) => f.name === 'hideRespinBoard') &&
			MODE_SCREENS.every((id) => mount.isShown(id)),
	);
}

console.log(failures ? `\nV2 HOLD AND WIN: ${failures} FAILED` : '\nV2 HOLD AND WIN: PASSED');
if (failures) process.exitCode = 1;
