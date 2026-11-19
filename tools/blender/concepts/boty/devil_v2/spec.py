"""Devil v2: the numbers. Proportions measured off the owner's turnaround
(docs/design/3d/boty/devil-v2/refs/turnaround-8-views.webp), in metres, feet on z = 0, facing -Y,
the character's left on +X. One place for the joints, so the cage and the rig agree.
"""

from __future__ import annotations

N = 24  # columns round the trunk and the head

# Column angles (degrees from the front, toward +X) for columns 0..12; 13..23 mirror them.
UNIFORM = [15.0 * k for k in range(13)]
FACE = [0.0, 10.0, 15.0, 27.0, 40.0, 60.0, 90.0, 105.0, 120.0, 135.0, 150.0, 165.0, 180.0]

# Trunk rings, bottom to top. zf / zs / zb: height at the front, the sides and the back;
# a: half width; bf / bb: depth to the front and to the back of yc; t: 0 uniform columns, 1 face columns.
TRUNK = [
	# name      zf     zs     zb     a      bf     bb     yc      t
	('hip',      0.360, 0.362, 0.368, 0.094, 0.086, 0.050, 0.005, 0.0),
	('rump0',    0.388, 0.390, 0.394, 0.117, 0.126, 0.058, -0.008, 0.0),
	('rump1',    0.420, 0.421, 0.424, 0.127, 0.154, 0.060, -0.020, 0.0),
	('sacrum',   0.452, 0.452, 0.455, 0.134, 0.172, 0.062, -0.030, 0.0),
	('belly1',   0.492, 0.492, 0.494, 0.138, 0.180, 0.066, -0.034, 0.0),
	('belly2',   0.537, 0.535, 0.535, 0.131, 0.168, 0.068, -0.030, 0.0),
	('belly3',  0.584, 0.580, 0.580, 0.106, 0.130, 0.068, -0.018, 0.0),
	('chest',   0.636, 0.634, 0.636, 0.090, 0.094, 0.064, -0.006, 0.0),
	('arm0',    0.662, 0.660, 0.662, 0.094, 0.091, 0.063, -0.003, 0.0),
	('arm1',    0.688, 0.687, 0.689, 0.095, 0.084, 0.061, 0.000, 0.0),
	('shoulder', 0.712, 0.716, 0.716, 0.090, 0.068, 0.058, 0.000, 0.0),
	('neck0',   0.733, 0.738, 0.742, 0.040, 0.043, 0.039, -0.006, 0.0),
	('neck1',   0.756, 0.759, 0.764, 0.030, 0.032, 0.031, -0.013, 0.15),
	('throat',   0.760, 0.784, 0.792, 0.044, 0.120, 0.050, -0.045, 0.6),
	('jaw',      0.738, 0.802, 0.814, 0.058, 0.182, 0.086, -0.050, 1.0),
	('chin',    0.766, 0.832, 0.828, 0.074, 0.190, 0.100, -0.049, 1.0),
	('lip_lo',   0.802, 0.862, 0.842, 0.092, 0.174, 0.116, -0.047, 1.0),
	('lip_up',   0.812, 0.867, 0.866, 0.102, 0.170, 0.130, -0.042, 1.0),
	('muzzle',   0.845, 0.886, 0.888, 0.116, 0.138, 0.140, -0.030, 1.0),
	('eye_lo',  0.878, 0.898, 0.908, 0.121, 0.128, 0.143, -0.027, 1.0),
	('eye',     0.900, 0.915, 0.928, 0.123, 0.127, 0.146, -0.026, 1.0),
	('eye_up',  0.924, 0.935, 0.948, 0.120, 0.132, 0.143, -0.026, 1.0),
	('brow',     0.950, 0.954, 0.964, 0.110, 0.128, 0.130, -0.022, 0.85),
	('crown0',   0.974, 0.975, 0.979, 0.088, 0.100, 0.105, -0.016, 0.55),
	('crown1',   0.990, 0.990, 0.992, 0.056, 0.060, 0.068, -0.010, 0.25),
]
RING = {row[0]: i for i, row in enumerate(TRUNK)}
# How fast a ring's height goes from its side value to its front value (the grin curls up late).
Z_POWER = {'lip_lo': 2.2, 'lip_up': 2.2, 'muzzle': 2.2, 'jaw': 2.5, 'chin': 2.4}
# Front-half outline: 2 is an ellipse, lower is more pointed (the muzzle narrows to the lips).
SHAPE = {'lip_lo': 1.5, 'lip_up': 1.5, 'jaw': 1.45, 'chin': 1.35, 'muzzle': 1.75, 'throat': 1.6}

