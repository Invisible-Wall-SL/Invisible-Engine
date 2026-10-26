/**
 * Invisible Flow v2 — the LIVE SET of spawned instances (`docs/design/game-families.md` §3.3).
 *
 * A `spawnLayer` layout node is a container whose children are created while the game runs. This
 * store holds what each layer has alive: Flow's `spawn` / `despawn` nodes write it, its `$live`
 * accessor reads it, and the game's `<SpawnLayer>` view draws it. It is pure and dependency-free, so
 * the game, the `/flow-v2` preview and the Node gate (`check:flow-spawn`) run the same rules:
 *
 *  - a layer is DECLARED with its `spawnable` list and `cap` (from the layout doc) before anything
 *    spawns into it — a spawn into an undeclared layer, of a component the layer does not list, over
 *    its cap, or into a cell off its grid is REFUSED and reported, never grown;
 *  - `live(layer)` returns a FRESH array on every read, so a `forEach` over it may despawn as it
 *    goes (the interpreter copies a `$live` read as well, so an env handing back its own array is
 *    safe too);
 *  - a handle is a frozen snapshot `{ id, layer, componentId, x, y, col?, row? }`; its `id` is unique for
 *    the session and never reused, so a despawned handle stays dead. An arcade game's motion
 *    (`move`) replaces it with one at the instance's new place, so a read is where it is now.
 */

import { effectiveSpawnCap } from 'constants-shared/spawn';

/** A grid layer's lattice: `cols` × `rows` cells, `pitch` px apart, cell (0, 0) at the origin. */
export interface SpawnGrid {
	cols: number;
	rows: number;
	pitch: number;
}

/** What a layer allows (the `spawnLayer` node's fields, sanitized). */
export interface SpawnLayerSpec {
	/** The `spawnLayer` node id. */
	id: string;
	spawnable: readonly string[];
	cap: number;
	placement: 'free' | 'grid';
	grid?: SpawnGrid;
	/** The screen it is placed on, when known. */
	sceneId?: string;
}

/** Where a spawn goes: a point in the layer's space, or a cell of a grid layer. */
export type SpawnAt = { x: number; y: number } | { cell: { col: number; row: number } };

/** A spawned instance's handle — the value an `instance<…>` pin carries. */
export interface SpawnedInstance {
	readonly id: string;
	readonly layer: string;
	readonly componentId: string;
	readonly x: number;
	readonly y: number;
	/** The grid cell, for an instance spawned into one. */
	readonly col?: number;
	readonly row?: number;
}

/** Why a spawn was refused. */
export type SpawnRefusal = 'unknown-layer' | 'not-spawnable' | 'cap' | 'cell';

export type SpawnResult =
	{ ok: true; instance: SpawnedInstance } | { ok: false; reason: SpawnRefusal };

export interface SpawnStore {
	/** Declare (or re-declare, with the same id) a layer. A re-declaration keeps what is alive. */
	declare(spec: SpawnLayerSpec): void;
	/** The declared layer, if any. */
	layer(id: string): SpawnLayerSpec | undefined;
	/** Every declared layer's id, in declaration order. */
	layers(): string[];
	spawn(layer: string, componentId: string, at: SpawnAt): SpawnResult;
	/** Remove a live instance (by handle or id); returns it, or `undefined` when it was not live. */
	despawn(instance: SpawnedInstance | string): SpawnedInstance | undefined;
	/** The live instance with this id. */
	get(id: string): SpawnedInstance | undefined;
	/** The layer's live instances, oldest first — a NEW array on every call. */
	live(layer: string): SpawnedInstance[];
	/** Run `listener` with the live set whenever the layer's set changes (and once now). */
	subscribe(layer: string, listener: (live: SpawnedInstance[]) => void): () => void;
	/** Despawn everything (a new session). Declarations stay. */
	clear(): void;
	/**
	 * Move live instances (an arcade game's motion, P10.8): each named handle is replaced by one at
	 * its new place, so `get` and `live` read where it is now. The layer's set is unchanged, so its
	 * {@link subscribe} listeners are not told; its {@link subscribePlaces} listeners are, once per
	 * layer, with the moved handles. An id not live is skipped.
	 */
	move(moves: readonly { id: string; x: number; y: number }[]): void;
	/** Run `listener` with the layer's moved handles after each {@link move} that moves any. */
	subscribePlaces(layer: string, listener: (moved: SpawnedInstance[]) => void): () => void;
}

export interface SpawnStoreOptions {
	/** A refused spawn (the cap, a component not listed, …), for the game's trace. */
	onRefuse?(layer: string, componentId: string, reason: SpawnRefusal): void;
}

/** The id of a handle (or the id itself); `undefined` for anything else. */
export const spawnedIdOf = (instance: unknown): string | undefined => {
	if (typeof instance === 'string') return instance || undefined;
	if (typeof instance === 'object' && instance !== null) {
		const id = (instance as { id?: unknown }).id;
		return typeof id === 'string' && id ? id : undefined;
	}
	return undefined;
};

