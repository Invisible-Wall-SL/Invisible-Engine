/**
 * The shared save machine (`src/lib/saveState.svelte.ts`) never reports a doc as saved while the
 * store is behind what the author sees. The REAL class, compiled the way the app compiles it (the
 * Svelte client runtime, so `$state` and `$effect` behave), driven by a fake transport whose writes
 * resolve when the gate says so, and a fake clock for the autosave debounce:
 *
 *   1. an edit made while a write is in flight is written too, in the trailing (flow-v2) and the
 *      leading (Scene Editor) debounce, and the store ends up holding it;
 *   2. a caller that navigates once `save()` resolves TRUE never leaves with that edit unsaved;
 *   3. with no edit during the flight nothing changes: one write, clean, no extra write;
 *   4. conflict, scope-mismatch, error and the read-only gate keep their policies mid-flight;
 *   5. tools that push a `$derived` signature through `setDirty` read clean after a save that
 *      wrote what is on screen, and dirty after one that did not.
 *
 * Run:  pnpm --filter launcher-api check:save-state
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const svelteClient = new URL('../../index-client.js', internalClient).href;
const dir = mkdtempSync(join(tmpdir(), 'save-state-'));

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
}
/** A store with one doc, written only when the gate resolves a write `ok`. */
function fakeStore() {
	const store = { doc: 'v0', etag: 'e0' as string | null, writes: [] as Write[] };
	let n = 0;
	const write = (ctx: SaveContext, sent: string): Promise<SaveOutcome> =>
		new Promise((done) => {
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
	return { ...fake, tool, state, edit };
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
	const t = editTool(LEADING);
	t.edit('A');
	await advance(1200);
	t.edit('B');
	await t.store.writes[0].resolve(t.ok());
	check(
		'leading: B written right after A lands',
		t.store.writes.map((w) => w.sent),
		['A', 'B'],
	);
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
	await t.store.writes[1]?.resolve(t.ok());
	await advance(5000);
	check('leading undo: the undone doc is written', t.store.doc, 'undo');
	check('leading undo: clean, two writes', [t.state.dirty, t.store.writes.length], [false, 2]);
}
{
	// Edits that keep landing in every flight keep being written, each on the previous ETag.
	const t = editTool(LEADING);
	t.edit('A');
	await advance(1200);
	t.edit('B');
	await t.store.writes[0].resolve(t.ok());
	t.edit('C');
	await t.store.writes[1]?.resolve(t.ok());
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

// ---------- 2. a navigating caller ----------

for (const [mode, opts] of [
	['manual', {}],
	['leading', LEADING],
] as const) {
	const t = editTool(opts);
	let leftWith: string | null = null;
	t.edit('A');
	const hop = t.state.save().then((ok) => {
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
	const saved = t.state.save();
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
	const saved = t.state.save();
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
	const first = t.state.save();
	check('in flight: a second save() coalesces to false', await t.state.save(), false);
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
	check('conflict: unforced save() refused', await t.state.save(), false);
	const forced = t.state.save({ force: true });
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
	const first = t.state.save();
	t.edit('B');
	await t.store.writes[0].resolve({ ok: false, reason: 'scope-mismatch', message: 'other' });
	check('scope-mismatch: false', await first, false);
	check('scope-mismatch: terminal', [t.state.status, t.state.dirty], ['scope-mismatch', true]);
	check('scope-mismatch: even force refused', await t.state.save({ force: true }), false);
	await advance(5000);
	check('scope-mismatch: never retried', t.store.writes.length, 1);
}
{
	const t = editTool(TRAILING);
	t.edit('A');
	const first = t.state.save();
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
	const first = t.state.save();
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
	const first = t.state.save();
	t.edit('B');
	readOnly = true;
	await t.store.writes[0].resolve(t.ok());
	check('read-only mid-flight: no follow-up write', t.store.writes.length, 1);
	check('read-only mid-flight: false, still dirty', [await first, t.state.dirty], [false, true]);
	check('read-only mid-flight: A ETag adopted', t.state.etag, 'e1');
	await advance(5000);
	check('read-only: no autosave', t.store.writes.length, 1);
	check('read-only: save() refused', await t.state.save({ force: true }), false);
}

// ---------- 5. `setDirty` signature tools ----------

for (const adopt of ['sent', 'server'] as const) {
	const fake = fakeStore();
	const t = signatureTool((o) => new SaveState({ initialEtag: 'e0', ...o }), fake.write, adopt);
	check(`signature/${adopt}: clean at load`, t.state.dirty, false);
	t.edit('A');
	check(`signature/${adopt}: an edit reads dirty`, t.state.dirty, true);
	const saved = t.state.save();
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
	const saved = t.state.save();
	t.edit('B');
	await fake.store.writes[0].resolve(fake.ok());
	check('signature/sent mid-flight: store holds A', fake.store.doc, 'A');
	// Already dirty, the signature never re-crosses false→true, so the helper cannot see B and the
	// save resolves true; the pill is what reports it. No navigating caller saves this way.
	check('signature/sent mid-flight: save() resolves true', await saved, true);
	check('signature/sent mid-flight: B still reads dirty', [t.dirty, t.state.dirty], [true, true]);
}

console.log(`\n${checks - failures}/${checks} save-state checks passed.`);
if (failures > 0) process.exit(1);
