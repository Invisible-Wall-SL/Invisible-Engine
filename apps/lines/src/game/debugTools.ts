import { registerDebugTool } from 'state-shared';

import SymbolDebugTool from '../components/debug/SymbolDebugTool.svelte';
import WinStateProbe from '../components/debug/WinStateProbe.svelte';

if (__IE_DEBUG__) {
	registerDebugTool({
		id: 'symbols',
		label: 'Symbol overlay',
		group: 'Rendering',
		surface: 'pixi',
		component: SymbolDebugTool,
	});
	registerDebugTool({
		id: 'winstate',
		label: 'Win-state probe',
		group: 'State',
		surface: 'html',
		component: WinStateProbe,
	});
}
