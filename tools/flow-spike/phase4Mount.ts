/**
 * Invisible Flow — Phase 4 generic active-screen-takeover harness (flow-driven-game §4, §7).
 *
 *   pnpm --filter flow-spike run phase4mount
 *
 * Proves, HEADLESSLY and before the live game swap, that the Flow interpreter can make ANY
 * authored screen the active EXCLUSIVE screen — not just `basegame` — via a single GENERIC
 * mount path in `Game.svelte` (`activeScreenTakeover`), preserving the §7 fall-through. The
 * takeover layer (the game's `activeScreenTakeover` derived) mounts a scene exactly when the
 * mounter resolves the active screen to `authored` AND it is NEITHER `basegame` NOR `loading`
 * (those keep their own paths). So this harness mirrors that decision against the REAL
 * `createSceneMounter`/interpreter over a fixture whose backing LayoutDoc HAS `bigWin`,
 * `freeSpinIntro`, `loading`, `basegame` scenes.
 *
 *  A. Takeover mounts for a non-basegame authored active screen — swap to `bigWin` resolves
 *     `authored` with its backing scene (the game mounts it as the top-layer takeover); on the
 *     swap back to `basegame` it resolves `basegame` (the takeover unmounts, base persists).
 *  B. The takeover gate (`!basegame && !loading && authored`) is the SAME rule the game uses —
 *     basegame/loading are EXCLUDED from the takeover even though authored (their own paths).
 *  C. Fall-through parity (§7) — a non-authored id, or an authored id with no backing scene,
 *     resolves `fallThrough` ⇒ NOTHING extra mounts; no FlowDoc ⇒ the interpreter is inert.
 *  D. Reservation — `authoredScreenIds()` includes the takeover ids, so the §20.1 overlay
 *     mounter (`extraMountScenes`, which reserves `authoredScreenIds()`) never double-mounts
 *     a Flow-owned takeover screen.
 *  E. No regression — basegame still resolves to its (reel-split) authored mount; loading still
 *     resolves authored via its Phase-1 path; neither is treated as a takeover.
 *
 * Drives the REAL engine-flow interpreter/mounter/HSM against a recording runtime, mirroring
 * the Phase-1/2 rigs.
 */

import {
	createFlowInterpreter,
	type ChoreographyNode,
	type FlowDoc,
	type FlowRuntime,
	type MountableScene,
	type SceneMounter,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Recording rig — same effect surface as the Phase-1 rig (logs broadcasts + delays).
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

// A fixture mirroring the LINES_FLOW_WIN_DOC shape (basegame + bigWin + freeSpinIntro), PLUS a
// `loading` entry leg — so the harness exercises ALL four kinds of active screen the game
// distinguishes: loading (splash, own path), basegame (reel-split base), and the two
// takeovers. Each takeover swaps OUT of basegame on a bookEvent and returns via `complete`.
const takeoverDoc: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [
		{ id: 'loading', initial: true, choreography: { exit: broadcast('flowLoadingExit') } },
		{ id: 'basegame', choreography: { enter: broadcast('flowBasegameEnter') } },
		{ id: 'bigWin', choreography: { enter: broadcast('flowBigWinEnter') } },
		{ id: 'freeSpinIntro', choreography: { enter: broadcast('flowFreeSpinIntroEnter') } },
	],
	transitions: [
		{ id: 'loading→basegame', from: 'loading', to: 'basegame', trigger: { kind: 'complete' } },
		{
			id: 'basegame→bigWin',
			from: 'basegame',
			to: 'bigWin',
			trigger: { kind: 'bookEvent', event: 'setWin' },
		},
		{ id: 'bigWin→basegame', from: 'bigWin', to: 'basegame', trigger: { kind: 'complete' } },
		{
			id: 'basegame→freeSpinIntro',
			from: 'basegame',
			to: 'freeSpinIntro',
			trigger: { kind: 'bookEvent', event: 'freeSpinTrigger' },
		},
		{
			id: 'freeSpinIntro→basegame',
			from: 'freeSpinIntro',
			to: 'basegame',
			trigger: { kind: 'complete' },
		},
	],
};

// A doc that authors `bigWin` as a screen but whose backing LayoutDoc has NO `bigWin` scene —
// to prove an authored-but-unbacked screen falls through (parity, nothing extra mounts).
const unbackedDoc: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [
		{ id: 'basegame', initial: true },
		{ id: 'bigWin' },
	],
	transitions: [
		{
			id: 'basegame→bigWin',
			from: 'basegame',
			to: 'bigWin',
			trigger: { kind: 'bookEvent', event: 'setWin' },
		},
	],
};

