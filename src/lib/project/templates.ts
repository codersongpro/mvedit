import type { ExportSetting, SubtitleStyle } from './types'

/**
 * 올릴 곳별 템플릿 (FR-045).
 *
 * 사용자는 "9:16, 1080p, 자막 위치 30%"가 아니라 "쇼츠에 올릴 거야"로 생각한다.
 * 템플릿은 그 한 번의 선택을 출력 설정과 자막 모양으로 풀어 준다. 고른 뒤에도
 * 각 설정은 그대로 바꿀 수 있고, 바꾸면 템플릿 표시가 꺼질 뿐이다.
 *
 * 템플릿을 프로젝트에 따로 저장하지 않고 현재 설정과 비교해 알아낸다.
 * 저장해 두면 사용자가 설정을 손으로 바꿨을 때 "쇼츠인데 16:9"처럼 어긋난
 * 상태가 남는다.
 */
export interface Template {
  id: 'shorts' | 'reels' | 'youtube' | 'vlog'
  label: string
  hint: string
  export: Pick<ExportSetting, 'aspectRatio' | 'fitMode' | 'resolution' | 'quality'>
  subtitle: SubtitleStyle
  /** 이보다 길면 올릴 수 없거나 잘릴 수 있어 내보내기 전에 알린다. null 이면 제한 없음 */
  maxSeconds: number | null
}

export const TEMPLATES: Template[] = [
  {
    id: 'shorts',
    label: '쇼츠',
    hint: '유튜브 쇼츠 · 세로 9:16 · 3분 이하',
    export: { aspectRatio: '9:16', fitMode: 'blur', resolution: 1080, quality: 'high' },
    // 쇼츠 화면 아래쪽은 채널 이름·설명이 덮는다. 자막을 그 위로 올리고 크게 쓴다.
    subtitle: {
      fontScale: 0.045,
      color: '#FFE066',
      background: 'outline',
      backgroundOpacity: 0.6,
      verticalPosition: 0.3,
    },
    maxSeconds: 180,
  },
  {
    id: 'reels',
    label: '릴스',
    hint: '인스타그램 릴스 · 세로 9:16 · 3분 이하',
    export: { aspectRatio: '9:16', fitMode: 'blur', resolution: 1080, quality: 'high' },
    subtitle: {
      fontScale: 0.04,
      color: '#FFFFFF',
      background: 'box',
      backgroundOpacity: 0.6,
      verticalPosition: 0.28,
    },
    maxSeconds: 180,
  },
  {
    id: 'youtube',
    label: '유튜브',
    hint: '일반 영상 · 가로 16:9 · 고화질',
    export: { aspectRatio: '16:9', fitMode: 'blur', resolution: 1080, quality: 'high' },
    subtitle: {
      fontScale: 0.06,
      color: '#FFFFFF',
      background: 'outline',
      backgroundOpacity: 0.6,
      verticalPosition: 0.08,
    },
    maxSeconds: null,
  },
  {
    id: 'vlog',
    label: '브이로그',
    hint: '가로 16:9 · 차분한 반투명 자막',
    export: { aspectRatio: '16:9', fitMode: 'blur', resolution: 1080, quality: 'medium' },
    subtitle: {
      fontScale: 0.045,
      color: '#FFFFFF',
      background: 'box',
      backgroundOpacity: 0.35,
      verticalPosition: 0.06,
    },
    maxSeconds: null,
  },
]

const close = (a: number, b: number) => Math.abs(a - b) < 0.001

/** 지금 설정이 어느 템플릿과 같은가. 하나라도 손으로 바꿨으면 null */
export function matchTemplate(setting: ExportSetting, style: SubtitleStyle): Template | null {
  return (
    TEMPLATES.find(
      (template) =>
        template.export.aspectRatio === setting.aspectRatio &&
        template.export.fitMode === setting.fitMode &&
        template.export.resolution === setting.resolution &&
        template.export.quality === setting.quality &&
        close(template.subtitle.fontScale, style.fontScale) &&
        template.subtitle.color.toUpperCase() === style.color.toUpperCase() &&
        template.subtitle.background === style.background &&
        close(template.subtitle.backgroundOpacity, style.backgroundOpacity) &&
        close(template.subtitle.verticalPosition, style.verticalPosition),
    ) ?? null
  )
}
