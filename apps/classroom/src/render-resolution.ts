/** Supersample small facial features without unbounded Retina/4K render targets. */
export function lecturePixelRatio(width: number, height: number, deviceRatio: number, maxDimension = 8192): number {
  const w = Math.max(1, width), h = Math.max(1, height);
  const dpr = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.min(
    Math.max(2, Math.min(3, dpr * 1.5)),
    Math.sqrt(8_294_400 / (w * h)),
    maxDimension / Math.max(w, h),
  );
}
