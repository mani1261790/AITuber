import json,struct,tempfile,unittest
from pathlib import Path
import numpy as np
from refine_teacher_lips_sleeves_v10 import refine,R

def unpack(path):
 b=Path(path).read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]
def read(g,raw,i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];w={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];dt=np.dtype({5126:'<f4',5123:'<u2',5125:'<u4'}[a['componentType']]);return np.ndarray((a['count'],w),dtype=dt,buffer=raw,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',w*dt.itemsize),dt.itemsize))
class ModelSafety(unittest.TestCase):
 def test_outfit_derivative_preserves_face_morphs_textures_and_exposed_hands(self):
  source=R/'apps/classroom/public/models/teacher-floral-v9.vrm'
  with tempfile.TemporaryDirectory() as d:
   dest=Path(d)/'v10.vrm';refine(source,dest);before,old=unpack(source);after,new=unpack(dest)
   self.assertEqual(new[:len(old)],old)
   for field in ['images','textures','skins','nodes','extensions']:
    self.assertEqual(before[field],after[field])
   for i,m in enumerate(before['meshes']):
    for j,p in enumerate(m['primitives']):
     q=after['meshes'][i]['primitives'][j]
     self.assertEqual(p.get('targets'),q.get('targets'))
     self.assertEqual(p['attributes']['POSITION'],q['attributes']['POSITION'])
     if p['material']==0:
      triangles=read(before,old,p['indices']).reshape(-1,3);new_triangles=read(after,new,q['indices']).reshape(-1,3)
      retained={tuple(t) for t in new_triangles};positions=read(before,old,p['attributes']['POSITION'])
      removed=np.array([t for t in triangles if tuple(t) not in retained])
      self.assertGreater(len(removed),0)
      self.assertTrue(np.all(np.abs(positions[removed,0])<.445))
      self.assertTrue(np.all(positions[removed,1]>1.05))
      self.assertEqual(np.sum(positions[removed].mean(1)[:,0]>0),np.sum(positions[removed].mean(1)[:,0]<0))
     elif p['material']==8:
      colors=read(after,new,q['attributes']['COLOR_0']);uv=read(before,old,p['attributes']['TEXCOORD_0'])
      changed=np.any(colors!=1,axis=1)
      self.assertTrue(np.all(np.abs(uv[changed,0]-.5)<.06))
      self.assertTrue(np.all(np.abs(uv[changed,1]-.7568)<.01))
      self.assertGreater(np.sum(changed),30)
     else:self.assertEqual(p,q)
if __name__=='__main__':unittest.main()
