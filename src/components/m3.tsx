import { CheckIcon } from './icons'

/*
 * Material 3 버튼 모양. 화면마다 className 을 새로 쓰면 같은 "주 버튼"이
 * 곳곳에서 조금씩 달라진다. 모양은 여기서만 정한다.
 */

const BUTTON_BASE =
  'state-layer inline-flex shrink-0 items-center justify-center gap-2 rounded-full m3-label-large whitespace-nowrap transition-colors duration-100 ease-m3 disabled:cursor-not-allowed'

/** 비활성은 배경 on-surface 12%, 글자 on-surface 38% (M3 규칙). */
const DISABLED_FILLED = 'disabled:bg-on-surface/12 disabled:text-on-surface/38'

export const btn = {
  filled: `${BUTTON_BASE} h-10 px-6 bg-primary text-on-primary ${DISABLED_FILLED}`,
  tonal: `${BUTTON_BASE} h-10 px-6 bg-secondary-container text-on-secondary-container ${DISABLED_FILLED}`,
  outlined: `${BUTTON_BASE} h-10 px-6 border border-outline text-primary disabled:border-on-surface/12 disabled:text-on-surface/38`,
  text: `${BUTTON_BASE} h-10 px-3 text-primary disabled:text-on-surface/38`,
  /** 아이콘만 있는 둥근 버튼. 크기는 부르는 쪽에서 정한다. */
  icon: `${BUTTON_BASE} text-on-surface-variant disabled:text-on-surface/38`,
  iconTonal: `${BUTTON_BASE} bg-secondary-container text-on-secondary-container ${DISABLED_FILLED}`,
} as const

/** 섹션 제목 h2 */
export const sectionTitle = 'm3-title-medium mx-1 text-on-surface'

/** 알림 상자 — 경고·오류·완료 */
export const notice = {
  warn: 'rounded-m3-md bg-tertiary-container p-3 m3-body-small text-on-tertiary-container',
  error: 'rounded-m3-md bg-error-container p-3 m3-body-small text-on-error-container',
} as const

/**
 * 필터 칩. 여러 개 중 하나를 고르는 짧은 선택지에 쓴다.
 * 고른 칩에는 체크 표시를 붙인다 — 색만으로 상태를 알리지 않는다(PRD 6절).
 */
export function Chip({
  children,
  active,
  onClick,
  testId,
  icon,
  ...rest
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  testId: string
  /** 체크 표시 대신 보일 아이콘. 켜짐·꺼짐을 아이콘 모양으로 알릴 때 쓴다. */
  icon?: React.ReactNode
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className'>) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`state-layer touch-target inline-flex h-8 items-center gap-2 rounded-m3-sm m3-label-large whitespace-nowrap transition-colors duration-100 ease-m3 ${
        active
          ? 'bg-secondary-container pr-4 pl-2 text-on-secondary-container'
          : `border border-outline-variant text-on-surface-variant ${icon ? 'pr-4 pl-2' : 'px-4'}`
      }`}
      {...rest}
    >
      {icon ?? (active && <CheckIcon size={18} />)}
      {children}
    </button>
  )
}

/**
 * 세그먼트 버튼. 해상도·화질처럼 나란히 비교하는 선택지를 한 덩어리로 묶는다.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  testIdPrefix,
}: {
  options: Array<{ value: T; label: string; testId?: string }>
  value: T
  onChange: (value: T) => void
  testIdPrefix: string
}) {
  return (
    <div className="inline-flex h-10 max-w-full divide-x divide-outline overflow-x-auto rounded-full border border-outline">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            data-testid={option.testId ?? `${testIdPrefix}-${option.value}`}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`state-layer flex min-w-12 items-center justify-center gap-1.5 px-3 m3-label-large whitespace-nowrap transition-colors duration-100 ease-m3 ${
              active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface'
            }`}
          >
            {active && <CheckIcon size={18} />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 테두리형 입력칸. 라벨을 테두리 위에 띄워 두면 값을 넣은 뒤에도 무슨
 * 칸인지 보인다. 라벨 뒤 배경은 놓인 자리의 면 색과 같아야 테두리가 끊겨
 * 보이므로 부르는 쪽에서 준다.
 */
export function TextField({
  label,
  labelBg = 'bg-surface',
  className = '',
  inputClassName = '',
  suffix,
  ...input
}: {
  label: string
  labelBg?: string
  className?: string
  inputClassName?: string
  suffix?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`relative block ${className}`}>
      <input
        {...input}
        className={`peer h-14 w-full rounded-m3-xs border border-outline bg-transparent px-4 m3-body-large text-on-surface tabular-nums outline-none placeholder:text-on-surface-variant/70 hover:border-on-surface focus:border-2 focus:border-primary focus:px-[15px] disabled:opacity-38 ${
          suffix ? 'pr-12 focus:pr-12' : ''
        } ${inputClassName}`}
      />
      <span
        className={`pointer-events-none absolute -top-2 left-3 px-1 m3-body-small text-on-surface-variant peer-focus:text-primary ${labelBg}`}
      >
        {label}
      </span>
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center m3-body-large text-on-surface-variant">
          {suffix}
        </span>
      )}
    </label>
  )
}

/**
 * 이름표 + 고르는 것들 한 줄.
 *
 * 좁은 화면에서는 이름표를 위로 올린다. 한 줄에 같이 두면 버튼이 이름표 옆에서
 * 시작했다가 다음 줄은 맨 왼쪽에서 시작해, 줄마다 들쭉날쭉하게 보인다.
 */
export function Row({
  label,
  width = 'sm:w-24',
  children,
}: {
  label: string
  width?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className={`m3-body-medium text-on-surface-variant sm:shrink-0 ${width}`}>{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
