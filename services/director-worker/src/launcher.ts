import type { JsonSchema, ToolSpec } from './model.ts';

/**
 * The worker's side of the launcher's adapter gate (ADR-0002): the catalog of ops the launcher
 * serves, and one op call. The worker offers a model only the ops the catalog lists, and declares
 * `agent` itself from the definition it runs — never from model output.
 */

export interface AdapterSpec extends ToolSpec {
	write: boolean;
}

export interface AdapterResult {
	/** HTTP status; 200 = the op ran (or its stored result was replayed). */
	status: number;
	body: unknown;
}

export interface Launcher {
	/** The ops served now, by id. Throws when the launcher can't be asked. */
	catalog(): Promise<ReadonlyMap<string, AdapterSpec>>;
	call(
		id: string,
		body: { runId: string; agent: string; opId?: string; input: unknown },
		signal: AbortSignal,
	): Promise<AdapterResult>;
}

/** How long a fetched catalog is reused before it is asked for again. */
const CATALOG_TTL_MS = 60_000;

export function httpLauncher(baseUrl: string, token: string): Launcher {
	const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
	let cached: { at: number; ops: ReadonlyMap<string, AdapterSpec> } | null = null;
	return {
		async catalog() {
			if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.ops;
			const res = await fetch(`${baseUrl}/api/director/adapter`, { headers });
			if (!res.ok) throw new Error(`adapter catalog answered ${res.status}`);
			const body = (await res.json()) as {
				ops: { id: string; description: string; inputSchema: JsonSchema; write: boolean }[];
			};
			const ops = new Map(body.ops.map((op) => [op.id, op]));
			cached = { at: Date.now(), ops };
			return ops;
		},
		async call(id, body, signal) {
			const [tool, op] = id.split('.');
			const res = await fetch(`${baseUrl}/api/director/adapter/${tool}/${op}`, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal,
			});
			let parsed: unknown = null;
			try {
				parsed = await res.json();
			} catch {
				parsed = { error: 'bad_response', message: `The adapter answered ${res.status}.` };
			}
			return { status: res.status, body: parsed };
		},
	};
}