export function createSpawnStore(options: SpawnStoreOptions = {}): SpawnStore {
	const specs = new Map<string, SpawnLayerSpec>();
	const sets = new Map<string, SpawnedInstance[]>();
	const byId = new Map<string, SpawnedInstance>();
	const listeners = new Map<string, Set<(live: SpawnedInstance[]) => void>>();
	const placeListeners = new Map<string, Set<(moved: SpawnedInstance[]) => void>>();
	let serial = 0;

	const notify = (layer: string): void => {
		const set = listeners.get(layer);
		if (!set?.size) return;
		for (const listener of [...set]) listener(live(layer));
	};
	const live = (layer: string): SpawnedInstance[] => [...(sets.get(layer) ?? [])];
	const refuse = (layer: string, componentId: string, reason: SpawnRefusal): SpawnResult => {
		options.onRefuse?.(layer, componentId, reason);
		return { ok: false, reason };
	};

	return {
		declare(spec) {
			specs.set(spec.id, { ...spec, cap: effectiveSpawnCap(spec.cap) });
		},
		layer: (id) => specs.get(id),
		layers: () => [...specs.keys()],
		spawn(layer, componentId, at) {
			const spec = specs.get(layer);
			if (!spec) return refuse(layer, componentId, 'unknown-layer');
			if (!spec.spawnable.includes(componentId)) return refuse(layer, componentId, 'not-spawnable');
			const current = sets.get(layer) ?? [];
			if (current.length >= spec.cap) return refuse(layer, componentId, 'cap');
			let place: { x: number; y: number; col?: number; row?: number };
			if ('cell' in at) {
				const grid = spec.placement === 'grid' ? spec.grid : undefined;
				const { col, row } = at.cell;
				if (
					!grid ||
					!Number.isInteger(col) ||
					!Number.isInteger(row) ||
					col < 0 ||
					row < 0 ||
					col >= grid.cols ||
					row >= grid.rows
				) {
					return refuse(layer, componentId, 'cell');
				}
				place = { x: col * grid.pitch, y: row * grid.pitch, col, row };
			} else {
				place = {
					x: Number.isFinite(at.x) ? at.x : 0,
					y: Number.isFinite(at.y) ? at.y : 0,
				};
			}
			serial += 1;
			const instance: SpawnedInstance = Object.freeze({
				id: `${layer}#${serial}`,
				layer,
				componentId,
				...place,
			});
			sets.set(layer, [...current, instance]);
			byId.set(instance.id, instance);
			notify(layer);
			return { ok: true, instance };
		},
		despawn(instance) {
			const id = spawnedIdOf(instance);
			const found = id ? byId.get(id) : undefined;
			if (!found) return undefined;
			byId.delete(found.id);
			sets.set(
				found.layer,
				(sets.get(found.layer) ?? []).filter((i) => i.id !== found.id),
			);
			notify(found.layer);
			return found;
		},
		get: (id) => byId.get(id),
		live,
		subscribe(layer, listener) {
			let set = listeners.get(layer);
			if (!set) listeners.set(layer, (set = new Set()));
			set.add(listener);
			listener(live(layer));
			return () => {
				set.delete(listener);
				if (set.size === 0) listeners.delete(layer);
			};
		},
		clear() {
			const layers = [...sets.keys()];
			sets.clear();
			byId.clear();
			for (const layer of layers) notify(layer);
		},
		move(moves) {
			const moved = new Map<string, SpawnedInstance[]>();
			for (const { id, x, y } of moves) {
				const found = byId.get(id);
				if (!found || !Number.isFinite(x) || !Number.isFinite(y)) continue;
				if (found.x === x && found.y === y) continue;
				const next: SpawnedInstance = Object.freeze({ ...found, x, y });
				byId.set(id, next);
				const set = sets.get(found.layer) ?? [];
				const at = set.findIndex((i) => i.id === id);
				if (at >= 0) set[at] = next;
				const list = moved.get(found.layer);
				if (list) list.push(next);
				else moved.set(found.layer, [next]);
			}
			for (const [layer, list] of moved) {
				for (const listener of [...(placeListeners.get(layer) ?? [])]) listener(list);
			}
		},
		subscribePlaces(layer, listener) {
			let set = placeListeners.get(layer);
			if (!set) placeListeners.set(layer, (set = new Set()));
			set.add(listener);
			return () => {
				set.delete(listener);
				if (set.size === 0) placeListeners.delete(layer);
			};
		},
	};
}

/** The spawn layer specs of a set of projected layer decls (the preview's and the gate's input). */
export const spawnSpecsOf = (
	layers: Iterable<{
		layer: string;
		cap: number;
		placement: 'free' | 'grid';
		grid?: SpawnGrid;
		spawnable: readonly { componentId: string }[];
	}>,
): SpawnLayerSpec[] =>
	[...layers].map((decl) => ({
		id: decl.layer,
		spawnable: decl.spawnable.map((s) => s.componentId),
		cap: decl.cap,
		placement: decl.placement,
		...(decl.grid ? { grid: decl.grid } : {}),
	}));
