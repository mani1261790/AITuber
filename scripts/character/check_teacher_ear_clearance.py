from pathlib import Path
import bpy,sys,os,json
from mathutils.bvhtree import BVHTree
R=Path(__file__).resolve().parents[2];sys.path.insert(0,str(R/'.cache/model-tools/addons'));bpy.ops.preferences.addon_enable(module='io_scene_vrm');os.environ['BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION']='true'
version=sys.argv[-1]
bpy.ops.import_scene.vrm(filepath=str(R/f'apps/classroom/public/models/teacher-floral-{version}.vrm'));bpy.context.view_layer.update()
f=bpy.data.objects['Face'];vs=[f.matrix_world@v.co for v in f.data.vertices]
polys=[]
for p in f.data.polygons:
 c=sum((vs[i] for i in p.vertices),vs[0]*0)/len(p.vertices)
 if abs(c.x)>.071 and .003<c.y<.05 and 1.258<c.z<1.318:polys.append(list(p.vertices))
ears=BVHTree.FromPolygons(vs,polys)
result={}
for name in ['Hair','Bound half-up hair']:
 o=bpy.data.objects.get(name)
 if not o:continue
 h=BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[list(p.vertices) for p in o.data.polygons]);result[name]=len(ears.overlap(h))
print('EAR_INTERSECTIONS',version,len(polys),json.dumps(result))
