/**
 * Invisible Flow v2 — CONFIRM-GATE REUSE harness (Phase 3, Step 6 — the reusable `ConfirmGatedAction`).
 *
 *   pnpm --filter flow-spike run v2confirmgate
 *
 * Proves the reuse payoff of `buildConfirmGate` (the doc-builder confirm gate) over the REAL
 * `engine-flow-v2` runtime + `BOOK_OF_VOCAB`:
 *
 *   1. The REFACTORED buy gate inside the SHIPPED `BOOK_OF_DRIVEN_SEED_DOC` still dispatches +
 *      owns confirm/cancel step-for-step (parity with the inlined 3c flow).
 *   2. A SECOND, synthetic gate — DIFFERENT containers + a DIFFERENT `onConfirmed` action — is a
 *      SINGLE extra `buildConfirmGate(...)` call: ZERO new engine code.
 *   3. Two gate INSTANCES coexist in ONE doc with DISJOINT node ids and DISTINCT containers, and each
 *      dispatches ONLY its own confirm/cancel (no cross-talk). Top-level ownership holds for BOTH.
 *
 * WHY this matters (the mechanism decision): the gate is spliced in as TOP-LEVEL nodes so
 * `flowOwnsContainerEvent` (which reads the RAW, un-flattened graph to suppress the coded press) SEES
 * each gate's `showContainer` fused pins. A `group` would hide them → the coded press double-fires.
 *
 * Prints PASS/FAIL per assertion + a final `V2 CONFIRM-GATE REUSE HARNESS: PASSED`.
 */

