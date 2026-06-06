import type {
	ComponentCategory,
	ComponentDef,
	ComponentParam,
	ComponentSignal,
	ContainerNode,
	SlotKind,
	TemplateSlot,
} from 'engine-layout';
import {
	editorComponentKey,
	projectComponentKey,
	projectComponentsPrefix,
	sharedComponentsPrefix,
} from './projectPaths';
import { getObjectText, listAllKeys, putObjectText } from './r2';

const CATEGORIES = new Set<ComponentCategory>(['ui', 'overlay', 'scenery']);
const SLOT_KINDS = new Set<SlotKind>(['sprite', 'spine', 'text', 'mount']);

/**
 * Resolve a component def (§8.3). PROJECT shadows SHARED: with a `projectKey`,
 * the project key (`editor/<projectKey>/components/<id>.json`) is tried first and
 * the shared key (`_shared/editor-components/<id>.json`) is the fallback — exactly
 * like `loadTemplate`'s R2-over-built-in precedence. A malformed/unreadable R2
 * object never throws; it just falls through to the next source. Returns
 * `undefined` only when neither scope has a usable def for `id`.
 */
export async function loadComponent(
	id: string,
	projectKey?: string,
): Promise<ComponentDef | undefined> {
	if (projectKey) {
		const project = await readComponent(projectComponentKey(projectKey, id));
		if (project) return project;
	}
	return readComponent(editorComponentKey(id));
}

/** Read + normalize one component key, swallowing any read/parse failure. */
async function readComponent(key: string): Promise<ComponentDef | undefined> {
	let raw: string | null;
	try {
		raw = await getObjectText(key);
	} catch {
		return undefined;
	}
	if (!raw) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (isComponentShape(parsed)) return normalizeComponent(parsed);
	} catch {
		return undefined;
	}
	return undefined;
}

/**
 * Persist an authored component to its scope's R2 key (§8.3). Validates the
 * minimum contract first and throws a descriptive Error on a bad payload, so the
 * write only ever happens for a well-formed def. A `scope: 'shared'` def (or one
 * saved with no `projectKey`) goes to the shared key; a `scope: 'project'` def
 * with a `projectKey` goes to that project's key.
 */
export async function saveComponent(component: ComponentDef, projectKey?: string): Promise<void> {
	const normalized = validateComponent(component);
	// A `scope:'project'` def MUST be saved with a projectKey — never silently
	// downgrade it to the shared library (that would publish a project-local
	// component repo-wide).
	if (normalized.scope === 'project' && !projectKey) {
		throw new Error('A project-scoped component requires a projectKey.');
	}
	const key =
		normalized.scope === 'project'
			? projectComponentKey(projectKey as string, normalized.id)
			: editorComponentKey(normalized.id);
	await putObjectText(key, JSON.stringify(normalized, null, 2), 'application/json');
}

export interface ListComponentsOptions {
	projectKey?: string;
	scope?: 'shared' | 'project';
	category?: ComponentCategory;
}

/**
 * List components, project shadowing shared by id (a project def of the same id
 * hides the shared one). Filters by `scope`/`category` when given. Malformed
 * entries are skipped, never thrown.
 */
export async function listComponents(opts: ListComponentsOptions): Promise<ComponentDef[]> {
	const byId = new Map<string, ComponentDef>();

	if (opts.scope !== 'project') {
		for (const def of await listFromPrefix(sharedComponentsPrefix)) {
			byId.set(def.id, def);
		}
	}
	if (opts.scope !== 'shared' && opts.projectKey) {
		for (const def of await listFromPrefix(projectComponentsPrefix(opts.projectKey))) {
			byId.set(def.id, def);
		}
	}

	let defs = [...byId.values()];
	if (opts.category) defs = defs.filter((d) => d.category === opts.category);
	if (opts.scope) defs = defs.filter((d) => d.scope === opts.scope);
	return defs;
}

/** List + parse every `*.json` directly under a component prefix, skipping bad ones. */
async function listFromPrefix(prefix: string): Promise<ComponentDef[]> {
	let keys: string[];
	try {
		keys = await listAllKeys(prefix);
	} catch {
		return [];
	}
	const out: ComponentDef[] = [];
	for (const key of keys) {
		if (!key.endsWith('.json')) continue;
		const def = await readComponent(key);
		if (def) out.push(def);
	}
	return out;
}

/**
 * Validate the minimum component contract and return the normalized def. Throws a
 * descriptive Error on a bad payload (surfaced as a 400 by the route). Mirrors
 * `saveTemplate`'s guard-then-normalize discipline.
 */
function validateComponent(component: ComponentDef): ComponentDef {
	if (typeof component !== 'object' || component === null) {
		throw new Error('Component must be an object.');
	}
	if (typeof component.id !== 'string' || !component.id.trim()) {
		throw new Error('Component requires a non-empty id.');
	}
	if (typeof component.name !== 'string' || !component.name.trim()) {
		throw new Error('Component requires a non-empty name.');
	}
	if (!Number.isInteger(component.version) || component.version < 1) {
		throw new Error('Component version must be a positive integer.');
	}
	if (component.scope !== 'shared' && component.scope !== 'project') {
		throw new Error("Component scope must be 'shared' or 'project'.");
	}
	if (!CATEGORIES.has(component.category)) {
		throw new Error("Component category must be one of 'ui', 'overlay', 'scenery'.");
	}
	if (!isContainerNode(component.root)) {
		throw new Error("Component root must be a node with kind 'container'.");
	}
	return normalizeComponent(component);
}

