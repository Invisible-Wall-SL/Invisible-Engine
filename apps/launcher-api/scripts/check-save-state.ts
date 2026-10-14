/**
 * The shared save machine (`src/lib/saveState.svelte.ts`) never reports a doc as saved while the
 * store is behind what the author sees. The REAL class, compiled the way the app compiles it (the
 * Svelte client runtime, so `$state` and `$effect` behave), driven by a fake transport whose writes
 * resolve when the gate says so, and a fake clock for the autosave debounce:
 *
 *   1. an edit made while a write is in flight is written too, in the trailing (flow-v2) and the
 *      leading (Scene Editor) debounce, on that debounce's own cadence, exactly once, and the
 *      store ends up holding it;
 *   2. a caller that navigates once `save()` resolves TRUE never leaves with that edit unsaved;
 *   3. with no edit during the flight nothing changes: one write, clean, no extra write;
 *   4. conflict, scope-mismatch, error, the read-only gate and the `canAutosave` veto keep their
 *      policies mid-flight, and a write that lands after `adoptEtag` moved the target changes
 *      nothing of the new one;
 *   5. tools that push a `$derived` signature through `setDirty` read clean after a save that
 *      wrote what is on screen, and dirty after one that did not.
 *
 * Run:  pnpm --filter launcher-api check:save-state
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { pathToFileURL } from 'node:url';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import type {
	SaveContext,
	SaveOutcome,
	SaveState as SaveStateClass,
	SaveStateOptions,
} from '../src/lib/saveState.svelte.ts';

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
}

// ---------- the real module, client-compiled ----------

const internalClient = import.meta.resolve('svelte/internal/client');
// The app is bundled for the browser, so `svelte` must be its `browser` export (Node's own
// resolution picks the server build, whose effects never run).
const svelteManifest = import.meta.resolve('svelte/package.json');
const svelteExports = (
	JSON.parse(readFileSync(new URL(svelteManifest), 'utf8')) as {
		exports: { '.': { browser: string } };
	}
).exports['.'];
const svelteClient = new URL(svelteExports.browser, svelteManifest).href;
const dir = mkdtempSync(join(tmpdir(), 'save-state-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

async function compiled<T>(name: string, source: string, typescript: boolean): Promise<T> {
	const js = typescript
		? ts.transpileModule(source, {
				compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
			}).outputText
		: source;
	const out = compileModule(js, { filename: `${name}.svelte.js`, generate: 'client' }).js.code;
	const file = join(dir, `${name}.mjs`);
	writeFileSync(
		file,
		out
			.replaceAll(`'svelte/internal/client'`, `'${internalClient}'`)
			.replaceAll(`from 'svelte'`, `from '${svelteClient}'`),
	);
	return (await import(pathToFileURL(file).href)) as T;
}

const { SaveState } = await compiled<{ SaveState: typeof SaveStateClass }>(
	'saveState',
	readFileSync(new URL('../src/lib/saveState.svelte.ts', import.meta.url), 'utf8'),
	true,
);

// A tool whose dirty flag is a `$derived` signature compare, pushed in by an `$effect` exactly as
// the component defaults sidecar and the sound library do. `adopt` picks what the save baselines
// on: the payload it sent (defaults) or the doc the server hands back, replacing the page's (sound).
interface SignatureTool {
	state: SaveStateClass;
	edit: (value: string) => void;
	readonly doc: string;
	readonly dirty: boolean;
}
const { signatureTool } = await compiled<{
	signatureTool: (
		make: (opts: SaveStateOptions) => SaveStateClass,
		write: (ctx: SaveContext, sent: string) => Promise<SaveOutcome>,
		adopt: 'sent' | 'server',
	) => SignatureTool;
}>(
	'signatureTool',
	`
	import { flushSync } from 'svelte';
	export function signatureTool(make, write, adopt) {
		let doc = $state('v0');
		let baseline = $state('v0');
		const dirty = $derived(doc !== baseline);
		const state = make({
			save: async (ctx) => {
				const sent = doc;
				const out = await write(ctx, sent);
				if (out.ok) {
					if (adopt === 'server') doc = sent;
					baseline = sent;
				}
				return out;
			},
		});
		$effect.root(() => {
			$effect(() => {
				state.setDirty(dirty);
			});
		});
		flushSync();
		return {
			state,
			edit: (value) => {
				doc = value;
				flushSync();
			},
			get doc() {
				return doc;
			},
			get dirty() {
				return dirty;
			},
		};
	}`,
	false,
);
const { flushSync } = (await import(svelteClient)) as { flushSync: () => void };

// ---------- fake clock + transport ----------

// A save the gate awaits that never settles is a failure, not a hung run: bounded on the REAL
// clock (the fake one below only moves when the gate advances it).
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
function bounded<T>(promise: Promise<T>): Promise<T | 'hung'> {
	return new Promise((done) => {
		const timer = realSetTimeout(() => done('hung'), 2000);
		void promise.then((value) => {
			realClearTimeout(timer);
			done(value);
		});
	});
}

type Timer = { at: number; fn: () => void };
let now = 0;
let nextId = 1;
const timers = new Map<number, Timer>();
globalThis.setTimeout = ((fn: () => void, ms = 0) => {
	const id = nextId++;
	timers.set(id, { at: now + ms, fn });
	return id;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => {
	timers.delete(id);
}) as unknown as typeof clearTimeout;

const settle = async (): Promise<void> => {
	for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
	flushSync();
};
async function advance(ms: number): Promise<void> {
	const until = now + ms;
	for (;;) {
		const due = [...timers.entries()]
			.filter(([, t]) => t.at <= until)
			.sort((a, b) => a[1].at - b[1].at)[0];
		if (!due) break;
		now = due[1].at;
		timers.delete(due[0]);
		due[1].fn();
		await settle();
	}
	now = until;
	await settle();
}

interface Write {
	ctx: SaveContext;
	sent: string;
	resolve: (out: SaveOutcome) => Promise<void>;
	reject: (error: Error) => Promise<void>;
}
/** A store with one doc, written only when the gate resolves a write `ok`. */
function fakeStore() {
	const store = { doc: 'v0', etag: 'e0' as string | null, writes: [] as Write[] };
	let n = 0;
	const write = (ctx: SaveContext, sent: string): Promise<SaveOutcome> =>
		new Promise((done, fail) => {
			store.writes.push({
				ctx: { ...ctx },
				sent,
				resolve: async (out) => {
					if (out.ok) {
						store.doc = sent;
						store.etag = out.etag;
					}
					done(out);
					await settle();
				},
				reject: async (error) => {
					fail(error);
					await settle();
				},
			});
		});
	const ok = (): SaveOutcome => ({ ok: true, etag: `e${++n}` });
	return { store, write, ok };
}

