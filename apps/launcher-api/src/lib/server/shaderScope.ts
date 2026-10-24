import type { Cookies } from '@sveltejs/kit';
import { gate, type ToolScope } from './toolScope';

/**
 * Who reaches Invisible Shader Graph docs. The tools whose pickers list custom Element FX (the
 * Scene Editor, Symbols, the Flow, Invisible FX) read a project's graphs. Until `/shaders` is a
 * tool of its own (`docs/design/invisible-shader-graph.md` §8 step 5), Scene Editor users write
 * them: a graph is presentation, compiled from generated names only, so it gives no one anything
 * the Scene Editor does not.
 */
export const shaderReadScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: 'editor',
		altTools: ['symbols', 'flow', 'fx'],
		forbiddenMessage: 'Your role does not have access to shader effects.',
	});

export const shaderWriteScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role cannot save shader effects.',
	});

/**
 * A tab names the project it is editing; the scope is the session's. A mismatch answers 409 rather
 * than reading or writing another project's graph that happens to share the id.
 */
export function projectMismatch(claimed: unknown, projectKey: string): Response | null {
	if (typeof claimed !== 'string' || !claimed || claimed === projectKey) return null;
	return Response.json(
		{
			ok: false,
			error: 'scope-mismatch',
			message:
				`This tab is editing "${claimed}" but your active project is now "${projectKey}". ` +
				'Reload to continue.',
		},
		{ status: 409 },
	);
}
