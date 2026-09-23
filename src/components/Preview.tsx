import { useCallback, useEffect, useMemo, useRef } from 'react'
import { findSource, useProject } from '../lib/project/store'
import { segmentAt, sourceTimeAt, toSegments } from '../lib/project/playback'
import { subtitleAt } from '../lib/project/subtitles'
import { SubtitleOverlay } from './SubtitleOverlay'
import { timelineDuration } from '../lib/project/types'
import { computeOutputSize } from '../lib/media/outputSize'
import { useIsMobile } from '../lib/useIsMobile'
import { formatClock } from '../lib/format'
import { PauseIcon, PlayArrowIcon, TextFieldsIcon } from './icons'
import { TextField, btn } from './m3'
import { MAX_SUBTITLE_LENGTH } from '../lib/project/types'

/** 영상 시각이 이보다 어긋나면 맞춰 준다. 매 프레임 맞추면 재생이 끊긴다. */
const SYNC_TOLERANCE = 0.25

/** 멈춘 채 옮길 때는 프레임 단위로 맞춘다. 30fps 의 반 프레임이다. */
const FRAME_TOLERANCE = 1 / 60

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
  const addSubtitle = useProject((state) => state.addSubtitle)
  const updateSubtitle = useProject((state) => state.updateSubtitle)

  const subtitles = useProject((state) => state.subtitles)
  const subtitleStyle = useProject((state) => state.subtitleStyle)
  const exportSetting = useProject((state) => state.exportSetting)
  const mobile = useIsMobile()

  const segments = useMemo(() => toSegments(timeline), [timeline])
  const total = timelineDuration(timeline)
  const current = segmentAt(segments, playhead)
  const currentSource = findSource(sources, current?.item.sourceId ?? null)
  const currentSubtitle = current
    ? subtitleAt(subtitles, current.item, sourceTimeAt(current, playhead))
    : null

  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const imageRef = useRef<HTMLImageElement | null>(null)
  const backdropRef = useRef<HTMLCanvasElement | null>(null)
  const subtitleInputRef = useRef<HTMLInputElement | null>(null)
  const focusNewSubtitleRef = useRef(false)
  const playheadRef = useRef(playhead)
  const lastTickRef = useRef(0)
  playheadRef.current = playhead

  // 미리보기도 내보내기와 같은 화면비·맞추는 방법을 쓴다. 그러지 않으면
  // 내보낸 뒤에야 여백이나 잘림을 발견한다.
  const outputSize = useMemo(() => {
    const first = sources.find((source) => source.kind === 'video')
    const sourceSize = first
      ? { width: first.displayWidth, height: first.displayHeight }
      : { width: 1280, height: 720 }
    return computeOutputSize(exportSetting, sourceSize)
  }, [sources, exportSetting])

  const fitClass = exportSetting.fitMode === 'cover' ? 'object-cover' : 'object-contain'
  const blurred = exportSetting.fitMode === 'blur'

  // 원본마다 한 번만 만들고 정리한다. 같은 파일에 URL 을 여러 번 만들면 샌다.
  const objectUrls = useMemo(() => {
    const map = new Map<string, string>()
    for (const source of sources) map.set(source.id, URL.createObjectURL(source.file))
    return map
  }, [sources])

  useEffect(() => () => objectUrls.forEach((url) => URL.revokeObjectURL(url)), [objectUrls])

  /**
   * 흐린 배경을 작은 캔버스에 그린다.
   *
   * 영상 요소를 하나 더 두면 같은 파일을 두 번 디코딩하고 두 재생이 서로
   * 어긋난다. 지금 보이는 요소에서 한 장을 떠 작은 캔버스에 잘라 채우고
   * CSS 로 흐리게 키우는 쪽이 싸고 정확하다. 내보내기 쪽과 같은 방식이다.
   */
  const paintBackdrop = useCallback(() => {
    const canvas = backdropRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const item = current?.item
    if (item?.type === 'blank') {
      context.fillStyle = item.color
      context.fillRect(0, 0, canvas.width, canvas.height)
      return
    }

    const media =
      item?.type === 'video'
        ? (videoRefs.current.get(item.sourceId ?? '') ?? null)
        : imageRef.current
    const mediaWidth =
      media instanceof HTMLVideoElement ? media.videoWidth : (media?.naturalWidth ?? 0)
    const mediaHeight =
      media instanceof HTMLVideoElement ? media.videoHeight : (media?.naturalHeight ?? 0)
    if (!media || mediaWidth === 0 || mediaHeight === 0) return

    const scale = Math.max(canvas.width / mediaWidth, canvas.height / mediaHeight)
    const drawWidth = mediaWidth * scale
    const drawHeight = mediaHeight * scale
    try {
      context.drawImage(
        media,
        (canvas.width - drawWidth) / 2,
        (canvas.height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      )
    } catch {
      // 아직 그릴 수 있는 프레임이 없을 때. 다음 프레임에 다시 시도한다.
    }
  }, [current])

  // 재생 중에는 playhead 가 매 프레임 바뀌므로 이 효과가 계속 다시 돈다.
  useEffect(() => {
    if (blurred) paintBackdrop()
  }, [blurred, paintBackdrop, playhead])

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

  // 방금 넣은 자막의 입력칸이 그려진 뒤에 바로 쓸 수 있게 한다. 버튼을 누른
  // 그 자리에서 포커스를 옮기면 입력칸이 아직 없을 때가 있고(모바일), 그러면
  // 치는 글자의 띄어쓰기가 재생 단축키로 가 버린다.
  useEffect(() => {
    if (!focusNewSubtitleRef.current || !currentSubtitle) return
    focusNewSubtitleRef.current = false
    subtitleInputRef.current?.focus()
  }, [currentSubtitle])

  // 멈춘 채 재생헤드를 옮기면 그 장면을 보여 준다.
  //
  // 위 효과는 클립이 바뀔 때만 돈다. 같은 클립 안에서 옮기면 영상 요소가
  // 예전 장면에 멈춰 있어, 자를 자리를 눈으로 찾을 수 없다. 재생 중에는
  // 영상 시각이 재생헤드를 이끄므로 여기서 건드리지 않는다.
  useEffect(() => {
    if (playing || current?.item.type !== 'video') return
    const video = videoRefs.current.get(current.item.sourceId ?? '')
    if (!video) return
    const expected = sourceTimeAt(current, playhead)
    // 반 프레임보다 작은 차이는 같은 장면이다. 매번 탐색하면 디코딩만 늘어난다.
    if (Math.abs(video.currentTime - expected) > FRAME_TOLERANCE) video.currentTime = expected
  }, [current, playhead, playing])

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
    // 모바일에서는 미리보기가 위에 붙어 있어 패널 여백만큼 편집할 자리가 준다.
    <div
      className={
        mobile
          ? 'flex flex-col gap-2'
          : 'flex flex-col gap-3 rounded-m3-xl bg-surface-container p-4'
      }
    >
      <div
        data-testid="preview"
        data-active-kind={kind}
        data-active-source={currentSource?.fileName ?? ''}
        data-fit={exportSetting.fitMode}
        style={{
          containerType: 'size',
          aspectRatio: `${outputSize.width} / ${outputSize.height}`,
          // 세로로 긴 출력은 화면을 넘지 않게 가로를 줄인다. 높이만 제한하면
          // 가로가 그대로 남아 비율이 깨진다.
          // 모바일에서는 미리보기가 화면을 다 먹지 않게 더 낮게 잡는다.
          // 타임라인과 도구 바가 같이 보여야 편집을 한 손으로 이어갈 수 있다.
          maxWidth: `calc(${mobile ? '38dvh' : '70vh'} * ${outputSize.width / outputSize.height})`,
        }}
        className="relative mx-auto w-full overflow-hidden rounded-m3-lg bg-black"
      >
        {blurred && (
          <canvas
            ref={backdropRef}
            data-testid="preview-backdrop"
            width={64}
            height={Math.max(16, Math.round((64 * outputSize.height) / outputSize.width))}
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
          />
        )}

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
              // 탐색은 비동기라 재생헤드를 옮긴 직후에 그리면 이전 장면이 남는다.
              onSeeked={blurred ? paintBackdrop : undefined}
              // 내보내기에서 고른 맞추는 방법을 그대로 쓴다.
              className={`absolute inset-0 h-full w-full ${fitClass} ${
                current?.item.sourceId === source.id && kind === 'video' ? '' : 'hidden'
              }`}
            />
          ))}

        {kind === 'image' && currentSource && (
          <img
            ref={imageRef}
            src={objectUrls.get(currentSource.id)}
            alt=""
            onLoad={paintBackdrop}
            className={`absolute inset-0 h-full w-full ${fitClass}`}
          />
        )}

        {kind === 'blank' && (
          <div
            data-testid="preview-blank"
            className="absolute inset-0"
            style={{ backgroundColor: current?.item.color }}
          />
        )}

        {currentSubtitle && <SubtitleOverlay text={currentSubtitle.text} style={subtitleStyle} />}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          data-testid="play-toggle"
          aria-label={playing ? '정지' : '재생'}
          onClick={togglePlay}
          className={`state-layer flex shrink-0 items-center justify-center rounded-full bg-primary text-on-primary ${
            mobile ? 'h-12 w-12' : 'h-14 w-14'
          }`}
        >
          {playing ? <PauseIcon size={28} /> : <PlayArrowIcon size={28} />}
        </button>
        <span className="m3-title-medium tabular-nums text-on-surface">
          {formatClock(playhead)}{' '}
          <span className="m3-body-medium text-on-surface-variant">/ {formatClock(total)}</span>
        </span>
        {/* 자막은 화면을 보면서 넣는다. 버튼이 자막 목록에 있으면 미리보기와
            떨어져 있어 멈추고, 내려가서 누르고, 다시 올라와 확인해야 했다. */}
        <button
          type="button"
          data-testid="add-subtitle"
          disabled={!current}
          onClick={() => {
            focusNewSubtitleRef.current = true
            addSubtitle()
          }}
          className={`${btn.tonal} ml-auto h-11 pr-5 pl-4`}
        >
          <TextFieldsIcon size={20} />
          {mobile ? '자막 추가' : '현재 위치에 자막 추가'}
        </button>
      </div>

      {/* 지금 보이는 자막을 그 자리에서 고친다. 재생 중에는 자막이 계속 바뀌어
          입력칸이 흔들리므로 멈췄을 때만 둔다. */}
      {!playing && currentSubtitle && (
        <TextField
          ref={subtitleInputRef}
          label="지금 보이는 자막"
          labelBg={mobile ? 'bg-surface' : 'bg-surface-container'}
          data-testid="preview-subtitle-text"
          value={currentSubtitle.text}
          maxLength={MAX_SUBTITLE_LENGTH}
          placeholder="자막 내용을 입력하세요"
          onChange={(event) => updateSubtitle(currentSubtitle.id, { text: event.target.value })}
        />
      )}
    </div>
  )
}
