/**
 * Invisible Flow v2 — the card starter flow (`docs/design/card-games.md` §5.3, C3): the doc a new
 * card project opens on.
 *
 * It owns `load`, so it drives every screen, and it decides nothing: the rules are all in
 * `engine-mechanics` `cards.js`, played by the runtime's match driver. This flow is the game's
 * menus and screens around a match.
 *
 *   - `load` shows the splash; `complete:loading` / `tapToStart` (a tap raises both; `started` lets
 *     the first through) swap it for the deck pick, which holds on its tap, then start a match with
 *     the first player deck (`cardsNewMatch`).
 *   - `matchReady` (every new match) shows the table and its HUD.
 *   - `matchEnded` shows the won or the lost screen, which holds on its tap, then starts the next
 *     match.
 *
 * The table's End Turn button runs `cardsEndPhase` itself (its `action` param), so the flow does
 * not wire it.
 */

import type { ContainerRef, DataSource, ExecEdge, FlowDoc, Node, PinPath } from '../types';

/** The card template's id — its vocabulary's (`cards.ts`) and its starter flow's. */
export const CARD_TEMPLATE_ID = 'card';

/** The screens a card scaffold has (`engine-layout`'s card scene set). */
export const CARD_SCREENS = {
	loading: 'loading',
	deckPick: 'cardDeckPick',
	table: 'basegame',
	won: 'cardWon',
	lost: 'cardLost',
} as const;

/** The starter flow's variables. */
export const CARD_VARIABLES = { started: 'started' } as const;

const CONTAINERS: ContainerRef[] = [
	{ id: CARD_SCREENS.table, sceneId: CARD_SCREENS.table, z: 0 },
	{ id: CARD_SCREENS.deckPick, sceneId: CARD_SCREENS.deckPick, z: 70 },
	{ id: CARD_SCREENS.won, sceneId: CARD_SCREENS.won, z: 80 },
	{ id: CARD_SCREENS.lost, sceneId: CARD_SCREENS.lost, z: 80 },
	{ id: CARD_SCREENS.loading, sceneId: CARD_SCREENS.loading, z: 100 },
];

const trigger = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const variable = (id: string): DataSource => ({ kind: 'accessor', path: { on: 'var', id } });
const bool = (value: boolean): DataSource => ({ kind: 'literal', type: { t: 'bool' }, value });
const text = (value: string): DataSource => ({ kind: 'literal', type: { t: 'string' }, value });

type Unplaced = Node extends infer N ? (N extends Node ? Omit<N, 'pos'> : never) : never;

const buildGraph = (): FlowDoc['graph'] => {
	const nodes: Node[] = [];
	const exec: ExecEdge[] = [];
	let row = 0;
	const add = (node: Unplaced): string => {
		nodes.push({ ...node, pos: { x: 260 * (nodes.length % 6), y: 120 * row } } as Node);
		return node.id;
	};
	const wire = (from: PinPath, to: string) => exec.push({ from, to: { node: to, pin: 'exec' } });
	const chain = (from: PinPath, ids: string[]) => {
		let tail = from;
		for (const id of ids) {
			wire(tail, id);
			tail = { node: id, pin: 'exec' };
		}
		row++;
	};
	const show = (id: string, ref: string, awaitComplete = false) =>
		add({ id, kind: 'showContainer', ref, ...(awaitComplete ? { awaitComplete: true } : {}) });
	const hide = (id: string, ref: string) => add({ id, kind: 'hideContainer', ref });
	const newMatch = (id: string) =>
		add({ id, kind: 'action', ref: 'cardsNewMatch', inputs: { deck: text('') } });

	const signals = add({ id: 'cd_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });

	// The table is up from the start, under the loading and deck-pick screens: it mounts the match
	// driver, which must be listening before the deck pick asks for a match.
	chain(pin('load'), [
		show('cd_load_show', CARD_SCREENS.loading),
		show('cd_table_boot', CARD_SCREENS.table),
	]);

	// The first of `complete:loading` / `tapToStart` starts the game; the second finds it started.
	const start = (prefix: string, from: PinPath) => {
		const once = add({
			id: `${prefix}_once`,
			kind: 'branch',
			guard: {
				all: [{ left: variable(CARD_VARIABLES.started), op: 'eq', right: bool(false) }],
			},
		});
		chain(from, [once]);
		chain({ node: once, pin: 'then' }, [
			add({
				id: `${prefix}_started`,
				kind: 'setVariable',
				variable: CARD_VARIABLES.started,
				inputs: { value: bool(true) },
			}),
			hide(`${prefix}_hide_loading`, CARD_SCREENS.loading),
			show(`${prefix}_pick`, CARD_SCREENS.deckPick, true),
			hide(`${prefix}_pick_hide`, CARD_SCREENS.deckPick),
			newMatch(`${prefix}_match`),
		]);
	};
	const completeLoading = add({
		id: 'cd_complete_loading',
		kind: 'event',
		ref: `complete:${CARD_SCREENS.loading}`,
	});
	start('cd_loaded', { node: completeLoading, pin: 'exec' });
	start('cd_tapped', pin('tapToStart'));

	chain(pin('matchReady'), [show('cd_table_show', CARD_SCREENS.table)]);

	const won = add({
		id: 'cd_won',
		kind: 'branch',
		guard: { all: [{ left: trigger('won'), op: 'eq', right: bool(true) }] },
	});
	chain(pin('matchEnded'), [won]);
	chain({ node: won, pin: 'then' }, [
		show('cd_won_show', CARD_SCREENS.won, true),
		hide('cd_won_hide', CARD_SCREENS.won),
		newMatch('cd_won_again'),
	]);
	chain({ node: won, pin: 'else' }, [
		show('cd_lost_show', CARD_SCREENS.lost, true),
		hide('cd_lost_hide', CARD_SCREENS.lost),
		newMatch('cd_lost_again'),
	]);

	return { nodes, exec, data: [] };
};

export const CARD_DRIVEN_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: CARD_TEMPLATE_ID,
	graph: buildGraph(),
	containers: CONTAINERS,
	variables: [{ id: CARD_VARIABLES.started, type: 'bool', initial: false, scope: 'game' }],
};
