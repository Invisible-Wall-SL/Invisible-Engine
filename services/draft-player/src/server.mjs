// The draft-player service (ADR-0010 §2–§3): a private Node service that plays a QA draft in the
// headless shell and reports back. It holds NO R2 or database credential: the launcher sends
// presigned URLs for everything it reads and writes, and a callback URL with a token.
//
//   POST /play      signed (X-Draft-Signature, signing.mjs). Answers 202 { jobRef, status } and queues the
//                   play; plays run one at a time. A jobRef already known answers 202 with its status.
//   GET  /progress?jobRef=   signed. { jobRef, status: queued|running|finished|failed|unknown, report?, error? }
//   POST /cancel    signed. { jobRef } -> { jobRef, status }. A running play stops between scenarios.
//   GET  /health    open. { ok, busy, queued }
//
// /play body (JSON, every URL presigned, https only):
//   { jobRef: "dp_<16 hex>", kind, contract, scenarios?: [id], seed?,
//     draft:   { files: [{ path, url }] }          the draft folder: runtime.json, draft.json, deploy/**
//     runtime: { version, commit?, files: [{ path, url }] }   `_runtime/lines@<version>`, cached by version
//     put:     { report: url, shots: [{ scenario, screen, key, url }] }   presigned PUTs, <= 40 shots
//     callback: { url, token } }
// The callback is `POST <url>` with `Authorization: Bearer <token>`, X-Draft-Signature, and
// { jobRef, status: 'finished'|'failed', report?, error? }; `report.scenarios[].shots` maps a screen
// to the `key` of the shot that was uploaded. A play that cannot reach the callback keeps its result
// for /progress, which is the launcher's fallback watch.
//
// Env: DRAFT_PLAYER_SECRET (required), PORT (Railway sets it). Nothing else.

import { createServer } from 'node:http';
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { findHeadlessShell } from '../../../scripts/playtest/headless-shell.mjs';
import { redactText } from '../../../scripts/current-games/lib/redact.mjs';
import { playDraft } from './playDraft.mjs';
import { SIGNATURE_HEADER, signRequest, verifyRequest } from './signing.mjs';

const MAX_BODY = 4 * 1024 * 1024;
const MAX_FILES = 6000;
const MAX_SHOTS = 40;
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;
const DOWNLOADS_AT_ONCE = 8;
const KEEP_JOB_MS = 60 * 60 * 1000;
const CALLBACK_TRIES = [0, 2_000, 8_000];
const JOB_REF = /^dp_[0-9a-f]{16}$/;
const DONE_MARK = '.draft-player-complete';

class Refused extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

const json = (res, status, value) => {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(value));
};

/** A path inside a folder: relative, no `..`, no empty parts. */
const safeRel = (rel) => {
	if (
		typeof rel !== 'string' ||
		!rel ||
		isAbsolute(rel) ||
		rel.includes('\0') ||
		rel.includes('\\')
	)
		return null;
	const n = normalize(rel);
	return n.startsWith('..') || n.split(sep).includes('..') ? null : n;
};

