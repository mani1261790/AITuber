"""First half-up and fabric ribbon iteration on the authored teacher model."""
from pathlib import Path
import bpy,sys,os,math,json,struct,copy
from mathutils import Vector
R=Path(__file__).resolve().parents[2];D=R/'assets/character/teacher-reference/remake'
sys.path.insert(0,str(R/'.cache/model-tools/addons'));bpy.ops.preferences.addon_enable(module='io_scene_vrm')
os.environ['BLENDER_VRM_AUTOMATIC_LICENSE_CONFIRMATION']='true'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.vrm(filepath=str(R/'apps/classroom/public/models/teacher-floral-v4.vrm'))

for o in list(bpy.context.scene.objects):
 if o.name=='Cube':bpy.data.objects.remove(o,do_unlink=True)
bpy.context.view_layer.update();rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
hair=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.name=='Hair')
# Gently gather only the upper side/back hair; leave fringe and hanging tips.
inv=hair.matrix_world.inverted()
for v in hair.data.vertices:
 p=hair.matrix_world@v.co
 if p.y>-.005 and abs(p.x)>.045 and 1.235<p.z<1.41:
  w=math.sin(math.pi*(p.z-1.235)/.175)**2*min(1,(abs(p.x)-.045)/.05)
  p.x*=1-.24*w;p.y+=.024*w;p.z-=.012*w
  v.co=inv@p
# Sculpted ribbon surfaces: curved folded loops, pinched knot and two fabric tails.
verts=[];faces=[]
def surface(fn,nu,nv):
 start=len(verts)
 for i in range(nu+1):
  for j in range(nv+1):verts.append(fn(i/nu,j/nv))
 for i in range(nu):
  for j in range(nv):
   a=start+i*(nv+1)+j;faces.append((a,a+nv+1,a+nv+2,a+1))
cy=.160;cz=1.285
for side in [-1,1]:
 def loop(u,v,side=side):
  x=side*(.007+.055*u);width=.008+.025*math.sin(math.pi*u*.85)
  return (x,cy+.012*math.sin(math.pi*u)+.011*math.cos((v-.5)*math.pi*2)*math.sin(math.pi*u),cz+.018*u+(v-.5)*2*width)
 surface(loop,20,10)
 def tail(u,v,side=side):
  x=side*(.012+.020*u)+(v-.5)*(.021+.009*u)
  z=cz-.009-.112*u+.008*abs(v-.5)*2*u**8
  y=cy+.007+ .009*math.sin(u*math.pi*1.3)+.003*math.sin(v*math.pi*3)*u
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
bpy.ops.wm.save_as_mainfile(filepath=str(D/'teacher-floral-v5.blend'))
assert bpy.ops.export_scene.vrm(filepath=str(D/'teacher-floral-v5.vrm'),export_only_selections=False,export_invisibles=True,armature_object_name=rig.name)=={'FINISHED'}
p=D/'teacher-floral-v5.vrm';b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);tail=b[20+n:]
props=g['extensions']['VRM']['materialProperties']
for group in g['extensions']['VRM']['secondaryAnimation']['boneGroups']:
 if group.get('comment')=='Hair':
  group.update(stiffiness=.9,dragForce=.65,gravityPower=.22,gravityDir={'x':0,'y':-1,'z':0})
for i,m in enumerate(g['materials']):
 if m['name']=='Ivory ribbon fabric':
  prop=copy.deepcopy(next(p for p in props if p['shader']=='VRM/MToon'));prop['name']=m['name'];prop['textureProperties']={};prop['vectorProperties']['_Color']=[.94,.86,.74,1];prop['vectorProperties']['_ShadeColor']=[.71,.64,.56,1];prop['floatProperties'].update(_BlendMode=0,_CullMode=0,_OutlineWidth=.08);props[i]=prop
 if 'Accessory_Tie' in m['name']:
  props[i]['vectorProperties']['_Color']=[.25,.25,.28,1];props[i]['vectorProperties']['_ShadeColor']=[.18,.18,.20,1]
j=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();j+=b' '*(-len(j)%4);p.write_bytes(struct.pack('<III',0x46546c67,2,20+len(j)+len(tail))+struct.pack('<II',len(j),0x4e4f534a)+j+tail)
print('Saved v5 hair/ribbon candidate')
