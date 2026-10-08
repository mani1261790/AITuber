"""Gather upper hair, attach bow, and tune free-hair dynamics on the v6 model."""
from pathlib import Path
import bpy,sys,os,math,json,struct,copy
from mathutils import Vector
R=Path(__file__).resolve().parents[2];D=R/'assets/character/teacher-reference/remake'
sys.path.insert(0,str(R/'.cache/model-tools/addons'));bpy.ops.preferences.addon_enable(module='io_scene_vrm')
os.environ['BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION']='true'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.vrm(filepath=str(R/'apps/classroom/public/models/teacher-floral-v6.vrm'))

for o in list(bpy.context.scene.objects):
 if o.name=='Cube':bpy.data.objects.remove(o,do_unlink=True)
bpy.context.view_layer.update();rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
hair=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.name=='Hair')
# Remove the old bow before rebuilding against the actual tied hair surface.
for o in list(bpy.context.scene.objects):
 if 'Ivory half-up ribbon' in o.name:bpy.data.objects.remove(o,do_unlink=True)
# Upper back locks narrow toward a real central gathering point. The free lengths
# keep their existing spring weights; the bound cap and added swept locks follow head.
inv=hair.matrix_world.inverted()
for v in hair.data.vertices:
 p=hair.matrix_world@v.co
 if p.y>.065 and 1.265<p.z<1.365:
  w=math.sin(math.pi*(p.z-1.265)/.1)**2
  p.x*=1-.3*w
  v.co=inv@p
# Layered tapered locks sweep from both temples to the knot, with longitudinal
# ridges instead of a smooth plastic tube. These are bound hair, not loose springs.
verts=[];faces=[]
for side in [-1,1]:
 for lock in range(5):
  start=len(verts);steps=40;sides=12
  for i in range(steps+1):
   t=i/steps;a=t*math.pi/2
   center=Vector((side*(.070*math.cos(a)+.004),.012+.127*math.sin(a),1.342-.032*t+lock*.002))
   radius=(.0055+lock*.0003)*(1-.45*t)*min(1,t/.18+.02)
   for j in range(sides):
    q=j/sides*math.pi*2
    tangent=Vector((-side*.070*math.sin(a),.127*math.cos(a),-.032)).normalized()
    lateral=tangent.cross(Vector((0,0,1))).normalized()
    vertical=lateral.cross(tangent).normalized()
    center_offset=lateral*(math.cos(q)*radius*.45)+vertical*(math.sin(q)*radius)
    center_offset.z+=(lock-2)*.007*(1-t)*min(1,t/.2)
    verts.append(tuple(center+center_offset))
  for i in range(steps):
   for j in range(sides):
    k=start+i*sides+j;kn=start+i*sides+(j+1)%sides
    faces.append((k,kn,kn+sides,k+sides))
