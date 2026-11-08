import { useEffect } from 'react'
import {
  CAPTION_FONTS,
  fontStack,
  nearestWeight,
  registerCaptionFont,
} from '../lib/media/captionFonts'

/**
 * 자막 글씨체 고르기 (FR-050).
 *
 * 이름만 늘어놓으면 모양을 알 수 없다. 버튼마다 그 글꼴로 이름과 "가나다"를
 * 써서 고르기 전에 보이게 한다. 이 칸을 연 사람만 글꼴 목록을 받는다.
 */
export function FontPicker({
  value,
  onChange,
  testIdPrefix,
  inheritLabel,
}: {
  value: string | undefined
  onChange: (id: string | undefined) => void
  testIdPrefix: string
  /** 주면 "전체 설정 따름" 같은 선택지를 맨 앞에 둔다 */
  inheritLabel?: string
}) {
  useEffect(() => {
    for (const font of CAPTION_FONTS) {
      void registerCaptionFont(document.fonts, font.id, {
        origin: location.origin,
        skipPretendard: true,
      }).catch(() => {})
    }
  }, [])

  const options: { id: string | undefined; label: string; hint: string }[] = [
    ...(inheritLabel ? [{ id: undefined, label: inheritLabel, hint: '' }] : []),
    ...CAPTION_FONTS.map((font) => ({ id: font.id, label: font.label, hint: font.hint })),
  ]
  const current = value ?? (inheritLabel ? undefined : CAPTION_FONTS[0].id)

  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {options.map((option) => {
        const selected = option.id === current
        return (
          <button
            key={option.id ?? 'inherit'}
            type="button"
            data-testid={`${testIdPrefix}-${option.id ?? 'inherit'}`}
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
            className={`state-layer flex min-h-[64px] flex-col items-start justify-center gap-0.5 rounded-m3-md border px-3 py-2 text-left ${
              selected
                ? 'border-primary bg-secondary-container text-on-secondary-container'
                : 'border-outline-variant text-on-surface'
            }`}
          >
            <span
              className="text-[19px] leading-tight"
              style={
                option.id
                  ? { fontFamily: fontStack(option.id), fontWeight: nearestWeight(option.id, 700) }
                  : undefined
              }
            >
              {option.id ? `가나다 ${option.label}` : option.label}
            </span>
            {option.hint && (
              <span className="m3-body-small text-on-surface-variant">{option.hint}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