export function createDraftPlayer({
	secret,
	workDir = join(tmpdir(), 'draft-player'),
	play = playDraft,
	chrome = findHeadlessShell(),
	fetchImpl = fetch,
	allowHttp = false,
	now = Date.now,
}) {
	if (!secret) throw new Error('DRAFT_PLAYER_SECRET is not set');
	mkdirSync(workDir, { recursive: true });
	/** jobRef -> { status, queuedAt, ..., report?, error?, abort } */
	const jobs = new Map();
	const queue = [];
	let running = null;

	const urlOk = (raw) => {
		let u;
		try {
			u = new URL(raw);
		} catch {
			return false;
		}
		if (allowHttp) return u.protocol === 'http:' || u.protocol === 'https:';
		// Presigned storage URLs only: this service sits on a private network.
		return (
			u.protocol === 'https:' &&
			!u.username &&
			!u.password &&
			!/^(localhost|\[.*\])$/i.test(u.hostname) &&
			!/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) &&
			!/\.(internal|local|railway\.internal)$/i.test(u.hostname)
		);
	};

	function validate(body) {
		const bad = (why) => new Refused(why);
		if (!body || typeof body !== 'object') throw bad('body is not an object');
		if (!JOB_REF.test(body.jobRef ?? '')) throw bad('jobRef must be dp_<16 hex>');
		if (!/^[A-Za-z0-9]{1,32}$/.test(body.kind ?? '')) throw bad('kind is missing');
		if (!body.contract || typeof body.contract !== 'object') throw bad('contract is missing');
		if (
			body.scenarios !== undefined &&
			!(Array.isArray(body.scenarios) && body.scenarios.every((s) => typeof s === 'string'))
		)
			throw bad('scenarios must be a list of ids');
		const files = (list, label) => {
			if (!Array.isArray(list) || !list.length || list.length > MAX_FILES)
				throw bad(`${label}.files is missing or too long`);
			const seen = new Set();
			for (const f of list) {
				const rel = safeRel(f?.path);
				if (!rel || seen.has(rel)) throw bad(`${label}.files has an unsafe or repeated path`);
				if (!urlOk(f.url))
					throw bad(`${label}.files has a url that is not presigned https storage`);
				seen.add(rel);
			}
			return seen;
		};
		const draftPaths = files(body.draft?.files, 'draft');
		if (!draftPaths.has('runtime.json') || !draftPaths.has('draft.json'))
			throw bad('draft.files needs runtime.json and draft.json');
		files(body.runtime?.files, 'runtime');
		if (!/^[\w.@-]{1,64}$/.test(body.runtime?.version ?? ''))
			throw bad('runtime.version is missing');
		if (!urlOk(body.put?.report)) throw bad('put.report is not a presigned url');
		const shots = body.put?.shots ?? [];
		if (!Array.isArray(shots) || shots.length > MAX_SHOTS)
			throw bad(`put.shots is at most ${MAX_SHOTS}`);
		for (const s of shots)
			if (!s?.scenario || !s?.screen || !s?.key || !urlOk(s.url))
				throw bad('put.shots has a malformed entry');
		if (!urlOk(body.callback?.url) || !body.callback?.token)
			throw bad('callback.url and callback.token are required');
	}

	async function download(file, dest, budget) {
		const res = await fetchImpl(file.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok || !res.body) throw new Error(`GET ${file.path}: HTTP ${res.status}`);
		const length = Number(res.headers.get('content-length') ?? 0);
		if (length > MAX_FILE_BYTES)
			throw new Error(`${file.path} is larger than ${MAX_FILE_BYTES} bytes`);
		mkdirSync(dirname(dest), { recursive: true });
		let size = 0;
		const body = Readable.fromWeb(res.body);
		body.on('data', (chunk) => {
			size += chunk.length;
			budget.used += chunk.length;
			if (size > MAX_FILE_BYTES || budget.used > MAX_TOTAL_BYTES)
				body.destroy(new Error('download too large'));
		});
		await pipeline(body, createWriteStream(dest));
	}

	async function downloadAll(files, root, budget) {
		let next = 0;
		const lane = async () => {
			while (next < files.length) {
				const f = files[next++];
				await download(f, join(root, safeRel(f.path)), budget);
			}
		};
		await Promise.all(Array.from({ length: Math.min(DOWNLOADS_AT_ONCE, files.length) }, lane));
	}

	/** The runtime build for `runtime`, from the cache or downloaded (the newest two are kept). */
	async function runtimeFor(runtime, budget) {
		const name = `${runtime.version}-${runtime.commit ?? 'x'}`.replace(/[^\w.@-]/g, '_');
		const root = join(workDir, 'runtimes');
		const dir = join(root, name);
		if (existsSync(join(dir, DONE_MARK))) return dir;
		const partial = `${dir}.part-${process.pid}-${now()}`;
		rmSync(partial, { recursive: true, force: true });
		await downloadAll(runtime.files, partial, budget);
		writeFileSync(join(partial, DONE_MARK), String(now()));
		rmSync(dir, { recursive: true, force: true });
		renameSync(partial, dir);
		const others = readdirSync(root)
			.filter((n) => n !== name && !n.includes('.part-') && existsSync(join(root, n, DONE_MARK)))
			.map((n) => ({ n, t: Number(readFileSync(join(root, n, DONE_MARK), 'utf8') || 0) }))
			.sort((a, b) => b.t - a.t)
			.slice(1);
		for (const o of others) rmSync(join(root, o.n), { recursive: true, force: true });
		return dir;
	}

	async function put(url, body, type) {
		const res = await fetchImpl(url, {
			method: 'PUT',
			headers: { 'Content-Type': type },
			body,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) throw new Error(`PUT: HTTP ${res.status}`);
	}

	async function postCallback(job) {
		const cb = job.request.callback;
		const target = (() => {
			const u = new URL(cb.url);
			return u.pathname + u.search;
		})();
		const body = JSON.stringify({
			jobRef: job.jobRef,
			status: job.status,
			...(job.report ? { report: job.report } : {}),
			...(job.error ? { error: job.error } : {}),
		});
		for (const wait of CALLBACK_TRIES) {
			if (wait) await new Promise((r) => setTimeout(r, wait));
			try {
				const res = await fetchImpl(cb.url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${cb.token}`,
						'X-Draft-Signature': signRequest(secret, 'POST', target, body),
					},
					body,
					signal: AbortSignal.timeout(30_000),
				});
				// A refusal (4xx) will not change on a resend; only a server fault or a lost answer is retried.
				if (res.ok || (res.status >= 400 && res.status < 500)) return res.ok;
			} catch {
				/* resent */
			}
		}
		return false;
	}

	async function runJob(job) {
		const { request } = job;
		const dir = mkdtempSync(join(workDir, `${job.jobRef}-`));
		job.status = 'running';
		job.startedAt = now();
		try {
			if (!chrome) throw new Error('no headless shell is installed in this image');
			const budget = { used: 0 };
			const draftDir = join(dir, 'draft');
			await downloadAll(request.draft.files, draftDir, budget);
			const runtimeDir = await runtimeFor(request.runtime, budget);
			const report = await play({
				draftDir,
				runtimeDir,
				contract: request.contract,
				kind: request.kind,
				scenarios: request.scenarios,
				seed: request.seed,
				chrome,
				out: join(dir, 'out'),
				signal: job.abort.signal,
			});
			if (job.abort.signal.aborted) {
				job.status = 'failed';
				job.error = 'cancelled';
				return;
			}
			const slots = new Map(request.put.shots.map((s) => [`${s.scenario}/${s.screen}`, s]));
			const uploadErrors = [];
			for (const sc of report.scenarios) {
				const kept = {};
				for (const [screen, file] of Object.entries(sc.shots)) {
					const slot = slots.get(`${sc.id}/${screen}`);
					if (!slot) continue;
					try {
						await put(slot.url, readFileSync(join(dir, 'out', file)), 'image/png');
						kept[screen] = slot.key;
					} catch (e) {
						uploadErrors.push(`${sc.id}/${screen}: ${redactText(e.message)}`);
					}
				}
				sc.shots = kept;
			}
			if (uploadErrors.length) report.uploadErrors = uploadErrors.slice(0, 10);
			try {
				await put(request.put.report, JSON.stringify(report), 'application/json');
			} catch (e) {
				report.uploadErrors = [...(report.uploadErrors ?? []), `report: ${redactText(e.message)}`];
			}
			job.report = report;
			job.status = 'finished';
		} catch (e) {
			job.status = 'failed';
			job.error = redactText(e.message).slice(0, 500);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	async function drain() {
		if (running) return;
		while (queue.length) {
			const job = queue.shift();
			if (job.status !== 'queued') continue;
			running = job;
			await runJob(job);
			job.doneAt = now();
			job.called = await postCallback(job);
			running = null;
			for (const [ref, j] of jobs) if (j.doneAt && now() - j.doneAt > KEEP_JOB_MS) jobs.delete(ref);
		}
	}

	const view = (job) =>
		job
			? {
					jobRef: job.jobRef,
					status: job.status,
					...(job.status === 'finished' ? { report: job.report } : {}),
					...(job.status === 'failed' ? { error: job.error } : {}),
				}
			: null;

	async function readBody(req) {
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > MAX_BODY) throw new Refused('body too large', 413);
			chunks.push(chunk);
		}
		return Buffer.concat(chunks).toString('utf8');
	}

	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url, 'http://x');
			if (req.method === 'GET' && url.pathname === '/health')
				return json(res, 200, { ok: true, busy: Boolean(running), queued: queue.length });
			const known = ['/play', '/cancel', '/progress'];
			if (!known.includes(url.pathname)) return json(res, 404, { error: 'not found' });
			if (req.method !== (url.pathname === '/progress' ? 'GET' : 'POST'))
				return json(res, 405, { error: 'method not allowed' });
			const raw = await readBody(req);
			if (!verifyRequest(secret, req.method, req.url, raw, req.headers[SIGNATURE_HEADER], now()))
				return json(res, 401, { error: 'bad signature' });
			if (url.pathname === '/progress') {
				const view1 = view(jobs.get(url.searchParams.get('jobRef') ?? ''));
				return json(
					res,
					200,
					view1 ?? { jobRef: url.searchParams.get('jobRef'), status: 'unknown' },
				);
			}
			let body;
			try {
				body = JSON.parse(raw);
			} catch {
				throw new Refused('body is not JSON');
			}
			if (url.pathname === '/cancel') {
				const job = jobs.get(body?.jobRef);
				if (!job) return json(res, 200, { jobRef: body?.jobRef ?? null, status: 'unknown' });
				if (job.status === 'queued') {
					job.status = 'failed';
					job.error = 'cancelled';
					job.doneAt = now();
				} else if (job.status === 'running') job.abort.abort();
				return json(res, 200, view(job));
			}
			validate(body);
			const existing = jobs.get(body.jobRef);
			if (existing) return json(res, 202, { jobRef: existing.jobRef, status: existing.status });
			const job = {
				jobRef: body.jobRef,
				status: 'queued',
				queuedAt: now(),
				request: body,
				abort: new AbortController(),
			};
			jobs.set(job.jobRef, job);
			queue.push(job);
			json(res, 202, { jobRef: job.jobRef, status: job.status });
			drain();
		} catch (e) {
			json(res, e.status ?? 500, { error: e.status ? e.message : 'internal error' });
		}
	});

	return {
		server,
		jobs,
		listen: (port, host = '0.0.0.0') =>
			new Promise((ok) => server.listen(port, host, () => ok(server.address().port))),
		close: () =>
			new Promise((ok) => {
				server.close(ok);
				server.closeAllConnections();
			}),
		idle: async () => {
			while (running || queue.length) await new Promise((r) => setTimeout(r, 25));
		},
	};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const secret = process.env.DRAFT_PLAYER_SECRET;
	if (!secret) {
		console.error('[draft-player] DRAFT_PLAYER_SECRET is not set');
		process.exit(1);
	}
	const chrome = findHeadlessShell();
	if (!chrome) {
		console.error('[draft-player] no headless shell found (PLAYWRIGHT_BROWSERS_PATH)');
		process.exit(1);
	}
	const player = createDraftPlayer({ secret, chrome });
	const port = await player.listen(Number(process.env.PORT) || 8080);
	console.log(`[draft-player] listening on :${port}, headless shell ${chrome}`);
}
