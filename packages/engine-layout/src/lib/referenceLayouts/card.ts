import type { ParamDecl } from 'engine-flow-v2';

import { TAP_DIM_ALPHA_PARAM, TAP_TO_CONTINUE_PARAM } from '../tapToContinue';
import type {
	ComponentDef,
	ComponentInput,
	LayoutDoc,
	LayoutNode,
	NodeListener,
	Scene,
	TextNode,
	ValueBinding,
} from '../types';

/**
 * The CARD scene set (`docs/design/card-games.md` §9.2, C3) — what "New game from kind" scaffolds for
 * a card project, and what puts `card` in Game Maker's kind list. Its starter flow is
 * `engine-flow-v2` `CARD_DRIVEN_SEED_DOC`; the match itself is the runtime's card table.
 *
 *   - `loading` — the loading bar; its tap completes the screen and starts the game;
 *   - `background` — the coded background;
 *   - `cardDeckPick` — a tap-to-continue that starts a match with the first player deck;
 *   - `basegame` (the table) — the four zones as top-level spawn layers (`enemyHand`, `enemyBoard`, `board`,
 *     `hand`; the table lays the cards out in each), the two hero portraits (`enemyHero`,
 *     `playerHero`), the health, resource and deck readouts and the End Turn button;
 *   - `cardWon` / `cardLost` — a dimmed tap-to-continue with its line; the flow holds on the tap.
 *
 * Every screen sits in one 1920 × 1080 box, scaled uniformly per layout type.
 */

const SIZE = { width: 1920, height: 1080 };
const MAIN_SIZES_MAP: LayoutDoc['mainSizesMap'] = {
	desktop: SIZE,
	tablet: SIZE,
	landscape: SIZE,
	portrait: SIZE,
};

/** The table's zones: spawn layers, centred on x, each row of cards laid out by the table. */
export const CARD_ZONES = {
	enemyHand: { x: 960, y: 90 },
	enemyBoard: { x: 960, y: 360 },
	board: { x: 960, y: 640 },
	hand: { x: 960, y: 950 },
} as const;

/** The hero portraits: containers whose x / y is the portrait's CENTRE, `size` px square. */
export const CARD_HEROES = {
	enemyHero: { x: 200, y: 250 },
	playerHero: { x: 200, y: 830 },
	size: 200,
} as const;

/** Cards a zone may hold at once (the hand limit and the board limit stay under it). */
const ZONE_CAP = 12;

/** The placeholder card frame's id: the frame a card that names none is drawn in. */
export const CARD_FRAME_ID = 'cardFrame';

/** The card frame's size; it is drawn centred on the instance's origin. */
export const CARD_FRAME_SIZE = { width: 140, height: 196 } as const;

const W = CARD_FRAME_SIZE.width;
const H = CARD_FRAME_SIZE.height;

/** The frame's number params that switch its looks, 0 or 1. */
const LOOK_PARAMS = [
	'isUnit',
	'faceDown',
	'playable',
	'ready',
	'targetable',
	'damaged',
	'buffed',
	'guard',
	'shield',
	'swift',
	'dragging',
] as const;

/** The interface an authored frame's state machine reads (§6). */
const FRAME_INPUTS: ComponentInput[] = [
	...(['name', 'rulesText', 'flavor'] as const).map((id) => ({ id, kind: 'text' as const })),
	...(['cost', 'attack', 'health'] as const).map((id) => ({ id, kind: 'number' as const })),
	...(
		[
			'damaged',
			'buffed',
			'debuffed',
			'guard',
			'shield',
			'swift',
			'faceDown',
			'inHand',
			'onBoard',
			'playable',
			'ready',
			'targetable',
			'attacking',
			'dying',
		] as const
	).map((id) => ({ id, kind: 'bool' as const })),
	...(['hit', 'healed', 'summoned'] as const).map((id) => ({ id, kind: 'trigger' as const })),
];

/** The node the card's art and text sit in: what a drag moves (Align Target), not the instance. */
export const CARD_FRAME_BODY = 'cardFrame-body';

const POINTER_PAYLOAD: ParamDecl[] = [
	{ name: 'x', type: { t: 'float' } },
	{ name: 'y', type: { t: 'float' } },
];

const AT_POINTER = { x: { pointer: 'x' }, y: { pointer: 'y' } } as const;

/** The hit surface's listeners: a tap, and a drag the body follows (P10.4), each raised as an event
 *  the runtime observes by instance id. */
