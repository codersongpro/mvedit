import { useMemo } from 'react'
import { useProject } from '../lib/project/store'
import { segmentAt, toSegments } from '../lib/project/playback'
import { clipRange } from '../lib/project/subtitles'
import { MAX_SUBTITLE_LENGTH, type Subtitle } from '../lib/project/types'
import { formatClock } from '../lib/format'
import { DeleteIcon, ExpandMoreIcon, TextFieldsIcon } from './icons'
import { Chip, Row, Segmented, TextField, btn } from './m3'

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
  const selectedId = useProject((state) => state.selectedSubtitleId)

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
      .filter(
        (row): row is { subtitle: Subtitle; timelineStart: number; hidden: boolean } =>
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
          className={`${btn.filled} h-11 pl-4`}
        >
          <TextFieldsIcon size={20} />
          현재 위치에 자막 추가
        </button>
        <span className="mx-2 m3-label-large text-on-surface-variant">자막 {rows.length}개</span>
      </div>

      {rows.length > 0 && (
        <ul
          data-testid="subtitle-list"
          className="flex flex-col gap-0.5 overflow-hidden rounded-m3-lg"
        >
          {rows.map(({ subtitle, timelineStart, hidden }) => {
            // 입력칸 라벨 뒤 배경은 줄 배경과 같아야 테두리가 자연스럽게 끊긴다.
            const labelBg =
              subtitle.id === selectedId ? 'bg-surface-container-high' : 'bg-surface-container'
            return (
              <li
                key={subtitle.id}
                data-testid="subtitle-row"
                data-hidden={hidden ? 'true' : 'false'}
                className={`flex flex-wrap items-center gap-x-3 gap-y-3 px-4 pt-4 pb-3 ${labelBg} ${
                  hidden ? 'opacity-60' : ''
                }`}
              >
                <button
                  type="button"
                  data-testid="subtitle-seek"
                  onClick={() => setPlayhead(timelineStart)}
                  className={`${btn.tonal} h-8 px-3 tabular-nums`}
                >
                  {formatClock(timelineStart)}
                </button>
                <TextField
                  label="자막 내용"
                  labelBg={labelBg}
                  className="min-w-[180px] flex-1"
                  data-testid="subtitle-text"
                  value={subtitle.text}
                  maxLength={MAX_SUBTITLE_LENGTH}
                  onChange={(event) => updateSubtitle(subtitle.id, { text: event.target.value })}
                />
                <TextField
                  label="길이(초)"
                  labelBg={labelBg}
                  className="w-[104px]"
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
                />
                <button
                  type="button"
                  data-testid="subtitle-remove"
                  aria-label="자막 지우기"
                  onClick={() => removeSubtitle(subtitle.id)}
                  title="자막 지우기"
                  className={`${btn.icon} h-11 w-11`}
                >
                  <DeleteIcon size={24} />
                </button>
                {hidden && (
                  <span className="w-full m3-body-small text-on-surface-variant">
                    클립을 잘라내 지금은 보이지 않습니다. 되돌리면 다시 나타납니다.
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <details
        className="group rounded-m3-lg border border-outline-variant bg-surface-container-low"
        data-testid="subtitle-style"
      >
        <summary className="state-layer flex h-14 cursor-pointer list-none items-center justify-between rounded-m3-lg px-4 m3-title-small text-on-surface [&::-webkit-details-marker]:hidden">
          자막 모양 (전체 적용)
          <ExpandMoreIcon
            size={24}
            className="text-on-surface-variant transition-transform duration-200 ease-m3 group-open:rotate-180"
          />
        </summary>

        <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
          <Row label="글자 크기" width="sm:w-[88px]">
            {FONT_SIZES.map((size) => (
              <Chip
                key={size.value}
                testId={`font-${size.label}`}
                active={Math.abs(style.fontScale - size.value) < 0.001}
                onClick={() => setSubtitleStyle({ fontScale: size.value })}
              >
                {size.label}
              </Chip>
            ))}
          </Row>

          <Row label="글자색" width="sm:w-[88px]">
            {['#FFFFFF', '#FFE066', '#000000'].map((color) => (
              <button
                key={color}
                type="button"
                data-testid={`subtitle-color-${color.slice(1)}`}
                aria-label={`글자색 ${color}`}
                aria-pressed={style.color.toUpperCase() === color}
                onClick={() => setSubtitleStyle({ color })}
                style={{ backgroundColor: color }}
                className={`h-9 w-9 rounded-[10px] border border-outline-variant ${
                  style.color.toUpperCase() === color
                    ? 'outline-2 outline-offset-2 outline-primary'
                    : ''
                }`}
              />
            ))}
          </Row>

          <Row label="배경" width="sm:w-[88px]">
            <Segmented
              testIdPrefix="bg"
              options={BACKGROUNDS.map((background) => ({ ...background }))}
              value={style.background}
              onChange={(background) => setSubtitleStyle({ background })}
            />
          </Row>

          <Row label="세로 위치" width="sm:w-[88px]">
            <input
              data-testid="subtitle-position"
              type="range"
              min={2}
              max={50}
              value={Math.round(style.verticalPosition * 100)}
              onChange={(event) =>
                setSubtitleStyle({ verticalPosition: Number(event.target.value) / 100 })
              }
              className="h-10 w-48 accent-primary"
            />
            <span className="m3-body-small text-on-surface-variant">
              아래에서 {Math.round(style.verticalPosition * 100)}%
            </span>
          </Row>
        </div>
      </details>
    </div>
  )
}
