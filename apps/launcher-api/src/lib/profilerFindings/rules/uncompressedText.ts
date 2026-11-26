/**
 * Uncompressed text (`perf: 9`): code, styles, atlas and JSON text, the page and SVG that crossed
 * as served at ≥ 90% of their decoded size and ≥ 8 KB (`profilerNetwork.ts` `uncompressed`) — no
 * gzip or brotli on the server that sent them. Per game, from the newest reading of its current build
 * that has the list; the servers are named, since compression is theirs to switch on (the delivery
 * owner: `owners.json` `areas.delivery`). Unmeasured: what gzip would save is not measured here.
 */

import { fileLabel, toMb } from '../../profilerNetwork';
import {
	areaOwner,
	groupBy,
	networkReadings,
	readingRef,
	type Finding,
	type Rule,
} from '../finding';

/** Uncompressed text past this is worth a medium finding. */
export const UNCOMPRESSED_MEDIUM_BYTES = 512 * 1024;

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

export const uncompressedText: Rule = (ctx) => {
	const out: Finding[] = [];
	for (const [game, group] of groupBy(networkReadings(ctx), (x) => x.r.gameKey ?? '')) {
		const hit = group.find((x) => x.net.uncompressed.length);
		if (!hit) continue;
		const files = hit.net.uncompressed;
		const bytes = files.reduce((n, f) => n + (f.bytes ?? 0), 0);
		const hosts = [...new Set(files.map((f) => f.host ?? 'the game’s own host'))];
		out.push({
			id: `uncompressedText:${game}:${hit.r.buildVersion ?? ''}`,
			rule: 'uncompressedText',
			severity: bytes >= UNCOMPRESSED_MEDIUM_BYTES ? 'medium' : 'low',
			title: `${files.length} text file${files.length === 1 ? '' : 's'} served uncompressed (${toMb(bytes)} MB)`,
			detail: [
				`Served without gzip or brotli by ${hosts.join(', ')}: switch compression on there for JSON, JS, CSS and atlas text.`,
				...files
					.slice(0, 6)
					.map(
						(f) => `${fileLabel(f)} — ${kb(f.bytes ?? 0)} as served, ${kb(f.decoded ?? 0)} decoded`,
					),
			],
			evidence: [readingRef(hit.r)],
			estimate: null,
			owner: areaOwner(ctx.owners, 'delivery', 'infra-railway'),
			deviceClass: null,
			gameKey: hit.r.gameKey,
		});
	}
	return out;
};
