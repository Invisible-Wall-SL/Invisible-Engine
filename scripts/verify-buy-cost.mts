/**
 * Offline fixture for the per-mode buy-cost fix.
 *
 * Proves the two halves of the charge chain, end to end, against the REAL book mock
 * (`scripts/mock-rgs-server-book.mjs` — Book of Borut's live RGS) and the REAL facade
 * (`packages/rgs-translator-eagaming/src/stakeFacade.ts`):
 *
 *   Part 1 (mock):   a `bet` wire context [cost, betPerLine] debits betPerLine × NUM_LINES × cost,
 *                    so each buy cost multiplier (25 / 50 / 100) charges its own price — not a fixed 100.
 *   Part 2 (facade): requestBet for each bet mode emits context[0] = that mode's cost multiplier
 *                    (from the `__IE_BET_MODES__` bridge the engine publishes), 0 for a normal spin.
 *
 * Run: pnpm --filter … exec tsx scripts/verify-buy-cost.mts   (or: node_modules/.bin/tsx scripts/verify-buy-cost.mts)
 */

import { createServer, type Server } from 'node:http';

import { createMockRgs } from './mock-rgs-server-book.mjs';
import {
	requestAuthenticate,
	requestBet,
} from '../packages/rgs-translator-eagaming/src/stakeFacade';

const NUM_LINES = 10;
const BET_PER_LINE = 10; // cents, = the facade's round(betAmount×100 / BOOK_NUM_LINES) for a $1 bet

let failures = 0;
const assert = (label: string, got: unknown, want: unknown) => {
	const ok = got === want;
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${got} want=${want}`);
};

const startMock = (): Promise<{ server: Server; rgsUrl: string }> => {
	// A large balance so a 100× buy never trips insufficient-balance; a fixed seed for determinism.
	const mock = createMockRgs({
		label: 'buycost-fixture',
		seed: 'buycost',
		startBalance: 1_000_000_000,
	});
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	return new Promise((resolve) => {
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ server, rgsUrl: `localhost:${port}` });
		});
	});
};

const postEngine = async (rgsUrl: string, sid: string, seq: number, body: unknown) => {
	const res = await fetch(`http://${rgsUrl}/rgs/engine?sid=${sid}&seq=${seq}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	return res.json() as Promise<{ events: { event: string; context: { total?: number } }[] }>;
};

const main = async () => {
	const { server, rgsUrl } = await startMock();

	// ---- Part 1: the MOCK charges betPerLine × NUM_LINES × cost, per wire cost multiplier ----
	// cost 0 = normal spin (charged 1×); 25/50/100 = the three buy tiers.
	const wireCases: { cost: number; expectedTotal: number }[] = [
		{ cost: 0, expectedTotal: BET_PER_LINE * NUM_LINES * 1 }, // 100  (normal spin)
		{ cost: 25, expectedTotal: BET_PER_LINE * NUM_LINES * 25 }, // 2500 ($25 buy)
		{ cost: 50, expectedTotal: BET_PER_LINE * NUM_LINES * 50 }, // 5000 ($50 buy)
		{ cost: 100, expectedTotal: BET_PER_LINE * NUM_LINES * 100 }, // 10000 ($100 buy)
	];
	for (const { cost, expectedTotal } of wireCases) {
		const sid = `wire-${cost}`;
		const resp = await postEngine(rgsUrl, sid, 0, [
			{ action: 'bet', context: [cost, BET_PER_LINE] },
		]);
		const betEvent = resp.events.find((e) => e.event === 'bet');
		assert(`mock charge cost=${cost}`, betEvent?.context.total, expectedTotal);
	}

	// ---- Part 2: the FACADE emits context[0] = the selected mode's cost multiplier ----
	// Publish the per-mode costs exactly as the engine's syncBetModeMeta does.
	(globalThis as { __IE_BET_MODES__?: Record<string, number> }).__IE_BET_MODES__ = {
		BASE: 1,
		HIGHNOON: 25,
		BULLCHASE: 50,
		GOLDRUSH: 100,
	};

	// Wrap global fetch to capture each outgoing /rgs/engine body (the facade uses the global fetch).
	const realFetch = globalThis.fetch;
	const outgoing: { action: string; context: unknown }[][] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (init?.body && String(input).includes('/rgs/engine')) {
			try {
				outgoing.push(JSON.parse(String(init.body)));
			} catch {
				/* ignore non-JSON bodies */
			}
		}
		return realFetch(input, init);
	}) as typeof fetch;

	const modeCases: { mode: string; expectedCtx0: number }[] = [
		{ mode: 'BASE', expectedCtx0: 0 }, // normal spin
		{ mode: 'HIGHNOON', expectedCtx0: 25 },
		{ mode: 'BULLCHASE', expectedCtx0: 50 },
		{ mode: 'GOLDRUSH', expectedCtx0: 100 },
	];
	for (const { mode, expectedCtx0 } of modeCases) {
		const sid = `facade-${mode}`;
		// Authenticate first so the facade captures the mock's config event and selects the book mapping.
		await requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
		outgoing.length = 0;
		await requestBet({ sessionID: sid, currency: 'USD', amount: 1, mode, rgsUrl });
		const betAction = outgoing.flat().find((a) => a.action === 'bet');
		const ctx0 = Array.isArray(betAction?.context) ? (betAction.context as number[])[0] : undefined;
		assert(`facade emits cost for ${mode}`, ctx0, expectedCtx0);
	}

	globalThis.fetch = realFetch;
	server.close();
	console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
	process.exit(failures === 0 ? 0 : 1);
};

void main();
