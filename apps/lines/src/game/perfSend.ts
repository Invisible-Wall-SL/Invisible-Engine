import { DEFAULT_DOC_BASE } from '../editor-scenes';
import { perfSenderTo, type PerfSender } from './perfSendCore';

export type { PerfSender, SendOutcome } from './perfSendCore';

/**
 * Sends a `?perf=1` reading to the Invisible Profiler (`docs/design/invisible-profiler.md` §1).
 * `PerfHud.svelte` imports this module only when the URL carries `&perfsession=<token>` — a capture
 * session the Profiler opened — so a player never downloads it and a `?perf=1` read without a
 * session never makes a request. The reading goes to the launcher the game already boots from
 * (`?editorDocBase=`, else the studio's); the wire is `perfSendCore.ts`.
 */
export function createPerfSender(query: URLSearchParams): PerfSender | undefined {
	const token = query.get('perfsession');
	if (!token) return undefined;
	return perfSenderTo(query.get('editorDocBase') || DEFAULT_DOC_BASE, token);
}
