<script lang="ts" module>
	import * as RIG from 'engine-rig/pixi';

	export type Props = Partial<RIG.Bone> & {
		boneName: Parameters<RIG.RigView['skeleton']['findBone']>[0];
	};
</script>

<script lang="ts">
	import { propsSyncEffect } from '../utils.svelte';
	import { getContextSpine } from '../context.svelte';

	const props: Props = $props();
	const spine = getContextSpine();
	const bone = spine.skeleton.findBone(props.boneName);

	propsSyncEffect({ props, target: bone, ignore: ['boneName', 'y'] });
	$effect(() => {
		if (bone && props.y !== undefined) bone.y = -props.y;
	});
</script>
