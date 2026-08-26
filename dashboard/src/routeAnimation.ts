import {
  DEFAULT_TIMELAPSE,
  type TimelapseAnimationPreferences,
} from "./types";

export interface RouteAnimationFrame {
  segmentProgress: number;
  lineOpacity: number;
  visible: boolean;
  complete: boolean;
}

export function mergeTimelapseAnimation(
  saved?: Partial<TimelapseAnimationPreferences> | null,
): TimelapseAnimationPreferences {
  const jump = Number(saved?.jumpDurationSeconds);
  const fade = Number(saved?.fadeDurationSeconds);
  return {
    jumpDurationSeconds: Number.isFinite(jump)
      ? Math.max(0.1, Math.min(10, jump))
      : DEFAULT_TIMELAPSE.jumpDurationSeconds,
    fadeDurationSeconds: Number.isFinite(fade)
      ? Math.max(0.2, Math.min(10, fade))
      : DEFAULT_TIMELAPSE.fadeDurationSeconds,
  };
}

export function resolveRouteAnimationFrame(
  elapsedSeconds: number,
  segmentCount: number,
  timing: TimelapseAnimationPreferences,
): RouteAnimationFrame {
  const safeSegments = Math.max(1, segmentCount);
  const jumpDuration = Math.max(0.1, timing.jumpDurationSeconds);
  const fadeDuration = Math.max(0.2, timing.fadeDurationSeconds);
  const fadeElapsed = elapsedSeconds - jumpDuration;
  const fadeProgress = Math.max(0, Math.min(1, fadeElapsed / fadeDuration));
  return {
    segmentProgress: Math.max(0, elapsedSeconds / jumpDuration) * safeSegments,
    lineOpacity: 0.38 * (1 - fadeProgress),
    visible: elapsedSeconds >= 0 && fadeProgress < 1,
    complete: fadeProgress >= 1,
  };
}
