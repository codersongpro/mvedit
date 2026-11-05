import { useProject } from '../lib/project/store'
import { fadesOf } from '../lib/project/playback'
import type { TimelineItem } from '../lib/project/types'
import { FILTERS, TRANSITIONS, ZOOMS } from '../lib/media/visualFx'
import { Chip } from './m3'

/**
 * 클립 하나의 화면 효과 (FR-047): 색감 필터·줌·화면 전환.
 *
 * 전환은 페이드 구간이 '어떻게' 잦아드는가라서 페이드가 없으면 보이지 않는다.
 * 그래서 ‘모든 컷에 적용’은 컷 사이 페이드가 없을 때 기본 길이로 함께 건다.
 */
export function ClipEffects({ item }: { item: TimelineItem }) {
  const timeline = useProject((state) => state.timeline)
  const setVisual = useProject((state) => state.setVisual)
  const setTransitionAll = useProject((state) => state.setTransitionAll)
  const fades = fadesOf(item)
  const transition = item.transition ?? 'black'

  return (
    <div data-testid="clip-effects" className="flex flex-col gap-3">
      <span className="m3-body-medium text-on-surface-variant">화면 효과</span>

      <div className="flex flex-col gap-2">
        <span className="m3-label-medium text-on-surface-variant">색감</span>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <Chip
              key={filter.value}
              testId={`filter-${filter.value}`}
              active={(item.filter ?? 'none') === filter.value}
              onClick={() => setVisual(item.id, { filter: filter.value })}
            >
              {filter.label}
            </Chip>
          ))}
        </div>
      </div>

      {item.type !== 'blank' && (
        <div className="flex flex-col gap-2">
          <span className="m3-label-medium text-on-surface-variant">줌</span>
          <div className="flex flex-wrap gap-2">
            {ZOOMS.map((zoom) => (
              <Chip
                key={zoom.value}
                testId={`clip-zoom-${zoom.value}`}
                active={(item.zoom ?? 'none') === zoom.value}
                onClick={() => setVisual(item.id, { zoom: zoom.value })}
              >
                {zoom.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="m3-label-medium text-on-surface-variant">전환 모양 (페이드 구간)</span>
        <div className="flex flex-wrap gap-2">
          {TRANSITIONS.map((option) => (
            <Chip
              key={option.value}
              testId={`transition-${option.value}`}
              active={transition === option.value}
              onClick={() => setVisual(item.id, { transition: option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {timeline.length > 1 && (
            <Chip
              testId="transition-apply-all"
              active={false}
              onClick={() => setTransitionAll(transition)}
            >
              이 전환을 모든 컷에 적용
            </Chip>
          )}
          {fades.fadeIn === 0 && fades.fadeOut === 0 && (
            <span className="m3-body-small text-on-surface-variant">
              페이드가 있어야 전환이 보입니다.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
