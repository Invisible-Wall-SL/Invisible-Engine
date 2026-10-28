/**
 * One runtime family pack, parsed and validated (ADR-0009 §4): `families/<family>.md` holds what a
 * game family adds to every runtime agent — its locked items, mockup screen tags, region batch
 * order, QA books and screens, and its "never" list. The worker appends the run's pack to every
 * agent's system prompt as a second cached block, after the family-neutral definition body.
 *
 * This is the PURE half of the loader, like `agentDefinition.ts`: no file system, only erasable
 * TypeScript, so the launcher imports the same lists (`READY_FAMILY_PACKS`, `MOCKUP_SCREEN_TAGS`)
 * for its create refusal and the New game screen. `families.ts` adds the directory walk.
 */

/**
 * The game families, as `GAME_FAMILIES` in `packages/constants-shared/gameKinds.ts` lists them. The
 * worker image does not carry that package; `check:family-packs` pins the two lists equal.
 */
export const FAMILY_PACK_FAMILIES = ['slot', 'match3', 'arcade'] as const;

export type PackFamily = (typeof FAMILY_PACK_FAMILIES)[number];

/**
 * The families a run may be created for. A pack outside this set is a draft: it loads and is
 * validated, but a run of its family is refused at create (`no_family_pack`) and paused by the
 * worker before any call. Readiness is a code decision because the launcher cannot read the pack
 * files: match-3 and arcade wait on their adapters (the board, Invisible Characters).
 */
export const READY_FAMILY_PACKS: ReadonlySet<PackFamily> = new Set<PackFamily>(['slot']);

/** How a family is named to the owner, as `FAMILY_LABELS` in the launcher's `roles.ts`. */
export const PACK_FAMILY_LABELS: Record<PackFamily, string> = {
	slot: 'slot',
	match3: 'match-3',
	arcade: 'arcade',
};

/**
 * The screen tags the New game screen offers per family, in order. The pack's "Mockup screen tags"
 * section lists the same tags, each as a `- **<tag>**` line; `check:family-packs` keeps them equal.
 */
export const MOCKUP_SCREEN_TAGS: Record<PackFamily, readonly string[]> = {
	slot: ['Base game', 'Hold and Win bonus', 'Bonus', 'Free spins', 'Big win', 'Paytable', 'Intro'],
	match3: ['Board', 'Goal', 'Round won', 'Round over', 'Intro'],
	arcade: ['Play field', 'HUD', 'Round over', 'Intro'],
};

/** The sections every pack has, in this order. */
export const PACK_SECTIONS = [
	'Locked items',
	'Mockup screen tags',
	'Region batch order',
	'QA books and screens',
	'Never',
] as const;

/** The slot pack opens with one `### <kind>` per slot kind under this section; no other pack has it. */
export const KINDS_SECTION = 'Kinds';

export interface FamilyPack {
	family: PackFamily;
	/** The body after the frontmatter, trimmed: the second system block, byte for byte. */
	text: string;
	/** Each `## ` section's text, trimmed, by heading. */
	sections: Map<string, string>;
}

export type PackParseResult = { ok: true; pack: FamilyPack } | { ok: false; errors: string[] };

const isFamily = (value: string): value is PackFamily =>
	(FAMILY_PACK_FAMILIES as readonly string[]).includes(value);

/** A pack's family is its file's name. */
const baseName = (file: string): string => (file.split(/[\\/]/).pop() ?? file).replace(/\.md$/, '');

/**
 * Parse and validate one pack. The frontmatter holds one key, `family`, which must match the file
 * name. The body is a `# ` title and an optional introduction, then exactly the sections in
 * {@link PACK_SECTIONS} (the slot pack first adds {@link KINDS_SECTION}), each non-empty; anything
 * else is an error naming it.
 */
export function parseFamilyPack(file: string, text: string): PackParseResult {
	const errors: string[] = [];
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	if (lines[0] !== '---') return { ok: false, errors: ['line 1: expected "---"'] };
	const end = lines.indexOf('---', 1);
	if (end < 0) return { ok: false, errors: ['frontmatter has no closing "---"'] };

	let family = '';
	for (let i = 1; i < end; i++) {
		if (lines[i].trim() === '') continue;
		const pair = /^([a-z][a-z_]*):\s+(\S.*)$/.exec(lines[i]);
		if (!pair) errors.push(`line ${i + 1}: expected "key: value"`);
		else if (pair[1] !== 'family') errors.push(`${pair[1]}: unknown key`);
		else if (family) errors.push(`line ${i + 1}: family is set twice`);
		else family = pair[2].trim();
	}
	const named = baseName(file);
	if (!family) errors.push('family: required');
	else if (!isFamily(family)) errors.push(`family: ${family} is not a game family`);
	else if (family !== named) errors.push(`family: ${family} does not match ${named}.md`);
	if (!isFamily(named)) errors.push(`${named}.md: no game family is called ${named}`);

	const body = lines
		.slice(end + 1)
		.join('\n')
		.trim();
	if (!body) {
		errors.push('the pack (the body after the frontmatter) is empty');
		return { ok: false, errors };
	}

	const sections = new Map<string, string>();
	const order: string[] = [];
	let current: string | null = null;
	let buffer: string[] = [];
	const close = () => {
		if (current !== null) sections.set(current, buffer.join('\n').trim());
	};
	const bodyLines = body.split('\n');
	if (!/^# \S/.test(bodyLines[0])) errors.push('the pack starts with a "# " title');
	for (const line of bodyLines.slice(1)) {
		const heading = /^## (\S.*)$/.exec(line);
		if (heading) {
			close();
			current = heading[1].trim();
			if (sections.has(current)) errors.push(`## ${current}: appears twice`);
			order.push(current);
			buffer = [];
		} else if (current !== null) buffer.push(line);
	}
	close();

	const expected = [...(family === 'slot' ? [KINDS_SECTION] : []), ...PACK_SECTIONS];
	for (const name of order) {
		if (!expected.includes(name)) errors.push(`## ${name}: not a section a ${family} pack has`);
	}
	for (const name of expected) {
		const content = sections.get(name);
		if (content === undefined) errors.push(`## ${name}: missing`);
		else if (!content) errors.push(`## ${name}: empty`);
	}
	if (errors.length === 0 && order.join('\n') !== expected.join('\n')) {
		errors.push(`sections out of order: expected ${expected.join(', ')}`);
	}

	if (isFamily(family)) {
		const tags = [...(sections.get('Mockup screen tags') ?? '').matchAll(/^- \*\*(.+?)\*\*/gm)].map(
			(m) => m[1],
		);
		if (tags.join('\n') !== MOCKUP_SCREEN_TAGS[family].join('\n')) {
			errors.push(
				`## Mockup screen tags: lists ${tags.join(', ') || 'no "- **<tag>**" lines'}; MOCKUP_SCREEN_TAGS.${family} is ${MOCKUP_SCREEN_TAGS[family].join(', ')}`,
			);
		}
	}

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, pack: { family: family as PackFamily, text: body, sections } };
}
