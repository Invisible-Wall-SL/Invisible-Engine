/**
 * Contract check for the Director live event stream (ADR-0003 "Live UI"; PLAN 3.8):
 *   pnpm --filter launcher-api check:director-events
 *
 * Runs the REAL `eventStream.ts` over an in-memory event table that plays the part of
 * `director_events` + its NOTIFY trigger, and the REAL route `GET /director/[runId]/events` with
 * the Postgres-backed modules replaced (the store, projects, overrides, the listener).
 *
 * Pinned:
 *  - frames: `id:` is the row id, `event:` its kind, `data:` the row as JSON; the heartbeat is a
 *    comment and arrives on the interval;
 *  - a client opening with `Last-Event-ID` gets every later row first, then live inserts;
 *  - a reconnect loses nothing: rows inserted while disconnected arrive on the next open, and a
 *    row that COMMITTED with a lower id than one already sent is delivered once and only once;
 *  - a NOTIFY that never arrives is caught by the heartbeat re-read;
 *  - closing the request ends the stream and its subscription;
 *  - the route: 401 without a session, 403 without the tool, 404 for an unknown run, 403 for a user
 *    outside the run's project, 200 `text/event-stream` for the owner of a run whose project does
 *    not exist yet and for a user with the project; `Last-Event-ID` and `?after=` are honoured.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isHttpError } from '@sveltejs/kit';
import type { DirectorRun } from '../src/lib/server/db/schema.ts';
import type { EventSource, StreamedEvent } from '../src/lib/server/director/eventStream.ts';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
const srcPath = (rel: string) => fileURLToPath(src(rel));

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}
function exportNames(rel: string): string[] {
	const text = readFileSync(srcPath(rel), 'utf8');
	const names = new Set<string>();
	for (const m of text.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		names.add(m[1]);
	}
	return [...names];
}
function fake(rel: string, impl: Record<string, unknown>): void {
	const namedExports: Record<string, unknown> = {};
	for (const name of exportNames(rel)) {
		namedExports[name] =
			name in impl
				? impl[name]
				: () => {
						throw new Error(`fixture: ${rel} ${name} is not faked`);
					};
	}
	for (const name of Object.keys(impl)) {
		if (!(name in namedExports)) throw new Error(`fixture: ${rel} has no export ${name}`);
	}
	mock.module(src(rel), { namedExports });
}

// ── An in-memory director_events with its trigger ─────────────────────────────
class Table implements EventSource {
	rows: StreamedEvent[] = [];
	private handlers = new Map<string, Set<(id: number) => void>>();
	subscribers = 0;
	private nextId = 1;

	/** Insert and NOTIFY, like the trigger. `silent` loses the NOTIFY; `holdId` takes an id now and
	 *  commits later (a slow transaction), returning the commit. */
	insert(runId: string, kind: string, opts: { silent?: boolean } = {}): StreamedEvent {
		const row = this.row(runId, kind, this.nextId++);
		this.rows.push(row);
		if (!opts.silent) this.notify(runId, row.id);
		return row;
	}
	reserve(runId: string, kind: string): () => StreamedEvent {
		const row = this.row(runId, kind, this.nextId++);
		return () => {
			this.rows.push(row);
			this.notify(runId, row.id);
			return row;
		};
	}
	notify(runId: string, id: number) {
		for (const h of this.handlers.get(runId) ?? []) h(id);
	}
	private row(runId: string, kind: string, id: number): StreamedEvent {
		return {
			id,
			runId,
			at: new Date(2026, 9, 5, 0, 0, id),
			agent: 'worker',
			kind,
			tool: null,
			payloadJson: { n: id },
		};
	}
	async after(runId: string, afterId: number, limit: number) {
		return this.rows
			.filter((r) => r.runId === runId && r.id > afterId)
			.sort((a, b) => a.id - b.id)
			.slice(0, limit);
	}
	async one(runId: string, id: number) {
		return this.rows.find((r) => r.runId === runId && r.id === id) ?? null;
	}
	subscribe(runId: string, onInsert: (id: number) => void) {
		let set = this.handlers.get(runId);
		if (!set) this.handlers.set(runId, (set = new Set()));
		set.add(onInsert);
		this.subscribers++;
		return () => {
			set!.delete(onInsert);
			this.subscribers--;
		};
	}
}
const table = new Table();
fake('lib/server/director/eventListener.ts', { dbEventSource: table });

