import { registerDebugTool } from 'state-shared';

import SymbolDebugTool from '../components/debug/SymbolDebugTool.svelte';

if (__IE_DEBUG__) {
	registerDebugTool({
		id: 'symbols',
		label: 'Symbol overlay',
		group: 'Rendering',
		surface: 'pixi',
		component: SymbolDebugTool,
	});
}
