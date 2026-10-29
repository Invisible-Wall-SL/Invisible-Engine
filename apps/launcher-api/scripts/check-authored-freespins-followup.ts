/**
 * The authored free-spin intro / outro's pre-unlock fixes (Rive plan Phase 8c follow-up,
 * `docs/design/rive-style-editor.md` §13.7.9):
 *   pnpm --filter launcher-api check:authored-freespins-followup
 *
 * Runs the real engine-layout modules and the real launcher stores over an in-memory R2. Pins:
 *  1. teardown: the registries hand back an unregister that removes only their own entry, and the
 *     game tears the whole path down with itself (emitter subscription, pending frames, signals,
 *     the count source, the board box, the retire);
 *  2. the show timelines end: one intro and one idle cycle, looped from the intro's end by
 *     `loopFrom` — frame for frame what the hour-long timeline drew, and still moving past an hour;
 *  3. the swap carries every base-node field but `bind`, and that list cannot drift from the type;
 *  4. the chips read the doc the game boots: one shared resolution, called by both;
 *  5. the lock is lifted (owner browser check, 2026-10-17): no write path refuses switching a pilot
 *     on, and the scaffold seeds no settings.
 */
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';
import type { CinematicDoc, LayoutDoc, LayoutNode } from 'engine-layout';

type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`conflict ${key}`);
	}
}
const put = (key: string, body: string) => R2.set(key, { body, etag: `"e${++etagSeq}"` });
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();

const srcUrl = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(srcUrl('lib/server/r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (base: string | null | undefined) =>
			base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
		objectExists: async (key: string) => R2.has(key),
		headObject: async (key: string) => (R2.has(key) ? { etag: R2.get(key)!.etag } : null),
		getObjectText: async (key: string) => R2.get(key)?.body ?? null,
		getObjectTextWithEtag: async (key: string) => {
			const o = R2.get(key);
			return o ? { text: o.body, etag: o.etag } : null;
		},
		putObjectText: async (
			key: string,
			text: string,
			_type: string,
			cond?: { ifMatch?: string; ifNoneMatch?: string },
		) => {
			const cur = R2.get(key);
			if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
			if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
			put(key, text);
			return R2.get(key)!.etag;
		},
		copyObject: async (from: string, to: string) => {
			const o = R2.get(from);
			if (!o) return false;
			put(to, o.body);
			return true;
		},
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		deleteObject: async (key: string) => void R2.delete(key),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
		listObjects: async () => ({ keys: [], prefixes: [] }),
		getObjectBytes: async () => null,
		putObjectBytes: async () => {
			throw new Error('unexpected putObjectBytes');
		},
		getObjectStream: async () => null,
		presignGet: async () => '',
		presignPut: async () => '',
		presignManifestEntries: async <T>(entries: T) => entries,
		jsonBaseEtag: () => undefined,
		formBaseEtag: () => undefined,
		listFolder: async () => ({ folders: [], files: [] }),
	},
});

const A = await import('../../../packages/engine-layout/src/lib/authoredOverlays.ts');
const B = await import('../../../packages/engine-layout/src/lib/builtinTimelines.ts');
const C = await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const T = await import('../../../packages/engine-layout/src/lib/types.ts');
const R = await import('../../../packages/engine-layout/src/lib/referenceLayouts/index.ts');
const S = await import('../../../packages/engine-layout/src/lib/registerComponentSignals.ts');
const V = await import('../../../packages/engine-layout/src/lib/registerComponentValues.ts');
const BB = await import('../../../packages/engine-layout/src/lib/boardBox.ts');
const G = await import('../src/lib/server/authoredOverlayGuard.ts');
const E = await import('../src/lib/server/editorStorage.ts');
const W = await import('../src/lib/server/authoredWinTiers.ts');
const P = await import('../src/lib/server/projectPaths.ts');
const Sc = await import('../src/lib/server/projectScaffold.ts');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
}
async function rejects(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
		return 'resolved';
	} catch (e) {
		return `other:${e}`;
	}
}
const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

const REFERENCE: LayoutDoc[] = [
	R.defaultLayout('lines'),
	R.defaultLayout('ways'),
	R.bookofReferenceLayout(),
	R.clusterReferenceLayout(),
	R.scatterReferenceLayout(),
	R.holdAndWinReferenceLayout(),
];
const lines = REFERENCE[0];
const withRows = (doc: LayoutDoc, rows: Record<string, boolean>): LayoutDoc => ({
	...doc,
	settings: { ...doc.settings, authoredOverlays: rows },
});

