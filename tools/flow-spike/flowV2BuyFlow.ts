/**
 * Invisible Flow v2 — BUY-FLOW harness (Phase 3, Steps 4+5 — the buy flow authored end-to-end).
 *
 *   pnpm --filter flow-spike run v2buyflow
 *
 * Proves the integration payoff of the buy-flow-in-Flow work over the REAL committed reference doc
 * (`BOOK_OF_DRIVEN_SEED_DOC`, the flow `apps/lines` loads via `?flowV2=lines`) + the REAL
 * `BOOK_OF_VOCAB`: the whole select → confirm → commit / cancel sequence, driven by the flow ALONE.
 *
 *   1. AUTHOR — the confirm dialog's DECLARED signals project two fused decls
 *      (`confirm-dialog.onConfirm` / `.onCancel`) via the GENERIC `componentSignalConfiguredEvents`
 *      (no confirm/cancel special-casing), and a `showContainer(buyConfirm)` node fuses both exec-outs.
 *   2. AUTHOR — the reference doc OWNS the `buyBonus` intent + the two buy containers + the three
 *      container events, and `validateFlowDoc` reports ZERO errors with the buy container-event surface.
 *   3. RUNTIME — `buyBonus` ▶ Show(buyFeature).
 *   4. RUNTIME — a card press (fused onSelect, carrying `betModeKey`) ▶ selectBetMode(<key>) ▶
 *      Hide(buyFeature) ▶ Show(buyConfirm); the pressed key flows through verbatim (SUPERSPIN, BONUS).
 *   5. RUNTIME — confirm ▶ commitBuyBonus ▶ Hide(buyConfirm). `commitBuyBonus`'s body (flowEffects.ts)
 *      fires the `bet` broadcast for a buy mode — the interpreter invoking it IS the commit.
 *   6. RUNTIME — cancel ▶ Hide(buyConfirm) ▶ back to Show(buyFeature).
 *   7. OWNERSHIP — the doc owns `buyBonus`; `flowOwnsContainerEvent` is true for the repeater's select
 *      and the dialog's confirm/cancel, false for a ghost id.
 *   8. SUPPRESSION / PARITY MODEL — the exact `<ComponentInstance>` `setComponentPress` gate + the
 *      `<Repeater>` `selectHandler` gate over a stub `getFlowPress`: OWNED ⇒ routes to the flow ALONE
 *      (the coded `pressAction` / `onSelect` binding is NOT called); UN-OWNED ⇒ the coded binding runs
 *      EXACTLY as today (parity — the default imperative buy path is untouched).
 *
 * Prints PASS/FAIL per assertion + a final `V2 BUY-FLOW HARNESS: PASSED`.
 */

