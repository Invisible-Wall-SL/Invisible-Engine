#!/usr/bin/env node
/**
 * Invisible Flow — emitter-vocabulary codegen (design doc §3, Phase-7 held follow-up).
 *
 *   node scripts/gen-flow-vocabulary.mjs [--check]
 *
 * Turns a game's COMPILE-TIME emitter vocabulary into a serializable `EmitterVocabulary`
 * fixture so the `/flow` choreography palette can offer the game's ACTUAL Broadcast events +
 * effect names instead of the bundled `DEFAULT_EMITTER_VOCABULARY`.
 *
 * Why codegen and not a pipeline export: the emitter union (`typesEmitterEvent.ts` + the
 * per-component `EmitterEvent*` unions) and the effect catalog (`flowEffects.ts`) are
 * properties of the GAME SOURCE, identical across every project built on that game — they are
 * NOT per-project authored data living in R2. So they are committed as a game-source fixture
 * (mirroring `flowDoc.ts` / `flowEffects.ts`) and surfaced through `engine-flow`, exactly the
 * way the LayoutDoc + component defs are passed in to the editor (design doc §3/§11). This is
 * an AUTHORING-fidelity step only: it changes which events/effects the picker OFFERS, never the
 * runtime (the executor broadcasts/invokes whatever the FlowDoc says).
 *
 * It parses the simple discriminated-union members (`{ type: 'name'; field: Type }`) the
 * emitter events are written as, and the keys of the `flowEffects.ts` effect map. `--check`
 * exits non-zero if the committed fixture is stale (for CI / the headless spike).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Format generated TS through the repo's Prettier config so write + `--check` are idempotent. */
const format = async (source, filepath) => {
	const config = (await prettier.resolveConfig(filepath)) ?? {};
	return prettier.format(source, { ...config, filepath });
};

/**
 * One game to generate a vocabulary fixture for. `group` maps a component's `EmitterEvent*`
 * type name onto a palette group label (provenance only).
 */
/**
 * The SHARED emitter unions every game composes into its `EmitterEvent` (see a game's
 * `eventEmitter.ts`: `EmitterEvent = EmitterEventHotKey | EmitterEventUi | EmitterEventModal |
 * EmitterEventGame`). The handlers broadcast these UI cues (`uiShow`, `drawerFold`, …) too, so
 * the palette must offer them — they are NOT game-specific. Parsed straight from the packages.
 */
const SHARED_UNIONS = [
	{ typeName: 'EmitterEventUi', file: 'packages/components-ui-pixi/src/types.ts', group: 'UI' },
	{ typeName: 'EmitterEventModal', file: 'packages/components-ui-html/src/types.ts', group: 'UI' },
	{ typeName: 'EmitterEventHotKey', file: 'packages/components-shared/src/types.ts', group: 'UI' },
];

const GAMES = [
	{
		key: 'lines',
		source: 'apps/lines/src/game/typesEmitterEvent.ts',
		flowEffects: 'apps/lines/src/game/flowEffects.ts',
		// The game's book-event union (`typesBookEvent.ts`) — the FS-2 trigger vocabulary (design doc
		// §14). Its member `type` discriminants become `bookEvent` trigger input pins in `/flow`.
		bookEvents: 'apps/lines/src/game/typesBookEvent.ts',
		out: 'apps/lines/src/game/emitterVocabulary.ts',
		exportName: 'LINES_EMITTER_VOCABULARY',
		label: 'lines',
		// LayoutDoc `gameType` values this vocabulary serves (the editor selects by it). The
		// lines union IS the shared lines/book-of vocabulary, so it covers Book of Borut too.
		gameTypes: ['lines', 'bookOf'],
		// Type-name → palette group + effect group label.
		groups: {
			EmitterEventBoard: 'Board',
			EmitterEventBoardFrame: 'Board frame',
			EmitterEventWin: 'Win',
			EmitterEventFreeSpinIntro: 'Free spins',
			EmitterEventFreeSpinCounter: 'Free spins',
			EmitterEventFreeSpinOutro: 'Free spins',
			EmitterEventSpecialBook: 'Special book',
			EmitterEventSound: 'Sound',
			EmitterEventTransition: 'Transition',
		},
		effectGroup: 'Effect',
	},
];

/** The launcher registry module the codegen also emits (so `/flow` selects by `gameType`). */
const REGISTRY_OUT = 'apps/launcher-api/src/lib/emitterVocabularies.ts';

const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

