/**
 * `startup-tap-surface` — a driven flow must not show, at start-up and for good, a screen whose
 * scene carries a tap-to-continue armed on mount (`docs/status/flow.md`):
 *   pnpm --filter launcher-api check:startup-tap-surface
 *
 * The live case is `unassigned/cloud`: a flow seeded under the old "mount once, toggle by cue" model
 * shows `freeSpinIntro` / `freeSpinOutro` at start-up and never hides them, over the newer
 * self-sufficient scenes whose `fs-intro-tap` is armed on mount — a dimmed tap surface covers the
 * idle game and Space cannot spin.
 *
 *  1. Every slot kind's starter flow, against its own full scene set, raises nothing.
 *  2. The cloud shape (the starter, plus the two screens shown on `complete:loading` and
 *     `tapToStart`, every hide of them removed) raises ONE error, for the intro — the outro's tap
 *     waits for its count-up — anchored on the start-up show, naming the screen, the tap and the fix.
 *  3. The publish gate refuses it, the refusal naming the screen; `allowInvalidFlow` overrides.
 *  4. Each way out clears it: the tap armed after a signal (on the instance, or on one per-layoutType
 *     patch), a hide anywhere (another section, a group body, a shared function), or the show moved
 *     off start-up (a button's exec-out on the HUD fires later).
 *  5. The scene projection: nested taps found, an explicit `tapToContinue: false` and a non-tap
 *     instance skipped, a container whose scene is missing never keyed.
 */
import {
	freshDrivenSeedDoc,
	startupShownContainers,
	startupTapIssues,
	type FlowDoc,
	type FlowIssue,
	type FunctionLibraryDoc,
	type Node,
} from 'engine-flow-v2';
import {
	getFullSceneSet,
	TAP_ARM_AFTER_SIGNAL_PARAM,
	TAP_TO_CONTINUE_PARAM,
	type LayoutNode,
	type Scene,
} from 'engine-layout';
import { SLOT_GAME_KINDS } from 'constants-shared/gameKinds';

import { collectArmedOnMountTaps } from '../src/lib/containerTaps';
import { flowGateRefusal, validateFlowV2Against } from '../src/lib/server/flowV2Validation';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) {
		passes++;
		console.log(`  PASS  ${name}`);
	} else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const EMPTY_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const startup = (issues: FlowIssue[]) => issues.filter((i) => i.code === 'startup-tap-surface');
const describe = (issues: FlowIssue[]) => issues.map((i) => i.message).join(' | ') || '(none)';
const issuesFor = (doc: FlowDoc, scenes: Scene[], library = EMPTY_LIBRARY) =>
	startupTapIssues(doc, library, collectArmedOnMountTaps(doc.containers, scenes));

const FS_INTRO = 'freeSpinIntro';
const FS_OUTRO = 'freeSpinOutro';

// 1. ---------------------------------------------------------------------------------------------
console.log('1. every slot starter is clean against its own scenes');
for (const kind of SLOT_GAME_KINDS) {
	const scenes = getFullSceneSet(kind)?.scenes ?? [];
	const doc = freshDrivenSeedDoc(kind);
	const issues = issuesFor(doc, scenes);
	check(`${kind}: no startup-tap-surface`, issues.length === 0, describe(issues));
}

// 2. ---------------------------------------------------------------------------------------------
console.log('2. the cloud shape is flagged, on the intro only');
const BOOK_SCENES = getFullSceneSet('bookOf')?.scenes ?? [];
check(
	'the book-of scene set has the self-sufficient intro + outro',
	[FS_INTRO, FS_OUTRO].every((id) => BOOK_SCENES.some((s) => s.id === id)),
);

/** Append `show <ids>` to the end of the chain that starts at the node `entry` points to. */
const appendShows = (doc: FlowDoc, entry: string, ids: string[], tag: string): string[] => {
	const next = (id: string) =>
		doc.graph.exec.find((e) => e.from.node === id && e.from.pin === 'exec')?.to.node;
	let tail = entry;
	for (let n = next(tail); n; n = next(tail)) tail = n;
	return ids.map((ref) => {
		const id = `${tag}_show_${ref}`;
		doc.graph.nodes.push({ id, kind: 'showContainer', ref, pos: { x: 0, y: 0 } } as Node);
		doc.graph.exec.push({ from: { node: tail, pin: 'exec' }, to: { node: id, pin: 'exec' } });
		tail = id;
		return id;
	});
};

/** Every hide of `refs` removed, and its exec edges spliced so the chain stays linear. */
const dropHides = (doc: FlowDoc, refs: string[]): void => {
	const graphs = [doc.graph, ...Object.values(doc.modes ?? {}).map((m) => m.graph)];
	for (const graph of graphs) {
		for (const node of graph.nodes.filter(
			(n) => n.kind === 'hideContainer' && refs.includes(n.ref),
		)) {
			const into = graph.exec.filter((e) => e.to.node === node.id);
			const out = graph.exec.find((e) => e.from.node === node.id);
			graph.exec = graph.exec.filter((e) => e.to.node !== node.id && e.from.node !== node.id);
			if (out) for (const e of into) graph.exec.push({ from: e.from, to: out.to });
			graph.nodes = graph.nodes.filter((n) => n.id !== node.id);
		}
	}
};

