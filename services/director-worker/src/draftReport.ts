/**
 * What a settled `build.play_draft` tells the agent that queued it (ADR-0010 §3, §4): the report
 * summary the player sent, cut to what QA reports from. Pure, so a fixture can read it.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function scenarioLine(raw: unknown): string {
	const s = isRecord(raw) ? raw : {};
	const missing = strings(s.missing);
	const errors = strings(s.consoleErrors);
	const stall = isRecord(s.stall)
		? `; stalled at ${String(s.stall.op ?? 'a wait')} (frames ${String(s.stall.frames ?? '?')})`
		: '';
	return [
		`- ${String(s.id ?? 'scenario')}: reached ${strings(s.reached).join(', ') || 'nothing'}`,
		missing.length ? `; missing ${missing.join(', ')}` : '',
		stall,
		errors.length ? `; ${errors.length} console error(s): ${errors.join(' | ')}` : '',
	].join('');
}

export function draftPlayMessage(payload: Record<string, unknown>): string {
	const jobRef = String(payload.jobRef ?? '');
	const status = String(payload.status ?? '');
	const result = isRecord(payload.result) ? payload.result : {};
	if (status !== 'finished') {
		const reason = String(result.reason ?? status);
		const why = result.message ?? result.error ?? '';
		return `Draft play ${jobRef} did not finish (${status}, ${reason}): the draft was NOT played.${why ? ` ${String(why)}` : ''} Report it as not played; do not call it a pass.`;
	}
	const scenarios = Array.isArray(result.scenarios) ? result.scenarios : [];
	const boot = typeof result.bootRefused === 'string' ? result.bootRefused : null;
	return [
		`Draft play ${jobRef} finished (draft ${String(payload.draftId ?? result.draftId ?? '')}, ${String(result.kind ?? 'game')}, ${String(result.seconds ?? '?')} s).`,
		boot ? `The runtime refused to boot: ${boot}` : '',
		...scenarios.map(scenarioLine),
		`Report: ${JSON.stringify(result).slice(0, 6000)}`,
	]
		.filter(Boolean)
		.join('\n');
}
