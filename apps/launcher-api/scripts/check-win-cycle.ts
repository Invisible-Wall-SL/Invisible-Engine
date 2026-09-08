/**
 * Contract check for the resting-board WIN CYCLE — the Invisible Symbols State Machine's
 * "Winning symbols after the spin" section (`doc.winCycle`).
 *
 * It exists because `docSignature()`, the page's dirty tracker, hand-lists the fields it watches,
 * and a field missing from that list is UNSAVEABLE: the control moves, the signature does not,
 * `dirty` stays false and Save stays disabled. `holdAfterBigWin` shipped exactly that way. The bug
 * hides itself, because on a project with NO `winCycle` at all the whole block flips from `null` to
 * an object — so the toggle looks like it works, and only dies once any OTHER win-cycle setting is
 * authored. Nothing type-checks it either: `docSignature` reads `doc.winCycle.x`, and a field it
 * simply never mentions is not an error anywhere, least of all in the launcher's `build` (a bare
 * `vite build` — it transpiles TypeScript and checks nothing; see `apps/launcher-api/CLAUDE.md`).
 *
 * The field list is DERIVED from the server schema (`symbolsDocSchema`), never re-typed here, so the
 * next field added to `winCycle` joins every check below the moment it is added there — and fails
 * until the signature names it:
 *   1. COVERAGE — the control table maps exactly the schema's fields.
 *   2. NAMING — the signature's `winCycle` block holds exactly those fields, no more, no fewer.
 *   3. DIRTY — each field, set on a doc that ALREADY carries a `winCycle`, moves the signature — in
 *      BOTH boolean states, because the default-ON flags persist `false` and a `|| null` written in
 *      place of `?? null` would swallow precisely that state (same for the numeric field at `0`).
 *   4. SETTERS — each control persists its authored state, marks the page dirty, and un-marks it on
 *      the way back, leaving no key behind (sparse).
 *   5. SERVER — the authored value survives `normalizeSymbolsDoc`, and the stored doc signs
 *      identically to the draft, so a successful save cannot leave the page dirty.
 *   6. DEFAULTS — the polarity the sparse persistence rests on: the state that persists is the one
 *      that differs from what the game assumes when the field is absent.
 *
 * Run:  pnpm --filter launcher-api check:win-cycle
 *
 * The `--tsconfig` that script passes maps SvelteKit's `$env/dynamic/private` to a stub
 * (`scripts/lib/env-stub.ts`), because `symbolsStorage.ts` reaches R2 → `env.ts` → that virtual
 * module, which only exists inside a SvelteKit build. Nothing the app builds uses that mapping.
 */

