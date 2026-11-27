/**
 * Heavy downloads (`perf: 9`): what a game's page downloads against its transfer budget, per device
 * class — the total (`transferMb`, the median over the as-shipped readings of the current build) and
 * every file over the largest-file line (`fileMb`, from the newest reading's heaviest files), each
 * named with what would make it lighter. The total counts each file's body as served, whether that
 * load took it from the cache or not; a file whose size the browser hid is counted apart, never as
 * 0. GPU memory is the Textures rule's and files nothing loads are Unused bytes': a file here was
 * loaded, and a texture's GPU cost is only named beside it. Sizes are not timing, so lab runs count.
 */

import { judge, readingDeviceClass } from '../../profilerBudgets';
import {
	fileLabel,
	fileName,
	knownTransferMb,
	NET_CLASS_LABELS,
	toMb,
	type NetClass,
	type NetFileFact,
} from '../../profilerNetwork';
import {
	agent,
	areaOwner,
	factsOf,
	groupBy,
	median,
	networkReadings,
	PROJECT_AUTHOR,
	readingRef,
	round1,
	type Finding,
	type FindingContext,
	type FindingOwner,
	type Rule,
} from '../finding';

const ART: readonly NetClass[] = ['image', 'ktx2', 'json', 'rig'];

/** What would make one heavy file lighter, by what it is. */
export function lighterHint(f: Pick<NetFileFact, 'class' | 'path'>): string {
	if (/\.png$/i.test(f.path)) return '🗜 Optimize ships it as WebP';
	switch (f.class) {
		case 'image':
			return 'lower the page’s resolution or split it (Atlas Maker)';
		case 'ktx2':
			return 'a KTX2 page downloads larger than its WebP twin; only phones and tablets load it';
		case 'audio':
			return '🗜 Optimize keeps one format; a lower bitrate or a shorter loop';
		case 'json':
		case 'rig':
			return 'text: check it is served compressed (Uncompressed text)';
		case 'js':
		case 'css':
			return 'the runtime’s code: split what the first screen does not need';
		default:
			return 'cut or defer it';
	}
}

function ownerOf(ctx: FindingContext, cls: NetClass): FindingOwner {
	if (ART.includes(cls)) return areaOwner(ctx.owners, 'assets', 'atlas-python-tools');
	if (cls === 'js' || cls === 'css' || cls === 'document') return agent('engine-pixi-svelte');
	if (cls === 'api') return areaOwner(ctx.owners, 'rgs', 'engine-pixi-svelte');
	return PROJECT_AUTHOR;
}

const mbText = (bytes: number) => `${toMb(bytes)} MB`;

export const heavyTransfer: Rule = (ctx) => {
	const out: Finding[] = [];
	const shipped = networkReadings(ctx).filter((x) => Object.keys(x.r.flags).length === 0);
	for (const [key, group] of groupBy(
		shipped,
		(x) => `${x.r.gameKey ?? ''}|${x.r.deviceClass ?? '?'}`,
	)) {
		const deviceClass = readingDeviceClass(group[0].r);
		if (!deviceClass) continue;
		const newest = group[0];
		const build = newest.r.buildVersion ?? '';
		const evidence = group.slice(0, 6).map((x) => readingRef(x.r));
		const line = (metric: 'transferMb' | 'fileMb') =>
			ctx.budgets.find(
				(b) => b.deviceClass === deviceClass && b.metric === metric && b.phase === '',
			);

		const total = median(
			group.map((x) => knownTransferMb(x.r.network)).filter((v): v is number => v !== null),
		);
		const totalLine = line('transferMb');
		const totalVerdict = judge('transferMb', total, totalLine);
		if (total !== null && (totalVerdict === 'warn' || totalVerdict === 'fail')) {
			const classes = Object.entries(newest.net.byClass)
				.filter(([, t]) => t.bytes > 0)
				.sort(([, a], [, b]) => b.bytes - a.bytes)
				.slice(0, 4)
				.map(
					([c, t]) => `${NET_CLASS_LABELS[c as NetClass]} ${mbText(t.bytes)} in ${t.files} files`,
				);
			const unknown = newest.net.totals.unknown;
			const top = newest.net.heaviest.find((f) => f.bytes !== null);
			out.push({
				id: `heavyTransfer:total:${key}:${build}`,
				subject: `heavyTransfer:total:${key}`,
				rule: 'heavyTransfer',
				severity: totalVerdict === 'fail' ? 'high' : 'medium',
				title: `${round1(total)} MB downloaded on ${deviceClass}`,
				detail: [
					`Budget: fail > ${totalLine?.fail ?? '—'} MB, warn > ${totalLine?.warn ?? '—'} MB (median over ${group.length} reading${group.length === 1 ? '' : 's'}).`,
					...classes,
					...(unknown
						? [
								`${unknown} more file${unknown === 1 ? '' : 's'} hid their size (cross-origin, no Timing-Allow-Origin): not counted.`,
							]
						: []),
				],
				evidence,
				estimate:
					totalLine?.warn !== null && totalLine?.warn !== undefined
						? { value: round1(total - totalLine.warn), unit: 'MB', basis: 'MB over the warn line' }
						: null,
				owner: ownerOf(ctx, top?.class ?? 'other'),
				deviceClass: newest.r.deviceClass,
				gameKey: newest.r.gameKey,
			});
		}

		const fileLine = line('fileMb');
		const heavy = newest.net.heaviest.filter((f) => {
			const v = judge('fileMb', f.bytes === null ? null : toMb(f.bytes), fileLine);
			return v === 'warn' || v === 'fail';
		});
		if (!heavy.length) continue;
		const textures = factsOf(ctx, newest.r)?.textures ?? [];
		const gpuNote = (f: NetFileFact) => {
			const t = textures.find((x) => x.src.endsWith(fileName(f)));
			return t ? `; it holds ${t.mb} GPU MB (Textures)` : '';
		};
		const failing = heavy.some((f) => judge('fileMb', toMb(f.bytes ?? 0), fileLine) === 'fail');
		const bytes = heavy.reduce((n, f) => n + (f.bytes ?? 0), 0);
		out.push({
			id: `heavyTransfer:files:${key}:${build}`,
			subject: `heavyTransfer:files:${key}`,
			rule: 'heavyTransfer',
			severity: failing ? 'high' : 'medium',
			title: `${heavy.length} file${heavy.length === 1 ? '' : 's'} over ${fileLine?.warn ?? fileLine?.fail} MB on ${deviceClass}`,
			detail: [
				`Budget per file: fail > ${fileLine?.fail ?? '—'} MB, warn > ${fileLine?.warn ?? '—'} MB.`,
				...heavy
					.slice(0, 6)
					.map(
						(f) =>
							`${fileLabel(f)} — ${mbText(f.bytes ?? 0)} (${NET_CLASS_LABELS[f.class]}): ${lighterHint(f)}${gpuNote(f)}.`,
					),
			],
			evidence: [readingRef(newest.r)],
			estimate: { value: round1(toMb(bytes)), unit: 'MB', basis: 'MB of the files over the line' },
			owner: ownerOf(ctx, heavy[0].class),
			deviceClass: newest.r.deviceClass,
			gameKey: newest.r.gameKey,
		});
	}
	return out;
};