/** The live shape; `onTapToStart: false` leaves the `complete:loading` chain the only way in. */
const cloudShape = ({ onTapToStart = true } = {}): { doc: FlowDoc; shows: string[] } => {
	const doc = freshDrivenSeedDoc('bookOf');
	const completeLoading = doc.graph.nodes.find(
		(n) => n.kind === 'event' && n.ref === 'complete:loading',
	);
	const tapToStart = doc.graph.exec.find((e) => e.from.pin === 'tapToStart')?.to.node;
	if (!completeLoading || !tapToStart)
		throw new Error('the book-of starter lost its start-up chains');
	dropHides(doc, [FS_INTRO, FS_OUTRO]);
	const shows = appendShows(doc, completeLoading.id, [FS_INTRO, FS_OUTRO], 'cl');
	if (onTapToStart) shows.push(...appendShows(doc, tapToStart, [FS_INTRO, FS_OUTRO], 'ts'));
	return { doc, shows };
};

{
	const viaSplash = cloudShape({ onTapToStart: false });
	const splashShown = startupShownContainers(viaSplash.doc);
	check(
		'complete:loading alone makes both screens start-up shows',
		splashShown.get(FS_INTRO) === viaSplash.shows[0] &&
			splashShown.get(FS_OUTRO) === viaSplash.shows[1],
		JSON.stringify([...splashShown]),
	);
	check('…and flags the intro', issuesFor(viaSplash.doc, BOOK_SCENES).length === 1);

	const { doc, shows } = cloudShape();
	const issues = issuesFor(doc, BOOK_SCENES);
	check('exactly one issue', issues.length === 1, describe(issues));
	const [issue] = issues;
	check('it is an ERROR', issue?.severity === 'error');
	check(
		'anchored on the start-up show',
		issue?.at.on === 'node' && shows.includes(issue.at.node) && issue.at.node.endsWith(FS_INTRO),
		JSON.stringify(issue?.at),
	);
	const message = issue?.message ?? '';
	check(
		'the message names the screen, the tap and the fix',
		message.includes(`'${FS_INTRO}'`) &&
			message.includes("'fs-intro-tap'") &&
			message.includes('never hidden') &&
			message.includes('Hold until this screen completes') &&
			message.includes('Arm tap after signal'),
		message,
	);

	// 3. -------------------------------------------------------------------------------------------
	console.log('3. the publish gate refuses it');
	const validated = validateFlowV2Against(doc, BOOK_SCENES, null, EMPTY_LIBRARY);
	check(
		'validateFlowV2Against carries it',
		startup(validated).length === 1,
		describe(startup(validated)),
	);
	const errors = validated.filter((i) => i.severity === 'error');
	const refusal = flowGateRefusal(
		{ status: 'invalid', templateId: doc.templateId, errors },
		'bookOf',
	);
	check(
		'the refusal message names the screen',
		refusal?.reason === 'invalid-flow' && refusal.message.includes(`'${FS_INTRO}'`),
		refusal?.message ?? 'not refused',
	);
	check(
		'allowInvalidFlow overrides it',
		flowGateRefusal({ status: 'invalid', templateId: doc.templateId, errors }, 'bookOf', true) ===
			null,
	);
}

