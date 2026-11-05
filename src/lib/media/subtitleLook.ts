import { splitWords } from '../autocaption/lines'
import type {
  Subtitle,
  SubtitleAnimation,
  SubtitlePreset,
  SubtitleStyle,
  SubtitleWord,
} from '../project/types'

/**
 * 특수자막의 모양·움직임 계산 (FR-046).
 *
 * 미리보기는 DOM, 내보내기는 캔버스로 그린다. 둘이 각자 계산하면 미리보기와
 * 결과물이 달라지므로, 숫자는 모두 여기서 정하고 양쪽은 받아 그리기만 한다.
 * 크기는 전부 글자 크기에 대한 비율이라 화면 크기와 상관없이 같은 모양이 된다.
 */

export interface SubtitleLook {
  fill: string
  /** 외곽선 색. null 이면 없음 */
  stroke: string | null
  /** 외곽선 두께(글자 크기 대비) */
  strokeWidth: number
  /** 빛 번짐 색. null 이면 없음 */
  glow: string | null
  /** 배경 상자 색(rgba). null 이면 없음 */
  box: string | null
  /** 배경 상자 모서리(글자 크기 대비) */
  boxRadius: number
  weight: number
  /** 단어 강조색 */
  accent: string
  /** 프로젝트 글자 크기에 곱하는 배율 */
  sizeScale: number
}

export const PRESETS: { value: SubtitlePreset; label: string }[] = [
  { value: 'basic', label: '기본' },
  { value: 'variety', label: '예능' },
  { value: 'neon', label: '네온' },
  { value: 'news', label: '뉴스' },
  { value: 'bubble', label: '말풍선' },
]

export const ANIMATIONS: { value: SubtitleAnimation; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'fade', label: '서서히' },
  { value: 'pop', label: '톡' },
  { value: 'slide', label: '올라오기' },
  { value: 'typing', label: '타자' },
]

export function lookOf(style: SubtitleStyle, preset: SubtitlePreset = 'basic'): SubtitleLook {
  switch (preset) {
    case 'variety':
      // 예능 자막: 두꺼운 검은 테두리와 굵은 글씨로 어떤 장면 위에서도 튄다.
      return {
        fill: '#FFFFFF',
        stroke: '#000000',
        strokeWidth: 0.22,
        glow: null,
        box: null,
        boxRadius: 0,
        weight: 800,
        accent: '#FF5A5F',
        sizeScale: 1.2,
      }
    case 'neon':
      return {
        fill: '#FFFFFF',
        stroke: null,
        strokeWidth: 0,
        glow: '#00E5FF',
        box: null,
        boxRadius: 0,
        weight: 700,
        accent: '#FF4FD8',
        sizeScale: 1,
      }
    case 'news':
      return {
        fill: '#FFFFFF',
        stroke: null,
        strokeWidth: 0,
        glow: null,
        box: 'rgba(20, 40, 120, 0.92)',
        boxRadius: 0,
        weight: 700,
        accent: '#FFE066',
        sizeScale: 1,
      }
    case 'bubble':
      return {
        fill: '#2B2130',
        stroke: null,
        strokeWidth: 0,
        glow: null,
        box: 'rgba(255, 255, 255, 0.94)',
        boxRadius: 0.6,
        weight: 700,
        accent: '#FF7A59',
        sizeScale: 1,
      }
    default: {
      const yellow = style.color.toUpperCase() === '#FFE066'
      return {
        fill: style.color,
        stroke: style.background === 'outline' ? '#000000' : null,
        strokeWidth: 0.12,
        glow: null,
        box: style.background === 'box' ? `rgba(0, 0, 0, ${style.backgroundOpacity})` : null,
        boxRadius: 0.15,
        weight: 600,
        // 글자가 이미 노란색이면 강조가 안 보이므로 하늘색으로 바꾼다.
        accent: yellow ? '#7CE7FF' : '#FFE066',
        sizeScale: 1,
      }
    }
  }
}

export interface SubtitleFrame {
  opacity: number
  scale: number
  /** 아래로 밀린 정도(글자 크기 대비) */
  offsetY: number
  /** 보이는 글자 수. 타자 효과가 아니면 Infinity */
  visibleChars: number
}

/** 등장에 걸리는 시간. 짧은 자막에서는 길이의 절반을 넘지 않는다. */
const ENTER_SECONDS = 0.35

