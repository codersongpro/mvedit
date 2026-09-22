import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { findSource, useProject } from '../lib/project/store'
import { MIN_CLIP_SECONDS, type TrimEdge } from '../lib/project/edit'
import { toSegments } from '../lib/project/playback'
import { clipRange } from '../lib/project/subtitles'
import {
  itemDuration,
  timelineDuration,
  MIN_SUBTITLE_SECONDS,
  type MediaSource,
  type Subtitle,
  type TimelineItem,
} from '../lib/project/types'
import { formatClock } from '../lib/format'
import { useIsMobile } from '../lib/useIsMobile'

// 1초를 1픽셀로 보면 한 시간짜리 영상도 한눈에 들어오고,
// 600픽셀이면 30fps 기준 한 프레임이 20픽셀이라 프레임 단위로 집을 수 있다.
const MIN_PX_PER_SECOND = 1
const MAX_PX_PER_SECOND = 600
const DEFAULT_PX_PER_SECOND = 40
const TRACK_HEIGHT = 72
const SUBTITLE_LANE_HEIGHT = 30
const ZOOM_STEP = 1.6

/** 재생헤드가 가장자리 이만큼 안쪽으로 들어오면 화면을 민다. */
const FOLLOW_MARGIN = 24

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
  const subtitles = useProject((state) => state.subtitles)
  const selectedSubtitleId = useProject((state) => state.selectedSubtitleId)
  const selectSubtitle = useProject((state) => state.selectSubtitle)
  const updateSubtitle = useProject((state) => state.updateSubtitle)

  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const total = timelineDuration(timeline)

  // 모바일에서는 재생헤드가 화면 중앙에 고정되고 타임라인이 움직인다 (FR-029).
  // 좁은 화면에서 재생헤드를 직접 끌면 손가락이 그 지점을 가려 보이지 않는다.
  const centered = useIsMobile()
  const [halfWidth, setHalfWidth] = useState(0)
  const syncingRef = useRef(false)
  // 확대 콜백은 의존성을 늘리지 않으려고 ref 로 읽는다.
  const centeredRef = useRef(centered)
  centeredRef.current = centered
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead

  // 시작과 끝도 중앙에 놓으려면 앞뒤로 화면 절반만큼의 여백이 필요하다.
  //
  // 타임라인이 비어 있는 동안에는 이 요소 자체가 없다. 클립이 생겨 요소가
  // 나타나는 순간 다시 재야 하므로 hasClips 를 의존성에 넣는다.
  const hasClips = timeline.length > 0
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !centered || !hasClips) {
      setHalfWidth(0)
      return
    }
    const measure = () => setHalfWidth(scroll.clientWidth / 2)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [centered, hasClips])

  /** 내용 요소가 스크롤 안쪽에서 시작하는 위치(px). 여백을 직접 계산하지 않는다. */
  const contentOffset = useCallback(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) return 0
    return (
      content.getBoundingClientRect().left - scroll.getBoundingClientRect().left + scroll.scrollLeft
    )
  }, [])

  // 재생헤드가 바뀌면 타임라인을 밀어 중앙에 맞춘다. 재생 중에도 같은 길로
  // 흐르므로 화면이 따라 흐른다.
  useEffect(() => {
    const scroll = scrollRef.current
    if (!centered || !scroll || halfWidth === 0) return
    const target = contentOffset() + playhead * pxPerSecond - scroll.clientWidth / 2
    if (Math.abs(scroll.scrollLeft - target) < 1) return
    // 이 스크롤은 우리가 만든 것이다. 다시 재생헤드로 되돌리면 서로 밀어낸다.
    syncingRef.current = true
    scroll.scrollLeft = target
    requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }, [centered, halfWidth, playhead, pxPerSecond, contentOffset])

  /**
   * 넓은 화면에서는 재생헤드가 보이도록 타임라인을 따라 민다.
   *
   * 확대해 놓으면 타임라인이 화면보다 넓어진다. 그대로 두면 재생해도 화면은
   * 가만히 있고 재생헤드만 화면 밖에서 움직여, 지금 어디를 보고 있는지 알 수
   * 없다. 확대한 뒤에도 마찬가지다.
   *
   * 화면 밖으로 나갈 때만 민다. 매번 가운데로 맞추면 눈이 따라가기 어렵다.
   */
  useEffect(() => {
    const scroll = scrollRef.current
    if (centered || !scroll) return

    const x = contentOffset() + playhead * pxPerSecond
    const visibleFrom = scroll.scrollLeft + FOLLOW_MARGIN
    const visibleTo = scroll.scrollLeft + scroll.clientWidth - FOLLOW_MARGIN
    if (x >= visibleFrom && x <= visibleTo) return

    // 왼쪽 1/5 지점에 둔다. 앞으로 재생될 부분이 화면에 남아 있어야 한다.
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.2)
  }, [centered, playhead, pxPerSecond, contentOffset])

  /** 손가락으로 민 만큼 재생헤드를 옮긴다 (AC-033). */
  const onScroll = useCallback(() => {
    const scroll = scrollRef.current
    if (!centered || !scroll || syncingRef.current || halfWidth === 0) return
    setPlayhead((scroll.scrollLeft + scroll.clientWidth / 2 - contentOffset()) / pxPerSecond)
  }, [centered, halfWidth, pxPerSecond, contentOffset, setPlayhead])

  /**
   * 자막을 타임라인 좌표로 환산한다.
   *
   * 자막은 클립 원본의 시간축에 저장돼 있어 그대로는 화면에 놓을 수 없다.
   * 클립이 타임라인에서 시작하는 위치를 더해 옮긴다.
   */
  const placedSubtitles = useMemo(() => {
    const segments = toSegments(timeline)
    const byClip = new Map(segments.map((segment) => [segment.item.id, segment]))

    return subtitles
      .map((subtitle) => {
        const segment = byClip.get(subtitle.clipId)
        if (!segment) return null

        const range = clipRange(segment.item)
        // 트림으로 클립 밖에 나간 부분은 보이지 않으므로 잘라서 그린다.
        const start = Math.max(subtitle.start, range.start)
        const end = Math.min(subtitle.end, range.end)
        if (end - start <= 0) return null

        return {
          subtitle,
          left: segment.start + (start - range.start),
          width: end - start,
        }
      })
      .filter((placed): placed is NonNullable<typeof placed> => placed !== null)
  }, [subtitles, timeline])

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

      // 중앙 고정 모드에서 붙잡을 지점은 이미 정해져 있다. 재생헤드다.
      // 여기서 스크롤까지 건드리면 재생헤드를 따라 맞추는 쪽과 서로 밀어내
      // 엉뚱한 시각으로 날아간다.
      if (centeredRef.current) return next

      const contentLeft = content.getBoundingClientRect().left
      // 기준점을 주지 않은 확대(버튼)는 재생헤드를 붙잡는다. 화면 가운데를
      // 붙잡으면 지금 편집하던 자리가 화면 밖으로 밀려난다.
      const anchorX = anchorClientX ?? contentLeft + playheadRef.current * current
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
    // 중앙 고정 모드의 스크롤 위치는 재생헤드가 정한다.
    if (!centeredRef.current) scroll.scrollLeft = 0
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
          <ZoomControls pxPerSecond={pxPerSecond} onZoom={zoomAround} onFit={zoomToFit} />
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          data-testid="timeline"
          data-px-per-second={pxPerSecond}
          data-centered={centered ? 'yes' : 'no'}
          onWheel={onWheel}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPinch}
          onPointerCancel={endPinch}
          className="relative flex overflow-x-auto rounded-xl bg-slate-900/60 p-2"
        >
          {/* 여백은 빈 칸으로 만든다. 스크롤 컨테이너의 padding-right 는
            브라우저마다 스크롤 폭에 넣는 방식이 달라 믿을 수 없다. */}
          {centered && <div style={{ width: `${halfWidth}px` }} className="shrink-0" />}
          <div
            ref={contentRef}
            className="relative shrink-0"
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
                  onSelect={(clientX) => {
                    select(item.id)
                    // 클립을 고르면서 누른 그 지점으로 재생헤드를 옮긴다.
                    // 클립 앞으로 보내면 보려던 장면을 다시 찾아가야 한다.
                    seekFromPointer(clientX)
                  }}
                />
              ))}
            </div>

            <div
              data-testid="subtitle-lane"
              className="relative mt-1"
              style={{ height: `${SUBTITLE_LANE_HEIGHT}px` }}
            >
              {placedSubtitles.length === 0 && (
                <span className="absolute inset-y-0 left-0 flex items-center text-[10px] text-slate-600">
                  자막
                </span>
              )}
              {placedSubtitles.map(({ subtitle, left, width }) => (
                <SubtitleBlock
                  key={subtitle.id}
                  subtitle={subtitle}
                  left={left}
                  width={width}
                  pxPerSecond={pxPerSecond}
                  selected={subtitle.id === selectedSubtitleId}
                  onSelect={() => {
                    selectSubtitle(subtitle.id)
                    setPlayhead(left)
                  }}
                  onTrim={(edge, deltaSeconds) =>
                    updateSubtitle(
                      subtitle.id,
                      edge === 'start'
                        ? { start: subtitle.start + deltaSeconds }
                        : { end: subtitle.end + deltaSeconds },
                    )
                  }
                />
              ))}
            </div>

            <Playhead seconds={playhead} pxPerSecond={pxPerSecond} />
          </div>
          {centered && <div style={{ width: `${halfWidth}px` }} className="shrink-0" />}
        </div>

        {/* 중앙 고정선. 스크롤 바깥에 두어야 타임라인과 함께 밀려나지 않는다. */}
        {centered && (
          <div
            data-testid="center-playhead"
            aria-hidden
            className="pointer-events-none absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 bg-sky-400"
          />
        )}
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
  onSelect: (clientX: number) => void
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
      onPointerDown={(event) => onSelect(event.clientX)}
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

