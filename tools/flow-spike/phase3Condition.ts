/**
 * Invisible Flow — Phase 3 engine-state-condition harness (flow-driven-game §3, §7).
 *
 *   pnpm --filter flow-spike run phase3
 *
 * Proves, HEADLESSLY and against the REAL engine-flow interpreter/presentation over the REAL
 * `LINES_FLOW_COND_DOC` (imported from apps/lines), that the `condition` transition trigger —
 * DEAD before Phase 3 — is REVIVED by injecting a bounded `$engine.*` reader AND pinging
 * `interpreter.evaluate()`:
 *
 *  A. A `condition` edge guarded on `$engine.<key> <cmp> <value>` does NOT fire until the
 *     injected reader crosses the threshold AND `evaluate()` is pinged; it then DOES fire.
 *  B. With NO `engine` reader injected, the SAME edge can NEVER fire (`$engine.*` ⇒ `undefined`
 *     ⇒ guard false) — the pre-Phase-3 dead state, proving the reader is what revives it.
 *  C. Guard boundary correctness — `>= 1` arms exactly at 1, `< 1` returns exactly at 0.
 *  D. `evaluate()` with no matching `condition` edge (or a guard that does not hold) is a no-op
 *     (the parity-safe inert ping the Phase-1/2/4 fixtures rely on).
 *  E. A `bookEvent`/`complete` edge is UNAFFECTED by the engine reader (orthogonal triggers).
 *  F. Author `order`/guard precedence — among `condition` edges the first whose guard holds wins.
 *  G. Parity — the default `LINES_FLOW_DOC` authors ZERO `condition` edges (inert by default).
 *
 * The reader is HARNESS-controlled (a mutable `engineState` map) so the harness can cross the
 * threshold deterministically — exactly what the game's live `$effect` does when `stateUi`'s
 * free-spin counter changes. Determinism: a virtual `waitForTimeout` (records scaled ms).
 */

