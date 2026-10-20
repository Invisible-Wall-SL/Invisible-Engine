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
 *  7. a component this tab has no ETag for has it read before its first save;
 *  8. the Library offers a component every other component that does not contain it, directly or
 *     through a nested instance, so a placement can never make a cycle.
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
import {
	etagAdoption,
	etagKnown,
	placeableComponents,
} from '../src/routes/(app)/editor/componentWorkspace.ts';
import { scopeMismatch } from '../src/lib/server/scopeGuard.ts';
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
const workspace = readFileSync(`${routes}(app)/editor/ComponentWorkspace.svelte`, 'utf8');
check(
	'the Components side blocks its saves on drift (draft + defaults)',
	[
		workspace.includes('blockWhen: () => lease.readOnly || writesBlocked'),
		workspace.includes('blockWhen: () => writesBlocked'),
	],
	[true, true],
);

// Every WRITE the editor makes names the project the page was loaded for, so the server can
// refuse one that would land in another (`scopeMismatch`, or an explicit `project` target). This
// enumerates every `fetch(` in the editor route and in the `$lib` client modules it imports: a
// new write without the pin fails here by file and line, unless it is listed below with the
// reason it is not project-scoped. A pin only counts in code, never in a comment, and a write is
// recognised whether its method is inline or comes from a prebuilt `RequestInit`.
const editorDir = `${routes}(app)/editor/`;
const WRITE = /method:\s*'(POST|PUT|DELETE|PATCH)'/;
// `this.#key()` is the lease helper's key, which carries `projectKey` (`leaseState.svelte.ts`).
const PIN = /projectKey|project:|project=|editorActionUrl\(|withEditorProject\(|this\.#key\(\)/;
/** A write that carries no project, matched by file, the call's opening and its context. */
const UNPINNED_WRITES: { file: string; call: string; context?: RegExp; why: string }[] = [
	{
		file: '+page.svelte',
		call: "fetch('/api/editor/kind'",
		why: 'game kinds are a global library',
	},
	{ file: '+page.svelte', call: "fetch('/api/editor/template'", why: 'templates are global' },
	{
		file: '+page.svelte',
		call: 'fetch(target.url',
		why: 'a presigned R2 PUT, signed for the pinned upload request',
	},
	{
		file: 'ComponentWorkspace.svelte',
		call: "fetch('/api/editor/component', {",
		context:
			/const body = \{ \.\.\.\$state\.snapshot\(componentDraft\), \.\.\.source, scope: 'shared' \}/,
		why:
			'the promote to the shared library has no project (componentPublish-gated); its ' +
			'`promotedFrom` names the project def it copies, read for its unknown fields only',
	},
	{
		file: 'EditorTimelinePanel.svelte',
		call: "fetch('/api/cinematics/shared/promote', {",
		why:
			'a timeline promote writes the global _shared/cinematics/ library (componentPublish-gated, ' +
			'Rive plan Phase 9d); the project timeline it copies is sent in the body, not read',
	},
];
/** Code only: line, block and HTML comments removed, never inside a string (a glob, a URL). */
function code(text: string): string {
	let out = '';
	let quote: string | null = null;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			out += c;
			if (c === '\\') out += text[++i] ?? '';
			else if (c === quote) quote = null;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') {
			quote = c;
			out += c;
		} else if (text.startsWith('<!--', i)) {
			const end = text.indexOf('-->', i);
			i = end === -1 ? text.length : end + 2;
		} else if (text.startsWith('/*', i)) {
			const end = text.indexOf('*/', i + 2);
			i = end === -1 ? text.length : end + 1;
		} else if (text.startsWith('//', i) && !/[:\w]$/.test(out)) {
			const end = text.indexOf('\n', i);
			i = end === -1 ? text.length : end - 1;
		} else out += c;
	}
	return out;
}
function fetchCalls(text: string): { line: number; call: string; before: string }[] {
	const out: { line: number; call: string; before: string }[] = [];
	const re = /\bfetch\(/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const i = m.index;
		let depth = 0;
		let j = i + 'fetch'.length;
		for (; j < text.length; j++) {
			if (text[j] === '(') depth++;
			else if (text[j] === ')' && --depth === 0) break;
		}
		const lineStart = text.lastIndexOf('\n', i);
		const before = text.slice(Math.max(0, text.lastIndexOf('\n', i - 1500)), lineStart);
		out.push({ line: text.slice(0, i).split('\n').length, call: text.slice(i, j + 1), before });
		re.lastIndex = j;
	}
	return out;
}
/** The call's second argument, when it is a name (a prebuilt `RequestInit`) rather than a literal. */
const initName = (call: string): string | null =>
	/^fetch\([\s\S]*?,\s*([A-Za-z_$][\w$]*)\s*\)$/.exec(call)?.[1] ?? null;
