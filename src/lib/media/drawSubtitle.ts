import type { SubtitleStyle } from '../project/types'

/**
 * 자막을 캔버스에 그린다 (FR-037).
 *
 * 미리보기는 DOM 으로, 내보내기는 캔버스로 그리지만 **크기와 위치 계산은
 * 같은 규칙**을 쓴다. 화면 높이에 대한 비율로만 정하기 때문에, 미리보기에서
 * 본 자막이 결과물에서 다른 크기로 나오지 않는다.
 */
export function drawSubtitle(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  style: SubtitleStyle,
  width: number,
  height: number,
): void {
  const trimmed = text.trim()
  if (!trimmed) return

  const fontSize = Math.max(8, style.fontScale * height)
  const lineHeight = fontSize * 1.3
  // 좌우 5% 는 미리보기의 px-[5%] 와 같은 여백이다.
  const maxWidth = width * 0.9

  context.save()
  context.font = `600 ${fontSize}px system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'

  const lines = wrapLines(context, trimmed, maxWidth)
  const centerX = width / 2
  // verticalPosition 은 아래에서부터의 비율. 마지막 줄의 아랫선을 기준으로 잡는다.
  const bottom = height - style.verticalPosition * height
  const firstBaseline = bottom - (lines.length - 1) * lineHeight

  if (style.background === 'box') {
    const widest = Math.max(...lines.map((line) => context.measureText(line).width))
    const padX = fontSize * 0.4
    const padY = fontSize * 0.25
    context.fillStyle = `rgba(0, 0, 0, ${style.backgroundOpacity})`
    context.fillRect(
      centerX - widest / 2 - padX,
      firstBaseline - fontSize - padY,
      widest + padX * 2,
      (lines.length - 1) * lineHeight + fontSize + padY * 2,
    )
  }

  lines.forEach((line, index) => {
    const y = firstBaseline + index * lineHeight
    if (style.background === 'outline') {
      // 밝은 배경에서도 글자가 읽히도록 검은 외곽선을 두른다.
      context.lineJoin = 'round'
      context.lineWidth = Math.max(2, fontSize * 0.12)
      context.strokeStyle = '#000000'
      context.strokeText(line, centerX, y)
    }
    context.fillStyle = style.color
    context.fillText(line, centerX, y)
  })

  context.restore()
}

/** 줄바꿈 문자를 지키면서, 너무 긴 줄은 폭에 맞춰 나눈다. */
function wrapLines(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const result: string[] = []

  for (const paragraph of text.split('\n')) {
    let line = ''
    // 한국어는 단어 사이 공백이 드물어 글자 단위로 넘긴다.
    for (const char of paragraph) {
      const candidate = line + char
      if (context.measureText(candidate).width > maxWidth && line !== '') {
        result.push(line)
        line = char
      } else {
        line = candidate
      }
    }
    result.push(line)
  }

  // 자막이 화면을 다 덮으면 영상이 안 보인다. 세 줄까지만 쓴다.
  return result.slice(0, 3)
}
