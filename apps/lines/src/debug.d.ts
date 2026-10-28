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
/** The game families compiled into the bundle (`config-vite` `PUBLIC_IE_FAMILIES`); `slot` always. */
declare const __IE_FAMILIES__: readonly import('game-config').ConfigFamily[];
