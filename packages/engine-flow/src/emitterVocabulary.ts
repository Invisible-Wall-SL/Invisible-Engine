/**
 * Emitter vocabulary catalog (design doc §3 — reuse, don't reinvent; §11 honesty).
 *
 * A Broadcast choreography node names a real emitter event the game reacts to. The
 * vocabulary itself lives in each game's `typesEmitterEvent.ts` (under `apps/<game>/src/game`) as a
 * COMPILE-TIME TypeScript discriminated union (`{ type: 'boardShow' } | …`) — it has no
 * runtime/serialized form, and the launcher loads a project from R2, not from the game's
 * source. So the catalog of broadcastable events MUST be PASSED IN to the authoring
 * surface, exactly the way the LayoutDoc + component defs already are (it is NOT something
 * the launcher can reflect from R2 today). This module defines that passed-in shape and a
 * representative default derived verbatim from the real `apps/lines` / Book-of emitter
 * events, so the Broadcast palette lists the game's ACTUAL vocabulary rather than an
 * invented one.
 *
 * Phase 3 ships the bundled default below (the authoring vocabulary). A later phase
 * (the bake/pipeline wiring, design doc §10/Phase 6) can replace it by exporting the
 * game's emitter union as data alongside the FlowDoc — at which point the SAME
 * {@link EmitterVocabulary} shape is read from the project instead of this default. The
 * authoring UI is agnostic to the source: it renders whatever {@link EmitterVocabulary}
 * it is handed.
 *
 * It carries NO behaviour — only the event `type` names + their author-relevant payload
 * fields (so a Broadcast node can offer the right payload keys). The engine still owns
 * HOW each event animates (the `declare ≠ implement` contract, design doc §7).
 */

/** One author-relevant field on an emitter event's payload (beyond the `type` discriminant). */
export interface EmitterEventField {
	/** The payload key (e.g. `name`, `amount`, `symbolPositions`). */
	key: string;
	/** Coarse author hint for the value editor — maps onto the bounded accessor kinds. */
	kind: 'string' | 'number' | 'boolean' | 'list' | 'object';
	/** True when the field is required for the event to be meaningful (authoring hint only). */
	required?: boolean;
}

/** One broadcastable emitter event (a member of the game's `EmitterEvent*` union). */
export interface EmitterEventDef {
	/** The `type` discriminant the executor emits (`emitter.broadcast({ type })`). */
	type: string;
	/** A grouping label for the palette (the source component, e.g. `Board`, `Sound`). */
	group: string;
	/** Author-relevant payload fields (the `type` discriminant is implicit, excluded). */
	fields?: EmitterEventField[];
}

/** The full broadcast vocabulary handed to the authoring surface (the passed-in catalog). */
export interface EmitterVocabulary {
	/** A label for the source game/template (provenance only). */
	source?: string;
	events: EmitterEventDef[];
}

/**
 * The bundled default vocabulary — transcribed from the REAL emitter unions in
 * `apps/lines/src/game/typesEmitterEvent.ts` (Board, Win, Sound, the FreeSpin events,
 * Transition, SpecialBook) plus the shared UI events the handlers broadcast (`uiShow` /
 * `uiHide`, drawer + board-frame + stop-button cues). This is a faithful projection of
 * the coded vocabulary, NOT a new one — every `type` here is a real event a coded handler
 * already broadcasts (see `bookEventHandlerMap.ts`). Grouped for the palette.
 */
