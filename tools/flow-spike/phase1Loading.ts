/**
 * Invisible Flow — Phase 1 loading-screen harness (flow-driven-game §1, §7).
 *
 *   pnpm --filter flow-spike run phase1
 *
 * Proves, HEADLESSLY and before the live game swap, the Phase-1 entry leg:
 * loading (tap to enter) → basegame, owned by the interpreter.
 *
 *  A. Fall-through parity (§7) — with NO FlowDoc the interpreter is inert: the `loading`
 *     active screen is NOT interpreter-owned (`mounter.has('loading')` is false, the mount
 *     decision is `fallThrough`), so the game keeps its coded `<LoadingScreen>` mount —
 *     byte-identical to current `main`. A FlowDoc that authors ONLY `basegame` (the default
 *     `LINES_FLOW_DOC` shape) likewise does NOT own `loading` — every normal boot.
 *
 *  B. Loading-owned advance — a FlowDoc authoring `loading` (initial) + a `complete` edge to
 *     `basegame` (the `LINES_FLOW_LOADING_DOC` shape): the interpreter STARTS on `loading`,
 *     the mounter OWNS `loading`, and a tap (`completeActiveScreen()` — the existing
 *     tap-to-continue hook) fires the `complete` edge and swaps `loading` → `basegame`. The
 *     swap runs the loading `exit` choreography then the basegame `enter` choreography IN
 *     ORDER (the §1 acceptance), and the active screen flips so the game re-mounts.
 *
 *  C. Mount handoff — while active on `loading` the mounter resolves `loading` (authored) and
 *     `basegame` falls through; after the swap, `basegame` resolves authored and `loading`
 *     still resolves authored (a backed screen), so the loading↔basegame mount split the
 *     game uses (`flowOwnsLoading` / `activeScreenId === 'loading'`) is well-defined.
 *
 * Drives the REAL engine-flow interpreter/mounter/HSM against a recording runtime, mirroring
 * the Phase-4 rig. Determinism: a virtual `waitForTimeout` (records the scaled ms).
 */

import {
	createFlowInterpreter,
	type ChoreographyNode,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Recording rig — logs broadcasts + delays so the swap's exit/enter order is observable.
// ---------------------------------------------------------------------------
type EmitterEvent = { type: string } & Record<string, unknown>;

const makeRig = (turbo: boolean) => {
	const log: string[] = [];
	const stableArgs = (e: EmitterEvent) => {
		const { type: _type, ...rest } = e;
		return Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
	};
	const runtime: FlowRuntime = {
		emitter: {
			broadcast: (e) => {
				log.push(`broadcast ${e.type}${stableArgs(e)}`);
			},
			broadcastAsync: (e) => {
				log.push(`broadcastAsync ${e.type}${stableArgs(e)}`);
				return Promise.resolve([]);
			},
		},
		timeScale: () => (turbo ? 2 : 1),
		waitForTimeout: (ms) => {
			log.push(`delay ${ms}`);
			return Promise.resolve();
		},
	};
	return { log, runtime };
};

const broadcast = (event: string): ChoreographyNode => ({ kind: 'broadcast', event });

// The `LINES_FLOW_LOADING_DOC` shape (apps/lines/src/game/flowDoc.ts): loading (initial) with
// an exit beat, a `complete` edge to basegame, and a basegame enter beat. Kept inline so the
// spike stays self-contained (flow-spike has no dependency on `apps/lines`).
const loadingDoc: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [
		{ id: 'loading', initial: true, choreography: { exit: broadcast('flowLoadingExit') } },
		{ id: 'basegame', choreography: { enter: broadcast('flowBasegameEnter') } },
	],
	transitions: [
		{ id: 'loading→basegame', from: 'loading', to: 'basegame', trigger: { kind: 'complete' } },
	],
};

// The default `LINES_FLOW_DOC` shape — authors ONLY basegame (no `loading` node), so it must
// NOT own loading (the §7 parity boot).
const basegameOnlyDoc: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [{ id: 'basegame', initial: true }],
	transitions: [],
};

