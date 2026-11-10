import { z } from 'zod';
import { requireTool } from './http';

/**
 * Gate for the /comfyui JSON control endpoints — the same entitlement the /comfyui page enforces
 * (the `comfyui` tool), resolved here since a `+server.ts` has no `parent()`.
 */
export const requireComfyAccess = (locals: App.Locals) => requireTool(locals, 'comfyui', 'ComfyUI');

/** A trimmed, non-empty string field; `message` is its 400 when missing, empty or not a string. */
export const requiredText = (message: string) => z.string({ message }).trim().min(1, message);

/** `{ podId }`, the body of the per-pod actions (Start, Stop, and the image move's first half). */
export const PodBody = z.object(
	{ podId: requiredText('Missing podId.') },
	{ message: 'Expected a JSON object.' },
);
