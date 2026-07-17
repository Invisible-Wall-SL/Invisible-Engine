/**
 * Invisible Flow v2 — SIGNAL-SCOPE harness (the `signal-cross-event` check + the `$trigger` twin).
 *
 *   pnpm --filter flow-spike run v2signalscope
 *
 * The ONE `gameSignals` node surfaces EVERY event's data pins at once, which makes a cross-event
 * wire look authored when it can never resolve. `resolveDataOut` reads a signal pin as
 * `scope.trigger[<field>]` — the FIRING event's payload, whatever pin the wire was dragged from —
 * and `runEvent` seeds exactly one trigger per dispatch. So wiring `updateFreeSpin.total` into a
 * node that only runs on the `freeSpinTrigger` chain silently yields `undefined`, which the effect
 * behind it turns into `NaN` (`updateFreeSpinCounter` does `amount + 1`). Reported live as "the
 * free-spin counter shows NaN on the first spin" (2026-07-17).
 *
 * Nothing at runtime can catch it: only the GRAPH knows which chain a node sits on, and the
 * interpreter is deliberately parity-safe (an unresolved pin is `undefined`, never a throw). So it
 * is caught in `validateFlowDoc` — and this harness pins BOTH halves, the bug and the fix:
 *
 *   1. RUNTIME (the bug is real) — the cross-event wire resolves `total: undefined`; the same graph
 *      wired from its OWN event resolves `total: 10`.
 *   2. VALIDATOR — the cross-event wire raises `signal-cross-event`; the correct wire is clean.
 *   3. `$trigger.<member>` — the accessor twin: a member the owning event doesn't declare raises
 *      `accessor-unresolved`; a declared one is clean; a declared one at the wrong type raises
 *      `type-mismatch`.
 *   4. NEVER GUESS — an orphan chain (no entry reaches it) raises neither.
 *   5. CONTAINER-EVENT CHAINS — the case that makes a naive "walk every exec edge" wrong. A
 *      `showContainer`'s FUSED `<componentId>.on<Event>` pins are their own entry ROOTS:
 *      `runContainerEvent` starts a fresh run there and seeds `trigger` with the COMPONENT EVENT's
 *      payload, NOT the event that mounted the container. Attributing the mounting event to that
 *      chain produces BOTH a false positive (a real `$trigger` field reported unresolved) and a
 *      false negative (the actual NaN wire reported clean). Both are pinned here, with the
 *      `containerEvents` surface passed — the only configuration in which they appear.
 *
 * Prints PASS/FAIL per assertion + a final `V2 SIGNAL-SCOPE HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	runFlowContainerEvent,
	runFlowEvent,
	validateFlowDoc,
	type ContainerEventDecl,
	type DataSource,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type RunContext,
} from 'engine-flow-v2';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

// The container-event surface the `/flow-v2` editor passes to `validateFlowDoc` — a tap panel on the
// `intro` container whose `onTap` carries its OWN `total`. Note `total` is ALSO a field of
// `updateFreeSpin` and NOT of `freeSpinTrigger`: that overlap is what makes the FP/FN below sharp.
const TAP_ON_TAP: ContainerEventDecl = {
	id: 'tapPanel.onTap',
	componentId: 'tapPanel',
	event: 'tap',
	label: 'onTap',
	payload: [{ name: 'total', type: { t: 'int' } }],
};
const CONTAINER_EVENTS: Record<string, ContainerEventDecl[]> = { intro: [TAP_ON_TAP] };

// ---------------------------------------------------------------------------
// The fixture. `gameSignals.freeSpinTrigger` (exec) → action `setFreeSpinCounterTotal`, whose
// `total` param is fed by a data edge from `srcPin` — the ONLY thing that varies between the
// broken and the correct doc. `freeSpinTrigger` declares `totalFs`/`positions`; `updateFreeSpin`
// declares `amount`/`total`. So `updateFreeSpin.total` is the user's exact mis-wire.
// ---------------------------------------------------------------------------

const docWiredFrom = (srcPin: string): FlowDoc => ({
	version: 2,
	templateId: 'bookOf',
	containers: [],
	graph: {
		nodes: [
			{ id: 'signals', kind: 'gameSignals', pos: { x: 0, y: 0 } },
			{
				id: 'setTotal',
				kind: 'action',
				pos: { x: 400, y: 0 },
				ref: 'setFreeSpinCounterTotal',
				inputs: { total: { kind: 'wire' } },
			},
		],
		exec: [
			{ from: { node: 'signals', pin: 'freeSpinTrigger' }, to: { node: 'setTotal', pin: 'exec' } },
		],
		data: [{ from: { node: 'signals', pin: srcPin }, to: { node: 'setTotal', pin: 'total' } }],
	},
});

/** The same chain, but `total` fed by a `$trigger.<member>` accessor instead of a wire. */
const docWithTriggerAccessor = (member: string): FlowDoc => ({
	version: 2,
	templateId: 'bookOf',
	containers: [],
	graph: {
		nodes: [
			{ id: 'signals', kind: 'gameSignals', pos: { x: 0, y: 0 } },
			{
				id: 'setTotal',
				kind: 'action',
				pos: { x: 400, y: 0 },
				ref: 'setFreeSpinCounterTotal',
				inputs: { total: { kind: 'accessor', path: { on: 'trigger', member } } },
			},
		],
		exec: [
			{ from: { node: 'signals', pin: 'freeSpinTrigger' }, to: { node: 'setTotal', pin: 'exec' } },
		],
		data: [],
	},
});

