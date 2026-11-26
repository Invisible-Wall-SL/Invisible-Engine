/**
 * Spikes by cause: the frames over the spike threshold (`perfSpikes.ts`: max(33 ms, 2.5 display
 * frames)) while something plays — spinning, in a round with the reels at rest, or an arcade game's
 * field in play — counted per likely cause (`spikeCauses`) over each device's readings of the
 * current build. A spike at idle or in an arcade menu is left out: the player is not watching
 * anything move. Lab readings never count: a software renderer makes every frame a spike. The
 * estimate is the count a fix of that cause removes.
 */

import type { PerfPhase } from '../../profiler';
import {
	agent,
	currentReadings,
	deviceOf,
	factsOf,
	fpsReadings,
	groupBy,
	kindOwner,
	readingRef,
	toolOwner,
	type Finding,
	type FindingContext,
	type FindingOwner,
	type Rule,
} from '../finding';

const MID_PLAY: readonly PerfPhase[] = ['spinning', 'round', 'play'];

export const SPIKE_MIN = { count: 2, medium: 3 } as const;

const FIX: Record<string, string> = {
	'first use': 'a shader compiled or a texture uploaded mid-round: warm it up before the round',
	particles: 'emitter updates took the frame',
	rigs: 'rig updates and mesh rebuilds took the frame',
	churn: 'display objects or components built and destroyed mid-round',
	'page JS': 'JS outside the Pixi tick (Svelte effects, tweens) took the frame',
	'game code': 'the tick’s own game code took the frame',
	'GC (likely)': 'garbage collection after allocations',
	'outside the game': 'the GPU, the compositor or the browser — not our JS',
	mixed: 'JS and the browser together',
	'sim catch-up':
		'the sim ran extra fixed steps to catch up after a long frame, which made this one long too',
	sim: 'one fixed sim step took the frame',
	'spawn burst': 'bodies spawned or despawned together took the frame: pool them',
	'tilemap/upload': 'a tilemap built or a texture uploaded mid-play: build it before play starts',
	'state patch': 'room messages (decode, state callbacks, reconcile) took the frame',
};

/** Causes the arcade runtime's own work explains: its kind's agent owns them. */
const ARCADE_CAUSES = new Set([
	'sim catch-up',
	'sim',
	'spawn burst',
	'tilemap/upload',
	'state patch',
]);

function ownerOf(ctx: FindingContext, cause: string): FindingOwner {
	if (cause === 'particles') return toolOwner(ctx.owners, 'fx', 'invisible-fx');
	if (cause === 'rigs') return toolOwner(ctx.owners, 'rigger', 'invisible-rigger');
	if (cause === 'game code') return kindOwner(ctx.owners, ctx.gameKind);
	if (ARCADE_CAUSES.has(cause)) return kindOwner(ctx.owners, 'arcade');
	return agent('engine-pixi-svelte');
}

export const spikes: Rule = (ctx) => {
	const out: Finding[] = [];
	const readings = currentReadings(fpsReadings(ctx.readings), ctx.builds).filter(
		(r) => Object.keys(r.flags).length === 0 && factsOf(ctx, r)?.spikeCauses,
	);
	for (const [key, group] of groupBy(readings, (r) => `${r.gameKey ?? ''}|${deviceOf(r)}`)) {
		const counts = new Map<string, number>();
		for (const r of group) {
			const causes = factsOf(ctx, r)!.spikeCauses!;
			for (const phase of MID_PLAY) {
				for (const [cause, n] of Object.entries(causes[phase] ?? {})) {
					counts.set(cause, (counts.get(cause) ?? 0) + n);
				}
			}
		}
		for (const [cause, n] of counts) {
			if (n < SPIKE_MIN.count) continue;
			const examples = group
				.flatMap((r) => factsOf(ctx, r)!.spikes)
				.filter((s) => s.cause === cause && MID_PLAY.includes(s.phase))
				.map((s) => `${Math.round(s.ms)} ms at ${s.at}s (${s.phase}): ${s.why}`)
				.filter((line, i, all) => all.indexOf(line) === i)
				.slice(0, 3);
			const mid = group[0].phaseSet === 'arcade' ? 'mid-play' : 'mid-round';
			out.push({
				id: `spikes:${key}:${group[0].buildVersion ?? ''}:${cause}`,
				rule: 'spikes',
				severity: n >= SPIKE_MIN.medium && cause === 'first use' ? 'medium' : 'low',
				title: `${n} ${mid} spikes from ${cause} on ${deviceOf(group[0])}`,
				detail: [`${FIX[cause] ?? cause}.`, ...examples],
				evidence: group.slice(0, 6).map(readingRef),
				estimate: {
					value: n,
					unit: 'spikes',
					basis: `spikes ${mid} in ${group.length} reading${group.length === 1 ? '' : 's'}`,
				},
				owner: ownerOf(ctx, cause),
				deviceClass: group[0].deviceClass,
				gameKey: group[0].gameKey,
			});
		}
	}
	return out;
};
