/**
 * 프로젝트 데이터 모델 (PRD 8절).
 *
 * 원본 파일과 타임라인을 분리한다. 같은 영상을 여러 번 잘라 써도 원본은 하나만
 * 보관하기 위해서다. 타임라인 항목은 원본을 `sourceId`로 참조한다.
 */

export type SourceKind = 'video' | 'image'

export interface MediaSource {
  id: string
  kind: SourceKind
  /** 원본 File. Phase 11에서 OPFS 사본으로 대체된다. */
  file: File
  fileName: string
  fileSize: number
  lastModified: number
  /** 회전을 반영한, 사람이 보게 될 크기 */
  displayWidth: number
  displayHeight: number
  /** 영상만. 이미지는 null */
  durationSeconds: number | null
  rotation: number
  videoCodec: string | null
  audioCodec: string | null
  hasAudio: boolean
  /** 타임라인에 띄울 대표 프레임. 생성 실패 시 null */
  thumbnailUrl: string | null
}

export type TimelineItemType = 'video' | 'image' | 'blank'

export interface TimelineItem {
  id: string
  type: TimelineItemType
  /** blank 이 아니면 필수 */
  sourceId: string | null
  /** video 전용. 원본 기준 사용 구간 */
  inPoint: number
  outPoint: number
  /** image·blank 전용 표시 시간 */
  duration: number
  volume: number
  muted: boolean
  /** blank 전용 배경색 */
  color: string
}

/** PRD 8절 기본값 */
export const DEFAULT_IMAGE_DURATION = 3
export const DEFAULT_BLANK_DURATION = 2
export const DEFAULT_BLANK_COLOR = '#000000'

/** 불러오지 못한 파일. 사용자에게 무엇이 왜 실패했는지 알린다 (FR-003). */
export interface RejectedFile {
  fileName: string
  reason: string
}

/** 타임라인 항목이 화면에서 차지하는 시간 길이 */
export function itemDuration(item: TimelineItem): number {
  return item.type === 'video' ? item.outPoint - item.inPoint : item.duration
}

export function timelineDuration(items: TimelineItem[]): number {
  return items.reduce((total, item) => total + itemDuration(item), 0)
}
