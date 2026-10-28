import {
	boolSource,
	CARD_ENGINE_KEYS,
	createCardDriver,
	valueSource,
	type CardDriver,
} from 'engine-game';
import {
	cardText,
	type Action,
	type CardEvent,
	type CardInstance,
	type Match,
	type TargetRef,
} from 'engine-mechanics';
import {
	observeComponentEvents,
	registerComponentActions,
	registerComponentValues,
	registerInstanceValues,
	resolveLocalizedText,
	unregisterInstanceValues,
	resolveTransform,
	type InstanceValueSource,
	type LayoutNode,
	type LayoutType,
	type Scene,
} from 'engine-layout';
import { spawnLayerPoint, spawnStore } from 'engine-layout/svelte';
import { DEFAULT_CARD_FRAME_ID, normalizeGameConfigDoc } from 'game-config';

import { bakedGameConfig } from '../editor-scenes';
import { registerBoardEffects, registerBoardValues } from './flowBoardEffects';
import { stateCards } from './cardsState.svelte';
import { getFlowV2 } from './flowV2InterpreterHolder';

/**
 * THE CARD TABLE RUNTIME (`docs/design/card-games.md` §5) — the shared runtime's family branch for
 * a card duel against the device.
 *
 * `engine-game`'s driver runs the match (`createCardDriver` over `cards.js` and `cardAi.js`); this
 * module shows it. The four zones are the table screen's spawn layers (`hand`, `board`,
 * `enemyBoard`, `enemyHand`): each card is a spawned instance of its frame, laid out in its zone
 * from the zone's count, and fed its values (name, rules text, numbers, look flags) live through
 * `registerInstanceValues` under its instance id. The driver's signals go to the v2 flow; its
 * actions and `$engine` keys are registered for the flow to call and read.
 *
 * The player plays a card by dragging it (the frame's own P10.4 listeners: Align Target moves its
 * body, and it raises `cardDragStart` / `cardDrag` / `cardDragEnd`, observed here by instance id)
 * or by tapping it and then a target. The drop is hit-tested against the board zone and the legal
 * targets only; an illegal drop snaps back.
 *
 * A slot game never starts it: `Game.svelte` calls {@link startCards} and mounts `<CardTable />`
 * only for a mechanic that is a card table.
 */

/** The URL parameter that pins the match seed (the playtester and the screen scripts use it). */
export const CARD_SEED_PARAM = 'cdseed';

/** The zones, as spawn layer ids on the table screen. */
export const CARD_LAYERS = {
	hand: 'hand',
	board: 'board',
	enemyBoard: 'enemyBoard',
	enemyHand: 'enemyHand',
} as const;

/** The hero portraits' node ids on the table screen. */
export const CARD_HEROES = { mine: 'playerHero', enemy: 'enemyHero' } as const;

/** The placeholder frame's size; a frame is drawn centred on its origin. */
const CARD_W = 140;
const CARD_H = 196;
/** How far either side of the board layer's origin a dropped unit lands on the board. */
const BOARD_DROP = { w: 640, h: 150 };

type Layer = (typeof CARD_LAYERS)[keyof typeof CARD_LAYERS];
type Point = { x: number; y: number };

let driver: CardDriver | undefined;
const live = spawnStore();
/** Each card on the table: its instance and the values its frame reads. */
const seated = new Map<number, { id: string; layer: Layer; values: CardValues }>();
const uidOf = new Map<string, number>();
let scenes: readonly Scene[] = [];
let layoutType: LayoutType = 'desktop';
let pointer: Point | undefined;

const seedOf = (): string => {
	const pinned =
		typeof window === 'undefined'
			? null
			: new URLSearchParams(window.location.search).get(CARD_SEED_PARAM);
	return pinned || String(Math.floor(Math.random() * 2 ** 32));
};

/** A card's values as a store its frame instance subscribes to. */
class CardValues implements InstanceValueSource {
	private values: Record<string, unknown> = {};
	private runs = new Set<(values: Record<string, unknown>) => void>();
	set(next: Record<string, unknown>) {
		if (JSON.stringify(next) === JSON.stringify(this.values)) return;
		this.values = next;
		for (const run of [...this.runs]) run(next);
	}
	patch(part: Record<string, unknown>) {
		this.set({ ...this.values, ...part });
	}
	subscribe(run: (values: Record<string, unknown>) => void) {
		this.runs.add(run);
		run(this.values);
		return () => void this.runs.delete(run);
	}
}

const flag = (on: boolean) => (on ? 1 : 0);

