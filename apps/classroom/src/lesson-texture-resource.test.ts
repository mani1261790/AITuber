import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { setLessonMap, updateLessonTexture } from "./lesson-texture-resource.ts";
const canvas = (width = 1280) => ({ width, height: 720 }) as HTMLCanvasElement;
it("uploads replacement pixels without reallocating or invalidating the material", () => {
 const first=canvas(),second=canvas(),texture=updateLessonTexture(null,first,4)!;
 const material=new THREE.MeshBasicMaterial();setLessonMap(material,texture);
 const materialVersion=material.version,textureVersion=texture.version,dispose=vi.spyOn(texture,"dispose");
 const updated=updateLessonTexture(texture,second,4);setLessonMap(material,updated);
 expect(updated).toBe(texture);expect(texture.image).toBe(second);expect(texture.version).toBeGreaterThan(textureVersion);
 expect(material.version).toBe(materialVersion);expect(dispose).not.toHaveBeenCalled();
 const version=texture.version;updateLessonTexture(texture,second,4);expect(texture.version).toBe(version);
 texture.dispose();material.dispose();
});
it("reallocates on size changes and releases the last texture when cleared",()=>{
 const texture=updateLessonTexture(null,canvas(),4)!,dispose=vi.spyOn(texture,"dispose");
 const replacement=updateLessonTexture(texture,canvas(640),4)!;expect(replacement).not.toBe(texture);expect(dispose).toHaveBeenCalledOnce();
 const material=new THREE.MeshBasicMaterial();setLessonMap(material,replacement);const version=material.version;
 const clear=vi.spyOn(replacement,"dispose");setLessonMap(material,updateLessonTexture(replacement,null,4));
 expect(clear).toHaveBeenCalledOnce();expect(material.map).toBeNull();expect(material.version).toBeGreaterThan(version);material.dispose();
});
