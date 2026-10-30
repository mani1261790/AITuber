/** Match display density without multiplying a full-screen render target again.
 * MSAA handles edges; cap Retina/4K pixel count to keep motion and capture responsive. */
export function lecturePixelRatio(width: number, height: number, deviceRatio: number, maxDimension = 8192): number {
  const w = Math.max(1, width), h = Math.max(1, height);
  const dpr = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.min(
    Math.max(1, Math.min(2, dpr)),
    Math.sqrt(4_147_200 / (w * h)),
    maxDimension / Math.max(w, h),
  );
}
