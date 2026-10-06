import {
	Animation,
	AttachmentTimeline,
	DrawOrderTimeline,
	EventTimeline,
	MixBlend,
	MixDirection,
	RotateTimeline,
	Timeline,
} from './animation';
import { signum } from './math';
import type { SkeletonData } from './data';
import type { Skeleton } from './skeleton';
import type { Slot } from './slot';
import type { Event } from './event';

/** Timeline mixing modes, decided per timeline when the set of playing animations changes. */
const SUBSEQUENT = 0;
const FIRST = 1;
const HOLD_SUBSEQUENT = 2;
const HOLD_FIRST = 3;
const HOLD_MIX = 4;

/** Slot attachment states, offset from the state's rolling `unkeyedState`. */
const SETUP = 1;
const CURRENT = 2;

export interface AnimationStateListener {
	start?(entry: TrackEntry): void;
	interrupt?(entry: TrackEntry): void;
	end?(entry: TrackEntry): void;
	dispose?(entry: TrackEntry): void;
	complete?(entry: TrackEntry): void;
	event?(entry: TrackEntry, event: Event): void;
}

export abstract class AnimationStateAdapter implements AnimationStateListener {
	start(_entry: TrackEntry): void {}
	interrupt(_entry: TrackEntry): void {}
	end(_entry: TrackEntry): void {}
	dispose(_entry: TrackEntry): void {}
	complete(_entry: TrackEntry): void {}
	event(_entry: TrackEntry, _event: Event): void {}
}

export enum EventType {
	start = 0,
	interrupt = 1,
	end = 2,
	dispose = 3,
	complete = 4,
	event = 5,
}

/** Mix durations between pairs of animations. */
export class AnimationStateData {
	animationToMixTime: Record<string, number> = {};
	defaultMix = 0;

	constructor(public skeletonData: SkeletonData) {
		if (!skeletonData) throw new Error('skeletonData cannot be null.');
	}

	setMix(fromName: string, toName: string, duration: number): void {
		const from = this.skeletonData.findAnimation(fromName);
		if (!from) throw new Error('Animation not found: ' + fromName);
		const to = this.skeletonData.findAnimation(toName);
		if (!to) throw new Error('Animation not found: ' + toName);
		this.setMixWith(from, to, duration);
	}

	setMixWith(from: Animation, to: Animation, duration: number): void {
		this.animationToMixTime[from.name + '.' + to.name] = duration;
	}

	getMix(from: Animation, to: Animation): number {
		const value = this.animationToMixTime[from.name + '.' + to.name];
		return value === undefined ? this.defaultMix : value;
	}
}

/** One animation queued or playing on a track. */
export class TrackEntry {
	animation: Animation | null = null;
	previous: TrackEntry | null = null;
	next: TrackEntry | null = null;
	mixingFrom: TrackEntry | null = null;
	mixingTo: TrackEntry | null = null;
	listener: AnimationStateListener | null = null;
	trackIndex = 0;
	loop = false;
	holdPrevious = false;
	reverse = false;
	shortestRotation = false;
	eventThreshold = 0;
	mixAttachmentThreshold = 0;
	alphaAttachmentThreshold = 0;
	mixDrawOrderThreshold = 0;
	animationStart = 0;
	animationEnd = 0;
	animationLast = 0;
	nextAnimationLast = 0;
	delay = 0;
	trackTime = 0;
	trackLast = 0;
	nextTrackLast = 0;
	trackEnd = 0;
	timeScale = 0;
	alpha = 0;
	mixTime = 0;
	_mixDuration = 0;
	interruptAlpha = 0;
	totalAlpha = 0;
	mixBlend = MixBlend.replace;
	timelineMode: number[] = [];
	timelineHoldMix: Array<TrackEntry | null> = [];
	timelinesRotation: number[] = [];

	get mixDuration(): number {
		return this._mixDuration;
	}

	set mixDuration(duration: number) {
		this._mixDuration = duration;
	}

