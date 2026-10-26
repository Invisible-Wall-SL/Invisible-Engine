import type {
	ComponentDef,
	ComponentEvent,
	ComponentInput,
	ComponentParam,
	ComponentSignal,
	ComponentStateMachine,
	LayoutNode,
	NodeListener,
	SmEnterAction,
	SmLayer,
	SmState,
	SmTransition,
	TemplateSlot,
} from 'engine-layout';

/**
 * The fields of the component model this build KNOWS, as runtime values: every key of the
 * engine-layout types, whatever a normalizer then keeps. Launcher-only, so no game bundle carries
 * them. A save tells a field a NEWER build wrote (unknown here, so a read dropped it and the
 * author never saw it) from one the author cleared (known, so its absence is theirs) by these sets
 * (`docs/conventions/doc-readers.md`, "Round-tripping").
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
	rigSlot: true,
	on: true,
	elementFx: true,
	assetKey: true,
	boardFit: true,
	region: true,
	keepAspect: true,
	slice: true,
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
	borderRadius: true,
	borderWidth: true,
	borderColor: true,
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
	count: true,
	variants: true,
	passInputs: true,
	previewInputs: true,
	spawnable: true,
	placement: true,
	grid: true,
	cap: true,
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
	internal: true,
	inputs: true,
	stateMachine: true,
	frameExact: true,
	boardAnchored: true,
	buttonStates: true,
	settles: true,
	events: true,
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
const componentInputFields: Record<keyof ComponentInput, true> = {
	id: true,
	kind: true,
	default: true,
	source: true,
	note: true,
};
const stateMachineFields: Record<keyof ComponentStateMachine, true> = { layers: true };
const smLayerFields: Record<keyof SmLayer, true> = {
	id: true,
	name: true,
	entry: true,
	states: true,
	transitions: true,
	pseudoPos: true,
	disabled: true,
};
const smStateFields: Record<keyof SmState, true> = {
	id: true,
	name: true,
	timeline: true,
	speed: true,
	loop: true,
	offsetParam: true,
	randomStart: true,
	pos: true,
	onEnter: true,
	onExit: true,
};
const componentEventFields: Record<keyof ComponentEvent, true> = {
	id: true,
	payload: true,
	note: true,
};
const eventPayloadFields: Record<keyof NonNullable<ComponentEvent['payload']>[number], true> = {
	name: true,
	type: true,
	description: true,
	optional: true,
};
const nodeListenerFields: Record<keyof NodeListener, true> = {
	id: true,
	event: true,
	action: true,
	swipe: true,
};
const smEnterActionFields: Record<keyof SmEnterAction, true> = {
	id: true,
	kind: true,
	event: true,
	payload: true,
};
const smTransitionFields: Record<keyof SmTransition, true> = {
	id: true,
	from: true,
	to: true,
	conditions: true,
	exitTime: true,
	blend: true,
	ease: true,
	pauseSource: true,
	allowExit: true,
	disabled: true,
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
export const COMPONENT_INPUT_FIELDS = fields(componentInputFields);
export const COMPONENT_EVENT_FIELDS = fields(componentEventFields);
export const EVENT_PAYLOAD_FIELDS = fields(eventPayloadFields);
export const NODE_LISTENER_FIELDS = fields(nodeListenerFields);
export const SM_ENTER_ACTION_FIELDS = fields(smEnterActionFields);
export const STATE_MACHINE_FIELDS = fields(stateMachineFields);
export const SM_LAYER_FIELDS = fields(smLayerFields);
export const SM_STATE_FIELDS = fields(smStateFields);
export const SM_TRANSITION_FIELDS = fields(smTransitionFields);
