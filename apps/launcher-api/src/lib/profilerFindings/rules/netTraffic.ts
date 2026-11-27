/**
 * Slow or heavy messages (`perf: 9`), per game and device over the as-shipped readings of the
 * current build:
 * - **RGS**: the requests' p95 latency (median over readings with ≥ {@link NET_TRAFFIC.rgsMinRequests}
 *   requests) from {@link NET_TRAFFIC.rgsSlowMs}, medium from {@link NET_TRAFFIC.rgsVerySlowMs}; or a
 *   response past {@link NET_TRAFFIC.rgsLargeBytes}. Never a lab run's latency (a runner's network).
 *   The partner runs the production RGS, so the host is named: a slow partner is theirs to know.
 * - **Game server** (online arcade): the room's bytes in a second from
 *   {@link NET_TRAFFIC.socketBytesPerSecond}, medium from {@link NET_TRAFFIC.socketHeavyBytesPerSecond},
 *   or one message past {@link NET_TRAFFIC.socketLargeBytes}. How late its states arrive is Patch /
 *   jitter stutter's; this is how much the room sends.
 * No estimate: the saving depends on what the server stops sending.
 */

import { fileLabel } from '../../profilerNetwork';
import {
	areaOwner,
	deviceOf,
	groupBy,
	median,
	networkReadings,
	readingRef,
	round1,
	type Finding,
	type Rule,
} from '../finding';

export const NET_TRAFFIC = {
	rgsMinRequests: 5,
	rgsSlowMs: 500,
	rgsVerySlowMs: 1000,
	rgsLargeBytes: 100 * 1024,
	socketBytesPerSecond: 30 * 1024,
	socketHeavyBytesPerSecond: 100 * 1024,
	socketLargeBytes: 32 * 1024,
} as const;

const kb = (bytes: number) => round1(bytes / 1024);

export const netTraffic: Rule = (ctx) => {
	const out: Finding[] = [];
	const shipped = networkReadings(ctx, { lab: false }).filter(
		(x) => Object.keys(x.r.flags).length === 0,
	);
	for (const [key, group] of groupBy(shipped, (x) => `${x.r.gameKey ?? ''}|${deviceOf(x.r)}`)) {
		const rgs = group.filter((x) => x.net.rgs.requests >= NET_TRAFFIC.rgsMinRequests);
		if (rgs.length) {
			const p95 = median(rgs.map((x) => x.net.rgs.ms.p95)) ?? 0;
			const p50 = median(rgs.map((x) => x.net.rgs.ms.p50)) ?? 0;
			const largest = Math.max(...rgs.map((x) => x.net.rgs.largest));
			const slow = p95 >= NET_TRAFFIC.rgsSlowMs;
			const heavy = largest >= NET_TRAFFIC.rgsLargeBytes;
			if (slow || heavy) {
				const newest = rgs[0];
				const hosts = [
					...new Set(newest.net.rgs.slowest.map((s) => s.host ?? 'the game’s own host')),
				];
				out.push({
					id: `netTraffic:rgs:${key}:${newest.r.buildVersion ?? ''}`,
					subject: `netTraffic:rgs:${key}`,
					rule: 'netTraffic',
					severity: p95 >= NET_TRAFFIC.rgsVerySlowMs ? 'medium' : 'low',
					title: slow
						? `RGS answers in ${p95} ms (p95) on ${deviceOf(newest.r)}`
						: `An RGS answer of ${kb(largest)} KB on ${deviceOf(newest.r)}`,
					detail: [
						`${newest.net.rgs.requests} requests: p50 ${p50} ms, p95 ${p95} ms, max ${newest.net.rgs.ms.max} ms (median over ${rgs.length} reading${rgs.length === 1 ? '' : 's'}); the largest answer ${kb(largest)} KB.`,
						`RGS host: ${hosts.join(', ') || '—'} — production is the partner's server, its time is theirs.`,
						...newest.net.rgs.slowest.map(
							(s) => `${fileLabel(s)} — ${s.ms} ms at ${round1(s.start / 1000)} s`,
						),
					],
					evidence: rgs.slice(0, 6).map((x) => readingRef(x.r)),
					estimate: null,
					owner: areaOwner(ctx.owners, 'rgs', 'engine-pixi-svelte'),
					deviceClass: newest.r.deviceClass,
					gameKey: newest.r.gameKey,
				});
			}
		}

		const rooms = group.filter((x) => x.net.socket && x.net.socket.inMessages > 0);
		if (!rooms.length) continue;
		const perSecond = median(rooms.map((x) => x.net.socket?.inBytesPerSecond ?? 0)) ?? 0;
		const largestIn = Math.max(...rooms.map((x) => x.net.socket?.inLargest ?? 0));
		if (perSecond < NET_TRAFFIC.socketBytesPerSecond && largestIn < NET_TRAFFIC.socketLargeBytes) {
			continue;
		}
		const newest = rooms[0];
		const s = newest.net.socket;
		out.push({
			id: `netTraffic:socket:${key}:${newest.r.buildVersion ?? ''}`,
			subject: `netTraffic:socket:${key}`,
			rule: 'netTraffic',
			severity: perSecond >= NET_TRAFFIC.socketHeavyBytesPerSecond ? 'medium' : 'low',
			title:
				perSecond >= NET_TRAFFIC.socketBytesPerSecond
					? `The room sends ${kb(perSecond)} KB a second on ${deviceOf(newest.r)}`
					: `A room message of ${kb(largestIn)} KB on ${deviceOf(newest.r)}`,
			detail: [
				`In: ${s?.inMessagesPerSecond ?? 0} messages a second, ${kb(perSecond)} KB a second (median over ${rooms.length} reading${rooms.length === 1 ? '' : 's'}); the largest ${kb(largestIn)} KB.`,
				...(s
					? [
							`Of them, ${s.states} room states (${kb(s.stateBytes)} KB); out: ${s.outMessages} messages, ${kb(s.outBytesPerSecond)} KB a second, over ${s.seconds} s.`,
						]
					: []),
				'On mobile data this is the player’s allowance: send less per patch, or patch less often.',
			],
			evidence: rooms.slice(0, 6).map((x) => readingRef(x.r)),
			estimate: null,
			owner: areaOwner(ctx.owners, 'gameServer', 'arcade-games'),
			deviceClass: newest.r.deviceClass,
			gameKey: newest.r.gameKey,
		});
	}
	return out;
};
