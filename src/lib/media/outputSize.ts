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

/** 너무 낮으면 화면이 뭉개지고, 너무 높으면 용량만 커진다. */
export const MIN_VIDEO_BITRATE = 300_000
export const MAX_VIDEO_BITRATE = 40_000_000

/** 목표 용량을 말할 때 쓰는 단위. 파일 탐색기가 보여 주는 값과 같게 1024 기준. */
export const MB = 1024 * 1024

/**
 * 컨테이너·헤더가 차지하는 몫.
 *
 * 비트레이트만으로 역산하면 인덱스와 헤더 때문에 목표를 조금씩 넘는다.
 * 짧은 영상일수록 비중이 커서 여유를 둔다.
 */
const CONTAINER_OVERHEAD = 0.03

export function estimateVideoBitrate(setting: ExportSetting, size: Size): number {
  const raw = size.width * size.height * setting.fps * BITS_PER_PIXEL[setting.quality]
  return clampBitrate(raw)
}

function clampBitrate(value: number): number {
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, value)))
}

/**
 * 목표 용량에서 영상 비트레이트를 역산한다 (FR-018).
 *
 * 소리는 용량을 줄이려고 건드리지 않는다. 화질은 눈으로 참을 수 있어도
 * 소리가 뭉개지면 못 쓰는 영상이 된다.
 */
export function bitrateForTargetSize(targetBytes: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return MIN_VIDEO_BITRATE
  const usableBits = targetBytes * (1 - CONTAINER_OVERHEAD) * 8
  return clampBitrate(usableBits / durationSeconds - AUDIO_BITRATE)
}

/**
 * 실제로 쓸 영상 비트레이트.
 *
 * 목표 용량은 상한으로만 쓴다. 목표를 크게 잡았다고 화질 설정보다 높여
 * 내보내면, 사용자가 고른 화질을 앱이 뒤집는 셈이 된다.
 */
export function resolveVideoBitrate(
  setting: ExportSetting,
  size: Size,
  durationSeconds: number,
): number {
  const byQuality = estimateVideoBitrate(setting, size)
  if (setting.targetSizeMb === null) return byQuality
  return Math.min(byQuality, bitrateForTargetSize(setting.targetSizeMb * MB, durationSeconds))
}

/** 예상 용량(바이트). 실제 결과는 장면 복잡도에 따라 달라진다 (FR-017). */
export function estimateFileSize(
  setting: ExportSetting,
  size: Size,
  durationSeconds: number,
): number {
  const bitrate = resolveVideoBitrate(setting, size, durationSeconds)
  const bits = (bitrate + AUDIO_BITRATE) * durationSeconds
  return Math.round(bits / 8 / (1 - CONTAINER_OVERHEAD))
}

/**
 * 최소 화질로도 나오는 용량(바이트).
 *
 * 목표를 이보다 작게 잡으면 어떻게 해도 맞출 수 없다. 내보내기를 돌려
 * 실패를 확인시키기 전에 미리 알려 주기 위한 값이다 (FR-019).
 */
export function floorFileSize(durationSeconds: number): number {
  const bits = (MIN_VIDEO_BITRATE + AUDIO_BITRATE) * durationSeconds
  return Math.round(bits / 8 / (1 - CONTAINER_OVERHEAD))
}

/** 목표를 못 맞췄을 때 제안할 한 단계 낮은 해상도. 더 낮출 수 없으면 null. */
export function lowerResolution(current: Resolution): Resolution | null {
  const index = RESOLUTIONS.indexOf(current)
  if (index === -1 || index === RESOLUTIONS.length - 1) return null
  return RESOLUTIONS[index + 1]
}