/** An edit-driven tool (flow-v2, the Scene Editor): every gesture mutates `doc` + `markDirty()`. */
function editTool(opts: Partial<SaveStateOptions> = {}) {
	const fake = fakeStore();
	const tool = { doc: 'v0' };
	const state = new SaveState({
		initialEtag: 'e0',
		save: (ctx) => fake.write(ctx, tool.doc),
		...opts,
	});
	const edit = (value: string): void => {
		tool.doc = value;
		state.markDirty();
	};
	const save = (o?: { force?: boolean }) => bounded(state.save(o));
	return { ...fake, tool, state, edit, save };
}

const TRAILING = { autosaveMs: 800 };
const LEADING = { autosaveMs: 1200, resetDebounceOnEveryEdit: false };

// ---------- 1. an edit during the flight is written ----------

{
	// flow-v2: B's debounce fires while A is in flight and coalesces.
	const t = editTool(TRAILING);
	t.edit('A');
	await advance(800);
	check(
		'trailing: A is in flight',
		t.store.writes.map((w) => w.sent),
		['A'],
	);
	t.edit('B');
	await advance(800);
	check('trailing: B coalesced, not a second concurrent write', t.store.writes.length, 1);
	await t.store.writes[0].resolve(t.ok());
	check(
		'trailing: B written right after A lands',
		t.store.writes.map((w) => w.sent),
		['A', 'B'],
	);
	check('trailing: still dirty while B is unwritten', t.state.dirty, true);
	check('trailing: B CASes on the ETag A got', t.store.writes[1]?.ctx.baseEtag, 'e1');
	await t.store.writes[1]?.resolve(t.ok());
	check('trailing: the store holds B', t.store.doc, 'B');
	check('trailing: clean once B is written', [t.state.dirty, t.state.status], [false, 'saved']);
	await advance(5000);
	check('trailing: no further write', t.store.writes.length, 2);
}
{
	// flow-v2: B lands mid-flight but its debounce has not fired when A lands. The debounce keeps
	// its cadence (no write at network speed mid-gesture) and writes B when it fires.
	const t = editTool(TRAILING);
	t.edit('A');
	await advance(800);
	t.edit('B');
	await advance(100);
	await t.store.writes[0].resolve(t.ok());
	check(
		'trailing, debounce pending: dirty, no write yet',
		[t.state.dirty, t.store.writes.length],
		[true, 1],
	);
	await advance(700);
	await t.store.writes[1]?.resolve(t.ok());
	await advance(5000);
	check(
		'trailing, debounce pending: B written once',
		t.store.writes.map((w) => w.sent),
		['A', 'B'],
	);
	check('trailing, debounce pending: store + state', [t.store.doc, t.state.dirty], ['B', false]);
}
{
	// Scene Editor: a mid-flight edit arms no timer (already dirty), and success cancels autosave.
	// The edit is written one leading batch after the autosave lands, not at network speed.
	const t = editTool(LEADING);
	t.edit('A');
	await advance(1200);
	t.edit('B');
	await t.store.writes[0].resolve(t.ok());
	check('leading: dirty, B not written yet', [t.state.dirty, t.store.writes.length], [true, 1]);
	await advance(1199);
	check('leading: still batching', t.store.writes.length, 1);
	await advance(1);
	check('leading: B written one batch later', t.store.writes[1]?.sent, 'B');
	check('leading: on the ETag A got', t.store.writes[1]?.ctx.baseEtag, 'e1');
	await t.store.writes[1]?.resolve(t.ok());
	await advance(5000);
	check('leading: the store holds B', t.store.doc, 'B');
	check('leading: clean, two writes', [t.state.dirty, t.store.writes.length], [false, 2]);
}
{
	// Scene Editor undo/redo: `setDirty(true)` + `rearmAutosave()` while a write is in flight.
	const t = editTool(LEADING);
	t.edit('A');
	await advance(1200);
	t.tool.doc = 'undo';
	t.state.setDirty(true);
	t.state.rearmAutosave();
	await t.store.writes[0].resolve(t.ok());
	await advance(1200);
	await t.store.writes[1]?.resolve(t.ok());
	await advance(5000);
	check('leading undo: the undone doc is written', t.store.doc, 'undo');
	check('leading undo: clean, two writes', [t.state.dirty, t.store.writes.length], [false, 2]);
}
{
	// Continuous editing under the leading batch: one write per batch, each on the previous ETag.
	const t = editTool(LEADING);
	t.edit('A');
	await advance(1200);
	t.edit('B');
	await t.store.writes[0].resolve(t.ok());
	await advance(1200);
	t.edit('C');
	await t.store.writes[1]?.resolve(t.ok());
	await advance(1200);
	await t.store.writes[2]?.resolve(t.ok());
	await advance(5000);
	check(
		'chain: every edit written in order',
		t.store.writes.map((w) => w.sent),
		['A', 'B', 'C'],
	);
	check(
		'chain: ETags chain',
		t.store.writes.map((w) => w.ctx.baseEtag),
		['e0', 'e1', 'e2'],
	);
	check('chain: clean', [t.store.doc, t.state.dirty], ['C', false]);
}
{
	// flow-v2, a write slower than the debounce: B's debounce coalesces mid-flight, C re-arms it.
	// The armed debounce writes C; the coalesced re-fire must not write it a second time.
	const t = editTool(TRAILING);
	t.edit('A');
	await advance(800);
	t.edit('B');
	await advance(800);
	t.edit('C');
	await t.store.writes[0].resolve(t.ok());
	// A duplicate re-fire would be in flight now; land it before the debounce fires.
	await t.store.writes[1]?.resolve(t.ok());
	await advance(800);
	for (const w of t.store.writes.slice(1)) await w.resolve(t.ok());
	await advance(5000);
	check(
		'coalesce + re-armed debounce: C written once',
		t.store.writes.map((w) => w.sent),
		['A', 'C'],
	);
	check('coalesce + re-armed debounce: clean', [t.store.doc, t.state.dirty], ['C', false]);
}
{
	// Scene Editor, a write slower than the batch: an undo mid-flight re-arms a timer that fires
	// and coalesces. Its re-fire is an autosave, so later typing keeps the 1200 ms batch instead of
	// chaining writes at network speed.
	const t = editTool(LEADING);
	t.edit('A');
	await advance(1200);
	t.tool.doc = 'undo';
	t.state.setDirty(true);
	t.state.rearmAutosave();
	await advance(1200);
	await t.store.writes[0].resolve(t.ok());
	check('cadence after coalesce: the undo re-fires', t.store.writes[1]?.sent, 'undo');
	t.edit('D');
	await t.store.writes[1]?.resolve(t.ok());
	check('cadence after coalesce: D waits for the batch', t.store.writes.length, 2);
	await advance(1200);
	check('cadence after coalesce: D one batch later', t.store.writes[2]?.sent, 'D');
	await t.store.writes[2]?.resolve(t.ok());
	check('cadence after coalesce: clean', [t.store.doc, t.state.dirty], ['D', false]);
}

