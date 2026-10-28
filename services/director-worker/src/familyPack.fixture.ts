/**
 * The runtime family packs (ADR-0009 §4, card 9F):
 *
 *   pnpm --filter director-worker check:family-packs
 *
 * Pinned: the shipped packs all parse and every ready family has one; every refusal of the loader
 * (each from a file under `fixtures/families/<case>/`) names the file and the reason, and one
 * load reports every problem at once; the worker's family list is the engine's `GAME_FAMILIES` and
 * `familyOfKind` maps every kind the way the migration's backfill does; the slot pack's Kinds
 * section covers every slot kind; nothing slot-specific that left the definitions was lost from
 * `slot.md`; the definitions are family-neutral and end with the Family pack section; the slot
 * screen tags are the ones the New game screen offered before 9F; the Dockerfile ships everything
 * the worker loads at boot.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	GAME_FAMILIES,
	SLOT_GAME_KINDS,
	familyOfKind,
} from '../../../packages/constants-shared/gameKinds.ts';
import { loadAgents, pricedModels, type AgentCatalog } from './agents.ts';
import { loadFamilyPacks } from './families.ts';
import {
	FAMILY_PACK_FAMILIES,
	KINDS_SECTION,
	MOCKUP_SCREEN_TAGS,
	PACK_SECTIONS,
	READY_FAMILY_PACKS,
	parseFamilyPack,
} from './familyPack.ts';
import { KNOWN_TOOLS } from './tools.ts';

const here = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string, extra = '') => {
	checks++;
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${ok ? '' : ` — ${extra}`}`);
	if (!ok) failures++;
};
const throws = (fn: () => unknown): string => {
	try {
		fn();
		return '';
	} catch (error) {
		return (error as Error).message;
	}
};
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const json = (value: unknown) => JSON.stringify(value);

const FAMILIES = here('families');
const CASES = here('fixtures/families');

console.log('shipped packs');
{
	const packs = loadFamilyPacks(FAMILIES);
	check(
		json([...packs.keys()].sort()) === json([...FAMILY_PACK_FAMILIES].sort()),
		'a pack loads for every family',
		json([...packs.keys()]),
	);
	const files = readdirSync(FAMILIES).filter((f) => f.endsWith('.md'));
	check(
		json([...files].sort()) === json(FAMILY_PACK_FAMILIES.map((f) => `${f}.md`).sort()),
		'families/ holds exactly one file per family',
		json(files),
	);
	for (const file of files) {
		const result = parseFamilyPack(file, readFileSync(`${FAMILIES}/${file}`, 'utf8'));
		check(result.ok, `${file} parses`, result.ok ? '' : json(result.errors));
	}
	for (const family of READY_FAMILY_PACKS) {
		const pack = packs.get(family);
		check(
			pack !== undefined && pack.text.length > 0,
			`the ready family ${family} has a pack that parses`,
		);
		check(
			pack !== undefined &&
				json([...pack.sections.keys()]) ===
					json([...(family === 'slot' ? [KINDS_SECTION] : []), ...PACK_SECTIONS]),
			`…its sections are the contract's, in order`,
			json([...(pack?.sections.keys() ?? [])]),
		);
	}
	check(
		json([...READY_FAMILY_PACKS]) === json(['slot']),
		'only the slot family is ready',
		json([...READY_FAMILY_PACKS]),
	);
}

console.log('the loader');
{
	const load = (name: string) => throws(() => loadFamilyPacks(`${CASES}/${name}`));
	const valid = loadFamilyPacks(`${CASES}/valid`);
	check(
		json([...valid.keys()].sort()) === json(['arcade', 'match3', 'slot']) &&
			valid.get('slot')!.sections.get(KINDS_SECTION) === '### lines\n- A fixture kind.' &&
			valid.get('arcade')!.text.startsWith('# Fixture pack'),
		"a valid set loads, a pack's text is its body after the frontmatter, trimmed",
	);
	check(
		!valid.get('slot')!.text.startsWith('-') && !valid.get('slot')!.text.includes('family: slot'),
		'…the frontmatter is not part of the text',
	);

	// Each case holds one bad file; the other families are missing, which is reported too.
	const refused = (what: string, name: string, file: string, reason: string) => {
		const message = load(name);
		check(
			message.startsWith('Invalid family packs:') && message.includes(`${file}: ${reason}`),
			`${what} is refused with "${reason}"`,
			message,
		);
	};
	refused(
		'an unknown family as a file name',
		'unknown-family',
		'chess.md',
		'chess.md: no game family is called chess',
	);
	refused(
		'an unknown family in the frontmatter',
		'unknown-family',
		'chess.md',
		'family: chess is not a game family',
	);
	refused(
		'an unknown family in the frontmatter of a known file',
		'unknown-frontmatter-family',
		'slot.md',
		'family: chess is not a game family',
	);
	refused(
		'a family that is not the file name',
		'family-file-mismatch',
		'arcade.md',
		'family: match3 does not match arcade.md',
	);
	refused('an unknown frontmatter key', 'unknown-key', 'match3.md', 'kind: unknown key');
	refused('a missing section', 'missing-section', 'match3.md', '## Never: missing');
	refused('an empty section', 'empty-section', 'match3.md', '## Region batch order: empty');
	refused(
		'an unknown section',
		'unknown-section',
		'match3.md',
		'## Trivia: not a section a match3 pack has',
	);
	refused('a duplicate section', 'duplicate-section', 'match3.md', '## Never: appears twice');
	refused(
		'sections out of order',
		'out-of-order',
		'match3.md',
		'sections out of order: expected Locked items, Mockup screen tags, Region batch order, QA books and screens, Never',
	);
	refused(
		'a Kinds section on a non-slot pack',
		'kinds-on-non-slot',
		'arcade.md',
		'## Kinds: not a section a arcade pack has',
	);
	refused('a slot pack without Kinds', 'slot-without-kinds', 'slot.md', '## Kinds: missing');
	refused(
		'an empty body',
		'empty-body',
		'arcade.md',
		'the pack (the body after the frontmatter) is empty',
	);
	refused(
		'a body with no title',
		'missing-title',
		'arcade.md',
		'the pack starts with a "# " title',
	);
	refused(
		'screen tags that are not MOCKUP_SCREEN_TAGS',
		'tags-mismatch',
		'arcade.md',
		'## Mockup screen tags: lists Play field, Pause menu; MOCKUP_SCREEN_TAGS.arcade is Play field, HUD, Round over, Intro',
	);
	check(
		load('unknown-key').includes('slot.md: missing') &&
			load('unknown-key').includes('arcade.md: missing'),
		'a family with no file is reported, by its file name',
		load('unknown-key'),
	);

	const all = load('all-problems');
	const expectedProblems = [
		'match3.md: ## Locked items: empty',
		'match3.md: ## Never: missing',
		'arcade.md: kind: unknown key',
		'chess.md: chess.md: no game family is called chess',
		'chess.md: family: chess is not a game family',
		'chess.md: ## Kinds: not a section a chess pack has',
	];
	check(
		expectedProblems.every((p) => all.includes(p)) && !all.includes('slot.md:'),
		'one load reports every problem in every file at once, and not a valid file',
		all,
	);
	const lines = all.split('\n');
	check(
		lines.length === 1 + expectedProblems.length,
		'…and nothing else',
		`${lines.length - 1} lines: ${all}`,
	);
	check(
		load('missing-family-file').split('\n').slice(1).join('|').trim() === 'arcade.md: missing',
		'a family with no pack file is "<family>.md: missing"',
		load('missing-family-file'),
	);
}

console.log('the family list');
{
	check(
		json(FAMILY_PACK_FAMILIES) === json(GAME_FAMILIES),
		'FAMILY_PACK_FAMILIES equals GAME_FAMILIES (the engine’s list, in its order)',
		json([FAMILY_PACK_FAMILIES, GAME_FAMILIES]),
	);
	check(
		json(Object.keys(MOCKUP_SCREEN_TAGS)) === json(GAME_FAMILIES),
		'MOCKUP_SCREEN_TAGS has a tag list for every family and no other',
	);
	const map = (kind: string | null | undefined) => familyOfKind(kind);
	check(
		map('match3') === 'match3' && map('arcade') === 'arcade',
		'match3 and arcade map to themselves',
	);
	for (const kind of SLOT_GAME_KINDS) check(map(kind) === 'slot', `${kind} is a slot`);
	check(
		map(null) === 'slot' && map(undefined) === 'slot' && map('') === 'slot',
		'null, undefined and empty are a slot (the SQL backfill’s coalesce)',
	);
	check(
		map('my-custom-kind') === 'slot' && map('constructor') === 'slot' && map('toString') === 'slot',
		'an unknown custom kind is a slot, and an Object.prototype name is not a family',
	);
}

console.log('the slot pack');
{
	const slot = loadFamilyPacks(FAMILIES).get('slot')!;
	const kinds = slot.sections.get(KINDS_SECTION)!;
	const headings = [...kinds.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
	const wanted: [string, string][] = [
		['lines', 'lines (and the Book of Thermopylae preset)'],
		['ways', 'ways'],
		['cluster', 'cluster'],
		['scatter', 'scatter'],
		['holdAndWin', 'holdAndWin (and the coin board)'],
		['the add-ons', 'Add-ons: the pots overlay and bonus modes'],
	];
	for (const [what, heading] of wanted) {
		check(
			headings.includes(heading),
			`Kinds has a "### ${heading}" heading for ${what}`,
			json(headings),
		);
	}
	check(
		/Book of Thermopylae/.test(kinds) &&
			/coin board/.test(kinds) &&
			/pots overlay/.test(kinds) &&
			/bonus modes/.test(kinds),
		'…and the Thermopylae preset, the coin board, the pots overlay and the bonus modes are named',
	);
	check(
		json(MOCKUP_SCREEN_TAGS.slot) ===
			json([
				'Base game',
				'Hold and Win bonus',
				'Bonus',
				'Free spins',
				'Big win',
				'Paytable',
				'Intro',
			]),
		'MOCKUP_SCREEN_TAGS.slot is the pre-9F SCREEN_TAGS of the New game screen, in order',
		json(MOCKUP_SCREEN_TAGS.slot),
	);
	for (const family of FAMILY_PACK_FAMILIES) {
		const pack = loadFamilyPacks(FAMILIES).get(family)!;
		const listed = [...pack.sections.get('Mockup screen tags')!.matchAll(/^- \*\*(.+?)\*\*/gm)].map(
			(m) => m[1],
		);
		check(
			json(listed) === json(MOCKUP_SCREEN_TAGS[family]),
			`${family}: the pack lists MOCKUP_SCREEN_TAGS`,
		);
	}
}

