import { isDirectorAgent, type AdapterOp } from './adapter';
import { ATLAS_OPS } from './ops/atlas';
import { ATLAS_SETUP_OPS } from './ops/atlasSetup';
import { FLIPBOOK_OPS } from './ops/flipbook';
import { FONTS_OPS } from './ops/fonts';
import { GAMEMAKER_OPS } from './ops/gamemaker';
import { LOCALIZATION_OPS } from './ops/localization';
import { MOCKUP_OPS } from './ops/mockups';
import { RIGGER_OPS } from './ops/rigger';
import { SCENE_OPS } from './ops/scene';
import { SYMBOLS_OPS } from './ops/symbols';
import { WINTEXT_OPS } from './ops/wintext';
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
		// The one op the write-target guard exempts. Pinned by id so no other op can claim it.
		if (op.write && 'createsProject' in op && id !== 'gamemaker.create_from_template') {
			throw new Error(
				`Director adapter ${id}: only gamemaker.create_from_template creates projects`,
			);
		}
		if (op.write && 'createsProject' in op && op.scope !== 'template') {
			throw new Error(`Director adapter ${id}: creating the project is scoped to its template`);
		}
		out.set(id, op);
	}
	return out;
}

/**
 * Allow-list entries a definition may name or not, as `<op id> <agent>` (ADR-0008 card 8D): its
 * code lands before its three definitions, one PR each, so until they land the artist still names
 * the four ops it gives up to the technician and the coordinator does not name the catalogue yet.
 * The Agents tab accepts a definition either way and `check:director-adapters` holds every other
 * entry to the definitions both ways. Remove each entry once the definition that settles it lands.
 */
export const TRANSITION_TOOLS: ReadonlySet<string> = new Set([
	'atlas.queue_variants atlas-artist',
	'atlas.choose_variant atlas-artist',
	'atlas.pack_sheet atlas-artist',
	'comfyui.job_status atlas-artist',
	'atlas.list_blueprints coordinator',
]);

/** Every Director adapter op. */
export const ADAPTER_OPS = buildRegistry([
	...GAMEMAKER_OPS,
	...ATLAS_OPS,
	...ATLAS_SETUP_OPS,
	...MOCKUP_OPS,
	...SYMBOLS_OPS,
	...SCENE_OPS,
	...WINTEXT_OPS,
	...LOCALIZATION_OPS,
	...FONTS_OPS,
	...RIGGER_OPS,
	...FLIPBOOK_OPS,
]);
