/**
 * ONE BOOK-EVENT DISPATCH PATH — a game with NO flow crosses the same round seam as a flow-driven one.
 *
 *   pnpm check:play-book-dispatch
 *
 * The engine's own `createPlayBook` (`packages/engine-game/src/game/playBook.ts`) is imported for
 * real and a round is played through its `playBet`, three times: with no flow at all (no v2 doc is
 * authored), with a v2 flow that owns NO event (a book-events-free graph — each falls through to the
 * coded map), and with a v2 flow that owns every event. Only the presentation hooks the game hands
 * the seam are recorded.
 *
 * `playBookEvents` used to run a SECOND loop when neither flow was present, straight to the coded
 * handler map. It skipped `runBookEventPresentation` (the slam carve-out) and every step of
 * `dispatchBookEvent`: the win-cycle record, the running win meter, the cascade sound step, the
 * all-at-once win lines, the big-win run-up and the retrigger's `freeSpinsAdded`. Claims:
 *
 *  1. NO FLOW: every event goes through the slam carve-out, its round state is recorded, the win
 *     cycle and the cascade step see it, and the coded handler presents it — each exactly once.
 *  2. NO FLOW: the win meter has climbed to the `winInfo`'s `totalWin` by the time the coded
 *     `winInfo` handler runs; the big win counts up from `setWin`; the all-at-once lines draw on the
 *     `winInfo`; a retrigger sets `freeSpinsAdded`.
 *  3. PARITY: the seam calls, in order, are identical with no flow, a non-owning v2 flow and an
 *     owning one; only who presents the event differs. A non-owning flow is never asked to present.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const stub = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
// `state-shared` is a plain-object stand-in so the round's writes can be read back here (this file
// imports the same specifier, so it gets the same module instance). The rest are what `utils-book`
// imports at module scope and this check never calls.
const STUBS = {
	'state-shared': stub(
		'export const stateBet = { winBookEventAmount: 0 };' +
			' export const stateUi = { unskippablePresentationActive: false, freeSpinsAdded: 0 };' +
			' export const stateUrlDerived = {};',
	),
	envs: stub('export const PUBLIC_CHROMATIC = "";'),
	'rgs-requests': stub('export const requestEndEvent = async () => ({});'),
	'utils-book': new URL('../packages/utils-book/index.ts', import.meta.url).href,
};
register(
	'data:text/javascript,' +
		encodeURIComponent(`
			import { readFile } from 'node:fs/promises';
			import { stripTypeScriptTypes } from 'node:module';
			import { fileURLToPath } from 'node:url';
			const STUBS = ${JSON.stringify(STUBS)};
			export async function resolve(specifier, context, next) {
				if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
				try {
					return await next(specifier, context);
				} catch (err) {
					if (!specifier.startsWith('.') && !/^[\\w-]+\\/[\\w/-]+$/.test(specifier)) throw err;
					for (const ext of ['.ts', '/index.ts']) {
						try {
							return await next(specifier + ext, context);
						} catch {}
					}
					throw err;
				}
			}
			export async function load(url, context, next) {
				// Vite's \`import.meta.env\` is absent under node: the play seam reads only \`DEV\`.
				if (!url.endsWith('/engine-game/src/game/playBook.ts')) return next(url, context);
				const text = await readFile(fileURLToPath(url), 'utf8');
				const js = stripTypeScriptTypes(text.replaceAll('import.meta.env.DEV', 'false'));
				return { format: 'module', source: js, shortCircuit: true };
			}
		`),
	pathToFileURL('./'),
);

const { createPlayBook } = await import('../packages/engine-game/src/game/playBook.ts');
const { stateBet, stateUi } = (await import('state-shared' as string)) as {
	stateBet: { winBookEventAmount: number };
	stateUi: { freeSpinsAdded: number };
};

let passes = 0;
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes += 1;
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

type BookEvent = { type: string; index: number } & Record<string, unknown>;

const BIG_WIN_TIER = { name: 'bigWin', threshold: 20 };

const book = (): BookEvent[] => [
	{ index: 0, type: 'reveal', board: [] },
	{ index: 1, type: 'winInfo', totalWin: 50, wins: [] },
	{ index: 2, type: 'setWin', amount: 50, winLevel: 3 },
	{ index: 3, type: 'freeSpinRetrigger', extraFs: 4 },
	{ index: 4, type: 'setTotalWin', amount: 50 },
];
const TYPES = book().map((event) => event.type);

type Path = 'none' | 'unowned' | 'v2';

/** One round through the REAL seam. `seam` is every presentation hook the seam called, in order;
 *  `driven` is who presented each event; `meterAtWinInfo` the meter as the `winInfo` was presented. */
