import {
  MAX_SUBTITLE_LENGTH,
  MIN_SUBTITLE_SECONDS,
  type Subtitle,
  type TimelineItem,
} from './types'

/** 클립 안에서 자막이 놓일 수 있는 시간 범위. */
export function clipRange(item: TimelineItem): { start: number; end: number } {
  return item.type === 'video'
    ? { start: item.inPoint, end: item.outPoint }
    : { start: 0, end: item.duration }
}

/**
 * 지금 화면에 보여야 할 자막.
 *
 * 트림으로 클립 밖으로 밀려난 자막은 보이지 않는다. 지우지는 않으므로
 * 트림을 되돌리면 다시 나타난다 (AC-041).
 */
export function subtitleAt(
  subtitles: Subtitle[],
  item: TimelineItem,
  sourceTime: number,
): Subtitle | null {
  const range = clipRange(item)
  for (const subtitle of subtitles) {
    if (subtitle.clipId !== item.id) continue
    if (subtitle.start > sourceTime || subtitle.end <= sourceTime) continue
    if (subtitle.end <= range.start || subtitle.start >= range.end) continue
    return subtitle
  }
  return null
}

export function subtitlesOfClip(subtitles: Subtitle[], clipId: string): Subtitle[] {
  return subtitles
    .filter((subtitle) => subtitle.clipId === clipId)
    .sort((a, b) => a.start - b.start)
}

/**
 * 클립을 둘로 나눌 때 자막도 경계에서 나눈다 (AC-041).
 *
 * 경계에 걸친 자막은 양쪽에 하나씩 남겨 글자가 끊기지 않게 한다.
 */
export function splitSubtitles(
  subtitles: Subtitle[],
  clipId: string,
  leftId: string,
  rightId: string,
  cut: number,
): Subtitle[] {
  const result: Subtitle[] = []

  for (const subtitle of subtitles) {
    if (subtitle.clipId !== clipId) {
      result.push(subtitle)
      continue
    }

    if (subtitle.end <= cut) {
      result.push({ ...subtitle, clipId: leftId })
    } else if (subtitle.start >= cut) {
      result.push({ ...subtitle, clipId: rightId })
    } else {
      result.push({ ...subtitle, clipId: leftId, end: cut })
      result.push({ ...subtitle, id: crypto.randomUUID(), clipId: rightId, start: cut })
    }
  }

  return result
}

/** 사라진 클립의 자막을 함께 정리한다. */
export function pruneSubtitles(subtitles: Subtitle[], items: TimelineItem[]): Subtitle[] {
  const alive = new Set(items.map((item) => item.id))
  return subtitles.filter((subtitle) => alive.has(subtitle.clipId))
}

export function normalizeSubtitle(subtitle: Subtitle, item: TimelineItem): Subtitle {
  const range = clipRange(item)
  const start = Math.min(Math.max(subtitle.start, range.start), range.end - MIN_SUBTITLE_SECONDS)
  const end = Math.min(Math.max(subtitle.end, start + MIN_SUBTITLE_SECONDS), range.end)
  return {
    ...subtitle,
    start,
    end,
    text: subtitle.text.slice(0, MAX_SUBTITLE_LENGTH),
  }
}
