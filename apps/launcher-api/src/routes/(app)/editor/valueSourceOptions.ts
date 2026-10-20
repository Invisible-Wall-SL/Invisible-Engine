import {
	HOLD_AND_WIN_PARAM_CATALOG,
	PLATFORM_JACKPOT_PARAM_CATALOG,
	VALUE_BINDING_SOURCE_CATALOG,
	VALUE_SOURCE_CATALOG,
} from 'engine-layout';

export type SourceOption = { value: string; label: string; note?: string };
export type SourceGroup = { label: string; options: SourceOption[] };

/**
 * The engine number sources a picker offers, grouped as "Bind to value" shows them (each option's
 * value is `source:<name>`): the binding catalog — a `{param}` template only where the component
 * declares that param (`paramKeys`, Components side) — then every other number game value.
 */
export function engineSourceGroups(
	componentMode: boolean,
	paramKeys: readonly string[],
): SourceGroup[] {
	const groups: SourceGroup[] = [];
	const seen: string[] = [];
	for (const entry of VALUE_BINDING_SOURCE_CATALOG) {
		if (entry.needsParam && !(componentMode && paramKeys.includes(entry.needsParam))) continue;
		let group = groups.find((g) => g.label === entry.group);
		if (!group) {
			group = { label: entry.group, options: [] };
			groups.push(group);
		}
		group.options.push({ value: `source:${entry.key}`, label: entry.label, note: entry.note });
		seen.push(entry.key);
	}
	const game = [
		...VALUE_SOURCE_CATALOG,
		...HOLD_AND_WIN_PARAM_CATALOG,
		...PLATFORM_JACKPOT_PARAM_CATALOG,
	].filter((p) => p.kind === 'number' && !seen.includes(p.key));
	groups.push({
		label: 'Game values',
		options: game.map((p) => ({ value: `source:${p.key}`, label: p.label, note: p.note })),
	});
	return groups;
}
