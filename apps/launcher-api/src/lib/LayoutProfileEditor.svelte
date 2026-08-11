<script lang="ts">
	import type { LayoutProfile, LayoutBucket } from 'engine-layout';

	let {
		profile = $bindable(),
		onchange,
	}: { profile: LayoutProfile; onchange?: () => void } = $props();

	const touch = () => onchange?.();

	/** Greatest common divisor for a tidy "16:9"-style aspect readout. */
	const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
	const aspectLabel = (w: number, h: number): string => {
		if (!w || !h) return '—';
		const g = gcd(Math.round(w), Math.round(h)) || 1;
		return `${Math.round(w / g)}:${Math.round(h / g)} · ${(w / h).toFixed(2)}`;
	};

	/** A unique bucket id from a label seed (kebab-cased, collision-suffixed). */
	const freshId = (seed: string): string => {
		const base = seed.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bucket';
		let id = base;
		let n = 2;
		while (profile.buckets.some((b) => b.id === id)) id = `${base}-${n++}`;
		return id;
	};

	function addBucket() {
		const id = freshId('bucket');
		profile.buckets.push({ id, label: 'New bucket', box: { width: 1920, height: 1080 }, rule: {} });
		touch();
	}

	function removeBucket(i: number) {
		const removed = profile.buckets[i];
		profile.buckets.splice(i, 1);
		if (profile.fallbackBucketId === removed.id && profile.buckets.length) {
			profile.fallbackBucketId = profile.buckets[profile.buckets.length - 1].id;
		}
		touch();
	}

	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= profile.buckets.length) return;
		const [b] = profile.buckets.splice(i, 1);
		profile.buckets.splice(j, 0, b);
		touch();
	}

	/** Bind an optional numeric rule bound: empty input clears it. */
	function setRule(b: LayoutBucket, key: 'minRatio' | 'maxRatio' | 'minSide' | 'maxSide', raw: string) {
		const v = raw.trim() === '' ? undefined : Number(raw);
		if (v === undefined || !Number.isFinite(v)) delete b.rule[key];
		else b.rule[key] = v;
		touch();
	}
</script>

<div class="lpe">
	<div class="lpe-scroll">
		<table>
			<thead>
				<tr>
					<th class="col-order">Order</th>
					<th>Label</th>
					<th class="col-num">Width</th>
					<th class="col-num">Height</th>
					<th>Aspect</th>
					<th class="col-num" title="window ratio ≥">min ratio</th>
					<th class="col-num" title="window ratio &lt; (half-open)">max ratio</th>
					<th class="col-num" title="min(w,h) ≥">min side</th>
					<th class="col-num" title="min(w,h) ≤">max side</th>
					<th class="col-flag" title="Portrait-style stacked layout">stacked</th>
					<th class="col-flag" title="Selected when no rule matches">fallback</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each profile.buckets as b, i (b.id)}
					<tr>
						<td class="col-order">
							<button type="button" class="mini" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
							<button
								type="button"
								class="mini"
								disabled={i === profile.buckets.length - 1}
								onclick={() => move(i, 1)}>↓</button
							>
						</td>
						<td>
							<input class="lbl" bind:value={b.label} oninput={touch} />
							<div class="idhint mono">{b.id}</div>
						</td>
						<td class="col-num">
							<input type="number" min="1" bind:value={b.box.width} oninput={touch} />
						</td>
						<td class="col-num">
							<input type="number" min="1" bind:value={b.box.height} oninput={touch} />
						</td>
						<td class="aspect mono">{aspectLabel(b.box.width, b.box.height)}</td>
						<td class="col-num">
							<input
								type="number"
								step="0.01"
								placeholder="—"
								value={b.rule.minRatio ?? ''}
								onchange={(e) => setRule(b, 'minRatio', e.currentTarget.value)}
							/>
						</td>
						<td class="col-num">
							<input
								type="number"
								step="0.01"
								placeholder="—"
								value={b.rule.maxRatio ?? ''}
								onchange={(e) => setRule(b, 'maxRatio', e.currentTarget.value)}
							/>
						</td>
						<td class="col-num">
							<input
								type="number"
								step="1"
								placeholder="—"
								value={b.rule.minSide ?? ''}
								onchange={(e) => setRule(b, 'minSide', e.currentTarget.value)}
							/>
						</td>
						<td class="col-num">
							<input
								type="number"
								step="1"
								placeholder="—"
								value={b.rule.maxSide ?? ''}
								onchange={(e) => setRule(b, 'maxSide', e.currentTarget.value)}
							/>
						</td>
						<td class="col-flag">
							<input
								type="checkbox"
								checked={b.stacked === true}
								onchange={(e) => {
									if (e.currentTarget.checked) b.stacked = true;
									else delete b.stacked;
									touch();
								}}
							/>
						</td>
						<td class="col-flag">
							<input
								type="radio"
								name="lpe-fallback"
								checked={profile.fallbackBucketId === b.id}
								onchange={() => {
									profile.fallbackBucketId = b.id;
									touch();
								}}
							/>
						</td>
						<td>
							<button
								type="button"
								class="mini danger"
								disabled={profile.buckets.length <= 1}
								onclick={() => removeBucket(i)}
								title="Remove bucket">✕</button
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div class="lpe-foot">
		<button type="button" class="ghost-btn" onclick={addBucket}>+ Add bucket</button>
		<span class="muted hint">
			Buckets are evaluated top-to-bottom; the <strong>first</strong> whose rule matches the live window
			wins. Leave a rule empty to make a bucket the catch-all (mark it <em>fallback</em> too). Empty rule
			bounds are unbounded. Ratio = width ÷ height; side = the shorter edge in px.
		</span>
	</div>
</div>

<style>
	.lpe {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.lpe-scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.85rem;
	}
	th,
	td {
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid var(--iw-border, rgba(128, 128, 128, 0.25));
		text-align: left;
		vertical-align: middle;
	}
	th {
		font-weight: 600;
		white-space: nowrap;
		opacity: 0.75;
	}
	.col-num {
		width: 5.5rem;
	}
	.col-num input {
		width: 5rem;
	}
	.col-order {
		white-space: nowrap;
		width: 3.5rem;
	}
	.col-flag {
		text-align: center;
		width: 3.5rem;
	}
	input.lbl {
		width: 9rem;
	}
	input[type='number'],
	input.lbl {
		padding: 0.25rem 0.35rem;
	}
	.idhint {
		font-size: 0.68rem;
		opacity: 0.5;
	}
	.aspect {
		white-space: nowrap;
		opacity: 0.8;
	}
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.mini {
		padding: 0.1rem 0.4rem;
		font-size: 0.8rem;
		line-height: 1;
		cursor: pointer;
	}
	.mini:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.mini.danger {
		color: #c0392b;
	}
	.lpe-foot {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-wrap: wrap;
	}
	.hint {
		font-size: 0.75rem;
		max-width: 46rem;
	}
</style>
