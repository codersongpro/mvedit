import { useProject } from '../lib/project/store'
import type { Subtitle, SubtitleEffect } from '../lib/project/types'
import { ANIMATIONS, PRESETS } from '../lib/media/subtitleLook'
import { Chip, Row, btn } from './m3'

const POSITIONS: { id: string; label: string; position: SubtitleEffect['position'] }[] = [
  { id: 'default', label: '기본', position: undefined },
  { id: 'top', label: '위', position: { x: 0.5, y: 0.82 } },
  { id: 'middle', label: '가운데', position: { x: 0.5, y: 0.45 } },
  { id: 'bottom', label: '아래', position: { x: 0.5, y: 0.08 } },
]

/**
 * 자막 하나 꾸미기 (FR-046).
 *
 * 프로젝트 전체 모양(FR-036)은 그대로 두고 이 자막만 바꾼다. 강조하고 싶은
 * 한두 줄만 예능 자막으로 튀게 하는 식으로 쓰기 때문이다. 같은 꾸미기를
 * 계속 쓰고 싶으면 ‘모든 자막에 적용’ 한 번으로 퍼뜨린다.
 */
export function SubtitleEffectEditor({ subtitle }: { subtitle: Subtitle }) {
  const updateSubtitle = useProject((state) => state.updateSubtitle)
  const applyEffectToAll = useProject((state) => state.applyEffectToAll)
  const effect = subtitle.effect ?? {}
  const set = (patch: Partial<SubtitleEffect>) =>
    updateSubtitle(subtitle.id, { effect: { ...effect, ...patch } })

  const positionId =
    POSITIONS.find(
      (option) =>
        option.position?.x === effect.position?.x && option.position?.y === effect.position?.y,
    )?.id ?? (effect.position ? 'custom' : 'default')

  return (
    <div data-testid="subtitle-effect-editor" className="flex w-full flex-col gap-3 pt-1">
      <Row label="스타일" width="sm:w-[72px]">
        {PRESETS.map((preset) => (
          <Chip
            key={preset.value}
            testId={`effect-preset-${preset.value}`}
            active={(effect.preset ?? 'basic') === preset.value}
            onClick={() => set({ preset: preset.value })}
          >
            {preset.label}
          </Chip>
        ))}
      </Row>
      <Row label="등장" width="sm:w-[72px]">
        {ANIMATIONS.map((animation) => (
          <Chip
            key={animation.value}
            testId={`effect-animation-${animation.value}`}
            active={(effect.animation ?? 'none') === animation.value}
            onClick={() => set({ animation: animation.value })}
          >
            {animation.label}
          </Chip>
        ))}
      </Row>
      <Row label="강조" width="sm:w-[72px]">
        <Chip
          testId="effect-highlight"
          active={Boolean(effect.highlight)}
          onClick={() => set({ highlight: !effect.highlight })}
        >
          말하는 단어 강조
        </Chip>
      </Row>
      <Row label="위치" width="sm:w-[72px]">
        {POSITIONS.map((option) => (
          <Chip
            key={option.id}
            testId={`effect-position-${option.id}`}
            active={positionId === option.id}
            onClick={() => set({ position: option.position })}
          >
            {option.label}
          </Chip>
        ))}
        <span className="m3-body-small text-on-surface-variant">
          {positionId === 'custom' ? '직접 옮긴 위치 · ' : ''}미리보기에서 자막을 끌어 옮길 수도
          있습니다
        </span>
      </Row>
      <button
        type="button"
        data-testid="effect-apply-all"
        className={`${btn.text} self-start`}
        onClick={() => applyEffectToAll(effect)}
      >
        이 꾸미기를 모든 자막에 적용 (위치 제외)
      </button>
    </div>
  )
}
