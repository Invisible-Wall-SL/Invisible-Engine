/**
 * Invisible Flow v2 — the cluster / scatter starter flows, PLAYED against the real mocks.
 *
 *   pnpm --filter flow-spike run v2cascadeseedplay
 *
 * Stands the REAL mock RGS up configured the way the Invisible Test Server deals a `cluster` and a
 * `scatter` project (cascade on as the game's mechanic; scatter with a multiplier symbol in play),
 * drives the REAL facade against it, and replays every round's book events through the starter
 * flow the way the runtime does: an event the seed owns runs through the interpreter, an event it
 * does not falls through to the coded handler (recorded here).
 *
 * Assertions, per kind:
 *   1. The seed boots: `load` → `complete:loading` leaves the game screens shown.
 *   2. Every book event the mock emits is declared by the kind's vocabulary (so the canvas can wire it).
 *   3. The rounds reach the cascade (`tumbleBoard`; scatter also `boardMultiplierInfo`) and a
 *      free-spin round (forced), so the owned free-spin chains run too.
 *   4. The cascade events FALL THROUGH (not owned) — the coded tumble re-seats the reel board on the
 *      cascade's result, which no flow accessor exposes.
 *   5. Every owned event's chain runs to completion without throwing, the free-spin intro holds once
 *      per `freeSpinTrigger` and the outro once per `freeSpinEnd`, and nothing the chains fire is
 *      outside the vocabulary. (The cluster mock on its 7x7 scaffold board retriggers a feature
 *      ~60 times and the facade then emits no `freeSpinEnd`, so the outro is proven on scatter.)
 *
 * Prints PASS/FAIL per assertion + a final `V2 CASCADE SEED PLAY: PASSED`.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
	BOOK_OF_DRIVEN_SEED_LIBRARY,
	CLUSTER_DRIVEN_SEED_DOC,
	SCATTER_DRIVEN_SEED_DOC,
	createContainerMountModel,
	createFlowV2Env,
	flowOwnsSignal,
	runFlowEvent,
	templateVocabulary,
	type FlowDoc,
	type RunContext,
} from 'engine-flow-v2';

import { createMockRgs } from '../../scripts/mock-rgs-server.mjs';
import {
	requestAuthenticate,
	requestBet,
} from '../../packages/rgs-translator-eagaming/src/engineFacade';

let failures = 0;
const check = (label: string, cond: boolean, detail = ''): void => {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? ` — ${detail}` : ''}`);
	if (!cond) failures += 1;
};

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

type BookEvent = { type: string; [key: string]: unknown };

const startMock = async (opts: Record<string, unknown>): Promise<Server> => {
	const mock = createMockRgs({ label: 'cascade-seed', ...opts });
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	return server;
};

const CASCADE_EVENTS = [
	'tumbleBoard',
	'updateTumbleWin',
	'updateGlobalMult',
	'boardMultiplierInfo',
];
const ROUNDS = 40;

const play = async (
	kind: 'cluster' | 'scatter',
	doc: FlowDoc,
	mockOpts: Record<string, unknown>,
	mustReach: string[],
): Promise<void> => {
	const vocab = templateVocabulary(doc.templateId);
	check(
		`${kind}: the seed runs the ${kind} vocabulary`,
		vocab.templateId === kind,
		vocab.templateId,
	);

	const declaredEvents = new Set(vocab.events.map((e) => e.name));
	const declaredSurfaces = new Set([...vocab.actions, ...vocab.cues].map((s) => s.name));
	const fired: string[] = [];
	const holds: string[] = [];
	const mount = createContainerMountModel(
		doc.containers.map((c) => ({ id: c.id, sceneId: c.sceneId, z: c.z })),
	);
	const env = createFlowV2Env({
		mount: {
			...mount,
			// The player taps every round-holding screen straight away.
			awaitComplete: async (id) => {
				holds.push(id);
			},
		},
		effect: (name) => () => {
			fired.push(name);
		},
		broadcast: (cue) => {
			fired.push(cue);
		},
		waitForTimeout: () => Promise.resolve(),
		timeScale: () => 1,
		engineRead: () => undefined,
	});
	const ctx: RunContext = { vocab, library: BOOK_OF_DRIVEN_SEED_LIBRARY, env };

	// 1. Boot.
	await runFlowEvent(doc, ctx, 'load', {});
	await runFlowEvent(doc, ctx, 'complete:loading', {});
	for (const id of ['basegame', 'hudBar', 'hudCorners', 'freeSpinCounter']) {
		check(`${kind}: after boot, ${id} is shown`, mount.isShown(id));
	}
	check(`${kind}: after boot, loading is hidden`, !mount.isShown('loading'));

	const server = await hush(() => startMock(mockOpts));
	// The last round is dealt by a mock forced into the free-spin feature, so the owned intro / outro
	// chains run.
	const forcedServer = await hush(() => startMock({ ...mockOpts, forceTrigger: true }));
	const owned = new Map<string, number>();
	const coded = new Map<string, number>();
	const thrown: string[] = [];
	const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
	let freeSpinRounds = 0;

	for (let i = 0; i < ROUNDS; i++) {
		const sessionID = `${kind}-seed-${i}`;
		const target = i === ROUNDS - 1 ? forcedServer : server;
		const rgsUrl = `localhost:${(target.address() as AddressInfo).port}`;
		const events = await hush(async () => {
			await requestAuthenticate({ sessionID, rgsUrl, language: 'en' });
			const bet = await requestBet({ sessionID, currency: 'EUR', amount: 1, mode: 'BASE', rgsUrl });
			return ((bet as { round?: { state?: BookEvent[] } })?.round?.state ?? []) as BookEvent[];
		});
		if (events.some((e) => e.type === 'freeSpinTrigger')) freeSpinRounds += 1;
		for (const event of events) {
			if (!flowOwnsSignal(doc, event.type)) {
				bump(coded, event.type);
				continue;
			}
			bump(owned, event.type);
			try {
				await runFlowEvent(doc, ctx, event.type, event, { bookEvents: events });
			} catch (err) {
				thrown.push(`${event.type}: ${(err as Error).message}`);
			}
		}
	}
	server.close();
	forcedServer.close();

	const emitted = [...owned.keys(), ...coded.keys()];
	console.log(`   ${kind} owned: ${[...owned].map(([k, n]) => `${k}×${n}`).join(' ')}`);
	console.log(`   ${kind} coded: ${[...coded].map(([k, n]) => `${k}×${n}`).join(' ')}`);

	// 2.
	const undeclared = emitted.filter((t) => !declaredEvents.has(t));
	check(
		`${kind}: every emitted book event is in the vocabulary`,
		!undeclared.length,
		undeclared.join(),
	);
	// 3.
	for (const t of mustReach) check(`${kind}: the mock emitted \`${t}\``, emitted.includes(t));
	check(`${kind}: a free-spin round was played`, freeSpinRounds > 0);
	// 4.
	for (const t of CASCADE_EVENTS) {
		check(`${kind}: \`${t}\` falls through to the coded handler`, !flowOwnsSignal(doc, t));
	}
	for (const t of [
		'reveal',
		'winInfo',
		'setTotalWin',
		'freeSpinTrigger',
		'updateFreeSpin',
		'freeSpinEnd',
	]) {
		check(`${kind}: the seed owns \`${t}\``, flowOwnsSignal(doc, t));
	}
	// 5.
	check(`${kind}: no owned chain threw`, !thrown.length, thrown.join(' | '));
	const heldOn = (id: string) => holds.filter((h) => h === id).length;
	check(
		`${kind}: the intro held once per \`freeSpinTrigger\`, the outro once per \`freeSpinEnd\``,
		heldOn('freeSpinIntro') === (owned.get('freeSpinTrigger') ?? 0) &&
			heldOn('freeSpinOutro') === (owned.get('freeSpinEnd') ?? 0),
		holds.join(),
	);
	const strays = [...new Set(fired)].filter((f) => !declaredSurfaces.has(f));
	check(
		`${kind}: everything the chains fired is a declared surface`,
		!strays.length,
		strays.join(),
	);
	check(`${kind}: the reveal chain ran the board`, fired.includes('revealBoard'));
};

// Configured as `services/test-server` `makeMock` deals each kind (cascade = the mechanic, not a
// demo); the board is each kind's scaffold shape.
await play(
	'cluster',
	CLUSTER_DRIVEN_SEED_DOC,
	{ winModel: 'cluster', cascade: true, cascadeDemo: false, reels: 7, rows: 7, paylines: [] },
	['reveal', 'winInfo', 'tumbleBoard'],
);
await play(
	'scatter',
	SCATTER_DRIVEN_SEED_DOC,
	{
		winModel: 'scatter',
		cascade: true,
		cascadeDemo: false,
		multiplier: true,
		reels: 6,
		rows: 5,
		paylines: [],
		minCount: 4,
	},
	['reveal', 'winInfo', 'tumbleBoard', 'boardMultiplierInfo', 'freeSpinEnd'],
);

console.log('');
if (failures === 0) console.log('V2 CASCADE SEED PLAY: PASSED');
else {
	console.log(`V2 CASCADE SEED PLAY: FAILED (${failures} assertion(s))`);
	process.exit(1);
}
