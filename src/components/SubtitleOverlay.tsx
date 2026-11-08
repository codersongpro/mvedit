import { useRef, useState } from 'react'
import type { Subtitle, SubtitleStyle } from '../lib/project/types'
import {
  anchorOf,
  charColors,
  clampAnchor,
  frameAt,
  lookOf,
  fontOf,
  toRuns,
  type SubtitleLook,
} from '../lib/media/subtitleLook'
import { captionFont, fontStack, nearestWeight } from '../lib/media/captionFonts'

/** 외곽선을 여덟 방향 그림자로 흉내 낸다. 캔버스의 strokeText 와 두께를 맞춘다. */
function strokeShadow(look: SubtitleLook): string | undefined {
  const shadows: string[] = []
  if (look.stroke) {
    const w = `${(look.strokeWidth / 2).toFixed(3)}em`
    for (const [x, y] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.7, 0.7],
      [-0.7, 0.7],
      [0.7, -0.7],
      [-0.7, -0.7],
    ]) {
      shadows.push(`calc(${x} * ${w}) calc(${y} * ${w}) 0 ${look.stroke}`)
    }
  }
  if (look.glow) shadows.push(`0 0 0.45em ${look.glow}`, `0 0 0.2em ${look.glow}`)
  return shadows.length ? shadows.join(', ') : undefined
}

/**
 * 미리보기 자막 (FR-034, FR-046).
 *
 * 미리보기와 내보내기가 같은 규칙으로 자막을 그리도록, 모양·움직임은
 * subtitleLook 에서 받아 쓰고 크기는 화면 높이에 대한 비율로만 정한다.
 *
 * `onMove` 를 주면 끌어서 옮길 수 있다. 끄는 동안에는 화면에서만 옮기고
 * 손을 뗄 때 한 번만 저장한다. 움직일 때마다 저장하면 되돌리기 기록이
 * 수백 개 쌓여 되돌리기를 한참 눌러야 한다.
 */
export function SubtitleOverlay({
  subtitle,
  style,
  time,
  onMove,
}: {
  subtitle: Pick<Subtitle, 'text' | 'start' | 'end' | 'words' | 'effect'>
  style: SubtitleStyle
  time: number
  onMove?: (position: { x: number; y: number }) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null)
  /** 누른 곳과 자막 기준점의 차이를 지켜야 손가락 아래로 자막이 튀지 않는다. */
  const dragStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  if (!subtitle.text.trim()) return null

  const look = lookOf(style, subtitle.effect?.preset)
  const fontId = fontOf(subtitle, style)
  const frame = frameAt(subtitle, time)
  const anchor = dragging ?? anchorOf(subtitle, style)
  const chars = [...subtitle.text]
  const runs = toRuns(chars, charColors(subtitle, look, time), 0, frame.visibleChars)

  const frameSize = () => containerRef.current?.parentElement?.getBoundingClientRect() ?? null

  return (
    <div
      ref={containerRef}
      data-testid="subtitle-overlay"
      data-x={anchor.x.toFixed(3)}
      data-y={anchor.y.toFixed(3)}
      className="pointer-events-none absolute flex w-[90%] -translate-x-1/2 justify-center"
      style={{ left: `${anchor.x * 100}%`, bottom: `${anchor.y * 100}%` }}
    >
      <span
        data-testid="subtitle-overlay-text"
        className={`text-center leading-snug whitespace-pre-line ${
          onMove ? 'pointer-events-auto cursor-move touch-none select-none' : ''
        }`}
        style={{
          color: look.fill,
          fontFamily: fontStack(fontId),
          fontWeight: nearestWeight(fontId, look.weight),
          // 컨테이너 높이의 비율로 잡아야 미리보기와 결과물이 같아진다.
          fontSize: `${style.fontScale * look.sizeScale * (captionFont(fontId).scale ?? 1) * 100}cqh`,
          textShadow: strokeShadow(look),
          backgroundColor: look.box ?? undefined,
          borderRadius: look.box ? `${look.boxRadius}em` : undefined,
          padding: look.box ? '0.25em 0.4em' : '0.125em 0.5em',
          opacity: frame.opacity,
          transform: `translateY(${frame.offsetY}em) scale(${frame.scale})`,
          transformOrigin: 'center',
        }}
        onPointerDown={
          onMove
            ? (event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                const origin = anchorOf(subtitle, style)
                dragStart.current = { px: event.clientX, py: event.clientY, ...origin }
                setDragging(origin)
              }
            : undefined
        }
        onPointerMove={
          onMove
            ? (event) => {
                const start = dragStart.current
                const box = frameSize()
                if (!start || !box) return
                setDragging(
                  clampAnchor({
                    x: start.x + (event.clientX - start.px) / box.width,
                    y: start.y - (event.clientY - start.py) / box.height,
                  }),
                )
              }
            : undefined
        }
        onPointerUp={
          onMove
            ? () => {
                // 그냥 누르기만 했으면 위치를 고정하지 않는다.
                const start = dragStart.current
                if (dragging && start && (dragging.x !== start.x || dragging.y !== start.y)) {
                  onMove(dragging)
                }
                dragStart.current = null
                setDragging(null)
              }
            : undefined
        }
        onPointerCancel={() => {
          dragStart.current = null
          setDragging(null)
        }}
      >
        {runs.map((run, index) => (
          <span
            key={index}
            style={{
              color: run.color,
              visibility: run.visible ? undefined : 'hidden',
            }}
          >
            {run.text}
          </span>
        ))}
      </span>
    </div>
  )
}
