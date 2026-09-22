import { findSource, useProject } from '../lib/project/store'
import { itemDuration } from '../lib/project/types'
import { formatClock } from '../lib/format'
import { MicIcon, MicOffIcon } from './icons'
import { Chip, TextField } from './m3'

const BLANK_COLORS = [
  { value: '#000000', label: '검정' },
  { value: '#FFFFFF', label: '흰색' },
  { value: '#0F172A', label: '남색' },
  { value: '#1E3A8A', label: '파랑' },
]

/**
 * 고른 클립 하나의 속성을 바꾼다 (FR-009, FR-010).
 *
 * 타임라인에서 끌어 조절하는 것과 같은 값을 숫자로도 만질 수 있게 둔다.
 * 손가락으로 "정확히 3초"를 맞추는 건 사실상 불가능하다.
 */
export function ClipInspector() {
  const timeline = useProject((state) => state.timeline)
  const sources = useProject((state) => state.sources)
  const selectedItemId = useProject((state) => state.selectedItemId)
  const setDuration = useProject((state) => state.setDuration)
  const setAudio = useProject((state) => state.setAudio)
  const setColor = useProject((state) => state.setColor)

  const item = timeline.find((candidate) => candidate.id === selectedItemId)
  if (!item) {
    return (
      <p
        data-testid="inspector-empty"
        className="rounded-m3-lg border border-outline-variant bg-surface-container-low p-4 m3-body-medium text-on-surface-variant"
      >
        클립을 고르면 길이와 소리를 조절할 수 있습니다.
      </p>
    )
  }

  const source = findSource(sources, item.sourceId)
  const seconds = itemDuration(item)
  const label = item.type === 'blank' ? '빈 화면' : item.type === 'image' ? '사진' : '영상'

  return (
    <div
      data-testid="inspector"
      data-inspector-type={item.type}
      className="flex flex-col gap-4 rounded-m3-lg bg-surface-container p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="truncate m3-title-small text-on-surface">
          {label}
          {source ? ` · ${source.fileName}` : ''}
        </h3>
        <span
          data-testid="inspector-duration"
          className="shrink-0 m3-label-medium tabular-nums text-on-surface-variant"
        >
          {formatClock(seconds)}
        </span>
      </div>

      {item.type === 'video' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="clip-volume" className="m3-body-medium text-on-surface-variant">
              소리 {Math.round(item.volume * 100)}%
            </label>
            <Chip
              testId="toggle-mute"
              active={item.muted}
              onClick={() => setAudio(item.id, { muted: !item.muted })}
              icon={item.muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
            >
              {item.muted ? '음소거 해제' : '음소거'}
            </Chip>
          </div>
          <input
            id="clip-volume"
            data-testid="volume-slider"
            type="range"
            min={0}
            max={200}
            step={5}
            value={Math.round(item.volume * 100)}
            disabled={item.muted}
            onChange={(event) => setAudio(item.id, { volume: Number(event.target.value) / 100 })}
            className="h-10 w-full accent-primary disabled:opacity-38"
          />
          {!source?.hasAudio && (
            <p className="m3-body-small text-on-surface-variant">
              이 영상에는 소리가 들어 있지 않습니다.
            </p>
          )}
        </div>
      ) : (
        <div className="pt-1">
          <TextField
            label="표시 시간 (초)"
            labelBg="bg-surface-container"
            className="w-40"
            id="clip-duration"
            data-testid="duration-input"
            type="number"
            min={0.1}
            step={0.5}
            value={Number(item.duration.toFixed(2))}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value)) setDuration(item.id, value)
            }}
          />
        </div>
      )}

      {item.type === 'blank' && (
        <div className="flex flex-col gap-2">
          <span className="m3-body-medium text-on-surface-variant">배경색</span>
          <div className="flex flex-wrap gap-2">
            {BLANK_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                data-testid={`blank-color-${color.value.slice(1)}`}
                aria-label={color.label}
                aria-pressed={item.color.toUpperCase() === color.value}
                onClick={() => setColor(item.id, color.value)}
                style={{ backgroundColor: color.value }}
                className={`h-9 w-9 rounded-[10px] border border-outline-variant ${
                  item.color.toUpperCase() === color.value
                    ? 'outline-2 outline-offset-2 outline-primary'
                    : ''
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