import { z } from 'zod';
import { normalizeSymbolsDoc, symbolsDocSchema } from '../src/lib/server/symbolsStorage.ts';
import {
	docSignature,
	setWinCycleDelay,
	setWinCycleDimNonWinning,
	setWinCycleEnabled,
	setWinCycleHoldAfterBigWin,
	setWinCycleShowLine,
	setWinCycleShowMessage,
	setWinCycleShowText,
	WIN_CYCLE_DELAY_DEFAULT,
	winCycleDimNonWinning,
	winCycleEnabled,
	winCycleHoldAfterBigWin,
	winCycleShowLine,
	winCycleShowMessage,
	winCycleShowText,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

type WinCycle = NonNullable<SymbolsDoc['winCycle']>;
type Field = keyof WinCycle;

/** The fields the doc PERSISTS, straight off the server schema rather than a list re-typed here —
 *  the whole point, since a hand-kept copy is the thing that rotted in the first place. */
const shape = (
	symbolsDocSchema.shape.winCycle as z.ZodOptional<z.ZodObject<z.ZodRawShape>>
).unwrap().shape;
const FIELDS = Object.keys(shape).sort() as Field[];

/** Values a field must stay DISTINGUISHABLE from "absent" at. Both booleans, because the default-ON
 *  flags (`enabled`/`showLine`/`showText`) persist `false` and only `?? null` keeps that out of the
 *  same bucket as an unset field; `0` on the numeric one for the same reason. A field whose type has
 *  no probes here fails loudly instead of quietly passing untested. */
function probesFor(field: Field): unknown[] {
	const type = shape[field] as z.ZodTypeAny;
	const inner = type instanceof z.ZodOptional ? type.unwrap() : type;
	if (inner instanceof z.ZodBoolean) return [true, false];
	if (inner instanceof z.ZodNumber) return [0, 2.5];
	throw new Error(`winCycle.${field} is a ${inner.constructor.name} — add probe values for it`);
}

/** One row per field: the control that authors it, the value that control persists, and the value
 *  the game reads when nobody authored it. §1 asserts this table covers `FIELDS` exactly, so a new
 *  schema field cannot slip through unregistered. */
const CONTROLS: Record<
	Field,
	{
		/** Move the control OFF its default (`true`, the state that persists) or back onto it. */
		set: (doc: SymbolsDoc, authored: boolean) => SymbolsDoc;
		/** What `set(doc, true)` must leave in the doc. */
		value: boolean | number;
		/** What the game reads when the field is absent. */
		fallback: boolean | number;
		read: (doc: SymbolsDoc) => boolean | number;
	}
> = {
	enabled: {
		set: (doc, authored) => setWinCycleEnabled(doc, !authored),
		value: false,
		fallback: true,
		read: winCycleEnabled,
	},
	delay: {
		set: (doc, authored) => setWinCycleDelay(doc, authored ? 2.5 : undefined),
		value: 2.5,
		fallback: WIN_CYCLE_DELAY_DEFAULT,
		read: (doc) => doc.winCycle?.delay ?? WIN_CYCLE_DELAY_DEFAULT,
	},
	showLine: {
		set: (doc, authored) => setWinCycleShowLine(doc, !authored),
		value: false,
		fallback: true,
		read: winCycleShowLine,
	},
	showText: {
		set: (doc, authored) => setWinCycleShowText(doc, !authored),
		value: false,
		fallback: true,
		read: winCycleShowText,
	},
	showMessage: {
		set: setWinCycleShowMessage,
		value: true,
		fallback: false,
		read: winCycleShowMessage,
	},
	dimNonWinning: {
		set: setWinCycleDimNonWinning,
		value: true,
		fallback: false,
		read: winCycleDimNonWinning,
	},
	holdAfterBigWin: {
		set: setWinCycleHoldAfterBigWin,
		value: true,
		fallback: false,
		read: winCycleHoldAfterBigWin,
	},
};

const BASE: SymbolsDoc = { version: 1, symbols: {} };

/**
 * A doc that ALREADY carries a `winCycle` — the state that exposed the bug, and the only state that
 * can catch it. On a doc with none, EVERY field looks watched, because the block flips from `null`
 * to an object whatever the field was. The marker is always a field other than the one under test,
 * so each check still moves exactly one thing.
 */
function authoredBase(field: Field): SymbolsDoc {
	return { ...BASE, winCycle: field === 'delay' ? { dimNonWinning: true } : { delay: 1.5 } };
}

// 1. COVERAGE
check('the control table maps exactly the schema fields', Object.keys(CONTROLS).sort(), FIELDS);

// 2. NAMING — the signature block itself, field for field.
const everyField: Record<string, unknown> = {};
for (const field of FIELDS) everyField[field] = probesFor(field)[0];
const signed = JSON.parse(docSignature({ ...BASE, winCycle: everyField as WinCycle })) as {
	winCycle: Record<string, unknown> | null;
};
check(
	'the dirty signature names every persisted field — and nothing else',
	Object.keys(signed.winCycle ?? {}).sort(),
	FIELDS,
);

// 3. DIRTY — the bug class, one field at a time.
for (const field of FIELDS) {
	const base = authoredBase(field);
	const before = docSignature(base);
	for (const probe of probesFor(field)) {
		const doc: SymbolsDoc = { ...base, winCycle: { ...base.winCycle, [field]: probe } };
		check(
			`winCycle.${field} = ${json(probe)} dirties a doc that already carries a winCycle`,
			docSignature(doc) !== before,
			true,
		);
	}
}
// The exact shape that shipped broken: on a project that had merely retuned the replay delay, the
// hold toggle could not be saved at all — it moved, and the Save button stayed disabled.
const retuned: SymbolsDoc = { ...BASE, winCycle: { delay: 1.5 } };
check(
	'holdAfterBigWin is saveable on a project that already retuned the delay',
	docSignature(setWinCycleHoldAfterBigWin(retuned, true)) !== docSignature(retuned),
	true,
);

// 4. SETTERS — the path the page actually takes.
for (const field of FIELDS) {
	const { set, value } = CONTROLS[field];
	const base = authoredBase(field);
	const authored = set(base, true);
	const reset = set(authored, false);
	check(`the ${field} control persists its authored state`, authored.winCycle?.[field], value);
	check(`…and marks the page dirty`, docSignature(authored) !== docSignature(base), true);
	check(
		`…and returning it to the default restores the signature`,
		docSignature(reset),
		docSignature(base),
	);
	check(`…and leaves no ${field} key behind (sparse)`, field in (reset.winCycle ?? {}), false);
}

// 5. SERVER — what the save round-trips, and that it does not re-dirty the page.
for (const field of FIELDS) {
	const { set, value } = CONTROLS[field];
	const authored = set(authoredBase(field), true);
	const stored = normalizeSymbolsDoc(authored);
	check(`the server keeps an authored ${field}`, stored.winCycle?.[field], value);
	check(
		`…and the stored doc signs the same as the draft, so the save clears dirty`,
		docSignature({ ...BASE, winCycle: stored.winCycle }),
		docSignature(authored),
	);
	const cleared = normalizeSymbolsDoc(set(authored, false));
	check(
		`…and a defaulted ${field} round-trips to no key at all`,
		field in (cleared.winCycle ?? {}),
		false,
	);
}

// 6. DEFAULTS — the polarity every "sparse" claim above rests on.
for (const field of FIELDS) {
	const { read, fallback, value } = CONTROLS[field];
	check(`an un-authored ${field} reads as the game's coded default`, read(BASE), fallback);
	check(`…so the state worth persisting is the other one`, value !== fallback, true);
}

console.log(
	failures === 0
		? `\nwin cycle: OK (${checks} checks)`
		: `\nwin cycle: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
