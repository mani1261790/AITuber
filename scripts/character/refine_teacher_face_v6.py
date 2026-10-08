"""Embed generated UV textures without re-exporting or changing skeleton/geometry."""
from pathlib import Path
import json,struct,hashlib
R=Path(__file__).resolve().parents[2];D=R/'assets/character/teacher-reference/remake'
b=(R/'apps/classroom/public/models/teacher-floral-v5.vrm').read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);raw=bytearray(b[28+n:]);original=bytes(raw)
records=[]
for i,m in enumerate(g['materials']):
 name=m['name'];kind=None
 if 'EyeIris' in name:kind='iris-brown'
 elif 'Face_00_SKIN' in name:kind='face-soft'
 if kind is None:continue
 p=D/'extracted'/f'{kind}-v6.png';data=p.read_bytes();raw.extend(b' '*(-len(raw)%4));off=len(raw);raw.extend(data)
 vi=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':len(data)})
 im=len(g['images']);g['images'].append({'name':p.stem,'mimeType':'image/png','bufferView':vi})
 ti=len(g['textures']);g['textures'].append({'sampler':g['textures'][0].get('sampler',0),'source':im})
 m['pbrMetallicRoughness']['baseColorTexture']={'index':ti};m['pbrMetallicRoughness']['baseColorFactor']=[1,1,1,1]
 prop=g['extensions']['VRM']['materialProperties'][i];prop['textureProperties'].update(_MainTex=ti,_ShadeTexture=ti);prop['vectorProperties']['_Color']=[1,1,1,1];prop['vectorProperties']['_ShadeColor']=[.93,.86,.84,1]
 records.append({'material':name,'texture':str(p.relative_to(R)),'sha256':hashlib.sha256(data).hexdigest()})
raw.extend(b' '*(-len(raw)%4));g['buffers'][0]['byteLength']=len(raw)
j=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();j+=b' '*(-len(j)%4)
out=struct.pack('<III',0x46546c67,2,28+len(j)+len(raw))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(raw),0x004e4942)+raw
(D/'teacher-floral-v6.vrm').write_bytes(out)
assert bytes(raw[:len(original)])==original
(D/'teacher-floral-v6-texture-audit.json').write_text(json.dumps({'geometry_binary_unchanged':True,'textures':records},ensure_ascii=False,indent=2))
print('v6 face textures embedded; original mesh buffers unchanged',len(out))