/** Coerce a TS field type annotation onto the coarse author-hint kinds. */
const kindOf = (typeText) => {
	const t = typeText.trim().replace(/;$/, '').trim();
	if (/\[\]$|^Array<|^.*\[\]$/.test(t) || t.endsWith('[]')) return 'list';
	if (t === 'number') return 'number';
	if (t === 'boolean') return 'boolean';
	if (t === 'string' || /Name$/.test(t)) return 'string';
	return 'object';
};

/**
 * Extract the `EmitterEvent*` type names referenced by a game's `typesEmitterEvent.ts`, with
 * each name's source file (resolved from its `import … from '…'`). Preserves declaration order.
 */
const parseUnionImports = (src, sourceRel) => {
	const baseDir = dirname(resolve(ROOT, sourceRel));
	const imports = new Map();
	const importRe = /import\s+type\s+\{\s*(EmitterEvent\w+)\s*\}\s+from\s+'([^']+)'/g;
	let m;
	while ((m = importRe.exec(src))) {
		imports.set(m[1], resolve(baseDir, m[2]));
	}
	// The union members, in declaration order, are the `| EmitterEventX` lines of the
	// `EmitterEventGame` alias.
	const aliasMatch = src.match(/export\s+type\s+EmitterEventGame\s*=([\s\S]*?);/);
	const order = [];
	if (aliasMatch) {
		const memberRe = /\b(EmitterEvent\w+)\b/g;
		let mm;
		while ((mm = memberRe.exec(aliasMatch[1]))) order.push(mm[1]);
	}
	return order
		.filter((name) => imports.has(name))
		.map((name) => ({ name, file: imports.get(name) }));
};

/** Split a brace-balanced union body into its top-level `{ … }` member object literals. */
const splitMembers = (body) => {
	const members = [];
	let depth = 0;
	let start = -1;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === '{') {
			if (depth === 0) start = i;
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0 && start >= 0) {
				members.push(body.slice(start + 1, i));
				start = -1;
			}
		}
	}
	return members;
};

/** Parse one `{ type: 'x'; field: T; … }` member into `{ type, fields }`. */
const parseMember = (memberBody) => {
	// Field segments are `;`-separated at depth 0 (object types nest, but our events are flat).
	const segments = [];
	let depth = 0;
	let seg = '';
	for (const c of memberBody) {
		if (c === '{' || c === '<' || c === '(') depth++;
		else if (c === '}' || c === '>' || c === ')') depth--;
		if (c === ';' && depth === 0) {
			segments.push(seg);
			seg = '';
		} else seg += c;
	}
	if (seg.trim()) segments.push(seg);

	let type = null;
	const fields = [];
	for (const raw of segments) {
		const s = raw.trim();
		if (!s) continue;
		const typeMatch = s.match(/^type\s*:\s*'([^']+)'$/);
		if (typeMatch) {
			type = typeMatch[1];
			continue;
		}
		const fieldMatch = s.match(/^(\w+)(\?)?\s*:\s*([\s\S]+)$/);
		if (fieldMatch) {
			const key = fieldMatch[1];
			const optional = Boolean(fieldMatch[2]);
			fields.push({ key, kind: kindOf(fieldMatch[3]), required: !optional });
		}
	}
	return { type, fields };
};

/**
 * Extract the body of `export type ${typeName} = …;` — the terminating `;` is the first one
 * at brace-depth 0 (members carry inner `;`-separated fields, so a naive non-greedy match
 * stops too early).
 */
const extractUnionBody = (src, typeName) => {
	// `export` is optional — the `BookEvent` union is exported, but its member aliases
	// (`type BookEventReveal = { … }`) are file-local (no `export`).
	const head = new RegExp(`(?:export\\s+)?type\\s+${typeName}\\s*=`).exec(src);
	if (!head) return null;
	let i = head.index + head[0].length;
	let depth = 0;
	const start = i;
	for (; i < src.length; i++) {
		const c = src[i];
		if (c === '{' || c === '<' || c === '(' || c === '[') depth++;
		else if (c === '}' || c === '>' || c === ')' || c === ']') depth--;
		else if (c === ';' && depth === 0) break;
	}
	return src.slice(start, i);
};

/** Parse one component file's `export type EmitterEvent* = …;` into event defs. */
const parseEventUnion = (file, typeName, group) => {
	const src = readFileSync(file, 'utf8');
	const body = extractUnionBody(src, typeName);
	if (body === null) throw new Error(`could not find "export type ${typeName}" in ${file}`);
	// A single-member alias (`= { … }`) has no leading `|`; multi-member starts each with `|`.
	const objects = splitMembers(body);
	return objects.map((objBody) => {
		const { type, fields } = parseMember(objBody);
		const def = { type, group };
		if (fields.length) def.fields = fields;
		return def;
	});
};

