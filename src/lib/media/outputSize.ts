import type { ExportSetting, QualityLevel, Resolution } from '../project/types'

/** 고를 수 있는 세로 해상도. 큰 것부터 (FR-016). */
export const RESOLUTIONS: Resolution[] = [2160, 1440, 1080, 720, 480]

/**
 * 화질별 픽셀당 비트 수.
 *
 * 1080p30 '보통'이 약 5.6Mbps 가 되도록 잡았다. 해상도나 프레임율이 바뀌어도
 * 같은 기준이 적용되므로, 480p 로 낮추면 용량도 그만큼 줄어든다.
 */
const BITS_PER_PIXEL: Record<QualityLevel, number> = { high: 0.14, medium: 0.09, low: 0.05 }

export const AUDIO_BITRATE = 128_000

export interface Size {
  width: number
  height: number
}

/** 인코더가 홀수 크기를 거부하는 경우가 있어 짝수로 맞춘다. */
function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * 출력 크기를 정한다 (FR-014, FR-016).
 *
 * 세로 해상도를 설정에서 가져오고, 가로는 화면비에서 계산한다.
 * '원본 유지'는 첫 영상의 비율을 그대로 쓴다.
 */
export function computeOutputSize(setting: ExportSetting, source: Size): Size {
  const height = setting.resolution
  const ratio =
    setting.aspectRatio === '16:9'
      ? 16 / 9
      : setting.aspectRatio === '9:16'
        ? 9 / 16
        : setting.aspectRatio === '1:1'
          ? 1
          : source.height > 0
            ? source.width / source.height
            : 16 / 9

  return { width: even(height * ratio), height: even(height) }
}

/**
 * 원본을 키우지 않는 기본 해상도를 고른다.
 *
 * 720p 로 찍은 영상을 기본값 1080p 로 내보내면 화질은 그대로인데 용량만
 * 커진다. 설정을 건드리지 않는 사용자가 가장 많으므로 기본값이 원본을
 * 따라가야 한다. 목록의 최솟값이 480p 이므로 그보다 작은 원본은 480p 가 된다.
 */
export function fitResolution(sourceHeight: number): Resolution {
  return RESOLUTIONS.find((resolution) => resolution <= sourceHeight) ?? 480
}

export function estimateVideoBitrate(setting: ExportSetting, size: Size): number {
  const raw = size.width * size.height * setting.fps * BITS_PER_PIXEL[setting.quality]
  // 너무 낮으면 화면이 뭉개지고, 너무 높으면 용량만 커진다.
  return Math.round(Math.min(40_000_000, Math.max(300_000, raw)))
}

/** 예상 용량(바이트). 실제 결과는 장면 복잡도에 따라 달라진다 (FR-017). */
export function estimateFileSize(
  setting: ExportSetting,
  size: Size,
  durationSeconds: number,
): number {
  const bits = (estimateVideoBitrate(setting, size) + AUDIO_BITRATE) * durationSeconds
  return Math.round(bits / 8)
}
