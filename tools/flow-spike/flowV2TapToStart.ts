/**
 * Invisible Flow v2 — `onTapToStart` SIGNAL + music-start harness (the "Option B" fix).
 *
 *   pnpm --filter flow-spike run v2taptostart
 *
 * Proves, HEADLESSLY, the two halves of making the Game Signals `onTapToStart` pin live:
 *
 *   1. WIRING — a `gameSignals` node whose `tapToStart` exec-out wires into `fireCue soundMusic`
 *      with a `name: 'bgm_main'` literal (exactly what `apps/lines` `flowV2Doc.ts` authors). Firing
 *      `runFlowEvent(doc, ctx, 'tapToStart', {})` MUST broadcast `soundMusic { name: 'bgm_main' }`,
 *      and `flowOwnsSignal(doc, 'tapToStart')` MUST be true (so the app treats the flow as OWNING it).
 *
 *   2. ONCE-GUARD — the REAL `apps/lines` flow holder (`flowV2InterpreterHolder`, whose only imports
 *      are `import type`, so it runs standalone). With a v2 handle set, the FIRST tap-to-continue
 *      COMPLETE dispatches `tapToStart` exactly once; a SECOND complete does NOT re-fire it; and a
 *      fresh `setFlowV2` (a new session) re-arms the one-shot.
 *
 * A recording env logs every broadcast in order. Uses the REAL `book-of` vocabulary. Prints PASS/FAIL
 * per assertion + a final `V2 TAP-TO-START HARNESS: PASSED`.
 */

import {
	buildChoreo,
	createContainerMountModel,
	flowOwnsSignal,
	makeChoreoUid,
	runFlowEvent,
	str,
	BOOK_OF_VOCAB,
	type ContainerMountModel,
	type DataEdge,
	type ExecEdge,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type MountedContainer,
	type Node,
	type RunContext,
} from 'engine-flow-v2';

import {
	dispatchFlowV2Complete,
	setFlowV2,
} from '../../apps/lines/src/game/flowV2InterpreterHolder';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

// ---------------------------------------------------------------------------
// The FlowDoc — mirrors `flowV2Doc.ts`: one `gameSignals` node, its `tapToStart` exec-out wired into
// `fireCue soundMusic({ name: 'bgm_main' })`. A `loading` container so the holder's complete path
// (a held container → `mount.complete`) has something to release.
// ---------------------------------------------------------------------------

const nodes: Node[] = [];
const exec: ExecEdge[] = [];
const data: DataEdge[] = [];
const uid = makeChoreoUid();

const signalsId = 'game_signals';
nodes.push({ id: signalsId, kind: 'gameSignals', pos: { x: 0, y: 0 } });
const music = buildChoreo(
	[{ k: 'cue', ref: 'soundMusic', inputs: { name: str('bgm_main') } }],
	uid,
);
nodes.push(...music.nodes);
exec.push(...music.exec);
data.push(...music.data);
if (music.entry)
	exec.push({
		from: { node: signalsId, pin: 'tapToStart' },
		to: { node: music.entry, pin: 'exec' },
	});

const DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	containers: [{ id: 'loading', sceneId: 'loading', z: 100 }],
};

// ---------------------------------------------------------------------------
// A recording env + a real mount model. The env logs every broadcast so we can assert the
// music start; the mount model gives the holder a real container to complete.
// ---------------------------------------------------------------------------

