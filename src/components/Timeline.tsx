import { findSource, useProject } from '../lib/project/store'
import { itemDuration, timelineDuration, type TimelineItem } from '../lib/project/types'
import { formatClock } from '../lib/format'

/**
 * 1초당 픽셀 수. Phase 4에서 확대·축소가 붙으면 상태로 옮긴다.
 */
const PIXELS_PER_SECOND = 24

/**
 * 아주 짧은 클립도 손가락으로 집을 수 있어야 한다. 비례 폭만 쓰면
 * 0.5초 클립이 12px이 되어 모바일에서 조작이 불가능하다.
 */
const MIN_CLIP_WIDTH = 56

export function Timeline() {
  const timeline = useProject((state) => state.timeline)
  const sources = useProject((state) => state.sources)

  if (timeline.length === 0) {
    return (
      <p className="rounded-xl bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        아직 타임라인이 비어 있습니다. 영상이나 사진을 추가해 주세요.
      </p>
    )
  }

  const total = timelineDuration(timeline)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span data-testid="clip-count">클립 {timeline.length}개</span>
        <span data-testid="timeline-duration">전체 {formatClock(total)}</span>
      </div>

      <div
        data-testid="timeline"
        className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900/60 p-2"
      >
        {timeline.map((item, index) => (
          <Clip
            key={item.id}
            item={item}
            index={index}
            source={findSource(sources, item.sourceId)}
          />
        ))}
      </div>
    </div>
  )
}

function Clip({
  item,
  index,
  source,
}: {
  item: TimelineItem
  index: number
  source: ReturnType<typeof findSource>
}) {
  const seconds = itemDuration(item)
  const width = Math.max(MIN_CLIP_WIDTH, seconds * PIXELS_PER_SECOND)

  return (
    <figure
      data-testid="clip"
      data-clip-type={item.type}
      style={{ width: `${width}px` }}
      className="shrink-0 overflow-hidden rounded-lg bg-slate-800 ring-1 ring-slate-700"
    >
      <div className="relative h-14 bg-slate-950">
        {source?.thumbnailUrl ? (
          <img
            src={source.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            {item.type === 'blank' ? '빈 화면' : '미리보기 없음'}
          </div>
        )}
        <span className="absolute top-1 left-1 rounded bg-slate-950/80 px-1.5 text-[10px] text-slate-300">
          {index + 1}
        </span>
        {item.type === 'image' && (
          <span className="absolute top-1 right-1 rounded bg-slate-950/80 px-1.5 text-[10px] text-sky-300">
            사진
          </span>
        )}
        {source && !source.hasAudio && item.type === 'video' && (
          <span className="absolute right-1 bottom-1 rounded bg-slate-950/80 px-1.5 text-[10px] text-amber-300">
            무음
          </span>
        )}
      </div>
      <figcaption className="px-1.5 py-1">
        <p className="truncate text-[11px] text-slate-300">{source?.fileName ?? '빈 화면'}</p>
        <p className="text-[10px] text-slate-500">{formatClock(seconds)}</p>
      </figcaption>
    </figure>
  )
}
