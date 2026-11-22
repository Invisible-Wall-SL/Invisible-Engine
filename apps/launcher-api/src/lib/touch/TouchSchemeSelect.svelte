<script lang="ts">
	/**
	 * The touch control scheme an online class is given (`arcade.online.touch.characters`): None,
	 * or one of the project's schemes. Game Config's Mouse and touch card and Invisible
	 * Characters' Online class card both render it and write the pick with the same setter
	 * (`routes/(app)/config/touchDoc.ts` `setClassTouchScheme`). It has no style of its own: each
	 * host gives it its selects' look.
	 */
	import type { GameConfigDoc } from 'game-config';
	import { classTouchScheme, touchSchemeNames } from './touchSchemeText';

	interface Props {
		/** The config as the page holds it. */
		doc: GameConfigDoc;
		classId: string;
		disabled?: boolean;
		/** The scheme picked, by name; empty for None. */
		onpick: (name: string) => void;
	}
	const { doc, classId, disabled = false, onpick }: Props = $props();
</script>

<select
	data-class-touch={classId}
	aria-label="Touch scheme of {classId}"
	value={classTouchScheme(doc, classId)}
	{disabled}
	onchange={(e) => onpick(e.currentTarget.value)}
>
	<option value="">None</option>
	{#each touchSchemeNames(doc) as name (name)}
		<option value={name}>{name}</option>
	{/each}
</select>
