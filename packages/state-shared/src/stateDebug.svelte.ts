import type { Component } from 'svelte';

declare const __IE_DEBUG__: boolean;

export type DebugSurface = 'pixi' | 'html';

export type DebugTool = {
	id: string;
	label: string;
	group?: string;
	surface: DebugSurface;
	component: Component;
};

export const stateDebug = $state({
	enabled: typeof __IE_DEBUG__ !== 'undefined' && __IE_DEBUG__,
	tools: [] as DebugTool[],
	active: {} as Record<string, boolean>,
	register(tool: DebugTool) {
		if (stateDebug.tools.some((existing) => existing.id === tool.id)) return;
		stateDebug.tools.push(tool);
	},
	toggle(id: string) {
		stateDebug.active[id] = !stateDebug.active[id];
	},
});

export const registerDebugTool = (tool: DebugTool) => stateDebug.register(tool);
