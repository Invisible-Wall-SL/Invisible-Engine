/**
 * What Invisible Director may never do, enforced in code (ADR-0002 "Hard refusals"; root
 * `CLAUDE.md` Director ground rules 2–4). Two layers, each tested by a fixture that tries the
 * forbidden thing on purpose (`scripts/check-director-adapters.ts`):
 *
 * 1. **No op exists** for publishing, writing Game Config, changing roles or overrides, merging a
 *    pipeline change, or writing an agent definition. The gate refuses a call that NAMES one of
 *    them before it looks at the registry, and the registry refuses to load if anyone ever adds one.
 * 2. **No write lands on a forbidden key**, whatever op asks for it: the locked math contract,
 *    published snapshots, the test server's manifest and bundles, and the agent definitions.
 */

export type RefusalId = 'publish' | 'game_config' | 'roles' | 'merge' | 'agent_definitions';

export interface Refusal {
	id: RefusalId;
	message: string;
}

const REFUSALS: Record<RefusalId, string> = {
	publish: 'Agents never publish. The owner publishes from Invisible Game Maker after hand-off.',
	game_config:
		"The template's math is locked. Game Config changes are made by a person in Invisible Game Config, outside Director.",
	roles: 'Agents never change roles, tool access or capability overrides.',
	merge: 'Agents never merge or write a pipeline change. Merges are approved by a person.',
	agent_definitions:
		'Agent definitions change only as a pipeline change, reviewed and merged by a person.',
};

const refusal = (id: RefusalId): Refusal => ({ id, message: REFUSALS[id] });

/** Tool names that are Game Config, however they are spelled. */
const GAME_CONFIG_TOOLS = new Set(['config', 'gameconfig', 'game_config', 'game-config']);
/** Tool names that are role / access administration. */
const ROLE_TOOLS = new Set(['roles', 'role', 'access', 'admin', 'overrides', 'capabilities']);
/** Tool names that are the pipeline's branches and merges. */
const PIPELINE_TOOLS = new Set([
	'pipeline',
	'pipelinechanges',
	'pipeline_changes',
	'git',
	'github',
]);
/** Tool names that are the runtime agents' own definitions. */
const AGENT_TOOLS = new Set(['agents', 'agent', 'agent_definitions', 'agent-definitions']);

/** A read op name: these never change anything, so a refused AREA may still be read from. */
const READ_OP = /^(get|list|read)(_|$)/;

/**
 * Why a call to `<tool>.<op>` is refused outright, or `null`. Matched on the NAME, before the
 * registry is consulted, so a forbidden op is refused even if someone registered it — and
 * {@link assertNoRefusedOps} stops anyone from registering it in the first place.
 */
export function refusedOp(tool: string, op: string): Refusal | null {
	const t = tool.toLowerCase();
	const o = op.toLowerCase();
	if (/publish/.test(t) || /publish/.test(o)) return refusal('publish');
	if (/merge/.test(o) || PIPELINE_TOOLS.has(t)) return refusal('merge');
	if (
		ROLE_TOOLS.has(t) ||
		/(^|_)(role|roles|override|overrides|grant|revoke|capability)(_|$)/.test(o)
	) {
		return refusal('roles');
	}
	if (GAME_CONFIG_TOOLS.has(t) && !READ_OP.test(o)) return refusal('game_config');
	if (/(^|_)(config|paytable|bet_?modes?|paylines)(_|$)/.test(o) && !READ_OP.test(o)) {
		return refusal('game_config');
	}
	if (AGENT_TOOLS.has(t) && !READ_OP.test(o)) return refusal('agent_definitions');
	if (/agent_?def/.test(o)) return refusal('agent_definitions');
	return null;
}

/**
 * Keys no Director write may target. `*` is one or more path segments: the math contract is
 * `<client>/<project>/config/config.json`, and published snapshots sit under
 * `<client>/<project>/published/`.
 */
const FORBIDDEN_TARGETS: { id: RefusalId; test: (key: string) => boolean }[] = [
	{ id: 'game_config', test: (k) => /(^|\/)config\/config\.json$/.test(k) },
	{ id: 'publish', test: (k) => /(^|\/)published(\/|$)/.test(k) },
	{ id: 'publish', test: (k) => k === 'test_server' || k.startsWith('test_server/') },
	{
		id: 'agent_definitions',
		test: (k) =>
			k === 'services/director-worker/agents' || k.startsWith('services/director-worker/agents/'),
	},
];

/**
 * Why a write to `key` is refused, or `null`. A key ending in `/` is a PREFIX the op writes under:
 * refused when it is inside a forbidden area, or when it spans a whole client or project tree
 * (`<client>/` or `<client>/<project>/`) or a project's `config/` folder, which hold the math
 * contract. A key that tries to escape (`..`, a leading `/`, a backslash) is refused outright.
 */
export function refusedWriteTarget(key: string): Refusal | null {
	if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) {
		return refusal('publish');
	}
	const probe = key.endsWith('/') ? `${key}x` : key;
	for (const target of FORBIDDEN_TARGETS) {
		if (target.test(key) || target.test(probe)) return refusal(target.id);
	}
	if (key.endsWith('/')) {
		const segments = key.split('/').filter(Boolean);
		if (segments.length <= 2 || /^[^/]+\/[^/]+\/config\/$/.test(key)) return refusal('game_config');
	}
	return null;
}

/** Throws when a registry names an op the refusals forbid — run where the registry is built. */
export function assertNoRefusedOps(ops: Iterable<{ tool: string; name: string }>): void {
	for (const op of ops) {
		const hit = refusedOp(op.tool, op.name);
		if (hit) {
			throw new Error(`Director adapter ${op.tool}.${op.name} is a hard refusal (${hit.id})`);
		}
	}
}