/**
 * 타임라인 위의 자막 한 덩이. 양 끝을 끌어 시작과 끝을 옮긴다.
 *
 * 클립 트림과 같은 방식으로 끄는 동안에는 화면만 미리 바꾸고, 손을 뗄 때
 * 한 번만 기록한다. 움직일 때마다 기록하면 되돌리기 한 번에 1픽셀씩만 돌아간다.
 */
function SubtitleBlock({
  subtitle,
  left,
  width,
  pxPerSecond,
  selected,
  onSelect,
  onTrim,
}: {
  subtitle: Subtitle
  left: number
  width: number
  pxPerSecond: number
  selected: boolean
  onSelect: () => void
  onTrim: (edge: TrimEdge, deltaSeconds: number) => void
}) {
  const [draft, setDraft] = useState<{ edge: TrimEdge; deltaPx: number } | null>(null)

  const deltaSeconds = draft ? draft.deltaPx / pxPerSecond : 0
  const previewLeft = draft?.edge === 'start' ? left + deltaSeconds : left
  const previewWidth = Math.max(
    MIN_SUBTITLE_SECONDS,
    draft === null ? width : draft.edge === 'start' ? width - deltaSeconds : width + deltaSeconds,
  )

  const startDrag = (edge: TrimEdge) => (event: React.PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* 이 포인터는 캡처할 수 없다 */
    }

    const originX = event.clientX
    setDraft({ edge, deltaPx: 0 })

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
      const seconds = lastDeltaPx / pxPerSecond
      if (Math.abs(seconds) >= 0.01) onTrim(edge, seconds)
    }
    const onCancel = () => stop()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return (
    <div
      data-testid="subtitle-block"
      data-selected={selected ? 'true' : 'false'}
      data-start={subtitle.start.toFixed(3)}
      data-end={subtitle.end.toFixed(3)}
      onPointerDown={onSelect}
      style={{
        left: `${previewLeft * pxPerSecond}px`,
        width: `${Math.max(previewWidth * pxPerSecond, 8)}px`,
      }}
      className={`absolute inset-y-0 flex items-center overflow-hidden rounded-md bg-amber-500/25 px-1 ring-1 transition-colors ${
        selected ? 'ring-2 ring-amber-300' : 'ring-amber-500/40'
      }`}
    >
      <span className="truncate text-[10px] text-amber-100">
        {subtitle.text.trim() || '(빈 자막)'}
      </span>

      {selected && (
        <>
          <span
            data-testid="subtitle-trim-start"
            onPointerDown={startDrag('start')}
            className="absolute inset-y-0 left-0 w-3 cursor-ew-resize touch-none select-none bg-amber-300/90"
          />
          <span
            data-testid="subtitle-trim-end"
            onPointerDown={startDrag('end')}
            className="absolute inset-y-0 right-0 w-3 cursor-ew-resize touch-none select-none bg-amber-300/90"
          />
        </>
      )}
    </div>
  )
}
