/**
 * 입력 한계와 사전 경고 (PRD 11절).
 *
 * 브라우저 안에서 모든 것을 처리하므로 한계는 기기 메모리다. 넘어서면 탭이
 * 통째로 죽고 그때까지 한 편집이 사라진다. 막을 수 없는 것은 미리 알리고,
 * 확실히 실패할 것은 아예 받지 않는다.
 */
import { timelineDuration, type TimelineItem } from './types'

/** 파일 하나의 상한. 이보다 크면 디코딩 전에 메모리가 먼저 바닥난다. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024

/** 프로젝트 전체 길이 상한(초). 넘으면 경고만 하고 편집은 계속할 수 있다. */
export const MAX_TOTAL_SECONDS = 60 * 60

/** 클립 개수 상한. 되돌리기 기록이 통째로 복사되므로 개수가 곧 메모리다. */
export const MAX_CLIPS = 100

/**
 * 내보내기가 무거워지는 기준.
 *
 * 프레임 하나하나를 그려 인코딩하므로 (픽셀 수 × 프레임 수) 가 일의 양이다.
 * 1080p 30fps 5분이 약 186억으로, 데스크톱에서는 몇 분, 저사양 폰에서는
 * 실패할 수 있는 지점이다. 이 언저리부터 미리 알린다.
 */
export const HEAVY_EXPORT_WORK = 18_000_000_000

export interface LimitNotice {
  id: 'clips' | 'duration'
  message: string
}

/** 지금 타임라인이 한계에 걸렸는지 본다. 넘어도 편집은 막지 않는다. */
export function timelineNotices(timeline: TimelineItem[]): LimitNotice[] {
  const notices: LimitNotice[] = []

  if (timeline.length > MAX_CLIPS) {
    notices.push({
      id: 'clips',
      message:
        `클립이 ${timeline.length}개입니다. ${MAX_CLIPS}개를 넘으면 기기에 따라 편집이 느려지거나 ` +
        '내보내다 실패할 수 있습니다. 나눠서 내보내는 편이 안전합니다.',
    })
  }

  const total = timelineDuration(timeline)
  if (total > MAX_TOTAL_SECONDS) {
    notices.push({
      id: 'duration',
      message:
        `전체 길이가 ${Math.round(total / 60)}분입니다. ${MAX_TOTAL_SECONDS / 60}분을 넘으면 ` +
        '내보내는 중 메모리가 부족해질 수 있습니다. 앞뒤로 나눠 내보내 주세요.',
    })
  }

  return notices
}

/** 내보내기 일의 양. 픽셀 수 × 프레임 수. */
export function exportWork(
  width: number,
  height: number,
  fps: number,
  durationSeconds: number,
): number {
  return width * height * fps * durationSeconds
}

/**
 * 오래 걸릴 내보내기인지 미리 알린다.
 *
 * 남은 시간을 숫자로 말하지 않는다. 기기마다 몇 배씩 차이가 나서, 틀린 숫자를
 * 보여 주면 기다릴지 말지 판단만 더 어려워진다. 실제 남은 시간은 인코딩이
 * 시작된 뒤 진행 속도를 재서 보여 준다.
 */
export function heavyExportNotice(work: number, resolution: number): string | null {
  if (work < HEAVY_EXPORT_WORK) return null
  const suggestion =
    resolution > 720
      ? '해상도를 720p로 낮추면 크게 빨라집니다.'
      : '영상을 나눠서 내보내면 실패 위험이 줄어듭니다.'
  return `이 설정은 처리량이 많아 오래 걸립니다. 화면을 켜 둔 채 기다려 주세요. ${suggestion}`
}

/** 남은 시간 추정. 지금까지의 진행 속도를 그대로 늘려 잡는다. */
export function estimateRemainingMs(progress: number, elapsedMs: number): number | null {
  // 초반에는 표본이 적어 숫자가 크게 흔들린다. 어느 정도 진행된 뒤부터 말한다.
  if (progress < 0.05 || progress >= 1 || elapsedMs < 1000) return null
  return Math.round((elapsedMs / progress) * (1 - progress))
}
