/**
 * The publish checks as a verdict: what the online Publish checks before it builds
 * (`publishGame.ts`: the draft sounds it ships, gates 1a flow and 1b family), answered for a project
 * instead of thrown, so a DESKTOP ☁ Publish or 📦 Deliver runs the same ones. Served by
 * `GET /api/launcher/publish-check`; the desktop build asks it from `bake-editor-doc.mjs`
 * (`scripts/lib/publishCheck.mjs`) before it exports or compiles anything.
 *
 * It CALLS the checks and decides nothing itself: what counts as a draft sound, a flow error or a
 * family the runtime cannot play is each check's answer, so a change to one reaches the desktop
 * the day it reaches the online Publish. Every check runs, so one build log lists every problem.
 * Draft sounds are a WARNING, as online (the owner ships drafts, 2026-11-13): they never turn `ok`
 * false. Overrides stay with the caller: the online Publish's `allowInvalidFlow`, the build's
 * `IE_PUBLISH_ANYWAY`.
 *
 * Deliberately not here: the own-bundle guard (a desktop build IS its own bundle), the online
 * runtime's `kind-family`, `no-game-server` and `runtime-unreleased`, and the paytable gate, which
 * the bake already runs through `/api/game-config/doc`.
 */
import { unplayableFamilyMessage } from './familyGate';
import { checkFlowV2ForPublish, flowGateRefusal } from './flowV2Validation';
import { loadGameConfigDoc } from './gameConfigStorage';
import { clientKeyOf } from './projectLookup';
import { projectGameType } from './projects';
import { checkSoundsForPublish } from './soundPublishCheck';

/** The three checks a verdict covers, in the order the online Publish runs them. */
export const PUBLISH_CHECKS = ['sounds', 'flow', 'family'] as const;
export type PublishCheck = (typeof PUBLISH_CHECKS)[number];

/** A failed check's id: the `reason` the online Publish's refusal carries for the same finding. */
export type PublishCheckFailureId = 'invalid-flow' | 'flow-wrong-kind' | 'unplayable-family';
/** A warning's id. `unapproved-sounds` was a failure until 2026-11-13, so an `IE_PUBLISH_ANYWAY`
 *  list that still names it lifts nothing and stops nothing. */
export type PublishCheckWarningId = 'unapproved-sounds';

export interface PublishCheckFinding {
	id: PublishCheckFailureId | PublishCheckWarningId;
	/** What is wrong, in one line. */
	reason: string;
	/** The names behind it: the draft sounds, the flow's errors. */
	items: string[];
	/** Where to fix it — read after "Fix it in". */
	fixIn: string;
	/** Whether a person may ship it anyway: the online Publish's override, where it has one. A
	 *  warning never stops anything, so it has nothing to lift: always false. */
	overridable: boolean;
}

export interface PublishChecksResult {
	project: string;
	/** True when nothing FAILED; warnings never turn it false. */
	ok: boolean;
	checked: readonly PublishCheck[];
	failed: PublishCheckFinding[];
	/** What ships with a warning: the draft sounds the game ships. */
	warnings: PublishCheckFinding[];
	/** How a desktop build ships past the overridable findings (`scripts/lib/publishCheck.mjs`). */
	publishAnyway: { flag: string; env: string };
}

/** The desktop build's override, named by the build script that reads it. */
export const PUBLISH_ANYWAY = { flag: '--publish-anyway', env: 'IE_PUBLISH_ANYWAY' } as const;

const FIX_IN: Record<PublishCheckFailureId | PublishCheckWarningId, string> = {
	'unapproved-sounds':
		'Invisible Sound (approve each draft, or delete the ones the game should not ship)',
	'invalid-flow': 'Invisible Flow (Validation panel)',
	'flow-wrong-kind': '/admin (Re-scaffold the project, or change its kind back)',
	'unplayable-family': 'Invisible Game Config',
};

function draftSoundsReason(count: number): string {
	return count === 1
		? 'The game ships 1 sound still marked draft.'
		: `The game ships ${count} sounds still marked draft.`;
}

/** Every publish check for `projectKey`, through the gates the online Publish calls. */
export async function runPublishChecks(projectKey: string): Promise<PublishChecksResult> {
	const clientKey = await clientKeyOf(projectKey);
	const [gameType, sounds, flow, config] = await Promise.all([
		projectGameType(projectKey),
		checkSoundsForPublish(clientKey, projectKey),
		checkFlowV2ForPublish(clientKey, projectKey),
		loadGameConfigDoc(clientKey, projectKey),
	]);

	const failed: PublishCheckFinding[] = [];
	const warnings: PublishCheckFinding[] = [];
	if (sounds.unapproved.length) {
		warnings.push({
			id: 'unapproved-sounds',
			reason: draftSoundsReason(sounds.unapproved.length),
			items: sounds.unapproved,
			fixIn: FIX_IN['unapproved-sounds'],
			overridable: false,
		});
	}
	const flowRefusal = flowGateRefusal(flow, gameType);
	if (flowRefusal) {
		failed.push({
			id: flowRefusal.reason,
			reason: flowRefusal.message,
			items: flowRefusal.details,
			fixIn: FIX_IN[flowRefusal.reason],
			// The gate's own answer to "and with the override?": a wrong-kind flow has none.
			overridable: flowGateRefusal(flow, gameType, true) === null,
		});
	}
	const unplayable = unplayableFamilyMessage(config);
	if (unplayable) {
		failed.push({
			id: 'unplayable-family',
			reason: unplayable,
			items: [],
			fixIn: FIX_IN['unplayable-family'],
			overridable: false,
		});
	}

	return {
		project: projectKey,
		ok: failed.length === 0,
		checked: PUBLISH_CHECKS,
		failed,
		warnings,
		publishAnyway: PUBLISH_ANYWAY,
	};
}
