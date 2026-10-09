/**
 * Invisible Flow v2 — ADD-ON vocabulary composition and the "＋ Add overlay steps" graft
 * (`docs/design/pots-overlay.md` §2, §4 "Flow editor").
 *
 * A project keeps its kind's vocabulary; a Game Config add-on block layers its own surfaces on top.
 * {@link withAddOns} is applied wherever a vocabulary is resolved for a project — the `/flow-v2`
 * editor, the publish gate and the game — so a Book-of flow can reference the pots and the respin
 * feature and still publish. Nothing becomes mandatory: an event a flow leaves unwired falls through
 * to its coded default.
 *
 * The add-on facts are STRUCTURAL ({@link FlowAddOns}) because this package depends on no config
 * package: `game-config`'s `flowAddOnsOf(doc)` builds them from a normalized doc.
 */

import { containersMissingScene } from '../containerScenes';
import { flowGraphs, graphHandlesSignal } from '../runtime';
import type { FlowDoc, Graph, TemplateVocabulary, TypeRef } from '../types';
import type { FlowIssue } from '../validate';
import {
	buildEntryGraph,
	holdAndWinModeGraph,
	modeContainerRefs,
	spinsContainerRefs,
	spinsModeGraph,
} from './drivenSeed';
import { beat, HOLD_AND_WIN_FRAGMENT } from './holdAndWin';
import { trig, type ChoreoStep } from './bookOfChoreo';
import { HOLD_AND_WIN_BASE_CHOREO } from './holdAndWinChoreo';
import { templateVocabulary } from './registry';
import { INT, SYMBOL, insertAfter, type VocabFragment } from './standardVocab';

/** Which add-on blocks a project's Game Config carries, and its meter ids (`resolveMeters`). */
export interface FlowAddOns {
	/** A respin mode with Hold and Win rules is declared. */
	holdAndWin?: boolean;
	potsOverlay?: boolean;
	meters?: readonly string[];
	/** The respin modes with rules, the primary first; absent ⇒ the lone `holdAndWin` when
	 *  `holdAndWin` is on. */
	respinModes?: readonly string[];
	/** The spins modes (`GameModeDecl.spins`, bonus-games Phase 8), in declaration order; absent ⇒
	 *  none. Each plays as free spins in its own mode, so it takes the kind's own vocabulary. */
	spinsModes?: readonly string[];
}

const FLOAT: TypeRef = { t: 'float' };
const STRING: TypeRef = { t: 'string' };
const BOOL: TypeRef = { t: 'bool' };

/** The named entries of a Hold and Win fragment list — the same decl objects, never copies. */
const pick = <T extends { name: string }>(entries: readonly T[], names: readonly string[]): T[] =>
	names.map((name) => {
		const entry = entries.find((e) => e.name === name);
		if (!entry) throw new Error(`addOns: the Hold and Win fragment has no '${name}'`);
		return entry;
	});

const drainPots = beat('drainPots', 'freeSpinTrigger');

/**
 * The overlay's own beats, each the coded presentation `apps/lines` plays:
 * - `showTokens` — the dropped tokens land over their cells and settle (`overlayDrop`'s default);
 * - `liftTokens` — a pot's tokens leave their cells at once, without flying, for a fill presented
 *   another way (`fillMeter` flies each off as its own flight leaves);
 * - `drainPots` — the pots that started a free-spin or generic mode drain, as the coded entry does
 *   (Hold and Win's `showRespinBoard` drains its own). An owned entry whose chain has no `drainPots`
 *   still drains: the game plays the coded drain before the flow runs it.
 */
const OVERLAY_ACTIONS: TemplateVocabulary['actions'] = [
	beat('showTokens', 'overlayDrop'),
	beat('liftTokens', 'meterUpdate'),
	{
		...drainPots,
		params: drainPots.params.map((param) => ({
			...param,
			description:
				'The `freeSpinTrigger` or `modeEnter` event this beat presents: on either chain, set accessor $trigger with no field. Any other event is refused.',
		})),
	},
];

/**
 * The pots overlay's surfaces: its `overlayDrop` event, the pots it shares with Hold and Win (the
 * filling event, the restatement, the pot cues and the two effects that already present them), the
 * overlay's own beats and the types those name.
 */
