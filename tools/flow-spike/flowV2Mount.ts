/**
 * Invisible Flow v2 — Phase 4b MOUNT + ENV harness.
 *
 *   pnpm --filter flow-spike run v2mount
 *
 * Proves, HEADLESSLY, the Phase-4b engine seam that lets a v2 flow drive pixels:
 *   1. the z-ordered container MOUNT MODEL (`createContainerMountModel`) — show/hide ordering
 *      (base under overlays), unknown-id + redundant-op no-ops, and the `onChange` mirror;
 *   2. the `FlowV2Env` FACTORY (`createFlowV2Env`) wired end-to-end through the REAL interpreter
 *      (`runFlowEvent`) — an authored flow's `action`/`fireCue`/`showContainer`/`hideContainer`/
 *      `$engine` read each reach the right injected sink, and show/hide land in the mount model.
 *
 * This is the game-integration contract with the game replaced by fakes: if this passes, the only
 * thing left for a real game is to wire its own emitter/effects/turbo + render the mounted list.
 *
 * Prints PASS/FAIL per assertion + a final `V2 MOUNT HARNESS: PASSED`.
 */

import {
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	type ContainerRef,
	type FlowDoc,
	type FlowV2Effect,
	type FunctionLibraryDoc,
	type MountedContainer,
	type RunContext,
	type TemplateVocabulary,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const ids = (list: MountedContainer[]): string[] => list.map((c) => c.id);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The containers a flow declares (custom z-order; base underneath, overlays on top).
const CONTAINERS: ContainerRef[] = [
	{ id: 'base', sceneId: 'basegame', z: 0 },
	{ id: 'overlay', sceneId: 'winOverlay', z: 50 },
	{ id: 'hud', sceneId: 'hudBar', z: 100 },
];

const EMPTY_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

const VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [],
	enums: [],
	events: [
		{ name: 'boot', payload: [] },
		{ name: 'openOverlay', payload: [] },
		{ name: 'closeOverlay', payload: [{ name: 'symbol', type: { t: 'string' } }] },
	],
	actions: [
		{ name: 'setThing', params: [{ name: 'symbol', type: { t: 'string' } }], category: 'effect' },
	],
	cues: [{ name: 'ping', payload: [] }],
	collections: [],
};

