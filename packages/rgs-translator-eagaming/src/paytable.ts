import type { GameMapping } from './gameMappings';

/**
 * The paytable a boot `config` DECLARES, read into one shape — `{ on: { occurs, of, mode }, pay }`,
 * the same shape the game's info page is built from (`utils-shared`'s `ServerPayEntry`).
 *
 * Three wire shapes are in the wild, and a reader that knew only one would report "no paytable" for
 * the other two, which is the one answer that silently disables the check it feeds:
 *
 *   - grouped by mode — `{ line: [entry…], scatter: [entry…] }` — the live Book of Thermopylae wire,
 *     mirrored by `scripts/mock-rgs-server-book.mjs`;
 *   - keyed by symbol — `{ PIC1: { occurs: [3,4,5], pay: [200,1000,5000] } }` — our lines mock
 *     (`scripts/mock-rgs-server.mjs`) — or `{ PIC1: [entry…] }`, the shape their client names;
 *   - a flat array of entries.
 *
 * A row that states no mode is `scatter` when its symbol is one of `scatterSymbols` (the server's
 * `symbolsPay.scatter`) and `line` otherwise — reading a mode-less scatter row as `line` would
 * report it as "not shown" on every boot while its real comparison never ran. Anything malformed is
 * skipped, not guessed. Returns null when nothing usable was declared, so a server that states no
 * paytable leaves the comparison off entirely.
 */

export type DeclaredPayEntry = {
	on: { occurs: number[]; of: string; mode: string };
	pay: number[];
};

const numbers = (value: unknown): number[] | null =>
	Array.isArray(value) && value.every((n) => typeof n === 'number' && Number.isFinite(n))
		? (value as number[])
		: null;

type WireEntry = {
	on?: { occurs?: unknown; of?: unknown; mode?: unknown };
	occurs?: unknown;
	pay?: unknown;
};

const readEntry = (
	raw: unknown,
	scatter: ReadonlySet<string>,
	symbol?: string,
	group?: string,
): DeclaredPayEntry | null => {
	if (!raw || typeof raw !== 'object') return null;
	const entry = raw as WireEntry;
	const pay = numbers(entry.pay);
	const occurs = numbers(entry.on?.occurs ?? entry.occurs);
	const of = typeof entry.on?.of === 'string' ? entry.on.of : symbol;
	if (!pay || !occurs || !of) return null;
	const stated = typeof entry.on?.mode === 'string' ? entry.on.mode : group;
	return { on: { occurs, of, mode: stated ?? (scatter.has(of) ? 'scatter' : 'line') }, pay };
};

const MODE_GROUPS = new Set(['line', 'scatter', 'ways', 'cluster']);

export const readDeclaredPaytable = (
	raw: unknown,
	scatterSymbols: readonly string[] = [],
): DeclaredPayEntry[] | null => {
	const scatter = new Set(scatterSymbols);
	const out: DeclaredPayEntry[] = [];
	const take = (value: unknown, symbol?: string, group?: string) => {
		for (const item of Array.isArray(value) ? value : [value]) {
			const entry = readEntry(item, scatter, symbol, group);
			if (entry) out.push(entry);
		}
	};
	if (Array.isArray(raw)) take(raw);
	else if (raw && typeof raw === 'object') {
		for (const [key, value] of Object.entries(raw)) {
			if (MODE_GROUPS.has(key) && Array.isArray(value)) take(value, undefined, key);
			else take(value, key);
		}
	}
	return out.length ? out : null;
};

/** The server's scatter symbols, in ITS vocabulary: `symbolsPay.scatter` when declared, else every
 *  server name `mapping` sends to its scatter. Decides the mode of a mode-less paytable row. */
const declaredScatterSymbols = (cfg: { symbolsPay?: unknown }, mapping: GameMapping): string[] => {
	const declared = (cfg.symbolsPay as { scatter?: unknown } | undefined)?.scatter;
	if (Array.isArray(declared)) return declared.filter((s): s is string => typeof s === 'string');
	return Object.keys(mapping.symbols).filter(
		(server) => mapping.symbols[server] === mapping.scatter,
	);
};

/**
 * A boot `config`'s declared paytable with every `of` named in ENGINE symbols (`H1`, not `PIC1`) —
 * the facade publishes it to the engine and the launcher's `/config` import reads it, so the two
 * cannot disagree on what a server declared. Null when nothing usable was declared.
 *
 * The name lookup is `mapSymbol` inlined (unmapped names pass through): this module takes no runtime
 * imports so `node` can load it directly (`scripts/verify-server-paytable.mts`).
 */
export const readMappedPaytable = (
	cfg: { paytable?: unknown; symbolsPay?: unknown },
	mapping: GameMapping,
): DeclaredPayEntry[] | null =>
	readDeclaredPaytable(cfg.paytable, declaredScatterSymbols(cfg, mapping))?.map((entry) => ({
		...entry,
		on: { ...entry.on, of: mapping.symbols[entry.on.of] ?? entry.on.of },
	})) ?? null;