/** What a card's frame shows. */
function valuesOf(match: Match, card: CardInstance, layer: Layer): Record<string, unknown> {
	const def = match.library[card.cardId];
	const unit = def.type === 'unit';
	const legal = driver?.actionsFor(card.uid) ?? [];
	const targetable = stateCards.picked ? legalTargetsOf(stateCards.picked).has(card.uid) : false;
	return {
		// The frame's own params first (its art, under whatever keys the frame names): the live
		// values below win over a param of the same name.
		...def.params,
		name: def.name,
		...(def.flavor ? { flavor: def.flavor } : {}),
		// Each sentence is its own localization key (the "Cards" harvest), so each is translated
		// before they are joined.
		rulesText: cardText(def, Object.values(match.library)).map(resolveLocalizedText).join(' '),
		cost: def.cost,
		attack: card.attack,
		health: Math.max(0, card.health - card.damage),
		isUnit: flag(unit),
		inHand: flag(layer === CARD_LAYERS.hand),
		onBoard: flag(layer === CARD_LAYERS.board || layer === CARD_LAYERS.enemyBoard),
		faceDown: flag(layer === CARD_LAYERS.enemyHand),
		playable: flag(layer === CARD_LAYERS.hand && legal.some((a) => a.type === 'play')),
		ready: flag(layer === CARD_LAYERS.board && legal.some((a) => a.type === 'attack')),
		targetable: flag(targetable),
		damaged: flag(card.damage > 0),
		buffed: flag(unit && (card.attack > (def.attack ?? 0) || card.health > (def.health ?? 0))),
		debuffed: flag(unit && (card.attack < (def.attack ?? 0) || card.health < (def.health ?? 0))),
		guard: flag(card.keywords.includes('guard')),
		shield: flag(card.keywords.includes('shield')),
		swift: flag(card.keywords.includes('swift')),
		dragging: flag(stateCards.picked === card.uid),
		hint: flag(stateCards.hint === card.uid),
	};
}

/** Where the `i`th of `n` cards sits in its zone, in the zone's space. */
function slotX(layer: Layer, i: number, n: number): number {
	const room = layer === CARD_LAYERS.enemyHand ? 700 : layer === CARD_LAYERS.hand ? 1100 : 1200;
	const gap = layer === CARD_LAYERS.enemyHand ? 90 : CARD_W + 16;
	const pitch = n > 1 ? Math.min(gap, room / (n - 1)) : 0;
	return (i - (n - 1) / 2) * pitch;
}

const zonesOf = (match: Match): [Layer, CardInstance[]][] => [
	[CARD_LAYERS.hand, match.players[0].hand],
	[CARD_LAYERS.board, match.players[0].board],
	[CARD_LAYERS.enemyBoard, match.players[1].board],
	[CARD_LAYERS.enemyHand, match.players[1].hand],
];

function unseat(uid: number) {
	const card = seated.get(uid);
	if (!card) return;
	live.despawn(card.id);
	unregisterInstanceValues(card.id);
	// A card gone mid-drag never ends its drag.
	if (stray === uid) stray = 0;
	uidOf.delete(card.id);
	seated.delete(uid);
}

/** Put the match on the table: spawn, move and despawn cards, feed their values. */
function seat(match: Match, respawn?: number) {
	if (respawn) unseat(respawn);
	const present = new Set<number>();
	for (const [layer, cards] of zonesOf(match)) {
		const moves: { id: string; x: number; y: number }[] = [];
		cards.forEach((card, i) => {
			present.add(card.uid);
			const x = slotX(layer, i, cards.length);
			let at = seated.get(card.uid);
			if (at && at.layer !== layer) {
				unseat(card.uid);
				at = undefined;
			}
			if (!at) {
				const frame = match.library[card.cardId].frame?.trim() || DEFAULT_CARD_FRAME_ID;
				const values = new CardValues();
				values.set(valuesOf(match, card, layer));
				const result = live.spawn(layer, frame, { x, y: 0 });
				if (!result.ok) return;
				// Registered before the instance mounts (the layer redraws after this tick), so its
				// frame reads the values from its first paint.
				registerInstanceValues({ [result.instance.id]: values });
				seated.set(card.uid, { id: result.instance.id, layer, values });
				uidOf.set(result.instance.id, card.uid);
				return;
			}
			at.values.set(valuesOf(match, card, layer));
			moves.push({ id: at.id, x, y: 0 });
		});
		if (moves.length) live.move(moves);
	}
	for (const uid of [...seated.keys()]) if (!present.has(uid)) unseat(uid);
}

