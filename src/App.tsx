import { useEffect, useState } from 'react'
import { CapabilityPanel } from './components/CapabilityPanel'
import { ExportPanel } from './components/ExportPanel'
import { detectCapabilities, type Capabilities } from './lib/capabilities'

export default function App() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)

  useEffect(() => {
    let cancelled = false
    detectCapabilities().then((result) => {
      if (!cancelled) setCapabilities(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-10 px-4 py-10">
      <header>
        <p className="text-xs font-medium tracking-widest text-sky-400 uppercase">CutCap</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-50 sm:text-3xl">
          브라우저에서 바로 자르는 무료 영상 편집기
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          영상은 기기를 벗어나지 않습니다. 업로드도 로그인도 없습니다. 지금은 준비 단계라
          영상 하나를 그대로 다시 내보내는 것까지만 됩니다.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">영상 내보내기 시험</h2>
        <ExportPanel />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">이 기기 환경 점검</h2>
        {capabilities === null ? (
          <p className="rounded-xl bg-slate-900/60 p-4 text-sm text-slate-400">확인하는 중…</p>
        ) : (
          <>
            <CapabilityPanel checks={capabilities.checks} />
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              교차 출처 격리:{' '}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                crossOriginIsolated = {String(capabilities.crossOriginIsolated)}
              </code>
            </p>
          </>
        )}
      </section>
    </main>
  )
}
