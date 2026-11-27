import type { GameConfigDoc } from './types';

/**
 * A project's own names for its server's symbols: our name → the name the server deals (`M1` →
 * `PIC4`). Set by `/config`'s server import when the author names the symbols by what the server
 * pays (H / M / L, `tierSymbolNames` in `rgs-translator-eagaming`), and read at boot by the facade
 * in place of the shared fixed mapping. Absent ⇒ the shared mapping, as every project before it.
 */
export type ServerSymbolNames = Record<string, string>;

const NAME = /^[A-Za-z0-9_]{1,32}$/;

/** Keeps well-formed pairs, and only the first claim on each server name. Undefined when none. */
export const normalizeServerSymbolNames = (raw: unknown): ServerSymbolNames | undefined => {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
	const out: ServerSymbolNames = {};
	const claimed = new Set<string>();
	for (const [ours, server] of Object.entries(raw)) {
		if (!NAME.test(ours) || typeof server !== 'string' || !NAME.test(server)) continue;
		if (claimed.has(server)) continue;
		claimed.add(server);
		out[ours] = server;
	}
	return Object.keys(out).length ? out : undefined;
};

/** A name the server deals that the dictionary has no symbol for is drawn as nothing. */
export const validateServerSymbolNames = (
	doc: GameConfigDoc,
): { severity: 'warning'; path: string; message: string }[] =>
	Object.keys(doc.serverSymbolNames ?? {})
		.filter((ours) => !Object.hasOwn(doc.symbols, ours))
		.map((ours) => ({
			severity: 'warning' as const,
			path: `serverSymbolNames.${ours}`,
			message: `${ours} is named for the server's ${doc.serverSymbolNames?.[ours]}, but there is no symbol ${ours}.`,
		}));

/**
 * `value` with every object key and every string equal to an old name replaced by its new name, in
 * one pass — the rename {@link renameSymbols} applies to a doc, and `/config` to the import rows it
 * reviews, so the two always agree.
 */
export const renameNames = <T>(value: T, renames: Readonly<Record<string, string>>): T => {
	const map = new Map(Object.entries(renames));
	const walk = (node: unknown): unknown => {
		if (typeof node === 'string') return map.get(node) ?? node;
		if (Array.isArray(node)) return node.map(walk);
		if (node && typeof node === 'object') {
			return Object.fromEntries(
				Object.entries(node).map(([key, inner]) => [map.get(key) ?? key, walk(inner)]),
			);
		}
		return node;
	};
	return walk(value) as T;
};

export type SymbolRenameResult = { doc: GameConfigDoc } | { error: string };

/**
 * Rename symbols everywhere in a config doc, all at once: every object key and every string value
 * equal to an old name becomes its new name in ONE pass, so a swap (`L1` → `M2` while `M2` →
 * `L1`) cannot chain. Refused when a new name is a symbol that is not itself being renamed — two
 * symbols would merge into one.
 */
export const renameSymbols = (
	doc: GameConfigDoc,
	renames: Readonly<Record<string, string>>,
): SymbolRenameResult => {
	const moves = Object.entries(renames).filter(([from, to]) => from !== to);
	if (!moves.length) return { doc };
	const leaving = new Set(moves.map(([from]) => from));
	const taken = moves
		.map(([, to]) => to)
		.filter((to) => Object.hasOwn(doc.symbols, to) && !leaving.has(to));
	if (taken.length) {
		return {
			error: `${[...new Set(taken)].join(', ')} already name${taken.length === 1 ? 's' : ''} another symbol. Rename or remove it first.`,
		};
	}
	const targets = moves.map(([, to]) => to);
	if (new Set(targets).size !== targets.length) {
		return { error: 'Two symbols would get the same name.' };
	}
	return { doc: renameNames(doc, renames) };
};
