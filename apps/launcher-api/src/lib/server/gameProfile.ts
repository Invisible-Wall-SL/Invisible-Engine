/**
 * The Game Maker card's "what IS this game" summary — the project's IDENTITY (kind, win model,
 * board, math headline, which engine + which server) and the list of MECHANICS/PRESENTATION
 * features it actually uses.
 *
 * It replaces the row of tool-launch buttons that used to sit on each card. Those buttons said
 * nothing a project's own top bar doesn't already say; this says the thing you actually come to the
 * hub to find out — is this the 5×3 line game or the cluster one, does it stack, does it have a buy
 * feature, is it on the shared `lines` runtime.
 *
 * ## Adding a feature (the whole point of the shape below)
 *
 * Both lists are DATA TABLES over a single {@link ProfileContext}, not hand-written markup. A new
 * mechanic is one entry in {@link FEATURE_DETECTORS} — no page edit, no loader edit, no new prop.
 * That matters because the list is expected to grow with every optional mechanic the engine gains,
 * and the failure mode we are designing against is a feature that ships and is never listed here.
 *
 * The rules a detector must follow:
 *  - Read ONLY from {@link ProfileContext}. If your signal isn't there yet, add it to the context
 *    (and to the ONE place that assembles it, `gameProfileSignals` in the page loader) — never reach
 *    for R2 from inside a detector; the list is rendered per project and must stay IO-free.
 *  - Report what the project USES, not what it could use. A detector fires only on positive
 *    evidence, so an un-authored project lists nothing rather than the engine's whole menu.
 *  - Mind the sparse-doc defaults: several switches (`winLine.enabled`, `winCycle.enabled`) are ON
 *    when ABSENT, so `!== false` is the correct test and `=== true` would under-report. The three
 *    that default OFF (`stackedPictures.enabled`, `escalateTiers`, `winCycle.dimNonWinning`) use
 *    `=== true`.
 *
 * No new storage: every signal is something the pipeline already stores (the Game Config doc, the
 * Symbols doc, the project's game kind, the test-server manifest entry).
 */

import {
	resolveBetModes,
	resolveWinLevels,
	resolveWinModel,
	symbolsInPlay,
	type GameConfigDoc,
	type ResolvedBetMode,
	type ResolvedWinTier,
	type WinModel,
} from 'game-config';
import { TUMBLE_PATTERN_LABELS } from 'engine-layout';
import type { GameConfigSource } from './gameConfigDefaults';
import type { SymbolsDoc } from './symbolsStorage';
import { protocolFor } from './mockProtocol';
import { SHARED_RUNTIME_ID, type MockProtocol } from './testServerManifest';

/** Everything the profile is derived from — assembled once per project by the page loader. */
export interface GameProfileSignals {
	/** The project's game KIND id (`lines` / `bookOf` / `ways` / `cluster` / `scatter` / a custom id).
	 *  Shares an id space with the Flow v2 `templateId`, which is why it can name the mechanic set. */
	gameTypeId: string;
	/** The kind's display name from the selectable-kinds union (falls back to the raw id). */
	gameTypeName: string;
	/** The config the game actually runs — authored doc, else the game type's committed template. */
	config: GameConfigDoc | null;
	configSource: GameConfigSource;
	symbols: SymbolsDoc;
	/** Shared prebuilt runtime bundle the published game is served from (`lines` today). */
	runtimeId: string | null;
	/** Which mock-RGS protocol the published game talks. Null until the project is published. */
	protocol: MockProtocol | null;
}

/** One chip. `text` is self-describing (units baked in); `title` is the hover explanation. */
export interface ProfileChip {
	id: string;
	text: string;
	title: string;
	/** `warn` ⇒ the chip reports DRIFT the author has to act on, and is styled to stand out.
	 *  Absent ⇒ a neutral statement of fact. */
	tone?: 'warn';
}

export interface GameProfile {
	/** Identity — what kind of game this is, and what it runs on. */
	facts: ProfileChip[];
	/** Optional mechanics + presentation the project actually switched on. */
	features: ProfileChip[];
}

/** The read-only view every fact/detector sees. Derived once, so no entry re-resolves anything. */
interface ProfileContext extends GameProfileSignals {
	winModel: WinModel;
	/** `special_properties` of the symbols this game really has — see {@link liveProperties}. */
	props: Set<string>;
	betModes: ResolvedBetMode[];
	/** Authored win tiers, or `[]` when the project keeps the coded ladder. */
	tiers: ResolvedWinTier[];
	/** Symbol states the Symbols tool has authored art for, across all symbols. */
	states: Set<string>;
}

