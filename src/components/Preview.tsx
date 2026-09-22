import { useCallback, useEffect, useMemo, useRef } from 'react'
import { findSource, useProject } from '../lib/project/store'
import { segmentAt, sourceTimeAt, toSegments } from '../lib/project/playback'
import { subtitleAt } from '../lib/project/subtitles'
import { SubtitleOverlay } from './SubtitleOverlay'
import { timelineDuration } from '../lib/project/types'
import { formatClock } from '../lib/format'

/** 영상 시각이 이보다 어긋나면 맞춰 준다. 매 프레임 맞추면 재생이 끊긴다. */
const SYNC_TOLERANCE = 0.25

/** 구간 끝을 이만큼 남기고 다음으로 넘어간다. 마지막 프레임에서 멈칫하는 것을 막는다. */
const SEGMENT_EPSILON = 0.03

/**
 * 편집 결과를 그대로 재생한다 (FR-012).
 *
 * 원본마다 video 요소를 하나씩 두고 보이는 것만 바꾼다. src 를 갈아끼우면
 * 클립이 바뀔 때마다 다시 불러오느라 끊기기 때문이다.
 */
export function Preview() {
  const timeline = useProject((state) => state.timeline)
  const sources = useProject((state) => state.sources)
  const playhead = useProject((state) => state.playhead)
  const playing = useProject((state) => state.playing)
  const setPlayhead = useProject((state) => state.setPlayhead)
  const setPlaying = useProject((state) => state.setPlaying)
  const togglePlay = useProject((state) => state.togglePlay)

  const subtitles = useProject((state) => state.subtitles)
  const subtitleStyle = useProject((state) => state.subtitleStyle)

  const segments = useMemo(() => toSegments(timeline), [timeline])
  const total = timelineDuration(timeline)
  const current = segmentAt(segments, playhead)
  const currentSource = findSource(sources, current?.item.sourceId ?? null)
  const currentSubtitle = current
    ? subtitleAt(subtitles, current.item, sourceTimeAt(current, playhead))
    : null

  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const playheadRef = useRef(playhead)
  const lastTickRef = useRef(0)
  playheadRef.current = playhead

  // 원본마다 한 번만 만들고 정리한다. 같은 파일에 URL 을 여러 번 만들면 샌다.
  const objectUrls = useMemo(() => {
    const map = new Map<string, string>()
    for (const source of sources) map.set(source.id, URL.createObjectURL(source.file))
    return map
  }, [sources])

  useEffect(() => () => objectUrls.forEach((url) => URL.revokeObjectURL(url)), [objectUrls])

  /** 지금 구간이 아닌 영상은 모두 멈춘다. 소리가 겹쳐 들리면 안 된다. */
  const pauseOthers = useCallback((exceptId: string | null) => {
    for (const [id, element] of videoRefs.current) {
      if (id !== exceptId && !element.paused) element.pause()
    }
  }, [])

  // 구간이 바뀌거나 재생 상태가 바뀔 때 영상 요소를 맞춘다.
  useEffect(() => {
    const item = current?.item
    const activeId = item?.type === 'video' ? item.sourceId : null
    pauseOthers(activeId)

    const video = activeId ? videoRefs.current.get(activeId) : null
    if (!video || !current || !item) return

    video.muted = item.muted
    // HTMLMediaElement 는 100% 를 넘는 볼륨을 받지 못한다. 그 이상은
    // 내보낼 때 적용되고, 미리보기에서는 100% 로 들린다.
    video.volume = Math.min(1, Math.max(0, item.volume))

    const expected = sourceTimeAt(current, playheadRef.current)
    if (Math.abs(video.currentTime - expected) > SYNC_TOLERANCE) {
      video.currentTime = expected
    }

    if (playing) void video.play().catch(() => setPlaying(false))
    else video.pause()
  }, [current, playing, pauseOthers, setPlaying])

  // 다음 클립을 미리 시작 지점에 맞춰 둔다.
  //
  // 넘어가는 순간에 비로소 탐색을 시작하면 그동안 화면이 멈춰 뚝 끊긴다.
  // 같은 원본이 이어지는 경우(분할한 클립)는 탐색이 필요 없으므로 건드리지 않는다.
  useEffect(() => {
    if (!playing || !current) return
    const next = segments[current.index + 1]
    if (!next || next.item.type !== 'video') return
    if (next.item.sourceId === current.item.sourceId) return

    const video = videoRefs.current.get(next.item.sourceId ?? '')
    if (!video) return
    if (Math.abs(video.currentTime - next.item.inPoint) > SYNC_TOLERANCE) {
      video.currentTime = next.item.inPoint
    }
  }, [current, playing, segments])

  // 재생 루프. 영상 구간은 video 요소의 시각을 따르고, 사진·빈 화면은
  // 실제 흐른 시간을 더한다. 영상 시각을 기준으로 삼아야 소리와 어긋나지 않는다.
  useEffect(() => {
    if (!playing) return

    let frame = 0
    lastTickRef.current = performance.now()

    const tick = () => {
      const now = performance.now()
      const elapsed = (now - lastTickRef.current) / 1000
      lastTickRef.current = now

      const segment = segmentAt(segments, playheadRef.current)
      if (!segment) {
        setPlaying(false)
        return
      }

      let next: number
      if (segment.item.type === 'video') {
        const video = videoRefs.current.get(segment.item.sourceId ?? '')
        next = video
          ? segment.start + (video.currentTime - segment.item.inPoint)
          : playheadRef.current + elapsed
      } else {
        next = playheadRef.current + elapsed
      }

      if (next >= segment.end - SEGMENT_EPSILON) {
        if (segment.index >= segments.length - 1) {
          setPlayhead(total)
          setPlaying(false)
          return
        }

        const following = segments[segment.index + 1]
        next = following.start

        // 리액트가 다시 그리기를 기다리지 않고 바로 넘긴다. 한 프레임이라도
        // 늦으면 클립 경계에서 끊기는 것이 눈에 보인다.
        if (following.item.type === 'video') {
          const upcoming = videoRefs.current.get(following.item.sourceId ?? '')
          if (upcoming) {
            if (Math.abs(upcoming.currentTime - following.item.inPoint) > SYNC_TOLERANCE) {
              upcoming.currentTime = following.item.inPoint
            }
            upcoming.muted = following.item.muted
            upcoming.volume = Math.min(1, Math.max(0, following.item.volume))
            void upcoming.play().catch(() => {})
          }
        }
      }

      setPlayhead(next)
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, segments, total, setPlayhead, setPlaying])

  if (timeline.length === 0) return null

  const kind = current?.item.type ?? 'none'

  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="preview"
        data-active-kind={kind}
        data-active-source={currentSource?.fileName ?? ''}
        style={{ containerType: 'size' }}
        className="relative aspect-video w-full overflow-hidden rounded-xl bg-black"
      >
        {sources
          .filter((source) => source.kind === 'video')
          .map((source) => (
            <video
              key={source.id}
              ref={(element) => {
                if (element) videoRefs.current.set(source.id, element)
                else videoRefs.current.delete(source.id)
              }}
              src={objectUrls.get(source.id)}
              preload="auto"
              playsInline
              // 화면 비율이 달라도 잘리지 않게 여백을 둔다. 내보내기의
              // '여백 채우기' 와 같은 방식이다.
              className={`absolute inset-0 h-full w-full object-contain ${
                current?.item.sourceId === source.id && kind === 'video' ? '' : 'hidden'
              }`}
            />
          ))}

        {kind === 'image' && currentSource && (
          <img
            src={objectUrls.get(currentSource.id)}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}

        {kind === 'blank' && (
          <div
            data-testid="preview-blank"
            className="absolute inset-0"
            style={{ backgroundColor: current?.item.color }}
          />
        )}

        {currentSubtitle && (
          <SubtitleOverlay text={currentSubtitle.text} style={subtitleStyle} />
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="play-toggle"
          aria-label={playing ? '정지' : '재생'}
          onClick={togglePlay}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500 text-slate-950 transition-colors hover:bg-sky-400"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="text-sm tabular-nums text-slate-300">
          {formatClock(playhead)} <span className="text-slate-600">/</span>{' '}
          <span className="text-slate-500">{formatClock(total)}</span>
        </span>
      </div>
    </div>
  )
}