export const DEFAULT_EMITTER_VOCABULARY: EmitterVocabulary = {
	source: 'lines / book-of',
	events: [
		// --- Board (EmitterEventBoard) ---
		{ type: 'boardShow', group: 'Board' },
		{ type: 'boardHide', group: 'Board' },
		{
			type: 'boardSettle',
			group: 'Board',
			fields: [{ key: 'board', kind: 'list', required: true }],
		},
		{
			type: 'boardWithAnimateSymbols',
			group: 'Board',
			fields: [{ key: 'symbolPositions', kind: 'list', required: true }],
		},
		// --- Board frame (EmitterEventBoardFrame) ---
		{ type: 'boardFrameGlowShow', group: 'Board frame' },
		{ type: 'boardFrameGlowHide', group: 'Board frame' },
		// --- Win (EmitterEventWin) ---
		{ type: 'winShow', group: 'Win' },
		{ type: 'winHide', group: 'Win' },
		{
			type: 'winUpdate',
			group: 'Win',
			fields: [
				{ key: 'amount', kind: 'number', required: true },
				{ key: 'winLevelData', kind: 'object' },
			],
		},
		// --- Free spin intro (EmitterEventFreeSpinIntro) ---
		{ type: 'freeSpinIntroShow', group: 'Free spins' },
		{ type: 'freeSpinIntroHide', group: 'Free spins' },
		{
			type: 'freeSpinIntroUpdate',
			group: 'Free spins',
			fields: [{ key: 'totalFreeSpins', kind: 'number', required: true }],
		},
		// --- Free spin counter (EmitterEventFreeSpinCounter) ---
		{ type: 'freeSpinCounterShow', group: 'Free spins' },
		{ type: 'freeSpinCounterHide', group: 'Free spins' },
		{
			type: 'freeSpinCounterUpdate',
			group: 'Free spins',
			fields: [
				{ key: 'current', kind: 'number' },
				{ key: 'total', kind: 'number', required: true },
			],
		},
		// --- Free spin outro (EmitterEventFreeSpinOutro) ---
		{ type: 'freeSpinOutroShow', group: 'Free spins' },
		{ type: 'freeSpinOutroHide', group: 'Free spins' },
		{
			type: 'freeSpinOutroCountUp',
			group: 'Free spins',
			fields: [
				{ key: 'amount', kind: 'number', required: true },
				{ key: 'winLevelData', kind: 'object' },
			],
		},
		// --- Special book (EmitterEventSpecialBook) ---
		{
			type: 'specialBookReveal',
			group: 'Special book',
			fields: [{ key: 'symbol', kind: 'string', required: true }],
		},
		{ type: 'specialBookHide', group: 'Special book' },
		// --- Sound (EmitterEventSound) ---
		{
			type: 'soundMusic',
			group: 'Sound',
			fields: [{ key: 'name', kind: 'string', required: true }],
		},
		{
			type: 'soundOnce',
			group: 'Sound',
			fields: [
				{ key: 'name', kind: 'string', required: true },
				{ key: 'forcePlay', kind: 'boolean' },
			],
		},
		{
			type: 'soundLoop',
			group: 'Sound',
			fields: [{ key: 'name', kind: 'string', required: true }],
		},
		{
			type: 'soundStop',
			group: 'Sound',
			fields: [{ key: 'name', kind: 'string', required: true }],
		},
		{ type: 'soundScatterCounterIncrease', group: 'Sound' },
		{ type: 'soundScatterCounterClear', group: 'Sound' },
		// --- Transition (EmitterEventTransition) ---
		{ type: 'transition', group: 'Transition' },
		// --- Shared UI cues the handlers broadcast ---
		{ type: 'uiShow', group: 'UI' },
		{ type: 'uiHide', group: 'UI' },
		{ type: 'drawerFold', group: 'UI' },
		{ type: 'drawerUnfold', group: 'UI' },
		{ type: 'drawerButtonShow', group: 'UI' },
		{ type: 'drawerButtonHide', group: 'UI' },
		{ type: 'stopButtonEnable', group: 'UI' },
	],
};

/** Group a vocabulary's events by their `group` label (palette rendering helper). */
export const groupEmitterVocabulary = (
	vocab: EmitterVocabulary,
): { group: string; events: EmitterEventDef[] }[] => {
	const byGroup = new Map<string, EmitterEventDef[]>();
	for (const event of vocab.events) {
		const list = byGroup.get(event.group) ?? [];
		list.push(event);
		byGroup.set(event.group, list);
	}
	return [...byGroup.entries()].map(([group, events]) => ({ group, events }));
};

/** Look up one event def by `type` (for showing payload fields in the Broadcast editor). */
export const findEmitterEvent = (
	vocab: EmitterVocabulary,
	type: string,
): EmitterEventDef | undefined => vocab.events.find((e) => e.type === type);
