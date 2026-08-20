<script lang="ts">
	import { type Snippet } from 'svelte';
	import { GlobalStyle } from 'components-ui-html';
	import { Authenticate, BootSplashSequence, LoadI18n } from 'components-shared';
	import Game from '../components/Game.svelte';
	import { setContext } from '../game/context';
	import { bootSplashAssetBase } from '../editor-scenes';

	import { getMessagesMap } from '../i18n/messagesMap';

	type Props = { children: Snippet };

	const props: Props = $props();

	setContext();
</script>

<GlobalStyle>
	<Authenticate>
		<LoadI18n messagesMap={getMessagesMap()}>
			<Game />
		</LoadI18n>
	</Authenticate>
</GlobalStyle>

<BootSplashSequence assetBase={bootSplashAssetBase()} />

{@render props.children()}