import { createEventEmitter } from 'utils-event-emitter';
import {
	createFlowInterpreter,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';

import { LINES_FLOW_COND_DOC, LINES_FLOW_DOC } from '../../apps/lines/src/game/flowDoc';

// ---------------------------------------------------------------------------
// Recording rig — ONE emitter routed through a log so swap-enter beats are observable.
// ---------------------------------------------------------------------------
type EmitterEvent = { type: string } & Record<string, unknown>;

const makeRig = (turbo: boolean) => {
	const log: string[] = [];
	const { eventEmitter } = createEventEmitter<EmitterEvent>();
	const recording = {
		broadcast: (e: EmitterEvent) => {
			log.push(`broadcast ${e.type}`);
			eventEmitter.broadcast(e);
		},
		broadcastAsync: (e: EmitterEvent) => {
			log.push(`broadcastAsync ${e.type}`);
			return eventEmitter.broadcastAsync(e);
		},
	};
	const runtime: FlowRuntime = {
		emitter: recording,
		timeScale: () => (turbo ? 2 : 1),
		waitForTimeout: (ms) => {
			log.push(`delay ${ms}`);
			return Promise.resolve();
		},
		effect: () => undefined,
	};
	return { log, runtime };
};

const scenes: Record<string, MountableScene> = {
	basegame: { id: 'basegame', space: 'game' },
	freeGame: { id: 'freeGame', space: 'canvas' },
};

const CONTEXT = { bookEvents: [] as unknown[] };

/** Build the interpreter over a doc with an OPTIONAL engine reader over a mutable state map.
 *  `engineState` mirrors the live engine values the game's `linesEngineReader` exposes. */
const makeInterp = (
	doc: FlowDoc,
	rig: ReturnType<typeof makeRig>,
	changes: (string | undefined)[],
	engineState?: Record<string, unknown>,
) =>
	createFlowInterpreter<{ type: string }, { bookEvents: unknown[] }>({
		flowDoc: doc,
		runtime: rig.runtime,
		resolveScene: (id) => scenes[id],
		onActiveScreenChange: (id) => changes.push(id),
		codedHandlers: {},
		// The bounded reader — closed key→value over the harness state. Absent ⇒ the pre-Phase-3
		// dead state (a `$engine.*` accessor resolves `undefined`).
		engine: engineState ? (key) => engineState[key] : undefined,
	});

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const eqJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const main = async () => {
	console.log('Invisible Flow — Phase 3 engine-state-condition harness\n');

	for (const turbo of [false, true]) {
		const tag = `turbo ${turbo ? 'ON' : 'OFF'}`;

		// --- A. condition does NOT fire until the reader crosses + evaluate() is pinged ---
		console.log(`A. condition fires only after reader crosses AND evaluate() pinged (${tag}):`);
		{
			const rig = makeRig(turbo);
			const changes: (string | undefined)[] = [];
			const engineState: Record<string, unknown> = { freeSpinsRemaining: 0 };
			const interp = makeInterp(LINES_FLOW_COND_DOC, rig, changes, engineState);
			await interp.start();

			// Pinging evaluate() BEFORE the threshold is crossed ⇒ no swap (guard false).
			const firedEarly = await interp.evaluate();
			await settle();
			assert(
				`evaluate() with freeSpinsRemaining=0 ⇒ NO swap, stays basegame (${tag})`,
				!firedEarly && interp.activeScreenId === 'basegame' && changes.length === 0,
			);

			// Cross the threshold but DON'T ping ⇒ still no swap (evaluate is the trigger).
			engineState.freeSpinsRemaining = 5;
			assert(
				`crossing threshold WITHOUT evaluate() ⇒ still basegame (evaluate is the trigger) (${tag})`,
				interp.activeScreenId === 'basegame',
			);

			// Now ping ⇒ the condition fires.
			const fired = await interp.evaluate();
			await settle();
			assert(
				`evaluate() with freeSpinsRemaining=5 ⇒ swaps basegame → freeGame (${tag})`,
				fired && interp.activeScreenId === 'freeGame' && eqJson(changes, ['freeGame']),
			);
			assert(
				`freeGame.enter beat ran on the swap (${tag})`,
				rig.log.includes('broadcast flowFreeGameEnter'),
			);

			// The complementary return: counter runs out ⇒ condition returns to basegame.
			changes.length = 0;
			engineState.freeSpinsRemaining = 0;
			const returned = await interp.evaluate();
			await settle();
			assert(
				`evaluate() with freeSpinsRemaining=0 from freeGame ⇒ returns → basegame (${tag})`,
				returned && interp.activeScreenId === 'basegame' && eqJson(changes, ['basegame']),
			);
		}

		// --- B. NO reader injected ⇒ the edge can NEVER fire (pre-Phase-3 dead state) ---
		console.log(`B. NO engine reader ⇒ $engine.* is undefined ⇒ condition never fires (${tag}):`);
		{
			const rig = makeRig(turbo);
			const changes: (string | undefined)[] = [];
			// engineState omitted ⇒ no reader injected.
			const interp = makeInterp(LINES_FLOW_COND_DOC, rig, changes);
			await interp.start();
			const fired = await interp.evaluate();
			await settle();
			assert(
				`no reader ⇒ evaluate() never swaps (the dead state the reader revives) (${tag})`,
				!fired && interp.activeScreenId === 'basegame' && changes.length === 0,
			);
		}

		// --- C. Guard boundary correctness (gte 1 arms at 1; lt 1 returns at 0) ---
		console.log(`C. guard boundary — gte 1 arms at exactly 1, not below (${tag}):`);
		{
			const rig = makeRig(turbo);
			const engineState: Record<string, unknown> = { freeSpinsRemaining: 0 };
			const interp = makeInterp(LINES_FLOW_COND_DOC, rig, [], engineState);
			await interp.start();

			engineState.freeSpinsRemaining = 0.5; // below the integer threshold but > 0
			await interp.evaluate();
			await settle();
			assert(
				`freeSpinsRemaining=0.5 (< 1) ⇒ stays basegame (gte 1 not satisfied) (${tag})`,
				interp.activeScreenId === 'basegame',
			);

			engineState.freeSpinsRemaining = 1; // exactly the threshold
			await interp.evaluate();
			await settle();
			assert(
				`freeSpinsRemaining=1 (== 1) ⇒ swaps to freeGame (gte 1 satisfied at boundary) (${tag})`,
				interp.activeScreenId === 'freeGame',
			);
		}

		// --- D. evaluate() is a no-op when no condition edge matches (parity-safe inert ping) ---
		console.log(`D. evaluate() is a no-op for a doc with no condition edge (${tag}):`);
		{
			const rig = makeRig(turbo);
			const changes: (string | undefined)[] = [];
			// The default doc (basegame only, zero transitions) — evaluate() must be inert.
			const interp = makeInterp(LINES_FLOW_DOC, rig, changes, { freeSpinsRemaining: 99 });
			await interp.start();
			rig.log.length = 0;
			const fired = await interp.evaluate();
			await settle();
			assert(
				`evaluate() on the default doc ⇒ false, no swap, no beats (parity-safe) (${tag})`,
				!fired && interp.activeScreenId === 'basegame' && changes.length === 0 && rig.log.length === 0,
			);
		}

		// --- E. a bookEvent edge is UNAFFECTED by the engine reader (orthogonal triggers) ---
		console.log(`E. bookEvent / complete triggers unaffected by the engine reader (${tag}):`);
		{
			// A tiny doc with a bookEvent edge AND a condition edge; the bookEvent edge must fire on
			// the event regardless of the engine state, and a complete edge on a tap.
			const doc: FlowDoc = {
				version: 1,
				projectKey: 'lines',
				screens: [
					{ id: 'a', initial: true },
					{ id: 'b' },
					{ id: 'c' },
				],
				transitions: [
					{ id: 'a→b', from: 'a', to: 'b', trigger: { kind: 'bookEvent', event: 'go' } },
					{
						id: 'b→c',
						from: 'b',
						to: 'c',
						trigger: { kind: 'condition' },
						guard: { all: [{ left: { kind: 'engine', key: 'k' }, op: 'eq', right: { kind: 'literal', value: 1 } }] },
					},
				],
				events: [],
			};
			const rig = makeRig(turbo);
			const changes: (string | undefined)[] = [];
			const engineState: Record<string, unknown> = { k: 0 };
			const interp = makeInterp(doc, rig, changes, engineState);
			await interp.start();

			await interp.dispatchBookEvent({ type: 'go' }, CONTEXT);
			await settle();
			assert(
				`bookEvent edge fires on the event irrespective of engine state (${tag})`,
				interp.activeScreenId === 'b',
			);

			// On 'b' the condition edge needs k===1; evaluate with k=0 ⇒ no fire, k=1 ⇒ fire.
			await interp.evaluate();
			await settle();
			assert(`condition stays put while k=0 (${tag})`, interp.activeScreenId === 'b');
			engineState.k = 1;
			await interp.evaluate();
			await settle();
			assert(`condition fires once k=1 (${tag})`, interp.activeScreenId === 'c');
		}

		// --- F. author order / guard precedence among condition edges ---
		console.log(`F. condition edges respect author order — first holding guard wins (${tag}):`);
		{
			const doc: FlowDoc = {
				version: 1,
				projectKey: 'lines',
				screens: [{ id: 'a', initial: true }, { id: 'low' }, { id: 'high' }],
				transitions: [
					// order 1 (low) BEFORE order 2 (high). With v >= 1 BOTH guards hold; order picks low.
					{
						id: 'a→high',
						from: 'a',
						to: 'high',
						order: 2,
						trigger: { kind: 'condition' },
						guard: { all: [{ left: { kind: 'engine', key: 'v' }, op: 'gte', right: { kind: 'literal', value: 1 } }] },
					},
					{
						id: 'a→low',
						from: 'a',
						to: 'low',
						order: 1,
						trigger: { kind: 'condition' },
						guard: { all: [{ left: { kind: 'engine', key: 'v' }, op: 'gte', right: { kind: 'literal', value: 1 } }] },
					},
				],
				events: [],
			};
			const rig = makeRig(turbo);
			const changes: (string | undefined)[] = [];
			const interp = makeInterp(doc, rig, changes, { v: 5 });
			await interp.start();
			await interp.evaluate();
			await settle();
			assert(
				`both guards hold ⇒ lower author order (low) wins (${tag})`,
				interp.activeScreenId === 'low' && eqJson(changes, ['low']),
			);
		}
	}

	// --- G. Parity (turbo-independent) ---
	console.log('\nG. Parity — default doc authors zero condition edges:');
	{
		assert(
			'default LINES_FLOW_DOC authors ZERO transitions (condition branch inert by default, §7)',
			LINES_FLOW_DOC.transitions.length === 0,
		);
		const condEdges = LINES_FLOW_COND_DOC.transitions.filter((t) => t.trigger.kind === 'condition');
		assert(
			'LINES_FLOW_COND_DOC authors exactly 2 condition edges (basegame↔freeGame)',
			condEdges.length === 2,
		);
		// Both condition guards read an $engine.* accessor (the revived path) — not $trigger.*.
		const allEngineGuarded = condEdges.every((t) =>
			t.guard?.all.every((p) => p.left.kind === 'engine' || p.right.kind === 'engine'),
		);
		assert('every condition edge guards on an $engine.* accessor', allEngineGuarded);
	}

	console.log(`\n${failed ? 'PHASE 3 HARNESS: FAILED' : 'PHASE 3 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
