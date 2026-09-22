import type { CapabilityCheck, CheckStatus } from '../lib/capabilities'

const STATUS_STYLE: Record<CheckStatus, { badge: string; label: string }> = {
  ok: { badge: 'bg-primary-container text-on-primary-container', label: '사용 가능' },
  warn: { badge: 'bg-tertiary-container text-on-tertiary-container', label: '제한적' },
  fail: { badge: 'bg-error-container text-on-error-container', label: '불가' },
}

export function CapabilityPanel({ checks }: { checks: CapabilityCheck[] }) {
  return (
    <ul className="flex flex-col gap-0.5 overflow-hidden rounded-m3-lg">
      {checks.map((check) => {
        const style = STATUS_STYLE[check.status]
        return (
          <li key={check.label} className="bg-surface-container px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m3-title-small text-on-surface">{check.label}</h3>
              <span className={`rounded-m3-sm px-2.5 py-0.5 m3-label-medium ${style.badge}`}>
                {style.label}
              </span>
            </div>
            <p className="mt-1 m3-body-medium text-on-surface-variant">{check.detail}</p>
          </li>
        )
      })}
    </ul>
  )
}