import { REPEATER_SELECT_EVENT, REPEATER_SELECTED_KEY } from 'constants-shared/repeater';
import {
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	BOOK_OF_DRIVEN_SEED_DOC,
	BOOK_OF_DRIVEN_SEED_LIBRARY,
	BOOK_OF_VOCAB,
	componentSignalConfiguredEvents,
	containerEventDeclId,
	deriveContainerEvents,
	derivePins,
	flowOwnsContainerEvent,
	runFlowContainerEvent,
	runFlowEvent,
	validateFlowDoc,
	type ContainerEventDecl,
	type FlowV2Env,
	type Node,
	type PinContext,
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

const doc = BOOK_OF_DRIVEN_SEED_DOC;
const CONFIRM_DIALOG = 'confirm-dialog';
const FEATURE_REPEATER = 'buy-feature-cards';
const CONFIRM_PIN = containerEventDeclId(CONFIRM_DIALOG, 'confirm'); // confirm-dialog.onConfirm
const CANCEL_PIN = containerEventDeclId(CONFIRM_DIALOG, 'cancel'); // confirm-dialog.onCancel
const SELECT_PIN = containerEventDeclId(FEATURE_REPEATER, REPEATER_SELECT_EVENT); // .onSelect

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

const ctx: RunContext = {
	vocab: BOOK_OF_VOCAB,
	library: BOOK_OF_DRIVEN_SEED_LIBRARY,
	env: makeRecordingEnv().env, // replaced per-step below
};

const eqLog = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

const main = async () => {
	console.log('Invisible Flow v2 — buy-flow (Phase 3 Steps 4+5) harness\n');

	// -------------------------------------------------------------------------
	// 1. AUTHOR — the confirm dialog's declared signals project onConfirm/onCancel; the showContainer
	//    node fuses both exec-outs. Generic over the signals (no confirm/cancel special-casing).
	// -------------------------------------------------------------------------
	console.log('1. confirmDialog signals → onConfirm/onCancel decls, fused on showContainer(buyConfirm):');
	const confirmDecls: ContainerEventDecl[] = deriveContainerEvents(
		componentSignalConfiguredEvents(CONFIRM_DIALOG, ['confirm', 'cancel']),
	);
	assert(
		'derives exactly TWO decls (one per declared signal)',
		confirmDecls.length === 2,
		`got ${confirmDecls.length}`,
	);
	assert(
		'decl ids/labels are the onConfirm/onCancel set (payload-less)',
		confirmDecls[0]?.id === CONFIRM_PIN &&
			confirmDecls[0]?.label === 'onConfirm' &&
			!confirmDecls[0]?.payload?.length &&
			confirmDecls[1]?.id === CANCEL_PIN &&
			confirmDecls[1]?.label === 'onCancel' &&
			!confirmDecls[1]?.payload?.length,
		JSON.stringify(confirmDecls),
	);
	const pinCtx: PinContext = {
		vocab: BOOK_OF_VOCAB,
		library: BOOK_OF_DRIVEN_SEED_LIBRARY,
		containerEvents: { buyConfirm: confirmDecls },
	};
	const showConfirmNode: Node = {
		id: 'showConfirmProbe',
		kind: 'showContainer',
		pos: { x: 0, y: 0 },
		ref: 'buyConfirm',
	};
	const confirmPins = derivePins(showConfirmNode, pinCtx);
	assert(
		'showContainer(buyConfirm) fuses [exec-in, exec-out, onConfirm, onCancel, durationMs]',
		confirmPins.some((p) => p.dir === 'in' && p.kind === 'exec' && p.id === 'exec') &&
			confirmPins.some((p) => p.dir === 'out' && p.kind === 'exec' && p.id === 'exec') &&
			confirmPins.some((p) => p.dir === 'out' && p.kind === 'exec' && p.id === CONFIRM_PIN) &&
			confirmPins.some((p) => p.dir === 'out' && p.kind === 'exec' && p.id === CANCEL_PIN) &&
			confirmPins.some((p) => p.id === 'durationMs'),
		confirmPins.map((p) => `${p.dir}:${p.kind}:${p.id}`).join(', '),
	);

	// -------------------------------------------------------------------------
	// 2. AUTHOR — the REAL reference doc owns the intent + containers + events and validates clean.
	// -------------------------------------------------------------------------
	console.log('\n2. the reference doc owns buyBonus + the two containers + validates clean:');
	assert(
		'doc owns the `buyBonus` intent (an event node)',
		doc.graph.nodes.some((n) => n.kind === 'event' && n.ref === 'buyBonus'),
	);
	assert(
		'doc declares the buyFeature + buyConfirm containers',
		doc.containers.some((c) => c.id === 'buyFeature') &&
			doc.containers.some((c) => c.id === 'buyConfirm'),
	);
	const issues = validateFlowDoc(
		doc,
		BOOK_OF_VOCAB,
		BOOK_OF_DRIVEN_SEED_LIBRARY,
		BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	);
	const errors = issues.filter((i) => i.severity === 'error');
	assert(
		'validateFlowDoc reports ZERO errors (with the buy container-event surface)',
		errors.length === 0,
		errors.map((i) => `${i.code}:${i.message}`).join(' | '),
	);

	// -------------------------------------------------------------------------
	// 3. RUNTIME — buyBonus intent ▶ Show(buyFeature).
	// -------------------------------------------------------------------------
	console.log('\n3. buyBonus ▶ Show(buyFeature):');
	{
		const { env, log } = makeRecordingEnv();
		await runFlowEvent(doc, { ...ctx, env }, 'buyBonus', {});
		assert('records exactly show buyFeature', eqLog(log, ['show buyFeature']), log.join(' | '));
	}

	// -------------------------------------------------------------------------
	// 4. RUNTIME — a card press (fused onSelect, carrying betModeKey) ▶ arm ▶ swap select → confirm.
	//    The pressed key flows through verbatim (SUPERSPIN, then BONUS — a live press, not a literal).
	// -------------------------------------------------------------------------
	console.log('\n4. a card press ▶ selectBetMode(<key>) ▶ Hide(buyFeature) ▶ Show(buyConfirm):');
	for (const key of ['SUPERSPIN', 'BONUS']) {
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(doc, { ...ctx, env }, FEATURE_REPEATER, REPEATER_SELECT_EVENT, {
			[REPEATER_SELECTED_KEY]: key,
		});
		assert(
			`onSelect { betModeKey: "${key}" } ▶ selectBetMode("${key}") ▶ hide buyFeature ▶ show buyConfirm`,
			eqLog(log, [`effect selectBetMode("${key}")`, 'hide buyFeature', 'show buyConfirm']),
			log.join(' | '),
		);
	}

	// -------------------------------------------------------------------------
	// 5. RUNTIME — confirm ▶ commitBuyBonus ▶ Hide(buyConfirm). The commit effect fires the bet.
	// -------------------------------------------------------------------------
	console.log('\n5. confirm ▶ commitBuyBonus ▶ Hide(buyConfirm):');
	{
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(doc, { ...ctx, env }, CONFIRM_DIALOG, 'confirm');
		assert(
			'onConfirm ▶ commitBuyBonus() ▶ hide buyConfirm (commit fires the bet in flowEffects.ts)',
			eqLog(log, ['effect commitBuyBonus()', 'hide buyConfirm']),
			log.join(' | '),
		);
	}

	// -------------------------------------------------------------------------
	// 6. RUNTIME — cancel ▶ Hide(buyConfirm) ▶ back to Show(buyFeature).
	// -------------------------------------------------------------------------
	console.log('\n6. cancel ▶ Hide(buyConfirm) ▶ Show(buyFeature):');
	{
		const { env, log } = makeRecordingEnv();
		await runFlowContainerEvent(doc, { ...ctx, env }, CONFIRM_DIALOG, 'cancel');
		assert(
			'onCancel ▶ hide buyConfirm ▶ show buyFeature (re-enters the select menu)',
			eqLog(log, ['hide buyConfirm', 'show buyFeature']),
			log.join(' | '),
		);
	}

	// -------------------------------------------------------------------------
	// 7. OWNERSHIP — the doc owns the three container events; a ghost id is not owned.
	// -------------------------------------------------------------------------
	console.log('\n7. ownership: the doc owns onSelect/onConfirm/onCancel; a ghost id is not:');
	assert(
		'flowOwnsContainerEvent(buy-feature-cards, select) === true',
		flowOwnsContainerEvent(doc, FEATURE_REPEATER, REPEATER_SELECT_EVENT) === true,
	);
	assert(
		'flowOwnsContainerEvent(confirm-dialog, confirm) === true',
		flowOwnsContainerEvent(doc, CONFIRM_DIALOG, 'confirm') === true,
	);
	assert(
		'flowOwnsContainerEvent(confirm-dialog, cancel) === true',
		flowOwnsContainerEvent(doc, CONFIRM_DIALOG, 'cancel') === true,
	);
	assert(
		'flowOwnsContainerEvent(ghost-dialog, confirm) === false',
		flowOwnsContainerEvent(doc, 'ghost-dialog', 'confirm') === false,
	);

	// -------------------------------------------------------------------------
	// 8. SUPPRESSION / PARITY MODEL — the <ComponentInstance> setComponentPress gate (confirm/cancel)
	//    and the <Repeater> selectHandler gate, reproduced over a stub getFlowPress. OWNED ⇒ the flow
	//    ALONE runs; UN-OWNED ⇒ the coded binding runs verbatim (the default imperative path untouched).
	// -------------------------------------------------------------------------
	console.log('\n8. the press gates: owned → flow ALONE; un-owned → coded binding verbatim:');
	type StubResolver = (
		id: string,
		action: string,
		payload?: Record<string, unknown>,
	) => (() => void) | undefined;

	// (a) The confirm-dialog gate, copied byte-for-byte from ComponentInstance.svelte's setComponentPress.
	const componentPress =
		(getFlowPress: () => StubResolver | undefined, nodeId: string, actions?: Record<string, () => void>) =>
		(name: string) => {
			const routed = getFlowPress()?.(nodeId, name);
			if (routed) {
				routed();
				return;
			}
			actions?.[name]?.();
		};

	{
		const routed: string[] = [];
		let coded: string | undefined;
		const owned: StubResolver = (id, action) => () => routed.push(`${id}.${action}`);
		componentPress(() => owned, CONFIRM_DIALOG, { confirm: () => (coded = 'confirm') })('confirm');
		assert(
			'OWNED confirm: routes to the flow, coded binding NOT called',
			routed.length === 1 && routed[0] === `${CONFIRM_DIALOG}.confirm` && coded === undefined,
			JSON.stringify({ routed, coded }),
		);
	}
	{
		let coded: string | undefined;
		// No resolver (default imperative buy — no v2 doc) ⇒ the Phase-2 instanceBinding action runs.
		componentPress(() => undefined, CONFIRM_DIALOG, { cancel: () => (coded = 'cancel') })('cancel');
		assert(
			'UN-OWNED cancel (no resolver): coded binding runs EXACTLY as today',
			coded === 'cancel',
			JSON.stringify({ coded }),
		);
	}
	{
		let coded: string | undefined;
		// Resolver present but NOT owning this event (returns undefined) ⇒ coded binding still runs.
		const notOwning: StubResolver = () => undefined;
		componentPress(() => notOwning, CONFIRM_DIALOG, { confirm: () => (coded = 'confirm') })('confirm');
		assert(
			'UN-OWNED confirm (resolver returns undefined): coded binding still runs',
			coded === 'confirm',
			JSON.stringify({ coded }),
		);
	}

	// (b) The repeater gate, copied byte-for-byte from Repeater.svelte's selectHandler.
	const selectHandler =
		(getFlowPress: () => StubResolver | undefined, repeaterId: string) =>
		(item: { key?: string; onSelect?: () => void }) =>
		() => {
			const r = getFlowPress()?.(repeaterId, REPEATER_SELECT_EVENT, {
				[REPEATER_SELECTED_KEY]: item.key,
			});
			if (r) r();
			else item.onSelect?.();
		};
	{
		const routed: Array<Record<string, unknown> | undefined> = [];
		let coded: string | undefined;
		const owned: StubResolver = (_id, _action, payload) => () => routed.push(payload);
		selectHandler(() => owned, FEATURE_REPEATER)({ key: 'SUPERSPIN', onSelect: () => (coded = 'x') })();
		assert(
			'OWNED select: routes with { betModeKey: key }, coded onSelect NOT called',
			routed.length === 1 && routed[0]?.[REPEATER_SELECTED_KEY] === 'SUPERSPIN' && coded === undefined,
			JSON.stringify({ routed, coded }),
		);
		coded = undefined;
		selectHandler(() => undefined, FEATURE_REPEATER)({ key: 'BONUS', onSelect: () => (coded = 'BONUS') })();
		assert(
			'UN-OWNED select (no resolver): coded onSelect runs verbatim',
			coded === 'BONUS',
			JSON.stringify({ coded }),
		);
	}

	console.log(`\n${failed ? 'V2 BUY-FLOW HARNESS: FAILED' : 'V2 BUY-FLOW HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
