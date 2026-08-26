import type {
  PlaybackDurationSetting,
  PlaybackPreferences,
} from "./types";

const UNIT_SECONDS = {
  seconds: 1,
  minutes: 60,
  hours: 3_600,
} as const;

export function durationSettingSeconds(setting: PlaybackDurationSetting): number {
  const value = Number.isFinite(setting.value) ? Math.max(0.1, setting.value) : 1;
  return value * UNIT_SECONDS[setting.unit];
}

export function resolvePlaybackDurationMs(
  preferences: PlaybackPreferences,
  sourceSeconds: number,
): number {
  const realSeconds = preferences.mode === "fixed-duration"
    ? durationSettingSeconds(preferences.fixedDuration)
    : (Math.max(0, sourceSeconds) / 3_600) *
      durationSettingSeconds(preferences.perSourceHour);
  return Math.max(250, realSeconds * 1_000);
}

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
