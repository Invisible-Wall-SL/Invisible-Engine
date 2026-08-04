/**
 * Invisible Flow v2 — BUY-CONFIRM VALUES harness (Phase 3, Step 5b — the flow-shown confirm dialog
 * reads the picked mode's copy, not the def defaults).
 *
 *   pnpm --filter flow-spike run v2buyconfirmvalues
 *
 * The gap this closes: in FLOW mode the `buyConfirm` scene is shown GENERICALLY (`showContainer`),
 * with no `<ConfirmDialog>` mount to inject the selected bet mode's title/message/labels via the
 * instance-binding context — so the `confirmDialog` instance fell back to `CONFIRM_DIALOG_DEF`'s
 * literal node text (Title/Message/Confirm/Cancel). Step 5b registers a NODE-ID-keyed
 * `InstanceValueSource` (`registerInstanceValues`) as `<ComponentInstance>`'s lowest-precedence
 * `engineProvided` supplier (prop ?? binding ?? THIS ?? def default).
 *
 * Rendering resolves inside Svelte + Pixi, so this harness verifies the two pieces that are pure:
 *   1. REGISTRY / SCOPING — the source is keyed to the ONE `confirm-dialog` node id (the seeded
 *      scene instance), NOT to every `confirmDialog` component; a different node id resolves nothing.
 *   2. SOURCE — a store built like `registerBuyFeature`'s (synchronous first emit + re-emit on the
 *      picked-mode change) replays the per-mode title/message/confirm+cancel labels/image.
 *   3. PRECEDENCE — the EXACT `<ComponentInstance>` engineProvided resolver, reproduced over the REAL
 *      `CONFIRM_DIALOG_DEF.params`: FLOW (no prop, no binding) reads the source; IMPERATIVE (binding
 *      present) is byte-identical (the source is NEVER consulted); a `<Repeater>` prop wins over both;
 *      neither ⇒ the def default (node literal, modelled as `undefined` here → the render fall-through).
 *      A PARTIAL source keeps the def default for the missing key.
 *
 * What still needs a LIVE check: that a bound text/sprite node actually PAINTS the resolved value
 * (the paramBinding → node-literal fall-through happens at render, outside this harness's reach).
 *
 * Prints PASS/FAIL per assertion + a final `V2 BUY-CONFIRM VALUES HARNESS: PASSED`.
 */

import {
	CONFIRM_DIALOG_DEF,
	CONFIRM_DIALOG_NODE_ID,
	clearInstanceValues,
	defaultConfirmScene,
	getInstanceValueSource,
	registerInstanceValues,
	type InstanceValueSource,
} from 'engine-layout';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

// A hand-rolled `InstanceValueSource` mirroring `registerBuyFeature`'s `instanceValueSource` (the same
// Svelte-store contract — synchronous first emit, re-emit on change) WITHOUT runes, so tsx can run it.
// `notify()` stands in for the runes `$effect` re-running when `stateBonus.selectedBetModeKey` changes.
const makeModeSource = (getState: () => { key: string; meta: Record<string, BetMode> }) => {
	const subs = new Set<(v: Record<string, unknown>) => void>();
	const compute = (): Record<string, unknown> => {
		const { key, meta } = getState();
		const mode = meta[key];
		return {
			title: translate(mode?.text.title ?? ''),
			message: translate(mode?.text.dialog ?? ''),
			confirmLabel: translate('CONFIRM'),
			cancelLabel: translate('CANCEL'),
			imageKey: mode?.assets.dialogImage ?? '',
		};
	};
	const source: InstanceValueSource = {
		subscribe(run) {
			run(compute());
			subs.add(run);
			return () => subs.delete(run);
		},
	};
	const notify = () => {
		for (const run of subs) run(compute());
	};
	return { source, notify };
};

type BetMode = { text: { title: string; dialog: string }; assets: { dialogImage: string } };
// The real `stateI18nDerived.translate` localizes; the identity here keeps the harness deterministic
// (the point is which VALUE flows through, not its localization).
const translate = (v: string) => v;

