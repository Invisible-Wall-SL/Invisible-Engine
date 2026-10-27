// What the draft-player service's `/play` handler will call (the HTTP service itself waits for the
// owner's approval of ADR-0010). Prints the play report as JSON on stdout.
//
//   node services/draft-player/src/cli.mjs --draft <dir> --runtime <dir> --contract <json>
//     --kind <gameType> --out <dir> [--scenario id]… [--seed s] [--chrome <exe>]
//
// Exit 0 with a report (a failed play is a report, not an error); 2 when it could not be asked.

import { parseArgs } from 'node:util';

import { headlessShell } from '../../../scripts/playtest/headless-shell.mjs';
import { playDraft } from './playDraft.mjs';

const { values } = parseArgs({
	options: {
		draft: { type: 'string' },
		runtime: { type: 'string' },
		contract: { type: 'string' },
		kind: { type: 'string' },
		out: { type: 'string' },
		scenario: { type: 'string', multiple: true },
		seed: { type: 'string' },
		chrome: { type: 'string' },
	},
});
const missing = ['draft', 'runtime', 'contract', 'kind', 'out'].filter((name) => !values[name]);
if (missing.length) {
	console.error(`missing --${missing.join(', --')}`);
	process.exit(2);
}
try {
	const report = await playDraft({
		draftDir: values.draft,
		runtimeDir: values.runtime,
		contract: values.contract,
		kind: values.kind,
		scenarios: values.scenario,
		out: values.out,
		seed: values.seed,
		chrome: headlessShell(values.chrome),
	});
	console.log(JSON.stringify(report, null, '\t'));
} catch (e) {
	console.error(`[draft-player] ${e.message}`);
	process.exit(2);
}