interface ChipSource {
	id: string;
	title: string;
	tone?: 'warn';
	/** `null` ⇒ this chip does not apply to this project and is omitted. */
	text: (ctx: ProfileContext) => string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `96.5` from `0.965` or from `96.5` — configs in the wild carry both scales. */
function rtpPercent(rtp: number): number {
	return rtp > 0 && rtp <= 1 ? rtp * 100 : rtp;
}

function trimNumber(n: number, decimals = 1): string {
	return Number(n.toFixed(decimals)).toString();
}

/** `5 × 3` for a rectangular board, `5 reels · 3/4/5/4/3` for a stepped one. */
function boardText(config: GameConfigDoc): string | null {
	const rows = config.numRows ?? [];
	if (!config.numReels || rows.length === 0) return null;
	const uniform = rows.every((r) => r === rows[0]);
	return uniform
		? `${config.numReels} × ${rows[0]} board`
		: `${config.numReels} reels · ${rows.join('/')} rows`;
}

/** Ways = the product of the visible rows, the number a ways game puts on its own box. */
function waysCount(config: GameConfigDoc): number | null {
	const rows = config.numRows ?? [];
	if (rows.length === 0 || rows.some((r) => !r || r < 1)) return null;
	return rows.reduce((acc, r) => acc * r, 1);
}

function winModelText(ctx: ProfileContext): string {
	const model = ctx.winModel;
	switch (model.type) {
		case 'lines':
			return 'Line pays';
		case 'ways': {
			const ways = ctx.config ? waysCount(ctx.config) : null;
			const direction = model.direction === 'both' ? 'both ways' : 'left to right';
			return ways ? `${ways.toLocaleString('en-US')} ways · ${direction}` : `Ways · ${direction}`;
		}
		case 'cluster':
			return `Cluster pays · ${model.minCluster}+ ${model.adjacency}`;
		case 'scatter':
			return `Scatter pays · ${model.minCount}+ anywhere`;
	}
}

/**
 * The IDENTITY row. Order is the reading order an author wants: what kind of game, how it pays, how
 * big the board is, then the math headline, then what it runs on.
 */
const FACTS: readonly ChipSource[] = [
	{
		id: 'kind',
		title: 'Game kind — the template this project was created from.',
		text: (ctx) => ctx.gameTypeName,
	},
	{
		id: 'winModel',
		title: 'How a win is decided, from the Game Config win model.',
		// Suppressed without a config: `resolveWinModel` correctly defaults to `lines`, but printing
		// "Line pays" for a project that has stated nothing would be an assertion, not a reading.
		text: (ctx) => (ctx.config ? winModelText(ctx) : null),
	},
	{
		id: 'board',
		title: 'Board size from the Game Config (reels × visible rows).',
		text: (ctx) => (ctx.config ? boardText(ctx.config) : null),
	},
	{
		id: 'paylines',
		title: 'Paylines authored in the Game Config. The RGS is authoritative at runtime.',
		text: (ctx) => {
			if (!ctx.config || ctx.winModel.type !== 'lines') return null;
			const count = Object.keys(ctx.config.paylines ?? {}).length;
			return count > 0 ? plural(count, 'payline') : null;
		},
	},
	{
		id: 'rtp',
		title: 'Return to player declared by the Game Config.',
		text: (ctx) => (ctx.config?.rtp ? `${trimNumber(rtpPercent(ctx.config.rtp), 2)}% RTP` : null),
	},
	{
		id: 'maxWin',
		title: 'Highest max win across the config’s bet modes, as a multiple of the bet.',
		text: (ctx) => {
			const max = Math.max(0, ...ctx.betModes.map((m) => m.maxWin || 0));
			return max > 0 ? `×${max.toLocaleString('en-US')} max win` : null;
		},
	},
	{
		id: 'runtime',
		title: 'The shared prebuilt engine bundle this published game is served from.',
		// Deliberately NOT `${runtimeId} runtime`. Every online game is served from the same bundle,
		// so naming it says nothing about THIS game — and because the id is historically `lines`, it
		// read as a game type: a cluster game displaying "lines runtime" looked misconfigured, and
		// cost a real double-take. Name the bundle only if a second one ever exists.
		text: (ctx) =>
			ctx.runtimeId
				? ctx.runtimeId === SHARED_RUNTIME_ID
					? 'shared runtime'
					: `${ctx.runtimeId} runtime`
				: null,
	},
	{
		id: 'protocol',
		title: 'Which mock-RGS protocol the Invisible Test Server deals this game.',
		text: (ctx) => (ctx.protocol ? `${ctx.protocol} RGS protocol` : null),
	},
	{
		id: 'protocolDrift',
		tone: 'warn',
		title:
			'This game was published BEFORE its current game kind, so the test server is still ' +
			'dealing it the old protocol — its wins are decided the wrong way. Re-publish to fix.',
		// The card's other chips read LIVE state (kind, config), but `protocol` is stamped into the
		// manifest at publish. So the two silently disagree whenever a kind changes — or, as here,
		// whenever a kind gains a protocol it did not have when the game was last published, which
		// is exactly how a Cluster game sat on the `lines` mock being paid by paylines and looked
		// entirely healthy on the card. Comparing them is the only thing that makes that visible.
		text: (ctx) => {
			if (!ctx.protocol) return null;
			const expected = protocolFor(ctx.gameTypeId);
			return ctx.protocol === expected
				? null
				: `re-publish — dealing ${ctx.protocol}, kind wants ${expected}`;
		},
	},
	{
		id: 'configSource',
		title:
			'Whether this project authored its own Game Config, or still runs the game type’s template.',
		text: (ctx) =>
			ctx.configSource === 'authored'
				? 'own config'
				: `${ctx.gameTypeId} template config (not yet authored)`,
	},
];

/**
 * Whether the win-line overlay is actually drawn. Its sub-options are only real when it is: the
 * overlay stands down for a non-lines win model, so a ways or cluster game must not report a
 * payline feature it never shows.
 */
function winLineActive(ctx: ProfileContext): boolean {
	return ctx.winModel.type === 'lines' && ctx.symbols.winLine?.enabled !== false;
}

/**
 * The OPTIONAL feature table — "Using: …". One entry per switchable mechanic or presentation
 * feature. **This is the list that grows**: adding a mechanic to the engine means adding a row here
 * in the same change, so a shipped feature can never be invisible on the hub.
 */
const FEATURE_DETECTORS: readonly ChipSource[] = [
	{
		id: 'wild',
		title: 'A symbol with the `wild` special property is on the reel strips.',
		text: (ctx) => (ctx.props.has('wild') ? 'Wild symbol' : null),
	},
	{
		id: 'scatter',
		title: 'A symbol with the `scatter` special property is on the reel strips.',
		text: (ctx) => (ctx.props.has('scatter') ? 'Scatter symbol' : null),
	},
	{
		id: 'multiplierSymbol',
		title: 'A symbol with the `multiplier` special property is on the reel strips.',
		text: (ctx) => (ctx.props.has('multiplier') ? 'Multiplier symbol' : null),
	},
	{
		id: 'cascade',
		title:
			'Cluster/scatter kinds run the cascade (tumble) board: winning symbols explode, survivors slide down, new symbols fall in.',
		text: (ctx) =>
			ctx.gameTypeId === 'cluster' || ctx.gameTypeId === 'scatter'
				? 'Cascading reels (tumble)'
				: null,
	},
	{
		id: 'multiplierCollect',
		title:
			'The scatter kind adds the collect beat: multipliers landed during a tumble fly to the board centre and combine.',
		text: (ctx) => (ctx.gameTypeId === 'scatter' ? 'Multiplier collect' : null),
	},
	{
		id: 'expandingBook',
		title: 'The Book-of kind: one special symbol is scatter and expanding wild in the free spins.',
		text: (ctx) => (ctx.gameTypeId === 'bookOf' ? 'Expanding book symbol' : null),
	},
	{
		id: 'buyFeature',
		title: 'Bet modes that buy the feature outright, from the Game Config bet-mode menu.',
		text: (ctx) => {
			const buys = ctx.betModes.filter((m) => m.kind === 'buy');
			return buys.length ? `Buy feature (${plural(buys.length, 'option')})` : null;
		},
	},
	{
		id: 'anteBet',
		title: 'A bet mode the player toggles on and leaves on (a persistent stake boost).',
		text: (ctx) => (ctx.betModes.some((m) => m.kind === 'ante') ? 'Ante bet' : null),
	},
	{
		id: 'stackedPictures',
		title: 'Stacked-picture reel mode — tall per-symbol art spanning several cells.',
		text: (ctx) => {
			const stacked = ctx.symbols.stackedPictures;
			if (stacked?.enabled !== true || !stacked.symbols?.length) return null;
			const winArtCount = stacked.symbols.filter((s) => s.winArt?.assetKey).length;
			const notes = [
				stacked.fullHeightOnly ? 'full-height only' : null,
				stacked.edgeCutoffs ? 'edge cutoffs' : null,
				winArtCount ? plural(winArtCount, 'win picture') : null,
			].filter(Boolean);
			const suffix = notes.length ? ` · ${notes.join(', ')}` : '';
			return `Stacked pictures (${plural(stacked.symbols.length, 'symbol')})${suffix}`;
		},
	},
	{
		id: 'winLine',
		title:
			'The win-line overlay traced over a paying payline with the amount stamped on it. On unless switched off in the Symbols tool.',
		text: (ctx) => (winLineActive(ctx) ? 'Win-line display' : null),
	},
	{
		id: 'fullPayline',
		title: 'The win line traces the WHOLE payline, not just the winning segment.',
		text: (ctx) =>
			winLineActive(ctx) && ctx.symbols.winLine?.line?.fullPayline === true
				? 'Full-payline trace'
				: null,
	},
	{
		id: 'allWinLines',
		title:
			'Every paying line of a spin is drawn at the same time and stays on screen together, instead of being narrated one at a time.',
		text: (ctx) =>
			winLineActive(ctx) && ctx.symbols.winLine?.line?.allAtOnce === true
				? 'All win lines at once'
				: null,
	},
	{
		id: 'paylineColors',
		title: 'Per-payline win colours authored in the Game Config.',
		text: (ctx) => {
			if (!winLineActive(ctx)) return null;
			const count = Object.keys(ctx.config?.paylineColors ?? {}).length;
			return count > 0 ? `Per-line win colours (${count})` : null;
		},
	},
	{
		id: 'winCycle',
		title:
			'Winning symbols keep replaying on the resting board until the next spin. On unless switched off in the Symbols tool.',
		text: (ctx) => (ctx.symbols.winCycle?.enabled !== false ? 'Winning-symbol replay' : null),
	},
	{
		id: 'dimNonWinning',
		title: 'Non-winning symbols are darkened from the win celebration until the next spin.',
		text: (ctx) =>
			ctx.symbols.winCycle?.dimNonWinning === true ? 'Dim non-winning symbols' : null,
	},
	{
		id: 'holdAfterBigWin',
		title: 'A big win inside a free-spin feature holds the round until the player presses spin.',
		text: (ctx) => (ctx.symbols.winCycle?.holdAfterBigWin === true ? 'Hold after big win' : null),
	},
	{
		id: 'winExplode',
		title:
			'Each winning symbol plays its Explosion animation at the end of its win, before settling back to its post-win art.',
		text: (ctx) => (ctx.symbols.winExplode?.enabled === true ? 'Winning symbols explode' : null),
	},
	{
		id: 'winBeat',
		title:
			'No win or explosion beat holds the round longer than the authored ceiling — a long symbol animation is cut short.',
		text: (ctx) =>
			ctx.symbols.winBeat?.maxMs !== undefined
				? `Win beats cut at ${ctx.symbols.winBeat.maxMs}ms`
				: null,
	},
	{
		id: 'arrivalRelease',
		title:
			'The round is released as soon as the new symbols are on screen — their emerge intros still play, they are just no longer waited for.',
		text: (ctx) => (ctx.symbols.arrivalRelease?.enabled === true ? 'Released on arrival' : null),
	},
	{
		id: 'highlight',
		title: 'A custom win-frame spine looped over winning symbols.',
		text: (ctx) => (ctx.symbols.highlight ? 'Win-frame highlight' : null),
	},
	{
		id: 'boardGlow',
		title: 'A custom free-spin board-glow spine behind the reels.',
		text: (ctx) => (ctx.symbols.boardGlow ? 'Free-spin board glow' : null),
	},
	{
		id: 'bookVfx',
		title: 'Authored presentation layers drawn behind/in front of the book symbol in free spins.',
		text: (ctx) => (ctx.symbols.bookVfx ? 'Book-symbol VFX' : null),
	},
	{
		id: 'transition',
		title: 'An animation bridges each explosion into the next intro under the emerge swap style.',
		text: (ctx) => (ctx.symbols.transition ? 'Explosion transition' : null),
	},
	{
		id: 'anticipation',
		title: 'Reel anticipation — the per-reel tease overlay and its per-tier escalation.',
		text: (ctx) => (ctx.symbols.anticipation ? 'Reel anticipation' : null),
	},
	{
		id: 'explosionState',
		title: 'Symbols have an authored explosion animation — the cascade’s defining beat.',
		text: (ctx) =>
			ctx.states.has('explosion') || ctx.states.has('clearReel') ? 'Explosion animations' : null,
	},
	{
		id: 'tumblePattern',
		title:
			'The winning symbols explode in waves — by column, by row, out from the middle — rather than all in the same frame.',
		text: (ctx) => {
			const pattern = ctx.symbols.tumblePattern?.pattern;
			return pattern && pattern !== 'all'
				? `Explosion pattern: ${TUMBLE_PATTERN_LABELS[pattern]}`
				: null;
		},
	},
	{
		id: 'symbolNames',
		title: 'Symbols have display names, which Invisible Win Text reads as {symbolName}.',
		text: (ctx) => {
			const count = Object.keys(ctx.symbols.names ?? {}).length;
			return count > 0 ? `Named symbols (${count})` : null;
		},
	},
	{
		id: 'winTiers',
		title:
			'Config-authored big-win tiers replacing the coded ladder. Only `big` tiers get the full-screen presentation.',
		text: (ctx) => {
			const big = ctx.tiers.filter((t) => t.type === 'big');
			return big.length ? `Big-win tiers (${big.length})` : null;
		},
	},
	{
		id: 'escalateTiers',
		title: 'A win plays every tier up to the one it hits, over one continuous count-up.',
		text: (ctx) => (ctx.config?.escalateTiers === true ? 'Escalating win tiers' : null),
	},
];

/**
 * The `special_properties` a game genuinely has, from the symbols that are on the strips OR carry a
 * paytable.
 *
 * NOT `symbolsInPlay` alone, which is the usual gate. `paddingReels` is the COSMETIC blur filler,
 * and a symbol that only ever arrives through a feature is legitimately absent from it — the
 * reference `lines` config's wild `W` is exactly that: dictionary + paytable, never on a padding
 * strip. Gating on the strips alone therefore reports "no wild" for a game that plainly has one.
 * A paytable is the other half of the evidence: the math pays this symbol, so it exists. A symbol
 * with neither (a purely decorative dictionary entry) is still correctly excluded.
 */
function liveProperties(config: GameConfigDoc): Set<string> {
	const inPlay = new Set(symbolsInPlay(config));
	const props = new Set<string>();
	for (const [name, symbol] of Object.entries(config.symbols)) {
		if (!inPlay.has(name) && !symbol.paytable?.length) continue;
		for (const prop of symbol.special_properties ?? []) props.add(prop);
	}
	return props;
}

function buildContext(signals: GameProfileSignals): ProfileContext {
	const config = signals.config;
	const props = config ? liveProperties(config) : new Set<string>();

	const states = new Set<string>();
	for (const cells of Object.values(signals.symbols.symbols ?? {})) {
		for (const state of Object.keys(cells ?? {})) states.add(state);
	}

	return {
		...signals,
		winModel: resolveWinModel(config ?? undefined),
		props,
		betModes: config ? resolveBetModes(config) : [],
		tiers: config ? (resolveWinLevels(config) ?? []) : [],
		states,
	};
}

function render(sources: readonly ChipSource[], ctx: ProfileContext): ProfileChip[] {
	const out: ProfileChip[] = [];
	for (const source of sources) {
		const text = source.text(ctx);
		if (text) {
			out.push({
				id: source.id,
				text,
				title: source.title,
				...(source.tone && { tone: source.tone }),
			});
		}
	}
	return out;
}

/** Build a project's card summary. Pure — every signal is resolved by the caller. */
export function buildGameProfile(signals: GameProfileSignals): GameProfile {
	const ctx = buildContext(signals);
	return { facts: render(FACTS, ctx), features: render(FEATURE_DETECTORS, ctx) };
}
