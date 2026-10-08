import * as THREE from "three";
import { MToonMaterial, type VRM } from "@pixiv/three-vrm";

/** MToon defaults to ignoring vertex colors. Opt in only for the authored lip
 * tint on face-skin meshes that actually carry colors; do not recolor other rigs.
 */
export function applyAuthoredVertexColors(vrm: VRM) {
  let count = 0;
  vrm.scene.traverse(node => {
    if (!(node instanceof THREE.Mesh) || !node.geometry.hasAttribute("color")) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof MToonMaterial) || !material.name.includes("Face_00_SKIN")) continue;
      // Current Three.js can supply RGBA vertex colors. MToon's RGB factors
      // must explicitly take RGB, valid for either three- or four-channel input.
      material.fragmentShader = material.fragmentShader.replaceAll("*= vColor;", "*= vColor.rgb;");
      material.vertexColors = true;
      material.ignoreVertexColor = false;
      material.needsUpdate = true;
      count++;
    }
  });
  return count;
}
