import { useCallback, useRef, useState } from 'react'
import { findSource, useProject } from '../lib/project/store'
import { MIN_CLIP_SECONDS, startOfIndex, type TrimEdge } from '../lib/project/edit'
import { itemDuration, timelineDuration, type MediaSource, type TimelineItem } from '../lib/project/types'
import { formatClock } from '../lib/format'

const MIN_PX_PER_SECOND = 4
const MAX_PX_PER_SECOND = 240
const DEFAULT_PX_PER_SECOND = 40
const TRACK_HEIGHT = 72

/**
 * 시간축은 철저히 선형으로 그린다. 짧은 클립을 보기 좋게 하려고 최소 폭을
 * 주면 화면 위치와 실제 시각이 어긋나 재생헤드 분할이 엉뚱한 곳을 자른다.
 * 짧은 클립 문제는 확대로 푼다.
 */
export function Timeline() {
  const timeline = useProject((state) => state.timeline)
  const sources = useProject((state) => state.sources)
  const playhead = useProject((state) => state.playhead)
  const selectedItemId = useProject((state) => state.selectedItemId)
  const select = useProject((state) => state.select)
  const setPlayhead = useProject((state) => state.setPlayhead)

  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND)
  const contentRef = useRef<HTMLDivElement>(null)

  const total = timelineDuration(timeline)

  // 스크롤 컨테이너가 아니라 시간축 내용 요소를 기준으로 잰다.
  // 컨테이너를 기준으로 하면 안쪽 여백만큼 재생헤드가 어긋난다.
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const content = contentRef.current
      if (!content) return
      setPlayhead((clientX - content.getBoundingClientRect().left) / pxPerSecond)
    },
    [pxPerSecond, setPlayhead],
  )

  if (timeline.length === 0) {
    return (
      <p className="rounded-xl bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        아직 타임라인이 비어 있습니다. 영상이나 사진을 추가해 주세요.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span data-testid="clip-count">클립 {timeline.length}개</span>
        <div className="flex items-center gap-3">
          <span data-testid="playhead-time" className="tabular-nums text-sky-300">
            {formatClock(playhead)}
          </span>
          <span data-testid="timeline-duration" className="tabular-nums">
            전체 {formatClock(total)}
          </span>
          <ZoomButtons pxPerSecond={pxPerSecond} onChange={setPxPerSecond} />
        </div>
      </div>

      <div
        data-testid="timeline"
        data-px-per-second={pxPerSecond}
        className="relative overflow-x-auto rounded-xl bg-slate-900/60 p-2"
      >
        <div
          ref={contentRef}
          className="relative"
          style={{ width: `${Math.max(total * pxPerSecond, 1)}px` }}
        >
          <Ruler total={total} pxPerSecond={pxPerSecond} onSeek={seekFromPointer} />

          <div className="relative flex" style={{ height: `${TRACK_HEIGHT}px` }}>
            {timeline.map((item, index) => (
              <Clip
                key={item.id}
                item={item}
                index={index}
                source={findSource(sources, item.sourceId)}
                pxPerSecond={pxPerSecond}
                selected={item.id === selectedItemId}
                onSelect={() => {
                  select(item.id)
                  // 클립을 고르면 재생헤드를 그 앞으로 옮긴다. 고른 클립이
                  // 어디인지 바로 보이고, 이어서 분할하기도 쉽다.
                  setPlayhead(startOfIndex(timeline, index))
                }}
              />
            ))}
          </div>

          <Playhead seconds={playhead} pxPerSecond={pxPerSecond} />
        </div>
      </div>
    </div>
  )
}

function ZoomButtons({
  pxPerSecond,
  onChange,
}: {
  pxPerSecond: number
  onChange: (value: number) => void
}) {
  const step = (factor: number) =>
    onChange(Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond * factor)))

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        data-testid="zoom-out"
        aria-label="타임라인 축소"
        onClick={() => step(0.5)}
        className="h-6 w-6 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
      >
        −
      </button>
      <button
        type="button"
        data-testid="zoom-in"
        aria-label="타임라인 확대"
        onClick={() => step(2)}
        className="h-6 w-6 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
      >
        +
      </button>
    </span>
  )
}

/** 시간 눈금. 여기를 누르거나 끌면 재생헤드가 움직인다. */
function Ruler({
  total,
  pxPerSecond,
  onSeek,
}: {
  total: number
  pxPerSecond: number
  onSeek: (clientX: number) => void
}) {
  // 눈금 간격은 화면에서 60px 이상 벌어지도록 고른다.
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  const step = candidates.find((value) => value * pxPerSecond >= 60) ?? 600
  const marks = Math.floor(total / step) + 1

  return (
    <div
      data-testid="ruler"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        onSeek(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.buttons > 0) onSeek(event.clientX)
      }}
      className="relative h-6 cursor-pointer touch-none border-b border-slate-800"
    >
      {Array.from({ length: marks }, (_, index) => index * step).map((seconds) => (
        <span
          key={seconds}
          style={{ left: `${seconds * pxPerSecond}px` }}
          className="absolute top-0 h-full border-l border-slate-700 pl-1 text-[10px] text-slate-500"
        >
          {formatClock(seconds)}
        </span>
      ))}
    </div>
  )
}

