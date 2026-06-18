<script lang="ts" module>
	export type EmitterEventFreeSpinIntro =
		| { type: 'freeSpinIntroShow' }
		| { type: 'freeSpinIntroHide' }
		| { type: 'freeSpinIntroUpdate'; totalFreeSpins: number };
</script>

<script lang="ts">
	import { CanvasSizeRectangle } from 'components-layout';
	import { stateUrlDerived } from 'state-shared';
	import { FadeContainer } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';
	import { getComponentParams } from 'engine-layout/svelte';
	import { BitmapText, Container, SpineProvider, SpineSlot, SpineTrack, Sprite } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE } from '../game/constants';
	import PressToContinue from './PressToContinue.svelte';
	import FreeSpinAnimation from './FreeSpinAnimation.svelte';

	type AnimationName = string;

	// Dual-mode part. Mounted EITHER standalone/direct (the separate "Free-spin intro"
	// scene or a bare `<FreeSpinIntro/>` — props/defaults reproduce the hardcodes) OR as
	// the free-spin counter's UNGATED intro `bind` child (`boundToCounter`, reading
	// `introSpine`/`introAnimation`/`idleAnimation`/`introSlot` off the counter's param
	// context). In the counter-mounted mode it stays INERT until `introSpine` is set, so
	// the bind is parity-safe by default — the owner opts in by setting the counter's
	// intro params + deleting the standalone screen.
	const {
		boundToCounter = false,
		introSpine: introSpineProp = 'fsIntroNumber',
		introAnimation: introAnimationProp = 'intro',
		idleAnimation: idleAnimationProp = 'idle',
		slotName: slotNameProp = 'slot_number',
	}: {
		boundToCounter?: boolean;
		introSpine?: string;
		introAnimation?: string;
		idleAnimation?: string;
		slotName?: string;
	} = $props();

	const context = getContext();

	const stringParam = (key: string): string | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	};
	const numberParam = (key: string): number | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'number' ? value : undefined;
	};

	const introSpine = $derived(
		boundToCounter ? stringParam('introSpine') : (stringParam('introSpine') ?? introSpineProp),
	);
	const introAnimation = $derived(stringParam('introAnimation') ?? introAnimationProp);
	const idleAnimation = $derived(stringParam('idleAnimation') ?? idleAnimationProp);
	const slotName = $derived(stringParam('introSlot') ?? slotNameProp);
	// Counter-mounted intro size: a uniform scale on the local spine container so the
	// owner sizes the intro from the counter (the counter's transform positions it). The
	// spine's base width is the game's symbol pitch — the same constant the standalone
	// path's background width derives from — and `introScale` scales the whole container.
	const introScale = $derived(numberParam('introScale') ?? 1);
	const INTRO_SPINE_WIDTH = SYMBOL_SIZE;

	let show = $state(false);
	let animationName = $state<AnimationName>('intro');
	$effect(() => {
		animationName = introAnimation;
	});
	let freeSpinsFromEvent = $state(0);
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		freeSpinIntroShow: () => (show = true),
		freeSpinIntroHide: () => (show = false),
		freeSpinIntroUpdate: async (emitterEvent) => {
			// INERT guard: an inactive part (`introSpine` unset — the counter's intro child
			// before opt-in) renders no `PressToContinue`, so it must NOT block the
			// `await broadcastAsync` press-gate in `freeSpinTrigger` — return immediately
			// and let the ACTIVE standalone intro own the press. (`broadcastAsync`
			// Promise.all-s every subscriber, so a never-resolving handler would hang.)
			if (!introSpine) return;
			// if (emitterEvent.extraSpins) {
			// 	context.eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_fs_respins' });
			// }
			// freeSpinsFromEvent = emitterEvent.extraSpins ?? emitterEvent.totalFreeSpins;
			freeSpinsFromEvent = emitterEvent.totalFreeSpins;
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

{#if boundToCounter}
	<!-- Counter-mounted mode: render the intro LOCALLY at the component origin (0,0) so
		it sits where the counter instance is placed; the owner sizes it via `introScale`
		and positions it via the counter's transform. NO full-screen `MainContainer`/
		`FreeSpinAnimation` wrapper and NO `CanvasSizeRectangle` dim — just the spine +
		count slot. A full-screen `PressToContinue` still catches the tap so the round's
		`await broadcastAsync({type:'freeSpinIntroUpdate'})` gate resolves. -->
	{#if introSpine}
		<FadeContainer {show}>
			<Container scale={{ x: introScale, y: introScale }}>
				<SpineProvider key={introSpine} width={INTRO_SPINE_WIDTH}>
					<SpineTrack
						trackIndex={0}
						{animationName}
						loop={animationName === idleAnimation}
						listener={{
							complete: () => (animationName = idleAnimation),
						}}
					/>
					<SpineSlot {slotName}>
						<BitmapText
							anchor={{ x: 0.5, y: 0.5 }}
							text={freeSpinsFromEvent}
							style={{
								fontFamily: 'gold',
								fontSize: SYMBOL_SIZE / 3,
								fontWeight: 'bold',
							}}
						/>
					</SpineSlot>
				</SpineProvider>
			</Container>

			<PressToContinue onpress={() => oncomplete()} />
		</FadeContainer>
	{/if}
{:else if introSpine}
	<FadeContainer {show}>
		<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.5} />

		<FreeSpinAnimation>
			{#snippet children({ sizes })}
				<Sprite
					anchor={{ x: 0.5, y: 1.2 }}
					width={500 * 2.2}
					height={156 * 2.2}
					key="freespins_{stateUrlDerived.lang()}.png"
				/>

				<SpineProvider key={introSpine} width={sizes.width * 0.3}>
					<SpineTrack
						trackIndex={0}
						{animationName}
						loop={animationName === idleAnimation}
						listener={{
							complete: () => (animationName = idleAnimation),
						}}
					/>
					<SpineSlot {slotName}>
						<BitmapText
							anchor={{ x: 0.5, y: 0.5 }}
							text={freeSpinsFromEvent}
							style={{
								fontFamily: 'gold',
								fontSize: sizes.width * 0.1,
								fontWeight: 'bold',
							}}
						/>
					</SpineSlot>
				</SpineProvider>

				<Sprite anchor={{ x: 0.5, y: -3 }} width={183 * 2.2} height={42 * 2.2} key="freespins.png" />
			{/snippet}
		</FreeSpinAnimation>

		<PressToContinue onpress={() => oncomplete()} />
	</FadeContainer>
{/if}
