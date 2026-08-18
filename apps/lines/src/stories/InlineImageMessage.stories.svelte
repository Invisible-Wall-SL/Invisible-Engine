<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'ENGINE-LAYOUT/InfoBar inline symbol image (Invisible Win Text)',
	});
</script>

<script lang="ts">
	import { App } from 'pixi-svelte';
	import { StoryLocale, StoryGameTemplate } from 'components-storybook';
	import { LayoutScene } from 'engine-layout/svelte';
	import {
		registerComponents,
		registerComponentValues,
		clearComponentValues,
		registerBoundComponents,
		registerInlineImageResolver,
		wrapInlineImage,
		INLINE_IMAGE_BOUND_COMPONENT,
		INFO_BAR_DEF,
		type Scene,
		type ValueSource,
	} from 'engine-layout';

	import MessageSymbol from '../components/MessageSymbol.svelte';
	import { setContext } from '../game/context';

	setContext();

	/**
	 * The "show symbol as image" toast (`/win-text` → `toast.symbolAsImage`) rendered through the
	 * Info Bar, in BOTH layout modes — the proof for the boxed one.
	 *
	 * The Info Bar's message is engine-fed and LOCALIZED, so a real bar usually carries a box width
	 * + auto-fit to keep a longer translation inside the plaque art. That box used to route the node
	 * to `<TextBox>`, which strips the sentinel back to the symbol NAME — so the toggle did nothing
	 * on exactly the bars that needed a box. These stories mount the same message with no box, with
	 * a box, and with a box too narrow for it (auto-fit shrinks text AND symbol together).
	 */
	const SYMBOL = 'H4';
	// What `showWinInfoMessage` builds when the toggle is on: the toast template, localized, with
	// `{symbolName}` replaced by the sentinel carrying the symbol id + its NAME as the fallback.
	const richMessage = `You win $4.00 with 4 ${wrapInlineImage(SYMBOL, 'Cowboys')}`;
	// A translation that is longer than the plaque was drawn for — the auto-fit case.
	const longRichMessage = `Vinci 4,00 € con 4 ${wrapInlineImage(SYMBOL, 'Cowboy')} sulla linea 7`;

	const stringSource = (value: string): ValueSource => ({
		subscribe(run) {
			run(value);
			return () => {};
		},
	});

	clearComponentValues();
	registerComponentValues({
		message: stringSource(richMessage),
		longMessage: stringSource(longRichMessage),
	});
	registerComponents({ [INFO_BAR_DEF.id]: INFO_BAR_DEF });
	// What `Game.svelte` wires at boot: the game draws the symbol (sprite / spine / flipbook), the
	// engine only reserves the slot.
	registerBoundComponents({ [INLINE_IMAGE_BOUND_COMPONENT]: MessageSymbol });
	registerInlineImageResolver((token) => (token === SYMBOL ? token : undefined));

	const BOX = { align: 'center', verticalAlign: 'middle', autoFit: true };

	const scene: Scene = {
		id: 'inline-image-message-proof',
		name: 'Inline symbol image',
		nodes: [
			// 1. No box — the original centred row (parity baseline).
			{
				id: 'no-box',
				kind: 'componentInstance',
				componentId: 'infoBar',
				x: 480,
				y: 120,
				params: { source: 'message' },
			},
			// 2. A box the message fits inside: same row, now aligned within the box.
			{
				id: 'boxed',
				kind: 'componentInstance',
				componentId: 'infoBar',
				x: 480,
				y: 240,
				params: { source: 'message', boxWidth: 520, boxHeight: 60, padding: 8, ...BOX },
			},
			// 3. A box the (longer, translated) message does NOT fit: auto-fit shrinks the whole row,
			//    symbol included, instead of spilling past the plaque.
			{
				id: 'boxed-autofit',
				kind: 'componentInstance',
				componentId: 'infoBar',
				x: 480,
				y: 360,
				params: { source: 'longMessage', boxWidth: 380, boxHeight: 60, padding: 8, ...BOX },
			},
		],
	};
</script>

<Story name="symbol renders as an image, boxed and un-boxed">
	<StoryGameTemplate skipLoadingScreen={true} action={async () => {}}>
		<StoryLocale lang="en">
			<App>
				<LayoutScene {scene} />
			</App>
		</StoryLocale>
	</StoryGameTemplate>
</Story>
