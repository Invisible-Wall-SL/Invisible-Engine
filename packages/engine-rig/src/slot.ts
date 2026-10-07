import { Color } from './math';
import { VertexAttachment, type Attachment } from './attachments';
import type { SlotData } from './data';
import type { Bone } from './bone';
import type { Skeleton } from './skeleton';

export class Slot {
	color = new Color();
	darkColor: Color | null;
	attachment: Attachment | null = null;
	/** Compared against `AnimationState`'s unkeyed counter to tell who keyed the attachment. */
	attachmentState = 0;
	/** -1 shows the sequence's setup frame. */
	sequenceIndex = -1;
	/** Per-vertex offsets (unweighted: absolute positions) set by deform timelines. */
	deform: number[] = [];

	constructor(
		public data: SlotData,
		public bone: Bone,
	) {
		this.darkColor = data.darkColor ? new Color() : null;
		this.setToSetupPose();
	}

	getSkeleton(): Skeleton {
		return this.bone.skeleton;
	}

	getAttachment(): Attachment | null {
		return this.attachment;
	}

	/** Swaps the attachment. Deform is kept only between two vertex attachments that share
	 * timelines (a mesh and its linked meshes). */
	setAttachment(attachment: Attachment | null): void {
		if (this.attachment === attachment) return;
		const current = this.attachment;
		if (
			!(attachment instanceof VertexAttachment) ||
			!(current instanceof VertexAttachment) ||
			attachment.timelineAttachment !== current.timelineAttachment
		)
			this.deform.length = 0;
		this.attachment = attachment;
		this.sequenceIndex = -1;
	}

	setToSetupPose(): void {
		this.color.setFromColor(this.data.color);
		if (this.darkColor && this.data.darkColor) this.darkColor.setFromColor(this.data.darkColor);
		this.attachment = null;
		const name = this.data.attachmentName;
		if (name) this.setAttachment(this.bone.skeleton.getAttachment(this.data.index, name));
	}
}