function Playhead({ seconds, pxPerSecond }: { seconds: number; pxPerSecond: number }) {
  return (
    <div
      data-testid="playhead"
      data-seconds={seconds.toFixed(3)}
      style={{ left: `${seconds * pxPerSecond}px` }}
      className="pointer-events-none absolute top-0 bottom-0 w-px bg-sky-400"
    >
      <span className="absolute -top-0.5 -left-1 h-2 w-2 rotate-45 bg-sky-400" />
    </div>
  )
}

function Clip({
  item,
  index,
  source,
  pxPerSecond,
  selected,
  onSelect,
}: {
  item: TimelineItem
  index: number
  source: MediaSource | null
  pxPerSecond: number
  selected: boolean
  onSelect: () => void
}) {
  const trim = useProject((state) => state.trim)
  const seconds = itemDuration(item)

  // 끄는 동안에는 화면만 미리 바꾸고, 손을 뗄 때 한 번만 기록한다.
  // 움직일 때마다 기록하면 되돌리기 한 번에 1픽셀씩만 돌아간다.
  const [draft, setDraft] = useState<{ edge: TrimEdge; deltaPx: number } | null>(null)

  const previewSeconds =
    draft === null
      ? seconds
      : Math.max(
          MIN_CLIP_SECONDS,
          draft.edge === 'start'
            ? seconds - draft.deltaPx / pxPerSecond
            : seconds + draft.deltaPx / pxPerSecond,
        )

  const startDrag = (edge: TrimEdge) => (event: React.PointerEvent) => {
    event.stopPropagation()
    // 기본 동작을 막지 않으면 브라우저가 이미지 끌기나 글자 선택을 시작하면서
    // pointercancel 을 보내 끌기가 첫 이동에서 끊긴다.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    const originX = event.clientX
    setDraft({ edge, deltaPx: 0 })

    // 손잡이가 아니라 window 에서 듣는다. 손가락이 손잡이 밖으로 나가도
    // 끌기가 끊기지 않고, 포인터 캡처 해제 타이밍에 기대지 않아도 된다.
    //
    // 이동량은 마지막 pointermove 에서만 받는다. 끝 이벤트의 좌표를 쓰면,
    // 클립이 줄어들며 손잡이가 포인터 아래에서 사라질 때 브라우저가
    // 보내는 pointercancel(clientX = 0)을 그대로 믿어 길이가 튄다.
    let lastDeltaPx = 0
    const onMove = (move: PointerEvent) => {
      lastDeltaPx = move.clientX - originX
      setDraft({ edge, deltaPx: lastDeltaPx })
    }

    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      setDraft(null)
    }

    const onUp = () => {
      stop()
      const deltaSeconds = lastDeltaPx / pxPerSecond
      if (Math.abs(deltaSeconds) < 0.01) return
      trim(item.id, edge, edge === 'start' ? deltaSeconds : seconds + deltaSeconds)
    }

    // 취소는 되돌림이다. 사용자가 끌기를 끝내지 않았으므로 길이를 바꾸지 않는다.
    const onCancel = () => stop()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return (
    <figure
      data-testid="clip"
      data-clip-type={item.type}
      data-selected={selected ? 'true' : 'false'}
      data-duration={previewSeconds.toFixed(3)}
      data-source={source?.fileName ?? ''}
      onPointerDown={onSelect}
      style={{ width: `${previewSeconds * pxPerSecond}px` }}
      className={`relative shrink-0 overflow-hidden rounded-lg bg-slate-800 ring-1 transition-colors ${
        selected ? 'ring-2 ring-sky-400' : 'ring-slate-700'
      }`}
    >
      <div className="relative h-11 bg-slate-950">
        {source?.thumbnailUrl ? (
          <img src={source.thumbnailUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="h-full w-full" style={{ backgroundColor: item.color }} />
        )}
        <span className="absolute top-0.5 left-0.5 rounded bg-slate-950/80 px-1 text-[10px] text-slate-300">
          {index + 1}
        </span>
        {item.type === 'image' && (
          <span className="absolute top-0.5 right-0.5 rounded bg-slate-950/80 px-1 text-[10px] text-sky-300">
            사진
          </span>
        )}
      </div>
      <figcaption className="overflow-hidden px-1 py-0.5">
        <p className="truncate text-[10px] text-slate-400">{source?.fileName ?? '빈 화면'}</p>
        <p className="text-[10px] tabular-nums text-slate-500">{formatClock(previewSeconds)}</p>
      </figcaption>

      {selected && (
        <>
          <TrimHandle side="start" onPointerDown={startDrag('start')} />
          <TrimHandle side="end" onPointerDown={startDrag('end')} />
        </>
      )}
    </figure>
  )
}

function TrimHandle({
  side,
  onPointerDown,
}: {
  side: TrimEdge
  onPointerDown: (event: React.PointerEvent) => void
}) {
  return (
    <span
      data-testid={`trim-${side}`}
      onPointerDown={onPointerDown}
      // 손가락으로 집으려면 최소 폭이 필요하다. 클립이 아무리 짧아도
      // 손잡이는 줄이지 않는다.
      className={`absolute top-0 bottom-0 w-3 cursor-ew-resize touch-none select-none bg-sky-400/80 ${
        side === 'start' ? 'left-0' : 'right-0'
      }`}
    />
  )
}