// ── The Postgres-backed modules the route reads ───────────────────────────────
const RUNS = new Map<string, DirectorRun>();
const run = (id: string, over: Partial<DirectorRun>): DirectorRun => ({
	id,
	projectKey: 'sunken-temple',
	clientKey: 'acme',
	templateProjectKey: 'hw',
	ownerUserId: 'owner',
	presetJson: {},
	startingPointJson: {},
	checkpointsJson: {},
	status: 'running',
	step: 'breakdown',
	waitingOn: null,
	budgetCapUsd: null,
	leaseHolder: null,
	leaseUntil: null,
	projectCreateStartedAt: null,
	templateConfigEtag: null,
	projectConfigEtag: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	...over,
});
RUNS.set('run-1', run('run-1', {}));
RUNS.set('run-draft', run('run-draft', { projectKey: 'not-yet', status: 'draft' }));
const PROJECTS = new Map<string, string | null>([
	['cloud', null],
	['sunken-temple', 'acme'],
]);
const GRANTS = new Map<string, Set<string>>([['art', new Set(['acme'])]]);
fake('lib/server/director/store.ts', { getRun: async (id: string) => RUNS.get(id) ?? null });
fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	canAccessProject: async (userId: string, role: string, key: string) => {
		if (!PROJECTS.has(key)) return false;
		if (role === 'admin') return true;
		const client = PROJECTS.get(key);
		return client !== null && (GRANTS.get(userId)?.has(client!) ?? false);
	},
	projectClientKey: async (key: string) => PROJECTS.get(key) ?? null,
	projectExists: async (key: string) => PROJECTS.has(key),
});
fake('lib/server/roleToolAccess.ts', { getRoleOverrides: async () => ({}) });
fake('lib/server/userToolAccess.ts', { getToolOverrides: async () => ({}) });
fake('lib/server/auth.ts', { SESSION_COOKIE: 'iw_session' });

const stream = await import(src('lib/server/director/eventStream.ts'));
const route = await import(src('routes/(app)/director/[runId]/events/+server.ts'));

// ── Reading frames ────────────────────────────────────────────────────────────
interface Frame {
	id: number | null;
	event: string | null;
	data: { id: number; kind: string } | null;
	comment: string | null;
}
function parseFrames(text: string): Frame[] {
	return text
		.split('\n\n')
		.filter((block) => block.trim())
		.map((block) => {
			const frame: Frame = { id: null, event: null, data: null, comment: null };
			for (const line of block.split('\n')) {
				if (line.startsWith(':')) frame.comment = line.slice(1).trim();
				else if (line.startsWith('id: ')) frame.id = Number(line.slice(4));
				else if (line.startsWith('event: ')) frame.event = line.slice(7);
				else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
			}
			return frame;
		});
}
/** Open a stream, collect everything it sends until `signal` aborts, as frames. */
function collect(body: ReadableStream<Uint8Array>) {
	const chunks: string[] = [];
	const decoder = new TextDecoder();
	const reader = body.getReader();
	const done = (async () => {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) return;
			chunks.push(decoder.decode(value, { stream: true }));
		}
	})();
	return {
		frames: () => parseFrames(chunks.join('')),
		done,
	};
}
const ids = (frames: Frame[]) => frames.filter((f) => f.data).map((f) => f.data!.id);
const tick = () => sleep(15);

console.log('framing');
{
	check('Last-Event-ID wins over ?after=', stream.parseLastEventId('12', '7'), 12);
	check('?after= is the fallback', stream.parseLastEventId(null, '7'), 7);
	check('garbage is 0', stream.parseLastEventId('abc', '-1'), 0);
	check('absent is 0', stream.parseLastEventId(null, null), 0);
	const frame = stream.frameEvent({
		id: 5,
		runId: 'r',
		at: new Date('2026-10-05T10:00:00Z'),
		agent: 'qa',
		kind: 'activity',
		tool: 'x.y',
		payloadJson: { a: 1 },
	});
	check(
		'a frame is id, event, data',
		frame,
		'id: 5\nevent: activity\ndata: {"id":5,"at":"2026-10-05T10:00:00.000Z","agent":"qa","kind":"activity","tool":"x.y","payload":{"a":1}}\n\n',
	);
	check('the heartbeat is a comment', stream.HEARTBEAT_FRAME.startsWith(':'), true);
	check('the heartbeat interval is 15 s', stream.HEARTBEAT_MS, 15_000);
	check(
		'the listener parses <runId>:<id>, with a colon in the run id',
		stream.parsePayload('run:a:42'),
		{ runId: 'run:a', id: 42 },
	);
	check('…and refuses a payload without an id', stream.parsePayload('run-1'), null);
}

