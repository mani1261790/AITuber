"""Refine bound half-up strands on hosted v8 while preserving its face and clothes."""
from pathlib import Path
import bpy,sys,os,math,json,struct,copy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
R=Path(__file__).resolve().parents[2];D=R/'assets/character/teacher-reference/remake'
sys.path.insert(0,str(R/'.cache/model-tools/addons'));bpy.ops.preferences.addon_enable(module='io_scene_vrm')
os.environ['BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION']='true'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.vrm(filepath=str(R/'apps/classroom/public/models/teacher-floral-v8.vrm'))

for o in list(bpy.context.scene.objects):
 if o.name=='Cube':bpy.data.objects.remove(o,do_unlink=True)
bpy.context.view_layer.update();rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
hair=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.name=='Hair')
# Remove the old bow before rebuilding against the actual tied hair surface.
for o in list(bpy.context.scene.objects):
 if 'Ivory half-up ribbon' in o.name or o.name=='Bound half-up hair':bpy.data.objects.remove(o,do_unlink=True)
# The bound upper hair must follow the head with its overlay. Keep spring
# motion in the free lengths, blending the attachment across the upper roots.
head_group=hair.vertex_groups.get('J_Bip_C_Head') or hair.vertex_groups.new(name='J_Bip_C_Head')
for v in hair.data.vertices:
 p=hair.matrix_world@v.co
 if p.y<0: continue
 pin=max(0,min(1,(p.z-1.29)/.045))*max(0,min(1,p.y/.025))
 pin=pin*pin*(3-2*pin)
 if pin<=0:continue
 old_head=next((g.weight for g in v.groups if g.group==head_group.index),0)
 for g in list(v.groups):
  if g.group!=head_group.index:hair.vertex_groups[g.group].add([v.index],g.weight*(1-pin),'REPLACE')
 head_group.add([v.index],old_head*(1-pin)+pin,'REPLACE')
# Sweep a fan of locks over the actual scalp surface, rather than a fixed ellipse.
# Starting outside and raycasting inward finds the visible layer of the donor hair.
world=[hair.matrix_world@v.co for v in hair.data.vertices]
cap=BVHTree.FromPolygons(world,[list(p.vertices) for p in hair.data.polygons])
verts=[];faces=[];uvs=[]
for side in [-1,1]:
 for lock in range(11):
  start=len(verts);steps=72;slices=6
  centers=[];normals=[]
  for i in range(steps+1):
   t=i/steps;start_angle=-.36+lock*.022
   theta=start_angle+(math.pi/2-start_angle)*t
   z=(1.366-lock*.0030)*(1-t)+1.305*t+.005*math.sin(math.pi*t)
   radial=Vector((side*math.cos(theta),math.sin(theta),0))
   origin=Vector((0,.012,z))+radial*.25
   hit,normal,_,_=cap.ray_cast(origin,-radial,.3)
   center=(hit+radial*.005) if hit is not None else Vector((side*.09*math.cos(theta),.012+.12*math.sin(theta),z))
   # Taper into the root and into the knot, without exposed cut ends.
   envelope=1/math.sqrt((math.cos(theta)/.099)**2+(math.sin(theta)/.134)**2)
   radius=(center-Vector((0,.012,z))).dot(radial)
   center+=radial*max(0,envelope-radius)
   center-=radial*.040*(1-min(1,t/.60))**2
   centers.append(center);normals.append(radial)
  for i in range(steps+1):
   t=i/steps;lo=max(0,i-3);hi=min(steps,i+3)
   center=sum(centers[lo:hi+1],Vector())/(hi-lo+1)
   width=.0017*(1-.72*t)*min(1,t/.25)**2
   for j in range(slices+1):
    v=j/slices;a=(v-.5)*2
    p=center+Vector((0,0,a*width))+normals[i]*(.0008*(1-a*a))
    verts.append(tuple(p));uvs.append((.28+lock*.014+v*.014,.55+t*.06))
  for i in range(steps):
   for j in range(slices):
    a=start+i*(slices+1)+j;faces.append((a,a+slices+1,a+slices+2,a+1))
mesh=bpy.data.meshes.new('Combed half-up panels');mesh.from_pydata(verts,[],faces);mesh.update()
locks=bpy.data.objects.new('Bound half-up hair',mesh);bpy.context.collection.objects.link(locks)
for f in mesh.polygons:f.use_smooth=True
mesh.materials.append(hair.data.materials[0]);uv=mesh.uv_layers.new(name='Combed strand UV')
for poly in mesh.polygons:
 for li in poly.loop_indices:uv.data[li].uv=uvs[mesh.loops[li].vertex_index]
vg=locks.vertex_groups.new(name='J_Bip_C_Head');vg.add(list(range(len(verts))),1,'REPLACE');locks.parent=rig
mod=locks.modifiers.new('Bound to head','ARMATURE');mod.object=rig
print('Scalp-conforming swept locks:',len(verts))
# Sculpted ribbon surfaces: curved folded loops, pinched knot and two fabric tails.
verts=[];faces=[]
def surface(fn,nu,nv):
 start=len(verts)
 for i in range(nu+1):
  for j in range(nv+1):verts.append(fn(i/nu,j/nv))
 for i in range(nu):
  for j in range(nv):
   a=start+i*(nv+1)+j;faces.append((a,a+nv+1,a+nv+2,a+1))
cy=.134;cz=1.305
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
bpy.ops.wm.save_as_mainfile(filepath=str(D/'teacher-floral-v9.blend'))
assert bpy.ops.export_scene.vrm(filepath=str(D/'teacher-floral-v9.vrm'),export_only_selections=False,export_invisibles=True,armature_object_name=rig.name)=={'FINISHED'}
p=D/'teacher-floral-v9.vrm';b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);tail=b[20+n:]
props=g['extensions']['VRM']['materialProperties']
for group in g['extensions']['VRM']['secondaryAnimation']['boneGroups']:
 if group.get('comment')=='Hair':
  names=[g['nodes'][n]['name'] for n in group.get('bones',[])]
  long=any(any(name.endswith('_'+n) for n in ['09','11','12','13']) for name in names)
  group.update(stiffiness=.55 if long else .8,dragForce=.48 if long else .58,gravityPower=.12 if long else .07,gravityDir={'x':0,'y':-1,'z':0})
for i,m in enumerate(g['materials']):
 if m['name'].startswith('Ivory ribbon fabric'):
  prop=copy.deepcopy(next(p for p in props if p['shader']=='VRM/MToon'));prop['name']=m['name'];prop['textureProperties']={};prop['vectorProperties']['_Color']=[.94,.86,.74,1];prop['vectorProperties']['_ShadeColor']=[.71,.64,.56,1];prop['floatProperties'].update(_BlendMode=0,_CullMode=0,_OutlineWidth=.08);props[i]=prop
 if 'Accessory_Tie' in m['name']:
  props[i]['vectorProperties']['_Color']=[.25,.25,.28,1];props[i]['vectorProperties']['_ShadeColor']=[.18,.18,.20,1]
j=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();j+=b' '*(-len(j)%4);p.write_bytes(struct.pack('<III',0x46546c67,2,20+len(j)+len(tail))+struct.pack('<II',len(j),0x4e4f534a)+j+tail)
print('Saved v9 hair candidate')