	/** Sets the mix duration and, when `delay` is given, a delay measured as `addAnimation` does. */
	setMixDurationWithDelay(mixDuration: number, delay: number): void {
		this._mixDuration = mixDuration;
		if (delay <= 0) {
			delay = this.previous
				? Math.max(delay + this.previous.getTrackComplete() - mixDuration, 0)
				: 0;
		}
		this.delay = delay;
	}

	setMixDuration(mixDuration: number, delay?: number): void {
		if (delay === undefined) this._mixDuration = mixDuration;
		else this.setMixDurationWithDelay(mixDuration, delay);
	}

	reset(): void {
		this.next = null;
		this.previous = null;
		this.mixingFrom = null;
		this.mixingTo = null;
		this.animation = null;
		this.listener = null;
		this.timelineMode.length = 0;
		this.timelineHoldMix.length = 0;
		this.timelinesRotation.length = 0;
	}

	/** Time within the animation, wrapped when looping. */
	getAnimationTime(): number {
		if (this.loop) {
			const duration = this.animationEnd - this.animationStart;
			if (duration === 0) return this.animationStart;
			return (this.trackTime % duration) + this.animationStart;
		}
		return Math.min(this.trackTime + this.animationStart, this.animationEnd);
	}

	setAnimationLast(animationLast: number): void {
		this.animationLast = animationLast;
		this.nextAnimationLast = animationLast;
	}

	isComplete(): boolean {
		return this.trackTime >= this.animationEnd - this.animationStart;
	}

	resetRotationDirections(): void {
		this.timelinesRotation.length = 0;
	}

	/** Track time at which the current loop (or the animation) completes. */
	getTrackComplete(): number {
		const duration = this.animationEnd - this.animationStart;
		if (duration !== 0) {
			if (this.loop) return duration * (1 + ((this.trackTime / duration) | 0));
			if (this.trackTime < duration) return duration;
		}
		return this.trackTime;
	}

	wasApplied(): boolean {
		return this.nextTrackLast !== -1;
	}

	isNextReady(): boolean {
		return this.next !== null && this.nextTrackLast - this.next.delay >= 0;
	}
}

type QueuedEvent =
	| { type: EventType.event; entry: TrackEntry; event: Event }
	| { type: Exclude<EventType, EventType.event>; entry: TrackEntry };

class EventQueue {
	objects: QueuedEvent[] = [];
	drainDisabled = false;

	constructor(private readonly state: AnimationState) {}

	private push(type: Exclude<EventType, EventType.event>, entry: TrackEntry): void {
		this.objects.push({ type, entry });
		this.state.animationsChanged = true;
	}

	start(entry: TrackEntry): void {
		this.push(EventType.start, entry);
	}

	interrupt(entry: TrackEntry): void {
		this.objects.push({ type: EventType.interrupt, entry });
	}

	end(entry: TrackEntry): void {
		this.push(EventType.end, entry);
	}

	dispose(entry: TrackEntry): void {
		this.objects.push({ type: EventType.dispose, entry });
	}

	complete(entry: TrackEntry): void {
		this.objects.push({ type: EventType.complete, entry });
	}

	event(entry: TrackEntry, event: Event): void {
		this.objects.push({ type: EventType.event, entry, event });
	}

	drain(): void {
		if (this.drainDisabled) return;
		this.drainDisabled = true;
		const objects = this.objects;
		const listeners = this.state.listeners;
		for (let i = 0; i < objects.length; i++) {
			const item = objects[i];
			const entry = item.entry;
			const own = entry.listener;
			switch (item.type) {
				case EventType.start:
					own?.start?.(entry);
					for (let k = 0; k < listeners.length; k++) listeners[k].start?.(entry);
					break;
				case EventType.interrupt:
					own?.interrupt?.(entry);
					for (let k = 0; k < listeners.length; k++) listeners[k].interrupt?.(entry);
					break;
				case EventType.end:
					own?.end?.(entry);
					for (let k = 0; k < listeners.length; k++) listeners[k].end?.(entry);
					entry.listener?.dispose?.(entry);
					for (let k = 0; k < listeners.length; k++) listeners[k].dispose?.(entry);
					entry.reset();
					break;
				case EventType.dispose:
					own?.dispose?.(entry);
					for (let k = 0; k < listeners.length; k++) listeners[k].dispose?.(entry);
					entry.reset();
					break;
				case EventType.complete:
					own?.complete?.(entry);
					for (let k = 0; k < listeners.length; k++) listeners[k].complete?.(entry);
					break;
				case EventType.event:
					own?.event?.(entry, item.event);
					for (let k = 0; k < listeners.length; k++) listeners[k].event?.(entry, item.event);
					break;
			}
		}
		this.clear();
		this.drainDisabled = false;
	}

