/**
 * Invisible Flow v2 — CONTAINER-EVENTS harness (schema §6.1, decision #6; decision #8 of
 * invisible-flow-v2.md).
 *
 *   pnpm --filter flow-spike run v2containerevents
 *
 * Proves the anti-drift rule for container-scoped component events:
 *   1. A container SURFACES its components' CONFIGURED events as decls — derived from Scene-Editor
 *      component config, NEVER auto-dumped. A base-game scene with five configured controls + one
 *      decorative sprite derives EXACTLY the five entries; the sprite (no configured event) is excluded.
 *   2. An `event` node whose `ref` is `<sceneId>/<declId>` derives its pins ([exec-out], no exec-in)
 *      against the scene's aggregated decls — the exec-out entry point a control's wire flows out of.
 *   3. A FlowDoc whose container-scoped event node wires (exec) into an action `validateFlowDoc`s with
 *      ZERO issues when the container-event surface is supplied.
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
	// 2. Pin derivation: a container-scoped `event` node → [exec-out], no exec-in.
	// -------------------------------------------------------------------------
	console.log('\n2. a container-scoped `event` node derives [exec-out] (entry point):');
	const containerEvents: Record<string, ContainerEventDecl[]> = { basegame: decls };
	const ctx: PinContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, containerEvents };

	const spinEventNode: Node = {
		id: 'onSpin',
		kind: 'event',
		pos: { x: 0, y: 0 },
		ref: 'basegame/spinButton.onSpin',
	};
	const pins: Pin[] = derivePins(spinEventNode, ctx);
	const execOuts = pins.filter((p) => p.kind === 'exec' && p.dir === 'out');
	const execIns = pins.filter((p) => p.kind === 'exec' && p.dir === 'in');
	assert('derives exactly one exec-out', execOuts.length === 1, `got ${execOuts.length}`);
	assert('derives NO exec-in (entry point)', execIns.length === 0, `got ${execIns.length}`);
	assert(
		'derives no data-outs (empty payload)',
		pins.filter((p) => p.kind === 'data').length === 0,
	);

	// An unresolved container-scoped ref is parity-safe: still just [exec-out].
	const unknownNode: Node = {
		id: 'onGhost',
		kind: 'event',
		pos: { x: 0, y: 0 },
		ref: 'basegame/ghostButton.onGhost',
	};
	const unknownPins = derivePins(unknownNode, ctx);
	assert(
		'an UNRESOLVED container-scoped ref stays [exec-out] (parity-safe)',
		unknownPins.length === 1 && unknownPins[0].kind === 'exec' && unknownPins[0].dir === 'out',
		unknownPins.map((p) => `${p.dir}:${p.kind}`).join(','),
	);

	// -------------------------------------------------------------------------
	// 3. A FlowDoc wiring the container-scoped event → an action validates clean.
	// -------------------------------------------------------------------------
	console.log('\n3. a FlowDoc wiring the container event into an action validates with 0 issues:');
	// onSpin (container event) → startSpin (a BOOK_OF_VOCAB command action, no params).
	const DOC: FlowDoc = {
		version: 2,
		templateId: 'bookOf',
		graph: {
			nodes: [
				spinEventNode,
				{ id: 'doSpin', kind: 'action', pos: { x: 300, y: 0 }, ref: 'startSpin' },
			],
			exec: [{ from: { node: 'onSpin', pin: 'exec' }, to: { node: 'doSpin', pin: 'exec' } }],
			data: [],
		},
		containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
	};

	const issues = validateFlowDoc(DOC, BOOK_OF_VOCAB, LIBRARY, containerEvents);
	assert(
		'validateFlowDoc reports ZERO issues (container-scoped ref resolved)',
		issues.length === 0,
		issues.map((i) => `${i.code}:${i.message}`).join(' | '),
	);

	// And WITHOUT the surface the ref is (correctly) an unknown-event WARNING, not silently clean.
	const issuesNoSurface = validateFlowDoc(DOC, BOOK_OF_VOCAB, LIBRARY);
	assert(
		'without the surface, the container-scoped ref is a ref-unresolved WARNING',
		issuesNoSurface.some((i) => i.code === 'ref-unresolved' && i.severity === 'warning'),
		issuesNoSurface.map((i) => `${i.code}:${i.severity}`).join(' | '),
	);

	console.log(
		`\n${failed ? 'V2 CONTAINER-EVENTS HARNESS: FAILED' : 'V2 CONTAINER-EVENTS HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

main();
