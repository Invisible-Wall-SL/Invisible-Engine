import {
	buttonBindToInstance,
	isHudButtonBind,
	isHudLabelBind,
	labelBindToInstance,
} from './buttonConvert';
import type { ContainerNode, LayoutDoc, LayoutNode, Scene } from './types';

/**
 * Load-time fallback that keeps a project's HUD RENDERABLE in every path (§ default-HUD
 * initiative). The reference `hudBar` scene's balance/win/bet labels + button cluster are
 * seeded, by default, as coded `bind` nodes (`UiLabelBalance` … `UiButtonIncrease`). Those
 * names are NOT registered bound components — the coded `<UI>` chrome is their ONLY renderer,
 * and it draws them from the scene's POSITIONS while mounting the widgets itself. That's fine
 * for a coded game, but a flow-v2-driven game suppresses the coded `<UI>` (`de772aec`, to stop
 * a double-mount) and makes `<FlowV2Mount>` the sole scene renderer — which mounts those `bind`
 * nodes as EMPTY containers (nothing resolves `getBoundComponent('UiButtonMenu')`), so the whole
 * bottom bar goes blank.
 *
 * This rewrites each such legacy coded HUD node into its parametric `componentInstance`
 * equivalent (`hudReadout` for a label, `button` for a button) — the SAME conversion the editor's
 * "Convert to parametric" affordance does, preserving the node transform byte-for-byte
 * ({@link buttonBindToInstance} / {@link labelBindToInstance}). The parametric HUD renders through
 * the generic mounter, so it shows in BOTH the coded and the flow-v2 paths — the parametric HUD is
 * the go-forward default (the coded `<UI>` HUD is slated for retirement).
 *
 * Runs in memory at doc load ({@link loadEditorScenes}) — no project re-save — so every existing
 * project self-heals. PARITY: a doc already seeded parametric (new projects: `readouts`/`buttons`
 * on) has no convertible node, so the SAME `doc` object is returned unchanged. Scope is the
 * `hudBar` scene's own nodes; a fully-authored `hud_*` replacement HUD is untouched (it renders its
 * own chrome), and the `hudCorners` logo/game-name binds have no parametric target yet (follow-up).
 */
export function normalizeHudScenes(doc: LayoutDoc): LayoutDoc {
	const index = doc.scenes.findIndex((scene) => scene.id === 'hudBar');
	if (index === -1) return doc;
	const scene = doc.scenes[index];

	let changed = false;
	const nodes: LayoutNode[] = scene.nodes.map((node) => {
		if (node.kind !== 'container') return node;
		const component = node.bind?.component;
		if (isHudButtonBind(component)) {
			const converted = buttonBindToInstance(node as ContainerNode);
			if (converted) {
				changed = true;
				return converted;
			}
		} else if (isHudLabelBind(component)) {
			const converted = labelBindToInstance(node as ContainerNode);
			if (converted) {
				changed = true;
				return converted;
			}
		}
		return node;
	});
	if (!changed) return doc;

	const nextScene: Scene = { ...scene, nodes };
	const scenes = doc.scenes.slice();
	scenes[index] = nextScene;
	return { ...doc, scenes };
}
