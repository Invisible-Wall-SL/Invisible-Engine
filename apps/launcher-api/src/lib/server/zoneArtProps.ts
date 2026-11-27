import { ROOM_LEVELS_MAX } from 'engine-mechanics/src/onlineGenerators.js';
import {
	compilePropShape,
	PropShapeError,
	type PropShape,
} from 'engine-mechanics/src/propShape.js';
import {
	normalizeOnlineProps,
	zoneArtComponentRoots,
	zoneArtPropKind,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import type { ComponentDef } from 'engine-layout';

/**
 * THE COMPILE STEP OF THE PROP SHIP CHAIN (`docs/design/arcade-prop-components.md` §6 step 3): on a
 * config save, every zone family drawn by a prop component (`arcade.zoneArt[family].source.kind`
 * `'component'`) has the component's collider at its PINNED version compiled (`engine-mechanics`
 * `compilePropShape`) into `arcade.online.props[family]`, stamped `from: { component, version }`.
 * The room plays that block and never sees the def. The props are the zone art's: a family no
 * component draws has none (a pasted entry for it is dropped, and said). A def that is missing, is
 * not a prop, is of another zone kind or does not compile adds no collider (the family plays
 * today's rule) and is said; a pin older than the def's latest version is said too (the author
 * re-pins by choosing it: §8 Q2). Pure but for `load`, so `check:zone-art` runs it on the real
 * compile with a stub store.
 */

/** Reads a component def: the pinned `version`, or the latest when it is absent. */
export type LoadComponent = (id: string, version?: number) => Promise<ComponentDef | undefined>;

const warning = (path: string, message: string): GameConfigIssue => ({
	severity: 'warning',
	path,
	message,
});

/** `doc` with its online props compiled from its zone art's components, and what was said. */
export async function compileZoneArtProps(
	doc: GameConfigDoc,
	load: LoadComponent,
): Promise<{ doc: GameConfigDoc; warnings: GameConfigIssue[] }> {
	const online = doc.arcade?.online;
	const roots = zoneArtComponentRoots(doc);
	if (!online || (!roots.length && !online.props)) return { doc, warnings: [] };
	const warnings: GameConfigIssue[] = [];
	const props: Record<string, PropShape> = {};
	for (const { family, component, version } of roots) {
		const at = `arcade.zoneArt.${family}.source`;
		const def = await load(component, version);
		if (!def || def.version !== version) {
			warnings.push(
				warning(
					at,
					`"${component}" v${version} is not in this project, so ${family} plays today's rule.`,
				),
			);
			continue;
		}
		if (!def.prop || def.prop.zoneKind !== zoneArtPropKind(family)) {
			warnings.push(
				warning(
					at,
					`"${component}" is not a ${zoneArtPropKind(family)} prop, so ${family} plays today's rule.`,
				),
			);
			continue;
		}
		try {
			props[family] = compilePropShape(def as Parameters<typeof compilePropShape>[0]);
		} catch (e) {
			const errors = e instanceof PropShapeError ? e.errors.join(' ') : String(e);
			warnings.push(
				warning(at, `"${component}" v${version}'s collider cannot be played: ${errors}`),
			);
			continue;
		}
		const latest = await load(component);
		if (latest && latest.version > version)
			warnings.push(
				warning(
					at,
					`"${component}" has a newer version (v${latest.version}); this game plays v${version} until you choose it.`,
				),
			);
	}
	for (const family of Object.keys(online.props ?? {}))
		if (!(family in props) && !roots.some((r) => r.family === family))
			warnings.push(
				warning(
					`arcade.online.props.${family}`,
					`No component draws ${family} (Zone art), so this collider is dropped.`,
				),
			);
	let compiled = normalizeOnlineProps(props);
	// A room sends its props whole to every device (`roomLevelState`): props too long to send are
	// none, or each device would be refused. The caps make this unreachable for one family each.
	if (compiled && JSON.stringify(compiled).length > ROOM_LEVELS_MAX) {
		warnings.push(
			warning(
				'arcade.online.props',
				`The colliders are too long for a room to send (over ${ROOM_LEVELS_MAX} characters), so every family plays today's rule: draw fewer families with components.`,
			),
		);
		compiled = undefined;
	}
	const next: GameConfigDoc = structuredClone(doc);
	const nextOnline = next.arcade!.online!;
	if (compiled) nextOnline.props = compiled;
	else delete nextOnline.props;
	return { doc: next, warnings };
}
