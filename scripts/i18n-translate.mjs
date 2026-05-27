#!/usr/bin/env node
/**
 * Auto-translate Lingui messagesMap catalogs into all supported locales via an LLM.
 *
 * The English catalog (`<dir>/i18n/messagesMap/en.ts`) is the source of truth.
 * For every other supported locale this script fills in the MISSING keys only
 * (idempotent — existing translations are never overwritten), writes the
 * per-locale `<locale>.ts` file, and regenerates `index.ts` so the new locales
 * are merged in.
 *
 * Usage (from the repo root, or any game repo):
 *   ANTHROPIC_API_KEY=sk-... node scripts/i18n-translate.mjs --provider anthropic
 *   OPENAI_API_KEY=sk-...    node scripts/i18n-translate.mjs --provider openai
 *
 * Options:
 *   --provider <anthropic|openai>  LLM provider (default: anthropic)
 *   --model <id>                   override model id
 *   --root <path>                  where to scan (default: cwd)
 *   --locales <a,b,c>              limit to these target locales
 *   --dry                          print plan, do not call the LLM or write files
 *
 * Notes:
 *   - Skips node_modules / .svelte-kit / .git / dist / build / the `engine`
 *     submodule, so running it inside a game repo translates only that game.
 *   - The LLM is asked to return strict JSON mapping each English string to its
 *     translation; the call is batched per (catalog, locale).
 */

import fs from 'node:fs';
import path from 'node:path';

// ---- supported locales (must match packages/config-lingui) ----
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'vi', 'zh', 'fi', 'hi'];
const LOCALE_NAMES = {
	ar: 'Arabic',
	de: 'German',
	es: 'Spanish',
	fr: 'French',
	id: 'Indonesian',
	ja: 'Japanese',
	ko: 'Korean',
	pl: 'Polish',
	pt: 'Portuguese',
	ru: 'Russian',
	tr: 'Turkish',
	vi: 'Vietnamese',
	zh: 'Simplified Chinese',
	fi: 'Finnish',
	hi: 'Hindi',
};
const IGNORE_DIRS = new Set(['node_modules', '.svelte-kit', '.git', 'dist', 'build', 'engine', '.turbo', '.claude']);

// ---- args ----
const args = process.argv.slice(2);
const getArg = (name, def) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const provider = getArg('provider', 'anthropic');
const root = path.resolve(getArg('root', process.cwd()));
const dry = args.includes('--dry');
const localeFilter = getArg('locales', '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const targetLocales = LOCALES.filter((l) => l !== 'en' && (localeFilter.length === 0 || localeFilter.includes(l)));

// ---- catalog (de)serialization ----
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');
const escapeStr = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const keyLiteral = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${escapeStr(k)}'`);

/** Parse a `export default { KEY: 'value', 'K E Y': "value", ... }` catalog. */
const parseCatalog = (file) => {
	const src = fs.readFileSync(file, 'utf8');
	const out = {};
	const re =
		/(?:([A-Za-z_$][\w$]*)|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
	let m;
	while ((m = re.exec(src))) {
		const key = m[1] ?? unescape(m[2] ?? m[3] ?? '');
		const val = unescape(m[4] ?? m[5] ?? '');
		if (key) out[key] = val;
	}
	return out;
};

const writeCatalog = (file, map) => {
	const body = Object.entries(map)
		.map(([k, v]) => `\t${keyLiteral(k)}: '${escapeStr(v)}',`)
		.join('\n');
	fs.writeFileSync(file, `export default {\n${body}\n};\n`, 'utf8');
};

/** Regenerate index.ts to import all present locale files, preserving a
 *  mergeMessagesMaps(...) wrapper + external map imports if the original had them. */
const writeIndex = (dir, locales) => {
	const indexPath = path.join(dir, 'index.ts');
	const prev = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
	const externals = [...prev.matchAll(/import\s*\{\s*messagesMap as (\w+)\s*\}\s*from\s*'([^']+)';/g)].map((m) => ({
		name: m[1],
		src: m[2],
	}));
	const useMerge = /mergeMessagesMaps/.test(prev) && externals.length > 0;

	const localeImports = locales.map((l) => `import ${l} from './${l}';`).join('\n');
	const externalImports = externals.map((e) => `import { messagesMap as ${e.name} } from '${e.src}';`).join('\n');
	const mapObject = `{\n${locales.map((l) => `\t${l},`).join('\n')}\n}`;

	let content;
	if (useMerge) {
		content =
			`import { mergeMessagesMaps } from 'utils-shared/i18n';\n` +
			`${externalImports}\n\n` +
			`${localeImports}\n\n` +
			`const messagesMapGame = ${mapObject};\n\n` +
			`const messagesMap = mergeMessagesMaps([messagesMapGame, ${externals.map((e) => e.name).join(', ')}]);\n\n` +
			`export default messagesMap;\n`;
	} else {
		content = `${localeImports}\n\nconst messagesMap = ${mapObject};\n\nexport default messagesMap;\n`;
	}
	fs.writeFileSync(indexPath, content, 'utf8');
};

/** Harvest static heading/body string literals from a game's infoManifest, so
 *  per-game info-page rules become translatable without hand-editing en.ts.
 *  Template literals with ${interpolation} can't be keyed and are skipped. */
