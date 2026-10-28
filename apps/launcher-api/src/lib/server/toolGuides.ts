/**
 * Tool guides are authored in-repo at the repo root under `docs/tools/*.md`,
 * OUTSIDE this app. A prebuild step (`scripts/copy-tool-docs.mjs`, run via the
 * `prebuild`/`predev` npm hooks) mirrors them into `src/lib/tool-docs/` so Vite
 * can inline every doc at build time with `import.meta.glob('?raw', { eager })`.
 * The markdown source becomes a string baked into the bundle, so it survives the
 * `adapter-node` server build without any runtime disk reads. Any present-or-
 * future `docs/tools/<slug>.md` is picked up automatically — no per-doc wiring.
 * The same step writes `agents.json`: each tool's owning agents and what they cover.
 */
const docs = import.meta.glob<string>('$lib/tool-docs/*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
});

const agentFiles = import.meta.glob<Record<string, ToolAgent[]>>('$lib/tool-docs/agents.json', {
	import: 'default',
	eager: true,
});

export interface ToolAgent {
	name: string;
	description: string;
}

/** Map `<repo>/docs/tools/<slug>.md` paths to their bare `<slug>`. */
const bySlug = new Map<string, string>(
	Object.entries(docs).map(([path, source]) => {
		const slug = path.replace(/^.*\/([^/]+)\.md$/, '$1');
		return [slug, source];
	}),
);

const agentsByTool: Record<string, ToolAgent[]> = Object.values(agentFiles)[0] ?? {};

/** The guide's markdown, or `undefined` when no `docs/tools/<slug>.md` exists. */
export function toolGuide(slug: string): string | undefined {
	return bySlug.get(slug);
}

/** The agents that own a tool (`docs/knowledge/owners.json`); empty when none is named. */
export function toolAgents(toolId: string): ToolAgent[] {
	return agentsByTool[toolId] ?? [];
}
