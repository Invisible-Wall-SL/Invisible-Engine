declare const __IE_DEBUG__: boolean;
/** The build stamp + provenance baked by `config-vite` (`buildStamp`). The provenance fields are
 *  optional because the reference apps other than `lines` still bake only the stamp. */
declare const __IE_BUILD__: {
	version: string;
	sha?: string;
	builtAt: string;
	debug: boolean;
	engineSha?: string;
	gameSha?: string;
	lockfileSha256?: string;
	launcherVersion?: string;
};
/** A build pinned to one art tier (`config-vite` `artTierPin.js`), `''` when it picks per screen. */
declare const __IE_ART_TIER__: string;
/** The game families compiled into the bundle (`config-vite` `PUBLIC_IE_FAMILIES`); `slot` always. */
declare const __IE_FAMILIES__: readonly import('game-config').ConfigFamily[];
/** A standalone build that may have left stock files out (`config-vite` `stockAssetPrune.js`). */
declare const __IE_STOCK_PRUNED__: boolean;
/** The stock descriptors whose KTX2 twins this build ships, each to its twin, relative to `assets/`
 *  (`config-vite` `stockTwins.js`). */
declare const __IE_STOCK_TWINS__: Record<string, string>;