const CARD_FRAME_LISTENERS: NodeListener[] = [
	{ id: 'tap', event: 'click', action: { kind: 'raise', event: 'cardTap' } },
	{
		id: 'dragStart',
		event: 'dragStart',
		action: { kind: 'raise', event: 'cardDragStart', payload: AT_POINTER },
	},
	{
		id: 'dragFollow',
		event: 'drag',
		action: { kind: 'align', target: CARD_FRAME_BODY, preserveOffset: true },
	},
	{ id: 'drag', event: 'drag', action: { kind: 'raise', event: 'cardDrag', payload: AT_POINTER } },
	{
		id: 'dragEnd',
		event: 'dragEnd',
		action: { kind: 'raise', event: 'cardDragEnd', payload: AT_POINTER },
	},
];

const shown = (param: string, below = false): ValueBinding => ({
	target: 'visible',
	param,
	...(below ? { below: true } : {}),
});

const rect = (
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	color: number,
	extra: Partial<LayoutNode> = {},
): LayoutNode =>
	({
		id,
		kind: 'rect',
		x,
		y,
		// `x, y` is the top-left corner: a rect's default anchor is its centre.
		anchor: { x: 0, y: 0 },
		width,
		height,
		color,
		borderRadius: 10,
		...extra,
	}) as LayoutNode;

const label = (
	id: string,
	x: number,
	y: number,
	text: string,
	fontSize: number,
	bind?: string,
	extra: Partial<TextNode> = {},
): LayoutNode => ({
	id,
	kind: 'text',
	x,
	y,
	anchor: { x: 0.5, y: 0.5 },
	text,
	style: { fontSize, fill: 0xffffff, fontWeight: 'bold', align: 'center' },
	...(bind ? { paramBindings: { text: bind } } : {}),
	...extra,
});

/** A number badge: a disc with the bound value, shown only for a unit when `unitOnly`. */
const badge = (
	key: string,
	x: number,
	y: number,
	color: number,
	unitOnly: boolean,
): LayoutNode => ({
	id: `cardFrame-${key}`,
	kind: 'container',
	x,
	y,
	...(unitOnly ? { valueBindings: [shown('isUnit')] } : {}),
	children: [
		rect(`cardFrame-${key}-disc`, -18, -18, 36, 36, color, { borderRadius: 18 }),
		label(`cardFrame-${key}-value`, 0, 0, '0', 20, key),
	],
});

/** A keyword marker along the art's lower edge, shown while its param is 1. */
const keywordTag = (key: string, text: string, x: number): LayoutNode => ({
	id: `cardFrame-${key}`,
	kind: 'container',
	x,
	y: -6,
	valueBindings: [shown(key)],
	children: [
		rect(`cardFrame-${key}-bg`, -20, -9, 40, 18, 0x22303c, { borderRadius: 6 }),
		label(`cardFrame-${key}-text`, 0, 0, text, 11),
	],
});

/**
 * The placeholder card frame (§6's default frame): our own flat look, no art required. Every live
 * value is an `engineProvided` param the runtime feeds per spawned card; the looks follow the 0 / 1
 * params through value bindings. The §6 inputs are declared so an authored frame's state machine
 * has the same interface.
 */
