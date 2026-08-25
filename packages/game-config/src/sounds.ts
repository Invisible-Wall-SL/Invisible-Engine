/**
 * The game's SOUND SLOTS — the named presentation moments a game plays a cue at, and the sound
 * name(s) bound to each. An INVISIBLE-ENGINE extension, not part of the math export.
 *
 * It exists because every sound the engine plays was a hardcoded string literal spread across ten
 * files (`stateGame.svelte.ts`, `Symbol.svelte`, `bookEventHandlerMap.ts`, `flowEffects.ts`, …),
 * which had two consequences worth naming:
 *
 * 1. **A moment with no literal was silent forever.** The cascade pop is the case that prompted
 *    this: the audiosprite has shipped `tumble_win_1…5` — a five-step escalation ladder authored
 *    for exactly that beat — since the fork, and nothing has ever played one. The names appear in
 *    the flow editor's sound dropdown (it is generated from the `SoundName` union, which lists
 *    names, not wiring), so the sounds LOOK bound while the game plays nothing.
 * 2. **A bound moment could not be re-bound.** Swapping a game's reel-stop cue meant editing engine
 *    source, which a project vendoring the engine as a submodule cannot do.
 *
 * The slot is therefore the unit of authorship: the ENGINE owns when a slot fires, the CONFIG owns
 * what it plays (here), and the Invisible Symbols doc owns a per-symbol exception to that. Every
 * slot ships a coded default below, so a project that never opens the panel gets the full sound set
 * with no authoring — which is the half that was missing.
 */

/** Every authorable slot id. The engine fires these; the config binds them. */
export const SOUND_SLOT_IDS = [
	'tumbleExplosion',
	'reelStop',
	'symbolLand',
	'royalLand',
	'scatterLand',
	'wildLand',
	'wildExplode',
] as const;

export type SoundSlotId = (typeof SOUND_SLOT_IDS)[number];

/**
 * How a slot's bound names are consumed.
 *
 * - `single` — one cue, played every time the slot fires.
 * - `ladder` — an ORDERED list indexed by a number the firing site supplies, so successive
 *   occurrences escalate. WHICH number is the slot's own business (the cascade step for
 *   `tumbleExplosion`, the reel index for `reelStop`, the running scatter count for `scatterLand`),
 *   and it is described per slot below rather than encoded here — the pick is the same clamp either
 *   way, and an index past the end holds on the last rung rather than falling silent.
 */
export type SoundSlotKind = 'single' | 'ladder';

export type SoundSlot = {
	id: SoundSlotId;
	/** Panel label. */
	label: string;
	kind: SoundSlotKind;
	/** What fires this slot, in the author's words — the panel's help text. */
	description: string;
	/** For a `ladder`, what its index MEANS. Absent on a `single`. */
	ladderIndex?: string;
	/** The coded binding every game gets for free. Never empty — a slot with nothing to play would
	 *  be a slot that should not exist. */
	defaults: string[];
};

/**
 * The catalogue. This is the "default template" — a game inherits every binding here without
 * authoring anything, and `/config` edits are stored as DEPARTURES from it (see
 * {@link normalizeSounds}), so the defaults stay live rather than being copied into each project's
 * doc where they would freeze.
 */
export const SOUND_SLOTS: readonly SoundSlot[] = [
	{
		id: 'tumbleExplosion',
		label: 'Tumble explosion',
		kind: 'ladder',
		description:
			'The cascade pop — the cue played when a tumble removes the winning symbols from the board. Fires ONCE per cascade step, not once per exploding cell, so a five-symbol win is one pop rather than five stacked copies.',
		ladderIndex:
			'the cascade STEP within the round: the first tumble plays rung 1, the second rung 2, and so on, so a long cascade escalates. Past the last rung it holds there.',
		defaults: ['tumble_win_1', 'tumble_win_2', 'tumble_win_3', 'tumble_win_4', 'tumble_win_5'],
	},
	{
		id: 'reelStop',
		label: 'Reel stop',
		kind: 'ladder',
		description:
			'The thud as each reel comes to rest. Played without `forcePlay` on a turbo spin, so a fast round does not machine-gun it.',
		ladderIndex:
			'the REEL INDEX: reel 1 plays rung 1, reel 2 rung 2, which is what gives the left-to-right stop its rising pitch. A board with more reels than rungs holds on the last one.',
		defaults: [
			'sfx_reel_stop_1',
			'sfx_reel_stop_2',
			'sfx_reel_stop_3',
			'sfx_reel_stop_4',
			'sfx_reel_stop_5',
		],
	},
	{
		id: 'symbolLand',
		label: 'Picture symbol lands',
		kind: 'single',
		description:
			'A high-paying PICTURE symbol settling into its cell. A per-symbol sound bound in Invisible Symbols overrides this.',
		defaults: ['sfx_symbols_landing'],
	},
	{
		id: 'royalLand',
		label: 'Royal symbol lands',
		kind: 'single',
		description:
			'A low-paying ROYAL/card symbol settling into its cell — the quieter counterpart to the picture cue, so a board of royals does not sound like a board of pictures.',
		defaults: ['sfx_royals_landing'],
	},
	{
		id: 'scatterLand',
		label: 'Scatter lands',
		kind: 'ladder',
		description: 'A scatter settling into its cell — the rising tease as a trigger gets closer.',
		ladderIndex:
			'the running SCATTER COUNT this spin: the first scatter plays rung 1, the second rung 2. That is what makes the third one sound like a trigger.',
		defaults: [
			'sfx_scatter_stop_1',
			'sfx_scatter_stop_2',
			'sfx_scatter_stop_3',
			'sfx_scatter_stop_4',
			'sfx_scatter_stop_5',
		],
	},
	{
		id: 'wildLand',
		label: 'Wild lands',
		kind: 'single',
		description: 'A wild / multiplier symbol settling into its cell.',
		defaults: ['sfx_multiplier_landing'],
	},
	{
		id: 'wildExplode',
		label: 'Wild explodes',
		kind: 'single',
		description:
			'Fired by a `wildExplode` EVENT on the symbol’s own spine timeline, so it lands on the animation’s beat rather than on the state change. A symbol whose art raises no such event never plays it.',
		defaults: ['sfx_wild_explode'],
	},
];