// ---------- 2. a navigating caller ----------

for (const [mode, opts] of [
	['manual', {}],
	['leading', LEADING],
] as const) {
	const t = editTool(opts);
	let leftWith: string | null = null;
	t.edit('A');
	const hop = t.save().then((ok) => {
		if (ok) leftWith = t.store.doc;
	});
	t.edit('B');
	await t.store.writes[0].resolve(t.ok());
	check(`${mode} hop: has not left while B is unwritten`, leftWith, null);
	await t.store.writes[1]?.resolve(t.ok());
	await hop;
	check(`${mode} hop: leaves with B in the store`, leftWith, 'B');
}
{
	// The write of the mid-flight edit loses a CAS: the caller must not leave.
	const t = editTool();
	t.edit('A');
	const saved = t.save();
	t.edit('B');
	await t.store.writes[0].resolve(t.ok());
	await t.store.writes[1]?.resolve({ ok: false, reason: 'conflict', message: 'theirs' });
	check('hop, follow-up conflict: save() is false', await saved, false);
	check(
		'hop, follow-up conflict: conflict, dirty, A ETag kept',
		[t.state.status, t.state.dirty, t.state.etag, t.state.message],
		['conflict', true, 'e1', 'theirs'],
	);
}

// ---------- 3. no edit during the flight ----------