const POTS_OVERLAY_FRAGMENT: VocabFragment = {
	structs: [
		// `pot` names the pot a token fills; `value` / `jackpot` are a value coin's. A struct field
		// cannot be optional, so a cell that does not carry one reads it as absent.
		{
			name: 'OverlayCell',
			fields: [
				{ name: 'reel', type: INT },
				{ name: 'row', type: INT },
				{ name: 'token', type: SYMBOL },
				{ name: 'pot', type: STRING },
				{ name: 'value', type: FLOAT },
				{ name: 'jackpot', type: STRING },
			],
		},
		...pick(HOLD_AND_WIN_FRAGMENT.structs, [
			'HoldAndWinSymbol',
			'HoldAndWinCell',
			'HoldAndWinCellAmount',
			'HoldAndWinMeterLevel',
			'BookEvent',
		]),
	],
	enums: pick(HOLD_AND_WIN_FRAGMENT.enums, ['HoldAndWinSpecial']),
	baseEvents: [
		{
			name: 'overlayDrop',
			payload: [
				{
					name: 'cells',
					type: { t: 'list', of: { t: 'struct', name: 'OverlayCell' } },
					description: 'The cells a token landed on, each with its token symbol.',
				},
			],
			category: 'book',
			description:
				'Tokens appeared on these cells, over whatever symbol is there — after the board’s reveal, before its wins. Unwired, the game’s coded default presents them.',
		},
		...pick(HOLD_AND_WIN_FRAGMENT.baseEvents, ['meterUpdate', 'meterLevels']),
	],
	featureEvents: [],
	actions: [...pick(HOLD_AND_WIN_FRAGMENT.actions, ['flyTo', 'fillMeter']), ...OVERLAY_ACTIONS],
	cues: pick(HOLD_AND_WIN_FRAGMENT.cues, [
		'potFill',
		'potLevelUp',
		'potStageUp',
		'potFull',
		'potsConsume',
		'flightArrive',
	]),
	values: [],
};

/** `linesEngineReader`'s per-pot keys, one set per meter id. */
const meterValues = (ids: readonly string[]): TemplateVocabulary['values'] =>
	ids.flatMap((id) => [
		{
			name: `meter.${id}.level`,
			type: INT,
			description: `Pot '${id}': its level as drawn (a beat in flight holds it back).`,
		},
		{ name: `meter.${id}.max`, type: INT, description: `Pot '${id}': the level that fills it.` },
		{
			name: `meter.${id}.stage`,
			type: INT,
			description: `Pot '${id}': how many of its size stages it has reached.`,
		},
		{ name: `meter.${id}.full`, type: BOOL, description: `Pot '${id}': it is showing full.` },
	]);

/** The entries of `extra` whose name neither `have` nor an earlier `extra` entry declares. */
const missing = <T extends { name: string }>(have: readonly T[], extra: readonly T[]): T[] => {
	const names = new Set(have.map((e) => e.name));
	const out: T[] = [];
	for (const entry of extra) {
		if (names.has(entry.name)) continue;
		names.add(entry.name);
		out.push(entry);
	}
	return out;
};

/**
 * `vocab` plus the fragment's entries it does not already declare, by name per list — an entry the
 * kind has stays the kind's. Base events follow `reveal`, feature events close the event list and the
 * fragment's cues open the cue list, as in the mechanic's own vocabulary. Nothing new ⇒ `vocab`.
 */
const compose = (vocab: TemplateVocabulary, fragment: VocabFragment): TemplateVocabulary => {
	const structs = missing(vocab.structs, fragment.structs);
	const enums = missing(vocab.enums, fragment.enums);
	const baseEvents = missing(vocab.events, fragment.baseEvents);
	const featureEvents = missing([...vocab.events, ...baseEvents], fragment.featureEvents);
	const actions = missing(vocab.actions, fragment.actions);
	const cues = missing(vocab.cues, fragment.cues);
	const values = missing(vocab.values, fragment.values);
	const parts = [structs, enums, baseEvents, featureEvents, actions, cues, values];
	if (parts.every((part) => part.length === 0)) return vocab;
	return {
		...vocab,
		structs: [...vocab.structs, ...structs],
		enums: [...vocab.enums, ...enums],
		events: [
			...(baseEvents.length ? insertAfter(vocab.events, 'reveal', baseEvents) : vocab.events),
			...featureEvents,
		],
		actions: [...vocab.actions, ...actions],
		cues: [...cues, ...vocab.cues],
		values: [...vocab.values, ...values],
	};
};

/**
 * A kind's vocabulary with the surfaces of the add-ons a project's config carries: the respin
 * feature for a `holdAndWin` block, the pots overlay (and its `meter.<id>.*` values) for a
 * `potsOverlay` block. No block ⇒ `vocab` itself, identity included, so a project without add-ons
 * resolves exactly what it did before.
 */
