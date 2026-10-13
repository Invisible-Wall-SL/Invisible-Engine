/**
 * The Component Editor folded into `/editor` (Rive plan Phase 4). Every way into it must still
 * land on the component it named:
 *   pnpm --filter launcher-api check:component-links
 *
 *  1. the legacy `/components` route redirects onto `/editor`'s Components side, keeping the id
 *     and every other parameter (`project`, `client`);
 *  2. what `/editor` reads back out of those URLs opens the same component;
 *  3. the tool card and every in-app link point at `/editor`, never the retired page;
 *  4. edit-in-place stops where the game stops drawing nested components;
 *  5. a link to `/editor` followed from inside `/editor` never swaps one project's state for
 *     another's: tool links carry the shown project, and `/editor` applies the same project in
 *     place and fully reloads for any other (or for a link naming none);
 *  6. every `/editor` write targets the project the page was LOADED for, even from a bookmarked
 *     bare `/editor` after another tab moved the session; drift blocks saves;
 *  7. a component this tab has no ETag for has it read before its first save.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_COMPONENT_DEPTH } from '../../../packages/engine-layout/src/lib/registerComponents.ts';
import {
	componentsHref,
	componentsTarget,
	editorActionUrl,
	editorSelfNavigation,
	legacyComponentsRedirect,
} from '../src/lib/componentLinks.ts';
import { etagKnown } from '../src/routes/(app)/editor/componentWorkspace.ts';
import { withProject } from '../src/lib/toolLinks.ts';
import { TOOLS } from '../src/lib/roles.ts';
import { canEnterNested } from '../src/routes/(app)/editor/componentWorkspace.ts';

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const redirectOf = (search: string): string =>
	legacyComponentsRedirect(new URL(`https://app.example/components${search}`).searchParams);
const targetOf = (href: string): string | null | undefined =>
	componentsTarget(new URL(href, 'https://app.example').searchParams);

// ── 1. Legacy deep links ─────────────────────────────────────────────────────
check('bare /components opens the components home', redirectOf(''), '/editor?view=components');
check(
	'"Open Component Editor" (?project=) keeps its project',
	redirectOf('?project=book_of_borut'),
	'/editor?project=book_of_borut&view=components',
);
check(
	'"Edit as component" (?id=&project=) opens that component in that project',
	redirectOf('?id=c_win%20banner&project=book_of_borut'),
	'/editor?project=book_of_borut&component=c_win+banner',
);
check(
	'a client scope rides along',
	redirectOf('?client=eagaming&id=coin'),
	'/editor?client=eagaming&component=coin',
);
check('an empty id is the home, not a component', redirectOf('?id='), '/editor?view=components');

// ── 2. What /editor reads back ───────────────────────────────────────────────
check('a redirected id opens that component', targetOf(redirectOf('?id=coin&project=p')), 'coin');
check('the redirected home opens the home', targetOf(redirectOf('?project=p')), null);
check('a plain /editor stays on the screens', targetOf('/editor?project=p'), undefined);
check('an unknown view stays on the screens', targetOf('/editor?view=screens'), undefined);
check('componentsHref(id) round-trips', targetOf(componentsHref('hudReadout')), 'hudReadout');
check(
	'componentsHref replaces a stale target instead of stacking it',
	componentsHref('b', new URLSearchParams('component=a&project=p')),
	'/editor?project=p&component=b',
);
check(
	'componentsHref(null) drops the open component',
	componentsHref(null, new URLSearchParams('component=a&project=p')),
	'/editor?project=p&view=components',
);

// ── 3. The card and the links ────────────────────────────────────────────────
check(
	'the Component Editor card opens /editor',
	TOOLS.componentEditor.url.split('?')[0],
	'/editor',
);
check(
	'the Component Editor card opens the components home',
	targetOf(TOOLS.componentEditor.url),
	null,
);
const routes = fileURLToPath(new URL('../src/routes/', import.meta.url));
check(
	'the retired page is gone (its route only redirects)',
	existsSync(`${routes}(app)/components/+page.svelte`),
	false,
);
check(
	'the /components route redirects through legacyComponentsRedirect',
	readFileSync(`${routes}(app)/components/+server.ts`, 'utf8').includes(
		'legacyComponentsRedirect(',
	),
	true,
);
const src = fileURLToPath(new URL('../src/', import.meta.url));
const LINK_TO_RETIRED_PAGE = /['"`]\/components(?:[?'"`#]|$)/m;
const linkers = readdirSync(src, { recursive: true, encoding: 'utf8' })
	.map((f) => f.replaceAll('\\', '/'))
	.filter((f) => /\.(ts|svelte|js)$/.test(f) && f !== 'lib/componentLinks.ts')
	.filter((f) => LINK_TO_RETIRED_PAGE.test(readFileSync(`${src}${f}`, 'utf8')));
check('nothing in the launcher links to /components any more', linkers, []);

// ── 4. Edit in place follows the game's nesting cap ──────────────────────────
check('a component opened from a screen can open the one inside it', canEnterNested(0), true);
check(
	`but not one ${MAX_COMPONENT_DEPTH} levels down, which the game skips`,
	canEnterNested(MAX_COMPONENT_DEPTH - 1),
	false,
);

// ── 5. Same-route navigations keep their project ─────────────────────────────
check(
	'a tool link carries the shown project',
	withProject(TOOLS.componentEditor.url, 'book_of_borut'),
	'/editor?view=components&project=book_of_borut',
);
check(
	'a link that already names a project is re-pointed, not doubled',
	withProject('/editor?project=other&component=coin', 'book_of_borut'),
	'/editor?project=book_of_borut&component=coin',
);
check('no project shown ⇒ the link as registered', withProject('/files', undefined), '/files');
check('a hash survives', withProject('/docs/flow#pins', 'p'), '/docs/flow?project=p#pins');
const at = (href: string): URL => new URL(href, 'https://app.example');
// Tab A holds /editor?project=X; tab B moved the session to Y; tab A clicks the card.
check(
	'the card, from the bar of a tab on X, opens the Components side of X in place',
	editorSelfNavigation(at(withProject(TOOLS.componentEditor.url, 'X')), 'X'),
	'in-place',
);
check(
	'a link to /editor naming no project reloads (the server would take the session’s)',
	editorSelfNavigation(at('/editor?view=components'), 'X'),
	'reload',
);
check(
	'a link to /editor naming another project reloads',
	editorSelfNavigation(at('/editor?project=Y&component=coin'), 'X'),
	'reload',
);
const bar = readFileSync(`${src}lib/ToolTopBar.svelte`, 'utf8');
check('the tool bar builds its links with withProject', bar.includes('withProject(tool.url'), true);
const editorPage = readFileSync(`${routes}(app)/editor/+page.svelte`, 'utf8');
check(
	'/editor decides its own-route navigations with editorSelfNavigation, in beforeNavigate',
	/beforeNavigate\([\s\S]*?navigation\.cancel\(\)[\s\S]*?editorSelfNavigation\(/.test(editorPage),
	true,
);
check(
	'/editor reloads should its data arrive for another project',
	editorPage.includes('data.projectKey !== loadedProjectKey'),
	true,
);

// ── 6. Writes are pinned to the loaded project ──────────────────────────────
// Tab A opens a bookmarked bare `/editor` and gets X; tab B moves the session to Y; tab A saves.
check(
	'a bare /editor posts its save to the loaded project',
	editorActionUrl('save', '', 'X'),
	'?/save&project=X',
);
check(
	'the loaded project wins over whatever the address bar names',
	editorActionUrl('save', '?project=Y&view=components', 'X'),
	'?/save&project=X&view=components',
);
check('no project at all ⇒ the bare action', editorActionUrl('save', '', ''), '?/save');
check(
	'postAction builds its URL with editorActionUrl and the loaded project',
	editorPage.includes('editorActionUrl(action, location.search, loadedProjectKey)'),
	true,
);
check(
	'a bare /editor pins ?project= into the address bar on first load',
	/function setEditorUrl[\s\S]*?params\.set\('project', loadedProjectKey\)/.test(editorPage) &&
		/type !== 'enter'[\s\S]*?setEditorUrl\(/.test(editorPage),
	true,
);
check(
	'the layout save is blocked while the data has drifted to another project',
	editorPage.includes('blockWhen: () => lease.readOnly || projectDrift'),
	true,
);
check(
	'only the capture, its comment, the drift check and the drift banner read the live data.projectKey',
	(editorPage.match(/data\.projectKey/g) ?? []).length,
	4,
);
const workspace = readFileSync(`${routes}(app)/editor/ComponentWorkspace.svelte`, 'utf8');
check(
	'the Components side blocks its saves on drift (draft + defaults)',
	[
		workspace.includes('blockWhen: () => lease.readOnly || writesBlocked'),
		workspace.includes('blockWhen: () => writesBlocked'),
	],
	[true, true],
);

// ── 7. ETags of components the page created or refreshed ─────────────────────
check('a def with a stored ETag is known', etagKnown({ coin: '"e1"' }, 'coin'), true);
check('a built-in (null) is known: its first save creates', etagKnown({ win: null }, 'win'), true);
check('a def refreshed after load is not, so it is read on open', etagKnown({}, 'gem'), false);
check('an inherited key is not an ETag', etagKnown({}, 'toString'), false);
check(
	'a created def’s ETag is recorded even when the def is already listed',
	/if \(request\.def\) \{[\s\S]*?componentEtags = \{ \.\.\.componentEtags, \[created\.id\]: request\.etag/.test(
		workspace,
	),
	true,
);

if (failures > 0) {
	console.error(`\n${failures} of ${checks} component-link checks failed`);
	process.exit(1);
}
console.log(`component links: ${checks} checks passed`);