/**
 * Coerce parsed/posted data into a clean `ComponentDef`, dropping malformed
 * params/signals/slots (mirrors `normalizeTemplate`). The `root` node tree is NOT
 * deep-normalized — node coercion is the editor doc normalizer's job (§8.3); here
 * we only verify `root` is a container and pass it through.
 */
export function normalizeComponent(raw: ComponentDef): ComponentDef {
	const def: ComponentDef = {
		id: raw.id.trim(),
		name: raw.name.trim(),
		version: raw.version,
		scope: raw.scope,
		category: raw.category,
		root: identityComponentRoot(raw.root),
	};
	const params = normalizeParams(raw.params);
	if (params.length) def.params = params;
	const signals = normalizeSignals(raw.signals);
	if (signals.length) def.signals = signals;
	const slots = normalizeSlots(raw.slots);
	if (slots.length) def.slots = slots;
	return def;
}

function normalizeParams(input: unknown): ComponentParam[] {
	if (!Array.isArray(input)) return [];
	const out: ComponentParam[] = [];
	for (const item of input) {
		if (!isRecord(item)) continue;
		if (typeof item.key !== 'string' || !item.key) continue;
		if (
			item.kind !== 'number' &&
			item.kind !== 'string' &&
			item.kind !== 'color' &&
			item.kind !== 'boolean'
		) {
			continue;
		}
		const param: ComponentParam = { key: item.key, kind: item.kind };
		if ('default' in item) param.default = item.default;
		if (item.engineProvided === true) param.engineProvided = true;
		out.push(param);
	}
	return out;
}

function normalizeSignals(input: unknown): ComponentSignal[] {
	if (!Array.isArray(input)) return [];
	const out: ComponentSignal[] = [];
	for (const item of input) {
		if (!isRecord(item)) continue;
		if (typeof item.key !== 'string' || !item.key) continue;
		const signal: ComponentSignal = { key: item.key };
		if (typeof item.note === 'string' && item.note) signal.note = item.note;
		out.push(signal);
	}
	return out;
}

function normalizeSlots(input: unknown): TemplateSlot[] {
	if (!Array.isArray(input)) return [];
	const out: TemplateSlot[] = [];
	for (const item of input) {
		if (!isRecord(item)) continue;
		if (typeof item.slotId !== 'string' || !item.slotId) continue;
		if (typeof item.kind !== 'string' || !SLOT_KINDS.has(item.kind as SlotKind)) continue;
		const slot: TemplateSlot = {
			slotId: item.slotId,
			name: typeof item.name === 'string' ? item.name : '',
			kind: item.kind as SlotKind,
		};
		if (item.required === true) slot.required = true;
		if (typeof item.mountComponent === 'string' && item.mountComponent) {
			slot.mountComponent = item.mountComponent;
		}
		if (Array.isArray(item.accepts)) {
			const accepts = item.accepts.filter(
				(a): a is 'sprite' | 'spine' | 'text' => a === 'sprite' || a === 'spine' || a === 'text',
			);
			if (accepts.length) slot.accepts = accepts;
		}
		out.push(slot);
	}
	return out;
}

/** Light shape check used to decide whether an R2 doc is usable as a component. */
function isComponentShape(input: unknown): input is ComponentDef {
	if (!isRecord(input)) return false;
	if (typeof input.id !== 'string' || !input.id) return false;
	if (typeof input.name !== 'string' || !input.name) return false;
	if (typeof input.version !== 'number') return false;
	if (input.scope !== 'shared' && input.scope !== 'project') return false;
	if (!CATEGORIES.has(input.category as ComponentCategory)) return false;
	return isContainerNode(input.root);
}

function isContainerNode(input: unknown): input is ContainerNode {
	return isRecord(input) && input.kind === 'container';
}

/**
 * A component `root` is authored in LOCAL space — the `componentInstance` node
 * positions it — so the root carries NO transform of its own. Stripping it here is
 * the authoritative invariant that keeps the engine path (which applies root's
 * transform via `LayoutNodeView`) and the editor canvas (which skips it) in
 * agreement, and stops a dropped instance from being offset by a baked-in scene
 * transform. Keeps only id/kind/children + optional box (width/height) + label.
 */
function identityComponentRoot(root: ContainerNode): ContainerNode {
	const next: ContainerNode = {
		id: root.id,
		kind: 'container',
		x: 0,
		y: 0,
		children: Array.isArray(root.children) ? root.children : [],
	};
	if (typeof root.width === 'number') next.width = root.width;
	if (typeof root.height === 'number') next.height = root.height;
	if (typeof root.label === 'string') next.label = root.label;
	return next;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
