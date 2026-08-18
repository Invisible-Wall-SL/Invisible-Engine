// Contract test for the AUTOMATIC rig-text sync — the "no human input beyond the original
// text" path (design `docs/design/invisible-cinematic.md` §12.4a).
//
//   node tools/rigger-spike/rigtext-autosync.mjs
//
// Rig text is authored once (an id, a key, a font); every later change belongs to
// `/localization`. Opening the rig is what reconciles the two, so the decision this pins is the
// one the whole automation rests on: given a rig and the current strings, WHAT IS STALE, and
// does clearing it need new pixels or only new attachments?
//
// Both halves are extracted from their real sources rather than restated here — `localesFor`
// from `src/rigger-text/main.ts` (the bake's own definition of "which locales") and
// `textElementDrift` from `static/rigger/view.html`. Restating either would let the gate pass
// while the tool shipped the opposite behaviour, which is the failure mode that matters: a
// drift oracle that disagrees with the baker re-bakes forever, or never.
//
// It does not rasterise and does not touch R2. Whether the baked art LOOKS right is a live check.
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
// Overridable so the gate can be pointed at a deliberately-broken copy and shown to FAIL —
// a gate nobody has watched fail is a gate nobody knows is wired up.
const VIEW = process.env.RIGTEXT_VIEW_SRC
	? new URL(`file://${process.env.RIGTEXT_VIEW_SRC.replace(/\\/g, '/')}`)
	: new URL('apps/launcher-api/static/rigger/view.html', ROOT);
const MAIN = new URL('apps/launcher-api/src/rigger-text/main.ts', ROOT);

let pass = 0;
const failures = [];
function check(name, cond, detail) {
	if (cond) pass++;
	else failures.push(name + (detail ? ' — ' + detail : ''));
}

// ---- extract the real implementations ---------------------------------------------------
/** Pull `function <name>(…){…}` out of a source file by brace-matching from its signature. */
function extractFn(src, name) {
	const start = src.search(new RegExp('function\\s+' + name + '\\s*\\('));
	if (start < 0) throw new Error(`could not find function ${name}() — did it get renamed?`);
	let depth = 0,
		i = src.indexOf('{', start);
	const open = i;
	for (; i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
	}
	throw new Error(`unbalanced braces reading ${name}()`);
}

const viewSrc = readFileSync(VIEW, 'utf8');
const mainSrc = readFileSync(MAIN, 'utf8')
	// the one TS annotation inside localesFor's body/signature — strip to eval as JS
	.replace(/: \{ locale: string; text: string \}\[\]/g, '')
	.replace(/\(el: RigTextElementInput\)/g, '(el)');

const localesForSrc = extractFn(mainSrc, 'localesFor');
const driftSrc = extractFn(viewSrc, 'textElementDrift');
const attExistsSrc = extractFn(viewSrc, 'textAttachmentExists');

// `localesFor` closes over the module-level `strings`; `textElementDrift` over `rawDoc` and
// `window.RiggerText`. Rebuild exactly that environment, so both run as written.
const harness = new Function(
	'strings',
	'rawDoc',
	'window',
	`${localesForSrc}\n${attExistsSrc}\n${driftSrc}\n` +
		`window.RiggerText = { localesFor };\n` +
		`return { localesFor, textElementDrift };`,
);

/** Run the real functions against one scenario. */
function run({ strings, skeleton, element }) {
	const win = {};
	const api = harness(strings, skeleton, win);
	const why = api.textElementDrift(element);
	// The tool's own branch: anything that is not purely a missing attachment needs new pixels.
	const needsBake = why.some((w) => !w.endsWith('(not in the rig)'));
	return { why, needsBake };
}

// ---- fixtures ---------------------------------------------------------------------------
const STRINGS = (translations, source = 'Buy Feature') => ({
	sourceLang: 'en',
	targetLangs: ['it', 'es', 'fr'],
	entries: [{ key: 'Buy Feature', source, translations, unreviewed: 0 }],
});

const EL = (variants) => ({
	id: 'buyfeature',
	key: 'Buy Feature',
	slot: 'text_buyfeature',
	sourceLocale: 'en',
	variants,
});

/** A skeleton whose `text_buyfeature` slot carries exactly `locales`. */
const SKEL = (locales) => ({
	skins: [
		{
			name: 'default',
			attachments: {
				text_buyfeature: Object.fromEntries(
					locales.map((l) => [`buyfeature@${l}`, { path: `text/buyfeature/${l}` }]),
				),
			},
		},
	],
});

const FR = 'Acheter fonctionnalité';
const IT = 'Acquista funzione';
const ALL = { it: IT, es: 'Comprar función', fr: FR };
const FOUR = [
	{ locale: 'en', text: 'Buy Feature' },
	{ locale: 'it', text: IT },
	{ locale: 'es', text: 'Comprar función' },
	{ locale: 'fr', text: FR },
];

