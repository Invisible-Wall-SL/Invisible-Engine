/**
 * Invisible Flow v2 — REPEATER-SELECT harness (Phase 3, Step 3 — the fused repeater selection pin).
 *
 *   pnpm --filter flow-spike run v2repeaterselect
 *
 * Proves the ONE genuinely-new engine surface of the buy-flow-in-Flow work: a `repeater` scene node
 * projects a SINGLE fused exec-out pin `<repeaterId>.onSelect` (N cards → one pin, mirroring how N
 * buttons fuse) PLUS a typed `string` data-out `<repeaterId>.onSelect.betModeKey` carrying WHICH item
 * was pressed. A card press, when the flow OWNS the select, routes through the interpreter with the
 * item's `key` seeded as the trigger payload; the data-out then resolves to that key so a downstream
 * `selectBetMode` action arms the picked mode.
 *
 * Assertions:
 *   1. AUTHOR — `repeaterSelectConfiguredEvent` → `deriveContainerEvents` yields exactly one
 *      `<id>.onSelect` decl carrying a `betModeKey: string` payload.
 *   2. AUTHOR — a `showContainer` node over that surface FUSES `[exec-in, exec-out, onSelect,
 *      onSelect.betModeKey(string), durationMs]` — one exec-out + one typed data-out for the list.
 *   3. AUTHOR — a FlowDoc wiring the fused exec-out → `selectBetMode` and the `betModeKey` data-out →
 *      that action's `betModeKey` data-in `validateFlowDoc`s with ZERO issues.
 *   4. RUNTIME OWNED — `runFlowContainerEvent(doc, ctx, repeaterId, 'select', { betModeKey: 'SUPERSPIN' })`
 *      records `effect selectBetMode("SUPERSPIN")` (the seeded key flows through the data-out) and NO
 *      re-mount of the show node.
 *   5. RUNTIME OWNED — a different key ('BONUS') flows through verbatim (the pin carries the LIVE press,
 *      not a frozen literal).
 *   6. RUNTIME UN-OWNED — `flowOwnsContainerEvent(doc, ghostRepeater, 'select') === false`, and firing an
 *      unwired repeater's select records nothing (parity: the coded `onSelect` closure runs instead).
 *   7. PARITY MODEL — the exact `<Repeater>` press gate, reproduced here over a stub `getFlowPress`,
 *      dispatches with `{ betModeKey: key }` when owned and calls the coded `onSelect` VERBATIM when not.
 *
 * Prints PASS/FAIL per assertion + a final `V2 REPEATER-SELECT HARNESS: PASSED`.
 */

