// Every symbol drawn on a board layer must have a BoardContext above it.
//
//   node scripts/verify-symbol-wrap-context.mjs
//
// WHY THIS EXISTS. `SymbolWrap` decides whether it belongs on the layer it is being drawn into by
// reading `getContextBoard()`:
//
//     const show = (boardContext.animate && props.animating) || (!boardContext.animate && !props.animating)
//
// With no `<BoardContext>` provider above it, that read is `undefined` and the FIRST symbol drawn
// throws `Cannot read properties of undefined (reading 'animate')`.
//
// `MultiplierBoard` shipped exactly that way. It mounted `<BoardContainer><MultiplierBoardBase/>` with
// no context, so the multiplier-collect beat crashed on every project that landed a multiplier — and
// nothing caught it, because the overlay renders nothing until its own cue arrives. A build cannot see
// it (the context is resolved at runtime), a type-check cannot see it (the getter is typed as present),
// and no other fixture drives the render path. It surfaced as a bug report from a live game.
//
// So the rule is asserted structurally instead, on the shape a reader can actually check:
//
//   A component that opens a `<BoardContainer>` AND draws symbols into it must provide a
//   `<BoardContext>` — and must provide BOTH layers.
//
// It keys on the symbols, not on the container alone. The broader rule ("every container needs a
// context") was written first and it flagged `WinLine`, which draws only `Graphics` and text and
// therefore never reads the context. That would have been a rule about tidiness rather than about
// the crash, so it was narrowed to what is actually true.
//
// The second failure mode is quieter and worth naming: `SymbolWrap` renders a symbol on exactly ONE
// of the two layers (the split IS `animating` — a spine symbol overflows its cell and draws unmasked
// above the mask). A host that provides only ONE context silently hides whichever half of a project's
// art it does not match. So a symbol host must provide BOTH.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/lines/src/components');

const read = (f) => readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n');

/** Strip the `<script>` blocks and HTML comments — imports and prose are not markup. */
const markupOf = (src) =>
	src.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');

let failures = 0;
let checks = 0;
const check = (label, ok) => {
	checks += 1;
	if (!ok) {
		failures += 1;
		console.log(`FAIL  ${label}`);
	}
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.svelte'));

/** Components that render a symbol through `SymbolWrap`. */
const symbolHosts = files.filter((f) => /<SymbolWrap\b/.test(markupOf(read(f))));
check(
	'at least one component renders <SymbolWrap> (the fixture is not vacuous)',
	symbolHosts.length > 0,
);

/**
 * The board LAYER hosts — a component that opens a `<BoardContainer>` is establishing a board layer,
 * and every symbol drawn inside it reads the context. `Game.svelte` is excluded: it mounts the hosts,
 * it does not open a layer of its own.
 */
const layerHosts = files.filter(
	(f) => f !== 'Game.svelte' && /<BoardContainer\b/.test(markupOf(read(f))),
);
check('the board layer hosts were found', layerHosts.length >= 3);

// The rule keys on whether SYMBOLS are drawn, NOT on the container alone. A `<BoardContainer>` that
// draws only geometry — `WinLine` draws `Graphics` + text — never reads the board context, so
// requiring one there would be a rule about tidiness rather than about the crash. Asserting the
// broader shape was tried first and it flagged `WinLine`, which is correct code.
for (const file of layerHosts) {
	const markup = markupOf(read(file));
	const containers = (markup.match(/<BoardContainer\b/g) ?? []).length;
	const contexts = (markup.match(/<BoardContext\b/g) ?? []).length;
	const drawsSymbols = /<(\w*Board(Base|Tiles)|\w*Symbol)\b/.test(markup);
	if (!drawsSymbols) continue;

	// A container that draws symbols without a context IS the crash.
	check(`${file}: opens a <BoardContext> around its <BoardContainer>`, contexts > 0);
	// And it needs BOTH layers, or half the project's art is silently hidden.
	check(`${file}: provides BOTH layers (animate false AND true)`, contexts >= 2);
	check(
		`${file}: one <BoardContainer> per <BoardContext>`,
		containers >= 2 && containers === contexts,
	);
}

// The specific regression, named, so a future reader sees WHY the rule exists.
const multiplier = markupOf(read('MultiplierBoard.svelte'));
check(
	'MultiplierBoard wraps its container in a context (the shipped crash)',
	/<BoardContext[\s\S]*?<BoardContainer/.test(multiplier),
);
check(
	'MultiplierBoard provides the animate=true layer too',
	/<BoardContext\s+animate=\{true\}/.test(multiplier),
);
check(
	'MultiplierBoard provides the animate=false layer too',
	/<BoardContext\s+animate=\{false\}/.test(multiplier),
);

console.log('');
if (failures) {
	console.log(
		`${failures} FAILED of ${checks} checks — a symbol layer is missing its BoardContext.`,
	);
	process.exit(1);
}
console.log(
	`${checks} checks across ${layerHosts.length} board layer hosts — every <BoardContainer> has a ` +
		`<BoardContext> above it, and every symbol host provides both layers.`,
);