/**
 * A CONTAINER-EVENT chain: `event(freeSpinTrigger) → showContainer('intro')`, and separately the
 * container's fused `tapPanel.onTap` pin → the action. The action runs under the TAP's payload, not
 * `freeSpinTrigger`'s — so `$trigger.total` on it is VALID (`total` is an `onTap` field), and a wire
 * from `freeSpinTrigger.totalFs` into it is BROKEN. A walk that treats `onTap` as a continuation of
 * the mounting chain gets both backwards.
 */
const containerEventDoc = (total: DataSource): FlowDoc => ({
	version: 2,
	templateId: 'bookOf',
	containers: [{ id: 'intro', sceneId: 'intro', z: 0 }],
	graph: {
		nodes: [
			{ id: 'signals', kind: 'gameSignals', pos: { x: 0, y: 0 } },
			{ id: 'ev', kind: 'event', pos: { x: 0, y: 200 }, ref: 'freeSpinTrigger' },
			{ id: 'show', kind: 'showContainer', pos: { x: 300, y: 200 }, ref: 'intro' },
			{
				id: 'setTotal',
				kind: 'action',
				pos: { x: 700, y: 200 },
				ref: 'setFreeSpinCounterTotal',
				inputs: { total },
			},
		],
		exec: [
			{ from: { node: 'ev', pin: 'exec' }, to: { node: 'show', pin: 'exec' } },
			// The FUSED container-event pin — its own root, NOT a continuation of the chain above.
			{ from: { node: 'show', pin: 'tapPanel.onTap' }, to: { node: 'setTotal', pin: 'exec' } },
		],
		data: [],
	},
});

/** A node NO entry reaches: the same cross-event wire, but nothing wires the chain's exec. */
const ORPHAN_DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	containers: [],
	graph: {
		nodes: [
			{ id: 'signals', kind: 'gameSignals', pos: { x: 0, y: 0 } },
			{
				id: 'setTotal',
				kind: 'action',
				pos: { x: 400, y: 0 },
				ref: 'setFreeSpinCounterTotal',
				inputs: { total: { kind: 'wire' } },
			},
		],
		exec: [],
		data: [
			{
				from: { node: 'signals', pin: 'updateFreeSpin.total' },
				to: { node: 'setTotal', pin: 'total' },
			},
		],
	},
};

// ---------------------------------------------------------------------------
// A recording env — captures each effect's RESOLVED payload, which is where the
// `undefined` (and the `NaN` it becomes downstream) actually shows up.
// ---------------------------------------------------------------------------

const makeCtx = (): {
	ctx: RunContext;
	calls: { name: string; payload: Record<string, unknown> }[];
} => {
	const calls: { name: string; payload: Record<string, unknown> }[] = [];
	const env: FlowV2Env = {
		async effect(name, payload) {
			calls.push({ name, payload });
		},
		async broadcast() {},
		async waitForTimeout() {},
		timeScale: () => 1,
		showContainer() {},
		hideContainer() {},
		engineRead: () => undefined,
	};
	return { ctx: { vocab: BOOK_OF_VOCAB, library: LIBRARY, env }, calls };
};

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------

let failed = false;
const assert = (label: string, ok: boolean, detail?: string): void => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const validate = (doc: FlowDoc, containerEvents?: Record<string, ContainerEventDecl[]>) =>
	validateFlowDoc(doc, BOOK_OF_VOCAB, LIBRARY, containerEvents);
const codes = (doc: FlowDoc, containerEvents?: Record<string, ContainerEventDecl[]>) =>
	validate(doc, containerEvents).map((i) => i.code);