const easeOut = (p: number) => 1 - (1 - p) ** 3
/** 살짝 지나쳤다 돌아오는 곡선. '톡' 튀어나오는 느낌을 낸다. */
const easeOutBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2

export function frameAt(
  subtitle: Pick<Subtitle, 'start' | 'end' | 'text' | 'effect'>,
  time: number,
): SubtitleFrame {
  const animation = subtitle.effect?.animation ?? 'none'
  const length = Math.max(0.01, subtitle.end - subtitle.start)
  const enter = Math.min(ENTER_SECONDS, length / 2)
  const p = Math.min(1, Math.max(0, (time - subtitle.start) / enter))
  const base: SubtitleFrame = { opacity: 1, scale: 1, offsetY: 0, visibleChars: Infinity }

  switch (animation) {
    case 'fade': {
      // 사라질 때도 같은 시간 동안 흐려진다. 다음 자막과 겹쳐 보이지 않게.
      const out = Math.min(1, Math.max(0, (subtitle.end - time) / enter))
      return { ...base, opacity: Math.min(easeOut(p), out) }
    }
    case 'pop':
      return { ...base, opacity: Math.min(1, p * 2), scale: 0.6 + 0.4 * easeOutBack(p) }
    case 'slide':
      return { ...base, opacity: easeOut(p), offsetY: (1 - easeOut(p)) * 0.8 }
    case 'typing': {
      // 길이의 60% 동안 다 치고 나머지는 읽을 시간으로 둔다. 최대 1.5초.
      const typing = Math.min(1.5, length * 0.6)
      const chars = [...subtitle.text].length
      const ratio = Math.min(1, Math.max(0, (time - subtitle.start) / typing))
      return { ...base, visibleChars: Math.ceil(chars * ratio) }
    }
    default:
      return base
  }
}

/**
 * 글자마다 칠할 색. 강조를 켜면 지금 말하는 단어만 강조색이 된다.
 *
 * 자동 자막은 단어 시각을 갖고 있고, 손으로 쓴 자막은 길이를 글자 수로 나눠
 * 추정한다. 글자를 고쳐 단어 수가 달라졌으면 추정으로 돌아간다.
 */
export function charColors(
  subtitle: Pick<Subtitle, 'start' | 'end' | 'text' | 'words' | 'effect'>,
  look: SubtitleLook,
  time: number,
): string[] {
  const chars = [...subtitle.text]
  if (!subtitle.effect?.highlight) return chars.map(() => look.fill)

  const tokens = subtitle.text.split(/\s+/).filter(Boolean)
  const words: SubtitleWord[] =
    subtitle.words && subtitle.words.length === tokens.length
      ? subtitle.words
      : splitWords(subtitle.text, subtitle.start, subtitle.end)

  let active = -1
  words.forEach((word, index) => {
    if (word.start <= time) active = index
  })

  const colors: string[] = []
  let wordIndex = -1
  let inWord = false
  for (const char of chars) {
    const space = /\s/.test(char)
    if (!space && !inWord) wordIndex += 1
    inWord = !space
    colors.push(!space && wordIndex === active ? look.accent : look.fill)
  }
  return colors
}

/** 같은 색·보임 상태로 이어지는 글자 묶음. 그리기 횟수를 줄인다. */
export interface CharRun {
  text: string
  color: string
  visible: boolean
}

export function toRuns(
  chars: string[],
  colors: string[],
  from: number,
  visibleChars: number,
): CharRun[] {
  const runs: CharRun[] = []
  chars.forEach((char, offset) => {
    const index = from + offset
    const color = colors[index] ?? colors[colors.length - 1]
    const visible = index < visibleChars
    const last = runs[runs.length - 1]
    if (last && last.color === color && last.visible === visible) last.text += char
    else runs.push({ text: char, color, visible })
  })
  return runs
}

/** 자막의 화면 속 위치. 가운데 x, 아래에서부터 y (비율). */
export function anchorOf(
  subtitle: Pick<Subtitle, 'effect'>,
  style: SubtitleStyle,
): { x: number; y: number } {
  const position = subtitle.effect?.position
  if (!position) return { x: 0.5, y: style.verticalPosition }
  return clampAnchor(position)
}

/** 화면 밖으로 끌어내 자막을 잃어버리지 않게 가두어 둔다. */
export function clampAnchor(position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(0.85, Math.max(0.15, position.x)),
    y: Math.min(0.92, Math.max(0.02, position.y)),
  }
}
