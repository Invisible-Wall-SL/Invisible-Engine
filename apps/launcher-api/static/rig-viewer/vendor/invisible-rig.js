var invisibleRig = function(exports) {
  "use strict";
  const PI = 3.1415927;
  const PI2 = PI * 2;
  const DEG_RAD = PI / 180;
  const RAD_DEG = 180 / PI;
  const MathUtils = {
    PI,
    PI2,
    invPI2: 1 / PI2,
    degRad: DEG_RAD,
    degreesToRadians: DEG_RAD,
    radDeg: RAD_DEG,
    radiansToDegrees: RAD_DEG,
    clamp: (value, min, max) => value < min ? min : value > max ? max : value,
    cosDeg: (degrees) => Math.cos(degrees * DEG_RAD),
    sinDeg: (degrees) => Math.sin(degrees * DEG_RAD),
    atan2Deg: (y, x) => Math.atan2(y, x) * RAD_DEG,
    signum: (value) => value > 0 ? 1 : value < 0 ? -1 : 0,
    toInt: (x) => x > 0 ? Math.floor(x) : Math.ceil(x)
  };
  const signum = MathUtils.signum;
  function wrapRadians(r) {
    if (r > PI) return r - PI2;
    if (r < -PI) return r + PI2;
    return r;
  }
  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
    length() {
      return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    normalize() {
      const len = this.length();
      if (len !== 0) {
        this.x /= len;
        this.y /= len;
      }
      return this;
    }
  }
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const _Color = class _Color {
    constructor(r = 0, g = 0, b = 0, a = 0) {
      this.r = r;
      this.g = g;
      this.b = b;
      this.a = a;
    }
    set(r, g, b, a) {
      this.r = r;
      this.g = g;
      this.b = b;
      this.a = a;
      return this.clamp();
    }
    setFromColor(c) {
      this.r = c.r;
      this.g = c.g;
      this.b = c.b;
      this.a = c.a;
      return this;
    }
    /** Reads `rrggbb` or `rrggbbaa` (alpha 1 when absent). A leading `#` is accepted. */
    setFromString(hex) {
      const h = hex.charAt(0) === "#" ? hex.slice(1) : hex;
      this.r = parseInt(h.slice(0, 2), 16) / 255;
      this.g = parseInt(h.slice(2, 4), 16) / 255;
      this.b = parseInt(h.slice(4, 6), 16) / 255;
      this.a = h.length !== 8 ? 1 : parseInt(h.slice(6, 8), 16) / 255;
      return this;
    }
    add(r, g, b, a) {
      this.r += r;
      this.g += g;
      this.b += b;
      this.a += a;
      return this.clamp();
    }
    clamp() {
      this.r = clamp01(this.r);
      this.g = clamp01(this.g);
      this.b = clamp01(this.b);
      this.a = clamp01(this.a);
      return this;
    }
    static rgba8888ToColor(color, value) {
      color.r = ((value & 4278190080) >>> 24) / 255;
      color.g = ((value & 16711680) >>> 16) / 255;
      color.b = ((value & 65280) >>> 8) / 255;
      color.a = (value & 255) / 255;
    }
    static rgb888ToColor(color, value) {
      color.r = ((value & 16711680) >>> 16) / 255;
      color.g = ((value & 65280) >>> 8) / 255;
      color.b = (value & 255) / 255;
    }
    toRgb888() {
      const c = (v) => Math.round(clamp01(v) * 255);
      return c(this.r) << 16 | c(this.g) << 8 | c(this.b);
    }
    static fromString(hex, out = new _Color()) {
      return out.setFromString(hex);
    }
  };
  _Color.WHITE = new _Color(1, 1, 1, 1);
  _Color.RED = new _Color(1, 0, 0, 1);
  _Color.GREEN = new _Color(0, 1, 0, 1);
  _Color.BLUE = new _Color(0, 0, 1, 1);
  _Color.MAGENTA = new _Color(1, 0, 1, 1);
  let Color = _Color;
  function setArraySize(array, size, value) {
    const old = array.length;
    if (old === size) return array;
    array.length = size;
    for (let i = old; i < size; i++) array[i] = value;
    return array;
  }
  class TextureRegion {
    constructor() {
      this.texture = null;
      this.renderObject = null;
      this.u = 0;
      this.v = 0;
      this.u2 = 0;
      this.v2 = 0;
      this.width = 0;
      this.height = 0;
      this.degrees = 0;
      this.offsetX = 0;
      this.offsetY = 0;
      this.originalWidth = 0;
      this.originalHeight = 0;
    }
  }
  let nextVertexAttachmentId = 0;
  let nextSequenceId = 0;
  class Attachment {
    constructor(name) {
      this.name = name;
      if (!name) throw new Error("name cannot be null.");
    }
  }
  var SequenceMode = /* @__PURE__ */ ((SequenceMode2) => {
    SequenceMode2[SequenceMode2["hold"] = 0] = "hold";
    SequenceMode2[SequenceMode2["once"] = 1] = "once";
    SequenceMode2[SequenceMode2["loop"] = 2] = "loop";
    SequenceMode2[SequenceMode2["pingpong"] = 3] = "pingpong";
    SequenceMode2[SequenceMode2["onceReverse"] = 4] = "onceReverse";
    SequenceMode2[SequenceMode2["loopReverse"] = 5] = "loopReverse";
    SequenceMode2[SequenceMode2["pingpongReverse"] = 6] = "pingpongReverse";
    return SequenceMode2;
  })(SequenceMode || {});
  const SequenceModeValues = [
    0,
    1,
    2,
    3,
    4,
    5,
    6
    /* pingpongReverse */
  ];
  class Sequence {
    constructor(count) {
      this.id = nextSequenceId++;
      this.start = 0;
      this.digits = 0;
      this.setupIndex = 0;
      this.regions = new Array(count).fill(null);
    }
    copy() {
      const copy = new Sequence(this.regions.length);
      copy.regions = this.regions.slice();
      copy.start = this.start;
      copy.digits = this.digits;
      copy.setupIndex = this.setupIndex;
      return copy;
    }
    apply(slot, attachment) {
      let index = slot.sequenceIndex;
      if (index === -1) index = this.setupIndex;
      if (index >= this.regions.length) index = this.regions.length - 1;
      const region = this.regions[index];
      if (attachment.region !== region) {
        attachment.region = region;
        attachment.updateRegion();
      }
    }
    getPath(basePath, index) {
      const frame = String(this.start + index);
      const pad = Math.max(0, this.digits - frame.length);
      return basePath + "0".repeat(pad) + frame;
    }
  }
  class VertexAttachment extends Attachment {
    constructor() {
      super(...arguments);
      this.id = nextVertexAttachmentId++;
      this.bones = null;
      this.vertices = [];
      this.worldVerticesLength = 0;
      this.timelineAttachment = this;
    }
    /** Transforms `count` world-vertex components starting at component `start` into
     * `worldVertices`, writing `x, y` every `stride` entries from `offset`. */
    computeWorldVertices(slot, start, count, worldVertices, offset, stride) {
      const end = offset + (count >> 1) * stride;
      const deform = slot.deform;
      const weights = this.bones;
      if (!weights) {
        const source = deform.length > 0 ? deform : this.vertices;
        const bone = slot.bone;
        const { a, b, c, d, worldX, worldY } = bone;
        for (let v = start, w = offset; w < end; v += 2, w += stride) {
          const x = source[v];
          const y = source[v + 1];
          worldVertices[w] = x * a + y * b + worldX;
          worldVertices[w + 1] = x * c + y * d + worldY;
        }
        return;
      }
      let cursor = 0;
      let influencesBefore = 0;
      for (let i = 0; i < start; i += 2) {
        const n = weights[cursor];
        cursor += n + 1;
        influencesBefore += n;
      }
      const skeletonBones = slot.bone.skeleton.bones;
      const vertices = this.vertices;
      const deformed = deform.length > 0;
      let vi = influencesBefore * 3;
      let di = influencesBefore << 1;
      for (let w = offset; w < end; w += stride) {
        let wx = 0;
        let wy = 0;
        const n = weights[cursor++];
        for (let k = 0; k < n; k++, cursor++, vi += 3, di += 2) {
          const bone = skeletonBones[weights[cursor]];
          let x = vertices[vi];
          let y = vertices[vi + 1];
          if (deformed) {
            x += deform[di];
            y += deform[di + 1];
          }
          const weight = vertices[vi + 2];
          wx += (x * bone.a + y * bone.b + bone.worldX) * weight;
          wy += (x * bone.c + y * bone.d + bone.worldY) * weight;
        }
        worldVertices[w] = wx;
        worldVertices[w + 1] = wy;
      }
    }
    copyTo(target) {
      target.bones = this.bones ? this.bones.slice() : null;
      target.vertices = this.vertices.slice();
      target.worldVerticesLength = this.worldVerticesLength;
      target.timelineAttachment = this.timelineAttachment;
    }
  }
  class RegionAttachment extends Attachment {
    constructor(name, path) {
      super(name);
      this.kind = "region";
      this.x = 0;
      this.y = 0;
      this.scaleX = 1;
      this.scaleY = 1;
      this.rotation = 0;
      this.width = 0;
      this.height = 0;
      this.color = new Color(1, 1, 1, 1);
      this.region = null;
      this.sequence = null;
      this.offset = new Float32Array(8);
      this.uvs = new Float32Array(8);
      this.tempColor = new Color(1, 1, 1, 1);
      this.path = path;
    }
    updateRegion() {
      const region = this.region;
      if (!region) throw new Error("Region not set.");
      const sx = this.width / region.originalWidth * this.scaleX;
      const sy = this.height / region.originalHeight * this.scaleY;
      const left = -this.width / 2 * this.scaleX + region.offsetX * sx;
      const bottom = -this.height / 2 * this.scaleY + region.offsetY * sy;
      const right = left + region.width * sx;
      const top = bottom + region.height * sy;
      const cos = Math.cos(this.rotation * DEG_RAD);
      const sin = Math.sin(this.rotation * DEG_RAD);
      const corner = (i, lx, ly) => {
        this.offset[i] = lx * cos - ly * sin + this.x;
        this.offset[i + 1] = lx * sin + ly * cos + this.y;
      };
      corner(0, left, bottom);
      corner(2, left, top);
      corner(4, right, top);
      corner(6, right, bottom);
      const { u, v, u2, v2 } = region;
      const uvs = this.uvs;
      if (region.degrees === 90) uvs.set([u2, v2, u, v2, u, v, u2, v]);
      else uvs.set([u, v2, u, v, u2, v, u2, v2]);
    }
    computeWorldVertices(slot, worldVertices, offset, stride) {
      if (this.sequence) this.sequence.apply(slot, this);
      const { a, b, c, d, worldX, worldY } = slot.bone;
      const o = this.offset;
      for (let i = 0; i < 8; i += 2, offset += stride) {
        const x = o[i];
        const y = o[i + 1];
        worldVertices[offset] = x * a + y * b + worldX;
        worldVertices[offset + 1] = x * c + y * d + worldY;
      }
    }
    copy() {
      const copy = new RegionAttachment(this.name, this.path);
      copy.region = this.region;
      copy.x = this.x;
      copy.y = this.y;
      copy.scaleX = this.scaleX;
      copy.scaleY = this.scaleY;
      copy.rotation = this.rotation;
      copy.width = this.width;
      copy.height = this.height;
      copy.uvs.set(this.uvs);
      copy.offset.set(this.offset);
      copy.color.setFromColor(this.color);
      copy.sequence = this.sequence ? this.sequence.copy() : null;
      return copy;
    }
  }
  class MeshAttachment extends VertexAttachment {
    constructor(name, path) {
      super(name);
      this.kind = "mesh";
      this.region = null;
      this.regionUVs = [];
      this.uvs = [];
      this.triangles = [];
      this.color = new Color(1, 1, 1, 1);
      this.width = 0;
      this.height = 0;
      this.hullLength = 0;
      this.edges = [];
      this.sequence = null;
      this.tempColor = new Color(0, 0, 0, 0);
      this.parentMesh = null;
      this.path = path;
    }
    /** Maps the [0,1] region UVs onto the page, undoing the region's pack rotation and trim. */
    updateRegion() {
      const region = this.region;
      if (!region) throw new Error("Region not set.");
      const regionUVs = this.regionUVs;
      const n = regionUVs.length;
      if (this.uvs.length !== n) this.uvs = new Float32Array(n);
      const uvs = this.uvs;
      const page = region instanceof TextureAtlasRegionBase ? region.page : null;
      if (!page) {
        const w = region.u2 - region.u;
        const h = region.v2 - region.v;
        for (let i = 0; i < n; i += 2) {
          uvs[i] = region.u + regionUVs[i] * w;
          uvs[i + 1] = region.v + regionUVs[i + 1] * h;
        }
        return;
      }
      const pw = page.width;
      const ph = page.height;
      const { offsetX, offsetY, originalWidth: ow, originalHeight: oh } = region;
      const trimRight = ow - offsetX - region.width;
      const trimTop = oh - offsetY - region.height;
      switch (region.degrees) {
        case 90: {
          const u2 = region.u - trimTop / pw;
          const v2 = region.v - trimRight / ph;
          for (let i = 0; i < n; i += 2) {
            uvs[i] = u2 + regionUVs[i + 1] * (oh / pw);
            uvs[i + 1] = v2 + (1 - regionUVs[i]) * (ow / ph);
          }
          return;
        }
        case 180: {
          const u2 = region.u - trimRight / pw;
          const v2 = region.v - offsetY / ph;
          for (let i = 0; i < n; i += 2) {
            uvs[i] = u2 + (1 - regionUVs[i]) * (ow / pw);
            uvs[i + 1] = v2 + (1 - regionUVs[i + 1]) * (oh / ph);
          }
          return;
        }
        case 270: {
          const u2 = region.u - offsetY / pw;
          const v2 = region.v - offsetX / ph;
          for (let i = 0; i < n; i += 2) {
            uvs[i] = u2 + (1 - regionUVs[i + 1]) * (oh / pw);
            uvs[i + 1] = v2 + regionUVs[i] * (ow / ph);
          }
          return;
        }
      }
      const u = region.u - offsetX / pw;
      const v = region.v - trimTop / ph;
      for (let i = 0; i < n; i += 2) {
        uvs[i] = u + regionUVs[i] * (ow / pw);
        uvs[i + 1] = v + regionUVs[i + 1] * (oh / ph);
      }
    }
    getParentMesh() {
      return this.parentMesh;
    }
    setParentMesh(parent) {
      this.parentMesh = parent;
      if (!parent) return;
      this.bones = parent.bones;
      this.vertices = parent.vertices;
      this.worldVerticesLength = parent.worldVerticesLength;
      this.regionUVs = parent.regionUVs;
      this.triangles = parent.triangles;
      this.hullLength = parent.hullLength;
    }
    computeWorldVertices(slot, start, count, worldVertices, offset, stride) {
      if (this.sequence) this.sequence.apply(slot, this);
      super.computeWorldVertices(slot, start, count, worldVertices, offset, stride);
    }
    copy() {
      if (this.parentMesh) return this.newLinkedMesh();
      const copy = new MeshAttachment(this.name, this.path);
      copy.region = this.region;
      copy.color.setFromColor(this.color);
      this.copyTo(copy);
      copy.regionUVs = this.regionUVs.slice();
      copy.uvs = this.uvs.slice();
      copy.triangles = this.triangles.slice();
      copy.hullLength = this.hullLength;
      copy.sequence = this.sequence ? this.sequence.copy() : null;
      copy.edges = this.edges.slice();
      copy.width = this.width;
      copy.height = this.height;
      return copy;
    }
    newLinkedMesh() {
      const copy = new MeshAttachment(this.name, this.path);
      copy.region = this.region;
      copy.color.setFromColor(this.color);
      copy.timelineAttachment = this.timelineAttachment;
      copy.setParentMesh(this.parentMesh ?? this);
      if (copy.region) copy.updateRegion();
      return copy;
    }
  }
  class BoundingBoxAttachment extends VertexAttachment {
    constructor() {
      super(...arguments);
      this.kind = "boundingbox";
      this.color = new Color(1, 1, 1, 1);
    }
    copy() {
      const copy = new BoundingBoxAttachment(this.name);
      this.copyTo(copy);
      copy.color.setFromColor(this.color);
      return copy;
    }
  }
  class ClippingAttachment extends VertexAttachment {
    constructor() {
      super(...arguments);
      this.kind = "clipping";
      this.endSlot = null;
      this.color = new Color(0.2275, 0.2275, 0.8078, 1);
    }
    copy() {
      const copy = new ClippingAttachment(this.name);
      this.copyTo(copy);
      copy.endSlot = this.endSlot;
      copy.color.setFromColor(this.color);
      return copy;
    }
  }
  class PathAttachment extends VertexAttachment {
    constructor() {
      super(...arguments);
      this.kind = "path";
      this.lengths = [];
      this.closed = false;
      this.constantSpeed = false;
      this.color = new Color(1, 1, 1, 1);
    }
    copy() {
      const copy = new PathAttachment(this.name);
      this.copyTo(copy);
      copy.lengths = this.lengths.slice();
      copy.closed = this.closed;
      copy.constantSpeed = this.constantSpeed;
      copy.color.setFromColor(this.color);
      return copy;
    }
  }
  class PointAttachment extends VertexAttachment {
    constructor() {
      super(...arguments);
      this.kind = "point";
      this.x = 0;
      this.y = 0;
      this.rotation = 0;
      this.color = new Color(0.38, 0.94, 0, 1);
    }
    computeWorldPosition(bone, point) {
      point.x = this.x * bone.a + this.y * bone.b + bone.worldX;
      point.y = this.x * bone.c + this.y * bone.d + bone.worldY;
      return point;
    }
    computeWorldRotation(bone) {
      const r = this.rotation * DEG_RAD;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const x = cos * bone.a + sin * bone.b;
      const y = cos * bone.c + sin * bone.d;
      return Math.atan2(y, x) / DEG_RAD;
    }
    copy() {
      const copy = new PointAttachment(this.name);
      this.copyTo(copy);
      copy.x = this.x;
      copy.y = this.y;
      copy.rotation = this.rotation;
      copy.color.setFromColor(this.color);
      return copy;
    }
  }
  class TextureAtlasRegionBase extends TextureRegion {
    constructor(page) {
      super();
      this.page = page;
    }
  }
  var Inherit = /* @__PURE__ */ ((Inherit2) => {
    Inherit2[Inherit2["Normal"] = 0] = "Normal";
    Inherit2[Inherit2["OnlyTranslation"] = 1] = "OnlyTranslation";
    Inherit2[Inherit2["NoRotationOrReflection"] = 2] = "NoRotationOrReflection";
    Inherit2[Inherit2["NoScale"] = 3] = "NoScale";
    Inherit2[Inherit2["NoScaleOrReflection"] = 4] = "NoScaleOrReflection";
    return Inherit2;
  })(Inherit || {});
  var BlendMode = /* @__PURE__ */ ((BlendMode2) => {
    BlendMode2[BlendMode2["Normal"] = 0] = "Normal";
    BlendMode2[BlendMode2["Additive"] = 1] = "Additive";
    BlendMode2[BlendMode2["Multiply"] = 2] = "Multiply";
    BlendMode2[BlendMode2["Screen"] = 3] = "Screen";
    return BlendMode2;
  })(BlendMode || {});
  var PositionMode = /* @__PURE__ */ ((PositionMode2) => {
    PositionMode2[PositionMode2["Fixed"] = 0] = "Fixed";
    PositionMode2[PositionMode2["Percent"] = 1] = "Percent";
    return PositionMode2;
  })(PositionMode || {});
  var SpacingMode = /* @__PURE__ */ ((SpacingMode2) => {
    SpacingMode2[SpacingMode2["Length"] = 0] = "Length";
    SpacingMode2[SpacingMode2["Fixed"] = 1] = "Fixed";
    SpacingMode2[SpacingMode2["Percent"] = 2] = "Percent";
    SpacingMode2[SpacingMode2["Proportional"] = 3] = "Proportional";
    return SpacingMode2;
  })(SpacingMode || {});
  var RotateMode = /* @__PURE__ */ ((RotateMode2) => {
    RotateMode2[RotateMode2["Tangent"] = 0] = "Tangent";
    RotateMode2[RotateMode2["Chain"] = 1] = "Chain";
    RotateMode2[RotateMode2["ChainScale"] = 2] = "ChainScale";
    return RotateMode2;
  })(RotateMode || {});
  function enumFromName(type, name, fallback) {
    if (!name) return fallback;
    const key = name.charAt(0).toUpperCase() + name.slice(1);
    const value = type[key];
    return value === void 0 ? fallback : value;
  }
  class BoneData {
    constructor(index, name, parent) {
      this.index = index;
      this.name = name;
      this.length = 0;
      this.x = 0;
      this.y = 0;
      this.rotation = 0;
      this.scaleX = 1;
      this.scaleY = 1;
      this.shearX = 0;
      this.shearY = 0;
      this.inherit = 0;
      this.skinRequired = false;
      this.color = new Color();
      this.visible = false;
      if (index < 0) throw new Error("index must be >= 0.");
      this.parent = parent;
    }
  }
  class SlotData {
    constructor(index, name, boneData) {
      this.index = index;
      this.name = name;
      this.boneData = boneData;
      this.color = new Color(1, 1, 1, 1);
      this.darkColor = null;
      this.attachmentName = null;
      this.blendMode = 0;
      this.visible = true;
      if (index < 0) throw new Error("index must be >= 0.");
    }
  }
  class ConstraintData {
    constructor(name, order, skinRequired) {
      this.name = name;
      this.order = order;
      this.skinRequired = skinRequired;
    }
  }
  class IkConstraintData extends ConstraintData {
    constructor(name) {
      super(name, 0, false);
      this.bones = [];
      this._target = null;
      this.bendDirection = 1;
      this.compress = false;
      this.stretch = false;
      this.uniform = false;
      this.mix = 1;
      this.softness = 0;
    }
    get target() {
      if (!this._target) throw new Error("BoneData not set.");
      return this._target;
    }
    set target(value) {
      this._target = value;
    }
  }
  class TransformConstraintData extends ConstraintData {
    constructor(name) {
      super(name, 0, false);
      this.bones = [];
      this._target = null;
      this.mixRotate = 0;
      this.mixX = 0;
      this.mixY = 0;
      this.mixScaleX = 0;
      this.mixScaleY = 0;
      this.mixShearY = 0;
      this.offsetRotation = 0;
      this.offsetX = 0;
      this.offsetY = 0;
      this.offsetScaleX = 0;
      this.offsetScaleY = 0;
      this.offsetShearY = 0;
      this.relative = false;
      this.local = false;
    }
    get target() {
      if (!this._target) throw new Error("BoneData not set.");
      return this._target;
    }
    set target(value) {
      this._target = value;
    }
  }
  class PathConstraintData extends ConstraintData {
    constructor(name) {
      super(name, 0, false);
      this.bones = [];
      this._target = null;
      this.positionMode = 0;
      this.spacingMode = 1;
      this.rotateMode = 1;
      this.offsetRotation = 0;
      this.position = 0;
      this.spacing = 0;
      this.mixRotate = 0;
      this.mixX = 0;
      this.mixY = 0;
    }
    get target() {
      if (!this._target) throw new Error("SlotData not set.");
      return this._target;
    }
    set target(value) {
      this._target = value;
    }
  }
  class PhysicsConstraintData extends ConstraintData {
    constructor(name) {
      super(name, 0, false);
      this._bone = null;
      this.x = 0;
      this.y = 0;
      this.rotate = 0;
      this.scaleX = 0;
      this.shearX = 0;
      this.limit = 0;
      this.step = 0;
      this.inertia = 0;
      this.strength = 0;
      this.damping = 0;
      this.massInverse = 0;
      this.wind = 0;
      this.gravity = 0;
      this.mix = 0;
      this.inertiaGlobal = false;
      this.strengthGlobal = false;
      this.dampingGlobal = false;
      this.massGlobal = false;
      this.windGlobal = false;
      this.gravityGlobal = false;
      this.mixGlobal = false;
    }
    get bone() {
      if (!this._bone) throw new Error("BoneData not set.");
      return this._bone;
    }
    set bone(value) {
      this._bone = value;
    }
  }
  class EventData {
    constructor(name) {
      this.name = name;
      this.intValue = 0;
      this.floatValue = 0;
      this.stringValue = null;
      this.audioPath = null;
      this.volume = 0;
      this.balance = 0;
    }
  }
  class SkinEntry {
    constructor(slotIndex, name, attachment) {
      this.slotIndex = slotIndex;
      this.name = name;
      this.attachment = attachment;
    }
  }
  class Skin {
    constructor(name) {
      this.name = name;
      this.attachments = [];
      this.bones = [];
      this.constraints = [];
      this.color = new Color(0.99607843, 0.61960787, 0.30980393, 1);
      if (!name) throw new Error("name cannot be null.");
    }
    setAttachment(slotIndex, name, attachment) {
      var _a;
      if (!attachment) throw new Error("attachment cannot be null.");
      while (this.attachments.length <= slotIndex) this.attachments.push(void 0);
      const map = (_a = this.attachments)[slotIndex] ?? (_a[slotIndex] = {});
      map[name] = attachment;
    }
    addSkin(skin) {
      for (const bone of skin.bones) if (!this.bones.includes(bone)) this.bones.push(bone);
      for (const c of skin.constraints) if (!this.constraints.includes(c)) this.constraints.push(c);
      for (const entry of skin.getAttachments())
        this.setAttachment(entry.slotIndex, entry.name, entry.attachment);
    }
    /** Like `addSkin`, but attachments are copied (meshes become linked meshes of the source). */
    copySkin(skin) {
      for (const bone of skin.bones) if (!this.bones.includes(bone)) this.bones.push(bone);
      for (const c of skin.constraints) if (!this.constraints.includes(c)) this.constraints.push(c);
      for (const entry of skin.getAttachments()) {
        const source = entry.attachment;
        const copy = source instanceof MeshAttachment ? source.newLinkedMesh() : source.copy();
        this.setAttachment(entry.slotIndex, entry.name, copy);
      }
    }
    getAttachment(slotIndex, name) {
      var _a;
      return ((_a = this.attachments[slotIndex]) == null ? void 0 : _a[name]) ?? null;
    }
    removeAttachment(slotIndex, name) {
      const map = this.attachments[slotIndex];
      if (map) delete map[name];
    }
    getAttachments() {
      const out = [];
      this.attachments.forEach((map, slotIndex) => {
        if (!map) return;
        for (const name of Object.keys(map)) out.push(new SkinEntry(slotIndex, name, map[name]));
      });
      return out;
    }
    getAttachmentsForSlot(slotIndex, out) {
      const map = this.attachments[slotIndex];
      if (!map) return;
      for (const name of Object.keys(map)) out.push(new SkinEntry(slotIndex, name, map[name]));
    }
    clear() {
      this.attachments.length = 0;
      this.bones.length = 0;
      this.constraints.length = 0;
    }
    /** Called on a skin change: each slot showing an attachment of `oldSkin` switches to this
     * skin's attachment under the same name, when it has one. */
    attachAll(skeleton, oldSkin) {
      for (let slotIndex = 0; slotIndex < skeleton.slots.length; slotIndex++) {
        const slot = skeleton.slots[slotIndex];
        const current = slot.getAttachment();
        const oldMap = oldSkin.attachments[slotIndex];
        if (!current || !oldMap) continue;
        for (const name of Object.keys(oldMap)) {
          if (oldMap[name] !== current) continue;
          const replacement = this.getAttachment(slotIndex, name);
          if (replacement) slot.setAttachment(replacement);
          break;
        }
      }
    }
  }
  class SkeletonData {
    constructor() {
      this.name = null;
      this.bones = [];
      this.slots = [];
      this.skins = [];
      this.defaultSkin = null;
      this.events = [];
      this.animations = [];
      this.ikConstraints = [];
      this.transformConstraints = [];
      this.pathConstraints = [];
      this.physicsConstraints = [];
      this.x = 0;
      this.y = 0;
      this.width = 0;
      this.height = 0;
      this.referenceScale = 100;
      this.version = null;
      this.hash = null;
      this.fps = 0;
      this.imagesPath = null;
      this.audioPath = null;
    }
    findBone(name) {
      if (!name) throw new Error("boneName cannot be null.");
      const key = String(name);
      return this.bones.find((b) => b.name === key) ?? null;
    }
    findSlot(name) {
      if (!name) throw new Error("slotName cannot be null.");
      const key = String(name);
      return this.slots.find((s) => s.name === key) ?? null;
    }
    findSkin(name) {
      if (!name) throw new Error("skinName cannot be null.");
      const key = String(name);
      return this.skins.find((s) => s.name === key) ?? null;
    }
    findEvent(name) {
      if (!name) throw new Error("eventDataName cannot be null.");
      const key = String(name);
      return this.events.find((e) => e.name === key) ?? null;
    }
    findAnimation(name) {
      if (!name) throw new Error("animationName cannot be null.");
      const key = String(name);
      return this.animations.find((a) => a.name === key) ?? null;
    }
    findIkConstraint(name) {
      if (!name) throw new Error("constraintName cannot be null.");
      const key = String(name);
      return this.ikConstraints.find((c) => c.name === key) ?? null;
    }
    findTransformConstraint(name) {
      if (!name) throw new Error("constraintName cannot be null.");
      const key = String(name);
      return this.transformConstraints.find((c) => c.name === key) ?? null;
    }
    findPathConstraint(name) {
      if (!name) throw new Error("constraintName cannot be null.");
      const key = String(name);
      return this.pathConstraints.find((c) => c.name === key) ?? null;
    }
    findPhysicsConstraint(name) {
      if (!name) throw new Error("constraintName cannot be null.");
      const key = String(name);
      return this.physicsConstraints.find((c) => c.name === key) ?? null;
    }
  }
  var TextureFilter = /* @__PURE__ */ ((TextureFilter2) => {
    TextureFilter2[TextureFilter2["Nearest"] = 9728] = "Nearest";
    TextureFilter2[TextureFilter2["Linear"] = 9729] = "Linear";
    TextureFilter2[TextureFilter2["MipMapNearestNearest"] = 9984] = "MipMapNearestNearest";
    TextureFilter2[TextureFilter2["MipMapLinearNearest"] = 9985] = "MipMapLinearNearest";
    TextureFilter2[TextureFilter2["MipMapNearestLinear"] = 9986] = "MipMapNearestLinear";
    TextureFilter2[TextureFilter2["MipMapLinearLinear"] = 9987] = "MipMapLinearLinear";
    return TextureFilter2;
  })(TextureFilter || {});
  var TextureWrap = /* @__PURE__ */ ((TextureWrap2) => {
    TextureWrap2[TextureWrap2["MirroredRepeat"] = 33648] = "MirroredRepeat";
    TextureWrap2[TextureWrap2["ClampToEdge"] = 33071] = "ClampToEdge";
    TextureWrap2[TextureWrap2["Repeat"] = 10497] = "Repeat";
    return TextureWrap2;
  })(TextureWrap || {});
  class TextureAtlasPage {
    constructor(name) {
      this.name = name;
      this.minFilter = 9728;
      this.magFilter = 9728;
      this.uWrap = 33071;
      this.vWrap = 33071;
      this.texture = null;
      this.width = 0;
      this.height = 0;
      this.pma = false;
      this.scale = 1;
      this.regions = [];
    }
    setTexture(texture) {
      var _a, _b;
      this.texture = texture;
      const t = texture;
      (_a = t == null ? void 0 : t.setFilters) == null ? void 0 : _a.call(t, this.minFilter, this.magFilter);
      (_b = t == null ? void 0 : t.setWraps) == null ? void 0 : _b.call(t, this.uWrap, this.vWrap);
      for (const region of this.regions) region.texture = texture;
    }
  }
  class TextureAtlasRegion extends TextureAtlasRegionBase {
    /** Joins `page.regions` on construction, which tools that build regions by hand rely on. */
    constructor(page, name) {
      super(page);
      this.name = name;
      this.x = 0;
      this.y = 0;
      this.index = -1;
      this.names = null;
      this.values = null;
      page.regions.push(this);
    }
  }
  const filterByName = {
    nearest: 9728,
    linear: 9729,
    mipmap: 9987,
    mipmapnearestnearest: 9984,
    mipmaplinearnearest: 9985,
    mipmapnearestlinear: 9986,
    mipmaplinearlinear: 9987
    /* MipMapLinearLinear */
  };
  const parseFilter = (name) => filterByName[(name ?? "").toLowerCase()] ?? 9728;
  function readEntry(line) {
    if (line === null) return null;
    const trimmed = line.trim();
    if (!trimmed) return null;
    const colon = trimmed.indexOf(":");
    if (colon === -1) return null;
    const out = [trimmed.slice(0, colon).trim()];
    const rest = trimmed.slice(colon + 1).split(",");
    for (let i = 0; i < rest.length; i++) {
      if (out.length === 4 && i < rest.length - 1) {
        out.push(rest.slice(i).join(",").trim());
        break;
      }
      out.push(rest[i].trim());
    }
    return out;
  }
  class TextureAtlas {
    constructor(atlasText) {
      this.pages = [];
      this.regions = [];
      const lines = atlasText.split(/\r\n|\r|\n/);
      let i = 0;
      const next = () => i < lines.length ? lines[i++] : null;
      let line = next();
      while (line !== null && !line.trim()) line = next();
      while (line !== null && line.trim() && readEntry(line)) line = next();
      let page = null;
      while (line !== null) {
        if (!line.trim()) {
          page = null;
          line = next();
          continue;
        }
        if (!page) {
          page = new TextureAtlasPage(line.trim());
          for (; ; ) {
            line = next();
            const e = readEntry(line);
            if (!e) break;
            this.readPageField(page, e);
          }
          this.pages.push(page);
          continue;
        }
        const region = new TextureAtlasRegion(page, line.trim());
        page.regions.pop();
        let names = null;
        let values = null;
        for (; ; ) {
          line = next();
          const e = readEntry(line);
          if (!e) break;
          if (!this.readRegionField(region, e)) {
            (names ?? (names = [])).push(e[0]);
            (values ?? (values = [])).push(e.slice(1).map((v) => parseInt(v, 10)));
          }
        }
        if (region.originalWidth === 0 && region.originalHeight === 0) {
          region.originalWidth = region.width;
          region.originalHeight = region.height;
        }
        if (names && values) {
          region.names = names;
          region.values = values;
        }
        region.u = region.x / page.width;
        region.v = region.y / page.height;
        const packedW = region.degrees === 90 ? region.height : region.width;
        const packedH = region.degrees === 90 ? region.width : region.height;
        region.u2 = (region.x + packedW) / page.width;
        region.v2 = (region.y + packedH) / page.height;
        page.regions.push(region);
        this.regions.push(region);
      }
    }
    readPageField(page, e) {
      switch (e[0]) {
        case "size":
          page.width = parseInt(e[1], 10);
          page.height = parseInt(e[2], 10);
          break;
        case "filter":
          page.minFilter = parseFilter(e[1]);
          page.magFilter = parseFilter(e[2]);
          break;
        case "repeat":
          if (e[1].includes("x")) page.uWrap = 10497;
          if (e[1].includes("y")) page.vWrap = 10497;
          break;
        case "pma":
          page.pma = e[1] === "true";
          break;
        case "scale":
          page.scale = parseFloat(e[1]);
          break;
      }
    }
    readRegionField(r, e) {
      const n = (k) => parseInt(e[k], 10);
      switch (e[0]) {
        case "xy":
          r.x = n(1);
          r.y = n(2);
          return true;
        case "size":
          r.width = n(1);
          r.height = n(2);
          return true;
        case "bounds":
          r.x = n(1);
          r.y = n(2);
          r.width = n(3);
          r.height = n(4);
          return true;
        case "offset":
          r.offsetX = n(1);
          r.offsetY = n(2);
          return true;
        case "orig":
          r.originalWidth = n(1);
          r.originalHeight = n(2);
          return true;
        case "offsets":
          r.offsetX = n(1);
          r.offsetY = n(2);
          r.originalWidth = n(3);
          r.originalHeight = n(4);
          return true;
        case "rotate":
          if (e[1] === "true") r.degrees = 90;
          else if (e[1] !== "false") r.degrees = n(1);
          return true;
        case "index":
          r.index = n(1);
          return true;
      }
      return false;
    }
    findRegion(name) {
      for (const region of this.regions) if (region.name === name) return region;
      return null;
    }
    setTextures(textureFor) {
      for (const page of this.pages) page.setTexture(textureFor(page));
    }
    dispose() {
      var _a, _b;
      for (const page of this.pages) (_b = (_a = page.texture) == null ? void 0 : _a.dispose) == null ? void 0 : _b.call(_a);
    }
  }
  class AtlasAttachmentLoader {
    constructor(atlas) {
      this.atlas = atlas;
    }
    loadSequence(name, basePath, sequence) {
      for (let i = 0; i < sequence.regions.length; i++) {
        const path = sequence.getPath(basePath, i);
        const region = this.atlas.findRegion(path);
        if (!region) throw new Error(`Region not found in atlas: ${path} (sequence: ${name})`);
        sequence.regions[i] = region;
      }
    }
    newRegionAttachment(skin, name, path, sequence) {
      const attachment = new RegionAttachment(name, path);
      if (sequence) {
        this.loadSequence(name, path, sequence);
        return attachment;
      }
      const region = this.atlas.findRegion(path);
      if (!region) throw new Error(`Region not found in atlas: ${path} (region attachment: ${name})`);
      attachment.region = region;
      return attachment;
    }
    newMeshAttachment(skin, name, path, sequence) {
      const attachment = new MeshAttachment(name, path);
      if (sequence) {
        this.loadSequence(name, path, sequence);
        return attachment;
      }
      const region = this.atlas.findRegion(path);
      if (!region) throw new Error(`Region not found in atlas: ${path} (mesh attachment: ${name})`);
      attachment.region = region;
      return attachment;
    }
    newBoundingBoxAttachment(skin, name) {
      return new BoundingBoxAttachment(name);
    }
    newPathAttachment(skin, name) {
      return new PathAttachment(name);
    }
    newPointAttachment(skin, name) {
      return new PointAttachment(name);
    }
    newClippingAttachment(skin, name) {
      return new ClippingAttachment(name);
    }
  }
  class Bone {
    constructor(data, skeleton, parent) {
      this.data = data;
      this.skeleton = skeleton;
      this.parent = parent;
      this.children = [];
      this.x = 0;
      this.y = 0;
      this.rotation = 0;
      this.scaleX = 0;
      this.scaleY = 0;
      this.shearX = 0;
      this.shearY = 0;
      this.ax = 0;
      this.ay = 0;
      this.arotation = 0;
      this.ascaleX = 0;
      this.ascaleY = 0;
      this.ashearX = 0;
      this.ashearY = 0;
      this.a = 0;
      this.b = 0;
      this.c = 0;
      this.d = 0;
      this.worldX = 0;
      this.worldY = 0;
      this.inherit = Inherit.Normal;
      this.sorted = false;
      this.active = false;
      this.setToSetupPose();
    }
    isActive() {
      return this.active;
    }
    update(_physics) {
      this.updateWorldTransformWith(
        this.ax,
        this.ay,
        this.arotation,
        this.ascaleX,
        this.ascaleY,
        this.ashearX,
        this.ashearY
      );
    }
    updateWorldTransform() {
      this.updateWorldTransformWith(
        this.x,
        this.y,
        this.rotation,
        this.scaleX,
        this.scaleY,
        this.shearX,
        this.shearY
      );
    }
    updateWorldTransformWith(x, y, rotation, scaleX, scaleY, shearX, shearY) {
      this.ax = x;
      this.ay = y;
      this.arotation = rotation;
      this.ascaleX = scaleX;
      this.ascaleY = scaleY;
      this.ashearX = shearX;
      this.ashearY = shearY;
      const skeleton = this.skeleton;
      const sx = skeleton.scaleX;
      const sy = skeleton.scaleY;
      const parent = this.parent;
      if (!parent) {
        const rx = (rotation + shearX) * DEG_RAD;
        const ry = (rotation + 90 + shearY) * DEG_RAD;
        this.a = Math.cos(rx) * scaleX * sx;
        this.b = Math.cos(ry) * scaleY * sx;
        this.c = Math.sin(rx) * scaleX * sy;
        this.d = Math.sin(ry) * scaleY * sy;
        this.worldX = x * sx + skeleton.x;
        this.worldY = y * sy + skeleton.y;
        return;
      }
      let pa = parent.a;
      let pb = parent.b;
      let pc = parent.c;
      let pd = parent.d;
      this.worldX = pa * x + pb * y + parent.worldX;
      this.worldY = pc * x + pd * y + parent.worldY;
      switch (this.inherit) {
        case Inherit.Normal: {
          const rx = (rotation + shearX) * DEG_RAD;
          const ry = (rotation + 90 + shearY) * DEG_RAD;
          const la = Math.cos(rx) * scaleX;
          const lb = Math.cos(ry) * scaleY;
          const lc = Math.sin(rx) * scaleX;
          const ld = Math.sin(ry) * scaleY;
          this.a = pa * la + pb * lc;
          this.b = pa * lb + pb * ld;
          this.c = pc * la + pd * lc;
          this.d = pc * lb + pd * ld;
          return;
        }
        case Inherit.OnlyTranslation: {
          const rx = (rotation + shearX) * DEG_RAD;
          const ry = (rotation + 90 + shearY) * DEG_RAD;
          this.a = Math.cos(rx) * scaleX;
          this.b = Math.cos(ry) * scaleY;
          this.c = Math.sin(rx) * scaleX;
          this.d = Math.sin(ry) * scaleY;
          break;
        }
        case Inherit.NoRotationOrReflection: {
          const isx = 1 / sx;
          const isy = 1 / sy;
          pa *= isx;
          pc *= isy;
          let s = pa * pa + pc * pc;
          let prx;
          if (s > 1e-4) {
            s = Math.abs(pa * pd * isy - pb * isx * pc) / s;
            pb = pc * s;
            pd = pa * s;
            prx = Math.atan2(pc, pa) * RAD_DEG;
          } else {
            pa = 0;
            pc = 0;
            prx = 90 - Math.atan2(pd, pb) * RAD_DEG;
          }
          const rx = (rotation + shearX - prx) * DEG_RAD;
          const ry = (rotation + shearY - prx + 90) * DEG_RAD;
          const la = Math.cos(rx) * scaleX;
          const lb = Math.cos(ry) * scaleY;
          const lc = Math.sin(rx) * scaleX;
          const ld = Math.sin(ry) * scaleY;
          this.a = pa * la - pb * lc;
          this.b = pa * lb - pb * ld;
          this.c = pc * la + pd * lc;
          this.d = pc * lb + pd * ld;
          break;
        }
        case Inherit.NoScale:
        case Inherit.NoScaleOrReflection: {
          const r = rotation * DEG_RAD;
          const cos = Math.cos(r);
          const sin = Math.sin(r);
          let za = (pa * cos + pb * sin) / sx;
          let zc = (pc * cos + pd * sin) / sy;
          let s = Math.sqrt(za * za + zc * zc);
          if (s > 1e-5) s = 1 / s;
          za *= s;
          zc *= s;
          s = Math.sqrt(za * za + zc * zc);
          if (this.inherit === Inherit.NoScale && pa * pd - pb * pc < 0 !== (sx < 0 !== sy < 0))
            s = -s;
          const zr = Math.PI / 2 + Math.atan2(zc, za);
          const zb = Math.cos(zr) * s;
          const zd = Math.sin(zr) * s;
          const rx = shearX * DEG_RAD;
          const ry = (90 + shearY) * DEG_RAD;
          const la = Math.cos(rx) * scaleX;
          const lb = Math.cos(ry) * scaleY;
          const lc = Math.sin(rx) * scaleX;
          const ld = Math.sin(ry) * scaleY;
          this.a = za * la + zb * lc;
          this.b = za * lb + zb * ld;
          this.c = zc * la + zd * lc;
          this.d = zc * lb + zd * ld;
          break;
        }
      }
      this.a *= sx;
      this.b *= sx;
      this.c *= sy;
      this.d *= sy;
    }
    setToSetupPose() {
      const data = this.data;
      this.x = data.x;
      this.y = data.y;
      this.rotation = data.rotation;
      this.scaleX = data.scaleX;
      this.scaleY = data.scaleY;
      this.shearX = data.shearX;
      this.shearY = data.shearY;
      this.inherit = data.inherit;
    }
    /** Re-derives the applied local pose from the current world transform, after a constraint
     * edited the world transform directly. */
    updateAppliedTransform() {
      const parent = this.parent;
      const skeleton = this.skeleton;
      if (!parent) {
        this.ax = this.worldX - skeleton.x;
        this.ay = this.worldY - skeleton.y;
        this.arotation = Math.atan2(this.c, this.a) * RAD_DEG;
        this.ascaleX = Math.sqrt(this.a * this.a + this.c * this.c);
        this.ascaleY = Math.sqrt(this.b * this.b + this.d * this.d);
        this.ashearX = 0;
        this.ashearY = Math.atan2(this.a * this.b + this.c * this.d, this.a * this.d - this.b * this.c) * RAD_DEG;
        return;
      }
      let pa = parent.a;
      let pb = parent.b;
      let pc = parent.c;
      let pd = parent.d;
      let pid = 1 / (pa * pd - pb * pc);
      let ia = pd * pid;
      let ib = pb * pid;
      let ic = pc * pid;
      let id2 = pa * pid;
      const dx = this.worldX - parent.worldX;
      const dy = this.worldY - parent.worldY;
      this.ax = dx * ia - dy * ib;
      this.ay = dy * id2 - dx * ic;
      let ra;
      let rb;
      let rc;
      let rd;
      if (this.inherit === Inherit.OnlyTranslation) {
        ra = this.a;
        rb = this.b;
        rc = this.c;
        rd = this.d;
      } else {
        if (this.inherit === Inherit.NoRotationOrReflection) {
          const s = Math.abs(pa * pd - pb * pc) / (pa * pa + pc * pc);
          const sa = pa / skeleton.scaleX;
          const sc = pc / skeleton.scaleY;
          pb = -sc * s * skeleton.scaleX;
          pd = sa * s * skeleton.scaleY;
          pid = 1 / (pa * pd - pb * pc);
          ia = pd * pid;
          ib = pb * pid;
        } else if (this.inherit === Inherit.NoScale || this.inherit === Inherit.NoScaleOrReflection) {
          const cos = Math.cos(this.rotation * DEG_RAD);
          const sin = Math.sin(this.rotation * DEG_RAD);
          pa = (pa * cos + pb * sin) / skeleton.scaleX;
          pc = (pc * cos + pd * sin) / skeleton.scaleY;
          let s = Math.sqrt(pa * pa + pc * pc);
          if (s > 1e-5) s = 1 / s;
          pa *= s;
          pc *= s;
          s = Math.sqrt(pa * pa + pc * pc);
          if (this.inherit === Inherit.NoScale && pid < 0 !== (skeleton.scaleX < 0 !== skeleton.scaleY < 0))
            s = -s;
          const r = PI / 2 + Math.atan2(pc, pa);
          pb = Math.cos(r) * s;
          pd = Math.sin(r) * s;
          pid = 1 / (pa * pd - pb * pc);
          ia = pd * pid;
          ib = pb * pid;
          ic = pc * pid;
          id2 = pa * pid;
        }
        ra = ia * this.a - ib * this.c;
        rb = ia * this.b - ib * this.d;
        rc = id2 * this.c - ic * this.a;
        rd = id2 * this.d - ic * this.b;
      }
      this.ashearX = 0;
      this.ascaleX = Math.sqrt(ra * ra + rc * rc);
      if (this.ascaleX > 1e-4) {
        const det = ra * rd - rb * rc;
        this.ascaleY = det / this.ascaleX;
        this.ashearY = -Math.atan2(ra * rb + rc * rd, det) * RAD_DEG;
        this.arotation = Math.atan2(rc, ra) * RAD_DEG;
      } else {
        this.ascaleX = 0;
        this.ascaleY = Math.sqrt(rb * rb + rd * rd);
        this.ashearY = 0;
        this.arotation = 90 - Math.atan2(rd, rb) * RAD_DEG;
      }
    }
    getWorldRotationX() {
      return Math.atan2(this.c, this.a) * RAD_DEG;
    }
    getWorldRotationY() {
      return Math.atan2(this.d, this.b) * RAD_DEG;
    }
    getWorldScaleX() {
      return Math.sqrt(this.a * this.a + this.c * this.c);
    }
    getWorldScaleY() {
      return Math.sqrt(this.b * this.b + this.d * this.d);
    }
    worldToLocal(world) {
      const invDet = 1 / (this.a * this.d - this.b * this.c);
      const x = world.x - this.worldX;
      const y = world.y - this.worldY;
      world.x = x * this.d * invDet - y * this.b * invDet;
      world.y = y * this.a * invDet - x * this.c * invDet;
      return world;
    }
    localToWorld(local) {
      const x = local.x;
      const y = local.y;
      local.x = x * this.a + y * this.b + this.worldX;
      local.y = x * this.c + y * this.d + this.worldY;
      return local;
    }
    worldToParent(world) {
      if (!world) throw new Error("world cannot be null.");
      return this.parent ? this.parent.worldToLocal(world) : world;
    }
    parentToWorld(world) {
      if (!world) throw new Error("world cannot be null.");
      return this.parent ? this.parent.localToWorld(world) : world;
    }
    worldToLocalRotation(worldRotation) {
      const sin = Math.sin(worldRotation * DEG_RAD);
      const cos = Math.cos(worldRotation * DEG_RAD);
      return Math.atan2(this.a * sin - this.c * cos, this.d * cos - this.b * sin) * RAD_DEG + this.rotation - this.shearX;
    }
    localToWorldRotation(localRotation) {
      localRotation -= this.rotation + this.shearX;
      const sin = Math.sin(localRotation * DEG_RAD);
      const cos = Math.cos(localRotation * DEG_RAD);
      return Math.atan2(cos * this.c + sin * this.d, cos * this.a + sin * this.b) * RAD_DEG;
    }
    rotateWorld(degrees) {
      const r = degrees * DEG_RAD;
      const sin = Math.sin(r);
      const cos = Math.cos(r);
      const { a, b, c, d } = this;
      this.a = cos * a - sin * c;
      this.b = cos * b - sin * d;
      this.c = sin * a + cos * c;
      this.d = sin * b + cos * d;
    }
  }
  class Slot {
    constructor(data, bone) {
      this.data = data;
      this.bone = bone;
      this.color = new Color();
      this.attachment = null;
      this.attachmentState = 0;
      this.sequenceIndex = -1;
      this.deform = [];
      this.darkColor = data.darkColor ? new Color() : null;
      this.setToSetupPose();
    }
    getSkeleton() {
      return this.bone.skeleton;
    }
    getAttachment() {
      return this.attachment;
    }
    /** Swaps the attachment. Deform is kept only between two vertex attachments that share
     * timelines (a mesh and its linked meshes). */
    setAttachment(attachment) {
      if (this.attachment === attachment) return;
      const current = this.attachment;
      if (!(attachment instanceof VertexAttachment) || !(current instanceof VertexAttachment) || attachment.timelineAttachment !== current.timelineAttachment)
        this.deform.length = 0;
      this.attachment = attachment;
      this.sequenceIndex = -1;
    }
    setToSetupPose() {
      this.color.setFromColor(this.data.color);
      if (this.darkColor && this.data.darkColor) this.darkColor.setFromColor(this.data.darkColor);
      this.attachment = null;
      const name = this.data.attachmentName;
      if (name) this.setAttachment(this.bone.skeleton.getAttachment(this.data.index, name));
    }
  }
  var Physics = /* @__PURE__ */ ((Physics2) => {
    Physics2[Physics2["none"] = 0] = "none";
    Physics2[Physics2["reset"] = 1] = "reset";
    Physics2[Physics2["update"] = 2] = "update";
    Physics2[Physics2["pose"] = 3] = "pose";
    return Physics2;
  })(Physics || {});
  const wrapDegrees = (r) => r > 180 ? r - 360 : r < -180 ? r + 360 : r;
  class IkConstraint {
    constructor(data, skeleton) {
      this.data = data;
      this.bendDirection = 0;
      this.compress = false;
      this.stretch = false;
      this.mix = 1;
      this.softness = 0;
      this.active = false;
      this.bones = data.bones.map((b) => skeleton.bones[b.index]);
      this.target = skeleton.bones[data.target.index];
      this.setToSetupPose();
    }
    isActive() {
      return this.active;
    }
    setToSetupPose() {
      const d = this.data;
      this.mix = d.mix;
      this.softness = d.softness;
      this.bendDirection = d.bendDirection;
      this.compress = d.compress;
      this.stretch = d.stretch;
    }
    update(_physics) {
      if (this.mix === 0) return;
      const { target, bones } = this;
      if (bones.length === 1)
        this.apply1(
          bones[0],
          target.worldX,
          target.worldY,
          this.compress,
          this.stretch,
          this.data.uniform,
          this.mix
        );
      else if (bones.length === 2)
        this.apply2(
          bones[0],
          bones[1],
          target.worldX,
          target.worldY,
          this.bendDirection,
          this.stretch,
          this.data.uniform,
          this.softness,
          this.mix
        );
    }
    /** Rotates one bone to point at the target. */
    apply1(bone, targetX, targetY, compress, stretch, uniform, alpha) {
      const p = bone.parent;
      if (!p) throw new Error("IK bone must have parent.");
      const skeleton = bone.skeleton;
      let pa = p.a;
      let pb = p.b;
      const pc = p.c;
      let pd = p.d;
      let rotationIK = -bone.ashearX - bone.arotation;
      let tx = 0;
      let ty = 0;
      if (bone.inherit === Inherit.OnlyTranslation) {
        tx = (targetX - bone.worldX) * signum(skeleton.scaleX);
        ty = (targetY - bone.worldY) * signum(skeleton.scaleY);
      } else {
        if (bone.inherit === Inherit.NoRotationOrReflection) {
          const s = Math.abs(pa * pd - pb * pc) / Math.max(1e-4, pa * pa + pc * pc);
          const sa = pa / skeleton.scaleX;
          const sc = pc / skeleton.scaleY;
          pb = -sc * s * skeleton.scaleX;
          pd = sa * s * skeleton.scaleY;
          rotationIK += Math.atan2(sc, sa) * RAD_DEG;
        }
        const x = targetX - p.worldX;
        const y = targetY - p.worldY;
        const det = pa * pd - pb * pc;
        if (Math.abs(det) > 1e-4) {
          tx = (x * pd - y * pb) / det - bone.ax;
          ty = (y * pa - x * pc) / det - bone.ay;
        }
      }
      rotationIK += Math.atan2(ty, tx) * RAD_DEG;
      if (bone.ascaleX < 0) rotationIK += 180;
      rotationIK = wrapDegrees(rotationIK);
      let sx = bone.ascaleX;
      let sy = bone.ascaleY;
      if (compress || stretch) {
        if (bone.inherit === Inherit.NoScale || bone.inherit === Inherit.NoScaleOrReflection) {
          tx = targetX - bone.worldX;
          ty = targetY - bone.worldY;
        }
        const b = bone.data.length * sx;
        if (b > 1e-4) {
          const dd = tx * tx + ty * ty;
          if (compress && dd < b * b || stretch && dd > b * b) {
            const s = (Math.sqrt(dd) / b - 1) * alpha + 1;
            sx *= s;
            if (uniform) sy *= s;
          }
        }
      }
      bone.updateWorldTransformWith(
        bone.ax,
        bone.ay,
        bone.arotation + rotationIK * alpha,
        sx,
        sy,
        bone.ashearX,
        bone.ashearY
      );
    }
    /** Bends a parent/child chain so the child's tip reaches the target. */
    apply2(parent, child, targetX, targetY, bendDir, stretch, uniform, softness, alpha) {
      if (parent.inherit !== Inherit.Normal || child.inherit !== Inherit.Normal) return;
      const px = parent.ax;
      const py = parent.ay;
      let psx = parent.ascaleX;
      let psy = parent.ascaleY;
      let sx = psx;
      let sy = psy;
      let csx = child.ascaleX;
      let os1;
      let os2;
      let s2;
      if (psx < 0) {
        psx = -psx;
        os1 = 180;
        s2 = -1;
      } else {
        os1 = 0;
        s2 = 1;
      }
      if (psy < 0) {
        psy = -psy;
        s2 = -s2;
      }
      if (csx < 0) {
        csx = -csx;
        os2 = 180;
      } else os2 = 0;
      const cx = child.ax;
      let cy;
      let cwx;
      let cwy;
      let a = parent.a;
      let b = parent.b;
      let c = parent.c;
      let d = parent.d;
      const uniformParent = Math.abs(psx - psy) <= 1e-4;
      if (!uniformParent || stretch) {
        cy = 0;
        cwx = a * cx + parent.worldX;
        cwy = c * cx + parent.worldY;
      } else {
        cy = child.ay;
        cwx = a * cx + b * cy + parent.worldX;
        cwy = c * cx + d * cy + parent.worldY;
      }
      const pp = parent.parent;
      if (!pp) throw new Error("IK parent must itself have a parent.");
      a = pp.a;
      b = pp.b;
      c = pp.c;
      d = pp.d;
      let id2 = a * d - b * c;
      let x = cwx - pp.worldX;
      let y = cwy - pp.worldY;
      id2 = Math.abs(id2) <= 1e-4 ? 0 : 1 / id2;
      const dx = (x * d - y * b) * id2 - px;
      const dy = (y * a - x * c) * id2 - py;
      const l1 = Math.sqrt(dx * dx + dy * dy);
      let l2 = child.data.length * csx;
      let a1;
      let a2;
      if (l1 < 1e-4) {
        this.apply1(parent, targetX, targetY, false, stretch, false, alpha);
        child.updateWorldTransformWith(
          cx,
          cy,
          0,
          child.ascaleX,
          child.ascaleY,
          child.ashearX,
          child.ashearY
        );
        return;
      }
      x = targetX - pp.worldX;
      y = targetY - pp.worldY;
      let tx = (x * d - y * b) * id2 - px;
      let ty = (y * a - x * c) * id2 - py;
      let dd = tx * tx + ty * ty;
      if (softness !== 0) {
        softness *= psx * (csx + 1) * 0.5;
        const td = Math.sqrt(dd);
        const sd = td - l1 - l2 * psx + softness;
        if (sd > 0) {
          let p = Math.min(1, sd / (softness * 2)) - 1;
          p = (sd - softness * (1 - p * p)) / td;
          tx -= p * tx;
          ty -= p * ty;
          dd = tx * tx + ty * ty;
        }
      }
      solve: if (uniformParent) {
        l2 *= psx;
        let cos = (dd - l1 * l1 - l2 * l2) / (2 * l1 * l2);
        if (cos < -1) {
          cos = -1;
          a2 = PI * bendDir;
        } else if (cos > 1) {
          cos = 1;
          a2 = 0;
          if (stretch) {
            const s = (Math.sqrt(dd) / (l1 + l2) - 1) * alpha + 1;
            sx *= s;
            if (uniform) sy *= s;
          }
        } else a2 = Math.acos(cos) * bendDir;
        const ca = l1 + l2 * cos;
        const cb = l2 * Math.sin(a2);
        a1 = Math.atan2(ty * ca - tx * cb, tx * ca + ty * cb);
      } else {
        const ea = psx * l2;
        const eb = psy * l2;
        const aa = ea * ea;
        const bb = eb * eb;
        const ta = Math.atan2(ty, tx);
        let k = bb * l1 * l1 + aa * dd - aa * bb;
        const c1 = -2 * bb * l1;
        const c2 = bb - aa;
        const disc = c1 * c1 - 4 * c2 * k;
        if (disc >= 0) {
          let q = Math.sqrt(disc);
          if (c1 < 0) q = -q;
          q = -(c1 + q) * 0.5;
          const r0 = q / c2;
          const r1 = k / q;
          const r = Math.abs(r0) < Math.abs(r1) ? r0 : r1;
          const rr = dd - r * r;
          if (rr >= 0) {
            y = Math.sqrt(rr) * bendDir;
            a1 = ta - Math.atan2(y, r);
            a2 = Math.atan2(y / psy, (r - l1) / psx);
            break solve;
          }
        }
        let minAngle = PI;
        let minX = l1 - ea;
        let minDist = minX * minX;
        let minY = 0;
        let maxAngle = 0;
        let maxX = l1 + ea;
        let maxDist = maxX * maxX;
        let maxY = 0;
        k = -ea * l1 / (aa - bb);
        if (k >= -1 && k <= 1) {
          k = Math.acos(k);
          x = ea * Math.cos(k) + l1;
          y = eb * Math.sin(k);
          const dist = x * x + y * y;
          if (dist < minDist) {
            minAngle = k;
            minDist = dist;
            minX = x;
            minY = y;
          }
          if (dist > maxDist) {
            maxAngle = k;
            maxDist = dist;
            maxX = x;
            maxY = y;
          }
        }
        if (dd <= (minDist + maxDist) * 0.5) {
          a1 = ta - Math.atan2(minY * bendDir, minX);
          a2 = minAngle * bendDir;
        } else {
          a1 = ta - Math.atan2(maxY * bendDir, maxX);
          a2 = maxAngle * bendDir;
        }
      }
      const os = Math.atan2(cy, cx) * s2;
      let rotation = parent.arotation;
      a1 = wrapDegrees((a1 - os) * RAD_DEG + os1 - rotation);
      parent.updateWorldTransformWith(px, py, rotation + a1 * alpha, sx, sy, 0, 0);
      rotation = child.arotation;
      a2 = wrapDegrees(((a2 + os) * RAD_DEG - child.ashearX) * s2 + os2 - rotation);
      child.updateWorldTransformWith(
        cx,
        cy,
        rotation + a2 * alpha,
        child.ascaleX,
        child.ascaleY,
        child.ashearX,
        child.ashearY
      );
    }
  }
  class TransformConstraint {
    constructor(data, skeleton) {
      this.data = data;
      this.mixRotate = 0;
      this.mixX = 0;
      this.mixY = 0;
      this.mixScaleX = 0;
      this.mixScaleY = 0;
      this.mixShearY = 0;
      this.temp = new Vector2();
      this.active = false;
      this.bones = data.bones.map((b) => skeleton.bones[b.index]);
      this.target = skeleton.bones[data.target.index];
      this.setToSetupPose();
    }
    isActive() {
      return this.active;
    }
    setToSetupPose() {
      const d = this.data;
      this.mixRotate = d.mixRotate;
      this.mixX = d.mixX;
      this.mixY = d.mixY;
      this.mixScaleX = d.mixScaleX;
      this.mixScaleY = d.mixScaleY;
      this.mixShearY = d.mixShearY;
    }
    update(_physics) {
      if (this.mixRotate === 0 && this.mixX === 0 && this.mixY === 0 && this.mixScaleX === 0 && this.mixScaleY === 0 && this.mixShearY === 0)
        return;
      if (this.data.local) {
        if (this.data.relative) this.applyRelativeLocal();
        else this.applyAbsoluteLocal();
      } else if (this.data.relative) this.applyRelativeWorld();
      else this.applyAbsoluteWorld();
    }
    applyAbsoluteWorld() {
      const { mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, target, data } = this;
      const translate = mixX !== 0 || mixY !== 0;
      const { a: ta, b: tb, c: tc, d: td } = target;
      const reflect = ta * td - tb * tc > 0 ? DEG_RAD : -DEG_RAD;
      const offsetRotation = data.offsetRotation * reflect;
      const offsetShearY = data.offsetShearY * reflect;
      for (const bone of this.bones) {
        if (mixRotate !== 0) {
          const r = wrapRadians(Math.atan2(tc, ta) - Math.atan2(bone.c, bone.a) + offsetRotation) * mixRotate;
          rotateBoneWorld(bone, r);
        }
        if (translate) {
          const t = target.localToWorld(this.temp.set(data.offsetX, data.offsetY));
          bone.worldX += (t.x - bone.worldX) * mixX;
          bone.worldY += (t.y - bone.worldY) * mixY;
        }
        if (mixScaleX !== 0) {
          let s = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
          if (s !== 0)
            s = (s + (Math.sqrt(ta * ta + tc * tc) - s + data.offsetScaleX) * mixScaleX) / s;
          bone.a *= s;
          bone.c *= s;
        }
        if (mixScaleY !== 0) {
          let s = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
          if (s !== 0)
            s = (s + (Math.sqrt(tb * tb + td * td) - s + data.offsetScaleY) * mixScaleY) / s;
          bone.b *= s;
          bone.d *= s;
        }
        if (mixShearY > 0) {
          const b = bone.b;
          const d = bone.d;
          const by = Math.atan2(d, b);
          const r = wrapRadians(
            Math.atan2(td, tb) - Math.atan2(tc, ta) - (by - Math.atan2(bone.c, bone.a))
          );
          const angle = by + (r + offsetShearY) * mixShearY;
          const s = Math.sqrt(b * b + d * d);
          bone.b = Math.cos(angle) * s;
          bone.d = Math.sin(angle) * s;
        }
        bone.updateAppliedTransform();
      }
    }
    applyRelativeWorld() {
      const { mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, target, data } = this;
      const translate = mixX !== 0 || mixY !== 0;
      const { a: ta, b: tb, c: tc, d: td } = target;
      const reflect = ta * td - tb * tc > 0 ? DEG_RAD : -DEG_RAD;
      const offsetRotation = data.offsetRotation * reflect;
      const offsetShearY = data.offsetShearY * reflect;
      for (const bone of this.bones) {
        if (mixRotate !== 0)
          rotateBoneWorld(bone, wrapRadians(Math.atan2(tc, ta) + offsetRotation) * mixRotate);
        if (translate) {
          const t = target.localToWorld(this.temp.set(data.offsetX, data.offsetY));
          bone.worldX += t.x * mixX;
          bone.worldY += t.y * mixY;
        }
        if (mixScaleX !== 0) {
          const s = (Math.sqrt(ta * ta + tc * tc) - 1 + data.offsetScaleX) * mixScaleX + 1;
          bone.a *= s;
          bone.c *= s;
        }
        if (mixScaleY !== 0) {
          const s = (Math.sqrt(tb * tb + td * td) - 1 + data.offsetScaleY) * mixScaleY + 1;
          bone.b *= s;
          bone.d *= s;
        }
        if (mixShearY > 0) {
          const r = wrapRadians(Math.atan2(td, tb) - Math.atan2(tc, ta));
          const b = bone.b;
          const d = bone.d;
          const angle = Math.atan2(d, b) + (r - PI / 2 + offsetShearY) * mixShearY;
          const s = Math.sqrt(b * b + d * d);
          bone.b = Math.cos(angle) * s;
          bone.d = Math.sin(angle) * s;
        }
        bone.updateAppliedTransform();
      }
    }
    applyAbsoluteLocal() {
      const { mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, target, data } = this;
      for (const bone of this.bones) {
        let rotation = bone.arotation;
        if (mixRotate !== 0)
          rotation += (target.arotation - rotation + data.offsetRotation) * mixRotate;
        let x = bone.ax;
        let y = bone.ay;
        x += (target.ax - x + data.offsetX) * mixX;
        y += (target.ay - y + data.offsetY) * mixY;
        let scaleX = bone.ascaleX;
        let scaleY = bone.ascaleY;
        if (mixScaleX !== 0 && scaleX !== 0)
          scaleX = (scaleX + (target.ascaleX - scaleX + data.offsetScaleX) * mixScaleX) / scaleX;
        if (mixScaleY !== 0 && scaleY !== 0)
          scaleY = (scaleY + (target.ascaleY - scaleY + data.offsetScaleY) * mixScaleY) / scaleY;
        let shearY = bone.ashearY;
        if (mixShearY !== 0) shearY += (target.ashearY - shearY + data.offsetShearY) * mixShearY;
        bone.updateWorldTransformWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
      }
    }
    applyRelativeLocal() {
      const { mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, target, data } = this;
      for (const bone of this.bones) {
        const rotation = bone.arotation + (target.arotation + data.offsetRotation) * mixRotate;
        const x = bone.ax + (target.ax + data.offsetX) * mixX;
        const y = bone.ay + (target.ay + data.offsetY) * mixY;
        const scaleX = bone.ascaleX * ((target.ascaleX - 1 + data.offsetScaleX) * mixScaleX + 1);
        const scaleY = bone.ascaleY * ((target.ascaleY - 1 + data.offsetScaleY) * mixScaleY + 1);
        const shearY = bone.ashearY + (target.ashearY + data.offsetShearY) * mixShearY;
        bone.updateWorldTransformWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
      }
    }
  }
  function rotateBoneWorld(bone, r) {
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const { a, b, c, d } = bone;
    bone.a = cos * a - sin * c;
    bone.b = cos * b - sin * d;
    bone.c = sin * a + cos * c;
    bone.d = sin * b + cos * d;
  }
  function bezierAt(t, p0, p1, p2, p3) {
    const u = 1 - t;
    return p0 * u * u * u + 3 * p1 * u * u * t + 3 * p2 * u * t * t + p3 * t * t * t;
  }
  function chordLengths(steps, x1, y1, cx1, cy1, cx2, cy2, x2, y2, out) {
    let px = x1;
    let py = y1;
    let total = 0;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = bezierAt(t, x1, cx1, cx2, x2);
      const y = bezierAt(t, y1, cy1, cy2, y2);
      total += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      out[k - 1] = total;
      px = x;
      py = y;
    }
    return total;
  }
  const BEFORE = -2;
  const AFTER = -3;
  const EPSILON = 1e-5;
  const NONE = -1;
  class PathConstraint {
    constructor(data, skeleton) {
      this.data = data;
      this.position = 0;
      this.spacing = 0;
      this.mixRotate = 0;
      this.mixX = 0;
      this.mixY = 0;
      this.spaces = [];
      this.positions = [];
      this.world = [];
      this.curves = [];
      this.lengths = [];
      this.segments = [];
      this.active = false;
      this.bones = data.bones.map((b) => skeleton.bones[b.index]);
      this.target = skeleton.slots[data.target.index];
      this.setToSetupPose();
    }
    isActive() {
      return this.active;
    }
    setToSetupPose() {
      const d = this.data;
      this.position = d.position;
      this.spacing = d.spacing;
      this.mixRotate = d.mixRotate;
      this.mixX = d.mixX;
      this.mixY = d.mixY;
    }
    update(_physics) {
      const attachment = this.target.getAttachment();
      if (!(attachment instanceof PathAttachment)) return;
      const { mixRotate, mixX, mixY, data, bones } = this;
      if (mixRotate === 0 && mixX === 0 && mixY === 0) return;
      const tangents = data.rotateMode === RotateMode.Tangent;
      const scale = data.rotateMode === RotateMode.ChainScale;
      const boneCount = bones.length;
      const spacesCount = tangents ? boneCount : boneCount + 1;
      const spaces = this.spaces;
      spaces.length = spacesCount;
      const lengths = this.lengths;
      if (scale) lengths.length = boneCount;
      const spacing = this.spacing;
      const boneLength = (bone) => {
        const l = bone.data.length;
        const x = l * bone.a;
        const y = l * bone.c;
        return Math.sqrt(x * x + y * y);
      };
      spaces[0] = 0;
      switch (data.spacingMode) {
        case SpacingMode.Percent:
          if (scale) for (let i = 0; i < spacesCount - 1; i++) lengths[i] = boneLength(bones[i]);
          for (let i = 1; i < spacesCount; i++) spaces[i] = spacing;
          break;
        case SpacingMode.Proportional: {
          let sum = 0;
          for (let i = 0; i < spacesCount - 1; i++) {
            const bone = bones[i];
            if (bone.data.length < EPSILON) {
              if (scale) lengths[i] = 0;
              spaces[i + 1] = spacing;
            } else {
              const length = boneLength(bone);
              if (scale) lengths[i] = length;
              spaces[i + 1] = length;
              sum += length;
            }
          }
          if (sum > 0) {
            const f = spacesCount / sum * spacing;
            for (let i = 1; i < spacesCount; i++) spaces[i] *= f;
          }
          break;
        }
        default: {
          const lengthSpacing = data.spacingMode === SpacingMode.Length;
          for (let i = 0; i < spacesCount - 1; i++) {
            const bone = bones[i];
            const setupLength = bone.data.length;
            if (setupLength < EPSILON) {
              if (scale) lengths[i] = 0;
              spaces[i + 1] = spacing;
            } else {
              const length = boneLength(bone);
              if (scale) lengths[i] = length;
              spaces[i + 1] = (lengthSpacing ? setupLength + spacing : spacing) * length / setupLength;
            }
          }
        }
      }
      const positions = this.computeWorldPositions(attachment, spacesCount, tangents);
      let boneX = positions[0];
      let boneY = positions[1];
      let offsetRotation = data.offsetRotation;
      let tip;
      if (offsetRotation === 0) tip = data.rotateMode === RotateMode.Chain;
      else {
        tip = false;
        const p = this.target.bone;
        offsetRotation *= p.a * p.d - p.b * p.c > 0 ? DEG_RAD : -DEG_RAD;
      }
      for (let i = 0, p = 3; i < boneCount; i++, p += 3) {
        const bone = bones[i];
        bone.worldX += (boneX - bone.worldX) * mixX;
        bone.worldY += (boneY - bone.worldY) * mixY;
        const x = positions[p];
        const y = positions[p + 1];
        const dx = x - boneX;
        const dy = y - boneY;
        if (scale) {
          const length = lengths[i];
          if (length !== 0) {
            const s = (Math.sqrt(dx * dx + dy * dy) / length - 1) * mixRotate + 1;
            bone.a *= s;
            bone.c *= s;
          }
        }
        boneX = x;
        boneY = y;
        if (mixRotate > 0) {
          const { a, c } = bone;
          let r;
          if (tangents) r = positions[p - 1];
          else if (spaces[i + 1] === 0) r = positions[p + 2];
          else r = Math.atan2(dy, dx);
          r -= Math.atan2(c, a);
          if (tip) {
            const cos = Math.cos(r);
            const sin = Math.sin(r);
            const length = bone.data.length;
            boneX += (length * (cos * a - sin * c) - dx) * mixRotate;
            boneY += (length * (sin * a + cos * c) - dy) * mixRotate;
          } else r += offsetRotation;
          rotateBoneWorld(bone, wrapRadians(r) * mixRotate);
        }
        bone.updateAppliedTransform();
      }
    }
    computeWorldPositions(path, spacesCount, tangents) {
      const target = this.target;
      let position = this.position;
      const spaces = this.spaces;
      const out = this.positions;
      out.length = spacesCount * 3 + 2;
      const closed = path.closed;
      let verticesLength = path.worldVerticesLength;
      let curveCount = verticesLength / 6;
      let prevCurve = NONE;
      const data = this.data;
      if (!path.constantSpeed) {
        const lengths = path.lengths;
        curveCount -= closed ? 1 : 2;
        const pathLength2 = lengths[curveCount];
        if (data.positionMode === PositionMode.Percent) position *= pathLength2;
        const multiplier2 = data.spacingMode === SpacingMode.Percent ? pathLength2 : data.spacingMode === SpacingMode.Proportional ? pathLength2 / spacesCount : 1;
        const world2 = this.world;
        world2.length = 8;
        for (let i = 0, o = 0, curve = 0; i < spacesCount; i++, o += 3) {
          const space = spaces[i] * multiplier2;
          position += space;
          let p = position;
          if (closed) {
            p %= pathLength2;
            if (p < 0) p += pathLength2;
            curve = 0;
          } else if (p < 0) {
            if (prevCurve !== BEFORE) {
              prevCurve = BEFORE;
              path.computeWorldVertices(target, 2, 4, world2, 0, 2);
            }
            addBeforePosition(p, world2, 0, out, o);
            continue;
          } else if (p > pathLength2) {
            if (prevCurve !== AFTER) {
              prevCurve = AFTER;
              path.computeWorldVertices(target, verticesLength - 6, 4, world2, 0, 2);
            }
            addAfterPosition(p - pathLength2, world2, 0, out, o);
            continue;
          }
          for (; ; curve++) {
            const length = lengths[curve];
            if (p > length) continue;
            if (curve === 0) p /= length;
            else {
              const prev = lengths[curve - 1];
              p = (p - prev) / (length - prev);
            }
            break;
          }
          if (curve !== prevCurve) {
            prevCurve = curve;
            if (closed && curve === curveCount) {
              path.computeWorldVertices(target, verticesLength - 4, 4, world2, 0, 2);
              path.computeWorldVertices(target, 0, 4, world2, 4, 2);
            } else path.computeWorldVertices(target, curve * 6 + 2, 8, world2, 0, 2);
          }
          addCurvePosition(
            p,
            world2[0],
            world2[1],
            world2[2],
            world2[3],
            world2[4],
            world2[5],
            world2[6],
            world2[7],
            out,
            o,
            tangents || i > 0 && space === 0
          );
        }
        return out;
      }
      const world = this.world;
      if (closed) {
        verticesLength += 2;
        world.length = verticesLength;
        path.computeWorldVertices(target, 2, verticesLength - 4, world, 0, 2);
        path.computeWorldVertices(target, 0, 2, world, verticesLength - 4, 2);
        world[verticesLength - 2] = world[0];
        world[verticesLength - 1] = world[1];
      } else {
        curveCount--;
        verticesLength -= 4;
        world.length = verticesLength;
        path.computeWorldVertices(target, 2, verticesLength, world, 0, 2);
      }
      const curves = this.curves;
      curves.length = curveCount;
      const scratch = [];
      let pathLength = 0;
      for (let i = 0, w = 0; i < curveCount; i++, w += 6) {
        pathLength += chordLengths(
          4,
          world[w],
          world[w + 1],
          world[w + 2],
          world[w + 3],
          world[w + 4],
          world[w + 5],
          world[w + 6],
          world[w + 7],
          scratch
        );
        curves[i] = pathLength;
      }
      if (data.positionMode === PositionMode.Percent) position *= pathLength;
      const multiplier = data.spacingMode === SpacingMode.Percent ? pathLength : data.spacingMode === SpacingMode.Proportional ? pathLength / spacesCount : 1;
      const segments = this.segments;
      let curveLength = 0;
      let x1 = 0;
      let y1 = 0;
      let cx1 = 0;
      let cy1 = 0;
      let cx2 = 0;
      let cy2 = 0;
      let x2 = 0;
      let y2 = 0;
      for (let i = 0, o = 0, curve = 0, segment = 0; i < spacesCount; i++, o += 3) {
        const space = spaces[i] * multiplier;
        position += space;
        let p = position;
        if (closed) {
          p %= pathLength;
          if (p < 0) p += pathLength;
          curve = 0;
        } else if (p < 0) {
          addBeforePosition(p, world, 0, out, o);
          continue;
        } else if (p > pathLength) {
          addAfterPosition(p - pathLength, world, verticesLength - 4, out, o);
          continue;
        }
        for (; ; curve++) {
          const length = curves[curve];
          if (p > length) continue;
          if (curve === 0) p /= length;
          else {
            const prev = curves[curve - 1];
            p = (p - prev) / (length - prev);
          }
          break;
        }
        if (curve !== prevCurve) {
          prevCurve = curve;
          const ii = curve * 6;
          x1 = world[ii];
          y1 = world[ii + 1];
          cx1 = world[ii + 2];
          cy1 = world[ii + 3];
          cx2 = world[ii + 4];
          cy2 = world[ii + 5];
          x2 = world[ii + 6];
          y2 = world[ii + 7];
          curveLength = chordLengths(10, x1, y1, cx1, cy1, cx2, cy2, x2, y2, segments);
          segment = 0;
        }
        p *= curveLength;
        for (; ; segment++) {
          const length = segments[segment];
          if (p > length) continue;
          if (segment === 0) p /= length;
          else {
            const prev = segments[segment - 1];
            p = segment + (p - prev) / (length - prev);
          }
          break;
        }
        addCurvePosition(
          p * 0.1,
          x1,
          y1,
          cx1,
          cy1,
          cx2,
          cy2,
          x2,
          y2,
          out,
          o,
          tangents || i > 0 && space === 0
        );
      }
      return out;
    }
  }
  function addBeforePosition(p, temp, i, out, o) {
    const x1 = temp[i];
    const y1 = temp[i + 1];
    const r = Math.atan2(temp[i + 3] - y1, temp[i + 2] - x1);
    out[o] = x1 + p * Math.cos(r);
    out[o + 1] = y1 + p * Math.sin(r);
    out[o + 2] = r;
  }
  function addAfterPosition(p, temp, i, out, o) {
    const x1 = temp[i + 2];
    const y1 = temp[i + 3];
    const r = Math.atan2(y1 - temp[i + 1], x1 - temp[i]);
    out[o] = x1 + p * Math.cos(r);
    out[o + 1] = y1 + p * Math.sin(r);
    out[o + 2] = r;
  }
  function addCurvePosition(p, x1, y1, cx1, cy1, cx2, cy2, x2, y2, out, o, tangents) {
    if (p === 0 || isNaN(p)) {
      out[o] = x1;
      out[o + 1] = y1;
      out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
      return;
    }
    const x = bezierAt(p, x1, cx1, cx2, x2);
    const y = bezierAt(p, y1, cy1, cy2, y2);
    out[o] = x;
    out[o + 1] = y;
    if (!tangents) return;
    if (p < 1e-3) {
      out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
      return;
    }
    const u = 1 - p;
    const qx = x1 * u * u + cx1 * u * p * 2 + cx2 * p * p;
    const qy = y1 * u * u + cy1 * u * p * 2 + cy2 * p * p;
    out[o + 2] = Math.atan2(y - qy, x - qx);
  }
  class PhysicsConstraint {
    constructor(data, skeleton) {
      this.data = data;
      this.skeleton = skeleton;
      this.inertia = 0;
      this.strength = 0;
      this.damping = 0;
      this.massInverse = 0;
      this.wind = 0;
      this.gravity = 0;
      this.mix = 0;
      this.needsReset = true;
      this.ux = 0;
      this.uy = 0;
      this.cx = 0;
      this.cy = 0;
      this.tx = 0;
      this.ty = 0;
      this.xOffset = 0;
      this.xVelocity = 0;
      this.yOffset = 0;
      this.yVelocity = 0;
      this.rotateOffset = 0;
      this.rotateVelocity = 0;
      this.scaleOffset = 0;
      this.scaleVelocity = 0;
      this.active = false;
      this.remaining = 0;
      this.lastTime = 0;
      this.bone = skeleton.bones[data.bone.index];
      this.setToSetupPose();
    }
    isActive() {
      return this.active;
    }
    reset() {
      this.remaining = 0;
      this.lastTime = this.skeleton.time;
      this.needsReset = true;
      this.xOffset = 0;
      this.xVelocity = 0;
      this.yOffset = 0;
      this.yVelocity = 0;
      this.rotateOffset = 0;
      this.rotateVelocity = 0;
      this.scaleOffset = 0;
      this.scaleVelocity = 0;
    }
    setToSetupPose() {
      const d = this.data;
      this.inertia = d.inertia;
      this.strength = d.strength;
      this.damping = d.damping;
      this.massInverse = d.massInverse;
      this.wind = d.wind;
      this.gravity = d.gravity;
      this.mix = d.mix;
    }
    /** Moves the simulation as if the skeleton moved by (x, y) in world space. */
    translate(x, y) {
      this.ux -= x;
      this.uy -= y;
      this.cx -= x;
      this.cy -= y;
    }
    /** Rotates the simulation as if the skeleton rotated around (x, y). */
    rotate(x, y, degrees) {
      const r = degrees * DEG_RAD;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const dx = this.cx - x;
      const dy = this.cy - y;
      this.translate(dx * cos - dy * sin - dx, dx * sin + dy * cos - dy);
    }
    update(physics) {
      const mix = this.mix;
      if (mix === 0) return;
      const data = this.data;
      const doX = data.x > 0;
      const doY = data.y > 0;
      const rotateOrShearX = data.rotate > 0 || data.shearX > 0;
      const doScaleX = data.scaleX > 0;
      const bone = this.bone;
      const l = bone.data.length;
      const skeleton = this.skeleton;
      switch (physics) {
        case Physics.none:
          return;
        case Physics.reset:
        case Physics.update: {
          if (physics === Physics.reset) this.reset();
          const delta = Math.max(skeleton.time - this.lastTime, 0);
          this.remaining += delta;
          this.lastTime = skeleton.time;
          const bx = bone.worldX;
          const by = bone.worldY;
          if (this.needsReset) {
            this.needsReset = false;
            this.ux = bx;
            this.uy = by;
          } else {
            let a = this.remaining;
            const inertia = this.inertia;
            const step = data.step;
            const f = skeleton.data.referenceScale;
            let damp = -1;
            let qx = data.limit * delta;
            const qy = qx * Math.abs(skeleton.scaleY);
            qx *= Math.abs(skeleton.scaleX);
            if (doX || doY) {
              if (doX) {
                const u = (this.ux - bx) * inertia;
                this.xOffset += u > qx ? qx : u < -qx ? -qx : u;
                this.ux = bx;
              }
              if (doY) {
                const u = (this.uy - by) * inertia;
                this.yOffset += u > qy ? qy : u < -qy ? -qy : u;
                this.uy = by;
              }
              if (a >= step) {
                damp = Math.pow(this.damping, 60 * step);
                const m = this.massInverse * step;
                const e = this.strength;
                const w = this.wind * f * skeleton.scaleX;
                const g = this.gravity * f * skeleton.scaleY;
                do {
                  if (doX) {
                    this.xVelocity += (w - this.xOffset * e) * m;
                    this.xOffset += this.xVelocity * step;
                    this.xVelocity *= damp;
                  }
                  if (doY) {
                    this.yVelocity -= (g + this.yOffset * e) * m;
                    this.yOffset += this.yVelocity * step;
                    this.yVelocity *= damp;
                  }
                  a -= step;
                } while (a >= step);
              }
              if (doX) bone.worldX += this.xOffset * mix * data.x;
              if (doY) bone.worldY += this.yOffset * mix * data.y;
            }
            if (rotateOrShearX || doScaleX) {
              const ca = Math.atan2(bone.c, bone.a);
              let c = 0;
              let s = 0;
              let mr = 0;
              let dx = this.cx - bone.worldX;
              let dy = this.cy - bone.worldY;
              if (dx > qx) dx = qx;
              else if (dx < -qx) dx = -qx;
              if (dy > qy) dy = qy;
              else if (dy < -qy) dy = -qy;
              if (rotateOrShearX) {
                mr = (data.rotate + data.shearX) * mix;
                let r = Math.atan2(dy + this.ty, dx + this.tx) - ca - this.rotateOffset * mr;
                this.rotateOffset += (r - Math.ceil(r / PI2 - 0.5) * PI2) * inertia;
                r = this.rotateOffset * mr + ca;
                c = Math.cos(r);
                s = Math.sin(r);
                if (doScaleX) {
                  r = l * bone.getWorldScaleX();
                  if (r > 0) this.scaleOffset += (dx * c + dy * s) * inertia / r;
                }
              } else {
                c = Math.cos(ca);
                s = Math.sin(ca);
                const r = l * bone.getWorldScaleX();
                if (r > 0) this.scaleOffset += (dx * c + dy * s) * inertia / r;
              }
              a = this.remaining;
              if (a >= step) {
                if (damp === -1) damp = Math.pow(this.damping, 60 * step);
                const m = this.massInverse * step;
                const e = this.strength;
                const w = this.wind;
                const g = skeleton.yDown ? -this.gravity : this.gravity;
                const h = l / f;
                for (; ; ) {
                  a -= step;
                  if (doScaleX) {
                    this.scaleVelocity += (w * c - g * s - this.scaleOffset * e) * m;
                    this.scaleOffset += this.scaleVelocity * step;
                    this.scaleVelocity *= damp;
                  }
                  if (rotateOrShearX) {
                    this.rotateVelocity -= ((w * s + g * c) * h + this.rotateOffset * e) * m;
                    this.rotateOffset += this.rotateVelocity * step;
                    this.rotateVelocity *= damp;
                    if (a < step) break;
                    const r = this.rotateOffset * mr + ca;
                    c = Math.cos(r);
                    s = Math.sin(r);
                  } else if (a < step) break;
                }
              }
            }
            this.remaining = a;
          }
          this.cx = bone.worldX;
          this.cy = bone.worldY;
          break;
        }
        case Physics.pose:
          if (doX) bone.worldX += this.xOffset * mix * data.x;
          if (doY) bone.worldY += this.yOffset * mix * data.y;
      }
      if (rotateOrShearX) {
        let o = this.rotateOffset * mix;
        if (data.shearX > 0) {
          let r = 0;
          if (data.rotate > 0) {
            r = o * data.rotate;
            const s2 = Math.sin(r);
            const c2 = Math.cos(r);
            const b = bone.b;
            bone.b = c2 * b - s2 * bone.d;
            bone.d = s2 * b + c2 * bone.d;
          }
          r += o * data.shearX;
          const s = Math.sin(r);
          const c = Math.cos(r);
          const a = bone.a;
          bone.a = c * a - s * bone.c;
          bone.c = s * a + c * bone.c;
        } else {
          o *= data.rotate;
          rotateBoneWorld(bone, o);
        }
      }
      if (doScaleX) {
        const s = 1 + this.scaleOffset * mix * data.scaleX;
        bone.a *= s;
        bone.c *= s;
      }
      if (physics !== Physics.pose) {
        this.tx = l * bone.a;
        this.ty = l * bone.c;
      }
      bone.updateAppliedTransform();
    }
  }
  const QUAD_TRIANGLES = [0, 1, 2, 2, 3, 0];
  const _Skeleton = class _Skeleton {
    constructor(data) {
      this.data = data;
      this.bones = [];
      this.slots = [];
      this.drawOrder = [];
      this.ikConstraints = [];
      this.transformConstraints = [];
      this.pathConstraints = [];
      this.physicsConstraints = [];
      this._updateCache = [];
      this.skin = null;
      this.color = new Color(1, 1, 1, 1);
      this.scaleX = 1;
      this._scaleY = 1;
      this.x = 0;
      this.y = 0;
      this.time = 0;
      this.yDown = _Skeleton.yDown;
      if (!data) throw new Error("data cannot be null.");
      for (const boneData of data.bones) {
        const parent = boneData.parent ? this.bones[boneData.parent.index] : null;
        const bone = new Bone(boneData, this, parent);
        parent == null ? void 0 : parent.children.push(bone);
        this.bones.push(bone);
      }
      for (const slotData of data.slots) {
        const slot = new Slot(slotData, this.bones[slotData.boneData.index]);
        this.slots.push(slot);
        this.drawOrder.push(slot);
      }
      for (const c of data.ikConstraints) this.ikConstraints.push(new IkConstraint(c, this));
      for (const c of data.transformConstraints)
        this.transformConstraints.push(new TransformConstraint(c, this));
      for (const c of data.pathConstraints) this.pathConstraints.push(new PathConstraint(c, this));
      for (const c of data.physicsConstraints)
        this.physicsConstraints.push(new PhysicsConstraint(c, this));
      this.updateCache();
    }
    get scaleY() {
      return this.yDown ? -this._scaleY : this._scaleY;
    }
    set scaleY(value) {
      this._scaleY = value;
    }
    /** Orders bones and constraints so each is updated after everything it depends on. */
    updateCache() {
      const cache = [];
      this._updateCache = cache;
      for (const bone of this.bones) {
        bone.sorted = bone.data.skinRequired;
        bone.active = !bone.sorted;
      }
      if (this.skin) {
        for (const boneData of this.skin.bones) {
          let bone = this.bones[boneData.index];
          while (bone) {
            bone.sorted = false;
            bone.active = true;
            bone = bone.parent;
          }
        }
      }
      const sortBone = (bone) => {
        if (!bone || bone.sorted) return;
        sortBone(bone.parent);
        bone.sorted = true;
        cache.push(bone);
      };
      const sortReset = (bones) => {
        for (const bone of bones) {
          if (!bone.active) continue;
          if (bone.sorted) sortReset(bone.children);
          bone.sorted = false;
        }
      };
      const inSkin = (c) => !c.skinRequired || !!this.skin && this.skin.constraints.includes(c);
      const sortPathAttachment = (attachment, slotBone) => {
        if (!(attachment instanceof PathAttachment)) return;
        const pathBones = attachment.bones;
        if (!pathBones) {
          sortBone(slotBone);
          return;
        }
        for (let i = 0; i < pathBones.length; ) {
          const n = pathBones[i++];
          for (const end = i + n; i < end; i++) sortBone(this.bones[pathBones[i]]);
        }
      };
      const sortPathSkin = (skin, slotIndex, slotBone) => {
        const map = skin.attachments[slotIndex];
        if (!map) return;
        for (const key of Object.keys(map)) sortPathAttachment(map[key], slotBone);
      };
      const sortIk = (c) => {
        c.active = c.target.isActive() && inSkin(c.data);
        if (!c.active) return;
        sortBone(c.target);
        const parent = c.bones[0];
        sortBone(parent);
        if (c.bones.length === 1) {
          cache.push(c);
          sortReset(parent.children);
        } else {
          const child = c.bones[c.bones.length - 1];
          sortBone(child);
          cache.push(c);
          sortReset(parent.children);
          child.sorted = true;
        }
      };
      const sortTransform = (c) => {
        c.active = c.target.isActive() && inSkin(c.data);
        if (!c.active) return;
        sortBone(c.target);
        if (c.data.local) {
          for (const child of c.bones) {
            sortBone(child.parent);
            sortBone(child);
          }
        } else for (const bone of c.bones) sortBone(bone);
        cache.push(c);
        for (const bone of c.bones) sortReset(bone.children);
        for (const bone of c.bones) bone.sorted = true;
      };
      const sortPath = (c) => {
        c.active = c.target.bone.isActive() && inSkin(c.data);
        if (!c.active) return;
        const slot = c.target;
        const slotIndex = slot.data.index;
        const slotBone = slot.bone;
        if (this.skin) sortPathSkin(this.skin, slotIndex, slotBone);
        if (this.data.defaultSkin && this.data.defaultSkin !== this.skin)
          sortPathSkin(this.data.defaultSkin, slotIndex, slotBone);
        for (const skin of this.data.skins) sortPathSkin(skin, slotIndex, slotBone);
        sortPathAttachment(slot.getAttachment(), slotBone);
        for (const bone of c.bones) sortBone(bone);
        cache.push(c);
        for (const bone of c.bones) sortReset(bone.children);
        for (const bone of c.bones) bone.sorted = true;
      };
      const sortPhysics = (c) => {
        const bone = c.bone;
        c.active = bone.active && inSkin(c.data);
        if (!c.active) return;
        sortBone(bone);
        cache.push(c);
        sortReset(bone.children);
        bone.sorted = true;
      };
      const total = this.ikConstraints.length + this.transformConstraints.length + this.pathConstraints.length + this.physicsConstraints.length;
      for (let order = 0; order < total; order++) {
        const ik = this.ikConstraints.find((c) => c.data.order === order);
        if (ik) {
          sortIk(ik);
          continue;
        }
        const transform = this.transformConstraints.find((c) => c.data.order === order);
        if (transform) {
          sortTransform(transform);
          continue;
        }
        const path = this.pathConstraints.find((c) => c.data.order === order);
        if (path) {
          sortPath(path);
          continue;
        }
        const physics = this.physicsConstraints.find((c) => c.data.order === order);
        if (physics) sortPhysics(physics);
      }
      for (const bone of this.bones) sortBone(bone);
    }
    updateWorldTransform(physics) {
      if (physics === void 0 || physics === null) throw new Error("physics is undefined");
      for (const bone of this.bones) {
        bone.ax = bone.x;
        bone.ay = bone.y;
        bone.arotation = bone.rotation;
        bone.ascaleX = bone.scaleX;
        bone.ascaleY = bone.scaleY;
        bone.ashearX = bone.shearX;
        bone.ashearY = bone.shearY;
      }
      for (const updatable of this._updateCache) updatable.update(physics);
    }
    /** Updates the world transform as if `parent` were the root's parent. */
    updateWorldTransformWith(physics, parent) {
      const root = this.getRootBone();
      if (!root) return;
      const { a: pa, b: pb, c: pc, d: pd } = parent;
      root.worldX = pa * this.x + pb * this.y + parent.worldX;
      root.worldY = pc * this.x + pd * this.y + parent.worldY;
      const rx = (root.rotation + root.shearX) * DEG_RAD;
      const ry = (root.rotation + 90 + root.shearY) * DEG_RAD;
      const la = Math.cos(rx) * root.scaleX;
      const lb = Math.cos(ry) * root.scaleY;
      const lc = Math.sin(rx) * root.scaleX;
      const ld = Math.sin(ry) * root.scaleY;
      root.a = (pa * la + pb * lc) * this.scaleX;
      root.b = (pa * lb + pb * ld) * this.scaleX;
      root.c = (pc * la + pd * lc) * this.scaleY;
      root.d = (pc * lb + pd * ld) * this.scaleY;
      for (const updatable of this._updateCache) if (updatable !== root) updatable.update(physics);
    }
    setToSetupPose() {
      this.setBonesToSetupPose();
      this.setSlotsToSetupPose();
    }
    setBonesToSetupPose() {
      for (const bone of this.bones) bone.setToSetupPose();
      for (const c of this.ikConstraints) c.setToSetupPose();
      for (const c of this.transformConstraints) c.setToSetupPose();
      for (const c of this.pathConstraints) c.setToSetupPose();
      for (const c of this.physicsConstraints) c.setToSetupPose();
    }
    setSlotsToSetupPose() {
      this.drawOrder.length = 0;
      for (const slot of this.slots) this.drawOrder.push(slot);
      for (const slot of this.slots) slot.setToSetupPose();
    }
    getRootBone() {
      return this.bones.length ? this.bones[0] : null;
    }
    findBone(name) {
      if (!name) throw new Error("boneName cannot be null.");
      return this.bones.find((b) => b.data.name === name) ?? null;
    }
    findSlot(name) {
      if (!name) throw new Error("slotName cannot be null.");
      return this.slots.find((s) => s.data.name === name) ?? null;
    }
    setSkinByName(name) {
      const skin = this.data.findSkin(name);
      if (!skin) throw new Error("Skin not found: " + name);
      this.setSkin(skin);
    }
    /** Switches skin. Slots showing an attachment of the old skin take the new skin's attachment of
     * the same name; with no old skin, slots take the new skin's setup attachment when it has one. */
    setSkin(newSkin) {
      if (newSkin === this.skin) return;
      if (newSkin) {
        if (this.skin) newSkin.attachAll(this, this.skin);
        else {
          this.slots.forEach((slot, i) => {
            const name = slot.data.attachmentName;
            if (!name) return;
            const attachment = newSkin.getAttachment(i, name);
            if (attachment) slot.setAttachment(attachment);
          });
        }
      }
      this.skin = newSkin;
      this.updateCache();
    }
    getAttachmentByName(slotName, attachmentName) {
      const slot = this.data.findSlot(slotName);
      if (!slot) throw new Error(`Can't find slot with name ${slotName}`);
      return this.getAttachment(slot.index, attachmentName);
    }
    getAttachment(slotIndex, attachmentName) {
      var _a;
      if (!attachmentName) throw new Error("attachmentName cannot be null.");
      if (this.skin) {
        const attachment = this.skin.getAttachment(slotIndex, attachmentName);
        if (attachment) return attachment;
      }
      return ((_a = this.data.defaultSkin) == null ? void 0 : _a.getAttachment(slotIndex, attachmentName)) ?? null;
    }
    setAttachment(slotName, attachmentName) {
      if (!slotName) throw new Error("slotName cannot be null.");
      const index = this.slots.findIndex((s) => s.data.name === slotName);
      if (index === -1) throw new Error("Slot not found: " + slotName);
      let attachment = null;
      if (attachmentName) {
        attachment = this.getAttachment(index, attachmentName);
        if (!attachment)
          throw new Error(`Attachment not found: ${attachmentName}, for slot: ${slotName}`);
      }
      this.slots[index].setAttachment(attachment);
    }
    findIkConstraint(name) {
      return this.ikConstraints.find((c) => c.data.name === name) ?? null;
    }
    findTransformConstraint(name) {
      return this.transformConstraints.find((c) => c.data.name === name) ?? null;
    }
    findPathConstraint(name) {
      return this.pathConstraints.find((c) => c.data.name === name) ?? null;
    }
    findPhysicsConstraint(name) {
      return this.physicsConstraints.find((c) => c.data.name === name) ?? null;
    }
    getBoundsRect(clipper) {
      const offset = { x: 0, y: 0 };
      const size = { x: 0, y: 0 };
      this.getBounds(offset, size, [], clipper ?? null);
      return { x: offset.x, y: offset.y, width: size.x, height: size.y };
    }
    /** Axis-aligned bounds of every visible region and mesh in the current pose. */
    getBounds(offset, size, temp = [], clipper = null) {
      if (!offset) throw new Error("offset cannot be null.");
      if (!size) throw new Error("size cannot be null.");
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const slot of this.drawOrder) {
        if (!slot.bone.active) continue;
        let vertices = null;
        let count = 0;
        let triangles = null;
        const attachment = slot.getAttachment();
        if (attachment instanceof RegionAttachment) {
          count = 8;
          temp.length = 8;
          attachment.computeWorldVertices(slot, temp, 0, 2);
          vertices = temp;
          triangles = QUAD_TRIANGLES;
        } else if (attachment instanceof MeshAttachment) {
          count = attachment.worldVerticesLength;
          temp.length = count;
          attachment.computeWorldVertices(slot, 0, count, temp, 0, 2);
          vertices = temp;
          triangles = attachment.triangles;
        } else if (attachment instanceof ClippingAttachment && clipper) {
          clipper.clipStart(slot, attachment);
          continue;
        }
        if (vertices && triangles) {
          if (clipper && clipper.isClipping()) {
            clipper.clipTriangles(vertices, triangles, triangles.length);
            vertices = clipper.clippedVertices;
            count = clipper.clippedVertices.length;
          }
          for (let i = 0; i < count; i += 2) {
            const x = vertices[i];
            const y = vertices[i + 1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
        clipper == null ? void 0 : clipper.clipEndWithSlot(slot);
      }
      clipper == null ? void 0 : clipper.clipEnd();
      setPoint(offset, minX, minY);
      setPoint(size, maxX - minX, maxY - minY);
    }
    /** Advances the skeleton clock used by physics. */
    update(delta) {
      this.time += delta;
    }
    physicsTranslate(x, y) {
      for (const c of this.physicsConstraints) c.translate(x, y);
    }
    physicsRotate(x, y, degrees) {
      for (const c of this.physicsConstraints) c.rotate(x, y, degrees);
    }
  };
  _Skeleton.quadTriangles = QUAD_TRIANGLES;
  _Skeleton.yDown = false;
  let Skeleton = _Skeleton;
  function setPoint(p, x, y) {
    if (typeof p.set === "function") p.set(x, y);
    else {
      p.x = x;
      p.y = y;
    }
  }
  class Event {
    constructor(time, data) {
      this.time = time;
      this.data = data;
      this.intValue = 0;
      this.floatValue = 0;
      this.stringValue = null;
      this.volume = 0;
      this.balance = 0;
      if (!data) throw new Error("data cannot be null.");
    }
  }
  var MixBlend = /* @__PURE__ */ ((MixBlend2) => {
    MixBlend2[MixBlend2["setup"] = 0] = "setup";
    MixBlend2[MixBlend2["first"] = 1] = "first";
    MixBlend2[MixBlend2["replace"] = 2] = "replace";
    MixBlend2[MixBlend2["add"] = 3] = "add";
    return MixBlend2;
  })(MixBlend || {});
  var MixDirection = /* @__PURE__ */ ((MixDirection2) => {
    MixDirection2[MixDirection2["mixIn"] = 0] = "mixIn";
    MixDirection2[MixDirection2["mixOut"] = 1] = "mixOut";
    return MixDirection2;
  })(MixDirection || {});
  var Property = /* @__PURE__ */ ((Property2) => {
    Property2[Property2["rotate"] = 0] = "rotate";
    Property2[Property2["x"] = 1] = "x";
    Property2[Property2["y"] = 2] = "y";
    Property2[Property2["scaleX"] = 3] = "scaleX";
    Property2[Property2["scaleY"] = 4] = "scaleY";
    Property2[Property2["shearX"] = 5] = "shearX";
    Property2[Property2["shearY"] = 6] = "shearY";
    Property2[Property2["inherit"] = 7] = "inherit";
    Property2[Property2["rgb"] = 8] = "rgb";
    Property2[Property2["alpha"] = 9] = "alpha";
    Property2[Property2["rgb2"] = 10] = "rgb2";
    Property2[Property2["attachment"] = 11] = "attachment";
    Property2[Property2["deform"] = 12] = "deform";
    Property2[Property2["event"] = 13] = "event";
    Property2[Property2["drawOrder"] = 14] = "drawOrder";
    Property2[Property2["ikConstraint"] = 15] = "ikConstraint";
    Property2[Property2["transformConstraint"] = 16] = "transformConstraint";
    Property2[Property2["pathConstraintPosition"] = 17] = "pathConstraintPosition";
    Property2[Property2["pathConstraintSpacing"] = 18] = "pathConstraintSpacing";
    Property2[Property2["pathConstraintMix"] = 19] = "pathConstraintMix";
    Property2[Property2["physicsConstraintInertia"] = 20] = "physicsConstraintInertia";
    Property2[Property2["physicsConstraintStrength"] = 21] = "physicsConstraintStrength";
    Property2[Property2["physicsConstraintDamping"] = 22] = "physicsConstraintDamping";
    Property2[Property2["physicsConstraintMass"] = 23] = "physicsConstraintMass";
    Property2[Property2["physicsConstraintWind"] = 24] = "physicsConstraintWind";
    Property2[Property2["physicsConstraintGravity"] = 25] = "physicsConstraintGravity";
    Property2[Property2["physicsConstraintMix"] = 26] = "physicsConstraintMix";
    Property2[Property2["physicsConstraintReset"] = 27] = "physicsConstraintReset";
    Property2[Property2["sequence"] = 28] = "sequence";
    return Property2;
  })(Property || {});
  const id = (...parts) => parts.join("|");
  class Animation {
    constructor(name, timelines, duration) {
      this.name = name;
      this.duration = duration;
      this.timelines = [];
      this.timelineIds = /* @__PURE__ */ new Set();
      if (!name) throw new Error("name cannot be null.");
      this.setTimelines(timelines);
    }
    setTimelines(timelines) {
      this.timelines = timelines;
      this.timelineIds.clear();
      for (const t of timelines) for (const pid of t.getPropertyIds()) this.timelineIds.add(pid);
    }
    hasTimeline(ids) {
      return ids.some((pid) => this.timelineIds.has(pid));
    }
    /** Poses the skeleton at `time`, firing events keyed in (`lastTime`, `time`] into `events`. */
    apply(skeleton, lastTime, time, loop, events, alpha, blend, direction) {
      if (!skeleton) throw new Error("skeleton cannot be null.");
      if (loop && this.duration !== 0) {
        time %= this.duration;
        if (lastTime > 0) lastTime %= this.duration;
      }
      for (const timeline of this.timelines)
        timeline.apply(skeleton, lastTime, time, events, alpha, blend, direction);
    }
  }
  class Timeline {
    constructor(frameCount, propertyIds) {
      this.propertyIds = propertyIds;
      this.frames = new Float32Array(frameCount * this.getFrameEntries());
    }
    put(offset, ...values) {
      for (let k = 0; k < values.length; k++) this.frames[offset + k] = values[k];
    }
    getPropertyIds() {
      return this.propertyIds;
    }
    getFrameEntries() {
      return 1;
    }
    getFrameCount() {
      return this.frames.length / this.getFrameEntries();
    }
    getDuration() {
      return this.frames[this.frames.length - this.getFrameEntries()];
    }
    /** Index of the last frame whose time is <= `time` (frames hold one entry each). */
    static search1(frames, time) {
      const n = frames.length;
      for (let i = 1; i < n; i++) if (frames[i] > time) return i - 1;
      return n - 1;
    }
    /** Entry offset of the last frame whose time is <= `time`. */
    static search(frames, time, step) {
      const n = frames.length;
      for (let i = step; i < n; i += step) if (frames[i] > time) return i - step;
      return n - step;
    }
  }
  const LINEAR = 0;
  const STEPPED = 1;
  const BEZIER = 2;
  const BEZIER_POINTS = 9;
  class CurveTimeline extends Timeline {
    constructor(frameCount, _bezierCount, propertyIds) {
      super(frameCount, propertyIds);
      this.beziers = [];
      this.curveTypes = new Array(frameCount).fill(LINEAR);
      if (frameCount > 0) this.curveTypes[frameCount - 1] = STEPPED;
    }
    /** Number of interpolated values per frame. */
    valueCount() {
      return this.getFrameEntries() - 1;
    }
    setLinear(frame) {
      this.curveTypes[frame] = LINEAR;
    }
    setStepped(frame) {
      this.curveTypes[frame] = STEPPED;
    }
    /** Kept for API compatibility; curve storage is allocated per frame. */
    shrink(_bezierCount) {
    }
    /** Samples the cubic (time1,value1) (cx1,cy1) (cx2,cy2) (time2,value2) for one value of a frame. */
    setBezier(_bezier, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2) {
      this.curveTypes[frame] = BEZIER;
      const samples = new Float32Array(BEZIER_POINTS * 2);
      for (let k = 1; k <= BEZIER_POINTS; k++) {
        const t = k / 10;
        const u = 1 - t;
        const b0 = u * u * u;
        const b1 = 3 * u * u * t;
        const b2 = 3 * u * t * t;
        const b3 = t * t * t;
        samples[(k - 1) * 2] = b0 * time1 + b1 * cx1 + b2 * cx2 + b3 * time2;
        samples[(k - 1) * 2 + 1] = b0 * value1 + b1 * cy1 + b2 * cy2 + b3 * value2;
      }
      this.beziers[frame * Math.max(1, this.valueCount()) + value] = samples;
    }
    /** Value `value` (0-based) at `time`, given `i`, the entry offset of the frame at or before it. */
    valueAt(time, i, value) {
      const frames = this.frames;
      const entries = this.getFrameEntries();
      const frame = i / entries;
      const v0 = frames[i + 1 + value];
      switch (this.curveTypes[frame]) {
        case LINEAR: {
          const t0 = frames[i];
          const t = (time - t0) / (frames[i + entries] - t0);
          return v0 + (frames[i + entries + 1 + value] - v0) * t;
        }
        case STEPPED:
          return v0;
      }
      return this.bezierValue(time, i, frames[i + 1 + value], frames[i + entries + 1 + value], value);
    }
    bezierValue(time, i, v0, v1, value) {
      const frames = this.frames;
      const entries = this.getFrameEntries();
      const frame = i / entries;
      const s = this.beziers[frame * Math.max(1, this.valueCount()) + value];
      if (!s) return v0;
      if (s[0] > time) {
        const x2 = frames[i];
        return v0 + (time - x2) / (s[0] - x2) * (s[1] - v0);
      }
      const n = BEZIER_POINTS * 2;
      for (let k = 2; k < n; k += 2) {
        if (s[k] >= time) {
          const x2 = s[k - 2];
          const y2 = s[k - 1];
          return y2 + (time - x2) / (s[k] - x2) * (s[k + 1] - y2);
        }
      }
      const x = s[n - 2];
      const y = s[n - 1];
      return y + (time - x) / (frames[i + entries] - x) * (v1 - y);
    }
  }
  class CurveTimeline1 extends CurveTimeline {
    getFrameEntries() {
      return 2;
    }
    setFrame(frame, time, value) {
      frame <<= 1;
      this.frames[frame] = time;
      this.frames[frame + 1] = value;
    }
    getCurveValue(time) {
      return this.valueAt(time, Timeline.search(this.frames, time, 2), 0);
    }
    /** For values keyed as an offset from setup (rotation, translation, shear). */
    getRelativeValue(time, alpha, blend, current, setup) {
      if (time < this.frames[0]) {
        if (blend === 0) return setup;
        if (blend === 1) return current + (setup - current) * alpha;
        return current;
      }
      let value = this.getCurveValue(time);
      if (blend === 0) return setup + value * alpha;
      if (blend === 1 || blend === 2) value += setup - current;
      return current + value * alpha;
    }
    /** For values keyed as absolutes (mixes, path position/spacing, physics settings). */
    getAbsoluteValue(time, alpha, blend, current, setup, value) {
      if (time < this.frames[0]) {
        if (blend === 0) return setup;
        if (blend === 1) return current + (setup - current) * alpha;
        return current;
      }
      const v = value === void 0 ? this.getCurveValue(time) : value;
      if (blend === 0) return setup + (v - setup) * alpha;
      return current + (v - current) * alpha;
    }
    /** For scale, keyed as a multiple of setup; mixing keeps the sign of the side mixed from. */
    getScaleValue(time, alpha, blend, direction, current, setup) {
      if (time < this.frames[0]) {
        if (blend === 0) return setup;
        if (blend === 1) return current + (setup - current) * alpha;
        return current;
      }
      const value = this.getCurveValue(time) * setup;
      if (alpha === 1) return blend === 3 ? current + value - setup : value;
      if (direction === 1) {
        if (blend === 0)
          return setup + (Math.abs(value) * signum(setup) - setup) * alpha;
        if (blend === 1 || blend === 2)
          return current + (Math.abs(value) * signum(current) - current) * alpha;
      } else {
        if (blend === 0) {
          const s = Math.abs(setup) * signum(value);
          return s + (value - s) * alpha;
        }
        if (blend === 1 || blend === 2) {
          const s = Math.abs(current) * signum(value);
          return s + (value - s) * alpha;
        }
      }
      return current + (value - setup) * alpha;
    }
  }
  class CurveTimeline2 extends CurveTimeline {
    getFrameEntries() {
      return 3;
    }
    setFrame(frame, time, value1, value2) {
      frame *= 3;
      this.frames[frame] = time;
      this.frames[frame + 1] = value1;
      this.frames[frame + 2] = value2;
    }
    values2(time) {
      const i = Timeline.search(this.frames, time, 3);
      return [this.valueAt(time, i, 0), this.valueAt(time, i, 1)];
    }
  }
  class RotateTimeline extends CurveTimeline1 {
    constructor(frameCount, bezierCount, boneIndex) {
      super(frameCount, bezierCount, [id(0, boneIndex)]);
      this.boneIndex = boneIndex;
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const bone = skeleton.bones[this.boneIndex];
      if (bone.active)
        bone.rotation = this.getRelativeValue(time, alpha, blend, bone.rotation, bone.data.rotation);
    }
  }
  class RelativePairTimeline extends CurveTimeline2 {
    constructor(frameCount, bezierCount, boneIndex, propertyIds, fields) {
      super(frameCount, bezierCount, propertyIds);
      this.boneIndex = boneIndex;
      this.fields = fields;
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const bone = skeleton.bones[this.boneIndex];
      if (!bone.active) return;
      const [fx, fy] = this.fields;
      const setupX = bone.data[fx];
      const setupY = bone.data[fy];
      if (time < this.frames[0]) {
        if (blend === 0) {
          bone[fx] = setupX;
          bone[fy] = setupY;
        } else if (blend === 1) {
          bone[fx] += (setupX - bone[fx]) * alpha;
          bone[fy] += (setupY - bone[fy]) * alpha;
        }
        return;
      }
      const [x, y] = this.values2(time);
      switch (blend) {
        case 0:
          bone[fx] = setupX + x * alpha;
          bone[fy] = setupY + y * alpha;
          break;
        case 1:
        case 2:
          bone[fx] += (setupX + x - bone[fx]) * alpha;
          bone[fy] += (setupY + y - bone[fy]) * alpha;
          break;
        case 3:
          bone[fx] += x * alpha;
          bone[fy] += y * alpha;
      }
    }
  }
  class TranslateTimeline extends RelativePairTimeline {
    constructor(frameCount, bezierCount, boneIndex) {
      super(
        frameCount,
        bezierCount,
        boneIndex,
        [id(1, boneIndex), id(2, boneIndex)],
        ["x", "y"]
      );
    }
  }
  class ShearTimeline extends RelativePairTimeline {
    constructor(frameCount, bezierCount, boneIndex) {
      super(
        frameCount,
        bezierCount,
        boneIndex,
        [id(5, boneIndex), id(6, boneIndex)],
        ["shearX", "shearY"]
      );
    }
  }
  class BoneValueTimeline extends CurveTimeline1 {
    constructor(frameCount, bezierCount, boneIndex, property, field) {
      super(frameCount, bezierCount, [id(property, boneIndex)]);
      this.boneIndex = boneIndex;
      this.field = field;
    }
  }
  class RelativeValueTimeline extends BoneValueTimeline {
    apply(skeleton, _l, time, _e, alpha, blend) {
      const bone = skeleton.bones[this.boneIndex];
      if (bone.active)
        bone[this.field] = this.getRelativeValue(
          time,
          alpha,
          blend,
          bone[this.field],
          bone.data[this.field]
        );
    }
  }
  class TranslateXTimeline extends RelativeValueTimeline {
    constructor(frameCount, bezierCount, boneIndex) {
      super(frameCount, bezierCount, boneIndex, 1, "x");
    }
  }
  class TranslateYTimeline extends RelativeValueTimeline {
    constructor(frameCount, bezierCount, boneIndex) {
      super(frameCount, bezierCount, boneIndex, 2, "y");
    }
  }
  class ShearXTimeline extends RelativeValueTimeline {
    constructor(frameCount, bezierCount, boneIndex) {
      super(frameCount, bezierCount, boneIndex, 5, "shearX");
    }
  }
  class ShearYTimeline extends RelativeValueTimeline {
    constructor(frameCount, bezierCount, boneIndex) {
      super(frameCount, bezierCount, boneIndex, 6, "shearY");
    }
  }
  class ScaleTimeline extends CurveTimeline2 {
    constructor(frameCount, bezierCount, boneIndex) {
      super(frameCount, bezierCount, [
        id(3, boneIndex),
        id(4, boneIndex)
      ]);
      this.boneIndex = boneIndex;
    }
    apply(skeleton, _l, time, _e, alpha, blend, direction) {
      const bone = skeleton.bones[this.boneIndex];
      if (!bone.active) return;
      const data = bone.data;
      if (time < this.frames[0]) {
        if (blend === 0) {
          bone.scaleX = data.scaleX;
          bone.scaleY = data.scaleY;
        } else if (blend === 1) {
          bone.scaleX += (data.scaleX - bone.scaleX) * alpha;
          bone.scaleY += (data.scaleY - bone.scaleY) * alpha;
        }
        return;
      }
      const [kx, ky] = this.values2(time);
      const x = kx * data.scaleX;
      const y = ky * data.scaleY;
      if (alpha === 1) {
        if (blend === 3) {
          bone.scaleX += x - data.scaleX;
          bone.scaleY += y - data.scaleY;
        } else {
          bone.scaleX = x;
          bone.scaleY = y;
        }
        return;
      }
      if (blend === 3) {
        bone.scaleX += (x - data.scaleX) * alpha;
        bone.scaleY += (y - data.scaleY) * alpha;
        return;
      }
      if (direction === 1) {
        const bx = blend === 0 ? data.scaleX : bone.scaleX;
        const by = blend === 0 ? data.scaleY : bone.scaleY;
        bone.scaleX = bx + (Math.abs(x) * signum(bx) - bx) * alpha;
        bone.scaleY = by + (Math.abs(y) * signum(by) - by) * alpha;
      } else {
        const fromX = blend === 0 ? data.scaleX : bone.scaleX;
        const fromY = blend === 0 ? data.scaleY : bone.scaleY;
        const bx = Math.abs(fromX) * signum(x);
        const by = Math.abs(fromY) * signum(y);
        bone.scaleX = bx + (x - bx) * alpha;
        bone.scaleY = by + (y - by) * alpha;
      }
    }
  }
  class ScaleValueTimeline extends BoneValueTimeline {
    apply(skeleton, _l, time, _e, alpha, blend, direction) {
      const bone = skeleton.bones[this.boneIndex];
      if (bone.active)
        bone[this.field] = this.getScaleValue(
          time,
          alpha,
          blend,
          direction,
          bone[this.field],
          bone.data[this.field]
        );
    }
  }
  class ScaleXTimeline extends ScaleValueTimeline {
    constructor(frameCount, bezierCount, boneIndex) {
      super(frameCount, bezierCount, boneIndex, 3, "scaleX");
    }
  }
  class ScaleYTimeline extends ScaleValueTimeline {
    constructor(frameCount, bezierCount, boneIndex) {
      super(frameCount, bezierCount, boneIndex, 4, "scaleY");
    }
  }
  class InheritTimeline extends Timeline {
    constructor(frameCount, boneIndex) {
      super(frameCount, [id(7, boneIndex)]);
      this.boneIndex = boneIndex;
    }
    getFrameEntries() {
      return 2;
    }
    setFrame(frame, time, inherit) {
      frame *= 2;
      this.frames[frame] = time;
      this.frames[frame + 1] = inherit;
    }
    apply(skeleton, _l, time, _e, _alpha, blend, direction) {
      const bone = skeleton.bones[this.boneIndex];
      if (!bone.active) return;
      if (direction === 1) {
        if (blend === 0) bone.inherit = bone.data.inherit;
        return;
      }
      if (time < this.frames[0]) {
        if (blend === 0 || blend === 1) bone.inherit = bone.data.inherit;
        return;
      }
      bone.inherit = this.frames[Timeline.search(this.frames, time, 2) + 1];
    }
  }
  class RGBATimeline extends CurveTimeline {
    constructor(frameCount, bezierCount, slotIndex) {
      super(frameCount, bezierCount, [id(8, slotIndex), id(9, slotIndex)]);
      this.slotIndex = slotIndex;
    }
    getFrameEntries() {
      return 5;
    }
    setFrame(frame, time, r, g, b, a) {
      frame *= 5;
      this.put(frame, time, r, g, b, a);
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const slot = skeleton.slots[this.slotIndex];
      if (!slot.bone.active) return;
      const color = slot.color;
      const setup = slot.data.color;
      if (time < this.frames[0]) {
        if (blend === 0) color.setFromColor(setup);
        else if (blend === 1)
          color.add(
            (setup.r - color.r) * alpha,
            (setup.g - color.g) * alpha,
            (setup.b - color.b) * alpha,
            (setup.a - color.a) * alpha
          );
        return;
      }
      const i = Timeline.search(this.frames, time, 5);
      const r = this.valueAt(time, i, 0);
      const g = this.valueAt(time, i, 1);
      const b = this.valueAt(time, i, 2);
      const a = this.valueAt(time, i, 3);
      if (alpha === 1) color.set(r, g, b, a);
      else {
        if (blend === 0) color.setFromColor(setup);
        color.add(
          (r - color.r) * alpha,
          (g - color.g) * alpha,
          (b - color.b) * alpha,
          (a - color.a) * alpha
        );
      }
    }
  }
  class RGBTimeline extends CurveTimeline {
    constructor(frameCount, bezierCount, slotIndex) {
      super(frameCount, bezierCount, [id(8, slotIndex)]);
      this.slotIndex = slotIndex;
    }
    getFrameEntries() {
      return 4;
    }
    setFrame(frame, time, r, g, b) {
      frame *= 4;
      this.put(frame, time, r, g, b);
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const slot = skeleton.slots[this.slotIndex];
      if (!slot.bone.active) return;
      const color = slot.color;
      const setup = slot.data.color;
      if (time < this.frames[0]) {
        if (blend === 0) {
          color.r = setup.r;
          color.g = setup.g;
          color.b = setup.b;
        } else if (blend === 1) {
          color.r += (setup.r - color.r) * alpha;
          color.g += (setup.g - color.g) * alpha;
          color.b += (setup.b - color.b) * alpha;
        }
        return;
      }
      const i = Timeline.search(this.frames, time, 4);
      const r = this.valueAt(time, i, 0);
      const g = this.valueAt(time, i, 1);
      const b = this.valueAt(time, i, 2);
      if (alpha === 1) {
        color.r = r;
        color.g = g;
        color.b = b;
      } else {
        if (blend === 0) {
          color.r = setup.r;
          color.g = setup.g;
          color.b = setup.b;
        }
        color.r += (r - color.r) * alpha;
        color.g += (g - color.g) * alpha;
        color.b += (b - color.b) * alpha;
      }
    }
  }
  class AlphaTimeline extends CurveTimeline1 {
    constructor(frameCount, bezierCount, slotIndex) {
      super(frameCount, bezierCount, [id(9, slotIndex)]);
      this.slotIndex = slotIndex;
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const slot = skeleton.slots[this.slotIndex];
      if (!slot.bone.active) return;
      const color = slot.color;
      const setup = slot.data.color;
      if (time < this.frames[0]) {
        if (blend === 0) color.a = setup.a;
        else if (blend === 1) color.a += (setup.a - color.a) * alpha;
        return;
      }
      const a = this.getCurveValue(time);
      if (alpha === 1) color.a = a;
      else {
        if (blend === 0) color.a = setup.a;
        color.a += (a - color.a) * alpha;
      }
    }
  }
  class RGBA2Timeline extends CurveTimeline {
    constructor(frameCount, bezierCount, slotIndex) {
      super(frameCount, bezierCount, [
        id(8, slotIndex),
        id(9, slotIndex),
        id(10, slotIndex)
      ]);
      this.slotIndex = slotIndex;
    }
    getFrameEntries() {
      return 8;
    }
    setFrame(frame, time, r, g, b, a, r2, g2, b2) {
      frame *= 8;
      this.put(frame, time, r, g, b, a, r2, g2, b2);
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const slot = skeleton.slots[this.slotIndex];
      if (!slot.bone.active) return;
      const light = slot.color;
      const dark = slot.darkColor;
      const setupLight = slot.data.color;
      const setupDark = slot.data.darkColor;
      if (!dark || !setupDark) return;
      if (time < this.frames[0]) {
        if (blend === 0) {
          light.setFromColor(setupLight);
          dark.r = setupDark.r;
          dark.g = setupDark.g;
          dark.b = setupDark.b;
        } else if (blend === 1) {
          light.add(
            (setupLight.r - light.r) * alpha,
            (setupLight.g - light.g) * alpha,
            (setupLight.b - light.b) * alpha,
            (setupLight.a - light.a) * alpha
          );
          dark.r += (setupDark.r - dark.r) * alpha;
          dark.g += (setupDark.g - dark.g) * alpha;
          dark.b += (setupDark.b - dark.b) * alpha;
        }
        return;
      }
      const i = Timeline.search(this.frames, time, 8);
      const v = [0, 1, 2, 3, 4, 5, 6].map((k) => this.valueAt(time, i, k));
      if (alpha === 1) {
        light.set(v[0], v[1], v[2], v[3]);
        dark.r = v[4];
        dark.g = v[5];
        dark.b = v[6];
      } else {
        if (blend === 0) {
          light.setFromColor(setupLight);
          dark.r = setupDark.r;
          dark.g = setupDark.g;
          dark.b = setupDark.b;
        }
        light.add(
          (v[0] - light.r) * alpha,
          (v[1] - light.g) * alpha,
          (v[2] - light.b) * alpha,
          (v[3] - light.a) * alpha
        );
        dark.r += (v[4] - dark.r) * alpha;
        dark.g += (v[5] - dark.g) * alpha;
        dark.b += (v[6] - dark.b) * alpha;
      }
    }
  }
  class RGB2Timeline extends CurveTimeline {
    constructor(frameCount, bezierCount, slotIndex) {
      super(frameCount, bezierCount, [id(8, slotIndex), id(10, slotIndex)]);
      this.slotIndex = slotIndex;
    }
    getFrameEntries() {
      return 7;
    }
    setFrame(frame, time, r, g, b, r2, g2, b2) {
      frame *= 7;
      this.put(frame, time, r, g, b, r2, g2, b2);
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const slot = skeleton.slots[this.slotIndex];
      if (!slot.bone.active) return;
      const light = slot.color;
      const dark = slot.darkColor;
      const setupLight = slot.data.color;
      const setupDark = slot.data.darkColor;
      if (!dark || !setupDark) return;
      const assignSetup = () => {
        light.r = setupLight.r;
        light.g = setupLight.g;
        light.b = setupLight.b;
        dark.r = setupDark.r;
        dark.g = setupDark.g;
        dark.b = setupDark.b;
      };
      if (time < this.frames[0]) {
        if (blend === 0) assignSetup();
        else if (blend === 1) {
          light.r += (setupLight.r - light.r) * alpha;
          light.g += (setupLight.g - light.g) * alpha;
          light.b += (setupLight.b - light.b) * alpha;
          dark.r += (setupDark.r - dark.r) * alpha;
          dark.g += (setupDark.g - dark.g) * alpha;
          dark.b += (setupDark.b - dark.b) * alpha;
        }
        return;
      }
      const i = Timeline.search(this.frames, time, 7);
      const v = [0, 1, 2, 3, 4, 5].map((k) => this.valueAt(time, i, k));
      if (alpha === 1) {
        light.r = v[0];
        light.g = v[1];
        light.b = v[2];
        dark.r = v[3];
        dark.g = v[4];
        dark.b = v[5];
      } else {
        if (blend === 0) assignSetup();
        light.r += (v[0] - light.r) * alpha;
        light.g += (v[1] - light.g) * alpha;
        light.b += (v[2] - light.b) * alpha;
        dark.r += (v[3] - dark.r) * alpha;
        dark.g += (v[4] - dark.g) * alpha;
        dark.b += (v[5] - dark.b) * alpha;
      }
    }
  }
  class AttachmentTimeline extends Timeline {
    constructor(frameCount, slotIndex) {
      super(frameCount, [id(11, slotIndex)]);
      this.slotIndex = slotIndex;
      this.attachmentNames = new Array(frameCount).fill(null);
    }
    setFrame(frame, time, attachmentName) {
      this.frames[frame] = time;
      this.attachmentNames[frame] = attachmentName;
    }
    apply(skeleton, _l, time, _e, _alpha, blend, direction) {
      const slot = skeleton.slots[this.slotIndex];
      if (!slot.bone.active) return;
      if (direction === 1) {
        if (blend === 0) this.setAttachment(skeleton, slot, slot.data.attachmentName);
        return;
      }
      if (time < this.frames[0]) {
        if (blend === 0 || blend === 1)
          this.setAttachment(skeleton, slot, slot.data.attachmentName);
        return;
      }
      this.setAttachment(skeleton, slot, this.attachmentNames[Timeline.search1(this.frames, time)]);
    }
    setAttachment(skeleton, slot, name) {
      slot.setAttachment(name ? skeleton.getAttachment(this.slotIndex, name) : null);
    }
  }
  class DeformTimeline extends CurveTimeline {
    constructor(frameCount, bezierCount, slotIndex, attachment) {
      super(frameCount, bezierCount, [id(12, slotIndex, attachment.id)]);
      this.slotIndex = slotIndex;
      this.attachment = attachment;
      this.vertices = new Array(frameCount);
    }
    getFrameCount() {
      return this.frames.length;
    }
    valueCount() {
      return 1;
    }
    setFrame(frame, time, vertices) {
      this.frames[frame] = time;
      this.vertices[frame] = vertices;
    }
    /** Interpolation fraction between `frame` and the next, through the frame's curve. */
    getCurvePercent(time, frame) {
      const frames = this.frames;
      switch (this.curveTypes[frame]) {
        case LINEAR: {
          const x2 = frames[frame];
          return (time - x2) / (frames[frame + 1] - x2);
        }
        case STEPPED:
          return 0;
      }
      const s = this.beziers[frame];
      if (!s) return 0;
      if (s[0] > time) {
        const x2 = frames[frame];
        return s[1] * (time - x2) / (s[0] - x2);
      }
      const n = BEZIER_POINTS * 2;
      for (let k = 2; k < n; k += 2) {
        if (s[k] >= time) {
          const x2 = s[k - 2];
          const y2 = s[k - 1];
          return y2 + (time - x2) / (s[k] - x2) * (s[k + 1] - y2);
        }
      }
      const x = s[n - 2];
      const y = s[n - 1];
      return y + (1 - y) * (time - x) / (frames[frame + 1] - x);
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const slot = skeleton.slots[this.slotIndex];
      if (!slot.bone.active) return;
      const current = slot.getAttachment();
      if (!(current instanceof VertexAttachment) || current.timelineAttachment !== this.attachment)
        return;
      const deform = slot.deform;
      if (deform.length === 0) blend = 0;
      const keyed = this.vertices;
      const count = keyed[0].length;
      const frames = this.frames;
      const setupVertices = current.bones ? null : current.vertices;
      if (time < frames[0]) {
        if (blend === 0) deform.length = 0;
        else if (blend === 1) {
          if (alpha === 1) {
            deform.length = 0;
            return;
          }
          deform.length = count;
          if (setupVertices)
            for (let i = 0; i < count; i++) deform[i] += (setupVertices[i] - deform[i]) * alpha;
          else {
            const keep = 1 - alpha;
            for (let i = 0; i < count; i++) deform[i] *= keep;
          }
        }
        return;
      }
      deform.length = count;
      let sample;
      if (time >= frames[frames.length - 1]) {
        const last = keyed[frames.length - 1];
        sample = (i) => last[i];
      } else {
        const frame = Timeline.search1(frames, time);
        const percent = this.getCurvePercent(time, frame);
        const prev = keyed[frame];
        const next = keyed[frame + 1];
        sample = (i) => prev[i] + (next[i] - prev[i]) * percent;
      }
      if (alpha === 1) {
        if (blend === 3) {
          if (setupVertices)
            for (let i = 0; i < count; i++) deform[i] += sample(i) - setupVertices[i];
          else for (let i = 0; i < count; i++) deform[i] += sample(i);
        } else for (let i = 0; i < count; i++) deform[i] = sample(i);
        return;
      }
      switch (blend) {
        case 0:
          if (setupVertices)
            for (let i = 0; i < count; i++) {
              const s = setupVertices[i];
              deform[i] = s + (sample(i) - s) * alpha;
            }
          else for (let i = 0; i < count; i++) deform[i] = sample(i) * alpha;
          break;
        case 1:
        case 2:
          for (let i = 0; i < count; i++) deform[i] += (sample(i) - deform[i]) * alpha;
          break;
        case 3:
          if (setupVertices)
            for (let i = 0; i < count; i++) deform[i] += (sample(i) - setupVertices[i]) * alpha;
          else for (let i = 0; i < count; i++) deform[i] += sample(i) * alpha;
      }
    }
  }
  class SequenceTimeline extends Timeline {
    constructor(frameCount, slotIndex, attachment) {
      var _a;
      super(frameCount, [id(28, slotIndex, ((_a = attachment.sequence) == null ? void 0 : _a.id) ?? -1)]);
      this.slotIndex = slotIndex;
      this.attachment = attachment;
    }
    getFrameEntries() {
      return 3;
    }
    getSlotIndex() {
      return this.slotIndex;
    }
    getAttachment() {
      return this.attachment;
    }
    setFrame(frame, time, mode, index, delay) {
      frame *= 3;
      this.frames[frame] = time;
      this.frames[frame + 1] = mode | index << 4;
      this.frames[frame + 2] = delay;
    }
    apply(skeleton, _l, time, _e, _alpha, blend, direction) {
      const slot = skeleton.slots[this.slotIndex];
      if (!slot.bone.active) return;
      const current = slot.attachment;
      const attachment = this.attachment;
      if (current !== attachment && (!(current instanceof VertexAttachment) || current.timelineAttachment !== attachment))
        return;
      if (direction === 1) {
        if (blend === 0) slot.sequenceIndex = -1;
        return;
      }
      const frames = this.frames;
      if (time < frames[0]) {
        if (blend === 0 || blend === 1) slot.sequenceIndex = -1;
        return;
      }
      const i = Timeline.search(frames, time, 3);
      const before = frames[i];
      const modeAndIndex = frames[i + 1];
      const delay = frames[i + 2];
      const sequence = attachment.sequence;
      if (!sequence) return;
      let index = modeAndIndex >> 4;
      const count = sequence.regions.length;
      const mode = SequenceModeValues[modeAndIndex & 15];
      if (mode !== SequenceMode.hold) {
        index += (time - before) / delay + 1e-5 | 0;
        const span = (count << 1) - 2;
        switch (mode) {
          case SequenceMode.once:
            index = Math.min(count - 1, index);
            break;
          case SequenceMode.loop:
            index %= count;
            break;
          case SequenceMode.pingpong:
            index = span === 0 ? 0 : index % span;
            if (index >= count) index = span - index;
            break;
          case SequenceMode.onceReverse:
            index = Math.max(count - 1 - index, 0);
            break;
          case SequenceMode.loopReverse:
            index = count - 1 - index % count;
            break;
          case SequenceMode.pingpongReverse:
            index = span === 0 ? 0 : (index + count - 1) % span;
            if (index >= count) index = span - index;
        }
      }
      slot.sequenceIndex = index;
    }
  }
  class EventTimeline extends Timeline {
    constructor(frameCount) {
      super(frameCount, [String(
        13
        /* event */
      )]);
      this.events = new Array(frameCount);
    }
    setFrame(frame, event) {
      this.frames[frame] = event.time;
      this.events[frame] = event;
    }
    /** Fires the events keyed in (`lastTime`, `time`]; a wrapped loop fires the tail, then the head. */
    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
      if (!firedEvents) return;
      const frames = this.frames;
      const count = frames.length;
      if (lastTime > time) {
        this.apply(skeleton, lastTime, Number.MAX_VALUE, firedEvents, alpha, blend, direction);
        lastTime = -1;
      } else if (lastTime >= frames[count - 1]) return;
      if (time < frames[0]) return;
      let i;
      if (lastTime < frames[0]) i = 0;
      else {
        i = Timeline.search1(frames, lastTime) + 1;
        const frameTime = frames[i];
        while (i > 0 && frames[i - 1] === frameTime) i--;
      }
      for (; i < count && time >= frames[i]; i++) firedEvents.push(this.events[i]);
    }
  }
  class DrawOrderTimeline extends Timeline {
    constructor(frameCount) {
      super(frameCount, [String(
        14
        /* drawOrder */
      )]);
      this.drawOrders = new Array(frameCount).fill(null);
    }
    setFrame(frame, time, drawOrder) {
      this.frames[frame] = time;
      this.drawOrders[frame] = drawOrder;
    }
    apply(skeleton, _l, time, _e, _alpha, blend, direction) {
      const setupOrder = () => {
        for (let i = 0; i < skeleton.slots.length; i++) skeleton.drawOrder[i] = skeleton.slots[i];
      };
      if (direction === 1) {
        if (blend === 0) setupOrder();
        return;
      }
      if (time < this.frames[0]) {
        if (blend === 0 || blend === 1) setupOrder();
        return;
      }
      const order = this.drawOrders[Timeline.search1(this.frames, time)];
      if (!order) setupOrder();
      else for (let i = 0; i < order.length; i++) skeleton.drawOrder[i] = skeleton.slots[order[i]];
    }
  }
  class IkConstraintTimeline extends CurveTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, [id(15, constraintIndex)]);
      this.constraintIndex = constraintIndex;
    }
    getFrameEntries() {
      return 6;
    }
    /** Two of the five values (mix, softness) interpolate; the rest are held. */
    valueCount() {
      return 2;
    }
    setFrame(frame, time, mix, softness, bendDirection, compress, stretch) {
      frame *= 6;
      this.put(frame, time, mix, softness, bendDirection, compress ? 1 : 0, stretch ? 1 : 0);
    }
    apply(skeleton, _l, time, _e, alpha, blend, direction) {
      const c = skeleton.ikConstraints[this.constraintIndex];
      if (!c.active) return;
      const data = c.data;
      const frames = this.frames;
      if (time < frames[0]) {
        if (blend === 0) {
          c.mix = data.mix;
          c.softness = data.softness;
          c.bendDirection = data.bendDirection;
          c.compress = data.compress;
          c.stretch = data.stretch;
        } else if (blend === 1) {
          c.mix += (data.mix - c.mix) * alpha;
          c.softness += (data.softness - c.softness) * alpha;
          c.bendDirection = data.bendDirection;
          c.compress = data.compress;
          c.stretch = data.stretch;
        }
        return;
      }
      const i = Timeline.search(frames, time, 6);
      const mix = this.valueAt6(time, i, 0);
      const softness = this.valueAt6(time, i, 1);
      if (blend === 0) {
        c.mix = data.mix + (mix - data.mix) * alpha;
        c.softness = data.softness + (softness - data.softness) * alpha;
        if (direction === 1) {
          c.bendDirection = data.bendDirection;
          c.compress = data.compress;
          c.stretch = data.stretch;
        } else {
          c.bendDirection = frames[i + 3];
          c.compress = frames[i + 4] !== 0;
          c.stretch = frames[i + 5] !== 0;
        }
      } else {
        c.mix += (mix - c.mix) * alpha;
        c.softness += (softness - c.softness) * alpha;
        if (direction === 0) {
          c.bendDirection = frames[i + 3];
          c.compress = frames[i + 4] !== 0;
          c.stretch = frames[i + 5] !== 0;
        }
      }
    }
    valueAt6(time, i, value) {
      return this.valueAt(time, i, value);
    }
  }
  class TransformConstraintTimeline extends CurveTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, [id(16, constraintIndex)]);
      this.constraintIndex = constraintIndex;
    }
    getFrameEntries() {
      return 7;
    }
    setFrame(frame, time, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY) {
      frame *= 7;
      this.put(frame, time, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY);
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const c = skeleton.transformConstraints[this.constraintIndex];
      if (!c.active) return;
      const data = c.data;
      const keys = ["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"];
      if (time < this.frames[0]) {
        if (blend === 0) for (const k of keys) c[k] = data[k];
        else if (blend === 1) for (const k of keys) c[k] += (data[k] - c[k]) * alpha;
        return;
      }
      const i = Timeline.search(this.frames, time, 7);
      keys.forEach((k, v) => {
        const value = this.valueAt(time, i, v);
        if (blend === 0) c[k] = data[k] + (value - data[k]) * alpha;
        else c[k] += (value - c[k]) * alpha;
      });
    }
  }
  class PathConstraintPositionTimeline extends CurveTimeline1 {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, [id(17, constraintIndex)]);
      this.constraintIndex = constraintIndex;
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const c = skeleton.pathConstraints[this.constraintIndex];
      if (c.active)
        c.position = this.getAbsoluteValue(time, alpha, blend, c.position, c.data.position);
    }
  }
  class PathConstraintSpacingTimeline extends CurveTimeline1 {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, [id(18, constraintIndex)]);
      this.constraintIndex = constraintIndex;
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const c = skeleton.pathConstraints[this.constraintIndex];
      if (c.active) c.spacing = this.getAbsoluteValue(time, alpha, blend, c.spacing, c.data.spacing);
    }
  }
  class PathConstraintMixTimeline extends CurveTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, [id(19, constraintIndex)]);
      this.constraintIndex = constraintIndex;
    }
    getFrameEntries() {
      return 4;
    }
    setFrame(frame, time, mixRotate, mixX, mixY) {
      frame *= 4;
      this.put(frame, time, mixRotate, mixX, mixY);
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      const c = skeleton.pathConstraints[this.constraintIndex];
      if (!c.active) return;
      const data = c.data;
      const keys = ["mixRotate", "mixX", "mixY"];
      if (time < this.frames[0]) {
        if (blend === 0) for (const k of keys) c[k] = data[k];
        else if (blend === 1) for (const k of keys) c[k] += (data[k] - c[k]) * alpha;
        return;
      }
      const i = Timeline.search(this.frames, time, 4);
      keys.forEach((k, v) => {
        const value = this.valueAt(time, i, v);
        if (blend === 0) c[k] = data[k] + (value - data[k]) * alpha;
        else c[k] += (value - c[k]) * alpha;
      });
    }
  }
  class PhysicsConstraintTimeline extends CurveTimeline1 {
    constructor(frameCount, bezierCount, constraintIndex, property, field) {
      super(frameCount, bezierCount, [id(property, constraintIndex)]);
      this.constraintIndex = constraintIndex;
      this.field = field;
    }
    apply(skeleton, _l, time, _e, alpha, blend) {
      if (this.constraintIndex === -1) {
        const value = time >= this.frames[0] ? this.getCurveValue(time) : 0;
        for (const c2 of skeleton.physicsConstraints)
          if (c2.active && this.global(c2.data))
            this.set(c2, this.getAbsoluteValue(time, alpha, blend, this.get(c2), this.setup(c2), value));
        return;
      }
      const c = skeleton.physicsConstraints[this.constraintIndex];
      if (c.active)
        this.set(c, this.getAbsoluteValue(time, alpha, blend, this.get(c), this.setup(c)));
    }
    get(c) {
      return this.field === "mass" ? 1 / c.massInverse : c[this.field];
    }
    set(c, value) {
      if (this.field === "mass") c.massInverse = 1 / value;
      else c[this.field] = value;
    }
    setup(c) {
      return this.field === "mass" ? 1 / c.data.massInverse : c.data[this.field];
    }
    global(data) {
      return data[`${this.field}Global`];
    }
  }
  class PhysicsConstraintInertiaTimeline extends PhysicsConstraintTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, constraintIndex, 20, "inertia");
    }
  }
  class PhysicsConstraintStrengthTimeline extends PhysicsConstraintTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, constraintIndex, 21, "strength");
    }
  }
  class PhysicsConstraintDampingTimeline extends PhysicsConstraintTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, constraintIndex, 22, "damping");
    }
  }
  class PhysicsConstraintMassTimeline extends PhysicsConstraintTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, constraintIndex, 23, "mass");
    }
  }
  class PhysicsConstraintWindTimeline extends PhysicsConstraintTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, constraintIndex, 24, "wind");
    }
  }
  class PhysicsConstraintGravityTimeline extends PhysicsConstraintTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, constraintIndex, 25, "gravity");
    }
  }
  class PhysicsConstraintMixTimeline extends PhysicsConstraintTimeline {
    constructor(frameCount, bezierCount, constraintIndex) {
      super(frameCount, bezierCount, constraintIndex, 26, "mix");
    }
  }
  class PhysicsConstraintResetTimeline extends Timeline {
    constructor(frameCount, constraintIndex) {
      super(frameCount, [String(
        27
        /* physicsConstraintReset */
      )]);
      this.constraintIndex = constraintIndex;
    }
    setFrame(frame, time) {
      this.frames[frame] = time;
    }
    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
      let constraint = null;
      if (this.constraintIndex !== -1) {
        constraint = skeleton.physicsConstraints[this.constraintIndex];
        if (!constraint.active) return;
      }
      const frames = this.frames;
      if (lastTime > time) {
        this.apply(skeleton, lastTime, Number.MAX_VALUE, [], alpha, blend, direction);
        lastTime = -1;
      } else if (lastTime >= frames[frames.length - 1]) return;
      if (time < frames[0]) return;
      if (lastTime < frames[0] || time >= frames[Timeline.search1(frames, lastTime) + 1]) {
        if (constraint) constraint.reset();
        else for (const c of skeleton.physicsConstraints) if (c.active) c.reset();
      }
    }
  }
  const SUBSEQUENT = 0;
  const FIRST = 1;
  const HOLD_SUBSEQUENT = 2;
  const HOLD_FIRST = 3;
  const HOLD_MIX = 4;
  const SETUP = 1;
  const CURRENT = 2;
  class AnimationStateAdapter {
    start(_entry) {
    }
    interrupt(_entry) {
    }
    end(_entry) {
    }
    dispose(_entry) {
    }
    complete(_entry) {
    }
    event(_entry, _event) {
    }
  }
  var EventType = /* @__PURE__ */ ((EventType2) => {
    EventType2[EventType2["start"] = 0] = "start";
    EventType2[EventType2["interrupt"] = 1] = "interrupt";
    EventType2[EventType2["end"] = 2] = "end";
    EventType2[EventType2["dispose"] = 3] = "dispose";
    EventType2[EventType2["complete"] = 4] = "complete";
    EventType2[EventType2["event"] = 5] = "event";
    return EventType2;
  })(EventType || {});
  class AnimationStateData {
    constructor(skeletonData) {
      this.skeletonData = skeletonData;
      this.animationToMixTime = {};
      this.defaultMix = 0;
      if (!skeletonData) throw new Error("skeletonData cannot be null.");
    }
    setMix(fromName, toName, duration) {
      const from = this.skeletonData.findAnimation(fromName);
      if (!from) throw new Error("Animation not found: " + fromName);
      const to = this.skeletonData.findAnimation(toName);
      if (!to) throw new Error("Animation not found: " + toName);
      this.setMixWith(from, to, duration);
    }
    setMixWith(from, to, duration) {
      this.animationToMixTime[from.name + "." + to.name] = duration;
    }
    getMix(from, to) {
      const value = this.animationToMixTime[from.name + "." + to.name];
      return value === void 0 ? this.defaultMix : value;
    }
  }
  class TrackEntry {
    constructor() {
      this.animation = null;
      this.previous = null;
      this.next = null;
      this.mixingFrom = null;
      this.mixingTo = null;
      this.listener = null;
      this.trackIndex = 0;
      this.loop = false;
      this.holdPrevious = false;
      this.reverse = false;
      this.shortestRotation = false;
      this.eventThreshold = 0;
      this.mixAttachmentThreshold = 0;
      this.alphaAttachmentThreshold = 0;
      this.mixDrawOrderThreshold = 0;
      this.animationStart = 0;
      this.animationEnd = 0;
      this.animationLast = 0;
      this.nextAnimationLast = 0;
      this.delay = 0;
      this.trackTime = 0;
      this.trackLast = 0;
      this.nextTrackLast = 0;
      this.trackEnd = 0;
      this.timeScale = 0;
      this.alpha = 0;
      this.mixTime = 0;
      this._mixDuration = 0;
      this.interruptAlpha = 0;
      this.totalAlpha = 0;
      this.mixBlend = MixBlend.replace;
      this.timelineMode = [];
      this.timelineHoldMix = [];
      this.timelinesRotation = [];
    }
    get mixDuration() {
      return this._mixDuration;
    }
    set mixDuration(duration) {
      this._mixDuration = duration;
    }
    /** Sets the mix duration and, when `delay` is given, a delay measured as `addAnimation` does. */
    setMixDurationWithDelay(mixDuration, delay) {
      this._mixDuration = mixDuration;
      if (delay <= 0) {
        delay = this.previous ? Math.max(delay + this.previous.getTrackComplete() - mixDuration, 0) : 0;
      }
      this.delay = delay;
    }
    setMixDuration(mixDuration, delay) {
      if (delay === void 0) this._mixDuration = mixDuration;
      else this.setMixDurationWithDelay(mixDuration, delay);
    }
    reset() {
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
    getAnimationTime() {
      if (this.loop) {
        const duration = this.animationEnd - this.animationStart;
        if (duration === 0) return this.animationStart;
        return this.trackTime % duration + this.animationStart;
      }
      return Math.min(this.trackTime + this.animationStart, this.animationEnd);
    }
    setAnimationLast(animationLast) {
      this.animationLast = animationLast;
      this.nextAnimationLast = animationLast;
    }
    isComplete() {
      return this.trackTime >= this.animationEnd - this.animationStart;
    }
    resetRotationDirections() {
      this.timelinesRotation.length = 0;
    }
    /** Track time at which the current loop (or the animation) completes. */
    getTrackComplete() {
      const duration = this.animationEnd - this.animationStart;
      if (duration !== 0) {
        if (this.loop) return duration * (1 + (this.trackTime / duration | 0));
        if (this.trackTime < duration) return duration;
      }
      return this.trackTime;
    }
    wasApplied() {
      return this.nextTrackLast !== -1;
    }
    isNextReady() {
      return this.next !== null && this.nextTrackLast - this.next.delay >= 0;
    }
  }
  class EventQueue {
    constructor(state) {
      this.state = state;
      this.objects = [];
      this.drainDisabled = false;
    }
    push(type, entry) {
      this.objects.push({ type, entry });
      this.state.animationsChanged = true;
    }
    start(entry) {
      this.push(0, entry);
    }
    interrupt(entry) {
      this.objects.push({ type: 1, entry });
    }
    end(entry) {
      this.push(2, entry);
    }
    dispose(entry) {
      this.objects.push({ type: 3, entry });
    }
    complete(entry) {
      this.objects.push({ type: 4, entry });
    }
    event(entry, event) {
      this.objects.push({ type: 5, entry, event });
    }
    drain() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v;
      if (this.drainDisabled) return;
      this.drainDisabled = true;
      const objects = this.objects;
      const listeners = this.state.listeners;
      for (let i = 0; i < objects.length; i++) {
        const item = objects[i];
        const entry = item.entry;
        const own = entry.listener;
        switch (item.type) {
          case 0:
            (_a = own == null ? void 0 : own.start) == null ? void 0 : _a.call(own, entry);
            for (let k = 0; k < listeners.length; k++) (_c = (_b = listeners[k]).start) == null ? void 0 : _c.call(_b, entry);
            break;
          case 1:
            (_d = own == null ? void 0 : own.interrupt) == null ? void 0 : _d.call(own, entry);
            for (let k = 0; k < listeners.length; k++) (_f = (_e = listeners[k]).interrupt) == null ? void 0 : _f.call(_e, entry);
            break;
          case 2:
            (_g = own == null ? void 0 : own.end) == null ? void 0 : _g.call(own, entry);
            for (let k = 0; k < listeners.length; k++) (_i = (_h = listeners[k]).end) == null ? void 0 : _i.call(_h, entry);
            (_k = (_j = entry.listener) == null ? void 0 : _j.dispose) == null ? void 0 : _k.call(_j, entry);
            for (let k = 0; k < listeners.length; k++) (_m = (_l = listeners[k]).dispose) == null ? void 0 : _m.call(_l, entry);
            entry.reset();
            break;
          case 3:
            (_n = own == null ? void 0 : own.dispose) == null ? void 0 : _n.call(own, entry);
            for (let k = 0; k < listeners.length; k++) (_p = (_o = listeners[k]).dispose) == null ? void 0 : _p.call(_o, entry);
            entry.reset();
            break;
          case 4:
            (_q = own == null ? void 0 : own.complete) == null ? void 0 : _q.call(own, entry);
            for (let k = 0; k < listeners.length; k++) (_s = (_r = listeners[k]).complete) == null ? void 0 : _s.call(_r, entry);
            break;
          case 5:
            (_t = own == null ? void 0 : own.event) == null ? void 0 : _t.call(own, entry, item.event);
            for (let k = 0; k < listeners.length; k++) (_v = (_u = listeners[k]).event) == null ? void 0 : _v.call(_u, entry, item.event);
            break;
        }
      }
      this.clear();
      this.drainDisabled = false;
    }
    clear() {
      this.objects.length = 0;
    }
  }
  const _AnimationState = class _AnimationState {
    constructor(data) {
      this.data = data;
      this.tracks = [];
      this.timeScale = 1;
      this.unkeyedState = 0;
      this.events = [];
      this.listeners = [];
      this.propertyIDs = /* @__PURE__ */ new Set();
      this.animationsChanged = false;
      this.queue = new EventQueue(this);
    }
    static emptyAnimation() {
      return _AnimationState.EMPTY;
    }
    /** Advances every track by `delta` seconds (scaled), handling delays, queued entries and mix ends. */
    update(delta) {
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
            next.trackTime += current.timeScale === 0 ? 0 : (nextTime / current.timeScale + delta) * next.timeScale;
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
          let from = current.mixingFrom;
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
    updateMixingFrom(to, delta) {
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
    apply(skeleton) {
      if (!skeleton) throw new Error("skeleton cannot be null.");
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
        let applyEvents = events;
        if (current.reverse) {
          applyTime = animation.duration - applyTime;
          applyEvents = null;
        }
        const timelines = animation.timelines;
        const count = timelines.length;
        if (trackIndex === 0 && alpha === 1 || blend === MixBlend.add) {
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
                MixDirection.mixIn
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
                firstFrame
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
                MixDirection.mixIn
              );
          }
        }
        this.queueEvents(current, animationTime);
        events.length = 0;
        current.nextAnimationLast = animationTime;
        current.nextTrackLast = current.trackTime;
      }
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
    applyMixingFrom(to, skeleton, blend) {
      const from = to.mixingFrom;
      if (from.mixingFrom) this.applyMixingFrom(from, skeleton, blend);
      let mix;
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
      const animation = from.animation;
      const timelines = animation.timelines;
      const count = timelines.length;
      const alphaHold = from.alpha * to.interruptAlpha;
      const alphaMix = alphaHold * (1 - mix);
      const animationLast = from.animationLast;
      const animationTime = from.getAnimationTime();
      let applyTime = animationTime;
      let events = null;
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
            MixDirection.mixOut
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
          let timelineBlend;
          let alpha;
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
              const hold = holdMix[i];
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
              firstFrame
            );
          else if (timeline instanceof AttachmentTimeline)
            this.applyAttachmentTimeline(
              timeline,
              skeleton,
              applyTime,
              timelineBlend,
              attachments && alpha >= from.alphaAttachmentThreshold
            );
          else {
            if (drawOrder && timeline instanceof DrawOrderTimeline && timelineBlend === MixBlend.setup)
              direction = MixDirection.mixIn;
            timeline.apply(
              skeleton,
              animationLast,
              applyTime,
              events,
              alpha,
              timelineBlend,
              direction
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
    applyAttachmentTimeline(timeline, skeleton, time, blend, attachments) {
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
          attachments
        );
      if (slot.attachmentState <= this.unkeyedState) slot.attachmentState = this.unkeyedState + SETUP;
    }
    setAttachment(skeleton, slot, name, attachments) {
      slot.setAttachment(name ? skeleton.getAttachment(slot.data.index, name) : null);
      if (attachments) slot.attachmentState = this.unkeyedState + CURRENT;
    }
    /** Mixes rotation along the shortest route, remembering the direction chosen on the first frame
     * so a mix that crosses 180° keeps turning the same way. */
    applyRotateTimeline(timeline, skeleton, time, alpha, blend, rotations, i, firstFrame) {
      if (firstFrame) rotations[i] = 0;
      if (alpha === 1) {
        timeline.apply(skeleton, 0, time, null, 1, blend);
        return;
      }
      const bone = skeleton.bones[timeline.boneIndex];
      if (!bone.active) return;
      let r1;
      let r2;
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
      let total;
      let diff = r2 - r1;
      diff -= Math.ceil(diff / 360 - 0.5) * 360;
      if (diff === 0) total = rotations[i];
      else {
        const lastTotal = firstFrame ? 0 : rotations[i];
        const lastDiff = firstFrame ? diff : rotations[i + 1];
        const loops = lastTotal - lastTotal % 360;
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
    queueEvents(entry, animationTime) {
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
      let complete;
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
    clearTracks() {
      const old = this.queue.drainDisabled;
      this.queue.drainDisabled = true;
      for (let i = 0; i < this.tracks.length; i++) this.clearTrack(i);
      this.tracks.length = 0;
      this.queue.drainDisabled = old;
      this.queue.drain();
    }
    clearTrack(trackIndex) {
      if (trackIndex >= this.tracks.length) return;
      const current = this.tracks[trackIndex];
      if (!current) return;
      this.queue.end(current);
      this.clearNext(current);
      let entry = current;
      for (; ; ) {
        const from = entry.mixingFrom;
        if (!from) break;
        this.queue.end(from);
        entry.mixingFrom = null;
        entry.mixingTo = null;
        entry = from;
      }
      this.tracks[current.trackIndex] = null;
      this.queue.drain();
    }
    setCurrent(index, current, interrupt) {
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
    setAnimation(trackIndex, animationName, loop = false) {
      return this.setAnimationWith(trackIndex, this.resolve(animationName), loop);
    }
    setAnimationWith(trackIndex, animation, loop = false) {
      if (!animation) throw new Error("animation cannot be null.");
      let interrupt = true;
      let current = this.expandToIndex(trackIndex);
      if (current) {
        if (current.nextTrackLast === -1) {
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
    addAnimation(trackIndex, animationName, loop = false, delay = 0) {
      return this.addAnimationWith(trackIndex, this.resolve(animationName), loop, delay);
    }
    /** Queues an animation after the track's last entry. A delay <= 0 is relative to the end of the
     * previous entry, less this entry's mix duration. */
    addAnimationWith(trackIndex, animation, loop = false, delay = 0) {
      if (!animation) throw new Error("animation cannot be null.");
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
    setEmptyAnimation(trackIndex, mixDuration = 0) {
      const entry = this.setAnimationWith(trackIndex, _AnimationState.emptyAnimation(), false);
      entry.mixDuration = mixDuration;
      entry.trackEnd = mixDuration;
      return entry;
    }
    addEmptyAnimation(trackIndex, mixDuration = 0, delay = 0) {
      const entry = this.addAnimationWith(trackIndex, _AnimationState.emptyAnimation(), false, delay);
      if (delay <= 0) entry.delay = Math.max(entry.delay + entry.mixDuration - mixDuration, 0);
      entry.mixDuration = mixDuration;
      entry.trackEnd = mixDuration;
      return entry;
    }
    setEmptyAnimations(mixDuration = 0) {
      const old = this.queue.drainDisabled;
      this.queue.drainDisabled = true;
      for (const current of this.tracks)
        if (current) this.setEmptyAnimation(current.trackIndex, mixDuration);
      this.queue.drainDisabled = old;
      this.queue.drain();
    }
    resolve(animationName) {
      if (!animationName) throw new Error("animationName cannot be null.");
      const found = this.data.skeletonData.findAnimation(animationName);
      if (!found) throw new Error("Animation not found: " + animationName);
      return found;
    }
    expandToIndex(index) {
      if (index < this.tracks.length) return this.tracks[index];
      while (this.tracks.length <= index) this.tracks.push(null);
      return null;
    }
    trackEntry(trackIndex, animation, loop, last) {
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
      entry.mixDuration = (last == null ? void 0 : last.animation) ? this.data.getMix(last.animation, animation) : 0;
      entry.interruptAlpha = 1;
      entry.totalAlpha = 0;
      entry.mixBlend = MixBlend.replace;
      return entry;
    }
    clearNext(entry) {
      let next = entry.next;
      while (next) {
        this.queue.dispose(next);
        next = next.next;
      }
      entry.next = null;
    }
    /** Recomputes each entry's timeline modes after the set of playing animations changed. */
    onAnimationsChanged() {
      this.animationsChanged = false;
      this.propertyIDs.clear();
      for (const track of this.tracks) {
        let entry = track;
        if (!entry) continue;
        while (entry.mixingFrom) entry = entry.mixingFrom;
        let walk = entry;
        do {
          if (!walk.mixingTo || walk.mixBlend !== MixBlend.add) this.computeHold(walk);
          walk = walk.mixingTo;
        } while (walk);
      }
    }
    computeHold(entry) {
      const to = entry.mixingTo;
      const timelines = entry.animation.timelines;
      const count = timelines.length;
      const modes = entry.timelineMode;
      modes.length = count;
      const holdMix = entry.timelineHoldMix;
      holdMix.length = 0;
      const ids = this.propertyIDs;
      const addAll = (list) => {
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
        else if (!to || timeline instanceof AttachmentTimeline || timeline instanceof DrawOrderTimeline || timeline instanceof EventTimeline || !to.animation.hasTimeline(pids))
          modes[i] = FIRST;
        else {
          for (let next = to.mixingTo; next; next = next.mixingTo) {
            if (next.animation.hasTimeline(pids)) continue;
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
    getCurrent(trackIndex) {
      return trackIndex < this.tracks.length ? this.tracks[trackIndex] : null;
    }
    addListener(listener) {
      if (!listener) throw new Error("listener cannot be null.");
      this.listeners.push(listener);
    }
    removeListener(listener) {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    }
    clearListeners() {
      this.listeners.length = 0;
    }
    clearListenerNotifications() {
      this.queue.clear();
    }
  };
  _AnimationState.EMPTY = new Animation("<empty>", [], 0);
  let AnimationState = _AnimationState;
  function get(map, key, fallback) {
    const value = map == null ? void 0 : map[key];
    return value === void 0 ? fallback : value;
  }
  let LinkedMesh$1 = class LinkedMesh {
    constructor(mesh, skin, slotIndex, parent, inheritTimelines) {
      this.mesh = mesh;
      this.skin = skin;
      this.slotIndex = slotIndex;
      this.parent = parent;
      this.inheritTimelines = inheritTimelines;
    }
  };
  class SkeletonJson {
    constructor(attachmentLoader) {
      this.attachmentLoader = attachmentLoader;
      this.scale = 1;
      this.linkedMeshes = [];
    }
    readSkeletonData(json) {
      const scale = this.scale;
      const data = new SkeletonData();
      const root = typeof json === "string" ? JSON.parse(json) : json;
      const skeletonMap = root.skeleton;
      if (skeletonMap) {
        data.hash = skeletonMap.hash ?? null;
        data.version = skeletonMap.spine ?? null;
        data.x = skeletonMap.x;
        data.y = skeletonMap.y;
        data.width = skeletonMap.width;
        data.height = skeletonMap.height;
        data.referenceScale = get(skeletonMap, "referenceScale", 100) * scale;
        data.fps = skeletonMap.fps;
        data.imagesPath = get(skeletonMap, "images", null);
        data.audioPath = get(skeletonMap, "audio", null);
      }
      for (const boneMap of root.bones || []) {
        let parent = null;
        const parentName = get(boneMap, "parent", null);
        if (parentName) {
          parent = data.findBone(parentName);
          if (!parent) throw new Error(`Parent bone not found: ${parentName}`);
        }
        const bone = new BoneData(data.bones.length, boneMap.name, parent);
        bone.length = get(boneMap, "length", 0) * scale;
        bone.x = get(boneMap, "x", 0) * scale;
        bone.y = get(boneMap, "y", 0) * scale;
        bone.rotation = get(boneMap, "rotation", 0);
        bone.scaleX = get(boneMap, "scaleX", 1);
        bone.scaleY = get(boneMap, "scaleY", 1);
        bone.shearX = get(boneMap, "shearX", 0);
        bone.shearY = get(boneMap, "shearY", 0);
        bone.inherit = enumFromName(Inherit, get(boneMap, "inherit", "normal"), Inherit.Normal);
        bone.skinRequired = get(boneMap, "skin", false);
        const color = get(boneMap, "color", null);
        if (color) bone.color.setFromString(color);
        data.bones.push(bone);
      }
      for (const slotMap of root.slots || []) {
        const boneData = data.findBone(slotMap.bone);
        if (!boneData) throw new Error(`Couldn't find slot bone: ${slotMap.bone}`);
        const slot = new SlotData(data.slots.length, slotMap.name, boneData);
        const color = get(slotMap, "color", null);
        if (color) slot.color.setFromString(color);
        const dark = get(slotMap, "dark", null);
        if (dark) slot.darkColor = Color.fromString(dark);
        slot.attachmentName = get(slotMap, "attachment", null);
        slot.blendMode = enumFromName(BlendMode, get(slotMap, "blend", "normal"), BlendMode.Normal);
        slot.visible = get(slotMap, "visible", true);
        data.slots.push(slot);
      }
      const bonesOf = (names, what) => (names || []).map((name) => {
        const bone = data.findBone(name);
        if (!bone) throw new Error(`Couldn't find bone ${name} for ${what}`);
        return bone;
      });
      const constrained = (map, what) => {
        if (map.bones === void 0 || map.bones === null)
          throw new Error(`${what} has no bones list.`);
        return bonesOf(map.bones, what);
      };
      for (const map of root.ik || []) {
        const c = new IkConstraintData(map.name);
        c.order = get(map, "order", 0);
        c.skinRequired = get(map, "skin", false);
        c.bones = constrained(map, `IK constraint ${map.name}`);
        const target = data.findBone(map.target);
        if (!target)
          throw new Error(`Couldn't find target bone ${map.target} for IK constraint ${map.name}.`);
        c.target = target;
        c.mix = get(map, "mix", 1);
        c.softness = get(map, "softness", 0) * scale;
        c.bendDirection = get(map, "bendPositive", true) ? 1 : -1;
        c.compress = get(map, "compress", false);
        c.stretch = get(map, "stretch", false);
        c.uniform = get(map, "uniform", false);
        data.ikConstraints.push(c);
      }
      for (const map of root.transform || []) {
        const c = new TransformConstraintData(map.name);
        c.order = get(map, "order", 0);
        c.skinRequired = get(map, "skin", false);
        c.bones = constrained(map, `transform constraint ${map.name}`);
        const target = data.findBone(map.target);
        if (!target)
          throw new Error(
            `Couldn't find target bone ${map.target} for transform constraint ${map.name}.`
          );
        c.target = target;
        c.local = get(map, "local", false);
        c.relative = get(map, "relative", false);
        c.offsetRotation = get(map, "rotation", 0);
        c.offsetX = get(map, "x", 0) * scale;
        c.offsetY = get(map, "y", 0) * scale;
        c.offsetScaleX = get(map, "scaleX", 0);
        c.offsetScaleY = get(map, "scaleY", 0);
        c.offsetShearY = get(map, "shearY", 0);
        c.mixRotate = get(map, "mixRotate", 1);
        c.mixX = get(map, "mixX", 1);
        c.mixY = get(map, "mixY", c.mixX);
        c.mixScaleX = get(map, "mixScaleX", 1);
        c.mixScaleY = get(map, "mixScaleY", c.mixScaleX);
        c.mixShearY = get(map, "mixShearY", 1);
        data.transformConstraints.push(c);
      }
      for (const map of root.path || []) {
        const c = new PathConstraintData(map.name);
        c.order = get(map, "order", 0);
        c.skinRequired = get(map, "skin", false);
        c.bones = constrained(map, `path constraint ${map.name}`);
        const target = data.findSlot(map.target);
        if (!target)
          throw new Error(`Couldn't find target slot ${map.target} for path constraint ${map.name}.`);
        c.target = target;
        c.positionMode = enumFromName(
          PositionMode,
          get(map, "positionMode", "percent"),
          PositionMode.Percent
        );
        c.spacingMode = enumFromName(
          SpacingMode,
          get(map, "spacingMode", "length"),
          SpacingMode.Length
        );
        c.rotateMode = enumFromName(
          RotateMode,
          get(map, "rotateMode", "tangent"),
          RotateMode.Tangent
        );
        c.offsetRotation = get(map, "rotation", 0);
        c.position = get(map, "position", 0);
        if (c.positionMode === PositionMode.Fixed) c.position *= scale;
        c.spacing = get(map, "spacing", 0);
        if (c.spacingMode === SpacingMode.Length || c.spacingMode === SpacingMode.Fixed)
          c.spacing *= scale;
        c.mixRotate = get(map, "mixRotate", 1);
        c.mixX = get(map, "mixX", 1);
        c.mixY = get(map, "mixY", c.mixX);
        data.pathConstraints.push(c);
      }
      for (const map of root.physics || []) {
        const c = new PhysicsConstraintData(map.name);
        c.order = get(map, "order", 0);
        c.skinRequired = get(map, "skin", false);
        const bone = data.findBone(map.bone);
        if (!bone) throw new Error(`Physics bone not found: ${map.bone}`);
        c.bone = bone;
        c.x = get(map, "x", 0);
        c.y = get(map, "y", 0);
        c.rotate = get(map, "rotate", 0);
        c.scaleX = get(map, "scaleX", 0);
        c.shearX = get(map, "shearX", 0);
        c.limit = get(map, "limit", 5e3) * scale;
        c.step = 1 / get(map, "fps", 60);
        c.inertia = get(map, "inertia", 1);
        c.strength = get(map, "strength", 100);
        c.damping = get(map, "damping", 1);
        c.massInverse = 1 / get(map, "mass", 1);
        c.wind = get(map, "wind", 0);
        c.gravity = get(map, "gravity", 0);
        c.mix = get(map, "mix", 1);
        c.inertiaGlobal = get(map, "inertiaGlobal", false);
        c.strengthGlobal = get(map, "strengthGlobal", false);
        c.dampingGlobal = get(map, "dampingGlobal", false);
        c.massGlobal = get(map, "massGlobal", false);
        c.windGlobal = get(map, "windGlobal", false);
        c.gravityGlobal = get(map, "gravityGlobal", false);
        c.mixGlobal = get(map, "mixGlobal", false);
        data.physicsConstraints.push(c);
      }
      const skins = Array.isArray(root.skins) ? root.skins : Object.entries(root.skins || {}).map(([name, attachments]) => ({ name, attachments }));
      for (const skinMap of skins) {
        const skin = new Skin(skinMap.name);
        skin.bones.push(...bonesOf(skinMap.bones, `skin ${skinMap.name}`));
        const constraint = (names, find, kind) => (names || []).map((n) => {
          const c = find(n);
          if (!c)
            throw new Error(`Couldn't find ${kind} constraint ${n} for skin ${skinMap.name}.`);
          return c;
        });
        skin.constraints.push(
          ...constraint(skinMap.ik, (n) => data.findIkConstraint(n), "IK"),
          ...constraint(skinMap.transform, (n) => data.findTransformConstraint(n), "transform"),
          ...constraint(skinMap.path, (n) => data.findPathConstraint(n), "path"),
          ...constraint(skinMap.physics, (n) => data.findPhysicsConstraint(n), "physics")
        );
        for (const slotName of Object.keys(skinMap.attachments || {})) {
          const slot = data.findSlot(slotName);
          if (!slot) throw new Error(`Slot not found: ${slotName}`);
          const slotMap = skinMap.attachments[slotName];
          for (const entryName of Object.keys(slotMap)) {
            const attachment = this.readAttachment(
              slotMap[entryName],
              skin,
              slot.index,
              entryName,
              data
            );
            if (attachment) skin.setAttachment(slot.index, entryName, attachment);
          }
        }
        data.skins.push(skin);
        if (skin.name === "default") data.defaultSkin = skin;
      }
      for (const linked of this.linkedMeshes) {
        const skin = linked.skin ? data.findSkin(linked.skin) : data.defaultSkin;
        if (!skin) throw new Error(`Skin not found: ${linked.skin}`);
        const parent = skin.getAttachment(linked.slotIndex, linked.parent);
        if (!parent) throw new Error(`Parent mesh not found: ${linked.parent}`);
        if (!(parent instanceof MeshAttachment))
          throw new Error(`Linked mesh parent is not a mesh: ${linked.parent}`);
        linked.mesh.timelineAttachment = linked.inheritTimelines ? parent : linked.mesh;
        linked.mesh.setParentMesh(parent);
        if (linked.mesh.region) linked.mesh.updateRegion();
      }
      this.linkedMeshes.length = 0;
      for (const name of Object.keys(root.events || {})) {
        const map = root.events[name];
        const event = new EventData(name);
        event.intValue = get(map, "int", 0);
        event.floatValue = get(map, "float", 0);
        event.stringValue = get(map, "string", "");
        event.audioPath = get(map, "audio", null);
        if (event.audioPath) {
          event.volume = get(map, "volume", 1);
          event.balance = get(map, "balance", 0);
        }
        data.events.push(event);
      }
      for (const name of Object.keys(root.animations || {}))
        this.readAnimation(root.animations[name], name, data);
      return data;
    }
    readSequence(map) {
      if (map === null || map === void 0) return null;
      const sequence = new Sequence(get(map, "count", 0));
      sequence.start = get(map, "start", 1);
      sequence.digits = get(map, "digits", 0);
      sequence.setupIndex = get(map, "setup", 0);
      return sequence;
    }
    readAttachment(map, skin, slotIndex, entryName, data) {
      const scale = this.scale;
      const name = get(map, "name", entryName);
      const loader = this.attachmentLoader;
      const setColor = (target) => {
        const color = get(map, "color", null);
        if (color) target.color.setFromString(color);
      };
      switch (get(map, "type", "region")) {
        case "region": {
          const path = get(map, "path", name);
          const sequence = this.readSequence(get(map, "sequence", null));
          const region = loader.newRegionAttachment(skin, name, path, sequence);
          if (!region) return null;
          region.path = path;
          region.x = get(map, "x", 0) * scale;
          region.y = get(map, "y", 0) * scale;
          region.scaleX = get(map, "scaleX", 1);
          region.scaleY = get(map, "scaleY", 1);
          region.rotation = get(map, "rotation", 0);
          region.width = map.width * scale;
          region.height = map.height * scale;
          region.sequence = sequence;
          setColor(region);
          if (region.region) region.updateRegion();
          return region;
        }
        case "boundingbox": {
          const box = loader.newBoundingBoxAttachment(skin, name);
          if (!box) return null;
          this.readVertices(map, box, map.vertexCount << 1);
          setColor(box);
          return box;
        }
        case "mesh":
        case "linkedmesh": {
          const path = get(map, "path", name);
          const sequence = this.readSequence(get(map, "sequence", null));
          const mesh = loader.newMeshAttachment(skin, name, path, sequence);
          if (!mesh) return null;
          mesh.path = path;
          setColor(mesh);
          mesh.width = get(map, "width", 0) * scale;
          mesh.height = get(map, "height", 0) * scale;
          mesh.sequence = sequence;
          const parent = get(map, "parent", null);
          if (parent) {
            this.linkedMeshes.push(
              new LinkedMesh$1(
                mesh,
                get(map, "skin", null),
                slotIndex,
                parent,
                get(map, "timelines", true)
              )
            );
            return mesh;
          }
          const uvs = map.uvs;
          this.readVertices(map, mesh, uvs.length);
          mesh.triangles = map.triangles;
          mesh.regionUVs = uvs;
          if (mesh.region) mesh.updateRegion();
          mesh.edges = get(map, "edges", null);
          mesh.hullLength = get(map, "hull", 0) * 2;
          return mesh;
        }
        case "path": {
          const path = loader.newPathAttachment(skin, name);
          if (!path) return null;
          path.closed = get(map, "closed", false);
          path.constantSpeed = get(map, "constantSpeed", true);
          const vertexCount = map.vertexCount;
          this.readVertices(map, path, vertexCount << 1);
          const lengths = new Array(vertexCount / 3).fill(0);
          map.lengths.forEach((l, i) => lengths[i] = l * scale);
          path.lengths = lengths;
          setColor(path);
          return path;
        }
        case "point": {
          const point = loader.newPointAttachment(skin, name);
          if (!point) return null;
          point.x = get(map, "x", 0) * scale;
          point.y = get(map, "y", 0) * scale;
          point.rotation = get(map, "rotation", 0);
          setColor(point);
          return point;
        }
        case "clipping": {
          const clip = loader.newClippingAttachment(skin, name);
          if (!clip) return null;
          const end = get(map, "end", null);
          if (end) clip.endSlot = data.findSlot(end);
          this.readVertices(map, clip, map.vertexCount << 1);
          setColor(clip);
          return clip;
        }
      }
      return null;
    }
    /** Unweighted when the array holds exactly `x, y` per vertex; otherwise per vertex
     * `boneCount, (bone, x, y, weight) × boneCount`. */
    readVertices(map, attachment, verticesLength) {
      const scale = this.scale;
      attachment.worldVerticesLength = verticesLength;
      const vertices = map.vertices;
      if (verticesLength === vertices.length) {
        const out = new Float32Array(vertices.length);
        for (let i = 0; i < vertices.length; i++) out[i] = vertices[i] * scale;
        attachment.vertices = out;
        return;
      }
      const weights = [];
      const bones = [];
      for (let i = 0; i < vertices.length; ) {
        const boneCount = vertices[i++];
        bones.push(boneCount);
        for (const end = i + boneCount * 4; i < end; i += 4) {
          bones.push(vertices[i]);
          weights.push(vertices[i + 1] * scale, vertices[i + 2] * scale, vertices[i + 3]);
        }
      }
      attachment.bones = bones;
      attachment.vertices = new Float32Array(weights);
    }
    readAnimation(map, name, data) {
      const scale = this.scale;
      const timelines = [];
      for (const slotName of Object.keys(map.slots || {})) {
        const slotMap = map.slots[slotName];
        const slot = data.findSlot(slotName);
        if (!slot) throw new Error(`Slot not found: ${slotName}`);
        const slotIndex = slot.index;
        for (const timelineName of Object.keys(slotMap)) {
          const keys = slotMap[timelineName];
          if (!keys) continue;
          const frames = keys.length;
          switch (timelineName) {
            case "attachment": {
              const t = new AttachmentTimeline(frames, slotIndex);
              keys.forEach((k, f) => t.setFrame(f, get(k, "time", 0), get(k, "name", null)));
              timelines.push(t);
              break;
            }
            case "rgba":
              timelines.push(
                readColors(keys, new RGBATimeline(frames, frames << 2, slotIndex), (k) => {
                  const c = Color.fromString(k.color);
                  return [c.r, c.g, c.b, c.a];
                })
              );
              break;
            case "rgb":
              timelines.push(
                readColors(keys, new RGBTimeline(frames, frames * 3, slotIndex), (k) => {
                  const c = Color.fromString(k.color);
                  return [c.r, c.g, c.b];
                })
              );
              break;
            case "alpha":
              timelines.push(readTimeline1(keys, new AlphaTimeline(frames, frames, slotIndex), 0, 1));
              break;
            case "rgba2":
              timelines.push(
                readColors(keys, new RGBA2Timeline(frames, frames * 7, slotIndex), (k) => {
                  const l = Color.fromString(k.light);
                  const d = Color.fromString(k.dark);
                  return [l.r, l.g, l.b, l.a, d.r, d.g, d.b];
                })
              );
              break;
            case "rgb2":
              timelines.push(
                readColors(keys, new RGB2Timeline(frames, frames * 6, slotIndex), (k) => {
                  const l = Color.fromString(k.light);
                  const d = Color.fromString(k.dark);
                  return [l.r, l.g, l.b, d.r, d.g, d.b];
                })
              );
              break;
          }
        }
      }
      for (const boneName of Object.keys(map.bones || {})) {
        const boneMap = map.bones[boneName];
        const bone = data.findBone(boneName);
        if (!bone) throw new Error(`Bone not found: ${boneName}`);
        const b = bone.index;
        for (const timelineName of Object.keys(boneMap)) {
          const keys = boneMap[timelineName];
          const frames = keys.length;
          if (frames === 0) continue;
          switch (timelineName) {
            case "rotate":
              timelines.push(readTimeline1(keys, new RotateTimeline(frames, frames, b), 0, 1));
              break;
            case "translate":
              timelines.push(
                readTimeline2(
                  keys,
                  new TranslateTimeline(frames, frames << 1, b),
                  "x",
                  "y",
                  0,
                  scale
                )
              );
              break;
            case "translatex":
              timelines.push(
                readTimeline1(keys, new TranslateXTimeline(frames, frames, b), 0, scale)
              );
              break;
            case "translatey":
              timelines.push(
                readTimeline1(keys, new TranslateYTimeline(frames, frames, b), 0, scale)
              );
              break;
            case "scale":
              timelines.push(
                readTimeline2(keys, new ScaleTimeline(frames, frames << 1, b), "x", "y", 1, 1)
              );
              break;
            case "scalex":
              timelines.push(readTimeline1(keys, new ScaleXTimeline(frames, frames, b), 1, 1));
              break;
            case "scaley":
              timelines.push(readTimeline1(keys, new ScaleYTimeline(frames, frames, b), 1, 1));
              break;
            case "shear":
              timelines.push(
                readTimeline2(keys, new ShearTimeline(frames, frames << 1, b), "x", "y", 0, 1)
              );
              break;
            case "shearx":
              timelines.push(readTimeline1(keys, new ShearXTimeline(frames, frames, b), 0, 1));
              break;
            case "sheary":
              timelines.push(readTimeline1(keys, new ShearYTimeline(frames, frames, b), 0, 1));
              break;
            case "inherit": {
              const t = new InheritTimeline(frames, b);
              keys.forEach(
                (k, f) => t.setFrame(
                  f,
                  get(k, "time", 0),
                  enumFromName(Inherit, get(k, "inherit", "normal"), Inherit.Normal)
                )
              );
              timelines.push(t);
              break;
            }
          }
        }
      }
      for (const constraintName of Object.keys(map.ik || {})) {
        const keys = map.ik[constraintName];
        if (!keys[0]) continue;
        const constraint = data.findIkConstraint(constraintName);
        if (!constraint) throw new Error(`IK Constraint not found: ${constraintName}`);
        const t = new IkConstraintTimeline(
          keys.length,
          keys.length << 1,
          data.ikConstraints.indexOf(constraint)
        );
        keys.forEach(
          (k, f) => t.setFrame(
            f,
            get(k, "time", 0),
            get(k, "mix", 1),
            get(k, "softness", 0) * scale,
            get(k, "bendPositive", true) ? 1 : -1,
            get(k, "compress", false),
            get(k, "stretch", false)
          )
        );
        readCurves(
          keys,
          t,
          [(k) => get(k, "mix", 1), (k) => get(k, "softness", 0) * scale],
          [1, scale]
        );
        timelines.push(t);
      }
      for (const constraintName of Object.keys(map.transform || {})) {
        const keys = map.transform[constraintName];
        if (!keys[0]) continue;
        const constraint = data.findTransformConstraint(constraintName);
        if (!constraint) throw new Error(`Transform constraint not found: ${constraintName}`);
        const t = new TransformConstraintTimeline(
          keys.length,
          keys.length * 6,
          data.transformConstraints.indexOf(constraint)
        );
        const values = (k) => {
          const mixX = get(k, "mixX", 1);
          const mixScaleX = get(k, "mixScaleX", 1);
          return [
            get(k, "mixRotate", 1),
            mixX,
            get(k, "mixY", mixX),
            mixScaleX,
            get(k, "mixScaleY", mixScaleX),
            get(k, "mixShearY", 1)
          ];
        };
        keys.forEach((k, f) => {
          const v = values(k);
          t.setFrame(f, get(k, "time", 0), v[0], v[1], v[2], v[3], v[4], v[5]);
        });
        readCurves(
          keys,
          t,
          [0, 1, 2, 3, 4, 5].map((i) => (k) => values(k)[i]),
          [1, 1, 1, 1, 1, 1]
        );
        timelines.push(t);
      }
      for (const constraintName of Object.keys(map.path || {})) {
        const constraintMap = map.path[constraintName];
        const constraint = data.findPathConstraint(constraintName);
        if (!constraint) throw new Error(`Path constraint not found: ${constraintName}`);
        const index = data.pathConstraints.indexOf(constraint);
        for (const timelineName of Object.keys(constraintMap)) {
          const keys = constraintMap[timelineName];
          if (!keys[0]) continue;
          const frames = keys.length;
          if (timelineName === "position") {
            const s = constraint.positionMode === PositionMode.Fixed ? scale : 1;
            timelines.push(
              readTimeline1(keys, new PathConstraintPositionTimeline(frames, frames, index), 0, s)
            );
          } else if (timelineName === "spacing") {
            const s = constraint.spacingMode === SpacingMode.Length || constraint.spacingMode === SpacingMode.Fixed ? scale : 1;
            timelines.push(
              readTimeline1(keys, new PathConstraintSpacingTimeline(frames, frames, index), 0, s)
            );
          } else if (timelineName === "mix") {
            const t = new PathConstraintMixTimeline(frames, frames * 3, index);
            const values = (k) => {
              const mixX = get(k, "mixX", 1);
              return [get(k, "mixRotate", 1), mixX, get(k, "mixY", mixX)];
            };
            keys.forEach((k, f) => {
              const v = values(k);
              t.setFrame(f, get(k, "time", 0), v[0], v[1], v[2]);
            });
            readCurves(
              keys,
              t,
              [0, 1, 2].map((i) => (k) => values(k)[i]),
              [1, 1, 1]
            );
            timelines.push(t);
          }
        }
      }
      for (const constraintName of Object.keys(map.physics || {})) {
        const constraintMap = map.physics[constraintName];
        let index = -1;
        if (constraintName.length > 0) {
          const constraint = data.findPhysicsConstraint(constraintName);
          if (!constraint) throw new Error(`Physics constraint not found: ${constraintName}`);
          index = data.physicsConstraints.indexOf(constraint);
        }
        for (const timelineName of Object.keys(constraintMap)) {
          const keys = constraintMap[timelineName];
          if (!keys[0]) continue;
          const frames = keys.length;
          if (timelineName === "reset") {
            const t = new PhysicsConstraintResetTimeline(frames, index);
            keys.forEach((k, f) => t.setFrame(f, get(k, "time", 0)));
            timelines.push(t);
            continue;
          }
          const make = {
            inertia: PhysicsConstraintInertiaTimeline,
            strength: PhysicsConstraintStrengthTimeline,
            damping: PhysicsConstraintDampingTimeline,
            mass: PhysicsConstraintMassTimeline,
            wind: PhysicsConstraintWindTimeline,
            gravity: PhysicsConstraintGravityTimeline,
            mix: PhysicsConstraintMixTimeline
          };
          const Ctor = make[timelineName];
          if (Ctor) timelines.push(readTimeline1(keys, new Ctor(frames, frames, index), 0, 1));
        }
      }
      for (const skinName of Object.keys(map.attachments || {})) {
        const skinMap = map.attachments[skinName];
        const skin = data.findSkin(skinName);
        if (!skin) throw new Error(`Skin not found: ${skinName}`);
        for (const slotName of Object.keys(skinMap)) {
          const slotMap = skinMap[slotName];
          const slot = data.findSlot(slotName);
          if (!slot) throw new Error(`Slot not found: ${slotName}`);
          for (const attachmentName of Object.keys(slotMap)) {
            const attachmentMap = slotMap[attachmentName];
            const attachment = skin.getAttachment(slot.index, attachmentName);
            for (const timelineName of Object.keys(attachmentMap)) {
              const keys = attachmentMap[timelineName];
              if (!keys[0]) continue;
              if (timelineName === "deform") {
                if (!attachment) throw new Error(`Deform attachment not found: ${attachmentName}`);
                if (!(attachment instanceof VertexAttachment))
                  throw new Error(`Deform keys on an attachment with no vertices: ${attachmentName}`);
                timelines.push(this.readDeform(keys, slot.index, attachment));
              } else if (timelineName === "sequence") {
                if (!attachment) throw new Error(`Sequence attachment not found: ${attachmentName}`);
                if (!attachment.sequence)
                  throw new Error(
                    `Sequence keys on an attachment with no sequence: ${attachmentName}`
                  );
                const t = new SequenceTimeline(
                  keys.length,
                  slot.index,
                  attachment
                );
                let lastDelay = 0;
                keys.forEach((k, f) => {
                  const delay = get(k, "delay", lastDelay);
                  const mode = SequenceMode[get(k, "mode", "hold")];
                  t.setFrame(f, get(k, "time", 0), mode, get(k, "index", 0), delay);
                  lastDelay = delay;
                });
                timelines.push(t);
              }
            }
          }
        }
      }
      if (map.drawOrder) {
        const keys = map.drawOrder;
        const t = new DrawOrderTimeline(keys.length);
        const slotCount = data.slots.length;
        keys.forEach((k, f) => {
          const offsets = get(k, "offsets", null);
          let order = null;
          if (offsets) {
            order = new Array(slotCount).fill(-1);
            const unchanged = new Array(slotCount - offsets.length).fill(0);
            let original = 0;
            let u = 0;
            for (const offset of offsets) {
              const slot = data.findSlot(offset.slot);
              if (!slot) throw new Error(`Slot not found: ${offset.slot}`);
              while (original !== slot.index) unchanged[u++] = original++;
              order[original + offset.offset] = original++;
            }
            while (original < slotCount) unchanged[u++] = original++;
            for (let i = slotCount - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged[--u];
          }
          t.setFrame(f, get(k, "time", 0), order);
        });
        timelines.push(t);
      }
      if (map.events) {
        const keys = map.events;
        const t = new EventTimeline(keys.length);
        keys.forEach((k, f) => {
          const eventData = data.findEvent(k.name);
          if (!eventData) throw new Error(`Event not found: ${k.name}`);
          const event = new Event(Math.fround(get(k, "time", 0)), eventData);
          event.intValue = get(k, "int", eventData.intValue);
          event.floatValue = get(k, "float", eventData.floatValue);
          event.stringValue = get(k, "string", eventData.stringValue);
          if (eventData.audioPath) {
            event.volume = get(k, "volume", 1);
            event.balance = get(k, "balance", 0);
          }
          t.setFrame(f, event);
        });
        timelines.push(t);
      }
      let duration = 0;
      for (const t of timelines) duration = Math.max(duration, t.getDuration());
      data.animations.push(new Animation(name, timelines, duration));
    }
    readDeform(keys, slotIndex, attachment) {
      const scale = this.scale;
      const weighted = !!attachment.bones;
      const setup = attachment.vertices;
      const length = weighted ? setup.length / 3 * 2 : setup.length;
      const t = new DeformTimeline(keys.length, keys.length, slotIndex, attachment);
      keys.forEach((k, f) => {
        const values = get(k, "vertices", null);
        let deform;
        if (!values) deform = weighted ? new Float32Array(length) : setup;
        else {
          deform = new Float32Array(length);
          const start = get(k, "offset", 0);
          for (let i = 0; i < values.length; i++) deform[start + i] = values[i] * scale;
          if (!weighted) for (let i = 0; i < length; i++) deform[i] += setup[i];
        }
        t.setFrame(f, get(k, "time", 0), deform);
      });
      readCurves(keys, t, [() => 0], [1], () => [0, 1]);
      return t;
    }
  }
  function readCurves(keys, timeline, valueOf, scales, fixedEnds) {
    for (let f = 0; f < keys.length - 1; f++) {
      const curve = keys[f].curve;
      if (!curve) continue;
      if (curve === "stepped") {
        timeline.setStepped(f);
        continue;
      }
      const time1 = get(keys[f], "time", 0);
      const time2 = get(keys[f + 1], "time", 0);
      valueOf.forEach((value, v) => {
        const [v1, v2] = fixedEnds ? fixedEnds() : [value(keys[f]), value(keys[f + 1])];
        const i = v << 2;
        timeline.setBezier(
          0,
          f,
          v,
          time1,
          v1,
          curve[i],
          curve[i + 1] * scales[v],
          curve[i + 2],
          curve[i + 3] * scales[v],
          time2,
          v2
        );
      });
    }
  }
  function readTimeline1(keys, timeline, defaultValue, scale) {
    const value = (k) => get(k, "value", defaultValue) * scale;
    keys.forEach((k, f) => timeline.setFrame(f, get(k, "time", 0), value(k)));
    readCurves(keys, timeline, [value], [scale]);
    return timeline;
  }
  function readTimeline2(keys, timeline, name1, name2, defaultValue, scale) {
    const v1 = (k) => get(k, name1, defaultValue) * scale;
    const v2 = (k) => get(k, name2, defaultValue) * scale;
    keys.forEach((k, f) => timeline.setFrame(f, get(k, "time", 0), v1(k), v2(k)));
    readCurves(keys, timeline, [v1, v2], [scale, scale]);
    return timeline;
  }
  function readColors(keys, timeline, values) {
    keys.forEach((k, f) => timeline.setFrame(f, get(k, "time", 0), ...values(k)));
    const count = values(keys[0]).length;
    readCurves(
      keys,
      timeline,
      Array.from({ length: count }, (_, i) => (k) => values(k)[i]),
      new Array(count).fill(1)
    );
    return timeline;
  }
  const EPS = 1e-9;
  function signedArea(poly, count) {
    let area = 0;
    for (let i = 0, j = count - 2; i < count; j = i, i += 2)
      area += poly[j] * poly[i + 1] - poly[i] * poly[j + 1];
    return area / 2;
  }
  function triangulate(polygon) {
    const n = polygon.length >> 1;
    const out = [];
    if (n < 3) return out;
    const ccw = signedArea(polygon, polygon.length) > 0;
    const indices = Array.from({ length: n }, (_, i) => i);
    const x = (i) => polygon[i << 1];
    const y = (i) => polygon[(i << 1) + 1];
    const cross = (a, b, c) => (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a));
    const convex = (a, b, c) => ccw ? cross(a, b, c) > EPS : cross(a, b, c) < -EPS;
    const inside = (p, a, b, c) => {
      const d1 = cross(a, b, p);
      const d2 = cross(b, c, p);
      const d3 = cross(c, a, p);
      return ccw ? d1 >= -EPS && d2 >= -EPS && d3 >= -EPS : d1 <= EPS && d2 <= EPS && d3 <= EPS;
    };
    let guard = n * n;
    while (indices.length > 3 && guard-- > 0) {
      let clipped = false;
      for (let i = 0; i < indices.length; i++) {
        const a = indices[(i + indices.length - 1) % indices.length];
        const b = indices[i];
        const c = indices[(i + 1) % indices.length];
        if (!convex(a, b, c)) continue;
        let ear = true;
        for (const p of indices) {
          if (p === a || p === b || p === c) continue;
          if (inside(p, a, b, c)) {
            ear = false;
            break;
          }
        }
        if (!ear) continue;
        out.push(a, b, c);
        indices.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) indices.splice(0, 1);
    }
    if (indices.length === 3) out.push(indices[0], indices[1], indices[2]);
    return out;
  }
  function decompose(polygon, triangles) {
    const pts = (idx) => idx.flatMap((i) => [polygon[i << 1], polygon[(i << 1) + 1]]);
    const isConvex = (idx) => {
      const p = pts(idx);
      const n = idx.length;
      let sign = 0;
      for (let i = 0; i < n; i++) {
        const ax = p[i * 2];
        const ay = p[i * 2 + 1];
        const bx = p[(i + 1) % n * 2];
        const by = p[(i + 1) % n * 2 + 1];
        const cx = p[(i + 2) % n * 2];
        const cy = p[(i + 2) % n * 2 + 1];
        const c = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(c) < EPS) continue;
        const s = c > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
      }
      return true;
    };
    const polys = [];
    for (let t = 0; t < triangles.length; t += 3) {
      const tri = [triangles[t], triangles[t + 1], triangles[t + 2]];
      let merged = false;
      for (const poly of polys) {
        for (let i = 0; i < poly.length && !merged; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          const ta = tri.indexOf(a);
          const tb = tri.indexOf(b);
          if (ta === -1 || tb === -1) continue;
          const other = tri.find((v) => v !== a && v !== b);
          if (other === void 0 || poly.includes(other)) continue;
          const candidate = poly.slice(0, i + 1).concat([other], poly.slice(i + 1));
          if (isConvex(candidate)) {
            poly.splice(0, poly.length, ...candidate);
            merged = true;
          }
        }
        if (merged) break;
      }
      if (!merged) polys.push(tri);
    }
    return polys.map((idx) => {
      const p = pts(idx);
      if (signedArea(p, p.length) < 0) {
        const r = [];
        for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
        return r;
      }
      return p;
    });
  }
  class SkeletonClipping {
    constructor() {
      this.clippedVertices = [];
      this.clippedTriangles = [];
      this.clippedUVs = [];
      this.clipAttachment = null;
      this.clippingPolygons = [];
      this.world = [];
    }
    clipStart(slot, clip) {
      if (this.clipAttachment) return 0;
      const n = clip.worldVerticesLength;
      if (n < 6) return 0;
      this.clipAttachment = clip;
      const world = this.world;
      world.length = n;
      clip.computeWorldVertices(slot, 0, n, world, 0, 2);
      this.clippingPolygons = decompose(world, triangulate(world));
      return this.clippingPolygons.length;
    }
    clipEndWithSlot(slot) {
      if (this.clipAttachment && this.clipAttachment.endSlot === slot.data) this.clipEnd();
    }
    clipEnd() {
      if (!this.clipAttachment) return;
      this.clipAttachment = null;
      this.clippingPolygons = [];
      this.clippedVertices.length = 0;
      this.clippedTriangles.length = 0;
      this.clippedUVs.length = 0;
    }
    isClipping() {
      return this.clipAttachment !== null;
    }
    /** Positions only (`x, y` pairs in `vertices`). */
    clipTriangles(vertices, triangles, trianglesLength) {
      this.clip(vertices, triangles, trianglesLength, null);
    }
    /** Positions and UVs, each as `x, y` / `u, v` pairs, written to the three `clipped*` arrays. */
    clipTrianglesUnpacked(vertices, triangles, trianglesLength, uvs) {
      this.clip(vertices, triangles, trianglesLength, uvs);
    }
    clip(vertices, triangles, trianglesLength, uvs) {
      const outV = this.clippedVertices;
      const outT = this.clippedTriangles;
      const outUV = this.clippedUVs;
      outV.length = 0;
      outT.length = 0;
      outUV.length = 0;
      for (let t = 0; t < trianglesLength; t += 3) {
        const i1 = triangles[t] << 1;
        const i2 = triangles[t + 1] << 1;
        const i3 = triangles[t + 2] << 1;
        const x1 = vertices[i1];
        const y1 = vertices[i1 + 1];
        const x2 = vertices[i2];
        const y2 = vertices[i2 + 1];
        const x3 = vertices[i3];
        const y3 = vertices[i3 + 1];
        const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        for (const polygon of this.clippingPolygons) {
          const poly = clipConvex([x1, y1, x2, y2, x3, y3], polygon);
          const count = poly.length >> 1;
          if (count < 3) continue;
          const base = outV.length >> 1;
          for (let k = 0; k < poly.length; k += 2) {
            const px = poly[k];
            const py = poly[k + 1];
            outV.push(px, py);
            if (!uvs) continue;
            let a = 1;
            let b = 0;
            if (Math.abs(det) > EPS) {
              a = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / det;
              b = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / det;
            }
            const c = 1 - a - b;
            outUV.push(
              uvs[i1] * a + uvs[i2] * b + uvs[i3] * c,
              uvs[i1 + 1] * a + uvs[i2 + 1] * b + uvs[i3 + 1] * c
            );
          }
          for (let k = 1; k < count - 1; k++) outT.push(base, base + k, base + k + 1);
        }
      }
    }
  }
  function clipConvex(subject, clip) {
    let output = subject;
    const n = clip.length;
    for (let e = 0; e < n && output.length >= 6; e += 2) {
      const ex1 = clip[e];
      const ey1 = clip[e + 1];
      const ex2 = clip[(e + 2) % n];
      const ey2 = clip[(e + 3) % n];
      const edx = ex2 - ex1;
      const edy = ey2 - ey1;
      const side = (x, y) => edx * (y - ey1) - edy * (x - ex1);
      const input = output;
      output = [];
      const m = input.length;
      for (let i = 0; i < m; i += 2) {
        const cx = input[i];
        const cy = input[i + 1];
        const px = input[(i + m - 2) % m];
        const py = input[(i + m - 1) % m];
        const cs = side(cx, cy);
        const ps = side(px, py);
        if (cs >= 0) {
          if (ps < 0) {
            const t = ps / (ps - cs);
            output.push(px + (cx - px) * t, py + (cy - py) * t);
          }
          output.push(cx, cy);
        } else if (ps >= 0) {
          const t = ps / (ps - cs);
          output.push(px + (cx - px) * t, py + (cy - py) * t);
        }
      }
    }
    return output;
  }
  class BinaryInput {
    constructor(data) {
      this.index = 0;
      this.strings = [];
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    readByte() {
      return this.view.getInt8(this.index++);
    }
    readUnsignedByte() {
      return this.view.getUint8(this.index++);
    }
    readInt32() {
      const v = this.view.getInt32(this.index);
      this.index += 4;
      return v;
    }
    /** Variable-length int, 7 bits per byte; zigzag-decoded unless `optimizePositive`. */
    readInt(optimizePositive) {
      let result = 0;
      for (let shift = 0; shift <= 28; shift += 7) {
        const b = this.readByte();
        result |= (b & 127) << shift;
        if ((b & 128) === 0) break;
      }
      return optimizePositive ? result : result >>> 1 ^ -(result & 1);
    }
    readStringRef() {
      const index = this.readInt(true);
      return index === 0 ? null : this.strings[index - 1];
    }
    /** Length + 1 (0 = null), then UTF-8 bytes. */
    readString() {
      let byteCount = this.readInt(true);
      if (byteCount === 0) return null;
      if (byteCount === 1) return "";
      byteCount--;
      let chars = "";
      for (let i = 0; i < byteCount; ) {
        const b = this.readUnsignedByte();
        switch (b >> 4) {
          case 12:
          case 13:
            chars += String.fromCharCode((b & 31) << 6 | this.readByte() & 63);
            i += 2;
            break;
          case 14:
            chars += String.fromCharCode(
              (b & 15) << 12 | (this.readByte() & 63) << 6 | this.readByte() & 63
            );
            i += 3;
            break;
          default:
            chars += String.fromCharCode(b);
            i++;
        }
      }
      return chars;
    }
    readFloat() {
      const v = this.view.getFloat32(this.index);
      this.index += 4;
      return v;
    }
    readBoolean() {
      return this.readByte() !== 0;
    }
  }
  const ATTACHMENT_REGION = 0;
  const ATTACHMENT_BOUNDINGBOX = 1;
  const ATTACHMENT_MESH = 2;
  const ATTACHMENT_LINKEDMESH = 3;
  const ATTACHMENT_PATH = 4;
  const ATTACHMENT_POINT = 5;
  const ATTACHMENT_CLIPPING = 6;
  const CURVE_STEPPED = 1;
  const CURVE_BEZIER = 2;
  class LinkedMesh {
    constructor(mesh, skinIndex, slotIndex, parent, inheritTimelines) {
      this.mesh = mesh;
      this.skinIndex = skinIndex;
      this.slotIndex = slotIndex;
      this.parent = parent;
      this.inheritTimelines = inheritTimelines;
    }
  }
  const required = (s, what) => {
    if (s === null) throw new Error(`${what} must not be null.`);
    return s;
  };
  class SkeletonBinary {
    constructor(attachmentLoader) {
      this.attachmentLoader = attachmentLoader;
      this.scale = 1;
      this.linkedMeshes = [];
    }
    readSkeletonData(binary) {
      const scale = this.scale;
      const data = new SkeletonData();
      data.name = "";
      const input = new BinaryInput(binary);
      const lowHash = input.readInt32();
      const highHash = input.readInt32();
      data.hash = highHash === 0 && lowHash === 0 ? null : highHash.toString(16) + lowHash.toString(16);
      data.version = input.readString();
      data.x = input.readFloat();
      data.y = input.readFloat();
      data.width = input.readFloat();
      data.height = input.readFloat();
      data.referenceScale = input.readFloat() * scale;
      const nonessential = input.readBoolean();
      if (nonessential) {
        data.fps = input.readFloat();
        data.imagesPath = input.readString();
        data.audioPath = input.readString();
      }
      for (let i = 0, n = input.readInt(true); i < n; i++)
        input.strings.push(required(input.readString(), "String in string table"));
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const name = required(input.readString(), "Bone name");
        const parent = i === 0 ? null : data.bones[input.readInt(true)];
        const bone = new BoneData(i, name, parent);
        bone.rotation = input.readFloat();
        bone.x = input.readFloat() * scale;
        bone.y = input.readFloat() * scale;
        bone.scaleX = input.readFloat();
        bone.scaleY = input.readFloat();
        bone.shearX = input.readFloat();
        bone.shearY = input.readFloat();
        bone.length = input.readFloat() * scale;
        bone.inherit = input.readByte();
        bone.skinRequired = input.readBoolean();
        if (nonessential) {
          Color.rgba8888ToColor(bone.color, input.readInt32());
          bone.icon = input.readString() ?? void 0;
          bone.visible = input.readBoolean();
        }
        data.bones.push(bone);
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const name = required(input.readString(), "Slot name");
        const slot = new SlotData(i, name, data.bones[input.readInt(true)]);
        Color.rgba8888ToColor(slot.color, input.readInt32());
        const dark = input.readInt32();
        if (dark !== -1) Color.rgb888ToColor(slot.darkColor = new Color(), dark);
        slot.attachmentName = input.readStringRef();
        slot.blendMode = input.readInt(true);
        if (nonessential) slot.visible = input.readBoolean();
        data.slots.push(slot);
      }
      const readBones = () => {
        const out = [];
        for (let i = 0, n = input.readInt(true); i < n; i++)
          out.push(data.bones[input.readInt(true)]);
        return out;
      };
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const c = new IkConstraintData(required(input.readString(), "IK constraint name"));
        c.order = input.readInt(true);
        c.bones = readBones();
        c.target = data.bones[input.readInt(true)];
        const flags = input.readByte();
        c.skinRequired = (flags & 1) !== 0;
        c.bendDirection = (flags & 2) !== 0 ? 1 : -1;
        c.compress = (flags & 4) !== 0;
        c.stretch = (flags & 8) !== 0;
        c.uniform = (flags & 16) !== 0;
        c.mix = (flags & 32) !== 0 ? (flags & 64) !== 0 ? input.readFloat() : 1 : 0;
        if ((flags & 128) !== 0) c.softness = input.readFloat() * scale;
        data.ikConstraints.push(c);
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const c = new TransformConstraintData(
          required(input.readString(), "Transform constraint name")
        );
        c.order = input.readInt(true);
        c.bones = readBones();
        c.target = data.bones[input.readInt(true)];
        let flags = input.readByte();
        c.skinRequired = (flags & 1) !== 0;
        c.local = (flags & 2) !== 0;
        c.relative = (flags & 4) !== 0;
        if ((flags & 8) !== 0) c.offsetRotation = input.readFloat();
        if ((flags & 16) !== 0) c.offsetX = input.readFloat() * scale;
        if ((flags & 32) !== 0) c.offsetY = input.readFloat() * scale;
        if ((flags & 64) !== 0) c.offsetScaleX = input.readFloat();
        if ((flags & 128) !== 0) c.offsetScaleY = input.readFloat();
        flags = input.readByte();
        if ((flags & 1) !== 0) c.offsetShearY = input.readFloat();
        if ((flags & 2) !== 0) c.mixRotate = input.readFloat();
        if ((flags & 4) !== 0) c.mixX = input.readFloat();
        if ((flags & 8) !== 0) c.mixY = input.readFloat();
        if ((flags & 16) !== 0) c.mixScaleX = input.readFloat();
        if ((flags & 32) !== 0) c.mixScaleY = input.readFloat();
        if ((flags & 64) !== 0) c.mixShearY = input.readFloat();
        data.transformConstraints.push(c);
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const c = new PathConstraintData(required(input.readString(), "Path constraint name"));
        c.order = input.readInt(true);
        c.skinRequired = input.readBoolean();
        c.bones = readBones();
        c.target = data.slots[input.readInt(true)];
        const flags = input.readByte();
        c.positionMode = flags & 1;
        c.spacingMode = flags >> 1 & 3;
        c.rotateMode = flags >> 3 & 3;
        if ((flags & 128) !== 0) c.offsetRotation = input.readFloat();
        c.position = input.readFloat();
        if (c.positionMode === PositionMode.Fixed) c.position *= scale;
        c.spacing = input.readFloat();
        if (c.spacingMode === SpacingMode.Length || c.spacingMode === SpacingMode.Fixed)
          c.spacing *= scale;
        c.mixRotate = input.readFloat();
        c.mixX = input.readFloat();
        c.mixY = input.readFloat();
        data.pathConstraints.push(c);
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const c = new PhysicsConstraintData(required(input.readString(), "Physics constraint name"));
        c.order = input.readInt(true);
        c.bone = data.bones[input.readInt(true)];
        let flags = input.readByte();
        c.skinRequired = (flags & 1) !== 0;
        if ((flags & 2) !== 0) c.x = input.readFloat();
        if ((flags & 4) !== 0) c.y = input.readFloat();
        if ((flags & 8) !== 0) c.rotate = input.readFloat();
        if ((flags & 16) !== 0) c.scaleX = input.readFloat();
        if ((flags & 32) !== 0) c.shearX = input.readFloat();
        c.limit = ((flags & 64) !== 0 ? input.readFloat() : 5e3) * scale;
        c.step = 1 / input.readUnsignedByte();
        c.inertia = input.readFloat();
        c.strength = input.readFloat();
        c.damping = input.readFloat();
        c.massInverse = (flags & 128) !== 0 ? input.readFloat() : 1;
        c.wind = input.readFloat();
        c.gravity = input.readFloat();
        flags = input.readByte();
        c.inertiaGlobal = (flags & 1) !== 0;
        c.strengthGlobal = (flags & 2) !== 0;
        c.dampingGlobal = (flags & 4) !== 0;
        c.massGlobal = (flags & 8) !== 0;
        c.windGlobal = (flags & 16) !== 0;
        c.gravityGlobal = (flags & 32) !== 0;
        c.mixGlobal = (flags & 64) !== 0;
        c.mix = (flags & 128) !== 0 ? input.readFloat() : 1;
        data.physicsConstraints.push(c);
      }
      const defaultSkin = this.readSkin(input, data, true, nonessential);
      if (defaultSkin) {
        data.defaultSkin = defaultSkin;
        data.skins.push(defaultSkin);
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const skin = this.readSkin(input, data, false, nonessential);
        if (skin) data.skins.push(skin);
      }
      for (const linked of this.linkedMeshes) {
        const skin = data.skins[linked.skinIndex];
        const parent = linked.parent ? skin.getAttachment(linked.slotIndex, linked.parent) : null;
        if (!(parent instanceof MeshAttachment))
          throw new Error(`Parent mesh not found: ${linked.parent}`);
        linked.mesh.timelineAttachment = linked.inheritTimelines ? parent : linked.mesh;
        linked.mesh.setParentMesh(parent);
        if (linked.mesh.region) linked.mesh.updateRegion();
      }
      this.linkedMeshes.length = 0;
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const event = new EventData(required(input.readString(), "Event name"));
        event.intValue = input.readInt(false);
        event.floatValue = input.readFloat();
        event.stringValue = input.readString();
        event.audioPath = input.readString();
        if (event.audioPath) {
          event.volume = input.readFloat();
          event.balance = input.readFloat();
        }
        data.events.push(event);
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const name = required(input.readString(), "Animation name");
        data.animations.push(this.readAnimation(input, name, data));
      }
      return data;
    }
    readSkin(input, data, isDefault, nonessential) {
      let skin;
      let slotCount;
      if (isDefault) {
        slotCount = input.readInt(true);
        if (slotCount === 0) return null;
        skin = new Skin("default");
      } else {
        skin = new Skin(required(input.readString(), "Skin name"));
        if (nonessential) Color.rgba8888ToColor(skin.color, input.readInt32());
        for (let i = 0, n = input.readInt(true); i < n; i++)
          skin.bones.push(data.bones[input.readInt(true)]);
        for (let i = 0, n = input.readInt(true); i < n; i++)
          skin.constraints.push(data.ikConstraints[input.readInt(true)]);
        for (let i = 0, n = input.readInt(true); i < n; i++)
          skin.constraints.push(data.transformConstraints[input.readInt(true)]);
        for (let i = 0, n = input.readInt(true); i < n; i++)
          skin.constraints.push(data.pathConstraints[input.readInt(true)]);
        for (let i = 0, n = input.readInt(true); i < n; i++)
          skin.constraints.push(data.physicsConstraints[input.readInt(true)]);
        slotCount = input.readInt(true);
      }
      for (let i = 0; i < slotCount; i++) {
        const slotIndex = input.readInt(true);
        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
          const name = required(input.readStringRef(), "Attachment name");
          const attachment = this.readAttachment(input, data, skin, slotIndex, name, nonessential);
          if (attachment) skin.setAttachment(slotIndex, name, attachment);
        }
      }
      return skin;
    }
    readSequence(input) {
      const sequence = new Sequence(input.readInt(true));
      sequence.start = input.readInt(true);
      sequence.digits = input.readInt(true);
      sequence.setupIndex = input.readInt(true);
      return sequence;
    }
    readAttachment(input, data, skin, slotIndex, attachmentName, nonessential) {
      const scale = this.scale;
      const loader = this.attachmentLoader;
      const flags = input.readByte();
      const name = required(
        (flags & 8) !== 0 ? input.readStringRef() : attachmentName,
        "Attachment name"
      );
      switch (flags & 7) {
        case ATTACHMENT_REGION: {
          let path = (flags & 16) !== 0 ? input.readStringRef() : null;
          const color = (flags & 32) !== 0 ? input.readInt32() : 4294967295;
          const sequence = (flags & 64) !== 0 ? this.readSequence(input) : null;
          const rotation = (flags & 128) !== 0 ? input.readFloat() : 0;
          const x = input.readFloat();
          const y = input.readFloat();
          const scaleX = input.readFloat();
          const scaleY = input.readFloat();
          const width = input.readFloat();
          const height = input.readFloat();
          if (!path) path = name;
          const region = loader.newRegionAttachment(skin, name, path, sequence);
          if (!region) return null;
          region.path = path;
          region.x = x * scale;
          region.y = y * scale;
          region.scaleX = scaleX;
          region.scaleY = scaleY;
          region.rotation = rotation;
          region.width = width * scale;
          region.height = height * scale;
          Color.rgba8888ToColor(region.color, color);
          region.sequence = sequence;
          if (!sequence) region.updateRegion();
          return region;
        }
        case ATTACHMENT_BOUNDINGBOX: {
          const vertices = this.readVertices(input, (flags & 16) !== 0);
          const color = nonessential ? input.readInt32() : 0;
          const box = loader.newBoundingBoxAttachment(skin, name);
          if (!box) return null;
          box.worldVerticesLength = vertices.length;
          box.vertices = vertices.vertices;
          box.bones = vertices.bones;
          if (nonessential) Color.rgba8888ToColor(box.color, color);
          return box;
        }
        case ATTACHMENT_MESH: {
          let path = (flags & 16) !== 0 ? input.readStringRef() : name;
          const color = (flags & 32) !== 0 ? input.readInt32() : 4294967295;
          const sequence = (flags & 64) !== 0 ? this.readSequence(input) : null;
          const hullLength = input.readInt(true);
          const vertices = this.readVertices(input, (flags & 128) !== 0);
          const uvs = this.readFloats(input, vertices.length, 1);
          const triangles = this.readShorts(input, (vertices.length - hullLength - 2) * 3);
          let edges = [];
          let width = 0;
          let height = 0;
          if (nonessential) {
            edges = this.readShorts(input, input.readInt(true));
            width = input.readFloat();
            height = input.readFloat();
          }
          if (!path) path = name;
          const mesh = loader.newMeshAttachment(skin, name, path, sequence);
          if (!mesh) return null;
          mesh.path = path;
          Color.rgba8888ToColor(mesh.color, color);
          mesh.bones = vertices.bones;
          mesh.vertices = vertices.vertices;
          mesh.worldVerticesLength = vertices.length;
          mesh.triangles = triangles;
          mesh.regionUVs = uvs;
          if (!sequence) mesh.updateRegion();
          mesh.hullLength = hullLength << 1;
          mesh.sequence = sequence;
          if (nonessential) {
            mesh.edges = edges;
            mesh.width = width * scale;
            mesh.height = height * scale;
          }
          return mesh;
        }
        case ATTACHMENT_LINKEDMESH: {
          const path = required(
            (flags & 16) !== 0 ? input.readStringRef() : name,
            "Linked mesh path"
          );
          const color = (flags & 32) !== 0 ? input.readInt32() : 4294967295;
          const sequence = (flags & 64) !== 0 ? this.readSequence(input) : null;
          const inheritTimelines = (flags & 128) !== 0;
          const skinIndex = input.readInt(true);
          const parent = input.readStringRef();
          let width = 0;
          let height = 0;
          if (nonessential) {
            width = input.readFloat();
            height = input.readFloat();
          }
          const mesh = loader.newMeshAttachment(skin, name, path, sequence);
          if (!mesh) return null;
          mesh.path = path;
          Color.rgba8888ToColor(mesh.color, color);
          mesh.sequence = sequence;
          if (nonessential) {
            mesh.width = width * scale;
            mesh.height = height * scale;
          }
          this.linkedMeshes.push(
            new LinkedMesh(mesh, skinIndex, slotIndex, parent, inheritTimelines)
          );
          return mesh;
        }
        case ATTACHMENT_PATH: {
          const closed = (flags & 16) !== 0;
          const constantSpeed = (flags & 32) !== 0;
          const vertices = this.readVertices(input, (flags & 64) !== 0);
          const lengths = new Array(vertices.length / 6);
          for (let i = 0; i < lengths.length; i++) lengths[i] = input.readFloat() * scale;
          const color = nonessential ? input.readInt32() : 0;
          const path = loader.newPathAttachment(skin, name);
          if (!path) return null;
          path.closed = closed;
          path.constantSpeed = constantSpeed;
          path.worldVerticesLength = vertices.length;
          path.vertices = vertices.vertices;
          path.bones = vertices.bones;
          path.lengths = lengths;
          if (nonessential) Color.rgba8888ToColor(path.color, color);
          return path;
        }
        case ATTACHMENT_POINT: {
          const rotation = input.readFloat();
          const x = input.readFloat();
          const y = input.readFloat();
          const color = nonessential ? input.readInt32() : 0;
          const point = loader.newPointAttachment(skin, name);
          if (!point) return null;
          point.x = x * scale;
          point.y = y * scale;
          point.rotation = rotation;
          if (nonessential) Color.rgba8888ToColor(point.color, color);
          return point;
        }
        case ATTACHMENT_CLIPPING: {
          const endSlotIndex = input.readInt(true);
          const vertices = this.readVertices(input, (flags & 16) !== 0);
          const color = nonessential ? input.readInt32() : 0;
          const clip = loader.newClippingAttachment(skin, name);
          if (!clip) return null;
          clip.endSlot = data.slots[endSlotIndex];
          clip.worldVerticesLength = vertices.length;
          clip.vertices = vertices.vertices;
          clip.bones = vertices.bones;
          if (nonessential) Color.rgba8888ToColor(clip.color, color);
          return clip;
        }
      }
      return null;
    }
    readVertices(input, weighted) {
      const scale = this.scale;
      const vertexCount = input.readInt(true);
      const length = vertexCount << 1;
      if (!weighted)
        return {
          length,
          bones: null,
          vertices: new Float32Array(this.readFloats(input, length, scale))
        };
      const weights = [];
      const bones = [];
      for (let i = 0; i < vertexCount; i++) {
        const boneCount = input.readInt(true);
        bones.push(boneCount);
        for (let ii = 0; ii < boneCount; ii++) {
          bones.push(input.readInt(true));
          weights.push(input.readFloat() * scale, input.readFloat() * scale, input.readFloat());
        }
      }
      return { length, bones, vertices: new Float32Array(weights) };
    }
    readFloats(input, n, scale) {
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = input.readFloat() * scale;
      return out;
    }
    readShorts(input, n) {
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = input.readInt(true);
      return out;
    }
    readAnimation(input, name, data) {
      input.readInt(true);
      const timelines = [];
      const scale = this.scale;
      const readCurve = (timeline, frame, time1, time2, from, to, scales) => {
        switch (input.readByte()) {
          case CURVE_STEPPED:
            timeline.setStepped(frame);
            break;
          case CURVE_BEZIER:
            for (let v = 0; v < from.length; v++)
              this.setBezier(input, timeline, frame, v, time1, time2, from[v], to[v], scales[v]);
        }
      };
      const readFrames = (timeline, read, scales) => {
        const last = timeline.getFrameCount() - 1;
        let time = input.readFloat();
        let values = read();
        for (let frame = 0; ; frame++) {
          timeline.setFrame(frame, time, ...values);
          if (frame === last) break;
          const time2 = input.readFloat();
          const values2 = read();
          readCurve(timeline, frame, time, time2, values, values2, scales);
          time = time2;
          values = values2;
        }
      };
      const floats = (n, s = 1) => () => Array.from({ length: n }, () => input.readFloat() * s);
      const bytes = (n) => () => Array.from({ length: n }, () => input.readUnsignedByte() / 255);
      const timeline1 = (t, s) => {
        readFrames(t, floats(1, s), [s]);
        return t;
      };
      const timeline2 = (t, s) => {
        readFrames(t, floats(2, s), [s, s]);
        return t;
      };
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const slotIndex = input.readInt(true);
        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
          const type = input.readByte();
          const frameCount = input.readInt(true);
          if (type === 0) {
            const t = new AttachmentTimeline(frameCount, slotIndex);
            for (let f = 0; f < frameCount; f++)
              t.setFrame(f, input.readFloat(), input.readStringRef());
            timelines.push(t);
            continue;
          }
          const bezierCount = input.readInt(true);
          switch (type) {
            case 1: {
              const t = new RGBATimeline(frameCount, bezierCount, slotIndex);
              readFrames(t, bytes(4), [1, 1, 1, 1]);
              timelines.push(t);
              break;
            }
            case 2: {
              const t = new RGBTimeline(frameCount, bezierCount, slotIndex);
              readFrames(t, bytes(3), [1, 1, 1]);
              timelines.push(t);
              break;
            }
            case 3: {
              const t = new RGBA2Timeline(frameCount, bezierCount, slotIndex);
              readFrames(t, bytes(7), [1, 1, 1, 1, 1, 1, 1]);
              timelines.push(t);
              break;
            }
            case 4: {
              const t = new RGB2Timeline(frameCount, bezierCount, slotIndex);
              readFrames(t, bytes(6), [1, 1, 1, 1, 1, 1]);
              timelines.push(t);
              break;
            }
            case 5: {
              const t = new AlphaTimeline(frameCount, bezierCount, slotIndex);
              readFrames(t, bytes(1), [1]);
              timelines.push(t);
              break;
            }
          }
        }
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const boneIndex = input.readInt(true);
        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
          const type = input.readByte();
          const frameCount = input.readInt(true);
          if (type === 10) {
            const t = new InheritTimeline(frameCount, boneIndex);
            for (let f = 0; f < frameCount; f++)
              t.setFrame(f, input.readFloat(), input.readByte());
            timelines.push(t);
            continue;
          }
          const bezierCount = input.readInt(true);
          switch (type) {
            case 0:
              timelines.push(timeline1(new RotateTimeline(frameCount, bezierCount, boneIndex), 1));
              break;
            case 1:
              timelines.push(
                timeline2(new TranslateTimeline(frameCount, bezierCount, boneIndex), scale)
              );
              break;
            case 2:
              timelines.push(
                timeline1(new TranslateXTimeline(frameCount, bezierCount, boneIndex), scale)
              );
              break;
            case 3:
              timelines.push(
                timeline1(new TranslateYTimeline(frameCount, bezierCount, boneIndex), scale)
              );
              break;
            case 4:
              timelines.push(timeline2(new ScaleTimeline(frameCount, bezierCount, boneIndex), 1));
              break;
            case 5:
              timelines.push(timeline1(new ScaleXTimeline(frameCount, bezierCount, boneIndex), 1));
              break;
            case 6:
              timelines.push(timeline1(new ScaleYTimeline(frameCount, bezierCount, boneIndex), 1));
              break;
            case 7:
              timelines.push(timeline2(new ShearTimeline(frameCount, bezierCount, boneIndex), 1));
              break;
            case 8:
              timelines.push(timeline1(new ShearXTimeline(frameCount, bezierCount, boneIndex), 1));
              break;
            case 9:
              timelines.push(timeline1(new ShearYTimeline(frameCount, bezierCount, boneIndex), 1));
              break;
          }
        }
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const index = input.readInt(true);
        const frameCount = input.readInt(true);
        const last = frameCount - 1;
        const t = new IkConstraintTimeline(frameCount, input.readInt(true), index);
        let flags = input.readByte();
        const mixOf = (f) => (f & 1) !== 0 ? (f & 2) !== 0 ? input.readFloat() : 1 : 0;
        let time = input.readFloat();
        let mix = mixOf(flags);
        let softness = (flags & 4) !== 0 ? input.readFloat() * scale : 0;
        for (let frame = 0; ; frame++) {
          t.setFrame(
            frame,
            time,
            mix,
            softness,
            (flags & 8) !== 0 ? 1 : -1,
            (flags & 16) !== 0,
            (flags & 32) !== 0
          );
          if (frame === last) break;
          flags = input.readByte();
          const time2 = input.readFloat();
          const mix2 = mixOf(flags);
          const softness2 = (flags & 4) !== 0 ? input.readFloat() * scale : 0;
          if ((flags & 64) !== 0) t.setStepped(frame);
          else if ((flags & 128) !== 0) {
            this.setBezier(input, t, frame, 0, time, time2, mix, mix2, 1);
            this.setBezier(input, t, frame, 1, time, time2, softness, softness2, scale);
          }
          time = time2;
          mix = mix2;
          softness = softness2;
        }
        timelines.push(t);
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const index = input.readInt(true);
        const frameCount = input.readInt(true);
        const t = new TransformConstraintTimeline(frameCount, input.readInt(true), index);
        readFrames(t, floats(6), [1, 1, 1, 1, 1, 1]);
        timelines.push(t);
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const index = input.readInt(true);
        const constraint = data.pathConstraints[index];
        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
          const type = input.readByte();
          const frameCount = input.readInt(true);
          const bezierCount = input.readInt(true);
          switch (type) {
            case 0:
              timelines.push(
                timeline1(
                  new PathConstraintPositionTimeline(frameCount, bezierCount, index),
                  constraint.positionMode === PositionMode.Fixed ? scale : 1
                )
              );
              break;
            case 1:
              timelines.push(
                timeline1(
                  new PathConstraintSpacingTimeline(frameCount, bezierCount, index),
                  constraint.spacingMode === SpacingMode.Length || constraint.spacingMode === SpacingMode.Fixed ? scale : 1
                )
              );
              break;
            case 2: {
              const t = new PathConstraintMixTimeline(frameCount, bezierCount, index);
              readFrames(t, floats(3), [1, 1, 1]);
              timelines.push(t);
              break;
            }
          }
        }
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const index = input.readInt(true) - 1;
        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
          const type = input.readByte();
          const frameCount = input.readInt(true);
          if (type === 8) {
            const t = new PhysicsConstraintResetTimeline(frameCount, index);
            for (let f = 0; f < frameCount; f++) t.setFrame(f, input.readFloat());
            timelines.push(t);
            continue;
          }
          const bezierCount = input.readInt(true);
          const make = [
            PhysicsConstraintInertiaTimeline,
            PhysicsConstraintStrengthTimeline,
            PhysicsConstraintDampingTimeline,
            null,
            PhysicsConstraintMassTimeline,
            PhysicsConstraintWindTimeline,
            PhysicsConstraintGravityTimeline,
            PhysicsConstraintMixTimeline
          ][type];
          if (make) timelines.push(timeline1(new make(frameCount, bezierCount, index), 1));
        }
      }
      for (let i = 0, n = input.readInt(true); i < n; i++) {
        const skin = data.skins[input.readInt(true)];
        for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
          const slotIndex = input.readInt(true);
          for (let iii = 0, nnn = input.readInt(true); iii < nnn; iii++) {
            const attachmentName = required(input.readStringRef(), "Attachment name");
            const attachment = skin.getAttachment(slotIndex, attachmentName);
            const type = input.readByte();
            const frameCount = input.readInt(true);
            const last = frameCount - 1;
            if (type === 0) {
              if (!(attachment instanceof VertexAttachment))
                throw new Error(`Deform attachment not found: ${attachmentName}`);
              const weighted = !!attachment.bones;
              const setup = attachment.vertices;
              const length = weighted ? setup.length / 3 * 2 : setup.length;
              const t = new DeformTimeline(frameCount, input.readInt(true), slotIndex, attachment);
              let time = input.readFloat();
              for (let frame = 0; ; frame++) {
                let deform;
                let end = input.readInt(true);
                if (end === 0) deform = weighted ? new Float32Array(length) : setup;
                else {
                  deform = new Float32Array(length);
                  const start = input.readInt(true);
                  end += start;
                  for (let v = start; v < end; v++) deform[v] = input.readFloat() * scale;
                  if (!weighted) for (let v = 0; v < length; v++) deform[v] += setup[v];
                }
                t.setFrame(frame, time, deform);
                if (frame === last) break;
                const time2 = input.readFloat();
                readCurve(t, frame, time, time2, [0], [1], [1]);
                time = time2;
              }
              timelines.push(t);
            } else if (type === 1) {
              if (!attachment) throw new Error(`Sequence attachment not found: ${attachmentName}`);
              if (!attachment.sequence)
                throw new Error(`Sequence keys on an attachment with no sequence: ${attachmentName}`);
              const t = new SequenceTimeline(
                frameCount,
                slotIndex,
                attachment
              );
              for (let f = 0; f < frameCount; f++) {
                const time = input.readFloat();
                const modeAndIndex = input.readInt32();
                t.setFrame(
                  f,
                  time,
                  SequenceModeValues[modeAndIndex & 15],
                  modeAndIndex >> 4,
                  input.readFloat()
                );
              }
              timelines.push(t);
            }
          }
        }
      }
      const drawOrderCount = input.readInt(true);
      if (drawOrderCount > 0) {
        const t = new DrawOrderTimeline(drawOrderCount);
        const slotCount = data.slots.length;
        for (let i = 0; i < drawOrderCount; i++) {
          const time = input.readFloat();
          const offsetCount = input.readInt(true);
          const order = new Array(slotCount).fill(-1);
          const unchanged = new Array(slotCount - offsetCount).fill(0);
          let original = 0;
          let u = 0;
          for (let ii = 0; ii < offsetCount; ii++) {
            const slotIndex = input.readInt(true);
            while (original !== slotIndex) unchanged[u++] = original++;
            order[original + input.readInt(true)] = original++;
          }
          while (original < slotCount) unchanged[u++] = original++;
          for (let ii = slotCount - 1; ii >= 0; ii--)
            if (order[ii] === -1) order[ii] = unchanged[--u];
          t.setFrame(i, time, order);
        }
        timelines.push(t);
      }
      const eventCount = input.readInt(true);
      if (eventCount > 0) {
        const t = new EventTimeline(eventCount);
        for (let i = 0; i < eventCount; i++) {
          const time = input.readFloat();
          const eventData = data.events[input.readInt(true)];
          const event = new Event(time, eventData);
          event.intValue = input.readInt(false);
          event.floatValue = input.readFloat();
          event.stringValue = input.readString() ?? eventData.stringValue;
          if (eventData.audioPath) {
            event.volume = input.readFloat();
            event.balance = input.readFloat();
          }
          t.setFrame(i, event);
        }
        timelines.push(t);
      }
      let duration = 0;
      for (const t of timelines) duration = Math.max(duration, t.getDuration());
      return new Animation(name, timelines, duration);
    }
    setBezier(input, timeline, frame, value, time1, time2, value1, value2, scale) {
      const cx1 = input.readFloat();
      const cy1 = input.readFloat() * scale;
      const cx2 = input.readFloat();
      const cy2 = input.readFloat() * scale;
      timeline.setBezier(0, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2);
    }
  }
  class ManagedWebGLRenderingContext {
    constructor(canvasOrContext, contextConfig = { alpha: true }) {
      var _a;
      this.restorables = [];
      if (canvasOrContext instanceof WebGLRenderingContext || isWebGL2(canvasOrContext)) {
        this.gl = canvasOrContext;
        this.canvas = this.gl.canvas;
      } else {
        const canvas2 = canvasOrContext;
        const gl = canvas2.getContext("webgl2", contextConfig) ?? canvas2.getContext("webgl", contextConfig);
        if (!gl) throw new Error("WebGL is not available.");
        this.gl = gl;
        this.canvas = canvas2;
      }
      const canvas = this.canvas;
      (_a = canvas.addEventListener) == null ? void 0 : _a.call(canvas, "webglcontextrestored", () => {
        for (const r of this.restorables) r.restore();
      });
    }
    addRestorable(restorable) {
      this.restorables.push(restorable);
    }
    removeRestorable(restorable) {
      const i = this.restorables.indexOf(restorable);
      if (i >= 0) this.restorables.splice(i, 1);
    }
  }
  function isWebGL2(value) {
    return typeof WebGL2RenderingContext !== "undefined" && value instanceof WebGL2RenderingContext;
  }
  function managed(context) {
    return context instanceof ManagedWebGLRenderingContext ? context : new ManagedWebGLRenderingContext(context);
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    setFrom(v) {
      return this.set(v.x, v.y, v.z);
    }
    add(v) {
      return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
    }
    sub(v) {
      return this.set(this.x - v.x, this.y - v.y, this.z - v.z);
    }
    scale(s) {
      return this.set(this.x * s, this.y * s, this.z * s);
    }
    length() {
      return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    normalize() {
      const len = this.length();
      return len === 0 ? this : this.scale(1 / len);
    }
    dot(v) {
      return this.x * v.x + this.y * v.y + this.z * v.z;
    }
    cross(v) {
      return this.set(
        this.y * v.z - this.z * v.y,
        this.z * v.x - this.x * v.z,
        this.x * v.y - this.y * v.x
      );
    }
    distance(v) {
      const dx = v.x - this.x;
      const dy = v.y - this.y;
      const dz = v.z - this.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  class OrthoCamera {
    constructor(viewportWidth, viewportHeight) {
      this.viewportWidth = viewportWidth;
      this.viewportHeight = viewportHeight;
      this.position = new Vector3(0, 0, 0);
      this.direction = new Vector3(0, 0, -1);
      this.up = new Vector3(0, 1, 0);
      this.near = 0;
      this.far = 100;
      this.zoom = 1;
      this.projectionView = new Float32Array(16);
      this.ax = 1;
      this.ay = 0;
      this.bx = 0;
      this.by = 1;
      this.update();
    }
    update() {
      const len = Math.hypot(this.up.x, this.up.y) || 1;
      this.bx = this.up.x / len;
      this.by = this.up.y / len;
      this.ax = this.by;
      this.ay = -this.bx;
      const sx = 2 / (this.zoom * this.viewportWidth);
      const sy = 2 / (this.zoom * this.viewportHeight);
      const sz = -2 / (this.far - this.near);
      const px = this.position.x;
      const py = this.position.y;
      const pz = this.position.z;
      const m = this.projectionView;
      m.fill(0);
      m[0] = this.ax * sx;
      m[4] = this.ay * sx;
      m[12] = -(this.ax * px + this.ay * py) * sx;
      m[1] = this.bx * sy;
      m[5] = this.by * sy;
      m[13] = -(this.bx * px + this.by * py) * sy;
      m[10] = sz;
      m[14] = -pz * sz - (this.far + this.near) / (this.far - this.near);
      m[15] = 1;
    }
    /** Canvas pixels (y down) → world. */
    screenToWorld(screen, screenWidth, screenHeight) {
      const nx = 2 * screen.x / screenWidth - 1;
      const ny = 2 * (screenHeight - screen.y - 1) / screenHeight - 1;
      const vx = nx * this.zoom * this.viewportWidth / 2;
      const vy = ny * this.zoom * this.viewportHeight / 2;
      screen.x = this.position.x + vx * this.ax + vy * this.bx;
      screen.y = this.position.y + vx * this.ay + vy * this.by;
      screen.z = this.position.z;
      return screen;
    }
    /** World → canvas pixels with y UP (0 at the bottom edge). */
    worldToScreen(world, screenWidth, screenHeight) {
      const m = this.projectionView;
      const nx = m[0] * world.x + m[4] * world.y + m[12];
      const ny = m[1] * world.x + m[5] * world.y + m[13];
      const nz = m[10] * world.z + m[14];
      world.x = screenWidth * (nx + 1) / 2;
      world.y = screenHeight * (ny + 1) / 2;
      world.z = (nz + 1) / 2;
      return world;
    }
    setViewport(width, height) {
      this.viewportWidth = width;
      this.viewportHeight = height;
    }
  }
  class GLTexture {
    constructor(context, image, useMipMaps = false) {
      this.texture = null;
      this.boundUnit = 0;
      this.context = managed(context);
      this._image = image;
      this.useMipMaps = useMipMaps;
      this.restore();
      this.context.addRestorable(this);
    }
    getImage() {
      return this._image;
    }
    setFilters(minFilter, magFilter) {
      const gl = this.context.gl;
      this.bind();
      let min = minFilter;
      if (!this.useMipMaps && min !== TextureFilter.Nearest && min !== TextureFilter.Linear)
        min = gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MAG_FILTER,
        magFilter === TextureFilter.Nearest ? gl.NEAREST : gl.LINEAR
      );
    }
    setWraps(uWrap, vWrap) {
      const gl = this.context.gl;
      this.bind();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, uWrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, vWrap);
    }
    update(useMipMaps) {
      const gl = this.context.gl;
      if (!this.texture) this.texture = gl.createTexture();
      this.bind();
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        useMipMaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (useMipMaps) gl.generateMipmap(gl.TEXTURE_2D);
    }
    restore() {
      this.texture = null;
      this.update(this.useMipMaps);
    }
    bind(unit = 0) {
      const gl = this.context.gl;
      this.boundUnit = unit;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }
    unbind() {
      const gl = this.context.gl;
      gl.activeTexture(gl.TEXTURE0 + this.boundUnit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    dispose() {
      this.context.removeRestorable(this);
      this.context.gl.deleteTexture(this.texture);
      this.texture = null;
    }
  }
  class AssetManager {
    constructor(context, pathPrefix = "") {
      this.pathPrefix = pathPrefix;
      this.assets = {};
      this.errors = {};
      this.toLoad = 0;
      this.loaded = 0;
      this.context = managed(context);
    }
    start(path) {
      this.toLoad++;
      return this.pathPrefix + path;
    }
    succeed(callback, path, asset) {
      this.toLoad--;
      this.loaded++;
      this.assets[path] = asset;
      callback == null ? void 0 : callback(path, asset);
    }
    fail(callback, path, message) {
      this.toLoad--;
      this.loaded++;
      this.errors[path] = message;
      callback == null ? void 0 : callback(path, message);
    }
    async fetchOk(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't load ${url}: status ${res.status}, ${res.statusText}`);
      return res;
    }
    loadText(path, success, error) {
      const url = this.start(path);
      this.fetchOk(url).then((r) => r.text()).then(
        (t) => this.succeed(success, url, t),
        (e) => this.fail(error, url, e.message)
      );
    }
    loadJson(path, success, error) {
      const url = this.start(path);
      this.fetchOk(url).then((r) => r.text()).then(
        (t) => this.succeed(success, url, JSON.parse(t)),
        (e) => this.fail(error, url, e.message)
      );
    }
    loadBinary(path, success, error) {
      const url = this.start(path);
      this.fetchOk(url).then((r) => r.arrayBuffer()).then(
        (b) => this.succeed(success, url, new Uint8Array(b)),
        (e) => this.fail(error, url, e.message)
      );
    }
    image(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Couldn't load image ${url}`));
        img.src = url;
      });
    }
    loadTexture(path, success, error) {
      const url = this.start(path);
      this.image(url).then(
        (img) => this.succeed(success, url, new GLTexture(this.context, img)),
        (e) => this.fail(error, url, e.message)
      );
    }
    /** Loads the atlas text, then each page image from the atlas's folder (or `fileAlias`). */
    loadTextureAtlas(path, success, error, fileAlias) {
      const slash = path.lastIndexOf("/");
      const parent = slash >= 0 ? path.substring(0, slash + 1) : "";
      const url = this.start(path);
      this.fetchOk(url).then((r) => r.text()).then(async (text) => {
        const atlas = new TextureAtlas(text);
        await Promise.all(
          atlas.pages.map(async (page) => {
            const imagePath = this.pathPrefix + (fileAlias ? fileAlias[page.name] : parent + page.name);
            const img = await this.image(imagePath).catch(() => {
              throw new Error(`Couldn't load texture atlas ${url} page image: ${imagePath}`);
            });
            page.setTexture(new GLTexture(this.context, img));
          })
        );
        this.succeed(success, url, atlas);
      }).catch((e) => this.fail(error, url, e.message));
    }
    get(path) {
      return this.assets[this.pathPrefix + path];
    }
    require(path) {
      const full = this.pathPrefix + path;
      const asset = this.assets[full];
      if (asset !== void 0) return asset;
      const error = this.errors[full];
      throw new Error(`Asset not found: ${path}${error ? "\n" + error : ""}`);
    }
    remove(path) {
      var _a;
      const full = this.pathPrefix + path;
      const asset = this.assets[full];
      (_a = asset == null ? void 0 : asset.dispose) == null ? void 0 : _a.call(asset);
      delete this.assets[full];
      return asset;
    }
    removeAll() {
      var _a, _b;
      for (const key of Object.keys(this.assets))
        (_b = (_a = this.assets[key]) == null ? void 0 : _a.dispose) == null ? void 0 : _b.call(_a);
      this.assets = {};
    }
    isLoadingComplete() {
      return this.toLoad === 0;
    }
    getToLoad() {
      return this.toLoad;
    }
    getLoaded() {
      return this.loaded;
    }
    hasErrors() {
      return Object.keys(this.errors).length > 0;
    }
    getErrors() {
      return this.errors;
    }
    dispose() {
      this.removeAll();
    }
  }
  const TEXTURED_VS = `
attribute vec2 aPosition;
attribute vec4 aLight;
attribute vec4 aDark;
attribute vec2 aUV;
uniform mat4 uProjection;
varying vec4 vLight;
varying vec4 vDark;
varying vec2 vUV;
void main() {
	vLight = aLight;
	vDark = aDark;
	vUV = aUV;
	gl_Position = uProjection * vec4(aPosition, 0.0, 1.0);
}`;
  const TEXTURED_FS = `
precision mediump float;
varying vec4 vLight;
varying vec4 vDark;
varying vec2 vUV;
uniform sampler2D uTexture;
void main() {
	vec4 tex = texture2D(uTexture, vUV);
	gl_FragColor.a = tex.a * vLight.a;
	gl_FragColor.rgb = ((tex.a - 1.0) * vDark.a + 1.0 - tex.rgb) * vDark.rgb + tex.rgb * vLight.rgb;
}`;
  const SHAPE_VS = `
attribute vec2 aPosition;
attribute vec4 aColor;
uniform mat4 uProjection;
varying vec4 vColor;
void main() {
	vColor = aColor;
	gl_Position = uProjection * vec4(aPosition, 0.0, 1.0);
}`;
  const SHAPE_FS = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;
  function compile(gl, vs, fs, attributes) {
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
    attributes.forEach(([name], i) => gl.bindAttribLocation(program, i, name));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Program: ${gl.getProgramInfoLog(program)}`);
    return {
      program,
      attributes: attributes.map(([, size], i) => ({ location: i, size })),
      stride: attributes.reduce((n, [, size]) => n + size, 0),
      projection: gl.getUniformLocation(program, "uProjection"),
      texture: gl.getUniformLocation(program, "uTexture")
    };
  }
  const MAX_VERTICES = 10920;
  const QUAD = [0, 1, 2, 2, 3, 0];
  class SkeletonDebugRenderer {
    constructor() {
      this.boneLineColor = new Color(1, 0, 0, 1);
      this.boneOriginColor = new Color(0, 1, 0, 1);
      this.attachmentLineColor = new Color(0, 0, 1, 0.5);
      this.triangleLineColor = new Color(1, 0.64, 0, 0.5);
      this.pathColor = new Color().setFromString("FF7F00");
      this.clipColor = new Color(0.8, 0, 0, 2);
      this.aabbColor = new Color(0, 1, 0, 0.5);
      this.drawBones = true;
      this.drawRegionAttachments = true;
      this.drawBoundingBoxes = true;
      this.drawMeshHull = true;
      this.drawMeshTriangles = true;
      this.drawPaths = true;
      this.drawSkeletonXY = false;
      this.drawClipping = true;
      this.premultipliedAlpha = false;
      this.scale = 1;
      this.boneWidth = 2;
    }
  }
  class SceneRenderer {
    constructor(canvas, context, twoColorTint = true) {
      this.skeletonDebugRenderer = new SkeletonDebugRenderer();
      this.indices = new Uint16Array(MAX_VERTICES * 3);
      this.vertexCount = 0;
      this.indexCount = 0;
      this.program = null;
      this.mode = 0;
      this.texture = null;
      this.srcColor = 0;
      this.dstColor = 0;
      this.srcAlpha = 0;
      this.dstAlpha = 0;
      this.clipper = new SkeletonClipping();
      this.world = [];
      this.drawing = false;
      this.canvas = canvas;
      this.context = managed(context);
      this.gl = this.context.gl;
      this.twoColorTint = twoColorTint;
      this.camera = new OrthoCamera(canvas.width, canvas.height);
      const gl = this.gl;
      this.textured = compile(gl, TEXTURED_VS, TEXTURED_FS, [
        ["aPosition", 2],
        ["aLight", 4],
        ["aDark", 4],
        ["aUV", 2]
      ]);
      this.shapes = compile(gl, SHAPE_VS, SHAPE_FS, [
        ["aPosition", 2],
        ["aColor", 4]
      ]);
      this.vertices = new Float32Array(MAX_VERTICES * this.textured.stride);
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();
    }
    begin() {
      this.camera.update();
      this.drawing = true;
      this.program = null;
      this.texture = null;
      this.srcColor = this.dstColor = this.srcAlpha = this.dstAlpha = 0;
    }
    end() {
      this.flush();
      this.drawing = false;
      const gl = this.gl;
      for (const a of [...this.textured.attributes]) gl.disableVertexAttribArray(a.location);
    }
    resize() {
      const canvas = this.canvas;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      this.gl.viewport(0, 0, canvas.width, canvas.height);
      this.camera.setViewport(canvas.width, canvas.height);
      this.camera.update();
    }
    use(program, mode, texture, blend) {
      const [src, dst, srcA, dstA] = blend;
      if (this.program === program && this.mode === mode && this.texture === texture && this.srcColor === src && this.dstColor === dst && this.srcAlpha === srcA && this.dstAlpha === dstA)
        return;
      this.flush();
      this.program = program;
      this.mode = mode;
      this.texture = texture;
      this.srcColor = src;
      this.dstColor = dst;
      this.srcAlpha = srcA;
      this.dstAlpha = dstA;
    }
    flush() {
      const program = this.program;
      if (!program || this.indexCount === 0) {
        this.vertexCount = 0;
        this.indexCount = 0;
        return;
      }
      const gl = this.gl;
      gl.useProgram(program.program);
      gl.uniformMatrix4fv(program.projection, false, this.camera.projectionView);
      if (this.texture) {
        this.texture.bind(0);
        gl.uniform1i(program.texture, 0);
      }
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(this.srcColor, this.dstColor, this.srcAlpha, this.dstAlpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        this.vertices.subarray(0, this.vertexCount * program.stride),
        gl.DYNAMIC_DRAW
      );
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        this.indices.subarray(0, this.indexCount),
        gl.DYNAMIC_DRAW
      );
      let offset = 0;
      for (const a of program.attributes) {
        gl.enableVertexAttribArray(a.location);
        gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, program.stride * 4, offset * 4);
        offset += a.size;
      }
      for (let i = program.attributes.length; i < this.textured.attributes.length; i++)
        gl.disableVertexAttribArray(i);
      gl.drawElements(this.mode, this.indexCount, gl.UNSIGNED_SHORT, 0);
      this.vertexCount = 0;
      this.indexCount = 0;
    }
    /** Appends `count` vertices (`stride` floats each, via `write`) and their indices. */
    push(count, indices, write) {
      const program = this.program;
      if (this.vertexCount + count > MAX_VERTICES || this.indexCount + indices.length > this.indices.length)
        this.flush();
      const base = this.vertexCount;
      for (let i = 0; i < count; i++) write(this.vertices, (base + i) * program.stride, i);
      for (let i = 0; i < indices.length; i++) this.indices[this.indexCount + i] = base + indices[i];
      this.vertexCount += count;
      this.indexCount += indices.length;
    }
    /** Color and alpha factors per blend mode. Alpha accumulates like the color it pairs with, so a
     * transparent canvas composites the same as an opaque one would show. */
    blendFunc(mode, pma) {
      const gl = this.gl;
      switch (mode) {
        case BlendMode.Additive:
          return [pma ? gl.ONE : gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE];
        case BlendMode.Multiply:
          return [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
        case BlendMode.Screen:
          return [gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_COLOR];
      }
      return [pma ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    }
    /** Draws a skeleton's regions and meshes in draw order, clipped by its clipping attachments.
     * Only slots whose draw-order position is in [slotRangeStart, slotRangeEnd] when given. */
    drawSkeleton(skeleton, premultipliedAlpha = false, slotRangeStart = -1, slotRangeEnd = -1) {
      const clipper = this.clipper;
      const pma = premultipliedAlpha;
      const sc = skeleton.color;
      let inRange = slotRangeStart === -1;
      const world = this.world;
      for (let i = 0; i < skeleton.drawOrder.length; i++) {
        const slot = skeleton.drawOrder[i];
        if (slotRangeStart >= 0 && slotRangeStart === slot.data.index) inRange = true;
        if (!inRange || !slot.bone.active) {
          clipper.clipEndWithSlot(slot);
          if (slotRangeEnd >= 0 && slotRangeEnd === slot.data.index) inRange = false;
          continue;
        }
        if (slotRangeEnd >= 0 && slotRangeEnd === slot.data.index) inRange = false;
        const attachment = slot.getAttachment();
        if (attachment instanceof ClippingAttachment) {
          clipper.clipStart(slot, attachment);
          continue;
        }
        let positions;
        let uvs;
        let triangles;
        let region;
        let color;
        if (attachment instanceof RegionAttachment) {
          world.length = 8;
          attachment.computeWorldVertices(slot, world, 0, 2);
          positions = world;
          uvs = attachment.uvs;
          triangles = QUAD;
          region = attachment.region;
          color = attachment.color;
        } else if (attachment instanceof MeshAttachment) {
          const n = attachment.worldVerticesLength;
          world.length = n;
          attachment.computeWorldVertices(slot, 0, n, world, 0, 2);
          positions = world;
          uvs = attachment.uvs;
          triangles = attachment.triangles;
          region = attachment.region;
          color = attachment.color;
        } else {
          clipper.clipEndWithSlot(slot);
          continue;
        }
        const texture = pageTexture(region);
        const a = sc.a * slot.color.a * color.a;
        if (!texture) {
          clipper.clipEndWithSlot(slot);
          continue;
        }
        if (clipper.isClipping()) {
          clipper.clipTrianglesUnpacked(positions, triangles, triangles.length, uvs);
          positions = clipper.clippedVertices;
          uvs = clipper.clippedUVs;
          triangles = clipper.clippedTriangles;
        }
        if (triangles.length) {
          const m = pma ? a : 1;
          const r = sc.r * slot.color.r * color.r * m;
          const g = sc.g * slot.color.g * color.g * m;
          const b = sc.b * slot.color.b * color.b * m;
          const dark = slot.darkColor;
          const dr = dark ? dark.r * (pma ? a : 1) : 0;
          const dg = dark ? dark.g * (pma ? a : 1) : 0;
          const db = dark ? dark.b * (pma ? a : 1) : 0;
          const da = dark ? pma ? 1 : 0 : 1;
          this.use(
            this.textured,
            this.gl.TRIANGLES,
            texture,
            this.blendFunc(slot.data.blendMode, pma)
          );
          const p = positions;
          const t = uvs;
          this.push(uvs.length >> 1, triangles, (v, at, k) => {
            v[at] = p[k * 2];
            v[at + 1] = p[k * 2 + 1];
            v[at + 2] = r;
            v[at + 3] = g;
            v[at + 4] = b;
            v[at + 5] = a;
            v[at + 6] = dr;
            v[at + 7] = dg;
            v[at + 8] = db;
            v[at + 9] = da;
            v[at + 10] = t[k * 2];
            v[at + 11] = t[k * 2 + 1];
          });
        }
        clipper.clipEndWithSlot(slot);
      }
      clipper.clipEnd();
    }
    shape(mode) {
      const gl = this.gl;
      this.use(this.shapes, mode, null, [
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      ]);
    }
    colored(points, indices, color, color2) {
      const c2 = color2 ?? color;
      this.push(points.length >> 1, indices, (v, at, k) => {
        const c = k % 2 === 1 ? c2 : color;
        v[at] = points[k * 2];
        v[at + 1] = points[k * 2 + 1];
        v[at + 2] = c.r;
        v[at + 3] = c.g;
        v[at + 4] = c.b;
        v[at + 5] = c.a;
      });
    }
    line(x, y, x2, y2, color = Color.WHITE, color2) {
      this.shape(this.gl.LINES);
      this.colored([x, y, x2, y2], [0, 1], color, color2);
    }
    /** A circle outline, or a filled disc. `segments` 0 picks a count from the radius. */
    circle(filled, x, y, radius, color = Color.WHITE, segments = 0) {
      const n = segments > 0 ? segments : Math.max(1, Math.floor(6 * Math.cbrt(radius)));
      const points = [];
      for (let i = 0; i < n; i++) {
        const t = i / n * Math.PI * 2;
        points.push(x + Math.cos(t) * radius, y + Math.sin(t) * radius);
      }
      if (filled) {
        points.push(x, y);
        const indices = [];
        for (let i = 0; i < n; i++) indices.push(n, i, (i + 1) % n);
        this.shape(this.gl.TRIANGLES);
        this.colored(points, indices, color);
      } else {
        const indices = [];
        for (let i = 0; i < n; i++) indices.push(i, (i + 1) % n);
        this.shape(this.gl.LINES);
        this.colored(points, indices, color);
      }
    }
    rect(filled, x, y, width, height, color = Color.WHITE) {
      this.polygon([x, y, x + width, y, x + width, y + height, x, y + height], 0, 4, color, filled);
    }
    triangle(filled, x, y, x2, y2, x3, y3, color = Color.WHITE) {
      this.polygon([x, y, x2, y2, x3, y3], 0, 3, color, filled);
    }
    /** A closed polygon outline from `count` points starting at point `offset`, or a filled fan. */
    polygon(vertices, offset, count, color = Color.WHITE, filled = false) {
      const points = [];
      for (let i = 0; i < count; i++)
        points.push(vertices[(offset + i) * 2], vertices[(offset + i) * 2 + 1]);
      const indices = [];
      if (filled) for (let i = 1; i < count - 1; i++) indices.push(0, i, i + 1);
      else for (let i = 0; i < count; i++) indices.push(i, (i + 1) % count);
      this.shape(filled ? this.gl.TRIANGLES : this.gl.LINES);
      this.colored(points, indices, color);
    }
    /** Bones, attachment outlines, mesh hulls/triangles, bounding boxes, paths and clip polygons. */
    drawSkeletonDebug(skeleton, _premultipliedAlpha = false, ignoredBones) {
      const d = this.skeletonDebugRenderer;
      const world = this.world;
      const s = d.scale;
      const visible = (slot) => slot.bone.active;
      if (d.drawRegionAttachments)
        for (const slot of skeleton.slots) {
          const att = slot.getAttachment();
          if (!(att instanceof RegionAttachment) || !visible(slot)) continue;
          world.length = 8;
          att.computeWorldVertices(slot, world, 0, 2);
          this.polygon(world, 0, 4, d.attachmentLineColor);
        }
      if (d.drawMeshHull || d.drawMeshTriangles)
        for (const slot of skeleton.slots) {
          const att = slot.getAttachment();
          if (!(att instanceof MeshAttachment) || !visible(slot)) continue;
          const n = att.worldVerticesLength;
          world.length = n;
          att.computeWorldVertices(slot, 0, n, world, 0, 2);
          if (d.drawMeshTriangles) {
            const t = att.triangles;
            for (let i = 0; i < t.length; i += 3) {
              const a = t[i] * 2;
              const b = t[i + 1] * 2;
              const c = t[i + 2] * 2;
              this.triangle(
                false,
                world[a],
                world[a + 1],
                world[b],
                world[b + 1],
                world[c],
                world[c + 1],
                d.triangleLineColor
              );
            }
          }
          if (d.drawMeshHull && att.hullLength > 0) {
            const hull = att.hullLength >> 1;
            this.polygon(world, 0, hull, d.attachmentLineColor);
          }
        }
      if (d.drawBoundingBoxes)
        for (const slot of skeleton.slots) {
          const att = slot.getAttachment();
          if (!(att instanceof BoundingBoxAttachment) || !visible(slot)) continue;
          const n = att.worldVerticesLength;
          world.length = n;
          att.computeWorldVertices(slot, 0, n, world, 0, 2);
          this.polygon(world, 0, n >> 1, d.aabbColor);
        }
      if (d.drawPaths)
        for (const slot of skeleton.slots) {
          const att = slot.getAttachment();
          if (!(att instanceof PathAttachment) || !visible(slot)) continue;
          const n = att.worldVerticesLength;
          world.length = n;
          att.computeWorldVertices(slot, 0, n, world, 0, 2);
          for (let i = 2; i + 7 < n + (att.closed ? 2 : 0); i += 6) {
            const x1 = world[i];
            const y1 = world[i + 1];
            const x2 = world[(i + 6) % n];
            const y2 = world[(i + 7) % n];
            this.line(x1, y1, world[(i + 2) % n], world[(i + 3) % n], d.pathColor);
            this.line(x2, y2, world[(i + 4) % n], world[(i + 5) % n], d.pathColor);
            this.line(x1, y1, x2, y2, d.pathColor);
          }
        }
      if (d.drawClipping)
        for (const slot of skeleton.slots) {
          const att = slot.getAttachment();
          if (!(att instanceof ClippingAttachment) || !visible(slot)) continue;
          const n = att.worldVerticesLength;
          world.length = n;
          att.computeWorldVertices(slot, 0, n, world, 0, 2);
          this.polygon(world, 0, n >> 1, d.clipColor);
        }
      if (d.drawBones)
        for (const bone of skeleton.bones) {
          if (!bone.active || (ignoredBones == null ? void 0 : ignoredBones.includes(bone.data.name))) continue;
          const len = bone.data.length;
          const x = len * bone.a + bone.worldX;
          const y = len * bone.c + bone.worldY;
          if (len > 0) this.line(bone.worldX, bone.worldY, x, y, d.boneLineColor);
          this.circle(true, bone.worldX, bone.worldY, 3 * s, d.boneOriginColor, 8);
        }
      if (d.drawSkeletonXY) this.circle(true, skeleton.x, skeleton.y, 4 * s, d.boneOriginColor, 8);
    }
    dispose() {
      const gl = this.gl;
      gl.deleteBuffer(this.vbo);
      gl.deleteBuffer(this.ibo);
      gl.deleteProgram(this.textured.program);
      gl.deleteProgram(this.shapes.program);
    }
    get isDrawing() {
      return this.drawing;
    }
  }
  function pageTexture(region) {
    var _a;
    if (!region) return null;
    const own = region.texture;
    if (own && "bind" in own) return own;
    const page = (_a = region.page) == null ? void 0 : _a.texture;
    return page && "bind" in page ? page : null;
  }
  exports.AlphaTimeline = AlphaTimeline;
  exports.Animation = Animation;
  exports.AnimationState = AnimationState;
  exports.AnimationStateAdapter = AnimationStateAdapter;
  exports.AnimationStateData = AnimationStateData;
  exports.AssetManager = AssetManager;
  exports.AtlasAttachmentLoader = AtlasAttachmentLoader;
  exports.Attachment = Attachment;
  exports.AttachmentTimeline = AttachmentTimeline;
  exports.BlendMode = BlendMode;
  exports.Bone = Bone;
  exports.BoneData = BoneData;
  exports.BoundingBoxAttachment = BoundingBoxAttachment;
  exports.ClippingAttachment = ClippingAttachment;
  exports.Color = Color;
  exports.ConstraintData = ConstraintData;
  exports.CurveTimeline = CurveTimeline;
  exports.CurveTimeline1 = CurveTimeline1;
  exports.CurveTimeline2 = CurveTimeline2;
  exports.DEG_RAD = DEG_RAD;
  exports.DeformTimeline = DeformTimeline;
  exports.DrawOrderTimeline = DrawOrderTimeline;
  exports.Event = Event;
  exports.EventData = EventData;
  exports.EventTimeline = EventTimeline;
  exports.EventType = EventType;
  exports.GLTexture = GLTexture;
  exports.IkConstraint = IkConstraint;
  exports.IkConstraintData = IkConstraintData;
  exports.IkConstraintTimeline = IkConstraintTimeline;
  exports.Inherit = Inherit;
  exports.InheritTimeline = InheritTimeline;
  exports.ManagedWebGLRenderingContext = ManagedWebGLRenderingContext;
  exports.MathUtils = MathUtils;
  exports.MeshAttachment = MeshAttachment;
  exports.MixBlend = MixBlend;
  exports.MixDirection = MixDirection;
  exports.OrthoCamera = OrthoCamera;
  exports.PI = PI;
  exports.PI2 = PI2;
  exports.PathAttachment = PathAttachment;
  exports.PathConstraint = PathConstraint;
  exports.PathConstraintData = PathConstraintData;
  exports.PathConstraintMixTimeline = PathConstraintMixTimeline;
  exports.PathConstraintPositionTimeline = PathConstraintPositionTimeline;
  exports.PathConstraintSpacingTimeline = PathConstraintSpacingTimeline;
  exports.Physics = Physics;
  exports.PhysicsConstraint = PhysicsConstraint;
  exports.PhysicsConstraintDampingTimeline = PhysicsConstraintDampingTimeline;
  exports.PhysicsConstraintData = PhysicsConstraintData;
  exports.PhysicsConstraintGravityTimeline = PhysicsConstraintGravityTimeline;
  exports.PhysicsConstraintInertiaTimeline = PhysicsConstraintInertiaTimeline;
  exports.PhysicsConstraintMassTimeline = PhysicsConstraintMassTimeline;
  exports.PhysicsConstraintMixTimeline = PhysicsConstraintMixTimeline;
  exports.PhysicsConstraintResetTimeline = PhysicsConstraintResetTimeline;
  exports.PhysicsConstraintStrengthTimeline = PhysicsConstraintStrengthTimeline;
  exports.PhysicsConstraintTimeline = PhysicsConstraintTimeline;
  exports.PhysicsConstraintWindTimeline = PhysicsConstraintWindTimeline;
  exports.PointAttachment = PointAttachment;
  exports.PositionMode = PositionMode;
  exports.Property = Property;
  exports.RAD_DEG = RAD_DEG;
  exports.RGB2Timeline = RGB2Timeline;
  exports.RGBA2Timeline = RGBA2Timeline;
  exports.RGBATimeline = RGBATimeline;
  exports.RGBTimeline = RGBTimeline;
  exports.RegionAttachment = RegionAttachment;
  exports.RotateMode = RotateMode;
  exports.RotateTimeline = RotateTimeline;
  exports.ScaleTimeline = ScaleTimeline;
  exports.ScaleXTimeline = ScaleXTimeline;
  exports.ScaleYTimeline = ScaleYTimeline;
  exports.SceneRenderer = SceneRenderer;
  exports.Sequence = Sequence;
  exports.SequenceMode = SequenceMode;
  exports.SequenceModeValues = SequenceModeValues;
  exports.SequenceTimeline = SequenceTimeline;
  exports.ShearTimeline = ShearTimeline;
  exports.ShearXTimeline = ShearXTimeline;
  exports.ShearYTimeline = ShearYTimeline;
  exports.Skeleton = Skeleton;
  exports.SkeletonBinary = SkeletonBinary;
  exports.SkeletonClipping = SkeletonClipping;
  exports.SkeletonData = SkeletonData;
  exports.SkeletonDebugRenderer = SkeletonDebugRenderer;
  exports.SkeletonJson = SkeletonJson;
  exports.Skin = Skin;
  exports.SkinEntry = SkinEntry;
  exports.Slot = Slot;
  exports.SlotData = SlotData;
  exports.SpacingMode = SpacingMode;
  exports.TextureAtlas = TextureAtlas;
  exports.TextureAtlasPage = TextureAtlasPage;
  exports.TextureAtlasRegion = TextureAtlasRegion;
  exports.TextureAtlasRegionBase = TextureAtlasRegionBase;
  exports.TextureFilter = TextureFilter;
  exports.TextureRegion = TextureRegion;
  exports.TextureWrap = TextureWrap;
  exports.Timeline = Timeline;
  exports.TrackEntry = TrackEntry;
  exports.TransformConstraint = TransformConstraint;
  exports.TransformConstraintData = TransformConstraintData;
  exports.TransformConstraintTimeline = TransformConstraintTimeline;
  exports.TranslateTimeline = TranslateTimeline;
  exports.TranslateXTimeline = TranslateXTimeline;
  exports.TranslateYTimeline = TranslateYTimeline;
  exports.Vector2 = Vector2;
  exports.Vector3 = Vector3;
  exports.VertexAttachment = VertexAttachment;
  exports.decompose = decompose;
  exports.enumFromName = enumFromName;
  exports.managed = managed;
  exports.setArraySize = setArraySize;
  exports.signum = signum;
  exports.triangulate = triangulate;
  exports.wrapRadians = wrapRadians;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
