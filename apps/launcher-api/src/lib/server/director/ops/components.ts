import {
	resolveComponentClosure,
	type ComponentDef,
	type LayoutDoc,
	type LayoutNode,
	type Scene,
} from 'engine-layout';
import {
	ComponentValidationError,
	loadComponent,
	loadComponentWithEtag,
	saveComponent,
} from '../../componentStorage';
import { loadDocWithEtag, saveDoc } from '../../editorStorage';
import {
	editorDocBackupTarget,
	editorDocKey,
	projectComponentKey,
	projectComponentsPrefix,
} from '../../projectPaths';
import { projectGameType } from '../../projects';
import { ConflictError } from '../../r2';
import { AdapterError, defineOp } from '../adapter';
import { NEW_DOC, baseEtagProp, baseOf, preconditionOf, projectOf } from './docs';
import {
	SKINNABLE,
	componentClosure,
	defLoader,
	lockOf,
	mathBinding,
	sceneHolders,
	type ComponentHolder,
	type DefLoader,
} from './mathLock';

/**
 * Invisible Component Editor art adapters (ADR-0011 §3), through `componentStorage.ts` (the
 * editor's own `loadComponentWithEtag` and `saveComponent`) and `editorStorage.ts` for the re-pin.
 * The builder re-points the art a component's nodes already show: a sprite's `assetKey` and
 * `region`, a rig's `assetKey` and `skin`, a flipbook's `clipId`, the fields `scene.update_nodes`
 * re-skins. Nothing else in the def changes, and a def a locked instance holds is never touched.
 */

const COMPONENT_ID = '^[A-Za-z0-9_.-]{1,120}$';
const ART_FIELDS = ['assetKey', 'region', 'skin', 'clipId'] as const;
type ArtField = (typeof ART_FIELDS)[number];

type Scope = 'project' | 'shared' | 'built-in';

interface Loaded {
	def: ComponentDef;
	scope: Scope;
	/** The token to hand back: the project def's ETag, `new` when a save makes the project's copy. */
	baseEtag: string;
}

async function loadDef(projectKey: string, id: string): Promise<Loaded> {
	const found = await loadComponentWithEtag(id, projectKey);
	if (!found) throw new AdapterError(404, 'unknown_component', `No component "${id}".`);
	const { def, etag } = found;
	if (etag !== null && def.scope === 'project') return { def, scope: 'project', baseEtag: etag };
	return { def, scope: etag === null ? 'built-in' : 'shared', baseEtag: NEW_DOC };
}

async function loadLayout(clientKey: string, projectKey: string) {
	const loaded = await loadDocWithEtag(clientKey, projectKey, await projectGameType(projectKey));
	if (loaded.corrupt) {
		throw new AdapterError(
			409,
			'unreadable_doc',
			"The project's layout is unreadable. A person must repair it in the Scene Editor.",
		);
	}
	// A project with no layout yet places nothing, whatever a fresh doc would seed.
	return {
		doc: loaded.etag === null ? { ...loaded.doc, scenes: [] } : loaded.doc,
		etag: loaded.etag,
	};
}

/** The nodes of a def's tree, root first. */
function* defNodes(node: LayoutNode): Generator<LayoutNode> {
	yield node;
	if (node.kind === 'container') for (const child of node.children) yield* defNodes(child);
}

const artFieldsOf = (node: LayoutNode): readonly ArtField[] =>
	(SKINNABLE[node.kind] ?? []) as readonly ArtField[];

const artValue = (node: LayoutNode, field: ArtField): string | null =>
	(node as unknown as Record<string, unknown>)[field] === undefined
		? null
		: String((node as unknown as Record<string, unknown>)[field]);

/** `a` and `b` as plain JSON with every object's keys in order, so equal data compares equal. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/**
 * Whether two versions of a def differ in nothing but the four art fields: the version, the name
 * and the editor's guides are ignored, and so are the art fields of the nodes that take them.
 */
export function artOnlyDiff(a: ComponentDef, b: ComponentDef): boolean {
	const strip = (def: ComponentDef): string => {
		const copy = structuredClone(def) as unknown as Record<string, unknown>;
		delete copy.version;
		delete copy.scope;
		delete copy.name;
		delete copy.guides;
		for (const node of defNodes((copy as unknown as ComponentDef).root)) {
			for (const field of artFieldsOf(node))
				delete (node as unknown as Record<string, unknown>)[field];
		}
		return canonical(copy);
	};
	return strip(a) === strip(b);
}

interface HolderLock {
	holder: ComponentHolder;
	ids: Set<string>;
	deep: boolean;
	/** Why `lockOf` locks the holder, or `null`. */
	lock: string | null;
}