export function withAddOns(
	vocab: TemplateVocabulary,
	addOns: FlowAddOns | undefined,
): TemplateVocabulary {
	let out = vocab;
	if (addOns?.holdAndWin) out = compose(out, HOLD_AND_WIN_FRAGMENT);
	if (addOns?.potsOverlay) {
		out = compose(out, { ...POTS_OVERLAY_FRAGMENT, values: meterValues(addOns.meters ?? []) });
	}
	return out;
}

// ---------------------------------------------------------------------------
// The graft — "＋ Add overlay steps".
// ---------------------------------------------------------------------------

/**
 * The base-game beats the overlay grafts, each the coded beat of its event: `showTokens` lands the
 * dropped tokens, `fillMeter` flies them into their pot.
 */
const OVERLAY_BASE_CHOREO = {
	overlayDrop: [{ k: 'action', ref: 'showTokens', inputs: { bookEvent: trig() } }] as ChoreoStep[],
	meterUpdate: HOLD_AND_WIN_BASE_CHOREO.meterUpdate,
};

const HOLD_AND_WIN_MODE = 'holdAndWin';
/** The Hold and Win KIND (`templateId`), whose own vocabulary has the respin feature. */
const HOLD_AND_WIN_KIND = 'holdAndWin';

/** The respin modes `addOns` declares, the primary first. */
export const flowRespinModes = (addOns: FlowAddOns | undefined): readonly string[] =>
	addOns?.respinModes ?? (addOns?.holdAndWin ? [HOLD_AND_WIN_MODE] : []);

/** Is mode tab `modeId` a respin mode's (keyed on the board, not the id): one of `addOns`' respin
 *  modes, or `holdAndWin`, the Hold and Win kind's own. */
export const isRespinTab = (modeId: string, addOns: FlowAddOns | undefined): boolean =>
	modeId === HOLD_AND_WIN_MODE || flowRespinModes(addOns).includes(modeId);

/**
 * The Hold and Win events that fire only while a respin mode is on screen: the feature's events but
 * the ones that can also arrive outside it — `jackpotWin` (a base-game jackpot too) and the two that
 * open the feature (`holdAndWinTrigger`, `holdAndWinWheel`), which a queued bonus can present under
 * another mode.
 */
export const RESPIN_FEATURE_EVENTS: readonly string[] = HOLD_AND_WIN_FRAGMENT.featureEvents
	.map((event) => event.name)
	.filter(
		(name) =>
			!(name in HOLD_AND_WIN_BASE_CHOREO) &&
			name !== 'holdAndWinTrigger' &&
			name !== 'holdAndWinWheel',
	);

/** `vocab` as a mode tab that is not a respin mode's offers it: without the respin feature's events,
 *  which never reach that tab. Every other tab, and the global graph, keeps `vocab` itself. */
export const vocabForTab = (
	vocab: TemplateVocabulary,
	modeId: string | null | undefined,
	addOns: FlowAddOns | undefined,
): TemplateVocabulary =>
	modeId == null || isRespinTab(modeId, addOns)
		? vocab
		: { ...vocab, events: vocab.events.filter((e) => !RESPIN_FEATURE_EVENTS.includes(e.name)) };

/**
 * A respin feature event handled in a mode tab that is not a respin mode's: a signal goes to the
 * section of the mode on screen, and these fire only while a respin mode is, so the chain never runs.
 * WARNINGS, so a flow that published before still publishes. Judged only where the vocabulary has
 * the respin feature (a Hold and Win project, or one with a respin mode).
 */
export function respinTabIssues(doc: FlowDoc, addOns: FlowAddOns | undefined): FlowIssue[] {
	if (doc.templateId !== HOLD_AND_WIN_KIND && !addOns?.holdAndWin) return [];
	return flowGraphs(doc).flatMap(({ modeId, graph }) => {
		if (modeId === undefined || isRespinTab(modeId, addOns)) return [];
		return RESPIN_FEATURE_EVENTS.flatMap((event): FlowIssue[] => {
			const own = graph.nodes.find((n) => n.kind === 'event' && n.ref === event);
			const pin = graph.exec.find(
				(e) =>
					e.from.pin === event &&
					graph.nodes.some((n) => n.id === e.from.node && n.kind === 'gameSignals'),
			)?.from;
			const at: FlowIssue['at'] | undefined = own
				? { on: 'node', node: own.id }
				: pin && { on: 'pin', node: pin.node, pin: event };
			if (!at) return [];
			return [
				{
					code: 'respin-event-off-board',
					severity: 'warning',
					message: `'${event}' fires only while a respin mode is on screen, and the '${modeId}' tab is not a respin mode's — move it to that mode's tab or the global graph`,
					at,
					mode: modeId,
				},
			];
		});
	});
}

