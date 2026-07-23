<script lang="ts">
	import { ParticleEmitter } from 'pixi-svelte';
	import { fountain as baseConfig } from 'constants-shared/particleConfig';
	import { LEVEL_PARTICLE_COIN_MAP } from 'constants-shared/particleCoin';

	import type { WinLevelAlias } from '../game/winLevelMap';

	type Props = {
		emit?: boolean;
		levelAlias?: WinLevelAlias;
	};

	// The coin fountain of the WIN overlay. Emits from its LOCAL origin (0,0) so it honours the
	// enclosing transform — the positionable `WinVisual` places it at the `win` instance node (or
	// board-centre on the non-bound composer path, where `WinVisual`'s own `MainContainer` +
	// `boardLayout` wrap reproduce the previous hard-centring byte-for-byte).
	const props: Props = $props();
	const extraConfig = $derived(
		props?.levelAlias ? LEVEL_PARTICLE_COIN_MAP[props.levelAlias] : null,
	);
	const config = $derived({ ...baseConfig, ...extraConfig });
</script>

{#if config}
	<ParticleEmitter {config} key="coins" emit={props.emit} />
{/if}
