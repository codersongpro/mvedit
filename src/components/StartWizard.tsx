import { useState } from 'react'
import { useProject } from '../lib/project/store'
import { TEMPLATES, type Template } from '../lib/project/templates'
import { STYLES, STYLES_BY_KIND, type StyleTemplate } from '../lib/project/styles'
import { filterCss } from '../lib/media/visualFx'
import { SubtitleOverlay } from './SubtitleOverlay'
import { btn } from './m3'

/** 고르기 전에 결과를 눈으로 보게 하는 작은 화면. 실제 자막·색감 계산을 그대로 쓴다. */
function StylePreview({ kind, style }: { kind: Template; style: StyleTemplate }) {
  const portrait = kind.export.aspectRatio === '9:16'
  return (
    <span
      aria-hidden
      className={`relative block shrink-0 overflow-hidden rounded-m3-sm bg-black ${
        portrait ? 'h-24 w-[54px]' : 'h-[54px] w-24'
      }`}
      style={{ containerType: 'size' }}
    >
      <span
        className="absolute inset-0"
        style={{
          // 사진 대신 하늘·땅 그라데이션. 색감 필터가 바꾸는 모습이 잘 보인다.
          background: 'linear-gradient(180deg, #7cc4f5 0%, #f5d27c 55%, #5a8f4e 56%, #3d6b35 100%)',
          filter: filterCss(style.filter) === 'none' ? undefined : filterCss(style.filter),
        }}
      />
      <SubtitleOverlay
        subtitle={{ text: '오늘의 영상', start: 0, end: 2, effect: style.subtitleEffect }}
        style={kind.subtitle}
        time={0.5}
      />
    </span>
  )
}

/**
 * 시작 화면: 어떤 영상을 만들지 → 어떤 느낌으로 (FR-049).
 *
 * 처음 만드는 사람은 화면비·해상도·자막 꾸미기·전환을 따로따로 정할 줄 모른다.
 * 두 번 고르면 다 맞춰지게 한다. 영상을 바로 넣고 싶은 사람을 막지 않도록
 * 건너뛰기를 두고, 아래 파일 고르기도 그대로 둔다.
 */
export function StartWizard() {
  const look = useProject((state) => state.look)
  const skipped = useProject((state) => state.startSkipped)
  const chooseLook = useProject((state) => state.chooseLook)
  const clearLook = useProject((state) => state.clearLook)
  const skipStart = useProject((state) => state.skipStart)
  const [kindId, setKindId] = useState<Template['id'] | null>(null)

  if (skipped) return null

  if (look) {
    const kind = TEMPLATES.find((template) => template.id === look.kind)
    return (
      <div
        data-testid="start-summary"
        className="flex flex-wrap items-center gap-3 rounded-m3-lg bg-secondary-container px-4 py-3 text-on-secondary-container"
      >
        <span className="m3-body-medium">
          <strong className="m3-label-large">
            {kind?.label} · {STYLES[look.style].label}
          </strong>{' '}
          으로 시작합니다. 이제 아래에서 영상을 넣어 주세요.
        </span>
        <button
          type="button"
          data-testid="start-change"
          className={`${btn.text} ml-auto`}
          onClick={() => {
            setKindId(null)
            clearLook()
          }}
        >
          다시 고르기
        </button>
      </div>
    )
  }

  const kind = kindId ? TEMPLATES.find((template) => template.id === kindId) : null

  return (
    <section
      data-testid="start-wizard"
      className="flex flex-col gap-4 rounded-m3-xl bg-surface-container p-4 sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="m3-label-medium text-primary">{kind ? '2 / 2' : '1 / 2'}</span>
          <h2 className="m3-title-large text-on-surface">
            {kind ? `어떤 느낌의 ${kind.label}인가요?` : '어떤 영상을 만들까요?'}
          </h2>
          <p className="m3-body-medium text-on-surface-variant">
            {kind
              ? '자막 꾸미기·색감·장면 전환을 한 번에 맞춥니다. 나중에 하나씩 바꿀 수 있습니다.'
              : '고르면 화면비·해상도·자막 위치를 올릴 곳에 맞춥니다.'}
          </p>
        </div>
        <button
          type="button"
          data-testid="start-skip"
          className={`${btn.text} shrink-0`}
          onClick={skipStart}
        >
          건너뛰기
        </button>
      </div>

      {!kind ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TEMPLATES.map((template) => {
            const portrait = template.export.aspectRatio === '9:16'
            return (
              <button
                key={template.id}
                type="button"
                data-testid={`start-kind-${template.id}`}
                onClick={() => setKindId(template.id)}
                className="state-layer flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-m3-lg border border-outline-variant bg-surface px-3 py-4 text-center"
              >
                <span
                  aria-hidden
                  className={`rounded-[6px] border-2 border-primary ${portrait ? 'h-12 w-7' : 'h-7 w-12'}`}
                />
                <span className="m3-title-medium text-on-surface">{template.label}</span>
                <span className="m3-body-small text-on-surface-variant">{template.hint}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {STYLES_BY_KIND[kind.id].map((styleId) => {
              const style = STYLES[styleId]
              return (
                <button
                  key={style.id}
                  type="button"
                  data-testid={`start-style-${style.id}`}
                  onClick={() => chooseLook({ kind: kind.id, style: style.id })}
                  className="state-layer flex items-center gap-4 rounded-m3-lg border border-outline-variant bg-surface p-3 text-left"
                >
                  <StylePreview kind={kind} style={style} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="m3-title-medium text-on-surface">{style.label}</span>
                    <span className="m3-body-small text-on-surface-variant">{style.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            data-testid="start-back"
            className={`${btn.text} self-start`}
            onClick={() => setKindId(null)}
          >
            ← 영상 종류 다시 고르기
          </button>
        </>
      )}
    </section>
  )
}