/** Each holder in the layout with what it places and whether it is locked. */
async function holderLocks(doc: LayoutDoc, defs: DefLoader): Promise<HolderLock[]> {
	const out: HolderLock[] = [];
	for (const holder of sceneHolders(doc.scenes as Scene[])) {
		const { ids, deep } = await componentClosure(holder.node, defs);
		const lock = await lockOf(holder.scene, holder.ancestors, holder.node, defs);
		out.push({ holder, ids, deep, lock });
	}
	return out;
}

/**
 * Why `def` is locked, or `null`: a locked instance holds it, or the def being written is itself
 * bound to the math (an unplaced def, or a latest one that gained a math node while every pin
 * still points at an older version).
 */
async function lockedFor(
	holders: HolderLock[],
	def: ComponentDef,
	defs: DefLoader,
): Promise<string | null> {
	const hit = holders.find((h) => h.lock && (h.ids.has(def.id) || h.deep));
	if (hit) {
		return `"${hit.holder.node.id}" on "${hit.holder.scene.id}" holds it and is ${hit.lock}`;
	}
	const own = await mathBinding(def.root, defs);
	return own ? `the def itself is bound to the math: ${own}` : null;
}

interface Instance {
	screen: string;
	node: string;
	/** The version it pins, or `null` when it follows the latest. */
	pin: number | null;
	ref: LayoutNode & { kind: 'componentInstance' };
}

/** The top-level instances of `id`: placed in a scene, not inside another def. */
function instancesOf(doc: LayoutDoc, id: string): Instance[] {
	const out: Instance[] = [];
	for (const { scene, node } of sceneHolders(doc.scenes as Scene[])) {
		if (node.kind === 'componentInstance' && node.componentId === id) {
			out.push({ screen: scene.id, node: node.id, pin: node.componentVersion ?? null, ref: node });
		}
	}
	return out;
}

/** Whether a write to `def` reaches `pin`: it follows the latest, or its version differs in art only. */
async function reaches(projectKey: string, def: ComponentDef, pin: number | null) {
	if (pin === null || pin === def.version) return { reached: true };
	const snapshot = await loadComponent(def.id, projectKey, pin);
	if (!snapshot) return { reached: false, why: `version ${pin} is not stored` };
	return artOnlyDiff(snapshot, def)
		? { reached: true }
		: { reached: false, why: `version ${pin} also differs in more than art` };
}

interface NodeRow {
	id: string;
	kind: LayoutNode['kind'];
	assetKey: string | null;
	region: string | null;
	skin: string | null;
	clipId: string | null;
	/** The art fields a param supplies per instance; this op leaves them alone. */
	paramBound: string[];
}

function nodeRows(def: ComponentDef): NodeRow[] {
	const rows: NodeRow[] = [];
	for (const node of defNodes(def.root)) {
		const fields = artFieldsOf(node);
		if (fields.length === 0) continue;
		rows.push({
			id: node.id,
			kind: node.kind,
			assetKey: artValue(node, 'assetKey'),
			region: artValue(node, 'region'),
			skin: artValue(node, 'skin'),
			clipId: artValue(node, 'clipId'),
			paramBound: fields.filter((f) => node.paramBindings?.[f] !== undefined),
		});
	}
	return rows;
}

interface DefListing {
	id: string;
	name: string;
	scope: Scope;
	version: number;
	instances: { screen: string; node: string; pin: number | null }[];
	locked: string | null;
}

export const getDef = defineOp<
	{ id?: string },
	| { defs: DefListing[]; layoutBaseEtag: string }
	| {
			id: string;
			name: string;
			scope: Scope;
			version: number;
			nodes: NodeRow[];
			pins: { screen: string; node: string; pin: number | null; reached: boolean; why?: string }[];
			locked: string | null;
			baseEtag: string;
			layoutBaseEtag: string;
	  }
