import type { Moment, Sticker, StickerKind, TimelineItem } from '../project/types'
import { usesSourceTime } from '../project/types'

/**
 * 스티커와 순간 효과 (FR-048).
 *
 * 스티커는 그림 파일이 아니라 24×24 경로(Path2D)로 둔다. 내보내기 워커에서는
 * SVG 그림을 읽을 수 없고, 이모지는 기기마다 글꼴이 달라 미리보기와 결과물이
 * 달라진다. 경로는 DOM(svg)과 캔버스(Path2D)가 똑같이 그린다.
 */

export interface StickerShape {
  kind: StickerKind
  label: string
  path: string
  color: string
  /** 가운데가 뚫린 고리처럼 겹친 경로를 구멍으로 칠할 때 */
  evenOdd?: boolean
}

export const STICKERS: StickerShape[] = [
  {
    kind: 'heart',
    label: '하트',
    color: '#FF4D6D',
    path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  },
  {
    kind: 'star',
    label: '별',
    color: '#FFD23F',
    path: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  },
  {
    kind: 'arrow',
    label: '화살표',
    color: '#FF6A1F',
    path: 'M4 10h10V5l8 7-8 7v-5H4z',
  },
  {
    kind: 'check',
    label: '체크',
    color: '#22C55E',
    path: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  },
  {
    kind: 'alert',
    label: '느낌표',
    color: '#FF3B30',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  },
  {
    kind: 'question',
    label: '물음표',
    color: '#3B82F6',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
  },
  {
    kind: 'ring',
    label: '동그라미',
    color: '#FF3B30',
    evenOdd: true,
    path: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 4.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15z',
  },
  {
    kind: 'sparkle',
    label: '반짝',
    color: '#FFE066',
    path: 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z',
  },
]

export function shapeOf(kind: StickerKind): StickerShape {
  return STICKERS.find((shape) => shape.kind === kind) ?? STICKERS[0]
}

export const DEFAULT_STICKER_SECONDS = 2
export const DEFAULT_STICKER_SIZE = 0.18

/** 클립 안 offset 이 원본 시간축으로 몇 초인가. 자막과 같은 축을 쓴다. */
export function sourceTimeOf(item: TimelineItem, offset: number): number {
  return usesSourceTime(item) ? item.inPoint + offset : offset
}

export function stickersAt(item: TimelineItem, sourceTime: number): Sticker[] {
  return (item.stickers ?? []).filter(
    (sticker) => sticker.start <= sourceTime && sourceTime < sticker.end,
  )
}

export const MOMENT_SECONDS: Record<Moment['kind'], number> = { shake: 0.5, flash: 0.35 }

/**
 * 그 시각에 걸리는 순간 효과. 흔들림은 화면 이동, 번쩍은 흰 덮개다.
 * 흔들림은 무작위가 아니라 사인파라서 미리보기와 결과물이 프레임마다 같다.
 */
export function momentFxAt(
  item: TimelineItem,
  sourceTime: number,
): { translateX: number; translateY: number; flash: number } {
  let translateX = 0
  let translateY = 0
  let flash = 0
  for (const moment of item.moments ?? []) {
    const dt = sourceTime - moment.time
    const length = MOMENT_SECONDS[moment.kind]
    if (dt < 0 || dt >= length) continue
    const fall = 1 - dt / length
    if (moment.kind === 'shake') {
      translateX += 0.03 * fall * Math.sin(2 * Math.PI * 22 * dt)
      translateY += 0.02 * fall * Math.cos(2 * Math.PI * 17 * dt)
    } else {
      flash = Math.max(flash, fall)
    }
  }
  return { translateX, translateY, flash }
}

/** 캔버스에 스티커를 그린다. 그림자를 둘러 밝은 화면에서도 보이게 한다. */
export function drawStickers(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  stickers: Sticker[],
  width: number,
  height: number,
): void {
  for (const sticker of stickers) {
    const shape = shapeOf(sticker.kind)
    const size = sticker.size * height
    context.save()
    context.translate(sticker.x * width - size / 2, sticker.y * height - size / 2)
    context.scale(size / 24, size / 24)
    context.shadowColor = 'rgba(0, 0, 0, 0.45)'
    context.shadowBlur = 1.2
    context.shadowOffsetY = 0.4
    context.fillStyle = shape.color
    context.fill(new Path2D(shape.path), shape.evenOdd ? 'evenodd' : 'nonzero')
    context.restore()
  }
}

/**
 * 클립을 자를 때 순간 효과와 스티커를 양쪽으로 나눈다 (자막과 같은 규칙).
 *
 * 걸친 스티커는 양쪽에 하나씩 남긴다. 사진·빈 화면처럼 0부터 시작하는 축은
 * 오른쪽 조각의 시각을 자른 만큼 당긴다.
 */
export function splitOverlays(
  item: TimelineItem,
  cut: number,
): {
  left: Pick<TimelineItem, 'moments' | 'stickers'>
  right: Pick<TimelineItem, 'moments' | 'stickers'>
} {
  const shift = usesSourceTime(item) ? 0 : cut
  const moments = item.moments ?? []
  const stickers = item.stickers ?? []
  return {
    left: {
      moments: moments.filter((moment) => moment.time < cut),
      stickers: stickers
        .filter((sticker) => sticker.start < cut)
        .map((sticker) => ({ ...sticker, end: Math.min(sticker.end, cut) })),
    },
    right: {
      moments: moments
        .filter((moment) => moment.time >= cut)
        .map((moment) => ({ ...moment, time: moment.time - shift })),
      stickers: stickers
        .filter((sticker) => sticker.end > cut)
        .map((sticker) => ({
          ...sticker,
          id: sticker.start < cut ? crypto.randomUUID() : sticker.id,
          start: Math.max(sticker.start, cut) - shift,
          end: sticker.end - shift,
        })),
    },
  }
}
