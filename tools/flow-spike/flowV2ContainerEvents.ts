/**
 * Invisible Flow v2 — CONTAINER-EVENTS harness (schema §6.1, decision #6; decision #8 of
 * invisible-flow-v2.md).
 *
 *   pnpm --filter flow-spike run v2containerevents
 *
 * Proves the anti-drift rule for container-scoped component events — the FUSED model: a container's
 * configured component events surface as exec-out pins ON THE `showContainer` NODE ITSELF (one "Base
 * game" node = mount + all its buttons), keyed by ContainerId. There is NO separate event node.
 *   1. A container SURFACES its components' CONFIGURED events as decls — derived from Scene-Editor
 *      component config, NEVER auto-dumped. A base-game scene with five configured controls + one
 *      decorative sprite derives EXACTLY the five entries; the sprite (no configured event) is excluded.
 *   2. A `showContainer` node whose `ref` is a ContainerId present in the surface derives
 *      `[exec-in, exec-out, onSpin, onIncrease, onDecrease, onSoundToggle, onSettings]` — 2 base exec
 *      pins + 5 event exec-outs, all correct dir/kind/label.
 *   3. A FlowDoc whose FUSED event exec-out wires (exec) into an action `validateFlowDoc`s with ZERO
 *      issues when the container-event surface is supplied.
 *
 * Prints PASS/FAIL per assertion + a final `V2 CONTAINER-EVENTS HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	deriveContainerEvents,
	derivePins,
	validateFlowDoc,
	type ConfiguredComponentEvent,
	type ContainerEventDecl,
	type FlowDoc,
	type FunctionLibraryDoc,
	type Node,
	type Pin,
	type PinContext,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

// The base-game scene's components, projected to the minimal `ConfiguredComponentEvent` shape the
// Scene Editor hands the deriver: five configured controls + one decorative `logo` sprite (no event).
const BASEGAME_COMPONENTS: ConfiguredComponentEvent[] = [
	{ componentId: 'spinButton', event: 'spin' },
	{ componentId: 'increaseButton', event: 'increase' },
	{ componentId: 'decreaseButton', event: 'decrease' },
	{ componentId: 'soundToggle', event: 'soundToggle' },
	{ componentId: 'settingsButton', event: 'settings' },
	{ componentId: 'logo' }, // decorative sprite — nothing configured ⇒ contributes NO decl.
];

const main = () => {
	console.log('Invisible Flow v2 — container-events (§6.1) harness\n');

	// -------------------------------------------------------------------------
	// 1. Derivation: configured components → decls; decorative sprite excluded.
	// -------------------------------------------------------------------------
	console.log("1. deriveContainerEvents surfaces only CONFIGURED components' events:");
	const decls: ContainerEventDecl[] = deriveContainerEvents(BASEGAME_COMPONENTS);

	assert(
		'derives EXACTLY 5 decls (decorative `logo` excluded)',
		decls.length === 5,
		`got ${decls.length}: ${decls.map((d) => d.id).join(', ')}`,
	);

	const ids = decls.map((d) => d.id).sort();
	const expectedIds = [
		'decreaseButton.onDecrease',
		'increaseButton.onIncrease',
		'settingsButton.onSettings',
		'soundToggle.onSoundToggle',
		'spinButton.onSpin',
	];
	assert(
		'decl ids are the expected `<componentId>.on<Event>` set',
		JSON.stringify(ids) === JSON.stringify(expectedIds),
		ids.join(', '),
	);

	assert('no `logo` decl surfaces', !decls.some((d) => d.componentId === 'logo'));

	const spin = decls.find((d) => d.id === 'spinButton.onSpin');
	assert(
		'spinButton.onSpin carries componentId + event verbatim',
		spin?.componentId === 'spinButton' && spin?.event === 'spin',
		JSON.stringify(spin),
	);

	// -------------------------------------------------------------------------
	// 2. Fused pin derivation: a `showContainer` node whose `ref` is a ContainerId in the surface
	//    fuses one exec-out per decl onto itself, alongside its base [exec-in, exec-out].
	// -------------------------------------------------------------------------
	console.log('\n2. a `showContainer` node FUSES its container events as exec-out pins:');
	// The surface is keyed by ContainerId — the `showContainer` node's `ref` (`base`), NOT the sceneId.
	const CONTAINER_ID = 'base';
	const containerEvents: Record<string, ContainerEventDecl[]> = { [CONTAINER_ID]: decls };
	const ctx: PinContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, containerEvents };

	const showNode: Node = {
		id: 'showBase',
		kind: 'showContainer',
		pos: { x: 0, y: 0 },
		ref: CONTAINER_ID,
	};
	const pins: Pin[] = derivePins(showNode, ctx);
	assert(
		'derives exactly 8 pins (2 base exec + 5 event exec-outs + durationMs data-out)',
		pins.length === 8,
		`got ${pins.length}: ${pins.map((p) => p.id).join(', ')}`,
	);

	const execIn = pins.find((p) => p.kind === 'exec' && p.dir === 'in');
	const baseExecOut = pins.find((p) => p.kind === 'exec' && p.dir === 'out' && p.id === 'exec');
	assert('has one base exec-in', !!execIn && execIn.id === 'exec');
	assert('has one base exec-out (`exec`)', !!baseExecOut);

	// The event pins: exec, out, id = decl.id (unique on the node), label = the on<Event> tail.
	const eventOuts = pins.filter((p) => p.kind === 'exec' && p.dir === 'out' && p.id !== 'exec');
	assert('derives exactly 5 event exec-outs', eventOuts.length === 5, `got ${eventOuts.length}`);
	assert(
		'every event pin is dir=out kind=exec',
		eventOuts.every((p) => p.dir === 'out' && p.kind === 'exec'),
	);

	const outById = new Map(eventOuts.map((p) => [p.id, p]));
	const expectedEventPins: Array<[string, string]> = [
		['spinButton.onSpin', 'onSpin'],
		['increaseButton.onIncrease', 'onIncrease'],
		['decreaseButton.onDecrease', 'onDecrease'],
		['soundToggle.onSoundToggle', 'onSoundToggle'],
		['settingsButton.onSettings', 'onSettings'],
	];
	assert(
		'event exec-outs carry the expected id + label ([exec-in, exec-out, onSpin, onIncrease, onDecrease, onSoundToggle, onSettings])',
		expectedEventPins.every(([id, label]) => outById.get(id)?.label === label),
		eventOuts.map((p) => `${p.id}(${p.label})`).join(', '),
	);

	// An ABSENT surface for a ref is parity-safe: still just [exec-in, exec-out].
	const bareShow: Node = {
		id: 'showGhost',
		kind: 'showContainer',
		pos: { x: 0, y: 0 },
		ref: 'ghostContainer',
	};
	const barePins = derivePins(bareShow, ctx);
	assert(
		'a showContainer with NO surface entry stays [exec-in, exec-out, durationMs] (no event pins — parity-safe)',
		barePins.length === 3 &&
			barePins.filter((p) => p.kind === 'exec').length === 2 &&
			barePins.some((p) => p.id === 'durationMs' && p.kind === 'data'),
		barePins.map((p) => `${p.dir}:${p.kind}:${p.id}`).join(','),
	);

	// -------------------------------------------------------------------------
	// 3. A FlowDoc wiring a fused event exec-out → an action validates clean.
	// -------------------------------------------------------------------------
	console.log(
		'\n3. a FlowDoc wiring a fused event exec-out into an action validates with 0 issues:',
	);
	// showBase.spinButton.onSpin → startSpin (a BOOK_OF_VOCAB command action, no params).
	const DOC: FlowDoc = {
		version: 2,
		templateId: 'bookOf',
		graph: {
			nodes: [showNode, { id: 'doSpin', kind: 'action', pos: { x: 300, y: 0 }, ref: 'startSpin' }],
			exec: [
				{
					from: { node: 'showBase', pin: 'spinButton.onSpin' },
					to: { node: 'doSpin', pin: 'exec' },
				},
			],
			data: [],
		},
		containers: [{ id: CONTAINER_ID, sceneId: 'basegame', z: 0 }],
	};

	const issues = validateFlowDoc(DOC, BOOK_OF_VOCAB, LIBRARY, containerEvents);
	assert(
		'validateFlowDoc reports ZERO issues (fused exec-out is a real endpoint)',
		issues.length === 0,
		issues.map((i) => `${i.code}:${i.message}`).join(' | '),
	);

	// WITHOUT the surface the fused pin doesn't exist, so the edge names an invalid endpoint.
	const issuesNoSurface = validateFlowDoc(DOC, BOOK_OF_VOCAB, LIBRARY);
	assert(
		'without the surface, the edge from the (absent) fused pin is an edge-endpoint error',
		issuesNoSurface.some((i) => i.code === 'edge-endpoint'),
		issuesNoSurface.map((i) => `${i.code}:${i.severity}`).join(' | '),
	);

	console.log(
		`\n${failed ? 'V2 CONTAINER-EVENTS HARNESS: FAILED' : 'V2 CONTAINER-EVENTS HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

main();
