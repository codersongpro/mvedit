import type { SubtitleStyle } from '../lib/project/types'

/**
 * 미리보기와 내보내기가 같은 규칙으로 자막을 그리도록, 화면 높이에 대한
 * 비율로만 크기를 정한다. 픽셀로 정하면 미리보기와 결과물이 달라진다.
 */
export function SubtitleOverlay({
  text,
  style,
}: {
  text: string
  style: SubtitleStyle
}) {
  if (!text.trim()) return null

  const outline =
    style.background === 'outline'
      ? { textShadow: '0 1px 2px #000, 0 -1px 2px #000, 1px 0 2px #000, -1px 0 2px #000' }
      : undefined

  const box =
    style.background === 'box'
      ? { backgroundColor: `rgba(0, 0, 0, ${style.backgroundOpacity})` }
      : undefined

  return (
    <div
      data-testid="subtitle-overlay"
      className="pointer-events-none absolute inset-x-0 flex justify-center px-[5%]"
      style={{ bottom: `${style.verticalPosition * 100}%` }}
    >
      <span
        className="rounded px-2 py-0.5 text-center leading-snug font-semibold whitespace-pre-line"
        style={{
          color: style.color,
          // 컨테이너 높이의 비율로 잡아야 미리보기와 결과물이 같아진다.
          fontSize: `${style.fontScale * 100}cqh`,
          ...outline,
          ...box,
        }}
      >
        {text}
      </span>
    </div>
  )
}
