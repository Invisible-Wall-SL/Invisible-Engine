import type { ComponentDef, LayoutDoc, LayoutNode } from 'engine-layout';
import { needsAtlasRefRepair } from 'engine-layout';

import { createAtlasRefResolver } from './manifestBasename';

/**
 * Repair the atlas refs in an editor doc + its component defs to full manifest keys — the layout
 * doc's half of the shared repair in `manifestBasename.ts`, alongside `loadFlipbookDoc`'s (clips)
 * and `loadGameConfigDoc`'s (buy-feature card params).
 *
 * **What this fixes is the atlas PIN, not missing art.** An un-scopeable ref
 * (`<client>/<project>/sheets/S_Gem/::frame_0000`, what the region picker stored before it was
 * taught to use manifest keys) already RENDERS: `parseScopedFrameRef` drops the prefix it cannot
 * scope by and reads the bare frame name, which the `sprites` loader registers alongside every
 * scoped one. What it loses is the scoping — so two sheets packing the same frame name collide in
 * the flat texture cache and the last-loaded one wins, which is exactly the silent
 * wrong-art-in-game failure the scoping was introduced to end. Repairing restores the pin.
 *
 * Ship path ONLY (`loadDoc`, not `loadDocWithEtag`): the editor's read backs a compare-and-swap,
 * and a save must round-trip what was loaded. An unresolvable ref comes back untouched — a repair
 * can only ever make a ref MORE specific.
 */

/** The atlas half of a scoped ref, or `null` when the value is not one that needs repairing. */
function repairablePrefix(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const i = value.indexOf('::');
	if (i <= 0) return null;
	const prefix = value.slice(0, i);
	return needsAtlasRefRepair(prefix) ? prefix : null;
}

/** Every art ref on one node that could need repairing, as a flat list of strings to test. */
function nodeRefs(node: LayoutNode): unknown[] {
	if (node.kind === 'sprite') return [node.assetKey, node.region];
	if (node.kind === 'componentInstance') return Object.values(node.params ?? {});
	return [];
}

function walk(nodes: LayoutNode[], visit: (node: LayoutNode) => void): void {
	for (const node of nodes) {
		visit(node);
		if (node.kind === 'container') walk(node.children, visit);
	}
}

/** Collect every repairable ref reachable from a doc, so the gate below can skip the R2 work. */
function docNeedsRepair(doc: LayoutDoc): boolean {
	let found = false;
	const visit = (node: LayoutNode): void => {
		if (found) return;
		for (const ref of nodeRefs(node)) {
			// A sprite `assetKey` is a WHOLE atlas ref (no `::`), unlike every other field here.
			if (needsAtlasRefRepair(ref) || repairablePrefix(ref)) {
				found = true;
				return;
			}
		}
	};
	for (const scene of doc.scenes) walk(scene.nodes, visit);
	return found;
}

function defNeedsRepair(def: ComponentDef): boolean {
	for (const p of def.params ?? []) {
		if (p.kind === 'image' && repairablePrefix(p.default)) return true;
	}
	let found = false;
	walk([def.root], (node) => {
		if (found) return;
		for (const ref of nodeRefs(node)) {
			if (needsAtlasRefRepair(ref) || repairablePrefix(ref)) found = true;
		}
	});
	return found;
}

type Resolve = (ref: string) => Promise<string>;

/** `<prefix>::<frame>` → `<manifestKey>::<frame>`. Non-scoped or unresolvable values pass through. */
async function repairScoped(value: unknown, resolve: Resolve): Promise<unknown> {
	const prefix = repairablePrefix(value);
	if (prefix === null) return value;
	const full = await resolve(prefix);
	return full === prefix ? value : `${full}::${(value as string).slice(prefix.length + 2)}`;
}

/** Repair one node IN PLACE. Nodes are plain data freshly parsed from R2 on every ship-path read,
 *  so mutating is safe here and keeps the (deep, heterogeneous) tree from being rebuilt. */
async function repairNode(node: LayoutNode, resolve: Resolve): Promise<void> {
	if (node.kind === 'sprite') {
		// `assetKey` is a whole atlas ref: a sheet output prefix here makes `LayoutNodeView` fall
		// through to the bare-region lookup, losing the pin exactly as a bad scoped ref does.
		if (needsAtlasRefRepair(node.assetKey)) {
			const full = await resolve(node.assetKey);
			if (full !== node.assetKey) node.assetKey = full;
		}
		// `region` may itself be a scoped ref (what an image-kind param binding stores).
		node.region = (await repairScoped(node.region, resolve)) as string | undefined;
		return;
	}
	if (node.kind === 'componentInstance' && node.params) {
		for (const [key, value] of Object.entries(node.params)) {
			node.params[key] = await repairScoped(value, resolve);
		}
	}
}

async function repairNodes(nodes: LayoutNode[], resolve: Resolve): Promise<void> {
	const todo: LayoutNode[] = [];
	walk(nodes, (node) => todo.push(node));
	for (const node of todo) await repairNode(node, resolve);
}

/**
 * The walk itself, with the atlas resolver injected.
 *
 * Exported separately from {@link repairLayoutDocAtlasRefs} so `atlasRefRepair.fixture.ts` can
 * drive it with a stub: WHICH fields carry an atlas ref, which prefix shapes count, and what must
 * be left strictly alone are the parts that are easy to get wrong and impossible for a build to
 * check. The R2 lookup is the part that needs no test.
 */
export async function repairLayoutDocWith(doc: LayoutDoc, resolve: Resolve): Promise<LayoutDoc> {
	for (const scene of doc.scenes) await repairNodes(scene.nodes, resolve);
	return doc;
}

/**
 * Repair a layout doc's atlas refs. Returns the doc unchanged — and costs NO R2 calls — when
 * nothing in it needs repairing, which is every correctly-authored project.
 */
export async function repairLayoutDocAtlasRefs(
	doc: LayoutDoc,
	clientKey: string,
	projectKey: string,
): Promise<LayoutDoc> {
	if (!docNeedsRepair(doc)) return doc;
	return repairLayoutDocWith(doc, createAtlasRefResolver(clientKey, projectKey));
}

/**
 * Repair the resolved component defs' atlas refs — their `image`-param DEFAULTS and the sprite
 * nodes inside their roots. Mutates in place, mirroring `resolveSpineKeysForComponentDefs`, the
 * post-resolve fixup this sits beside at each ship-path caller.
 *
 * Separate from the doc because defs are resolved separately (`loadComponent` has no client key, so
 * it cannot repair them itself) and are shared across projects — a def is repaired against the
 * project that is shipping it, which is the only project whose sheets it can be resolved against.
 */
export async function repairComponentDefsAtlasRefs(
	defs: Iterable<ComponentDef>,
	clientKey: string,
	projectKey: string,
): Promise<void> {
	const dirty = [...defs].filter(defNeedsRepair);
	if (dirty.length === 0) return;
	await repairComponentDefsWith(dirty, createAtlasRefResolver(clientKey, projectKey));
}

/** The defs walk with the resolver injected — see {@link repairLayoutDocWith} for why. */
export async function repairComponentDefsWith(
	defs: Iterable<ComponentDef>,
	resolve: Resolve,
): Promise<void> {
	for (const def of defs) {
		for (const p of def.params ?? []) {
			if (p.kind === 'image')
				p.default = (await repairScoped(p.default, resolve)) as typeof p.default;
		}
		await repairNodes([def.root], resolve);
	}
}
