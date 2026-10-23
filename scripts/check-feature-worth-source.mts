/**
 * `featureWorth` AS A COMPONENT SOURCE — the value Flow branches on, fed to a component's number
 * input, value binding, text and repeater by the same name (docs/status/component-editor.md).
 *
 *   pnpm check:feature-worth
 *
 *  1. CATALOG: the Bind to value catalog lists it under "Hold and Win" with a note stating the unit,
 *     and the Hold and Win readout feeds (a Total Win bar's / Text Box's source) carry it as a number.
 *  2. ONE READER: the game's component registry and Flow's `$engine.featureWorth` both read the
 *     `featureWorth` reader beside `stateHoldAndWin`, which is `featureWorthOf(stateHoldAndWin)` —
 *     nothing else reads `stateHoldAndWin.total`, so the two cannot drift. Fed with the win meter's
 *     formatter (`bookEventAmountToCurrencyString`), as `featureTotal` is.
 *  3. LIVE DURING RESPINS: real rounds from the REAL Hold and Win mock, translated by the REAL facade,
 *     folded event by event through the engine's own reducer — the reader reads 0 before the feature,
 *     each respin snapshot's worth as it is recorded (and does move between respins), and the final
 *     worth after the end.
 *  4. UNIT: 100 = 1× the total bet — the entry board's cash coins (× bet on the wire) × 100, and the
 *     end's own total, which the win meter (`featureTotal`) closes the round on at least.
 *  5. ROUND START: the next round clears an ended feature's worth to 0 (the game calls it as a spin
 *     starts); an open feature keeps it.
 */

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_TEMPLATES,
	holdAndWinMockInputs,
	normalizeGameConfigDoc,
} from '../packages/game-config/index.ts';
import {
	applyHoldAndWinEvent,
	atRoundStart,
	emptyHoldAndWinState,
	featureWorthOf,
	type HoldAndWinEvent,
	type HoldAndWinSnapshot,
	type HoldAndWinState,
	isHoldAndWinEvent,
} from '../packages/engine-game/src/game/holdAndWin.ts';
import {
	HOLD_AND_WIN_PARAM_CATALOG,
	HOLD_AND_WIN_VALUE_SOURCE_KEYS,
	VALUE_BINDING_SOURCE_CATALOG,
} from '../packages/engine-layout/src/lib/componentCatalog.ts';
import { createMockRgs } from './mock-rgs-server-holdandwin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let passes = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail?: unknown) => {
	if (ok) passes += 1;
	else
		failures.push(
			`FAIL  ${label}${detail === undefined ? '' : `\n        ${JSON.stringify(detail)}`}`,
		);
};

// 1. CATALOG
const binding = VALUE_BINDING_SOURCE_CATALOG.find((e) => e.key === 'featureWorth');
check('catalog: Bind to value lists featureWorth', Boolean(binding));
check('catalog: …in the Hold and Win group', binding?.group === 'Hold and Win', binding?.group);
check(
	'catalog: …and its note states the unit (100 = 1× total bet)',
	/100 = 1× total bet/.test(binding?.note ?? ''),
	binding?.note,
);
const feed = HOLD_AND_WIN_PARAM_CATALOG.find((p) => p.key === 'featureWorth');
check('catalog: a Hold and Win readout feed, kind number', feed?.kind === 'number', feed);
check(
	'catalog: …offered as a Hold and Win part / Text Box source',
	HOLD_AND_WIN_VALUE_SOURCE_KEYS.includes('featureWorth'),
);
check(
	'catalog: featureTotal is still offered beside it',
	VALUE_BINDING_SOURCE_CATALOG.some((e) => e.key === 'featureTotal') &&
		HOLD_AND_WIN_VALUE_SOURCE_KEYS.includes('featureTotal'),
);

// 2. ONE READER
const state = read('apps/lines/src/game/stateHoldAndWin.svelte.ts');
const game = read('apps/lines/src/components/Game.svelte');
const flow = read('apps/lines/src/game/flowRuntime.svelte.ts');
const actor = read('apps/lines/src/game/actor.ts');
check(
	'reader: featureWorth() is featureWorthOf(stateHoldAndWin)',
	/export const featureWorth = \(\): number => featureWorthOf\(stateHoldAndWin\);/.test(state),
);
check(
	'reader: the component registry feeds featureWorth from it, formatted as the win meter',
	/featureWorth: valueSource\(featureWorth, bookEventAmountToCurrencyString\)/.test(game) &&
		/\bfeatureWorth,[\s\S]*?\} from '\.\.\/game\/stateHoldAndWin\.svelte';/.test(game),
);
check(
	"reader: Flow's $engine.featureWorth is the same reader",
	/^\tfeatureWorth,$/m.test(flow) &&
		/import \{[^}]*\bfeatureWorth\b[^}]*\} from '\.\/stateHoldAndWin\.svelte';/.test(flow),
);
const totalReads = [
	['apps/lines/src/components/Game.svelte', game],
	['apps/lines/src/game/flowRuntime.svelte.ts', flow],
].filter(([, src]) => /stateHoldAndWin\.total\b/.test(src));
check('reader: nothing reads stateHoldAndWin.total around it', totalReads.length === 0, totalReads);
check(
	'reader: a spin starting clears an ended feature (startHoldAndWinRound in onNewGameStart)',
	/onNewGameStart:[\s\S]*?startHoldAndWinRound\(\);[\s\S]*?stateBet\.isTurbo/.test(actor),
);

