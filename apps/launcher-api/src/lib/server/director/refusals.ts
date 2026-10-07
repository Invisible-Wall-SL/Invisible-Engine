/**
 * What Invisible Director may never do, enforced in code (ADR-0002 "Hard refusals"; root
 * `CLAUDE.md` Director ground rules 2–4). Two layers, each tested by a fixture that tries the
 * forbidden thing on purpose (`scripts/check-director-adapters.ts`):
 *
 * 1. **No op exists** for publishing, writing Game Config, changing roles or overrides, merging a
 *    pipeline change, or writing an agent definition. The gate refuses a call that NAMES one of
 *    them before it looks at the registry, and the registry refuses to load if anyone ever adds one.
 * 2. **No write lands on a forbidden key**, whatever op asks for it: the locked math contract,
 *    published snapshots, the test server's manifest and bundles, the agent definitions, the
 *    shared blueprint library (`_shared/`) and a project's global Atlas Maker config.
 * 3. **Ops refuse what their input asks for** (ADR-0008 §3): a handler throws `RefusalError` with
 *    one of these ids — a layer on a template atlas, a global or run-on key, a tile that is not
 *    this run's to replace — and the gate answers it like the two layers above.
 */

export type RefusalId =
	| 'publish'
	| 'game_config'
	| 'roles'
	| 'merge'
	| 'agent_definitions'
	| 'library'
	| 'layers'
	| 'template_rect'
	| 'template_add'
	| 'global_config'
	| 'run_on'
	| 'art_deletion';

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
	library:
		'Agents never write the blueprint library, a blueprint card or the shared taxonomy. A card is reviewed by the owner in Atlas Maker.',
	layers:
		'Layers are added or removed only on a scratch atlas this run made. A slot the template lacks is a pipeline change the coordinator requests.',
	template_rect:
		"Agents never write a region's rect or geometry: those are the packer's and the .atlas file's.",
	template_add:
		'Agents never add a region the template does not have. Request a pipeline change through the coordinator.',
	global_config:
		"Agents never write the project's global Atlas Maker settings, only an atlas's own whitelisted settings.",
	run_on: 'Agents never switch "Run generation on". The Director renders only on RunPod.',
	art_deletion:
		'Agents never delete or replace art they did not make: variants, committed tiles, regions.',
};

export const refusal = (id: RefusalId): Refusal => ({ id, message: REFUSALS[id] });

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

/**
 * Op-name words, matched as whole `_`-separated words. A blocklist is defence in depth: the
 * registry is the allow-list, and no op exists for any of these.
 */
const MERGE_WORDS = /(^|_)(merge|push|commit|branch|pull_request|pr|approve)(_|$)/;
const ROLE_WORDS =
	/(^|_)(role|roles|override|overrides|grant|revoke|capability|capabilities|access|permission|permissions|tool|tools)(_|$)/;
const MATH_WORDS =
	/(^|_)(config|gameconfig|math|rtp|paytable|bet|betmode|betmodes|modes?|paylines?|lines|reels?|strips?|gametype|type|features?)(_|$)/;
const AGENT_WORDS = /(^|_)(agent|agents|agentdef|definition|definitions)(_|$)/;
/** Tool names that are the shared blueprint library (ADR-0008 §3). */
const LIBRARY_TOOLS = new Set(['blueprints', 'blueprint', 'library', 'cards', 'card', 'taxonomy']);
const RUN_ON_WORDS = /(^|_)(run_on|runon|transport)(_|$)/;
const GLOBAL_WORDS = /(^|_)(global|globals|atlas_config|saveconfig|project_settings)(_|$)/;
/** Destroying art: a delete-ish verb on an art noun (`remove_layer` is neither). */
const DELETE_VERBS = /(^|_)(delete|del|clear|remove|purge|wipe|drop)(_|$)/;
const ART_NOUNS =
	/(^|_)(variant|variants|output|outputs|region|regions|art|tile|tiles|image|images)(_|$)/;
const LIBRARY_WORDS = /(^|_)(upload|delete|taxonomy|card|cards)(_|$)/;
const RECT_WORDS = /(^|_)(rect|rects|geometry|bounds|resize|move|position|layout)(_|$)/;
const ADD_REGION = /(^|_)(add|new|create)_(region|regions|slot|slots|atlas)(_|$)/;

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
	if (PIPELINE_TOOLS.has(t) || MERGE_WORDS.test(o)) return refusal('merge');
	if (ROLE_TOOLS.has(t) || ROLE_WORDS.test(o)) return refusal('roles');
	if (READ_OP.test(o)) return null;
	if (GAME_CONFIG_TOOLS.has(t) || MATH_WORDS.test(o)) return refusal('game_config');
	if (AGENT_TOOLS.has(t) || AGENT_WORDS.test(o)) return refusal('agent_definitions');
	if (RUN_ON_WORDS.test(o)) return refusal('run_on');
	if (GLOBAL_WORDS.test(o)) return refusal('global_config');
	if (DELETE_VERBS.test(o) && ART_NOUNS.test(o)) return refusal('art_deletion');
	if (LIBRARY_TOOLS.has(t) || LIBRARY_WORDS.test(o)) return refusal('library');
	if (RECT_WORDS.test(o)) return refusal('template_rect');
	if (ADD_REGION.test(o)) return refusal('template_add');
	return null;
}

/**
 * Keys no Director write may target. `*` is one or more path segments: the math contract is
 * `<client>/<project>/config/config.json`, and published snapshots sit under
 * `<client>/<project>/published/`.
 */
const FORBIDDEN_TARGETS: { id: RefusalId; test: (key: string) => boolean }[] = [
	{ id: 'game_config', test: (k) => /(^|\/)config\/config\.json$/.test(k) },
	// The rest of a project's `config/` holds the math contract's backups, which feed a restore.
	{ id: 'game_config', test: (k) => /^[^/]+\/[^/]+\/config(\/|$)/.test(k) },
	{ id: 'publish', test: (k) => /(^|\/)published(\/|$)/.test(k) },
	{ id: 'publish', test: (k) => k === 'test_server' || k.startsWith('test_server/') },
	{
		id: 'library',
		test: (k) => k === '_shared' || k.startsWith('_shared/') || k.includes('/_shared/'),
	},
	{ id: 'global_config', test: (k) => /(^|\/)atlas_config\.json$/.test(k) },
	{
		id: 'agent_definitions',
		test: (k) =>
			k === 'services/director-worker/agents' || k.startsWith('services/director-worker/agents/'),
	},
];

/**
 * Why a write to `key` is refused, or `null`. A key ending in `/` is a PREFIX the op writes under:
 * refused when it is inside a forbidden area, or when it spans a whole client or project tree
 * (`<client>/` or `<client>/<project>/`), which holds the math contract. A key that tries to escape (`..`, a leading `/`, a backslash) is refused outright.
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
		if (segments.length <= 2) return refusal('game_config');
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