mesh=bpy.data.meshes.new('Swept half-up locks');mesh.from_pydata(verts,[],faces);mesh.update()
locks=bpy.data.objects.new('Bound half-up hair',mesh);bpy.context.collection.objects.link(locks)
for f in mesh.polygons:f.use_smooth=True
mat=hair.data.materials[0];mesh.materials.append(mat)
uv=mesh.uv_layers.new(name='Hair strand UV')
for poly in mesh.polygons:
 for li in poly.loop_indices:
  vi=mesh.loops[li].vertex_index;local=vi%((steps+1)*sides)
  uv.data[li].uv=((local%sides)/sides*.25+.35,1-(local//sides)/steps)
vg=locks.vertex_groups.new(name='J_Bip_C_Head');vg.add(list(range(len(verts))),1,'REPLACE');locks.parent=rig
mod=locks.modifiers.new('Bound to head','ARMATURE');mod.object=rig
# Sculpted ribbon surfaces: curved folded loops, pinched knot and two fabric tails.
verts=[];faces=[]
def surface(fn,nu,nv):
 start=len(verts)
 for i in range(nu+1):
  for j in range(nv+1):verts.append(fn(i/nu,j/nv))
 for i in range(nu):
  for j in range(nv):
   a=start+i*(nv+1)+j;faces.append((a,a+nv+1,a+nv+2,a+1))
cy=.143;cz=1.310
for side in [-1,1]:
 def loop(u,v,side=side):
  x=side*(.007+.055*u);width=.008+.025*math.sin(math.pi*u*.85)
  return (x,cy+.012*math.sin(math.pi*u)+.011*math.cos((v-.5)*math.pi*2)*math.sin(math.pi*u),cz+.018*u+(v-.5)*2*width)
 surface(loop,20,10)
 def tail(u,v,side=side):
  x=side*(.012+.020*u)+(v-.5)*(.021+.009*u)
  z=cz-.009-.112*u+.008*abs(v-.5)*2*u**8
  y=cy+.004+.030*u+.003*math.sin(v*math.pi*3)*u
  return (x,y,z)
 surface(tail,24,10)
def knot(u,v):
 a=v*math.pi*2
 return ((u-.5)*.022,cy+.003+.010*math.cos(a),cz+.014*math.sin(a))
surface(knot,8,20)
mesh=bpy.data.meshes.new('Folded ivory ribbon');mesh.from_pydata(verts,[],faces);mesh.update();bow=bpy.data.objects.new('Ivory half-up ribbon',mesh);bpy.context.collection.objects.link(bow)
for p in mesh.polygons:p.use_smooth=True
mat=bpy.data.materials.new('Ivory ribbon fabric');mat.diffuse_color=(.94,.86,.74,1);mat.use_nodes=True;mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=mat.diffuse_color;mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.85;mesh.materials.append(mat)
group=bow.vertex_groups.new(name='J_Bip_C_Head');group.add(list(range(len(verts))),1,'REPLACE');bow.parent=rig;mod=bow.modifiers.new('Head attachment','ARMATURE');mod.object=rig
# Give fabric actual thickness without changing the skin weights.
bpy.context.view_layer.objects.active=bow;bow.select_set(True)
solid=bow.modifiers.new('Fabric thickness','SOLIDIFY');solid.thickness=.0012;bpy.ops.object.modifier_apply(modifier=solid.name)
for o in bpy.context.scene.objects:o.hide_set(False)
bpy.context.view_layer.update();bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(D/'teacher-floral-v7.blend'))
assert bpy.ops.export_scene.vrm(filepath=str(D/'teacher-floral-v7.vrm'),export_only_selections=False,export_invisibles=True,armature_object_name=rig.name)=={'FINISHED'}
p=D/'teacher-floral-v7.vrm';b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);tail=b[20+n:]
props=g['extensions']['VRM']['materialProperties']
for group in g['extensions']['VRM']['secondaryAnimation']['boneGroups']:
 if group.get('comment')=='Hair':
  names=[g['nodes'][n]['name'] for n in group.get('bones',[])]
  long=any(any(name.endswith('_'+n) for n in ['09','11','12','13']) for name in names)
  group.update(stiffiness=.55 if long else .8,dragForce=.48 if long else .58,gravityPower=.12 if long else .07,gravityDir={'x':0,'y':-1,'z':0})
for i,m in enumerate(g['materials']):
 if m['name']=='Ivory ribbon fabric':
  prop=copy.deepcopy(next(p for p in props if p['shader']=='VRM/MToon'));prop['name']=m['name'];prop['textureProperties']={};prop['vectorProperties']['_Color']=[.94,.86,.74,1];prop['vectorProperties']['_ShadeColor']=[.71,.64,.56,1];prop['floatProperties'].update(_BlendMode=0,_CullMode=0,_OutlineWidth=.08);props[i]=prop
 if 'Accessory_Tie' in m['name']:
  props[i]['vectorProperties']['_Color']=[.25,.25,.28,1];props[i]['vectorProperties']['_ShadeColor']=[.18,.18,.20,1]
j=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();j+=b' '*(-len(j)%4);p.write_bytes(struct.pack('<III',0x46546c67,2,20+len(j)+len(tail))+struct.pack('<II',len(j),0x4e4f534a)+j+tail)
print('Saved v7 gathered hair/ribbon candidate')
