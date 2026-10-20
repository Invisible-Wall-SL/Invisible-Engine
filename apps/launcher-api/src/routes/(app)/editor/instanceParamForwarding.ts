import {
	effectParamValue,
	type EffectParam,
	type EffectParamKind,
	type EffectParamValue,
} from 'engine-fx';
import {
	ACTION_PARAM,
	BUTTON_STATE_PARAMS,
	COMPLETE_ON_LOADED_PARAMS,
	ENGINE_BINDING_PARAMS,
	ENGINE_PARAM_CATALOG,
	FORWARDED_PARAM_PREFIX,
	TAP_TO_CONTINUE_PARAMS,
	VISIBLE_SOURCE_PARAM,
	forwardedParams,
	resolveComponentParams,
	type ComponentDef,
	type ComponentInstanceNode,
	type ComponentParam,
	type EffectNode,
	type LayoutNode,
} from 'engine-layout';

/**
 * Forwarding a nested instance's param from the component it sits in (the Components side's
 * "⇡ Expose on ‹parent›"): the instance's `paramBindings['params.<key>']` names a param of the
 * open def, which the game resolves into the instance (`forwardInstanceParams`, engine-layout).
 * A placed effect's exposed parameter forwards the same way (`params.<id>`, read by
 * `placedFxParamValues`). Pure edits over the draft, so `check:component-param-forwarding` and
 * `check:fx-node-params` run them.
 */

/**
 * Keys an exposed param never takes: the engine catalog's, and the ones a placed instance reads
 * for its own behaviour or overwrites with a live value (`ComponentInstance.svelte`). An exposed
 * `source` or `action` would make the parent itself subscribe to a feed or take presses.
 */
const RESERVED_PARENT_KEYS: ReadonlySet<string> = new Set([
	...ENGINE_PARAM_CATALOG.map((p) => p.key),
	...ENGINE_BINDING_PARAMS.map((p) => p.key),
	...TAP_TO_CONTINUE_PARAMS.map((p) => p.key),
	...COMPLETE_ON_LOADED_PARAMS.map((p) => p.key),
	...BUTTON_STATE_PARAMS.map((p) => p.key),
	ACTION_PARAM,
	VISIBLE_SOURCE_PARAM,
	'value',
	'valueFormat',
	'valueSelfAnimated',
	'source',
	'onpress',
	'hold',
	'disabled',
	'active',
	'spinning',
	'text',
	'label',
]);

/** The parent param `node`'s `childKey` is forwarded from, or `undefined` when it uses its own. */
export function forwardedFrom(node: LayoutNode, childKey: string): string | undefined {
	return forwardedParams(node).find(([key]) => key === childKey)?.[1];
}

/** The open def's params a nested instance's `child` param can be linked to: the same kind. */
export function linkableParentParams(
	parent: ComponentDef,
	child: ComponentParam,
): ComponentParam[] {
	return (parent.params ?? []).filter((p) => p.kind === child.kind);
}

/** `base`, else `base_2`, `base_3`… — free on `parent` and not a reserved key. */
export function uniqueParentKey(parent: ComponentDef, base: string): string {
	const taken = new Set((parent.params ?? []).map((p) => p.key));
	const free = (key: string): boolean => !taken.has(key) && !RESERVED_PARENT_KEYS.has(key);
	if (free(base)) return base;
	let i = 2;
	while (!free(`${base}_${i}`)) i++;
	return `${base}_${i}`;
}

/**
 * The group a copy of grouped `child` param takes on the parent: the group a param of the SAME
 * instance and child group already went to (a text's text, font and size stay together), else
 * the child's group made unique on the parent ("Title 2"), so two placements never share one.
 */
function parentGroupFor(
	parent: ComponentDef,
	node: LayoutNode,
	childDef: ComponentDef,
	child: ComponentParam,
): string | undefined {
	if (!child.group) return undefined;
	for (const [childKey, parentKey] of forwardedParams(node)) {
		const sibling = childDef.params?.find((p) => p.key === childKey);
		if (sibling?.group !== child.group) continue;
		const group = parent.params?.find((p) => p.key === parentKey)?.group;
		if (group) return group;
	}
	const used = new Set((parent.params ?? []).map((p) => p.group).filter(Boolean));
	let group = child.group;
	for (let i = 2; used.has(group); i++) group = `${child.group} ${i}`;
	return group;
}

function setForward(node: LayoutNode, childKey: string, parentKey: string | undefined): void {
	const bindings: Record<string, string> = { ...(node.paramBindings ?? {}) };
	if (parentKey) bindings[FORWARDED_PARAM_PREFIX + childKey] = parentKey;
	else delete bindings[FORWARDED_PARAM_PREFIX + childKey];
	node.paramBindings = Object.keys(bindings).length ? bindings : undefined;
}

/**
 * "⇡ Expose on ‹parent›": declare a param on `parent` copying the nested instance's `childKey`
 * param (kind, label, group, options, the params a `component` param feeds), defaulting to the
 * value the instance shows now (its own value ◁ the child's project defaults ◁ the child's
 * default), and forward the instance's param from it. A rig-name param's `spineParam` follows to
 * the parent's copy of that rig param when it is forwarded too, else it is dropped; a rig param
 * exposed after its animation params hands them its key. Returns the new key, or `null` when
 * nothing was done (unknown, engine-provided or already forwarded).
 */