// 3–4. LIVE, against the real mock + facade
const startMock = async (doc: unknown, label: string, force: string) => {
	const config = normalizeGameConfigDoc(doc);
	const mock = createMockRgs({
		label,
		quiet: true,
		seed: `feature-worth-${label}-${force}`,
		reels: config.numReels,
		rows: Math.max(...config.numRows),
		paylines: Object.values(config.paylines),
		holdAndWin: holdAndWinMockInputs(config),
		force,
	});
	const server: Server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	return {
		server,
		rgsUrl: `localhost:${typeof address === 'object' && address ? address.port : 0}`,
	};
};

type BookEvent = { type: string; [key: string]: unknown };
const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
	const { log, warn } = console;
	console.log = () => {};
	console.warn = () => {};
	try {
		return await fn();
	} finally {
		console.log = log;
		console.warn = warn;
	}
};

let tab = 0;
const playRound = async (doc: unknown, label: string, force: string): Promise<BookEvent[]> => {
	const { server, rgsUrl } = await quiet(() => startMock(doc, label, force));
	try {
		const facade = await import(
			`../packages/rgs-translator-eagaming/src/engineFacade.ts?fw=${++tab}`
		);
		const sid = `fw-${label}-${force}`;
		return await quiet(async () => {
			await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
			const bet = (await facade.requestBet({
				sessionID: sid,
				currency: 'EUR',
				amount: 1,
				mode: 'BASE',
				rgsUrl,
			})) as { round?: { state?: BookEvent[] } };
			return bet.round?.state ?? [];
		});
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
};

const CASES: [label: string, doc: unknown, force: string][] = [
	['plain', HOLD_AND_WIN_TEMPLATES.off, 'trigger'],
	['plain', HOLD_AND_WIN_TEMPLATES.off, 'chain'],
	['pots', HOLD_AND_WIN_PRESETS.pots, 'chain'],
	['collector', HOLD_AND_WIN_PRESETS.collector, 'chain'],
];

let movedDuringRespins = false;
for (const [label, doc, force] of CASES) {
	const name = `${label} ${force}`;
	const events = await playRound(doc, label, force);
	let picture: HoldAndWinState = emptyHoldAndWinState();
	const worths: number[] = [];
	let opened = false;
	let ended: number | undefined;
	let unit: [number, number] | undefined;
	for (const event of events) {
		if (!isHoldAndWinEvent(event as never)) continue;
		if (!opened && event.type !== 'holdAndWinTrigger')
			check(`${name}: 0 before the feature opens`, featureWorthOf(picture) === 0);
		picture = applyHoldAndWinEvent(picture, event as HoldAndWinEvent);
		if (event.type === 'holdAndWinTrigger') opened = true;
		if (event.type === 'holdAndWinState') {
			const snapshot = (event as { snapshot: HoldAndWinSnapshot }).snapshot;
			check(
				`${name}: respin ${worths.length}: reads the snapshot's worth as it is recorded`,
				featureWorthOf(picture) === snapshot.total,
				[featureWorthOf(picture), snapshot.total],
			);
			if (worths.length === 0 && snapshot.cells.every((c) => c.symbol.jackpot === undefined))
				unit = [
					Math.round(snapshot.cells.reduce((s, c) => s + (c.symbol.value ?? 0), 0) * 100) +
						snapshot.banked,
					featureWorthOf(picture),
				];
			worths.push(featureWorthOf(picture));
		}
		if (event.type === 'holdAndWinEnd') ended = (event as { total: number }).total;
	}
	check(`${name}: the feature plays its respins`, worths.length > 1, worths);
	check(
		`${name}: never goes down during the respins`,
		worths.every((w, i) => i === 0 || w >= worths[i - 1]),
		worths,
	);
	if (new Set(worths.slice(1)).size > 1 || worths.at(-1) !== worths[0]) movedDuringRespins = true;
	check(`${name}: after the end it holds the end's total`, featureWorthOf(picture) === ended, [
		featureWorthOf(picture),
		ended,
	]);
	if (unit && label === 'plain')
		check(
			`${name}: unit — the entry coins' value × 100 (100 = 1× total bet)`,
			unit[0] === unit[1],
			unit,
		);
	const close = events.filter((e) => e.type === 'setTotalWin').pop() as
		{ amount: number } | undefined;
	check(
		`${name}: unit — the win meter (featureTotal) closes the round on at least it, in the same unit`,
		close !== undefined &&
			ended !== undefined &&
			close.amount >= ended &&
			close.amount < Math.max(ended, 1) * 50,
		[close?.amount, ended],
	);
	// 5. ROUND START
	check(`${name}: the next round reads 0`, featureWorthOf(atRoundStart(picture)) === 0);
	check(
		`${name}: …and nothing else of the picture changes`,
		JSON.stringify({ ...atRoundStart(picture), total: picture.total }) === JSON.stringify(picture),
	);
}
check('respins: the worth moves between respins in at least one round', movedDuringRespins);
const open = { ...emptyHoldAndWinState(), active: true, total: 1250 };
check(
	'round start: an open (resumed) feature keeps its worth',
	featureWorthOf(atRoundStart(open)) === 1250,
);
check(
	'guard: a malformed total reads 0, never NaN',
	featureWorthOf({ ...emptyHoldAndWinState(), total: Number.NaN }) === 0,
);

console.log(`\n${passes} featureWorth source checks passed, ${failures.length} failed.`);
if (failures.length) {
	console.log(failures.join('\n'));
	process.exit(1);
}
