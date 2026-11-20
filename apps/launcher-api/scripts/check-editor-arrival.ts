/**
 * The Invisible Component Editor card must land on the Components side of `/editor`, however the
 * author gets there:
 *   pnpm --filter launcher-api check:editor-arrival
 *
 *  1. the navigation that mounts `/editor` opens the side its URL names, for EVERY navigation
 *     type: `/editor?view=components&project=x` is the components home, `/editor?project=x` the
 *     Screens side. Only a full load is `enter`; the launcher home's card and another tool's bar
 *     arrive as a client-side `link`, which `/editor` once ignored, so the card opened Screens;
 *  2. it applies once: a later `/editor` navigation is `beforeNavigate`'s;
 *  3. the page wires `afterNavigate` through `editorArrival`, with no navigation-type filter.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { editorArrival } from '../src/lib/componentLinks.ts';
import { withProject } from '../src/lib/toolLinks.ts';
import { TOOLS } from '../src/lib/roles.ts';

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

const at = (href: string): { url: URL } => ({ url: new URL(href, 'https://app.example') });

// ── 1. The mounting navigation opens the side the URL names ─────────────────
const componentCard = withProject(TOOLS.componentEditor.url ?? '', 'x');
const sceneCard = withProject(TOOLS.editor.url ?? '', 'x');
check(
	'the Component Editor card is /editor?view=components&project=x',
	componentCard,
	'/editor?view=components&project=x',
);
check('the Scene Editor card is /editor?project=x', sceneCard, '/editor?project=x');

check(
	'/editor?view=components&project=x resolves the Components home',
	editorArrival(at('/editor?view=components&project=x'), false),
	{ target: null },
);
const screens = editorArrival(at('/editor?project=x'), false);
check('/editor?project=x arrives', screens !== null, true);
check('/editor?project=x resolves the Screens side', screens?.target === undefined, true);
check(
	'/editor?component=coin&project=x resolves that component',
	editorArrival(at('/editor?component=coin&project=x'), false),
	{ target: 'coin' },
);
check(
	'the Component Editor card resolves the Components home',
	editorArrival(at(componentCard), false),
	{ target: null },
);
check(
	'the Scene Editor card resolves the Screens side',
	editorArrival(at(sceneCard), false)?.target === undefined,
	true,
);

// ── 2. Once ──────────────────────────────────────────────────────────────────
check('a navigation after arrival is not re-applied', editorArrival(at(componentCard), true), null);
check('no destination applies nothing', editorArrival(null, false), null);

// ── 3. The page wiring ───────────────────────────────────────────────────────
const editorPage = readFileSync(
	fileURLToPath(new URL('../src/routes/(app)/editor/+page.svelte', import.meta.url)),
	'utf8',
);
const afterNav = /afterNavigate\(([\s\S]*?)\n\t\}\);/.exec(editorPage)?.[1] ?? '';
check('/editor has one afterNavigate', (editorPage.match(/afterNavigate\(\(/g) ?? []).length, 1);
check('its afterNavigate goes through editorArrival', /editorArrival\(/.test(afterNav), true);
check(
	'its afterNavigate filters on no navigation type (a card click is a `link`)',
	/\btype\b/.test(afterNav),
	false,
);

if (failures) {
	console.error(`\n${failures} of ${checks} checks failed`);
	process.exit(1);
}
console.log(`editor arrival: ${checks} checks passed`);