console.log('no loss: what the definitions gave the slot pack');
{
	// Every slot-specific instruction the 9F edit removed from a definition body, found by diffing
	// the pre-9F bodies against the family-neutral ones. Each must read the same in slot.md. The
	// analyst's screen tags (Base game, Hold and Win bonus, Big win, Paytable…) are pinned above.
	const moved = [
		'Edit a math contract: Game Config, paytable, bet modes, feature rules, reel strips.',
		'base spin, Hold and Win trigger, big win',
		"Play the draft with the template's fixed books",
		'Symbols, Coins & jackpots, Backgrounds, Reel frame & logo, UI kit, Win banners',
		"in the template's group order",
		'symbols at reel size, coins at the size the brief states',
		'(paylines, bet levels, feature triggers)',
		'anything the math reads',
		'even if it appears in a layout',
		'a Buy bonus button when the math has no buy feature',
		'Static, Spin, Land, Win, Post-win, Explosion',
		"The template's math contract, paytable, bet modes and feature rules are locked.",
	];
	const slot = collapse(readFileSync(`${FAMILIES}/slot.md`, 'utf8'));
	const lower = slot.toLowerCase();
	for (const phrase of moved) {
		const text = collapse(phrase);
		check(
			slot.includes(text) || lower.includes(text.toLowerCase()),
			`slot.md still says "${text}"`,
		);
	}
	const never = collapse(slot.split('## Never')[1] ?? '');
	check(
		never.includes(
			'Edit a math contract: Game Config, paytable, bet modes, feature rules, reel strips.',
		),
		'…the math-contract line is in slot.md’s Never section',
	);
}

