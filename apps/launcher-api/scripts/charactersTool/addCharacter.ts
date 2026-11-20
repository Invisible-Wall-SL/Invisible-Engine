/**
 * 14. ADD A CHARACTER BY NAME (character pipeline C6b, `$lib/characters/characterAdd.ts`): the id
 * a name gives, why a name is refused, the look the tool makes, and the page's adder driven as
 * the page wires it (the real `pageEdits` and `editRefusal`) against the REAL
 * `POST` / `GET /api/editor/component` over the gate's in-memory R2.
 *
 * Two answers are stood in for, and say so in their label: a 400 (the route is handed a look with
 * its root taken off, so the refusal and its words are the route's) and a 502 (nothing a valid
 * create sends makes the storage fail).
 */
import { BUILTIN_COMPONENTS, type ComponentDef } from 'engine-layout';
import { characterComponentIds, normalizeGameConfigDoc, type GameConfigDoc } from 'game-config';
import {
	LOOK_EXPLAINED,
	LOOK_ID_MAX,
	NAME_LETTERS,
	NO_EDITOR_GRANT,
	characterAdder,
	characterNamePlan,
	characterNameRefusal,
	listedLook,
	lookIdFor,
	newLookComponent,
	type AddCharacterResult,
	type ListedLook,
} from '../../src/lib/characters/characterAdd.ts';
import { savedIssues } from '../../src/lib/characters/sheetCore.ts';
import { clipIdOf } from '../../src/lib/flipbook/characterSet.ts';
import { editRefusal, pageEdits } from '../../src/routes/(app)/characters/pageSave.ts';
import type { Section } from './harness';
import { callRoute, memoryR2, type RouteUser } from './routes.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const BUILTINS: ListedLook[] = BUILTIN_COMPONENTS.map(listedLook);
/** A shared-library component whose id is not its own storage key. */
const SHARED: ListedLook = { id: 'Polar-Bear', name: 'Polar Bear (shared)', scope: 'shared' };
const LISTED: ListedLook[] = [...BUILTINS, SHARED];

const arcadeDoc = (): GameConfigDoc =>
	normalizeGameConfigDoc({
		family: 'arcade',
		outcome: 'rules',
		arcade: { field: { w: 2000, h: 1200 } },
	}) as GameConfigDoc;

