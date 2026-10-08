"""Remove unused VRM0 materials/textures and their binary data, without image loss."""
import json,struct,sys
from pathlib import Path
source,dest=map(Path,sys.argv[1:]);b=source.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);raw=b[28+n:]
used=sorted({p['material'] for mesh in g['meshes'] for p in mesh['primitives'] if 'material' in p});mm={old:new for new,old in enumerate(used)}
for mesh in g['meshes']:
 for p in mesh['primitives']:
  if 'material' in p:p['material']=mm[p['material']]
g['materials']=[g['materials'][i] for i in used];vrm=g['extensions']['VRM'];vrm['materialProperties']=[vrm['materialProperties'][i] for i in used]
refs=[]
def walk(o):
 if isinstance(o,dict):
  for k,v in o.items():
   if k.endswith('Texture') and isinstance(v,dict) and 'index' in v:refs.append((v,'index'))
   else:walk(v)
 elif isinstance(o,list):
  for v in o:walk(v)
walk(g['materials'])
for p in vrm['materialProperties']:
 for k in p['textureProperties']:refs.append((p['textureProperties'],k))
if vrm['meta'].get('texture',-1)>=0:refs.append((vrm['meta'],'texture'))
used=sorted({o[k] for o,k in refs});tm={old:new for new,old in enumerate(used)}
for o,k in refs:o[k]=tm[o[k]]
g['textures']=[g['textures'][i] for i in used]
used=sorted({t['source'] for t in g['textures']});im={old:new for new,old in enumerate(used)};old_image_views={i['bufferView'] for i in g['images']}
for t in g['textures']:t['source']=im[t['source']]
g['images']=[g['images'][i] for i in used]
used_views=(set(range(len(g['bufferViews'])))-old_image_views)|{i['bufferView'] for i in g['images']}
for a in g['accessors']:
 if 'bufferView' in a:used_views.add(a['bufferView'])
 if 'sparse' in a:
  for key in ['indices','values']:used_views.add(a['sparse'][key]['bufferView'])
vm={old:new for new,old in enumerate(sorted(used_views))};out=bytearray();views=[]
for old in sorted(used_views):
 v=g['bufferViews'][old].copy();chunk=raw[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];out.extend(b'\0'*(-len(out)%4));v['byteOffset']=len(out);out.extend(chunk);views.append(v)
for a in g['accessors']:
 if 'bufferView' in a:a['bufferView']=vm[a['bufferView']]
 if 'sparse' in a:
  for key in ['indices','values']:a['sparse'][key]['bufferView']=vm[a['sparse'][key]['bufferView']]
for i in g['images']:i['bufferView']=vm[i['bufferView']]
g['bufferViews']=views;out.extend(b'\0'*(-len(out)%4));g['buffers'][0]['byteLength']=len(out)
j=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();j+=b' '*(-len(j)%4)
result=struct.pack('<III',0x46546c67,2,28+len(j)+len(out))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(out),0x004e4942)+out
assert len(result)<25*1024*1024, len(result)
dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(result);print(f'{len(b):,} -> {len(result):,} bytes (no image or geometry re-encoding)')