>({
	tool: 'components',
	name: 'get_def',
	description:
		"The components the project's screens use. With no `id`: each def reachable from the screens (scope, latest version, the instances with screen, node and pin, and `locked`: why components.update_art refuses it, or null). With an `id`: the re-skinnable nodes of the def (sprite assetKey/region, rig assetKey/skin, flipbook clipId, and which of those a param supplies), the pins (each top-level instance and whether a write reaches it), `locked`, and the baseEtag and layoutBaseEtag to hand back to components.update_art.",
	inputSchema: {
		type: 'object',
		properties: { id: { type: 'string', pattern: COMPONENT_ID } },
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: false,
	handler: async (ctx, { id }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { doc, etag } = await loadLayout(clientKey, projectKey);
		const defs = defLoader(projectKey);
		const holders = await holderLocks(doc, defs);
		if (id) {
			const { def, scope, baseEtag } = await loadDef(projectKey, id);
			const pins = [];
			for (const i of instancesOf(doc, id)) {
				const { reached, why } = await reaches(projectKey, def, i.pin);
				pins.push({ screen: i.screen, node: i.node, pin: i.pin, reached, ...(why ? { why } : {}) });
			}
			return {
				id: def.id,
				name: def.name,
				scope,
				version: def.version,
				nodes: nodeRows(def),
				pins,
				locked: await lockedFor(holders, def, defs),
				baseEtag,
				layoutBaseEtag: baseOf(etag),
			};
		}
		const closure = await resolveComponentClosure(
			doc.scenes.flatMap((scene) => scene.nodes),
			(componentId) => loadComponent(componentId, projectKey),
		);
		const listing: DefListing[] = [];
		for (const def of Object.values(closure)) {
			const { scope } = await loadDef(projectKey, def.id);
			listing.push({
				id: def.id,
				name: def.name,
				scope,
				version: def.version,
				instances: instancesOf(doc, def.id).map(({ screen, node, pin }) => ({ screen, node, pin })),
				locked: await lockedFor(holders, def, defs),
			});
		}
		listing.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		return { defs: listing, layoutBaseEtag: baseOf(etag) };
	},
});

export interface ArtChange {
	node: string;
	assetKey?: string;
	region?: string;
	skin?: string;
	clipId?: string;
}

interface Refused {
	node: string;
	reason: string;
}

type Before = { node: string } & Partial<Record<ArtField, string | null>>;

/** Apply `change` to `node` in place, or say why not. Nothing is touched when it is refused. */
function applyArt(
	node: LayoutNode,
	change: ArtChange,
): { reason: string } | { before: Before; changed: boolean } {
	const asked = ART_FIELDS.filter((f) => change[f] !== undefined);
	if (asked.length === 0) return { reason: 'the change re-skins nothing' };
	const takes = artFieldsOf(node);
	const unfit = asked.filter((f) => !takes.includes(f));
	if (unfit.length) return { reason: `a ${node.kind} node has no ${unfit.join(', ')} to re-skin` };
	const bound = asked.filter((f) => node.paramBindings?.[f] !== undefined);
	if (bound.length) {
		return {
			reason: `${bound.join(', ')} ${bound.length === 1 ? 'is' : 'are'} bound to the param "${node.paramBindings![bound[0]]}", which decides that art per instance`,
		};
	}
	const before: Before = { node: node.id };
	let changed = false;
	for (const field of asked) {
		before[field] = artValue(node, field);
		if (before[field] !== change[field]) changed = true;
		Object.assign(node, { [field]: change[field] });
	}
	return { before, changed };
}

export const updateArt = defineOp<
	{ id: string; changes: ArtChange[]; baseEtag: string; layoutBaseEtag: string },
	{
		applied: { node: string }[];
		unchanged: string[];
		refused: Refused[];
		before: Before[];
		version: number;
		scope: Scope;
		repinned: { screen: string; node: string; from: number; to: number }[];
		notReached: { screen: string; node: string; pin: number; reason: string }[];
		baseEtag: string;
		layoutBaseEtag: string;
	}
>({
	tool: 'components',
	name: 'update_art',
	description:
		'Re-point the art of nodes inside a component def: a sprite takes `assetKey` and `region`, a rig `assetKey` and `skin`, a flipbook `clipId`. Nothing else changes: no tint, text, params, inputs, signals, state machine, timelines, transforms or slots, and nodes cannot be added, removed or reordered. A node whose art field a param supplies, an unknown node and a field the kind lacks are refused and listed in `refused`. A def held by an instance bound to the math is refused outright. A shared or built-in def is saved as the project\'s own copy (same id and version, baseEtag "new"). Instances pinned to an older version are re-pinned to the saved one when that older version differs from it in art only; the others are listed in `notReached`. Hand back the baseEtag and layoutBaseEtag components.get_def returned; if the answer is a conflict, re-read and send the same changes again.',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'string', pattern: COMPONENT_ID },
			changes: {
				type: 'array',
				maxItems: 64,
				items: {
					type: 'object',
					properties: {
						node: { type: 'string', minLength: 1, maxLength: 120 },
						assetKey: { type: 'string', minLength: 1, maxLength: 400 },
						region: { type: 'string', minLength: 1, maxLength: 400 },
						skin: { type: 'string', minLength: 1, maxLength: 120 },
						clipId: { type: 'string', minLength: 1, maxLength: 120 },
					},
					required: ['node'],
					additionalProperties: false,
				},
			},
			baseEtag: baseEtagProp,
			layoutBaseEtag: baseEtagProp,
		},
		required: ['id', 'changes', 'baseEtag', 'layoutBaseEtag'],
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: true,
	writes: (input, scope) => [
		projectComponentKey(scope.projectKey, input.id),
		projectComponentsPrefix(scope.projectKey),
		editorDocKey(scope.clientKey, scope.projectKey),
		editorDocBackupTarget(scope.clientKey, scope.projectKey).prefix,
	],
	handler: async (ctx, { id, changes, baseEtag, layoutBaseEtag }) => {
		const { clientKey, projectKey } = projectOf(ctx);
		const { def, scope, baseEtag: defEtag } = await loadDef(projectKey, id);
		const layout = await loadLayout(clientKey, projectKey);
		const defs = defLoader(projectKey);
		// A person's layout edit between this read and the def save is caught by `layoutBaseEtag` only
		// when a re-pin follows; otherwise the lock was read a moment before the write.
		const locked = await lockedFor(await holderLocks(layout.doc, defs), def, defs);
		if (locked)
			throw new AdapterError(403, 'locked', `The component "${id}" is locked: ${locked}.`);

		const next = structuredClone(def);
		const nodes = new Map([...defNodes(next.root)].map((n) => [n.id, n]));
		const applied: { node: string }[] = [];
		const unchanged: string[] = [];
		const refused: Refused[] = [];
		const before: Before[] = [];
		const seen = new Set<string>();
		for (const change of changes) {
			const node = nodes.get(change.node);
			if (!node) {
				refused.push({
					node: change.node,
					reason: 'the def has no such node; nodes cannot be added',
				});
			} else if (seen.has(change.node)) {
				refused.push({ node: change.node, reason: 'it is listed twice' });
			} else {
				seen.add(change.node);
				const result = applyArt(node, change);
				if ('reason' in result) refused.push({ node: change.node, reason: result.reason });
				else if (!result.changed) unchanged.push(change.node);
				else {
					applied.push({ node: change.node });
					before.push(result.before);
				}
			}
		}

		const instances = instancesOf(layout.doc, id);
		const pinned = instances.filter((i) => i.pin !== null);
		// A re-pin may follow the def save, so a stale layout is refused before anything is written.
		if (
			(applied.length > 0 || unchanged.length > 0) &&
			pinned.length > 0 &&
			baseOf(layout.etag) !== layoutBaseEtag
		) {
			throw new ConflictError(editorDocKey(clientKey, projectKey));
		}

		let version = def.version;
		let savedDef = def;
		let newDefEtag = defEtag;
		if (applied.length > 0) {
			// The editor's own request for a shared or built-in def: the project's copy, same id and version.
			const toSave: ComponentDef = scope === 'project' ? next : { ...next, scope: 'project' };
			try {
				const saved = await saveComponent(toSave, projectKey, preconditionOf(baseEtag));
				version = saved.version;
				newDefEtag = baseOf(saved.etag);
				savedDef = { ...toSave, version };
			} catch (e) {
				if (e instanceof ComponentValidationError) {
					throw new AdapterError(400, 'invalid_input', e.message);
				}
				throw e;
			}
		}

		// With nothing applied, `unchanged` means a def saved earlier by this same call that lost its
		// layout write: the content is already equal, so only the re-pin is left to do.
		const repinned: { screen: string; node: string; from: number; to: number }[] = [];
		const notReached: { screen: string; node: string; pin: number; reason: string }[] = [];
		let newLayoutEtag = layoutBaseEtag;
		if (applied.length > 0 || unchanged.length > 0) {
			for (const i of pinned) {
				const pin = i.pin!;
				if (pin === version) continue;
				const snapshot = await loadComponent(id, projectKey, pin);
				if (!snapshot) {
					notReached.push({
						screen: i.screen,
						node: i.node,
						pin,
						reason: `version ${pin} is not stored`,
					});
				} else if (artOnlyDiff(snapshot, savedDef)) {
					i.ref.componentVersion = version;
					repinned.push({ screen: i.screen, node: i.node, from: pin, to: version });
				} else {
					notReached.push({
						screen: i.screen,
						node: i.node,
						pin,
						reason: `version ${pin} also differs in more than art; a person updates this instance`,
					});
				}
			}
			if (repinned.length > 0) {
				const saved = await saveDoc(
					clientKey,
					projectKey,
					layout.doc,
					preconditionOf(layoutBaseEtag),
					'auto',
					ctx.savedBy,
				);
				newLayoutEtag = baseOf(saved.etag);
			}
		}
		return {
			applied,
			unchanged,
			refused,
			before,
			version,
			scope: applied.length > 0 ? 'project' : scope,
			repinned,
			notReached,
			baseEtag: newDefEtag,
			layoutBaseEtag: newLayoutEtag,
		};
	},
});

export const COMPONENT_OPS = [getDef, updateArt];
