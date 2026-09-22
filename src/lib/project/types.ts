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

/**
 * 자막 (FR-033~036).
 *
 * 시각은 타임라인 절대 시간이 아니라 **클립이 참조하는 원본의 시간축**에
 * 기록한다. 절대 시간에 묶으면 클립을 옮기거나 지우는 순간 모든 자막이
 * 어긋나 처음부터 다시 맞춰야 한다.
 *
 * 영상 클립은 inPoint~outPoint 와 같은 축이고, 사진·빈 화면은 inPoint 가
 * 0 이므로 0~duration 축이 된다. 덕분에 트림으로 앞을 잘라내도 자막이
 * 장면과 함께 움직이고, 되돌리면 그대로 돌아온다.
 */
export interface Subtitle {
  id: string
  /** 종속된 TimelineItem. 그 클립이 사라지면 함께 사라진다. */
  clipId: string
  /** 원본 시간축 기준 시작·종료 (초) */
  start: number
  end: number
  text: string
}

/** 프로젝트 전체에 한 벌만 둔다 (FR-036). */
export interface SubtitleStyle {
  /** 출력 높이 대비 글자 크기 비율 */
  fontScale: number
  color: string
  background: 'outline' | 'box' | 'none'
  backgroundOpacity: number
  /** 아래에서부터의 비율 */
  verticalPosition: number
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontScale: 0.045,
  color: '#FFFFFF',
  background: 'outline',
  backgroundOpacity: 0.6,
  verticalPosition: 0.08,
}

/** 새로 넣는 자막의 기본 길이 */
export const DEFAULT_SUBTITLE_SECONDS = 2
export const MIN_SUBTITLE_SECONDS = 0.2
export const MAX_SUBTITLE_LENGTH = 200

/** 출력 설정 (PRD 8절, FR-014~017) */
export type AspectRatio = '16:9' | '9:16' | '1:1' | 'source'
export type FitMode = 'contain' | 'cover' | 'blur'
export type Resolution = 2160 | 1440 | 1080 | 720 | 480
export type QualityLevel = 'high' | 'medium' | 'low'

export interface ExportSetting {
  aspectRatio: AspectRatio
  /** contain = 여백 채우기, cover = 잘라 채우기, blur = 흐린 배경 채우기 */
  fitMode: FitMode
  /** 출력 세로 해상도 */
  resolution: Resolution
  quality: QualityLevel
  /** 초당 프레임. 지금은 30으로 고정하고 설정 UI 는 두지 않는다. */
  fps: number
}

/**
 * 기본값은 '흐린 배경 채우기'다.
 *
 * 세로 영상과 가로 영상을 한 타임라인에 섞으면 어느 쪽이든 화면비가 맞지 않는
 * 구간이 생긴다. 검은 여백은 눈에 거슬리고 잘라 채우기는 화면을 잘라내므로,
 * 셋 중에 잘리지도 않고 여백도 남지 않는 쪽을 기본으로 둔다.
 */
export const DEFAULT_EXPORT_SETTING: ExportSetting = {
  aspectRatio: 'source',
  fitMode: 'blur',
  resolution: 1080,
  quality: 'medium',
  fps: 30,
}