// Reproduce `<ComponentInstance>`'s engineProvided resolver EXACTLY (the seam in ComponentInstance.svelte):
//   const boundEngineValues = engineValues ?? binding?.engineValues;
//   if (boundEngineValues) { ...prop/binding getters... }
//   else if (instanceValueSource) { ...instance-value getters (?? staticParams)... }
// Returns the `providedParams` map a bound node would read (getters resolved eagerly for assertion).
const resolveProvided = (opts: {
	engineValues?: Record<string, unknown>;
	binding?: { engineValues?: Record<string, unknown> };
	source?: InstanceValueSource;
	staticParams: Record<string, unknown>;
}): { params: Record<string, unknown>; sourceConsulted: boolean } => {
	const { engineValues, binding, source, staticParams } = opts;
	const providedParams: Record<string, unknown> = { ...staticParams };
	let sourceConsulted = false;
	// The subscription that keeps `instanceValues` live (init-stable source resolution + $effect sub).
	let instanceValues: Record<string, unknown> | undefined;
	if (source) source.subscribe((v) => (instanceValues = v));

	const boundEngineValues = engineValues ?? binding?.engineValues;
	if (boundEngineValues) {
		for (const param of CONFIRM_DIALOG_DEF.params ?? []) {
			if (param.engineProvided && param.key in boundEngineValues) {
				providedParams[param.key] = (engineValues ?? binding?.engineValues)?.[param.key];
			}
		}
	} else if (source) {
		for (const param of CONFIRM_DIALOG_DEF.params ?? []) {
			if (!param.engineProvided) continue;
			sourceConsulted = true;
			providedParams[param.key] = instanceValues?.[param.key] ?? staticParams[param.key];
		}
	}
	return { params: providedParams, sourceConsulted };
};

const SUPERSPIN: BetMode = {
	text: { title: 'SUPER SPIN', dialog: 'Buy a SUPER SPIN for 100x?' },
	assets: { dialogImage: 'buy_superspin' },
};
const BONUS: BetMode = {
	text: { title: 'BONUS BUY', dialog: 'Buy the BONUS for 200x?' },
	assets: { dialogImage: 'buy_bonus' },
};
const META: Record<string, BetMode> = { SUPERSPIN, BONUS };

// `staticParams` for the engineProvided keys models the def default the render falls through to: these
// params carry NO `default`, so `resolveComponentParams` yields no entry → the bound node shows its own
// literal text ('Title'/'Message'/…). Modelled as `undefined` here (absent from staticParams).
const STATIC: Record<string, unknown> = { fill: 0xffffff, fontFamily: 'hud' };

