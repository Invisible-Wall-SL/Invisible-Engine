/**
 * Pin-derivation (design doc §3/§4) — project a LayoutDoc screen into a screen node's
 * DYNAMIC pins. The pins are NOT a new vocabulary: they are a projection of the four
 * existing `engine-layout` registries a component's bindings already carry —
 *
 *   value  ← `registerComponentValues`     (a component-instance `source` param)
 *   action ← `registerComponentActions`    (a button instance `action` param)
 *   gate   ← `registerComponentVisibility` (a `visibleSource` param / scene gate)
 *   signal ← `registerComponentSignals`    (a spine cue's `signal` in the resolved tree)
 *
 * plus the FIXED structural pins every screen node carries (`enter`, `complete`, `active`).
 * This module is pure + Svelte-free (no engine registry calls — it reads the AUTHORED doc,
 * which is what the editor has), so it runs headlessly and in the launcher loader alike.
 *
 * Stable pin identity (design doc §4/§12): a dynamic pin id is the composite
 * `${instanceId}::${role}:${key}`, keyed by the LayoutDoc node's persisted `id` — so a
 * wire survives renames (label changes, id doesn't) and reorders (position changes, id
 * doesn't). A structural pin id is `${screenId}::${role}`. Deleting the backing component
 * orphans its pin (flagged `orphaned`) rather than dropping it silently.
 */

import type {
	ComponentDef,
	ComponentInstanceNode,
	LayoutNode,
	Scene,
	SpineNode,
} from 'engine-layout';
import type { FlowPin, FlowPinRole } from './types';

/** The canonical instance-param keys the four registries bind through (design doc §3).
 *  Mirrors the editor's `source` / `action` / `visibleSource` param conventions
 *  (`registerComponentValues` / `registerComponentActions` / `registerComponentVisibility`). */
const PARAM_KEY = {
	value: 'source',
	action: 'action',
	gate: 'visibleSource',
} as const;

/** Resolves a component id to its {@link ComponentDef}. The caller supplies the project's
 *  loaded defs (the launcher already loads these via `listComponents`); a missing def ⇒
 *  the instance's pins are derived from its own params only, and its instance pins that
 *  cannot be resolved are flagged `orphaned` (design doc §4). */
export type ComponentDefResolver = (componentId: string) => ComponentDef | undefined;

/** Merge an instance's effective params: def defaults (low) ◁ instance overrides (high).
 *  A local copy of `resolveComponentParams`' precedence kept Svelte-free + dependency-free
 *  for the headless derivation (project defaults are an editor-runtime concern, omitted). */
const resolveParams = (
	def: ComponentDef | undefined,
	instance: ComponentInstanceNode,
): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const param of def?.params ?? []) {
		if (param.default !== undefined) out[param.key] = param.default;
	}
	for (const [key, value] of Object.entries(instance.params ?? {})) {
		if (value !== undefined) out[key] = value;
	}
	return out;
};

/** Collect the spine-cue signal keys declared in a node tree (the def's resolved root). */
const collectSignals = (nodes: LayoutNode[], out: Set<string>): void => {
	for (const node of nodes) {
		if (node.kind === 'spine') {
			for (const cue of (node as SpineNode).cues ?? []) out.add(cue.signal);
		}
		const children = (node as { children?: LayoutNode[] }).children;
		if (Array.isArray(children)) collectSignals(children, out);
	}
};

const structuralPin = (
	screenId: string,
	role: Extract<FlowPinRole, 'enter' | 'complete' | 'active'>,
): FlowPin => {
	const direction = role === 'enter' ? 'in' : role === 'active' ? 'state' : 'out';
	const label = role === 'enter' ? 'Enter' : role === 'complete' ? 'Complete' : 'Active';
	return { id: `${screenId}::${role}`, role, direction, label };
};

const dynamicPin = (
	instanceId: string,
	role: Extract<FlowPinRole, 'value' | 'action' | 'gate' | 'signal'>,
	key: string,
	label: string,
	orphaned: boolean,
): FlowPin => {
	const direction = role === 'action' ? 'out' : 'in';
	return {
		id: `${instanceId}::${role}:${key}`,
		role,
		direction,
		key,
		instanceId,
		label,
		...(orphaned ? { orphaned: true } : {}),
	};
};

/** Walk a scene's node tree and project each component-instance's bindings into pins.
 *  Recurses into containers; `bind` anchors with `props.{source,action,visibleSource}`
 *  (the freeform escape hatch the HUD uses) project the same dynamic pins additively. */