for (const [mode, opts] of [
	['manual', {}],
	['trailing', TRAILING],
	['leading', LEADING],
] as const) {
	const t = editTool(opts);
	t.edit('A');
	const saved = t.save();
	check(`${mode} plain: busy while in flight`, t.state.busy, true);
	await t.store.writes[0].resolve(t.ok());
	check(`${mode} plain: save() is true`, await saved, true);
	check(
		`${mode} plain: clean + saved + ETag adopted`,
		[t.state.dirty, t.state.status, t.state.etag],
		[false, 'saved', 'e1'],
	);
	await advance(5000);
	// Trailing keeps the pre-existing debounce A armed (flow-v2 never cancelled on success).
	const expected = mode === 'trailing' ? 2 : 1;
	check(`${mode} plain: writes`, t.store.writes.length, expected);
}

// ---------- 4. policies during the flight ----------

{
	const t = editTool(LEADING);
	t.edit('A');
	const first = t.save();
	check('in flight: a second save() coalesces to false', await t.save(), false);
	await t.store.writes[0].resolve({ ok: false, reason: 'conflict', message: 'theirs' });
	check('conflict: save() false', await first, false);
	check(
		'conflict: sticky, dirty, message',
		[t.state.status, t.state.dirty, t.state.message, t.state.blocked],
		['conflict', true, 'theirs', true],
	);
	t.edit('B');
	await advance(5000);
	check('conflict: no autosave, no retry', t.store.writes.length, 1);
	check('conflict: unforced save() refused', await t.save(), false);
	const forced = t.save({ force: true });
	check('conflict: force writes', t.store.writes[1]?.ctx.force, true);
	t.edit('C');
	await t.store.writes[1]?.resolve(t.ok());
	check('force + mid-flight edit: follow-up is a plain CAS', t.store.writes[2]?.ctx, {
		baseEtag: 'e1',
		force: false,
	});
	await t.store.writes[2]?.resolve(t.ok());
	check('force + mid-flight edit: true, store holds C', [await forced, t.store.doc], [true, 'C']);
}
{
	const t = editTool(TRAILING);
	t.edit('A');
	const first = t.save();
	t.edit('B');
	await t.store.writes[0].resolve({ ok: false, reason: 'scope-mismatch', message: 'other' });
	check('scope-mismatch: false', await first, false);
	check('scope-mismatch: terminal', [t.state.status, t.state.dirty], ['scope-mismatch', true]);
	check('scope-mismatch: even force refused', await t.save({ force: true }), false);
	await advance(5000);
	check('scope-mismatch: never retried', t.store.writes.length, 1);
}
{
	const t = editTool(TRAILING);
	t.edit('A');
	const first = t.save();
	t.edit('B');
	await t.store.writes[0].resolve({ ok: false, reason: 'error', message: 'boom' });
	check(
		'error: false, message',
		[await first, t.state.status, t.state.message],
		[false, 'error', 'boom'],
	);
	check('error: dirty, ETag unchanged', [t.state.dirty, t.state.etag], [true, 'e0']);
	await advance(800);
	check('error: the armed debounce retries with B', t.store.writes[1]?.sent, 'B');
	await t.store.writes[1]?.resolve(t.ok());
	check('error: then clean', [t.store.doc, t.state.dirty], ['B', false]);
}
{
	const t = editTool(LEADING);
	t.edit('A');
	const first = t.save();
	t.edit('B');
	await t.store.writes[0].resolve(t.ok());
	check('error in follow-up: B attempted', t.store.writes[1]?.sent, 'B');
	await t.store.writes[1]?.resolve({ ok: false, reason: 'error', message: 'boom' });
	check('error in follow-up: false, dirty', [await first, t.state.dirty], [false, true]);
	check('error in follow-up: status', t.state.status, 'error');
}
{
	let readOnly = false;
	const t = editTool({ ...TRAILING, blockWhen: () => readOnly });
	t.edit('A');
	const first = t.save();
	t.edit('B');
	readOnly = true;
	await t.store.writes[0].resolve(t.ok());
	check('read-only mid-flight: no follow-up write', t.store.writes.length, 1);
	check('read-only mid-flight: false, still dirty', [await first, t.state.dirty], [false, true]);
	check('read-only mid-flight: A ETag adopted', t.state.etag, 'e1');
	await advance(5000);
	check('read-only: no autosave', t.store.writes.length, 1);
	check('read-only: save() refused', await t.save({ force: true }), false);
}

