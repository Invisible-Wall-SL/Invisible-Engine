import type { Cookies } from '@sveltejs/kit';
import { gate, type ToolScope } from './toolScope';

/**
 * Who reaches Invisible Shader Graph docs. The tools whose pickers list custom Element FX (the
 * Scene and Component Editors, Symbols, the Flow) read a project's graphs. Until `/shaders` is a
 * tool of its own (`docs/design/invisible-shader-graph.md` §8 step 5), Scene Editor users write
 * them: a graph is presentation, compiled from generated names only, so it gives no one anything
 * the Scene Editor does not.
 */
export const shaderReadScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: 'editor',
		altTools: ['componentEditor', 'symbols', 'flow'],
		forbiddenMessage: 'Your role does not have access to shader effects.',
	});

export const shaderWriteScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role cannot save shader effects.',
	});