import { REPEATER_SELECT_EVENT, REPEATER_SELECTED_KEY } from 'constants-shared/repeater';
import {
	deriveContainerEvents,
	derivePins,
	flowOwnsContainerEvent,
	repeaterSelectConfiguredEvent,
	runFlowContainerEvent,
	validateFlowDoc,
	type ConfiguredComponentEvent,
	type ContainerEventDecl,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type Node,
	type Pin,
	type PinContext,
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

// A minimal vocabulary with the ONE action the buy-flow needs: `selectBetMode(betModeKey: string)` —
// the Phase-3a effect that arms the picked mode. Nothing else is referenced.
const VOCAB: TemplateVocabulary = {
	templateId: 'lines',
	structs: [],
	enums: [],
	events: [],
	actions: [
		{
			name: 'selectBetMode',
			category: 'effect',
			params: [{ name: REPEATER_SELECTED_KEY, type: { t: 'string' } }],
		},
	],
	cues: [],
	collections: [],
};
const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

const REPEATER_ID = 'featureCardsRepeater';
const CONTAINER_ID = 'buyFeature';
const SELECT_PIN = `${REPEATER_ID}.onSelect`;
const SELECT_KEY_PIN = `${SELECT_PIN}.${REPEATER_SELECTED_KEY}`;

// A recording env — logs every effect in order, so the seeded key is observable end-to-end.
const makeRecordingEnv = () => {
	const log: string[] = [];
	const env: FlowV2Env = {
		async effect(name, payload) {
			log.push(
				`effect ${name}(${Object.values(payload)
					.map((v) => JSON.stringify(v))
					.join(',')})`,
			);
		},
		async broadcast(cue, payload) {
			const extra = Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : '';
			log.push(`broadcast ${cue}${extra}`);
		},
		async waitForTimeout(ms) {
			log.push(`delay ${ms}`);
			await Promise.resolve();
		},
		timeScale: () => 1,
		showContainer(id, z) {
			log.push(`show ${id}@${z}`);
		},
		hideContainer(id) {
			log.push(`hide ${id}`);
		},
		engineRead: () => undefined,
	};
	return { env, log };
};

// The FlowDoc: showContainer(buyFeature) whose fused `onSelect` exec-out → `selectBetMode`, and whose
// `onSelect.betModeKey` data-out → that action's `betModeKey` data-in.
const DOC: FlowDoc = {
	version: 2,
	templateId: 'lines',
	graph: {
		nodes: [
			{ id: 'showBuy', kind: 'showContainer', pos: { x: 0, y: 0 }, ref: CONTAINER_ID },
			{ id: 'arm', kind: 'action', pos: { x: 300, y: 0 }, ref: 'selectBetMode' },
		],
		exec: [{ from: { node: 'showBuy', pin: SELECT_PIN }, to: { node: 'arm', pin: 'exec' } }],
		data: [
			{
				from: { node: 'showBuy', pin: SELECT_KEY_PIN },
				to: { node: 'arm', pin: REPEATER_SELECTED_KEY },
			},
		],
	},
	containers: [{ id: CONTAINER_ID, sceneId: 'buyFeature', z: 0 }],
};

const eqLog = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

const main = async () => {
	console.log('Invisible Flow v2 — repeater-select (Phase 3 Step 3) harness\n');

	// -------------------------------------------------------------------------
	// 1. AUTHOR — the repeater projects one fused `onSelect` decl with a betModeKey payload.
	// -------------------------------------------------------------------------
	console.log(
		'1. repeaterSelectConfiguredEvent → deriveContainerEvents surfaces one onSelect decl:',
	);
	const configured: ConfiguredComponentEvent[] = [repeaterSelectConfiguredEvent(REPEATER_ID)];
	const decls: ContainerEventDecl[] = deriveContainerEvents(configured);
	assert(
		'derives exactly ONE decl (the whole list fuses to one pin)',
		decls.length === 1,
		`got ${decls.length}`,
	);
	const sel = decls[0];
	assert(
		'decl id/label/event are the onSelect set',
		sel?.id === SELECT_PIN && sel?.label === 'onSelect' && sel?.event === REPEATER_SELECT_EVENT,
		JSON.stringify(sel),
	);
	const payloadField = sel?.payload?.[0];
	assert(
		'decl carries a `betModeKey: string` payload field',
		sel?.payload?.length === 1 &&
			payloadField?.name === REPEATER_SELECTED_KEY &&
			payloadField?.type.t === 'string',
		JSON.stringify(sel?.payload),
	);

	// -------------------------------------------------------------------------
	// 2. AUTHOR — the showContainer node fuses one exec-out + one typed data-out.
	// -------------------------------------------------------------------------
	console.log(
		'\n2. the showContainer node FUSES [exec-in, exec-out, onSelect, onSelect.betModeKey, durationMs]:',
	);
	const containerEvents: Record<string, ContainerEventDecl[]> = { [CONTAINER_ID]: decls };
	const ctx: PinContext = { vocab: VOCAB, library: LIBRARY, containerEvents };
	const showNode: Node = {
		id: 'showBuy',
		kind: 'showContainer',
		pos: { x: 0, y: 0 },
		ref: CONTAINER_ID,
	};
	const pins: Pin[] = derivePins(showNode, ctx);

	const execOut = pins.find((p) => p.kind === 'exec' && p.dir === 'out' && p.id === SELECT_PIN);
	assert(
		'fuses one exec-out `<id>.onSelect` (dir=out kind=exec, label onSelect)',
		!!execOut && execOut.label === 'onSelect',
		JSON.stringify(execOut),
	);
	const dataOut = pins.find((p) => p.kind === 'data' && p.dir === 'out' && p.id === SELECT_KEY_PIN);
	assert(
		'fuses one typed data-out `<id>.onSelect.betModeKey` (string, label betModeKey)',
		!!dataOut && dataOut.dataType?.t === 'string' && dataOut.label === REPEATER_SELECTED_KEY,
		JSON.stringify(dataOut),
	);
	assert(
		'the base exec pins survive (exec-in + exec-out) + a durationMs data-out',
		pins.some((p) => p.kind === 'exec' && p.dir === 'in' && p.id === 'exec') &&
			pins.some((p) => p.kind === 'exec' && p.dir === 'out' && p.id === 'exec') &&
			pins.some((p) => p.id === 'durationMs'),
		pins.map((p) => `${p.dir}:${p.kind}:${p.id}`).join(', '),
	);

	// -------------------------------------------------------------------------
	// 3. AUTHOR — the wired doc validates clean.
	// -------------------------------------------------------------------------
	console.log(
		'\n3. a FlowDoc wiring onSelect → selectBetMode + betModeKey data → its data-in validates clean:',
	);
	const issues = validateFlowDoc(DOC, VOCAB, LIBRARY, containerEvents);
	assert(
		'validateFlowDoc reports ZERO issues',
		issues.length === 0,
		issues.map((i) => `${i.code}:${i.message}`).join(' | '),
	);

	// -------------------------------------------------------------------------
	// 4/5. RUNTIME OWNED — the seeded key flows through the data-out into the action.
	// -------------------------------------------------------------------------
	console.log(
		'\n4. firing onSelect with { betModeKey: "SUPERSPIN" } arms selectBetMode("SUPERSPIN"):',
	);
	{
		const { env, log } = makeRecordingEnv();
		const runCtx: RunContext = { vocab: VOCAB, library: LIBRARY, env };
		await runFlowContainerEvent(DOC, runCtx, REPEATER_ID, REPEATER_SELECT_EVENT, {
			[REPEATER_SELECTED_KEY]: 'SUPERSPIN',
		});
		assert(
			'records exactly effect selectBetMode("SUPERSPIN"), no re-mount',
			eqLog(log, ['effect selectBetMode("SUPERSPIN")']),
			log.join(' | '),
		);
	}

	console.log(
		'\n5. a different pressed key ("BONUS") flows through verbatim (live press, not a literal):',
	);
	{
		const { env, log } = makeRecordingEnv();
		const runCtx: RunContext = { vocab: VOCAB, library: LIBRARY, env };
		await runFlowContainerEvent(DOC, runCtx, REPEATER_ID, REPEATER_SELECT_EVENT, {
			[REPEATER_SELECTED_KEY]: 'BONUS',
		});
		assert(
			'records effect selectBetMode("BONUS")',
			eqLog(log, ['effect selectBetMode("BONUS")']),
			log.join(' | '),
		);
	}

	// -------------------------------------------------------------------------
	// 6. RUNTIME UN-OWNED — an unwired repeater is a parity-safe no-op.
	// -------------------------------------------------------------------------
	console.log(
		'\n6. an un-owned repeater select is a parity-safe no-op (coded onSelect would run):',
	);
	assert(
		'flowOwnsContainerEvent(featureCardsRepeater, select) === true',
		flowOwnsContainerEvent(DOC, REPEATER_ID, REPEATER_SELECT_EVENT) === true,
	);
	assert(
		'flowOwnsContainerEvent(ghostRepeater, select) === false',
		flowOwnsContainerEvent(DOC, 'ghostRepeater', REPEATER_SELECT_EVENT) === false,
	);
	{
		const { env, log } = makeRecordingEnv();
		const runCtx: RunContext = { vocab: VOCAB, library: LIBRARY, env };
		await runFlowContainerEvent(DOC, runCtx, 'ghostRepeater', REPEATER_SELECT_EVENT, {
			[REPEATER_SELECTED_KEY]: 'SUPERSPIN',
		});
		assert('an unwired repeater select records nothing', log.length === 0, log.join(' | '));
	}

	// -------------------------------------------------------------------------
	// 7. PARITY MODEL — the exact <Repeater> press gate over a stub getFlowPress.
	// Reproduces `selectHandler`: owned ⇒ dispatch with { betModeKey: key }; NOT owned ⇒ coded onSelect.
	// -------------------------------------------------------------------------
	console.log(
		'\n7. the <Repeater> press gate: owned → dispatch(key); un-owned → coded onSelect verbatim:',
	);
	type StubResolver = (
		id: string,
		action: string,
		payload?: Record<string, unknown>,
	) => (() => void) | undefined;
	const dispatched: Array<{ id: string; action: string; payload?: Record<string, unknown> }> = [];
	let codedRan: string | undefined;
	// The gate, copied byte-for-byte from Repeater.svelte's `selectHandler` body.
	const selectHandler =
		(getFlowPress: () => StubResolver | undefined, repeaterId: string) =>
		(item: { key?: string; onSelect?: () => void }) =>
		() => {
			const routed = getFlowPress()?.(repeaterId, REPEATER_SELECT_EVENT, {
				[REPEATER_SELECTED_KEY]: item.key,
			});
			if (routed) routed();
			else item.onSelect?.();
		};

	// OWNED: a resolver that returns a dispatch handler (mirrors resolveFlowV2Press when the flow owns).
	const ownedResolver: StubResolver = (id, action, payload) => () =>
		dispatched.push({ id, action, payload });
	selectHandler(
		() => ownedResolver,
		REPEATER_ID,
	)({ key: 'SUPERSPIN', onSelect: () => (codedRan = 'SUPERSPIN') })();
	assert(
		'OWNED: routes to the flow with { betModeKey: key }, coded onSelect NOT called',
		dispatched.length === 1 &&
			dispatched[0].id === REPEATER_ID &&
			dispatched[0].action === REPEATER_SELECT_EVENT &&
			dispatched[0].payload?.[REPEATER_SELECTED_KEY] === 'SUPERSPIN' &&
			codedRan === undefined,
		JSON.stringify({ dispatched, codedRan }),
	);

	// UN-OWNED: no resolver registered ⇒ getFlowPress() undefined ⇒ the coded onSelect runs verbatim.
	dispatched.length = 0;
	codedRan = undefined;
	selectHandler(
		() => undefined,
		REPEATER_ID,
	)({ key: 'BONUS', onSelect: () => (codedRan = 'BONUS') })();
	assert(
		'UN-OWNED: coded onSelect runs EXACTLY as today, nothing dispatched',
		codedRan === 'BONUS' && dispatched.length === 0,
		JSON.stringify({ dispatched, codedRan }),
	);

	// UN-OWNED, resolver present but NOT owning this event (returns undefined) ⇒ coded onSelect runs.
	codedRan = undefined;
	const notOwningResolver: StubResolver = () => undefined;
	selectHandler(
		() => notOwningResolver,
		REPEATER_ID,
	)({ key: 'BASE', onSelect: () => (codedRan = 'BASE') })();
	assert(
		'UN-OWNED (resolver present, returns undefined): coded onSelect still runs',
		codedRan === 'BASE' && dispatched.length === 0,
		JSON.stringify({ dispatched, codedRan }),
	);

	// -------------------------------------------------------------------------
	// 8. DEDUPE — a repeater's item component (featureCard) ALSO declares a `select` signal, which the
	// component-signal projection would surface as a SECOND, payload-less `<id>.onSelect`. The showContainer
	// node must show ONLY ONE `onSelect` pin — the repeater's canonical one (with the `betModeKey` data-out),
	// never the payload-less duplicate. `deriveContainerEvents` de-dupes by decl id, preferring the payload.
	// -------------------------------------------------------------------------
	console.log(
		'\n8. a repeater + its item `select` signal fuse to ONE onSelect pin (the canonical, with betModeKey):',
	);
	{
		// The repeater's canonical fused event PLUS the featureCard's payload-less `select` signal — BOTH
		// under the SAME repeater node id (order deliberately payload-less-first, to prove order-independence).
		const withDuplicate: ConfiguredComponentEvent[] = [
			{ componentId: REPEATER_ID, event: REPEATER_SELECT_EVENT }, // the item signal (no payload).
			repeaterSelectConfiguredEvent(REPEATER_ID), // the repeater's canonical (with betModeKey).
		];
		const deduped = deriveContainerEvents(withDuplicate);
		assert(
			'derives exactly ONE onSelect decl (the duplicate is dropped)',
			deduped.length === 1,
			`got ${deduped.length}: ${deduped.map((d) => d.id).join(', ')}`,
		);
		assert(
			'the surviving decl is the CANONICAL one (carries the betModeKey payload)',
			deduped[0]?.id === SELECT_PIN &&
				deduped[0]?.payload?.length === 1 &&
				deduped[0]?.payload?.[0]?.name === REPEATER_SELECTED_KEY,
			JSON.stringify(deduped[0]),
		);
		// Non-repeater signals (distinct ids) are untouched — parity.
		const twoDistinct = deriveContainerEvents([
			{ componentId: 'confirm-dialog', event: 'confirm' },
			{ componentId: 'confirm-dialog', event: 'cancel' },
		]);
		assert(
			'distinct component signals survive unchanged (no over-dedupe)',
			twoDistinct.length === 2,
			twoDistinct.map((d) => d.id).join(', '),
		);
	}

	console.log(
		`\n${failed ? 'V2 REPEATER-SELECT HARNESS: FAILED' : 'V2 REPEATER-SELECT HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

void main();