// Backing LayoutDoc scenes — the lines reference layout's `loading` (canvas) + `basegame`.
const scenes: Record<string, MountableScene> = {
	loading: { id: 'loading', space: 'canvas' },
	basegame: { id: 'basegame', space: 'game' },
};
const resolveScene = (id: string): MountableScene | undefined => scenes[id];

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const main = async () => {
	console.log('Invisible Flow — Phase 1 loading-screen harness\n');

	// --- A. Fall-through parity (§7) — loading is NOT interpreter-owned by default ---
	console.log('A. Fall-through parity — coded loading mount stays (§7):');
	{
		// No FlowDoc ⇒ inert: no active screen, loading falls through to the coded mount.
		const { runtime } = makeRig(false);
		const inert = createFlowInterpreter({
			flowDoc: undefined,
			runtime,
			resolveScene,
			codedHandlers: {},
		});
		assert(
			'no FlowDoc ⇒ not active, no active screen',
			!inert.isActive && inert.activeScreenId === undefined,
		);
		assert(
			'no FlowDoc ⇒ loading is NOT interpreter-owned (mounter.has false)',
			!inert.mounter.has('loading'),
		);
		assert(
			'no FlowDoc ⇒ loading mount decision is fall-through (coded <LoadingScreen>)',
			inert.mounter.resolve('loading')?.kind === 'fallThrough',
		);

		// The default LINES_FLOW_DOC shape (only basegame authored) ALSO does not own loading.
		const { runtime: r2 } = makeRig(false);
		const basegameOnly = createFlowInterpreter({
			flowDoc: basegameOnlyDoc,
			runtime: r2,
			resolveScene,
			codedHandlers: {},
		});
		assert(
			'basegame-only doc ⇒ active on basegame, loading still NOT owned (coded splash)',
			basegameOnly.isActive &&
				basegameOnly.activeScreenId === 'basegame' &&
				!basegameOnly.mounter.has('loading') &&
				basegameOnly.mounter.resolve('loading')?.kind === 'fallThrough',
		);
	}

	// --- B. Loading-owned advance — interpreter starts on loading, tap swaps to basegame ---
	console.log('\nB. Loading-owned advance — start on loading, tap completes to basegame:');
	{
		const { log, runtime } = makeRig(false);
		const screenChanges: (string | undefined)[] = [];
		const interp = createFlowInterpreter({
			flowDoc: loadingDoc,
			runtime,
			resolveScene,
			onActiveScreenChange: (id) => screenChanges.push(id),
			codedHandlers: {},
		});

		assert('loading-doc ⇒ interpreter active', interp.isActive);
		assert(
			'interpreter STARTS on the `loading` initial screen',
			interp.activeScreenId === 'loading',
		);
		assert(
			'mounter OWNS loading (authored + backed) — interpreter mounts the splash scene',
			interp.mounter.has('loading') && interp.mounter.resolve('loading')?.kind === 'authored',
		);
		assert(
			'while on loading, basegame falls through (not yet active)',
			interp.mounter.resolve('basegame')?.kind === 'authored',
		);

		await interp.start();
		log.length = 0;

		// The tap-to-continue hook — `completeActiveScreen()` is exactly what
		// `TapToContinue.svelte` / the coded `<LoadingScreen>` `onloaded` shell call.
		const advanced = await interp.completeActiveScreen();
		assert(
			'tap (completeActiveScreen) fires the `complete` edge ⇒ loading → basegame',
			advanced && interp.activeScreenId === 'basegame',
		);
		assert(
			'swap ran loading `exit` then basegame `enter` choreography IN ORDER (§1)',
			eq(log, ['broadcast flowLoadingExit', 'broadcast flowBasegameEnter']),
		);
		assert(
			'onActiveScreenChange fired the loading → basegame swap (drives the game re-mount)',
			eq(screenChanges, ['basegame']),
		);

		// On basegame there is no complete edge ⇒ a further tap is a safe no-op (stays put).
		log.length = 0;
		const noEdge = await interp.completeActiveScreen();
		assert(
			'after swap, a further tap on basegame ⇒ no-op (no complete edge)',
			!noEdge && interp.activeScreenId === 'basegame' && log.length === 0,
		);
	}

	// --- C. Mount handoff — both screens remain backed/owned across the swap ---
	console.log('\nC. Mount handoff — loading↔basegame both resolve authored:');
	{
		const { runtime } = makeRig(false);
		const interp = createFlowInterpreter({
			flowDoc: loadingDoc,
			runtime,
			resolveScene,
			codedHandlers: {},
		});
		// Before the swap the active screen is loading; the game shows the splash while
		// `activeScreenId === 'loading'` and the basegame block once it flips.
		assert(
			'authored screen ids include both loading and basegame',
			eq([...interp.mounter.authoredScreenIds()].sort(), ['basegame', 'loading']),
		);
		assert(
			'both screens resolve to authored backing scenes (no blank mount)',
			interp.mounter.resolve('loading')?.kind === 'authored' &&
				interp.mounter.resolve('basegame')?.kind === 'authored',
		);
	}

	console.log(`\n${failed ? 'PHASE 1 HARNESS: FAILED' : 'PHASE 1 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