const main = async () => {
	console.log('Invisible Flow v2 — Phase 4b mount + env harness\n');

	// --- 1. the mount model: z-ordering, no-ops, onChange mirror ---
	console.log('1. container mount model — z-ordering + no-op guards + onChange:');
	{
		const notified: string[][] = [];
		const model = createContainerMountModel(CONTAINERS, (o) => notified.push(ids(o)));

		model.show('overlay'); // out-of-order show...
		model.show('base');
		model.show('hud');
		assert(
			'ordered by z ASC regardless of show order (base < overlay < hud)',
			eq(ids(model.ordered()), ['base', 'overlay', 'hud']),
			ids(model.ordered()).join(','),
		);

		model.show('overlay'); // redundant show — no set change.
		model.show('nope'); // unknown id — no-op.
		assert(
			'redundant/unknown show does not churn onChange',
			notified.length === 3,
			`${notified.length}`,
		);

		model.hide('overlay');
		assert(
			'hide removes only that container (base + hud remain, order kept)',
			eq(ids(model.ordered()), ['base', 'hud']),
			ids(model.ordered()).join(','),
		);
		assert('isShown reflects hide', !model.isShown('overlay') && model.isShown('base'));

		model.hide('overlay'); // already hidden — no-op.
		assert('redundant hide does not churn onChange', notified.length === 4, `${notified.length}`);
		assert(
			'onChange delivered each real change, each list z-sorted (overlay, +base, +hud, -overlay)',
			eq(notified, [['overlay'], ['base', 'overlay'], ['base', 'overlay', 'hud'], ['base', 'hud']]),
			JSON.stringify(notified),
		);
	}

	// --- 2. the env factory, driven through the REAL interpreter ---
	console.log('\n2. createFlowV2Env end-to-end via runFlowEvent — every node reaches its sink:');
	{
		// event boot → show base → show hud.
		// event openOverlay → show overlay → fireCue ping.
		// event closeOverlay(symbol) → action setThing(symbol) → hide overlay.
		const doc: FlowDoc = {
			version: 2,
			templateId: 'book-of',
			graph: {
				nodes: [
					{ id: 'onBoot', kind: 'event', pos: { x: 0, y: 0 }, ref: 'boot' },
					{ id: 'showBase', kind: 'showContainer', pos: { x: 200, y: 0 }, ref: 'base' },
					{ id: 'showHud', kind: 'showContainer', pos: { x: 400, y: 0 }, ref: 'hud' },

					{ id: 'onOpen', kind: 'event', pos: { x: 0, y: 200 }, ref: 'openOverlay' },
					{ id: 'showOv', kind: 'showContainer', pos: { x: 200, y: 200 }, ref: 'overlay' },
					{ id: 'ping', kind: 'fireCue', pos: { x: 400, y: 200 }, ref: 'ping' },

					{ id: 'onClose', kind: 'event', pos: { x: 0, y: 400 }, ref: 'closeOverlay' },
					{
						id: 'setThing',
						kind: 'action',
						pos: { x: 200, y: 400 },
						ref: 'setThing',
						inputs: { symbol: { kind: 'accessor', path: { on: 'engine', key: 'liveSymbol' } } },
					},
					{ id: 'hideOv', kind: 'hideContainer', pos: { x: 400, y: 400 }, ref: 'overlay' },
				],
				exec: [
					{ from: { node: 'onBoot', pin: 'exec' }, to: { node: 'showBase', pin: 'exec' } },
					{ from: { node: 'showBase', pin: 'exec' }, to: { node: 'showHud', pin: 'exec' } },
					{ from: { node: 'onOpen', pin: 'exec' }, to: { node: 'showOv', pin: 'exec' } },
					{ from: { node: 'showOv', pin: 'exec' }, to: { node: 'ping', pin: 'exec' } },
					{ from: { node: 'onClose', pin: 'exec' }, to: { node: 'setThing', pin: 'exec' } },
					{ from: { node: 'setThing', pin: 'exec' }, to: { node: 'hideOv', pin: 'exec' } },
				],
				data: [],
			},
			containers: CONTAINERS,
		};

		// Fakes standing in for the game's real primitives.
		const effects: string[] = [];
		const cues: string[] = [];
		const effectRegistry: Record<string, FlowV2Effect> = {
			setThing: (payload) => void effects.push(`setThing(${JSON.stringify(payload)})`),
		};
		const model = createContainerMountModel(doc.containers);
		const env = createFlowV2Env({
			mount: model,
			effect: (name) => effectRegistry[name],
			broadcast: (cue) => void cues.push(cue),
			waitForTimeout: () => Promise.resolve(),
			timeScale: () => 1,
			engineRead: (key) => (key === 'liveSymbol' ? 'H1' : undefined),
		});
		const ctx: RunContext = { vocab: VOCAB, library: EMPTY_LIBRARY, env };

		await runFlowEvent(doc, ctx, 'boot', {});
		assert('boot → base + hud mounted', eq(ids(model.ordered()), ['base', 'hud']));

		await runFlowEvent(doc, ctx, 'openOverlay', {});
		assert(
			'openOverlay → overlay mounted between base and hud (by z)',
			eq(ids(model.ordered()), ['base', 'overlay', 'hud']),
			ids(model.ordered()).join(','),
		);
		assert('openOverlay → fireCue reached the broadcast sink', eq(cues, ['ping']));

		await runFlowEvent(doc, ctx, 'closeOverlay', { symbol: 'IGNORED' });
		assert(
			'closeOverlay → action ran with the $engine-read payload (liveSymbol=H1)',
			eq(effects, ['setThing({"symbol":"H1"})']),
			effects.join(' | '),
		);
		assert(
			'closeOverlay → overlay unmounted (base + hud remain)',
			eq(ids(model.ordered()), ['base', 'hud']),
			ids(model.ordered()).join(','),
		);

		// An action whose effect isn't registered must be a no-op (parity-safe), not a throw.
		const doc2: FlowDoc = {
			...doc,
			graph: {
				...doc.graph,
				nodes: doc.graph.nodes.map((n) =>
					n.id === 'setThing' ? { ...n, ref: 'unregistered' } : n,
				),
			},
		};
		await runFlowEvent(doc2, ctx, 'closeOverlay', {});
		assert('unregistered effect → no throw, no recorded effect', effects.length === 1);
	}

	console.log(`\n${failed ? 'V2 MOUNT HARNESS: FAILED' : 'V2 MOUNT HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
