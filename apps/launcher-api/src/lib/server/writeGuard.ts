import { error } from '@sveltejs/kit';
import { formBaseEtag, jsonBaseEtag } from './r2';

/**
 * Resolve the write precondition for a SAVE endpoint, ENFORCING that the client actually
 * sent one. This closes the temporary fail-open of Phase 1
 * (`docs/design/multi-user-concurrency.md`): `jsonBaseEtag`/`formBaseEtag` collapse a missing
 * field and an explicit `null` to the same `undefined` (an unconditional write), so a new
 * tool that forgot to thread the precondition got a silently unguarded write and a green
 * build. Now a totally-absent field is a 400 instead.
 *
 * "Required" means the KEY must be PRESENT; its VALUE may legitimately be:
 *  - a string → `ifMatch` (the CAS update),
 *  - `null` → `ifNoneMatch:'*'` (the create-path — "no doc existed when I loaded"),
 *  - and a `force: true` write omits `baseEtag` entirely on purpose (the author's explicit
 *    "overwrite with mine" — an unconditional write is the whole point of force). So `force`
 *    SATISFIES the requirement and short-circuits to `undefined`.
 *
 * Returns `undefined` only for `force`; otherwise `string | null`. Throws a 400 when neither
 * `force` nor a well-formed `baseEtag` is present.
 */
export function writeBaseEtagJson(body: unknown): string | null | undefined {
	if (!isRecord(body)) {
		throw error(400, 'This save had no body — reload the tool and try again.');
	}
	if (body.force === true) return undefined;
	if (!('baseEtag' in body)) {
		throw error(
			400,
			'This save did not send its baseEtag precondition — reload the tool and try again.',
		);
	}
	const v = body.baseEtag;
	if (v !== null && typeof v !== 'string') {
		throw error(
			400,
			'This save sent a malformed baseEtag precondition — reload the tool and try again.',
		);
	}
	return jsonBaseEtag(v);
}

/**
 * {@link writeBaseEtagJson} for a FormData save (the editor + localization form actions).
 * FormData has no `null`, so the EMPTY STRING encodes the create-path and an ABSENT field is
 * the regression this guards. `force` is the string `'1'`.
 */
export function writeBaseEtagForm(form: FormData): string | null | undefined {
	if (form.get('force') === '1') return undefined;
	const v = form.get('baseEtag');
	if (typeof v !== 'string') {
		throw error(
			400,
			'This save did not send its baseEtag precondition — reload the tool and try again.',
		);
	}
	return formBaseEtag(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