/**
 * Parse a game's `BookEvent` union (`typesBookEvent.ts`) into the ordered list of member `type`
 * discriminants (design doc §14 FS-2 — the book-event trigger vocabulary). The union is written as
 * `export type BookEvent = | BookEventReveal | BookEventWinInfo | …;` where each member is a
 * separately-declared `type BookEventX = { … type: 'x'; … }` local alias — so we resolve each
 * referenced alias to its `type: '…'` discriminant. Duplicate `type`s (the union may list a member
 * twice) are de-duped, preserving first-seen order.
 */
const parseBookEventTypes = (bookEventsRel) => {
	const src = read(bookEventsRel);
	const body = extractUnionBody(src, 'BookEvent');
	if (body === null) throw new Error(`could not find "export type BookEvent" in ${bookEventsRel}`);
	const aliasRe = /\b(BookEvent\w+)\b/g;
	const seen = new Set();
	const types = [];
	let m;
	while ((m = aliasRe.exec(body))) {
		const alias = m[1];
		const aliasBody = extractUnionBody(src, alias);
		if (aliasBody === null) continue;
		const typeMatch = aliasBody.match(/type\s*:\s*'([^']+)'/);
		if (!typeMatch) continue;
		const type = typeMatch[1];
		if (seen.has(type)) continue;
		seen.add(type);
		types.push(type);
	}
	return types;
};

