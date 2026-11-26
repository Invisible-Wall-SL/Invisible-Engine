import { error } from '@sveltejs/kit';
import { createKeyedMutex } from './concurrency';
import { githubApp, GithubAppError, type GithubApp } from './githubApp';
import {
	approverName,
	forgetChanges,
	isOnHold,
	ON_HOLD_LABEL,
	readPull,
	repo,
} from './pipelineChanges';
import { clickerOf } from './pipelineRuntimeBytes';

/**
 * Put a change on hold and resume it (ADR-0015 §7). GitHub is the record: the label `on-hold` on the
 * pull request, and one App comment naming who did it and why. The label is made once by the owner;
 * when it does not exist, GitHub makes it silently or refuses an App that may not, and the refusal
 * becomes a plain sentence. Neither action merges, approves or touches the branch.
 */

export const HOLD_NOTE_MAX = 500;
export const LABEL_MISSING_TEXT = `Create the label \`${ON_HOLD_LABEL}\` once in GitHub (owner setup).`;

export type HoldCode = 'label_missing' | 'already_on_hold' | 'not_on_hold' | 'not_open';

/** A refusal: 409, with a code. */
function refuse(code: HoldCode, message: string): never {
	throw error(409, { message, code });
}

/** One line a comment can carry: no backticks and no `@`, so nobody is paged and no code opens. */
export function holdNoteText(note: string): string {
	return note.replace(/[`@]/g, '').replace(/\s+/g, ' ').trim();
}

export const holdComment = (name: string, note: string): string =>
	note
		? `Put on hold by ${name} via Pipeline Changes: ${note}`
		: `Put on hold by ${name} via Pipeline Changes.`;

export const resumeComment = (name: string): string => `Resumed by ${name} via Pipeline Changes.`;

const holding = createKeyedMutex();

async function comment(app: GithubApp, number: number, body: string): Promise<void> {
	await app.json(`/repos/${repo()}/issues/${number}/comments`, {
		method: 'POST',
		body: JSON.stringify({ body }),
	});
}

type Person = Parameters<typeof approverName>[0];

/** Label the change `on-hold` and say so. `note` is the person's reason, 500 characters at most. */
export function putOnHold(
	input: { number: number; note: string; user: Person },
	app: GithubApp = githubApp,
): Promise<{ number: number; onHold: true }> {
	const { number } = input;
	return holding(String(number), async () => {
		const pull = await readPull(number, app);
		if (pull.state !== 'open') refuse('not_open', `#${number} is not open.`);
		if (isOnHold(pull)) refuse('already_on_hold', `#${number} is already on hold.`);
		const res = await app.fetch(`/repos/${repo()}/issues/${number}/labels`, {
			method: 'POST',
			body: JSON.stringify({ labels: [ON_HOLD_LABEL] }),
		});
		if (res.status === 403 || res.status === 404 || res.status === 422) {
			refuse('label_missing', LABEL_MISSING_TEXT);
		}
		if (!res.ok) throw new GithubAppError(`GitHub ${res.status} labelling #${number}.`, res.status);
		await comment(app, number, holdComment(clickerOf(input.user), holdNoteText(input.note)));
		forgetChanges();
		return { number, onHold: true };
	});
}

/** Take the label off and say so. */
export function resumeChange(
	input: { number: number; user: Person },
	app: GithubApp = githubApp,
): Promise<{ number: number; onHold: false }> {
	const { number } = input;
	return holding(String(number), async () => {
		const pull = await readPull(number, app);
		if (!isOnHold(pull)) refuse('not_on_hold', `#${number} is not on hold.`);
		const res = await app.fetch(
			`/repos/${repo()}/issues/${number}/labels/${encodeURIComponent(ON_HOLD_LABEL)}`,
			{ method: 'DELETE' },
		);
		if (res.status === 404) refuse('not_on_hold', `#${number} is not on hold.`);
		if (!res.ok) {
			throw new GithubAppError(`GitHub ${res.status} unlabelling #${number}.`, res.status);
		}
		await comment(app, number, resumeComment(clickerOf(input.user)));
		forgetChanges();
		return { number, onHold: false };
	});
}