console.log('catch-up and tail');
{
	for (let i = 0; i < 5; i++) table.insert('run-1', 'activity');
	table.insert('run-2', 'activity'); // another run's row, id 6
	const ctl = new AbortController();
	const body = stream.openEventStream({
		runId: 'run-1',
		afterId: 2,
		source: table,
		heartbeatMs: 10_000,
		signal: ctl.signal,
	});
	const out = collect(body);
	await tick();
	check(
		'opening after id 2 sends 3, 4, 5, the look-back rows before them, and nothing of another run',
		ids(out.frames()),
		[1, 2, 3, 4, 5],
	);
	check('each frame names its kind', out.frames()[0].event, 'activity');
	const live = table.insert('run-1', 'checkpoint_open');
	await tick();
	check('a live insert arrives', ids(out.frames()).at(-1), live.id);
	check('…under its kind', out.frames().at(-1)!.event, 'checkpoint_open');
	check('one subscription is open', table.subscribers, 1);
	ctl.abort();
	await out.done;
	check('closing the request ends the stream', true, true);
	check('…and its subscription', table.subscribers, 0);
}

console.log('reconnect');
let lastSeen = 0;
let everDelivered: number[] = [];
{
	// Connect, see the late commit, disconnect; then reconnect with the browser's Last-Event-ID.
	const ctl = new AbortController();
	const out = collect(
		stream.openEventStream({
			runId: 'run-1',
			afterId: 7,
			source: table,
			heartbeatMs: 10_000,
			signal: ctl.signal,
		}),
	);
	await tick();
	const slow = table.reserve('run-1', 'activity'); // takes id 8, commits later
	const fast = table.insert('run-1', 'activity'); // id 9, commits first
	await tick();
	check(
		'the faster insert is sent first (after the look-back rows)',
		ids(out.frames()).at(-1),
		fast.id,
	);
	const late = slow();
	await tick();
	check('a row that commits with a lower id is still delivered', ids(out.frames()).slice(-2), [
		fast.id,
		late.id,
	]);
	table.notify('run-1', late.id);
	await tick();
	check('…once, if its NOTIFY repeats', ids(out.frames()).filter((id) => id === late.id).length, 1);
	lastSeen = ids(out.frames()).at(-1)!; // what the browser now holds: 8
	everDelivered = ids(out.frames());
	ctl.abort();
	await out.done;

	const missed = [table.insert('run-1', 'activity'), table.insert('run-1', 'spend')]; // 10, 11
	const ctl2 = new AbortController();
	const out2 = collect(
		stream.openEventStream({
			runId: 'run-1',
			afterId: lastSeen,
			source: table,
			heartbeatMs: 10_000,
			signal: ctl2.signal,
		}),
	);
	await tick();
	const got = ids(out2.frames());
	check(
		'a reconnect with Last-Event-ID sends what was missed',
		got.slice(-2),
		missed.map((m) => m.id),
	);
	const all = new Set([...everDelivered, ...got]);
	check(
		'…and nothing of the run is lost across the reconnect',
		table.rows.filter((r) => r.runId === 'run-1' && r.id > 7).every((r) => all.has(r.id)),
		true,
	);
	check(
		'a repeat after the late commit is possible (the page keys by id)',
		got.includes(fast.id),
		true,
	);
	ctl2.abort();
	await out2.done;
}

console.log('late commit while away');
{
	const ctl = new AbortController();
	const out = collect(
		stream.openEventStream({
			runId: 'run-1',
			afterId: 11,
			source: table,
			heartbeatMs: 10_000,
			signal: ctl.signal,
		}),
	);
	await tick();
	const slow = table.reserve('run-1', 'activity'); // id 12, commits after the client is gone
	const fast = table.insert('run-1', 'activity'); // id 13
	await tick();
	check('the client last saw the faster row', ids(out.frames()).at(-1), fast.id);
	ctl.abort();
	await out.done;
	const late = slow(); // commits while nobody is connected: its NOTIFY reaches no stream
	const ctl2 = new AbortController();
	const out2 = collect(
		stream.openEventStream({
			runId: 'run-1',
			afterId: fast.id,
			source: table,
			heartbeatMs: 10_000,
			signal: ctl2.signal,
		}),
	);
	await tick();
	check(
		'a reconnect still delivers a row that committed below Last-Event-ID while the client was away',
		ids(out2.frames()).includes(late.id),
		true,
	);
	check('…within the look-back window', stream.LOOKBACK >= fast.id - late.id, true);
	ctl2.abort();
	await out2.done;
}

