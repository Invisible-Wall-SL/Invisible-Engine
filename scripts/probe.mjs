/**
 * Standalone EAGaming probe — pure Node ESM, no dependencies.
 *
 * Run from the repo root:
 *   node scripts/probe.mjs --sid=<SID> --cookie="<full Cookie header>"
 *
 * Optional flags:
 *   --base=https://eagaming.com    (default)
 *   --start-seq=0                  (default)
 *
 * Dumps every request + response to ./probe-output/<timestamp>/.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const [k, ...rest] = a.replace(/^--/, '').split('=');
		return [k, rest.join('=')];
	}),
);

const sid = args.sid;
const cookie = args.cookie;
const base = args.base ?? 'https://eagaming.com';
let seq = Number(args['start-seq'] ?? 0);

if (!sid) {
	console.error('Missing --sid. Grab it from a live Hot Fruits session in DevTools → Network → engine?sid=...');
	process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(process.cwd(), 'probe-output', stamp);
mkdirSync(outDir, { recursive: true });
console.log(`[probe] dumping to ${outDir}\n`);

const post = async (label, body) => {
	const url = `${base}/game/engine?sid=${encodeURIComponent(sid)}&seq=${seq++}`;
	const headers = { 'Content-Type': 'application/json' };
	if (cookie) headers.Cookie = cookie;

	console.log(`[probe] ${label}`);
	console.log(`        ${url}`);
	console.log(`        body: ${JSON.stringify(body)}`);

	let result;
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
		});
		const rawText = await res.text();
		let parsed = null;
		try {
			parsed = rawText ? JSON.parse(rawText) : null;
		} catch {}
		result = {
			status: res.status,
			statusText: res.statusText,
			url,
			requestBody: body,
			requestSeq: seq - 1,
			responseHeaders: Object.fromEntries(res.headers.entries()),
			rawText,
			response: parsed,
		};
		console.log(`        ${res.status} ${res.statusText}`);
		if (rawText.length < 400) console.log(`        ${rawText}`);
		else console.log(`        (response ${rawText.length} bytes — see file)`);
	} catch (err) {
		result = {
			error: String(err),
			url,
			requestBody: body,
			requestSeq: seq - 1,
		};
		console.log(`        FETCH ERROR: ${err}`);
	}

	const file = join(outDir, `${String(result.requestSeq).padStart(3, '0')}-${label}.json`);
	writeFileSync(file, JSON.stringify(result, null, 2));
	console.log(`        → ${file}\n`);
	return result;
};

const main = async () => {
	// 1. Empty body — see what the server says with no actions.
	await post('empty', []);

	// 2. The exact shape we observed in the screenshot.
	await post('bet-play-observed', [
		{ action: 'bet', context: [5, 2] },
		{ action: 'play', context: null },
	]);

	// 3. Vary the bet context.
	await post('bet-amount-10', [
		{ action: 'bet', context: [10, 1] },
		{ action: 'play', context: null },
	]);

	// 4. Single speculative actions to discover the vocabulary.
	for (const action of ['authenticate', 'state', 'balance', 'endRound', 'event', 'replay']) {
		await post(`single-${action}`, [{ action, context: null }]);
	}

	console.log('[probe] done.');
	console.log(`[probe] inspect ${outDir} for raw responses.`);
};

main().catch((err) => {
	console.error('[probe] fatal:', err);
	process.exit(1);
});
