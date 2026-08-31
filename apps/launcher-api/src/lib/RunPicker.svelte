<script lang="ts">
	/**
	 * Pick one of N past runs — a thumbnail, the line you recognise it by, and its meta.
	 *
	 * A native `<select>` cannot show a picture, and a list of generated runs is close to
	 * unusable without one: every row renders as the same model/blueprint name plus a count and
	 * an age, which identifies the RECIPE and not the run. The two things that tell runs apart
	 * are what the author asked for and what came out.
	 *
	 * Deliberately generic — it knows nothing about sessions, prompts or R2. The caller maps its
	 * own records into `RunPickerItem`, including deriving the title, so this stays reusable for
	 * any "browse past generations" surface. See `docs/ui-inventory.md` §16.
	 */
	export interface RunPickerItem {
		id: string;
		/** The line an author recognises the run BY — not its type or its recipe. */
		title: string;
		/** Dim second line: counts, age, status. */
		meta?: string;
		/** A picture of what this run produced. Loaded lazily — a long list must not fetch every
		 * render just to be opened. */
		thumb?: string;
		/** Marks a row still working, or one that ended badly. Omit for a plain finished run. */
		state?: 'live' | 'bad';
	}

	let {
		items,
		selected = '',
		onselect,
		placeholder = 'Nothing yet',
		title = 'Pick a run',
	}: {
		items: RunPickerItem[];
		selected?: string;
		onselect: (id: string) => void;
		placeholder?: string;
		title?: string;
	} = $props();

	let open = $state(false);
	const current = $derived(items.find((i) => i.id === selected) ?? null);

	function choose(id: string): void {
		open = false;
		onselect(id);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') open = false;
	}}
/>

<div class="rp">
	<button class="face" {title} aria-expanded={open} onclick={() => (open = !open)}>
		{#if current}
			<span class="th">
				{#if current.thumb}<img src={current.thumb} alt="" />{/if}
			</span>
			<span class="txt">
				<span class="t1">
					{#if current.state}<i class="dot {current.state}"></i>{/if}{current.title}
				</span>
				{#if current.meta}<span class="t2">{current.meta}</span>{/if}
			</span>
		{:else}
			<span class="txt"><span class="t1 dim">{placeholder}</span></span>
		{/if}
		<span class="caret">▾</span>
	</button>

	{#if open}
		<!-- A full-screen backdrop, not a click handler on the list: a popover that only closes on
		     its own clicks stays stuck open the moment the author clicks anything else. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="back" onclick={() => (open = false)}></div>
		<ul class="list">
			{#each items as it (it.id)}
				<li>
					<button class="row" class:sel={it.id === selected} onclick={() => choose(it.id)}>
						<span class="th">
							<!-- Lazy: opening a picker must not pull down every run's render at once. -->
							{#if it.thumb}<img src={it.thumb} alt="" loading="lazy" />{/if}
						</span>
						<span class="txt">
							<span class="t1">
								{#if it.state}<i class="dot {it.state}"></i>{/if}{it.title}
							</span>
							{#if it.meta}<span class="t2">{it.meta}</span>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.rp {
		position: relative;
		min-width: 0;
	}
	.face {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		max-width: 320px;
		min-width: 0;
		text-align: left;
		padding: 4px 8px 4px 4px;
	}
	.caret {
		margin-left: auto;
		font-size: 10px;
		color: #64748b;
		flex: 0 0 auto;
	}
	.th {
		flex: 0 0 auto;
		width: 34px;
		height: 34px;
		border-radius: 4px;
		overflow: hidden;
		background:
			repeating-conic-gradient(#1b2430 0 25%, #141b24 0 50%) 0 0 / 10px 10px,
			#141b24;
	}
	.th img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	/* `min-width: 0` on both the flex child AND the block: without it a long title refuses to
	   shrink below its content and widens the whole control instead of ellipsing. */
	.txt {
		display: block;
		min-width: 0;
		flex: 1 1 auto;
	}
	.t1,
	.t2 {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.t1 {
		font-size: 12px;
		color: #cbd5e1;
	}
	.t2 {
		font-size: 10px;
		color: #64748b;
	}
	.dim {
		color: #64748b;
	}
	.dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		margin-right: 5px;
		vertical-align: middle;
	}
	.dot.live {
		background: #4ade80;
	}
	.dot.bad {
		background: #f87171;
	}
	.back {
		position: fixed;
		inset: 0;
		z-index: 40;
	}
	.list {
		position: absolute;
		z-index: 41;
		top: calc(100% + 4px);
		left: 0;
		width: max(100%, 320px);
		max-height: 420px;
		overflow-y: auto;
		margin: 0;
		padding: 4px;
		list-style: none;
		background: #0f151d;
		border: 1px solid #24405d;
		border-radius: 8px;
		box-shadow: 0 12px 30px #000a;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		text-align: left;
		padding: 4px;
		border-color: transparent;
		background: transparent;
	}
	.row:hover {
		background: #16202c;
	}
	.row.sel {
		background: #1d3350;
	}
</style>
