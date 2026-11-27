import { createSingleFlight } from './concurrency';
import type { GithubApp } from './githubApp';

/**
 * What a failed job says to do about itself: the first `failure` annotation of its check run that
 * is not GitHub's generic exit-code line (`GET /check-runs/{id}/annotations`, which the App's
 * Checks read allows). A `check:*` script that ends on a one-line instruction, printed as
 * `::error title=…::<instruction>`, becomes that annotation, so Pipeline Changes can put the
 * instruction under the failed job in place of the bare "failed".
 */

export interface GhAnnotation {
	annotation_level?: string;
	message?: string | null;
}

/** GitHub's own annotation for any step that exits non-zero: it says nothing a person can act on. */
const GENERIC_FAILURE = /^Process completed with exit code \d+\.?$/;
export const INSTRUCTION_MAX = 500;
/** A finished check run's annotations do not change; a re-run is a new check run with a new id. */
const INSTRUCTION_TTL_MS = 10 * 60_000;
const CACHE_SIZE = 256;
/** A page of annotations; the instruction is a closing line, never one of dozens. */
const PER_PAGE = 50;

const isControl = (ch: string): boolean => {
	const code = ch.charCodeAt(0);
	return (code < 32 && code !== 10 && code !== 9) || code === 127;
};

/** Text for a person, never markup: control characters out, blank ends trimmed, cut at the cap. */
function plainText(message: string): string {
	const text = [...message]
		.filter((ch) => !isControl(ch))
		.join('')
		.trim();
	return text.length > INSTRUCTION_MAX ? `${text.slice(0, INSTRUCTION_MAX - 1)}…` : text;
}

/** The instruction among a check run's annotations, or `null` when it carries none. */
export function instructionOf(annotations: GhAnnotation[]): string | null {
	for (const a of annotations) {
		if (a.annotation_level !== 'failure' || typeof a.message !== 'string') continue;
		const text = plainText(a.message);
		if (text && !GENERIC_FAILURE.test(text)) return text;
	}
	return null;
}

const cache = new Map<number, { at: number; text: string | null }>();
const flight = createSingleFlight();

/** Forget what was read; for a fixture. */
export function forgetInstructions(): void {
	cache.clear();
}

/**
 * The instruction of one failed check run: a string, `null` when the run has none, `undefined`
 * when GitHub would not say (a state the page shows, never an error; not cached, so the next read
 * asks again).
 */
export async function readInstruction(
	app: GithubApp,
	repo: string,
	checkRunId: number,
): Promise<string | null | undefined> {
	const hit = cache.get(checkRunId);
	if (hit && Date.now() - hit.at < INSTRUCTION_TTL_MS) return hit.text;
	return flight(`annotations:${checkRunId}`, async () => {
		try {
			const res = await app.fetch(
				`/repos/${repo}/check-runs/${checkRunId}/annotations?per_page=${PER_PAGE}`,
			);
			if (!res.ok) return undefined;
			const body: unknown = await res.json();
			if (!Array.isArray(body)) return undefined;
			const text = instructionOf(body as GhAnnotation[]);
			if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as number);
			cache.set(checkRunId, { at: Date.now(), text });
			return text;
		} catch {
			return undefined;
		}
	});
}
