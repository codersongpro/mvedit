import type { Subtitle, SubtitleStyle } from '../project/types'
import { anchorOf, charColors, fontOf, frameAt, lookOf, toRuns } from './subtitleLook'
import { captionFont, fontStack, nearestWeight } from './captionFonts'

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * 자막을 캔버스에 그린다 (FR-037, FR-046).
 *
 * 미리보기는 DOM 으로, 내보내기는 캔버스로 그리지만 **모양·움직임 계산은
 * subtitleLook 하나**를 쓴다. 크기는 화면 높이에 대한 비율로만 정하기 때문에,
 * 미리보기에서 본 자막이 결과물에서 다른 크기로 나오지 않는다.
 */
export function drawSubtitle(
  context: Context,
  subtitle: Pick<Subtitle, 'text' | 'start' | 'end' | 'words' | 'effect'>,
  style: SubtitleStyle,
  width: number,
  height: number,
  /** 원본 시간축 기준 지금 시각. 등장 효과와 단어 강조에 쓴다. */
  time: number,
): void {
  const text = subtitle.text.trim()
  if (!text) return

  const look = lookOf(style, subtitle.effect?.preset)
  const frame = frameAt(subtitle, time)
  if (frame.opacity <= 0) return

  const fontId = fontOf(subtitle, style)
  const fontSize = Math.max(
    8,
    style.fontScale * look.sizeScale * (captionFont(fontId).scale ?? 1) * height,
  )
  const lineHeight = fontSize * 1.3
  // 좌우 5% 는 미리보기의 px-[5%] 와 같은 여백이다.
  const maxWidth = width * 0.9

  context.save()
  context.font = `${nearestWeight(fontId, look.weight)} ${fontSize}px ${fontStack(fontId)}`
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'

  // 색은 다듬기 전 원문 기준으로 매기므로, 앞 공백만큼 밀어 맞춘다.
  const lead = [...subtitle.text].length - [...subtitle.text.trimStart()].length
  const colors = charColors(subtitle, look, time).slice(lead)
  const lines = wrapLines(context, text, maxWidth)
  const anchor = anchorOf(subtitle, style)
  const centerX = anchor.x * width
  // y 는 아래에서부터의 비율. 마지막 줄의 아랫선을 기준으로 잡는다.
  const bottom = height - anchor.y * height + frame.offsetY * fontSize
  const firstBaseline = bottom - (lines.length - 1) * lineHeight
  const blockTop = firstBaseline - fontSize
  const blockHeight = (lines.length - 1) * lineHeight + fontSize

  context.globalAlpha = frame.opacity
  if (frame.scale !== 1) {
    // 글자 덩어리 가운데를 중심으로 키우고 줄인다.
    const cy = blockTop + blockHeight / 2
    context.translate(centerX, cy)
    context.scale(frame.scale, frame.scale)
    context.translate(-centerX, -cy)
  }

  if (look.box) {
    const widest = Math.max(...lines.map((line) => context.measureText(line.text).width))
    const padX = fontSize * 0.4
    const padY = fontSize * 0.25
    context.fillStyle = look.box
    roundRect(
      context,
      centerX - widest / 2 - padX,
      blockTop - padY,
      widest + padX * 2,
      blockHeight + padY * 2,
      look.boxRadius * fontSize,
    )
    context.fill()
  }

  for (const [index, line] of lines.entries()) {
    const y = firstBaseline + index * lineHeight
    let x = centerX - context.measureText(line.text).width / 2
    for (const run of toRuns([...line.text], colors, line.from, frame.visibleChars)) {
      const runWidth = context.measureText(run.text).width
      if (run.visible) {
        if (look.stroke) {
          // 밝은 배경에서도 글자가 읽히도록 외곽선을 두른다.
          context.lineJoin = 'round'
          context.lineWidth = Math.max(2, fontSize * look.strokeWidth)
          context.strokeStyle = look.stroke
          context.strokeText(run.text, x, y)
        }
        context.fillStyle = run.color
        if (look.glow) {
          context.shadowColor = look.glow
          context.shadowBlur = fontSize * 0.45
          // 한 번만 그리면 번짐이 옅어 두 번 겹친다.
          context.fillText(run.text, x, y)
        }
        context.fillText(run.text, x, y)
        context.shadowBlur = 0
      }
      x += runWidth
    }
  }

  context.restore()
}

function roundRect(context: Context, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, h / 2, w / 2)
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + w, y, x + w, y + h, radius)
  context.arcTo(x + w, y + h, x, y + h, radius)
  context.arcTo(x, y + h, x, y, radius)
  context.arcTo(x, y, x + w, y, radius)
  context.closePath()
}

interface Line {
  text: string
  /** 원문(다듬은 뒤)에서 이 줄 첫 글자의 위치. 글자별 색을 찾는 데 쓴다. */
  from: number
}

/** 줄바꿈 문자를 지키면서, 너무 긴 줄은 폭에 맞춰 나눈다. */
function wrapLines(context: Context, text: string, maxWidth: number): Line[] {
  const result: Line[] = []
  let index = 0

  for (const paragraph of text.split('\n')) {
    let line = ''
    let from = index
    // 한국어는 단어 사이 공백이 드물어 글자 단위로 넘긴다.
    for (const char of paragraph) {
      const candidate = line + char
      if (context.measureText(candidate).width > maxWidth && line !== '') {
        result.push({ text: line, from })
        line = char
        from = index
      } else {
        line = candidate
      }
      index += 1
    }
    result.push({ text: line, from })
    index += 1 // 줄바꿈 문자
  }

  // 자막이 화면을 다 덮으면 영상이 안 보인다. 세 줄까지만 쓴다.
  return result.slice(0, 3)
}