const derivePinsFromNodes = (
	nodes: LayoutNode[],
	resolve: ComponentDefResolver,
	out: FlowPin[],
): void => {
	for (const node of nodes) {
		if (node.kind === 'componentInstance') {
			const instance = node as ComponentInstanceNode;
			const def = resolve(instance.componentId);
			const orphaned = !def; // backing def gone ⇒ flag, never silently drop (§4)
			const params = resolveParams(def, instance);
			const labelBase = instance.label ?? def?.name ?? instance.componentId;

			const source = params[PARAM_KEY.value];
			if (typeof source === 'string') {
				out.push(dynamicPin(instance.id, 'value', source, `${labelBase} · ${source}`, orphaned));
			}
			const action = params[PARAM_KEY.action];
			if (typeof action === 'string') {
				out.push(dynamicPin(instance.id, 'action', action, `${labelBase} · ${action}`, orphaned));
			}
			const gate = params[PARAM_KEY.gate];
			if (typeof gate === 'string') {
				out.push(dynamicPin(instance.id, 'gate', gate, `${labelBase} · ${gate}`, orphaned));
			}
			if (def) {
				const signals = new Set<string>();
				collectSignals([def.root], signals);
				for (const signal of signals) {
					out.push(dynamicPin(instance.id, 'signal', signal, `${labelBase} · ${signal}`, false));
				}
			}
		} else if (node.bind?.props) {
			// Freeform `bind` anchor (the HUD escape hatch): project the same pins from props.
			const props = node.bind.props;
			const labelBase = node.label ?? node.bind.component;
			for (const [role, paramKey] of Object.entries(PARAM_KEY) as [
				keyof typeof PARAM_KEY,
				string,
			][]) {
				const value = props[paramKey];
				if (typeof value === 'string') {
					out.push(dynamicPin(node.id, role, value, `${labelBase} · ${value}`, false));
				}
			}
		}
		const children = (node as { children?: LayoutNode[] }).children;
		if (Array.isArray(children)) derivePinsFromNodes(children, resolve, out);
	}
};

/**
 * Options for {@link deriveScreenPins} — the intent-host projection (design doc §8). The CALLER
 * decides which screen is the intent host + supplies the game's action vocabulary; this module
 * stays pure/headless (it never reads the `registerComponentActions` registry itself).
 */
export interface DeriveScreenPinsOptions {
	/** The game's registered action vocabulary — the union of action KEYS a button anywhere can
	 *  fire (e.g. `['spin']`). One INTENT input pin is derived per key, but ONLY on the host. */
	intents?: string[];
	/** True when THIS screen is the intent host (design doc §8.6). Only then are intent pins added. */
	isIntentHost?: boolean;
}

/** Build an intent input pin for the host screen (design doc §8.3). Structural-style stable id
 *  `${screenId}::intent:${key}` so a wire survives relabels. Not tied to a scene node. */
const intentPin = (screenId: string, key: string): FlowPin => ({
	id: `${screenId}::intent:${key}`,
	role: 'intent',
	direction: 'in',
	key,
	label: `Intent · ${key}`,
});

/**
 * Derive the full pin set for one screen (a LayoutDoc {@link Scene}): the three fixed
 * structural pins plus every dynamic pin projected from the scene's components and its
 * scene-level visibility gate. When `options.isIntentHost`, one intent INPUT pin per intent
 * key is added right after the structural pins (design doc §8). Deterministic + order-stable
 * (structural → intents → dynamic in tree order), so two derivations of the same doc produce
 * identical ids.
 */
export const deriveScreenPins = (
	scene: Scene,
	resolve: ComponentDefResolver,
	options: DeriveScreenPinsOptions = {},
): FlowPin[] => {
	const pins: FlowPin[] = [
		structuralPin(scene.id, 'enter'),
		structuralPin(scene.id, 'active'),
		structuralPin(scene.id, 'complete'),
	];
	// Intent input pins — only on the intent host (design doc §8.6), one per registered action key,
	// in stable key order so ids/order are deterministic. Placed right after the structural pins.
	if (options.isIntentHost && options.intents?.length) {
		for (const key of options.intents) pins.push(intentPin(scene.id, key));
	}
	// The whole-screen lifecycle gate (`Scene.visibleSource`) is a gate pin on the screen
	// itself (keyed by the scene id, role `gate`) — the same `registerComponentVisibility`
	// registry a component's `visibleSource` binds to (design doc §2/§4).
	if (typeof scene.visibleSource === 'string') {
		pins.push({
			id: `${scene.id}::gate:${scene.visibleSource}`,
			role: 'gate',
			direction: 'in',
			key: scene.visibleSource,
			label: `Screen · ${scene.visibleSource}`,
		});
	}
	derivePinsFromNodes(scene.nodes, resolve, pins);
	return pins;
};
