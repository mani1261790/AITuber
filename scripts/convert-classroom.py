"""Blender 4.5: convert the CC0 Christophe Seux classroom to a web filming set.
Run: blender -b .data/environment-source/classroom/classroom.blend --python scripts/convert-classroom.py
"""
import bpy
from mathutils import Matrix, Vector
from pathlib import Path

root = Path.cwd()
source = root / '.data/environment-source/classroom'
output = root / 'apps/classroom/public/models/environment/classroom-realistic.glb'
bpy.context.window.scene = bpy.data.scenes['_mainScene']
original_scene = bpy.context.scene
original_scene.view_layers[0].update()
depsgraph = bpy.context.evaluated_depsgraph_get()
# Align the front wall, floor and teacher lanes with the existing lecture stage.
transform = Matrix(((1.65,0,0,-1.84),(0,1.65,0,-4.729),(0,0,1.5,-.54),(0,0,0,1)))
material_cache = {}

def web_material(original):
    if original is None:
        return None
    key = original.name_full
    if key in material_cache:
        return material_cache[key]
    material = bpy.data.materials.new('web_' + original.name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .72
    shader.inputs['Base Color'].default_value = (.64,.60,.51,1)
    name = original.name.lower()
    if any(s in name for s in ['white','plaster','beige','paint']):
        shader.inputs['Base Color'].default_value = (.72,.70,.64,1)
    if any(s in name for s in ['metal','chrome','steel']):
        shader.inputs['Metallic'].default_value = .65
        shader.inputs['Roughness'].default_value = .32
    if 'glass' in name:
        shader.inputs['Base Color'].default_value = (.70,.85,.95,1)
        shader.inputs['Roughness'].default_value = .22
    images = [n.image for n in original.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image] if original.node_tree else []
    usable = [i for i in images if not any(x in i.name.lower() for x in ['_ao','bump','normal'])]
    if usable:
        image = usable[0].copy()
        candidates = list(source.rglob(Path(image.filepath.replace('\\','/')).name))
        if candidates:
            image.filepath = str(candidates[0]); image.reload()
            if max(image.size) > 1024:
                factor=1024/max(image.size); image.scale(max(1,int(image.size[0]*factor)),max(1,int(image.size[1]*factor)))
            image.pack()
            node = material.node_tree.nodes.new('ShaderNodeTexImage'); node.image = image
            material.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
    material_cache[key] = material
    return material

converted=[]
for instance in depsgraph.object_instances:
    obj=instance.object
    if obj.type!='MESH' or obj.hide_render:
        continue
    name=obj.name.lower()
    # The dynamic teaching surface replaces the source's written board.
    if any(s in name for s in ['blackboard','boardframe','lettersplank','whitechalk','dust','volume']):
        continue
    bounds=[instance.matrix_world @ Vector(c) for c in obj.bound_box]
    center=sum(bounds,Vector())/8
    # No front-row furniture in the presenter's walking area; retain room architecture.
    if instance.is_instance and center.y > -.4 and center.z < 2.4:
        continue
    if any(s in name for s in ['coat ','drawing','thumbtack','post-it','whitepages','paperclip']):
        continue
    mesh=bpy.data.meshes.new_from_object(obj, depsgraph=depsgraph)
    if not mesh.polygons:
        bpy.data.meshes.remove(mesh); continue
    new=bpy.data.objects.new(obj.name,mesh)
    new.matrix_world=transform @ instance.matrix_world
    replacements=[web_material(m) for m in obj.data.materials]
    mesh.materials.clear()
    for material in replacements:
        if material: mesh.materials.append(material)
    converted.append(new)

scene=bpy.data.scenes.new('AITuber_Classroom')
bpy.context.window.scene=scene
for obj in converted:
    scene.collection.objects.link(obj)
    obj.select_set(True)
bpy.context.view_layer.objects.active=converted[0]
bpy.ops.object.join()
# Bake modifiers into geometry above; glTF keeps the PBR image textures embedded.
bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,use_active_scene=True,export_skins=False,export_cameras=False,export_lights=False,export_animations=False,export_image_format='JPEG',export_jpeg_quality=85)
print('EXPORTED',output,'meshes',len(converted),'bytes',output.stat().st_size)