	clear(): void {
		this.objects.length = 0;
	}
}

/** Plays animations on tracks, crossfading between them, and applies the result to a skeleton. */
export class AnimationState {
	private static readonly EMPTY = new Animation('<empty>', [], 0);

	static emptyAnimation(): Animation {
		return AnimationState.EMPTY;
	}

	tracks: Array<TrackEntry | null> = [];
	timeScale = 1;
	unkeyedState = 0;
	events: Event[] = [];
	listeners: AnimationStateListener[] = [];
	queue: EventQueue;
	propertyIDs = new Set<string>();
	animationsChanged = false;

	constructor(public data: AnimationStateData) {
		this.queue = new EventQueue(this);
	}

	/** Advances every track by `delta` seconds (scaled), handling delays, queued entries and mix ends. */
	update(delta: number): void {
		delta *= this.timeScale;
		const tracks = this.tracks;
		for (let i = 0; i < tracks.length; i++) {
			const current = tracks[i];
			if (!current) continue;
			current.animationLast = current.nextAnimationLast;
			current.trackLast = current.nextTrackLast;
			let currentDelta = delta * current.timeScale;
			if (current.delay > 0) {
				current.delay -= currentDelta;
				if (current.delay > 0) continue;
				currentDelta = -current.delay;
				current.delay = 0;
			}
			let next = current.next;
			if (next) {
				const nextTime = current.trackLast - next.delay;
				if (nextTime >= 0) {
					next.delay = 0;
					next.trackTime +=
						current.timeScale === 0 ? 0 : (nextTime / current.timeScale + delta) * next.timeScale;
					current.trackTime += currentDelta;
					this.setCurrent(i, next, true);
					while (next.mixingFrom) {
						next.mixTime += delta;
						next = next.mixingFrom;
					}
					continue;
				}
			} else if (current.trackLast >= current.trackEnd && !current.mixingFrom) {
				tracks[i] = null;
				this.queue.end(current);
				this.clearNext(current);
				continue;
			}
			if (current.mixingFrom && this.updateMixingFrom(current, delta)) {
				let from: TrackEntry | null = current.mixingFrom;
				current.mixingFrom = null;
				if (from) from.mixingTo = null;
				while (from) {
					this.queue.end(from);
					from = from.mixingFrom;
				}
			}
			current.trackTime += currentDelta;
		}
		this.queue.drain();
	}

	/** Returns true when every entry mixing out under `to` is done. */
	private updateMixingFrom(to: TrackEntry, delta: number): boolean {
		const from = to.mixingFrom;
		if (!from) return true;
		const finished = this.updateMixingFrom(from, delta);
		from.animationLast = from.nextAnimationLast;
		from.trackLast = from.nextTrackLast;
		if (to.nextTrackLast !== -1 && to.mixTime >= to.mixDuration) {
			if (from.totalAlpha === 0 || to.mixDuration === 0) {
				to.mixingFrom = from.mixingFrom;
				if (from.mixingFrom) from.mixingFrom.mixingTo = to;
				to.interruptAlpha = from.interruptAlpha;
				this.queue.end(from);
			}
			return finished;
		}
		from.trackTime += delta * from.timeScale;
		to.mixTime += delta;
		return false;
	}

