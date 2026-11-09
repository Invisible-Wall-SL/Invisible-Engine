/**
 * Guard for the tool-guide link rewrite (`src/lib/server/toolDocLinks.ts`).
 *
 * The guides under `docs/tools/*.md` are written for GitHub, so their links are relative to
 * `docs/tools/`. Rendered verbatim at `/docs/<slug>`, `x.md` resolved to `/docs/x.md` (404) and
 * `../design/y.md` to `/design/y.md` (no such route). This pins the rewrite rules, then renders
 * every real guide and asserts no relative href survives: each one must become `/docs/<slug>` or a
 * GitHub URL. It checks SHAPE, not existence — a guide linking a sibling that doesn't exist is a
 * content bug, reported here as a note but not failed on.
 *
 * Run:  pnpm --filter launcher-api check:tool-doc-links     (from the repo root)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	TOOL_DOC_REPO_URL,
	renderToolDoc,
	rewriteToolDocHref,
} from '../src/lib/server/toolDocLinks.ts';

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const BLOB = `${TOOL_DOC_REPO_URL}/blob/main/`;
const TREE = `${TOOL_DOC_REPO_URL}/tree/main/`;

// --- Rewrite rules -------------------------------------------------------------------------------

check('sibling guide', rewriteToolDocHref('pipeline-changes.md'), '/docs/pipeline-changes');
check('sibling guide + anchor', rewriteToolDocHref('x.md#a'), '/docs/x#a');
check('./sibling + anchor', rewriteToolDocHref('./x.md#a'), '/docs/x#a');
check('../tools/ round trip', rewriteToolDocHref('../tools/x.md'), '/docs/x');
check('design doc', rewriteToolDocHref('../design/y.md'), `${BLOB}docs/design/y.md`);
check('design doc + anchor', rewriteToolDocHref('../design/y.md#s'), `${BLOB}docs/design/y.md#s`);
check('folder link', rewriteToolDocHref('../conventions/'), `${TREE}docs/conventions/`);
check(
	'repo-root path',
	rewriteToolDocHref('../../packages/engine-game/src/index.ts'),
	`${BLOB}packages/engine-game/src/index.ts`,
);
check('repo-root folder', rewriteToolDocHref('../../packages/'), `${TREE}packages/`);
check('non-md sibling', rewriteToolDocHref('diagram.png'), `${BLOB}docs/tools/diagram.png`);
check('guide subfolder', rewriteToolDocHref('sub/x.md'), `${BLOB}docs/tools/sub/x.md`);
check('escapes repo', rewriteToolDocHref('../../../x.md'), '../../../x.md');
check('sibling + query + anchor', rewriteToolDocHref('x.md?plain=1#a'), '/docs/x#a');
check('upper-case .MD', rewriteToolDocHref('X.MD'), `${BLOB}docs/tools/X.MD`);
check(
	'query is not a path',
	rewriteToolDocHref('../design/y.md?a=../b'),
	`${BLOB}docs/design/y.md?a=../b`,
);

for (const href of [
	'?q=1',
	'https://example.com/a.md',
	'http://example.com',
	'mailto:someone@example.com',
	'//cdn.example.com/x.md',
	'/symbols',
	'/docs/atlas-maker',
	'#section',
	'',
]) {
	check(`unchanged: ${JSON.stringify(href)}`, rewriteToolDocHref(href), href);
}

// --- Rendering ------------------------------------------------------------------------------------

const hrefsOf = (html: string): string[] =>
	[...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1] ?? '');

const sample = await renderToolDoc(
	'See [a](a.md), [b](./b.md#x), [d](../design/d.md), [r][ref], [w](https://w.example), [h](#h).\n\n[ref]: ../conventions/\n',
);
check('render rewrites inline + reference links', hrefsOf(sample), [
	'/docs/a',
	'/docs/b#x',
	`${BLOB}docs/design/d.md`,
	`${TREE}docs/conventions/`,
	'https://w.example',
	'#h',
]);

// --- Every real guide ----------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const guideDir = join(here, '..', '..', '..', 'docs', 'tools');
const guides = readdirSync(guideDir).filter((f) => f.endsWith('.md'));
const slugs = new Set(guides.map((f) => f.slice(0, -3)));
const missing: string[] = [];
let rewritten = 0;

for (const file of guides) {
	const html = await renderToolDoc(readFileSync(join(guideDir, file), 'utf8'));
	for (const raw of hrefsOf(html)) {
		const href = raw.replace(/&amp;/g, '&');
		const docMatch = /^\/docs\/([^/#?]+)(#.*)?$/.exec(href);
		const ok = href.startsWith('#') || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href);
		checks += 1;
		if (!ok) {
			failures += 1;
			console.log(`FAIL  ${file}: relative href survived rendering: ${href}`);
			continue;
		}
		if (href.startsWith(TOOL_DOC_REPO_URL) || docMatch) rewritten += 1;
		if (docMatch && !slugs.has(docMatch[1] ?? '')) missing.push(`${file} → ${href}`);
	}
}

console.log(`rendered ${guides.length} guides; ${rewritten} links point at /docs/<slug> or GitHub`);
for (const note of missing) console.log(`note  link to a guide that doesn't exist: ${note}`);

if (failures > 0) {
	console.log(`\n${failures}/${checks} checks FAILED`);
	process.exit(1);
}
console.log(`ok  ${checks} checks passed`);