const makeRuntime = () => {
	const log: string[] = [];
	const mount = createContainerMountModel(DOC.containers, () => {});
	const env: FlowV2Env = {
		async effect() {},
		async broadcast(cue, payload) {
			const extra = Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : '';
			log.push(`broadcast ${cue}${extra}`);
		},
		async waitForTimeout() {},
		timeScale: () => 1,
		showContainer(id, z) {
			mount.show(id);
			void z;
		},
		hideContainer(id) {
			mount.hide(id);
		},
		engineRead: () => undefined,
		awaitContainerComplete: (id) => mount.awaitComplete(id),
	};
	const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
	let dispatches = 0;
	// The MINIMAL `LinesFlowV2`-shaped handle the holder drives — `ownsEvent`/`dispatch`/`mount`/
	// `ordered` are the surface `dispatchFlowV2Complete` + `dispatchFlowV2Event` touch; the rest are
	// stubs (not exercised by this harness).
	const handle = {
		ownsEvent: (eventType: string) => flowOwnsSignal(DOC, eventType),
		dispatch: (eventName: string, payload: Record<string, unknown>) => {
			dispatches += 1;
			return runFlowEvent(DOC, ctx, eventName, payload);
		},
		mount,
		resolveScene: () => undefined,
		ordered: (): MountedContainer[] => mount.ordered(),
		ownsContainerEvent: () => false,
		dispatchContainerEvent: () => Promise.resolve(),
	};
	return { log, mount, handle, dispatchCount: () => dispatches };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const main = async () => {
	console.log('Invisible Flow v2 — onTapToStart signal + music-start harness\n');

	// --- 1. wiring: the flow OWNS tapToStart, and firing it starts bgm_main ---
	console.log('1. tapToStart is an owned signal; firing it broadcasts soundMusic(bgm_main):');
	{
		assert('flowOwnsSignal(tapToStart) is true', flowOwnsSignal(DOC, 'tapToStart'));
		assert('flowOwnsSignal(load) is false (this flow does not drive screens)', !flowOwnsSignal(DOC, 'load')); // prettier-ignore
		const { log, handle } = makeRuntime();
		await handle.dispatch('tapToStart', {});
		assert(
			'tapToStart → broadcast soundMusic {"name":"bgm_main"}',
			eq(log, ['broadcast soundMusic {"name":"bgm_main"}']),
			log.join(' | '),
		);
	}

	// --- 2. once-guard: first complete fires tapToStart once; second does not; new session re-arms ---
	console.log('\n2. the holder fires tapToStart EXACTLY ONCE per session on the first complete:');
	{
		const { log, mount, handle, dispatchCount } = makeRuntime();
		setFlowV2(handle as never);

		// Show + hold the loading screen (a `showContainer{awaitComplete}` on a real flow) so the
		// holder's complete path releases a hold and returns true.
		mount.show('loading');
		void (mount as ContainerMountModel).awaitComplete('loading');

		const first = await dispatchFlowV2Complete();
		await flush();
		assert('1st complete returns true (owned)', first === true);
		assert('1st complete → exactly one tapToStart dispatch', dispatchCount() === 1, `${dispatchCount()}`); // prettier-ignore
		assert(
			'1st complete → one soundMusic(bgm_main) broadcast',
			eq(log, ['broadcast soundMusic {"name":"bgm_main"}']),
			log.join(' | '),
		);

		// A SECOND tap-to-continue (e.g. a free-spin intro gate) must NOT re-fire tapToStart.
		void (mount as ContainerMountModel).awaitComplete('loading');
		const second = await dispatchFlowV2Complete();
		await flush();
		assert('2nd complete returns true (owned)', second === true);
		assert('2nd complete → still exactly one tapToStart dispatch', dispatchCount() === 1, `${dispatchCount()}`); // prettier-ignore
		assert(
			'2nd complete → no additional broadcast',
			eq(log, ['broadcast soundMusic {"name":"bgm_main"}']),
			log.join(' | '),
		);

		// A fresh session (re-`setFlowV2`) re-arms the one-shot.
		const next = makeRuntime();
		setFlowV2(next.handle as never);
		next.mount.show('loading');
		void (next.mount as ContainerMountModel).awaitComplete('loading');
		await dispatchFlowV2Complete();
		await flush();
		assert('new session re-arms → tapToStart fires again', next.dispatchCount() === 1, `${next.dispatchCount()}`); // prettier-ignore
	}

	// --- 3. parity: no v2 flow set ⇒ complete is a no-op (returns false, nothing dispatched) ---
	console.log('\n3. with no v2 flow set, a complete is a parity-safe no-op:');
	{
		setFlowV2(undefined);
		const owned = await dispatchFlowV2Complete();
		assert('dispatchFlowV2Complete() returns false when no flow is set', owned === false);
	}

	console.log(
		`\n${failed ? 'V2 TAP-TO-START HARNESS: FAILED' : 'V2 TAP-TO-START HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

void main();