const main = async (): Promise<void> => {
	console.log('\n1. RUNTIME — the cross-event wire really does resolve to `undefined`:');
	{
		const { ctx, calls } = makeCtx();
		await runFlowEvent(docWiredFrom('updateFreeSpin.total'), ctx, 'freeSpinTrigger', {
			totalFs: 10,
			positions: [],
		});
		assert('the action ran', calls.length === 1, `${calls.length} calls`);
		assert(
			'`total` resolved to undefined (the NaN source)',
			calls[0]?.payload.total === undefined,
			JSON.stringify(calls[0]?.payload),
		);
	}

	console.log('\n2. RUNTIME — wired from its OWN event, the same graph resolves the real value:');
	{
		const { ctx, calls } = makeCtx();
		await runFlowEvent(docWiredFrom('freeSpinTrigger.totalFs'), ctx, 'freeSpinTrigger', {
			totalFs: 10,
			positions: [],
		});
		assert(
			'`total` resolved to 10',
			calls[0]?.payload.total === 10,
			JSON.stringify(calls[0]?.payload),
		);
	}

	console.log('\n3. VALIDATOR — the cross-event wire is an error; the correct wire is clean:');
	{
		const bad = validate(docWiredFrom('updateFreeSpin.total'));
		const crossEvent = bad.filter((i) => i.code === 'signal-cross-event');
		assert(
			'`signal-cross-event` raised',
			crossEvent.length === 1,
			codes(docWiredFrom('updateFreeSpin.total')).join(', '),
		);
		assert('it is an error', crossEvent[0]?.severity === 'error');
		assert(
			'the message names both events',
			!!crossEvent[0]?.message.includes('updateFreeSpin') &&
				!!crossEvent[0]?.message.includes('freeSpinTrigger'),
			crossEvent[0]?.message,
		);
		assert(
			'it points at the data edge',
			crossEvent[0]?.at.on === 'dataEdge',
			JSON.stringify(crossEvent[0]?.at),
		);

		const good = codes(docWiredFrom('freeSpinTrigger.totalFs'));
		assert('the correct wire validates clean', good.length === 0, good.join(', '));
	}

	console.log('\n4. VALIDATOR — the `$trigger.<member>` accessor twin:');
	{
		// `freeSpinTrigger` declares totalFs/positions — `total` is `updateFreeSpin`'s field.
		const bad = validate(docWithTriggerAccessor('total'));
		const unresolved = bad.filter((i) => i.code === 'accessor-unresolved');
		assert(
			'`accessor-unresolved` raised for $trigger.total',
			unresolved.length === 1,
			codes(docWithTriggerAccessor('total')).join(', '),
		);
		assert(
			'the message names the real fields',
			!!unresolved[0]?.message.includes('totalFs'),
			unresolved[0]?.message,
		);

		const good = codes(docWithTriggerAccessor('totalFs'));
		assert('$trigger.totalFs validates clean', good.length === 0, good.join(', '));

		// It RESOLVES but carries the wrong type: `positions` is a list<Position>, the pin is an int.
		const mistyped = validate(docWithTriggerAccessor('positions'));
		assert(
			'$trigger.positions into an int pin raises `type-mismatch`',
			mistyped.some((i) => i.code === 'type-mismatch'),
			codes(docWithTriggerAccessor('positions')).join(', '),
		);
	}

	console.log('\n5. NEVER GUESS — an orphan chain (no entry reaches it) is not judged:');
	{
		const orphan = codes(ORPHAN_DOC);
		assert(
			'no `signal-cross-event` on an orphan chain',
			!orphan.includes('signal-cross-event'),
			orphan.join(', '),
		);
	}

	console.log('\n6. CONTAINER-EVENT chains are their OWN root, not a continuation of the mount:');
	{
		// (a) FALSE-POSITIVE control — `total` IS a field of the `onTap` payload the action runs under.
		const okDoc = containerEventDoc({ kind: 'accessor', path: { on: 'trigger', member: 'total' } });
		const { ctx, calls } = makeCtx();
		await runFlowContainerEvent(okDoc, ctx, 'tapPanel', 'tap', { total: 7 }, {});
		assert(
			'runtime: the tap chain resolves `total: 7`',
			calls[0]?.payload.total === 7,
			JSON.stringify(calls[0]?.payload),
		);
		const okCodes = codes(okDoc, CONTAINER_EVENTS);
		assert(
			'validator: $trigger.total on the tap chain is CLEAN (no false positive)',
			okCodes.length === 0,
			okCodes.join(', '),
		);

		// (b) FALSE-NEGATIVE control — a signal wire from the MOUNTING event into the tap chain is the
		// real NaN bug, and must still be caught even though `freeSpinTrigger` mounted the container.
		const badDoc = containerEventDoc({ kind: 'wire' });
		badDoc.graph.data.push({
			from: { node: 'signals', pin: 'freeSpinTrigger.totalFs' },
			to: { node: 'setTotal', pin: 'total' },
		});
		const bad = makeCtx();
		await runFlowContainerEvent(badDoc, bad.ctx, 'tapPanel', 'tap', { total: 7 }, {});
		assert(
			'runtime: the cross-chain wire really is undefined here',
			bad.calls[0]?.payload.total === undefined,
			JSON.stringify(bad.calls[0]?.payload),
		);
		assert(
			'validator: `signal-cross-event` still raised on the tap chain (no false negative)',
			codes(badDoc, CONTAINER_EVENTS).includes('signal-cross-event'),
			codes(badDoc, CONTAINER_EVENTS).join(', '),
		);
	}

	console.log(
		failed ? '\nV2 SIGNAL-SCOPE HARNESS: FAILED\n' : '\nV2 SIGNAL-SCOPE HARNESS: PASSED\n',
	);
	process.exit(failed ? 1 : 0);
};

void main();
