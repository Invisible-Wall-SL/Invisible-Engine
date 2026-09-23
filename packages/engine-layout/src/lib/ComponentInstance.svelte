<script lang="ts" module>
	import type {
		ButtonStateAnimations,
		ComponentInstanceNode,
		FlipbookCue,
		LayoutNode,
		Scene,
		SpineCue,
	} from './types';

	import { untrack, type Snippet } from 'svelte';

	export type Props = {
		node: ComponentInstanceNode;
		space?: Scene['space'];
		// The tap-to-continue surface (dim + full-screen hit area + prompt) is a full-CANVAS
		// overlay: its coverage must NOT inherit the instance's per-layoutType placement/scale
		// (else in portrait the offset+scaled instance transform pushes the "full-screen" hit
		// rectangle off the visible canvas → clicks miss, and double-scales the prompt). So
		// instead of rendering it inside this instance's transform, we EXPOSE it as a bindable
		// snippet that the caller (`LayoutNodeView`'s componentInstance branch) renders as a
		// SIBLING of the transform wrapper — untransformed, in the scene-root/canvas frame,
		// exactly like the engine-owned free-spin gate. Undefined ⇒ nothing hoisted (parity).
		tap?: Snippet;
		// Per-item `engineProvided` param VALUES injected by a `<Repeater>` (§ feature cards):
		// each declared `engineProvided` param present here is threaded into the instance's param
		// context as a reactive value, so ONE prefab renders N items with different title/price/
		// icon. Undefined for every non-repeated instance ⇒ byte-identical to today (parity).
		engineValues?: Record<string, unknown>;
		// Per-item press handler injected by a `<Repeater>` — wired to the component's `select`
		// press. When set (and the def has no coded `bind` part) the whole card becomes the hit
		// surface, mirroring the authored art-button path. Undefined ⇒ no press wiring (parity).
		onSelect?: () => void;
		// Named press handlers for a MULTI-button component (the two-button dialog primitive): a node
		// carrying `pressAction: '<name>'` routes its press to `actions['<name>']` (e.g. a confirm
		// dialog's `{ confirm, cancel }`). The N-button generalisation of `onSelect`. A scene-placed
		// instance receives these via the instance-binding context instead (a `<ConfirmDialog>` mount);
		// this prop is the direct-render path (mirrors `<Repeater>`'s `onSelect`). Undefined ⇒ the
		// context binding, else no routing (parity).
		actions?: Record<string, () => void>;
	};
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { CanvasSizeRectangle } from 'components-layout';
	import { getContextLayout } from 'utils-layout';

	import LayoutNodeView from './LayoutNodeView.svelte';
	import { resolveComponent } from './registerComponents';
	import {
		getComponentNestState,
		setComponentNestState,
		MAX_COMPONENT_DEPTH,
	} from './componentInstanceContext';
	import { setComponentParams } from './componentParamsContext';
	import { setComponentPress } from './componentActionsContext';
	import { getInstanceBinding } from './instanceBindingContext';
	import { setComponentSignalAnims, type ComponentSignalAnim } from './componentSignalContext';
	import { resolveComponentParams } from './componentParams';
	import {
		resolveButtonStateImage,
		resolveButtonStateAnimation,
		mergeButtonStateAnimations,
		BUTTON_STATE_IMAGE_KEYS,
	} from './buttonStateImage';
	import { setComponentStateAnims } from './componentStateAnimContext';
	import { setComponentSpineRest } from './componentSpineRestContext';
	import { getComponentValueSource, type ValueSource } from './registerComponentValues';
	import { getInstanceValueSource, type InstanceValueSource } from './registerInstanceValues';
	import { getFlowValueSource } from './registerFlowValueSource';
	import { getFlowPress } from './registerFlowPress';
	import { getComponentAction, type ActionSource } from './registerComponentActions';
	import { getComponentVisibility, type BoolSource } from './registerComponentVisibility';
	import { ENTER_SIGNAL, getComponentSignal } from './registerComponentSignals';
	import { getComponentDefaults } from './registerComponentDefaults';
	import { getSceneVisibleContext, setSceneVisibleContext } from './sceneVisibilityContext';
	import { getBoundComponent } from './registerBoundComponents';
	import {
		isTapToContinueEnabled,
		tapSignalOf,
		tapDimColorOf,
		tapDimAlphaOf,
		tapArmAfterSignalOf,
		tapShowPromptOf,
		TAP_TO_CONTINUE_COMPONENT,
	} from './tapToContinue';
	import { setComponentFiredSignals } from './componentFiredSignalsContext';
	import { isTapArmed } from './signalGates';
	import { isCompleteOnLoadedEnabled, loadedSignalOf } from './completeOnLoaded';
	import { getFlowComplete } from './registerFlowComplete';
	import { getTapPortal } from './tapPortalContext';

	let { node, space, tap = $bindable(), engineValues, onSelect, actions }: Props = $props();

	// Instance-binding fallback (`instanceBindingContext`): a canvas-takeover MOUNT (e.g.
	// `<ConfirmDialog>`) that renders THIS instance inside its `<LayoutScene>` — but can't pass props
	// through the scene node walk — injects the instance's `engineValues` + press `actions` via
	// context, keyed by `componentId`. Read once at init (context is init-stable). No mount ⇒
	// `undefined` ⇒ the `engineValues`/`actions` PROPS stand (the `<Repeater>` path) or nothing does
	// (parity — byte-identical to today). The `.engineValues` getter the mount sets stays reactive.
	const binding = getInstanceBinding(node.componentId);

	// Current layoutType (per-ratio param overrides). Read from the layout context — the SAME
	// reactive getter `<LayoutNodeView>` uses — so a per-layoutType `node.overrides[lt].params`
	// patch re-resolves when the device rotates. `getContext` returns `undefined` when there's
	// no provider (an instance rendered outside a `<LayoutScene>` — the tap-hoist fallback path);
	// then it falls back to `'desktop'` ⇒ the base params, byte-identical to today (parity).
	const layoutCtx = getContextLayout();
	const currentLayoutType = () => layoutCtx?.stateLayoutDerived.layoutType() ?? 'desktop';
	// Union of param keys overridden in ANY layoutType (init-stable — a keyed instance never
	// swaps its overrides map identity). Empty for every instance that authored no per-ratio
	// param ⇒ no getters added below ⇒ `providedParams` equals the static map exactly (parity).
	const layoutOverrideParamKeys = new Set<string>();
	for (const ov of Object.values(node.overrides ?? {})) {
		if (ov?.params) for (const key of Object.keys(ov.params)) layoutOverrideParamKeys.add(key);
	}

	// The space the component's OWN children render in. A component placed in a
	// `background` scene is cover-fit as ONE unit by the instance's wrapping container
	// (`LayoutNodeView` `bgComponent`); its children must therefore render at their raw
	// LOCAL coords, NOT re-inherit `background` — otherwise each child (a backdrop sprite,
	// a decorative spine, …) independently cover-fits the WINDOW, so a small spine balloons
	// to full-screen, sits centred, and renders through the background-cover spine path
	// instead of as a normal animating spine. `canvas` gives raw x/y + no cover, so the
	// children compose inside the cover-scaled container exactly as authored. Any other
	// space is passed through unchanged (parity — no existing non-background component moves).
	const childSpace = $derived(space === 'background' ? 'canvas' : space);

	// Resolve the def the instance references. Missing → render nothing (warned
	// once below), mirroring the bound-component miss path. Init-stable: the
	// component registry is populated once at boot (before any scene renders) and a
	// keyed instance node never swaps its `componentId` — so this (and the guards
	// below) are plain reads, not `$derived` (which would also be read at init by
	// `setContext` and so never update anyway → Svelte's `state_referenced_locally`).
	//
	// `resolveComponent` honours a version pin EXACTLY when that version is registered
	// (§8.9 v2 multi-version store, pin-by-default): the instance renders the precise
	// def `node.componentVersion` was authored against. When the pinned version isn't
	// registered it falls back to the latest def (parity — same as before history
	// existed) and flags `versionMismatch` rather than pretending it is the pinned
	// version. The pin is NEVER mutated here and the def is NEVER auto-upgraded.
	const resolution = resolveComponent(node.componentId, node.componentVersion);
	const def = resolution.def;

	// Nesting guard (§8.9): cap depth at 2 levels and refuse a transitive cycle
	// (a component instancing itself). `parentNest` is a stable context value, so
	// these guards are init-stable too.
	const parentNest = getComponentNestState();
	const isCycle = parentNest.visited.has(node.componentId);
	const depthExceeded = parentNest.depth >= MAX_COMPONENT_DEPTH;
	const allowed = !!def && !isCycle && !depthExceeded;

	$effect(() => {
		if (resolution.versionMismatch) {
			console.warn(
				`[engine-layout] component '${node.componentId}' pins version ${resolution.pinnedVersion} but that version is not registered (rendering the latest, v${resolution.registeredVersion} — pin not honoured exactly, never auto-upgraded).`,
			);
		}
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

	// Tap-to-continue (Invisible Flow §6.2): a SHARED per-instance toggle any
	// `overlay`-category instance can switch on (no def declaration — the param lives
	// only on the placed instance, surfaced by the editor for overlays). When
	// `tapToContinue` is on, mount the game-registered coded press surface
	// (`TAP_TO_CONTINUE_COMPONENT`) over the overlay's art, passing the authored
	// `tapSignal`; the coded part owns the hit area (OnPressFullScreen + Space) and
	// calls the Flow holder (`completeActiveScreen` + `emitFlowSignal`) — the engine
	// only DECLARES the slot. OFF by default ⇒ `tapComponent` is undefined ⇒ no extra
	// child below ⇒ byte-identical. Gated to `overlay` defs so a UI/scenery instance
	// never silently grows a full-screen tap surface; absent from the bound registry ⇒
	// nothing mounts (parity, safe no-op). Init-stable, like the other static reads.
	const tapEnabled = allowed && def?.category === 'overlay' && isTapToContinueEnabled(staticParams);
	const tapComponent = tapEnabled ? getBoundComponent(TAP_TO_CONTINUE_COMPONENT) : undefined;
	const tapSignal = tapEnabled ? tapSignalOf(staticParams) : '';
	// Per-instance dim/prompt styling for the tap surface — the SINGLE home of the gate
	// look now that the parallel, UI-less `Scene.gate` copy is retired. `tapDimAlpha`
	// defaults to 0 ⇒ a transparent backdrop ⇒ an existing tap overlay (no dim params) is
	// byte-identical to today; the author opts into a dim by setting opacity > 0. Read off
	// the same static params as `tapSignal`.
	const tapDimColor = tapEnabled ? tapDimColorOf(staticParams) : 0x000000;
	const tapDimAlpha = tapEnabled ? tapDimAlphaOf(staticParams) : 0;
	// Arm-after-signal (Invisible Flow — intro-complete sequencing): when set, the tap surface stays
	// inert (not mounted, taps pass through) until this named component-scoped signal has fired for
	// the instance — e.g. a sibling spine's `completeSignal`, so "tap to continue" is dead until the
	// intro finishes. Empty ⇒ armed on mount (parity, today's behaviour). Read off the same static
	// params as `tapSignal`.
	const tapArmSignal = tapEnabled ? tapArmAfterSignalOf(staticParams) : '';
	// The coded press surface takes `hidePrompt`; the instance param is the INVERSE
	// `tapShowPrompt` (default TRUE ⇒ prompt shown). So hide only when the author explicitly
	// turned the engine prompt OFF (they draw their own continue graphic). A freshly-enabled
	// tap surface shows the built-in `MM_pressanywhere` prompt by default.
	const tapHidePrompt = tapEnabled ? !tapShowPromptOf(staticParams) : false;

	// Complete-on-loaded (flow-driven-game §1): the FEED-TRIGGERED sibling of
	// tap-to-continue. A SHARED per-instance toggle any `overlay`-category instance can
	// switch on (no def declaration — same gating + parity discipline as `tapEnabled`).
	// When on, the engine subscribes the registered `assetsLoaded` BoolSource (the same
	// feed `visibleSource` gates on) and, on its RISING EDGE (false→true, fired ONCE),
	// advances the active Flow screen — so dropping a loading-bar component that carries
	// `completeOnLoaded: true` makes the flow's `complete` edge fire when boot loading
	// finishes. OFF by default ⇒ no subscription below ⇒ byte-identical. Init-stable like
	// the tap reads (the toggle lives on the placed instance, read once).
	const completeOnLoadedEnabled =
		allowed && def?.category === 'overlay' && isCompleteOnLoadedEnabled(staticParams);
	const loadedSignal = completeOnLoadedEnabled ? loadedSignalOf(staticParams) : '';
	// The boot-load feed the rising edge listens on — the SAME `assetsLoaded` source the
	// `visibleSource` path resolves (registered by the game via `registerComponentVisibility`).
	// Absent (game registered no such feed) ⇒ no subscription ⇒ inert (parity).
	const loadedSource: BoolSource | undefined = completeOnLoadedEnabled
		? getComponentVisibility('assetsLoaded')
		: undefined;

	// Engine value feed (§13.2 step 2 / Phase B2): if the resolved params name a
	// `source` AND the game registered a value store under it, subscribe and keep
	// the latest number in `liveValue`. The subscription lives in an `$effect` so
	// it re-binds if the registered store changes and tears down on unmount (the
	// returned unsubscribe is the effect cleanup). No source/provider ⇒ `liveValue`
	// stays undefined and the provided params equal B1's static map exactly (parity
	// — the `value` getter below then never appears).
	const source = typeof staticParams['source'] === 'string' ? staticParams['source'] : undefined;
	// Flow value dataflow (design doc §11.4): resolve the display's feed NAME through the Flow
	// interpreter's authored value-binding overrides before the store lookup, so an authored value
	// edge redirects which registered `ValueSource` this display subscribes to (a subscription
	// override, never a copy). NO resolver registered (no FlowDoc / inert interpreter) ⇒ `?.` short-
	// circuits and the `?? source` fallback yields the display's OWN feed verbatim ⇒ byte-identical
	// to today (parity §11.6). Resolved once at init, exactly like `source` above (same reactivity).
	const feed = source ? (getFlowValueSource()?.(node.id, source) ?? source) : undefined;
	const valueSource: ValueSource | undefined = feed ? getComponentValueSource(feed) : undefined;
	let liveValue = $state<number | string | undefined>(undefined);
	$effect(() => {
		if (!valueSource) return;
		return valueSource.subscribe((value) => {
			liveValue = value;
		});
	});

	// Engine instance-value feed (`registerInstanceValues`): the MAP sibling of the single `value`
	// feed above, keyed by this instance's NODE id. It supplies a full `engineProvided` values map
	// (title/message/…) to a scene instance the Flow interpreter shows GENERICALLY — one that gets
	// neither a `<Repeater>` `engineValues` prop nor a `<ConfirmDialog>` mount's instance binding, so
	// it would otherwise fall back to the def defaults. Resolved synchronously by node id (init-stable
	// like `valueSource`); the live map arrives via the subscription. No source registered for this
	// node ⇒ `undefined` ⇒ the prop/binding/def values stand (parity — byte-identical to today).
	const instanceValueSource: InstanceValueSource | undefined = getInstanceValueSource(node.id);
	let instanceValues = $state<Record<string, unknown> | undefined>(undefined);
	$effect(() => {
		if (!instanceValueSource) return;
		return instanceValueSource.subscribe((values) => {
			instanceValues = values;
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
	// SELECTED, for a card the engine feeds rather than an action registers: a `<Repeater>` item whose
	// `values` carry `selected: true` (the bet amount currently staked, the autoplay count currently
	// picked) reads as the button cascade's `active` flag, so the def's `imageSelected` frame paints the
	// current choice with no per-list engine code. Generic — ANY engine-fed instance can mark itself
	// selected — and additive: an action-registered `active` still wins on its own, so every existing
	// button is byte-identical (no feed ⇒ `boundEngineValues` is undefined ⇒ always false). Read as a
	// FUNCTION so the live prop/binding is re-read inside the cascade's getters (reactive), not frozen.
	const engineSelected = (): boolean =>
		(engineValues ?? binding?.engineValues)?.['selected'] === true;
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

	// Complete-on-loaded rising edge (flow-driven-game §1): when the instance enabled the
	// capability AND the game registered the `assetsLoaded` feed, subscribe it and fire
	// ONCE on the false→true transition. The `subscribe` contract emits synchronously with
	// the CURRENT value, so we seed `wasLoaded` from the first emit WITHOUT firing (an
	// instance mounted AFTER loading already finished must not retro-fire) and only act on a
	// later false→true edge — the real "loading just completed" moment. `fired` guards a
	// second edge (a feed that toggles back) from re-advancing. Each fire routes through the
	// game-registered Flow holder (`getFlowComplete`); UNREGISTERED ⇒ no-op (parity). The
	// interpreter's own `onComplete()` only fires an outgoing edge from the CURRENT active
	// screen, so even a stray fire after `loading` already advanced (coded press-to-continue)
	// matches nothing — no double-fire, the `fired` guard is belt-and-suspenders.
	let loadedSeeded = false;
	let wasLoaded = false;
	let fired = false;
	const fireLoaded = (): void => {
		fired = true;
		const flow = getFlowComplete();
		flow?.completeActiveScreen();
		if (loadedSignal) flow?.emitSignal(loadedSignal);
	};
	$effect(() => {
		if (!loadedSource) return;
		return loadedSource.subscribe((value) => {
			if (!loadedSeeded) {
				loadedSeeded = true;
				wasLoaded = value;
				// ALREADY loaded when this gate mounted ⇒ advance NOW. Under a v2 flow that DRIVES
				// screens the loading screen is mounted by `showContainer(loading)` AFTER boot assets
				// have settled, so `assetsLoaded` is already true on the first (synchronous) emit and
				// there is no later false→true edge to wait for. Firing on the seed makes the flow's
				// `complete` edge fire instead of stranding on loading. The CODED path mounts loading
				// at boot (assets not yet loaded ⇒ first emit false), so it is byte-identical — only a
				// gate that mounts post-load changes, and a stray fire matches nothing (see below).
				if (value && !fired) fireLoaded();
				return;
			}
			if (value && !wasLoaded && !fired) fireLoaded();
			wasLoaded = value;
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
		{
			nodeId: string;
			animation?: string;
			clipId?: string;
			loop?: boolean;
			completeSignal?: string;
		}[]
	> => {
		const map = new Map<
			string,
			{
				nodeId: string;
				animation?: string;
				clipId?: string;
				loop?: boolean;
				completeSignal?: string;
			}[]
		>();
		if (!allowed || !def) return map;
		const walk = (n: LayoutNode): void => {
			// A FLIPBOOK cue is the clip-swapping twin of a spine cue: same signal, same half-authored
			// guard — it just names a `clipId` instead of an animation, and has no `completeSignal`
			// (a clip reports no completion). Indexed into the SAME map (keyed by node id, so the two
			// payload shapes never meet on one entry).
			//
			// `cueSignalOverrides` remaps a flipbook cue exactly as it does a spine one — the field is
			// keyed by NODE id, not by kind — and the editor's "Flipbook (this placement)" panel
			// authors it, so two placements of one component can react to different moments.
			if (n.kind === 'flipbook' && n.cues?.length) {
				const rebinds = node.cueSignalOverrides?.[n.id];
				for (const cue of n.cues as FlipbookCue[]) {
					const signal = rebinds?.[cue.signal] || cue.signal;
					if (!signal || !cue.clipId) continue;
					const targets = map.get(signal) ?? [];
					targets.push({ nodeId: n.id, clipId: cue.clipId, loop: cue.loop });
					map.set(signal, targets);
				}
			} else if (n.kind === 'spine' && n.cues?.length) {
				const rebinds = node.cueSignalOverrides?.[n.id];
				for (const cue of n.cues as SpineCue[]) {
					// Per-instance signal rebinding (flow-driven-game §6 slice 3): this
					// placement may drive the cue from a DIFFERENT engine signal than the
					// def named. Remap the cue's original `signal` through the instance's
					// `cueSignalOverrides[nodeId]` BEFORE indexing — so the subscription
					// below listens on the override signal. No entry ⇒ the def signal
					// verbatim (parity).
					const signal = rebinds?.[cue.signal] || cue.signal;
					// A half-authored cue drives nothing: `addCue` seeds `animation: ''` and the picker
					// offers "(choose animation)" = `''`, and a fired cue whose animation is `''` is NOT
					// nullish — so it wins the `override?.animation ?? defaultAnimation` fall-through in
					// `LayoutNodeView`, unmounts the track and freezes the rig on its bind pose. Skip it
					// (mirrors the same guard in the scene-level cue effect there).
					if (!signal || !cue.animation) continue;
					const targets = map.get(signal) ?? [];
					targets.push({
						nodeId: n.id,
						animation: cue.animation,
						loop: cue.loop,
						completeSignal: cue.completeSignal,
					});
					map.set(signal, targets);
				}
			} else if (n.kind === 'container') {
				for (const child of n.children) walk(child);
			}
		};
		walk(def.root);
		return map;
	})();
	// Gate-referenced signals (Invisible Flow — intro-complete sequencing / FS-7 outro): the set of
	// component-scoped signals named by a `hiddenUntilSignal` on ANY node in the def tree, plus the
	// instance's own `tapArmAfterSignal`. A gate keyed on a GAME-registered signal (e.g. the FS-7
	// `freeSpinOutroBigWin`) that NO spine cue also references would otherwise never be recorded on the
	// per-instance bus — so plain art (a sprite) gated by `hiddenUntilSignal` would stay hidden forever.
	// Collecting them here lets the subscription `$effect` below also listen on those registered signals
	// (recording the fire without playing any cue). Empty when no gate is set ⇒ no new subscription
	// (parity). `enter` is fired by the visible-edge effect below, so both subscribe loops skip it
	// explicitly (`ENTER_SIGNAL`) — it must never take an open-bus subscription.
	const gateSignals = ((): Set<string> => {
		const set = new Set<string>();
		if (!allowed || !def) return set;
		const walk = (n: LayoutNode): void => {
			if (n.hiddenUntilSignal) set.add(n.hiddenUntilSignal);
			if (n.kind === 'container') for (const child of n.children) walk(child);
		};
		walk(def.root);
		if (tapArmSignal) set.add(tapArmSignal);
		return set;
	})();
	// Button-state-driven spine animations (the interaction analogue of the signal
	// cues above). Walk `def.root` once at init for `spine` nodes carrying a
	// `stateAnimations` map; index them by node id. Each interaction-state change then
	// resolves the cascade (see the `$effect` below) and writes the mapped animation
	// into `stateAnims[nodeId]`, which the spine prefers over its signal cue + default.
	// No such nodes ⇒ the map is empty and nothing is ever written (parity). Init-stable
	// like `signalToTargets` (a keyed instance never swaps its def).
	const stateAnimNodes = ((): Map<string, ButtonStateAnimations> => {
		const map = new Map<string, ButtonStateAnimations>();
		if (!allowed || !def) return map;
		const walk = (n: LayoutNode): void => {
			if (n.kind === 'spine') {
				// Overlay this placement's per-state override (if any) on the def's map —
				// so two instances of one button can play different state animations
				// (the spine analogue of a per-instance `imageHover` override). No
				// override ⇒ the def map verbatim (parity).
				const merged = mergeButtonStateAnimations(
					n.stateAnimations,
					node.stateAnimationOverrides?.[n.id],
				);
				if (merged) map.set(n.id, merged);
			} else if (n.kind === 'container') {
				for (const child of n.children) walk(child);
			}
		};
		walk(def.root);
		return map;
	})();

	let signalAnims = $state<Record<string, ComponentSignalAnim>>({});
	// A cue is an EVENT delivered as STATE, so every fire must be distinguishable from the last:
	// re-firing the same cue writes the same animation name, and the spine's value comparison then
	// reads "already playing" and never replays it (a second free-spin feature in one session left
	// the rig frozen on its finished track). This monotonic token rides along and forces the
	// re-apply. Per instance, so two placements of one def can't interfere.
	let signalFire = 0;
	const fireCue = (
		targets: {
			nodeId: string;
			animation?: string;
			clipId?: string;
			loop?: boolean;
			completeSignal?: string;
		}[],
	): void => {
		signalFire += 1;
		for (const t of targets) {
			// Exactly one of `animation` / `clipId` is set, decided by the cued node's kind when the
			// target was indexed — a spine reads the first, a flipbook the second.
			signalAnims[t.nodeId] = {
				animation: t.animation,
				clipId: t.clipId,
				loop: t.loop,
				fire: signalFire,
				completeSignal: t.completeSignal,
			};
		}
	};
	// Fired-signal bus (Invisible Flow — intro-complete sequencing): a per-instance fire-count per
	// component-scoped signal name. `enter` bumps it on the visible edge, a game-registered signal
	// bumps it when its book event arrives, and a spine one-shot's `completeSignal` bumps it on
	// completion (a descendant spine calls `fireComponentSignal` via context). Nodes gated by
	// `hiddenUntilSignal` read it to reveal; the tap surface reads it to arm. Reset per fresh mount
	// (a new `$state({})`), so a re-entered free-spin screen re-hides + re-arms. Provided to the
	// rendered sub-tree via context (the `$state` proxy, so descendant reads stay reactive).
	let firedSignals = $state<Record<string, number>>({});
	const fireComponentSignal = (signal: string | undefined): void => {
		if (!signal) return;
		firedSignals[signal] = (firedSignals[signal] ?? 0) + 1;
	};
	setComponentFiredSignals({ counts: firedSignals, fire: fireComponentSignal });
	// The tap surface arms once its gate signal has fired (or immediately when none is set). Reactive
	// so the tap-registration `$effect` below re-runs when the arming signal fires (e.g. intro done).
	const tapArmed = $derived(isTapArmed(tapArmSignal, firedSignals));
	// One `$effect` (re)subscribes to every referenced signal and returns a combined
	// cleanup — `$effect` can't live inside a loop, so iterate the precomputed map
	// inside it and collect each unsubscribe. A name the game never registered resolves to the
	// OPEN bus (`getComponentSignal` never returns `undefined`), so an author-named cue signal is
	// live too; a name nothing ever fires stays dormant (parity).
	//
	// The subscribe SETUP is `untrack`ed. A registered signal source may EMIT SYNCHRONOUSLY on
	// subscribe (the seed-on-subscribe latch — e.g. `freeSpinOutroCountUpComplete` fires `run()`
	// immediately when `freeSpinOutroState.countUpComplete` is already true, the fix for the
	// instant-count-up race). That synchronous emission runs the callback INSIDE this effect, and
	// `fireComponentSignal` READS + WRITES `firedSignals[signalKey]` — so without `untrack` the read
	// leaks as a dependency of THIS effect and the write immediately re-invalidates it, re-subscribing,
	// re-seeding, re-writing: an infinite reactive loop (`effect_update_depth_exceeded`). It surfaced on
	// a SLAMMED free-spin outro, where the count-up completes in the same tick the outro-visual instance
	// (its tap armed on `freeSpinOutroCountUpComplete`) mounts + subscribes, so the latch is already set.
	// The effect has no legitimate reactive deps — `signalToTargets`/`gateSignals`/the signal registry
	// are all init-stable — so it should subscribe exactly ONCE; `untrack` guarantees that (mirrors
	// `LayoutScene`'s tap-portal guard). The subscriptions still fire on every LATER emission (those run
	// outside this effect), and each fire still WRITES `firedSignals` so `hiddenUntilSignal`/`tapArmed`
	// consumers update — `untrack` suppresses dependency TRACKING, never the writes/notifications.
	$effect(() =>
		untrack(() => {
			const unsubs: (() => void)[] = [];
			for (const [signalKey, targets] of signalToTargets) {
				// `enter` is fired by THIS instance on its visible edge (see below) — never by a source.
				// It must not take an open-bus subscription: the bus is fed by every flow `fireCue` name,
				// so an author who typed `enter` as a scene cue would replay the intro of every mounted
				// component at once. Skipping keeps `enter` exactly as it was before the open bus existed.
				if (signalKey === ENTER_SIGNAL) continue;
				const source = getComponentSignal(signalKey);
				unsubs.push(
					source.subscribe(() => {
						fireCue(targets);
						// Also record the fire on the per-instance bus so a `hiddenUntilSignal`/`tapArmAfterSignal`
						// gate can key on a game signal (e.g. `win`), not only a spine `completeSignal`.
						fireComponentSignal(signalKey);
					}),
				);
			}
			// Gate-only signals: a `hiddenUntilSignal`/`tapArmAfterSignal` keyed on a registered signal that
			// NO spine cue references (plain art gated on e.g. `freeSpinOutroBigWin`). Subscribe to RECORD the
			// fire on the per-instance bus (no cue to play). Skip any already handled above (they record too).
			for (const signalKey of gateSignals) {
				if (signalKey === ENTER_SIGNAL) continue; // instance-fired — same reason as above.
				if (signalToTargets.has(signalKey)) continue;
				const source = getComponentSignal(signalKey);
				unsubs.push(source.subscribe(() => fireComponentSignal(signalKey)));
			}
			return () => {
				for (const unsub of unsubs) unsub();
			};
		}),
	);

	// `enter` is a COMPONENT-lifecycle signal the instance fires ITSELF — no game source
	// maps to it, so the game-registered loop above skips it. It plays each spine's `enter`
	// cue the moment the component becomes VISIBLE: on mount with the gate open, or when a
	// gate later OPENS (e.g. an intro animation the instant a gated "Free-spin intro"
	// screen appears). The gate is EITHER this instance's own `visibleSource` OR the
	// HOST SCREEN's `visibleSource` — the common case is the latter (the screen is gated
	// "Shows during …", the instance isn't), which is why we combine the scene-visibility
	// context here: without it the instance's own visibility is always `true`, so `enter`
	// fired once at boot (while the screen was hidden) and NEVER on the real appearance.
	// Tracks the visible edge so it fires once per appearance. (`exit`/`idle` are NOT
	// fired — an instant-hide gate would cut an exit animation and idle has no trigger.)
	const sceneVisible = getSceneVisibleContext();
	const selfVisible = $derived(
		(!visibilitySource || liveVisible) && (sceneVisible ? sceneVisible() : true),
	);
	// Re-publish the COMBINED visibility so a component nested inside THIS one fires its
	// own `enter` only when this instance (and its screen) are actually shown.
	setSceneVisibleContext(() => selfVisible);
	let wasVisible = false;
	$effect(() => {
		if (selfVisible && !wasVisible) {
			// Through `fireCue` too: a screen gated "Shows during …" can open a SECOND time (free
			// spins entered twice in one session), and a value-identical re-write would not replay.
			fireCue(signalToTargets.get(ENTER_SIGNAL) ?? []);
			// Record the `enter` fire on the per-instance bus so a `hiddenUntilSignal`/`tapArmAfterSignal`
			// gate can key on `enter` directly (appear on mount) as well as on a spine `completeSignal`.
			fireComponentSignal(ENTER_SIGNAL);
		}
		wasVisible = selfVisible;
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
	const interactive = (!!actionSource || !!onSelect) && !hasBindPart;

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
	// Per-layoutType param overlay (per-ratio font size, box size, colour, …): for every key an
	// override touches in ANY layoutType, expose a REACTIVE getter that returns the CURRENT
	// layoutType's override value (falling back to the static base when this layoutType has no
	// override for the key). Reactive because it reads `currentLayoutType()` inside the getter,
	// which runs inside a descendant's tracking scope — same discipline as the `value`/`label`
	// live feeds below. Defined BEFORE those feeds (and `configurable`) so a live engine feed
	// still redefines + wins for its key (a count-up `value` is never a per-ratio constant). The
	// init-stable STRUCTURAL reads above (`source`/`action`/`tapEnabled`/cues) read `staticParams`
	// directly, NOT `providedParams`, so they are untouched — structure never varies by ratio.
	for (const key of layoutOverrideParamKeys) {
		Object.defineProperty(providedParams, key, {
			enumerable: true,
			configurable: true,
			get: () => {
				const override = node.overrides?.[currentLayoutType()]?.params;
				return override && key in override ? override[key] : staticParams[key];
			},
		});
	}
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
		// A source that ALREADY animates (a live count-up tween) forwards a flag so a bound numeric
		// readout snaps to the live value instead of running its own `countUp` on top — the fix for
		// the double count-up (and for a tap-to-skip / slam showing the final total instantly). Stable
		// (set at registration), so a plain assignment; `<LayoutNodeView>` reads it as `valueSelfAnimated`.
		if (valueSource.selfAnimated) providedParams.valueSelfAnimated = true;
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
	// The PRESS — exposed whenever the instance names an `action` AT ALL, not only when the game
	// registered a feed for it. `firePress` consults the flow FIRST, so gating this on `actionSource`
	// made a bound action the flow OWNS unreachable in any game that doesn't register that action:
	// the pin showed up in `/flow-v2`, the author wired it, and the press silently did the coded
	// thing instead. (The case that exposed it: `hud-bet`'s `betMenu` in a game whose `Game.svelte`
	// predates `registerHudMenus` — the seeded doc carries the action, so the pin exists there.)
	// Parity holds either way: with no registered action AND no flow ownership `firePress` calls
	// `actionSource?.onpress?.()` on `undefined`, i.e. the same no-op as an absent param, and every
	// coded consumer (`ButtonFrame`, `HudValue`) already hit-tests regardless of whether it resolves.
	// A plain function reference, not a reactive getter — both read it lazily at click time.
	if (action) {
		Object.defineProperty(providedParams, 'onpress', {
			enumerable: true,
			get: () => firePress,
		});
	}
	// The live FLAGS, and only the ones the actionSource actually provides — same parity discipline
	// as `value`: an action without an `active` flag (e.g. `menu`) leaves the param to fall back to
	// the static map. No actionSource ⇒ none of these appear.
	if (actionSource) {
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
					active: liveActive === true || engineSelected(),
					spinning: liveSpinning === true,
				}) ?? restingImage,
		});
	}
	// Repeater-fed per-item values (§ feature cards / per-card param overrides): a `<Repeater>` (or a
	// `<ConfirmDialog>` mount binding) injects each item's values directly (title/price/iconKey/… AND
	// any card-param override like panelImage/spineKey/buttonImage). Define a REACTIVE getter for EVERY
	// def param whose key is present in `engineValues`, so a bound text/sprite/spine node reads the live
	// per-item value from the param context — the multi-value sibling of the single `value` feed above.
	//
	// The gate is the param KEY's presence in the injected map, NOT the `engineProvided` flag: a per-item
	// value overrides its param REGARDLESS of whether the def marks it engine-provided, so config
	// `cardParams` can vary the card's CHROME (a different panel/spine per card) through the one shared
	// component. A param NOT in the map keeps its authored default (staticParams) — byte-identical to a
	// plain instance (parity), and the `<ConfirmDialog>` binding (which supplies only its engineProvided
	// title/message/… keys) resolves exactly as before, since only those keys are `in boundEngineValues`.
	const boundEngineValues = engineValues ?? binding?.engineValues;
	if (boundEngineValues) {
		for (const param of def?.params ?? []) {
			if (param.key in boundEngineValues) {
				const key = param.key;
				// Read the LIVE values (prop, else the mount's binding getter) — NOT a frozen snapshot —
				// so a repeated card's `price` (bet change) or a dialog's `title`/`message` (a new mode
				// picked) updates in place without re-mounting. Destructured props + the binding's getter
				// both stay reactive inside this getter.
				Object.defineProperty(providedParams, key, {
					enumerable: true,
					get: () => (engineValues ?? binding?.engineValues)?.[key],
				});
			}
		}
	} else if (instanceValueSource) {
		// Flow path (`registerInstanceValues`): NEITHER a `<Repeater>` prop NOR a `<ConfirmDialog>`
		// mount binding supplied values — this instance was shown GENERICALLY by the interpreter
		// (`showContainer(buyConfirm)`), so the node-id-keyed feed is the supplier. The `else if`
		// GUARANTEES the imperative path always wins (prop/binding ?? THIS ?? def default): a mount
		// present ⇒ this branch never runs, so the imperative path is byte-identical. Gated on the
		// SOURCE existing (init-stable), not on the live map, so the getters are defined before the
		// first emit. Each getter falls back to `staticParams[key]` (the def default) until the live
		// map carries the key — so a partial feed never blanks a param, matching the `key in …` guard
		// the prop/binding branch uses. Reactive: reading `instanceValues` inside the getter re-runs a
		// bound text/sprite node's `$derived` when the picked mode changes (a new title/message).
		for (const param of def?.params ?? []) {
			if (!param.engineProvided) continue;
			const key = param.key;
			Object.defineProperty(providedParams, key, {
				enumerable: true,
				get: () => instanceValues?.[key] ?? staticParams[key],
			});
		}
	}
	setComponentParams(allowed && def ? providedParams : {});
	// Provide the per-node press router to the rendered sub-tree (`componentActionsContext`): a node
	// carrying `pressAction: '<name>'` calls this to route its press to the instance's action of that
	// name — the `actions` PROP (direct render) else the mount's binding (a `<ConfirmDialog>` scene
	// instance). The N-button generalisation of the whole-instance `onSelect`. Reads the live source
	// inside the closure so a later binding value stays honoured. No action for `<name>` ⇒ inert
	// (parity — a def with no `pressAction` node never calls it). Set at init like the other contexts.
	//
	// Flow press routing (Invisible Flow v2, §Part 2 — the confirm-dialog analogue of the `firePress`
	// gate below and the `<Repeater>` `onSelect` gate): consult the registered resolver AT CALL TIME
	// with `(node.id, name)` — WHICH is the fused container-event pin `<node.id>.on<Name>` (e.g. a
	// flow-shown `buyConfirm` scene's `confirm-dialog.onConfirm`/`.onCancel`). When the flow OWNS it
	// (an authored exec edge from that pin) the press routes to the flow ALONE and the coded
	// `pressAction` binding is SUPPRESSED so the two never double-fire. Nothing registered / not owned
	// ⇒ `getFlowPress()` is undefined or returns undefined ⇒ the Phase-2 `instanceBindingContext`
	// action (the imperative `<ConfirmDialog>`'s `onConfirm`/`onCancel`) runs EXACTLY as today (parity).
	setComponentPress((name) => {
		const routed = getFlowPress()?.(node.id, name);
		if (routed) {
			routed();
			return;
		}
		(actions ?? binding?.actions)?.[name]?.();
	});
	// Provide the signal-driven spine-anim overrides to the rendered sub-tree (the
	// `$state` proxy, so a descendant spine's `{@const}` read re-runs on each signal
	// fire — same stable-object discipline as `setComponentParams`). `{}` when the
	// instance can't expand, so a descendant never reads a stale PARENT instance's map.
	setComponentSignalAnims(allowed && def ? signalAnims : {});

	// Resolve each state-spine's animation from the LIVE interaction flags and publish
	// it on the state-anim context (same stable-`$state`-proxy discipline as the signal
	// map). Only meaningful when THIS instance owns the press (`interactive`): a spine
	// in a non-button component, or with no `stateAnimations`, never gets an entry, so
	// it falls through to its signal cue / `defaultAnimation` (parity). When the current
	// state cascades to nothing, the node's entry is cleared so the spine returns to its
	// resting `defaultAnimation`.
	let stateAnims = $state<Record<string, { animation: string; loop?: boolean }>>({});
	$effect(() => {
		if (!interactive || stateAnimNodes.size === 0) return;
		const flags = {
			hovered,
			pressed,
			disabled: liveDisabled === true,
			active: liveActive === true || engineSelected(),
			spinning: liveSpinning === true,
		};
		for (const [nodeId, map] of stateAnimNodes) {
			const resolved = resolveButtonStateAnimation(map, flags);
			if (resolved) stateAnims[nodeId] = { animation: resolved.animation, loop: resolved.loop };
			else if (stateAnims[nodeId]) delete stateAnims[nodeId];
		}
	});
	setComponentStateAnims(allowed && def ? stateAnims : {});
	// Per-instance RESTING spine overrides (default animation / loop / skin) — static
	// per placement, so provided once at init (no `$effect`). No overrides ⇒ `{}` ⇒
	// each spine uses its def values (parity). Read by `<LayoutNodeView>`'s spine block.
	setComponentSpineRest(allowed && def ? (node.spineRestOverrides ?? {}) : {});

	// Flow press routing (Invisible Flow v2, §Part 2): consult the registered press resolver AT CALL
	// TIME (so ownership reflects the LIVE v2 handle regardless of boot timing) — when the flow OWNS
	// this container event (an authored exec edge from the fused `<node.id>.on<action>` pin) the press
	// routes to the flow ALONE (its wired chain invokes the intent), and the coded `onpress` is
	// SUPPRESSED so the two never double-fire. Nothing registered / not owned ⇒ `getFlowPress()` is
	// undefined or returns undefined ⇒ the coded `actionSource?.onpress?.()` runs ⇒ byte-identical parity.
	const firePress = () => {
		// A repeater-injected `onSelect` OWNS the press (the item's `select` handler) — the
		// per-item card carries no `action`/flow wiring, so it short-circuits ahead of them.
		if (onSelect) {
			onSelect();
			return;
		}
		const routed = action ? getFlowPress()?.(node.id, action) : undefined;
		if (routed) routed();
		else actionSource?.onpress?.();
	};

	const cursor = $derived(liveDisabled ? 'not-allowed' : 'pointer');
	const onpress = () => {
		if (liveDisabled) return;
		firePress();
	};

	// Hoist the tap-to-continue surface to the CANVAS frame. The surface is conceptually
	// full-window (dim + hit area + prompt), so it must escape BOTH this instance's
	// transform AND its host scene's `MainContainer` (which scales `game`/`standard`-space
	// scenes to the design box — rendering a "full-canvas" dim there shrinks it to a band
	// over the logo). Preferred path: register with the scene's tap PORTAL
	// (`tapPortalContext`), which `LayoutScene` renders at its own top level, outside the
	// `MainContainer`, in true canvas space (parity with the engine-owned free-spin gate).
	// SPLIT so the authored layer order is honoured: the `dim` backdrop is registered
	// separately (`LayoutScene` draws it BEHIND the scene content when the author placed
	// content above this tap node, else in front — visually unchanged for a topmost tap) while
	// the interactive hit area + prompt (`tapInteractive`, with the dim turned OFF here so it
	// isn't double-drawn) ALWAYS paint on top. (For a topmost tap with a dim the surface is
	// visually/functionally identical to before, not literally byte-identical: `tapInteractive`
	// carries an extra alpha-0 rect. The transparent-tap loading screen IS byte-identical.) When registered we leave the bindable `tap` UNDEFINED so `LayoutNodeView`
	// does NOT also render it inline (no double). FALLBACK: no scene portal in scope (an
	// instance used outside any `LayoutScene`) ⇒ hand the WHOLE `tapSurface` (dim + hit +
	// prompt together) up via `tap` for the legacy sibling hoist, byte-identical to before.
	// OFF (no tap) ⇒ nothing registered and `tap` undefined ⇒ byte-identical.
	const tapPortal = getTapPortal();
	$effect(() => {
		// Not a tap overlay, OR the tap is gated on a signal that hasn't fired yet, OR the overlay is
		// not currently VISIBLE ⇒ mount NOTHING, so taps pass straight through and no prompt renders.
		// `tapArmed` gates on the arming signal (e.g. the intro's `completeSignal`); `selfVisible`
		// gates on the instance actually being shown — a tap-enabled overlay that lives in a
		// PERSISTENTLY-mounted layer (e.g. the base-game-overlays Win slot) must NOT paint its
		// full-screen "press anywhere" surface while it is hidden between wins. Both are reactive, so
		// this effect re-runs and registers the surface the moment the overlay arms AND becomes
		// visible. A flow-shown container mounts only when shown (`selfVisible` true then) and an
		// un-gated always-on overlay stays `selfVisible` true, so both are byte-identical to before.
		if (!tapComponent || !tapArmed || !selfVisible) {
			tap = undefined;
			return;
		}
		if (tapPortal) {
			tap = undefined;
			// Only hand up a dim when it would actually draw something (alpha > 0), so a fully
			// transparent tap registers no backdrop — nothing renders behind the content.
			tapPortal.register(node.id, {
				dim: tapDimAlpha > 0 ? tapDim : undefined,
				tap: tapInteractive,
			});
			return () => tapPortal.unregister(node.id);
		}
		tap = tapSurface;
	});
</script>

{#snippet tapSurface()}
	{#if tapComponent}
		{@const TapComponent = tapComponent}
		<TapComponent
			signal={tapSignal}
			dimColor={tapDimColor}
			dimAlpha={tapDimAlpha}
			hidePrompt={tapHidePrompt}
		/>
	{/if}
{/snippet}

{#snippet tapDim(zIndex: number)}
	<CanvasSizeRectangle {zIndex} backgroundColor={tapDimColor} backgroundAlpha={tapDimAlpha} />
{/snippet}

{#snippet tapInteractive()}
	{#if tapComponent}
		{@const TapComponent = tapComponent}
		<TapComponent
			signal={tapSignal}
			dimColor={tapDimColor}
			dimAlpha={0}
			hidePrompt={tapHidePrompt}
		/>
	{/if}
{/snippet}

{#snippet rendered(root: LayoutNode)}
	{#if interactive}
		<!-- `none` while DISABLED so an inert button does not SWALLOW the pointer — the press
			 falls through to the overlay beneath the chrome. See `components-pixi/Button.svelte`. -->
		<Container
			eventMode={liveDisabled ? 'none' : 'static'}
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
			<LayoutNodeView node={root} space={childSpace} />
		</Container>
	{:else}
		<LayoutNodeView node={root} space={childSpace} />
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
