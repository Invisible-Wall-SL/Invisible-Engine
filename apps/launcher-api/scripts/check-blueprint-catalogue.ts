/**
 * Contract check for the Pipeline Changes Catalogue tab:
 *   pnpm --filter launcher-api check:blueprint-catalogue
 *
 * Runs the real `src/lib/blueprintCatalogue.ts` over atlas-tool-shaped `/blueprints?all=1` answers.
 * Pinned: a row is `offered` exactly when `cards.list_entries` would serve it to an agent
 * (reviewed, not stale, no problems); a blueprint without a card reads as `none`; non-image
 * kinds and ids that are not `r2_slug` shapes are dropped; offered rows sort first; the card
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
		{ id: 'zeta', name: 'Zeta', kind: 'image', status: 'draft', card: card({ status: 'draft' }) },
		{
			id: 'sdxl',
			name: 'SDXL (built-in)',
			kind: 'image',
			builtin: true,
			status: 'reviewed',
			card: card(),
			problems: [],
		},
		{
			id: 'alpha',
			name: 'Alpha',
			kind: 'image',
			status: 'reviewed',
			card: card(),
			problems: ['ksampler_steps is gone'],
		},
		{ id: 'beta', name: 'Beta', kind: 'image', status: 'stale', card: card(), problems: [] },
		{ id: 'fresh', name: 'Fresh', kind: 'image', status: 'draft', card: null, problems: [] },
		{ id: 'wan_video', name: 'Wan', kind: 'video', status: 'reviewed', card: card() },
		{ id: '../evil', name: 'Evil', kind: 'image', status: 'reviewed', card: card() },
		'not an entry',
	],
});

check('gpu passes through', view.gpu, 'L40S');
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
check('empty answer', toCatalogueView(null), { gpu: '', rows: [] });
check('editor link', cardEditorUrl('gpt_image'), '/atlas?card=gpt_image');
check('id shape refuses a path', BLUEPRINT_ID.test('a/b'), false);
check('id shape refuses upper case', BLUEPRINT_ID.test('SDXL'), false);
check('id shape takes a slug', BLUEPRINT_ID.test('removebackgroundsam3__2_'), true);

if (failures) {
	process.stderr.write(`${failures} of ${checks} blueprint-catalogue checks FAILED\n`);
	process.exit(1);
}
console.log(`all ${checks} blueprint-catalogue checks pass`);
