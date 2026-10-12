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
// (`lines`, `ways`, `cluster`, `scatter`), not per-project, and the launcher must be able to seed a
// brand-new project before it has any R2 presence at all. A project's own authored config lives in
// R2 (`gameConfigStorage.ts`) and takes precedence.
//
//   # from apps/launcher-api
//   npx tsx scripts/generate-game-config-defaults.ts
//   npx tsx scripts/generate-game-config-defaults.ts --check      # CI/drift gate, writes nothing
//   npx tsx scripts/generate-game-config-defaults.ts \
//     --game-type <kind> --config <path to a game's src/game/config.ts>
//
// The drift gate is ALSO asserted offline by `tools/game-config-spike` (it re-derives the doc from
// the real `apps/lines` config and compares), so drift fails a fixture run even if nobody thinks to
// run `--check`. That redundancy is deliberate: a generator nobody runs is a generator that lies.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	bookOfThermopylaePreset,
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_TEMPLATE_JACKPOTS,
	HOLD_AND_WIN_TEMPLATES,
	holdAndWinPresetKey,
	holdAndWinTemplateKey,
	gameConfigErrors,
	normalizeGameConfigDoc,
	symbolsInPlay,
	winLevelMapToTiers,
	type CodedWinLevelEntry,
	type GameConfigDoc,
	type WinModel,
} from 'game-config';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../src/lib/data/gameConfig');

/** The game types that ship a committed default, and the config module each derives from.
 *  Keyed to `engine-layout`'s built-in templates; a game type absent here falls back to `lines`,
 *  exactly as `symbolDefaultsFor` does. */
const BUILT_IN: Record<string, string> = {
	lines: resolve(HERE, '../../lines/src/game/config.ts'),
	ways: resolve(HERE, '../../ways/src/game/config.ts'),
	scatter: resolve(HERE, '../../scatter/src/game/config.ts'),
};

/**
 * PRESETS — a kind whose defaults are several configs rather than one app's (`holdAndWin`: one
 * template, three reference games). Their source is a raw config in `packages/game-config`, not a
 * game app, because no app exists per preset and faking one would compile a game nobody runs.
 * Written as `<kind>.<preset>.json`; `gameConfigDefaults.ts` maps the kind to its default preset.
 */
const PRESETS: Record<string, () => unknown> = {
	...Object.fromEntries(
		HOLD_AND_WIN_PRESET_IDS.map((id) => [holdAndWinPresetKey(id), () => HOLD_AND_WIN_PRESETS[id]]),
	),
	// The plain Hold and Win Game Maker's template creates, jackpots on and off (bonus-games §0).
	...Object.fromEntries(
		HOLD_AND_WIN_TEMPLATE_JACKPOTS.map((j) => [
			holdAndWinTemplateKey(j),
			() => HOLD_AND_WIN_TEMPLATES[j],
		]),
	),
	// A LINES preset: the captured Book of Thermopylae, the Book-of mechanic as config
	// (docs/design/book-feature.md §3.5) — offered by `/config` and Game Maker's Create.
	'lines.bookOfThermopylae': bookOfThermopylaePreset,
};

// `cluster` is still NOT registered: its upstream sample config ships
// `paddingReels: { basegame: '', … }` — empty-string placeholders where the others carry strips.
// The strips are the in-play GATE (docs/design/invisible-game-config.md), so a config without them
// has no symbols in play and would seed every new project of that type with a blank board;
// `normalizeGameConfigDoc` correctly refuses it.
//
// `ways` had the same gap and now carries COSMETIC strips (see the comment on its `paddingReels`) —
// evenly weighted filler, explicitly not a math export. That is legitimate for the client, which
// never computes wins, but note the consequence: a `ways` default seeds a plausible-looking board
// whose symbol frequencies mean nothing. A real math export should replace them.
//
// To close `cluster`: author its `paddingReels` the same way, then add the entry here and to
// WIN_MODEL_BY_TYPE below.

/**
 * The `winModel` each game type's default carries (Phase C of
 * `docs/design/game-type-templates.md`). `lines` is absent on purpose — it is the DEFAULT, so
 * storing it would add a field to every doc and break the round-trip parity the schema is built on
 * (see `normalizeWinModel`).
 *
 * The MINIMUM is derived from the game's own paytable rather than written here, because the two are
 * the same fact: a cluster game whose smallest paying row is 5 has `minCluster: 5` by definition.
 * Hard-coding it would let the win model drift from the payouts it describes. Measured on the
 * shipped configs: ways 3, cluster 5, scatter 8.
 */
const WIN_MODEL_BY_TYPE: Record<string, (min: number) => WinModel> = {
	ways: (min) => ({ type: 'ways', direction: 'ltr', minKind: min }),
	cluster: (min) => ({ type: 'cluster', minCluster: min, adjacency: 'orthogonal' }),
	scatter: (min) => ({ type: 'scatter', minCount: min }),
};

/**
 * The smallest occurrence count that pays anywhere in the dictionary — the win model's minimum.
 *
 * Only symbols that actually carry a paytable are considered; scatters and wilds in these configs
 * have `paytable: null`, so they drop out naturally rather than dragging the minimum down.
 */