{
	// The editor's `canAutosave` veto (a cross-type layout): an explicit save writes what it sent,
	// but the edit made during its flight is not auto-written behind the veto.
	let canAutosave = true;
	const t = editTool({ ...LEADING, canAutosave: () => canAutosave });
	t.edit('A');
	const saved = t.save();
	t.edit('B');
	canAutosave = false;
	await t.store.writes[0].resolve(t.ok());
	await advance(5000);
	check('canAutosave veto: no follow-up write', t.store.writes.length, 1);
	check('canAutosave veto: false, still dirty', [await saved, t.state.dirty], [false, true]);
	check(
		'canAutosave veto: an explicit save still writes',
		await (async () => {
			const again = t.save();
			await t.store.writes[1]?.resolve(t.ok());
			return [await again, t.store.doc];
		})(),
		[true, 'B'],
	);
}
{
	// The target moves mid-flight (open another component / template): the old write's outcome
	// touches nothing of the new target — no ETag, no status, no follow-up write.
	for (const outcome of ['ok', 'conflict'] as const) {
		const t = editTool();
		t.edit('X');
		const saved = t.save();
		t.state.adoptEtag('y0');
		t.edit('Y');
		await t.store.writes[0].resolve(
			outcome === 'ok' ? t.ok() : { ok: false, reason: 'conflict', message: 'theirs' },
		);
		await advance(5000);
		check(`adoptEtag mid-flight (${outcome}): only X written`, t.store.writes.length, 1);
		check(
			`adoptEtag mid-flight (${outcome}): new target untouched`,
			[await saved, t.state.etag, t.state.status, t.state.dirty],
			[false, 'y0', 'idle', true],
		);
		const next = t.save();
		await t.store.writes[1]?.resolve(t.ok());
		check(`adoptEtag mid-flight (${outcome}): Y saves on its own ETag`, t.store.writes[1]?.ctx, {
			baseEtag: 'y0',
			force: false,
		});
		check(
			`adoptEtag mid-flight (${outcome}): then clean`,
			[await next, t.state.dirty],
			[true, false],
		);
	}
}
{
	// A transport that THROWS for the old target after the switch (a rejected fetch) must not put
	// its error on the new target, nor drop the new target's own in-flight save out of `busy`.
	const t = editTool();
	t.edit('X');
	const x = t.save();
	t.state.adoptEtag('y0');
	t.edit('Y');
	const y = t.save();
	check('throw after adoptEtag: Y writes on its ETag', t.store.writes[1]?.ctx.baseEtag, 'y0');
	await t.store.writes[0].reject(new Error('Failed to fetch'));
	check('throw after adoptEtag: X false', await x, false);
	check(
		'throw after adoptEtag: Y still saving, no error',
		[t.state.status, t.state.busy, t.state.message],
		['saving', true, ''],
	);
	check('throw after adoptEtag: a save now coalesces', await t.save(), false);
	check('throw after adoptEtag: no extra write', t.store.writes.length, 2);
	await t.store.writes[1]?.resolve(t.ok());
	await advance(5000);
	check(
		'throw after adoptEtag: Y saved',
		[await y, t.store.doc, t.state.dirty],
		[true, 'Y', false],
	);
}
{
	// A tool that says "clean" mid-flight (`setDirty(false)`, e.g. its doc was replaced) is believed.
	const t = editTool();
	t.edit('A');
	const saved = t.save();
	t.state.setDirty(true);
	t.state.setDirty(false);
	await t.store.writes[0].resolve(t.ok());
	await advance(5000);
	check(
		'setDirty(false) mid-flight: clean, one write',
		[await saved, t.state.dirty],
		[true, false],
	);
	check('setDirty(false) mid-flight: writes', t.store.writes.length, 1);
}

