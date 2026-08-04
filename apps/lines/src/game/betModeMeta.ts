import { resolveBetModes, type BetModeKind, type ResolvedBetMode } from 'game-config';
import { stateMeta, type BetModeData, type BetModeMeta } from 'state-shared';

import { getActiveGameConfig } from './gameConfig';
import { bakedEditorArtAssets } from '../editor-scenes';

/**
 * Resolve a bet-mode art KEY (an editor-art asset key, Phase 7) to a renderable image URL. A bet-mode
 * icon is a single image, so only the `'sprite'` entry has a usable URL — its `.src` is the same file
 * URL the engine loads. A `'sprites'` sheet (`.src` is the atlas JSON) or a `'spine'` skeleton can't be
 * an `<img>`, so they resolve to empty. An unauthored/unshipped key (absent from the baked art index —
 * e.g. not yet reachable in the bundle) is empty too, so a consumer draws nothing rather than a broken
 * image. Matches the `BetModeData.assets.*` = URL convention the old `DEFAULT_BET_MODE_META` used.
 */
function artUrl(key: string): string {
	if (!key) return '';
	const entry = bakedEditorArtAssets()[key];
	return entry?.type === 'sprite' && typeof entry.src === 'string' ? entry.src : '';
}

/**
 * Build the bet-selector / buy-bonus menu from the ACTIVE game config, replacing the hardcoded
 * `DEFAULT_BET_MODE_META` placeholder that every project used to share (`SAMURAI SPIN`, `test-fart-
 * cdn` URLs — the bet-mode face of the "one hardcoded blob for everyone" bug). Phase 6 of
 * `docs/design/invisible-game-config.md`.
 *
 * `game-config` owns the math + presentation (`resolveBetModes` folds them, with defaults); this
 * module is the ONE bridge from that neutral shape into state-shared's `BetModeData`, because
 * `game-config` is a leaf package that must not import Svelte state.
 *
 * Two boundary conventions preserved here so the RGS contract is byte-identical to before:
 *  - **Keys are UPPERCASED.** The config authors modes as `base`/`bonus`; the runtime state (and the
 *    `activeBetModeKey = 'BASE'` resets scattered through the machines) use `BASE`, and that key is
 *    sent to the RGS as `mode`. Uppercasing here keeps the wire value exactly what the placeholder
 *    sent, and matches the case-insensitive lookups that already exist (`stateBet.activeBetMode`).
 *  - **Text stays SOURCE strings.** The bonus components translate at render (the "key IS the source
 *    text" i18n model), so a language set after this runs still localizes — no boot-order coupling.
 *
 * Assets (icon / dialog image / volatility art) are deliberately left empty: those are an asset
 * class for the live-asset pipeline (referenced by key), not literal URLs baked into a config —
 * a later phase. An un-authored project still gets a working menu, just without placeholder art.
 */

const KIND_TO_TYPE: Record<BetModeKind, BetModeData['type']> = {
	base: 'default',
	ante: 'activate',
	buy: 'buy',
};

const EMPTY_ASSETS: BetModeData['assets'] = {
	icon: '',
	volatility: '',
	button: '',
	dialogImage: '',
	dialogVolatility: '',
};

/** One resolved mode → the state-shared shape. Text fields carry SOURCE strings (translated at
 *  render); ticker/banner have no config home yet, so they stay empty. */
function toBetModeData(mode: ResolvedBetMode): BetModeData {
	return {
		mode: mode.mode.toUpperCase(),
		costMultiplier: mode.costMultiplier,
		maxWin: mode.maxWin,
		type: KIND_TO_TYPE[mode.kind],
		parent: '',
		children: '',
		// The per-mode card ComponentDef id — passed through so the buy-feature repeater can stamp it
		// as the item's `componentId`. Empty when unauthored ⇒ the item omits `componentId` ⇒ the
		// default `featureCard` (parity).
		card: mode.card,
		// Art keys are resolved HERE to image URLs (the `assets.* = URL` convention), so the HTML menu
		// renders them with a plain `<img>`. `button`/`dialogVolatility` have no config home yet, so
		// stay empty.
		assets: {
			...EMPTY_ASSETS,
			icon: artUrl(mode.art.icon),
			dialogImage: artUrl(mode.art.dialogImage),
			volatility: artUrl(mode.art.volatility),
		},
		text: {
			title: mode.title,
			description: mode.description,
			button: mode.button,
			dialog: mode.dialog,
			betAmountLabel: mode.betAmountLabel,
			tickerIdle: '',
			tickerSpin: '',
			bannerText: '',
		},
	};
}

/** The menu keyed by UPPERCASED mode id, in resolved order. */
export function buildBetModeMeta(): BetModeMeta {
	const meta: BetModeMeta = {};
	for (const mode of resolveBetModes(getActiveGameConfig())) {
		meta[mode.mode.toUpperCase()] = toBetModeData(mode);
	}
	return meta;
}

/**
 * Push the config-derived menu into `stateMeta.betModeMeta`. Called at boot AND after the live
 * runtime bundle applies (`Game.svelte`, next to `resetGameConfigCache`) — the online config
 * resolves after module init, so without the second call an online game would keep the boot-time
 * (compiled-template) menu. Idempotent: it always rebuilds from the current active config.
 */
export function syncBetModeMeta(): void {
	const meta = buildBetModeMeta();
	// A config with no authored bet modes must never blank the selector: leave the existing
	// (default) meta in place rather than hand the game an empty menu with no selectable mode.
	// A well-formed Invisible Game Config always has `betModes` (the math contract), so this only
	// guards a malformed/empty config — but it does so for every online project on the shared bundle.
	if (Object.keys(meta).length === 0) return;
	stateMeta.betModeMeta = meta;
}
