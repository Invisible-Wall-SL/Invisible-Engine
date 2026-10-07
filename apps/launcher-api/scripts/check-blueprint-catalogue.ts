/**
 * Contract check for the Pipeline Changes Catalogue tab:
 *   pnpm --filter launcher-api check:blueprint-catalogue
 *
 * Runs the real `src/lib/blueprintCatalogue.ts` over atlas-tool-shaped `/blueprints?all=1` answers.
 * Pinned: `offered` is atlas-tool's own (`cards.list_entries`), passed through and never
 * re-derived here; an answer without a `blueprints` list is `null` (the endpoint's 502), never an
 * empty catalogue; an entry with a bad id or no `offered` is counted in `dropped`; non-image kinds
 * are left out; a blueprint without a card reads as `none`; offered rows sort first; the card
 * editor link carries nothing but the id; and the wording for each state.
 */
import {
	BLUEPRINT_ID,
	cardEditorUrl,
	catalogueState,
	toCatalogueView,
} from '../src/lib/blueprintCatalogue';

let checks = 0;
let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	process.stderr.write(`FAIL ${name}\n  expected ${e}\n  actual   ${a}\n`);
}

const card = (extra: Record<string, unknown> = {}) => ({
	id: 'x',
	rev: 3,
	status: 'reviewed',
	purpose: 'Clean symbols',
	reviewedBy: 'owner',
	reviewedAt: '2026-10-06T10:00:00Z',
	...extra,
});

const view = toCatalogueView({
	gpu: 'L40S',
	blueprints: [
		{
			id: 'zeta',
			name: 'Zeta',
			kind: 'image',
			status: 'draft',
			offered: false,
			card: card({ status: 'draft' }),
		},
		{
			id: 'sdxl',
			name: 'SDXL (built-in)',
			kind: 'image',
			builtin: true,
			status: 'reviewed',
			offered: true,
			card: card(),
			problems: [],
		},
		{
			id: 'alpha',
			name: 'Alpha',
			kind: 'image',
			status: 'reviewed',
			offered: false,
			card: card(),
			problems: ['ksampler_steps is gone'],
		},
		{ id: 'beta', name: 'Beta', kind: 'image', status: 'stale', offered: false, card: card() },
		{ id: 'fresh', name: 'Fresh', kind: 'image', status: 'none', offered: false, card: null },
		{ id: 'wan_video', name: 'Wan', kind: 'video', status: 'reviewed', offered: true },
		{ id: '../evil', name: 'Evil', kind: 'image', status: 'reviewed', offered: true },
		{ id: 'unsure', name: 'Unsure', kind: 'image', status: 'reviewed', card: card() },
		'not an entry',
	],
});

if (!view) throw new Error('a well-formed answer must map');
check('gpu passes through', view.gpu, 'L40S');
check('bad id, no offered flag and a non-entry are counted, not shown', view.dropped, 3);
check(
	'order: offered, then stale/withheld, draft, no card; video and bad ids dropped',
	view.rows.map((r) => r.id),
	['sdxl', 'alpha', 'beta', 'zeta', 'fresh'],
);
check(
	'offered only for reviewed + no problems',
	view.rows.map((r) => [r.id, r.offered]),
	[
		['sdxl', true],
		['alpha', false],
		['beta', false],
		['zeta', false],
		['fresh', false],
	],
);
const byId = Object.fromEntries(view.rows.map((r) => [r.id, r]));
check('no card reads as none', byId.fresh.status, 'none');
check('no card has no rev', byId.fresh.rev, null);
check(
	'card fields carried',
	[byId.sdxl.purpose, byId.sdxl.rev, byId.sdxl.reviewedBy],
	['Clean symbols', 3, 'owner'],
);
check('built-in flagged', byId.sdxl.builtin, true);
check('problems carried', byId.alpha.problems, ['ksampler_steps is gone']);
check(
	'states',
	view.rows.map((r) => catalogueState(r).label),
	['offered', 'withheld', 'stale', 'draft', 'no card'],
);
const trusted = toCatalogueView({
	blueprints: [{ id: 'odd', name: 'Odd', status: 'draft', offered: true, card: card() }],
});
check("offered is atlas-tool's, not re-derived from status", trusted?.rows[0].offered, true);
check('no body is not an empty catalogue', toCatalogueView(null), null);
check('no blueprints list is not an empty catalogue', toCatalogueView({ gpu: 'x' }), null);
check('a non-list blueprints is not an empty catalogue', toCatalogueView({ blueprints: {} }), null);
check('an empty list is an empty catalogue', toCatalogueView({ blueprints: [] }), {
	gpu: '',
	rows: [],
	dropped: 0,
});
check('editor link', cardEditorUrl('gpt_image'), '/atlas?card=gpt_image');
check('id shape refuses a path', BLUEPRINT_ID.test('a/b'), false);
check('id shape refuses upper case', BLUEPRINT_ID.test('SDXL'), false);
check('id shape takes a slug', BLUEPRINT_ID.test('removebackgroundsam3__2_'), true);

if (failures) {
	process.stderr.write(`${failures} of ${checks} blueprint-catalogue checks FAILED\n`);
	process.exit(1);
}
console.log(`all ${checks} blueprint-catalogue checks pass`);
