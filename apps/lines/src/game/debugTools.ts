import { registerDebugTool } from 'state-shared';

import SymbolDebugTool from '../components/debug/SymbolDebugTool.svelte';
import WinStateProbe from '../components/debug/WinStateProbe.svelte';
import RgsConnectionReconnectingPreview from '../components/debug/RgsConnectionReconnectingPreview.svelte';
import RgsConnectionFailedPreview from '../components/debug/RgsConnectionFailedPreview.svelte';

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
	registerDebugTool({
		id: 'rgs-reconnecting',
		label: 'Connection: reconnecting',
		group: 'State',
		surface: 'html',
		component: RgsConnectionReconnectingPreview,
	});
	registerDebugTool({
		id: 'rgs-failed',
		label: 'Connection: lost',
		group: 'State',
		surface: 'html',
		component: RgsConnectionFailedPreview,
	});
}
