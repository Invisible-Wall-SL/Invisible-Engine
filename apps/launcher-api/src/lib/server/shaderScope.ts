import type { Cookies } from '@sveltejs/kit';
import { gate, type ToolScope } from './toolScope';

/**
 * Who reaches Invisible Shader Graph docs. `/shaders` reads and writes them; the tools whose
 * pickers list custom Element FX (the Scene and Component Editors, Symbols, the Flow) read them.
 */
export const shaderReadScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: 'shaders',
		altTools: ['editor', 'componentEditor', 'symbols', 'flow'],
		forbiddenMessage: 'Your role does not have access to shader effects.',
	});

export const shaderWriteScope = (locals: App.Locals, cookies: Cookies): Promise<ToolScope> =>
	gate(locals, cookies, {
		tool: 'shaders',
		forbiddenMessage: 'Your role does not have access to Invisible Shader Graph.',
	});
