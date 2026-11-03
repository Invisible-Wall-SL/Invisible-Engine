import { createHash } from 'node:crypto';

/**
 * Debug IDs for a hidden-source-map build (`IE_SOURCEMAPS=hidden`, the runtime release), so Sentry
 * can name the map for any frame without the map, or a reference to it, ever being served.
 * Dependency-free, so `scripts/sentry-sourcemaps.mjs` and its fixtures share it.
 *
 * Each client chunk gets, at its END (so no mapping moves), the snippet Sentry's own bundler
 * plugins write — `_sentryDebugIds[<a stack naming this file>] = <id>` — and a `//# debugId=<id>`
 * comment, which is what `sentry-cli` reads to pair the chunk with its map. The id is a hash of the
 * chunk's code, so the same code always gets the same id. Added in `renderChunk` with
 * `order: 'post'`: after minification (terser drops comments), and before Rollup hashes the file
 * name, so the name still changes whenever the content does.
 */

/** A UUID named by `content`, so a re-run of the same build gets the same debug ID. */
export const debugIdFor = (content) => {
	const hex = createHash('sha256').update(content).digest('hex');
	const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export const debugIdSnippet = (id) =>
	`!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof globalThis?globalThis:self,n=(new e.Error).stack;n&&((e._sentryDebugIds=e._sentryDebugIds||{})[n]="${id}")}catch(e){}}();`;

export const DEBUG_ID_COMMENT = /\/\/# debugId=([0-9a-f-]{36})\s*$/;

export const withDebugId = (code) => {
	const id = debugIdFor(code);
	const body = code.endsWith('\n') ? code : `${code}\n`;
	return { id, code: `${body}${debugIdSnippet(id)}\n//# debugId=${id}\n` };
};

export const sentryDebugIds = ({ enabled }) => {
	let ssr = false;
	return {
		name: 'ie:sentry-debug-ids',
		apply: 'build',
		configResolved(config) {
			ssr = Boolean(config.build.ssr);
		},
		renderChunk: {
			order: 'post',
			// `map: null` keeps the chunk's map as it is: nothing before the appended lines moved.
			handler: (code) => (enabled && !ssr ? { code: withDebugId(code).code, map: null } : null),
		},
	};
};
