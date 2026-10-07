import * as THREE from "three";

/** Reuse the GPU allocation for successive images of the same dimensions. */
export function updateLessonTexture(previous: THREE.CanvasTexture | null, canvas: HTMLCanvasElement | null, anisotropy: number) {
  if (previous && canvas && previous.image.width === canvas.width && previous.image.height === canvas.height) {
    if (previous.image !== canvas) { previous.image = canvas; previous.needsUpdate = true; }
    return previous;
  }
  previous?.dispose();
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

export function setLessonMap(material: THREE.MeshBasicMaterial, texture: THREE.CanvasTexture | null) {
  const changedPresence = Boolean(material.map) !== Boolean(texture);
  material.map = texture;
  // Image changes require an upload, not a new material program configuration.
  if (changedPresence) material.needsUpdate = true;
}
