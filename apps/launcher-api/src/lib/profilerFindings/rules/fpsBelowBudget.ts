/**
 * Fps below budget: a device whose phase fps (or p95 frame time) is past its budget line, judged by
 * P3's own evaluation (`profilerBudgets.ts` `deviceGroups`: as-shipped readings, the median per
 * device group, too few frames is not a verdict) over the readings of each game's current build.
 * Lab readings never count (P6). The estimate is how far the median is from the warn line.
 */

import { deviceGroups, lineText } from '../../profilerBudgets';
import {
	currentReadings,
	fpsReadings,
	groupBy,
	kindOwner,
	readingRef,
	round1,
	type Finding,
	type Rule,
} from '../finding';

export const fpsBelowBudget: Rule = (ctx) => {
	const out: Finding[] = [];
	const byGame = groupBy(
		currentReadings(fpsReadings(ctx.readings), ctx.builds),
		(r) => r.gameKey ?? '',
	);
	for (const [game, readings] of byGame) {
		for (const g of deviceGroups(readings, ctx.budgets)) {
			for (const m of g.metrics) {
				if (m.metric !== 'fps' && m.metric !== 'p95' && m.metric !== 'busy') continue;
				if (m.verdict !== 'warn' && m.verdict !== 'fail') continue;
				if (m.value === null) continue;
				const fps = m.metric === 'fps';
				const busy = m.metric === 'busy';
				const line = m.warn ?? m.fail;
				out.push({
					id: `fpsBelowBudget:${game}:${g.readings[0].buildVersion ?? ''}:${g.id}:${m.metric}:${m.phase}`,
					subject: `fpsBelowBudget:${game}:${g.id}:${m.metric}:${m.phase}`,
					rule: 'fpsBelowBudget',
					severity: m.verdict === 'fail' ? 'high' : 'medium',
					title: fps
						? `${m.phase} at ${round1(m.value)} fps on ${g.deviceClass} · ${g.gpu}`
						: busy
							? `${m.phase} busy ${round1(m.value)} ms (p95) on ${g.deviceClass} · ${g.gpu}`
							: `${m.phase} p95 ${round1(m.value)} ms on ${g.deviceClass} · ${g.gpu}`,
					detail: [
						`Budget: fail ${lineText(m.metric, m.fail)}, warn ${lineText(m.metric, m.warn)}.`,
						`Median of ${g.readings.length} reading${g.readings.length === 1 ? '' : 's'}, ${m.frames ?? 0} ${m.phase} frames.`,
					],
					evidence: g.readings.slice(0, 6).map(readingRef),
					estimate:
						fps && line !== null
							? { value: round1(line - m.value), unit: 'fps', basis: 'fps short of the warn line' }
							: busy && line !== null
								? {
										value: round1(m.value - line),
										unit: 'ms',
										basis: 'ms of busy time over the warn line',
									}
								: null,
					owner: kindOwner(ctx.owners, ctx.gameKind),
					deviceClass: g.deviceClass,
					gameKey: game || null,
				});
			}
		}
	}
	return out;
};