// ---------- 5. `setDirty` signature tools ----------

for (const adopt of ['sent', 'server'] as const) {
	const fake = fakeStore();
	const t = signatureTool((o) => new SaveState({ initialEtag: 'e0', ...o }), fake.write, adopt);
	check(`signature/${adopt}: clean at load`, t.state.dirty, false);
	t.edit('A');
	check(`signature/${adopt}: an edit reads dirty`, t.state.dirty, true);
	const saved = bounded(t.state.save());
	await fake.store.writes[0].resolve(fake.ok());
	check(`signature/${adopt}: plain save is clean`, [await saved, t.state.dirty], [true, false]);
	check(`signature/${adopt}: one write`, fake.store.writes.length, 1);
	t.edit('B');
	check(`signature/${adopt}: next edit reads dirty again`, t.state.dirty, true);
}
{
	// The component defaults sidecar baselines on the payload it sent, so an edit made during the
	// flight is still unsaved afterwards and its pill must say so.
	const fake = fakeStore();
	const t = signatureTool((o) => new SaveState({ initialEtag: 'e0', ...o }), fake.write, 'sent');
	t.edit('A');
	const saved = bounded(t.state.save());
	t.edit('B');
	await fake.store.writes[0].resolve(fake.ok());
	check('signature/sent mid-flight: store holds A', fake.store.doc, 'A');
	// Already dirty, the signature never re-crosses false→true, so the helper cannot see B and the
	// save resolves true; the pill is what reports it. No navigating caller saves this way.
	check('signature/sent mid-flight: save() resolves true', await saved, true);
	check('signature/sent mid-flight: B still reads dirty', [t.dirty, t.state.dirty], [true, true]);
}

console.log(`\n${checks - failures}/${checks} save-state checks passed.`);
// A case whose write was never resolved leaves nothing to keep the process alive; exit with
// the verdict rather than waiting on it.
process.exit(failures > 0 ? 1 : 0);
