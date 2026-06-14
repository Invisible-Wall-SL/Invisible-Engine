<script lang="ts">
	import { SymbolDebugOverlay } from 'components-pixi';
	import { getContextApp } from 'pixi-svelte';

	import { SYMBOL_INFO_MAP } from '../../game/constants';
	import { getSymbolInfo } from '../../game/utils';
	import { SYMBOL_STATES, type SymbolName, type SymbolState } from '../../game/types';
	import Symbol from '../Symbol.svelte';

	const app = getContextApp();
	const loaded = $derived(app.stateApp.loadedAssets);

	const symbols = Object.keys(SYMBOL_INFO_MAP);
	const states = [...SYMBOL_STATES];

	const infoOf = (name: string, state: string) =>
		getSymbolInfo({ rawSymbol: { name: name as SymbolName }, state: state as SymbolState });

	const resolved = (name: string, state: string) => Boolean(loaded?.[infoOf(name, state).assetKey]);

	const label = (name: string, state: string) => {
		const info = infoOf(name, state);
		return `${name}·${state}\n${info.type}:${info.assetKey}`;
	};
</script>

<SymbolDebugOverlay {symbols} {states} {resolved} {label}>
	{#snippet cell({ name, state })}
		<Symbol rawSymbol={{ name: name as SymbolName }} state={state as SymbolState} />
	{/snippet}
</SymbolDebugOverlay>
