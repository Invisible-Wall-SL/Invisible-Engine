// Generate the COMMITTED per-game-type Game Config defaults —
// `src/lib/data/gameConfig/<gameType>.json` — from that game type's own
// `src/game/config.ts`, so the two cannot drift.
//
// This is Phase 2 of `docs/design/invisible-game-config.md`: a project that has never authored a
// config inherits its template's default instead of the one sample config compiled into the shared
// `_runtime/lines` bundle. The producer pattern mirrors `publish-symbol-defaults.mjs` — a coded
// truth is mechanically derived, never hand-copied.
//
// Why COMMITTED rather than published to R2 like the symbol defaults: these are per-GAME-TYPE
// (there are two, `lines` and `bookOf`), not per-project, and the launcher must be able to seed a
// brand-new project before it has any R2 presence at all. A project's own authored config lives in
// R2 (`gameConfigStorage.ts`) and takes precedence.
//
//   # from apps/launcher-api
//   npx tsx scripts/generate-game-config-defaults.ts
//   npx tsx scripts/generate-game-config-defaults.ts --check      # CI/drift gate, writes nothing
//   npx tsx scripts/generate-game-config-defaults.ts \
//     --game-type bookOf --config ../../games/borut/src/game/config.ts
//
// The drift gate is ALSO asserted offline by `tools/game-config-spike` (it re-derives the doc from
// the real `apps/lines` config and compares), so drift fails a fixture run even if nobody thinks to
// run `--check`. That redundancy is deliberate: a generator nobody runs is a generator that lies.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { gameConfigErrors, normalizeGameConfigDoc, symbolsInPlay } from 'game-config';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../src/lib/data/gameConfig');

/** The game types that ship a committed default, and the config module each derives from.
 *  Keyed to `engine-layout`'s built-in templates; a game type absent here falls back to `lines`,
 *  exactly as `symbolDefaultsFor` does. */
const BUILT_IN: Record<string, string> = {
	lines: resolve(HERE, '../../lines/src/game/config.ts'),
};

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const check = has('check');
const oneType = flag('game-type');
const oneConfig = flag('config');

if (oneConfig && !oneType) {
	console.error('--config requires --game-type (which default file to write).');
	process.exit(1);
}

const targets: Array<[string, string]> = oneType
	? [
			[
				oneType,
				oneConfig ? (isAbsolute(oneConfig) ? oneConfig : resolve(oneConfig)) : BUILT_IN[oneType],
			],
		]
	: Object.entries(BUILT_IN);

let failures = 0;

for (const [gameType, configPath] of targets) {
	if (!configPath) {
		console.error(`✗ ${gameType}: no config module registered — pass --config <path>.`);
		failures++;
		continue;
	}

	const module = (await import(pathToFileURL(configPath).href)) as { default: unknown };
	const doc = normalizeGameConfigDoc(module.default);
	if (!doc) {
		console.error(
			`✗ ${gameType}: ${configPath} does not describe a game (no symbols or no strips).`,
		);
		failures++;
		continue;
	}

	// A default that ships errors would seed every new project of this type with a broken config.
	const errors = gameConfigErrors(doc);
	if (errors.length) {
		console.error(`✗ ${gameType}: the config has blocking errors and will not be written:`);
		for (const issue of errors) console.error(`    ${issue.path}: ${issue.message}`);
		failures++;
		continue;
	}

	// `updatedAt` is a per-save stamp; committing it would make every regeneration a diff.
	delete doc.updatedAt;
	const json = `${JSON.stringify(doc, null, 2)}\n`;
	const outPath = resolve(OUT_DIR, `${gameType}.json`);

	if (check) {
		let current: string | null = null;
		try {
			current = readFileSync(outPath, 'utf8');
		} catch {
			current = null;
		}
		if (current === json) {
			console.log(`✓ ${gameType}: up to date`);
		} else {
			console.error(`✗ ${gameType}: ${outPath} is stale — re-run without --check to regenerate.`);
			failures++;
		}
		continue;
	}

	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(outPath, json, 'utf8');
	const inPlay = symbolsInPlay(doc);
	console.log(
		`✓ ${gameType}: wrote ${outPath} — ${doc.numReels} reels, ` +
			`${Object.keys(doc.paylines).length} paylines, ` +
			`${inPlay.length}/${Object.keys(doc.symbols).length} symbols in play`,
	);
}

process.exit(failures ? 1 : 0);
