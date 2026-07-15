#!/usr/bin/env node
/**
 * Invisible Flow v2 — sound-name enum codegen (the "sound cue dropdown" auto-sync).
 *
 *   node scripts/gen-flow-v2-sound-enums.mjs [--check]
 *
 * Turns a game's COMPILE-TIME sound vocabulary (`apps/lines/src/game/sound.ts`: the `MusicName` /
 * `SoundEffectName` string-literal unions, and their `SoundName` union) into a committed value-array
 * module inside `engine-flow-v2`. `BOOK_OF_VOCAB` then declares `MusicName` / `SoundEffectName` /
 * `SoundName` enums from these arrays, so the `/flow-v2` inspector renders the sound-cue `name` inputs
 * as a <select> DROPDOWN of real sound names — and adding a sound to `sound.ts` + regenerating updates
 * the dropdown with no hand-editing of the vocabulary.
 *
 * Why codegen (not an import): `engine-flow-v2` is a SHARED package and must never depend on an app
 * (`apps/lines`) — that is a backwards dependency. So the sound names are read from the app SOURCE TEXT
 * here and committed as a package-local data fixture, exactly the way `gen-flow-vocabulary.mjs` reads
 * app source and writes a fixture. This is an AUTHORING-fidelity step only: it changes which names the
 * dropdown OFFERS, never the runtime (the executor broadcasts whatever the FlowDoc declares).
 *
 * `--check` exits non-zero if the committed generated file is stale (for CI / the headless spike).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = 'apps/lines/src/game/sound.ts';
const OUT = 'packages/engine-flow-v2/src/reference/soundEnums.generated.ts';

/** Format generated TS through the repo's Prettier config so write + `--check` are idempotent. */
const format = async (source, filepath) => {
	const config = (await prettier.resolveConfig(filepath)) ?? {};
	return prettier.format(source, { ...config, filepath });
};

/**
 * Extract the string-literal members of `export type ${typeName} = 'a' | 'b' | …;`. The terminating
 * `;` is the first one at bracket-depth 0 (the union has no nested brackets, but stay robust), then
 * every `'…'` quoted literal in that body is a member, in declaration order.
 */
const parseUnionMembers = (src, typeName) => {
	const head = new RegExp(`export\\s+type\\s+${typeName}\\s*=`).exec(src);
	if (!head) throw new Error(`could not find "export type ${typeName}" in ${SOURCE}`);
	let i = head.index + head[0].length;
	let depth = 0;
	const start = i;
	for (; i < src.length; i++) {
		const c = src[i];
		if (c === '{' || c === '<' || c === '(' || c === '[') depth++;
		else if (c === '}' || c === '>' || c === ')' || c === ']') depth--;
		else if (c === ';' && depth === 0) break;
	}
	const body = src.slice(start, i);
	const members = [];
	const memberRe = /'([^']+)'/g;
	let m;
	while ((m = memberRe.exec(body))) members.push(m[1]);
	return members;
};

/** Render the committed fixture module (Prettier-shaped: tabs, single quotes, trailing commas). */
const renderModule = (music, effects) => {
	const arr = (names) => `[\n${names.map((n) => `\t'${n}',`).join('\n')}\n]`;
	return `/**
 * Invisible Flow v2 — playable sound names (GENERATED — do not edit by hand).
 *
 * Source: \`${SOURCE}\` (the \`MusicName\` / \`SoundEffectName\` / \`SoundName\` unions).
 * Regenerate: \`node scripts/gen-flow-v2-sound-enums.mjs\` (npm: \`pnpm gen:flow-v2-sounds\`).
 * Verified by \`flow-spike run v2vocab\`.
 *
 * \`BOOK_OF_VOCAB\` declares the \`MusicName\` / \`SoundEffectName\` / \`SoundName\` enums FROM these
 * arrays, so the \`/flow-v2\` inspector offers the game's REAL sound names as a dropdown for the
 * sound-cue \`name\` inputs. Authoring-fidelity only — the runtime broadcasts whatever the FlowDoc says.
 */

/** Background-music track names (\`MusicName\`). */
export const MUSIC_NAMES: string[] = ${arr(music)};

/** Sound-effect names (\`SoundEffectName\`). */
export const SOUND_EFFECT_NAMES: string[] = ${arr(effects)};

/** Every playable sound name (\`SoundName\` = \`MusicName | SoundEffectName\`). */
export const SOUND_NAMES: string[] = [...MUSIC_NAMES, ...SOUND_EFFECT_NAMES];
`;
};

const src = readFileSync(resolve(ROOT, SOURCE), 'utf8');
const music = parseUnionMembers(src, 'MusicName');
const effects = parseUnionMembers(src, 'SoundEffectName');

const check = process.argv.includes('--check');
const outPath = resolve(ROOT, OUT);
const next = await format(renderModule(music, effects), outPath);

let current = '';
try {
	current = readFileSync(outPath, 'utf8');
} catch {
	current = '';
}

const note = `${music.length} music, ${effects.length} effects`;
if (check) {
	if (current !== next) {
		console.error(`✗ ${OUT} is STALE — run: node scripts/gen-flow-v2-sound-enums.mjs`);
		process.exit(1);
	}
	console.log(`✓ ${OUT} is up to date (${note})`);
} else {
	writeFileSync(outPath, next);
	console.log(`wrote ${OUT} (${note})`);
}
