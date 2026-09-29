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