	/** Poses the skeleton from every track. Returns true when any track was applied. */
	apply(skeleton: Skeleton): boolean {
		if (!skeleton) throw new Error('skeleton cannot be null.');
		if (this.animationsChanged) this.onAnimationsChanged();
		const events = this.events;
		const tracks = this.tracks;
		let applied = false;
		for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
			const current = tracks[trackIndex];
			if (!current || current.delay > 0) continue;
			const animation = current.animation;
			if (!animation) continue;
			applied = true;
			const blend = trackIndex === 0 ? MixBlend.first : current.mixBlend;

			let alpha = current.alpha;
			if (current.mixingFrom) alpha *= this.applyMixingFrom(current, skeleton, blend);
			else if (current.trackTime >= current.trackEnd && !current.next) alpha = 0;
			let attachments = alpha >= current.alphaAttachmentThreshold;

			const animationLast = current.animationLast;
			const animationTime = current.getAnimationTime();
			let applyTime = animationTime;
			let applyEvents: Event[] | null = events;
			if (current.reverse) {
				applyTime = animation.duration - applyTime;
				applyEvents = null;
			}
			const timelines = animation.timelines;
			const count = timelines.length;
			if ((trackIndex === 0 && alpha === 1) || blend === MixBlend.add) {
				if (trackIndex === 0) attachments = true;
				for (const timeline of timelines) {
					if (timeline instanceof AttachmentTimeline)
						this.applyAttachmentTimeline(timeline, skeleton, applyTime, blend, attachments);
					else
						timeline.apply(
							skeleton,
							animationLast,
							applyTime,
							applyEvents,
							alpha,
							blend,
							MixDirection.mixIn,
						);
				}
			} else {
				const modes = current.timelineMode;
				const shortestRotation = current.shortestRotation;
				const firstFrame = !shortestRotation && current.timelinesRotation.length !== count << 1;
				if (firstFrame) current.timelinesRotation.length = count << 1;
				for (let ii = 0; ii < count; ii++) {
					const timeline = timelines[ii];
					const timelineBlend = modes[ii] === SUBSEQUENT ? blend : MixBlend.setup;
					if (!shortestRotation && timeline instanceof RotateTimeline)
						this.applyRotateTimeline(
							timeline,
							skeleton,
							applyTime,
							alpha,
							timelineBlend,
							current.timelinesRotation,
							ii << 1,
							firstFrame,
						);
					else if (timeline instanceof AttachmentTimeline)
						this.applyAttachmentTimeline(timeline, skeleton, applyTime, blend, attachments);
					else
						timeline.apply(
							skeleton,
							animationLast,
							applyTime,
							applyEvents,
							alpha,
							timelineBlend,
							MixDirection.mixIn,
						);
				}
			}
			this.queueEvents(current, animationTime);
			events.length = 0;
			current.nextAnimationLast = animationTime;
			current.nextTrackLast = current.trackTime;
		}

