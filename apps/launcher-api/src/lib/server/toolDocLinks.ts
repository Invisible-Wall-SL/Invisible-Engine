/**
 * Rewrites the links inside a tool guide (`docs/tools/<slug>.md`) so they work when the guide is
 * rendered at `/docs/<slug>` in the launcher.
 *
 * The guides are written for GitHub, so their links are relative to `docs/tools/`: `x.md`,
 * `./x.md#anchor`, `../design/y.md`, `../../packages/z/`. Rendered verbatim, the browser resolves
 * them against `/docs/<slug>` and every one of them 404s. Here each relative href is resolved
 * against `docs/tools/` instead:
 *
 *   - a target that stays directly inside `docs/tools/` and ends in `.md` → `/docs/<slug>` (+ anchor),
 *     i.e. the sibling guide's launcher page;
 *   - anything else in the repo → its GitHub page (`blob/main/…`, or `tree/main/…` for a folder).
 *
 * Absolute URLs (any scheme, incl. `mailto:`), protocol-relative `//…`, site-absolute `/…` and pure
 * `#anchor`/`?query` links are left alone. A query or anchor after a path is kept as written (a
 * guide page keeps only the anchor). Only links are rewritten — image sources and raw HTML `<a>`
 * are not (no guide uses either), and a folder link without a trailing `/` opens as `blob/`, which
 * GitHub redirects to `tree/`. Pure string logic, no SvelteKit imports, so the fixture
 * (`scripts/check-tool-doc-links.ts`) can drive it directly.
 */

import { Marked, type MarkedExtension, type Tokens } from 'marked';

/** The repo the guides live in; non-guide targets open here. */
export const TOOL_DOC_REPO_URL = 'https://github.com/Invisible-Wall-SL/Invisible-Engine';

/** Where the guides live, relative to the repo root. */
const GUIDE_DIR = ['docs', 'tools'];

/** `scheme:` (http:, https:, mailto:, data:, …) — anything with a URL scheme is already absolute. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The launcher-side href for a link written inside a `docs/tools/*.md` guide. Returns the href
 * unchanged when it isn't a repo-relative path (or climbs above the repo root).
 */
export function rewriteToolDocHref(href: string): string {
	const trimmed = href.trim();
	if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('/')) return href;
	if (SCHEME.test(trimmed)) return href;

	const pathEnd = trimmed.search(/[?#]/);
	const pathPart = pathEnd === -1 ? trimmed : trimmed.slice(0, pathEnd);
	const anchor = pathEnd === -1 ? '' : trimmed.slice(pathEnd);
	if (pathPart === '') return href;

	const isFolder = pathPart.endsWith('/');
	const segments = [...GUIDE_DIR];
	for (const part of pathPart.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (segments.length === 0) return href; // escapes the repo — leave it as written
			segments.pop();
			continue;
		}
		segments.push(part);
	}

	const inGuideDir =
		!isFolder &&
		segments.length === GUIDE_DIR.length + 1 &&
		GUIDE_DIR.every((dir, i) => segments[i] === dir);
	const leaf = segments[segments.length - 1] ?? '';
	if (inGuideDir && leaf.endsWith('.md') && leaf.length > 3) {
		const hashAt = anchor.indexOf('#');
		return `/docs/${leaf.slice(0, -3)}${hashAt === -1 ? '' : anchor.slice(hashAt)}`;
	}

	const repoPath = segments.join('/');
	if (isFolder || repoPath === '') {
		return `${TOOL_DOC_REPO_URL}/tree/main/${repoPath === '' ? '' : `${repoPath}/`}${anchor}`;
	}
	return `${TOOL_DOC_REPO_URL}/blob/main/${repoPath}${anchor}`;
}

const toolDocLinksExtension: MarkedExtension = {
	walkTokens(token) {
		if (token.type === 'link') {
			const link = token as Tokens.Link;
			link.href = rewriteToolDocHref(link.href);
		}
	},
};

/** A local Marked instance (the global `marked` is never mutated) with the link rewrite applied. */
const toolDocMarked = new Marked(toolDocLinksExtension);

/** Render a tool guide's markdown to HTML with its relative links fixed for `/docs/<slug>`. */
export async function renderToolDoc(source: string): Promise<string> {
	return toolDocMarked.parse(source, { async: true });
}