// ---- 1. teardown ---------------------------------------------------------------------------------

{
	const a = { subscribe: () => () => undefined };
	const b = { subscribe: () => () => undefined };
	const offA = S.registerComponentSignals({ fsFollowupProbe: a });
	offA();
	const afterOwn = S.isRegisteredComponentSignal('fsFollowupProbe');
	S.registerComponentSignals({ fsFollowupProbe: a });
	const offA2 = S.registerComponentSignals({ fsFollowupProbe: a });
	S.registerComponentSignals({ fsFollowupProbe: b });
	offA2();
	eq(
		'a signal unregister removes its own entry, never one registered over it',
		[afterOwn, S.getComponentSignal('fsFollowupProbe') === b],
		[false, true],
	);
	const va = { subscribe: () => () => undefined };
	const offV = V.registerComponentValues({ fsFollowupValue: va });
	const before = V.getComponentValueSource('fsFollowupValue') === va;
	offV();
	eq(
		'a value unregister removes its own entry',
		[before, V.getComponentValueSource('fsFollowupValue')],
		[true, undefined],
	);
	const offBox = BB.registerBoardBox(() => ({ width: 1, height: 1 }));
	offBox();
	eq('the board box unregisters', BB.boardBox(), undefined);

	const fs = src('../../lines/src/game/authoredFreeSpins.svelte.ts');
	const start = fs.slice(fs.indexOf('export function startAuthoredFreeSpins('));
	const teardown = start.slice(start.indexOf('return () => {'));
	eq(
		'the path’s teardown undoes every subscription and registration it made',
		[
			'unsubscribeCount();',
			'unregisterSignals();',
			'unregisterValues();',
			'unregisterBoard();',
			"retireCodedOverlay('freeSpins', false);",
		].map((line) => teardown.includes(line)),
		[true, true, true, true, true],
	);
	eq(
		'a signal’s unsubscribe cancels the frame it requested and has not run',
		[
			/return \(\) => \{\s*unsubscribe\(\);\s*frames\.cancel\(\);\s*\};/.test(fs),
			/cancelAnimationFrame\(id\)/.test(fs),
		],
		[true, true],
	);
	const game = src('../../lines/src/components/Game.svelte');
	eq(
		'the game runs the teardown on destroy, and at once when it was destroyed before the doc loaded',
		[
			/onDestroy\(\(\) => \{[^}]*stopAuthoredFreeSpins\?\.\(\);/.test(game),
			/if \(destroyed\) stop\(\);\s*else stopAuthoredFreeSpins = stop;/.test(game),
		],
		[true, true],
	);
}

// ---- 2. the show timelines end --------------------------------------------------------------------

{
	const docs = B.FREE_SPIN_TIMELINES;
	const shows = docs.filter((d) => /_show(_big|_small)?$/.test(d.id));
	eq(
		'every show timeline is one intro and one idle cycle, looped from the intro’s end',
		shows.map((d) => [
			d.id,
			Math.round(d.duration * 60),
			Math.round((d.loopFrom ?? -1) * 60),
			d.holdsCue === true,
		]),
		shows.map((d) => [d.id, 41 + 168, 41, false]),
	);
	eq(
		'no free-spin timeline runs longer than ten seconds',
		docs.filter((d) => d.duration > 10).map((d) => d.id),
		[],
	);
	// The hour-long timeline #1231 shipped, rebuilt from today's: the idle strip filled to 3600 s.
	const hour = (doc: CinematicDoc): CinematicDoc => ({
		...doc,
		loopFrom: undefined,
		duration: 3600,
		tracks: doc.tracks.map((t) =>
			t.kind !== 'animation'
				? t
				: {
						...t,
						strips: (t.strips as { id: string; start: number; length: number }[]).map((s) =>
							s.id === 'idle' ? { ...s, length: 3600 - s.start } : s,
						),
					},
		),
	});
	const def = C.freeSpinPresentationDefs({ symbolSize: 120, boardColumns: 5, lang: 'en' }).intro;
	const show = shows.find((d) => d.id === 'c_freespinintropresentation_show')!;
	const now = new L.ComponentTimelinePlayer([show], def.root.children);
	const old = new L.ComponentTimelinePlayer([hour(show)], def.root.children);
	now.trigger(show.playOn!);
	old.trigger(show.playOn!);
	const nodes = [...now.drivenNodes().keys()];
	// One phase per lap: at the seam one side may sample the idle at 2.8 s and the other at 0 s —
	// the same instant, split by float accumulation (the parity run is what judges the pixels).
	const IDLE = B.FREE_SPIN_IDLE_CLIP_SECONDS;
	const round = (v: unknown): unknown =>
		JSON.parse(
			JSON.stringify(v ?? null, (k, x) => {
				if (typeof x !== 'number') return x;
				if (k !== 'time') return +x.toFixed(6);
				const phase = x % IDLE;
				return IDLE - phase < 1e-6 ? 0 : +phase.toFixed(6);
			}),
		);
	const frame = (p: InstanceType<typeof L.ComponentTimelinePlayer>) =>
		round(nodes.map((n) => p.sample(n)));
	let firstDiff = -1;
	let completed = 0;
	for (let f = 1; f <= 60 * 30; f++) {
		completed += now.advance(1 / 60).completed.length;
		old.advance(1 / 60);
		if (firstDiff < 0 && JSON.stringify(frame(now)) !== JSON.stringify(frame(old))) firstDiff = f;
	}
	eq(
		'frames 1–1800 (30 s, ten idle laps) sample what the hour-long timeline did, phase for phase',
		[firstDiff, completed, nodes.length > 0],
		[-1, 0, true],
	);
	// Past the hour: the old one froze on its last frame, the looping one keeps cycling.
	now.advance(3600);
	old.advance(3600);
	const t = now.timeOf(show.id)!;
	eq(
		'past an hour the show still loops the idle (the hour-long one had ended)',
		[now.isPlaying(), old.isPlaying(), t >= show.loopFrom! && t < show.duration],
		[true, false, true],
	);
	// A looping timeline crosses its cues on every lap and never holds a cue.
	const cued: CinematicDoc = {
		...show,
		id: 'c_followup_cued',
		playOn: 'cuedProbe',
		holdsCue: true,
		duration: 1,
		loopFrom: 0.25,
		tracks: [{ id: 'cues', kind: 'cue', keys: [{ time: 0.5, cue: 'mid' }] }],
	};
	const p = new L.ComponentTimelinePlayer([cued], []);
	p.trigger('cuedProbe');
	const fired: string[] = [];
	for (let f = 0; f < 3 * 60; f++) fired.push(...p.advance(1 / 60).cues.map((c) => c.cue));
	eq(
		'a looping timeline fires its cue each lap and holds no awaited fire',
		[fired.length, p.holdsOn('cuedProbe')],
		[4, []],
	);
	const outOfRange = new L.ComponentTimelinePlayer([{ ...cued, loopFrom: 1 }], []);
	outOfRange.trigger('cuedProbe');
	eq(
		'a loopFrom outside [0, duration) is ignored: the timeline ends as before',
		outOfRange.advance(2).completed,
		['c_followup_cued'],
	);
}

// ---- 3. the swap carries every base-node field -----------------------------------------------------

{
	const types = src('../../../packages/engine-layout/src/lib/types.ts');
	const body = types.slice(types.indexOf('interface BaseNode {'));
	const fields = [
		...body.slice(0, body.indexOf('\n}\n')).matchAll(/^\t(?:readonly )?(\w+)\??:/gm),
	].map((m) => m[1]);
	eq(
		'BASE_NODE_FIELDS lists exactly the fields of BaseNode (read off the source)',
		[...fields].sort(),
		Object.keys(T.BASE_NODE_FIELDS).sort(),
	);
	eq(
		'NEGATIVE CONTROL: a field missing from the list is reported',
		JSON.stringify([...fields, 'futureField'].sort()) ===
			JSON.stringify(Object.keys(T.BASE_NODE_FIELDS).sort()),
		false,
	);
	const full: Record<string, unknown> = {};
	for (const field of Object.keys(T.BASE_NODE_FIELDS)) full[field] = `v:${field}`;
	const coded = {
		...full,
		id: 'fs-intro',
		label: 'Intro',
		x: 3,
		y: 4,
		kind: 'container',
		children: [],
		bind: { component: 'FreeSpinIntroVisual', props: { boundToInstance: false } },
	} as unknown as LayoutNode;
	const swapped = A.withAuthoredFreeSpins({ id: 's', name: 's', space: 'canvas', nodes: [coded] })
		.nodes[0] as unknown as Record<string, unknown>;
	const lost = Object.entries(T.BASE_NODE_FIELDS)
		.filter(([field, carry]) => carry && field !== 'label' && swapped[field] !== full[field])
		.map(([field]) => field)
		.filter((field) => !['id', 'x', 'y'].includes(field));
	eq(
		'the swap carries every base-node field but bind (label marked authored)',
		[
			lost,
			swapped.bind,
			swapped.children,
			swapped.kind,
			swapped.componentId,
			swapped.label,
			[swapped.id, swapped.x, swapped.y],
		],
		[
			[],
			undefined,
			undefined,
			'componentInstance',
			C.FREE_SPIN_INTRO_PRESENTATION_ID,
			'Intro (authored)',
			['fs-intro', 3, 4],
		],
	);
}

// ---- 4. the chips read the doc the game boots ------------------------------------------------------

{
	const combos = [
		{},
		{ freeSpins: true },
		{ transition: true, freeSpins: true },
		{ transition: true, win: true, freeSpins: true },
	];
	const docs = REFERENCE;
	const mismatches: string[] = [];
	for (const doc of docs) {
		for (const rows of combos) {
			const layout = withRows(doc, rows);
			const chips = W.authoredOverlayChips(layout, null, undefined, () => false);
			const tiers = W.authoredWinTiersFor({ config: null, layout, winText: undefined });
			const game = A.resolveAuthoredOverlays(layout, {
				status: (d) => A.authoredWinStatus({ doc: d, tiers }),
			});
			const a = [chips.authoredTransition, chips.authoredWin, chips.authoredFreeSpins];
			const b = [game.transition, game.win, game.freeSpins];
			if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(`${doc.gameType}:${a}≠${b}`);
		}
	}
	eq('the chips equal the game’s resolution on every reference layout × row', mismatches, []);
	eq(
		'off ⇒ the resolution hands back the same doc object',
		A.resolveAuthoredOverlays(lines, { status: () => 'off' }).doc === lines,
		true,
	);
	const game = src('../../lines/src/components/Game.svelte');
	const page = src('../src/routes/(app)/game-maker/+page.server.ts');
	eq(
		'the game and the Game Maker page call the shared resolution and no status rule directly',
		[
			game.includes('resolveAuthoredOverlays(rawDoc, {'),
			/authoredFreeSpinsStatus\(|withAuthoredFreeSpinsDoc\(|withAuthoredWinDoc\(/.test(game),
			page.includes('authoredOverlayChips(buttoned, config.doc, winText, '),
			/authored(Transition|Win|FreeSpins)Status\(/.test(page),
		],
		[true, false, true, false],
	);
}

// ---- 5. the lock is lifted -----------------------------------------------------------------------

{
	eq(
		'the lock symbols are gone',
		[
			'lockedOverlaySwitchedOn' in G,
			'submitsLockedOverlayOn' in G,
			'AuthoredOverlayLockedError' in G,
			'assertRawEditorDocWriteUnlocked' in E,
		],
		[false, false, false, false],
	);
	const client = 'c';
	const project = 'p';
	const key = P.editorDocKey(client, project);
	R2.clear();
	await E.saveDoc(client, project, withRows(lines, {}), null);
	const on = withRows(lines, { freeSpins: true, buttons: true });
	eq(
		'saveDoc writes a doc that switches free spins and buttons on',
		[
			await rejects(() => E.saveDoc(client, project, on, R2.get(key)!.etag)),
			JSON.parse(R2.get(key)!.body).settings.authoredOverlays,
		],
		['resolved', { freeSpins: true, buttons: true }],
	);
	const read = (rel: string) => src(`../src/${rel}`);
	eq(
		'no write path maps a lock refusal any more',
		[
			/AuthoredOverlayLocked|locked_overlay|lockedOverlay/.test(
				read('routes/api/editor/backups/+server.ts') +
					read('lib/server/director/ops/scene.ts') +
					read('routes/api/files/upload/+server.ts') +
					read('routes/api/files/move/+server.ts'),
			),
			Object.keys(Sc.scaffoldLayoutDoc('p', 'lines', withRows(lines, { freeSpins: true }))),
		],
		[false, ['version', 'projectKey', 'gameType', 'scenes']],
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} authored free spins (follow-up): ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
