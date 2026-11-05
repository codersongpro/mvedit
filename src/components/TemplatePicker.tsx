import { useProject } from '../lib/project/store'
import { TEMPLATES, matchTemplate, type Template } from '../lib/project/templates'
import { timelineDuration } from '../lib/project/types'
import { formatClock } from '../lib/format'
import { notice } from './m3'

/** 템플릿마다 화면 모양을 작게 그려 숫자 없이도 고를 수 있게 한다. */
function Frame({ template }: { template: Template }) {
  const portrait = template.export.aspectRatio === '9:16'
  return (
    <span
      aria-hidden
      className={`relative shrink-0 rounded-[4px] border-2 border-current ${
        portrait ? 'h-9 w-5' : 'h-5 w-9'
      }`}
    >
      <span
        className="absolute inset-x-1 h-[3px] rounded-full bg-current"
        style={{ bottom: `${template.subtitle.verticalPosition * 100}%` }}
      />
    </span>
  )
}

/**
 * 템플릿 고르기 (FR-045).
 *
 * 화면비·해상도·화질·자막 모양을 한 번에 맞춘다. 미리보기가 바로 바뀌므로
 * 결과를 보면서 고를 수 있다.
 */
export function TemplatePicker() {
  const timeline = useProject((state) => state.timeline)
  const setting = useProject((state) => state.exportSetting)
  const style = useProject((state) => state.subtitleStyle)
  const setExportSetting = useProject((state) => state.setExportSetting)
  const setSubtitleStyle = useProject((state) => state.setSubtitleStyle)

  const active = matchTemplate(setting, style)
  const duration = timelineDuration(timeline)
  const tooLong = active?.maxSeconds != null && duration > active.maxSeconds

  const apply = (template: Template) => {
    // 목표 용량은 올릴 곳이 아니라 보낼 곳(메신저 등)에 따라 정하는 값이라 건드리지 않는다.
    setExportSetting(template.export)
    setSubtitleStyle(template.subtitle)
  }

  return (
    <div className="flex flex-col gap-3" data-testid="template-picker">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TEMPLATES.map((template) => {
          const selected = active?.id === template.id
          return (
            <button
              key={template.id}
              type="button"
              data-testid={`template-${template.id}`}
              aria-pressed={selected}
              onClick={() => apply(template)}
              className={`state-layer flex min-h-[72px] items-center gap-3 rounded-m3-md border px-3 py-2 text-left ${
                selected
                  ? 'border-primary bg-secondary-container text-on-secondary-container'
                  : 'border-outline-variant text-on-surface'
              }`}
            >
              <Frame template={template} />
              <span className="flex min-w-0 flex-col">
                <span className="m3-label-large">{template.label}</span>
                <span className="m3-body-small text-on-surface-variant">{template.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mx-1 m3-body-small text-on-surface-variant">
        {active
          ? `‘${active.label}’에 맞춘 화면비·해상도·화질·자막 모양을 쓰는 중입니다. 아래에서 하나씩 바꿀 수도 있습니다.`
          : '올릴 곳을 고르면 화면비·해상도·화질·자막 모양을 한 번에 맞춥니다.'}
      </p>
      {tooLong && active?.maxSeconds != null && (
        <p data-testid="template-too-long" className={notice.warn}>
          지금 영상은 {formatClock(duration)}입니다. {active.label}은{' '}
          {formatClock(active.maxSeconds)} 이하로 올리는 것이 좋습니다. 긴 부분을 잘라 주세요.
        </p>
      )}
    </div>
  )
}
