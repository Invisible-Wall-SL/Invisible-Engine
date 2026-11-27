/**
 * Unused bytes: what a game's newest build ships that no player needs — files nothing loads
 * ("Shipped but never loaded") and bytes shipped twice ("Same bytes shipped twice"), from the build
 * breakdown's own totals; the files, largest first, from its facts. Removing them is the project's
 * content (the Invisible FTP Browser), so the owner is its author.
 */

import { mbOf } from '../facts';
import {
	buildFactsOf,
	buildRef,
	newestBuilds,
	PROJECT_AUTHOR,
	type Finding,
	type Rule,
} from '../finding';

/** A saving of at least this many bytes is worth a medium finding. */
export const UNUSED_MEDIUM_BYTES = 1048576;

export const unusedBytes: Rule = (ctx) => {
	const out: Finding[] = [];
	for (const b of newestBuilds(ctx.builds)) {
		const facts = buildFactsOf(ctx, b);
		const kinds = [
			{
				id: 'unloaded',
				bytes: b.unreferencedBytes,
				title: 'never loaded',
				basis: 'bytes of shipped files nothing loads',
				items: (facts?.unreferenced ?? []).map((f) => `${f.rel} (${mbOf(f.bytes)} MB)`),
			},
			{
				id: 'duplicates',
				bytes: b.duplicateBytes,
				title: 'shipped twice',
				basis: 'bytes of files identical to another shipped file',
				items: (facts?.duplicates ?? []).map((f) => `${f.rel} = ${f.of} (${mbOf(f.bytes)} MB)`),
			},
		];
		for (const k of kinds) {
			if (k.bytes <= 0) continue;
			out.push({
				id: `unusedBytes:${k.id}:${b.id}`,
				subject: `unusedBytes:${k.id}:${b.gameKey}:${b.kind}`,
				rule: 'unusedBytes',
				severity: k.bytes >= UNUSED_MEDIUM_BYTES ? 'medium' : 'low',
				title: `${mbOf(k.bytes)} MB ${k.title} in v${b.build}`,
				detail: k.items.slice(0, 6),
				evidence: [buildRef(b)],
				estimate: { value: mbOf(k.bytes), unit: 'MB', basis: k.basis },
				owner: PROJECT_AUTHOR,
				deviceClass: null,
				gameKey: b.gameKey,
			});
		}
	}
	return out;
};