const minPayingOccurrence = (doc: GameConfigDoc): number | undefined => {
	const occurrences = Object.values(doc.symbols)
		.flatMap((symbol) => symbol.paytable ?? [])
		.flatMap((row) => Object.keys(row))
		.map((key) => Number(key))
		.filter((n) => Number.isFinite(n) && n > 0);
	return occurrences.length ? Math.min(...occurrences) : undefined;
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

/** `configDir` is where a module source's sibling `winLevelMap.ts` would sit; a preset has none
 *  and authors its own `winLevels`. */
type Target = {
	gameType: string;
	source: string;
	configDir?: string;
	load: () => Promise<unknown>;
};

const fromModule = (gameType: string, configPath: string | undefined): Target | string =>
	configPath
		? {
				gameType,
				source: configPath,
				configDir: dirname(configPath),
				load: async () =>
					((await import(pathToFileURL(configPath).href)) as { default: unknown }).default,
			}
		: gameType;

const fromPreset = (gameType: string): Target => ({
	gameType,
	source: `game-config preset ${gameType}`,
	load: async () => structuredClone(PRESETS[gameType]()),
});

/** A string is a game type with no registered source (reported below). */
const targets: Array<Target | string> = oneType
	? [
			oneConfig
				? fromModule(oneType, isAbsolute(oneConfig) ? oneConfig : resolve(oneConfig))
				: PRESETS[oneType]
					? fromPreset(oneType)
					: fromModule(oneType, BUILT_IN[oneType]),
		]
	: [
			...Object.entries(BUILT_IN).map(([gameType, path]) => fromModule(gameType, path)),
			...Object.keys(PRESETS).map(fromPreset),
		];

let failures = 0;

for (const target of targets) {
	if (typeof target === 'string') {
		console.error(`✗ ${target}: no config module registered — pass --config <path>.`);
		failures++;
		continue;
	}
	const { gameType, source, configDir } = target;

	const doc = normalizeGameConfigDoc(await target.load());
	if (!doc) {
		console.error(`✗ ${gameType}: ${source} does not describe a game (no symbols or no strips).`);
		failures++;
		continue;
	}

	// The template's DEFAULT win tiers come from its own coded `winLevelMap.ts` (next to config.ts),
	// converted to an authored `winLevels` list — so each template seeds its own tiers, not a shared
	// constant. Absent/unreadable ⇒ no `winLevels` (the project keeps the coded ladder). Re-normalized
	// so what we write is canonical and matches what the tool + spike re-derive.
	// Two candidates, in priority order: the game's OWN sibling table, then the engine's shared one.
	// The fallback exists because `lines`' winLevelMap moved into `engine-game` during Phase A of
	// game-type-templates, and the sibling-only lookup silently dropped all ten tiers from the
	// committed default — the catch below cannot tell "this game has no tiers" (legitimate) from
	// "the file moved" (a regression), which is exactly how that went unnoticed.
	// A source that authors its own tiers (every preset) keeps them.
	const winLevelMapCandidates = doc.winLevels
		? []
		: [
				...(configDir ? [resolve(configDir, 'winLevelMap.ts')] : []),
				resolve(HERE, '../../../packages/engine-game/src/game/winLevelMap.ts'),
			];
	let tiersFrom: string | undefined = doc.winLevels ? source : undefined;
	for (const candidate of winLevelMapCandidates) {
		try {
			const wl = (await import(pathToFileURL(candidate).href)) as {
				winLevelMap?: Record<string | number, CodedWinLevelEntry>;
			};
			if (!wl.winLevelMap) continue;
			const withTiers = normalizeGameConfigDoc({
				...doc,
				winLevels: winLevelMapToTiers(wl.winLevelMap),
			});
			if (withTiers) {
				Object.assign(doc, withTiers);
				tiersFrom = candidate;
			}
			break;
		} catch {
			// Try the next candidate.
		}
	}
	// Loud, because a silently tier-less default is a real degradation that still validates clean.
	if (!tiersFrom) {
		console.warn(
			`  ! ${gameType}: no winLevelMap found (looked beside the config and in engine-game) — ` +
				'the default ships WITHOUT win tiers and the project will keep the coded ladder.',
		);
	}

	// Attach the type's win model, with its minimum taken from the paytable above. Re-normalized so
	// what we write is canonical — and so an arm that fails validation is dropped here rather than
	// shipped. `lines` has no entry: it is the default and is deliberately never stored.
	const buildWinModel = WIN_MODEL_BY_TYPE[gameType];
	if (buildWinModel) {
		const min = minPayingOccurrence(doc);
		if (min === undefined) {
			console.error(`✗ ${gameType}: no symbol carries a paytable, so no win-model minimum.`);
			failures++;
			continue;
		}
		const withModel = normalizeGameConfigDoc({ ...doc, winModel: buildWinModel(min) });
		if (withModel) Object.assign(doc, withModel);
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
			`win model ${doc.winModel ? JSON.stringify(doc.winModel) : 'lines (default, unstored)'}, ` +
			`${Object.keys(doc.paylines).length} paylines, ` +
			`${inPlay.length}/${Object.keys(doc.symbols).length} symbols in play`,
	);
}

process.exit(failures ? 1 : 0);
