import bpy
op = bpy.context.active_operator

op.export_format = 'GLB'
op.export_yup = True
op.export_apply = True
op.export_extras = True
op.export_texcoords = True
op.export_normals = True
op.export_tangents = False
op.export_cameras = True
op.export_lights = False
op.export_draco_mesh_compression_enable = False
op.export_meshopt_compression_enable = False
op.export_use_gltfpack = False
op.use_selection = True
op.export_materials = 'NONE'
op.export_skins = False
op.export_animations = True
op.export_animation_mode = 'NLA_TRACKS'
op.export_force_sampling = True
op.export_frame_step = 1
op.export_anim_slide_to_zero = True
op.export_optimize_animation_size = False
op.export_bake_animation = False
op.export_morph = False
