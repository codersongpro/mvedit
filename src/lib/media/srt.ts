import { toSegments } from '../project/playback'
import { clipRange } from '../project/subtitles'
import type { Subtitle, TimelineItem } from '../project/types'

export interface TimedSubtitle {
  start: number
  end: number
  text: string
}

/**
 * 자막을 타임라인 시각으로 환산해 재생 순서로 돌려준다.
 *
 * 자막은 클립 원본의 시간축에 저장돼 있어 그대로는 쓸 수 없다. 내보내기와
 * .srt 가 같은 값을 쓰도록 이 한 곳에서만 계산한다.
 */
export function toTimedSubtitles(
  subtitles: Subtitle[],
  timeline: TimelineItem[],
): TimedSubtitle[] {
  const byClip = new Map(toSegments(timeline).map((segment) => [segment.item.id, segment]))

  return subtitles
    .map((subtitle) => {
      const segment = byClip.get(subtitle.clipId)
      if (!segment) return null

      const range = clipRange(segment.item)
      // 트림으로 클립 밖으로 나간 부분은 결과물에도 나오지 않는다.
      const start = Math.max(subtitle.start, range.start)
      const end = Math.min(subtitle.end, range.end)
      if (end - start <= 0 || !subtitle.text.trim()) return null

      return {
        start: segment.start + (start - range.start),
        end: segment.start + (end - range.start),
        text: subtitle.text.trim(),
      }
    })
    .filter((timed): timed is TimedSubtitle => timed !== null)
    .sort((a, b) => a.start - b.start)
}

/** SRT 타임코드: HH:MM:SS,mmm */
function srtTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = Math.floor(total % 60)
  const millis = Math.round((total - Math.floor(total)) * 1000)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`
}

/** 표준 SRT 문자열을 만든다 (FR-038). */
export function toSrt(timed: TimedSubtitle[]): string {
  return timed
    .map(
      (subtitle, index) =>
        `${index + 1}\n${srtTime(subtitle.start)} --> ${srtTime(subtitle.end)}\n${subtitle.text}\n`,
    )
    .join('\n')
}
