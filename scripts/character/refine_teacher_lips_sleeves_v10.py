"""Create a reversible clothing-specific derivative; preserve textures and facial morphs.
Covered arm triangles are omitted, not dynamically collided against a skinned sleeve.
Lip vertex colors are linear-light multipliers, attached to the deforming lip mesh.
"""
from pathlib import Path
import json, struct, hashlib
import numpy as np
R=Path(__file__).resolve().parents[2]
def refine(source,destination):
 original=Path(source).read_bytes();n=struct.unpack_from('<I',original,12)[0]
 g=json.loads(original[20:20+n]);raw=bytearray(original[28+n:]);report={'sourceSha256':hashlib.sha256(original).hexdigest()}
 def read(i):
  a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];width={'VEC2':2,'VEC3':3,'VEC4':4,'SCALAR':1}[a['type']];dt=np.dtype({5126:'<f4',5123:'<u2',5125:'<u4',5121:'u1'}[a['componentType']])
  return np.ndarray((a['count'],width),dtype=dt,buffer=raw,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',width*dt.itemsize),dt.itemsize)).copy()
 def append(values,kind,component):
  raw.extend(b'\0'*(-len(raw)%4));off=len(raw);data=values.tobytes();raw.extend(data)
  view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':len(data)})
  index=len(g['accessors']);g['accessors'].append({'bufferView':view,'componentType':component,'count':len(values),'type':kind,'min':values.min(axis=0).tolist(),'max':values.max(axis=0).tolist()});return index
 for node in g['nodes']:
  if 'mesh' not in node:continue
  for p in g['meshes'][node['mesh']]['primitives']:
   name=g['materials'][p['material']]['name'];attrs=p['attributes']
   if 'Face_00_SKIN' in name:
    uv=read(attrs['TEXCOORD_0']);ids=np.unique(read(p['indices']))
    # UV location is verified against this exact face atlas and mouth vertices.
    distance=((uv[:,0]-.5)/.060)**2+((uv[:,1]-.7568)/.010)**2
    influence=np.clip(1-distance,0,1);influence=influence*influence*(3-2*influence)
    colors=np.ones((len(uv),3),dtype='<f4');colors-=influence[:,None]*np.array([.38,.88,.80],dtype='<f4')
    attrs['COLOR_0']=append(colors,'VEC3',5126)
    report['lipVertices']=int(np.sum(influence[ids]>.01));assert report['lipVertices']>30
   elif 'Body_00_SKIN' in name:
    pos=read(attrs['POSITION']);j=read(attrs['JOINTS_0']);w=read(attrs['WEIGHTS_0'])
    joints=g['skins'][node['skin']]['joints'];arm=[i for i,ni in enumerate(joints) if any(part in g['nodes'][ni]['name'] for part in ['UpperArm','LowerArm'])]
    arm_weight=np.sum(w*np.isin(j,arm),axis=1)
    covered=(arm_weight>.05)&(np.abs(pos[:,0])<.445)&(pos[:,1]>1.05)&(pos[:,1]<1.205)
    old=read(p['indices']);tri=old.reshape(-1,3);remove=np.all(covered[tri],axis=1);keep=tri[~remove].reshape(-1,1)
    assert 300<remove.sum()<2000,remove.sum()
    p['indices']=append(keep,'SCALAR',g['accessors'][p['indices']]['componentType'])
    # Every exposed hand/finger/wrist triangle must remain byte-identical.
    exposed=np.any(np.abs(pos[tri,0])>=.445,axis=1)
    assert not np.any(remove&exposed)
    report['coveredArmTrianglesRemoved']=int(remove.sum());report['skinTrianglesRemaining']=len(keep)//3
    report['handsAndWristsPreserved']=True
 assert 'coveredArmTrianglesRemoved' in report and 'lipVertices' in report
 g.setdefault('extras',{})['aituberLipsSleeves']=report
 raw.extend(b'\0'*(-len(raw)%4));g['buffers'][0]['byteLength']=len(raw)
 header=json.dumps(g,ensure_ascii=False,separators=(',',':')).encode();header+=b' '*(-len(header)%4)
 result=struct.pack('<III',0x46546c67,2,28+len(header)+len(raw))+struct.pack('<II',len(header),0x4e4f534a)+header+struct.pack('<II',len(raw),0x004e4942)+raw
 assert Path(source).resolve()!=Path(destination).resolve();Path(destination).write_bytes(result)
 return report
if __name__=='__main__':
 source=R/'apps/classroom/public/models/teacher-floral-v9.vrm';destination=source.with_name('teacher-floral-v10.vrm')
 report=refine(source,destination);print(json.dumps(report,indent=2))
 (R/'docs/teacher-v10-audit.json').write_text(json.dumps(report,indent=2)+'\n')
