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
		// Per-mode card param overrides — passed through so the repeater merges them into the item's
		// values (any card param the mode overrides). `{}` when unauthored ⇒ no overrides (parity).
		cardParams: mode.cardParams,
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

/** One bet option as the RGS facade published it (`__IE_SERVER_BET_OPTIONS__`). */
type ServerBetOption = { key: string; index: number; costMultiplier: number };

/** The options the SERVER declared, or null when it declared none (both mocks, every server before
 *  the 2-complex node) — in which case the authored config stands, exactly as before. */
function serverBetOptions(): ServerBetOption[] | null {
	const list = (globalThis as { __IE_SERVER_BET_OPTIONS__?: ServerBetOption[] })
		.__IE_SERVER_BET_OPTIONS__;
	return Array.isArray(list) && list.length ? list : null;
}

const normalise = (key: string) => key.replace(/[^a-z0-9]/gi, '').toLowerCase();

/** `BUYBONUS` → `Buybonus`. Only reached for an option the authored config knows nothing about, so
 *  the card says something rather than nothing. */
const prettify = (key: string) =>
	key.charAt(0).toUpperCase() + key.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Fold the SERVER's option table together with the game's authored presentation.
 *
 * The server owns the LIST and the PRICES: one menu entry per declared option, and nothing the math
 * did not declare. Book of Borut authors three buy cards (25× / 50× / 100×) while game 2 declares
 * one buy option — so it must show one, because the other two are prices the wallet would refuse.
 *
 * The config owns the LOOK: title, copy and art come from the authored mode that corresponds to the
 * option. Correspondence is by NAME first, then by equal cost — the cost fallback is what lets a
 * server that sends no `betOptionsName` still light up the right card (Borut's 100× BONUS art
 * against the server's 100× buy option), and it is presentation-only, so a wrong guess costs a
 * label, never a charge.
 */
function mergeServerOptions(
	options: ServerBetOption[],
	authored: ResolvedBetMode[],
): ResolvedBetMode[] {
	const byName = new Map(authored.map((mode) => [normalise(mode.mode), mode]));
	const base = authored.find((mode) => mode.kind === 'base') ?? authored[0];

	return options.map((option) => {
		const match =
			byName.get(normalise(option.key)) ??
			authored.find(
				(mode) =>
					mode.kind !== 'base' && Math.abs(mode.costMultiplier - option.costMultiplier) < 0.001,
			);
		const kind: BetModeKind =
			option.index === 0 ? 'base' : /ante/.test(normalise(option.key)) ? 'ante' : 'buy';
		const presentation = match ?? (kind === 'base' ? base : undefined);

		return {
			...(presentation ?? base),
			// An option the config never authored gets a readable label instead of the base game's.
			...(presentation
				? {}
				: { title: prettify(option.key), description: '', dialog: '', card: '', cardParams: {} }),
			mode: option.key,
			kind,
			costMultiplier: option.costMultiplier,
			order: option.index,
		};
	});
}

/** The menu keyed by UPPERCASED mode id, in resolved order — the SERVER's options when it declared
 *  any, else the authored config's. */
export function buildBetModeMeta(): BetModeMeta {
	const authored = resolveBetModes(getActiveGameConfig());
	const options = serverBetOptions();
	const modes = options && authored.length ? mergeServerOptions(options, authored) : authored;

	const meta: BetModeMeta = {};
	for (const mode of modes) {
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
	publishBetModeCostsToFacade(meta);
}

/**
 * Publish each mode's buy COST MULTIPLIER to a global the RGS FACADE reads
 * (`packages/rgs-translator-eagaming/engineFacade.ts` → `betModeCostMultiplier`). The facade is a
 * drop-in for `rgs-requests` and can't import this app, so a global is the decoupled bridge — the
 * mirror of `publishWinLevelsToFacade`. It lets the facade charge the SELECTED mode's cost
 * (`betAmount × costMultiplier`, the price its card shows) instead of a fixed buy premium, so the
 * amount debited matches the tapped card. Keyed by the UPPERCASE mode key (the wire `mode`). Coupled
 * to the buy MENU by construction — both come from this one `syncBetModeMeta` — so a card can never
 * be tapped without its cost already published.
 */
function publishBetModeCostsToFacade(meta: BetModeMeta): void {
	const costs: Record<string, number> = {};
	for (const [key, mode] of Object.entries(meta)) costs[key] = mode.costMultiplier;
	(globalThis as { __IE_BET_MODES__?: Record<string, number> }).__IE_BET_MODES__ = costs;
}