export function exposeInstanceParam(
	parent: ComponentDef,
	node: ComponentInstanceNode,
	childDef: ComponentDef,
	childKey: string,
	childProjectDefaults?: Record<string, unknown>,
): string | null {
	const child = childDef.params?.find((p) => p.key === childKey);
	if (!child || child.engineProvided || forwardedFrom(node, childKey)) return null;
	const key = uniqueParentKey(parent, childKey);
	const decl: ComponentParam = { key, kind: child.kind, author: true };
	if (child.label) decl.label = child.label;
	const group = parentGroupFor(parent, node, childDef, child);
	if (group) decl.group = group;
	if (child.options?.length) decl.options = [...child.options];
	if (child.fedParams?.length) decl.fedParams = [...child.fedParams];
	const rigKey = child.spineParam ? forwardedFrom(node, child.spineParam) : undefined;
	if (rigKey && parent.params?.some((p) => p.key === rigKey && p.kind === 'spine'))
		decl.spineParam = rigKey;
	const current = resolveComponentParams(childDef, node.params, childProjectDefaults)[childKey];
	if (current !== undefined) decl.default = current;
	const params = [...(parent.params ?? [])];
	if (child.kind === 'spine') {
		for (const [forwardedKey, parentKey] of forwardedParams(node)) {
			if (childDef.params?.find((p) => p.key === forwardedKey)?.spineParam !== childKey) continue;
			const i = params.findIndex((p) => p.key === parentKey && !p.spineParam);
			if (i >= 0 && params[i].author) params[i] = { ...params[i], spineParam: key };
		}
	}
	parent.params = [...params, decl];
	setForward(node, childKey, key);
	return key;
}

/** Forward the instance's `childKey` from an existing `parentKey` of the same kind. */
export function linkInstanceParam(
	parent: ComponentDef,
	node: LayoutNode,
	childDef: ComponentDef,
	childKey: string,
	parentKey: string,
): boolean {
	const child = childDef.params?.find((p) => p.key === childKey);
	if (!child || child.engineProvided) return false;
	if (!linkableParentParams(parent, child).some((p) => p.key === parentKey)) return false;
	setForward(node, childKey, parentKey);
	return true;
}

/** Stop forwarding `childKey`: the instance uses its own value again; the parent param stays. */
export function unlinkInstanceParam(node: LayoutNode, childKey: string): boolean {
	if (!forwardedFrom(node, childKey)) return false;
	setForward(node, childKey, undefined);
	return true;
}

/**
 * Write the value a nested instance shows for `key`: the default of the parent param it is
 * forwarded from, when it is (its own value would be hidden behind the forward), else its own.
 */
export function writeInstanceParam(
	parent: ComponentDef,
	node: ComponentInstanceNode,
	key: string,
	value: unknown,
): void {
	const parentKey = forwardedFrom(node, key);
	const target = parentKey ? parent.params?.find((p) => p.key === parentKey) : undefined;
	if (target && parent.params) {
		parent.params = parent.params.map((p) => (p === target ? { ...p, default: value } : p));
		return;
	}
	node.params = { ...node.params, [key]: value };
}

/** The component param kind an effect parameter is exposed as. */
const EFFECT_PARAM_COMPONENT_KIND = {
	number: 'number',
	bool: 'boolean',
	color: 'color',
} as const satisfies Record<EffectParamKind, ComponentParam['kind']>;

/** The open def's params a placed effect's `param` can be taken from: the matching kind. */
export function linkableEffectParentParams(
	parent: ComponentDef,
	param: EffectParam,
): ComponentParam[] {
	const kind = EFFECT_PARAM_COMPONENT_KIND[param.kind];
	return (parent.params ?? []).filter((p) => p.kind === kind);
}

/**
 * "⇡ Expose on ‹parent›" for a placed effect's exposed parameter: declare a param on `parent` of the
 * matching kind (a colour one holds `0xrrggbb`, as every colour param does), defaulting to the
 * value the node shows now (its own value, else the parameter's default), and take the parameter
 * from it. Returns the new key, or `null` when it is already taken from the parent.
 */
export function exposeEffectParam(
	parent: ComponentDef,
	node: EffectNode,
	param: EffectParam,
): string | null {
	if (forwardedFrom(node, param.id)) return null;
	const key = uniqueParentKey(parent, param.id);
	const current = effectParamValue(param, node.params?.[param.id]);
	const decl: ComponentParam = {
		key,
		kind: EFFECT_PARAM_COMPONENT_KIND[param.kind],
		author: true,
		default: typeof current === 'string' ? parseInt(current.slice(1), 16) : current,
	};
	parent.params = [...(parent.params ?? []), decl];
	setForward(node, param.id, key);
	return key;
}

/** Take a placed effect's `param` from the open def's existing `parentKey` of the matching kind. */
export function linkEffectParam(
	parent: ComponentDef,
	node: EffectNode,
	param: EffectParam,
	parentKey: string,
): boolean {
	if (!linkableEffectParentParams(parent, param).some((p) => p.key === parentKey)) return false;
	setForward(node, param.id, parentKey);
	return true;
}

/** Set (or, with `undefined`, clear) a placed effect's own value for parameter `id`. */
export function setEffectParamValue(
	node: EffectNode,
	id: string,
	value: EffectParamValue | undefined,
): void {
	const params = { ...node.params };
	if (value === undefined) delete params[id];
	else params[id] = value;
	node.params = Object.keys(params).length ? params : undefined;
}