export const run: Section = async (t) => {
	const { r2Slug, projectComponentKey, projectComponentVersionKey, gameConfigDocKey } =
		await import('../../src/lib/server/projectPaths.ts');
	const { normalizeComponent, loadComponent } =
		await import('../../src/lib/server/componentStorage.ts');
	const route = (await import('../../src/routes/api/editor/component/+server.ts')) as {
		POST: (event: never) => Promise<Response>;
		GET: (event: never) => Promise<Response>;
	};
	const r2 = await memoryR2();

	// ── the id, the plan, the look ────────────────────────────────────────────────────────────
	t.same(
		'14. the id a name gives: lower-case letters and digits, one _ for anything else',
		['Bear', ' Polar  Bear! ', 'be-ar', 'Ünïcorn 2', '__x__', '???', ''].map(lookIdFor),
		['bear', 'polar_bear', 'be_ar', 'n_corn_2', 'x', '', ''],
	);
	{
		const names = ['Bear', 'Polar Bear!', 'be-ar', 'a'.repeat(LOOK_ID_MAX), 'Fox 2'];
		t.same(
			'14. that id is its own storage key, and the keys compared are the storage’s (r2Slug)',
			[
				names.map((n) => r2Slug(lookIdFor(n)) === lookIdFor(n)),
				[...LISTED.map((c) => c.id), 'Be--Ar', 'x'.repeat(70)].every(
					(id) => clipIdOf(id) === r2Slug(id),
				),
			],
			[names.map(() => true), true],
		);
	}
	t.check(
		'14. the look is explained in one sentence',
		/^The look is the component [^.]+\.$/.test(LOOK_EXPLAINED),
	);
	{
		const def = newLookComponent('bear', '  Polar   Bear ');
		t.same(
			'14. the look: a project component, a container with one square standing on its place',
			[def.id, def.name, def.version, def.scope, def.root.x, def.root.y, def.root.children],
			[
				'bear',
				'Polar Bear',
				1,
				'project',
				0,
				0,
				[
					{
						id: 'bear-shape',
						kind: 'rect',
						x: 0,
						y: -50,
						width: 100,
						height: 100,
						color: (def.root.children[0] as { color: number }).color,
					},
				],
			],
		);
		t.check(
			'14. the look is what the storage’s normalizer stores, key for key, and is the same each time',
			JSON.stringify(normalizeComponent(copy(def))) === JSON.stringify(def) &&
				JSON.stringify(newLookComponent('bear', 'Polar Bear')) === JSON.stringify(def),
		);
	}

	const withBear = arcadeDoc();
	withBear.arcade = {
		...withBear.arcade,
		characters: [
			{ id: 'bear', component: 'salmonsBear' },
			{ id: 'hero', component: 'heroLook' },
		],
	};
	const PROJECT_LOOKS: ListedLook[] = [
		{ id: 'heroLook', name: 'Hero', scope: 'project' },
		{ id: 'Spare', name: 'Spare look', scope: 'project' },
	];
	t.same(
		'14. why a name is refused',
		[
			'',
			'   ',
			'?!',
			'a'.repeat(LOOK_ID_MAX + 1),
			'a'.repeat(61),
			'Bear',
			'Hero Look',
			'heroLook',
			'Wolf',
			'spare',
		].map((n) => characterNameRefusal(n, [...LISTED, ...PROJECT_LOOKS], withBear)),
		[
			'Type a name for the character.',
			'Type a name for the character.',
			'A name needs a letter or a digit: its id is made of a to z and 0 to 9.',
			`That name is too long: its id "${'a'.repeat(41)}" has 41 characters, and an id holds 40.`,
			`That name is too long: its id "${'a'.repeat(61)}" has 61 characters, and an id holds 40.`,
			'A character is already called "bear".',
			null,
			'"Hero" is already the look of the character "hero". Pick another name.',
			null,
			null,
		],
	);
	t.same(
		'14. a free name creates; an unused project component of that key is taken up, not refused',
		[
			characterNamePlan('Wolf', [...LISTED, ...PROJECT_LOOKS], withBear),
			characterNamePlan(' SPARE! ', [...LISTED, ...PROJECT_LOOKS], withBear),
		],
		[
			{ kind: 'create', id: 'wolf', name: 'Wolf' },
			{ kind: 'adopt', id: 'spare', name: 'SPARE!', component: 'Spare' },
		],
	);
	t.same(
		'14. a name whose letters or digits the id would drop is refused, not given a misleading id',
		['Ünï', 'Ünïcorn 2', 'U\u0308ni', 'Медведь', 'Bear ٣', 'Polar Bear!', 'be-ar'].map((n) =>
			characterNameRefusal(n, [], arcadeDoc()),
		),
		[NAME_LETTERS, NAME_LETTERS, NAME_LETTERS, NAME_LETTERS, NAME_LETTERS, null, null],
	);
	{
		const dashed = (id: string): ListedLook[] => [{ id, name: id, scope: 'project' }];
		t.same(
			'14. two spellings are one stored component only when their storage keys match: `be-ar` is `be_ar`, `be-ar!` (`be_ar_`) is not',
			[
				['be-ar', 'be-ar!'].map((id) => [lookIdFor(id), r2Slug(id)]),
				characterNamePlan('be-ar!', dashed('be-ar'), arcadeDoc()),
				characterNamePlan('be_ar', dashed('be-ar!'), arcadeDoc()),
			],
			[
				[
					['be_ar', 'be_ar'],
					['be_ar', 'be_ar_'],
				],
				{ kind: 'adopt', id: 'be_ar', name: 'be-ar!', component: 'be-ar' },
				{ kind: 'create', id: 'be_ar', name: 'be_ar' },
			],
		);
	}
	t.same(
		'14. a component with no scope listed is not taken for the project’s',
		characterNamePlan('spare', [{ id: 'Spare', name: 'Spare look' }], arcadeDoc()).kind,
		'refused',
	);

	// ── the page ──────────────────────────────────────────────────────────────────────────────
	interface PageOptions {
		role?: string;
		components?: ListedLook[];
		doc?: GameConfigDoc;
	}
	/** What a route threw that is not an answer: the adder reads it as no answer, so it is listed. */
	const crashes: string[] = [];
	/** The page as `+page.svelte` wires it: its doc behind `pageEdits` and `editRefusal`, its
	 *  load-time component list, and a `fetch` that reaches the real component route. */
	const openPage = (project: string, options: PageOptions = {}) => {
		const user: RouteUser = {
			id: `u-${options.role ?? 'developer'}`,
			role: options.role ?? 'developer',
		};
		const page = {
			doc: options.doc ?? arcadeDoc(),
			components: [...(options.components ?? LISTED)],
			readOnly: false,
			saving: false,
			/** Every request made: `POST 200`, `GET 200`… */
			requests: [] as string[],
			/** The body of every POST, as sent. */
			posted: [] as Record<string, unknown>[],
			/** While set, a request waits on it before it reaches the route. */
			hold: null as Promise<void> | null,
			/** What stands in for the route's answer, when it is not asked. */
			instead: null as null | 'network' | 502 | 'no-root',
		};
		const opened = JSON.stringify(page.doc);
		const send = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input), 'https://launcher.test');
			const method = init?.method ?? 'GET';
			if (url.pathname !== '/api/editor/component' || (method !== 'POST' && method !== 'GET'))
				throw new Error(`fixture: unexpected request ${method} ${url.pathname}${url.search}`);
			if (method === 'POST')
				page.posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			if (page.hold) await page.hold;
			let res: Response;
			if (page.instead === 'network') {
				page.requests.push(`${method} failed`);
				throw new TypeError('fetch failed');
			} else if (page.instead === 502) {
				res = new Response(JSON.stringify({ message: 'storage is unavailable' }), { status: 502 });
			} else {
				const sent = { ...init };
				if (page.instead === 'no-root' && method === 'POST') {
					const { root: _root, ...rest } = JSON.parse(String(init?.body)) as Record<
						string,
						unknown
					>;
					sent.body = JSON.stringify(rest);
				}
				try {
					res = await callRoute(method === 'POST' ? route.POST : route.GET, url, sent, user);
				} catch (e) {
					crashes.push(String(e));
					throw e;
				}
			}
			page.requests.push(`${method} ${res.status}`);
			return res;
		}) as typeof fetch;
		const refusal = () => editRefusal({ readOnly: page.readOnly, saving: page.saving });
		const { change } = pageEdits({ refusal, doc: () => page.doc });
		const add = characterAdder({
			projectKey: project,
			doc: () => page.doc,
			components: () => page.components,
			refusal,
			change,
			fetch: send,
		});
		return { page, add, untouched: () => JSON.stringify(page.doc) === opened };
	};
	const key = (project: string, id: string): string => projectComponentKey(project, id);
	const refusedOf = (r: AddCharacterResult): string => (r.ok ? '(added)' : r.refused);
	const existingOf = (r: AddCharacterResult): string | undefined => (r.ok ? '(added)' : r.existing);
	const errorsOf = (doc: GameConfigDoc): string[] =>
		savedIssues(doc)
			.filter((i) => i.severity === 'error')
			.map((i) => i.message);

	// A name that runs into a shared or built-in component is refused before any request.
	{
		const { page, add, untouched } = openPage('add-refused');
		const names = ['Button', 'BUTTON!', 'hudReadout', 'polar bear', 'POLAR_BEAR', 'Polar.Bear!'];
		const results = [];
		for (const name of names) results.push(await add(name));
		results.push(await add('a'.repeat(61)), await add(' '));
		t.same(
			'14. a name whose key is a built-in’s or a shared component’s (case, punctuation), a name over 60, a blank one: refused',
			[results.map((r) => r.ok), results.slice(0, 6).map(existingOf)],
			[
				results.map(() => false),
				['button', 'button', 'hudReadout', 'Polar-Bear', 'Polar-Bear', 'Polar-Bear'],
			],
		);
		t.same(
			'14. … with no request, the doc untouched and nothing stored',
			[page.requests, untouched(), await r2.keys('editor/add_refused/')],
			[[], true, []],
		);
		t.check(
			'14. … and the refusal says what it would replace',
			refusedOf(results[0]) ===
				'"Button" is a component every game has, and a look called "button" would replace it in this game. Pick another name.',
			refusedOf(results[0]),
		);
	}

	// Success.
	{
		const project = 'add-ok';
		const { page, add, untouched } = openPage(project);
		const result = await add('Polar Cub');
		t.same(
			'14. a name adds the character: the look is created, then listed as the answer says',
			result,
			{
				ok: true,
				characterId: 'polar_cub',
				component: { id: 'polar_cub', name: 'Polar Cub', scope: 'project', inputs: [] },
				how: 'created',
				listed: false,
			},
		);
		if (result.ok && !result.listed) page.components.push(result.component);
		t.same(
			'14. the request creates and never overwrites: baseEtag null, no force, this project’s',
			[page.requests, page.posted.map((b) => [b.baseEtag, 'force' in b, b.project, b.scope, b.id])],
			[['POST 200'], [[null, false, project, 'project', 'polar_cub']]],
		);
		t.same(
			'14. exactly one character, one body and one list entry are added',
			[
				page.doc.arcade?.characters,
				page.doc.arcade?.bodies,
				page.components.length - LISTED.length,
				untouched(),
			],
			[
				[{ id: 'polar_cub', component: 'polar_cub' }],
				{ polar_cub: { shape: 'box', w: 100, h: 100 } },
				1,
				false,
			],
		);
		t.same(
			'14. the doc is edited and not saved: no config is stored, and no other request was made',
			[await r2.read(gameConfigDocKey('acme', project)), page.requests.length],
			[null, 1],
		);
		t.same(
			'14. the config ships the look (characterComponentIds) and passes the save’s validation',
			[characterComponentIds(page.doc), errorsOf(page.doc)],
			[['polar_cub'], []],
		);
		const stored = await r2.read(key(project, 'polar_cub'));
		t.same(
			'14. the route stored the look as made, with its version snapshot, and reads it back',
			[
				stored?.text === JSON.stringify(newLookComponent('polar_cub', 'Polar Cub'), null, 2),
				(await r2.read(projectComponentVersionKey(project, 'polar_cub', 1)))?.text === stored?.text,
				await loadComponent('polar_cub', project),
			],
			[true, true, newLookComponent('polar_cub', 'Polar Cub')],
		);
		const again = await add('polar cub');
		t.same(
			'14. the same name again is refused (a character has it), with no request',
			[refusedOf(again), page.requests.length, page.doc.arcade?.characters?.length],
			['A character is already called "polar_cub".', 1, 1],
		);
	}

	// A double click.
	{
		const { page, add } = openPage('add-twice');
		let release = (): void => {};
		page.hold = new Promise<void>((done) => (release = done));
		const first = add('Seal');
		const second = add(' seal ');
		release();
		const [a, b] = await Promise.all([first, second]);
		t.same(
			'14. a double click is one request and one character; both clicks get the one answer',
			[first === second, a === b, a.ok, page.requests, page.doc.arcade?.characters?.length],
			[true, true, true, ['POST 200'], 1],
		);
		page.hold = null;
		const other = await add('Walrus');
		t.same(
			'14. … and the next name is its own request',
			[other.ok, page.requests, page.doc.arcade?.characters?.map((c) => c.id)],
			[true, ['POST 200', 'POST 200'], ['seal', 'walrus']],
		);
	}

	// Refusals of the request.
	{
		const project = 'add-fails';
		const cases: [string, PageOptions, 'network' | 502 | 'no-root' | null, string[], string][] = [
			[
				'a 403 (a role without the Scene Editor, the route’s own gate)',
				{ role: 'animator' },
				null,
				['POST 403'],
				NO_EDITOR_GRANT,
			],
			[
				'a 400 (the look sent without its root: the route’s refusal and words)',
				{},
				'no-root',
				['POST 400'],
				"The look could not be created: Component root must be a node with kind 'container'. Nothing was changed.",
			],
			[
				'a 502 (stood in for)',
				{},
				502,
				['POST 502'],
				'The look could not be created: storage did not answer. Nothing was changed. Try again.',
			],
			[
				'no answer (the request throws)',
				{},
				'network',
				['POST failed'],
				'The look could not be created: the launcher did not answer. Nothing was changed. Try again.',
			],
		];
		for (const [label, options, instead, requests, message] of cases) {
			const { page, add, untouched } = openPage(project, options);
			page.instead = instead;
			const result = await add('Lynx');
			t.same(
				`14. ${label}: its words, the doc untouched, nothing stored`,
				[refusedOf(result), page.requests, untouched(), await r2.keys('editor/add_fails/')],
				[message, requests, true, []],
			);
		}
		t.check(
			'14. the 403’s words name the grant and the way round it',
			NO_EDITOR_GRANT ===
				'Creating a look needs the Invisible Scene Editor grant; ask an admin, or pick an existing look under Advanced.',
		);
	}

	// Read-only, and a save in flight.
	{
		const { page, add, untouched } = openPage('add-locked');
		page.readOnly = true;
		const readOnly = await add('Moose');
		page.readOnly = false;
		page.saving = true;
		const saving = await add('Moose');
		t.same(
			'14. read-only or saving: refused in the page’s words, with no request',
			[refusedOf(readOnly), refusedOf(saving), page.requests, untouched()],
			[
				'This page is read-only: nothing was changed.',
				'A save is in flight: nothing can be edited until it lands. Try again then.',
				[],
				true,
			],
		);
		// A save that starts while the look is being created.
		page.saving = false;
		let release = (): void => {};
		page.hold = new Promise<void>((done) => (release = done));
		const flight = add('Moose');
		page.saving = true;
		release();
		const landed = await flight;
		t.same(
			'14. a save that starts during the create: the look exists, nothing is edited, and the answer says so',
			[landed, page.requests, untouched()],
			[
				{
					ok: false,
					refused:
						'A save is in flight: nothing can be edited until it lands. Try again then. The look "Moose" exists: add "Moose" again to use it.',
					existing: 'moose',
					component: { id: 'moose', name: 'Moose', scope: 'project', inputs: [] },
				},
				['POST 200'],
				true,
			],
		);
		page.saving = false;
		page.hold = null;
		const retry = await add('Moose');
		t.same(
			'14. … and adding the name again takes that look up with no request, the page’s list or not',
			[retry.ok && [retry.how, retry.listed, retry.characterId], page.requests],
			[['adopted', false, 'moose'], ['POST 200']],
		);
	}

	// 409: a component stored since the page loaded.
	{
		const project = 'add-taken';
		const author: RouteUser = { id: 'u-author', role: 'artist' };
		const authored = (id: string, name: string): ComponentDef => ({
			...newLookComponent(id, name),
			root: { id: `${id}-root`, kind: 'container', x: 0, y: 0, children: [] },
		});
		const postAs = async (def: ComponentDef): Promise<number> =>
			(
				await callRoute(
					route.POST,
					new URL('https://launcher.test/api/editor/component'),
					{ method: 'POST', body: JSON.stringify({ ...def, project, baseEtag: null }) },
					author,
				)
			).status;
		const { page, add, untouched } = openPage(project);
		t.same(
			'14. (another author stores two components after the page loaded)',
			[await postAs(authored('wolf', 'Wolf pack')), await postAs(authored('Fox', 'Fox art'))],
			[200, 200],
		);
		const before = [await r2.read(key(project, 'wolf')), await r2.read(key(project, 'Fox'))];
		const taken = await add('Wolf');
		t.same(
			'14. a 409: nothing is added, and the answer names the component that is there',
			[taken, page.requests, untouched()],
			[
				{
					ok: false,
					refused:
						'This project already has a component "Wolf pack" stored as "wolf". Nothing was changed. Add "Wolf" again to use it as the look, or pick another name.',
					existing: 'wolf',
					component: { id: 'wolf', name: 'Wolf pack', scope: 'project', inputs: [] },
				},
				['POST 409', 'GET 200'],
				true,
			],
		);
		const fox = await add('fox');
		t.same(
			'14. a 409 on a component whose id differs by case names that id',
			[existingOf(fox), untouched()],
			['Fox', true],
		);
		t.same(
			'14. … and neither stored component was overwritten',
			[await r2.read(key(project, 'wolf')), await r2.read(key(project, 'Fox'))],
			before,
		);
		const requests = page.requests.length;
		const useWolf = await add('Wolf');
		const useFox = await add('fox');
		t.same(
			'14. adding the name again uses the component as it is, with no request',
			[
				useWolf.ok && [useWolf.how, useWolf.characterId, useWolf.component.id],
				useFox.ok && [useFox.how, useFox.characterId, useFox.component.id],
				page.requests.length - requests,
				page.doc.arcade?.characters,
				Object.keys(page.doc.arcade?.bodies ?? {}),
				errorsOf(page.doc),
				await r2.read(key(project, 'wolf')),
			],
			[
				['adopted', 'wolf', 'wolf'],
				['adopted', 'fox', 'Fox'],
				0,
				[
					{ id: 'wolf', component: 'wolf' },
					{ id: 'fox', component: 'Fox' },
				],
				['wolf', 'Fox'],
				[],
				before[0],
			],
		);
	}

	// Two pages create the same name at once.
	{
		const project = 'add-race';
		const one = openPage(project);
		const two = openPage(project);
		const [a, b] = await Promise.all([one.add('Bear'), two.add('bear!')]);
		const statuses = [...one.page.requests, ...two.page.requests].filter((r) =>
			r.startsWith('POST'),
		);
		const stored = await r2.read(key(project, 'bear'));
		t.same(
			'14. two creators of one name: one 200, one 409, one component, the first’s bytes',
			[
				statuses.sort(),
				(await r2.keys('editor/add_race/')).length,
				stored?.text ===
					JSON.stringify(
						newLookComponent('bear', a.ok && a.how === 'created' ? 'Bear' : 'bear!'),
						null,
						2,
					),
			],
			[['POST 200', 'POST 409'], 2, true],
		);
		t.same(
			'14. … and the one refused takes up the untouched look: each page has its character',
			[
				[a.ok && a.how, b.ok && b.how].sort(),
				one.page.doc.arcade?.characters,
				two.page.doc.arcade?.characters,
			],
			[
				['adopted', 'created'],
				[{ id: 'bear', component: 'bear' }],
				[{ id: 'bear', component: 'bear' }],
			],
		);
	}

	// A look whose character was never saved.
	{
		const project = 'add-orphan';
		const abandoned = openPage(project);
		const made = await abandoned.add('Otter');
		const stored = await r2.read(key(project, 'otter'));
		const reloaded = openPage(project, {
			components: [...LISTED, { id: 'otter', name: 'Otter', scope: 'project', inputs: [] }],
		});
		const listed = await reloaded.add('Otter');
		t.same(
			'14. a look left by an abandoned page, listed on the next: taken up with no request',
			[
				made.ok && made.how,
				listed.ok && [listed.how, listed.listed, listed.characterId],
				reloaded.page.requests,
				reloaded.page.doc.arcade?.characters,
				reloaded.page.doc.arcade?.bodies,
			],
			[
				'created',
				['adopted', true, 'otter'],
				[],
				[{ id: 'otter', component: 'otter' }],
				{ otter: { shape: 'box', w: 100, h: 100 } },
			],
		);
		const stale = openPage(project);
		const unlisted = await stale.add('Otter');
		t.same(
			'14. … and not listed (a stale page): the create is refused (409) and the look is taken up',
			[
				unlisted.ok && [unlisted.how, unlisted.listed, unlisted.component],
				stale.page.requests,
				stale.page.doc.arcade?.characters,
				(await r2.read(key(project, 'otter')))?.etag === stored?.etag,
				errorsOf(stale.page.doc),
			],
			[
				['adopted', false, { id: 'otter', name: 'Otter', scope: 'project', inputs: [] }],
				['POST 409', 'GET 200'],
				[{ id: 'otter', component: 'otter' }],
				true,
				[],
			],
		);
	}

	t.same('14. (no route threw anything but an answer)', crashes, []);
};
