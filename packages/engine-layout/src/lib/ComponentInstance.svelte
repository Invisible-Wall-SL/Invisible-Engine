<script lang="ts" module>
	import type { ComponentInstanceNode, LayoutNode, Scene } from './types';

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
	import { resolveComponentParams } from './componentParams';
	import { resolveButtonStateImage, BUTTON_STATE_IMAGE_KEYS } from './buttonStateImage';
	import { getComponentValueSource, type ValueSource } from './registerComponentValues';
	import { getComponentAction, type ActionSource } from './registerComponentActions';
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
				}) ?? restingImage,
		});
	}
	setComponentParams(allowed && def ? providedParams : {});

	const cursor = $derived(liveDisabled ? 'not-allowed' : 'pointer');
	const onpress = () => {
		if (liveDisabled) return;
		actionSource?.onpress?.();
	};
</script>

{#if allowed && def}
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
			<LayoutNodeView node={def.root} {space} />
		</Container>
	{:else}
		<LayoutNodeView node={def.root} {space} />
	{/if}
{/if}
