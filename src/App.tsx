import { useCallback, useEffect, useState } from 'react'
import { CapabilityPanel } from './components/CapabilityPanel'
import { ClipInspector } from './components/ClipInspector'
import { EditToolbar } from './components/EditToolbar'
import { ExportPanel } from './components/ExportPanel'
import { FilePicker } from './components/FilePicker'
import { RejectedFiles } from './components/RejectedFiles'
import { Timeline } from './components/Timeline'
import { useProject } from './lib/project/store'
import { detectCapabilities, type Capabilities } from './lib/capabilities'
import { useEditShortcuts } from './lib/useEditShortcuts'

export default function App() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  const timeline = useProject((state) => state.timeline)
  const rejected = useProject((state) => state.rejected)
  const importing = useProject((state) => state.importing)
  const addImported = useProject((state) => state.addImported)
  const setImporting = useProject((state) => state.setImporting)
  const clearRejected = useProject((state) => state.clearRejected)

  useEditShortcuts()

  useEffect(() => {
    let cancelled = false
    detectCapabilities().then((result) => {
      if (!cancelled) setCapabilities(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSelect = useCallback(
    async (files: File[]) => {
      setImporting(true)
      // 인코딩 코드가 딸려 오므로 첫 화면 번들에 넣지 않고 이때 받아온다.
      const { importFiles } = await import('./lib/media/import')
      const outcome = await importFiles(files)
      addImported(outcome.sources, outcome.items, outcome.rejected)
    },
    [addImported, setImporting],
  )

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header>
        <p className="text-xs font-medium tracking-widest text-sky-400 uppercase">CutCap</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-50 sm:text-3xl">누구나 하는 컷편집</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          영상은 기기를 벗어나지 않습니다. 업로드도 로그인도 없습니다.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <FilePicker onSelect={handleSelect} disabled={importing} />
        {importing && (
          <p data-testid="importing" className="text-sm text-slate-400">
            파일을 읽는 중…
          </p>
        )}
        <RejectedFiles files={rejected} onDismiss={clearRejected} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-300">타임라인</h2>
        <EditToolbar />
        <Timeline />
        {timeline.length > 0 && <ClipInspector />}
        {timeline.length > 0 && (
          <p className="text-xs leading-relaxed text-slate-500">
            눈금을 눌러 위치를 옮기고 분할하세요. 클립을 고르면 양 끝을 끌어 길이를
            줄이거나 늘릴 수 있습니다. 두 손가락으로 벌리거나 Ctrl+휠로 확대합니다.
            <span className="hidden sm:inline">
              {' '}
              단축키: S 분할 · Delete 삭제 · ←→ 한 프레임 · Ctrl+Z 되돌리기
            </span>
          </p>
        )}
      </section>

      {timeline.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-300">내보내기</h2>
          <ExportPanel />
        </section>
      )}

      <section>
        <button
          type="button"
          onClick={() => setDiagnosticsOpen((open) => !open)}
          className="text-sm font-semibold text-slate-400 hover:text-slate-200"
        >
          이 기기 환경 점검 {diagnosticsOpen ? '숨기기' : '보기'}
        </button>

        {diagnosticsOpen && (
          <div className="mt-3">
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
          </div>
        )}
      </section>
    </main>
  )
}
