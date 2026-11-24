import { error, isHttpError } from '@sveltejs/kit';

/**
 * `make()`, work over what the author sent (a fit to their joints, a rig built on their art): an
 * `error()` it throws passes through, and any other throw is a 422 `<what>: <its message>`, logged,
 * so the page shows why instead of SvelteKit's bare 500 "Internal Error". Imports nothing else, so
 * the pure modules the Rigger spikes bundle can use it.
 */
export function refuseOnThrow<T>(what: string, make: () => T): T {
	try {
		return make();
	} catch (e) {
		if (isHttpError(e)) throw e;
		console.error(`[refuseOnThrow] ${what}:`, e);
		const why = e instanceof Error ? e.message : String(e);
		throw error(422, `${what}: ${why.replace(/\.$/, '')}.`);
	}
}
