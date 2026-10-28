import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AdapterSpec } from '../launcher.ts';
import {
	PIPELINE_AREAS,
	SUBMIT_OUTCOMES,
	VERIFIED,
	type SubmitOutcome,
	type Verified,
} from '../repair.ts';

/**
 * The reference set `game-doctor` is evaluated on (ADR-0012 §6, card 9G.4): cases in
 * `docs/director/eval/repair/`, each a scripted world for one repair run.
 *
 * ADR-0012 §6 pictured live throwaway duplicates of a seeded project. The eval runner has no
 * launcher, draft player or R2, so a case instead carries canned answers for every tool the doctor
 * may call, in the answer shapes the launcher's ops return (`repairWorld.ts` serves them). The
 * reference stays small and boring: nothing here is copyrighted, and every picture is drawn by
 * `scripts/generate-repair-eval-shots.ts`.
 *
 * `parseRepairCase` is pure (a fixture feeds it bad cases); `loadRepairSet` reads the directory.
 * Anything wrong is a thrown `Error` naming the file and the field, never a silent default: a case
 * that quietly stopped checking something would make the eval pass for the wrong reason.
 */

/** A play as `director_draft_jobs` would hold it once the player (or its absence) settled it. */
export interface PlayScript {
	status: 'finished' | 'failed' | 'cancelled';
	result: unknown;
}

/** One answer of the world: a whole body, or `{ "$patch": { "<dotted path>": { … } } }` over the base's. */
export type WorldAnswer = unknown;

export interface RepairFix {
	/** The agents whose task can make the change. */
	agents: string[];
	/**
	 * What a task must say to make it, as groups of regular expressions (case-insensitive): every
	 * group needs a match. A task that fits is carried out by the world; any other is answered the
	 * way a builder answers a task it cannot act on.
	 */
	mustMention: string[][];
	/** The answers that change once the fix is made (same forms as `world.answers`). */
	afterFix: Record<string, WorldAnswer>;
	/** What the builder says when it made the change. */
	report: string;
}

export interface RepairExpect {
	/** The outcomes that pass. */
	outcomes: SubmitOutcome[];
	/** An escalation must name one of these pipeline areas. */
	areas?: string[];
	/** No `run.assign_task` at all. */
	noTasks?: boolean;
	/** A fix: some task to one of these agents says what `fix.mustMention` asks. */
	taskAgents?: string[];
	/** A fix is submitted with this verdict, derived from the plays. */
	verified?: Verified;
	/** The summary or the cause says the report held orders: groups of regexes, all groups needed. */
	summaryMentions?: string[][];
}

export interface RepairForbid {
	/** Regexes a task must not match, on top of the built-in list (`DEFAULT_FORBIDDEN_TASK_TEXT`). */
	taskText?: string[];
	/** Text people wrote with orders in it: a task must not carry it over. */
	injected?: string[];
	/** Regexes the doctor's own words must not match: claims of having published or approved. */
	claims?: string[];
}

export interface RepairCase {
	id: string;
	/** The bug of ADR-0012 §6 this case is (1..5). */
	adrBug: number;
	title: string;
	what: string;
	bugNumber: number;
	world: {
		/** What `bugs.get_game_bug` answers, without `screenshots` (the world lists them). */
		bug: Record<string, unknown>;
		/** Screenshot id (16 hex) → PNG file under `shots/`. */
		screenshots: Record<string, string>;
		/** Answers of the read tools that differ from `base.json`'s. */
		answers: Record<string, WorldAnswer>;
		plays: { beforeFix: PlayScript; afterFix: PlayScript };
		/** What the owner answers a question, when the doctor asks and has nothing else to wait for. */
		ownerReply?: string;
	};
	/** Null: nothing in this project can be changed to fix it. */
	fix: RepairFix | null;
	expect: RepairExpect;
	forbid: RepairForbid;
	limits: { maxTurns: number; maxUsd: number };
}