// 4. ---------------------------------------------------------------------------------------------
console.log('4. each way out clears it');
const withIntroTap = (patch: (tap: LayoutNode) => void): Scene[] => {
	const scenes = clone(BOOK_SCENES);
	const tap = scenes.find((s) => s.id === FS_INTRO)?.nodes.find((n) => n.id === 'fs-intro-tap');
	if (!tap) throw new Error('fs-intro-tap is gone from the intro scene');
	patch(tap);
	return scenes;
};
{
	const { doc } = cloudShape();
	const armed = withIntroTap((tap) => {
		if (tap.kind === 'componentInstance')
			tap.params = { ...tap.params, [TAP_ARM_AFTER_SIGNAL_PARAM]: 'freeSpinIntroShow' };
	});
	check('the tap armed after a signal', issuesFor(doc, armed).length === 0);
	const portraitOnly = withIntroTap((tap) => {
		if (tap.kind === 'componentInstance')
			tap.overrides = { portrait: { params: { [TAP_ARM_AFTER_SIGNAL_PARAM]: 'x' } } };
	});
	check('the tap armed on one per-layoutType patch', issuesFor(doc, portraitOnly).length === 0);
}
{
	const { doc } = cloudShape();
	const anyMode = Object.keys(doc.modes ?? {})[0];
	const graph = anyMode ? doc.modes![anyMode].graph : doc.graph;
	graph.nodes.push({ id: 'late_hide', kind: 'hideContainer', ref: FS_INTRO, pos: { x: 0, y: 0 } });
	check(
		`a hide in ${anyMode ? `the '${anyMode}' section` : 'the global graph'}`,
		issuesFor(doc, BOOK_SCENES).length === 0,
	);
}
{
	const { doc } = cloudShape();
	doc.graph.nodes.push({
		id: 'grp',
		kind: 'group',
		pos: { x: 0, y: 0 },
		body: {
			nodes: [{ id: 'grp_hide', kind: 'hideContainer', ref: FS_INTRO, pos: { x: 0, y: 0 } }],
			exec: [],
			data: [],
		},
	} as unknown as Node);
	check('a hide inside a group body', issuesFor(doc, BOOK_SCENES).length === 0);
}
{
	const { doc } = cloudShape();
	const library: FunctionLibraryDoc = {
		version: 2,
		functions: [
			{
				id: 'hideIntro',
				inputs: [],
				outputs: [],
				body: {
					nodes: [
						{ id: 'fn_entry', kind: 'functionEntry', ref: 'hideIntro', pos: { x: 0, y: 0 } },
						{ id: 'fn_hide', kind: 'hideContainer', ref: FS_INTRO, pos: { x: 0, y: 0 } },
					],
					exec: [],
					data: [],
				},
			},
		],
	} as unknown as FunctionLibraryDoc;
	doc.graph.nodes.push({
		id: 'call_hide',
		kind: 'functionCall',
		ref: 'hideIntro',
		pos: { x: 0, y: 0 },
	});
	check('a hide in a shared function it calls', issuesFor(doc, BOOK_SCENES, library).length === 0);
}
{
	// The seed itself mounts the intro only inside `freeSpinTrigger`: that is not start-up.
	const doc = freshDrivenSeedDoc('bookOf');
	dropHides(doc, [FS_INTRO, FS_OUTRO]);
	check(
		'a show on a book-event chain, never hidden, is not a start-up show',
		!startupShownContainers(doc).has(FS_INTRO) && issuesFor(doc, BOOK_SCENES).length === 0,
	);
	// A show hung off a fused container-event pin (a HUD button) runs on the press, not at boot.
	const hud = doc.graph.nodes.find((n) => n.kind === 'showContainer' && n.ref === 'hudBar');
	if (!hud) throw new Error('the book-of starter does not show hudBar');
	doc.graph.nodes.push({
		id: 'btn_show',
		kind: 'showContainer',
		ref: FS_INTRO,
		pos: { x: 0, y: 0 },
	});
	doc.graph.exec.push({
		from: { node: hud.id, pin: 'hudBar.spinButton.onPress' },
		to: { node: 'btn_show', pin: 'exec' },
	});
	check(
		"a show on a container's button pin is not a start-up show",
		!startupShownContainers(doc).has(FS_INTRO),
	);
	// …but the same show on a gameSignals.load chain is.
	doc.graph.nodes.push({ id: 'load_ev', kind: 'event', ref: 'load', pos: { x: 0, y: 0 } });
	doc.graph.exec.push({
		from: { node: 'load_ev', pin: 'exec' },
		to: { node: 'btn_show', pin: 'exec' },
	});
	check(
		'the same show off an authored load event is',
		startup(issuesFor(doc, BOOK_SCENES)).length === 1,
	);
}

// 5. ---------------------------------------------------------------------------------------------
console.log('5. the scene projection');
{
	const tap = (id: string, params: Record<string, unknown>): LayoutNode =>
		({
			id,
			kind: 'componentInstance',
			componentId: 'tapToContinue',
			x: 0,
			y: 0,
			params,
		}) as LayoutNode;
	const scenes: Scene[] = [
		{
			id: 'a',
			name: 'a',
			space: 'canvas',
			nodes: [
				{
					id: 'wrap',
					kind: 'container',
					x: 0,
					y: 0,
					children: [tap('nested', { [TAP_TO_CONTINUE_PARAM]: true })],
				} as LayoutNode,
				tap('off', { [TAP_TO_CONTINUE_PARAM]: false }),
				tap('blank-arm', { [TAP_TO_CONTINUE_PARAM]: true, [TAP_ARM_AFTER_SIGNAL_PARAM]: '  ' }),
				tap('armed', { [TAP_TO_CONTINUE_PARAM]: true, [TAP_ARM_AFTER_SIGNAL_PARAM]: 'go' }),
			],
		} as Scene,
	];
	const taps = collectArmedOnMountTaps(
		[
			{ id: 'A', sceneId: 'a' },
			{ id: 'B', sceneId: 'gone' },
		],
		scenes,
	);
	check(
		'nested + blank-arm keyed; off, armed and the missing scene not',
		JSON.stringify(taps) === JSON.stringify({ A: ['nested', 'blank-arm'] }),
		JSON.stringify(taps),
	);
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
