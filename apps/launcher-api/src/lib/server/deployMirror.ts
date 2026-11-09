import { mapWithConcurrency } from './concurrency';
import { copyObject, deleteObjects, listAllKeys, putObjectText } from './r2';

/**
 * How many independent deploy writes one exporter keeps in flight. The writes are small JSON or
 * R2-side copies, so the cost is round-trip latency; bounded for the reason `concurrency.ts` gives.
 */
export const DEPLOY_WRITE_CONCURRENCY = 8;

/**
 * One exporter's pass over its own `deploy/` subtree: every key it writes is recorded, and
 * {@link commit} deletes whatever else is under the prefix — so the subtree mirrors what this pass
 * shipped, and a deleted or renamed asset does not linger in a game's `static/assets/`.
 *
 * Keys outside the prefix may be recorded (a rig bundle's result lists everything it wrote); only
 * keys LISTED under the prefix are ever candidates for deletion.
 */
export class DeployMirror {
	readonly written = new Set<string>();

	constructor(readonly prefix: string) {}

	/** Write `text` to `key` and keep it. */
	async put(key: string, text: string, contentType = 'application/json'): Promise<void> {
		await putObjectText(key, text, contentType);
		this.written.add(key);
	}

	/** {@link put} each file, `limit` at a time. Each is a distinct key, so order does not matter. */
	async putAll(
		files: readonly { key: string; text: string }[],
		limit = DEPLOY_WRITE_CONCURRENCY,
	): Promise<void> {
		await mapWithConcurrency(files, limit, ({ key, text }) => this.put(key, text));
	}

	/** R2-side copy `srcKey` → `destKey`, kept only when the source existed. */
	async copy(srcKey: string, destKey: string, contentType?: string): Promise<boolean> {
		const copied = await copyObject(srcKey, destKey, contentType);
		if (copied) this.written.add(destKey);
		return copied;
	}

	/** Keep keys something else wrote in this pass (a rig bundle export reports its own). */
	claim(keys: Iterable<string>): void {
		for (const key of keys) this.written.add(key);
	}

	/** Every key under the prefix this pass did not write. */
	async stale(): Promise<string[]> {
		return (await listAllKeys(this.prefix)).filter((k) => !this.written.has(k));
	}

	/** Delete every key under the prefix this pass did not write. */
	async commit(): Promise<void> {
		await deleteObjects(await this.stale());
	}
}
