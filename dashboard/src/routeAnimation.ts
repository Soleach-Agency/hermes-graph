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
  const nodeBirth = Number(saved?.nodeBirthDurationSeconds);
  const nodeFade = Number(saved?.nodeFadeDurationSeconds);
  return {
    jumpDurationSeconds: Number.isFinite(jump)
      ? Math.max(0.1, Math.min(10, jump))
      : DEFAULT_TIMELAPSE.jumpDurationSeconds,
    fadeDurationSeconds: Number.isFinite(fade)
      ? Math.max(0.2, Math.min(10, fade))
      : DEFAULT_TIMELAPSE.fadeDurationSeconds,
    nodeBirthDurationSeconds: Number.isFinite(nodeBirth)
      ? Math.max(0.1, Math.min(10, nodeBirth))
      : DEFAULT_TIMELAPSE.nodeBirthDurationSeconds,
    nodeFadeDurationSeconds: Number.isFinite(nodeFade)
      ? Math.max(0.2, Math.min(10, nodeFade))
      : DEFAULT_TIMELAPSE.nodeFadeDurationSeconds,
  };
}

export function resolveRouteAnimationFrame(
  elapsedSeconds: number,
  segmentCount: number,
  timing: Pick<TimelapseAnimationPreferences, "jumpDurationSeconds" | "fadeDurationSeconds">,
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
