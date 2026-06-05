<script lang="ts">
	import { SymbolDebugOverlay } from 'components-pixi';
	import { OnHotkey } from 'components-shared';
	import { getContextApp } from 'pixi-svelte';

	import { SYMBOL_INFO_MAP } from '../game/constants';
	import { SYMBOL_STATES, type SymbolName, type SymbolState } from '../game/types';
	import Symbol from './Symbol.svelte';

	// Gated behind the IE_DEBUG localStorage flag, toggled with the `d` hotkey.
	const ieDebugOn =
		typeof localStorage !== 'undefined' && localStorage.getItem('IE_DEBUG') === '1';

	let show = $state(false);

	const app = getContextApp();
	const loaded = $derived(app.stateApp.loadedAssets);

	const symbols = Object.keys(SYMBOL_INFO_MAP);
	const states = [...SYMBOL_STATES];

	type CellInfo = { type: 'sprite' | 'spine'; assetKey: string };

	const infoOf = (name: string, state: string) =>
		SYMBOL_INFO_MAP[name as SymbolName][state as SymbolState] as CellInfo;

	const resolved = (name: string, state: string) => Boolean(loaded?.[infoOf(name, state).assetKey]);

	const label = (name: string, state: string) => {
		const info = infoOf(name, state);
		return `${name}·${state}\n${info.type}:${info.assetKey}`;
	};
</script>

{#if ieDebugOn}
	<OnHotkey hotkey="d" onpress={() => (show = !show)} />
	{#if show}
		<SymbolDebugOverlay {symbols} {states} {resolved} {label}>
			{#snippet cell({ name, state })}
				<Symbol rawSymbol={{ name: name as SymbolName }} state={state as SymbolState} />
			{/snippet}
		</SymbolDebugOverlay>
	{/if}
{/if}
