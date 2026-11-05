import { useMemo } from 'react'
import { useProject } from '../lib/project/store'
import { segmentAt, sourceTimeAt, toSegments } from '../lib/project/playback'
import { STICKERS, shapeOf } from '../lib/media/stickers'
import { formatClock } from '../lib/format'
import { DeleteIcon } from './icons'
import { btn } from './m3'

/**
 * 순간 효과와 스티커 (FR-048).
 *
 * 자막처럼 "지금 보이는 장면"에 넣는다. 재생헤드를 강조하고 싶은 순간에 두고
 * 누르면 그 자리에 들어간다. 목록은 지금 클립 것만 보여 준다 — 영상 전체를
 * 늘어놓으면 어느 장면 것인지 알기 어렵다.
 */
export function EffectsPanel() {
  const timeline = useProject((state) => state.timeline)
  const playhead = useProject((state) => state.playhead)
  const addMoment = useProject((state) => state.addMoment)
  const addSticker = useProject((state) => state.addSticker)
  const updateSticker = useProject((state) => state.updateSticker)
  const removeOverlay = useProject((state) => state.removeOverlay)
  const setPlayhead = useProject((state) => state.setPlayhead)

  const segments = useMemo(() => toSegments(timeline), [timeline])
  const segment = segmentAt(segments, playhead)
  const item = segment?.item
  const usable = item !== undefined && item.type !== 'audio'
  /** 원본 시각을 타임라인 시각으로. 목록에서 눌러 그 자리로 가려고 쓴다. */
  const toTimeline = (time: number) =>
    segment ? segment.start + (time - sourceTimeAt(segment, segment.start)) : 0

  return (
    <div className="flex flex-col gap-4" data-testid="effects-panel">
      <div className="flex flex-col gap-2">
        <span className="mx-1 m3-label-large text-on-surface">순간 효과</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="add-shake"
            disabled={!usable}
            className={btn.tonal}
            onClick={() => addMoment('shake')}
          >
            지금 위치에 흔들림
          </button>
          <button
            type="button"
            data-testid="add-flash"
            disabled={!usable}
            className={btn.tonal}
            onClick={() => addMoment('flash')}
          >
            지금 위치에 번쩍
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="mx-1 m3-label-large text-on-surface">스티커</span>
        <div className="flex flex-wrap gap-2">
          {STICKERS.map((shape) => (
            <button
              key={shape.kind}
              type="button"
              data-testid={`add-sticker-${shape.kind}`}
              aria-label={`${shape.label} 스티커 넣기`}
              title={shape.label}
              disabled={!usable}
              onClick={() => addSticker(shape.kind)}
              className="state-layer flex h-12 w-12 items-center justify-center rounded-m3-md border border-outline-variant disabled:opacity-38"
            >
              <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden>
                <path
                  d={shape.path}
                  fill={shape.color}
                  fillRule={shape.evenOdd ? 'evenodd' : 'nonzero'}
                />
              </svg>
            </button>
          ))}
        </div>
        <span className="mx-1 m3-body-small text-on-surface-variant">
          재생헤드 자리에 2초 동안 들어갑니다. 미리보기에서 끌어 옮길 수 있습니다.
        </span>
      </div>

      {item && ((item.moments?.length ?? 0) > 0 || (item.stickers?.length ?? 0) > 0) && (
        <ul
          data-testid="overlay-list"
          className="flex flex-col gap-0.5 overflow-hidden rounded-m3-lg"
        >
          {(item.moments ?? []).map((moment) => (
            <li
              key={moment.id}
              data-testid="moment-row"
              className="flex items-center gap-3 bg-surface-container px-4 py-2"
            >
              <button
                type="button"
                className={`${btn.tonal} h-8 px-3 tabular-nums`}
                onClick={() => setPlayhead(toTimeline(moment.time))}
              >
                {formatClock(toTimeline(moment.time))}
              </button>
              <span className="flex-1 m3-body-medium">
                {moment.kind === 'shake' ? '흔들림' : '번쩍'}
              </span>
              <button
                type="button"
                data-testid="overlay-remove"
                aria-label="지우기"
                className={`${btn.icon} h-11 w-11`}
                onClick={() => removeOverlay(item.id, moment.id)}
              >
                <DeleteIcon size={22} />
              </button>
            </li>
          ))}
          {(item.stickers ?? []).map((sticker) => (
            <li
              key={sticker.id}
              data-testid="sticker-row"
              className="flex flex-wrap items-center gap-3 bg-surface-container px-4 py-2"
            >
              <button
                type="button"
                className={`${btn.tonal} h-8 px-3 tabular-nums`}
                onClick={() => setPlayhead(toTimeline(sticker.start))}
              >
                {formatClock(toTimeline(sticker.start))}
              </button>
              <span className="m3-body-medium">{shapeOf(sticker.kind).label}</span>
              <label className="flex flex-1 items-center gap-2 m3-body-small text-on-surface-variant">
                크기
                <input
                  data-testid="sticker-size"
                  type="range"
                  min={6}
                  max={50}
                  value={Math.round(sticker.size * 100)}
                  onChange={(event) =>
                    updateSticker(item.id, sticker.id, { size: Number(event.target.value) / 100 })
                  }
                  className="h-10 min-w-[100px] flex-1 accent-primary"
                />
              </label>
              <button
                type="button"
                data-testid="overlay-remove"
                aria-label="지우기"
                className={`${btn.icon} h-11 w-11`}
                onClick={() => removeOverlay(item.id, sticker.id)}
              >
                <DeleteIcon size={22} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
