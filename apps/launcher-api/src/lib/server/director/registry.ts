import { isDirectorAgent, type AdapterOp } from './adapter';
import { GAMEMAKER_OPS } from './ops/gamemaker';
import { assertNoRefusedOps } from './refusals';

/** `<tool>.<op>` — the id an agent's frontmatter `tools:` list names. */
export const opId = (op: { tool: string; name: string }) => `${op.tool}.${op.name}`;

/**
 * Build a registry, refusing one that breaks a rule the gate relies on. Run at import, so a bad op
 * stops the launcher booting rather than reaching an agent.
 */
export function buildRegistry(ops: readonly AdapterOp[]): ReadonlyMap<string, AdapterOp> {
	assertNoRefusedOps(ops);
	const out = new Map<string, AdapterOp>();
	for (const op of ops) {
		const id = opId(op);
		if (out.has(id)) throw new Error(`Director adapter ${id} is registered twice`);
		if (!/^[a-z]+$/.test(op.tool) || !/^[a-z_]+$/.test(op.name)) {
			throw new Error(`Director adapter ${id}: tool and op names are lower-case words`);
		}
		if (op.agents.length === 0 || !op.agents.every(isDirectorAgent)) {
			throw new Error(`Director adapter ${id}: its agents must be known and non-empty`);
		}
		if (op.inputSchema.type !== 'object' || op.inputSchema.additionalProperties !== false) {
			throw new Error(`Director adapter ${id}: its input schema must be a closed object`);
		}
		const key = op.inputSchema.properties.key;
		const keyChecked = key?.type === 'string' && key.pattern !== undefined;
		if (op.scope === 'input' && !(keyChecked && op.inputSchema.required?.includes('key'))) {
			throw new Error(`Director adapter ${id}: an input-scoped op needs a required, patterned key`);
		}
		if (op.write && 'writes' in op && op.scope !== 'project') {
			throw new Error(`Director adapter ${id}: a write op writes only inside the run's project`);
		}
		if (op.write && 'createsProject' in op && op.scope !== 'template') {
			throw new Error(`Director adapter ${id}: creating the project is scoped to its template`);
		}
		out.set(id, op);
	}
	return out;
}

/** Every Director adapter op. A tool's ops arrive with its PLAN task (2.4 Atlas Maker, 2.6 the rest). */
export const ADAPTER_OPS = buildRegistry([...GAMEMAKER_OPS]);