const main = () => {
	console.log('Invisible Flow v2 — buy-confirm values (Phase 3 Step 5b) harness\n');

	// -------------------------------------------------------------------------
	// 1. REGISTRY / SCOPING — keyed to the ONE seeded confirm-dialog node id, not every confirmDialog.
	// -------------------------------------------------------------------------
	console.log('1. the feed is scoped to the buy-confirm INSTANCE node id:');
	assert(
		'the default confirm scene places a node with id CONFIRM_DIALOG_NODE_ID',
		defaultConfirmScene().nodes.some((n) => n.id === CONFIRM_DIALOG_NODE_ID),
		defaultConfirmScene()
			.nodes.map((n) => n.id)
			.join(', '),
	);

	clearInstanceValues();
	const state = { key: 'SUPERSPIN', meta: META };
	const { source, notify } = makeModeSource(() => state);
	registerInstanceValues({ [CONFIRM_DIALOG_NODE_ID]: source });

	assert(
		'getInstanceValueSource(confirm-dialog) resolves the registered source',
		getInstanceValueSource(CONFIRM_DIALOG_NODE_ID) === source,
	);
	assert(
		'a DIFFERENT node id resolves nothing (a second confirmDialog elsewhere is untouched)',
		getInstanceValueSource('some-other-dialog') === undefined,
	);
	assert(
		'the feed is NOT keyed by the confirmDialog COMPONENT id',
		getInstanceValueSource(CONFIRM_DIALOG_DEF.id) === undefined,
		`componentId="${CONFIRM_DIALOG_DEF.id}"`,
	);

	// -------------------------------------------------------------------------
	// 2. SOURCE — replays the picked mode's copy; re-emits on the mode change.
	// -------------------------------------------------------------------------
	console.log('\n2. the source replays the picked mode + re-emits on select:');
	let latest: Record<string, unknown> = {};
	const unsub = source.subscribe((v) => (latest = v));
	assert(
		'synchronous first emit = SUPERSPIN copy',
		latest.title === 'SUPER SPIN' &&
			latest.message === 'Buy a SUPER SPIN for 100x?' &&
			latest.confirmLabel === 'CONFIRM' &&
			latest.cancelLabel === 'CANCEL' &&
			latest.imageKey === 'buy_superspin',
		JSON.stringify(latest),
	);
	state.key = 'BONUS';
	notify();
	assert(
		'picking BONUS re-emits the BONUS copy (reactive on selectedBetModeKey)',
		latest.title === 'BONUS BUY' &&
			latest.message === 'Buy the BONUS for 200x?' &&
			latest.imageKey === 'buy_bonus',
		JSON.stringify(latest),
	);
	unsub();
	state.key = 'SUPERSPIN'; // reset for the precedence checks below

	// -------------------------------------------------------------------------
	// 3. PRECEDENCE — flow reads the source; imperative is byte-identical; prop wins; partial falls back.
	// -------------------------------------------------------------------------
	console.log('\n3. precedence (prop ?? binding ?? source ?? def default):');

	// FLOW: no prop, no binding, source present ⇒ per-mode values resolve.
	{
		const { params, sourceConsulted } = resolveProvided({ source, staticParams: STATIC });
		assert(
			'FLOW (no prop/binding): resolves the SUPERSPIN title/message/labels/image from the source',
			sourceConsulted &&
				params.title === 'SUPER SPIN' &&
				params.message === 'Buy a SUPER SPIN for 100x?' &&
				params.confirmLabel === 'CONFIRM' &&
				params.cancelLabel === 'CANCEL' &&
				params.imageKey === 'buy_superspin',
			JSON.stringify(params),
		);
	}

	// IMPERATIVE: binding present (the `<ConfirmDialog>` mount) ⇒ binding wins, source NEVER consulted.
	{
		const binding = {
			engineValues: {
				title: 'IMP TITLE',
				message: 'IMP MESSAGE',
				confirmLabel: 'YES',
				cancelLabel: 'NO',
				imageKey: 'imp_img',
			},
		};
		const { params, sourceConsulted } = resolveProvided({ binding, source, staticParams: STATIC });
		assert(
			'IMPERATIVE (binding present): binding values win AND the instance-value source is NOT consulted',
			!sourceConsulted &&
				params.title === 'IMP TITLE' &&
				params.message === 'IMP MESSAGE' &&
				params.confirmLabel === 'YES' &&
				params.cancelLabel === 'NO' &&
				params.imageKey === 'imp_img',
			JSON.stringify({ params, sourceConsulted }),
		);
	}

	// REPEATER prop: wins over both binding and source (the top of the precedence chain).
	{
		const engineValues = { title: 'PROP TITLE' };
		const binding = { engineValues: { title: 'IMP TITLE' } };
		const { params, sourceConsulted } = resolveProvided({
			engineValues,
			binding,
			source,
			staticParams: STATIC,
		});
		assert(
			'PROP (Repeater engineValues): wins over binding + source',
			!sourceConsulted && params.title === 'PROP TITLE',
			JSON.stringify(params),
		);
	}

	// NEITHER: no prop, no binding, NO source ⇒ the def default (undefined here → the node literal at render).
	{
		const { params, sourceConsulted } = resolveProvided({ staticParams: STATIC });
		assert(
			'NEITHER (no prop/binding/source): title stays the def default (no engineProvided getter added)',
			!sourceConsulted && !('title' in params),
			JSON.stringify(params),
		);
	}

	// PARTIAL source: a key the source omits falls back to the def default (parity with the `key in …` guard).
	{
		const partial: InstanceValueSource = {
			subscribe(run) {
				run({ title: 'ONLY TITLE' }); // message/labels/image absent
				return () => {};
			},
		};
		const staticWithDefault = { ...STATIC, message: 'DEF MESSAGE' };
		const { params } = resolveProvided({ source: partial, staticParams: staticWithDefault });
		assert(
			'PARTIAL source: present key resolves; a missing key falls back to the def default',
			params.title === 'ONLY TITLE' && params.message === 'DEF MESSAGE',
			JSON.stringify(params),
		);
	}

	clearInstanceValues();
	console.log(
		`\n${failed ? 'V2 BUY-CONFIRM VALUES HARNESS: FAILED' : 'V2 BUY-CONFIRM VALUES HARNESS: PASSED'}`,
	);
	process.exit(failed ? 1 : 0);
};

main();
