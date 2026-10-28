import {
	CARD_INCLUDES,
	CARD_KEYWORDS,
	CARD_MAX_EFFECTS,
	CARD_RANGES,
	CARD_SIDES,
	CARD_TARGET_KINDS,
	CARD_TRIGGERS,
	CARD_UNTILS,
	CARD_VERBS,
	CARD_VERB_TARGETS,
	cardText,
	validateLibrary,
	type AiDifficulty,
	type AiWeights,
	type CardDef,
	type CardEffect,
	type Include,
	type Keyword,
	type Target,
	type Trigger,
} from 'engine-mechanics';
import {
	CARD_FRAME_PLACEHOLDER_DEF,
	componentInputs,
	type ComponentDef,
	type LayoutNode,
} from 'engine-layout';
import {
	DEFAULT_CARD_FRAME_ID,
	cardLibraryOf,
	resolveCardRules,
	type CardBlock,
	type CardGameDeck,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';

/**
 * How Invisible Card Library (`/cards`, `docs/design/card-games.md` §8) edits a card game's
 * `GameConfigDoc.card`. Every edit writes what `normalizeGameConfigDoc` would store (sparse: an
 * empty list or a blank optional field is DELETED), so the page never looks dirty for a value a
 * save would drop. `check:cards-tool` runs each edit and re-normalizes.
 *
 * The effect form offers only the closed lists of §3 and only the choices the validator allows for
 * the choices already made ({@link triggerChoices} → {@link verbChoices} → {@link targetChoices}), and
 * every setter repairs the effect to a valid one ({@link fitEffect}), so an invalid effect cannot be
 * built. The lists and ranges are `cards.js`'s own exports, so the form and the validator are one
 * source.
 */

export type Verb = CardEffect['verb'];
export type TargetKind = Target['kind'];
export type CardNumber = 'cost' | 'attack' | 'health';

const MAX_DECKS_PER_SIDE = 8;

const block = (doc: GameConfigDoc): CardBlock => (doc.card ??= {});
const library = (doc: GameConfigDoc): CardDef[] => (block(doc).library ??= []);
const decks = (doc: GameConfigDoc): CardGameDeck[] => (block(doc).decks ??= []);

/** Drop the empty lists and the block itself when it holds nothing, as the normalizer does. */
function tidy(doc: GameConfigDoc): void {
	const card = doc.card;
	if (!card) return;
	if (card.library && !card.library.length) delete card.library;
	if (card.decks && !card.decks.length) delete card.decks;
	if (!Object.keys(card).length) delete doc.card;
}

const findCard = (doc: GameConfigDoc, id: string): CardDef | undefined =>
	doc.card?.library?.find((c) => c.id === id);
const findDeck = (doc: GameConfigDoc, id: string): CardGameDeck | undefined =>
	doc.card?.decks?.find((d) => d.id === id);

/** A whole number clamped into `range`; `undefined` for text that is not a number. */
export function clampTo(
	value: string | number,
	range: readonly [number, number],
): number | undefined {
	const n = typeof value === 'number' ? value : Number(String(value).trim());
	if (String(value).trim() === '' || !Number.isFinite(n)) return undefined;
	return Math.min(range[1], Math.max(range[0], Math.round(n)));
}

const freeId = (taken: Iterable<string>, base: string): string => {
	const used = new Set(taken);
	if (!used.has(base)) return base;
	let n = 2;
	while (used.has(`${base}-${n}`)) n++;
	return `${base}-${n}`;
};

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// --- The effect form ---------------------------------------------------------------------------

/** Triggers a card may use: a spell's effects are all `onPlay` (§3.4). */
export const triggerChoices = (card: Pick<CardDef, 'type'>): Trigger[] =>
	card.type === 'spell' ? ['onPlay'] : [...CARD_TRIGGERS];

/** Every verb fits every trigger; a `summon` needs a unit in the library to summon. */
export const verbChoices = (lib: readonly CardDef[]): Verb[] =>
	CARD_VERBS.filter((verb) => verb !== 'summon' || lib.some((c) => c.type === 'unit'));

/** Target kinds for a verb on a card under a trigger: none for a verb that aims at nothing, `self`
 *  only on a unit, `chosen` only on `onPlay` (§3.3). */
export function targetChoices(
	card: Pick<CardDef, 'type'>,
	trigger: Trigger,
	verb: Verb,
): TargetKind[] {
	if (CARD_VERB_TARGETS[verb] === 'none') return [];
	return CARD_TARGET_KINDS.filter(
		(kind) =>
			(kind !== 'self' || card.type === 'unit') && (kind !== 'chosen' || trigger === 'onPlay'),
	);
}

/** What a verb's target may include: `characters` (units and the hero) only for an `any` verb. */
export const includeChoices = (verb: Verb): Include[] =>
	CARD_VERB_TARGETS[verb] === 'any' ? [...CARD_INCLUDES] : ['units'];

export const sideChoices = (): ('enemy' | 'friendly' | 'any')[] => [...CARD_SIDES];
export const keywordChoices = (): Keyword[] => [...CARD_KEYWORDS];

/** The units a `summon` may name: every unit in the library. */
export const summonChoices = (lib: readonly CardDef[]): CardDef[] =>
	lib.filter((c) => c.type === 'unit');

/** The effect's target repaired for its verb, trigger and card; `undefined` for a verb with none. */
function fitTarget(
	card: Pick<CardDef, 'type'>,
	trigger: Trigger,
	verb: Verb,
	target: unknown,
): Target | undefined {
	const kinds = targetChoices(card, trigger, verb);
	if (!kinds.length) return undefined;
	const t = (target ?? {}) as Partial<Target> & { side?: string; include?: string };
	const kind = kinds.includes(t.kind as TargetKind)
		? (t.kind as TargetKind)
		: kinds.includes('chosen')
			? 'chosen'
			: kinds[kinds.length - 1];
	if (kind === 'self') return { kind };
	const includes = includeChoices(verb);
	const include = includes.includes(t.include as Include) ? (t.include as Include) : 'units';
	if (kind === 'chosen') {
		const side = CARD_SIDES.includes(t.side as 'enemy')
			? (t.side as 'enemy' | 'friendly' | 'any')
			: 'enemy';
		return { kind, side, include };
	}
	return { kind, include };
}

/**
 * An effect made valid for `card`: its trigger from {@link triggerChoices}, the verb's own fields
 * (clamped into their ranges, defaulted when missing) and no others, and a target from
 * {@link targetChoices}. The form calls it after every change, so what it holds always validates.
 */
export function fitEffect(
	card: Pick<CardDef, 'type'>,
	raw: Partial<CardEffect> & Record<string, unknown>,
	lib: readonly CardDef[],
): CardEffect {
	const triggers = triggerChoices(card);
	const trigger = triggers.includes(raw.trigger as Trigger)
		? (raw.trigger as Trigger)
		: triggers[0];
	const verbs = verbChoices(lib);
	const verb = verbs.includes(raw.verb as Verb) ? (raw.verb as Verb) : 'damage';
	const num = (key: string, range: readonly [number, number], fallback: number): number =>
		clampTo(raw[key] as number, range) ?? fallback;
	const target = fitTarget(card, trigger, verb, raw.target);
	switch (verb) {
		case 'damage':
		case 'heal':
			return {
				trigger,
				verb,
				amount: num('amount', CARD_RANGES[verb], 1),
				target: target as Target,
			};
		case 'draw':
			return { trigger, verb, amount: num('amount', CARD_RANGES.draw, 1) };
		case 'summon': {
			const units = summonChoices(lib);
			const named = units.find((u) => u.id === raw.card) ?? units.find((u) => u.token) ?? units[0];
			const count = num('count', CARD_RANGES.count, 1);
			return { trigger, verb, card: named?.id ?? '', ...(count > 1 ? { count } : {}) };
		}
		case 'buff':
			return {
				trigger,
				verb,
				attack: num('attack', CARD_RANGES.buff, 1),
				health: num('health', CARD_RANGES.buff, 1),
				until: CARD_UNTILS.includes(raw.until as 'permanent')
					? (raw.until as 'endOfTurn' | 'permanent')
					: 'permanent',
				target: target as Target,
			};
		case 'destroy':
			return { trigger, verb, target: target as Target };
		case 'giveKeyword':
			return {
				trigger,
				verb,
				keyword: CARD_KEYWORDS.includes(raw.keyword as Keyword)
					? (raw.keyword as Keyword)
					: 'guard',
				target: target as Target,
			};
	}
}

// --- Cards -------------------------------------------------------------------------------------

/** Add a card; returns its id. */
export function addCard(doc: GameConfigDoc, type: CardDef['type']): string {
	const lib = library(doc);
	const id = freeId(
		lib.map((c) => c.id),
		type === 'unit' ? 'unit' : 'spell',
	);
	lib.push(
		type === 'unit'
			? { id, name: 'New unit', type, cost: 1, attack: 1, health: 1 }
			: { id, name: 'New spell', type, cost: 1, effects: [fitEffect({ type }, {}, lib)] },
	);
	return id;
}

export function duplicateCard(doc: GameConfigDoc, id: string): string | undefined {
	const lib = doc.card?.library;
	const at = lib?.findIndex((c) => c.id === id) ?? -1;
	if (!lib || at < 0) return undefined;
	const copy = JSON.parse(JSON.stringify(lib[at])) as CardDef;
	copy.id = freeId(
		lib.map((c) => c.id),
		id,
	);
	lib.splice(at + 1, 0, copy);
	return copy.id;
}

/** The cards that summon `id`: a card they name cannot be deleted. */
export const summonedBy = (doc: GameConfigDoc, id: string): string[] =>
	(doc.card?.library ?? [])
		.filter((c) => c.id !== id && c.effects?.some((e) => e.verb === 'summon' && e.card === id))
		.map((c) => c.id);

/** Delete a card and its deck entries. Refused (a message) while another card summons it. */
export function removeCard(doc: GameConfigDoc, id: string): string | null {
	const by = summonedBy(doc, id);
	if (by.length)
		return `"${id}" is summoned by ${by.map((c) => `"${c}"`).join(', ')}; change those first.`;
	const lib = doc.card?.library;
	if (!lib) return null;
	block(doc).library = lib.filter((c) => c.id !== id);
	for (const deck of doc.card?.decks ?? []) deck.cards = deck.cards.filter((e) => e.card !== id);
	tidy(doc);
	return null;
}

/** Rename a card's id everywhere it is named (decks, summons). Refused (a message) for a bad id. */
export function renameCard(doc: GameConfigDoc, from: string, to: string): string | null {
	const next = to.trim();
	if (next === from) return null;
	if (!ID_PATTERN.test(next)) return 'An id is letters, digits, "-" and "_".';
	if (findCard(doc, next)) return `"${next}" is already a card.`;
	const card = findCard(doc, from);
	if (!card) return null;
	card.id = next;
	for (const c of doc.card?.library ?? [])
		for (const e of c.effects ?? []) if (e.verb === 'summon' && e.card === from) e.card = next;
	for (const deck of doc.card?.decks ?? [])
		for (const e of deck.cards) if (e.card === from) e.card = next;
	return null;
}

/** Switch a card between unit and spell: a spell loses its stats and keywords, and its effects are
 *  refitted (all `onPlay`, no `self`); a unit gains 1 / 1. */
export function setCardType(doc: GameConfigDoc, id: string, type: CardDef['type']): string | null {
	const card = findCard(doc, id);
	if (!card || card.type === type) return null;
	const by = type === 'spell' ? summonedBy(doc, id) : [];
	if (by.length)
		return `"${id}" is summoned by ${by.map((c) => `"${c}"`).join(', ')}, so it stays a unit.`;
	card.type = type;
	if (type === 'spell') {
		delete card.attack;
		delete card.health;
		delete card.keywords;
		delete card.token;
	} else {
		card.attack = 1;
		card.health = 1;
	}
	if (card.effects)
		card.effects = card.effects.map((e) => fitEffect(card, e, doc.card?.library ?? []));
	return null;
}

export function setCardNumber(
	doc: GameConfigDoc,
	id: string,
	key: CardNumber,
	value: string | number,
): void {
	const card = findCard(doc, id);
	if (!card || (key !== 'cost' && card.type !== 'unit')) return;
	const n = clampTo(value, CARD_RANGES[key]);
	if (n !== undefined) card[key] = n;
}

/** Name and flavour are display text (localization keys). An empty name is kept for the validator
 *  to refuse; an empty flavour is dropped. */
export function setCardText(
	doc: GameConfigDoc,
	id: string,
	key: 'name' | 'flavor',
	value: string,
): void {
	const card = findCard(doc, id);
	if (!card) return;
	if (key === 'name') card.name = value;
	else if (value.trim()) card.flavor = value;
	else delete card.flavor;
}

export function toggleKeyword(doc: GameConfigDoc, id: string, keyword: Keyword): void {
	const card = findCard(doc, id);
	if (!card || card.type !== 'unit') return;
	const has = card.keywords?.includes(keyword);
	const next = has
		? (card.keywords ?? []).filter((k) => k !== keyword)
		: CARD_KEYWORDS.filter((k) => k === keyword || card.keywords?.includes(k));
	if (next.length) card.keywords = next;
	else delete card.keywords;
}

/** A token is only summoned, never in a deck (§3.1); units only. */
export function setToken(doc: GameConfigDoc, id: string, on: boolean): void {
	const card = findCard(doc, id);
	if (!card) return;
	if (on && card.type === 'unit') card.token = true;
	else delete card.token;
}

/** The frame a card is drawn in; blank ⇒ the game's default frame. Its art params stay. */
export function setFrame(doc: GameConfigDoc, id: string, frame: string): void {
	const card = findCard(doc, id);
	if (!card) return;
	if (frame.trim()) card.frame = frame.trim();
	else delete card.frame;
}

/** One of the frame's param overrides (its art); blank ⇒ removed. */
export function setFrameParam(doc: GameConfigDoc, id: string, key: string, value: string): void {
	const card = findCard(doc, id);
	if (!card) return;
	const params = { ...card.params };
	if (value) params[key] = value;
	else delete params[key];
	if (Object.keys(params).length) card.params = params;
	else delete card.params;
}

export function addEffect(doc: GameConfigDoc, id: string): void {
	const card = findCard(doc, id);
	if (!card || (card.effects?.length ?? 0) >= CARD_MAX_EFFECTS) return;
	(card.effects ??= []).push(fitEffect(card, {}, doc.card?.library ?? []));
}

export function removeEffect(doc: GameConfigDoc, id: string, index: number): void {
	const card = findCard(doc, id);
	if (!card?.effects) return;
	card.effects.splice(index, 1);
	if (!card.effects.length) delete card.effects;
}

/** Change one field of an effect (`trigger`, `verb`, `amount`, `target.kind`, …) and refit it. */
export function setEffectField(
	doc: GameConfigDoc,
	id: string,
	index: number,
	field: string,
	value: string | number,
): void {
	const card = findCard(doc, id);
	const effect = card?.effects?.[index];
	if (!card || !effect) return;
	const raw = JSON.parse(JSON.stringify(effect)) as Record<string, unknown> & {
		target?: Record<string, unknown>;
	};
	if (field.startsWith('target.')) raw.target = { ...raw.target, [field.slice(7)]: value };
	else raw[field] = value;
	card.effects![index] = fitEffect(card, raw, doc.card?.library ?? []);
}

/** The config issues about card `index` of the library. */
export const cardIssues = (issues: readonly GameConfigIssue[], index: number): GameConfigIssue[] =>
	issues.filter(
		(i) => i.path === `card.library[${index}]` || i.path.startsWith(`card.library[${index}].`),
	);

/** The card's generated rules text, or none while the card itself has errors (`cardText` expects a
 *  validated card, status open item for C1). */
export function rulesTextOf(card: CardDef, lib: readonly CardDef[]): string[] {
	const others = lib.filter((c) => c.id !== card.id);
	const own = card.id || '#0';
	const broken = validateLibrary([card, ...others]).some(
		(i) => i.severity === 'error' && i.card === own,
	);
	return broken ? [] : cardText(card, lib);
}

// --- Decks -------------------------------------------------------------------------------------

export const deckSizeOf = (deck: CardGameDeck): number =>
	deck.cards.reduce((n, e) => n + e.count, 0);

/** Cards per cost, 0 … 10 (the last bucket holds 7 and up, as a curve is read). */
export function costCurve(deck: CardGameDeck, lib: readonly CardDef[]): number[] {
	const curve = Array.from({ length: 8 }, () => 0);
	for (const entry of deck.cards) {
		const cost = lib.find((c) => c.id === entry.card)?.cost;
		if (cost !== undefined) curve[Math.min(7, cost)] += entry.count;
	}
	return curve;
}

export function addDeck(doc: GameConfigDoc, side: CardGameDeck['side']): string | undefined {
	const all = decks(doc);
	if (all.filter((d) => d.side === side).length >= MAX_DECKS_PER_SIDE) return undefined;
	const id = freeId(
		all.map((d) => d.id),
		side === 'ai' ? 'ai-deck' : 'player-deck',
	);
	all.push({
		id,
		name: side === 'ai' ? 'AI deck' : 'Player deck',
		side,
		cards: [],
		...(side === 'ai' ? { ai: { difficulty: 'normal' as AiDifficulty } } : {}),
	});
	return id;
}

export function duplicateDeck(doc: GameConfigDoc, id: string): string | undefined {
	const all = doc.card?.decks;
	const at = all?.findIndex((d) => d.id === id) ?? -1;
	if (!all || at < 0) return undefined;
	const copy = JSON.parse(JSON.stringify(all[at])) as CardGameDeck;
	copy.id = freeId(
		all.map((d) => d.id),
		id,
	);
	all.splice(at + 1, 0, copy);
	return copy.id;
}

export function removeDeck(doc: GameConfigDoc, id: string): void {
	if (!doc.card?.decks) return;
	doc.card.decks = doc.card.decks.filter((d) => d.id !== id);
	tidy(doc);
}

export function renameDeck(doc: GameConfigDoc, from: string, to: string): string | null {
	const next = to.trim();
	if (next === from) return null;
	if (!ID_PATTERN.test(next)) return 'An id is letters, digits, "-" and "_".';
	if (findDeck(doc, next)) return `"${next}" is already a deck.`;
	const deck = findDeck(doc, from);
	if (deck) deck.id = next;
	return null;
}

export function setDeckName(doc: GameConfigDoc, id: string, name: string): void {
	const deck = findDeck(doc, id);
	if (deck) deck.name = name.trim() || deck.id;
}

/** How many of `card` the deck holds, clamped to 0 … `maxCopies`; 0 removes the entry. Entries for
 *  one card are merged into one. */
export function setDeckCount(
	doc: GameConfigDoc,
	id: string,
	card: string,
	value: string | number,
): void {
	const deck = findDeck(doc, id);
	if (!deck) return;
	const max = resolveCardRules(doc.card?.rules).maxCopies;
	const n = clampTo(value, [0, max]);
	if (n === undefined) return;
	const at = deck.cards.findIndex((e) => e.card === card);
	deck.cards = deck.cards.filter((e, i) => e.card !== card || i === at);
	if (n === 0) deck.cards = deck.cards.filter((e) => e.card !== card);
	else if (at >= 0) deck.cards[deck.cards.findIndex((e) => e.card === card)].count = n;
	else deck.cards.push({ card, count: n });
}

export const deckCount = (deck: CardGameDeck, card: string): number =>
	deck.cards.filter((e) => e.card === card).reduce((n, e) => n + e.count, 0);

export function setDeckDifficulty(doc: GameConfigDoc, id: string, difficulty: AiDifficulty): void {
	const deck = findDeck(doc, id);
	if (!deck || deck.side !== 'ai') return;
	deck.ai = { ...deck.ai, difficulty };
}

export const AI_WEIGHT_KEYS: readonly (keyof AiWeights)[] = [
	'health',
	'board',
	'keyword',
	'hand',
	'win',
];

/** One weight override of an AI deck; blank ⇒ the preset's. */
export function setDeckWeight(
	doc: GameConfigDoc,
	id: string,
	key: keyof AiWeights,
	value: string,
): void {
	const deck = findDeck(doc, id);
	if (!deck || deck.side !== 'ai') return;
	const ai = { difficulty: deck.ai?.difficulty ?? ('normal' as AiDifficulty), ...deck.ai };
	const weights = { ...ai.weights };
	const n = Number(value.trim());
	if (value.trim() === '' || !Number.isFinite(n)) delete weights[key];
	else weights[key] = n;
	if (Object.keys(weights).length) ai.weights = weights;
	else delete ai.weights;
	deck.ai = ai;
}

/** The config issues about deck `index`. */
export const deckIssues = (issues: readonly GameConfigIssue[], index: number): GameConfigIssue[] =>
	issues.filter(
		(i) => i.path === `card.decks[${index}]` || i.path.startsWith(`card.decks[${index}].`),
	);

// --- The frame preview -------------------------------------------------------------------------

/** The looks the preview can show (§6's states, as the placeholder frame's 0 / 1 params). */
export const PREVIEW_LOOKS = [
	'inHand',
	'playable',
	'onBoard',
	'ready',
	'targetable',
	'faceDown',
	'damaged',
	'buffed',
] as const;
export type PreviewLook = (typeof PREVIEW_LOOKS)[number];

const flag = (on: boolean): number => (on ? 1 : 0);

/**
 * What the card's frame shows, the values the game's `valuesOf` (`apps/lines` `cards.ts`) feeds a
 * card in its hand or on its board: its params (its art) first, then its name, rules text and
 * numbers, then the look flags. `look` picks the state shown; a damaged look shows one damage, a
 * buffed one +1 / +1.
 */
export function frameValues(
	card: CardDef,
	lib: readonly CardDef[],
	look: PreviewLook = 'inHand',
): Record<string, unknown> {
	const unit = card.type === 'unit';
	const onBoard =
		look === 'onBoard' ||
		look === 'ready' ||
		look === 'targetable' ||
		look === 'damaged' ||
		look === 'buffed';
	const buffed = unit && look === 'buffed';
	const damaged = unit && look === 'damaged';
	const health = (card.health ?? 0) + (buffed ? 1 : 0) - (damaged ? 1 : 0);
	return {
		...card.params,
		name: card.name,
		...(card.flavor ? { flavor: card.flavor } : {}),
		rulesText: rulesTextOf(card, lib).join(' '),
		cost: card.cost,
		attack: (card.attack ?? 0) + (buffed ? 1 : 0),
		health: Math.max(0, health),
		isUnit: flag(unit),
		inHand: flag(!onBoard && look !== 'faceDown'),
		onBoard: flag(onBoard),
		faceDown: flag(look === 'faceDown'),
		playable: flag(look === 'playable'),
		ready: flag(look === 'ready'),
		targetable: flag(look === 'targetable'),
		damaged: flag(damaged),
		buffed: flag(buffed),
		debuffed: 0,
		guard: flag(!!card.keywords?.includes('guard')),
		shield: flag(!!card.keywords?.includes('shield')),
		swift: flag(!!card.keywords?.includes('swift')),
		dragging: 0,
		hint: 0,
	};
}

// --- Frames ------------------------------------------------------------------------------------

/** The inputs every card frame must take (§6): the placeholder frame's, one source. */
export const FRAME_INPUT_IDS: readonly string[] = (CARD_FRAME_PLACEHOLDER_DEF.inputs ?? []).map(
	(i) => i.id,
);

/** The §6 inputs `def` does not declare; empty for a frame with the whole interface. */
export function frameInterfaceGaps(def: ComponentDef): string[] {
	const has = new Set(componentInputs(def).map((i) => i.id));
	return FRAME_INPUT_IDS.filter((id) => !has.has(id));
}

/** Is `def` offered as a frame: named by a card, the default, or declaring the frame's text inputs. */
const isFrame = (def: ComponentDef, named: ReadonlySet<string>): boolean => {
	if (named.has(def.id)) return true;
	const inputs = new Set(componentInputs(def).map((i) => i.id));
	return inputs.has('name') && inputs.has('rulesText');
};

const namedFrames = (doc: GameConfigDoc | null): Set<string> => {
	const named = new Set<string>([DEFAULT_CARD_FRAME_ID]);
	for (const card of cardLibraryOf(doc)) if (card.frame) named.add(card.frame);
	return named;
};

/** The frames a card may pick, of the components the page holds. */
export const frameChoices = (
	defs: readonly ComponentDef[],
	doc: GameConfigDoc | null,
): ComponentDef[] => {
	const named = namedFrames(doc);
	return defs.filter((def) => isFrame(def, named));
};

/** The components a card can be drawn in, then every component they nest (for the drawing). */
export function frameCandidates(
	all: readonly ComponentDef[],
	doc: GameConfigDoc | null,
): ComponentDef[] {
	const named = namedFrames(doc);
	const byId = new Map(all.map((d) => [d.id, d]));
	const out = new Map<string, ComponentDef>();
	const nest = (node: LayoutNode, depth: number): void => {
		if (node.kind === 'componentInstance' && !out.has(node.componentId) && depth < 6) {
			const def = byId.get(node.componentId);
			if (def) {
				out.set(def.id, def);
				nest(def.root, depth + 1);
			}
		}
		if (node.kind === 'container') for (const child of node.children) nest(child, depth);
	};
	for (const def of all)
		if (isFrame(def, named)) {
			out.set(def.id, def);
			nest(def.root, 0);
		}
	return [...out.values()];
}