console.log('heartbeat');
{
	const ctl = new AbortController();
	const out = collect(
		stream.openEventStream({
			runId: 'run-1',
			afterId: 13,
			source: table,
			heartbeatMs: 20,
			signal: ctl.signal,
		}),
	);
	await tick();
	const silent = table.insert('run-1', 'activity', { silent: true }); // its NOTIFY is lost
	await sleep(70);
	const frames = out.frames();
	check(
		'heartbeats arrive on the interval',
		frames.filter((f) => f.comment === 'heartbeat').length >= 2,
		true,
	);
	check(
		'a row whose NOTIFY was lost is caught by the heartbeat re-read',
		ids(frames).at(-1),
		silent.id,
	);
	check(
		'…once, although every heartbeat re-reads the look-back window',
		ids(frames).filter((id) => id === silent.id).length,
		1,
	);
	ctl.abort();
	await out.done;
}

console.log('route');
{
	const admin = { id: 'adm', email: 'a@x', name: 'Admin', role: 'admin' as const };
	const artist = { id: 'art', email: 'r@x', name: 'Art', role: 'artist' as const };
	const owner = { id: 'owner', email: 'o@x', name: 'Owner', role: 'admin' as const };
	const dev = { id: 'dev', email: 'd@x', name: 'Dev', role: 'developer' as const };
	const call = async (
		runId: string,
		user: App.Locals['user'],
		headers: Record<string, string> = {},
		query = '',
	) => {
		const ctl = new AbortController();
		const url = new URL(`http://x/director/${runId}/events${query}`);
		const request = new Request(url, { headers, signal: ctl.signal });
		try {
			const res = (await route.GET({
				params: { runId },
				request,
				url,
				locals: { user },
				cookies: { get: () => undefined },
			} as never)) as Response;
			const out = collect(res.body!);
			await tick();
			ctl.abort();
			await out.done;
			return { status: res.status, type: res.headers.get('content-type'), ids: ids(out.frames()) };
		} catch (e) {
			return { status: isHttpError(e) ? e.status : e, type: null, ids: [] };
		}
	};
	check('no session is 401', (await call('run-1', null)).status, 401);
	check('no director tool is 403', (await call('run-1', dev)).status, 403);
	check('an unknown run is 404', (await call('run-x', admin)).status, 404);
	// `artist` has the tool only through an override in production; here the role default decides.
	check(
		'a role without the tool is 403 even with the project',
		(await call('run-1', artist)).status,
		403,
	);
	const stranger = { ...owner, id: 'someone' };
	check(
		'the owner of a run whose project does not exist yet may listen',
		(await call('run-draft', owner)).status,
		200,
	);
	check(
		'…but nobody else',
		(await call('run-draft', { ...stranger, role: 'developer' as const })).status,
		403,
	);
	const ok = await call('run-1', admin, { 'last-event-id': '10' });
	check(
		'a user with the project gets the stream',
		[ok.status, ok.type],
		[200, 'text/event-stream; charset=utf-8'],
	);
	const runRows = (after: number) =>
		table.rows.filter((r) => r.runId === 'run-1' && r.id > after).map((r) => r.id);
	check(
		'…from Last-Event-ID (every later row, plus the look-back window)',
		[
			runRows(10).every((id) => ok.ids.includes(id)),
			ok.ids.every((id) => id > 10 - stream.LOOKBACK),
		],
		[true, true],
	);
	const viaQuery = (await call('run-1', admin, {}, '?after=11')).ids;
	check(
		'…or from ?after=',
		[
			runRows(11).every((id) => viaQuery.includes(id)),
			viaQuery.every((id) => id > 11 - stream.LOOKBACK),
		],
		[true, true],
	);
	check('every stream closed with its request', table.subscribers, 0);
}

console.log(`director-events: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