const playRound = async (path: Path) => {
	stateBet.winBookEventAmount = 0;
	stateUi.freeSpinsAdded = 0;
	const seam: string[] = [];
	const driven: string[] = [];
	let meterAtWinInfo: number | undefined;

	const present = (via: string, bookEvent: BookEvent) => {
		driven.push(`${via}:${bookEvent.type}`);
		if (bookEvent.type === 'winInfo') meterAtWinInfo = stateBet.winBookEventAmount;
	};
	const handlers = new Proxy({} as Record<string, (event: BookEvent) => Promise<void>>, {
		get: () => async (event: BookEvent) => present('coded', event),
	});
	const { playBet } = createPlayBook({
		bookEventHandlerMap: handlers,
		getFlowV2: () =>
			path === 'none'
				? undefined
				: {
						ownsEvent: (type: string) => {
							seam.push(`owns?:${type}`);
							return path === 'v2';
						},
						dispatch: async (_type: string, event: BookEvent) => present('flow', event),
					},
		eventEmitter: { broadcast: () => {} },
		runBookEventPresentation: async (
			type: string,
			dispatch: () => Promise<void>,
			celebration?: boolean,
		) => {
			seam.push(`slam:${type}:${celebration}`);
			await dispatch();
		},
		startsCelebration: (event: BookEvent) => event.type === 'setWin',
		recordWinCycleWins: (event: BookEvent) => seam.push(`cycle:${event.type}`),
		forgetWinCycleWins: () => {},
		stopWinCycle: () => {},
		startWinCycle: async () => {},
		explodeSpinWinners: async () => {},
		explodeWinnersBeforeBoardChange: async (event: BookEvent) => {
			seam.push(`pop:${event.type}`);
		},
		bakedWinLineConfig: () => ({ line: { allAtOnce: true } }),
		winsOnThisBoard: (event: BookEvent) => [`wins:${event.type}`],
		showAllWinLines: async (wins: string[]) => {
			seam.push(`allLines:${wins.join()}`);
		},
		activeWinLevelData: (level: number) => (level === 3 ? BIG_WIN_TIER : undefined),
		cueBigWinCountUp: async ({
			amount,
			winLevelData,
		}: {
			amount: number;
			winLevelData?: { name: string };
		}) => {
			seam.push(`countUp:${amount}:${winLevelData?.name}`);
		},
		setPendingScatterAwardFs: () => {},
		holdAfterBigWin: async (event: BookEvent) => {
			seam.push(`holdAfter:${event.type}`);
		},
		clearSpinHold: () => {},
		trackCascadeStep: (event: BookEvent) => seam.push(`cascade:${event.type}`),
		recordBookEvent: (event: BookEvent) => seam.push(`record:${event.type}`),
	} as never);

	await playBet({ state: book() } as never);
	return { seam, driven, meterAtWinInfo, freeSpinsAdded: stateUi.freeSpinsAdded };
};

const none = await playRound('none');
const unowned = await playRound('unowned');
const v2 = await playRound('v2');

const count = (log: string[], prefix: string) => log.filter((e) => e.startsWith(prefix)).length;
const typesAfter = (log: string[], prefix: string) =>
	log.filter((e) => e.startsWith(prefix)).map((e) => e.slice(prefix.length).split(':')[0]);

// 1. no flow: every event crosses the seam, once.
check('no flow: the coded map presents every event, once', none.driven, TYPES.map((t) => `coded:${t}`)); // prettier-ignore
check('no flow: every event goes through the slam carve-out', typesAfter(none.seam, 'slam:'), TYPES); // prettier-ignore
check('no flow: …with the celebration flag the game answers', none.seam.includes('slam:setWin:true'), true); // prettier-ignore
check('no flow: every event records its round state, exactly once', typesAfter(none.seam, 'record:'), TYPES); // prettier-ignore
check('no flow: the win cycle sees every event', typesAfter(none.seam, 'cycle:'), TYPES);
check('no flow: the cascade sound step sees every event', typesAfter(none.seam, 'cascade:'), TYPES);
check(
	'no flow: per event, the carve-out opens before the state is recorded and the win cycle reads it',
	TYPES.every((t) => {
		const at = (entry: string) => none.seam.findIndex((e) => e.startsWith(entry));
		return at(`slam:${t}`) < at(`record:${t}`) && at(`record:${t}`) < at(`cycle:${t}`);
	}),
	true,
);

// 2. no flow: the per-round presentation.
check('no flow: the win meter has climbed to totalWin when winInfo is presented', none.meterAtWinInfo, 50); // prettier-ignore
check('no flow: the big win counts up from setWin, to its tier', none.seam.filter((e) => e.startsWith('countUp:')), ['countUp:50:bigWin']); // prettier-ignore
check('no flow: the all-at-once lines draw on the winInfo', none.seam.filter((e) => e.startsWith('allLines:')), ['allLines:wins:winInfo']); // prettier-ignore
check('no flow: a retrigger sets freeSpinsAdded', none.freeSpinsAdded, 4);
check('no flow: the per-spin pop and the between-spins hold still frame every event', [count(none.seam, 'pop:'), count(none.seam, 'holdAfter:')], [TYPES.length, TYPES.length]); // prettier-ignore

// 3. parity across the three paths.
check('non-owning v2 flow: the coded map presents every event', unowned.driven, TYPES.map((t) => `coded:${t}`)); // prettier-ignore
check('non-owning v2 flow: asked about every event, once', typesAfter(unowned.seam, 'owns?:'), TYPES); // prettier-ignore
check(
	'v2 flow: the flow presents every event',
	v2.driven,
	TYPES.map((t) => `flow:${t}`),
);
const withoutOwnership = (log: string[]) => log.filter((e) => !e.startsWith('owns?:'));
check('parity: no flow and a non-owning v2 flow cross the same seam, in the same order', none.seam, withoutOwnership(unowned.seam)); // prettier-ignore
check('parity: no flow and an owning v2 flow cross the same seam, in the same order', none.seam, withoutOwnership(v2.seam)); // prettier-ignore
check('parity: the meter, the retrigger count, the same on every path', [unowned.meterAtWinInfo, v2.meterAtWinInfo, unowned.freeSpinsAdded, v2.freeSpinsAdded], [50, 50, 4, 4]); // prettier-ignore

console.log(`${passes} play-book dispatch checks passed, ${failures} failed.`);
if (failures > 0) process.exit(1);
