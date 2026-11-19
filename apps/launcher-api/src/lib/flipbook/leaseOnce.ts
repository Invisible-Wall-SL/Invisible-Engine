import { LeaseState } from '$lib/leaseState.svelte';

import type { ClipLease } from './characterWrites';

/**
 * A doc's edit lease for ONE write from a tab that does not have the doc open (the Characters
 * mode's writes to a clip or to a character's component): taken, and given back by `release`.
 * Someone else holding it answers with their name and nothing is written. A lease that cannot be
 * read is not a refusal, as everywhere (`LeaseState` fails open): the write's ETag is the floor.
 */
export async function leaseOnce(key: {
	toolId: string;
	clientKey: string;
	projectKey: string;
	docKey: string;
}): Promise<ClipLease> {
	const lease = new LeaseState({ ...key, enabled: key.projectKey.length > 0 });
	await lease.start();
	if (lease.readOnly) {
		const by = lease.heldBy?.name ?? lease.heldBy?.email ?? 'Someone else';
		lease.stop();
		return { held: false, by };
	}
	return { held: true, release: () => lease.release() };
}
