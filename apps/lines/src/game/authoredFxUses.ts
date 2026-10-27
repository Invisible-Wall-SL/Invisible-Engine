import { isCameraEffectKind, type CameraEffectKind } from 'constants-shared/camera';
import { isPlayableElementFxKind, type ElementFxKindId } from 'constants-shared/elementFx';

/** One authored Element FX use: its kind and the params it plays with. */
export interface ElementFxUse {
	kind: ElementFxKindId;
	params?: Readonly<Record<string, unknown>>;
}

export interface AuthoredFxUses {
	elementFx: ElementFxUse[];
	camera: CameraEffectKind[];
}

/**
 * Every Element FX and camera effect the game's docs can play, wherever they are authored: a
 * node's, screen's or the reels' `elementFx` entries, a symbol state's, a component's, a Flow or
 * cinematic step's. They share one shape (an object whose `kind` names the effect), so one walk of
 * the raw docs finds them all, and a doc shape added later is covered without a change here. A kind
 * neither vocabulary knows (a layout node's `sprite`) is not a use. A flow step carries its colour
 * as `color`, an entry its params as `params`. A Flow v2 node names its kind in a literal input
 * (`{ kind: 'literal', value: 'chromaticWobble' }`), which counts as a use with default params.
 *
 * Distinct by kind and params: the same kind with other params can need another program (a glow's
 * distance is compiled into it).
 */
export function authoredFxUses(data: unknown): AuthoredFxUses {
	const elementFx = new Map<string, ElementFxUse>();
	const camera = new Set<CameraEffectKind>();
	const seen = new Set<object>();
	const walk = (value: unknown): void => {
		if (!value || typeof value !== 'object' || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		const record = value as Record<string, unknown>;
		const kind =
			record.kind === 'literal' && typeof record.value === 'string' ? record.value : record.kind;
		if (isPlayableElementFxKind(kind)) {
			const params =
				record.kind === 'literal'
					? undefined
					: record.params && typeof record.params === 'object'
						? (record.params as Record<string, unknown>)
						: typeof record.color === 'string'
							? { color: record.color }
							: undefined;
			const key = `${kind} ${JSON.stringify(params ?? null)}`;
			if (!elementFx.has(key)) elementFx.set(key, params ? { kind, params } : { kind });
		}
		if (isCameraEffectKind(kind)) camera.add(kind);
		for (const item of Object.values(record)) walk(item);
	};
	walk(data);
	return { elementFx: [...elementFx.values()], camera: [...camera] };
}