// Backing LayoutDoc scenes — the win takeovers + the persistent base + the splash. Note the
// `bigWin`/`freeSpinIntro` scenes are `canvas`-space top-layer celebration overlays.
const scenes: Record<string, MountableScene> = {
	loading: { id: 'loading', space: 'canvas' },
	basegame: { id: 'basegame', space: 'game' },
	bigWin: { id: 'bigWin', space: 'canvas' },
	freeSpinIntro: { id: 'freeSpinIntro', space: 'canvas' },
};
const resolveScene = (id: string): MountableScene | undefined => scenes[id];
// The unbacked doc resolves NO `bigWin` scene (only base) — the fall-through case.
const resolveBackedBaseOnly = (id: string): MountableScene | undefined =>
	id === 'basegame' ? scenes.basegame : id === 'loading' ? scenes.loading : undefined;

// ---------------------------------------------------------------------------
// The game's takeover-mount DECISION, replicated EXACTLY from Game.svelte's
// `activeScreenTakeover` derived (so the harness asserts the real game rule).
// ---------------------------------------------------------------------------
const takeoverMount = (
	mounter: SceneMounter,
	activeScreenId: string | undefined,
): MountableScene | undefined => {
	if (activeScreenId === 'basegame' || activeScreenId === 'loading') return undefined;
	const decision = mounter.resolve(activeScreenId);
	return decision?.kind === 'authored' ? (decision.scene as MountableScene) : undefined;
};

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
	console.log('Invisible Flow — Phase 4 generic active-screen-takeover harness\n');

	// --- A. Takeover mounts for a non-basegame authored active screen ---
	console.log('A. Takeover mount — swap to bigWin/freeSpinIntro mounts the top layer:');
	{
		const { runtime } = makeRig(false);
		const interp = createFlowInterpreter({
			flowDoc: takeoverDoc,
			runtime,
			resolveScene,
			codedHandlers: {},
		});
		await interp.start();
		// Tap through loading → basegame so we're on the persistent base before the win swap.
		await interp.completeActiveScreen();
		assert('on basegame ⇒ NO takeover mounts (base is the reel-split path)', interp.activeScreenId === 'basegame' && takeoverMount(interp.mounter, interp.activeScreenId) === undefined);

		// A big win swaps to the bigWin takeover.
		await interp.dispatchBookEvent({ type: 'setWin', winLevel: 6 } as never, {} as never);
		assert('big win ⇒ active screen is bigWin', interp.activeScreenId === 'bigWin');
		const bigWinMount = takeoverMount(interp.mounter, interp.activeScreenId);
		assert('bigWin active ⇒ takeover mounts its backing scene (top layer)', bigWinMount?.id === 'bigWin');

		// Tap returns to basegame ⇒ the takeover unmounts, the base persists.
		await interp.completeActiveScreen();
		assert('tap returns bigWin → basegame ⇒ takeover UNMOUNTS (base persists)', interp.activeScreenId === 'basegame' && takeoverMount(interp.mounter, interp.activeScreenId) === undefined);

		// A free-spin trigger swaps to the freeSpinIntro takeover.
		await interp.dispatchBookEvent({ type: 'freeSpinTrigger', totalFs: 10 } as never, {} as never);
		assert('free-spin trigger ⇒ active screen is freeSpinIntro', interp.activeScreenId === 'freeSpinIntro');
		assert('freeSpinIntro active ⇒ takeover mounts its backing scene', takeoverMount(interp.mounter, interp.activeScreenId)?.id === 'freeSpinIntro');
		await interp.completeActiveScreen();
		assert('tap returns freeSpinIntro → basegame ⇒ takeover unmounts', interp.activeScreenId === 'basegame' && takeoverMount(interp.mounter, interp.activeScreenId) === undefined);
	}

	// --- B. The takeover gate excludes basegame/loading even though authored ---
	console.log('\nB. Takeover gate — basegame/loading are NOT takeovers (own paths):');
	{
		const { runtime } = makeRig(false);
		const interp = createFlowInterpreter({
			flowDoc: takeoverDoc,
			runtime,
			resolveScene,
			codedHandlers: {},
		});
		// loading is the initial active screen and is authored+backed, but is NOT a takeover.
		assert('loading active ⇒ NOT a takeover (own Phase-1 splash path)', interp.activeScreenId === 'loading' && takeoverMount(interp.mounter, interp.activeScreenId) === undefined);
		assert('loading still resolves authored (Phase-1 mounter path unregressed)', interp.mounter.resolve('loading')?.kind === 'authored');
		// basegame is authored+backed but is the reel-split base, NOT a takeover.
		assert('basegame ⇒ NOT a takeover even though authored (reel-split base)', takeoverMount(interp.mounter, 'basegame') === undefined);
		assert('basegame still resolves authored (reel-split mount path unregressed)', interp.mounter.resolve('basegame')?.kind === 'authored');
		// A genuine takeover id IS gated in.
		assert('bigWin ⇒ IS a takeover (authored, not base/loading)', takeoverMount(interp.mounter, 'bigWin')?.id === 'bigWin');
	}

	// --- C. Fall-through parity (§7) — unbacked / non-authored / no-doc ⇒ nothing extra mounts ---
	console.log('\nC. Fall-through parity — unbacked/non-authored/no-doc mounts nothing:');
	{
		// No FlowDoc ⇒ inert: no active screen, takeover undefined.
		const { runtime } = makeRig(false);
		const inert = createFlowInterpreter({ flowDoc: undefined, runtime, resolveScene, codedHandlers: {} });
		assert('no FlowDoc ⇒ inert, takeover undefined (parity)', !inert.isActive && takeoverMount(inert.mounter, inert.activeScreenId) === undefined);

		// Authored `bigWin` but NO backing scene ⇒ resolves fallThrough ⇒ no takeover.
		const { runtime: r2 } = makeRig(false);
		const unbacked = createFlowInterpreter({
			flowDoc: unbackedDoc,
			runtime: r2,
			resolveScene: resolveBackedBaseOnly,
			codedHandlers: {},
		});
		await unbacked.start();
		await unbacked.dispatchBookEvent({ type: 'setWin', winLevel: 6 } as never, {} as never);
		assert('authored-but-unbacked bigWin ⇒ active screen is bigWin', unbacked.activeScreenId === 'bigWin');
		assert('authored-but-unbacked bigWin ⇒ resolves fallThrough (no backing scene)', unbacked.mounter.resolve('bigWin')?.kind === 'fallThrough');
		assert('authored-but-unbacked bigWin ⇒ takeover mounts NOTHING (parity, §7)', takeoverMount(unbacked.mounter, unbacked.activeScreenId) === undefined);

		// A non-authored id ⇒ fallThrough ⇒ no takeover.
		assert('non-authored id ⇒ resolves fallThrough', unbacked.mounter.resolve('somethingElse')?.kind === 'fallThrough');
		assert('non-authored id ⇒ takeover mounts nothing', takeoverMount(unbacked.mounter, 'somethingElse') === undefined);
	}

	// --- D. Reservation — authoredScreenIds includes the takeover ids ---
	console.log('\nD. Reservation — takeover ids are reserved from the §20.1 overlay mounter:');
	{
		const { runtime } = makeRig(false);
		const interp = createFlowInterpreter({ flowDoc: takeoverDoc, runtime, resolveScene, codedHandlers: {} });
		const ids = [...interp.mounter.authoredScreenIds()].sort();
		assert('authoredScreenIds() = all authored screens (incl. the takeovers)', eq(ids, ['basegame', 'bigWin', 'freeSpinIntro', 'loading']));
		assert('bigWin + freeSpinIntro are reserved (overlay mounter skips them ⇒ no double-mount)', interp.mounter.authoredScreenIds().has('bigWin') && interp.mounter.authoredScreenIds().has('freeSpinIntro'));
	}

	// --- E. No regression — basegame reel-split + loading splash paths intact ---
	console.log('\nE. No regression — basegame/loading resolve through their own paths:');
	{
		const { runtime } = makeRig(false);
		const interp = createFlowInterpreter({ flowDoc: takeoverDoc, runtime, resolveScene, codedHandlers: {} });
		assert('basegame resolves authored with its game-space backing scene (reel-split input)', interp.mounter.resolve('basegame')?.kind === 'authored' && (interp.mounter.resolve('basegame') as { scene: MountableScene }).scene.space === 'game');
		assert('loading resolves authored with its canvas-space backing scene (Phase-1 input)', interp.mounter.resolve('loading')?.kind === 'authored' && (interp.mounter.resolve('loading') as { scene: MountableScene }).scene.space === 'canvas');
	}

	console.log(`\n${failed ? 'PHASE 4 MOUNT HARNESS: FAILED' : 'PHASE 4 MOUNT HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
