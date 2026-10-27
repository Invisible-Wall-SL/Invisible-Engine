import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	FAMILY_PACK_FAMILIES,
	parseFamilyPack,
	READY_FAMILY_PACKS,
	type FamilyPack,
	type PackFamily,
} from './familyPack.ts';

/**
 * Runtime family packs (ADR-0009 §4): `families/<family>.md`, loaded once at boot like the agent
 * definitions. A pack that fails validation, a family with no pack, or a file that is no family's
 * stops the worker booting, so a bad edit never reaches a run. The parser is `familyPack.ts`.
 */

export {
	FAMILY_PACK_FAMILIES,
	READY_FAMILY_PACKS,
	type FamilyPack,
	type PackFamily,
} from './familyPack.ts';

/** Load every `*.md` in `dir`, throwing one error that lists every problem in every file. */
export function loadFamilyPacks(dir: string): Map<PackFamily, FamilyPack> {
	const packs = new Map<PackFamily, FamilyPack>();
	const problems: string[] = [];
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.md'))
		.sort();
	for (const file of files) {
		const result = parseFamilyPack(file, readFileSync(join(dir, file), 'utf8'));
		if (result.ok) packs.set(result.pack.family, result.pack);
		else problems.push(...result.errors.map((e) => `${file}: ${e}`));
	}
	for (const family of FAMILY_PACK_FAMILIES) {
		if (!files.includes(`${family}.md`)) problems.push(`${family}.md: missing`);
	}
	if (problems.length > 0) {
		throw new Error(`Invalid family packs:\n  ${problems.join('\n  ')}`);
	}
	return packs;
}

/** The pack a run of `family` runs with, or null when the family has no ready pack. */
export function readyPack(
	packs: ReadonlyMap<PackFamily, FamilyPack>,
	family: string,
): FamilyPack | null {
	const pack = packs.get(family as PackFamily);
	return pack && READY_FAMILY_PACKS.has(pack.family) ? pack : null;
}
