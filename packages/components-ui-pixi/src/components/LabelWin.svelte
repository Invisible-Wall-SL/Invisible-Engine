<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { Anchor } from 'pixi-svelte';

	import { stateBet } from 'state-shared';
	import { bookEventAmountToCurrencyString } from 'utils-shared/amount';

	import UiLabel from './UiLabel.svelte';
	import { i18nDerived } from '../i18n/i18nDerived';
	import type { UiLabelArgs } from '../types';

	const props: UiLabelArgs = $props();
	const winBookEventAmountTween = new Tween(stateBet.winBookEventAmount);
	const label = $derived(i18nDerived.win());
	const value = $derived(bookEventAmountToCurrencyString(winBookEventAmountTween.current));

	$effect(() => {
		winBookEventAmountTween.set(stateBet.winBookEventAmount);
	});
</script>

<!-- The win meter is where a flight into the total lands (`hud-win`, the reference node's id). -->
<Anchor name="hud-win" />
<UiLabel tiled {label} {value} stacked={props.stacked} style={props.style} text={props.text} />
