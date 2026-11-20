/**
 * What `check:characters-tool` stands in for so a section can drive the real `/api/characters/*`
 * routes: the gate the routes ask (`$lib/server/toolScope` is replaced whole by §10, so the
 * section hands the real one back through here), and the R2 calls §8's in-memory store does not
 * answer yet.
 */
type Stored = { body: string; etag: string };

export const standIns: {
	/** `toolScope.gate`, as the section sets it. */
	gate: (...args: unknown[]) => Promise<unknown>;
	/** While set, a folder listing under a prefix that ends with `under` fails with `message`. */
	listingFault: { under: string; message: string } | undefined;
} = {
	gate: async () => {
		throw new Error('fixture: no gate is stood in');
	},
	listingFault: undefined,
};

/** The R2 calls a rig read makes, over the gate's in-memory store. */
export function moreR2(store: Map<string, Stored>): Record<string, unknown> {
	return {
		listObjects: async (prefix: string) => {
			const fault = standIns.listingFault;
			if (fault && prefix.endsWith(fault.under)) throw new Error(fault.message);
			const keys: string[] = [];
			const prefixes = new Set<string>();
			for (const key of [...store.keys()].sort()) {
				if (!key.startsWith(prefix)) continue;
				const rest = key.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash === -1) keys.push(key);
				else prefixes.add(prefix + rest.slice(0, slash + 1));
			}
			return { keys, prefixes: [...prefixes] };
		},
		listAllKeys: async (prefix: string) => [...store.keys()].filter((k) => k.startsWith(prefix)),
		objectExists: async (key: string) => store.has(key),
		getObjectBytes: async (key: string) => {
			const o = store.get(key);
			return o
				? {
						body: new TextEncoder().encode(o.body),
						contentType: 'application/octet-stream',
						etag: o.etag,
					}
				: null;
		},
	};
}