export const CARD_FRAME_PLACEHOLDER_DEF: ComponentDef = {
	id: CARD_FRAME_ID,
	name: 'Card frame (placeholder)',
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [
		{ key: 'name', kind: 'string', default: 'Card name', engineProvided: true },
		{ key: 'rulesText', kind: 'string', default: '', engineProvided: true },
		{ key: 'cost', kind: 'number', default: 1, engineProvided: true },
		{ key: 'attack', kind: 'number', default: 1, engineProvided: true },
		{ key: 'health', kind: 'number', default: 1, engineProvided: true },
		{ key: 'art', kind: 'image', engineProvided: true },
		...LOOK_PARAMS.map((key) => ({
			key,
			kind: 'number' as const,
			default: key === 'isUnit' ? 1 : 0,
			engineProvided: true,
		})),
	],
	inputs: FRAME_INPUTS,
	events: [
		{ id: 'cardTap' },
		...(['cardDragStart', 'cardDrag', 'cardDragEnd'] as const).map((id) => ({
			id,
			payload: POINTER_PAYLOAD,
		})),
	],
	root: {
		id: 'cardFrame-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: CARD_FRAME_BODY,
				kind: 'container',
				x: 0,
				y: 0,
				valueBindings: [
					{ target: 'scale', param: 'dragging', inMin: 0, inMax: 1, outMin: 1, outMax: 1.08 },
				],
				children: [
					// The looks behind the card, in a container of their own: a node a value binding
					// shows is drawn over its unbound siblings, so the glows stay under the face.
					{
						id: 'cardFrame-looks',
						kind: 'container',
						x: 0,
						y: 0,
						children: [
							rect('cardFrame-glow', -W / 2 - 6, -H / 2 - 6, W + 12, H + 12, 0x5ce07a, {
								borderRadius: 14,
								valueBindings: [shown('playable')],
							}),
							rect('cardFrame-ready', -W / 2 - 6, -H / 2 - 6, W + 12, H + 12, 0xf2c94c, {
								borderRadius: 14,
								valueBindings: [shown('ready')],
							}),
							rect('cardFrame-target', -W / 2 - 8, -H / 2 - 8, W + 16, H + 16, 0xe2504c, {
								borderRadius: 16,
								valueBindings: [shown('targetable')],
							}),
						],
					},
					rect('cardFrame-face', -W / 2, -H / 2, W, H, 0x2c3e50, {
						borderWidth: 3,
						borderColor: 0x9fb3c8,
					}),
					rect('cardFrame-artBox', -W / 2 + 10, -H / 2 + 34, W - 20, 74, 0x41566b, {
						borderRadius: 6,
					}),
					{
						id: 'cardFrame-art',
						kind: 'sprite',
						x: 0,
						y: -H / 2 + 71,
						anchor: { x: 0.5, y: 0.5 },
						assetKey: '',
						width: W - 20,
						height: 74,
						paramBindings: { region: 'art' },
					},
					label('cardFrame-name', 0, -H / 2 + 20, 'Card name', 14, 'name', {
						width: W - 44,
						autoFit: true,
					}),
					label('cardFrame-rules', 0, 28, '', 11, 'rulesText', {
						width: W - 16,
						height: 60,
						style: {
							fontSize: 11,
							fill: 0xe8eef4,
							align: 'center',
							verticalAlign: 'middle',
							wordWrap: true,
							wordWrapWidth: W - 16,
						},
					}),
					keywordTag('guard', 'GUARD', -40),
					keywordTag('shield', 'SHIELD', 0),
					keywordTag('swift', 'SWIFT', 40),
					badge('cost', -W / 2 + 14, -H / 2 + 14, 0x2f80ed, false),
					badge('attack', -W / 2 + 16, H / 2 - 16, 0xd9822b, true),
					badge('health', W / 2 - 16, H / 2 - 16, 0xc0392b, true),
					rect('cardFrame-damaged', W / 2 - 34, H / 2 - 34, 36, 36, 0xff3b30, {
						borderRadius: 18,
						alpha: 0.45,
						valueBindings: [shown('damaged')],
					}),
					rect('cardFrame-buffed', W / 2 - 34, H / 2 - 34, 36, 36, 0x34c759, {
						borderRadius: 18,
						alpha: 0.45,
						valueBindings: [shown('buffed')],
					}),
					{
						id: 'cardFrame-back',
						kind: 'container',
						x: 0,
						y: 0,
						valueBindings: [shown('faceDown')],
						children: [
							rect('cardFrame-back-body', -W / 2, -H / 2, W, H, 0x4b2c5e, {
								borderWidth: 3,
								borderColor: 0xc9a7e0,
							}),
							rect('cardFrame-back-mark', -24, -24, 48, 48, 0xc9a7e0, { borderRadius: 24 }),
						],
					},
				],
			},
			rect('cardFrame-hit', -W / 2, -H / 2, W, H, 0x000000, {
				borderRadius: 0,
				// Near-zero, not zero: the hit surface must stay hit-testable.
				alpha: 0.001,
				on: CARD_FRAME_LISTENERS,
			}),
		],
	},
};

const textBox = (
	id: string,
	text: string,
	x: number,
	y: number,
	params: Record<string, unknown> = {},
): LayoutNode => ({
	id,
	label: text,
	kind: 'componentInstance',
	componentId: 'textBox',
	x,
	y,
	params: { text, fontSize: 28, ...params },
});

/** A readout: its caption and its live value, fed by the card runtime's value source. */
const readout = (
	id: string,
	caption: string,
	source: string,
	x: number,
	y: number,
): LayoutNode[] => [
	textBox(`card-${id}-caption`, caption, x, y, { fontSize: 22 }),
	textBox(`card-${id}-value`, '0', x, y + 30, { source, fontSize: 40 }),
];

