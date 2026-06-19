<script lang="ts" module>
	import type { ComponentInstanceNode, LayoutNode, Scene, SpineCue } from './types';

	export type Props = { node: ComponentInstanceNode; space?: Scene['space'] };
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';

	import LayoutNodeView from './LayoutNodeView.svelte';
	import { getComponent } from './registerComponents';
	import {
		getComponentNestState,
		setComponentNestState,
		MAX_COMPONENT_DEPTH,
	} from './componentInstanceContext';
	import { setComponentParams } from './componentParamsContext';
	import { setComponentSignalAnims } from './componentSignalContext';
	import { resolveComponentParams } from './componentParams';
	import { resolveButtonStateImage, BUTTON_STATE_IMAGE_KEYS } from './buttonStateImage';
	import { getComponentValueSource, type ValueSource } from './registerComponentValues';
	import { getComponentAction, type ActionSource } from './registerComponentActions';
	import { getComponentVisibility, type BoolSource } from './registerComponentVisibility';
	import { getComponentSignal } from './registerComponentSignals';
	import { getComponentDefaults } from './registerComponentDefaults';

	const { node, space }: Props = $props();

	// Resolve the def the instance references. Missing → render nothing (warned
	// once below), mirroring the bound-component miss path. Init-stable: the
	// component registry is populated once at boot (before any scene renders) and a
	// keyed instance node never swaps its `componentId` — so this (and the guards
	// below) are plain reads, not `$derived` (which would also be read at init by
	// `setContext` and so never update anyway → Svelte's `state_referenced_locally`).
	const def = getComponent(node.componentId, node.componentVersion);

	// Nesting guard (§8.9): cap depth at 2 levels and refuse a transitive cycle
	// (a component instancing itself). `parentNest` is a stable context value, so
	// these guards are init-stable too.
	const parentNest = getComponentNestState();
	const isCycle = parentNest.visited.has(node.componentId);
	const depthExceeded = parentNest.depth >= MAX_COMPONENT_DEPTH;
	const allowed = !!def && !isCycle && !depthExceeded;

	$effect(() => {
		if (!def) {
			console.warn(`[engine-layout] no component registered for id '${node.componentId}'.`);
		} else if (isCycle) {
			console.warn(
				`[engine-layout] component '${node.componentId}' instances itself transitively — skipped (cycle guard).`,
			);
		} else if (depthExceeded) {
			console.warn(
				`[engine-layout] component '${node.componentId}' exceeds the max nesting depth of ${MAX_COMPONENT_DEPTH} — skipped.`,
			);
		}
	});

	// Provide the deeper guard to whatever the component renders, so a nested
	// `componentInstance` inside `def.root` sees the updated depth + visited set.
	// Set during init (Svelte requires `setContext` at component initialisation);
	// a keyed instance node never swaps its `componentId`, so this is stable.
	setComponentNestState({
		depth: parentNest.depth + 1,
		visited: new Set([...parentNest.visited, node.componentId]),
	});

	// Param threading (§13.2 / Phase B1+B4.5): resolve the instance's effective
	// params — def defaults ◁ PER-PROJECT defaults (the B3 sidecar the game
	// registers at boot via `registerComponentDefaults`, §14.2 B4.5) ◁ instance
	// overrides. As in B1 the static set is read at init. No registered defaults ⇒
	// `getComponentDefaults` is `undefined` ⇒ def's own defaults apply (parity).
	const staticParams =
		allowed && def
			? resolveComponentParams(def, node.params, getComponentDefaults(node.componentId))
			: {};

	// Engine value feed (§13.2 step 2 / Phase B2): if the resolved params name a
	// `source` AND the game registered a value store under it, subscribe and keep
	// the latest number in `liveValue`. The subscription lives in an `$effect` so
	// it re-binds if the registered store changes and tears down on unmount (the
	// returned unsubscribe is the effect cleanup). No source/provider ⇒ `liveValue`
	// stays undefined and the provided params equal B1's static map exactly (parity
	// — the `value` getter below then never appears).
	const source = typeof staticParams['source'] === 'string' ? staticParams['source'] : undefined;
	const valueSource: ValueSource | undefined = source ? getComponentValueSource(source) : undefined;
	let liveValue = $state<number | string | undefined>(undefined);
	$effect(() => {
		if (!valueSource) return;
		return valueSource.subscribe((value) => {
			liveValue = value;
		});
	});

	// Engine action feed (§16.2/§16.3 / Phase B6.2): the behaviour analogue of the
	// value feed above. If the resolved params name an `action` AND the game
	// registered an `ActionSource` under it, subscribe its `disabled`/`active` flags
	// (when present) into `liveDisabled`/`liveActive`, exactly like `liveValue`. The
	// subscriptions live in `$effect`s so they re-bind if the registered source
	// changes and tear down on unmount (the returned unsubscribe is the cleanup). No
	// action/source ⇒ everything stays undefined and the provided params equal B1's
	// static map exactly (parity — the getters below never appear, so `ButtonFrame`'s
	// `onpress` stays undefined/no-op and `disabled`/`active` fall back to the static
	// map = false).
	const action = typeof staticParams['action'] === 'string' ? staticParams['action'] : undefined;
	const actionSource: ActionSource | undefined = action ? getComponentAction(action) : undefined;
	let liveDisabled = $state<boolean | undefined>(undefined);
	$effect(() => {
		if (!actionSource?.disabled) return;
		return actionSource.disabled.subscribe((value) => {
			liveDisabled = value;
		});
	});
	let liveActive = $state<boolean | undefined>(undefined);
	$effect(() => {
		if (!actionSource?.active) return;
		return actionSource.active.subscribe((value) => {
			liveActive = value;
		});
	});
	// Round-in-progress flag (the spin button's reels are rolling). Drives the
	// `imageSpinning` cascade + `ButtonFrame`'s rotation. Same parity discipline as
	// `disabled`/`active`: undefined until the action feed registers it, falls back
	// to the static map (false) otherwise.
	let liveSpinning = $state<boolean | undefined>(undefined);
	$effect(() => {
		if (!actionSource?.spinning) return;
		return actionSource.spinning.subscribe((value) => {
			liveSpinning = value;
		});
	});
	// Dynamic label (§16.4 B6.4): the string sibling of the flags above. If the
	// action provides a `label` TextSource (only the spin/stop flip does), subscribe
	// it into `liveLabel`; the getter below then OVERRIDES the static `label` param so
	// `ButtonLabel` renders the live caption. No label source ⇒ `liveLabel` stays
	// undefined and the static `label` param is untouched — parity, same discipline as
	// `value`/`disabled`/`active`.
	let liveLabel = $state<string | undefined>(undefined);
	$effect(() => {
		if (!actionSource?.label) return;
		return actionSource.label.subscribe((value) => {
			liveLabel = value;
		});
	});

	// Engine visibility feed: the show/hide analogue of the value/action feeds
	// above. If the resolved params name a `visibleSource` AND the game registered a
	// `BoolSource` under it, subscribe it into `liveVisible` and gate the whole
	// rendered subtree on it (a `false` Container keeps the instance mounted but
	// unrendered). The subscription lives in an `$effect` so it re-binds if the
	// registered source changes and tears down on unmount. No source ⇒ `liveVisible`
	// stays `true` and NO wrapper is added below — the output is byte-identical to
	// today (parity, same discipline as `value`/`disabled`/`active`).
	const visibleSourceKey =
		typeof staticParams['visibleSource'] === 'string' ? staticParams['visibleSource'] : undefined;
	const visibilitySource: BoolSource | undefined = visibleSourceKey
		? getComponentVisibility(visibleSourceKey)
		: undefined;
	let liveVisible = $state(true);
	$effect(() => {
		if (!visibilitySource) return;
		return visibilitySource.subscribe((value) => {
			liveVisible = value;
		});
	});

	// Engine signal feed (§8.5, narrowed to spine-only): the event analogue of the
	// value/action feeds above. Walk `def.root` once at init for `spine` nodes
	// carrying a non-empty `cues` array and index those cues by signal NAME →
	// `{ nodeId, animation, loop }[]`. The static set is read at init (like
	// `staticParams`): a keyed instance never swaps its def, so the spine tree is
	// stable. When the game registered a `SignalSource` under a cue's signal, each
	// fire writes the cue's animation into `signalAnims[nodeId]`; the spine node in
	// `def.root` then prefers that override over its static `defaultAnimation` (see
	// `componentSignalContext` + `LayoutNodeView`). No cues / no registered signal ⇒
	// nothing is ever written and the spine uses `defaultAnimation` (parity).
	const signalToTargets = ((): Map<
		string,
		{ nodeId: string; animation: string; loop?: boolean }[]
	> => {
		const map = new Map<string, { nodeId: string; animation: string; loop?: boolean }[]>();
		if (!allowed || !def) return map;
		const walk = (n: LayoutNode): void => {
			if (n.kind === 'spine' && n.cues?.length) {
				for (const cue of n.cues as SpineCue[]) {
					const targets = map.get(cue.signal) ?? [];
					targets.push({ nodeId: n.id, animation: cue.animation, loop: cue.loop });
					map.set(cue.signal, targets);
				}
			} else if (n.kind === 'container') {
				for (const child of n.children) walk(child);
			}
		};
		walk(def.root);
		return map;
	})();
	let signalAnims = $state<Record<string, { animation: string; loop?: boolean }>>({});
	// One `$effect` (re)subscribes to every referenced signal and returns a combined
	// cleanup — `$effect` can't live inside a loop, so iterate the precomputed map
	// inside it and collect each unsubscribe. A signal with no registered source is
	// skipped (dormant — parity).
	$effect(() => {
		const unsubs: (() => void)[] = [];
		for (const [signalKey, targets] of signalToTargets) {
			const source = getComponentSignal(signalKey);
			if (!source) continue;
			unsubs.push(
				source.subscribe(() => {
					for (const t of targets) {
						signalAnims[t.nodeId] = { animation: t.animation, loop: t.loop };
					}
				}),
			);
		}
		return () => {
			for (const unsub of unsubs) unsub();
		};
	});

	// Default hit surface (§18.4): a def authored ONLY from art nodes (sprite/text/
	// container — no coded `bind` part) has nothing to own the press: `ButtonFrame`
	// is what carries the hit area/cursor/onpointerup in the built-in button, so a
	// custom button built in the Component Editor rendered as a static image. When
	// this instance resolved an action feed AND the def has no bind part, the
	// wrapper Container below turns interactive and the WHOLE rendered art becomes
	// the hit surface (pixi hit-tests the children bounds), mirroring ButtonFrame's
	// semantics (static eventMode, pointer/not-allowed cursor, press → onpress
	// unless disabled). A def containing ANY bind part keeps the coded part as the
	// sole press owner — no wrapper, no double-fire, byte-identical parity.
	const hasBindPart = ((): boolean => {
		const walk = (n: LayoutNode): boolean =>
			!!n.bind || (n.kind === 'container' && n.children.some(walk));
		return def ? walk(def.root) : false;
	})();
	const interactive = !!actionSource && !hasBindPart;

	// Interaction state for the AUTHORED art-button path (the def has no coded part,
	// so no `ButtonFrame` tracks hover/press) — same tracking + disabled-reset as the
	// coded `Button.svelte`. Drives the state-image override below.
	let hovered = $state(false);
	let pressed = $state(false);
	$effect(() => {
		if (!interactive) return;
		if (liveDisabled) {
			hovered = false;
			pressed = false;
		}
	});

	// Provide the params to the rendered sub-tree (§13.2). `setContext` captures the
	// reference once at init, so the provided object stays STABLE while exposing a
	// REACTIVE `value` via a getter: a descendant text node's `$derived` reads
	// `params['value']`, which runs the getter inside its tracking scope and so
	// re-runs on every `liveValue` emit. When no value feed is active the `value`
	// getter is NOT defined, so the object is exactly B1's static
	// `resolveComponentParams` map (parity). Provide `{}` when the instance can't
	// expand (cycle/depth/missing def) so a descendant never reads a stale PARENT
	// instance's params. Set once at init, same discipline as the nest state.
	const providedParams: Record<string, unknown> = { ...staticParams };
	if (valueSource) {
		Object.defineProperty(providedParams, 'value', {
			enumerable: true,
			get: () => liveValue,
		});
		// The source's own number formatter (currency, etc.), forwarded so a plain
		// `text` node bound to `value` renders like the coded readout ($5,000.00)
		// without `engine-layout` knowing about currency/game state. Stable (set at
		// registration), so a plain assignment — `<LayoutNodeView>` reads it as
		// `valueFormat`. Absent ⇒ the readout uses its integer fallback (parity).
		if (valueSource.format) providedParams.valueFormat = valueSource.format;
		// Live text (TextBox / §18): when the def ALSO declares a `text` param (the
		// parametric `textBox` binds its text node to it), the live feed OVERRIDES the
		// static `text` — so one def renders a static/localized string when no source
		// is picked, and the live value (clock, balance, …) when one is. Same parity
		// discipline as the action feed's `label` override: defs without a `text`
		// param (HudReadout, Button) are untouched.
		if (def?.params?.some((p) => p.key === 'text')) {
			Object.defineProperty(providedParams, 'text', {
				enumerable: true,
				get: () => liveValue ?? staticParams['text'],
			});
		}
	}
	// Action feed (§16.2/§16.3): expose `onpress` as a plain function reference
	// (`ButtonFrame` reads it lazily at click time, so no reactive getter needed)
	// plus REACTIVE enumerable getters for `disabled`/`active` — but ONLY when the
	// actionSource provides them, same parity discipline as `value`: an action
	// without an `active` flag (e.g. `menu`) leaves the param to fall back to the
	// static map. No actionSource ⇒ none of these appear ⇒ the object is exactly
	// B1's static map.
	if (actionSource) {
		Object.defineProperty(providedParams, 'onpress', {
			enumerable: true,
			get: () => actionSource.onpress,
		});
		if (actionSource.disabled) {
			Object.defineProperty(providedParams, 'disabled', {
				enumerable: true,
				get: () => liveDisabled,
			});
		}
		if (actionSource.active) {
			Object.defineProperty(providedParams, 'active', {
				enumerable: true,
				get: () => liveActive,
			});
		}
		if (actionSource.spinning) {
			Object.defineProperty(providedParams, 'spinning', {
				enumerable: true,
				get: () => liveSpinning,
			});
		}
		// Live caption (§16.4 B6.4): OVERRIDES the static `label` param when the action
		// provides a `label` TextSource (spin/stop flip). Reactive enumerable getter, so
		// `ButtonLabel`'s `$derived` re-runs on each `liveLabel` emit. Only defined when
		// the source provides it — otherwise the static `label` from `resolveComponentParams`
		// stands (parity).
		if (actionSource.label) {
			Object.defineProperty(providedParams, 'label', {
				enumerable: true,
				get: () => liveLabel,
			});
		}
	}
	// Button STATE IMAGES on the authored art-button path: when this instance owns
	// the press (interactive) and the def declares the `image*` params, the `image`
	// param becomes a REACTIVE getter resolving the shared state cascade — the def's
	// bg sprite binds `region` → `image`, so hover/press/selected/downstate swap the
	// art exactly like `ButtonFrame` does for the coded button. Falls back to the
	// static resting `image` (instance override / def default). Only defined when
	// declared — a def without state images keeps the plain static map (parity).
	// Gate on the four STATE keys (not the resting `image`): a def with only a
	// static `image` param needs no live override and keeps the plain static map.
	const hasStateImages =
		def?.params?.some(
			(p) => p.key !== 'image' && (BUTTON_STATE_IMAGE_KEYS as readonly string[]).includes(p.key),
		) ?? false;
	if (interactive && hasStateImages) {
		const restingImage = staticParams['image'];
		Object.defineProperty(providedParams, 'image', {
			enumerable: true,
			get: () =>
				resolveButtonStateImage(staticParams, {
					hovered,
					pressed,
					disabled: liveDisabled === true,
					active: liveActive === true,
					spinning: liveSpinning === true,
				}) ?? restingImage,
		});
	}
	setComponentParams(allowed && def ? providedParams : {});
	// Provide the signal-driven spine-anim overrides to the rendered sub-tree (the
	// `$state` proxy, so a descendant spine's `{@const}` read re-runs on each signal
	// fire — same stable-object discipline as `setComponentParams`). `{}` when the
	// instance can't expand, so a descendant never reads a stale PARENT instance's map.
	setComponentSignalAnims(allowed && def ? signalAnims : {});

	const cursor = $derived(liveDisabled ? 'not-allowed' : 'pointer');
	const onpress = () => {
		if (liveDisabled) return;
		actionSource?.onpress?.();
	};
</script>

{#snippet rendered(root: LayoutNode)}
	{#if interactive}
		<Container
			eventMode="static"
			{cursor}
			onpointerover={() => {
				if (!liveDisabled) hovered = true;
			}}
			onpointerout={() => {
				hovered = false;
				pressed = false;
			}}
			onpointerdown={() => {
				if (!liveDisabled) pressed = true;
			}}
			onpointerup={() => {
				pressed = false;
				onpress();
			}}
		>
			<LayoutNodeView node={root} {space} />
		</Container>
	{:else}
		<LayoutNodeView node={root} {space} />
	{/if}
{/snippet}

{#if allowed && def}
	<!--
		Visibility gate: ONLY when a `visibleSource` resolved a registered source do we
		wrap the subtree in a `<Container visible={liveVisible}>` (hidden = mounted but
		unrendered). With NO source `visibilitySource` is undefined and the snippet is
		rendered bare — no extra Container, byte-identical to before the feed existed.
	-->
	{#if visibilitySource}
		<Container visible={liveVisible}>
			{@render rendered(def.root)}
		</Container>
	{:else}
		{@render rendered(def.root)}
	{/if}
{/if}