console.log('the definitions are family-neutral');
{
	const catalog: AgentCatalog = { models: pricedModels(here('pricing.json')), tools: KNOWN_TOOLS };
	const agents = loadAgents(here('agents'), catalog);
	const SLOT_WORDS =
		/\b(reels?|paylines?|spins?|free spins|hold and win|paytable|jackpots?|coins?|big win|bet levels?)\b/i;
	// A word a definition may keep, with why; empty while none needs it.
	const ALLOWED: Record<string, RegExp[]> = {};
	check(agents.size >= 7, 'the definitions load', String(agents.size));
	for (const [name, agent] of agents) {
		const hits = [...agent.systemPrompt.matchAll(new RegExp(SLOT_WORDS, 'gi'))]
			.map((m) => m[0])
			.filter((w) => !(ALLOWED[name] ?? []).some((re) => re.test(w)));
		check(hits.length === 0, `${name}: no slot vocabulary in the body`, json([...new Set(hits)]));
		const body = agent.systemPrompt;
		const tail = body.slice(body.lastIndexOf('## '));
		check(
			tail.startsWith('## Family pack\n') && collapse(tail).endsWith('it wins.'),
			`${name}: the body ends with the Family pack section`,
			collapse(tail).slice(0, 60),
		);
		const never = body.slice(body.indexOf('## Never'));
		check(
			never.includes(
				'- Edit a math contract: Game Config and every item your family pack locks.',
			) && !/paytable|bet modes|reel strips/.test(never),
			`${name}: its Never list locks "Game Config and every item your family pack locks"`,
		);
	}
}