/** A hero portrait: a container centred on (x, y) with a square face. */
const hero = (id: 'enemyHero' | 'playerHero', color: number): LayoutNode => {
	const { size } = CARD_HEROES;
	const { x, y } = CARD_HEROES[id];
	return {
		id,
		label: id === 'enemyHero' ? 'Enemy hero' : 'Player hero',
		kind: 'container',
		x,
		y,
		width: size,
		height: size,
		children: [
			rect(`${id}-face`, -size / 2, -size / 2, size, size, color, {
				borderRadius: size / 2,
				borderWidth: 4,
				borderColor: 0xffffff,
			}),
		],
	};
};

const zone = (id: keyof typeof CARD_ZONES, label: string): LayoutNode => ({
	id,
	label,
	kind: 'spawnLayer',
	x: CARD_ZONES[id].x,
	y: CARD_ZONES[id].y,
	spawnable: [CARD_FRAME_ID],
	placement: 'free',
	cap: ZONE_CAP,
});

function resultScreen(id: string, name: string, line: string): Scene {
	return {
		id,
		name,
		space: 'canvas',
		alwaysOnTop: true,
		nodes: [
			{
				id: `${id}-tap`,
				label: 'Tap to continue',
				kind: 'componentInstance',
				componentId: 'tapToContinue',
				x: 0,
				y: 0,
				params: { [TAP_TO_CONTINUE_PARAM]: true, [TAP_DIM_ALPHA_PARAM]: 0.6 },
			},
			{
				...textBox(`${id}-text`, line, 0, 0, { fontSize: 64, boxWidth: 1200, align: 'center' }),
				screenAnchor: { x: 0.5, y: 0.5 },
			},
		],
	};
}

export function cardReferenceLayout(): LayoutDoc {
	return {
		version: 1,
		projectKey: 'card',
		gameType: 'card',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			{
				id: 'loading',
				name: 'Loading / logo',
				role: 'loading',
				space: 'canvas',
				nodes: [
					{
						id: 'loading-bar',
						slotId: 'loadingScreen',
						label: 'Loading bar',
						kind: 'componentInstance',
						componentId: 'loadingBar',
						x: 0,
						y: 0,
					},
				],
			},
			{
				id: 'background',
				name: 'Background',
				space: 'canvas',
				nodes: [
					{
						id: 'bg',
						slotId: 'background',
						label: 'Background',
						kind: 'container',
						x: 0,
						y: 0,
						zIndex: -10,
						bind: { component: 'Background' },
						children: [],
					},
				],
			},
			{
				id: 'basegame',
				name: 'Table',
				role: 'basegame',
				nodes: [
					hero('enemyHero', 0x8e3b46),
					hero('playerHero', 0x2f6f8f),
					zone('enemyHand', 'Enemy hand'),
					zone('enemyBoard', 'Enemy board'),
					zone('board', 'Your board'),
					zone('hand', 'Your hand'),
					...readout('enemyHealth', 'ENEMY', 'cards.enemyHealth', 340, 200),
					...readout('enemyDeck', 'ENEMY DECK', 'cards.enemyDeckCount', 1660, 120),
					...readout('myHealth', 'HEALTH', 'cards.myHealth', 340, 780),
					...readout('resource', 'RESOURCE', 'cards.resource', 1660, 760),
					...readout('resourceMax', 'MAX', 'cards.resourceMax', 1800, 760),
					...readout('deck', 'DECK', 'cards.deckCount', 1660, 880),
					...readout('turn', 'TURN', 'cards.turn', 1660, 440),
					{
						id: 'card-endTurn',
						label: 'End turn',
						kind: 'componentInstance',
						componentId: 'button',
						x: 1760,
						y: 560,
						anchor: { x: 0.5, y: 0.5 },
						params: { action: 'cardsEndPhase', label: 'END TURN' },
					},
				],
			},
			{
				id: 'cardDeckPick',
				name: 'Deck pick',
				space: 'canvas',
				alwaysOnTop: true,
				nodes: [
					{
						id: 'cardDeckPick-tap',
						label: 'Tap to play',
						kind: 'componentInstance',
						componentId: 'tapToContinue',
						x: 0,
						y: 0,
						params: { [TAP_TO_CONTINUE_PARAM]: true, [TAP_DIM_ALPHA_PARAM]: 0.6 },
					},
					{
						...textBox('cardDeckPick-text', 'Tap to play your deck', 0, 0, {
							fontSize: 64,
							boxWidth: 1200,
							align: 'center',
						}),
						screenAnchor: { x: 0.5, y: 0.5 },
					},
				],
			},
			resultScreen('cardWon', 'Match won', 'VICTORY! Tap to play again'),
			resultScreen('cardLost', 'Match lost', 'DEFEAT. Tap to play again'),
		],
		updatedAt: '2026-10-27T00:00:00.000Z',
	};
}
