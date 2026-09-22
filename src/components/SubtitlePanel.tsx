import { useMemo } from 'react'
import { useProject } from '../lib/project/store'
import { segmentAt, toSegments } from '../lib/project/playback'
import { clipRange } from '../lib/project/subtitles'
import { MAX_SUBTITLE_LENGTH, type Subtitle } from '../lib/project/types'
import { formatClock } from '../lib/format'

const FONT_SIZES = [
  { value: 0.035, label: '작게' },
  { value: 0.045, label: '보통' },
  { value: 0.06, label: '크게' },
  { value: 0.08, label: '아주 크게' },
]

const BACKGROUNDS = [
  { value: 'outline', label: '테두리' },
  { value: 'box', label: '배경상자' },
  { value: 'none', label: '없음' },
] as const

/**
 * 자막을 타임라인 순서대로 늘어놓고 편집한다 (FR-033, FR-034).
 *
 * 자막은 클립에 붙어 있지만 사용자는 "영상 전체에서 몇 번째 자막"으로
 * 생각한다. 그래서 목록은 클립별이 아니라 재생 순서로 보여 준다.
 */
export function SubtitlePanel() {
  const timeline = useProject((state) => state.timeline)
  const subtitles = useProject((state) => state.subtitles)
  const style = useProject((state) => state.subtitleStyle)
  const addSubtitle = useProject((state) => state.addSubtitle)
  const updateSubtitle = useProject((state) => state.updateSubtitle)
  const removeSubtitle = useProject((state) => state.removeSubtitle)
  const setSubtitleStyle = useProject((state) => state.setSubtitleStyle)
  const setPlayhead = useProject((state) => state.setPlayhead)
  const playhead = useProject((state) => state.playhead)

  const segments = useMemo(() => toSegments(timeline), [timeline])

  /** 자막이 타임라인 어디쯤에 놓이는지 계산해 재생 순서로 정렬한다. */
  const rows = useMemo(() => {
    const byClip = new Map(segments.map((segment) => [segment.item.id, segment]))
    return subtitles
      .map((subtitle) => {
        const segment = byClip.get(subtitle.clipId)
        if (!segment) return null
        const range = clipRange(segment.item)
        const timelineStart = segment.start + (subtitle.start - range.start)
        const hidden = subtitle.end <= range.start || subtitle.start >= range.end
        return { subtitle, timelineStart, hidden }
      })
      .filter((row): row is { subtitle: Subtitle; timelineStart: number; hidden: boolean } =>
        row !== null,
      )
      .sort((a, b) => a.timelineStart - b.timelineStart)
  }, [segments, subtitles])

  const canAdd = segmentAt(segments, playhead) !== null

  if (timeline.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="add-subtitle"
          disabled={!canAdd}
          onClick={() => addSubtitle()}
          className="min-h-11 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-600"
        >
          현재 위치에 자막 추가
        </button>
        <span className="text-xs text-slate-500">자막 {rows.length}개</span>
      </div>

      {rows.length > 0 && (
        <ul data-testid="subtitle-list" className="flex flex-col gap-2">
          {rows.map(({ subtitle, timelineStart, hidden }) => (
            <li
              key={subtitle.id}
              data-testid="subtitle-row"
              data-hidden={hidden ? 'true' : 'false'}
              className={`flex flex-wrap items-center gap-2 rounded-xl bg-slate-900/60 p-3 ${
                hidden ? 'opacity-50' : ''
              }`}
            >
              <button
                type="button"
                data-testid="subtitle-seek"
                onClick={() => setPlayhead(timelineStart)}
                className="shrink-0 rounded bg-slate-800 px-2 py-1 text-xs tabular-nums text-sky-300 hover:bg-slate-700"
              >
                {formatClock(timelineStart)}
              </button>
              <input
                data-testid="subtitle-text"
                value={subtitle.text}
                maxLength={MAX_SUBTITLE_LENGTH}
                placeholder="자막 내용"
                onChange={(event) => updateSubtitle(subtitle.id, { text: event.target.value })}
                className="min-w-40 flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-400"
              />
              <label className="flex items-center gap-1 text-xs text-slate-500">
                길이
                <input
                  data-testid="subtitle-duration"
                  type="number"
                  min={0.2}
                  step={0.5}
                  value={Number((subtitle.end - subtitle.start).toFixed(1))}
                  onChange={(event) => {
                    const seconds = Number(event.target.value)
                    if (Number.isFinite(seconds)) {
                      updateSubtitle(subtitle.id, { end: subtitle.start + seconds })
                    }
                  }}
                  className="w-16 rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-400"
                />
                초
              </label>
              <button
                type="button"
                data-testid="subtitle-remove"
                aria-label="자막 지우기"
                onClick={() => removeSubtitle(subtitle.id)}
                className="min-h-9 shrink-0 rounded-lg bg-slate-800 px-3 text-xs text-rose-300 hover:bg-rose-500/20"
              >
                지우기
              </button>
              {hidden && (
                <span className="w-full text-xs text-amber-300/80">
                  클립을 잘라내 지금은 보이지 않습니다. 되돌리면 다시 나타납니다.
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-xl bg-slate-900/40 p-3" data-testid="subtitle-style">
        <summary className="cursor-pointer text-sm font-semibold text-slate-300">
          자막 모양 (전체 적용)
        </summary>

        <div className="mt-3 flex flex-col gap-4">
          <Row label="글자 크기">
            {FONT_SIZES.map((size) => (
              <Choice
                key={size.value}
                testId={`font-${size.label}`}
                active={Math.abs(style.fontScale - size.value) < 0.001}
                onClick={() => setSubtitleStyle({ fontScale: size.value })}
              >
                {size.label}
              </Choice>
            ))}
          </Row>

          <Row label="글자색">
            {['#FFFFFF', '#FFE066', '#000000'].map((color) => (
              <button
                key={color}
                type="button"
                data-testid={`subtitle-color-${color.slice(1)}`}
                aria-label={`글자색 ${color}`}
                aria-pressed={style.color.toUpperCase() === color}
                onClick={() => setSubtitleStyle({ color })}
                style={{ backgroundColor: color }}
                className={`h-9 w-9 rounded-lg ring-2 ${
                  style.color.toUpperCase() === color ? 'ring-sky-400' : 'ring-slate-700'
                }`}
              />
            ))}
          </Row>

          <Row label="배경">
            {BACKGROUNDS.map((background) => (
              <Choice
                key={background.value}
                testId={`bg-${background.value}`}
                active={style.background === background.value}
                onClick={() => setSubtitleStyle({ background: background.value })}
              >
                {background.label}
              </Choice>
            ))}
          </Row>

          <Row label="세로 위치">
            <input
              data-testid="subtitle-position"
              type="range"
              min={2}
              max={50}
              value={Math.round(style.verticalPosition * 100)}
              onChange={(event) =>
                setSubtitleStyle({ verticalPosition: Number(event.target.value) / 100 })
              }
              className="w-40 accent-sky-400"
            />
            <span className="text-xs text-slate-500">아래에서 {Math.round(style.verticalPosition * 100)}%</span>
          </Row>
        </div>
      </details>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-slate-400">{label}</span>
      {children}
    </div>
  )
}

function Choice({
  children,
  active,
  onClick,
  testId,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors ${
        active ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  )
}
