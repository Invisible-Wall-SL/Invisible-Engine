/**
 * What QA is told of a settled draft play (ADR-0010 §4):
 *
 *   pnpm --filter director-worker check:draft-report
 *
 * A play that did not finish, whatever the reason, says the draft was NOT played; a finished one
 * names each scenario's reached and missing screens, its stall and its console errors.
 */
import { draftPlayMessage } from './draftReport.ts';

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
	checks++;
	if (ok) return;
	failures++;
	console.error(`FAIL  ${label}`, detail ?? '');
}

const noPlayer = draftPlayMessage({
	jobRef: 'dp_0000000000000001',
	status: 'failed',
	result: {
		reason: 'no_player',
		message: 'No draft player is deployed, so the draft was not played.',
	},
});
check(
	'no_player says NOT played and names the reason',
	/NOT played/.test(noPlayer) && /no_player/.test(noPlayer),
	noPlayer,
);
check('...and tells QA not to call it a pass', /not .*a pass/.test(noPlayer), noPlayer);

const cancelled = draftPlayMessage({
	jobRef: 'dp_0000000000000002',
	status: 'cancelled',
	result: null,
});
check('a cancelled play is NOT played', /NOT played/.test(cancelled), cancelled);

const done = draftPlayMessage({
	jobRef: 'dp_0000000000000003',
	draftId: '20261027T101530Z-3fa9',
	status: 'finished',
	result: {
		kind: 'lines',
		seconds: 130,
		bootRefused: null,
		scenarios: [
			{
				id: 'base',
				reached: ['idle', 'spin'],
				missing: ['win'],
				stall: { op: 'waitFor', frames: 900 },
				consoleErrors: ['TypeError: x'],
			},
		],
	},
});
check(
	'a finished play lists reached, missing, the stall and the console errors',
	/base: reached idle, spin/.test(done) &&
		/missing win/.test(done) &&
		/stalled at waitFor \(frames 900\)/.test(done) &&
		/1 console error\(s\): TypeError: x/.test(done),
	done,
);
check('...and is not called NOT played', !/NOT played/.test(done), done);

const refused = draftPlayMessage({
	jobRef: 'dp_0000000000000004',
	status: 'finished',
	result: { bootRefused: '[runtime] boot stopped — no config', scenarios: [] },
});
check(
	'a refused boot is named',
	/refused to boot: \[runtime\] boot stopped/.test(refused),
	refused,
);

console.log(`draft-report: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