console.log('the Dockerfile');
{
	const dockerfile = readFileSync(here('Dockerfile'), 'utf8');
	const loaded = new Set<string>();
	const main = readFileSync(here('src/main.ts'), 'utf8');
	for (const m of main.matchAll(/\broot\(\s*['"]([^'"]+)['"]\s*\)/g)) loaded.add(m[1]);
	for (const file of readdirSync(here('src'), { recursive: true }) as string[]) {
		if (!file.endsWith('.ts') || /\.fixture\.ts$/.test(file)) continue;
		const source = readFileSync(here(`src/${file}`), 'utf8');
		for (const m of source.matchAll(
			/new URL\(\s*['"]\.\.\/([^'"/]+)['"]\s*,\s*import\.meta\.url/g,
		)) {
			loaded.add(m[1]);
		}
	}
	check(
		['agents', 'families', 'pricing.json', 'estimate-profiles.json'].every((x) => loaded.has(x)),
		'main.ts and the modules load agents, families, pricing.json and estimate-profiles.json at boot',
		json([...loaded]),
	);
	for (const entry of loaded) {
		check(
			new RegExp(`^COPY services/director-worker/${entry.replace('.', '\\.')}(\\s|$)`, 'm').test(
				dockerfile,
			),
			`the Dockerfile COPYs ${entry}`,
		);
	}
	check(/^COPY services\/director-worker\/src /m.test(dockerfile), 'the Dockerfile COPYs src');
}

console.log(`family packs: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
