/**
 * ESM resolve hook that lets a plain `node` script import the workspace's TypeScript sources.
 *
 * Node can STRIP types on its own (`--experimental-strip-types`), but it will not guess an
 * extension: the packages import each other as `./sessionState`, which resolves under a bundler and
 * fails under node. That single gap is why the facade had no runnable gate — every check had to stop
 * at the mock's wire and take the client half on trust, which is exactly where the stake bug lived.
 *
 * Usage:  node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/<gate>.mjs
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
	new URL(
		'data:text/javascript,' +
			encodeURIComponent(`
				export async function resolve(specifier, context, next) {
					try {
						return await next(specifier, context);
					} catch (err) {
						// Only extensionless RELATIVE specifiers are retried; anything else keeps its
						// original error so a genuinely missing package still reads as one.
						if (!specifier.startsWith('.') || /\\.[a-z]+$/i.test(specifier)) throw err;
						for (const ext of ['.ts', '/index.ts']) {
							try {
								return await next(specifier + ext, context);
							} catch {}
						}
						throw err;
					}
				}
			`),
	),
	pathToFileURL('./'),
);