const SLOT_BY_ID: Record<SoundSlotId, SoundSlot> = SOUND_SLOTS.reduce(
	(acc, slot) => {
		acc[slot.id] = slot;
		return acc;
	},
	{} as Record<SoundSlotId, SoundSlot>,
);

/** The catalogue entry for a slot — the ONE lookup, so no caller re-scans the array. */
export function soundSlot(id: SoundSlotId): SoundSlot {
	return SLOT_BY_ID[id];
}

/**
 * One slot's authored binding. SPARSE: every field optional, and an absent field inherits the
 * catalogue default rather than meaning "off" — `enabled: false` is the only way to silence a slot,
 * and it is deliberately distinct from an empty `names` (which reads as "I cleared the list, give me
 * the default back", the far likelier accident).
 */
export type SoundSlotBinding = {
	/** Ordered sound names. A `single` slot stores one entry, a `ladder` its rungs, in order.
	 *  Absent or empty ⇒ the catalogue defaults. */
	names?: string[];
	/** Per-play volume, 0..1. Absent ⇒ the sound player's own default. */
	volume?: number;
	/** `false` silences the slot outright. Absent ⇒ on. */
	enabled?: boolean;
};

/** Slot id → binding. Sparse: only slots that DEPART from the catalogue appear. */
export type GameSounds = Partial<Record<SoundSlotId, SoundSlotBinding>>;

/** One slot with the catalogue defaults already applied — the shape the runtime consumes. */
export type ResolvedSoundSlot = {
	names: string[];
	volume: number | undefined;
	enabled: boolean;
};

/**
 * A slot's cue for one firing: the name to play plus its authored volume, or `undefined` when the
 * slot is silenced. `undefined` rather than an empty name so a caller cannot accidentally broadcast
 * a blank cue — howler declines an unknown sprite key silently, which would make a silenced slot and
 * a MISTYPED one look identical in-game.
 */
export type SoundCue = {
	name: string;
	volume: number | undefined;
};

export type ResolvedSounds = {
	slot: (id: SoundSlotId) => ResolvedSoundSlot;
	/**
	 * The cue for one firing of a slot. `index` is the ladder rung the firing site supplies
	 * (0-based); it is clamped into range, so an index past the end holds on the last rung and a
	 * negative one starts at the first. Ignored by a `single` slot, which always plays its one name.
	 */
	pick: (id: SoundSlotId, index?: number) => SoundCue | undefined;
};

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

/** A stored volume only survives if it is a real 0..1 fraction — anything else means the player's
 *  own default, not a clamped guess at what the author meant. */
const readVolume = (raw: unknown): number | undefined =>
	isFiniteNumber(raw) && raw >= 0 && raw <= 1 ? raw : undefined;

/** Non-empty strings only, in order. Deliberately NOT de-duplicated: a ladder may legitimately
 *  repeat a rung — a three-rung ladder padded out to five is a real authoring choice. */
const readNames = (raw: unknown): string[] =>
	Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string' && n.length > 0) : [];

/**
 * Every slot's binding with the catalogue defaults applied.
 *
 * Read through this rather than off the doc, so "absent means the coded ladder" is spelled out once
 * — the same rule `resolveReelBehaviour` follows, and for the same reason: the tool that authors
 * this and the engine that plays it must not be able to answer the question differently.
 *
 * NOT memoised: `pick` is an array index behind two `??`s, and a second cache is a second thing
 * `resetGameConfigCache()` would have to remember to drop — the omission that freezes an online game
 * to the sample config.
 */
