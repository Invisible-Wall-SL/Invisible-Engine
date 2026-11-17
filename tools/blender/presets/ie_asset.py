import bpy
op = bpy.context.active_operator

op.export_format = 'GLB'
op.export_yup = True
op.export_apply = True
op.export_extras = True
op.export_texcoords = True
op.export_normals = True
op.export_tangents = False
op.export_cameras = False
op.export_lights = False
op.export_draco_mesh_compression_enable = False
op.export_meshopt_compression_enable = False
op.export_use_gltfpack = False
op.use_selection = True
op.export_materials = 'EXPORT'
op.export_image_format = 'AUTO'
op.export_skins = True
op.export_influence_nb = 4
op.export_all_influences = False
op.export_animations = False
op.export_morph = True
