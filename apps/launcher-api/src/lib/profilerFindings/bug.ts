/**
 * Invisible Profiler P5 (`docs/design/invisible-profiler.md` §5): a finding filed through Invisible
 * Bug Reports — which list it belongs in, its area there, and the text the form opens with. Pure,
 * so `scripts/check-profiler-bugs.ts` runs it over the real `owners.json`.
 *
 * - A **game** bug is the game's own content: oversize or heavy art, files nothing loads, a build
 *   published without 🗜 Optimize, a build that grew, the cost of the game's own particles or
 *   Element FX. It names its project, and its area is a part of the game.
 * - A **pipeline** bug is the engine or a tool: the renderer's cost (fps, GPU- or CPU-bound),
 *   spikes (shader compiles, texture uploads, a tool's runtime), KTX2 assets that fell back, a
 *   fps or lab-count regression (most often a runtime release), and the arcade runtime's sim and
 *   room work (catch-up, spawn churn, cost per body, patch stutter). Its area is the tool the
 *   owning agent owns in `owners.json`, else the engine.
 */

import {
	bugAreaName,
	bugRef,
	isBugArea,
	MAX_DESCRIPTION,
	MAX_TITLE,
	type BugKind,
} from '../bugReports';
import { RULE_TITLES, type Finding, type OwnerMap } from './finding';

export interface FindingBugTarget {
	kind: BugKind;
	area: string;
}

const ENGINE_AGENT = 'engine-pixi-svelte';

/**
 * The tool a pipeline finding's owning agent owns (`owners.json` `tools`, first owner), as a Bug
 * Reports area. The engine's agent, a game kind's build agent, and a person all file against the
 * game runtime.
 */
export function pipelineArea(finding: Pick<Finding, 'owner'>, owners: OwnerMap): string {
	const { owner } = finding;
	if (owner.kind !== 'agent' || owner.id === ENGINE_AGENT) return 'engine';
	if (Object.values(owners.kinds).some((agents) => agents.includes(owner.id))) return 'engine';
	const tool = Object.entries(owners.tools).find(
		([id, agents]) => agents[0] === owner.id && isBugArea('pipeline', id),
	);
	return tool ? tool[0] : 'engine';
}

/** Which list a finding is filed in, and against what. */
export function findingBugTarget(
	finding: Pick<Finding, 'id' | 'rule' | 'owner'>,
	owners: OwnerMap,
): FindingBugTarget {
	const game = (area: string): FindingBugTarget => ({ kind: 'game', area });
	const pipeline: FindingBugTarget = { kind: 'pipeline', area: pipelineArea(finding, owners) };
	switch (finding.rule) {
		case 'unusedBytes':
		case 'optimizeOff':
			return game('loading');
		case 'textures':
			// A KTX2 fallback is the loader's or the encoder's, not the art's.
			return finding.id.startsWith('textures:ktx2:') ? pipeline : game('art');
		case 'featureCost':
			// Particles and Element FX are what the game authored; antialiasing is the renderer's.
			return finding.owner.kind === 'agent' && finding.owner.id === ENGINE_AGENT
				? pipeline
				: game('art');
		case 'regression':
			// A build that grew is the game's files; fps and lab counts that moved are the runtime's.
			return finding.id.startsWith('regression:fps:') || finding.id.startsWith('regression:counts:')
				? pipeline
				: game('loading');
		case 'fpsBelowBudget':
		case 'gpuCpuBound':
		case 'spikes':
		case 'simCatchUp':
		case 'spawnChurn':
		case 'bodyCost':
		case 'patchStutter':
			return pipeline;
	}
}

/** Where the profiler shows a finding's evidence: Compare for readings, Builds for a build. */
export function evidenceLinks(
	finding: Pick<Finding, 'evidence'>,
	projectKey: string,
	origin: string,
): string[] {
	const base = `${origin}/profiler?project=${encodeURIComponent(projectKey)}`;
	const readings = finding.evidence.filter((e) => e.type === 'reading');
	const lines: string[] = [];
	for (const e of finding.evidence) {
		if (e.type === 'build') {
			lines.push(
				`- Build ${e.label}: ${base}&tab=builds&build=${encodeURIComponent(e.id)} ` +
					`(breakdown JSON: ${origin}/api/profiler/builds/${encodeURIComponent(e.id)})`,
			);
		} else {
			const other = readings.find((r) => r.id !== e.id);
			lines.push(
				`- Reading ${e.label}: ${base}&tab=compare&a=${encodeURIComponent(e.id)}` +
					(other ? `&b=${encodeURIComponent(other.id)}` : '') +
					` (JSON: ${origin}/api/profiler/reports/${encodeURIComponent(e.id)})`,
			);
		}
	}
	return lines;
}

export const findingBugTitle = (finding: Pick<Finding, 'title'>): string => {
	const title = `Profiler: ${finding.title}`.replace(/\s+/g, ' ').trim();
	return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
};

/**
 * The bug's text: the rule, what it measured, the saving, who owns the fix, and links back to the
 * evidence on `/profiler`. The finding's id closes it, so a reader can find it on the Findings tab.
 */
export function findingBugDescription(
	finding: Finding,
	projectKey: string,
	origin: string,
	target: FindingBugTarget,
): string {
	const lines = [
		`Filed from the Invisible Profiler's Findings for ${projectKey}` +
			(finding.gameKey ? ` (game ${finding.gameKey})` : '') +
			'.',
		'',
		`Rule: ${RULE_TITLES[finding.rule]} · severity ${finding.severity}` +
			(finding.deviceClass ? ` · ${finding.deviceClass}` : ''),
		`Measured: ${finding.title}`,
		...finding.detail.map((d) => `- ${d}`),
		'',
		finding.estimate
			? `Estimated saving: ${finding.estimate.value} ${finding.estimate.unit} (${finding.estimate.basis})`
			: 'Estimated saving: unmeasured',
		`Owner: ${finding.owner.label}${target.kind === 'pipeline' ? ` · area ${bugAreaName('pipeline', target.area)}` : ''}`,
		'',
		'Evidence (kept while this bug exists):',
		...evidenceLinks(finding, projectKey, origin),
		'',
		`Findings tab: ${origin}/profiler?project=${encodeURIComponent(projectKey)}&tab=findings`,
		`Finding id: ${finding.id}`,
	];
	const text = lines.join('\n');
	return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

/** The filed bug a finding shows, as the Findings tab reads it. */
export interface FiledFinding {
	number: number;
	kind: BugKind;
	status: string;
}

export const filedLabel = (f: Pick<FiledFinding, 'number'>): string =>
	`Filed as ${bugRef(f.number)}`;

/** The report form a finding opens: its list's page, prefilled server-side from `finding`. */
export function fileFindingHref(
	finding: Pick<Finding, 'id'>,
	projectKey: string,
	kind: BugKind,
): string {
	const q = `new=1&project=${encodeURIComponent(projectKey)}&finding=${encodeURIComponent(finding.id)}`;
	return kind === 'game' ? `/game-bugs?${q}` : `/bugs?${q}`;
}
