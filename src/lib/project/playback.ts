import type { TimelineItem } from './types'
import { itemDuration } from './types'

/** 타임라인 위에서 한 클립이 차지하는 시간 구간. */
export interface Segment {
  item: TimelineItem
  index: number
  start: number
  end: number
}

export function toSegments(items: TimelineItem[]): Segment[] {
  const segments: Segment[] = []
  let start = 0
  for (const [index, item] of items.entries()) {
    const end = start + itemDuration(item)
    segments.push({ item, index, start, end })
    start = end
  }
  return segments
}

/**
 * 해당 시각을 담고 있는 구간을 찾는다.
 *
 * 경계는 뒤쪽 구간에 속한다고 본다. 3초짜리 클립 두 개가 이어져 있을 때
 * 정확히 3.0초는 두 번째 클립의 첫 프레임이다.
 */
export function segmentAt(segments: Segment[], seconds: number): Segment | null {
  if (segments.length === 0) return null
  for (const segment of segments) {
    if (seconds < segment.end) return segment
  }
  return segments.at(-1) ?? null
}

/** 구간 안에서의 상대 시각을, 영상이라면 원본 기준 시각으로 바꾼다. */
export function sourceTimeAt(segment: Segment, seconds: number): number {
  const offset = Math.max(0, Math.min(seconds - segment.start, segment.end - segment.start))
  return segment.item.type === 'video' ? segment.item.inPoint + offset : offset
}
