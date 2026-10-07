<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type Props = { children: Snippet };
</script>

<script lang="ts">
	import * as PIXI from 'pixi.js';

	import { getContextRig, setContextRigEventEmitter } from '../context.svelte';

	const props: Props = $props();
	const rig = getContextRig();
	const rigEventEmitter = new PIXI.EventEmitter();

	rig.beforeUpdateWorldTransforms = () => rigEventEmitter.emit('beforeUpdateWorldTransforms');
	rig.afterUpdateWorldTransforms = () => rigEventEmitter.emit('afterUpdateWorldTransforms');

	setContextRigEventEmitter(rigEventEmitter);
</script>

{@render props.children()}
