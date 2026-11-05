import type { FilterId, TimelineItem, TransitionId, ZoomId } from '../project/types'
import { itemDuration } from '../project/types'
import { fadeFactor, fadesOf } from '../project/playback'
import { momentFxAt, sourceTimeOf } from './stickers'

/**
 * 화면 특수효과 계산 (FR-047): 색감 필터·줌·화면 전환.
 *
 * 미리보기(CSS)와 내보내기(캔버스)가 같은 숫자를 쓰도록 여기서만 정한다.
 * 필터는 CSS filter 문법 하나로 적는다. 캔버스도 같은 문법(ctx.filter)을 받고,
 * 받지 못하는 브라우저를 위해 같은 연산을 색 행렬로도 풀어 둔다.
 */

export type { FilterId, TransitionId, ZoomId }

type FilterOp =
  | ['grayscale' | 'sepia' | 'saturate' | 'brightness' | 'contrast', number]
  | ['hue-rotate', number]

const FILTER_OPS: Record<FilterId, FilterOp[]> = {
  none: [],
  mono: [['grayscale', 1]],
  warm: [
    ['sepia', 0.25],
    ['saturate', 1.3],
    ['hue-rotate', -8],
  ],
  cool: [
    ['saturate', 1.1],
    ['hue-rotate', 12],
    ['brightness', 1.03],
  ],
  vivid: [
    ['saturate', 1.5],
    ['contrast', 1.15],
  ],
  vintage: [
    ['sepia', 0.5],
    ['contrast', 0.9],
    ['brightness', 1.05],
    ['saturate', 0.8],
  ],
}

export const FILTERS: { value: FilterId; label: string }[] = [
  { value: 'none', label: '원본' },
  { value: 'mono', label: '흑백' },
  { value: 'warm', label: '따뜻하게' },
  { value: 'cool', label: '차갑게' },
  { value: 'vivid', label: '선명하게' },
  { value: 'vintage', label: '빈티지' },
]

export const ZOOMS: { value: ZoomId; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'in', label: '천천히 확대' },
  { value: 'out', label: '천천히 축소' },
  { value: 'punch', label: '순간 확대' },
]

export const TRANSITIONS: { value: TransitionId; label: string }[] = [
  { value: 'black', label: '검정' },
  { value: 'white', label: '흰 번쩍' },
  { value: 'slide', label: '밀어내기' },
  { value: 'zoom', label: '확대' },
  { value: 'blur', label: '흐리게' },
]

export function filterCss(id: FilterId | undefined): string {
  const ops = FILTER_OPS[id ?? 'none'] ?? []
  if (ops.length === 0) return 'none'
  return ops
    .map(([name, value]) => `${name}(${value}${name === 'hue-rotate' ? 'deg' : ''})`)
    .join(' ')
}

/**
 * 같은 필터를 4×5 색 행렬(RGBA 행, 마지막 열은 0~1 더하기)로 푼다.
 * 수식은 Filter Effects 명세의 정의를 그대로 따른다. 캔버스 filter 를 못 쓰는
 * 브라우저에서 픽셀을 직접 바꿀 때 쓴다.
 */
export function filterMatrix(id: FilterId | undefined): number[] | null {
  const ops = FILTER_OPS[id ?? 'none'] ?? []
  if (ops.length === 0) return null
  let matrix = identity()
  for (const [name, value] of ops) matrix = multiply(opMatrix(name, value), matrix)
  return matrix
}

function identity(): number[] {
  return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
}

/** a·b (b 를 먼저 적용). 5번째 행은 [0 0 0 0 1] 로 본다. */
function multiply(a: number[], b: number[]): number[] {
  const out: number[] = []
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      let sum = col === 4 ? a[row * 5 + 4] : 0
      for (let k = 0; k < 4; k += 1) sum += a[row * 5 + k] * b[k * 5 + col]
      out.push(sum)
    }
  }
  return out
}

function rgb(m: number[]): number[] {
  return [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0]
}

// 3×3 행렬은 한 줄에 한 행씩 둬야 명세와 대조할 수 있다.
// prettier-ignore
function opMatrix(name: FilterOp[0], value: number): number[] {
  switch (name) {
    case 'grayscale': {
      const a = 1 - Math.min(1, value)
      return rgb([
        0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a,
      ])
    }
    case 'sepia': {
      const a = 1 - Math.min(1, value)
      return rgb([
        0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
        0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
        0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
      ])
    }
    case 'saturate': {
      const v = value
      return rgb([
        0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v,
      ])
    }
    case 'hue-rotate': {
      const r = (value * Math.PI) / 180
      const c = Math.cos(r)
      const n = Math.sin(r)
      return rgb([
        0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928,
        0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.14, 0.072 - c * 0.072 - n * 0.283,
        0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072,
      ])
    }
    case 'brightness':
      return rgb([value, 0, 0, 0, value, 0, 0, 0, value])
    case 'contrast': {
      const o = 0.5 - 0.5 * value
      return [
        value, 0, 0, 0, o,
        0, value, 0, 0, o,
        0, 0, value, 0, o,
        0, 0, 0, 1, 0,
      ]
    }
  }
}