function isWrite(call: string, before: string): boolean {
	if (WRITE.test(code(call))) return true;
	const init = initName(call);
	return (
		!!init && new RegExp(`\\b${init}\\b[^;]*?=[\\s\\S]{0,400}?${WRITE.source}`).test(code(before))
	);
}
const scanned: { file: string; text: string }[] = readdirSync(editorDir)
	.filter((f) => /\.(svelte|ts)$/.test(f))
	.map((f) => ({ file: f, text: readFileSync(`${editorDir}${f}`, 'utf8') }));
// The `$lib` CLIENT modules the editor imports (server modules never run in the tab).
const libImports = new Set<string>();
for (const { text } of scanned) {
	for (const m of text.matchAll(/from '\$lib\/((?!server\/)[^']+)'/g)) libImports.add(m[1]);
}
for (const rel of libImports) {
	for (const ext of ['', '.ts', '.svelte.ts', '.svelte', '.js']) {
		const path = `${src}lib/${rel}${ext}`;
		if (existsSync(path) && !path.endsWith('/')) {
			try {
				scanned.push({ file: `$lib/${rel}${ext}`, text: readFileSync(path, 'utf8') });
				break;
			} catch {
				/* a directory */
			}
		}
	}
}
const unpinned: string[] = [];
const sideChannels: string[] = [];
let writes = 0;
for (const { file, text } of scanned) {
	if (!file.startsWith('$lib/')) {
		for (const [i, line] of code(text).split('\n').entries()) {
			if (/navigator\.sendBeacon|new XMLHttpRequest|new Request\(/.test(line)) {
				sideChannels.push(`${file}:${i + 1} ${line.trim()}`);
			}
		}
	}
	for (const { line, call, before } of fetchCalls(text)) {
		if (!isWrite(call, before) && !/fetch\(target, \{ method: 'POST'/.test(call)) continue;
		writes++;
		const allowed = UNPINNED_WRITES.some(
			(w) => w.file === file && call.startsWith(w.call) && (!w.context || w.context.test(before)),
		);
		const window = code(before).split('\n').slice(-15).join('\n');
		if (!allowed && !PIN.test(code(call)) && !PIN.test(window)) {
			unpinned.push(`${file}:${line} ${call.split('\n')[0]}`);
		}
	}
}
check(
	'the enumeration finds the editor’s writes (editor route + $lib helpers)',
	writes >= 16,
	true,
);
check('every editor write names the loaded project (or is listed with its reason)', unpinned, []);
// The routes that REQUIRE the tab's project (`scopeMismatch(…, { required: true })`): every call
// to one — read or write — and every `listUrl` naming one must carry the pin in the call itself,
// or it is a production 400 that nothing else would catch.
const REQUIRED_ROUTES = /\/api\/editor\/(?:backups|art-bounds|import|rigs\/upload|rigs\/reindex)\b/;
const unpinnedRequired: string[] = [];
let requiredCalls = 0;
for (const { file, text } of scanned) {
	for (const { line, call } of fetchCalls(text)) {
		if (!REQUIRED_ROUTES.test(call)) continue;
		requiredCalls++;
		if (!PIN.test(code(call))) unpinnedRequired.push(`${file}:${line} ${call.split('\n')[0]}`);
	}
	for (const [i, line] of code(text).split('\n').entries()) {
		if (!/\blistUrl=/.test(line) || !REQUIRED_ROUTES.test(line)) continue;
		requiredCalls++;
		if (!/projectKey=/.test(line)) unpinnedRequired.push(`${file}:${i + 1} ${line.trim()}`);
	}
}
check('the scan finds the editor’s calls to the project-required routes', requiredCalls >= 6, true);
check('every call to a project-required route carries the pin in the call', unpinnedRequired, []);
check(
	'a string that looks like a comment is not stripped',
	code("fetch('/a/**/*.json', { projectKey }) // x"),
	"fetch('/a/**/*.json', { projectKey }) ",
);
check(
	'the editor sends nothing around fetch (sendBeacon, XMLHttpRequest, new Request)',
	sideChannels,
	[],
);
check(
	'the enumeration reads the $lib lease helper the editor writes through',
	scanned.some((s) => s.file.startsWith('$lib/leaseState')),
	true,
);
// The detector itself: a pin in a comment does not count; a prebuilt RequestInit is a write.
check(
	'a pin only in a comment is not a pin',
	PIN.test(code("fetch('/api/x', { method: 'POST', body }) // projectKey")),
	false,
);
check(
	'a write whose method comes from a prebuilt RequestInit is still a write',
	isWrite('fetch(url, init)', "const init = { method: 'DELETE' };"),
	true,
);
check('a plain read is not a write', isWrite("fetch('/api/x')", ''), false);
check(
	'the promote allowance does not cover the project save',
	UNPINNED_WRITES.filter((w) => w.file === 'ComponentWorkspace.svelte').every(
		(w) =>
			!!w.context &&
			!w.context.test('const body = { ...componentDraft, project: data.projectKey }'),
	),
	true,
);
check(
	'the project save of a component names its project',
	workspace.includes('{ ...componentDraft, project: data.projectKey }'),
	true,
);
const server = fileURLToPath(new URL('../src/routes/api/', import.meta.url));
for (const route of [
	'cinematics/save',
	'cinematics/delete',
	'cinematics/get',
	'cinematics/list',
	'editor/backups',
	'editor/rigs/upload',
	'editor/rigs/reindex',
	'editor/art-bounds',
	'editor/effect',
]) {
	check(
		`the session-bound /api/${route} refuses a mismatched project (scopeMismatch)`,
		readFileSync(`${server}${route}/+server.ts`, 'utf8').includes('scopeMismatch('),
		true,
	);
}
check('scopeMismatch: no project sent ⇒ go ahead', scopeMismatch(undefined, 'X'), null);
check('scopeMismatch: the same project ⇒ go ahead', scopeMismatch('X', 'X'), null);
const refused = scopeMismatch('X', 'Y');
check(
	'scopeMismatch: another project ⇒ 409 scope-mismatch',
	[refused?.status, refused ? ((await refused.json()) as { error: string }).error : null],
	[409, 'scope-mismatch'],
);

// ── 7. ETags of components the page created or refreshed ─────────────────────
check('a def with a stored ETag is known', etagKnown({ coin: '"e1"' }, 'coin'), true);
check('a built-in (null) is known: its first save creates', etagKnown({ win: null }, 'win'), true);
check('a def refreshed after load is not, so it is read on open', etagKnown({}, 'gem'), false);
check('an inherited key is not an ETag', etagKnown({}, 'toString'), false);
const v1 = {
	id: 'coin',
	name: 'Coin',
	version: 1,
	root: { id: 'r', kind: 'container', children: [] },
};
const v2 = { ...v1, version: 2 };
check(
	'the stored def is the one the draft opened from (any key order) ⇒ adopt its ETag',
	etagAdoption({
		openedFrom: v1,
		stored: { root: v1.root, version: 1, name: 'Coin', id: 'coin' },
		dirty: true,
		blocked: false,
	}),
	'adopt',
);
check(
	'someone saved since and the draft is clean ⇒ reseed from theirs, with its ETag',
	etagAdoption({ openedFrom: v1, stored: v2, dirty: false, blocked: false }),
	'reseed',
);
check(
	'someone saved since and the draft has edits ⇒ adopt nothing (the save conflicts)',
	etagAdoption({ openedFrom: v1, stored: v2, dirty: true, blocked: false }),
	'keep',
);
check(
	'a save already landed or conflicted meanwhile ⇒ adopt nothing',
	etagAdoption({ openedFrom: v1, stored: v1, dirty: false, blocked: true }),
	'keep',
);
check(
	'loadEtag decides with etagAdoption over the def the GET returned',
	/async function loadEtag[\s\S]*?etagAdoption\(\{[\s\S]*?stored: body\.def/.test(workspace),
	true,
);
check(
	'loadEtag never adopts while a save is busy, conflicted, already holds an ETag or is blocked',
	/blocked:\s*saveState\.busy \|\|\s*saveState\.status === 'conflict' \|\|\s*saveState\.etag !== null \|\|\s*writesBlocked/.test(
		workspace,
	),
	true,
);
check(
	'the page’s focus refresh takes defs and ETags together',
	editorPage.includes('/api/editor/components?etags=1&project='),
	true,
);
check(
	'a created def’s ETag is recorded even when the def is already listed',
	/if \(request\.def\) \{[\s\S]*?componentEtags = \{ \.\.\.componentEtags, \[created\.id\]: request\.etag/.test(
		workspace,
	),
	true,
);

{
	const def = (id: string, children: string[] = []) =>
		({
			id,
			name: id,
			version: 1,
			scope: 'project',
			category: 'ui',
			root: {
				id: `${id}-root`,
				kind: 'container',
				x: 0,
				y: 0,
				children: children.map((c, i) => ({
					id: `${id}-${i}`,
					kind: 'container',
					x: 0,
					y: 0,
					children: [{ id: `${id}-${i}-i`, kind: 'componentInstance', componentId: c, x: 0, y: 0 }],
				})),
			},
		}) as unknown as Parameters<typeof placeableComponents>[0][number];
	const all = [
		def('potMeterCopy', ['firecracker']),
		def('firecracker'),
		def('coinHead'),
		def('panel', ['potMeterCopy']),
		def('loopA', ['loopB']),
		def('loopB', ['loopA']),
	];
	check(
		'inside the pot: every component but itself and the ones that contain it',
		placeableComponents(all, 'potMeterCopy').map((d) => d.id),
		['firecracker', 'coinHead', 'loopA', 'loopB'],
	);
	check(
		'inside the firecracker: not the pot that holds it, nor the panel holding that pot',
		placeableComponents(all, 'firecracker').map((d) => d.id),
		['coinHead', 'loopA', 'loopB'],
	);
	check(
		'an existing cycle elsewhere does not hang the walk',
		placeableComponents(all, 'coinHead').map((d) => d.id),
		['potMeterCopy', 'firecracker', 'panel', 'loopA', 'loopB'],
	);
}

if (failures > 0) {
	console.error(`\n${failures} of ${checks} component-link checks failed`);
	process.exit(1);
}
console.log(`component links: ${checks} checks passed`);