/**
 * What is wrong with a spins mode's tab (`FlowAddOns.spinsModes`; the graft seeds it with
 * `spinsModeGraph`):
 *  - `spins-hold-scene-missing`, an ERROR: it holds the round (`showContainer{awaitComplete}`) on a
 *    container whose scene is not in `sceneIds`, so the hold never releases and its free spins never
 *    continue — "＋ Add overlay steps" run before the Scene Editor's "Add missing screens". Judged
 *    only when the caller projects the layout's scene ids in (`containersMissingScene`). An error here alone: no flow had a
 *    spins tab before this check, so nothing that published before is refused.
 *  - `spins-counter-unswapped`, a WARNING: the flow drives the screens and shows the base free-spin
 *    counter, but the tab never hides it, so the base counter draws beside the mode's (a tab seeded
 *    before the flow drove the screens; remove the tab and graft again).
 */
export function spinsTabIssues(
	doc: FlowDoc,
	addOns: FlowAddOns | undefined,
	sceneIds?: readonly string[],
): FlowIssue[] {
	const missing = new Map(
		containersMissingScene(doc.containers, sceneIds ?? []).map((c) => [c.id, c.sceneId]),
	);
	const drives =
		graphHandlesSignal(doc.graph, 'load') && doc.containers.some((c) => c.id === FS_COUNTER);
	return (addOns?.spinsModes ?? []).flatMap((modeId): FlowIssue[] => {
		const graph =
			doc.modes && Object.hasOwn(doc.modes, modeId) ? doc.modes[modeId].graph : undefined;
		if (!graph) return [];
		const issues: FlowIssue[] = [];
		for (const node of graph.nodes) {
			if (node.kind !== 'showContainer' || !node.awaitComplete) continue;
			const sceneId = missing.get(node.ref);
			if (sceneId === undefined) continue;
			issues.push({
				code: 'spins-hold-scene-missing',
				severity: 'error',
				message: `The '${modeId}' tab holds its free spins on screen '${sceneId}', which is not in this game's layout, so they would never continue — add it with the Scene Editor's "Add missing screens"`,
				at: { on: 'node', node: node.id },
				mode: modeId,
			});
		}
		const hidesBase = graph.nodes.some((n) => n.kind === 'hideContainer' && n.ref === FS_COUNTER);
		const anchor =
			graph.nodes.find((n) => n.kind === 'modeTrigger' && n.on === 'enter') ?? graph.nodes[0];
		if (drives && !hidesBase && anchor) {
			issues.push({
				code: 'spins-counter-unswapped',
				severity: 'warning',
				message: `This flow draws the base free-spin counter, and the '${modeId}' tab never hides it, so it draws beside the mode's own — hide '${FS_COUNTER}' on the tab's Mode trigger (enter) and show it again on (exit), or remove the tab and use "＋ Add overlay steps"`,
				at: { on: 'node', node: anchor.id },
				mode: modeId,
			});
		}
		return issues;
	});
}

/** The base game's free-spin counter, which a spins mode's tab swaps for its own. */
const FS_COUNTER = 'freeSpinCounter';

/** What a graft did: the new doc, and a label per thing it added (empty ⇒ the doc unchanged). */
export interface AddOnGraft {
	doc: FlowDoc;
	added: string[];
}

const nodeIds = (graph: Graph, into: Set<string>): Set<string> => {
	for (const node of graph.nodes) {
		into.add(node.id);
		if (node.kind === 'group') nodeIds(node.body, into);
	}
	return into;
};

/** The first of `base`, `base2`, `base3`… that starts no id in `ids` (ids are `<prefix>_…`). */
const freePrefix = (ids: ReadonlySet<string>, base: string): string => {
	for (let n = 1; ; n++) {
		const prefix = n === 1 ? base : `${base}${n}`;
		if (![...ids].some((id) => id.startsWith(`${prefix}_`))) return prefix;
	}
};

