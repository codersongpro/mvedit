import { useCallback, useRef, useState } from 'react'
import { findSource, useProject } from '../lib/project/store'
import { MIN_CLIP_SECONDS, startOfIndex, type TrimEdge } from '../lib/project/edit'
import { itemDuration, timelineDuration, type MediaSource, type TimelineItem } from '../lib/project/types'
import { formatClock } from '../lib/format'

// 1초를 1픽셀로 보면 한 시간짜리 영상도 한눈에 들어오고,
// 600픽셀이면 30fps 기준 한 프레임이 20픽셀이라 프레임 단위로 집을 수 있다.
const MIN_PX_PER_SECOND = 1
const MAX_PX_PER_SECOND = 600
const DEFAULT_PX_PER_SECOND = 40
const TRACK_HEIGHT = 72
const ZOOM_STEP = 1.6

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
  const scrollRef = useRef<HTMLDivElement>(null)

  const total = timelineDuration(timeline)

  /**
   * 화면의 한 지점을 붙잡은 채 배율만 바꾼다.
   *
   * 그냥 배율만 키우면 보고 있던 구간이 화면 밖으로 밀려나, 확대할 때마다
   * 편집하던 위치를 다시 찾아야 한다. 기준점의 화면상 x 를 유지하도록
   * 스크롤을 함께 옮긴다.
   */
  const zoomAround = useCallback((factor: number, anchorClientX?: number) => {
    const scroll = scrollRef.current
    const content = contentRef.current
    setPxPerSecond((current) => {
      const next = clampZoom(current * factor)
      if (!scroll || !content || next === current) return next

      const contentLeft = content.getBoundingClientRect().left
      const anchorX = anchorClientX ?? scroll.getBoundingClientRect().left + scroll.clientWidth / 2
      const anchorSeconds = (anchorX - contentLeft) / current
      // 배율이 바뀐 뒤 같은 시각이 같은 화면 위치에 오도록 스크롤을 민다.
      requestAnimationFrame(() => {
        scroll.scrollLeft += anchorSeconds * next - anchorSeconds * current
      })
      return next
    })
  }, [])

  /** 전체 타임라인이 한 화면에 들어오도록 맞춘다. */
  const zoomToFit = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll || total <= 0) return
    // p-2 안쪽 여백 16px 에 더해 2px 을 남긴다. 반올림 때문에 1픽셀이
    // 삐져나와 가로 스크롤바가 생기는 것을 막는다.
    setPxPerSecond(clampZoom((scroll.clientWidth - 18) / total))
    scroll.scrollLeft = 0
  }, [total])

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

  /** 트랙패드 핀치와 Ctrl+휠. 커서가 가리키는 시각을 붙잡고 확대한다. */
  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomAround(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event.clientX)
    },
    [zoomAround],
  )

  const pinchRef = useRef<{ pointers: Map<number, number>; distance: number } | null>(null)

  /** 두 손가락 핀치. 모바일에서는 이게 주된 확대 방법이다. */
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== 'touch') return
    const state = pinchRef.current ?? { pointers: new Map<number, number>(), distance: 0 }
    state.pointers.set(event.pointerId, event.clientX)
    pinchRef.current = state
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = pinchRef.current
      if (!state || !state.pointers.has(event.pointerId)) return
      state.pointers.set(event.pointerId, event.clientX)
      if (state.pointers.size < 2) return

      const [a, b] = [...state.pointers.values()]
      const distance = Math.abs(a - b)
      if (state.distance > 0 && distance > 0) {
        const factor = distance / state.distance
        // 아주 작은 흔들림까지 반영하면 화면이 떨린다.
        if (Math.abs(factor - 1) > 0.02) zoomAround(factor, (a + b) / 2)
      }
      state.distance = distance
    },
    [zoomAround],
  )

  const endPinch = useCallback((event: React.PointerEvent) => {
    const state = pinchRef.current
    if (!state) return
    state.pointers.delete(event.pointerId)
    state.distance = 0
    if (state.pointers.size === 0) pinchRef.current = null
  }, [])

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
          <ZoomControls
            pxPerSecond={pxPerSecond}
            onZoom={zoomAround}
            onFit={zoomToFit}
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        data-testid="timeline"
        data-px-per-second={pxPerSecond}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPinch}
        onPointerCancel={endPinch}
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

export function clampZoom(value: number): number {
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, value))
}

function ZoomControls({
  pxPerSecond,
  onZoom,
  onFit,
}: {
  pxPerSecond: number
  onZoom: (factor: number) => void
  onFit: () => void
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        data-testid="zoom-fit"
        onClick={onFit}
        className="h-7 rounded bg-slate-800 px-2 text-[11px] text-slate-300 hover:bg-slate-700"
      >
        맞춤
      </button>
      <button
        type="button"
        data-testid="zoom-out"
        aria-label="타임라인 축소"
        disabled={pxPerSecond <= MIN_PX_PER_SECOND}
        onClick={() => onZoom(1 / ZOOM_STEP)}
        className="h-7 w-7 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:text-slate-600"
      >
        −
      </button>
      <button
        type="button"
        data-testid="zoom-in"
        aria-label="타임라인 확대"
        disabled={pxPerSecond >= MAX_PX_PER_SECOND}
        onClick={() => onZoom(ZOOM_STEP)}
        className="h-7 w-7 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:text-slate-600"
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
        // 캡처는 끌기를 매끄럽게 할 뿐이다. 실패하더라도 위치 이동은 막지 않는다.
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* 이 포인터는 캡처할 수 없다 */
        }
        onSeek(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.buttons > 0) onSeek(event.clientX)
      }}
      // 마지막 눈금 라벨이 시간축 오른쪽으로 삐져나오면 스크롤 너비가 늘어나
      // "맞춤" 을 눌러도 가로 스크롤이 남는다. 눈금자 안에서 잘라낸다.
      className="relative h-6 cursor-pointer touch-none overflow-hidden border-b border-slate-800"
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
          // 썸네일을 늘리지 않고 원본 비율 그대로 가로로 반복한다.
          // 클립이 길수록 장면이 여러 번 보여 필름을 보는 느낌이 나고,
          // 짧은 클립에서도 비율이 찌그러지지 않는다.
          <div
            data-testid="clip-filmstrip"
            role="img"
            aria-label={source.fileName}
            className="h-full w-full"
            style={{
              backgroundImage: `url(${source.thumbnailUrl})`,
              backgroundRepeat: 'repeat-x',
              backgroundSize: 'auto 100%',
              backgroundPosition: 'left center',
            }}
          />
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
