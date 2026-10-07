import * as THREE from "three";
import { MToonMaterial, MToonMaterialOutlineWidthMode } from "@pixiv/three-vrm";
export type ClassroomLook = "anime" | "original";

/** Preserve authored textures and alpha; alter lighting response, not the model asset. */
export class AnimeLook {
  private hairOutlines = new Map<THREE.Mesh, { geometry: THREE.BufferGeometry; outlinedGeometry: THREE.BufferGeometry; material: MToonMaterial; outline: MToonMaterial }>();
  private character = new Map<MToonMaterial, MToonMaterial>();
  private room: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; toon: THREE.Material | THREE.Material[] }[] = [];
  private ramp = new THREE.DataTexture(new Uint8Array([100, 190, 255]), 3, 1, THREE.RedFormat);
  constructor() { this.ramp.minFilter = this.ramp.magFilter = THREE.NearestFilter; this.ramp.generateMipmaps = false; this.ramp.needsUpdate = true; }
  registerCharacter(root: THREE.Object3D) {
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material instanceof MToonMaterial && !this.character.has(material)) this.character.set(material, material.clone());
      }
      const material = node.material;
      if (material instanceof MToonMaterial && /HAIR/i.test(material.name) && !material.isOutline && material.outlineWidthMode === MToonMaterialOutlineWidthMode.None && !this.hairOutlines.has(node)) {
        // A width value alone cannot draw a missing outline pass. Reuse this mesh
        // (and its skin/morph animation), adding a back-face pass on a private geometry.
        const outlinedGeometry = node.geometry.clone();
        outlinedGeometry.clearGroups();
        const count = outlinedGeometry.index?.count ?? outlinedGeometry.getAttribute("position").count;
        outlinedGeometry.addGroup(0, count, 0); outlinedGeometry.addGroup(0, count, 1);
        const outline = material.clone();
        outline.name += " (Teacher Outline)";
        outline.isOutline = true; outline.side = THREE.BackSide;
        outline.outlineWidthMode = MToonMaterialOutlineWidthMode.WorldCoordinates;
        outline.outlineWidthFactor = .0017;
        outline.outlineColorFactor.set("#302535"); outline.outlineLightingMixFactor = 0;
        this.hairOutlines.set(node, {geometry:node.geometry,outlinedGeometry,material,outline});
      }
    });
  }
  registerRoom(root: THREE.Object3D) {
    const converted = new Map<THREE.Material, THREE.Material>();
    const convert = (material: THREE.Material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return material;
      const palette: [RegExp,string][] = [[/beigeWall|plaster/i,"#dfdbc8"],[/Ceiling|beigePaint$|Pipe/i,"#dce6df"],[/woodPlanks|beigePaintedwood/i,"#839e96"],[/woodFloor|varnishedWood|Desk_wood/i,"#bda078"],[/PaintedWindow|paintedBlind|radiator|PaintedPlastic/i,"#eff1db"]];
      const flat=palette.find(([pattern])=>pattern.test(material.name));
      if (!converted.has(material)) converted.set(material, new THREE.MeshToonMaterial({
        color: flat ? new THREE.Color(flat[1]) : material.color, map: flat ? null : material.map, alphaMap: material.alphaMap, transparent: material.transparent,
        opacity: material.opacity, alphaTest: material.alphaTest, side: material.side, depthWrite: material.depthWrite,
        emissive: material.emissive, emissiveMap: material.emissiveMap, emissiveIntensity: material.emissiveIntensity,
        gradientMap: this.ramp,
      }));
      const toon=converted.get(material)!;
      if(/woodFloor/i.test(material.name))addPaintedPlanks(toon);
      return toon;
    };
    root.traverse(node => { if (node instanceof THREE.Mesh) this.room.push({mesh:node,original:node.material,toon:Array.isArray(node.material) ? node.material.map(convert) : convert(node.material)}); });
  }
  apply(look: ClassroomLook) {
    for (const [material, original] of this.character) {
      material.copy(original);
      if (look === "anime") {
        const eye=/EyeIris|EyeHighlight|EyeWhite|FaceBrow|FaceEyelash|FaceEyeline/i.test(original.name);
        const skin=/SKIN|FaceMouth/i.test(original.name);
        if (/HAIR/i.test(original.name)) {
          // The bright strand stripe is baked into the emission texture.
          // Soften that layer while retaining the authored color and silhouette.
          material.emissive.copy(original.emissive).multiplyScalar(.45);
        }
        // Keep facial line art and eye highlights authored; their lighting differs from cloth.
        if(!eye){
          material.shadingToonyFactor = 1;
          material.shadingShiftFactor = skin ? -.35 : -.18;
          material.shadeColorFactor.copy(original.shadeColorFactor);
          if(skin)material.color.copy(original.color).multiply(new THREE.Color("#f4d8c5"));
          else material.shadeColorFactor.multiply(new THREE.Color("#c2c1d3"));
          material.giEqualizationFactor = skin ? .65 : .35;
          material.outlineWidthFactor = Math.min(.003, Math.max(.0015, original.outlineWidthFactor*2));
          material.outlineColorFactor.set(skin ? "#76545b" : "#34293c");
          material.outlineLightingMixFactor = .15;
        }
      }
      material.needsUpdate = true;
    }
    this.hairOutlines.forEach((entry,mesh) => {
      mesh.geometry = look === "anime" ? entry.outlinedGeometry : entry.geometry;
      mesh.material = look === "anime" ? [entry.material,entry.outline] : entry.material;
    });
    this.room.forEach(entry => { entry.mesh.material = look === "anime" ? entry.toon : entry.original; });
    this.update(0);
  }
  update(delta: number) {
    // The avatar loop updates humanoid/expressions/springs separately from VRM.update.
    // MToon still needs its own update for alpha cutoff, UV transforms and animation.
    this.character.forEach((_,material)=>material.update(delta));
    this.hairOutlines.forEach(entry=>entry.outline.update(delta));
  }
  dispose() {
    this.apply("original");
    const originals = new Set(this.room.flatMap(entry=>Array.isArray(entry.original)?entry.original:[entry.original]));
    const converted = new Set(this.room.flatMap(entry=>Array.isArray(entry.toon)?entry.toon:[entry.toon]));
    converted.forEach(material=>{if(!originals.has(material))material.dispose();});
    this.character.forEach(material=>material.dispose());
    this.hairOutlines.forEach(entry=>{entry.outlinedGeometry.dispose();entry.outline.dispose();});this.hairOutlines.clear();
    this.ramp.dispose();
  }
}

/** World-sized painted floor detail stays readable without restoring photographic noise. */
function addPaintedPlanks(material:THREE.Material){
  material.onBeforeCompile=shader=>{
    shader.vertexShader="varying vec3 classroomWorldPosition;\n"+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace("#include <worldpos_vertex>","#include <worldpos_vertex>\nclassroomWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader="varying vec3 classroomWorldPosition;\n"+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>",`#include <color_fragment>
      vec2 plank=vec2(classroomWorldPosition.x/.28,classroomWorldPosition.z/1.8);
      float row=floor(plank.x);
      plank.y+=mod(row,3.0)/3.0;
      vec2 edge=min(fract(plank),1.0-fract(plank));
      vec2 width=max(fwidth(plank)*1.2,vec2(.007,.003));
      float seam=1.0-min(smoothstep(0.0,width.x,edge.x),smoothstep(0.0,width.y,edge.y));
      float variation=.97+.05*fract(sin(row*12.9898+floor(plank.y)*78.233)*43758.5453);
      diffuseColor.rgb*=variation*(1.0-seam*.22);
    `);
  };
  material.customProgramCacheKey=()=>"classroom-painted-planks-v1";
}
