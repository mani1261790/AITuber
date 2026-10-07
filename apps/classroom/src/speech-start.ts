/** The snapshot offset is captured at delivery. Loading this audio is not listening to it. */
export function initialSpeechPosition(snapshotOffsetMs: number, durationSeconds: number) {
  const offset = Number.isFinite(snapshotOffsetMs) ? Math.max(0, snapshotOffsetMs) / 1000 : 0;
  return Number.isFinite(durationSeconds) && durationSeconds >= 0 ? Math.min(durationSeconds, offset) : offset;
}
