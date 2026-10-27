/**
 * Gate: the build agents, the knowledge base and the ownership map stay true to the repo
 * (docs/director/DECISIONS/0009-repair-agents-families-knowledge.md §5).
 *
 * An audit on 2026-10-27 found agents pointing at paths that had moved, stating facts that had
 * stopped being true, and linking ~38 personal-memory notes no other session can read; tools and
 * game kinds had no owner at all. Nothing checked any of it, so it decayed silently. This gate
 * checks what can be checked mechanically:
 *
 *   1. every `.claude/agents/*.md` has `name` (= its file name), `description` and `tools`;
 *   2. every repo path an agent names exists;
 *   3. no agent gains a `[[…]]` personal-memory link (a ratchet: the baseline only shrinks);
 *   4. every launcher tool (`TOOLS`) and every game kind (`GAME_KINDS`) is in
 *      `docs/knowledge/owners.json`, every owner is a real agent, and an ownerless entry is a
 *      named gap;
 *   5. every `docs/knowledge/` file is within its line budget, and its relative links resolve.
 *
 * Stale FACTS in an agent (a path that exists but says the wrong thing) are beyond it.
 *
 * Usage: node --experimental-strip-types --no-warnings scripts/check-agents-knowledge.mjs
 *        [--update]   lower the memory-link baseline to today's counts (never raises it)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_DIR = join(ROOT, '.claude/agents');
const KNOWLEDGE_DIR = join(ROOT, 'docs/knowledge');
const BASELINE = join(ROOT, 'scripts/agents-knowledge-baseline.json');
const UPDATE = process.argv.includes('--update');

const { TOOLS } = await import(join(ROOT, 'apps/launcher-api/src/lib/roles.ts'));
const { GAME_KINDS } = await import(join(ROOT, 'packages/constants-shared/gameKinds.ts'));

const failures = [];
const fail = (msg) => failures.push(msg);

// ── 1–3. Build agents ──────────────────────────────────────────────────────
const REPO_ROOTS = /^(?:apps|packages|services|docs|scripts|tools|\.github|\.claude)\//;
// A path with a placeholder, a glob or an ellipsis names a family of files, not one.
const PATTERN = /[<>*{}…$\s]/;

/** The repo-rooted paths a Markdown body names, in backticks or as link targets. */
function namedPaths(body) {
	const raw = [
		...[...body.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
		...[...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
	];
	const paths = new Set();
	for (let text of raw) {
		text = text
			.replace(/#.*$/, '')
			.replace(/:\d+(?:[-–]\d+)?$/, '')
			.replace(/[.,;]+$/, '');
		if (!REPO_ROOTS.test(text) || PATTERN.test(text)) continue;
		paths.add(text.replace(/\/$/, ''));
	}
	return [...paths];
}

/** A gitignored path is a local file (e.g. `.claude/launch.json`): absent in a clone by design. */
const gitIgnored = (path) =>
	spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT }).status === 0;

const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));
const agentNames = new Set();
const memoryLinks = {};
for (const file of agentFiles) {
	const text = readFileSync(join(AGENTS_DIR, file), 'utf8');
	const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
	const where = `.claude/agents/${file}`;
	if (!front) {
		fail(`${where}: no frontmatter`);
		continue;
	}
	const name = /^name:\s*(\S+)/m.exec(front)?.[1];
	if (name !== file.replace(/\.md$/, '')) fail(`${where}: name "${name}" is not its file name`);
	for (const field of ['description', 'tools']) {
		if (!new RegExp(`^${field}:\\s*\\S`, 'm').test(front)) fail(`${where}: no ${field}`);
	}
	agentNames.add(file.replace(/\.md$/, ''));
	for (const path of namedPaths(text)) {
		if (!existsSync(join(ROOT, path)) && !gitIgnored(path)) {
			fail(`${where}: names \`${path}\`, which does not exist`);
		}
	}
	const links = (text.match(/\[\[[^\]\n]+\]\]/g) ?? []).length;
	if (links) memoryLinks[file] = links;
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
for (const [file, count] of Object.entries(memoryLinks)) {
	const allowed = baseline[file] ?? 0;
	if (count > allowed) {
		fail(
			`.claude/agents/${file}: ${count} [[…]] personal-memory links (baseline ${allowed}). ` +
				'Link a docs/knowledge/ entry instead: no other session can read personal memory.',
		);
	}
}
const lowered = Object.fromEntries(
	Object.entries(baseline)
		.map(([file, allowed]) => [file, Math.min(allowed, memoryLinks[file] ?? 0)])
		.filter(([, count]) => count > 0),
);
if (JSON.stringify(lowered) !== JSON.stringify(baseline)) {
	if (UPDATE) {
		writeFileSync(BASELINE, `${JSON.stringify(lowered, null, '\t')}\n`);
		console.log('lowered scripts/agents-knowledge-baseline.json');
	} else {
		fail('memory links went down: run with --update to lower the baseline, and commit it');
	}
}

