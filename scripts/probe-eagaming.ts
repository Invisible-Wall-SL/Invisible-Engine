/**
 * EAGaming protocol probe.
 *
 * Run a sequence of POSTs against the EAGaming /game/engine endpoint and dump
 * every request + response to ./probe-output/<timestamp>/. We use this to
 * reverse-engineer:
 *   - the full set of supported actions
 *   - the response shape (balance / round / state / events)
 *   - error envelope format
 *
 * Usage:
 *   pnpm tsx scripts/probe-eagaming.ts \
 *     --sid=S170da901147 \
 *     --base=https://eagaming.com \
 *     --cookie="<paste cookie header>" \
 *     [--start-seq=0]
 *
 * The sid + cookie need to come from a live browser session. Open the Hot
 * Fruits game in your browser, copy the sid from a network request, and copy
 * the request cookie header verbatim. Don't commit captured payloads if they
 * contain personal session data.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	buildBetActions,
	buildSingleAction,
	createEAGamingFetcher,
	createEAGamingSessionState,
	translateBetResponse,
} from '../packages/rgs-translator-eagaming';

interface CliArgs {
	sid?: string;
	base?: string;
	cookie?: string;
	startSeq?: number;
}

const parseArgs = (argv: string[]): CliArgs => {
	const out: CliArgs = {};
	for (const a of argv.slice(2)) {
		const [k, ...rest] = a.replace(/^--/, '').split('=');
		const v = rest.join('=');
		if (k === 'sid') out.sid = v;
		else if (k === 'base') out.base = v;
		else if (k === 'cookie') out.cookie = v;
		else if (k === 'start-seq') out.startSeq = Number(v);
	}
	return out;
};

const main = async () => {
	const args = parseArgs(process.argv);
	if (!args.sid || !args.base) {
		console.error('Missing --sid or --base. See header comment for usage.');
		process.exit(1);
	}

	const session = createEAGamingSessionState(args.sid, args.startSeq ?? 0);
	const fetcher = createEAGamingFetcher({ baseUrl: args.base, sid: args.sid }, session);
	const headers = args.cookie ? { Cookie: args.cookie } : undefined;

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const outDir = join(process.cwd(), 'probe-output', stamp);
	mkdirSync(outDir, { recursive: true });
	console.log(`[probe] dumping to ${outDir}`);

	const log = (label: string, data: unknown) => {
		const file = join(outDir, `${label}.json`);
		writeFileSync(file, JSON.stringify(data, null, 2));
		console.log(`[probe] ${label} → ${file}`);
	};

	// 1. Naked GET-state probe: send an empty action array and see what comes back.
	const emptyProbe = await fetcher.post({ body: [], headers });
	log('01-empty', emptyProbe);

	// 2. The exact shape we observed in the screenshot.
	const observed = await fetcher.post({
		body: buildBetActions({ amount: 5, mode: 'BASE', currency: 'USD', contextExtras: [2] }),
		headers,
	});
	log('02-bet-play-observed', observed);
	if (observed.response) {
		log('02-bet-play-observed-translated', translateBetResponse(observed.response));
	}

	// 3. Vary the bet context to see what fields are validated.
	const altContext = await fetcher.post({
		body: buildBetActions({ amount: 10, mode: 'BASE', currency: 'USD', contextExtras: [1] }),
		headers,
	});
	log('03-alt-context', altContext);

	// 4. Fire each speculative action alone to discover the action vocabulary.
	for (const action of ['authenticate', 'endRound', 'event', 'replay', 'state', 'balance']) {
		const r = await fetcher.post({ body: buildSingleAction(action), headers });
		log(`04-action-${action}`, r);
	}

	console.log('[probe] done. Inspect the JSON dumps to refine types.ts and translator.ts.');
};

main().catch((err) => {
	console.error('[probe] fatal:', err);
	process.exit(1);
});
