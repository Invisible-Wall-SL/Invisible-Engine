/**
 * What the sections of `check:characters-tool` that call a REAL route handler share. The gate's
 * in-memory R2 is the one §8 installs over `lib/server/r2.ts`; a section reads it back through
 * that module, so there is one store and one set of ETags.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isHttpError } from '@sveltejs/kit';

const src = (rel: string): string => new URL(`../../src/${rel}`, import.meta.url).href;

const faked = new Set<string>();

/** Stand `fakes` in for a server module, once per run: every other export of it throws by name,
 *  so a section that reaches one learns which. */
export function fakeServerModule(rel: string, fakes: Record<string, unknown>): void {
	if (faked.has(rel)) return;
	faked.add(rel);
	const namedExports: Record<string, unknown> = {};
	for (const m of readFileSync(fileURLToPath(src(rel)), 'utf8').matchAll(
		/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm,
	))
		namedExports[m[1]] =
			fakes[m[1]] ??
			(() => {
				throw new Error(`fixture: ${rel} ${m[1]} is not faked`);
			});
	mock.module(src(rel), { namedExports });
}

/** No per-role and no per-user grant is stored, so a user holds exactly its role's tools
 *  (`ROLE_TOOLS`) and the routes' own gates decide on them. */
export function fakeStoredGrants(): void {
	fakeServerModule('lib/server/roleToolAccess.ts', { getRoleOverrides: async () => ({}) });
	fakeServerModule('lib/server/userToolAccess.ts', { getToolOverrides: async () => ({}) });
}

export interface RouteUser {
	id: string;
	role: string;
}

/** Call a route handler as `user`; an `error()` it throws is the response SvelteKit would send. */
export async function callRoute(
	handler: (event: never) => Response | Promise<Response>,
	url: URL,
	init: RequestInit | undefined,
	user: RouteUser,
): Promise<Response> {
	try {
		return await handler({ request: new Request(url, init), url, locals: { user } } as never);
	} catch (e) {
		if (!isHttpError(e)) throw e;
		return new Response(JSON.stringify(e.body), {
			status: e.status,
			headers: { 'content-type': 'application/json' },
		});
	}
}

/** The gate's in-memory R2, read back: an object's text and ETag, and the keys under a prefix. */
export async function memoryR2(): Promise<{
	read: (key: string) => Promise<{ text: string; etag: string } | null>;
	keys: (prefix: string) => Promise<string[]>;
}> {
	const r2 = (await import(src('lib/server/r2.ts'))) as {
		getObjectTextWithEtag: (key: string) => Promise<{ text: string; etag: string } | null>;
		listAllObjects: (prefix: string) => Promise<{ key: string }[]>;
	};
	return {
		read: r2.getObjectTextWithEtag,
		keys: async (prefix) => (await r2.listAllObjects(prefix)).map((o) => o.key).sort(),
	};
}
