/**
 * Invisible Game Config — point this at ANY config and see exactly what the tool would say about
 * it, before there is a tool to say it. The paste-in-from-the-math-team flow, headless:
 *
 *   pnpm --filter game-config-spike run inspect ../../apps/lines/src/game/config.ts
 *   pnpm --filter game-config-spike run inspect ./some-math-export.json
 *   pnpm --filter game-config-spike run inspect \
 *     ../../apps/launcher-api/src/lib/data/gameConfig/lines.json
 *
 * Accepts a `.ts` module with a default export (a game's `config.ts`) or a `.json` file. Prints the
 * grid, the bet modes, the DICTIONARY vs the IN-PLAY set (the distinction the whole tool turns on),
 * the per-reel symbol frequencies, and every validation issue. Exits 1 if anything is a blocking
 * error, so it doubles as a gate a math hand-off can be run through.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	normalizeGameConfigDoc,
	symbolFrequencies,
	symbolsInPlay,
	validateGameConfigDoc,
} from 'game-config';

const target = process.argv[2];
if (!target) {
	console.error('usage: inspect <path to config.ts | config.json>');
	process.exit(1);
}

const path = isAbsolute(target) ? target : resolve(process.cwd(), target);
const raw = path.endsWith('.json')
	? JSON.parse(readFileSync(path, 'utf8'))
	: ((await import(pathToFileURL(path).href)) as { default: unknown }).default;

const doc = normalizeGameConfigDoc(raw);
if (!doc) {
	console.error(`\n✗ ${path}\n  Not a usable game config — it has no symbol dictionary, or no`);
	console.error('  reel strips. A project with this config would fall back to the compiled one.');
	process.exit(1);
}

const inPlay = symbolsInPlay(doc);
const dictionary = Object.keys(doc.symbols).sort();
const idle = dictionary.filter((s) => !inPlay.includes(s));

console.log(`\n${path}\n`);
console.log(
	`  ${doc.providerName || '(no provider)'} · ${doc.gameName || '(no name)'} · ${doc.gameID || '(no id)'}`,
);
console.log(
	`  RTP ${doc.rtp} · ${doc.numReels} reels × [${doc.numRows.join(', ')}] rows · ${Object.keys(doc.paylines).length} paylines`,
);
console.log(
	`  bet modes: ${
		Object.entries(doc.betModes)
			.map(
				([name, m]) =>
					`${name} (cost ${m.cost}${m.buyBonus ? ', buy-bonus' : ''}, max ×${m.max_win})`,
			)
			.join(' · ') || '(none)'
	}`,
);

console.log(`\n  dictionary (${dictionary.length}): ${dictionary.join(', ')}`);
console.log(`  IN PLAY    (${inPlay.length}): ${inPlay.join(', ')}`);
if (idle.length) {
	console.log(
		`  never dealt (${idle.length}): ${idle.join(', ')}  ← in the dictionary, on no strip`,
	);
}

console.log('\n  strips (cells per reel, and the symbols each deals):');
const freq = symbolFrequencies(doc);
for (const [gameType, reels] of Object.entries(freq)) {
	console.log(`    ${gameType}:`);
	reels.forEach((counts, reel) => {
		const total = Object.values(counts).reduce((a, b) => a + b, 0);
		const top = Object.entries(counts)
			.sort((a, b) => b[1] - a[1])
			.map(([name, n]) => `${name}×${n}`)
			.join(' ');
		console.log(`      reel ${reel + 1}: ${total} cells — ${top}`);
	});
}

const issues = validateGameConfigDoc(doc);
const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');

console.log('');
if (!issues.length) console.log('  ✓ no issues');
for (const issue of errors) console.log(`  ✗ ERROR   ${issue.path}: ${issue.message}`);
for (const issue of warnings) console.log(`  ! warning ${issue.path}: ${issue.message}`);

console.log(
	`\n  ${errors.length} error(s), ${warnings.length} warning(s) — ` +
		`${errors.length ? 'this config would be REFUSED on save.' : 'this config would save.'}\n`,
);
process.exit(errors.length ? 1 : 0);
