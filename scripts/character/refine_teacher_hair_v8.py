"""Gather upper hair, attach bow, and tune free-hair dynamics on the v7 model."""
from pathlib import Path
import bpy,sys,os,math,json,struct,copy
from mathutils import Vector
R=Path(__file__).resolve().parents[2];D=R/'assets/character/teacher-reference/remake'
sys.path.insert(0,str(R/'.cache/model-tools/addons'));bpy.ops.preferences.addon_enable(module='io_scene_vrm')
os.environ['BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION']='true'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.vrm(filepath=str(R/'apps/classroom/public/models/teacher-floral-v7.vrm'))

for o in list(bpy.context.scene.objects):
 if o.name=='Cube':bpy.data.objects.remove(o,do_unlink=True)
bpy.context.view_layer.update();rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
hair=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.name=='Hair')
# Remove the old bow before rebuilding against the actual tied hair surface.
for o in list(bpy.context.scene.objects):
 if 'Ivory half-up ribbon' in o.name or o.name=='Bound half-up hair':bpy.data.objects.remove(o,do_unlink=True)
# Clearance around the visible ear helix. Classify whole hair islands so the
# front/back split never tears connected strands across the centre of an ear.
inv=hair.matrix_world.inverted()
parent=list(range(len(hair.data.vertices)))
def root(i):
 while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
 return i
for e in hair.data.edges:
 a,b=map(root,e.vertices);parent[b]=a
islands={}
for v in hair.data.vertices:islands.setdefault(root(v.index),[]).append(v)
cleared=0
for vs in islands.values():
 near=[hair.matrix_world@v.co for v in vs if 1.25<(hair.matrix_world@v.co).z<1.325 and abs((hair.matrix_world@v.co).x)>.055]
 back=bool(near) and sum(p.y for p in near)/len(near)>.015
 for v in vs:
  p=hair.matrix_world@v.co
  if abs(p.x)>.055 and 1.253<p.z<1.313:
   h=(p.z-1.283)/.030
   boundary=.028*math.sqrt(max(0,1-h*h))
   if abs(p.y-.025)<boundary:
    w=min(1,max(0,(abs(p.x)-.055)/.010));w=w*w*(3-2*w)
    p.y=p.y*(1-w)+(.025+(1 if back else -1)*boundary)*w
    v.co=inv@p;cleared+=1
# Gather the inner back locks into the tie; outer back locks remain loose.
def gather(p):
 p=p.copy();t=max(0,min(1,(p.z-1.18)/.135));w=t*t*(3-2*t)
 upper=max(0,min(1,(1.38-p.z)/.065));upper=upper*upper*(3-2*upper)
 rear=max(0,min(1,(p.y-.035)/.060));rear=rear*rear*(3-2*rear)
 w*=upper*rear
 p.x*=1-.76*w;p.y=p.y*(1-w)+.137*w
 return p
for v in hair.data.vertices:
 weight=sum(w.weight for w in v.groups if hair.vertex_groups[w.group].name.endswith(('_11','_13')))
 if weight>.01:
  p=hair.matrix_world@v.co;v.co=inv@(p.lerp(gather(p),weight))
# Move the corresponding rest chain as well, avoiding a mesh-only skin mismatch.
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for bone in rig.data.edit_bones:
 if bone.name.startswith('J_Sec_Hair') and bone.name.endswith(('_11','_13')):
  bone.head=rig.matrix_world.inverted()@gather(rig.matrix_world@bone.head)
  bone.tail=rig.matrix_world.inverted()@gather(rig.matrix_world@bone.tail)
bpy.ops.object.mode_set(mode='OBJECT')
# Broad, overlapping hair ribbons hug the skull and converge behind the ears.
# Each panel has a rounded cross-section and root/tip taper, not stacked tubes.
verts=[];faces=[];uvs=[]
for side in [-1,1]:
 for lock in range(11):
  start=len(verts);steps=48;slices=10
  for i in range(steps+1):
   t=i/steps;start_angle=.02+(lock%3)*.045
   theta=start_angle+(1.53-start_angle)*t
   z=1.342+(lock-5)*.0035*(1-t)-.037*t+.011*math.sin(math.pi*t)
   center=Vector((side*.090*math.cos(theta),.012+.120*math.sin(theta),z))
   normal=Vector((side*math.cos(theta),math.sin(theta),.1)).normalized()
   width=.0037*(.35+.65*math.sin(math.pi*min(1,t*2)))*(1-.55*t)*min(1,t/.22)
   for j in range(slices+1):
    v=j/slices;across=(v-.5)*2
    p=center+Vector((0,0,across*width))+normal*(.0025*(1-across*across))
    # Sink the roots into the existing cap so no cut ends are visible.
    p-=normal*(.031*(1-min(1,t/.40))**2)
    verts.append(tuple(p));uvs.append((.06+lock*.075+v*.05,.95-t*.85+(lock%3)*.015))
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
print('Ear-clearance vertices:',cleared)
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
bpy.ops.wm.save_as_mainfile(filepath=str(D/'teacher-floral-v8.blend'))
assert bpy.ops.export_scene.vrm(filepath=str(D/'teacher-floral-v8.vrm'),export_only_selections=False,export_invisibles=True,armature_object_name=rig.name)=={'FINISHED'}
p=D/'teacher-floral-v8.vrm';b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);tail=b[20+n:]
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
print('Saved v8 hair candidate')
