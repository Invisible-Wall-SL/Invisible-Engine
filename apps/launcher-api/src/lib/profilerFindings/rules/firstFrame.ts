/**
 * Before the first frame (`perf: 9`): what the page downloads before the game draws anything
 * (`network.byStage.beforeFirstFrame`) — the player looks at a blank page for all of it. Per game
 * and device class, the newest as-shipped reading of the current build with a first frame; shown
 * from {@link FIRST_FRAME.lowBytes}, medium from {@link FIRST_FRAME.mediumBytes}, with the first
 * frame's time (a device's, never a lab run's) and the largest files that came before it. The
 * estimate is those bytes: what moving them behind the loading screen takes off the blank page.
 */

import { fileLabel, toMb } from '../../profilerNetwork';
import {
	agent,
	groupBy,
	networkReadings,
	readingRef,
	round1,
	type Finding,
	type Rule,
} from '../finding';

export const FIRST_FRAME = { lowBytes: 1.5 * 1048576, mediumBytes: 3 * 1048576 } as const;

export const firstFrame: Rule = (ctx) => {
	const out: Finding[] = [];
	const shipped = networkReadings(ctx).filter(
		(x) => Object.keys(x.r.flags).length === 0 && x.net.firstFrameMs !== null,
	);
	for (const [key, group] of groupBy(
		shipped,
		(x) => `${x.r.gameKey ?? ''}|${x.r.deviceClass ?? '?'}`,
	)) {
		const newest = group[0];
		const stage = newest.net.byStage.beforeFirstFrame;
		if (stage.bytes < FIRST_FRAME.lowBytes) continue;
		const device = group.find((x) => x.r.source !== 'lab');
		const before = newest.net.heaviest.filter((f) => f.stage === 'beforeFirstFrame' && f.bytes);
		out.push({
			id: `firstFrame:${key}:${newest.r.buildVersion ?? ''}`,
			subject: `firstFrame:${key}`,
			rule: 'firstFrame',
			severity: stage.bytes >= FIRST_FRAME.mediumBytes ? 'medium' : 'low',
			title: `${toMb(stage.bytes)} MB before the first frame on ${newest.r.deviceClass ?? '?'}`,
			detail: [
				`${stage.files} file${stage.files === 1 ? '' : 's'} load before the game draws anything${
					device?.net.firstFrameMs != null
						? `; the first frame came ${round1(device.net.firstFrameMs / 1000)} s after the page started on ${device.r.gpu ?? 'this device'}`
						: ''
				}.`,
				'Defer what the first screen does not need until the loading screen shows.',
				...before.slice(0, 5).map((f) => `${fileLabel(f)} — ${toMb(f.bytes ?? 0)} MB`),
			],
			evidence: [
				readingRef(newest.r),
				...(device && device !== newest ? [readingRef(device.r)] : []),
			],
			estimate: {
				value: round1(toMb(stage.bytes)),
				unit: 'MB',
				basis: 'MB the page fetches before it draws',
			},
			owner: agent('engine-pixi-svelte'),
			deviceClass: newest.r.deviceClass,
			gameKey: newest.r.gameKey,
		});
	}
	return out;
};
