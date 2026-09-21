import type { CapabilityCheck, CheckStatus } from '../lib/capabilities'

const STATUS_STYLE: Record<CheckStatus, { badge: string; label: string; ring: string }> = {
  ok: { badge: 'bg-emerald-500/15 text-emerald-300', label: '사용 가능', ring: 'ring-emerald-500/20' },
  warn: { badge: 'bg-amber-500/15 text-amber-300', label: '제한적', ring: 'ring-amber-500/20' },
  fail: { badge: 'bg-rose-500/15 text-rose-300', label: '불가', ring: 'ring-rose-500/20' },
}

export function CapabilityPanel({ checks }: { checks: CapabilityCheck[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {checks.map((check) => {
        const style = STATUS_STYLE[check.status]
        return (
          <li
            key={check.label}
            className={`rounded-xl bg-slate-900/60 p-4 ring-1 ${style.ring}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100">{check.label}</h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
                {style.label}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{check.detail}</p>
          </li>
        )
      })}
    </ul>
  )
}