		// Slots whose attachment was keyed only by animations mixing out (or before their first key)
		// go back to the setup attachment.
		const setupState = this.unkeyedState + SETUP;
		for (const slot of skeleton.slots) {
			if (slot.attachmentState === setupState) {
				const name = slot.data.attachmentName;
				slot.setAttachment(name ? skeleton.getAttachment(slot.data.index, name) : null);
			}
		}
		this.unkeyedState += 2;
		this.queue.drain();
		return applied;
	}

	/** Applies the entries `to` is mixing from, returning `to`'s mix percentage. */
	private applyMixingFrom(to: TrackEntry, skeleton: Skeleton, blend: MixBlend): number {
		const from = to.mixingFrom as TrackEntry;
		if (from.mixingFrom) this.applyMixingFrom(from, skeleton, blend);
		let mix: number;
		if (to.mixDuration === 0) {
			mix = 1;
			if (blend === MixBlend.first) blend = MixBlend.setup;
		} else {
			mix = to.mixTime / to.mixDuration;
			if (mix > 1) mix = 1;
			if (blend !== MixBlend.first) blend = from.mixBlend;
		}
		const attachments = mix < from.mixAttachmentThreshold;
		const drawOrder = mix < from.mixDrawOrderThreshold;
		const animation = from.animation as Animation;
		const timelines = animation.timelines;
		const count = timelines.length;
		const alphaHold = from.alpha * to.interruptAlpha;
		const alphaMix = alphaHold * (1 - mix);
		const animationLast = from.animationLast;
		const animationTime = from.getAnimationTime();
		let applyTime = animationTime;
		let events: Event[] | null = null;
		if (from.reverse) applyTime = animation.duration - applyTime;
		else if (mix < from.eventThreshold) events = this.events;

		if (blend === MixBlend.add) {
			for (const timeline of timelines)
				timeline.apply(
					skeleton,
					animationLast,
					applyTime,
					events,
					alphaMix,
					blend,
					MixDirection.mixOut,
				);
		} else {
			const modes = from.timelineMode;
			const holdMix = from.timelineHoldMix;
			const shortestRotation = from.shortestRotation;
			const firstFrame = !shortestRotation && from.timelinesRotation.length !== count << 1;
			if (firstFrame) from.timelinesRotation.length = count << 1;
			from.totalAlpha = 0;
			for (let i = 0; i < count; i++) {
				const timeline = timelines[i];
				let direction = MixDirection.mixOut;
				let timelineBlend: MixBlend;
				let alpha: number;
				switch (modes[i]) {
					case SUBSEQUENT:
						if (!drawOrder && timeline instanceof DrawOrderTimeline) continue;
						timelineBlend = blend;
						alpha = alphaMix;
						break;
					case FIRST:
						timelineBlend = MixBlend.setup;
						alpha = alphaMix;
						break;
					case HOLD_SUBSEQUENT:
						timelineBlend = blend;
						alpha = alphaHold;
						break;
					case HOLD_FIRST:
						timelineBlend = MixBlend.setup;
						alpha = alphaHold;
						break;
					default: {
						timelineBlend = MixBlend.setup;
						const hold = holdMix[i] as TrackEntry;
						alpha = alphaHold * Math.max(0, 1 - hold.mixTime / hold.mixDuration);
					}
				}
				from.totalAlpha += alpha;
				if (!shortestRotation && timeline instanceof RotateTimeline)
					this.applyRotateTimeline(
						timeline,
						skeleton,
						applyTime,
						alpha,
						timelineBlend,
						from.timelinesRotation,
						i << 1,
						firstFrame,
					);
				else if (timeline instanceof AttachmentTimeline)
					this.applyAttachmentTimeline(
						timeline,
						skeleton,
						applyTime,
						timelineBlend,
						attachments && alpha >= from.alphaAttachmentThreshold,
					);
				else {
					if (
						drawOrder &&
						timeline instanceof DrawOrderTimeline &&
						timelineBlend === MixBlend.setup
					)
						direction = MixDirection.mixIn;
					timeline.apply(
						skeleton,
						animationLast,
						applyTime,
						events,
						alpha,
						timelineBlend,
						direction,
					);
				}
			}
		}
		if (to.mixDuration > 0) this.queueEvents(from, animationTime);
		this.events.length = 0;
		from.nextAnimationLast = animationTime;
		from.nextTrackLast = from.trackTime;
		return mix;
	}

	private applyAttachmentTimeline(
		timeline: AttachmentTimeline,
		skeleton: Skeleton,
		time: number,
		blend: MixBlend,
		attachments: boolean,
	): void {
		const slot = skeleton.slots[timeline.slotIndex];
		if (!slot.bone.active) return;
		if (time < timeline.frames[0]) {
			if (blend === MixBlend.setup || blend === MixBlend.first)
				this.setAttachment(skeleton, slot, slot.data.attachmentName, attachments);
		} else
			this.setAttachment(
				skeleton,
				slot,
				timeline.attachmentNames[Timeline.search1(timeline.frames, time)],
				attachments,
			);
		if (slot.attachmentState <= this.unkeyedState) slot.attachmentState = this.unkeyedState + SETUP;
	}

	private setAttachment(
		skeleton: Skeleton,
		slot: Slot,
		name: string | null,
		attachments: boolean,
	): void {
		slot.setAttachment(name ? skeleton.getAttachment(slot.data.index, name) : null);
		if (attachments) slot.attachmentState = this.unkeyedState + CURRENT;
	}

	/** Mixes rotation along the shortest route, remembering the direction chosen on the first frame
	 * so a mix that crosses 180° keeps turning the same way. */
	private applyRotateTimeline(
		timeline: RotateTimeline,
		skeleton: Skeleton,
		time: number,
		alpha: number,
		blend: MixBlend,
		rotations: number[],
		i: number,
		firstFrame: boolean,
	): void {
		if (firstFrame) rotations[i] = 0;
		if (alpha === 1) {
			timeline.apply(skeleton, 0, time, null, 1, blend);
			return;
		}
		const bone = skeleton.bones[timeline.boneIndex];
		if (!bone.active) return;
		let r1: number;
		let r2: number;
		if (time < timeline.frames[0]) {
			if (blend === MixBlend.setup) {
				bone.rotation = bone.data.rotation;
				return;
			}
			if (blend !== MixBlend.first) return;
			r1 = bone.rotation;
			r2 = bone.data.rotation;
		} else {
			r1 = blend === MixBlend.setup ? bone.data.rotation : bone.rotation;
			r2 = bone.data.rotation + timeline.getCurveValue(time);
		}
		let total: number;
		let diff = r2 - r1;
		diff -= Math.ceil(diff / 360 - 0.5) * 360;
		if (diff === 0) total = rotations[i];
		else {
			const lastTotal = firstFrame ? 0 : rotations[i];
			const lastDiff = firstFrame ? diff : rotations[i + 1];
			const loops = lastTotal - (lastTotal % 360);
			total = diff + loops;
			const current = diff >= 0;
			let dir = lastTotal >= 0;
			if (Math.abs(lastDiff) <= 90 && signum(lastDiff) !== signum(diff)) {
				if (Math.abs(lastTotal - loops) > 180) {
					total += 360 * signum(lastTotal);
					dir = current;
				} else if (loops !== 0) total -= 360 * signum(lastTotal);
				else dir = current;
			}
			if (dir !== current) total += 360 * signum(lastTotal);
			rotations[i] = total;
		}
		rotations[i + 1] = diff;
		bone.rotation = r1 + total * alpha;
	}

	private queueEvents(entry: TrackEntry, animationTime: number): void {
		const start = entry.animationStart;
		const end = entry.animationEnd;
		const duration = end - start;
		const trackLastWrapped = entry.trackLast % duration;
		const events = this.events;
		let i = 0;
		const n = events.length;
		for (; i < n; i++) {
			const event = events[i];
			if (event.time < trackLastWrapped) break;
			if (event.time > end) continue;
			this.queue.event(entry, event);
		}
		let complete: boolean;
		if (entry.loop) {
			if (duration === 0) complete = true;
			else {
				const cycles = Math.floor(entry.trackTime / duration);
				complete = cycles > 0 && cycles > Math.floor(entry.trackLast / duration);
			}
		} else complete = animationTime >= end && entry.animationLast < end;
		if (complete) this.queue.complete(entry);
		for (; i < n; i++) {
			const event = events[i];
			if (event.time < start) continue;
			this.queue.event(entry, event);
		}
	}

	clearTracks(): void {
		const old = this.queue.drainDisabled;
		this.queue.drainDisabled = true;
		for (let i = 0; i < this.tracks.length; i++) this.clearTrack(i);
		this.tracks.length = 0;
		this.queue.drainDisabled = old;
		this.queue.drain();
	}

	clearTrack(trackIndex: number): void {
		if (trackIndex >= this.tracks.length) return;
		const current = this.tracks[trackIndex];
		if (!current) return;
		this.queue.end(current);
		this.clearNext(current);
		let entry = current;
		for (;;) {
			const from: TrackEntry | null = entry.mixingFrom;
			if (!from) break;
			this.queue.end(from);
			entry.mixingFrom = null;
			entry.mixingTo = null;
			entry = from;
		}
		this.tracks[current.trackIndex] = null;
		this.queue.drain();
	}

	private setCurrent(index: number, current: TrackEntry, interrupt: boolean): void {
		const from = this.expandToIndex(index);
		this.tracks[index] = current;
		current.previous = null;
		if (from) {
			if (interrupt) this.queue.interrupt(from);
			current.mixingFrom = from;
			from.mixingTo = current;
			current.mixTime = 0;
			if (from.mixingFrom && from.mixDuration > 0)
				current.interruptAlpha *= Math.min(1, from.mixTime / from.mixDuration);
			from.timelinesRotation.length = 0;
		}
		this.queue.start(current);
	}

	setAnimation(trackIndex: number, animationName: string, loop = false): TrackEntry {
		return this.setAnimationWith(trackIndex, this.resolve(animationName), loop);
	}

	setAnimationWith(trackIndex: number, animation: Animation, loop = false): TrackEntry {
		if (!animation) throw new Error('animation cannot be null.');
		let interrupt = true;
		let current = this.expandToIndex(trackIndex);
		if (current) {
			if (current.nextTrackLast === -1) {
				// Never applied: replace it outright instead of mixing from it.
				this.tracks[trackIndex] = current.mixingFrom;
				this.queue.interrupt(current);
				this.queue.end(current);
				this.clearNext(current);
				current = current.mixingFrom;
				interrupt = false;
			} else this.clearNext(current);
		}
		const entry = this.trackEntry(trackIndex, animation, loop, current);
		this.setCurrent(trackIndex, entry, interrupt);
		this.queue.drain();
		return entry;
	}

	addAnimation(trackIndex: number, animationName: string, loop = false, delay = 0): TrackEntry {
		return this.addAnimationWith(trackIndex, this.resolve(animationName), loop, delay);
	}

	/** Queues an animation after the track's last entry. A delay <= 0 is relative to the end of the
	 * previous entry, less this entry's mix duration. */
	addAnimationWith(trackIndex: number, animation: Animation, loop = false, delay = 0): TrackEntry {
		if (!animation) throw new Error('animation cannot be null.');
		let last = this.expandToIndex(trackIndex);
		if (last) while (last.next) last = last.next;
		const entry = this.trackEntry(trackIndex, animation, loop, last);
		if (!last) {
			this.setCurrent(trackIndex, entry, true);
			this.queue.drain();
			if (delay < 0) delay = 0;
		} else {
			last.next = entry;
			entry.previous = last;
			if (delay <= 0) delay = Math.max(delay + last.getTrackComplete() - entry.mixDuration, 0);
		}
		entry.delay = delay;
		return entry;
	}

	setEmptyAnimation(trackIndex: number, mixDuration = 0): TrackEntry {
		const entry = this.setAnimationWith(trackIndex, AnimationState.emptyAnimation(), false);
		entry.mixDuration = mixDuration;
		entry.trackEnd = mixDuration;
		return entry;
	}

	addEmptyAnimation(trackIndex: number, mixDuration = 0, delay = 0): TrackEntry {
		const entry = this.addAnimationWith(trackIndex, AnimationState.emptyAnimation(), false, delay);
		if (delay <= 0) entry.delay = Math.max(entry.delay + entry.mixDuration - mixDuration, 0);
		entry.mixDuration = mixDuration;
		entry.trackEnd = mixDuration;
		return entry;
	}

	setEmptyAnimations(mixDuration = 0): void {
		const old = this.queue.drainDisabled;
		this.queue.drainDisabled = true;
		for (const current of this.tracks)
			if (current) this.setEmptyAnimation(current.trackIndex, mixDuration);
		this.queue.drainDisabled = old;
		this.queue.drain();
	}

	private resolve(animationName: string): Animation {
		if (!animationName) throw new Error('animationName cannot be null.');
		const found = this.data.skeletonData.findAnimation(animationName);
		if (!found) throw new Error('Animation not found: ' + animationName);
		return found;
	}

	private expandToIndex(index: number): TrackEntry | null {
		if (index < this.tracks.length) return this.tracks[index];
		while (this.tracks.length <= index) this.tracks.push(null);
		return null;
	}

	private trackEntry(
		trackIndex: number,
		animation: Animation,
		loop: boolean,
		last: TrackEntry | null,
	): TrackEntry {
		const entry = new TrackEntry();
		entry.trackIndex = trackIndex;
		entry.animation = animation;
		entry.loop = loop;
		entry.holdPrevious = false;
		entry.reverse = false;
		entry.shortestRotation = false;
		entry.eventThreshold = 0;
		entry.alphaAttachmentThreshold = 0;
		entry.mixAttachmentThreshold = 0;
		entry.mixDrawOrderThreshold = 0;
		entry.animationStart = 0;
		entry.animationEnd = animation.duration;
		entry.animationLast = -1;
		entry.nextAnimationLast = -1;
		entry.delay = 0;
		entry.trackTime = 0;
		entry.trackLast = -1;
		entry.nextTrackLast = -1;
		entry.trackEnd = Number.MAX_VALUE;
		entry.timeScale = 1;
		entry.alpha = 1;
		entry.mixTime = 0;
		entry.mixDuration = last?.animation ? this.data.getMix(last.animation, animation) : 0;
		entry.interruptAlpha = 1;
		entry.totalAlpha = 0;
		entry.mixBlend = MixBlend.replace;
		return entry;
	}

	clearNext(entry: TrackEntry): void {
		let next = entry.next;
		while (next) {
			this.queue.dispose(next);
			next = next.next;
		}
		entry.next = null;
	}

	/** Recomputes each entry's timeline modes after the set of playing animations changed. */
	private onAnimationsChanged(): void {
		this.animationsChanged = false;
		this.propertyIDs.clear();
		for (const track of this.tracks) {
			let entry = track;
			if (!entry) continue;
			while (entry.mixingFrom) entry = entry.mixingFrom;
			let walk: TrackEntry | null = entry;
			do {
				if (!walk.mixingTo || walk.mixBlend !== MixBlend.add) this.computeHold(walk);
				walk = walk.mixingTo;
			} while (walk);
		}
	}

	private computeHold(entry: TrackEntry): void {
		const to = entry.mixingTo;
		const timelines = (entry.animation as Animation).timelines;
		const count = timelines.length;
		const modes = entry.timelineMode;
		modes.length = count;
		const holdMix = entry.timelineHoldMix;
		holdMix.length = 0;
		const ids = this.propertyIDs;
		const addAll = (list: string[]): boolean => {
			let added = false;
			for (const pid of list) {
				if (!ids.has(pid)) {
					ids.add(pid);
					added = true;
				}
			}
			return added;
		};
		if (to && to.holdPrevious) {
			for (let i = 0; i < count; i++)
				modes[i] = addAll(timelines[i].getPropertyIds()) ? HOLD_FIRST : HOLD_SUBSEQUENT;
			return;
		}
		outer: for (let i = 0; i < count; i++) {
			const timeline = timelines[i];
			const pids = timeline.getPropertyIds();
			if (!addAll(pids)) modes[i] = SUBSEQUENT;
			else if (
				!to ||
				timeline instanceof AttachmentTimeline ||
				timeline instanceof DrawOrderTimeline ||
				timeline instanceof EventTimeline ||
				!(to.animation as Animation).hasTimeline(pids)
			)
				modes[i] = FIRST;
			else {
				for (let next = to.mixingTo; next; next = next.mixingTo) {
					if ((next.animation as Animation).hasTimeline(pids)) continue;
					if (entry.mixDuration > 0) {
						modes[i] = HOLD_MIX;
						holdMix[i] = next;
						continue outer;
					}
					break;
				}
				modes[i] = HOLD_FIRST;
			}
		}
	}

	getCurrent(trackIndex: number): TrackEntry | null {
		return trackIndex < this.tracks.length ? this.tracks[trackIndex] : null;
	}

	addListener(listener: AnimationStateListener): void {
		if (!listener) throw new Error('listener cannot be null.');
		this.listeners.push(listener);
	}

	removeListener(listener: AnimationStateListener): void {
		const i = this.listeners.indexOf(listener);
		if (i >= 0) this.listeners.splice(i, 1);
	}

	clearListeners(): void {
		this.listeners.length = 0;
	}

	clearListenerNotifications(): void {
		this.queue.clear();
	}
}
