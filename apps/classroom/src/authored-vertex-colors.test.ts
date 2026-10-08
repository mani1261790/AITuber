import {expect,it} from "vitest";
import * as THREE from "three";
import {MToonMaterial,type VRM} from "@pixiv/three-vrm";
import {applyAuthoredVertexColors} from "./authored-vertex-colors.ts";
it("enables lip RGB tint with RGB or RGBA attributes without changing uncolored materials",()=>{
 const scene=new THREE.Group();
 const colored=new MToonMaterial();colored.name="N00_Face_00_SKIN";
 const untouched=new MToonMaterial();untouched.name="N00_Face_00_SKIN";
 const geometry=new THREE.BufferGeometry();geometry.setAttribute("color",new THREE.Float32BufferAttribute([.8,.4,.5,1],4));
 scene.add(new THREE.Mesh(geometry,colored),new THREE.Mesh(new THREE.BufferGeometry(),untouched));
 expect(applyAuthoredVertexColors({scene} as VRM)).toBe(1);
 expect(colored.ignoreVertexColor).toBe(false);expect(colored.vertexColors).toBe(true);
 expect(colored.fragmentShader).not.toContain("*= vColor;");
 expect(colored.fragmentShader).toContain("*= vColor.rgb;");
 expect(colored.clone().ignoreVertexColor).toBe(false);
 expect(untouched.ignoreVertexColor).toBe(true);
});