// ── 4. Owners ──────────────────────────────────────────────────────────────
const owners = JSON.parse(readFileSync(join(KNOWLEDGE_DIR, 'owners.json'), 'utf8'));
const gaps = owners.gaps ?? {};
const sections = [
	['tool', 'tools', Object.keys(TOOLS)],
	['kind', 'kinds', [...GAME_KINDS]],
];
for (const [prefix, key, ids] of sections) {
	const map = owners[key] ?? {};
	for (const id of ids) {
		if (!(id in map)) fail(`owners.json: ${key}.${id} is missing`);
	}
	for (const [id, list] of Object.entries(map)) {
		if (!ids.includes(id)) fail(`owners.json: ${key}.${id} is not a ${prefix} the code knows`);
		for (const agent of list) {
			if (!agentNames.has(agent)) fail(`owners.json: ${key}.${id} names unknown agent ${agent}`);
		}
		if (list.length === 0 && !gaps[`${prefix}:${id}`]) {
			fail(`owners.json: ${key}.${id} has no owner and no gaps["${prefix}:${id}"] entry`);
		}
	}
}
for (const gap of Object.keys(gaps)) {
	const [prefix, id] = gap.split(':');
	const known = sections.find(([p]) => p === prefix)?.[2] ?? [];
	if (!known.includes(id)) fail(`owners.json: gaps["${gap}"] names no ${prefix ?? 'entry'}`);
}

// ── 5. Knowledge budgets and links ─────────────────────────────────────────
const BUDGETS = [
	[/^README\.md$/, 120],
	[/^targets\.md$/, 120],
	[/^families\/[^/]+\.md$/, 200],
	[/^games\/[^/]+\.md$/, 80],
	[/^lessons\/[^/]+\.md$/, 300],
];
const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
	);
for (const path of walk(KNOWLEDGE_DIR)) {
	const rel = relative(KNOWLEDGE_DIR, path).split('\\').join('/');
	if (rel === 'owners.json') continue;
	const budget = BUDGETS.find(([pattern]) => pattern.test(rel))?.[1];
	if (budget === undefined) {
		fail(`docs/knowledge/${rel}: not a file the layout allows (docs/knowledge/README.md)`);
		continue;
	}
	const text = readFileSync(path, 'utf8');
	const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
	if (lines > budget) fail(`docs/knowledge/${rel}: ${lines} lines, budget ${budget}`);
	for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
		if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
		const file = join(dirname(path), target.replace(/#.*$/, ''));
		if (!existsSync(file)) fail(`docs/knowledge/${rel}: link ${target} does not resolve`);
	}
}

if (failures.length) {
	console.error(`check:agents-knowledge — ${failures.length} problem(s):`);
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
const total = Object.values(memoryLinks).reduce((a, b) => a + b, 0);
console.log(
	`check:agents-knowledge — ${agentFiles.length} agents, ` +
		`${Object.keys(TOOLS).length} tools, ${GAME_KINDS.length} kinds owned ` +
		`(${Object.keys(gaps).length} named gaps), ${total} memory links left to fold in: ok`,
);
