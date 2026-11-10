/**
 * The emitter vocabulary — the broadcastable cue catalog a game exports as data.
 *
 * A game's emitter events live in its `typesEmitterEvent.ts` as a COMPILE-TIME discriminated union
 * with no serialized form, and the launcher loads a project from R2, not from the game's source.
 * So the catalog is generated (`pnpm gen:flow-vocab` → `apps/lines/src/game/emitterVocabulary.ts`
 * and the launcher's `emitterVocabularies.ts`) and handed to the authoring surfaces — the FX
 * tool's event triggers read it. It carries NO behaviour, only the event `type` names and their
 * author-relevant payload fields.
 */

/** One author-relevant field on an emitter event's payload (beyond the `type` discriminant). */
export interface EmitterEventField {
	/** The payload key (e.g. `name`, `amount`, `symbolPositions`). */
	key: string;
	/** Coarse author hint for the value editor. */
	kind: 'string' | 'number' | 'boolean' | 'list' | 'object';
	/** True when the field is required for the event to be meaningful (authoring hint only). */
	required?: boolean;
}

/** One broadcastable emitter event (a member of the game's `EmitterEvent*` union). */
export interface EmitterEventDef {
	/** The `type` discriminant broadcast (`eventEmitter.broadcast({ type })`). */
	type: string;
	/** A grouping label for the palette (the source component, e.g. `Board`, `Sound`). */
	group: string;
	/** Author-relevant payload fields (the `type` discriminant is implicit, excluded). */
	fields?: EmitterEventField[];
}

/** One game-registered EFFECT name (a key of the game's `flowEffects` map). */
export interface EmitterEffectDef {
	name: string;
	/** A grouping label for the palette (provenance only, e.g. the game template). */
	group?: string;
}

/** One book-event TYPE the game's RGS book carries (a member of its `BookEvent` union). */
export interface BookEventDef {
	type: string;
}

/** The full vocabulary handed to the authoring surface (the passed-in catalog). */
export interface EmitterVocabulary {
	/** A label for the source game/template (provenance only). */
	source?: string;
	events: EmitterEventDef[];
	/** The game-registered effect names (`flowEffects` keys); absent ⇒ no exported catalog. */
	effects?: EmitterEffectDef[];
	/** The game's book-event types (`typesBookEvent.ts`); absent ⇒ no exported catalog. */
	bookEvents?: BookEventDef[];
}

/**
 * The bundled default vocabulary, for a game type with no generated one — transcribed from the
 * REAL emitter unions in `apps/lines/src/game/typesEmitterEvent.ts` (Board, Win, Sound, the
 * FreeSpin events, Transition, SpecialBook) plus the shared UI events the handlers broadcast. Every
 * `type` here is a real event a coded handler already broadcasts (see `bookEventHandlerMap.ts`).
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
	// The real `BookEvent` types in `apps/lines/src/game/typesBookEvent.ts`.
	bookEvents: [
		{ type: 'reveal' },
		{ type: 'winInfo' },
		{ type: 'setTotalWin' },
		{ type: 'freeSpinTrigger' },
		{ type: 'updateFreeSpin' },
		{ type: 'createBonusSnapshot' },
		{ type: 'finalWin' },
		{ type: 'setWin' },
		{ type: 'freeSpinEnd' },
		{ type: 'setExpandingSymbol' },
		{ type: 'expandBookColumns' },
	],
};