const harvestManifest = (catalogDir) => {
	const srcRoot = path.resolve(catalogDir, '..', '..'); // src/i18n/messagesMap -> src
	const manifest = path.join(srcRoot, 'game', 'infoManifest.ts');
	if (!fs.existsSync(manifest)) return [];
	const text = fs.readFileSync(manifest, 'utf8');
	const out = [];
	const re = /(?:heading|body)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`)/g;
	let m;
	while ((m = re.exec(text))) {
		const s = m[1] !== undefined ? unescape(m[1]) : m[2] !== undefined ? unescape(m[2]) : m[3];
		if (s) out.push(s);
	}
	const interpolated = text.match(/(?:heading|body)\s*:\s*`[^`]*\$\{[^`]*`/g);
	if (interpolated) {
		console.warn(
			`  ! ${interpolated.length} interpolated rule string(s) in infoManifest skipped — avoid \${} in translatable text`,
		);
	}
	return out;
};

// ---- discovery ----
const findCatalogDirs = (dir, found = []) => {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const e of entries) {
		if (!e.isDirectory() || IGNORE_DIRS.has(e.name)) continue;
		const full = path.join(dir, e.name);
		if (e.name === 'messagesMap' && fs.existsSync(path.join(full, 'en.ts'))) {
			found.push(full);
		} else {
			findCatalogDirs(full, found);
		}
	}
	return found;
};

// ---- LLM providers ----
const SYSTEM = (langName) =>
	`You are a professional game-localization translator. Translate the given English strings used in a casino slot game UI into ${langName}. ` +
	`Keep translations concise and idiomatic for a game UI. Preserve symbols, numbers, units (e.g. ×, %), and any {placeholders} exactly. ` +
	`Do NOT translate proper nouns/brand names. Return ONLY a JSON object mapping each original English string to its translation, no prose, no code fences.`;

const callAnthropic = async (langName, strings) => {
	const key = process.env.ANTHROPIC_API_KEY;
	if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
	const model = getArg('model', 'claude-3-5-sonnet-latest');
	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
		body: JSON.stringify({
			model,
			max_tokens: 4096,
			system: SYSTEM(langName),
			messages: [{ role: 'user', content: JSON.stringify(strings) }],
		}),
	});
	if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
	const data = await res.json();
	return data.content?.[0]?.text ?? '';
};

const callOpenAI = async (langName, strings) => {
	const key = process.env.OPENAI_API_KEY;
	if (!key) throw new Error('OPENAI_API_KEY is not set');
	const model = getArg('model', 'gpt-4o-mini');
	const res = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
		body: JSON.stringify({
			model,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: SYSTEM(langName) },
				{ role: 'user', content: JSON.stringify(strings) },
			],
		}),
	});
	if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
	const data = await res.json();
	return data.choices?.[0]?.message?.content ?? '';
};

const parseJsonLoose = (text) => {
	const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	return JSON.parse(cleaned.slice(start, end + 1));
};

const translateBatch = async (langName, strings) => {
	// `echo` is a no-network provider for testing the write/index pipeline:
	// it returns each string unchanged, tagged with the language for visibility.
	if (provider === 'echo') return Object.fromEntries(strings.map((s) => [s, `[${langName}] ${s}`]));
	const raw = provider === 'openai' ? await callOpenAI(langName, strings) : await callAnthropic(langName, strings);
	return parseJsonLoose(raw);
};

// ---- main ----
const main = async () => {
	console.log(`[i18n] provider=${provider} root=${root} locales=${targetLocales.join(',')}${dry ? ' (dry-run)' : ''}`);
	const dirs = findCatalogDirs(root);
	if (dirs.length === 0) {
		console.log('[i18n] no messagesMap/en.ts catalogs found');
		return;
	}

	for (const dir of dirs) {
		const enPath = path.join(dir, 'en.ts');
		const en = parseCatalog(enPath);
		console.log(`\n[i18n] ${path.relative(root, dir)}`);

		// Auto-register per-game info-page rule strings into the en catalog.
		const harvested = harvestManifest(dir);
		const newKeys = harvested.filter((s) => !(s in en));
		if (newKeys.length) {
			for (const s of newKeys) en[s] = s;
			if (!dry) writeCatalog(enPath, en);
			console.log(`  harvested ${newKeys.length} manifest string(s) into en.ts${dry ? ' (skipped)' : ''}`);
		}

		const sourceKeys = Object.keys(en);
		console.log(`  ${sourceKeys.length} source keys`);

		for (const locale of targetLocales) {
			const file = path.join(dir, `${locale}.ts`);
			const existing = fs.existsSync(file) ? parseCatalog(file) : {};
			const missing = sourceKeys.filter((k) => !(k in existing));

			if (missing.length === 0) {
				console.log(`  ${locale}: up to date`);
				continue;
			}
			console.log(`  ${locale}: ${missing.length} missing${dry ? ' (skipped)' : ''}`);
			if (dry) continue;

			const sourceStrings = missing.map((k) => en[k]);
			const translations = await translateBatch(LOCALE_NAMES[locale], sourceStrings);
			const merged = { ...existing };
			for (const k of missing) {
				const t = translations[en[k]];
				if (typeof t === 'string' && t.length) merged[k] = t;
				else console.warn(`    ! missing translation for "${en[k]}"`);
			}
			writeCatalog(file, merged);
		}

		if (!dry) {
			// Index must list every locale file present on disk (not just the ones
			// processed this run), in the canonical supported-locale order.
			const present = LOCALES.filter((l) => l === 'en' || fs.existsSync(path.join(dir, `${l}.ts`)));
			writeIndex(dir, present);
			console.log(`  index.ts regenerated for: ${present.join(', ')}`);
		}
	}
	console.log('\n[i18n] done');
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