# The buttocks: a sphere each side that the back of the pelvis is pushed out onto.
BUTTOCK = (0.054, 0.044, 0.436)
BUTTOCK_RADIUS = 0.072
# The potbelly: the front of the trunk is pushed out onto this ball.
BELLY = (0.0, -0.082, 0.488)
BELLY_RADIUS = 0.136

# Joints (bone heads). The rig builds the skeleton from these; the cage tags vertices against them.
J = {
	'pelvis': (0.0, 0.020, 0.400),
	'spine_01': (0.0, 0.020, 0.470),
	'spine_02': (0.0, 0.016, 0.550),
	'spine_03': (0.0, 0.010, 0.630),
	'neck_01': (0.0, 0.000, 0.725),
	'head': (0.0, -0.010, 0.785),
	'head_end': (0.0, -0.010, 0.985),
	'jaw': (0.0, -0.030, 0.852),
	'jaw_end': (0.0, -0.215, 0.765),
	'ear': (0.110, 0.030, 0.925),
	'ear_end': (0.178, 0.105, 1.125),
	'eye': (0.064, -0.117, 0.901),
	'clavicle': (0.020, 0.000, 0.700),
	'upperarm': (0.100, 0.000, 0.684),
	'lowerarm': (0.276, 0.008, 0.677),
	'hand': (0.458, 0.000, 0.674),
	'hand_end': (0.562, -0.002, 0.662),
	'thigh': (0.060, 0.004, 0.352),
	'calf': (0.063, -0.020, 0.246),
	'foot': (0.063, 0.016, 0.090),
	'ball': (0.075, -0.118, 0.022),
	'ball_end': (0.088, -0.235, 0.018),
	'wing_01': (0.048, 0.062, 0.672),
	'wing_02': (0.150, 0.120, 0.815),
	'wing_wrist': (0.250, 0.176, 0.940),
}

# The tail: a spline from the tailbone, down behind the legs, out to +X and up into a hook.
TAIL = [
	(0.000, 0.060, 0.497),
	(0.030, 0.125, 0.430),
	(0.075, 0.172, 0.320),
	(0.125, 0.196, 0.232),
	(0.172, 0.200, 0.258),
	(0.194, 0.192, 0.345),
	(0.216, 0.186, 0.422),
	(0.254, 0.190, 0.452),
	(0.282, 0.204, 0.412),
	(0.287, 0.214, 0.340),
]
TAIL_ARROW = (0.02, 0.03, -1.0)  # the arrow-head's direction, from the spline's end
TAIL_ARROW_LENGTH = 0.125
TAIL_BONES = 5

# The nose: its centre line from the face to the tip.
NOSE = [(0.0, -0.170, 0.864), (0.0, -0.235, 0.826), (0.0, -0.300, 0.770), (0.0, -0.345, 0.715), (0.0, -0.368, 0.682)]

# Wing finger tips (left wing); the membrane hangs between them and ends on the body at WING_BODY.
WING_TIPS = [(0.560, 0.405, 0.455), (0.365, 0.275, 0.515), (0.222, 0.180, 0.560)]
WING_BODY = (0.092, 0.062, 0.585)
