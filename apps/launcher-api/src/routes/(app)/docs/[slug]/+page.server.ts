import { error, redirect } from '@sveltejs/kit';
import { marked } from 'marked';
import type { PageServerLoad } from './$types';

/**
 * Tool guides are authored in-repo at the repo root under `docs/tools/*.md`,
 * OUTSIDE this app. A prebuild step (`scripts/copy-tool-docs.mjs`, run via the
 * `prebuild`/`predev` npm hooks) mirrors them into `src/lib/tool-docs/` so Vite
 * can inline every doc at build time with `import.meta.glob('?raw', { eager })`.
 * The markdown source becomes a string baked into the bundle, so it survives the
 * `adapter-node` server build without any runtime disk reads. Any present-or-
 * future `docs/tools/<slug>.md` is picked up automatically — no per-doc wiring.
 */
const docs = import.meta.glob<string>('$lib/tool-docs/*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
});

/** Map `<repo>/docs/tools/<slug>.md` paths to their bare `<slug>`. */
const bySlug = new Map<string, string>(
	Object.entries(docs).map(([path, source]) => {
		const slug = path.replace(/^.*\/([^/]+)\.md$/, '$1');
		return [slug, source];
	}),
);

/** Turn a `<slug>` into a readable page title (e.g. `atlas-maker` → `Atlas Maker`). */
function titleFromSlug(slug: string): string {
	return slug
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	const source = bySlug.get(params.slug);
	if (source === undefined) {
		throw error(404, `No guide found for “${params.slug}”.`);
	}

	const html = await marked.parse(source);
	return { slug: params.slug, title: titleFromSlug(params.slug), html };
};
