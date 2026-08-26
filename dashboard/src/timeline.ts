export function interpolatePlaybackCursor(
  startCursor: number,
  endCursor: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (endCursor <= startCursor) return startCursor;
  const progress = Math.min(1, Math.max(0, elapsedMs / Math.max(1, durationMs)));
  return Math.min(
    endCursor,
    Math.round(startCursor + (endCursor - startCursor) * progress),
  );
}
