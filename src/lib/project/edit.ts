import type { MediaSource, TimelineItem } from './types'
import { itemDuration, timelineDuration } from './types'

/** 클립이 이보다 짧아지면 사실상 보이지 않으므로 더 줄이지 않는다. */
export const MIN_CLIP_SECONDS = 0.1

/** 되돌리기 단계 (PRD FR-013) */
export const HISTORY_LIMIT = 50

export interface LocatedItem {
  item: TimelineItem
  index: number
  /** 타임라인 시작부터 이 클립이 시작하는 시각 */
  startsAt: number
}

/** 타임라인에서 해당 시각에 놓인 클립을 찾는다. */
export function findItemAt(items: TimelineItem[], seconds: number): LocatedItem | null {
  let startsAt = 0
  for (const [index, item] of items.entries()) {
    const end = startsAt + itemDuration(item)
    // 경계는 뒤쪽 클립이 아니라 앞쪽 클립에 속한다고 본다.
    if (seconds < end || index === items.length - 1) {
      return { item, index, startsAt }
    }
    startsAt = end
  }
  return null
}

export function startOfIndex(items: TimelineItem[], index: number): number {
  return items.slice(0, index).reduce((total, item) => total + itemDuration(item), 0)
}

/**
 * 재생헤드 위치에서 클립을 둘로 나눈다 (FR-004).
 *
 * 나눌 수 없으면 null을 돌려준다. 경계에 딱 붙어 있거나 결과 조각이
 * 너무 짧아지는 경우인데, 그대로 두면 길이 0짜리 클립이 생겨 이후
 * 내보내기에서 깨진다.
 */
export function splitAt(items: TimelineItem[], playhead: number): TimelineItem[] | null {
  const located = findItemAt(items, playhead)
  if (!located) return null

  const offset = playhead - located.startsAt
  const total = itemDuration(located.item)
  if (offset < MIN_CLIP_SECONDS || total - offset < MIN_CLIP_SECONDS) return null

  const { item } = located
  const left: TimelineItem = { ...item, id: crypto.randomUUID() }
  const right: TimelineItem = { ...item, id: crypto.randomUUID() }

  if (item.type === 'video') {
    const cut = item.inPoint + offset
    left.outPoint = cut
    right.inPoint = cut
  } else {
    left.duration = offset
    right.duration = total - offset
  }

  return [...items.slice(0, located.index), left, right, ...items.slice(located.index + 1)]
}

/** 클립을 지운다. 뒤 클립은 자동으로 앞으로 당겨진다 — 사이에 빈틈을 두지 않는다 (FR-006). */
export function removeItem(items: TimelineItem[], id: string): TimelineItem[] {
  return items.filter((item) => item.id !== id)
}

/** 클립을 한 칸 앞이나 뒤로 옮긴다 (FR-007). */
export function moveItem(items: TimelineItem[], id: string, delta: number): TimelineItem[] | null {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return null

  const target = index + delta
  if (target < 0 || target >= items.length) return null

  const next = [...items]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

export type TrimEdge = 'start' | 'end'

/**
 * 클립의 시작 또는 끝을 옮긴다 (FR-005).
 *
 * 영상은 원본 길이 안에서만 늘릴 수 있다. 줄였다가 다시 늘리면 잘렸던
 * 부분이 그대로 돌아온다 — 원본을 건드리지 않고 사용 구간만 바꾸기 때문이다.
 */
export function trimItem(
  items: TimelineItem[],
  sources: MediaSource[],
  id: string,
  edge: TrimEdge,
  /** 클립 안에서의 새 지점(초). 클립 시작 기준 상대값 */
  offsetInClip: number,
): TimelineItem[] | null {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return null

  const item = items[index]
  const next = { ...item }

  if (item.type === 'video') {
    const source = sources.find((candidate) => candidate.id === item.sourceId)
    const limit = source?.durationSeconds ?? item.outPoint

    if (edge === 'start') {
      const start = clamp(item.inPoint + offsetInClip, 0, item.outPoint - MIN_CLIP_SECONDS)
      next.inPoint = start
    } else {
      const end = clamp(item.inPoint + offsetInClip, item.inPoint + MIN_CLIP_SECONDS, limit)
      next.outPoint = end
    }
  } else {
    // 이미지·빈 화면은 원본 길이라는 개념이 없어 위쪽 한계가 없다.
    const duration =
      edge === 'start'
        ? Math.max(MIN_CLIP_SECONDS, item.duration - offsetInClip)
        : Math.max(MIN_CLIP_SECONDS, offsetInClip)
    next.duration = duration
  }

  const result = [...items]
  result[index] = next
  return result
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function clampPlayhead(items: TimelineItem[], seconds: number): number {
  return clamp(seconds, 0, timelineDuration(items))
}
