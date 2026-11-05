import { useRef, useState } from 'react'
import type { Sticker, TimelineItem } from '../lib/project/types'
import { shapeOf, stickersAt } from '../lib/media/stickers'

const clamp = (value: number) => Math.min(0.95, Math.max(0.05, value))

/**
 * 미리보기 스티커 (FR-048).
 *
 * 내보내기의 drawStickers 와 같은 경로·크기 규칙으로 그린다. 멈췄을 때는
 * 끌어 옮길 수 있고, 손을 뗄 때 한 번만 저장한다(되돌리기 한 번).
 */
export function StickerLayer({
  item,
  sourceTime,
  onMove,
}: {
  item: TimelineItem
  sourceTime: number
  onMove?: (sticker: Sticker, position: { x: number; y: number }) => void
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: string; px: number; py: number; x: number; y: number } | null>(null)
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null)
  const visible = stickersAt(item, sourceTime)
  if (visible.length === 0) return null

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0" aria-hidden>
      {visible.map((sticker) => {
        const shape = shapeOf(sticker.kind)
        const position = moving?.id === sticker.id ? moving : sticker
        return (
          <svg
            key={sticker.id}
            data-testid="preview-sticker"
            data-kind={sticker.kind}
            data-x={position.x.toFixed(3)}
            data-y={position.y.toFixed(3)}
            viewBox="0 0 24 24"
            className={`absolute -translate-x-1/2 -translate-y-1/2 ${
              onMove ? 'pointer-events-auto cursor-move touch-none' : ''
            }`}
            style={{
              left: `${position.x * 100}%`,
              top: `${position.y * 100}%`,
              width: `${sticker.size * 100}cqh`,
              height: `${sticker.size * 100}cqh`,
              filter: 'drop-shadow(0 0.02em 0.05em rgba(0,0,0,0.45))',
            }}
            onPointerDown={
              onMove
                ? (event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    drag.current = {
                      id: sticker.id,
                      px: event.clientX,
                      py: event.clientY,
                      x: sticker.x,
                      y: sticker.y,
                    }
                    setMoving({ id: sticker.id, x: sticker.x, y: sticker.y })
                  }
                : undefined
            }
            onPointerMove={(event) => {
              const start = drag.current
              const box = layerRef.current?.getBoundingClientRect()
              if (!start || !box) return
              setMoving({
                id: start.id,
                x: clamp(start.x + (event.clientX - start.px) / box.width),
                y: clamp(start.y + (event.clientY - start.py) / box.height),
              })
            }}
            onPointerUp={() => {
              const start = drag.current
              if (start && moving && (moving.x !== start.x || moving.y !== start.y)) {
                onMove?.(sticker, { x: moving.x, y: moving.y })
              }
              drag.current = null
              setMoving(null)
            }}
            onPointerCancel={() => {
              drag.current = null
              setMoving(null)
            }}
          >
            <path
              d={shape.path}
              fill={shape.color}
              fillRule={shape.evenOdd ? 'evenodd' : 'nonzero'}
            />
          </svg>
        )
      })}
    </div>
  )
}