import {
	BOOK_OF_DRIVEN_SEED_DOC,
	BOOK_OF_DRIVEN_SEED_LIBRARY,
	BOOK_OF_VOCAB,
	buildConfirmGate,
	containerEventDeclId,
	flowOwnsContainerEvent,
	runFlowContainerEvent,
	type ContainerRef,
	type FlowDoc,
	type FlowV2Env,
	type RunContext,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const eqLog = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

// A recording env — logs every effect / show / hide in order, so the whole sequence is observable.
const makeRecordingEnv = () => {
	const log: string[] = [];
	const env: FlowV2Env = {
		async effect(name, payload) {
			const args = Object.values(payload)
				.map((v) => JSON.stringify(v))
				.join(',');
			log.push(`effect ${name}(${args})`);
		},
		async broadcast(cue) {
			log.push(`broadcast ${cue}`);
		},
		async waitForTimeout() {
			await Promise.resolve();
		},
		timeScale: () => 1,
		showContainer(id) {
			log.push(`show ${id}`);
		},
		hideContainer(id) {
			log.push(`hide ${id}`);
		},
		engineRead: () => undefined,
	};
	return { env, log };
};

const baseCtx = (env: FlowV2Env): RunContext => ({
	vocab: BOOK_OF_VOCAB,
	library: BOOK_OF_DRIVEN_SEED_LIBRARY,
	env,
});

const main = async () => {
	console.log('Invisible Flow v2 — confirm-gate reuse (Phase 3 Step 6) harness\n');

	// -------------------------------------------------------------------------
	// 1. The REFACTORED buy gate inside the shipped seed doc — parity with the inlined 3c flow.
	// -------------------------------------------------------------------------
	console.log(
		'1. the refactored buy gate in BOOK_OF_DRIVEN_SEED_DOC dispatches + owns confirm/cancel:',
	);
	const BUY_DIALOG = 'confirm-dialog';
	{
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(BOOK_OF_DRIVEN_SEED_DOC, baseCtx(env), BUY_DIALOG, 'confirm');
		assert(
			'buy confirm ▶ commitBuyBonus() ▶ hide buyConfirm',
			eqLog(log, ['effect commitBuyBonus()', 'hide buyConfirm']),
			log.join(' | '),
		);
	}
	{
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(BOOK_OF_DRIVEN_SEED_DOC, baseCtx(env), BUY_DIALOG, 'cancel');
		assert(
			'buy cancel ▶ hide buyConfirm ▶ show buyFeature',
			eqLog(log, ['hide buyConfirm', 'show buyFeature']),
			log.join(' | '),
		);
	}
	assert(
		'seed doc owns the buy dialog confirm + cancel (raw-graph ownership)',
		flowOwnsContainerEvent(BOOK_OF_DRIVEN_SEED_DOC, BUY_DIALOG, 'confirm') === true &&
			flowOwnsContainerEvent(BOOK_OF_DRIVEN_SEED_DOC, BUY_DIALOG, 'cancel') === true,
	);

	// -------------------------------------------------------------------------
	// 2. A SECOND, synthetic confirm-gated action — a single extra builder call, zero engine code.
	//    Two gate instances live in ONE doc; assert their node ids are disjoint (no collision).
	// -------------------------------------------------------------------------
	console.log(
		'\n2. two gate INSTANCES coexist in one doc with disjoint ids + distinct containers:',
	);
	const buyGate = buildConfirmGate({
		idPrefix: 'buy',
		promptContainerId: 'buyFeature',
		confirmContainerId: 'buyConfirm',
		confirmComponentId: BUY_DIALOG,
		onConfirmedActionRef: 'commitBuyBonus',
		pos: { x: 500, y: 160 },
	});
	// DIFFERENT containers, DIFFERENT component, DIFFERENT onConfirmed action — nothing buy-specific.
	const DEMO_DIALOG = 'demo-dialog';
	const demoGate = buildConfirmGate({
		idPrefix: 'demo',
		promptContainerId: 'demoPrompt',
		confirmContainerId: 'demoConfirm',
		confirmComponentId: DEMO_DIALOG,
		onConfirmedActionRef: 'openSettings',
		pos: { x: 900, y: 160 },
	});

	const buyIds = new Set(buyGate.nodes.map((n) => n.id));
	const demoIds = demoGate.nodes.map((n) => n.id);
	assert(
		'the two instances share NO node id (idPrefix namespaces every node)',
		demoIds.every((id) => !buyIds.has(id)),
		`overlap: ${demoIds.filter((id) => buyIds.has(id)).join(', ')}`,
	);

	const containers: ContainerRef[] = [
		{ id: 'buyFeature', sceneId: 'buyFeature', z: 90 },
		{ id: 'buyConfirm', sceneId: 'buyConfirm', z: 95 },
		{ id: 'demoPrompt', sceneId: 'demoPrompt', z: 90 },
		{ id: 'demoConfirm', sceneId: 'demoConfirm', z: 95 },
	];
	const twoGateDoc: FlowDoc = {
		version: 2,
		templateId: 'bookOf',
		graph: {
			nodes: [...buyGate.nodes, ...demoGate.nodes],
			exec: [...buyGate.exec, ...demoGate.exec],
			data: [],
		},
		containers,
	};

	// -------------------------------------------------------------------------
	// 3. Each gate dispatches ONLY its own confirm/cancel; ownership holds for BOTH, ghost is not owned.
	// -------------------------------------------------------------------------
	console.log(
		'\n3. each gate dispatches its OWN confirm/cancel (no cross-talk); ownership per gate:',
	);
	// buy gate.
	{
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(twoGateDoc, baseCtx(env), BUY_DIALOG, 'confirm');
		assert(
			'buy confirm ▶ commitBuyBonus() ▶ hide buyConfirm (in the two-gate doc)',
			eqLog(log, ['effect commitBuyBonus()', 'hide buyConfirm']),
			log.join(' | '),
		);
	}
	{
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(twoGateDoc, baseCtx(env), BUY_DIALOG, 'cancel');
		assert(
			'buy cancel ▶ hide buyConfirm ▶ show buyFeature (in the two-gate doc)',
			eqLog(log, ['hide buyConfirm', 'show buyFeature']),
			log.join(' | '),
		);
	}
	// demo gate — DIFFERENT action + containers, same shape, ZERO extra engine code.
	{
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(twoGateDoc, baseCtx(env), DEMO_DIALOG, 'confirm');
		assert(
			'demo confirm ▶ openSettings() ▶ hide demoConfirm',
			eqLog(log, ['effect openSettings()', 'hide demoConfirm']),
			log.join(' | '),
		);
	}
	{
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(twoGateDoc, baseCtx(env), DEMO_DIALOG, 'cancel');
		assert(
			'demo cancel ▶ hide demoConfirm ▶ show demoPrompt',
			eqLog(log, ['hide demoConfirm', 'show demoPrompt']),
			log.join(' | '),
		);
	}
	// Ownership is per-gate + top-level (the raw-graph predicate sees BOTH showContainer nodes).
	assert(
		'owns buy confirm/cancel AND demo confirm/cancel',
		flowOwnsContainerEvent(twoGateDoc, BUY_DIALOG, 'confirm') === true &&
			flowOwnsContainerEvent(twoGateDoc, BUY_DIALOG, 'cancel') === true &&
			flowOwnsContainerEvent(twoGateDoc, DEMO_DIALOG, 'confirm') === true &&
			flowOwnsContainerEvent(twoGateDoc, DEMO_DIALOG, 'cancel') === true,
	);
	assert(
		'does NOT own a ghost dialog (parity: an un-authored press falls through to coded)',
		flowOwnsContainerEvent(twoGateDoc, 'ghost-dialog', 'confirm') === false,
	);
	// Sanity: the fused pin ids are the expected `<component>.on<Event>` decls (the runtime keys them).
	assert(
		'the gate wires exec off the fused onConfirm/onCancel decl ids',
		twoGateDoc.graph.exec.some(
			(e) => e.from.pin === containerEventDeclId(DEMO_DIALOG, 'confirm'),
		) &&
			twoGateDoc.graph.exec.some((e) => e.from.pin === containerEventDeclId(DEMO_DIALOG, 'cancel')),
	);

	console.log(
		`\n${failed ? 'V2 CONFIRM-GATE REUSE HARNESS: FAILED' : 'V2 CONFIRM-GATE REUSE HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

void main();
