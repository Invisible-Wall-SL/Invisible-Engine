/**
 * Downloaded again (`perf: 9`): bytes a player pays twice.
 * - **Between loads**: on one device (class, GPU, browser, label), the newest page load against the
 *   load before it (`network.loadId`): the files of ≥ 50 KB whose body crossed the network again
 *   though the earlier load had them — the cache did not keep them (`no-store`, or a short
 *   `max-age` with nothing to revalidate against). A reload or back/forward that still downloads
 *   them says the same from one reading.
 * - **Twice in one load**: a path whose body crossed more than once in the same load (`repeats`).
 * Never a lab run: each starts a fresh browser with an empty cache. The estimate is the bytes
 * downloaded again. Caching is the delivery owner's (`owners.json` `areas.delivery`).
 */

import { fileKey, fileLabel, toMb, type NetworkFacts } from '../../profilerNetwork';
import {
	areaOwner,
	deviceOf,
	groupBy,
	networkReadings,
	readingRef,
	round1,
	type Finding,
	type Rule,
} from '../finding';

/** Bytes downloaded again past this are worth a medium finding. */
export const NOT_CACHED_MEDIUM_BYTES = 1048576;

const severityOf = (bytes: number) => (bytes >= NOT_CACHED_MEDIUM_BYTES ? 'medium' : 'low');
const hostsOf = (files: { host: string | null }[]) =>
	[...new Set(files.map((f) => f.host ?? 'the game’s own host'))].join(', ');
const minutes = (ms: number) =>
	ms >= 120_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`;

const CACHE_HINT =
	'Cache-Control on {hosts}: `no-store`, or a short max-age with no ETag to revalidate, makes every visit download them again — content-hashed names with `immutable`, or `no-cache` with an ETag (a 304), keep them.';

export const notCached: Rule = (ctx) => {
	const out: Finding[] = [];
	const owner = areaOwner(ctx.owners, 'delivery', 'infra-railway');
	const all = networkReadings(ctx, { lab: false });

	const devices = groupBy(
		all.filter((x) => x.net.loadId !== null),
		(x) => `${x.r.gameKey ?? ''}|${deviceOf(x.r)}|${x.r.uaFamily ?? ''}|${x.r.label ?? ''}`,
	);
	for (const [key, group] of devices) {
		// One reading per load (the newest), loads oldest first.
		const loads = [...groupBy(group, (x) => String(x.net.loadId)).values()]
			.map((rs) => rs[0])
			.sort((a, b) => (a.net.loadId ?? 0) - (b.net.loadId ?? 0));
		const now = loads.at(-1);
		if (!now) continue;
		const before = loads.at(-2);
		if (before) {
			const had = new Set([...before.net.crossed, ...before.net.heaviest].map(fileKey));
			const again = now.net.crossed.filter((f) => had.has(fileKey(f)));
			if (again.length) {
				const bytes = again.reduce((n, f) => n + (f.bytes ?? 0), 0);
				out.push({
					id: `notCached:loads:${key}:${now.r.buildVersion ?? ''}`,
					subject: `notCached:loads:${key}`,
					rule: 'notCached',
					severity: severityOf(bytes),
					title: `${toMb(bytes)} MB downloaded again on the next load on ${deviceOf(now.r)}`,
					detail: [
						`${again.length} file${again.length === 1 ? '' : 's'} the load ${minutes((now.net.loadId ?? 0) - (before.net.loadId ?? 0))} earlier had already fetched crossed the network again.`,
						CACHE_HINT.replace('{hosts}', hostsOf(again)),
						...again.slice(0, 5).map((f) => `${fileLabel(f)} — ${toMb(f.bytes ?? 0)} MB`),
					],
					evidence: [readingRef(before.r), readingRef(now.r)],
					estimate: { value: round1(toMb(bytes)), unit: 'MB', basis: 'MB downloaded again' },
					owner,
					deviceClass: now.r.deviceClass,
					gameKey: now.r.gameKey,
				});
				continue;
			}
		}
		const reloaded = (n: NetworkFacts) =>
			n.navigation === 'reload' || n.navigation === 'back_forward';
		if (reloaded(now.net) && now.net.crossed.length) {
			const files = now.net.crossed;
			const bytes = files.reduce((n, f) => n + (f.bytes ?? 0), 0);
			out.push({
				id: `notCached:reload:${key}:${now.r.buildVersion ?? ''}`,
				subject: `notCached:reload:${key}`,
				rule: 'notCached',
				severity: severityOf(bytes),
				title: `A ${now.net.navigation === 'reload' ? 'reload' : 'back / forward'} downloaded ${toMb(bytes)} MB again on ${deviceOf(now.r)}`,
				detail: [
					`The page had loaded before, yet ${files.length} file${files.length === 1 ? '' : 's'} crossed the network again.`,
					CACHE_HINT.replace('{hosts}', hostsOf(files)),
					...files.slice(0, 5).map((f) => `${fileLabel(f)} — ${toMb(f.bytes ?? 0)} MB`),
				],
				evidence: [readingRef(now.r)],
				estimate: { value: round1(toMb(bytes)), unit: 'MB', basis: 'MB downloaded again' },
				owner,
				deviceClass: now.r.deviceClass,
				gameKey: now.r.gameKey,
			});
		}
	}

	for (const [game, group] of groupBy(all, (x) => x.r.gameKey ?? '')) {
		const hit = group.find((x) => x.net.repeats.length);
		if (!hit) continue;
		const repeats = hit.net.repeats;
		const extra = repeats.reduce((n, r) => n + (r.bytes * (r.count - 1)) / r.count, 0);
		out.push({
			id: `notCached:repeat:${game}:${hit.r.buildVersion ?? ''}`,
			subject: `notCached:repeat:${game}`,
			rule: 'notCached',
			severity: severityOf(extra),
			title: `${repeats.length} file${repeats.length === 1 ? '' : 's'} downloaded more than once in one load`,
			detail: [
				'The same path crossed the network again in the same page load: two loaders asking for it, or a cache that keeps nothing.',
				...repeats
					.slice(0, 5)
					.map((r) => `${fileLabel(r)} — ${r.count}×, ${toMb(r.bytes)} MB in all`),
			],
			evidence: [readingRef(hit.r)],
			estimate: { value: round1(toMb(extra)), unit: 'MB', basis: 'MB of the extra downloads' },
			owner,
			deviceClass: hit.r.deviceClass,
			gameKey: hit.r.gameKey,
		});
	}
	return out;
};