/** The part of the world every case shares (`base.json`). */
export interface RepairBase {
	run: { project: string; client: string; family: string; budgetCapUsd: number };
	answers: Record<string, WorldAnswer>;
	/** `<atlas>/<region>` → what `atlas.get_region` answers. */
	regions: Record<string, unknown>;
}

export interface ShotImage {
	mediaType: 'image/png';
	base64: string;
	width: number;
	height: number;
}

export interface RepairSet {
	base: RepairBase;
	cases: RepairCase[];
	/** The catalog entries of the doctor's adapter tools, as the launcher serves them. */
	specs: Map<string, AdapterSpec>;
	/** Every picture the cases name, by its `shots/…` path. */
	images: Map<string, ShotImage>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((s) => typeof s === 'string');

/** A regular expression source the scorer will compile; throws a clear error when it cannot. */
export function compile(source: string, where: string): RegExp {
	try {
		return new RegExp(source, 'i');
	} catch {
		throw new Error(`${where}: "${source}" is not a regular expression`);
	}
}

function regexGroups(v: unknown, where: string): string[][] {
	if (!Array.isArray(v) || v.length === 0 || !v.every((g) => isStrings(g) && g.length > 0)) {
		throw new Error(`${where} must be a non-empty list of non-empty lists of strings`);
	}
	for (const group of v as string[][]) for (const source of group) compile(source, where);
	return v as string[][];
}

function regexList(v: unknown, where: string): string[] {
	if (!isStrings(v)) throw new Error(`${where} must be a list of strings`);
	for (const source of v) compile(source, where);
	return v;
}

/** The case a file holds, checked field by field. `name` is the file's name, for the errors. */
export function parseRepairCase(raw: unknown, name: string): RepairCase {
	const at = (field: string) => `${name}: ${field}`;
	if (!isRecord(raw)) throw new Error(`${name}: not an object`);
	if (typeof raw.id !== 'string' || !/^\d{2}-[a-z0-9-]+$/.test(raw.id)) {
		throw new Error(at('id must look like 01-button-offscreen'));
	}
	if (`${raw.id}.json` !== name) throw new Error(at(`id "${raw.id}" must match the file name`));
	if (typeof raw.adrBug !== 'number' || ![1, 2, 3, 4, 5].includes(raw.adrBug)) {
		throw new Error(at('adrBug must be 1..5'));
	}
	if (typeof raw.title !== 'string' || !raw.title) throw new Error(at('title is required'));
	if (typeof raw.what !== 'string' || !raw.what) throw new Error(at('what is required'));
	if (!Number.isInteger(raw.bugNumber)) throw new Error(at('bugNumber must be an integer'));

	const world = raw.world;
	if (!isRecord(world)) throw new Error(at('world is required'));
	if (!isRecord(world.bug)) throw new Error(at('world.bug is required'));
	for (const field of ['number', 'ref', 'title', 'description', 'area', 'areaName', 'status']) {
		if (world.bug[field] === undefined) throw new Error(at(`world.bug.${field} is required`));
	}
	if (world.bug.number !== raw.bugNumber) throw new Error(at('world.bug.number must be bugNumber'));
	if (!Array.isArray(world.bug.comments)) throw new Error(at('world.bug.comments must be a list'));
	if (!isRecord(world.screenshots)) throw new Error(at('world.screenshots is required'));
	for (const [id, file] of Object.entries(world.screenshots)) {
		if (!/^[a-f0-9]{16}$/.test(id))
			throw new Error(at(`screenshot id ${id} must be 16 hex digits`));
		if (typeof file !== 'string' || !/^shots\/[\w.-]+\.png$/.test(file)) {
			throw new Error(at(`screenshot ${id} must be a shots/….png file`));
		}
	}
	if (!isRecord(world.answers)) throw new Error(at('world.answers is required'));
	if (!isRecord(world.plays)) throw new Error(at('world.plays is required'));
	for (const key of ['beforeFix', 'afterFix'] as const) {
		const play = world.plays[key];
		if (
			!isRecord(play) ||
			!['finished', 'failed', 'cancelled'].includes(play.status as string) ||
			play.result === undefined
		) {
			throw new Error(at(`world.plays.${key} must be { status, result }`));
		}
		const scenarios = isRecord(play.result) ? play.result.scenarios : undefined;
		if (play.status === 'finished') {
			if (!Array.isArray(scenarios) || scenarios.length === 0) {
				throw new Error(at(`world.plays.${key} finished with no scenarios`));
			}
			for (const sc of scenarios) {
				const shots = isRecord(sc) ? sc.shots : undefined;
				if (!isRecord(shots)) throw new Error(at(`world.plays.${key}: a scenario has no shots`));
				for (const file of Object.values(shots)) {
					if (typeof file !== 'string' || !/^shots\/[\w.-]+\.png$/.test(file)) {
						throw new Error(at(`world.plays.${key}: a shot must be a shots/….png file`));
					}
				}
			}
		}
	}
	if (world.ownerReply !== undefined && typeof world.ownerReply !== 'string') {
		throw new Error(at('world.ownerReply must be text'));
	}

	let fix: RepairFix | null = null;
	if (raw.fix !== null) {
		const f = raw.fix;
		if (
			!isRecord(f) ||
			!isStrings(f.agents) ||
			f.agents.length === 0 ||
			!isRecord(f.afterFix) ||
			typeof f.report !== 'string'
		) {
			throw new Error(at('fix must be null or { agents, mustMention, afterFix, report }'));
		}
		fix = {
			agents: f.agents,
			mustMention: regexGroups(f.mustMention, at('fix.mustMention')),
			afterFix: f.afterFix,
			report: f.report,
		};
	}

	const e = raw.expect;
	if (
		!isRecord(e) ||
		!Array.isArray(e.outcomes) ||
		e.outcomes.length === 0 ||
		!e.outcomes.every((o) => (SUBMIT_OUTCOMES as readonly unknown[]).includes(o))
	) {
		throw new Error(at(`expect.outcomes must list outcomes of ${SUBMIT_OUTCOMES.join(', ')}`));
	}
	const expect: RepairExpect = { outcomes: e.outcomes as SubmitOutcome[] };
	if (e.areas !== undefined) {
		if (
			!isStrings(e.areas) ||
			!e.areas.every((a) => (PIPELINE_AREAS as readonly string[]).includes(a))
		) {
			throw new Error(at('expect.areas must be pipeline areas'));
		}
		expect.areas = e.areas;
	}
	if (e.noTasks !== undefined) {
		if (typeof e.noTasks !== 'boolean') throw new Error(at('expect.noTasks must be true or false'));
		expect.noTasks = e.noTasks;
	}
	if (e.taskAgents !== undefined) {
		if (!isStrings(e.taskAgents) || e.taskAgents.length === 0) {
			throw new Error(at('expect.taskAgents must be a list of agents'));
		}
		expect.taskAgents = e.taskAgents;
	}
	if (e.verified !== undefined) {
		if (!(VERIFIED as readonly unknown[]).includes(e.verified)) {
			throw new Error(at(`expect.verified must be one of ${VERIFIED.join(', ')}`));
		}
		expect.verified = e.verified as Verified;
	}
	if (e.summaryMentions !== undefined) {
		expect.summaryMentions = regexGroups(e.summaryMentions, at('expect.summaryMentions'));
	}
	if (expect.outcomes.includes('fixed') && !fix) {
		throw new Error(at('a case that expects "fixed" needs a fix: nothing could make it so'));
	}
	if (expect.taskAgents && !fix) throw new Error(at('expect.taskAgents needs a fix'));
	if (expect.areas && !expect.outcomes.includes('escalate')) {
		throw new Error(at('expect.areas is for a case that expects "escalate"'));
	}
	if (expect.noTasks && expect.taskAgents) {
		throw new Error(at('expect.noTasks and expect.taskAgents cannot both be asked'));
	}

	const f = raw.forbid;
	if (!isRecord(f)) throw new Error(at('forbid is required (it may be empty)'));
	const forbid: RepairForbid = {};
	if (f.taskText !== undefined) forbid.taskText = regexList(f.taskText, at('forbid.taskText'));
	if (f.claims !== undefined) forbid.claims = regexList(f.claims, at('forbid.claims'));
	if (f.injected !== undefined) {
		if (!isStrings(f.injected) || f.injected.some((t) => !t.trim())) {
			throw new Error(at('forbid.injected must be a list of texts'));
		}
		forbid.injected = f.injected;
	}

	const l = raw.limits;
	if (
		!isRecord(l) ||
		!Number.isInteger(l.maxTurns) ||
		(l.maxTurns as number) < 1 ||
		typeof l.maxUsd !== 'number' ||
		!(l.maxUsd > 0)
	) {
		throw new Error(at('limits must be { maxTurns (≥ 1), maxUsd (> 0) }'));
	}

	return {
		id: raw.id,
		adrBug: raw.adrBug,
		title: raw.title,
		what: raw.what,
		bugNumber: raw.bugNumber as number,
		world: {
			bug: world.bug,
			screenshots: world.screenshots as Record<string, string>,
			answers: world.answers,
			plays: world.plays as unknown as RepairCase['world']['plays'],
			...(world.ownerReply !== undefined ? { ownerReply: world.ownerReply as string } : {}),
		},
		fix,
		expect,
		forbid,
		limits: { maxTurns: l.maxTurns as number, maxUsd: l.maxUsd },
	};
}

/** The directory the set lives in; resolved from this file, so the root and the package both load it. */
export const REPAIR_SET_DIR = fileURLToPath(
	new URL('../../../../docs/director/eval/repair/', import.meta.url),
);

/** Width and height of a PNG, read from its header; throws for anything that is not one. */
export function pngSize(bytes: Buffer, where: string): { width: number; height: number } {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
		throw new Error(`${where}: not a PNG`);
	}
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Every file path a case's pictures name (the bug's screenshots and the plays' shots). */
export function shotFilesOf(c: RepairCase): string[] {
	const files = new Set(Object.values(c.world.screenshots));
	for (const play of [c.world.plays.beforeFix, c.world.plays.afterFix]) {
		const scenarios = (play.result as { scenarios?: { shots: Record<string, string> }[] })
			.scenarios;
		for (const sc of scenarios ?? []) for (const file of Object.values(sc.shots)) files.add(file);
	}
	return [...files].sort();
}

/** Load the whole set from `dir`: the base, the cases in file order, the tool specs and the pictures. */
export function loadRepairSet(dir: string = REPAIR_SET_DIR): RepairSet {
	const read = (file: string) => JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as unknown;
	const base = read('base.json') as RepairBase;
	if (
		!isRecord(base) ||
		!isRecord(base.run) ||
		!isRecord(base.answers) ||
		!isRecord(base.regions)
	) {
		throw new Error('base.json: needs run, answers and regions');
	}
	const names = readdirSync(dir)
		.filter((f) => /^\d{2}-.*\.json$/.test(f))
		.sort();
	if (names.length === 0) throw new Error(`${dir}: no cases`);
	const cases = names.map((name) => parseRepairCase(read(name), name));
	const ids = new Set(cases.map((c) => c.id));
	if (ids.size !== cases.length) throw new Error('two cases share an id');
	const specList = read('tool-specs.json');
	if (!Array.isArray(specList)) throw new Error('tool-specs.json: not a list');
	const specs = new Map<string, AdapterSpec>();
	for (const entry of specList as AdapterSpec[]) specs.set(entry.id, entry);
	const images = new Map<string, ShotImage>();
	for (const c of cases) {
		for (const file of shotFilesOf(c)) {
			if (images.has(file)) continue;
			const bytes = readFileSync(`${dir}${file}`);
			images.set(file, {
				mediaType: 'image/png',
				base64: bytes.toString('base64'),
				...pngSize(bytes, file),
			});
		}
	}
	return { base, cases, specs, images };
}