/** Parse the `flowEffects.ts` effect-map keys (the `const effects: Record<…> = { … }` block). */
const parseEffectNames = (flowEffectsRel) => {
	const src = read(flowEffectsRel);
	const blockMatch = src.match(/const\s+effects\s*:\s*Record<[^>]*>\s*=\s*\{([\s\S]*)\n\};/);
	if (!blockMatch) throw new Error(`could not find the "effects" map in ${flowEffectsRel}`);
	const block = blockMatch[1];
	const names = [];
	// Top-level keys only: a key sits at brace-depth 0 of the map body and is followed by `:`.
	let depth = 0;
	const lines = block.split('\n');
	for (const line of lines) {
		const trimmed = line.trim();
		if (depth === 0) {
			const keyMatch = trimmed.match(/^(\w+)\s*:\s*(async\s*)?\(/);
			if (keyMatch) names.push(keyMatch[1]);
		}
		for (const c of line) {
			if (c === '{' || c === '(' || c === '[') depth++;
			else if (c === '}' || c === ')' || c === ']') depth--;
		}
	}
	return names;
};

/** A `type` discriminant that is an input/intent cue, not a broadcast a choreography author
 *  would dispatch (the engine raises these; they are filtered from the palette). */
const NON_BROADCAST = new Set([
	'hotKey',
	'hotKeySpace',
	'hotKeyEscape',
	'stopButtonClick',
	'soundPressGeneral',
	'soundPressBet',
	'soundBetMode',
	'buyBonusConfirm',
	'bet',
	'autoBet',
	'resumeBet',
]);

/** Build the serializable `EmitterVocabulary` for one game (the game union + the shared cues). */
const buildVocabulary = (game) => {
	const typesSrc = read(game.source);
	const unionMembers = parseUnionImports(typesSrc, game.source);
	const events = [];
	const seen = new Set();
	const add = (def) => {
		if (def.type && !NON_BROADCAST.has(def.type) && !seen.has(def.type)) {
			seen.add(def.type);
			events.push(def);
		}
	};
	for (const { name, file } of unionMembers) {
		const group = game.groups[name] ?? name.replace(/^EmitterEvent/, '');
		parseEventUnion(file, name, group).forEach(add);
	}
	for (const { typeName, file, group } of SHARED_UNIONS) {
		parseEventUnion(resolve(ROOT, file), typeName, group).forEach(add);
	}
	const effects = parseEffectNames(game.flowEffects).map((n) => ({
		name: n,
		group: game.effectGroup,
	}));
	const bookEvents = game.bookEvents
		? parseBookEventTypes(game.bookEvents).map((type) => ({ type }))
		: [];
	return { source: game.label, events, effects, bookEvents };
};

/** Render the committed fixture module (Prettier-shaped: tabs, single quotes, trailing commas). */
const renderModule = (game, vocab) => {
	const json = JSON.stringify(vocab, null, '\t')
		.replace(/"([A-Za-z_]\w*)":/g, '$1:')
		.replace(/"/g, "'");
	return `/**
 * Invisible Flow — apps/${game.key} EMITTER VOCABULARY (GENERATED — do not edit by hand).
 *
 * Source: \`${game.source}\` (the emitter union) + \`${game.flowEffects}\` (the effect catalog).
 * Regenerate: \`node scripts/gen-flow-vocabulary.mjs\`. Verified by \`flow-spike run vocab\`.
 *
 * This is the game's REAL Broadcast/effect vocabulary as DATA, fed to the \`/flow\` choreography
 * palette in place of the bundled \`DEFAULT_EMITTER_VOCABULARY\` (design doc §3, Phase 7). It is
 * an authoring-fidelity catalog only — the runtime executor broadcasts/invokes whatever the
 * FlowDoc declares regardless of this list, so there is zero game-parity risk.
 */

import type { EmitterVocabulary } from 'engine-flow';

export const ${game.exportName}: EmitterVocabulary = ${json};
`;
};

/**
 * Render the launcher registry: the generated vocabularies as DATA keyed by LayoutDoc
 * `gameType`, plus a resolver that falls back to `DEFAULT_EMITTER_VOCABULARY` for any game
 * with no exported vocabulary (the §7 parity-safe default). The launcher imports `engine-flow`
 * but not app source, so the catalog is inlined here as plain data, not re-imported.
 */
const renderRegistry = (entries) => {
	const lines = [];
	for (const { game, vocab } of entries) {
		const json = JSON.stringify(vocab, null, '\t')
			.replace(/"([A-Za-z_]\w*)":/g, '$1:')
			.replace(/"/g, "'")
			.split('\n')
			.map((l, i) => (i === 0 ? l : `\t${l}`))
			.join('\n');
		for (const gameType of game.gameTypes) {
			lines.push(`\t'${gameType}': ${json},`);
		}
	}
	return `/**
 * Invisible Flow — exported emitter vocabularies keyed by game (GENERATED — do not edit).
 *
 * Sources: each game's \`typesEmitterEvent.ts\` union + \`flowEffects.ts\` catalog.
 * Regenerate: \`node scripts/gen-flow-vocabulary.mjs\`. Verified by \`flow-spike run vocab\`.
 *
 * The \`/flow\` choreography palette offers the game's REAL Broadcast events + effect names
 * instead of the bundled \`DEFAULT_EMITTER_VOCABULARY\` (design doc §3, Phase 7). The launcher
 * loads a project from R2 (not game source), so the catalog is passed in as DATA the same way
 * the LayoutDoc + component defs are. Selection is by the LayoutDoc \`gameType\`; any game with
 * no exported vocabulary falls back to the default (parity-safe, §7). Authoring-fidelity only:
 * the runtime executor broadcasts/invokes whatever the FlowDoc declares regardless of this list.
 */

import { DEFAULT_EMITTER_VOCABULARY, type EmitterVocabulary } from 'engine-flow';

/** Exported vocabularies keyed by LayoutDoc \`gameType\`. */
export const EMITTER_VOCABULARIES: Record<string, EmitterVocabulary> = {
${lines.join('\n')}
};

/** Resolve the authoring vocabulary for a project's \`gameType\`; unknown ⇒ the coded default. */
export const resolveEmitterVocabulary = (gameType: string | undefined): EmitterVocabulary =>
	(gameType ? EMITTER_VOCABULARIES[gameType] : undefined) ?? DEFAULT_EMITTER_VOCABULARY;
`;
};

const games = GAMES.map((game) => ({ game, vocab: buildVocabulary(game) }));
const check = process.argv.includes('--check');
let stale = 0;

/** Write `next` to `outRel`, or (in `--check`) report whether the committed file is stale. */
const emit = async (outRel, raw, note) => {
	const outPath = resolve(ROOT, outRel);
	const next = await format(raw, outPath);
	let current = '';
	try {
		current = readFileSync(outPath, 'utf8');
	} catch {
		current = '';
	}
	if (check) {
		if (current !== next) {
			stale++;
			console.error(`✗ ${outRel} is STALE — run: node scripts/gen-flow-vocabulary.mjs`);
		} else {
			console.log(`✓ ${outRel} is up to date${note ? ` (${note})` : ''}`);
		}
	} else {
		writeFileSync(outPath, next);
		console.log(`wrote ${outRel}${note ? ` (${note})` : ''}`);
	}
};

for (const { game, vocab } of games) {
	await emit(
		game.out,
		renderModule(game, vocab),
		`${vocab.events.length} events, ${vocab.effects.length} effects, ${vocab.bookEvents.length} book events`,
	);
}
await emit(REGISTRY_OUT, renderRegistry(games), `${games.length} game(s)`);

if (check && stale > 0) process.exit(1);