export function resolveSounds(doc: { sounds?: GameSounds } | undefined): ResolvedSounds {
	const authored = doc?.sounds;

	const slot = (id: SoundSlotId): ResolvedSoundSlot => {
		const binding = authored?.[id];
		const names = readNames(binding?.names);
		return {
			names: names.length ? names : [...soundSlot(id).defaults],
			volume: readVolume(binding?.volume),
			enabled: binding?.enabled !== false,
		};
	};

	const pick = (id: SoundSlotId, index = 0): SoundCue | undefined => {
		const resolved = slot(id);
		if (!resolved.enabled || !resolved.names.length) return undefined;
		// A `single` slot is a one-rung ladder, so the clamp answers both kinds with one expression.
		const rung = Math.min(Math.max(Math.floor(index), 0), resolved.names.length - 1);
		return { name: resolved.names[rung], volume: resolved.volume };
	};

	return { slot, pick };
}

/**
 * The subset of a dictionary symbol this routing needs. Structural rather than an import of
 * `GameConfigSymbol`, so this module stays free of `./types` — which imports {@link GameSounds} from
 * here, and a type-only cycle between the schema's two halves is a thing that reads as fine right up
 * until someone adds a value import to one of them.
 */
export type SoundRoutingSymbol = {
	paytable?: Record<string, number>[] | null;
	special_properties?: string[];
};

/** The largest multiplier a symbol advertises anywhere in its paytable; 0 for a symbol that pays
 *  nothing (a scatter, a wild, a decorative symbol). */
function topMultiplier(symbol: SoundRoutingSymbol | undefined): number {
	const rows = symbol?.paytable;
	if (!Array.isArray(rows)) return 0;
	let top = 0;
	for (const row of rows) {
		if (typeof row !== 'object' || row === null) continue;
		for (const value of Object.values(row)) {
			if (typeof value === 'number' && Number.isFinite(value) && value > top) top = value;
		}
	}
	return top;
}

/**
 * WHICH LAND SLOT a symbol belongs to — the routing that decides whether a landing symbol sounds
 * like a scatter, a wild, a picture or a royal.
 *
 * The split between picture and royal is by PAYTABLE RANK, not by symbol id, and that is the whole
 * point: `H*`/`L*` is a convention of the templates we happen to ship, and a config from a math team
 * that names its symbols `CHERRY`/`BELL` would fall off a prefix test silently — the exact "magic
 * id" failure this repo has paid for before. A symbol whose top multiplier sits at or below the
 * MEDIAN of the paying dictionary is a royal; above it, a picture. On a conventional 5-high/5-low
 * dictionary that reproduces the H/L split exactly, and on an unconventional one it still means
 * something.
 *
 * A symbol that pays nothing and claims nothing (decorative, or absent from the dictionary) routes
 * to `symbolLand` — SOME cue rather than silence, since silence is the state this whole module
 * exists to end.
 */
export function landSlotForSymbol(
	name: string,
	symbols: Record<string, SoundRoutingSymbol> | undefined,
): SoundSlotId {
	const symbol = symbols?.[name];
	const properties = symbol?.special_properties ?? [];
	if (properties.includes('scatter')) return 'scatterLand';
	if (properties.includes('wild')) return 'wildLand';

	const paying = Object.values(symbols ?? {})
		.map(topMultiplier)
		.filter((m) => m > 0)
		.sort((a, b) => a - b);
	if (!paying.length) return 'symbolLand';

	// The median of the paying set. An even count takes the LOWER of the two middles, so a dictionary
	// with equal numbers of pictures and royals splits down the middle rather than pulling one royal
	// up into the picture cue.
	const median = paying[Math.max(0, Math.ceil(paying.length / 2) - 1)];
	const top = topMultiplier(symbol);
	if (top === 0) return 'symbolLand';
	return top <= median ? 'royalLand' : 'symbolLand';
}

/**
 * Normalize an authored block, or `undefined` when there is nothing worth storing.
 *
 * Same invariant as the rest of this schema — store only what DEPARTS from the catalogue — so a
 * project that opens the panel, looks, and saves normalizes byte-identically to one written before
 * the block existed. That is what keeps the defaults LIVE: a game that stored its inherited ladder
 * would keep playing the old one after the catalogue improved, which is precisely the freeze this
 * whole section exists to undo.
 *
 * A names list equal to the catalogue default is therefore dropped, not stored.
 */
export function normalizeSounds(raw: unknown): GameSounds | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const input = raw as Record<string, unknown>;
	const out: GameSounds = {};

	for (const id of SOUND_SLOT_IDS) {
		const entry = input[id];
		if (typeof entry !== 'object' || entry === null) continue;
		const binding = entry as SoundSlotBinding;
		const next: SoundSlotBinding = {};

		const slot = soundSlot(id);
		// A `single` slot stores exactly one name however many the author's UI handed over — a stored
		// tail no consumer reads is a stored fact that can drift.
		const names = readNames(binding.names).slice(0, slot.kind === 'single' ? 1 : undefined);
		const isDefault =
			names.length === slot.defaults.length && names.every((n, i) => n === slot.defaults[i]);
		if (names.length && !isDefault) next.names = names;

		const volume = readVolume(binding.volume);
		if (volume !== undefined) next.volume = volume;
		if (binding.enabled === false) next.enabled = false;

		if (Object.keys(next).length) out[id] = next;
	}

	return Object.keys(out).length ? out : undefined;
}
