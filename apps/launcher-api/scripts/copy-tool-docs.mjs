// Mirror the in-repo tool guides (`docs/tools/*.md`, at the repo root — two
// levels above this app) into the app tree so Vite can `import.meta.glob` them
// at build time. The docs live OUTSIDE the app and would not otherwise survive
// the adapter-node server bundle (and reaching outside the app root trips
// Vite's `server.fs` boundary). Run before `build`/`dev` (see package.json).
//
// The destination (`src/lib/tool-docs/`) is generated + gitignored; the source
// of truth stays under the repo `docs/`. Any present-or-future `*.md` is copied
// verbatim — no per-doc wiring.
//
// It also writes `agents.json` — each tool's owning agents (`docs/knowledge/owners.json`) with
// the `description` from their `.claude/agents/<name>.md` frontmatter — so the "Ask the AI"
// chat can answer as the tool's agent (`$lib/server/askAi.ts`).
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const srcDir = join(appRoot, '..', '..', 'docs', 'tools');
const destDir = join(appRoot, 'src', 'lib', 'tool-docs');
const repoRoot = join(appRoot, '..', '..');

await rm(destDir, { recursive: true, force: true });
await mkdir(destDir, { recursive: true });

let names = [];
try {
	names = (await readdir(srcDir)).filter((n) => n.toLowerCase().endsWith('.md'));
} catch {
	console.warn(`[copy-tool-docs] no docs found at ${srcDir} — skipping.`);
	process.exit(0);
}

for (const name of names) {
	await cp(join(srcDir, name), join(destDir, name));
}

console.log(`[copy-tool-docs] copied ${names.length} guide(s) → src/lib/tool-docs/`);

/** `{ toolId: [{ name, description }] }`; a tool or agent the files don't name is left out. */
async function toolAgents() {
	const owners = JSON.parse(
		await readFile(join(repoRoot, 'docs', 'knowledge', 'owners.json'), 'utf8'),
	);
	const out = {};
	for (const [toolId, agentNames] of Object.entries(owners.tools ?? {})) {
		const agents = [];
		for (const name of agentNames) {
			const source = await readFile(
				join(repoRoot, '.claude', 'agents', `${name}.md`),
				'utf8',
			).catch(() => '');
			const description = /^---\n[\s\S]*?^description:\s*(.+)$/m.exec(source)?.[1]?.trim();
			if (description) agents.push({ name, description });
		}
		if (agents.length) out[toolId] = agents;
	}
	return out;
}

try {
	await writeFile(join(destDir, 'agents.json'), JSON.stringify(await toolAgents()));
} catch (err) {
	console.warn(`[copy-tool-docs] no tool agents written: ${err.message}`);
	await writeFile(join(destDir, 'agents.json'), '{}');
}
