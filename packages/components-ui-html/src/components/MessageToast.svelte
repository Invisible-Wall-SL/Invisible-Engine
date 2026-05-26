<script lang="ts">
	import { zIndex } from 'constants-shared/zIndex';
	import { stateMessage } from 'state-shared';
</script>

{#if stateMessage.current}
	{#key stateMessage.current.id}
		<div class="toast-wrap" style="z-index: {zIndex.info}">
			<div class="toast {stateMessage.current.kind}">
				{stateMessage.current.text}
			</div>
		</div>
	{/key}
{/if}

<style lang="scss">
	.toast-wrap {
		position: absolute;
		top: 6%;
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.toast {
		max-width: 80%;
		padding: 0.55rem 1.2rem;
		border-radius: 999px;
		font-family: var(--font, sans-serif);
		font-size: clamp(13px, 2.2vmin, 20px);
		font-weight: 700;
		letter-spacing: 0.2px;
		color: #fff;
		background: rgba(20, 18, 30, 0.82);
		border: 1px solid rgba(255, 255, 255, 0.16);
		box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		animation: toast-in 0.28s ease-out both;
	}
	.toast.win {
		color: #ffe9a8;
		border-color: rgba(255, 206, 92, 0.55);
		background: rgba(60, 40, 10, 0.86);
	}
	.toast.warn {
		color: #ffd0d0;
		border-color: rgba(255, 90, 90, 0.55);
		background: rgba(70, 18, 18, 0.88);
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(-14px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
</style>
