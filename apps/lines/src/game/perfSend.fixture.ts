/**
 * Offline fixture for the `?perf=1` probe's Send (`perfSendCore.ts`). Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/perfSend.fixture.ts
 *
 * Pins, against a recorded fake `fetch`:
 *   1. a reading under the inline limit is one POST to `/api/profiler/reports` with the token header;
 *   2. a larger one is presign → PUT → register, and the PUT carries no token;
 *   3. when that upload cannot go — R2 answering the PUT with an error, or the browser blocking it
 *      (a rejected fetch, as a CORS refusal is) — the trimmed fallback is posted inline and the
 *      outcome says `trimmed`;
 *   4. with no fallback, or one still too large, the failure is returned, never thrown;
 *   5. a failure says why: no answer names the launcher host, a refusal keeps the launcher's own
 *      message, a bare status says what it means.
 */

import { INLINE_MAX_BYTES, perfSenderTo } from './perfSendCore';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ok    ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}: got ${a}, expected ${e}`);
	}
};

interface Call {
	url: string;
	method: string;
	token: string | null;
	bytes: number;
}

function fakeFetch(put: 'ok' | 'status' | 'reject') {
	const calls: Call[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const headers = new Headers(init?.headers);
		calls.push({
			url,
			method: init?.method ?? 'GET',
			token: headers.get('X-IW-Perf-Session'),
			bytes: typeof init?.body === 'string' ? new Blob([init.body]).size : 0,
		});
		if (url.endsWith('/api/profiler/uploads')) {
			return Response.json({
				id: 'u-1',
				url: 'https://r2.example/staged',
				contentType: 'application/json',
			});
		}
		if (url.startsWith('https://r2.example/')) {
			if (put === 'reject') throw new TypeError('Failed to fetch');
			return new Response(null, { status: put === 'ok' ? 200 : 403 });
		}
		return Response.json({ id: 'r-1' }, { status: 201 });
	}) as typeof fetch;
	return { fn, calls };
}

const big = 'x'.repeat(INLINE_MAX_BYTES + 1);
const short = '{"perf":7,"trimmed":true}';
const route = (c: Call) => `${c.method} ${c.url.replace('https://app.example', '')}`;

async function main(): Promise<void> {
	console.log('1. inline');
	{
		const f = fakeFetch('ok');
		const out = await perfSenderTo('https://app.example/', 'TOK', f.fn).send('{"perf":7}');
		check('sent', out, { ok: true });
		check('one POST to reports', f.calls.map(route), ['POST /api/profiler/reports']);
		check('with the token', f.calls[0]?.token, 'TOK');
	}

	console.log('2. presign, PUT, register');
	{
		const f = fakeFetch('ok');
		const out = await perfSenderTo('https://app.example', 'TOK', f.fn).send(big, {
			fallback: short,
		});
		check('sent in full', out, { ok: true });
		check('three steps', f.calls.map(route), [
			'POST /api/profiler/uploads',
			'PUT https://r2.example/staged',
			'POST /api/profiler/reports',
		]);
		check('the PUT carries no token', f.calls[1]?.token, null);
	}

	console.log('3. the upload cannot go: the trimmed reading is kept');
	for (const put of ['status', 'reject'] as const) {
		const f = fakeFetch(put);
		const out = await perfSenderTo('https://app.example', 'TOK', f.fn).send(big, {
			fallback: short,
		});
		check(`${put}: sent, trimmed`, out, { ok: true, trimmed: true });
		const last = f.calls.at(-1);
		check(`${put}: the fallback posted inline`, last && [route(last), last.bytes], [
			'POST /api/profiler/reports',
			new Blob([short]).size,
		]);
	}

	console.log('4. nothing to fall back to');
	{
		const f = fakeFetch('reject');
		const out = await perfSenderTo('https://app.example', 'TOK', f.fn).send(big);
		check('no fallback: the failure', out, {
			ok: false,
			error: 'the storage upload was blocked (Failed to fetch)',
		});
		const g = fakeFetch('status');
		const tooBig = await perfSenderTo('https://app.example', 'TOK', g.fn).send(big, {
			fallback: big,
		});
		check('a fallback still too large: the failure', tooBig, {
			ok: false,
			error: 'the storage upload answered HTTP 403',
		});
	}

	console.log('5. a failure says why');
	{
		const offline = (async () => {
			throw new TypeError('Load failed');
		}) as typeof fetch;
		check(
			'no answer: the launcher could not be reached',
			await perfSenderTo('https://app.example/', 'TOK', offline).send('{}'),
			{
				ok: false,
				error:
					'could not reach app.example (Load failed) — check the phone is online and its network allows app.example',
			},
		);
		const answer = (res: () => Response) => (async () => res()) as typeof fetch;
		check(
			"the launcher's own reason",
			await perfSenderTo(
				'https://app.example',
				'TOK',
				answer(() => Response.json({ message: 'This capture link has expired.' }, { status: 401 })),
			).send('{}'),
			{ ok: false, error: 'This capture link has expired.' },
		);
		check(
			'a bare 502',
			await perfSenderTo(
				'https://app.example',
				'TOK',
				answer(() => new Response('<html>', { status: 502 })),
			).send('{}'),
			{
				ok: false,
				error:
					'the launcher answered HTTP 502 — the launcher is restarting or down; tap Send again in a minute',
			},
		);
	}
}

void main().then(() => {
	if (failures) throw new Error(`perfSend.fixture: ${failures} check(s) failed`);
	console.log('\nall perfSend checks passed');
});
