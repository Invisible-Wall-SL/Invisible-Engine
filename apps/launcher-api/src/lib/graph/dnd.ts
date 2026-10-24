/**
 * The library → canvas drag contract a graph editor's palette and its `GraphCanvas` share. Each
 * editor names its own dataTransfer MIME (never `text/plain`, so an unrelated drag never drops a
 * node) and its own payload; this only carries it across.
 */

/** Put `payload` on a drag under `mime`. */
export function writeDrag(event: DragEvent, mime: string, payload: unknown): void {
	if (!event.dataTransfer) return;
	event.dataTransfer.setData(mime, JSON.stringify(payload));
	event.dataTransfer.effectAllowed = 'move';
}

/** The payload a drop carries under `mime`, when `accept` takes it. */
export function readDrag<T>(
	raw: string | undefined,
	accept: (value: unknown) => value is T,
): T | undefined {
	if (!raw) return undefined;
	try {
		const value: unknown = JSON.parse(raw);
		return accept(value) ? value : undefined;
	} catch {
		return undefined;
	}
}