/**
 * Add the add-on steps a project's flow does not have yet, never touching an authored node or wire:
 *  - **pots overlay**: for each overlay base event the GLOBAL graph does not handle (no `event` node
 *    for it and no wired `gameSignals` pin — the runtime's own ownership test), a dedicated `event`
 *    node and its coded beat. An `event` node rather than a pin on the doc's `gameSignals` node:
 *    the runtime walks the FIRST `gameSignals` node only, and wiring an authored node is not ours.
 *    Placed right of every existing node.
 *  - **Hold and Win bonus**: for each respin mode (`flowRespinModes`, the primary first) the doc has no
 *    section for, `modes.<modeId>` from the Hold and Win starter flow (an existing one is left
 *    alone), showing that mode's own `-<modeId>` screens. Its beats show the mode's screens, and the
 *    validator refuses a show of a container the doc does not declare, so each missing one is
 *    declared at the seed's z — the same ref a Hold and Win project carries. A declared container
 *    whose scene the project lacks validates and mounts nothing (the Scene Editor's "＋ Add overlay
 *    screens" adds them), so the graft never makes a flow unpublishable.
 *  - **Spins modes**: for each spins mode the doc has no section for, `modes.<modeId>` presenting its
 *    free spins on its own `-<modeId>` screens (`spinsModeGraph`), with the doc's template
 *    vocabulary. A flow that drives the screens and shows the base counter also swaps the counter
 *    for the mode's own while the mode is on screen. Missing containers are declared as above.
 *
 * Every new id carries a prefix no id of the doc starts with. Pure: the input is not mutated, and
 * nothing to add returns it as is, so a second graft is a no-op.
 */
export function graftAddOnSteps(doc: FlowDoc, addOns: FlowAddOns | undefined): AddOnGraft {
	const ids = new Set<string>();
	for (const { graph } of flowGraphs(doc)) nodeIds(graph, ids);
	const added: string[] = [];
	let graph = doc.graph;
	let modes = doc.modes;
	let containers = doc.containers;

	const events = addOns?.potsOverlay
		? (Object.keys(OVERLAY_BASE_CHOREO) as (keyof typeof OVERLAY_BASE_CHOREO)[]).filter(
				(event) => !graphHandlesSignal(doc.graph, event),
			)
		: [];
	if (events.length) {
		const prefix = freePrefix(ids, 'overlay');
		const xs = doc.graph.nodes.map((n) => n.pos.x);
		const chains = buildEntryGraph({
			prefix,
			x: xs.length ? Math.max(...xs) + 400 : 0,
			entries: events.map((event) => ({
				node: { id: `${prefix}_on_${event}`, kind: 'event', pos: { x: 0, y: 0 }, ref: event },
				beats: [{ k: 'steps', steps: OVERLAY_BASE_CHOREO[event] }],
			})),
		});
		nodeIds(chains, ids);
		graph = {
			nodes: [...graph.nodes, ...chains.nodes],
			exec: [...graph.exec, ...chains.exec],
			data: [...graph.data, ...chains.data],
		};
		added.push(...events);
	}

	for (const modeId of flowRespinModes(addOns)) {
		if (doc.modes?.[modeId]) continue;
		const section = holdAndWinModeGraph(freePrefix(ids, 'hw'), modeId);
		nodeIds(section, ids);
		modes = { ...modes, [modeId]: { graph: section } };
		added.push(`modes.${modeId}`);
		const declared = new Set(containers.map((c) => c.id));
		const shown = section.nodes.flatMap((n) =>
			(n.kind === 'showContainer' || n.kind === 'hideContainer') && !declared.has(n.ref)
				? [n.ref]
				: [],
		);
		const missingRefs = modeContainerRefs(shown, modeId);
		if (missingRefs.length) {
			containers = [...containers, ...missingRefs];
			added.push(...missingRefs.map((c) => `container ${c.id}`));
		}
	}

	const swapCounter =
		graphHandlesSignal(doc.graph, 'load') && containers.some((c) => c.id === FS_COUNTER);
	for (const modeId of addOns?.spinsModes ?? []) {
		if (doc.modes?.[modeId]) continue;
		const section = spinsModeGraph(
			freePrefix(ids, 'fs'),
			modeId,
			templateVocabulary(doc.templateId),
			{ swapCounter },
		);
		// A template without free spins presents nothing: no tab, so a later graft can still seed one.
		if (!section.nodes.length) continue;
		nodeIds(section, ids);
		modes = { ...modes, [modeId]: { graph: section } };
		added.push(`modes.${modeId}`);
		const declared = new Set(containers.map((c) => c.id));
		const shown = section.nodes.flatMap((n) =>
			(n.kind === 'showContainer' || n.kind === 'hideContainer') && !declared.has(n.ref)
				? [n.ref]
				: [],
		);
		const missingRefs = spinsContainerRefs(shown, modeId);
		if (missingRefs.length) {
			containers = [...containers, ...missingRefs];
			added.push(...missingRefs.map((c) => `container ${c.id}`));
		}
	}

	if (!added.length) return { doc, added };
	return {
		doc: { ...doc, graph, containers, ...(modes ? { modes } : {}) },
		added,
	};
}