/** Re-read every card's values (a pick or a hint changed what lights). */
function relight() {
	const match = driver?.session?.match;
	if (!match) return;
	for (const [layer, cards] of zonesOf(match))
		for (const card of cards) seated.get(card.uid)?.values.set(valuesOf(match, card, layer));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The units and heroes the picked card's legal actions aim at (heroes as -1 mine, -2 enemy). */
function legalTargetsOf(uid: number): Set<number> {
	const targets = new Set<number>();
	for (const action of driver?.actionsFor(uid) ?? []) {
		const target = action.type === 'play' || action.type === 'attack' ? action.target : undefined;
		if (!target) continue;
		targets.add('unit' in target ? target.unit : target.hero === 0 ? -1 : -2);
	}
	return targets;
}

/** A top-level node of the table screen, by id. */
function tableNode(id: string): LayoutNode | undefined {
	for (const scene of scenes) {
		const node = (scene.nodes ?? []).find((n) => n.id === id);
		if (node) return node;
	}
	return undefined;
}

/** Is the canvas point `at` on hero `id`'s portrait? Read in the board layer's space: both are
 *  top-level nodes of one screen, so their offset is their positions' difference. */
function onHero(id: string, at: Point): boolean {
	const hero = tableNode(id);
	const board = tableNode(CARD_LAYERS.board);
	const local = spawnLayerPoint(CARD_LAYERS.board, at.x, at.y);
	if (!hero || !board || !local) return false;
	const h = resolveTransform(hero, layoutType);
	const b = resolveTransform(board, layoutType);
	const w = (h.width ?? 200) * Math.abs(h.scale?.x ?? 1);
	const ht = (h.height ?? 200) * Math.abs(h.scale?.y ?? 1);
	const dx = local.x - (h.x - b.x);
	const dy = local.y - (h.y - b.y);
	return Math.abs(dx) <= w / 2 && Math.abs(dy) <= ht / 2;
}

/** The unit under the canvas point `at`, by uid. */
function unitAt(at: Point): number | undefined {
	for (const layer of [CARD_LAYERS.enemyBoard, CARD_LAYERS.board]) {
		const local = spawnLayerPoint(layer, at.x, at.y);
		if (!local) continue;
		for (const instance of live.live(layer)) {
			if (
				Math.abs(local.x - instance.x) <= CARD_W / 2 &&
				Math.abs(local.y - instance.y) <= CARD_H / 2
			)
				return uidOf.get(instance.id);
		}
	}
	return undefined;
}

const sameTarget = (a: TargetRef | undefined, b: TargetRef) =>
	JSON.stringify(a) === JSON.stringify(b);

/** The legal action of `uid` a release at the canvas point `at` asks for, if any. */
export function actionAt(uid: number, at: Point): Action | undefined {
	const actions = driver?.actionsFor(uid) ?? [];
	const unit = unitAt(at);
	const target: TargetRef | undefined =
		unit !== undefined
			? { unit }
			: onHero(CARD_HEROES.enemy, at)
				? { hero: 1 }
				: onHero(CARD_HEROES.mine, at)
					? { hero: 0 }
					: undefined;
	if (target) {
		const aimed = actions.find(
			(a) => (a.type === 'play' || a.type === 'attack') && sameTarget(a.target, target),
		);
		if (aimed) return aimed;
	}
	const plain = actions.find((a) => a.type === 'play' && !a.target);
	const local = spawnLayerPoint(CARD_LAYERS.board, at.x, at.y);
	if (!plain || !local) return undefined;
	if (Math.abs(local.x) > BOARD_DROP.w || Math.abs(local.y) > BOARD_DROP.h) return undefined;
	const board = live.live(CARD_LAYERS.board);
	return { type: 'play', uid, slot: board.filter((i) => i.x < local.x).length };
}

/** Release the picked card at `at`: play the action it asks for, or snap the card back. */
async function release(uid: number, at: Point | undefined) {
	const action = at ? actionAt(uid, at) : undefined;
	stateCards.picked = 0;
	const played = action ? await driver?.act(action) : false;
	if (!played) {
		const match = driver?.session?.match;
		if (match) seat(match, uid);
	}
	relight();
}

/** A drag is under way: the canvas release that ends it is not a tap. */
let dragging = false;
/** A card dragged that may not move now: its frame's body still follows the pointer, so its
 *  release puts it back, and plays nothing. */
let stray = 0;
/** When the last drag ended: the click a release may also raise is not a tap. */
let draggedAt = 0;

function onCardEvent(instanceId: string, event: string) {
	const uid = uidOf.get(instanceId);
	if (uid === undefined || !driver) return;
	if (event === 'cardDragStart') {
		if (!driver.actionsFor(uid).length) {
			stray = uid;
			return;
		}
		stray = 0;
		dragging = true;
		stateCards.picked = uid;
		relight();
	} else if (event === 'cardDragEnd' && stray === uid) {
		stray = 0;
		draggedAt = Date.now();
		const match = driver.session?.match;
		if (match) seat(match, uid);
	} else if (event === 'cardDragEnd' && dragging) {
		dragging = false;
		draggedAt = Date.now();
		void release(stateCards.picked, pointer);
	} else if (event === 'cardTap' && Date.now() - draggedAt > 250) {
		const picked = stateCards.picked;
		if (picked && picked !== uid) {
			void release(picked, pointer);
			return;
		}
		stateCards.picked = picked === uid || !driver.actionsFor(uid).length ? 0 : uid;
		relight();
	}
}

/** A tap on the table with a card picked: on a hero or the board, it is the card's release. */
export function tapTable(at: Point) {
	pointer = at;
	const picked = stateCards.picked;
	if (!picked || dragging || stray || Date.now() - draggedAt < 250 || unitAt(at) !== undefined)
		return;
	void release(picked, at);
}

/** The canvas pointer, in global px, as the table last saw it. */
export const notePointer = (at: Point) => {
	pointer = at;
};

/** The table for the determinism probe (the playtester): the numbers and every seated card. */
export const cardsProbe = () => {
	const match = driver?.session?.match;
	const cards = [...seated].map(([uid, at]) => {
		const instance = live.get(at.id);
		return {
			uid,
			cardId: match ? cardIdIn(match, uid) : '',
			zone: at.layer,
			id: at.id,
			x: instance?.x ?? 0,
			y: instance?.y ?? 0,
		};
	});
	const { seed, mine, phase, turn, myHealth, enemyHealth, over, won } = stateCards;
	return { seed, mine, phase, turn, myHealth, enemyHealth, over, won, cards };
};

const cardIdIn = (match: Match, uid: number): string => {
	for (const [, cards] of zonesOf(match)) {
		const card = cards.find((c) => c.uid === uid);
		if (card) return card.cardId;
	}
	return '';
};

/** The layout's screens, for the heroes' places. */
export const useCardScenes = (next: readonly Scene[], type: LayoutType) => {
	scenes = next;
	layoutType = type;
};

const present = {
	sync: (match: Match) => seat(match),
	async event(event: CardEvent) {
		if (event.type === 'attacked') {
			seated.get(event.attacker)?.values.patch({ attacking: 1 });
			await wait(260);
			seated.get(event.attacker)?.values.patch({ attacking: 0 });
		} else if (event.type === 'died') {
			seated.get(event.uid)?.values.patch({ dying: 1 });
			await wait(220);
		}
	},
	wait,
	idle: relight,
};

/** With no flow to ask for one, the table deals the first match itself once it is up. */
export function startFirstMatch() {
	if (driver && !driver.session && !getFlowV2()) void driver.newMatch();
}

/**
 * Start the match driver and register what the layout reads: the flow's actions and `$engine`
 * keys, the HUD's `cards.*` value sources and the End Turn button's action. Called from
 * `Game.svelte`'s init for a card table only, BEFORE the layout mounts — a readout or a button
 * looks its source up once, when it mounts.
 */
export function startCards(): () => void {
	const doc = normalizeGameConfigDoc(bakedGameConfig());
	if (!doc) throw new Error('cards: the game has no config');
	if (!driver) {
		stateCards.seed = seedOf();
		driver = createCardDriver({
			doc,
			seed: stateCards.seed,
			state: stateCards,
			signal: async (name, payload) => {
				await getFlowV2()?.dispatch(name, payload);
			},
			present,
		});
	}
	const d = driver;
	registerBoardEffects({
		cardsEndPhase: () => void d.flowAct({ type: 'endPhase' }),
		cardsConcede: () => void d.flowAct({ type: 'concede' }),
		cardsNewMatch: (payload) =>
			void d.newMatch(typeof payload.deck === 'string' ? payload.deck : ''),
		cardsSetInput: (payload) => d.setInput(payload.enabled === true),
		cardsHint: () => {
			d.hint();
			relight();
		},
	});
	// The table's End Turn button runs its `action` param itself, not through the flow.
	registerComponentActions({
		cardsEndPhase: {
			onpress: () => void d.endPhase(),
			disabled: boolSource(() => !stateCards.mine || stateCards.busy || stateCards.over),
		},
	});
	const keys = new Set<string>(CARD_ENGINE_KEYS);
	registerBoardValues((key) =>
		keys.has(key) ? stateCards[key as (typeof CARD_ENGINE_KEYS)[number]] : undefined,
	);
	const unregisterValues = registerComponentValues(
		Object.fromEntries(
			CARD_ENGINE_KEYS.filter((key) => key !== 'phase').map((key) => [
				`cards.${key}`,
				valueSource(() => stateCards[key] as number),
			]),
		),
	);
	const unobserve = observeComponentEvents((raised) =>
		onCardEvent(raised.instanceId, raised.event),
	);
	return () => {
		unobserve();
		unregisterValues();
	};
}
