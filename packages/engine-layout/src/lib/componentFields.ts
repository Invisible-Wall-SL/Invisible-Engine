import type {
	ComponentDef,
	ComponentParam,
	ComponentSignal,
	LayoutNode,
	TemplateSlot,
} from './types';

/**
 * The fields of the component model this build KNOWS, as runtime values: every key of the types,
 * whatever a normalizer then keeps. A save tells a field a NEWER build wrote (unknown here, so a
 * read dropped it and the author never saw it) from one the author cleared (known, so its absence
 * is theirs) by these sets (`docs/conventions/doc-readers.md`, "Round-tripping").
 *
 * Written as `Record<…, true>` objects so the type-check fails in BOTH directions: a field added
 * to a type and missing here, or listed here and not in the type. A field missing here would read
 * as unknown, and every save would put it back after the author cleared it.
 */
type AllKeys<T> = T extends unknown ? keyof T : never;

const fields = (record: Record<string, true>): ReadonlySet<string> => new Set(Object.keys(record));

const layoutNodeFields: Record<AllKeys<LayoutNode>, true> = {
	kind: true,
	children: true,
	width: true,
	height: true,
	id: true,
	label: true,
	x: true,
	y: true,
	anchor: true,
	scale: true,
	coverScale: true,
	rotation: true,
	alpha: true,
	blendMode: true,
	zIndex: true,
	overrides: true,
	visibleFor: true,
	slotId: true,
	fit: true,
	coverFit: true,
	coverBox: true,
	locked: true,
	bind: true,
	screenAnchor: true,
	preview: true,
	paramBindings: true,
	valueBindings: true,
	pressAction: true,
	hiddenUntilSignal: true,
	assetKey: true,
	region: true,
	keepAspect: true,
	tint: true,
	defaultAnimation: true,
	loop: true,
	skin: true,
	cues: true,
	stateAnimations: true,
	revealSymbolBone: true,
	revealSymbolState: true,
	revealSymbolScale: true,
	revealSymbolOffsetX: true,
	revealSymbolOffsetY: true,
	revealSymbolFollowRotation: true,
	revealSymbolFollowScale: true,
	text: true,
	style: true,
	autoFit: true,
	padding: true,
	switchKeys: true,
	color: true,
	componentId: true,
	componentVersion: true,
	params: true,
	stateAnimationOverrides: true,
	spineRestOverrides: true,
	cueSignalOverrides: true,
	reels: true,
	rows: true,
	cellSize: true,
	cellWidth: true,
	cellHeight: true,
	gapX: true,
	gapY: true,
	reelPadding: true,
	rowPadding: true,
	symbolAlignX: true,
	symbolAlignY: true,
	boardNudgeX: true,
	boardNudgeY: true,
	overflowX: true,
	overflowY: true,
	spin: true,
	anticipation: true,
	perspective: true,
	tileRegion: true,
	effectId: true,
	hostSpineId: true,
	clipId: true,
	fps: true,
	direction: true,
	flipX: true,
	flipY: true,
	source: true,
	layout: true,
};
const componentDefFields: Record<keyof ComponentDef, true> = {
	id: true,
	name: true,
	version: true,
	scope: true,
	category: true,
	space: true,
	root: true,
	params: true,
	defaultInstanceParams: true,
	signals: true,
	signalScope: true,
	signalScopeKind: true,
	standsFor: true,
	slots: true,
	capability: true,
};
const componentParamFields: Record<keyof ComponentParam, true> = {
	key: true,
	kind: true,
	default: true,
	engineProvided: true,
	spineParam: true,
	author: true,
	group: true,
	label: true,
	options: true,
	fedParams: true,
};
const componentSignalFields: Record<keyof ComponentSignal, true> = {
	key: true,
	note: true,
};
const templateSlotFields: Record<keyof TemplateSlot, true> = {
	slotId: true,
	name: true,
	kind: true,
	required: true,
	mountComponent: true,
	accepts: true,
};

/** Every key of any {@link LayoutNode} kind (a node may change kind and keep its id). */
export const LAYOUT_NODE_FIELDS = fields(layoutNodeFields);
export const COMPONENT_DEF_FIELDS = fields(componentDefFields);
export const COMPONENT_PARAM_FIELDS = fields(componentParamFields);
export const COMPONENT_SIGNAL_FIELDS = fields(componentSignalFields);
export const TEMPLATE_SLOT_FIELDS = fields(templateSlotFields);