// ---- 1. the bug this automation replaces -------------------------------------------------
// The exact shape found on the live `bookofborutremake` rig: the document and atlas carried all
// four locales, the `.irig` carried only `@en`, so the runtime had no sibling to swap to and the
// button stayed English. This must read as drift, and must NOT re-rasterise: the pixels exist.
{
	const { why, needsBake } = run({
		strings: STRINGS(ALL),
		skeleton: SKEL(['en']),
		element: EL(FOUR),
	});
	check('baked-but-unattached: all three missing locales are drift', why.length === 3, why.join(', '));
	// `.every()` and `.some()` are both vacuous on an empty array, so each of these carries its
	// own non-emptiness guard — without them an oracle that reported NO drift passed two of the
	// three assertions in this block (caught by running the gate against a broken copy).
	check(
		'baked-but-unattached: each is reported as a rig gap, not a bake gap',
		why.length > 0 && why.every((w) => w.endsWith('(not in the rig)')),
		why.join(', '),
	);
	check(
		'baked-but-unattached: repairs WITHOUT re-rasterising',
		why.length > 0 && needsBake === false,
		why.join(', '),
	);
}

// ---- 2. a translation arrives ------------------------------------------------------------
{
	const { why, needsBake } = run({
		strings: STRINGS(ALL),
		skeleton: SKEL(['en']),
		element: EL([{ locale: 'en', text: 'Buy Feature' }]),
	});
	check('new language: reported as new', why.includes('it (new)') && why.includes('fr (new)'), why.join(', '));
	check('new language: needs a bake', needsBake === true);
}

// ---- 3. a translation is CORRECTED -------------------------------------------------------
// The case the reviewed-gate used to guard: art can now be fixed, so a changed string must
// re-bake rather than sit there forever.
{
	const { why, needsBake } = run({
		strings: STRINGS({ ...ALL, fr: 'Acheter la fonctionnalité' }),
		skeleton: SKEL(['en', 'it', 'es', 'fr']),
		element: EL(FOUR),
	});
	check('corrected string: reported as changed', why.join(',') === 'fr (changed)', why.join(', '));
	check('corrected string: needs a bake', needsBake === true);
}

// ---- 4. the SOURCE string is edited ------------------------------------------------------
{
	const { why } = run({
		strings: STRINGS(ALL, 'Buy Bonus'),
		skeleton: SKEL(['en', 'it', 'es', 'fr']),
		element: EL(FOUR),
	});
	check('source edit: the source locale re-bakes too', why.join(',') === 'en (changed)', why.join(', '));
}

// ---- 5. a rig that is already current does NOTHING ---------------------------------------
// The property that keeps opening rigs as fast as it was — and stops the sync from saving the
// rig on every single open, which would churn R2 and fight the author's undo.
{
	const { why, needsBake } = run({
		strings: STRINGS(ALL),
		skeleton: SKEL(['en', 'it', 'es', 'fr']),
		element: EL(FOUR),
	});
	check('current rig: no drift', why.length === 0, why.join(', '));
	check('current rig: no bake', needsBake === false);
}

// ---- 6. convergence ----------------------------------------------------------------------
// The oracle and the baker must agree, or the tool re-bakes on every open forever. Simulate the
// bake's own output (`localesFor`) becoming the variants, then re-measure: it must be clean.
{
	const strings = STRINGS(ALL);
	const api = harness(strings, SKEL([]), {});
	const baked = api.localesFor(EL([]));
	const { why } = run({
		strings,
		skeleton: SKEL(baked.map((v) => v.locale)),
		element: EL(baked),
	});
	check('convergence: re-measuring the bake output finds nothing stale', why.length === 0, why.join(', '));
	check('convergence: the bake covers source + every translation', baked.length === 4, `${baked.length}`);
}

// ---- 7. the review gate is really gone ---------------------------------------------------
// `/api/rigger/strings` must hand over unreviewed translations, and `localesFor` must bake them.
{
	const serverSrc = readFileSync(
		new URL('apps/launcher-api/src/routes/api/rigger/strings/+server.ts', ROOT),
		'utf8',
	);
	check(
		'endpoint no longer filters on `reviewed`',
		!/if \(t\.reviewed/.test(serverSrc) && /translations\[lang\] = t\.text/.test(serverSrc),
	);
	const api = harness(STRINGS(ALL), SKEL([]), {});
	check('unreviewed translations still bake', api.localesFor(EL([])).some((v) => v.locale === 'fr'));
}

// ---- 8. a locale that DISAPPEARS is left alone -------------------------------------------
// Deleting art because a translation vanished would blank a slot; the runtime already falls
// back to the source locale for anything unbaked.
{
	const { why } = run({
		strings: STRINGS({ it: IT }),
		skeleton: SKEL(['en', 'it', 'es', 'fr']),
		element: EL(FOUR),
	});
	check('removed translation: not treated as drift', why.length === 0, why.join(', '));
}

// ---- report ------------------------------------------------------------------------------
if (failures.length) {
	console.error(`rigtext-autosync: ${pass} passed, ${failures.length} FAILED`);
	for (const f of failures) console.error('  ✗ ' + f);
	process.exit(1);
}
console.log(`rigtext-autosync: ${pass}/${pass} assertions passed`);