/** 픽셀 배열(RGBA 0~255)에 색 행렬을 바로 적용한다. */
export function applyMatrix(data: Uint8ClampedArray, m: number[]): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    data[i] = m[0] * r + m[1] * g + m[2] * b + m[4] * 255
    data[i + 1] = m[5] * r + m[6] * g + m[7] * b + m[9] * 255
    data[i + 2] = m[10] * r + m[11] * g + m[12] * b + m[14] * 255
  }
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)

/** 줌 배율. 클립 길이 전체에 걸쳐 천천히, 또는 시작에서 순간적으로. */
export function zoomAt(item: TimelineItem, offset: number): number {
  const length = Math.max(0.01, itemDuration(item))
  const p = Math.min(1, Math.max(0, offset / length))
  switch (item.zoom) {
    case 'in':
      return 1 + 0.15 * easeInOut(p)
    case 'out':
      return 1.15 - 0.15 * easeInOut(p)
    case 'punch':
      // 0.15초 만에 확 다가가 그대로 머문다. 말의 강조점에 붙여 쓴다.
      return 1 + 0.25 * Math.min(1, offset / 0.15)
    default:
      return 1
  }
}

/** 한 프레임에 장면 전체에 거는 효과. 미리보기와 내보내기가 똑같이 해석한다. */
export interface SceneFx {
  filter: string
  scale: number
  /** 화면 너비 대비 가로 이동 */
  translateX: number
  /** 화면 높이 대비 세로 이동 */
  translateY: number
  /** 화면 높이 대비 흐림 반경 */
  blur: number
  /** 맨 위(자막 포함)에 덮는 색. 페이드·번쩍임 */
  overlay: string | null
  overlayAlpha: number
}

/**
 * 클립 안 offset 초 지점의 장면 효과.
 *
 * 전환은 클립의 페이드(FR-043) 구간을 그대로 쓰고 '어떻게 잦아드는가'만 바꾼다.
 * 두 클립을 겹치는 디졸브는 총 길이와 소리·자막 싱크를 모두 바꾸므로 넣지 않는다
 * (PRD 14절). 겹침이 없으니 길이도 그대로다.
 */
export function sceneFxAt(item: TimelineItem, offset: number): SceneFx {
  const fx = transitionFxAt(item, offset)
  // 흔들림·번쩍(FR-048)은 전환 위에 얹는다. 번쩍은 전환 덮개보다 밝을 때만 이긴다.
  const moment = momentFxAt(item, sourceTimeOf(item, offset))
  const flashWins = moment.flash > 0 && (fx.overlay === null || moment.flash >= fx.overlayAlpha)
  return {
    ...fx,
    translateX: fx.translateX + moment.translateX,
    translateY: fx.translateY + moment.translateY,
    ...(flashWins && { overlay: '#FFFFFF', overlayAlpha: moment.flash }),
  }
}

function transitionFxAt(item: TimelineItem, offset: number): SceneFx {
  const factor = fadeFactor(item, offset)
  const fx: SceneFx = {
    filter: filterCss(item.filter),
    scale: zoomAt(item, offset),
    translateX: 0,
    translateY: 0,
    blur: 0,
    overlay: null,
    overlayAlpha: 0,
  }
  if (factor >= 1) return fx

  const t = 1 - factor
  // 페이드 인 구간인지 아웃 구간인지에 따라 밀려 들어오고 나가는 방향이 다르다.
  const { fadeIn } = fadesOf(item)
  const entering = fadeIn > 0 && offset < fadeIn
  switch (item.transition ?? 'black') {
    case 'white':
      return { ...fx, overlay: '#FFFFFF', overlayAlpha: t }
    case 'slide':
      return { ...fx, translateX: entering ? t : -t }
    case 'zoom':
      return { ...fx, scale: fx.scale * (1 + 0.3 * t), overlay: '#000000', overlayAlpha: t }
    case 'blur':
      return { ...fx, blur: 0.04 * t, overlay: '#000000', overlayAlpha: t * 0.8 }
    default:
      return { ...fx, overlay: '#000000', overlayAlpha: t }
  }
}
